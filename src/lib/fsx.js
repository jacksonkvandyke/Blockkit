import { readdirSync, readFileSync, statSync } from 'node:fs'

/** Read a file as UTF-8, or null if it cannot be read. */
export function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Directory entries, or [] if the directory cannot be read. */
export function readDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch {
    return []
  }
}

export function isDir(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * True for entries we are willing to descend into. Symlinked directories are
 * skipped: they add cycle risk for no benefit, since a block lives on disk
 * where its spec does.
 */
export function isPlainDir(dirent) {
  return dirent.isDirectory() && !dirent.isSymbolicLink()
}

export function isPlainFile(dirent) {
  return dirent.isFile() && !dirent.isSymbolicLink()
}
