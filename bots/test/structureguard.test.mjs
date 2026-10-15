// STRUCTUREGUARD-01: recorded TOWN STRUCTURES (the monument now) join minewell-01's keep-out for TARGET digs -- mine's
// stair plan and per-dig stop, gather's candidates, the room veto, the ore tunnel's profile. Behaviour through the pure
// registry, the real `mine` skill in the minewell micro-world, and the real gather filters; each guard beside the
// positive control without the record; wiring mutants with unique anchors (the farm-minewell harness's withMutant).
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { V, AIR, STONE } from './helpers/microworld.mjs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-structureguard-${process.pid}`
process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '200'; process.env.HOME_Y = '64'; process.env.HOME_Z = '214'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'sguard-'))
const here = path.dirname(fileURLToPath(import.meta.url))
const SKP = path.join(here, '../src/skills.mjs'), OTP = path.join(here, '../src/oretunnel.mjs')
const ST = await import('../src/structures.mjs')
const MW = await import('../src/minewell.mjs')
const MON = await import('../src/monument.mjs')
const SK = await import('../src/skills.mjs')
const OT = await import('../src/oretunnel.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 3).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  let src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  src = src.replace(old, neu)
  const out = path.join(here, `.mutant-sguard-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src.replace(/from '\.\//g, `from '${path.join(here, '../src')}/`))
  try { return await fn(await import(pathToFileURL(out))) } finally { try { fs.unlinkSync(out) } catch {} }
}
const key = (x, y, z) => `${x},${y},${z}`
const DIR = process.env.POOL_STATE_DIR
const HOME = { x: 200, y: 64, z: 214 }
const RECFILE = path.join(DIR, `${ST.structureKey('monument', HOME)}.g1.json`)

// ---- the monument record: a 48-wide ziggurat whose WEST edge is 2 east of the bot (P0), base 64 ---------------------
const P0 = { x: 230, y: 64, z: 230 }
const SITE = { corner: { x: P0.x + 2, z: P0.z - 24 }, baseY: 64, stairFace: 'w' }
const REC = { v: 1, structure: 'monument', world: null, site: SITE, geom: MON.ZIG, state: 'building' }
const setMonument = on => { if (on) fs.writeFileSync(RECFILE, JSON.stringify(REC)); else { try { fs.unlinkSync(RECFILE) } catch {} } }
const IDX = ST.monumentIndex(REC)
const monCell = c => IDX.has(c.x, c.y, c.z)

await t('REGISTRY (pure): the monument reserves its footprint from base-8 up to the profile, plus the stair; not the air above, not outside', () => {
  const c = SITE.corner
  assert.equal(IDX.has(c.x, 64, c.z), true, 'the corner\'s first layer')
  assert.equal(IDX.has(c.x, 65, c.z), true, 'the corner\'s second layer (tier 0 is 2 high)')
  assert.equal(IDX.has(c.x, 66, c.z), false, 'above the edge profile: open air on the finished structure')
  assert.equal(IDX.has(c.x, 56, c.z), true, 'the foundation guard (base-8)')
  assert.equal(IDX.has(c.x, 55, c.z), false, 'below the guard')
  assert.equal(IDX.has(c.x - 1, 64, c.z), false, 'outside the footprint')
  assert.equal(IDX.has(c.x + 24, 64 + 15, c.z + 24), true, 'the top tier\'s top layer')
  const stair = MON.zigCells({ corner: c, baseY: 64, stairFace: 'w' }).find(x => x.role === 'stair')
  assert.equal(IDX.has(stair.x, stair.y, stair.z), true, 'a stair step outside the footprint is reserved too')
  assert.equal(ST.monumentIndex({ ...REC, state: 'abandoned' }), null, 'an abandoned monument reserves nothing')
  assert.equal(ST.monumentIndex({ ...REC, site: null }), null, 'no site, nothing')
  // MALFORMED RECORDS RESERVE NOTHING (Claude stage-3 r1 P2-5), and never hang
  assert.equal(ST.monumentIndex({ ...REC, site: { ...SITE, corner: { z: SITE.corner.z } } }), null, 'a corner without x')
  assert.equal(ST.monumentIndex({ ...REC, site: { ...SITE, baseY: '64' } }), null, 'a string base')
  assert.equal(ST.monumentIndex({ ...REC, geom: { ...MON.ZIG, S: 0 } }), null, 'S = 0 (the tier loop would never end)')
  assert.equal(ST.monumentIndex({ ...REC, geom: { ...MON.ZIG, B: 4, S: 3 } }), null, 'B < 2S')
  assert.equal(IDX.has(NaN, 64, 0), false)
})

await t('REGISTRY: the latest generation is read; another world\'s record is ignored; no record -> no keep-out (positive control)', () => {
  setMonument(false)
  assert.equal(ST.structureKeepOut(ST.structureIndexes(DIR, HOME)).forbid, null)
  setMonument(true)
  const k = ST.structureKeepOut(ST.structureIndexes(DIR, HOME))
  assert.equal(k.forbid({ x: SITE.corner.x, y: 64, z: SITE.corner.z }), 'monument'); assert.equal(k.bottom, 56)
  fs.writeFileSync(path.join(DIR, `${ST.structureKey('monument', HOME)}.g2.json`), JSON.stringify({ ...REC, site: { ...SITE, corner: { x: 0, z: 0 } } }))
  const k2 = ST.structureKeepOut(ST.structureIndexes(DIR, HOME))
  assert.equal(k2.forbid({ x: SITE.corner.x, y: 64, z: SITE.corner.z }), null, 'g2 moved the site: g1\'s cells are free')
  fs.unlinkSync(path.join(DIR, `${ST.structureKey('monument', HOME)}.g2.json`))
  fs.writeFileSync(RECFILE, JSON.stringify({ ...REC, world: 'other' }))
  assert.equal(ST.structureKeepOut(ST.structureIndexes(DIR, HOME, 'this')).forbid, null, 'another world: ignored')
  setMonument(true)
  assert.equal(ST.readStructureRecord(DIR, 'monument-200_64_21'), null, 'a key that is a prefix of the town\'s matches nothing')
  assert.equal(ST.structureKeepOut(ST.structureIndexes(DIR, { x: 1, y: 2, z: 3 })).forbid, null, 'another town\'s key: nothing')
})

await t('READER CACHE: a record written within CACHE_MS is honoured once the cache expires, never later', () => {
  setMonument(false)
  let clock = 0
  const rd = ST.structureReader(() => DIR, () => HOME, () => null, () => clock)
  const c = { x: SITE.corner.x, y: 64, z: SITE.corner.z }
  assert.equal(rd().forbid, null)
  setMonument(true)
  clock = ST.CACHE_MS - 1; assert.equal(rd().forbid, null, 'inside the window: the cached answer')
  clock = ST.CACHE_MS; assert.equal(rd().forbid(c), 'monument', 'at expiry: read afresh')
})

await t('ON THE MONUMENT: exitCell names the nearest side two beyond the box, at the base; off the box -> null', () => {
  const c = SITE.corner
  assert.deepEqual(ST.exitCell(IDX, { x: c.x + 3, y: 70, z: c.z + 20 }), { x: c.x - 3, y: 64, z: c.z + 20 }, 'west side, 3 in: out to x0-1-2')
  assert.deepEqual(ST.exitCell(IDX, { x: c.x + 24, y: 79, z: c.z + 46 }), { x: c.x + 24, y: 64, z: c.z + 50 }, 'south side')
  assert.equal(ST.exitCell(IDX, { x: c.x - 5, y: 64, z: c.z }), null)
  const e = ST.exitCell(IDX, { x: c.x + 24, y: 79, z: c.z + 24 })
  assert.equal(IDX.has(e.x, e.y, e.z), false, 'the named cell is not reserved')
})

await t('COMPOSE: the farm (true) and the monument (kind) OR together; the bottom is the lower; one side missing is ignored', () => {
  const farm = { forbid: c => c.x === 1, bottom: 60 }, mon = { forbid: c => (c.x === 2 ? 'monument' : null), bottom: 56 }
  const k = ST.composeKeepOut(farm, mon)
  assert.equal(k.forbid({ x: 1 }), true); assert.equal(k.forbid({ x: 2 }), 'monument'); assert.equal(k.forbid({ x: 3 }), false); assert.equal(k.bottom, 56)
  assert.equal(ST.composeKeepOut({ forbid: null, bottom: null }, { forbid: null, bottom: null }).forbid, null)
  assert.equal(ST.composeKeepOut(farm, null).bottom, 60)
})

await t('PLAN (minewell, pure): a monument hit carries its kind and the refusal names the monument, not the farm', () => {
  const k = ST.structureKeepOut([IDX])
  const w = MW.stairClear([], P0, { x: 1, z: 0 }, { forbid: k.forbid, forbidBottom: k.bottom })
  assert.equal(w.clear, false); assert.equal(w.hit.kind, 'monument')
  const r = MW.planMineStart({ cols: [], p0: P0, bearings: [{ x: 1, z: 0 }], standable: () => false, forbid: k.forbid, forbidBottom: k.bottom })
  assert.equal(r.action, 'refuse'); assert.match(r.why, /monument/); assert.doesNotMatch(r.why, /tree farm/)
})

// ---- the minewell micro-world (treefarm-minewell's), with the monument east of the bot -------------------------------
function world ({ monument = true, canMove = true, built = false } = {}) {
  setMonument(monument)
  const carved = new Set(), digs = [], gotos = []
  const raw = p => (carved.has(key(p.x, p.y, p.z)) ? AIR : p.y < 64 || (built && IDX.has(p.x, p.y, p.z)) ? STONE : AIR)
  const bot = {
    // facing EAST: the first bearing is into the monument
    entity: { position: new V(P0.x + 0.5, P0.y, P0.z + 0.5), yaw: -Math.PI / 2 }, health: 20, food: 20, oxygenLevel: 300, heldItem: { type: 1 },
    blockAt: p => ({ ...raw(p), position: new V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 100, harvestTools: undefined, material: 'rock' }),
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'cobblestone', count: 512 }] },
    equip: async () => {},
    dig: async b => { digs.push({ x: b.position.x, y: b.position.y, z: b.position.z }); carved.add(key(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      goto: async goal => {
        gotos.push({ x: goal.x, y: goal.y, z: goal.z })
        if (!canMove) return
        // a column goal (GoalNearXZ: no y) lands on the column's surface
        let gy = goal.y
        if (gy === undefined) { gy = 140; while (gy > 0 && raw(new V(goal.x, gy - 1, goal.z)).boundingBox === 'empty') gy-- }
        const c = new V(goal.x, gy, goal.z)
        if (raw(c).boundingBox !== 'empty' || raw(c.offset(0, 1, 0)).boundingBox !== 'empty') return
        bot.entity.position = new V(c.x + 0.5, c.y, c.z + 0.5)
      },
      setGoal: () => {}, stop: () => {},
    },
    setControlState: () => {}, clearControlStates: () => {},
    registry: { blocksByName: {}, itemsByName: {} }, players: {},
    wellCellsNow: () => [], farmIndexNow: () => null, _digs: digs, _gotos: gotos,
  }
  return bot
}
const run = (mod, bot, y = 50) => mod.SKILLS.mine.run({ bot }, { y }, new AbortController().signal)

await t('POSITIVE CONTROL: with NO record, the same scene\'s stair goes east into the (unrecorded) monument volume', async () => {
  const bot = world({ monument: false })
  await run(SK, bot)
  assert.ok(bot._digs.some(monCell), `the scene reaches the volume (${bot._digs.length} digs)`)
})

await t('THE CHAIN through the real `mine`: started beside the monument it never digs a reserved cell, and it still descends', async () => {
  const bot = world()
  const res = await run(SK, bot)
  assert.equal(bot._digs.filter(monCell).length, 0, `monument cells dug: ${JSON.stringify(bot._digs.filter(monCell).slice(0, 5))}`)
  assert.ok(bot._digs.length > 3, `it descended (${res.status}: ${res.detail})`)
})

await t('A MONUMENT RECORDED MID-DESCENT: the per-dig stop reads the record afresh and names the monument', async () => {
  const bot = world({ monument: false })
  bot.entity.position = new V(SITE.corner.x - 2 + 0.5, 64, P0.z + 0.5)
  let n = 0
  const dig0 = bot.dig
  bot.dig = async b => { if (++n === 1) setMonument(true); return dig0(b) }
  const res = await run(SK, bot)
  // either the plan (before the first dig) or the per-dig stop catches it -- no reserved cell is dug after the record exists
  const after = bot._digs.slice(1)
  assert.equal(after.filter(monCell).length, 0, JSON.stringify(after.filter(monCell).slice(0, 3)))
  assert.equal(res.failClass, 'forbidden', `${res.status}: ${res.detail}`); assert.match(res.detail, /monument/)
})

await t('MUTANT KILLED (skills): mine reads the 2 s CACHE instead of the record -- a monument recorded mid-descent is dug', async () => {
  await withMutant(SKP, '    try { built = structuresFresh(bot) } catch', '    try { built = structuresNow(bot) } catch', async m => {
    const bot = world({ monument: false })
    let n = 0
    const dig0 = bot.dig
    bot.dig = async b => { if (++n === 1) setMonument(true); return dig0(b) }
    await run(m, bot)
    assert.ok(bot._digs.slice(1).some(monCell), 'the cached read lets the stair into the monument')
  })
})

await t('THE CHAIN on top of the monument: mine WALKS OFF its nearest side and descends there; nothing reserved is dug', async () => {
  const bot = world({ built: true })
  const top = { x: SITE.corner.x + 24, y: 64 + 16, z: SITE.corner.z + 24 }
  assert.equal(IDX.has(top.x, top.y - 1, top.z), true, 'it stands on the top layer')
  bot.entity.position = new V(top.x + 0.5, top.y, top.z + 0.5)
  const res = await run(SK, bot)
  assert.equal(bot._digs.filter(monCell).length, 0, JSON.stringify(bot._digs.filter(monCell).slice(0, 3)))
  assert.ok(bot._gotos.some(g => g.y === undefined), 'the off-monument walk was made')
  assert.ok(bot._digs.length > 3, `it descended off the monument (${res.status}: ${res.detail})`)
})

await t('...and when that walk cannot be made, mine refuses naming the cell off the monument (a goto from here), digs nothing reserved', async () => {
  const bot = world({ built: true, canMove: false })
  const top = { x: SITE.corner.x + 24, y: 64 + 16, z: SITE.corner.z + 24 }
  bot.entity.position = new V(top.x + 0.5, top.y, top.z + 0.5)
  const res = await run(SK, bot)
  assert.equal(bot._digs.filter(monCell).length, 0)
  assert.equal(res.failClass, 'forbidden', `${res.status}: ${res.detail}`)
  const m = /goto (-?\d+) (-?\d+) (-?\d+) \(off the monument/.exec(res.detail)
  assert.ok(m, res.detail)
  assert.equal(IDX.has(+m[1], +m[2], +m[3]), false, 'the named cell is outside the reserve')
})

await t('MUTANT KILLED (skills): the off-monument walk removed -- from the summit mine only refuses (no descent)', async () => {
  await withMutant(SKP, "  if (wellPlan.action === 'refuse' && !wellPlan.inside && (wellPlan.hit?.kind ?? wellPlan.kind) === 'monument') {", "  if (false) {", async m => {
    const bot = world({ built: true })
    bot.entity.position = new V(SITE.corner.x + 24.5, 80, SITE.corner.z + 24.5)
    const res = await run(m, bot)
    assert.equal(res.failClass, 'forbidden'); assert.ok(bot._digs.length === 0)
  })
})

await t('GATHER AT THE DIG (collectManually): a cell recorded since the scan is refused uncached, never dug; a free cell is dug (control)', async () => {
  setMonument(false)
  const bot = world({ monument: false })
  bot.entity.position = new V(SITE.corner.x - 1 + 0.5, 64, P0.z + 0.5)
  const cell = new V(SITE.corner.x, 63, P0.z)
  SK.structuresNow(bot)                                  // warm the 2 s cache with NO record
  setMonument(true)
  let err = null
  try { await SK.collectManually(bot, bot.blockAt(cell), new AbortController().signal) } catch (e) { err = e }
  assert.ok(err && /town_structure/.test(err.message), String(err?.message))
  assert.equal(bot._digs.length, 0)
  const free = new V(SITE.corner.x - 2, 63, P0.z)
  let err2 = null
  try { await SK.collectManually(bot, bot.blockAt(free), new AbortController().signal) } catch (e) { err2 = e }
  assert.ok(!/town_structure/.test(String(err2?.message ?? '')), String(err2?.message))
  assert.ok(bot._digs.some(d => d.x === free.x && d.y === free.y && d.z === free.z), `the control was dug (${String(err2?.message ?? 'ok')})`)
})

await t('GATHER AT THE DIG: a record written DURING the dig\'s own look is still refused -- the check follows the look (Codex stage-3 r2 P1-3)', async () => {
  setMonument(false)
  const bot = world({ monument: false })
  bot.entity.position = new V(SITE.corner.x - 1 + 0.5, 64, P0.z + 0.5)
  bot.lookAt = async () => { setMonument(true) }
  let err = null
  try { await SK.collectManually(bot, bot.blockAt(new V(SITE.corner.x, 63, P0.z)), new AbortController().signal) } catch (e) { err = e }
  assert.ok(err && /town_structure/.test(err.message), String(err?.message)); assert.equal(bot._digs.length, 0)
})

await t('GATHER ENUMERATION (unreservedOf): with 40 reserved stone nearer than one free stone, a 32-count search still finds the free one', () => {
  setMonument(true)
  const bot = { worldId: null }
  const near = []; for (let i = 0; i < 40; i++) near.push({ type: 1, position: { x: SITE.corner.x + (i % 8), y: 63, z: SITE.corner.z + Math.floor(i / 8) } })
  const far = { type: 1, position: { x: SITE.corner.x - 6, y: 63, z: SITE.corner.z } }
  // mineflayer's findBlocks: the palette pass (no position), then every block, stopping at `count` matches
  const find = (matching, count) => { if (!matching({ type: 1 })) return []; const out = []; for (const b of [...near, far]) { if (out.length >= count) break; if (matching(b)) out.push(b.position) } return out }
  const got = find(SK.unreservedOf(bot, 1), 32)
  assert.deepEqual(got, [far.position])
  assert.equal(find(b => b.type === 1, 32).length, 32, 'positive control: the bare type match fills its 32 with reserved cells')
  assert.equal(SK.unreservedOf(bot, 1)({ type: 2, position: far.position }), false, 'another type never matches')
})

await t('GATHER + ROOM: structureNoDig names the monument; with no record it is free (positive control)', () => {
  setMonument(true)
  const bot = { worldId: null }
  const c = { x: SITE.corner.x, y: 64, z: SITE.corner.z }
  assert.ok(fs.existsSync(RECFILE), 'the record is on disk')
  assert.equal(SK.structureNoDig(bot, c), 'monument')
  assert.equal(SK.structureNoDig(bot, { x: c.x - 1, y: 64, z: c.z }), null)
  setMonument(false)
  const bot2 = { worldId: null }
  assert.equal(SK.structureNoDig(bot2, c), null)
  setMonument(true)
})

await t('ORE TUNNEL: a reserved cell is a 100-cost break (refused) in the tunnel profile; an unreserved one is not', () => {
  setMonument(true)
  const bot = { registry: { blocksByName: {}, blocks: {} }, blockAt: p => ({ name: 'stone', boundingBox: 'block', position: new V(p.x, p.y, p.z) }) }
  const base = { exclusionAreasBreak: [], exclusionAreasStep: [] }
  let m
  try { m = OT.tunnelMovements(bot, base, { home: { x: 0, z: 0 }, keepOut: () => SK.structuresNow({ worldId: null }) }) } catch (e) { m = null }
  assert.ok(m, 'the tunnel profile builds on the fake registry')
  const brk = m.exclusionAreasBreak.at(-1)
  assert.equal(brk({ position: new V(SITE.corner.x, 64, SITE.corner.z) }), 100)
  assert.equal(brk({ position: new V(SITE.corner.x - 3, 64, SITE.corner.z) }), 0, 'positive control: plain stone outside is a free break')
})

await t('MUTANT KILLED (skills): the structures left out of mine\'s keep-out -- the stair digs the monument', async () => {
  await withMutant(SKP, '    try { built = structuresFresh(bot) } catch { /* no structure record: nothing from it */ }\n', '', async m => {
    const bot = world()
    await run(m, bot)
    assert.ok(bot._digs.some(monCell), 'the mutant digs into the monument')
  })
})

await t('TUNNEL DIG BOUNDARY (guardTunnelDigs): a pathfinder break of a reserved cell is refused uncached; a free cell, a non-pathfinder dig (survival) and the restore pass through', async () => {
  setMonument(false)
  const dug = []
  let mining = true
  const bot = { worldId: null, pathfinder: { isMining: () => mining }, dig: async b => { dug.push(b.position) } }
  SK.structuresNow(bot)                                         // a warm 2 s cache that has NO record
  setMonument(true)
  const refused = []
  const restore = SK.guardTunnelDigs(bot, c => refused.push(c))
  const res = { name: 'stone', position: { x: SITE.corner.x, y: 60, z: SITE.corner.z } }, free = { name: 'stone', position: { x: SITE.corner.x - 3, y: 60, z: SITE.corner.z } }
  let err = null
  try { await bot.dig(res, true) } catch (e) { err = e }
  assert.ok(err?.reserved, String(err?.message)); assert.equal(refused.length, 1); assert.equal(dug.length, 0)
  await bot.dig(free, true); assert.equal(dug.length, 1, 'a free cell is dug')
  mining = false
  await bot.dig(res, true); assert.equal(dug.length, 2, 'not the pathfinder breaking: a reflex or a skill dig is untouched')
  mining = true
  restore()
  await bot.dig(res, true); assert.equal(dug.length, 3, 'restored: the original dig')
})

await t('A BAD stairFace reserves nothing and never throws (Claude stage-3 r2 P2-C); the reader caches the empty answer', () => {
  for (const f of ['x', 'S', 7]) assert.equal(ST.monumentIndex({ ...REC, site: { ...SITE, stairFace: f } }), null, String(f))
  let reads = 0
  const rd = ST.structureReader(() => { reads++; throw new Error('boom') }, () => HOME, () => null, () => 0)
  assert.equal(rd().forbid, null); rd(); assert.equal(reads, 1, 'cached for CACHE_MS even after a throw')
})

await t('WIRED (structural): survival and transit stay unguarded -- reflex.mjs and escape.mjs never consult a structure (design 3.6)', () => {
  for (const f of ['reflex.mjs', 'escape.mjs']) {
    const src = fs.readFileSync(path.join(here, '../src', f), 'utf8')
    assert.doesNotMatch(src, /structures\.mjs|structureNoDig|structuresNow|structuresFresh/, f)
  }
})

const stripSrc = f => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const gatherWired = src => ({ enum: (src.match(/findBlocks\(\{ matching: unreservedOf\(bot, (type|altType)\.id\), maxDistance, count: 32 \}\)/g) ?? []).length,
                              room: /if \(structureNoDig\(bot, p\)\) return 'town_structure'/.test(src) })
await t('WIRED (structural, comments stripped): all three gather searches use unreservedOf; the room veto asks structureNoDig', () => {
  const w = gatherWired(stripSrc(SKP))
  assert.equal(w.enum, 3); assert.equal(w.room, true)
})
await t('...the WIRED check fails for the intended reason: one search reverted to the bare type id', async () => {
  const src = fs.readFileSync(SKP, 'utf8')
  const old = '      .findBlocks({ matching: unreservedOf(bot, type.id), maxDistance, count: 32 })\n'
  assert.equal(src.split(old).length, 2, 'anchor present and unique')
  const w = gatherWired(src.replace(old, '      .findBlocks({ matching: type.id, maxDistance, count: 32 })\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
  assert.equal(w.enum, 2)
})

await t('WIRED (structural, comments stripped): the tunnel profile prices reserved cells; index.mjs and the fallback pass the keep-out; the tunnel walk re-asks the record over its planned breaks', async () => {
  const src = fs.readFileSync(OTP, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(src, /nearHome\(b\?\.position, home\) \|\| reserved\(b\?\.position\) \? 100/)
  const idx = fs.readFileSync(path.join(here, '../src/index.mjs'), 'utf8')
  assert.match(idx, /bot\.tunnelMovements = tunnelMovements\(bot, gatherMoves, \{[^\n]{0,200}keepOut: \(\) => structuresNow\(bot\) \}\)/)
  const sk = fs.readFileSync(SKP, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(sk, /tunnelMovements\(bot, bot\.gatherMovements, \{ home, keepOut: \(\) => structuresNow\(bot\) \}\)/, 'the fallback profile too')
  assert.match(sk, /!nearHome\(q, home\) && !structureNoDig\(bot, q\)\)\)/, 'the iron candidates skip reserved ore')
  assert.match(sk, /const unguard = guardTunnelDigs\(bot, hit => \{ reservedNow \?\?= hit; try \{ bot\.pathfinder\.setGoal\(null\) \}/, 'the walk installs the dig boundary')
  assert.match(sk, /\.finally\(\(\) => \{ clearInterval\(watch\); unguard\(\);/, '...and removes it')
})

setMonument(false)
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
