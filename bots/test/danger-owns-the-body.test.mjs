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
  // lavastep-01: the predicate reads the mover's EFFECTIVE names (a relaxed magma/campfire cell reads as none), and the
  // movement arms also stand down while a danger move holds the body (inDanger = dangerHere || dangerMovingNow())
  assert.match(src, /const eff = lavastepMover \? lavastepMover\.effective\(feet, below\) : \{ feet: feet\?\.name \?\? null, below: below\?\.name \?\? null \}/, 'the effective names (identical to the raw ones with LAVASTEP=0)')
  assert.match(src, /const dangerHere = !recoveryArmsMayRun\(\{ feetName: eff\.feet, belowName: eff\.below \}\)/, 'dangerHere is the predicate')
  assert.match(src, /const rawDanger = !recoveryArmsMayRun\(\{ feetName: feet\?\.name, belowName: below\?\.name \}\)/, 'the episode row reads the raw names')
  assert.match(src, /if \(rawDanger && throttled\('danger', 2500\)\) \{/, 'the danger row (and, with LAVASTEP=0, the escape) re-fires every 2.5 s while the danger persists')
  assert.match(src, /const inDanger = dangerHere \|\| dangerMovingNow\(\)/, 'the arms stand down while a danger move holds the body')
  assert.doesNotMatch(src, /await escape\(bot\)\s*return\s*\}/, 'the firing tick does NOT return: air rescue, the low-health latch and stuck detection keep running (Codex, final pass)')
  const gates = [/mstate === 'need_scaffold' && !inDanger &&/, /if \(mstate === 'climb' && (?:!pocketing && !pocketPending && )?!inDanger\) \{/, /!climbing && !inDanger && isEntombed\(bot\) &&/, /fire: !reset && !inDanger && now - stillSince > stuckMs/]
  for (const g of gates) assert.equal((src.match(g) || []).length, 1, `gate present once: ${g}`)
  // the stuck gate now lives in the pure stuckDecision (reflex.mjs); the loop must still hand it the danger reading
  assert.match(src, /const stuck = stuckDecision\(\{[^}]*\binDanger,[^}]*\}\)/, 'the stuck decision is not told about danger')
  // MUTANT: any one gate removed is caught
  for (const g of gates) { const m = src.replace(g, x => x.replace('!inDanger && ', '').replace(' && !inDanger', '')); assert.equal((m.match(g) || []).length, 0, `mutant caught: ${g}`) }
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
