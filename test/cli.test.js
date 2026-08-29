import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseSpec } from '../src/lib/spec-parser.js'
import { cleanup, makeRepo, runCli, spec, testFile, write } from './helpers.js'

const payload = (cwd, filePath) => JSON.stringify({ session_id: 't', cwd, tool_name: 'Edit', tool_input: { file_path: filePath } })

function repo(t, files = {}) {
  const root = makeRepo({ 'package.json': '{"name":"demo"}\n', ...files })
  t.after(() => cleanup(root))
  return root
}

const GOOD = {
  'blocks/Toast/Toast.spec.md': spec(['Renders nothing when empty.', 'Calls onDismiss once.']),
  'blocks/Toast/Toast.test.js': testFile(['C1: renders nothing when empty', 'C2: calls onDismiss once']),
}

test('init scaffolds the four files and says what it created', (t) => {
  const root = repo(t)
  const { status, stdout } = runCli(['init', '--root', root])
  assert.equal(status, 0)
  for (const rel of ['.claude/settings.json', 'blocks/index.md', 'blocks/_template.spec.md', 'CLAUDE.md']) {
    assert.ok(existsSync(join(root, ...rel.split('/'))), `${rel} should exist`)
    assert.match(stdout, new RegExp(`created\\s+${rel.replace(/[.\\/]/g, '\\$&')}`))
  }
})

test('init writes a PostToolUse hook matching Write|Edit with a 60s timeout', (t) => {
  const root = repo(t)
  runCli(['init', '--root', root])
  const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'))
  const entry = settings.hooks.PostToolUse[0]
  assert.equal(entry.matcher, 'Write|Edit')
  assert.deepEqual(entry.hooks, [{ type: 'command', command: 'npx blockkit gate', timeout: 60 }])
})

test('init never overwrites and reports what it skipped', (t) => {
  const root = repo(t, { 'CLAUDE.md': 'MINE\n' })
  const first = runCli(['init', '--root', root])
  assert.equal(first.status, 0)
  assert.match(first.stdout, /skipped\s+CLAUDE\.md/)
  assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), 'MINE\n')

  const second = runCli(['init', '--root', root])
  assert.equal(second.status, 0)
  for (const rel of ['.claude/settings.json', 'blocks/index.md', 'blocks/_template.spec.md', 'CLAUDE.md']) {
    assert.match(second.stdout, new RegExp(`skipped\\s+${rel.replace(/[.\\/]/g, '\\$&')}`))
  }
  assert.ok(!second.stdout.includes('created '), 'nothing should be created the second time')
})

test('init prints the hook snippet when settings.json already exists', (t) => {
  const root = repo(t, { '.claude/settings.json': '{}\n' })
  const { stdout } = runCli(['init', '--root', root])
  assert.match(stdout, /"matcher": "Write\|Edit"/)
  assert.match(stdout, /"command": "npx blockkit gate"/)
  assert.match(stdout, /"timeout": 60/)
  assert.equal(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'), '{}\n')
})

test('init --dry-run writes nothing', (t) => {
  const root = repo(t)
  const { status, stdout } = runCli(['init', '--root', root, '--dry-run'])
  assert.equal(status, 0)
  assert.match(stdout, /dry run/)
  assert.ok(!existsSync(join(root, 'CLAUDE.md')))
  assert.ok(!existsSync(join(root, 'blocks')))
})

test('the scaffolded CLAUDE.md points at blocks/index.md and states the rule', (t) => {
  const root = repo(t)
  runCli(['init', '--root', root])
  const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
  assert.match(claudeMd, /blocks\/index\.md/)
  assert.match(claudeMd, /Specs are read\. Block source is not\./)
})

test('the scaffolded template has a contract summary blockkit can parse', (t) => {
  const root = repo(t)
  runCli(['init', '--root', root])
  const template = readFileSync(join(root, 'blocks', '_template.spec.md'), 'utf8')
  const parsed = parseSpec(template)
  assert.deepEqual(parsed.problems, [])
  assert.deepEqual(parsed.claims.map((c) => c.id), ['C1', 'C2', 'C3'])
  for (const section of ['## Props', '## Types', '## Ownership', '## State shape', '## Callback timing', '## Async behaviour', '## Failure modes', '## Accessibility', '## Contract summary']) {
    assert.ok(template.includes(section), `template should have ${section}`)
  }
})

test('gate exits 0 and says nothing for a file outside blocks/', (t) => {
  const root = repo(t, { ...GOOD, 'src/app.ts': 'export const x = 1\n' })
  const result = runCli(['gate'], { input: payload(root, join(root, 'src', 'app.ts')) })
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout, '')
})

test('gate exits 0 and says nothing when the block is consistent', (t) => {
  const root = repo(t, GOOD)
  const result = runCli(['gate'], { input: payload(root, join(root, 'blocks', 'Toast', 'Toast.test.js')) })
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout, '')
})

test('gate exits 2 and names the missing tests and the unclaimed tests', (t) => {
  const root = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['Renders nothing when empty.', 'Calls onDismiss once.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: renders nothing when empty', 'shows a close button']),
  })
  const result = runCli(['gate'], { input: payload(root, join(root, 'blocks', 'Toast', 'Toast.tsx')) })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /claims with no test \(1\)/)
  assert.match(result.stderr, /C2\s+Calls onDismiss once\./)
  assert.match(result.stderr, /tests with no claim \(1\)/)
  assert.match(result.stderr, /Toast\.test\.js:4\s+"shows a close button"/)
})

test('gate reports a block that has source but no spec', (t) => {
  const root = repo(t, { 'blocks/New/New.tsx': 'export const New = () => null\n' })
  const result = runCli(['gate'], { input: payload(root, join(root, 'blocks', 'New', 'New.tsx')) })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /no spec/)
})

test('gate ignores files that sit directly in blocks/', (t) => {
  const root = repo(t, GOOD)
  const result = runCli(['gate'], { input: payload(root, join(root, 'blocks', 'index.md')) })
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
})

test('gate exits 0 on an unusable payload rather than blocking unrelated work', (t) => {
  const root = repo(t, GOOD)
  for (const input of ['', 'not json', '{}', '{"tool_input":{}}', '{"tool_input":null}']) {
    const result = runCli(['gate'], { input })
    assert.equal(result.status, 0, `input ${JSON.stringify(input)} should exit 0`)
  }
  assert.equal(runCli(['gate'], { input: '[]' }).status, 0)
  assert.ok(existsSync(root))
})

test('gate resolves a relative file_path against the payload cwd', (t) => {
  const root = repo(t, GOOD)
  const result = runCli(['gate'], { input: payload(root, 'blocks/Toast/Toast.test.js') })
  assert.equal(result.status, 0)
})

test('gate works when invoked from an unrelated working directory', (t) => {
  const root = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.', 'Two.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
  })
  const elsewhere = repo(t)
  const result = runCli(['gate', '--file', join(root, 'blocks', 'Toast', 'Toast.test.js')], { cwd: elsewhere })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /C2/)
})

test('check exits 0 with a summary when every block matches', (t) => {
  const root = repo(t, GOOD)
  const result = runCli(['check', '--root', root])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /1 block · 2 claims · 1 ok · 0 failing/)
})

test('check exits 1 and reports each failing block', (t) => {
  const root = repo(t, {
    'blocks/A/A.spec.md': spec(['One.']),
    'blocks/A/A.test.js': testFile(['C1: one']),
    'blocks/B/B.spec.md': spec(['One.', 'Two.']),
    'blocks/B/B.test.js': testFile(['C1: one', 'extra test']),
  })
  const result = runCli(['check', '--root', root])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /B — contract mismatch/)
  assert.ok(!result.stdout.includes('A — contract mismatch'))
  assert.match(result.stdout, /2 blocks · 3 claims · 1 ok · 1 failing/)
})

test('check finds the repo root from a nested working directory', (t) => {
  const root = repo(t, { ...GOOD, 'src/deep/nested/.keep': '' })
  const result = runCli(['check'], { cwd: join(root, 'src', 'deep', 'nested') })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /1 block/)
})

test('check --json emits machine-readable results', (t) => {
  const root = repo(t, {
    'blocks/A/A.spec.md': spec(['One.', 'Two.']),
    'blocks/A/A.test.js': testFile(['C1: one']),
  })
  const result = runCli(['check', '--root', root, '--json'])
  assert.equal(result.status, 1)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.blocks.length, 1)
  assert.equal(parsed.blocks[0].id, 'A')
  assert.deepEqual(parsed.blocks[0].problems.map((p) => p.kind), ['claim-without-test'])
  assert.equal(parsed.blocks[0].problems[0].claimId, 'C2')
})

test('check reports source under blocks/ that no spec covers', (t) => {
  const root = repo(t, { ...GOOD, 'blocks/loose/util.ts': 'export const x = 1\n' })
  const result = runCli(['check', '--root', root])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /source under blocks\/ with no spec/)
  assert.match(result.stdout, /loose/)
})

test('check explains itself when there is no blocks directory', (t) => {
  const root = repo(t)
  const result = runCli(['check', '--root', root])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /blocks/)
  assert.match(result.stderr, /blockkit init/)
})

test('check on a repo with a blocks/ directory but no blocks passes', (t) => {
  const root = repo(t, { 'blocks/index.md': '# Blocks\n' })
  const result = runCli(['check', '--root', root])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /0 blocks/)
})

test('--allow-skipped lets a skipped test satisfy its claim', (t) => {
  const root = repo(t, {
    'blocks/A/A.spec.md': spec(['One.']),
    'blocks/A/A.test.js': `import { test } from 'node:test'\ntest.skip('C1: one', () => {})\n`,
  })
  assert.equal(runCli(['check', '--root', root]).status, 1)
  assert.equal(runCli(['check', '--root', root, '--allow-skipped']).status, 0)
})

test('the CLI rejects unknown commands and unknown flags', (t) => {
  const root = repo(t, GOOD)
  const unknownCommand = runCli(['frobnicate'])
  assert.equal(unknownCommand.status, 64)
  assert.match(unknownCommand.stderr, /unknown command/)

  const unknownFlag = runCli(['check', '--root', root, '--recurse'])
  assert.equal(unknownFlag.status, 64)
  assert.match(unknownFlag.stderr, /unknown option/)
})

test('--version and --help work', () => {
  const version = runCli(['--version'])
  assert.equal(version.status, 0)
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/)

  const help = runCli([])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /blockkit init/)
})

test('a freshly initialised repo passes check once a block is filled in', (t) => {
  const root = repo(t)
  assert.equal(runCli(['init', '--root', root]).status, 0)
  assert.equal(runCli(['check', '--root', root]).status, 0)

  write(root, 'blocks/Toast/Toast.spec.md', spec(['Renders nothing when empty.']))
  const failing = runCli(['check', '--root', root])
  assert.equal(failing.status, 1)
  assert.match(failing.stdout, /no test file/)

  write(root, 'blocks/Toast/Toast.test.js', testFile(['C1: renders nothing when empty']))
  assert.equal(runCli(['check', '--root', root]).status, 0)
})

test('check and gate agree about a block in an underscore directory', (t) => {
  const root = repo(t, {
    'blocks/_shared/Money/Money.spec.md': spec(['Never double-charges.', 'Refunds on failure.']),
    'blocks/_shared/Money/Money.test.js': testFile(['unrelated']),
    'blocks/_shared/Money/Money.js': 'export const charge = () => {}\n',
  })
  const checked = runCli(['check', '--root', root])
  assert.equal(checked.status, 1, 'check must not be green on a broken block')
  assert.match(checked.stdout, /_shared\/Money — contract mismatch/)

  const gated = runCli(['gate'], { input: payload(root, join(root, 'blocks', '_shared', 'Money', 'Money.js')) })
  assert.equal(gated.status, 2)
  assert.match(gated.stderr, /_shared\/Money/)
})

test('a block with an implementation subfolder passes check', (t) => {
  const root = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
    'blocks/Toast/internal/helper.ts': 'export const x = 1\n',
    'blocks/Toast/__tests__/extra.js': 'export const y = 1\n',
  })
  const result = runCli(['check', '--root', root])
  assert.equal(result.status, 0, result.stdout)
  assert.ok(!result.stdout.includes('no spec'))
})

test('gate does not fail on a grouping directory that holds only markdown', (t) => {
  const root = repo(t, {
    'blocks/forms/README.md': '# Forms\n',
    'blocks/forms/DatePicker/DatePicker.spec.md': spec(['One.']),
    'blocks/forms/DatePicker/DatePicker.test.js': testFile(['C1: one']),
  })
  assert.equal(runCli(['check', '--root', root]).status, 0)
  const gated = runCli(['gate'], { input: payload(root, join(root, 'blocks', 'forms', 'README.md')) })
  assert.equal(gated.status, 0)
  assert.equal(gated.stderr, '')
})

test('stray source directly in blocks/ fails both commands', (t) => {
  const root = repo(t, { ...GOOD, 'blocks/stray.ts': 'export const x = 1\n' })
  const checked = runCli(['check', '--root', root])
  assert.equal(checked.status, 1)
  assert.match(checked.stdout, /source under blocks\/ with no spec/)

  const gated = runCli(['gate'], { input: payload(root, join(root, 'blocks', 'stray.ts')) })
  assert.equal(gated.status, 2)
  assert.match(gated.stderr, /no spec/)
})

test('a repo that happens to live under a directory named blocks is not one big block tree', (t) => {
  const outer = makeRepo({
    'blocks/myrepo/package.json': '{"name":"myrepo"}\n',
    'blocks/myrepo/src/app.ts': 'export const x = 1\n',
  })
  t.after(() => cleanup(outer))
  const result = runCli(['gate'], {
    input: payload(join(outer, 'blocks', 'myrepo'), join(outer, 'blocks', 'myrepo', 'src', 'app.ts')),
  })
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
})

test('gate accepts a bare path argument instead of silently waiting on stdin', (t) => {
  const root = repo(t, {
    'blocks/Toast/Toast.spec.md': spec(['One.', 'Two.']),
    'blocks/Toast/Toast.test.js': testFile(['C1: one']),
  })
  const result = runCli(['gate', join(root, 'blocks', 'Toast', 'Toast.test.js')])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /C2/)
})

test('gate honours --allow-skipped, --root and a notebook_path payload', (t) => {
  const root = repo(t, {
    'blocks/A/A.spec.md': spec(['One.']),
    'blocks/A/A.test.js': `import { test } from 'node:test'\ntest.skip('C1: one', () => {})\n`,
  })
  const file = join(root, 'blocks', 'A', 'A.test.js')
  assert.equal(runCli(['gate', '--file', file]).status, 2)
  assert.equal(runCli(['gate', '--file', file, '--allow-skipped']).status, 0)
  assert.equal(runCli(['gate', '--file', file, '--root', root]).status, 2)

  const notebook = JSON.stringify({ cwd: root, tool_input: { notebook_path: file } })
  assert.equal(runCli(['gate'], { input: notebook }).status, 2)
})

test('gate gives up on stdin rather than hanging', (t) => {
  const root = repo(t, GOOD)
  const result = runCli(['gate', '--stdin-timeout', '150'], { cwd: root })
  assert.equal(result.status, 0)
  assert.match(result.stderr, /no hook payload/)
})

test('the gate names duplicate, skipped and unknown claims in its stderr', (t) => {
  const root = repo(t, {
    'blocks/A/A.spec.md': spec(['One.', 'Two.', 'Three.']),
    'blocks/A/A.test.js': [
      `import { test } from 'node:test'`,
      `test('C1: one way', () => {})`,
      `test('C1: another way', () => {})`,
      `test.skip('C2: two', () => {})`,
      `test('C3: three', () => {})`,
      `test('C9: from an older spec', () => {})`,
    ].join('\n'),
  })
  const result = runCli(['gate', '--file', join(root, 'blocks', 'A', 'A.test.js')])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /C1 is claimed by 2 tests/)
  assert.match(result.stderr, /C2 is only covered by a skipped test/)
  assert.match(result.stderr, /C9 is not in the contract summary/)
  assert.match(result.stderr, /A\.test\.js:3/)
})

test('the scaffolded blocks/index.md documents the conventions', (t) => {
  const root = repo(t)
  runCli(['init', '--root', root])
  const index = readFileSync(join(root, 'blocks', 'index.md'), 'utf8')
  for (const phrase of ['Specs are read', 'Contract summary', 'C3:', 'blockkit check', '_template.spec.md']) {
    assert.ok(index.includes(phrase), `blocks/index.md should mention ${phrase}`)
  }
  assert.match(index, /## Blocks/)
  assert.match(index, /_none yet_/)
})

test('init warns when blockkit is not installed in the target repo', (t) => {
  const root = repo(t)
  assert.match(runCli(['init', '--root', root]).stdout, /WARNING: blockkit is not a dependency/)

  const withDep = repo(t, { 'package.json': '{"name":"d","devDependencies":{"blockkit":"github:o/blockkit"}}\n' })
  assert.ok(!runCli(['init', '--root', withDep]).stdout.includes('WARNING'))
})

test('--help lists every documented flag', () => {
  const { stdout } = runCli(['--help'])
  for (const flag of ['--root', '--file', '--allow-skipped', '--json', '--dry-run', '--stdin-timeout']) {
    assert.ok(stdout.includes(flag), `help should document ${flag}`)
  }
})
