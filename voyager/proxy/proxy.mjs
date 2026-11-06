// voyager-01: THE LLM PROXY (design §6.1, §12 B2/R3). The only voyager process with internet access, and the only one
// that ever holds a key. One unix socket per arm; the socket decides the backend, the model and the limits, so a bot can
// choose none of them. Every call is a row (arm, purpose, model, latency, tokens, dollars).
//
// Paid outputs (arm C) are EVALUATION ONLY: never training data (owner 11-01, vendor terms A). Rows carry paid:true.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const CONFIG = process.env.VOYAGER_PROXY_CONFIG ?? '/etc/voyager/proxy.json'
const cfg = (() => {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch (e) { if (process.env.VOYAGER_PROXY_NO_LISTEN === '1') return { arms: {} }; throw e }
})()
const LOG = cfg.logFile ?? '/var/log/voyager/proxy.jsonl'
const SPEND = cfg.spendFile ?? '/var/lib/voyager-proxy/spend.json'
const MAX_BODY = 48 * 1024

const row = (o) => { try { fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n') } catch { /* logging must not stop the proxy */ } }

// SPEND: reserved before dispatch at the worst case, settled to the real usage after, persisted across restarts.
let spend = {}
try { spend = JSON.parse(fs.readFileSync(SPEND, 'utf8')) } catch { spend = {} }
const saveSpend = () => { try { fs.writeFileSync(`${SPEND}.tmp`, JSON.stringify(spend)); fs.renameSync(`${SPEND}.tmp`, SPEND) } catch { /* next save */ } }

/** Worst-case dollars for a request before it is sent. Pure. */
export function reserveUsd (arm, inputChars, maxTokens) {
  const inTok = Math.ceil(inputChars / 3)          // conservative: ~3 chars a token
  return (inTok * arm.inUsdPerMTok + maxTokens * arm.outUsdPerMTok) / 1e6
}
/** Dollars from a response's usage (cache reads priced at the input rate: an overestimate). Pure. */
export function usageUsd (arm, u) {
  const inTok = (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) * 1.25
  return (inTok * arm.inUsdPerMTok + (u?.output_tokens ?? 0) * arm.outUsdPerMTok) / 1e6
}

let anthropic = null
async function anthropicClient () {
  if (anthropic) return anthropic
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const key = fs.readFileSync(cfg.anthropicKeyFile, 'utf8').trim()
  anthropic = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 180_000 })
  return anthropic
}

async function ollamaChat (arm, { system, messages, max_tokens }) {
  const body = { model: arm.model, stream: false, keep_alive: arm.keepAlive ?? '15m', think: arm.think ?? false,
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    options: { num_ctx: arm.numCtx ?? 16384, num_predict: Math.min(max_tokens ?? 2048, arm.maxTokens ?? 4096), temperature: arm.temperature ?? 0.4 } }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), arm.timeoutMs ?? 240_000)
  try {
    const r = await fetch(`${arm.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
    const text = await r.text()
    if (!r.ok) throw new Error(`backend ${r.status}: ${text.slice(0, 160)}`)
    const d = JSON.parse(text)
    return { text: d.message?.content ?? '', usage: { input_tokens: d.prompt_eval_count ?? 0, output_tokens: d.eval_count ?? 0, load_ms: Math.round((d.load_duration ?? 0) / 1e6) } }
  } finally { clearTimeout(t) }
}

async function anthropicChat (arm, { system, messages, max_tokens }) {
  const c = await anthropicClient()
  const msg = await c.messages.create({
    model: arm.model,
    max_tokens: Math.min(max_tokens ?? 2048, arm.maxTokens ?? 4096),
    system: system ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : undefined,
    messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) })),
    output_config: { effort: arm.effort ?? 'low' },
  })
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
  return { text, usage: msg.usage, stop: msg.stop_reason }
}

// THE CONTROL's raw Ollama requests are rebuilt from an allowlist with the model forced (§12 R3).
/** Pure. */
export function rebuildControl (arm, body) {
  const o = body?.options ?? {}
  const keep = {}
  for (const k of ['temperature', 'num_ctx', 'num_predict', 'top_p']) if (typeof o[k] === 'number') keep[k] = o[k]
  keep.num_ctx = Math.min(keep.num_ctx ?? 8192, 8192)
  keep.num_predict = Math.min(keep.num_predict ?? 512, 1024)
  const messages = Array.isArray(body?.messages) ? body.messages.filter(m => m && typeof m.content === 'string' && ['system', 'user', 'assistant'].includes(m.role)).map(m => ({ role: m.role, content: m.content })) : []
  const out = { model: arm.model, stream: false, keep_alive: arm.keepAlive ?? '15m', messages, options: keep }
  if (body?.format && typeof body.format === 'object') out.format = body.format
  return out
}

function serveArm (name, arm) {
  const dir = path.join(cfg.socketDir ?? '/run/voyager', name)
  const sock = path.join(dir, 'llm.sock')
  try { fs.rmSync(sock, { force: true }) } catch {}
  let inflight = 0
  let hourStart = Date.now(), hourCalls = 0
  let nextFree = 0                    // duty cycle (arm B): earliest next dispatch
  spend[name] ??= { usd: 0, calls: 0 }

  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => { const s = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) }); res.end(s) }
    if (arm.backend === 'ollama-raw' && req.method === 'GET' && ['/api/version', '/api/tags'].includes(req.url)) {
      try { const r = await fetch(`${arm.url}${req.url}`); return send(r.status, await r.json()) } catch (e) { return send(502, { error: String(e.message) }) }
    }
    if (req.method !== 'POST') return send(405, { error: 'POST only' })
    let raw = ''
    let tooBig = false
    req.setEncoding('utf8')
    for await (const ch of req) { raw += ch; if (raw.length > MAX_BODY) { tooBig = true; break } }
    if (tooBig) return send(413, { error: `request over ${MAX_BODY} bytes` })
    let body
    try { body = JSON.parse(raw) } catch { return send(400, { error: 'not JSON' }) }
    if (Date.now() - hourStart > 3_600_000) { hourStart = Date.now(); hourCalls = 0 }
    if (hourCalls >= (arm.perHour ?? 300)) return send(429, { error: 'hourly call cap reached' })
    if (inflight >= (arm.inflight ?? 1)) return send(429, { error: 'one request at a time' })
    if (arm.paused) return send(503, { error: 'arm paused by the operator' })
    const wait = nextFree - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, Math.min(wait, 120_000)))
    inflight++; hourCalls++
    const t0 = Date.now()
    let reserved = 0
    const purpose = String(body.purpose ?? (arm.backend === 'ollama-raw' ? 'control' : '?')).slice(0, 16)
    try {
      if (arm.backend === 'anthropic') {
        reserved = reserveUsd(arm, raw.length, Math.min(body.max_tokens ?? 2048, arm.maxTokens ?? 4096))
        if (spend[name].usd + reserved > arm.capUsd) { row({ arm: name, purpose, refused: 'spend_cap', usd_total: spend[name].usd }); return send(402, { error: `spend cap $${arm.capUsd} reached` }) }
        spend[name].usd += reserved; saveSpend()
        const r = await anthropicChat(arm, body)
        const usd = usageUsd(arm, r.usage)
        spend[name].usd += usd - reserved; spend[name].calls++; saveSpend()
        row({ arm: name, purpose, model: arm.model, paid: true, ms: Date.now() - t0, usage: r.usage, usd: Math.round(usd * 1e6) / 1e6, usd_total: Math.round(spend[name].usd * 1e4) / 1e4, stop: r.stop })
        return send(200, { text: r.text, usage: r.usage, ms: Date.now() - t0 })
      }
      if (arm.backend === 'ollama-raw') {
        const fwd = rebuildControl(arm, body)
        const r = await fetch(`${arm.url}${req.url === '/api/chat' ? '/api/chat' : '/api/chat'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fwd) })
        const text = await r.text()
        let d = null; try { d = JSON.parse(text) } catch {}
        row({ arm: name, purpose, model: arm.model, ms: Date.now() - t0, status: r.status, usage: d ? { input_tokens: d.prompt_eval_count ?? 0, output_tokens: d.eval_count ?? 0 } : null })
        res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(text); return
      }
      const r = await ollamaChat(arm, body)
      row({ arm: name, purpose, model: arm.model, ms: Date.now() - t0, usage: r.usage })
      return send(200, { text: r.text, usage: r.usage, ms: Date.now() - t0 })
    } catch (e) {
      row({ arm: name, purpose, model: arm.model, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 200) })
      return send(502, { error: String(e?.message ?? e).slice(0, 200) })
    } finally {
      inflight--
      if (arm.dutyFactor) nextFree = Date.now() + (Date.now() - t0) * arm.dutyFactor
    }
  })
  server.listen(sock, () => {
    fs.chmodSync(sock, 0o660)
    if (arm.gid != null) fs.chownSync(sock, process.getuid(), arm.gid)
    row({ event: 'listening', arm: name, backend: arm.backend, model: arm.model })
  })
}

// Re-read `paused` flags from the config every 30 s so an operator can pause an arm (e.g. the Studio arm) without a restart.
setInterval(() => {
  try {
    const c2 = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
    for (const [n, a] of Object.entries(c2.arms ?? {})) if (cfg.arms[n]) { cfg.arms[n].paused = !!a.paused; cfg.arms[n].dutyFactor = a.dutyFactor ?? cfg.arms[n].dutyFactor }
  } catch { /* keep the last good config */ }
}, 30_000).unref()

if (process.env.VOYAGER_PROXY_NO_LISTEN !== '1') for (const [n, a] of Object.entries(cfg.arms)) serveArm(n, a)
