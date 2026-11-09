// FILLSHARE-01 (control session 11-09, the 6:03 CT status report: inside-wall tidy 160 cuts / 26 fills since 00:00Z on the showcase).
// runVisit dug the tidy's cuts FIRST, up to GK.clearMax tries, and a crew visit's ~2 min budget ran out in them: keeper visits placed
// 0 fills in 47 visits (02:39-12:40Z), a helper holding the clear lease cut its whole visit. While a stage's fills are further behind
// than its cuts (and a fill is workable with earth in the bag), a HELPER fills first and cuts with the time left (`clearsLast`), and
// the KEEPER digs at most FILLSHARE.keeperCutsBehind cuts before its fills. Behaviour on buildfake's world; the wiring structurally.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const { G, HOME, server, bot, PJ, R } = await import('./helpers/buildfake.mjs')
const T = await import('../src/tidy.mjs')
const GKM = await import('../src/groundskeeper.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const BUILDRUN_PATH = new URL('../src/buildrun.mjs', import.meta.url)
const GK_PATH = new URL('../src/groundskeeper.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}`)
  assert.strictEqual(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const col = (srv, x, z, y0, y1, name) => { for (let y = y0; y <= y1; y++) srv.set([x, y, z], name) }

// THE LIVE COUNTS (11-09 11:13Z row: cuts left 536/1098, fills left 1339/2601): fills 51% open vs cuts 49% -> behind
const LIVE = { fillsLeft: 1339, fillsTotal: 2601, cutsLeft: 536, cutsTotal: 1098 }

console.log('THE SHARE (pure)')
await t('tidyShare: fills behind + ready -> a helper fills first (clearsLast), the keeper cuts at most 6; not behind or not ready -> 16 as before', async () => {
  await killedBy(GK_PATH, GKM, "return role === 'keeper' ? { clearMax: Math.min(G.clearMax, F.keeperCutsBehind), clearsLast: false, behind: true } : { clearMax: G.clearMax, clearsLast: true, behind: true }", 'return base', M => {
    assert.deepStrictEqual(M.tidyShare({ role: 'helper', ...LIVE, fillReady: true, on: true }), { clearMax: 16, clearsLast: true, behind: true })
    assert.deepStrictEqual(M.tidyShare({ role: 'keeper', ...LIVE, fillReady: true, on: true }), { clearMax: 6, clearsLast: false, behind: true })
  })
  const base = { clearMax: GKM.GK.clearMax, clearsLast: false, behind: false }
  assert.deepStrictEqual(GKM.tidyShare({ role: 'helper', ...LIVE, fillReady: false, on: true }), base, 'no workable fill / no earth: the cuts as before')
  assert.deepStrictEqual(GKM.tidyShare({ role: 'helper', fillsLeft: 100, fillsTotal: 1000, cutsLeft: 500, cutsTotal: 1000, fillReady: true, on: true }), base, 'cuts further behind: as before')
  assert.deepStrictEqual(GKM.tidyShare({ role: 'keeper', ...LIVE, fillReady: true, on: false }), base, 'GKFILLSHARE=0')
  assert.deepStrictEqual(GKM.tidyShare({ role: 'helper', fillsLeft: 5, fillsTotal: 10, cutsLeft: 0, cutsTotal: 0, fillReady: true, on: true }).clearsLast, true, 'no cuts total: fills behind')
  assert.deepStrictEqual(GKM.tidyShare({ role: 'helper', fillsLeft: 0, fillsTotal: 0, cutsLeft: 3, cutsTotal: 9, fillReady: true, on: true }), base, 'no fills: as before')
  assert.strictEqual(GKM.fillShareOn({ GKFILLSHARE: '0' }), false); assert.strictEqual(GKM.fillShareOn({}), true)
})
await t('tidyShare: the comparison is fills BEHIND cuts (a mutant that compares the counts, not the fractions, flips the LIVE case)', async () => {
  await killedBy(GK_PATH, GKM, 'if (!(fl > cl)) return base', 'if (!(Number(fillsLeft) < Number(cutsLeft))) return base', M => {
    assert.strictEqual(M.tidyShare({ role: 'helper', ...LIVE, fillReady: true, on: true }).clearsLast, true)
  })
})

console.log('THE VISIT (runVisit clearsLast): a pit to fill, a row of cuts, a 60 s budget, 10 s a dig')
// one 1x1 pit (3 deep: a fill segment) at 9,1 and twelve one-block bumps to cut along x = -3..-14 at z = 0
const scene = () => {
  const srv = server()
  col(srv, 9, 1, G - 2, G, 'air')
  const s = T.surveyTidy(srv.read, { home: HOME })
  const rec = T.tidyRecord(s, { home: HOME, T: { ...T.TIDY, segCells: 3 } })
  const cuts = []
  for (let i = 0; i < 12; i++) { const at = [-3 - i, G + 1, 0]; srv.set(at, 'dirt'); cuts.push({ at, kind: 'tidy', name: 'dirt' }) }
  return { srv, rec: { ...rec, cut: cuts }, cuts }
}
const visit = async (RM, extra) => {
  const { srv, rec, cuts } = scene()
  assert.ok(rec.cells.length >= 3, `the pit is a fill segment (${rec.cells.length} cells)`)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fs-'))
  const key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 1)
  let clock = 1_000_000
  const ops = []
  const e = bot(srv, 'A', { inv: { dirt: 64, cobblestone: 64 }, feet: [0, G + 1, 0], dig: async c => { clock += 10_000; srv.set(c, 'air'); return 'confirmed' } })
  e.now = () => clock
  const log0 = e.log
  e.log = (k, d) => { if (k === '_build' && (d.op === 'place' || d.op === 'clear')) ops.push(d.op); return log0(k, d) }
  const r = await RM.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: cuts, recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 48, clearMax: 16, tidyKeepOrder: true, stuckStalledOnly: true, ...extra }, e, { deadline: clock + 60_000, maxSteps: 400 })
  return { r, ops, srv }
}
await t('control: cuts first -- the 60 s budget ends in the cuts, the pit gets NO fill (the live keeper: 0 fills in 47 visits)', async () => {
  const { r, ops } = await visit(R, {})
  assert.strictEqual(r.stop, 'deadline')
  assert.ok(r.cleared >= 5, `cuts dug ${r.cleared}`)
  assert.strictEqual(r.placed, 0, `ops ${ops.join(',')}`)
})
await t('clearsLast: the pit is filled first, then the cuts with the time left (and the visit still ends at the budget)', async () => {
  const { r, ops, srv } = await visit(R, { clearsLast: true })
  assert.ok(r.placed >= 3, `placed ${r.placed}: ${ops.join(',')}`)
  assert.strictEqual(ops[0], 'place', `first op ${ops[0]}`)
  assert.ok(ops.lastIndexOf('place') < ops.indexOf('clear'), `every fill before the first cut: ${ops.join(',')}`)
  assert.ok(r.cleared >= 1, `the cuts after: ${r.cleared}`)
  assert.notStrictEqual(srv.read(9, G, 1).name, 'air', 'the pit top is laid')
})
await t('MUTANT KILLED: the first clears pass ignoring clearsLast -> the cuts eat the visit again', async () => {
  await killedBy(BUILDRUN_PATH, R, 'if (!stairOpen && !p.clearsLast) { const s = await clears()', 'if (!stairOpen) { const s = await clears()', async M => {
    const { r } = await visit(M, { clearsLast: true })
    assert.ok(r.placed >= 3, `placed ${r.placed}`)
  })
})
await t('MUTANT KILLED: no clears pass at the end -> a clearsLast visit with time left digs no cut', async () => {
  await killedBy(BUILDRUN_PATH, R, '    if (p.clearsLast) { const s = await clears(); if (s) { out.stop = s; return out } }\n', '\n', async M => {
    const { r } = await visit(M, { clearsLast: true })
    assert.ok(r.cleared >= 1, `cleared ${r.cleared}`)
  })
})
await t('clearMax 6 (the keeper behind): at most 6 cuts, then a fill in the same visit (control above: 16 -> no fill)', async () => {
  const { r, ops } = await visit(R, { clearMax: 6 })
  // 6 digs = 60 s; the fills take no clock in the fake -> laid before the deadline; the pass after the finished segment cuts on
  assert.deepStrictEqual(ops.slice(0, 6), Array(6).fill('clear'), ops.join(','))
  assert.strictEqual(ops[6], 'place', ops.join(','))
  assert.ok(r.placed >= 1, `placed ${r.placed} stop ${r.stop} ops ${ops.join(',')}`)   // the pit's layers are one segment each: the pass after each cuts again
})

console.log('THE BILL (fillshare-01b): one visit\'s topsoil holds back dirt, not the stage\'s')
const TIDY_PATH = new URL('../src/tidy.mjs', import.meta.url)
// LIVE 11-09 11:12Z Onyx: bag dirt 227, cobble 68, yard draw bill:22 dug 4 in ~50 s; the stage holds hundreds of open topsoil cells
const bill = M => M.fillWant({ open: 400, openAccess: 0, dirt: M.earthDirt(150, 300, M.TIDY_VISIT_FILLS), cobble: 5, visitCap: M.TIDY_VISIT_FILLS })
await t('earthDirt: 150 spare dirt, 300 open topsoil -> 118 for the earth fills, the visit bills 0 (control: the old offset bills 27 -> a yard draw)', async () => {
  await killedBy(TIDY_PATH, T, 'return Math.max(0, (Number(spareDirt) || 0) - Math.min(Math.max(0, Number(openSoil) || 0), Math.max(0, Number(visitCap) || 0)))', 'return Math.max(0, (Number(spareDirt) || 0) - Math.max(0, Number(openSoil) || 0))', M => {
    assert.strictEqual(M.earthDirt(150, 300, 32), 118)
    assert.strictEqual(bill(M), 0)
  })
  assert.strictEqual(T.fillWant({ open: 400, dirt: Math.max(0, 150 - 300), cobble: 5, visitCap: 32 }), 27, 'control: the stage-wide offset')
  assert.strictEqual(T.earthDirt(20, 300, 32), 0, 'a bag short of one visit\'s topsoil keeps it all')
  assert.strictEqual(T.earthDirt(40, 0, 32), 40, 'no topsoil: every spare dirt')
})

console.log('THE WIRING (skills.mjs buildTidy)')
const wiring = s => {
  const one = re => { const m = s.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one('share = tidyShare\\(\\{ role, fillsLeft: open \\+ openSoil \\+ openAccess,')
  one('clearMax: GROUNDS\\.on \\? share\\.clearMax : TIDY_CLEAR_MAX, \\.\\.\\.\\(share\\.clearsLast \\? \\{ clearsLast: true \\} : \\{\\}\\)')
  one("const want = fillWant\\(\\{ open, openAccess, dirt: earthDirt\\(spare\\('dirt'\\), openSoil, TIDY_VISIT_FILLS\\),")
  one('const fillReady = !!workableSeg\\(visitRec, read, palette, tidySegOk, waivedK, \\{ skipOpenDeps: true \\}\\) && TIDY_PALETTE\\.earth\\.some')
}
await t('wiring: the share is computed and passed to the tidy visit; a cut line fails', () => {
  const s = strip(readFileSync(SKILLS_PATH, 'utf8'))
  wiring(s)
  const cut = '...(share.clearsLast ? { clearsLast: true } : {})'
  assert.strictEqual(s.split(cut).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(s.replace(cut, '')), assert.AssertionError)
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
