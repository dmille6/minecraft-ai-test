// PROJTURN-01 (bots/src/projturn.mjs; shop.mjs activeProject / buildOrder; skills.mjs shopActive / buildShop / buildShopVisit;
// buildproj.mjs turnRead / turnWrite). LIVE showcase, 14 bots, three days to 11-15: the step well -- open, workable, late in the
// PROJECTS order -- had ZERO build visits in 42 hours; in the last 6 h 143 build visits placed 41 blocks; one bot's stuck stop held it
// off every project for 6 h.
//
// 1. the pure rules at their boundaries (the classifier, the schedule, the count and its reset, the bot's own hold, the marks, the
//    aged choice, the order's two readings), each negative with its positive control;
// 2. THE CHAIN, as a deterministic 14-bot simulation over the REAL activeProject / buildOrder / stuckBackoff / waitBackoff / idleMarks /
//    repairBackoff and the turns' pure functions (a fake clock, no randomness: the jitter is a hash of the bot's name): a town shaped
//    like the live one. PROJTURN off is the positive control -- the simulation reproduces the starvation it is there to show;
// 3. the files (one per holder, merged);
// 4. the glue on real record, stuck and turn files through skills.mjs shopActive and the order's hooks;
// and anchored mutants for the hold's scope, the reset, the cap, the aging comparison, the stamp's precedence and the switch.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-projturn-logs-'))
process.env.BOT_NAME = 'ProjTurnBot'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
// a named pool that is not the showcase: the workshop, the house, the ziggurat, the paths and the wall -- two open projects, no more
process.env.MEMORY_POOL = 'projturn'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-projturn-pool-'))
for (const k of ['PROJTURN', 'MONUMENT', 'MONUMENT_POOLS', 'HOUSE', 'PATHS', 'PATHS_POOLS', 'WALL', 'WALL_POOLS', 'SHOP_COOLDOWN_MS', 'ENCHANT_NOWAIT']) delete process.env[k]
process.env.SHAFT = 'off'; process.env.TIDY = 'off'; process.env.UPKEEP = 'off'

const PT = await import('../src/projturn.mjs')
const S = await import('../src/shop.mjs')
const PJ = await import('../src/buildproj.mjs')
const G2 = await import('../src/grounds2.mjs')

let pass = 0, fail = 0
const FAILED = []   // said again at the end: the runner shows only the tail of a failing file's output
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; const m = `  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 8).join('\n        ')}`; FAILED.push(m); console.log(m) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const SRC = f => new URL(`../src/${f}`, import.meta.url)
/** Every anchor present and unique, or the test fails (a mutant that did not apply is not "killed"). */
function mutantSource (file, pairs) {
  let src = fs.readFileSync(SRC(file), 'utf8')
  for (const [old, neu] of pairs) {
    assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${JSON.stringify(old.slice(0, 70))}`)
    src = src.replace(old, neu)
  }
  return src.replace(/from '\.\//g, "from '../src/")
}
async function withCopy (file, pairs, fn) {
  const out = new URL(`./_mutant-projturn-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, mutantSource(file, pairs))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const TURN_IMPORT = "from './projturn.mjs'   // projturn-01: the projects take turns"
/** A copy of projturn.mjs (mutated by `ptPairs`) and a copy of shop.mjs (mutated by `shopPairs`) wired to it: its own hooks, its own state. */
async function withTurn (ptPairs, shopPairs, fn) {
  const out = new URL(`./_mutant-projturn-pt-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, mutantSource('projturn.mjs', ptPairs))
  try {
    const PTm = await import(out.href)
    return await withCopy('shop.mjs', [[TURN_IMPORT, `from '../test/${path.basename(out.pathname)}'   // projturn-01: the projects take turns`], ...shopPairs], Sm => fn(Sm, PTm))
  } finally { try { fs.unlinkSync(out) } catch {} }
}
/** `scenario(Sm, PTm)` passes on the unmutated copies and FAILS (an assertion, not a crash) on the mutant. */
async function killed (ptPairs, shopPairs, scenario) {
  await withTurn([], [], scenario)
  let why = null
  await withTurn(ptPairs, shopPairs, async (Sm, PTm) => { try { await scenario(Sm, PTm) } catch (e) { why = e } })
  assert.ok(why instanceof assert.AssertionError, `MUTANT survived or died for another reason: ${String(why?.stack ?? 'survived').split('\n')[0]}`)
}

const MIN = 60_000, H = 60 * MIN
const NOW = 1_800_000_000_000
// the mutants' anchors in projturn.mjs (each present and unique: mutantSource)
const RESET = "  if (outcome === 'progress') return { ...base, n: 0, noAt: null, rn: 0, rnoAt: null, okAt: now, gen: gen ?? null, stop: null }\n"
const REPAIR = '    const repair = done && st.damaged === true && st.broken === true\n'
const SERVICE = '    if (service != null && service === st.plot) return seen\n'
const LEASED = '    if (!blocked && Math.floor(Number(c?.n) || 0) > 0 && Number.isFinite(c?.noAt)) { try { blocked = leased(st.plot) === true } catch { blocked = false } }\n'
const CLAIM = 'export const turnClaimNeeded = e => '

// ================================================================================================================================
// 1. THE PURE RULES
// ================================================================================================================================
await t('the switch: on by default; off|0|false|no (any case, padded) is off; anything else is on', () => {
  assert.equal(PT.projTurnOn({}), true)
  for (const v of ['off', '0', 'false', 'no', 'OFF', ' No ']) assert.equal(PT.projTurnOn({ PROJTURN: v }), false, v)
  for (const v of ['on', '1', 'true', 'yes', '', 'offf']) assert.equal(PT.projTurnOn({ PROJTURN: v }), true, v)
  assert.equal(S.PROJTURN.on, true, 'this file runs with the switch unset')
})

await t('turnOutcome: every no-progress stop of the brief; progress by status or by a count; an abort and a visit that did not happen are no evidence', () => {
  const no = (stop, o = {}) => ({ status: 'no_effect', stop, ...o })
  for (const stop of ['stuck_on_cell', 'cell_deferred', 'no_site', 'site_wait', 'complete', 'blocked', 'no_material', 'waterwalk', 'upkeep', 'no_tool', 'deadline', 'copper_wait', 'paths_no_site'])
    assert.equal(PT.turnOutcome(no(stop)), 'no_progress', stop)
  // progress: the visit's own status, or any of the three counts (the generic visit's status counts only `placed`)
  assert.equal(PT.turnOutcome({ status: 'success', stop: 'cell_deferred', placed: 3 }), 'progress')
  assert.equal(PT.turnOutcome({ status: 'success', stop: 'upkeep' }), 'progress', 'an upkeep that did real work')
  assert.equal(PT.turnOutcome(no('cell_deferred', { placed: 1 })), 'progress')
  assert.equal(PT.turnOutcome(no('waterwalk', { cleared: 2 })), 'progress')
  assert.equal(PT.turnOutcome(no('complete', { planted: 1 })), 'progress')
  assert.equal(PT.turnOutcome(no('waterwalk', { cleared: 0, planted: 0, placed: 0 })), 'no_progress', 'control: the same stop with nothing done')
  // no evidence
  assert.equal(PT.turnOutcome({ status: 'aborted', stop: 'aborted' }), 'none')
  assert.equal(PT.turnOutcome({ status: 'aborted', stop: 'stuck_on_cell' }), 'none', 'an interruption is not evidence, whatever it was doing')
  assert.equal(PT.turnOutcome({ status: 'no_effect', stop: 'aborted' }), 'none')
  assert.equal(PT.turnOutcome({ status: 'failed', stop: 'error', failClass: 'other' }), 'none', 'a failed visit is the runner\'s to see')
  for (const stop of [...S.IDLE_NOT_A_VISIT, 'lost_lease', 'site_unread', 'grounds_turn', 'grounds_none', 'keeper_held', 'leaf_decay', 'zone_closed', 'replanned', 'fence:slot'])
    assert.equal(PT.turnOutcome(no(stop)), 'none', stop)
  for (const r of [null, undefined, 'x', 7]) assert.equal(PT.turnOutcome(r), 'none')
  // a visit during which the record moved (a siting, a waiver, a phase published) is never counted against the project
  assert.equal(PT.turnOutcome(no('no_site'), { moved: true }), 'none')
  assert.equal(PT.turnOutcome(no('no_site'), { moved: false }), 'no_progress', 'control')
  assert.equal(PT.turnOutcome({ status: 'success', stop: 'deadline', placed: 2 }, { moved: true }), 'progress')
  // the list stays in step with the visits that did not happen (shop.mjs IDLE_NOT_A_VISIT) and never names a stop of the brief
  for (const stop of S.IDLE_NOT_A_VISIT) assert.ok(PT.TURN_NO_EVIDENCE.includes(stop), stop)
  for (const stop of ['stuck_on_cell', 'cell_deferred', 'no_site', 'site_wait', 'complete', 'blocked', 'no_material', 'waterwalk']) assert.ok(!PT.TURN_NO_EVIDENCE.includes(stop), stop)
})

await t('the schedule: 20, 40, 80 ... minutes, capped (6 h; the project\'s stuck window where shorter; an hour for a complete record); none without a count', () => {
  const T = PT.TURN
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 30, 500].map(n => PT.turnBackoffMs(n) / MIN), [20, 40, 80, 160, 320, 360, 360, 360, 360])
  for (const n of [0, -1, null, undefined, NaN, 'x']) assert.equal(PT.turnBackoffMs(n), 0, String(n))
  assert.equal(PT.turnCap({}), T.capMs)
  assert.equal(PT.turnCap({ complete: true }), T.capDoneMs)
  assert.equal(PT.turnCap({ stuckMs: S.stuckWindowOf('shaft') }), 30 * MIN, 'the stair\'s 30 min')
  assert.equal(PT.turnCap({ stuckMs: S.stuckWindowOf('storehouse'), complete: true }), 30 * MIN)
  assert.equal(PT.turnCap({ stuckMs: S.stuckWindowOf('monument') }), T.capMs)
  assert.deepEqual([1, 2, 3, 9].map(n => PT.turnBackoffMs(n, { cap: PT.turnCap({ complete: true }) }) / MIN), [20, 40, 60, 60])
  assert.deepEqual([1, 2, 9].map(n => PT.turnBackoffMs(n, { cap: 30 * MIN }) / MIN), [20, 30, 30])
})

await t('the jitter: the same for one bot at every asking, inside [0, 1), different across fourteen bots; turnUntil is never before the base and never past base x 1.25', () => {
  const names = Array.from({ length: 14 }, (_, i) => `showcase-Bot${i}`)
  for (const n of [1, 3, 6]) {
    const js = names.map(me => PT.turnJitter(me, 'monument', n))
    for (const j of js) assert.ok(j >= 0 && j < 1, String(j))
    assert.deepEqual(js, names.map(me => PT.turnJitter(me, 'monument', n)), 'deterministic')
    assert.equal(new Set(js.map(j => Math.round(j * 1e6))).size, 14, 'fourteen bots, fourteen shares')
    const base = PT.turnBackoffMs(n)
    const untils = names.map(me => PT.turnUntil({ n, noAt: NOW }, { me, plot: 'monument' }))
    for (const u of untils) assert.ok(u >= NOW + base && u < NOW + base * (1 + PT.TURN.jitter) + 1, `${(u - NOW) / MIN} min for n=${n}`)
    // fourteen bots do not come back in the same minute
    assert.ok(new Set(untils.map(u => Math.floor(u / MIN))).size >= (n === 1 ? 4 : 10), `spread over ${new Set(untils.map(u => Math.floor(u / MIN))).size} different minutes at n=${n}`)
  }
  assert.equal(PT.turnUntil({ n: 0, noAt: NOW }, { me: 'a', plot: 'p' }), 0)
  assert.equal(PT.turnUntil({ n: 2, noAt: null }, { me: 'a', plot: 'p' }), 0)
  assert.equal(PT.turnUntil(null, { me: 'a', plot: 'p' }), 0)
  // the cap is the project's
  assert.ok(PT.turnUntil({ n: 9, noAt: NOW }, { me: 'a', plot: 'paths', cap: PT.TURN.capDoneMs }) < NOW + PT.TURN.capDoneMs * 1.25 + 1)
})

await t('the count: each holder\'s no-progress visit adds one for the pool; ONE progress by anyone ends everybody\'s; a published generation ends it; an abort changes nothing', () => {
  const files = new Map()
  const view = (now, genOf = null) => PT.turnView([...files].map(([holder, plots]) => ({ holder, plots })), { now, genOf })
  const visit = (holder, oc, now, gen = 4) => { const own = files.get(holder)?.wall ?? null; const e = PT.turnAfter(PT.turnStart(own, now - 1000), view(now).get('wall') ?? null, oc, { now, stop: 'stuck_on_cell', gen }); files.set(holder, { wall: e }) }
  visit('A', 'no_progress', NOW)
  assert.deepEqual(view(NOW).get('wall'), { at: NOW - 1000, okAt: null, n: 1, noAt: NOW, rn: 0, rnoAt: null, stop: 'stuck_on_cell' })
  visit('B', 'no_progress', NOW + 30 * MIN)
  visit('A', 'no_progress', NOW + 80 * MIN)
  assert.equal(view(NOW + 80 * MIN).get('wall').n, 3, 'A twice, B once')
  assert.equal(view(NOW + 80 * MIN).get('wall').noAt, NOW + 80 * MIN)
  // an abort: the start is stamped (the aging), the count is as it was
  const a0 = files.get('C')?.wall ?? null
  files.set('C', { wall: PT.turnAfter(PT.turnStart(a0, NOW + 90 * MIN), view(NOW + 90 * MIN).get('wall'), 'none', { now: NOW + 91 * MIN }) })
  assert.equal(view(NOW + 91 * MIN).get('wall').n, 3)
  assert.equal(view(NOW + 91 * MIN).get('wall').at, NOW + 90 * MIN, 'the aborted visit still took its turn')
  // a generation published since: the count no longer stands (control: the same files on the generation they were taken on)
  assert.equal(view(NOW + 92 * MIN, () => 4).get('wall').n, 3)
  assert.equal(view(NOW + 92 * MIN, () => 5).get('wall').n, 0)
  assert.equal(view(NOW + 92 * MIN, () => null).get('wall').n, 0)
  // progress by a third bot ends it for all
  visit('C', 'progress', NOW + 100 * MIN)
  const v = view(NOW + 100 * MIN, () => 4).get('wall')
  assert.deepEqual([v.n, v.noAt, v.okAt], [0, null, NOW + 100 * MIN])
  // ...and the next no-progress starts at one, not at four (A's own old count is not carried over the reset)
  visit('A', 'no_progress', NOW + 130 * MIN)
  assert.equal(view(NOW + 130 * MIN, () => 4).get('wall').n, 1)
  assert.equal(files.get('A').wall.n, 1)
  // a stamp from a bad clock (more than a minute ahead) is dropped before anything is taken
  files.set('D', { wall: { at: NOW + 10 * H, n: 5, noAt: NOW + 10 * H, okAt: NOW + 10 * H, gen: 4, stop: 'x' } })
  const w = view(NOW + 131 * MIN, () => 4).get('wall')
  assert.deepEqual([w.n, w.noAt, w.okAt], [1, NOW + 130 * MIN, NOW + 100 * MIN])
  assert.equal(PT.turnView([], { now: NOW }).size, 0)
  assert.equal(PT.turnView(null, { now: NOW }).size, 0)
})

await t('MUTANT (the reset): a progress visit that does not end the count leaves the project backed off', async () => {
  await killed([[RESET, '  if (outcome === \'progress\') return own ?? null\n']], [], (Sm, PTm) => {
    const a = PTm.turnAfter(null, null, 'no_progress', { now: NOW, stop: 'stuck_on_cell', gen: 1 })
    const b = PTm.turnAfter(null, null, 'progress', { now: NOW + MIN, gen: 1 })
    assert.equal(PTm.turnView([{ holder: 'A', plots: { wall: a } }, { holder: 'B', plots: { wall: b } }], { now: NOW + 2 * MIN }).get('wall').n, 0)
    assert.equal(PTm.turnView([{ holder: 'A', plots: { wall: a } }], { now: NOW + 2 * MIN }).get('wall').n, 1, 'control: without the progress it stands')
  })
})
await t('MUTANT (the cap): a back-off that is not capped grows past 6 h', async () => {
  await killed([['  return Math.min(Math.max(0, Number(cap) || 0), T.baseMs * 2 ** Math.min(k - 1, 30))\n', '  return T.baseMs * 2 ** Math.min(k - 1, 30)\n']], [], (Sm, PTm) => {
    assert.equal(PTm.turnBackoffMs(3), 80 * MIN, 'control: below the cap the schedule is the same')
    assert.equal(PTm.turnBackoffMs(9), 6 * H)
  })
})

await t('the bot\'s own hold: stuck_on_cell holds that project 6 h, no_site a day; any other stop, an unknown plot or a bad clock holds nothing', () => {
  const o = { stuckMs: S.SHOP_STUCK_RETRY_MS, siteMs: S.SHOP_SITE_RETRY_MS }
  assert.deepEqual(PT.turnHold({ plot: 'civicM', stop: 'stuck_on_cell', at: NOW }, NOW + 6 * H - 1, o), { plot: 'civicM', stop: 'stuck_on_cell' })
  assert.equal(PT.turnHold({ plot: 'civicM', stop: 'stuck_on_cell', at: NOW }, NOW + 6 * H, o), null)
  assert.deepEqual(PT.turnHold({ plot: 'pens', stop: 'no_site', at: NOW }, NOW + 24 * H - 1, o), { plot: 'pens', stop: 'no_site' })
  assert.equal(PT.turnHold({ plot: 'pens', stop: 'no_site', at: NOW }, NOW + 24 * H, o), null)
  for (const stop of ['cell_deferred', 'complete', 'aborted', 'grounds_turn', '', undefined]) assert.equal(PT.turnHold({ plot: 'civicM', stop, at: NOW }, NOW + 1, o), null, String(stop))
  assert.equal(PT.turnHold({ plot: null, stop: 'stuck_on_cell', at: NOW }, NOW + 1, o), null)
  assert.equal(PT.turnHold({ plot: 'civicM', stop: 'stuck_on_cell', at: NOW + 5 * MIN }, NOW, o), null, 'a stamp from the future')
  assert.equal(PT.turnHold(null, NOW, o), null)
})

const st = (plot, o = {}) => ({ plot, exists: true, complete: false, damaged: false, ...o })
const tu = (plot, o = {}) => st(plot, { turn: true, ...o })   // a state with the turns' mark (turnBackoff sets it on every project that takes turns)
await t('turnBackoff: the marks -- `turn` and visitAt for the aging; an open project backed off is not free, a complete one is quiet; the bot\'s held project steps aside; exempt plots pass through untouched', () => {
  const view = new Map([
    ['monument', { at: NOW - 5 * MIN, okAt: null, n: 1, noAt: NOW - 5 * MIN, stop: 'stuck_on_cell' }],
    ['wall', { at: NOW - 50 * MIN, okAt: NOW - 50 * MIN, n: 0, noAt: null, stop: null }],
    ['paths', { at: NOW - 10 * MIN, okAt: null, n: 3, noAt: NOW - 10 * MIN, stop: 'complete' }],
    ['tidy', { at: NOW - 1 * MIN, okAt: null, n: 9, noAt: NOW - 1 * MIN, stop: 'stuck_on_cell' }],
    ['road', { at: NOW - 1 * MIN, okAt: null, n: 9, noAt: NOW - 1 * MIN, stop: 'no_site' }],
    ['upkeep', { at: NOW - 1 * MIN, okAt: null, n: 9, noAt: NOW - 1 * MIN, stop: 'upkeep' }],
  ])
  const states = [st('monument'), st('wall'), st('paths', { complete: true, damaged: true, due: true, dueFirst: true }), st('tidy'), st('road'), st('upkeep', { complete: true, due: true }), st('pens', { exists: false })]
  const out = PT.turnBackoff(states, view, { me: 'A', now: NOW, exempt: S.turnExempt, capOf: S.stuckWindowOf })
  assert.deepEqual(out[0], { ...states[0], turn: true, visitAt: NOW - 5 * MIN, free: false, backoff: true })
  assert.deepEqual(out[1], { ...states[1], turn: true, visitAt: NOW - 50 * MIN }, 'visited, not backed off: only the age')
  assert.deepEqual(out[2], { ...states[2], turn: true, visitAt: NOW - 10 * MIN, damaged: false, due: false, dueFirst: false, backoff: true }, 'a complete record backed off is quiet: no repair, no upkeep')
  assert.equal(out[3], states[3], 'the tidy takes no turn and no back-off')
  assert.equal(out[4], states[4], 'nor a sink')
  assert.equal(out[5], states[5], 'nor the upkeep plot')
  assert.deepEqual(out[6], { ...states[6], turn: true }, 'never visited: it takes turns, no age yet')
  // the pick this bot already has is marked on its state alone
  assert.deepEqual(PT.turnBackoff([st('monument'), st('wall')], new Map(), { me: 'A', now: NOW, pin: 'wall' }).map(x => x.pin), [undefined, true])
  // the windows end: monument's first back-off is 20-25 min, the complete paths' third is 60-75 min
  assert.equal(PT.turnBackoff(states, view, { me: 'A', now: NOW + 21 * MIN, exempt: S.turnExempt, capOf: S.stuckWindowOf })[0].backoff, undefined)
  assert.equal(PT.turnBackoff(states, view, { me: 'A', now: NOW + 45 * MIN, exempt: S.turnExempt, capOf: S.stuckWindowOf })[2].backoff, true)
  assert.equal(PT.turnBackoff(states, view, { me: 'A', now: NOW + 66 * MIN, exempt: S.turnExempt, capOf: S.stuckWindowOf })[2].backoff, undefined, 'an hour is the cap for a complete record')
  // an unsited project is backed off too (no_site)
  const v2 = new Map([['pens', { at: NOW, okAt: null, n: 2, noAt: NOW, stop: 'no_site' }]])
  assert.deepEqual(PT.turnBackoff([st('pens', { exists: false })], v2, { me: 'A', now: NOW + MIN })[0], { ...st('pens', { exists: false }), turn: true, visitAt: NOW, free: false, backoff: true })
  // the bot's own hold: the stamp's shape, for this bot (the next project first; never out of the list -- with nothing else open it
  // is still the pick and the order skips it by name, so the grounds are asked as before); a no_site hold only while still unsited
  const held = PT.turnBackoff([st('civicM'), st('house1', { complete: true, damaged: true })], new Map(), { me: 'A', now: NOW, hold: { plot: 'civicM', stop: 'stuck_on_cell' } })
  assert.deepEqual(held[0], { ...st('civicM'), turn: true, free: false, stuck: true })
  assert.deepEqual(held[1], { ...st('house1', { complete: true, damaged: true }), turn: true }, 'only that project')
  assert.deepEqual(PT.turnBackoff([st('house1', { complete: true, damaged: true })], new Map(), { me: 'A', now: NOW, hold: { plot: 'house1', stop: 'stuck_on_cell' } })[0], { ...st('house1', { complete: true }), turn: true, damaged: false, due: true, stuck: true })
  assert.equal(PT.turnBackoff([st('pens', { exists: false })], new Map(), { me: 'A', now: NOW, hold: { plot: 'pens', stop: 'no_site' } })[0].free, false)
  assert.equal(PT.turnBackoff([st('pens')], new Map(), { me: 'A', now: NOW, hold: { plot: 'pens', stop: 'no_site' } })[0].free, undefined, 'sited since: the order\'s site retry no longer applies')
  assert.equal(PT.turnBackoff([st('tidy')], new Map(), { me: 'A', now: NOW, exempt: S.turnExempt, hold: { plot: 'tidy', stop: 'stuck_on_cell' } })[0].stuck, undefined, 'the grounds\' lane is never passed over here')
  // THE CHAIN (grounds2.mjs's own end-to-end case, found by it): the held project is the ONLY open one the bot may be offered -- it is
  // still the pick (never the next un-free project, never the tidy that is another's), so the order's skip names it and the grounds are asked
  const lone = [{ plot: 'shop', blueprint: 's' }, { plot: 'paths', blueprint: 'p', after: 'shop' }, { plot: 'tidy', blueprint: 't' }]
  const loneStates = PT.turnBackoff([st('shop', { complete: true }), st('paths', { exists: false }), st('tidy', { free: false })], new Map(), { me: 'A', now: NOW, exempt: S.turnExempt, hold: { plot: 'paths', stop: 'no_site' } })
  assert.equal(S.activeProject(loneStates, lone, { noWait: false }).plot, 'paths')
  assert.equal(S.activeProject([...loneStates, tu('wall')], [...lone.slice(0, 2), { plot: 'wall', blueprint: 'w', after: 'shop' }, lone[2]], { noWait: false }).plot, 'wall', 'control: another open project is offered instead')
  // THE CHAIN WITH THE ROOM RULE: the complete yard is the full bag's own remedy -- another bot's visit that found nothing there never
  // closes it (an OPEN yard takes its turn and its back-off like any building)
  const vy = new Map([['yard', { at: NOW, okAt: null, n: 4, noAt: NOW, stop: 'complete' }], ['paths', { at: NOW, okAt: null, n: 4, noAt: NOW, stop: 'complete' }]])
  const oy = PT.turnBackoff([st('yard', { complete: true, damaged: true }), st('paths', { complete: true, damaged: true }), st('yard')], vy, { me: 'A', now: NOW + MIN, exempt: S.turnExempt, capOf: S.stuckWindowOf, ownNeed: S.turnOwnNeed })
  assert.deepEqual(oy[0], { ...st('yard', { complete: true, damaged: true }), turn: true, visitAt: NOW }, 'the complete yard still reads its urgent work')
  assert.equal(oy[1].backoff, true, 'control: the complete paths, same count, are backed off')
  assert.equal(oy[2].backoff, true, 'control: an open yard is')
  assert.deepEqual(['yard', 'paths', 'monument', 'storehub'].map(p => S.turnOwnNeed(p)), [true, false, false, false])
})

await t('THE STAMP IS NEVER SHORTENED OR RESHAPED: a stamped project stays as stuckBackoff left it whatever the turns say -- reset by progress, expired, or backed off; MUTANT killed', async () => {
  const scenario = (Sm, PTm) => {
    const stampAt = { monument: NOW - 60_000, house1: NOW - 60_000 }
    const base = [st('monument'), st('house1', { complete: true, damaged: true }), st('wall')]
    const stamped = Sm.stuckBackoff(base, p => stampAt[p] ?? null, NOW)
    assert.deepEqual(stamped[0], { ...base[0], free: false, stuck: true })
    assert.deepEqual(stamped[1], { ...base[1], damaged: false, due: true, stuck: true })
    for (const [name, view] of [
      ['a progress visit ended the count a minute after the stamp', new Map([['monument', { at: NOW - 30_000, okAt: NOW - 30_000, n: 0, noAt: null }], ['house1', { at: NOW - 30_000, okAt: NOW - 30_000, n: 0, noAt: null }]])],
      ['the back-off is long over', new Map([['monument', { at: NOW - 5 * H, okAt: null, n: 1, noAt: NOW - 5 * H }], ['house1', { at: NOW - 5 * H, okAt: null, n: 1, noAt: NOW - 5 * H }]])],
      ['the back-off holds too', new Map([['monument', { at: NOW - 60_000, okAt: null, n: 4, noAt: NOW - 60_000 }], ['house1', { at: NOW - 60_000, okAt: null, n: 4, noAt: NOW - 60_000 }]])],
    ]) {
      const out = PTm.turnBackoff(stamped, view, { me: 'A', now: NOW, exempt: Sm.turnExempt, capOf: Sm.stuckWindowOf })
      const { visitAt: _a, turn: _c, ...m } = out[0], { visitAt: _b, turn: _d, ...h } = out[1]
      assert.deepEqual(m, stamped[0], name)
      assert.deepEqual(h, stamped[1], `${name}: the complete record keeps the stamp's shape (only due)`)
      // ...and everyone still passes it: the pick is the wall, never the stamped ziggurat or its repair
      const list = [{ plot: 'monument', blueprint: 'm' }, { plot: 'house1', blueprint: 'h' }, { plot: 'wall', blueprint: 'w' }]
      assert.equal(Sm.activeProject(out, list, { noWait: false }).plot, 'wall', name)
    }
    // the order names the stamp first, and the back-off never lifts it
    Sm.setTurnNow({ stuckPlot: () => null, backedOff: () => true })
    const q = { on: true, shared: true, atTown: true, now: NOW, planned: true, record: { plot: 'monument' }, state: {} }
    assert.deepEqual(Sm.buildOrder({ ...q, stuckAt: NOW - 60_000 }), { order: null, skip: 'stuck_on_cell' })
    Sm.setTurnNow({ stuckPlot: () => null, backedOff: () => false })
    assert.deepEqual(Sm.buildOrder({ ...q, stuckAt: NOW - 60_000 }), { order: null, skip: 'stuck_on_cell' }, 'no back-off (reset by progress): the stamp still holds its window')
    assert.deepEqual(Sm.buildOrder({ ...q, stuckAt: NOW - Sm.SHOP_STUCK_RETRY_MS }), { order: { skill: 'build_shop', args: {} }, skip: null }, 'control: past the stamp\'s window the order is issued')
  }
  await killed([['    if (st.stuck) return seen\n', '']], [], scenario)
})

const LIST3 = [{ plot: 'shop', blueprint: 's' }, { plot: 'monument', blueprint: 'm', after: 'shop' }, { plot: 'wall', blueprint: 'w', after: 'shop' }, { plot: 'stepwell', blueprint: 'sw' }, { plot: 'tidy', blueprint: 't' }]
await t('the aged choice: the longest unvisited first, never visited oldest, the order breaks a tie; the bot\'s own pick (`pin`) while it is a candidate; no marks (PROJTURN off): the first in order', () => {
  const base = [st('shop', { complete: true }), tu('monument', { visitAt: NOW - 10 * MIN }), tu('wall', { visitAt: NOW - 50 * MIN }), tu('stepwell'), st('tidy', { free: false })]
  const o = { noWait: false }
  const pick = sts => S.activeProject(sts, LIST3, o)
  assert.equal(pick(base).plot, 'stepwell', 'never visited is the oldest')
  assert.deepEqual(S.turnPickInfo(base, LIST3, pick(base), o), { why: 'aged', eligible: 3, visitAt: null })
  assert.equal(pick(base.map(({ turn, visitAt, ...s }) => s)).plot, 'monument', 'control (PROJTURN off: no marks): the first in order')
  const seen = base.map(s => (s.plot === 'stepwell' ? { ...s, visitAt: NOW - 20 * MIN } : s))
  assert.equal(pick(seen).plot, 'wall', 'the oldest visit')
  assert.deepEqual(S.turnPickInfo(seen, LIST3, pick(seen), o), { why: 'aged', eligible: 3, visitAt: NOW - 50 * MIN })
  const tie = base.map(s => (s.turn ? { ...s, visitAt: NOW } : s))
  assert.equal(pick(tie).plot, 'monument', 'equal ages: the list\'s order')
  assert.equal(S.turnPickInfo(tie, LIST3, pick(tie), o).why, 'order')
  // a project that is not free (a full slot set, a stamp, a back-off) is no candidate
  assert.equal(pick(seen.map(s => (s.plot === 'wall' ? { ...s, free: false } : s))).plot, 'stepwell')
  const one = seen.map(s => (s.plot === 'monument' ? s : { ...s, free: false }))
  assert.equal(pick(one).plot, 'monument')
  assert.deepEqual(S.turnPickInfo(one, LIST3, pick(one), o), { why: 'only', eligible: 1, visitAt: NOW - 10 * MIN })
  // nothing free: the fallback is the order's, and the row says the pick is no turn's
  const none = seen.map(s => ({ ...s, free: false }))
  assert.equal(pick(none).plot, 'monument')
  assert.deepEqual(S.turnPickInfo(none, LIST3, pick(none), o), { why: 'tier', eligible: 0, visitAt: null })
  // the pick this bot already has stands while it is still a candidate, and not a moment longer
  const pin = plot => seen.map(s => (s.plot === plot ? { ...s, pin: true } : s))
  assert.equal(pick(pin('monument')).plot, 'monument')
  assert.equal(pick(pin('monument').map(s => (s.plot === 'monument' ? { ...s, free: false } : s))).plot, 'wall')
  assert.equal(pick(pin('shop')).plot, 'wall', 'a complete project is no candidate')
  // turnPick itself
  assert.equal(PT.turnPick([], () => 1), null)
  assert.equal(PT.turnPick([{ plot: 'a' }, { plot: 'b' }], c => ({ a: 5, b: 3 })[c.plot]).plot, 'b')
  assert.equal(PT.turnPick([{ plot: 'a' }, { plot: 'b' }], c => ({ a: 5, b: NaN })[c.plot]).plot, 'b', 'not a number is never visited')
  assert.equal(PT.turnPick([{ plot: 'a' }, { plot: 'b' }], () => undefined).plot, 'a')
  assert.equal(PT.turnPick([{ plot: 'a' }, { plot: 'b' }], c => ({ a: 5, b: 3 })[c.plot], 'a').plot, 'a')
  assert.equal(PT.turnPick([{ plot: 'a' }, { plot: 'b' }], c => ({ a: 5, b: 3 })[c.plot], 'zz').plot, 'b')
})
await t('MUTANT (the aging comparison): taking the NEWEST visit starves the never-visited project', async () => {
  await killed([['    if (best == null || t < bestAt) { best = c; bestAt = t }\n', '    if (best == null || t > bestAt) { best = c; bestAt = t }\n']], [], (Sm) => {
    const base = [st('shop', { complete: true }), tu('monument', { visitAt: NOW - 10 * MIN }), tu('wall', { visitAt: NOW - 50 * MIN }), tu('stepwell'), st('tidy', { free: false })]
    assert.equal(Sm.activeProject(base, LIST3, { noWait: false }).plot, 'stepwell')
  })
})

await t('what outranks the open order is untouched by the aging: the held removal, the service pick, a repair, the `after` chain, a waiting planner, the slots; the grounds\' lane keeps its place; MUTANTS (the lane) killed', async () => {
  const scenario = Sm => {
    const list = [{ plot: 'shop', blueprint: 's' }, { plot: 'house1', blueprint: 'h', after: 'shop' }, { plot: 'cropfarm', blueprint: 'c', after: 'shop' }, { plot: 'monument', blueprint: 'm', after: 'shop' },
      { plot: 'cottage1', blueprint: 'c1', after: 'monument' }, { plot: 'reroof', blueprint: 'r', planner: true }, { plot: 'stepwell', blueprint: 'sw' }, { plot: 'tidy', blueprint: 't' }]
    const base = [tu('shop', { complete: true }), tu('house1', { complete: true }), tu('cropfarm', { complete: true }), tu('monument', { visitAt: NOW }), tu('cottage1', { exists: false }), tu('reroof', { exists: false, waiting: true }), tu('stepwell', { visitAt: NOW - H }), st('tidy', { free: false })]
    const pick = (states, o = {}) => Sm.activeProject(states, list, { noWait: false, ...o }).plot
    assert.equal(pick(base), 'stepwell', 'control: the aged pick')
    assert.equal(pick(base, { service: 'cropfarm' }), 'cropfarm', 'a due service plot first')
    assert.equal(pick(base.map(s => (s.plot === 'house1' ? { ...s, damaged: true } : s))), 'house1', 'a repair first')
    assert.equal(pick(base.map(s => (s.plot === 'house1' ? { ...s, damaged: true } : s)), { service: 'cropfarm' }), 'cropfarm', 'the service pick ahead of the repair, as before')
    // `after`: the never-visited cottage waits on the open ziggurat however old it is; a planner that waits is not offered
    assert.equal(pick(base.map(s => (s.plot === 'stepwell' ? { ...s, free: false } : s))), 'monument')
    assert.equal(pick(base.map(s => (s.plot === 'monument' ? { ...s, complete: true } : s))), 'cottage1', 'control: its `after` complete, the never-visited cottage is the oldest')
    assert.equal(pick(base.map(s => (s.plot === 'reroof' ? { ...s, waiting: false } : s))), 'reroof', 'control: a planner that is due takes its turn')
    // a project a waiting hold took out (waitBackoff `held`) is out of every selection, as before
    assert.equal(pick(base.map(s => (s.plot === 'stepwell' ? { ...s, free: false, stuck: true, held: true } : s))), 'monument')
    // THE GROUNDS' LANE (no `turn` mark). The keeper's order puts the tidy first: it is taken, however recently it was visited
    const kList = [list.at(-1), ...list.slice(0, -1)]
    const kStates = base.map(s => (s.plot === 'tidy' ? { ...s, free: true, visitAt: NOW } : s))
    assert.equal(Sm.activeProject(kStates, kList, { noWait: false }).plot, 'tidy', 'the keeper: the grounds first')
    // a helper: the tidy is last and free -- only when nothing else is, however long it went unvisited
    const hStates = base.map(s => (s.plot === 'tidy' ? { ...s, free: true } : s))
    assert.equal(Sm.activeProject(hStates, list, { noWait: false }).plot, 'stepwell', 'a never-visited tidy is not aged ahead of the building')
    assert.equal(Sm.activeProject(hStates.map(s => (['monument', 'stepwell'].includes(s.plot) ? { ...s, free: false } : s)), list, { noWait: false }).plot, 'tidy', 'nothing else free: the last resort, as before')
  }
  await killed([], [['    const cands = open.filter(p => st(p).turn === true && st(p).free !== false && !yields(st(p)))\n', '    const cands = open.filter(p => st(p).free !== false && !yields(st(p)))\n']], scenario)
  await killed([], [['  if (freeOpen && st(freeOpen).turn === true) {\n', '  if (freeOpen) {\n']], scenario)
  assert.deepEqual(['tidy', 'forest', 'upkeep', 'road', 'decor', 'monument', 'stepwell', 'paths', 'shop'].map(p => S.turnExempt(p)), [true, true, true, true, true, false, false, false, false])
})

const ORDER = { order: { skill: 'build_shop', args: {} }, skip: null }
await t('THE HOLD IS THE PROJECT\'S (the order): a bot\'s own stuck stop skips only the project it stuck on; unknown plot or PROJTURN off: every project, as before; MUTANTS (the scope, the switch) killed', async () => {
  const scenario = Sm => {
    const q = { on: true, shared: true, atTown: true, now: NOW, planned: true, state: { lastAt: NOW - H, lastStop: 'stuck_on_cell' } }
    // no hook (a restart, a pure caller): the hold is the bot's, as before
    Sm.setTurnNow(null)
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'stepwell' } }), { order: null, skip: 'stuck_on_cell' })
    Sm.setTurnNow({ stuckPlot: () => null, backedOff: () => false })
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'stepwell' } }), { order: null, skip: 'stuck_on_cell' }, 'the plot unknown: as before')
    // the hook names the project: another one is ordered, that one is skipped (the positive control), for the same 6 h
    Sm.setTurnNow({ stuckPlot: () => 'civicM', backedOff: () => false })
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'stepwell' } }), ORDER)
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'civicM' } }), { order: null, skip: 'stuck_on_cell' })
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'civicM' }, state: { lastAt: NOW - Sm.SHOP_STUCK_RETRY_MS, lastStop: 'stuck_on_cell' } }), ORDER)
    // PROJTURN off: the bot-wide hold exactly, whatever the hook says
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'stepwell' }, turn: false }), { order: null, skip: 'stuck_on_cell' })
    // a hook that throws is "unknown"
    Sm.setTurnNow({ stuckPlot: () => { throw new Error('x') }, backedOff: () => false })
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'stepwell' } }), { order: null, skip: 'stuck_on_cell' })
    assert.deepEqual([Sm.stuckRetryHolds('a', 'a'), Sm.stuckRetryHolds('a', 'b'), Sm.stuckRetryHolds('a', null), Sm.stuckRetryHolds(null, 'b')], [true, false, true, true])
  }
  await killed([], [["&& stuckRetryHolds(plot0, stuckPlot)) return { order: null, skip: 'stuck_on_cell' }", "&& true) return { order: null, skip: 'stuck_on_cell' }"]], scenario)
  await killed([], [['  if (turn && turnOf) { try { stuckPlot = turnOf.stuckPlot() ?? null } catch { stuckPlot = null } }\n', '  if (turnOf) { try { stuckPlot = turnOf.stuckPlot() ?? null } catch { stuckPlot = null } }\n']], scenario)
})

await t('THE REFUSAL CHAIN (the order): the pick inside its back-off is skipped `no_progress` -- and that skip is one the grounds stand in for (the remedy is an order, not advice); PROJTURN off: no such skip; MUTANT (the switch) killed', async () => {
  const scenario = Sm => {
    const q = { on: true, shared: true, atTown: true, now: NOW, planned: true, state: { lastAt: NOW - H, lastStop: 'cell_deferred' }, record: { plot: 'wallext' } }
    Sm.setGroundsFall(null)
    const askedAt = []
    Sm.setTurnNow({ stuckPlot: () => null, backedOff: (plot, now) => { askedAt.push(now); return plot === 'wallext' } })
    assert.deepEqual(Sm.buildOrder(q), { order: null, skip: 'no_progress' })
    assert.deepEqual(askedAt, [NOW], 'asked at the order\'s own clock')
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'stepwell' } }), ORDER, 'control: another pick is ordered')
    assert.deepEqual(Sm.buildOrder({ ...q, turn: false }), ORDER, 'PROJTURN off: the order as before')
    // the skips that come first keep their names (the cooldown, a waiting hold) and the ones after are not reached
    assert.deepEqual(Sm.buildOrder({ ...q, state: { lastAt: NOW - MIN, lastStop: 'cell_deferred' } }), { order: null, skip: null }, 'inside the cooldown: nothing, as before')
    assert.deepEqual(Sm.buildOrder({ ...q, slotsFree: false, freeSlots: 0 }), { order: null, skip: 'no_progress' })
    // the grounds are asked for exactly this skip (grounds2.mjs NO_ORDER_SKIPS), with the real groundsNoOrder deciding
    assert.ok(G2.NO_ORDER_SKIPS.includes('no_progress'))
    const links = { on: true, keeper: false, decor: false, record: 'open', emptyUntil: 0, feet: [3, 71, 4], home: { x: 0, y: 70, z: 0 }, slotFree: true, now: NOW }
    const asked = []
    Sm.setGroundsFall({ hold: s => s, ask: ({ skip, state, health, freeSlots }) => { asked.push(skip); const d = G2.groundsNoOrder({ skip, sinceMs: NOW - (state?.lastAt ?? -Infinity), cooldownMs: Sm.SHOP_COOLDOWN_MS, health, freeSlots, ...links }); return d.ask ? { order: { skill: 'build_shop', args: { grounds: true, why: d.why } } } : null } })
    assert.deepEqual(Sm.buildOrder(q), { order: { skill: 'build_shop', args: { grounds: true, why: 'no_order:no_progress' } }, skip: null }, 'the bot is ordered to the grounds instead')
    assert.deepEqual(asked, ['no_progress'])
    // control: a skip the grounds do not stand in for stays a skip (room: the bot's own state)
    Sm.setTurnNow({ stuckPlot: () => null, backedOff: () => false })
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'cottage2' }, freeSlots: 3 }), { order: null, skip: 'room' })
    Sm.setGroundsFall(null)
  }
  await killed([], [['  if (turn && turnOf) { let bo = false; try { bo = !!turnOf.backedOff(plot0, now) }', '  if (turnOf) { let bo = false; try { bo = !!turnOf.backedOff(plot0, now) }']], scenario)
})

await t('REVIEW r1, BLOCKER 1 -- a REPAIR is not held by another kind of visit\'s back-off: fresh cell damage on a backed-off building is the pick and passes the order\'s gate; the paths\' extension (damage that is no cell\'s) still backs off; a repair that keeps failing backs off on the repairs\' own count; MUTANT killed', async () => {
  const scenario = (Sm, PTm) => {
    const o = { me: 'A', now: NOW, exempt: Sm.turnExempt, capOf: Sm.stuckWindowOf, ownNeed: Sm.turnOwnNeed }
    const list = [{ plot: 'shop', blueprint: 's' }, { plot: 'house1', blueprint: 'h', after: 'shop' }, { plot: 'paths', blueprint: 'p', after: 'shop' }, { plot: 'wall', blueprint: 'w', after: 'shop' }]
    // a minute ago a visit to the house and one to the paths did nothing, for the third time: both are backed off for an hour
    const cnt = { at: NOW - MIN, okAt: null, n: 3, noAt: NOW - MIN, rn: 0, rnoAt: null, stop: 'complete' }
    const view = new Map([['house1', cnt], ['paths', cnt]])
    const base = [st('shop', { complete: true }), st('house1', { complete: true, due: true }), st('paths', { complete: true, damaged: true }), st('wall')]
    const whole = PTm.turnBackoff(base, view, o)
    assert.deepEqual([whole[1].backoff, whole[1].due, whole[2].backoff, whole[2].damaged], [true, false, true, false], 'the house\'s upkeep and the paths\' extension are quiet')
    assert.equal(Sm.activeProject(whole, list, { noWait: false }).plot, 'wall')
    // A CELL OF THE HOUSE BREAKS (its state now reads damaged AND broken): the record's generation has not moved, the count stands
    const hit = base.map(s => (s.plot === 'house1' ? { ...s, damaged: true, due: false, broken: true } : s))
    const m = PTm.turnBackoff(hit, view, o)
    assert.deepEqual(m[1], { ...hit[1], turn: true, visitAt: NOW - MIN }, 'the damage stands: no back-off of another kind of visit holds a repair')
    assert.equal(Sm.activeProject(m, list, { noWait: false }).plot, 'house1', 'the repair is the pick at the next decision')
    // the order's gate is the same marks, for the pick alone: it passes
    assert.equal(PTm.turnBackoff([hit[1]], view, o)[0].backoff, undefined)
    Sm.setTurnNow({ stuckPlot: () => null, backedOff: plot => PTm.turnBackoff([hit.find(s => s.plot === plot)], view, o)[0].backoff === true })
    const q = { on: true, shared: true, atTown: true, now: NOW, planned: true, state: {}, complete: false }
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'house1', structure_complete: true } }), ORDER, 'and the order is issued')
    // THE PATHS STILL BACK OFF: `damaged` without `broken` (recordDamaged's extension-due) is the project's own count
    assert.deepEqual([m[2].backoff, m[2].damaged], [true, false])
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'paths', structure_complete: true } }), { order: null, skip: 'no_progress' })
    // ...unless a path cell is really broken too: then it is a repair like any other
    assert.equal(PTm.turnBackoff([{ ...base[2], broken: true }], view, o)[0].backoff, undefined)
    // `broken` without `damaged` (the per-bot repair back-off took the repair away: shop.mjs repairBackoff) is no repair
    assert.equal(PTm.turnBackoff([{ ...base[1], damaged: false, due: true, broken: true }], view, o)[0].backoff, true)
    // THE REPAIR ITSELF FAILS: counted on the repairs' own count, never on the project's
    const gale = { holder: 'G', plots: { house1: { at: NOW - MIN, n: 3, noAt: NOW - MIN, rn: 0, rnoAt: null, okAt: null, gen: 1, stop: 'complete' } } }
    const viewOf = (own, now) => PTm.turnView([gale, { holder: 'A', plots: { house1: own } }], { now, genOf: () => 1 }).get('house1')
    let own = PTm.turnStart(null, NOW), t = NOW
    const fail = () => { t += 3 * MIN; own = PTm.turnAfter(own, viewOf(own, t), 'no_progress', { now: t, stop: 'clears_wait', gen: 1, repair: true }) }
    fail()
    assert.deepEqual([own.rn, own.rnoAt, own.n, own.noAt], [1, t, 0, null])
    assert.deepEqual([viewOf(own, t).n, viewOf(own, t).rn, viewOf(own, t).rnoAt], [3, 1, t])
    const gate = now => PTm.turnBackoff([hit[1]], new Map([['house1', viewOf(own, now)]]), { ...o, now })[0].backoff === true
    assert.equal(gate(t + MIN), true, 'a repair that failed is backed off')
    assert.equal(gate(t + 26 * MIN), false, 'for 20-25 min -- its own first step, not the hour the project\'s count of three says')
    // N failures: 20, 40, then an hour (a complete record's cap), each from the last one
    fail(); assert.equal(gate(t + 39 * MIN), true); assert.equal(gate(t + 51 * MIN), false)
    fail(); fail(); fail()
    assert.equal(own.rn, 5)
    assert.equal(gate(t + 59 * MIN), true); assert.equal(gate(t + 76 * MIN), false, 'never more than an hour and a quarter')
    // a visit that was no repair adds to the project's count and leaves the repairs' alone
    const up = PTm.turnAfter(own, viewOf(own, t), 'no_progress', { now: t + MIN, stop: 'complete', gen: 1 })
    assert.deepEqual([up.n, up.rn, up.rnoAt], [1, 5, t])
    // ONE repair that works ends both counts, for everyone
    const ok = PTm.turnAfter(own, viewOf(own, t), 'progress', { now: t + 2 * H, gen: 1 })
    assert.deepEqual([ok.n, ok.rn, ok.rnoAt, ok.okAt], [0, 0, null, t + 2 * H])
    assert.deepEqual([viewOf(ok, t + 2 * H).n, viewOf(ok, t + 2 * H).rn], [0, 0])
  }
  await killed([[REPAIR, '    const repair = false\n']], [], scenario)
})
await t('REVIEW r1, BLOCKER 2 -- ONE RULE for the pick and the order\'s gate: the plot of the bot\'s current service offer is not backed off in either; without the offer it is, in both; MUTANT killed', async () => {
  const scenario = (Sm, PTm) => {
    const o = { me: 'A', now: NOW, exempt: Sm.turnExempt, capOf: Sm.stuckWindowOf, ownNeed: Sm.turnOwnNeed }
    const list = [{ plot: 'shop', blueprint: 's' }, { plot: 'cropfarm', blueprint: 'c', after: 'shop' }, { plot: 'wall', blueprint: 'w', after: 'shop' }]
    const view = new Map([['cropfarm', { at: NOW - MIN, okAt: null, n: 3, noAt: NOW - MIN, rn: 0, rnoAt: null, stop: 'complete' }]])
    const states = [st('shop', { complete: true }), st('cropfarm', { complete: true, due: true }), st('wall')]
    const q = { on: true, shared: true, atTown: true, now: NOW, planned: true, state: {}, complete: false, record: { plot: 'cropfarm', structure_complete: true } }
    const gateOn = marks => Sm.setTurnNow({ stuckPlot: () => null, backedOff: plot => marks.find(s => s.plot === plot)?.backoff === true })
    // THE DEAD END AS IT WAS (the control): marks that do not know the offer back the farm off, the picker's service tier takes it
    // all the same, and the order -- reading those marks -- refuses it; the wall, open and free, is never reached
    const blind = PTm.turnBackoff(states, view, o)
    assert.equal(Sm.activeProject(blind, list, { noWait: false, service: 'cropfarm' }).plot, 'cropfarm')
    gateOn(blind)
    assert.deepEqual(Sm.buildOrder(q), { order: null, skip: 'no_progress' })
    // THE RULE: the marks are told the offer -- the same marks the gate reads
    const m = PTm.turnBackoff(states, view, { ...o, service: 'cropfarm' })
    assert.deepEqual(m[1], { ...states[1], turn: true, visitAt: NOW - MIN }, 'its state as it came: the service\'s schedule is its own')
    assert.equal(Sm.activeProject(m, list, { noWait: false, service: 'cropfarm' }).plot, 'cropfarm')
    gateOn(m)
    assert.deepEqual(Sm.buildOrder(q), ORDER, 'the pick passes the order: the service is ordered')
    // only the offer's own plot, and only while it is offered: the farm with no offer is backed off in the pick AND the gate, and the wall is worked
    assert.equal(PTm.turnBackoff(states, view, { ...o, service: 'paths' })[1].backoff, true)
    assert.equal(Sm.activeProject(blind, list, { noWait: false }).plot, 'wall')
    gateOn(blind)
    assert.deepEqual(Sm.buildOrder({ ...q, record: { plot: 'wall' } }), ORDER)
  }
  await killed([[SERVICE, '']], [], scenario)
})
await t('REVIEW r1, BLOCKER 3 -- THE PROBE IS THE SLOT LEASE: a project with a count is not free while another bot holds one of its slots, however long that lasts; no count, no hold; the lease is read only where it decides; MUTANT killed', async () => {
  const scenario = (Sm, PTm) => {
    const o = { me: 'A', now: NOW, exempt: Sm.turnExempt, capOf: Sm.stuckWindowOf, ownNeed: Sm.turnOwnNeed }
    // the wall extension: two visits did nothing, three hours ago (its 40-50 min are long over); the wall: working
    const view = new Map([['wallext', { at: NOW - 3 * H, okAt: null, n: 2, noAt: NOW - 3 * H, rn: 0, rnoAt: null, stop: 'cell_deferred' }], ['wall', { at: NOW - H, okAt: NOW - H, n: 0, noAt: null, rn: 0, rnoAt: null, stop: null }]])
    const states = [st('wallext'), st('wall')]
    assert.equal(PTm.turnBackoff(states, view, { ...o, leased: () => false })[0].backoff, undefined, 'the back-off over and nobody on it: a candidate')
    assert.deepEqual(PTm.turnBackoff(states, view, { ...o, leased: plot => plot === 'wallext' })[0], { ...states[0], turn: true, visitAt: NOW - 3 * H, free: false, backoff: true }, 'another bot is on it: under probe')
    // no wall clock in it: the same answer at any hour while the lease is held, and none once it is not
    for (const dt of [MIN, 8 * MIN, 5 * H]) assert.equal(PTm.turnBackoff(states, view, { ...o, now: NOW + dt, leased: () => true })[0].backoff, true, `${dt / MIN} min on`)
    assert.equal(PTm.TURN.probeMs, undefined)
    // a project with no count is ordinary work: two builders side by side, as before
    assert.equal(PTm.turnBackoff(states, view, { ...o, leased: () => true })[1].backoff, undefined)
    // a complete record's repair count is a count too
    const hall = st('townhall', { complete: true, damaged: true, broken: true })
    const hv = new Map([['townhall', { at: NOW - 3 * H, okAt: null, n: 0, noAt: null, rn: 2, rnoAt: NOW - 3 * H }]])
    assert.deepEqual([PTm.turnBackoff([hall], hv, { ...o, leased: () => true })[0].backoff, PTm.turnBackoff([hall], hv, { ...o, leased: () => false })[0].backoff], [true, undefined])
    // the lease is read only where it decides (a file read each): not inside a back-off, not without a count
    const asked = []
    PTm.turnBackoff([...states, st('monument')], new Map([...view, ['monument', { at: NOW - MIN, okAt: null, n: 1, noAt: NOW - MIN, rn: 0, rnoAt: null }]]), { ...o, leased: plot => { asked.push(plot); return false } })
    assert.deepEqual(asked, ['wallext'])
    assert.equal(PTm.turnBackoff(states, view, { ...o, leased: () => { throw new Error('x') } })[0].backoff, undefined, 'a lease that cannot be asked is "no"')
    // who must claim before it starts
    assert.deepEqual([null, { n: 0 }, { n: 2, noAt: NOW }, { n: 0, rn: 1, rnoAt: NOW }, { n: 2, noAt: null }].map(e => PTm.turnClaimNeeded(e)), [false, false, true, true, false])
  }
  await killed([[LEASED, '']], [], scenario)
})

// ================================================================================================================================
// 2. THE SIMULATION: fourteen bots, a town shaped like the live one, 48 hours on a fake clock.
// ================================================================================================================================
// THE TOWN (the live one's shape, 11-15): the workshop, the house, the paths, the crop farm and the town hall stand.
//   the house      reads an upkeep no visit serves from 4.5 h (damage that is no cell's: each bot once per 30 min, nothing done), then
//                  takes REAL DAMAGE at hour 6 (two repair visits mend it) -- review r1 blocker 1: the repair must not wait out the
//                  back-off those no-op visits earned
//   the paths      read as damage to each bot once per 30 min (the extension its visit cannot route: `complete`, nothing laid)
//   the crop farm  is a service plot, due every 30 min, whose service visits do NOTHING; it also reads the same kind of no-cell
//                  damage once per 45 min per bot -- review r1 blocker 2: the back-off those visits earn must not close the service
//   the town hall  is broken for good from hour 30 (a cell no repair visit can mend: `clears_wait`) -- a repair that keeps failing
//   the ziggurat   ends stuck_on_cell STALLED (the project's 6-h stamp); the wall extension ends cell_deferred with nothing placed
//                  after EIGHT minutes (review r1 blocker 3: longer than any wall-clock probe hold); cottage2 and the pens find no
//                  site; cottage3 waits on cottage2; civicM ends stuck_on_cell without a stall; civicH does too until hour 20, then
//                  its visits place blocks (one in ten does not)
//   THE STEP WELL, late in the order, can always work (one builder; every fifth visit is interrupted); the tidy is the crew's (bots
//                  0-2). Bot 13 has a full bag (5 free slots): the room refusal's remedy (a bank order) is installed.
// THE SLOT LEASES are the projects' `slots` sets. Every bot of one tick decides from the leases as the tick BEGAN (the same reading:
// a lease is taken inside the visit, after the order), and a visit's start reads them live -- so two bots can pick one backed-off
// project in the same tick, as live. One bot is KILLED two minutes into a wall-extension probe after hour 14: no result, no release,
// its lease lapsing by itself (buildproj.mjs LEASE_TTL_MS + RECLAIM_MS).
const SIM_LIST = [
  { plot: 'shop', blueprint: 'workshop@1' },
  { plot: 'house1', blueprint: 'house@1', after: 'shop' },
  { plot: 'monument', blueprint: 'ziggurat@1', after: 'shop', builders: 2 },
  { plot: 'paths', blueprint: 'paths@1', after: 'house1', builders: 2 },
  { plot: 'cropfarm', blueprint: 'cropfarm@1', after: 'paths', builders: 1 },
  { plot: 'townhall', blueprint: 'townhall@1', after: 'shop', builders: 2 },
  { plot: 'wallext', blueprint: 'wallext@1', after: 'paths', builders: 2 },
  { plot: 'cottage2', blueprint: 'cottage@2', after: 'paths', builders: 2 },
  { plot: 'cottage3', blueprint: 'cottage@2', after: 'cottage2', builders: 2 },
  { plot: 'pens', blueprint: 'pens@1', after: 'paths', builders: 1 },
  { plot: 'civicM', blueprint: 'civic@1', after: 'paths', builders: 2 },
  { plot: 'civicH', blueprint: 'civic@1', after: 'paths', builders: 2 },
  { plot: 'stepwell', blueprint: 'stepwell@1', builders: 1 },
  { plot: 'tidy', blueprint: 'tidy@1', builders: 3 },
]
const SIM_OPEN = ['monument', 'wallext', 'cottage2', 'pens', 'civicM', 'civicH', 'stepwell']   // the open projects a bot may be offered
const SIM_DONE = ['shop', 'house1', 'paths', 'cropfarm', 'townhall']
function simulate (Sm, PTm, { turn, hours = 48, nBots = 14, upkeepAt = 4.5 * H, damageAt = 6 * H, unblockAt = 20 * H, hallAt = 30 * H, killAfter = 14 * H } = {}) {
  const T0 = NOW, TICK = 30_000, END = T0 + hours * H, COOL = Sm.SHOP_COOLDOWN_MS, LEASE = PJ.LEASE_TTL_MS + PJ.RECLAIM_MS
  const proj = Object.fromEntries(SIM_LIST.map(p => [p.plot, { exists: !['cottage2', 'cottage3', 'pens'].includes(p.plot), complete: SIM_DONE.includes(p.plot), slots: new Set(), linger: [], stampAt: null, broken: 0, n: 0 }]))
  const files = new Map()
  const viewNow = now => PTm.turnView([...files].map(([holder, plots]) => ({ holder, plots })), { now, genOf: () => null })
  const put = (b, plot, e) => { if (!files.has(b.name)) files.set(b.name, {}); files.get(b.name)[plot] = e }
  const bots = Array.from({ length: nBots }, (_, i) => ({ i, name: `showcase-Bot${String(i).padStart(2, '0')}`, startAt: T0 + i * 37_000, shopState: {}, visit: null, deadUntil: 0, idle: new Map(), wait: new Map(), repairs: new Map(), noSitePlot: null, turnLast: null, pin: null, freeSlots: i === 13 ? 5 : 30, pathsAskAt: -Infinity, houseAskAt: -Infinity, cropAskAt: -Infinity, starveMax: 0, orders: [], benchedOrders: 0 }))
  const stats = { visits: {}, starts: {}, spans: {}, out: {}, placed: 0, skips: {}, picks: {}, bank: 0, asides: 0, asideEnds: 0, repairStart: [], serviceStart: [], afterStuck: [], afterNoSite: [], kill: null, houseBackedOffAtDamage: null }
  for (const p of SIM_LIST) { stats.visits[p.plot] = 0; stats.starts[p.plot] = []; stats.spans[p.plot] = []; stats.out[p.plot] = {} }
  const svc = { at: T0 - 30 * MIN, busy: false }
  const slotFree = (plot, b) => { const p = SIM_LIST.find(q => q.plot === plot), P = proj[plot]; if (plot === 'tidy' && b.i > 2) return false; return P.slots.has(b) || P.slots.size < Sm.buildersOf(p) }
  let cur = null, snap = new Map()
  Sm.setActivePlot(() => cur?.pick?.plot ?? null)
  Sm.setNoSitePlot(() => cur?.b?.noSitePlot ?? null)
  Sm.setWaitNow(plot => Sm.waitHeld(cur?.b?.wait ?? null, plot, cur?.now ?? 0))
  Sm.setRoomAsk(() => ({ order: { skill: 'build_shop', args: { roomBank: true } } }))
  Sm.setGroundsFall(null)
  // the order's gate reads the picker's own marks for the pick (skills.mjs turnBackedOff -> turnMarksNow: one function)
  Sm.setTurnNow({ stuckPlot: () => (cur?.b?.turnLast?.stop === 'stuck_on_cell' ? cur.b.turnLast.plot : null), backedOff: plot => cur?.turned?.find(s => s.plot === plot)?.backoff === true })
  const behave = (plot, b, now, service) => {
    const P = proj[plot]
    P.n++
    if (plot === 'monument') return { status: 'no_effect', stop: 'stuck_on_cell', stalled: true, ms: 3 * MIN }
    if (plot === 'paths') return { status: 'no_effect', stop: 'complete', ms: MIN }
    if (plot === 'cropfarm') return { status: 'no_effect', stop: 'complete', ms: service ? 2 * MIN : MIN }
    if (plot === 'townhall') return { status: 'no_effect', stop: 'clears_wait', ms: 3 * MIN }
    if (plot === 'wallext') return { status: 'no_effect', stop: 'cell_deferred', ms: 8 * MIN }
    if (plot === 'cottage2') return { status: 'no_effect', stop: 'no_site', ms: 107_000 }
    if (plot === 'pens') return { status: 'no_effect', stop: 'no_site', ms: MIN }
    if (plot === 'civicM') return { status: 'no_effect', stop: 'stuck_on_cell', ms: 3 * MIN }
    // workable from `unblockAt` on -- with an ordinary visit that places nothing now and then (every tenth: a deferred cell)
    if (plot === 'civicH') return now < T0 + unblockAt ? { status: 'no_effect', stop: 'stuck_on_cell', ms: 3 * MIN } : P.n % 10 === 0 ? { status: 'no_effect', stop: 'cell_deferred', ms: 3 * MIN } : { status: 'success', stop: 'deadline', placed: 12, ms: 3 * MIN }
    if (plot === 'stepwell') return P.n % 5 === 0 ? { status: 'aborted', stop: 'aborted', ms: MIN } : { status: 'success', stop: 'deadline', placed: 20, ms: 3 * MIN }
    if (plot === 'house1') return P.broken > 0 ? { status: 'success', stop: 'complete', placed: 3, mend: true, ms: 3 * MIN } : { status: 'no_effect', stop: 'complete', ms: MIN }
    if (plot === 'tidy') return P.n % 3 === 0 ? { status: 'aborted', stop: 'aborted', ms: MIN } : { status: 'success', stop: 'deadline', placed: 4, ms: 3 * MIN }
    return { status: 'no_effect', stop: 'complete', ms: MIN }
  }
  const endVisit = (b, now) => {
    const v = b.visit
    b.visit = null
    if (v.bank) { b.freeSlots = 30; b.shopState = { lastAt: now, lastStop: 'room_bank' }; return }
    const P = proj[v.plot], beh = v.beh
    P.slots.delete(b)                                                                // the visit releases its slot lease
    v.span.e = now
    const res = { status: beh.status, stop: beh.stop, ...(beh.placed ? { placed: beh.placed } : {}) }
    b.shopState = { lastAt: now, lastStop: res.stop ?? res.status }                  // cognitive.mjs: the visit's end writes both
    Sm.noteIdle(b.idle, v.plot, res, now); Sm.noteWait(b.wait, v.plot, res, now)       // skills.mjs buildShop `note`
    if (res.stop === 'no_site') b.noSitePlot = v.plot
    if (beh.stalled) P.stampAt = now                                                 // buildrun.mjs settleStuck: the project's stamp
    if (beh.mend && P.broken > 0) P.broken--
    if (v.service) svc.busy = false
    if (res.status !== 'aborted') { stats.placed += beh.placed ?? 0 }
    stats.out[v.plot][res.stop] = (stats.out[v.plot][res.stop] ?? 0) + 1
    if (res.stop === 'stuck_on_cell') b.stuckAt = now
    if (turn) {
      b.turnLast = { plot: v.plot, stop: String(res.stop ?? res.status), at: now }  // skills.mjs turnNote
      if (v.turn) { const oc = PTm.turnOutcome(res); if (oc !== 'none') put(b, v.plot, PTm.turnAfter(files.get(b.name)?.[v.plot] ?? null, viewNow(now).get(v.plot) ?? null, oc, { now, stop: res.stop, gen: null, repair: v.repair })) }
    }
    b.lastEnd = { plot: v.plot, stop: res.stop, at: now }
  }
  // the states as skills.mjs shopActive reads them: `damaged` (recordDamaged) and `broken` (the damage is a cell's)
  const baseOf = (b, now) => SIM_LIST.map(p => {
    const P = proj[p.plot], t = now - T0
    const upkeep = (p.plot === 'house1' && t >= upkeepAt && t < damageAt && now - b.houseAskAt >= 30 * MIN) || (p.plot === 'paths' && now - b.pathsAskAt >= 30 * MIN) || (p.plot === 'cropfarm' && now - b.cropAskAt >= 45 * MIN)
    const broken = (p.plot === 'house1' && P.broken > 0) || (p.plot === 'townhall' && t >= hallAt)
    return { plot: p.plot, exists: P.exists, complete: P.complete, damaged: P.complete && (broken || upkeep), due: false, dueFirst: false, ...(P.complete && broken ? { broken: true } : {}) }
  })
  // skills.mjs shopActive, in its order: the repair back-off, the slots, the stamps, the waiting holds, the idle marks, the turns last.
  // `live`: the leases read now (a visit's start); else as the tick began (the reading every bot of this tick decided from)
  const marksOf = (b, now, base, svcDue, live) => {
    const states = Sm.repairBackoff(base, b.repairs, now).map(s => (s.exists && s.complete ? s : { ...s, free: slotFree(s.plot, b) }))
    const marked = Sm.idleMarks(Sm.waitBackoff(Sm.stuckBackoff(states, plot => proj[plot].stampAt, now), b.wait, now), b.idle, now)
    const leased = plot => [...(live ? proj[plot].slots : snap.get(plot) ?? [])].some(x => x !== b)
    const turned = turn ? PTm.turnBackoff(marked, viewNow(now), { me: b.name, now, exempt: Sm.turnExempt, hold: PTm.turnHold(b.turnLast, now, { stuckMs: Sm.SHOP_STUCK_RETRY_MS, siteMs: Sm.SHOP_SITE_RETRY_MS }), pin: b.pin && now - b.pin.at < PTm.TURN.stickMs ? b.pin.plot : null, capOf: Sm.stuckWindowOf, ownNeed: Sm.turnOwnNeed, service: svcDue ? 'cropfarm' : null, leased }) : marked
    return { states, turned }
  }
  const pickOf = (b, now, turned, svcDue) => {
    const pick = Sm.activeProject(turned, SIM_LIST, { upkeepTurn: false, noWait: false, service: svcDue ? 'cropfarm' : null, sinkTurn: false })
    if (turn && b.pin?.plot !== pick.plot) b.pin = { plot: pick.plot, at: now }
    return pick
  }
  const decide = (b, now) => {
    const svcDue = !svc.busy && now - svc.at >= 30 * MIN
    const base = baseOf(b, now)
    let { states, turned } = marksOf(b, now, base, svcDue, false)
    let pick = pickOf(b, now, turned, svcDue)
    const P0 = proj[pick.plot]
    const wants = base.find(s => s.plot === pick.plot).damaged || (svcDue && pick.plot === 'cropfarm')   // cognitive.mjs: complete && !shopDamaged
    cur = { b, pick, now, turned }
    const r = Sm.buildOrder({ on: true, shared: true, atTown: true, holds: false, now, state: b.shopState, record: P0.exists ? { plot: pick.plot, structure_complete: P0.complete } : null,
      complete: P0.complete && !wants, slotsFree: slotFree(pick.plot, b), health: 20, freeSlots: b.freeSlots, planned: true, stuckAt: P0.stampAt, turn })
    const cooled = now - (b.shopState.lastAt ?? -Infinity) >= COOL
    // is there an open project this bot could be working right now (a slot, no stamp, no back-off, not its held one)?
    const could = turned.some(s => SIM_OPEN.includes(s.plot) && !(s.exists && s.complete) && s.free !== false)
    if (!r.order) {
      if (r.skip) stats.skips[r.skip] = (stats.skips[r.skip] ?? 0) + 1
      if (cooled && could && r.skip !== 'room') b.starveMax += TICK
      return
    }
    b.shopState = { ...b.shopState, lastAt: now }                                     // cognitive.mjs: the cooldown is charged at issue
    if (r.order.args?.roomBank) { stats.bank++; b.visit = { bank: true, endAt: now + 2 * MIN }; return }
    // THE VISIT'S START (skills.mjs buildShopVisit / turnBegin): the pick's own marks read again on the leases as they are NOW, and the
    // probe's claim -- a pick another bot got to first is stepped aside from, and the next pick is worked in this same visit
    for (let i = 0; turn && !Sm.turnExempt(pick.plot) && !(svcDue && pick.plot === 'cropfarm'); i++) {
      const live = marksOf(b, now, base, svcDue, true)
      const others = [...proj[pick.plot].slots].some(x => x !== b)
      if (!(live.turned.find(s => s.plot === pick.plot)?.backoff === true || (PTm.turnClaimNeeded(viewNow(now).get(pick.plot) ?? null) && others))) break
      stats.asides++
      if (i >= PTm.TURN.asideMax) { stats.asideEnds++; b.shopState = { lastAt: now, lastStop: 'slots_full' }; return }
      states = live.states; turned = live.turned
      pick = pickOf(b, now, turned, svcDue)
      // the next pick never passed the order: one it would have skipped is not begun (skills.mjs turnWorkable)
      const ps = turned.find(s => s.plot === pick.plot)
      if (!Sm.turnExempt(pick.plot) && (ps.free === false || ps.stuck === true || (ps.exists && ps.complete && !ps.damaged && !ps.due))) { stats.asideEnds++; b.shopState = { lastAt: now, lastStop: 'slots_full' }; return }
    }
    const P = proj[pick.plot]
    if (!slotFree(pick.plot, b)) { b.shopState = { lastAt: now, lastStop: 'slots_full' }; return }   // the visit's own takeSlot
    const service = svcDue && pick.plot === 'cropfarm'
    const bs = base.find(s => s.plot === pick.plot)
    // the visit (skills.mjs buildShopVisit): the pick, the repair count, the slot, the start's stamp
    Sm.noteRepair(b.repairs, pick, states, now)
    P.slots.add(b)
    if (service) { svc.busy = true; svc.at = now; stats.serviceStart.push(now) }
    if (pick.plot === 'paths') b.pathsAskAt = now
    if (pick.plot === 'house1') { b.houseAskAt = now; if (P.broken > 0) stats.repairStart.push(now) }
    if (pick.plot === 'cropfarm' && !service) b.cropAskAt = now
    const noted = turn && !Sm.turnExempt(pick.plot) && !service
    if (noted) put(b, pick.plot, PTm.turnStart(files.get(b.name)?.[pick.plot] ?? null, now))
    stats.visits[pick.plot]++; stats.starts[pick.plot].push(now)
    if (turn) { const why = Sm.turnPickInfo(turned, SIM_LIST, pick, { noWait: false }).why; stats.picks[why] = (stats.picks[why] ?? 0) + 1 }
    if (Number.isFinite(b.stuckAt) && now - b.stuckAt < Sm.SHOP_STUCK_RETRY_MS) b.benchedOrders++
    if (b.lastEnd?.stop === 'stuck_on_cell') stats.afterStuck.push({ wait: now - b.lastEnd.at, to: pick.plot, from: b.lastEnd.plot })
    if (b.lastEnd?.stop === 'no_site') stats.afterNoSite.push({ wait: now - b.lastEnd.at, to: pick.plot, from: b.lastEnd.plot })
    b.lastEnd = null
    b.orders.push(now)
    const beh = behave(pick.plot, b, now, service)
    const span = { s: now, e: null, b: b.i }
    stats.spans[pick.plot].push(span)
    b.visit = { plot: pick.plot, endAt: now + beh.ms, beh, service, turn: noted, repair: !!(bs.complete && bs.damaged && bs.broken), span }
    if (pick.plot === 'wallext' && !stats.kill && now - T0 >= killAfter) { b.visit.killAt = now + 2 * MIN; stats.kill = { at: b.visit.killAt, bot: b.i } }
  }
  let damaged = false
  for (let now = T0; now < END; now += TICK) {
    if (!damaged && now >= T0 + damageAt) {
      // the precondition of blocker 1: the house's no-op upkeep visits have it backed off for the pool as the damage lands
      if (turn) stats.houseBackedOffAtDamage = PTm.turnBackoff([{ plot: 'house1', exists: true, complete: true, damaged: true }], viewNow(now), { me: bots[0].name, now, capOf: Sm.stuckWindowOf })[0].backoff === true
      proj.house1.broken = 2; damaged = true
    }
    for (const P of Object.values(proj)) P.linger = P.linger.filter(l => now < l.until || (P.slots.delete(l.b), false))   // a dead holder's lease lapses
    snap = new Map(SIM_LIST.map(p => [p.plot, new Set(proj[p.plot].slots)]))
    for (const b of bots) {
      if (now < b.startAt || now < b.deadUntil) continue
      if (b.visit?.killAt && now >= b.visit.killAt) {
        // KILLED mid-visit: no result, no release -- the slot lease stands until it lapses; the bot is back half an hour later
        const v = b.visit
        b.visit = null; v.span.e = now; v.span.killed = true
        if (v.service) svc.busy = false
        proj[v.plot].linger.push({ b, until: v.killAt + LEASE })
        b.deadUntil = now + 30 * MIN
        continue
      }
      if (b.visit) { if (now < b.visit.endAt) continue; endVisit(b, now) }
      decide(b, now)
    }
  }
  const gap = (plot, from = T0, to = END) => { const ts = [from, ...stats.starts[plot].filter(x => x >= from && x < to), to]; let g = 0; for (let i = 1; i < ts.length; i++) g = Math.max(g, ts[i] - ts[i - 1]); return g }
  const count = (plot, h0, h1) => stats.starts[plot].filter(x => x >= T0 + h0 * H && x < T0 + h1 * H).length
  // the visits to `plot` that ran beside another one, once the project had a count (its first visit over)
  const overlaps = plot => { const sp = stats.spans[plot]; const t1 = sp[0]?.e ?? Infinity; let n = 0; for (let i = 0; i < sp.length; i++) for (let k = i + 1; k < sp.length; k++) if (sp[k].s >= t1 && sp[k].s < (sp[i].e ?? END)) n++; return n }
  return { T0, END, TICK, LEASE, hours, stats, bots, proj, files, gap, count, overlaps, starveMax: Math.max(...bots.map(b => b.starveMax)), perDay: plot => Math.round(stats.visits[plot] / (hours / 24) * 10) / 10 }
}
const table = (on, off) => {
  const row = (a, b, c, d, e) => `        ${String(a).padEnd(10)}${String(b).padStart(12)}${String(c).padStart(12)}${String(d).padStart(16)}${String(e).padStart(16)}`
  const lines = [row('project', 'off /day', 'on /day', 'off longest h', 'on longest h')]
  for (const p of SIM_LIST) lines.push(row(p.plot, off.perDay(p.plot), on.perDay(p.plot), (off.gap(p.plot) / H).toFixed(1), (on.gap(p.plot) / H).toFixed(1)))
  lines.push(row('blocks', off.stats.placed, on.stats.placed, '', ''))
  lines.push(row('starved h', (off.starveMax / H).toFixed(2), (on.starveMax / H).toFixed(2), '(the most time one cooled-down bot', 'spent unordered with work open)'))
  lines.push(`        skips off ${JSON.stringify(off.stats.skips)}`)
  lines.push(`        skips on  ${JSON.stringify(on.stats.skips)}`)
  lines.push(`        picks on  ${JSON.stringify(on.stats.picks)}  bank on/off ${on.stats.bank}/${off.stats.bank}  stepped aside ${on.stats.asides} (visits ended by it ${on.stats.asideEnds})  ran beside another ${SIM_OPEN.map(p => `${p}:${on.overlaps(p)}`).join(' ')}`)
  return lines.join('\n')
}
let SIM = null
await t('THE SIMULATION (48 h, 14 bots): the table -- visits per project per simulated day and the longest wait, PROJTURN off and on', async () => {
  await withTurn([], [], (Sm, PTm) => { SIM = { on: simulate(Sm, PTm, { turn: true }), off: simulate(Sm, PTm, { turn: false }) } })
  // deterministic: the same run twice gives the same numbers
  await withTurn([], [], (Sm, PTm) => { const again = simulate(Sm, PTm, { turn: true }); assert.deepEqual(again.stats.visits, SIM.on.stats.visits); assert.equal(again.stats.placed, SIM.on.stats.placed) })
})
await t('(f) THE POSITIVE CONTROL -- PROJTURN off reproduces today: the step well starves, the hopeless projects are asked over and over, a stuck bot is benched off everything', () => {
  const { off } = SIM
  assert.equal(off.count('stepwell', 0, 42), 0, 'ZERO step well visits in 42 hours, as live')
  assert.ok(off.gap('stepwell') >= 42 * H)
  assert.ok(off.count('paths', 6, 30) >= 100, `the finished paths visited for nothing: ${off.count('paths', 6, 30)} times in a day`)
  assert.ok(off.count('wallext', 6, 30) >= 100, `the stuck wall extension: ${off.count('wallext', 6, 30)} visits in a day`)
  // the bot-wide hold: a bot whose visit ended stuck_on_cell is given NO build visit for the next 6 h
  assert.ok(off.bots.some(b => Number.isFinite(b.stuckAt)), 'bots did get stuck')
  assert.equal(off.bots.reduce((n, b) => n + b.benchedOrders, 0), 0, 'none of them was ordered anywhere inside its 6 h')
  assert.ok(off.starveMax >= 5 * H, `one cooled-down bot spent ${(off.starveMax / H).toFixed(1)} h of the 48 unordered while a project it could work stood open`)
})
await t('(a) BOUNDED WAITING: every open project is visited inside the first hour and never waits more than 8 h; the step well -- starved today -- within the hour, always', () => {
  const { on } = SIM
  for (const p of SIM_OPEN) {
    assert.ok(on.count(p, 0, 1) >= 1, `${p} visited in the first hour`)
    assert.ok(on.gap(p) <= 8 * H, `${p}: longest wait ${(on.gap(p) / H).toFixed(2)} h`)
  }
  assert.ok(on.stats.starts.stepwell[0] - on.T0 <= 10 * MIN, `the step well's first visit after ${((on.stats.starts.stepwell[0] - on.T0) / MIN).toFixed(1)} min`)
  assert.ok(on.gap('stepwell') <= H, `the step well's longest wait: ${(on.gap('stepwell') / MIN).toFixed(1)} min`)
  assert.ok(on.stats.placed > 10 * SIM.off.stats.placed, `blocks placed: ${on.stats.placed} against ${SIM.off.stats.placed}`)
  // the dependencies still hold: cottage3 waits on cottage2, which never finds a site
  assert.equal(on.stats.visits.cottage3, 0)
  assert.ok(on.stats.visits.cottage2 > 0, 'control: cottage2 itself is tried')
})
await t('(b) ONE STUCK PROJECT NEVER SUPPRESSES THE OTHERS: a bot is never left unordered while a project it could work stands open; after a stuck or a no-site visit its next order is another project\'s, at its next cooldown', () => {
  const { on, off } = SIM
  assert.ok(on.starveMax <= 30 * MIN, `the most any cooled-down bot spent unordered with work open, in 48 h: ${(on.starveMax / MIN).toFixed(1)} min (a repair's slots full)`)
  assert.ok(on.stats.afterStuck.length >= 5, `stuck visits happened: ${on.stats.afterStuck.length}`)
  for (const a of on.stats.afterStuck.filter(x => x.wait < 6 * H)) assert.ok(a.to !== a.from, `after stuck on ${a.from} the next order was ${a.to}`)
  assert.ok(on.stats.afterStuck.some(a => a.wait <= 11 * MIN), `the soonest was at the bot's next cooldown: ${(Math.min(...on.stats.afterStuck.map(a => a.wait)) / MIN).toFixed(1)} min`)
  // the hold is the project's: the SAME bots, benched 6 h today, were ordered to other projects inside those 6 h
  assert.ok(on.bots.reduce((n, b) => n + b.benchedOrders, 0) >= 20, `orders inside a bot's own 6 h: ${on.bots.reduce((n, b) => n + b.benchedOrders, 0)}`)
  assert.ok(on.stats.afterNoSite.length >= 3)
  for (const a of on.stats.afterNoSite.filter(x => x.wait < 24 * H)) assert.ok(a.to !== a.from, `after no_site on ${a.from} the next order was ${a.to}`)
  assert.equal(off.bots.reduce((n, b) => n + b.benchedOrders, 0), 0, 'control: off, none')
  // the room refusal names its remedy and the remedy is taken: the full bag is banked and the bot builds (the chain, not the guard)
  const full = on.bots[13]
  assert.ok(on.stats.bank >= 1 && full.freeSlots === 30 && full.orders.length >= 20, `the full-bag bot: ${on.stats.bank} bank order(s), then ${full.orders.length} build visits`)
})
await t('(c) REPAIRS AND SERVICE KEEP THEIR PRIORITY (review r1, blockers 1 and 2): the house, backed off by no-op visits, is mended within minutes of FRESH damage; a repair that keeps failing backs off on its own count; the crop farm, backed off the same way, is still served on its schedule', () => {
  const { on, off } = SIM
  const dmg = on.T0 + 6 * H
  // blocker 1. The precondition: the upkeep visits that did nothing had the house backed off for the pool as the damage landed
  assert.ok(on.count('house1', 4.5, 6) >= 2, `no-op visits to the house before the damage: ${on.count('house1', 4.5, 6)}`)
  assert.equal(on.stats.houseBackedOffAtDamage, true, 'the house was inside its no-progress back-off when the cell broke')
  assert.ok(on.stats.repairStart.length >= 2 && on.stats.repairStart.length <= 3, `two repair visits mend it (a third may start beside the second): ${on.stats.repairStart.length}`)
  assert.ok(on.stats.repairStart[0] - dmg <= 12 * MIN, `the first repair ${((on.stats.repairStart[0] - dmg) / MIN).toFixed(1)} min after the damage`)
  assert.ok(on.stats.repairStart[1] - dmg <= 15 * MIN)
  assert.equal(on.proj.house1.broken, 0)
  assert.ok(off.stats.repairStart.length >= 2 && off.stats.repairStart[0] - dmg <= 15 * MIN, 'control: off, the same')
  // ...and a repair that itself keeps failing backs off, on the repairs' own count (20, 40, 60, 60 ... min: an hour is a complete record's cap)
  assert.ok(on.count('townhall', 0, 30) === 0 && on.count('townhall', 30, 31) >= 2, `the town hall's repair is tried as soon as it breaks: ${on.count('townhall', 30, 31)} visits in its first hour`)
  assert.ok(on.count('townhall', 36, 48) <= 14 && on.count('townhall', 36, 48) >= 8, `then about one an hour: ${on.count('townhall', 36, 48)} in 12 h`)
  assert.ok(off.count('townhall', 36, 48) > 5 * on.count('townhall', 36, 48), `control: off, ${off.count('townhall', 36, 48)}`)
  const hall = [...on.files.values()].map(f => f.townhall).filter(Boolean)
  assert.ok(hall.some(e => e.rn > 0) && hall.every(e => !(e.n > 0)), 'counted as repairs, never against the project\'s own count')
  // blocker 2. The crop farm's service visits do nothing, and its no-op repair visits have it backed off -- the service is still ordered
  assert.ok([...on.files.values()].some(f => f.cropfarm?.n > 0), 'precondition: the farm has a no-progress count (its visits that were no service)')
  assert.ok((on.stats.out.cropfarm.complete ?? 0) >= 80 && on.stats.placed > 0, 'precondition: its visits, the service\'s too, place nothing')
  assert.ok(on.stats.serviceStart.length >= 80, `service visits: ${on.stats.serviceStart.length} of 96`)
  assert.ok(on.stats.serviceStart.length >= off.stats.serviceStart.length - 3, `not fewer than today (${off.stats.serviceStart.length})`)
  let sg = 0; for (let k = 1; k < on.stats.serviceStart.length; k++) sg = Math.max(sg, on.stats.serviceStart[k] - on.stats.serviceStart[k - 1])
  assert.ok(sg <= 45 * MIN, `the longest wait between two services: ${(sg / MIN).toFixed(0)} min`)
  // ...and no bot is left without an order while work it could do stands open (30 min in all, of 48 h, for the worst bot)
  assert.ok(on.starveMax <= 30 * MIN, `${(on.starveMax / MIN).toFixed(1)} min`)
  assert.ok(on.gap('stepwell') <= H, 'the other work is still ordered')
  // the town clean-up is not starved by the rotation
  assert.ok(on.stats.visits.tidy >= off.stats.visits.tidy, `tidy visits: ${on.stats.visits.tidy} against ${off.stats.visits.tidy}`)
})
await t('(g) ONE PROBE AT A TIME, FOR AS LONG AS THE VISIT LASTS (review r1, blocker 3): no second bot starts on a backed-off project while one is on it -- eight-minute visits included; two bots that picked it in the same tick: one visits; a bot killed mid-probe: its lease lapses and the project is probed again', () => {
  const { on } = SIM
  for (const p of SIM_OPEN.filter(q => q !== 'stepwell' && q !== 'civicH')) assert.equal(on.overlaps(p), 0, `${p}: visits that ran beside another one once it had a count`)
  const long = on.stats.spans.wallext.filter(x => !x.killed && x.e != null)
  assert.ok(long.length >= 8 && long.every(x => x.e - x.s >= 8 * MIN), `the wall extension's visits last 8 min (${long.length} of them)`)
  // the same tick, the same reading of the leases: it happened, and each time one bot stepped aside and worked its next pick
  assert.ok(on.stats.asides >= 1, `picks stepped aside from at the visit's start: ${on.stats.asides}`)
  assert.ok(on.stats.asideEnds < on.stats.asides, `the next pick was worked in the same visit ${on.stats.asides - on.stats.asideEnds} time(s); ${on.stats.asideEnds} visit(s) ended with nothing else open`)
  // the killed prober: nothing reported, nothing released
  const k = on.stats.kill
  assert.ok(k && on.stats.spans.wallext.some(x => x.killed), 'a bot was killed two minutes into a wall-extension probe')
  const next = on.stats.starts.wallext.find(x => x > k.at)
  assert.ok(next >= k.at + on.LEASE - on.TICK, `nobody starts beside the dead bot's lease: the next visit ${((next - k.at) / MIN).toFixed(1)} min after the kill (the lease lapses after ${on.LEASE / MIN})`)
  assert.ok(next <= k.at + 2 * H, 'and the project is probed again -- never "under way" for good')
  assert.ok(on.gap('wallext') <= 8 * H)
})
await t('(d) NO PROGRESS IS CHEAP: visits to a hopeless project fall to the cap -- about one per 6 h (one an hour for the finished paths) -- from hundreds a day', () => {
  const { on, off } = SIM
  for (const p of ['wallext', 'cottage2', 'pens', 'civicM']) {
    assert.ok(on.count(p, 0, 12) >= 4, `${p}: tried ${on.count(p, 0, 12)} times in the first 12 h (20, 40, 80 ... min)`)
    assert.ok(on.count(p, 24, 48) <= 5, `${p}: ${on.count(p, 24, 48)} visits in the second day`)
    assert.ok(on.count(p, 24, 48) >= 3, `${p}: still asked (${on.count(p, 24, 48)} in the second day): bounded, not abandoned`)
  }
  assert.ok(on.count('monument', 24, 48) <= 5 && on.count('monument', 24, 48) >= 3, `the stamped ziggurat: ${on.count('monument', 24, 48)} in the second day`)
  assert.ok(on.count('paths', 24, 48) <= 26, `the finished paths: ${on.count('paths', 24, 48)} visits in the second day`)
  assert.ok(on.count('paths', 24, 48) >= 12, 'and still about one an hour: a real repair there is never left for long')
  assert.ok(off.count('wallext', 24, 48) > 10 * on.count('wallext', 24, 48) && off.count('paths', 24, 48) > 4 * on.count('paths', 24, 48), `control: off, the same projects many times over (${off.count('wallext', 24, 48)}, ${off.count('paths', 24, 48)})`)
  // an interruption is not evidence: the step well's aborted visits never backed it off
  assert.ok((on.stats.out.stepwell.aborted ?? 0) >= 20, 'the well\'s visits were interrupted')
  assert.ok([...on.files.values()].every(f => !(f.stepwell?.n > 0)), 'and no holder counts one against it')
})
await t('(e) A PROJECT THAT STARTS MAKING PROGRESS RETURNS TO NORMAL CADENCE: civicH, hopeless until hour 20, is back in the rotation once a visit places a block', () => {
  const { on } = SIM
  assert.ok(on.count('civicH', 12, 20) <= 2, `while hopeless: ${on.count('civicH', 12, 20)} visits in 8 h`)
  const first = on.stats.starts.civicH.find(x => x >= on.T0 + 20 * H)
  assert.ok(first - (on.T0 + 20 * H) <= 8 * H, `its first visit after it became workable: ${((first - on.T0) / H).toFixed(1)} h`)
  const after = on.stats.starts.civicH.filter(x => x > first)
  assert.ok(after.length >= 100, `${after.length} visits after that one`)
  assert.ok(after[0] - first <= 30 * MIN, `the next visit ${((after[0] - first) / MIN).toFixed(0)} min later, not 6 h`)
  assert.ok(on.gap('civicH', first, on.END) <= H, `longest wait from then on: ${(on.gap('civicH', first, on.END) / MIN).toFixed(0)} min`)
  // ...beside the step well, not instead of it
  assert.ok(on.gap('stepwell', first, on.END) <= H)
})
await t('THE SIMULATION KILLS THE MUTANTS: the hold\'s scope, the reset, the cap, the classifier, the repair\'s own count, the service\'s exemption, the probe\'s lease and its claim -- each breaks the property it carries (the aging comparison is killed on the pure choice above)', async () => {
  const run = async (ptPairs, shopPairs) => { let r = null; await withTurn(ptPairs, shopPairs, (Sm, PTm) => { r = simulate(Sm, PTm, { turn: true }) }); return r }
  // the scope: the bot-wide hold again -> bots are benched with work open
  const scope = await run([], [["&& stuckRetryHolds(plot0, stuckPlot)) return { order: null, skip: 'stuck_on_cell' }", "&& true) return { order: null, skip: 'stuck_on_cell' }"]])
  assert.equal(scope.bots.reduce((n, b) => n + b.benchedOrders, 0), 0, 'scope mutant: no bot is ordered anywhere inside its own 6 h')
  assert.ok(scope.stats.visits.stepwell < SIM.on.stats.visits.stepwell, `scope mutant: the well ${scope.stats.visits.stepwell} visits against ${SIM.on.stats.visits.stepwell}`)
  // the reset: one ordinary visit that places nothing costs the working civicH 6 h again, not 20 min
  const reset = await run([[RESET, '  if (outcome === \'progress\') return own ?? null\n']], [])
  assert.ok(reset.count('civicH', 30, 48) < SIM.on.count('civicH', 30, 48) / 2 && SIM.on.count('civicH', 30, 48) >= 80, `reset mutant: civicH ${reset.count('civicH', 30, 48)} visits in hours 30-48 against ${SIM.on.count('civicH', 30, 48)}`)
  // the cap: the hopeless projects' waits grow without bound
  const cap = await run([['  return Math.min(Math.max(0, Number(cap) || 0), T.baseMs * 2 ** Math.min(k - 1, 30))\n', '  return T.baseMs * 2 ** Math.min(k - 1, 30)\n']], [])
  assert.ok(cap.gap('wallext') > 12 * H && SIM.on.gap('wallext') <= 8 * H, `cap mutant: the wall extension waited ${(cap.gap('wallext') / H).toFixed(1)} h`)
  // the no-progress classifier: an abort counted as evidence backs the working step well off
  const abort = await run([["  if (r.status === 'aborted' || stop === 'aborted') return 'none'\n", "  if (r.status === 'aborted' || stop === 'aborted') return 'no_progress'\n"]], [])
  assert.ok(abort.stats.visits.stepwell < SIM.on.stats.visits.stepwell * 0.8, `abort mutant: the well ${abort.stats.visits.stepwell} visits against ${SIM.on.stats.visits.stepwell}`)
  // blocker 1 -- the repair gated by the project's own count: the house waits out the back-off its no-op visits earned
  const dmg = SIM.on.T0 + 6 * H
  const repair = await run([[REPAIR, '    const repair = false\n']], [])
  assert.ok(repair.stats.repairStart[0] - dmg > 20 * MIN && SIM.on.stats.repairStart[0] - dmg <= 12 * MIN, `repair mutant: the first repair ${((repair.stats.repairStart[0] - dmg) / MIN).toFixed(0)} min after the damage against ${((SIM.on.stats.repairStart[0] - dmg) / MIN).toFixed(0)}`)
  // blocker 2 -- the service offer not exempt: the pick passes the farm, the order refuses it, and nothing is ordered meanwhile
  const service = await run([[SERVICE, '']], [])
  assert.ok(service.starveMax > 2 * H && service.stats.serviceStart.length < SIM.on.stats.serviceStart.length * 0.8, `service mutant: ${service.stats.serviceStart.length} services against ${SIM.on.stats.serviceStart.length}; a bot unordered with work open ${(service.starveMax / H).toFixed(1)} h`)
  // blocker 3 -- the lease not read: bots keep being ordered to a project another is on, and only the claim turns them away
  const lease = await run([[LEASED, '']], [])
  assert.ok(lease.stats.asides > SIM.on.stats.asides + 10, `lease mutant: ${lease.stats.asides} picks stepped aside from against ${SIM.on.stats.asides}`)
  // ...and with neither the lease read nor the claim, two bots are on a backed-off project at once
  const claim = await run([[LEASED, ''], [CLAIM, 'export const turnClaimNeeded = e => false && ']], [])
  assert.ok(['wallext', 'cottage2', 'civicM'].reduce((n, p) => n + claim.overlaps(p), 0) >= 3, `claim mutant: ${['wallext', 'cottage2', 'civicM'].map(p => claim.overlaps(p))} visits ran beside another`)
})

// ================================================================================================================================
// 3. THE FILES
// ================================================================================================================================
const HOME = { x: 0, y: 70, z: 0 }
await t('the turn files: one per holder, merged by the reader; a holder rewrites only its own; a torn or foreign file is skipped; another town\'s files are not read', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-projturn-files-'))
  assert.deepEqual(PJ.turnRead(d, HOME), [])
  assert.deepEqual(PJ.turnRead(path.join(d, 'missing'), HOME), [])
  assert.ok(PJ.turnWrite(d, HOME, 'showcase-Gale', { monument: { at: NOW, n: 2, noAt: NOW, okAt: null, gen: 7, stop: 'stuck_on_cell' } }, { now: NOW }))
  assert.ok(PJ.turnWrite(d, HOME, 'showcase/Bravo', { monument: { at: NOW + 1000, n: 0, noAt: null, okAt: NOW + 1000, gen: 7, stop: null }, wall: { at: NOW } }, { now: NOW + 1000 }))
  assert.ok(PJ.turnWrite(d, { x: 9, y: 70, z: 9 }, 'showcase-Gale', { monument: { at: NOW, n: 9, noAt: NOW } }, { now: NOW }))
  fs.writeFileSync(path.join(d, 'projturn-0_70_0.Torn.json'), '{"v":1,"holder":"Torn","plots":{"monument":{"n":')
  fs.writeFileSync(path.join(d, 'projturn-0_70_0.NoPlots.json'), '{"v":1,"holder":"NoPlots"}')
  const all = PJ.turnRead(d, HOME)
  assert.deepEqual(all.map(f => f.holder).sort(), ['showcase-Gale', 'showcase/Bravo'])
  assert.deepEqual(all.find(f => f.holder === 'showcase-Gale').plots.monument, { at: NOW, n: 2, noAt: NOW, rn: 0, rnoAt: null, okAt: null, gen: 7, stop: 'stuck_on_cell' })
  assert.deepEqual(all.find(f => f.holder === 'showcase/Bravo').plots.wall, { at: NOW, n: 0, noAt: null, rn: 0, rnoAt: null, okAt: null, gen: null, stop: null }, 'a missing field reads as nothing')
  assert.deepEqual(PJ.turnRead(d, HOME, { holder: 'showcase-Gale' }).map(f => f.holder), ['showcase-Gale'])
  assert.deepEqual(PJ.turnRead(d, HOME, { holder: 'Nobody' }), [])
  // merged: Bravo's progress ends Gale's count
  assert.equal(PT.turnView(all, { now: NOW + 2000, genOf: () => 7 }).get('monument').n, 0)
  assert.equal(PT.turnView(all.filter(f => f.holder === 'showcase-Gale'), { now: NOW + 2000, genOf: () => 7 }).get('monument').n, 2, 'control: Gale\'s file alone')
  // the pruner never takes one, and no temp file is left
  assert.deepEqual(PJ.pruneCandidates(fs.readdirSync(d), { now: NOW + 100 * 24 * H, mtime: () => 0, read: () => ({ until: 0 }) }), [])
  assert.ok(fs.readdirSync(d).every(n => !n.endsWith('.tmp')))
  assert.equal(PJ.turnWrite('/dev/null/nope', HOME, 'x', {}), false, 'an unwritable town answers false, never throws')
})
await t('REVIEW r2 -- a departed bot\'s file ages out: a holder\'s file not written for a day no longer counts (the asker\'s own is never aged out); MUTANT killed', async () => {
  const scenario = P => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-projturn-stale-'))
    assert.ok(P.turnWrite(d, HOME, 'showcase-Gone', { monument: { at: NOW - 30 * H, n: 9, noAt: NOW - 30 * H, okAt: null, gen: 7, stop: 'stuck_on_cell' } }, { now: NOW - P.TURN_STALE_MS }))
    assert.ok(P.turnWrite(d, HOME, 'showcase-Gale', { monument: { at: NOW - H, n: 1, noAt: NOW - H, okAt: null, gen: 7, stop: 'stuck_on_cell' } }, { now: NOW - H }))
    assert.equal(P.TURN_STALE_MS, 24 * H)
    assert.deepEqual(P.turnRead(d, HOME, { now: NOW }).map(f => f.holder), ['showcase-Gale'], 'a day since its last write: the departed bot\'s file is not read')
    assert.equal(PT.turnView(P.turnRead(d, HOME, { now: NOW }), { now: NOW, genOf: () => 7 }).get('monument').n, 1, 'its nine no longer add to the pool\'s count')
    assert.deepEqual(P.turnRead(d, HOME, { now: NOW - 1 }).map(f => f.holder).sort(), ['showcase-Gale', 'showcase-Gone'], 'control: a millisecond younger, it counts')
    assert.deepEqual(P.turnRead(d, HOME, { holder: 'showcase-Gone', now: NOW + 99 * H }).map(f => f.holder), ['showcase-Gone'], 'a holder\'s read of its own file is never aged out')
  }
  scenario(PJ)
  let why = null
  await withCopy('buildproj.mjs', [['.filter(f => f && now - f.at < TURN_STALE_MS)', '.filter(Boolean)']], P => { try { scenario(P) } catch (e) { why = e } })
  assert.ok(why instanceof assert.AssertionError, `MUTANT (no age-out) survived or died for another reason: ${String(why?.stack ?? 'survived').split('\n')[0]}`)
})

// ================================================================================================================================
// 4. THE GLUE, on real record, stuck and turn files (skills.mjs shopActive, the order's hooks)
// ================================================================================================================================
const LG = await import('../src/logger.mjs')
const rows = []
LG.tapRecords(r => rows.push(r))
const turnRows = op => rows.filter(r => r?.skill?.name === '_shop_turn' && String(r.skill.detail).startsWith(`op=${op} `)).map(r => r.skill.detail)
const SK = await import('../src/skills.mjs')
const X = SK._projturn
const dir = () => process.env.POOL_STATE_DIR
const key = plot => PJ.projKey(HOME, plot)
const rec = (plot, blueprint, complete) => assert.equal(PJ.publishRecord(dir(), key(plot), () => ({ v: 1, blueprint, plot, cells: [{ at: [0, 0, 0], role: 'base', seg: 'a' }], segments: [{ seg: 'a', deps: [] }], structure_complete: complete, ...(complete ? { completeAt: 1 } : {}) })).result, 'accepted')
const ME = process.env.BOT_NAME
const mkBot = () => ({ username: ME, blockAt: () => null, entities: {}, inventory: { items: () => [], emptySlotCount: () => 30 }, entity: { position: { x: 3, y: 71, z: 4 } } })
const SKILLS_OFF = [["import { PROJTURN, turnExempt, turnOwnNeed, turnPickInfo, setTurnNow, stuckWindowOf, SHOP_SITE_RETRY_MS } from './shop.mjs'", "import { turnExempt, turnOwnNeed, turnPickInfo, setTurnNow, stuckWindowOf, SHOP_SITE_RETRY_MS } from './shop.mjs'\nconst PROJTURN = Object.freeze({ on: false })"]]
let T1 = Date.now()
const tick = (ms = 20_000) => { T1 += ms; return T1 }   // past the view's memo (TURN.readMs)

await t('the town of this file: the workshop, the house and the paths stand; the ziggurat and the wall are open -- and nothing else is in the order', () => {
  assert.deepEqual(S.projectsOn().map(p => p.plot), ['shop', 'house1', 'monument', 'paths', 'wall'])
  rec('shop', 'workshop@1', true); rec('house1', 'house@1', true); rec('paths', 'paths@1', true)
  rec('monument', 'ziggurat@1', false); rec('wall', 'wall@1', false)
  assert.equal(SK.shopActive(null, tick()).plot, 'monument', 'no turn file yet: never visited, the order breaks the tie')
  assert.deepEqual(fs.readdirSync(dir()).filter(n => n.startsWith('projturn-')), [], 'reading the pick writes nothing')
})
const cleanTurns = () => { for (const n of fs.readdirSync(dir()).filter(x => x.startsWith('projturn-'))) fs.unlinkSync(path.join(dir(), n)); SK.shopTurnForget() }
await t('THE VISIT (real files, the glue, the order\'s real hooks): its start is stamped and logged; a no-progress end backs the project off for the pool and the order skips it; another one lengthens it; an abort changes nothing; progress ends it; so does a published generation', async () => {
  cleanTurns()
  const bot = mkBot()
  let now = Date.now() - 4 * MIN      // the order's hooks read the real clock: the first visit ended a minute ago
  assert.equal(SK.shopActive(null, now).plot, 'monument')
  rows.length = 0
  bot.shopVisitPlot = 'monument'
  X.turnBegin(bot, 'monument', now)
  assert.deepEqual(turnRows('pick'), ['op=pick project=monument why=tier age_min=never backed_off=0 eligible=0'], 'one pick row a visit')
  assert.equal(PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.monument.at, now)
  assert.equal(SK.shopActive(null, now).plot, 'wall', 'the ziggurat has had its turn')
  // the visit ends stuck_on_cell, nothing placed
  now += 3 * MIN
  X.turnNote(bot, { status: 'no_effect', stop: 'stuck_on_cell' }, {}, now)
  assert.deepEqual(bot.shopTurnLast, { plot: 'monument', stop: 'stuck_on_cell', at: now })
  const e1 = PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.monument
  assert.deepEqual([e1.n, e1.noAt, e1.stop, e1.gen], [1, now, 'stuck_on_cell', 1])
  assert.equal(turnRows('backoff').length, 1)
  assert.match(turnRows('backoff')[0], /^op=backoff project=monument n=1 until_min=2[0-5] stop=stuck_on_cell$/)
  assert.equal(X.turnBackedOff(null, 'monument', now + MIN), true)
  assert.equal(X.turnBackedOff(null, 'wall', now + MIN), false, 'control: the wall is not')
  assert.equal(X.turnBackedOff(null, 'monument', now + 26 * MIN), false, 'the first back-off is over inside 25 min')
  // the order (skills.mjs's own hooks): the backed-off pick is skipped by name; the other project is ordered
  assert.deepEqual(S.buildOrder({ shared: true, atTown: true, now: Date.now(), planned: true, record: { plot: 'monument' } }), { order: null, skip: 'no_progress' })
  assert.deepEqual(S.buildOrder({ shared: true, atTown: true, now: Date.now(), planned: true, record: { plot: 'wall' } }), ORDER, 'control: the wall is ordered')
  // another bot's no-progress visit adds to the pool's count; this bot's second lengthens it again
  assert.ok(PJ.turnWrite(dir(), HOME, 'showcase-Gale', { monument: { at: now + 30 * MIN, n: 1, noAt: now + 33 * MIN, okAt: null, gen: 1, stop: 'cell_deferred' } }, { now: now + 33 * MIN }))
  now += 90 * MIN      // past the pool's second back-off (40-50 min from Gale's visit)
  SK.shopTurnForget()
  bot.shopVisitPlot = 'monument'
  assert.equal(X.turnBegin(bot, 'monument', now), true, 'the back-off over: the bot goes back (and claims the probe: its slot lease)')
  assert.ok(Number.isInteger(bot.shopTurnVisit.claim?.gen), 'the claim is the project\'s slot 1')
  assert.equal(PJ.leaseState(dir(), key('monument'), 'slot1').rec.holder, ME)
  X.turnNote(bot, { status: 'no_effect', stop: 'cell_deferred' }, {}, now + MIN)
  assert.equal(PJ.leaseState(dir(), key('monument'), 'slot1').released, true, 'a visit that never took the slot itself: the claim is given back at its end')
  assert.match(turnRows('backoff').at(-1), /^op=backoff project=monument n=3 until_min=(8\d|9\d|100) stop=cell_deferred$/, 'three in a row for the pool: 80-100 min')
  // an aborted visit: the start stamped, no count, no row, the bot's last stop `aborted`
  const nRows = turnRows('backoff').length
  bot.shopVisitPlot = 'wall'; assert.equal(X.turnBegin(bot, 'wall', now + 2 * MIN), true); X.turnNote(bot, { status: 'aborted', stop: 'aborted' }, {}, now + 3 * MIN)
  assert.deepEqual([PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.wall.at, PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.wall.n], [now + 2 * MIN, 0])
  assert.equal(turnRows('backoff').length, nRows)
  assert.equal(bot.shopTurnLast.stop, 'aborted')
  assert.equal(X.turnBackedOff(null, 'wall', now + 4 * MIN), false, 'an interruption backs nothing off')
  assert.equal(X.turnBackedOff(null, 'monument', now + 4 * MIN), true, 'control: the ziggurat\'s count stands')
  // progress, once the back-off is over: the count ends for the pool, one row says so
  now += 2 * H
  bot.shopVisitPlot = 'monument'; assert.equal(X.turnBegin(bot, 'monument', now), true); X.turnNote(bot, { status: 'success', stop: 'deadline', placed: 3 }, {}, now + 3 * MIN)
  assert.equal(turnRows('backoff').at(-1), 'op=backoff project=monument n=0 until_min=0 stop=deadline')
  assert.equal(X.turnBackedOff(null, 'monument', now + 4 * MIN), false)
  // ...and a second progress visit writes no row (nothing to end) and needs no claim (no count)
  const n2 = turnRows('backoff').length
  bot.shopVisitPlot = 'monument'; assert.equal(X.turnBegin(bot, 'monument', now + 20 * MIN), true); assert.equal(bot.shopTurnVisit.claim, null)
  X.turnNote(bot, { status: 'success', stop: 'deadline', placed: 3 }, {}, now + 23 * MIN)
  assert.equal(turnRows('backoff').length, n2)
  // a published generation ends a back-off: what the visits found wanting has changed
  bot.shopVisitPlot = 'wall'; X.turnBegin(bot, 'wall', now + 30 * MIN); X.turnNote(bot, { status: 'no_effect', stop: 'no_material' }, {}, now + 31 * MIN)
  assert.equal(X.turnBackedOff(null, 'wall', now + 32 * MIN), true)
  assert.equal(PJ.publishRecord(dir(), key('wall'), cur => ({ ...cur, waived: { '0,0,0': { why: 'test' } } })).result, 'accepted')
  SK.shopTurnForget()
  assert.equal(X.turnBackedOff(null, 'wall', now + 32 * MIN), false)
  // ...and a visit DURING which the record moved (it sited, waived or reopened something) is not counted at all
  const nb = turnRows('backoff').length
  bot.shopVisitPlot = 'wall'; X.turnBegin(bot, 'wall', now + 33 * MIN)
  assert.equal(PJ.publishRecord(dir(), key('wall'), cur => ({ ...cur, waived: { ...cur.waived, '1,0,0': { why: 'test' } } })).result, 'accepted')
  X.turnNote(bot, { status: 'no_effect', stop: 'cell_deferred' }, {}, now + 34 * MIN)
  assert.deepEqual([PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.wall.n, turnRows('backoff').length], [1, nb], 'the count as it was (the earlier one, on the old generation), no row')
  bot.shopVisitPlot = 'wall'; X.turnBegin(bot, 'wall', now + 35 * MIN); X.turnNote(bot, { status: 'no_effect', stop: 'cell_deferred' }, {}, now + 36 * MIN)
  assert.deepEqual([PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.wall.n, turnRows('backoff').length], [1, nb + 1], 'control: the same visit with the record still -- counted, from one (the old generation\'s count is not carried)')
  // a service visit and an exempt plot are never stamped or counted
  bot.serviceVisit = { plot: 'paths' }; bot.shopVisitPlot = 'paths'; X.turnBegin(bot, 'paths', now + 40 * MIN); X.turnNote(bot, { status: 'no_effect', stop: 'complete' }, {}, now + 41 * MIN)
  assert.equal(PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.paths, undefined)
  bot.serviceVisit = null; bot.shopVisitPlot = 'paths'; X.turnBegin(bot, 'paths', now + 42 * MIN); X.turnNote(bot, { status: 'no_effect', stop: 'complete' }, {}, now + 43 * MIN)
  assert.equal(PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.paths.n, 1, 'control: the same finished project visited for nothing as a repair IS counted (the live paths)')
  assert.equal(X.turnMarksNow(null, [st('paths', { complete: true, damaged: true })], now + 44 * MIN)[0].damaged, false, 'and it stops reading as a repair for the pool')
  // ...and where the finished paths are STILL the pick (the order's own completion check reads the damage, not the back-off), the
  // order skips them by name instead of issuing one more visit for nothing
  assert.equal(X.turnBackedOff(null, 'paths', now + 44 * MIN), true)
  assert.equal(X.turnBackedOff(null, 'paths', now + 43 * MIN + 26 * MIN), false, 'control: past the first back-off (20-25 min) they are asked again')
  bot.shopVisitPlot = 'tidy'; X.turnBegin(bot, 'tidy', now + 44 * MIN); X.turnNote(bot, { status: 'no_effect', stop: 'stuck_on_cell' }, {}, now + 45 * MIN)
  assert.equal(PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.tidy, undefined)
  assert.deepEqual(bot.shopTurnLast, { plot: 'tidy', stop: 'stuck_on_cell', at: now + 45 * MIN }, 'the bot\'s last stop is kept for every plot (the order\'s hold reads it)')
})
await t('THE STAMP FIRST (real files): a stamped ziggurat is passed by everyone, whatever the turn files say; MUTANT (the marks over the unstamped states) killed', async () => {
  cleanTurns()
  const now = tick()
  assert.ok(PJ.stuckWrite(dir(), key('monument'), 'showcase-Gale', { '-33,67,-33': { visits: 3 } }, { now, stuckAt: now - 60_000 }))
  assert.equal(SK.shopActive(null, now).plot, 'wall')
  // ...and a progress visit recorded after the stamp does not lift it, nor does the ziggurat being the longest unvisited
  assert.ok(PJ.turnWrite(dir(), HOME, 'showcase-Gale', { monument: { at: now - 30_000, n: 0, noAt: null, okAt: now - 30_000, gen: 1, stop: null }, wall: { at: now - 10_000, n: 0, noAt: null, okAt: now - 10_000, gen: 2, stop: null } }, { now }))
  SK.shopTurnForget()
  assert.equal(SK.shopActive(null, now).plot, 'wall', 'the wall, though it was visited more recently than the ziggurat: the stamp holds')
  assert.equal(S.buildOrder({ shared: true, atTown: true, now, planned: true, record: { plot: 'monument' }, stuckAt: PJ.stuckAt(dir(), key('monument')) }).skip, 'stuck_on_cell')
  await withCopy('skills.mjs', [['    if (PROJTURN.on) marked.splice(0, marked.length, ...turnMarksNow(b, marked, now))\n', '    if (PROJTURN.on) marked.splice(0, marked.length, ...turnMarksNow(b, states, now))\n']], M => {
    assert.equal(M.shopActive(null, now).plot, 'monument', 'the mutant offers the stamped ziggurat (the older visit)')
  })
  assert.equal(SK.shopActive(null, now).plot, 'wall', 'the real module, same files')
  // the stamp goes (its holder's file rewritten without one): the aging decides
  assert.ok(PJ.stuckWrite(dir(), key('monument'), 'showcase-Gale', {}, { now, stuckAt: null }))
  assert.equal(SK.shopActive(null, tick()).plot, 'monument', 'control: no stamp -- the ziggurat, visited longer ago than the wall')
})
await t('THE AGING (real files): another bot\'s visit to the ziggurat sends this bot to the wall; PROJTURN off and the mutant without the marks keep the first in order; off reads and writes no turn file', async () => {
  cleanTurns()
  const now = tick()
  assert.equal(SK.shopActive(null, now).plot, 'monument', 'control: no turn file')
  assert.ok(PJ.turnWrite(dir(), HOME, 'showcase-Gale', { monument: { at: now - 5_000, n: 0, noAt: null, okAt: null, gen: 1, stop: null }, wall: { at: now - 60_000, n: 0, noAt: null, okAt: null, gen: 2, stop: null } }, { now }))
  SK.shopTurnForget()
  assert.equal(SK.shopActive(null, now).plot, 'wall')
  const before = fs.readdirSync(dir()).sort()
  await withCopy('skills.mjs', SKILLS_OFF, M => {
    assert.equal(M.shopActive(null, now).plot, 'monument', 'PROJTURN off: the first free project in order, the turn files unread')
    assert.deepEqual(fs.readdirSync(dir()).sort(), before, 'and nothing written')
  })
  await withCopy('skills.mjs', [['    if (PROJTURN.on) marked.splice(0, marked.length, ...turnMarksNow(b, marked, now))\n', '']], M => {
    assert.equal(M.shopActive(null, now).plot, 'monument', 'the mutant without the marks')
  })
  // the switch is wired at every call site (structure: behaviour above covers the pick; these are the reads and the writes)
  const src = strip(fs.readFileSync(SRC('skills.mjs'), 'utf8'))
  for (const line of ['if (PROJTURN.on) marked.splice(0, marked.length, ...turnMarksNow(b, marked, now))', 'if (PROJTURN.on && b) b.shopTurnSvc = svc?.plot ?? null', 'if (PROJTURN.on && b && visit) b.shopTurnInfo = {', 'if (PROJTURN.on && !turnBegin(bot, proj.plot, Date.now(), aside > 0)) return aside >= TURN.asideMax ? turnAside(bot, proj.plot, t0) : buildShopVisitRun(ctx, args, signal, aside + 1)', 'if (PROJTURN.on) turnNote(ctx.bot, res, args)', 'if (PROJTURN.on) setTurnNow({'])
    assert.equal(src.split(line).length, 2, `WIRING MISSING OR NOT UNIQUE: ${line}`)
  assert.equal(src.split('turnBegin(').length, 2, 'turnBegin: the visit\'s one call')
  assert.equal(src.split('turnNote(').length, 3, 'turnNote: the call every visit\'s result passes (buildShop `note`) and the one for a visit that threw (buildShopVisit)')
  assert.equal(src.split('const proj = shopActive(bot, Date.now(), { visit: true })').length, 2, 'the visit\'s pick: one line, as it was')
  assert.equal(strip(fs.readFileSync(SRC('shop.mjs'), 'utf8')).split('turn = PROJTURN.on } = {}) {').length, 2, 'the order\'s switch defaults to PROJTURN')
})
await t('THE BOT\'S OWN HOLD (a fresh skills.mjs, a bot the order has seen): stuck on the ziggurat, it is passed to the wall and ORDERED there; without the mark the bot-wide hold stands', async () => {
  cleanTurns()
  await withCopy('skills.mjs', [], M => {
    const bot = mkBot(), now = Date.now()
    assert.equal(M.shopActive(bot, now).plot, 'monument')
    const state = { lastAt: now - 11 * MIN, lastStop: 'stuck_on_cell' }
    // no mark yet (a restart): the plot unknown -- the order holds every project, as before
    assert.deepEqual(S.buildOrder({ shared: true, atTown: true, now, planned: true, record: { plot: 'wall' }, state }), { order: null, skip: 'stuck_on_cell' })
    // the bot's own last visit ended stuck on the ziggurat 11 min ago (buildShop's note); the pool's back-off of 20 min is on too
    bot.shopVisitPlot = 'monument'; M._projturn.turnBegin(bot, 'monument', now - 14 * MIN); M._projturn.turnNote(bot, { status: 'no_effect', stop: 'stuck_on_cell' }, {}, now - 11 * MIN)
    assert.deepEqual(M._projturn.turnHoldNow(bot, now), { plot: 'monument', stop: 'stuck_on_cell' })
    assert.equal(M.shopActive(bot, now).plot, 'wall', 'the picker passes the held project')
    assert.deepEqual(S.buildOrder({ shared: true, atTown: true, now, planned: true, record: { plot: 'wall' }, state }), ORDER, 'and the order is issued for the wall: the hold is the project\'s')
    assert.deepEqual(S.buildOrder({ shared: true, atTown: true, now, planned: true, record: { plot: 'monument' }, state }), { order: null, skip: 'stuck_on_cell' }, 'the ziggurat itself is still skipped')
    // the visit's own pick: one row, with what the aging saw
    rows.length = 0
    assert.equal(M.shopActive(bot, now, { visit: true }).plot, 'wall')
    M._projturn.turnBegin(bot, 'wall', now)
    assert.deepEqual(turnRows('pick'), ['op=pick project=wall why=only age_min=never backed_off=0 eligible=1'])
    // past the pool's back-off the bot's own 6 h still pass the ziggurat for THIS bot; another bot (no mark) is offered it again
    const later = now + 2 * H
    assert.equal(M._projturn.turnBackedOff(bot, 'monument', later), false)
    assert.deepEqual(M._projturn.turnMarksNow(bot, [st('monument'), st('wall')], later).map(x => x.free), [false, undefined])
    assert.deepEqual(M._projturn.turnMarksNow({ ...mkBot(), username: 'showcase-Other' }, [st('monument'), st('wall')], later).map(x => x.free), [undefined, undefined])
    assert.equal(M._projturn.turnHoldNow(bot, now + 6 * H), null, 'and after 6 h it is this bot\'s again too')
    // THE VISIT'S OWN PROJECT STANDS FOR THE WHOLE VISIT: a co-builder's no-progress result backs the wall off for everyone else, never
    // for the bot that is on it now (its reads of the active project must not move half way)
    bot.shopVisitBusy = true
    assert.equal(bot.shopTurnVisit?.plot, 'wall', 'precondition: the bot is on the wall (turnBegin above)')
    assert.ok(PJ.turnWrite(dir(), HOME, 'showcase-Gale', { wall: { at: now - MIN, n: 3, noAt: now + 1000, okAt: null, gen: PJ.recordGenNow(dir(), key('wall')), stop: 'cell_deferred' } }, { now: now + 1000 }))
    assert.equal(M._projturn.turnMarksNow(bot, [st('wall')], now + 20_000)[0].backoff, undefined, 'the bot in the visit keeps the wall')
    assert.equal(M.shopActive(bot, now + 20_000).plot, 'wall')
    assert.equal(M._projturn.turnMarksNow({ ...mkBot(), username: 'showcase-Other' }, [st('wall')], now + 20_000)[0].backoff, true, 'control: for any other bot it is backed off')
    bot.shopVisitBusy = false
    assert.equal(M._projturn.turnMarksNow(bot, [st('wall')], now + 40_000)[0].backoff, true, 'control: the visit over, for this bot too')
  })
})

const world = new Map()
const mkAt = name => ({ username: name, blockAt: v => world.get(`${v.x},${v.y},${v.z}`) ?? null, entities: {}, inventory: { items: () => [], emptySlotCount: () => 30 }, entity: { position: { x: 3, y: 71, z: 4 } } })
const block = name => ({ name, boundingBox: name === 'air' ? 'empty' : 'block', getProperties: () => ({}) })
const freeSlots = plot => { for (const n of ['slot1', 'slot2']) { const l = PJ.leaseState(dir(), key(plot), n); if (l?.rec && !l.released) PJ.releaseLease(dir(), key(plot), n, l.rec.holder, l.gen) } }
await t('REVIEW r1, BLOCKER 1 (real files, a fresh skills.mjs): the standing house, backed off by visits that did nothing, takes a broken cell -> it is the pick and the order is issued at the next decision; the repair fails -> backed off on its own count, 20-25 min; MUTANT (the state without `broken`) killed', async () => {
  assert.equal(PJ.publishRecord(dir(), key('house1'), cur => ({ ...cur, cells: [{ at: [5, 70, 5], role: 'base', seg: 'a' }] })).result, 'accepted')
  const G = PJ.recordGenNow(dir(), key('house1'))
  const setup = M => {
    cleanTurns(); freeSlots('house1'); world.clear(); world.set('5,70,5', block('stone_bricks'))
    const bot = mkAt(ME), now = Date.now()
    assert.ok(PJ.turnWrite(dir(), HOME, 'showcase-Gale', { house1: { at: now - 2 * MIN, n: 3, noAt: now - MIN, okAt: null, gen: G, stop: 'complete' } }, { now }))
    M.shopActiveForget()
    assert.equal(M.shopActive(bot, now).plot, 'monument', 'the house stands whole: nothing there')
    assert.equal(M._projturn.turnBackedOff(bot, 'house1', now), true, 'and it is inside the back-off its no-op visits earned (an hour)')
    // THE CELL BREAKS (the world, not the record: no generation moves)
    world.set('5,70,5', block('air')); M.shopActiveForget()
    return { bot, now }
  }
  await withCopy('skills.mjs', [], M => {
    const { bot, now } = setup(M)
    assert.equal(M.shopActive(bot, now).plot, 'house1', 'the repair is the pick at the next decision')
    const hs = M.shopActiveStates().find(x => x.plot === 'house1')
    assert.deepEqual([hs.damaged, hs.broken], [true, true])
    assert.equal(M._projturn.turnBackedOff(bot, 'house1', now), false)
    assert.deepEqual(S.buildOrder({ shared: true, atTown: true, now, planned: true, record: { plot: 'house1', structure_complete: true }, complete: false }), ORDER, 'and the order is issued for it')
    // the repair visit places nothing (a cell it cannot mend)
    rows.length = 0
    bot.shopVisitPlot = 'house1'
    assert.equal(M._projturn.turnBegin(bot, 'house1', now), true)
    assert.equal(bot.shopTurnVisit.repair, true)
    M._projturn.turnNote(bot, { status: 'no_effect', stop: 'clears_wait' }, {}, now + 3 * MIN)
    const e = PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.house1
    assert.deepEqual([e.rn, e.rnoAt, e.n], [1, now + 3 * MIN, 0], 'counted as a repair')
    assert.match(turnRows('backoff').at(-1), /^op=backoff project=house1 n=1 until_min=2[0-5] stop=clears_wait repair=1$/)
    assert.equal(M.shopActive(bot, now + 5 * MIN).plot, 'monument', 'the failed repair is backed off')
    assert.equal(M.shopActive(bot, now + 3 * MIN + 26 * MIN).plot, 'house1', 'and tried again after 20-25 min')
  })
  await withCopy('skills.mjs', [['          ...(PROJTURN.on && damaged && recordDamaged(b, rec, { tidy: false, cells: true }) ? { broken: true } : {}) }\n', '          ...({}) }\n']], M => {
    const { bot, now } = setup(M)
    assert.equal(M.shopActive(bot, now).plot, 'monument', 'the mutant: the broken house waits out the hour')
    assert.equal(M._projturn.turnBackedOff(bot, 'house1', now), true)
  })
  // the one reason recordDamaged gives that is no cell's is passed over when the cells alone are asked (structure: the paths' extension
  // needs a routed town to be due; its back-off is the pure test's and the simulation's)
  const src = strip(fs.readFileSync(SRC('skills.mjs'), 'utf8'))
  const ic = src.indexOf('    if (cells) return false\n'), ip = src.indexOf('    if (r.blueprint === PATHS_BLUEPRINT && pathsExtendDue(bot, r)) return true\n'), id = src.indexOf('function recordDamaged (bot, r, { tidy = true, cells = false } = {}) {')
  assert.ok(id > 0 && ic > id && ip > ic && ip - ic < 200 && src.split('    if (cells) return false\n').length === 2, 'the cells-only answer ends just before the paths\' extension line (which stands as it was)')
  assert.equal(src.split('recordDamaged(b, rec, { tidy: false, cells: true })').length, 2)
  world.clear()
})
await t('REVIEW r1, BLOCKER 2 (real files, a fresh skills.mjs): the bot\'s service offer passes the order\'s gate as it passes the pick; with no offer the same plot is skipped; STRUCTURE: the gate and the pick call one function', async () => {
  await withCopy('skills.mjs', [], M => {
    cleanTurns()
    const bot = mkBot(), now = Date.now()
    assert.ok(PJ.turnWrite(dir(), HOME, 'showcase-Gale', { paths: { at: now - 2 * MIN, n: 3, noAt: now - MIN, okAt: null, gen: PJ.recordGenNow(dir(), key('paths')), stop: 'complete' } }, { now }))
    M.shopActive(bot, now)
    const q = { shared: true, atTown: true, now, planned: true, record: { plot: 'paths', structure_complete: true }, complete: false }
    assert.equal(M._projturn.turnBackedOff(bot, 'paths', now), true)
    assert.deepEqual(S.buildOrder(q), { order: null, skip: 'no_progress' }, 'control: no offer -- the backed-off plot is skipped')
    bot.shopTurnSvc = 'paths'       // as shopActive leaves it when prodserve's pick for this bot is this plot
    assert.equal(M._projturn.turnMarksNow(bot, [st('paths', { complete: true, due: true })], now)[0].backoff, undefined)
    assert.equal(M._projturn.turnBackedOff(bot, 'paths', now), false)
    assert.deepEqual(S.buildOrder(q), ORDER, 'the offer: the gate passes what the pick passed')
    bot.shopTurnSvc = 'wall'
    assert.deepEqual(S.buildOrder(q), { order: null, skip: 'no_progress' }, 'another plot\'s offer exempts nothing here')
  })
  const src = strip(fs.readFileSync(SRC('skills.mjs'), 'utf8'))
  assert.equal(src.split('turnBackoff(').length, 2, 'projturn.mjs turnBackoff is called in ONE place')
  assert.ok(/function turnMarksNow \(b, states, now = Date\.now\(\)\) \{[\s\S]{0,900}?const marks = turnBackoff\(states, /.test(src), '...inside turnMarksNow')
  assert.ok(/function turnBackedOff \(b, plot, now = Date\.now\(\)\) \{[\s\S]{0,300}?return turnMarksNow\(b, \[st\], now\)\[0\]\?\.backoff === true\n\}/.test(src), 'the order\'s gate asks turnMarksNow for the pick\'s state')
  assert.equal(src.split('marked.splice(0, marked.length, ...turnMarksNow(b, marked, now))').length, 2, 'and so does the pick')
  assert.equal(src.split('backedOff: (plot, now) => turnBackedOff(').length, 2, 'the hook the order calls')
})
await t('REVIEW r1, BLOCKER 3 (real files, real leases, a fresh skills.mjs): two bots pick the backed-off ziggurat from one reading -> ONE begins, the other steps aside to the wall with nothing counted; no second probe during an 8-minute visit; a prober killed mid-visit -> its lease lapses and the project is probed again; MUTANTS (no claim; the lease unread) killed', async () => {
  const Gm = PJ.recordGenNow(dir(), key('monument')), Gw = PJ.recordGenNow(dir(), key('wall'))
  const TTL = PJ.LEASE_TTL_MS + PJ.RECLAIM_MS
  const scenario = async (M, tag) => {
    cleanTurns(); freeSlots('monument'); freeSlots('wall')
    const A = mkAt(`showcase-A${tag}`), B = mkAt(`showcase-B${tag}`), C = mkAt(`showcase-C${tag}`), D = mkAt(`showcase-D${tag}`), now = Date.now()
    const marksOf = (bot, plot, at) => M._projturn.turnMarksNow(bot, [st(plot)], at)[0]
    // the ziggurat has a count whose back-off is long over (another bot's visit, three hours ago) and is the longest unvisited
    assert.ok(PJ.turnWrite(dir(), HOME, 'showcase-Gale', { monument: { at: now - 3 * H, n: 1, noAt: now - 3 * H, okAt: null, gen: Gm, stop: 'stuck_on_cell' }, wall: { at: now - H, n: 0, noAt: null, okAt: now - H, gen: Gw, stop: null } }, { now }))
    M.shopActiveForget()
    // BOTH decide from the same reading: the ziggurat
    assert.equal(M.shopActive(A, now).plot, 'monument'); assert.equal(M.shopActive(B, now).plot, 'monument')
    // ...and both visits start
    A.shopVisitBusy = true; A.shopVisitPlot = 'monument'
    assert.equal(M._projturn.turnBegin(A, 'monument', now), true)
    assert.equal(PJ.leaseState(dir(), key('monument'), 'slot1').rec.holder, A.username, 'A holds the probe: the ziggurat\'s slot 1')
    B.shopVisitBusy = true
    rows.length = 0
    assert.equal(M._projturn.turnBegin(B, 'monument', now + 1000), false, 'EXACTLY ONE: B steps aside')
    assert.deepEqual([PJ.turnRead(dir(), HOME, { holder: B.username })[0]?.plots?.monument, turnRows('pick').length, turnRows('backoff').length], [undefined, 0, 0], 'nothing stamped, counted or logged for it')
    // B's next pick, in the same visit: the wall
    assert.equal(M.shopActive(B, now + 1000, { visit: true }).plot, 'wall')
    B.shopVisitPlot = 'wall'
    assert.equal(M._projturn.turnBegin(B, 'wall', now + 1000, true), true)
    assert.equal(turnRows('pick').length, 1, 'one pick row: the visit\'s')
    // A's visit lasts EIGHT minutes, renewing its slot as a visit does: nobody else starts on the ziggurat in all that time
    let gen = null
    for (const m of [0.5, 1, 3, 5, 7, 7.9]) {
      if (m > 1) { const r = PJ.takeSlot(dir(), key('monument'), A.username, 2, { now: now + (m - 1) * MIN }); assert.ok(r.ok); gen = r.gen }
      assert.equal(marksOf(C, 'monument', now + m * MIN).backoff, true, `${m} min into A's visit`)
      assert.equal(M._projturn.turnBegin(C, 'monument', now + m * MIN), false)
    }
    // A's visit ends with nothing placed and gives its slot back
    M._projturn.turnNote(A, { status: 'no_effect', stop: 'stuck_on_cell' }, {}, now + 8 * MIN)
    PJ.releaseLease(dir(), key('monument'), 'slot1', A.username, gen)
    A.shopVisitBusy = false
    assert.equal(marksOf(C, 'monument', now + 9 * MIN).backoff, true, 'two in a row now: backed off 40-50 min')
    const t2 = now + 8 * MIN + 51 * MIN
    assert.equal(marksOf(C, 'monument', t2).backoff, undefined, 'control: the back-off over and no lease -- a candidate again')
    // C GOES BACK, AND ITS PROCESS IS KILLED MID-VISIT: no result, no release
    assert.equal(M._projturn.turnBegin(C, 'monument', t2), true)
    assert.equal(marksOf(D, 'monument', t2 + MIN).backoff, true)
    assert.equal(M._projturn.turnBegin(D, 'monument', t2 + MIN), false)
    assert.equal(marksOf(D, 'monument', t2 + TTL - 1000).backoff, true, 'held for the lease\'s own life (4 min and its reclaim minute)')
    assert.equal(marksOf(D, 'monument', t2 + TTL + 1000).backoff, undefined, 'then it lapses by itself: never "under way" for good')
    assert.equal(M._projturn.turnBegin(D, 'monument', t2 + TTL + 1000), true, 'and the project is probed again')
    assert.equal(PJ.leaseState(dir(), key('monument'), 'slot1').rec.holder, D.username)
  }
  await withCopy('skills.mjs', [], M => scenario(M, '1'))
  for (const [name, pair] of [
    ['no claim at the visit\'s start', ['      if (turnClaimNeeded(turnViewNow(bot, now).get(plot) ?? null)) {\n', '      if (false) {\n']],
    ['the lease unread by the marks', [', leased: plot => turnLeased(plot, me, now) })', ' })']],
  ]) {
    let why = null
    await withCopy('skills.mjs', [pair], async M => { try { await scenario(M, name.length) } catch (e) { why = e } })
    assert.ok(why instanceof assert.AssertionError, `MUTANT (${name}) survived or died for another reason: ${String(why?.stack ?? 'survived').split('\n')[0]}`)
  }
  freeSlots('monument'); freeSlots('wall')
})

await t('REVIEW r2, BLOCKER 1 (the real build_shop, real leases, a fresh skills.mjs): a visit that THROWS after it took the probe\'s claim gives the lease back at once, counts nothing, and the error still surfaces; a second bot can probe immediately; MUTANT (no finalizer on a throw) killed', async () => {
  const Gm = PJ.recordGenNow(dir(), key('monument')), Gw = PJ.recordGenNow(dir(), key('wall'))
  const scenario = async (M, tag) => {
    cleanTurns(); freeSlots('monument'); freeSlots('wall'); world.clear()
    const A = mkAt(`showcase-E${tag}`), B = mkAt(`showcase-F${tag}`), now = Date.now()
    assert.ok(PJ.turnWrite(dir(), HOME, 'showcase-Gale', { monument: { at: now - 3 * H, n: 1, noAt: now - 3 * H, okAt: null, gen: Gm, stop: 'stuck_on_cell' }, wall: { at: now - H, n: 0, noAt: null, okAt: now - H, gen: Gw, stop: null } }, { now }))
    M.shopActiveForget()
    // the visit breaks at its first statement after the start (turnBegin): an error, no interruption
    Object.defineProperty(A, 'sinkStreak', { configurable: true, get: () => 0, set: () => { throw new Error('boom: the visit broke') } })
    rows.length = 0
    let threw = null
    try { await M.SKILLS.build_shop.run({ bot: A }, {}, new AbortController().signal) } catch (e) { threw = e }
    assert.match(String(threw?.message), /^boom: the visit broke$/, 'the original error reaches the runner')
    // positive control: the visit HAD begun on the backed-off ziggurat and taken the probe's lease
    assert.deepEqual(turnRows('pick').map(x => x.split(' ').slice(0, 2).join(' ')), ['op=pick project=monument'])
    const l = PJ.leaseState(dir(), key('monument'), 'slot1')
    assert.equal(l?.rec?.holder, A.username, 'control: the claim was A\'s')
    assert.equal(l.released, true, 'and it is given back at once, not left to the lease\'s TTL')
    assert.deepEqual([A.shopTurnVisit, A.shopVisitBusy], [null, false], 'the turn is finalized')
    // an error is no evidence: nothing counted, no back-off row, the pool's count as it was
    const e = PJ.turnRead(dir(), HOME, { holder: A.username })[0].plots.monument
    assert.deepEqual([e.n, e.rn, e.noAt, Number.isFinite(e.at), turnRows('backoff').length], [0, 0, null, true, 0])
    assert.equal(M._projturn.turnViewNow(B, Date.now()).get('monument').n, 1)
    // a second bot goes back to the ziggurat immediately
    assert.equal(M._projturn.turnMarksNow(B, [st('monument')], Date.now())[0].backoff, undefined)
    assert.equal(M._projturn.turnBegin(B, 'monument', Date.now()), true)
  }
  await withCopy('skills.mjs', [], M => scenario(M, 1))
  let why = null
  await withCopy('skills.mjs', [["catch (e) { if (PROJTURN.on && !(e?.aborted || signal?.aborted)) turnNote(ctx.bot, { status: 'failed', stop: 'error' }, args); throw e }", 'catch (e) { throw e }']], async M => { try { await scenario(M, 2) } catch (e) { why = e } })
  assert.ok(why instanceof assert.AssertionError && /given back at once/.test(String(why.message)), `MUTANT (no finalizer on a throw) survived or died for another reason: ${String(why?.stack ?? 'survived').split('\n')[0]}`)
  freeSlots('monument'); freeSlots('wall')
})
await t('REVIEW r2, BLOCKER 2 (real files, real leases): three bots that pick the broken house and LOSE the probe\'s claim spend no repair attempt; the winner\'s is counted and its repair proceeds; PROJTURN off counts where it always did; MUTANT (counted before admission) killed', async () => {
  const G = PJ.recordGenNow(dir(), key('house1'))
  const setup = M => {
    cleanTurns(); freeSlots('house1'); freeSlots('monument'); world.clear(); world.set('5,70,5', block('air'))   // the house's cell is broken
    const now = Date.now()
    // ...and its repair has failed once, three hours ago: a count whose back-off is over -- going back to it is a probe
    assert.ok(PJ.turnWrite(dir(), HOME, 'showcase-Gale', { house1: { at: now - 3 * H, n: 0, noAt: null, rn: 1, rnoAt: now - 3 * H, okAt: null, gen: G, stop: 'clears_wait' } }, { now }))
    M.shopActiveForget()
    return now
  }
  const scenario = async (M, tag) => {
    const now = setup(M)
    const W = mkAt(`showcase-W${tag}`), L = [1, 2, 3].map(i => mkAt(`showcase-L${i}${tag}`))
    // all four visits pick the repair from the same reading
    for (const b of [W, ...L]) { b.shopVisitBusy = true; assert.equal(M.shopActive(b, now, { visit: true }).plot, 'house1') }
    assert.equal(M._projturn.turnBegin(W, 'house1', now), true)
    assert.deepEqual([W.shopRepairs.get('house1')?.n, W.shopTurnVisit.repair, PJ.leaseState(dir(), key('house1'), 'slot1').rec.holder], [1, true, W.username], 'the winner: its attempt counted, its repair under way')
    for (const b of L) {
      assert.equal(M._projturn.turnBegin(b, 'house1', now + 1000), false, 'the claim is lost')
      assert.equal(b.shopRepairs?.get('house1'), undefined, 'a pick stepped aside from spends no repair attempt')
      assert.equal(S.repairBackoff([st('house1', { complete: true, damaged: true })], b.shopRepairs ?? null, now + 1000)[0].damaged, true)
      // its next pick in the same visit is another project's, and counts nothing against the house either
      const next = M.shopActive(b, now + 1000, { visit: true }).plot
      assert.ok(['monument', 'wall'].includes(next), `the next pick is an open project, not the house under probe: ${next}`)
      assert.equal(M._projturn.turnBegin(b, next, now + 1000, true), true)
      assert.equal(b.shopRepairs?.get('house1'), undefined)
      b.shopVisitBusy = false; M._projturn.turnNote(b, { status: 'aborted', stop: 'aborted' }, {}, now + 2000)
    }
  }
  await withCopy('skills.mjs', [], M => scenario(M, 1))
  let why = null
  await withCopy('skills.mjs', [['    if (PROJTURN.on && visit && b) b.shopTurnRepair = { pick, states, now }\n    else if (visit) noteRepair(rmem, pick, states, now)\n', '    if (visit) noteRepair(rmem, pick, states, now)\n']], async M => { try { await scenario(M, 2) } catch (e) { why = e } })
  assert.ok(why instanceof assert.AssertionError && /spends no repair attempt/.test(String(why.message)), `MUTANT (the attempt counted before admission) survived or died for another reason: ${String(why?.stack ?? 'survived').split('\n')[0]}`)
  // PROJTURN off: the attempt is counted by the visit's pick itself, where it always was
  await withCopy('skills.mjs', SKILLS_OFF, M => {
    const now = setup(M), b = mkAt('showcase-Off')
    assert.equal(M.shopActive(b, now, { visit: true }).plot, 'house1')
    assert.equal(b.shopRepairs.get('house1')?.n, 1)
    assert.equal(b.shopTurnRepair, undefined, 'nothing kept for a later start')
  })
  const src = strip(fs.readFileSync(SRC('skills.mjs'), 'utf8'))
  assert.equal(src.split('    if (PROJTURN.on && visit && b) b.shopTurnRepair = { pick, states, now }\n    else if (visit) noteRepair(rmem, pick, states, now)\n').length, 2, 'the switch decides where: off, the old line')
  assert.equal(src.split('noteRepair(').length, 3, 'two calls: the pick\'s (off) and the accepted start\'s (on)')
  freeSlots('house1'); freeSlots('monument'); world.clear()
})

if (SIM) console.log(`\n        THE SIMULATION, 48 h, 14 bots (visits per simulated day; longest wait in hours)\n${table(SIM.on, SIM.off)}`)
for (const m of FAILED) console.log(m)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
