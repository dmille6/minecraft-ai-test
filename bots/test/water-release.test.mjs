// THE FIXTURES ARE THE MEASURED FAILURES, not invented cases.
//
// Six hours, forty bots: 3,245 terminal drowning releases, of which 676 reached
// land. Re-entry after a release had a median of 6 seconds and a p10 of ZERO.
// Each test below is one of the shapes in that data.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  waterReleaseDecision, radiusFor, updateDryMs,
  DRY_HOLD_MS, SEARCH_RADII, WATER_STUCK_MS,
} from '../src/water-release.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

t('THE 1,814 STRANDED RELEASES: the FIRST radius is never enough', () => {
  // "surfaced, no shore, released anyway" -- 81% of these re-entered drowning,
  // 355 of them within ZERO seconds.
  const d = waterReleaseDecision({ inWater: true, ashore: false, shoreDist: null, heldMs: 5_000 })
  assert.notEqual(d.action, 'release',
    `released a bot floating in open water with no shore (${d.reason})`)
  assert.equal(d.action, 'widen', 'the answer to no shore at 24 blocks is to look further')
})

t('THE 755 TIMEOUTS: the clock alone does not free a bot', () => {
  // The old ceiling was 20s and fired regardless of where the bot was.
  const d = waterReleaseDecision({ inWater: true, ashore: false, shoreDist: 6, heldMs: 21_000 })
  assert.notEqual(d.action, 'release', 'the 20-second clock released a bot still in water')
  assert.equal(d.action, 'swim', 'it was 6 blocks from shore and closing')
})

t('THE 45% RE-ENTRY AFTER "ESCAPED": one dry tick is not out of the water', () => {
  const early = waterReleaseDecision({ inWater: false, ashore: true, dryMs: 200, heldMs: 8_000 })
  assert.equal(early.action, 'hold', 'released after 200ms ashore; 45% of these re-entered')
  const durable = waterReleaseDecision({ inWater: false, ashore: true, dryMs: DRY_HOLD_MS, heldMs: 8_000 })
  assert.equal(durable.action, 'release')
  assert.equal(durable.kind, 'drowning_escaped')
})

t('a boat is a durable safe state', () => {
  const d = waterReleaseDecision({ inWater: false, inBoat: true, ashore: false, heldMs: 9_000 })
  assert.equal(d.action, 'release')
})

t('PERMANENT OWNERSHIP CAPTURE IS ITS OWN FAILURE, and it is bounded', () => {
  // Peaceful difficulty removes death pressure but not opportunity cost. A bot
  // held forever cannot be replanned around by anything upstream.
  const d = waterReleaseDecision({ inWater: true, ashore: false, shoreDist: null,
                                   heldMs: WATER_STUCK_MS + 1 })
  assert.equal(d.action, 'give_up')
  assert.equal(d.kind, 'water_stuck', 'the hard ceiling must be DECLARED, not silent')
})

t('the ceiling declares a distinct kind, not an ordinary release', () => {
  // `drowning_surfaced_stranded` covered both real rescues and hopeless ones,
  // which is why the escape rate could not say which.
  const d = waterReleaseDecision({ inWater: true, ashore: false, shoreDist: 3,
                                   heldMs: WATER_STUCK_MS + 5_000 })
  assert.equal(d.kind, 'water_stuck')
  assert.notEqual(d.kind, 'drowning_escaped')
})

t('the search widens with time, and stops widening', () => {
  assert.equal(radiusFor(0), SEARCH_RADII[0])
  assert.equal(radiusFor(20_000), SEARCH_RADII[1])
  assert.equal(radiusFor(40_000), SEARCH_RADII[2])
  assert.equal(radiusFor(400_000), SEARCH_RADII[SEARCH_RADII.length - 1],
    'the radius must not grow without bound; block reads cost tick budget')
})

t('at the WIDEST radius with no shore, the body IS given back', () => {
  // Not a hold. This reflex already learned that pinning a surfaced,
  // full-lunged bot for the ceiling costs it the whole cycle for a rescue with
  // nowhere to rescue it to. Open water is terrain and crossing it needs the
  // body. The contribution here is that this only happens AFTER widening.
  const d = waterReleaseDecision({ inWater: true, ashore: false, shoreDist: null, heldMs: 45_000 })
  assert.equal(d.action, 'release')
  assert.equal(d.kind, 'drowning_surfaced_stranded', 'telemetry continuity: same kind as before')
  assert.equal(d.reason, 'no_shore_within_widest_radius')
})

t('but NOT at the first radius — that is the change', () => {
  const early = waterReleaseDecision({ inWater: true, ashore: false, shoreDist: null, heldMs: 1_000 })
  assert.equal(early.action, 'widen',
    'released at 24 blocks without ever looking at 48 or 96')
})

t('DRY TIME RESETS THE MOMENT THE BOT IS BACK IN', () => {
  // Without this, "3 seconds dry" could be accumulated across a bot bobbing in
  // and out of the water, which is precisely the state being ruled out.
  let dry = 0
  for (const inWater of [false, false, false]) dry = updateDryMs(dry, inWater, 500)
  assert.equal(dry, 1500)
  dry = updateDryMs(dry, true, 500)
  assert.equal(dry, 0, 'one tick back in the water must reset it')
})

t('a bobbing bot never accumulates a durable release', () => {
  let dry = 0
  let released = false
  // in, out, in, out ... every other tick, for 40 seconds
  for (let i = 0; i < 80; i++) {
    const inWater = i % 2 === 0
    dry = updateDryMs(dry, inWater, 500)
    const d = waterReleaseDecision({ inWater, ashore: !inWater, dryMs: dry, heldMs: i * 500,
                                     shoreDist: 2 })
    if (d.action === 'release') released = true
  }
  assert.ok(!released, 'a bot bobbing in and out was released as durably ashore')
})

t('a bot that reaches shore and stays is released promptly', () => {
  let dry = 0
  let releasedAt = null
  for (let i = 0; i < 40; i++) {
    dry = updateDryMs(dry, false, 500)
    const d = waterReleaseDecision({ inWater: false, ashore: true, dryMs: dry, heldMs: 10_000 + i * 500 })
    if (d.action === 'release' && releasedAt == null) releasedAt = dry
  }
  assert.equal(releasedAt, DRY_HOLD_MS, `released at ${releasedAt}ms dry, expected ${DRY_HOLD_MS}`)
})

// ---------------------------------------------------------------------------
// THE WIRING. Everything above this line passed for two days while the module
// was DEAD CODE: commit 7e947f0 added water-release.mjs and this file and
// wired it into nothing. The unit tests were green, the policy was correct,
// and no bot ever executed a line of it. A capability is not shipped until
// something calls it, so the calling is what gets asserted here.
// ---------------------------------------------------------------------------
const reflexSrc = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')

t('THE WIRING: the reflex imports the release policy at all', () => {
  assert.ok(/from '\.\/water-release\.mjs'/.test(reflexSrc),
    'water-release.mjs is orphaned again — unit-tested policy that no bot runs')
})

t('THE WIRING: dry time is advanced every tick, not only while rescuing', () => {
  assert.ok(/dryMs = updateDryMs\(dryMs, inWater, config\.reflex\.tickMs\)/.test(reflexSrc),
    'dryMs is not being advanced from the reflex tick — it would sit at 0 and ' +
    'the durability clause would hold every rescued bot until the ceiling')
  // Advancing it only inside the rescue branch would let a bot released ashore
  // and re-seized four seconds later inherit dry time it never earned.
  const tick = reflexSrc.indexOf('dryMs = updateDryMs')
  const phase2 = reflexSrc.indexOf('if (rescuing && !air.losing && !ashore()')
  assert.ok(tick > 0 && tick < phase2,
    'dryMs is advanced inside the rescue path — it must be advanced from the ' +
    'plain tick, or dry time survives across rescues')
})

t('THE WIRING: reaching land is not enough; it has to STICK', () => {
  assert.ok(/ashore\(\) && dryMs >= DRY_HOLD_MS/.test(reflexSrc),
    'the release still fires on one tick of ashore() — that is what made 45% ' +
    'of `drowning_escaped` bots re-enter the water immediately')
})

t('THE SCAN RADIUS MUST FIT THE READ BUDGET', () => {
  // Raising the radius without raising SHORE_MAX_READS makes every open-water
  // scan return `partial`, and a partial scan is never cached -- so the scan
  // runs every tick instead of every SHORE_TTL_MS and logs the same condition
  // four times as often. Measured on the placebo-c canary: no_shore +61 per
  // 1,000 water events, difference-in-differences, with no change in how many
  // bots were actually stranded.
  //
  // A full scan costs about 9.4 * r^2 reads. This asserts the configured
  // radius can actually COMPLETE, which is what makes it cacheable.
  const reads = r => 9.4 * r * r
  const budget = Number(/SHORE_MAX_READS = ([0-9_]+)/.exec(reflexSrc)[1].replace(/_/g, ''))
  const usesWidest = /SEARCH_RADII\[SEARCH_RADII\.length - 1\]/.test(reflexSrc)
  const radius = usesWidest ? SEARCH_RADII[SEARCH_RADII.length - 1] : SEARCH_RADII[0]
  assert.ok(reads(radius) < budget,
    `a full scan at radius ${radius} costs ~${Math.round(reads(radius))} reads but ` +
    `SHORE_MAX_READS is ${budget} — every open-water scan will return partial, ` +
    'never cache, and re-run every tick. Raise the budget or lower the radius.')
})

t('THE WIRING: a held bot ashore is not also being steered', () => {
  assert.ok(/dryMs < DRY_HOLD_MS[\s\S]{0,400}clearControlStates/.test(reflexSrc),
    'the bot is held ashore with its swim controls still latched — it would ' +
    'bunny-hop along the bank for three seconds instead of standing still')
})

t('THE WIRING: the live/dead split at the top of the module is TRUE', () => {
  // Without this, the note ages into a lie the first time someone wires one of
  // the dead exports up -- and a stale map of what runs is worse than none.
  const live = ['updateDryMs', 'DRY_HOLD_MS', 'SEARCH_RADII']
  const dead = ['waterReleaseDecision', 'radiusFor', 'WATER_STUCK_MS', 'WIDEN_AT_MS']
  const callers = ['reflex.mjs', 'skills.mjs', 'index.mjs']
    .map(f => { try { return readFileSync(new URL('../src/' + f, import.meta.url), 'utf8') } catch { return '' } })
    .join('\n')
  for (const name of live) {
    assert.ok(callers.includes(name),
      `${name} is documented LIVE and nothing calls it — either wire it or ` +
      'move it to the DEAD list in water-release.mjs')
  }
  for (const name of dead) {
    assert.ok(!callers.includes(name),
      `${name} is documented DEAD but something now uses it — update the note ` +
      'at the top of water-release.mjs, which is the map of what actually runs')
  }
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
