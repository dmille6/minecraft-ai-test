// SINKTURN-01 (LIVE showcase f7909770, 24 h to 11-10 16:30Z, 15 bots): THE SINKS NEVER GET A TURN.
//   1,569 build visits; 16 went to a sink -- 14 the decorator's decor (its own lease), 2 the tower (both `cell_deferred`); wood (released
//   11-09 23:10Z), road, shrine: 0. Every bot spent its build orders on the finite projects that always have a slot (paths 406 visits,
//   402 of them `complete` with nothing placed, tidy 414, town hall 144 ...): shop.mjs activeProject offers the sink tier only when no
//   finite project has a slot for the bot. And the picker's order (open first) was headed by tower T3 in 2,209 of 2,209 `_sink op=pick`
//   rows: its last six cells were TORCHES on the top terraces (`T3-light`, seg T3-D) deferred `no_stand` since 11-08 16:00Z by six
//   bots (sinkdefer files: 46,75,-14 x6), and the waiver never took a light (sinks.mjs sinkWaiveDue), so the instance could not close.
// The fix, through the exported decisions: the sink turn (sinks.mjs sinkTurnDue / finiteStreakAfter -> activeProject `sinkTurn`), the
// blocked sink's longer idle mark (shop.mjs noteIdle: SINK_TURN.idleMs), and the light waiver (sinkWaiveDue `lights`). Each with its
// positive control and an anchored mutant (present and unique).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const S = await import('../src/sinks.mjs')
const SH = await import('../src/shop.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
async function withMutant (file, old, neu, fn) {
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** The scenario passes on the real module and fails (an AssertionError) on the mutant. */
async function killedBy (file, old, neu, scenario, real) {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url), SINKS_PATH = new URL('../src/sinks.mjs', import.meta.url)

// ---- the live order: finite projects with a slot always, the open tower at the head of the sinks --------------------------------
const FINITE = ['house1', 'enchantshop', 'townhall', 'paths', 'tidy']   // house1 and the workshop: the paths' and the hall's `after`
const SINKS = ['tower', 'wood', 'road', 'shrine', 'dress']   // the picker's order (skills.mjs sinkListOrder over sinkOrder: open first)
const byPlot = new Map(SH.PROJECTS.map(p => [p.plot, p]))
const LIST = [...FINITE, ...SINKS].map(pl => byPlot.get(pl))
assert.ok(LIST.every(Boolean), 'a plot of the scenario is not in shop.mjs PROJECTS')
const LIVE = () => [
  { plot: 'house1', exists: true, complete: true, damaged: false },
  { plot: 'enchantshop', exists: true, complete: true, damaged: false },
  { plot: 'townhall', exists: true, complete: false, damaged: false },                 // open, a slot free (144 visits in 24 h)
  { plot: 'paths', exists: true, complete: true, damaged: false },                     // standing
  { plot: 'tidy', exists: true, complete: false, damaged: false, free: false },        // the keeper's grounds (another bot's)
  { plot: 'tower', exists: true, complete: false, damaged: false, sink: true, sinkOpen: true },
  { plot: 'wood', exists: false, complete: false, damaged: false, sink: true, sinkNext: true },
  { plot: 'road', exists: true, complete: true, damaged: false, sink: true, sinkNext: true },
  { plot: 'shrine', exists: true, complete: true, damaged: false, sink: true, sinkNext: true },
  { plot: 'dress', exists: true, complete: true, damaged: false, sink: true, sinkNext: true },
]
// what each visit does live: the tower's ends `cell_deferred` with nothing placed; every other visit builds
const OUTCOME = { tower: { status: 'no_effect', stop: 'cell_deferred' } }
/** One bot's build orders, one every 15 min (the showcase's ~4 visits a bot an hour), under module M; `turn` false = the old order. */
function run (M, n = 40, turn = true) {
  const mem = new Map(), picks = []
  let now = Date.parse('2026-11-10T00:00:00Z'), streak = 0
  for (let i = 0; i < n; i++, now += 15 * 60_000) {
    const pick = M.activeProject(M.idleMarks(LIVE(), mem, now), LIST, { sinkTurn: turn && M.sinkTurnDue ? M.sinkTurnDue(streak) : (turn && S.sinkTurnDue(streak)) })
    picks.push(pick.plot)
    streak = S.finiteStreakAfter(streak, pick.plot)
    M.noteIdle(mem, pick.plot, OUTCOME[pick.plot] ?? { status: 'success', placed: 20 }, now)
  }
  return picks
}
const sinkPicks = picks => picks.filter(p => SINKS.includes(p))

await t('POSITIVE CONTROL -- the old order (no turn): 40 orders, 0 to a sink (the live 2 of 1,569); the town hall every time', () => {
  const picks = run(SH, 40, false)
  assert.strictEqual(sinkPicks(picks).length, 0, picks.join(','))
  assert.ok(picks.every(p => p === 'townhall'), picks.join(','))
})
await t('THE SINK TURN: one order in SINK_TURN.every + 1 goes to a sink; the rest stay with the finite projects', () => {
  const picks = run(SH)
  const n = sinkPicks(picks).length, every = S.SINK_TURN.every
  assert.strictEqual(n, Math.floor(40 / (every + 1)), picks.join(','))
  for (let i = 0; i < picks.length; i++) assert.strictEqual(SINKS.includes(picks[i]), (i + 1) % (every + 1) === 0, `order ${i}: ${picks[i]}`)
})
await t('THE BLOCKED SINK YIELDS: the tower (cell_deferred, nothing placed) once; the next turns rotate to the next sink (wood)', () => {
  const picks = sinkPicks(run(SH))
  assert.strictEqual(picks[0], 'tower', picks.join(','))
  assert.ok(picks.slice(1, 3).every(p => p !== 'tower'), picks.join(','))
  // the other turns go to the next sink in the picker's order (wood: it builds here, so it keeps them; the live picker's order moves
  // on as instances are sited -- skills.mjs sinkOrder's rotation, unchanged)
  assert.ok(picks.filter(p => p !== 'tower').every(p => p === 'wood'), picks.join(','))
  assert.ok(picks.filter(p => p === 'wood').length > picks.filter(p => p === 'tower').length, picks.join(','))
  // at most one tower visit per SINK_TURN.idleMs: the turns come every (every + 1) x 15 min
  const gap = Math.ceil(S.SINK_TURN.idleMs / ((S.SINK_TURN.every + 1) * 15 * 60_000))
  const at = picks.map((p, i) => (p === 'tower' ? i : -1)).filter(i => i >= 0)
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= gap, `tower turns ${at.join(',')}`)
})
await t('the turn keeps the tiers above it: a repair first, the service tier first; no sink to work -> the order as before', () => {
  const rep = LIVE().map(s => (s.plot === 'paths' ? { ...s, damaged: true } : s))
  assert.strictEqual(SH.activeProject(rep, LIST, { sinkTurn: true }).plot, 'paths', 'a repair before the turn')
  assert.strictEqual(SH.activeProject(LIVE(), LIST, { sinkTurn: true, service: 'paths' }).plot, 'paths', 'the service tier before the turn')
  const none = LIVE().map(s => (s.sink ? { ...s, sinkOpen: false, sinkNext: false } : s))
  assert.strictEqual(SH.activeProject(none, LIST, { sinkTurn: true }).plot, 'townhall', 'no sink wanted: the open project')
  const stuck = LIVE().map(s => (s.sink ? { ...s, stuck: true } : s))
  assert.strictEqual(SH.activeProject(stuck, LIST, { sinkTurn: true }).plot, 'townhall', 'every sink in its stuck back-off: the open project')
  assert.strictEqual(SH.activeProject(LIVE(), LIST, { sinkTurn: false }).plot, 'townhall', 'no turn: as before')
  assert.strictEqual(SH.activeProject(LIVE(), LIST, { sinkTurn: true }).plot, 'tower', 'the turn: the picker\'s head')
})
await t('sinkTurnDue / finiteStreakAfter: the count, the threshold, the switch', () => {
  assert.strictEqual(S.SINK_TURN.every, 4)
  assert.ok(!S.sinkTurnDue(S.SINK_TURN.every - 1) && S.sinkTurnDue(S.SINK_TURN.every) && S.sinkTurnDue(99))
  assert.ok(!S.sinkTurnDue(undefined) && !S.sinkTurnDue(NaN))
  assert.ok(!S.sinkTurnDue(99, { on: false }), 'SINKTURN=off: never')
  assert.strictEqual(S.finiteStreakAfter(3, 'townhall'), 4)
  assert.strictEqual(S.finiteStreakAfter(undefined, 'paths'), 1)
  for (const k of S.SINK_KINDS) assert.strictEqual(S.finiteStreakAfter(7, S.SINK_PLOTS[k]), 0, k)
  assert.ok(!S.sinkTurnOn({ SINKTURN: 'off' }) && S.sinkTurnOn({}) && S.sinkTurnOn({ SINKTURN: 'on' }))
  assert.ok(S.SINK_TURN.idleMs > (S.SINK_TURN.every + 1) * 15 * 60_000, 'the idle mark outlasts a turn interval')
})
await t('noteIdle: a sink\'s no-effect or aborted visit marks SINK_TURN.idleMs; a finite project\'s no-effect IDLE_MS (unchanged)', () => {
  const m = new Map(), T = 1000
  SH.noteIdle(m, 'tower', { status: 'no_effect', stop: 'cell_deferred' }, T); assert.strictEqual(m.get('tower'), T + S.SINK_TURN.idleMs)
  SH.noteIdle(m, 'wood', { status: 'aborted', stop: 'aborted' }, T); assert.strictEqual(m.get('wood'), T + S.SINK_TURN.idleMs)
  SH.noteIdle(m, 'townhall', { status: 'no_effect', stop: 'replanned' }, T); assert.strictEqual(m.get('townhall'), T + SH.IDLE_MS)
  SH.noteIdle(m, 'tower', { status: 'success', placed: 4 }, T); assert.ok(!m.has('tower'), 'a working visit clears it')
})
await t('MUTANTS KILLED: no turn in activeProject (sinks starve again); no turn due (never); the sink mark back to IDLE_MS (tower every turn)', async () => {
  await killedBy(SHOP_PATH, '  if (sinkTurn && sink) return sink\n', '', M => {
    assert.ok(sinkPicks(run(M)).length > 0, 'MUTANT: no sink turn -- 0 sink picks')
  }, SH)
  await killedBy(SINKS_PATH, '!!on && (Number(streak) || 0) >= every', 'false', M => {
    assert.ok(M.sinkTurnDue(S.SINK_TURN.every), 'MUTANT: the turn never due')
  }, S)
  await killedBy(SHOP_PATH, 'const ms = isSinkPlot(plot) && SINK_TURN.on ? SINK_TURN.idleMs : IDLE_MS', 'const ms = IDLE_MS', M => {
    const picks = sinkPicks(run(M))
    assert.ok(picks.includes('wood'), `MUTANT: the blocked tower takes every turn -- ${picks.join(',')}`)
  }, SH)
})

// ---- the light waiver on the live tower T3 (/var/lib/mcai/_pool-showcase/project-0_70_0.tower.g6 + .sinkdefer.*, 11-10 16:30Z) -----
const T3 = () => ({ v: 1, blueprint: 'tower@1', plot: 'tower', kind: 'tower', instances: [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }],
  waived: { '43,78,-11': { why: 'no_stand', at: 1793968019946, by: 'showcase-Nova' } },
  cells: [{ at: [43, 78, -11], role: 'T3-cr', seg: 'T3-C' }, { at: [41, 72, -15], role: 'T3-light', seg: 'T3-D' }, { at: [47, 72, -15], role: 'T3-light', seg: 'T3-D' },
    { at: [42, 75, -14], role: 'T3-light', seg: 'T3-D' }, { at: [46, 75, -14], role: 'T3-light', seg: 'T3-D' }, { at: [42, 75, -10], role: 'T3-light', seg: 'T3-D' },
    { at: [46, 75, -10], role: 'T3-light', seg: 'T3-D' }, { at: [44, 70, -12], role: 'T3-b0', seg: 'T3-L00-N' }] })
const DEFER_FILES = [   // the live .sinkdefer.<holder>.json cells for the two torches still open
  { '46,75,-14': { n: 1, firstAt: 1794318499125 }, '46,75,-10': { n: 1, firstAt: 1794318499125 } },   // Iris
  { '46,75,-14': { n: 1, firstAt: 1794223385266 }, '46,75,-10': { n: 1, firstAt: 1794223385266 } },   // Juno
  { '46,75,-14': { n: 1, firstAt: 1794157263372 }, '46,75,-10': { n: 1, firstAt: 1794157263372 } },   // Kite
  { '46,75,-14': { n: 2, firstAt: 1794153964734 }, '46,75,-10': { n: 2, firstAt: 1794153964734 } },   // Lumen
  { '46,75,-14': { n: 1, firstAt: 1794153624843 }, '46,75,-10': { n: 1, firstAt: 1794153624843 } },   // Maple
]
const COUNTS = S.sinkDeferMerge(DEFER_FILES)
const NOW = Date.parse('2026-11-10T16:30:00Z')
const DEFERRED = [{ k: '46,75,-14', why: 'no_stand', visits: 2 }, { k: '46,75,-10', why: 'no_stand', visits: 2 }]   // Lumen's 14:10Z visit
await t('THE LIVE TOWER: its two torches no stand reaches (6 deferrals, first 11-08) are waived -- the instance can close', () => {
  assert.strictEqual(COUNTS['46,75,-14'].visits, 6)
  const due = S.sinkWaiveDue(T3(), DEFERRED, COUNTS, NOW)
  assert.deepStrictEqual(due.map(d => d.k).sort(), ['46,75,-10', '46,75,-14'])
  assert.ok(due.every(d => d.why === 'no_stand'))
})
await t('the light waiver\'s limits: lights off (SINKTURN=off) none; a light deferred for another reason none; young or few none; a stone cell as before', () => {
  assert.deepStrictEqual(S.sinkWaiveDue(T3(), DEFERRED, COUNTS, NOW, { lights: false }), [], 'SINKTURN=off: lights never waived (as before)')
  assert.deepStrictEqual(S.sinkWaiveDue(T3(), [{ k: '46,75,-14', why: 'footing no_material', visits: 9 }], COUNTS, NOW), [], 'not a stand reason')
  assert.deepStrictEqual(S.sinkWaiveDue(T3(), [{ k: '46,75,-14', visits: 9 }], COUNTS, NOW), [], 'no reason named')
  assert.deepStrictEqual(S.sinkWaiveDue(T3(), DEFERRED, COUNTS, 1794153964734 + 60_000), [], 'first deferral under 6 h old')
  assert.deepStrictEqual(S.sinkWaiveDue(T3(), DEFERRED, { '46,75,-14': { visits: 2, firstAt: 0 }, '46,75,-10': { visits: 2, firstAt: 0 } }, NOW), [], 'under 3 deferrals')
  // a stone cell: unchanged (sinkwaive-01)
  assert.deepStrictEqual(S.sinkWaiveDue(T3(), [{ k: '44,70,-12', why: 'no_stand', visits: 3 }], { '44,70,-12': { visits: 3, firstAt: 0 } }, NOW).map(d => d.k), ['44,70,-12'])
  // a decor flower is never waived (decor is no waiver kind; and the filter keeps it out)
  assert.deepStrictEqual(S.sinkWaiveDue({ blueprint: 'decor@1', plot: 'decor', cells: [{ at: [1, 2, 3], role: 'D1-f2' }] }, [{ k: '1,2,3', why: 'no_stand' }], { '1,2,3': { visits: 9, firstAt: 0 } }, NOW), [])
})
await t('MUTANTS KILLED: the old filter (no light ever) leaves the live tower open; no reason check waives a light for any reason', async () => {
  await killedBy(SINKS_PATH, 'const cells = new Map((rec?.cells ?? []).filter(c => !decorFlowerRole(c.role)).map(c => [c.at.join(\',\'), c]))',
    'const cells = new Map((rec?.cells ?? []).filter(c => !sinkOpenRole(c.role)).map(c => [c.at.join(\',\'), c]))', M => {
      assert.strictEqual(M.sinkWaiveDue(T3(), DEFERRED, COUNTS, NOW).length, 2, 'MUTANT: the torches never waived')
    }, S)
  await killedBy(SINKS_PATH, "    if (sinkOpenRole(cells.get(k).role) && !(lights && /no_stand/.test(String(d?.why ?? '')))) continue\n", '', M => {
    assert.deepStrictEqual(M.sinkWaiveDue(T3(), [{ k: '46,75,-14', why: 'footing no_material', visits: 9 }], COUNTS, NOW), [], 'MUTANT: a light waived for any reason')
  }, S)
})

// ---- the wiring in skills.mjs (structural: a decision reached only through a live bot; comments stripped, anchored) ---------------
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const SKILLS = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const wired = src => {
  const n = s => src.split(s).length - 1
  return n('const sinkTurn = !!b && sinkTurnDue(b.finiteStreak) && !keeperNow(b, now)') === 1 &&
    n('service: svc?.plot ?? null, sinkTurn })') === 1 &&
    n('bot.finiteStreak = finiteStreakAfter(bot.finiteStreak, proj.plot)') === 1
}
await t('skills.mjs: shopActive passes the turn (never the grounds crew\'s); buildShopVisit counts the finite visits -- a cut line fails', () => {
  assert.ok(wired(SKILLS), 'the sink turn is not wired in skills.mjs')
  assert.ok(!wired(SKILLS.replace('bot.finiteStreak = finiteStreakAfter(bot.finiteStreak, proj.plot)', '')), 'MUTANT: the count cut still reads wired')
  assert.ok(!wired(SKILLS.replace('service: svc?.plot ?? null, sinkTurn })', 'service: svc?.plot ?? null })')), 'MUTANT: the turn not passed still reads wired')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
