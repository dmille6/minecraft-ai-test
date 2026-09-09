// THE PLACING ROUTINE. A fake shaft, so the embodied behaviour is testable.
//
// The ChatGPT review named what a naive routine gets wrong: it cannot place a
// 24-block column from the floor (survival reach is 4.5), it assumes one wall
// direction holds all the way up, and a bot standing in the column can block
// its own placement. Each of those is a case below.
import assert from 'node:assert'
import test from 'node:test'
import { climbLadder, bestLadderWall, PLACE_REACH_RUNGS } from '../src/ladder.mjs'

class GoalBlock { constructor (x, y, z) { Object.assign(this, { x, y, z }) } }
const goals = { GoalBlock }
const V = (x, y, z) => ({ x, y, z, floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)),
                          offset: (a, b, c) => V(x + a, y + b, z + c) })
const B = (name, boundingBox, transparent) => ({ name, boundingBox, transparent })
const STONE = B('stone', 'block', false)
const LEAVES = B('oak_leaves', 'block', true)
const AIR = B('air', 'empty', true)

// A shaft: solid wall at x+1, open column at x=0, bot at the bottom.
function shaft ({ ladders = 40, wallHeight = 40, wallAt = [1, 0], canopyFrom = null } = {}) {
  const world = new Map()
  const key = (x, y, z) => `${x},${y},${z}`
  const bot = {
    placed: [], gotos: [],
    entity: { position: V(0, 64, 0), onGround: true },
    inventory: { items: () => (ladders > 0 ? [{ name: 'ladder', count: ladders }] : []) },
    blockAt (p) {
      const k = key(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
      if (world.has(k)) return world.get(k)
      const [wx, wz] = wallAt
      if (Math.floor(p.x) === wx && Math.floor(p.z) === wz) {
        const h = Math.floor(p.y) - 64
        if (canopyFrom != null && h >= canopyFrom) return LEAVES
        return h < wallHeight ? STONE : AIR
      }
      return AIR
    },
    async equip () {},
    async placeBlock (ref, face) {
      const cell = { x: ref === null ? 0 : Math.floor(ref.pos.x + face.x),
                     y: Math.floor(ref.pos.y + face.y), z: Math.floor(ref.pos.z + face.z) }
      world.set(key(cell.x, cell.y, cell.z), B('ladder', 'empty', true))
      bot.placed.push(cell); ladders--
    },
    pathfinder: { async goto (g) { bot.gotos.push(g); bot.entity.position = V(g.x, g.y, g.z) } },
  }
  // blockAt must hand back a ref carrying its own position for placeBlock
  const raw = bot.blockAt.bind(bot)
  bot.blockAt = p => { const b = raw(p); return b && { ...b, pos: V(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) } }
  return bot
}
const NOSLEEP = { sleep: async () => {} }

test('POSITIVE CONTROL: the fake shaft offers a wall', () => {
  const bot = shaft()
  const at = (dx, dy, dz) => bot.blockAt(V(0 + dx, 64 + dy, 0 + dz))
  assert.ok(bestLadderWall(at, 10).reach >= 10, 'the fixture must present a climbable wall')
})

test('it builds a column and the bot RISES', async () => {
  const bot = shaft()
  const r = await climbLadder(bot, { need: 12, goals, ...NOSLEEP })
  assert.equal(r.ok, true, r.why)
  assert.ok(r.rose >= 1, `expected a rise, got ${r.rose}`)
  assert.ok(bot.placed.length >= 1, 'it must actually place ladders')
})

test('IT PLACES IN BATCHES AND CLIMBS BETWEEN THEM -- reach is 4.5 blocks', async () => {
  // A 12-block column cannot be placed from the floor. If it ever tries, the
  // real server rejects the far rungs and the column ends up with holes.
  const bot = shaft()
  await climbLadder(bot, { need: 12, goals, ...NOSLEEP })
  assert.ok(bot.gotos.length >= 2, `expected several climb legs, got ${bot.gotos.length}`)
  assert.ok(PLACE_REACH_RUNGS <= 4, 'a batch must stay inside survival reach')
})

test('A CANOPY STOPS IT rather than spending ladders on leaves', async () => {
  // The wall turns to oak_leaves at height 3. Leaves are boundingBox='block'
  // and cannot hold a ladder, and this fleet lives in forests.
  const bot = shaft({ canopyFrom: 3 })
  const r = await climbLadder(bot, { need: 20, goals, ...NOSLEEP })
  assert.equal(r.ok, false)
  assert.match(r.why, /wall gives 3 of the 20/)
  assert.equal(bot.placed.length, 0, 'it must not spend a single ladder on a climb it cannot finish')
})

test('too few ladders is refused BEFORE any are placed', async () => {
  const bot = shaft({ ladders: 5 })
  const r = await climbLadder(bot, { need: 20, goals, ...NOSLEEP })
  assert.equal(r.ok, false)
  assert.match(r.why, /5 ladders against a 20-block climb/)
  assert.equal(bot.placed.length, 0, 'a half-built column is worse than none')
})

test('no wall at all is refused', async () => {
  const bot = shaft({ wallHeight: 0 })
  const r = await climbLadder(bot, { need: 10, goals, ...NOSLEEP })
  assert.equal(r.ok, false)
  assert.equal(bot.placed.length, 0)
})

test('AN UNVERIFIED RUNG STOPS THE COLUMN -- placeBlock lies', async () => {
  // bot.placeBlock resolves without throwing when nothing landed. A column with
  // a hole is not climbable at all, so a rung that cannot be read back must end
  // the attempt rather than be assumed.
  const bot = shaft()
  bot.placeBlock = async () => { /* silently does nothing */ }
  const r = await climbLadder(bot, { need: 10, goals, ...NOSLEEP })
  assert.equal(r.ok, false)
  assert.match(r.why, /is not a ladder/)
})

test('missing goals or position is inert, never a throw inside the reflex', async () => {
  assert.equal((await climbLadder(shaft(), { need: 8, goals: {}, ...NOSLEEP })).ok, false)
  assert.equal((await climbLadder({}, { need: 8, goals, ...NOSLEEP })).ok, false)
})
