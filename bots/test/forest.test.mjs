// FOREST-01: THE MANAGED FOREST (bots/src/forest.mjs), pure and on the fake server: the switch; the geometry (trunks 3 apart, one stand
// each, beside its trunk in the aisle); the MEASURED stand rule (Paper 11-06: a side stand fells dy -1..+6, never +7 -- so a SUNK plot
// takes every 8-log spruce and a flat one does not); the siting (outside every wall ring by the gap, inside the ticking chunks, in the
// land plan's treefarm/wild sectors, no unfellable tree, plantable soil under each sunk plot, existing fellable trees preferred); the
// record's zone (a y-band: a coal run 20 below is outside it, the surface inside); the strip census, ripeness and the staggered
// rotation; the felling (top down, the stump last; a branchy or too-tall tree KEPT); the due test (perpetual: it comes back when a tree
// grows; never for an open plot with no sapling to hand); the footprint (the trunk priced, the aisle not: the in-wall farm's bug); the
// outside trees' replant routed to the forest's rows; the in-wall farm's retirement (the stump stance for an 8-log tree on a flat plot)
// and the garden; the keeper's order; the record BUILT END TO END by buildrun.mjs runVisit (floor, soil, the sunk saplings) with every
// placement on the record; the wiring in skills.mjs / shop.mjs / tidy.mjs / landplan.mjs. Mutants assert their anchors present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const F = await import('../src/forest.mjs')
const TF = await import('../src/treefarm.mjs')
const GKM = await import('../src/groundskeeper.mjs')
const SHOP = await import('../src/shop.mjs')
const TIDY = await import('../src/tidy.mjs')
const { projectSiteHit } = await import('../src/coalrun.mjs')

const FOREST_PATH = new URL('../src/forest.mjs', import.meta.url)
const GK_PATH = new URL('../src/groundskeeper.mjs', import.meta.url)
const TIDY_PATH = new URL('../src/tidy.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const LAND_PATH = new URL('../src/landplan.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
/** A mutant of a source file (anchor present and unique: CLAUDE.md), imported from the test directory. */
async function withMutant (old, neu, fn, file = FOREST_PATH) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (old, neu, scenario, file = FOREST_PATH, real = F) => {
  await scenario(real)
  let k = false
  await withMutant(old, neu, async M => { try { await scenario(M) } catch { k = true } }, file)
  assert.ok(k, 'the mutant survived')
}
/** A world: grass at G over DIRT (G-3..G-1) and stone below, inside |x|,|z| <= 120; `cells` override. */
function world (cells0 = {}) {
  const cells = new Map(Object.entries(cells0))
  const read = (x, y, z) => {
    if (Math.abs(x) > 120 || Math.abs(z) > 120 || y < G - 30 || y > G + 40) return null
    const n = cells.get(`${x},${y},${z}`) ?? (y < G - 3 ? 'stone' : y < G ? 'dirt' : y === G ? 'grass_block' : 'air')
    return { name: n, boundingBox: /air|sapling|grass$|torch|fern/.test(n) && n !== 'grass_block' ? 'empty' : 'block' }
  }
  return { read, cells, set: (a, n) => cells.set(a.join(','), n) }
}
const WALL = { blueprint: 'wall@1', ring: [-15, -15, 15, 15] }
const plotsOf = rec => rec.cells.filter(c => c.role === 'plot')
const grow = (w, c, n, sp = 'spruce_log') => { for (let k = 0; k < n; k++) w.set([c.at[0], c.at[1] + k, c.at[2]], sp) }

await t('the switch: on in the showcase pool by default, off in a fleet pool, FOREST=on|off wins', () => {
  assert.strictEqual(F.forestOn({}, 'showcase'), true)
  assert.strictEqual(F.forestOn({}, 'hive-a'), true, 'fleet: every named pool')
  assert.strictEqual(F.forestOn({}, ''), false, 'an unnamed pool (a test bot) stays off')
  assert.strictEqual(F.forestOn({ FOREST: 'on' }, 'hive-a'), true)
  assert.strictEqual(F.forestOn({ FOREST: 'off' }, 'showcase'), false)
  assert.strictEqual(F.forestOn({ FOREST_POOLS: 'board-a,hive-b' }, 'hive-b'), true)
})
await t('the geometry: trunks 3 apart everywhere, each plot owns ONE stand straight beside its trunk in a 2-wide aisle, paths between strips', () => {
  const L = F.forestLayout(0, 0, { perRow: 6, strips: 3 })
  assert.strictEqual(L.plots.length, 36)
  assert.ok(F.trunksApart(L.plots, 3), 'every trunk >= 3 from every other (growth room)')
  const trunk = new Set(L.plots.map(p => `${p.x},${p.z}`))
  const stands = new Set()
  for (const p of L.plots) {
    const [sx, sz] = p.stand
    assert.strictEqual(Math.abs(sx - p.x) + Math.abs(sz - p.z), 1, 'the stand is orthogonally beside the trunk')
    assert.ok(L.aisles.has(`${sx},${sz}`), 'the stand is an aisle cell')
    assert.ok(!trunk.has(`${sx},${sz}`), 'no stand on a trunk')
    assert.ok(!stands.has(`${sx},${sz}`), 'stands are not shared')
    stands.add(`${sx},${sz}`)
  }
  // strips 6 apart: the 2-wide path between them holds no trunk and no aisle
  for (const z of [4, 5, 10, 11]) for (let x = 0; x <= 15; x++) assert.ok(L.paths.has(`${x},${z}`), `path ${x},${z}`)
  assert.deepStrictEqual(L.box, [-1, -1, 16, 16])
})
await t('THE MEASURED STAND RULE (Paper 11-06): a side stand fells dy -1..+6; SUNK plots put every 8-log spruce in reach, FLAT ones do not', () => {
  const W = 64, stand = [10, W + 1, 11]
  const sunk = Array.from({ length: 8 }, (_, k) => [10, W + k, 10])        // sapling at W (the floor), logs W..W+7
  const flat = Array.from({ length: 8 }, (_, k) => [10, W + 1 + k, 10])    // sapling at W+1, logs W+1..W+8
  assert.ok(sunk.every(l => F.standReaches(stand, l)), 'every log of a sunk 8-log spruce')
  assert.ok(!flat.every(l => F.standReaches(stand, l)), 'a flat 8-log spruce leaves its top log')
  assert.deepStrictEqual(flat.filter(l => !F.standReaches(stand, l)).map(l => l[1] - stand[1]), [7], 'exactly the +7 log, as Paper refused it')
  assert.ok(!F.standReaches(stand, [11, W + 2, 10]), 'a diagonal log is not the stand\'s')
  assert.ok(!F.standReaches(stand, [10, W - 1, 10]), 'nothing below dy -1')
})
await t('MUTANT KILLED: a stand rule that admits dy +7 (the flat plot\'s floating top log)', async () => {
  await killed('return dx + dz === 1 && dy >= -F.reachDown && dy <= F.reachUp', 'return dx + dz === 1 && dy >= -F.reachDown && dy <= F.reachUp + 1', M => {
    assert.ok(!M.standReaches([0, 65, 1], [0, 72, 0]))
  })
})

await t('the siting: outside the walls by the gap, inside the ticking chunks, every plot sunk on plantable soil, the zone a y-band', () => {
  const w = world()
  const s = F.siteForest(w.read, { home: HOME, rings: [WALL.ring], species: 'spruce_sapling', now: 1000 })
  assert.ok(s.ok, s.why)
  const r = s.record
  assert.ok(F.outsideRings(r.box, [WALL.ring], F.FOREST.wallGap), `box ${r.box} keeps ${F.FOREST.wallGap} off the ring`)
  assert.ok(F.boxTicks(r.box, HOME), 'every column within the ticking chunks')
  assert.strictEqual(r.level, G)
  for (const c of plotsOf(r)) { assert.strictEqual(c.at[1], G, 'the sapling stands IN the floor'); assert.deepStrictEqual(c.stand.slice(1, 2), [G + 1], 'the stand feet on the floor') }
  for (const c of r.cells.filter(q => q.role === 'soil')) assert.strictEqual(c.at[1], G - 1)
  assert.strictEqual(r.counts.plots, 36)
  assert.strictEqual(r.strips.length, 3)
  // the zone: the surface is the forest's, a coal run 20 blocks under it is not (the in-wall farm's box zone ran -64..320)
  const [bx0, bz0] = r.box
  assert.strictEqual(projectSiteHit({ x: bx0 + 2, y: G + 1, z: bz0 + 2 }, r.zones), 'project:forest')
  assert.strictEqual(projectSiteHit({ x: bx0 + 2, y: G - 20, z: bz0 + 2 }, r.zones), null)
  assert.strictEqual(projectSiteHit({ x: bx0 + 2, y: G + 8, z: bz0 + 2 }, r.zones), 'project:forest', 'the crown band is reserved')
  // inside the walls there is no site at all; no wall record: no forest
  assert.ok(!F.siteForest(w.read, { home: HOME, rings: [[-200, -200, 200, 200]] }).ok)
  assert.strictEqual(F.siteForest(w.read, { home: HOME, rings: [] }).why, 'no_wall')
  // the build's walk covers the box (Claude + Codex r1: runVisit's stand search stopped at WALK_R 48)
  assert.ok(F.boxReach(r.box, HOME) <= F.FOREST.rMax)
  assert.ok(F.forestWalkR(r, HOME) >= F.boxReach(r.box, HOME) + 6)
  const wide = F.siteForest(w.read, { home: HOME, rings: [[-40, -40, 40, 40]] })
  assert.ok(wide.ok && F.boxReach(wide.record.box, HOME) <= F.FOREST.rMax && F.forestWalkR(wide.record, HOME) > 48, 'a wide town: a forest past 48, walked to')
})
await t('the siting keeps the land plan\'s sectors (treefarm or wild only) and every reservation, and refuses stone under a plot', () => {
  const w = world()
  const zone = (x, z) => (x < 0 ? 'homes' : 'wild')
  const s = F.siteForest(w.read, { home: HOME, rings: [WALL.ring], zone })
  assert.ok(s.ok, s.why)
  assert.ok(s.record.box[0] >= 0, 'never in the homes sector')
  const blocked = (x, z) => (x > 0 ? 'land:road' : null)
  const s2 = F.siteForest(w.read, { home: HOME, rings: [WALL.ring], zone, blocked })
  assert.ok(!s2.ok, 'every column refused: no site')
  // stone right under the grass of one candidate's plot refuses that candidate (the buried soil could never be replaced)
  const fit = F.forestFitAt(w.read, { x0: 30, z0: 30, perRow: 6, strips: 3, home: HOME, col: (x, z) => ({ y: G, why: null, above: [] }), blocked: () => null, rings: [WALL.ring] })
  assert.ok(fit.ok, fit.why)
  w.set([33, G - 1, 33], 'stone')
  const fit2 = F.forestFitAt(w.read, { x0: 30, z0: 30, perRow: 6, strips: 3, home: HOME, col: (x, z) => ({ y: G, why: null, above: [] }), blocked: () => null, rings: [WALL.ring] })
  assert.strictEqual(fit2.why, 'soil')
})
await t('the siting PREFERS an existing stand of fellable trees, and refuses a tree no ground stand fells', () => {
  const w = world()
  const base = F.siteForest(w.read, { home: HOME, rings: [WALL.ring] })
  // a grove of five 5-log birches at a far site: the forest moves there (owner: "preferring existing forest")
  const grove = [[-40, -40], [-37, -39], [-34, -36], [-39, -33], [-33, -32]]
  for (const [x, z] of grove) for (let y = G + 1; y <= G + 5; y++) w.set([x, y, z], 'birch_log')
  const s = F.siteForest(w.read, { home: HOME, rings: [WALL.ring] })
  assert.ok(s.ok, s.why)
  assert.ok(s.record.trees.length >= 3, `site trees ${s.record.trees.length}`)
  assert.notDeepStrictEqual(s.record.box, base.record.box)
  for (const tr of s.record.trees) assert.ok(tr.logs.every(l => F.standReaches(tr.stand, l)), 'every site tree has a stand that fells all of it')
  // a 9-log trunk (dy +8 from any ground stand) in a candidate refuses it
  const col = (x, z) => ({ y: G, why: null, above: x === 33 && z === 33 ? [{ kind: 'tree' }] : [] })
  for (let y = G + 1; y <= G + 9; y++) w.set([33, y, 33], 'spruce_log')
  const fit = F.forestFitAt(w.read, { x0: 30, z0: 30, perRow: 6, strips: 3, home: HOME, col, blocked: () => null, rings: [WALL.ring] })
  assert.strictEqual(fit.why, 'tree_tall')
})
await t('MUTANT KILLED: a siting that does not keep the wall gap (the forest against the wall)', async () => {
  await killed('  if (!outsideRings(box, rings)) return { ok: false, why: \'walls\' }', '', M => {
    const fit = M.forestFitAt(world().read, { x0: 14, z0: -2, perRow: 6, strips: 3, home: HOME, col: () => ({ y: G, why: null, above: [] }), blocked: () => null, rings: [WALL.ring] })
    assert.strictEqual(fit.why, 'walls')
  })
})
await t('MUTANT KILLED: a zone from -64 to 320 (the in-wall farm\'s) refuses the coal under the forest', async () => {
  await killed("    zones: [{ box: [box[0] - 1, lo - 1 - FOREST.bandBelow, box[1] - 1, box[2] + 1, hi + FOREST.bandAbove, box[3] + 1], why: `project:${FOREST_PLOT}` }],",
    "    zones: [{ box: [box[0] - 1, -64, box[1] - 1, box[2] + 1, 320, box[3] + 1], why: `project:${FOREST_PLOT}` }],", M => {
      const r = M.siteForest(world().read, { home: HOME, rings: [WALL.ring] }).record
      assert.strictEqual(projectSiteHit({ x: r.box[0] + 2, y: G - 20, z: r.box[1] + 2 }, r.zones), null)
    })
})

// ---- forest-02: the siting that finds the showcase's ground (LIVE 11-06 20:38Z: no site in 7,761 tries) ---------------------------
await t('forest-02 TICKING: anchored on the walled area -- a box within simChunks - tickMargin (4) chunks of the rings\' chunks ticks, 5 does not; no walls: home\'s chunk rule as before', () => {
  const rings = [[-46, -20, 35, 39], [-40, -89, 35, -20]]   // the showcase's wall + extension: chunks x -3..2, z -6..2
  assert.strictEqual(F.FOREST.simChunks, 6, 'the showcase server\'s simulation-distance (server.properties 6; spigot.yml default)')
  assert.ok(F.boxTicks([-109, 25, -98, 42], HOME, F.FOREST.chunkR, rings), 'chunk -7: 4 from the wall chunk -3 (measured 94-100% of minutes a bot within 6)')
  assert.ok(!F.boxTicks([-125, 25, -114, 42], HOME, F.FOREST.chunkR, rings), 'chunk -8: 5 out')
  assert.ok(F.boxTicks([10, 95, 20, 105], HOME, F.FOREST.chunkR, rings), 'south: chunk 6, 4 from the wall chunk 2')
  assert.ok(!F.boxTicks([-109, 25, -98, 42], HOME), 'forest-01\'s home-chunk rule refused it (chunk -7 is 7 from home)')
  // the rings' UNION, never their bounding box (Codex r1): an L-shaped town admits no chunk 6 from every wall
  assert.ok(!F.boxTicks([-112, -112, -97, -97], HOME, F.FOREST.chunkR, [[-48, -16, 16, 16], [0, -96, 16, -16]]), 'chunk -7,-7: 6 from both rings')
  assert.ok(F.boxTicks([-112, -16, -97, -1], HOME, F.FOREST.chunkR, [[-48, -16, 16, 16], [0, -96, 16, -16]]), 'beside the first ring: ticks')
})
await t('forest-02 AXIS: rows along z keep every invariant (trunks 3 apart, one stand beside each trunk in an aisle), the box transposed', () => {
  const Lx = F.forestLayout(0, 0, { perRow: 6, strips: 2 }), Lz = F.forestLayout(0, 0, { perRow: 6, strips: 2, axis: 'z' })
  assert.deepStrictEqual([Lz.box[2] - Lz.box[0], Lz.box[3] - Lz.box[1]], [Lx.box[3] - Lx.box[1], Lx.box[2] - Lx.box[0]])
  assert.ok(F.trunksApart(Lz.plots, 3))
  for (const p of Lz.plots) { assert.strictEqual(Math.abs(p.stand[0] - p.x) + Math.abs(p.stand[1] - p.z), 1); assert.ok(Lz.aisles.has(`${p.stand[0]},${p.stand[1]}`)) }
  for (const p of Lz.plots) assert.strictEqual(Lz.stripOf(p.x, p.z), p.s, 'each trunk in its own strip')
})
await t('forest-02 TERRAIN: each strip at its own level (a hill a flight of strips, 1 apart), never two steps between strips nor a spread past 2', () => {
  // a slope rising 1 every 6 blocks of z from z=30: three strips at G, G+1, G+2
  const cells = {}
  for (let x = 25; x <= 60; x++) for (let z = 30; z <= 60; z++) { const up = Math.floor((z - 29) / 6); for (let k = 1; k <= up; k++) cells[`${x},${G + k},${z}`] = k === up ? 'grass_block' : 'dirt'; if (up) cells[`${x},${G},${z}`] = 'dirt' }
  const w = world(cells)
  const col = (x, z) => { for (let y = G + 6; y >= G - 6; y--) { const b = w.read(x, y, z); if (b && b.name !== 'air') return { y, why: null, above: [] } } return { y: null, why: 'no_ground', above: [] } }
  const fit = F.forestFitAt(w.read, { x0: 30, z0: 31, perRow: 6, strips: 3, home: HOME, col, blocked: () => null, rings: [WALL.ring] })
  assert.ok(fit.ok, fit.why)
  assert.deepStrictEqual(fit.Ws, [G, G + 1, G + 2])
  const rec = F.forestRecord(fit, { home: HOME })
  assert.deepStrictEqual(rec.strips.map(q => q.level), [G, G + 1, G + 2])
  for (const c of plotsOf(rec)) assert.strictEqual(c.at[1], rec.strips[F.stripOf(rec, c)].level, 'a plot sunk at its strip\'s level')
  for (const c of plotsOf(rec)) assert.strictEqual(c.stand[1], c.at[1] + 1)
  assert.deepStrictEqual([rec.level, rec.levelMax], [G, G + 2])
  assert.ok(rec.aisles.every(a => a.length === 3 && a[2] >= G && a[2] <= G + 2), 'each aisle cell carries its strip\'s level')
  assert.strictEqual(rec.zones[0].box[1], G - 1 - F.FOREST.bandBelow); assert.strictEqual(rec.zones[0].box[4], G + 2 + F.FOREST.bandAbove)
  // a cliff: two levels between neighbouring strips is refused (no dirt step between them)
  const c2 = {}
  for (let x = 25; x <= 60; x++) for (let z = 36; z <= 60; z++) { c2[`${x},${G + 1},${z}`] = 'dirt'; c2[`${x},${G + 2},${z}`] = 'grass_block' }
  const w2 = world(c2)
  const col2 = (x, z) => { for (let y = G + 6; y >= G - 6; y--) { const b = w2.read(x, y, z); if (b && b.name !== 'air') return { y, why: null, above: [] } } return { y: null, why: 'no_ground', above: [] } }
  assert.strictEqual(F.forestFitAt(w2.read, { x0: 30, z0: 31, perRow: 6, strips: 2, home: HOME, col: col2, blocked: () => null, rings: [WALL.ring] }).why, 'level')
})
await t('MUTANT KILLED: strips without the step rule (a 2-block cliff between strips)', async () => {
  await killed('  for (let i = 1; i < Ws.length; i++) if (Math.abs(Ws[i] - Ws[i - 1]) > F.stripStep) return { ok: false, why: \'level\' }\n', '', M => {
    const c2 = {}
    for (let x = 25; x <= 60; x++) for (let z = 36; z <= 60; z++) { c2[`${x},${G + 1},${z}`] = 'dirt'; c2[`${x},${G + 2},${z}`] = 'grass_block' }
    const w2 = world(c2)
    const col2 = (x, z) => { for (let y = G + 6; y >= G - 6; y--) { const b = w2.read(x, y, z); if (b && b.name !== 'air') return { y, why: null, above: [] } } return { y: null, why: 'no_ground', above: [] } }
    const f = M.forestFitAt(w2.read, { x0: 30, z0: 31, perRow: 6, strips: 2, home: HOME, col: col2, blocked: () => null, rings: [WALL.ring], F: { ...M.FOREST, stripSpread: 9 } })
    assert.strictEqual(f.why, 'level')
  })
})
await t('forest-02 THE SHOWCASE\'S SHAPE: water on three sides of the walls, the free ground 75-110 out -- forest-01\'s rules find nothing, forest-02 sites it', () => {
  // the showcase's walls (wall + extension); water everywhere outside them but west of x=-75 (the peninsula's land)
  const cells = {}
  const rings = [[-46, -20, 35, 39], [-40, -89, 35, -20]]
  const inR = (x, z) => rings.some(g => x >= g[0] && x <= g[2] && z >= g[1] && z <= g[3])
  for (let x = -120; x <= 120; x++) for (let z = -120; z <= 120; z++) if (!(x <= -75 && Math.abs(z) <= 30) && !inR(x, z)) cells[`${x},${G},${z}`] = 'water'
  const w = world(cells)
  const s = F.siteForest(w.read, { home: HOME, rings })
  assert.ok(s.ok, s.why)
  assert.ok(s.record.box[2] <= -75 && s.record.box[0] >= -112, `west, within rMax 112: ${s.record.box}`)
  const old = F.siteForest(w.read, { home: HOME, rings, F: { ...F.FOREST, rMax: 72, scanR: 96 } })
  assert.ok(!old.ok && /far=/.test(old.why), 'forest-01\'s reach (72): no site (the live 20:38Z refusal) ' + old.why)
})
await t('MUTANT KILLED: the ticking rule anchored on home again (the showcase\'s ground refused as unticked)', async () => {
  await killed('  if (rs.length) {\n    // every chunk of the box', '  if (false) {\n    // every chunk of the box', M => {
    assert.ok(M.boxTicks([-109, 25, -98, 42], HOME, M.FOREST.chunkR, [[-46, -20, 35, 39], [-40, -89, 35, -20]]))
  })
})
await t('forest-02 TIERS: the nearest tier with a good forest (16+ plots) wins -- open ground sites within 72; a near pocket for 12 loses to a good forest further out; a small one only when nothing good fits', () => {
  const rings = [[-46, -20, 35, 39], [-40, -89, 35, -20]]
  const inR = (x, z) => rings.some(g => x >= g[0] && x <= g[2] && z >= g[1] && z <= g[3])
  const open = F.siteForest(world().read, { home: HOME, rings })
  assert.ok(open.ok && F.boxReach(open.record.box, HOME) <= 72 && open.tier === 72, `open ground: tier 72 (${open.tier})`)
  // water everywhere but a near pocket (x -62..-50, z 44..53: room for 2 strips x 2 rows x 3 along z, 12 plots, on the scan grid) and far land (x <= -95)
  const cells = {}
  for (let x = -120; x <= 120; x++) for (let z = -120; z <= 120; z++) {
    const pocket = x >= -62 && x <= -50 && z >= 44 && z <= 53, far = x <= -95 && Math.abs(z) <= 30
    if (!pocket && !far && !inR(x, z)) cells[`${x},${G},${z}`] = 'water'
  }
  const w = world(cells)
  const s = F.siteForest(w.read, { home: HOME, rings })
  assert.ok(s.ok && s.record.counts.plots >= 16 && s.record.box[2] <= -95, `the good far forest: ${s.record?.box} ${s.record?.counts.plots}`)
  const only = {}
  for (let x = -120; x <= 120; x++) for (let z = -120; z <= 120; z++) { const pocket = x >= -62 && x <= -50 && z >= 44 && z <= 53; if (!pocket && !inR(x, z)) only[`${x},${G},${z}`] = 'water' }
  const s2 = F.siteForest(world(only).read, { home: HOME, rings })
  assert.ok(s2.ok && s2.small && s2.record.counts.plots === 12, `nothing good: the small one (${s2.why ?? s2.record?.counts.plots})`)
})
await t('MUTANT KILLED: tiers without the good-forest bar (a near 12-plot pocket beats a good forest further out)', async () => {
  await killed('      if (best && best.plots.length >= (F.goodPlots ?? 0)) return', '      if (best) return', M => {
    const rings = [[-46, -20, 35, 39], [-40, -89, 35, -20]]
    const inR = (x, z) => rings.some(g => x >= g[0] && x <= g[2] && z >= g[1] && z <= g[3])
    const cells = {}
    for (let x = -120; x <= 120; x++) for (let z = -120; z <= 120; z++) { const pocket = x >= -62 && x <= -50 && z >= 44 && z <= 53, far = x <= -95 && Math.abs(z) <= 30; if (!pocket && !far && !inR(x, z)) cells[`${x},${G},${z}`] = 'water' }
    const s = M.siteForest(world(cells).read, { home: HOME, rings })
    assert.ok(s.record.counts.plots >= 16)
  })
})
await t('forest-02 badCounter: the box\'s bad-column count equals a brute-force count; past the scan square it refuses', () => {
  const bad = (x, z) => ((x * 7 + z * 13) % 11) === 0
  const cnt = F.badCounter(-20, -20, 20, 20, bad)
  for (const b of [[-20, -20, 20, 20], [-5, 3, 7, 9], [0, 0, 0, 0], [10, -20, 20, -10]]) {
    let n = 0; for (let x = b[0]; x <= b[2]; x++) for (let z = b[1]; z <= b[3]; z++) if (bad(x, z)) n++
    assert.strictEqual(cnt(b), n, String(b))
  }
  assert.strictEqual(cnt([15, 15, 25, 25]), Infinity)
})

// ---- forest-03: the felling judged from where the bot actually stands (LIVE 11-06 22:58Z: every felling off_stand) ---------------
/** Fake effects: a walk lands where `land(target, i)` says (the live walks stopped 1-3 short); digs clear the named block. */
const fakeE = (w, { at, land }) => {
  let feet = at.slice(), i = 0
  return { feet: () => feet.slice(), walkTo: async s => { feet = land(s, i++, feet) ?? feet; return true }, dig: async (c, expect) => { if (expect && w.read(...c)?.name !== expect) return 'refused'; w.set(c, 'air'); return 'confirmed' } }
}
const tree = (w, cell, n, sp = 'spruce_log') => { for (let k = 0; k < n; k++) w.set([cell[0], cell[1] + k, cell[2]], sp); return { cell, stand: [cell[0], cell[1] + 1, cell[2] + 1], order: Array.from({ length: n }, (_, k) => [cell[0], cell[1] + n - 1 - k, cell[2]]) } }
await t('forest-03 fellStands: the recorded stand first, then every orthogonal neighbour of the trunk at its feet height on solid ground', () => {
  const w = world()
  const t1 = tree(w, [30, G, 30], 6)            // a sunk plot: the stump at G, the stand's feet at G + 1
  w.set([30, G, 30], 'spruce_log')
  const st = F.fellStands(w.read, t1)
  assert.deepStrictEqual(st[0], [30, G + 1, 31])
  assert.deepStrictEqual(st.slice(1).map(q => q.join(',')).sort(), [`29,${G + 1},30`, `31,${G + 1},30`, `30,${G + 1},29`].sort())
  w.set([31, G + 1, 30], 'stone')               // a solid block in one neighbour's feet: not a stand
  assert.ok(!F.fellStands(w.read, t1).some(q => q[0] === 31 && q[2] === 30))
  assert.ok(F.feetFells([29, G + 1, 30], t1.order) && !F.feetFells([29, G + 1, 31], t1.order), 'orthogonal yes, diagonal no')
})
await t('forest-03 fellTree: a walk that stops BESIDE the recorded stand fells from where it stopped (the live off_stand); a walk that never gets beside the trunk is off_stand', async () => {
  const w = world()
  const t1 = tree(w, [30, G, 30], 7)
  // the walk to any stand lands on the trunk's WEST neighbour (the live bots stopped one cell off the recorded stand)
  const e = fakeE(w, { at: [26, G + 1, 30], land: s => (s[0] === 30 && s[2] === 31 ? [29, G + 1, 30] : [20, G + 1, 20]) })
  const r = await F.fellTree(e, w.read, t1)
  assert.deepStrictEqual([r.n, r.why], [7, null])
  assert.deepStrictEqual(r.from, [29, G + 1, 30])
  assert.ok(t1.order.every(p => w.read(...p).name === 'air'), 'every log down')
  // a walk that stops diagonally, then two off: no stand reaches -- off_stand, nothing dug
  const w2 = world(); const t2 = tree(w2, [30, G, 30], 5)
  const e2 = fakeE(w2, { at: [26, G + 1, 26], land: (s, i) => (i % 2 ? [s[0] + 2, s[1], s[2] + 2] : [31, G + 1, 31]) })
  const r2 = await F.fellTree(e2, w2.read, t2)
  assert.deepStrictEqual([r2.n, r2.why], [0, 'off_stand'])
  assert.ok(t2.order.every(p => w2.read(...p).name === 'spruce_log'))
})
await t('forest-03 fellTree: a leaf in the stand\'s head (the walk will not dig it) is dug from where the first walk stopped, then the second walk arrives', async () => {
  const w = world()
  const t1 = tree(w, [30, G, 30], 5)
  w.set([30, G + 2, 31], 'spruce_leaves')
  const e = fakeE(w, { at: [24, G + 1, 31], land: (s, i, feet) => (w.read(s[0], s[1] + 1, s[2]).name === 'air' ? s : [28, G + 1, 31]) })
  const rows = []
  const r = await F.fellTree(e, w.read, t1, { log: d => rows.push(d) })
  assert.deepStrictEqual([r.n, r.why], [5, null])
  assert.ok(rows.some(d => d.op === 'clear' && d.kind === 'stand' && d.cell.join(',') === `30,${G + 2},31`))
  // never a leaf where the guard refuses (a marker's margin, a protected zone)
  const w3 = world(); const t3 = tree(w3, [30, G, 30], 5); w3.set([30, G + 2, 31], 'spruce_leaves')
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, -1]]) w3.set([30 + dx, G + 2, 30 + dz], 'spruce_leaves')
  const e3 = fakeE(w3, { at: [24, G + 1, 31], land: (s) => (w3.read(s[0], s[1] + 1, s[2]).name === 'air' ? s : [28, G + 1, 31]) })
  const r3 = await F.fellTree(e3, w3.read, t3, { guard: () => true })
  assert.strictEqual(r3.why, 'off_stand')
  assert.strictEqual(w3.read(30, G + 2, 31).name, 'spruce_leaves')
})
await t('MUTANT KILLED: the felling judged by feet == the recorded stand again (the live off_stand)', async () => {
  const EQ = '(g => g[0] === t.stand[0] && g[1] === t.stand[1] && g[2] === t.stand[2])(e.feet())'
  await killed('  const fells = f => feetFells(f, left(), F) && standFooting(read, f, t.stand?.[1]) && !guard(f[0], f[2])', `  const fells = f => ${EQ.replace('(e.feet())', '(f)')}`, async M => {
    const w = world()
    const t1 = tree(w, [30, G, 30], 7)
    const e = fakeE(w, { at: [26, G + 1, 30], land: s => (s[0] === 30 && s[2] === 31 ? [29, G + 1, 30] : [20, G + 1, 20]) })
    const r = await M.fellTree(e, w.read, t1)
    assert.strictEqual(r.why, null)
  })
})

// ---- forest-04: the Codex fold's five felling blockers (showcase forest-03show 1f445266) -------------------------------------------
/** Effects that record every walk target and every dig with the feet it was dug from. */
const traceE = (w, { at, land }) => {
  const E = fakeE(w, { at, land }), walks = [], digs = []
  return { walks, digs, feet: E.feet, walkTo: async s => { walks.push(s.slice()); return E.walkTo(s) }, dig: async (c, x) => { digs.push({ c: c.slice(), feet: E.feet(), name: x }); return E.dig(c, x) } }
}
const under = d => /_leaves$/.test(String(d.name)) && d.c[1] < d.feet[1] && Math.abs(d.c[0] - d.feet[0]) <= 1 && Math.abs(d.c[2] - d.feet[2]) <= 1
await t('forest-04 BLOCKER 1: fellStands keeps off reserved columns, the recorded stand too (POSITIVE CONTROL: unfiltered, all four); a walk never targets one; the bot fells from the free side', async () => {
  const w = world(); const t1 = tree(w, [30, G, 30], 6)
  assert.strictEqual(F.fellStands(w.read, t1).length, 4, 'control: four stands unfiltered')
  const res = (x, z) => (x === 30 && z === 31) || (z === 30 && (x === 29 || x === 31))   // the recorded stand, west and east: a marker's margin
  const st = F.fellStands(w.read, t1, res)
  assert.deepStrictEqual(st, [[30, G + 1, 29]])
  const e = traceE(w, { at: [26, G + 1, 30], land: s => s })
  const r = await F.fellTree(e, w.read, t1, { guard: res })
  assert.deepStrictEqual([r.n, r.why], [6, null])
  assert.ok(!res(r.from[0], r.from[2]) && e.walks.every(s => !res(s[0], s[2])), 'never walked to or felled from a reserved column')
})
await t('forest-04 BLOCKER 1 refusal chain: every stand reserved -> off_stand with no walk and no dig (a skip; keepDue keeps the tree on the third), and a bot already ON a reserved column walks to a free stand', async () => {
  const w = world(); const t1 = tree(w, [30, G, 30], 5)
  const e = traceE(w, { at: [26, G + 1, 30], land: s => s })
  const r = await F.fellTree(e, w.read, t1, { guard: () => true })
  assert.deepStrictEqual([r.n, r.why, e.walks.length, e.digs.length], [0, 'off_stand', 0, 0])
  const fails = new Map()
  assert.deepStrictEqual([1, 2, 3].map(() => F.keepDue(fails, 'plot:30,0,30', r.why)), [false, false, true], 'the third off_stand keeps the tree (waived)')
  const w2 = world(); const t2 = tree(w2, [30, G, 30], 5)
  const res = (x, z) => x === 29 && z === 30
  const e2 = traceE(w2, { at: [29, G + 1, 30], land: s => s })   // standing beside the trunk, on a marker's margin
  const r2 = await F.fellTree(e2, w2.read, t2, { guard: res })
  assert.deepStrictEqual([r2.n, r2.why], [5, null])
  assert.ok(!res(r2.from[0], r2.from[2]))
})
await t('MUTANT KILLED: fellStands without the reserved filter (an alternative on a marker margin is walked to)', async () => {
  await killed('    if (reserved(c[0], c[2])) continue\n', '', async M => {
    const w = world(); const t1 = tree(w, [30, G, 30], 6)
    const res = (x, z) => (x === 30 && z === 31) || (z === 30 && (x === 29 || x === 31))
    const e = traceE(w, { at: [26, G + 1, 30], land: s => s })
    await M.fellTree(e, w.read, t1, { guard: res })
    assert.ok(e.walks.every(s => !res(s[0], s[2])))
  })
})
await t('MUTANT KILLED: the actual feet not judged against the reserved columns (fells from a marker margin it stood on)', async () => {
  await killed(' && standFooting(read, f, t.stand?.[1]) && !guard(f[0], f[2])', ' && standFooting(read, f, t.stand?.[1])', async M => {
    const w = world(); const t1 = tree(w, [30, G, 30], 5)
    const res = (x, z) => x === 29 && z === 30
    const r = await M.fellTree(traceE(w, { at: [29, G + 1, 30], land: s => s }), w.read, t1, { guard: res })
    assert.ok(!res(r.from[0], r.from[2]))
  })
})
await t('forest-04 BLOCKER 2 (Codex repro): the ring clearing never digs the leaf the bot stands on; the bot walks down to the stand and fells', async () => {
  assert.ok(!F.clearLeafOk(world().read, [30, G + 3, 32], [30, G + 2, 32]), 'the leaf under the feet')
  assert.ok(!F.clearLeafOk(world().read, [30, G + 3, 32], [31, G + 2, 31]), 'the leaf under the bot\'s edge')
  assert.ok(F.clearLeafOk(world().read, [30, G + 3, 32], [30, G + 3, 31]), 'control: a leaf at the feet\'s height')
  const w = world(); const t1 = tree(w, [30, G, 30], 5)
  w.set([30, G + 2, 32], 'spruce_leaves')                 // a leaf in the ring round the stand (dz +1, head height) ...
  w.set([30, G + 2, 31], 'spruce_leaves')
  const e = traceE(w, { at: [30, G + 3, 32], land: s => s })   // ... the bot perched on it (Codex: stand y64, feet y66, leaf y65)
  const r = await F.fellTree(e, w.read, t1)
  assert.deepStrictEqual([r.n, r.why], [5, null])
  assert.ok(e.digs.every(d => !under(d)), 'no dig under the bot\'s feet')
})
await t('MUTANT KILLED: the clearing digs under the feet again (the Codex repro drops the bot)', async () => {
  await killed('  if (q[1] < feet[1] && Math.abs(q[0] - feet[0]) <= 1 && Math.abs(q[2] - feet[2]) <= 1) return false\n', '', async M => {
    const w = world(); const t1 = tree(w, [30, G, 30], 5)
    w.set([30, G + 2, 32], 'spruce_leaves'); w.set([30, G + 2, 31], 'spruce_leaves')
    const e = traceE(w, { at: [30, G + 3, 32], land: s => s })
    await M.fellTree(e, w.read, t1)
    assert.ok(e.digs.every(d => !under(d)))
  })
})
await t('forest-04 BLOCKER 3: a leaf holding back lava is never dug -- the bot fells from another stand; lava at every stand -> off_stand (a skip); a log beside lava -> the tree is not started', async () => {
  const w0 = world(); w0.set([30, G + 3, 31], 'lava')
  assert.ok(F.lavaBeside(w0.read, [30, G + 2, 31]) && !F.lavaBeside(w0.read, [30, G + 2, 29]) && F.lavaBeside(w0.read, [130, G, 0]), 'lava above; control none; unread counts as lava')
  const w = world(); const t1 = tree(w, [30, G, 30], 5)
  w.set([30, G + 2, 31], 'spruce_leaves'); w.set([30, G + 2, 32], 'lava')          // the recorded stand's head leaf holds lava back
  const land = (s, i, feet) => (w.read(s[0], s[1] + 1, s[2]).name === 'air' ? s : [28, G + 1, 31])
  const e = traceE(w, { at: [24, G + 1, 31], land })
  const r = await F.fellTree(e, w.read, t1)
  assert.deepStrictEqual([r.n, r.why], [5, null])
  assert.strictEqual(w.read(30, G + 2, 31).name, 'spruce_leaves', 'the lava\'s leaf stays')
  assert.ok(!(r.from[0] === 30 && r.from[2] === 31))
  const w2 = world(); const t2 = tree(w2, [30, G, 30], 5)
  for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) { w2.set([30 + dx, G + 2, 30 + dz], 'spruce_leaves'); w2.set([30 + 2 * dx, G + 2, 30 + 2 * dz], 'lava') }
  const land2 = (s) => (w2.read(s[0], s[1] + 1, s[2]).name === 'air' ? s : [27, G + 1, 31])
  const e2 = traceE(w2, { at: [24, G + 1, 31], land: land2 })
  const r2 = await F.fellTree(e2, w2.read, t2)
  assert.deepStrictEqual([r2.n, r2.why, e2.digs.length], [0, 'off_stand', 0])
  const w3 = world(); const t3 = tree(w3, [30, G, 30], 5); w3.set([30, G + 3, 29], 'lava')
  const e3 = traceE(w3, { at: [30, G + 1, 31], land: s => s })
  const r3 = await F.fellTree(e3, w3.read, t3)
  assert.deepStrictEqual([r3.n, r3.why, e3.digs.length, e3.walks.length], [0, 'lava', 0, 0])
})
await t('MUTANT KILLED: the clearing without the lava test (the lava\'s leaf is dug)', async () => {
  await killed('  if (lavaBeside(read, q)) return false\n', '', async M => {
    const w = world(); const t1 = tree(w, [30, G, 30], 5)
    w.set([30, G + 2, 31], 'spruce_leaves'); w.set([30, G + 2, 32], 'lava')
    const e = traceE(w, { at: [24, G + 1, 31], land: (s) => (w.read(s[0], s[1] + 1, s[2]).name === 'air' ? s : [28, G + 1, 31]) })
    await M.fellTree(e, w.read, t1)
    assert.strictEqual(w.read(30, G + 2, 31).name, 'spruce_leaves')
  })
  await killed("  if (left().some(p => lavaBeside(read, p))) return { n, why: 'lava', from: feetAt() }\n", '', async M => {
    const w = world(); const t1 = tree(w, [30, G, 30], 5); w.set([30, G + 3, 29], 'lava')
    const r = await M.fellTree(traceE(w, { at: [30, G + 1, 31], land: s => s }), w.read, t1)
    assert.strictEqual(r.n, 0)
  })
})
await t('forest-04 BLOCKER 4: fellReserved -- another record\'s cells (a hedge) and box are reserved, the felling\'s own records are not, the zones as before; a hedge leaf in the stand\'s head stays and the bot fells from another side', async () => {
  const hedge = { plot: 'decor', cells: [{ at: [30, G + 2, 31], role: 'hedge' }] }
  const house = { plot: 'house1', box: [40, 40, 45, 45], cells: [] }
  const mine = { plot: 'forest', box: [20, 20, 40, 40], cells: [{ at: [30, G, 30], role: 'plot' }] }
  const res = F.fellReserved({ boxes: [{ box: [50, -64, 50, 52, 320, 52] }], records: [hedge, house, mine], own: ['forest'] })
  assert.deepStrictEqual([res(30, 31), res(42, 42), res(51, 51), res(30, 30), res(25, 25)], [true, true, true, false, false])
  const w = world(); const t1 = tree(w, [30, G, 30], 5)
  w.set([30, G + 2, 31], 'oak_leaves')                    // the hedge, in the recorded stand's head
  const e = traceE(w, { at: [24, G + 1, 31], land: (s) => (w.read(s[0], s[1] + 1, s[2]).name === 'air' ? s : [28, G + 1, 31]) })
  const r = await F.fellTree(e, w.read, t1, { guard: res })
  assert.deepStrictEqual([r.n, r.why], [5, null])
  assert.strictEqual(w.read(30, G + 2, 31).name, 'oak_leaves')
})
await t('MUTANT KILLED: fellReserved without the other records\' cells (the hedge is dug)', async () => {
  await killed('    for (const c of r.cells ?? []) if (Array.isArray(c?.at) && c.at.length === 3) cols.add(k2(c.at[0], c.at[2]))\n', '', async M => {
    const res = M.fellReserved({ records: [{ plot: 'decor', cells: [{ at: [30, G + 2, 31] }] }], own: ['forest'] })
    const w = world(); const t1 = tree(w, [30, G, 30], 5); w.set([30, G + 2, 31], 'oak_leaves')
    await M.fellTree(traceE(w, { at: [24, G + 1, 31], land: (s) => (w.read(s[0], s[1] + 1, s[2]).name === 'air' ? s : [28, G + 1, 31]) }), w.read, t1, { guard: res })
    assert.strictEqual(w.read(30, G + 2, 31).name, 'oak_leaves')
  })
})
await t('forest-04 BLOCKER 5: footing -- a 2-deep pit beside the trunk and a perch on leaves are no stand (reach alone admitted both); the bot walks to the stand; a pit it cannot leave is off_stand with no log dug', async () => {
  const w0 = world(); w0.set([29, G, 30], 'spruce_leaves')
  assert.deepStrictEqual([F.standFooting(w0.read, [29, G + 1, 30], G + 1), F.standFooting(w0.read, [28, G + 1, 30], G + 1), F.standFooting(w0.read, [28, G - 1, 30], G + 1), F.standFooting(w0.read, [28, G + 2, 30], G + 1), F.standFooting(w0.read, [28, G + 3, 30], G + 1)], [false, true, false, false, false])
  const pit = () => { const w = world(); const t1 = tree(w, [30, G, 30], 6); for (const y of [G, G - 1]) w.set([29, y, 30], 'air'); return { w, t1 } }
  { const { w, t1 } = pit()
    assert.ok(F.feetFells([29, G - 1, 30], t1.order), 'control: from the pit every log is in reach')
    const r = await F.fellTree(traceE(w, { at: [29, G - 1, 30], land: s => s }), w.read, t1)
    assert.deepStrictEqual([r.n, r.why, r.from], [6, null, t1.stand]) }
  { const { w, t1 } = pit()
    const e = traceE(w, { at: [29, G - 1, 30], land: () => null })   // the walk cannot climb out
    const r = await F.fellTree(e, w.read, t1)
    assert.deepStrictEqual([r.n, r.why], [0, 'off_stand'])
    assert.ok(t1.order.every(p => w.read(...p).name === 'spruce_log')) }
  { const w = world(); const t1 = tree(w, [30, G, 30], 5); w.set([29, G, 30], 'spruce_leaves')   // a perch on leaves beside the trunk
    const r = await F.fellTree(traceE(w, { at: [29, G + 1, 30], land: s => s }), w.read, t1)
    assert.deepStrictEqual([r.n, r.why], [5, null]); assert.ok(!(r.from[0] === 29 && r.from[2] === 30)) }
})
await t('MUTANT KILLED: the felling judged by reach alone again (fells from the pit)', async () => {
  await killed('  const fells = f => feetFells(f, left(), F) && standFooting(read, f, t.stand?.[1]) && !guard(f[0], f[2])', '  const fells = f => feetFells(f, left(), F) && !guard(f[0], f[2])', async M => {
    const w = world(); const t1 = tree(w, [30, G, 30], 6); for (const y of [G, G - 1]) w.set([29, y, 30], 'air')
    const r = await M.fellTree(traceE(w, { at: [29, G - 1, 30], land: s => s }), w.read, t1)
    assert.deepStrictEqual(r.from, t1.stand)
  })
})

await t('forest-04 (Claude review): a body on a dirt path / mud (lower than a full block) stands in the cell above its floored feet -- it fells from there; unread zones are no failure keepDue counts', async () => {
  const w0 = world(); w0.set([29, G, 30], 'dirt_path')
  assert.deepStrictEqual([F.bodyFeet(w0.read, [29, G, 30]), F.bodyFeet(w0.read, [28, G + 1, 30])], [[29, G + 1, 30], [28, G + 1, 30]])
  const w = world(); const t1 = tree(w, [30, G, 30], 6); w.set([29, G, 30], 'dirt_path')
  const r = await F.fellTree(traceE(w, { at: [29, G, 30], land: () => null }), w.read, t1)   // the walk goes nowhere: it is already there
  assert.deepStrictEqual([r.n, r.why], [6, null])
  const fails = new Map()
  assert.ok([1, 2, 3, 4].every(() => !F.keepDue(fails, 'plot:1,2,3', 'zones_unknown')) && F.keepDue(new Map([['k', 2]]), 'k', 'off_stand'))
})
await t('MUTANT KILLED: the floored feet taken as the body\'s on a dirt path (off_stand)', async () => {
  await killed("  return b && b.boundingBox === 'block' && PARTIAL_GROUND.test(nm(b)) ? [feet[0], feet[1] + 1, feet[2]] : feet", '  return feet', async M => {
    const w = world(); const t1 = tree(w, [30, G, 30], 6); w.set([29, G, 30], 'dirt_path')
    const r = await M.fellTree(traceE(w, { at: [29, G, 30], land: () => null }), w.read, t1)
    assert.strictEqual(r.why, null)
  })
})

// ---- the rotation ---------------------------------------------------------------------------------------------------------------
const sited = (w = world()) => ({ w, rec: F.siteForest(w.read, { home: HOME, rings: [WALL.ring], now: 1000 }).record })
const plantAll = (w, rec) => { for (const c of plotsOf(rec)) w.set(c.at, 'spruce_sapling') }
await t('the census and ripeness: a strip is ripe at 3/4 trees (or when nothing else grows in it); the rotation harvests ONE strip at a time, oldest first, staggered by rotateMs', () => {
  const { w, rec } = sited()
  plantAll(w, rec)
  let cen = F.stripCensus(w.read, rec)
  assert.deepStrictEqual(cen.map(c => [c.sapling, c.tree, c.ripe]), [[12, 0, false], [12, 0, false], [12, 0, false]])
  // strip 2 (index 1) and strip 1 (index 0) grow; strip 1 was planted first
  for (const c of plotsOf(rec).filter(q => q.seg === 'S1').slice(0, 9)) grow(w, c, 6)
  for (const c of plotsOf(rec).filter(q => q.seg === 'S2')) grow(w, c, 6)
  cen = F.stripCensus(w.read, rec)
  assert.deepStrictEqual(cen.map(c => c.ripe), [true, true, false])
  assert.strictEqual(F.harvestStrip(cen, rec.rotation, { now: 5000 }), 0, 'the strip planted longest ago')
  // a harvest under way continues on its strip; the next waits rotateMs after the last began
  assert.strictEqual(F.harvestStrip(cen, { harvesting: 1, lastAt: 4000 }, { now: 5000 }), 1)
  const after = cen.map((c, i) => (i === 1 ? { ...c, tree: 0, ripe: false } : c))
  assert.strictEqual(F.harvestStrip(after, { harvesting: 1, lastAt: 4000 }, { now: 5000 }), null, 'no new strip inside rotateMs')
  assert.strictEqual(F.harvestStrip(after, { harvesting: 1, lastAt: 4000 }, { now: 4000 + F.FOREST.rotateMs }), 0)
  // the rotation after a felling: begun names the strip; a harvested strip is replanted-now
  const r1 = F.rotationAfter(rec, cen, { began: 0, now: 7000 })
  assert.deepStrictEqual(r1.rotation, { harvesting: 0, lastAt: 7000 })
  const r2 = F.rotationAfter({ ...rec, rotation: r1.rotation }, cen.map((c, i) => (i === 0 ? { ...c, tree: 0 } : c)), { now: 9000 })
  assert.strictEqual(r2.rotation.harvesting, null)
  assert.strictEqual(r2.strips[0].plantedAt, 9000)
})
await t('the felling: top down, the stump LAST; a branchy or too-tall tree is KEPT (big), never half felled', () => {
  const { w, rec } = sited()
  const [a, b, c] = plotsOf(rec)
  grow(w, a, 8)
  const fa = F.plotFelling(w.read, rec, a)
  assert.strictEqual(fa.big, false)
  assert.deepStrictEqual(fa.order.map(p => p[1]), [G + 7, G + 6, G + 5, G + 4, G + 3, G + 2, G + 1, G], 'top down, the stump last')
  assert.ok(fa.order.every(p => F.standReaches(a.stand, p)))
  grow(w, b, 9)
  assert.strictEqual(F.plotFelling(w.read, rec, b).big, true, 'a 9-log trunk: its top is out of reach')
  grow(w, c, 5, 'oak_log'); w.set([c.at[0] + 1, c.at[1] + 3, c.at[2]], 'oak_log')
  assert.strictEqual(F.plotFelling(w.read, rec, c).big, true, 'a branch (a fancy oak)')
  for (const q of plotsOf(rec).filter(q => q.seg === 'S1')) if (q !== a && q !== b && q !== c) grow(w, q, 6)
  const hl = F.forestHarvestList(w.read, rec, { now: 5000, max: 50 })
  assert.strictEqual(hl.strip, 0)
  assert.deepStrictEqual(hl.big.map(q => q.at.join(',')).sort(), [b.at.join(','), c.at.join(',')].sort())
  assert.ok(!hl.trees.some(x => x.key.endsWith(b.at.join(',')) || x.key.endsWith(c.at.join(','))), 'a big tree is never in the felling list')
})
await t('MUTANT KILLED: a felling order bottom up (an interrupted felling would leave floating logs)', async () => {
  await killed('  return { stand, order: [...col].reverse(), big: false }', '  return { stand, order: [...col], big: false }', M => {
    const { w, rec } = sited()
    const a = plotsOf(rec)[0]
    grow(w, a, 6)
    assert.strictEqual(M.plotFelling(w.read, rec, a).order[0][1], G + 5)
  })
})
await t('the due test is PERPETUAL and honest: a ripe strip, an open plot only with a sapling to hand, aisle leaves, a drop; nothing else', () => {
  const { w, rec } = sited()
  assert.strictEqual(F.forestDue(w.read, rec, { saplings: 0 }), null, 'every plot open but no sapling anywhere: no visit (the visit could only wait)')
  assert.strictEqual(F.forestDue(w.read, rec, { saplings: 5 }), 'replant')
  plantAll(w, rec)
  assert.strictEqual(F.forestDue(w.read, rec, { saplings: 5 }), null, 'all planted: nothing to do now')
  for (const c of plotsOf(rec).filter(q => q.seg === 'S3')) grow(w, c, 6)
  assert.strictEqual(F.forestDue(w.read, rec, { now: 5000 }), 'harvest', 'the trees grew: the forest is due again (never complete into silence)')
  assert.strictEqual(F.forestDue(w.read, rec, { now: 5000, skip: k => k.startsWith('plot:') }), null, 'this bot\'s failed trees are skipped')
  const ai = rec.aisles[0]
  w.set([ai[0], G + 2, ai[1]], 'spruce_leaves')
  assert.strictEqual(F.forestDue(w.read, rec, { now: 5000, skip: k => k.startsWith('plot:') }), null, 'aisle leaves are no due of their own (a living crown fills the aisle for good: r1)')
  assert.strictEqual(F.forestDue(w.read, rec, { now: 5000, skip: k => k.startsWith('plot:'), drops: 2 }), 'sweep')
  assert.strictEqual(F.forestDue(w.read, rec, { now: 5000, skip: () => true, retire: true }), 'retire', 'the in-wall farm\'s retirement keeps the forest due (Codex r1)')
})
await t('MUTANT KILLED: a due test that offers an open plot with no sapling to hand (the keeper would loop on a visit that can only wait)', async () => {
  await killed('  if (saplings > 0) for (const c of forestPlots(rec)) {', '  if (true) for (const c of forestPlots(rec)) {', M => {
    const w = world()
    const rec = M.siteForest(w.read, { home: HOME, rings: [WALL.ring] }).record
    assert.strictEqual(M.forestDue(w.read, rec, { saplings: 0 }), null)
  })
})
await t('THE FOOTPRINT: the trunk column is priced for walks, the stand and the aisle are NOT (the in-wall farm\'s harvest failed 215/215 on its own footprint)', () => {
  const { rec } = sited()
  const fp = F.forestFootprint(rec)
  const a = plotsOf(rec)[0]
  const cost = (x, y, z) => SHOP.footprintCost(fp, 'walk', { position: { x, y, z } })
  assert.strictEqual(cost(a.at[0], a.at[1] + 3, a.at[2]), 100, 'a walk never digs the trunk')
  assert.strictEqual(cost(a.at[0], a.at[1] - 1, a.at[2]), 100, 'nor its soil')
  assert.strictEqual(cost(a.stand[0], a.stand[1] + 1, a.stand[2]), 0, 'a walk may dig the leaves in a stand')
  for (const [x, z] of rec.aisles) assert.ok(!fp.has(`${x},${G + 1},${z}`) && !fp.has(`${x},${G + 2},${z}`), 'no aisle cell priced')
  // the old farm's footprint priced its own trunk cells: the reason its harvest never worked
  const farm = { cells: [{ at: [0, 67, 0], role: 'plot' }] }
  assert.strictEqual(SHOP.footprintCost(TF.farmFootprint(farm), 'gather', { position: { x: 0, y: 70, z: 0 } }), 100)
})

// ---- outside trees, replanted in the rows ---------------------------------------------------------------------------------------
await t('the groundskeeper\'s felled outside trees: replanted in the forest\'s open plots in row order, never in the strip being harvested; the rest as before', () => {
  const { w, rec } = sited()
  const open = plotsOf(rec)
  for (const c of open.slice(2)) w.set(c.at, 'spruce_sapling')
  for (const c of open.slice(0, 2)) w.set(c.at, 'air')            // two harvested plots, dug and empty (grass under the floor is no plot yet)
  const trees = [{ col: [90, 90], name: 'spruce_log' }, { col: [91, 90], name: 'birch_log' }, { col: [92, 90], name: 'spruce_log' }]
  const fr = F.forestReplantCells(w.read, rec, trees)
  assert.deepStrictEqual(fr.map(q => q.cell.join(',')), [open[0].at.join(','), open[1].at.join(',')], 'the two open plots, in row order')
  assert.strictEqual(fr[1].sapling, 'birch_sapling', 'the felled tree\'s own species')
  assert.ok(fr.every(q => q.forest && q.state === 'pending'))
  // the strip being harvested keeps its own plots
  assert.deepStrictEqual(F.forestReplantCells(w.read, { ...rec, rotation: { harvesting: 0, lastAt: 1 } }, trees), [])
  // tidy.mjs replantCells: the forest first, the rest where it put them before (never in the forest's columns)
  const land = { home: HOME, zones: { E: 'treefarm', W: 'wild', N: 'wild', S: 'wild', NE: 'wild', NW: 'wild', SE: 'wild', SW: 'wild' }, ringR: 10, workR: 60, corridors: [] }
  const rp = TIDY.replantCells(w.read, land, trees, { forest: rec })
  assert.strictEqual(rp.length, 3)
  assert.deepStrictEqual(rp.slice(0, 2).map(q => q.cell.join(',')), fr.map(q => q.cell.join(',')))
  assert.ok(!rp[2].forest, 'the third goes to the land plan\'s zones')
  assert.deepStrictEqual(TIDY.replantCells(w.read, land, trees).map(q => !!q.forest), [false, false, false], 'no forest: exactly as before')
  // only the plots the tidy's own walk reaches (forestR)
  assert.deepStrictEqual(TIDY.replantCells(w.read, land, trees, { forest: rec, forestR: 5 }).map(q => !!q.forest), [false, false, false], 'a forest past the tidy\'s walk takes no debt')
})
await t('MUTANT KILLED: replantCells that ignores the forest (the owner\'s "replant in an clean organized way")', async () => {
  await killed('  if (forest && land?.home && trees.length) {\n    const fr = forestReplantCells(read, forest, trees, { home: land.home, maxR: forestR })', '  if (false) {\n    const fr = forestReplantCells(read, forest, trees, { home: land.home, maxR: forestR })', async M => {
    const { w, rec } = sited()
    w.set(plotsOf(rec)[0].at, 'air')
    const land = { home: HOME, zones: { E: 'treefarm', W: 'wild', N: 'wild', S: 'wild', NE: 'wild', NW: 'wild', SE: 'wild', SW: 'wild' }, ringR: 10, workR: 60, corridors: [] }
    const rp = M.replantCells(w.read, land, [{ col: [90, 90], name: 'spruce_log' }], { forest: rec })
    assert.ok(rp[0]?.forest)
  }, TIDY_PATH, TIDY)
})

// ---- the in-wall farm, retired; the garden ------------------------------------------------------------------------------------
/** The live showcase farm's shape: flat plots one above a level floor at L, 4 apart, a torch between. */
function oldFarm (w, L = G) {
  const cells = []
  for (const [x, z] of [[-30, 6], [-26, 6], [-30, 10], [-26, 10]]) { cells.push({ at: [x, L, z], role: 'soil' }); cells.push({ at: [x, L + 1, z], role: 'plot' }) }
  cells.push({ at: [-28, L + 1, 8], role: 'light' })
  return { v: 1, blueprint: 'treefarm@1', plot: 'treefarm', box: [-32, 4, -24, 12], cells, trees: [], structure_complete: true, state: 'complete', level: L }
}
await t('a KEPT (waived) site tree still holds its columns: the build never cuts under it (Claude r2)', () => {
  const w = world()
  const rec = { trees: [{ base: [5, G + 1, 5], logs: [[5, G + 1, 5], [5, G + 2, 5]] }], waived: { 'site:5,70,5': { why: 'off_stand' } } }
  rec.waived = { [`site:5,${G + 1},5`]: { why: 'off_stand' } }
  for (const l of rec.trees[0].logs) w.set(l, 'spruce_log')
  assert.strictEqual(F.siteTreesStanding(w.read, rec).length, 0, 'not felled')
  assert.ok(F.siteHeldCols(F.siteTreesHolding(w.read, rec)).has('5,5'), 'but held')
})
// ---- the keeper's order --------------------------------------------------------------------------------------------------------
await t('the KEEPER works the forest FIRST while it wants work (due read as open), the tidy otherwise; every other bot never sees it', () => {
  const list = [{ plot: 'shop' }, { plot: 'monument' }, { plot: 'forest' }, { plot: 'tidy' }]
  const st = (f, ti = {}) => [{ plot: 'shop', exists: true, complete: true }, { plot: 'monument', exists: true, complete: false }, { plot: 'forest', ...f }, { plot: 'tidy', exists: true, complete: true, due: true, ...ti }]
  const due = GKM.keeperOrderPure(st({ exists: true, complete: true, due: true }), list, { d: 'mine', forestPlot: 'forest' })
  assert.deepStrictEqual(due.order.map(p => p.plot).slice(0, 2), ['forest', 'tidy'])
  assert.strictEqual(due.states[2].complete, false, 'its due reads open: the order takes it before every open project')
  const idle = GKM.keeperOrderPure(st({ exists: true, complete: true, due: false }), list, { d: 'mine', forestPlot: 'forest' })
  assert.deepStrictEqual(idle.order.map(p => p.plot)[0], 'tidy')
  const wait = GKM.keeperOrderPure(st({ exists: false, waiting: true }), list, { d: 'mine', forestPlot: 'forest' })
  assert.deepStrictEqual(wait.order.map(p => p.plot)[0], 'tidy', 'an unsited forest waiting on a failed siting never takes the keeper\'s order')
  const unsited = GKM.keeperOrderPure(st({ exists: false }), list, { d: 'mine', forestPlot: 'forest' })
  assert.deepStrictEqual(unsited.order.map(p => p.plot)[0], 'forest', 'an unsited forest is sited first')
  const other = GKM.keeperOrderPure(st({ exists: true, complete: false }), list, { d: 'other', forestPlot: 'forest' })
  assert.strictEqual(other.states[2].free, false)
  assert.strictEqual(other.states[2].complete, true, 'an open forest reads standing to every other bot (never its open[0] fallback)')
  assert.deepStrictEqual(other.order, list)
  assert.strictEqual(GKM.keeperOrderPure(st({ exists: false }), list, { d: 'other', forestPlot: 'forest' }).states[2].complete, true, 'another bot never sites it either')
  const SHOPM = SHOP
  const pick = SHOPM.activeProject(other.states.map((q, i) => (i === 1 ? { ...q, complete: true } : q)), list)
  assert.notStrictEqual(pick.plot, 'forest', 'activeProject never offers the forest to another bot')
  const idleK = GKM.keeperOrderPure(st({ exists: true, complete: true, due: true, idle: true }), list, { d: 'mine', forestPlot: 'forest' })
  assert.strictEqual(idleK.order[0].plot, 'tidy', 'a forest this keeper just found nothing to do at rests (idle)')
  assert.strictEqual(GKM.keeperWanted(st({ exists: true, complete: true, due: true }, { due: false }), { forestPlot: 'forest' }), true, 'the forest alone keeps the keeper')
  assert.strictEqual(GKM.keeperWanted(st({ exists: true, complete: true, due: false }, { due: false }), { forestPlot: 'forest' }), false)
  // no forest plot: exactly as before
  assert.deepStrictEqual(GKM.keeperOrderPure(st({ exists: true, complete: true, due: true }), list, { d: 'mine' }).order.map(p => p.plot)[0], 'tidy')
})
await t('MUTANT KILLED: a keeper order that leaves the forest behind the open projects (the in-wall farm\'s starvation)', async () => {
  await killed('  if (d === \'mine\' && forestP && forestWants(out[fi])) {', '  if (false) {', M => {
    const list = [{ plot: 'shop' }, { plot: 'forest' }, { plot: 'tidy' }]
    const r = M.keeperOrderPure([{ plot: 'shop', exists: true, complete: true }, { plot: 'forest', exists: true, complete: true, due: true }, { plot: 'tidy', exists: true, complete: true }], list, { d: 'mine', forestPlot: 'forest' })
    assert.strictEqual(r.order[0].plot, 'forest')
  }, GK_PATH, GKM)
})
await t('BUILT END TO END by buildrun.mjs runVisit: the floor filled, each plot\'s ground dug and a sapling SUNK in it, every placement on the record; no sapling: no plot dug', async () => {
  // a 2-strip forest on the fake server (flat grass at G over dirt), a pit to fill in the box
  const x0 = 20, z0 = 20
  const cells = {}
  for (let x = x0 - 2; x <= x0 + 20; x++) for (let z = z0 - 2; z <= z0 + 14; z++) cells[`${x},${G - 1},${z}`] = 'dirt'
  cells[`${x0 + 1},${G},${z0 + 1}`] = 'air'
  const srv = server(cells)
  const col = (x, z) => { for (let y = G + 5; y >= G - 6; y--) { const b = srv.read(x, y, z); if (b && b.name !== 'air') return { y, why: null, above: [] } } return { y: null, why: 'no_ground', above: [] } }
  const fit = F.forestFitAt(srv.read, { x0, z0, perRow: 6, strips: 2, home: HOME, col, blocked: () => null, rings: [[-5, -5, 5, 5]] })
  assert.ok(fit.ok, fit.why)
  const rec = F.forestRecord(fit, { home: HOME, species: 'spruce_sapling', now: 1 })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forest-'))
  const key = PJ.projKey(HOME, F.FOREST_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const palette = F.forestPalette(rec.species)
  // first: a builder with dirt but NO sapling -- the floor is filled, no plot's ground is dug (no hole without its sapling)
  const poor = bot(srv, 'P', { inv: { dirt: 8 }, feet: [x0 - 1, G + 1, z0 - 1] })
  const slot0 = PJ.takeSlot(dir, key, 'P', 1)
  await R.runVisit({ dir, key, me: 'P', home: HOME, stood: [], record: F.forestBuildRecord(rec, srv.read, { saplings: 0 }), recordGen: pub.gen, palette, slot: slot0.slot, slotGen: slot0.gen,
    domain: () => true, foreign: F.FOREST_FOREIGN, blockLayer: false, clearMax: 60, alsoDone: F.forestAlsoDone, stands: { pending: null, bans: {} } }, poor, { maxSteps: 300 })
  PJ.releaseLease(dir, key, `slot${slot0.slot}`, 'P', slot0.gen)
  assert.notStrictEqual(srv.read(x0 + 1, G, z0 + 1).name, 'air', 'the pit filled')
  const holes = plotsOf(rec).filter(c => srv.read(...c.at).name === 'air')
  assert.strictEqual(holes.length, 0, `no plot dug without a sapling to put in it (${holes.length})`)
  // then the keeper with saplings: every plot planted, sunk in the floor
  const kb = bot(srv, 'K', { inv: { spruce_sapling: 30, dirt: 4 }, feet: [x0 - 1, G + 1, z0 - 1] })
  for (let round = 0; round < 12; round++) {
    const slot = PJ.takeSlot(dir, key, 'K', 1)
    const v = await R.runVisit({ dir, key, me: 'K', home: HOME, stood: [], record: F.forestBuildRecord(rec, srv.read, { saplings: 30 }), recordGen: pub.gen, palette, slot: slot.slot, slotGen: slot.gen,
      domain: () => true, foreign: F.FOREST_FOREIGN, blockLayer: false, clearMax: 60, alsoDone: F.forestAlsoDone, stands: (kb.stands ??= { pending: null, bans: {} }) }, kb, { maxSteps: 300 })
    PJ.releaseLease(dir, key, `slot${slot.slot}`, 'K', slot.gen)
    if (v.stop === 'complete') break
  }
  const cen = F.stripCensus(srv.read, rec)
  assert.deepStrictEqual(cen.map(c => c.sapling), [12, 12])
  for (const c of plotsOf(rec)) assert.strictEqual(srv.read(c.at[0], c.at[1] - 1, c.at[2]).name, 'dirt', 'the sapling on its soil, one below the floor')
  const recKeys = new Set(rec.cells.map(c => c.at.join(',')))
  const rows = [...poor.logs, ...kb.logs].filter(([k]) => k === '_build').map(([, d]) => d)
  for (const d of rows.filter(d => d.op === 'place')) assert.ok(recKeys.has(d.cell.join(',')), `off record ${d.cell}`)
  for (const d of rows.filter(d => d.op === 'clear')) assert.ok(d.kind === 'foreign' ? recKeys.has(d.cell.join(',')) : (rec.clear ?? []).some(q => q.at.join(',') === d.cell.join(',')), `clear outside ${d.cell} ${d.kind}`)
  // a grown tree is DONE for the build (the harvest fells it from its stand): no clear in its column
  const a = plotsOf(rec)[0]
  grow(srv, a, 7)
  srv.set(plotsOf(rec)[1].at, 'air')
  const before = kb.logs.length
  const slot = PJ.takeSlot(dir, key, 'K', 1)
  await R.runVisit({ dir, key, me: 'K', home: HOME, stood: [], record: F.forestBuildRecord(rec, srv.read, { saplings: 10 }), recordGen: pub.gen, palette, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, foreign: F.FOREST_FOREIGN, blockLayer: false, clearMax: 60, alsoDone: F.forestAlsoDone, stands: kb.stands }, kb, { maxSteps: 300 })
  assert.strictEqual(TF.plotState(srv.read, plotsOf(rec)[1]), 'sapling', 'the felled plot replanted')
  assert.ok(!kb.logs.slice(before).some(([k, d]) => k === '_build' && d.op === 'clear' && d.cell[0] === a.at[0] && d.cell[2] === a.at[2]), 'the build never fells a grown tree')
})

await t('MUTANT KILLED: a build record that keeps every plot (the visit would dig the floor out of plots it has no sapling for)', async () => {
  await killed('    if (n > 0 && s !== \'unknown\') { want.add(k2(c.at[0], c.at[2])); n-- }', '    if (s !== \'unknown\') { want.add(k2(c.at[0], c.at[2])); n-- }', M => {
    const { w, rec } = sited()
    const b = M.forestBuildRecord(rec, w.read, { saplings: 2 })
    assert.strictEqual(b.cells.filter(c => c.role === 'plot').length, 2)
    assert.strictEqual(b.cells.filter(c => c.role === 'soil').length, 2)
  })
})
// ---- the wiring (structural: strip comments, anchor on the executable line) -----------------------------------------------------
const code = file => readFileSync(file, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n')

// ---- the wiring (structural: strip comments, anchor on the executable line) -----------------------------------------------------
await t('WIRED (fleet): the visit dispatched, the due upkeep read, the footprint priced, the keeper order and the replant routing passed the forest', () => {
  const s = code(SKILLS_PATH)
  assert.ok(/if \(proj\.plot === FOREST_PLOT\) return buildForest\(ctx, args, signal\)/.test(s), 'dispatch')
  assert.ok(/if \(r\.blueprint === FOREST_BLUEPRINT\) return tidy && !!forestDueFor\(bot, r\)/.test(s), 'the due upkeep')
  assert.ok(/else if \(r\.blueprint === FOREST_BLUEPRINT\) \{ for \(const k of forestFootprint\(r\)\) fp\.add\(k\) \}/.test(s), 'the footprint')
  assert.ok(/grounds: GKFS\.idle && groundsBatchOpen\(\), forestPlot \}\)/.test(s), 'the keeper order')
  assert.ok(/keeperWanted\(states, \{ shopPlot: SHOP_PLOT, tidyPlot: TIDY_PLOT, crew: GKFS\.crew, forestPlot \}\)/.test(s), 'the keeper lease kept')
  assert.ok(/level: GKFS\.level, dead, forest: forestRecNow\(\) \}\)/.test(s), 'the stage siting passes the forest')
  assert.ok(/domain: \(\) => true, walkR: forestWalkR\(rec, home\), foreign: FOREST_FOREIGN/.test(s), 'the build walks as far as the forest')
  assert.ok(/siteHeldCols\(siteTreesHolding\(read, rec\)\)/.test(s), 'kept site trees hold their columns')
  const fell = s.slice(s.indexOf('async function forestFell'), s.indexOf('async function buildForest'))
  assert.ok(/const r = await fellTree\(e, farmRead\(bot\), t, \{ deadline, guard: guarded,/.test(fell) && !/collectManually/.test(fell), 'forest-03: forest.mjs fellTree, the zone guard passed')
  // forest-04: the guard is fellReserved over every other record (the forest's own excluded), null on unread zones -> nothing felled
  const lg = s.slice(s.indexOf('function fellLeafGuard ('), s.indexOf('async function forestFell'))
  assert.ok(/guarded \?\?= fellLeafGuard\(bot, \[FOREST_PLOT, project\]\)\n\s*if \(!guarded\) return \{ n: 0, why: 'zones_unknown' \}/.test(fell) && /if \(!zv\?\.known\) return null/.test(lg) && /return fellReserved\(\{ boxes: zv\.zones \?\? \[\], records: projectHeads\(\)\.map\(x => x\.head\?\.rec\)\.filter\(Boolean\), own \}\)/.test(lg), 'forest-04: the reserved columns and the null guard')
  assert.ok(/const v = await e\.dig\(p, nm\(b\)\)/.test(readFileSync(FOREST_PATH, 'utf8')))
  const tidy = code(TIDY_PATH)
  assert.ok(/replantCells\(read, land, road\.trees, \{ avoid, cells, forest, forestR: tidyWalkR\(record\) - 2 \}\)/.test(tidy), 'the road trees')
  assert.ok(/p\.plot === TREEFARM_PLOT \? farm && paths && on && !forest :/.test(code(SHOP_PATH)), 'the in-wall farm leaves the order')
})

console.log(`\nforest: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
