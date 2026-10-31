// batchload.mjs <bots-dir> <items.jsonl> <out.jsonl> <url> <model> <open|closed> <rate_per_min|concurrency> <n> <offset> <api: oai|ollama> [seed]
// Batching-server capacity test (10-31). Same request path as qwen35load.mjs: the FLEET'S OWN client
// (bots/src/llm.mjs LlmClient.decide: schema grammar, repair retry, sentinel check) with the fleet env settings.
// api=oai: global fetch is wrapped so the client's Ollama /api/chat call is sent to llama-server's
// /v1/chat/completions (format -> response_format json_schema; temperature; num_predict -> max_tokens) and the answer
// mapped back. Validation stays the client's own. open = Poisson arrivals at rate/min; closed = N workers back to back.
import fs from 'node:fs'
const [botsDir, itemsPath, outPath, url, model, mode, paramS, nS, offS, api, seedS = '1031'] = process.argv.slice(2)
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/batchload-logs'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL = model
for (const [k, v] of [['OLLAMA_NUM_CTX', '8192'], ['LLM_MAX_TOKENS', '512'], ['LLM_TEMPERATURE', '0.7'], ['LLM_TIMEOUT_MS', '45000']]) process.env[k] = process.env[k] || v
process.env.OLLAMA_BASE_URLS = url; process.env.OLLAMA_BASE_URL = url
const timings = new Map()   // content -> server timings (oai only)
if (api === 'ollama-nothink') {
  // The 3090's Ollama 0.32.14 THINKS when think is unset (512 thinking tokens, empty content); the Blackwell's 0.33.2
  // does not. think:false reproduces what the fleet actually gets from its server.
  const realFetch = globalThis.fetch
  globalThis.fetch = async (u, init) => {
    if (!String(u).endsWith('/api/chat')) return realFetch(u, init)
    const b = JSON.parse(init.body); b.think = false
    return realFetch(u, { ...init, body: JSON.stringify(b) })
  }
}
if (api === 'oai') {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (u, init) => {
    if (!String(u).endsWith('/api/chat')) return realFetch(u, init)
    const b = JSON.parse(init.body)
    const body = { model: b.model, messages: b.messages, stream: false, temperature: b.options?.temperature,
                   max_tokens: b.options?.num_predict,
                   response_format: { type: 'json_schema', json_schema: { name: 'decision', schema: b.format } } }
    const r = await realFetch(String(u).replace(/\/api\/chat$/, '/v1/chat/completions'),
                              { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: init.signal, body: JSON.stringify(body) })
    if (!r.ok) return r
    const d = await r.json()
    const content = d.choices?.[0]?.message?.content ?? ''
    timings.set(content, { cache_n: d.timings?.cache_n ?? null, prompt_n: d.timings?.prompt_n ?? null, prompt_ms: d.timings?.prompt_ms ?? null, predicted_ms: d.timings?.predicted_ms ?? null })
    const t = d.timings || {}
    const out = { model: d.model, message: { role: 'assistant', content }, prompt_eval_count: d.usage?.prompt_tokens,
                  eval_count: d.usage?.completion_tokens,
                  prompt_eval_duration: t.prompt_ms != null ? Math.round(t.prompt_ms * 1e6) : null,
                  eval_duration: t.predicted_ms != null ? Math.round(t.predicted_ms * 1e6) : null,
                  cached_tokens: t.cache_n ?? null, load_duration: 0 }
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}
const { config } = await import(botsDir + '/src/config.mjs')
const { LlmClient } = await import(botsDir + '/src/llm.mjs')
const client = new LlmClient({ baseUrls: [url], baseUrl: url, model, numCtx: config.llm.numCtx, maxTokens: config.llm.maxTokens,
                               temperature: config.llm.temperature, timeoutMs: config.llm.timeoutMs })
let s = Number(seedS) >>> 0
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296 }
const all = fs.readFileSync(itemsPath, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
const n = Number(nS), off = Number(offS)
const items = Array.from({ length: n }, (_, i) => all[(off + i) % all.length])
if (n > all.length) console.error(`WARNING n ${n} > ${all.length} unique items: repeats`)
const out = fs.createWriteStream(outPath, { flags: 'w' })
console.error(`${model} @ ${url} api=${api} ${mode} ${paramS}: ${n} items from offset ${off}; ctx ${config.llm.numCtx} max ${config.llm.maxTokens} T ${config.llm.temperature} timeout ${config.llm.timeoutMs}`)
let inflight = 0, done = 0, errs = 0
const t0 = Date.now()
async function one(it) {
  const tArr = Date.now() - t0, inf = inflight
  inflight++
  let rec
  try {
    const r = await client.decide({ system: it.system, user: it.user, sentinel: it.sentinel, schema: it.schema })
    rec = { id: it.id, model, proposal: r.proposal, schemaValid: r.schemaValid, error: r.error, retryCount: r.retryCount,
            latencyMs: r.latencyMs, raw: String(r.raw ?? '').slice(0, 2000), servedModel: r.model, endpoint: r.endpoint,
            prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens,
            prompt_eval_duration_ns: r.prompt_eval_duration_ns, eval_duration_ns: r.eval_duration_ns, transport_error: r.endpoint === null }
    rec.server = timings.get(r.raw) ?? null; timings.delete(r.raw)
  } catch (e) { rec = { id: it.id, model, transport_error: true, error: String(e?.message ?? e) } }
  inflight--
  rec.t_arrive_ms = tArr; rec.t_done_ms = Date.now() - t0; rec.inflight_at_arrival = inf
  errs += rec.transport_error ? 1 : 0
  out.write(JSON.stringify(rec) + '\n')
  if (++done % 50 === 0) console.error(`  ${done}/${n} at ${((Date.now() - t0) / 60000).toFixed(1)} min, transport errors ${errs}`)
}
if (mode === 'open') {
  const rate = Number(paramS) / 60000
  const pending = []
  for (const it of items) { await new Promise(r => setTimeout(r, -Math.log(rnd()) / rate)); pending.push(one(it)) }
  await Promise.all(pending)
} else {
  let next = 0
  await Promise.all(Array.from({ length: Number(paramS) }, async () => { while (next < items.length) await one(items[next++]) }))
}
out.end()
console.error(`DONE ${model} ${mode} ${paramS}: ${done} in ${((Date.now() - t0) / 60000).toFixed(2)} min, ${errs} transport errors`)
process.exit(0)
