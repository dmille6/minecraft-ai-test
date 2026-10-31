// qwen35load.mjs <bots-dir> <items.jsonl> <out.jsonl> <url> <model> <rate_per_min> [seed]
//
// qwen35-01 serving-capacity test (10-30). OPEN-LOOP: decisions ARRIVE as a Poisson process at <rate_per_min>,
// whatever the server is doing -- the way 10 bots on a 30-s cooldown arrive -- not a closed loop that slows down when
// the server does (which hides queueing). Each arrival is one real logged prompt (learnloop m3-eval.jsonl: the rebuilt
// system prompt, the logged user prompt, its sentinel and schema) sent through the FLEET'S OWN client
// (<bots-dir>/src/llm.mjs LlmClient.decide: grammar, options, repair retry, sentinel) with the fleet env's settings
// (OLLAMA_NUM_CTX 8192, LLM_MAX_TOKENS 512, LLM_TEMPERATURE 0.7, LLM_TIMEOUT_MS 45000 -- the 80 env files, 10-30).
// The output rows have replay_client.mjs's shape, so learnloop eval_offline.py scores them unchanged, plus `t_arrive`
// and `inflight_at_arrival`.
import fs from 'node:fs'

const [botsDir, itemsPath, outPath, url, model, rateS, seedS = '1030'] = process.argv.slice(2)
if (!rateS) { console.error('usage: qwen35load.mjs <bots-dir> <items.jsonl> <out.jsonl> <url> <model> <rate_per_min> [seed]'); process.exit(2) }
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/qwen35load-logs'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL = model
for (const [k, v] of [['OLLAMA_NUM_CTX', '8192'], ['LLM_MAX_TOKENS', '512'], ['LLM_TEMPERATURE', '0.7'], ['LLM_TIMEOUT_MS', '45000']]) {
  process.env[k] = process.env[k] || v
}
process.env.OLLAMA_BASE_URLS = url
process.env.OLLAMA_BASE_URL = url
const { config } = await import(botsDir + '/src/config.mjs')
const { LlmClient } = await import(botsDir + '/src/llm.mjs')
const client = new LlmClient({ baseUrls: [url], baseUrl: url, model, numCtx: config.llm.numCtx, maxTokens: config.llm.maxTokens,
                                temperature: config.llm.temperature, timeoutMs: config.llm.timeoutMs })

let s = Number(seedS) >>> 0
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296 }
const items = fs.readFileSync(itemsPath, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
const out = fs.createWriteStream(outPath, { flags: 'w' })
const rate = Number(rateS) / 60000           // per ms
console.error(`${model} @ ${url}: ${items.length} items, Poisson ${rateS}/min; numCtx ${config.llm.numCtx} maxTokens ${config.llm.maxTokens} ` +
              `temperature ${config.llm.temperature} timeoutMs ${config.llm.timeoutMs}`)
let inflight = 0, done = 0, errs = 0
const t0 = Date.now()
const pending = []
for (const it of items) {
  await new Promise(r => setTimeout(r, -Math.log(rnd()) / rate))
  const tArr = Date.now() - t0, inf = inflight
  inflight++
  pending.push((async () => {
    let rec
    try {
      const r = await client.decide({ system: it.system, user: it.user, sentinel: it.sentinel, schema: it.schema })
      rec = { id: it.id, model, url, proposal: r.proposal, schemaValid: r.schemaValid, error: r.error, retryCount: r.retryCount,
              latencyMs: r.latencyMs, argsCleaned: r.argsCleaned, raw: String(r.raw ?? '').slice(0, 4000), servedModel: r.model,
              endpoint: r.endpoint, prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens,
              load_duration_ns: r.load_duration_ns, transport_error: r.endpoint === null }
    } catch (e) {
      rec = { id: it.id, model, url, transport_error: true, error: String(e?.message ?? e) }
    }
    inflight--
    rec.t_arrive_ms = tArr; rec.inflight_at_arrival = inf
    errs += rec.transport_error ? 1 : 0
    out.write(JSON.stringify(rec) + '\n')
    if (++done % 50 === 0) console.error(`  ${done}/${items.length} at ${((Date.now() - t0) / 60000).toFixed(1)} min, transport errors ${errs}`)
  })())
}
await Promise.all(pending)
out.end()
console.error(`${model}: ${done} done in ${((Date.now() - t0) / 60000).toFixed(1)} min, ${errs} transport errors`)
process.exit(0)
