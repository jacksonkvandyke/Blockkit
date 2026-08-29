import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BIN = fileURLToPath(new URL('../bin/blockkit.js', import.meta.url))

/** Build a throwaway repo from a `{ 'rel/path': contents }` map. */
export function makeRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'blockkit-test-'))
  for (const [rel, contents] of Object.entries(files)) {
    write(root, rel, contents)
  }
  return root
}

export function write(root, rel, contents) {
  const full = join(root, ...rel.split('/'))
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, contents, 'utf8')
  return full
}

export function cleanup(root) {
  rmSync(root, { recursive: true, force: true })
}

/** Run the CLI in a child process and capture stdout, stderr and the code. */
export function runCli(args, { input = '', cwd = undefined } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    input,
    cwd,
    encoding: 'utf8',
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** A minimal valid spec with the given claim texts. */
export function spec(claims, { heading = '## Contract summary' } = {}) {
  const rows = claims.map((text, i) => `| ${i + 1} | ${text} | |`).join('\n')
  return ['# Block — spec', '', '## Purpose', '', 'Does a thing.', '', heading, '', '| # | Claim | Notes |', '|---|-------|-------|', rows, ''].join('\n')
}

/** A test file with one `test()` per name. */
export function testFile(names) {
  return [`import { test } from 'node:test'`, '', ...names.map((n) => `test(${JSON.stringify(n)}, () => {})`), ''].join('\n')
}
