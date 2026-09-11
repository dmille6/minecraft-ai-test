// SCENES ARE REAL. test/fixtures/scenes/*.json are boxes of blocks read off the
// live servers over RCON (scripts/capture-scene.py: `execute if block`, read-only,
// zero unknown cells or the capture says so), with the bot's exact position.
//
// Each scene replays against the REAL Movements and AStar with the deployed
// wrappers installed (shore egress), and asserts what the planner offers from
// where the bot actually stood. This is the planner-level half of the regression
// harness both reviews ranked first: a stuck bot becomes a fixture, and the fix
// that frees it becomes an assertion that cannot silently stop being true.
import assert from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { Vec3 } from 'vec3'
import { createRequire } from 'node:module'
import { mkWorld, mkBot, fleetMovements } from './helpers/reachlab.mjs'
import { installShoreEgress } from '../src/watermoves.mjs'
import { extendScaffolding } from '../src/scaffold.mjs'
import mcDataLoader from 'minecraft-data'
const registry = mcDataLoader('1.21.8')
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const require_ = createRequire(import.meta.url)
const AStar = require_('mineflayer-pathfinder/lib/astar')
const goals = require_('mineflayer-pathfinder').goals

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

export function loadScene (name) {
  const s = JSON.parse(readFileSync(new URL(`./fixtures/scenes/${name}.json`, import.meta.url), 'utf8'))
  assert.equal(s.unknown_cells, 0, `${name}: ${s.unknown_cells} unknown cells — a scene that guesses is not a scene`)
  const cells = new Map(Object.entries(s.cells))
  return { ...s, cells }
}
/**
 * A world from a scene. Every cell outside the box is UNLOADED (null), never
 * guessed -- and every read of one is COUNTED, because the pathfinder is not
 * uniformly conservative about unknown cells (safeToBreak reads them as no
 * water / no falling block; getMoveUp can climb into one). A verdict that read
 * a boundary cell is inconclusive, not a finding. (Codex review.)
 */
export function sceneWorld (scene, overrides = new Map()) {
  const w = mkWorld((x, y, z) => overrides.get(`${x},${y},${z}`) ?? scene.cells.get(`${x},${y},${z}`) ?? undefined)
  const inner = w.getBlock; w.boundaryReads = 0
  w.getBlock = p => { const b = inner(p); if (b === null) w.boundaryReads++; return b }
  return w
}
/** The production shape of the two profiles, as index.mjs builds them: scaffold list extended, shore egress installed. */
export function profiles (bot) {
  const travel = fleetMovements(bot); extendScaffolding(travel, registry); installShoreEgress(travel)
  const escape = Object.assign(Object.create(Object.getPrototypeOf(travel)), travel)
  escape.canDig = true; escape.dontCreateFlow = true; escape.allow1by1towers = true; escape.maxDropDown = 6
  return { travel, escape }
}
/**
 * The start node the live pathfinder would use (mineflayer-pathfinder index.js:80):
 * the floored position, raised one cell when the bot is grounded with a fractional
 * y on a block that is not empty -- a slab, a path, a snow layer.
 */
export function startNode (world, m, pos, onGround) {
  const p = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))
  const dy = pos.y - p.y; const b = world.getBlock(p)
  const offset = (b && dy > 0.001 && onGround && !m.emptyBlocks.has(b.type)) ? 1 : 0
  return { x: p.x, y: p.y + offset, z: p.z, remainingBlocks: m.countScaffoldingItems() }
}
export function plan (m, start, goal, { timeout = 3000, radius = -1 } = {}) {
  const a = new AStar({ ...start, remainingBlocks: start.remainingBlocks ?? m.countScaffoldingItems() }, m, goal, timeout, 40, radius)
  let r = a.compute(); while (r.status === 'partial') r = a.compute()
  return r
}
/**
 * A PLAN IS NOT AN EXECUTABLE PLAN. mineflayer-pathfinder's executor starts a
 * dig only when `bot.entity.onGround` (index.js: `if (!digging &&
 * bot.entity.onGround)`), which the planner does not model. hive-b-Delta,
 * 2026-09-11: this file said "three steps, break the lid" and the live bot sat
 * for four 25 s retries doing nothing. So every plan the harness blesses is
 * also asked whether its first move can be executed from the recorded stance.
 */
export function executable (path, recorded) {
  const first = Array.isArray(path) ? path[0] : null
  if (first && Array.isArray(first.toBreak) && first.toBreak.length > 0 && recorded && recorded.onGround === false) {
    return { ok: false, why: 'the first move digs, and the pathfinder will not start a dig while the bot is off the ground (afloat here)' }
  }
  return { ok: true, why: '' }
}
/** Items the recorded bot held, as the inventory shape countScaffoldingItems reads. */
const heldItems = scene => Object.entries(scene.bot?.inventory ?? {}).map(([name, count]) => ({ name, type: registry.itemsByName[name]?.id ?? -1, count }))
const moves = (m, from) => m.getNeighbors({ ...from, remainingBlocks: from.remainingBlocks ?? m.countScaffoldingItems() })
const botAt = (world, x, y, z, inv = []) => {
  const b = mkBot(world, new Vec3(x, y, z)); b.inventory = { items: () => inv }; b.entity.effects = {}; b.pathfinder = { bestHarvestTool: () => null }
  return b
}

// ------------------------------------------------ hive-b-Delta's water pocket ---
{
  const scene = loadScene('hive-b-delta-pocket')
  const world = sceneWorld(scene)
  const recorded = { pos: new Vec3(406.3, 62.2, 235.3), onGround: false, inv: [{ name: 'sand', type: registry.itemsByName.sand.id, count: 4 }] }
  const bot = botAt(world, recorded.pos.x, recorded.pos.y, recorded.pos.z, recorded.inv)
  const { travel, escape } = profiles(bot)
  const from = startNode(world, travel, recorded.pos, recorded.onGround)
  const shore = new goals.GoalNear(403, 63, 235, 0)
  t('Delta pocket: the start node is the floored cell (afloat, so no half-block offset), and sand counts for nothing', () => {
    assert.deepEqual([from.x, from.y, from.z], [406, 62, 235]); assert.equal(from.remainingBlocks, 0, 'sand is not on the scaffold list, by design')
  })
  t('Delta pocket: the travel profile offers one move (into water) and no route to shore -- with no boundary cell read', () => {
    const mv = moves(travel, from)
    assert.equal(mv.length, 1, `offered ${mv.map(m => `${m.x},${m.y},${m.z}`).join(' ')}`)
    world.boundaryReads = 0
    assert.equal(plan(travel, from, shore).status, 'noPath')
    assert.equal(world.boundaryReads, 0, `${world.boundaryReads} unloaded cells were read: this noPath would be INCONCLUSIVE`)
  })
  t('Delta pocket: the escape profile breaks the lid and reaches the shore in three steps', () => {
    const r = plan(escape, from, shore)
    assert.equal(r.status, 'success', r.status)
    assert.ok(r.path.length <= 4, `${r.path.length} steps`)
    assert.ok(r.path[0].toBreak.some(b => b.x === 406 && b.y === 64 && b.z === 235), 'the first move breaks the lid at 406,64,235')
  })
  t('Delta pocket: that plan is NOT executable from the recorded stance -- afloat, the executor never starts the lid dig (the live result)', () => {
    const r = plan(escape, from, shore)
    const x = executable(r.path, recorded)
    assert.equal(x.ok, false, 'a floating start must fail the executor check')
    assert.match(x.why, /off the ground/)
    // positive control: the same plan from a grounded stance is executable, and a
    // plan whose first move does not dig is executable afloat.
    assert.equal(executable(r.path, { ...recorded, onGround: true }).ok, true)
    assert.equal(executable([{ toBreak: [] }, ...r.path], recorded).ok, true)
  })
  t('Delta pocket: without the shore-egress wrapper the escape profile is blind too (the wrapper is load-bearing)', () => {
    const bare = fleetMovements(bot); bare.canDig = true; bare.dontCreateFlow = true; bare.allow1by1towers = true
    assert.equal(plan(bare, from, shore).status, 'noPath')
  })
}

// ---------------------------------------------- placebo-c-Bravo's bridge end ---
{
  const scene = loadScene('placebo-c-bravo-bridge')
  const world = sceneWorld(scene)
  const bot = botAt(world, 350.5, 91, 163.56, [])
  const { travel, escape } = profiles(bot)
  const from = startNode(world, travel, new Vec3(350.5, 91, 163.56), true)
  t('Bravo bridge: nothing to place, no legal move on foot or with digging, no boundary cell read', () => {
    assert.deepEqual([from.x, from.y, from.z], [350, 91, 163])
    world.boundaryReads = 0
    assert.equal(moves(travel, from).length, 0, 'travel offers a move')
    assert.equal(moves(escape, from).length, 0, 'escape offers a move')
    assert.equal(world.boundaryReads, 0, `${world.boundaryReads} unloaded cells read`)
  })
  t('Bravo bridge: the bridge behind it is real inside the captured box — solid at y=90, x=349, z=156..161, and the two cells to the furnace are air', () => {
    const solid = []
    for (let z = 156; z <= 163; z++) { const n = scene.cells.get(`349,90,${z}`); if (n && n !== 'air') solid.push(z) }
    assert.deepEqual(solid, [156, 157, 158, 159, 160, 161], `bridge cells at z=${solid.join(',')}`)
    assert.equal(scene.cells.get('349,90,162'), 'air'); assert.equal(scene.cells.get('349,90,163'), 'air')
  })
  t('Bravo bridge: TWO treads (the table and the glass it carries) beside the furnace give the travel profile a route back along the bridge', () => {
    // The rescue-furniture change lets the escape place a table/glass as a tread;
    // one is not enough here -- the gap to the bridge end is two cells.
    const one = new Map([['349,90,163', 'crafting_table']])
    assert.equal(plan(profiles(botAt(sceneWorld(scene, one), 350.5, 91, 163.56, [])).travel, from, new goals.GoalNear(349, 91, 157, 1)).status, 'noPath', 'one tread must not be enough (the gap is two cells)')
    const two = new Map([['349,90,163', 'crafting_table'], ['349,90,162', 'glass']])
    const r = plan(profiles(botAt(sceneWorld(scene, two), 350.5, 91, 163.56, [])).travel, from, new goals.GoalNear(349, 91, 157, 1))
    assert.equal(r.status, 'success', `with two treads: ${r.status}`)
  })
}

// ------------------------------------------ board-d-Delta's entombment (solved) ---
{
  const scene = loadScene('board-d-delta-entombed')
  t('board-d entombment: the bot pillared out on its own sand -- the column is sand y=14..20 on cobblestone, dirt above', () => {
    for (let y = 14; y <= 20; y++) assert.equal(scene.cells.get(`590,${y},175`), 'sand', `y=${y}`)
    assert.equal(scene.cells.get('590,13,175'), 'cobblestone'); assert.equal(scene.cells.get('590,21,175'), 'dirt')
    assert.ok(scene.bot.pos.includes('37.0d') || /3[0-9]\.\d+d/.test(scene.bot.pos), `the bot had climbed to the 30s at capture: ${scene.bot.pos}`)
  })
}

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
