# blockkit

A small CLI that keeps a repo's **blocks** honest: every claim a block's spec
makes is proved by exactly one test, and every test names a claim that exists.

It reports; it never edits your code. The only files it ever writes are the
scaffolding `blockkit init` creates, and it refuses to overwrite anything.

- Node 20+, ESM, **zero runtime dependencies**
- `blockkit gate` runs from a Claude Code `PostToolUse` hook after every edit
- `blockkit check` runs the same verification across the repo, for CI and
  pre-commit

---

## The model

A **block** is a directory under `blocks/` containing a spec, its tests, and
its implementation:

```
blocks/
  index.md                 shared conventions
  _template.spec.md        the spec skeleton
  Toast/
    Toast.spec.md          the contract
    Toast.test.tsx         one test per claim
    Toast.tsx              implementation, private to the block
```

Every spec ends with a numbered **contract summary**:

```markdown
## Contract summary

| # | Claim                                                  | Notes |
|---|--------------------------------------------------------|-------|
| 1 | Renders nothing when `message` is empty.               |       |
| 2 | Calls `onDismiss` exactly once when the timer expires. |       |
| 3 | Restores focus to the element that opened it.          |       |
```

and every test names the claim it proves:

```js
test('C2: calls onDismiss exactly once when the timer expires', async () => { … })
```

blockkit verifies the correspondence **in both directions**: a claim with no
test fails, and a test with no claim fails. That is the whole idea — the spec
cannot drift ahead of the tests, and the tests cannot drift ahead of the spec.

The point of the discipline is that callers read `Toast.spec.md` and never
`Toast.tsx`. The scaffolded `CLAUDE.md` states that rule for Claude Code.

---

## Install from GitHub

blockkit is a private package. Install it straight from the repo, as a
**devDependency of the project you want to enforce**:

```sh
# HTTPS (uses your git credential helper / a PAT in CI)
npm install --save-dev github:jacksonkvandyke/Blockkit

# SSH (uses your existing SSH key — usually the easiest for a private repo)
npm install --save-dev git+ssh://git@github.com/jacksonkvandyke/Blockkit.git
```

Pin a tag or commit so a hook never changes underneath you:

```sh
npm install --save-dev github:jacksonkvandyke/Blockkit#v0.1.0
npm install --save-dev github:jacksonkvandyke/Blockkit#3f9a1c2
```

There is no build step, so no `prepare` script has to run at install time.

### ⚠ Install it locally — the name is taken on the public registry

The scaffolded hook command is `npx blockkit gate`. When blockkit is a
devDependency, `npx` resolves it from `node_modules/.bin` and never touches the
network. When it is **not** installed, `npx` falls back to the registry — and
an unrelated package really is published there:

```
$ npm view blockkit name version description bin
name = 'blockkit'
version = '0.0.4'
description = 'This is an exploratory repository to explore the options for
creating a wrapper of the wordpress registerBlockType function to add defaults'
bin = { blockkit: 'src/index.js' }
```

It declares a `blockkit` bin, so npx will download and run *that* after every
Write/Edit. It does not implement `gate`, so **your contracts stop being
checked** — and because a PostToolUse hook's failure is surfaced only to you
and never to the model, the agent keeps working as though the gate had passed.
`blockkit init` warns you when the package is not installed in the target repo,
but the safest options are:

- install it as a devDependency (above), or
- rename this package to `@your-org/blockkit` in `package.json` and use
  `npx @your-org/blockkit gate` as the hook command — a scope you own cannot be
  squatted.

In CI, install with the same credentials as any other private dependency:

```yaml
- run: git config --global url."https://x-access-token:${{ secrets.GH_PAT }}@github.com/".insteadOf "https://github.com/"
- run: npm ci
```

### Using it without installing

For a one-off run in a repo that does not depend on it yet:

```sh
npx github:jacksonkvandyke/Blockkit check
```

---

## `blockkit init`

Run it once in the repo you want to enforce:

```sh
npx blockkit init
```

It scaffolds four files, from the project root (the nearest ancestor with a
`.git` or `package.json`, so it works from a subdirectory):

| File | What it is |
|------|------------|
| `.claude/settings.json` | the `PostToolUse` hook that runs the gate |
| `blocks/index.md` | the shared conventions, with no blocks listed yet |
| `blocks/_template.spec.md` | the spec skeleton to copy for each new block |
| `CLAUDE.md` | a stub pointing at `blocks/index.md` and stating the read-the-spec rule |

**It never overwrites.** Anything that already exists is left exactly as it is
and reported as skipped, along with what to merge in by hand:

```
blockkit init — /repo

  created  .claude/settings.json
  created  blocks/index.md
  created  blocks/_template.spec.md
  skipped  CLAUDE.md  (already exists, left untouched)

1 file already existed. Nothing was overwritten — merge by hand:

  CLAUDE.md — add a pointer to the block rules:

      ## Blocks
      This repo is organised into blocks. Read blocks/index.md before
      touching anything under blocks/. Specs are read; block source is not.
```

A first run also prints the install warning described above, until blockkit is
a dependency of the repo it just scaffolded.

Flags: `--root <dir>` to scaffold somewhere specific, `--dry-run` to see what
it would write.

---

## Hook wiring

`init` writes this to `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "npx blockkit gate",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

If `.claude/settings.json` already exists, add the `PostToolUse` entry to the
existing `hooks` object yourself — `init` prints exactly this snippet when it
skips the file. Claude Code asks you to review changed settings, so start a new
session (or check `/hooks`) after editing it.

**How it behaves as a hook.** Claude Code pipes a JSON payload to the command
on stdin; blockkit reads `.tool_input.file_path` from it.

- The file is not under `blocks/` → **exit 0** immediately, no output. That is
  most edits in a repo, and the work costs a few milliseconds on top of one
  process start.
- The file is under `blocks/` and the block's spec and tests agree → **exit 0**,
  silently.
- They disagree → **exit 2**, with the detail on stderr.

Exit code 2 is deliberate: Claude Code treats it as a blocking error for
`PostToolUse` and feeds stderr back to the model, so the agent sees exactly
which claims lack tests and which tests lack claims, and fixes them. Any other
non-zero code would only be shown to you.

```
Toast — contract mismatch
  spec   blocks/Toast/Toast.spec.md
  tests  blocks/Toast/Toast.test.tsx

  claims with no test (1):
    C3   Restores focus to the element that opened it.

  tests with no claim (1):
    blocks/Toast/Toast.test.tsx:41  "shows a close button"

  Every claim in the contract summary needs exactly one test whose name
  starts with its id, e.g. test('C3: …'). Fix the spec or the tests.
```

Test the wiring without an agent, by passing a path directly:

```sh
npx blockkit gate blocks/Toast/Toast.test.tsx; echo "exit $?"
```

**On hook latency.** blockkit itself takes about 100 ms for a no-op edit, but
`npx` adds roughly 0.9 s of npm CLI startup on top of it — measured at ~980 ms
per invocation versus ~98 ms invoking the bin directly. If a second per edit
matters to you, point the hook straight at the binary instead:

```json
{ "type": "command", "command": "node node_modules/blockkit/bin/blockkit.js gate", "timeout": 60 }
```

That skips npx entirely, and it cannot resolve to anything but this package.

---

## `blockkit check`

The same verification across every block in the repo:

```sh
npx blockkit check
```

```
Toast — contract mismatch
  spec   blocks/Toast/Toast.spec.md
  tests  blocks/Toast/Toast.test.tsx

  claims with no test (1):
    C3   Restores focus to the element that opened it.

  …

4 blocks · 27 claims · 3 ok · 1 failing
```

Exit 0 when everything matches, 1 on any mismatch. It finds the repo root by
walking up from the working directory until it sees a `blocks/` directory, so
it runs from anywhere in the repo. The walk stops at a `.git` boundary rather
than escaping into an enclosing directory that happens to have its own
`blocks/`.

### CI

```yaml
- run: npm ci
- run: npx blockkit check
```

### Pre-commit

```sh
# .git/hooks/pre-commit  (or the husky/lefthook equivalent)
npx blockkit check || exit 1
```

`--json` gives machine-readable output for anything else you want to build on
top:

```sh
npx blockkit check --json | jq '.blocks[] | select(.ok == false) | .id'
```

---

## What counts as a mismatch

| Reported as | Meaning |
|-------------|---------|
| `claims with no test` | a row in the contract summary that no test names |
| `tests with no claim` | a test whose name does not start with a claim id, or names an id the spec does not list |
| `no spec` | a directory under `blocks/` with source files but no `*.spec.md` |
| `no test file` | a block with a spec but no `*.test.*` file |
| `no contract summary` | a spec with no contract summary heading, or no table under it |
| duplicate claim | the same id twice in the table |
| duplicate test | two tests naming the same claim — a claim is proved by exactly one test |
| skipped test | a claim whose only test is `.skip` or `.todo`; pass `--allow-skipped` to permit it |

### Claim ids

The first column of the contract summary table. `1`, `C1`, `[C1]`, `**C1**`
and `` `C1` `` all mean `C1`. Ids are permanent — deleting claim 2 does not
renumber claim 3.

### Test names

The name must *start* with the claim id. All three forms work:

```js
test('C3: restores focus to the trigger')
test('[C3] restores focus to the trigger')
test('C3 - restores focus to the trigger')
```

Recognised across node:test, Vitest and Jest:

- `test` and `it`, with `.only` / `.skip` / `.todo` / `.failing` /
  `.concurrent` / `.each(…)` and chains of them
- Jest's `xit` / `xtest` (skipped) and `fit` (focused)
- node:test subtests — `t.test('C2: …', …)` on the test context
- the options object — `test('C1: …', { skip: true }, fn)` counts as skipped
- tests inside a `describe.skip(…)` or `xdescribe(…)` — also skipped

#### C# (xUnit / NUnit)

A `.test.cs` file is read for attributes rather than calls, because that is how
these frameworks declare a test. The claim comes from `DisplayName` when there
is one and from the method name otherwise, so both spellings work:

```csharp
[Fact(DisplayName = "C3: restores focus to the trigger")]
public void RestoresFocus() { }

[Fact]
public void C3_restores_focus_to_the_trigger() { }
```

Recognised: `[Fact]`, `[Theory]`, `[Test]`, `[TestCase]`, qualified
(`[Xunit.Fact]`), and stacked with other attributes. `Skip = "…"` and NUnit's
`[Ignore]` — including `[Test, Ignore("…")]` — count as skipped. Comments and
string bodies are masked first, verbatim strings included, so neither a
commented-out test nor `"[Fact]"` inside a literal is mistaken for one.

`describe` names are not tests. Commented-out tests do not count, nor does a
call written inside a string or a regex literal. A test whose name is a
variable is reported rather than silently ignored.

### Limitations

The parsers are deliberately dependency-free, which means they are lexical, not
full ASTs:

- C# is read the same lexical way. A test whose `DisplayName` is built at
  runtime rather than written as a literal falls back to the method name.
- A block's implementation is never parsed — only its `*.spec.md` and its test
  files.
- Pathological JSX *text* inside a test file (`<p>it ('x')</p>`) can look like a
  declaration. The obvious shape is guarded against; something determined to
  fool it will.
- A test name assembled at runtime cannot be read. blockkit reports that
  explicitly rather than pretending the test does not exist.
- `blockkit` is a linter for the spec/test relationship. It does not run your
  tests, so it cannot tell you a test passes — only that it exists and is not
  skipped.

### Layout rules

- A block is any directory under `blocks/` containing a `*.spec.md`.
- Test files are `*.test.*` / `*.spec.*` with a JavaScript, TypeScript or C#
  extension. A block's tests may sit beside its spec while the implementation
  lives elsewhere in the repo, which is how a .NET project adopts blocks without
  moving any source.
- A directory without one is a grouping directory, so `blocks/forms/DatePicker`
  is a block called `forms/DatePicker`. A grouping directory may hold notes but
  not source files of its own — that would be code under `blocks/` with no
  contract. The same goes for source sitting directly in `blocks/`.
- Directories *inside* a block belong to that block, so a block is free to have
  `internal/`, `__tests__/` and so on.
- A `*.spec.md` inside a block makes a nested block — `blocks/Toast/Icon` is
  verified in its own right and keeps its own tests.
- `_`-prefixed *spec* files are ignored, which is what keeps
  `_template.spec.md` from being read as a contract. The underscore means
  nothing on other files — `blocks/Toast/_fixtures.test.js` is still parsed for
  tests — and nothing on directories: `blocks/_shared/Money` is a block called
  `_shared/Money`.
- `node_modules/`, `dist/`, `build/`, `out/`, `coverage/` and dot-directories
  under `blocks/` are skipped by both commands.
- Markdown sitting directly in `blocks/` (`index.md`, `_template.spec.md`)
  belongs to no block and is ignored.
- Tests may live in several files per block, including a `__tests__/` directory.

`gate` resolves a single path through exactly these rules and `check` walks all
of them, so the two commands agree about a given file. (One gap: `check` will
not descend into a symlinked directory, and `gate` does not detect that a path
reached it through one.)

---

## Command reference

```
blockkit init  [--root <dir>] [--dry-run]
blockkit check [--root <dir>] [--json] [--allow-skipped]
blockkit gate  [<path>] [--root <dir>] [--allow-skipped] [--stdin-timeout <ms>]
```

| Flag | Applies to | Meaning |
|------|-----------|---------|
| `--root <dir>` | all | work from this directory instead of discovering one |
| `--dry-run` | init | report what it would write, write nothing |
| `--json` | check | machine-readable results |
| `--allow-skipped` | check, gate | let a `.skip`/`.todo` test satisfy its claim |
| `--file <path>` | gate | check this path instead of reading a hook payload. A bare path argument does the same thing. |
| `--stdin-timeout <ms>` | gate | give up waiting for a payload (default 5000) |

| Exit code | Meaning |
|-----------|---------|
| 0 | spec and tests agree, or there was nothing to check |
| 1 | `check` found a mismatch, or the command could not run |
| 2 | `gate` found a mismatch (the code Claude Code feeds back to the model) |
| 64 | bad usage |

---

## Troubleshooting

**The hook never fires.** Check `/hooks` in Claude Code, and confirm the
settings file was accepted — Claude Code asks you to review changes to
`.claude/settings.json` before they take effect.

**`npx` cannot find blockkit.** It is not installed in that repo. Add it as a
devDependency (above); `npx` only falls back to the registry when the package
is not local.

**The gate says nothing and exits 0 when I expected a failure.** It exits 0 by
design for anything that is not a real mismatch: a file outside `blocks/`, a
missing or malformed payload, markdown sitting directly in `blocks/`, or a path
under an ignored directory such as `blocks/dist/`. Run `blockkit gate <path>`
to see what it makes of a specific file.

**The gate failed on a file I did not touch.** Editing anything in a directory
that holds source but no `*.spec.md` reports that directory — the rule is about
the directory, not the file you edited. That is deliberate: it is the same
thing `check` would fail on in CI.

**Monorepos.** The gate resolves the `blocks/` directory from the edited file's
own path, so several packages can each have their own `blocks/` tree. `check`
walks up from the working directory and checks one tree — run it per package,
or pass `--root`.

---

## Development

```sh
npm test        # node --test
```

No dependencies, no build. `src/lib/` holds the parsers (`spec-parser.js`,
`test-parser.js`, `scan.js`), the correspondence check (`verify.js`) and the
reporting (`report.js`); `src/commands/` holds the three commands.
