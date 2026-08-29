import { decodeLiteral, lineAt, lineIndex, maskLiterals, skipBraced, skipString, skipTemplate } from './scan.js'

// Modifiers we recognise on a test or suite call. Anything else (`foo.bar('x')`)
// is not a test and is ignored.
const MODIFIERS = new Set([
  'only', 'skip', 'todo', 'failing', 'fails', 'concurrent', 'sequential', 'serial',
  'each', 'for', 'skipIf', 'runIf', 'if',
])

// Modifiers that take an argument list or a tagged template before the call.
const MODIFIERS_WITH_ARGS = new Set(['each', 'for', 'skipIf', 'runIf', 'if'])

// Modifiers that mean the test does not actually run.
const MODIFIERS_THAT_SKIP = new Set(['skip', 'todo'])

// Base names that are themselves skipped or focused variants (Jest).
const SKIPPED_ALIASES = new Set(['xit', 'xtest'])

// `t.test(...)` — node:test subtests. Only these receiver names are accepted,
// because `someRegex.test('str')` is far more common than a subtest on an
// arbitrarily named object.
const CONTEXT_RECEIVERS = 't|ctx|context|tc'

const TEST_FN = new RegExp(
  String.raw`(?<![\w$.])(?:(${CONTEXT_RECEIVERS})\s*\.\s*)?(it|test|xit|xtest|fit)(?=\s*[.(<])`,
  'g',
)

const SUITE_FN = /(?<![\w$.])(?:describe|suite|xdescribe)(?=\s*[.(])/g

// `{ skip: true }` / `{ skip: 'why' }` / `{ todo: true }` in node:test's options
// object. `skip: false` deliberately does not match.
const OPTION_SKIP_RE = /\b(skip|todo)\s*:\s*(?!false\b)[^,\s}]/

/**
 * The claim a test name declares, e.g. `C3`, or null when it declares none.
 * Accepted forms: `C3: ...`, `[C3] ...`, `C3 - ...`.
 */
export function parseClaimTag(name) {
  if (typeof name !== 'string') return null
  const m = /^\s*(?:\[\s*C\s*(\d+)\s*\]|C\s*(\d+)\s*[:–—-])/i.exec(name)
  if (!m) return null
  const digits = m[1] !== undefined ? m[1] : m[2]
  return `C${Number(digits)}`
}

function skipWs(source, i) {
  while (i < source.length && /\s/.test(source[i])) i++
  return i
}

function readIdent(source, i) {
  let j = i
  while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j++
  return j > i ? { name: source.slice(i, j), end: j } : null
}

/** Skip a balanced `(...)` group starting at `i`, or -1 if `i` is not `(`. */
function skipParens(source, i) {
  if (source[i] !== '(') return -1
  let depth = 0
  let j = i
  while (j < source.length) {
    const c = source[j]
    if (c === '"' || c === "'") {
      j = skipString(source, j, c)
      continue
    }
    if (c === '`') {
      j = skipTemplate(source, j)
      continue
    }
    if (c === '{') {
      j = skipBraced(source, j)
      continue
    }
    if (c === '(') {
      depth++
      j++
      continue
    }
    if (c === ')') {
      depth--
      j++
      if (depth === 0) return j
      continue
    }
    j++
  }
  return -1
}

/** Skip a `<...>` type-argument list starting at `i`, or -1 if it is not one. */
function skipTypeArgs(source, i) {
  if (source[i] !== '<') return -1
  let angle = 0
  let brace = 0
  let j = i
  const limit = Math.min(source.length, i + 600)
  while (j < limit) {
    const c = source[j]
    if (c === '(') {
      // A function type: `it<(a: string) => void>(...)`.
      const after = skipParens(source, j)
      if (after === -1) return -1
      j = after
      continue
    }
    if (c === '{') brace++
    else if (c === '}') brace--
    else if (c === '<') angle++
    else if (c === '>') {
      // The `>` of an arrow type (`() => void`) closes nothing.
      if (source[j - 1] === '=') {
        j++
        continue
      }
      angle--
      j++
      if (angle === 0 && brace === 0) return j
      continue
    } else if (c === ';') {
      // A statement boundary means this was a comparison, not type arguments.
      return -1
    }
    j++
  }
  return -1
}

/**
 * Walk the `.only` / `.skip` / `.each(...)` chain after a base identifier.
 * Returns `{ modifiers, callAt }` where `callAt` is the index of the `(` that
 * opens the actual call, or null when this is not a call we recognise.
 */
function parseChain(code, from) {
  let i = from
  const modifiers = []
  for (;;) {
    i = skipWs(code, i)
    if (code[i] === '<') {
      const after = skipTypeArgs(code, i)
      if (after === -1) return null
      i = after
      continue
    }
    if (code[i] === '.') {
      i = skipWs(code, i + 1)
      const ident = readIdent(code, i)
      if (!ident || !MODIFIERS.has(ident.name)) return null
      modifiers.push(ident.name)
      i = skipWs(code, ident.end)
      if (MODIFIERS_WITH_ARGS.has(ident.name)) {
        // The modifier can carry its own type arguments: `test.each<Case>([…])`.
        if (code[i] === '<') {
          const afterTypes = skipTypeArgs(code, i)
          if (afterTypes === -1) return null
          i = skipWs(code, afterTypes)
        }
        if (code[i] === '(') {
          const after = skipParens(code, i)
          if (after === -1) return null
          i = after
        } else if (code[i] === '`') {
          i = skipTemplate(code, i)
        }
      }
      continue
    }
    if (code[i] === '(') return { modifiers, callAt: i }
    return null
  }
}

/**
 * True when a call opening at `callAt` is `fn('name', { skip: true }, …)`.
 * node:test takes the same options object on `test` and on `describe`.
 */
function hasSkipOption(code, callAt) {
  let i = skipWs(code, callAt + 1)
  const quote = code[i]
  if (quote !== '"' && quote !== "'" && quote !== '`') return false
  const end = quote === '`' ? skipTemplate(code, i) : skipString(code, i, quote)
  let j = skipWs(code, end)
  if (code[j] !== ',') return false
  j = skipWs(code, j + 1)
  if (code[j] !== '{') return false
  return OPTION_SKIP_RE.test(code.slice(j, skipBraced(code, j)))
}

/** Ranges covered by a skipped `describe`, so its tests never count as run. */
function skippedSuiteRanges(code) {
  const ranges = []
  SUITE_FN.lastIndex = 0
  let match
  while ((match = SUITE_FN.exec(code)) !== null) {
    const base = match[0]
    const chain = parseChain(code, match.index + base.length)
    if (!chain) continue
    const skipped =
      base === 'xdescribe' ||
      chain.modifiers.some((m) => MODIFIERS_THAT_SKIP.has(m)) ||
      hasSkipOption(code, chain.callAt)
    if (!skipped) continue
    const end = skipParens(code, chain.callAt)
    ranges.push([match.index, end === -1 ? code.length : end])
  }
  return ranges
}

function inRanges(ranges, index) {
  return ranges.some(([start, end]) => index >= start && index < end)
}

/**
 * True when the identifier at `i` is JSX text rather than code: `<p>it ('x')`.
 *
 * The lookback stops at the newline on purpose. JSX text that can be mistaken
 * for a declaration always sits on the same line as the `>` that opens it,
 * whereas a `>` at the end of the *previous* line is just how a statement
 * happened to end — `const Wrapper = ({ children }) => <div>{children}</div>`
 * followed by a real test, which is ordinary semicolon-free React code.
 * `=>` is excluded either way: `describe('x', () => it('C1: y', fn))`.
 */
function isJsxText(code, i) {
  let j = i - 1
  while (j >= 0 && code[j] !== '\n' && /\s/.test(code[j])) j--
  return j >= 0 && code[j] === '>' && code[j - 1] !== '='
}

/**
 * Extract every `test()` / `it()` declaration from JavaScript or TypeScript
 * source. Comments and literal bodies are masked first, so neither a
 * commented-out test nor `it('x')` quoted inside a string or regex counts.
 *
 * Returns `{ tests, path }` where each test is
 * `{ name, claim, status, line, path, dynamic }`.
 */
export function parseTestSource(source, path = '<source>') {
  const code = maskLiterals(source)
  const starts = lineIndex(code)
  const skippedRanges = skippedSuiteRanges(code)
  const tests = []

  TEST_FN.lastIndex = 0
  let match
  while ((match = TEST_FN.exec(code)) !== null) {
    const start = match.index
    const receiver = match[1]
    const base = match[2]
    if (isJsxText(code, start)) continue
    const chain = parseChain(code, match.index + match[0].length)
    if (!chain) continue

    let i = skipWs(code, chain.callAt + 1)
    const quote = code[i]
    const isLiteral = quote === '"' || quote === "'" || quote === '`'
    const end = isLiteral ? (quote === '`' ? skipTemplate(code, i) : skipString(code, i, quote)) : -1

    // `t.test('name', fn)` is a node:test subtest; `re.test('str')` is not.
    // Requiring a second argument tells them apart.
    if (receiver) {
      if (!isLiteral) continue
      if (code[skipWs(code, end)] !== ',') continue
    }

    const line = lineAt(starts, start)
    let status =
      SKIPPED_ALIASES.has(base) ||
      chain.modifiers.some((m) => MODIFIERS_THAT_SKIP.has(m)) ||
      inRanges(skippedRanges, start)
        ? 'skipped'
        : 'active'

    if (!isLiteral) {
      // `test(nameVariable, ...)` — a real test whose name we cannot read.
      tests.push({ name: null, claim: null, status, line, path, dynamic: true })
      continue
    }

    // node:test also takes an options object: test('x', { skip: true }, fn).
    if (hasSkipOption(code, chain.callAt)) status = 'skipped'

    const raw = source.slice(i + 1, Math.max(i + 1, end - 1))
    const name = decodeLiteral(raw)
    const dynamic = quote === '`' && /\$\{/.test(raw)
    tests.push({ name, claim: parseClaimTag(name), status, line, path, dynamic })
    TEST_FN.lastIndex = Math.max(TEST_FN.lastIndex, end)
  }

  return { path, tests }
}
