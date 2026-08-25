// The fixture is the measured conflict: over six hours, 279 started crossings
// and `drowning` was the single largest outcome at 174 -- the skill creating
// the state the reflex exists to interrupt, then losing the body to it.
import assert from 'node:assert'
import {
  breathPlan, marginOk, DIVE_UNTIL, BREATHE_TO, REFLEX_CRITICAL, MIN_MARGIN,
} from '../src/swim-breath.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

t('THE MARGIN THE OLD RULE DID NOT HAVE', () => {
  // Surfaced at 35% against a reflex firing at 25%: ten points, on a signal
  // sampled every 500ms, while rising takes time.
  assert.ok(marginOk(), `dive floor ${DIVE_UNTIL} is not ${MIN_MARGIN} clear of ${REFLEX_CRITICAL}`)
  assert.ok(!marginOk(0.35), 'the OLD 35% threshold must not be considered safe')
  assert.ok(DIVE_UNTIL - REFLEX_CRITICAL >= MIN_MARGIN)
})

t('IT NEVER REACHES THE REFLEX THRESHOLD across a full crossing', () => {
  // Simulate: air falls 1%/tick submerged, refills 6%/tick at the surface.
  let air = 1.0, phase = 'dive', headUp = false
  let minAir = 1.0, dived = 0
  for (let i = 0; i < 4000; i++) {
    const p = breathPlan({ airFraction: air, headUp, phase })
    phase = p.phase
    if (p.abort) throw new Error('aborted on an open-water crossing')
    if (phase === 'dive' && !p.jump) { headUp = false; air -= 0.01; dived++ }
    else { if (p.jump) headUp = true; air = headUp ? Math.min(1, air + 0.06) : air - 0.01 }
    minAir = Math.min(minAir, air)
  }
  assert.ok(minAir > REFLEX_CRITICAL,
    `air reached ${minAir.toFixed(2)}, at or below the reflex threshold ${REFLEX_CRITICAL}`)
  assert.ok(dived > 2000, `only ${dived} of 4000 ticks submerged; the speed gain is gone`)
})

t('most of the crossing is still spent submerged, which is the point', () => {
  let air = 1.0, phase = 'dive', headUp = false, dived = 0
  for (let i = 0; i < 2000; i++) {
    const p = breathPlan({ airFraction: air, headUp, phase })
    phase = p.phase
    if (phase === 'dive' && !p.jump) { headUp = false; air -= 0.01; dived++ }
    else { if (p.jump) headUp = true; air = headUp ? Math.min(1, air + 0.06) : air - 0.01 }
  }
  const frac = dived / 2000
  assert.ok(frac > 0.6, `only ${(frac * 100).toFixed(0)}% submerged; surface-only would be simpler`)
})

t('it surfaces EARLY, not when air is nearly gone', () => {
  const p = breathPlan({ airFraction: DIVE_UNTIL - 0.01, headUp: false, phase: 'dive' })
  assert.equal(p.phase, 'breathe')
  assert.equal(p.jump, true, 'must rise')
  assert.equal(p.sprint, false, 'sprinting while rising is the pose that keeps it down')
})

t('SURFACING DOES NOT OSCILLATE', () => {
  // Without a carried phase, air ticking back over the threshold flips the
  // decision every sample and the bot bobs instead of breathing.
  let p = breathPlan({ airFraction: 0.54, headUp: false, phase: 'dive' })
  assert.equal(p.phase, 'breathe')
  p = breathPlan({ airFraction: 0.60, headUp: false, phase: p.phase })
  assert.equal(p.phase, 'breathe', 'went back down before ever reaching air')
  p = breathPlan({ airFraction: 0.80, headUp: true, phase: p.phase })
  assert.equal(p.phase, 'breathe', 'dived again on a partial breath')
  p = breathPlan({ airFraction: BREATHE_TO, headUp: true, phase: p.phase })
  assert.equal(p.phase, 'dive', 'never resumed the crossing')
})

t('a full breath resumes the sprint', () => {
  const p = breathPlan({ airFraction: 1.0, headUp: true, phase: 'breathe' })
  assert.equal(p.phase, 'dive')
  assert.equal(p.sprint, true)
  assert.equal(p.jump, false, 'jump in water adds lift, not speed')
})

t('NO AIR READING IS NOT A FULL BREATH', () => {
  // A stale oxygen value sending bots under on an empty lung is exactly the
  // class of bug that cost a day here.
  const p = breathPlan({ airFraction: null, headUp: false, phase: 'dive' })
  assert.equal(p.phase, 'breathe')
  assert.equal(p.sprint, false, 'unknown air must not buy a submerged sprint')
})

t('trapped under a ceiling aborts while there is still margin', () => {
  const p = breathPlan({ airFraction: DIVE_UNTIL, headUp: false, phase: 'dive', canSurface: false })
  assert.equal(p.abort, true)
  assert.equal(p.phase, 'trapped')
})

t('but a bot with air and a ceiling keeps going', () => {
  const p = breathPlan({ airFraction: 0.9, headUp: false, phase: 'dive', canSurface: false })
  assert.ok(!p.abort, 'aborted with 90% air still in the lungs')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
