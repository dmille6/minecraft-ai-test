// A LATENCY YOU CANNOT ATTRIBUTE TO AN ENDPOINT IS NOT A MEASUREMENT.
//
// decide() knew which url answered -- #post returns ep.url -- and threw it
// away. The caller logged `config.llm.baseUrl` instead: a static env var that
// reads the same whatever the pool does.
//
// On 2026-08-10 the fleet was pointed at a new inference host, with the old one
// demoted to fallback. Every llm record still said `http://10.0.0.72:11434`,
// because OLLAMA_BASE_URL still said that. I read 67 such records as proof the
// migration had silently failed, and went looking for a bug in the pool. The
// pool was fine. The label was a constant.
//
// This is the defect this repo keeps finding, in yet another costume: a field
// reporting a conclusion its evidence does not support. The endpoint pool has
// exactly one externally visible consequence -- WHICH HOST SERVED THE REQUEST --
// and nothing asserted it, so nothing caught it.
import assert from 'node:assert'
import { LlmClient } from '../src/llm.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const SENTINEL = 'END-TEST'
const good = url => ({
  ok: true,
  json: async () => ({
    message: { content: JSON.stringify({
      skill: 'gather', args: { block: 'oak_log' }, reason: 'test', saw_end: SENTINEL }) },
    prompt_eval_count: 10, eval_count: 5, total_duration: 1e9,
    // Tag the body with the url so a wrong attribution cannot pass by accident.
    load_duration: url.length,
  }),
})

function client(urls, behaviour) {
  globalThis.fetch = async (u) => {
    const base = String(u).replace('/api/chat', '')
    return behaviour(base)
  }
  return new LlmClient({
    baseUrls: urls, baseUrl: urls[0], model: 'm', numCtx: 8192,
    temperature: 0.3, timeoutMs: 5000,
  })
}

const call = c => c.decide({ system: 's', user: 'u', sentinel: SENTINEL, schema: {} })

await t('reports the endpoint that answered, not the one configured first', async () => {
  const c = client(['http://primary', 'http://fallback'], base => {
    if (base === 'http://primary') throw new Error('saturated')
    return good(base)
  })
  const res = await call(c)
  assert.equal(res.endpoint, 'http://fallback',
    'the whole point of a pool is that the answer may come from elsewhere; ' +
    'logging the configured primary makes a failover invisible')
})

await t('reports the primary when the primary served it', async () => {
  const c = client(['http://primary', 'http://fallback'], base => good(base))
  const res = await call(c)
  assert.equal(res.endpoint, 'http://primary')
})

await t('endpoint is null when nothing served the request', async () => {
  const c = client(['http://a', 'http://b'], () => { throw new Error('down') })
  const res = await call(c)
  assert.equal(res.endpoint, null,
    'a failed decision must not name an endpoint as though one answered')
  assert.equal(res.schemaValid, false)
})

await t('a later meta field cannot shadow the attribution', async () => {
  // `...meta` is spread into the result; endpoint is placed after it on
  // purpose. If someone adds `endpoint` to the ollama meta block, this fails
  // loudly instead of silently reverting to an unattributable log.
  const c = client(['http://primary'], base => ({
    ok: true,
    json: async () => ({
      message: { content: JSON.stringify({
        skill: 'gather', args: {}, reason: 'r', saw_end: SENTINEL }) },
      endpoint: 'http://WRONG', prompt_eval_count: 1, eval_count: 1,
    }),
  }))
  const res = await call(c)
  assert.equal(res.endpoint, 'http://primary')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
