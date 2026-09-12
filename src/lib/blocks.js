import { basename, dirname, join, resolve } from 'node:path'
import { isPlainDir, isPlainFile, readDir } from './fsx.js'
import { isUnder, relPosix } from './paths.js'

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  '.turbo', '.cache', '.svelte-kit', '__snapshots__', 'storybook-static',
])

const SPEC_RE = /\.spec\.md$/i
const TEST_FILE_RE = /\.(test|spec)\.([mc]?[jt]sx?|cs)$/i
const TEST_DIR_RE = /^(__tests__|tests?)$/i
const CODE_FILE_RE = /\.[mc]?[jt]sx?$|\.(vue|svelte|astro|css|scss|less|cs)$/i
const MAX_DEPTH = 12

function ignorable(name) {
  return name.startsWith('.') || IGNORED_DIRS.has(name)
}

/**
 * Spec files directly in `dir`. `_`-prefixed *files* never count, which is what
 * keeps `blocks/_template.spec.md` from being mistaken for a contract.
 * `_`-prefixed *directories* are ordinary: `blocks/_shared/Money` is a block.
 */
export function specFilesIn(dir) {
  return readDir(dir)
    .filter((e) => isPlainFile(e) && SPEC_RE.test(e.name) && !e.name.startsWith('_'))
    .map((e) => join(dir, e.name))
    .sort()
}

/** A directory is a block when it holds a spec. */
export function isBlockDir(dir) {
  return specFilesIn(dir).length > 0
}

/** True when `dir` directly contains source files (not just markdown). */
export function dirHasSource(dir) {
  return readDir(dir).some((e) => isPlainFile(e) && CODE_FILE_RE.test(e.name))
}

/** Test files belonging to `blockDir`, excluding any nested block's own tests. */
export function testFilesIn(blockDir) {
  const found = []
  walk(blockDir, 0)
  return found.sort()

  function walk(dir, depth) {
    if (depth > MAX_DEPTH) return
    for (const entry of readDir(dir)) {
      const full = join(dir, entry.name)
      if (isPlainDir(entry)) {
        if (ignorable(entry.name)) continue
        if (isBlockDir(full)) continue // belongs to that block
        walk(full, depth + 1)
        continue
      }
      if (!isPlainFile(entry)) continue
      if (TEST_FILE_RE.test(entry.name)) {
        found.push(full)
        continue
      }
      // Anything JS/TS-ish inside a __tests__/ directory counts too.
      if (TEST_DIR_RE.test(basename(dir)) && /\.[mc]?[jt]sx?$/i.test(entry.name)) found.push(full)
    }
  }
}

function makeBlock(blocksDir, dir) {
  return {
    id: relPosix(blocksDir, dir),
    dir,
    specPaths: specFilesIn(dir),
    testPaths: testFilesIn(dir),
  }
}

/**
 * Every block under `blocksDir`, plus every directory holding source that no
 * contract covers.
 *
 * A block is any directory containing a `*.spec.md`. Directories without one
 * are grouping directories and are descended into — but a grouping directory
 * may not hold source of its own, because then that code is under `blocks/`
 * with no contract. Directories *inside* a block are part of that block, so
 * they are never orphans; they are still descended into, so a nested block is
 * found and verified in its own right.
 *
 * This traversal is the single source of truth for what is under contract:
 * `gate` resolves one file through the same rules, so the two commands can
 * never disagree about a given path.
 */
export function discoverBlocks(blocksDir) {
  const blocks = []
  const orphans = []
  const root = resolve(blocksDir)
  walk(root, 0, false)
  blocks.sort((a, b) => a.id.localeCompare(b.id))
  orphans.sort((a, b) => a.id.localeCompare(b.id))
  return { blocks, orphans }

  function walk(dir, depth, insideBlock) {
    if (depth > MAX_DEPTH) return
    const isBlock = depth > 0 && isBlockDir(dir)

    if (isBlock) {
      blocks.push(makeBlock(root, dir))
    } else if (!insideBlock && dirHasSource(dir)) {
      // Includes blocks/ itself: a stray source file there has no contract either.
      orphans.push({ id: relPosix(root, dir), dir })
    }

    for (const entry of readDir(dir)) {
      if (!isPlainDir(entry) || ignorable(entry.name)) continue
      walk(join(dir, entry.name), depth + 1, insideBlock || isBlock)
    }
  }
}

/**
 * The block that owns `filePath`.
 *
 * Returns `{ block }` when a spec was found by walking up to `blocksDir`.
 * When none was, `candidateDir` is the directory that ought to have one —
 * `blocksDir` itself for a file sitting directly in `blocks/`.
 */
export function blockForFile(filePath, blocksDir) {
  const abs = resolve(filePath)
  const root = resolve(blocksDir)
  let dir = dirname(abs)

  if (!isUnder(root, dir)) return { block: null, candidateDir: dir === root ? root : null }

  // The same ignore policy `discoverBlocks` walks with: nothing under
  // blocks/dist or blocks/.cache is under contract, so the gate must not
  // enforce there either.
  if (relPosix(root, dir).split('/').some(ignorable)) return { block: null, candidateDir: null }

  const firstDir = dir
  while (isUnder(root, dir)) {
    if (isBlockDir(dir)) return { block: makeBlock(root, dir), candidateDir: dir }
    dir = dirname(dir)
  }
  return { block: null, candidateDir: firstDir }
}

export { makeBlock }
