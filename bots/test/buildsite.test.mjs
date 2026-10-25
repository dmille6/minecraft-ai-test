// SHOP-01 STEP 1, THE SITING PLANNER (bots/src/buildsite.mjs): the workshop@1 blueprint, the screen's refusals, the floor-level
// search, the tree and replant rules, the placement proof, and D1 (a free sector when the pavilion is unsited). Design
// docs/reports/building-tier-2026-10-23.md sections 4.1-4.3 and 4.6.
//
// Behaviour over pure reads (a fake `read(x, y, z)`: stone below G, grass at G, air above, cells set by name, boxes from
// minecraft-data 1.21.8). Every refusal has its positive control (the same instrument seeing the thing), and the proof is shown to
// FAIL when the site cannot be reached (a moat around the plaza) -- a proof that cannot fail is not one. Then anchored mutants.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const B = await import('../src/buildsite.mjs')
const BS_PATH = new URL('../src/buildsite.mjs', import.meta.url)
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
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/").replace("new URL('.', import.meta.url)", "new URL('../src/', import.meta.url)"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
async function killedBy (fn) { try { await fn(); return false } catch { return true } }

const G = 69
const HOME = { x: 0, y: G + 1, z: 0 }
const box = n => mcData.blocksByName[n]?.boundingBox ?? 'block'
/** A fake world: stone below G, grass at G, air above; `cells` "x,y,z" -> name; unknown beyond +-60. */
function world (cells = {}) {
  return (x, y, z) => {
    if (Math.abs(x) > 60 || Math.abs(z) > 60 || y < G - 20 || y > G + 40) return null
    const n = cells[`${x},${y},${z}`] ?? (y < G ? 'stone' : y === G ? 'grass_block' : 'air')
    return { name: n, boundingBox: box(n) }
  }
}
const SECTORS = { gate: 'S', shaft: 'SW', monument: 'NW', well: 'W', farm: 'N' }
/** A frozen plan: the plaza, the outer plots' sectors (the pavilion's unless `pavilion` null), optional paths and plots. */
function plan ({ pavilion = 'E', paths = [], plots = [], taken = SECTORS } = {}) {
  return {
    v: 1, template: 'ring@1', gen: 3, prev: 2, home: HOME, s: G, mode: 'retrofit', at: 1, world: 'w',
    plots: [
      { id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], y: G, state: 'existing', keepout: false },
      ...Object.entries(taken).map(([id, sector]) => ({ id, kind: id, sector, state: 'planned' })),
      { id: 'pavilion', kind: 'pavilion', sector: pavilion, state: pavilion ? 'planned' : 'unsited' },
      { id: 'hall', kind: 'hall', sector: null, state: 'unsited' },
      ...plots,
    ],
    paths, groups: {}, transitions: [],
  }
}
const BP = B.loadBlueprint('workshop@1')
const flat = world()
// one site on flat ground, shared by the tests that only read it (the full search is ~1 s)
const FLAT = B.siteBlueprint(flat, plan(), BP, { tries: 3 })

console.log('THE BLUEPRINT')
await t('workshop@1 is the design\'s 167 placements: pad 63, ring 26, walls 38 (34 + 4 panes), roof 35 (20 trim + 15), fit-out 5', () => {
  const by = (k) => BP.cells.reduce((m, c) => { m[c[k]] = (m[c[k]] ?? 0) + 1; return m }, {})
  assert.strictEqual(BP.cells.length, 167)
  assert.deepStrictEqual(by('role'), { base: 63, step: 26, wall: 34, window: 4, trim: 20, roof: 15, light: 2, furnace: 2, table: 1 })
  const seg = by('seg')
  assert.strictEqual(seg.pad, 63); assert.strictEqual(seg.ring, 26); assert.strictEqual(seg['roof-edge'], 20); assert.strictEqual(seg['roof-inner'], 15); assert.strictEqual(seg['fit-out'], 5)
  assert.strictEqual(seg['wall-F'] + seg['wall-B'] + seg['wall-L'] + seg['wall-R'], 38)
})
await t('the doorway (u 4, v 1) is open at both levels; the ring has its two gaps; no cell twice', () => {
  const at = new Set(BP.cells.map(c => `${c.u},${c.v},${c.y}`))
  assert.strictEqual(at.size, 167)
  for (const [u, v, y] of BP.doorway) assert.ok(!at.has(`${u},${v},${y}`), `doorway ${u},${v},${y} is open`)
  assert.ok(!at.has('4,0,1') && !at.has('4,6,1'), 'the ring gaps')
  assert.ok(at.has('3,0,1') && at.has('5,0,1'), 'the ring either side of the front gap (positive control)')
})
await t('every segment dependency names a segment that comes earlier', () => {
  const seen = new Set()
  for (const s of BP.segments) { for (const d of s.deps) assert.ok(seen.has(d), `${s.seg} depends on ${d}`); seen.add(s.seg) }
})

console.log('THE SITE ON FLAT GROUND')
await t('flat ground in the pavilion sector E: a proven site, no earthwork, no trees, the interior reached through the doorway', () => {
  assert.ok(FLAT.ok, JSON.stringify(FLAT.sectors))
  const r = FLAT.record
  assert.strictEqual(r.sector, 'E'); assert.strictEqual(r.sector_source, 'pavilion')
  assert.deepStrictEqual(r.earthwork, { fill: 0, cut: 0, litter: 0 })
  assert.strictEqual(r.cells.length, 167); assert.strictEqual(r.s, G + 1)
  assert.ok(r.interior.reachable >= 12, JSON.stringify(r.interior))
  assert.deepStrictEqual(r.bom, { stone_bricks: 89, $planks: 49, glass_pane: 4, cut_copper: 20, torch: 2, furnace: 2, crafting_table: 1 })
})
await t('every cell and stand is in the domain (Chebyshev >= 22, line <= 44); every face within 4.5 of its stand\'s eye', () => {
  for (const c of FLAT.record.cells) {
    for (const [x, z] of [[c.at[0], c.at[2]], [c.stand[0], c.stand[2]]]) assert.ok(B.inDomain(HOME, x, z), `${x},${z}`)
    const fc = c.support.map((v, i) => v + 0.5 + c.face[i] * 0.5)
    const eye = [c.stand[0] + 0.5, c.stand[1] + 1.62, c.stand[2] + 0.5]
    assert.ok(Math.hypot(...eye.map((v, i) => v - fc[i])) <= 4.5 + 1e-9)
    assert.ok(!(c.stand[0] === c.at[0] && c.stand[2] === c.at[2] && (c.stand[1] === c.at[1] || c.stand[1] + 1 === c.at[1])), 'never stands in its own cell')
  }
})
await t('the doorway faces home: the front\'s outward normal is the cardinal from the door toward home', () => {
  const r = FLAT.record
  assert.ok(B.facesHome(BP, HOME, { x: r.anchor[0], z: r.anchor[1] }, r.orient))
  const turned = { E: 'W', W: 'E', N: 'S', S: 'N' }[r.orient]
  assert.ok(!B.facesHome(BP, HOME, { x: r.anchor[0], z: r.anchor[1] }, turned), 'the opposite orientation at the same anchor does not (positive control)')
})
await t('placement order: pad before ring before walls before the roof edge before the inner roof before the fit-out', () => {
  const first = {}, last = {}
  for (const c of FLAT.record.cells) { first[c.seg] ??= c.order; last[c.seg] = c.order }
  for (const [a, b] of [['pad', 'ring'], ['ring', 'roof-edge'], ['wall-F', 'roof-edge'], ['roof-edge', 'roof-inner'], ['roof-inner', 'fit-out']]) assert.ok(last[a] < first[b], `${a} before ${b}`)
})

console.log('THE PROOF CAN FAIL')
await t('A MOAT around the plaza (11 deep): every candidate screens, none is walked to -> no_proven_site, no_step', () => {
  const cells = {}
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) {
    const d = Math.max(Math.abs(x), Math.abs(z))
    if (d >= 12 && d <= 14) for (let y = G - 10; y <= G; y++) cells[`${x},${y},${z}`] = 'air'
  }
  const r = B.siteBlueprint(world(cells), plan(), BP, { tries: 3 })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.why, 'no_proven_site')
  assert.ok(r.sectors[0].screened > 0, 'the screen still passes (the moat is not in the domain)')
  assert.strictEqual(r.sectors[0].proofFails.no_step, 3)
})
await t('a 1-wide moat is stepped over? no: a bot does not jump in this proxy; a moat of 1 CELL DEEP is walked through (positive control)', () => {
  const cells = {}
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) {
    const d = Math.max(Math.abs(x), Math.abs(z))
    if (d === 12) cells[`${x},${G},${z}`] = 'air'   // a ditch 1 deep: down 1, up 1
  }
  const r = B.siteBlueprint(world(cells), plan(), BP, { tries: 3 })
  assert.ok(r.ok, JSON.stringify(r.sectors))
})

console.log('THE SCREEN\'S REFUSALS (each with its positive control)')
const RES = B.reservations(plan(), {})
const A = { x: FLAT.record.anchor[0], z: FLAT.record.anchor[1] }, O = FLAT.record.orient
const T = await import('../src/townplan.mjs')
/** The world cell of local (u, v) at pad level + dy for the flat site's anchor and orientation (any cell, built or not). */
const cellOf = (u, v, dy) => { const { dx, dz } = T.rot(O, u, v); return [A.x + dx, G + 1 + dy, A.z + dz] }
/** A pad with a 1-deep dip under its first `n` columns and a 1-high bump (dirt) on the rest: EVERY level costs >= min(n, 63 - n). */
function dipBump (n) {
  const pad = B.footprint(BP, A, O).pad, c = {}
  pad.forEach(([x, z], i) => { if (i < n) c[`${x},${G},${z}`] = 'air'; else c[`${x},${G + 1},${z}`] = 'dirt' })
  return c
}
await t('the flat site\'s own anchor screens ok (the control for the refusals below)', () => {
  assert.strictEqual(B.screenSite(flat, HOME, BP, A, O, RES, { sector: 'E' }).why, 'ok')
})
await t('a chest in the volume refuses the site (built_in_volume)', () => {
  const [x, y, z] = cellOf(4, 3, 1)
  assert.strictEqual(B.screenSite(world({ [`${x},${y},${z}`]: 'chest' }), HOME, BP, A, O, RES, { sector: 'E' }).why, 'built_in_volume')
})
await t('water in the volume refuses the site (liquid)', () => {
  const [x, , z] = cellOf(4, 3, 1)
  assert.strictEqual(B.screenSite(world({ [`${x},${G},${z}`]: 'water' }), HOME, BP, A, O, RES, { sector: 'E' }).why, 'liquid')
})
await t('a hole 4 deep under one pad cell at every level -> fill_too_deep; 3 deep is a fill of 3 (positive control)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const hole = n => { const c = {}; for (let y = G - n + 1; y <= G; y++) c[`${x},${y},${z}`] = 'air'; return c }
  const deep = B.screenSite(world(hole(4)), HOME, BP, A, O, RES, { sector: 'E' })
  // the level search may lower the pad to the hole's floor; then every other column is cut by up to 3 -- refused either way
  assert.ok(['fill_too_deep', 'cut_too_high', 'earthwork'].includes(deep.why), deep.why)
  const ok = B.screenSite(world(hole(3)), HOME, BP, A, O, RES, { sector: 'E' })
  assert.strictEqual(ok.why, 'ok'); assert.strictEqual(ok.fill.length, 3)
})
await t('EARTHWORK: a dip under 41 columns and a bump on 22 costs >= 63 at every level -> earthwork; a dip under 63 costs 0 one lower (control)', () => {
  // at the ground level: fill 41 + cut 22; one lower: cut 22 x 2 + 41; one higher: fill 41 x 2 + 22. All over 40
  assert.strictEqual(B.screenSite(world(dipBump(41)), HOME, BP, A, O, RES, { sector: 'E' }).why, 'earthwork')
  const low = B.screenSite(world(dipBump(63)), HOME, BP, A, O, RES, { sector: 'E' })
  assert.strictEqual(low.why, 'ok'); assert.strictEqual(low.g0, G - 1); assert.strictEqual(low.fill.length + low.cut.length, 0)
})
await t('a floating scaffold block in the volume is a scaffold clear (litter), never ground or a cut', () => {
  const [x, , z] = cellOf(2, 2, 0)
  const r = B.screenSite(world({ [`${x},${G + 2},${z}`]: 'cobblestone' }), HOME, BP, A, O, RES, { sector: 'E' })
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.litter, 1); assert.strictEqual(r.cut.length, 0)
  assert.ok(r.clear.some(c => c.kind === 'scaffold' && c.at[1] === G + 2))
})
await t('a natural block standing on the ground in the volume is a cut (positive control for the litter rule)', () => {
  const [x, , z] = cellOf(2, 2, 0)
  const r = B.screenSite(world({ [`${x},${G + 1},${z}`]: 'dirt' }), HOME, BP, A, O, RES, { sector: 'E' })
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.cut.length, 1)
})
await t('a plan path segment through the site refuses it (plan_path_or_keepout)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const res = B.reservations(plan({ paths: [{ id: 'p', seg: [x, z, x, z] }] }), {})
  assert.strictEqual(B.screenSite(flat, HOME, BP, A, O, res, { sector: 'E' }).why, 'plan_path_or_keepout')
})
await t('a protected zone over the site refuses it; a plinth well within 3, a tree-farm cell within 2, the Z0 apron and the M0 collar too', () => {
  const [x, , z] = cellOf(4, 3, 0)
  assert.strictEqual(B.screenSite(flat, HOME, BP, A, O, B.reservations(plan(), { zones: [{ id: 'z', box: [x, 0, z, x, 100, z] }] }), { sector: 'E' }).why, 'zone')
  assert.strictEqual(B.screenSite(flat, HOME, BP, A, O, B.reservations(plan(), { wells: [[x + 3, G, z]] }), { sector: 'E' }).why, 'well')
  assert.strictEqual(B.screenSite(flat, HOME, BP, A, O, B.reservations(plan(), { farm: [[x, z]] }), { sector: 'E' }).why, 'treefarm')
  assert.strictEqual(B.screenSite(flat, HOME, BP, A, O, B.reservations(plan(), { z0: { centre: { x: x + 30, z } } }), { sector: 'E' }).why, 'z0_apron')
  assert.strictEqual(B.screenSite(flat, HOME, BP, A, O, B.reservations(plan(), { m0: { origin: { x: x + 8, z } } }), { sector: 'E' }).why, 'm0_collar')
  assert.strictEqual(B.screenSite(flat, HOME, BP, A, O, B.reservations(plan(), { wells: [[x + 20, G, z]] }), { sector: 'E' }).why, 'ok', 'a well far away (positive control)')
})
await t('outside the pavilion\'s sector the screen refuses (sector); the domain refuses a pad inside Chebyshev 22', () => {
  assert.strictEqual(B.screenSite(flat, HOME, BP, A, O, RES, { sector: 'N' }).why, 'sector')
  assert.strictEqual(B.screenSite(flat, HOME, BP, { x: 10, z: -3 }, O, RES, { sector: 'E' }).why, 'domain')
})

console.log('TREES AND REPLANT')
// an oak 5 logs high on the pad's middle column, a leaf crown on top
function oakAt (x, z, cells = {}, species = 'oak') {
  for (let y = G + 1; y <= G + 5; y++) cells[`${x},${y},${z}`] = `${species}_log`
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) cells[`${x + dx},${G + 6},${z + dz}`] = `${species}_leaves`
  return cells
}
await t('an oak in the volume: felled whole (5 logs), one replant cell reserved 8-24 out, pending, an oak sapling', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const r = B.screenSite(world(oakAt(x, z)), HOME, BP, A, O, RES, { sector: 'E' })
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.trees.length, 1); assert.strictEqual(r.trees[0].logs, 5)
  const site = B.siteBlueprint(world(oakAt(x, z)), plan(), BP, { tries: 3 })
  assert.ok(site.ok)
  // the chosen site may avoid the tree (fewest trees first); force the test on the screened candidate's replant
  const rp = B.replantFor(world(oakAt(x, z)), HOME, r, RES, B.walkFrom(world(oakAt(x, z)), HOME))
  assert.ok(rp.ok); assert.strictEqual(rp.cells.length, 1)
  assert.strictEqual(rp.cells[0].sapling, 'oak_sapling'); assert.strictEqual(rp.cells[0].state, 'pending')
  const xs = r.pad.map(c => c[0]), zs = r.pad.map(c => c[1])
  const [cx, , cz] = rp.cells[0].cell
  const d = Math.max(Math.min(...xs) - cx, cx - Math.max(...xs), Math.min(...zs) - cz, cz - Math.max(...zs), 0)
  assert.ok(d >= 8 && d <= 24, `replant at ${d}`)
})
await t('no soil within 8-24 (stone ground around the site) -> no replant cell; with soil -> one (the control above)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const cells = oakAt(x, z)
  for (let a = -60; a <= 60; a++) for (let b = -60; b <= 60; b++) if (!cells[`${a},${G},${b}`]) cells[`${a},${G},${b}`] = 'stone'
  const r = B.screenSite(world(cells), HOME, BP, A, O, RES, { sector: 'E' })
  assert.strictEqual(r.why, 'ok')
  const rp = B.replantFor(world(cells), HOME, r, RES, B.walkFrom(world(cells), HOME))
  assert.strictEqual(rp.ok, false)
})
await t('a 2x2 trunk refuses the site (tree_2x2); a dark oak does too', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const two = oakAt(x, z, oakAt(x + 1, z, oakAt(x, z + 1, oakAt(x + 1, z + 1))))
  assert.strictEqual(B.screenSite(world(two), HOME, BP, A, O, RES, { sector: 'E' }).why, 'tree_2x2')
  assert.strictEqual(B.screenSite(world(oakAt(x, z, {}, 'dark_oak')), HOME, BP, A, O, RES, { sector: 'E' }).why, 'tree_2x2')
})
await t('a tree too tall to reach from the ground (a log above s + 6) refuses the site', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const cells = {}
  for (let y = G + 1; y <= G + 9; y++) cells[`${x},${y},${z}`] = 'oak_log'
  assert.strictEqual(B.screenSite(world(cells), HOME, BP, A, O, RES, { sector: 'E' }).why, 'tree_out_of_reach')
})

console.log('THE STEP AND THE WALK')
await t('stepFor: a torch never hangs from the face above; a wall block may (positive control)', () => {
  // a cell at (30, G+3, 0) with only a solid above it, a stand beside it on the ground
  const cells = { [`30,${G + 4},0`]: 'stone' }
  const read = world(cells)
  const nodes = new Map([['31,0', [G + 1]]])
  assert.strictEqual(B.stepFor(read, HOME, [30, G + 3, 0], nodes, { role: 'light' }), null)
  const s = B.stepFor(read, HOME, [30, G + 3, 0], nodes, { role: 'wall' })
  assert.ok(s); assert.deepStrictEqual(s.face, [0, -1, 0])
})
await t('stepFor: a solid between eye and face blocks the step (sight line); without it the step exists', () => {
  // the cell (30, G+1, 0) on the ground; one stand at (33, G+1, 0) three east; a wall at (32, G+2, 0) and (32, G+1, 0)
  const nodes = new Map([['33,0', [G + 1]]])
  assert.ok(B.stepFor(flat, HOME, [30, G + 1, 0], nodes), 'open: a step')
  const read = world({ [`32,${G + 1},0`]: 'stone', [`32,${G + 2},0`]: 'stone', [`32,${G + 3},0`]: 'stone', [`31,${G + 1},0`]: 'stone', [`31,${G + 2},0`]: 'stone' })
  assert.strictEqual(B.stepFor(read, HOME, [30, G + 1, 0], nodes), null)
})
await t('walkFrom: a cell still to be placed is never a floor (a stand may not rely on a block that is not there yet)', () => {
  // a 1-cell gap in the ground at (30, G, 0) bridged only by a planned cell: the far side is not reached across it
  const cells = {}
  for (let z = -60; z <= 60; z++) for (let y = G - 20; y <= G; y++) cells[`30,${y},${z}`] = 'air'
  const read = world(cells)
  const w0 = B.walkFrom(read, HOME)
  assert.ok(!w0.has(`31,${G + 1},0`), 'the far side is cut off by the gap')
  const over = B.overlay(read, new Map([[`30,${G},0`, { name: 'cobblestone', boundingBox: 'block' }]]))
  assert.ok(B.walkFrom(over, HOME).has(`31,${G + 1},0`), 'a PLACED bridge is walked over (positive control)')
  assert.ok(!B.walkFrom(over, HOME, new Set([`30,${G},0`])).has(`31,${G + 1},0`), 'a bridge still to be placed is not')
})
await t('walkFrom seeds the whole plaza: home\'s own cell boxed in (a block over its head) still walks out', () => {
  const read = world({ [`0,${G + 2},0`]: 'diorite', [`1,${G + 1},0`]: 'stone', [`-1,${G + 1},0`]: 'stone', [`0,${G + 1},1`]: 'stone', [`0,${G + 1},-1`]: 'stone' })
  assert.ok(B.walkFrom(read, HOME).has(`30,${G + 1},0`))
})

console.log('D1: THE SECTOR WHEN THE PAVILION IS UNSITED')
await t('pavilion sited -> only its sector; unsited -> every sector no other outer plot holds, in ring@1 order', () => {
  assert.deepStrictEqual(B.workshopSectors(plan()), [{ sector: 'E', source: 'pavilion' }])
  assert.deepStrictEqual(B.workshopSectors(plan({ pavilion: null })).map(s => s.sector), ['E', 'NE', 'SE'])
  assert.deepStrictEqual(B.workshopSectors(plan({ pavilion: null, taken: { ...SECTORS, a: 'E', b: 'NE', c: 'SE' } })), [])
})
await t('unsited pavilion on flat ground: the site lands in the first free sector (E), source free', () => {
  const r = B.siteBlueprint(flat, plan({ pavilion: null }), BP, { tries: 2 })
  assert.ok(r.ok); assert.strictEqual(r.record.sector, 'E'); assert.strictEqual(r.record.sector_source, 'free')
})
await t('every sector taken -> no_free_sector', () => {
  assert.strictEqual(B.siteBlueprint(flat, plan({ pavilion: null, taken: { ...SECTORS, a: 'E', b: 'NE', c: 'SE' } }), BP).why, 'no_free_sector')
})

console.log('MUTANTS (anchored, unique)')
await t('MUTANT reach check removed in stepFor -> the reach test fails', async () => {
  const killed = await withMutant(BS_PATH, 'if (d > REACH || d >= bd) continue', 'if (d >= bd) continue', async M => killedBy(() => {
    const nodes = new Map([['35,0', [G + 1]]])
    assert.strictEqual(M.stepFor(flat, HOME, [30, G + 1, 0], nodes), null, 'a face 5 away is out of reach')
  }))
  assert.ok(killed)
  assert.strictEqual(B.stepFor(flat, HOME, [30, G + 1, 0], new Map([['35,0', [G + 1]]])), null, 'the real code refuses it')
})
await t('MUTANT the floor rule in walkFrom dropped -> the bridge-to-be test fails', async () => {
  const killed = await withMutant(BS_PATH, 'if (block.has(k3(x, y, z)) || block.has(k3(x, y + 1, z)) || block.has(k3(x, y - 1, z))) return false', 'if (block.has(k3(x, y, z)) || block.has(k3(x, y + 1, z))) return false', async M => killedBy(() => {
    const cells = {}
    for (let z = -60; z <= 60; z++) for (let y = G - 20; y <= G; y++) cells[`30,${y},${z}`] = 'air'
    const over = M.overlay(world(cells), new Map([[`30,${G},0`, { name: 'cobblestone', boundingBox: 'block' }]]))
    assert.ok(!M.walkFrom(over, HOME, new Set([`30,${G},0`])).has(`31,${G + 1},0`))
  }))
  assert.ok(killed)
})
await t('MUTANT the earthwork total ignored -> a fill over 40 passes', async () => {
  const killed = await withMutant(BS_PATH, 'if (fill > EARTH.fill || cut > EARTH.cut || litter > LITTER_MAX) {', 'if (false) {', async M => killedBy(() => {
    assert.strictEqual(M.screenSite(world(dipBump(41)), HOME, BP, A, O, M.reservations(plan(), {}), { sector: 'E' }).why, 'earthwork')
  }))
  assert.ok(killed)
})
await t('MUTANT the replant gate dropped in siteBlueprint -> a felled tree with no replant cell is sited', async () => {
  const killed = await withMutant(BS_PATH, "if (!rp.ok) { proofFails.no_replant_cell = (proofFails.no_replant_cell ?? 0) + 1; continue }", '', async M => killedBy(() => {
    // trees everywhere in the E sector's band and stone ground: every candidate fells a tree, none can be replanted
    const cells = {}
    for (let a = -60; a <= 60; a++) for (let b = -60; b <= 60; b++) cells[`${a},${G},${b}`] = 'stone'
    for (let a = 20; a <= 46; a += 3) for (let b = -20; b <= 20; b += 3) oakAt(a, b, cells)
    const r = M.siteBlueprint(world(cells), plan(), BP, { tries: 2 })
    assert.ok(!r.ok || r.record.trees.length === 0 || r.record.replant.length === r.record.trees.length)
  }))
  assert.ok(killed)
})
await t('MUTANT D1 gone (an unsited pavilion means no sector) -> the unsited test fails', async () => {
  const killed = await withMutant(BS_PATH, "return REST_ORDER.filter(s => !taken.has(s)).map(s => ({ sector: s, source: 'free' }))", 'return []', async M => killedBy(() => {
    assert.ok(M.workshopSectors(plan({ pavilion: null })).length > 0)
  }))
  assert.ok(killed)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
