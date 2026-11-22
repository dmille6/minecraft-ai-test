// TIDYTAIL-01SHOW: the tidy's tail is set aside with a proof; a project with only set-aside cells is not offered.
// Behaviour through the chain tailAsideFor -> tailReread -> tailOnly -> tailNext -> tailQuiet -> the offering (groundsRecord), on fixtures
// of the four LIVE tails (11-22 showcase: first cells 14,68,-36 / 4,65,-65 / -33,67,-81 / 4,64,-66 / 9,68,-44), with a positive control
// (an open cell with a stand keeps the project offered), the reopen rules (another code version, expiry, a laid cell, an unread cell, a
// re-survey), the yard row's outcome, and the wiring. Anchored mutants (each asserts its anchor present and unique).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const T = await import('../src/tidytail.mjs')
const G2 = await import('../src/grounds2.mjs')
const FC = await import('../src/fillcolumn.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) } }
const TT = new URL('../src/tidytail.mjs', import.meta.url)
const SK = new URL('../src/skills.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 60))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')

const TAILS = [[14, 68, -36], [4, 65, -65], [-33, 67, -81], [4, 64, -66], [9, 68, -44]]
const CODE = 'v-now', NOW = Date.UTC(2026, 10, 22, 3, 0)
const k = c => c.join(',')
/** A record: ordinary fills (laid), the stuck cell at `tail`, and `extra` cells; 2967 cuts all down (cut: []). */
function rec0 (tail, { extra = [], aside, tailMark, cut = [] } = {}) {
  const cells = [{ at: [tail[0] + 5, tail[1], tail[2]], role: 'earth', seg: 'S1' }, { at: tail, role: 'earth', seg: 'S1' }, ...extra]
  return { sitedAt: 1, stage: 0, cells, cut, waived: {}, ...(aside ? { aside } : {}), ...(tailMark ? { tail: tailMark } : {}) }
}
const laid = new Set()
const read = (x, y, z) => ({ name: laid.has(`${x},${y},${z}`) ? 'dirt' : 'air' })
const unreadAll = () => null
const done = c => laid.has(k(c.at))
const defer = (c, why = 'no_stand', visits = 3) => ({ k: k(c), why, visits })

for (const tail of TAILS) {
  await t(`tail ${k(tail)}: stalled, 3 visits, no stand -> set aside; only it left -> quiet; not offered (the groundsRecord says complete)`, () => {
    laid.clear(); laid.add(k([tail[0] + 5, tail[1], tail[2]]))
    const rec = rec0(tail)
    const adds = T.tailAsideFor({ rec, deferred: [defer(tail)], stalled: true, read, done })
    assert.deepStrictEqual(adds.map(a => a.k), [k(tail)])
    const re = T.tailReread({ rec, read, done, code: CODE, now: NOW })
    assert.strictEqual(re.live.size, 0)
    const inSet = new Set(adds.map(a => a.k))
    assert.ok(T.tailOnly({ open: [k(tail)], aside: inSet, cutLeft: 0 }))
    const next = T.tailNext(rec, { adds, only: true, code: CODE, now: NOW, by: 'Bot' })
    assert.deepStrictEqual(Object.keys(next.aside), [k(tail)])
    assert.strictEqual(next.aside[k(tail)].code, CODE)
    assert.ok(T.tailQuiet(next, { code: CODE, now: NOW + 60_000 }))
    assert.strictEqual(G2.groundsRecord({ shopDone: true, rec: next, tail: T.tailQuiet(next, { code: CODE, now: NOW + 60_000 }) }), 'complete')
    // the record keeps the list and the cell stays OWED: not complete, not waived
    assert.ok(!next.structure_complete); assert.deepStrictEqual(next.waived, {})
  })
}
await t('POSITIVE CONTROL: an open cell the visit can work (not deferred) keeps the project offered', () => {
  laid.clear()
  const rec = rec0(TAILS[0], { extra: [{ at: [20, 66, 20], role: 'earth', seg: 'S2' }] })
  const adds = T.tailAsideFor({ rec, deferred: [defer(TAILS[0])], stalled: true, read, done })
  assert.strictEqual(adds.length, 1)
  assert.ok(!T.tailOnly({ open: [k(TAILS[0]), '20,66,20', '19,68,-36'], aside: new Set(adds.map(a => a.k)), cutLeft: 0 }))
  const next = T.tailNext(rec, { adds, only: false, code: CODE, now: NOW })
  assert.ok(!next.tail); assert.ok(!T.tailQuiet(next, { code: CODE, now: NOW }))
  assert.strictEqual(G2.groundsRecord({ shopDone: true, rec: next, tail: false }), 'open')
})
await t('a cut left, an unread cell, or nothing open: never tail-only', () => {
  const s = new Set(['a'])
  assert.ok(!T.tailOnly({ open: ['a'], aside: s, cutLeft: 1 }))
  assert.ok(!T.tailOnly({ open: ['a'], aside: s, unread: true }))
  assert.ok(!T.tailOnly({ open: [], aside: s }))
  assert.ok(T.tailOnly({ open: ['a'], aside: s }))
})
await t('proof refusals: not stalled, 2 visits, a footing/cover/material reason, unread, laid, prev, waived, already aside', () => {
  laid.clear()
  const c = TAILS[1], rec = rec0(c)
  const go = (d, o = {}) => T.tailAsideFor({ rec, deferred: [d], stalled: true, read, done, ...o })
  assert.strictEqual(go(defer(c)).length, 1)
  assert.strictEqual(go(defer(c), { stalled: false }).length, 0)
  assert.strictEqual(go(defer(c, 'no_stand', 2)).length, 0)
  for (const why of ['footing no_material', 'cover open', 'attempts_spent', 'sealed x']) assert.strictEqual(go(defer(c, why)).length, 0, why)
  assert.strictEqual(go(defer(c, 'swap no_stand')).length, 1)
  assert.strictEqual(go(defer(c), { read: unreadAll }).length, 0)
  laid.add(k(c)); assert.strictEqual(go(defer(c)).length, 0); laid.clear()
  assert.strictEqual(T.tailAsideFor({ rec: { ...rec, cells: rec.cells.map(q => ({ ...q, prev: 1 })) }, deferred: [defer(c)], stalled: true, read, done }).length, 0)
  assert.strictEqual(T.tailAsideFor({ rec: { ...rec, waived: { [k(c)]: {} } }, deferred: [defer(c)], stalled: true, read, done }).length, 0)
  assert.strictEqual(go(defer(c), { live: new Set([k(c)]) }).length, 0)
  assert.strictEqual(T.tailAsideFor({ rec, deferred: Array.from({ length: 100 }, (_, i) => defer([i, 70, 0])), stalled: true, read, done }).length, 0)
})
await t('a set-aside cell is re-opened: another code version, expiry, laid, unread, a re-survey, the hold ending', () => {
  laid.clear()
  const c = TAILS[2], rec = T.tailNext(rec0(c), { adds: [{ k: k(c), why: 'no_stand:3' }], only: true, code: CODE, now: NOW, by: 'B' })
  const R = (o = {}) => T.tailReread({ rec, read, done, code: CODE, now: NOW + 1000, ...o })
  assert.ok(R().live.has(k(c)))
  assert.deepStrictEqual(R({ code: 'v-next' }).drop, [{ k: k(c), why: 'version' }])
  assert.deepStrictEqual(R({ now: NOW + T.TAIL.ttlMs + 1 }).drop, [{ k: k(c), why: 'expired' }])
  assert.deepStrictEqual(R({ read: unreadAll }).drop, [{ k: k(c), why: 'unread' }])
  laid.add(k(c)); assert.deepStrictEqual(R().drop, [{ k: k(c), why: 'laid' }]); laid.clear()
  assert.ok(T.tailQuiet(rec, { code: CODE, now: NOW + 1000 }))
  assert.ok(!T.tailQuiet(rec, { code: 'v-next', now: NOW + 1000 }), 'a later release')
  assert.ok(!T.tailQuiet(rec, { code: CODE, now: NOW + T.TAIL.holdMs + 1 }), 'the hold ends')
  assert.ok(!T.tailQuiet({ ...rec, cut: [{ at: [1, 1, 1] }] }, { code: CODE, now: NOW + 1000 }), 're-survey: a new cut moves the signature')
  assert.ok(!T.tailQuiet({ ...rec, structure_complete: true }, { code: CODE, now: NOW }))
  // the drop reaches the record: aside empties, the mark goes
  const back = T.tailNext(rec, { drops: R({ code: 'v-next' }).drop, only: false, code: 'v-next', now: NOW + 2000 })
  assert.ok(!back.aside && !back.tail)
})
await t('the mark is not rewritten every visit (a generation a visit), and an unchanged record yields null', () => {
  const c = TAILS[3], rec = T.tailNext(rec0(c), { adds: [{ k: k(c), why: 'w' }], only: true, code: CODE, now: NOW })
  assert.strictEqual(T.tailNext(rec, { only: true, code: CODE, now: NOW + 60_000 }), null)
  const renew = T.tailNext(rec, { only: true, code: CODE, now: NOW + T.TAIL.holdMs * 0.6 })
  assert.strictEqual(renew.tail.at, NOW + T.TAIL.holdMs * 0.6)
  assert.strictEqual(T.tailNext(rec0(c), { only: false, code: CODE, now: NOW }), null)
})
await t('the cells resting on a set-aside cell go with it (fillcolumn waiveRests), or stay open when a side holds them', () => {
  laid.clear()
  const base = [10, 68, -36]
  const rec = rec0(base, { extra: [{ at: [10, 69, -36], role: 'earth', seg: 'S1' }, { at: [10, 70, -36], role: 'earth', seg: 'S1' }] })
  const rd = (x, y, z) => ({ name: y >= 68 ? 'air' : 'stone', boundingBox: y >= 68 ? 'empty' : 'block' })
  const rests = FC.waiveRests(rec, [{ k: k(base) }], rd, { done: () => false })
  assert.ok(rests.every(r => /^fillcolumn:rests_on /.test(r.why)))
  const set = new Set([k(base), ...rests.map(r => r.k)])
  const open = rec.cells.filter(c => c.at[0] === 10).map(c => k(c.at))
  // either the dependents are in the set (tail-only) or they stay open (still offered): never silently dropped
  assert.strictEqual(T.tailOnly({ open, aside: set }), open.every(x => set.has(x)))
})
await t('yardRowOutcome: banked or placed is success; nothing is no_effect (the label)', () => {
  assert.deepStrictEqual(T.yardRowOutcome({ banked: { cobblestone: 64 }, placed: 0 }), { status: 'success', stop: 'row', banked: 64, placed: 0 })
  assert.strictEqual(T.yardRowOutcome({ banked: {}, placed: 2 }).status, 'success')
  assert.strictEqual(T.yardRowOutcome({ banked: { dirt: 0 }, placed: 0 }).status, 'no_effect')
  assert.strictEqual(T.yardRowOutcome({}).stop, 'row_none')
})
await t('TIDYTAIL off', () => { assert.ok(!T.tailOn({ TIDYTAIL: 'off' })); assert.ok(T.tailOn({})) })

// ---- anchored mutants ------------------------------------------------------------------------------------------------------------
const mut = (name, old, neu, check) => t(`mutant killed: ${name}`, () => withMutant(TT, old, neu, async M => {
  let died = false
  try { check(M) } catch { died = true }
  assert.ok(died, 'the mutant survived')
}))
const C = TAILS[0]
const chain = M => {
  laid.clear()
  const rec = rec0(C)
  assert.strictEqual(M.tailAsideFor({ rec, deferred: [defer(C)], stalled: true, read, done }).length, 1)
  assert.strictEqual(M.tailAsideFor({ rec, deferred: [defer(C, 'footing no_material')], stalled: true, read, done }).length, 0)
  assert.strictEqual(M.tailAsideFor({ rec, deferred: [defer(C, 'no_stand', 2)], stalled: true, read, done }).length, 0)
  assert.strictEqual(M.tailAsideFor({ rec, deferred: [defer(C)], stalled: false, read, done }).length, 0)
  assert.strictEqual(M.tailAsideFor({ rec, deferred: [defer(C)], stalled: true, read: unreadAll, done }).length, 0)
  const r2 = M.tailNext(rec, { adds: [{ k: k(C), why: 'w' }], only: true, code: CODE, now: NOW })
  assert.ok(M.tailQuiet(r2, { code: CODE, now: NOW + 1 }))
  assert.ok(!M.tailQuiet(r2, { code: 'x', now: NOW + 1 }))
  assert.ok(!M.tailQuiet(r2, { code: CODE, now: NOW + M.TAIL.holdMs + 1 }))
  assert.ok(!M.tailQuiet({ ...r2, cut: [{ at: [1, 1, 1] }] }, { code: CODE, now: NOW + 1 }))
  const R = o => M.tailReread({ rec: r2, read, done, code: CODE, now: NOW + 1, ...o }).drop.length
  assert.strictEqual(R({}), 0); assert.strictEqual(R({ code: 'y' }), 1); assert.strictEqual(R({ read: unreadAll }), 1); assert.strictEqual(R({ now: NOW + M.TAIL.ttlMs + 5 }), 1)
  laid.add(k(C)); assert.strictEqual(R({}), 1); laid.clear()
  assert.ok(!M.tailOnly({ open: [k(C)], aside: new Set([k(C)]), cutLeft: 1 }))
  assert.ok(!M.tailOnly({ open: [k(C), 'z'], aside: new Set([k(C)]) }))
  assert.strictEqual(M.yardRowOutcome({ banked: { a: 1 } }).status, 'success')
}
await t('the chain holds on the real module (control for the mutants)', () => chain(T))
await mut('no_stand reason not required', 'if (!NO_STAND.test(String(d?.why ?? \'\'))) continue', '', chain)
await mut('visit floor ignored', 'if ((Number(d?.visits) || 0) < T.visits) continue', '', chain)
await mut('stalled not required', 'if (!stalled || !rec) return []', 'if (!rec) return []', chain)
await mut('unread cell accepted', 'if (!read(...c.at)) continue          // unread: no evidence', '', chain)
await mut('version not compared', "else if ((e?.code ?? null) !== code) drop.push({ k, why: 'version' })", "else if (false) drop.push({ k, why: 'version' })", chain)
await mut('expiry not applied', 'else if (!(Number.isFinite(e?.at) && e.at <= now + 60_000 && now - e.at < T.ttlMs)) drop.push({ k, why: \'expired\' })', 'else if (false) drop.push({ k, why: \'expired\' })', chain)
await mut('unread not dropped', "else if (!read(...c.at)) drop.push({ k, why: 'unread' })", "else if (false) drop.push({ k, why: 'unread' })", chain)
await mut('laid not dropped', "else if (done(c)) drop.push({ k, why: 'laid' })", "else if (false) drop.push({ k, why: 'laid' })", chain)
await mut('cuts ignored by tailOnly', 'if (unread || Number(cutLeft) > 0 || !open.length) return false', 'if (unread || !open.length) return false', chain)
await mut('open cells outside the set ignored', 'return open.every(k => aside.has(k))', 'return open.some(k => aside.has(k))', chain)
await mut('quiet ignores the version', 'return t.code === code && t.sig === gkwSig(rec)', 'return t.sig === gkwSig(rec)', chain)
await mut('quiet ignores the signature', 'return t.code === code && t.sig === gkwSig(rec)', 'return t.code === code', chain)
await mut('quiet never ends', 'now - t.at < T.holdMs\n}', 'true\n}', chain)
await mut('banked is not work', 'const work = nb + (Number(placed) || 0) > 0', 'const work = (Number(placed) || 0) > 0', chain)

// ---- wiring (structural: comments stripped, the executable line) -----------------------------------------------------------------
const src = strip(readFileSync(SK, 'utf8'))
const WIRES = [
  ['the tidy state is complete for offering', /const complete = !!rec\?\.structure_complete \|\| \(p\.plot === TIDY_PLOT && tidyTailQuiet\(rec, now\)\)/],
  ['the visit stops with tail_aside', /if \(!rec\.structure_complete && tidyTailQuiet\(rec\)\) return out\('no_effect', 'tail_aside'/],
  ['the proofs are read again before the scan', /asideHeld = tailReread\(\{ rec, read, code: tailCodeNow\(\)/],
  ['the aside cells are passed by the visit', /asideHeld\.has\(q\.at\.join\(','\)\)/],
  ['the keeper room-fallback read', /return !!r && \(\(!r\.structure_complete && !tidyTailQuiet\(r\)\) \|\| tidyDue\(r\)/],
  ['the keeper work read', /tidyWork: !!r && \(\(!r\.structure_complete && !tidyTailQuiet\(r\)\) \|\| tidyDue\(r\)/],
  ['the lane read', /open: !!irec && !irec\.structure_complete && !tidyTailQuiet\(irec\)/],
  ['the quota read', /stuck, tail: tidyTailQuiet\(rec\) \}\)/],
  ['the post-visit decision', /const upd = tailNext\(rw, \{ drops: re\.drop/],
  ['the yard row label', /return out\(ro\.status, 'yard_row'/],
]
for (const [name, re] of WIRES) {
  await t(`wired: ${name} (and a one-character mutant of the line is not matched)`, () => {
    assert.ok(re.test(src), 'wired')
    const m = src.match(re)[0]
    assert.strictEqual(src.split(m).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
    assert.ok(!re.test(src.replace(m, m.replace(/[A-Za-z]/, '#'))))
  })
}
console.log(`\ntidytail: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
