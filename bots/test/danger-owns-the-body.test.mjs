// While the bot stands in lava, no recovery arm may take the body from the danger escape (2026-09-14: two fleet
// deaths within an hour of the promotion had "walled in" one second after "lava").
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recoveryArmsMayRun } from '../src/reflex.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
t('the arms may run on stone and in water, never on lava, fire or magma at the feet or below', () => {
  assert.equal(recoveryArmsMayRun({ feetName: 'air', belowName: 'stone' }), true)
  assert.equal(recoveryArmsMayRun({ feetName: 'water', belowName: 'gravel' }), true)
  assert.equal(recoveryArmsMayRun({}), true)
  for (const d of ['lava', 'fire', 'campfire', 'soul_fire', 'magma_block']) {
    assert.equal(recoveryArmsMayRun({ feetName: d, belowName: 'stone' }), false, d)
    assert.equal(recoveryArmsMayRun({ feetName: 'air', belowName: d }), false, `below ${d}`)
  }
})
t('WIRED: the four movement arms are gated on inDanger and the tick keeps running (source invariant, comments stripped)', () => {
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  assert.match(src, /const inDanger = !recoveryArmsMayRun\(\{ feetName: feet\?\.name, belowName: below\?\.name \}\)/, 'inDanger is the predicate')
  assert.match(src, /if \(inDanger && throttled\('danger', 2500\)\) \{/, 'the escape re-fires every 2.5 s while the danger persists')
  assert.doesNotMatch(src, /await escape\(bot\)\s*return\s*\}/, 'the firing tick does NOT return: air rescue, the low-health latch and stuck detection keep running (Codex, final pass)')
  const gates = [/mstate === 'need_scaffold' && !inDanger &&/, /if \(mstate === 'climb' && !inDanger\) \{/, /!climbing && !inDanger && isEntombed\(bot\) &&/, /!digging && !inDanger && Date\.now\(\) - stillSince/]
  for (const g of gates) assert.equal((src.match(g) || []).length, 1, `gate present once: ${g}`)
  // MUTANT: any one gate removed is caught
  for (const g of gates) { const m = src.replace(g, x => x.replace('!inDanger && ', '').replace(' && !inDanger', '')); assert.equal((m.match(g) || []).length, 0, `mutant caught: ${g}`) }
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
