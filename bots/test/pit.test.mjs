// PIT-01SHOW: the town's dirt borrow pit (bots/src/pit.mjs). The plan over the REAL site (the 11-18 showcase copy of P1), the sea-breach
// guard, the layer gate and the demand -- and the COMPOSED CHAIN: the plan, the record, the layer gate and the guard driving the real
// clear-dig visit (buildrun.mjs runVisit) on a fake server, visit after visit, until the pit is dug: no cell opened beside water, every
// stage walkable, a cell the guard refuses set aside without holding the rest. Then the same chain over the real P1 blocks (the replay).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const P = await import('../src/pit.mjs')
const R = await import('../src/buildrun.mjs')
const PJ = await import('../src/buildproj.mjs')
const { bot: fakeBot } = await import('./helpers/buildfake.mjs')
const mcData = createRequire(import.meta.url)('minecraft-data')('1.21.8')
const SRC = new URL('../src/pit.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
/** A mutant of pit.mjs, its anchor present and unique (CLAUDE.md), imported beside the source. */
async function withMutant (old, neu, fn) {
  const src = fs.readFileSync(SRC, 'utf8')
  assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${old.slice(0, 80)}`)
  const out = new URL(`../src/_mutant-pit-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
/** BOTH WAYS: the scenario passes on the real module and throws on the mutant. */
async function killed (old, neu, scenario) {
  await scenario(P)
  let dead = false
  await withMutant(old, neu, async M => { try { await scenario(M) } catch { dead = true } })
  assert.ok(dead, `the mutant survived: ${neu.slice(0, 80)}`)
}

const box = n => (n === 'air' || n === 'cave_air' ? 'empty' : mcData.blocksByName[n]?.boundingBox ?? 'block')
/** A fake server over a base read (name | null) with a mutable overlay. */
function serverOf (base) {
  const cells = new Map()
  const name = (x, y, z) => cells.get(`${x},${y},${z}`) ?? base(x, y, z)
  const read = (x, y, z) => { const n = name(x, y, z); return n == null ? null : { name: n, boundingBox: box(n) } }
  return { read, cells, placedAt: new Map(), seen: new Map(), set: (a, n) => cells.set(a.join(','), n) }
}
/** THE SMALL WORLD: grass at 64 over dirt to 61, stone below; the sea (water to 63) from x = 10 east: 2-3 columns off the outline's east edge. */
const G = 64
function smallWorld ({ seaX = 10, extra = {} } = {}) {
  return serverOf((x, y, z) => {
    if (Math.abs(x) > 40 || Math.abs(z) > 40 || y < 40 || y > 90) return null
    const k = `${x},${y},${z}`
    if (k in extra) return extra[k]
    if (x >= seaX) return y <= 58 ? 'stone' : y <= 63 ? 'water' : 'air'
    return y > G ? 'air' : y === G ? 'grass_block' : y >= 61 ? 'dirt' : 'stone'
  })
}
const SITE = { cx: 0, cz: 0, w: 15, l: 21, floor: 61 }
const HOME = { x: 0, y: G + 1, z: 0 }
const isWater = n => /^(water|ice)$/.test(n ?? '')

/** The project directory with the record published. */
function project (record) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pit-'))
  const key = PJ.projKey(HOME, 'pit')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  return { dir, key, gen: pub.gen }
}
/**
 * THE VISITS (skills.mjs buildPit's dig half on the fake server): each visit takes a slot, reads pitDigNow for its half, and runs the
 * REAL runVisit on pitView with pitClearOk as the clear's live check, rooted where the bot stands. -> { visits, digs: [[x, y, z, visit]],
 * stops } once pitDigNow reads done (or `max` visits).
 */
async function digAll (M, srv, rec, { max = 80, names = ['A', 'B'], after = null } = {}) {
  const pr = project(rec)
  const digs = [], stops = []
  let v = 0
  for (; v < max; v++) {
    rec = PJ.recordHead(pr.dir, pr.key).head.rec   // the head as it stands (a miss publishes the next generation)
    const me = names[v % names.length]
    const slot = PJ.takeSlot(pr.dir, pr.key, me, P.PIT_BUILDERS)
    assert.ok(slot.ok, 'a slot')
    const now = M.pitDigNow(srv.read, rec, { half: M.PIT_HALVES[(slot.slot - 1) % 2] })
    if (now.phase === 'done') { PJ.releaseLease(pr.dir, pr.key, `slot${slot.slot}`, me, slot.gen); break }
    assert.equal(now.phase, 'dig', 'every cell read')
    const e = fakeBot(srv, me, { feet: [rec.site.cx, G + 1, rec.site.cz - 13], inv: { stone_pickaxe: 1 } })
    const dig0 = e.dig
    e.dig = async (c, expect) => { const r = await dig0(c, expect); if (r === 'confirmed') digs.push([...c, v]); return r }
    const f = e.feet()
    const root = { x: f[0], y: f[1], z: f[2] }
    const r = await R.runVisit({ dir: pr.dir, key: pr.key, me, home: root, stood: [], record: M.pitView(rec, now), recordGen: PJ.recordHead(pr.dir, pr.key).head.gen, palette: {}, slot: slot.slot, slotGen: slot.gen,
      clearPart: M.pitClearPart(now.half), clearOk: (q, rd) => M.pitClearOk(q, rd), domain: () => true, blockLayer: false, clearMax: M.PIT.visitMax, walkR: 36 }, e, { maxSteps: 400 })
    stops.push(r.stop)
    const missed = M.pitMissKeys(srv.read, now, r)
    if (missed.length) PJ.publishRecord(pr.dir, pr.key, cur => M.pitMissed(cur, missed))
    if (process.env.PIT_DEBUG) console.log('        visit', v, me, now.y, now.half, now.cells.length, r.stop, r.why, r.cleared)
    PJ.releaseLease(pr.dir, pr.key, `slot${slot.slot}`, me, r.slotGen ?? slot.gen)
    if (after) after(v, srv)
  }
  return { visits: v, digs, stops, rec: PJ.recordHead(pr.dir, pr.key).head.rec }
}
/** No dug cell (air now, listed) has water or ice as a face neighbour, and none lies within the rim of water. -> the offending cells. */
function breaches (srv, rec, T = P.PIT) {
  const bad = []
  for (const c of rec.clear) {
    if (srv.read(...c.at)?.name !== 'air') continue
    const [x, y, z] = c.at
    for (let dx = -T.rim; dx <= T.rim; dx++) for (let dz = -T.rim; dz <= T.rim; dz++) for (let dy = -1; dy <= 1; dy++) if (isWater(srv.read(x + dx, y + dy, z + dz)?.name)) bad.push(c.at.join(','))
  }
  return [...new Set(bad)]
}
/** The walking surface's heights over the outline and a column round it: the first solid block from above (a canopy is not it; a lid over a
 *  cave is: a bot stands on it). */
function heights (srv, plan, floor) {
  const m = new Map()
  for (const k of plan.pit) {
    const [x, z] = k.split(',').map(Number)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const kk = `${x + dx},${z + dz}`
      if (m.has(kk)) continue
      let g = null
      for (let y = floor + 14; y >= floor - 6; y--) { const b = srv.read(x + dx, y, z + dz); if (!b) break; if (!P.isSoft(b) && !/_(leaves|log)$/.test(b.name) && !isWater(b.name)) { g = y; break } }
      // a top that hangs over air is a floating leftover (a bot's, or a felled canopy's snow): not the ground anyone walks; not compared
      const under = g == null ? null : srv.read(x + dx, g - 1, z + dz)
      // OUTSIDE the pit the ground is the plan's own (columnOf: a run of leftovers over air is not it -- the clean-up's, never the pit's)
      if (!plan.pit.includes(kk)) { const c = P.columnOf(srv.read, x + dx, z + dz, floor); m.set(kk, c.unread || c.perched.length ? null : c.g); continue }
      m.set(kk, under && (P.isSoft(under) || under.boundingBox !== 'block') ? null : g)
    }
  }
  return m
}
/** The worst 8-neighbour step the dig ADDED (a pair of columns, one in the pit, whose step now is over 1 and over what it was). */
function worstNewStep (srv, plan, before, floor) {
  const now = heights(srv, plan, floor)
  let worst = 0
  const heldK = new Set((plan.held ?? []).map(h => `${h[0]},${h[1]}`))   // a held column is the finish's (named in the plan), never a step the dig made
  for (const k of plan.pit) {
    const [x, z] = k.split(',').map(Number)
    if (heldK.has(k)) continue
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const kk = `${x + dx},${z + dz}`
      if (heldK.has(kk)) continue
      const a = now.get(k), b = now.get(kk), a0 = before.get(k), b0 = before.get(kk)
      if (a == null || b == null || a0 == null || b0 == null) continue
      const d = Math.abs(a - b)
      if (d > 1 && d > Math.abs(a0 - b0)) { worst = Math.max(worst, d); if (process.env.PIT_DEBUG && d >= 3) console.log('        step', k, a, a0, kk, b, b0) }
    }
  }
  return worst
}

// ---------------------------------------------------------------------------------------------------------------------------
console.log('THE SWITCH AND THE SITE')
await t('PIT_SITE parses the owner\'s site; off / malformed / out of range are no project; the town file\'s key; another home\'s file is none', () => {
  assert.deepEqual(P.pitSiteOf({ PIT_SITE: '-51,-99,15,21/60' }), { cx: -51, cz: -99, w: 15, l: 21, floor: 60 })
  for (const v of [undefined, '', 'off', 'no', '-51,-99,15/60', '-51,-99,15,21', '-51,-99,15,21/x', '-51,-99,3,21/60', '-51,-99,15,99/60', '1,2,15,21/60/9']) assert.equal(P.pitSiteOf({ PIT_SITE: v }), null, String(v))
  assert.equal(P.pitSiteEnvOff({ PIT_SITE: 'off' }), true); assert.equal(P.pitSiteEnvOff({}), false)
  const json = { home: [0, 70, 0], pit: { centre: [-51, -99], size: [15, 21], floor: 60 } }
  assert.deepEqual(P.pitSiteOfSeed(json, { x: 0, y: 70, z: 0 }), { cx: -51, cz: -99, w: 15, l: 21, floor: 60 })
  assert.equal(P.pitSiteOfSeed(json, { x: 5, y: 70, z: 0 }), null, 'another town\'s file')
  assert.equal(P.pitSiteOfSeed({ home: [0, 70, 0] }), null, 'no key: no project')
  assert.equal(P.pitSiteOfSeed({ pit: { centre: [1], size: [15, 21], floor: 60 } }), null)
})
await t('the site file is read once by pitsitefile.mjs: env first, `off` forces none, the town file otherwise', async () => {
  const F = await import('../src/pitsitefile.mjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitsite-'))
  fs.writeFileSync(path.join(dir, 'town-site.json'), JSON.stringify({ home: [0, 70, 0], pit: { centre: [-51, -99], size: [15, 21], floor: 60 } }))
  assert.deepEqual(F.pitSiteNow({}, dir, { x: 0, y: 70, z: 0 }), { cx: -51, cz: -99, w: 15, l: 21, floor: 60 })
  assert.equal(F.pitSiteNow({ PIT_SITE: 'off' }, dir, { x: 0, y: 70, z: 0 }), null)
  assert.deepEqual(F.pitSiteNow({ PIT_SITE: '1,2,9,9/60' }, dir, { x: 0, y: 70, z: 0 }), { cx: 1, cz: 2, w: 9, l: 9, floor: 60 })
  assert.equal(F.pitSiteNow({}, fs.mkdtempSync(path.join(os.tmpdir(), 'pitsite-')), { x: 0, y: 70, z: 0 }), null, 'no file: none')
})
await t('a site named makes the pit a project in the order; none: not a project at all', async () => {
  const S = await import('../src/shop.mjs')
  assert.equal(S.projectsOn().some(p => p.plot === 'pit'), P.PITSITE.on, 'listed exactly when a site is named')
})

console.log('THE SHAPE')
await t('the cove outline is curved (not an ellipse, not a box), whole, about w x l, and every column has two outline neighbours', () => {
  const o = P.coveOutline({ cx: 0, cz: 0, w: 15, l: 21, floor: 60 })
  const xs = [...o].map(k => Number(k.split(',')[0])), zs = [...o].map(k => Number(k.split(',')[1]))
  assert.ok(Math.max(...xs) - Math.min(...xs) + 1 >= 13 && Math.max(...xs) - Math.min(...xs) + 1 <= 19)
  assert.ok(Math.max(...zs) - Math.min(...zs) + 1 >= 19 && Math.max(...zs) - Math.min(...zs) + 1 <= 25)
  const ell = new Set(); for (let z = -12; z <= 12; z++) for (let x = -9; x <= 9; x++) if ((x / 7.5) ** 2 + (z / 10.5) ** 2 <= 1) ell.add(`${x},${z}`)
  assert.ok([...o].some(k => !ell.has(k)) && [...ell].some(k => !o.has(k)), 'its curve is its own')
  for (const k of o) { const [x, z] = k.split(',').map(Number); assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => o.has(`${x + a},${z + b}`)).length >= 2, k) }
})

console.log('THE PLAN OVER THE REAL SITE (P1, the 11-18 showcase copy)')
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/pit-p1-world18full-1118.json', import.meta.url), 'utf8'))
const fxCells = Buffer.from(FX.cells, 'base64')
const fxRead = (x, y, z) => {
  const [x0, z0, x1, z1] = FX.box, [y0, y1] = FX.y
  if (x < x0 || x > x1 || z < z0 || z > z1 || y < y0 || y > y1) return null
  const raw = FX.palette[fxCells[(x - x0) + (x1 - x0 + 1) * ((z - z0) + (z1 - z0 + 1) * (y - y0))]]
  return raw === '?' ? null : raw.replace(/\[.*$/, '')
}
const P1 = { cx: -51, cz: -99, w: 15, l: 21, floor: 60 }
await t('P1: planned whole; ~470 dirt (1.6x the town\'s 287); no column within 3 of water; no new 2-high step; layers top down', () => {
  const srv = serverOf(fxRead)
  const plan = P.pitPlan(srv.read, P1)
  assert.equal(plan.ok, true, plan.why)
  assert.ok(plan.water > 100, `the sea is in the box (positive control): ${plan.water} water columns`)
  assert.ok(plan.rim.length >= 10, `the rim keeps columns back from the water: ${plan.rim.length}`)
  assert.ok(plan.dirt >= 287 && plan.dirt <= 900, `dirt ${plan.dirt}`)
  assert.equal(plan.steps2, 0, 'the bowl adds no 2-high step')
  for (const c of plan.cells) {
    const [x, y, z] = c.at
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -2; dy <= 2; dy++) assert.ok(!isWater(srv.read(x + dx, y + dy, z + dz)?.name), `cell ${c.at} near water`)
  }
  assert.deepEqual(plan.layers.map(L => L.y), [...plan.layers.map(L => L.y)].sort((a, b) => b - a), 'top down')
  assert.equal(plan.layers.reduce((s, L) => s + L.dirt, 0), plan.dirt)
  const rec = P.pitRecord(plan, { now: 1, by: 'A' })
  assert.equal(rec.clear.length, plan.cells.length); assert.ok(rec.clear.every(c => c.kind === 'cut' && c.l === c.at[1] && /^[WE]$/.test(c.h)))
  assert.deepEqual(rec.cells, []); assert.equal(rec.blueprint, 'pit@1')
})
await t('P1 mutant: the rim distance off -- the plan digs beside the sea (killed)', async () => {
  await killed('const near = (x, z) => water.find(([wx, wz]) => cheb(x, z, wx, wz) <= T.rim)', 'const near = (x, z) => water.find(([wx, wz]) => cheb(x, z, wx, wz) <= 0)', M => {
    const plan = M.pitPlan(serverOf(fxRead).read, P1, { ...M.PIT })
    const srv = serverOf(fxRead)
    for (const c of plan.cells) { const [x, y, z] = c.at; for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) assert.ok(!isWater(srv.read(x + dx, y, z + dz)?.name)) }
  })
})

console.log('THE GUARD')
await t('pitGuard: water / ice / a waterlogged block / lava within the rim refuse; unread refuses; a cave under the floor refuses; a covered cell waits; a perched block\'s air is no floor', () => {
  const W = smallWorld()
  assert.equal(P.pitGuard(W.read, [0, 64, 0]), null, 'dry ground digs')
  assert.equal(P.pitGuard(W.read, [7, 64, 0])?.why, 'water', 'the sea 3 columns off')
  assert.equal(P.pitGuard(W.read, [6, 64, 0]), null, 'the sea 4 columns off')
  const ice = smallWorld({ extra: { '2,65,2': 'ice' } }); assert.equal(P.pitGuard(ice.read, [0, 64, 0])?.why, 'water', 'ice is water')
  const wl = serverOf((x, y, z) => (y > 64 ? 'air' : 'dirt')); wl.read0 = wl.read
  const wlRead = (x, y, z) => (x === 1 && y === 64 && z === 1 ? { name: 'oak_stairs', boundingBox: 'block', props: { waterlogged: true } } : wl.read(x, y, z))
  assert.equal(P.pitGuard(wlRead, [0, 64, 0])?.why, 'water', 'a waterlogged block')
  const lava = smallWorld({ extra: { '-2,62,0': 'lava' } }); assert.equal(P.pitGuard(lava.read, [0, 63, 0])?.why, 'lava')
  const un = serverOf((x, y, z) => (x > 2 ? null : y > 64 ? 'air' : 'dirt')); assert.equal(P.pitGuard(un.read, [0, 64, 0])?.why, 'unread')
  const cave = smallWorld({ extra: { '0,62,0': 'air' } }); assert.equal(P.pitGuard(cave.read, [0, 63, 0])?.why, 'floor_open')
  assert.equal(P.pitGuard(W.read, [0, 63, 0])?.why, 'covered')
  const per = smallWorld({ extra: { '0,67,0': 'dirt' } }); assert.equal(P.pitGuard(per.read, [0, 67, 0])?.why, 'floor_open'); assert.equal(P.pitGuard(per.read, [0, 67, 0], P.PIT, { perched: true }), null)
})
await t('pitDigNow: the layer gate takes the HIGHEST standing height only; a refused cell is set aside (held) and never holds the layers below; halves', () => {
  const W = smallWorld()
  const plan = P.pitPlan(W.read, SITE); assert.ok(plan.ok, plan.why)
  const rec = P.pitRecord(plan)
  const n0 = P.pitDigNow(W.read, rec)
  assert.equal(n0.phase, 'dig'); assert.equal(n0.y, 64); assert.ok(n0.cells.every(c => c.at[1] === 64))
  const hw = P.pitDigNow(W.read, rec, { half: 'W' }); assert.ok(hw.cells.length && hw.cells.every(c => c.h === 'W'))
  // the top layer dug except one cell beside water poured in later: that cell is held, the next layer is the gate
  const wet = rec.clear.find(c => c.at[1] === 64)
  for (const c of rec.clear) if (c.at[1] === 64 && c !== wet) W.set(c.at, 'air')
  W.set([wet.at[0] + 2, wet.at[1] + 1, wet.at[2]], 'water')
  const n1 = P.pitDigNow(W.read, rec)
  assert.ok(n1.held.some(h => h.at.join() === wet.at.join() && h.why === 'water'), 'the wet cell is set aside')
  assert.equal(n1.y, 63, 'the layer below is the gate now')
  assert.ok(!n1.cells.some(c => Math.abs(c.at[0] - wet.at[0]) <= 3 && Math.abs(c.at[2] - wet.at[2]) <= 3), 'nothing near the water is offered')
})

await t('pitMissed: a cell no visit reaches is set aside after PIT.missMax misses (never stalls the layers); a visit stopped by a fence or the clock is no miss', () => {
  const rec = { plot: 'pit', clear: [] }
  const one = P.pitMissed(rec, ['1,70,1'])
  assert.deepEqual(one.aside, []); assert.equal(one.misses['1,70,1'], 1)
  const two = P.pitMissed(one, ['1,70,1'])
  assert.deepEqual(two.aside, ['1,70,1'])
  assert.equal(P.pitMissed(rec, []), null)
  const read = () => ({ name: 'oak_leaves', boundingBox: 'block' })
  const now = { cells: [{ at: [1, 70, 1] }] }
  assert.deepEqual(P.pitMissKeys(read, now, { cleared: 0, stop: 'complete' }), ['1,70,1'])
  assert.deepEqual(P.pitMissKeys(read, now, { cleared: 3, stop: 'complete' }), [])
  for (const stop of ['fence:segment', 'aborted', 'deadline']) assert.deepEqual(P.pitMissKeys(read, now, { cleared: 0, stop }), [], stop)
  const dug = P.pitDigNow((x, y, z) => (y > 70 ? { name: 'air', boundingBox: 'empty' } : y === 70 ? { name: 'oak_leaves', boundingBox: 'block' } : { name: 'dirt', boundingBox: 'block' }), { clear: [{ at: [0, 70, 0], h: 'W', l: 70, e: 0 }, { at: [0, 69, 0], h: 'W', l: 69, e: 1 }], aside: ['0,70,0'] })
  assert.ok(dug.held.some(h => h.why === 'unreached'), 'the set-aside leaf is held'); assert.equal(dug.y, 69, 'and the ground under it is the gate: a leaf above is no cover')
})
await t('MUTANT: a miss never sets aside -- the replay\'s unreachable leaf would hold the pit for good (killed)', async () => {
  await killed('if (misses[k] >= T.missMax) aside.add(k)', 'if (misses[k] >= Infinity) aside.add(k)', M => { assert.deepEqual(M.pitMissed(M.pitMissed({ plot: 'pit' }, ['k']), ['k']).aside, ['k']) })
})

console.log('THE COMPOSED CHAIN (plan -> record -> layer gate -> guard -> the real clear-dig visit), small world with a sea')
await t('dug to the design visit by visit: every listed cell gone, nothing opened beside the sea, every stage walkable, top down by layer', async () => {
  const W = smallWorld()
  const plan = P.pitPlan(W.read, SITE); assert.ok(plan.ok, plan.why)
  assert.ok(plan.rim.length > 0, 'the sea trims the outline (positive control)')
  const rec = P.pitRecord(plan)
  let worst = 0
  const before = heights(W, plan, SITE.floor)
  const run = await digAll(P, W, rec, { after: () => { worst = Math.max(worst, worstNewStep(W, plan, before, SITE.floor)) } })
  assert.equal(P.pitDigNow(W.read, run.rec).phase, 'done', `${run.visits} visits ${run.stops}`)
  assert.deepEqual(run.rec.aside ?? [], [], 'nothing set aside on open ground')
  assert.equal(rec.clear.filter(c => W.read(...c.at).name !== 'air').length, 0, 'every listed cell dug')
  assert.deepEqual(breaches(W, rec), [])
  assert.ok(worst <= 1, `a stage had a ${worst}-high step`)
  const byVisit = new Map(); for (const [, y, , v] of run.digs) byVisit.set(v, [...(byVisit.get(v) ?? []), y])
  for (const [v, ys] of byVisit) assert.equal(new Set(ys).size, 1, `visit ${v} dug one layer: ${[...new Set(ys)]}`)
  let last = Infinity; for (const [, y] of run.digs) { assert.ok(y <= last, 'never a higher layer after a lower one'); last = y }
  assert.ok(run.digs.length === rec.clear.length, `${run.digs.length} digs`)
})
await t('the refusal chain: water appears beside the pit after its plan -- those cells are set aside, the rest is dug, never a breach, the pit completes', async () => {
  const W = smallWorld()
  const plan = P.pitPlan(W.read, SITE)
  const rec = P.pitRecord(plan)
  // after the plan, before the dig: water the plan never saw, west of the outline under the ground's top (a bucket, a spring)
  W.set([-9, 63, 0], 'water')
  const run = await digAll(P, W, rec)
  const end = P.pitDigNow(W.read, run.rec)
  assert.equal(end.phase, 'done', `the dig ends (${run.stops})`)
  assert.ok(end.held.length > 0, 'cells near the water are set aside')
  assert.deepEqual(breaches(W, rec), [], 'no dug cell beside water')
  assert.ok(rec.clear.filter(c => W.read(...c.at).name === 'air').length > rec.clear.length * 0.8, 'the rest is dug')
})
await t('MUTANT: the guard blind to water -- the chain opens the pit to the poured water (killed)', async () => {
  await killed("if (isLiquidish(b)) return { why: /lava/.test(nm(b)) ? 'lava' : 'water', at: [x + dx, y + dy, z + dz] }", 'if (false) return null', async M => {
    const W = smallWorld()
    const rec = M.pitRecord(M.pitPlan(W.read, SITE))
    W.set([-9, 63, 0], 'water')
    await digAll(M, W, rec)
    assert.deepEqual(breaches(W, rec), [])
  })
})
await t('MUTANT: the layer gate off (every height at once) -- a stage gets a 2-high step (killed)', async () => {
  await killed('    if (c.at[1] !== out.y) break\n', '    if (c.at[1] !== out.y) {}\n', async M => {
    const W = smallWorld()
    const plan = M.pitPlan(W.read, SITE)
    const rec = M.pitRecord(plan)
    let worst = 0
    const before = heights(W, plan, SITE.floor)
    await digAll(M, W, rec, { names: ['A'], after: () => { worst = Math.max(worst, worstNewStep(W, plan, before, SITE.floor)) } })
    assert.ok(worst <= 1, `worst ${worst}`)
  })
})

console.log('THE REPLAY: the same chain over the REAL P1 blocks')
await t('P1 replay: dug to the design through the real visit, no breach of the sea or the lake, every stage walkable, the yield', async () => {
  const W = serverOf(fxRead)
  const plan = P.pitPlan(W.read, P1); assert.ok(plan.ok)
  const rec = P.pitRecord(plan)
  let worst = 0
  const t0 = Date.now()
  const before = heights(W, plan, P1.floor)
  const run = await digAll(P, W, rec, { max: 120, after: () => { worst = Math.max(worst, worstNewStep(W, plan, before, P1.floor)) } })
  const end = P.pitDigNow(W.read, run.rec)
  const dug = rec.clear.filter(c => W.read(...c.at).name === 'air')
  console.log(`        replay: ${run.visits} visits, ${dug.length}/${rec.clear.length} cells dug (${dug.filter(c => c.e).length} dirt), ${end.held.length} set aside (${(run.rec.aside ?? []).length} unreached), worst step ${worst}, ${Date.now() - t0} ms; stops ${[...new Set(run.stops)].join(',')}`)
  if (process.env.PIT_DEBUG) console.log('        held', JSON.stringify(end.held), 'col', [...Array(8)].map((_, i) => W.read(-54, 60 + i, -97).name).join(','))
  assert.equal(end.phase, 'done')
  assert.deepEqual(breaches(W, rec), [])
  assert.ok(worst <= 1, `worst ${worst}`)
  assert.ok(dug.filter(c => c.e).length >= 287, 'the town\'s need is in it')
  assert.ok(dug.length >= rec.clear.length - end.held.length - 2, 'everything the guard allows is dug (a stand reaches every cell)')
})

console.log('THE DEMAND')
await t('pitDemand: short of a named consumer -> dig; stocked, no need, or nothing read -> no dig; the bag\'s dug dirt counts', () => {
  assert.deepEqual(P.pitDemand({ needs: { tidy: 226, warehouse: 47, grade: null }, stock: 20 }), { dig: true, short: 253, need: 273, stock: 20, consumer: 'tidy', why: 'short' })
  assert.equal(P.pitDemand({ needs: { tidy: 30 }, stock: 40 }).dig, false)
  assert.equal(P.pitDemand({ needs: { tidy: 30 }, stock: 40 }).why, 'stocked')
  assert.equal(P.pitDemand({ needs: { tidy: 0, warehouse: 0 }, stock: 0 }).why, 'no_need')
  assert.equal(P.pitDemand({ needs: { tidy: null, warehouse: null } }).why, 'demand_unread')
  assert.equal(P.pitDemand({ needs: { tidy: null, warehouse: null } }).dig, false)
  assert.equal(P.pitDemand({ needs: { tidy: 50 }, stock: 10, bag: 40 }).dig, false, 'what the digger carries is the consumers\' already')
  assert.equal(P.pitDemand({ needs: { tidy: 50 }, stock: null }).short, 50, 'an unread index is the known part (0), never a guess upward')
  assert.equal(P.pitDigCap(10), 10); assert.equal(P.pitDigCap(500), P.PIT.visitMax); assert.equal(P.pitDigCap(0), 0)
})
await t('MUTANT: the demand digs while stocked (need, not short) -- killed', async () => {
  await killed("return { dig: short > 0,", 'return { dig: need > 0,', M => { assert.equal(M.pitDemand({ needs: { tidy: 30 }, stock: 40 }).dig, false) })
})
await t('pitFillSplit: the earth fills take the town\'s dirt first, the rest cobblestone; none in town: as before', () => {
  assert.deepEqual(P.pitFillSplit(32, 100), { dirt: 32, cobblestone: 0 })
  assert.deepEqual(P.pitFillSplit(32, 10), { dirt: 10, cobblestone: 22 })
  assert.deepEqual(P.pitFillSplit(32, 0), { dirt: 0, cobblestone: 32 })
  assert.deepEqual(P.pitFillSplit(0, 50), { dirt: 0, cobblestone: 0 })
})

console.log('THE BANK')
await t('pitBankOrder: the storehouse\'s dirt column first, then chests already holding dirt, then any with a free slot; nearest first; full and skipped never', () => {
  const c = [
    { k: 'a', pos: [5, 64, 5], dirt: 0, free: 10 }, { k: 'b', pos: [40, 64, 0], dirt: 64, free: 2 }, { k: 'c', pos: [1, 64, 1], dirt: 0, free: 0 },
    { k: 'd', pos: [60, 64, 0], dirt: 0, free: 5, column: true, room: 5 }, { k: 'e', pos: [2, 64, 0], dirt: 3, free: 1 },
  ]
  assert.deepEqual(P.pitBankOrder(c, { from: [0, 64, 0] }), ['d', 'e', 'b'])
  assert.deepEqual(P.pitBankOrder(c, { from: [0, 64, 0], skip: new Set(['d']), max: 5 }), ['e', 'b', 'a'])
  assert.equal(P.pitBankDue(40), 0, 'under the keep + bankMin'); assert.equal(P.pitBankDue(60), 44); assert.equal(P.pitBankDue(20, { final: true }), 4); assert.equal(P.pitBankDue(10, { final: true }), 0)
})

await t('pitBankSteps: a single 48-stack with a 16 keep banks (halves); whole stacks first; never below the keep; never past n', () => {
  const sum = st => st.reduce((t, x) => t + x.count, 0)
  const one = P.pitBankSteps([{ slot: 36, name: 'dirt', count: 48 }], 32, 16)
  assert.ok(sum(one) > 0 && sum(one) <= 32, JSON.stringify(one)); assert.ok(one.every(x => x.half && x.from === 48 - (one.indexOf(x) ? 24 : 0)))
  assert.deepEqual(P.pitBankSteps([{ slot: 1, name: 'dirt', count: 64 }, { slot: 2, name: 'dirt', count: 40 }, { slot: 3, name: 'cobblestone', count: 64 }], 88, 16), [{ slot: 1, name: 'dirt', count: 64 }, { slot: 2, name: 'dirt', count: 20, from: 40, half: true }])
  assert.deepEqual(P.pitBankSteps([{ slot: 1, name: 'dirt', count: 16 }], 10, 16), [], 'the keep')
  for (const [bag, n] of [[[{ slot: 1, name: 'dirt', count: 64 }, { slot: 2, name: 'dirt', count: 7 }], 30], [[{ slot: 1, name: 'dirt', count: 33 }], 100]]) {
    const st = P.pitBankSteps(bag, n, 16); const tot = bag.reduce((t, x) => t + x.count, 0)
    assert.ok(sum(st) <= n && tot - sum(st) >= 16, JSON.stringify(st))
  }
})
await t('MUTANT: whole stacks only (the halves gone) -- a single 48-stack banks nothing (killed)', async () => {
  await killed('    while (it.cur > 1 && Math.ceil(it.cur / 2) <= left) {', '    while (false) {', M => { assert.ok(M.pitBankSteps([{ slot: 36, name: 'dirt', count: 48 }], 32, 16).length > 0) })
})

console.log('THE WIRING (structural: the skill is registered, the guard and the gate are what the visit runs, the prune hold, the fill split)')
const strip = s => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n')
const SK = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
await t('skills.mjs: the order dispatches the pit; the visit digs pitView with pitClearOk and the half\'s clearPart; the waiting state; the prune hold; the fill split', () => {
  assert.equal(SK.split("if (proj.plot === PIT_PLOT) return buildPit(ctx, args, signal)").length, 2)
  const call = SK.slice(SK.indexOf('const r = await runVisit({ dir, key, me, home: root'), SK.indexOf('const dug = Math.max(0, countItem(bot, \'dirt\') - dirt0)'))
  assert.ok(call.length > 100 && call.length < 1200, `the pit's runVisit call (${call.length})`)
  assert.ok(SK.includes("bag => pitBankSteps(bag, want, PIT.keep), 'pit_bank')"), 'the bank clicks pitBankSteps')
  for (const part of ['record: pitView(rec, now0)', 'clearPart: pitClearPart(now0.half)', 'clearOk: (q, rd) => pitClearOk(q, rd)', 'clearMax: cap']) assert.ok(call.includes(part), part)
  assert.match(SK, /if \(p\.plot === PIT_PLOT && !rec\?\.structure_complete && !pitDemandNow\(b, now\)\.dig\) return/)
  assert.match(SK, /if \(pitHoldsDirt\(bot\)\) avail\.dirt = 0/)
  assert.match(SK, /const need = wantCob > 0 \|\| Object\.keys\(extra\)\.length \? needFromTown\(\{ \.\.\.\(wantCob > 0 \? \{ cobblestone: wantCob \} : \{\}\), \.\.\.extra \}/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
