// A COOLDOWN THAT IS NEVER OBSERVED IS NOT A COOLDOWN.
//
// EndpointPool.available() never returns an empty list -- "an expired guess
// beats not deciding at all" -- so with a single endpoint `downUntil` is inert
// and the very next decision tries it again anyway.
//
// markFail still announced "cooling down, 900s". During the 2026-08-10 outage
// that line appeared 64 times and I read it as the fleet having taken itself
// offline for fifteen minutes after recovery. It had not: the endpoint was
// dead, the bots were retrying exactly as designed, and they resumed about two
// minutes after it came back. I nearly shipped a cap to fix a latency that did
// not exist.
import assert from 'node:assert'
import { EndpointPool } from '../src/llm.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

t('a sole endpoint is still offered after failing -- the cooldown is inert', () => {
  const p = new EndpointPool(['http://a'])
  p.markFail(p.eps[0], 'ollama 503')
  p.markFail(p.eps[0], 'ollama 503')
  assert.equal(p.available().length, 1,
    'with nowhere to fail over to, the endpoint must still be tried')
})

t('with alternatives, a failed endpoint IS withheld', () => {
  const p = new EndpointPool(['http://a', 'http://b'])
  p.markFail(p.eps[0], 'ollama 503')
  const urls = p.available().map(e => e.url)
  assert.deepEqual(urls, ['http://b'],
    'here the backoff is real, because there is somewhere else to go')
})

t('success clears the failure count', () => {
  const p = new EndpointPool(['http://a'])
  p.markFail(p.eps[0], 'boom')
  p.markOk(p.eps[0], 12)
  assert.equal(p.eps[0].fails, 0)
  assert.equal(p.eps[0].downUntil, 0)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
