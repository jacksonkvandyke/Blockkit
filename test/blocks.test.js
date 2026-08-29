import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { blockForFile, dirHasSource, discoverBlocks, isBlockDir, specFilesIn, testFilesIn } from '../src/lib/blocks.js'
import { findBlocksDirForFile, findProjectRoot, findRootWithBlocks, isUnder, relPosix } from '../src/lib/paths.js'
import { cleanup, makeRepo, spec, testFile } from './helpers.js'

function repo(t, files) {
  const root = makeRepo(files)
  t.after(() => cleanup(root))
  return { root, blocksDir: join(root, 'blocks') }
}

const BASIC = {
  'blocks/index.md': '# Blocks\n',
  'blocks/_template.spec.md': spec(['Placeholder.']),
  'blocks/Toast/Toast.spec.md': spec(['One.']),
  'blocks/Toast/Toast.test.js': testFile(['C1: one']),
  'blocks/Toast/Toast.tsx': 'export const Toast = () => null\n',
}

test('discoverBlocks finds each directory that holds a spec', (t) => {
  const { blocksDir } = repo(t, BASIC)
  const { blocks } = discoverBlocks(blocksDir)
  assert.deepEqual(blocks.map((b) => b.id), ['Toast'])
  assert.equal(blocks[0].specPaths.length, 1)
  assert.equal(blocks[0].testPaths.length, 1)
})

test('discoverBlocks ignores index.md and the underscore template', (t) => {
  const { blocksDir } = repo(t, BASIC)
  const { blocks, orphans } = discoverBlocks(blocksDir)
  assert.equal(blocks.length, 1)
  assert.deepEqual(orphans, [])
})

test('discoverBlocks treats a spec-less directory as a grouping directory', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/forms/DatePicker/DatePicker.spec.md': spec(['One.']),
    'blocks/forms/DatePicker/DatePicker.test.js': testFile(['C1: one']),
  })
  const { blocks, orphans } = discoverBlocks(blocksDir)
  assert.deepEqual(blocks.map((b) => b.id), ['forms/DatePicker'])
  assert.deepEqual(orphans, [])
})

test('discoverBlocks reports source under blocks/ that no spec covers', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
    'blocks/loose/helper.ts': 'export const x = 1\n',
  })
  const { blocks, orphans } = discoverBlocks(blocksDir)
  assert.deepEqual(blocks.map((b) => b.id), ['Toast'])
  assert.deepEqual(orphans.map((o) => o.id), ['loose'])
})

test('a grouping directory holding only markdown is not an orphan', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/forms/README.md': '# Forms\n',
    'blocks/forms/DatePicker/DatePicker.spec.md': spec(['One.']),
    'blocks/forms/DatePicker/DatePicker.test.js': testFile(['C1: one']),
  })
  assert.deepEqual(discoverBlocks(blocksDir).orphans, [])
})

test('discoverBlocks finds nested blocks and does not merge their tests', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
    'blocks/Toast/Icon/Icon.spec.md': spec(['One.']),
    'blocks/Toast/Icon/Icon.test.js': testFile(['C1: one']),
  })
  const { blocks } = discoverBlocks(blocksDir)
  assert.deepEqual(blocks.map((b) => b.id), ['Toast', 'Toast/Icon'])
  assert.equal(blocks[0].testPaths.length, 1)
  assert.equal(blocks[1].testPaths.length, 1)
})

test('discoverBlocks skips node_modules and dot directories', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
    'blocks/node_modules/pkg/pkg.spec.md': spec(['Nope.']),
    'blocks/.cache/x/x.spec.md': spec(['Nope.']),
  })
  assert.deepEqual(discoverBlocks(blocksDir).blocks.map((b) => b.id), ['Toast'])
})

test('discoverBlocks returns empty results for an empty blocks directory', (t) => {
  const { blocksDir } = repo(t, { 'blocks/index.md': '# Blocks\n' })
  assert.deepEqual(discoverBlocks(blocksDir), { blocks: [], orphans: [] })
})

test('specFilesIn ignores underscore-prefixed specs', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/Toast/_draft.spec.md': spec(['One.']),
    'blocks/Toast/Toast.spec.md': spec(['One.']),
  })
  assert.deepEqual(specFilesIn(join(blocksDir, 'Toast')).map((p) => p.split(/[\\/]/).pop()), ['Toast.spec.md'])
})

test('isBlockDir is true only where a spec lives', (t) => {
  const { blocksDir } = repo(t, BASIC)
  assert.equal(isBlockDir(join(blocksDir, 'Toast')), true)
  assert.equal(isBlockDir(blocksDir), false)
})

test('testFilesIn recognises the usual test file extensions', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/a.test.js': '',
    'blocks/Toast/b.test.ts': '',
    'blocks/Toast/c.test.tsx': '',
    'blocks/Toast/d.spec.ts': '',
    'blocks/Toast/e.test.mjs': '',
    'blocks/Toast/notes.md': '',
    'blocks/Toast/Toast.tsx': '',
  })
  const found = testFilesIn(join(blocksDir, 'Toast')).map((p) => p.split(/[\\/]/).pop()).sort()
  assert.deepEqual(found, ['a.test.js', 'b.test.ts', 'c.test.tsx', 'd.spec.ts', 'e.test.mjs'])
})

test('blockForFile walks up to the owning block', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/internal/deep/util.ts': 'export const x = 1\n',
  })
  const { block } = blockForFile(join(blocksDir, 'Toast', 'internal', 'deep', 'util.ts'), blocksDir)
  assert.equal(block.id, 'Toast')
})

test('blockForFile picks the nearest block for a nested block file', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Icon/Icon.spec.md': spec(['One.']),
    'blocks/Toast/Icon/Icon.tsx': '',
  })
  const { block } = blockForFile(join(blocksDir, 'Toast', 'Icon', 'Icon.tsx'), blocksDir)
  assert.equal(block.id, 'Toast/Icon')
})

test('blockForFile points at blocks/ itself for files sitting directly in it', (t) => {
  const { blocksDir } = repo(t, BASIC)
  assert.deepEqual(blockForFile(join(blocksDir, 'index.md'), blocksDir), { block: null, candidateDir: blocksDir })
})

test('blockForFile returns nothing for a file outside blocks/', (t) => {
  const { root, blocksDir } = repo(t, BASIC)
  assert.deepEqual(blockForFile(join(root, 'src', 'app.ts'), blocksDir), { block: null, candidateDir: null })
})

test('blockForFile reports the candidate directory when nothing has a spec', (t) => {
  const { blocksDir } = repo(t, { 'blocks/New/thing.ts': 'export const x = 1\n' })
  const { block, candidateDir } = blockForFile(join(blocksDir, 'New', 'thing.ts'), blocksDir)
  assert.equal(block, null)
  assert.equal(relPosix(blocksDir, candidateDir), 'New')
})

test('findBlocksDirForFile finds the governing blocks directory', (t) => {
  const { root, blocksDir } = repo(t, BASIC)
  assert.equal(findBlocksDirForFile(join(blocksDir, 'Toast', 'Toast.tsx')), blocksDir)
  assert.equal(findBlocksDirForFile(join(root, 'src', 'app.ts')), null)
})

test('findBlocksDirForFile honours an explicit root', (t) => {
  const { root, blocksDir } = repo(t, BASIC)
  assert.equal(findBlocksDirForFile(join(blocksDir, 'Toast', 'Toast.tsx'), root), blocksDir)
  assert.equal(findBlocksDirForFile(join(blocksDir, 'Toast', 'Toast.tsx'), join(root, 'elsewhere')), null)
})

test('findRootWithBlocks walks up from a nested directory', (t) => {
  const { root, blocksDir } = repo(t, BASIC)
  assert.equal(findRootWithBlocks(join(blocksDir, 'Toast')), root)
  assert.equal(findRootWithBlocks(root), root)
})

test('findProjectRoot stops at package.json', (t) => {
  const { root } = repo(t, { 'package.json': '{}\n', 'src/deep/x.ts': '' })
  assert.equal(findProjectRoot(join(root, 'src', 'deep')), root)
})

test('isUnder is strict about containment', () => {
  assert.equal(isUnder('/a', '/a/b'), true)
  assert.equal(isUnder('/a', '/a'), false)
  assert.equal(isUnder('/a', '/ab'), false)
  assert.equal(isUnder('/a/b', '/a'), false)
})

test('an underscore-prefixed directory is an ordinary grouping directory', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/_shared/Money/Money.spec.md': spec(['One.']),
    'blocks/_shared/Money/Money.test.js': testFile(['C1: one']),
  })
  const { blocks, orphans } = discoverBlocks(blocksDir)
  assert.deepEqual(blocks.map((b) => b.id), ['_shared/Money'])
  assert.deepEqual(orphans, [])
})

test('a subdirectory inside a block belongs to that block, not to nobody', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
    'blocks/Toast/internal/helper.ts': 'export const x = 1\n',
    'blocks/Toast/__tests__/extra.js': 'export const y = 1\n',
  })
  assert.deepEqual(discoverBlocks(blocksDir).orphans, [])
})

test('source sitting directly in blocks/ is an orphan too', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/index.md': '# Blocks\n',
    'blocks/_template.spec.md': spec(['Placeholder.']),
    'blocks/stray.ts': 'export const x = 1\n',
  })
  const { orphans } = discoverBlocks(blocksDir)
  assert.deepEqual(orphans.map((o) => o.dir), [blocksDir])
})

test('the scaffolding markdown in blocks/ is not an orphan', (t) => {
  const { blocksDir } = repo(t, {
    'blocks/index.md': '# Blocks\n',
    'blocks/_template.spec.md': spec(['Placeholder.']),
  })
  assert.deepEqual(discoverBlocks(blocksDir).orphans, [])
})

test('findRootWithBlocks does not escape past a .git boundary', (t) => {
  const { root } = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'inner/.git/HEAD': 'ref: refs/heads/main\n',
    'inner/src/app.ts': '',
  })
  assert.equal(findRootWithBlocks(join(root, 'inner', 'src')), null)
  assert.equal(findRootWithBlocks(join(root, 'blocks')), root)
})

test('dirHasSource ignores markdown', (t) => {
  const { blocksDir } = repo(t, { 'blocks/a/notes.md': '', 'blocks/b/code.ts': '' })
  assert.equal(dirHasSource(join(blocksDir, 'a')), false)
  assert.equal(dirHasSource(join(blocksDir, 'b')), true)
})
