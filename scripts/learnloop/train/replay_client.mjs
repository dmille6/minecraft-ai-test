// replay_client.mjs <bots-dir> <items.jsonl> <out.jsonl> <ollama-url> <model> [concurrency]
//
// Learning loop M3 offline evaluation, step 1: replay held-out decisions through the FLEET'S OWN CLIENT. Each item
// (build_dataset.py m3-eval.jsonl: rebuilt system prompt, the logged user prompt, its saw_end sentinel and the
// version's JSON schema) is sent with <bots-dir>/src/llm.mjs's LlmClient.decide() -- the same grammar, options
// (num_ctx, num_predict, temperature, keep_alive), repair retry, sentinel check and cleanArgs the bots run. Nothing is
// re-implemented, so a template that injects think tags, or a model that cannot follow the grammar, shows up exactly
// as it would on the fleet: schemaValid=false, a sentinel mismatch, a retry.
//
// <bots-dir> is a `git archive` of the code version being scored (run.sh makes one), with node_modules linked; the
// client's numCtx/maxTokens/temperature/timeout are the fleet env files' values (below), read by that version's config.mjs. Resumable: ids already in <out.jsonl> without an error are skipped.
import fs from 'node:fs'
import readline from 'node:readline'

const [botsDir, itemsPath, outPath, url, model, conc = '2'] = process.argv.slice(2)
if (!model) { console.error('usage: replay_client.mjs <bots-dir> <items.jsonl> <out.jsonl> <ollama-url> <model> [concurrency]'); process.exit(2) }
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/learnloop-replay-logs'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL = model
// THE FLEET'S CLIENT SETTINGS (all 80 env files, read 10-22): OLLAMA_NUM_CTX=8192, LLM_MAX_TOKENS=512,
// LLM_TEMPERATURE=0.7, LLM_TIMEOUT_MS=45000. config.mjs's own defaults differ (4096 / 512 / 0.3 / 90000), so these are
// set explicitly; an override in the environment wins and is printed.
for (const [k, v] of [['OLLAMA_NUM_CTX', '8192'], ['LLM_MAX_TOKENS', '512'], ['LLM_TEMPERATURE', '0.7'], ['LLM_TIMEOUT_MS', '45000']]) {
  process.env[k] = process.env[k] || v
}
process.env.OLLAMA_BASE_URLS = url
process.env.OLLAMA_BASE_URL = url
const { config } = await import(botsDir + '/src/config.mjs')
const { LlmClient } = await import(botsDir + '/src/llm.mjs')
const client = new LlmClient({ baseUrls: [url], baseUrl: url, model, numCtx: config.llm.numCtx, maxTokens: config.llm.maxTokens,
                                temperature: config.llm.temperature, timeoutMs: config.llm.timeoutMs })

const done = new Set()
if (fs.existsSync(outPath)) {
  for (const l of fs.readFileSync(outPath, 'utf8').split('\n')) {
    if (!l.trim()) continue
    try { const r = JSON.parse(l); if (!r.transport_error) done.add(r.id) } catch {}
  }
}
const items = []
for await (const l of readline.createInterface({ input: fs.createReadStream(itemsPath) })) {
  if (!l.trim()) continue
  const it = JSON.parse(l)
  if (!done.has(it.id)) items.push(it)
}
const out = fs.createWriteStream(outPath, { flags: 'a' })
console.error(`${model} @ ${url}: ${items.length} items (${done.size} done); numCtx ${config.llm.numCtx} maxTokens ${config.llm.maxTokens} temperature ${config.llm.temperature} timeoutMs ${config.llm.timeoutMs}`)
let i = 0, n = 0, errs = 0
async function worker () {
  while (i < items.length) {
    const it = items[i++]
    const t0 = Date.now()
    let rec
    try {
      const r = await client.decide({ system: it.system, user: it.user, sentinel: it.sentinel, schema: it.schema })
      rec = { id: it.id, model, url, proposal: r.proposal, schemaValid: r.schemaValid, error: r.error, retryCount: r.retryCount,
              latencyMs: r.latencyMs, argsCleaned: r.argsCleaned, raw: String(r.raw ?? '').slice(0, 4000), servedModel: r.model,
              endpoint: r.endpoint, prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens,
              load_duration_ns: r.load_duration_ns, transport_error: r.endpoint === null }
    } catch (e) {
      rec = { id: it.id, model, url, transport_error: true, error: String(e?.message ?? e), latencyMs: Date.now() - t0 }
    }
    errs += rec.transport_error ? 1 : 0
    out.write(JSON.stringify(rec) + '\n')
    if (++n % 25 === 0) console.error(`  ${n}/${items.length} transport errors ${errs}`)
    if (errs >= 20 && errs > n / 2) { console.error('ABORT: the endpoint is failing'); process.exit(3) }
  }
}
await Promise.all(Array.from({ length: Number(conc) }, worker))
out.end()
console.error(`${model}: ${n} replayed, ${errs} transport errors`)
process.exit(0)
