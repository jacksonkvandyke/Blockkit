/**
 * Minimal flag parser. Supports `--flag`, `--key value`, `--key=value` and
 * `--` to stop parsing. Unknown flags are reported rather than ignored, so a
 * typo in a hook command surfaces instead of silently disabling a check.
 */
export function parseArgs(argv, { boolean = [], string = [], alias = {} } = {}) {
  const flags = Object.create(null)
  const positional = []
  const errors = []
  const booleans = new Set(boolean)
  const strings = new Set(string)

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg)
      continue
    }

    let name = arg.replace(/^--?/, '')
    let value = null
    const eq = name.indexOf('=')
    if (eq !== -1) {
      value = name.slice(eq + 1)
      name = name.slice(0, eq)
    }
    if (Object.prototype.hasOwnProperty.call(alias, name)) name = alias[name]

    if (booleans.has(name)) {
      if (value !== null && !/^(true|false)$/i.test(value)) {
        errors.push(`--${name} does not take a value`)
        continue
      }
      flags[name] = value === null ? true : value.toLowerCase() === 'true'
      continue
    }
    if (strings.has(name)) {
      if (value === null) {
        value = argv[++i]
        if (value === undefined) {
          errors.push(`--${name} needs a value`)
          continue
        }
      }
      flags[name] = value
      continue
    }
    errors.push(`unknown option: ${arg}`)
  }

  return { flags, positional, errors }
}
