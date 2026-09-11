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
/** A world from a scene; every cell outside the box is UNLOADED (null), never guessed. */
export function sceneWorld (scene, overrides = new Map()) {
  return mkWorld((x, y, z) => overrides.get(`${x},${y},${z}`) ?? scene.cells.get(`${x},${y},${z}`) ?? undefined)
}
export function profiles (bot) {
  const travel = fleetMovements(bot); installShoreEgress(travel)
  const escape = Object.assign(Object.create(Object.getPrototypeOf(travel)), travel)
  escape.canDig = true; escape.dontCreateFlow = true; escape.allow1by1towers = true; escape.maxDropDown = 6
  return { travel, escape }
}
export function plan (m, from, goal, { timeout = 3000, radius = -1 } = {}) {
  const start = { x: from.x, y: from.y, z: from.z, remainingBlocks: m.countScaffoldingItems() }
  const a = new AStar(start, m, goal, timeout, 40, radius)
  let r = a.compute(); while (r.status === 'partial') r = a.compute()
  return r
}
const moves = (m, from) => m.getNeighbors({ x: from.x, y: from.y, z: from.z, remainingBlocks: m.countScaffoldingItems() })
const botAt = (world, x, y, z, inv = []) => {
  const b = mkBot(world, new Vec3(x, y, z)); b.inventory = { items: () => inv }; b.entity.effects = {}; b.pathfinder = { bestHarvestTool: () => null }
  return b
}

// ------------------------------------------------ hive-b-Delta's water pocket ---
{
  const scene = loadScene('hive-b-delta-pocket')
  const world = sceneWorld(scene)
  const from = { x: 406, y: 62, z: 235 }
  const bot = botAt(world, 406.3, 62.2, 235.3, [{ name: 'sand', type: 1, count: 4 }])
  const { travel, escape } = profiles(bot)
  const shore = new goals.GoalNear(403, 63, 235, 0)
  t('Delta pocket: the travel profile offers one move (into water) and no route to shore', () => {
    const mv = moves(travel, from)
    assert.equal(mv.length, 1, `offered ${mv.map(m => `${m.x},${m.y},${m.z}`).join(' ')}`)
    assert.equal(plan(travel, from, shore).status, 'noPath')
  })
  t('Delta pocket: the escape profile breaks the lid and reaches the shore in three steps', () => {
    const r = plan(escape, from, shore)
    assert.equal(r.status, 'success', r.status)
    assert.ok(r.path.length <= 4, `${r.path.length} steps`)
    assert.ok(r.path[0].toBreak.some(b => b.x === 406 && b.y === 64 && b.z === 235), 'the first move breaks the lid at 406,64,235')
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
  const from = { x: 350, y: 91, z: 163 }
  const bot = botAt(world, 350.5, 91, 163.56, [])
  const { travel, escape } = profiles(bot)
  t('Bravo bridge: nothing to place, no legal move on foot or with digging', () => {
    assert.equal(moves(travel, from).length, 0, 'travel offers a move')
    assert.equal(moves(escape, from).length, 0, 'escape offers a move')
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

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
