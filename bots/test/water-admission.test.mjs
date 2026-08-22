// THE GATE HAS TO KNOW ABOUT WATER, AND IT HAS TO HAVE A WAY OUT.
//
// Two wastes, both measured on the live fleet:
//
//   18 decisions in 45 minutes spent proposing swim_to while standing on dry
//   land (placebo-b-Delta 6, board-a-Delta 4). The skill refuses correctly, but
//   by then the proposal has been admitted, dispatched, and burned a ~30s
//   cognitive cycle. The model reaches for it because the system prompt
//   advertises swim_to unconditionally while the IN WATER hint only appears
//   when it is true.
//
//   850 _path_reset and 91 _path_noPath in ten minutes from bots afloat in open
//   water proposing goto. The land movement profile prices a wet step at ~86
//   against ~1 and the `cost > 100` guards delete wet neighbours, so A* has
//   nowhere to go. Admitting those proposals spends a decision to rediscover a
//   fact the movement config already fixed.
//
// THE DANGEROUS HALF IS THE SECOND RULE. MAX_VETO_STREAK -- the valve that stops
// the gate refusing everything forever -- lives inside the learned_avoid branch.
// A structural rejection added earlier in check() inherits no valve at all, so a
// bot in open water would be refused every single decision with no path out.
// That is the admission gate freezing shut: the taxonomy has it climbing 23% ->
// 72% over sixteen hours while every dashboard looked healthy. These tests exist
// mostly to pin that the water rule cannot do that.
import assert from 'node:assert'
import { AdmissionControl } from '../src/admission.mjs'
import { makeBot, ocean, V, AIR, WATER, DIRT } from './helpers/microworld.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const dryBot = () => makeBot({ pos: new V(0, 64, 0), blocks: () => AIR })
// Afloat with land 5 blocks east: walking out is correct and must stay allowed.
const nearShore = () => makeBot({ pos: new V(0, 62, 0),
  blocks: (x, y) => (x >= 5 ? (y <= 62 ? DIRT : AIR) : (y <= 62 ? WATER : AIR)) })
const openWater = () => makeBot({ pos: new V(0, 62, 0), blocks: ocean() })

// --- rule 1: swim_to belongs in water --------------------------------------

t('swim_to on dry land is rejected before it costs a cycle', () => {
  const a = new AdmissionControl()
  const r = a.check({ skill: 'swim_to', args: { x: 100, y: 62, z: 0 } }, dryBot())
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'not_in_water')
})

t('swim_to in water is admitted', () => {
  const a = new AdmissionControl()
  const r = a.check({ skill: 'swim_to', args: { x: 100, y: 62, z: 0 } }, openWater())
  assert.equal(r.ok, true, `rejected in water: ${r.reason} — the verb would be unusable`)
})

// --- rule 2: walking is not an option out there -----------------------------

t('goto from open water is redirected, not just refused', () => {
  const a = new AdmissionControl()
  const r = a.check({ skill: 'goto', args: { x: 355, y: 73, z: 147 } }, openWater())
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'water_blocks_land_travel')
  assert.match(r.detail, /swim_to/,
    'a rejection that does not name a legal alternative is a dead end, not a gate')
})

t('goto is LEFT ALONE when a shore is in reach', () => {
  // Walking to a nearby bank is exactly the right move and is what the IN WATER
  // observation tells the bot to do. Rejecting it would contradict our own advice.
  const a = new AdmissionControl()
  const r = a.check({ skill: 'goto', args: { x: 5, y: 63, z: 0 } }, nearShore())
  assert.equal(r.ok, true, `rejected a walk to a reachable bank: ${r.reason}`)
})

t('non-travel skills are untouched in open water', () => {
  // The rule is about routing, not about water being dangerous. A bot afloat may
  // still craft, eat or check status.
  const a = new AdmissionControl()
  const r = a.check({ skill: 'status', args: {} }, openWater())
  assert.equal(r.ok, true, `status rejected afloat: ${r.reason}`)
})

// --- THE VALVE, which is the whole reason this file exists ------------------

t('the water rule cannot refuse forever', () => {
  const a = new AdmissionControl()
  const bot = openWater()
  const props = { skill: 'goto', args: { x: 355, y: 73, z: 147 } }
  let forced = null
  for (let i = 0; i < 12 && !forced; i++) {
    const r = a.check(props, bot)
    if (r.ok) forced = { i, r }
  }
  assert.ok(forced,
    'twelve consecutive proposals, every one refused — that is the gate frozen shut, ' +
    'which is the failure this rule is most likely to cause')
  assert.equal(forced.r.kind, 'forced')
  assert.ok(forced.i <= 4, `took ${forced.i + 1} refusals before letting one through`)
})

t('the streak resets once the bot is out of the water', () => {
  // Otherwise a bot that swam ashore carries its water-veto count into dry land
  // and gets a free pass it did not earn, or worse, a stale one that fires later.
  const a = new AdmissionControl()
  const wet = openWater(), dry = dryBot()
  // THREE wet refusals, not two: the streak has to actually REACH the limit for
  // this to discriminate. At two, a version that never resets still refuses the
  // fourth call and the test passes against the bug — which is exactly what the
  // first draft of this test did.
  a.check({ skill: 'goto', args: { x: 355, y: 73, z: 147 } }, wet)
  a.check({ skill: 'goto', args: { x: 355, y: 73, z: 147 } }, wet)
  a.check({ skill: 'goto', args: { x: 355, y: 73, z: 147 } }, wet)
  a.check({ skill: 'goto', args: { x: 10, y: 64, z: 0 } }, dry)   // ashore: resets
  const r = a.check({ skill: 'goto', args: { x: 355, y: 73, z: 147 } }, wet)
  assert.equal(r.ok, false,
    'the streak survived leaving the water, so the next wet refusal was skipped')
  assert.equal(r.reason, 'water_blocks_land_travel')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
