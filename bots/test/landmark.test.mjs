// ROUGHGROUND-3 (owner 11-07, target picture 11: "a round island mound of neat concentric grass terraces with ONE big tree on top"): the
// town's landmark mound. Behaviour on buildfake's flat world (stone below G, grass at G, readable to +-60).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const LM = await import('../src/landmark.mjs')
const T = await import('../src/tidy.mjs')
const { PARK_SAPLINGS } = await import('../src/park.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const LM_PATH = new URL('../src/landmark.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const BOX = [-20, -20, 20, 20]
const col = srv => (x, z) => { const c = T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 }); return c.why || c.tree ? null : c.y }
const plan = (srv, o = {}, M = LM) => M.landmarkPlan(srv.read, { box: BOX, home: HOME, seed: 7, have: { spruce_sapling: 2 }, col: col(srv), saplings: PARK_SAPLINGS, ...o })
const steps = (srv, lm) => {
  // the mound laid (the cells as their roles' blocks), every 4-neighbour step on and round it read from the world
  const laid = T.tidyOverlay(srv.read, { cut: [], clear: [], cells: lm.cells.filter(c => c.role !== 'sapling0') })
  const c2 = (x, z) => T.tidyColumn(laid, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 }).y
  const [cx, cz] = lm.landmark.centre
  let worst = 0
  for (let x = cx - 5; x <= cx + 5; x++) for (let z = cz - 5; z <= cz + 5; z++) for (const [dx, dz] of [[1, 0], [0, 1]]) worst = Math.max(worst, Math.abs(c2(x, z) - c2(x + dx, z + dz)))
  return { worst, crown: c2(cx, cz), lawn: c2(cx + 4, cz + 4) }
}

await t('a round mound, 1-block steps, grass tops (dirt on top, cobble under), ONE sapling on the crown: 67 fills from flat ground', async () => {
  const srv = server()
  const lm = plan(srv)
  assert.ok(lm, 'planned')
  const fills = lm.cells.filter(c => c.role !== 'sapling0')
  assert.strictEqual(fills.length, 67)
  const s = steps(srv, lm)
  assert.strictEqual(s.worst, 1, 'every step one block'); assert.strictEqual(s.crown, G + 3); assert.strictEqual(s.lawn, G)
  // tops dirt (it greens), buried cells the town's cobblestone
  const top = new Map(); for (const c of fills) { const k = `${c.at[0]},${c.at[2]}`; top.set(k, Math.max(top.get(k) ?? -1e9, c.at[1])) }
  assert.ok(fills.every(c => (c.at[1] === top.get(`${c.at[0]},${c.at[2]}`)) === (c.role === 'earth')))
  assert.ok(fills.some(c => c.role === 'core'))
  const sap = lm.cells.filter(c => c.role === 'sapling0')
  assert.strictEqual(sap.length, 1); assert.deepStrictEqual(sap[0].at, [lm.landmark.centre[0], G + 4, lm.landmark.centre[1]])
  // layered: each layer on the one below, the sapling after the top layer
  const deps = Object.fromEntries(lm.segments.map(q => [q.seg, q.deps]))
  assert.deepStrictEqual(deps, { 'T-LM0': [], 'T-LM1': ['T-LM0'], 'T-LM2': ['T-LM1'], 'T-LMS': ['T-LM2'] })
  assert.ok(fills.every(c => c.seg === `T-LM${c.at[1] - G - 1}`))
  // the mutant: the middle ring gone -> a 2-block step (a cliff, never a terrace)
  await withMutant(LM_PATH, 'rings: [[1.5, 3], [2.5, 2], [3.5, 1]]', 'rings: [[1.5, 3], [3.5, 1]]', async M => {
    const m = plan(srv, {}, M)
    assert.strictEqual(steps(srv, m).worst, 2, 'mutant: a cliff')
  })
})
await t('none without a sapling in the town; never on a taken column (the park + 1, a path, a reservation); none on rough ground', async () => {
  const srv = server()
  assert.strictEqual(plan(srv, { have: { dirt: 64 } }), null, 'no sapling: no tree for the crown')
  const lm = plan(srv, { taken: (x, z) => x >= -20 && x <= 20 && z >= -20 && z <= 5 })
  assert.ok(lm && lm.cells.every(c => c.at[2] > 5), 'off the taken ground')
  const rough = server()
  // the bots' rough ground: columns 0..3 over the grass (dirt), every 9x9 spread 3
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) { const h = (((x * 7 + z * 3) % 4) + 4) % 4; for (let y = G + 1; y <= G + h; y++) rough.set([x, y, z], 'dirt') }
  // rough ground is SHAPED (no flat 9x9 left in the showcase's wall): cut and filled to the mound's steps, still 1-block steps
  const lmR = plan(rough)
  assert.ok(lmR && lmR.cut.length > 0, 'shaped: cuts as well as fills')
  const laid = T.tidyOverlay(rough.read, { cut: lmR.cut, clear: [], cells: lmR.cells.filter(c => c.role !== 'sapling0') })
  const [cx, cz] = lmR.landmark.centre
  const c2 = (x, z) => T.tidyColumn(laid, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 }).y
  let worst = 0
  for (let x = cx - 3; x <= cx + 3; x++) for (let z = cz - 3; z <= cz + 3; z++) for (const [dx, dz] of [[1, 0], [0, 1]]) if (Math.hypot(x + dx - cx, z + dz - cz) <= 3.5 && Math.hypot(x - cx, z - cz) <= 3.5) worst = Math.max(worst, Math.abs(c2(x, z) - c2(x + dx, z + dz)))
  assert.strictEqual(worst, 1, 'the mound itself: 1-block steps'); assert.strictEqual(c2(cx, cz), lmR.landmark.base + 3)
  // a cut that would open a hollow, or a block it may not cut (a log in the ground), passes that site; ground too deep to shape: none
  const deep = server()
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) if ((x + z) % 2 === 0) for (let y = G + 1; y <= G + 5; y++) deep.set([x, y, z], 'stone')
  assert.strictEqual(plan(deep), null, 'spread > 3: no site')
})
await t('a mound partly standing is repaired (only the missing cells), never rebuilt; a crown with no room for the tree is no site', async () => {
  const srv = server()
  const lm = plan(srv)
  const half = lm.cells.filter(c => c.role !== 'sapling0' && c.seg === 'T-LM0')
  for (const c of half) srv.set(c.at, c.role === 'earth' ? 'dirt' : 'cobblestone')
  const site = { centre: lm.landmark.centre, base: lm.landmark.base, box: lm.landmark.box }
  const again = LM.landmarkCells(site, { top: col(srv), open: (x, y, z) => srv.read(x, y, z)?.name === 'air' })
  assert.strictEqual(again.fill.length, 67 - half.length)
  const tree = server()
  const low = plan(tree)
  tree.set([low.landmark.centre[0], G + 8, low.landmark.centre[1]], 'oak_leaves')
  const moved = plan(tree)
  assert.ok(!moved || moved.landmark.centre.join(',') !== low.landmark.centre.join(','), 'not under leaves')
})
await t('the wiring: the keeper plans it once (land.landmark), every tidy rule and the terrace keep off it, the land plan reserves it', async () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/if \(landmarkOn\(\) && land && !land\.landmark && !rec\.structure_complete && !\(rec\.segments \?\? \[\]\)\.some\(q => q\.seg === 'T-LMS'\)\) \{/.test(sk), 'once, on the open record')
  assert.ok(/cur && !cur\.landmark \? \{ \.\.\.cur, landmark: \{ \.\.\.t\.landmark, at: Date\.now\(\) \} \} : null/.test(sk), 'published on the land record')
  assert.ok(/try \{ lmz = landmarkZones\(landHead\(dir\)\) \} catch \{ lmz = \[\] \}/.test(sk) && /\.\.\.townMarkerZones\(\), \.\.\.lmz\]/.test(sk), 'every tidy rule: reserved')
  const tr = strip(readFileSync(new URL('../src/terrace.mjs', import.meta.url), 'utf8'))
  assert.ok(/const guard = \(x, z\) => avoid\(x, z\) \?\? road\(x, z\) \?\? \(lmB && x >= lmB\[0\]/.test(tr), 'the terrace never grades it')
  const LP = await import('../src/landplan.mjs')
  const res = LP.landReservation({ corridors: [], landmark: { box: [1, 2, 9, 10] } })
  assert.ok(res.zones.some(z => z.why === 'land:landmark' && z.box[0] === 1 && z.box[5] === 10), 'a reservation other builds keep off')
  assert.strictEqual(LM.landmarkOn({ LANDMARK: 'off' }), false); assert.strictEqual(LM.landmarkOn({}), true)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
