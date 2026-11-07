// ESCDEAD-01SHOW / ZONEWALK (bots/src/zonewalk.mjs + escapeguard.mjs + reflex.mjs wiring): AN ESCAPE FROM UNDER A PROTECTED ZONE
// LEAVES BY A NON-ZONE ROUTE. Showcase 11-06: Nova pillared from y 36 under village-taiga-6_1 up a shaft to y 70, under a house's
// spruce_planks floor, and the escape guard's last resort dug 79,72,-10 (plank) and 80,77,-8 (log). 11-07 05:39Z: Alpha, deep at
// 53,12,31, climbed through a mineshaft and dug 3 oak_planks at 55,18..20,29 (CoreProtect): the deep exemption let them through.
//
// Proven by BEHAVIOUR on Nova's and Alpha's shapes (the zone is 6_1's real box and floor): the climb gate; the walk-out tunnel
// (out under the nearest side, a lava face skipped for the next bearing, down first from above the floor); the guard (a
// structure block guarded at every depth; the last resort never digs a zone's structure, records keep theirs; air first); the
// COMPOSED chain (gate -> guarded branch -> walk-out out, every dig ordinary); the no-exit case named; ZONEWALK=off = the base;
// anchored mutants.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require = createRequire(import.meta.url)
const Block = require('prismarine-block')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

const ZW = await import('../src/zonewalk.mjs')
const EG = await import('../src/escapeguard.mjs')
const { parseZones } = await import('../src/protectzone.mjs')
const SRC = { zw: new URL('../src/zonewalk.mjs', import.meta.url), eg: new URL('../src/escapeguard.mjs', import.meta.url), reflex: new URL('../src/reflex.mjs', import.meta.url) }
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// village-taiga-6_1, the showcase file's real box and floor
const ZONES = parseZones({ version: 1, zones: [{ id: 'village-taiga-6_1', kind: 'village', box: [49, -64, -59, 157, 90, 45], floor_y: 54 }] }).zones
const Z = ZONES[0]

// a mutable world: fn(x,y,z) -> state, overridden by edits; blocks built by prismarine-block (real boundingBox / names)
function world (fn) {
  const edits = new Map(), cache = new Map()
  const st = (x, y, z) => edits.get(`${x},${y},${z}`) ?? fn(x, y, z)
  const at = (x, y, z) => { const s = st(x, y, z); const k = `${x},${y},${z}`; const h = cache.get(k); if (h && h.s === s) return h.b; const b = Block.fromString(`minecraft:${s}`, 0); b.position = new Vec3(x, y, z); cache.set(k, { s, b }); return b }
  return { at, set: (x, y, z, s) => edits.set(`${x},${y},${z}`, s), edits }
}
// NOVA'S SHAPE: stone to y 71, a natural shaft 79,36..70,-10, a house floor of spruce_planks at y 72 (x 76..83, z -13..-6),
// spruce_log corners up to y 77, air above
const novaFn = (x, y, z) => {
  if (x === 79 && z === -10 && y >= 36 && y <= 71) return 'air'
  if (y === 72 && x >= 76 && x <= 83 && z >= -13 && z <= -6) return 'spruce_planks'
  if (y > 72 && y <= 77 && (x === 76 || x === 83) && (z === -13 || z === -6)) return 'spruce_log'
  if (y >= 72) return 'air'
  return 'stone'
}
// a fake body that walks into an open cell with a floor and falls while the cell under it is open
function fakeBot (w, feet) {
  const bot = { entity: { position: new Vec3(feet[0] + 0.5, feet[1], feet[2] + 0.5) }, health: 20, dug: [], placed: [],
    blockAt: p => w.at(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) }
  const solid = (x, y, z) => w.at(x, y, z).boundingBox === 'block'
  const fall = () => { let p = bot.entity.position; while (!solid(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)) && p.y > -60) { p = p.offset(0, -1, 0); bot.entity.position = p } }
  const fx = { bot,
    dig: async b => { bot.dug.push([b.position.x, b.position.y, b.position.z, b.name]); w.set(b.position.x, b.position.y, b.position.z, 'air') },
    place: async (c) => { bot.placed.push(c); w.set(...c, 'cobblestone'); return true },
    walk: async c => { if (!solid(c[0], c[1], c[2]) && !solid(c[0], c[1] + 1, c[2])) { bot.entity.position = new Vec3(c[0] + 0.5, c[1], c[2] + 0.5); fall() } } }
  return fx
}

// ---- the climb gate -------------------------------------------------------------------------------------------------
await t('CLIMB GATE (Nova, 70,36,-9 class): the column over the bot rises to the house floor -> hit spruce_planks; outside the box or a clean column -> none', () => {
  const w = world(novaFn)
  const hit = ZW.zoneColumnHit({ at: w.at, feet: { x: 79.5, y: 36, z: -9.5 }, zones: ZONES })
  assert.ok(hit); assert.equal(hit.zone.id, 'village-taiga-6_1'); assert.equal(hit.name, 'spruce_planks'); assert.equal(hit.cell[1], 72)
  assert.equal(ZW.zoneColumnHit({ at: w.at, feet: { x: 40.5, y: 36, z: -9.5 }, zones: ZONES }), null, 'outside the box: not the gate\'s')
  const clean = world((x, y, z) => (y >= 72 ? 'air' : 'stone'))
  assert.equal(ZW.zoneColumnHit({ at: clean.at, feet: { x: 100.5, y: 36, z: 0.5 }, zones: ZONES }), null, 'a column of ordinary rock to the sky: the climb is fine')
  assert.ok(ZW.zoneColumnHit({ at: (x, y, z) => (y > 50 ? null : w.at(x, y, z)), feet: { x: 79.5, y: 36, z: -9.5 }, zones: ZONES }), 'an unloaded column is a hit')
})

// ---- the walk-out -------------------------------------------------------------------------------------------------------
await t('WALK-OUT (Nova at y 36, deep): a straight tunnel west through stone, 31 cells, out of the footprint -- every dig ordinary, nothing above the floor touched', async () => {
  const w = world(novaFn)
  const f = fakeBot(w, [79, 36, -10])
  const r = await ZW.zoneWalkOut(f.bot, { zone: Z, ...f })
  assert.equal(r.outcome, 'out', JSON.stringify(r)); assert.equal(r.side, 'west')
  assert.ok(Math.floor(f.bot.entity.position.x) < Z.x0, `x ${f.bot.entity.position.x}`)
  assert.equal(Math.floor(f.bot.entity.position.y), 36)
  assert.ok(f.bot.dug.length > 0 && f.bot.dug.every(d => d[3] === 'stone'), 'only ordinary rock')
  assert.ok(f.bot.dug.every(d => d[1] < Z.floorY), 'nothing at or above the floor')
})
await t('WALK-OUT: a lava face ends a bearing and the next nearest is taken; a bot already outside is out at once', async () => {
  const w = world(novaFn)
  w.set(76, 37, -11, 'lava')   // beside the west tunnel 3 cells out
  const f = fakeBot(w, [79, 36, -10])
  const r = await ZW.zoneWalkOut(f.bot, { zone: Z, ...f })
  assert.equal(r.outcome, 'out', JSON.stringify(r)); assert.ok(r.stops.some(s => /west.*lava/.test(s)), r.stops.join(' | '))
  assert.notEqual(r.side, 'west')
  const g = fakeBot(world(novaFn), [40, 36, 0])
  assert.equal((await ZW.zoneWalkOut(g.bot, { zone: Z, ...g })).outcome, 'out')
})
await t('WALK-OUT FROM ABOVE THE FLOOR: down through ordinary rock below floor_y first, then the tunnel', async () => {
  const w = world((x, y, z) => (y >= 72 ? 'air' : 'stone'))
  w.set(100, 60, 0, 'air'); w.set(100, 61, 0, 'air')
  const f = fakeBot(w, [100, 60, 0])
  const r = await ZW.zoneWalkOut(f.bot, { zone: Z, ...f })
  assert.equal(r.outcome, 'out', JSON.stringify(r)); assert.ok(r.down >= 7, `down ${r.down}`)
  assert.ok(Math.floor(f.bot.entity.position.y) < Z.floorY)
})
await t('THE NO-EXIT CASE, named: inside a closed house above the floor (planks on every side and below) -> no_exit, nothing dug', async () => {
  const house = (x, y, z) => {
    if (x === 80 && z === -10 && (y === 73 || y === 74)) return 'air'
    if (y >= 72 && y <= 76 && x >= 79 && x <= 81 && z >= -11 && z <= -9) return 'spruce_planks'
    return y > 76 ? 'air' : 'stone'
  }
  const w = world(house)
  const f = fakeBot(w, [80, 73, -10])
  const r = await ZW.zoneWalkOut(f.bot, { zone: Z, ...f })
  assert.equal(r.outcome, 'no_exit', JSON.stringify(r)); assert.equal(f.bot.dug.length, 0)
  assert.ok(r.stops.some(s => /structure spruce_planks/.test(s)))
})
await t('TUNNEL STEP refusals: a structure block, water at the head, no floor without a block; with a block it bridges', () => {
  const w = world((x, y, z) => (y < 30 ? 'stone' : y === 30 ? 'stone' : 'air'))
  w.set(1, 31, 0, 'oak_planks')
  assert.match(ZW.tunnelStep({ at: w.at, from: [0, 31, 0], dx: 1, dz: 0 }).why, /structure oak_planks/)
  const wet = world((x, y, z) => (x === 1 && y === 32 ? 'water' : y <= 30 ? 'stone' : 'air'))
  assert.match(ZW.tunnelStep({ at: wet.at, from: [0, 31, 0], dx: 1, dz: 0 }).why, /water/)
  const gap = world((x, y, z) => (x === 1 && y === 30 ? 'air' : y <= 30 ? 'stone' : 'air'))
  assert.match(ZW.tunnelStep({ at: gap.at, from: [0, 31, 0], dx: 1, dz: 0 }).why, /no floor/)
  assert.deepEqual(ZW.tunnelStep({ at: gap.at, from: [0, 31, 0], dx: 1, dz: 0, canPlace: true }).place, [1, 30, 0])
})

// ---- r1 blocker fixes (Codex 1-7, Claude 1) -----------------------------------------------------------------------------
await t('r1: WATER on a face of the cut, a RAIL standing on the head cut, a GRAVEL block over the head -> each refuses the bearing', () => {
  const base = (x, y, z) => (y <= 30 ? 'stone' : y <= 33 ? 'stone' : 'air')
  const open0 = (w) => { w.set(0, 31, 0, 'air'); w.set(0, 32, 0, 'air') }
  const wet = world(base); open0(wet); wet.set(1, 33, 0, 'water')
  assert.match(ZW.tunnelStep({ at: wet.at, from: [0, 31, 0], dx: 1, dz: 0 }).why, /water beside/)
  const rail = world(base); open0(rail); rail.set(1, 33, 0, 'rail[shape=north_south,waterlogged=false]')
  assert.match(ZW.tunnelStep({ at: rail.at, from: [0, 31, 0], dx: 1, dz: 0 }).why, /rail hangs on/)
  const grav = world(base); open0(grav); grav.set(1, 33, 0, 'gravel')
  assert.match(ZW.tunnelStep({ at: grav.at, from: [0, 31, 0], dx: 1, dz: 0 }).why, /gravel over the head cut/)
  const ok = world(base); open0(ok)
  assert.equal(ZW.tunnelStep({ at: ok.at, from: [0, 31, 0], dx: 1, dz: 0 }).ok, true, 'positive control: plain stone')
})
await t('r1: the gate scans to the BOX TOP (feet y 12, a plank at y 72) and only the bot\'s own column', () => {
  const w = world((x, y, z) => (x === 60 && z === 0 && y === 72 ? 'oak_planks' : x === 61 && z === 0 && y === 40 ? 'oak_planks' : 'stone'))
  assert.equal(ZW.zoneColumnHit({ at: w.at, feet: { x: 60.5, y: 12, z: 0.5 }, zones: ZONES })?.cell?.[1], 72)
  assert.equal(ZW.zoneColumnHit({ at: w.at, feet: { x: 62.5, y: 12, z: 0.5 }, zones: ZONES }), null, 'a neighbour column\'s plank does not gate this one')
})
await t('r1: a SEALED CORRIDOR is no progress -- walking it end to end twice reports no_exit the second time (best carried)', async () => {
  const corr = (x, y, z) => {
    if (z === 0 && y >= 30 && y <= 31 && x >= 100 && x <= 104) return 'air'
    if (y >= 29 && y <= 32 && z >= -1 && z <= 1 && x >= 99 && x <= 105) return 'oak_planks'
    return 'stone'
  }
  const w = world(corr)
  const f = fakeBot(w, [102, 30, 0])
  const r1 = await ZW.zoneWalkOut(f.bot, { zone: Z, ...f })
  const r2 = await ZW.zoneWalkOut(f.bot, { zone: Z, ...f, best: r1.best })
  assert.equal(r2.outcome, 'no_exit', JSON.stringify(r2)); assert.equal(f.bot.dug.length, 0)
})
await t('r1: OWNERSHIP before every effect -- a rescue taking the body during the first dig meets no second dig', async () => {
  const w = world(novaFn)
  const f = fakeBot(w, [79, 36, -10])
  let digs = 0, taken = false
  const res = await ZW.zoneWalkOut(f.bot, { zone: Z, ...f, dig: async b => { digs++; taken = true; await f.dig(b) }, yieldTo: () => (taken ? 'drowning rescue' : null) })
  assert.equal(res.outcome, 'yielded'); assert.equal(digs, 1)
})
await t('r1: a structure block a BUILD RECORD also covers is the zone\'s -- the last resort still refuses it', () => {
  const g = EG.guardOf({ cell: { x: 79, y: 72, z: -10 }, name: 'spruce_planks', zones: ZONES, feet: { x: 79.5, y: 70, z: -9.5 }, recordAt: () => 'house', zoneWalk: true })
  assert.equal(g.kind, 'zone')
  assert.equal(EG.escapeDigDecision({ guard: g, lastResort: true, zoneWalk: true }).allow, false)
  assert.equal(EG.guardOf({ cell: { x: 79, y: 72, z: -10 }, name: 'spruce_planks', zones: ZONES, recordAt: () => 'house', zoneWalk: false }).kind, 'record', 'the base: the record first')
})

// ---- the escape guard ---------------------------------------------------------------------------------------------------
await t('GUARD (Alpha, 11-07 05:39Z): a mineshaft plank deep under the village is guarded for a deep bot; ordinary deep rock is not; ZONEWALK=off = the base exemption', () => {
  const feet = { x: 53.3, y: 12, z: 31.5 }
  const g = EG.guardOf({ cell: { x: 55, y: 19, z: 29 }, name: 'oak_planks', zones: ZONES, feet, zoneWalk: true })
  assert.equal(g?.kind, 'zone'); assert.equal(g.ordinary, false); assert.equal(g.deep, true)
  assert.equal(EG.guardOf({ cell: { x: 55, y: 19, z: 29 }, name: 'stone', zones: ZONES, feet, zoneWalk: true }), null, 'deep ordinary rock: open (as before)')
  assert.equal(EG.guardOf({ cell: { x: 55, y: 19, z: 29 }, name: 'rail', zones: ZONES, feet, zoneWalk: true })?.kind, 'zone')
  for (const n of ['copper_block', 'cut_copper', 'iron_bars', 'stone_bricks', 'oak_fence']) {
    assert.equal(EG.guardOf({ cell: { x: 55, y: 19, z: 29 }, name: n, zones: ZONES, feet, zoneWalk: true })?.kind, 'zone', `deep built ${n} is guarded (Codex r2)`)
  }
  for (const n of ['cobblestone', 'pointed_dripstone', 'amethyst_block', 'sculk', 'obsidian']) {
    assert.equal(EG.guardOf({ cell: { x: 55, y: 19, z: 29 }, name: n, zones: ZONES, feet, zoneWalk: true }), null, `deep ${n} (natural, or a bot's own pillar): open as before (Claude r1 note 1)`)
  }
  assert.equal(EG.guardOf({ cell: { x: 55, y: 19, z: 29 }, name: 'oak_planks', zones: ZONES, feet, zoneWalk: false }), null, 'the base: the deep exemption')
  assert.equal(EG.guardOf({ cell: { x: 30, y: 19, z: 29 }, name: 'oak_planks', zones: ZONES, feet: { x: 30, y: 12, z: 29 }, zoneWalk: true }), null, 'outside the box: unguarded')
})
await t('LAST RESORT (Nova, 11-06): never a zone\'s structure; a build record keeps its last resort; air first is unchanged; ZONEWALK=off = the base', () => {
  const zone = { kind: 'zone', zone: 'village-taiga-6_1', ordinary: false }
  assert.deepEqual(EG.escapeDigDecision({ guard: zone, lastResort: true, zoneWalk: true }), { allow: false, why: 'zone' })
  assert.equal(EG.escapeDigDecision({ guard: { kind: 'record', what: 'house' }, lastResort: true, zoneWalk: true }).allow, true)
  assert.deepEqual(EG.escapeDigDecision({ guard: zone, air: true, zoneWalk: true }), { allow: true, why: 'air' })
  assert.deepEqual(EG.escapeDigDecision({ guard: zone, lastResort: true, zoneWalk: false }), { allow: true, why: 'last_resort' })
  assert.equal(EG.escapeDigDecision({ guard: { ...zone, ordinary: true }, zoneWalk: true }).why, 'ordinary')
})

// ---- the composed chain -------------------------------------------------------------------------------------------------
await t('COMPOSED CHAIN (Nova\'s shape): the gate refuses the climb -> the guarded branch\'s walk-out tunnels out under the west side; the last resort would have refused the plank anyway', async () => {
  const w = world(novaFn)
  const f = fakeBot(w, [79, 36, -10])
  const hit = ZW.zoneColumnHit({ at: w.at, feet: f.bot.entity.position, zones: ZONES })
  assert.ok(hit, 'the gate fires at y 36, before any climb')
  const r = await ZW.zoneWalkOut(f.bot, { zone: hit.zone, ...f })
  assert.equal(r.outcome, 'out')
  assert.equal(w.at(79, 72, -10).name, 'spruce_planks', 'the house floor stands')
  assert.equal(EG.escapeDigDecision({ guard: EG.guardOf({ cell: { x: 79, y: 72, z: -10 }, name: 'spruce_planks', zones: ZONES, feet: { x: 79.5, y: 70, z: -9.5 } }), lastResort: true }).allow, false)
})

// ---- wiring (structural: the reflex closure) ----------------------------------------------------------------------------
await t('WIRING: both arms gate the climb; the guarded branch walks out first; the walk-out row and the no-exit rescue call exist', () => {
  const s = stripComments(readFileSync(SRC.reflex, 'utf8'))
  assert.equal(s.split("if (zoneClimbGate(bot, 'marooned')) pillarOutcome = ESCAPE_GUARDED").length, 2)
  assert.equal(s.split("if (zoneClimbGate(bot, 'entombed')) climbed = ESCAPE_GUARDED").length, 2)
  assert.ok(s.includes("!zoneClimbGate(bot, 'entombed_climbing')") && s.includes("!zoneClimbGate(bot, 'marooned_climbing')"), 'every climb step re-asks the gate')
  assert.equal(s.split("const walked = await walkOut(bot, { handler, yieldTo })").length, 2)
  assert.equal(s.split("Date.now() >= zoneWalkNextAt && zoneClimbGate(bot, `marooned_${mstate}`)").length, 2, 'the marooned need_pickaxe/scaffold states walk out first (Gale)')
  assert.ok(s.includes("kind: 'zone_walk'") && s.includes('arm=zone_walk'))
})

// ---- mutants ------------------------------------------------------------------------------------------------------------
await t('MUTANT KILLED: the guard without the every-depth structure rule lets Alpha\'s plank through', async () => {
  await withMutant(SRC.eg, "  const zs = zoneWalk ? zoneStructureAt(zones, c, name) : null", '  const zs = null', async m => {
    assert.equal(m.guardOf({ cell: { x: 55, y: 19, z: 29 }, name: 'oak_planks', zones: ZONES, feet: { x: 53.3, y: 12, z: 31.5 }, zoneWalk: true }), null)
  })
})
await t('MUTANT KILLED: the last resort digging zone structure again (Nova\'s plank)', async () => {
  await withMutant(SRC.eg, "  if (lastResort && zoneWalk && guard.kind === 'zone') return { allow: false, why: 'zone' }\n", '', async m => {
    assert.equal(m.escapeDigDecision({ guard: { kind: 'zone', ordinary: false }, lastResort: true, zoneWalk: true }).allow, true)
  })
})
await t('MUTANT KILLED: a tunnel step that ignores structure blocks digs into a plank', async () => {
  await withMutant(SRC.zw, "    if (isStructure(b)) return { ok: false, dig: [], place: null, why: `structure", "    if (false) return { ok: false, dig: [], place: null, why: `structure", async m => {
    const w = world((x, y, z) => (y <= 30 ? 'stone' : 'air')); w.set(1, 31, 0, 'oak_planks')
    assert.equal(m.tunnelStep({ at: w.at, from: [0, 31, 0], dx: 1, dz: 0 }).ok, true)
  })
})
await t('MUTANT KILLED: the climb gate without its structure test lets Nova climb toward the house', async () => {
  await withMutant(SRC.zw, '      if (isStructure(b)) return { zone, cell: [fx + dx, y, fz + dz], name: b.name }', '      if (false) return null', async m => {
    assert.equal(m.zoneColumnHit({ at: world(novaFn).at, feet: { x: 79.5, y: 36, z: -9.5 }, zones: ZONES }), null)
  })
})
await t('MUTANT KILLED: the walk-out without the down step tunnels at y 60 above the floor', async () => {
  await withMutant(SRC.zw, "    while (zone.kind === 'village' && zone.floorY != null && here()[1] >= zone.floorY && res.down < DOWN_MAX) {", '    while (false) {', async m => {
    const w = world((x, y, z) => (y >= 72 ? 'air' : 'stone')); w.set(100, 60, 0, 'air'); w.set(100, 61, 0, 'air')
    const f = fakeBot(w, [100, 60, 0])
    const r = await m.zoneWalkOut(f.bot, { zone: Z, ...f })
    assert.ok(f.bot.dug.some(d => d[1] >= Z.floorY), 'the mutant digs above the floor')
    assert.equal(r.down, 0)
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
