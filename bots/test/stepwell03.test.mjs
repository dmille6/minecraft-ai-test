// STEPWELL-03: THE SITING THAT REACHES ITS SITE (bots/src/stepwell.mjs reservedFor / GAP_OK / columnMemo / sitingRead; skills.mjs
// stepwellSite). LIVE showcase 11-05 14:20Z: the stepwell's one siting tried 10,891 of 21,600 candidates in its 25 s and found no site
// (reserved 9,925) -- the one free site (the owner's -52,-74) is candidate 19,560: the survey read the world before it checked the
// reservations, and stairRead's memo clears at 4,096 cells. Since 15:06Z the wall extension's west line (its zones = its columns + 1,
// x -41..-36) also took that site's 2-column gap. Behaviour: a reserved candidate reads no block; the GAP ring may lie in a wall's own
// margin zone, the footprint never, a record cell never (POSITIVE CONTROLS both ways); the memos ask once per column / cell. Anchored
// mutants show the tests fail for the intended reason. STRUCTURAL checks only for the wiring (comments stripped).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const S = await import('../src/stepwell.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const SW_PATH = new URL('../src/stepwell.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')

// ---- a fake world (stepwell.test.mjs's): grass at G, dirt G-1..G-3, stone below; a read counter ---------------------------------
const G = 64
const EMPTY = /^(air|cave_air|torch|short_grass)$/
const mk = n => (n == null ? null : { name: n, boundingBox: EMPTY.test(n) || /_sapling$/.test(n) ? 'empty' : (/water|lava/.test(n) ? 'empty' : 'block') })
function world () {
  const base = (x, y, z) => (y > G ? 'air' : y === G ? 'grass_block' : y >= G - 3 ? 'dirt' : y >= G - 40 ? 'stone' : 'bedrock')
  const w = { reads: 0 }
  w.read = (x, y, z) => { w.reads++; return mk(base(x, y, z)) }
  return w
}
const HOME = { x: 0, y: G, z: 0 }
const W = 21, OPT = { W, tiers: 1, tiersMax: 1 }
const cand = { x: 40, z: 0, away: 'e', d: 40 }
// the candidate's footprint in world columns (x 30..50, z -10..10 for away e at 40,0 -- read from the plan, not assumed)
const site0 = S.surveyStepwell(world().read, HOME, cand, OPT)
const box = S.planTank(site0.site).box   // [x0, z0, x1, z1]
const gapCol = [box[2] + 1, 0]            // a column of the gap ring (1 outside the footprint's x1 edge)
const footCol = [box[2], 0]               // a column of the footprint's own edge
const at = ([cx, cz], why) => (x, z) => (x === cx && z === cz ? why : null)

console.log('THE RESERVATIONS FIRST')
await t('POSITIVE CONTROL: the free candidate surveys ok and reads the world', () => {
  const w = world()
  const ok = S.surveyStepwell(w.read, HOME, cand, OPT)
  assert.ok(ok.ok, ok.why)
  assert.ok(w.reads > 1000, `only ${w.reads} reads`)
})
await t('a candidate with a reservation in its footprint is refused before ONE block is read (LIVE: the budget spent on reads of taken sites)', () => {
  const w = world()
  const r = S.surveyStepwell(w.read, HOME, cand, { ...OPT, blocked: at(footCol, 'project:monument') })
  assert.ok(!r.ok && r.why === 'reserved:project:monument', JSON.stringify(r))
  assert.strictEqual(w.reads, 0)
})
await t('a zone kind the stepwell may not take refuses before any read too', () => {
  const w = world()
  const r = S.surveyStepwell(w.read, HOME, cand, { ...OPT, zoneOf: (x, z) => (x === footCol[0] && z === footCol[1] ? 'homes' : 'wild') })
  assert.ok(!r.ok && r.why === 'zone:homes', JSON.stringify(r))
  assert.strictEqual(w.reads, 0)
})

console.log('THE GAP BESIDE A WALL')
await t('the GAP ring may lie in a wall\'s margin zone (project:wall, project:wallext): the site surveys ok', () => {
  for (const why of ['project:wall', 'project:wallext']) {
    const r = S.surveyStepwell(world().read, HOME, cand, { ...OPT, blocked: at(gapCol, why) })
    assert.ok(r.ok, `${why}: ${r.why}`)
  }
})
await t('POSITIVE CONTROLS: a wall zone IN the footprint, a record cell (`project`) or any other reservation in the gap still refuses', () => {
  const inFoot = S.surveyStepwell(world().read, HOME, cand, { ...OPT, blocked: at(footCol, 'project:wallext') })
  assert.ok(!inFoot.ok && inFoot.why === 'reserved:project:wallext', JSON.stringify(inFoot))
  for (const why of ['project', 'project:monument', 'zone', 'land:road', 'project:wallextra']) {
    const r = S.surveyStepwell(world().read, HOME, cand, { ...OPT, blocked: at(gapCol, why) })
    assert.ok(!r.ok && r.why === `reserved:${why}`, `${why}: ${JSON.stringify(r)}`)
  }
})
await t('reservedFor is the survey\'s own order: the first refusal by u then v; null when the footprint + gap is free', () => {
  const origin = S.originFor(cand.x, cand.z, cand.away, W)
  assert.strictEqual(S.reservedFor(origin, cand.away, W, S.SW.gap, {}), null)
  const seen = []
  S.reservedFor(origin, cand.away, W, S.SW.gap, { blocked: (x, z) => { seen.push([x, z]); return null } })
  assert.strictEqual(seen.length, (W + 2 * S.SW.gap) ** 2)
})
await t('MUTANT: without the gap rule (every reason refuses everywhere) the wall-margin site is refused -- the test fails for that reason', async () => {
  await withMutant(SW_PATH, 'if (why && (inside || !(gapOk && gapOk.test(String(why))))) return `reserved:${why}`', 'if (why) return `reserved:${why}`', async M => {
    const r = M.surveyStepwell(world().read, HOME, cand, { ...OPT, blocked: at(gapCol, 'project:wallext') })
    assert.ok(!r.ok && r.why === 'reserved:project:wallext', JSON.stringify(r))
  })
})
await t('MUTANT: with the prepass cut, a reserved candidate is no longer refused (the main loop no longer reads reservations)', async () => {
  await withMutant(SW_PATH, '  if (res) return { ok: false, why: res }\n', '', async M => {
    const w = world()
    const r = M.surveyStepwell(w.read, HOME, cand, { ...OPT, blocked: at(footCol, 'project:monument') })
    assert.ok(r.ok, 'the mutant still refused: the prepass is not the refusal')
  })
})

console.log('THE MEMOS')
await t('columnMemo asks each column once; sitingRead each cell once, bounded (cleared at max)', () => {
  let n = 0
  const f = S.columnMemo((x, z) => { n++; return x === 1 ? 'r' : null })
  for (let i = 0; i < 5; i++) { assert.strictEqual(f(1, 2), 'r'); assert.strictEqual(f(3, 4), null) }
  assert.strictEqual(n, 2)
  assert.strictEqual(S.columnMemo(null), null)
  let m = 0
  const rd = S.sitingRead((x, y, z) => { m++; return { name: `${x}` } }, 3)
  for (let i = 0; i < 4; i++) rd(1, 2, 3)
  assert.strictEqual(m, 1)
  rd(1, 1, 1); rd(2, 2, 2); rd(3, 3, 3)   // the 4th distinct cell clears the memo first
  rd(1, 2, 3)
  assert.strictEqual(m, 5)
})

console.log('THE WIRING (structural)')
await t('skills.mjs stepwellSite surveys over the memoised read and columns; a budget-cut siting waits STEPWELL_TIMEOUT_WAIT_MS, not 6 h', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const body = src.slice(src.indexOf('function stepwellSite ('), src.indexOf('async function buildStepwell ('))
  assert.ok(body.length > 200 && body.length < 8000, `stepwellSite not found (${body.length})`)
  assert.ok(/const read = swSitingRead\(stairRead\(bot\)\)/.test(body))
  assert.ok(/const blocked = swColumnMemo\(inp\.blocked\), zoneOf = swColumnMemo\(inp\.zoneOf\)/.test(body))
  assert.ok(/surveyStepwell\(read, home, cand, \{ blocked, zoneOf, treesOk: true \}\)/.test(body))
  assert.ok(/timedOut: !!why\.time/.test(body))
  assert.ok(/siteWaitSet\(STEPWELL_PLOT, s\.timedOut \? STEPWELL_TIMEOUT_WAIT_MS : STEPWELL_NOSITE_MS, s\.why\)/.test(src))
  assert.ok(/const STEPWELL_TIMEOUT_WAIT_MS = 30 \* 60_000/.test(src))
})

console.log(`\nstepwell03: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
