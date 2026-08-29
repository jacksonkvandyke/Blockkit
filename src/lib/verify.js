import { readText } from './fsx.js'
import { parseSpec } from './spec-parser.js'
import { parseTestSource } from './test-parser.js'

/**
 * Check one block: every claim in its contract summary must be proved by
 * exactly one test, and every test must name a claim.
 *
 * `block` is `{ id, dir, specPaths, testPaths }` from `blocks.js`.
 * Returns `{ id, dir, specPath, testPaths, claims, tests, problems, ok }`.
 */
export function verifyBlock(block, { allowSkipped = false } = {}) {
  const result = {
    id: block.id,
    dir: block.dir,
    specPath: block.specPaths[0] ?? null,
    specPaths: block.specPaths,
    testPaths: block.testPaths,
    claims: [],
    tests: [],
    problems: [],
    ok: false,
  }
  const push = (kind, message, extra = {}) => result.problems.push({ kind, message, ...extra })

  if (block.specPaths.length === 0) {
    push('missing-spec', `no spec: expected a \`*.spec.md\` in ${block.id}`)
    return finish(result)
  }
  if (block.specPaths.length > 1) {
    push(
      'multiple-specs',
      `${block.specPaths.length} spec files in one block (a block has exactly one contract)`,
      { paths: block.specPaths },
    )
  }

  const specText = readText(result.specPath)
  if (specText === null) {
    push('unreadable-spec', `could not read ${result.specPath}`)
    return finish(result)
  }

  const spec = parseSpec(specText, { path: result.specPath })
  result.claims = spec.claims
  for (const p of spec.problems) push(p.kind, p.message, { line: p.line, path: p.path })
  if (spec.claims.length === 0) return finish(result)

  for (const testPath of block.testPaths) {
    const source = readText(testPath)
    if (source === null) {
      push('unreadable-test', `could not read ${testPath}`)
      continue
    }
    result.tests.push(...parseTestSource(source, testPath).tests)
  }

  if (block.testPaths.length === 0) {
    push(
      'missing-test-file',
      `no test file: expected \`${lastSegment(block.id)}.test.*\` (or a \`__tests__/\` file) in ${block.id}`,
    )
  }

  const byClaim = new Map()
  for (const claim of spec.claims) byClaim.set(claim.id, [])

  for (const test of result.tests) {
    if (test.claim === null) {
      if (test.dynamic && test.name === null) {
        push('unreadable-test-name', 'test name is not a literal, so it cannot declare a claim', {
          path: test.path,
          line: test.line,
          test,
        })
      } else {
        push('test-without-claim', `test names no claim: ${JSON.stringify(test.name)}`, {
          path: test.path,
          line: test.line,
          test,
        })
      }
      continue
    }
    if (!byClaim.has(test.claim)) {
      push('unknown-claim', `test names ${test.claim}, which the contract summary does not list`, {
        path: test.path,
        line: test.line,
        test,
        claimId: test.claim,
      })
      continue
    }
    byClaim.get(test.claim).push(test)
  }

  for (const claim of spec.claims) {
    const tests = byClaim.get(claim.id)
    if (tests.length === 0) {
      push('claim-without-test', `${claim.id} has no test`, { claimId: claim.id, claim })
      continue
    }
    if (tests.length > 1) {
      push(
        'duplicate-test',
        `${claim.id} is claimed by ${tests.length} tests (a claim is proved by exactly one)`,
        { claimId: claim.id, claim, tests },
      )
      continue
    }
    if (!allowSkipped && tests[0].status === 'skipped') {
      push('skipped-test', `${claim.id} is only covered by a skipped test`, {
        claimId: claim.id,
        claim,
        path: tests[0].path,
        line: tests[0].line,
        tests,
      })
    }
  }

  return finish(result)
}

function finish(result) {
  result.ok = result.problems.length === 0
  return result
}

function lastSegment(id) {
  const parts = String(id).split('/')
  return parts[parts.length - 1] || id
}

/** Verify a whole set of blocks. */
export function verifyBlocks(blocks, options) {
  return blocks.map((block) => verifyBlock(block, options))
}
