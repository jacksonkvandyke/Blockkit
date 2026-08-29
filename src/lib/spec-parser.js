// Parses the numbered contract summary table out of a block's `.spec.md`.
//
// The table is the contract: one row per claim, first column the claim id.
// Everything else in the spec is prose for humans and models to read.

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/
const FENCE_RE = /^\s*(```+|~~~+)/
// Matches an id column header. Deliberately does not match a bare "Claim":
// that is the text column, and matching it here would swap the two.
const ID_HEADER_RE = /^(#|no\.?|id|claim\s*(#|id|no\.?))$/i
const TEXT_HEADER_RE = /(claim|contract|guarantee|behaviou?r|description|statement|assert)/i

/** A markdown table delimiter row, e.g. `|---|:--:|`. */
function isDelimiterRow(line) {
  const t = line.trim()
  if (!t.includes('-')) return false
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(t)
}

/** Split a markdown table row into trimmed cells, honouring `\|` escapes. */
export function splitRow(line) {
  const trimmed = line.trim()
  const cells = []
  let cur = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '\\' && trimmed[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  // The outer pipes produce empty cells at each end; drop only those.
  if (trimmed.startsWith('|')) cells.shift()
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|') && cells.length) cells.pop()
  return cells.map((c) => c.trim())
}

/** Normalise a claim id cell (`3`, `C3`, `[C3]`, `**C3**`) to `C3`, or null. */
export function parseClaimId(cell) {
  const cleaned = String(cell ?? '')
    .replace(/[`*_~[\]]/g, '')
    .trim()
  const m = /^C?\s*(\d+)\s*[.)]?$/i.exec(cleaned)
  return m ? `C${Number(m[1])}` : null
}

function normaliseText(cell) {
  return String(cell ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Parse a spec's contract summary.
 *
 * Returns `{ heading, claims, problems }`:
 *   heading  — `{ text, line }` of the contract summary heading, or null
 *   claims   — `[{ id, text, line }]` in document order
 *   problems — `[{ kind, message, line? }]` for anything malformed
 */
export function parseSpec(markdown, { path = '<spec>' } = {}) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const problems = []
  const claims = []

  // 1. Find the contract summary heading, ignoring fenced code blocks.
  let fence = null
  let headingIdx = -1
  let heading = null
  let fallbackIdx = -1
  let fallbackHeading = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0]
      else if (line.trim().startsWith(fence)) fence = null
      continue
    }
    if (fence !== null) continue
    const h = HEADING_RE.exec(line)
    if (!h) continue
    const text = h[2]
    if (!/contract/i.test(text)) continue
    if (/summary/i.test(text)) {
      headingIdx = i
      heading = { text, line: i + 1, level: h[1].length }
      break
    }
    if (fallbackIdx === -1) {
      fallbackIdx = i
      fallbackHeading = { text, line: i + 1, level: h[1].length }
    }
  }
  if (headingIdx === -1 && fallbackIdx !== -1) {
    headingIdx = fallbackIdx
    heading = fallbackHeading
  }

  if (headingIdx === -1) {
    problems.push({
      kind: 'no-contract-heading',
      message: 'no "## Contract summary" heading found',
      path,
    })
    return { heading: null, claims, problems }
  }

  // 2. Find every table under that heading. A spec is free to split its claims
  //    across subheadings; dropping all but the first table would silently lose
  //    claims, which is the one thing this parser must never do.
  const tableStarts = []
  fence = null
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0]
      else if (line.trim().startsWith(fence)) fence = null
      continue
    }
    if (fence !== null) continue
    const h = HEADING_RE.exec(line)
    // A subheading still belongs to this section; a sibling or parent heading
    // ends it.
    if (h && h[1].length <= heading.level) break
    // A table starts wherever a `|---|` divider follows a header row. Outer
    // pipes are optional, as they are in GitHub-flavoured Markdown.
    if (line.includes('|') && isDelimiterRow(lines[i + 1] ?? '')) {
      tableStarts.push(i)
      i++ // the divider is never a header row
    }
  }

  if (tableStarts.length === 0) {
    problems.push({
      kind: 'no-contract-table',
      message: `no table under "${heading.text}" (expected a header row, a \`|---|\` divider, then one row per claim)`,
      line: heading.line,
      path,
    })
    return { heading, claims, problems }
  }

  const seen = new Map()
  for (const start of tableStarts) {
    const header = splitRow(lines[start])
    // Rows have to keep the header's pipe style, so prose that happens to
    // contain a `|` does not get read as a claim.
    const outerPipes = lines[start].trim().startsWith('|')
    const isRow = (line) => {
      const t = line.trim()
      return t.includes('|') && (!outerPipes || t.startsWith('|'))
    }

    // 3. Work out which column holds the id and which holds the claim text.
    let idCol = header.findIndex((c) => ID_HEADER_RE.test(c.replace(/[`*_]/g, '').trim()))
    if (idCol === -1) idCol = 0
    let textCol = header.findIndex((c, n) => n !== idCol && TEXT_HEADER_RE.test(c))
    if (textCol === -1) textCol = idCol === 0 ? 1 : 0

    // 4. Read the rows.
    for (let r = start + 2; r < lines.length; r++) {
      const line = lines[r]
      if (!isRow(line)) break
      const cells = splitRow(line)
      if (cells.length === 0 || cells.every((c) => c === '')) continue

      const idCell = cells[idCol] ?? ''
      const id = parseClaimId(idCell)
      const text = normaliseText(cells[textCol] ?? '')

      if (id === null) {
        problems.push({
          kind: 'invalid-claim-id',
          message: `row ${r + 1}: "${idCell}" is not a claim id (expected a number, or C<n>)`,
          line: r + 1,
          path,
        })
        continue
      }
      if (seen.has(id)) {
        problems.push({
          kind: 'duplicate-claim',
          message: `${id} is listed twice (lines ${seen.get(id)} and ${r + 1})`,
          line: r + 1,
          path,
        })
        continue
      }
      seen.set(id, r + 1)
      claims.push({ id, text, line: r + 1 })
    }
  }
  claims.sort((a, b) => a.line - b.line)

  if (claims.length === 0 && !problems.some((p) => p.kind === 'invalid-claim-id')) {
    problems.push({
      kind: 'empty-contract-table',
      message: `the contract summary table under "${heading.text}" has no claims`,
      line: heading.line,
      path,
    })
  }

  return { heading, claims, problems }
}
