import { join, resolve } from 'node:path'
import { parseArgs } from '../lib/args.js'
import { discoverBlocks } from '../lib/blocks.js'
import { EXIT } from '../lib/exit-codes.js'
import { isDir } from '../lib/fsx.js'
import { BLOCKS_DIR_NAME, findRootWithBlocks, relPosix, toPosix } from '../lib/paths.js'
import { formatOrphans, formatResult, formatSummary, toJson } from '../lib/report.js'
import { verifyBlocks } from '../lib/verify.js'

/**
 * Verify every block in the repo. Intended for CI and pre-commit, so the exit
 * code is the contract: 0 when every block's spec and tests agree, 1 otherwise.
 */
export async function check(argv) {
  const { flags, errors } = parseArgs(argv, {
    boolean: ['json', 'allow-skipped'],
    string: ['root'],
  })
  if (errors.length > 0) {
    process.stderr.write(`blockkit check: ${errors.join('; ')}\n`)
    return EXIT.USAGE
  }

  const root = flags.root ? resolve(flags.root) : findRootWithBlocks(process.cwd())
  if (!root) {
    process.stderr.write(
      `blockkit check: no ${BLOCKS_DIR_NAME}/ directory found from ${toPosix(process.cwd())} upwards; run \`blockkit init\` first\n`,
    )
    return EXIT.MISMATCH
  }

  const blocksDir = join(root, BLOCKS_DIR_NAME)
  if (!isDir(blocksDir)) {
    process.stderr.write(
      `blockkit check: no ${BLOCKS_DIR_NAME}/ directory in ${toPosix(root)}; run \`blockkit init\` first\n`,
    )
    return EXIT.MISMATCH
  }

  const { blocks, orphans } = discoverBlocks(blocksDir)
  const results = verifyBlocks(blocks, { allowSkipped: flags['allow-skipped'] === true })
  const failing = results.filter((r) => !r.ok)
  const failed = failing.length > 0 || orphans.length > 0

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root: toPosix(root),
          ok: !failed,
          summary: formatSummary(results, { orphans }),
          blocks: results.map((r) => toJson(r, { root })),
          orphans: orphans.map((o) => ({ id: o.id, dir: relPosix(root, o.dir) })),
        },
        null,
        2,
      )}\n`,
    )
    return failed ? EXIT.MISMATCH : EXIT.OK
  }

  const out = []
  for (const result of failing) out.push(formatResult(result, { root }), '')
  if (orphans.length > 0) out.push(formatOrphans(orphans, { root }), '')
  out.push(formatSummary(results, { orphans }))
  process.stdout.write(`${out.join('\n')}\n`)

  return failed ? EXIT.MISMATCH : EXIT.OK
}
