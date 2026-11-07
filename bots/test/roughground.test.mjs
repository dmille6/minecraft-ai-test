// ROUGHGROUND-01 (owner 11-07, three circled renders: "will the greens keeper fill these areas in and smooth them out?"): the ground
// the inside-the-wall rules miss. Behaviour on buildfake's flat world (stone below G, grass at G, readable to +-60) through the stage
// itself (tidy.mjs siteStage 'inwall' and a band), with ROUGH=off as the control (the stage as it was).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const LP = await import('../src/landplan.mjs')
const RG = await import('../src/roughground.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const RG_PATH = new URL('../src/roughground.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const ON = { ROUGH: 'on' }, OFF = { ROUGH: 'off' }
const INWALL = LP.landStages().find(q => q.id === 'inwall')
const WALL = { ring: [-30, -30, 30, 30] }   // interior [-29, -29, 29, 29]
const site = (srv, { env = ON, avoid = () => null, cells = new Set(), records = [], climbs = [], stage = INWALL } = {}) =>
  T.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage, env, avoid, cells, terrace: { wall: WALL, records, climbs } })
const cutAt = r => (r?.cut ?? []).map(c => c.at.join(',')).sort()
const fillAt = r => (r?.cells ?? []).map(c => c.at.join(',')).sort()
const xyz = (...a) => a.join(',')
// a survey straight on the pure module (no stage), with the tidy's column and SPOIL
const rough = (srv, o = {}) => {
  const col = (x, z) => T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 })
  return RG.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col, spoil: T.SPOIL, buildWhy: /^(project|plan_cell|plan_box|plan_plot)$|^project:/, yLo: HOME.y - 14, ...o })
}

console.log('FLOATING: the bots\' spoil left in the air')
await t('a 3-block dirt beam 4 over the grass (air under it) is cut; the inwall rules alone read it natural and never cut it', async () => {
  const srv = server()
  for (const x of [5, 6, 7]) srv.set([x, G + 4, 3], 'dirt')
  const r = site(srv)
  assert.deepStrictEqual(cutAt(r.record), [xyz(5, G + 4, 3), xyz(6, G + 4, 3), xyz(7, G + 4, 3)])
  assert.strictEqual(r.record.inwall.rough.census.floating, 3)
  const off = site(srv, { env: OFF })
  assert.strictEqual(off.record, null, 'control: the stage before cuts none of it')
  // the mutant: a run is floating without ending on an open cell -> the beam reads attached and stays
  await withMutant(RG_PATH, "      if (openCell(b)) break\n      if (!spoil.test(nm(b))) return { segs, ground: y, why: run.length ? 'attached' : null }", "      if (!spoil.test(nm(b))) return { segs, ground: y, why: run.length ? 'attached' : null }", async M => {
    const col = (x, z) => T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 })
    const m = M.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col, spoil: T.SPOIL, yLo: HOME.y - 14 })
    assert.strictEqual(m.census.floating, 0, 'mutant keeps the beam')
  })
})
await t('a block in a spruce\'s leaves is cut (leaves under it are open); one higher than floatReach over the ground is named float_high', async () => {
  const srv = server()
  srv.set([4, G + 3, -4], 'oak_leaves'); srv.set([4, G + 4, -4], 'dirt')     // in the canopy
  srv.set([-6, G + 9, 6], 'dirt')                                           // 9 up: out of a ground stand's reach
  const r = site(srv)
  assert.deepStrictEqual(cutAt(r.record), [xyz(4, G + 4, -4)])
  assert.strictEqual(r.record.inwall.rough.census.float_high, 1)
})
await t('a spoil run ending on a log is attached (kept); a floating block that is a record cell is kept', async () => {
  const srv = server()
  srv.set([8, G + 1, 8], 'oak_log'); srv.set([8, G + 2, 8], 'oak_log'); srv.set([8, G + 3, 8], 'dirt')
  srv.set([-8, G + 4, -8], 'dirt')
  const r = rough(srv, { cells: new Set([xyz(-8, G + 4, -8)]) })
  assert.deepStrictEqual(r.cut, [])
  assert.ok(r.skipped.float_attached >= 1 || r.skipped.float_build >= 1)
})

console.log('CLUMPS AND HOLES')
await t('a 2-column dirt bump 1 high is cut to the ground; the inwall rules alone take neither column (neither is above all 8)', async () => {
  const srv = server()
  srv.set([3, G + 1, 0], 'dirt'); srv.set([4, G + 1, 0], 'dirt')
  const r = site(srv)
  assert.deepStrictEqual(cutAt(r.record), [xyz(3, G + 1, 0), xyz(4, G + 1, 0)])
  assert.strictEqual(site(srv, { env: OFF }).record, null, 'control')
})
await t('a clump under leaves is cut (the canopy does not matter); a clump with a trunk standing on it is kept', async () => {
  const srv = server()
  srv.set([10, G + 1, 10], 'dirt'); srv.set([10, G + 1, 11], 'dirt'); srv.set([10, G + 5, 10], 'oak_leaves'); srv.set([10, G + 5, 11], 'oak_leaves')
  srv.set([-10, G + 1, -10], 'dirt'); srv.set([-10, G + 1, -11], 'dirt'); srv.set([-10, G + 2, -10], 'oak_log'); srv.set([-10, G + 3, -10], 'oak_log')
  const r = rough(srv)
  assert.deepStrictEqual(r.cut.map(c => c.at.join(',')).sort(), [xyz(10, G + 1, 10), xyz(10, G + 1, 11)])
  assert.ok(r.skipped.clump_tree >= 1 || r.skipped.smooth_tree_or_tall >= 1, JSON.stringify(r.skipped))
})
await t('a 2x1 hole 1 deep is filled to the ground; water in its rim keeps it', async () => {
  const srv = server()
  srv.set([-5, G, 5], 'air'); srv.set([-4, G, 5], 'air')
  const r = site(srv)
  assert.deepStrictEqual(fillAt(r.record), [xyz(-5, G, 5), xyz(-4, G, 5)].sort())
  assert.strictEqual(site(srv, { env: OFF }).record, null, 'control: not below all 8')
  srv.set([-6, G, 5], 'water')
  const w = rough(srv)
  assert.deepStrictEqual(w.fill.filter(f => f.at[2] === 5), [], 'water in the rim')
})
await t('1b: a raised crust over a hollow is cut WITH the hollow filled under it, the cut carrying the hollow (dug only while nobody is in it); deeper than fillMax it is left', async () => {
  const srv = server()
  srv.set([12, G + 1, -3], 'grass_block'); srv.set([12, G, -3], 'air'); srv.set([12, G - 1, -3], 'air')
  const r = rough(srv)
  assert.deepStrictEqual(r.cut.map(c => c.at.join(',')), [xyz(12, G + 1, -3)])
  assert.deepStrictEqual(r.fill.map(c => c.at.join(',')).sort(), [xyz(12, G - 1, -3), xyz(12, G, -3)].sort())
  assert.deepStrictEqual(r.cut[0].hollow, [[12, G - 1, -3], [12, G, -3]])
  assert.strictEqual(r.census.hollows, 1)
  // through the stage: the record's cut keeps its hollow, the fills are layered bottom-up after it
  const st = site(srv)
  const c = st.record.cut.find(q => q.at.join(',') === xyz(12, G + 1, -3))
  assert.deepStrictEqual(c.hollow, [[12, G - 1, -3], [12, G, -3]])
  const segOf = at => st.record.cells.find(q => q.at.join(',') === at.join(',')).seg
  assert.ok(st.record.segments.find(q => q.seg === segOf([12, G, -3])).deps.includes(segOf([12, G - 1, -3])), 'bottom-up')
  // the dig-time guard: a body in the hollow holds the cut; none -> clear; a cut with no hollow is never held here
  assert.strictEqual(RG.hollowClear(c, at => at[1] === G - 1), false)
  assert.strictEqual(RG.hollowClear(c, () => false), true)
  assert.strictEqual(RG.hollowClear({ at: [0, G, 0] }, () => true), true)
  // the mutant: no under-fill -> the crust is left (the 80cf5d5c rule), the hollow never closed
  await withMutant(RG_PATH, "          const u = underFill(x, rimMax, z)\n", "          const u = null\n", async M => {
    const col = (x, z) => T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 })
    const m = M.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col, spoil: T.SPOIL, yLo: HOME.y - 14 })
    assert.strictEqual(m.fill.length, 0, 'mutant leaves the hollow')
  })
  // the mutant: the guard ignores the hollow -> a body in it does not hold the cut
  await withMutant(RG_PATH, "export const hollowClear = (cut, bodyAt = () => false) => !(Array.isArray(cut?.hollow) && cut.hollow.some(c => Array.isArray(c) && bodyAt(c)))", 'export const hollowClear = () => true', async M => {
    assert.strictEqual(M.hollowClear(c, () => true), true, 'mutant digs over a body')
  })
  const deep = server()
  deep.set([12, G + 1, -3], 'grass_block'); for (let y = G; y >= G - 6; y--) deep.set([12, y, -3], 'air')
  const d = rough(deep)
  assert.deepStrictEqual(d.cut, [], 'a hollow deeper than fillMax: the crust stays')
  assert.ok(d.skipped.clump_hollow >= 1)
})
await t('1b wiring: the tidy visit\'s cut check holds a crust cut while a body is in its hollow', async () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/tidyOk: \(q, rd\) => cutSafeNow\(rd, q\.at, tidyWater\(\)\) && !otherBodyOnCell\(bot, q\.at\) && hollowClear\(q, c => otherBodyOnCell\(bot, c\)\)/.test(sk))
  const td = strip(readFileSync(new URL('../src/tidy.mjs', import.meta.url), 'utf8'))
  assert.ok(/\.\.\.\(c\.hollow \? \{ hollow: c\.hollow \} : \{\}\)/.test(td), 'tidyRecord keeps the hollow')
})

console.log('STATIONS')
await t('a loose crafting table on a 2-dirt pillar is cut with its pillar; a record-cell table and a plan cell are kept', async () => {
  const srv = server()
  srv.set([2, G + 1, -6], 'dirt'); srv.set([2, G + 2, -6], 'dirt'); srv.set([2, G + 3, -6], 'crafting_table')
  srv.set([-2, G + 1, -6], 'crafting_table')
  srv.set([6, G + 1, -6], 'crafting_table')
  const avoid = (x, z) => (x === 6 && z === -6 ? 'plan_cell' : null)
  const r = site(srv, { avoid, cells: new Set([xyz(-2, G + 1, -6)]) })
  assert.deepStrictEqual(cutAt(r.record), [xyz(2, G + 1, -6), xyz(2, G + 2, -6), xyz(2, G + 3, -6)])
  assert.strictEqual(r.record.cut.find(c => c.at[1] === G + 3).name, 'crafting_table')
  // the mutant: the plan's own cells read as a build's box -> the plan's table is cut
  await withMutant(RG_PATH, "if (w === 'plan_cell' || w === 'plan_box') return 'plan'", '', async M => {
    const col = (x, z) => T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 })
    const m = M.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col, spoil: T.SPOIL, buildWhy: /^(project|plan_cell|plan_box|plan_plot)$|^project:/, avoid, cells: new Set([xyz(-2, G + 1, -6)]), yLo: HOME.y - 14 })
    assert.ok(m.cut.some(c => c.at[0] === 6), 'mutant cuts the plan\'s table')
  })
  // the control: the inwall rules never touch a furniture column
  assert.strictEqual(site(srv, { env: OFF, avoid, cells: new Set([xyz(-2, G + 1, -6)]) }).record, null)
})

console.log('SCAFFOLD: the bots\' ledgered climbs, taken back')
await t('a ledgered step still standing above the ground is cut even beside a standing build; at ground level (it fills a hole now) it stays', async () => {
  const srv = server(); const cells = new Set()
  for (let z = -4; z <= 4; z++) for (let y = G + 1; y <= G + 4; y++) { srv.set([-15, y, z], 'stone_bricks'); cells.add(xyz(-15, y, z)) }
  srv.set([-14, G + 1, 0], 'dirt'); srv.set([-14, G + 2, 0], 'dirt')           // a climb against the wall, ledgered
  srv.set([-13, G, 3], 'dirt')                                                    // a step that filled a hole, ledgered
  const records = [{ plot: 'house', cells: [...cells].map(k => ({ at: k.split(',').map(Number) })) }]
  const avoid = (x, z) => (x >= -16 && x <= -14 && z >= -5 && z <= 5 ? 'project:house' : null)
  const climbs = [{ x: -14, y: G + 1, z: 0, shape: 'pillar' }, { x: -14, y: G + 2, z: 0, shape: 'pillar' }, { x: -13, y: G, z: 3, shape: 'step' }]
  const col = (x, z) => T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 })
  const r = RG.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col, spoil: T.SPOIL, buildWhy: /^project:/, avoid, cells, climbs, yLo: HOME.y - 14 })
  assert.deepStrictEqual(r.cut.map(c => c.at.join(',')).sort(), [xyz(-14, G + 1, 0), xyz(-14, G + 2, 0)])
  assert.strictEqual(r.census.scaffold, 1)
  // without the ledger the same climb is beside a standing build's footprint: never the rough survey's (inwall's own `beside` rule is)
  const r0 = RG.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col, spoil: T.SPOIL, buildWhy: /^project:/, avoid, cells, climbs: [], yLo: HOME.y - 14 })
  assert.deepStrictEqual(r0.cut, [])
})

console.log('NEVER')
await t('never a record cell\'s column, a guarded zone, the yard; a STANDING build\'s ring keeps a clump, a path\'s (flat) ring does not', async () => {
  const srv = server(); const cells = new Set()
  srv.set([0, G + 1, 15], 'dirt'); srv.set([1, G + 1, 15], 'dirt')              // guarded zone
  srv.set([15, G + 1, 0], 'dirt'); srv.set([15, G + 1, 1], 'dirt')              // beside a wall cell at 16,G+1,0
  srv.set([16, G + 1, 0], 'cobblestone'); cells.add(xyz(16, G + 1, 0))
  srv.set([-15, G + 1, 10], 'dirt'); srv.set([-15, G + 1, 11], 'dirt')          // beside a path cell at -16,G,10
  cells.add(xyz(-16, G, 10))
  const records = [{ plot: 'wall', cells: [{ at: [16, G + 1, 0] }] }, { plot: 'paths', cells: [{ at: [-16, G, 10] }] }]
  const avoid = (x, z) => (z === 15 && x >= -1 && x <= 2 ? 'zone' : null)
  const r = site(srv, { avoid, cells, records })
  assert.deepStrictEqual(cutAt(r.record), [xyz(-15, G + 1, 10), xyz(-15, G + 1, 11)])
  // the mutant: no build ring -> the clump against the wall is cut too
  await withMutant(RG_PATH, 'if (nearCols.has(k2(x + dx, z + dz))) return true', 'if (false) return true', async M => {
    const col = (x, z) => T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 })
    const m = M.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col, spoil: T.SPOIL, buildWhy: /^project:/, avoid, cells, nearCells: RG.nearCellsOf(records), yLo: HOME.y - 14 })
    assert.ok(m.cut.some(c => c.at[0] === 15), 'mutant cuts beside the wall')
  })
})
await t('a hill (a raised plateau wider than a clump) and a terrace step are never taken', async () => {
  const srv = server()
  for (let x = -12; x <= -4; x++) for (let z = -12; z <= -4; z++) srv.set([x, G + 1, z], 'grass_block')   // a 9x9 hill, 1 high
  for (let x = 4; x <= 18; x++) for (let z = 8; z <= 18; z++) srv.set([x, G + 1, z], 'dirt')              // a terrace (wide step)
  const r = rough(srv)
  assert.deepStrictEqual(r.cut, [], JSON.stringify(r.cut.slice(0, 4)))
})
await t('idempotent: the record laid (tidyOverlay), a re-survey finds nothing more (no cut/fill oscillation)', async () => {
  const srv = server()
  for (const x of [5, 6, 7]) srv.set([x, G + 4, 3], 'dirt')
  srv.set([3, G + 1, 0], 'dirt'); srv.set([4, G + 1, 0], 'dirt'); srv.set([-5, G, 5], 'air'); srv.set([-4, G, 5], 'air')
  srv.set([2, G + 1, -6], 'dirt'); srv.set([2, G + 2, -6], 'crafting_table')
  const r = site(srv)
  assert.ok(r.record.cut.length >= 6 && r.record.cells.length === 2)
  const after = T.tidyOverlay(srv.read, r.record)
  const r2 = T.siteStage(after, { home: HOME, land: { seed: 1 }, stage: INWALL, env: ON, terrace: { wall: WALL, records: [] } })
  assert.strictEqual(r2.record, null, JSON.stringify({ cut: r2.record?.cut?.slice(0, 3), cells: r2.record?.cells?.slice(0, 3) }))
})
await t('a BAND outside the wall takes the same rough ground over its own columns only', async () => {
  const srv = server()
  const SMALL = Object.freeze({ ...LP.LAND, workR: 44, rimR: 20, rimStep: 12, legPops: 60_000 })
  const band = LP.landStages(SMALL).find(q => q.id === 'rim32')
  srv.set([26, G + 4, 0], 'dirt')                       // floating, in the band (20, 32]
  srv.set([26, G + 1, 10], 'dirt'); srv.set([27, G + 1, 10], 'dirt')   // a clump in the band
  srv.set([5, G + 4, 0], 'dirt')                        // inside the wall: never the band's
  const land = { home: HOME, roads: [], corridors: [], zones: {}, ringR: 15, workR: 44, inner: 6, seed: 1 }
  const r = T.siteStage(srv.read, { home: HOME, land, stage: band, env: ON, L: SMALL, terrace: { wall: { ring: [-12, -12, 12, 12] }, records: [] } })
  assert.deepStrictEqual(cutAt(r.record), [xyz(26, G + 1, 10), xyz(26, G + 4, 0), xyz(27, G + 1, 10)])
  assert.ok(r.record.band.rough.census.floating === 1)
})

console.log('THE INSIDE-THE-WALL CLOCK (the stale 11-05 record)')
await t('inwallFirst: a band after the inside, last surveyed an hour ago or more (or never) -> the inside first; ROUGH=off, a stage before it, or fresh -> no', async () => {
  const now = 10 * 3_600_000, inK = INWALL.k
  assert.strictEqual(RG.inwallFirst({ rec: { stageId: 'inwall', sitedAt: now - 40 * 3_600_000 }, nextK: inK + 1, inwallK: inK, now, env: ON }), true)
  assert.strictEqual(RG.inwallFirst({ rec: { stageId: 'rim48', inwallAt: now - 30 * 60_000 }, nextK: inK + 2, inwallK: inK, now, env: ON }), false, 'surveyed 30 min ago')
  assert.strictEqual(RG.inwallFirst({ rec: { stageId: 'rim48' }, nextK: inK + 2, inwallK: inK, now, env: ON }), true, 'never by this clock')
  assert.strictEqual(RG.inwallFirst({ rec: { stageId: 'inwall', sitedAt: 0 }, nextK: inK + 1, inwallK: inK, now, env: OFF }), false)
  assert.strictEqual(RG.inwallFirst({ rec: { stageId: 'terrace', sitedAt: 0 }, nextK: inK, inwallK: inK, now, env: ON }), false, 'the wrap sites the inside itself')
  assert.deepStrictEqual(RG.stageTryOrder(5, 6, true, 3), [3, 5, 6])
  assert.deepStrictEqual(RG.stageTryOrder(5, 6, false, 3), [5, 6])
  // the clock rides on: the inwall siting's own time, else the time carried
  assert.strictEqual(RG.inwallAtNext({ stageId: 'inwall', sitedAt: 7 }, { stageId: 'rim48', sitedAt: 9 }), 7)
  assert.strictEqual(RG.inwallAtNext({ stageId: 'rim48', inwallAt: 5 }, { stageId: 'rim64', sitedAt: 9 }), 5)
  assert.strictEqual(RG.inwallAtNext({ stageId: 'rim80', inwallAt: 5 }, { stageId: 'inwall', sitedAt: 9 }), 9)
})
await t('the composed chain: a complete 40-h-old inwall record -> the keeper\'s next siting is the inside again (fresh work), then the bands once it is clean', async () => {
  const srv = server()
  srv.set([3, G + 1, 0], 'dirt'); srv.set([4, G + 1, 0], 'dirt')
  const now = 100 * 3_600_000, inK = INWALL.k
  const old = { stageId: 'inwall', sitedAt: now - 40 * 3_600_000, structure_complete: true }
  const nextK = LP.nextStageCycle({ ...old, stage: 1, terraceV: 1, completeAt: now - 3_600_000 }, now).k
  assert.ok(nextK > inK, 'the ring order alone moves on to a band')
  const order = RG.stageTryOrder(nextK, nextK, RG.inwallFirst({ rec: old, nextK, inwallK: inK, now, env: ON }), inK)
  assert.strictEqual(order[0], inK, 'the inside first')
  const s1 = site(srv)
  assert.ok(s1.record, 'and the inside has fresh work: sited there')
  // once laid, the inside reads nothing and the band comes next in the same order
  const after = T.tidyOverlay(srv.read, s1.record)
  const s2 = T.siteStage(after, { home: HOME, land: { seed: 1 }, stage: INWALL, env: ON, terrace: { wall: WALL, records: [] } })
  assert.strictEqual(s2.record, null)
  assert.strictEqual(order[1], nextK)
})
await t('the wiring: buildTidy tries the inside first, restarts the clock on an empty inside, carries it on every record; 7 days of climbs are read', async () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/firstIn = !!gkNext && inwallFirst\(\{ rec: rh\.head\?\.rec, nextK: k0, inwallK: inK \}\)/.test(sk), 'the clock read')
  assert.ok(/for \(const k of stageTryOrder\(k0, last, firstIn, inK\)\) \{/.test(sk), 'the order')
  assert.ok(/if \(firstIn && k === inK && s\.ok && !s\.record\) inChecked = Date\.now\(\)/.test(sk), 'an empty inside restarts the clock')
  assert.ok(/inwallAt: inChecked \?\? inwallAtNext\(cur, body\)/.test(sk), 'the clock carried')
  assert.ok(/\(firstIn && landStages\(\)\.find\(q => q\.k === sk\)\?\.id === 'inwall'\)/.test(sk), 'the inside may replace a later stage\'s head')
  const td = strip(readFileSync(new URL('../src/tidy.mjs', import.meta.url), 'utf8'))
  assert.ok(/if \(roughOn\(env\)\) \{\s*const busyR/.test(td) && /roughB = roughIn\(read, \{ home, boxes: \[bx\]/.test(td), 'both stages call the survey')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
