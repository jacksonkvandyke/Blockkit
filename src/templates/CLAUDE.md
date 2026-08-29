# Project notes

## Blocks

This repo is organised into blocks. **Read [blocks/index.md](blocks/index.md)
before touching anything under `blocks/`** — it defines the layout, the
contract summary format, and the test naming rule.

**Specs are read. Block source is not.**

To use a block, read `blocks/<Block>/<Block>.spec.md` and nothing else. Do not
open a block's implementation to find out how it behaves; if the spec does not
answer the question, the spec is incomplete and updating it is the task.

Every claim in a spec's contract summary must be proved by exactly one test
named after it (`C3: …`), and every test must name a claim that exists. A
`PostToolUse` hook runs `npx blockkit gate` after each edit under `blocks/` and
reports any mismatch. Run `npx blockkit check` before committing.

## Working order

1. Write or update the spec, including the contract summary.
2. Write one test per claim.
3. Implement until the tests pass.
