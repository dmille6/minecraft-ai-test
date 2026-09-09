// A SWIMMING BOT COULD NEVER STEP OUT OF THE WATER.
//
// Measured against the REAL Movements class on a synthetic shoreline, not by
// reading the source: a bot floating beside land is offered five neighbours and
// not one of them is onto the land. It can paddle the ocean forever and never
// leave it -- which is what the fleet does. 21% of all bot-time is spent in
// water and only 38.1% of water episodes end ashore.
//
// Cause: `getBlock` derives height from collision shapes, water has none, so
// the water under a floating bot reports its height as the block's BASE. For a
// bot floating at y=62 that reads 61, and stepping onto land whose surface is
// at 63 measures as 63-61 = 2, past getMoveJumpUp's 1.2 ceiling.
//
// These are behaviour tests driving the real class over a fake world. The fix
// is one line of arithmetic and could trivially be "verified" by a grep that
// proves nothing; this proves the planner's actual output changes.
import assert from 'node:assert'
import test from 'node:test'
import mcDataLoader from 'minecraft-data'
import pblock from 'prismarine-block'
import { Movements } from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { installShoreEgress, floatsOnTopOf } = await import('../src/watermoves.mjs')

const V = '1.21.8'
const mcData = mcDataLoader(V)
const Block = pblock(V)

/** Neighbours the planner offers from `node`, and how many land on x>=1. */
function neighbours (world, node, { fix = false } = {}) {
  const bot = {
    registry: mcData,
    game: { minY: -64 },
    entity: { position: new Vec3(node.x, node.y, node.z) },
    blockAt (p) {
      const d = mcData.blocksByName[world(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))]
      if (!d) return null
      const b = Block.fromStateId(d.defaultState, 0)
      b.position = p.clone()
      return b
    },
  }
  const m = new Movements(bot)
  m.liquidCost = 2
  m.canDig = false
  if (fix) installShoreEgress(m)
  const all = m.getNeighbors({ ...node, remainingBlocks: 0 })
  return { all, ontoLand: all.filter(v => v.x >= 1) }
}

// The bot floats with its FEET at y=62, so standing on shore means feet at 63,
// which means the shore's top solid block is y=62.
const SEA_FLOOR = 40
const stepOut = (x, y, z) => y <= SEA_FLOOR ? 'stone' : x >= 1 ? (y <= 62 ? 'stone' : 'air') : (y <= 62 ? 'water' : 'air')
const tooHigh = (x, y, z) => y <= SEA_FLOOR ? 'stone' : x >= 1 ? (y <= 63 ? 'stone' : 'air') : (y <= 62 ? 'water' : 'air')
const dryLand = (x, y, z) => y <= 61 ? 'stone' : (x >= 1 && y <= 62) ? 'stone' : 'air'
const AFLOAT = { x: 0, y: 62, z: 0 }

test('stock pathfinder offers a swimmer NO way onto the shore', () => {
  const before = neighbours(stepOut, AFLOAT)
  assert.ok(before.all.length > 0, 'positive control: it does offer moves, just never the right ones')
  assert.equal(before.ontoLand.length, 0,
    'this is the defect: every offered move goes back out to sea')
})

test('with shore egress installed, the step out exists', () => {
  const after = neighbours(stepOut, AFLOAT, { fix: true })
  assert.ok(after.ontoLand.length > 0,
    'a one-block step onto shore must be plannable from the water')
  for (const mv of after.ontoLand) {
    assert.equal(mv.y, 63, 'and it lands standing on the shore, not inside it')
  }
})

test('a genuine two-block climb is STILL refused', () => {
  // The fix must not become "swimmers may levitate". Vanilla cannot climb two
  // blocks from the water either, and pathfinder has no vertical liquid move.
  assert.equal(neighbours(tooHigh, AFLOAT, { fix: true }).ontoLand.length, 0,
    'correcting the reference height must not invent a climb that cannot be made')
})

test('dry-land pathing is untouched', () => {
  // The control that makes the others mean something: if this changed, the fix
  // is altering terrain reasoning generally rather than the one wrong value.
  const before = neighbours(dryLand, AFLOAT)
  const after = neighbours(dryLand, AFLOAT, { fix: true })
  assert.equal(before.ontoLand.length, after.ontoLand.length)
  assert.equal(before.all.length, after.all.length,
    'a bot on dry ground must plan exactly as it did before')
})

test('only the block underfoot, and only water', () => {
  assert.ok(floatsOnTopOf({ dx: 0, dy: -1, dz: 0, name: 'water' }))
  assert.ok(!floatsOnTopOf({ dx: 1, dy: -1, dz: 0, name: 'water' }),
    'a pond the bot is walking PAST must not read as steppable terrain')
  assert.ok(!floatsOnTopOf({ dx: 0, dy: 0, dz: 0, name: 'water' }))
  assert.ok(!floatsOnTopOf({ dx: 0, dy: -1, dz: 0, name: 'lava' }),
    'lava is in pathfinder\'s liquids set too; stepping off it is a worse bug than the one being fixed')
})

test('the wrapper survives being copied onto a derived profile', () => {
  // index.mjs builds gatherMoves/ascendMoves/descendMoves with Object.assign
  // from the base. A .bind()-ed wrapper would travel with the BASE instance
  // attached and silently read the wrong profile's config.
  const mk = () => {
    const bot = {
      registry: mcData, game: { minY: -64 }, entity: { position: new Vec3(0, 62, 0) },
      blockAt (p) {
        const d = mcData.blocksByName[stepOut(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))]
        if (!d) return null
        const b = Block.fromStateId(d.defaultState, 0); b.position = p.clone(); return b
      },
    }
    return new Movements(bot)
  }
  const base = mk(); base.canDig = false; installShoreEgress(base)
  const derived = Object.create(Object.getPrototypeOf(base))
  Object.assign(derived, base)
  const got = derived.getNeighbors({ ...AFLOAT, remainingBlocks: 0 }).filter(v => v.x >= 1)
  assert.ok(got.length > 0, 'the derived profile must egress too')
})
