// ZONEGUARD-01SHOW (protectzone.mjs structAt / withBaseline / the chokepoint's op masks, escapeguard guardOf): NO BOT DIG AND NO
// PATHFINDER OR REFLEX PLACEMENT CHANGES A CELL THE SHOWCASE TRIPWIRE'S S4 COMPARES. 11-09 01:42Z showcase-Haven: a `mine` stair
// at y 18 under village-taiga-6_1 (box y -64..90, floor_y 54) dug 57,18,5 oak_planks -- a mineshaft plank in the tripwire's
// baseline -- because the deep exemption opened every cell under floor_y to a bot whose feet were under it too; the pathfinder's
// pillar then put cobblestone in that cell (the same exemption). S4 BREACH, the showcase stopped and rolled back.
//
// Proven by BEHAVIOUR: the guard's cells (the baseline's, a hanging block's supports, a path's cover); the chokepoint on a fake bot
// with mineflayer's calling conventions (the incident's dig and placement refused for a deep bot, for every purpose; ordinary rock
// beside them open; a pillar ON a structure block still placed); the REAL mineflayer-pathfinder 2.4.5 Movements (no break, no
// tower in a baseline cell; the same moves exist one cell over); the reader (the baseline joins by id and box, keeps its last
// good copy, ZONEGUARD=off reads none); the no-baseline NAME rule (the fleet); escapeguard's planner answer; and the COMPOSED
// REFUSAL CHAIN: an entombed bot under the mineshaft -- its ceiling and nearest wall baseline cells -- is refused there and walks
// out through ordinary rock (zonewalk.mjs) with every dig through the real chokepoint, no baseline cell touched. Anchored mutants.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const PZ = await import('../src/protectzone.mjs')
const EG = await import('../src/escapeguard.mjs')
const ZW = await import('../src/zonewalk.mjs')
const { parseZones, withBaseline, parseBaseline, structAt, zoneCost, attachProtectZone, ProtectedZoneError, zoneReader,
  ZONE_COST, S_CELL, S_SUPPORT, S_COVER, DIG_MASK, PLACE_MASK } = PZ
const URLS = { pz: new URL('../src/protectzone.mjs', import.meta.url), eg: new URL('../src/escapeguard.mjs', import.meta.url), idx: new URL('../src/index.mjs', import.meta.url) }
const V = (x, y, z) => new Vec3(x, y, z)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// village-taiga-6_1 as the showcase's zones file has it, and a baseline in the tripwire's own format (zones-baseline.json:
// { zones: { id: { box, n, chunks, cells: { "x,y,z": name } } } }) holding the incident's cells
const ZFILE = { version: 1, zones: [{ id: 'village-taiga-6_1', kind: 'village', label: 'the taiga village at 103,-7', box: [49, -64, -59, 157, 90, 45], floor_y: 54 }] }
const BASE_CELLS = {
  '57,18,5': 'minecraft:oak_planks',      // THE INCIDENT's cell (a mineshaft plank, 11-09 01:42Z)
  '58,18,5': 'minecraft:oak_planks',
  '57,21,5': 'minecraft:oak_planks',      // the pocket's ceiling (the chain below)
  '56,19,5': 'minecraft:cobblestone',     // cobblestone deep: escdead's name rule lets a survival dig through (DEEP_NATURAL)
  '56,20,5': 'minecraft:mossy_cobblestone',
  '60,20,7': 'minecraft:wall_torch',      // hangs on a neighbour: its supports are guarded for a dig
  '100,60,0': 'minecraft:dirt_path',      // a block placed over it turns it to dirt
}
const BASELINE = { t: '2026-10-25T18:11:32Z', zones: { 'village-taiga-6_1': { box: [49, -64, -59, 157, 90, 45], n: 7, chunks: {}, cells: BASE_CELLS } } }
const Z0 = parseZones(ZFILE).zones
const ZG = withBaseline(Z0, parseBaseline(BASELINE)).zones
const DEEP = V(57.5, 19, 5.5)          // Haven's feet at 01:42:52Z (57.5,19,5.2)

// ---- the guard's cells ------------------------------------------------------------------------------------------------
test('CELLS: every baseline cell is S_CELL; a hanging block\'s six neighbours S_SUPPORT; the cell over a path S_COVER; stone beside them none', () => {
  const g = ZG[0].guard
  assert.ok(g, 'the zone carries the baseline'); assert.equal(g.n, 7)
  assert.equal(PZ.structFlagsIn(g, 57, 18, 5) & S_CELL, S_CELL)
  for (const [x, y, z] of [[61, 20, 7], [59, 20, 7], [60, 21, 7], [60, 19, 7], [60, 20, 8], [60, 20, 6]]) assert.ok(PZ.structFlagsIn(g, x, y, z) & S_SUPPORT, `${x},${y},${z} holds the torch`)
  assert.equal(PZ.structFlagsIn(g, 100, 61, 0), S_COVER)
  for (const [x, y, z] of [[57, 17, 5], [57, 18, 6], [57, 19, 5], [59, 18, 5]]) assert.equal(PZ.structFlagsIn(g, x, y, z), 0, `${x},${y},${z} is ordinary ground`)
  assert.equal(structAt(ZG, 57, 18, 5, DIG_MASK)?.id, 'village-taiga-6_1')
  assert.equal(structAt(ZG, 60, 20, 6, PLACE_MASK), null, 'a support is a dig\'s concern, not a placement\'s')
  assert.equal(structAt(ZG, 100, 61, 0, DIG_MASK), null, 'a path\'s cover is a placement\'s concern, not a dig\'s')
  assert.equal(structAt(Z0, 57, 18, 5, DIG_MASK), null, 'positive control: the same zone without its baseline guards nothing')
})

test('BLOCKED (every planner\'s question): a baseline cell is closed to a DEEP bot; the deep exemption still opens ordinary rock beside it', () => {
  assert.equal(PZ.blocked(Z0, 57, 18, 5, DEEP), null, 'THE HOLE: without the baseline the deep exemption opens the plank')
  assert.ok(PZ.blocked(ZG, 57, 18, 5, DEEP), 'with it the plank is closed')
  assert.equal(PZ.blocked(ZG, 57, 17, 5, DEEP), null, 'stone under it stays open to the deep bot')
  assert.ok(PZ.blocked(ZG, 57, 17, 5, V(57.5, 70, 5.5)), 'and closed to a bot above the floor (the old rule, unchanged)')
  assert.ok(PZ.zoneKeepOut(ZG, DEEP).forbid({ x: 57, y: 18, z: 5 }), 'mine\'s keep-out: no stair through the plank')
  assert.equal(PZ.zoneKeepOut(ZG, DEEP).forbid({ x: 57, y: 18, z: 6 }), null, '...one cell over is a stair cell')
})

// ---- the chokepoint ---------------------------------------------------------------------------------------------------
function fakeBot ({ zones = ZG, ctx = {}, feet = DEEP, guardOn = true, dig = null } = {}) {
  const calls = []
  const rec = name => async (...a) => { calls.push([name, ...a]); return `${name}-ok` }
  const bot = { entity: { position: feet }, dig: dig ?? rec('dig'), _genericPlace: rec('place'), activateBlock: rec('use'), openBlock: rec('open'),
    sleep: rec('sleep'), craft: rec('craft'), pathfinder: { isMining: () => false, movements: {} } }
  const refusals = []
  attachProtectZone(bot, { zones: () => zones, context: () => ctx, onRefuse: r => refusals.push(r), guardOn })
  return { bot, calls, refusals }
}
const blk = (x, y, z, name) => ({ name, position: V(x, y, z) })
const MINE = { skill: 'mine', args: { y: 16 } }
const ENTOMBED = { reflex: 'entombed' }

test('THE INCIDENT, dig: Haven\'s `mine` at 57,19,5 digging 57,18,5 oak_planks is REFUSED (struct, remedy names the ordinary rock); stone one cell over is dug', async () => {
  const { bot, calls, refusals } = fakeBot({ ctx: MINE })
  await assert.rejects(bot.dig(blk(57, 18, 5, 'oak_planks')), e => e instanceof ProtectedZoneError && /part of the structure itself/.test(e.message) && /ordinary rock/.test(e.message))
  assert.equal(refusals[0].struct, true); assert.equal(bot.protectZone.struct_refused, 1)
  assert.equal(await bot.dig(blk(57, 18, 6, 'stone')), 'dig-ok', 'positive control: the stair goes on through stone')
  assert.equal(calls.length, 1)
  // the base (the zone without its baseline, the name rule off: ZONEGUARD=off) dug it -- the incident
  const base = fakeBot({ zones: Z0, ctx: MINE, guardOn: false })
  assert.equal(await base.bot.dig(blk(57, 18, 5, 'oak_planks')), 'dig-ok', 'THE HOLE reproduced on the base')
})

test('THE INCIDENT, placement: a pillar INTO the dug cell 57,18,5 is refused for every purpose; a pillar ON a structure block (the reference) is placed', async () => {
  for (const ctx of [MINE, ENTOMBED, {}]) {
    const { bot, calls } = fakeBot({ ctx })
    await assert.rejects(bot._genericPlace(blk(57, 17, 5, 'stone'), V(0, 1, 0)), ProtectedZoneError, `purpose ${JSON.stringify(ctx)}`)
    assert.equal(calls.length, 0)
  }
  // pillar_out on the mineshaft floor: the reference 58,18,5 is a baseline plank, the destination 58,19,5 air -- placed
  const { bot } = fakeBot({ ctx: ENTOMBED })
  assert.equal(await bot._genericPlace(blk(58, 18, 5, 'oak_planks'), V(0, 1, 0)), 'place-ok', 'the reference changes nothing: the pillar stands')
  const mine = fakeBot({ ctx: MINE })
  assert.equal(await mine.bot._genericPlace(blk(58, 18, 5, 'oak_planks'), V(0, 1, 0)), 'place-ok', '...for a deep non-survival placement too (the old rule)')
})

test('SURVIVAL no longer passes a baseline cell: an entombed dig of the ceiling plank, the deep cobblestone, a torch\'s support -- refused; ordinary deep rock is dug', async () => {
  const { bot, calls } = fakeBot({ ctx: ENTOMBED })
  for (const [b, why] of [[blk(57, 21, 5, 'oak_planks'), 'ceiling'], [blk(56, 19, 5, 'cobblestone'), 'cobble'], [blk(60, 20, 6, 'stone'), 'support']]) {
    await assert.rejects(bot.dig(b), e => e instanceof ProtectedZoneError, why)
  }
  assert.equal(await bot.dig(blk(57, 19, 6, 'stone')), 'dig-ok', 'positive control: the walk-out\'s rock')
  assert.equal(calls.length, 1)
  // the base let a survival dig through anything (the scenery absorbed it)
  const base = fakeBot({ zones: Z0, ctx: ENTOMBED, guardOn: false })
  assert.equal(await base.bot.dig(blk(56, 19, 5, 'cobblestone')), 'dig-ok')
})

// ---- the pathfinder (REAL mineflayer-pathfinder 2.4.5 Movements) -------------------------------------------------------
function realMoves (zones) {
  const { Movements } = require_('mineflayer-pathfinder')
  const registry = require_('prismarine-registry')('1.21.8')
  const Block = require_('prismarine-block')(registry)
  // stone to y 60, two open shafts at x 57, z 5 and z 7 from y 18 to 22, a mineshaft plank at 58,18,5
  const name = p => (p.y > 60 ? 'air' : p.x === 57 && (p.z === 5 || p.z === 7) && p.y >= 18 && p.y <= 22 ? 'air' : p.x === 58 && p.y === 18 && p.z === 5 ? 'oak_planks' : 'stone')
  const blockAt = p => { const b = Block.fromStateId(registry.blocksByName[name(p)].defaultState, 0); b.position = V(p.x, p.y, p.z); return b }
  const bot = { registry, version: '1.21.8', blockAt, entity: { position: DEEP, effects: {} }, entities: {}, inventory: { items: () => [{ name: 'cobblestone', count: 64, type: registry.itemsByName.cobblestone.id }] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot); m.canDig = true; m.allowParkour = false; m.allowSprinting = false; m.allow1by1towers = true
  m.exclusionAreasBreak = [...m.exclusionAreasBreak, zoneCost(() => zones, { feet: () => DEEP })]
  m.exclusionAreasPlace = [...m.exclusionAreasPlace, zoneCost(() => zones, { feet: () => DEEP, grow: 1 })]
  return { m, blockAt }
}
test('PATH (real Movements): no break of the baseline plank and no 1x1 tower INTO the baseline cell 57,18,5 for a deep bot; one cell over both exist', () => {
  const { m, blockAt } = realMoves(ZG)
  assert.equal(m.safeToBreak(blockAt(V(58, 18, 5))), false, 'the mineshaft plank')
  assert.equal(m.safeToBreak(blockAt(V(58, 18, 6))), true, 'stone beside it')
  const up = z => m.getNeighbors({ x: 57, y: 18, z, remainingBlocks: 64 }).find(n => n.x === 57 && n.y === 19 && n.z === z)
  assert.equal(up(5), undefined, 'THE INCIDENT\'s pillar (cobblestone into 57,18,5) is no move')
  assert.ok(up(7), 'positive control: the same tower in the open shaft at z 7')
  assert.equal(zoneCost(() => ZG, { feet: () => DEEP })({ position: V(57, 18, 5) }), ZONE_COST)
  // with no baseline the tower into 57,18,5 is a move for the deep bot (the hole); the deep plank is priced by name (the fleet's)
  const { m: m0, blockAt: b0 } = realMoves(Z0)
  assert.equal(m0.safeToBreak(b0(V(58, 18, 5))), false, 'no baseline: the name rule prices a deep plank')
  const up0 = m0.getNeighbors({ x: 57, y: 18, z: 5, remainingBlocks: 64 }).find(n => n.x === 57 && n.y === 19 && n.z === 5)
  assert.ok(up0, 'THE HOLE: with no baseline the tower into 57,18,5 is a move')
})

// ---- the reader -------------------------------------------------------------------------------------------------------
test('READER: the baseline joins by id and meeting box; a broken copy keeps the last good; removing it removes the guard; ZONEGUARD=off reads none', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zg-'))
  const zf = path.join(dir, PZ.ZONES_FILE), bf = path.join(dir, PZ.BASELINE_FILE)
  writeFileSync(zf, JSON.stringify(ZFILE)); writeFileSync(bf, JSON.stringify(BASELINE))
  const rows = []
  const rd = zoneReader({ file: () => zf, baseline: () => PZ.baselinePathFor(dir, { env: {} }), onChange: st => rows.push(PZ.protectZoneModeDetail(st)) })
  rd.refresh()
  assert.ok(structAt(rd.zones(), 57, 18, 5), 'guarded after the first read')
  assert.match(rows.at(-1), /baseline=ok guarded=1 cells=7/)
  writeFileSync(bf, '{ torn'); utimesSync(bf, new Date(), new Date(Date.now() + 5000)); rd.refresh()
  assert.ok(structAt(rd.zones(), 57, 18, 5), 'a torn baseline keeps the last good cells'); assert.match(rows.at(-1), /baseline=stale:/)
  unlinkSync(bf); rd.refresh()
  assert.equal(structAt(rd.zones(), 57, 18, 5), null, 'removed: no guard'); assert.equal(rd.zones().length, 1, 'the zone itself stays')
  // another world's baseline (same id, a box nowhere near): never joined
  const far = { zones: { 'village-taiga-6_1': { box: [5000, -64, 5000, 5100, 90, 5100], cells: { '5050,20,5050': 'minecraft:oak_planks' } } } }
  const j = withBaseline(Z0, parseBaseline(far))
  assert.equal(j.zones[0].guard, undefined); assert.deepEqual(j.state.bad, ['village-taiga-6_1:box_apart'])
  const orphan = withBaseline(Z0, parseBaseline({ zones: { other: { box: [0, 0, 0, 1, 1, 1], cells: { '0,0,0': 'minecraft:chest' } } } }))
  assert.deepEqual(orphan.state.orphan, ['other']); assert.deepEqual(orphan.state.missing, ['village-taiga-6_1'])
  // the kill switch
  writeFileSync(bf, JSON.stringify(BASELINE))
  const off = zoneReader({ file: () => zf, baseline: () => bf, guardOn: false }); off.refresh()
  assert.equal(structAt(off.zones(), 57, 18, 5), null); assert.equal(off.state().base.why, 'off')
  assert.equal(PZ.baselinePathFor(dir, { env: { PROTECT_ZONES_BASELINE: 'off' } }), null)
  assert.equal(PZ.baselinePathFor(dir, { env: {} }), bf, 'beside the zones file')
  assert.equal(PZ.baselinePathFor(path.join(dir, 'none'), { env: {}, fsx: { existsSync: p => p === PZ.SHOWCASE_BASELINE } }), PZ.SHOWCASE_BASELINE, 'else the showcase tripwire\'s copy')
})

test('WIRING (structural): index.mjs hands the reader the baseline path; the tripwire\'s file name and path are the ones trip-cron.sh uses', () => {
  const idx = strip(readFileSync(URLS.idx, 'utf8'))
  assert.equal(idx.split('baseline: () => baselinePathFor(poolStateDir(config.memory.pool))').length, 2)
  const cron = readFileSync(new URL('../../infra/showcase/trip-cron.sh', import.meta.url), 'utf8')
  assert.ok(cron.includes('--baseline $T/zones-baseline.json') && cron.includes('T=/srv/showcase/trip'), 'trip-cron.sh reads /srv/showcase/trip/zones-baseline.json')
  assert.equal(PZ.SHOWCASE_BASELINE, '/srv/showcase/trip/zones-baseline.json')
})

// ---- the no-baseline name rule (the fleet) -----------------------------------------------------------------------------
test('NO BASELINE (the fleet): a non-survival dig of a deep structure block by name is refused; deep cobblestone and stone are not; survival keeps escapeguard\'s rule', async () => {
  const { bot } = fakeBot({ zones: Z0, ctx: MINE })
  await assert.rejects(bot.dig(blk(57, 18, 5, 'oak_planks')), ProtectedZoneError)
  await assert.rejects(bot.dig(blk(57, 18, 5, 'rail')), ProtectedZoneError, 'a rail (not in the tripwire palette) too')
  assert.equal(await bot.dig(blk(56, 19, 5, 'cobblestone')), 'dig-ok', 'a bot\'s own pillar block stays open')
  assert.equal(await bot.dig(blk(57, 18, 6, 'stone')), 'dig-ok')
  const surv = fakeBot({ zones: Z0, ctx: ENTOMBED })
  assert.equal(await surv.bot.dig(blk(57, 18, 5, 'oak_planks')), 'dig-ok', 'survival: the chokepoint leaves it to escapeguard (as before)')
  assert.equal(PZ.deepNameBlocked(ZG, 57, 18, 6, 'oak_planks', DEEP), null, 'a zone WITH a baseline is exact: the name rule never runs there')
})

// ---- the composed refusal chain ----------------------------------------------------------------------------------------
test('THE PALETTE COMPOSES: every block of the tripwire\'s baseline (the 11-09 names) is a structure or a hanging block to the walk-out -- it never cuts what the chokepoint refuses', () => {
  const Block = require_('prismarine-block')('1.21.8')
  // the live 6_1 baseline's names (showcase_trip.py zones-baseline, read 11-09: 4,240 cells), deep and shallow
  for (const n of ['oak_planks', 'oak_fence', 'cobblestone', 'mossy_cobblestone', 'wall_torch', 'chest', 'spruce_log', 'dirt_path', 'spruce_planks',
    'spruce_trapdoor', 'glass_pane', 'spruce_door', 'torch', 'spruce_stairs', 'cobblestone_wall', 'lantern', 'white_carpet', 'spruce_wall_sign']) {
    const b = Block.fromString(`minecraft:${n}`, 0)
    assert.ok(ZW.isStructure(b) || ZW.ATTACHED.test(n), `${n}: the walk-out treats it as untouchable`)
  }
})

test('COMPOSED CHAIN: entombed under the mineshaft (ceiling and west wall baseline cells) -> refused there -> the walk-out tunnels SOUTH through stone, every dig through the real chokepoint, no baseline cell touched', async () => {
  const Block = require_('prismarine-block')('1.21.8')
  const edits = new Map()
  const base = (x, y, z) => {
    const k = `${x},${y},${z}`
    if (BASE_CELLS[k]) return BASE_CELLS[k].replace('minecraft:', '')
    if (x === 57 && z === 5 && (y === 19 || y === 20)) return 'air'            // the pocket Haven stood in
    return y > 60 ? 'air' : 'stone'
  }
  const at = (x, y, z) => { const b = Block.fromString(`minecraft:${edits.get(`${x},${y},${z}`) ?? base(x, y, z)}`, 0); b.position = V(x, y, z); return b }
  const solid = (x, y, z) => at(x, y, z).boundingBox === 'block'
  const dug = []
  // the chokepoint wraps a dig that really clears the cell
  const realDig = async b => { dug.push(`${b.position.x},${b.position.y},${b.position.z}`); edits.set(`${b.position.x},${b.position.y},${b.position.z}`, 'air') }
  const { bot } = fakeBot({ ctx: ENTOMBED, feet: V(57.5, 19, 5.5), dig: realDig })
  bot.blockAt = p => at(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
  bot.protectZones = () => ZG
  // the planners' first answers: the ceiling and the west wall are guarded (escapeguard, the reflex's guardMay)
  for (const [x, y, z, n] of [[57, 21, 5, 'oak_planks'], [56, 19, 5, 'cobblestone']]) {
    const g = EG.guardOf({ cell: { x, y, z }, name: n, zones: ZG, feet: bot.entity.position })
    assert.equal(EG.escapeDigDecision({ guard: g, air: true, lastResort: true }).allow, false, `${n} at ${x},${y},${z}: never, not for air, not as a last resort`)
  }
  await assert.rejects(bot.dig(at(57, 21, 5)), ProtectedZoneError, 'digStraightUp\'s ceiling: refused at the chokepoint too')
  const walk = async c => { if (!solid(c[0], c[1], c[2]) && !solid(c[0], c[1] + 1, c[2])) bot.entity.position = V(c[0] + 0.5, c[1], c[2] + 0.5) }
  const r = await ZW.zoneWalkOut(bot, { zone: ZG[0], dig: b => bot.dig(b), walk, place: async () => false })
  assert.equal(r.outcome, 'out', JSON.stringify(r))
  assert.equal(r.side, 'south', 'west (8 away) is the cobblestone wall; south is the next bearing')
  assert.ok(r.stops.some(s => /^west/.test(s)), 'the west bearing was tried and stopped')
  assert.ok(bot.entity.position.z > 45, 'out past the zone\'s south side')
  for (const k of Object.keys(BASE_CELLS)) assert.ok(!dug.includes(k), `baseline cell ${k} untouched`)
  assert.ok(dug.length >= 2 * 40, `${dug.length} ordinary cells cut`)
})

// ---- escapeguard -------------------------------------------------------------------------------------------------------
test('ESCAPEGUARD: the deep baseline cobblestone (DEEP_NATURAL by name) is the zone\'s for the planners; without a baseline it stays open (the base)', () => {
  const g = EG.guardOf({ cell: { x: 56, y: 19, z: 5 }, name: 'cobblestone', zones: ZG, feet: DEEP })
  assert.equal(g?.struct, true)
  const g0 = EG.guardOf({ cell: { x: 56, y: 19, z: 5 }, name: 'cobblestone', zones: Z0, feet: DEEP })
  assert.equal(EG.escapeDigDecision({ guard: g0 }).allow, true, 'positive control: no baseline -> the base allows it')
  assert.equal(EG.ORDINARY, PZ.ORDINARY_TERRAIN); assert.equal(EG.DEEP_NATURAL, PZ.DEEP_NATURAL_BLOCKS)
})

// ---- mutants (each anchored, unique) -----------------------------------------------------------------------------------
test('MUTANT KILLED: blockedIn without the baseline check -- the deep exemption opens the incident\'s plank to every planner again', async () => {
  await withMutant(URLS.pz, '  if (!base && q.guard && structFlagsIn(q.guard, cx, cy, cz)) return true\n', '', async m => {
    const zg = m.withBaseline(m.parseZones(ZFILE).zones, m.parseBaseline(BASELINE)).zones
    assert.equal(m.blocked(zg, 57, 18, 5, DEEP), null)
  })
})
test('MUTANT KILLED: zoneDecision without its baseline step -- an entombed bot digs the ceiling plank', async () => {
  await withMutant(URLS.pz, '  if (s) return { zone: s, struct: true }\n', '', async m => {
    const zg = m.withBaseline(m.parseZones(ZFILE).zones, m.parseBaseline(BASELINE)).zones
    assert.equal(m.zoneDecision({ zones: zg, op: 'dig', cell: { x: 57, y: 21, z: 5 }, purpose: 'survival', feet: DEEP }), null)
  })
})
test('MUTANT KILLED: placeBlocked without the destination\'s baseline step -- the pathfinder\'s pillar into 57,18,5 is priced 0', async () => {
  await withMutant(URLS.pz, 'return structAt(zones, x, y, z, PLACE_MASK) || structAt(zones, x, y + 1, z, S_CELL) ||', 'return ', async m => {
    const zg = m.withBaseline(m.parseZones(ZFILE).zones, m.parseBaseline(BASELINE)).zones
    assert.equal(m.zoneCost(() => zg, { feet: () => DEEP, grow: 1 })({ position: V(57, 18, 5) }), 0)
  })
})
test('MUTANT KILLED: the guard without supports -- the stone holding the wall_torch is dug', async () => {
  await withMutant(URLS.pz, '    if (SUPPORTED.test(n)) for', '    if (false) for', async m => {
    const zg = m.withBaseline(m.parseZones(ZFILE).zones, m.parseBaseline(BASELINE)).zones
    assert.equal(m.structAt(zg, 60, 20, 6, m.DIG_MASK), null)
  })
})
test('MUTANT KILLED: the place wrapper without roles -- the pillar ON the mineshaft plank is refused (the reference judged as a destination: a dead end)', async () => {
  await withMutant(URLS.pz, "  return role === 'ref' ? 0 : role === 'above' ? S_CELL : PLACE_MASK", "  return role === 'ref' ? PLACE_MASK : role === 'above' ? S_CELL : PLACE_MASK", async m => {
    const zg = m.withBaseline(m.parseZones(ZFILE).zones, m.parseBaseline(BASELINE)).zones
    const bot = { entity: { position: DEEP }, dig: async () => 'dig-ok', _genericPlace: async () => 'place-ok', pathfinder: { isMining: () => false, movements: {} } }
    m.attachProtectZone(bot, { zones: () => zg, context: () => ENTOMBED })
    await assert.rejects(bot._genericPlace(blk(58, 18, 5, 'oak_planks'), V(0, 1, 0)))
  })
})
test('MUTANT KILLED: escapeguard without its baseline line -- the planners would dig the ORDINARY stone that holds the wall_torch (blocked() alone calls it ordinary rock)', async () => {
  const g = EG.guardOf({ cell: { x: 60, y: 20, z: 6 }, name: 'stone', zones: ZG, feet: DEEP })
  assert.equal(EG.escapeDigDecision({ guard: g }).allow, false, 'the real one refuses the support')
  await withMutant(URLS.eg, "  if (sz) return { kind: 'zone', zone: sz.id ?? '?', ordinary: false, struct: true }\n", '', async m => {
    const gm = m.guardOf({ cell: { x: 60, y: 20, z: 6 }, name: 'stone', zones: ZG, feet: DEEP })
    assert.equal(m.escapeDigDecision({ guard: gm }).allow, true)
  })
})

// ---- r1 blockers (Codex): the walk-out never cuts a guarded support; a pour never runs into a baseline cell -----------------
test('r1 (Codex blocker 1): a baseline ANVIL beside the west tunnel (its support is guarded, the walk-out\'s own names miss it) ends that bearing -- the walk-out goes south, out, and never throws', async () => {
  const Block = require_('prismarine-block')('1.21.8')
  const cells = { '55,20,4': 'minecraft:anvil' }     // beside the west cut's head cell 55,20,5 (Codex's shape)
  const zg = withBaseline(Z0, parseBaseline({ zones: { 'village-taiga-6_1': { box: ZFILE.zones[0].box, cells } } })).zones
  const edits = new Map()
  const base = (x, y, z) => (cells[`${x},${y},${z}`] ? 'anvil' : x === 57 && z === 5 && (y === 19 || y === 20) ? 'air' : y > 60 ? 'air' : 'stone')
  const at = (x, y, z) => { const b = Block.fromString(`minecraft:${edits.get(`${x},${y},${z}`) ?? base(x, y, z)}`, 0); b.position = V(x, y, z); return b }
  const solid = (x, y, z) => at(x, y, z).boundingBox === 'block'
  const run = async (mod, zones) => {
    edits.clear()
    const bot = { entity: { position: V(57.5, 19, 5.5) }, dig: async b => { edits.set(`${b.position.x},${b.position.y},${b.position.z}`, 'air') }, _genericPlace: async () => {}, pathfinder: { isMining: () => false, movements: {} } }
    mod.PZ.attachProtectZone(bot, { zones: () => zones, context: () => ENTOMBED })
    bot.blockAt = p => at(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); bot.protectZones = () => zones
    const walk = async c => { if (!solid(c[0], c[1], c[2]) && !solid(c[0], c[1] + 1, c[2])) bot.entity.position = V(c[0] + 0.5, c[1], c[2] + 0.5) }
    return mod.ZW.zoneWalkOut(bot, { zone: zones[0], dig: b => bot.dig(b), walk })
  }
  const r = await run({ PZ, ZW }, zg)
  assert.equal(r.outcome, 'out', JSON.stringify(r)); assert.equal(r.side, 'south')
  assert.ok(r.stops.some(s => /^west .*guarded \(tripwire baseline\)/.test(s)), JSON.stringify(r.stops))
  assert.equal(at(55, 20, 4).name, 'anvil', 'the anvil stands')
  await withMutant(new URL('../src/zonewalk.mjs', import.meta.url), "    if (solid(at(nx, cy, nz)) && guarded(nx, cy, nz, DIG_MASK)) return", '    if (false) return', async m => {
    const rm = await run({ PZ, ZW: m }, zg)
    assert.notEqual(rm.outcome, 'out', 'MUTANT: the chokepoint refuses the support dig and the throw ends the firing')
    assert.ok(rm.stops.some(s => /threw: .*protected zone/.test(s)), JSON.stringify(rm.stops))
  })
})

test('r2 (Codex blocker 2 again): the pour\'s FLOW is traced -- level ground stops at 7, a DESCENDING channel carries it 30 blocks to a lower torch, uphill never, an unread cell refuses', () => {
  const Block = require_('prismarine-block')('1.21.8')
  const mkAt = fn => (x, y, z) => { const n = fn(x, y, z); if (n == null) return null; const bl = Block.fromString(`minecraft:${n}`, 0); bl.position = V(x, y, z); return bl }
  const torch = { '60,70,0': 'minecraft:torch' }
  const zg = withBaseline(Z0, parseBaseline({ zones: { 'village-taiga-6_1': { box: ZFILE.zones[0].box, cells: torch } } })).zones
  const flat = mkAt((x, y, z) => (x === 60 && y === 70 && z === 0 ? 'torch' : y <= 69 ? 'stone' : 'air'))
  assert.equal(PZ.liquidFlowReaches(zg, [[50, 70, 0]], flat), null, 'level ground, 10 away: water runs 7 and stops')
  assert.ok(PZ.liquidFlowReaches(zg, [[54, 70, 0]], flat), 'level ground, 6 away: reached')
  // Codex's channel: a 1-wide trench that drops one block every 6 cells, from x 30 (y 75) down to the torch at x 60 (y 70)
  const lowTorch = { '60,70,0': 'minecraft:torch' }
  const zl = withBaseline(Z0, parseBaseline({ zones: { 'village-taiga-6_1': { box: ZFILE.zones[0].box, cells: lowTorch } } })).zones
  const floorAt = x => 75 - Math.floor((x - 30) / 6)
  const channel = mkAt((x, y, z) => {
    if (x === 60 && y === 70 && z === 0) return 'torch'
    if (z === 0 && x >= 30 && x <= 60 && y >= Math.max(70, floorAt(x)) && y <= 80) return 'air'
    return y > 80 ? 'air' : 'stone'
  })
  assert.ok(PZ.liquidFlowReaches(zl, [[30, 75, 0]], channel), 'the channel carries the pour 30 blocks down to the torch')
  // Codex r3: a SIGN in the channel's floor (no collision box, but no liquid enters it) must not end the run there
  const signed = mkAt((x, y, z) => (x === 36 && y === 73 && z === 0 ? 'oak_sign' : channel(x, y, z)?.name))
  assert.ok(PZ.liquidFlowReaches(zl, [[30, 75, 0]], signed), 'a sign under the flow: the trace also runs on sideways')
  const uphill = mkAt((x, y, z) => (x === 60 && y === 70 && z === 0 ? 'torch' : y <= 71 ? 'stone' : 'air'))
  assert.equal(PZ.liquidFlowReaches(zl, [[58, 72, 0]], uphill), null, 'the torch is below solid ground the flow runs over (it never gets down to it)')
  assert.ok(PZ.liquidFlowReaches(zg, [[54, 70, 0]], () => null), 'an unread world: refused')
  // Claude r3: a planner's SHARED budget -- spent, the next trace is refused without reading the world
  const budget = { left: 30 }
  assert.ok(PZ.liquidFlowReaches(zg, [[50, 70, 0]], flat, { budget }), 'the level-ground trace (> 30 cells) runs out of the shared budget: refused')
  let reads = 0
  assert.ok(PZ.liquidFlowReaches(zg, [[50, 70, 0]], (...a) => { reads++; return flat(...a) }, { budget }), 'spent: refused')
  assert.ok(reads <= 8, `spent budget reads almost nothing (${reads})`)
  assert.equal(PZ.liquidFlowReaches(zg, [[20, 70, 0]], flat), null, 'outside the prefilter: no trace at all')
  assert.equal(PZ.liquidFlowReaches(Z0, [[54, 70, 0]], flat), null, 'no baseline: the old box reach only')
  // lava sets a plank wall alight from beside it
  const planks = withBaseline(Z0, parseBaseline({ zones: { 'village-taiga-6_1': { box: ZFILE.zones[0].box, cells: { '57,70,1': 'minecraft:oak_planks' } } } })).zones
  const wall = mkAt((x, y, z) => (x === 57 && y === 70 && z === 1 ? 'oak_planks' : y <= 69 ? 'stone' : 'air'))
  assert.equal(PZ.liquidFlowReaches(planks, [[54, 70, 0]], wall), null, 'water beside a plank wall changes nothing')
  assert.ok(PZ.liquidFlowReaches(planks, [[54, 70, 0]], wall, { lava: true }), 'lava beside it does')
})

test('r1 (Codex blocker 2): the chokepoint does not send a liquid bucket use within reach of a baseline cell; eating, an empty bucket and a pour far away pass', () => {
  const zg = withBaseline(Z0, parseBaseline({ zones: { 'village-taiga-6_1': { box: ZFILE.zones[0].box, cells: { '60,70,0': 'minecraft:torch' } } } })).zones
  const mk = (held, pos) => {
    const sent = []
    const bot = { entity: { position: pos }, heldItem: { name: held }, activateItem: () => { sent.push(held) }, pathfinder: { isMining: () => false, movements: {} } }
    const refusals = []
    attachProtectZone(bot, { zones: () => zg, context: () => ({ skill: 'bucket' }), onRefuse: r => refusals.push(r) })
    bot.activateItem()
    return { sent, refusals, bot }
  }
  for (const h of ['water_bucket', 'lava_bucket', 'cod_bucket']) {
    const r = mk(h, V(50.5, 70, 0.5))
    assert.deepEqual(r.sent, [], `${h} near: not sent`); assert.equal(r.refusals[0].op, 'pour'); assert.equal(r.bot.protectZone.liquid_refused, 1)
  }
  for (const [h, pos] of [['bread', V(50.5, 70, 0.5)], ['bucket', V(50.5, 70, 0.5)], ['water_bucket', V(20.5, 70, 0.5)]]) assert.deepEqual(mk(h, pos).sent, [h], `${h} at ${pos}: sent`)
  // with the world readable the flow is traced: 10 away on level ground the pour goes ahead
  const Block = require_('prismarine-block')('1.21.8')
  const sent = []
  const bot = { entity: { position: V(50.5, 70, 0.5) }, heldItem: { name: 'water_bucket' }, activateItem: () => { sent.push(1) }, pathfinder: { isMining: () => false, movements: {} },
    blockAt: p => { const bl = Block.fromString(`minecraft:${p.y <= 69 ? 'stone' : p.x === 60 && p.y === 70 && p.z === 0 ? 'torch' : 'air'}`, 0); bl.position = p; return bl } }
  attachProtectZone(bot, { zones: () => zg, context: () => ({ skill: 'bucket' }) })
  bot.activateItem()
  assert.deepEqual(sent, [1], 'traced: the flow stops 3 short of the torch')
})

test('r1 WIRING (structural): the bucket skill\'s pour and the obsidian cast\'s cells trace the flow (liquidFlowReaches)', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.equal(sk.split('try { lz = liquidFlowReaches(bot.protectZones?.() ?? [], seeds,').length, 2)
  assert.equal(sk.split('try { r = !!liquidFlowReaches(zones, [c],').length, 2)
  assert.equal(sk.split("{ lava: true, budget: flowBudget }").length, 2, 'the cast filter shares one budget')
  assert.equal(sk.split("inZone: deepObsZone(bot, { townToo: false, pour: false }) })").length, 2, 'a scoop traces nothing')
})

test('zoneguard fold (Codex BLOCKER): a designed bridge step\'s raw aimed click is guarded like any place -- a baseline cell refused, no packet sent', async () => {
  const IO = await import('../src/bridgeio.mjs')
  const mkBot = zones => {
    const writes = []
    const bot = {
      entity: { position: V(0.5, 64, 0.5), width: 0.6, height: 1.8, onGround: true, pitch: 0 }, entities: {},
      inventory: { items: () => [{ name: 'oak_planks', count: 64 }] }, heldItem: { name: 'oak_planks' }, equip: async () => {},
      blockAt: p => ({ name: 'stone', boundingBox: 'block', position: p, getProperties: () => ({}) }), lookAt: async () => {},
      _client: { write: (k, d) => writes.push(k) }, swingArm: () => {}, protectZones: () => zones,
    }
    return { bot, writes }
  }
  const step = { d: 1, aim: { yaw: 0 }, cell: [57, 18, 5], ref: [57, 17, 5], face: [0, 1, 0], item: 'oak_planks', kind: 'deck' }
  const seen = []
  const g = mkBot(ZG)
  const ok = await IO.bridgeIo(g.bot, { Vec3, walkTo: async () => true, sleep: async () => {}, onPlace: (s, k, why) => seen.push(why) }).place(step)
  assert.equal(ok, false); assert.match(String(seen[0]), /^zone:village-taiga-6_1$/); assert.deepEqual(g.writes, [], 'no packet for a guarded cell')
  const free = mkBot(ZG)
  const seen2 = []
  await IO.bridgeIo(free.bot, { Vec3, walkTo: async () => true, sleep: async () => {}, onPlace: (s, k, why) => seen2.push(why) }).place({ ...step, cell: [0, 64, 300], ref: [0, 63, 300] })
  assert.ok(free.writes.includes('block_place'), 'positive control: a cell outside every zone is clicked')
  const bad = mkBot(null); bad.bot.protectZones = () => { throw new Error('x') }
  const seen3 = []
  await IO.bridgeIo(bad.bot, { Vec3, walkTo: async () => true, sleep: async () => {}, onPlace: (s, k, why) => seen3.push(why) }).place(step)
  assert.equal(seen3[0], 'zone:zones_unread'); assert.deepEqual(bad.writes, [])
})
