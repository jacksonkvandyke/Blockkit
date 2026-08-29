import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canStartRegex, decodeLiteral, lineAt, lineIndex, maskLiterals, skipRegex, skipString, skipTemplate, stripComments } from '../src/lib/scan.js'

test('stripComments blanks line comments but keeps length and newlines', () => {
  const src = 'const a = 1 // trailing\nconst b = 2\n'
  const out = stripComments(src)
  assert.equal(out.length, src.length)
  assert.equal(out, 'const a = 1            \nconst b = 2\n')
})

test('stripComments blanks block comments across lines, preserving line count', () => {
  const src = 'a\n/* one\n   two */\nb\n'
  const out = stripComments(src)
  assert.equal(out.split('\n').length, src.split('\n').length)
  assert.equal(out.trim().split('\n')[0], 'a')
  assert.match(out, /\nb\n$/)
  assert.ok(!out.includes('one'))
})

test('stripComments leaves comment-like text inside strings alone', () => {
  const src = `const url = 'https://example.com/x' // real comment\n`
  const out = stripComments(src)
  assert.ok(out.includes(`'https://example.com/x'`))
  assert.ok(!out.includes('real comment'))
})

test('stripComments survives a regex literal containing a double slash', () => {
  const src = 'const re = /https:\\/\\//\nconst after = 1\n'
  const out = stripComments(src)
  assert.ok(out.includes('const after = 1'), 'code after the regex must survive')
})

test('stripComments treats division as division, not a regex', () => {
  const src = 'const half = total / 2 // halve\nconst next = 3\n'
  const out = stripComments(src)
  assert.ok(out.includes('const next = 3'))
  assert.ok(!out.includes('halve'))
})

test('stripComments handles a template literal containing a comment marker', () => {
  const src = 'const t = `a // b ${x} c`\nconst after = 1\n'
  const out = stripComments(src)
  assert.ok(out.includes('a // b'), 'template contents are untouched')
  assert.ok(out.includes('const after = 1'))
})

test('stripComments handles nested template literals inside interpolation', () => {
  const src = 'const t = `outer ${`inner ${1}`} end` // gone\nconst after = 1\n'
  const out = stripComments(src)
  assert.ok(out.includes('inner'))
  assert.ok(!out.includes('gone'))
  assert.ok(out.includes('const after = 1'))
})

test('stripComments handles an escaped quote inside a string', () => {
  const src = `const s = 'it\\'s fine' // gone\nconst after = 1\n`
  const out = stripComments(src)
  assert.ok(!out.includes('gone'))
  assert.ok(out.includes('const after = 1'))
})

test('stripComments does not run off the end of an unterminated block comment', () => {
  const out = stripComments('a\n/* never closed\n')
  assert.equal(out.length, 'a\n/* never closed\n'.length)
})

test('maskLiterals blanks literal bodies but keeps the delimiters and offsets', () => {
  const src = `const s = 'it("hidden")'\ntest('real', () => {})\n`
  const masked = maskLiterals(src)
  assert.equal(masked.length, src.length)
  assert.ok(!masked.includes('hidden'), 'string bodies are blanked')
  assert.ok(masked.includes(`''`) === false, 'delimiters stay in place, separated by spaces')
  assert.equal(masked[10], `'`)
  assert.equal(src.indexOf(`test(`), masked.indexOf(`test(`))
})

test('skipString stops at the closing quote and honours escapes', () => {
  const src = `'a\\'b' rest`
  assert.equal(skipString(src, 0), 6)
  assert.equal(src.slice(6), ' rest')
})

test('skipString bails at a newline rather than swallowing the file', () => {
  const src = `'unterminated\nnext`
  assert.equal(skipString(src, 0), src.indexOf('\n'))
})

test('skipTemplate walks past nested interpolation', () => {
  const src = '`a ${ { b: `c` } } d` after'
  assert.equal(src.slice(skipTemplate(src, 0)), ' after')
})

test('canStartRegex distinguishes regex from division', () => {
  assert.equal(canStartRegex('x = /a/', 4), true)
  assert.equal(canStartRegex('return /a/', 7), true)
  assert.equal(canStartRegex('a / b', 2), false)
  assert.equal(canStartRegex('f() / 2', 4), false)
  assert.equal(canStartRegex('xs[0] / 2', 6), false)
})

test('skipRegex handles character classes containing a slash', () => {
  const src = '/[/]a/x rest'
  assert.equal(src.slice(skipRegex(src, 0)), ' rest')
})

test('skipRegex refuses a multi-line "regex"', () => {
  assert.equal(skipRegex('/a\nb/', 0), -1)
})

test('lineAt maps offsets to 1-based lines', () => {
  const src = 'a\nbb\nccc\n'
  const starts = lineIndex(src)
  assert.equal(lineAt(starts, 0), 1)
  assert.equal(lineAt(starts, 2), 2)
  assert.equal(lineAt(starts, 5), 3)
  assert.equal(lineAt(starts, src.length - 1), 3)
})

test('decodeLiteral resolves escape sequences', () => {
  assert.equal(decodeLiteral('plain'), 'plain')
  assert.equal(decodeLiteral("it\\'s"), "it's")
  assert.equal(decodeLiteral('a\\nb'), 'a\nb')
  assert.equal(decodeLiteral('\\u0043\\u0031'), 'C1')
  assert.equal(decodeLiteral('\\x43'), 'C')
  assert.equal(decodeLiteral('\\u{1F600}'), '\u{1F600}')
  assert.equal(decodeLiteral('a\\\nb'), 'ab')
})
