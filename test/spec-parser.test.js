import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseClaimId, parseSpec, splitRow } from '../src/lib/spec-parser.js'

const ids = (md) => parseSpec(md).claims.map((c) => c.id)
const kinds = (md) => parseSpec(md).problems.map((p) => p.kind)

const TABLE = ['| # | Claim | Notes |', '|---|-------|-------|', '| 1 | First claim. | |', '| 2 | Second claim. | |']

test('splitRow trims cells and drops the outer pipes', () => {
  assert.deepEqual(splitRow('| 1 | a claim | notes |'), ['1', 'a claim', 'notes'])
  assert.deepEqual(splitRow('1 | a claim'), ['1', 'a claim'])
})

test('splitRow honours escaped pipes', () => {
  assert.deepEqual(splitRow('| 1 | a \\| b | |'), ['1', 'a | b', ''])
})

test('parseClaimId accepts the documented id forms', () => {
  assert.equal(parseClaimId('1'), 'C1')
  assert.equal(parseClaimId('C1'), 'C1')
  assert.equal(parseClaimId('c1'), 'C1')
  assert.equal(parseClaimId('[C1]'), 'C1')
  assert.equal(parseClaimId('**C1**'), 'C1')
  assert.equal(parseClaimId('`C1`'), 'C1')
  assert.equal(parseClaimId('1.'), 'C1')
  assert.equal(parseClaimId('007'), 'C7')
})

test('parseClaimId rejects anything else', () => {
  assert.equal(parseClaimId('one'), null)
  assert.equal(parseClaimId('C1a'), null)
  assert.equal(parseClaimId(''), null)
  assert.equal(parseClaimId(undefined), null)
})

test('parseSpec reads the claims under a contract summary heading', () => {
  const md = ['# Block', '', '## Contract summary', '', ...TABLE, ''].join('\n')
  const parsed = parseSpec(md)
  assert.deepEqual(parsed.claims.map((c) => c.id), ['C1', 'C2'])
  assert.equal(parsed.claims[0].text, 'First claim.')
  assert.equal(parsed.problems.length, 0)
})

test('parseSpec records the line each claim is on', () => {
  const md = ['# Block', '', '## Contract summary', '', ...TABLE].join('\n')
  assert.deepEqual(parseSpec(md).claims.map((c) => c.line), [7, 8])
})

test('parseSpec accepts heading variations', () => {
  for (const heading of ['## Contract summary', '### Contract Summary', '## 9. Contract summary', '## Contract summary (numbered)']) {
    const md = ['# Block', '', heading, '', ...TABLE].join('\n')
    assert.deepEqual(ids(md), ['C1', 'C2'], heading)
  }
})

test('parseSpec falls back to a plain "Contract" heading', () => {
  const md = ['# Block', '', '## The contract', '', ...TABLE].join('\n')
  assert.deepEqual(ids(md), ['C1', 'C2'])
})

test('parseSpec prefers the summary heading over an earlier contract heading', () => {
  const md = [
    '## Contract notes',
    '',
    '| # | Claim |',
    '|---|-------|',
    '| 9 | wrong table |',
    '',
    '## Contract summary',
    '',
    ...TABLE,
  ].join('\n')
  assert.deepEqual(ids(md), ['C1', 'C2'])
})

test('parseSpec ignores a heading inside a fenced code block', () => {
  const md = [
    '# Block',
    '',
    '```markdown',
    '## Contract summary',
    '',
    '| # | Claim |',
    '|---|-------|',
    '| 9 | example from the docs |',
    '```',
    '',
    '## Contract summary',
    '',
    ...TABLE,
  ].join('\n')
  assert.deepEqual(ids(md), ['C1', 'C2'])
})

test('parseSpec skips a fenced example between the heading and the real table', () => {
  const md = [
    '## Contract summary',
    '',
    '```',
    '| 9 | not the table |',
    '```',
    '',
    ...TABLE,
  ].join('\n')
  assert.deepEqual(ids(md), ['C1', 'C2'])
})

test('parseSpec accepts C-prefixed ids in the table', () => {
  const md = ['## Contract summary', '', '| # | Claim |', '|---|-------|', '| C1 | a |', '| C2 | b |'].join('\n')
  assert.deepEqual(ids(md), ['C1', 'C2'])
})

test('parseSpec finds the id column when it is not first', () => {
  const md = ['## Contract summary', '', '| Claim | # |', '|-------|---|', '| does a thing | 1 |', '| does another | 2 |'].join('\n')
  const parsed = parseSpec(md)
  assert.deepEqual(parsed.claims.map((c) => c.id), ['C1', 'C2'])
  assert.equal(parsed.claims[0].text, 'does a thing')
})

test('parseSpec reports a missing heading', () => {
  assert.deepEqual(kinds('# Block\n\n## Purpose\n\nNothing here.\n'), ['no-contract-heading'])
})

test('parseSpec reports a heading with no table', () => {
  const md = ['## Contract summary', '', 'Coming soon.', '', '## Next section'].join('\n')
  assert.deepEqual(kinds(md), ['no-contract-table'])
})

test('parseSpec reports a table with a header but no rows', () => {
  const md = ['## Contract summary', '', '| # | Claim |', '|---|-------|'].join('\n')
  assert.deepEqual(kinds(md), ['empty-contract-table'])
})

test('parseSpec reports duplicate claim ids', () => {
  const md = ['## Contract summary', '', '| # | Claim |', '|---|-------|', '| 1 | a |', '| 1 | b |'].join('\n')
  const parsed = parseSpec(md)
  assert.deepEqual(parsed.claims.map((c) => c.id), ['C1'])
  assert.deepEqual(parsed.problems.map((p) => p.kind), ['duplicate-claim'])
})

test('parseSpec reports an unparseable id instead of silently dropping the row', () => {
  const md = ['## Contract summary', '', '| # | Claim |', '|---|-------|', '| one | a |', '| 2 | b |'].join('\n')
  const parsed = parseSpec(md)
  assert.deepEqual(parsed.claims.map((c) => c.id), ['C2'])
  assert.deepEqual(parsed.problems.map((p) => p.kind), ['invalid-claim-id'])
})

test('parseSpec stops at the end of the table', () => {
  const md = ['## Contract summary', '', ...TABLE, '', 'Some trailing prose.', '', '| 3 | a later table |'].join('\n')
  assert.deepEqual(ids(md), ['C1', 'C2'])
})

test('parseSpec handles a table without outer pipes on the divider', () => {
  const md = ['## Contract summary', '', '| # | Claim |', '|---|:------|', '| 1 | a |'].join('\n')
  assert.deepEqual(ids(md), ['C1'])
})

test('parseSpec collapses whitespace in the claim text', () => {
  const md = ['## Contract summary', '', '| # | Claim |', '|---|-------|', '| 1 |   spaced   out   |'].join('\n')
  assert.equal(parseSpec(md).claims[0].text, 'spaced out')
})

test('parseSpec handles CRLF line endings', () => {
  const md = ['## Contract summary', '', ...TABLE].join('\r\n')
  assert.deepEqual(ids(md), ['C1', 'C2'])
})

test('parseSpec on empty input reports a missing heading rather than throwing', () => {
  assert.deepEqual(kinds(''), ['no-contract-heading'])
  assert.deepEqual(kinds(null), ['no-contract-heading'])
})

test('parseSpec finds a table that sits under a subheading', () => {
  const md = ['## Contract summary', '', '### Rendering', '', ...TABLE].join('\n')
  assert.deepEqual(ids(md), ['C1', 'C2'])
})

test('parseSpec stops at a sibling heading', () => {
  const md = ['## Contract summary', '', 'Nothing yet.', '', '## Notes', '', ...TABLE].join('\n')
  assert.deepEqual(kinds(md), ['no-contract-table'])
})

test('parseSpec reads a table written without outer pipes', () => {
  // A leading `# ` would be a markdown heading, so an outer-pipe-less table
  // has to name its id column something else.
  const md = ['## Contract summary', '', 'ID | Claim', '---|------', '1 | First claim.', '2 | Second claim.'].join('\n')
  const parsed = parseSpec(md)
  assert.deepEqual(parsed.claims.map((c) => c.id), ['C1', 'C2'])
  assert.equal(parsed.claims[0].text, 'First claim.')
})

test('parseSpec does not absorb prose that merely contains a pipe', () => {
  const md = ['## Contract summary', '', ...TABLE, '', 'Prose with a | pipe in it.'].join('\n')
  const parsed = parseSpec(md)
  assert.deepEqual(parsed.claims.map((c) => c.id), ['C1', 'C2'])
  assert.deepEqual(parsed.problems, [])
})

test('parseSpec ignores an indented table-looking line with no divider', () => {
  const md = ['## Contract summary', '', '| not | a | table |', '', ...TABLE].join('\n')
  assert.deepEqual(ids(md), ['C1', 'C2'])
})
