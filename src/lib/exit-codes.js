// Exit codes used across the CLI.
//
// HOOK_BLOCK is 2 on purpose: Claude Code treats exit code 2 from a PostToolUse
// hook as a blocking error and feeds the hook's stderr back to the model, which
// is exactly the feedback loop `blockkit gate` exists to create. Any other
// non-zero code would only be shown to the human.
export const EXIT = Object.freeze({
  OK: 0,
  MISMATCH: 1,
  HOOK_BLOCK: 2,
  USAGE: 64,
  INTERNAL: 70,
})
