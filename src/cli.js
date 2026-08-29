import { readFileSync } from 'node:fs'
import { EXIT } from './lib/exit-codes.js'

export const USAGE = `blockkit — keep every block's spec and its tests in lockstep

Usage
  blockkit init  [--root <dir>] [--dry-run]
  blockkit gate  [<path>] [--root <dir>] [--allow-skipped] [--stdin-timeout <ms>]
  blockkit check [--root <dir>] [--json] [--allow-skipped]

Commands
  init    Scaffold the block structure into this repo: a Claude Code
          PostToolUse hook, blocks/index.md, blocks/_template.spec.md and a
          CLAUDE.md stub. Existing files are never overwritten.
  gate    Verify the single block touched by a hook payload read from stdin.
          Exits 0 immediately when the edited file is not under blocks/.
  check   Verify every block in the repo. For CI and pre-commit.

Options
  --root <dir>          Repo root to work from (default: discovered from the cwd)
  --file <path>         Gate this path instead of reading a hook payload on
                        stdin. A bare path argument does the same thing.
  --allow-skipped       Let a skipped test satisfy its claim
  --json                Machine-readable output (check)
  --dry-run             Report what init would write, without writing it
  --stdin-timeout <ms>  How long gate waits for a hook payload (default 5000)
  -h, --help            Show this help
  -v, --version         Show the version

Exit codes
  0   spec and tests agree, or there was nothing to check
  1   spec and tests disagree (check), or the command could not run
  2   spec and tests disagree (gate) — Claude Code feeds stderr back to the
      model at this exit code, which is what makes the gate self-correcting
  64  bad usage
`

function version() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export async function main(argv) {
  const [command, ...rest] = argv

  switch (command) {
    case 'init':
      return (await import('./commands/init.js')).init(rest)
    case 'gate':
      return (await import('./commands/gate.js')).gate(rest)
    case 'check':
      return (await import('./commands/check.js')).check(rest)
    case '--version':
    case '-v':
      process.stdout.write(`${version()}\n`)
      return EXIT.OK
    case '--help':
    case '-h':
    case 'help':
    case undefined:
      process.stdout.write(USAGE)
      return EXIT.OK
    default:
      process.stderr.write(`blockkit: unknown command "${command}"\n\n${USAGE}`)
      return EXIT.USAGE
  }
}
