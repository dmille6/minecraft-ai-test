// THE REFLEX CANCELLED 9.8% OF EVERY SKILL RUN THE FLEET STARTED.
//
// `seizeBody` has been gated on `airEmergency` since canary 4a1dfcb. The
// INTERRUPT never was. It sat eighteen lines ABOVE the comment that reads "THE
// REFLEX MAY NOT CANCEL A JOURNEY", behind nothing but `bot.oxygenLevel` — the
// counter mineflayer fills from ANY nearby entity's air_supply.
//
// Measured 2026-09-06, 7h, 80 bots:
//   reflex_drowning 16,585 firings = 29.6/bot-hour
//     97.8% at health 20/20;  35.2% with the head block already AIR
//   2,965 skill runs aborted with reason `drowning` = 73% of ALL aborts
//   swim_to: 941 of 1,044 aborts are drowning = 44.4% of every swim attempt,
//            and swim_to succeeds 4.4% — identical to the 4% recorded months
//            ago, because the fix went to the steering and the damage was here.
//
// The tell: `water_travel_uninterrupted`, whose detail reads "not seizing", is
// followed by a `reflex_drowning` within 250ms 55.7% of the time, and
// `drowning_rescue_yielded` 75.5% — against a 0.10% coincidence baseline on
// `affordance_scan`. 557x. The code logged that it was leaving the body alone
// on the same tick it had already taken it.
import assert from 'node:assert'
import fsmod from 'node:fs'
import test from 'node:test'
import { mayInterruptForAir } from '../src/reflex.mjs'

test('POSITIVE CONTROL: it both permits and refuses', () => {
  assert.equal(mayInterruptForAir({ mayAct: true, owned: false, emergency: false }), true)
  assert.equal(mayInterruptForAir({ mayAct: true, owned: true, emergency: false }), false)
})

test('THE ONE CASE SPARED: a steered bot with air to spare keeps its journey', () => {
  // This is the whole delta. Everything else behaves exactly as before.
  assert.equal(mayInterruptForAir({ mayAct: true, owned: true, emergency: false }), false)
})

test('A REAL AIR EMERGENCY STILL INTERRUPTS, steered or not', () => {
  for (const owned of [true, false]) {
    assert.equal(mayInterruptForAir({ mayAct: true, owned, emergency: true }), true,
      `emergency must always win (owned=${owned})`)
  }
})

test('AN UNOWNED BOT IS STILL INTERRUPTED AT ANY AIR LEVEL — this is not 4a1dfcb', () => {
  // Canary 4a1dfcb stood the rescue down for bots nobody was steering and
  // multiplied drownings 7.5x (p = 0.0079). That population is untouched here:
  // with no skill running and no goal set, the interrupt fires as it always did.
  assert.equal(mayInterruptForAir({ mayAct: true, owned: false, emergency: false }), true)
  assert.equal(mayInterruptForAir({ mayAct: true, owned: false, emergency: true }), true)
})

test('mayAct is still the outer authority', () => {
  // An observing bot never acts, whatever the air says.
  for (const owned of [true, false]) for (const emergency of [true, false]) {
    assert.equal(mayInterruptForAir({ mayAct: false, owned, emergency }), false)
  }
  assert.equal(mayInterruptForAir(), false, 'no arguments at all must not interrupt')
})

test('the full truth table, so the delta is exactly one cell', () => {
  const rows = []
  for (const mayAct of [true, false])
    for (const owned of [true, false])
      for (const emergency of [true, false])
        rows.push([mayAct, owned, emergency, mayInterruptForAir({ mayAct, owned, emergency })])
  // Old behaviour was simply `mayAct`. Count where the new answer differs.
  const changed = rows.filter(([m, , , now]) => m !== now)
  assert.equal(changed.length, 1, `exactly one cell may change, got ${changed.length}`)
  assert.deepEqual(changed[0].slice(0, 3), [true, true, false],
    'and it must be the steered, non-emergency bot')
})

test('WIRED IN: the bare interrupt is gone, and the gate is hoisted above it', () => {
  const raw = fsmod.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

  assert.match(code, /runner\.interrupt\(air\.kind\)/,
    'POSITIVE CONTROL: the interrupt call still exists')
  assert.doesNotMatch(code, /if \(mayAct\) runner\.interrupt\(air\.kind\)/,
    'the ungated interrupt is back — that is 9.8% of every skill run')
  assert.match(code, /mayInterruptForAir\(\{ mayAct, owned, emergency \}\)/,
    'the interrupt must consult the same two facts the seizure does')

  // The gate must be computed BEFORE the interrupt, or it cannot gate it. This
  // is the actual defect: `emergency` was defined forty lines further down.
  const gi = code.indexOf('const emergency = airEmergency')
  const ii = code.indexOf('runner.interrupt(air.kind)')
  assert.ok(gi > 0 && ii > 0, 'POSITIVE CONTROL: both sites are findable')
  assert.ok(gi < ii, 'emergency must be computed BEFORE the interrupt it gates')
})

test('healthFalling compared a value against itself and never once fired', () => {
  const raw = fsmod.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
  assert.doesNotMatch(code, /healthFalling: prevHealth != null && \(bot\.health \?\? prevHealth\) < prevHealth/,
    'prevHealth is assigned bot.health one line earlier, so this is bot.health < bot.health')
  assert.match(code, /const prevHealthBefore = prevHealth/,
    'the pre-overwrite value must be captured')
  assert.match(code, /healthFalling: prevHealthBefore != null/,
    'and compared against')
})
