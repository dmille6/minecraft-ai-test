// KEEPOUT-01 x PROTECTZONE-01 (JIT 10-22b): two keep-outs composed into ONE mine plan, and two dig guards stacked on
// bot.dig. The trap class (CLAUDE.md): two individually-correct guards meeting where the bot has no legal move. Behaviour
// only, through the REAL skill functions and the REAL guards as index.mjs stacks them (keepout's guard over the dig, the
// zone's guard over that):
//   1. mine between a fire column (east) and a protected zone (south): no stair cell in either, and a stair is cut on a
//      bearing clear of both (the zone's part and the column's part are one keep-out: one plan, one walk-off);
//      CONTROL: without the zone the same world's stair goes south, INTO the zone's cells -- the zone is what moved it;
//   2. `_keepout_exit` inside a column that is ALSO inside a protected zone, sealed so only the escape dig works: the escape
//      dig runs in keep-out's survival scope, so the zone's guard lets it through and the bot gets out;
//      CONTROL: the same cell dug by gather (a target dig, no scope) is refused by BOTH guards;
//   3. the far starts (the one hand-resolved line): a plan only the column blocked walks to the column's ring even with a
//      zone loaded -- protectzone's `return []` for "no town, no zone among the kinds" would drop it (mutant);
//   4. gather: the nearest dirt in a column, the next in a zone -> the dirt outside both (keep-out's enumeration filter
//      over the zone's findBlocks filter); CONTROL: no zone -> the zone's dirt is the one taken;
//   5. mine's protected-zone refusal never names an exit inside a fire column (Codex jit-1022b P2): the nearest exit is in
//      a column -> the next clear one is named (MUTANT: without the composed check the column's exit is named).
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
process.env.HOME_X = '200'; process.env.HOME_Y = '65'; process.env.HOME_Z = '200'
process.env.LOG_LEVEL = 'error'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const KO = await import('../src/keepout.mjs')
const PZ = await import('../src/protectzone.mjs')
const SK = await import('../src/skills.mjs')
const { digPurpose, currentDigScope } = await import('../src/digtown.mjs')

const fire = (x, y, z) => ({ kind: 'death:fire', x, y, z, count: 4, deaths: 1, last: Date.now(), by: ['hive-b-Echo'] })
const V = (x, y, z) => new Vec3(x, y, z)
const AIR = { name: 'air', boundingBox: 'empty', type: 0 }, STONE = { name: 'stone', boundingBox: 'block', type: 1 }, WATER = { name: 'water', boundingBox: 'empty', type: 2 }
const zonesOf = boxes => PZ.parseZones({ version: 1, zones: boxes.map(([id, box]) => ({ id, kind: 'fixture', label: `the zone ${id}`, box })) }).zones

// keepout.test.mjs's stair world, plus the zones and the two guards stacked as index.mjs stacks them
function stairWorld ({ at = [424, 65, 200], wet = () => false, yaw = 0, sites = [], zones = [], gotoOk = () => true, solidAt = () => false, ctx = { skill: null } } = {}) {
  const carved = new Set(), digs = [], walks = [], koRefused = [], pzRefused = []
  const k = (x, y, z) => `${x},${y},${z}`
  const base = p => carved.has(k(p.x, p.y, p.z)) ? AIR : solidAt(p.x, p.y, p.z) ? STONE : wet(p.x, p.y, p.z) ? WATER : p.y < 65 ? STONE : AIR
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
        const to = V(goal.x, Math.floor(goal.y ?? bot.entity.position.y), goal.z)
        walks.push({ to, scope: bot.keepoutRoute?.skill ?? null })
        if (!gotoOk(to, bot)) return
        if (base(to).boundingBox === 'block' || base(to.offset(0, 1, 0)).boundingBox === 'block') return
        bot.entity.position = to; bot.entity.yaw += 0.9
      },
    },
    setControlState () {}, clearControlStates () {}, lookAt: async () => {}, registry: { blocksByName: {}, itemsByName: {} }, players: {}, entities: {},
    fireSitesNow: () => sites,
    protectZones: () => zones,
    _digs: digs, _walks: walks, _koRefused: koRefused, _pzRefused: pzRefused,
  }
  // index.mjs: keepout's guard wraps bot.dig (purposeOf = guardPurpose over digPurpose), then the zone's guard wraps that
  bot.dig = KO.keepoutDigGuard(bot.dig, {
    sitesNow: () => sites,
    purposeOf: () => { const scope = currentDigScope(); return KO.guardPurpose({ skill: ctx.skill, scope, base: digPurpose({ scope, skill: ctx.skill, args: null }).purpose }) },
    onRefuse: () => koRefused.push(1),
  })
  PZ.attachProtectZone(bot, { zones: () => zones, context: () => ({ skill: ctx.skill, args: null, reflex: null, holder: null }), onRefuse: r => pzRefused.push(r) })
  return bot
}
const runMine = (bot, y = 40) => SK.SKILLS.mine.run({ bot }, { y }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
const runExit = bot => SK.SKILLS.keepout_exit.run({ bot }, {}, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))

// the site at (440, 52, 200): its column is x 434..446 at y 52..64 -- a +x stair from (424, 65) meets it at x 434, y 56
const SITE_M = fire(440, 52, 200)
// the zone: south of the bot (z 201..260, x 380..433: short of the column), every y the stair could reach
const ZONE_W = zonesOf([['south', [380, 0, 201, 433, 90, 260]]])
const inZone = p => !!PZ.zoneAt(ZONE_W, p.x, p.y, p.z)

test('CONTROL: without the zone, the stair that avoids the column is cut SOUTH (+z) -- into what will be the zone', async () => {
  const bot = stairWorld({ sites: [SITE_M], ctx: { skill: 'mine' } })
  const r = await runMine(bot)
  assert.ok(bot._digs.length > 0, `a stair was cut (${r.status} ${String(r.detail).slice(0, 140)})`)
  assert.equal(bot._digs.filter(p => KO.columnAt([SITE_M], p)).length, 0, 'never the column')
  assert.ok(bot._digs.some(inZone), `some stair cell lies in the zone's box: ${JSON.stringify(bot._digs.slice(0, 4))}`)
})

test('CHAIN mine x protected zone: the column east, the zone south -- one plan, no cell of either dug, a stair cut clear of both', async () => {
  const bot = stairWorld({ sites: [SITE_M], zones: ZONE_W, ctx: { skill: 'mine' } })
  const r = await runMine(bot)
  assert.equal(bot._digs.filter(p => KO.columnAt([SITE_M], p)).length, 0, `dug the column (${r.status} ${String(r.detail).slice(0, 140)})`)
  assert.equal(bot._digs.filter(inZone).length, 0, `dug the zone (${r.status} ${String(r.detail).slice(0, 140)})`)
  assert.equal(bot._pzRefused.length, 0, 'the plan kept the stair out of the zone: the zone guard never had to refuse')
  assert.equal(bot._koRefused.length, 0, 'and out of the column: the keep-out guard never had to refuse')
  assert.ok(bot._digs.length > 0, `a stair was cut (${r.status} ${r.failClass} ${String(r.detail).slice(0, 140)})`)
  assert.ok(bot._digs.every(p => p.z <= 200 && p.x < 434), `on a bearing clear of both (west or north): ${JSON.stringify(bot._digs.slice(0, 4))}`)
})

// THE FAR-START WORLD: the bot's only dry first tread is +x, into the column; no stand within 16 of it (rock at head height
// over x <= 448, but for its own cell); the only stands are past the column (x >= 449), on a dry strip -- so only the
// column's own ring of far starts (keepout-01 lavaFar, ~11 from the site, within 32 of the bot) can give a start
const farWet = (x, y, z) => y <= 64 && y >= 30 && !(Math.abs(z - 200) <= 1 && ((x >= 425 && x <= 433) || x >= 449))
const farRock = (x, y, z) => y >= 66 && y <= 75 && x <= 448 && !(x === 424 && z === 200)
const FAR_ZONE = zonesOf([['far', [0, 0, 0, 10, 90, 10]]])   // a zone loaded, far away: protectzone's far-start branch is live

test('the far starts: a plan only the column blocked still walks to the column\'s ring (a zone loaded, but neither town nor zone among the kinds)', async () => {
  const bot = stairWorld({ sites: [SITE_M], wet: farWet, solidAt: farRock, zones: FAR_ZONE, ctx: { skill: 'mine' } })
  const r = await runMine(bot)
  assert.equal(bot._digs.filter(p => KO.columnAt([SITE_M], p)).length, 0, `dug the column (${r.status} ${String(r.detail).slice(0, 140)})`)
  assert.ok(bot._walks.length >= 1 && bot._walks[0].scope === 'mine' && bot._walks[0].to.x >= 449, `walked off to the ring past the column: ${JSON.stringify(bot._walks.slice(0, 2))} ${r.status} ${String(r.detail).slice(0, 140)}`)
  assert.ok(bot._digs.length > 0, `and cut a stair there (${r.status} ${String(r.detail).slice(0, 140)})`)
})

// ---- a body inside the column AND a protected zone --------------------------------------------------------------------
const SITE_X = fire(440, 60, 200)   // column y 60..72: a bot on the stone floor at y 65 near the centre is inside it
const ZONE_X = zonesOf([['over', [420, 0, 180, 460, 90, 220]]])   // the zone covers the column and well beyond it
const sealed = (x, y, z) => y >= 65 && y <= 66 && !(x === 441 && z === 200)

test('CHAIN exit inside a column inside a zone, sealed: the escape dig is survival for BOTH guards -- the bot digs out', async () => {
  const ctx = { skill: 'keepout_exit' }
  const bot = stairWorld({ at: [441, 65, 200], sites: [SITE_X], zones: ZONE_X, solidAt: sealed, ctx,
                           gotoOk: (to, b) => Math.hypot(to.x - b.entity.position.x, to.z - b.entity.position.z) < 1.6 })
  assert.ok(KO.columnAt([SITE_X], bot.entity.position) && PZ.zoneAt(ZONE_X, 441, 65, 200), 'inside both')
  const r = await runExit(bot)
  assert.equal(r.status, 'success', JSON.stringify(r))
  assert.equal(KO.columnAt([SITE_X], bot.entity.position), null, `outside the column: ${bot.entity.position}`)
  assert.ok(bot._digs.length > 0 && bot._digs.every(p => PZ.zoneAt(ZONE_X, p.x, p.y, p.z)), 'it dug, and every dig was a zone cell')
  assert.equal(bot._pzRefused.length, 0, 'the zone guard let the escape dig through (survival)')
  assert.equal(bot._koRefused.length, 0)
})

test('CONTROL: gather\'s target digs (no scope): a column cell is refused by keep-out, a zone cell by the zone, a cell in both by the zone (the OUTER guard, as index.mjs stacks them); none is sent', async () => {
  const ctx = { skill: 'gather' }
  const half = zonesOf([['half', [443, 0, 180, 460, 90, 220]]])   // covers the column's east edge and beyond
  const bot = stairWorld({ at: [441, 65, 200], sites: [SITE_X], zones: half, solidAt: sealed, ctx })
  await assert.rejects(bot.dig(bot.blockAt(V(436, 65, 200))))   // the column only
  assert.deepEqual([bot._koRefused.length, bot._pzRefused.length], [1, 0], 'keep-out refused it')
  await assert.rejects(bot.dig(bot.blockAt(V(455, 65, 200))))   // the zone only
  assert.deepEqual([bot._koRefused.length, bot._pzRefused.length], [1, 1], 'the zone refused it')
  await assert.rejects(bot.dig(bot.blockAt(V(444, 65, 200))))   // both
  assert.deepEqual([bot._koRefused.length, bot._pzRefused.length], [1, 2], 'the zone (outer) refused it')
  assert.equal(bot._digs.length, 0, 'never sent')
  // POSITIVE CONTROL: a cell in neither is dug
  await bot.dig(bot.blockAt(V(470, 65, 200)))
  assert.equal(bot._digs.length, 1)
})

// ---- gather: keep-out's enumeration filter over the zone's findBlocks filter ------------------------------------------
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
// keepout.test.mjs's gather world, with the zone guard attached (its findBlocks filter and its dig refusal)
function gatherWorld ({ dirt, at = [400.5, 64, 200.5], sites = [], zones = [] }) {
  const D = mcData.blocksByName.dirt, AIRT = mcData.blocksByName.air
  const set = new Set(dirt.map(([x, y, z]) => `${x},${y},${z}`))
  // CAVEFALL-01: the dirt lies on rock -- a dirt cell floating over 32+ blocks of air is, correctly, a floor over a drop
  const rock = new Set(dirt.map(([x, y, z]) => `${x},${y - 1},${z}`))
  const digs = [], refused = []
  const blk = (x, y, z) => {
    const isDirt = set.has(`${x},${y},${z}`)
    const isRock = !isDirt && rock.has(`${x},${y},${z}`)
    const t = isDirt ? D : isRock ? mcData.blocksByName.stone : AIRT
    return { name: t.name, type: t.id, position: new Vec3(x, y, z), boundingBox: (isDirt || isRock) ? 'block' : 'empty', diggable: isDirt,
             canHarvest: () => true, digTime: () => 50, material: 'mineable/shovel', hardness: isDirt ? 0.5 : 0 }
  }
  const bot = {
    entity: { position: new Vec3(...at), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20,
    inventory: { items: () => [], emptySlotCount: () => 30 },
    registry: { blocksByName: mcData.blocksByName, blocks: mcData.blocks, itemsByName: mcData.itemsByName },
    blockAt: p => blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && (Array.isArray(matching) ? matching.includes(b.type) : b.type === matching))
      if (!fn({ type: D.id, name: 'dirt' })) return []
      return dirt.map(([x, y, z]) => blk(x, y, z)).filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance && fn(b))
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, count).map(b => b.position)
    },
    collectBlock: { movements: {} },
    pathfinder: { movements: {}, setMovements () {}, setGoal () {}, stop () {}, isMining: () => false, async goto () {} },
    nearestEntity: () => null, entities: {},
    async dig (b) { digs.push(b.position); set.delete(`${b.position.x},${b.position.y},${b.position.z}`) },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
    fireSitesNow: () => sites,
    protectZones: () => zones,
  }
  PZ.attachProtectZone(bot, { zones: () => zones, context: () => ({ skill: 'gather', args: null, reflex: null, holder: null }), onRefuse: r => refused.push(r) })
  return { bot, digs, refused }
}
// the site at (410, 55, 200): its column covers x 404..416 at y 63; dirt in it 4-8 east, dirt in a zone 10 west, dirt beyond
const SITE_G = fire(410, 55, 200)
const inCol = [[405, 63, 200], [406, 63, 200], [407, 63, 200]]
const inZoneG = [[390, 63, 200], [389, 63, 200], [390, 63, 201]]
const beyond = [[400, 63, 215], [401, 63, 215]]
const ZONE_G = zonesOf([['westg', [380, 0, 190, 395, 90, 210]]])

test('CHAIN gather: the nearest dirt in a fire column, the next in a zone -- the dirt outside both is the one dug; CONTROL: no zone -> the zone\'s dirt', async () => {
  const runG = bot => SK.SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
  const base = gatherWorld({ dirt: [...inCol, ...inZoneG, ...beyond], sites: [SITE_G] })
  const r0 = await runG(base.bot)
  assert.ok(base.digs.length > 0 && base.digs.every(p => p.x <= 395 && p.x >= 380), `CONTROL: keep-out alone takes the dirt west (${JSON.stringify(base.digs)}, ${JSON.stringify(r0).slice(0, 120)})`)
  const w = gatherWorld({ dirt: [...inCol, ...inZoneG, ...beyond], sites: [SITE_G], zones: ZONE_G })
  const r = await runG(w.bot)
  assert.equal(w.digs.filter(p => KO.columnAt([SITE_G], p)).length, 0, 'never the column')
  assert.equal(w.digs.filter(p => PZ.zoneAt(ZONE_G, p.x, p.y, p.z)).length, 0, 'never the zone')
  assert.ok(w.digs.length > 0 && w.digs.every(p => p.z === 215), `the dirt beyond both was taken (${JSON.stringify(w.digs)}, ${JSON.stringify(r).slice(0, 160)})`)
  assert.equal(w.refused.length, 0, 'enumeration kept the zone out: the guard never had to refuse')
})

// ---- mine's zone refusal: the exit it names is clear of the column too (Codex jit-1022b P2) ---------------------------
// the bot inside the zone [420..460] x [180..220]; every stand rock-roofed but two exit columns: 464,200 (the zone's nearest
// exit, inside the column of a fire site at 464,60,200) and 440,176 (outside every keep-out, standable, but ringed by water
// at tread height, so the planner cannot START a stair there and mine refuses -- the refusal names it as the walk out)
const SITE_E = fire(464, 60, 200)
const exitRock = (x, y, z) => y >= 66 && y <= 75 && !(x === 441 && z === 200) && !(x === 464 && z === 200) && !(x === 440 && z === 176)
const exitWet = (x, y, z) => y >= 58 && y <= 64 && Math.abs(x - 440) <= 3 && Math.abs(z - 176) <= 3 && !(x === 440 && z === 176)
const gotoIn = d => { const m = /goto (-?\d+) (-?\d+) (-?\d+)/.exec(String(d)); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null }

test('CHAIN mine x zone refusal: the zone\'s nearest exit is inside a fire column -> the refusal names the next exit, clear of both', async () => {
  const bot = stairWorld({ at: [441, 65, 200], sites: [SITE_E], zones: ZONE_X, solidAt: exitRock, wet: exitWet, ctx: { skill: 'mine' } })
  assert.deepEqual(PZ.zoneExitColumns(ZONE_X, bot.entity.position)[0], { x: 464, z: 200 }, 'the nearest exit is the column\'s')
  const r = await runMine(bot)
  assert.equal(r.failClass, 'protected_zone', `${r.status} ${r.failClass} ${String(r.detail).slice(0, 200)}`)
  assert.equal(bot._digs.length, 0)
  const g = gotoIn(r.detail)
  assert.ok(g, `an exit is named: ${r.detail}`)
  assert.deepEqual(g, { x: 440, y: 65, z: 176 }, `the clear exit: ${r.detail}`)
  assert.equal(KO.columnAt([SITE_E], { x: g.x + 0.5, y: g.y, z: g.z + 0.5 }), null)
})

// ---- mutants: each composed assertion fails for the intended reason (anchors present and unique) -----------------------
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY (ANCHOR MISSING): ${JSON.stringify(old.slice(0, 80))}`)
  assert.equal(src.split(old).length, 2, `the mutation target is not unique: ${JSON.stringify(old.slice(0, 80))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)

test('MUTANT KILLED: the escape dig outside keep-out\'s survival scope is refused by the ZONE guard, and the bot stays in', async () => {
  await withMutant(SKILLS_URL, "withDigScope(ctx?.bot, { purpose: 'survival', by: 'keepout_exit' }", "withDigScope(ctx?.bot, { purpose: 'target', by: 'keepout_exit' }", async mod => {
    const bot = stairWorld({ at: [441, 65, 200], sites: [SITE_X], zones: ZONE_X, solidAt: sealed, ctx: { skill: 'keepout_exit' },
                             gotoOk: (to, b) => Math.hypot(to.x - b.entity.position.x, to.z - b.entity.position.z) < 1.6 })
    const r = await mod.SKILLS.keepout_exit.run({ bot }, {}, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
    assert.notEqual(r.status, 'success', `the mutant got out: ${JSON.stringify(r).slice(0, 160)}`)
    assert.ok(bot._pzRefused.length > 0, 'the zone guard (outer) refused the escape dig')
    assert.equal(bot._digs.length, 0)
  })
})

test('MUTANT KILLED: the far starts dropping the column ring when no town or zone blocked (protectzone\'s own line) -- no walk, no stair', async () => {
  const ring = "if (!kinds.includes('town') && !kinds.includes('protected')) return lavaFar"
  await withMutant(SKILLS_URL, ring, "if (!kinds.includes('town') && !kinds.includes('protected')) return []", async mod => {
    const bot = stairWorld({ sites: [SITE_M], wet: farWet, solidAt: farRock, zones: FAR_ZONE, ctx: { skill: 'mine' } })
    const r = await mod.SKILLS.mine.run({ bot }, { y: 40 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
    assert.equal(bot._digs.filter(p => KO.columnAt([SITE_M], p)).length, 0, 'the column is still never dug')
    assert.equal(bot._digs.length, 0, `the mutant cut no stair (${r.status} ${r.failClass} ${String(r.detail).slice(0, 140)})`)
    assert.equal(r.failClass, 'keepout', 'it refuses instead')
  })
})

test('MUTANT KILLED: without the composed check on the exit, the zone refusal names the stand inside the fire column', async () => {
  await withMutant(SKILLS_URL, '.find(c => c && !exitForbidden(c))', '.find(Boolean)', async mod => {
    const bot = stairWorld({ at: [441, 65, 200], sites: [SITE_E], zones: ZONE_X, solidAt: exitRock, wet: exitWet, ctx: { skill: 'mine' } })
    const r = await mod.SKILLS.mine.run({ bot }, { y: 40 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
    const g = gotoIn(r.detail)
    assert.ok(g && KO.columnAt([SITE_E], { x: g.x + 0.5, y: g.y, z: g.z + 0.5 }), `the mutant names the column's exit: ${r.failClass} ${r.detail}`)
  })
})
