// A very small JavaScript/TypeScript source scanner.
//
// blockkit has no runtime dependencies, so there is no AST to walk. Everything
// we need (the names passed to `test()` / `it()`) lives in string literals, so
// the only real hazard is mistaking commented-out code for live code. This
// module removes comments while leaving every other byte — and therefore every
// offset and line number — exactly where it was.

const REGEX_OK_AFTER_PUNCT = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '~', '<', '>',
])

const REGEX_OK_AFTER_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else',
  'case', 'yield', 'await', 'throw',
])

const WORD_CHAR = /[A-Za-z0-9_$]/

/** Index just past a single- or double-quoted string starting at `i`. */
export function skipString(source, i, quote = source[i]) {
  let j = i + 1
  while (j < source.length) {
    const c = source[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === quote) return j + 1
    // An unterminated string literal cannot span a raw newline; bail out rather
    // than swallowing the rest of the file.
    if (c === '\n') return j
    j++
  }
  return j
}

/** Index just past a template literal starting at `i`, including `${...}` parts. */
export function skipTemplate(source, i) {
  let j = i + 1
  while (j < source.length) {
    const c = source[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '`') return j + 1
    if (c === '$' && source[j + 1] === '{') {
      j = skipBraced(source, j + 1)
      continue
    }
    j++
  }
  return j
}

/** Index just past the `}` matching the `{` at `i`. */
export function skipBraced(source, i) {
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
      depth++
      j++
      continue
    }
    if (c === '}') {
      depth--
      j++
      if (depth === 0) return j
      continue
    }
    j++
  }
  return j
}

/**
 * Heuristic: can a `/` at `i` begin a regex literal? Looks back at the previous
 * significant character, the way every hand-written JS lexer does.
 */
export function canStartRegex(source, i) {
  let j = i - 1
  while (j >= 0 && /\s/.test(source[j])) j--
  if (j < 0) return true
  const ch = source[j]
  if (WORD_CHAR.test(ch)) {
    let k = j
    while (k >= 0 && WORD_CHAR.test(source[k])) k--
    return REGEX_OK_AFTER_KEYWORD.has(source.slice(k + 1, j + 1))
  }
  // `)` and `]` end an expression, so a following `/` is division.
  if (ch === ')' || ch === ']') return false
  return REGEX_OK_AFTER_PUNCT.has(ch)
}

/** Index just past a regex literal starting at `i`, or -1 if it is not one. */
export function skipRegex(source, i) {
  let j = i + 1
  let inClass = false
  while (j < source.length) {
    const c = source[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '\n') return -1
    if (inClass) {
      if (c === ']') inClass = false
    } else if (c === '[') {
      inClass = true
    } else if (c === '/') {
      j++
      while (j < source.length && /[a-z]/i.test(source[j])) j++
      return j
    }
    j++
  }
  return -1
}

/**
 * Blank out comments — and optionally the interior of every string and template
 * literal — preserving newlines and total length, so that every offset in the
 * result still points at the same character in the input.
 *
 * Masking literals is what makes the test-call scanner safe: `it('x')` written
 * inside some unrelated string can never be mistaken for a test declaration.
 */
export function scanSource(source, { maskLiterals = false } = {}) {
  let out = ''
  let last = 0
  let i = 0
  const n = source.length

  const blank = (from, to) => {
    if (to <= from) return
    out += source.slice(last, from)
    out += source.slice(from, to).replace(/[^\n]/g, ' ')
    last = to
  }

  while (i < n) {
    const c = source[i]
    const next = source[i + 1]

    if (c === '/' && next === '/') {
      let j = i + 2
      while (j < n && source[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    if (c === '/' && next === '*') {
      let j = i + 2
      while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++
      j = Math.min(n, j + 2)
      blank(i, j)
      i = j
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const end = c === '`' ? skipTemplate(source, i) : skipString(source, i, c)
      // Keep the delimiters so the caller can still see where literals are.
      if (maskLiterals) blank(i + 1, Math.max(i + 1, end - 1))
      i = end
      continue
    }
    if (c === '/' && canStartRegex(source, i)) {
      const j = skipRegex(source, i)
      if (j > i) {
        // A regex body is not code either: `/it\('x'\)/` must not read as a
        // test declaration.
        if (maskLiterals) blank(i + 1, j)
        i = j
        continue
      }
    }
    i++
  }

  out += source.slice(last)
  return out
}

/**
 * Replace every comment with spaces, preserving newlines, string contents and
 * total length. The result is byte-for-byte position compatible with the input.
 */
export function stripComments(source) {
  return scanSource(source)
}

/** As `stripComments`, but literal bodies are blanked too. */
export function maskLiterals(source) {
  return scanSource(source, { maskLiterals: true })
}

/** Offsets of the start of each line, for turning indexes into line numbers. */
export function lineIndex(source) {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1)
  }
  return starts
}

/** 1-based line number for `offset`, given a `lineIndex()` table. */
export function lineAt(starts, offset) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

const SIMPLE_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }

/** Decode the escape sequences inside a string/template literal body. */
export function decodeLiteral(raw) {
  if (!raw.includes('\\')) return raw
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const e = raw[++i]
    if (e === undefined) break
    if (e === 'u') {
      if (raw[i + 1] === '{') {
        const close = raw.indexOf('}', i + 2)
        const hex = close === -1 ? '' : raw.slice(i + 2, close)
        if (/^[0-9a-f]+$/i.test(hex)) {
          out += String.fromCodePoint(parseInt(hex, 16))
          i = close
          continue
        }
      } else {
        const hex = raw.slice(i + 1, i + 5)
        if (/^[0-9a-f]{4}$/i.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16))
          i += 4
          continue
        }
      }
      out += e
      continue
    }
    if (e === 'x') {
      const hex = raw.slice(i + 1, i + 3)
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16))
        i += 2
        continue
      }
      out += e
      continue
    }
    if (e === '\n') continue // line continuation
    out += Object.prototype.hasOwnProperty.call(SIMPLE_ESCAPES, e) ? SIMPLE_ESCAPES[e] : e
  }
  return out
}
