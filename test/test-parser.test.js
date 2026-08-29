import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseClaimTag, parseTestSource } from '../src/lib/test-parser.js'

const names = (src) => parseTestSource(src).tests.map((t) => t.name)
const claims = (src) => parseTestSource(src).tests.map((t) => t.claim)

test('parseClaimTag accepts the documented forms', () => {
  assert.equal(parseClaimTag('C1: does a thing'), 'C1')
  assert.equal(parseClaimTag('[C2] does a thing'), 'C2')
  assert.equal(parseClaimTag('C3 - does a thing'), 'C3')
  assert.equal(parseClaimTag('C4 — does a thing'), 'C4')
  assert.equal(parseClaimTag('c5: lowercase is fine'), 'C5')
  assert.equal(parseClaimTag('  C6: leading space'), 'C6')
})

test('parseClaimTag normalises padded numbers', () => {
  assert.equal(parseClaimTag('C007: padded'), 'C7')
  assert.equal(parseClaimTag('[ C08 ] padded'), 'C8')
})

test('parseClaimTag rejects names that only look tagged', () => {
  assert.equal(parseClaimTag('C3PO: renders'), null)
  assert.equal(parseClaimTag('Calculates 3: the total'), null)
  assert.equal(parseClaimTag('renders C1: late'), null)
  assert.equal(parseClaimTag('C1'), null)
  assert.equal(parseClaimTag(''), null)
  assert.equal(parseClaimTag(null), null)
})

test('parseTestSource finds test() and it() with either quote style', () => {
  const src = [
    `test('C1: one', () => {})`,
    `it("C2: two", () => {})`,
    'it(`C3: three`, () => {})',
  ].join('\n')
  assert.deepEqual(claims(src), ['C1', 'C2', 'C3'])
})

test('parseTestSource records 1-based line numbers', () => {
  const src = ['', `test('C1: one', () => {})`, '', `test('C2: two', () => {})`].join('\n')
  assert.deepEqual(
    parseTestSource(src).tests.map((t) => t.line),
    [2, 4],
  )
})

test('parseTestSource ignores commented-out tests', () => {
  const src = [
    `// test('C1: line comment', () => {})`,
    `/* test('C2: block comment', () => {}) */`,
    `test('C3: real', () => {})`,
  ].join('\n')
  assert.deepEqual(names(src), ['C3: real'])
})

test('parseTestSource ignores test calls quoted inside other strings', () => {
  const src = [
    `const doc = 'write test("C1: fake") here'`,
    `test('C2: real', () => {})`,
  ].join('\n')
  assert.deepEqual(names(src), ['C2: real'])
})

test('parseTestSource ignores identifiers that merely end in test/it', () => {
  const src = [
    `submit('not a test', 1)`,
    `unit('also not', 2)`,
    `helpers.test('method call', 3)`,
    `test('C1: real', () => {})`,
  ].join('\n')
  assert.deepEqual(names(src), ['C1: real'])
})

test('parseTestSource understands modifiers and marks skips', () => {
  const src = [
    `test.only('C1: only', () => {})`,
    `it.skip('C2: skip', () => {})`,
    `test.todo('C3: todo')`,
    `it.concurrent('C4: concurrent', () => {})`,
    `test.failing('C5: failing', () => {})`,
  ].join('\n')
  const parsed = parseTestSource(src).tests
  assert.deepEqual(parsed.map((t) => t.claim), ['C1', 'C2', 'C3', 'C4', 'C5'])
  assert.deepEqual(parsed.map((t) => t.status), ['active', 'skipped', 'skipped', 'active', 'active'])
})

test('parseTestSource handles test.each with an array and with a table', () => {
  const src = [
    `test.each([1, 2, 3])('C1: each %i', (n) => {})`,
    'it.each`\n  a | b\n  ${1} | ${2}\n`("C2: table", ({ a, b }) => {})',
    `test.each([{ a: ')' }])('C3: paren in data', () => {})`,
  ].join('\n')
  assert.deepEqual(claims(src), ['C1', 'C2', 'C3'])
})

test('parseTestSource keeps chained modifiers', () => {
  const src = `it.skip.each([1])('C1: chained', () => {})`
  const parsed = parseTestSource(src).tests
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].claim, 'C1')
  assert.equal(parsed[0].status, 'skipped')
})

test('parseTestSource records a dynamic name it cannot read', () => {
  const src = [`const name = 'x'`, `test(name, () => {})`].join('\n')
  const parsed = parseTestSource(src).tests
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].name, null)
  assert.equal(parsed[0].dynamic, true)
  assert.equal(parsed[0].claim, null)
})

test('parseTestSource still reads the claim from an interpolated template name', () => {
  const src = 'test(`C1: renders ${variant}`, () => {})'
  const parsed = parseTestSource(src).tests
  assert.equal(parsed[0].claim, 'C1')
  assert.equal(parsed[0].dynamic, true)
})

test('parseTestSource decodes escapes in the name', () => {
  const src = `test('C1: it\\'s escaped', () => {})`
  assert.deepEqual(names(src), ["C1: it's escaped"])
})

test('parseTestSource tolerates whitespace and comments inside the call', () => {
  const src = `test (\n  /* why */ 'C1: spaced'\n , () => {})`
  assert.deepEqual(claims(src), ['C1'])
})

test('parseTestSource finds tests nested inside describe blocks', () => {
  const src = [
    `describe('Toast', () => {`,
    `  test('C1: one', () => {})`,
    `  describe('when open', () => {`,
    `    it('C2: two', () => {})`,
    `  })`,
    `})`,
  ].join('\n')
  assert.deepEqual(claims(src), ['C1', 'C2'])
})

test('parseTestSource does not treat describe names as tests', () => {
  const src = [`describe('C1: not a test', () => {`, `  it('C2: real', () => {})`, `})`].join('\n')
  assert.deepEqual(names(src), ['C2: real'])
})

test('parseTestSource handles a TypeScript type argument on the call', () => {
  const src = `test<Ctx>('C1: typed', () => {})`
  assert.deepEqual(claims(src), ['C1'])
})

test('parseTestSource attaches the file path to each test', () => {
  const parsed = parseTestSource(`test('C1: x', () => {})`, 'blocks/A/A.test.js')
  assert.equal(parsed.path, 'blocks/A/A.test.js')
  assert.equal(parsed.tests[0].path, 'blocks/A/A.test.js')
})

test('parseTestSource returns nothing for a file with no tests', () => {
  assert.deepEqual(parseTestSource('export const a = 1\n').tests, [])
})

test('a regex literal containing a test call is not a test', () => {
  const src = [String.raw`const re = /it\('C9: fake'\)/`, "test('C2: real', () => {})"].join('\n')
  assert.deepEqual(names(src), ['C2: real'])
})

test('a regex whose body would parse as a call is not a test', () => {
  assert.deepEqual(names(String.raw`const re = /[it('C9: fake')]/`), [])
})

test('JSX text is not mistaken for a test declaration', () => {
  const src = [`render(<p>it ('C9: fake')</p>)`, "test('C1: real', () => {})"].join('\n')
  assert.deepEqual(names(src), ['C1: real'])
})

test('the concise arrow form is still a test', () => {
  const src = `describe('Toast', () => it('C1: concise', () => {}))`
  assert.deepEqual(claims(src), ['C1'])
})

test('node:test subtests on the context object count', () => {
  const src = [
    "test('C1: parent', async (t) => {",
    "  await t.test('C2: child', () => {})",
    "  await t.test('C3: sibling', () => {})",
    '})',
  ].join('\n')
  assert.deepEqual(claims(src), ['C1', 'C2', 'C3'])
})

test('a regex .test(str) call is not mistaken for a subtest', () => {
  const src = ["const t = /x/", "if (t.test('C1: not a test')) {}", "test('C2: real', () => {})"].join('\n')
  assert.deepEqual(names(src), ['C2: real'])
})

test("node:test's options object marks a test skipped", () => {
  const src = [
    "test('C1: skipped', { skip: true }, () => {})",
    "test('C2: reasoned', { skip: 'flaky' }, () => {})",
    "test('C3: todo', { todo: true }, () => {})",
    "test('C4: running', { concurrency: 2 }, () => {})",
    "test('C5: explicitly not skipped', { skip: false }, () => {})",
  ].join('\n')
  assert.deepEqual(
    parseTestSource(src).tests.map((t) => t.status),
    ['skipped', 'skipped', 'skipped', 'active', 'active'],
  )
})

test('tests inside a skipped describe are skipped', () => {
  const src = [
    "describe.skip('when closed', () => {",
    "  it('C1: inner', () => {})",
    '})',
    "describe('when open', () => {",
    "  it('C2: outer', () => {})",
    '})',
    "xdescribe('legacy', () => {",
    "  it('C3: legacy', () => {})",
    '})',
  ].join('\n')
  assert.deepEqual(
    parseTestSource(src).tests.map((t) => [t.claim, t.status]),
    [['C1', 'skipped'], ['C2', 'active'], ['C3', 'skipped']],
  )
})

test('jest xit and xtest are skipped, fit is not', () => {
  const src = ["xit('C1: x', () => {})", "xtest('C2: x', () => {})", "fit('C3: x', () => {})"].join('\n')
  assert.deepEqual(
    parseTestSource(src).tests.map((t) => [t.claim, t.status]),
    [['C1', 'skipped'], ['C2', 'skipped'], ['C3', 'active']],
  )
})

test('an identifier merely ending in fit or xit is not a test', () => {
  const src = ["benefit('not a test', 1)", "audit('nor this', 2)", "test('C1: real', () => {})"].join('\n')
  assert.deepEqual(names(src), ['C1: real'])
})

test('a generic type argument containing an object type does not drop the test', () => {
  const src = "it<{ ctx: string }>('C1: typed', () => {})"
  assert.deepEqual(claims(src), ['C1'])
})

test('a multi-line generic type argument does not drop the test', () => {
  const src = ['it<{', '  ctx: string', "}>('C1: typed', () => {})"].join('\n')
  assert.deepEqual(claims(src), ['C1'])
})
