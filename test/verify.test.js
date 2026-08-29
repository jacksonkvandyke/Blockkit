import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { discoverBlocks } from '../src/lib/blocks.js'
import { verifyBlock, verifyBlocks } from '../src/lib/verify.js'
import { cleanup, makeRepo, spec, testFile } from './helpers.js'

/** Build a repo, discover its blocks, verify them all. */
function verifyRepo(t, files, options) {
  const root = makeRepo(files)
  t.after(() => cleanup(root))
  const { blocks, orphans } = discoverBlocks(join(root, 'blocks'))
  return { root, blocks, orphans, results: verifyBlocks(blocks, options) }
}

function only(t, files, options) {
  const { results } = verifyRepo(t, files, options)
  assert.equal(results.length, 1, 'expected exactly one block')
  return results[0]
}

const kinds = (result) => result.problems.map((p) => p.kind)

test('a block whose claims and tests correspond one to one passes', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['Renders nothing when empty.', 'Calls onDismiss once.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: renders nothing when empty', 'C2: calls onDismiss once']),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.claims.map((c) => c.id), ['C1', 'C2'])
})

test('order does not matter', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.', 'Two.', 'Three.']),
    'blocks/Toast/Toast.test.js': testFile(['C3: three', 'C1: one', 'C2: two']),
  })
  assert.equal(result.ok, true)
})

test('a claim with no test is reported by id', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.', 'Two.', 'Three.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one', 'C3: three']),
  })
  assert.equal(result.ok, false)
  const missing = result.problems.filter((p) => p.kind === 'claim-without-test')
  assert.deepEqual(missing.map((p) => p.claimId), ['C2'])
  assert.equal(missing[0].claim.text, 'Two.')
})

test('a test with no claim is reported with its file and line', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one', 'renders an icon']),
  })
  assert.equal(result.ok, false)
  const extra = result.problems.filter((p) => p.kind === 'test-without-claim')
  assert.equal(extra.length, 1)
  assert.equal(extra[0].test.name, 'renders an icon')
  assert.equal(extra[0].line, 4)
  assert.match(extra[0].path, /Toast\.test\.js$/)
})

test('both directions are reported at once', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.', 'Two.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one', 'stray']),
  })
  assert.deepEqual(kinds(result).sort(), ['claim-without-test', 'test-without-claim'])
})

test('a test naming a claim the spec does not list is reported', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one', 'C9: from an older spec']),
  })
  const unknown = result.problems.filter((p) => p.kind === 'unknown-claim')
  assert.equal(unknown.length, 1)
  assert.equal(unknown[0].claimId, 'C9')
})

test('two tests claiming the same id is a mismatch', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one way', 'C1: another way']),
  })
  const dupes = result.problems.filter((p) => p.kind === 'duplicate-test')
  assert.equal(dupes.length, 1)
  assert.equal(dupes[0].claimId, 'C1')
  assert.equal(dupes[0].tests.length, 2)
})

test('a skipped test does not prove its claim unless allowed', (t) => {
  const files = {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': `import { test } from 'node:test'\ntest.skip('C1: one', () => {})\n`,
  }
  assert.deepEqual(kinds(only(t, files)), ['skipped-test'])
  assert.equal(only(t, files, { allowSkipped: true }).ok, true)
})

test('a block with no test file reports every claim as untested', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.', 'Two.']),
    'blocks/Toast/Toast.tsx': 'export const Toast = () => null\n',
  })
  assert.ok(kinds(result).includes('missing-test-file'))
  assert.deepEqual(
    result.problems.filter((p) => p.kind === 'claim-without-test').map((p) => p.claimId),
    ['C1', 'C2'],
  )
})

test('a spec with no contract summary is reported and stops there', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': '# Toast\n\n## Purpose\n\nA thing.\n',
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
  })
  assert.deepEqual(kinds(result), ['no-contract-heading'])
})

test('a block with two spec files is reported', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Legacy.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
  })
  assert.ok(kinds(result).includes('multiple-specs'))
})

test('a block with no spec is reported as missing, not silently skipped', () => {
  const result = verifyBlock({ id: 'Toast', dir: '/nowhere/blocks/Toast', specPaths: [], testPaths: [] })
  assert.equal(result.ok, false)
  assert.deepEqual(kinds(result), ['missing-spec'])
})

test('tests may be spread across several files in the block', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.', 'Two.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
    'blocks/Toast/Toast.a11y.test.js': testFile(['C2: two']),
  })
  assert.equal(result.ok, true)
  assert.equal(result.testPaths.length, 2)
})

test('tests in a __tests__ directory count', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/__tests__/toast.js': testFile(['C1: one']),
  })
  assert.equal(result.ok, true)
})

test('a nested block keeps its own tests', (t) => {
  const { results } = verifyRepo(t, {
    'blocks/Toast/Toast.spec.md': spec(['Outer.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: outer']),
    'blocks/Toast/Icon/Icon.spec.md': spec(['Inner.']),
    'blocks/Toast/Icon/Icon.test.js': testFile(['C1: inner']),
  })
  assert.deepEqual(results.map((r) => r.id), ['Toast', 'Toast/Icon'])
  assert.ok(results.every((r) => r.ok))
  assert.equal(results[0].testPaths.length, 1)
})

test('a commented-out test does not satisfy a claim', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': `// test('C1: one', () => {})\n`,
  })
  assert.deepEqual(
    result.problems.filter((p) => p.kind === 'claim-without-test').map((p) => p.claimId),
    ['C1'],
  )
})

test('a test whose name is a variable is reported rather than ignored', (t) => {
  const result = only(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': `import { test } from 'node:test'\nconst n = 'C1: one'\ntest(n, () => {})\n`,
  })
  assert.ok(kinds(result).includes('unreadable-test-name'))
  assert.ok(kinds(result).includes('claim-without-test'))
})

test('verifyBlocks verifies each block independently', (t) => {
  const { results } = verifyRepo(t, {
    'blocks/A/A.spec.md': spec(['One.']),
    'blocks/A/A.test.js': testFile(['C1: one']),
    'blocks/B/B.spec.md': spec(['One.']),
    'blocks/B/B.test.js': testFile(['nothing claimed']),
  })
  assert.deepEqual(results.map((r) => [r.id, r.ok]), [['A', true], ['B', false]])
})
