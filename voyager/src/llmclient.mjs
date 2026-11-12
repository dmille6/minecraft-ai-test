// voyager-01: the bot's ONLY route to a model -- HTTP over the unix socket the proxy listens on (design §3.2, §6.1).
// The socket path decides the arm, the model and the budget; nothing here can choose them.

import http from 'node:http'

export function chat ({ socketPath, purpose, system, messages, maxTokens = 2048, timeoutMs = 240_000, cacheSplit = null }) {
  // cache_split (harness 2): how many leading characters of the LAST message are the same on every round of a task. The
  // message itself is always whole, so a proxy that does not know the field loses nothing.
  const body = JSON.stringify({ purpose, system, messages, max_tokens: maxTokens, ...(Number.isInteger(cacheSplit) ? { cache_split: cacheSplit } : {}) })
  return new Promise((resolve) => {
    const req = http.request({ socketPath, path: '/chat', method: 'POST', timeout: timeoutMs,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', d => { if (data.length < 400_000) data += d })
      res.on('end', () => {
        try {
          const j = JSON.parse(data)
          resolve(res.statusCode === 200 ? { ok: true, text: String(j.text ?? ''), usage: j.usage ?? null, ms: j.ms ?? null, stop: j.stop ?? null }
                                         : { ok: false, error: j.error ?? `status ${res.statusCode}` })
        } catch { resolve({ ok: false, error: `unreadable reply (status ${res.statusCode})` }) }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', e => resolve({ ok: false, error: String(e?.message ?? e) }))
    req.end(body)
  })
}
