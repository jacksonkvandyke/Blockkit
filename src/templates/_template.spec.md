# \<Block\> — spec

> Status: draft
> Owner: \<team or person\>
> Consumers: \<who renders or calls this\>

Copy this file to `blocks/<Block>/<Block>.spec.md` and replace every angle
bracket. Delete sections that genuinely do not apply — but say so, rather than
leaving them blank. A blank section reads as "not thought about yet".

## Purpose

One paragraph. What this block is responsible for, and the one sentence a
caller needs in order to decide whether to use it.

**Not** responsible for: \<the nearest thing it is often confused with\>.

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `items` | `Item[]` | yes | — | \<what it means, not what it is\> |
| `onSelect` | `(id: string) => void` | no | `undefined` | \<when it fires\> |

Unlisted props are not supported. If a caller needs one, it is a spec change.

## Types

```ts
export type Item = {
  id: string
  label: string
}
```

Every type named in the props table is defined here or imported from a named
module. A caller must never have to open the implementation to learn a shape.

## Ownership

### This block owns

- \<state, DOM, subscriptions, timers it creates and destroys\>

### The parent owns

- \<data fetching, persistence, routing, layout, anything it receives\>

### Neither owns

- \<explicitly out of scope, so the gap is deliberate and visible\>

## State shape

```ts
type State = {
  status: 'idle' | 'open' | 'closing'
  selectedId: string | null
}
```

| Field | Initial | Changes when | Resets when |
|-------|---------|--------------|-------------|
| `status` | `'idle'` | \<event\> | \<event\> |

Say which state is derived rather than stored, and what is deliberately *not*
kept in state.

## Callback timing

| Callback | Fires when | Fires how often | Arguments |
|----------|------------|-----------------|-----------|
| `onSelect` | after the selection commits | once per commit | `(id)` |

Be precise about ordering: before or after the internal state update, before or
after animation, synchronously or on the next tick. Timing is the part callers
get wrong.

## Async behaviour

- **In flight:** \<what renders, what is disabled\>
- **Concurrency:** \<latest wins, queued, or rejected while busy\>
- **Cancellation:** \<what happens on unmount or on a superseding call\>
- **Retries:** \<automatic or not, how many, with what backoff\>

## Failure modes

| Condition | Behaviour | Surfaced as |
|-----------|-----------|-------------|
| \<empty input\> | \<renders nothing\> | — |
| \<request fails\> | \<keeps the last good value\> | `onError(err)` |
| \<invalid prop\> | \<throws in development, ignores in production\> | console error |

Cover at least: empty, loading, error, and the case where the parent passes
something the block cannot use.

## Accessibility

- **Role / semantics:** \<the element and role used\>
- **Keyboard:** \<every key that does something, and what\>
- **Focus:** \<where focus starts, moves, and returns to\>
- **Screen reader:** \<what is announced, and what is hidden\>
- **Motion:** \<what `prefers-reduced-motion` changes\>

## Contract summary

One row per testable claim. Each claim gets exactly one test, named `C<n>: …`.
Ids are permanent — never renumber to close a gap.

| # | Claim | Notes |
|---|-------|-------|
| 1 | \<one testable statement\> | |
| 2 | \<one testable statement\> | |
| 3 | \<one testable statement\> | |
