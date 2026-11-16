// GKLEFT-01 (control session 11-08): a cell nobody can work is waived by the town. LIVE gkclear-02show 01:54-04:34Z: Onyx's keeper visits
// felled 2 logs (03:50Z) and laid 3 floor fills (04:05Z) -- visits that changed the ground clear the strikes -- then 04:16Z ended
// `complete; fills left 1/1372` with trunk clears standing: never an EMPTY visit (a fill left), no strike, no stage_close. Per cell now:
// every visit that ran out of work counts what it left; a cell left by 3 such visits town-wide is waived and the stage completes.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const W = await import('../src/gkwork.mjs')
const T = await import('../src/tidy.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const killedBy = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const W_PATH = new URL('../src/gkwork.mjs', import.meta.url)
const T_PATH = new URL('../src/tidy.mjs', import.meta.url)
const T0 = Date.parse('2026-11-08T04:16:16Z'), MIN = 60_000
// the live stage in miniature: 40 fills laid but one (no stand reaches it), 3 trunk logs of a tall spruce standing
const REC = { sitedAt: 1793892876060, stage: 1, stageId: 'inwall', cells: Array.from({ length: 41 }, (_, i) => ({ at: [i, 66, 0], role: 'earth' })), cut: [],
  clear: [0, 1, 2].map(i => ({ at: [-11, 67 + i, -54], kind: 'tree', name: 'spruce_log', tree: 6, plot: 'X2' })) }
const FILL = '40,66,0', LOGS = ['-11,67,-54', '-11,68,-54', '-11,69,-54']
const read = (x, y, z) => (x === -11 ? { name: 'spruce_log' } : x === 40 ? { name: 'air' } : { name: 'dirt' })
const fillDone = rec => q => (!!rec.waived && Object.prototype.hasOwnProperty.call(rec.waived, q.at.join(','))) || q.at[0] !== 40
const SIG = W.gkwSig(REC)

console.log('WHAT A VISIT LEFT (tidy.mjs tidyLeftKeys, tidyClearsLeft)')
await t('LIVE Onyx 04:16Z: the one fill and the 3 standing logs are left; an unread cell is never counted; a waived clear is not left', async () => {
  await killedBy(T_PATH, T, '  for (const c of rec?.cells ?? []) if (read(...c.at) && !fillDone(c))', '  for (const c of rec?.cells ?? []) if (!fillDone(c))', M => {
    assert.deepStrictEqual(M.tidyLeftKeys(REC, (x, y, z) => (x === 40 ? null : read(x, y, z)), { fillDone: fillDone(REC) }), LOGS, 'the unread fill is no evidence')
  })
  assert.deepStrictEqual(T.tidyLeftKeys(REC, read, { fillDone: fillDone(REC) }), [FILL, ...LOGS])
  assert.strictEqual(T.tidyClearsLeft(REC, read), 3)
  assert.strictEqual(T.tidyClearsLeft({ ...REC, waived: { [LOGS[0]]: {} } }, read), 2)
})

console.log('THE TOWN COUNTS PER CELL (gkwork.mjs leftNext / leftTown / leftWaiveDue)')
await t('three visits that ran out of work (any bots, any order) waive the left cells; two do not; the stage then completes', async () => {
  await killedBy(W_PATH, W, '    if (n < G.leftVisits) continue', '    if (n < 99) continue', M => {
    const files = new Map(); const left = [FILL, ...LOGS]
    for (const [who, dt] of [['Onyx', 0], ['Bravo', 20], ['Onyx', 40]]) files.set(who, M.leftNext(files.get(who) ?? null, { sig: SIG, keys: left, now: T0 + dt * MIN }))
    const town = M.leftTown([...files.values()], { sig: SIG, now: T0 + 41 * MIN })
    assert.strictEqual(town.get(FILL), 3)
    assert.deepStrictEqual(M.leftWaiveDue(REC, town, left).map(d => d.k), left)
  })
  const files = [W.leftNext(null, { sig: SIG, keys: [FILL], now: T0 }), W.leftNext(null, { sig: SIG, keys: [FILL], now: T0 + MIN })]
  assert.deepStrictEqual(W.leftWaiveDue(REC, W.leftTown(files, { sig: SIG, now: T0 + 2 * MIN }), [FILL]), [], 'two visits: not yet')
  // the waiver closes it: no fill left, no clear left
  const waived = { ...REC, waived: Object.fromEntries([FILL, ...LOGS].map(k => [k, { why: 'unreachable:3' }])) }
  assert.strictEqual(T.tidyProgress(waived, read, { fillDone: fillDone(waived) }).fillLeft, 0)
  assert.strictEqual(T.tidyClearsLeft(waived, read), 0)
})
await t('bounds: a new stage starts the count again; a stale count (> 24 h) is forgotten; a cell no longer open is never waived; the share cap', () => {
  const f = W.leftNext(W.leftNext(null, { sig: SIG, keys: [FILL], now: T0 }), { sig: 'other', keys: [FILL], now: T0 + MIN })
  assert.strictEqual(f.cells[FILL].ts.length, 1)
  assert.strictEqual(W.leftTown([{ sig: SIG, cells: { [FILL]: { ts: [T0, T0 + 1, T0 + 2] } } }], { sig: SIG, now: T0 + 25 * 60 * MIN }).get(FILL), undefined)
  const town = new Map([[FILL, 9], [LOGS[0], 9]])
  assert.deepStrictEqual(W.leftWaiveDue(REC, town, [LOGS[0]]).map(d => d.k), [LOGS[0]], 'the fill reads laid now: not waived')
  const full = { ...REC, waived: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`${i},66,0`, {}])) }   // ceil(0.25 * 44) = 11
  assert.deepStrictEqual(W.leftWaiveDue(full, town, [FILL]), [])
})
await t('leftVisit: one file per holder in the town dir; the town sum across them; a count:false read adds nothing; an unwritable dir is an empty map', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gkleft-'))
  try {
    const key = 'project-0_70_0.tidy'
    W.leftVisit(dir, key, 'showcase-Onyx', REC, [FILL], { now: T0 })
    W.leftVisit(dir, key, 'showcase-Bravo', REC, [FILL], { now: T0 + MIN })
    const m = W.leftVisit(dir, key, 'showcase-Onyx', REC, [FILL], { now: T0 + 2 * MIN, count: false })
    assert.strictEqual(m.get(FILL), 2)
    assert.strictEqual(fs.readdirSync(dir).filter(n => n.includes('.gkleft.')).length, 2)
    assert.strictEqual(W.leftVisit(path.join(dir, 'x\0'), key, 'k', REC, [FILL]).size, 0)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

await t('Codex r1 BLOCKER: two visits 25 h ago and one now count ONE, not three (each visit expires on its own); a waived clear is dropped from the visit', async () => {
  await killedBy(W_PATH, W, "  for (const k of new Set(keys)) cells[k] = { ts: [...(cells[k]?.ts ?? []), now].slice(-G.leftVisits) }", "  for (const k of new Set(keys)) cells[k] = { ts: [...(prev?.cells?.[k]?.ts ?? []), now].map(() => now).slice(-G.leftVisits) }", M => {
    let f = M.leftNext(null, { sig: SIG, keys: [FILL], now: T0 })
    f = M.leftNext(f, { sig: SIG, keys: [FILL], now: T0 + MIN })
    f = M.leftNext(f, { sig: SIG, keys: [FILL], now: T0 + 25 * 60 * MIN })
    assert.strictEqual(M.leftTown([f], { sig: SIG, now: T0 + 25 * 60 * MIN + 1 }).get(FILL), 1)
  })
  const w = { ...REC, waived: { [LOGS[1]]: {} } }
  assert.deepStrictEqual(T.dropWaivedClears(w).clear.map(c => c.at.join(',')), [LOGS[0], LOGS[2]])
  assert.strictEqual(T.dropWaivedClears(REC), REC, 'none waived: the same record')
})

console.log('WIRING (skills.mjs, comments stripped)')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = s => {
  const one = re => { const m = s.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one("const left = tidyLeftKeys\\(rw, read2, progOpts\\)")
  one("const town = leftVisit\\(dir, key, me, rw, left, \\{ count: r\\.stop === 'complete' \\}\\)")
  one('const due = caps\\.waive \\? leftWaiveDue\\(rw, town, left\\) : \\[\\]')
  one('let prog = tidyProgress\\(rw, read2, progOpts\\)')
  one('record: GKW_ON \\? dropWaivedClears\\(recV\\) : recV')
  const i = s.indexOf('const left = tidyLeftKeys('), j = s.indexOf('if (caps.complete && !crewHolds && !platformUp(rw)')
  assert.ok(i > 0 && j > i, 'the waiver runs before the completion test')
}
await t('buildTidy counts and waives before the completion; a cut line fails', () => {
  const s = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  wiring(s)
  const cut = 'const due = caps.waive ? leftWaiveDue(rw, town, left) : []'
  assert.ok(s.split(cut).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(s.replace(cut, '')), assert.AssertionError)
})

await t('fold BLOCKER: a hollow fill that names its opener is never waived by the left count', async () => {
  const W = await import('../src/gkwork.mjs')
  const rec = { cells: [{ at: [1, 64, 1], role: 'earth', opener: [1, 65, 1] }, { at: [2, 64, 2], role: 'earth' }], clear: [], waived: {} }
  const town = new Map([['1,64,1', 5], ['2,64,2', 5]])
  const due = W.leftWaiveDue(rec, town, ['1,64,1', '2,64,2'], { G: { leftVisits: 3, leftMax: 12 }, share: 1 })
  assert.deepStrictEqual(due.map(d => d.k), ['2,64,2'], 'POSITIVE: the plain cell is waived; the opener-sealed fill is not')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
