// A RESCUE THAT PROVED IT CANNOT HELP MUST STOP TAKING THE BODY.
//
// Measured 2026-09-04 over 6h on six captured bots: 4,603
// `_drowning_ceiling_no_air` expiries -- one every 28 seconds per bot -- each
// reading "held 20s and never reached air (oxygen 400, health 20) -- sealed".
//
// Oxygen 400 of ~400 is a FULL tank. Health 20 is untouched. Zero deaths in six
// hours; zero health readings below 20, against 122 sub-20 readings elsewhere on
// the fleet in the same window, so 20/20 is a reading and not a stuck field.
// Those bots were not drowning.
//
// The cost is the `return`, not the rescue: while the rescue owns the body the
// entombed and maroon handlers get only the ~2s gaps between ceilings. This file
// already records that shape as a bug for the suffocation branch -- "it could
// never reach the one routine that would free it ... So: fall through."
//
// THE SAFETY ARGUMENT, which is the only thing that matters here: this area has
// regressed four times, once at 7.5x drownings. Suppression is keyed on OUTCOME,
// never on cause, and any health loss clears it immediately. A bot that is
// genuinely drowning loses health within a second or two, so a real rescue can
// never be held back for longer than that.
import assert from 'node:assert'
import test from 'node:test'
import { drownRescueSuppressed } from '../src/reflex.mjs'

test('a fresh rescue is never suppressed', () => {
  // The first attempt must always be allowed. This is the whole air reflex.
  assert.equal(drownRescueSuppressed({ failures: 0 }), false)
  assert.equal(drownRescueSuppressed({}), false)
  assert.equal(drownRescueSuppressed({ failures: 1 }), false,
    'one failure is not yet proof; conditions change')
})

test('two failed ceilings at one spot stops the re-seize', () => {
  // 20s x2 held, no air produced, bot has not moved. That is the measured loop.
  assert.equal(drownRescueSuppressed({ failures: 2 }), true)
  assert.equal(drownRescueSuppressed({ failures: 978 }), true,
    'placebo-b-Delta ran 978 consecutive cycles')
})

test('LOSING HEALTH ALWAYS OUTRANKS SUPPRESSION — the safety property', () => {
  // The one assertion that must never break. A drowning bot loses health, so a
  // real emergency can never be suppressed, at any failure count.
  for (const f of [0, 1, 2, 10, 978, Number.MAX_SAFE_INTEGER]) {
    assert.equal(drownRescueSuppressed({ failures: f, healthDropped: true }), false,
      `health dropped at ${f} failures and the rescue was still suppressed`)
  }
})

test('moving away is a new situation and clears it', () => {
  // Suppression is positional. A bot that swam somewhere else gets a fresh
  // rescue, because the evidence was about THAT spot.
  assert.equal(drownRescueSuppressed({ failures: 99, movedBlocks: 1.5 }), false)
  assert.equal(drownRescueSuppressed({ failures: 99, movedBlocks: 40 }), false)
  assert.equal(drownRescueSuppressed({ failures: 99, movedBlocks: 1.4 }), true,
    'jitter under the threshold is the same spot')
})

test('both escapes compose — either one alone releases the body', () => {
  assert.equal(drownRescueSuppressed({ failures: 5, movedBlocks: 9, healthDropped: true }), false)
  assert.equal(drownRescueSuppressed({ failures: 5, movedBlocks: 9, healthDropped: false }), false)
  assert.equal(drownRescueSuppressed({ failures: 5, movedBlocks: 0, healthDropped: true }), false)
  assert.equal(drownRescueSuppressed({ failures: 5, movedBlocks: 0, healthDropped: false }), true,
    'only the stuck-and-unharmed case suppresses')
})

test('junk input never suppresses — fail open, toward rescuing', () => {
  // If the caller cannot tell us anything, the air reflex must still run. The
  // owner directive is that the ONLY water reflex is getting air; a bug in this
  // bookkeeping must not be able to switch it off.
  assert.equal(drownRescueSuppressed(undefined), false)
  assert.equal(drownRescueSuppressed({ failures: NaN }), false)
  assert.equal(drownRescueSuppressed({ failures: null }), false)
  assert.equal(drownRescueSuppressed({ failures: 2, movedBlocks: NaN }), false,
    'an unknown distance must not be read as "has not moved"')
})
