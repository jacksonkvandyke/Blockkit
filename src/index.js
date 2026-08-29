// Programmatic entry point. The CLI is the supported interface; these exports
// exist so the parsers can be reused (and tested) directly.
export { main, USAGE } from './cli.js'
export { blockForFile, discoverBlocks, isBlockDir, specFilesIn, testFilesIn } from './lib/blocks.js'
export { EXIT } from './lib/exit-codes.js'
export { formatOrphans, formatResult, formatSummary, toJson } from './lib/report.js'
export { maskLiterals, stripComments } from './lib/scan.js'
export { parseClaimId, parseSpec, splitRow } from './lib/spec-parser.js'
export { parseClaimTag, parseTestSource } from './lib/test-parser.js'
export { verifyBlock, verifyBlocks } from './lib/verify.js'
