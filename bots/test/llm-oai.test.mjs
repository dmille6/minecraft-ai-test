// SERVING OPTION A (OWNER 11-01): the bot client speaks llama.cpp llama-server's OpenAI-compatible API.
//
// Behaviour against a FAKE llama-server on a real local HTTP port (and a fake Ollama beside it), not a fetch stub:
// the request the server receives, the answer mapped back into the decision record, a schema failure taking the
// repair retry, a timeout / 503 / dead port failing over to the next endpoint, the /health probe gating a recovering
// server, and per-bot sticky assignment. Then mutants with unique anchors for the guards that matter.
import assert from 'node:assert'
import http from 'node:http'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { LlmClient, parseEndpoint, stickyOrder, stickyHash, oaiRequestBody, oaiResponse } from '../src/llm.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const LLM_PATH = new URL('../src/llm.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---------- fake servers ----------
const SENT = 'END-TEST01'
const good = (extra = {}) => JSON.stringify({ reason: 'r', skill: 'gather', args: { block: 'oak_log' }, saw_end: SENT, ...extra })
function fakeServer (handler) {
  const reqs = []
  const srv = http.createServer((req, res) => {
    let b = ''
    req.on('data', c => { b += c })
    req.on('end', () => {
      const r = { method: req.method, url: req.url, body: b ? JSON.parse(b) : null }
      reqs.push(r)
      handler(r, res, reqs.length)
    })
  })
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ srv, reqs, url: `http://127.0.0.1:${srv.address().port}` })))
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
const oaiAnswer = (content, model = 'cand-c2-q8') => ({
  choices: [{ finish_reason: 'stop', index: 0, message: { role: 'assistant', content } }],
  model, usage: { prompt_tokens: 2400, completion_tokens: 43 },
  timings: { cache_n: 1173, prompt_n: 1227, prompt_ms: 812.5, predicted_ms: 640.25 },
})
// A llama-server: /health 200 (or `health`), chat answered by `answer(n)`.
function llama ({ health = 200, answer = () => good(), delayMs = 0, status = 200 } = {}) {
  return fakeServer((r, res, n) => {
    if (r.url === '/health') return json(res, health, health === 200 ? { status: 'ok' } : { error: { message: 'Loading model', code: 503 } })
    if (r.url !== '/v1/chat/completions') return json(res, 404, { error: 'not found' })
    setTimeout(() => {
      if (status !== 200) return json(res, status, { error: { message: 'busy' } })
      json(res, 200, oaiAnswer(answer(n)))
    }, delayMs)
  })
}
function ollama () {
  return fakeServer((r, res) => {
    if (r.url !== '/api/chat') return json(res, 404, {})
    json(res, 200, { model: 'qwen2.5:7b-instruct', message: { content: good() }, prompt_eval_count: 2500, eval_count: 60,
                     total_duration: 1e9, load_duration: 0, prompt_eval_duration: 2e8, eval_duration: 7e8 })
  })
}
const mk = (urls, extra = {}) => new LlmClient({ baseUrls: urls, model: 'qwen3.5:9b', numCtx: 8192, maxTokens: 512,
                                                 temperature: 0.7, timeoutMs: 1500, ...extra })
const decide = c => c.decide({ system: 'SYS', user: 'USER', sentinel: SENT, schema: { type: 'object' } })
const close = (...s) => s.forEach(x => x.srv.close())
// The pool logs a warning on every failure; quiet for the suite.
const realFetch = globalThis.fetch

// ---------- parsing ----------
await t('a plain entry is Ollama, unchanged (every env file before 11-01)', () => {
  assert.deepEqual(parseEndpoint('http://h:11434|qwen2.5:7b-instruct'),
                   { url: 'http://h:11434', model: 'qwen2.5:7b-instruct', api: 'ollama', weight: 1 })
  assert.deepEqual(parseEndpoint(' http://h:11434/ '), { url: 'http://h:11434', model: null, api: 'ollama', weight: 1 })
})
await t('oai+ selects llama-server and is stripped from the url the row records', () => {
  assert.deepEqual(parseEndpoint('oai+http://g:18080|cand-c2-q8|3'),
                   { url: 'http://g:18080', model: 'cand-c2-q8', api: 'oai', weight: 3 })
  assert.equal(parseEndpoint('oai+http://g:18080/|m|0').weight, 1, 'a nonsense weight is 1, never 0 (0 would starve it)')
})

// ---------- request / response ----------
await t('THE REQUEST llama-server receives: json_schema, thinking off, prompt cache, the bot\'s own messages', async () => {
  const L = await llama()
  try {
    const c = mk([`oai+${L.url}|cand-c2-q8`])
    const res = await decide(c)
    assert.equal(res.schemaValid, true, res.error)
    const r = L.reqs.find(x => x.url === '/v1/chat/completions')
    assert.equal(r.method, 'POST')
    assert.deepEqual(r.body.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }])
    assert.equal(r.body.model, 'cand-c2-q8')
    assert.equal(r.body.stream, false)
    assert.equal(r.body.temperature, 0.7)
    assert.equal(r.body.max_tokens, 512)
    assert.equal(r.body.cache_prompt, true)
    assert.deepEqual(r.body.chat_template_kwargs, { enable_thinking: false })
    assert.deepEqual(r.body.response_format, { type: 'json_schema', json_schema: { name: 'decision', schema: { type: 'object' } } })
    assert.equal('keep_alive' in r.body || 'options' in r.body || 'format' in r.body, false, 'no Ollama-only fields')
    assert.equal(L.reqs.some(x => x.url === '/health'), false, 'a healthy server is never probed')
  } finally { close(L) }
})

await t('THE ANSWER maps into the SAME record keys the Ollama path fills (the index is dynamic:strict)', async () => {
  const L = await llama(), O = await ollama()
  try {
    const a = await decide(mk([`oai+${L.url}|cand-c2-q8`]))
    const b = await decide(mk([`${O.url}|qwen2.5:7b-instruct`]))
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), 'a key only one API fills would reach logLlm')
    assert.equal(a.endpoint, L.url)
    assert.equal(a.model, 'cand-c2-q8', 'the served model is the server\'s alias')
    assert.equal(a.prompt_tokens, 2400)
    assert.equal(a.completion_tokens, 43)
    assert.equal(a.prompt_eval_duration_ns, 812_500_000)
    assert.equal(a.eval_duration_ns, 640_250_000)
    assert.equal(a.total_duration_ns, 1_452_750_000)
    assert.equal(a.load_duration_ns, 0)
    assert.equal('cache_n' in a || 'cached_tokens' in a || 'timings' in a, false)
    assert.equal(a.proposal.skill, 'gather')
    assert.equal(a.model_mismatch, 'asked for qwen3.5:9b, served cand-c2-q8', 'a different served model is still named')
  } finally { close(L, O) }
})

await t('oaiResponse with no timings leaves durations null, not 0', () => {
  const r = oaiResponse({ choices: [{ message: { content: '{}' } }] }, { url: 'u', model: 'm' })
  assert.equal(r.meta.prompt_eval_duration_ns, null)
  assert.equal(r.meta.total_duration_ns, null)
  assert.equal(r.model, 'm')
})

await t('a schema failure takes the ONE repair retry on the same server, then is valid', async () => {
  const L = await llama({ answer: n => (n === 1 ? '{"skill": "gather", "args": {}' : good()) })
  try {
    const res = await decide(mk([`oai+${L.url}|cand-c2-q8`]))
    assert.equal(res.schemaValid, true)
    assert.equal(res.retryCount, 1)
    const chats = L.reqs.filter(x => x.url === '/v1/chat/completions')
    assert.equal(chats.length, 2)
    assert.match(chats[1].body.messages.at(-1).content, /rejected: response was not valid JSON/)
  } finally { close(L) }
})

await t('a wrong sentinel is a truncation, not a decision', async () => {
  const L = await llama({ answer: () => good({ saw_end: 'END-OTHER' }) })
  try {
    const res = await decide(mk([`oai+${L.url}|cand-c2-q8`]))
    assert.equal(res.schemaValid, false)
    assert.match(res.error, /truncation sentinel mismatch/)
  } finally { close(L) }
})

// ---------- failover ----------
await t('A TIMEOUT fails over to the next endpoint (Ollama qwen2.5) in the same decision', async () => {
  const L = await llama({ delayMs: 4000 }), O = await ollama()
  try {
    const c = mk([`oai+${L.url}|cand-c2-q8`, `${O.url}|qwen2.5:7b-instruct`], { timeoutMs: 400 })
    const t0 = Date.now()
    const res = await decide(c)
    assert.equal(res.schemaValid, true)
    assert.equal(res.endpoint, O.url)
    assert.equal(res.model, 'qwen2.5:7b-instruct')
    assert.ok(Date.now() - t0 < 2500, `one timeout, not two (${Date.now() - t0} ms)`)
    assert.ok(c.pool.eps[0].fails === 1 && c.pool.eps[0].downUntil > Date.now(), 'the slow server cools down')
  } finally { close(L, O) }
})

await t('a 503 and a dead port both fail over; the record names the server that answered', async () => {
  const L = await llama({ status: 503 }), O = await ollama()
  try {
    const res = await decide(mk([`oai+${L.url}|a`, 'oai+http://127.0.0.1:1|b', `${O.url}|qwen2.5:7b-instruct`]))
    assert.equal(res.endpoint, O.url)
    assert.equal(res.schemaValid, true)
  } finally { close(L, O) }
})

await t('/health GATES THE WAY BACK: a failed server that still says 503 costs a probe, not a request', async () => {
  const L = await llama({ health: 503 }), O = await ollama()
  try {
    const c = mk([`oai+${L.url}|a`, `${O.url}|qwen2.5:7b-instruct`])
    c.pool.markFail(c.pool.eps[0], 'earlier timeout')
    c.pool.eps[0].downUntil = 0                       // cooldown over: it is tried again
    const res = await decide(c)
    assert.equal(res.endpoint, O.url)
    assert.equal(L.reqs.filter(x => x.url === '/health').length, 1)
    assert.equal(L.reqs.filter(x => x.url === '/v1/chat/completions').length, 0, 'a loading server got a real request')
    assert.equal(c.pool.eps[0].fails, 2, 'and it stays failed (longer cooldown)')
  } finally { close(L, O) }
})

await t('a failed server whose /health is 200 again gets traffic and is marked ok', async () => {
  const L = await llama()
  try {
    const c = mk([`oai+${L.url}|a`])
    c.pool.markFail(c.pool.eps[0], 'earlier timeout')
    const res = await decide(c)
    assert.equal(res.endpoint, L.url)
    assert.equal(c.pool.eps[0].fails, 0)
  } finally { close(L) }
})

await t('every endpoint failing still returns a record with endpoint null (the outage is visible)', async () => {
  const res = await decide(mk(['oai+http://127.0.0.1:1|a', 'http://127.0.0.1:2|b']))
  assert.equal(res.endpoint, null)
  assert.equal(res.schemaValid, false)
  assert.match(res.error, /llm endpoint\(s\) failed/)
})

// ---------- sticky assignment ----------
const BOTS = ['a', 'b', 'c', 'd'].flatMap(p => ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo'].flatMap(n =>
  ['board', 'hive', 'isolated', 'placebo'].map(k => `${k}-${p}-${n}`)))
const EPS = ['oai+http://x:18080|m|3', 'oai+http://y:18080|m|1', 'http://x:11434|qwen2.5:7b-instruct'].map(parseEndpoint)

await t('STICKY: a bot\'s primary llama-server is a function of its name, stable across restarts', () => {
  for (const b of BOTS) assert.deepEqual(stickyOrder(EPS, b), stickyOrder(EPS, b))
  assert.equal(stickyHash('board-a-Alpha'), stickyHash('board-a-Alpha'))
  const c1 = mk(EPS.map(e => `oai+${e.url}|m`).slice(0, 2), { stickyKey: 'hive-b-Echo' })
  const c2 = mk(EPS.map(e => `oai+${e.url}|m`).slice(0, 2), { stickyKey: 'hive-b-Echo' })
  assert.equal(c1.baseUrl, c2.baseUrl, 'the primary (baseUrl) is the sticky choice')
})

await t('STICKY: weights split 80 real names roughly by capacity, and every bot keeps the full failover chain', () => {
  let x = 0
  for (const b of BOTS) {
    const o = stickyOrder(EPS, b)
    assert.equal(o.length, 3)
    assert.equal(o[2].url, 'http://x:11434', 'the Ollama fallback stays last')
    assert.deepEqual(new Set(o.map(e => e.url)).size, 3)
    if (o[0].url === 'http://x:18080') x++
  }
  assert.ok(x >= 50 && x <= 70, `weight 3:1 should give ~60 of 80 to x, got ${x}`)
  const even = ['oai+http://x:1|m', 'oai+http://y:1|m'].map(parseEndpoint)
  const nx = BOTS.filter(b => stickyOrder(even, b)[0].url === 'http://x:1').length
  assert.ok(nx >= 28 && nx <= 52, `1:1 should split ~40/40, got ${nx}`)
})

await t('STICKY is inert for Ollama-only pools, a single server, or no bot name (old env files keep their order)', () => {
  const ol = ['http://a:1|m', 'http://b:1|m'].map(parseEndpoint)
  for (const b of BOTS) assert.deepEqual(stickyOrder(ol, b).map(e => e.url), ['http://a:1', 'http://b:1'])
  const one = ['oai+http://a:1|m', 'http://b:1|m'].map(parseEndpoint)
  for (const b of BOTS) assert.deepEqual(stickyOrder(one, b).map(e => e.url), ['http://a:1', 'http://b:1'])
  assert.deepEqual(stickyOrder(EPS, null).map(e => e.url), EPS.map(e => e.url))
})

await t('oaiRequestBody is the documented body', () => {
  assert.deepEqual(oaiRequestBody({ model: 'm', messages: [], schema: { s: 1 }, temperature: 0.3, maxTokens: 9 }), {
    model: 'm', messages: [], stream: false, temperature: 0.3, max_tokens: 9, cache_prompt: true,
    chat_template_kwargs: { enable_thinking: false },
    response_format: { type: 'json_schema', json_schema: { name: 'decision', schema: { s: 1 } } },
  })
})

// ---------- mutants ----------
await t('MUTANT KILLED: sending Ollama\'s /api/chat to an oai endpoint is caught (no llama-server path at all)', async () => {
  await withMutant(LLM_PATH, "      if (ep.api === 'oai') {\n        try {", "      if (false) {\n        try {", async mod => {
    const L = await llama()
    try {
      const c = new mod.LlmClient({ baseUrls: [`oai+${L.url}|a`], model: 'm', numCtx: 1, temperature: 0, timeoutMs: 1000 })
      const res = await c.decide({ system: 's', user: 'u', sentinel: SENT, schema: {} })
      assert.equal(res.schemaValid, false, 'the mutant still worked, so the request test proves nothing')
      assert.equal(L.reqs.some(x => x.url === '/api/chat'), true)
    } finally { close(L) }
  })
})

await t('MUTANT KILLED: without the /health gate a loading server takes a real request', async () => {
  await withMutant(LLM_PATH, "if (ep.api === 'oai' && ep.fails > 0) {", "if (false) {", async mod => {
    const L = await llama({ health: 503 })
    try {
      const c = new mod.LlmClient({ baseUrls: [`oai+${L.url}|a`], model: 'm', numCtx: 1, temperature: 0, timeoutMs: 1000 })
      c.pool.markFail(c.pool.eps[0], 'x')
      await c.decide({ system: 's', user: 'u', sentinel: SENT, schema: {} })
      assert.ok(L.reqs.some(x => x.url === '/v1/chat/completions'), 'the mutant was still gated')
    } finally { close(L) }
  })
})

await t('MUTANT KILLED: without the sticky pick every bot lands on the first llama-server', async () => {
  await withMutant(LLM_PATH, 'return [group[pick], ...group.filter((_, i) => i !== pick), ...eps.slice(n)]',
                   'return [...eps]', async mod => {
    const ys = BOTS.filter(b => mod.stickyOrder(EPS, b)[0].url === 'http://y:18080').length
    assert.equal(ys, 0, 'the mutant still spread bots, so the split test proves nothing')
  })
})

await t('MUTANT KILLED: thinking left on is caught by the request test', async () => {
  await withMutant(LLM_PATH, 'chat_template_kwargs: { enable_thinking: false },', '', async mod => {
    const b = mod.oaiRequestBody({ model: 'm', messages: [], schema: {}, temperature: 0, maxTokens: 1 })
    assert.equal(b.chat_template_kwargs, undefined, 'the mutant still sent enable_thinking')
  })
})

globalThis.fetch = realFetch
console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
