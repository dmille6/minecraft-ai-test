// 679 OF 679 CONSULTATIONS CHOSE A RUNG THAT REFUSED ON ITS FIRST LINE.
//
// Measured 2026-09-06, the first window after the escape routines were wired.
// Every single `ride_floor_down` consultation returned the same string:
//
//   rode down 0.0 (placed 0, nothing underfoot to stand on)
//
// Not most of them. All of them, one identical reason. `rideFloorDown` opens by
// reading the cell at y-1 and refusing if it is not solid, because that is the
// block it BREAKS: the manoeuvre is to stand on the floor, break it, and land
// on whatever was underneath.
//
// `escapePlan` gated the rung on `floorBelowSolid` -- the cell at y-2 -- which
// is not the routine's precondition at all. y-2 only chooses which branch runs
// once it has started: solid means ride down for free, air means bridge by
// placing one block first. So the lattice selected this rung in exactly the
// states where the routine cannot start, and a proof that the lattice always
// NAMES an action said nothing about whether the named action could run.
import assert from 'node:assert'
import test from 'node:test'
import { escapePlan, ESCAPES, untotalStates } from '../src/escape.mjs'

const TRAPPED = { trapped: true, health: 20 }

test('POSITIVE CONTROL: the lattice still reaches every rung it is meant to', () => {
  // Without this, every assertion below could pass because the lattice had
  // collapsed onto one answer.
  const seen = new Set([
    escapePlan({ ...TRAPPED, afloat: true }),
    escapePlan({ ...TRAPPED, underfootSolid: true, underfootDrop: 1 }),
    escapePlan({ ...TRAPPED, underfootSolid: true, underfootDrop: null, floorBelowSolid: true }),
    escapePlan({ ...TRAPPED, underfootSolid: false, lateralTread: true }),
    escapePlan({ ...TRAPPED, underfootSolid: false, columnOpen: true, blocks: 64, climbNeed: 25 }),
    escapePlan({ ...TRAPPED, underfootSolid: false }),
  ])
  assert.deepEqual([...seen].sort(),
    ['dig_down', 'pillar_up', 'ride_floor_down', 'stair_up', 'step_off', 'surface_swim'].sort())
})

test('THE 679: air underfoot must never be sent to ride_floor_down', () => {
  // The exact observed shape, from the four bots that produced all of them:
  // placebo-c-Comet y=197, isolated-d-Alpha y=205, isolated-a-Echo y=201,
  // placebo-a-Alpha y=143. Air at y-1, solid at y-2 (drop=1), no lateral tread.
  for (const blocks of [0, 2, 10, 11, 18, 60]) {
    const plan = escapePlan({ ...TRAPPED,
      underfootSolid: false, underfootDrop: 1, floorBelowSolid: true,
      lateralTread: false, blocks, climbNeed: 25 })
    assert.notEqual(plan, 'ride_floor_down',
      `blocks=${blocks}: the routine refuses on its first line for this state`)
    assert.ok(ESCAPES.includes(plan), 'and it must still name a real rung')
  }
})

test('...and it must not steal the rung from stair_up, which WORKS there', () => {
  // hive-c-Echo reached ride_floor_down 85 times carrying tread=true, in the
  // same window in which stair_up succeeded for that same bot three times
  // (climbed 5.2, 21.5, 22.4). `floorBelowSolid` was tested before
  // `lateralTread`, so a rung that could not run out-ranked one that could.
  assert.equal(escapePlan({ ...TRAPPED,
    underfootSolid: false, underfootDrop: 1, floorBelowSolid: true,
    lateralTread: true, blocks: 11, climbNeed: 25 }), 'stair_up')
})

test('THE RUNG STILL EXISTS, and now covers the case it is FOR', () => {
  // Solid underfoot but the drop is unmeasured or unsurvivable is precisely
  // what this routine is for: descend one block at a time instead of falling an
  // unknown distance. `harvestUnderfoot` correctly refuses an unmeasured drop
  // (37 of its failures in the same window read `unmeasured`), and before this
  // change those states fell past the rung built for them.
  for (const drop of [null, undefined, NaN, 40, 99]) {
    assert.equal(escapePlan({ ...TRAPPED,
      underfootSolid: true, underfootDrop: drop, floorBelowSolid: true }),
      'ride_floor_down', `drop=${drop} must ride down one block at a time`)
  }
  // A measured, survivable drop is still cheaper: break it and take the fall.
  assert.equal(escapePlan({ ...TRAPPED,
    underfootSolid: true, underfootDrop: 1, floorBelowSolid: true }), 'dig_down')
})

test('the bridge branch needs material, and without it the rung is skipped', () => {
  // With nothing solid at y-2 the routine must PLACE to descend. With no
  // placeable block it stops at `no placeable blocks left` -- before breaking
  // anything, so falling through costs nothing and selecting it would be
  // another guaranteed refusal.
  assert.equal(escapePlan({ ...TRAPPED,
    underfootSolid: true, underfootDrop: null, floorBelowSolid: false, blocks: 0,
    lateralTread: true }), 'stair_up')
  assert.equal(escapePlan({ ...TRAPPED,
    underfootSolid: true, underfootDrop: null, floorBelowSolid: false, blocks: 1 }),
    'ride_floor_down', 'one block is enough to bridge one step')
})

test('THE LATTICE IS STILL TOTAL — over the whole grid, not a sample', () => {
  // Same exhaustive product the totality proof uses. Narrowing a precondition
  // is exactly the change that can open a hole, so the property is re-asserted
  // rather than assumed to survive.
  const states = []
  for (const afloat of [true, false])
  for (const health of [20, 10, 6, 1])
  for (const blocks of [0, 1, 24, 25, 64])
  for (const underfootSolid of [true, false])
  for (const underfootDrop of [null, 0, 1, 3, 17, 40])
  for (const floorBelowSolid of [true, false])
  for (const lateralTread of [true, false])
  for (const columnOpen of [true, false])
    states.push({ trapped: true, afloat, health, blocks, climbNeed: 25,
                  underfootSolid, underfootDrop, floorBelowSolid, lateralTread, columnOpen })
  assert.equal(states.length, 2 * 4 * 5 * 2 * 6 * 2 * 2 * 2,
    `POSITIVE CONTROL: ${states.length} states — the grid must not silently shrink`)
  assert.deepEqual(untotalStates(states), [],
    'a state admits no action — the hole this module exists to make impossible')
})

test('and every answer over that grid is a rung that can actually run', () => {
  // The stronger property, and the one the 679 violated: it is not enough for
  // the lattice to NAME an action. `ride_floor_down` must never be named for a
  // state its routine refuses on entry.
  let checked = 0
  for (const underfootDrop of [null, 1, 40])
  for (const floorBelowSolid of [true, false])
  for (const lateralTread of [true, false])
  for (const columnOpen of [true, false])
  for (const blocks of [0, 1, 64]) {
    const s = { trapped: true, health: 20, climbNeed: 25, underfootSolid: false,
                underfootDrop, floorBelowSolid, lateralTread, columnOpen, blocks }
    assert.notEqual(escapePlan(s), 'ride_floor_down',
      `no solid block underfoot, so the routine cannot start: ${JSON.stringify(s)}`)
    checked++
  }
  assert.ok(checked >= 72, `POSITIVE CONTROL: ${checked} states actually checked`)
})
