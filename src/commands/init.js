import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from '../lib/args.js'
import { EXIT } from '../lib/exit-codes.js'
import { findProjectRoot, toPosix } from '../lib/paths.js'

const SCAFFOLD = [
  { target: join('.claude', 'settings.json'), template: 'settings.json' },
  { target: join('blocks', 'index.md'), template: 'index.md' },
  { target: join('blocks', '_template.spec.md'), template: '_template.spec.md' },
  { target: 'CLAUDE.md', template: 'CLAUDE.md' },
]

const HOOK_SNIPPET = `  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "npx blockkit gate", "timeout": 60 }
        ]
      }
    ]
  }`

function templateText(name) {
  return readFileSync(new URL(`../templates/${name}`, import.meta.url), 'utf8')
}

/**
 * Is blockkit resolvable from `root`? The scaffolded hook runs `npx blockkit`,
 * which only reaches this package when it is installed locally.
 */
function isInstalledIn(root) {
  if (existsSync(join(root, 'node_modules', '.bin', 'blockkit'))) return true
  if (existsSync(join(root, 'node_modules', '.bin', 'blockkit.cmd'))) return true
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return Boolean(pkg.dependencies?.blockkit || pkg.devDependencies?.blockkit || pkg.name === 'blockkit')
  } catch {
    return false
  }
}

/**
 * Scaffold the block structure into a repo. Never overwrites: anything that
 * already exists is reported as skipped, and the caller is told what to add by
 * hand.
 */
export async function init(argv) {
  const { flags, errors } = parseArgs(argv, { boolean: ['dry-run'], string: ['root'] })
  if (errors.length > 0) {
    process.stderr.write(`blockkit init: ${errors.join('; ')}\n`)
    return EXIT.USAGE
  }

  const root = flags.root ? resolve(flags.root) : findProjectRoot(process.cwd())
  const dryRun = flags['dry-run'] === true
  const created = []
  const skipped = []

  for (const entry of SCAFFOLD) {
    const full = join(root, entry.target)
    if (existsSync(full)) {
      skipped.push(entry)
      continue
    }
    if (!dryRun) {
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, templateText(entry.template), { encoding: 'utf8', flag: 'wx' })
    }
    created.push(entry)
  }

  const out = [`blockkit init — ${toPosix(root)}${dryRun ? '  (dry run, nothing written)' : ''}`, '']
  for (const entry of created) out.push(`  ${dryRun ? 'would create' : 'created'}  ${toPosix(entry.target)}`)
  for (const entry of skipped) out.push(`  skipped${dryRun ? '     ' : ''}  ${toPosix(entry.target)}  (already exists, left untouched)`)

  if (skipped.length > 0) {
    out.push('', `${skipped.length} file${skipped.length === 1 ? '' : 's'} already existed. Nothing was overwritten — merge by hand:`)
    for (const entry of skipped) {
      if (entry.template === 'settings.json') {
        out.push('', `  ${toPosix(entry.target)} — add the gate hook:`, '', HOOK_SNIPPET)
      } else if (entry.template === 'CLAUDE.md') {
        out.push(
          '',
          '  CLAUDE.md — add a pointer to the block rules:',
          '',
          '      ## Blocks',
          '      This repo is organised into blocks. Read blocks/index.md before',
          '      touching anything under blocks/. Specs are read; block source is not.',
        )
      } else {
        out.push('', `  ${toPosix(entry.target)} — compare it against the current blockkit template.`)
      }
    }
  }

  if (!isInstalledIn(root)) {
    out.push(
      '',
      'WARNING: blockkit is not a dependency of this repo, so the hook command',
      '`npx blockkit gate` will not resolve to it. npx would fall back to the',
      'unrelated package named `blockkit` on the public registry, which does not',
      'implement `gate` — your contracts would go unchecked, and the agent would',
      'never hear about it. Install it:',
      '',
      '    npm install --save-dev github:jacksonkvandyke/Blockkit',
    )
  }

  if (created.length > 0 && !dryRun) {
    out.push('', 'Next: copy blocks/_template.spec.md to blocks/<Block>/<Block>.spec.md, fill in', 'the contract summary, then write one test per claim. `blockkit check` verifies', 'the whole repo; the hook verifies each block as you edit it.')
  }

  process.stdout.write(`${out.join('\n')}\n`)
  return EXIT.OK
}
