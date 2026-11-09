// pens-01 + herd-01 (pens.mjs, herd.mjs; docs/reports/villagecon-2026-11-09/design.md): the pens' layout, siting and record, the
// herd's census, its next job, the lure's steps and the sightings; the fence gate's aim (townstyle.mjs orientAim).
// Behaviour on fake worlds; structural only for the wiring (the dispatch, the upkeep, the guard, the exit in the herd's finally).
// Mutants assert their anchor is present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-pens-logs-'))
const P = await import('../src/pens.mjs')
const H = await import('../src/herd.mjs')
const TS = await import('../src/townstyle.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }
async function withMutant (rel, old, neu, fn) {
  const url = new URL(rel, import.meta.url)
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-pens-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ---- a fake world: grass at y 64 everywhere, air above; overrides by "x,y,z" -----------------------------------------------------
function world (over = {}, ground = 64) {
  return (x, y, z) => {
    const k = `${x},${y},${z}`
    if (k in over) return over[k] == null ? null : { name: over[k], boundingBox: /air|grass$|fern/.test(over[k]) ? 'empty' : 'block' }
    if (y < ground) return { name: 'dirt', boundingBox: 'block' }
    if (y === ground) return { name: 'grass_block', boundingBox: 'block' }
    return { name: 'air', boundingBox: 'empty' }
  }
}
const HOME = { x: 0, y: 65, z: 0 }
const cols = read => { const m = new Map(); return (x, z) => { const k = `${x},${z}`; if (!m.has(k)) m.set(k, (awaitPath)(read, x, z)); return m.get(k) } }
const { pathColumn } = await import('../src/paths.mjs')
const awaitPath = (read, x, z) => pathColumn(read, x, z, { yHi: 80, yLo: 50 })

await t('layout: two 9x9 rings with a walkway between -- 62 fences, 2 gates, 49 + 49 floor, the gates facing INTO the pens', () => {
  const l = P.penLayout(0, 0, 'x', 'lo')
  assert.deepStrictEqual([l.fence.length, l.gates.length, l.floor.sheep.length, l.floor.cow.length, l.walk.length], [62, 2, 49, 49, 9])
  assert.deepStrictEqual(l.box, [0, 0, 18, 8])
  assert.deepStrictEqual(l.gates.map(g => [g.x, g.z, g.facing, g.pen]), [[4, 0, 'south', 'sheep'], [14, 0, 'south', 'cow']])
  assert.deepStrictEqual(P.penLayout(0, 0, 'x', 'hi').gates.map(g => [g.x, g.z, g.facing]), [[4, 8, 'north'], [14, 8, 'north']])
  assert.deepStrictEqual(P.penLayout(0, 0, 'z', 'lo').gates.map(g => [g.x, g.z, g.facing]), [[0, 4, 'east'], [0, 14, 'east']])
  assert.deepStrictEqual(P.penLayout(0, 0, 'z', 'hi').gates.map(g => [g.x, g.z, g.facing]), [[8, 4, 'west'], [8, 14, 'west']])
  // every fence is on a ring's outside edge: no floor cell between it and the box's outside or the walkway
  const fl = new Set([...l.floor.sheep, ...l.floor.cow].map(p => p.join(',')))
  assert.ok(l.fence.every(([x, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !fl.has(`${x + dx},${z + dz}`) && !l.fence.some(f => f[0] === x + dx && f[1] === z + dz))), 'every fence has a non-floor, non-fence side')
})

await t('fit: flat grass fits (L = ground, nothing to cut or fill); a bump is CUT, a dip FILLED; a 2-high step is refused (level)', () => {
  const read = world()
  const f = P.fitPen(read, { x0: 20, z0: 20, home: HOME, col: cols(read) })
  assert.deepStrictEqual([f.ok, f.L, f.clear.length, f.floorFill.length, f.grass], [true, 64, 0, 0, 49])
  const bump = world({ '25,65,25': 'grass_block' })
  const b = P.fitPen(bump, { x0: 20, z0: 20, home: HOME, col: cols(bump) })
  assert.deepStrictEqual([b.ok, b.clear.map(c => [c.at.join(','), c.kind])], [true, [['25,65,25', 'cut']]])
  const dip = world({ '25,64,25': 'air' })
  const d = P.fitPen(dip, { x0: 20, z0: 20, home: HOME, col: cols(dip) })
  assert.deepStrictEqual([d.ok, d.floorFill], [true, [[25, 64, 25]]])
  const step = world({ '25,65,25': 'stone', '25,66,25': 'stone' })
  assert.strictEqual(P.fitPen(step, { x0: 20, z0: 20, home: HOME, col: cols(step) }).why, 'level')
})
await t('fit refusals: cover (a log 2 above the ground), too little grass on the sheep floor, a blocked apron, a reserved column, too far', () => {
  const cover = world({ '25,66,25': 'oak_log' })
  assert.strictEqual(P.fitPen(cover, { x0: 20, z0: 20, home: HOME, col: cols(cover) }).why, 'cover')
  const stone = {}
  for (let x = 21; x <= 27; x++) for (let z = 21; z <= 27; z++) stone[`${x},64,${z}`] = 'stone'
  const st = world(stone)
  assert.strictEqual(P.fitPen(st, { x0: 20, z0: 20, home: HOME, col: cols(st) }).why, 'grass')
  const read = world()
  assert.strictEqual(P.fitPen(read, { x0: 20, z0: 20, home: HOME, col: cols(read), blocked: (x, z) => (x === 24 && z === 19 ? 'road' : null) }).why, 'apron')
  assert.strictEqual(P.fitPen(read, { x0: 20, z0: 20, home: HOME, col: cols(read), blocked: (x, z) => (x === 30 && z === 25 ? 'record' : null) }).why, 'box:record')
  assert.strictEqual(P.fitPen(read, { x0: 60, z0: 60, home: HOME, col: cols(read) }).why, 'far')
})
await t('mutant: the level rule removed -> a 2-high step fits (killed)', async () => {
  await withMutant('../src/pens.mjs', "    if (Math.abs(c.y - L) > 1) return { ok: false, why: 'level' }\n", '', async M => {
    const step = world({ '25,65,25': 'stone', '25,66,25': 'stone' })
    assert.notStrictEqual(M.fitPen(step, { x0: 20, z0: 20, home: HOME, col: cols(step) }).why, 'level')
  })
})

let REC = null
await t('siting: flat ground -> a record at least rMin from home, its centre within rMax, the gates on the side NEARER home, fences of the town wood', () => {
  const read = world()
  const s = P.sitePens(read, { home: HOME, wood: 'spruce' })
  assert.ok(s.ok, s.why)
  REC = s.record
  const [x0, z0, x1, z1] = REC.box
  const nx = Math.max(x0, Math.min(0, x1)), nz = Math.max(z0, Math.min(0, z1))
  assert.ok(Math.max(Math.abs(nx), Math.abs(nz)) >= P.PEN.rMin, 'rMin')
  assert.ok(Math.hypot((x0 + x1) / 2, (z0 + z1) / 2) <= P.PEN.rMax, 'rMax')
  const gate = REC.cells.filter(c => c.role === 'gate')
  assert.strictEqual(gate.length, 2)
  // the gates' wall is the box side nearer home
  const g = gate[0].at
  const far = REC.orient === 'x' ? (g[2] === z0 ? z1 : z0) : (g[0] === x0 ? x1 : x0)
  const gd = REC.orient === 'x' ? Math.abs(g[2]) : Math.abs(g[0]), fd = Math.abs(far)
  assert.ok(gd <= fd, `the gate wall (${gd}) is nearer home than the back wall (${fd})`)
  assert.deepStrictEqual(gate.map(c => c.ws.open), [false, false])
  assert.strictEqual(REC.palette.fence[0], 'spruce_fence')
  assert.strictEqual(REC.cells.filter(c => c.role === 'fence').length, 62)
  assert.deepStrictEqual(REC.segments.map(s => s.seg), ['W', 'G'], 'no fill on flat ground; the gates after the walls')
})
await t('the record: stands never on a floor (penDomain); penOpen counts the missing fences and gates; penOf names the pen', () => {
  const dom = P.penDomain(REC)
  const sf = REC.pens.sheep.floor[10], ap = REC.apron[0]
  assert.strictEqual(dom(sf[0], sf[2]), false)
  assert.strictEqual(dom(ap[0], ap[2]), true)
  assert.strictEqual(dom(REC.box[2] + 20, REC.box[3]), false, 'far outside the box + 6')
  const empty = world()
  assert.deepStrictEqual(P.penOpen(empty, REC), { fence: 62, gate: 2 })
  const built = {}
  for (const c of REC.cells) built[c.at.join(',')] = c.role === 'gate' ? 'spruce_fence_gate' : 'oak_fence'
  assert.deepStrictEqual(P.penOpen(world(built), REC), { fence: 0, gate: 0 }, 'any wood counts')
  assert.strictEqual(P.penOf(REC, sf[0] + 0.5, sf[2] + 0.5), 'sheep')
  const cf = REC.pens.cow.floor[0]
  assert.strictEqual(P.penOf(REC, cf[0], cf[2]), 'cow')
  assert.strictEqual(P.penOf(REC, ap[0], ap[2]), null)
})
await t('mutant: the floor left in the stands\' domain -> a builder could stand inside a ring (killed)', async () => {
  await withMutant('../src/pens.mjs', ' && !floor.has(k2(x, z))', '', async M => {
    const sf = REC.pens.sheep.floor[10]
    assert.strictEqual(M.penDomain(REC)(sf[0], sf[2]), true)
  })
})
await t('the gate\'s aim (townstyle orientAim): on the floor\'s top face the yaw of its facing; a side face or an open state -> null', () => {
  assert.deepStrictEqual(TS.orientAim('spruce_fence_gate', { facing: 'south', open: false }, [0, 1, 0]), { yaw: 0, cursor: [0.5, 1, 0.5] })
  assert.strictEqual(TS.orientAim('spruce_fence_gate', { facing: 'east', open: false }, [0, 1, 0]).yaw, -90)
  assert.strictEqual(TS.orientAim('spruce_fence_gate', { facing: 'south', open: false }, [1, 0, 0]), null)
  assert.strictEqual(TS.orientAim('spruce_fence_gate', { facing: 'south', open: true }, [0, 1, 0]), null)
  assert.ok(TS.oriented('oak_fence_gate'))
  assert.ok(TS.stateOk({ facing: 'south', open: false, in_wall: false, powered: false }, { facing: 'south', open: false }))
  assert.ok(!TS.stateOk({ facing: 'north', open: false }, { facing: 'south', open: false }))
})

// ---- the herd -------------------------------------------------------------------------------------------------------------------
const A = (id, name, at, { baby = false, sheared = false } = {}) => ({ id, uuid: `u${id}`, name, position: { x: at[0] + 0.5, y: 65, z: at[2] + 0.5 }, metadata: { ...(baby ? { 16: true } : {}), ...(name === 'sheep' ? { 17: sheared ? 0x10 : 0 } : {}) } })
await t('census: animals on a pen\'s floor are that pen\'s (adults, babies, woolly adults); the rest wild', () => {
  const s = REC.pens.sheep.floor, c = REC.pens.cow.floor
  const ents = [A(1, 'sheep', s[0]), A(2, 'sheep', s[5], { sheared: true }), A(3, 'sheep', s[9], { baby: true }), A(4, 'cow', c[3]), A(5, 'sheep', [200, 65, 200]), { id: 6, name: 'pig', position: { x: s[1][0], y: 65, z: s[1][2] } }]
  const cs = H.herdCensus(ents.map(H.animalOf), REC)
  assert.deepStrictEqual([cs.sheep.n, cs.sheep.adults.length, cs.sheep.babies.length, cs.sheep.woolly.length, cs.cow.n, cs.wild.length], [3, 2, 1, 1, 1, 1])
})
const census = (o = {}) => ({ sheep: { adults: [], babies: [], woolly: [], n: 0, ...(o.sheep ?? {}) }, cow: { adults: [], babies: [], woolly: [], n: 0, ...(o.cow ?? {}) }, wild: [] })
const ad = n => Array.from({ length: n }, (_, i) => ({ id: i }))
await t('next job: SHEAR first (a woolly adult, wool under the cap, shears), then BREED (>= 2 adults, under the cap, not lately, wheat above the keep), then FETCH', () => {
  const W = { known: true, now: 1e9, townWheat: 100, townWool: 0, shears: true, penCentre: { x: 0, z: 0 } }
  assert.strictEqual(H.herdWork({ ...W, census: census({ sheep: { adults: ad(2), woolly: ad(1), n: 2 } }) }).op, 'shear')
  assert.strictEqual(H.herdWork({ ...W, townWool: H.HERD.woolCap, census: census({ sheep: { adults: ad(2), woolly: ad(1), n: 2 } }) }).op, 'breed', 'wool at its cap: no shearing')
  assert.strictEqual(H.herdWork({ ...W, shears: false, census: census({ sheep: { adults: ad(2), woolly: ad(1), n: 2 } }) }).op, 'breed')
  assert.strictEqual(H.herdWork({ ...W, census: census({ sheep: { adults: ad(2), n: H.HERD.cap } }) }).op, null, 'a full pen breeds no more (and no cow is remembered to fetch)')
  assert.strictEqual(H.herdWork({ ...W, state: { bredAt: { sheep: 1e9 - 60_000 } }, census: census({ sheep: { adults: ad(2), n: 2 }, cow: { adults: ad(2), n: 2 } }) }).species, 'cow', 'the sheep bred a minute ago: the cows')
  assert.strictEqual(H.herdWork({ ...W, townWheat: H.HERD.wheatKeep + 1, census: census({ sheep: { adults: ad(2), n: 2 }, cow: { adults: ad(2), n: 2 } }) }).op, null, 'wheat at the keep: no breeding, and both pens have their adults')
  assert.strictEqual(H.herdWork({ ...W, known: false, census: census() }).op, null)
})
await t('fetch: the nearest remembered wild one of a pen short of adults; a resume first; one that got lost is left alone a while', () => {
  const now = 1e9
  const st = { seen: { a: { species: 'sheep', x: 60, z: 0, at: now - 1000 }, b: { species: 'sheep', x: 30, z: 0, at: now - 1000 }, c: { species: 'cow', x: 10, z: 0, at: now - 1000 }, old: { species: 'sheep', x: 5, z: 0, at: now - H.HERD.sightMs - 1 } } }
  const W = { known: true, now, townWheat: 100, shears: true, penCentre: { x: 0, z: 0 } }
  const w = H.herdWork({ ...W, state: st, census: census() })
  assert.deepStrictEqual([w.op, w.species, w.target.uuid], ['fetch', 'sheep', 'b'])
  assert.strictEqual(H.herdWork({ ...W, state: { ...st, failed: { b: now - 1000 } }, census: census() }).target.uuid, 'a')
  assert.strictEqual(H.herdWork({ ...W, state: { ...st, resume: { uuid: 'r', species: 'sheep', x: 90, z: 0, at: now - 1000 } }, census: census() }).why, 'resume')
  assert.deepStrictEqual(['op', 'species'].map(k => H.herdWork({ ...W, state: { ...st, bredAt: { sheep: now - 1000 } }, census: census({ sheep: { adults: ad(2), n: 2 } }) })[k]), ['fetch', 'cow'], 'the sheep pen has its two (bred a moment ago): the cow fetched')
})
await t('mutant: shear and breed swapped -> a woolly pen is bred first (killed)', async () => {
  await withMutant('../src/herd.mjs', "  if (sh.woolly.length && townWool < HERD.woolCap && shears) return { op: 'shear', species: 'sheep', why: `woolly${sh.woolly.length}` }\n", '', async M => {
    assert.strictEqual(M.herdWork({ known: true, now: 1e9, townWheat: 100, shears: true, census: census({ sheep: { adults: ad(2), woolly: ad(1), n: 2 } }) }).op, 'breed')
  })
})
await t('lure: a leg toward the gate while the animal is near; wait while it lags; lost beyond 10 b; arrived at the stand', () => {
  const dest = { x: 0, z: 0 }
  const leg = H.lureStep({ x: 20, z: 0 }, { x: 22, z: 0 }, dest)
  assert.deepStrictEqual([leg.act, leg.to], ['leg', { x: 15, z: 0 }])
  assert.strictEqual(H.lureStep({ x: 20, z: 0 }, { x: 27, z: 0 }, dest).act, 'wait')
  assert.strictEqual(H.lureStep({ x: 20, z: 0 }, { x: 31, z: 0 }, dest).act, 'lost')
  assert.strictEqual(H.lureStep({ x: 0.5, z: 0.5 }, null, dest).act, 'arrived')
  assert.strictEqual(H.lureStep({ x: 1.6, z: 0.4 }, { x: 4, z: 0 }, dest).act, 'arrived', 'a goto with range 1 ends ~1.6 b off the stand: there')
  assert.strictEqual(H.lureStep({ x: 20, z: 0 }, null, dest).act, 'lost')
})
await t('sightings: wild adults within fetchR noted, babies and pen animals not, stale ones dropped', () => {
  const s = REC.pens.sheep.floor
  const cs = H.herdCensus([A(1, 'sheep', s[0]), A(2, 'sheep', [REC.box[0] + 30, 65, REC.box[1]]), A(3, 'sheep', [REC.box[0] + 31, 65, REC.box[1]], { baby: true }), A(4, 'cow', [REC.box[0] + 400, 65, 0])].map(H.animalOf), REC)
  const st = H.noteAnimals({ seen: { u1: { species: 'sheep', x: 0, z: 0, at: 1 }, old: { species: 'cow', x: 0, z: 0, at: 1 } } }, cs, REC, 1e9)
  assert.deepStrictEqual(Object.keys(st.seen).sort(), ['u2'])
})

// ---- the wiring (structural: behaviour cannot reach the dispatch) ---------------------------------------------------------------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const SH = strip(readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8'))
await t('wiring: the dispatch, the upkeep (damaged + service), the blueprint palette, the order after the crop farm, the guard, the exit in the herd\'s finally', () => {
  assert.match(SK, /if \(proj\.plot === PENS_PLOT\) return buildPens\(ctx, args, signal\)/)
  assert.match(SK, /if \(r\.blueprint === PENS_BLUEPRINT\) return tidy && !!pensDueFor\(bot, r\)/)
  assert.match(SK, /if \(plot === PENS_PLOT\) return pensDueFor\(bot, rec\)/)
  assert.match(SK, /id === PENS_BLUEPRINT \? \{ id, palette: penPalette\(\) \}/)
  assert.match(SH, /Object\.freeze\(\{ plot: PENS_PLOT, blueprint: PENS_BLUEPRINT, after: FARM_AFTER, builders: PENS_BUILDERS \}\)/)
  assert.match(SH, /p\.plot === PENS_PLOT \? pen && crop && farm && paths && on/)
  assert.match(SH, /if \(p\.plot === PENS_PLOT && !out\.some\(q => q\.plot === p\.plot\)\) out\.push\(p\)/)
  assert.match(SK, /\} finally \{\n\s+if \(entered && !signal\?\.aborted\) \{ try \{ await penExit\(ctx, rec, entered, signal\) \}/)
  assert.match(SK, /domain: penDomain\(rec\), foreign: PEN_FOREIGN/)
  // the herd's walks never take goto's dig-assisted retry (r1 BLOCKER: it could dig the gate or a fence)
  const hd = SK.match(/\nasync function hdGoto \([\s\S]*?\n\}\n/)?.[0] ?? ''
  assert.ok(hd.length > 50 && /bot\.pathfinder\.goto\(new goals\.GoalNear\(/.test(hd) && !/\bgoto\(ctx/.test(hd), 'hdGoto: the pathfinder directly, never goto(ctx ...)')
  const hv = SK.match(/\nasync function herdVisit \([\s\S]*?\n\}\n/)?.[0] ?? ''
  assert.ok(hv.length > 500 && !/\bgoto\(ctx/.test(hv), 'herdVisit walks only by hdGoto (and mkWalkLegs for the far approach)')
  assert.match(SK, /if \(me && penOf\(rec, me\.x, me\.z\)\) return 'exit'/)
  assert.match(SK, /if \(!\(await setGate\(bot, g, true, signal\)\)\) \{ await setGate\(bot, g, false, signal\); return false \}/)
})

console.log(`\npens: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
