import { lineAt, lineIndex } from './scan.js'
import { parseClaimTag } from './test-parser.js'

// xUnit and NUnit declare a test with an attribute rather than a call, so the
// shape this looks for is `[Fact…]` / `[Theory…]` / `[Test…]` followed by the
// method it decorates. The name a claim is read from is the attribute's
// DisplayName when it has one, and the method name otherwise — so both
// `[Fact(DisplayName = "C1: …")]` and `public void C1_Does_a_thing()` work.
const TEST_ATTR_RE = /\[\s*(?:[\w.]+\s*\.\s*)?(Fact|Theory|Test|TestCase)\b/g

/** `DisplayName = "…"` inside an attribute's argument list. */
const DISPLAY_NAME_RE = /\bDisplayName\s*=\s*("(?:[^"\\]|\\.)*"|@"(?:[^"]|"")*")/
/**
 * `Skip = "…"` (xUnit) or `Ignore` (NUnit) means the test does not run.
 * Ignore is looked for after a `[` or a `,`, so it is found both on its own
 * and alongside the marker in `[Test, Ignore("not yet")]`.
 */
const SKIP_RE = /\bSkip\s*=\s*("(?:[^"\\]|\\.)*"|@"(?:[^"]|"")*")/
const IGNORE_ATTR_RE = /[[,]\s*(?:[\w.]+\s*\.\s*)?Ignore\b/

/**
 * Blank out comments and string bodies so neither a commented-out test nor
 * `"[Fact]"` written inside a string is mistaken for a declaration. Verbatim
 * strings are handled separately from ordinary ones, because `@"C:\"` ends at
 * the quote where `"C:\"` would not.
 */
export function maskCSharp(source) {
  const out = source.split('')
  let i = 0

  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }

  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]

    if (c === '/' && next === '/') {
      let end = source.indexOf('\n', i)
      if (end === -1) end = source.length
      blank(i, end)
      i = end
      continue
    }

    if (c === '/' && next === '*') {
      let end = source.indexOf('*/', i + 2)
      end = end === -1 ? source.length : end + 2
      blank(i, end)
      i = end
      continue
    }

    // Verbatim: @"…" or $@"…" / @$"…". A doubled quote is an escaped quote.
    const verbatim =
      (c === '@' && next === '"') ||
      (c === '$' && next === '@' && source[i + 2] === '"') ||
      (c === '@' && next === '$' && source[i + 2] === '"')

    if (verbatim) {
      let j = source.indexOf('"', i) + 1
      while (j < source.length) {
        if (source[j] === '"') {
          if (source[j + 1] === '"') {
            j += 2
            continue
          }
          j++
          break
        }
        j++
      }
      blank(i, j)
      i = j
      continue
    }

    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2
          continue
        }
        if (source[j] === c || source[j] === '\n') {
          j++
          break
        }
        j++
      }
      blank(i, j)
      i = j
      continue
    }

    i++
  }

  return out.join('')
}

/** The index just past the `]` closing the attribute list that starts at `open`. */
function endOfAttribute(masked, open) {
  let depth = 0

  for (let i = open; i < masked.length; i++) {
    const c = masked[i]
    if (c === '[' || c === '(') depth++
    else if (c === ')') depth--
    else if (c === ']') {
      depth--
      if (depth === 0) return i + 1
    }
  }

  return -1
}

/**
 * Where the run of attributes on one method ends. A method can carry several
 * (`[Fact] [Trait(…)] [Ignore]`) and all of them speak for it, so the skip
 * check reads the whole run, not only the attribute holding the marker.
 */
function endOfAttributeRun(masked, from) {
  let i = from

  while (i < masked.length) {
    while (i < masked.length && /\s/.test(masked[i])) i++
    if (masked[i] !== '[') break
    const end = endOfAttribute(masked, i)
    if (end === -1) return -1
    i = end
  }

  return i
}

/**
 * The name of the method an attribute decorates: the identifier immediately
 * before the parameter list that follows. Further attributes and any modifiers
 * or return type in between are skipped over, because only the identifier
 * touching the `(` matters.
 */
function methodNameAfter(masked, from) {
  const i = endOfAttributeRun(masked, from)
  if (i === -1) return null

  const open = masked.indexOf('(', i)
  if (open === -1) return null

  let j = open - 1
  while (j >= 0 && /\s/.test(masked[j])) j--

  // A generic method reads `Name<T>(`; step back over the argument list.
  if (masked[j] === '>') {
    let depth = 0
    while (j >= 0) {
      if (masked[j] === '>') depth++
      else if (masked[j] === '<') {
        depth--
        if (depth === 0) {
          j--
          break
        }
      }
      j--
    }
    while (j >= 0 && /\s/.test(masked[j])) j--
  }

  const end = j + 1
  while (j >= 0 && /[\w$]/.test(masked[j])) j--
  const name = masked.slice(j + 1, end)

  return /^[A-Za-z_]\w*$/.test(name) ? name : null
}

/**
 * Extract every xUnit/NUnit test declaration from C# source.
 *
 * Returns `{ tests, path }` in the same shape as the JavaScript parser, where
 * each test is `{ name, claim, status, line, path, dynamic }`.
 */
export function parseCSharpTestSource(source, path = '<source>') {
  const masked = maskCSharp(source)
  const starts = lineIndex(masked)
  const tests = []

  TEST_ATTR_RE.lastIndex = 0
  let match

  while ((match = TEST_ATTR_RE.exec(masked)) !== null) {
    const open = masked.lastIndexOf('[', match.index)
    const close = endOfAttribute(masked, open === -1 ? match.index : open)
    if (close === -1) continue

    // Read the attribute back out of the real source: the arguments were
    // masked, and DisplayName's text is exactly what is needed.
    const attribute = source.slice(open === -1 ? match.index : open, close)
    const displayName = DISPLAY_NAME_RE.exec(attribute)
    const method = methodNameAfter(masked, close)

    const name = displayName ? decodeCSharpString(displayName[1]) : method
    if (name === null || name === undefined) continue

    // Skip is read from the whole attribute run: `[Ignore]` is often its own.
    const runEnd = endOfAttributeRun(masked, open === -1 ? match.index : open)
    const run = runEnd === -1 ? attribute : source.slice(open === -1 ? match.index : open, runEnd)
    const skipped = SKIP_RE.test(run) || IGNORE_ATTR_RE.test(run)

    tests.push({
      name,
      claim: parseClaimTag(name),
      status: skipped ? 'skipped' : 'active',
      line: lineAt(starts, match.index),
      path,
      dynamic: false,
    })

    TEST_ATTR_RE.lastIndex = close
  }

  return { tests, path }
}

/** The text of a C# string literal, ordinary or verbatim. */
function decodeCSharpString(literal) {
  if (literal.startsWith('@"')) {
    return literal.slice(2, -1).replace(/""/g, '"')
  }

  return literal
    .slice(1, -1)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(.)/g, (_, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch))
}
