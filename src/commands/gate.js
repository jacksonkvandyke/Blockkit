import { resolve } from 'node:path'
import { parseArgs } from '../lib/args.js'
import { blockForFile, dirHasSource } from '../lib/blocks.js'
import { EXIT } from '../lib/exit-codes.js'
import { BLOCKS_DIR_NAME, findBlocksDirForFile, relPosix } from '../lib/paths.js'
import { formatResult } from '../lib/report.js'
import { filePathFromPayload, readStdin } from '../lib/stdin.js'
import { verifyBlock } from '../lib/verify.js'

const DEFAULT_TIMEOUT_MS = 5000

/**
 * PostToolUse hook entry point. Reads a hook payload on stdin, finds the block
 * the edited file belongs to, and verifies just that block.
 *
 * Anything that is not a spec/test correspondence failure — no payload, bad
 * JSON, a file outside blocks/ — exits 0. The gate runs after every matched
 * edit in the repo, so it must be silent and cheap unless it has something
 * real to say.
 */
export async function gate(argv) {
  const { flags, positional, errors } = parseArgs(argv, {
    boolean: ['allow-skipped'],
    string: ['file', 'root', 'stdin-timeout'],
  })
  if (errors.length > 0) {
    process.stderr.write(`blockkit gate: ${errors.join('; ')}\n`)
    return EXIT.USAGE
  }
  if (positional.length > 1) {
    process.stderr.write('blockkit gate: expected at most one path\n')
    return EXIT.USAGE
  }

  const explicitRoot = flags.root ? resolve(flags.root) : null
  // A bare path is as good as --file; silently ignoring it and waiting on
  // stdin would look like a pass.
  let filePath = flags.file ?? positional[0] ?? null
  let cwd = process.cwd()

  if (!filePath) {
    const timeoutMs = Number(flags['stdin-timeout'] ?? DEFAULT_TIMEOUT_MS)
    const raw = await readStdin({ timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS })
    if (raw === null || raw.trim() === '') return note('no hook payload on stdin')

    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      return note('hook payload was not valid JSON')
    }
    filePath = filePathFromPayload(payload)
    if (payload && typeof payload.cwd === 'string' && payload.cwd !== '') cwd = payload.cwd
  }

  // No file in the payload (a tool we do not care about) — nothing to gate.
  if (!filePath) return EXIT.OK

  const abs = resolve(cwd, filePath)
  const blocksDir = findBlocksDirForFile(abs, explicitRoot)
  if (!blocksDir) return EXIT.OK

  const { block, candidateDir } = blockForFile(abs, blocksDir)

  // No spec anywhere above the file. That is only a violation if the directory
  // actually holds source — the same rule `check` applies to orphans, so the
  // two commands never disagree about a path.
  if (!block && (!candidateDir || !dirHasSource(candidateDir))) return EXIT.OK

  const target = block ?? {
    id: candidateDir === blocksDir ? `${BLOCKS_DIR_NAME}/` : relPosix(blocksDir, candidateDir),
    dir: candidateDir,
    specPaths: [],
    testPaths: [],
  }

  const result = verifyBlock(target, { allowSkipped: flags['allow-skipped'] === true })
  if (result.ok) return EXIT.OK

  const reportRoot = explicitRoot ?? resolve(blocksDir, '..')
  process.stderr.write(`${formatResult(result, { root: reportRoot })}\n`)
  return EXIT.HOOK_BLOCK
}

function note(message) {
  process.stderr.write(`blockkit gate: ${message}\n`)
  return EXIT.OK
}
