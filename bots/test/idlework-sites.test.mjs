// IDLEWORK-01 PIECE B: an open project a visit could not site waits behind the other open projects (shop.mjs unsitedBackoff), so
// one unsitable monument / house / workshop no longer leaves a town with no project at all. The measured town shapes (fleet
// 11-05 01Z..11-06 01Z): board-a/placebo-d (monument unsited, paths/wall/tidy never reached), hive-c (house1 unsited: monument and
// tidy never reached), board-c (the workshop unsited: the stair and the tidy, which need no workshop, never reached).
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const S = await import('../src/shop.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const NOW = 2_000_000_000
// every project on (the fleet's set plus the tree farm), in PROJECTS order
const LIST = S.PROJECTS
const st = (plot, o = {}) => ({ plot, exists: false, complete: false, damaged: false, ...o })
const done = plot => st(plot, { exists: true, complete: true })
const stamps = m => plot => m[plot] ?? null

await t('unsitedBackoff: a fresh stamp on a project with NO record -> not free (unsited); a record, an old or a future stamp -> unchanged', () => {
  const states = [st('monument'), st('paths', { exists: true }), st('wall'), st('tidy')]
  const out = S.unsitedBackoff(states, stamps({ monument: NOW - 1000, paths: NOW - 1000, wall: NOW - S.UNSITED_WAIT_MS - 1, tidy: NOW + 3_600_000 }), NOW)
  assert.equal(out[0].free, false); assert.equal(out[0].unsited, true)
  assert.deepEqual(out[1], states[1], 'a project with a record is never unsited')
  assert.deepEqual(out[2], states[2], 'the day is over: re-fit')
  assert.deepEqual(out[3], states[3], 'a stamp an hour in the future (a bad clock) is ignored')
  assert.deepEqual(S.unsitedBackoff(states, null, NOW), states)
  assert.deepEqual(S.unsitedBackoff(states, () => { throw new Error('x') }, NOW), states, 'an unreadable stamp is none')
})

await t('board-a / placebo-d: the monument unsited -> the paths are worked (then the wall and the tidy behind them)', () => {
  const states = [done('shop'), done('shaft'), done('house1'), st('monument'), st('paths'), st('wall'), st('treefarm'), st('tidy')]
  assert.equal(S.activeProject(states, LIST).plot, 'monument', 'control: today the unsitable monument is the pick')
  assert.equal(S.activeProject(S.unsitedBackoff(states, stamps({ monument: NOW - 60_000 }), NOW), LIST).plot, 'paths')
})
await t('hive-c: house1 unsited (shop done, stair no_site/complete) -> the monument', () => {
  const states = [done('shop'), done('shaft'), st('house1'), st('monument'), st('paths'), st('wall'), st('treefarm'), st('tidy')]
  assert.equal(S.activeProject(states, LIST).plot, 'house1', 'control')
  assert.equal(S.activeProject(S.unsitedBackoff(states, stamps({ house1: NOW - 60_000 }), NOW), LIST).plot, 'monument')
})
await t('board-c: the workshop unsited -> the stair (it needs no workshop)', () => {
  const states = LIST.map(p => st(p.plot))
  assert.equal(S.activeProject(states, LIST).plot, 'shop', 'control')
  assert.equal(S.activeProject(S.unsitedBackoff(states, stamps({ shop: NOW - 60_000 }), NOW), LIST).plot, 'shaft')
})
await t('COMPOSED: everything open unsited -> activeProject still returns the first, and the ORDER holds on its stamp (no visit storm)', () => {
  // merge to main: main's PROJECTS has more plots (shopchest, storehouse, hall, yard); "everything open" is every plot in LIST
  // past the three done ones, each stamped unsited
  const states = LIST.map(p => (['shop', 'shaft', 'house1'].includes(p.plot) ? done(p.plot) : st(p.plot)))
  const all = Object.fromEntries(states.filter(x => !x.exists).map(x => [x.plot, NOW - 1]))
  const pick = S.activeProject(S.unsitedBackoff(states, stamps(all), NOW), LIST)
  assert.equal(pick.plot, 'monument')
  S.setActivePlot(() => pick.plot); S.setUnsitedOf(stamps(all))
  try {
    const r = S.buildOrder({ on: true, shared: true, atTown: true, now: NOW, state: { lastAt: NOW - S.SHOP_COOLDOWN_MS - 1 }, record: null, slotsFree: true, health: 20, freeSlots: 36 })
    assert.deepEqual(r, { order: null, skip: 'no_site' })
  } finally { S.setUnsitedOf(() => null); S.setActivePlot(() => null) }
})
await t('UNSITEDWAIT=0 is the rollback switch', () => {
  assert.equal(S.unsitedWaitOn({}), true)
  for (const v of ['0', 'off', 'false', 'no']) assert.equal(S.unsitedWaitOn({ UNSITEDWAIT: v }), false)
})

await t('the stamp file: write, read back, torn or absent reads null', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'unsited-'))
  try {
    assert.equal(S.unsitedRead(dir, 'project-1_2_3.monument'), null)
    assert.equal(S.unsitedWrite(dir, 'project-1_2_3.monument', { plot: 'monument', why: 'no ziggurat site', by: 'b', now: NOW }), true)
    assert.equal(S.unsitedRead(dir, 'project-1_2_3.monument'), NOW)
    writeFileSync(path.join(dir, 'project-1_2_3.wall.unsited.json'), '{"at":')
    assert.equal(S.unsitedRead(dir, 'project-1_2_3.wall'), null)
    assert.equal(S.unsitedWrite(path.join(dir, 'missing', 'deeper'), 'k', { now: NOW }), false, 'never throws')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ---- the wiring (structural, comments stripped, executable lines; each anchor present and unique) ----
// REBASE ONTO STUCKPROJ-01 (starve-01): shopActive applies unsitedBackoff, then starveMark, then activeProject. The two marks are
// disjoint by construction (unsited: a project with NO record; starved: one WITH an open record), so the order of the two does
// not matter and neither defeats the other. Behaviour, through the exported pure functions.
await t('starve-01 x unsited: an unsited project is never offered first as starved; a starved one is never held as unsited; each rollback alone', () => {
  const takes = m => plot => m[plot] ?? null
  const OLD = NOW - S.STARVE_MS - 60_000
  // A (the fleet's starve shape): monument open and busy, the wall open and starved, the tree farm unsited (no record)
  const A = [done('shop'), done('shaft'), done('house1'), st('monument', { exists: true }), done('paths'), st('wall', { exists: true }), st('treefarm'), st('tidy')]
  const unsA = stamps({ treefarm: NOW - 60_000 }), takeA = takes({ monument: NOW - 1000, wall: OLD, treefarm: OLD })
  const both = S.starveMark(S.unsitedBackoff(A, unsA, NOW), { lastTakeOf: takeA, now: NOW })
  assert.deepEqual(both, S.unsitedBackoff(S.starveMark(A, { lastTakeOf: takeA, now: NOW }), unsA, NOW), 'the order of the two marks does not matter')
  assert.equal(both.find(x => x.plot === 'treefarm').unsited, true)
  assert.equal(both.find(x => x.plot === 'treefarm').starved, undefined, 'a record-less project is never starved (an old take notwithstanding)')
  assert.equal(both.find(x => x.plot === 'wall').starved, true)
  assert.equal(both.find(x => x.plot === 'wall').unsited, undefined, 'a project with a record is never unsited')
  assert.equal(S.activeProject(both, LIST).plot, 'wall', 'both on: the starved wall first')
  assert.equal(S.activeProject(S.unsitedBackoff(A, unsA, NOW), LIST).plot, 'monument', 'STARVE=0: the order')
  assert.equal(S.activeProject(A, LIST).plot, 'monument', 'both off: control')
  // B (the unsited project BEFORE the starved one): house1 unsited, the monument starved
  const B = [done('shop'), done('shaft'), st('house1'), st('monument', { exists: true }), st('paths'), st('wall'), st('treefarm'), st('tidy')]
  const unsB = stamps({ house1: NOW - 60_000 }), takeB = takes({ monument: OLD, house1: OLD })
  assert.equal(S.activeProject(B, LIST).plot, 'house1', 'both off: control, the unsitable house1')
  assert.equal(S.activeProject(S.unsitedBackoff(B, unsB, NOW), LIST).plot, 'monument', 'STARVE=0: house1 yields its turn')
  assert.equal(S.activeProject(S.starveMark(B, { lastTakeOf: takeB, now: NOW }), LIST).plot, 'monument', 'UNSITEDWAIT=0: the starved monument still first')
  const bothB = S.starveMark(S.unsitedBackoff(B, unsB, NOW), { lastTakeOf: takes({ monument: NOW, house1: OLD }), now: NOW })
  assert.equal(S.activeProject(bothB, LIST).plot, 'monument', 'both on, the monument fresh: house1 still yields (never re-offered as starved)')
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const once = (src, re, what) => { const m = src.match(new RegExp(re.source, 'g')) ?? []; assert.equal(m.length, 1, `${what}: ${m.length} matches`) }
await t('WIRED: shopActive applies unsitedBackoff after the stuck back-off; build_shop stamps a no_site visit with no record', () => {
  once(SK, /const waitedU = unsitedWaitOn\(\) \? unsitedBackoff\(waited, unsitedOfPlot, now\) : waited/, 'the backoff in shopActive')
  // rebase onto stuckproj-01: the pick reads waitedU through starve-01's marks (an unsited state is never marked starved)
  // buildnext-01: the bot's scoped holds (nextBackoff) apply to the unsited-backed states, and starve marks those
  once(SK, /const waitedN = buildNextOn\(\) && b \? nextBackoff\(waitedU, [^\n]*\) : waitedU/, 'the scoped holds read the unsited-backed states')
  once(SK, /const marked = starve \? starveMark\(waitedN, \{[^\n]*\}\) : waitedN/, 'starve marks the unsited-backed states')
  once(SK, /let pick = activeProject\(marked, (list|order)\)/, 'the pick reads it')
  once(SK, /if \(unsitedWaitOn\(\) && r\?\.stop === 'no_site'\) \{/, 'the stamp on no_site')
  once(SK, /if \(h\.ok && !h\.head && unsitedWrite\(dir, key, \{ plot: proj\.plot/, 'only with no record')
  once(SK, /build_shop: \{ run: buildShop, /, 'the skill runs the wrapper')
  once(SK, /setUnsitedOf\(unsitedOfPlot\)/, 'the order reads the stamp')
})
await t('MUTANT KILLED: the wiring check fails when the backoff is not applied', () => {
  const mutant = SK.replace('const waitedU = unsitedWaitOn() ? unsitedBackoff(waited, unsitedOfPlot, now) : waited', 'const waitedU = waited')
  assert.notEqual(mutant, SK, 'ANCHOR MISSING')
  assert.throws(() => once(mutant, /const waitedU = unsitedWaitOn\(\) \? unsitedBackoff\(waited, unsitedOfPlot, now\) : waited/, 'x'))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
