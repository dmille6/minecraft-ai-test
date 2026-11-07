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
// a MISSING record starts at zero; an UNREADABLE one fails closed: no paid call until an operator repairs it (Codex r3 7)
let spend = {}
let spendCorrupt = false
if (fs.existsSync(SPEND)) { try { spend = JSON.parse(fs.readFileSync(SPEND, 'utf8')) } catch { spend = {}; spendCorrupt = true } }
// throws: a reservation that cannot be persisted is not dispatched (fail closed, Codex r2 B7)
const saveSpend = () => { fs.writeFileSync(`${SPEND}.tmp`, JSON.stringify(spend)); fs.renameSync(`${SPEND}.tmp`, SPEND) }

/** Worst-case dollars for a request before it is sent. Pure. */
export function reserveUsd (arm, inputChars, maxTokens) {
  // an UPPER bound (Codex r2 B7, r3 7): byte-level BPE gives at most one token per UTF-8 byte of the body, plus a fixed
  // allowance for the message framing, all priced at the cache-WRITE rate. `inputChars` is the body's byte length.
  const inTok = (Math.ceil(inputChars) + 512) * 1.25
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
  const pos = (v, max, dflt) => (Number.isInteger(v) && v >= 1 && v <= max) ? v : dflt      // -1 means unlimited in Ollama: refused (Codex r2 B6)
  const unit = (v, max, dflt) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max) ? v : dflt
  keep.num_ctx = pos(o.num_ctx, 8192, 8192)
  keep.num_predict = pos(o.num_predict, 1024, 512)
  keep.temperature = unit(o.temperature, 2, 0.7)
  if (o.top_p != null) keep.top_p = unit(o.top_p, 1, 0.9)
  const messages = Array.isArray(body?.messages) ? body.messages.filter(m => m && typeof m.content === 'string' && ['system', 'user', 'assistant'].includes(m.role)).map(m => ({ role: m.role, content: m.content })) : []
  const out = { model: arm.model, stream: false, keep_alive: arm.keepAlive ?? '15m', messages, options: keep }
  if (body?.format && typeof body.format === 'object') out.format = body.format
  return out
}

// THE STUDIO IS SHARED (owner 11-07): arms in the same `group` never run concurrently (they alternate), and the showcase
// guard (watch/studio_guard.py writes cfg.guardFile) backs `guarded` arms off: level 1 = 4x the duty gap, level 2 = paused.
// A guard file older than 5 min counts as level 1: if the guard dies, the local arms slow down rather than run free.
const groupBusy = new Map()
let guard = { level: 0, reason: 'no guard file yet' }
function readGuard () {
  if (!cfg.guardFile) return
  try {
    const g = JSON.parse(fs.readFileSync(cfg.guardFile, 'utf8'))
    const age = Date.now() - Date.parse(g.at)
    const next = age > 300_000 ? { level: Math.max(1, g.level ?? 0), reason: `guard stale (${Math.round(age / 1000)} s)` } : { level: g.level ?? 0, reason: g.reason ?? '' }
    if (next.level !== guard.level) row({ event: 'guard_level', from: guard.level, to: next.level, reason: next.reason })
    guard = next
  } catch { if (guard.level < 1) { row({ event: 'guard_level', from: guard.level, to: 1, reason: 'guard file unreadable' }); guard = { level: 1, reason: 'guard file unreadable' } } }
}
if (cfg.guardFile) { readGuard(); setInterval(readGuard, 15_000).unref() }
/** The guard's effect on one arm. Pure. */
export function guardEffect (arm, level) {
  if (!arm.guarded || !level) return { paused: false, factor: 1 }
  return level >= 2 ? { paused: true, factor: 1 } : { paused: false, factor: 4 }
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
    // the control's health probes are answered HERE, never forwarded (Codex r3 6: no unbounded fetch outside the limits)
    if (arm.backend === 'ollama-raw' && req.method === 'GET' && req.url === '/api/version') return send(200, { version: 'voyager-proxy' })
    if (arm.backend === 'ollama-raw' && req.method === 'GET' && req.url === '/api/tags') return send(200, { models: [{ name: arm.model, model: arm.model }] })
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
    if (inflight >= (arm.inflight ?? 1)) return send(429, { error: 'one request at a time' })
    // a guard pause and the other arm's turn are WAITED out (bounded), so the loop does not burn its rounds on refusals
    for (let w = 0; guardEffect(arm, guard.level).paused && w < 240; w++) await new Promise(r => setTimeout(r, 500))
    if (guardEffect(arm, guard.level).paused) return send(503, { error: `paused by the showcase guard: ${guard.reason}` })
    for (let w = 0; arm.group && groupBusy.get(arm.group) && w < 600; w++) await new Promise(r => setTimeout(r, 500))
    if (arm.group && groupBusy.get(arm.group)) return send(429, { error: `another arm on ${arm.group} is still running` })
    // max_tokens must be a whole number 1..arm.maxTokens: a NaN or negative value must never reach the spend cap (review 11)
    const cap = arm.maxTokens ?? 4096
    const mt = body.max_tokens == null ? 2048 : Number(body.max_tokens)
    if (!Number.isInteger(mt) || mt < 1 || mt > cap) return send(400, { error: `max_tokens must be a whole number 1-${cap}` })
    body.max_tokens = mt
    if (body.messages != null && !Array.isArray(body.messages)) return send(400, { error: 'messages must be a list' })
    inflight++; hourCalls++          // counted BEFORE the duty-cycle wait, so a second request is refused meanwhile
    if (arm.group) groupBusy.set(arm.group, name)
    const wait = nextFree - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, Math.min(wait, 120_000)))
    const t0 = Date.now()
    let reserved = 0
    const purpose = String(body.purpose ?? (arm.backend === 'ollama-raw' ? 'control' : '?')).slice(0, 16)
    try {
      if (arm.backend === 'anthropic') {
        reserved = reserveUsd(arm, Buffer.byteLength(raw, 'utf8'), body.max_tokens)
        if (!Number.isFinite(spend[name].usd)) spend[name].usd = arm.capUsd   // a corrupted total fails closed
        if (spendCorrupt) { row({ arm: name, purpose, refused: 'spend_record_unreadable' }); return send(503, { error: 'spend record unreadable; refusing paid calls' }) }
        if (!(reserved > 0) || spend[name].usd + reserved > arm.capUsd) { row({ arm: name, purpose, refused: 'spend_cap', usd_total: spend[name].usd }); return send(402, { error: `spend cap $${arm.capUsd} reached` }) }
        spend[name].usd += reserved
        try { saveSpend() } catch (e) { spend[name].usd -= reserved; reserved = 0; row({ arm: name, purpose, refused: 'spend_not_persisted', error: String(e.message).slice(0, 80) }); return send(503, { error: 'spend record not writable; refusing' }) }
        const r = await anthropicChat(arm, body)
        const usd = usageUsd(arm, r.usage)
        spend[name].usd += usd - reserved; spend[name].calls++   // settle the reservation to the real usage
        try { saveSpend() } catch { /* the reservation already covered it */ }
        row({ arm: name, purpose, model: arm.model, paid: true, ms: Date.now() - t0, usage: r.usage, usd: Math.round(usd * 1e6) / 1e6, usd_total: Math.round(spend[name].usd * 1e4) / 1e4, stop: r.stop })
        return send(200, { text: r.text, usage: r.usage, ms: Date.now() - t0 })
      }
      if (arm.backend === 'ollama-raw') {
        const fwd = rebuildControl(arm, body)
        const ctl = new AbortController()
        const tm = setTimeout(() => ctl.abort(), arm.timeoutMs ?? 60_000)
        let r, text
        try {
          r = await fetch(`${arm.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fwd), signal: ctl.signal })
          text = await r.text()
        } finally { clearTimeout(tm) }
        let d = null; try { d = JSON.parse(text) } catch {}
        row({ arm: name, purpose, model: arm.model, ms: Date.now() - t0, status: r.status, usage: d ? { input_tokens: d.prompt_eval_count ?? 0, output_tokens: d.eval_count ?? 0 } : null })
        res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(text); return
      }
      const r = await ollamaChat(arm, body)
      row({ arm: name, purpose, model: arm.model, ms: Date.now() - t0, usage: r.usage })
      return send(200, { text: r.text, usage: r.usage, ms: Date.now() - t0 })
    } catch (e) {
      // the reservation stays charged: a failed or timed-out paid request may still have been billed (design §12 R3)
      row({ arm: name, purpose, model: arm.model, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 200), usd_reserved_kept: reserved || undefined })
      return send(502, { error: String(e?.message ?? e).slice(0, 200) })
    } finally {
      inflight--
      if (arm.group && groupBusy.get(arm.group) === name) groupBusy.delete(arm.group)
      const factor = (arm.dutyFactor ?? 0) * guardEffect(arm, guard.level).factor
      if (factor) nextFree = Date.now() + (Date.now() - t0) * factor
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
