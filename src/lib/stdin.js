/**
 * Read all of stdin as UTF-8, or null when there is nothing to read.
 *
 * The gate runs after every matched edit, so it must never hang: if no payload
 * arrives within `timeoutMs` the stream is torn down and the caller treats it
 * as "no payload" and exits cleanly.
 */
export function readStdin({ timeoutMs = 5000, stream = process.stdin } = {}) {
  return new Promise((resolvePromise) => {
    if (stream.isTTY) {
      resolvePromise(null)
      return
    }

    const chunks = []
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stream.removeListener('data', onData)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onError)
      resolvePromise(value)
    }

    const onData = (chunk) => chunks.push(chunk)
    const onEnd = () => finish(Buffer.concat(chunks).toString('utf8'))
    const onError = () => finish(null)

    const timer = setTimeout(() => {
      try {
        stream.destroy()
      } catch {
        /* already gone */
      }
      finish(chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null)
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    stream.on('data', onData)
    stream.on('end', onEnd)
    stream.on('error', onError)
    if (typeof stream.resume === 'function') stream.resume()
  })
}

/**
 * Pull the edited file path out of a Claude Code hook payload.
 * `tool_input.file_path` is what Write and Edit provide; notebook edits use
 * `notebook_path`.
 */
export function filePathFromPayload(payload) {
  const input = payload && typeof payload === 'object' ? payload.tool_input : null
  if (!input || typeof input !== 'object') return null
  for (const key of ['file_path', 'notebook_path', 'filePath']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}
