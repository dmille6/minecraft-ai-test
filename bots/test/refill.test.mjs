// REFILL-01 (src/refill.mjs has the owner's words and the rule): no gathering for stock -- a refill is a job raised on evidence of use,
// sized, ended, carried by a few bots; a refused consumer raises it at once; the old unconditional stock paths stop. Behaviour (the
// rule over a real week's ledger, the composed chain raise -> take -> credit -> done), mutants, then the wiring.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-refill-${process.pid}`
process.env.BOT_NAME = 'TestBot'
const R = await import('../src/refill.mjs')
const U = await import('../src/useledger.mjs')
const Y = await import('../src/yard.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }
const P = n => new URL(`../src/${n}.mjs`, import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))} in ${path.pathname} (a mutant that was never written reads as killed)`)
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (path, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(path, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const one = (src, re, what) => assert.equal((src.match(new RegExp(re, 'g')) ?? []).length, 1, `${what}: expected exactly one executable line matching ${re}`)

const S = R.refillSettings({}), NOW = 1.8e12, D = 86_400_000
await t('SETTINGS: on by default, REFILL=off the rollback; every number a setting', () => {
  assert.deepEqual({ ...S }, { on: true, days: 2, minDraws: 3, minItems: 64, lowMin: 16, maxJob: 256, takers: 2, ttlMs: 120 * 60_000 })
  assert.equal(R.refillSettings({ REFILL: 'off' }).on, false)
  const s = R.refillSettings({ REFILL_DAYS: '3', REFILL_MIN_DRAWS: '5', REFILL_MIN_ITEMS: '100', REFILL_LOW_MIN: '32', REFILL_MAX_JOB: '512', REFILL_TAKERS: '3', REFILL_TTL_MIN: '60' })
  assert.deepEqual({ ...s }, { on: true, days: 3, minDraws: 5, minItems: 100, lowMin: 32, maxJob: 512, takers: 3, ttlMs: 60 * 60_000 })
  assert.equal(R.refillBlockOf('cobblestone'), 'stone'); assert.equal(R.refillBlockOf('spruce_log'), 'spruce_log')
  assert.match(R.refillModeDetail(true, S), /^on=1 days=2 min_draws=3 min_items=64 low_min=16 max_job=256 takers=2 ttl_min=120 bootstrap=none$/)
})
await t('THE RULE: only a kind the ledger shows USED and whose stock is under a day of that use; a kind nobody draws is NEVER refilled; an unknown stock is no job', () => {
  const used = { used: true, draws: 6, items: 200, perDay: 100 }
  assert.deepEqual(R.refillNeed('cobblestone', { use: used, stock: 40 }), { need: true, n: 160, why: 'used', perDay: 100, low: 100 }, 'two days of use less the stock')
  assert.equal(R.refillNeed('cobblestone', { use: used, stock: 100 }).why, 'stocked', 'a day of use in stock: no job')
  assert.equal(R.refillNeed('gravel', { use: { used: false, draws: 0, items: 0, perDay: 0 }, stock: 0 }).why, 'not_used', 'EMPTY and unused: still no job (positive control above: the same call with use is a job)')
  assert.equal(R.refillNeed('cobblestone', { use: used, stock: null }).why, 'stock_unknown')
  assert.equal(R.refillNeed('cobblestone', { use: { used: true, draws: 3, items: 9, perDay: 4.5 }, stock: 10 }).n, 16, 'a small use still refills to the low minimum')
  assert.equal(R.refillNeed('cobblestone', { use: { used: true, draws: 9, items: 4000, perDay: 2000 }, stock: 0 }).n, 256, 'a job is at most 256')
  assert.equal(R.refillNeed('cobblestone', { use: used, stock: 0, settings: R.refillSettings({ REFILL: 'off' }) }).why, 'off')
})
await t('NO BOOTSTRAP (Codex r1 BLOCKER 5): a new ledger with NO dirt in stock raises NOTHING -- only a consumer actually refused does, sized by its shortfall', () => {
  const none = { used: false, draws: 0, items: 0, perDay: 0 }
  assert.equal(R.refillNeed('dirt', { use: none, stock: 0 }).why, 'not_used', 'the exact case: zero dirt, no history, no job')
  assert.equal(R.refillNeed('cobblestone', { use: none, stock: 0 }).need, false)
  assert.equal(R.refillNeed('dirt', { use: null, stock: 0 }).need, false, 'no ledger at all: no job')
  assert.equal('BOOTSTRAP' in R, false, 'there is no list of kinds assumed to be used')
  // THE CONSUMER'S REFUSAL: a bill still short after an exhausted search of the chests -> the lane kinds it was short of, by that much
  assert.deepEqual(R.billShortfall({ dirt: 25, cobblestone: 0, spruce_planks: 12, glass: 4 }, { kinds: [...Y.LANE_KINDS], exhausted: true }), { dirt: 25 }, 'dirt is a lane kind; planks and glass are crafted, not brought')
  assert.deepEqual(R.billShortfall({ dirt: 25 }, { kinds: [...Y.LANE_KINDS], exhausted: false }), {}, 'a search cut short proves no shortage')
  assert.deepEqual(R.billShortfall({ dirt: 25 }, { kinds: [...Y.LANE_KINDS], exhausted: true, unsettled: true }), {}, 'an unsettled transfer proves none either')
  assert.deepEqual(R.billShortfall({ dirt: 25 }, { kinds: [...Y.LANE_KINDS], exhausted: true, settings: R.refillSettings({ REFILL: 'off' }) }), {})
  // THE CHAIN: the refusal raises a job of exactly the shortfall, though the ledger has no history
  const jobs = R.refillRaise([], { kind: 'dirt', n: R.billShortfall({ dirt: 25 }, { kinds: [...Y.LANE_KINDS], exhausted: true }).dirt, by: 'bill', now: NOW })
  assert.deepEqual([jobs[0].kind, jobs[0].n, jobs[0].by], ['dirt', 25, 'bill'])
})
await t('ONE POOL-WIDE READ-MODIFY-WRITE (Codex r1 BLOCKERS 3, 4): three bots after one untaken job -> exactly TWO takers, the third acknowledged nothing; no lock or a failed write acknowledges nothing', () => {
  // one shared record, one lock; each "process" decided on its own STALE copy (all three read the job untaken) -- the update rereads inside the lock
  let file = R.refillRaise([], { kind: 'cobblestone', n: 64, now: NOW }), locked = false, writes = 0
  const io = { lock: () => (locked ? null : (locked = true, { t: 1 })), unlock: () => { locked = false }, read: () => file, write: next => { file = next; writes++; return true } }
  const take = bot => R.lockedUpdate(io, jobs => { const t = R.refillTake(jobs, bot, { now: NOW + 1 }); return { next: t.jobs, value: t.job } })
  const got = ['Alpha', 'Bravo', 'Comet'].map(take)
  assert.deepEqual(got.map(r => r.value?.takers ?? null), [['Alpha'], ['Alpha', 'Bravo'], null], 'the third bot keeps its own work')
  assert.deepEqual(file[0].takers, ['Alpha', 'Bravo']); assert.equal(writes, 2, 'nothing was written for the third')
  assert.equal(locked, false, 'the lock is given back every time')
  // the lock held by another process: nothing read, nothing written, nothing acknowledged
  locked = true
  const before = file
  assert.deepEqual(R.lockedUpdate(io, () => { throw new Error('never called') }), { ok: false, value: null, why: 'locked' })
  assert.equal(file, before); locked = false
  // a write that fails acknowledges nothing (a take is the bot's only once it is on disk)
  file = R.refillRaise([], { kind: 'dirt', n: 25, now: NOW })
  const failing = { ...io, write: () => false }
  assert.deepEqual(R.lockedUpdate(failing, jobs => { const t = R.refillTake(jobs, 'Alpha', { now: NOW + 1 }); return { next: t.jobs, value: t.job } }), { ok: false, value: null, why: 'write_failed' })
  assert.equal(locked, false, 'and the lock is still given back')
  // an apply that throws: no write, the lock given back
  assert.equal(R.lockedUpdate(io, () => { throw new Error('boom') }).ok, false); assert.equal(locked, false)
})
await t('THE CHAIN, on the LEDGER itself: three builds draw cobblestone -> used -> low -> a job -> two takers -> banked in two visits -> done; a third bot gets no job', () => {
  const L = (d, names, why, ago) => U.ledgerLine({ d, names, why, bot: 'A', now: NOW - ago })
  const lines = [L('out', { cobblestone: 64 }, 'build', 30 * 3_600_000), L('out', { cobblestone: 40 }, 'build', 20 * 3_600_000), L('out', { cobblestone: 20 }, 'yard_draw', 2 * 3_600_000), L('move', { gravel: 900 }, 'move', 3_600_000)]
  const fold = U.foldLedger(lines, { since: NOW - 2 * D, until: NOW + 1 })
  const need = R.refillNeed('cobblestone', { use: U.usedRegularly(fold, 'cobblestone', { days: 2 }), stock: 12 })
  assert.deepEqual([need.need, need.n, need.why], [true, 112, 'used'], '124 in two days: 62 a day; 2 x 62 - 12')
  assert.equal(R.refillNeed('gravel', { use: U.usedRegularly(fold, 'gravel', { days: 2 }), stock: 0 }).need, false, 'a clerk\'s move of 900 gravel is not a use')
  let jobs = R.refillRaise([], { kind: 'cobblestone', n: need.n, by: 'low', now: NOW })
  assert.equal(jobs.length, 1); assert.equal(jobs[0].n, 112); assert.equal(jobs[0].until, NOW + S.ttlMs)
  assert.equal(R.refillRaise(jobs, { kind: 'cobblestone', n: 500, by: 'yard_draw', now: NOW + 5 }), jobs, 'one job a kind: a second raise changes nothing')
  let a = R.refillTake(jobs, 'Alpha', { now: NOW + 10 }); jobs = a.jobs
  let b = R.refillTake(jobs, 'Bravo', { now: NOW + 20 }); jobs = b.jobs
  const c = R.refillTake(jobs, 'Comet', { now: NOW + 30 })
  assert.deepEqual([a.job.kind, b.job.takers, c.job], ['cobblestone', ['Alpha', 'Bravo'], null], 'two takers; the third bot keeps its own work')
  assert.equal(R.refillTake(jobs, 'Alpha', { now: NOW + 40 }).job.id, a.job.id, 'a taker keeps its job')
  jobs = R.refillCredit(jobs, 'cobblestone', 64, NOW + 600_000)
  assert.equal(R.openJobs(jobs, NOW + 600_001).length, 1)
  assert.match(R.refillWords(R.openJobs(jobs, NOW + 600_001)[0]).describe, /^Refill job: bring 112 cobblestone to the storage yard \(raised by low; 64 banked so far\), then stop\.$/)
  jobs = R.refillCredit(jobs, 'cobblestone', 64, NOW + 900_000)
  assert.equal(R.openJobs(jobs, NOW + 900_001).length, 0, 'its size banked: the job is over')
  assert.equal(R.refillTake(jobs, 'Alpha', { now: NOW + 900_002 }).job, null, 'and its takers are free')
  // a job nobody finishes ends by its time; then the kind may be raised again
  const stale = R.refillRaise([], { kind: 'dirt', n: 64, by: 'low', now: NOW })
  assert.equal(R.openJobs(stale, NOW + S.ttlMs).length, 0)
  assert.equal(R.refillRaise(stale, { kind: 'dirt', n: 64, by: 'low', now: NOW + S.ttlMs }).length, 1)
  assert.equal(R.refillRaise([], { kind: 'dirt', n: 64, settings: R.refillSettings({ REFILL: 'off' }) }).length, 0)
})
await t('WHAT STOPS: the stock rungs do not grow with the laps where the lanes are (the kit\'s base stays); the first yard\'s chests_short refill is off', async () => {
  const M = await import('../src/milestones.mjs')
  assert.equal(M.NOSTOCK.on, false, 'the suite\'s pool has no yard: the fleet\'s rungs are untouched')
  assert.equal(M.stockpileTarget(16, 8, 5), 56, 'positive control: the growth, where it is on')
  assert.equal(M.stockpileTarget(16, 8, 5, 64, false), 16, 'no growth: the base')
  assert.equal(M.stockpileTarget(8, 4, 9, 16, false), 8)
  assert.equal(M.SUSTAINING.some(m => m.id === 'refill_job'), false, 'no job rung without the lanes')
  // the rung itself: done with no job; with one it carries the job's words and wants its kind
  try {
    M.setRefillJob(() => null)
    assert.equal(M.REFILL_RUNG.done({}), true); assert.equal(M.REFILL_RUNG.wants, null)
    const job = { id: 'j', kind: 'cobblestone', n: 112, got: 64, by: 'yard_draw', takers: ['A'] }
    M.setRefillJob(() => job)
    assert.equal(M.REFILL_RUNG.done({}), false)
    assert.equal(M.REFILL_RUNG.wants, 'cobblestone'); assert.match(M.REFILL_RUNG.hint, /^gather with block=stone,/)
    assert.equal(M.REFILL_RUNG.progress({}), '64/112 cobblestone banked at the yard')
    assert.equal(M.servesRung('gather', { block: 'stone' }, { id: 'refill_job' }, new Set()), true)
    assert.equal(M.servesRung('gather', { block: 'oak_log' }, { id: 'refill_job' }, new Set()), false, 'gathering anything else does not serve the job')
    M.setRefillJob(() => { throw new Error('boom') })
    assert.equal(M.REFILL_RUNG.done({}), true, 'an unreadable record is no job')
  } finally { M.setRefillJob(null) }
  // the yard: with the piles holding cobblestone and the chests short, the old yard dug it back; with noRefill it does not
  const st = [{ id: 0, name: 'cobblestone', filled: 205, free: 0, next: [], top: [[0, 71, 0]], foreign: 0 }]
  const base = { held: {}, slots: 5, freeSlots: 31, town: { cobblestone: 52 }, states: st, lanes: Y.laneSettings({ YARD: 'on' }), keeps: {} }
  assert.equal(Y.yardWork(base).kind, 'refill', 'positive control (LIVE 11-16: `_yard kind=refill why=chests_short:204`)')
  assert.equal(Y.yardWork({ ...base, noRefill: true }).kind, null)
})
await t('MUTANTS KILLED: an unused kind refilled; a stocked kind refilled; a second job for a kind; a third taker; a job that never ends; a shortfall from a cut search; an unwritten take acknowledged; a write with no lock; the refill still dug', async () => {
  const RP = P('refill')
  const none = { used: false, draws: 0, items: 0, perDay: 0 }
  await killedBy(RP, R, "  if (!use?.used) return no('not_used')\n", '', M => assert.equal(M.refillNeed('gravel', { use: none, stock: 0 }).need, false))
  await killedBy(RP, R, "  if (!(stock < low)) return { need: false, n: 0, why: 'stocked', perDay, low }\n", '', M => assert.equal(M.refillNeed('cobblestone', { use: { used: true, draws: 6, items: 200, perDay: 100 }, stock: 500 }).need, false))
  await killedBy(RP, R, " || open.some(j => j.kind === kind)) return jobs", ') return jobs', M => { const j = M.refillRaise([], { kind: 'dirt', n: 64, now: NOW }); assert.equal(M.refillRaise(j, { kind: 'dirt', n: 64, now: NOW + 1 }).length, 1) })
  await killedBy(RP, R, ".find(j => (j.takers ?? []).length < settings.takers)", '[0]', M => { let j = M.refillRaise([], { kind: 'dirt', n: 64, now: NOW }); j = M.refillTake(j, 'A', { now: NOW }).jobs; j = M.refillTake(j, 'B', { now: NOW }).jobs; assert.equal(M.refillTake(j, 'C', { now: NOW }).job, null) })
  await killedBy(RP, R, "(Number(j.got) || 0) < (Number(j.n) || 0) && now < (Number(j.until) || 0))", "now < (Number(j.until) || 0))", M => { const j = M.refillCredit(M.refillRaise([], { kind: 'dirt', n: 64, now: NOW }), 'dirt', 64, NOW + 1); assert.equal(M.openJobs(j, NOW + 2).length, 0) })
  await killedBy(RP, R, "  if (!settings?.on || !exhausted || unsettled) return out\n", "  if (!settings?.on || unsettled) return out\n", M => assert.deepEqual(M.billShortfall({ dirt: 25 }, { kinds: ['dirt'], exhausted: false }), {}))
  await killedBy(RP, R, "    if (!io.write(r.next)) return { ok: false, value: null, why: 'write_failed' }\n", '    io.write(r.next)\n', M => assert.equal(M.lockedUpdate({ lock: () => 1, unlock: () => {}, read: () => [], write: () => false }, () => ({ next: [1], value: 'taken' })).value, null))
  await killedBy(RP, R, "  if (!token) return { ok: false, value: null, why: 'locked' }\n", '', M => { let wrote = 0; M.lockedUpdate({ lock: () => null, unlock: () => {}, read: () => [], write: () => { wrote++; return true } }, () => ({ next: [1], value: 1 })); assert.equal(wrote, 0) })
  const st = [{ id: 0, name: 'cobblestone', filled: 205, free: 0, next: [], top: [[0, 71, 0]], foreign: 0 }]
  await killedBy(P('yard'), Y, "    if (!noRefill && short > 0 && inYard > 0 && freeSlots >= 1 && pick) {", "    if (short > 0 && inYard > 0 && freeSlots >= 1 && pick) {",
    M => assert.equal(M.yardWork({ held: {}, slots: 5, freeSlots: 31, town: { cobblestone: 52 }, states: st, lanes: M.laneSettings({ YARD: 'on' }), keeps: {}, noRefill: true }).kind, null))
})
await t('WIRED: the low mark is judged with the stock line; a refused draw raises its job and names it; a stock visit credits; the rung reads the pool\'s record; the yard\'s refill is off', () => {
  const sk = strip(readFileSync(P('skills'), 'utf8')), ms = strip(readFileSync(P('milestones'), 'utf8'))
  one(sk, "useNote\\(bot, 'stock', n, 'index\\+yard'\\)\\n\\s*refillCheck\\(bot, n, now\\)", 'the check rides the stock line')
  one(sk, "const job = refillRaiseNow\\(bot, 'cobblestone', Number\\(draw\\) \\|\\| 64, 'yard_draw'\\)", 'an empty yard raises the job for the bill')
  one(sk, "refill job \\$\\{job\\.id\\}: \\$\\{job\\.n\\} cobblestone, raised for this bill", 'and the consumer\'s answer names it')
  one(sk, 'if \\(nPlaced > 0\\) refillCreditNow\\(bot, f\\.placed\\)', 'the credit')
  one(sk, 'first: plot === YARD_PLOT, noRefill: REFILL\\.on, clear:', 'the chests_short refill is off with the rule')
  one(sk, 'const REFILL_ON = LANES\\.on && REFILL\\.on', 'only where the lanes are')
  // Codex r1 BLOCKER 3: every read-modify-write of the jobs is one locked update that rereads inside the lock
  one(sk, "const refillUpdate = apply => lockedUpdate\\(\\{ \\.\\.\\.poolLock\\('refill'\\), read: \\(\\) => refillJobsNow\\(Date\\.now\\(\\), \\{ fresh: true \\}\\), write: refillJobsWrite \\}, apply\\)", 'the one locked update')
  assert.equal((sk.match(/refillUpdate\(/g) ?? []).length, 3, 'raise, take and credit')
  assert.equal((sk.match(/refillJobsWrite\(/g) ?? []).length, 0, 'no write of the jobs outside the locked update (its one use is passed as io.write)')
  assert.equal((sk.match(/return r\.ok \? r\.value : null/g) ?? []).length, 2, 'a raise and a take are acknowledged only when written')
  // Codex r1 BLOCKER 5: a build's bill (and the clean-up's fill: both draw through matsWithdraw) short after an exhausted search raises its job
  one(sk, "if \\(why === 'build' && out\\.short\\) out\\.refill = refillOnShortfall\\(bot, left, \\{ exhausted: !next\\.block, unsettled: out\\.unsettled, by: 'bill' \\}\\)", 'the bill\'s shortfall')
  one(sk, 'for \\(const kind of LANE_KINDS\\) \\{\\n\\s*const r = refillNeed\\(kind, \\{ use: usedRegularly\\(', 'the low mark asks the ledger alone')
  one(ms, "let refillJobOf = b => refillJobFor\\(b\\)", 'the rung reads skills.mjs\'s record')
  one(ms, '\\.\\.\\.\\(NOSTOCK\\.on \\? \\[REFILL_RUNG\\] : \\[\\]\\),', 'the rung is on the ladder only where the lanes are')
  one(ms, 'Math\\.min\\(base \\+ \\(grow && Number\\.isFinite\\(n\\) \\? n : 0\\) \\* step, max\\)', 'the stock rungs\' growth is the switch\'s')
})

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1) }
console.log('\nall refill tests passed')
