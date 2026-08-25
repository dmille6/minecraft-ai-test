// THE FIXTURES ARE THE MEASURED FAILURES, not invented cases.
//
// Six hours, forty bots: 3,245 terminal drowning releases, of which 676 reached
// land. Re-entry after a release had a median of 6 seconds and a p10 of ZERO.
// Each test below is one of the shapes in that data.
import assert from 'node:assert'
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

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
