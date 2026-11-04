// TOWNTERRACE-01: THE TERRACE STAGE (terrace.mjs), THE PARK (park.mjs), THEIR VISIT (buildrun.mjs useFor / openRole / crop families;
// skills.mjs buildTidy). Owner 11-03 (ledger townterrace-1103): clear the trees inside the wall, grade the town into terraces at the
// buildings' floors, a seeded park/garden. Behaviour on buildfake's flat world (stone below G, grass at G) and hand-built grounds;
// structural assertions only for wiring; every mutant asserts its anchor present and unique.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { G, HOME, server, bot, PJ, R } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const TR = await import('../src/terrace.mjs')
const PK = await import('../src/park.mjs')
const LP = await import('../src/landplan.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const TERRACE_PATH = new URL('../src/terrace.mjs', import.meta.url)
const PARK_PATH = new URL('../src/park.mjs', import.meta.url)
const BUILDRUN_PATH = new URL('../src/buildrun.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const LAND_PATH = new URL('../src/landplan.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const col = (srv, x, z, y0, y1, name) => { for (let y = y0; y <= y1; y++) srv.set([x, y, z], name) }
const k2 = (x, z) => `${x},${z}`
const BOX = [8, -8, 30, 8]
const LAND = () => ({ home: HOME, seed: 7, ringR: 20, workR: 44, zones: { E: 'treefarm', SE: 'wild', S: 'wild', SW: 'wild', W: 'wild', NW: 'wild', N: 'wild', NE: 'wild' }, roads: [], corridors: [] })
/** A plateau of dirt (top `top`, grass on it) over x in [x0, x1], z in [z0, z1]. */
const plateau = (srv, x0, x1, z0, z1, top) => { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { col(srv, x, z, G, top - 1, 'dirt'); srv.set([x, top, z], 'grass_block') } }
/** Every step from a worked column to a 4-neighbour of the box (and just outside it) on the finished ground. */
const stepsOf = (gr, read) => {
  const fin = (x, z) => gr.H.get(k2(x, z)) ?? T.tidyColumn(read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 }).y
  const orig = (x, z) => gr.g.get(k2(x, z)) ?? T.tidyColumn(read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 }).y
  const out = []
  for (const k of gr.worked) { const [x, z] = k.split(',').map(Number); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push({ d: Math.abs(fin(x, z) - fin(x + dx, z + dz)), was: Math.abs(orig(x, z) - orig(x + dx, z + dz)) }) }
  return out
}

console.log('THE LEVELS AND THE FLOORS')
await t('terraceLevels: the floors, then steps through the ground\'s range; a floor-less town gets levels from its middle', async () => {
  assert.deepStrictEqual(TR.terraceLevels([{ y: 70 }, { y: 68 }, { y: 70 }], 69, 70), [68, 70])
  const lv = TR.terraceLevels([70], 60, 80)
  assert.deepStrictEqual(lv, [61, 64, 67, 70, 73, 76])
  assert.deepStrictEqual(TR.terraceLevels([], 64, 66), [65])
  assert.strictEqual(TR.nearestLevel([64, 67], 65), 64, 'a tie goes to the lower')
  assert.strictEqual(TR.nearestLevel([64, 67], 66), 67)
})
await t('buildingFloors: a record\'s floor, a ziggurat\'s base, the tree farm\'s level, the wall\'s gates and the well\'s surround read; a chest inside a build is not a floor', async () => {
  const srv = server()
  const f = TR.buildingFloors({ records: [{ plot: 'house1', floor: 68 }, { plot: 'monument', baseY: 69 }, { plot: 'treefarm', level: 66 }, { plot: 'shopchest', floor: 72 }, { plot: 'tidy', floor: 1 }],
    wall: { gates: [{ cols: [[20, 0], [21, 0]] }] }, caps: [[0, G + 2, 20]], read: srv.read, home: HOME })
  assert.deepStrictEqual(f.map(q => `${q.why}:${q.y}`), ['house1:floor:68', 'monument:base:69', 'treefarm:level:66', 'wall:gate:69', 'well:surround:69'])
})
await t('wallInterior: the wall\'s ring less its line, else tidy-01\'s square', async () => {
  assert.deepStrictEqual(TR.wallInterior({ ring: [-46, -20, 35, 39] }, HOME), [-45, -19, 34, 38])
  assert.deepStrictEqual(TR.wallInterior(null, HOME), [-32, -32, 32, 32])
})

console.log('THE GRADING: terraces at the floors, 1-Lipschitz, never against what it may not touch')
await t('lip: the smallest 1-Lipschitz majorant and the largest minorant on a line', async () => {
  const keys = ['0', '1', '2', '3', '4']
  const nb = k => [String(Number(k) - 1), String(Number(k) + 1)].filter(q => keys.includes(q))
  const v = new Map([['0', 5], ['1', 0], ['2', 0], ['3', 0], ['4', 9]])
  assert.deepStrictEqual([...TR.lip(keys, v, nb, +1).values()], [5, 6, 7, 8, 9])
  assert.deepStrictEqual([...TR.lip(keys, v, nb, -1).values()], [1, 0, 0, 0, 1])
})
await t('a plateau 4 above the town is graded to the floors: never one flat plane, every new step at most 1, ramps to the ground round it', async () => {
  const srv = server()
  plateau(srv, 14, 24, -4, 4, G + 4)
  const gr = TR.gradeTerraces(srv.read, BOX, { home: HOME, levels: [G, G + 2] })
  assert.ok(gr.cut.length > 0 && gr.worked.size > 0, `cut ${gr.cut.length}`)
  const hs = new Set([...gr.worked].map(k => gr.H.get(k)))
  assert.ok(hs.size >= 2, `the worked ground lies at ${[...hs]}: one flat plane`)
  assert.ok([...gr.worked].every(k => Math.abs(gr.H.get(k) - gr.g.get(k)) <= TR.TERRACE.maxCut))
  const st = stepsOf(gr, srv.read)
  assert.ok(st.length > 0)
  assert.ok(st.every(s => s.d <= 1 || s.d <= s.was), `a step made worse: ${JSON.stringify(st.filter(s => s.d > 1 && s.d > s.was).slice(0, 3))}`)
  // the plateau's edge was a cliff of 4: the finished steps there are all 1
  assert.ok(st.filter(s => s.was >= 2).every(s => s.d <= 1), 'the cliff is a ramp now')
})
await t('a refused column is never touched and its height binds its neighbours; a record cell is never cut', async () => {
  const srv = server()
  plateau(srv, 14, 24, -4, 4, G + 4)
  const avoid = (x, z) => (x === 19 && z === 0 ? 'project:house1' : null)
  const cells = new Set([`20,${G + 4},1`])
  const gr = TR.gradeTerraces(srv.read, BOX, { home: HOME, levels: [G, G + 2], avoid, cells })
  const touched = new Set([...gr.cut, ...gr.fill, ...gr.seal].map(c => k2(c.at[0], c.at[2])))
  assert.ok(!touched.has('19,0'), 'the refused column')
  assert.ok(![...gr.cut, ...gr.fill, ...gr.seal].some(c => c.at.join(',') === `20,${G + 4},1`), 'the record cell')
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const h = gr.H.get(k2(19 + dx, dz)); if (h != null) assert.ok(Math.abs(h - (G + 4)) <= 1, `beside the refused column: ${h}`) }
})
await t('CAVES: a cut over an air pocket seals the pocket\'s floor under it, each seal placed after its opener cut', async () => {
  const srv = server()
  for (let x = 20; x <= 24; x++) for (let z = -2; z <= 2; z++) col(srv, x, z, G + 1, G + 1, 'dirt')
  // a pocket under the middle column, below the new level
  col(srv, 22, 0, G - 1, G, 'air'); srv.set([22, G + 1, 0], 'dirt')
  const gr = TR.gradeTerraces(srv.read, [18, -4, 26, 4], { home: HOME, levels: [G] })
  const s = gr.seal.filter(c => c.at[0] === 22 && c.at[2] === 0)
  assert.deepStrictEqual(s.map(c => c.at[1]).sort(), [G - 1, G], JSON.stringify(gr.seal))
  assert.ok(s.every(c => c.opener.join(',') === `22,${G + 1},0`), 'the opener: the cut that exposes it')
  assert.ok(gr.cut.some(c => c.at.join(',') === `22,${G + 1},0`))
})
await t('MUTANT KILLED: without the floor seal the same cut leaves the pocket open', async () => {
  await withMutant(TERRACE_PATH, '    out.floor = add.reverse()\n', '    out.floor = []\n', async M => {
    const srv = server()
    for (let x = 20; x <= 24; x++) for (let z = -2; z <= 2; z++) col(srv, x, z, G + 1, G + 1, 'dirt')
    col(srv, 22, 0, G - 1, G, 'air'); srv.set([22, G + 1, 0], 'dirt')
    const gr = M.gradeTerraces(srv.read, [18, -4, 26, 4], { home: HOME, levels: [G] })
    assert.strictEqual(gr.seal.filter(c => c.at[0] === 22 && c.at[2] === 0).length, 0)
  })
})
await t('MUTANT KILLED: with the refusal dropped from the free columns, the refused column is cut', async () => {
  await withMutant(TERRACE_PATH, "    if (avoid(x, z)) { skip('col_guarded'); continue }\n", '\n', async M => {
    const srv = server()
    plateau(srv, 14, 24, -4, 4, G + 4)
    const gr = M.gradeTerraces(srv.read, BOX, { home: HOME, levels: [G, G + 2], avoid: (x, z) => (x === 19 && z === 0 ? 'project:house1' : null) })
    assert.ok([...gr.cut, ...gr.fill].some(c => c.at[0] === 19 && c.at[2] === 0))
  })
})
await t('the anchors\' bound grades a refused column\'s neighbours to within 1 of it (MUTANT KILLED: without it they can only be kept as they are)', async () => {
  const run = M => { const srv = server(); plateau(srv, 14, 24, -4, 4, G + 4); const gr = M.gradeTerraces(srv.read, BOX, { home: HOME, levels: [G, G + 2], avoid: (x, z) => (x === 19 && z === 0 ? 'project:house1' : null) }); return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [gr.worked.has(k2(19 + dx, dz)), gr.H.get(k2(19 + dx, dz))]) }
  const ok = run(TR)
  assert.ok(ok.every(([w, h]) => w && h === G + 3), JSON.stringify(ok))
  await withMutant(TERRACE_PATH, '        lo = Math.max(lo, c.y - sl); hi = Math.min(hi, c.y + sl)\n', '\n', async M => {
    const bad = run(M)
    assert.ok(bad.every(([w]) => !w), JSON.stringify(bad))
  })
})
await t('the farm\'s water: no column within farmGuard of farmland is graded', async () => {
  const srv = server()
  plateau(srv, 14, 24, -4, 4, G + 4)
  srv.set([18, G + 4, 0], 'farmland')
  const farm = (x, z) => Math.max(Math.abs(x - 18), Math.abs(z)) <= TR.TERRACE.farmGuard
  const gr = TR.gradeTerraces(srv.read, BOX, { home: HOME, levels: [G, G + 2], farm })
  assert.ok(![...gr.cut, ...gr.fill].some(c => farm(c.at[0], c.at[2])))
})

console.log('THE TREES INSIDE')
await t('a tree on soil is felled whole; a tall tree, a park tree and a tree with a guarded log are kept and named', async () => {
  const srv = server()
  col(srv, 12, 0, G + 1, G + 4, 'oak_log'); srv.set([13, G + 4, 0], 'oak_log')                 // a branch: the same tree
  col(srv, 16, 0, G + 1, G + 9, 'spruce_log')                                                   // too tall to fell whole
  col(srv, 20, 0, G + 1, G + 4, 'birch_log')                                                    // the park's own
  col(srv, 24, 0, G + 1, G + 4, 'oak_log'); srv.set([25, G + 3, 0], 'oak_log')                 // a log in a refused column
  const r = TR.inWallTrees(srv.read, BOX, { home: HOME, keep: (x, z) => x === 20 && z === 0, avoid: (x, z) => (x === 25 ? 'project:x' : null) })
  assert.deepStrictEqual(r.trees.map(q => q.col.join(',')), ['12,0'])
  assert.strictEqual(r.trees[0].logs.length, 5, 'the branch is part of the tree')
  assert.ok(r.trees[0].logs.every((l, i, a) => !i || l.at[1] >= a[i - 1].at[1]), 'bottom up')
  assert.deepStrictEqual(r.skipped, { tree_tall: 1, tree_park: 1, tree_guarded: 1 })
})
await t('siteTerrace: one replant a felled tree in the land plan\'s tree-farm zone, the logs listed `tree`, never felled before its sapling (the record\'s replant)', async () => {
  const srv = server()
  col(srv, 12, 0, G + 1, G + 4, 'oak_log')
  const land = LAND()
  const s = await TR.siteTerrace(srv.read, { home: HOME, land, records: [{ plot: 'house1', floor: G }], now: 0 })
  assert.ok(s.record, s.why)
  assert.deepStrictEqual(s.record.clear.filter(c => c.kind === 'tree').map(c => c.at[1]), [G + 1, G + 2, G + 3, G + 4])
  assert.strictEqual(s.record.replant.length, 1)
  assert.strictEqual(s.record.replant[0].sapling, 'oak_sapling')
  assert.strictEqual(LP.zoneAt(land, s.record.replant[0].cell[0], s.record.replant[0].cell[2]), 'treefarm')
  assert.strictEqual(s.record.stageId, 'terrace')
})

await t('a tree is felled only with its own replant cell: no room in the tree-farm zone (or no land plan) keeps it standing, named', async () => {
  const srv = server()
  col(srv, 12, 0, G + 1, G + 4, 'oak_log'); col(srv, 16, 2, G + 1, G + 4, 'birch_log')
  const none = await TR.siteTerrace(srv.read, { home: HOME, land: LAND(), avoid: (x, z) => (Math.max(Math.abs(x), Math.abs(z)) > 20 ? 'zone' : null), records: [{ plot: 'house1', floor: G }], now: 0 })
  assert.ok(!none.record || !none.record.clear.some(c => c.kind === 'tree'), 'a felled tree with no sapling cell')
  assert.strictEqual((none.record?.terrace?.skipped ?? none.skipped).tree_no_replant, 2)
  const noLand = await TR.siteTerrace(srv.read, { home: HOME, land: null, records: [{ plot: 'house1', floor: G }], now: 0 })
  assert.ok(!noLand.record || !noLand.record.clear.some(c => c.kind === 'tree'))
  const ok = await TR.siteTerrace(srv.read, { home: HOME, land: LAND(), records: [{ plot: 'house1', floor: G }], now: 0 })
  const ids = new Set(ok.record.clear.filter(c => c.kind === 'tree').map(c => c.tree))
  assert.deepStrictEqual([...ids].sort(), ok.record.replant.map(r => r.tree).sort(), 'every felled tree names its replant')
})
await t('the park never puts a planting on one of the stage\'s own cuts (the cut would never be dug under a record cell)', async () => {
  const srv = server()
  plateau(srv, -20, 20, -20, 20, G + 2)
  const s = await TR.siteTerrace(srv.read, { home: HOME, land: LAND(), records: [{ plot: 'a', floor: G }, { plot: 'b', floor: G + 1 }], have: { poppy: 64, oak_leaves: 64, bamboo: 9 }, now: 0 })
  assert.ok(s.record?.park, s.why)
  const cutK = new Set(s.record.cut.map(c => c.at.join(',')))
  const cellK = s.record.cells.map(c => c.at.join(','))
  assert.ok(cutK.size > 0, 'the plateau is cut')
  assert.ok(!cellK.some(k => cutK.has(k)), 'a record cell on a cut')
  assert.strictEqual(new Set(cellK).size, cellK.length, 'two record cells on one block')
})
await t('stageCarry: the stage before\'s cells ride on as done-by-definition PREV cells (the tripwire judges a placement against the head)', async () => {
  const cur = { cells: [{ at: [1, 2, 3], role: 'earth', seg: 'T-00-0' }, { at: [4, 5, 6], role: 'flower0', seg: 'T-PP' }] }
  const body = { cells: [{ at: [4, 5, 6], role: 'earth', seg: 'r0' }], segments: [{ seg: 'r0', deps: [] }] }
  const out = T.stageCarry(body, cur)
  assert.deepStrictEqual(out.cells, [{ at: [4, 5, 6], role: 'earth', seg: 'r0' }, { at: [1, 2, 3], role: 'earth', seg: T.PREV_SEG, prev: true }])
  assert.ok(!out.segments.some(s => s.seg === T.PREV_SEG), 'no visit works a previous cell')
  assert.strictEqual(T.stageCarry(body, null), body)
  const cutOn = T.stageCarry({ cells: [], cut: [{ at: [1, 2, 3], kind: 'tidy', name: 'dirt' }], clear: [{ at: [7, 7, 7], kind: 'leaves', name: 'oak_leaves' }] }, { cells: [{ at: [1, 2, 3], role: 'earth' }, { at: [7, 7, 7], role: 'earth' }, { at: [9, 9, 9], role: 'earth' }] })
  assert.deepStrictEqual(cutOn.cells.map(c => c.at.join(',')), ['9,9,9'], 'a previous fill under a new cut or clear is never carried (the cut would hide)')
  assert.strictEqual(T.stageCarry(body, { cells: Array.from({ length: 10 }, (_, i) => ({ at: [i, 0, 0], role: 'earth' })) }, 3).cells.length, 4)
})
await t('legacyStage: the stage number is groundskeeper-01\'s (a rollback reads it), the terrace 0', async () => {
  assert.deepStrictEqual(LP.landStages().slice(0, 6).map(st => T.legacyStage(st)), [0, 0, 1, 1, 2, 3], 'gkstage-01: inwall reads as the roads\' 1; the bands keep 2, 3, ...')
  for (const st of LP.landStages()) { if (st.k) assert.strictEqual(LP.recStageK({ stage: T.legacyStage(st), stageId: st.id, terraceV: 1 }), st.k) }
})
console.log('THE WALK: never worse')
await t('terraceWalk names a stuck-prone pit (reached, no walk back); the plateau\'s grading never adds one', async () => {
  const srv = server()
  col(srv, 10, 0, G - 2, G, 'air')
  const w = TR.terraceWalk(srv.read, [-20, -20, 20, 20], HOME, [[0, 0]])
  assert.strictEqual(w.traps, 1); assert.ok(w.trapSet.has('10,0'))
  const srv2 = server()
  plateau(srv2, 14, 24, -4, 4, G + 4)
  col(srv2, 5, 5, G - 2, G, 'air')
  const s = await TR.siteTerrace(srv2.read, { home: HOME, records: [{ plot: 'a', floor: G }, { plot: 'b', floor: G + 2 }], walkFrom: [[0, 0]], now: 0 })
  assert.ok(s.record && s.walk1, s.why)
  assert.ok(s.walk1.traps <= s.walk0.traps && s.walk1.back >= s.walk0.back, JSON.stringify([s.walk0.traps, s.walk1.traps, s.walk0.back, s.walk1.back]))
  assert.ok(s.walk1.back > s.walk0.back, 'the plateau is walkable onto now')
})

console.log('THE PARK: seeded, materials only from the town, hedges on the edge only')
const flatPark = (have, seed = 3, near = () => false) => {
  const srv = server()
  return { srv, p: TR.parkLayout(srv.read, [10, -5, 20, 5], { seed, top: () => G, orig: () => G, soilTop: () => true, have, near }) }
}
const ALL = { poppy: 20, dandelion: 20, rose_bush: 8, azalea: 8, oak_sapling: 4, bamboo: 30, wheat_seeds: 20, wooden_hoe: 1, sugar_cane: 8, oak_leaves: 64, bone_meal: 10 }
await t('the same town lays the same park; seeds differ between towns', async () => {
  const a = flatPark(ALL, 5).p, b = flatPark(ALL, 5).p
  assert.deepStrictEqual(a, b)
  const shapes = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(s => JSON.stringify([flatPark(ALL, s).p.kinds, flatPark(ALL, s).p.cross])))
  assert.ok(shapes.size >= 3, `${shapes.size} layouts of 8 seeds`)
})
await t('every element the town cannot get is skipped and named, never planted; lily pads are named (no actuator)', async () => {
  const { p } = flatPark({ poppy: 5 })
  assert.ok(p.cells.every(c => c.el === 'flowers'), JSON.stringify(p.cells.map(c => c.role)))
  assert.ok(p.cells.length > 0 && p.cells.length <= 5, `${p.cells.length} flowers from 5`)
  for (const el of ['tall_flowers', 'azalea', 'trees', 'bamboo', 'crops', 'hedge', 'meadow', 'cane', 'lily_pads']) assert.ok(p.skipped[el], `${el} not named`)
  assert.strictEqual(flatPark({ wheat_seeds: 9 }).p.skipped.crops, 'no_hoe', 'crops need a hoe')
})
await t('the hedge: only on the box\'s edge, an entrance open on every side and at the cross path\'s ends, never beside a road or path column', async () => {
  const { p } = flatPark(ALL, 4, (x, z) => x === 21 && z === 0)
  const hedge = p.cells.filter(c => c.role === 'hedge')
  assert.ok(hedge.length > 0)
  const [x0, z0, x1, z1] = p.box
  assert.ok(hedge.every(c => c.at[0] === x0 || c.at[0] === x1 || c.at[2] === z0 || c.at[2] === z1), 'edge only')
  assert.ok(!hedge.some(c => Math.abs(c.at[0] - 21) <= 1 && Math.abs(c.at[2]) <= 1), 'beside the road column')
  const hk = new Set(hedge.map(c => k2(c.at[0], c.at[2])))
  for (const [x, z] of [[p.cross[0], z0], [p.cross[0], z1], [x0, p.cross[1]], [x1, p.cross[1]]]) assert.ok(!hk.has(k2(x, z)), `the cross path's end ${x},${z}`)
  for (const side of ['N', 'S', 'W', 'E']) {
    const edge = []
    if (side === 'N' || side === 'S') { const z = side === 'N' ? z0 : z1; for (let x = x0 + 1; x < x1; x++) edge.push(k2(x, z)) } else { const x = side === 'W' ? x0 : x1; for (let z = z0 + 1; z < z1; z++) edge.push(k2(x, z)) }
    assert.ok(edge.some(k => !hk.has(k)), `side ${side} has no opening`)
  }
  // the cross path stays open: nothing is planted on it, so every opening walks in
  assert.ok(!p.cells.some(c => c.at[0] === p.cross[0] || c.at[2] === p.cross[1]), JSON.stringify(p.cells.filter(c => c.at[0] === p.cross[0] || c.at[2] === p.cross[1])))
})
await t('crops sit on tilled ground the grading leaves as it is; a tree has a sapling\'s room; never a berry bush, cactus or vines', async () => {
  const { p } = flatPark({ wheat_seeds: 9, wooden_hoe: 1, oak_sapling: 2 }, 2)
  assert.ok(p.cells.some(q => /^crop/.test(q.role)) && p.trees.length === 1, JSON.stringify(p.kinds))
  for (const c of p.cells.filter(q => /^crop/.test(q.role))) assert.ok(p.cells.some(q => q.role === 'till' && q.at[0] === c.at[0] && q.at[2] === c.at[2] && q.at[1] === c.at[1] - 1))
  assert.strictEqual(p.trees.length, p.cells.filter(c => /^sapling/.test(c.role)).length)
  const names = Object.values(PK.PARK_PALETTE).flat().join(' ')
  assert.ok(!/sweet_berr|cactus|vine/.test(names), 'never a berry bush, cactus or vines')
})

await t('MUTANT KILLED: with the hedge free of the road rule, a hedge stands beside the road column', async () => {
  await withMutant(TERRACE_PATH, '      if (gate.has(k2(x, z)) || near(x, z) || N8.some(([dx, dz]) => near(x + dx, z + dz))) continue\n', '      if (gate.has(k2(x, z))) continue\n', async M => {
    const srv = server()
    const p = M.parkLayout(srv.read, [10, -5, 20, 5], { seed: 4, top: () => G, orig: () => G, soilTop: () => true, have: ALL, near: (x, z) => x === 21 && z === 0 })
    assert.ok(p.cells.some(c => c.role === 'hedge' && Math.abs(c.at[0] - 21) <= 1 && Math.abs(c.at[2]) <= 1))
  })
})
console.log('THE VISIT\'S SKIP RULE AND THE BILL')
await t('terraceSkip: no material, no tool, no support, a seal before its opener; done cells are never passed', async () => {
  const srv = server()
  const has = n => n === 'poppy'
  assert.strictEqual(PK.terraceSkip({ at: [3, G + 1, 3], role: 'flower0' }, srv.read, { has }), null)
  assert.strictEqual(PK.terraceSkip({ at: [3, G + 1, 3], role: 'tall0' }, srv.read, { has }), 'no_tall_flowers')
  srv.set([4, G, 4], 'stone')
  assert.strictEqual(PK.terraceSkip({ at: [4, G + 1, 4], role: 'flower0' }, srv.read, { has }), 'no_support')
  assert.strictEqual(PK.terraceSkip({ at: [3, G + 1, 5], role: 'crop0' }, srv.read, { has: () => true }), 'no_support', 'a crop needs farmland')
  assert.strictEqual(PK.terraceSkip({ at: [3, G, 6], role: 'till' }, srv.read, { tools: {} }), 'no_hoe')
  assert.strictEqual(PK.terraceSkip({ at: [3, G, 6], role: 'till' }, srv.read, { tools: { hoe: true } }), null)
  assert.strictEqual(PK.terraceSkip({ at: [3, G, 7], role: 'meadow' }, srv.read, { tools: {} }), 'no_bone_meal')
  srv.set([3, G + 1, 7], 'poppy')
  assert.strictEqual(PK.terraceSkip({ at: [3, G, 7], role: 'meadow' }, srv.read, { tools: { boneMeal: true } }), 'grown')
  srv.set([3, G + 1, 8], 'carrots')
  assert.strictEqual(PK.terraceSkip({ at: [3, G + 1, 8], role: 'crop1' }, srv.read, { has: () => false }), null, 'a planted carrot is done, never passed')
  srv.set([5, G + 2, 5], 'dirt')
  assert.strictEqual(PK.terraceSkip({ at: [5, G - 1, 5], role: 'core', opener: [5, G + 2, 5] }, srv.read), 'opener_standing')
  srv.set([5, G + 2, 5], 'air')
  assert.strictEqual(PK.terraceSkip({ at: [5, G - 1, 5], role: 'core', opener: [5, G + 2, 5] }, srv.read), null)
  srv.set([8, G, 8], 'sand'); srv.set([9, G, 8], 'water')
  assert.strictEqual(PK.terraceSkip({ at: [8, G + 1, 8], role: 'cane' }, srv.read, { has: () => true }), null)
  assert.strictEqual(PK.terraceSkip({ at: [3, G + 1, 9], role: 'cane' }, srv.read, { has: () => true }), 'no_water')
})
await t('MUTANT KILLED: with the opener rule gone a seal is placed while the cut over it still stands', async () => {
  await withMutant(PARK_PATH, "  if (c.role === 'core' && Array.isArray(c.opener)) { const b = read(...c.opener); return !b || !(AIRN(nm(b)) || replaceableCell(b)) ? 'opener_standing' : null }\n", '\n', async M => {
    const srv = server()
    srv.set([5, G + 2, 5], 'dirt')
    assert.strictEqual(M.terraceSkip({ at: [5, G - 1, 5], role: 'core', opener: [5, G + 2, 5] }, srv.read), null)
  })
})
await t('parkBill: only what the town holds, less the bag; one hoe for open till cells; bone meal for the open meadow', async () => {
  const srv = server()
  const rec = { cells: [{ at: [1, G + 1, 1], role: 'flower0' }, { at: [2, G + 1, 1], role: 'flower1' }, { at: [3, G + 1, 1], role: 'bamboo' }, { at: [4, G, 1], role: 'till' }, { at: [5, G, 1], role: 'meadow' }, { at: [6, G, 1], role: 'meadow' }, { at: [7, G, 1], role: 'earth' }] }
  const b = PK.parkBill(rec, srv.read, { held: { poppy: 1 }, stock: { poppy: 9, dandelion: 9, stone_hoe: 1, bone_meal: 5 } })
  assert.deepStrictEqual(b, { poppy: 1, stone_hoe: 1, bone_meal: 2 })
})

console.log('THE VISIT: the hoe tills, the bone meal greens (tallied), a crop block is its seed, a missing element never blocks')
const parkVisit = async (RM, { inv, rec, skip = true }) => {
  const srv = server()
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tt-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 1)
  const e = bot(srv, 'A', { inv, feet: [0, G + 1, 0], as: n => ({ wheat_seeds: 'wheat', carrot: 'carrots' }[n] ?? n), ack: (tg, held) => (held === 'wooden_hoe' || held === 'bone_meal' ? 'refuse' : 'ok') })
  // a tool's use on the fake server: the hoe tills the cell it is sent on, the bone meal grows short grass above and is spent
  let heldNow = null
  const hold0 = e.hold
  e.hold = async n => { const ok = await hold0(n); if (ok) heldNow = n; return ok }
  const send0 = e.send
  e.send = (support, face, seq) => {
    if (heldNow === 'wooden_hoe' || heldNow === 'bone_meal') {
      if (heldNow === 'wooden_hoe') srv.set(support, 'farmland'); else { srv.set([support[0], support[1] + 1, support[2]], 'short_grass'); inv.bone_meal-- }
    }
    // the fake acknowledges a tool's use without placing anything (its `ack` answers 'refuse' for a held tool)
    return send0(support, face, seq)
  }
  const tool = name => ({ block: name === 'wooden_hoe' ? 'farmland' : 'bone_meal', consumes: name === 'bone_meal' ? 'bone_meal' : undefined, can: b => (name === 'wooden_hoe' ? PK.TILL_RE.test(b?.name) : b?.name === 'grass_block'), want: b => (name === 'wooden_hoe' ? b?.name === 'farmland' : true), held: () => heldNow === name, hold: () => e.hold(name) })
  const useFor = q => (q.role === 'till' ? tool('wooden_hoe') : q.role === 'meadow' ? tool('bone_meal') : null)
  const alsoDone = skip ? q => !!PK.terraceSkip(q, srv.read, { has: n => (inv[n] ?? 0) > 0, tools: { hoe: (inv.wooden_hoe ?? 0) > 0, boneMeal: (inv.bone_meal ?? 0) > 0 } }) : null
  const r = await RM.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: [], recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 48, clearMax: 16, stuckStalledOnly: true, deferSpent: true, useFor, openRole: role => PK.OPEN_ROLES.has(role), ...(alsoDone ? { alsoDone } : {}) }, e, { maxSteps: 400 })
  return { r, srv, inv }
}
const PARK_REC = () => ({ v: 1, blueprint: T.TIDY_BLUEPRINT, plot: 'tidy', home: HOME, cells: [{ at: [3, G, 3], role: 'till', seg: 'T-PU' }, { at: [6, G, 3], role: 'meadow', seg: 'T-PU' }, { at: [3, G + 1, 3], role: 'crop0', seg: 'T-PP' }, { at: [8, G + 1, 3], role: 'flower0', seg: 'T-PP' }, { at: [9, G + 1, 3], role: 'tall0', seg: 'T-PP' }], clear: [], cut: [], replant: [], segments: [{ seg: 'T-PU', deps: [] }, { seg: 'T-PP', deps: [] }], zones: [], structure_complete: false })
await t('the park\'s visit: farmland tilled, wheat planted on it (read done as its seed), the meadow greened with the bone meal tallied, a flower placed; the tall flower the bag lacks is passed', async () => {
  const { r, srv } = await parkVisit(R, { inv: { wooden_hoe: 1, bone_meal: 2, wheat_seeds: 4, poppy: 2 }, rec: PARK_REC() })
  assert.strictEqual(srv.read(3, G, 3).name, 'farmland', JSON.stringify([r.stop, r.why]))
  assert.strictEqual(srv.read(3, G + 1, 3).name, 'wheat')
  assert.strictEqual(srv.read(6, G + 1, 3).name, 'short_grass')
  assert.strictEqual(srv.read(8, G + 1, 3).name, 'poppy')
  assert.strictEqual(srv.read(9, G + 1, 3).name, 'air', 'no tall flower in the bag: passed')
  assert.strictEqual(r.placedBy.bone_meal, 1, 'the spent bone meal is tallied (shopread G8 reads the bag)')
  assert.strictEqual(r.stop, 'complete', `${r.stop}: ${r.why}`)
})
await t('MUTANT KILLED: with `useFor` ignored the till cell is never tilled', async () => {
  await withMutant(BUILDRUN_PATH, 'const useOf = c => (p.useFor ? p.useFor(c) : p.use) ?? null', 'const useOf = c => p.use ?? null', async RM => {
    const { srv } = await parkVisit(RM, { inv: { wooden_hoe: 1, bone_meal: 2, wheat_seeds: 4, poppy: 2 }, rec: PARK_REC() })
    assert.notStrictEqual(srv.read(3, G, 3).name, 'farmland')
  })
})
await t('MUTANT KILLED: with the foreign pass free to dig a tool\'s cell, the till cell\'s grass is dug out (a hole) instead of tilled', async () => {
  await withMutant(BUILDRUN_PATH, ' && !useOf(c)?.can(rd(...c.at)) }).sort((a, b) => a.at[1] - b.at[1])', ' }).sort((a, b) => a.at[1] - b.at[1])', async RM => {
    const { srv } = await parkVisit(RM, { inv: { wooden_hoe: 1, bone_meal: 2, wheat_seeds: 4, poppy: 2 }, rec: PARK_REC() })
    assert.strictEqual(srv.read(3, G, 3).name, 'air')
  })
})
await t('MUTANT KILLED: without the consumes tally the bone meal\'s use is not in the bag\'s balance', async () => {
  await withMutant(BUILDRUN_PATH, '    if (u.consumes) tally(u.consumes)\n', '\n', async RM => {
    const { r } = await parkVisit(RM, { inv: { wooden_hoe: 1, bone_meal: 2, wheat_seeds: 4, poppy: 2 }, rec: PARK_REC() })
    assert.strictEqual(r.placedBy.bone_meal, undefined)
  })
})
await t('MUTANT KILLED: without the crop family a planted wheat never reads done (the visit spends its attempts on it)', async () => {
  await withMutant(BUILDRUN_PATH, "  const s = plantedAs(String(n ?? ''))", "  const s = String(n ?? '')", async RM => {
    assert.strictEqual(RM.cellDone({ name: 'wheat' }, T.TIDY_PALETTE, 'crop0'), false)
  })
  assert.strictEqual(R.cellDone({ name: 'wheat' }, T.TIDY_PALETTE, 'crop0'), true)
  assert.strictEqual(R.cellDone({ name: 'carrots' }, T.TIDY_PALETTE, 'crop1'), true)
  assert.strictEqual(R.cellDone({ name: 'bamboo_sapling' }, T.TIDY_PALETTE, 'bamboo'), true)
})
await t('COMPOSED: a park element the bag lacks never blocks the visit with the skip rule (control: without it, the visit stops no_material)', async () => {
  const rec = () => ({ ...PARK_REC(), cells: PARK_REC().cells.filter(c => c.seg === 'T-PP' && c.role !== 'crop0'), segments: [{ seg: 'T-PP', deps: [] }] })
  const a = await parkVisit(R, { inv: { poppy: 2 }, rec: rec() })
  assert.strictEqual(a.r.stop, 'complete', `${a.r.stop}: ${a.r.why}`)
  const b = await parkVisit(R, { inv: { poppy: 2 }, rec: rec(), skip: false })
  assert.strictEqual(b.r.stop, 'no_material', `${b.r.stop}: ${b.r.why}`)
})

console.log('THE OWNER\'S 11-01 WATER RULE (water is terrain): fills beside and into water, a cut beside water dams it first')
const TIDY_PATH = new URL('../src/tidy.mjs', import.meta.url)
await t('cutWater: strict refuses any liquid within one block; the 11-01 rule dams each water block 4-beside, refuses lava, a waterlogged block and a dam it may not place', async () => {
  const srv = server()
  srv.set([11, G, 0], 'water')
  assert.deepStrictEqual(T.cutWater(srv.read, 10, G, 0, { water: 'strict' }), { ok: false, why: 'cut_wet', dams: [] })
  assert.deepStrictEqual(T.cutWater(srv.read, 10, G, 0), { ok: true, why: null, dams: [[11, G, 0]] })
  assert.strictEqual(T.cutWater(srv.read, 10, G, 0, { mayDam: () => false }).why, 'cut_wet_guarded', 'a well, the farm\'s irrigation, a zone: never dammed')
  assert.deepStrictEqual(T.cutWater(srv.read, 10, G + 1, 0).dams, [], 'water below the cell does not flow up into it')
  srv.set([9, G - 1, 1], 'lava')
  assert.strictEqual(T.cutWater(srv.read, 10, G, 0).why, 'cut_lava')
  const s3 = server(); s3.set([10, G + 1, 0], 'water')
  assert.strictEqual(T.cutWater(s3.read, 10, G, 0).why, 'cut_under_water', 'never under a pond (Claude water r1)')
  const s2 = server(); s2.set([10, G, 1], 'oak_stairs[waterlogged=true]')
  assert.strictEqual(T.cutWater(s2.read, 10, G, 0).why, 'cut_logged')
  assert.strictEqual(T.tidyWater({ TIDY_WATER: 'strict' }), 'strict'); assert.strictEqual(T.tidyWater({}), 'owner-1101')
})
await t('fills: into water under the rule (an embankment), never into lava; a pit beside a pond is filled to the water\'s surface (strict: pit_water)', async () => {
  assert.ok(T.fillIntoOk({ name: 'water', boundingBox: 'empty' }) && !T.fillIntoOk({ name: 'water', boundingBox: 'empty' }, 'strict') && !T.fillIntoOk({ name: 'lava', boundingBox: 'empty' }))
  const srv = server()
  col(srv, 10, 0, G - 2, G, 'air')                          // a pit 3 deep
  col(srv, 11, 0, G - 1, G, 'water'); col(srv, 11, 1, G - 1, G, 'water'); col(srv, 11, -1, G - 1, G, 'water')   // a pond beside it, surface G
  const strict = T.surveyTidy(srv.read, { home: HOME })
  assert.ok(strict.skipped.pit_water >= 1 && !strict.fill.some(f => f.at[0] === 10 && f.at[2] === 0))
  const rule = T.surveyTidy(srv.read, { home: HOME, water: 'owner-1101', waterOk: () => true })
  assert.deepStrictEqual(rule.fill.filter(f => f.at[0] === 10 && f.at[2] === 0).map(f => f.at[1]).sort(), [G - 2, G - 1, G], 'filled to the surface')
  const guarded = T.surveyTidy(srv.read, { home: HOME, water: 'owner-1101', waterOk: () => false })
  assert.ok(!guarded.fill.some(f => f.at[0] === 10 && f.at[2] === 0), 'water the stage may not touch: as before')
})
await t('the terrace beside a pond: strict keeps the bank (cut_wet); the rule cuts it with a dam into the pond first, and grades the pond\'s edge as an embankment', async () => {
  const pond = () => { const srv = server(); plateau(srv, 14, 24, -4, 4, G + 2); for (let z = -4; z <= 4; z++) col(srv, 25, z, G + 1, G + 2, 'water'); return srv }
  const a = TR.gradeTerraces(pond().read, BOX, { home: HOME, levels: [G, G + 1] })
  const b = TR.gradeTerraces(pond().read, BOX, { home: HOME, levels: [G, G + 1], water: 'owner-1101' })
  assert.ok((a.skipped.cut_wet ?? 0) > 0, JSON.stringify(a.skipped))
  assert.ok(b.cut.some(c => c.at[0] === 24), 'the bank beside the pond is cut')
  assert.ok(b.dam.length > 0 && b.dam.every(d => d.at[0] === 25), JSON.stringify(b.dam.slice(0, 3)))
  for (const c of b.cut.filter(q => q.at[0] === 24)) { const d = b.dam.some(q => q.at.join(',') === `25,${c.at[1]},${c.at[2]}`) || b.fill.some(q => q.at.join(',') === `25,${c.at[1]},${c.at[2]}`); assert.ok(d, `the cut ${c.at} has its water dammed or filled`) }
  const c = TR.gradeTerraces(pond().read, BOX, { home: HOME, levels: [G, G + 1], water: 'owner-1101', farm: (x) => x === 25 })
  assert.ok(!c.cut.some(q => q.at[0] === 24 && q.at[1] > G + 1) || c.dam.length === 0, 'the farm\'s water is never dammed')
  assert.ok(!c.dam.length && !c.fill.some(q => q.at[0] === 25))
})
await t('MUTANT KILLED: without the dams the cut beside water carries none (the water would flow in)', async () => {
  await withMutant(TIDY_PATH, '    dams.push(at)\n', '\n', async M => {
    const srv = server(); srv.set([11, G, 0], 'water')
    assert.deepStrictEqual(M.cutWater(srv.read, 10, G, 0).dams, [])
  })
})
// THE FLOOD TEST: the fake server lets water flow into a cell dug beside it (4 sides, its height), and places into water
const floodVisit = async (RM, { rec, cuts, extra = {} }) => {
  const srv = server()
  for (const [k, v] of Object.entries(rec.world ?? {})) srv.set(k.split(',').map(Number), v)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tw-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 1)
  const e = bot(srv, 'A', { inv: { cobblestone: 32, dirt: 32 }, feet: [0, G + 1, 0] })
  const dig0 = e.dig
  e.dig = async (c, expect) => {
    const v = await dig0(c, expect)
    if (v === 'confirmed' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => srv.read(c[0] + dx, c[1], c[2] + dz)?.name === 'water')) srv.set(c, 'water')   // it floods
    return v
  }
  let held = null
  const hold0 = e.hold; e.hold = async n => { const ok = await hold0(n); if (ok) held = n; return ok }
  const send0 = e.send
  e.send = (support, face, seq) => { const tg = support.map((v, i) => v + face[i]); if (srv.read(...tg)?.name === 'water' && held) { srv.set(tg, 'air'); e.inv[held]++ } return send0(support, face, seq) }
  const r = await RM.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: cuts, recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 48, clearMax: 16, tidyKeepOrder: true, deferSpent: true, ...extra }, e, { maxSteps: 400 })
  return { r, srv }
}
const FLOOD = () => {
  // a bank column (10, z=0) at G+1 above flat ground, a pond cell beside it at (11, G+1, 0) held up by a wall of stone round it
  const world = { [`10,${G + 1},0`]: 'dirt', [`11,${G + 1},0`]: 'water', [`12,${G + 1},0`]: 'stone', [`11,${G + 1},1`]: 'stone', [`11,${G + 1},-1`]: 'stone' }
  return { v: 1, blueprint: T.TIDY_BLUEPRINT, plot: 'tidy', home: HOME, world, cells: [{ at: [11, G + 1, 0], role: 'core', seg: 'T-D', dam: true }], clear: [], cut: [{ at: [10, G + 1, 0], kind: 'tidy', name: 'dirt' }], replant: [], segments: [{ seg: 'T-D', deps: [] }], zones: [], structure_complete: false }
}
await t('THE FLOOD TEST: the dam goes into the water first and the cut comes out after it -- dry; the dig-time check holds a cut whose water is not dammed', async () => {
  const rec = FLOOD()
  const { r, srv } = await floodVisit(R, { rec, cuts: rec.cut, extra: { intoWater: true, tidyOk: (q, rd) => T.cutSafeNow(rd, q.at) } })
  assert.strictEqual(srv.read(11, G + 1, 0).name, 'cobblestone', `the dam: ${r.stop} ${r.why}`)
  assert.strictEqual(srv.read(10, G + 1, 0).name, 'air', 'the cut is out, and dry')
  // a cut whose water is not dammed (no dam in the record: water came since the siting) waits at the dig
  const rec2 = { ...FLOOD(), cells: [], segments: [] }
  const b = await floodVisit(R, { rec: rec2, cuts: rec2.cut, extra: { intoWater: true, tidyOk: (q, rd) => T.cutSafeNow(rd, q.at) } })
  assert.strictEqual(b.srv.read(10, G + 1, 0).name, 'dirt', 'held: never dug beside open water')
  assert.deepStrictEqual(b.r.tidyWet, [`10,${G + 1},0`])
})
async function withMutants (p, pairs, fn) {
  let src = readFileSync(p, 'utf8')
  for (const [old, neu] of pairs) { assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`); assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE'); src = src.replace(old, neu) }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
await t('MUTANT KILLED (the flood): without the dig-time checks (before the walk and after it) the cut comes out before its dam and the water floods in', async () => {
  await withMutants(BUILDRUN_PATH, [["        if (c.kind === 'tidy' && p.tidyOk && !p.tidyOk(c, rd)) { (out.tidyWet ??= []).push(kOf(c.at)); continue }\n", '\n'], ["    if (safe && !safe()) return 'unsafe'\n", '\n']], async RM => {
    const rec = FLOOD()
    const { srv } = await floodVisit(RM, { rec, cuts: rec.cut, extra: { intoWater: true, tidyOk: (q, rd) => T.cutSafeNow(rd, q.at) } })
    assert.strictEqual(srv.read(10, G + 1, 0).name, 'water', 'flooded')
  })
})
await t('MUTANT KILLED: without `intoWater` the dam cannot go into the water (the cut then waits for good, never floods)', async () => {
  await withMutant(BUILDRUN_PATH, " || (!!p.intoWater && /^(water|bubble_column)$/.test(nm(b)))) }", ') }', async RM => {
    const rec = FLOOD()
    const { srv } = await floodVisit(RM, { rec, cuts: rec.cut, extra: { intoWater: true, tidyOk: (q, rd) => T.cutSafeNow(rd, q.at) } })
    assert.strictEqual(srv.read(11, G + 1, 0).name, 'water'); assert.strictEqual(srv.read(10, G + 1, 0).name, 'dirt')
  })
})
await t('Codex water r1: water OVER a cut reads unsafe; water that comes DURING the walk to the dig holds the cut (re-checked after the walk)', async () => {
  const srv = server(); srv.set([10, G + 1, 0], 'water')
  assert.strictEqual(T.cutSafeNow(srv.read, [10, G, 0]), false)
  const rec = { ...FLOOD(), cells: [], segments: [], world: { [`10,${G + 1},0`]: 'dirt' } }
  const visit = async RM => {
    const srv2 = server()
    for (const [k, v] of Object.entries(rec.world)) srv2.set(k.split(',').map(Number), v)
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tw-'))
    const key = PJ.projKey(HOME, 'tidy')
    const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
    const slot = PJ.takeSlot(dir, key, 'A', 1)
    const e = bot(srv2, 'A', { inv: { cobblestone: 8 }, feet: [0, G + 1, 0] })
    const walk0 = e.walkTo
    e.walkTo = async (s0, o) => { const r = await walk0(s0, o); srv2.set([11, G + 1, 0], 'water'); return r }   // a stream breaks in while the bot walks
    const dig0 = e.dig
    e.dig = async (c, x) => { const v = await dig0(c, x); if (v === 'confirmed' && srv2.read(c[0] + 1, c[1], c[2])?.name === 'water') srv2.set(c, 'water'); return v }
    await RM.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: rec.cut, recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 48, clearMax: 16, tidyKeepOrder: true, intoWater: true, tidyOk: (q, rd) => T.cutSafeNow(rd, q.at) }, e, { maxSteps: 200 })
    return srv2.read(10, G + 1, 0).name
  }
  assert.strictEqual(await visit(R), 'dirt', 'held at the dig')
  await withMutant(BUILDRUN_PATH, "    if (safe && !safe()) return 'unsafe'\n", '\n', async RM => { assert.strictEqual(await visit(RM), 'water', 'MUTANT: dug after the walk, flooded') })
})
await t('Codex water r1: the router never routes a cut whose dam the earthwork would refuse (gradeLim takes the same waterOk); the terrace fills its pond edge', async () => {
  const srv = server(); srv.set([11, G, 0], 'water')
  assert.strictEqual(T.gradeLim(srv.read, 4, 'owner-1101').cutOk(null, 10, G, 0), false, 'no waterOk: no dam, no cut')
  assert.strictEqual(T.gradeLim(srv.read, 4, 'owner-1101', { waterOk: () => true }).cutOk(null, 10, G, 0), true)
  assert.strictEqual(T.gradeLim(srv.read, 4, 'owner-1101', { waterOk: () => false }).fillOk({ name: 'water', boundingBox: 'empty' }, 11, G, 0), false)
  const s2 = server()
  for (let x = 20; x <= 26; x++) for (let z = -3; z <= 3; z++) col(s2, x, z, G - 1, G, 'water')   // a pond 2 deep, surface G
  const gr = TR.gradeTerraces(s2.read, [14, -6, 30, 6], { home: HOME, levels: [G], water: 'owner-1101' })
  const wetFills = gr.fill.filter(f => s2.read(...f.at).name === 'water')
  assert.ok(wetFills.length > 0, `the pond's edge is filled (an embankment): ${JSON.stringify(gr.skipped)}`)
  assert.ok(wetFills.every(f => f.at[0] === 20 || f.at[0] === 26 || f.at[2] === 3 || f.at[2] === -3), 'only its edge ring')
  // a shallow pond on HIGH ground the terrace lowers: its edge is never cut under the water (Claude water r1 BLOCKER)
  const s4 = server()
  plateau(s4, 14, 30, -6, 6, G + 3)
  for (let x = 20; x <= 26; x++) for (let z = -3; z <= 3; z++) s4.set([x, G + 3, z], 'water')
  const g4 = TR.gradeTerraces(s4.read, [12, -8, 32, 8], { home: HOME, levels: [G, G + 1], water: 'owner-1101' })
  assert.ok(!g4.cut.some(c => s4.read(c.at[0], c.at[1] + 1, c.at[2])?.name === 'water'), 'a cut under water')
})
await t('roadWork under the rule: a cut beside water carries its dam; a road column of shallow open water is an embankment from its bed', async () => {
  const srv = server()
  col(srv, 30, 0, G + 1, G + 1, 'dirt'); srv.set([31, G + 1, 0], 'water')
  col(srv, 30, 5, G - 1, G, 'water')
  const lim = { ...T.gradeLim(srv.read, 6, 'owner-1101', { waterOk: () => true }), water: 'owner-1101' }
  const r = T.roadWork(srv.read, [[30, 0, G], [30, 5, G]], { home: HOME, lim, waterOk: () => true })
  assert.ok(r.cut.some(c => c.at.join(',') === `30,${G + 1},0`) && r.fill.some(f => f.dam && f.at.join(',') === `31,${G + 1},0`), JSON.stringify(r))
  assert.deepStrictEqual(r.fill.filter(f => f.at[0] === 30 && f.at[2] === 5).map(f => f.at[1]).sort(), [G - 1, G])
  const st = T.roadWork(srv.read, [[30, 0, G], [30, 5, G]], { home: HOME, lim: { ...T.gradeLim(srv.read, 6, 'strict'), water: 'strict' } })
  assert.ok(st.skipped.road_wet === 1 && st.skipped.road_water === 1, JSON.stringify(st.skipped))
})
await t('WIRING: buildTidy passes intoWater and the dig-time check; siteStage reads the rule (TIDY_WATER=strict: the old refusal)', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/\.\.\.\(GROUNDS\.on \? \{ intoWater: tidyWater\(\) !== 'strict', tidyOk: \(q, rd\) => cutSafeNow\(rd, q\.at, tidyWater\(\)\) \} : \{\}\)/.test(s))
  const srv = server()
  col(srv, 10, 0, G - 2, G, 'air'); col(srv, 11, 0, G - 1, G, 'water'); col(srv, 11, 1, G - 1, G, 'water'); col(srv, 11, -1, G - 1, G, 'water')
  const on = await T.siteStage(srv.read, { home: HOME, land: null, stage: 0, now: 0, env: {} })
  const off = await T.siteStage(srv.read, { home: HOME, land: null, stage: 0, now: 0, env: { TIDY_WATER: 'strict' } })
  const has = r => (r.record?.cells ?? []).some(c => c.at[0] === 10 && c.at[2] === 0)
  assert.ok(has(on) && !has(off))
})
console.log('THE RING ORDER AND THE LAND PLAN')
await t('the terrace is stage 1, right after the plaza; the roads follow it', async () => {
  const st = LP.landStages()
  assert.deepStrictEqual(st.slice(0, 3).map(s => s.id), ['town', 'terrace', 'roads'])
  assert.strictEqual(LP.nextStage(0).id, 'terrace'); assert.strictEqual(LP.nextStage(1).id, 'roads')
  assert.deepStrictEqual(LP.stageRoadCols({ home: HOME, roads: [{ kind: 'ring', cols: [[25, 0, G]] }] }, st[1]), [], 'the terrace grades no road')
})
await t('recStageK: a record by its stage id; an old record past stage 0 (no terraceV) reads 0 so the terrace comes next', async () => {
  assert.strictEqual(LP.recStageK({ stage: 1, stageId: 'roads' }), 0, 'groundskeeper-01\'s stage 1 roads: terrace next')
  assert.strictEqual(LP.recStageK({ stage: 2, stageId: 'roads', terraceV: 1 }), 2)
  assert.strictEqual(LP.recStageK({ stage: 1, stageId: 'terrace', terraceV: 1 }), 1)
  assert.strictEqual(LP.recStageK({ stage: 0 }), 0)
  assert.strictEqual(LP.recStageK({ stage: 3, terraceV: 1 }), 3)
  assert.strictEqual(LP.nextStage(LP.recStageK({ stage: 1, stageId: 'roads' })).id, 'terrace')
})
await t('the park is a land-plan reservation; siteStage sites the terrace (awaited) and TERRACE=off reads nothing to do', async () => {
  const r = LP.landReservation({ corridors: [], park: { box: [10, -5, 20, 5] } })
  assert.deepStrictEqual(r.zones, [{ box: [10, -64, -5, 20, 320, 5], why: 'land:park' }])
  const srv = server()
  col(srv, 12, 0, G + 1, G + 4, 'oak_log')
  const on = await T.siteStage(srv.read, { home: HOME, land: LAND(), stage: 1, terrace: { records: [] }, now: 0 })
  assert.ok(on.record && on.record.stageId === 'terrace' && on.record.stage === 0 && on.record.terraceV === 1, on.why)
  assert.strictEqual(LP.recStageK(on.record), 1)
  const off = await T.siteStage(srv.read, { home: HOME, land: LAND(), stage: 1, terrace: { records: [] }, env: { TERRACE: 'off' }, now: 0 })
  assert.strictEqual(off.record, null)
})

console.log('WIRING (structural)')
await t('buildTidy: the terrace inputs, the work-time guard, the skip rule, the tool uses and the park\'s bill are wired', async () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  assert.ok(/const terrace = \{ records: I\.records, wall: I\.wall, caps: I\.caps, have, pause:/.test(s), 'the terrace inputs')
  assert.ok(/s = await siteStage\(read, \{ home: I\.home, avoid: I\.avoid, cells: I\.cells, pin: I\.pin, plan: I\.plan, land, stage: k, lim: gradeLim\(read, 6\), lights, now: Date\.now\(\), walkFrom: townEdge\(I\.plan, I\.home\), terrace \}\)/.test(s), 'siteStage gets them')
  // siteprep-01: nor a requested plot's prep cell (the keeper's own work in its own reservation)
  assert.ok(/\|\| \(isTerrace && !q\.floorFix && !q\.prep && !!guardNow\(q\.at\[0\], q\.at\[2\]\)\)\n/.test(s), 'the work-time guard waives (gkhelpers-01: never a storehouse floor repair; siteprep-01: never a prep cell)')
  assert.ok(/alsoDone: q => waivedK\(q\) \|\| noTorch\(q\) \|\| !!skipV\(q\)/.test(s), 'the skip rule')
  assert.ok(/useFor: q => \(q\.role === 'till' \? hoeUse : q\.role === 'meadow' \? mealUse : null\), openRole: role => OPEN_ROLES\.has\(role\)/.test(s), 'the tool uses')
  assert.ok(/Object\.assign\(extra, parkBill\(rec, read, \{ held: held0, stock: matsTownStock\(bot\)\?\.stock \?\? \{\}/.test(s), 'the park\'s bill')
  assert.ok(/nextStageCycle\(rh\.head\.rec\)/.test(s) && /return nextStageCycle\(r, now\) != null/.test(s), 'the ring order reads recStageK (gkstage-01: through landplan.mjs nextStageCycle, which reads it)')
  const lp = strip(readFileSync(LAND_PATH, 'utf8'))
  assert.ok(/zones: \[\.\.\.\(land\.corridors \?\? \[\]\), \.\.\.parkZones\(land\)\]/.test(lp), 'the park reservation')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
