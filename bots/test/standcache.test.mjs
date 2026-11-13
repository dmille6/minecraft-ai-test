// STANDCACHE-01 (LIVE showcase 11-12, the town tidy: 10 to 16 s for every cell no stand reaches, the bot standing still; three in a
// row and the 2-minute visit ended with nothing laid). MEASURED before the fix (a 1,661-segment record over a 100-block walled town,
// the bot's own prismarine block read): one walkFrom a pass of a segment -- one a deferred cell, one a placement -- 329,113 block
// reads and 273 ms each at walkR 72. The visit now keeps ONE walk for the world as it has seen it and makes every obstacle set's
// walk from it (buildsite.mjs walkAgain). Behaviour on the fake server (helpers/buildfake.mjs):
//   1. the counts: N cells no stand reaches cost one walk together, against one each with STANDCACHE off (the positive control)
//   2. the same visit over the same world lays EXACTLY the same cells, in the same order, both ways; walkAgain IS walkFrom
//   3. a world change is seen: a stand a placement makes is found, one it destroys is not used, a silent click that lands late,
//      another bot's block after STAND_MS
//   4. mutants, each anchor present and unique
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
const { B, R, PJ, G, HOME, k3, server, bot, SITE, project, KIT, withMutant } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
// A KILL MEANS AN ASSERTION: the mutant must fail the scenario's own assert (never a crash)
const kills = async (old, neu, scenario) => {
  await scenario(R)
  let why = null
  await withMutant(old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const SITE_PATH = new URL('../src/buildsite.mjs', import.meta.url)
async function withSiteMutant (old, neu, fn) {
  const src = readFileSync(SITE_PATH, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-site-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// THE METER: walkFrom iterates `stood` exactly once a run (its seeds), and reads the world only through the visit's walk read
const meter = () => {
  const m = { walks: 0, reads: 0, stood: [] }
  m.stood[Symbol.iterator] = function * () { m.walks++ }
  m.walkRead = rd => (x, y, z) => { m.reads++; return rd(x, y, z) }
  return m
}
const EARTH = (at, seg) => ({ at, role: 'earth', seg })
const record = segs => ({ v: 1, r: 48, cells: segs.flatMap(s => s.cells.map(at => EARTH(at, s.seg))), segments: segs.map(s => ({ seg: s.seg, deps: s.deps ?? [] })), clear: [], replant: [] })
// a tidy-like visit (the options skills.mjs passes the town tidy), one bot
async function visit (RM, srv, rec, { standCache, m = meter(), extra = {}, opts = {}, botOpts = {}, hook = null, who = 'A' } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'standcache-'))
  const key = PJ.projKey(HOME, 'tidy')
  const gen = PJ.publishRecord(dir, key, () => ({ ...rec })).gen
  const slot = PJ.takeSlot(dir, key, who, 1)
  const e = bot(srv, who, { inv: { dirt: 64, cobblestone: 64 }, feet: [0, G + 1, 0], ...botOpts })
  if (hook) hook(e)
  const r = await RM.runVisit({ dir, key, me: who, home: HOME, stood: m.stood, walkRead: m.walkRead, record: rec, tidy: [], recordGen: gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: 56, clearMax: 4, stuckStalledOnly: true, deferSpent: true, skipOpenDeps: true, intoWater: true, ...extra }, e, { maxSteps: 400, ...(standCache == null ? {} : { standCache }), ...opts })
  return { r, e, m }
}
const rows = e => e.logs.filter(([k]) => k === '_build').map(([, d]) => `${d.op} ${d.seg ?? '-'} ${(d.cell ?? []).join(',')} ${d.block ?? ''} ${d.why ?? ''} ${d.n ?? ''}`.trim())
const worldOf = srv => [...srv.cells].map(([k, n]) => `${k}=${n}`).sort()
const placedCells = e => e.logs.filter(([k, d]) => k === '_build' && d.op === 'place').map(([, d]) => d.cell.join(','))

// THE SCENE OF THE MEASUREMENT, small: `open` 1-deep holes a stand on the rim fills, then `sealed` air pockets 5 under the grass no
// stand reaches (the stuck ones last: grounds2's order), each its own segment, all outside the town circle
const scene = (open, sealed) => {
  const srv = server(), segs = []
  for (let i = 0; i < open; i++) { const at = [24 + 3 * i, G, 20]; srv.set(at, 'air'); segs.push({ seg: `O${i}`, cells: [at] }) }
  for (let i = 0; i < sealed; i++) { const at = [22 + 3 * i, G - 5, 30]; srv.set(at, 'air'); segs.push({ seg: `S${i}`, cells: [at] }) }
  return { srv, rec: record(segs) }
}

console.log('STEP 1, AS ASSERTIONS: the walks a visit makes for N cells no stand reaches')
await t('the switch: STANDCACHE unset is on; off|0|false|no is off; the module default follows the environment', async () => {
  assert.strictEqual(R.standCacheOn({}), true)
  for (const v of ['off', '0', 'false', 'no', 'OFF', ' off ']) assert.strictEqual(R.standCacheOn({ STANDCACHE: v }), false, v)
  for (const v of ['on', '1', '', 'yes']) assert.strictEqual(R.standCacheOn({ STANDCACHE: v }), true, v)
  assert.ok(R.STAND_MS >= 1000 && R.STAND_MS <= 5000, 'a bound of a few seconds')
  // the module's own default, read at import: a second copy imported with the switch off walks once a pass again
  const was = process.env.STANDCACHE
  process.env.STANDCACHE = 'off'
  let Roff
  try { Roff = await import(`${new URL('../src/buildrun.mjs', import.meta.url).href}?standcache-off`) } finally { if (was == null) delete process.env.STANDCACHE; else process.env.STANDCACHE = was }
  const a = scene(1, 4), b = scene(1, 4)
  const on = await visit(R, a.srv, a.rec), off = await visit(Roff, b.srv, b.rec)
  assert.strictEqual(on.m.walks, 2, 'default: one walk for the placement, one for the four deferrals')
  assert.strictEqual(off.m.walks, 5, 'STANDCACHE=off: one a pass')
})
await t('8 cells no stand reaches after 2 placements: 3 walks with the kept walk, 10 without (one a deferred cell); the same rows, the same world', async () => {
  const a = scene(2, 8), b = scene(2, 8)
  const marks = []
  const hook = m => e => { const log = e.log; e.log = (k, d) => { if (k === '_build' && d.op === 'deferred') marks.push([m.walks, m.reads]); log(k, d) } }
  const mOn = meter(), mOff = meter()
  const t0 = performance.now()
  const on = await visit(R, a.srv, a.rec, { standCache: true, m: mOn, hook: hook(mOn) })
  const t1 = performance.now()
  const onMarks = marks.splice(0)
  const off = await visit(R, b.srv, b.rec, { standCache: false, m: mOff, hook: hook(mOff) })
  const t2 = performance.now()
  // THE POSITIVE CONTROL (the cost as it was): a walk for every deferred cell, each a whole town's reads
  assert.strictEqual(off.r.placed, 2); assert.strictEqual(off.r.deferred.length, 8)
  assert.strictEqual(off.m.walks, 10, 'off: 2 placements + 8 deferred cells = 10 walks')
  const perWalk = off.m.reads / off.m.walks
  assert.ok(perWalk > 50_000, `a walk reads the town (${Math.round(perWalk)} block reads)`)
  for (let i = 1; i < marks.length; i++) assert.strictEqual(marks[i][0] - marks[i - 1][0], 1, 'off: one walk between two deferrals')
  // THE KEPT WALK: one walk a world change (2 placements), one more for all eight deferrals -- none after the first
  assert.strictEqual(on.r.placed, 2); assert.strictEqual(on.r.deferred.length, 8)
  assert.strictEqual(on.m.walks, 3, 'on: 2 placements + 1 for the eight deferrals')
  assert.strictEqual(onMarks.length, 8)
  for (let i = 1; i < onMarks.length; i++) { assert.strictEqual(onMarks[i][0], onMarks[0][0], 'on: no walk after the first deferral'); assert.strictEqual(onMarks[i][1], onMarks[0][1], 'on: not one block read by a walk after the first deferral') }
  assert.ok(on.m.reads < off.m.reads * 0.4, `the walk's block reads: ${on.m.reads} against ${off.m.reads}`)
  // ...and nothing else moved
  assert.deepStrictEqual(rows(on.e), rows(off.e))
  assert.deepStrictEqual(on.r.deferred, off.r.deferred)
  assert.strictEqual(on.r.stop, off.r.stop)
  assert.deepStrictEqual(worldOf(a.srv), worldOf(b.srv))
  console.log(`        (walks ${on.m.walks} vs ${off.m.walks}; walk reads ${on.m.reads} vs ${off.m.reads}; ${Math.round(perWalk)} reads a walk; visit ${(t1 - t0).toFixed(0)} ms vs ${(t2 - t1).toFixed(0)} ms on the fake's read)`)
})
await t('a cell no stand was found for is not searched again while the world stands (a click that waits on a body), and is searched again after a placement', async () => {
  // one segment: A a sealed pocket (no stand), B on the grass (a stand). The first click on B finds a body in the cell -> `body`,
  // nothing sent, the same pass again. A's support (the block under the pocket) is read only by A's own stand search.
  const A = [30, G - 5, 20], Bc = [34, G + 1, 20], sup = k3([A[0], A[1] - 1, A[2]])
  const run = async (RM, standCache, feet = null, hook = null) => {
    const srv = server({ [k3(A)]: 'air' })
    let n = 0, bodies = 1
    const read0 = srv.read
    srv.read = (x, y, z) => { if (`${x},${y},${z}` === sup) n++; return read0(x, y, z) }
    const v = await visit(RM, srv, record([{ seg: 'S', cells: [A, Bc] }]), { standCache, hook, botOpts: { others: () => (bodies-- > 0 ? [Bc] : []), ...(feet ? { feet } : {}) } })
    assert.strictEqual(v.r.placed, 1, 'B is laid on the second pass')
    assert.strictEqual(v.r.deferred?.[0]?.k, k3(A))
    return n
  }
  // B's stand, learned from a run (the first walk's target): a bot that already stands there walks nowhere on the body pass
  let standB = null
  await run(R, false, null, e => { const w = e.walkTo; e.walkTo = async (to, o) => { standB ??= to.slice(); return w(to, o) } })
  assert.ok(Array.isArray(standB), 'control: the visit walked to a stand')
  const off = await run(R, false, standB)
  assert.strictEqual(off, 3, 'off: A searched on every pass (body, placed, deferred)')
  const scenario = async RM => assert.strictEqual(await run(RM, true, standB), 2, 'on: not on the pass the world had not moved for; again after the placement')
  // review r1 (Codex): a bot that WALKED to the stand may have changed the world on its way -- the kept walk is dropped, A is searched again
  assert.strictEqual(await run(R, true), 3, 'on, from home: the body pass followed a real walk, so the walk is walked again')
  await kills('const noStandIn = (c, w, nodes) => standCache && noStep.get(standKey(c, w)) === nodes', 'const noStandIn = (c, w, nodes) => standCache && noStep.get(standKey(c, w)) === null', scenario)
})

console.log('THE SAME WALK: walkAgain(graph, ...) is walkFrom(...), key for key and in order (random worlds, random obstacles)')
// rolling ground with fences, slabs (floors), water, plants, leaves and walls; obstacles on, over and under the walk's nodes, round
// home (the seeds) and anywhere; noFloor sets; stood cells; an avoid set
const sameWalk = (M, worlds = 240) => {
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const BOX = { stone: 'block', air: 'empty', water: 'empty', oak_slab: 'block', oak_fence: 'block', short_grass: 'empty', oak_leaves: 'block' }
  const stat = { cases: 0, kept: 0, changed: 0, seeded: 0, plain: 0, old: 0 }
  for (let w = 0; w < worlds; w++) {
    const Rr = ri(18, 30), home = { x: ri(-2, 2), y: G + 1, z: ri(-2, 2) }
    const cells = new Map(), h = new Map()
    for (let x = -Rr - 2; x <= Rr + 2; x++) for (let z = -Rr - 2; z <= Rr + 2; z++) h.set(`${x},${z}`, Math.max(Math.abs(x), Math.abs(z)) <= 3 ? G : G + Math.round(2 * Math.sin(x / (3 + w % 5)) + 2 * Math.cos(z / (4 + w % 3))) + (rnd() < 0.08 ? ri(-3, 3) : 0))
    for (let i = 0; i < Rr * Rr / 2; i++) { const x = ri(-Rr, Rr), z = ri(-Rr, Rr), u = rnd(); cells.set(`${x},${h.get(`${x},${z}`) + 1 + (u < 0.2 ? 1 : 0)},${z}`, u < 0.15 ? 'oak_fence' : u < 0.3 ? 'oak_slab' : u < 0.45 ? 'water' : u < 0.6 ? 'short_grass' : u < 0.8 ? 'stone' : 'oak_leaves') }
    if (w % 3 === 0) for (let x = -Rr; x <= Rr; x++) if (x % 7) for (let y = 1; y <= 4; y++) cells.set(`${x},${h.get(`${x},9`) + y},9`, 'stone')
    const read = (x, y, z) => {
      const hh = h.get(`${x},${z}`); if (hh == null) return null
      const n = cells.get(`${x},${y},${z}`) ?? (y <= hh ? 'stone' : 'air')
      return { name: n, boundingBox: BOX[n], ...(n === 'oak_slab' ? { props: { type: (x + z) % 2 ? 'top' : 'bottom' } } : {}) }
    }
    const floors = w % 2 ? new Set([...cells].filter(([, n]) => n === 'oak_slab').map(([k]) => k)) : null
    const stoodCells = Array.from({ length: ri(0, 6) }, () => { const x = ri(-14, 14), z = ri(-14, 14); return [x, h.get(`${x},${z}`) + 1, z] })
    const avoid = w % 4 === 0 ? new Set(Array.from({ length: 12 }, () => { const x = ri(-Rr, Rr), z = ri(-Rr, Rr); return `${x},${h.get(`${x},${z}`) + 1},${z}` })) : null
    const radius = ri(10, Rr)
    const graph = {}
    const base = M.walkFrom(read, home, new Set(), radius, { stood: stoodCells, floors, avoid, graph })
    assert.deepStrictEqual([...base], [...M.walkFrom(read, home, new Set(), radius, { stood: stoodCells, floors, avoid })], 'the kept walk is the walk')
    const nodes = [...base]
    for (let c = 0; c < 12; c++) {
      const pick = () => {
        const s = new Set()
        for (let i = 0, n = ri(0, 3) === 0 ? ri(8, 40) : ri(1, 5); i < n; i++) {
          const u = rnd()
          let x, y, z
          if (nodes.length && u < 0.6) { [x, y, z] = nodes[ri(0, nodes.length - 1)].split(',').map(Number); y += ri(-2, 3) } else if (u < 0.8) { x = home.x + ri(-3, 3); z = home.z + ri(-3, 3); y = G + ri(-1, 3) } else { x = ri(-Rr, Rr); z = ri(-Rr, Rr); y = h.get(`${x},${z}`) + ri(-2, 3) }
          // every other case: no obstacle inside the town circle (the kept seeds stand; the walk is made from the kept steps alone)
          if (c % 2 && Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) <= B.TOWN_R) continue
          s.add(`${x},${y},${z}`)
        }
        return s
      }
      const block = pick(), noFloor = c % 3 === 0 ? pick() : null
      const want = [...M.walkFrom(read, home, block, radius, { stood: stoodCells, floors, avoid, noFloor })]
      // how it answered: the stood cells' iterator runs once a walkFrom (0: from the kept steps alone; 1: the seeds chosen again; 2: the old way)
      let runs = 0
      const st = stoodCells.slice(); st[Symbol.iterator] = function * () { runs++; yield * Array.prototype[Symbol.iterator].call(stoodCells) }
      const got = M.walkAgain(graph, read, home, block, radius, { stood: st, floors, avoid, noFloor })
      stat.cases++
      if (got === graph.all) stat.kept++
      if (want.length !== base.size) stat.changed++
      if (runs === 1) stat.seeded++
      if (runs === 0 && want.length !== base.size) stat.plain++
      if (runs === 2) stat.old++
      assert.deepStrictEqual([...got], want, `world ${w} case ${c}: block ${[...block].join(' ')} | noFloor ${[...(noFloor ?? [])].join(' ')}`)
    }
  }
  return stat
}
await t('walkAgain equals walkFrom in 2,880 random cases: the obstacles changed the walk in most; the seeds were chosen again in many', async () => {
  const s = sameWalk(B)
  assert.strictEqual(s.cases, 2880)
  // the controls: every path of walkAgain ran
  assert.ok(s.changed > 1500, `the obstacles changed the walk in ${s.changed}`)
  assert.ok(s.kept > 20, `answered as the kept walk itself in ${s.kept}`)
  assert.ok(s.seeded > 300, `the seeds chosen again in ${s.seeded}`)
  assert.ok(s.plain > 300, `made from the kept steps alone, the walk changed, in ${s.plain}`)
  console.log(`        (${s.cases} cases: ${s.changed} changed walks, ${s.kept} the kept walk itself, ${s.plain} changed walks from the kept steps alone, ${s.seeded} re-seeded)`)
})
await t('an obstacle on home\'s own start cell that moves the seed to ANOTHER piece of the town: the walk is made the old way, and is the same', async () => {
  // home stands on a one-cell island (the ring round it is 3 lower); blocked, the next start cell is on the ground beyond the ring
  const read = (x, y, z) => {
    if (Math.max(Math.abs(x), Math.abs(z)) > 30) return null
    const ring = Math.max(Math.abs(x), Math.abs(z)) === 1
    const n = y <= (ring ? G - 3 : G) ? 'stone' : 'air'
    return { name: n, boundingBox: n === 'air' ? 'empty' : 'block' }
  }
  const graph = {}
  const base = B.walkFrom(read, HOME, new Set(), 24, { graph })
  assert.deepStrictEqual([...base], [k3([0, G + 1, 0])], 'the kept walk is the island alone')
  const block = new Set([k3([0, G + 1, 0])])
  let runs = 0
  const st = []; st[Symbol.iterator] = function * () { runs++ }
  const want = B.walkFrom(read, HOME, block, 24)
  assert.ok(want.size > 1000 && !want.has(k3([0, G + 1, 0])), `control: with the island blocked the walk is the ground beyond (${want.size} nodes)`)
  assert.deepStrictEqual([...B.walkAgain(graph, read, HOME, block, 24, { stood: st })], [...want])
  assert.strictEqual(runs, 2, 'the seeds chosen again (one walkFrom), then the whole walk the old way (a second)')
})
await t('mutants of walkAgain: a closed head room ignored; a blocked node kept; an obstacle on the seeds ignored; a no-floor cell ignored -- each fails the random cases', async () => {
  const dies = async (old, neu) => withSiteMutant(old, neu, async M => { let why = null; try { sameWalk(M, 120) } catch (err) { why = err } assert.ok(why instanceof assert.AssertionError, `the mutant survived: ${JSON.stringify(neu.slice(0, 60))} (${why?.message ?? 'no failure'})`) })
  await dies('      if ((dy === 1 && headShut) || (dy === -1 && low.has(m))) continue\n', '')
  await dies('      if (seen.has(m) || dead.has(m)) continue\n', '      if (seen.has(m)) continue\n')
  await dies('  if (inTown) {\n    const g = {}', '  if (false) {\n    const g = {}')
  await dies('  for (const k of noFloor ?? []) take(k, true)\n', '')
})

console.log('THE SAME CELLS, THE KEPT WALK ON AND OFF')
const both = async (name, make, run) => {
  const a = make(), b = make()
  const on = await run(a, true), off = await run(b, false)
  assert.deepStrictEqual(on.rows, off.rows, `${name}: the same rows in the same order`)
  assert.deepStrictEqual(on.stops, off.stops, `${name}: the same stops`)
  assert.deepStrictEqual(worldOf(a.srv), worldOf(b.srv), `${name}: the same world`)
  // (a segment inside the town circle has its seeds chosen again: a walk of the circle alone, counted with the others)
  assert.ok(on.reads <= off.reads * 1.25, `${name}: the walks' block reads (${on.reads} vs ${off.reads})`)
  return { on, off }
}
await t('the workshop with a sealed cell and a segment waiting on it, two visits: the same rows, stops and world', async () => {
  const X = [5, G + 1, 25], Y = [9, G + 1, 25]
  const sealed = () => Object.fromEntries([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d => [k3(X.map((v, i) => v + d[i])), 'bedrock']))
  const REC = { ...SITE.record,
    cells: [{ at: X, role: 'base', seg: 'extra', stand: [X[0] - 1, G + 1, X[2]], support: [X[0], G, X[2]], face: [0, 1, 0], order: -2 }, { at: Y, role: 'base', seg: 'extra2', stand: [Y[0] - 1, G + 1, Y[2]], support: [Y[0], G, Y[2]], face: [0, 1, 0], order: -1 }, ...SITE.record.cells],
    segments: [{ seg: 'extra', deps: [] }, { seg: 'extra2', deps: ['extra'] }, ...SITE.record.segments] }
  const r = await both('workshop', () => ({ srv: server(sealed()), pr: project(REC) }), async (s, standCache) => {
    const out = { rows: [], stops: [], walks: 0, reads: 0 }
    for (let i = 0; i < 2; i++) {
      const m = meter(), h = PJ.recordHead(s.pr.dir, s.pr.key), e = bot(s.srv, 'A', { inv: { ...KIT(), stone_bricks: 91 } })
      const v = await R.runVisit({ ...s.pr.p('A'), stood: m.stood, walkRead: m.walkRead, record: h.head.rec, recordGen: h.head.gen }, e, { maxSteps: 4000, standCache })
      out.rows.push(...rows(e)); out.stops.push([v.stop, v.placed, v.cleared, v.refused]); out.walks += m.walks; out.reads += m.reads
    }
    return out
  })
  assert.strictEqual(r.on.stops[0][1], 167, 'the workshop is built (167 placements)')
  assert.strictEqual(r.on.stops[0][0], 'cell_deferred')
})
await t('the tidy\'s two pits (a cobweb holding one): the same rows, stops and world', async () => {
  const col = (srv, x, z, y0, y1, name) => { for (let y = y0; y <= y1; y++) srv.set([x, y, z], name) }
  const r = await both('pits', () => {
    const srv = server()
    col(srv, 9, 1, G - 2, G, 'air'); col(srv, -12, 0, G - 2, G, 'air')
    const rec = T.tidyRecord(T.surveyTidy(srv.read, { home: HOME }), { home: HOME, T: { ...T.TIDY, segCells: 3 } })
    srv.set([9, G, 1], 'cobweb')
    return { srv, rec }
  }, async (s, standCache) => { const v = await visit(R, s.srv, s.rec, { standCache, extra: { walkR: T.tidyWalkR(s.rec) } }); return { rows: rows(v.e), stops: [[v.r.stop, v.r.placed, v.r.cleared]], walks: v.m.walks, reads: v.m.reads } })
  assert.ok(r.on.rows.some(x => x.startsWith('place ')), 'a pit is filled')
  assert.ok(r.on.rows.some(x => x.startsWith('deferred ')), 'the held one is deferred')
})
await t('a fill the builder stands IN (feetIn: the no-floor walk) with a layer rule, inside the town circle: the same rows, stops and world', async () => {
  // a hollow 4 x 4 and 2 deep, 10 from home (the seeds are chosen again for it), two layers, the upper waiting on the lower
  const cellsAt = y => { const out = []; for (let x = 8; x <= 11; x++) for (let z = 8; z <= 11; z++) out.push([x, y, z]); return out }
  const r = await both('hollow', () => {
    const srv = server()
    for (const y of [G - 1, G]) for (const c of cellsAt(y)) srv.set(c, 'air')
    return { srv, rec: record([{ seg: 'L0', cells: cellsAt(G - 1) }, { seg: 'L1', cells: cellsAt(G), deps: ['L0'] }]) }
  }, async (s, standCache) => { const v = await visit(R, s.srv, s.rec, { standCache, extra: { feetIn: () => true, blockLayer: true } }); return { rows: rows(v.e), stops: [[v.r.stop, v.r.placed]], walks: v.m.walks, reads: v.m.reads } })
  assert.strictEqual(r.on.stops[0][1], 32, 'the hollow is filled')
})
await t('rolling ground, 40 one- and two-cell segments (holes, pockets, floating cells, cells on the seeds): the same rows, stops and world, three worlds', async () => {
  for (const sd of [3, 11, 29]) {
    const make = () => {
      let seed = sd
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
      const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
      const hAt = (x, z) => (Math.max(Math.abs(x), Math.abs(z)) <= 3 ? G : G + Math.round(1.6 * Math.sin((x + sd) / 5) + 1.6 * Math.cos((z - sd) / 6)))
      const cells = new Map(), placedAt = new Map()
      const read = (x, y, z) => {
        if (Math.abs(x) > 60 || Math.abs(z) > 60 || y < G - 20 || y > G + 40) return null
        const n = cells.get(`${x},${y},${z}`) ?? (y < hAt(x, z) ? 'stone' : y === hAt(x, z) ? 'grass_block' : 'air')
        return { name: n, boundingBox: n === 'air' ? 'empty' : 'block' }
      }
      const srv = { read, cells, placedAt, seen: new Map(), set: (a, n) => cells.set(k3(a), n) }
      const segs = [{ seg: 'H0', cells: [[0, G + 1, 0]] }, { seg: 'H1', cells: [[1, G, 1], [1, G + 1, 1]] }]   // on home's own start cell, and beside it
      srv.set([1, G, 1], 'air')
      for (let i = 0; i < 38; i++) {
        const x = ri(-44, 44), z = ri(-44, 44), h = hAt(x, z), kind = ri(0, 4)
        if (segs.some(s => s.cells.some(c => Math.abs(c[0] - x) <= 1 && Math.abs(c[2] - z) <= 1))) continue
        if (kind === 0) { srv.set([x, h, z], 'air'); segs.push({ seg: `s${i}`, cells: [[x, h, z]] }) }                  // a hole
        if (kind === 1) { srv.set([x, h - 5, z], 'air'); segs.push({ seg: `s${i}`, cells: [[x, h - 5, z]] }) }          // a sealed pocket
        if (kind === 2) segs.push({ seg: `s${i}`, cells: [[x, h + 4, z]] })                                             // a floating cell
        if (kind === 3) segs.push({ seg: `s${i}`, cells: [[x, h + 1, z], [x, h + 2, z]] })                              // a pillar of two
        if (kind === 4) { srv.set([x, h, z], 'air'); srv.set([x, h - 1, z], 'air'); srv.set([x, h - 2, z], 'air'); segs.push({ seg: `s${i}`, cells: [[x, h - 2, z], [x, h - 1, z], [x, h, z]] }) }   // a pit of three
      }
      return { srv, rec: record(segs) }
    }
    const r = await both(`hills ${sd}`, make, async (s, standCache) => { const v = await visit(R, s.srv, s.rec, { standCache }); return { rows: rows(v.e), stops: [[v.r.stop, v.r.placed, (v.r.deferred ?? []).length]], walks: v.m.walks, reads: v.m.reads } })
    assert.ok(r.on.stops[0][1] >= 8 && r.on.stops[0][2] >= 4, `world ${sd}: cells laid and cells deferred (${r.on.stops[0]})`)
    assert.ok(r.on.reads < r.off.reads, `world ${sd}: fewer block reads by the walks (${r.on.reads} vs ${r.off.reads})`)
    console.log(`        (world ${sd}: ${r.on.stops[0][1]} laid, ${r.on.stops[0][2]} deferred; walks ${r.on.walks} vs ${r.off.walks}, walk reads ${r.on.reads} vs ${r.off.reads})`)
  }
})

console.log('A WORLD CHANGE IS SEEN')
// A STEP AND A COLUMN: the column's third cell (its support's top face at G + 3) is seen only from ON the step
const STEP = [30, G + 1, 20], C1 = [31, G + 1, 20], C2 = [31, G + 2, 20], C3 = [31, G + 3, 20]
const stepScene = async RM => {
  const srv = server()
  const v = await visit(RM, srv, record([{ seg: 'step', cells: [STEP] }, { seg: 'col', cells: [C1, C2, C3], deps: ['step'] }]), { standCache: true, opts: { standMs: 600_000 } })
  assert.deepStrictEqual(placedCells(v.e), [STEP, C1, C2, C3].map(k3), 'the stand the step made is found: the whole column is laid')
  assert.strictEqual(v.r.stop, 'complete')
}
await t('a stand that only exists AFTER this visit\'s placement is found (control: without the step no stand reaches the third cell)', async () => {
  const srv = server()
  const c = await visit(R, srv, record([{ seg: 'col', cells: [C1, C2, C3] }]), { standCache: false })
  assert.deepStrictEqual(placedCells(c.e), [C1, C2].map(k3), 'control: the third cell has no stand from the ground')
  assert.strictEqual(c.r.deferred?.[0]?.k, k3(C3))
  await stepScene(R)
})
// A STAND A PLACEMENT DESTROYS: stands only in two columns (the domain); Q is laid INTO the only stand of D
const Q = [20, G + 1, 20], D = [24, G + 1, 20]
const destroyScene = async (RM, standCache = true) => {
  const srv = server()
  const v = await visit(RM, srv, record([{ seg: 'q', cells: [Q] }, { seg: 'd', cells: [D] }]), { standCache, opts: { standMs: 600_000 }, extra: { domain: (x, z) => z === 20 && (x === 20 || x === 18) } })
  assert.deepStrictEqual(placedCells(v.e), [k3(Q)], 'D is not laid from a stand that is now inside Q')
  assert.strictEqual(srv.read(...D).name, 'air')
  assert.strictEqual(v.r.deferred?.[0]?.k, k3(D))
}
await t('a stand this visit\'s placement destroyed is not used (control: before Q is laid, D has that stand)', async () => {
  const srv = server()
  const c = await visit(R, srv, record([{ seg: 'd', cells: [D] }]), { standCache: true, extra: { domain: (x, z) => z === 20 && (x === 20 || x === 18) } })
  assert.deepStrictEqual(placedCells(c.e), [k3(D)], 'control: D is laid from 20,20 while that cell is free')
  await destroyScene(R, false)
  await destroyScene(R, true)
})
// A SILENT CLICK THAT LANDS LATE: the step's two clicks are never acknowledged (the segment is deferred, attempts spent); the block
// lands while the visit breathes before the next segment, whose cell is seen only from on the step
const lateScene = async (RM, standCache = true) => {
  const srv = server({ [k3(C1)]: 'dirt', [k3(C2)]: 'dirt' })
  let landed = false
  const hook = e => { e.pause = async () => { if (!landed && e.logs.some(([k, d]) => k === '_build' && d.op === 'deferred' && d.seg === 'step')) { landed = true; srv.set(STEP, 'dirt') } await new Promise(resolve => setImmediate(resolve)) } }
  const v = await visit(RM, srv, record([{ seg: 'step', cells: [STEP] }, { seg: 'col', cells: [C1, C2, C3] }]), { standCache, hook, opts: { standMs: 600_000, breathe: true, breathMs: 0 }, botOpts: { ack: tg => (k3(tg) === k3(STEP) ? 'silent' : 'ok'), capWait: 15 } })
  assert.strictEqual(v.r.silent, 2, 'the step was clicked twice, never acknowledged')
  assert.ok(landed, 'the block landed during the visit')
  assert.deepStrictEqual(placedCells(v.e), [k3(C3)], 'the late block is seen: the cell over the column is laid from on it')
}
await t('a silent click that lands LATER is a world change too (STANDCACHE off agrees)', async () => { await lateScene(R, false); await lateScene(R, true) })
// REVIEW r1 (Codex BLOCKER 2), A WALK THAT CHANGES THE WORLD AND A CLICK THAT THEN SENDS NOTHING: one segment, the column's third
// cell (no stand until the step stands) and B on the grass. The walk to B's stand lays the step (the pathfinder's own scaffold);
// the click on B then finds a body in the cell and sends nothing. The next pass must see the step: the third cell is laid FIRST.
const walkScene = async (RM, standCache = true) => {
  // B hangs on the side of a standing pillar, one layer ABOVE the column's cell: a pass takes its cells lowest first, so the
  // column's cell is searched (and found without a stand) before B is picked
  const Bw = [37, G + 4, 24], pillar = [1, 2, 3, 4].map(dy => [36, G + dy, 24])
  const srv = server({ [k3(C1)]: 'dirt', [k3(C2)]: 'dirt', ...Object.fromEntries(pillar.map(c => [k3(c), 'dirt'])) })
  let walks = 0, bodies = 1
  const hook = e => { const w = e.walkTo; e.walkTo = async (to, o) => { if (walks++ === 0) srv.set(STEP, 'dirt'); return w(to, o) } }
  const v = await visit(RM, srv, record([{ seg: 'S', cells: [C3, Bw] }]), { standCache, hook, opts: { standMs: 600_000 }, botOpts: { others: () => (bodies-- > 0 ? [Bw] : []) } })
  assert.ok(walks >= 2, 'the visit walked')
  assert.deepStrictEqual(placedCells(v.e), [k3(C3), k3(Bw)], 'the step the walk laid is seen on the very next pass: the column\'s cell first, then B')
}
await t('a walk that changed the world is a world change, though its click sent nothing (STANDCACHE off agrees); MUTANT (a walk never drops the kept walk): the third cell waits for B\'s placement', async () => {
  await walkScene(R, false)
  await walkScene(R, true)
  await kills('finally { if (!(same(f0, to) && same(e1.feet(), to))) touched() } } }', 'finally { } } }', RM => walkScene(RM, true))
})
// ANOTHER BOT'S BLOCK: no act of this bot's; only the clock drops the kept walk
const otherScene = async (RM, standMs, standCache = true) => {
  const pocket = [40, G - 5, 30]
  const srv = server({ [k3(pocket)]: 'air', [k3(C1)]: 'dirt', [k3(C2)]: 'dirt' })
  let landed = false
  const hook = e => { e.pause = async () => { if (!landed && e.logs.some(([k, d]) => k === '_build' && d.op === 'deferred' && d.seg === 'pocket')) { landed = true; srv.set(STEP, 'dirt') } await new Promise(resolve => setImmediate(resolve)) } }
  const v = await visit(RM, srv, record([{ seg: 'pocket', cells: [pocket] }, { seg: 'col', cells: [C1, C2, C3] }]), { standCache, hook, opts: { standMs, breathe: true, breathMs: 0 } })
  assert.ok(landed)
  return { v, srv }
}
await t('another bot\'s block is seen once the kept walk is STAND_MS old; inside the bound the cell waits one visit (named), and the next visit lays it', async () => {
  const off = await otherScene(R, 0, false)
  assert.deepStrictEqual(placedCells(off.v.e), [k3(C3)], 'off: every pass walks, the block is seen')
  const old = await otherScene(R, 0)
  assert.deepStrictEqual(placedCells(old.v.e), [k3(C3)], 'a kept walk past its time is walked again: the block is seen')
  // THE BOUND'S COST, NAMED: inside STAND_MS the other bot's block is not seen -- the cell is deferred this visit, laid the next
  const young = await otherScene(R, 600_000)
  assert.deepStrictEqual(placedCells(young.v.e), [], 'inside the bound: not seen')
  assert.ok(young.v.r.deferred.some(d => d.k === k3(C3)))
  const next = await visit(R, young.srv, record([{ seg: 'pocket', cells: [[40, G - 5, 30]] }, { seg: 'col', cells: [C1, C2, C3] }]), { standCache: true })
  assert.deepStrictEqual(placedCells(next.e), [k3(C3)], 'the next visit lays it')
})

// REVIEW r2 (Codex BLOCKER): THE CONNECTION'S WITNESS. A kept walk that only the clock dropped could count a `no stand` for a cell
// another builder had just made reachable (the stuck map: the 6-hour back-off, the tidy's waiver). The bot's own connection is told
// of every block change; the kept walk is dropped the moment one lands in its square.
console.log('THE WORLD THIS CONNECTION WAS TOLD OF (buildbot.mjs installServerBlockWitness seq / moved; buildrun.mjs toldSince)')
const BB = await import('../src/buildbot.mjs')
await t('movedNear: a change after `since` inside the square moved it; outside it did not; history lost is moved; nothing new is not', () => {
  const at = { x: 0, z: 0, r: 50 }
  const blk = (seq, x, z) => [seq, x, z, x, z]
  assert.strictEqual(BB.movedNear([], 0, 0, at), false, 'nothing told')
  assert.strictEqual(BB.movedNear([blk(1, 10, 10)], 1, 1, at), false, 'nothing since')
  assert.strictEqual(BB.movedNear([blk(1, 10, 10)], 1, 0, at), true, 'a block inside')
  assert.strictEqual(BB.movedNear([blk(1, 50, -50)], 1, 0, at), true, 'on the edge')
  assert.strictEqual(BB.movedNear([blk(1, 51, 0)], 1, 0, at), false, 'one outside')
  assert.strictEqual(BB.movedNear([blk(1, 300, 300), blk(2, -200, 9)], 2, 0, at), false, 'all outside')
  assert.strictEqual(BB.movedNear([blk(1, 10, 10), blk(2, 300, 300)], 2, 1, at), false, 'the inside one was before `since`')
  assert.strictEqual(BB.movedNear([[3, 48, 48, 63, 63]], 3, 2, at), true, 'a chunk that overlaps the square')
  assert.strictEqual(BB.movedNear([[3, 64, 64, 79, 79]], 3, 2, at), false, 'a chunk beside it')
  assert.strictEqual(BB.movedNear([[3, -Infinity, -Infinity, Infinity, Infinity]], 3, 2, at), true, 'a chunk whose place was unread: everywhere')
  assert.strictEqual(BB.movedNear([blk(9, 300, 300)], 9, 5, at), true, 'changes 6..8 are no longer kept: unknown is moved')
  assert.strictEqual(BB.movedNear([], 4, 2, at), true, 'told of something, nothing kept')
})
await t('wordMoves: another name, or another state of a name whose states stand differently, is a change; a crop\'s age, a liquid\'s level are not; a leaf\'s state is; a first or unread word is', () => {
  const W = (wasName, wasId, name, id) => BB.wordMoves(wasName == null ? null : { id: wasId, name: wasName }, { id, name })
  assert.strictEqual(W(null, null, 'dirt', 10), true, 'a first word')
  assert.strictEqual(W('air', 0, 'dirt', 10), true)
  assert.strictEqual(W('dirt', 10, 'dirt', 10), false, 'the same state')
  // leaves count (review r4, Codex): a re-roofed record's walk reads a leaf's `persistent` (reroof.mjs reroofNoLeafFloor)
  for (const n of ['oak_slab', 'cobblestone_stairs', 'oak_trapdoor', 'oak_door', 'snow', 'oak_fence_gate', 'composter', 'bamboo', 'oak_leaves', 'cherry_leaves']) assert.strictEqual(W(n, 20, n, 21), true, n)
  for (const n of ['wheat', 'carrots', 'water', 'lava', 'farmland', 'birch_sapling', 'sugar_cane', 'furnace', 'grass_block']) assert.strictEqual(W(n, 20, n, 21), false, n)
  assert.strictEqual(W('wheat', 20, 'air', 0), true, 'harvested')
  assert.strictEqual(BB.wordMoves({ id: 1, name: 'dirt' }, { id: 99, name: null }), true, 'a state the registry cannot name')
  assert.strictEqual(BB.wordMoves({ id: 1, name: null }, { id: 1, name: 'dirt' }), true)
})
await t('the witness counts what the connection is told: a block under another name (a first word counts; the same name again does not), a chunk loaded or unloaded; it keeps the last WITNESS_KEPT', () => {
  const handlers = []
  const client = { on: (ev, fn) => { if (ev === 'packet') handlers.push(fn) }, off: () => {} }
  const names = { 1: 'dirt', 2: 'wheat', 3: 'wheat', 4: 'air', 5: 'oak_slab', 6: 'oak_slab' }
  const w = BB.installServerBlockWitness({ _client: client, registry: { blocksByStateId: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { name }])) } })
  const send = (name, data) => { for (const h of handlers) h(data, { name }) }
  const at = { x: 0, z: 0, r: 50 }
  assert.strictEqual(handlers.length, 1, 'control: the witness listens')
  assert.deepStrictEqual([w.seq(), w.moved(0, at)], [0, false])
  send('block_change', { location: { x: 5, y: 70, z: 5 }, type: 2 })
  assert.deepStrictEqual([w.seq(), w.moved(0, at)], [1, true], 'a first word on a cell')
  send('block_change', { location: { x: 5, y: 70, z: 5 }, type: 3 })
  assert.strictEqual(w.seq(), 1, 'the crop grew: the same name, nothing moved')
  send('block_change', { location: { x: 5, y: 70, z: 5 }, type: 4 })
  assert.strictEqual(w.seq(), 2, 'harvested: another name')
  send('block_change', { location: { x: 400, y: 70, z: 5 }, type: 1 })
  assert.deepStrictEqual([w.seq(), w.moved(2, at)], [3, false], 'far away: counted, not in the square')
  send('map_chunk', { x: 0, z: 0 })
  assert.deepStrictEqual([w.seq(), w.moved(3, at)], [4, true], 'a chunk loaded over the town')
  send('unload_chunk', { chunkX: 40, chunkZ: 40 })
  assert.deepStrictEqual([w.seq(), w.moved(4, at)], [5, false], 'a chunk far away let go')
  send('keep_alive', { keepAliveId: 1 })
  assert.strictEqual(w.seq(), 5, 'another packet is nothing')
  // the same NAME, another state: a slab made double is another floor (counted); told the same state twice is nothing
  send('block_change', { location: { x: 7, y: 70, z: 7 }, type: 5 })
  send('block_change', { location: { x: 7, y: 70, z: 7 }, type: 5 })
  assert.strictEqual(w.seq(), 6, 'the slab laid (a first word), then the same word again')
  send('block_change', { location: { x: 7, y: 70, z: 7 }, type: 6 })
  assert.deepStrictEqual([w.seq(), w.moved(6, at)], [7, true], 'the slab made double: the same name, a state a walk reads')
  w.watch([7, 70, 7])
  send('block_change', { location: { x: 7, y: 70, z: 7 }, type: 6 })
  assert.strictEqual(w.seq(), 7, 'a watched cell told the same state: the waiters\' forgetting is not a change')
  // review r3 (Codex): a chunk sent again may hold another block than the witness last heard -- after it, a word that only
  // repeats the old one is a change (CONTROL just above: without a chunk in between the same word is nothing)
  send('map_chunk', { x: 0, z: 0 })
  const s0 = w.seq()
  send('block_change', { location: { x: 7, y: 70, z: 7 }, type: 6 })
  assert.deepStrictEqual([w.seq(), w.moved(s0, at)], [s0 + 1, true], 'the same word after the chunk was sent again: counted')
  send('unload_chunk', { chunkX: 40, chunkZ: 40 })
  const s1 = w.seq()
  send('block_change', { location: { x: 7, y: 70, z: 7 }, type: 6 })
  assert.strictEqual(w.seq(), s1 + 1, 'and after a chunk was let go')
  for (let i = 0; i < BB.WITNESS_KEPT + 5; i++) send('block_change', { location: { x: 1000 + i, y: 70, z: 900 }, type: 1 })
  assert.strictEqual(w.moved(5, at), true, 'more told than kept since then: moved')
  assert.strictEqual(w.moved(w.seq() - 3, at), false, 'the last few are kept, and far')
})
// ANOTHER BOT'S BLOCK, TOLD: the same scene as the clock's (otherScene), the kept walk never expiring -- the witness alone drops it
const toldScene = async (RM, { told = true } = {}) => {
  const pocket = [40, G - 5, 30]
  const srv = server({ [k3(pocket)]: 'air', [k3(C1)]: 'dirt', [k3(C2)]: 'dirt' })
  let landed = false, seq = 0, asked = 0
  const hook = e => {
    e.pause = async () => { if (!landed && e.logs.some(([k, d]) => k === '_build' && d.op === 'deferred' && d.seg === 'pocket')) { landed = true; srv.set(STEP, 'dirt'); if (told) seq++ } await new Promise(resolve => setImmediate(resolve)) }
    e.worldSeq = () => seq
    e.worldMoved = (since, at) => { asked++; assert.deepStrictEqual([at.x, at.z, at.r], [HOME.x, HOME.z, 56 + 2], 'the walk\'s own square'); return seq > since }
  }
  const v = await visit(RM, srv, record([{ seg: 'pocket', cells: [pocket] }, { seg: 'col', cells: [C1, C2, C3] }]), { standCache: true, hook, opts: { standMs: 600_000, breathe: true, breathMs: 0 } })
  assert.ok(landed, 'the block landed')
  return Object.assign(v, { asked })
}
await t('another bot\'s block the connection was TOLD of is seen at once, with no clock (CONTROL: not told, inside the bound, the cell waits)', async () => {
  const c = await toldScene(R, { told: false })
  assert.deepStrictEqual(placedCells(c.e), [], 'control: a change the connection never heard of is not seen inside the bound')
  assert.ok(c.asked > 0, 'control: the witness was asked')
  const v = await toldScene(R)
  assert.deepStrictEqual(placedCells(v.e), [k3(C3)], 'told: the kept walk is dropped and the cell is laid in the SAME visit')
  assert.ok(!(v.r.deferred ?? []).some(d => d.k === k3(C3)), 'and never counted as a cell no stand reaches')
})
await t('a witness that throws is a world that moved (the walk is made again); MUTANT (the witness never asked): the told block is not seen', async () => {
  const m = meter()
  const hook = e => { e.worldSeq = () => 1; e.worldMoved = () => { throw new Error('gone') } }
  const on = scene(1, 4), ctl = scene(1, 4)
  const v = await visit(R, on.srv, on.rec, { standCache: true, m, hook })
  const off = await visit(R, ctl.srv, ctl.rec, { standCache: false })
  assert.ok(off.m.walks >= 5, `control: with the kept walk off the visit walks every pass (${off.m.walks})`)
  assert.strictEqual(m.walks, off.m.walks, 'every pass walks again, as with the kept walk off')
  assert.deepStrictEqual(rows(v.e), rows(off.e))
  // the mutant must die on the PLACEMENT (Codex r3: any other assertion is the wrong reason)
  const told = async RM => { const o = await toldScene(RM); assert.deepStrictEqual(placedCells(o.e), [k3(C3)], 'TOLD-SEEN: the told block is seen in the same visit') }
  await told(R)
  let why = null
  await withMutant('!(wallNow() - walkMem.at < standMs) || toldSince(walkMem.seq)) {', '!(wallNow() - walkMem.at < standMs)) {', async M => { try { await told(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError && /TOLD-SEEN/.test(String(why.message)), `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
})

console.log('MUTANTS (each anchor present and unique; each dies on an assertion of a scene above)')
await t('never invalidating (the world counter not compared): the stand a placement made is not found; the stand it destroyed is used', async () => {
  await kills('walkMem.gen !== worldGen || ', '', stepScene)
  await kills('walkMem.gen !== worldGen || ', '', RM => destroyScene(RM, true))
})
await t('a send that does not count as a world change: the same two scenes fail', async () => {
  await kills('const touched = (cell = null) => { worldGen++; if (cell && standCache) sentAt.set(kOf(cell), nm(e.read(...cell))) }', 'const touched = () => {}', stepScene)
  await kills('const touched = (cell = null) => { worldGen++; if (cell && standCache) sentAt.set(kOf(cell), nm(e.read(...cell))) }', 'const touched = () => {}', RM => destroyScene(RM, true))
})
await t('the obstacle set ignored in the key (every segment answered with the walk that has no obstacles): a cell is laid from a stand IN its segment\'s other open cell', async () => {
  // two holes side by side, one segment; stands only in their two columns: with the open cells as obstacles neither has a stand
  const P1 = [20, G, 20], P2 = [21, G, 20]
  const scenario = async RM => {
    const run = async standCache => { const srv = server({ [k3(P1)]: 'air', [k3(P2)]: 'air' }); const v = await visit(RM, srv, record([{ seg: 'pit', cells: [P1, P2] }]), { standCache, extra: { domain: (x, z) => z === 20 && (x === 20 || x === 21) } }); return { placed: v.r.placed, deferred: (v.r.deferred ?? []).map(d => d.k).sort() } }
    const off = await run(false), on = await run(true)
    assert.deepStrictEqual(off, { placed: 0, deferred: [k3(P1), k3(P2)] }, 'off: an open cell is no stand')
    assert.deepStrictEqual(on, off, 'on: the same')
  }
  await kills('const sig = `${sigOf(block)}|${sigOf(noFloor)}`', "const sig = '|'", scenario)
})
await t('never expiring: another bot\'s block is not seen after the kept walk\'s time', async () => {
  await kills('|| !(wallNow() - walkMem.at < standMs) || toldSince(walkMem.seq)) {', '|| toldSince(walkMem.seq)) {', async RM => { const o = await otherScene(RM, 0); assert.deepStrictEqual(placedCells(o.v.e), [k3(C3)], 'past its time the walk is walked again') })
})
await t('a silent click\'s late landing ignored: the cell over the column is not laid', async () => {
  await kills("!== was) { sentAt.delete(k); worldGen++ }", "!== was) { sentAt.delete(k) }", RM => lateScene(RM, true))
})
await t('an unknown cell made known without the walk moving: (structural) the visit compares the unknown set\'s size with the kept walk\'s', async () => {
  // behaviour cannot reach it from the fakes without a server that never answers a dig and then does; the wiring is asserted
  const src = readFileSync(new URL('../src/buildrun.mjs', import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.strictEqual(src.split('walkMem.unknown !== unknown.size').length, 2)
  // tempstand-01: an eighth -- the dig under the builder's own feet when a temporary stand comes down (buildrun.mjs standDown)
  assert.strictEqual(src.split('touched(').length - 1, 8, 'a call after each of the three sends, the three digs and the probe, and one after a walk (review r1)')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
