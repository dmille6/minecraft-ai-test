// TREEFARM-04: THE TOWN TREE FARM (bots/src/treefarm.mjs), pure and on the fake server: the switch and the species; the siting (a
// levelled 4x4 grid off every reservation, inside the bounds, at least rMin from home; the pit filled and the pillar cut; a trunk in
// the box listed for the harvest, a tall one refusing the site; a plot whose room is blocked LEFT OUT; the lights the town spares;
// the front facing home); the plot states, the harvest order (the stump LAST: it is the stance for the top logs) and the due test;
// the record BUILT END TO END by buildrun.mjs runVisit with fake builders -- then a grown tree is NEVER taken by the build (the
// harvest's: alsoDone) and a harvested plot is replanted; the project's place in shop.mjs's order; the paths reach its front; and
// the wiring in skills.mjs. Mutants assert their anchors present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const F = await import('../src/treefarm.mjs')
const SHOP = await import('../src/shop.mjs')
const P = await import('../src/paths.mjs')

const TF_PATH = new URL('../src/treefarm.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
/** A mutant of treefarm.mjs (anchor present and unique: CLAUDE.md), imported from the test directory. */
async function withMutant (old, neu, fn, file = TF_PATH) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (old, neu, scenario) => {
  await scenario(F)
  let k = false
  await withMutant(old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, 'the mutant survived')
}
const roles = rec => rec.cells.reduce((m, c) => (m[c.role] = (m[c.role] ?? 0) + 1, m), {})
/** The bounds that admit exactly one 4x4 candidate with its first plot at (x0, z0). */
const only = (x0, z0) => F.farmBox(x0, z0, 4, 4)

await t('the switch: on in the showcase pool by default, off in a fleet pool, TREEFARM=on|off wins', () => {
  assert.strictEqual(F.treefarmOn({}, 'showcase'), true)
  assert.strictEqual(F.treefarmOn({}, 'hive-a'), false)
  assert.strictEqual(F.treefarmOn({ TREEFARM: 'on' }, 'hive-a'), true)
  assert.strictEqual(F.treefarmOn({ TREEFARM: 'off' }, 'showcase'), false)
  assert.strictEqual(F.treefarmOn({ TREEFARM_POOLS: 'board-a' }, 'board-a'), true)
})
await t('the species: the farm sapling held most (town + bag), else the native log\'s, else birch; never a 2x2 or bent species', () => {
  assert.strictEqual(F.pickSpecies({ spruce_sapling: 31, oak_sapling: 2 }), 'spruce_sapling')
  assert.strictEqual(F.pickSpecies({ dark_oak_sapling: 40, oak_sapling: 1 }), 'oak_sapling')
  assert.strictEqual(F.pickSpecies({}, 'spruce_log'), 'spruce_sapling')
  assert.strictEqual(F.pickSpecies({}, 'acacia_log'), 'birch_sapling')
  assert.deepStrictEqual(F.farmPalette('spruce_sapling').plot[0], 'spruce_sapling')
  assert.ok(!F.FARM_SPECIES.includes('dark_oak_sapling') && !F.FARM_SPECIES.includes('acacia_sapling'))
})
await t('the siting on open ground: a 4x4 grid, 16 plots one above the level, the lights the town spares, the front facing home', () => {
  const srv = server()
  const s = F.siteFarm(srv.read, { home: HOME, lights: 9, species: 'spruce_sapling' })
  assert.ok(s.ok, s.why)
  const r = s.record
  assert.deepStrictEqual(r.grid, [4, 4])
  assert.strictEqual(r.level, G)
  assert.deepStrictEqual(roles(r), { soil: 16, plot: 16, light: 9 })
  for (const c of r.cells.filter(q => q.role === 'plot')) assert.strictEqual(c.at[1], G + 1)
  for (const c of r.cells.filter(q => q.role === 'soil')) assert.strictEqual(c.at[1], G)
  // spacing 4 between plot columns; every light at manhattan <= 5 (horizontal 4 + 1 up) from the light cell of its four plots
  const plots = r.cells.filter(q => q.role === 'plot')
  for (const l of r.cells.filter(q => q.role === 'light')) {
    const near = plots.filter(p => Math.abs(p.at[0] - l.at[0]) + Math.abs(p.at[2] - l.at[2]) + Math.abs((p.at[1] + 1) - l.at[1]) <= 5)
    assert.strictEqual(near.length, 4, `light ${l.at} reaches ${near.length} saplings at light >= 9`)
  }
  const [bx0, bz0, bx1, bz1] = r.box
  const nx = Math.max(bx0, Math.min(0, bx1)), nz = Math.max(bz0, Math.min(0, bz1))
  assert.ok(Math.hypot(nx, nz) >= F.FARM.rMin, 'the box keeps off the town core')
  for (const [x, z] of r.front) assert.ok(x < bx0 || x > bx1 || z < bz0 || z > bz1, 'the front is outside the box')
  const d = ([x, z]) => Math.hypot(x, z)
  assert.ok(Math.min(...r.front.map(d)) < Math.hypot((bx0 + bx1) / 2, (bz0 + bz1) / 2), 'the front is on the side facing home')
  assert.strictEqual(F.siteFarm(srv.read, { home: HOME, lights: 0 }).record.cells.filter(c => c.role === 'light').length, 0, 'no torches spared: no light cells')
  assert.deepStrictEqual(F.siteFarm(srv.read, { home: HOME, lights: 9, species: 'spruce_sapling' }).record, r, 'deterministic')
})
await t('the siting keeps off every reservation and inside the bounds', () => {
  const srv = server()
  const blocked = (x, z) => (x >= -40 && x <= 40 && z >= -40 && z <= 8 ? 'plan_box' : null)
  const r = F.siteFarm(srv.read, { home: HOME, blocked, bounds: [-45, -45, 45, 45] }).record
  const [bx0, bz0, bx1, bz1] = r.box
  for (let x = bx0; x <= bx1; x++) for (let z = bz0; z <= bz1; z++) assert.strictEqual(blocked(x, z), null, `${x},${z}`)
  assert.ok(bx0 >= -45 && bz0 >= -45 && bx1 <= 45 && bz1 <= 45)
  const none = F.siteFarm(srv.read, { home: HOME, blocked: () => 'zone' })
  assert.ok(!none.ok && /box=/.test(none.why), none.why)
})
await t('THE FLOOR: a pit inside the box is filled to the level and a pillar is cut, both listed; past fillMax the site is refused', () => {
  const cells = {}
  const x0 = 12, z0 = 12
  cells[`${x0 + 2},${G},${z0 + 2}`] = 'air'; cells[`${x0 + 2},${G - 1},${z0 + 2}`] = 'air'            // a 2-deep pit (walkway)
  cells[`${x0 + 6},${G + 1},${z0 + 2}`] = 'dirt'; cells[`${x0 + 6},${G + 2},${z0 + 2}`] = 'cobblestone' // a pillar
  const srv = server(cells)
  const r = F.siteFarm(srv.read, { home: HOME, bounds: only(x0, z0) }).record
  assert.ok(r, 'sited')
  const floor = r.cells.filter(c => c.role === 'floor').map(c => c.at.join(','))
  assert.deepStrictEqual(floor.sort(), [`${x0 + 2},${G - 1},${z0 + 2}`, `${x0 + 2},${G},${z0 + 2}`].sort())
  const cuts = r.clear.filter(c => c.kind === 'cut').map(c => `${c.at.join(',')}:${c.name}`)
  assert.deepStrictEqual(cuts.sort(), [`${x0 + 6},${G + 1},${z0 + 2}:dirt`, `${x0 + 6},${G + 2},${z0 + 2}:cobblestone`].sort())
  assert.strictEqual(r.segments[0].seg, 'F')
  assert.ok(r.segments.slice(1).every(s => s.deps.includes('F')), 'every row and the lights wait on the floor')
  // a 7-deep shaft in the box: past fillMax
  const deep = {}
  for (let y = G - 6; y <= G; y++) deep[`${x0 + 2},${y},${z0 + 2}`] = 'air'
  const s2 = F.siteFarm(server(deep).read, { home: HOME, bounds: only(x0, z0) })
  assert.ok(!s2.ok && /level=/.test(s2.why), s2.why)
})
await t('THE TREES: a trunk in the box is listed for the harvest (base first in the list); one past the stump\'s reach refuses the site', () => {
  const x0 = 12, z0 = 12
  const tree = (top, at = [x0 + 2, z0 + 2]) => { const c = {}; for (let y = G + 1; y <= top; y++) c[`${at[0]},${y},${at[1]}`] = 'spruce_log'; c[`${at[0] + 1},${top},${at[1]}`] = 'spruce_leaves'; return c }
  const r = F.siteFarm(server(tree(G + 7)).read, { home: HOME, bounds: only(x0, z0) }).record
  assert.strictEqual(r.trees.length, 1)
  assert.deepStrictEqual(r.trees[0].base, [x0 + 2, G + 1, z0 + 2])
  assert.strictEqual(r.trees[0].logs.length, 7)
  const tall = F.siteFarm(server(tree(G + 9 + F.FARM.reach)).read, { home: HOME, bounds: only(x0, z0) })
  assert.ok(!tall.ok && /tree_tall=/.test(tall.why), tall.why)
})
await t('THE ROOM: a log the farm does not fell (floating, apart from the trunk it fells) in a plot\'s room leaves that plot out; leaves do not', () => {
  const x0 = 12, z0 = 12
  const w = { [`${x0 + 1},${G + 1},${z0}`]: 'spruce_log', [`${x0 + 1},${G + 2},${z0}`]: 'spruce_log', [`${x0 + 1},${G + 6},${z0}`]: 'spruce_log' }
  const s1 = F.siteFarm(server(w).read, { home: HOME, bounds: only(x0, z0) }).record
  assert.strictEqual(s1.counts.plots, 15)
  assert.ok(!s1.cells.some(c => c.role === 'plot' && c.at[0] === x0 && c.at[2] === z0))
  assert.strictEqual(s1.trees.length, 1, 'the trunk at the ground is felled; the floating log is not its')
  const s3 = F.siteFarm(server({ [`${x0},${G + 6},${z0}`]: 'spruce_leaves', [`${x0 + 1},${G + 3},${z0}`]: 'spruce_leaves' }).read, { home: HOME, bounds: only(x0, z0) }).record
  assert.strictEqual(s3.counts.plots, 16, 'leaves are no obstruction (measured: sapling-clearance)')
})
await t('the plot states, the harvest order (stump LAST), a site tree (base last), the list\'s skip, and the due test', () => {
  const srv = server()
  const cell = { at: [5, G + 1, 5], role: 'plot' }
  const rd = srv.read
  assert.strictEqual(F.plotState(rd, cell), 'open')
  srv.set([5, G + 1, 5], 'spruce_sapling'); assert.strictEqual(F.plotState(rd, cell), 'sapling')
  srv.set([5, G + 1, 5], 'dark_oak_sapling'); assert.strictEqual(F.plotState(rd, cell), 'blocked')
  for (let y = G + 1; y <= G + 8; y++) srv.set([5, y, 5], 'spruce_log')
  assert.strictEqual(F.plotState(rd, cell), 'tree')
  const order = F.harvestOrder(rd, cell)
  assert.strictEqual(order.length, 8)
  assert.deepStrictEqual(order.at(-1), [5, G + 1, 5], 'the stump last')
  assert.deepStrictEqual(order[0], [5, G + 2, 5], 'the log above it first')
  assert.deepStrictEqual(F.siteTreeOrder({ logs: [[1, 72, 1], [1, 70, 1], [1, 71, 1]] }), [[1, 71, 1], [1, 72, 1], [1, 70, 1]])
  const rec = { cells: [{ at: [4, G, 5], role: 'soil' }, cell, { at: [7, G + 1, 7], role: 'light' }], trees: [] }
  assert.strictEqual(F.farmDue(rd, rec), 'harvest')
  assert.strictEqual(F.farmDue(rd, rec, { skip: k => k === 'plot:5,70,5' }), 'light', 'a skipped tree is no harvest; the open light still is')
  for (let y = G + 1; y <= G + 8; y++) srv.set([5, y, 5], 'air')
  assert.strictEqual(F.farmDue(rd, rec), 'replant')
  srv.set([5, G + 1, 5], 'spruce_sapling'); srv.set([7, G + 1, 7], 'torch')
  assert.strictEqual(F.farmDue(rd, rec), null, 'a planted farm with its torch: nothing due')
  assert.strictEqual(F.farmAlsoDone(cell, rd), false)
  srv.set([5, G + 1, 5], 'spruce_log'); assert.strictEqual(F.farmAlsoDone(cell, rd), true, 'a grown tree is done for the build')
})
await t('MUTANT KILLED: a harvest that digs the stump FIRST', async () => {
  await killed('  return [...up, [x, y, z]]', '  return [[x, y, z], ...up]', M => {
    const srv = server()
    for (let y = G + 1; y <= G + 5; y++) srv.set([5, y, 5], 'spruce_log')
    assert.deepStrictEqual(M.harvestOrder(srv.read, { at: [5, G + 1, 5] }).at(-1), [5, G + 1, 5])
  })
})
await t('MUTANT KILLED: a due test that ignores a grown tree', async () => {
  await killed("  if (harvestList(read, rec, { skip, max: 1 }).length) return 'harvest'", '', M => {
    const srv = server()
    for (let y = G + 1; y <= G + 5; y++) srv.set([5, y, 5], 'spruce_log')
    assert.strictEqual(M.farmDue(srv.read, { cells: [{ at: [5, G + 1, 5], role: 'plot' }], trees: [] }), 'harvest')
  })
})

/** Two fake builders run the bots' own visit (as skills.mjs buildTreeFarm runs it) until the record reads done. -> { stops, rows } */
async function buildOut (srv, rec, dir, key, gen, bots, rounds = 30) {
  const stops = {}
  const palette = F.farmPalette(rec.species)
  const done = () => rec.cells.every(c => F.farmAlsoDone(c, srv.read) || R.cellDone(srv.read(...c.at), palette, c.role))
  for (let round = 0; round < rounds && !done(); round++) {
    for (const [n, b] of Object.entries(bots)) {
      const slot = PJ.takeSlot(dir, key, n, F.TREEFARM_BUILDERS)
      if (!slot.ok) continue
      const v = await R.runVisit({ dir, key, me: n, home: HOME, stood: [], record: rec, recordGen: gen, palette, slot: slot.slot, slotGen: slot.gen,
        domain: () => true, foreign: F.FARM_FOREIGN, blockLayer: false, clearMax: 60, alsoDone: F.farmAlsoDone, stands: (b.stands ??= { pending: null, bans: {} }) }, b, { maxSteps: 300 })
      PJ.releaseLease(dir, key, `slot${slot.slot}`, n, slot.gen)
      stops[v.stop] = (stops[v.stop] ?? 0) + 1
    }
  }
  return { stops, done: done() }
}
const rowsOf = bots => Object.values(bots).flatMap(b => b.logs).filter(([k]) => k === '_build').map(([, d]) => d)
const showcaseRead = (rec, rows) => {
  const recKeys = new Set(rec.cells.map(c => c.at.join(','))), clearKeys = new Set(rec.clear.map(c => c.at.join(',')))
  for (const d of rows.filter(d => d.op === 'place')) assert.ok(recKeys.has(d.cell.join(',')), `G1 off_record ${d.cell} ${d.block}`)
  for (const d of rows.filter(d => d.op === 'clear')) assert.ok(d.kind === 'foreign' ? recKeys.has(d.cell.join(',')) : clearKeys.has(d.cell.join(',')), `G2 clear_outside ${d.cell} ${d.kind} ${d.block}`)
}
await t('BUILT END TO END: the floor, the soil, 16 saplings, the lights -- every placement and clear on the record; then a GROWN tree is left to the harvest and a harvested plot is replanted', async () => {
  const x0 = 12, z0 = 12
  const cells = {}
  cells[`${x0 + 2},${G},${z0 + 2}`] = 'air'                                          // a pit to fill
  cells[`${x0 + 5},${G + 1},${z0 + 3}`] = 'dirt'                                      // a pillar to cut
  cells[`${x0},${G + 1},${z0 + 4}`] = 'short_grass'                                   // a plant in a plot cell
  const srv = server(cells)
  const rec = F.siteFarm(srv.read, { home: HOME, bounds: only(x0, z0), lights: 9, species: 'spruce_sapling' }).record
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-'))
  const key = PJ.projKey(HOME, F.TREEFARM_PLOT)
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const bots = { A: bot(srv, 'A', { inv: { spruce_sapling: 12, dirt: 8, torch: 9 }, feet: [x0 - 1, G + 1, z0 - 1] }), B: bot(srv, 'B', { inv: { spruce_sapling: 8, dirt: 4 }, feet: [x0 + 13, G + 1, z0 + 13] }) }
  const r1 = await buildOut(srv, rec, dir, key, pub.gen, bots)
  assert.ok(r1.done, `open after the rounds: ${JSON.stringify(r1.stops)}`)
  assert.ok(!r1.stops.stuck_on_cell && !r1.stops.blocked, JSON.stringify(r1.stops))
  showcaseRead(rec, rowsOf(bots))
  assert.strictEqual(F.farmCensus(srv.read, rec).sapling, 16)
  assert.strictEqual(srv.read(x0 + 5, G + 1, z0 + 3).name, 'air', 'the pillar cut')
  assert.notStrictEqual(srv.read(x0 + 2, G, z0 + 2).name, 'air', 'the pit filled')
  assert.strictEqual(F.farmDue(srv.read, rec), null)
  // GROWTH: a plot's sapling becomes a 6-log spruce, another plot is harvested (empty)
  const [a, b] = rec.cells.filter(c => c.role === 'plot')
  for (let y = a.at[1]; y < a.at[1] + 6; y++) srv.set([a.at[0], y, a.at[2]], 'spruce_log')
  srv.set(b.at, 'air')
  assert.strictEqual(F.farmDue(srv.read, rec), 'harvest')
  const before = rowsOf(bots).length
  const r2 = await buildOut(srv, rec, dir, key, pub.gen, bots, 4)
  assert.ok(r2.done, JSON.stringify(r2.stops))
  assert.ok(F.plotState(srv.read, b) === 'sapling', 'the harvested plot replanted')
  assert.strictEqual(F.plotState(srv.read, a), 'tree', 'the grown tree stands: the build never fells it (the harvest does, from its stump)')
  const late = rowsOf(bots).slice(before)
  assert.ok(!late.some(d => d.op === 'clear' && d.cell[0] === a.at[0] && d.cell[2] === a.at[2]), 'no clear in the grown tree\'s column')
  showcaseRead(rec, rowsOf(bots))
})
await t('MUTANT KILLED: a build that does not read a grown tree done fells it outside the record\'s clears (the showcase read\'s G2)', async () => {
  await killed("export const farmAlsoDone = (cell, read) => cell?.role === 'plot' && LOG.test(nm(read?.(...cell.at)))", 'export const farmAlsoDone = () => false', async M => {
    const x0 = 12, z0 = 12
    const srv = server()
    const rec = M.siteFarm(srv.read, { home: HOME, bounds: only(x0, z0), species: 'spruce_sapling' }).record
    const plot = rec.cells.find(c => c.role === 'plot')
    for (const c of rec.cells.filter(q => q.role === 'plot')) srv.set(c.at, 'spruce_sapling')
    for (let y = plot.at[1]; y < plot.at[1] + 5; y++) srv.set([plot.at[0], y, plot.at[2]], 'spruce_log')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-m-'))
    const key = PJ.projKey(HOME, M.TREEFARM_PLOT)
    const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
    const bots = { A: bot(srv, 'A', { inv: { spruce_sapling: 4 }, feet: [x0 - 1, G + 1, z0 - 1] }) }
    const palette = M.farmPalette(rec.species)
    const slot = PJ.takeSlot(dir, key, 'A', 2)
    await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, recordGen: pub.gen, palette, slot: slot.slot, slotGen: slot.gen,
      domain: () => true, foreign: M.FARM_FOREIGN, blockLayer: false, clearMax: 60, alsoDone: M.farmAlsoDone, stands: { pending: null, bans: {} } }, bots.A, { maxSteps: 200 })
    showcaseRead(rec, rowsOf(bots))
    assert.strictEqual(srv.read(...plot.at).name, 'spruce_log', 'the grown tree left standing')
  })
})

await t('the project order: the farm after the paths, only with the paths and the house on; a standing farm\'s harvest waits behind an open project', () => {
  // (on, monument, paths, wall, shaft, farm); the town stair (shaft-02) has its own order test: left out here
  const L = SHOP.projectsOn(true, true, true, true, true, true).filter(p => p.plot !== 'shaft')
  assert.ok(L.some(p => p.plot === F.TREEFARM_PLOT))
  assert.ok(!SHOP.projectsOn(true, true, true, true, true, false).some(p => p.plot === F.TREEFARM_PLOT), 'TREEFARM=off')
  assert.ok(!SHOP.projectsOn(true, true, false, true, true, true).some(p => p.plot === F.TREEFARM_PLOT), 'never without the paths')
  const st = (plot, exists, complete, extra = {}) => ({ plot, exists, complete, damaged: false, ...extra })
  const base = [st('shop', true, true), st('house1', true, true), st('monument', true, true)]
  assert.strictEqual(SHOP.activeProject([...base, st('paths', true, false)], L).plot, 'paths', 'the paths first')
  assert.strictEqual(SHOP.activeProject([...base, st('paths', true, true), st('wall', true, true)], L).plot, F.TREEFARM_PLOT, 'then the farm')
  assert.strictEqual(SHOP.activeProject([...base, st('paths', true, true), st('wall', true, false), st('treefarm', true, true, { due: true })], L).plot, 'wall', 'the harvest waits behind the open wall')
  assert.strictEqual(SHOP.activeProject([...base, st('paths', true, true), st('wall', true, true), st('treefarm', true, true, { due: true })], L).plot, F.TREEFARM_PLOT, 'and is the visit when nothing is open')
  assert.ok(SHOP.LIGHT_PLOTS.has(F.TREEFARM_PLOT))
})
await t('the paths reach a complete farm at its front (paths.mjs pathDests); not before it stands', () => {
  const plan = { home: HOME, plots: [{ id: 'core', kind: 'plaza', box: [-6, -6, 6, 6], keepout: true }], paths: [] }
  const rec = { blueprint: F.TREEFARM_BLUEPRINT, plot: F.TREEFARM_PLOT, front: [[20, 9], [20, 10]], cells: [{ at: [22, G, 9], role: 'soil' }], structure_complete: true }
  const D = P.pathDests({ plan, projects: [{ plot: F.TREEFARM_PLOT, rec, bp: { id: F.TREEFARM_BLUEPRINT, palette: F.FARM_PALETTE } }], place: () => [] })
  assert.deepStrictEqual(D.dests.find(d => d.to === F.TREEFARM_PLOT)?.cols, [[20, 9], [20, 10]])
  const D2 = P.pathDests({ plan, projects: [{ plot: F.TREEFARM_PLOT, rec: { ...rec, structure_complete: false } }], place: () => [] })
  assert.ok(!D2.dests?.some(d => d.to === F.TREEFARM_PLOT))
})
await t('THE WIRING (source, comments stripped): build_shop dispatches the farm; a farm is never damage, only due; its footprint; the bank of its logs', () => {
  const src = readFileSync(SKILLS_PATH, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
  assert.strictEqual(src.split('if (proj.plot === TREEFARM_PLOT) return buildTreeFarm(ctx, args, signal)').length, 2)
  assert.strictEqual(src.split('if (r.blueprint === TREEFARM_BLUEPRINT) return tidy && !!farmDueFor(bot, r)').length, 2)
  assert.strictEqual(src.split('else if (r.blueprint === TREEFARM_BLUEPRINT) { for (const k of farmFootprint(r)) fp.add(k) }').length, 2)
  assert.ok(/await withDigScope\(bot, \{ purpose: 'target', by: 'treefarm' \}, \(\) => collectManually\(bot, b, signal\)\)/.test(src), 'the harvest digs through the gather\'s own dig')
  assert.ok(/if \(\/_log\$\/\.test\(n\) && k > \(held0\[n\] \?\? 0\)\) caps\[n\]/.test(src), 'the harvested logs are banked')
  assert.ok(/alsoDone: farmAlsoDone \}, effects/.test(src), 'the visit reads a grown tree done')
})

await t('A CUT STILL STANDING keeps the farm due (and not complete); dug, nothing is due (Codex r1 BLOCK 2)', () => {
  const srv = server({ '14,70,14': 'cobblestone', '12,70,12': 'spruce_sapling' })
  const rec = { cells: [{ at: [12, G, 12], role: 'soil' }, { at: [12, G + 1, 12], role: 'plot' }], trees: [], clear: [{ at: [14, 70, 14], kind: 'cut', name: 'cobblestone' }, { at: [15, 75, 15], kind: 'leaves', name: 'spruce_leaves' }] }
  assert.strictEqual(F.farmDue(srv.read, rec), 'level')
  assert.strictEqual(F.cutsLeft(srv.read, rec).length, 1)
  srv.set([14, 70, 14], 'air')
  assert.strictEqual(F.farmDue(srv.read, rec), null, 'a listed leaf no longer there, a cut dug: nothing due')
})
await t('THE WIRING: the harvest withholds collectManually\'s dig-approach; completion waits for the cuts (Codex r1)', () => {
  const src = readFileSync(SKILLS_PATH, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
  assert.ok(/bot\.withGatherMovements = undefined\n\s*await withDigScope\(bot, \{ purpose: 'target', by: 'treefarm' \}/.test(src))
  assert.ok(/\} finally \{ bot\.withGatherMovements = wgm \}/.test(src), 'restored on every exit')
  assert.strictEqual(src.split('!siteTreesLeft(read, rec).length && !cutsLeft(read, rec).length) {').length, 2)
})
await t('THE PLANTING STOCK: with the farm on, the peaceful kit\'s composter keeps the farm species\' saplings (spruce kept 16); off, it composts them', async () => {
  const C = await import('../src/composter.mjs')
  const bag = [{ name: 'spruce_sapling', count: 20 }, { name: 'jungle_sapling', count: 5 }]
  assert.deepStrictEqual(C.compostAllowance(bag, { plants: true, farmKeeps: true }), { spruce_sapling: 4, jungle_sapling: 5 })
  assert.deepStrictEqual(C.compostAllowance(bag, { plants: true, farmKeeps: false }), { spruce_sapling: 20, jungle_sapling: 5 }, 'control: the kit as before')
  // the composter's restated species and switch agree with treefarm.mjs's (no import: a cycle through paths.mjs)
  assert.deepStrictEqual([...C.FARM_KEEP_SPECIES], [...F.FARM_SPECIES])
  for (const [env, pool] of [[{}, 'showcase'], [{}, 'hive-a'], [{ TREEFARM: 'off' }, 'showcase'], [{ TREEFARM: 'on' }, 'x'], [{ TREEFARM_POOLS: 'a,b' }, 'b']]) assert.strictEqual(C.farmKeepsOn(env, pool), F.treefarmOn(env, pool))
})
console.log(`\ntreefarm: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
