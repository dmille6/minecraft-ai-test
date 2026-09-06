// ONE ORDERING FOR TWO DIFFERENT PROBLEMS WAS THE DEFECT.
//
// The lattice ranked rungs globally, "DOWN BEFORE UP", on the reasoning that
// climbing produced this population. Server-side scans on 2026-09-06 — RCON
// `execute if block` against the SERVER, not the bot's cache — showed the stuck
// bots are in TWO shapes, and the right first move is opposite in each.
//
// These tests use the measured geometries verbatim.
import assert from 'node:assert'
import fsmod from 'node:fs'
import test from 'node:test'
import { escapePlan, ESCAPES, untotalStates } from '../src/escape.mjs'

// isolated-a-Echo y=187, board-d-Delta y=106: a 1x1 tower, air on all four
// sides at every level, nothing above, the column it built underneath.
const PILLAR = {
  trapped: true, health: 20, climbNeed: 25,
  underfootSolid: true, floorBelowSolid: true, underfootDrop: 1,
  lateralTread: false, solidLateralCount: 0, columnOpen: true, blocks: 0,
}
// isolated-a-Delta y=7, isolated-c-Comet y=20: a two-block pocket at the bottom
// of a one-wide shaft, CAPPED above, walls on all four sides, solid floor.
const ENTOMBED = {
  trapped: true, health: 20, climbNeed: 25,
  underfootSolid: true, floorBelowSolid: false, underfootDrop: null,
  lateralTread: true, solidLateralCount: 4, columnOpen: false, blocks: 0,
}

test('POSITIVE CONTROL: the two measured shapes get DIFFERENT answers', () => {
  // The whole change is that these stop being ranked by one global order.
  const a = escapePlan(PILLAR)
  const b = escapePlan(ENTOMBED)
  assert.notEqual(a, b, `both shapes still collapse to ${a}`)
  assert.ok(ESCAPES.includes(a) && ESCAPES.includes(b))
})

test('THE PILLAR: descend, because there is nothing to cut into', () => {
  assert.equal(escapePlan(PILLAR), 'dig_down',
    'break the block underfoot and fall ONE block onto the next — it is free')
  // Measured: isolated-a-Echo descended y=201 -> 186 doing exactly this.
  assert.equal(escapePlan({ ...PILLAR, underfootDrop: 17 }), 'dig_down',
    'a survivable drop is what this rung is for when there is no ramp')
  // With no floor to land on and no blocks, the bridge branch cannot run.
  assert.equal(escapePlan({ ...PILLAR, underfootSolid: false, floorBelowSolid: false }),
    'step_off', 'and the bottom rung is still reachable for this shape')
})

test('THE ENTOMBED: cut a ramp, because down goes the wrong way', () => {
  assert.equal(escapePlan(ENTOMBED), 'stair_up',
    'bare-handed ascending ramp — it needs no material, and wood is above ground')
  // This is the case that was broken: `ride_floor_down` refuses on entry when
  // there is nothing solid underfoot, and it failed 821 of 821 consultations.
  assert.notEqual(escapePlan({ ...ENTOMBED, underfootSolid: false }), 'ride_floor_down')
})

test('an ENTOMBED bot can never reach the death rung', () => {
  // Walls on four sides means there is nowhere to step. Reaching `step_off`
  // from here would be a remedy the bot cannot perform from where it is.
  let checked = 0
  for (const underfootSolid of [true, false])
  for (const underfootDrop of [null, 0, 1, 3, 17, 40])
  for (const floorBelowSolid of [true, false])
  for (const blocks of [0, 1, 24, 25, 64])
  for (const health of [20, 10, 1]) {
    const plan = escapePlan({ ...ENTOMBED, underfootSolid, underfootDrop, floorBelowSolid, blocks, health })
    assert.notEqual(plan, 'step_off', `entombed state routed to death: ${JSON.stringify({ underfootSolid, underfootDrop, blocks })}`)
    assert.notEqual(plan, 'ride_floor_down', 'the rung that failed 821 of 821 here')
    checked++
  }
  assert.ok(checked >= 360, `POSITIVE CONTROL: ${checked} entombed states checked`)
})

test('a FREE drop still wins for an entombed bot — it often opens a cave', () => {
  // isolated-a-Delta has open space two blocks under its floor. Breaking a free
  // floor costs nothing and needs no material.
  assert.equal(escapePlan({ ...ENTOMBED, underfootDrop: 3 }), 'dig_down')
  assert.equal(escapePlan({ ...ENTOMBED, underfootDrop: 0 }), 'dig_down')
  // But a deep survivable drop does NOT, because it buys depth in the one
  // direction the endpoint does not live.
  assert.equal(escapePlan({ ...ENTOMBED, underfootDrop: 17 }), 'stair_up')
})

test('pillar_up is NOT ceiling-gated — the guard would be dead code', () => {
  // A `y >= climbCeiling` guard here has the same predicate as the ONLY call
  // site's entry condition (`mstate === 'stranded_high'`, which maroonState
  // returns only when y >= climbCeiling). It would be true at 100% of call
  // sites and would delete the rung entirely -- and pillar_up was 3 chosen,
  // 3 succeeded, the only rung with a nonzero success rate in 1,275
  // consultations. The scoring bug it was meant to fix belongs in the
  // routine's postcondition, not in a guard that silently removes the rung.
  const high = { trapped: true, health: 20, climbNeed: 25, solidLateralCount: 0,
                 lateralTread: false, underfootSolid: false, floorBelowSolid: false,
                 underfootDrop: null, blocks: 64, columnOpen: true }
  assert.equal(escapePlan({ ...high, y: 205, climbCeiling: 125 }), 'pillar_up',
    'above the ceiling is where this rung is ACTUALLY consulted')
  assert.equal(escapePlan({ ...high, y: 70, climbCeiling: 125 }), 'pillar_up')
  assert.equal(escapePlan({ ...high, y: null, climbCeiling: null }), 'pillar_up')
  // POSITIVE CONTROL: it is still refused when it cannot be paid for.
  assert.notEqual(escapePlan({ ...high, blocks: 0, y: 205, climbCeiling: 125 }), 'pillar_up')
})

test('TOTALITY holds with an inconsistent count/boolean pair', () => {
  // Adding `solidLateralCount` widened the input space and reopened 40 untotal
  // states: solidLateralCount=0 with lateralTread=true took the open branch,
  // and canStepOff=false then fell through to the raise. `walls` is a max for
  // exactly this reason.
  let n = 0
  for (const canStepOff of [true, false])
  for (const underfootSolid of [true, false])
  for (const underfootDrop of [null, 1, 40])
  for (const columnOpen of [true, false]) {
    const plan = escapePlan({ trapped: true, health: 20, climbNeed: 25, blocks: 0,
      solidLateralCount: 0, lateralTread: true, floorBelowSolid: false,
      underfootSolid, underfootDrop, columnOpen, canStepOff })
    assert.ok(ESCAPES.includes(plan), 'an inconsistent pair must still name a rung')
    n++
  }
  assert.ok(n >= 24, `POSITIVE CONTROL: ${n} inconsistent states checked`)
})

test('TOTALITY survives the split — every state still names an action', () => {
  // Splitting the ordering is exactly the change that can open a hole, so the
  // property is re-asserted over the full grid rather than assumed.
  const states = []
  for (const afloat of [true, false])
  for (const health of [20, 10, 6, 1])
  for (const blocks of [0, 1, 24, 25, 64])
  for (const underfootSolid of [true, false])
  for (const underfootDrop of [null, 0, 1, 3, 17, 40])
  for (const floorBelowSolid of [true, false])
  for (const solidLateralCount of [0, 1, 2, 3, 4])
  for (const columnOpen of [true, false])
  for (const canStepOff of [true, false])
    states.push({ trapped: true, afloat, health, blocks, climbNeed: 25, underfootSolid,
                  underfootDrop, floorBelowSolid, columnOpen, canStepOff,
                  solidLateralCount, lateralTread: solidLateralCount > 0 })
  assert.equal(states.length, 2 * 4 * 5 * 2 * 6 * 2 * 5 * 2 * 2,
    `POSITIVE CONTROL: ${states.length} states — the grid must not silently shrink`)
  assert.deepEqual(untotalStates(states), [], 'a state admits no action')
})

test('and each geometry keeps its OWN guaranteed bottom rung', () => {
  // This is what makes the split safe: the two classes are complements.
  //   lateralTread  -> a solid neighbour exists  -> stair_up can always cut
  //  !lateralTread  -> a passable neighbour      -> step_off always exists
  let sealed = 0, open = 0
  for (const underfootSolid of [true, false])
  for (const underfootDrop of [null, 40])
  for (const floorBelowSolid of [true, false])
  for (const columnOpen of [true, false])
  for (const blocks of [0, 64]) {
    const base = { trapped: true, health: 20, climbNeed: 25, underfootSolid,
                   underfootDrop, floorBelowSolid, columnOpen, blocks }
    const s = escapePlan({ ...base, lateralTread: true, solidLateralCount: 4 })
    const o = escapePlan({ ...base, lateralTread: false })
    assert.ok(s !== 'step_off', 'sealed bots never step off')
    assert.ok(ESCAPES.includes(o))
    sealed++; open++
  }
  assert.ok(sealed >= 32 && open >= 32, `POSITIVE CONTROL: ${sealed}/${open} checked`)
})

test('THE MIDDLE BAND: one wall and three ways out is NOT entombed', () => {
  // hive-b-Bravo, measured: 1 of 4 cardinals solid, capped, head blocked. The
  // first version of this split called it "enclosed" on a boolean and applied
  // the sealed policy to it. It has a ramp anchor AND somewhere to step, so the
  // complement argument that justified the split does not hold here.
  const MIXED = { trapped: true, health: 20, climbNeed: 25, underfootSolid: true,
                  floorBelowSolid: false, underfootDrop: 17, lateralTread: true,
                  solidLateralCount: 1, columnOpen: false, blocks: 0 }

  // It keeps the DEPLOYED behaviour for descent — a survivable drop is taken,
  // because nothing measured says otherwise for this band.
  assert.equal(escapePlan(MIXED), 'dig_down',
    'no evidence justifies refusing a survivable drop here')
  // ...while a sealed bot in the otherwise identical state does not.
  assert.equal(escapePlan({ ...MIXED, solidLateralCount: 4 }), 'stair_up')

  // And the free ramp still outranks the death rung, which needs no new evidence
  // because it is strictly cheaper than dying.
  const noDrop = { ...MIXED, underfootSolid: false, underfootDrop: null }
  assert.equal(escapePlan(noDrop), 'stair_up', 'a free ramp beats stepping off')
  assert.equal(escapePlan({ ...noDrop, solidLateralCount: 0, lateralTread: false }),
    'step_off', 'POSITIVE CONTROL: with NO anchor the bottom rung is still reached')
})

test('a caller with only the boolean gets the LEAST-ASSUMING band', () => {
  // Every existing call site passes `lateralTread` and not the count. Inferring
  // "sealed" from it would silently apply the entombed policy fleet-wide.
  const s = { trapped: true, health: 20, climbNeed: 25, underfootSolid: true,
              underfootDrop: 17, floorBelowSolid: false, columnOpen: false, blocks: 0 }
  assert.equal(escapePlan({ ...s, lateralTread: true }), 'dig_down',
    'boolean-only must NOT be read as sealed')
  assert.equal(escapePlan({ ...s, lateralTread: true, solidLateralCount: 4 }), 'stair_up',
    'only an explicit count of 4 gets the sealed policy')
})

test('the count and the boolean are wired together in the observation', () => {
  const src = fsmod.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
  assert.match(code, /solidLateralCount:/,
    'observeEscapeState must report HOW MANY cardinals are solid, not just whether')
  assert.match(code, /lateralTread:/, 'POSITIVE CONTROL: the boolean is still reported too')
})
