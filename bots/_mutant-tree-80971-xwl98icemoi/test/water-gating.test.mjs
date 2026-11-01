// A GATE MUST NOT MEASURE ITS OWN TRIGGER.
//
// b6a4845 added a critical-oxygen override: below 25% of the runtime-learned air
// scale, the monotonic-trend guard no longer gets a vote. It worked -- rescue
// refusals fell 33.8% -> 3.7%.
//
// The obvious next step is to gate Block 2's start on "how often was air
// critical". That would be circular. The event would be counting MY OVERRIDE
// FIRING, not the world, so tuning the override moves the number whether or not
// a single bot is safer. That is exactly the failure that cost today: I steered
// by drowning-escape-rate for eight hours while drowning DEATHS tripled
// underneath it, because the metric conditioned on attempted escapes instead of
// on harm.
//
// So the physical state gets its own predicate, with no knowledge of mayAct,
// rescuing, swimming, or whether any rescue occurred. Gate on this; debug with
// the override's own events.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { airCriticalTransition } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

t('entry is a fact about air, not about the rescue', () => {
  assert.equal(airCriticalTransition(4, 20, false), 'enter')     // 20%
  assert.equal(airCriticalTransition(80, 400, false), 'enter')   // 20% on the real scale
})

t('it is scaled to the SERVER, like the override it must not mirror', () => {
  // 1.21.8 reports ~400 where the constant assumes 20. A threshold on the wrong
  // scale silently never fires -- the same seam that escaped every behaviour
  // test for airConsequenceEvidence.
  assert.equal(airCriticalTransition(80, 20, false), null, '80/20 is a FULL tank, not critical')
  assert.equal(airCriticalTransition(80, 400, false), 'enter')
})

t('a healthy bot produces no transition', () => {
  assert.equal(airCriticalTransition(20, 20, false), null)
  assert.equal(airCriticalTransition(19, 20, false), null)
})

t('hysteresis: entry does not re-fire while still latched', () => {
  // Without this a bot sitting at 20% air emits one event per 500ms tick and
  // inflates the exact rate the gate reads.
  assert.equal(airCriticalTransition(4, 20, true), null)
  assert.equal(airCriticalTransition(1, 20, true), null)
})

t('clearing needs real recovery, not a flicker over the line', () => {
  assert.equal(airCriticalTransition(6, 20, true), null, '30% is not recovered')
  assert.equal(airCriticalTransition(11, 20, true), 'clear', '55% is')
})

t('the clear threshold is above the enter threshold', () => {
  // If they met, a bot oscillating one tick either side would emit an unbounded
  // stream of enter/clear pairs.
  const enterAt = 0.25, clearAt = 0.5
  assert.ok(clearAt > enterAt)
  assert.equal(airCriticalTransition(5.0, 20, true), null,
    'exactly at 25% while latched must not clear')
})

t('garbage in produces no transition, not a false one', () => {
  assert.equal(airCriticalTransition(undefined, 20, false), null)
  assert.equal(airCriticalTransition(4, 0, false), null, 'airMax 0 would divide by zero')
  assert.equal(airCriticalTransition(4, undefined, false), null)
  // THE CASE THAT ACTUALLY NEEDS THE GUARD. NaN comparisons are false either
  // way, so the unlatched cases above pass with or without it -- a mutation
  // deleting the guard survived them all. But airMax=0 while LATCHED divides to
  // Infinity, which is > the clear threshold, and the bot would be recorded as
  // having recovered from critical air on the strength of a missing air scale.
  assert.equal(airCriticalTransition(4, 0, true), null,
    'a zero air scale reported RECOVERY — the guard is gone')
  assert.equal(airCriticalTransition(4, undefined, true), null)
})

t('the emission is NOT gated on the override having acted', () => {
  // The wiring seam: if this event were emitted inside the `mayAct` branch, the
  // gate would measure the intervention instead of the hazard, and every
  // behaviour test above would still pass.
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const emit = src.indexOf("kind: 'oxygen_critical_state'")
  const mayAct = src.indexOf('const mayAct = airConsequenceEvidence(')
  assert.ok(emit > 0 && mayAct > 0)
  assert.ok(emit < mayAct,
    'oxygen_critical_state is emitted after mayAct is computed — it must be ' +
    'independent of whether anything chose to act')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
