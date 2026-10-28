// SHOP-01 STEP 1, THE SITING PLANNER (bots/src/buildsite.mjs, bots/scripts/buildsite-offline.mjs): the workshop@1 blueprint,
// the screen's refusals, the floor-level search, the tree and replant rules, the placement proof, the walk's town seeds, D1 (a
// free sector when the pavilion is unsited), and the runner's record reading. Design docs/reports/building-tier-2026-10-23.md
// sections 4.1-4.3 and 4.6; run report docs/reports/shop-01-siting-2026-10-25.md.
//
// Behaviour over pure reads (a fake `read(x, y, z)`: stone below G, grass at G, air above, cells set by name, boxes from
// minecraft-data 1.21.8). Every refusal has its positive control (the same instrument seeing the thing), the proof is shown to
// FAIL when the site cannot be reached (moats, a fence ring), and every mutant is checked both ways: the real code passes the
// scenario and the mutant fails it (an anchored, unique mutation, or the test refuses to count it).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const B = await import('../src/buildsite.mjs')
const T = await import('../src/townplan.mjs')
const RUN = await import('../scripts/buildsite-offline.mjs')
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
/** BOTH WAYS: the scenario passes on the real module, and throws on the mutant. */
async function mutantKilled (old, neu, scenario) {
  await scenario(B)
  let killed = false
  await withMutant(BS_PATH, old, neu, async M => { try { await scenario(M) } catch { killed = true } })
  assert.ok(killed, 'the mutant survived its scenario')
}

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
/** A ring of cells at Chebyshev radii r0..r1, y0..y1, set to `name`. */
function ring (cells, r0, r1, y0, y1, name) {
  for (let x = -r1; x <= r1; x++) for (let z = -r1; z <= r1; z++) {
    const d = Math.max(Math.abs(x), Math.abs(z))
    if (d >= r0 && d <= r1) for (let y = y0; y <= y1; y++) cells[`${x},${y},${z}`] = name
  }
  return cells
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
// one site on flat ground, shared by the tests that only read it
const FLAT = B.siteBlueprint(flat, plan(), BP, { tries: 3 })
const RES = B.reservations(plan(), {})
const A = { x: FLAT.record.anchor[0], z: FLAT.record.anchor[1] }, O = FLAT.record.orient
/** The world cell of local (u, v) at pad level + dy for the flat site's anchor and orientation (any cell, built or not). */
const cellOf = (u, v, dy) => { const { dx, dz } = T.rot(O, u, v); return [A.x + dx, G + 1 + dy, A.z + dz] }
const screen = (read, res = RES) => B.screenSite(read, HOME, BP, A, O, res, { sector: 'E' })
/** A pad with a 1-deep dip under its first `n` columns and a 1-high bump (dirt) on the rest: EVERY level costs >= min(n, 63 - n). */
function dipBump (n) {
  const pad = B.footprint(BP, A, O).pad, c = {}
  pad.forEach(([x, z], i) => { if (i < n) c[`${x},${G},${z}`] = 'air'; else c[`${x},${G + 1},${z}`] = 'dirt' })
  return c
}
/** An oak 5 logs high from the ground at (x, z), a leaf crown on top. */
function oakAt (x, z, cells = {}, species = 'oak') {
  for (let y = G + 1; y <= G + 5; y++) cells[`${x},${y},${z}`] = `${species}_log`
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) cells[`${x + dx},${G + 6},${z + dz}`] = `${species}_leaves`
  return cells
}

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
await t('flat ground in the pavilion sector E: proven, no earthwork, no trees, EVERY open interior cell (12 of 15) walked to', () => {
  assert.ok(FLAT.ok, JSON.stringify(FLAT.sectors))
  const r = FLAT.record
  assert.strictEqual(r.sector, 'E'); assert.strictEqual(r.sector_source, 'pavilion'); assert.strictEqual(r.plot, 'shop')
  assert.deepStrictEqual(r.earthwork, { fill: 0, cut: 0, litter: 0 })
  assert.strictEqual(r.cells.length, 167); assert.strictEqual(r.s, G + 1)
  assert.deepStrictEqual(r.interior, { cells: 15, open: 12, reachable: 12 })
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
await t('NO click on a block the click would open, NO click on the face above (builder.mjs refUsable / supportsFor)', () => {
  const role = new Map(FLAT.record.cells.map(c => [c.at.join(','), c.role]))
  let nextToStation = 0
  for (const c of FLAT.record.cells) {
    assert.ok(!['furnace', 'table'].includes(role.get(c.support.join(','))), `${c.role}@${c.at} clicks a ${role.get(c.support.join(','))}`)
    assert.notStrictEqual(c.face[1], -1, `${c.role}@${c.at} clicks the face above`)
    if (c.seg === 'fit-out') for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) if (['furnace', 'table'].includes(role.get(c.at.map((v, i) => v + d[i]).join(',')))) nextToStation++
  }
  assert.ok(nextToStation >= 4, 'positive control: the fit-out row has stations beside its cells, so the rule had something to refuse')
})
await t('the doorway faces home: the front\'s outward normal is the cardinal from the door toward home', () => {
  assert.ok(B.facesHome(BP, HOME, A, O))
  assert.ok(!B.facesHome(BP, HOME, A, { E: 'W', W: 'E', N: 'S', S: 'N' }[O]), 'the opposite orientation at the same anchor does not (positive control)')
  assert.ok(['E', 'S', 'W', 'N'].some(o => B.screenSite(flat, HOME, BP, A, o, RES, { sector: 'E' }).why === 'door_not_toward_home'), 'the screen refuses a door turned away')
})
await t('placement order: pad before ring before walls before the roof edge before the inner roof before the fit-out', () => {
  const first = {}, last = {}
  for (const c of FLAT.record.cells) { first[c.seg] ??= c.order; last[c.seg] = c.order }
  for (const [a, b] of [['pad', 'ring'], ['ring', 'roof-edge'], ['wall-F', 'roof-edge'], ['roof-edge', 'roof-inner'], ['roof-inner', 'fit-out']]) assert.ok(last[a] < first[b], `${a} before ${b}`)
})

console.log('THE PROOF CAN FAIL')
await t('A MOAT 11 deep at Chebyshev 12-14: every candidate screens, none is walked to -> no_proven_site, no_step', () => {
  const r = B.siteBlueprint(world(ring({}, 12, 14, G - 10, G, 'air')), plan(), BP, { tries: 3 })
  assert.strictEqual(r.why, 'no_proven_site')
  assert.ok(r.sectors[0].screened > 0, 'the screen still passes (the moat is not in the domain)')
  assert.strictEqual(r.sectors[0].proofFails.no_step, 3)
})
await t('a ditch 1 deep at Chebyshev 12 is walked through (positive control)', () => {
  assert.ok(B.siteBlueprint(world(ring({}, 12, 12, G, G, 'air')), plan(), BP, { tries: 3 }).ok)
})
await t('AN INNER MOAT at Chebyshev 4-6 (Codex siting r1 P2): no bot stood outside it -> no_proven_site; a cell a bot stood on outside it -> proven', () => {
  const cells = ring({}, 4, 6, G - 10, G, 'air')
  assert.strictEqual(B.siteBlueprint(world(cells), plan(), BP, { tries: 2 }).why, 'no_proven_site')
  assert.ok(B.siteBlueprint(world(cells), plan(), BP, { tries: 2, stood: [[9, G + 1, 0], [9, G + 1, 4], [-9, G + 1, 2]] }).ok, 'the bots stood outside the moat: that is the town')
})
await t('CHESTS IN A WALL seed nothing (Codex siting r2/r3 P2, Claude r3 P2: one chest, two chests, a double chest): only cells a bot STOOD on do', () => {
  // a wall 3 high at x = 5 across the whole world with a double chest and a third chest set in it; home on the west
  const cells = {}
  for (let z = -60; z <= 60; z++) for (let y = G + 1; y <= G + 3; y++) cells[`5,${y},${z}`] = 'stone'
  cells[`5,${G + 1},0`] = 'chest'; cells[`5,${G + 1},1`] = 'chest'; cells[`5,${G + 1},3`] = 'chest'
  const read = world(cells)
  // the chests' own cells are not nodes (a chest is not passable): passing them as stood cells seeds nothing
  assert.ok(!B.walkFrom(read, HOME, new Set(), 48, { stood: [[5, G + 1, 0], [5, G + 1, 1], [5, G + 1, 3]] }).has(`30,${G + 1},0`), 'the far side of the wall is not reached')
  assert.ok(B.walkFrom(read, HOME, new Set(), 48, { stood: [[2, G + 1, 0]] }).has(`2,${G + 1},0`), 'the near side is (control)')
  assert.ok(B.walkFrom(read, HOME, new Set(), 48, { stood: [[8, G + 1, 0], [9, G + 1, 2], [10, G + 1, -3]] }).has(`30,${G + 1},0`), 'bots that STOOD east of the wall (the most stood cells) are evidence of that side')
  assert.strictEqual(B.siteBlueprint(read, plan(), BP, { tries: 2, stood: [[2, G + 1, 0]] }).why, 'no_proven_site')
})
await t('A FENCE RING at Chebyshev 12 (Codex siting r1 P2): a fence is 1.5 high, never a step -> no_proven_site; cobblestone (1 high) -> proven', () => {
  assert.strictEqual(B.siteBlueprint(world(ring({}, 12, 12, G + 1, G + 1, 'oak_fence')), plan(), BP, { tries: 2 }).why, 'no_proven_site')
  assert.ok(B.siteBlueprint(world(ring({}, 12, 12, G + 1, G + 1, 'cobblestone')), plan(), BP, { tries: 2 }).ok)
})
await t('interior_unreachable: the doorway walled up LAST (in the fit-out, from outside) -> refused; the real blueprint -> ok (control)', () => {
  // walled up with the walls, the inner roof has no stand first (no_step); in the fit-out, the unplaced seal is an obstacle that
  // keeps the builder out of the interior (no_step again). A segment of its own after the fit-out reaches the interior check
  const site = screen(flat)
  const sealed = { ...BP, segments: [...BP.segments, { seg: 'seal', layer: 5, deps: ['fit-out'] }], cells: [...BP.cells, { u: 4, v: 1, y: 1, role: 'wall', seg: 'seal' }, { u: 4, v: 1, y: 2, role: 'wall', seg: 'seal' }] }
  assert.strictEqual(B.proveSite(flat, HOME, sealed, site).why, 'interior_unreachable')
  assert.strictEqual(B.proveSite(flat, HOME, BP, site).why, 'ok')
})
await t('cell_not_free: a site whose clear list misses a block in the volume is refused by the proof', () => {
  const [x, , z] = cellOf(2, 2, 0)
  const read = world({ [`${x},${G + 1},${z}`]: 'dirt' })
  const site = screen(read)
  assert.strictEqual(B.proveSite(read, HOME, BP, site).why, 'ok', 'with the cut: ok')
  assert.strictEqual(B.proveSite(read, HOME, BP, { ...site, clear: [] }).why, 'cell_not_free')
})

console.log('THE SCREEN\'S REFUSALS (each with its positive control)')
await t('the flat site\'s own anchor screens ok (the control for the refusals below)', () => {
  assert.strictEqual(screen(flat).why, 'ok')
})
await t('a chest in the volume refuses the site (built_in_volume)', () => {
  const [x, y, z] = cellOf(4, 3, 1)
  assert.strictEqual(screen(world({ [`${x},${y},${z}`]: 'chest' })).why, 'built_in_volume')
})
await t('A CHEST UNDER THE PAD (Claude/Codex siting r1 P2) refuses the site; air there is a fill of 1 (control)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  assert.strictEqual(screen(world({ [`${x},${G},${z}`]: 'chest' })).why, 'built_in_volume')
  const ok = screen(world({ [`${x},${G},${z}`]: 'air' }))
  assert.strictEqual(ok.why, 'ok'); assert.strictEqual(ok.fill.length, 1)
})
await t('A LOG UNDER THE PAD is a tree (felled, cleared as `tree`), never a `plant`', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const r = screen(world({ [`${x},${G},${z}`]: 'oak_log' }))
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.felled, 1)
  assert.ok(r.clear.some(c => c.kind === 'tree' && c.at[1] === G)); assert.ok(!r.clear.some(c => c.kind === 'plant'))
})
await t('water in the volume refuses the site (liquid)', () => {
  const [x, , z] = cellOf(4, 3, 1)
  assert.strictEqual(screen(world({ [`${x},${G},${z}`]: 'water' })).why, 'liquid')
})
await t('a hole 4 deep under one pad cell -> fill_too_deep (at the ground\'s level); 3 deep is a fill of 3 (control)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const hole = n => { const c = {}; for (let y = G - n + 1; y <= G; y++) c[`${x},${y},${z}`] = 'air'; return c }
  assert.strictEqual(screen(world(hole(4))).why, 'fill_too_deep')
  const ok = screen(world(hole(3)))
  assert.strictEqual(ok.why, 'ok'); assert.strictEqual(ok.fill.length, 3)
})
await t('EARTHWORK: a dip under 41 columns and a bump on 22 costs >= 63 at every level -> earthwork; a dip under 63 costs 0 one lower (control)', () => {
  assert.strictEqual(screen(world(dipBump(41))).why, 'earthwork')
  const low = screen(world(dipBump(63)))
  assert.strictEqual(low.why, 'ok'); assert.strictEqual(low.g0, G - 1); assert.strictEqual(low.fill.length + low.cut.length, 0)
})
await t('cut_too_high: a 4-high dirt pillar on one pad cell; 3 high is a cut of 3 (control)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const pillar = n => { const c = {}; for (let y = G + 1; y <= G + n; y++) c[`${x},${y},${z}`] = 'dirt'; return c }
  assert.strictEqual(screen(world(pillar(4))).why, 'cut_too_high')
  const ok = screen(world(pillar(3)))
  assert.strictEqual(ok.why, 'ok'); assert.strictEqual(ok.cut.length, 3)
})
await t('litter_over_40: 41 slabs (placed, never a floor) on the pad; 40 is a scaffold clear of 40 (control)', () => {
  const pad = B.footprint(BP, A, O).pad
  const slabs = n => { const c = {}; for (const [x, z] of pad.slice(0, n)) c[`${x},${G + 1},${z}`] = 'cobblestone_slab'; return c }
  assert.strictEqual(screen(world(slabs(41))).why, 'litter_over_40')
  const ok = screen(world(slabs(40)))
  assert.strictEqual(ok.why, 'ok'); assert.strictEqual(ok.litter, 40)
})
await t('a floating scaffold block in the volume is a scaffold clear (litter), never ground or a cut', () => {
  const [x, , z] = cellOf(2, 2, 0)
  const r = screen(world({ [`${x},${G + 2},${z}`]: 'cobblestone' }))
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.litter, 1); assert.strictEqual(r.cut.length, 0)
  assert.ok(r.clear.some(c => c.kind === 'scaffold' && c.at[1] === G + 2))
})
await t('a natural block standing on the ground in the volume is a cut (positive control for the litter rule)', () => {
  const [x, , z] = cellOf(2, 2, 0)
  const r = screen(world({ [`${x},${G + 1},${z}`]: 'dirt' }))
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.cut.length, 1)
})
await t('A GRAVITY BLOCK over air is not a floor: sand at G over a hole -> cleared and filled from the stone', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const r = screen(world({ [`${x},${G},${z}`]: 'sand', [`${x},${G - 1},${z}`]: 'air' }))
  assert.strictEqual(r.why, 'ok')
  assert.ok(r.fill.some(c => c[1] === G - 1) && r.fill.some(c => c[1] === G), 'both cells filled')
  assert.ok(r.clear.some(c => c.at[1] === G && c.name === 'sand'))
  assert.strictEqual(screen(world({ [`${x},${G},${z}`]: 'sand' })).fill.length, 0, 'sand on stone is a floor (control)')
})
await t('A GRAVITY CHAIN (Codex siting r2 P2): sand on sand over air is no floor -> filled from the stone; sand on sand on stone is (control)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const r = screen(world({ [`${x},${G},${z}`]: 'sand', [`${x},${G - 1},${z}`]: 'sand', [`${x},${G - 2},${z}`]: 'air' }))
  assert.strictEqual(r.why, 'ok')
  assert.ok(r.fill.some(c => c[1] === G - 2) && r.fill.some(c => c[1] === G), 'filled up from G-3')
  assert.strictEqual(screen(world({ [`${x},${G},${z}`]: 'sand', [`${x},${G - 1},${z}`]: 'sand' })).fill.length, 0)
})
await t('a plan path segment through the site refuses it (plan_path_or_keepout)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  assert.strictEqual(screen(flat, B.reservations(plan({ paths: [{ id: 'p', seg: [x, z, x, z] }] }), {})).why, 'plan_path_or_keepout')
})
await t('a plan CELL in the site refuses it (plan_cell); a committed keep-out plot\'s box over it (plan_box)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const cellPlot = { id: 'annex', kind: 'annex', keepout: false, cells: [{ at: [x, G + 1, z], kind: 'chest', state: 'free' }] }
  assert.strictEqual(screen(flat, B.reservations(plan({ plots: [cellPlot] }), {})).why, 'plan_cell')
  const boxPlot = { id: 'yard', kind: 'annex', keepout: true, box: [x, z, x, z], cells: [{ at: [0, G + 1, 50], kind: 'chest', state: 'placed', stand: [0, G + 1, 51] }] }
  assert.strictEqual(screen(flat, B.reservations(plan({ plots: [boxPlot] }), {})).why, 'plan_box')
})
await t('a protected zone over the site refuses it; a plinth well within 3, a tree-farm cell within 2, the Z0 apron and the M0 collar too', () => {
  const [x, , z] = cellOf(4, 3, 0)
  assert.strictEqual(screen(flat, B.reservations(plan(), { zones: [{ id: 'z', box: [x, 0, z, x, 100, z] }] })).why, 'zone')
  assert.strictEqual(screen(flat, B.reservations(plan(), { wells: [[x + 3, G, z]] })).why, 'well')
  assert.strictEqual(screen(flat, B.reservations(plan(), { farm: [[x, z]] })).why, 'treefarm')
  assert.strictEqual(screen(flat, B.reservations(plan(), { z0: { centre: { x: x + 30, z } } })).why, 'z0_apron')
  assert.strictEqual(screen(flat, B.reservations(plan(), { m0: { origin: { x: x + 8, z } } })).why, 'm0_collar')
  assert.strictEqual(screen(flat, B.reservations(plan(), { wells: [[x + 20, G, z]] })).why, 'ok', 'a well far away (positive control)')
})
await t('outside the sector the screen refuses (sector); the domain refuses a pad inside Chebyshev 22 and one past line 44', () => {
  assert.strictEqual(B.screenSite(flat, HOME, BP, A, O, RES, { sector: 'N' }).why, 'sector')
  assert.strictEqual(B.screenSite(flat, HOME, BP, { x: 10, z: -3 }, O, RES, { sector: 'E' }).why, 'domain')
  assert.strictEqual(B.screenSite(flat, HOME, BP, { x: 40, z: 25 }, O, RES, { sector: 'E' }).why, 'domain')
})

console.log('TREES AND REPLANT')
await t('an oak in the volume: felled whole (5 logs), one replant cell reserved 8-24 out, pending, an oak sapling', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const read = world(oakAt(x, z))
  const r = screen(read)
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.trees.length, 1); assert.strictEqual(r.trees[0].logs, 5)
  const rp = B.replantFor(read, HOME, r, RES, B.walkFrom(read, HOME))
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
  const r = screen(world(cells))
  assert.strictEqual(r.why, 'ok')
  assert.strictEqual(B.replantFor(world(cells), HOME, r, RES, B.walkFrom(world(cells), HOME)).ok, false)
})
await t('TWO TOUCHING TRUNKS (Claude siting r2 P2): an oak on the ground and one on a 1-high step, logs touching -> two trees, two replants owed', () => {
  const a = cellOf(3, 3, 0), b = cellOf(4, 4, 0)
  const cells = { [`${b[0]},${G + 1},${b[2]}`]: 'dirt' }
  for (let y = G + 1; y <= G + 4; y++) cells[`${a[0]},${y},${a[2]}`] = 'oak_log'
  for (let y = G + 2; y <= G + 5; y++) cells[`${b[0]},${y},${b[2]}`] = 'oak_log'
  const r = screen(world(cells))
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.felled, 1, 'one connected log set'); assert.strictEqual(r.trees.length, 2, 'two trunks')
})
await t('a huge mushroom block in the volume refuses the site (mushroom)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  assert.strictEqual(screen(world({ [`${x},${G + 1},${z}`]: 'red_mushroom_block' })).why, 'mushroom')
})
await t('stood cells beyond the town circle (Chebyshev 16) seed nothing: one beside a moated site does not reach it; inside 16 it does (control)', () => {
  const cells = ring({}, 4, 6, G - 10, G, 'air')
  assert.ok(!B.walkFrom(world(cells), HOME, new Set(), 48, { stood: [[30, G + 1, 3]] }).has(`30,${G + 1},0`))
  assert.ok(B.walkFrom(world(cells), HOME, new Set(), 48, { stood: [[12, G + 1, 3]] }).has(`30,${G + 1},0`))
})
await t('AN UNDERMINED TREE (Claude siting r3 P2): an oak whose ground is dug out still owes its replant', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const cells = oakAt(x, z)
  cells[`${x},${G},${z}`] = 'air'; cells[`${x},${G - 1},${z}`] = 'air'
  const r = screen(world(cells))
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.trees.length, 1)
})
await t('A GROUNDED TRUNK AND A DIAGONAL UNDERMINED ONE touching it (Codex siting r4 P2): two saplings owed', () => {
  const a = cellOf(3, 3, 0), b = cellOf(4, 4, 0)
  const cells = { [`${b[0]},${G},${b[2]}`]: 'air' }
  for (let y = G + 1; y <= G + 4; y++) cells[`${a[0]},${y},${a[2]}`] = 'oak_log'
  for (let y = G + 2; y <= G + 5; y++) cells[`${b[0]},${y},${b[2]}`] = 'oak_log'
  const r = screen(world(cells))
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.felled, 1); assert.strictEqual(r.trees.length, 2)
})
await t('a jungle STUMP with an oak leaf BESIDE it (not on top) owes its replant (Codex siting r4 P2); capped by oak leaves it is a bush', () => {
  const [x, , z] = cellOf(4, 3, 0)
  assert.strictEqual(screen(world({ [`${x},${G + 1},${z}`]: 'jungle_log', [`${x + 1},${G + 1},${z}`]: 'oak_leaves' })).trees.length, 1)
  assert.strictEqual(screen(world({ [`${x},${G + 1},${z}`]: 'jungle_log', [`${x},${G + 2},${z}`]: 'oak_leaves' })).trees.length, 0)
})
await t('A LANDING IN A PIT (Claude siting r4 P2): one logged position in the moat seeds nothing; the town is the piece holding most stood cells', () => {
  // an inner moat 2 wide and 6 deep, sheer on both sides, with a staircase climbing out of it on the far side to the east
  const cells = ring({}, 6, 7, G - 5, G, 'air')
  for (let k = 0; k <= 5; k++) for (let dz = -1; dz <= 1; dz++) cells[`${8 + k},${G - 5 + k},${dz}`] = 'stone'
  for (let k = 0; k <= 5; k++) for (let dz = -1; dz <= 1; dz++) for (let y = G - 4 + k; y <= G; y++) cells[`${8 + k},${y},${dz}`] = 'air'
  const read = world(cells)
  const plaza = [[0, G + 1, 2], [2, G + 1, 0], [-2, G + 1, -2]]
  assert.ok(!B.walkFrom(read, HOME, new Set(), 48, { stood: plaza }).has(`30,${G + 1},0`), 'from the plaza: the moat cuts the town off')
  assert.ok(!B.walkFrom(read, HOME, new Set(), 48, { stood: [...plaza, [7, G - 5, 0]] }).has(`30,${G + 1},0`), 'one landing in the moat: still not reached')
  // the control: the landing IS a node that leads out (with no plaza evidence it is the town, and the outside is reached)
  assert.ok(B.walkFrom(read, HOME, new Set(), 48, { stood: [[7, G - 5, 0], [7, G - 5, 3], [13, G + 1, 0]] }).has(`30,${G + 1},0`), 'the moat leads out')
})
await t('the town piece is a union of every stood cell in it: cells home reached are still reached when stood cells join its piece', () => {
  const alone = B.walkFrom(flat, HOME)
  const more = B.walkFrom(flat, HOME, new Set(), 48, { stood: [[3, G + 1, 3], [-4, G + 1, 1]] })
  assert.ok(alone.size > 0 && [...alone].every(k => more.has(k)))
})
await t('the partial-shape list: ladders, end portal frames and hanging signs are not floors; a jack o\'lantern, a sea lantern and a chorus flower are', () => {
  for (const n of ['ladder', 'end_portal_frame', 'oak_wall_hanging_sign', 'pitcher_crop', 'lantern', 'oak_fence']) assert.ok(!B.fullCube({ name: n, boundingBox: 'block' }), n)
  for (const n of ['jack_o_lantern', 'sea_lantern', 'chorus_flower', 'stone', 'brain_coral_block']) assert.ok(B.fullCube({ name: n, boundingBox: 'block' }), n)
})
await t('a lone JUNGLE log rooted on grass with no bush leaves is a stump and owes its replant (Codex siting r3 P2)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const r = screen(world({ [`${x},${G + 1},${z}`]: 'jungle_log' }))
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.trees.length, 1); assert.strictEqual(r.trees[0].species, 'jungle')
})
await t('a 2x2 trunk STAGGERED on a slope (bases at four heights) still refuses (Codex siting r3 P3)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const cells = {}
  const cols = [[x, z, 0], [x + 1, z, 1], [x, z + 1, 2], [x + 1, z + 1, 3]]
  for (const [a, b, h] of cols) { for (let y = G + 1; y < G + 1 + h; y++) cells[`${a},${y},${b}`] = 'dirt'; for (let y = G + 1 + h; y <= G + 5; y++) cells[`${a},${y},${b}`] = 'spruce_log' }
  assert.strictEqual(screen(world(cells)).why, 'tree_2x2')
})
await t('a 2x2 trunk refuses the site (tree_2x2); a dark oak does too', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const two = oakAt(x, z, oakAt(x + 1, z, oakAt(x, z + 1, oakAt(x + 1, z + 1))))
  assert.strictEqual(screen(world(two)).why, 'tree_2x2')
  assert.strictEqual(screen(world(oakAt(x, z, {}, 'dark_oak'))).why, 'tree_2x2')
})
await t('a log beyond dig reach (5.0) of every eye on the pad refuses the site; a 5-log oak is in reach (control)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const cells = {}
  for (let y = G + 1; y <= G + 9; y++) cells[`${x},${y},${z}`] = 'oak_log'
  assert.strictEqual(screen(world(cells)).why, 'tree_out_of_reach')
  assert.strictEqual(screen(world(oakAt(x, z))).why, 'ok')
})
await t('A BRANCH INTO A ZONE (Claude/Codex siting r1 P2): a felled tree\'s log in a protected zone refuses the site; no zone -> ok', () => {
  const t0 = cellOf(8, 3, 0), b1 = cellOf(9, 3, 0), b2 = cellOf(10, 3, 0)
  const cells = {}
  for (let y = G + 1; y <= G + 3; y++) cells[`${t0[0]},${y},${t0[2]}`] = 'oak_log'
  cells[`${b1[0]},${G + 3},${b1[2]}`] = 'oak_log'; cells[`${b2[0]},${G + 3},${b2[2]}`] = 'oak_log'
  const zone = { id: 'z', box: [b2[0], 0, b2[2], b2[0], 100, b2[2]] }
  // the zone meets only the branch's column, outside the footprint and ring
  assert.ok(!B.footprint(BP, A, O).ring.some(([x, z]) => x === b2[0] && z === b2[2]))
  assert.strictEqual(screen(world(cells), B.reservations(plan(), { zones: [zone] })).why, 'tree_in_reservation')
  assert.strictEqual(screen(world(cells)).why, 'ok')
})
await t('a felled tree reaching past the plot\'s clear box (the footprint + 3) refuses the site (tree_beyond_plot)', () => {
  const t0 = cellOf(8, 3, 0)
  const cells = {}
  for (let y = G + 1; y <= G + 3; y++) cells[`${t0[0]},${y},${t0[2]}`] = 'oak_log'
  for (let u = 9; u <= 12; u++) { const b = cellOf(u, 3, 0); cells[`${b[0]},${G + 3},${b[2]}`] = 'oak_log' }
  assert.strictEqual(screen(world(cells)).why, 'tree_beyond_plot')
})
await t('a rooted 1-log OAK stump owes its replant (Codex siting r2 P2); only a jungle bush is exempt (D6, below)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const r = screen(world({ [`${x},${G + 1},${z}`]: 'oak_log' }))
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.felled, 1); assert.strictEqual(r.trees.length, 1)
  assert.strictEqual(r.trees[0].species, 'oak')
})
await t('D6: a 1-log JUNGLE bush is cleared and owes no replant; a 5-log oak owes one (control above)', () => {
  const [x, , z] = cellOf(4, 3, 0)
  const cells = { [`${x},${G + 1},${z}`]: 'jungle_log' }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { if (dx || dz) cells[`${x + dx},${G + 1},${z + dz}`] = 'oak_leaves'; cells[`${x + dx},${G + 2},${z + dz}`] = 'oak_leaves' }
  const r = screen(world(cells))
  assert.strictEqual(r.why, 'ok'); assert.strictEqual(r.felled, 1); assert.strictEqual(r.trees.length, 0)
})

console.log('THE STEP, THE SIGHT LINE AND THE WALK')
await t('stepFor never clicks the face above (any role); a side face beside the cell is a step (control)', () => {
  const nodes = new Map([['31,0', [G + 1]]])
  assert.strictEqual(B.stepFor(world({ [`30,${G + 4},0`]: 'stone' }), HOME, [30, G + 3, 0], nodes), null)
  const s = B.stepFor(world({ [`29,${G + 3},0`]: 'stone' }), HOME, [30, G + 3, 0], nodes)
  assert.ok(s); assert.deepStrictEqual(s.face, [1, 0, 0])
})
await t('stepFor never clicks a furnace, a crafting table or a chest (they open); stone in the same place is a step (control)', () => {
  const nodes = new Map([['31,0', [G + 1]]])
  for (const n of ['furnace', 'crafting_table', 'chest', 'oak_door']) assert.strictEqual(B.stepFor(world({ [`29,${G + 3},0`]: n, [`30,${G + 2},0`]: 'air', [`30,${G + 1},0`]: 'air' }), HOME, [30, G + 3, 0], nodes), null, n)
  assert.ok(B.stepFor(world({ [`29,${G + 3},0`]: 'stone' }), HOME, [30, G + 3, 0], nodes))
})
await t('stepFor: a solid between eye and face blocks the step (sight line); without it the step exists', () => {
  const nodes = new Map([['33,0', [G + 1]]])
  assert.ok(B.stepFor(flat, HOME, [30, G + 1, 0], nodes), 'open: a step')
  const read = world({ [`32,${G + 1},0`]: 'stone', [`32,${G + 2},0`]: 'stone', [`32,${G + 3},0`]: 'stone', [`31,${G + 1},0`]: 'stone', [`31,${G + 2},0`]: 'stone' })
  assert.strictEqual(B.stepFor(read, HOME, [30, G + 1, 0], nodes), null)
})
await t('THE SIGHT LINE IS EXACT (Codex siting r1 P2): any cell a fine sampler finds solid on the segment, sightClear refuses', () => {
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let checked = 0, blocked = 0
  for (let trial = 0; trial < 400; trial++) {
    const solid = new Set()
    for (let i = 0; i < 30; i++) solid.add(`${Math.floor(rnd() * 6)},${Math.floor(rnd() * 6)},${Math.floor(rnd() * 6)}`)
    const read = (x, y, z) => (solid.has(`${x},${y},${z}`) ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
    const eye = [rnd() * 6, rnd() * 6, rnd() * 6], pt = [rnd() * 6, rnd() * 6, rnd() * 6]
    const ec = eye.map(Math.floor).join(','), pc = pt.map(Math.floor).join(',')
    if (solid.has(ec)) continue
    let fine = true
    for (let i = 1; i < 4000; i++) {
      const c = eye.map((v, k) => Math.floor(v + (pt[k] - v) * (i / 4000))).join(',')
      if (c !== ec && c !== pc && solid.has(c)) { fine = false; break }
    }
    checked++
    if (!fine) { blocked++; assert.strictEqual(B.sightClear(read, eye, pt, new Set([pc])), false, `missed a solid on ${eye} -> ${pt}`) }
  }
  assert.ok(checked > 300 && blocked > 50, `enough rays (${checked}) and enough blocked ones (${blocked})`)
})
await t('THE SIGHT LINE AT AN EDGE (Codex siting r2 P2, hive-d order 49): a solid touched where two axes tie is refused', () => {
  const read = (x, y, z) => (x === 93 && y === 66 && z === 47 ? { name: 'stone_bricks', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
  assert.strictEqual(B.sightClear(read, [92.5, 67.62, 47.5], [93.5, 66, 46.5]), false)
  assert.strictEqual(B.sightClear(() => ({ name: 'air', boundingBox: 'empty' }), [92.5, 67.62, 47.5], [93.5, 66, 46.5]), true, 'open air: clear (control)')
})
await t('the sight line on GRID-ALIGNED rays (ties everywhere) never misses a cell the builder\'s 0.05 sampling hits', () => {
  let seed = 777, checked = 0, blocked = 0
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let trial = 0; trial < 600; trial++) {
    const solid = new Set()
    for (let i = 0; i < 25; i++) solid.add(`${Math.floor(rnd() * 6)},${Math.floor(rnd() * 6)},${Math.floor(rnd() * 6)}`)
    const read = (x, y, z) => (solid.has(`${x},${y},${z}`) ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
    const half = () => Math.floor(rnd() * 6) + 0.5
    const eye = [half(), Math.floor(rnd() * 6) + 0.62, half()], pt = [Math.floor(rnd() * 6) + (rnd() < 0.5 ? 0 : 0.5), Math.floor(rnd() * 6) + (rnd() < 0.5 ? 0 : 0.5), Math.floor(rnd() * 6) + 0.5]
    const ec = eye.map(Math.floor).join(','), pc = pt.map(Math.floor).join(',')
    if (solid.has(ec)) continue
    // the builder's own sampling (builder.mjs sightClear: every 0.05, up to 98% of the way)
    const n = Math.max(2, Math.ceil(Math.hypot(pt[0] - eye[0], pt[1] - eye[1], pt[2] - eye[2]) / 0.05))
    let builderOpen = true
    for (let i = 0; i <= n * 0.98; i++) {
      const c = eye.map((v, k) => Math.floor(v + (pt[k] - v) * (i / n))).join(',')
      if (c !== pc && solid.has(c)) { builderOpen = false; break }
    }
    checked++
    if (!builderOpen) { blocked++; assert.strictEqual(B.sightClear(read, eye, pt, new Set([pc])), false, `the builder sees a block the proof misses: ${eye} -> ${pt}`) }
  }
  assert.ok(checked > 400 && blocked > 80, `enough rays (${checked}) and blocked ones (${blocked})`)
})
await t('walkFrom: a cell still to be placed is never a floor (a stand may not rely on a block that is not there yet)', () => {
  const cells = {}
  for (let z = -60; z <= 60; z++) for (let y = G - 20; y <= G; y++) cells[`30,${y},${z}`] = 'air'
  const read = world(cells)
  assert.ok(!B.walkFrom(read, HOME).has(`31,${G + 1},0`), 'the far side is cut off by the gap')
  const over = B.overlay(read, new Map([[`30,${G},0`, { name: 'cobblestone', boundingBox: 'block' }]]))
  assert.ok(B.walkFrom(over, HOME).has(`31,${G + 1},0`), 'a PLACED bridge is walked over (positive control)')
  assert.ok(!B.walkFrom(over, HOME, new Set([`30,${G},0`])).has(`31,${G + 1},0`), 'a bridge still to be placed is not')
})
await t('walkFrom: home boxed in (a block over its head, walls round it) walks out only from a cell a bot stood on', () => {
  const cells = { [`0,${G + 2},0`]: 'diorite', [`1,${G + 1},0`]: 'stone', [`-1,${G + 1},0`]: 'stone', [`0,${G + 1},1`]: 'stone', [`0,${G + 1},-1`]: 'stone', [`1,${G + 2},0`]: 'stone', [`-1,${G + 2},0`]: 'stone', [`0,${G + 2},1`]: 'stone', [`0,${G + 2},-1`]: 'stone' }
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) { cells[`${a},${G + 1},${b}`] = 'stone'; cells[`${a},${G + 2},${b}`] = 'stone' }
  const read = world(cells)
  assert.ok(!B.walkFrom(read, HOME).has(`30,${G + 1},0`), 'home alone: boxed in')
  assert.ok(B.walkFrom(read, HOME, new Set(), 48, { stood: [[5, G + 1, 0]] }).has(`30,${G + 1},0`), 'a cell a bot stood on outside the box seeds the walk')
})
await t('walkFrom: a fence is never a floor (1.5 high), WATERLOGGED or not (Codex siting r2 P2); a full cube is (control)', () => {
  const w = n => B.walkFrom(world({ [`30,${G},0`]: n, [`30,${G - 1},0`]: 'stone' }), HOME)
  assert.ok(!w('oak_fence').has(`30,${G + 1},0`))
  const wet = B.walkFrom((x, y, z) => (x === 30 && y === G && z === 0 ? { name: 'oak_fence[waterlogged]', boundingBox: 'block' } : flat(x, y, z)), HOME)
  assert.ok(!wet.has(`30,${G + 1},0`))
  assert.ok(w('stone').has(`30,${G + 1},0`))
  assert.ok(B.fullCube({ name: 'brain_coral_block', boundingBox: 'block' }), 'a coral BLOCK is a full cube')
  assert.ok(!B.fullCube({ name: 'brain_coral_fan', boundingBox: 'block' }))
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

console.log('THE RUNNER\'S RECORDS (buildsite-offline.mjs)')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buildsite-'))
const KEY = 'townplan-0_70_0'
const plan1 = { ...plan(), gen: 1, prev: null, prevSha: null }
const writeJ = (f, v) => fs.writeFileSync(path.join(tmp, f), typeof v === 'string' ? v : JSON.stringify(v))
writeJ(`${KEY}.g1.json`, plan1)
writeJ('junkwell-plinth-0_70_0.json', { plan: { cap: { x: 1, y: 70, z: 2 }, steps: [{ c: [3, 69, 4] }], stair: [[5, 68, 6]] }, prev: [{ x: 7, y: 70, z: 8, stair: [[9, 69, 10]] }] })
writeJ('junkwell-site-0_70_0.g1.json', { x: 11, y: 70, z: 12 })
writeJ('junkwell-site-0_70_0.g2.json', { x: 13, y: 70, z: 14 })
writeJ('treefarm-0_70_0.g1.json', { cells: [{ x: 100, z: 100 }] })
writeJ('treefarm-0_70_0.g2.json', { cells: [{ x: 15, z: 16 }] })
writeJ('town-chest-0_70_0.containers.json', { world: 'w', entries: { '2,70,3': { o: 'took' }, '-4,70,5': { o: 'put' } } })
await t('poolRecords reads the head, the plinth plan AND its prev[] columns {x,y,z,stair} (Codex siting r1 P2), the newest well site and farm', () => {
  const r = RUN.poolRecords(tmp)
  assert.ok(r.head, r.why)
  const w = new Set(r.wells.map(c => c.join(',')))
  for (const c of ['1,70,2', '3,69,4', '5,68,6', '7,70,8', '9,69,10', '13,70,14']) assert.ok(w.has(c), `well cell ${c}`)
  assert.ok(!w.has('11,70,12'), 'the older well site is not read')
  assert.deepStrictEqual(r.farm, [[15, 16]], 'the newest tree-farm generation')
  assert.strictEqual(r.zonesWhy, 'absent', 'no zones file: absent (a valid answer)')
})
await t('A MALFORMED zones file FAILS CLOSED (Codex siting r1 P2): records_unreadable, never zero zones', () => {
  writeJ('protected-zones.json', '{"version": 1, "zones": [')
  const r = RUN.poolRecords(tmp)
  assert.ok(!r.head && /records_unreadable/.test(r.why), r.why)
  writeJ('protected-zones.json', { version: 1, zones: [] })
  assert.ok(RUN.poolRecords(tmp).head, 'a readable zones file: the head (control)')
})
await t('a malformed tree-farm generation fails closed too', () => {
  writeJ('treefarm-0_70_0.g3.json', 'not json')
  assert.ok(/records_unreadable/.test(RUN.poolRecords(tmp).why))
  fs.unlinkSync(path.join(tmp, 'treefarm-0_70_0.g3.json'))
})
fs.rmSync(tmp, { recursive: true, force: true })

console.log('MUTANTS (anchored, unique; the real code passes each scenario, the mutant fails it)')
await t('MUTANT reach check removed in stepFor', () => mutantKilled('if (d > REACH || d >= bd) continue', 'if (d >= bd) continue', M => {
  assert.strictEqual(M.stepFor(flat, HOME, [30, G + 1, 0], new Map([['35,0', [G + 1]]])), null, 'a face 5 away is out of reach')
}))
await t('MUTANT the never-a-floor rule dropped in walkFrom', () => mutantKilled('if (block.has(k3(x, y, z)) || block.has(k3(x, y + 1, z)) || block.has(k3(x, y - 1, z))) return false', 'if (block.has(k3(x, y, z)) || block.has(k3(x, y + 1, z))) return false', M => {
  const cells = {}
  for (let z = -60; z <= 60; z++) for (let y = G - 20; y <= G; y++) cells[`30,${y},${z}`] = 'air'
  const over = M.overlay(world(cells), new Map([[`30,${G},0`, { name: 'cobblestone', boundingBox: 'block' }]]))
  assert.ok(!M.walkFrom(over, HOME, new Set([`30,${G},0`])).has(`31,${G + 1},0`))
}))
await t('MUTANT the earthwork total ignored', () => mutantKilled('if (fill > EARTH.fill || cut > EARTH.cut || litter > LITTER_MAX) {', 'if (false) {', M => {
  assert.strictEqual(M.screenSite(world(dipBump(41)), HOME, BP, A, O, M.reservations(plan(), {}), { sector: 'E' }).why, 'earthwork')
}))
await t('MUTANT the replant gate dropped in siteBlueprint', () => mutantKilled("if (!rp.ok) { proofFails.no_replant_cell = (proofFails.no_replant_cell ?? 0) + 1; continue }", '', M => {
  const cells = {}
  for (let a = -60; a <= 60; a++) for (let b = -60; b <= 60; b++) cells[`${a},${G},${b}`] = 'stone'
  for (let a = 20; a <= 46; a += 3) for (let b = -20; b <= 20; b += 3) oakAt(a, b, cells)
  const r = M.siteBlueprint(world(cells), plan(), BP, { tries: 2 })
  assert.ok(!r.ok || r.record.trees.length === r.record.replant.length, 'never a felled tree without its replant')
}))
await t('MUTANT D1 gone (an unsited pavilion means no sector)', () => mutantKilled("return REST_ORDER.filter(s => !taken.has(s)).map(s => ({ sector: s, source: 'free' }))", 'return []', M => {
  assert.ok(M.workshopSectors(plan({ pavilion: null })).length > 0)
}))
await t('MUTANT a block the click would use allowed as a support', () => mutantKilled('export const refUsable = b => isSolid(b) && !isLiquid(b) && !USES.test(nm(b))', 'export const refUsable = b => isSolid(b) && !isLiquid(b)', M => {
  assert.strictEqual(M.stepFor(world({ [`29,${G + 3},0`]: 'furnace' }), HOME, [30, G + 3, 0], new Map([['31,0', [G + 1]]])), null)
}))
await t('MUTANT the tree reservation check dropped', () => mutantKilled("if (res.column(x, z, y, y) || cellInZones(x, y, z, res.zones)) return { ok: false, why: 'tree_in_reservation' }", '', M => {
  const t0 = cellOf(8, 3, 0), b1 = cellOf(9, 3, 0), b2 = cellOf(10, 3, 0)
  const cells = {}
  for (let y = G + 1; y <= G + 3; y++) cells[`${t0[0]},${y},${t0[2]}`] = 'oak_log'
  cells[`${b1[0]},${G + 3},${b1[2]}`] = 'oak_log'; cells[`${b2[0]},${G + 3},${b2[2]}`] = 'oak_log'
  const res = M.reservations(plan(), { zones: [{ id: 'z', box: [b2[0], 0, b2[2], b2[0], 100, b2[2]] }] })
  assert.strictEqual(M.screenSite(world(cells), HOME, BP, A, O, res, { sector: 'E' }).why, 'tree_in_reservation')
}))
await t('MUTANT the fill span\'s refusals ignored (a chest under the pad)', () => mutantKilled('const bad = classify(y, b, false)', 'const bad = (classify(y, b, false), null)', M => {
  const [x, , z] = cellOf(4, 3, 0)
  assert.strictEqual(M.screenSite(world({ [`${x},${G},${z}`]: 'chest' }), HOME, BP, A, O, M.reservations(plan(), {}), { sector: 'E' }).why, 'built_in_volume')
}))
await t('MUTANT the walk\'s full-cube floor rule relaxed to any solid (a fence)', () => mutantKilled('return !!f && !!a && !!h && fullCube(f) && isPassable(a)', 'return !!f && !!a && !!h && isSolid(f) && isPassable(a)', M => {
  assert.ok(!M.walkFrom(world({ [`30,${G},0`]: 'oak_fence', [`30,${G - 1},0`]: 'stone' }), HOME).has(`30,${G + 1},0`))
}))

await t('MUTANT the town circle bound on stood cells dropped', () => mutantKilled('Math.max(Math.abs(c[0] - home.x), Math.abs(c[2] - home.z)) <= TOWN_R && isNode(...c)', 'isNode(...c)', M => {
  // three stood cells just past the circle (x 17-19) outvote home inside an inner moat when the bound is gone
  assert.ok(!M.walkFrom(world(ring({}, 4, 6, G - 10, G, 'air')), HOME, new Set(), 48, { stood: [[17, G + 1, 0], [18, G + 1, 1], [19, G + 1, -1]] }).has(`30,${G + 1},0`))
}))
await t('MUTANT the saplings owed back to "solid ground below" (an undermined tree owes nothing)', () => mutantKilled("const bases = t.logs.filter(([x, y, z]) => { const below = nm(read(x, y - 1, z)); return !LOG.test(below) && !LEAVES.test(below) })", "const bases = t.logs.filter(([x, y, z]) => isSolid(read(x, y - 1, z)) && !LOG.test(nm(read(x, y - 1, z))) && !LEAVES.test(nm(read(x, y - 1, z))))", M => {
  const [x, , z] = cellOf(4, 3, 0)
  const cells = oakAt(x, z)
  cells[`${x},${G},${z}`] = 'air'; cells[`${x},${G - 1},${z}`] = 'air'
  assert.strictEqual(M.screenSite(world(cells), HOME, BP, A, O, M.reservations(plan(), {}), { sector: 'E' }).trees.length, 1)
}))
await t('MUTANT the edge/corner checks dropped from sightClear', () => mutantKilled('      for (const i of tied) { const c = cell.slice(); c[i] += step[i]; if (!open(c)) return false }\n', '', M => {
  const read = (x, y, z) => (x === 93 && y === 66 && z === 47 ? { name: 'stone_bricks', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
  assert.strictEqual(M.sightClear(read, [92.5, 67.62, 47.5], [93.5, 66, 46.5]), false)
}))

await t('MUTANT every stood piece kept (no town piece chosen)', () => mutantKilled('for (const [c] of tagged) { const key = k3(...c); if (comp.get(key) === town && !seen.has(key)) { seen.add(key); q.push(c) } }', 'for (const [c] of tagged) { const key = k3(...c); if (!seen.has(key)) { seen.add(key); q.push(c) } }', M => {
  const cells = ring({}, 6, 7, G - 5, G, 'air')
  for (let k = 0; k <= 5; k++) for (let dz = -1; dz <= 1; dz++) cells[`${8 + k},${G - 5 + k},${dz}`] = 'stone'
  const plaza = [[0, G + 1, 2], [2, G + 1, 0], [-2, G + 1, -2]]
  for (let k = 0; k <= 5; k++) for (let dz = -1; dz <= 1; dz++) for (let y = G - 4 + k; y <= G; y++) cells[`${8 + k},${y},${dz}`] = 'air'
  assert.ok(!M.walkFrom(world(cells), HOME, new Set(), 48, { stood: [...plaza, [7, G - 5, 0]] }).has(`30,${G + 1},0`))
}))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
