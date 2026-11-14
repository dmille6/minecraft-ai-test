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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-rc-logs-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-rc-pool-'))   // the town's build records: none until a test writes one

const require_ = createRequire(import.meta.url)
const S = await import('../src/skills.mjs')
const { projKey } = await import('../src/buildproj.mjs')
/** One build record with one cell, written as the projects write theirs; removed by the returned function. */
function record (plot, at, block = 'cobblestone') {
  const f = path.join(process.env.POOL_STATE_DIR, `${projKey({ x: 0, y: 70, z: 0 }, plot)}.g1.json`)
  fs.writeFileSync(f, JSON.stringify({ gen: 1, prev: null, cells: [{ at, block, role: 'base', state: 'placed' }] }))
  return () => { try { fs.unlinkSync(f) } catch {} }
}
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

const { pathfinder, Movements, goals } = require_('mineflayer-pathfinder')
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
/** THE INSTALLED PLUGIN, loaded on a bare bot over the world (review r1: the tests built their own A* and so skipped the plugin's
 *  start cell and its path post-processing). `search` is its getPathFromTo with the town walk's profile: no dig, nothing placed. */
function plugin (w, at = [1.5, 68, 5.5]) {
  const b = new EventEmitter()
  Object.assign(b, { registry, version: '1.21.8', blockAt: w.blockAt, entity: { position: V(at[0], at[1], at[2]), onGround: true, effects: {} }, entities: {},
                     inventory: { items: () => [] }, game: { minY: -64, height: 384 }, clearControlStates () {} })
  pathfinder(b)
  const m = new Movements(b)
  m.canDig = false; m.allowParkour = false; m.allowSprinting = false; m.allow1by1towers = false; m.maxDropDown = 6; m.allowEntityDetection = false
  m.scafoldingBlocks = []
  b.pathfinder.setMovements(m)
  return { bot: b, moves: m, search: (_m, from, goal, o) => b.pathfinder.getPathFromTo(m, from, goal, o) }
}
const lastOf = it => { let r = null; for (const v of it) r = v.result; return r }

/** A bot the REAL surface skill can drive: it digs (the cell becomes air), places (the cell becomes dirt and, mid-jump, the bot
 *  stands one higher), and walks only where `walk` says. Every dig and placement is recorded. */
function simBot (w, { at = [1.5, 68, 5.5], search = null, walk = null, blocks = 64, breakCosts = undefined, probe = 'noPath', onDig = null } = {}) {
  const bot = new EventEmitter()
  const log = { digs: [], places: [], searches: 0, goals: [], gotos: 0, ascents: 0, opts: [] }
  let jumping = false
  Object.assign(bot, {
    entity: { position: V(at[0], at[1], at[2]), onGround: true, effects: {} }, entities: {},
    health: 20, food: 20, registry, version: '1.21.8', game: { minY: -64, height: 384 },
    inventory: { items: () => (blocks > 0 ? [{ name: 'dirt', count: blocks, slot: 0, type: registry.itemsByName.dirt.id }] : []) },
    blockAt: w.blockAt,
    async equip () {}, async lookAt () {}, stopDigging () {}, clearControlStates () { jumping = false }, chat () {},
    setControlState (k, v) { if (k === 'jump') jumping = !!v },
    async dig (b) { log.digs.push(`${b.name}@${b.position.x},${b.position.y},${b.position.z}`); w.set(b.position.x, b.position.y, b.position.z, 'air'); onDig?.(b, w) },
    async placeBlock (ref, face) {
      const c = ref.position.plus(face)
      log.places.push(`${c.x},${c.y},${c.z}`); blocks--
      w.set(c.x, c.y, c.z, 'dirt')
      const p = bot.entity.position
      if (jumping && Math.floor(p.x) === c.x && Math.floor(p.z) === c.z && Math.floor(p.y) === c.y) bot.entity.position = V(p.x, p.y + 1, p.z)
    },
    ascentMovements: { kind: 'ascent', exclusionAreasBreak: breakCosts },
    pathfinder: {
      movements: { kind: 'travel' }, goal: null,
      setMovements (m) { this.movements = m },
      getPathTo: () => ({ status: probe, path: [] }),             // the climb's own stage probes (default: both finish and find nothing)
      getPathFromTo (...a) { log.searches++; log.opts.push(a[3] ?? null); return search ? search(...a) : (function * () { yield { result: { status: 'noPath', path: [] } } })() },
      setGoal (g) {
        this.goal = g; log.goals.push(g ? `${g.x},${g.y},${g.z}` : null)
        bot.emit('goal_updated', g, false)   // as the plugin's own setGoal does (index.js): a halt is heard through this
        if (g && walk) setTimeout(() => walk(bot, g), 5)
      },
      async goto () { log.gotos++ }, stop () {}, isMoving: () => false, isMining: () => false, isBuilding: () => false,
    },
    async withAscentMovements (fn) { log.ascents++; return fn() },
  })
  return { bot, log }
}
const surface = (bot, args = {}, mod = S) => mod.SKILLS.surface.run({ bot }, args, new AbortController().signal)

test('roofClimbPlan: ground over the bot is a roof to climb; open sky, a tree, and anything built are not', () => {
  const at = cells => p => { const n = cells[p.y]; return n ? { name: n, boundingBox: n === 'torch' ? 'empty' : 'block' } : { name: 'air', boundingBox: 'empty' } }
  const feet = V(1, 68, 5)
  assert.equal(S.roofClimbPlan(at({}), feet), null, 'open sky')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'cobblestone' }), feet), { toY: 71, top: 70, n: 1 }, 'the plaza floor over the pocket')
  // THE FIRST SLAB (review r1, Claude blocker 2): two open cells over ground end the roof; what hangs higher is not climbed to
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'dirt', 71: 'grass_block', 75: 'stone' }), feet), { toY: 72, top: 71, n: 2 }, 'the slab over the bot, not the block four above it')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'cobblestone', 78: 'cobblestone' }), feet), { toY: 71, top: 70, n: 1 }, 'one block eight above the plaza is not the roof')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'dirt', 72: 'stone' }), feet), { toY: 73, top: 72, n: 2 }, 'a one-high gap is no room to stand: the slab goes on')
  assert.deepEqual(S.roofClimbPlan(at({ 74: 'dirt' }), feet), { toY: 75, top: 74, n: 1 }, 'a roof high over a deep pocket is still its roof')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'dirt', 71: 'stone_bricks' }), feet), { built: 'stone_bricks', at: 71, why: 'will not break stone_bricks (built)' }, 'built ON the slab refuses')
  assert.equal(S.roofClimbPlan(at({ 72: 'spruce_leaves', 73: 'spruce_leaves' }), feet), null, 'leaves over the bot are not a roof')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'dirt', 71: 'spruce_log' }), feet), { built: 'spruce_log', at: 71, why: 'will not break spruce_log (built)' }, 'a trunk is never dug: the tree stays')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'dirt', 74: 'spruce_leaves' }), feet), { toY: 71, top: 70, n: 1 }, 'ground under leaves: the ground is the roof')
  assert.deepEqual(S.roofClimbPlan(at({ 72: 'spruce_planks' }), feet), { built: 'spruce_planks', at: 72, why: 'will not break spruce_planks (built)' }, 'a plank roof is built')
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'dirt', 73: 'stone_bricks' }), feet), { toY: 71, top: 70, n: 1 }, 'built over open air above the slab is not in the way: the climb ends under it, in the open')
  // ONE AUTHORITY (review r1): a ground kind in a cell the escape profile may not break is refused in the plan, by the same judge the swing asks
  const priced = b => (b.name === 'cobblestone' ? 100 : 0)
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'cobblestone' }), feet, { breakCosts: [priced] }), { built: 'cobblestone', at: 70, why: 'will not break cobblestone (protected)' })
  assert.deepEqual(S.roofClimbPlan(at({ 70: 'dirt' }), feet, { breakCosts: [priced] }), { toY: 71, top: 70, n: 1 }, 'an unpriced cell is still climbed')
  assert.equal(S.roofDigRefusal({ name: 'dirt' }, [() => { throw new Error('x') }]), 'will not break dirt (protection unread)', 'a price that cannot be read refuses')
  assert.equal(S.roofDigRefusal({ name: 'spruce_leaves' }, [() => 100]), null, 'leaves are passed')
  assert.equal(S.roofDigRefusal({ name: 'oak_planks' }), 'will not break oak_planks (built)')
  assert.doesNotMatch(S.roofDigRefusal({ name: 'oak_planks' }), /cannot break/, 'never the hardness refusal: that asks for a pickaxe')
  assert.equal(S.climbPrerequisite(S.roofDigRefusal({ name: 'oak_planks' })), null, 'no tool is asked for')
  assert.match(S.climbAdvice(S.roofDigRefusal({ name: 'oak_planks' })), /if you can step to a spot with only dirt or stone overhead/)
  assert.doesNotMatch(S.climbAdvice(S.roofDigRefusal({ name: 'oak_planks' })), /run surface again to keep climbing/)
  assert.equal(S.roofClimbPlan(at({ 70: 'torch' }), feet), null, 'a block with no body is not a roof')
  assert.equal(S.roofClimbPlan(at({ 69: 'dirt' }), feet), null, 'the head cell is not overhead (dy starts at 2, as terrainRoofTop)')
  assert.equal(S.roofClimbPlan(() => null, feet), null, 'unloaded reads as open')
  assert.equal(S.roofClimbPlan(at({ 110: 'stone' }), feet), null, 'beyond 40 up is not looked at')
  // THE BUILD RECORDS (review r1, Claude blocker 1): ground by name, a project's by record
  const P = { name: 'cobblestone', position: { x: 1, y: 70, z: 5 } }
  assert.equal(S.roofDigRefusal(P, [], () => 'monument'), "will not break cobblestone (the monument's)")
  assert.equal(S.roofDigRefusal(P, [], () => false), null, 'no record: plain ground')
  assert.equal(S.roofDigRefusal(P, [], () => 'paths'), null, 'paving passes: the plaza floor is the measured roof')
  assert.equal(S.roofDigRefusal(P, [], () => 'tidy'), null)
  assert.equal(S.roofDigRefusal(P, [], () => null), 'will not break cobblestone (the build records are unread)', 'unread refuses')
  assert.equal(S.roofDigRefusal(P, [], () => { throw new Error('x') }), 'will not break cobblestone (the build records are unread)')
  assert.equal(S.roofDigRefusal({ name: 'spruce_leaves', position: P.position }, [], () => 'monument'), null, 'leaves are never a record to keep')
  for (const n of ['glass', 'oak_slab', 'cobblestone_stairs', 'bricks', 'chest', 'crafting_table', 'white_wool', 'oxidized_cut_copper']) assert.equal(S.ROOF_GROUND.test(n), false, `${n} is built`)
  for (const n of ['dirt', 'grass_block', 'cobblestone', 'stone', 'dirt_path', 'gravel', 'sand', 'iron_ore', 'deepslate_coal_ore']) assert.equal(S.ROOF_GROUND.test(n), true, `${n} is ground`)
})

test('surfaceTop: the old tops are unchanged; only a ground roof above sea level names a new one', () => {
  const roof = { toY: 71, top: 70, n: 1 }
  assert.deepEqual(S.surfaceTop({ y: 68, roof }), { top: 71, why: 'roofed' })
  assert.deepEqual(S.surfaceTop({ y: 68, roof: null }), { top: 63, why: 'open' }, 'open sky: already surfaced, as before')
  assert.deepEqual(S.surfaceTop({ y: 68, roof: { built: 'spruce_planks', at: 72, why: 'will not break spruce_planks (built)' } }), { top: 63, why: 'built' }, 'a house roof is never a top')
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

test("the walk to open sky, searched by the INSTALLED plugin's own getPathFromTo: a sealed pocket has none, a way out is found and named by its CELL", async () => {
  const from = V(1.5, 68, 5.5)
  const sky = (w, o = {}) => { const pl = plugin(w); return S.skyWalkPlan({ search: pl.search, movements: pl.moves, from, blockAt: w.blockAt, ...o }) }
  // sealed: nine cells of floor under a roof, every search finishes with nothing
  assert.equal((await sky(pocket())).status, 'noPath')
  // POSITIVE CONTROL: the same search over the same pocket with a trench to the sky finds the walk and names its end
  const open = pocket({ door: true })
  const b = await sky(open)
  assert.equal(b.status, 'success', JSON.stringify(b))
  assert.equal(S.roofClimbPlan(open.blockAt, V(b.to.x, b.to.y, b.to.z)), null, 'the cell it names has open sky over it')
  assert.deepEqual([b.to.y, b.to.z], [68, 6], JSON.stringify(b))
  assert.ok(b.to.x >= 4 && b.steps >= 3, JSON.stringify(b))
  // THE END IS A CELL, NOT A STANDING POSITION (review r1, Codex blocker 2): the trench's floor is dirt_path (15/16 high), the
  // plugin's post-processed waypoint there is y 67.9375, and a floored 67 is a cell no walk reaches
  const path = pocket({ door: true })
  for (let x = 3; x <= 6; x++) path.set(x, 67, 6, 'dirt_path')
  const c = await sky(path)
  assert.equal(c.status, 'success', JSON.stringify(c))
  assert.equal(c.to.y, 68, `the logical cell over the path block, got ${JSON.stringify(c.to)}`)
  const pl = plugin(path)
  assert.equal(lastOf(pl.search(null, from, new goals.GoalBlock(c.to.x, c.to.y, c.to.z), { timeout: 800 })).status, 'success', 'and the walk asked for next finds it')
  // POSITIVE CONTROL of the hazard: with the plugin's default post-processing the same end reads below the cell
  const raw = lastOf(pl.search(null, from, new S.GoalOpenSky(path.blockAt), { timeout: 800 }))
  assert.ok(raw.path[raw.path.length - 1].y < 68, 'the post-processed waypoint is under the cell: the thing the option avoids')
  // an open-topped corner of the SAME pocket counts as sky (the marooned reflex owns an open column; this is not a climb's roof)
  assert.deepEqual((await sky(pocket({ sky: [[2, 7]] }))).to, { x: 2, y: 68, z: 7 })
  // a search that did not finish is `partial`, never a yes or a no
  assert.equal((await sky(open, { ms: 0 })).status, 'partial')
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
  assert.equal(log.opts[0]?.optimizePath, false, 'for its cells, not its waypoints')
  assert.match(r.detail, /climbed 3 blocks to y=71, out from under the roof/)
  assert.deepEqual([log.gotos, log.ascents], [0, 0], 'no pathfinder stage ran')
})

test('THE WALL BESIDE IT (review r1, Codex blocker 1): a roofed climb never takes a pathfinder route, though one is offered', async () => {
  // plank walls all round the pocket and an ascent probe that answers yes (Codex found such a route: it broke oak planks at the
  // next cell). The climb is the shaft up its own column; the planks stand.
  const w = pocket()
  for (const [x, z] of [[-1, 5], [3, 5], [1, 4], [1, 8], [-1, 6], [3, 6]]) for (const y of [68, 69]) w.set(x, y, z, 'oak_planks')
  const { bot, log } = simBot(w, { probe: 'success' })
  const r = await surface(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual([log.gotos, log.ascents], [0, 0], 'the ascent profile was never borrowed and no goto was issued')
  assert.deepEqual(log.digs, ['cobblestone@1,70,5'])
  assert.ok(log.places.every(c => c.startsWith('1,') && c.endsWith(',5')), `every placement in its own column: ${log.places}`)
  // POSITIVE CONTROL: the same bot BELOW sea level does take the pathfinder stage that probe offers (the old climb, unchanged)
  const cells = {}
  for (let y = 60; y <= 61; y++) cells[`1,${y},5`] = 'air'
  const deep = simBot(world(cells), { at: [1.5, 60, 5.5], probe: 'success' })
  await surface(deep.bot)
  assert.ok(deep.log.gotos >= 1, 'below sea level the stage loop still walks')
})

test('a cell the ESCAPE profile may not break is never dug: refused in the plan, with words that ask for no tool', async () => {
  const { bot, log } = simBot(pocket(), { breakCosts: [b => (b.position.y === 70 ? 100 : 0)] })
  const r = await surface(bot)
  assert.deepEqual([r.status, r.failClass], ['failed', 'already_surfaced'])
  assert.match(r.detail, /built or protected \(cobblestone, protected\)/)
  assert.match(r.detail, /if you can step to a spot with only dirt or stone overhead/)
  assert.deepEqual([log.digs, log.places, log.searches], [[], [], 0])
})

test("a project's BUILD RECORD is never dug, though its blocks are ground by name; paving passes (review r1, Claude blocker 1)", async () => {
  // POSITIVE CONTROL first: with no record the same pocket is climbed (THE POCKET above); with a paths record on the roof cell too
  let undo = record('paths', [1, 70, 5])
  try {
    const a = simBot(pocket())
    const r = await surface(a.bot)
    assert.equal(r.status, 'success', r.detail)
    assert.deepEqual(a.log.digs, ['cobblestone@1,70,5'])
  } finally { undo() }
  // the monument's cell over the pocket: refused in the plan, nothing dug
  undo = record('monument', [1, 70, 5])
  try {
    await new Promise(r => setTimeout(r, 30))
    const b = simBot(pocket())
    // the reader caches for 10 s: ask as the planner would after it (the dig asks fresh)
    S.escapeRecordSnapshot(b.bot, Date.now(), { fresh: true })
    const r = await surface(b.bot)
    assert.deepEqual([r.status, r.failClass], ['failed', 'already_surfaced'], r.detail)
    assert.match(r.detail, /built or protected \(cobblestone, the monument's\)/)
    assert.deepEqual([b.log.digs, b.log.places], [[], []])
  } finally { undo() }
  // a record that appears AFTER the plan is met at the swing (the swing reads fresh)
  const c = simBot(pocket())
  S.escapeRecordSnapshot(c.bot, Date.now(), { fresh: true })
  const late = await S.shaftAscend(c.bot, 71, new AbortController().signal, { mayDig: b => { const u = record('monument', [1, 70, 5]); try { return S.roofDigRefusal(b, [], q => S.escapeRecordAt(c.bot, q, Date.now(), { fresh: true })) } finally { u() } } })
  assert.deepEqual([late.stopped, c.log.digs], ["will not break cobblestone (the monument's)", []])
  S.escapeRecordSnapshot(c.bot, Date.now(), { fresh: true })
})

test('AN OVERHANG HIGH ABOVE IS NOT THE ROOF (review r1, Claude blocker 2): the climb ends on the plaza, not eight blocks up a pillar', async () => {
  const w = pocket()
  w.set(1, 78, 5, 'cobblestone')
  const { bot, log } = simBot(w)
  const r = await surface(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(Math.floor(bot.entity.position.y), 71, 'on the plaza')
  assert.deepEqual(log.digs, ['cobblestone@1,70,5'], 'the block eight above was never swung at')
  assert.deepEqual(log.places, ['1,68,5', '1,69,5', '1,70,5'], 'nothing placed above the ground')
  assert.equal(w.nameAt(1, 78, 5), 'cobblestone')
})

test('part of the way is said as part of the way', async () => {
  // two blocks to pillar with, three needed: one above the pocket floor... the climb stops short and says so
  const { bot, log } = simBot(pocket(), { blocks: 2 })
  const r = await surface(bot)
  assert.deepEqual([r.status, r.failClass], ['failed', 'travel_incomplete'], r.detail)
  assert.match(r.detail, /climbed 2 blocks to y=70, not yet out from under the roof/)
  assert.match(r.detail, /no scaffold/)
  assert.match(r.detail, /gather 8\+ dirt or cobblestone/)
  assert.doesNotMatch(r.detail, /no altitude gained|below sea level/)
  assert.equal(log.places.length, 2)
})

test('the column is judged again at every swing: something built that appears over it mid-climb is left standing', async () => {
  // after the roof block is dug, planks are laid over the column (another bot roofing): the next swing meets them
  const { bot, log } = simBot(pocket(), { onDig: (b, w) => { if (b.position.y === 70) w.set(1, 71, 5, 'oak_planks') } })
  const r = await surface(bot)
  assert.notEqual(r.status, 'success', r.detail)
  assert.deepEqual(log.digs, ['cobblestone@1,70,5'], 'the planks were never swung at')
  assert.match(r.detail, /will not break oak_planks \(built\)/)
  assert.match(r.detail, /if you can step to a spot with only dirt or stone overhead/)
  assert.doesNotMatch(r.detail, /needs a pickaxe|run surface again to keep climbing/)
  assert.equal(r.need ?? null, null)
})

test('shaftAscend asks its caller\'s judge before the swing, and asks nothing when none is given (every caller before this)', async () => {
  const a = simBot(pocket())
  const no = await S.shaftAscend(a.bot, 71, new AbortController().signal, { mayDig: b => `will not break ${b.name} (built)` })
  assert.deepEqual([no.gained, no.stopped, a.log.digs], [0, 'will not break cobblestone (built)', []])
  const b = simBot(pocket())
  const yes = await S.shaftAscend(b.bot, 71, new AbortController().signal)
  assert.equal(yes.gained, 3); assert.deepEqual(b.log.digs, ['cobblestone@1,70,5'])
})

test('AN INTERRUPT ENDS THE WALK AT ONCE (review r1, Codex blocker 3): the goal is cleared, the listeners are gone, the abort is the abort', async () => {
  const w = pocket({ door: true })
  const { bot, log } = simBot(w, { search: plugin(w).search, walk: () => {} })   // a walk that never ends
  const ac = new AbortController()
  const t0 = Date.now()
  const run = S.SKILLS.surface.run({ bot }, {}, ac.signal)
  setTimeout(() => ac.abort(), 150)
  const err = await run.then(() => null, e => e)
  assert.ok(err, 'the skill rejected')
  assert.equal(err.aborted, true, `as the abort, not as a failed walk: ${err?.message}`)
  assert.ok(Date.now() - t0 < 2000, `settled ${Date.now() - t0} ms after the start, not at the walk's 20 s`)
  assert.equal(bot.pathfinder.goal, null, 'its goal was halted')
  assert.deepEqual(['goal_reached', 'path_update', 'goal_updated', 'path_stop'].map(e => bot.listenerCount(e)), [0, 0, 0, 0])
  assert.deepEqual([log.digs, log.places], [[], []], 'and nothing was dug after it')
})

test('a way out on foot is WALKED and nothing is dug or placed', async () => {
  const w = pocket({ door: true })
  const { bot, log } = simBot(w, { search: plugin(w).search,
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
  const lied = simBot(w, { search: plugin(w).search, walk: (b, g) => b.emit('goal_reached', g) })
  const r = await surface(lied.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(r.via, undefined, 'not credited to the walk')
  assert.equal(Math.floor(lied.bot.entity.position.y), 71)
  assert.deepEqual(lied.log.digs, ['cobblestone@1,70,5'])
  // the walk ends noPath: the goal is cleared and the climb goes on
  const w2 = pocket({ door: true })
  const np = simBot(w2, { search: plugin(w2).search, walk: (b) => b.emit('path_update', { status: 'noPath' }) })
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
  assert.match(r.detail, /built or protected \(spruce_planks\)/)
  assert.doesNotMatch(r.detail, /nothing to climb/)
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
  await withMutant(SKILLS_URL, "  if (!ROOF_GROUND.test(name)) return `will not break ${name || 'an unread block'} (built)`\n", '', async M => {
    const { bot, log } = simBot(pocket({ roof: 'spruce_planks' }))
    await surface(bot, {}, M)
    assert.deepEqual(log.digs, ['spruce_planks@1,70,5'], 'MUTANT 2 SURVIVED')
  })
  // 3. a found walk is ignored -> the roof is dug though a way out on foot exists
  await withMutant(SKILLS_URL, "      if (sky.status === 'success') {\n", "      if (sky.status === 'never') {\n", async M => {
    const w = pocket({ door: true })
    const { bot, log } = simBot(w, { search: plugin(w).search, walk: (b, g) => { b.entity.position = V(g.x + 0.5, g.y, g.z + 0.5); b.emit('goal_reached', g) } })
    await surface(bot, {}, M)
    assert.deepEqual(log.digs, ['cobblestone@1,70,5'], 'MUTANT 3 SURVIVED')
  })
  // 4. the walk is judged on its promise -> a walk that lied is credited and the bot stays under the roof
  await withMutant(SKILLS_URL, "        if (!roof) return { status: 'success', via: 'sky_walk',", "        if (!werr) return { status: 'success', via: 'sky_walk',", async M => {
    const w = pocket({ door: true })
    const { bot } = simBot(w, { search: plugin(w).search, walk: (b, g) => b.emit('goal_reached', g) })
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
  // 6. below sea level takes the roof's top (pure)
  await withMutant(SKILLS_URL, "  if (!(y >= SEA_LEVEL)) return { top: SEA_LEVEL, why: 'below_sea' }\n", '', async M => {
    assert.deepEqual(M.surfaceTop({ y: 40, roof: { toY: 71, top: 70, n: 1 } }), { top: 71, why: 'roofed' }, 'MUTANT 6 SURVIVED')
  })
  // 7. leaves count as a roof (pure): a bot standing under a tree is sent up through its canopy
  await withMutant(SKILLS_URL, "    if (!b || b.boundingBox !== 'block' || /_leaves$/.test(name)) {", "    if (!b || b.boundingBox !== 'block') {", async M => {
    const at = p => (p.y === 72 ? { name: 'spruce_leaves', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
    assert.deepEqual(M.roofClimbPlan(at, V(1, 68, 5)), { toY: 73, top: 72, n: 1 }, 'MUTANT 7 SURVIVED')
  })
  // 8. the escape profile's prices are not asked -> a protected cell is dug
  await withMutant(SKILLS_URL, "    try { if (fn(block) > 0) return `will not break ${name} (protected)` } catch { return `will not break ${name} (protection unread)` }\n", '', async M => {
    const { bot, log } = simBot(pocket(), { breakCosts: [b => (b.position.y === 70 ? 100 : 0)] })
    await surface(bot, {}, M)
    assert.deepEqual(log.digs, ['cobblestone@1,70,5'], 'MUTANT 8 SURVIVED')
  })
  // 9. the swing is not judged -> planks laid over the column mid-climb are dug
  await withMutant(SKILLS_URL, "      if (mayDig) { const no = mayDig(head); if (no) return { gained: p.y - startY, stopped: no } }\n", '', async M => {
    const { bot, log } = simBot(pocket(), { onDig: (b, w) => { if (b.position.y === 70) w.set(1, 71, 5, 'oak_planks') } })
    await surface(bot, {}, M)
    assert.ok(log.digs.includes('oak_planks@1,71,5'), `MUTANT 9 SURVIVED: ${log.digs}`)
  })
  // 10. the search keeps the plugin's post-processing -> the end over a dirt path is the cell below it
  await withMutant(SKILLS_URL, "{ timeout: ms, tickTimeout: 40, optimizePath: false }", "{ timeout: ms, tickTimeout: 40 }", async M => {
    const path = pocket({ door: true })
    for (let x = 3; x <= 6; x++) path.set(x, 67, 6, 'dirt_path')
    const pl = plugin(path)
    const c = await M.skyWalkPlan({ search: pl.search, movements: pl.moves, from: V(1.5, 68, 5.5), blockAt: path.blockAt })
    assert.equal(c.to?.y, 67, `MUTANT 10 SURVIVED: ${JSON.stringify(c)}`)
  })
  // 12. the first-slab stop is gone -> the pillar goes up to the overhang (eight above the plaza)
  await withMutant(SKILLS_URL, "      if (top != null && ++gap >= 2) break\n", '', async M => {
    const w = pocket(); w.set(1, 78, 5, 'cobblestone')
    const { bot } = simBot(w)
    await surface(bot, {}, M)
    assert.equal(Math.floor(bot.entity.position.y), 79, 'MUTANT 12 SURVIVED')
  })
  // 13. the build records are not asked -> the monument's cell is dug
  await withMutant(SKILLS_URL, "    if (rec !== false && !ROOF_RECORD_PASS.has(String(rec))) return `will not break ${name} (the ${rec}'s)`\n", '', async M => {
    assert.equal(M.roofDigRefusal({ name: 'cobblestone', position: { x: 1, y: 70, z: 5 } }, [], () => 'monument'), null, 'MUTANT 13 SURVIVED')
  })
  // 11. no abort listener -> an interrupted walk goes on (it would end at the walk's own 20 s; here: still pending after 600 ms)
  await withMutant(SKILLS_URL, "        signal?.addEventListener?.('abort', onAbort, { once: true })\n        try { await withTimeout(walkToGoal(bot, skyGoal,", "        try { await withTimeout(walkToGoal(bot, skyGoal,", async M => {
    const w = pocket({ door: true })
    const { bot } = simBot(w, { search: plugin(w).search, walk: () => {} })
    const ac = new AbortController()
    const run = M.SKILLS.surface.run({ bot }, {}, ac.signal).then(() => 'done', () => 'rejected')
    setTimeout(() => ac.abort(), 100)
    const first = await Promise.race([run, new Promise(r => setTimeout(() => r('pending'), 600))])
    assert.equal(first, 'pending', 'MUTANT 11 SURVIVED')
    bot.pathfinder.setGoal(null)   // let the walk go so the file can end
    await run
  })
})
