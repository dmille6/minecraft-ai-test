// THE TREE FARM x THE TOWN ZONE (treefarm-02 on townzone-01: variants farm-on-3b1ae8b and farm-on-75cfb44). The two guards on gather's dirt targets compose: the zone refuses town ground (Chebyshev 16), the farm
// refuses its own soil (6..30 from home, so partly OUTSIDE the zone). The chain: the zone's remedy ("take dirt more than
// 16 from home") must still find dirt the FARM does not refuse, and neither guard may ever let the other's cell be dug.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
process.env.HOME_X = '200'; process.env.HOME_Y = '65'; process.env.HOME_Z = '200'

import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { townDigClass, townTargetPermit, stairTownClear, inTownBox, TOWN_GROUND_HALF, TOWN_GROUND_DEPTH } = await import('../src/townground.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const TF = await import('../src/treefarm.mjs')
const HOME = { x: 200, y: 65, z: 200 }

// A fake bot whose findBlocks behaves like mineflayer 4.37.1's: the matcher is called first per section PALETTE with a
// positionless block (a type test), then per cell with a positioned block; the nearest `count` matches are returned.
function gatherWorld ({ dirt }) {
  const D = mcData.blocksByName.dirt, AIRT = mcData.blocksByName.air
  const set = new Set(dirt.map(([x, y, z]) => `${x},${y},${z}`))
  const digs = []
  const blk = (x, y, z) => {
    const isDirt = set.has(`${x},${y},${z}`)
    const t = isDirt ? D : AIRT
    return { name: t.name, type: t.id, position: new Vec3(x, y, z), boundingBox: isDirt ? 'block' : 'empty', diggable: isDirt,
             canHarvest: () => true, digTime: () => 50, material: 'mineable/shovel', hardness: isDirt ? 0.5 : 0 }
  }
  const bot = {
    entity: { position: new Vec3(200.5, 64, 200.5), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20,
    inventory: { items: () => [], emptySlotCount: () => 30 },
    registry: { blocksByName: mcData.blocksByName, blocks: mcData.blocks, itemsByName: mcData.itemsByName },
    blockAt: p => blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && (Array.isArray(matching) ? matching.includes(b.type) : b.type === matching))
      if (!fn({ type: D.id, name: 'dirt' })) return []                  // the palette pre-check: no position
      return dirt.map(([x, y, z]) => blk(x, y, z)).filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance && fn(b))
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, count).map(b => b.position)
    },
    collectBlock: { movements: {} },
    pathfinder: { movements: {}, setMovements () {}, setGoal () {}, stop () {}, isMining: () => false, async goto () {} },
    nearestEntity: () => null, entities: {},
    async dig (b) { digs.push(b.position); set.delete(`${b.position.x},${b.position.y},${b.position.z}`) },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
  }
  return { bot, digs }
}

// 40 dirt cells inside the square; outside it, FARM SOIL at x = 217..219 (nearest) and plain dirt further out at x = 224
const townDirt = []
for (let i = 0; i < 40; i++) townDirt.push([202 + (i % 8), 63, 196 + Math.floor(i / 8)])
const farmSoil = [[217, 63, 200], [218, 63, 200], [219, 63, 200]]
const plain = [[224, 63, 200]]
const farmRec = { blueprint: 'treefarm', version: 1, cells: farmSoil.map(([x, y, z]) => ({ x, y: y + 1, z, role: 'plot' })) }

test('ZONE x FARM CHAIN: town ground and farm soil both refused; the zone\'s remedy still finds dirt -- beyond the farm', async () => {
  const { bot, digs } = gatherWorld({ dirt: [...townDirt, ...farmSoil, ...plain] })
  bot.farmIndexNow = () => TF.farmIndex(farmRec)
  const r = await SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
  for (const p of digs) {
    assert.equal(townDigClass(p, 'dirt', HOME), 'free', `dug town ground at ${p}`)
    assert.equal(TF.farmNoDig(TF.farmIndex(farmRec), p.x, p.y, p.z), false, `dug farm soil at ${p}`)
  }
  assert.ok(digs.some(p => p.x === 224), `the plain dirt beyond the farm was taken (digs ${JSON.stringify(digs)}, ${JSON.stringify(r).slice(0, 160)})`)
})

test('ZONE x FARM CHAIN, positive control: without the farm index the farm soil (nearest outside the zone) is what gather takes', async () => {
  const { bot, digs } = gatherWorld({ dirt: [...townDirt, ...farmSoil, ...plain] })
  await SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(() => null)
  assert.ok(digs.some(p => p.x >= 217 && p.x <= 219), `the farm soil is the nearest outside dirt: ${JSON.stringify(digs)}`)
})

test('ZONE x FARM CHAIN: only town ground and farm soil -> a refusal that names the zone\'s remedy, nothing dug', async () => {
  const { bot, digs } = gatherWorld({ dirt: [...townDirt, ...farmSoil] })
  bot.farmIndexNow = () => TF.farmIndex(farmRec)
  const r = await SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
  assert.equal(digs.length, 0, JSON.stringify(digs))
  assert.notEqual(r.status, 'success')
})

// ---- the farm's own cells against the zone's rules (pure) ------------------------------------------------------------
test('THE HARVEST IS NOT TOWN GROUND: a farm tree\'s logs inside the town box are free for gather (the zone filters terrain only); a plot\'s soil there IS ground (the zone guards it too)', () => {
  const log = { x: 210, y: 66, z: 205 }, soil = { x: 210, y: 64, z: 205 }
  assert.ok(inTownBox(log, HOME), 'positive control: the cell is inside the town box')
  for (const n of ['birch_log', 'oak_log', 'birch_sapling', 'oak_leaves', 'torch']) {
    assert.equal(townDigClass(log, n, HOME), 'free', n); assert.equal(townTargetPermit(log, n, HOME).ok, true, n)
  }
  assert.equal(townDigClass(soil, 'grass_block', HOME), 'ground'); assert.equal(townTargetPermit(soil, 'dirt', HOME).ok, false)
})

test('THE FARM NEVER DIGS GROUND: every dig a farm visit can plan is a leftover LOG in a plot column (never soil, never a torch floor)', () => {
  const plot = { x: 206, y: 65, z: 206 }
  const states = [{ plot, state: 'logs_above', logs: [{ x: 206, y: 67, z: 206 }, { x: 206, y: 68, z: 206 }] }, { plot: { x: 210, y: 65, z: 206 }, state: 'soil_lost' }]
  const p = TF.tendPlan({ states, held: { dirt: 4 } })
  const digs = p.actions.filter(a => a.kind === 'dig')
  assert.equal(digs.length, 2)
  for (const d of digs) assert.equal(townDigClass(d.cell, 'birch_log', HOME), 'free')
  // and the soil goes back by PLACEMENT (the zone never restricts a placement)
  assert.deepEqual(p.actions.filter(a => a.role === 'soil').map(a => a.kind), ['place'])
})

test('MINE AND THE FARM INSIDE THE BOX: the zone\'s stair check (stairTownClear) refuses a stair that would cut a farm plot\'s soil inside the town box', () => {
  const nameAt = (x, y, z) => (y <= 64 ? 'grass_block' : 'air')
  const from = { x: 208, y: 65, z: 205 }
  const r = stairTownClear(from, { x: 1, z: 0 }, HOME, nameAt)
  assert.equal(r.clear, false, 'the stair eastward from inside the box cuts town ground (a plot\'s soil included)')
})

test('THE FLOOR BAND IS THE ZONE\'S BAND: the farm\'s inFloorBand uses the zone\'s own constants (Chebyshev 16, home.y-12 .. home.y-2)', () => {
  assert.equal(TF.FLOOR_HALF, TOWN_GROUND_HALF); assert.equal(TF.FLOOR_DEPTH, TOWN_GROUND_DEPTH)
  assert.equal(TF.inFloorBand(HOME, { x: HOME.x + TOWN_GROUND_HALF, y: HOME.y - 2, z: HOME.z }), true)
  assert.equal(TF.inFloorBand(HOME, { x: HOME.x + TOWN_GROUND_HALF + 1, y: HOME.y - 2, z: HOME.z }), false)
})
