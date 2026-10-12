// brain-01: a remote brain (gemma4 on the Studio, behind the LM Studio proxy) as the PRIMARY endpoint, with a
// deterministic fallback to the bot's normal local model, and every decision row saying which brain decided.
//
// What must hold, tested by behaviour (a fetch stub that honours the AbortSignal, the real LlmClient, the real
// logger, the real CognitiveLoop):
//   1. `url|model|brain|timeoutMs` parses; a bad label or timeout is REFUSED, never silently defaulted.
//   2. A slow or dead primary costs ONE short wait (its own timeout), then the fallback answers, labelled 'local'.
//   3. The next decision skips the cooled-down primary at once; after the cooldown it is tried again and RECOVERS.
//   4. A 502 (model unloaded) and a refused connection fall back the same way.
//   5. think is sent only when OLLAMA_THINK is set: an unset bot's request is byte-identical to today's.
//   6. model_mismatch is measured against the serving endpoint's PINNED model, not the global one.
//   7. The row: llm.brain is written; every llm field the logger writes is mapped in the strict ES template.
//   8. The loop: a labelled pool emits _brain_config at start and _brain_share every 10 min; an unlabelled pool
//      emits neither (the baseline-zero licence); a work order is labelled 'order'.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LOGDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-brain01-'))
process.env.LOG_DIR = LOGDIR
process.env.BOT_NAME = 'BrainBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct'

const { LlmClient, parseEndpoint, parseThink } = await import('../src/llm.mjs')
const { logLlm } = await import('../src/logger.mjs')
const B = await import('../src/brain.mjs')

let pass = 0, fail = 0
// Every test has a 10 s ceiling: a fallback that waits a global 45 s budget must FAIL here, not hang the run.
const t = async (name, fn) => {
  let timer
  const ceiling = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('exceeded the 10 s test ceiling')), 10_000) })
  try { await Promise.race([fn(), ceiling]); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join(' | ')}`) }
  finally { clearTimeout(timer) }
}
const SENT = 'END-TEST'
const answer = (model) => ({ ok: true, json: async () => ({ model,
  message: { content: JSON.stringify({ skill: 'gather', args: { block: 'oak_log' }, reason: 'r', saw_end: SENT }) },
  prompt_eval_count: 10, eval_count: 5 }) })
const bodies = []
/** fetch stub: behaviour(base, body, signal) -> response | 'hang' | throws. 'hang' waits for the abort. */
function stub (behaviour) {
  globalThis.fetch = (u, opts) => {
    const base = String(u).replace('/api/chat', ''); const body = JSON.parse(opts.body); bodies.push({ base, body })
    const r = behaviour(base, body)
    if (r === 'hang') return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('This operation was aborted'))))
    return Promise.resolve(r)
  }
}
const POOL = ['http://studio:11601|gemma4:26b|gemma4|1000', 'http://local:11434|qwen2.5:7b-instruct']
const mk = (urls = POOL, extra = {}) => new LlmClient({ baseUrls: urls, baseUrl: urls[0], model: 'qwen2.5:7b-instruct',
  numCtx: 8192, temperature: 0.7, timeoutMs: 45000, ...extra })
const call = c => c.decide({ system: 's', user: 'u', sentinel: SENT, schema: { type: 'object' } })

// ---- 1. parsing -----------------------------------------------------------------------------------------------
await t('url|model|brain|timeoutMs parses; unset fields keep today\'s meaning', () => {
  assert.deepEqual(parseEndpoint('http://a:1/|gemma4:26b|gemma4|15000'), { url: 'http://a:1', model: 'gemma4:26b', brain: 'gemma4', timeoutMs: 15000 })
  assert.deepEqual(parseEndpoint('http://b:2|qwen2.5:7b-instruct'), { url: 'http://b:2', model: 'qwen2.5:7b-instruct', brain: null, timeoutMs: null })
  assert.deepEqual(parseEndpoint('http://c:3'), { url: 'http://c:3', model: null, brain: null, timeoutMs: null })
})
await t('a bad label or timeout is refused at startup, never defaulted', () => {
  for (const bad of ['http://a|m|Gemma 4', 'http://a|m|g|15', 'http://a|m|g|9e9', 'http://a|m|g|1.5s', '|m'])
    assert.throws(() => parseEndpoint(bad), /OLLAMA_BASE_URLS/, bad)
})
await t('OLLAMA_THINK: unset -> not sent; true/false/levels; anything else refused', () => {
  assert.equal(parseThink(undefined), undefined); assert.equal(parseThink(''), undefined)
  assert.equal(parseThink('false'), false); assert.equal(parseThink('true'), true); assert.equal(parseThink('low'), 'low')
  assert.throws(() => parseThink('off'), /OLLAMA_THINK/)
})

// ---- 2-4. fallback and recovery -------------------------------------------------------------------------------
await t('a HUNG primary costs its own short timeout, then the local fallback answers, labelled local', async () => {
  stub(base => base === 'http://studio:11601' ? 'hang' : answer('qwen2.5:7b-instruct'))
  const c = mk(); const t0 = Date.now(); const r = await call(c); const ms = Date.now() - t0
  assert.equal(r.schemaValid, true); assert.equal(r.brain, 'local'); assert.equal(r.endpoint, 'http://local:11434')
  assert.ok(ms >= 950 && ms < 3000, `fell back after the primary's 1 s budget, not the global 45 s (took ${ms} ms)`)
  assert.equal(r.model_mismatch, null, 'the fallback served exactly its pinned model')
})
await t('the next decision skips the cooled-down primary at once, and it RECOVERS after the cooldown', async () => {
  let studioUp = false
  stub(base => base === 'http://studio:11601' ? (studioUp ? answer('gemma4:26b') : 'hang') : answer('qwen2.5:7b-instruct'))
  const c = mk(); c.pool.cooldownMs = 300
  await call(c)                                                     // primary hangs -> cooldown
  bodies.length = 0
  const t0 = Date.now(); const r2 = await call(c)
  assert.ok(Date.now() - t0 < 500, 'no second wait on a primary in cooldown'); assert.equal(r2.brain, 'local')
  assert.ok(!bodies.some(b => b.base === 'http://studio:11601'), 'the cooled-down primary was not even asked')
  studioUp = true; await new Promise(r => setTimeout(r, 350))
  const r3 = await call(c)
  assert.equal(r3.brain, 'gemma4', 'after the cooldown the primary is tried again and serves'); assert.equal(r3.model, 'gemma4:26b')
})
await t('a 502 (model unloaded) and a refused connection fall back the same way', async () => {
  for (const mode of ['502', 'refused']) {
    stub(base => {
      if (base !== 'http://studio:11601') return answer('qwen2.5:7b-instruct')
      if (mode === 'refused') throw new Error('fetch failed: ECONNREFUSED')
      return { ok: false, status: 502, text: async () => 'upstream: model not loaded' }
    })
    const r = await call(mk())
    assert.equal(r.brain, 'local', mode); assert.equal(r.schemaValid, true, mode)
  }
})
await t('positive control: a healthy primary serves and is labelled with its brain', async () => {
  stub(base => base === 'http://studio:11601' ? answer('gemma4:26b') : answer('qwen2.5:7b-instruct'))
  const r = await call(mk())
  assert.equal(r.brain, 'gemma4'); assert.equal(r.endpoint, 'http://studio:11601'); assert.equal(r.model_mismatch, null)
})
await t('nothing served -> brain null (never the configured primary)', async () => {
  stub(() => { throw new Error('down') })
  const r = await call(mk())
  assert.equal(r.brain, null); assert.equal(r.endpoint, null); assert.equal(r.schemaValid, false)
})

await t('a MALFORMED gemma answer is repaired by the LOCAL fallback, not by the Studio again (Codex r1)', async () => {
  stub(base => base === 'http://studio:11601'
    ? { ok: true, json: async () => ({ model: 'gemma4:26b', message: { content: 'not json at all' } }) }
    : answer('qwen2.5:7b-instruct'))
  bodies.length = 0
  const r = await call(mk())
  assert.deepEqual(bodies.map(b => b.base), ['http://studio:11601', 'http://local:11434'], 'one Studio call, then the repair goes local')
  assert.equal(r.schemaValid, true); assert.equal(r.brain, 'local'); assert.equal(r.retryCount, 1)
})
await t('a bad SENTINEL from gemma is repaired locally too', async () => {
  stub(base => base === 'http://studio:11601'
    ? { ok: true, json: async () => ({ model: 'gemma4:26b', message: { content: JSON.stringify({ skill: 'gather', args: {}, reason: 'r', saw_end: 'END-WRONG' }) } }) }
    : answer('qwen2.5:7b-instruct'))
  bodies.length = 0
  const r = await call(mk())
  assert.deepEqual(bodies.map(b => b.base), ['http://studio:11601', 'http://local:11434']); assert.equal(r.brain, 'local')
})
await t('TOTAL transport failure on a labelled pool pays each timeout ONCE, then the decision ends (Codex r1)', async () => {
  stub(() => 'hang')
  const c = mk(['http://studio:11601|gemma4:26b|gemma4|1000', 'http://local:11434|qwen2.5:7b-instruct|local|1000'])
  bodies.length = 0
  const t0 = Date.now(); const r = await call(c); const ms = Date.now() - t0
  assert.deepEqual(bodies.map(b => b.base), ['http://studio:11601', 'http://local:11434'], 'no second walk')
  assert.ok(ms < 2600, `bounded by the sum of the budgets once (took ${ms} ms)`); assert.equal(r.brain, null); assert.equal(r.schemaValid, false)
})
await t('an UNLABELLED pool keeps today\'s retry exactly: a second walk after total failure, repair on the same endpoint', async () => {
  stub(() => { throw new Error('down') }); bodies.length = 0
  await call(mk(['http://a:1', 'http://b:2']))
  assert.equal(bodies.length, 4, 'today: two walks of two endpoints')
  stub(base => base === 'http://a:1' ? { ok: true, json: async () => ({ message: { content: 'nope' } }) } : answer('m')); bodies.length = 0
  await call(mk(['http://a:1', 'http://b:2']))
  assert.deepEqual(bodies.map(b => b.base), ['http://a:1', 'http://a:1'], 'today: the repair goes to the same (first healthy) endpoint')
})
await t('BYTE identity: an unconfigured bot\'s request body serializes exactly as 0cdb1a8\'s did', async () => {
  // 0cdb1a8 #post body, key order and all (llm.mjs at that sha): model, stream, keep_alive, messages, format, options.
  const expected = (msgs, schema) => JSON.stringify({ model: 'qwen2.5:7b-instruct', stream: false, keep_alive: '30m', messages: msgs, format: schema,
    options: { temperature: 0.7, num_ctx: 8192, num_predict: 512 } })
  let raw = null
  globalThis.fetch = (u, opts) => { raw = opts.body; return Promise.resolve(answer('qwen2.5:7b-instruct')) }
  await call(mk(['http://local:11434']))
  assert.equal(raw, expected([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], { type: 'object' }))
})

// ---- 5. think ---------------------------------------------------------------------------------------------------
await t('think is absent unless set: an unset bot sends exactly today\'s keys', async () => {
  stub(() => answer('qwen2.5:7b-instruct')); bodies.length = 0
  await call(mk(['http://local:11434']))
  assert.deepEqual(Object.keys(bodies[0].body).sort(), ['format', 'keep_alive', 'messages', 'model', 'options', 'stream'])
  bodies.length = 0
  await call(mk(['http://local:11434'], { think: false }))
  assert.strictEqual(bodies[0].body.think, false, 'a lone unlabelled endpoint (the bench) gets think')
})
await t('with a labelled pool, think goes to the remote brain only; the local fallback gets today\'s request', async () => {
  stub(base => base === 'http://studio:11601' ? { ok: false, status: 502, text: async () => 'x' } : answer('qwen2.5:7b-instruct'))
  bodies.length = 0
  await call(mk(POOL, { think: false }))
  const studio = bodies.find(b => b.base === 'http://studio:11601'), local = bodies.find(b => b.base === 'http://local:11434')
  assert.strictEqual(studio.body.think, false)
  assert.deepEqual(Object.keys(local.body).sort(), ['format', 'keep_alive', 'messages', 'model', 'options', 'stream'])
})

// ---- 6. mismatch against the pinned model -------------------------------------------------------------------------
await t('model_mismatch compares with the serving endpoint\'s pinned model', async () => {
  stub(base => base === 'http://studio:11601' ? answer('lmstudio:something-else') : answer('qwen2.5:7b-instruct'))
  const r = await call(mk())
  assert.match(r.model_mismatch, /asked for gemma4:26b, served lmstudio:something-else/)
})

// ---- 7. the row and the mapping ---------------------------------------------------------------------------------
await t('logLlm writes llm.brain, and EVERY llm field it writes is mapped in the strict template', async () => {
  const res = { schemaValid: true, latencyMs: 5, brain: 'gemma4', model_mismatch: null, argsCleaned: [] }
  logLlm({ startedAt: Date.now(), snapshot: {}, trigger: 'idle', model: 'gemma4:26b', endpoint: 'http://studio:11601',
           brain: 'gemma4', res, promptText: 'u', proposal: null, outcome: { status: 'success', detail: '' } })
  await new Promise(r => setTimeout(r, 150))         // the logger writes through a stream
  const row = JSON.parse(fs.readFileSync(path.join(LOGDIR, 'llm-BrainBot.jsonl'), 'utf8').trim().split('\n').at(-1))
  assert.equal(row.llm.brain, 'gemma4')
  const sh = fs.readFileSync(new URL('../../infra/elk/apply-mappings.sh', import.meta.url), 'utf8')
  const block = sh.split('mcai-llm-*')[1].split('\\"memory\\"')[0]
  const unmapped = Object.keys(row.llm).filter(k => !block.includes(`\\"${k}\\"`))
  assert.deepEqual(unmapped, [], 'an unmapped field under dynamic:strict rejects the whole row')
})

// ---- 8. brain.mjs + the real loop --------------------------------------------------------------------------------
await t('OLLAMA_BRAIN_PRIMARY is prepended to the bot\'s OWN pool, which keeps its order', () => {
  const own = ['http://10.0.0.16:11434', 'http://10.0.0.72:11434']
  assert.deepEqual(B.composePool('http://s:1|gemma4:26b|gemma4|15000', own), ['http://s:1|gemma4:26b|gemma4|15000', ...own])
  assert.deepEqual(B.composePool(undefined, own), own, 'unset: unchanged')
  assert.deepEqual(B.composePool('', own), own)
  assert.deepEqual(B.composePool('http://10.0.0.72:11434|x|y|2000', own), ['http://10.0.0.72:11434|x|y|2000', 'http://10.0.0.16:11434'], 'no duplicate url')
  assert.throws(() => B.composePool('http://a|m|b|2000,http://c', own), /ONE endpoint/)
})
await t('config: a process started with OLLAMA_BRAIN_PRIMARY really has it first in config.llm.baseUrls', async () => {
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const { config } = await import('" + new URL('../src/config.mjs', import.meta.url).href + "'); console.log(JSON.stringify(config.llm.baseUrls))"],
    { env: { ...process.env, OLLAMA_BRAIN_PRIMARY: 'http://s:1|gemma4:26b|gemma4|15000', OLLAMA_BASE_URLS: 'http://10.0.0.16:11434,http://10.0.0.72:11434' } }).toString()
  assert.deepEqual(JSON.parse(out.trim().split('\n').at(-1)), ['http://s:1|gemma4:26b|gemma4|15000', 'http://10.0.0.16:11434', 'http://10.0.0.72:11434'])
})
await t('BrainTally: a share row every 10 min, then it resets', () => {
  const tl = new B.BrainTally(0)
  tl.note('gemma4'); tl.note('gemma4'); tl.note('local'); tl.note('order'); tl.note(null)
  assert.equal(tl.due(B.SHARE_EVERY_MS - 1), null)
  assert.equal(tl.due(B.SHARE_EVERY_MS), 'since=1970-01-01T00:00:00.000Z total=5 gemma4=2 local=1 none=1 order=1')
  assert.equal(tl.due(2 * B.SHARE_EVERY_MS), `since=${new Date(B.SHARE_EVERY_MS).toISOString()} total=0 `)
})
await t('decisionBrain: a work order is "order" whatever the client says', () => {
  assert.equal(B.decisionBrain(true, { brain: 'gemma4' }), 'order')
  assert.equal(B.decisionBrain(false, { brain: 'gemma4' }), 'gemma4')
  assert.equal(B.decisionBrain(false, {}), null)
})
await t('configDetail names the pool in order with labels, models and timeouts', () => {
  const eps = POOL.map(parseEndpoint)
  assert.equal(B.configDetail(eps, 'qwen2.5:7b-instruct', 45000),
    'brain=gemma4 pool=[gemma4 gemma4:26b@http://studio:11601 1000ms > local qwen2.5:7b-instruct@http://local:11434 45000ms]')
  assert.equal(B.labelled(eps).length, 1); assert.equal(B.labelled([parseEndpoint('http://x')]).length, 0)
})

// The real loop (harness of learned-avoid-scope / directives tests): a stub model, a fake runner.
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const { Lessons } = await import('../src/lessons.mjs')
let seq = 0
const freshLessons = () => { const L = new Lessons(path.join(LOGDIR, `l${seq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
const loopBot = () => ({
  entity: { position: { x: 0, y: 70, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }, health: 20, food: 20, oxygenLevel: 300,
  time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, inventory: { items: () => [] },
  registry: { blocksByName: { oak_log: { id: 17 } }, itemsByName: {}, blocks: {}, items: {}, biomesArray: [], biomes: {} },
  recipesFor: () => [], recipesAll: () => [], findBlock: () => null, findBlocks: () => [],
  blockAt: () => ({ name: 'air', boundingBox: 'empty' }), setControlState: () => {}, clearControlStates: () => {},
  players: {}, entities: {}, experience: { level: 0 },
})
const skillRows = () => { try { return fs.readFileSync(path.join(LOGDIR, 'skill-BrainBot.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) } catch { return [] } }
const llmRows = () => fs.readFileSync(path.join(LOGDIR, 'llm-BrainBot.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
async function runLoop (labelledPool, items = null) {
  const runner = { isBusy: () => false, run: async () => ({ status: 'success', detail: 'ok', delta: {}, contractEvidence: ['x'] }) }
  const bot = loopBot(); if (items) bot.inventory = { items: () => items }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  if (labelledPool) { loop.llm.pool.eps = POOL.map(parseEndpoint); loop.brainTally = new B.BrainTally(Date.now() - B.SHARE_EVERY_MS) }
  loop.llm.decide = async () => ({ schemaValid: true, latencyMs: 3, brain: labelledPool ? 'gemma4' : 'local', model: 'gemma4:26b',
    endpoint: 'http://studio:11601', proposal: { skill: 'status', args: {}, reason: 'model' }, argsCleaned: [] })
  const before = skillRows().length, beforeLlm = (() => { try { return llmRows().length } catch { return 0 } })()
  loop.start(); await new Promise(r => setTimeout(r, 150)); loop.stop()
  return { skill: skillRows().slice(before), llm: llmRows().slice(beforeLlm) }
}
await t('the loop: an UNLABELLED pool emits no _brain rows (baseline zero), and its decision row says local', async () => {
  const r = await runLoop(false)
  assert.ok(r.llm.length >= 1, 'positive control: a decision row was written')
  assert.equal(r.skill.filter(x => /^_brain_/.test(x.skill?.name)).length, 0)
  assert.equal(r.llm.at(-1).llm.brain, 'local')
})
await t('the loop: a LABELLED pool emits _brain_config at start, and its decision row says gemma4', async () => {
  const r = await runLoop(true)
  const cfg = r.skill.filter(x => x.skill?.name === '_brain_config')
  assert.equal(cfg.length, 1); assert.match(cfg[0].skill.detail, /^brain=gemma4 pool=\[gemma4 gemma4:26b@/)
  assert.equal(r.llm.at(-1).llm.brain, 'gemma4')
  const share = r.skill.filter(x => x.skill?.name === '_brain_share')
  assert.ok(share.length >= 1, 'the (pre-aged) tally wrote its share row after the decision')
  assert.match(share[0].skill.detail, /total=\d+ gemma4=\d+/)
})

await t('the loop: a WORK ORDER is labelled order, even on a gemma4 bot (no model was asked)', async () => {
  // 34 slots with one spent axe -> the wear-out work order (hygiene.mjs) replaces the model call.
  const items = Array.from({ length: 33 }, (_, i) => ({ name: `dirt_${i}`, count: 1, slot: 9 + i }))
  items.push({ name: 'stone_axe', count: 1, slot: 44, maxDurability: 131, durabilityUsed: 130 })
  const r = await runLoop(true, items)
  const row = r.llm.at(-1)
  assert.equal(row.llm.latency_ms, 0, 'positive control: this decision was a work order (latency 0)')
  assert.equal(row.tool_calls?.[0]?.skill, 'wear_out')
  assert.equal(row.llm.brain, 'order')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
