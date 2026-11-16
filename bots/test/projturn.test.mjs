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
  assert.deepEqual(view(NOW).get('wall'), { at: NOW - 1000, by: 'A', okAt: null, n: 1, noAt: NOW, stop: 'stuck_on_cell' })
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
  await killed([['  if (outcome === \'progress\') return { ...base, n: 0, noAt: null, okAt: now, gen: gen ?? null, stop: null }\n', '  if (outcome === \'progress\') return own ?? null\n']], [], (Sm, PTm) => {
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

// ================================================================================================================================
// 2. THE SIMULATION: fourteen bots, a town shaped like the live one, 48 hours on a fake clock.
// ================================================================================================================================
// THE TOWN (the live one's shape, 11-15): the workshop, the house and the paths stand; the house takes DAMAGE at hour 6 (two repair
// visits mend it); the paths read as damage to each bot once per 30 min (the extension its visit cannot route: `complete`, nothing
// laid); the crop farm is a service plot, due every 30 min; the ziggurat ends stuck_on_cell STALLED (the project's 6-h stamp); the
// wall extension ends cell_deferred with nothing placed; cottage2 and the pens find no site; cottage3 waits on cottage2; civicM ends
// stuck_on_cell without a stall; civicH does too until hour 20, then its visits place blocks (one in ten does not); THE STEP WELL, late in the order, can
// always work (one builder; every fifth visit is interrupted); the tidy is the crew's (bots 0-2). Bot 13 has a full bag (5 free
// slots): the room refusal's remedy (a bank order) is installed, as skills.mjs installs bagfull-01's.
const SIM_LIST = [
  { plot: 'shop', blueprint: 'workshop@1' },
  { plot: 'house1', blueprint: 'house@1', after: 'shop' },
  { plot: 'monument', blueprint: 'ziggurat@1', after: 'shop', builders: 2 },
  { plot: 'paths', blueprint: 'paths@1', after: 'house1', builders: 2 },
  { plot: 'cropfarm', blueprint: 'cropfarm@1', after: 'paths', builders: 1 },
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
function simulate (Sm, PTm, { turn, hours = 48, nBots = 14, damageAt = 6 * H, unblockAt = 20 * H } = {}) {
  const T0 = NOW, TICK = 30_000, END = T0 + hours * H, COOL = Sm.SHOP_COOLDOWN_MS
  const proj = Object.fromEntries(SIM_LIST.map(p => [p.plot, { exists: !['cottage2', 'cottage3', 'pens'].includes(p.plot), complete: ['shop', 'house1', 'paths', 'cropfarm'].includes(p.plot), slots: new Set(), stampAt: null, broken: 0, n: 0 }]))
  const files = new Map()
  const viewNow = now => PTm.turnView([...files].map(([holder, plots]) => ({ holder, plots })), { now, genOf: () => null })
  const put = (b, plot, e) => { if (!files.has(b.name)) files.set(b.name, {}); files.get(b.name)[plot] = e }
  const bots = Array.from({ length: nBots }, (_, i) => ({ i, name: `showcase-Bot${String(i).padStart(2, '0')}`, startAt: T0 + i * 37_000, shopState: {}, visit: null, idle: new Map(), wait: new Map(), repairs: new Map(), noSitePlot: null, turnLast: null, pin: null, freeSlots: i === 13 ? 5 : 30, pathsAskAt: -Infinity, starve: 0, starveMax: 0, orders: [], benchedOrders: 0 }))
  const stats = { visits: {}, starts: {}, out: {}, placed: 0, skips: {}, picks: {}, bank: 0, repairStart: [], serviceStart: [], afterStuck: [], afterNoSite: [] }
  for (const p of SIM_LIST) { stats.visits[p.plot] = 0; stats.starts[p.plot] = []; stats.out[p.plot] = {} }
  const svc = { at: T0 - 30 * MIN, busy: false }
  const slotFree = (plot, b) => { const p = SIM_LIST.find(q => q.plot === plot), P = proj[plot]; if (plot === 'tidy' && b.i > 2) return false; return P.slots.has(b) || P.slots.size < Sm.buildersOf(p) }
  let cur = null
  Sm.setActivePlot(() => cur?.pick?.plot ?? null)
  Sm.setNoSitePlot(() => cur?.b?.noSitePlot ?? null)
  Sm.setWaitNow(plot => Sm.waitHeld(cur?.b?.wait ?? null, plot, cur?.now ?? 0))
  Sm.setRoomAsk(() => ({ order: { skill: 'build_shop', args: { roomBank: true } } }))
  Sm.setGroundsFall(null)
  Sm.setTurnNow({ stuckPlot: () => (cur?.b?.turnLast?.stop === 'stuck_on_cell' ? cur.b.turnLast.plot : null), backedOff: plot => cur?.turned?.find(s => s.plot === plot)?.backoff === true })
  const behave = (plot, b, now, service) => {
    const P = proj[plot]
    P.n++
    if (plot === 'monument') return { status: 'no_effect', stop: 'stuck_on_cell', stalled: true, ms: 3 * MIN }
    if (plot === 'paths') return { status: 'no_effect', stop: 'complete', ms: MIN }
    if (plot === 'cropfarm') return service ? { status: 'success', stop: 'complete', placed: 4, ms: 2 * MIN } : { status: 'no_effect', stop: 'complete', ms: MIN }
    if (plot === 'wallext') return { status: 'no_effect', stop: 'cell_deferred', ms: 3 * MIN }
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
    P.slots.delete(b)
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
      if (v.turn) { const oc = PTm.turnOutcome(res); if (oc !== 'none') put(b, v.plot, PTm.turnAfter(files.get(b.name)?.[v.plot] ?? null, viewNow(now).get(v.plot) ?? null, oc, { now, stop: res.stop, gen: null })) }
    }
    b.lastEnd = { plot: v.plot, stop: res.stop, at: now }
  }
  const decide = (b, now) => {
    const svcDue = !svc.busy && now - svc.at >= 30 * MIN
    const base = SIM_LIST.map(p => { const P = proj[p.plot]; return { plot: p.plot, exists: P.exists, complete: P.complete, damaged: P.complete && ((p.plot === 'house1' && P.broken > 0) || (p.plot === 'paths' && now - b.pathsAskAt >= 30 * MIN)), due: false, dueFirst: false } })
    // skills.mjs shopActive, in its order: the repair back-off, the slots, the stamps, the waiting holds, the idle marks, the turns last
    const states = Sm.repairBackoff(base, b.repairs, now).map(s => (s.exists && s.complete ? s : { ...s, free: slotFree(s.plot, b) }))
    const marked = Sm.idleMarks(Sm.waitBackoff(Sm.stuckBackoff(states, plot => proj[plot].stampAt, now), b.wait, now), b.idle, now)
    const turned = turn ? PTm.turnBackoff(marked, viewNow(now), { me: b.name, now, exempt: Sm.turnExempt, hold: PTm.turnHold(b.turnLast, now, { stuckMs: Sm.SHOP_STUCK_RETRY_MS, siteMs: Sm.SHOP_SITE_RETRY_MS }), pin: b.pin && now - b.pin.at < PTm.TURN.stickMs ? b.pin.plot : null, capOf: Sm.stuckWindowOf, ownNeed: Sm.turnOwnNeed }) : marked
    const pick = Sm.activeProject(turned, SIM_LIST, { upkeepTurn: false, noWait: false, service: svcDue ? 'cropfarm' : null, sinkTurn: false })
    if (turn && b.pin?.plot !== pick.plot) b.pin = { plot: pick.plot, at: now }
    const P = proj[pick.plot]
    const service = svcDue && pick.plot === 'cropfarm'
    const wants = base.find(s => s.plot === pick.plot).damaged || service              // cognitive.mjs: complete && !shopDamaged
    cur = { b, pick, now, turned }
    const r = Sm.buildOrder({ on: true, shared: true, atTown: true, holds: false, now, state: b.shopState, record: P.exists ? { plot: pick.plot, structure_complete: P.complete } : null,
      complete: P.complete && !wants, slotsFree: slotFree(pick.plot, b), health: 20, freeSlots: b.freeSlots, planned: true, stuckAt: P.stampAt, turn })
    const cooled = now - (b.shopState.lastAt ?? -Infinity) >= COOL
    // is there an open project this bot could be working right now (a slot, no stamp, no back-off, not its held one)?
    const could = turned.some(s => SIM_OPEN.includes(s.plot) && s.exists !== undefined && !(s.exists && s.complete) && s.free !== false)
    if (!r.order) {
      if (r.skip) stats.skips[r.skip] = (stats.skips[r.skip] ?? 0) + 1
      if (cooled && could && r.skip !== 'room') b.starveMax += TICK
      return
    }
    b.shopState = { ...b.shopState, lastAt: now }                                     // cognitive.mjs: the cooldown is charged at issue
    if (r.order.args?.roomBank) { stats.bank++; b.visit = { bank: true, endAt: now + 2 * MIN }; return }
    // the visit (skills.mjs buildShopVisit): the pick, the repair count, the slot, the start's stamp
    Sm.noteRepair(b.repairs, pick, states, now)
    P.slots.add(b)
    if (service) { svc.busy = true; svc.at = now; stats.serviceStart.push(now) }
    if (pick.plot === 'paths') b.pathsAskAt = now
    if (pick.plot === 'house1' && P.broken > 0) stats.repairStart.push(now)
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
    b.visit = { plot: pick.plot, endAt: now + beh.ms, beh, service, turn: noted }
  }
  let damaged = false
  for (let now = T0; now < END; now += TICK) {
    if (!damaged && now >= T0 + damageAt) { proj.house1.broken = 2; damaged = true }
    for (const b of bots) {
      if (now < b.startAt) continue
      if (b.visit) { if (now < b.visit.endAt) continue; endVisit(b, now) }
      decide(b, now)
    }
  }
  const gap = (plot, from = T0, to = END) => { const ts = [from, ...stats.starts[plot].filter(x => x >= from && x < to), to]; let g = 0; for (let i = 1; i < ts.length; i++) g = Math.max(g, ts[i] - ts[i - 1]); return g }
  const count = (plot, h0, h1) => stats.starts[plot].filter(x => x >= T0 + h0 * H && x < T0 + h1 * H).length
  return { T0, END, hours, stats, bots, proj, files, gap, count, starveMax: Math.max(...bots.map(b => b.starveMax)), perDay: plot => Math.round(stats.visits[plot] / (hours / 24) * 10) / 10 }
}
const table = (on, off) => {
  const row = (a, b, c, d, e) => `        ${String(a).padEnd(10)}${String(b).padStart(12)}${String(c).padStart(12)}${String(d).padStart(16)}${String(e).padStart(16)}`
  const lines = [row('project', 'off /day', 'on /day', 'off longest h', 'on longest h')]
  for (const p of SIM_LIST) lines.push(row(p.plot, off.perDay(p.plot), on.perDay(p.plot), (off.gap(p.plot) / H).toFixed(1), (on.gap(p.plot) / H).toFixed(1)))
  lines.push(row('blocks', off.stats.placed, on.stats.placed, '', ''))
  lines.push(row('starved h', (off.starveMax / H).toFixed(2), (on.starveMax / H).toFixed(2), '(the most time one cooled-down bot', 'spent unordered with work open)'))
  lines.push(`        skips off ${JSON.stringify(off.stats.skips)}`)
  lines.push(`        skips on  ${JSON.stringify(on.stats.skips)}`)
  lines.push(`        picks on  ${JSON.stringify(on.stats.picks)}  bank on/off ${on.stats.bank}/${off.stats.bank}`)
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
  assert.ok(off.count('paths', 24, 48) >= 100, `the finished paths visited for nothing: ${off.count('paths', 24, 48)} times in a day`)
  assert.ok(off.count('wallext', 24, 48) >= 100, `the stuck wall extension: ${off.count('wallext', 24, 48)} visits in a day`)
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
await t('(c) REPAIRS AND SERVICE KEEP THEIR PRIORITY: the house is mended within minutes of its damage; the crop farm is served on its schedule', () => {
  const { on, off } = SIM
  const dmg = on.T0 + 6 * H
  assert.ok(on.stats.repairStart.length >= 2 && on.stats.repairStart.length <= 3, `two repair visits mend it (a third may start beside the second): ${on.stats.repairStart.length}`)
  assert.ok(on.stats.repairStart[0] - dmg <= 12 * MIN, `the first repair ${((on.stats.repairStart[0] - dmg) / MIN).toFixed(1)} min after the damage`)
  assert.ok(on.stats.repairStart[1] - dmg <= 15 * MIN)
  assert.equal(on.proj.house1.broken, 0)
  assert.ok(off.stats.repairStart.length >= 2 && off.stats.repairStart[0] - dmg <= 15 * MIN, 'control: off, the same')
  // the service plot: due every 30 min for 48 h
  assert.ok(on.stats.serviceStart.length >= 80, `service visits: ${on.stats.serviceStart.length} of 96`)
  assert.ok(on.stats.serviceStart.length >= off.stats.serviceStart.length - 3, `not fewer than today (${off.stats.serviceStart.length})`)
  assert.ok(on.gap('cropfarm') <= 50 * MIN, `the farm's longest wait: ${(on.gap('cropfarm') / MIN).toFixed(0)} min`)
  // the town clean-up is not starved by the rotation
  assert.ok(on.stats.visits.tidy >= off.stats.visits.tidy, `tidy visits: ${on.stats.visits.tidy} against ${off.stats.visits.tidy}`)
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
  assert.ok(off.count('wallext', 24, 48) > 20 * on.count('wallext', 24, 48) && off.count('paths', 24, 48) > 4 * on.count('paths', 24, 48), 'control: off, the same projects many times over')
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
await t('THE SIMULATION KILLS THE MUTANTS: the hold\'s scope, the reset, the cap, the classifier, one probe at a time -- each breaks the property it carries (the aging comparison is killed on the pure choice above)', async () => {
  const run = async (ptPairs, shopPairs) => { let r = null; await withTurn(ptPairs, shopPairs, (Sm, PTm) => { r = simulate(Sm, PTm, { turn: true }) }); return r }
  // the scope: the bot-wide hold again -> bots are benched with work open
  const scope = await run([], [["&& stuckRetryHolds(plot0, stuckPlot)) return { order: null, skip: 'stuck_on_cell' }", "&& true) return { order: null, skip: 'stuck_on_cell' }"]])
  assert.equal(scope.bots.reduce((n, b) => n + b.benchedOrders, 0), 0, 'scope mutant: no bot is ordered anywhere inside its own 6 h')
  assert.ok(scope.stats.visits.stepwell < SIM.on.stats.visits.stepwell, `scope mutant: the well ${scope.stats.visits.stepwell} visits against ${SIM.on.stats.visits.stepwell}`)
  // the reset: one ordinary visit that places nothing costs the working civicH 6 h again, not 20 min
  const reset = await run([['  if (outcome === \'progress\') return { ...base, n: 0, noAt: null, okAt: now, gen: gen ?? null, stop: null }\n', '  if (outcome === \'progress\') return own ?? null\n']], [])
  assert.ok(reset.count('civicH', 30, 48) < SIM.on.count('civicH', 30, 48) / 2 && SIM.on.count('civicH', 30, 48) >= 80, `reset mutant: civicH ${reset.count('civicH', 30, 48)} visits in hours 30-48 against ${SIM.on.count('civicH', 30, 48)}`)
  // the cap: the hopeless projects' waits grow without bound
  const cap = await run([['  return Math.min(Math.max(0, Number(cap) || 0), T.baseMs * 2 ** Math.min(k - 1, 30))\n', '  return T.baseMs * 2 ** Math.min(k - 1, 30)\n']], [])
  assert.ok(cap.gap('wallext') > 12 * H && SIM.on.gap('wallext') <= 8 * H, `cap mutant: the wall extension waited ${(cap.gap('wallext') / H).toFixed(1)} h`)
  // the no-progress classifier: an abort counted as evidence backs the working step well off
  const abort = await run([["  if (r.status === 'aborted' || stop === 'aborted') return 'none'\n", "  if (r.status === 'aborted' || stop === 'aborted') return 'no_progress'\n"]], [])
  assert.ok(abort.stats.visits.stepwell < SIM.on.stats.visits.stepwell * 0.8, `abort mutant: the well ${abort.stats.visits.stepwell} visits against ${SIM.on.stats.visits.stepwell}`)
  // one probe at a time: without it both slots of a hopeless two-builder project fill at every return
  const probe = await run([['    const probing = (e?.n ?? 0) > 0 && Number.isFinite(e.at) && e.at > (e.noAt ?? -Infinity) && e.by !== me && now >= e.at && now - e.at < T.probeMs\n', '    const probing = false\n']], [])
  const two = ['wallext', 'cottage2', 'civicM']
  assert.ok(two.reduce((n, p) => n + probe.count(p, 0, 48), 0) > two.reduce((n, p) => n + SIM.on.count(p, 0, 48), 0), `probe mutant: ${two.map(p => probe.count(p, 0, 48))} visits against ${two.map(p => SIM.on.count(p, 0, 48))}`)
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
  assert.deepEqual(all.find(f => f.holder === 'showcase-Gale').plots.monument, { at: NOW, n: 2, noAt: NOW, okAt: null, gen: 7, stop: 'stuck_on_cell' })
  assert.deepEqual(all.find(f => f.holder === 'showcase/Bravo').plots.wall, { at: NOW, n: 0, noAt: null, okAt: null, gen: null, stop: null }, 'a missing field reads as nothing')
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
  now += 80 * MIN
  SK.shopTurnForget()
  bot.shopVisitPlot = 'monument'; X.turnBegin(bot, 'monument', now); X.turnNote(bot, { status: 'no_effect', stop: 'cell_deferred' }, {}, now + MIN)
  assert.match(turnRows('backoff').at(-1), /^op=backoff project=monument n=3 until_min=(8\d|9\d|100) stop=cell_deferred$/, 'three in a row for the pool: 80-100 min')
  // one probe at a time: while Gale's visit to the backed-off ziggurat is under way, it stays passed for this bot (5 min at most)
  assert.ok(PJ.turnWrite(dir(), HOME, 'showcase-Gale', { monument: { at: now + 4 * H, n: 1, noAt: now - 47 * MIN, okAt: null, gen: 1, stop: 'cell_deferred' } }, { now: now + 4 * H }))
  SK.shopTurnForget()
  assert.equal(X.turnBackedOff(null, 'monument', now + 4 * H - MIN), false, 'control: a minute before Gale starts the back-off (80-100 min) is long over')
  assert.equal(X.turnBackedOff(null, 'monument', now + 4 * H + 2 * MIN), true)
  assert.equal(X.turnBackedOff(null, 'monument', now + 4 * H + 6 * MIN), false, 'a visit that never reports lapses')
  // an aborted visit: the start stamped, the count and the rows as they were, the bot's last stop `aborted`
  const nRows = turnRows('backoff').length
  bot.shopVisitPlot = 'monument'; X.turnBegin(bot, 'monument', now + 2 * MIN); X.turnNote(bot, { status: 'aborted', stop: 'aborted' }, {}, now + 3 * MIN)
  assert.equal(PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.monument.n, 2)
  assert.equal(PJ.turnRead(dir(), HOME, { holder: ME })[0].plots.monument.at, now + 2 * MIN)
  assert.equal(turnRows('backoff').length, nRows)
  assert.equal(bot.shopTurnLast.stop, 'aborted')
  assert.equal(X.turnBackedOff(null, 'monument', now + 4 * MIN), true)
  // progress: the count ends for the pool, one row says so
  bot.shopVisitPlot = 'monument'; X.turnBegin(bot, 'monument', now + 6 * MIN); X.turnNote(bot, { status: 'success', stop: 'deadline', placed: 3 }, {}, now + 9 * MIN)
  assert.equal(turnRows('backoff').at(-1), 'op=backoff project=monument n=0 until_min=0 stop=deadline')
  assert.equal(X.turnBackedOff(null, 'monument', now + 10 * MIN), false)
  // ...and a second progress visit writes no row (nothing to end)
  const n2 = turnRows('backoff').length
  bot.shopVisitPlot = 'monument'; X.turnBegin(bot, 'monument', now + 20 * MIN); X.turnNote(bot, { status: 'success', stop: 'deadline', placed: 3 }, {}, now + 23 * MIN)
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
  for (const line of ['if (PROJTURN.on) marked.splice(0, marked.length, ...turnMarksNow(b, marked, now))', 'if (PROJTURN.on && b && visit) b.shopTurnInfo = {', 'if (PROJTURN.on) turnBegin(bot, proj.plot)', 'if (PROJTURN.on) turnNote(ctx.bot, res, args)', 'if (PROJTURN.on) setTurnNow({'])
    assert.equal(src.split(line).length, 2, `WIRING MISSING OR NOT UNIQUE: ${line}`)
  assert.equal(src.split('turnBegin(').length, 2, 'turnBegin: the visit\'s one call')
  assert.equal(src.split('turnNote(').length, 2, 'turnNote: the one call every visit\'s result passes')
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

if (SIM) console.log(`\n        THE SIMULATION, 48 h, 14 bots (visits per simulated day; longest wait in hours)\n${table(SIM.on, SIM.off)}`)
for (const m of FAILED) console.log(m)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
