# Blocks

This repo is organised into **blocks**. A block is a self-contained unit of
behaviour that is described completely by its spec, proved completely by its
tests, and consumed only through the interface its spec documents.

Read this file before adding, changing, or using a block.

## The rule

**Specs are read. Block source is not.**

To use a block, read `blocks/<Block>/<Block>.spec.md`. Do not open the
implementation to find out how it behaves. If the spec does not answer your
question, the spec is incomplete — fixing the spec is the task, and reading the
source to work around it is not.

This is what makes blocks cheap to work with: a caller only has to hold the
spec in mind, not the implementation, and a block can be rewritten freely as
long as its contract holds.

## Layout

```
blocks/
  index.md                 this file
  _template.spec.md        copy this to start a new block
  <Block>/
    <Block>.spec.md        the contract — exactly one per block
    <Block>.test.*         the tests — exactly one per claim
    ...                    implementation files, private to the block
```

Directories under `blocks/` that contain no `*.spec.md` are grouping
directories, so `blocks/forms/DatePicker/` is a block called `forms/DatePicker`.
A grouping directory may hold notes, but not source files of its own — and
neither may `blocks/` itself. Code under `blocks/` always belongs to some
block's contract.

Directories *inside* a block are part of it, so a block may organise itself with
`internal/`, `__tests__/` and so on. A `*.spec.md` in one of them makes a nested
block, verified in its own right.

## The contract summary

Every spec ends with a numbered **Contract summary** table. It is the machine
readable part of the spec: one row per claim, the first column being the claim
id.

```markdown
## Contract summary

| #  | Claim                                                        | Notes |
|----|--------------------------------------------------------------|-------|
| 1  | Renders nothing until `items` is non-empty.                  |       |
| 2  | Calls `onSelect` with the item id, once per click.           |       |
| 3  | Restores focus to the trigger when it closes.                |       |
```

A claim is one testable statement. If a row needs the word "and", it is
probably two claims.

Ids are stable: never renumber a claim to close a gap. Delete the row, delete
its test, and give the next new claim the next unused number.

## Test naming

Every test name starts with the id of the claim it proves:

```js
test('C3: restores focus to the trigger when it closes', async () => { ... })
```

Accepted forms are `C3: …`, `[C3] …` and `C3 - …`.

A skipped test does not prove anything, so `test.skip`, `test.todo`,
`{ skip: true }`, `xit` and a test inside `describe.skip` all count as *not*
covering their claim.

The correspondence is **one to one, in both directions**:

- every claim in the table has exactly one test
- every test names a claim that exists in the table

Helper assertions, fixtures and setup live inside those tests. If a behaviour
deserves its own test, it deserves a row in the table first.

## The gate

A `PostToolUse` hook runs `npx blockkit gate` after every `Write` or `Edit`.
When the edited file is under `blocks/`, it checks that one block and fails
with the exact claims that lack tests and the exact tests that lack claims.
Edits outside `blocks/` are ignored.

Run the same check across the whole repo with:

```sh
npx blockkit check
```

Wire that into CI and into a pre-commit hook.

## Adding a block

1. `cp blocks/_template.spec.md blocks/<Block>/<Block>.spec.md`
2. Fill in the spec — props, types, ownership, state, timing, failure modes,
   accessibility — and finish with the numbered contract summary.
3. Write `blocks/<Block>/<Block>.test.*`, one test per claim, named `C<n>: …`.
4. Implement until the tests pass.
5. Add the block to the table below.

Write the spec before the implementation. The spec is the design step; the
implementation is what is left once the design is settled.

## Changing a block

Changing behaviour means changing the contract summary first, then the test,
then the code. A change that does not alter any claim is a refactor and needs
no spec edit. A change that alters a claim is a contract change: check every
caller of the block.

## Blocks

| Block | Purpose | Spec |
|-------|---------|------|
| _none yet_ | | |
