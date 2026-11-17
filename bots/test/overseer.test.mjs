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
mutant('split ignores the column rule', 'const k = colKey(j.at); if (!cols.has(k)) cols.set(k, []); cols.get(k).push(j) }\n  const todo',
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
mutant('split without the share cap', 'load.get(b.name) < cap.get(b.name))', 'true)', capScenario)

const avoidScenario = async M => {
  const book = [job(M, 0, 65, 0, { avoid: ['A'] })]
  assert.strictEqual(M.splitOpen(book, [bot('A', 0, 0), bot('B', 50, 0)], { now: NOW })[0].owner, 'B')
  const later = [job(M, 0, 65, 0, { notBefore: NOW + 1 })]
  assert.strictEqual(M.splitOpen(later, [bot('A', 0, 0)], { now: NOW })[0].owner, null, 'notBefore waits')
}
await t('split: an avoided bot is passed over; notBefore waits', () => avoidScenario(O))
mutant('split ignores avoid', '!avoid.has(b.name) && ', '', avoidScenario)
mutant('split ignores notBefore', "if (js.some(j => j.notBefore > now)) continue", '', avoidScenario)

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
mutant('rebalance by count not rate', 'const ws = weight(slow, T), wf = weight(fast, T)', 'const ws = 1, wf = 1', rateScenario)
mutant('rebalance without the lease wait', 'j.owner = fast.name; j.notBefore = until', 'j.owner = fast.name', rateScenario)

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
mutant('quarantine without the bots rule', '&& bots.size >= T.quarantineBots', '', quarScenario)
mutant('no avoid after repeated own failure', 'if (byBot >= T.avoidAfter && !j.avoid.includes(bot))', 'if (false)', quarScenario)

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
  const bots = [bot('S', 0, 0, { lastProgressAt: NOW - O.OVERSEER.stallMs }), bot('K', 9, 0)]
  const { book: out, orders } = M.stalls(book, bots, { now: NOW })
  assert.deepStrictEqual(orders.map(o => [o.bot, o.order]), [['S', 'unstick']])
  assert.deepStrictEqual(out.map(j => j.owner), [null, null, 'K'])
  assert.ok(out[0].notBefore >= NOW + O.OVERSEER.leaseMs)
  // a bot with nothing held is never stalled; a fresh bot is not
  assert.strictEqual(M.stalls(book, [bot('S', 0, 0, { lastProgressAt: NOW - 1000 }), bot('K', 9, 0, { lastProgressAt: 0 })], { now: NOW }).orders.length, 1)
  // the whole cycle: the stalled bot's work goes to the other
  const c1 = M.overseerCycle({ book, bots, now: NOW, home: { x: 0, y: 64, z: 0 } })
  assert.ok(c1.book.filter(j => j.at[0] < 5).every(j => j.owner === null), 'released, not handed on inside the old lease')
  bots[0].unstuckAt = NOW   // the host records the order
  const c = M.overseerCycle({ book: c1.book, bots, now: NOW + O.OVERSEER.leaseMs + 1, home: { x: 0, y: 64, z: 0 } })
  assert.ok(c.book.filter(j => j.state === 'open').every(j => j.owner === 'K')); assert.ok(!('S' in c.lists))
}
await t('stall: no progress for T -> list reassigned + unstick order', () => stallScenario(O))
mutant('no grace after unstick', '&& !(now - Number(x.unstuckAt ?? -Infinity) < T.unstickMs)', '', stallScenario)
mutant('stall clock off', 'if (now - since >= T.stallMs)', 'if (false)', stallScenario)

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
  assert.deepStrictEqual(skipped, { dup: 2, zone: 1, record: 1, malformed: 1, cap: 0 })
}
await t('scar intake: dedupe (any state), zone skip, record skip', () => intakeScenario(O))
mutant('intake without the zone skip', 'if (inZone(at, zones)) { skipped.zone++; continue }', '', intakeScenario)
mutant('intake without dedupe', 'if (have.has(id)) { skipped.dup++; continue }', '', intakeScenario)

// ---------------------------------------------------------------- the list file
await t('listDoc: worklist-01show v1 shape, top-first pillar with after', async () => {
  const book = O.splitOpen([job(O, 2, 65, 2), job(O, 2, 66, 2)], [bot('A', 0, 0)], { now: NOW })
  const d = O.listDoc(book, 'A', { home: { x: 0.5, y: 64, z: 0.5 }, now: NOW })
  assert.deepStrictEqual([d.v, d.kind, d.project, d.bot, d.home], [1, 'worklist', 'tidy', 'A', [0, 64, 0]])
  assert.deepStrictEqual(d.jobs.map(j => j.id), ['r:2,66,2', 'r:2,65,2']); assert.deepStrictEqual(d.jobs[1].after, ['r:2,66,2'])
  assert.ok(d.expires > NOW); assert.strictEqual(O.listLease('Comet'), 'seg-clear-wlComet')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
