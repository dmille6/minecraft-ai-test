// SINKWAIVE-01 (LIVE showcase 11-04/06): THE TOWER'S LAST CELLS. Tower T3 (project-0_70_0.tower g5) stood at 684 of 693 from 11-04
// 11:01Z; its crown cell 43,78,-11 (role T3-cr, seg T3-C) was deferred by Iris x2 (11-04 10:01-10:05Z), Alpha (10:02), Bravo (17:14)
// and Maple (11-05 06:06Z) -- 5 visits over 20 h, the other 8 open cells waiting on T3-C -- and from the 3rd every visit ended
// `stuck_on_cell` (stalled) and the 6-h back-off; 0 tower visits in the 658 build visits since 11-05 06:07Z. Its counts, summed
// over the 24-h forget window, had fallen back to 1-2 by 11-06 (Iris and Alpha aged out): a visit-count waiver on the window
// (the wall's) would never fire for a project visited this rarely. The fix (sinks.mjs sinkWaiveDue, wired in skills.mjs buildSink):
// a deferred cell counted >= 3 deferrals over every holder EVER, first deferred >= 6 h ago, is waived; the visit then completes.
// Pure on the live stuck files, then chained on the fake server; mutants anchored (present and unique).
import assert from 'node:assert'
import fs from 'node:fs'
const { R, PJ, G, HOME, server, bot } = await import('./helpers/buildfake.mjs')
const S = await import('../src/sinks.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const k = a => a.join(',')
const SINKS_PATH = new URL('../src/sinks.mjs', import.meta.url)
async function withMutant (file, old, neu, fn) {
  const src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const killedBy = async (file, old, neu, scenario) => {
  await scenario(S)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}

// ---- the live record and stuck files (11-06 01:24Z, /var/lib/mcai/_pool-showcase/project-0_70_0.tower.*) ----------------------
const STUCK = 'T3-cr'
const towerRec = (extra = {}) => ({ v: 1, blueprint: 'tower@1', plot: 'tower', kind: 'tower', instances: [{ id: 'T3' }],
  cells: [{ at: [43, 78, -11], role: STUCK, seg: 'T3-C' }, { at: [44, 78, -11], role: 'T3-cr', seg: 'T3-C' }, { at: [43, 79, -11], role: 'T3-light', seg: 'T3-D' },
          { at: [45, 78, -11], role: 'T3-cr', seg: 'T3-D' }], ...extra })
const FILES = {   // holder -> its file's cells (the live JSON, firstAt/lastAt ms)
  Alpha: { '43,78,-11': { visits: 1, firstAt: 1793790165350, lastAt: 1793790165350 } },
  Bravo: { '43,78,-11': { visits: 1, firstAt: 1793812469170, lastAt: 1793812469170 } },
  Iris: { '43,78,-11': { visits: 2, firstAt: 1793790086867, lastAt: 1793790302335 } },
  Maple: { '43,78,-11': { visits: 1, firstAt: 1793858781365, lastAt: 1793858781365 } },
}
const NOW = Date.parse('2026-11-06T01:24:00Z')
// buildproj stuckRead over these files, ALL TIME (no `since`) and over the 24-h forget window (the visit's own `total`)
function liveCounts (since = null) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/sinkwaive-`)
  const key = PJ.projKey(HOME, 'tower')
  for (const [h, cells] of Object.entries(FILES)) PJ.stuckWrite(dir, key, `showcase-${h}`, cells, { now: Math.max(...Object.values(cells).map(c => c.lastAt)) })
  return PJ.stuckRead(dir, key, since == null ? {} : { since })
}

console.log('THE LIVE TOWER (pure, on the live stuck files)')
await t('all time the crown cell has 5 deferrals, first 11-04 10:01Z; in the 24-h window only Maple\'s 1 (positive control: the files read)', () => {
  const all = liveCounts(), win = liveCounts(NOW - R.STUCK_FORGET_MS + 1)
  assert.strictEqual(all['43,78,-11'].visits, 5)
  assert.strictEqual(all['43,78,-11'].firstAt, 1793790086867)
  assert.strictEqual(win['43,78,-11'].visits, 1, JSON.stringify(win))
})
await t('the next visit that defers it WAIVES it (the all-time count, the first deferral 39 h old); on the window\'s count alone it never would', () => {
  const rec = towerRec()
  const deferred = [{ k: '43,78,-11', why: 'no_stand', visits: 2 }]   // runVisit's own summed total: Maple 1 + this visit
  assert.deepStrictEqual(S.sinkWaiveDue(rec, deferred, liveCounts(), NOW), [{ k: '43,78,-11', why: 'no_stand' }])
  assert.deepStrictEqual(S.sinkWaiveDue(rec, deferred, liveCounts(NOW - R.STUCK_FORGET_MS + 1), NOW), [], 'the window: 1 deferral, never 3')
})
await t('never: a young cell (first < 6 h), under 3 deferrals, a light, not a record cell, already waived, not deferred this visit; at most max', () => {
  const rec = towerRec(), d = [{ k: '43,78,-11', why: 'no_stand', visits: 3 }]
  assert.deepStrictEqual(S.sinkWaiveDue(rec, d, { '43,78,-11': { visits: 9, firstAt: NOW - S.SINK_WAIVE.afterMs + 60_000 } }, NOW), [], 'young')
  assert.deepStrictEqual(S.sinkWaiveDue(rec, [{ ...d[0], visits: 2 }], { '43,78,-11': { visits: 2, firstAt: NOW - 86400e3 } }, NOW), [], 'two deferrals')
  assert.deepStrictEqual(S.sinkWaiveDue(rec, [{ k: '43,79,-11', visits: 9 }], { '43,79,-11': { visits: 9, firstAt: 0 } }, NOW), [], 'a light')
  assert.deepStrictEqual(S.sinkWaiveDue(rec, [{ k: '9,9,9', visits: 9 }], { '9,9,9': { visits: 9, firstAt: 0 } }, NOW), [], 'not a record cell')
  assert.deepStrictEqual(S.sinkWaiveDue({ ...rec, waived: { '43,78,-11': {} } }, d, { '43,78,-11': { visits: 9, firstAt: 0 } }, NOW), [], 'already waived')
  assert.deepStrictEqual(S.sinkWaiveDue(rec, [], { '43,78,-11': { visits: 9, firstAt: 0 } }, NOW), [], 'not deferred this visit: no evidence now')
  const many = towerRec({ cells: [...Array(20)].map((_, i) => ({ at: [i, 70, 0], role: 'T1-w', seg: 'T1-A' })) })
  const def = many.cells.map(c => ({ k: k(c.at), visits: 3 })), cnt = Object.fromEntries(def.map(x => [x.k, { visits: 3, firstAt: 0 }]))
  const due = S.sinkWaiveDue(many, def, cnt, NOW)
  assert.strictEqual(due.length, S.SINK_WAIVE.max)
  assert.deepStrictEqual(S.sinkWaiveDue({ ...many, waived: Object.fromEntries(due.map(x => [x.k, {}])) }, def, cnt, NOW), [], 'the bound is per record, ever')
})
await t('the stone sinks only: road and shrine waive, dress and decor never (their own stall rules); sinkWaived reads the list, off -> never', () => {
  const d = [{ k: '43,78,-11', visits: 3 }], cnt = { '43,78,-11': { visits: 3, firstAt: 0 } }
  for (const [bp, n] of [['road@1', 1], ['shrine@1', 1], ['dress@1', 0], ['decor@1', 0]]) assert.strictEqual(S.sinkWaiveDue(towerRec({ blueprint: bp }), d, cnt, NOW).length, n, bp)
  const w = towerRec({ waived: { '43,78,-11': { why: 'no_stand' } } }), c = w.cells[0]
  assert.strictEqual(S.sinkWaived(w, c), true)
  assert.strictEqual(S.sinkWaived(w, c, false), false, 'SINKWAIVE=off: the cell reads open again')
  assert.strictEqual(S.sinkWaived(towerRec(), c), false)
  assert.strictEqual(S.sinkWaived({ ...w, blueprint: 'wall@1' }, c), false, 'another blueprint\'s list is not this rule\'s')
  assert.strictEqual(S.sinkWaived({ ...w, blueprint: 'decor@1' }, c), false)
})
await t('ONE builder visiting 25 h apart (Codex r1 BLOCKER): the stuck file forgets its own old deferrals (count 1, age 0 every visit); the lifetime tally waives at the 3rd visit', () => {
  const kk = '43,78,-11', rec = towerRec()
  let stuck = {}, life = {}
  const dues = []
  for (let i = 0; i < 5; i++) {
    const now = 1793790086867 + i * 25 * 3600_000
    // buildrun settleStuck: this holder's own file through the 24-h window, then rewritten (stuckAfter)
    const own = Object.fromEntries(Object.entries(stuck).filter(([, v]) => v.lastAt >= now - R.STUCK_FORGET_MS + 1))
    stuck = R.stuckAfter(own, [kk], { now, by: 'A' }).cells
    life = S.sinkDeferTally(life, [{ k: kk }], now)
    const onStuck = S.sinkWaiveDue(rec, [{ k: kk, visits: stuck[kk].visits }], stuck, now)
    const merged = S.sinkDeferMerge([life])
    dues.push(`${onStuck.length}/${S.sinkWaiveDue(rec, [{ k: kk, visits: stuck[kk].visits }], merged, now).length}`)
  }
  assert.deepStrictEqual(dues, ['0/0', '0/0', '0/1', '0/1', '0/1'], 'the stuck file alone never waives; the tally waives from the 3rd deferral (50 h after the first)')
  assert.deepStrictEqual(S.sinkDeferTally({ [kk]: { n: 2, firstAt: 5 } }, [], 9, k => k !== kk), {}, 'a cell no longer open leaves the tally')
  assert.deepStrictEqual(S.sinkDeferMerge([{ a: { n: 1, firstAt: 7 } }, { a: { visits: 2, firstAt: 3 } }]), { a: { visits: 3, firstAt: 3 } })
})
await t('MUTANT KILLED: a tally that forgets (n reset each visit) never reaches 3 deferrals', async () => {
  const third = M => { let life = {}; for (let i = 0; i < 3; i++) life = M.sinkDeferTally(life, [{ k: 'a' }], 1793790086867 + i * 25 * 3600_000); assert.strictEqual(M.sinkDeferMerge([life]).a.visits, 3) }
  await killedBy(SINKS_PATH, '    out[k] = { n: v.n + 1, firstAt: v.firstAt, lastAt: now }', '    out[k] = { n: 1, firstAt: now, lastAt: now }', third)
})
await t('MUTANTS: the age rule cut, the deferral floor cut, dress let in -- each killed', async () => {
  const young = M => assert.deepStrictEqual(M.sinkWaiveDue(towerRec(), [{ k: '43,78,-11', visits: 3 }], { '43,78,-11': { visits: 9, firstAt: NOW - 60_000 } }, NOW), [])
  await killedBy(SINKS_PATH, 'if (visits < minVisits || !Number.isFinite(first) || now - first < afterMs) continue', 'if (visits < minVisits || !Number.isFinite(first)) continue', young)
  const few = M => assert.deepStrictEqual(M.sinkWaiveDue(towerRec(), [{ k: '43,78,-11', visits: 1 }], { '43,78,-11': { visits: 1, firstAt: 0 } }, NOW), [])
  await killedBy(SINKS_PATH, 'if (visits < minVisits || !Number.isFinite(first) || now - first < afterMs) continue', 'if (!Number.isFinite(first) || now - first < afterMs) continue', few)
  const dress = M => assert.deepStrictEqual(M.sinkWaiveDue(towerRec({ blueprint: 'dress@1' }), [{ k: '43,78,-11', visits: 3 }], { '43,78,-11': { visits: 3, firstAt: 0 } }, NOW), [])
  await killedBy(SINKS_PATH, "export const sinkWaiveKind = kind => kind === 'road' || kind === 'tower' || kind === 'shrine'", "export const sinkWaiveKind = kind => kind !== 'decor'", dress)
})

console.log('THE CHAIN (fake server: a crown cell over water no stand reaches, the next segment waiting on it)')
// T3-C: the crown cell hangs over water (a sink visit has no footing remedy: deferred every visit); T3-D's cell waits on T3-C
const scene = () => {
  const srv = server()
  srv.set([20, G, 10], 'water')
  const rec = { v: 1, blueprint: 'tower@1', plot: 'tower', kind: 'tower', instances: [{ id: 'T3' }], clear: [], replant: [],
    cells: [{ at: [20, G + 1, 10], role: 'T3-cr', seg: 'T3-C' }, { at: [24, G + 1, 10], role: 'T3-cr', seg: 'T3-D' }],
    segments: [{ seg: 'T3-C', deps: [] }, { seg: 'T3-D', deps: ['T3-C'] }] }
  return { srv, rec }
}
const PAL = { 'T3-cr': ['cobblestone'] }
function project (record) {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/sinkwaive-`)
  const key = PJ.projKey(HOME, 'tower')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, 'A', S.SINK_BUILDERS)
  const p = (cur, extra = {}) => ({ dir, key, me: 'A', home: HOME, stood: [], record: cur, recordGen: pub.gen, palette: PAL, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: 40, foreign: S.SINK_FOREIGN, blockLayer: true, openRole: S.sinkOpenRole, stands: { pending: null, bans: {} }, ...extra })
  return { dir, key, p }
}
const cellsDone = (srv, rec, cur) => rec.cells.every(c => S.sinkWaived(cur, c) || R.cellDone(srv.read(...c.at), PAL, c.role))
await t('buildSink\'s loop: stuck_on_cell (stalled) at the 3rd visit; one visit 6 h later waives the crown, the next COMPLETES T3-D; nothing over the water', async () => {
  const { srv, rec } = scene(), pr = project(rec), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
  let clock = Date.parse('2026-11-04T10:00:00Z')
  e.now = () => clock
  let cur = rec
  const log = []
  for (let v = 0; v < 8 && !cellsDone(srv, rec, cur); v++) {
    const r = await R.runVisit(pr.p(cur, cur.waived ? { alsoDone: q => S.sinkWaived(cur, q) } : {}), e, { maxSteps: 400 })
    const due = S.sinkWaiveDue(cur, r.deferred ?? [], PJ.stuckRead(pr.dir, pr.key), clock)
    log.push(`${r.stop}:${due.map(x => x.k).join('+') || '-'}`)
    if (due.length) cur = { ...cur, waived: { ...(cur.waived ?? {}), ...Object.fromEntries(due.map(x => [x.k, { why: x.why }])) } }
    clock += 3 * 60 * 60_000   // a sink visit every few hours (the live cadence)
  }
  assert.ok(cellsDone(srv, rec, cur), log.join(' '))
  assert.strictEqual(log[R.STUCK_VISITS - 1].split(':')[0], 'stuck_on_cell', log.join(' '))
  assert.ok(log.findIndex(x => x.includes(k([20, G + 1, 10]))) >= R.STUCK_VISITS - 1, `never before 3 deferrals and 6 h (${log.join(' ')})`)
  assert.strictEqual(srv.read(24, G + 1, 10).name, 'cobblestone', 'T3-D placed once its dependency read done')
  assert.strictEqual(srv.read(20, G, 10).name, 'water', 'nothing over the water')
  const r2 = await R.runVisit(pr.p(cur, { alsoDone: q => S.sinkWaived(cur, q) }), e, { maxSteps: 400 })
  assert.strictEqual(r2.stop, 'complete', `${r2.stop}: ${r2.why}`)
})
await t('CONTROL (no waiver, the live behaviour): stuck_on_cell for good, T3-D never placed', async () => {
  const { srv, rec } = scene(), pr = project(rec), e = bot(srv, 'A', { inv: { cobblestone: 64 }, feet: [2, G + 1, 2] })
  const stops = []
  for (let v = 0; v < 5; v++) stops.push((await R.runVisit(pr.p(rec), e, { maxSteps: 400 })).stop)
  assert.strictEqual(stops.at(-1), 'stuck_on_cell', stops.join(','))
  assert.notStrictEqual(srv.read(24, G + 1, 10).name, 'cobblestone')
})

console.log('WIRING (source, comments stripped)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = src => {
  const one = re => { const m = src.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one("const due = sinkWaiveDue\\(rec, r\\.deferred, sinkDeferCounts\\(dir, key, me, r\\.deferred, k => open\\.has\\(k\\)\\), Date\\.now\\(\\)\\)")
  one("const next = sinkDeferTally\\(prev, deferred, now, keep\\)")
  one("const leave = rec\\?\\.waived && SINK_WAIVE\\.on && kind !== 'dress' && kind !== 'decor' \\? \\{ \\.\\.\\.leave0, alsoDone: q => sinkWaived\\(rec, q\\) \\} : leave0")
  one("if \\(sinkWaived\\(r, c\\)\\) return true")
  one("if \\(sinkWaived\\(r, c\\)\\) continue")
  one("if \\(wallWaived\\(r, c\\) \\|\\| pathWaived\\(r, c\\) \\|\\| sinkWaived\\(r, c\\)\\) return false")
  one("if \\(isSinkBlueprint\\(rec\\?\\.blueprint\\) && SINK_WAIVE\\.on && rec\\?\\.waived && stuckStale\\(keys, rec, c => recordCellDone\\(b, rec, c\\)\\)\\) return true")
  one("const stopW = waivedN > 0 \\? gkStopAfterWaive\\(r\\.stop, waivedN\\) : r\\.stop")
}
await t('buildSink waives after the visit and reads waived cells done (visit, completeness, damage, the stamp); a cut wiring line fails', () => {
  const src = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  wiring(src)
  const cut = "if (sinkWaived(r, c)) continue"
  assert.ok(src.split(cut).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(src.replace(cut, '')), assert.AssertionError, 'the damage-loop mutant must fail the wiring check')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
