// Regressions found by review passes over this CLI. Each test names the shape
// that broke, so a future change that reintroduces it fails loudly.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { blockForFile } from '../src/lib/blocks.js'
import { findBlocksDirForFile, findRootWithBlocks } from '../src/lib/paths.js'
import { parseSpec } from '../src/lib/spec-parser.js'
import { parseTestSource } from '../src/lib/test-parser.js'
import { cleanup, makeRepo, runCli, spec, testFile } from './helpers.js'

const claims = (src) => parseTestSource(src).tests.map((t) => t.claim)
const statuses = (src) => parseTestSource(src).tests.map((t) => [t.claim, t.status])

function repo(t, files) {
  const root = makeRepo(files)
  t.after(() => cleanup(root))
  return root
}

// --- the JSX guard must not eat real tests -------------------------------

test('a statement ending in > on the previous line does not hide the next test', () => {
  // Semicolon-free React test files end statements with `>` all the time.
  const src = [
    `const Wrapper = ({ children }) => <div>{children}</div>`,
    `it('C1: renders nothing when empty', () => {})`,
    ``,
    `const ui = <Toast />`,
    `test('C2: calls onDismiss once', () => {})`,
    ``,
    `type Props = Record<string, unknown>`,
    `it('C3: restores focus', () => {})`,
  ].join('\n')
  assert.deepEqual(claims(src), ['C1', 'C2', 'C3'])
})

test('same-line JSX text is still not a test', () => {
  assert.deepEqual(claims(`render(<p>it ('C9: fake')</p>)`), [])
})

test('a semicolon-free file is not treated differently from a semicolon-ed one', () => {
  const withSemis = `const ui = <Toast />;\ntest('C1: x', () => {})`
  const without = `const ui = <Toast />\ntest('C1: x', () => {})`
  assert.deepEqual(claims(withSemis), claims(without))
})

// --- skipped suites and options objects ----------------------------------

test('a suite skipped through its options object skips its tests', () => {
  const src = [
    `describe('Toast', { skip: true }, () => {`,
    `  it('C1: inner', () => {})`,
    `})`,
    `describe('Icon', { todo: true }, () => {`,
    `  it('C2: inner', () => {})`,
    `})`,
    `describe('Real', { concurrency: 2 }, () => {`,
    `  it('C3: inner', () => {})`,
    `})`,
    `describe('Explicit', { skip: false }, () => {`,
    `  it('C4: inner', () => {})`,
    `})`,
  ].join('\n')
  assert.deepEqual(statuses(src), [
    ['C1', 'skipped'],
    ['C2', 'skipped'],
    ['C3', 'active'],
    ['C4', 'active'],
  ])
})

test('a skipped suite does not satisfy its claim end to end', (t) => {
  const root = repo(t, {
    'package.json': '{"name":"d"}\n',
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': `describe('Toast', { skip: true }, () => {\n  it('C1: one', () => {})\n})\n`,
  })
  const result = runCli(['check', '--root', root])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /C1 is only covered by a skipped test/)
})

// --- generics on modifiers -----------------------------------------------

test('test.each with type arguments keeps its name', () => {
  const src = `test.each<Case>([1, 2])('C1: each %i', () => {})`
  assert.deepEqual(claims(src), ['C1'])
  assert.equal(parseTestSource(src).tests[0].dynamic, false)
})

test('describe.skip.each with type arguments still skips its tests', () => {
  const src = [
    `describe.skip.each<Case>([1])('group %i', () => {`,
    `  it('C1: inner', () => {})`,
    `})`,
  ].join('\n')
  assert.deepEqual(statuses(src), [['C1', 'skipped']])
})

test('a function type in the type arguments does not drop the test', () => {
  assert.deepEqual(claims(`it<(a: string) => void>('C1: typed', () => {})`), ['C1'])
})

// --- spec tables ---------------------------------------------------------

test('claims split across subheadings are all read', () => {
  const md = [
    '## Contract summary',
    '',
    '### Rendering',
    '',
    '| # | Claim |',
    '|---|-------|',
    '| 1 | First. |',
    '',
    '### Accessibility',
    '',
    '| # | Claim |',
    '|---|-------|',
    '| 2 | Second. |',
    '| 3 | Third. |',
  ].join('\n')
  const parsed = parseSpec(md)
  assert.deepEqual(parsed.claims.map((c) => c.id), ['C1', 'C2', 'C3'])
  assert.deepEqual(parsed.problems, [])
})

test('a claim repeated across two tables is still a duplicate', () => {
  const md = [
    '## Contract summary',
    '',
    '| # | Claim |',
    '|---|-------|',
    '| 1 | First. |',
    '',
    '### More',
    '',
    '| # | Claim |',
    '|---|-------|',
    '| 1 | Again. |',
  ].join('\n')
  assert.deepEqual(parseSpec(md).problems.map((p) => p.kind), ['duplicate-claim'])
})

// --- path boundaries -----------------------------------------------------

test('a package.json inside blocks/ does not switch the gate off', (t) => {
  const root = repo(t, {
    'package.json': '{"name":"outer"}\n',
    'blocks/Toast/package.json': '{"name":"toast"}\n',
    'blocks/Toast/Toast.spec.md': spec(['One.', 'Two.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
  })
  const file = join(root, 'blocks', 'Toast', 'Toast.test.js')
  assert.equal(findBlocksDirForFile(file), join(root, 'blocks'))

  const gated = runCli(['gate', file])
  const checked = runCli(['check', '--root', root])
  assert.equal(gated.status, 2, 'gate must not go quiet')
  assert.equal(checked.status, 1)
})

test('a repo living under a directory named blocks is left alone', (t) => {
  const outer = repo(t, {
    'blocks/myrepo/package.json': '{"name":"myrepo"}\n',
    'blocks/myrepo/src/app.ts': 'export const x = 1\n',
  })
  const file = join(outer, 'blocks', 'myrepo', 'src', 'app.ts')
  assert.equal(findBlocksDirForFile(file), null)
  assert.equal(runCli(['gate', file]).status, 0)
})

test('findRootWithBlocks treats a .git file as a boundary, not just a directory', (t) => {
  const root = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'worktree/.git': 'gitdir: /somewhere/.git/worktrees/wt\n',
    'worktree/src/app.ts': '',
  })
  assert.equal(findRootWithBlocks(join(root, 'worktree', 'src')), null)
})

// --- ignored directories -------------------------------------------------

test('gate and check both ignore build output under blocks/', (t) => {
  const root = repo(t, {
    'package.json': '{"name":"d"}\n',
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
    'blocks/dist/bundle.js': 'export const x = 1\n',
    'blocks/.cache/tmp.js': 'export const y = 1\n',
  })
  const checked = runCli(['check', '--root', root])
  assert.equal(checked.status, 0, checked.stdout)

  for (const stray of [['dist', 'bundle.js'], ['.cache', 'tmp.js']]) {
    const result = runCli(['gate', join(root, 'blocks', ...stray)])
    assert.equal(result.status, 0, `gate should ignore blocks/${stray.join('/')}`)
    assert.equal(result.stderr, '')
  }
})

test('blockForFile ignores paths that run through an ignored directory', (t) => {
  const root = repo(t, {
    'blocks/dist/Toast/Toast.spec.md': spec(['One.']),
    'blocks/dist/Toast/Toast.tsx': '',
  })
  const blocksDir = join(root, 'blocks')
  assert.deepEqual(blockForFile(join(blocksDir, 'dist', 'Toast', 'Toast.tsx'), blocksDir), {
    block: null,
    candidateDir: null,
  })
})

// --- the gate must never hang --------------------------------------------

test('gate returns promptly when stdin is left open', async (t) => {
  const { spawn } = await import('node:child_process')
  const { BIN } = await import('./helpers.js')
  const root = repo(t, {
    'package.json': '{"name":"d"}\n',
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
  })

  const started = process.hrtime.bigint()
  const child = spawn(process.execPath, [BIN, 'gate', '--stdin-timeout', '200'], { cwd: root })
  // Never write, never end: the hook payload that does not arrive.
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('gate did not exit within 5s of an open stdin'))
    }, 5000)
    child.on('exit', (c) => {
      clearTimeout(timer)
      resolve(c)
    })
  })
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

  assert.equal(code, 0)
  assert.ok(elapsedMs < 4000, `gate took ${Math.round(elapsedMs)}ms`)
})
