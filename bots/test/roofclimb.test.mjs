// ROOFCLIMB-01 (skills.mjs surfaceClimb; owner 11-14 "Yes, fix it"): `surface` climbs out from under a GROUND roof above sea level.
// LIVE showcase 11-14: Haven sat 64 minutes at 1,68,5 under the plaza's floor (y70); every walk answered noPath after 10 nodes and
// `surface` answered "already at y=68, at or above sea level 63 -- nothing to climb". 180 such refusals in 10 h, by all 14 bots.
// BEHAVIOUR: the pure decisions (roofClimbPlan, surfaceTop), the walk-to-open-sky search over mineflayer-pathfinder 2.4.5's REAL
// Movements and REAL A* (wellstep.test.mjs's harness), and the REAL `surface` skill over a small world that digs, places and
// rises: the pocket as it was measured from the saved region. Mutants at the end, each with its anchor asserted present and unique.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const S = await import('../src/skills.mjs')
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)
const V = (x, y, z) => new Vec3(x, y, z)

// climb-escape.test.mjs's withMutant: the anchor must be present AND unique, or the mutant is never written
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

const { Movements } = require_('mineflayer-pathfinder')
const AStar = require_('mineflayer-pathfinder/lib/astar.js')
const Move = require_('mineflayer-pathfinder/lib/move.js')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)

/** A world of named cells over a default: stone to y67, `fill` at 68..70 (the town's hollowed ground), air above. */
function world (cells = {}, { fill = 'dirt' } = {}) {
  const map = new Map(Object.entries(cells))
  const nameAt = (x, y, z) => map.get(`${x},${y},${z}`) ?? (y <= 67 ? 'stone' : y <= 70 ? fill : 'air')
  const blockAt = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
    const b = Block.fromStateId(registry.blocksByName[nameAt(x, y, z)].defaultState, 0); b.position = V(x, y, z); return b
  }
  return { blockAt, nameAt, set: (x, y, z, n) => map.set(`${x},${y},${z}`, n) }
}
/** THE POCKET, as the region file had it (showcase, saved 11-14 04:15Z): air at x 0..2, y 68..69, z 5..7 under the plaza's floor at
 *  y70 (cobblestone over 1,70,5, dirt beside it), stone under it at y67, open air from y71. */
function pocket ({ roof = 'cobblestone', door = false, sky = [] } = {}) {
  const cells = {}
  for (let x = 0; x <= 2; x++) for (let z = 5; z <= 7; z++) for (let y = 68; y <= 69; y++) cells[`${x},${y},${z}`] = 'air'
  cells['1,70,5'] = roof
  // a way out on foot: a trench east along z = 6 whose floor is the pocket's, open to the sky from x = 4
  if (door) for (let x = 3; x <= 6; x++) { cells[`${x},68,6`] = 'air'; cells[`${x},69,6`] = 'air'; if (x >= 4) cells[`${x},70,6`] = 'air' }
  for (const [x, z] of sky) cells[`${x},70,${z}`] = 'air'
  return world(cells)
}
function walkMoves (w) {
  const bot = { registry, version: '1.21.8', blockAt: w.blockAt, entity: { position: V(1.5, 68, 5.5), effects: {} }, entities: {},
                inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot)
  m.canDig = false; m.allowParkour = false; m.allowSprinting = false; m.allow1by1towers = false; m.maxDropDown = 6
  m.scafoldingBlocks = []
  return m
}
function * realSearch (movements, startPos, goal, options = {}) {
  const ctx = new AStar(new Move(Math.floor(startPos.x), Math.floor(startPos.y), Math.floor(startPos.z), 0, 0), movements, goal, options.timeout ?? 4000, options.tickTimeout ?? 40, -1)
  let result = ctx.compute()
  yield { result, astarContext: ctx }
  while (result.status === 'partial') { result = ctx.compute(); yield { result, astarContext: ctx } }
}

/** A bot the REAL surface skill can drive: it digs (the cell becomes air), places (the cell becomes dirt and, mid-jump, the bot
 *  stands one higher), and walks only where `walk` says. Every dig and placement is recorded. */
function simBot (w, { at = [1.5, 68, 5.5], search = null, walk = null, blocks = 64 } = {}) {
  const bot = new EventEmitter()
  const log = { digs: [], places: [], searches: 0, goals: [] }
  let jumping = false
  Object.assign(bot, {
    entity: { position: V(at[0], at[1], at[2]), onGround: true, effects: {} }, entities: {},
    health: 20, food: 20, registry, version: '1.21.8', game: { minY: -64, height: 384 },
    inventory: { items: () => (blocks > 0 ? [{ name: 'dirt', count: blocks, slot: 0, type: registry.itemsByName.dirt.id }] : []) },
    blockAt: w.blockAt,
    async equip () {}, async lookAt () {}, stopDigging () {}, clearControlStates () { jumping = false }, chat () {},
    setControlState (k, v) { if (k === 'jump') jumping = !!v },
    async dig (b) { log.digs.push(`${b.name}@${b.position.x},${b.position.y},${b.position.z}`); w.set(b.position.x, b.position.y, b.position.z, 'air') },
    async placeBlock (ref, face) {
      const c = ref.position.plus(face)
      log.places.push(`${c.x},${c.y},${c.z}`); blocks--
      w.set(c.x, c.y, c.z, 'dirt')
      const p = bot.entity.position
      if (jumping && Math.floor(p.x) === c.x && Math.floor(p.z) === c.z && Math.floor(p.y) === c.y) bot.entity.position = V(p.x, p.y + 1, p.z)
    },
    ascentMovements: { kind: 'ascent' },
    pathfinder: {
      movements: { kind: 'travel' }, goal: null,
      setMovements (m) { this.movements = m },
      getPathTo: () => ({ status: 'noPath', path: [] }),          // the climb's own stage probes: both finish and find nothing
      getPathFromTo (...a) { log.searches++; return search ? search(...a) : (function * () { yield { result: { status: 'noPath', path: [] } } })() },
      setGoal (g) {
        this.goal = g; log.goals.push(g ? `${g.x},${g.y},${g.z}` : null)
        if (g && walk) setTimeout(() => walk(bot, g), 5)
      },
      async goto () {}, stop () {}, isMoving: () => false, isMining: () => false, isBuilding: () => false,
    },
    async withAscentMovements (fn) { return fn() },
  })
  return { bot, log }
}
const surface = (bot, args = {}, mod = S) => mod.SKILLS.surface.run({ bot }, args, new AbortController().signal)

test('roofClimbPlan: ground over the bot is a roof to climb; open sky, a tree, and anything built are not', () => {
  const at = cells => p => { const n = cells[p.y]; return n ? { name: n, boundingBox: n === 'torch' ? 'empty' : 'block' } : { name: 'air', boundingBox: 'empty' } }
  const feet = V(1, 68, 5)
  assert.equal(S.roofClimbPlan(at({}), feet), null, 'open sky')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'cobblestone' }), feet), { toY: 71, top: 70, n: 1 }, 'the plaza floor over the pocket')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'dirt', 71: 'grass_block', 75: 'stone' }), feet), { toY: 76, top: 75, n: 3 }, 'the HIGHEST ground block is the roof')
  assert.equal(S.roofClimbPlan(at({ 72: 'spruce_leaves', 73: 'spruce_log' }), feet), null, 'a tree over the bot is not a roof')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'dirt', 74: 'spruce_leaves' }), feet), { toY: 71, top: 70, n: 1 }, 'ground under a canopy: the ground is the roof')
  assert.deepEqual(S.roofClimbPlan(at({ 72: 'spruce_planks' }), feet), { built: 'spruce_planks', at: 72 }, 'a plank roof is built')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'dirt', 73: 'stone_bricks' }), feet), { built: 'stone_bricks', at: 73 }, 'anything built anywhere in the column refuses the whole climb')
  assert.equal(S.roofClimbPlan(at({ 70: 'torch' }), feet), null, 'a block with no body is not a roof')
  assert.equal(S.roofClimbPlan(at({ 69: 'dirt' }), feet), null, 'the head cell is not overhead (dy starts at 2, as terrainRoofTop)')
  assert.equal(S.roofClimbPlan(() => null, feet), null, 'unloaded reads as open')
  assert.equal(S.roofClimbPlan(at({ 110: 'stone' }), feet), null, 'beyond 40 up is not looked at')
  for (const n of ['glass', 'oak_slab', 'cobblestone_stairs', 'bricks', 'chest', 'crafting_table', 'white_wool', 'oxidized_cut_copper']) assert.equal(S.ROOF_GROUND.test(n), false, `${n} is built`)
  for (const n of ['dirt', 'grass_block', 'cobblestone', 'stone', 'dirt_path', 'gravel', 'sand', 'iron_ore', 'deepslate_coal_ore']) assert.equal(S.ROOF_GROUND.test(n), true, `${n} is ground`)
})

test('surfaceTop: the old tops are unchanged; only a ground roof above sea level names a new one', () => {
  const roof = { toY: 71, top: 70, n: 1 }
  assert.deepEqual(S.surfaceTop({ y: 68, roof }), { top: 71, why: 'roofed' })
  assert.deepEqual(S.surfaceTop({ y: 68, roof: null }), { top: 63, why: 'open' }, 'open sky: already surfaced, as before')
  assert.deepEqual(S.surfaceTop({ y: 68, roof: { built: 'spruce_planks', at: 72 } }), { top: 63, why: 'built' }, 'a house roof is never a top')
  assert.deepEqual(S.surfaceTop({ y: 68, roof, on: false }), { top: 63, why: 'off' }, 'the switch restores the old top')
  assert.deepEqual(S.surfaceTop({ y: 40, roof }), { top: 63, why: 'below_sea' }, 'below sea level the climb is to sea level, as before')
  assert.deepEqual(S.surfaceTop({ y: 62.9, roof }), { top: 63, why: 'below_sea' })
  assert.deepEqual(S.surfaceTop({ y: 63, roof }), { top: 71, why: 'roofed' }, 'AT sea level under a roof is the first height the old rule refused')
  assert.deepEqual(S.surfaceTop({ y: 68, toY: 75, roof }), { top: 75, why: 'caller' }, "an internal caller's own top wins")
  assert.deepEqual(S.surfaceTop({ y: 68, toY: 40, roof: null }), { top: 63, why: 'caller' }, 'and is never below sea level')
  assert.deepEqual(S.surfaceTop({ y: NaN, roof }), { top: 63, why: 'below_sea' }, 'no height: the old top')
  assert.equal(S.roofClimbOn({}), true); assert.equal(S.roofClimbOn({ ROOFCLIMB: '1' }), true)
  for (const v of ['off', '0', 'false', 'no', 'OFF']) assert.equal(S.roofClimbOn({ ROOFCLIMB: v }), false, v)
})

test('the walk to open sky, searched with the REAL A*: a sealed pocket has none, a pocket with a way out has one', async () => {
  const from = V(1.5, 68, 5.5)
  // sealed: nine cells of floor under a roof, every search finishes with nothing
  const sealed = pocket()
  const a = await S.skyWalkPlan({ search: realSearch, movements: walkMoves(sealed), from, blockAt: sealed.blockAt })
  assert.equal(a.status, 'noPath')
  // POSITIVE CONTROL: the same search over the same pocket with a trench to the sky finds the walk and names its end
  const open = pocket({ door: true })
  const b = await S.skyWalkPlan({ search: realSearch, movements: walkMoves(open), from, blockAt: open.blockAt })
  assert.equal(b.status, 'success', JSON.stringify(b))
  assert.equal(S.roofClimbPlan(open.blockAt, V(b.to.x, b.to.y, b.to.z)), null, 'the cell it names has open sky over it')
  assert.deepEqual([b.to.y, b.to.z], [68, 6], JSON.stringify(b))
  assert.ok(b.to.x >= 4 && b.steps >= 3, JSON.stringify(b))
  // an open-topped corner of the SAME pocket counts as sky (the marooned reflex owns an open column; this is not a climb's roof)
  const corner = pocket({ sky: [[2, 7]] })
  const c = await S.skyWalkPlan({ search: realSearch, movements: walkMoves(corner), from, blockAt: corner.blockAt })
  assert.deepEqual(c.to, { x: 2, y: 68, z: 7 })
  // a search that did not finish is `partial`, never a yes or a no
  const d = await S.skyWalkPlan({ search: realSearch, movements: walkMoves(open), from, blockAt: open.blockAt, ms: 0 })
  assert.equal(d.status, 'partial')
  assert.equal((await S.skyWalkPlan({ search: null, movements: null, from, blockAt: open.blockAt })).status, 'partial', 'no search: not a no')
  assert.equal((await S.skyWalkPlan({ search: () => { throw new Error('x') }, movements: null, from, blockAt: open.blockAt })).status, 'partial')
})

test('THE POCKET: surface digs the one roof block, pillars three, and stands on the plaza (it answered "nothing to climb")', async () => {
  const w = pocket()
  const { bot, log } = simBot(w)
  const r = await surface(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(Math.floor(bot.entity.position.y), 71, 'on the plaza')
  assert.deepEqual(log.digs, ['cobblestone@1,70,5'], 'the roof over its own head and nothing else')
  assert.deepEqual(log.places, ['1,68,5', '1,69,5', '1,70,5'], 'its own column: the hole it came through is filled behind it')
  assert.equal(w.nameAt(1, 70, 5), 'dirt', 'the plaza floor is closed again')
  assert.equal(log.searches, 1, 'the walk to open sky was searched first')
  assert.match(r.detail, /climbed 3 blocks to y=71/)
})

test('a way out on foot is WALKED and nothing is dug or placed', async () => {
  const w = pocket({ door: true })
  const { bot, log } = simBot(w, { search: (m, from, goal, o) => realSearch(walkMoves(w), from, goal, o),
                                  walk: (b, g) => { b.entity.position = V(g.x + 0.5, g.y, g.z + 0.5); b.emit('goal_reached', g) } })
  const r = await surface(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(r.via, 'sky_walk')
  assert.deepEqual([log.digs, log.places], [[], []])
  assert.equal(S.roofClimbPlan(w.blockAt, bot.entity.position.floored()), null, 'it stands under open sky')
  assert.match(r.detail, /walked out from under the roof to open sky at \d+,68,6/)
})

test('a walk that was found and then failed leaves the climb, judged on the roof and not on the promise', async () => {
  const w = pocket({ door: true })
  // the walk "arrives" without the bot having moved: the library's own false done
  const lied = simBot(w, { search: (m, from, goal, o) => realSearch(walkMoves(w), from, goal, o), walk: (b, g) => b.emit('goal_reached', g) })
  const r = await surface(lied.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(r.via, undefined, 'not credited to the walk')
  assert.equal(Math.floor(lied.bot.entity.position.y), 71)
  assert.deepEqual(lied.log.digs, ['cobblestone@1,70,5'])
  // the walk ends noPath: the goal is cleared and the climb goes on
  const w2 = pocket({ door: true })
  const np = simBot(w2, { search: (m, from, goal, o) => realSearch(walkMoves(w2), from, goal, o), walk: (b) => b.emit('path_update', { status: 'noPath' }) })
  const r2 = await surface(np.bot)
  assert.equal(r2.status, 'success', r2.detail)
  assert.equal(Math.floor(np.bot.entity.position.y), 71)
  assert.equal(np.bot.pathfinder.goal, null, 'the failed walk was halted before the climb')
})

test('a BUILT roof is never dug: the old refusal, saying why', async () => {
  const w = pocket({ roof: 'spruce_planks' })
  const { bot, log } = simBot(w)
  const r = await surface(bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'already_surfaced')
  assert.match(r.detail, /^already at y=68, at or above sea level 63/)
  assert.match(r.detail, /built \(spruce_planks\)/)
  assert.deepEqual([log.digs, log.places, log.searches], [[], [], 0], 'nothing dug, nothing placed, nothing searched')
  assert.equal(Math.floor(bot.entity.position.y), 68)
})

test('open sky above sea level: the refusal and its words are exactly the old ones', async () => {
  const w = world({}, {})
  const { bot, log } = simBot(w, { at: [1.5, 71, 5.5] })
  const r = await surface(bot)
  assert.deepEqual([r.status, r.failClass, r.gap], ['failed', 'already_surfaced', 'at_y71'])
  assert.equal(r.detail, 'already at y=71, at or above sea level 63 — nothing to climb; use gather, explore or goto from here')
  assert.deepEqual([log.digs, log.places, log.searches], [[], [], 0])
})

test('ROOFCLIMB=off restores the old answer under the same roof', async () => {
  const { bot, log } = simBot(pocket())
  const was = process.env.ROOFCLIMB
  process.env.ROOFCLIMB = 'off'
  let r
  try { r = await surface(bot) } finally { if (was === undefined) delete process.env.ROOFCLIMB; else process.env.ROOFCLIMB = was }
  assert.deepEqual([r.status, r.failClass], ['failed', 'already_surfaced'])
  assert.equal(r.detail, 'already at y=68, at or above sea level 63 — nothing to climb; use gather, explore or goto from here')
  assert.deepEqual([log.digs, log.places, log.searches], [[], [], 0])
})

test("an internal caller's own top is untouched: no sky search, the climb it asked for", async () => {
  const w = pocket({ door: true })
  const { bot, log } = simBot(w)
  const r = await surface(bot, { _toY: 71 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(log.searches, 0, 'mine names its own top; nothing new is asked')
  assert.deepEqual(log.digs, ['cobblestone@1,70,5'])
})

test('below sea level nothing changed: the climb is to sea level and no sky is searched', async () => {
  // a sealed cell at y=60 under three blocks of stone and then open air from y=64
  const cells = {}
  for (let y = 60; y <= 61; y++) cells[`1,${y},5`] = 'air'
  for (let y = 62; y <= 63; y++) cells[`1,${y},5`] = 'stone'
  for (let y = 64; y <= 70; y++) for (let x = -3; x <= 5; x++) for (let z = 1; z <= 9; z++) cells[`${x},${y},${z}`] = 'air'
  const w = world(cells)
  const { bot, log } = simBot(w, { at: [1.5, 60, 5.5] })
  const r = await surface(bot)
  assert.equal(log.searches, 0)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(Math.floor(bot.entity.position.y), 63, 'sea level, as before')
})

test('with no blocks to pillar the climb says so and names the block to fetch (the remedy is the old one)', async () => {
  const { bot, log } = simBot(pocket(), { blocks: 0 })
  const r = await surface(bot)
  assert.notEqual(r.status, 'success')
  assert.match(r.detail, /no scaffold/)
  assert.match(r.detail, /gather 8\+ dirt or cobblestone/)
  assert.deepEqual(log.digs, ['cobblestone@1,70,5'])
})

test('MUTANTS: each guard is the thing that holds', async () => {
  // 1. the roof's top is not used -> the pocket answers "nothing to climb" again
  await withMutant(SKILLS_URL, "      if (top.why === 'roofed') TOP = top.top\n", '', async M => {
    const { bot, log } = simBot(pocket())
    const r = await surface(bot, {}, M)
    assert.equal(r.failClass, 'already_surfaced', 'MUTANT 1 SURVIVED')
    assert.deepEqual(log.digs, [])
  })
  // 2. built blocks count as ground -> a plank roof is dug
  await withMutant(SKILLS_URL, "    if (!ROOF_GROUND.test(name)) return { built: name, at: feet.y + dy }\n", '', async M => {
    const { bot, log } = simBot(pocket({ roof: 'spruce_planks' }))
    await surface(bot, {}, M)
    assert.deepEqual(log.digs, ['spruce_planks@1,70,5'], 'MUTANT 2 SURVIVED')
  })
  // 3. a found walk is ignored -> the roof is dug though a way out on foot exists
  await withMutant(SKILLS_URL, "      if (sky.status === 'success') {\n", "      if (sky.status === 'never') {\n", async M => {
    const w = pocket({ door: true })
    const { bot, log } = simBot(w, { search: (m, from, goal, o) => realSearch(walkMoves(w), from, goal, o), walk: (b, g) => { b.entity.position = V(g.x + 0.5, g.y, g.z + 0.5); b.emit('goal_reached', g) } })
    await surface(bot, {}, M)
    assert.deepEqual(log.digs, ['cobblestone@1,70,5'], 'MUTANT 3 SURVIVED')
  })
  // 4. the walk is judged on its promise -> a walk that lied is credited and the bot stays under the roof
  await withMutant(SKILLS_URL, "        if (!roof) return { status: 'success', via: 'sky_walk',", "        if (!werr) return { status: 'success', via: 'sky_walk',", async M => {
    const w = pocket({ door: true })
    const { bot } = simBot(w, { search: (m, from, goal, o) => realSearch(walkMoves(w), from, goal, o), walk: (b, g) => b.emit('goal_reached', g) })
    const r = await surface(bot, {}, M)
    assert.equal(r.via, 'sky_walk', 'MUTANT 4 SURVIVED')
    assert.equal(Math.floor(bot.entity.position.y), 68)
  })
  // 5. the switch is ignored -> ROOFCLIMB=off still climbs
  await withMutant(SKILLS_URL, "    const on = roofClimbOn(process.env)\n", "    const on = true\n", async M => {
    const { bot, log } = simBot(pocket())
    const was = process.env.ROOFCLIMB
    process.env.ROOFCLIMB = 'off'
    try { await surface(bot, {}, M) } finally { if (was === undefined) delete process.env.ROOFCLIMB; else process.env.ROOFCLIMB = was }
    assert.deepEqual(log.digs, ['cobblestone@1,70,5'], 'MUTANT 5 SURVIVED')
  })
  // 6. below sea level takes the roof's top (pure, and through the skill: both guards gone)
  await withMutant(SKILLS_URL, "  if (!(y >= SEA_LEVEL)) return { top: SEA_LEVEL, why: 'below_sea' }\n", '', async M => {
    assert.deepEqual(M.surfaceTop({ y: 40, roof: { toY: 71, top: 70, n: 1 } }), { top: 71, why: 'roofed' }, 'MUTANT 6 SURVIVED')
  })
  // 7. a tree counts as a roof (pure)
  await withMutant(SKILLS_URL, "    if (TREE_OVERHEAD.test(name)) continue\n    if (!ROOF_GROUND", "    if (!ROOF_GROUND", async M => {
    const at = p => (p.y === 72 ? { name: 'spruce_leaves', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
    assert.deepEqual(M.roofClimbPlan(at, V(1, 68, 5)), { built: 'spruce_leaves', at: 72 }, 'MUTANT 7 SURVIVED')
  })
})
