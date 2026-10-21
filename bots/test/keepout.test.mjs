// KEEPOUT-01 -- no dig in the column above a live fire death site (keepout.mjs; skills.mjs gather/mine/keepout_exit;
// index.mjs dig guard + route; cognitive.mjs the exit order; admission.mjs the cooldown; worldfacts.mjs the dispute).
// Design: docs/reports/comms-design-2026-10-21.md 2.3, 4.2, 4.5, 4.6, 8 row 2, 9 C3/C12.
//
// The trap class (CLAUDE.md): two individually-correct guards meeting where the bot has no legal move. So the tests drive
// the REAL skill functions through the refusal CHAIN -- a gatherer whose nearest dirt is in a column, a gatherer whose only
// dirt is, a miner whose stair would meet a column 9 blocks down, a miner standing over the column, a bot already inside a
// column with a walk out and one sealed on a ledge -- and assert that every refusal names a move the bot can make, and that
// the move works. Each mutant asserts its anchor present and unique and fails for the intended reason.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
process.env.HOME_X = '200'; process.env.HOME_Y = '65'; process.env.HOME_Z = '200'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const KO = await import('../src/keepout.mjs')
const SK = await import('../src/skills.mjs')
const { SKILLS } = SK
const { tapRecords } = await import('../src/logger.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { WorldFacts } = await import('../src/worldfacts.mjs')
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)
const KO_URL = new URL('../src/keepout.mjs', import.meta.url)
const INDEX_URL = new URL('../src/index.mjs', import.meta.url)
const COG_URL = new URL('../src/cognitive.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

async function withMutantsAll (url, pairs, fn) {
  let src = readFileSync(url, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY (ANCHOR MISSING): ${JSON.stringify(old.slice(0, 80))}`)
    assert.ok(src.split(old).length === 2, `the mutation target is not unique: ${JSON.stringify(old.slice(0, 80))}`)
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const fire = (x, y, z, extra = {}) => ({ kind: 'death:fire', x, y, z, count: 4, deaths: 1, last: Date.now(), by: ['hive-b-Echo'], ...extra })

// ---- the pure rules -------------------------------------------------------------------------------------------------
test('the column: a 6-block disc from the site y up to y + 12 (and nothing below it)', () => {
  const s = fire(100, 40, 100)
  assert.equal(KO.inColumn(s, { x: 100, y: 40, z: 100 }), true)
  assert.equal(KO.inColumn(s, { x: 106, y: 52, z: 100 }), true, 'the rim at the top')
  assert.equal(KO.inColumn(s, { x: 106, y: 53, z: 100 }), false, 'above the top')
  assert.equal(KO.inColumn(s, { x: 100, y: 39, z: 100 }), false, 'below the site')
  assert.equal(KO.inColumn(s, { x: 105, y: 45, z: 104 }), false, 'outside the disc (41 > 36)')
  assert.equal(KO.inColumn(s, { x: 104, y: 45, z: 104 }), true, '32 <= 36')
  assert.equal(KO.columnAt([fire(0, 40, 0), s], { x: 101.7, y: 44.2, z: 99.1 }), s, 'cells are floored')
})
test('only live, undisputed FIRE sites keep bots out (water is terrain)', () => {
  const live = fire(1, 40, 1), old = fire(2, 40, 2, { last: Date.now() - 37 * 3600e3 }), disputed = fire(3, 40, 3, { disputed: { at: 1 } })
  const drown = { ...fire(4, 40, 4), kind: 'death:drowning' }, fall = { ...fire(5, 40, 5), kind: 'death:fall' }
  assert.deepEqual(KO.fireSites([live, old, disputed, drown, fall, null]), [live], 'positive control: the live fire site is kept')
})
test('THE OWNER DECISION: KEEPOUT_TOWN_YIELD is on (C12, 2026-10-22 "yes"); the env flips it', () => {
  assert.equal(KO.KEEPOUT_TOWN_YIELD, true)
  assert.equal(KO.townYieldOn({}), true)
  assert.equal(KO.townYieldOn({ KEEPOUT_TOWN_YIELD: '0' }), false)
  assert.equal(KO.keepoutOn({}), true); assert.equal(KO.keepoutOn({ KEEPOUT: '0' }), false)
  assert.match(KO.keepoutModeDetail({}), /^phase=mode keepout=on radius=6 height=12 trigger=fire_site_live search=32 cooldown_min=10 town_yield=on$/)
})
test('the column-free route: outside, never in; inside, only outward; never into another column', () => {
  const a = fire(100, 40, 100), b = fire(112, 40, 100)
  assert.equal(KO.routeForbids([a], { x: 90.5, y: 45, z: 100.5 }, { x: 95, y: 45, z: 100 }), true, 'from outside: a column cell is never stepped on')
  assert.equal(KO.routeForbids([a], { x: 90.5, y: 45, z: 100.5 }, { x: 93, y: 45, z: 100 }), false, 'positive control: a cell outside is fine')
  const inside = { x: 102.5, y: 45, z: 100.5 }
  assert.equal(KO.routeForbids([a], inside, { x: 104, y: 45, z: 100 }), false, 'inside: a step outward is allowed')
  assert.equal(KO.routeForbids([a], inside, { x: 101, y: 45, z: 100 }), true, 'inside: a step toward the centre is not')
  assert.equal(KO.routeForbids([a, b], { x: 105.5, y: 45, z: 100.5 }, { x: 107, y: 45, z: 100 }), true, 'never into another column')
})
test('the outward walk\'s targets are outside every column, nearest first', () => {
  const s = fire(100, 40, 100)
  const t = KO.exitTargets([s], { x: 101.5, y: 45, z: 100.5 }, () => true)
  assert.ok(t.length > 0)
  assert.ok(t.every(c => !KO.columnAt([s], c)), 'none inside')
  assert.ok(Math.hypot(t[0].x - 100, t[0].z - 100) > 6 && Math.hypot(t[0].x - 100, t[0].z - 100) < 8, `nearest just outside: ${JSON.stringify(t[0])}`)
  assert.deepEqual(KO.exitTargets([s], { x: 101.5, y: 45, z: 100.5 }, () => false), [], 'no stand -> none (the escape step follows)')
})
test('the exit decision: inside starts it; a yielded town column stands down for town jobs and home (C12); backoff holds it', () => {
  const s = fire(100, 60, 100), sites = [s], pos = { x: 101.5, y: 65, z: 100.5 }, home = { x: 102, y: 65, z: 100 }
  assert.deepEqual(KO.exitDecision({ sites, pos: { x: 120, y: 65, z: 100 } }).start, false, 'outside: nothing to leave')
  assert.equal(KO.exitDecision({ sites, pos }).start, true, 'inside: leave first')
  const y = { sites, pos, home, yielded: () => true }
  assert.equal(KO.exitDecision({ ...y, skill: 'town_deposit' }).why, 'town_job')
  assert.equal(KO.exitDecision({ ...y, skill: 'gather' }).why, 'home', 'at home inside a yielded column: no push-out')
  assert.equal(KO.exitDecision({ ...y, skill: 'gather', pos: { x: 97.5, y: 65, z: 96.5 } }).start, true, 'a yielded column still pushes out a non-town job away from home')
  assert.equal(KO.exitDecision({ ...y, skill: 'town_deposit', yieldOn: false }).start, true, 'C12 off: the exit starts even on a town job')
  assert.equal(KO.exitDecision({ sites, pos, backoffUntil: Date.now() + 1000 }).why, 'backoff')
})
test('coversTown: home or a chest / furnace in the column yields; bare ground does not', () => {
  const s = fire(100, 60, 100)
  assert.equal(KO.coversTown(s, { home: { x: 120, y: 65, z: 100 }, nameAt: () => 'stone' }).yields, false, 'positive control: nothing to cover')
  assert.equal(KO.coversTown(s, { home: { x: 103, y: 65, z: 100 } }).home, true)
  const r = KO.coversTown(s, { home: null, nameAt: (x, y, z) => (x === 101 && y === 64 && z === 100 ? 'chest' : x === 99 && y === 66 && z === 100 ? 'furnace' : 'air') })
  assert.deepEqual([r.yields, r.containers, r.furnaces], [true, 1, 1])
})
test('the cooldown: (skill, block) near the column for 10 min, nothing else', () => {
  const s = fire(100, 60, 100), now = Date.now()
  const e = KO.addCooldown([], { skill: 'gather', block: 'dirt', site: s, now })
  assert.ok(KO.cooldownHit(e, { skill: 'gather', block: 'dirt', pos: { x: 120, y: 65, z: 100 }, now }), 'within 32 + 6')
  assert.equal(KO.cooldownHit(e, { skill: 'gather', block: 'dirt', pos: { x: 150, y: 65, z: 100 }, now }), null, 'far away: free')
  assert.equal(KO.cooldownHit(e, { skill: 'gather', block: 'sand', pos: { x: 110, y: 65, z: 100 }, now }), null, 'another block: free')
  assert.equal(KO.cooldownHit(e, { skill: 'gather', block: 'dirt', pos: { x: 110, y: 65, z: 100 }, now: now + KO.KEEPOUT_COOLDOWN_MS + 1 }), null, 'expired')
  assert.equal(KO.addCooldown(e, { skill: 'gather', block: 'dirt', site: s, now }).length, 1, 'a repeat replaces, never stacks')
})
test('the lava read: lava -> lava, all air -> clear, any unloaded cell -> unloaded (unknown is never gone)', () => {
  const s = fire(100, 60, 100)
  assert.equal(KO.disputeScan(s, () => 'air'), 'clear')
  assert.equal(KO.disputeScan(s, (x, y, z) => (x === 103 && y === 58 && z === 100 ? 'lava' : 'air')), 'lava')
  assert.equal(KO.disputeScan(s, (x, y, z) => (x === 103 && y === 58 && z === 100 ? null : 'air')), 'unloaded')
})
test('scopeHolds: a reflex taking the body, or another holder, switches the route veto off', () => {
  const kr = { runSkill: 'gather', sites: [fire(1, 1, 1)] }
  assert.equal(KO.scopeHolds(kr, { holder: 'gather' }), true)
  assert.equal(KO.scopeHolds(kr, { holder: 'gather', reflex: 'drowning' }), false)
  assert.equal(KO.scopeHolds(kr, { holder: 'air_rescue' }), false)
  assert.equal(KO.scopeHolds(kr, { holder: 'air_rescue', arbiter: false }), true)
  assert.equal(KO.scopeHolds(null, {}), false)
})

// ---- the dig guard (index.mjs wraps bot.dig with it) ------------------------------------------------------------------
test('THE DIG GUARD: a target dig in a column is refused and never sent; survival, transit and outside digs pass', async () => {
  const s = fire(100, 60, 100), sent = []
  let purpose = 'target'
  const dig = KO.keepoutDigGuard(async b => { sent.push(b.position) }, { sitesNow: () => [s], purposeOf: () => purpose })
  const blk = (x, y, z) => ({ name: 'dirt', position: new Vec3(x, y, z) })
  await assert.rejects(dig(blk(101, 63, 100)), e => e.failClass === 'keepout' && /marked lava pool/.test(e.message))
  assert.deepEqual(sent, [], 'not sent')
  await dig(blk(120, 63, 100)); assert.equal(sent.length, 1, 'positive control: outside the column it digs')
  for (purpose of ['survival', 'transit', 'lid', 'other']) await dig(blk(101, 63, 100))
  assert.equal(sent.length, 5, 'survival / transit / lid / other digs pass in the column')
})
test('MUTANT KILLED: a guard without the purpose test refuses the escape digs (a bot inside could never dig out)', async () => {
  await withMutantsAll(KO_URL, [["if (site && purposeOf?.() === 'target') {", 'if (site) {']], async mod => {
    const dig = mod.keepoutDigGuard(async () => {}, { sitesNow: () => [fire(100, 60, 100)], purposeOf: () => 'survival' })
    await assert.rejects(dig({ name: 'stone', position: new Vec3(101, 63, 100) }))
  })
})

// ---- the refusal chain: gather ----------------------------------------------------------------------------------------
function gatherWorld ({ dirt, at = [400.5, 64, 200.5], sites = [], onGoto = null }) {
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
    pathfinder: { movements: {}, setMovements () {}, setGoal () {}, stop () {}, isMining: () => false, async goto (g) { onGoto?.(bot, g) } },
    nearestEntity: () => null, entities: {},
    async dig (b) { digs.push(b.position); set.delete(`${b.position.x},${b.position.y},${b.position.z}`) },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
    fireSitesNow: () => sites,
  }
  return { bot, digs }
}
// the site at (410, 55, 200): its column covers x 404..416 at y 63; five dirt cells inside it 4-8 blocks east, three outside 10 west
const SITE_G = fire(410, 55, 200)
const inCol = [[405, 63, 200], [406, 63, 200], [407, 63, 200], [408, 63, 201], [409, 63, 199]]
const outCol = [[390, 63, 200], [389, 63, 200], [390, 63, 201]]

test('CHAIN gather: the nearest dirt is above the marked lava pool -- the search reaches the dirt outside, nothing in the column is dug', async () => {
  const seen = []
  const { bot, digs } = gatherWorld({ dirt: [...inCol, ...outCol], sites: [SITE_G], onGoto: b => seen.push(b.keepoutRoute ? b.keepoutRoute.skill : null) })
  const r = await SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
  for (const p of digs) assert.equal(KO.columnAt([SITE_G], p), null, `dug ${p} inside the column`)
  assert.ok(digs.some(p => p.x <= 390), `the dirt outside was the one taken (digs ${JSON.stringify(digs)}, ${JSON.stringify(r).slice(0, 160)})`)
  assert.ok(bot.keepoutStats?.gather_skipped >= 5, 'the skipped candidates are counted (unique) for the liveness row')
  assert.equal(bot.keepoutRoute ?? null, null, 'the keep-out scope is cleared after the run')
})
test('CHAIN gather: only dirt in the column -> no dig, failClass keepout, the remedy named, the 10-min cooldown charged; admission then refuses it here', async () => {
  const { bot, digs } = gatherWorld({ dirt: inCol, sites: [SITE_G] })
  const r = await SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal)
  assert.equal(digs.length, 0)
  assert.equal(r.failClass, 'keepout')
  assert.match(r.detail, /no safe candidate within 32.*gather dirt 32\+ blocks from it -- this gather is suppressed here for 10 min/)
  assert.equal(bot.keepoutCooldowns?.length, 1)
  const gate = new AdmissionControl(null)
  const near = gate.check({ skill: 'gather', args: { block: 'dirt', count: 4 } }, bot)
  assert.equal(near.reason, 'keepout_cooldown', `refused near the column: ${JSON.stringify(near)}`)
  assert.match(near.detail, /walk 32\+ blocks from it, or do something else/)
  bot.entity.position = new Vec3(460.5, 64, 200.5)
  assert.notEqual(gate.check({ skill: 'gather', args: { block: 'dirt', count: 4 } }, bot).reason, 'keepout_cooldown', 'positive control: 50 blocks away it is not')
  bot.entity.position = new Vec3(400.5, 64, 200.5)
  assert.notEqual(gate.check({ skill: 'gather', args: { block: 'sand', count: 4 } }, bot).reason, 'keepout_cooldown', 'another block is a different decision')
})
test('CHAIN gather: no fire site near -> exactly the base (no scope, no counters)', async () => {
  const { bot, digs } = gatherWorld({ dirt: inCol, sites: [] })
  await SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(() => null)
  assert.ok(digs.length > 0, 'positive control: without a site the same dirt is dug')
  assert.equal(bot.keepoutStats, undefined)
})
const ENUM_KO = ["      if (ko && b.position) { const site = columnAt(ko.sites, b.position); if (site) {", "      if (false) { const site = columnAt(ko.sites, b.position); if (site) {"]
const SAFE_KO = ['      !(ko && columnAt(ko.sites, p)) &&   // keepout-01', '      true &&   // keepout-01']
test('LAYERS: without the enumeration filter the target conjunction still refuses; without both, the column IS dug (the harness can see it)', async () => {
  await withMutantsAll(SKILLS_URL, [ENUM_KO], async mod => {
    const { bot, digs } = gatherWorld({ dirt: inCol, sites: [SITE_G] })
    await mod.SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(() => null)
    assert.equal(digs.length, 0, 'the target conjunction holds on its own')
  })
  await withMutantsAll(SKILLS_URL, [ENUM_KO, SAFE_KO], async mod => {
    const { bot, digs } = gatherWorld({ dirt: inCol, sites: [SITE_G] })
    await mod.SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(() => null)
    assert.ok(digs.some(p => KO.columnAt([SITE_G], p)), 'positive control: with both layers gone a column cell is dug (in production the dig guard is the third layer)')
  })
})
test('MUTANT KILLED: without the cooldown the refused gather is admitted again at once', async () => {
  await withMutantsAll(SKILLS_URL, [["    keepoutCooldown(bot, 'gather', args?.block ?? null, site)\n", '']], async mod => {
    const { bot } = gatherWorld({ dirt: inCol, sites: [SITE_G] })
    await mod.SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal)
    assert.equal(bot.keepoutCooldowns, undefined)
  })
})

// ---- the refusal chain: mine ------------------------------------------------------------------------------------------
const V = (x, y, z) => new Vec3(x, y, z)
const AIR = { name: 'air', boundingBox: 'empty', type: 0 }, STONE = { name: 'stone', boundingBox: 'block', type: 1 }, WATER = { name: 'water', boundingBox: 'empty', type: 2 }
function stairWorld ({ at = [424, 65, 200], wet = () => false, yaw = 0, sites = [], gotoOk = () => true, solidAt = () => false } = {}) {
  const carved = new Set(), digs = [], walks = []
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
    _digs: digs, _walks: walks,
  }
  return bot
}
const runMine = (mod, bot, y = 40) => mod.SKILLS.mine.run({ bot }, { y }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
// the site at (440, 52, 200): its column is x 434..446 at y 52..64 -- a +x stair from (424, 65) meets it at x 434, y 56
const SITE_M = fire(440, 52, 200)
const onlyEast = (x, y, z) => !(Math.abs(z - 200) <= 1 && x > 424) && y <= 64 && y >= 30   // water everywhere but a 3-wide +x corridor
// a pocket: rock from y 66 to 75 everywhere but the bot's own column, so no stand within 8 up or down is open (no walk-off)
const pocket = (x, y, z) => y >= 66 && y <= 75 && !(x === 424 && z === 200)

test('CHAIN mine (mid-staircase): the stair that would meet the column 9 blocks down is refused AT PLANNING; another bearing is cut', async () => {
  const rows = []; const untap = tapRecords(r => rows.push(r))
  try {
    const bot = stairWorld({ sites: [SITE_M] })
    const r = await runMine(SK, bot)
    assert.equal(bot._digs.filter(p => KO.columnAt([SITE_M], p)).length, 0, `dug the column: ${r.status} ${String(r.detail).slice(0, 120)}`)
    assert.ok(bot._digs.length > 0, `a stair was cut (${r.status} ${String(r.detail).slice(0, 120)})`)
    assert.ok(bot._digs.every(p => p.x < 434 || Math.abs(p.z - 200) > 6), 'never toward the pool')
    const plan = rows.find(x => x.skill?.name === '_mine_plan'), dug = rows.find(x => x.skill?.name === '_mine_dig')
    assert.ok(plan && dug, 'the canary rows were written')
    assert.equal(plan.skill.args.in_column, 0); assert.ok(plan.skill.args.n > 0)
    assert.equal(dug.skill.args.in_column, 0); assert.equal(dug.skill.args.n, bot._digs.length, '_mine_dig lists every stair dig')
    assert.equal(plan.skill.args.sites, '440,52,200')
  } finally { untap() }
})
test('CHAIN mine: the only dry stair runs into the column and no start within 32 has one -> no dig, failClass keepout, remedy, cooldown', async () => {
  const bot = stairWorld({ sites: [SITE_M], wet: onlyEast, solidAt: pocket })
  const r = await runMine(SK, bot)
  assert.equal(bot._digs.length, 0, `nothing dug (${r.status} ${String(r.detail).slice(0, 160)})`)
  assert.equal(r.failClass, 'keepout')
  assert.match(r.detail, /column above a marked lava pool \(fire death site 440,52,200\).*mine is suppressed here for 10 min; walk 32\+ blocks from the pool, then mine/)
  assert.equal(bot.keepoutCooldowns?.[0]?.skill, 'mine')
  assert.equal(new AdmissionControl(null).check({ skill: 'mine', args: { y: 30 } }, bot).reason, 'keepout_cooldown')
})
test('MUTANT KILLED: without the column in mine\'s composed keep-out the stair digs into it (positive control for the chain above)', async () => {
  await withMutantsAll(SKILLS_URL, [["  const farmNow = () => composeKeepOut(farmTown(), ko ? keepOutPart(ko.sites) : { forbid: null, bottom: null })", '  const farmNow = () => farmTown()']], async mod => {
    const bot = stairWorld({ sites: [SITE_M], wet: onlyEast, solidAt: pocket })
    await runMine(mod, bot)
    assert.ok(bot._digs.some(p => KO.columnAt([SITE_M], p)), 'the mutant cut the column')
  })
})
test('CHAIN mine: standing over the column, every stair would cut it -> a walk-off (column-free route), then a stair outside', async () => {
  const bot = stairWorld({ at: [440, 65, 200], sites: [SITE_M] })
  const r = await runMine(SK, bot)
  assert.equal(bot._digs.filter(p => KO.columnAt([SITE_M], p)).length, 0, `dug the column (${r.status} ${String(r.detail).slice(0, 140)})`)
  assert.ok(bot._walks.length >= 1 && bot._walks[0].scope === 'mine', `walked off inside the keep-out scope: ${JSON.stringify(bot._walks.slice(0, 2))}`)
  assert.ok(bot._digs.length > 0, `and cut a stair outside (${r.status} ${String(r.detail).slice(0, 140)})`)
  assert.ok(bot.keepoutStats?.mine_walkout >= 1)
})
test('CHAIN mine x town ground: a column beside the town -- one plan satisfies both keep-outs, nothing of either is dug', async () => {
  const s = fire(222, 50, 200)   // the column x 216..228 beside the town's square (x <= 216)
  const bot = stairWorld({ at: [214, 65, 200], sites: [s] })
  const r = await runMine(SK, bot)
  const { townDigClass } = await import('../src/townground.mjs')
  assert.equal(bot._digs.filter(p => KO.columnAt([s], p)).length, 0, 'no column cell')
  assert.equal(bot._digs.filter(p => townDigClass(p, 'stone', { x: 200, y: 65, z: 200 }) === 'ground').length, 0, 'no town ground')
  assert.ok(bot._digs.length > 0 || ['keepout', 'town_ground'].includes(r.failClass), `a stair, or a refusal naming a remedy (${r.status} ${r.failClass} ${String(r.detail).slice(0, 140)})`)
  if (!bot._digs.length) assert.match(r.detail, /goto|walk/)
})

// ---- a body inside the column -----------------------------------------------------------------------------------------
const SITE_X = fire(440, 60, 200)   // column y 60..72: a bot on the stone floor at y 65 near the centre is inside it
const runExit = (mod, bot) => mod.SKILLS.keepout_exit.run({ bot }, {}, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
test('CHAIN exit: inside the column with a walk out -> it walks out (outward only, in the scope) and says out', async () => {
  const rows = []; const untap = tapRecords(r => rows.push(r))
  try {
    const bot = stairWorld({ at: [441, 65, 200], sites: [SITE_X] })
    const r = await runExit(SK, bot)
    assert.equal(r.status, 'success', JSON.stringify(r))
    assert.equal(KO.columnAt([SITE_X], bot.entity.position), null, `outside now: ${bot.entity.position}`)
    assert.equal(bot._walks[0].scope, 'keepout_exit')
    assert.equal(bot._digs.length, 0, 'a walk, no dig')
    assert.match(rows.find(x => x.skill?.name === '_keepout_exit')?.skill?.detail ?? '', /^outcome=out method=walk site=440,60,200 /)
  } finally { untap() }
})
test('CHAIN exit (the sealed ledge, Bravo\'s case): no walk works -> the escape dig at foot level away from the centre, out', async () => {
  // sealed in rock at feet and head height (no stand to walk to), only one-block steps succeed: the escape dig
  const sealed = (x, y, z) => y >= 65 && y <= 66 && !(x === 441 && z === 200)
  const bot = stairWorld({ at: [441, 65, 200], sites: [SITE_X], solidAt: sealed, gotoOk: (to, b) => Math.hypot(to.x - b.entity.position.x, to.z - b.entity.position.z) < 1.6 })
  const d0 = Math.hypot(441 - 440, 200 - 200)
  const r = await runExit(SK, bot)
  assert.equal(r.status, 'success', JSON.stringify(r))
  assert.equal(KO.columnAt([SITE_X], bot.entity.position), null, `outside: ${bot.entity.position}`)
  assert.ok(bot._digs.length > 0, 'it dug')
  assert.ok(bot._digs.every(p => p.y >= 65), 'never below the feet')
  assert.ok(bot._digs.every(p => Math.hypot(p.x - 440, p.z - 200) > d0), `always away from the centre: ${JSON.stringify(bot._digs.slice(0, 4))}`)
})
test('CHAIN exit: no walk, no dig (liquid beside every cell), no climb room -> failed, named, handed to the escape ladder', async () => {
  const bot = stairWorld({ at: [441, 65, 200], sites: [SITE_X], gotoOk: () => false, wet: (x, y, z) => y >= 65 && y <= 66 && x !== 441 })
  bot.inventory = { items: () => [] }
  const r = await runExit(SK, bot)
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'keepout_exit_failed')
  assert.match(r.detail, /the escape ladder \(surface, home, explore\) owns the body now/)
})
test('CHAIN exit: outside every column -> no_effect (the order never moves a bot that is out)', async () => {
  const bot = stairWorld({ at: [470, 65, 200], sites: [SITE_X] })
  const r = await runExit(SK, bot)
  assert.equal(r.status, 'no_effect'); assert.equal(bot._walks.length, 0)
})
test('keepout_exit is a deterministic order only (never offered to the model) and rescue-class (never an avoid rule)', () => {
  assert.equal(SKILLS.keepout_exit.chatOnly, true); assert.equal(SKILLS.keepout_exit.rescue, true)
  assert.deepEqual(SK.SKILL_CONTRACTS.keepout_exit.expects, ['position'])
})

// ---- the dispute (worldfacts.mjs) -------------------------------------------------------------------------------------
test('a lava read that found the disc clear disputes the site (kept, no longer keeping out); the next fire death clears it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcai-ko-'))
  const wf = new WorldFacts(path.join(dir, 'world-facts.json'))
  wf.reportDeath('fire', { x: 100.2, y: 60, z: 100.4 }, 'hive-b-Echo')
  assert.equal(KO.fireSites(wf.deathSites()).length, 1, 'positive control: the site keeps out')
  assert.ok(wf.disputeFireSite({ x: 100, y: 60, z: 100 }))
  assert.equal(wf.deathSites().length, 1, 'the site is kept (its path price stands)')
  assert.equal(KO.fireSites(wf.deathSites()).length, 0, 'disputed: it no longer keeps out')
  wf.reportDeath('fire', { x: 101, y: 60, z: 100 }, 'hive-b-Alpha')
  assert.equal(KO.fireSites(wf.deathSites()).length, 1, 'the next fire death clears the dispute')
  assert.equal(wf.disputeFireSite({ x: 1, y: 1, z: 1 }), null, 'no such site: nothing')
})

// ---- wiring (structural: what behaviour cannot reach) -------------------------------------------------------------------
const idx = strip(readFileSync(INDEX_URL, 'utf8'))
const cog = strip(readFileSync(COG_URL, 'utf8'))
const wired = {
  guard: s => /bot\.dig = keepoutDigGuard\(inner, \{/.test(s) && s.indexOf('bot.dig = keepoutDigGuard(') > s.indexOf('const dt = attachDigTown(bot, {'),
  step: s => /const deathSitePenalty = \(block\) => deathSiteStepCost\(deathSites, block\) \+ keepoutStepPenalty\(block\)/.test(s),
  brk: s => /gatherMoves\.exclusionAreasBreak = \[\.\.\.moves\.exclusionAreasBreak, \(block\) => keepoutBreakPenalty\(block\)\]/.test(s),
  lic: s => /kind: 'keepout_mode'/.test(s),
  exitLast: s => { const i = s.indexOf('{ const ko = this.#keepoutExitOrder(order); if (ko) order = ko }'); const j = s.indexOf("logEvent({ kind: 'work_order',"); const k = s.indexOf('plantingOrder({ saplings: sap'); return i > 0 && k > 0 && i > k && i < j },
}
test('WIRED: the dig guard (outside the dig instrument), the route on every profile, the break veto on gather\'s, the licence row, the exit order last', () => {
  for (const [k, f] of Object.entries(wired)) assert.equal(f(k === 'exitLast' ? cog : idx), true, k)
})
test('MUTANTS KILLED: each wiring check fails when its line is gone', () => {
  const rawIdx = readFileSync(INDEX_URL, 'utf8'), rawCog = readFileSync(COG_URL, 'utf8')
  const cases = [
    ['guard', rawIdx, '        bot.dig = keepoutDigGuard(inner, {', '        bot.dig = (inner, {'],
    ['step', rawIdx, 'deathSiteStepCost(deathSites, block) + keepoutStepPenalty(block)', 'deathSiteStepCost(deathSites, block)'],
    ['brk', rawIdx, '[...moves.exclusionAreasBreak, (block) => keepoutBreakPenalty(block)]', '[...moves.exclusionAreasBreak]'],
    ['lic', rawIdx, "kind: 'keepout_mode'", "kind: 'keepout_mood'"],
    ['exitLast', rawCog, '{ const ko = this.#keepoutExitOrder(order); if (ko) order = ko }', ''],
  ]
  for (const [k, raw, old, neu] of cases) {
    assert.ok(raw.includes(old) && raw.split(old).length === 2, `${k}: ANCHOR MISSING or not unique`)
    assert.equal(wired[k](strip(raw.replace(old, neu))), false, k)
  }
})
