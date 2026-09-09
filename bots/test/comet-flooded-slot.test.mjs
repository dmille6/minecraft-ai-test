// placebo-b-Comet: FOUR DAYS AT ONE COORDINATE, AND BOTH GUARDS WERE RIGHT.
//
// Measured 2026-09-09 over a full walk of the bot's own telemetry (81,601 rows,
// 3 days): position (652.7, -18.8, 106.7), positional span 0.4 blocks, health
// 20/20 every sample, inventory {pointed_dripstone 14, stick 8, glow_ink_sac
// 39} unchanged for the entire window. No pickaxe. No placeable block: the
// lattice observed `blocks=0` on every consultation.
//
// It is in a 1-wide flooded slot inside a tuff-brick structure. The escape
// lattice was consulted THREE TIMES in three days and produced exactly two
// answers:
//
//   plan=surface_swim -> "swam 1.1 blocks on a fixed heading"
//   plan=dig_down     -> "tuff_bricks underfoot is too slow to break, tool or not"
//
// TWO DEFECTS MEET HERE, AND FIXING EITHER ALONE LEAVES THE BOT WHERE IT IS.
//
//  1. The refusal is MIS-PRICED. tuff_bricks hardness is 1.5 -- identical to
//     stone. The 37,500ms that tripped the 30s cap is the 5x `notOnGround`
//     penalty, applied to a question `digbudget.mjs` says must never see it.
//
//  2. The lattice is STATELESS. A rung that refuses changes nothing, so the
//     next consultation sees the same state and picks the same rung. Comet's
//     `underfootSolid` and `drop=1` are permanent facts of that slot, so
//     `dig_down` wins whenever it is not afloat and `surface_swim` wins
//     whenever it is. Between them they cover every tick and `stair_up` -- the
//     bare-handed ramp, the one rung that needs no material and no tool -- has
//     never been offered to this bot once.
//
// So this file tests the CHAIN, not either guard. Every trap this project has
// shipped passed its own unit tests.
import assert from 'node:assert'
import test from 'node:test'
import { escapeDigPlan, planDig, MAX_DIG_MS } from '../src/digbudget.mjs'
import { escapePlan, ESCAPES, untotalStates } from '../src/escape.mjs'

// Registry numbers, 1.21.8, verified against prismarine-block's own digTime
// rather than typed from memory:
//   node -e "Block.fromStateId(blocksByName.tuff_bricks.defaultState,0)
//            .digTime(null,false,inWater,notOnGround,[],undefined)"
const TUFF_BRICKS = { groundedMs: 7_500, airborneMs: 37_500 }
const STONE = { groundedMs: 7_500, airborneMs: 37_500 }        // hardness 1.5, same
const DEEPSLATE = { groundedMs: 15_000, airborneMs: 75_000 }   // hardness 3
const OBSIDIAN = { groundedMs: 250_000, airborneMs: 1_250_000 }

// No pickaxe: `bestTool` returns null and `predictedDigMs(block, null, env)` is
// the bare-handed number again. This is Comet's real argument set.
const noTool = b => ({
  bareHardnessMs: b.groundedMs, bareActualMs: b.airborneMs,
  toolHardnessMs: b.groundedMs, toolActualMs: b.airborneMs,
})

test('POSITIVE CONTROL: escapeDigPlan can refuse, and can allow', () => {
  // Without this every assertion below could pass by always allowing.
  assert.equal(escapeDigPlan(noTool(OBSIDIAN)).refuse, true, 'obsidian is still hopeless')
  assert.equal(escapeDigPlan(noTool(STONE)).refuse, false)
})

test('THE REFUSAL COMET GOT: the old predicate really did decline tuff_bricks', () => {
  // The old call was digHand on the SITUATIONAL prediction, whose refuse is
  // planDig(airborne). If this ever stops refusing, the bug being fixed has
  // changed shape and the rest of this file is testing nothing.
  assert.equal(planDig(TUFF_BRICKS.airborneMs).refuse, true,
    'the airborne prediction really is over the cap -- this is the observed refusal')
  assert.ok(TUFF_BRICKS.airborneMs > MAX_DIG_MS)
})

test('...and it was mis-priced: tuff_bricks is as hard as stone, exactly', () => {
  assert.equal(TUFF_BRICKS.groundedMs, STONE.groundedMs,
    'hardness 1.5 both; a fleet that breaks stone can break tuff_bricks')
  assert.equal(planDig(TUFF_BRICKS.groundedMs).refuse, false)
  const plan = escapeDigPlan(noTool(TUFF_BRICKS))
  assert.equal(plan.refuse, false, 'Comet must be allowed to swing at its own floor')
  assert.equal(plan.hand, 'bare', 'and bare-handed: it holds no pickaxe to spend')
  assert.ok(plan.budgetMs > TUFF_BRICKS.airborneMs,
    `the deadline (${plan.budgetMs}ms) must cover the dig that will actually ` +
    `happen (${TUFF_BRICKS.airborneMs}ms), or the fix trades a refusal for a timeout`)
})

test('the same repair carries deepslate, which is most of what is below y=0', () => {
  // 75,000ms airborne. If the cap could veto on the situational number, every
  // submerged or airborne bot below sea level would be told its floor is
  // unbreakable -- and deepslate is the floor below y=0.
  assert.equal(planDig(DEEPSLATE.airborneMs).refuse, true, 'POSITIVE CONTROL')
  const plan = escapeDigPlan(noTool(DEEPSLATE))
  assert.equal(plan.refuse, false)
  assert.ok(plan.budgetMs > DEEPSLATE.airborneMs)
})

test('HARDNESS STILL REFUSES. This must not become "always dig".', () => {
  // The failure mode of over-correcting is a bot spending its whole escape
  // budget on one block. Obsidian is 250s bare-handed and must still fail fast.
  const plan = escapeDigPlan(noTool(OBSIDIAN))
  assert.equal(plan.refuse, true)
  assert.equal(plan.hand, null)
  assert.equal(plan.budgetMs, 0)
})

test('a tool that CAN break it is still preferred when bare hands cannot', () => {
  // Obsidian bare = 250s (refused), wooden pick = 125s (also refused);
  // diamond pick = 9.4s grounded. Hardness admits the tool, so the tool is used.
  const plan = escapeDigPlan({
    bareHardnessMs: OBSIDIAN.groundedMs, bareActualMs: OBSIDIAN.airborneMs,
    toolHardnessMs: 9_400, toolActualMs: 47_000,
  })
  assert.equal(plan.refuse, false)
  assert.equal(plan.hand, 'tool')
})

test('BARE FIRST when both hands qualify — 68% of lost pickaxes died escaping', () => {
  const plan = escapeDigPlan({
    bareHardnessMs: 7_500, bareActualMs: 7_500,
    toolHardnessMs: 600, toolActualMs: 600,
  })
  assert.equal(plan.hand, 'bare')
})

// --- THE CHAIN -------------------------------------------------------------
//
// Comet's observed lattice inputs. `underfootSolid`, `underfootDrop` and
// `blocks` are read straight off `_stranded_escape_try`; `afloat` from 7,866
// `_water_float` events; `lateralTread` from the 1-wide slot (positional span
// 0.4 blocks in x) and from `surface` reporting `dig failed on tuff` on a
// lateral shaft climb.
const COMET = Object.freeze({
  trapped: true, afloat: true, health: 20, blocks: 0,
  underfootSolid: true, underfootDrop: 1, floorBelowSolid: true,
  lateralTread: true, columnOpen: true, ladderReady: false,
})

test('THE TRAP, REPRODUCED: the stateless lattice offers Comet two rungs, forever', () => {
  // afloat toggles as the bot bobs; nothing else about the slot ever changes.
  assert.equal(escapePlan({ ...COMET, afloat: true }), 'surface_swim')
  assert.equal(escapePlan({ ...COMET, afloat: false }), 'dig_down')
  // And that is the whole reachable set. stair_up is not merely unlucky, it is
  // unreachable: both branches above it return unconditionally for this state.
  const everOffered = new Set()
  for (const afloat of [true, false]) {
    for (let i = 0; i < 50; i++) everOffered.add(escapePlan({ ...COMET, afloat }))
  }
  assert.deepEqual([...everOffered].sort(), ['dig_down', 'surface_swim'])
  assert.ok(!everOffered.has('stair_up'),
    'stair_up is the rung for a bot with walls and no material, and it is never offered')
})

test('THE CHAIN, REPAIRED: refused rungs are skipped and stair_up is reached', () => {
  // This is the runtime loop's decision sequence, exactly: run a rung, and if
  // its routine reports a refusal rather than movement, exclude it and ask again.
  const exclude = []
  const chain = []
  for (let i = 0; i < ESCAPES.length + 2; i++) {
    const plan = escapePlan({ ...COMET, exclude })
    chain.push(plan)
    if (plan === 'step_off' || plan === 'none') break
    exclude.push(plan)
  }
  assert.deepEqual(chain,
    ['surface_swim', 'dig_down', 'ride_floor_down', 'stair_up', 'step_off'])
  assert.ok(chain.indexOf('stair_up') > -1, 'the bare-handed ramp is now reachable')
  assert.ok(chain.indexOf('stair_up') < chain.indexOf('step_off'),
    'and it is reached BEFORE the bottom, so no exclusion walks a bot to its death '
    + 'while a survivable rung is left')
})

test('the chain terminates, and its last rung is the bottom', () => {
  // A loop over a lattice that could cycle would be a livelock in the reflex.
  const exclude = []
  let plan = null
  for (let i = 0; i < 100; i++) {
    plan = escapePlan({ ...COMET, exclude })
    if (plan === 'step_off') break
    assert.ok(!exclude.includes(plan), `${plan} was offered twice — the loop can cycle`)
    exclude.push(plan)
  }
  assert.equal(plan, 'step_off')
  assert.ok(exclude.length < ESCAPES.length, 'bounded by the closed enum')
})

test('EXCLUSION CANNOT EMPTY THE SET — totality survives every exclusion', () => {
  // The property that made this module worth writing. The tail branch reasoned
  // "no solid lateral neighbour means an open one", which held only because
  // stair_up returned for the other case. Excluding stair_up broke that.
  const states = []
  for (const afloat of [true, false]) {
    for (const underfootSolid of [true, false]) {
      for (const floorBelowSolid of [true, false]) {
        for (const lateralTread of [true, false]) {
          for (const columnOpen of [true, false]) {
            for (const canStepOff of [true, false]) {
              for (const blocks of [0, 30]) {
                for (const exclude of [[], ['dig_down'], ['surface_swim', 'dig_down'],
                  ['stair_up'], ['surface_swim', 'dig_down', 'ride_floor_down', 'stair_up'],
                  ESCAPES.filter(e => e !== 'none')]) {
                  states.push({ trapped: true, health: 20, blocks, afloat,
                    underfootSolid, underfootDrop: 1, floorBelowSolid,
                    lateralTread, columnOpen, canStepOff, exclude })
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(states.length > 700, `POSITIVE CONTROL: ${states.length} states enumerated`)
  assert.deepEqual(untotalStates(states), [],
    'every state, under every exclusion, must still name an action')
})

test('an empty exclusion list changes NOTHING for any state', () => {
  // The deploy-safety property: bots that are not stuck must behave identically.
  let checked = 0
  for (const afloat of [true, false]) {
    for (const underfootSolid of [true, false]) {
      for (const floorBelowSolid of [true, false]) {
        for (const lateralTread of [true, false]) {
          for (const columnOpen of [true, false]) {
            for (const ladderReady of [true, false]) {
              for (const blocks of [0, 30]) {
                for (const underfootDrop of [null, 1, 40]) {
                  for (const canStepOff of [true, false]) {
                    const s = { trapped: true, health: 20, blocks, afloat, underfootSolid,
                      underfootDrop, floorBelowSolid, lateralTread, columnOpen,
                      ladderReady, canStepOff }
                    assert.equal(escapePlan({ ...s, exclude: [] }), escapePlan(s))
                    checked++
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 500, `POSITIVE CONTROL: compared ${checked} states`)
})
