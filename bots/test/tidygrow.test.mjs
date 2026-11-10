// TIDYGROW-01 (LIVE showcase 11-10, /var/lib/mcai/_pool-showcase/project-0_70_0.tidy.g112-g122): every hourly refresh of the open
// inside-the-wall tidy record wrote TWO ~400 KB generations, 0-60 s apart -- the refresh (bom, cells, cut, segments: gens 112, 114,
// 116, 118, 120) and the claim retirement right after it (claimed, cut: gens 113, 115, 117, 119, 121), because the survey plans cuts
// inside a sited building's claim and gkPlanAdditions retires them in its own publish. recordHead reads and parses every generation
// (tidy 122 gens / 15.7 MB = 226 ms of a 519 ms pass over the town's 31 records, measured on the host with the live code).
// The fix (tidyrefresh.mjs refreshClaimed, wired in skills.mjs tidyRefresh): the claim retirement rides in the refresh's own publish.
// Through the real record chain (buildproj.mjs publishRecord / recordHead on a temp dir); mutants anchored (present and unique).
import assert from 'node:assert'
import fs, { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const TR = await import('../src/tidyrefresh.mjs')
const TD = await import('../src/tidy.mjs')
const BP = await import('../src/buildproj.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const TR_PATH = new URL('../src/tidyrefresh.mjs', import.meta.url)

// ---- the live shape: an open inwall record, a refresh survey with columns in a sited cottage's claim and columns outside -------------
const HOME = { x: 0, y: 70, z: 0 }
const REC0 = () => ({ v: 1, blueprint: 'tidy@1', plot: 'tidy', stageId: 'inwall', home: HOME, sitedAt: 1000, refreshAt: 1000,
  cells: [{ at: [1, 70, 3], role: 'earth', seg: 'T-00-0' }], cut: [{ at: [2, 71, 2], kind: 'tidy', name: 'dirt' }], clear: [],
  segments: [{ seg: 'T-00-0', deps: [] }], bom: { earth: 1 } })
// the cottage1 record (sited at -3,-32 on 11-08): its cells make the claim box (tidy.mjs buildingClaims, ring CLAIM_RING)
const COTTAGE = { plot: 'cottage1', cells: [{ at: [-5, 70, -34] }, { at: [-1, 70, -30] }] }
const CLAIMS = TD.buildingClaims([COTTAGE])
const FRESH = { home: HOME, segments: [{ seg: 'T-00-0', deps: [] }], clear: [],
  cells: [{ at: [-3, 69, -32], role: 'earth', seg: 'T-00-0' }, { at: [10, 69, 10], role: 'earth', seg: 'T-00-0' }],
  cut: [{ at: [-2, 72, -31], kind: 'tidy', name: 'cobblestone' }, { at: [11, 72, 11], kind: 'tidy', name: 'cobblestone' }] }
const NOW = 1000 + 61 * 60_000
const refreshBody = (M, cur, claims) => {
  const res = TR.refreshMerge(cur, FRESH, { busy: new Set(), guard: new Set(), now: NOW })
  return M.refreshClaimed(TR.refreshStamp(res.rec ?? cur, { now: NOW, added: res.added, skipped: res.skipped }), claims, TD.claimRetire)
}
/** One refresh then the claim pass (gkPlanAdditions' publish), on a real record chain -> { gens written, head }. */
function oneRefresh (M, { claims = CLAIMS, fix = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidygrow-'))
  const key = 'project-0_70_0.tidy'
  try {
    assert.strictEqual(BP.publishRecord(dir, key, () => REC0(), { by: 'root' }).result, 'accepted')
    const g0 = BP.recordHead(dir, key).head.gen
    BP.publishRecord(dir, key, cur => (fix ? refreshBody(M, cur, claims) : (() => { const res = TR.refreshMerge(cur, FRESH, { busy: new Set(), guard: new Set(), now: NOW }); return TR.refreshStamp(res.rec ?? cur, { now: NOW, added: res.added }) })()), { by: 'keeper' })
    BP.publishRecord(dir, key, cur => (cur ? TD.claimRetire(cur, CLAIMS) : null), { by: 'keeper' })   // the claim pass after it
    const h = BP.recordHead(dir, key)
    return { gens: h.head.gen - g0, head: h.head.rec }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
const inClaim = rec => [...rec.cells, ...rec.cut].filter(q => TD.claimEntry(q, CLAIMS)).length

await t('POSITIVE CONTROL -- the live composition: the refresh plans into the cottage\'s claim, the claim pass retires it: TWO generations', () => {
  assert.ok(CLAIMS.length === 1 && TD.claimEntry({ at: [-3, 69, -32] }, CLAIMS) && !TD.claimEntry({ at: [10, 69, 10] }, CLAIMS), 'the scenario\'s claim')
  const r = oneRefresh(TR, { fix: false })
  assert.strictEqual(r.gens, 2)
  assert.strictEqual(inClaim(r.head), 0)
})
await t('THE FIX: one refresh is ONE generation; the claim pass finds nothing; the head is the same record (claims retired, the rest added)', () => {
  const r = oneRefresh(TR)
  assert.strictEqual(r.gens, 1)
  assert.strictEqual(inClaim(r.head), 0)
  assert.ok(r.head.cells.some(q => q.at.join(',') === '10,69,10') && r.head.cut.some(q => q.at.join(',') === '11,72,11'), 'the columns outside the claim are added')
  assert.ok(r.head.claimed?.cottage1, 'the claim note written, as claimRetire writes it')
  assert.strictEqual(r.head.refreshed?.n, 1)
  const old = oneRefresh(TR, { fix: false }).head
  for (const k of ['cells', 'cut', 'clear', 'segments', 'claimed']) assert.deepStrictEqual(r.head[k], old[k], `${k}: the same head as the two-generation path`)
})
await t('refreshClaimed: no claims or nothing in them -> the record unchanged (the same object); unread claims ([]) as before', () => {
  const rec = { ...REC0() }
  assert.strictEqual(TR.refreshClaimed(rec, [], TD.claimRetire), rec)
  assert.strictEqual(TR.refreshClaimed(rec, undefined, TD.claimRetire), rec)
  assert.strictEqual(TR.refreshClaimed(rec, CLAIMS, TD.claimRetire), rec, 'nothing of REC0 is in the claim')
  assert.strictEqual(oneRefresh(TR, { claims: [] }).gens, 2, 'no claims read: the claim pass retires them after, as before')
})
await t('MUTANT KILLED: refreshClaimed ignoring the claims -> two generations again', async () => {
  await withMutant(TR_PATH, '(Array.isArray(claims) && claims.length ? retire(rec, claims) : null) ?? rec', 'rec', async M => {
    assert.strictEqual(oneRefresh(M).gens, 2, 'MUTANT: the claim pass writes its own generation')
  })
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
await t('skills.mjs tidyRefresh: the refresh body goes through refreshClaimed with the building claims (a cut line fails)', () => {
  const s = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const wired = src => src.split('return refreshClaimed(refreshStamp(res.rec ?? cur, { now, added: res.added, skipped: res.skipped, cap }), claims, claimRetire)').length === 2 &&
    src.split('try { const pr = claimOn() ? plotRecordsNow() : null; claims = pr ? buildingClaims(pr) : [] } catch { claims = [] }').length === 2
  assert.ok(wired(s))
  assert.ok(!wired(s.replace('claims, claimRetire)', 'claims)')), 'MUTANT: the retire not passed still reads wired')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
