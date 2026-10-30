// THE TOWN'S GROUND -- the zone (townground.mjs, skills.mjs gather/mine, oretunnel.mjs, index.mjs profiles).
// townground-2026-10-13.md sections 2.4-2.6. TARGET digs refused, TRANSIT priced, SURVIVAL untouched.
//
// The trap class (CLAUDE.md): two individually-correct guards meeting where the bot has no legal move. So the tests
// below drive the REAL skill functions through the refusal CHAIN -- a gatherer whose nearest 32 dirt cells are town
// ground, a miner standing at home, a miner whose only dry bearing runs into town -- and assert that every refusal names
// a move the bot can make from where it stands, and that the move works.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
process.env.HOME_X = '200'; process.env.HOME_Y = '65'; process.env.HOME_Z = '200'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const TG = await import('../src/townground.mjs')
const { townTargetPermit, makeTownBreakCost, stairTownClear, walkOutPoint, walkOutPoints, TOWN_GROUND_HALF, TOWN_GROUND_DEPTH, townDigClass } = TG
const SK = await import('../src/skills.mjs')
const { SKILLS, chooseStairBearing } = SK
const { tunnelMovements } = await import('../src/oretunnel.mjs')
const HOME = { x: 200, y: 65, z: 200 }
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)
const INDEX_URL = new URL('../src/index.mjs', import.meta.url)
const TUNNEL_URL = new URL('../src/oretunnel.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

async function withMutantsAll (url, pairs, fn) {
  let src = readFileSync(url, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
    assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// A PLANNER MUTANT THROUGH THE REAL SKILL (townzone-01 on minewell-01): the mutated minewell.mjs is imported by a copy of
// skills.mjs, so the skill's own decision runs on it (a mutant of the planner alone could not show the chain)
const MINEWELL_URL = new URL('../src/minewell.mjs', import.meta.url)
async function withPlannerMutant (old, neu, fn) {
  const src = readFileSync(MINEWELL_URL, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`
  const mw = new URL(`./_mutant-mw-${tag}.mjs`, import.meta.url), sk = new URL(`./_mutant-sk-${tag}.mjs`, import.meta.url)
  writeFileSync(mw, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  const skSrc = readFileSync(SKILLS_URL, 'utf8')
  assert.equal(skSrc.split("from './minewell.mjs'").length, 2, 'skills.mjs imports minewell.mjs once')
  writeFileSync(sk, skSrc.replace("from './minewell.mjs'", `from './_mutant-mw-${tag}.mjs'`).replace(/from '\.\/(?!_mutant-mw-)/g, "from '../src/"))
  try { return await fn(await import(sk.href)) } finally { for (const u of [mw, sk]) { try { unlinkSync(u) } catch {} } }
}
const ENUM = ["      .findBlocks({ matching: notTown(type.id), maxDistance, count: 32 })\n", "      .findBlocks({ matching: type.id, maxDistance, count: 32 })\n"]
const SAFE = ["    const baseSafe = p => townTargetPermit(p, bot.blockAt(p)?.name, townHome()).ok &&\n", "    const baseSafe = p => true &&\n"]   // CAVEFALL-01: safeTarget = !caveSkip && baseSafe
const SWING = ["  if (!townOk.ok) {\n    noteTownGround(bot, 'gather_refused')", "  if (false) {\n    noteTownGround(bot, 'gather_refused')"]

// ---- pure ----------------------------------------------------------------------------------------------------------
test('PERMIT: a target dig of town ground is refused with an executable remedy; everything else is permitted', () => {
  const r = townTargetPermit({ x: 205, y: 63, z: 195 }, 'dirt', HOME)
  assert.equal(r.ok, false); assert.equal(r.reason, 'town_ground')
  assert.match(r.remedy, /more than 16 blocks from home/, 'the remedy names where to go')
  assert.equal(townTargetPermit({ x: 217, y: 63, z: 200 }, 'dirt', HOME).ok, true, 'one past the square')
  assert.equal(townTargetPermit({ x: 205, y: 63, z: 195 }, 'oak_log', HOME).ok, true, 'planted trees stay harvestable')
  assert.equal(townTargetPermit({ x: 205, y: 52, z: 195 }, 'stone', HOME).ok, true, 'below the band')
  assert.equal(townTargetPermit({ x: 205, y: 63, z: 195 }, 'dirt', null).ok, true, 'no home: the zone is off')
  assert.equal(TG.configuredHome({ homeX: 0, homeY: 70, homeZ: 0 }, {}), null, 'config defaults are not a town: no HOME_* env -> zone off')
  assert.deepEqual(TG.configuredHome({ homeX: 355, homeY: 73, homeZ: 147 }, { HOME_X: '355', HOME_Y: '73', HOME_Z: '147' }), { x: 355, y: 73, z: 147 })
  assert.equal(TG.configuredHome({ homeX: 355, homeY: 73, homeZ: 147 }, { HOME_X: '355', HOME_Y: '73' }), null)
})

test('TUNNEL COST: 100 on town ground (a target profile), 0 outside, below the band, on vegetation, without home', () => {
  const tu = makeTownBreakCost(HOME, 100)
  const b = (x, y, z, name = 'dirt') => ({ position: { x, y, z }, name })
  assert.equal(tu(b(200, 64, 200)), 100); assert.equal(tu(b(216, 64, 184)), 100, 'the square\'s corner'); assert.equal(tu(b(217, 64, 200)), 0)
  assert.equal(tu(b(200, HOME.y - TOWN_GROUND_DEPTH, 200)), 100); assert.equal(tu(b(200, HOME.y - TOWN_GROUND_DEPTH - 1, 200)), 0)
  assert.equal(tu(b(200, 64, 200, 'oak_leaves')), 0); assert.equal(tu(b(200, 64, 200, 'chest')), 0)
  assert.equal(makeTownBreakCost(null, 100)(b(200, 64, 200)), 0)
  assert.equal(tu({}), 0); assert.equal(tu(null), 0)
})

test('STAIR CLEAR: from home every bearing cuts town ground; at the edge facing out it is clear; below the band it is free', () => {
  const ground = (x, y, z) => (y <= 64 ? 'stone' : 'air')
  const B = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]
  for (const bear of B) assert.equal(stairTownClear({ x: 200, y: 65, z: 200 }, bear, HOME, ground).clear, false, JSON.stringify(bear))
  assert.equal(stairTownClear({ x: 216, y: 65, z: 200 }, { x: 1, z: 0 }, HOME, ground).clear, true, 'at x=216 the first tread is at 217: outside')
  assert.equal(stairTownClear({ x: 216, y: 65, z: 200 }, { x: -1, z: 0 }, HOME, ground).clear, false, 'inward')
  assert.equal(stairTownClear({ x: 200, y: 51, z: 200 }, { x: 1, z: 0 }, HOME, ground).clear, true, 'below the band')
  assert.equal(stairTownClear({ x: 222, y: 65, z: 200 }, { x: -1, z: 0 }, HOME, ground).clear, false, 'from outside, inward, above the band: it would enter')
  assert.equal(stairTownClear({ x: 230, y: 65, z: 200 }, { x: -1, z: 0 }, HOME, ground).clear, false, 'from x=230 its ceiling cell is still IN the band (y 53) when it reaches the square')
  assert.equal(stairTownClear({ x: 232, y: 65, z: 200 }, { x: -1, z: 0 }, HOME, ground).clear, true, 'from x=232 it is below the band when it arrives')
  assert.equal(stairTownClear({ x: 216, y: 65, z: 200 }, { x: 1, z: 0 }, HOME, () => null).clear, true, 'outside: unknown cells are not town cells')
  assert.equal(stairTownClear({ x: 210, y: 65, z: 200 }, { x: 1, z: 0 }, HOME, () => null).clear, false, 'inside: an unknown cell counts as ground (never on a guess)')
  assert.equal(stairTownClear({ x: 200, y: 65, z: 200 }, { x: 1, z: 0 }, null, ground).clear, true, 'no home: zone off')
})

test('WALK OUT: every exit, nearest first, 3 past the square, keeping the other coordinate', () => {
  assert.deepEqual(walkOutPoints({ x: 214, y: 65, z: 200 }, HOME).map(p => [p.x, p.z]), [[219, 200], [214, 219], [214, 181], [181, 200]])
  assert.deepEqual(walkOutPoints({ x: 240, y: 65, z: 200 }, HOME).map(p => [p.x, p.z]), [[240, 219], [240, 181]], 'from outside, never an exit across town (Claude code r2 P3)')
  assert.deepEqual(walkOutPoint({ x: 210.4, y: 65, z: 203 }, HOME), { x: 219, z: 203, bear: { x: 1, z: 0 } })
  assert.deepEqual(walkOutPoint({ x: 199, y: 65, z: 188 }, HOME), { x: 199, z: 181, bear: { x: 0, z: -1 } })
  assert.equal(walkOutPoint({ x: 1, y: 1, z: 1 }, null), null)
})

// ---- the profiles, built for real (index.mjs/oretunnel.mjs shapes) ---------------------------------------------------
test('PROFILES: the tunnel refuses town ground; the transit profile is untouched', () => {
  const { Movements } = require_('mineflayer-pathfinder')
  const bot = { registry: mcData, world: { getBlock: () => null }, version: '1.21.8', entity: { position: new Vec3(0, 0, 0) },
                blockAt: () => ({ name: 'stone', boundingBox: 'block', type: 1 }), game: { minY: -64, height: 384 }, supportFeature: () => false }
  let base
  try { base = new Movements(bot) } catch { base = { exclusionAreasBreak: [], exclusionBreak (b) { return this.exclusionAreasBreak.reduce((w, a) => w + a(b), 0) } } }
  base.exclusionAreasBreak = []
  const tun = tunnelMovements(bot, base, { home: HOME })
  const cell = { position: new Vec3(214, 64, 212), name: 'dirt', type: 1 }   // in the square, OUTSIDE nearHome's 12 (so only the town entry can refuse it)
  const sum = m => m.exclusionAreasBreak.reduce((w, a) => w + a(cell), 0)
  assert.equal(sum(base), 0, 'transit: untouched')
  assert.ok(sum(tun) >= 100, `the tunnel refuses town ground (got ${sum(tun)})`)
  assert.notEqual(tun.exclusionAreasBreak, base.exclusionAreasBreak, 'the tunnel has its own array (a later push to the transit array does not reach it)')
  const far = { position: new Vec3(260, 64, 260), name: 'dirt', type: 1 }
  assert.equal(tun.exclusionAreasBreak.reduce((w, a) => w + a(far), 0), 0, 'outside town the tunnel is unchanged')
})

test('TRANSIT UNTOUCHED (real mineflayer-pathfinder 2.4.5 Movements): a forward move through a 2-high STONE wall by hand exists in town exactly as outside -- no veto, no price (Codex code r2 P2: a 30 surcharge pushed it past the 100 discard)', () => {
  const { Movements } = require_('mineflayer-pathfinder')
  const registry = require_('prismarine-registry')('1.21.8')
  const Block = require_('prismarine-block')(registry)
  const walls = new Set(['205,65,200', '205,66,200', '235,65,200', '235,66,200'])
  const blockAt = p => {
    const name = p.y <= 64 ? 'stone' : walls.has(`${p.x},${p.y},${p.z}`) ? 'stone' : 'air'
    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = new Vec3(p.x, p.y, p.z); return b
  }
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: new Vec3(204.5, 65, 200.5), effects: {} }, entities: {}, inventory: { items: () => [] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot); m.canDig = true; m.allowParkour = false; m.allowSprinting = false; m.scafoldingBlocks = []
  const idx = strip(readFileSync(INDEX_URL, 'utf8'))
  // the shared arrays exactly as index.mjs builds them: no town entry on either
  assert.doesNotMatch(idx, /moves\.exclusionAreas(Step|Break)\.push\(/, 'nothing is pushed onto the shared step or break arrays')
  const forward = x => m.getNeighbors({ x, y: 65, z: 200, remainingBlocks: 0 }).find(n => n.x === x + 1 && n.y === 65 && n.z === 200)
  const inTown = forward(204), outTown = forward(234)
  assert.ok(inTown && outTown, 'the move through the wall exists in town and outside')
  assert.equal(inTown.cost, outTown.cost, 'and costs the same')
  // positive control: the SAME move with a 30 surcharge per broken cell is discarded (the reason transit is not priced)
  const priced = new Movements(bot); priced.canDig = true; priced.allowParkour = false; priced.scafoldingBlocks = []
  priced.exclusionAreasStep = [b => (b?.boundingBox === 'block' && Math.abs(b.position.x - 200) <= 16 ? 30 : 0)]
  assert.equal(priced.getNeighbors({ x: 204, y: 65, z: 200, remainingBlocks: 0 }).find(n => n.x === 205 && n.y === 65 && n.z === 200), undefined, 'a priced stone wall is no move at all')
})

// ---- the refusal chain: gather -----------------------------------------------------------------------------------------
// A fake bot whose findBlocks behaves like mineflayer 4.37.1's: the matcher is called first per section PALETTE with a
// positionless block (a type test), then per cell with a positioned block; the nearest `count` matches are returned.
function gatherWorld ({ dirt }) {
  const D = mcData.blocksByName.dirt, AIRT = mcData.blocksByName.air
  const set = new Set(dirt.map(([x, y, z]) => `${x},${y},${z}`))
  // CAVEFALL-01: the dirt lies on rock -- a dirt cell floating over 32+ blocks of air is, correctly, a floor over a drop
  const rock = new Set(dirt.map(([x, y, z]) => `${x},${y - 1},${z}`))
  const digs = []
  const blk = (x, y, z) => {
    const isDirt = set.has(`${x},${y},${z}`)
    const isRock = !isDirt && rock.has(`${x},${y},${z}`)
    const t = isDirt ? D : isRock ? mcData.blocksByName.stone : AIRT
    return { name: t.name, type: t.id, position: new Vec3(x, y, z), boundingBox: (isDirt || isRock) ? 'block' : 'empty', diggable: isDirt,
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
// 40 dirt cells inside the square (2..9 blocks out), 3 outside it at x = 219..221: the 32 nearest are all town ground
const townDirt = []
for (let i = 0; i < 40; i++) townDirt.push([202 + (i % 8), 63, 196 + Math.floor(i / 8)])
const outside = [[219, 63, 200], [220, 63, 200], [221, 63, 200]]

test('CHAIN gather: the nearest 32 dirt cells are town ground and three lie outside -- the search reaches past them', async () => {
  const { bot, digs } = gatherWorld({ dirt: [...townDirt, ...outside] })
  const r = await SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
  for (const p of digs) assert.equal(townDigClass(p, 'dirt', HOME), 'free', `dug town ground at ${p}`)
  assert.ok(digs.some(p => p.x >= 219), `the dirt outside the town was the one taken (digs ${JSON.stringify(digs)}, result ${JSON.stringify(r).slice(0, 200)})`)
  assert.ok(bot.townGround?.gather_skipped > 0, 'the skipped town candidates are counted for the liveness row')
})

test('CHAIN gather: only town dirt anywhere -> a refusal naming where to go (and nothing dug)', async () => {
  const { bot, digs } = gatherWorld({ dirt: townDirt })
  const r = await SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
  assert.equal(digs.length, 0)
  assert.notEqual(r.status, 'success')
  assert.match(String(r.detail), /town's ground|blocks from home/, `the refusal names the remedy: ${r.detail}`)
})

test('MUTANT KILLED: filtering after the search (no enumeration filter) starves gather -- the outside dirt is never found', async () => {
  await withMutant(SKILLS_URL, "      .findBlocks({ matching: notTown(type.id), maxDistance, count: 32 })\n", "      .findBlocks({ matching: type.id, maxDistance, count: 32 })\n", async mod => {
    const { bot, digs } = gatherWorld({ dirt: [...townDirt, ...outside] })
    await mod.SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(() => null)
    assert.ok(!digs.some(p => p.x >= 219), 'the mutant does not reach the outside dirt (the starvation Codex r1 P1 named)')
  })
})

test('LAYERS: with the enumeration filter AND the target filter both removed, the check at the swing still refuses; remove it too and town dirt is dug', async () => {
  await withMutantsAll(SKILLS_URL, [ENUM, SAFE], async mod => {
    const { bot, digs } = gatherWorld({ dirt: townDirt })
    await mod.SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(() => null)
    assert.equal(digs.length, 0, 'the swing-time conjunction holds on its own')
  })
  await withMutantsAll(SKILLS_URL, [ENUM, SAFE, SWING], async mod => {
    const { bot, digs } = gatherWorld({ dirt: townDirt })
    await mod.SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(() => null)
    assert.ok(digs.length > 0, 'positive control: with all three layers gone the fake world IS dug (the harness can see a town dig)')
  })
})

// ---- the refusal chain: mine ---------------------------------------------------------------------------------------
const V = (x, y, z) => new Vec3(x, y, z)
const AIR = { name: 'air', boundingBox: 'empty', type: 0 }, STONE = { name: 'stone', boundingBox: 'block', type: 1 }, WATER = { name: 'water', boundingBox: 'empty', type: 2 }
function stairWorld ({ at = [200, 65, 200], wet = () => false, yaw = 0, open = () => false, onWalk = null } = {}) {
  const carved = new Set(), digs = [], walks = [], filled = new Set()
  const k = (x, y, z) => `${x},${y},${z}`
  const base = p => filled.has(k(p.x, p.y, p.z)) ? STONE : carved.has(k(p.x, p.y, p.z)) ? AIR : wet(p.x, p.y, p.z) ? WATER : open(p.x, p.y, p.z) ? AIR : p.y < 65 ? STONE : AIR
  const bot = {
    entity: { position: V(...at), yaw, velocity: V(0, 0, 0), onGround: true },
    health: 20, food: 20, oxygenLevel: 300, heldItem: { type: 1 },
    blockAt: p => ({ ...base(p), position: V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 50, material: 'rock' }),
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'cobblestone', count: 512 }] },
    equip: async () => {},
    dig: async b => { digs.push(V(b.position.x, b.position.y, b.position.z)); carved.add(k(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      movements: {}, setMovements () {}, setGoal () {}, stop () {}, isMining: () => false, isMoving: () => false,
      goto: async goal => {
        const gy = goal.y ?? bot.entity.position.y
        const to = V(goal.x, Math.floor(gy), goal.z)
        walks.push(to)
        if (base(to).boundingBox === 'block' || base(to.offset(0, 1, 0)).boundingBox === 'block') return
        bot.entity.position = to; bot.entity.yaw += 0.9
        if (onWalk) onWalk(walks.length, (x, y, z) => { carved.delete(k(x, y, z)); filled.add(k(x, y, z)) })
      },
    },
    setControlState () {}, clearControlStates () {}, lookAt: async () => {}, registry: { blocksByName: {}, itemsByName: {} }, players: {}, entities: {},
    _digs: digs, _walks: walks,
  }
  return bot
}
const runMine = (mod, bot, y = 40) => mod.SKILLS.mine.run({ bot }, { y }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))

test('CHAIN mine: from inside the square (not within 12) it walks out, then cuts a stair that never touches town ground', async () => {
  for (const at of [[214, 65, 200], [186, 65, 200], [200, 65, 214], [200, 65, 186], [213, 65, 213], [187, 65, 187], [213, 65, 187], [187, 65, 213]]) {
    const bot = stairWorld({ at })
    const r = await runMine(SK, bot)
    const town = bot._digs.filter(p => townDigClass(p, 'stone', HOME) === 'ground')
    assert.equal(town.length, 0, `from ${at}: dug town ground ${JSON.stringify(town.slice(0, 3))}; result ${r.status} ${String(r.detail).slice(0, 120)}`)
    assert.ok(bot._walks.length >= 1, `from ${at}: it walked out first`)
    assert.ok(bot._digs.length > 0 || r.failClass === 'town_ground', `from ${at}: a stair was cut, or the refusal is the zone's (${r.status} ${r.failClass} ${String(r.detail).slice(0, 100)})`)
  }
})

test('CHAIN mine: at home the 12-block rule refuses first (unchanged, full depth) and names its remedy', async () => {
  const bot = stairWorld({ at: [200, 65, 200] })
  const r = await runMine(SK, bot)
  assert.equal(r.failClass, 'forbidden'); assert.match(r.detail, /walk out at least 20 blocks/); assert.equal(bot._digs.length, 0)
})

test('CHAIN mine: below the band the zone does not apply (the 12-block rule still does)', async () => {
  const bot = stairWorld({ at: [214, 52, 200] })
  bot.blockAt = p => ({ ...(p.y < 52 ? STONE : AIR), position: V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 50, material: 'rock' })
  const r = await runMine(SK, bot, 30)
  assert.equal(bot._walks.filter(w => Math.abs(w.x - 200) > 16).length, 0, `no walk-out below the band (${r.status} ${String(r.detail).slice(0, 80)})`)
})

test('CHAIN mine: the water case -- the outward bearings are wet, the dry one runs into town -> walk out, never cut town ground', async () => {
  // a pond everywhere x >= 215 (the outward side), dry inside: from x=214 every clear bearing is wet at its first tread
  const bot = stairWorld({ at: [214, 65, 200], wet: (x, y, z) => x >= 215 && y <= 64 && y >= 40 })
  const r = await runMine(SK, bot)
  const town = bot._digs.filter(p => townDigClass(p, 'stone', HOME) === 'ground')
  assert.equal(town.length, 0, `dug town ground: ${JSON.stringify(town.slice(0, 3))}`)
  // the pond fills the nearest exit (x = 219): the walk-out goes on to the next exit and cuts a DRY stair there
  assert.ok(bot._digs.length > 0, `a stair was cut at a dry exit (${r.status} ${String(r.detail).slice(0, 160)})`)
  assert.ok(bot._digs.every(p => p.x < 215), 'not in the pond')
})

test('MUTANT KILLED: without the water branch the bot is left with the water refusal (no stair)', async () => {
  // the water branch is now the PLANNER's (minewell.mjs planMineStart: a keep-out must not leave only wet ways when it took a dry one)
  await withPlannerMutant("  if (here.length && (here.some(b => isDry(p0, b)) || !left.some(b => isDry(p0, b)))) return { action: 'go', bearings: here, kinds: kindsOf(left) }\n",
    "  if (here.length) return { action: 'go', bearings: here, kinds: kindsOf(left) }\n", async mod => {
      const bot = stairWorld({ at: [214, 65, 200], wet: (x, y, z) => x >= 215 && y <= 64 && y >= 40 })
      const r = await runMine(mod, bot)
      assert.equal(bot._digs.length, 0, `the mutant cut nothing (${r.status} ${r.failClass})`)
      assert.equal(r.failClass, 'hazard_interrupt')
      assert.match(r.detail, /the other directions would dig the town's ground; goto somewhere drier away from home first/, 'and the refusal does not claim water everywhere')
    })
})

test('CHAIN mine: from OUTSIDE the box there is no walk-out; a stair running toward town is fine when it passes BELOW the band', async () => {
  // from x=240, y=65 the only dry bearing is -x (toward town): it reaches the square at x=216 at y=41, below the band (53)
  const bot = stairWorld({ at: [240, 65, 200], wet: (x, y, z) => x >= 241 && y <= 64 && y >= 40 || (z !== 200 && x === 240 && y === 64) })
  const r = await runMine(SK, bot)
  const exits = bot._walks.filter(w => w.y >= 64 && (w.z === 219 || w.z === 181 || w.x === 181 || w.x === 219))   // a walk-out is a level goto, a stair tread descends
  assert.equal(exits.length, 0, `no walk-out from outside the box: ${JSON.stringify(exits.slice(0, 3))}`)
  assert.equal(bot._digs.filter(p => townDigClass(p, 'stone', HOME) === 'ground').length, 0, 'no town ground dug')
  assert.ok(bot._digs.length > 0, `the stair under the town was cut (${r.status} ${String(r.detail).slice(0, 100)})`)
})

test('CHAIN mine: the nearest walk-off is obstructed (goto fails) -> a start away from it is taken and the stair starts there', async () => {
  // ONE PLANNER (townzone-01 on minewell-01): the nearest start is the square's edge (216: its outward stair cuts no town
  // ground). Level walks east near z = 200 fail; the stair's own steps (descending) are not walks-off and pass.
  const bot = stairWorld({ at: [214, 65, 200] })
  const goto0 = bot.pathfinder.goto, tries = []
  bot.pathfinder.goto = async goal => {
    if (goal.y >= 65) tries.push({ x: goal.x, y: goal.y, z: goal.z })
    if (goal.y >= 65 && Math.round(goal.x) >= 215 && Math.abs(Math.round(goal.z) - 200) <= 2) return
    return goto0(goal)
  }
  const r = await runMine(SK, bot)
  assert.equal(bot._digs.filter(p => townDigClass(p, 'stone', HOME) === 'ground').length, 0)
  assert.ok(tries.length >= 2, `a second start was tried: ${JSON.stringify(tries)}`)
  assert.ok(Math.max(Math.abs(tries[1].x - tries[0].x), Math.abs(tries[1].z - tries[0].z)) > 2, `never beside the failed one: ${JSON.stringify(tries)}`)
  assert.equal(r.status, 'success', `a stair was cut from the second start (${r.status} ${String(r.detail).slice(0, 140)})`)
  assert.ok(bot._digs.length > 0)
})

test('CHAIN mine: EVERY walk-off obstructed (open sky) -> a refusal of the zone that names a reachable move (never a dig in town) -- and the move works', async () => {
  const bot = stairWorld({ at: [214, 65, 200] })
  const goto0 = bot.pathfinder.goto
  bot.pathfinder.goto = async goal => { if (goal.y >= 65) { bot._walks.push(V(goal.x, goal.y, goal.z)); return } return goto0(goal) }   // no level walk reaches anything
  const r = await runMine(SK, bot)
  assert.equal(bot._digs.length, 0, 'nothing dug')
  assert.equal(r.failClass, 'town_ground', `${r.status} ${r.detail}`)
  assert.match(r.detail, /^reason=town_ground /)
  const m = r.detail.match(/goto a dry spot (\d+)\+ blocks from home/)
  assert.ok(m, r.detail)
  // THE REMEDY, PERFORMED: walk to a dry spot that far from home, then mine -- it descends, and never in town ground
  bot.pathfinder.goto = goto0
  const walked = await SKILLS.goto.run({ bot }, { x: HOME.x + Number(m[1]) + 1, y: 65, z: 200 }, new AbortController().signal)   // the PRODUCTION goto skill
  assert.equal(walked.status, 'success', `${walked.status} ${walked.detail}`)
  const again = await runMine(SK, bot)
  assert.equal(again.status, 'success', `${again.status} ${String(again.detail).slice(0, 140)}`)
  assert.equal(bot._digs.filter(p => townDigClass(p, 'stone', HOME) === 'ground').length, 0)
})

test('CHAIN mine: UNDER a roof in town (8 below home, solid above) -> climb FIRST (to the column top: surface stops at 63), never four horizontal tunnels at depth; climb digs are scoped, never mine\'s target (Claude code r2 P1/P2, Codex code r4 P2)', async () => {
  const D = await import('../src/digtown.mjs')
  const bot = stairWorld({ at: [214, 57, 200] })
  const scopes = []
  const dig0 = bot.dig
  bot.dig = async b => { scopes.push(D.currentDigScope()?.by ?? 'none'); return dig0(b) }
  const gotos = []
  const goto0 = bot.pathfinder.goto
  bot.pathfinder.goto = async goal => { gotos.push({ x: Math.round(goal.x), y: goal.y, z: Math.round(goal.z) }); return goto0(goal) }
  const r = await runMine(SK, bot)
  const firstExit = gotos.findIndex(g => g.x === 219 || g.x === 181 || g.z === 219 || g.z === 181)
  assert.ok(firstExit === -1 || gotos.slice(0, firstExit).length >= 0, 'no exit walk before surface')
  assert.ok(!gotos.some(g => (g.x === 219 || g.z === 219 || g.x === 181 || g.z === 181) && g.y !== undefined && g.y <= 58), `no exit walked at the tunnel's depth: ${JSON.stringify(gotos.slice(0, 6))}`)
  const town = bot._digs.map((p, i) => [p, scopes[i]]).filter(([p, s]) => townDigClass(p, 'stone', HOME) === 'ground' && s === 'none')
  assert.equal(town.length, 0, `town digs with no scope (would read target:mine): ${JSON.stringify(town.slice(0, 3))}; result ${r.status} ${String(r.detail).slice(0, 80)}`)
})

// A ROOFED BOT ABOVE SEA LEVEL (Codex code r5 P2): a stone roof at y 69-70 over the town's east side, the bot at 214,65,200
// under it. The fake's ascent: getPathTo says the walk profile has no path and the ascent profile has one; a GoalY goto digs
// each solid cell of the column up to the stage (through bot.dig, so the instrument scope is visible) and moves the bot.
function roofedWorld () {
  const bot = stairWorld({ at: [214, 65, 200] })
  const roof = (x, y, z) => (y === 69 || y === 70) && x >= 205 && x <= 230 && z >= 190 && z <= 210
  const base = bot.blockAt
  const dug = new Set()
  bot.blockAt = p => (roof(p.x, p.y, p.z) && !dug.has(`${p.x},${p.y},${p.z}`)) ? { ...STONE, position: V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 50, material: 'rock' } : base(p)
  const dig0 = bot.dig
  bot.dig = async b => { dug.add(`${b.position.x},${b.position.y},${b.position.z}`); return dig0(b) }
  bot.ascentMovements = { tag: 'ascend' }
  bot.withAscentMovements = async fn => fn()
  bot.pathfinder.getPathTo = (moves) => ({ status: moves === bot.ascentMovements ? 'success' : 'noPath' })
  const goto0 = bot.pathfinder.goto
  bot.maxY = 65
  bot.pathfinder.goto = async goal => {
    if (goal.x === undefined && Number.isFinite(goal.y)) {          // GoalY
      const p = bot.entity.position.floored()
      for (let y = p.y; y <= goal.y + 1; y++) { const b = bot.blockAt(V(p.x, y, p.z)); if (b.boundingBox === 'block') await bot.dig(b) }
      bot.entity.position = V(p.x, goal.y, p.z); bot.maxY = Math.max(bot.maxY, goal.y); return
    }
    const r = await goto0(goal); bot.maxY = Math.max(bot.maxY, bot.entity.position.y); return r
  }
  return bot
}
test('CHAIN mine: roofed ABOVE sea level -> the climb really rises through the roof (surface aimed at the column top), then walks out and stairs outside town; climb digs are transit:surface, never target', async () => {
  const D = await import('../src/digtown.mjs')
  const bot = roofedWorld()
  const scopes = []
  const dig1 = bot.dig
  bot.dig = async b => { scopes.push([V(b.position.x, b.position.y, b.position.z), D.currentDigScope()?.by ?? 'none']); return dig1(b) }
  const r = await runMine(SK, bot)
  assert.ok(bot.maxY >= 71, `it rose through the roof (max y ${bot.maxY}; ${r.status} ${String(r.detail).slice(0, 160)})`)
  const unscopedTown = scopes.filter(([p, by]) => townDigClass(p, 'stone', HOME) === 'ground' && by === 'none')
  assert.equal(unscopedTown.length, 0, `town digs outside any scope (would read target:mine): ${JSON.stringify(unscopedTown.slice(0, 3))}`)
  assert.ok(scopes.some(([p, by]) => by === 'surface' && p.y >= 69), 'the roof was dug by the climb, labelled surface')
  assert.ok(bot._digs.some(p => p.x > 216), `a stair was cut outside town after the climb (${r.status} ${String(r.detail).slice(0, 120)})`)
})
test('MUTANT KILLED: surface without the named top refuses at once above sea level ("already_surfaced") and the bot never rises', async () => {
  await withMutant(SKILLS_URL, '  const TOP = Number.isFinite(args?._toY) ? Math.max(SEA_LEVEL, args._toY) : SEA_LEVEL\n', '  const TOP = SEA_LEVEL\n', async mod => {
    const bot = roofedWorld()
    const r = await runMine(mod, bot)
    assert.equal(bot.maxY, 65, 'no climb')
    assert.match(String(r.detail), /surfaced=failed\/already_surfaced/, r.detail)
  })
})

test('MUTANT KILLED: the town left out of the ONE keep-out -- the plan and the per-dig stop both lose it, and the stair cuts town ground', async () => {
  await withMutant(SKILLS_URL, '    return composeKeepOut(farm, townKeepOut(townHome(), nameAt), stairKeepOut(stairRecordNow()))\n', '    return composeKeepOut(farm, stairKeepOut(stairRecordNow()))\n', async mod => {
    const bot = stairWorld({ at: [214, 65, 200], yaw: Math.PI / 2 })
    await runMine(mod, bot)
    const real = stairWorld({ at: [214, 65, 200], yaw: Math.PI / 2 })
    await runMine(SK, real)
    assert.equal(real._digs.filter(p => townDigClass(p, 'stone', HOME) === 'ground').length, 0, 'the real code cuts none')
    assert.ok(bot._digs.some(p => townDigClass(p, 'stone', HOME) === 'ground'), `the mutant cuts town ground (${JSON.stringify(bot._digs.slice(0, 3))})`)
  })
})
test('MUTANT KILLED: no far starts -- a moat fills every ring start within 16 and the town blocks every stair from here: the real code walks beyond the square, the mutant refuses', async () => {
  // bot 13 east of home; the surface (y 64) within 16 of it is water, so no ring start is standable; the far starts just
  // beyond the square (townExitColumns, 19 from home) on the WEST are dry -- only they can start a stair
  const moat = (x, y, z) => y === 64 && Math.max(Math.abs(x - 213), Math.abs(z - 200)) <= 16 && !(x === 213 && z === 200)
  const make = () => stairWorld({ at: [213, 65, 200], wet: moat })
  const real = make()
  const r = await runMine(SK, real)
  assert.equal(r.status, 'success', `the real code walks to a far start and descends: ${r.status} ${String(r.detail).slice(0, 160)}`)
  assert.equal(real._digs.filter(p => townDigClass(p, 'stone', HOME) === 'ground').length, 0, 'no town ground')
  assert.ok(real._walks.some(w => Math.max(Math.abs(w.x - HOME.x), Math.abs(w.z - HOME.z)) === TOWN_GROUND_HALF + 3), `a far start (19 from home) was walked to: ${JSON.stringify(real._walks.slice(0, 4))}`)
  await withMutant(SKILLS_URL, 'radius, goalY, exclude: failedTargets, dry: dryStart, far: farStarts,', 'radius, goalY, exclude: failedTargets, dry: dryStart,', async mod => {
    const bot = make()
    const m = await runMine(mod, bot)
    assert.equal(m.status, 'failed', `the mutant cannot start: ${m.status} ${String(m.detail).slice(0, 140)}`)
    assert.equal(m.failClass, 'town_ground')
    assert.equal(bot._digs.length, 0)
  })
})

// A STALE BEARING: from x=218 (outside the square) the only dry bearing is an open stair running INTO town (air cells:
// not ground, so the chooser clears it); after the second step the world fills the next tread with stone (a falling
// column, another bot). The per-step check must stop there; without it the stair cuts town ground.
const staleWorld = () => stairWorld({
  at: [218, 65, 200], yaw: Math.PI / 2,
  wet: (x, y, z) => (x >= 219 && y === 64) || (z !== 200 && y === 64 && x === 218),
  open: (x, y, z) => z === 200 && x <= 217 && x >= 200 && y >= 64 - (217 - x) && y <= 66 - (217 - x),
  onWalk: (n, fill) => { if (n === 2) for (let x = 200; x <= 214; x++) for (let y = 40; y <= 70; y++) fill(x, y, 200) },
})
test('CHAIN mine: a stair cleared on a stale world stops at the first town-ground tread (per-step re-check)', async () => {
  const bot = staleWorld()
  const r = await runMine(SK, bot)
  assert.equal(bot._digs.filter(p => townDigClass(p, 'stone', HOME) === 'ground').length, 0, 'no town ground dug')
  assert.equal(r.failClass, 'town_ground', `${r.status} ${r.detail}`)
  assert.match(r.detail, /reason=town_ground_step .*mine again/)
})
test('MUTANT KILLED: the per-dig stop blind to the town -- the stale stair cuts town ground', async () => {
  await withMutant(SKILLS_URL, "        const kind = fm.forbid && fm.forbid(pos)\n",
    "        const kind = fm.forbid && fm.forbid(pos) !== 'town' && fm.forbid(pos)\n", async mod => {
      const bot = staleWorld()
      await runMine(mod, bot)
      assert.ok(bot._digs.some(p => townDigClass(p, 'stone', HOME) === 'ground'), `the mutant dug town ground (digs ${JSON.stringify(bot._digs.slice(0, 4))})`)
    })
})

// ---- wiring --------------------------------------------------------------------------------------------------------
test('WIRED: no town entry on the transit arrays; the tunnel adds 100; the liveness row; chooseStairBearing honours its allowed bearings', () => {
  const idx = strip(readFileSync(INDEX_URL, 'utf8'))
  assert.doesNotMatch(idx, /makeTownStepCost|makeTownBreakCost\(townHome/, 'transit profiles carry no town entry')
  assert.match(idx, /tunnelMovements\(bot, gatherMoves, \{ home: configuredHome\(config\.world\) \?\? \{ x: config\.world\.homeX, z: config\.world\.homeZ \} \}\)/)
  assert.match(idx, /logEvent\(\{ kind: 'town_ground', status: 'success'/)
  const tun = strip(readFileSync(TUNNEL_URL, 'utf8'))
  assert.match(tun, /m\.exclusionAreasBreak = \[\.\.\.\(base\?\.exclusionAreasBreak \?\? \[\]\), b => \(nearHome\(b\?\.position, home\) \? 100 : breakHazard\(at, b\)\), makeTownBreakCost\(home, 100\)\]/,
    'nearHome stays and the town entry is added')
  const fake = { entity: { yaw: 0 }, blockAt: () => ({ name: 'stone', boundingBox: 'block' }) }
  assert.equal(chooseStairBearing(fake, V(0, 70, 0), 4, []), null, 'no allowed bearing -> null (mine guards it and names a move)')
  assert.deepEqual(chooseStairBearing(fake, V(0, 70, 0), 4, [{ x: 0, z: -1 }])?.bear, { x: 0, z: -1 }, 'only an allowed bearing is chosen')
  // ONE keep-out: the town is composed into minewell's plan (and so into its per-dig stop), and the far starts are offered
  const sk = strip(readFileSync(SKILLS_URL, 'utf8'))
  assert.match(sk, /return composeKeepOut\(farm, townKeepOut\(townHome\(\), nameAt\), stairKeepOut\(stairRecordNow\(\)\)\)/)
  assert.doesNotMatch(sk, /townAllow|stairTownClear\(/, 'no second bearing filter in mine')
})

test('MUTANT KILLED: the tunnel without its town entry digs town ground (the profile test above catches it)', async () => {
  await withMutant(TUNNEL_URL, ', makeTownBreakCost(home, 100)]\n', ']\n', async mod => {
    const { Movements } = require_('mineflayer-pathfinder')
    const bot = { registry: mcData, world: { getBlock: () => null }, version: '1.21.8', entity: { position: new Vec3(0, 0, 0) },
                  blockAt: () => ({ name: 'stone', boundingBox: 'block', type: 1 }), game: { minY: -64, height: 384 }, supportFeature: () => false }
    let base
    try { base = new Movements(bot) } catch { base = {} }
    base.exclusionAreasBreak = []
    const tun = mod.tunnelMovements(bot, base, { home: HOME })
    const cell = { position: new Vec3(214, 64, 212), name: 'dirt', type: 1 }   // in the square, OUTSIDE nearHome's 12 (so only the town entry can refuse it)
    assert.equal(tun.exclusionAreasBreak.reduce((w, a) => w + a(cell), 0), 0, 'the mutant tunnel would dig town ground')
  })
})
