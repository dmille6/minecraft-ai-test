// A POOL THAT DEGRADES TO A DIFFERENT MODEL MUST SAY SO.
//
// The 32b interim probe runs the Blackwell as primary with 10.0.0.72 behind it,
// and 10.0.0.72 cannot hold a 19.9GB model. Before this, the pool sent one
// model name to every endpoint, so the fallback would have answered "model not
// found" and the pool would have burned every endpoint before failing the
// decision -- redundancy that produces an outage.
//
// The second half matters more than the first. Once a run CAN contain two
// models, every record must name the one that actually answered. Logging the
// configured model would attribute a 7b fallback decision to the 32b and
// quietly corrupt the only comparison the probe exists to make. `endpoint` was
// made honest for exactly this reason after a migration became unverifiable;
// `model` now sits in the same position.
import assert from 'node:assert'
import { LlmClient, EndpointPool } from '../src/llm.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const mk = urls => new LlmClient({
  baseUrls: urls, model: 'default-model', numCtx: 8192,
  temperature: 0.7, timeoutMs: 5000,
})

await t('a bare url inherits the global model (every existing env file)', () => {
  const c = mk(['http://a:11434', 'http://b:11434'])
  assert.deepEqual(c.pool.eps.map(e => e.model), [null, null])
  assert.equal(c.baseUrl, 'http://a:11434')
})

await t('url|model pins that endpoint to its own weights', () => {
  const c = mk(['http://black:11438|qwen2.5:32b',
                'http://10.0.0.72:11434|qwen2.5:7b-instruct'])
  assert.deepEqual(c.pool.eps.map(e => e.url),
                   ['http://black:11438', 'http://10.0.0.72:11434'])
  assert.deepEqual(c.pool.eps.map(e => e.model),
                   ['qwen2.5:32b', 'qwen2.5:7b-instruct'])
})

await t('whitespace and trailing slashes survive the split', () => {
  const c = mk([' http://black:11438/ | qwen2.5:32b '])
  assert.equal(c.pool.eps[0].url, 'http://black:11438')
  assert.equal(c.pool.eps[0].model, 'qwen2.5:32b')
})

await t('a model name containing a colon is not truncated', () => {
  // qwen2.5:32b splits on '|', never on ':' -- the tag would be lost otherwise.
  const c = mk(['http://h:11434|qwen2.5:32b-instruct-q4_K_M'])
  assert.equal(c.pool.eps[0].model, 'qwen2.5:32b-instruct-q4_K_M')
})

await t('EndpointPool still accepts plain strings', () => {
  // Nothing else in the codebase should have to know about the new shape.
  const p = new EndpointPool(['http://a:1', 'http://b:2'])
  assert.deepEqual(p.eps.map(e => e.url), ['http://a:1', 'http://b:2'])
  assert.deepEqual(p.eps.map(e => e.model), [null, null])
  assert.equal(p.available().length, 2)
})

await t('THE SERVED MODEL IS REPORTED, not the configured one', async () => {
  // The fallback answers, pinned to a smaller model. If decide() reported
  // 'default-model' here, every degraded decision would be filed under the
  // model that never saw it.
  const c = mk(['http://dead:1|qwen2.5:32b', 'http://live:2|qwen2.5:7b-instruct'])
  const seen = []
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body)
    seen.push({ url, model: body.model })
    if (url.startsWith('http://dead')) throw new Error('connection refused')
    return { ok: true, json: async () => ({
      model: 'qwen2.5:7b-instruct',
      message: { content: JSON.stringify({ reason: 'r', skill: 'gather', args: {}, saw_end: 'S' }) },
    }) }
  }
  const res = await c.decide({ system: 's', user: 'u', sentinel: 'S', schema: {} })

  assert.equal(seen[0].model, 'qwen2.5:32b', 'primary must be asked for its own model')
  assert.equal(seen[1].model, 'qwen2.5:7b-instruct', 'fallback must be asked for ITS model')
  assert.equal(res.endpoint, 'http://live:2')
  assert.equal(res.model, 'qwen2.5:7b-instruct',
    'the record must name the model that actually answered')
  assert.notEqual(res.model, 'default-model')
})

await t('no endpoint answering leaves model null, never a guess', async () => {
  const c = mk(['http://dead:1|qwen2.5:32b'])
  globalThis.fetch = async () => { throw new Error('refused') }
  const res = await c.decide({ system: 's', user: 'u', sentinel: 'S', schema: {} })
  assert.equal(res.model, null, 'null means nothing served it; a name would be a lie')
  assert.equal(res.endpoint, null)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
