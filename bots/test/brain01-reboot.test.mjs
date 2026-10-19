// brain-01: WHAT A STUDIO REBOOT LOOKS LIKE TO A CANARY BOT, over REAL sockets (no fetch stub).
//
// The Studio's keeper and proxy are per-user LaunchAgents and the Studio has no auto-login (owner 10-14: "not yet").
// After an unattended reboot nothing on the Studio serves gemma until someone logs in at the console. The bot reaches
// the Studio only through the fleet host's ssh tunnel (127.0.0.1:11611 -> Studio 127.0.0.1:11501), so a reboot shows
// up as one of four transport states, in this order:
//   1. Studio down, ssh exited, systemd restarting it        -> nothing listens on 11611: ECONNREFUSED
//   2. Studio's sshd up, tunnel reconnected, no proxy yet    -> 11611 accepts, then ssh closes the channel: a RESET
//   3. Network half-dead (ServerAlive has not fired yet)     -> 11611 accepts and never answers: a HANG
//   4. Logged in, proxy up, LM Studio still loading gemma    -> HTTP 502 from the proxy
// then 5. gemma loaded -> serves again.
// What must hold in every state: the decision is SERVED by the bot's own local model (labelled 'local'), within the
// Studio's own short budget plus the local's answer; and once the Studio serves again, the bot RETURNS to gemma
// after its cooldown -- no restart, no operator.
import assert from 'node:assert'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-brain01-reboot-'))
process.env.BOT_NAME = 'RebootBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct'

const { LlmClient } = await import('../src/llm.mjs')
const { composePool } = await import('../src/brain.mjs')

let pass = 0, fail = 0
// The ceiling (60 s) sits ABOVE the global 45 s budget on purpose: a fallback that waited the global budget must fail
// on this file's own elapsed-time ASSERTION, not on the ceiling (Codex r1: a ceiling throw is not an assertion).
const t = async (name, fn) => {
  let timer
  const ceiling = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('exceeded the 60 s test ceiling')), 60_000) })
  try { await Promise.race([fn(), ceiling]); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join(' | ')}`) }
  finally { clearTimeout(timer) }
}
const SENT = 'END-REBOOT'
const ollamaAnswer = model => JSON.stringify({ model, message: { content: JSON.stringify({ skill: 'gather', args: { block: 'oak_log' }, reason: 'r', saw_end: SENT }) },
  prompt_eval_count: 10, eval_count: 5 })
const listen = srv => new Promise(res => srv.listen(0, '127.0.0.1', () => res(srv.address().port)))
const close = srv => new Promise(res => { srv.closeAllConnections?.(); srv.close(() => res()) })

// The bot's own LOCAL model: a real HTTP server answering as Ollama does.
let localHits = 0
const local = http.createServer((req, res) => { req.resume(); req.on('end', () => { localHits++; res.setHeader('Content-Type', 'application/json'); res.end(ollamaAnswer('qwen2.5:7b-instruct')) }) })
const LOCAL = `http://127.0.0.1:${await listen(local)}`

// The tunnel port: reserved, then freed, so state 1 is a port nothing listens on.
const probe = net.createServer(); const TPORT = await listen(probe); await close(probe)
const TUNNEL = `http://127.0.0.1:${TPORT}`
const BUDGET = 1000            // the canary's 15 s, scaled down

let studio = null, studioHits = 0, sockets = new Set()
async function studioState (state) {
  if (studio) { for (const s of sockets) s.destroy(); sockets = new Set(); await close(studio); studio = null }
  if (state === 'refused') return
  if (state === 'reset') {
    studio = net.createServer(s => { studioHits++; s.destroy() })                       // ssh: channel open failed
  } else if (state === 'hang') {
    studio = net.createServer(s => { studioHits++; sockets.add(s); s.on('data', () => {}) })   // accepted, never answered
  } else {
    studio = http.createServer((req, res) => {
      req.resume(); req.on('end', () => {
        studioHits++
        if (state === '502') { res.statusCode = 502; res.end(JSON.stringify({ error: 'upstream: model not loaded' })); return }
        res.setHeader('Content-Type', 'application/json'); res.end(ollamaAnswer('gemma4:26b'))
      })
    })
    studio.on('connection', s => sockets.add(s))
  }
  await new Promise((res, rej) => { studio.once('error', rej); studio.listen(TPORT, '127.0.0.1', () => res()) })
}

// The pool exactly as config.mjs composes it from the canary's OLLAMA_BRAIN_PRIMARY and the bot's own list.
const POOL = composePool(`${TUNNEL}|gemma4:26b|gemma4|${BUDGET}`, [`${LOCAL}|qwen2.5:7b-instruct`])
const mk = () => new LlmClient({ baseUrls: POOL, baseUrl: POOL[0], model: 'qwen2.5:7b-instruct', numCtx: 8192, temperature: 0.7, timeoutMs: 45000 })
const call = c => c.decide({ system: 's', user: 'u', sentinel: SENT, schema: { type: 'object' } })

await t('the composed pool asks the tunnel first and keeps the bot\'s own local model as the fallback', () => {
  assert.equal(POOL.length, 2); assert.ok(POOL[0].startsWith(TUNNEL)); assert.ok(POOL[1].startsWith(LOCAL))
})

for (const state of ['refused', 'reset', 'hang', '502']) {
  await t(`reboot state "${state}": a FRESH bot is served by its local model within the Studio's budget`, async () => {
    await studioState(state)
    const c = mk(); const h0 = localHits; const t0 = Date.now()
    const r = await call(c); const ms = Date.now() - t0
    assert.equal(r.schemaValid, true, state); assert.equal(r.brain, 'local', state); assert.equal(r.endpoint, LOCAL, state)
    assert.equal(localHits - h0, 1, `${state}: exactly one local answer`)
    assert.ok(ms < BUDGET + 1500, `${state}: bounded by the Studio's own budget (took ${ms} ms)`)
    if (state === 'hang') assert.ok(ms >= BUDGET - 50, `hang: the Studio's budget was actually paid (took ${ms} ms)`)
    else assert.ok(ms < BUDGET, `${state}: a fast transport failure does not wait for the budget (took ${ms} ms)`)
  })
}

await t('THROUGH A WHOLE REBOOT on one bot: every decision served locally, then BACK ON GEMMA once the Studio serves, no restart', async () => {
  const c = mk(); c.pool.cooldownMs = 150; c.pool.maxCooldownMs = 600
  const brains = []
  for (const state of ['refused', 'reset', 'hang', '502']) {
    await studioState(state)
    // a cooling Studio is skipped, so wait out the cooldown before each phase to make sure THIS state is exercised
    await new Promise(r => setTimeout(r, c.pool.eps[0].downUntil > Date.now() ? c.pool.eps[0].downUntil - Date.now() + 20 : 0))
    const h0 = studioHits
    const r = await call(c); brains.push(r.brain)
    assert.equal(r.schemaValid, true, state); assert.equal(r.brain, 'local', state)
    if (state !== 'refused') assert.ok(studioHits > h0, `${state}: the Studio was really asked in this phase`)
  }
  assert.ok(c.pool.eps[0].fails >= 4, `the Studio's failures accumulated (${c.pool.eps[0].fails})`)
  await studioState('ok')
  // while it still cools, a decision does not even ask it (no wait at all). Measured on the pool, not on the server:
  // a request on a stale keep-alive socket fails without ever reaching the new listener, so a server-side count
  // cannot see that the Studio was asked -- its failure counter can.
  const cooling = c.pool.eps[0].downUntil - Date.now()
  assert.ok(cooling > 200, `the Studio is still cooling before this decision (${cooling} ms left)`)
  const f0 = c.pool.eps[0].fails; const c0 = c.pool.eps[0].calls; const h0 = studioHits
  const r1 = await call(c)
  assert.equal(r1.brain, 'local', 'a cooling Studio leaves the decision to the local model')
  assert.equal(c.pool.eps[0].fails, f0, 'a cooling Studio is not asked (its failure count did not move)')
  assert.equal(c.pool.eps[0].calls, c0, 'and it served nothing'); assert.equal(studioHits, h0)
  // after the (capped) cooldown it is asked again and serves
  await new Promise(r => setTimeout(r, Math.max(0, c.pool.eps[0].downUntil - Date.now()) + 20))
  const r2 = await call(c)
  assert.equal(r2.brain, 'gemma4', 'recovered onto gemma without a restart'); assert.equal(r2.model, 'gemma4:26b'); assert.equal(r2.model_mismatch, null)
  assert.equal(c.pool.eps[0].fails, 0, 'a served answer clears the backoff')
  assert.deepEqual(brains, ['local', 'local', 'local', 'local'])
})

await t('the backoff the canary inherits is capped: 60 s doubling, never more than 900 s (the live constants)', () => {
  const c = new LlmClient({ baseUrls: POOL, baseUrl: POOL[0], model: 'qwen2.5:7b-instruct', numCtx: 8192, temperature: 0.7, timeoutMs: 45000 })
  assert.equal(c.pool.cooldownMs, 60_000); assert.equal(c.pool.maxCooldownMs, 900_000)
  const waits = []
  for (let i = 0; i < 8; i++) { const t0 = Date.now(); c.pool.markFail(c.pool.eps[0], 'x'); waits.push(Math.round((c.pool.eps[0].downUntil - t0) / 1000)) }
  assert.deepEqual(waits, [60, 120, 240, 480, 900, 900, 900, 900])
})

if (studio) await close(studio)
await close(local)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
