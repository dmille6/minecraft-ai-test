// OVERSEER-01 (bots/src/overseer.mjs): per-bot job lists, the host's cycle. Behaviour of the pure rules -- split by position into
// whole columns, no cell in two lists, rebalance by measured rate, quarantine on repeated failure by several bots, a stalled bot's
// list reassigned with an unstick order, scar intake with dedupe and protected-zone skip -- then anchored mutants for each rule.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const O = await import('../src/overseer.mjs')
const O_PATH = new URL('../src/overseer.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (old, neu, fn) {
  const src = readFileSync(O_PATH, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-ov-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (scenario, M) => { try { await scenario(M); return false } catch (e) { if (!(e instanceof assert.AssertionError) && !(e instanceof TypeError)) throw e; return true } }
const mutant = (name, old, neu, scenario) => t(`MUTANT KILLED: ${name}`, async () => {
  await scenario(O)
  assert.ok(await withMutant(old, neu, M => killedBy(scenario, M)), 'the mutant survived')
})

const NOW = 1_800_000_000_000
const job = (M, x, y, z, o = {}) => ({ ...M.newJob({ kind: 'remove', at: [x, y, z], block: 'dirt', from: 'scar' }, NOW - 3_600_000), ...o })
const bot = (name, x, z, o = {}) => ({ name, pos: [x, 64, z], online: true, rate: 10, lastProgressAt: NOW - 60_000, ...o })
const owners = book => Object.fromEntries(book.map(j => [j.id, j.owner]))

// ---------------------------------------------------------------- split
const splitScenario = async M => {
  // two areas: west (x -20) and east (x +20); a pillar of 3 at the boundary x=1 must go whole to one bot
  const book = [job(M, -20, 65, 0), job(M, -21, 65, 0), job(M, 20, 65, 0), job(M, 21, 65, 0), job(M, 1, 65, 0), job(M, 1, 66, 0), job(M, 1, 67, 0)]
  const out = M.splitOpen(book, [bot('W', -20, 0), bot('E', 20, 0)], { now: NOW })
  const o = owners(out)
  assert.strictEqual(o['r:-20,65,0'], 'W'); assert.strictEqual(o['r:-21,65,0'], 'W')
  assert.strictEqual(o['r:20,65,0'], 'E'); assert.strictEqual(o['r:21,65,0'], 'E')
  const pil = new Set(['r:1,65,0', 'r:1,66,0', 'r:1,67,0'].map(id => o[id]))
  assert.strictEqual(pil.size, 1, 'a column is never split'); assert.ok(!pil.has(null), 'the pillar is given')
  // every job in exactly one list
  const docs = ['W', 'E'].map(b => M.listDoc(out, b, { home: { x: 0, y: 64, z: 0 }, now: NOW }))
  const ids = docs.flatMap(d => d.jobs.map(j => j.id))
  assert.strictEqual(ids.length, new Set(ids).size); assert.strictEqual(ids.length, 7)
}
await t('split: nearest bot, whole columns, no cell in two lists', () => splitScenario(O))
await mutant('split ignores the column rule', 'const k = colKey(j.at); if (!cols.has(k)) cols.set(k, []); cols.get(k).push(j) }\n  const todo',
  'const k = cellKey(j.at); if (!cols.has(k)) cols.set(k, []); cols.get(k).push(j) }\n  const todo', async M => {
    // capacity forces a choice: 2 bots, 4 jobs, cap 2 each; the pillar of 2 must stay whole
    // a pillar of 3 and one block beside it; shares are 2 each: the pillar still goes WHOLE (to an idle bot), never 2 + 1
    const book = [job(M, 0, 65, 0), job(M, 0, 66, 0), job(M, 0, 67, 0), job(M, 1, 65, 0)]
    const o = owners(M.splitOpen(book, [bot('A', 0, 0), bot('B', 1, 0)], { now: NOW }))
    assert.strictEqual(new Set([o['r:0,65,0'], o['r:0,66,0'], o['r:0,67,0']]).size, 1); assert.ok(o['r:0,65,0'])
  })

const capScenario = async M => {
  // all work beside A; B is far. Shares by rate (A 10/h, B 10/h): each gets half, so B is not idle while A has 6
  const book = Array.from({ length: 6 }, (_, i) => job(M, i, 65, 0))
  const o = Object.values(owners(M.splitOpen(book, [bot('A', 0, 0), bot('B', 200, 0)], { now: NOW })))
  assert.strictEqual(o.filter(x => x === 'A').length, 3); assert.strictEqual(o.filter(x => x === 'B').length, 3)
}
await t('split: shares by rate, a far bot still gets work', () => capScenario(O))
await mutant('split without the share cap', 'load.get(b.name) < cap.get(b.name))', 'true)', capScenario)

const avoidScenario = async M => {
  const book = [job(M, 0, 65, 0, { avoid: ['A'] })]
  assert.strictEqual(M.splitOpen(book, [bot('A', 0, 0), bot('B', 50, 0)], { now: NOW })[0].owner, 'B')
  const later = [job(M, 0, 65, 0, { notBefore: NOW + 1 })]
  assert.strictEqual(M.splitOpen(later, [bot('A', 0, 0)], { now: NOW })[0].owner, null, 'notBefore waits')
}
await t('split: an avoided bot is passed over; notBefore waits', () => avoidScenario(O))
await mutant('split ignores avoid', '!avoid.has(b.name) && ', '', avoidScenario)
await mutant('split ignores notBefore', "if (js.some(j => j.notBefore > now)) continue", '', avoidScenario)

// ---------------------------------------------------------------- rebalance
const rateScenario = async M => {
  // A holds 30 at 5/h (6 h), B holds 0 at 20/h -> move until even: 30*20/25 = 24 to B
  const book = Array.from({ length: 30 }, (_, i) => job(M, i, 65, 0, { owner: 'A' }))
  const { book: out, moved } = M.rebalance(book, [bot('A', 0, 0, { rate: 5 }), bot('B', 40, 0, { rate: 20 })], { now: NOW })
  assert.strictEqual(moved, 24)
  const toB = out.filter(j => j.owner === 'B')
  assert.ok(toB.every(j => j.notBefore >= NOW + O.OVERSEER.leaseMs), 'a moved job waits out the old lease')
  assert.ok(Math.min(...toB.map(j => j.at[0])) > Math.max(...out.filter(j => j.owner === 'A').map(j => j.at[0])), 'the donor gives the columns nearest the receiver')
  // even lists at even rates: nothing moves
  const even = [...Array.from({ length: 10 }, (_, i) => job(M, i, 65, 0, { owner: 'A' })), ...Array.from({ length: 10 }, (_, i) => job(M, i, 65, 9, { owner: 'B' }))]
  assert.strictEqual(M.rebalance(even, [bot('A', 0, 0), bot('B', 0, 9)], { now: NOW }).moved, 0)
}
await t('rebalance: by measured rate, nearest columns, after the lease', () => rateScenario(O))
await mutant('rebalance by count not rate', 'const ws = weight(slow, T), wf = weight(fast, T)', 'const ws = 1, wf = 1', rateScenario)
await mutant('rebalance without the lease wait', 'j.owner = fast.name; j.notBefore = until', 'j.owner = fast.name', rateScenario)

// ---------------------------------------------------------------- quarantine
const quarScenario = async M => {
  let j = job(M, 0, 65, 0, { owner: 'A' })
  j = M.recordAttempt(j, { bot: 'A', why: 'no_stand', now: NOW })
  assert.strictEqual(j.state, 'open'); assert.strictEqual(j.owner, 'A')
  j = M.recordAttempt(j, { bot: 'A', why: 'no_stand', now: NOW })
  assert.deepStrictEqual(j.avoid, ['A']); assert.strictEqual(j.owner, null, 'two fails by one bot: it goes to another')
  assert.strictEqual(j.state, 'open', 'one bot alone never quarantines')
  j = M.recordAttempt({ ...j, owner: 'B' }, { bot: 'B', why: 'sight', now: NOW })
  assert.strictEqual(j.state, 'quarantined'); assert.match(j.why, /^no_stand x3 by 2 bots$/)
  let solo = job(M, 3, 65, 0)
  for (let i = 0; i < 3; i++) solo = M.recordAttempt(solo, { bot: 'A', why: 'no_stand', now: NOW })
  assert.strictEqual(solo.state, 'open', 'three fails by ONE bot: another bot tries before it is quarantined')
  // done closes
  assert.strictEqual(M.recordAttempt(job(M, 1, 65, 0), { bot: 'A', why: 'done', now: NOW }).state, 'done')
}
await t('quarantine: N fails by M bots, with its commonest reason', () => quarScenario(O))
await mutant('quarantine without the bots rule', '&& bots.size >= T.quarantineBots', '', quarScenario)
await mutant('no avoid after repeated own failure', 'if (byBot >= T.avoidAfter && !j.avoid.includes(bot))', 'if (false)', quarScenario)

const ingestScenario = async M => {
  const book = [job(M, 0, 65, 0, { owner: 'A' }), job(M, 1, 65, 0, { owner: 'A' }), job(M, 2, 65, 0, { owner: 'A' })]
  const out = M.ingestReport(book, 'A', { ids: { done: ['r:0,65,0'], gone: [], refused: ['r:1,65,0'], unreachable: ['r:2,65,0'] } }, { now: NOW, whyOf: id => (id === 'r:1,65,0' ? 'water' : null) })
  assert.deepStrictEqual(out.map(j => j.state), ['done', 'open', 'open'])
  assert.strictEqual(out[1].attempts[0].why, 'water'); assert.strictEqual(out[2].attempts[0].why, 'unreachable')
}
await t('a visit report (worklist-01show shape) becomes attempts', () => ingestScenario(O))

// ---------------------------------------------------------------- stalls
const stallScenario = async M => {
  const book = [job(M, 0, 65, 0, { owner: 'S' }), job(M, 1, 65, 0, { owner: 'S' }), job(M, 9, 65, 0, { owner: 'K' })]
  const bots = [bot('S', 0, 0, { lastProgressAt: NOW - O.OVERSEER.stallMs, givenAt: NOW - O.OVERSEER.stallMs }), bot('K', 9, 0)]
  const { book: out, orders } = M.stalls(book, bots, { now: NOW })
  assert.deepStrictEqual(orders.map(o => [o.bot, o.order]), [['S', 'unstick']])
  assert.deepStrictEqual(out.map(j => j.owner), [null, null, 'K'])
  assert.ok(out[0].notBefore >= NOW + O.OVERSEER.leaseMs)
  // a bot with nothing held is never stalled; a fresh bot is not
  assert.strictEqual(M.stalls(book, [bot('S', 0, 0, { lastProgressAt: NOW - 1000 }), bot('K', 9, 0, { lastProgressAt: 0, givenAt: 0 })], { now: NOW }).orders.length, 1)
  // the whole cycle: the stalled bot's work goes to the other
  const c1 = M.overseerCycle({ book, bots, now: NOW, home: { x: 0, y: 64, z: 0 } })
  assert.ok(c1.book.filter(j => j.at[0] < 5).every(j => j.owner === null), 'released, not handed on inside the old lease')
  bots[0].unstuckAt = NOW   // the host records the order
  const c = M.overseerCycle({ book: c1.book, bots, now: NOW + O.OVERSEER.leaseMs + 1, home: { x: 0, y: 64, z: 0 } })
  assert.ok(c.book.filter(j => j.state === 'open').every(j => j.owner === 'K')); assert.ok(!('S' in c.lists))
}
await t('stall: no progress for T -> list reassigned + unstick order', () => stallScenario(O))
await mutant('no grace after unstick', '&& !(now - Number(x.unstuckAt ?? -Infinity) < T.unstickMs)', '', stallScenario)
await mutant('stall clock off', 'if (now - since >= T.stallMs)', 'if (false)', stallScenario)

// ---------------------------------------------------------------- scar intake
const intakeScenario = async M => {
  const zones = [{ id: 'v', box: [49, -64, -59, 157, 90, 45] }]
  const book = [job(M, 0, 65, 0, { state: 'quarantined' })]
  const { added, skipped } = M.intakeScar([
    { at: [0, 65, 0], block: 'dirt' },          // dup of a quarantined job: never re-added
    { at: [100, 70, 0], block: 'dirt' },        // in the village
    { at: [3, 65, 3], block: 'cobblestone' },   // a record cell
    { at: [5, 65, 5], block: 'dirt', shape: 'host:pillar' },
    { at: [5, 65, 5], block: 'dirt' },          // dup within the same scan
    { at: [1.5, 65, 0], block: 'dirt' },
  ], book, { zones, guard: k => k === '3,65,3', now: NOW })
  assert.deepStrictEqual(added.map(j => j.id), ['r:5,65,5']); assert.strictEqual(added[0].src.ref, 'host:pillar')
  assert.deepStrictEqual(skipped, { dup: 2, zone: 1, record: 1, malformed: 1, cap: 0, far: 0 })
}
await t('scar intake: dedupe (any state), zone skip, record skip', () => intakeScenario(O))
await mutant('intake without the zone skip', 'if (inZone(at, zones)) { skipped.zone++; continue }', '', intakeScenario)
await mutant('intake without dedupe', 'if (have.has(id)) { skipped.dup++; continue }', '', intakeScenario)

// ---------------------------------------------------------------- the list file
await t('listDoc: worklist-01show v1 shape, top-first pillar with after', async () => {
  const book = O.splitOpen([job(O, 2, 65, 2), job(O, 2, 66, 2)], [bot('A', 0, 0)], { now: NOW })
  const d = O.listDoc(book, 'A', { home: { x: 0.5, y: 64, z: 0.5 }, now: NOW })
  assert.deepStrictEqual([d.v, d.kind, d.project, d.bot, d.home], [1, 'worklist', 'tidy', 'A', [0, 64, 0]])
  assert.deepStrictEqual(d.jobs.map(j => j.id), ['r:2,66,2', 'r:2,65,2']); assert.deepStrictEqual(d.jobs[1].after, ['r:2,66,2'])
  assert.strictEqual(d.expires, NOW + 60 * 60_000, 'r6: a list lives 60 min (one skipped slot is harmless)'); assert.strictEqual(O.listLease('Comet'), 'seg-clear-wlComet')
})

// ---------------------------------------------------------------- overseer-01show phase 1
// the stalled bot's own file carries the order (and no jobs): the bot reads it from where it is
await t('a stalled bot gets a list with its unstick order and no jobs; a grace bot gets no list', async () => {
  const book = [job(O, 0, 65, 0, { owner: 'S' }), job(O, 9, 65, 0, { owner: 'K' })]
  const c = O.overseerCycle({ book, bots: [bot('S', 0, 0, { lastProgressAt: NOW - O.OVERSEER.stallMs, givenAt: NOW - O.OVERSEER.stallMs }), bot('K', 9, 0)], now: NOW, home: { x: 0, y: 64, z: 0 } })
  assert.strictEqual(c.lists.S.order.kind, 'unstick'); assert.strictEqual(c.lists.S.jobs.length, 0); assert.ok(c.lists.S.order.id.startsWith('unstick:S:'))
  assert.ok(!c.lists.K.order); assert.ok(c.lists.K.jobs.length >= 1)
})
// phase 1's source: the clean-up record's removals, the town's 128 blocks only
const radiusScenario = async M => {
  const cells = [{ at: [10, 65, 0], block: 'dirt' }, { at: [128, 65, -5], block: 'cobblestone' }, { at: [129, 65, 0], block: 'dirt' }, { at: [0, 65, -200], block: 'dirt' }]
  const c = M.overseerCycle({ cells, bots: [bot('A', 0, 0)], now: NOW, home: { x: 0.5, y: 64, z: 0.5 }, radius: 128 })
  assert.deepStrictEqual(c.book.map(j => j.id).sort(), ['r:10,65,0', 'r:128,65,-5'])
  assert.ok(c.book.every(j => j.src.from === 'tidy'))
  assert.match(c.row, / far=2 /); assert.match(c.row, / added=2 /)
}
await t('intake: the record\'s cells within the radius only, the row counts the far ones', () => radiusScenario(O))
await mutant('intake ignores the radius', 'if (home && dist(home, at) > radius) { skipped.far++; continue }', '', radiusScenario)

// the wire format: every id comes back with its outcome and its reason, no row over 300, the non-attempts left out
const wireScenario = async M => {
  const ids = n => Array.from({ length: n }, (_, i) => `r:${100 + i},${-60 + i},${-1000 - i}`)
  const rep = { ids: { done: ids(20), gone: ['r:1,2,3'], refused: ['r:5,6,7', 'r:8,9,10', 'r:4,4,4'], unreachable: ['r:0,70,0'] }, why: { 'r:5,6,7': 'water', 'r:8,9,10': 'blocked', 'r:4,4,4': 'not spoil' } }
  const rows = M.idRows(rep, { issued: 1234 })
  assert.ok(rows.length >= 2, 'it takes more than one row'); assert.ok(rows.every(r => r.length <= 300), 'no row over the logger\'s 300')
  const back = rows.map(M.parseIdRow)
  assert.ok(back.every(b => b && b.list === 1234))
  const all = k => back.flatMap(b => b.ids[k])
  assert.deepStrictEqual(all('done'), rep.ids.done); assert.deepStrictEqual(all('gone'), ['r:1,2,3']); assert.deepStrictEqual(all('unreachable'), ['r:0,70,0'])
  assert.deepStrictEqual(all('refused'), ['r:5,6,7', 'r:4,4,4'], 'blocked is no attempt')
  assert.strictEqual(Object.assign({}, ...back.map(b => b.why))['r:5,6,7'], 'water'); assert.strictEqual(Object.assign({}, ...back.map(b => b.why))['r:4,4,4'], 'not_spoil')
  assert.strictEqual(M.parseIdRow('op=visit list=1 n=2'), null)
}
await t('id rows: one codec both ways, reasons kept, <= 300 a row, blocked/unread never an attempt', () => wireScenario(O))
await mutant('rows past 300', "if (cur.length && head.length + cur.join(';').length + 1 + e.length > rowMax) { out.push(head + cur.join(';')); cur = [] }", '', wireScenario)
await mutant('blocked counted as an attempt', 'if (why && NOT_AN_ATTEMPT.has(why)) continue', '', wireScenario)

// reports are ingested once (by identity); rate and progress are measured from every row in the window
const rowsScenario = async M => {
  const r = (bot, t, d) => ({ bot, t, detail: d })
  const rows = [r('A', NOW - 90 * 60_000, 'op=ids list=1 ids=d:r:1,2,3;d:r:1,3,3'), r('A', NOW - 10 * 60_000, 'op=ids list=2 ids=g:r:4,4,4;r:r:5,5,5=water'),
    r('B', NOW - 5 * 60_000, 'op=ids list=2 ids=r:r:6,6,6=footing'), r('B', NOW - 4 * 60_000, 'op=visit list=2 n=1 done=0')]
  const a = M.readRows(rows, { now: NOW })
  assert.deepStrictEqual(a.reports.map(x => x.bot), ['A', 'A', 'B'])
  assert.strictEqual(a.stats.A.rate, 1.5); assert.strictEqual(a.stats.A.lastProgressAt, NOW - 10 * 60_000)
  assert.strictEqual(a.stats.B.lastProgressAt, null); assert.strictEqual(a.stats.B.rate, 0)
  const b = M.readRows(rows, { seen: a.seen, now: NOW })
  assert.strictEqual(b.reports.length, 0, 'a row is taken once')
  // r6: a LATE row (written after the last read, stamped earlier than rows already taken) and a row in the SAME millisecond as one
  // already taken are each taken exactly once
  const late = [...rows, r('C', NOW - 60 * 60_000, 'op=ids list=2 ids=d:r:9,9,9'), r('A', NOW - 10 * 60_000, 'op=ids list=2 ids=d:r:7,7,7')]
  const c2 = M.readRows(late, { seen: b.seen, now: NOW })
  assert.deepStrictEqual(c2.reports.map(x => [x.bot, x.rep.ids.done[0]]), [['C', 'r:9,9,9'], ['A', 'r:7,7,7']])
  assert.strictEqual(M.readRows(late, { seen: c2.seen, now: NOW }).reports.length, 0)
  // through the cycle: a refusal's reason reaches the set-aside list
  let book = [job(M, 5, 5, 5)]
  const rep = why => ({ ids: { done: [], gone: [], refused: ['r:5,5,5'], unreachable: [] }, why: { 'r:5,5,5': why } })
  for (const [who, why] of [['A', 'water'], ['B', 'water'], ['A', 'footing']]) book = M.overseerCycle({ book, reports: [{ bot: who, rep: rep(why) }], bots: [], now: NOW }).book
  const c = M.overseerCycle({ book, bots: [], now: NOW })
  assert.deepStrictEqual(c.setAside.map(j => [j.id, j.why]), [['r:5,5,5', 'water x3 by 2 bots']])
}
await t('rows: ingested once, rate per hour over 2 h, last progress; a refusal\'s reason reaches the set-aside list', () => rowsScenario(O))
await mutant('rows ingested again', "    if (!had.has(k)) { had.set(k, r.t); reports.push", "    if (true) { had.set(k, r.t); reports.push", rowsScenario)
await mutant('a time cursor drops late rows', "    if (!had.has(k)) { had.set(k, r.t); reports.push", "    if (!had.has(k) && r.t > Math.max(0, ...[...had.values()])) { had.set(k, r.t); reports.push", rowsScenario)
await mutant('the report\'s reason is dropped', "say.set(id, whyOf(id) ?? rep?.why?.[id] ?? 'refused')", "say.set(id, whyOf(id) ?? 'refused')", rowsScenario)

// ---------------------------------------------------------------- review r1
// B1: done at 10:00, stalled at 10:30 (unstick), work again at 10:45, and at 11:00 the 10:00 row is still in the window
const b1Scenario = async M => {
  const T0 = NOW, m = 60_000, held = [job(M, 0, 65, 0, { owner: 'S' })]
  const at = (now, o) => M.stalls(held, [bot('S', 0, 0, { lastProgressAt: T0, ...o })], { now }).orders.length
  assert.strictEqual(at(T0 + 30 * m, { givenAt: T0 }), 1, '10:30: 30 min with nothing done -> unstick')
  assert.strictEqual(at(T0 + 60 * m, { givenAt: T0 + 45 * m }), 0, '11:00: given work at 10:45 -- not stalled again by the 10:00 row')
  assert.strictEqual(at(T0 + 75 * m, { givenAt: T0 + 45 * m }), 1, '11:15: 30 min since it was given work -> stalled')
}
await t('B1 stall clock: the later of last progress and the time work was given', () => b1Scenario(O))
await mutant('B1 stall clock reads the old done row first', 'const since = Math.max(Number(b.lastProgressAt ?? 0), Number(b.givenAt ?? now))', 'const since = Number(b.lastProgressAt ?? b.givenAt ?? now)', b1Scenario)

// B2: a column is never handed out bottom-only
const b2Scenario = async M => {
  // a column of 3 owned by A, the top set aside: the two below it are held
  const q = [job(M, 4, 67, 4, { state: 'quarantined' }), job(M, 4, 66, 4, { owner: 'A' }), job(M, 4, 65, 4, { owner: 'A' })]
  assert.deepStrictEqual(M.listDoc(q, 'A', { home: { x: 0, y: 64, z: 0 }, now: NOW }).jobs, [])
  // the top block is another bot's (an avoid split the column): the lower one is held
  const o = [job(M, 5, 66, 5, { owner: 'B' }), job(M, 5, 65, 5, { owner: 'A' })]
  assert.deepStrictEqual(M.listDoc(o, 'A', { home: { x: 0, y: 64, z: 0 }, now: NOW }).jobs, [])
  // the cap cuts a column: its UPPER cells are the ones kept
  const col = [65, 66, 67, 68].map(y => job(M, 7, y, 7, { owner: 'A' }))
  const d = M.listDoc(col, 'A', { home: { x: 0, y: 64, z: 0 }, now: NOW, T: { ...M.OVERSEER, maxList: 2 } })
  assert.deepStrictEqual(d.jobs.map(j => j.at[1]), [68, 67])
}
await t('B2 a lower cell is never listed without the open cells above it (set aside, another\'s, or past the cap)', () => b2Scenario(O))
await mutant('B2 nothing held below', '  const ok = new Set(mine.filter(j => !heldBelow(book, j, mine)).map(j => j.id))', '  const ok = new Set(mine.map(j => j.id))', b2Scenario)
await mutant('B2 cap before the sort', "    .sort((a, b) => a.at[0] - b.at[0] || a.at[2] - b.at[2] || b.at[1] - a.at[1])     // a column top first\n    .slice(0, T.maxList)", "    .slice(0, T.maxList)", b2Scenario)

// C2: the second own failure unowns the job AND makes it wait out the lease
const c2Scenario = async M => {
  let j = job(M, 3, 65, 3, { owner: 'A' })
  j = M.recordAttempt(j, { bot: 'A', why: 'water', now: NOW })
  j = M.recordAttempt(j, { bot: 'A', why: 'water', now: NOW + 1000 })
  assert.strictEqual(j.owner, null); assert.ok(j.notBefore >= NOW + 1000 + M.OVERSEER.leaseMs)
  const out = M.splitOpen([j], [bot('B', 3, 3)], { now: NOW + 2000 })
  assert.strictEqual(out[0].owner, null, 'not given out inside the old lease')
}
await t('C2 a job moved off a bot after its second failure waits out that bot\'s lease', () => c2Scenario(O))
await mutant('C2 no lease wait on the avoid move', '{ j.owner = null; j.notBefore = Math.max(Number(j.notBefore) || 0, now + T.leaseMs) }', '{ j.owner = null }', c2Scenario)

// C5: a zone or a building that appears after intake takes the job off every list
const c5Scenario = async M => {
  const book = [job(M, 60, 65, 0, { owner: 'A' }), job(M, 10, 65, 10, { owner: 'A' }), job(M, 2, 65, 2, { owner: 'A' })]
  const c = M.overseerCycle({ book, bots: [bot('A', 0, 0)], now: NOW, home: { x: 0, y: 64, z: 0 }, zones: [{ id: 'v', box: [50, -64, -10, 70, 90, 10] }], guard: k => k === '10,65,10' })
  const st = Object.fromEntries(c.book.map(j => [j.id, [j.state, j.why]]))
  assert.deepStrictEqual(st['r:60,65,0'], ['dropped', 'zone']); assert.deepStrictEqual(st['r:10,65,10'], ['dropped', 'record']); assert.deepStrictEqual(st['r:2,65,2'], ['open', null])
  assert.deepStrictEqual(c.lists.A.jobs.map(j => j.id), ['r:2,65,2']); assert.match(c.row, / dropped=2 /)
}
await t('C5 every open job is checked again against the current zones and guard each cycle', () => c5Scenario(O))
await mutant('C5 no recheck', '  const rc = recheck(b, { zones, guard, home: h3, radius, now }); b = rc.book', '  const rc = { book: b, dropped: 0 }', c5Scenario)

// r2 (C3 retire): a retired bot (its log directory gone past the grace: no rows, so no roster entry) loses its jobs, which wait out its lease
const retireScenario = async M => {
  const book = [job(M, 0, 65, 0, { owner: 'Gone' }), job(M, 9, 65, 0, { owner: 'K' })]
  const { book: out, orders } = M.stalls(book, [bot('K', 9, 0)], { now: NOW })
  assert.strictEqual(orders.length, 0, 'no order to a bot that is gone')
  assert.strictEqual(out[0].owner, null); assert.ok(out[0].notBefore >= NOW + M.OVERSEER.leaseMs); assert.strictEqual(out[1].owner, 'K')
}
await t('retired bot: its jobs are released with notBefore, no order', () => retireScenario(O))
await mutant('a bot gone from the roster keeps its jobs', "  for (const [owner] of holds) if (!bots.some(b => b.name === owner)) drop.set(owner, 'gone')", '', retireScenario)

const pubScenario = async M => {
  const book = [job(M, 3, 65, 3, { owner: 'B' }), job(M, 4, 65, 4, { owner: 'B' })]
  const onDisk = M.publishedIds([{ kind: 'worklist', bot: 'A', expires: NOW + 1, jobs: [{ id: 'r:3,65,3' }] }, { kind: 'worklist', bot: 'C', expires: NOW - 1, jobs: [{ id: 'r:4,65,4' }] }], NOW)
  assert.deepStrictEqual(onDisk, { 'r:3,65,3': 'A' }, 'an expired list holds nothing')
  assert.deepStrictEqual(M.listDoc(book, 'B', { home: { x: 0, y: 64, z: 0 }, now: NOW, onDisk }).jobs.map(j => j.id), ['r:4,65,4'])
  assert.deepStrictEqual(M.listDoc(book, 'B', { home: { x: 0, y: 64, z: 0 }, now: NOW, onDisk: { 'r:3,65,3': 'B' } }).jobs.length, 2, 'its own published job stays')
}
await t('r6: a job on another bot\'s live published list is not listed', () => pubScenario(O))
await mutant('r6: listed on two lists', ' && !(onDisk[j.id] && onDisk[j.id] !== bot))', ')', pubScenario)
await mutant('r6: an expired list still holds', ' && now <= d.expires && Array.isArray(d.jobs))', ' && Array.isArray(d.jobs))', pubScenario)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
