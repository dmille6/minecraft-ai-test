/**
 * The fleet that gated itself to a standstill.
 *
 * Instance #1, 2026-08-07: 30 watchdog stagnation events in 15 minutes, a bot at
 * full health that moved 0.0 blocks in 166 seconds, and the entire early tech
 * tree learned-blocked at once --
 *
 *   craft wooden_pickaxe  54 fails    craft oak_planks  47 fails
 *   craft stick           37 fails    gather oak_log     4 fails
 *
 * -- while 100% of the underlying craft failures were `missing_ingredients`.
 * Every one was the RIGHT action attempted before its inputs existed. The avoid
 * key named the action; the measurement was about the inventory.
 *
 * Three defects, each tested here:
 *   1. situational failures recorded as intrinsic ones
 *   2. decay measured from the last TOUCH, which probation refreshed, so
 *      forgiveness evaluated to exactly zero and the counter became a ratchet
 *   3. a gate able to block every producer of the thing its own milestone needs
 */
import assert from 'node:assert'
import { Lessons } from '../src/lessons.mjs'
import { AdmissionControl } from '../src/admission.mjs'
import { EVIDENCE_ABOUT_THE_ACTION, EVIDENCE_ONLY_IF_STUCK, EVIDENCE_ONLY_IF_HERE,
         evidenceScope } from '../src/cognitive.mjs'

// THREE SETS NOW, AND EVERY GUARD BELOW MUST SEE ALL THREE.
//
// A mutant that added collect_budget, goal_changed, path_timeout and stagnation
// to the newest set survived the whole suite, because the "is this enforced"
// guards had been widened in one of three places. Enumerating them once, here,
// is what makes that impossible to repeat: a fourth set added next week has to
// appear in this object or the overlap test below stops covering it.
const EVIDENCE_SETS = {
  action: EVIDENCE_ABOUT_THE_ACTION,
  situation: EVIDENCE_ONLY_IF_STUCK,
  place: EVIDENCE_ONLY_IF_HERE,
}
const inAnyEvidenceSet = fc => Object.values(EVIDENCE_SETS).some(s => s.has(fc))
import { classifyFailure } from '../src/state.mjs'

let n = 0
const ok = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); n++ }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1 }
}

const MIN = 60 * 1000
const fresh = f => new Lessons(`/tmp/test-livelock-${f}.json`)
const count = (L, s, a) => L.failCount(s, a)

// --- 1. situational failures -------------------------------------------------

ok('a gap that never moves still accrues', () => {
  const L = fresh('stuck')
  const a = { item: 'diamond_pickaxe' }
  for (let i = 0; i < 3; i++) L.recordFailure('craft', a, 'missing_ingredients', null, 'diamond+stick')
  assert.equal(count(L, 'craft', a), 3, 'a genuinely impossible craft must still be suppressible')
})

ok('a gap that moves resets the counter', () => {
  const L = fresh('moving')
  const a = { item: 'wooden_pickaxe' }
  for (let i = 0; i < 5; i++) L.recordFailure('craft', a, 'missing_ingredients', null, 'oak_planks+stick')
  assert.equal(count(L, 'craft', a), 5)
  // The bot gathered logs and made planks: the gap shrank. That is progress.
  L.recordFailure('craft', a, 'missing_ingredients', null, 'stick')
  assert.equal(count(L, 'craft', a), 1,
    'climbing the tech tree must not read as five failures of the same thing')
})

ok('the real fleet sequence never reaches the block threshold', () => {
  // Exactly what Miner01 did, in order. Under the old rule this hit 4 and the
  // gate closed on the whole chain.
  const L = fresh('techtree')
  const a = { item: 'wooden_pickaxe' }
  for (const gap of ['oak_planks+stick', 'oak_planks+stick', 'stick', 'stick', 'oak_planks']) {
    L.recordFailure('craft', a, 'missing_ingredients', null, gap)
  }
  assert.ok(count(L, 'craft', a) < 4,
    `reached ${count(L, 'craft', a)} -- the gate would have blocked the bootstrap again`)
})

ok('a skill that cannot name its gap is no worse than before', () => {
  const L = fresh('nogap')
  const a = { block: 'oak_log' }
  for (let i = 0; i < 3; i++) L.recordFailure('gather', a, 'nothing_found', null, null)
  assert.equal(count(L, 'gather', a), 3, 'null gap must accrue exactly as it always did')
})

// --- 2. the decay ratchet ----------------------------------------------------

ok('decay runs from the start of the streak, not the last touch', () => {
  const L = fresh('ratchet')
  const k = 'craft:{"item":"oak_planks"}'
  // The exact shape probation produced: streak began 2h ago, touched seconds ago.
  L.data.avoid[k] = { skill: 'craft', args: { item: 'oak_planks' },
                      fails: 6, classes: {}, since: Date.now() - 120 * MIN, last: Date.now() }
  assert.equal(count(L, 'craft', { item: 'oak_planks' }), 0,
    'six failures over two hours must age out even while being retried')
})

ok('a fast-failing rule still outruns decay', () => {
  const L = fresh('fastfail')
  const a = { item: 'oak_planks' }
  for (let i = 0; i < 8; i++) L.recordFailure('craft', a, 'missing_ingredients', null, 'oak_log')
  assert.ok(count(L, 'craft', a) >= 4,
    'decay must not be so generous that a truly broken action is never suppressed')
})

ok('legacy entries with no `since` still decay on `last`', () => {
  const L = fresh('legacy')
  const k = 'gather:{"block":"oak_log"}'
  L.data.avoid[k] = { skill: 'gather', args: { block: 'oak_log' },
                      fails: 6, classes: {}, last: Date.now() - 60 * MIN }
  assert.equal(count(L, 'gather', { block: 'oak_log' }), 3,
    'entries written before this change must not be misread on upgrade')
})

ok('success is disproof: it decrements the avoid rule', () => {
  const L = fresh('disproof')
  const a = { item: 'stick' }
  for (let i = 0; i < 3; i++) L.recordFailure('craft', a, 'missing_ingredients', null, 'oak_planks')
  const before = count(L, 'craft', a)
  L.recordSuccess('craft', a, ['inventory_gain: stick +4'])
  assert.ok(count(L, 'craft', a) < before, 'a success that does not weaken the rule is not disproof')
})

// --- 3. the classification policy -------------------------------------------

ok('our own interruptions are never evidence', () => {
  for (const fc of ['path_interrupted', 'path_budget', 'collect_budget', 'goal_changed',
                    'died', 'hazard_interrupt', 'stagnation', 'stuck', 'timeout', 'path_timeout']) {
    assert.ok(!inAnyEvidenceSet(fc), `${fc} is something WE did, not something the world said`)
    assert.equal(evidenceScope(fc), null, `${fc} must get no vote in any store`)
  }
})

ok('an unclassified failure defaults to not-enforced', () => {
  // The polarity that matters: `other` was once 36% of all failures and it was
  // enforced by default purely because nobody had listed it.
  for (const fc of ['other', 'a_class_added_next_week', '']) {
    assert.ok(!inAnyEvidenceSet(fc), `${fc} must not train the gate`)
    assert.equal(evidenceScope(fc), null, `${fc} must not train the gate`)
  }
})

ok('the world refusing IS still evidence', () => {
  for (const fc of ['no_path', 'path_incomplete', 'buried', 'bad_target']) {
    assert.ok(EVIDENCE_ABOUT_THE_ACTION.has(fc), `${fc} is the world talking; it must be learned`)
  }
})

ok('nothing_found is evidence about a PLACE, not about the verb', () => {
  // It was in EVIDENCE_ABOUT_THE_ACTION, and moving it is the point of the
  // change. It is still the world talking -- so it is still evidence, and must
  // still be recorded -- but what it says is "there is none within N blocks of
  // HERE", and the avoid key carries no position. As an unconditional rule it
  // was a fact about a place enforced as a fact about a verb, and it is the
  // largest single contributor to the fleet's learned_avoid mass.
  assert.ok(!EVIDENCE_ABOUT_THE_ACTION.has('nothing_found'),
    'nothing_found must not accrue unconditionally: it is scoped to a place')
  assert.ok(EVIDENCE_ONLY_IF_HERE.has('nothing_found'))
  assert.equal(evidenceScope('nothing_found'), 'place')
})

ok('precondition refusals are conditional, not free', () => {
  for (const fc of ['missing_ingredients', 'missing_tool', 'needs_station']) {
    assert.ok(EVIDENCE_ONLY_IF_STUCK.has(fc), `${fc} must be gap-gated, not exempt`)
    assert.ok(!EVIDENCE_ABOUT_THE_ACTION.has(fc), `${fc} must not accrue unconditionally`)
  }
})

ok('the evidence sets never overlap, pairwise across all of them', () => {
  for (const [an, a] of Object.entries(EVIDENCE_SETS)) {
    for (const [bn, b] of Object.entries(EVIDENCE_SETS)) {
      if (an === bn) continue
      for (const fc of a) assert.ok(!b.has(fc), `${fc} cannot be both ${an} and ${bn}`)
    }
  }
  // ...and evidenceScope must agree with the sets, or there are two policies.
  for (const [name, s] of Object.entries(EVIDENCE_SETS)) {
    for (const fc of s) assert.equal(evidenceScope(fc), name, `${fc} scope`)
  }
})

ok('craft lacking a station classifies apart from craft lacking inputs', () => {
  assert.equal(classifyFailure('no recipe available for stick; place the crafting_table first'),
               'needs_station')
  assert.equal(classifyFailure('cannot craft oak_planks -- needs 1x oak_log (you have nothing)'),
               'missing_ingredients')
})

// --- 4. the gate may not make the goal unreachable ---------------------------

const mockBot = () => ({
  registry: {
    blocksByName: { oak_log: {}, stone: {} },
    itemsByName: { oak_planks: {}, stick: {}, stone_pickaxe: {}, oak_log: {} },
  },
  entity: { position: { x: 0, y: 70, z: 0 } },
  players: {}, inventory: { items: () => [] },
})

ok('a producer of what the milestone needs is not hard-blocked', () => {
  const L = fresh('critical')
  L.data.avoid['craft:{"item":"oak_planks"}'] =
    { skill: 'craft', args: { item: 'oak_planks' }, fails: 47, classes: {}, since: Date.now() }
  const g = new AdmissionControl(L)
  const r = g.check({ skill: 'craft', args: { item: 'oak_planks' } }, mockBot(),
                    new Set(['oak_planks', 'oak_log']))
  assert.equal(r.ok, true, '47 fails on the one action the milestone needs still must not close the door')
  assert.match(r.forced ?? '', /oak_planks/)
})

ok('an unrelated blocked action is still blocked', () => {
  const L = fresh('unrelated')
  L.data.avoid['craft:{"item":"stone_pickaxe"}'] =
    { skill: 'craft', args: { item: 'stone_pickaxe' }, fails: 47, classes: {}, since: Date.now() }
  const g = new AdmissionControl(L)
  const r = g.check({ skill: 'craft', args: { item: 'stone_pickaxe' } }, mockBot(),
                    new Set(['oak_planks']))
  assert.equal(r.ok, false, 'the exemption must be narrow or the gate stops meaning anything')
  assert.equal(r.reason, 'learned_avoid')
})

ok('no wanted-set means no exemption', () => {
  const L = fresh('nowanted')
  L.data.avoid['craft:{"item":"oak_planks"}'] =
    { skill: 'craft', args: { item: 'oak_planks' }, fails: 47, classes: {}, since: Date.now() }
  const g = new AdmissionControl(L)
  const r = g.check({ skill: 'craft', args: { item: 'oak_planks' } }, mockBot(), null)
  assert.equal(r.ok, false, 'an unresolvable recipe must not silently grant a blanket exemption')
})

ok('gather is a producer too', () => {
  const L = fresh('gatherprod')
  L.data.avoid['gather:{"block":"oak_log","count":1}'] =
    { skill: 'gather', args: { block: 'oak_log', count: 1 }, fails: 9, classes: {}, since: Date.now() }
  const g = new AdmissionControl(L)
  const r = g.check({ skill: 'gather', args: { block: 'oak_log', count: 1 } }, mockBot(),
                    new Set(['oak_log']))
  assert.equal(r.ok, true,
    `blocking the only source of the input is how the deadlock started (got ${r.reason ?? 'ok'})`)
})

console.log(`\n${n} passed`)
