// CLAIM-01 (bots/src/tidy.mjs buildingClaims / claimedAt / claimEntry / claimRetire; skills.mjs buildTidy's execution-time pass,
// the keeper's claim retirement, recordOwned's soft tidy cells). LIVE showcase 11-08: the in-wall tidy stage (g96) holds 46 cells and
// 83 cuts (48 standing) inside the town hall's site on X2 and the cottage's on X3 -- untagged, so plotprep-02 never retires them.
// Replayed: both buildings sited on the dump, the tidy's overlap 46 / 83 / 0 clears before claimRetire, 0 / 0 / 0 after.
// Here: the pure rules, then THE CHAIN on the fake server (the real runVisit): without the pass the tidy builds inside the claim
// (the positive control), with it nothing there; the progress count; anchored mutants; the wiring.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { R, PJ, G, server, bot, SITE, project, BP } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const T_PATH = new URL('../src/tidy.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
async function withTMutant (old, neu, fn) {
  const src = readFileSync(T_PATH, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const hall = { plot: 'townhall', cells: [{ at: [10, 70, 10] }, { at: [14, 72, 16] }], fill: [[9, 69, 12]], clear: [{ at: [15, 75, 11], kind: 'leaves' }] }
const tidyRec = {
  cells: [{ at: [11, 70, 11], role: 'earth', seg: 'T-1' }, { at: [30, 70, 30], role: 'earth', seg: 'T-2' }, { at: [16, 69, 17], role: 'core', seg: 'T-1' }],
  cut: [{ at: [12, 71, 12], kind: 'tidy', name: 'dirt' }, { at: [40, 71, 40], kind: 'tidy', name: 'dirt' }],
  clear: [{ at: [13, 74, 13], kind: 'leaves', name: 'oak_leaves' }], replant: [{ cell: [12, 70, 13], state: 'pending' }],
  segments: [{ seg: 'T-1', deps: [] }, { seg: 'T-2', deps: [] }],
}

console.log('THE PURE RULES')
await t('buildingClaims: a claim plot\'s x/z box over its cells, fills and clears + the ring; other plots and empty records: none', () => {
  assert.deepStrictEqual(T.buildingClaims([hall]), [{ plot: 'townhall', box: [8, 9, 16, 17] }])
  assert.deepStrictEqual(T.buildingClaims([{ ...hall, plot: 'monument' }, { plot: 'townhall', cells: [] }, null]), [])
  assert.deepStrictEqual(T.buildingClaims([{ plot: 'cottage1', cells: [{ at: [0, 1, 0] }] }], { ring: 0 }), [{ plot: 'cottage1', box: [0, 0, 0, 0] }])
  assert.deepStrictEqual([...T.CLAIM_PLOTS], ['townhall', 'cottage1', 'cottage2', 'cottage3'])   // cottage2-01: every cottage owns its volume
})
await t('claimedAt / claimEntry: every height of the box\'s columns; outside, unread: none', () => {
  const cl = T.buildingClaims([hall])
  assert.strictEqual(T.claimedAt(cl, [8, -60, 9]), 'townhall')
  assert.strictEqual(T.claimedAt(cl, [16, 300, 17]), 'townhall')
  assert.strictEqual(T.claimedAt(cl, [17, 70, 17]), null)
  assert.strictEqual(T.claimedAt(cl, null), null)
  assert.strictEqual(T.claimEntry({ at: [12, 71, 12] }, cl), true)
  assert.strictEqual(T.claimEntry({}, cl), false)
})
await t('claimRetire: the cells, cuts and clears inside leave; outside stay; replants stay; an emptied segment goes; nothing inside -> null', () => {
  const cl = T.buildingClaims([hall])
  const r = T.claimRetire(tidyRec, cl)
  assert.deepStrictEqual(r.cells.map(c => c.at.join(',')), ['30,70,30'])
  assert.deepStrictEqual(r.cut.map(c => c.at.join(',')), ['40,71,40'])
  assert.deepStrictEqual(r.clear, [])
  assert.deepStrictEqual(r.replant, tidyRec.replant, 'G5: the replants are kept')
  assert.deepStrictEqual(r.segments.map(s => s.seg), ['T-2'])
  assert.deepStrictEqual(r.claimed, { townhall: { box: [8, 9, 16, 17], n: 4 } })
  assert.strictEqual(T.claimRetire(r, cl), null, 'nothing left inside: no generation')
  assert.strictEqual(T.claimRetire(tidyRec, []), null)
  assert.strictEqual(T.claimOn({ CLAIM: 'off' }), false); assert.strictEqual(T.claimOn({}), true)
})

// ---- THE CHAIN: the fake server, a tidy-like visit of the workshop's pad, a claim over half of it ----------------------------------
const padRec = () => ({ ...SITE.record, cells: SITE.record.cells.filter(c => c.seg === 'pad'), segments: SITE.record.segments.filter(s => s.seg === 'pad') })
async function visit (claims, M = T) {
  const srv = server()
  const rec = padRec()
  const pr = project(rec)
  const h = PJ.recordHead(pr.dir, pr.key)
  const e = bot(srv, 'A')
  const claimedQ = q => claims.length > 0 && M.claimEntry(q, claims)
  const r = await R.runVisit({ ...pr.p('A'), record: h.head.rec, recordGen: h.head.gen, alsoDone: q => claimedQ(q) }, e, { maxSteps: 600 })
  // counted by the REAL rule (a mutant changes what the visit does, never what the test calls inside)
  const inClaim = rec.cells.filter(c => claims.length > 0 && T.claimEntry(c, claims))
  const placedIn = inClaim.filter(c => srv.read(...c.at).name !== 'air').length
  const placedOut = rec.cells.filter(c => !(claims.length > 0 && T.claimEntry(c, claims)) && srv.read(...c.at).name !== 'air').length
  return { r, inClaim: inClaim.length, placedIn, placedOut, total: rec.cells.length }
}
const half = () => { const xs = padRec().cells.map(c => c.at[0]), zs = padRec().cells.map(c => c.at[2]); const mx = Math.floor((Math.min(...xs) + Math.max(...xs)) / 2); return [{ plot: 'townhall', box: [Math.min(...xs), Math.min(...zs), mx, Math.max(...zs)] }] }

console.log('THE CHAIN (fake server, the real runVisit)')
await t('POSITIVE CONTROL (the fight): with no claim the visit builds the cells inside the building\'s box too', async () => {
  const cl = half()
  const v = await visit([])
  const inside = padRec().cells.filter(c => T.claimEntry(c, cl))
  assert.ok(inside.length > 0)
  assert.strictEqual(v.placedOut, v.total, 'every pad cell built, the ones in the claim box too')
})
await t('with the claim: nothing is placed inside it, everything outside is, and the visit still completes', async () => {
  const v = await visit(half())
  assert.ok(v.inClaim > 0)
  assert.strictEqual(v.placedIn, 0, JSON.stringify(v))
  assert.strictEqual(v.placedOut, v.total - v.inClaim, JSON.stringify(v))
  assert.strictEqual(v.r.stop, 'complete', v.r.stop + ' ' + v.r.why)
})
await t('the retired record counts nothing inside the claim as left (tidyLeftKeys over the head)', () => {
  const read = server().read
  const cl = T.buildingClaims([hall])
  const before = T.tidyLeftKeys(tidyRec, read)
  const after = T.tidyLeftKeys(T.claimRetire(tidyRec, cl), read)
  assert.ok(before.includes('11,70,11') && before.includes('16,69,17'), 'positive control: the claimed fills are left before')
  assert.deepStrictEqual(after, ['30,70,30'], 'after: only the cell outside the claim')
})
await t('MUTANT: claimEntry never true -- the visit builds inside the claim again (killed for that reason)', async () => {
  await withTMutant('export const claimEntry = (q, claims) => !!claimedAt(claims, q?.at)', 'export const claimEntry = (q, claims) => false', async M => {
    const v = await visit(half(), M)
    assert.ok(v.placedIn > 0, 'the mutant fights over the building\'s cells')
    assert.strictEqual(M.claimRetire(tidyRec, T.buildingClaims([hall])), null, 'and retires nothing')
  })
})
await t('MUTANT: the ring dropped -- an entry in the ring beside the pad stays the tidy\'s (the ring is tested)', async () => {
  await withTMutant("export const CLAIM_RING = 1\n", 'export const CLAIM_RING = 0\n', async M => {
    assert.strictEqual(M.claimEntry({ at: [9, 70, 9] }, M.buildingClaims([{ plot: 'townhall', cells: [{ at: [10, 70, 10] }] }])), false)
  })
  assert.strictEqual(T.claimEntry({ at: [9, 70, 9] }, T.buildingClaims([{ plot: 'townhall', cells: [{ at: [10, 70, 10] }] }])), true)
})
await t('wired (structural, comments stripped): the visit\'s pass, the cuts, the progress, the keeper\'s retirement, recordOwned', () => {
  const sk = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const line of ['const waivedK = q => claimedQ(q) || plotEntryRetired(q, plotsSited) ||',
    'const cuts0 = tidyCuts(rec, read, mem).filter(q => !claimedQ(q) && ',
    'if (claimsNow.length) visitRec = { ...visitRec, clear: (visitRec.clear ?? []).filter(q => !claimedQ(q)) }',
    'const progOpts = { fillDone: q => claimedQ(q) || ',
    "given: k => guard.has(k) || claimedQ({ at: k.split(',').map(Number) }) || ",
    'const pub = publishRecord(dir, key, cur => (cur ? claimRetire(cur, claims) : null), { by: me })',
    'const soft = claimOn() && [TIDY_PLOT, LAND_PLOT].includes(h.plot); if (!soft) for (const c of r?.cells ?? [])']) {
    assert.strictEqual(sk.split(line).length, 2, `wiring missing or not unique: ${line}`)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
