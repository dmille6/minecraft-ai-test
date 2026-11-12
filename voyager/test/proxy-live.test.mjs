// voyager-01: THE REAL PROXY PROCESS against fake model servers (11-12). The pure helpers are tested in harness2.test.mjs;
// this drives the dispatch path that will carry the paid calls: which model a purpose reaches, the reply cap, the cache
// split on the wire, the stop reason on the way back, the dollars settled at the model that answered, and a safety decline.
// Nothing here leaves the machine: the Anthropic SDK is pointed at a local server and the key is a placeholder.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { chat } from '../src/llmclient.mjs'

const here = path.dirname(new URL(import.meta.url).pathname)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vypx-'))
const seen = []                 // every request the fake model servers received
let nextReply = null            // overrides the next Anthropic reply
let upstream, proxy, port
const HAIKU = { model: 'claude-haiku-5-5', inUsdPerMTok: 0.1, outUsdPerMTok: 0.5 }
const SONNET = { model: 'claude-sonnet-5-5', inUsdPerMTok: 2, outUsdPerMTok: 10 }
const sock = arm => path.join(dir, 'run', arm, 'llm.sock')
const rows = () => fs.readFileSync(path.join(dir, 'proxy.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
const spend = () => JSON.parse(fs.readFileSync(path.join(dir, 'spend.json'), 'utf8'))
const ask = (arm, o) => chat({ socketPath: sock(arm), system: 'SYSTEM TEXT', timeoutMs: 20_000, ...o })

before(async () => {
  upstream = http.createServer((req, res) => {
    let raw = ''
    req.on('data', d => { raw += d })
    req.on('end', () => {
      const body = JSON.parse(raw)
      seen.push({ url: req.url, auth: req.headers.authorization ?? req.headers['x-api-key'] ?? null, body })
      let out
      if (req.url === '/v1/messages') {
        out = nextReply ?? { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: `answer from ${body.model}` }],
          stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 5000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
        nextReply = null
      } else if (req.url === '/api/chat') {
        out = { message: { role: 'assistant', content: 'local answer' }, done: true, done_reason: body.options.num_predict <= 50 ? 'length' : 'stop', prompt_eval_count: 100, eval_count: 20, load_duration: 0 }
      } else { res.writeHead(404); res.end('{}'); return }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(out))
    })
  })
  await new Promise(r => upstream.listen(0, '127.0.0.1', r))
  port = upstream.address().port
  const cfg = {
    socketDir: path.join(dir, 'run'), logFile: path.join(dir, 'proxy.jsonl'), spendFile: path.join(dir, 'spend.json'), anthropicKeyFile: path.join(dir, 'key'),
    arms: {
      // one arm, two models: Haiku writes the code, Sonnet proposes the tasks
      hs: { backend: 'anthropic', ...HAIKU, capUsd: 5, effort: 'low', maxTokens: 12000, perHour: 400, inflight: 1,
        byPurpose: { curriculum: { ...SONNET, effort: 'medium', maxTokens: 3000, capUsd: 9999, backend: 'ollama' } } },
      // an arm as registered today (no byPurpose, the 4,096 cap)
      h1: { backend: 'anthropic', ...HAIKU, capUsd: 5, effort: 'low', maxTokens: 4096, perHour: 400, inflight: 1 },
      // a cap that the first Sonnet reservation already exceeds
      poor: { backend: 'anthropic', ...HAIKU, capUsd: 0.01, effort: 'low', maxTokens: 12000, perHour: 400, inflight: 1, byPurpose: { curriculum: { ...SONNET, maxTokens: 3000 } } },
      ol: { backend: 'ollama', url: `http://127.0.0.1:${port}`, model: 'local-coder', numCtx: 12288, keepAlive: -1, maxTokens: 4096, perHour: 400, inflight: 1,
        byPurpose: { curriculum: { model: 'local-big' } } },
    },
  }
  fs.writeFileSync(path.join(dir, 'proxy.json'), JSON.stringify(cfg))
  fs.writeFileSync(path.join(dir, 'key'), 'placeholder-not-a-key\n')
  for (const a of Object.keys(cfg.arms)) fs.mkdirSync(path.join(dir, 'run', a), { recursive: true })
  proxy = spawn(process.execPath, [path.join(here, '../proxy/proxy.mjs')], { stdio: ['ignore', 'pipe', 'pipe'],
    env: (() => {
      // no credential of the test host may reach the child: the key is the file's, as on the worlds host
      const e = { ...process.env, VOYAGER_PROXY_CONFIG: path.join(dir, 'proxy.json'), ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` }
      for (const k of ['VOYAGER_PROXY_NO_LISTEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE']) delete e[k]
      return e
    })() })
  let err = ''
  proxy.stderr.on('data', d => { err += d })
  for (let i = 0; i < 100 && !Object.keys(cfg.arms).every(a => fs.existsSync(sock(a))); i++) await new Promise(r => setTimeout(r, 100))
  assert.ok(Object.keys(cfg.arms).every(a => fs.existsSync(sock(a))), `the proxy did not open its sockets: ${err.slice(0, 400)}`)
})

after(async () => {
  try { proxy?.kill('SIGKILL') } catch {}
  await new Promise(r => upstream.close(r))
})

test('a code call reaches the arm\'s own model, with the cache split as two blocks and the stop reason passed back', async () => {
  seen.length = 0
  nextReply = { id: 'm', type: 'message', role: 'assistant', model: HAIKU.model, content: [{ type: 'text', text: 'cut' }], stop_reason: 'max_tokens', stop_sequence: null, usage: { input_tokens: 8000, output_tokens: 10000 } }
  const r = await ask('hs', { purpose: 'code', messages: [{ role: 'user', content: 'STABLE PREFIX|volatile rest' }], maxTokens: 10000, cacheSplit: 14 })
  assert.deepEqual([r.ok, r.text, r.stop], [true, 'cut', 'max_tokens'])
  assert.equal(seen.length, 1)
  const b = seen[0].body
  assert.equal(seen[0].url, '/v1/messages')
  assert.ok(String(seen[0].auth).endsWith('placeholder-not-a-key'))   // the key file's content, and nothing from the environment
  assert.equal(b.model, HAIKU.model)
  assert.equal(b.max_tokens, 10000)                                 // the harness 2 request fits under this arm's 12,000 cap
  assert.deepEqual(b.output_config, { effort: 'low' })
  assert.deepEqual(b.system, [{ type: 'text', text: 'SYSTEM TEXT', cache_control: { type: 'ephemeral' } }])
  assert.deepEqual(b.messages, [{ role: 'user', content: [{ type: 'text', text: 'STABLE PREFIX|', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'volatile rest' }] }])
  assert.equal('thinking' in b, false)                              // adaptive by default; nothing here forces or disables it
  assert.equal('fallbacks' in b, false)
  const row = rows().filter(x => x.arm === 'hs' && x.purpose === 'code').at(-1)
  assert.deepEqual([row.model, row.stop, row.paid], [HAIKU.model, 'max_tokens', true])
  assert.ok(Math.abs(row.usd - (8000 * 0.1 + 10000 * 0.5) / 1e6) < 1e-9)
})

test('a proposal on the same arm reaches the larger model: its own reply cap and effort, dollars at its price, the arm\'s cap', async () => {
  seen.length = 0
  const before = spend().hs.usd
  const r = await ask('hs', { purpose: 'curriculum', messages: [{ role: 'user', content: 'what next?' }], maxTokens: 5000 })
  assert.deepEqual([r.ok, r.text, r.stop], [true, `answer from ${SONNET.model}`, 'end_turn'])
  const b = seen[0].body
  assert.equal(seen[0].url, '/v1/messages')                         // byPurpose could not change the backend
  assert.equal(b.model, SONNET.model)
  assert.equal(b.max_tokens, 3000)                                  // clamped to the purpose's cap, not the arm's 12,000
  assert.deepEqual(b.output_config, { effort: 'medium' })
  assert.deepEqual(b.messages, [{ role: 'user', content: 'what next?' }])    // no cache split: the plain string, as before
  assert.ok(Math.abs(spend().hs.usd - before - (5000 * 2 + 300 * 10) / 1e6) < 1e-9, 'settled at the Sonnet price')
  const row = rows().filter(x => x.arm === 'hs' && x.purpose === 'curriculum').at(-1)
  assert.equal(row.model, SONNET.model)
})

test('an arm registered today is untouched: same model for both purposes, the 4,096 cap, a plain string', async () => {
  seen.length = 0
  await ask('h1', { purpose: 'curriculum', messages: [{ role: 'user', content: 'p' }], maxTokens: 700 })
  await ask('h1', { purpose: 'code', messages: [{ role: 'user', content: 'c' }], maxTokens: 4000 })
  await ask('h1', { purpose: 'code', messages: [{ role: 'user', content: 'c' }], maxTokens: 10000 })
  assert.deepEqual(seen.map(s => [s.body.model, s.body.max_tokens, s.body.messages[0].content, s.body.output_config.effort]),
    [[HAIKU.model, 700, 'p', 'low'], [HAIKU.model, 4000, 'c', 'low'], [HAIKU.model, 4096, 'c', 'low']])
})

test('the spend cap is the arm\'s, reserved at the model that would answer: Sonnet is refused where Haiku still fits', async () => {
  seen.length = 0
  const big = await ask('poor', { purpose: 'curriculum', messages: [{ role: 'user', content: 'x'.repeat(2000) }], maxTokens: 3000 })
  assert.equal(big.ok, false)
  assert.match(big.error, /spend cap \$0\.01 reached/)
  assert.equal(seen.length, 0)                                      // refused before anything was sent
  const small = await ask('poor', { purpose: 'code', messages: [{ role: 'user', content: 'x'.repeat(2000) }], maxTokens: 3000 })
  assert.equal(small.ok, true)
  assert.equal(seen[0].body.model, HAIKU.model)
  assert.ok(rows().some(x => x.arm === 'poor' && x.refused === 'spend_cap'))
})

test('a safety decline is an empty reply with stop "refusal", named in the row; no other model answers for the arm', async () => {
  seen.length = 0
  nextReply = { id: 'm', type: 'message', role: 'assistant', model: SONNET.model, content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' }, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } }
  const r = await ask('hs', { purpose: 'curriculum', messages: [{ role: 'user', content: 'what next?' }], maxTokens: 2000 })
  assert.deepEqual([r.ok, r.text, r.stop], [true, '', 'refusal'])
  assert.equal(seen.length, 1)
  const row = rows().filter(x => x.arm === 'hs' && x.purpose === 'curriculum').at(-1)
  assert.deepEqual([row.stop, row.refusal], ['refusal', 'general_harms'])
})

test('a local arm: the purpose picks the model, a length stop comes back as max_tokens', async () => {
  seen.length = 0
  const a = await ask('ol', { purpose: 'code', messages: [{ role: 'user', content: 'PREFIX|rest' }], maxTokens: 4000, cacheSplit: 7 })
  const b = await ask('ol', { purpose: 'curriculum', messages: [{ role: 'user', content: 'p' }], maxTokens: 50 })
  assert.deepEqual([a.ok, a.text, a.stop], [true, 'local answer', 'stop'])
  assert.deepEqual([b.ok, b.stop], [true, 'max_tokens'])
  assert.deepEqual(seen.map(s => [s.url, s.body.model, s.body.options.num_predict]), [['/api/chat', 'local-coder', 4000], ['/api/chat', 'local-big', 50]])
  assert.deepEqual(seen[0].body.messages, [{ role: 'system', content: 'SYSTEM TEXT' }, { role: 'user', content: 'PREFIX|rest' }])   // whole message, no split for Ollama
})
