// TOWNPLAN-01, THE PLANNER: READY cells, joint access, the greenfield / annex / retrofit fits, sectors around protected zones,
// the keep-out tiers, the maintenance marks and growth, the audit. Design docs/reports/town-plan-2026-10-20.md sections 3-6; build
// spec docs/reports/townplan-found-spec-2026-10-21.md section 1 (both engines APPROVE r7).
//
// Behaviour over pure reads (a fake `read(x, y, z)`: flat grass, cells set by name, boxes from minecraft-data 1.21.8), the
// SHOWCASE's own ground (its read-only block dump, the fixture townplan-showcase-dump.json), protectzone-01's showcase zones file
// as the shared fixture, then anchored mutants (the anchor present and unique, or the mutant is not a kill).
import assert from 'node:assert'
import fs from 'node:fs'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const T = await import('../src/townplan.mjs')
const PS = await import('../src/planstore.mjs')
const TP_PATH = new URL('../src/townplan.mjs', import.meta.url)
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
async function killedBy (fn) { try { await fn(); return false } catch { return true } }

/** A fake world: grass at y <= G, air above, cells set by name (a snow layer carries props), unknown outside `bounds`. */
const G = 69
function world ({ cells = {}, ground = G, bounds = null, props = {} } = {}) {
  const box = n => mcData.blocksByName[n.replace(/\[waterlogged\]$/, '')]?.boundingBox ?? 'block'
  // vanilla's collision shapes where they matter: mud and soul sand are 14/16 high (chestLidBlocked alone passes them)
  const shapes = n => /^(mud|soul_sand)$/.test(n) ? [[0, 0, 0, 1, 0.875, 1]] : box(n) === 'block' && !/(_slab|_stairs|_leaves)$/.test(n) ? [[0, 0, 0, 1, 1, 1]] : []
  const read = (x, y, z) => {
    if (bounds && (x < bounds[0] || x > bounds[2] || z < bounds[1] || z > bounds[3])) return null
    const k = `${x},${y},${z}`
    const name = cells[k] ?? (y <= ground ? (y === ground ? 'grass_block' : 'dirt') : 'air')
    return { name, boundingBox: box(name), shapes: shapes(name), props: props[k] ?? null }
  }
  return read
}
const HOME = { x: 100, y: 70, z: 100 }
const set = (cells, list, name) => { for (const [x, y, z] of list) cells[`${x},${y},${z}`] = name; return cells }

console.log('townplan: READY')
await t('READY: a flat grass cell is ready; the floor, the cell, the lid, liquid, saplings, furniture and wells each refuse', () => {
  const at = [110, 70, 100]
  assert.equal(T.readyCell(world(), at, { home: HOME }), null)
  assert.match(T.readyCell(world({ cells: { '110,69,100': 'oak_slab' } }), at, { home: HOME }), /floor oak_slab/)
  assert.match(T.readyCell(world({ cells: { '110,70,100': 'stone' } }), at, { home: HOME }), /cell stone/)
  assert.match(T.readyCell(world({ cells: { '111,70,100': 'water' } }), at, { home: HOME }), /liquid within 1/)
  assert.match(T.readyCell(world({ cells: { '111,70,101': 'oak_sapling' } }), at, { home: HOME }), /sapling within 1/)
  assert.match(T.readyCell(world({ cells: { '111,70,100': 'chest' } }), at, { home: HOME }), /chest within 1/)
  assert.equal(T.readyCell(world({ cells: { '111,70,100': 'chest' } }), at, { home: HOME, planned: new Set(['111,70,100']) }), null, 'the plan\'s own cell is no obstacle (Codex spec r1 P1)')
  assert.match(T.readyCell(world(), at, { home: HOME, wells: [{ x: 113, y: 70, z: 100 }] }), /well cap within 3/)
  assert.equal(T.readyCell(world(), at, { home: HOME, wells: [{ x: 114, y: 70, z: 100 }] }), null)
  assert.match(T.readyCell(world(), at, { home: HOME, zones: [{ id: 'v', box: [105, -64, 95, 115, 90, 105] }] }), /protected zone/)
  assert.match(T.readyCell(world(), [100, 70, 100], { home: HOME }), /home column/)
  assert.equal(T.readyCell(world({ bounds: [0, 0, 0, 0] }), at, { home: HOME }), 'unknown', 'an unread cell is never ready')
})
await t('READY (the showcase ground, r6): ferns and tall grass are replaced; a trunk beside a cell is fine; leaves above open a chest', () => {
  const at = [110, 70, 100]
  for (const plant of ['short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush']) assert.equal(T.readyCell(world({ cells: { '110,70,100': plant } }), at, { home: HOME }), null, plant)
  assert.equal(T.readyCell(world({ cells: { '111,70,100': 'spruce_log', '111,71,100': 'spruce_log' } }), at, { home: HOME }), null, 'a trunk does not grow into the cell')
  assert.equal(T.readyCell(world({ cells: { '110,71,100': 'spruce_leaves' } }), at, { home: HOME }), null, 'leaves never block a lid')
})
await t('READY (Codex/Claude spec r6): snow only at ONE layer; the lid by chestLidBlocked OR serverLidBlocks (stone, mud, soul sand block; glass opens); name-only reads too', () => {
  const at = [110, 70, 100]
  assert.equal(T.readyCell(world({ cells: { '110,70,100': 'snow' }, props: { '110,70,100': { layers: 1 } } }), at, { home: HOME }), null)
  assert.match(T.readyCell(world({ cells: { '110,70,100': 'snow' }, props: { '110,70,100': { layers: 2 } } }), at, { home: HOME }), /cell snow:2/)
  assert.match(T.readyCell(world({ cells: { '110,70,100': 'snow' } }), at, { home: HOME }), /cell snow:\?/, 'an unreadable depth is not ready')
  assert.match(T.readyCell(world({ cells: { '110,71,100': 'stone' } }), at, { home: HOME }), /lid stone/)
  assert.match(T.readyCell(world({ cells: { '110,71,100': 'mud' } }), at, { home: HOME }), /lid mud/)
  assert.match(T.readyCell(world({ cells: { '110,71,100': 'soul_sand' } }), at, { home: HOME }), /lid soul_sand/)
  assert.equal(T.readyCell(world({ cells: { '110,71,100': 'glass' } }), at, { home: HOME }), null)
  // NAME-ONLY reads (no shapes: the offline dump), Claude spec r7 P3
  const bare = (x, y, z) => { const r = world({ cells: { '110,71,100': 'stone', '111,71,99': 'oak_leaves' } })(x, y, z); return r ? { name: r.name, boundingBox: r.boundingBox } : null }
  assert.match(T.readyCell(bare, at, { home: HOME }), /lid stone/)
  assert.equal(T.readyCell((x, y, z) => { const r = world({ cells: { '110,71,100': 'oak_leaves' } })(x, y, z); return r ? { name: r.name, boundingBox: r.boundingBox } : null }, at, { home: HOME }), null)
})

console.log('townplan: geometry and joint access')
await t('RING@1: 7 store chests never share a side, fill order from the door, all within 15.9; 5 stations; rotations', () => {
  for (const o of T.ORIENTS) {
    const g = T.ring1(HOME, 69, o, 1)
    assert.equal(g.cells.length, 7); assert.equal(g.stations.length, 5)
    for (const a of g.cells) for (const b of g.cells) if (a !== b) assert.ok(Math.abs(a.at[0] - b.at[0]) + Math.abs(a.at[2] - b.at[2]) > 1, 'two chests share a side')
    for (const c of g.cells) assert.ok(Math.hypot(c.at[0] - HOME.x, c.at[2] - HOME.z) <= 15.9)
    assert.deepEqual(g.stations.map(s => s.kind), ['crafting_table', 'furnace', 'furnace', 'crafting_table', 'furnace'])
    for (let x = g.storeBox[0]; x <= g.storeBox[2]; x++) for (let z = g.storeBox[1]; z <= g.storeBox[3]; z++) assert.ok(Math.hypot(x - HOME.x, z - HOME.z) <= 15.9)
  }
  const e = T.ring1(HOME, 69, 'E', 1)
  assert.deepEqual(e.cells[0].at, [109, 70, 98], 'the overflow cell is (9,-2), nearest the door')
  assert.deepEqual(T.ring1(HOME, 69, 'W', 1).cells[0].at, [91, 70, 102])
})
await t('JOINT ACCESS: a cell whose only stand another cell fills is dropped; an existing container cut off refuses the set (Codex spec r1 P1)', () => {
  // a corridor: home at the west end of a 1-wide trench of air between stone walls
  const cells = {}
  for (let x = 95; x <= 125; x++) for (let z = 95; z <= 105; z++) for (let y = 70; y <= 72; y++) if (z !== 100) cells[`${x},${y},${z}`] = 'stone'
  for (let x = 103; x <= 125; x++) cells[`${x},72,100`] = 'stone'   // a roof: nobody walks over a filled cell
  const read = world({ cells })
  const at = x => ({ at: [x, 70, 100], kind: 'chest', stand: null })
  // two cells in the corridor: the nearer one walls the farther off
  const r = T.jointAccess(read, HOME, [at(110), at(115)])
  assert.deepEqual(r.ok.map(c => c.at[0]), [110]); assert.equal(r.dropped.length, 1)
  // an existing chest at the far end, reachable now, is cut off by a candidate in the corridor: the set is refused whole
  cells['118,70,100'] = 'chest'
  const r2 = T.jointAccess(world({ cells }), HOME, [at(110)], { existing: [[118, 70, 100]] })
  assert.equal(r2.ok.length, 0); assert.equal(r2.cuts.length, 1)
})

console.log('townplan: the fits')
await t('GREENFIELD on flat ground: E qualifies first (12 of 12), a clear pad, s 69, the composter on the farm edge', () => {
  const r = T.fitTown(world(), HOME, {})
  assert.equal(r.mode, 'greenfield'); assert.equal(r.summary.orient, 'E'); assert.equal(r.summary.ready, '12/12')
  assert.equal(r.body.s, 69); assert.equal(r.body.plots.find(p => p.id === 'store').building, 'clear')
  const farm = r.body.plots.find(p => p.id === 'farm')
  assert.ok(farm.composter, 'a composter cell'); assert.equal(farm.sector, 'N')
})
await t('GREENFIELD: water on the E pad -> another orientation; a seed orientation is honoured when it qualifies, ignored when not', () => {
  const cells = {}
  for (let x = 107; x <= 115; x++) for (let z = 96; z <= 104; z++) cells[`${x},69,${z}`] = 'water'
  const r = T.fitTown(world({ cells }), HOME, {})
  assert.notEqual(r.summary.orient, 'E')
  assert.equal(T.fitTown(world(), HOME, { seed: { orientation: 'N' } }).summary.orient, 'N')
  assert.notEqual(T.fitTown(world({ cells }), HOME, { seed: { orientation: 'E' } }).summary.orient, 'E', 'a seed that does not qualify is not taken')
})
await t('GREENFIELD (r6): ANY 4 chest cells qualify -- an unready overflow cell costs nothing', () => {
  // knock out the E overflow cell's floor and the next one: 5 chests stay ready
  const r = T.fitGreenfield(world({ cells: { '109,69,98': 'air', '109,69,102': 'air' } }), HOME, {})
  const e = r.tried.find(x => x.orient === 'E' && x.side === 1)
  assert.equal(e.qualifies, true, 'E still qualifies with its overflow and second cells unready')
  assert.equal(e.ja.ok.filter(c => c.kind === 'chest').length, 5)
  assert.notEqual(r.fit.orient, 'E', 'the fit with MORE kept cells wins (the rule)')
})
await t('THE SHOWCASE GROUND (its read-only block dump): ring@1 fits W, s 70, 12 of 12 READY and reachable, a clear pad; no cell in the village or the trial chambers', () => {
  const dump = JSON.parse(fs.readFileSync(new URL('./fixtures/townplan-showcase-dump.json', import.meta.url), 'utf8'))
  const [x0, z0, x1, z1] = dump.box, [y0, y1] = dump.y
  const nx = x1 - x0 + 1, nz = z1 - z0 + 1
  const buf = Buffer.from(dump.cells, 'base64'); const cells = dump.bits === 8 ? new Uint8Array(buf.buffer, buf.byteOffset, buf.length) : new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2)
  const pal = dump.palette.map(n => {
    if (n === '?') return null
    const snow = /^snow\[layers=(\d+)\]/.exec(n)
    const name = snow ? 'snow' : n
    return { name, boundingBox: mcData.blocksByName[name.replace(/\[waterlogged\]$/, '')]?.boundingBox ?? 'block', ...(snow ? { props: { layers: Number(snow[1]) } } : {}) }
  })
  const read = (x, y, z) => (x < x0 || x > x1 || z < z0 || z > z1 || y < y0 || y > y1) ? null : pal[cells[((y - y0) * nz + (z - z0)) * nx + (x - x0)]]
  const zones = T.parseZones(JSON.parse(fs.readFileSync(new URL('./fixtures/protected-zones.showcase.json', import.meta.url), 'utf8')), '1292467317:1056448044')
  assert.equal(zones.zones.length, 8)
  // the seed's avoid boxes as infra/showcase/town-site.json carries them (the start gate's own input)
  const site = JSON.parse(fs.readFileSync(new URL('../../infra/showcase/town-site.json', import.meta.url), 'utf8'))
  const avoid = T.avoidZones(site.town_plan.avoid)
  const r = T.fitTown(read, { x: 0, y: 70, z: 0 }, { zones: [...zones.zones, ...avoid] })
  assert.equal(r.summary.orient, 'W'); assert.equal(r.body.s, 70); assert.equal(r.summary.ready, '12/12')
  for (const p of r.body.plots) for (const c of [...(p.cells ?? []), ...(p.stations ?? [])]) assert.equal(T.cellInZones(...c.at, [...zones.zones, ...avoid]), null)
  const shaft = r.body.plots.find(p => p.id === 'shaft')
  assert.equal(T.boxMeetsZones(T.sectorExtent({ x: 0, y: 70, z: 0 }, 70, 'shaft', shaft.sector), [...zones.zones, ...avoid]), null, 'the shaft digs nowhere near a zone')
})
await t('THE ANNEX (design 4.5 step 2): exactly 1, 2 and 5 READY cells -- the table first; 1 cell is the table and the store is unplaced', () => {
  // everything around home is water but a few dry cells at Chebyshev 8
  const mk = n => {
    const cells = {}
    for (let x = 80; x <= 120; x++) for (let z = 80; z <= 120; z++) cells[`${x},69,${z}`] = 'water'
    const dry = [[108, 92], [108, 96], [108, 100], [108, 104], [108, 108]].slice(0, n)
    // a dry causeway from home to the dry cells (the walk), but only those cells READY (the causeway is a path of slabs)
    // slabs (a walkable floor that is never READY) under the causeway and round each dry cell, so no water is within 1
    for (let x = 98; x <= 110; x++) for (let z = 98; z <= 102; z++) cells[`${x},69,${z}`] = 'smooth_stone_slab'
    for (let x = 107; x <= 110; x++) for (let z = 88; z <= 112; z++) cells[`${x},69,${z}`] = 'smooth_stone_slab'
    for (const [x, z] of dry) cells[`${x},69,${z}`] = 'grass_block'
    return world({ cells })
  }
  const one = T.fitAnnex(mk(1), HOME, {})
  assert.equal(one.cells.length, 1); assert.equal(one.cells[0].kind, 'crafting_table')
  const b1 = T.greenfieldBody(HOME, null, { annex: one })
  assert.equal(b1.plots.find(p => p.id === 'store').kind, 'unplaced')
  const two = T.fitAnnex(mk(2), HOME, {})
  assert.deepEqual(two.cells.map(c => c.kind), ['crafting_table', 'chest'])
  const five = T.fitAnnex(mk(5), HOME, {})
  assert.equal(five.cells[0].kind, 'crafting_table'); assert.ok(five.cells.filter(c => c.kind === 'chest').length >= 2)
})
await t('RETROFIT: containers in town -> cluster store, groups waiting until every container has an observation, then allocated; a workshop strip off every container', async () => {
  const cells = {}
  const chests = [[96, 70, 96], [98, 70, 96], [100, 70, 96], [104, 70, 104]]
  set(cells, chests, 'chest')
  const read = world({ cells })
  const containers = chests.map(([x, y, z], i) => ({ k: `${x},${y},${z}`, halves: 1, at: [x, y, z], obs: i < 3 ? { iron_ingot: [10 + i, 1], cobblestone: [64, 1] } : null }))
  const allocate = (await import('../src/townindex.mjs')).allocateHomes
  T.setGroupOf((await import('../src/townindex.mjs')).groupOfItem)
  const r = T.fitTown(read, HOME, { containers, existing: chests, allocate })
  assert.equal(r.mode, 'retrofit'); assert.equal(r.body.plots.find(p => p.id === 'store').kind, 'cluster')
  assert.equal(r.body.groups.status, 'waiting'); assert.equal(r.body.groups.unknown, 1)
  const work = r.body.plots.find(p => p.id === 'work')
  assert.ok(work, 'a workshop strip'); assert.equal(work.size, '5x3')
  for (const st of work.stations) {
    assert.ok(Math.max(Math.abs(st.at[0] - HOME.x), Math.abs(st.at[2] - HOME.z)) >= 7)
    assert.ok(Math.hypot(st.stand[0] - HOME.x, st.stand[2] - HOME.z) <= 16, 'stands inside inTown (Claude spec r1 P2)')
  }
  // the last container is counted: the next maintenance step allocates
  const plan = { ...r.body, v: 1, gen: 1, prev: null, prevSha: null, world: 'w', at: 0, by: 'x', transitions: [] }
  const counted = containers.map(c => ({ ...c, obs: c.obs ?? { dirt: [5, 1] } }))
  const m = T.maintainPlan(plan, read, { now: 1000, containers: counted, allocate })
  assert.equal(m.op, 'alloc'); assert.equal(m.body.groups.status, 'allocated'); assert.ok(m.body.groups.homes.metal?.length)
})

console.log('townplan: zones, sectors, keep-outs')
await t('THE SHOWCASE AGREES WITH ITSELF (coordinator 10-22): every avoid box of infra/showcase/town-site.json is a zone of the showcase protected-zones file (the fixture copy), id and box', () => {
  const site = JSON.parse(fs.readFileSync(new URL('../../infra/showcase/town-site.json', import.meta.url), 'utf8'))
  const zones = JSON.parse(fs.readFileSync(new URL('./fixtures/protected-zones.showcase.json', import.meta.url), 'utf8')).zones
  assert.ok(site.town_plan.avoid.length >= 1)
  for (const a of site.town_plan.avoid) assert.ok(zones.some(z => z.id === a.id && JSON.stringify(z.box) === JSON.stringify(a.box)), `${a.id} ${a.box} is not a zone`)
  assert.equal(site.builds_core, true, 'the coordinator default: no stamp')
})
await t('ZONES (the shared fixture with protectzone-01): 7 villages and the trial chambers bound to the showcase world; another world 0; a malformed zone dropped and named; all malformed unreadable', () => {
  const json = JSON.parse(fs.readFileSync(new URL('./fixtures/protected-zones.showcase.json', import.meta.url), 'utf8'))
  assert.equal(T.parseZones(json, '1292467317:1056448044').zones.length, 8)
  assert.equal(T.parseZones(json, 'other:world').zones.length, 0); assert.equal(T.parseZones(json, 'other:world').ok, true)
  const bad = { ...json, zones: [...json.zones, { id: 'typo', box: [0, 0, 0, 5000, 10, 10] }] }
  const r = T.parseZones(bad, '1292467317:1056448044')
  assert.ok(r.ok); assert.equal(r.zones.length, 8); assert.match(r.why, /dropped typo/)
  assert.equal(T.parseZones({ version: 1, zones: [{ id: 'x', box: [1, 2] }] }, null).ok, false)
  assert.equal(T.parseZones({ version: 2, zones: [] }, null).ok, false)
})
await t('SECTORS: a monument extent over the village takes another sector; the shaft column avoids an underground box only when it meets it', () => {
  const village = { id: 'v', box: [49 + HOME.x, -64, -59 + HOME.z, 157 + HOME.x, 90, 45 + HOME.z] }
  const free = T.assignOuter(HOME, 69, { zones: [] })
  const blocked = T.assignOuter(HOME, 69, { zones: [village], fixed: { monument: 'E' } })
  assert.equal(blocked.find(p => p.id === 'monument').sector === 'E', false, 'never over the village')
  assert.ok(free.every(p => p.sector))
  const under = { id: 'trial', box: [HOME.x + 5, -43, HOME.z - 30, HOME.x + 40, 27, HOME.z - 5] }   // under the NE
  const r = T.assignOuter(HOME, 69, { zones: [under] })
  assert.notEqual(r.find(p => p.id === 'shaft').sector, 'NE')
})
await t('KEEP-OUT TIERS: plan cells and reserved/placed stands NEVER; a committed box BOX; an uncommitted box and paths SOFT; elsewhere null', () => {
  const r = T.fitTown(world(), HOME, {})
  const plan = { ...r.body }
  const ko0 = T.keepouts(plan)
  const store = plan.plots.find(p => p.id === 'store')
  const c0 = store.cells[0].at
  assert.equal(ko0.tier(...c0), 'never')
  assert.equal(ko0.tier(108, 70, 96 + 8), 'soft', 'an uncommitted store box is soft')
  assert.equal(ko0.tier(60, 70, 60), null)
  Object.assign(store.cells[0], { state: 'placed', by: 'a', visit: 'v' })
  const ko1 = T.keepouts(plan)
  assert.equal(ko1.tier(108, 70, 104), 'box', 'a committed store box is BOX')
  assert.equal(ko1.tier(...store.cells[0].stand), 'never', 'a placed cell\'s stand')
  assert.equal(T.tierAllowed(null, 1), true); assert.equal(T.tierAllowed('soft', 1), false); assert.equal(T.tierAllowed('soft', 2), true)
  assert.equal(T.tierAllowed('box', 2), false); assert.equal(T.tierAllowed('box', 3), true); assert.equal(T.tierAllowed('never', 3), false)
})

console.log('townplan: maintenance, growth, audit')
const basePlan = () => { const r = T.fitTown(world(), HOME, {}); return { ...r.body, v: 1, gen: 1, prev: null, prevSha: null, world: 'w', at: 0, by: 'x', transitions: [] } }
await t('MARKS: an expired reservation reading its kind -> seen, then placed 10 min later with its intent; reading otherwise -> expired; unknown -> nothing', () => {
  const p = basePlan()
  const c = p.plots.find(x => x.id === 'store').cells[0]
  Object.assign(c, { state: 'reserved', by: 'a', visit: 'v', until: 1000, role: 'overflow' })
  const chest = world({ cells: { [c.at.join(',')]: 'chest' } })
  assert.equal(T.maintainPlan(p, chest, { now: 1000 + 30_000 }), null, 'before until + 60 s: the holder\'s')
  const m1 = T.maintainPlan(p, chest, { now: 1000 + 61_000 })
  assert.equal(m1.op, 'seen')
  const c1 = m1.body.plots.find(x => x.id === 'store').cells[0]
  assert.equal(c1.seenSince, 1000 + 61_000)
  assert.equal(T.maintainPlan(m1.body, chest, { now: 1000 + 61_000 + 5 * 60_000 })?.op ?? null, null, '5 min: waiting')
  const m2 = T.maintainPlan(m1.body, chest, { now: 1000 + 61_000 + 10 * 60_000 })
  assert.equal(m2.op, 'observe'); const c2 = m2.body.plots.find(x => x.id === 'store').cells[0]
  assert.equal(c2.state, 'placed'); assert.equal(c2.role, 'overflow'); assert.equal(c2.seenSince, undefined)
  const m3 = T.maintainPlan(p, world(), { now: 1000 + 61_000 })
  assert.equal(m3.op, 'expire'); assert.equal(m3.body.transitions[0].why, 'expired')
  assert.equal(T.maintainPlan(p, world({ bounds: [0, 0, 0, 0] }), { now: 1000 + 61_000 }), null, 'unknown: nothing')
  // THE EXPIRY'S INTENT (Claude code r3 P3): an intent the expired reservation SET (intentSet) is cleared; an older one is kept --
  // and both expiries are accepted by the walk
  const PSm = PS
  const ex = (intentSet, role) => {
    const q = basePlan(); const cc = q.plots.find(x => x.id === 'store').cells[1]
    Object.assign(cc, { state: 'reserved', by: 'a', visit: 'v', until: 1000, role, group: 'stone', ...(intentSet ? { intentSet: true } : {}) })
    const m = T.maintainPlan(q, world(), { now: 1000 + 61_000 })
    const after = m.body.plots.find(x => x.id === 'store').cells[1]
    const next = { ...m.body, v: 1, gen: 3, prev: 2, at: 1000 + 61_000, by: 'b' }
    return { op: m.op, role: after.role ?? null, group: after.group ?? null, marker: after.intentSet, walk: PSm.transitionRefusal({ ...q, v: 1, gen: 2 }, next) }
  }
  assert.deepEqual(ex(true, 'home'), { op: 'expire', role: null, group: null, marker: undefined, walk: null })
  assert.deepEqual(ex(false, 'home'), { op: 'expire', role: 'home', group: 'stone', marker: undefined, walk: null })
})
await t('MARKS: a free cell read as its kind -> seen -> placed (a second cycle after a contrary read); a placed one read empty -> missing -> gone, intent kept', () => {
  const p = basePlan()
  const st = p.plots.find(x => x.id === 'work').stations[0]
  const table = world({ cells: { [st.at.join(',')]: 'crafting_table' } })
  const a = T.maintainPlan(p, table, { now: 0 })
  assert.equal(a.op, 'seen')
  const b = T.maintainPlan(a.body, world(), { now: 60_000 })
  assert.equal(b.op, 'unseen', 'a craft took its table back: the mark is cleared')
  const c = T.maintainPlan(b.body, table, { now: 120_000 }); assert.equal(c.op, 'seen')
  const d = T.maintainPlan(c.body, table, { now: 120_000 + 10 * 60_000 }); assert.equal(d.op, 'observe')
  const placed = d.body.plots.find(x => x.id === 'work').stations[0]
  assert.equal(placed.state, 'placed')
  const e = T.maintainPlan(d.body, world(), { now: 2_000_000 }); assert.equal(e.op, 'missing')
  const f = T.maintainPlan(e.body, world(), { now: 2_000_000 + 10 * 60_000 }); assert.equal(f.op, 'gone')
  assert.equal(f.body.plots.find(x => x.id === 'work').stations[0].state, 'free'); assert.equal(f.body.transitions[0].why, 'gone')
})
await t('GROWTH: every section cell placed -> up to 4 EXTRA annex cells appended; nothing committed and the fit broken -> a whole re-fit', () => {
  const p = basePlan()
  const store = p.plots.find(x => x.id === 'store')
  const cells = {}
  for (const c of store.cells) { Object.assign(c, { state: 'placed', by: 'a', visit: 'v' }); cells[c.at.join(',')] = 'chest' }
  const g = T.growPlan(p, world({ cells }), {})
  assert.equal(g.op, 'extend'); const extra = g.body.plots.find(x => x.id === 'store').cells.filter(c => c.extra)
  assert.ok(extra.length >= 1 && extra.length <= 4)
  // never side by side, with each other or with a store chest (Codex code r1 P2: the annex's table cell beside its first chest)
  const all = g.body.plots.find(x => x.id === 'store').cells
  const side = (a, b) => a.at[1] === b.at[1] && Math.abs(a.at[0] - b.at[0]) + Math.abs(a.at[2] - b.at[2]) === 1
  for (const e of extra) assert.ok(!all.some(o => o !== e && side(o, e)), `extra ${e.at} shares a side`)
  // READY's whole context reaches growth (Claude code r1 P2): a cellForbid that refuses every chest cell -> no extension
  assert.equal(T.growPlan(p, world({ cells }), { cellForbid: () => 'well' }), null)
  const p2 = basePlan()
  const water = {}
  for (const c of p2.plots.find(x => x.id === 'store').cells) water[`${c.at[0]},69,${c.at[2]}`] = 'water'
  const g2 = T.growPlan(p2, world({ cells: water }), {})
  assert.equal(g2.op, 'refit'); assert.notEqual(g2.body.orientation, 'E')
})
await t('AUDIT (Claude spec r6 P2): a chest under leaves is not `lid`, under stone it is; a placed cell nobody can reach is `unreachable`; a free cell holding a block is `occupied`', () => {
  const p = basePlan()
  const store = p.plots.find(x => x.id === 'store')
  const [a, b] = store.cells
  Object.assign(a, { state: 'placed' }); Object.assign(b, { state: 'placed' })
  const cells = { [a.at.join(',')]: 'chest', [b.at.join(',')]: 'chest', [`${a.at[0]},${a.at[1] + 1},${a.at[2]}`]: 'oak_leaves', [`${b.at[0]},${b.at[1] + 1},${b.at[2]}`]: 'stone' }
  const st = p.plots.find(x => x.id === 'work').stations[0]
  cells[st.at.join(',')] = 'cobblestone'
  const au = T.auditPlan(p, world({ cells }), { home: HOME })
  assert.equal(au.placed, 2); assert.equal(au.present, 2); assert.equal(au.lid, 1); assert.equal(au.occupied, 1)
  // the same block on a cell the fit wrote ready:false (terrain it already knew) is not `occupied` (Claude code r1 P2)
  st.ready = false
  assert.equal(T.auditPlan(p, world({ cells }), { home: HOME }).occupied, 0)
  delete st.ready
  // wall the second chest in: unreachable
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const dy of [0, 1]) cells[`${b.at[0] + dx},${b.at[1] + dy},${b.at[2] + dz}`] ??= 'stone'
  assert.equal(T.auditPlan(p, world({ cells }), { home: HOME }).unreachable, 1)
})
await t('ACCESS (build spec 1.6): a candidate that walls a placed chest off is refused; one beside it is not', () => {
  const p = basePlan()
  const c = p.plots.find(x => x.id === 'store').cells[0]
  Object.assign(c, { state: 'placed' })
  const cells = { [c.at.join(',')]: 'chest' }
  // the chest's open sides all walled but one (its stand side, toward the interior)
  const keep = c.stand
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = c.at[0] + dx, z = c.at[2] + dz
    if (x === keep[0] && z === keep[2]) continue
    for (const dy of [0, 1]) cells[`${x},${c.at[1] + dy},${z}`] = 'stone'
  }
  cells[`${keep[0]},${keep[1] + 2},${keep[2]}`] = 'stone'   // a roof: nobody stands ON the filled stand either
  const read = world({ cells })
  assert.equal(T.accessKept(read, HOME, p, [[keep[0], keep[1], keep[2]]]).ok, false)
  assert.equal(T.accessKept(read, HOME, p, [[60, 70, 60]]).ok, true)
})

console.log('townplan: anchored mutants')
const showcaseRead = () => {
  const dump = JSON.parse(fs.readFileSync(new URL('./fixtures/townplan-showcase-dump.json', import.meta.url), 'utf8'))
  const [x0, z0, x1, z1] = dump.box, [y0, y1] = dump.y
  const nx = x1 - x0 + 1, nz = z1 - z0 + 1
  const buf = Buffer.from(dump.cells, 'base64'); const cells = dump.bits === 8 ? new Uint8Array(buf.buffer, buf.byteOffset, buf.length) : new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2)
  const pal = dump.palette.map(n => n === '?' ? null : { name: n.replace(/\[layers=\d+\]$/, ''), boundingBox: mcData.blocksByName[n.replace(/\[.*$/, '')]?.boundingBox ?? 'block', ...(/^snow\[layers=(\d+)\]/.test(n) ? { props: { layers: Number(/layers=(\d+)/.exec(n)[1]) } } : {}) })
  return (x, y, z) => (x < x0 || x > x1 || z < z0 || z > z1 || y < y0 || y > y1) ? null : pal[cells[((y - y0) * nz + (z - z0)) * nx + (x - x0)]]
}
const mutants = [
  ['the lid judged by chestLidBlocked alone (mud passes)', "export const lidBlocks = b => !!b && (chestLidBlocked(b) || serverLidBlocks(b))", "export const lidBlocks = b => !!b && chestLidBlocked(b)",
    M => assert.match(M.readyCell(world({ cells: { '110,71,100': 'mud' } }), [110, 70, 100], { home: HOME }), /lid mud/)],
  ['snow at any depth', "if (n === 'snow') return Number(b.props?.layers) === 1", "if (n === 'snow') return true",
    M => assert.match(M.readyCell(world({ cells: { '110,70,100': 'snow' }, props: { '110,70,100': { layers: 2 } } }), [110, 70, 100], { home: HOME }), /cell snow/)],
  ['joint access ignores an existing container it cuts off', "if (cut.length && !lost.length) return", "if (false) return",
    M => { const cells = {}; for (let x = 95; x <= 125; x++) for (let z = 95; z <= 105; z++) for (let y = 70; y <= 72; y++) if (z !== 100) cells[`${x},${y},${z}`] = 'stone'; cells['118,70,100'] = 'chest'; assert.equal(M.jointAccess(world({ cells }), HOME, [{ at: [110, 70, 100], kind: 'chest', stand: null }], { existing: [[118, 70, 100]] }).ok.length, 0) }],
  ['the first 4 chests in fill order (r5) instead of any 4', "const qualifies = g.cells.filter(c => okKeys.has(kOf(c.at))).length >= 4", "const qualifies = g.cells.slice(0, 4).every(c => okKeys.has(kOf(c.at)))",
    M => assert.equal(M.fitGreenfield(world({ cells: { '109,69,98': 'air', '109,69,102': 'air' } }), HOME, {}).tried.find(x => x.orient === 'E' && x.side === 1).qualifies, true)],
  ['an unknown read clears or matures a mark', "    const k = readsKind(read, c)\n    if (k === null) continue\n    if (k) {", "    const k = readsKind(read, c) ?? false\n    if (k) {",
    M => { const p = basePlan(); Object.assign(p.plots.find(x => x.id === 'store').cells[0], { state: 'reserved', by: 'a', visit: 'v', until: 1000 }); assert.equal(M.maintainPlan(p, world({ bounds: [0, 0, 0, 0] }), { now: 70_000 }), null) }],
  ['a committed store box soft instead of BOX', ";(committed ? box : soft).push(...boxes)", ";soft.push(...boxes)",
    M => { const r = M.fitTown(world(), HOME, {}); const st = r.body.plots.find(p => p.id === 'store'); Object.assign(st.cells[0], { state: 'placed' }); assert.equal(M.keepouts(r.body).tier(108, 70, 104), 'box') }],
]
for (const [name, old, neu, check] of mutants) {
  await t(`MUTANT KILLED: ${name}`, async () => {
    const k = await withMutant(TP_PATH, old, neu, async M => killedBy(() => check(M)))
    assert.ok(k, 'the mutant survived')
  })
}

console.log(`\ntownplan: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
