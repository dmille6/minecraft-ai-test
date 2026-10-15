// shaft-01 (ziggurat stage 5): the pure shaft job -- sites, frames, the reserved volume, the frontier.
import assert from 'node:assert/strict'
const SJ = await import('../src/shaftjob.mjs')
const SP = await import('../src/shaftplan.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.stack ?? e).split('\n').slice(0, 3).join('\n        ')}`) } }

await t('FRAMES: toLocal inverts toWorld for every orientation', () => {
  for (const away of ['n', 's', 'e', 'w']) for (const [u, v] of [[0, 0], [1, 0], [-1, 3], [2, -1], [0, 9]]) {
    const w = SP.toWorld({ x: 100, z: -50 }, away, u, v)
    assert.deepEqual(SJ.toLocal({ x: 100, z: -50 }, away, w.x, w.z), { u, v }, `${away} ${u},${v}`)
  }
})

await t('SITES: the 12 M0 sites are complete and valid', () => {
  assert.equal(Object.keys(SJ.SHAFT_SITES).length, 12)
  for (const [p, s] of Object.entries(SJ.SHAFT_SITES)) assert.ok(Number.isInteger(s.origin.x) && Number.isInteger(s.origin.z) && 'nsew'.includes(s.away) && s.c > 16, p)
})

const site = { origin: { x: 0, z: 0 }, away: 's', c: 70 }
const rec = SJ.newShaftRecord({ site, bottom: 16, landings: SJ.plannedLandings(70), home: { x: 0, y: 70, z: -20 } })
const idx = SJ.shaftIndex(rec)
const W = (u, y, v) => SJ.worldOf(site, u, y, v)
await t('RESERVED: core, ladders, lining, portal, room, stub at every level from the start; never the pad, the stub end face or beyond', () => {
  const r = (u, y, v) => { const w = W(u, y, v); return idx.has(w.x, w.y, w.z) }
  assert.ok(r(0, 69, 0) && r(1, 20, 0), 'core cells (ladders)')
  assert.ok(r(-1, 50, 0) && r(2, 50, 0) && r(0, 50, -1) && r(1, 50, 1), 'lining')
  assert.ok(r(-1, 70, 0) && r(2, 70, 0), 'the collar rim')
  const yL = rec.landings[0]
  assert.ok(r(0, yL, 1) && r(-1, yL + 1, 3) && r(1, yL, 8), 'portal, room, stub')
  assert.ok(r(0, yL - 1, 6) && r(0, yL + 2, 6), 'stub floor and ceiling')
  assert.ok(!r(0, yL, 9) && !r(1, yL + 1, 9) && !r(0, yL - 1, 9), 'the stub end face and its first tread are not reserved (digging continues there)')
  assert.ok(!r(0, 70, -1) && !r(1, 70, -1), 'the entry pad stays open')
  assert.ok(r(0, 15, 0), 'the floor under the bottom core is lining'); assert.ok(!r(5, 50, 0) && !r(0, 14, 0) && !r(0, 71, 0), 'outside the envelope')
  const w = W(0, 40, 0); assert.ok(idx.core(w.x, 40, w.z) && idx.inEnvelope(w.x, 40, w.z))
  const l = W(-1, 40, 0); assert.ok(!idx.core(l.x, 40, l.z) && !idx.inEnvelope(l.x, 40, l.z) && idx.roleAt(l.x, 40, l.z) === 'lining')
})

await t('MALFORMED records reserve nothing (a NaN origin, a bad orientation, a bottom above the collar, abandoned)', () => {
  assert.equal(SJ.shaftIndex({ ...rec, site: { ...site, origin: { x: NaN, z: 0 } } }), null)
  assert.equal(SJ.shaftIndex({ ...rec, site: { ...site, away: 'up' } }), null)
  assert.equal(SJ.shaftIndex({ ...rec, plan_bottom: 80 }), null)
  assert.equal(SJ.shaftIndex({ ...rec, state: 'abandoned' }), null)
  assert.ok(SJ.shaftIndex(rec), 'positive control')
})

await t('A STOP NEVER UN-RESERVES (Codex plan r1 P1-4): the usable bottom rises, the planned envelope stays reserved', () => {
  const stopped = { ...rec, bottom: 54, landings: rec.landings.filter(y => y >= 54), state: 'stopped' }
  const i2 = SJ.shaftIndex(stopped), w = W(0, 30, 0), l = W(-1, 30, 0)
  assert.ok(i2.has(w.x, 30, w.z) && i2.has(l.x, 30, l.z), 'cells below the stop stay reserved')
})

await t('THE WAY OFF: on the surface a cell beyond the box; below it, the entry pad', () => {
  const surf = W(0, 70, 3), deep = W(0, 40, 0)
  const e1 = idx.exit({ x: surf.x, y: 70, z: surf.z }); assert.ok(e1 && !idx.has(e1.x, 70, e1.z) && e1.y === 70)
  assert.deepEqual(idx.exit({ x: deep.x, y: 40, z: deep.z }), { ...W(0, 70, -1) })
  assert.equal(idx.exit({ x: 500, y: 40, z: 500 }), null)
})

const SI = await import('../src/shaftindex.mjs')
// a voxel world of the BUILT shaft down to level `to` (ladders both columns, lining stone), stone elsewhere
function builtWorld (site, to, { landingsBuilt = [], drop = null } = {}) {
  const m = new Map(), k = (x, y, z) => `${x},${y},${z}`
  const idx0 = SJ.shaftIndex(SJ.newShaftRecord({ site, bottom: 16, landings: SJ.plannedLandings(site.c), home: { x: 0, y: site.c, z: 0 } }))
  const set = (u, y, v, b) => { const w = SJ.worldOf(site, u, y, v); m.set(k(w.x, y, w.z), b) }
  for (let y = site.c; y >= to; y--) for (const u of [0, 1]) set(u, y, 0, y === site.c ? { name: 'air', boundingBox: 'empty' } : { name: 'ladder', boundingBox: 'block', facing: SI.ladderFacing(site.away, u) })
  set(0, site.c, -1, { name: 'air', boundingBox: 'empty' }); set(1, site.c, -1, { name: 'air', boundingBox: 'empty' })
  for (const yL of landingsBuilt) for (const y of [yL, yL + 1]) { for (const u of [0, 1]) set(u, y, 1, { name: 'air', boundingBox: 'empty' }); for (let u = -1; u <= 2; u++) for (let v = 2; v <= 4; v++) set(u, y, v, { name: 'air', boundingBox: 'empty' }); for (const u of [0, 1]) for (let v = 5; v <= 8; v++) set(u, y, v, { name: 'air', boundingBox: 'empty' }) }
  if (drop) set(...drop, { name: 'air', boundingBox: 'empty' })
  return { idx: idx0, read: (x, y, z) => (y > site.c ? { name: 'air', boundingBox: 'empty' } : m.get(k(x, y, z)) ?? { name: 'stone', boundingBox: 'block' }) }
}
await t('LADDER EXIT: from any core depth, a room and a stub; never with a ladder missing, a wrong facing, outside, or unloaded', () => {
  for (const away of ['n', 's', 'e', 'w']) {
    const st = { origin: { x: 10, z: -7 }, away, c: 70 }
    const yL = SJ.plannedLandings(70)[1]
    const { idx: ix, read } = builtWorld(st, 40, { landingsBuilt: [yL] })
    const f = (u, y, v) => { const w = SJ.worldOf(st, u, y, v); return { x: w.x + 0.5, y, z: w.z + 0.5 } }
    assert.ok(SI.ladderExit(ix, read, f(0, 41, 0)).ok, `${away}: core`)
    assert.ok(SI.ladderExit(ix, read, f(-1, yL, 3)).ok, `${away}: room corner`)
    assert.ok(SI.ladderExit(ix, read, f(1, yL, 8)).ok, `${away}: stub end`)
    assert.equal(SI.ladderExit(ix, read, f(-1, 41, 0)).ok, false, `${away}: in the lining is not in the shaft`)
    const broken = builtWorld(st, 40, { drop: [1, 55, 0] })
    assert.equal(SI.ladderExit(broken.idx, broken.read, f(1, 41, 0)).col, 0, `${away}: column 1 broken at 55 -> column 0`)
    const both = builtWorld(st, 40, { drop: [1, 55, 0] })
    const r2 = (x, y, z) => { const w0 = SJ.worldOf(st, 0, 50, 0); return x === w0.x && y === 50 && z === w0.z ? { name: 'air', boundingBox: 'empty' } : both.read(x, y, z) }
    assert.equal(SI.ladderExit(both.idx, r2, f(1, 41, 0)).ok, false, `${away}: both columns broken`)
    const wrong = (x, y, z) => { const b = read(x, y, z); return b.name === 'ladder' ? { ...b, facing: 'up' } : b }
    assert.equal(SI.ladderExit(ix, wrong, f(0, 41, 0)).ok, false, `${away}: wrong facing`)
    const unloaded = (x, y, z) => (y === 60 ? null : read(x, y, z))
    assert.equal(SI.ladderExit(ix, unloaded, f(0, 41, 0)).ok, false, `${away}: an unloaded cell is no exit`)
    // Codex shaft plan r2 P1: an EXECUTABLE route, or nothing
    const cell = (u, y, v) => SJ.worldOf(st, u, y, v)
    const patch = (fn, list) => (x, y, z) => { for (const [u, yy, v, b] of list) { const w = cell(u, yy, v); if (x === w.x && y === yy && z === w.z) return b } return fn(x, y, z) }
    const STONE = { name: 'stone', boundingBox: 'block' }, AIRB = { name: 'air', boundingBox: 'empty' }
    assert.equal(SI.ladderExit(ix, patch(read, [[0, 50, 0, AIRB], [1, 41, 0, STONE]]), f(0, 41, 0)).ok, false, `${away}: column 0 broken and column 1 not reachable from the bot's cell`)
    assert.equal(SI.ladderExit(ix, (x, y, z) => { const b = read(x, y, z); return b?.name === 'ladder' ? { ...b, facing: null } : b }, f(0, 41, 0)).ok, false, `${away}: unknown facing`)
    assert.equal(SI.ladderExit(ix, patch(read, [[0, 70, -1, STONE], [1, 70, -1, STONE]]), f(0, 41, 0)).ok, false, `${away}: the pad blocked`)
    assert.equal(SI.ladderExit(ix, patch(read, [[0, 69, -1, AIRB], [1, 69, -1, AIRB]]), f(0, 41, 0)).ok, false, `${away}: the pad's floor gone`)
    assert.equal(SI.ladderExit(ix, (x, y, z) => { const w = cell(1, 70, -1), w0 = cell(0, 70, -1); return (y === 70 && ((x === w.x && z === w.z) || (x === w0.x && z === w0.z))) ? null : read(x, y, z) }, f(0, 41, 0)).ok, false, `${away}: the pad unloaded`)
    assert.equal(SI.ladderExit(ix, patch(read, [[-1, yL, 2, STONE], [0, yL, 3, STONE], [-1, yL, 4, STONE]]), f(-1, yL, 3)).ok, false, `${away}: the room corner walled off from the portal`)
    assert.ok(SI.ladderExit(ix, patch(read, [[-1, yL, 2, STONE]]), f(-1, yL, 3)).ok, `${away}: positive control -- one cell blocked, a way round it`)
    const r1 = SI.ladderExit(ix, read, f(-1, yL, 3)); assert.ok(r1.route.length >= 4 && r1.route.every((c, i, a) => i === 0 || Math.abs(c.u - a[i - 1].u) + Math.abs(c.v - a[i - 1].v) === 1), `${away}: the route steps 4-adjacent`)
  }
})

const SG = await import('../src/shaftguard.mjs')
await t('DIG CHOKEPOINT: a reserved cell is refused with a verified exit (every purpose), allowed for the builder, absorbed with no exit', async () => {
  const st = { origin: { x: 10, z: -7 }, away: 'e', c: 70 }
  const { idx: ix, read } = builtWorld(st, 40)
  const f = (u, y, v) => { const w = SJ.worldOf(st, u, y, v); return { x: w.x + 0.5, y, z: w.z + 0.5 } }
  const wall = SJ.worldOf(st, -1, 45, 0), outside = SJ.worldOf(st, 6, 45, 0)
  let scope = null, pos = f(0, 41, 0)
  const digs = [], refused = [], absorbed = []
  const bot = { entity: { get position () { return pos } }, dig: async b => { digs.push(b.position) } }
  const un = SG.installShaftDigGuard(bot, { keepOut: () => ({ shaft: ix }), scopeBy: () => scope, read, onRefuse: r => refused.push(r), onAbsorb: r => absorbed.push(r) })
  const blk = c => ({ position: { x: c.x, y: c.y, z: c.z }, name: 'stone' })
  await assert.rejects(bot.dig(blk(wall)), e => e.reserved && /climb column/.test(e.message), 'a survival dig of the lining, with an exit: refused')
  await bot.dig(blk(outside)); assert.equal(digs.length, 1, 'positive control: a dig outside the shaft passes')
  scope = 'dig_shaft'; await bot.dig(blk(wall)); assert.equal(digs.length, 2, 'the builder digs its own cells'); scope = null
  // no exit: the bot stands below a broken pair of columns -> the dig passes (absorbed), named
  const both = builtWorld(st, 40, { drop: [1, 55, 0] })
  const r2 = (x, y, z) => { const w0 = SJ.worldOf(st, 0, 50, 0); return x === w0.x && y === 50 && z === w0.z ? { name: 'air', boundingBox: 'empty' } : both.read(x, y, z) }
  un(); const bot2 = { entity: { position: f(0, 41, 0) }, dig: async b => { digs.push(b.position) } }
  SG.installShaftDigGuard(bot2, { keepOut: () => ({ shaft: ix }), read: r2, onAbsorb: r => absorbed.push(r) })
  await bot2.dig(blk(wall)); assert.equal(digs.length, 3); assert.equal(absorbed.length, 1, 'no exit: no trap -- the shaft absorbs the dig')
  assert.equal(refused.length, 1)
})

await t('FRONTIER: one level at a time, only down; complete at the bottom', () => {
  assert.equal(SJ.nextLevel(rec), 70)
  let r = SJ.advance(rec, 70); assert.equal(r.frontier, 70); assert.equal(SJ.nextLevel(r), 69)
  assert.equal(SJ.advance(r, 60), r, 'no skipping')
  r = { ...r, frontier: 17 }; r = SJ.advance(r, 16); assert.equal(r.state, 'complete'); assert.equal(SJ.nextLevel(r), null)
})

// ---- THE BUILD, SIMULATED: the pure planner driven to the bottom on a voxel world, every op applied as the bot would ----
let exitChecks = 0, exitFails = []
function simulate ({ c = 40, bottom = 16, holes = [], sand = [], wet = [], away = 's', interruptEvery = 0, checkExit = false } = {}) {
  const site = { origin: { x: 0, z: 0 }, away, c }
  let rec = SJ.newShaftRecord({ site, bottom, landings: SJ.plannedLandings(c, null, bottom), home: { x: 0, y: c, z: -20 } })
  const env = SP.envelopeLevels(c, bottom, rec.landings)
  const digSet = new Set(env.dig.map(([u, y, v]) => `${u},${y},${v}`))
  const m = new Map(), K = (u, y, v) => `${u},${y},${v}`
  const STONE = { name: 'stone', boundingBox: 'block' }, AIR = { name: 'air', boundingBox: 'empty' }
  const read = (u, y, v) => m.get(K(u, y, v)) ?? (y >= c ? AIR : STONE)
  for (const h of holes) m.set(K(...h), AIR)
  for (const h of sand) m.set(K(...h), { name: 'sand', boundingBox: 'block' })
  for (const h of wet) m.set(K(...h), { name: 'water', boundingBox: 'empty' })
  let feet = { u: 0, y: c, v: -1 }
  const log = [], counts = {}
  for (let i = 0; i < 20000; i++) {
    let op = SJ.shaftNextOp({ rec, read, feet, digSet })
    if (op.op === 'landing') op = SJ.landingNextOp({ yL: op.y, read, feet, digSet })
    counts[op.op] = (counts[op.op] ?? 0) + 1
    if (op.op === 'done' || op.op === 'close' || op.op === 'wait') return { op, rec, read, counts, log, feet, digSet, site }
    switch (op.op) {
      case 'collar_dig': case 'dig': m.set(K(...op.cell), AIR); break
      case 'line': case 'fill_floor': m.set(K(...op.cell), { name: 'cobblestone', boundingBox: 'block' }); break
      case 'ladder': m.set(K(op.u, op.y, 0), { name: 'ladder', boundingBox: 'block', facing: SI.ladderFacing(away, op.u) }); break
      case 'move_down': feet = { u: op.u, y: op.y, v: 0 }; break
      case 'walk': feet = { u: op.to[0], y: op.to[1], v: op.to[2] }; break
      case 'descend': { const d = SJ.descentPlan({ rec, read }); if (d.blocked) return { op: { op: 'close', why: d.blocked }, rec, read, counts, log, feet, digSet, site }; feet = d.land; break }
      case 'advance': rec = SJ.advance(rec, op.y); if (op.y === c) feet = { u: 1, y: c, v: 0 }; break
      case 'landing_done': rec = { ...rec, landings_done: [...(rec.landings_done ?? []), op.y] }; break
      default: throw new Error('op ' + op.op)
    }
    log.push(op.op + JSON.stringify(op.to ?? op.cell ?? op.u ?? ''))
    // EVERY STATE INSIDE THE SHAFT HAS A VERIFIED, EXECUTABLE EXIT (the hold's remedy exists at every resume state; Codex
    // plan r2 P1 / Claude r2 P1-1): the world read in world coordinates over the same voxels
    if (checkExit) {
      const idx = SJ.shaftIndex(rec), w = SJ.worldOf(site, feet.u, feet.y, feet.v)
      if (idx.inEnvelope(w.x, feet.y, w.z)) {
        const wr = (x, y, z) => { const l = SJ.toLocal(site.origin, site.away, x, z); return read(l.u, y, l.v) }
        const ex = SI.ladderExit(idx, wr, { x: w.x + 0.5, y: feet.y, z: w.z + 0.5 })
        exitChecks++
        if (!ex.ok) exitFails.push(`${JSON.stringify(feet)} after ${op.op}: ${ex.why}`)
      }
    }
    if (interruptEvery && op.op !== 'descend' && i % interruptEvery === interruptEvery - 1 && rec.frontier <= c) feet = { u: 0, y: c, v: -1 }   // a new visit: back on the pad; only the world and the record carry over
  }
  throw new Error('no end: ' + log.slice(-12).join(',') + ' feet ' + JSON.stringify(feet) + ' frontier ' + rec.frontier)
}
await t('THE BUILD (pure planner, simulated): collar to bottom -- both ladder columns at every level, every lining cell solid, every landing open with a proven floor', () => {
  const r = simulate({ c: 40, bottom: 16, holes: [[-1, 35, 0], [2, 30, 0], [0, 28, 1], [1, 27, -1], [0, 25, 0], [1, 31, 0]], sand: [[2, 33, 0]] })
  assert.equal(r.op.op, 'done', JSON.stringify(r.op)); assert.equal(r.rec.state, 'complete')
  for (let y = 39; y >= 16; y--) for (const u of [0, 1]) assert.equal(r.read(u, y, 0).name, 'ladder', `ladder ${u},${y}`)
  const idx = SJ.shaftIndex(r.rec)
  const shell = SP.envelopeLevels(40, 16, r.rec.landings).shell
  for (const [u, y, v] of shell) { if (y === 40 && v === -1) continue; const b = r.read(u, y, v); assert.ok(SJ.goodSolid(b, r.read(u, y - 1, v)), `lining ${u},${y},${v} = ${b.name}`) }
  for (const yL of r.rec.landings) for (const [u, v] of SJ.landingOrder()) for (const y of [yL, yL + 1]) assert.ok(SJ.isOpen(r.read(u, y, v)), `landing ${yL} ${u},${y},${v}`)
  assert.ok(r.counts.fill_floor >= 1, 'the cave under (0,26) was filled before the step-down (positive control)')
  assert.ok(r.counts.line >= 7, 'the holes and the sand were lined')
})
await t('RESUME FROM ANY STATE: the same build interrupted every 3..13 ops (a new visit from the pad each time) finishes identically', () => {
  for (const every of [3, 4, 5, 7, 13]) {
    const r = simulate({ c: 40, bottom: 16, holes: [[-1, 35, 0], [0, 25, 0], [1, 31, 0], [0, 32, 3]], interruptEvery: every })
    assert.equal(r.op.op, 'done', `every ${every}: ${JSON.stringify(r.op)}`)
    for (let y = 39; y >= 16; y--) for (const u of [0, 1]) assert.equal(r.read(u, y, 0).name, 'ladder', `every ${every}: ladder ${u},${y}`)
  }
})
await t('DESCENT never rides onto an unproven floor (a resumed builder, the cell below the frontier dug, its floor a cave)', () => {
  const site = { origin: { x: 0, z: 0 }, away: 's', c: 40 }
  const rec = { ...SJ.newShaftRecord({ site, bottom: 16, landings: [], home: { x: 0, y: 40, z: 0 } }), frontier: 30 }
  const m = new Map([['0,29,0', { name: 'ladder', boundingBox: 'block' }], ['1,29,0', { name: 'ladder', boundingBox: 'block' }], ['0,28,0', { name: 'air', boundingBox: 'empty' }], ['1,28,0', { name: 'air', boundingBox: 'empty' }]])
  const read = (u, y, v) => m.get(`${u},${y},${v}`) ?? { name: 'stone', boundingBox: 'block' }
  assert.ok(SJ.descentPlan({ rec, read }).blocked, 'both open, both floors caves: blocked')
  m.set('1,28,0', { name: 'stone', boundingBox: 'block' })
  assert.deepEqual(SJ.descentPlan({ rec, read }), { col: 1, land: { u: 1, y: 29, v: 0 } }, 'the proven floor')
  m.set('1,29,0', { name: 'stone', boundingBox: 'block' }); m.set('0,29,0', { name: 'stone', boundingBox: 'block' })
  assert.deepEqual(SJ.descentPlan({ rec, read }), { col: 0, land: { u: 0, y: 30, v: 0 } }, 'nothing opened yet: land at the frontier')
})
await t('A CAVITY (Claude plan r1 P1-6): a lining cell with no solid neighbour is chained through one neighbour; a floor over a cave is filled; a cell with nothing within one cell closes', () => {
  // a 3x3x3 air pocket beside column 0 at y 30..32 (the wall cell (-1,31,0) floats) and a cave under (1,26)
  const holes = []
  for (let u = -3; u <= -1; u++) for (let y = 30; y <= 32; y++) for (let v = -1; v <= 1; v++) holes.push([u, y, v])
  holes.push([1, 25, 0], [1, 24, 0], [0, 25, 1])
  const r = simulate({ c: 40, bottom: 16, holes })
  assert.equal(r.op.op, 'done', JSON.stringify(r.op))
  for (let y = 39; y >= 16; y--) for (const u of [0, 1]) assert.equal(r.read(u, y, 0).name, 'ladder')
  // a 5x5x5 void: the wall cell has no solid neighbour within one cell -> close (the shaft stops above, never digs into it)
  const big = []
  for (let u = -6; u <= -1; u++) for (let y = 27; y <= 33; y++) for (let v = -3; v <= 3; v++) big.push([u, y, v])
  const r2 = simulate({ c: 40, bottom: 16, holes: big })
  // the lining STACKS DOWN the void: each wall cell hangs under the one placed the level before (E2: the underside is
  // clickable) -- the build completes, every lining cell solid
  assert.equal(r2.op.op, 'done', JSON.stringify(r2.op))
  for (const [u, y, v] of SP.envelopeLevels(40, 16, r2.rec.landings).shell) { if (y === 40 && v === -1) continue; assert.ok(SJ.goodSolid(r2.read(u, y, v), r2.read(u, y - 1, v)), `lining ${u},${y},${v}`) }
  // the chain rule itself: a floating cell -> a neighbour with support first; nothing within one cell -> 'none'
  const air = () => ({ name: 'air', boundingBox: 'empty' }), stone = { name: 'stone', boundingBox: 'block' }
  const only = cells => (u, y, v) => (cells.some(c => c.join() === [u, y, v].join()) ? stone : air())
  assert.equal(SJ.supportChain(only([[5, 5, 6]]), new Set(), [5, 5, 5]), null, 'a solid neighbour: supported')
  assert.deepEqual(SJ.supportChain(only([[5, 5, 7]]), new Set(), [5, 5, 5]), [5, 5, 6], 'one cell away: chain through it')
  assert.equal(SJ.supportChain(only([[5, 5, 8]]), new Set(), [5, 5, 5]), 'none', 'two cells away: none')
})
await t('THE HOLD ALWAYS HAS A REMEDY: at every state of a whole build (4 orientations), the bot inside the shaft has a verified, executable ladder exit', () => {
  for (const away of ['s', 'n', 'e', 'w']) {
    exitChecks = 0; exitFails = []
    const r = simulate({ c: 40, bottom: 16, away, holes: [[-1, 35, 0], [0, 25, 0], [0, 32, 3]], checkExit: true })
    assert.equal(r.op.op, 'done', away)
    assert.ok(exitChecks > 200, `${away}: positive control: ${exitChecks} states checked`)
    assert.deepEqual(exitFails.slice(0, 3), [], `${away}: states with no exit`)
  }
})
await t('THE HOLD IS BOUNDED (Claude plan r2 P1-1): two failed climbs in 10 min release it; outside the shaft nothing is held', () => {
  const st = { origin: { x: 10, z: -7 }, away: 'e', c: 70 }
  const { idx: ix, read } = builtWorld(st, 40)
  const f = (u, y, v) => { const w = SJ.worldOf(st, u, y, v); return { x: w.x + 0.5, y, z: w.z + 0.5 } }
  const now = 1_000_000
  assert.equal(SG.shaftHold(ix, read, f(0, 41, 0), { now }).hold, true)
  assert.equal(SG.shaftHold(ix, read, f(0, 41, 0), { now, fails: [now - 1000] }).hold, true, 'one failure: still held')
  const ex = SG.shaftHold(ix, read, f(0, 41, 0), { now, fails: [now - 1000, now - 2000] })
  assert.equal(ex.hold, false); assert.ok(ex.exhausted, 'two failures: released')
  assert.equal(SG.shaftHold(ix, read, f(0, 41, 0), { now, fails: [now - 11 * 60_000, now - 12 * 60_000] }).hold, true, 'old failures expire')
  assert.equal(SG.shaftHold(ix, read, f(5, 41, 5), { now }).hold, false, 'outside: nothing held')
})
await t('LIQUID IN THE LINING CLOSES (never digs into it); an unloaded cell waits', () => {
  const rp = simulate({ c: 40, bottom: 16, wet: [[0, 33, 1]] })
  assert.equal(rp.op.op, 'close', 'water behind a FUTURE PORTAL (landing 32, level 33) closes at the core step, before the landing digs it'); assert.equal(rp.rec.frontier, 34)
  const ra = simulate({ c: 40, bottom: 16, holes: [[1, 32, 1], [1, 33, 1]] })
  assert.equal(ra.op.op, 'done', 'an air portal is lined at the core step and dug again by the landing')
  const r = simulate({ c: 40, bottom: 16, wet: [[2, 30, 0]] })
  assert.equal(r.op.op, 'close'); assert.match(r.op.why, /liquid/); assert.equal(r.rec.frontier, 31, 'stopped at the level above')
})

// ---- T10 WITH THE REAL PATHFINDER (Claude plan r1 P1-4): mineflayer-pathfinder's own getNeighbors from every stand around
// the collar -- open (a visit) and capped -- never steps into a column or onto a ladder top, never places into the shaft
await t('T10, REAL Movements.getNeighbors: from every rim top and ground cell round the collar, open or capped, no move enters a column cell or the cells above it, none places into the envelope or breaks a reserved cell', async () => {
  const { default: mcDataLoader } = await import('minecraft-data')
  const { default: PBlock } = await import('prismarine-block')
  const { Movements } = await import('mineflayer-pathfinder')
  const Move = (await import('mineflayer-pathfinder/lib/move.js')).default
  const ST = await import('../src/structures.mjs')
  const mcData = mcDataLoader('1.21.8'), Block = PBlock('1.21.8')
  const blk = (name, props = null) => { const b = props ? Block.fromString(`${name}[${Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',')}]`, 0) : Block.fromStateId(mcData.blocksByName[name].defaultState, 0); return b }
  for (const away of ['s', 'e']) for (const capped of [false, true]) {
    const st = { origin: { x: 0, z: 0 }, away, c: 70 }
    const rec = { ...SJ.newShaftRecord({ site: st, bottom: 16, landings: SJ.plannedLandings(70), home: { x: 0, y: 70, z: -20 } }), frontier: 60 }
    const ix = SJ.shaftIndex(rec)
    const world = new Map(), K = (x, y, z) => `${x},${y},${z}`
    const set = (u, y, v, b) => { const w = SJ.worldOf(st, u, y, v); world.set(K(w.x, y, w.z), b) }
    for (let y = 60; y <= 69; y++) for (const u of [0, 1]) set(u, y, 0, blk('ladder', { facing: SI.ladderFacing(away, u), waterlogged: false }))
    for (const u of [0, 1]) set(u, 70, 0, capped ? blk('cobblestone') : blk('air'))
    for (const [u, v] of [[-1, 0], [2, 0], [0, 1], [1, 1], [-1, 1], [2, 1]]) set(u, 70, v, blk('cobblestone'))
    const bot = { registry: mcData, game: { minY: -64, height: 384 }, entities: {}, entity: { effects: {} }, inventory: { items: () => [] }, pathfinder: { bestHarvestTool: () => null }, blockAt: v => { const b = world.get(K(v.x, v.y, v.z)) ?? (v.y >= 70 ? blk('air') : blk('stone')); b.position = v; return b } }
    const m = new Movements(bot)
    m.scafoldingBlocks = [mcData.itemsByName.cobblestone.id]; m.countScaffoldingItems = () => 64; m.allowParkour = true; m.allow1by1towers = true
    const keep = { shaft: ix }
    m.exclusionAreasStep = [b => ST.shaftStepCost(keep, b)]; m.exclusionAreasBreak = [b => ST.shaftBreakCost(keep, b)]; m.exclusionAreasPlace = [b => ST.shaftPlaceCost(keep, b)]
    let starts = 0, moves = 0
    for (let u = -3; u <= 4; u++) for (let v = -3; v <= 3; v++) for (const fy of [70, 71]) {
      const w = SJ.worldOf(st, u, fy, v)
      const feetB = bot.blockAt({ x: w.x, y: fy, z: w.z }), below = bot.blockAt({ x: w.x, y: fy - 1, z: w.z })
      if (feetB.boundingBox !== 'empty' || below.boundingBox !== 'block' || below.name === 'ladder' || ix.inEnvelope(w.x, fy, w.z)) continue
      starts++
      for (const n of m.getNeighbors(new Move(w.x, fy, w.z, 64, 0))) {
        moves++
        assert.ok(!ix.core(n.x, n.y, n.z) && !ix.aboveCollar(n.x, n.y, n.z), `${away}${capped ? ' capped' : ''}: a move from ${u},${fy},${v} lands in ${n.x},${n.y},${n.z}`)
        for (const p0 of n.toPlace ?? []) { const p = { x: p0.x + (p0.dx ?? 0), y: p0.y + (p0.dy ?? 0), z: p0.z + (p0.dz ?? 0) }; assert.ok(!ix.inEnvelope(p.x, p.y, p.z), `${away}: from ${u},${fy},${v} to ${n.x},${n.y},${n.z} places into the envelope at ${p.x},${p.y},${p.z} cost ${n.cost}`) }
        for (const b of n.toBreak ?? []) assert.ok(!ix.has(b.x, b.y, b.z), `${away}: breaks a reserved cell at ${b.x},${b.y},${b.z}`)
      }
    }
    assert.ok(starts >= 20 && moves >= 100, `positive control: ${starts} stands, ${moves} moves examined`)
    // POSITIVE CONTROL: without the exclusions the open collar IS entered
    if (!capped) {
      const m0 = new Movements(bot); m0.scafoldingBlocks = m.scafoldingBlocks; m0.countScaffoldingItems = () => 64
      let entered = 0
      for (let u = -3; u <= 4; u++) for (let v = -3; v <= 3; v++) { const w = SJ.worldOf(st, u, 71, v); if (bot.blockAt({ x: w.x, y: 70, z: w.z }).name !== 'cobblestone') continue; for (const n of m0.getNeighbors(new Move(w.x, 71, w.z, 64, 0))) if (ix.core(n.x, n.y, n.z) || ix.aboveCollar(n.x, n.y, n.z)) entered++ }
      assert.ok(entered > 0, `${away}: without the exclusions a rim top steps into or over the open collar (${entered})`)
    }
  }
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
