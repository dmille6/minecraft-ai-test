// THE CAPABILITY THE FLEET ALREADY OWNS AND HAS NEVER USED.
//
// 27 of 80 bots carry ladders and 23 of those carry EXACTLY THREE -- one craft,
// made once, never again. No bot holds 25. 64 of 80 could craft 25+ from the
// wood in hand (median 138). The climb a stranded bot is asked for has a median
// of 24 blocks. And `place` ran 44 times in five hours, every one a
// crafting_table -- so this can never be advice.
//
// Every case below is a real 1.21.8 block shape, checked against minecraft-data.
import assert from 'node:assert'
import test from 'node:test'
import { canAnchorLadder, ladderCellFree, ladderReach, ladderPlan } from '../src/ladder.mjs'

// Shapes exactly as minecraft-data 1.21.8 reports them.
const B = (name, boundingBox, transparent) => ({ name, boundingBox, transparent })
const STONE  = B('stone', 'block', false)
const LOG    = B('oak_log', 'block', false)
const PLANKS = B('oak_planks', 'block', false)
const LEAVES = B('oak_leaves', 'block', true)     // boundingBox BLOCK, transparent TRUE
const GLASS  = B('glass', 'block', true)
const ICE    = B('ice', 'block', true)
const FENCE  = B('oak_fence', 'block', false)     // opaque AND full per the registry
const SLAB   = B('oak_slab', 'block', false)
const STAIRS = B('oak_stairs', 'block', false)
const TNT    = B('tnt', 'block', false)
const AIR    = B('air', 'empty', true)
const WATER  = B('water', 'empty', true)
const LAVA   = B('lava', 'empty', true)
const GRASS  = B('short_grass', 'empty', true)
const LADDER = B('ladder', 'empty', true)

test('a ladder attaches to full opaque blocks', () => {
  for (const b of [STONE, LOG, PLANKS, B('cobblestone','block',false), B('deepslate','block',false)]) {
    assert.equal(canAnchorLadder(b), true, b.name)
  }
})

test('LEAVES ARE THE TRAP: boundingBox block, but a ladder will not hold', () => {
  // This fleet lives in forests -- _trapped_in_canopy fired 281 times -- so the
  // obvious `boundingBox === 'block'` test would fail silently on most walls it
  // actually meets. `transparent` is the field that separates leaves from logs.
  assert.equal(LEAVES.boundingBox, 'block', 'precondition: leaves ARE a full block')
  assert.equal(canAnchorLadder(LEAVES), false)
  assert.equal(canAnchorLadder(GLASS), false)
  assert.equal(canAnchorLadder(ICE), false)
})

test('AND SO ARE FENCES, SLABS AND STAIRS -- opaque and full, and still no face', () => {
  // Every one of these passes `boundingBox === 'block' && !transparent` in
  // minecraft-data 1.21.8 and none of them can hold a ladder.
  for (const b of [FENCE, SLAB, STAIRS, TNT]) {
    assert.equal(b.boundingBox === 'block' && b.transparent === false, true,
      `precondition: ${b.name} passes the naive two-field test`)
    assert.equal(canAnchorLadder(b), false, `${b.name} must be refused anyway`)
  }
})

test('nothing empty is an anchor, and unknown input fails closed', () => {
  for (const b of [AIR, WATER, LAVA, GRASS, null, undefined, {}, { name: 5 }]) {
    assert.equal(canAnchorLadder(b), false)
  }
})

test('the ladder goes into an EMPTY cell, never a liquid', () => {
  assert.equal(ladderCellFree(AIR), true)
  assert.equal(ladderCellFree(GRASS), true, 'grass is replaceable')
  assert.equal(ladderCellFree(LADDER), true, 'a rung already there is fine')
  assert.equal(ladderCellFree(WATER), false)
  assert.equal(ladderCellFree(LAVA), false)
  assert.equal(ladderCellFree(STONE), false)
  assert.equal(ladderCellFree(null), false)
})

// --- the column has to be CONTINUOUS ---------------------------------------

test('reach counts the first UNBROKEN run, not the total good cells', () => {
  // The pathfinder climbs a ladder only while it is unbroken, so eight good
  // rungs with a hole at four is worth four.
  const cells   = [AIR, AIR, AIR, AIR, STONE, AIR, AIR, AIR]
  const anchors = [STONE, STONE, STONE, STONE, STONE, STONE, STONE, STONE]
  assert.equal(ladderReach({ cells, anchors }), 4)
})

test('a wall that turns to leaves halfway stops the column there', () => {
  const cells   = [AIR, AIR, AIR, AIR, AIR]
  const anchors = [STONE, STONE, LEAVES, STONE, STONE]
  assert.equal(ladderReach({ cells, anchors }), 2, 'the canopy ends the climb')
})

test('no wall at all is zero reach', () => {
  assert.equal(ladderReach({ cells: [AIR, AIR], anchors: [AIR, AIR] }), 0)
  assert.equal(ladderReach({}), 0)
})

// --- and it refuses a climb it cannot finish --------------------------------

test('IT WILL NOT START A COLUMN IT CANNOT FINISH', () => {
  // Same rule as canFinishClimb for pillaring: a half-built column leaves the
  // bot where it started, holding fewer ladders.
  assert.equal(ladderPlan({ need: 24, have: 24, reach: 24 }).ok, false, 'exactly enough is not enough')
  assert.equal(ladderPlan({ need: 24, have: 25, reach: 24 }).ok, true, 'one in reserve is')
})

test('a wall shorter than the climb is refused, and says so', () => {
  const r = ladderPlan({ need: 24, have: 99, reach: 9 })
  assert.equal(r.ok, false)
  assert.match(r.why, /9 of the 24/)
})

test('too few ladders is refused, and names both numbers', () => {
  const r = ladderPlan({ need: 24, have: 3, reach: 30 })
  assert.equal(r.ok, false)
  assert.match(r.why, /3 ladders/)
  assert.match(r.why, /24-block climb/)
  assert.match(r.why, /need 25/)
})

test('THE LIVE CASE: the median bot holds 3 and the median climb is 24', () => {
  assert.equal(ladderPlan({ need: 24, have: 3, reach: 24 }).ok, false,
    'which is exactly why nothing changes until they craft more')
})

test('junk in is refused rather than throwing', () => {
  for (const a of [{}, { need: 0 }, { need: NaN, have: 9, reach: 9 },
                   { need: 5, have: NaN, reach: 9 }, { need: 5, have: 9, reach: NaN }]) {
    assert.equal(ladderPlan(a).ok, false)
  }
})

// --- the rung in the lattice ------------------------------------------------
import { escapePlan, ESCAPES } from '../src/escape.mjs'

test('climb_ladder is a declared rung', () => {
  assert.ok(ESCAPES.includes('climb_ladder'), ESCAPES.join(','))
})

test('DEFAULT FALSE: every existing state is unchanged', () => {
  // The flag defaults false, so a caller that knows nothing about ladders gets
  // exactly the lattice it had before this rung existed.
  const base = { trapped: true, lateralTread: true }
  assert.equal(escapePlan(base), 'stair_up')
  assert.equal(escapePlan({ trapped: true, columnOpen: true, blocks: 99, climbNeed: 24 }), 'pillar_up')
})

test('it beats the RAMP, which costs a tool and digs', () => {
  assert.equal(escapePlan({ trapped: true, lateralTread: true, ladderReady: true }), 'climb_ladder')
})

test('it beats the PILLAR, which is one-way and spends a block per level', () => {
  assert.equal(escapePlan({ trapped: true, columnOpen: true, blocks: 99, climbNeed: 24,
                            ladderReady: true }), 'climb_ladder')
})

test('BUT DOWN STILL BEATS UP -- climbing produced this population', () => {
  // A free descent must not be traded for a climb just because ladders are held.
  assert.equal(escapePlan({ trapped: true, underfootSolid: true, underfootDrop: 2,
                            ladderReady: true }), 'dig_down')
  assert.equal(escapePlan({ trapped: true, floorBelowSolid: true, ladderReady: true }),
    'ride_floor_down')
})

test('and water still comes first, because swimming is travel', () => {
  assert.equal(escapePlan({ trapped: true, afloat: true, columnOpen: true, ladderReady: true }), 'surface_swim')
})

test('not trapped is still none, ladders or no ladders', () => {
  assert.equal(escapePlan({ trapped: false, ladderReady: true }), 'none')
})
