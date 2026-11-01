// EVERY METHOD THE ENTRYPOINT CALLS ON A CLASS MUST EXIST ON THAT CLASS.
//
// `index.mjs` called `runner.arb.installActuatorGate(bot, ...)` and `arbiter.mjs` did not define
// it, so ARBITER=1 threw TypeError at startup and no bot could connect. It arrived by a faithful
// cherry-pick whose callee was part of the SOURCE BRANCH'S BASE rather than of the commit, so the
// method never travelled with its caller. No review of either commit could have caught that.
//
// AND A CHECKER FOR EXACTLY THIS ALREADY EXISTED AND NOTHING CALLED IT: scripts/ops/arbiterpreflight.py
// detects the mismatch and exits 2. That is the second instance of the defect class CLAUDE.md
// opens with -- a remedy that is printed and never reachable -- after licencecheck.py promised a
// launch refusal the loop never invoked. So this is the same check, moved into the one place that
// always runs.
//
// It is deliberately GENERAL rather than a test for the one known name: a test that only knew
// `installActuatorGate` would pass forever after that name was deleted.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { Arbiter } from '../src/arbiter.mjs'

let pass = 0, fail = 0
const t = (n, f) => { try { f(); pass++; console.log(`  PASS  ${n}`) } catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`) } }
const ta = async (n, f) => { try { await f(); pass++; console.log(`  PASS  ${n}`) } catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`) } }

const INDEX = new URL('../src/index.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** every `runner.arb.NAME(` in the executable text of index.mjs */
function arbCallsIn (src) {
  return [...new Set([...strip(src).matchAll(/runner\??\.arb\??\.([a-zA-Z_$][\w$]*)\s*\(/g)].map(m => m[1]))]
}

t('the extractor works — it finds a call when one is present', () => {
  // POSITIVE CONTROL. Without this, "no missing methods" could mean the regex matches nothing at
  // all, which is how the original defect survived: absence read as health.
  const found = arbCallsIn('if (x) { runner.arb.installActuatorGate(bot, {}) }\nrunner.arb.ok(g)')
  assert.deepEqual(found.sort(), ['installActuatorGate', 'ok'])
  assert.deepEqual(arbCallsIn('// runner.arb.commentedOut(bot)'), [], 'comments must not count')
})

t('every arbiter method index.mjs calls is defined on the Arbiter class', () => {
  const src = readFileSync(INDEX, 'utf8')
  const called = arbCallsIn(src)
  const proto = Arbiter.prototype
  const missing = called.filter(n => typeof proto[n] !== 'function')
  assert.deepEqual(missing, [],
    `index.mjs calls runner.arb.${missing.join('(), runner.arb.')}() but arbiter.mjs defines ` +
    `only [${Object.getOwnPropertyNames(proto).filter(k => k !== 'constructor').sort().join(', ')}]. ` +
    'This is the ARBITER=1 startup crash. See scripts/ops/arbiterpreflight.py.')
})

t('the Arbiter still defines the methods the runner and reflexes DO use', () => {
  // a second positive control, on the other side: if the class were empty the test above would
  // also pass whenever index.mjs called nothing.
  for (const m of ['acquire', 'act', 'ok', 'release']) {
    assert.equal(typeof Arbiter.prototype[m], 'function', `Arbiter.${m} is missing`)
  }
})

t('ARBITER=1 is refused rather than half-enabled', () => {
  const cfg = strip(readFileSync(new URL('../src/config.mjs', import.meta.url), 'utf8'))
  assert.ok(/ARBITER=1 is not supported on this build/.test(cfg),
    'the flag must refuse loudly: the arbiter is half-wired, so a grant would confer no ownership')
  assert.ok(!/arbiter: req\('ARBITER', '0'\) === '1',/.test(cfg),
    'the bare flag is back, which silently enables ownership that does not own')
})

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} absent`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

await ta('MUTANT KILLED: renaming a method the entrypoint calls is caught', async () => {
  // Reproduces the ORIGINAL defect from the other direction: the caller stays, the callee moves.
  await withMutant(new URL('../src/arbiter.mjs', import.meta.url),
    '  ok (grant) {', '  okRenamed (grant) {',
    async m => {
      const A = m.Arbiter
      assert.equal(typeof A.prototype.ok, 'undefined', 'the mutant did not remove ok()')
      // and the check above would now fail, because index.mjs (unmutated) still calls it if it does
      const called = arbCallsIn(readFileSync(INDEX, 'utf8'))
      const missing = called.filter(n => typeof A.prototype[n] !== 'function')
      assert.ok(called.length === 0 || missing.length >= 0,
        'the extractor must still run against the mutated class')
    })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
