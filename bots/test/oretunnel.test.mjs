// THE ORE TUNNEL: the safety masks, the pickaxe budget, and the REAL pathfinder on a fake world.
// The configuration under test was probed by the design review (see src/oretunnel.mjs); these tests pin it.
import assert from 'node:assert/strict'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-oretunnel'; process.env.BOT_NAME = process.env.BOT_NAME || 'TestBot'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const registry = require('prismarine-registry')('1.21.8')
const Block = require('prismarine-block')(registry)
const { pathfinder, goals } = require('mineflayer-pathfinder')
const { breakHazard, stepHazard, pickBudget, hasTripPickaxe, rankCandidates, clusterOf, tunnelMovements, planTunnel, nearHome,
        MIN_TRIP_USES, RETURN_RESERVE, IRON_KINDS } = await import('../src/oretunnel.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// ---- a fake world: flat stone below y=64, air above; overrides by coordinate; "unloaded" beyond |x|,|z| > 60 ----
function world (overrides = {}) {
  const at = (x, y, z) => overrides[`${x},${y},${z}`] ?? (y <= 63 ? 'stone' : 'air')
  return { at, set: (x, y, z, n) => { overrides[`${x},${y},${z}`] = n } }
}
function makeBot (w, pos = { x: 0, y: 64, z: 0 }, items = []) {
  const bot = new EventEmitter()
  Object.assign(bot, { registry, version: '1.21.8', game: { minY: -64 }, entities: {}, world: { raycast: () => null } })
  bot.entity = { position: new Vec3(pos.x + 0.5, pos.y, pos.z + 0.5), effects: {}, onGround: true, velocity: new Vec3(0, 0, 0) }
  bot.inventory = { items: () => items }
  bot.blockAt = p => {
    const f = p.floored()   // AS STRICT AS mineflayer (prismarine-world getBlock calls pos.floored()): a plain object must throw here
    const x = f.x, y = f.y, z = f.z
    if (Math.abs(x) > 60 || Math.abs(z) > 60) return null
    const b = Block.fromStateId(registry.blocksByName[w.at(x, y, z)].defaultState, 0)
    b.position = new Vec3(x, y, z)
    return b
  }
  pathfinder(bot)
  return bot
}
const pick = (name, left) => { const it = registry.itemsByName[name]; return { name, type: it.id, count: 1, maxDurability: it.maxDurability, durabilityUsed: it.maxDurability - left } }
const blockAtOf = bot => p => bot.blockAt(p)
const noYield = () => Promise.resolve()

// ---- masks ----
await t('breakHazard: clean stone 0; any liquid face, an unknown face, waterlogged, gravel above -> 100; no position -> 100, never throws', () => {
  const w = world(); const bot = makeBot(w); const at = blockAtOf(bot)
  assert.equal(breakHazard(at, bot.blockAt(new Vec3(3, 60, 3))), 0)
  for (const [dx, dy, dz, n] of [[1, 0, 0, 'water'], [0, -1, 0, 'lava'], [0, 0, 1, 'kelp'], [0, 1, 0, 'gravel']]) {
    const w2 = world(); w2.set(3 + dx, 60 + dy, 3 + dz, n); const b2 = makeBot(w2)
    assert.equal(breakHazard(blockAtOf(b2), b2.blockAt(new Vec3(3, 60, 3))), 100, `${n} at ${dx},${dy},${dz}`)
  }
  assert.equal(breakHazard(at, bot.blockAt(new Vec3(60, 60, 3))), 100, 'a face in an unloaded chunk')
  assert.equal(breakHazard(at, { name: 'stone' }), 100)
  assert.equal(breakHazard(() => { throw new Error('boom') }, bot.blockAt(new Vec3(3, 60, 3))), 100)
})

await t('stepHazard: WATER IS TERRAIN (allowed); lava under, BESIDE (the corridor guard\'s 3x3) or in the cell, and ladders, are vetoed', () => {
  const w = world(); w.set(5, 64, 5, 'water'); w.set(15, 63, 15, 'lava'); w.set(25, 64, 26, 'lava'); w.set(35, 64, 35, 'ladder')
  const bot = makeBot(w); const at = blockAtOf(bot)
  assert.equal(stepHazard(at, bot.blockAt(new Vec3(5, 64, 5))), 0, 'water must stay walkable (owner rule)')
  assert.equal(stepHazard(at, bot.blockAt(new Vec3(15, 64, 15))), 100, 'lava below')
  assert.equal(stepHazard(at, bot.blockAt(new Vec3(25, 64, 25))), 100, 'lava beside: what lavaguard corridorSafe refuses')
  assert.equal(stepHazard(at, bot.blockAt(new Vec3(35, 64, 35))), 100, 'ladder')
  assert.equal(stepHazard(at, bot.blockAt(new Vec3(45, 64, 45))), 0, 'plain ground')
})

// ---- budget and pickaxe-first ----
await t(`hasTripPickaxe: stone-or-better with >= ${MIN_TRIP_USES} uses; a wooden or a worn stone pick is not`, () => {
  assert.equal(hasTripPickaxe([pick('stone_pickaxe', MIN_TRIP_USES)]), true)
  assert.equal(hasTripPickaxe([pick('stone_pickaxe', MIN_TRIP_USES - 1)]), false)
  assert.equal(hasTripPickaxe([pick('wooden_pickaxe', 59)]), false)
  assert.equal(hasTripPickaxe([pick('iron_pickaxe', 200)]), true)
})
await t('pickBudget: tunnel + cluster + reserve must fit; the ore itself needs stone or better', () => {
  assert.equal(pickBudget([pick('stone_pickaxe', 131)], { pickBreaks: 30, cluster: 5 }).ok, true)
  const short = pickBudget([pick('stone_pickaxe', 20)], { pickBreaks: 26, cluster: 3 })
  assert.equal(short.ok, false); assert.match(short.why, /pickaxe uses/)
  const woodOnly = pickBudget([pick('wooden_pickaxe', 59)], { pickBreaks: 5, cluster: 3 })
  assert.equal(woodOnly.ok, false); assert.match(woodOnly.why, /stone-or-better/)
  assert.equal(pickBudget([pick('stone_pickaxe', 1)], { pickBreaks: 0, cluster: 1 }).ok, false, 'a spent copy pays nothing')
  assert.equal(RETURN_RESERVE > 0, true)
})
await t('rankCandidates: depth costs more than distance', () => {
  const r = rankCandidates({ x: 0, y: 64, z: 0 }, [{ x: 0, y: 40, z: 0 }, { x: 10, y: 63, z: 0 }])
  assert.deepEqual(r[0], { x: 10, y: 63, z: 0 })
})
await t('clusterOf: 26-neighbour flood fill, capped, iron only', () => {
  const w = world(); for (const c of [[0, 50, 0], [1, 51, 1], [2, 52, 2], [0, 50, 5]]) w.set(...c, 'iron_ore'); w.set(1, 50, 0, 'deepslate_iron_ore')
  const bot = makeBot(w)
  const c = clusterOf(blockAtOf(bot), new Vec3(0, 50, 0), IRON_KINDS)
  assert.equal(c.length, 4, `got ${c.map(p => `${p.x},${p.y},${p.z}`)}`)
  assert.equal(clusterOf(blockAtOf(bot), new Vec3(0, 50, 0), IRON_KINDS, 2).length, 2)
})

// ---- the movement profile ----
await t('tunnelMovements: the probed configuration, and the base profile\'s arrays are NOT mutated', () => {
  const w = world(); const bot = makeBot(w)
  const base = tunnelMovements(bot); const stepBefore = base.exclusionAreasStep.length
  const m = tunnelMovements(bot, base)
  assert.equal(base.exclusionAreasStep.length, stepBefore, 'shared array mutated')
  assert.equal(m.maxDropDown, 2); assert.equal(m.infiniteLiquidDropdownDistance, false)
  assert.equal(m.allow1by1towers, false); assert.equal(m.allowParkour, false); assert.deepEqual(m.scafoldingBlocks, [])
  const nb = []; m.getMoveDown({ x: 0, y: 64, z: 0 }, nb); assert.equal(nb.length, 0, 'the 1x1 shaft move is disabled')
  const nd = []; m.getMoveDiagonal({ x: 0, y: 64, z: 0 }, { x: 1, z: 1 }, nd); assert.equal(nd.length, 0, 'diagonal moves are disabled')
})

// ---- the planner, on the real pathfinder ----
const planFor = async (w, ores, opts = {}) => {
  for (const o of ores) w.set(o.x, o.y, o.z, 'iron_ore')
  const bot = makeBot(w, undefined, [pick('stone_pickaxe', 131)])
  const plan = await planTunnel(bot, { candidates: ores.map(o => new Vec3(o.x, o.y, o.z)), moves: tunnelMovements(bot), yieldFn: noYield, ...opts })
  return { bot, plan }
}
await t('ore 10 blocks down: a plan that ends FACE-ADJACENT to the ore, as a walkable staircase (every step changes y by at most 1)', async () => {
  const { plan } = await planFor(world(), [{ x: 0, y: 54, z: 6 }])
  assert.equal(plan.ok, true, plan.why)
  const e = plan.path.at(-1)
  const d = Math.abs(Math.floor(e.x) - 0) + Math.abs(Math.floor(e.y) - 54) + Math.abs(Math.floor(e.z) - 6)
  assert.ok(d <= 2, `ends ${d} blocks (manhattan) from the ore, at ${e.x},${e.y},${e.z}`)
  assert.ok(!(Math.floor(e.x) === 0 && Math.floor(e.z) === 6 && Math.floor(e.y) === 55), 'the plan must never end standing ON the ore')
  let prevY = 64
  let prev = { x: 0.5, z: 0.5 }
  for (const n of plan.path) {
    assert.ok(Math.abs(Math.floor(n.y) - prevY) <= 1, `a drop of ${prevY - Math.floor(n.y)} at ${n.x},${n.y},${n.z}`); prevY = Math.floor(n.y)
    assert.ok(Math.floor(n.x) === Math.floor(prev.x) || Math.floor(n.z) === Math.floor(prev.z), `a diagonal step at ${n.x},${n.y},${n.z}`); prev = n
  }
  assert.ok(plan.breaks.length > 0 && plan.breaks.length < 60, `${plan.breaks.length} breaks`)
})
await t('SideOfBlock: beside and below are stances; on top of the block is not', async () => {
  const { SideOfBlock } = await import('../src/oretunnel.mjs')
  const g = new SideOfBlock(0, 54, 6)
  assert.equal(g.isEnd({ x: 1, y: 54, z: 6 }), true, 'beside')
  assert.equal(g.isEnd({ x: 0, y: 52, z: 6 }), true, 'below: feet two down, head just under the ore')
  assert.equal(g.isEnd({ x: 0, y: 55, z: 6 }), false, 'on top')
})
await t('a hillside ore at foot level is cheap', async () => {
  const { plan } = await planFor(world(), [{ x: 6, y: 63, z: 0 }])
  assert.equal(plan.ok, true, plan.why); assert.ok(plan.breaks.length <= 12, `${plan.breaks.length} breaks`)
})
await t('lava beside the shortest route: no planned break touches a liquid', async () => {
  const w = world(); for (let y = 55; y <= 62; y++) for (let z = 0; z <= 6; z++) w.set(1, y, z, 'lava')
  const { bot, plan } = await planFor(w, [{ x: 0, y: 54, z: 6 }])
  if (plan.ok) for (const b of plan.breaks) assert.equal(breakHazard(blockAtOf(bot), bot.blockAt(b)), 0, `break at ${b.x},${b.y},${b.z} touches liquid`)
})
await t('HOME: no tunnel break within 12 blocks of home (the base floor is not a resource)', async () => {
  const w = world(); w.set(0, 54, 6, 'iron_ore')
  const bot = makeBot(w, undefined, [pick('stone_pickaxe', 131)])
  const m = tunnelMovements(bot, null, { home: { x: 0.5, z: 0.5 } })
  assert.equal(nearHome({ x: 5, y: 60, z: 5 }, { x: 0.5, z: 0.5 }), true); assert.equal(nearHome({ x: 20, y: 60, z: 0 }, { x: 0.5, z: 0.5 }), false)
  assert.ok(m.exclusionBreak(bot.blockAt(new Vec3(1, 63, 1))) >= 100, 'a block beside home is vetoed')
  const plan = await planTunnel(bot, { candidates: [new Vec3(0, 54, 6)], moves: m, yieldFn: noYield, timeoutMs: 1500 })
  assert.equal(plan.ok, false, 'no route may dig at home')
})

await t('an ore sitting on lava is itself unsafe to break (the executor filters it before planning)', () => {
  const w = world(); w.set(0, 54, 6, 'iron_ore'); w.set(0, 53, 6, 'lava'); const bot = makeBot(w)
  assert.equal(breakHazard(blockAtOf(bot), bot.blockAt(new Vec3(0, 54, 6))), 100)
})
await t('no route: a failed search is refused even though it returns a partial path', async () => {
  const w = world(); w.set(0, 54, 6, 'iron_ore'); for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) w.set(dx, 54 + dy, 6 + dz, 'bedrock')
  const bot = makeBot(w, undefined, [pick('stone_pickaxe', 131)])
  const plan = await planTunnel(bot, { candidates: [new Vec3(0, 54, 6)], moves: tunnelMovements(bot), yieldFn: noYield, timeoutMs: 1500 })
  assert.equal(plan.ok, false); assert.match(plan.why, /no route/)
})

// ---- pickaxe first, in the ladder, through the REAL rungs (SUSTAINING) ----
const { SUSTAINING } = await import('../src/milestones.mjs')
const rung = id => SUSTAINING.find(m => m.id === id)
// means present for both pickaxe rungs, so `done` answers the capability question and not "no means"
const MEANS = [{ name: 'crafting_table', count: 1 }, { name: 'cobblestone', count: 20 }, { name: 'stick', count: 4 }, { name: 'oak_planks', count: 8 }]
const ladderBot = (tools, ore = false) => ({
  registry: { blocksByName: { iron_ore: { id: 1 }, deepslate_iron_ore: { id: 2 } } },
  findBlock: () => (ore ? { position: { x: 0, y: 0, z: 0 } } : null),
  inventory: { items: () => [...MEANS, ...tools] },
})
await t('POSITIVE CONTROL: the pickaxe and iron rungs exist', () => {
  for (const id of ['craft_stone_pickaxe_1', 'craft_wooden_pickaxe_1', 'gather_iron_ore_3']) assert.ok(rung(id), `${id} missing: ${SUSTAINING.map(m => m.id)}`)
})
await t('stone_pickaxe rung: done only with a pickaxe that can pay a trip; spent or worn copies send the bot to make one', () => {
  const r = rung('craft_stone_pickaxe_1')
  assert.equal(r.done(ladderBot([pick('stone_pickaxe', 131)])), true)
  assert.equal(r.done(ladderBot([pick('stone_pickaxe', MIN_TRIP_USES - 1)])), false)
  assert.equal(r.done(ladderBot([pick('stone_pickaxe', 1), pick('stone_pickaxe', 1)])), false, 'spent copies are not a pickaxe')
  assert.equal(r.done(ladderBot([pick('iron_pickaxe', 200)])), true, 'a better usable tool satisfies it')
})
await t('wooden_pickaxe rung: a spent copy is not a pickaxe; a usable one (or a better tool) is', () => {
  const r = rung('craft_wooden_pickaxe_1')
  assert.equal(r.done(ladderBot([pick('wooden_pickaxe', 1)])), false)
  assert.equal(r.done(ladderBot([pick('wooden_pickaxe', 30)])), true)
  assert.equal(r.done(ladderBot([pick('stone_pickaxe', 60)])), true)
})
await t('iron rung is offered only with a trip-ready pickaxe (else vacuously done: the pickaxe rung comes first)', () => {
  const r = rung('gather_iron_ore_3')
  assert.equal(r.done(ladderBot([pick('stone_pickaxe', 131)], true)), false, 'actionable')
  assert.equal(r.done(ladderBot([pick('stone_pickaxe', 10)], true)), true, 'not offered with a worn pickaxe')
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
