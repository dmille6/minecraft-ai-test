// GKMARKER-01 (showcase batch 14a, 11-06): the groundskeeper never plans a cut on an expedition MARKER.
// The batch-14a replay (the next ring stage rim48 sited offline on the 03:03Z copy of the live world and pool, its planned rows
// through a temp copy of the installed tripwire) found outbands-01's band survey cutting the marker's two cobblestone at
// -47,67..68,34: `avoid`'s FIRST reason there is the old wall's zone (`project:wall`), which BUILD_WHY reads as a build, so the
// marker pillar read as spoil beside a build. The read calls that clear_outside `guarded`. Fix: skills.mjs tidyInputs puts the
// markers in `reserved` (read first by every survey rule). Behaviour on buildfake's flat world through siteStage with the real
// band stage; the wiring structural; an anchored mutant.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { G, HOME, server } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const LP = await import('../src/landplan.mjs')
const EX = await import('../src/expedition.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const SMALL = Object.freeze({ ...LP.LAND, workR: 44, rimR: 20, rimStep: 12, legPops: 60_000 })
const BAND1 = LP.landStages(SMALL).find(q => q.id === 'rim32')
const LAND = { home: HOME, roads: [], corridors: [], zones: {}, ringR: 15, workR: SMALL.workR, inner: 6, seed: 1 }
const WALL = { ring: [-12, -12, 12, 12] }
// a marker (two cobblestone + a torch) at 26,G+1,0 in band 1, beside the wall's zone (avoid's first reason there: project:wall)
const M = { at: [26, G + 1, 0] }
const mz = EX.markerZones([M])
const wallZone = (x, z) => (x >= 25 && x <= 27 && z >= -1 && z <= 1 ? 'project:wall' : null)
function world () {
  const srv = server()
  srv.set([26, G + 1, 0], 'cobblestone'); srv.set([26, G + 2, 0], 'cobblestone'); srv.set([26, G + 3, 0], 'torch')
  srv.set([27, G, 0], 'cobblestone')   // a wall cell beside it (the build the pillar stands beside)
  return srv
}
const inMarker = (x, z) => mz.some(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5])
const site = (srv, reserved) => T.siteStage(srv.read, { home: HOME, land: LAND, stage: BAND1, env: { OUTBANDS: 'on' }, L: SMALL, terrace: { wall: WALL, records: [] },
  avoid: T.tidyAvoid(wallZone, mz), cells: new Set(['27,' + G + ',0']), ...(reserved ? { reserved } : {}) })
const markerCuts = r => (r?.record?.cut ?? []).filter(c => c.at[0] === 26 && c.at[2] === 0)

console.log('THE MARKER BESIDE A BUILD')
await t('POSITIVE CONTROL (the live gap): with the markers only in `avoid` -- whose first reason is the wall\'s -- the band plans the marker\'s cobblestone', async () => {
  const r = await site(world(), null)
  assert.ok(markerCuts(r).length > 0, `expected the marker cut: ${JSON.stringify(r.record?.cut ?? r.why)}`)
})
await t('with the markers `reserved` (skills.mjs tidyInputs), no cut on the marker column', async () => {
  const r = await site(world(), (x, z) => inMarker(x, z))
  assert.strictEqual(markerCuts(r).length, 0, JSON.stringify(markerCuts(r)))
})
await t('the wiring (structural): tidyInputs\' reserved zones include townMarkerZones()', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(/const rz = \[\.\.\.recordZones\(recs\.filter\(r => r\?\.plot === SITEPREP_PLOT\)\)\.filter\(z => !\(prepExcept && z\?\.id === prepExcept\)\), \.\.\.townMarkerZones\(\)\]/.test(src))
  assert.ok(/const reserved = \(x, z\) => held\(x, z\) \|\| rz\.some\(/.test(src))
})
await t('MUTANT: the markers dropped from reserved -- the wiring check fails for that reason (anchor present and unique)', () => {
  const p = new URL('../src/skills.mjs', import.meta.url)
  const src = readFileSync(p, 'utf8')
  const old = ', ...townMarkerZones()]\n  // wallext-02 (Claude hold r1 BLOCKER 1)'
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const mut = strip(src.replace(old, ']\n  // wallext-02 (Claude hold r1 BLOCKER 1)'))
  assert.ok(!/const rz = \[\.\.\.recordZones\(recs\.filter\(r => r\?\.plot === SITEPREP_PLOT\)\)\.filter\(z => !\(prepExcept && z\?\.id === prepExcept\)\), \.\.\.townMarkerZones\(\)\]/.test(mut), 'the mutant still wires the markers')
})

console.log(`\ngkmarker: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
