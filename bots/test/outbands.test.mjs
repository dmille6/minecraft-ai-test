// OUTBANDS-01: the groundskeeper outside the walls, band by band (owner 11-04, piece 5: "move outside the walls and clean these areas
// up, they can leave trees, or cut down trees and replant in better spots ... making it easier for other bots to work, mine, travel,
// explore"). Behaviour on buildfake's flat world (stone below G, grass at G, readable to +-60) with SMALL's bands (20, 32] and (32, 44].
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const LP = await import('../src/landplan.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const TIDY_PATH = new URL('../src/tidy.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const SMALL = Object.freeze({ ...LP.LAND, workR: 44, rimR: 20, rimStep: 12, legPops: 60_000 })
const BAND1 = LP.landStages(SMALL).find(q => q.id === 'rim32')
const BAND2 = LP.landStages(SMALL).find(q => q.id === 'rim44')
const ON = { OUTBANDS: 'on' }, OFF = { OUTBANDS: 'off' }
// no roads, every sector wild; `corridors` boxes are [x0, y0, z0, x1, y1, z1]
const LAND = (corridors = []) => ({ home: HOME, roads: [], corridors, zones: {}, ringR: 15, workR: SMALL.workR, inner: 6, seed: 1 })
// the town's wall: interior [-11, -11, 11, 11] (without a wall record the inside is tidy-01's square, +-32: SMALL's first band)
const WALL = { ring: [-12, -12, 12, 12] }
const site = (srv, { stage = BAND1, land = LAND(), env = ON, ...o } = {}) => T.siteStage(srv.read, { home: HOME, land, stage, env, L: SMALL, terrace: { wall: WALL, records: [] }, ...o })
const tree = (srv, x, z, h = 5, log = 'oak_log') => {
  for (let y = G + 1; y <= G + h; y++) srv.set([x, y, z], log)
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = G + h - 1; y <= G + h + 1; y++) if ((dx || dz) || y > G + h) srv.set([x + dx, y, z + dz], log.replace(/_log$/, '_leaves'))
}
const cutCols = r => [...new Set((r?.cut ?? []).map(c => `${c.at[0]},${c.at[2]}`))]
const fillCols = r => [...new Set((r?.cells ?? []).filter(c => c.role !== 'light').map(c => `${c.at[0]},${c.at[2]}`))]

console.log('CLEAN: the inside-the-wall rules over the band\'s own columns')
await t('a 1-high dirt stray and a 1-deep hole in the band are cut and filled (tidy-01 takes neither: pillars from 2, pits from 2); OUTBANDS=off is the band as before', async () => {
  const srv = server()
  srv.set([26, G + 1, 5], 'dirt')        // a 1-high stray (a scaffold's last block)
  srv.set([24, G, -5], 'air')            // a 1-deep hole
  const r = site(srv)
  assert.ok(r.record, r.why)
  assert.deepStrictEqual(cutCols(r.record), ['26,5'])
  assert.deepStrictEqual(r.record.cut.map(c => c.at[1]), [G + 1])
  assert.deepStrictEqual(fillCols(r.record), ['24,-5'])
  assert.deepStrictEqual(r.record.cells.map(c => c.at[1]), [G])
  assert.strictEqual(r.record.band.strays, 1); assert.strictEqual(r.record.band.holes, 1)
  const off = site(srv, { env: OFF })
  assert.strictEqual(off.record, null, 'control: the band before (nothing 2 high, nothing 2 deep)')
})
await t('never: natural ground (a 1-high stone bump), the next band\'s columns, a wall\'s inside, a column `avoid` names', async () => {
  const srv = server()
  srv.set([26, G + 1, 0], 'stone')                                   // natural: left
  srv.set([40, G + 1, 0], 'dirt')                                    // band 2's
  srv.set([22, G + 1, 22], 'dirt')                                   // inside the wall's interior box
  srv.set([-26, G + 1, 0], 'dirt')                                   // a guarded column
  const wall = { ring: [10, 10, 30, 30] }                            // interior [11, 11, 29, 29]
  const avoid = (x, z) => (x === -26 && z === 0 ? 'zone:board' : null)
  const r = site(srv, { terrace: { wall, records: [] }, avoid })
  assert.strictEqual(r.record, null, JSON.stringify(r.record?.cut))
  assert.ok(r.band.skipped.stray_natural >= 1)
  const r2 = site(srv, { stage: BAND2, terrace: { wall, records: [] }, avoid })
  assert.deepStrictEqual(cutCols(r2.record), ['40,0'], 'band 2 takes its own')
})
await t('a dirt climb against a build OUTSIDE the wall is cut, never made a staircase (a stair to the wall\'s top from outside is a way over it)', async () => {
  const srv = server(); const cells = new Set()
  for (let z = -6; z <= 6; z++) for (let y = G + 1; y <= G + 4; y++) { srv.set([-30, y, z], 'stone_bricks'); cells.add(`-30,${y},${z}`) }
  srv.set([-31, G + 1, 0], 'dirt'); srv.set([-31, G + 2, 0], 'dirt')
  const avoid = (x, z) => (x >= -31 && x <= -29 && z >= -7 && z <= 7 ? 'project:wall' : null)
  const r = site(srv, { avoid, cells })
  assert.ok(r.record, r.why)
  assert.deepStrictEqual(cutCols(r.record), ['-31,0'])
  assert.ok(!r.record.cells.some(c => c.role === 'access'), 'no staircase')
  assert.strictEqual(r.record.cells.length, 0)
  // the mutant: the band's survey allowed staircases -> a stair outside the wall
  await withMutant(TIDY_PATH, "reserved, water, waterOk, T: { ...INWALL, access: false } })", 'reserved, water, waterOk, T: { ...INWALL } })', async M => {
    const m = M.siteStage(srv.read, { home: HOME, land: LAND(), stage: BAND1, env: ON, L: SMALL, terrace: { wall: WALL, records: [] }, avoid, cells })
    assert.ok(m.record.cells.length > 0, 'mutant: stair cells')
  })
})
await t('mutant: the band\'s survey without its `within` (the wall\'s inside no longer kept out) is caught', async () => {
  const srv = server()
  srv.set([22, G + 1, 22], 'dirt')
  const wall = { ring: [10, 10, 30, 30] }
  assert.strictEqual(site(srv, { terrace: { wall, records: [] } }).record, null)
  await withMutant(TIDY_PATH, '    if (!within(x, z)) continue\n', '', async M => {
    const m = M.siteStage(srv.read, { home: HOME, land: LAND(), stage: BAND1, env: ON, L: SMALL, terrace: { wall, records: [] } })
    assert.deepStrictEqual(cutCols(m.record), ['22,22'], 'mutant takes the wall\'s inside')
  })
})

console.log('TREES: leave them; clear the stumps; fell a road\'s and replant it in a grove')
await t('a leafless 2-log stump is cleared (kind tree, no replant owed); a living tree off every road stays', async () => {
  const srv = server()
  srv.set([28, G + 1, 8], 'oak_log'); srv.set([28, G + 2, 8], 'oak_log')
  tree(srv, -26, -10)
  const r = site(srv)
  assert.ok(r.record, r.why)
  assert.deepStrictEqual(r.record.clear.map(c => [c.at.join(','), c.kind]), [[`28,${G + 1},8`, 'tree'], [`28,${G + 2},8`, 'tree']])
  assert.strictEqual(r.record.replant.length, 0)
  assert.strictEqual(r.record.band.stumps, 1); assert.strictEqual(r.record.band.fells, 0)
  assert.ok(!r.record.clear.some(c => c.at[0] === -26), 'the living tree stays')
  assert.strictEqual(site(srv, { env: OFF }).record, null, 'control: OUTBANDS=off leaves the stump')
})
await t('a stump with leaves within 2 is a tree; a 5-log dead trunk is not a stump (named); a guarded stump stays', async () => {
  const srv = server()
  srv.set([28, G + 1, 8], 'oak_log'); srv.set([29, G + 2, 9], 'oak_leaves')
  for (let y = G + 1; y <= G + 5; y++) srv.set([-28, y, 8], 'oak_log')
  srv.set([26, G + 1, -12], 'oak_log')
  const r = site(srv, { avoid: (x, z) => (x === 26 && z === -12 ? 'zone:x' : null) })
  assert.strictEqual(r.record, null, JSON.stringify(r.record?.clear))
  assert.strictEqual(r.band.skipped.stump_tall, 1); assert.strictEqual(r.band.skipped.tree_guarded, 1)
})
await t('Codex r1 BLOCKER: a BENT living tree (an acacia whose trunk leaves its column, the canopy beyond 2) is no stump (its base stays)', async () => {
  const srv = server()
  for (const [x, y0, y1] of [[26, 1, 3], [27, 3, 4], [28, 4, 5], [29, 5, 6], [30, 6, 6]]) for (let y = G + y0; y <= G + y1; y++) srv.set([x, y, 5], 'acacia_log')
  for (let x = 29; x <= 32; x++) for (let z = 3; z <= 7; z++) srv.set([x, G + 7, z], 'acacia_leaves')
  const r = site(srv)
  assert.ok(!(r.record?.clear ?? []).some(c => c.at[0] === 26), JSON.stringify(r.record?.clear))
  assert.strictEqual(r.band.stumps, 0); assert.ok(r.band.skipped.stump_joined >= 1)
  // Codex r2: two leafless stumps standing corner to corner are ONE stump group (each touches the other), cleared together
  const s2 = server()
  s2.set([26, G + 1, 5], 'oak_log'); s2.set([27, G + 1, 6], 'oak_log')
  const r2 = site(s2)
  assert.strictEqual(r2.record?.band?.stumps, 1, JSON.stringify(r2.band))
  assert.deepStrictEqual(r2.record.clear.map(c => c.at.join(',')).sort(), [`26,${G + 1},5`, `27,${G + 1},6`])
  // the mutant: no join walk -> the acacia's base is cleared as a stump
  await withMutant(TIDY_PATH, "      if (joined) { skip('stump_joined'); continue }\n", '', async M => {
    const m = M.siteStage(srv.read, { home: HOME, land: LAND(), stage: BAND1, env: ON, L: SMALL, terrace: { wall: WALL, records: [] } })
    assert.ok((m.record?.clear ?? []).some(c => c.at[0] === 26), 'mutant: the acacia felled as a stump')
  })
})
await t('a living tree in a road corridor is felled whole (one tree, one replant); the replant goes beside a standing grove, never in the corridor', async () => {
  const srv = server()
  tree(srv, 24, 0)                                                   // in the corridor x 22..42, z -1..1
  tree(srv, -30, -30); tree(srv, -30, -34)                           // a grove of two
  const land = LAND([{ box: [22, G - 5, -1, 42, G + 10, 1], why: 'land:road' }])
  const r = site(srv, { land })
  assert.ok(r.record, r.why)
  const logs = r.record.clear.filter(c => c.kind === 'tree')
  assert.deepStrictEqual(logs.map(c => c.at.join(',')), [1, 2, 3, 4, 5].map(i => `24,${G + i},0`))
  assert.strictEqual(r.record.band.fells, 1)
  assert.strictEqual(r.record.replant.length, 1)
  const [rx, , rz] = r.record.replant[0].cell
  assert.strictEqual(r.record.replant[0].sapling, 'oak_sapling')
  assert.ok(Math.max(Math.abs(rx + 30), Math.abs(rz + 32)) <= 7, `beside the grove: ${rx},${rz}`)
  assert.strictEqual(LP.corridorAt(land)(rx, rz), null)
  // the control: the switch off fells nothing in the band (the corridor tree is not a road column of this stage)
  assert.strictEqual(site(srv, { land, env: OFF }).record, null)
  // the mutant: no grove pass -> the nearest wild cell to home
  await withMutant(TIDY_PATH, "    for (const pass of groves && kind === 'wild' ? ['grove', 'any'] : ['any']) for (const [, x, z] of cand) {", "    for (const pass of ['any']) for (const [, x, z] of cand) {", async M => {
    const m = M.siteStage(srv.read, { home: HOME, land, stage: BAND1, env: ON, L: SMALL, terrace: { wall: WALL, records: [] } })
    const [mx, , mz] = m.record.replant[0].cell
    assert.ok(Math.max(Math.abs(mx + 30), Math.abs(mz + 32)) > 7, `mutant: not the grove ${mx},${mz}`)
  })
})
await t('a 2x2 trunk in a corridor is ONE tree (one replant); felling stops at OUTBANDS.fellMax a band (named)', async () => {
  const srv = server()
  for (const [x, z] of [[24, 0], [25, 0], [24, 1], [25, 1]]) for (let y = G + 1; y <= G + 6; y++) srv.set([x, y, z], 'spruce_log')
  for (let dx = -2; dx <= 3; dx++) for (let dz = -2; dz <= 3; dz++) srv.set([24 + dx, G + 7, dz], 'spruce_leaves')
  const land = LAND([{ box: [22, G - 5, -1, 42, G + 10, 1], why: 'land:road' }])
  const r = site(srv, { land })
  assert.strictEqual(r.record.band.fells, 1)
  assert.strictEqual(r.record.clear.filter(c => c.kind === 'tree').length, 24)
  assert.strictEqual(r.record.replant.length, 1); assert.strictEqual(r.record.replant[0].sapling, 'spruce_sapling')
  const srv2 = server()
  for (let i = 0; i < 10; i++) tree(srv2, 22 + 2 * i, 0, 3)
  const r2 = T.bandTrees(srv2.read, { home: HOME, box: [21, -2, 44, 2], corridor: LP.corridorAt(land) })
  assert.strictEqual(r2.fells.length, T.OUTBANDS.fellMax)
  assert.ok(r2.skipped.fell_cap >= 1)
})

console.log('THE REPLANT AND THE SWITCH')
await t('the replant is never on this stage\'s own work (`busy`), never against a standing trunk', async () => {
  const srv = server()
  const land = LAND()
  const rp0 = T.replantCells(srv.read, land, [{ name: 'oak_log' }], {})
  const near = [rp0[0].cell[0], rp0[0].cell[2]]
  const rp = T.replantCells(srv.read, land, [{ name: 'oak_log' }], { groves: true, busy: new Set([near.join(',')]) })
  assert.strictEqual(rp.length, 1)
  assert.notDeepStrictEqual([rp[0].cell[0], rp[0].cell[2]], near, 'busy is never a replant cell')
  tree(srv, near[0] + 1, near[1] + 1)
  const rp2 = T.replantCells(srv.read, land, [{ name: 'oak_log' }], { groves: true })
  assert.ok(Math.max(Math.abs(rp2[0].cell[0] - near[0] - 1), Math.abs(rp2[0].cell[2] - near[1] - 1)) > 1, 'not against the trunk')
})
await t('the switch: unset and on are on; off/0/false/no are off', async () => {
  assert.strictEqual(T.outbandsOn({}), true); assert.strictEqual(T.outbandsOn({ OUTBANDS: 'on' }), true)
  for (const v of ['off', '0', 'false', 'no', 'OFF']) assert.strictEqual(T.outbandsOn({ OUTBANDS: v }), false, v)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
