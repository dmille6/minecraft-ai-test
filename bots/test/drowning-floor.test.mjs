// A FLAT OXYGEN COUNTER MEANS TWO OPPOSITE THINGS.
//
// The trend test that fixed the 2,278-escapes-per-hour wading bug asks whether
// oxygen is MOVING. Wading holds it pinned at full; drowning drains it. True --
// but a bot that has already drained holds it pinned at the FLOOR, and that is
// just as flat. `losing` goes false, the rescue releases the body, and
// `drowning_escaped success` is written for a bot that is underwater with no
// air left.
//
// Miner01, 2026-08-10, at -24,60,-90 -- fourteen "successful escapes" in 22
// seconds while oxygen fell 283 -> 262 -> 256 -> 18 -> 15, y went 61 -> 60, and
// then:
//
//     18:14:23  _death  failed  drowned
//
// The inventory went with it (-236 items) and the milestone chain behind it
// collapsed: minutes of `cannot craft wooden_pickaxe -- gather oak_log first`.
//
// The reflex was not failing to fire. It was declaring victory and standing
// down, fourteen times, on evidence that only ruled out getting WORSE.
import assert from 'node:assert'
import { assessAir, breathingAgain } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const bot = (oxygen, { health = 20, head = 'water' } = {}) => ({
  oxygenLevel: oxygen,
  health,
  entity: { position: { offset: () => ({}) }, isInWater: head === 'water' },
  blockAt: () => ({ name: head, boundingBox: head === 'water' ? 'empty' : 'empty' }),
})

// THE REAL PREDICATE, imported -- not a local copy of it. A reimplementation
// here would keep passing after reflex.mjs changed, which is the same kind of
// test that lets a defect ship: one that asserts against its own assumptions
// instead of against the code under test.
const wouldRelease = breathingAgain

// --- the fourteen false escapes -------------------------------------------
t('oxygen pinned at the FLOOR must not count as surfaced', () => {
  // Miner01's actual tail: flat at 15 on a ~300 scale.
  assert.equal(wouldRelease(15, [15, 15, 15, 15], 300), false,
    'flat-at-empty is drowning, not breathing -- this is the reading that ' +
    'produced "surfaced with oxygen 15" four seconds before it died')
})

t('oxygen pinned at FULL is wading, and must release', () => {
  assert.equal(wouldRelease(300, [300, 300, 300], 300), true,
    'the wading case the trend test exists for must keep working')
})

t('oxygen climbing back up counts as surfaced even below the threshold', () => {
  assert.equal(wouldRelease(90, [15, 30, 60, 90], 300), true,
    'a bot on its way up is genuinely escaping; holding its body would fight ' +
    'the recovery it is already achieving')
})

t('a still-draining counter does not release', () => {
  assert.equal(wouldRelease(40, [120, 90, 60, 40], 300), false)
})

t('a null counter still releases -- unknown must not mean held forever', () => {
  assert.equal(wouldRelease(null, [], 300), true,
    'the release exists because a held `jump` never clears; an unreadable ' +
    'counter must not resurrect that bug')
})

t('the 0-20 bubble scale behaves the same as the 0-400 tick scale', () => {
  // airMax self-calibrates, so the floor case must hold in either unit.
  assert.equal(wouldRelease(1, [1, 1, 1], 20), false, 'empty on a bubbles build')
  assert.equal(wouldRelease(20, [20, 20], 20), true, 'full on a bubbles build')
})

// --- the underlying assessment still reports the flat floor as "not losing" --
t('assessAir alone cannot distinguish the floor -- which is why the caller must', () => {
  const flatFloor = assessAir(bot(15), { airMax: 300, prevOxygen: 15 })
  assert.equal(flatFloor.losing, false,
    'documents the real behaviour: the trend test sees flat and says not-losing. ' +
    'The release condition is where the distinction has to live')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
