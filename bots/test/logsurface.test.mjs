// LOGSURFACE-01: no log gathering under a roof -- gather climbs out first (skills.mjs logSurfacePlan / terrainRoofTop / gatherRun).
//
// 24 h to 2026-10-28 22:30Z: log gathers succeeded 317/438 at y>=63 and 63/409 below sea level. The real cases below are the
// failing bots' own columns cut from the nightly region copies (fixtures/logsurface-columns.json).
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
process.env.HOME_X = '200'; process.env.HOME_Y = '65'; process.env.HOME_Z = '200'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const SK = await import('../src/skills.mjs')
const { SKILLS, logSurfacePlan, terrainRoofTop, LOG_SURFACE_MS } = SK
const FX = JSON.parse(readFileSync(new URL('./fixtures/logsurface-columns.json', import.meta.url), 'utf8'))

// a block as Movements / gather read it: name + boundingBox from the registry's own shape
const blockOf = (name, p) => {
  const d = mcData.blocksByName[name]
  if (!d) return null
  return { name, type: d.id, position: p, boundingBox: d.boundingBox, diggable: d.diggable,
           canHarvest: () => true, digTime: () => 50, material: d.material, hardness: d.hardness }
}
const columnBlockAt = (feet, column) => q => {
  const dy = q.y - feet.y
  if (q.x !== feet.x || q.z !== feet.z) return null
  const n = column[dy]
  return n === undefined ? null : blockOf(n, q)
}

// ---- the pure rule ----------------------------------------------------------------------------------------------------
test('logSurfacePlan: natural logs only; a roof means a climb to one above it, never below sea level', () => {
  assert.deepEqual(logSurfacePlan({ block: 'oak_log', y: 40, roofTop: 58 }), { toY: 63 })
  assert.deepEqual(logSurfacePlan({ block: 'spruce_log', y: 62, roofTop: 70 }), { toY: 71 })
  assert.deepEqual(logSurfacePlan({ block: 'birch_log', y: 83, roofTop: 95 }), { toY: 96 }, 'a mountain cave is under terrain too')
  assert.equal(logSurfacePlan({ block: 'oak_log', y: 40, roofTop: null }), null, 'open sky below sea level (a ravine, a beach) has trees')
  assert.equal(logSurfacePlan({ block: 'cobblestone', y: 40, roofTop: 58 }), null, 'every other gather is untouched')
  assert.equal(logSurfacePlan({ block: 'stripped_oak_log', y: 40, roofTop: 58 }), null, 'not a natural log')
  assert.equal(logSurfacePlan({ block: 'iron_ore', y: 10, roofTop: 50 }), null)
  assert.equal(logSurfacePlan({ block: 'oak_log', y: NaN, roofTop: 58 }), null)
})

test('logSurfacePlan in the town box: below sea level climbs to sea level only; a house roof above it is never dug', () => {
  assert.deepEqual(logSurfacePlan({ block: 'oak_log', y: 50, roofTop: 72, inTown: true }), { toY: 63 })
  assert.equal(logSurfacePlan({ block: 'oak_log', y: 66, roofTop: 70, inTown: true }), null)
})

test('terrainRoofTop: a canopy is not a roof; the HIGHEST terrain block within 40 is; unloaded reads open', () => {
  const feet = new Vec3(0, 64, 0)
  const canopy = { 2: 'air', 3: 'oak_leaves', 4: 'oak_log', 5: 'oak_leaves', 6: 'birch_leaves' }
  assert.equal(terrainRoofTop(columnBlockAt(feet, canopy), feet), null)
  const cave = { 2: 'stone', 3: 'stone', 4: 'dirt', 5: 'grass_block', 6: 'oak_leaves' }
  assert.equal(terrainRoofTop(columnBlockAt(feet, cave), feet), 64 + 5)
  assert.equal(terrainRoofTop(columnBlockAt(feet, { 1: 'stone', 2: 'air' }), feet), null, 'the head cell (dy 1) is not the roof')
  assert.equal(terrainRoofTop(columnBlockAt(feet, { 41: 'stone' }), feet), null, 'bounded at 40')
  assert.equal(terrainRoofTop(columnBlockAt(feet, { 2: 'water', 3: 'short_grass' }), feet), null, 'water and plants are not a roof')
  assert.equal(terrainRoofTop(() => null, feet), null)
})

// ---- the real cases ---------------------------------------------------------------------------------------------------
const planFor = s => {
  const feet = new Vec3(...s.feet)
  return logSurfacePlan({ block: 'oak_log', y: feet.y, roofTop: terrainRoofTop(columnBlockAt(feet, s.column), feet) })
}

test('REAL: every one of the six top no_path sites (151 rows) is under a terrain roof, and the plan climbs over it', () => {
  const ids = Object.keys(FX.scenes).filter(k => k.startsWith('no_path-'))
  assert.equal(ids.length, 6, 'the six cut sites')
  for (const id of ids) {
    const p = planFor(FX.scenes[id])
    assert.ok(p && p.toY >= 63 && p.toY > FX.scenes[id].feet[1], `${id}: expected a climb, got ${JSON.stringify(p)}`)
  }
})

test('REAL: the below-sea-level buried / nothing_found sites climb; the deep ones to sea level first', () => {
  for (const id of ['unreachable-hive-c--79_34_-8', 'unreachable-isolated-d-392_37_174', 'unreachable-hive-b-336_5_166',
                    'nothing_found-board-c-502_6_167', 'nothing_found-hive-c-12_-10_28']) {
    const s = FX.scenes[id]
    assert.ok(s, `fixture ${id}`)
    assert.ok(planFor(s), `${id} must climb`)
  }
  assert.deepEqual(planFor(FX.scenes['unreachable-hive-c--79_34_-8']), { toY: 63 }, 'roof top 60 -> sea level, not y=61')
})

test('REAL POSITIVE CONTROL: bots under open sky are NOT made to climb (surface sites, canopy or not)', () => {
  const open = ['surf-no_path-placebo-d-137_70_129', 'surf-no_path-placebo-c-431_67_169', 'surf-no_path-placebo-a-247_70_-151',
                'nothing_found-placebo-c-499_65_208', 'no_safe_target-hive-a-352_68_164', 'surf-unreachable-placebo-c-580_71_284']
  for (const id of open) {
    const s = FX.scenes[id]
    assert.ok(s, `fixture ${id}`)
    assert.equal(planFor(s), null, `${id}: open sky, no climb`)
  }
  // and the split is not uniform: the corpus holds both answers
  const all = Object.values(FX.scenes).map(planFor)
  assert.ok(all.filter(Boolean).length >= 15 && all.filter(p => !p).length >= 8, `climb ${all.filter(Boolean).length} / open ${all.filter(p => !p).length}`)
})

// ---- the composition: the REAL gather skill on a fake bot -------------------------------------------------------------
// The bot stands at y=40 in a cave: stone y 42..58 over it, open air above 58, one oak tree at (230, 59..63, 200).
function caveWorld ({ roof = true, ascent = true, climbTo = null, x0 = 200, roofTo = 58, onGoto = null } = {}) {
  const logs = new Set(); for (let y = 59; y <= 63; y++) logs.add(`230,${y},200`)
  const blk = (x, y, z) => {
    const p = new Vec3(x, y, z)
    if (logs.has(`${x},${y},${z}`)) return blockOf('oak_log', p)
    if (y === 39) return blockOf('stone', p)                                  // the cave floor
    if (y === 58 && (roof || x !== x0 || z !== 200)) return blockOf('stone', p)   // the surface ground (the shaft's mouth open)
    if (roof && y >= 42 && y < roofTo && Math.abs(x - x0) < 20) return blockOf('stone', p)
    if (!roof && y >= 42 && y < 58 && Math.abs(x - 200) < 20 && x !== 200) return blockOf('stone', p)   // a shaft open to the sky
    return blockOf('air', p)
  }
  const goals = []
  const surfaces = []
  const bot = {
    entity: { position: new Vec3(x0 + 0.5, 40, 200.5), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20, oxygenLevel: 20,
    inventory: { items: () => [], emptySlotCount: () => 30 },
    registry: { blocksByName: mcData.blocksByName, blocks: mcData.blocks, itemsByName: mcData.itemsByName },
    blockAt: p => blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && b.type === matching)
      if (!fn({ type: mcData.blocksByName.oak_log.id, name: 'oak_log' })) return []
      return [...logs].map(k => k.split(',').map(Number)).map(([x, y, z]) => blk(x, y, z))
        .filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance && fn(b))
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, count).map(b => b.position)
    },
    collectBlock: { movements: {} },
    pathfinder: {
      movements: {}, setMovements () {}, setGoal () {}, stop () {}, isMining: () => false,
      getPathTo: () => ({ status: 'success' }),
      async goto (g) {
        goals.push(g)
        if (g?.y != null && g.x == null) {    // GoalY: the climb lands it on top of the roof column
          surfaces.push(g.y)
          onGoto?.(g)
          bot.entity.position = new Vec3(x0 + 0.5, climbTo ?? g.y, 200.5)
        }
      },
    },
    ascentMovements: {},
    nearestEntity: () => null, entities: {},
    async dig () {}, async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
  }
  if (ascent) bot.withAscentMovements = async fn => fn()
  return { bot, goals, surfaces }
}
const run = (bot, block = 'oak_log') => SKILLS.gather.run({ bot }, { block, count: 1 }, new AbortController().signal)
  .catch(e => ({ status: 'threw', detail: e.message }))

test('CHAIN: under a roof, gather oak_log climbs out BEFORE it searches (and the search then sees the tree)', async () => {
  const { bot, surfaces } = caveWorld()
  const r = await run(bot)
  assert.ok(surfaces.length >= 1, `the climb ran (result ${JSON.stringify(r).slice(0, 200)})`)
  assert.ok(bot.entity.position.y >= 59, `the bot left the cave: y=${bot.entity.position.y}`)
  assert.doesNotMatch(String(r.detail), /every candidate is buried|below sea level/, `the underground refusal is gone: ${r.detail}`)
})

test('CHAIN: the climb that cannot run is the answer -- a failure naming it, and no search from under the roof', async () => {
  const { bot, surfaces } = caveWorld({ ascent: false })
  const r = await run(bot)
  assert.equal(surfaces.length, 0)
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'unsupported', `the climb's own class is carried: ${JSON.stringify(r)}`)
  assert.match(String(r.detail), /under a roof .*climb out stopped/, r.detail)
})

test('CHAIN: a climb that stops short is travel_incomplete with "run gather again", never a search from the hole', async () => {
  const { bot } = caveWorld({ climbTo: 50 })     // every GoalY lands at y=50, still under stone to 57
  const r = await run(bot)
  assert.equal(r.status, 'failed')
  assert.ok(['travel_incomplete', 'stranded', 'path_interrupted'].includes(r.failClass), JSON.stringify(r))
  assert.doesNotMatch(String(r.detail), /every candidate is buried/)
})

test('CONTROL: under open sky (a shaft to the surface) the same gather never climbs', async () => {
  const { bot, surfaces } = caveWorld({ roof: false })
  await run(bot)
  assert.equal(surfaces.length, 0, 'no climb without a roof')
})

test('CONTROL: other blocks are never climbed for, under the same roof', async () => {
  const { bot, surfaces } = caveWorld()
  await run(bot, 'cobblestone')
  assert.equal(surfaces.length, 0)
})

test('the climb leaves gather a share of its contract (two collects at least)', () => {
  assert.ok(LOG_SURFACE_MS <= SK.SKILL_CONTRACTS.gather.maxMs - 2 * 40_000, `${LOG_SURFACE_MS}`)
})

// ---- mutants (anchors asserted present and unique by the helper) -----------------------------------------------------
const { withMutant } = await import('./helpers/mutant.mjs')
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)

test('MUTANT KILLED: without the climb in gatherRun, the bot searches from the cave and never leaves it', async () => {
  await withMutant(SKILLS_URL, 'for (let plan = surfacePlanNow(), climbs = 0;', 'for (let plan = null, climbs = 0;', async mod => {
    const { bot, surfaces } = caveWorld()
    await mod.SKILLS.gather.run({ bot }, { block: 'oak_log', count: 1 }, new AbortController().signal).catch(() => null)
    assert.equal(surfaces.length, 0, 'the mutant does not climb')
    assert.ok(bot.entity.position.y < 42, 'and stays under the roof -- so the CHAIN test above is what kills it')
  })
})

test('MUTANT KILLED: a roof test that counts leaves would make every canopy a climb', async () => {
  await withMutant(SKILLS_URL, "export const TREE_OVERHEAD = /(_leaves|_log|_wood)$/", "export const TREE_OVERHEAD = /^$/", async mod => {
    const feet = new Vec3(0, 64, 0)
    assert.notEqual(mod.terrainRoofTop(columnBlockAt(feet, { 3: 'oak_leaves' }), feet), null, 'the mutant calls a canopy a roof')
  })
})

test('MUTANT KILLED: without the sea-level floor, a roof topping out below 63 would stop the climb under water level', async () => {
  await withMutant(SKILLS_URL, 'return { toY: Math.max(SEA_LEVEL, roofTop + 1) }', 'return { toY: roofTop + 1 }', async mod => {
    assert.deepEqual(mod.logSurfacePlan({ block: 'oak_log', y: 34, roofTop: 60 }), { toY: 61 })
  })
})

test('MUTANT KILLED: without the town branch, a bot under a house roof in town would dig up through it', async () => {
  await withMutant(SKILLS_URL, 'if (inTown) return y < SEA_LEVEL ? { toY: SEA_LEVEL } : null', '', async mod => {
    assert.notEqual(mod.logSurfacePlan({ block: 'oak_log', y: 66, roofTop: 70, inTown: true }), null)
  })
})

// ---- Codex r1 blockers -------------------------------------------------------------------------------------------------
test('BLOCKER 1 (Codex r1): DEEP UNDER THE TOWN (below its ground box) the climb stops at sea level, never over the town roof', async () => {
  // HOME is (200,65,200); the bot is at y=40 in the town's column, under stone to y=72
  const { bot, surfaces } = caveWorld({ roofTo: 73 })
  await run(bot)
  assert.ok(surfaces.length >= 1, 'it climbs')
  assert.ok(Math.max(...surfaces) <= 63, `never aimed over the town: ${surfaces}`)
  // positive control: the same cave 100 blocks east of town is climbed over its roof
  const far = caveWorld({ roofTo: 73, x0: 300 })
  await run(far.bot)
  assert.ok(Math.max(...far.surfaces) >= 73, `outside the town the roof is cleared: ${far.surfaces}`)
})

test('BLOCKER 2 (Codex r1): a climb longer than LOG_SURFACE_GATHER_MS ends the run; the next gather has the whole contract', async () => {
  const realNow = Date.now
  let skew = 0
  Date.now = () => realNow() + skew
  try {
    const { bot, surfaces } = caveWorld({ x0: 300, onGoto: () => { skew += SK.LOG_SURFACE_GATHER_MS + 5_000 } })
    const r = await run(bot)
    assert.ok(surfaces.length >= 1)
    assert.equal(r.failClass, 'collect_budget', JSON.stringify(r))
    assert.match(String(r.detail), /climbed out .*run gather again/)
  } finally { Date.now = realNow }
})

test('MUTANT KILLED: the town test at the bot\'s own depth (the r1 code) aims a deep bot over the town roof', async () => {
  await withMutant(SKILLS_URL, 'inTownBox({ x: feet.x, y: Math.max(feet.y, Math.floor(h.y)), z: feet.z }, h)', 'inTownBox(feet, h)', async mod => {
    const { bot, surfaces } = caveWorld({ roofTo: 73 })
    await mod.SKILLS.gather.run({ bot }, { block: 'oak_log', count: 1 }, new AbortController().signal).catch(() => null)
    assert.ok(Math.max(...surfaces) >= 73, `the mutant climbs over the town: ${surfaces}`)
  })
})

test('MUTANT KILLED: without the long-climb return, the run goes on searching after a 45 s climb', async () => {
  await withMutant(SKILLS_URL, 'if (!left && climbedFor > LOG_SURFACE_GATHER_MS) {', 'if (false) {', async mod => {
    const realNow = Date.now
    let skew = 0
    Date.now = () => realNow() + skew
    try {
      const { bot } = caveWorld({ x0: 300, onGoto: () => { skew += mod.LOG_SURFACE_GATHER_MS + 5_000 } })
      const r = await mod.SKILLS.gather.run({ bot }, { block: 'oak_log', count: 1 }, new AbortController().signal).catch(e => ({ detail: e.message }))
      assert.notEqual(r?.failClass, 'collect_budget', JSON.stringify(r).slice(0, 200))
    } finally { Date.now = realNow }
  })
})
