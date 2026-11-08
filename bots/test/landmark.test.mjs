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
  assert.ok(fills.every(c => (c.at[1] === top.get(`${c.at[0]},${c.at[2]}`)) === (c.role === 'topsoil')), 'every top DIRT only (Codex r1: an earth cell may take cobble, and the crown carries the tree)')
  assert.deepStrictEqual(T.TIDY_PALETTE.topsoil, ['dirt', 'grass_block'])
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
await t('Codex r1: a cut never opens a hollow sideways; the crown is soil for the tree; the repair lists only what is missing, nothing on a whole mound', async () => {
  const srv = server()
  const lm = plan(srv)
  const site = { centre: lm.landmark.centre, base: lm.landmark.base, box: lm.landmark.box }
  // a whole mound (laid as dirt): the repair has nothing to do but the sapling; with the sapling grown, nothing at all
  for (const c of lm.cells.filter(q => q.role !== 'sapling0')) srv.set(c.at, c.role === 'topsoil' ? 'dirt' : 'cobblestone')
  const rep = LM.landmarkRepair(srv.read, lm.landmark, { col: col(srv) })
  assert.ok(rep && rep.cells.length === 1 && rep.cells[0].role === 'sapling0', JSON.stringify(rep?.cells))
  srv.set(lm.landmark.tree, 'spruce_sapling')
  assert.strictEqual(LM.landmarkRepair(srv.read, lm.landmark, { col: col(srv) }), null)
  // a crown of stone (shaped there before): made soil for the tree
  const stone = server(); const lmS = plan(stone)
  for (const c of lmS.cells.filter(q => q.role !== 'sapling0')) stone.set(c.at, 'stone')
  const repS = LM.landmarkRepair(stone.read, lmS.landmark, { col: col(stone) })
  assert.ok(repS.cells.some(c => c.role === 'topsoil' && c.at.join(',') === [lmS.landmark.centre[0], lmS.landmark.base + 3, lmS.landmark.centre[1]].join(',')), 'the crown laid again in dirt')
  // a hump to cut beside a tunnel under the neighbour's ground: that site passed
  const tun = server()
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) { tun.set([x, G + 1, z], 'dirt'); tun.set([x, G + 2, z], 'dirt') }
  const base = LM.landmarkCells({ centre: [0, 0], base: G + 2 - 0, box: LM.landmarkBox([0, 0]) }, { top: col(tun), open: (x, y, z) => tun.read(x, y, z)?.name === 'air', read: tun.read })
  assert.ok(base, 'control: shaped')
  tun.set([5, G + 2, 0], 'dirt'); tun.set([5, G + 3, 0], 'dirt')   // a 2-high hump over the rise-0 ring? (outer ring: no cut) -- use the +1 ring
  tun.set([3, G + 4, 0], 'dirt')                                     // a block over the +1 ring (target G + 3): cut
  tun.set([4, G + 4, 0], 'dirt'); tun.set([4, G + 3, 0], 'air')       // the neighbour: ground at G + 4 with an open cell under it, at the cut's height
  const blocked = LM.landmarkCells({ centre: [0, 0], base: G + 2, box: LM.landmarkBox([0, 0]) }, { top: col(tun), open: (x, y, z) => tun.read(x, y, z)?.name === 'air', read: tun.read })
  assert.strictEqual(blocked, null, 'the cut would open the neighbour\'s hollow sideways')
})
await t('the wiring: the keeper plans it once (land.landmark), every tidy rule and the terrace keep off it, the land plan reserves it', async () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/if \(landmarkOn\(\) && land && !rec\.structure_complete && !\(rec\.segments \?\? \[\]\)\.some\(q => \/\^T-LM\/\.test\(q\.seg\)\)\) \{/.test(sk), 'on the open record without the mound\'s work')
  assert.ok(/if \(land\.landmark\?\.centre\) t = landmarkRepair\(read, land\.landmark, \{ col \}\)/.test(sk), 'sited: its missing cells again (repair)')
  assert.ok(/cur && !cur\.landmark \? \{ \.\.\.cur, landmark: \{ \.\.\.t\.landmark, at: Date\.now\(\) \} \} : null/.test(sk) && /if \(lp\.result !== 'accepted'\) t = null/.test(sk), 'the land record FIRST, or nothing (Codex r1)')
  assert.ok(/try \{ lmz = landmarkZones\(landHead\(dir\)\) \} catch \{ lmz = \[\] \}/.test(sk) && /\.\.\.townMarkerZones\(\), \.\.\.lmz\]/.test(sk), 'every tidy rule: reserved')
  const tr = strip(readFileSync(new URL('../src/terrace.mjs', import.meta.url), 'utf8'))
  assert.ok(/const guard = \(x, z\) => avoid\(x, z\) \?\? road\(x, z\) \?\? \(lmB && x >= lmB\[0\]/.test(tr), 'the terrace never grades it')
  const LP = await import('../src/landplan.mjs')
  const res = LP.landReservation({ corridors: [], landmark: { box: [1, 2, 9, 10] } })
  assert.ok(res.zones.some(z => z.why === 'land:landmark' && z.box[0] === 1 && z.box[5] === 10), 'a reservation other builds keep off')
  assert.strictEqual(LM.landmarkOn({ LANDMARK: 'off' }), false); assert.strictEqual(LM.landmarkOn({}), true)
  assert.ok(/const noSoil = q => soilSkip\(q, n => !!effects\?\.has\?\.\(n\)\)/.test(sk) && (sk.match(/noTorch\(q\) \|\| noSoil\(q\)/g) ?? []).length === 2, 'a top with no dirt held waits (never cobble)')
  assert.ok(/const openSoil = \(visitRec\.cells \?\? \[\]\)\.filter\(q => q\.role === 'topsoil'/.test(sk) && /if \(wantSoil > 0\) extra\.dirt = \(extra\.dirt \?\? 0\) \+ wantSoil/.test(sk) && /q\.role !== 'topsoil' && !PARK_ROLES\.has\(q\.role\)/.test(sk), 'topsoil billed as DIRT, drawn from the town (Codex 3 r2)')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
