import { relPosix } from './paths.js'

const STRUCTURAL = new Set([
  'missing-spec',
  'multiple-specs',
  'unreadable-spec',
  'unreadable-test',
  'no-contract-heading',
  'no-contract-table',
  'empty-contract-table',
  'invalid-claim-id',
  'duplicate-claim',
  'missing-test-file',
])

const NO_CLAIM = new Set(['test-without-claim', 'unknown-claim', 'unreadable-test-name'])

function rel(root, p) {
  return root ? relPosix(root, p) : p
}

function truncate(text, max = 96) {
  const t = String(text ?? '').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * Render one block's verification result as human-readable lines.
 * Returns '' when the block is fine.
 */
export function formatResult(result, { root = null } = {}) {
  if (result.ok) return ''
  const out = []
  out.push(`${result.id} — contract mismatch`)
  if (result.specPath) out.push(`  spec   ${rel(root, result.specPath)}`)
  if (result.testPaths.length > 0) {
    out.push(`  tests  ${result.testPaths.map((p) => rel(root, p)).join('\n         ')}`)
  }

  const structural = result.problems.filter((p) => STRUCTURAL.has(p.kind))
  const missingTests = result.problems.filter((p) => p.kind === 'claim-without-test')
  const missingClaims = result.problems.filter((p) => NO_CLAIM.has(p.kind))
  const other = result.problems.filter(
    (p) => !STRUCTURAL.has(p.kind) && !NO_CLAIM.has(p.kind) && p.kind !== 'claim-without-test',
  )

  if (structural.length > 0) {
    out.push('')
    for (const p of structural) out.push(`  ✗ ${p.message}`)
  }

  if (missingTests.length > 0) {
    out.push('')
    out.push(`  claims with no test (${missingTests.length}):`)
    for (const p of missingTests) {
      out.push(`    ${p.claimId.padEnd(5)}${truncate(p.claim?.text)}`)
    }
  }

  if (missingClaims.length > 0) {
    out.push('')
    out.push(`  tests with no claim (${missingClaims.length}):`)
    for (const p of missingClaims) {
      const where = `${rel(root, p.path)}:${p.line}`
      const what =
        p.kind === 'unreadable-test-name'
          ? '<name is not a literal>'
          : p.kind === 'unknown-claim'
            ? `${JSON.stringify(truncate(p.test?.name))} → ${p.claimId} is not in the contract summary`
            : JSON.stringify(truncate(p.test?.name))
      out.push(`    ${where}  ${what}`)
    }
  }

  if (other.length > 0) {
    out.push('')
    for (const p of other) {
      out.push(`  ✗ ${p.message}`)
      for (const t of p.tests ?? []) {
        out.push(`      ${rel(root, t.path)}:${t.line}  ${JSON.stringify(truncate(t.name))}`)
      }
    }
  }

  out.push('')
  out.push('  Every claim in the contract summary needs exactly one test whose name')
  out.push('  starts with its id, e.g. test(\'C3: …\'). Fix the spec or the tests.')
  return out.join('\n')
}

/** Render the orphan directories found under blocks/. */
export function formatOrphans(orphans, { root = null } = {}) {
  if (orphans.length === 0) return ''
  const out = ['source under blocks/ with no spec:']
  for (const o of orphans) out.push(`  ✗ ${rel(root, o.dir)}/  — holds source files but no *.spec.md`)
  return out.join('\n')
}

/** One-line tally for `blockkit check`. */
export function formatSummary(results, { orphans = [] } = {}) {
  const failing = results.filter((r) => !r.ok).length
  const claims = results.reduce((n, r) => n + r.claims.length, 0)
  const parts = [
    `${results.length} block${results.length === 1 ? '' : 's'}`,
    `${claims} claim${claims === 1 ? '' : 's'}`,
    `${results.length - failing} ok`,
    `${failing} failing`,
  ]
  if (orphans.length > 0) parts.push(`${orphans.length} without a spec`)
  return parts.join(' · ')
}

/** JSON-serialisable form of a result, with paths relative to the root. */
export function toJson(result, { root = null } = {}) {
  return {
    id: result.id,
    ok: result.ok,
    spec: result.specPath ? rel(root, result.specPath) : null,
    tests: result.testPaths.map((p) => rel(root, p)),
    claims: result.claims.map((c) => ({ id: c.id, text: c.text, line: c.line })),
    problems: result.problems.map((p) => ({
      kind: p.kind,
      message: p.message,
      claimId: p.claimId ?? null,
      path: p.path ? rel(root, p.path) : null,
      line: p.line ?? null,
    })),
  }
}
