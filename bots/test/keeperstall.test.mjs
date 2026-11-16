// KEEPERSTALL-01 (docs/reports/keeperstall-2026-11-10.md, piece 1). LIVE showcase 11-10: the keeper's water visit ran 62 standing cuts
// x one full record pass as ONE macrotask (about 41 s); Paper dropped the bot; the reconnect made a new `bot`, so the 15-minute clock
// and every give-up count were gone, and the same visit was the first thing the bot did when it was back.
//
//   1. THE VISIT BREATHES (buildrun.mjs): the REAL runVisit on the fake server (helpers/buildfake.mjs), with checks that burn real
//      wall time and never await -- a setImmediate probe (the socket's turn) must fire BEFORE the visit resolves; a deadline and an
//      abort that happen during the skips end the visit; a cut that IS dug has its guard check as the last thing before the dig.
//      The same visits with `breathe: false` (what BREATHE=off feeds) are the POSITIVE CONTROL: the probe does not fire, so the
//      instrument can see the starvation it says is gone.
//   2. AN ENDED CONNECTION ABORTS (buildbot.mjs): the effects' aborted() is true once the bot's client has ended.
//   3. THE KEEPER'S MEMORY IS THE PROCESS'S (procmem.mjs + skills.mjs): two bot objects of one name share it.
//   r1 (review BLOCKER). A memory that outlives the connection must not learn from a DEAD one: after `end` the running skill goes on
//      on the old bot, every walk returns at once, every tree reads off_stand -- three disconnects would have waived every listed
//      tree on the record, for every bot. Nothing is booked for a result on an aborted or ended connection: no forest skip, no
//      failure count, no keep, no rest, no water-cut strike (forest.mjs fellFailNote / forestRestDue, boardwalk.mjs bw3Strikes);
//      ONE notion of "ended" (buildbot.mjs connEnded = skills.mjs clientEnded: `ended`, or a destroyed socket).
//   r2 (review BLOCKERS). A: an ABORTED water visit on a healthy connection books no strike either (buildbot.mjs visitGone: the
//      skill's signal, or the connection ended). B: the interval after client.end() -- `ended` false, socket not destroyed, every
//      write a no-op for up to 30 s -- reads ENDED (the serializer's writableEnded, set synchronously by end(); proved here on the
//      REAL minecraft-protocol client, which also reads NOT ended through every state change, compression and encryption).
//
// Anchored mutants (each anchor asserted present and unique, CLAUDE.md), each named after the test it must fail.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
const { R, PJ, G, HOME, k3, server, bot } = await import('./helpers/buildfake.mjs')
const BB = await import('../src/buildbot.mjs')
const PM = await import('../src/procmem.mjs')
const T = await import('../src/tidy.mjs')
const F = await import('../src/forest.mjs')
const W = await import('../src/boardwalk.mjs')
const FOREST_URL = new URL('../src/forest.mjs', import.meta.url)
const BW_URL = new URL('../src/boardwalk.mjs', import.meta.url)
const RUN_URL = new URL('../src/buildrun.mjs', import.meta.url)
const BOT_URL = new URL('../src/buildbot.mjs', import.meta.url)
const PM_URL = new URL('../src/procmem.mjs', import.meta.url)
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
/** The source with every anchored replacement applied (each anchor PRESENT and UNIQUE: a mutant that did not apply reads as killed). */
function mutantText (url, pairs) {
  let src = readFileSync(url, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
    assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
    src = src.replace(old, () => neu)
  }
  return src
}
/** A mutant of a src module (climb-escape.test.mjs withMutant's shape, several anchors), imported from the test directory. No pairs:
 *  a FRESH copy of the module (its load-time switches read again). */
async function withMutants (url, pairs, fn) {
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, mutantText(url, pairs).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** A fresh copy of a module loaded while `env` is set (a switch read once at load). */
async function loadedUnder (url, env, fn) {
  const old = {}
  for (const [k, v] of Object.entries(env)) { old[k] = process.env[k]; process.env[k] = v }
  try { return await withMutants(url, [], fn) } finally { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k] } }
}
/** A synchronous stretch of real wall time (the record walk a guard makes: no await, the event loop does not turn). */
const burn = ms => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* working */ } }
const turn = () => new Promise(resolve => setImmediate(resolve))

const PALETTE = { deck: ['$planks'] }
const RECORD = { v: 1, blueprint: 'keeperstall@1', plot: 'keeperstall', cells: [], segments: [], clear: [], cut: [], replant: [], zones: [] }
function visitP (record, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeperstall-'))
  const key = PJ.projKey(HOME, 'keeperstall')
  const pub = PJ.publishRecord(dir, key, () => ({ ...record }))
  const slot = PJ.takeSlot(dir, key, 'A', 2)
  return { dir, key, me: 'A', home: HOME, stood: [], record, recordGen: pub.gen, palette: PALETTE, slot: slot.slot, slotGen: slot.gen,
    domain: () => true, walkR: 40, blockLayer: false, tidyKeepOrder: true, ...extra }
}
// ---- THE WORLD: N dirt pillars' feet in a row on the flat ground (the bots' litter), each a standing tidy cut ----------------------
const N = 14, BURN = 15
const CUTS = Array.from({ length: N }, (_, i) => [4 + i, G + 1, 3])
const cutWorld = () => server(Object.fromEntries(CUTS.map(a => [k3(a), 'dirt'])))
const tidyList = () => CUTS.map(at => ({ at, kind: 'tidy', name: 'dirt' }))

/**
 * (a) THE CLEARS' SKIP LOOP: every cut is refused by a `tidyOk` that burns BURN ms and never awaits (the guard owns the cell: the
 * live case). The probe is scheduled by the FIRST check, so only a turn of the event loop taken inside the loop can fire it.
 * -> { r, probed (at the visit's resolution), oks, pauses, dug }
 */
async function skipVisit (M, { opts = {}, pause = false, endOnProbe = false, deadlineIn = null } = {}) {
  const srv = cutWorld()
  const link = { _client: { ended: false } }   // the bot's connection, as buildbot.mjs reads it
  let probed = false, armed = false, oks = 0, pauses = 0, dug = 0
  const e = bot(srv, 'A', { aborted: () => BB.connEnded(link), dig: async () => { dug++; return 'confirmed' } })
  if (pause) e.pause = () => { pauses++; return turn() }
  const tidyOk = () => {
    if (!armed) { armed = true; setImmediate(() => { probed = true; if (endOnProbe) link._client.ended = true }) }
    oks++; burn(BURN); return false
  }
  const p = visitP(RECORD, { tidy: tidyList(), tidyOk })
  const o = { maxSteps: 300, ...(deadlineIn != null ? { deadline: Date.now() + deadlineIn } : {}), ...opts }
  const got = await M.runVisit(p, e, o).then(r => ({ r, probed }))
  return { ...got, oks, pauses, dug }
}
/**
 * (a') CUTS THAT ARE DUG, every loop top breathing (breathMs 0) -> { r, ev: ['pause' | 'ok' | 'walk' | 'dig', ...], srv }.
 */
async function digVisit (M, { opts = {}, extra = {} } = {}) {
  const srv = cutWorld()
  const ev = []
  const e = bot(srv, 'A')
  const dig0 = e.dig, walk0 = e.walkTo
  e.dig = async (c, expect) => { ev.push('dig'); return dig0(c, expect) }
  e.walkTo = async s => { ev.push('walk'); return walk0(s) }
  e.pause = () => { ev.push('pause'); return turn() }
  const p = visitP(RECORD, { tidy: tidyList(), tidyOk: () => { ev.push('ok'); return true }, ...extra })
  const r = await M.runVisit(p, e, { breathMs: 0, ...opts })
  return { r, ev, srv }
}
/**
 * (b) THE SEGMENTS' LOOP: K one-cell segments, each passed by a `segOk` that burns BURN ms and says no (another bot's segment too
 * near: gkhelpers-01) -- the loop `continue`s with nothing awaited. -> { r, probed, asks }
 */
const K = 12
const SEG_CELLS = Array.from({ length: K }, (_, i) => ({ at: [4 + i, G + 1, -3], role: 'deck', seg: `S${i}` }))
const SEG_RECORD = { ...RECORD, cells: SEG_CELLS, segments: SEG_CELLS.map(c => ({ seg: c.seg, deps: [] })) }
async function segVisit (M, { opts = {}, endOnProbe = false, deadlineIn = null } = {}) {
  const srv = server()
  let probed = false, armed = false, asks = 0, ended = false
  const e = bot(srv, 'A', { inv: { oak_planks: 64 }, aborted: () => ended })
  const segOk = () => {
    if (!armed) { armed = true; setImmediate(() => { probed = true; if (endOnProbe) ended = true }) }
    asks++; burn(BURN); return false
  }
  const o = { maxSteps: 300, ...(deadlineIn != null ? { deadline: Date.now() + deadlineIn } : {}), ...opts }
  const got = await M.runVisit(visitP(SEG_RECORD, { segOk }), e, o).then(r => ({ r, probed }))
  return { ...got, asks }
}
/**
 * (c) A SEGMENT'S STEP LOOP: one segment of K cells, each holding a foreign dirt block the visit digs; the fake's walk and dig resolve
 * at once (a microtask: the forest's `no_stand` retries behaved the same), the dig burning BURN ms. A dug cell reads done (alsoDone),
 * so nothing is placed and no acknowledgement is waited for. -> { r, probed, dug }
 */
const ONE_SEG = { ...RECORD, cells: SEG_CELLS.map(c => ({ ...c, seg: 'S' })), segments: [{ seg: 'S', deps: [] }] }
async function stepVisit (M, { opts = {} } = {}) {
  const srv = server(Object.fromEntries(SEG_CELLS.map(c => [k3(c.at), 'dirt'])))
  let probed = false, armed = false, dug = 0
  const e = bot(srv, 'A', { inv: { oak_planks: 64 } })
  e.dig = async c => {
    if (!armed) { armed = true; setImmediate(() => { probed = true }) }
    dug++; burn(BURN); srv.set(c, 'air'); return 'confirmed'
  }
  const p = visitP(ONE_SEG, { alsoDone: (c, read) => read(...c.at)?.name === 'air' })
  const got = await M.runVisit(p, e, { maxSteps: 300, ...opts }).then(r => ({ r, probed }))
  return { ...got, dug }
}

// ---- the named checks (each mutant below names the one it fails) -----------------------------------------------------------------
const NAMES = {
  skips: 'THE SKIP LOOP BREATHES: the probe (the socket\'s turn) fires BEFORE the visit resolves, with every cut refused and nothing dug',
  deadline: 'A DEADLINE that passes during the skips ends the visit `deadline` (cuts left unasked), no step counted',
  aborted: 'A CONNECTION THAT ENDS during the skips ends the visit `aborted` (cuts left unasked)',
  order: 'A CUT THAT IS DUG: the guard check is the last thing before its dig (walk, check, dig) -- never a pause between them',
  segs: 'THE SEGMENTS\' LOOP BREATHES: the probe fires before the visit resolves; an abort or a deadline seen there ends it',
  steps: 'A SEGMENT\'S STEP LOOP BREATHES: the probe fires before the visit resolves, every foreign block dug',
  ended: 'buildbot: the effects\' aborted() is true once the bot\'s client has ENDED; not ended, or no client: false; the skill\'s own signal still counts',
  onBot: 'skills.mjs (structural, comments stripped): none of the six fields is kept on the bot; procMem(bot) carries exactly those six',
  deadFell: 'r1 A FELLING ON A DEAD CONNECTION books nothing (no skip, no failure count, never a keep -> no waive); the same result on a live one does',
  deadRest: 'r1 A FOREST VISIT THAT ENDS ON A DEAD CONNECTION does not rest the forest for the next one; a live visit that did nothing does',
  deadCuts: 'r1 A WATER VISIT ON A DEAD CONNECTION counts no strike against a cut; a live one gives it up after TIDY_CUT_TRIES',
  cancelled: 'r2 A CANCELLED WATER VISIT ON A HEALTHY CONNECTION (signal aborted, cuts evaluated) counts no strike; live and not aborted does',
  afterEnd: 'r2 THE INTERVAL AFTER client.end() reads ENDED (ended false, socket not destroyed, the outbound stream ended); every healthy shape reads not ended',
  realClient: 'r2 the REAL minecraft-protocol client: NOT ended through handshake, login, compression, encryption, configuration, play and play->configuration->play; ENDED synchronously after end()',
  wiring: 'r1 skills.mjs (structural): both felling loops stop when the visit is gone and book through fellFailNote(ended: gone()); the rest, the strikes and clientEnded use the one predicate',
}
const skipsBreathe = async M => {
  const o = await skipVisit(M)
  assert.strictEqual(o.probed, true, 'the event loop turned inside the skip loop')
  assert.strictEqual(o.oks, N, 'every cut was asked'); assert.strictEqual(o.dug, 0); assert.strictEqual(o.r.cleared, 0)
  assert.strictEqual(o.r.stop, 'complete', JSON.stringify(o.r))
  assert.deepStrictEqual(o.r.tidyWet, CUTS.map(k3), 'every cut reported as waiting, as before')
}
const deadlineEnds = async M => {
  const o = await skipVisit(M, { deadlineIn: 60 })
  assert.strictEqual(o.r.stop, 'deadline', JSON.stringify(o.r))
  assert.ok(o.oks < N, `the loop stopped early (${o.oks} of ${N} asked)`); assert.strictEqual(o.dug, 0)
}
const endedAborts = async M => {
  const o = await skipVisit(M, { endOnProbe: true })
  assert.strictEqual(o.r.stop, 'aborted', JSON.stringify(o.r))
  assert.ok(o.oks < N, `the loop stopped early (${o.oks} of ${N} asked)`); assert.strictEqual(o.dug, 0)
}
const checkThenDig = async M => {
  const { r, ev, srv } = await digVisit(M, { opts: { maxSteps: N } })
  const digs = ev.map((x, i) => (x === 'dig' ? i : -1)).filter(i => i >= 0)
  assert.strictEqual(digs.length, N); assert.strictEqual(r.cleared, N); assert.strictEqual(r.stop, 'complete', JSON.stringify(r))
  for (const i of digs) assert.deepStrictEqual(ev.slice(i - 2, i + 1), ['walk', 'ok', 'dig'], `the dig at ${i}: ${ev.slice(Math.max(0, i - 4), i + 1).join(' ')}`)
  // the breaths happened (the positive control of this order test), at the loop's top only: one before each cut's first check
  assert.strictEqual(ev.filter(x => x === 'pause').length, N)
  assert.deepStrictEqual(ev.slice(0, 5), ['pause', 'ok', 'walk', 'ok', 'dig'])
  assert.ok(CUTS.every(a => srv.read(...a).name === 'air'))
}
const segsBreathe = async M => {
  const a = await segVisit(M)
  assert.strictEqual(a.probed, true, 'the event loop turned inside the segments\' loop')
  assert.strictEqual(a.asks, K); assert.strictEqual(a.r.stop, 'deps_open', JSON.stringify(a.r)); assert.strictEqual(a.r.segsNear, K)
  const b = await segVisit(M, { endOnProbe: true })
  assert.strictEqual(b.r.stop, 'aborted', JSON.stringify(b.r)); assert.ok(b.asks < K)
  const c = await segVisit(M, { deadlineIn: 60 })
  assert.strictEqual(c.r.stop, 'deadline', JSON.stringify(c.r)); assert.ok(c.asks < K)
}
const stepsBreathe = async M => {
  const o = await stepVisit(M)
  assert.strictEqual(o.probed, true, 'the event loop turned inside the segment\'s step loop')
  assert.strictEqual(o.dug, K); assert.strictEqual(o.r.cleared, K); assert.strictEqual(o.r.stop, 'complete', JSON.stringify(o.r))
}

console.log('THE DECISION (pure)')
await t('breathDue: due once the budget of wall time has passed since the last breath; the default budget is BREATH_MS (40)', () => {
  assert.strictEqual(R.BREATH_MS, 40)
  assert.strictEqual(R.breathDue(1000, 1039, 40), false); assert.strictEqual(R.breathDue(1000, 1040, 40), true); assert.strictEqual(R.breathDue(1000, 5000, 40), true)
  assert.strictEqual(R.breathDue(1000, 1039.9), false); assert.strictEqual(R.breathDue(1000, 1040), true)
  assert.strictEqual(R.breathDue(1000, 1000, 0), true, 'a zero budget: every loop top')
  assert.strictEqual(R.breathDue(1000, 900, 40), false, 'a clock that stepped back is not a breath')
  assert.strictEqual(R.breathDue(NaN, 1000, 40), true); assert.strictEqual(R.breathDue(1000, undefined, 40), true, 'an unread clock: breathe (one turn is cheap)')
})
await t('the switch: BREATHE=off|0|false|no reads off; unset or anything else reads on', () => {
  assert.strictEqual(R.breatheOn({}), true); assert.strictEqual(R.breatheOn({ BREATHE: 'on' }), true); assert.strictEqual(R.breatheOn({ BREATHE: '' }), true)
  for (const v of ['off', '0', 'false', 'no', ' OFF ']) assert.strictEqual(R.breatheOn({ BREATHE: v }), false, v)
})

console.log('THE VISIT BREATHES (the real runVisit; the checks burn real time and never await)')
await t(NAMES.skips, () => skipsBreathe(R))
await t('...and the turn is the effects\' `pause` when one is given (e.pause was called, at least once, and the probe fired)', async () => {
  const o = await skipVisit(R, { pause: true })
  assert.ok(o.pauses >= 1, `pauses ${o.pauses}`); assert.strictEqual(o.probed, true)
  assert.ok(o.pauses <= N, 'never more than one a cut')
})
await t('POSITIVE CONTROL, `breathe: false` (what BREATHE=off feeds): the same visit is ONE macrotask -- the probe does NOT fire before it resolves', async () => {
  const o = await skipVisit(R, { opts: { breathe: false }, pause: true })
  assert.strictEqual(o.probed, false, 'the instrument sees the starvation'); assert.strictEqual(o.pauses, 0)
  assert.strictEqual(o.oks, N); assert.strictEqual(o.r.stop, 'complete')
  // ...and neither the deadline nor the ended connection is seen by it (the live loop: 62 cuts, 41 s, no bound)
  const d = await skipVisit(R, { opts: { breathe: false }, deadlineIn: 60 })
  assert.strictEqual(d.r.stop, 'complete'); assert.strictEqual(d.oks, N)
  const a = await skipVisit(R, { opts: { breathe: false }, endOnProbe: true })
  assert.strictEqual(a.r.stop, 'complete'); assert.strictEqual(a.oks, N)
})
await t('BREATHE=off at the module\'s load (a fresh copy under the env): no breath -- the probe does not fire; unset: it does', async () => {
  const off = await loadedUnder(RUN_URL, { BREATHE: 'off' }, M => skipVisit(M, { pause: true }))
  assert.strictEqual(off.probed, false); assert.strictEqual(off.pauses, 0); assert.strictEqual(off.r.stop, 'complete')
  const on = await loadedUnder(RUN_URL, { BREATHE: 'on' }, M => skipVisit(M, { pause: true }))
  assert.strictEqual(on.probed, true); assert.ok(on.pauses >= 1)
})
await t(NAMES.deadline, () => deadlineEnds(R))
await t(NAMES.aborted, () => endedAborts(R))
await t(NAMES.order, () => checkThenDig(R))
await t('a breath counts NO step and no try: maxSteps = the digs passes with a breath at every loop top; clearMax still bounds the digs', async () => {
  const a = await digVisit(R, { opts: { maxSteps: N } })
  assert.strictEqual(a.r.stop, 'complete'); assert.strictEqual(a.r.cleared, N)
  const b = await digVisit(R, { opts: { maxSteps: N - 1 } })
  assert.strictEqual(b.r.stop, 'max_steps', 'the step guard still counts every dig tried'); assert.strictEqual(b.r.cleared, N - 1)
  const c = await digVisit(R, { extra: { clearMax: 5 } })
  assert.strictEqual(c.r.cleared, 5); assert.strictEqual(c.ev.filter(x => x === 'dig').length, 5)
  assert.strictEqual(CUTS.filter(a2 => c.srv.read(...a2).name === 'dirt').length, N - 5)
  // the same visits without a breath: the same counts
  const d = await digVisit(R, { opts: { breathe: false }, extra: { clearMax: 5 } })
  assert.strictEqual(d.r.cleared, 5); assert.strictEqual(d.ev.filter(x => x === 'pause').length, 0)
  assert.deepStrictEqual(d.ev.slice(0, 4), ['ok', 'walk', 'ok', 'dig'])
})
await t(NAMES.segs, () => segsBreathe(R))
await t(NAMES.steps, () => stepsBreathe(R))
await t('POSITIVE CONTROL, `breathe: false`: the segments\' loop and a segment\'s step loop each run as one macrotask', async () => {
  const a = await segVisit(R, { opts: { breathe: false } })
  assert.strictEqual(a.probed, false); assert.strictEqual(a.r.stop, 'deps_open')
  const b = await segVisit(R, { opts: { breathe: false }, endOnProbe: true })
  assert.strictEqual(b.r.stop, 'deps_open', 'an abort raised by the event loop is never seen'); assert.strictEqual(b.asks, K)
  const c = await stepVisit(R, { opts: { breathe: false } })
  assert.strictEqual(c.probed, false); assert.strictEqual(c.dug, K)
})

console.log('MUTANTS OF THE BREATH (buildrun.mjs)')
const TOP = '      for (const c of todo) {\n        if (winded()) { const b = await breathe(); if (b) return b }\n'
await t(`MUTANT, the yield removed from clears(): fails "${NAMES.skips}"`, async () => {
  const o = await withMutants(RUN_URL, [[TOP, '      for (const c of todo) {\n']], M => skipVisit(M))
  assert.strictEqual(o.probed, false, 'the mutant survived'); assert.strictEqual(o.oks, N)
})
await t(`MUTANT, the yield replaced by \`await Promise.resolve()\` (a microtask): fails "${NAMES.skips}"`, async () => {
  const o = await withMutants(RUN_URL, [['new Promise(resolve => setImmediate(resolve))', 'Promise.resolve()']], M => skipVisit(M))
  assert.strictEqual(o.probed, false, 'the mutant survived'); assert.strictEqual(o.oks, N)
})
await t(`MUTANT, the breath moved AFTER the skips' \`continue\`s (to the step guard): fails "${NAMES.skips}"`, async () => {
  const GUARD = '        const g = guard(); if (g) return g\n        tried++\n'
  const pairs = [[TOP, '      for (const c of todo) {\n'], [GUARD, `        if (winded()) { const b = await breathe(); if (b) return b }\n${GUARD}`]]
  const o = await withMutants(RUN_URL, pairs, M => skipVisit(M))
  assert.strictEqual(o.probed, false, 'the mutant survived'); assert.strictEqual(o.oks, N)
  // ...and the mutant is a working visit otherwise (it breathes where a dig is tried): it is the PLACE that is wrong
  const d = await withMutants(RUN_URL, pairs, M => digVisit(M))
  assert.strictEqual(d.r.cleared, N); assert.ok(d.ev.includes('pause'))
})
await t(`MUTANT, the deadline check after the yield dropped: fails "${NAMES.deadline}"`, async () => {
  const o = await withMutants(RUN_URL, [["    return now() > deadline ? 'deadline' : null\n", '    return null\n']], M => skipVisit(M, { deadlineIn: 60 }))
  assert.strictEqual(o.probed, true, 'the mutant still breathes'); assert.notStrictEqual(o.r.stop, 'deadline', 'the mutant survived'); assert.strictEqual(o.oks, N)
})
await t(`MUTANT, a breath put between the after-walk check and the dig: fails "${NAMES.order}"`, async () => {
  const SAFE = "    if (safe && !safe()) return 'unsafe'\n    let v = await e.dig(at, name)\n"
  const { ev } = await withMutants(RUN_URL, [[SAFE, "    if (safe && !safe()) return 'unsafe'\n    if (winded()) await breathe()\n    let v = await e.dig(at, name)\n"]], M => digVisit(M))
  const i = ev.indexOf('dig')
  assert.deepStrictEqual(ev.slice(i - 2, i + 1), ['ok', 'pause', 'dig'], `the mutant survived: ${ev.slice(0, i + 1).join(' ')}`)
})
await t(`MUTANT, the breath removed from the segments' loop: fails "${NAMES.segs}"`, async () => {
  const SEGS = '  for (const { seg, deps } of segmentsOf(record)) {\n    if (winded()) { const b = await breathe(); if (b) { out.stop = b; return out } }\n'
  const o = await withMutants(RUN_URL, [[SEGS, '  for (const { seg, deps } of segmentsOf(record)) {\n']], M => segVisit(M, { endOnProbe: true }))
  assert.strictEqual(o.probed, false, 'the mutant survived'); assert.strictEqual(o.r.stop, 'deps_open'); assert.strictEqual(o.asks, K)
})
await t(`MUTANT, the breath removed from a segment's step loop: fails "${NAMES.steps}"`, async () => {
  const STEPS = '      for (;;) {\n        if (winded()) { const b = await breathe(); if (b) { out.stop = b; return out } }\n'
  const o = await withMutants(RUN_URL, [[STEPS, '      for (;;) {\n']], M => stepVisit(M))
  assert.strictEqual(o.probed, false, 'the mutant survived'); assert.strictEqual(o.dug, K)
})

console.log('AN ENDED CONNECTION ABORTS THE VISIT (buildbot.mjs)')
const fakeBot = client => Object.assign(new EventEmitter(), { ...(client ? { _client: client } : {}), entity: { position: { x: 0, y: 0, z: 0 }, pitch: 0, yaw: 0, onGround: true }, blockAt: () => null, inventory: { items: () => [] }, players: {} })
const fakeClient = () => { const c = new EventEmitter(); c.write = () => {}; return c }
// r2: the client's shapes as minecraft-protocol 1.66.2 leaves them (read off the real client on ci2, 11-10; realClientSeen re-reads them)
const SHAPE = {
  healthy: () => ({ ended: false, socket: { destroyed: false, writableEnded: false }, serializer: { writableEnded: false, writable: true } }),
  afterEnd: () => ({ ended: false, socket: { destroyed: false, writableEnded: false }, serializer: { writableEnded: true, writable: false } }),      // synchronously after end()
  turnLater: () => ({ ended: false, socket: { destroyed: false, writableEnded: true }, serializer: { writableEnded: true, writable: false } }),      // the chain ended the socket
  noSerializer: () => ({ ended: false, socket: { destroyed: false, writableEnded: true } }),                                                          // end() before any serializer
  closed: () => ({ ended: true, socket: { destroyed: true, writableEnded: true }, serializer: { writableEnded: true, writable: false } }),
}
const afterEndSeen = M => {
  assert.strictEqual(M.connEnded({ _client: SHAPE.healthy() }), false, 'healthy')
  for (const k of ['afterEnd', 'turnLater', 'noSerializer', 'closed']) assert.strictEqual(M.connEnded({ _client: SHAPE[k]() }), true, k)
  // only `true` counts: a stream that never said, or a fake's other values, is not an ended one
  for (const c of [{ serializer: {} }, { serializer: { writableEnded: undefined }, socket: { writableEnded: undefined } }, { serializer: null, socket: {} }, { serializer: { writableEnded: 'no' } }]) assert.strictEqual(M.connEnded({ _client: c }), false, JSON.stringify(c))
  // the effects see it: aborted the moment end() was called
  const c = Object.assign(fakeClient(), SHAPE.healthy()), e = M.botBuildEffects(fakeBot(c), {})
  try { assert.strictEqual(e.aborted(), false); c.serializer.writableEnded = true; assert.strictEqual(e.aborted(), true, 'after end()') } finally { e.close() }
}
/** The REAL client (no server: an unconnected socket is enough -- end() is judged at the moment it returns). */
const realClientSeen = M => {
  const mc = createRequire(import.meta.url)('minecraft-protocol')
  const c = new mc.Client(false, '1.21.8')
  c.on('error', () => {})
  const bot = { _client: c }
  try {
    c.setSocket(new net.Socket())
    const healthy = what => { assert.strictEqual(c.ended, false, what); assert.strictEqual(M.connEnded(bot), false, `healthy: ${what}`) }
    c.state = 'handshaking'; healthy('handshaking')
    c.state = 'login'; healthy('login')
    c.setCompressionThreshold(256); healthy('compression')
    c.setEncryption(Buffer.alloc(16)); healthy('encryption')
    c.state = 'configuration'; healthy('configuration')
    c.state = 'play'; healthy('play')
    c.state = 'configuration'; c.state = 'play'; healthy('play -> configuration -> play')
    c.end('test')
    // THE INTERVAL: neither of the old two flags says so, and the write is already a no-op
    assert.strictEqual(c.ended, false, 'end() does not set `ended`'); assert.strictEqual(c.socket.destroyed, false, 'end() does not destroy the socket')
    assert.strictEqual(c.serializer.writable, false, 'writes are no-ops from here')
    assert.strictEqual(M.connEnded(bot), true, 'ENDED synchronously after end()')
  } finally { clearTimeout(c.closeTimer); try { c.socket?.destroy() } catch { /* gone */ } }
}
const endedSeen = async M => {
  assert.strictEqual(M.connEnded({ _client: { ended: true } }), true)
  // r1: a destroyed socket says the same (mineflayer's keepalive timeout: client.end() first, `ended` only once the socket closed)
  assert.strictEqual(M.connEnded({ _client: { ended: false, socket: { destroyed: true } } }), true, 'a destroyed socket')
  for (const b of [null, undefined, {}, { _client: null }, { _client: {} }, { _client: { ended: false } }, { _client: { ended: 'yes' } }, { _client: { ended: false, socket: { destroyed: false } } }, { _client: { socket: null } }]) assert.strictEqual(M.connEnded(b), false, JSON.stringify(b))
  afterEndSeen(M)
  { const c = fakeClient(); c.ended = false; c.socket = { destroyed: false }; const e = M.botBuildEffects(fakeBot(c), {})
    try { assert.strictEqual(e.aborted(), false); c.socket.destroyed = true; assert.strictEqual(e.aborted(), true, 'the socket destroyed: aborted') } finally { e.close() } }
  // the effects on a connected client: not aborted; the client ends (minecraft-protocol sets `ended` true): aborted
  const c = fakeClient(), e = M.botBuildEffects(fakeBot(c), {})
  try {
    assert.strictEqual(e.aborted(), false, 'a client that never said'); c.ended = false; assert.strictEqual(e.aborted(), false, 'connected')
    c.ended = true; assert.strictEqual(e.aborted(), true, 'ended')
  } finally { e.close() }
  // no client at all (a test's fake): never ended; the skill's own signal alone decides, and still does with a live client
  let sig = false
  const e2 = M.botBuildEffects(fakeBot(null), { aborted: () => sig })
  try { assert.strictEqual(e2.aborted(), false); sig = true; assert.strictEqual(e2.aborted(), true) } finally { e2.close() }
  const c3 = fakeClient(); c3.ended = false
  const e3 = M.botBuildEffects(fakeBot(c3), { aborted: () => true })
  try { assert.strictEqual(e3.aborted(), true) } finally { e3.close() }
}
await t(NAMES.ended, () => endedSeen(BB))
await t(`MUTANT, the \`_client.ended\` clause dropped: fails "${NAMES.ended}"`, async () => {
  await withMutants(BOT_URL, [['  const aborted = () => !!skillAborted() || connEnded(bot)\n', '  const aborted = () => !!skillAborted()\n']], async M => {
    const c = fakeClient(); c.ended = true
    const e = M.botBuildEffects(fakeBot(c), {})
    try { assert.strictEqual(e.aborted(), false, 'the mutant survived') } finally { e.close() }
    let killed = false
    try { await endedSeen(M) } catch { killed = true }
    assert.ok(killed, 'the mutant survived the named test')
  })
})

await t(NAMES.afterEnd, () => afterEndSeen(BB))
await t(NAMES.realClient, () => realClientSeen(BB))
await t(`MUTANT, the serializer clause dropped (the 30 s after end() read as connected): fails "${NAMES.afterEnd}" and "${NAMES.realClient}"`, async () => {
  await withMutants(BOT_URL, [[' || c.serializer?.writableEnded === true', '']], async M => {
    assert.strictEqual(M.connEnded({ _client: SHAPE.afterEnd() }), false, 'the mutant survived')
    assert.strictEqual(M.connEnded({ _client: SHAPE.turnLater() }), true, 'the other clauses still stand in the mutant')
    assert.throws(() => afterEndSeen(M), /afterEnd/); assert.throws(() => realClientSeen(M), /ENDED synchronously after end\(\)/)
  })
})
await t(`MUTANT, the socket's writableEnded clause dropped: fails "${NAMES.afterEnd}"`, async () => {
  await withMutants(BOT_URL, [[' || c.socket?.writableEnded === true\n', '\n']], async M => {
    assert.strictEqual(M.connEnded({ _client: SHAPE.noSerializer() }), false, 'the mutant survived')
    assert.throws(() => afterEndSeen(M), /noSerializer/)
  })
})
await t(`MUTANT, the destroyed-socket clause dropped (two notions of "ended" again): fails "${NAMES.ended}"`, async () => {
  await withMutants(BOT_URL, [[' || c.socket?.destroyed === true', '']], async M => {
    assert.strictEqual(M.connEnded({ _client: { ended: false, socket: { destroyed: true } } }), false, 'the mutant survived')
    let killed = false
    try { await endedSeen(M) } catch { killed = true }
    assert.ok(killed, 'the mutant survived the named test')
  })
})

console.log('THE KEEPER\'S MEMORY IS THE PROCESS\'S (procmem.mjs)')
await t('two bot objects of ONE name share one memory object; another name has its own; nothing of the bot is kept in it', () => {
  const store = new Map()
  const a1 = { username: 'Onyx' }, a2 = { username: 'Onyx' }, b = { username: 'Bravo' }
  const m = PM.procMemOf(store, a1)
  assert.strictEqual(PM.procMemOf(store, a2), m); assert.strictEqual(PM.procMemOf(store, a1), m)
  assert.notStrictEqual(PM.procMemOf(store, b), m)
  m.bw3At = 5
  assert.strictEqual(PM.procMemOf(store, a2).bw3At, 5); assert.strictEqual(PM.procMemOf(store, b).bw3At, undefined)
  assert.deepStrictEqual(Object.keys(a1), ['username'], 'nothing is written on the bot'); assert.deepStrictEqual([...store.keys()], ['Onyx', 'Bravo'])
  // the process's own store, through the exported accessor
  const n = `ks-${process.pid}`
  assert.strictEqual(PM.procMem({ username: n }), PM.procMem({ username: n })); assert.notStrictEqual(PM.procMem({ username: n }), PM.procMem({ username: `${n}-b` }))
})
await t('procMemReset (tests only): the process\'s store forgets every bot; no src module calls it', () => {
  const n = `ks-reset-${process.pid}`
  PM.procMem({ username: n }).bw3At = 7
  assert.strictEqual(PM.procMem({ username: n }).bw3At, 7)
  PM.procMemReset()
  assert.strictEqual(PM.procMem({ username: n }).bw3At, undefined)
  const srcDir = new URL('../src/', import.meta.url)
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.mjs'))
  assert.ok(files.length > 50 && files.includes('procmem.mjs') && files.includes('skills.mjs'), 'the instrument reads the src modules')
  const callers = files.filter(f => f !== 'procmem.mjs' && readFileSync(new URL(f, srcDir), 'utf8').includes('procMemReset'))
  assert.deepStrictEqual(callers, [])
})
await t('a bot with NO name never shares (kept on the bot object itself); no bot: a throwaway', () => {
  const store = new Map()
  const x = {}, y = {}
  assert.strictEqual(PM.procMemOf(store, x), PM.procMemOf(store, x)); assert.notStrictEqual(PM.procMemOf(store, x), PM.procMemOf(store, y))
  assert.strictEqual(store.size, 0)
  assert.notStrictEqual(PM.procMemOf(store, { username: '' }), PM.procMemOf(store, { username: '' }))
  assert.deepStrictEqual(PM.procMemOf(store, null), {}); assert.notStrictEqual(PM.procMemOf(store, null), PM.procMemOf(store, null))
})
await t('PROCMEM=off: the memory is the bot object\'s own again (per connection) -- the pure core, the switch, and a fresh copy under the env', async () => {
  const store = new Map()
  const a1 = { username: 'Onyx' }, a2 = { username: 'Onyx' }
  PM.procMemOf(store, a1, false).bw3At = 5
  assert.strictEqual(PM.procMemOf(store, a1, false).bw3At, 5, 'kept for the connection'); assert.strictEqual(PM.procMemOf(store, a2, false).bw3At, undefined, 'a new connection starts again')
  assert.strictEqual(store.size, 0)
  assert.strictEqual(PM.procMemOn({}), true); for (const v of ['off', '0', 'false', 'no']) assert.strictEqual(PM.procMemOn({ PROCMEM: v }), false, v)
  const n = `ks-off-${process.pid}`
  await loadedUnder(PM_URL, { PROCMEM: 'off' }, M => {
    const b1 = { username: n }, b2 = { username: n }
    M.procMem(b1).bw3At = 9
    assert.strictEqual(M.procMem(b1).bw3At, 9); assert.strictEqual(M.procMem(b2).bw3At, undefined)
  })
  await loadedUnder(PM_URL, { PROCMEM: 'on' }, M => { M.procMem({ username: n }).bw3At = 9; assert.strictEqual(M.procMem({ username: n }).bw3At, 9) })
})
await t('THREE STRIKES recorded through one bot object filter the cut for the NEXT bot object (tidyNoteCuts / tidyGivenUp, the real helpers)', () => {
  const store = new Map()
  const cuts = [{ at: [5, 69, 0] }, { at: [6, 69, 0] }]
  const visit = b => {   // skills.mjs waterWalkVisit's own lines: the memory, the filter, the note after the visit
    const mem = (PM.procMemOf(store, b).bw3Given ??= new Map())
    const mine = cuts.filter(q => !T.tidyGivenUp(mem, q.at.join(',')))
    T.tidyNoteCuts(mem, mine.filter(q => q.at[0] === 5).map(q => q.at.join(',')), () => true)   // the cut at x 5 is evaluated and still stands
    return mine.map(q => q.at[0])
  }
  assert.strictEqual(T.TIDY_CUT_TRIES, 3)
  const old = { username: 'Onyx' }
  for (let i = 0; i < 3; i++) assert.deepStrictEqual(visit(old), [5, 6])
  assert.deepStrictEqual(visit({ username: 'Onyx' }), [6], 'the reconnected keeper does not go back to the cut it gave up')
  assert.deepStrictEqual(visit({ username: 'Bravo' }), [5, 6], 'another bot has its own count')
  // POSITIVE CONTROL (per-connection memory, as before): the new bot object starts again and tries the cut
  const visitOff = b => { const mem = (PM.procMemOf(store, b, false).bw3Given ??= new Map()); const mine = cuts.filter(q => !T.tidyGivenUp(mem, q.at.join(','))); T.tidyNoteCuts(mem, ['5,69,0'], () => true); return mine.map(q => q.at[0]) }
  const old2 = { username: 'Delta' }
  for (let i = 0; i < 3; i++) visitOff(old2)
  assert.deepStrictEqual(visitOff(old2), [6]); assert.deepStrictEqual(visitOff({ username: 'Delta' }), [5, 6])
})

console.log('skills.mjs: THE WATER VISIT\'S CLOCK AND THE WIRING')
const SK_RAW = readFileSync(SKILLS_URL, 'utf8')
/** Comments stripped: whole-line and trailing `//`, and the lines of a block comment (this codebase's comments quote the code). */
const strip = s => s.split('\n').filter(l => !/^\s*(\/\*|\*)/.test(l)).map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s+\/\/ .*$/, '')).join('\n')
const MOVED = ['bw3At', 'bw3Given', 'forestIdleUntil', 'forestSkip', 'forestFails', 'gkCountryAt']
const STAYS = ['shopUnknown', 'shopAcks', 'bw3Stands', 'forestStands', 'tidyStands']
const onBotRe = names => new RegExp(`\\bbot\\??\\.(${names.join('|')})\\b`, 'g')
const structural = raw => {
  const code = strip(raw)
  // POSITIVE CONTROL: the same expression finds the fields that must STAY on the bot (the old connection's world and body)
  const stays = new Set([...code.matchAll(onBotRe(STAYS))].map(m => m[1]))
  assert.deepStrictEqual([...stays].sort(), [...STAYS].sort(), 'the instrument finds bot.<field> in this source, and these stay on the bot')
  const left = [...code.matchAll(onBotRe(MOVED))].map(m => m[0])
  assert.deepStrictEqual(left, [], `still on the bot: ${left.join(', ')}`)
  // every use of the process memory is one of the six (nothing else was moved), and each of the six is there
  // (r1: `forestFails`, and the write of `forestSkip`, are booked by forest.mjs fellFailNote on the memory object it is handed)
  const used = new Set([...code.matchAll(/\bprocMem\(bot\)\.(\w+)/g)].map(m => m[1]))
  assert.deepStrictEqual([...used].sort(), MOVED.filter(n => n !== 'forestFails').sort())
  const fcode = strip(readFileSync(FOREST_URL, 'utf8'))
  assert.strictEqual(fcode.split('keepDue((mem.forestFails ??= new Map()), t.key, r.why, F)').length, 2); assert.strictEqual(fcode.split('(mem.forestSkip ??= new Map()).set(t.key, now + skipMs)').length, 2)
  for (const n of [...STAYS, 'pending']) assert.ok(!new RegExp(`procMem\\([^)]*\\)\\??\\.${n}\\b`).test(code), `${n} is never carried across connections`)
  // the keeper's hook: due by the process's clock, stamped there BEFORE the visit is awaited
  assert.strictEqual(code.split("  if (role === 'keeper' && bw3Due(procMem(bot))) {\n    if (!clientEnded(bot)) procMem(bot).bw3At = Date.now()\n    const ww = await waterWalkVisit(").length, 2)
  assert.strictEqual(code.split('  const mem = (procMem(bot).bw3Given ??= new Map())').length, 2)
  assert.strictEqual(code.split("import { procMem } from './procmem.mjs'").length, 2)
}
await t(NAMES.onBot, () => structural(SK_RAW))
await t(`MUTANT, \`bw3At\` stored on the bot again: fails "${NAMES.onBot}"`, () => {
  const m = mutantText(SKILLS_URL, [['    if (!clientEnded(bot)) procMem(bot).bw3At = Date.now()', '    if (!clientEnded(bot)) bot.bw3At = Date.now()']])
  assert.throws(() => structural(m), /still on the bot: bot\.bw3At/)
  // ...and a give-up map on the bot again, the same way
  const g = mutantText(SKILLS_URL, [['  const mem = (procMem(bot).bw3Given ??= new Map())', '  const mem = (bot.bw3Given ??= new Map())']])
  assert.throws(() => structural(g), /still on the bot: bot\.bw3Given/)
})
await t('the strip keeps code and drops comments (the structural test above reads code, not the comments that quote it)', () => {
  const s = strip('a = bot.bw3At   // bot.bw3Given in a comment\n// bot.forestSkip\n/** bot.forestFails\n *  bot.gkCountryAt */\nb = 1')
  assert.ok(s.includes('a = bot.bw3At') && s.includes('b = 1'))
  for (const n of ['bw3Given', 'forestSkip', 'forestFails', 'gkCountryAt']) assert.ok(!s.includes(n), n)
})
const SKM = await import('../src/skills.mjs')
const { bw3Due } = SKM
const { BW3 } = await import('../src/boardwalk.mjs')
await t('bw3Due takes the MEMORY: false inside everyMs for a FRESH bot object when the process memory says a visit just ran; due again after it', () => {
  const store = new Map(), now = 1_800_000_000_000
  assert.strictEqual(BW3.everyMs, 15 * 60_000)
  assert.strictEqual(bw3Due(PM.procMemOf(store, { username: 'Onyx' }), now), true, 'never visited: due')
  PM.procMemOf(store, { username: 'Onyx' }).bw3At = now           // the keeper's hook stamps the visit's start
  const back = { username: 'Onyx' }                                // the reconnect: a new bot object
  assert.strictEqual(bw3Due(PM.procMemOf(store, back), now + 60_000), false, 'one minute later, a new connection: NOT due')
  assert.strictEqual(bw3Due(PM.procMemOf(store, back), now + BW3.everyMs - 1), false)
  assert.strictEqual(bw3Due(PM.procMemOf(store, back), now + BW3.everyMs), true)
  assert.strictEqual(bw3Due(PM.procMemOf(store, { username: 'Bravo' }), now + 60_000), true, 'another bot\'s clock is its own')
  // POSITIVE CONTROL: per-connection memory (PROCMEM=off) -- the new bot object is due at once, which was the loop
  const s2 = new Map(), old = { username: 'Onyx' }
  PM.procMemOf(s2, old, false).bw3At = now
  assert.strictEqual(bw3Due(PM.procMemOf(s2, old, false), now + 60_000), false); assert.strictEqual(bw3Due(PM.procMemOf(s2, { username: 'Onyx' }, false), now + 60_000), true)
  assert.strictEqual(bw3Due(null, now), true); assert.strictEqual(bw3Due({}, now, 0), true)
})


console.log('r1: A MEMORY THAT OUTLIVES THE CONNECTION LEARNS NOTHING FROM A DEAD ONE')
// the bots as the skills see them: `ended`, or the socket destroyed before `ended` is set; and a live one
const DEAD = [{ ended: true }, { ended: false, socket: { destroyed: true } }, SHAPE.afterEnd(), SHAPE.turnLater()]
const LIVE = () => ({ ended: false, socket: { destroyed: false } })
const TREE = { key: 'plot:12,64,-40', cell: [12, 64, -40], stand: [12, 64, -39] }
/** One felling loop pass as skills.mjs buildForest books it (structural test below: both loops are these lines) -> the waives published. */
const fellPass = (FM, ended, store, bot, t, r, { noStand = false, now = 1000 } = {}) => {
  const waives = []
  const nf = FM.fellFailNote(PM.procMemOf(store, bot), t, r, { ended: ended(bot), noStand, now, skipMs: 30 * 60_000 })
  if (nf.counted && nf.keep) waives.push(t.key)
  return { nf, waives }
}
const deadFellBooksNothing = async (FM, ended = BB.connEnded) => {
  assert.ok(FM.FOREST.failMax >= 2, 'the keep needs more than one failure')
  for (const client of DEAD) {
    const store = new Map()
    // every disconnect is a NEW bot object of the same name; the zombie visit's results come back on the ended one
    let waived = 0
    for (let i = 0; i < FM.FOREST.failMax + 3; i++) {
      const zombie = { username: 'Onyx', _client: { ...client } }
      for (const why of ['off_stand', 'unconfirmed']) {
        const { nf, waives } = fellPass(FM, ended, store, zombie, TREE, { n: 0, why })
        assert.deepStrictEqual(nf, { counted: false, keep: false }, `${JSON.stringify(client)} ${why}`); waived += waives.length
      }
      // the retire's no-stand tree is not kept on a dead connection either (the visit stops before it; the helper holds alone too)
      waived += fellPass(FM, ended, store, zombie, { key: 'k2', stand: null }, { n: 0, why: 'no_stand' }, { noStand: true }).waives.length
    }
    const mem = PM.procMemOf(store, { username: 'Onyx' })
    assert.strictEqual(mem.forestFails, undefined, 'no failure counted'); assert.strictEqual(mem.forestSkip, undefined, 'no tree passed')
    assert.strictEqual(waived, 0, 'no waive published')
  }
  // POSITIVE CONTROL: the SAME results on a live connection are booked, across reconnects (the process memory), and kept at failMax
  const store = new Map()
  let waived = []
  for (let i = 0; i < FM.FOREST.failMax; i++) {
    const live = { username: 'Onyx', _client: LIVE() }
    const { nf, waives } = fellPass(FM, ended, store, live, TREE, { n: 0, why: 'off_stand' }, { now: 1000 + i })
    assert.deepStrictEqual(nf, { counted: true, keep: i === FM.FOREST.failMax - 1 }, `failure ${i + 1}`); waived = waived.concat(waives)
  }
  const mem = PM.procMemOf(store, { username: 'Onyx' })
  assert.strictEqual(mem.forestFails.get(TREE.key), FM.FOREST.failMax); assert.strictEqual(mem.forestSkip.get(TREE.key), 1000 + FM.FOREST.failMax - 1 + 30 * 60_000)
  assert.deepStrictEqual(waived, [TREE.key], 'kept once, at failMax')
  // a clock stop is passed for now but never counted toward the keep (keepDue, as before); no failure: nothing; no stand: kept at once
  const m2 = {}
  assert.deepStrictEqual(FM.fellFailNote(m2, TREE, { n: 1, why: 'deadline' }, { now: 5, skipMs: 10 }), { counted: true, keep: false })
  assert.strictEqual(m2.forestSkip.get(TREE.key), 15); assert.strictEqual(m2.forestFails.get(TREE.key), undefined)
  assert.deepStrictEqual(FM.fellFailNote(m2, TREE, { n: 3, why: null }), { counted: false, keep: false })
  assert.deepStrictEqual(FM.fellFailNote(m2, { key: 'k3', stand: null }, { n: 0, why: 'no_stand' }, { noStand: true }), { counted: true, keep: true })
  assert.strictEqual(m2.forestFails.get('k3'), undefined, 'kept uncounted, as the retire loop always did')
}
const deadVisitRestsNothing = async (FM, ended = BB.connEnded) => {
  for (const client of DEAD) {
    const zombie = { username: 'Onyx', _client: client }
    for (const outcome of ['aborted', 'blocked', 'complete', 'skipped', 'deadline']) assert.strictEqual(FM.forestRestDue('no_effect', outcome, { ended: ended(zombie) }), false, outcome)
  }
  const live = { username: 'Onyx', _client: LIVE() }
  // POSITIVE CONTROL: a live visit that did nothing rests the forest; one that was turned away, did something, failed or was aborted does not
  for (const outcome of ['blocked', 'complete', 'skipped', 'deadline', 'no_site']) assert.strictEqual(FM.forestRestDue('no_effect', outcome, { ended: ended(live) }), true, outcome)
  assert.strictEqual(FM.forestRestDue('no_effect', 'blocked'), true, 'the default: not ended')
  for (const outcome of ['keeper_held', 'off', 'zones_unknown', 'no_plan']) assert.strictEqual(FM.forestRestDue('no_effect', outcome), false, outcome)
  assert.strictEqual(FM.forestRestDue('success', 'complete'), false); assert.strictEqual(FM.forestRestDue('failed', 'error'), false); assert.strictEqual(FM.forestRestDue('aborted', 'aborted'), false)
}
const deadVisitStrikesNothing = async (WM, ended = BB.connEnded) => {
  const k = '5,69,0', cut = { at: [5, 69, 0] }
  const visit = (store, bot) => {   // skills.mjs waterWalkVisit's lines: the filter before the visit, the note after it
    const mem = (PM.procMemOf(store, bot).bw3Given ??= new Map())
    const mine = [cut].filter(q => !T.tidyGivenUp(mem, q.at.join(',')))
    T.tidyNoteCuts(mem, WM.bw3Strikes(mine.map(q => q.at.join(',')), { ended: ended(bot) }), () => true)   // evaluated, still standing
    return mine.length
  }
  for (const client of DEAD) {
    const store = new Map()
    for (let i = 0; i < T.TIDY_CUT_TRIES + 2; i++) assert.strictEqual(visit(store, { username: 'Onyx', _client: { ...client } }), 1)
    assert.strictEqual(PM.procMemOf(store, { username: 'Onyx' }).bw3Given.size, 0, 'no strike counted')
    assert.strictEqual(visit(store, { username: 'Onyx', _client: LIVE() }), 1, 'the next connection still tries the cut')
  }
  // POSITIVE CONTROL: live visits strike it out
  const store = new Map()
  for (let i = 0; i < T.TIDY_CUT_TRIES; i++) assert.strictEqual(visit(store, { username: 'Onyx', _client: LIVE() }), 1)
  assert.strictEqual(PM.procMemOf(store, { username: 'Onyx' }).bw3Given.get(k), T.TIDY_CUT_TRIES)
  assert.strictEqual(visit(store, { username: 'Onyx', _client: LIVE() }), 0, 'given up')
  assert.deepStrictEqual(WM.bw3Strikes(undefined), []); assert.deepStrictEqual(WM.bw3Strikes(['a', 'b']), ['a', 'b']); assert.deepStrictEqual(WM.bw3Strikes(['a'], { ended: true }), [])
}
/** r2 BLOCKER A: the water visit's own lines with the visit's predicate (skills.mjs: `bw3Strikes(r.tidied, { ended: visitGone(bot, signal) })`). */
const cancelledStrikesNothing = async BM => {
  const k = '5,69,0', cut = { at: [5, 69, 0] }
  const visit = (store, bot, signal) => {
    const mem = (PM.procMemOf(store, bot).bw3Given ??= new Map())
    const mine = [cut].filter(q => !T.tidyGivenUp(mem, q.at.join(',')))
    const r = { stop: signal?.aborted ? 'aborted' : 'complete', tidied: mine.map(q => q.at.join(',')) }   // runVisit RETURNS, its tidied list populated
    T.tidyNoteCuts(mem, W.bw3Strikes(r.tidied, { ended: BM.visitGone(bot, signal) }), () => true)
    return mine.length
  }
  const live = () => ({ username: 'Onyx', _client: SHAPE.healthy() })
  // a HEALTHY connection, the skill cancelled (a reflex, the watchdog), cuts evaluated and still standing: no strike, however often
  const store = new Map()
  for (let i = 0; i < T.TIDY_CUT_TRIES + 3; i++) visit(store, live(), { aborted: true })
  assert.strictEqual(PM.procMemOf(store, live()).bw3Given.size, 0, 'no strike from a cancelled visit')
  assert.strictEqual(visit(store, live(), { aborted: true }), 1, 'the cut is still tried')
  // POSITIVE CONTROL: live and NOT aborted -- each visit is a strike, the cut is given up at TIDY_CUT_TRIES
  for (let i = 0; i < T.TIDY_CUT_TRIES; i++) assert.strictEqual(visit(store, live(), { aborted: false }), 1)
  assert.strictEqual(PM.procMemOf(store, live()).bw3Given.get(k), T.TIDY_CUT_TRIES); assert.strictEqual(visit(store, live(), null), 0, 'given up')
  // the predicate: either reason alone; neither: not gone; no signal at all: the connection decides
  assert.strictEqual(BM.visitGone(live(), { aborted: true }), true); assert.strictEqual(BM.visitGone(live(), { aborted: false }), false)
  assert.strictEqual(BM.visitGone(live(), null), false); assert.strictEqual(BM.visitGone(live(), undefined), false)
  for (const c of DEAD) { assert.strictEqual(BM.visitGone({ _client: c }, { aborted: false }), true, JSON.stringify(c)); assert.strictEqual(BM.visitGone({ _client: c }, null), true) }
  assert.strictEqual(BM.visitGone({}, { aborted: true }), true, 'a bot with no client, aborted')
  // ...and the forest's bookings take the same predicate: an aborted felling on a healthy connection books nothing
  const fs2 = new Map()
  assert.deepStrictEqual(fellPass(F, b => BM.visitGone(b, { aborted: true }), fs2, live(), TREE, { n: 0, why: 'off_stand' }).nf, { counted: false, keep: false })
  assert.strictEqual(F.forestRestDue('no_effect', 'aborted', { ended: BM.visitGone(live(), { aborted: true }) }), false)
}
await t(NAMES.cancelled, () => cancelledStrikesNothing(BB))
await t(`MUTANT, visitGone blind to the skill's signal (the connection only): fails "${NAMES.cancelled}"`, async () => {
  await withMutants(BOT_URL, [['export const visitGone = (bot, signal) => !!signal?.aborted || connEnded(bot)\n', 'export const visitGone = (bot, signal) => connEnded(bot)\n']], async M => {
    assert.strictEqual(M.visitGone({ _client: SHAPE.healthy() }, { aborted: true }), false, 'the mutant survived')
    let msg = null
    try { await cancelledStrikesNothing(M) } catch (e) { msg = e.message }
    assert.ok(/no strike from a cancelled visit/.test(msg ?? ''), `killed by the named assertion (${msg})`)
  })
})
await t(`MUTANT, visitGone blind to the connection (the signal only): fails "${NAMES.cancelled}"`, async () => {
  await withMutants(BOT_URL, [['export const visitGone = (bot, signal) => !!signal?.aborted || connEnded(bot)\n', 'export const visitGone = (bot, signal) => !!signal?.aborted\n']], async M => {
    let msg = null
    try { await cancelledStrikesNothing(M) } catch (e) { msg = e.message }
    assert.ok(/"ended":true|destroyed|writableEnded/.test(msg ?? ''), `killed on a dead connection's shape (${msg})`)
  })
})
await t(NAMES.deadFell, () => deadFellBooksNothing(F))
await t(NAMES.deadRest, () => deadVisitRestsNothing(F))
await t(NAMES.deadCuts, () => deadVisitStrikesNothing(W))
await t('r1 ONE notion of "ended": skills.mjs clientEnded IS buildbot.mjs connEnded (and reads a destroyed socket)', () => {
  assert.strictEqual(SKM.clientEnded, BB.connEnded)
  assert.strictEqual(SKM.clientEnded({ _client: { ended: false, socket: { destroyed: true } } }), true); assert.strictEqual(SKM.clientEnded({ _client: { ended: false } }), false)
})
const expectKilled = async (scenario, what) => { let killed = false; try { await scenario() } catch { killed = true } assert.ok(killed, `the mutant survived ${what}`) }
await t(`MUTANT, fellFailNote books a result from an ended connection: fails "${NAMES.deadFell}"`, async () => {
  await withMutants(FOREST_URL, [['  if (!mem || !r?.why || ended) return { counted: false, keep: false }\n', '  if (!mem || !r?.why) return { counted: false, keep: false }\n']], async M => {
    // the defect itself: failMax zombie results waive the tree
    const store = new Map()
    let waived = 0
    for (let i = 0; i < M.FOREST.failMax; i++) waived += fellPass(M, BB.connEnded, store, { username: 'Onyx', _client: { ended: true } }, TREE, { n: 0, why: 'off_stand' }).waives.length
    assert.strictEqual(waived, 1, 'the mutant does not reproduce the defect')
    await expectKilled(() => deadFellBooksNothing(M), 'the named test')
  })
})
await t(`MUTANT, the caller's predicate blind to a destroyed socket (the narrow \`ended\` only): fails "${NAMES.deadFell}" and "${NAMES.deadCuts}"`, async () => {
  const narrow = b => b?._client?.ended === true
  await expectKilled(() => deadFellBooksNothing(F, narrow), NAMES.deadFell)
  await expectKilled(() => deadVisitStrikesNothing(W, narrow), NAMES.deadCuts)
  await expectKilled(() => deadVisitRestsNothing(F, narrow), NAMES.deadRest)
})
await t(`MUTANT, forestRestDue ignores \`ended\`: fails "${NAMES.deadRest}"`, async () => {
  await withMutants(FOREST_URL, [["=> !ended && status === 'no_effect' && ", "=> status === 'no_effect' && "]], async M => {
    assert.strictEqual(M.forestRestDue('no_effect', 'aborted', { ended: true }), true, 'the mutant does not reproduce the defect')
    await expectKilled(() => deadVisitRestsNothing(M), 'the named test')
  })
})
await t(`MUTANT, bw3Strikes ignores \`ended\`: fails "${NAMES.deadCuts}"`, async () => {
  await withMutants(BW_URL, [['=> (ended ? [] : [...(tidied ?? [])])', '=> [...(tidied ?? [])]']], async M => {
    assert.deepStrictEqual(M.bw3Strikes(['a'], { ended: true }), ['a'], 'the mutant does not reproduce the defect')
    await expectKilled(() => deadVisitStrikesNothing(M), 'the named test')
  })
})
/** THE WIRING (what behaviour cannot reach from here: buildForest and waterWalkVisit need a whole bot). Throws on a miss. */
const wiring = raw => {
  const code = strip(raw)
  const one = (hay, needle, what) => assert.strictEqual(hay.split(needle).length, 2, what)
  const a = code.indexOf('async function buildForest ('), z = code.indexOf('const FOREST_NOSITE_MS')
  assert.ok(a > 0 && z > a, 'buildForest found')
  const fb = code.slice(a, z)
  one(fb, '  const gone = () => visitGone(bot, signal)\n', 'the one predicate: aborted, or the connection ended')
  // both felling loops: the visit stops BEFORE the next fell, and books the result through fellFailNote with `ended: gone()`
  assert.strictEqual(fb.split('await forestFell(').length, 3, 'two felling loops')
  for (const head of ['for (const t of rt.plan.trees) {', 'for (const t of hl.trees) {']) {
    const i = fb.indexOf(head), j = fb.indexOf('await forestFell(', i), k = fb.indexOf('fellFailNote(', j)
    assert.ok(i > 0 && j > i && k > j, head)
    one(fb.slice(i, j), '            if (gone()) break\n', `${head} stops before the fell`)
    assert.ok(fb.slice(k, k + 60).startsWith('fellFailNote(procMem(bot), t, r, { ended: gone(), '), `${head} books with ended: gone()`)
    assert.ok(!fb.slice(j, k).includes('forestSkip') && !fb.slice(j, k).includes('rowLog('), `${head}: nothing booked or logged before the note`)
  }
  assert.strictEqual(fb.split('const nf = fellFailNote(').length, 3)
  assert.strictEqual(fb.split('            if (nf.counted) {\n').length, 3, 'the failure row only for a counted failure')
  // every waive of a tree that failed is under the note's `keep`; the loops book nothing themselves
  assert.strictEqual(fb.split('[t.key]: { why: String(r.why).slice(0, 40), at: Date.now(), by: me }').length, 3, 'two waive publishes')
  assert.strictEqual(fb.split('              if (nf.keep) {\n                const pub = publishRecord(').length, 3, 'both under nf.keep')
  assert.ok(!fb.includes('keepDue(') && !code.includes('.forestFails'), 'no failure count outside fellFailNote')
  one(code, '.forestSkip', 'forestSkip is only READ here (forestSkipOf); fellFailNote writes it')
  one(fb, '            } else if (!r.why) {\n              hv.trees++\n', 'a tree is counted felled only when it was')
  // the rest: one write, through forestRestDue with the same predicate
  one(code, '.forestIdleUntil = ', 'one write of the rest')
  one(fb, '    if (forestRestDue(status, outcome, { ended: gone() })) procMem(bot).forestIdleUntil = Date.now() + FOREST.idleMs\n', 'the rest asks forestRestDue')
  // the water visit's strikes
  const wv = code.slice(code.indexOf('async function waterWalkVisit ('), code.indexOf('function tidyGuardSet ('))
  assert.ok(wv.length > 1000)
  assert.strictEqual(wv.split('tidyNoteCuts(').length, 2, 'one note in the water visit')
  one(wv, '    tidyNoteCuts(mem, bw3Strikes(r.tidied, { ended: visitGone(bot, signal) }), k => {', 'the strikes go through bw3Strikes with the visit\'s predicate (aborted or ended)')
  one(code, 'export const clientEnded = connEnded\n', 'one definition of ended')
  one(code, "import { connEnded, visitGone } from './buildbot.mjs'", 'the predicates are buildbot.mjs\'s')
  // r2: the keeper's two clocks are never stamped by a visit on an ended connection (and still BEFORE the visit on a live one)
  one(code, '.bw3At = ', 'one stamp of the water clock'); one(code, '.gkCountryAt = ', 'one stamp of the country clock')
  one(code, "  if (role === 'keeper' && bw3Due(procMem(bot))) {\n    if (!clientEnded(bot)) procMem(bot).bw3At = Date.now()\n    const ww = await waterWalkVisit(", 'the water clock: stamped before the visit, never on an ended connection')
  one(code, "        if (role === 'keeper' && !clientEnded(bot)) procMem(bot).gkCountryAt = Date.now()\n", 'the country clock: never on an ended connection')
}
await t(NAMES.wiring, () => wiring(SK_RAW))
// each mutant with the assertion that must kill it (its message), so a mutant killed by something else reads as a failure
const WIRE_MUTANTS = [
  ['the predicate without the ended connection', '  const gone = () => visitGone(bot, signal)\n', '  const gone = () => !!signal?.aborted\n', /the one predicate: aborted, or the connection ended/],
  ['the retire loop fells on', '            if (Date.now() > deadline - 30_000 || felledAll >= FOREST.harvestMax * 8) break\n            if (gone()) break   // keeperstall-01 r1\n', '            if (Date.now() > deadline - 30_000 || felledAll >= FOREST.harvestMax * 8) break\n', /for \(const t of rt\.plan\.trees\) \{ stops before the fell/],
  ['the harvest loop fells on', '            if (Date.now() > deadline - 40_000) break\n            if (gone()) break   // keeperstall-01 r1\n', '            if (Date.now() > deadline - 40_000) break\n', /for \(const t of hl\.trees\) \{ stops before the fell/],
  ['the retire loop books whatever came back', '{ ended: gone(), noStand: !t.stand, skipMs: FOREST_SKIP_MS }', '{ noStand: !t.stand, skipMs: FOREST_SKIP_MS }', /for \(const t of rt\.plan\.trees\) \{ books with ended: gone\(\)/],
  ['the harvest loop books whatever came back', 'fellFailNote(procMem(bot), t, r, { ended: gone(), skipMs: FOREST_SKIP_MS })', 'fellFailNote(procMem(bot), t, r, { skipMs: FOREST_SKIP_MS })', /for \(const t of hl\.trees\) \{ books with ended: gone\(\)/],
  ['a waive outside the note\'s keep', '              if (nf.keep) {\n                const pub = publishRecord(dir, key, ', '              if (true) {\n                const pub = publishRecord(dir, key, ', /both under nf\.keep/],
  ['the rest set whatever the connection', 'if (forestRestDue(status, outcome, { ended: gone() })) procMem(bot).forestIdleUntil', 'if (forestRestDue(status, outcome)) procMem(bot).forestIdleUntil', /the rest asks forestRestDue/],
  ['the strikes counted whatever the connection', 'tidyNoteCuts(mem, bw3Strikes(r.tidied, { ended: visitGone(bot, signal) }), k => {', 'tidyNoteCuts(mem, r.tidied ?? [], k => {', /the strikes go through bw3Strikes/],
  ['r2 A: the strikes blind to a cancelled visit (the connection only)', '{ ended: visitGone(bot, signal) }), k => {', '{ ended: clientEnded(bot) }), k => {', /the strikes go through bw3Strikes with the visit's predicate/],
  ['two notions of ended again', 'export const clientEnded = connEnded\n', 'export const clientEnded = bot => bot?._client?.ended === true\n', /one definition of ended/],
  ['r2: the water clock stamped on an ended connection', '    if (!clientEnded(bot)) procMem(bot).bw3At = Date.now()', '    procMem(bot).bw3At = Date.now()', /the water clock: stamped before the visit, never on an ended connection/],
  ['r2: the water clock stamped AFTER the visit', "    if (!clientEnded(bot)) procMem(bot).bw3At = Date.now()   // keeperstall-01 r2: a visit on an ended connection never makes the next one wait\n    const ww = await waterWalkVisit(ctx, signal, { deadline: t0 + budget - ZIG_VISIT_TAIL_MS })\n", "    const ww = await waterWalkVisit(ctx, signal, { deadline: t0 + budget - ZIG_VISIT_TAIL_MS })\n    if (!clientEnded(bot)) procMem(bot).bw3At = Date.now()\n", /the water clock: stamped before the visit/],
  ['r2: the country clock stamped on an ended connection', "if (role === 'keeper' && !clientEnded(bot)) procMem(bot).gkCountryAt = Date.now()", "if (role === 'keeper') procMem(bot).gkCountryAt = Date.now()", /the country clock: never on an ended connection/],
]
for (const [what, old, neu, killer] of WIRE_MUTANTS) {
  await t(`MUTANT, ${what}: fails "${NAMES.wiring}"`, () => {
    const m = mutantText(SKILLS_URL, [[old, neu]])
    assert.throws(() => wiring(m), e => e instanceof assert.AssertionError && killer.test(e.message))
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
