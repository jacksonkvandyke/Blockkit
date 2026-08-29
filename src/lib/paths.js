import { isAbsolute, relative, resolve, sep } from 'node:path'
import { isDir, isFile, readDir } from './fsx.js'

export const BLOCKS_DIR_NAME = 'blocks'

// macOS and Windows resolve paths case-insensitively; Linux does not.
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin'

export function toPosix(p) {
  return p.split(sep).join('/')
}

/** Path of `target` relative to `from`, always with forward slashes. */
export function relPosix(from, target) {
  return toPosix(relative(from, target)) || '.'
}

/** True when `target` is strictly inside `dir`. */
export function isUnder(dir, target) {
  const rel = relative(dir, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function isBlocksSegment(segment) {
  return segment === BLOCKS_DIR_NAME || (CASE_INSENSITIVE_FS && segment.toLowerCase() === BLOCKS_DIR_NAME)
}

/**
 * The `blocks/` directory that governs `filePath`, or null when the file is not
 * under one. Segments are tried outermost first, so a pathological
 * `blocks/A/blocks/B` resolves deterministically to the outer one.
 *
 * When `root` is given, only a `blocks/` directory inside that root counts.
 */
export function findBlocksDirForFile(filePath, root = null) {
  const abs = resolve(filePath)
  const segments = abs.split(sep)
  const bound = root ? resolve(root) : null

  for (let i = 0; i < segments.length; i++) {
    if (!isBlocksSegment(segments[i])) continue
    const candidate = segments.slice(0, i + 1).join(sep)
    if (!isDir(candidate)) continue
    if (bound) {
      if (!isUnder(bound, candidate)) continue
      return candidate
    }
    // With no explicit root, a directory named `blocks` only governs the file
    // if it plausibly belongs to the file's project. Otherwise a repo that
    // happens to live in `~/work/blocks/myrepo` would have every one of its
    // files treated as block source.
    if (looksLikeProject(resolve(candidate, '..')) || looksLikeBlocksTree(candidate)) return candidate
  }
  return null
}

function looksLikeProject(dir) {
  return hasGit(dir) || isFile(resolve(dir, 'package.json'))
}

/**
 * Does this directory look like a blockkit `blocks/` tree — scaffolding at the
 * top, or at least one child holding a spec? Only consulted when the parent
 * directory is not recognisably a project.
 */
function looksLikeBlocksTree(dir) {
  const entries = readDir(dir)
  for (const entry of entries) {
    if (entry.isFile() && (entry.name === 'index.md' || SPEC_FILE_RE.test(entry.name))) return true
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (readDir(resolve(dir, entry.name)).some((c) => c.isFile() && SPEC_FILE_RE.test(c.name))) return true
  }
  return false
}

const SPEC_FILE_RE = /\.spec\.md$/i

/**
 * Walk up from `startDir` looking for a directory that contains `blocks/`.
 * Returns the containing directory (the repo root), not `blocks/` itself.
 *
 * The walk stops at a `.git` directory: checking a `blocks/` tree that belongs
 * to some enclosing directory outside the repo is never what the caller meant.
 */
export function findRootWithBlocks(startDir) {
  let dir = resolve(startDir)
  for (;;) {
    if (isDir(resolve(dir, BLOCKS_DIR_NAME))) return dir
    if (hasGit(dir)) return null
    const parent = resolve(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
}

// In a worktree or a submodule, `.git` is a file holding a `gitdir:` pointer,
// not a directory. Both mark a repository boundary.
function hasGit(dir) {
  const dotGit = resolve(dir, '.git')
  return isDir(dotGit) || isFile(dotGit)
}

/**
 * Nearest ancestor that looks like a project root (`.git` or `package.json`),
 * or null when there is none.
 */
export function findProjectRootOrNull(startDir) {
  let dir = resolve(startDir)
  for (;;) {
    if (hasGit(dir) || isFile(resolve(dir, 'package.json'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
}


/**
 * As `findProjectRootOrNull`, falling back to `startDir`. Used by `init` so
 * that running it from a subdirectory still scaffolds at the top of the repo.
 */
export function findProjectRoot(startDir) {
  return findProjectRootOrNull(startDir) ?? resolve(startDir)
}
