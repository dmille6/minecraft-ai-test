// THE RAMP RAN 342 TIMES FOR ENTOMBED BOTS AND CUT ZERO STEPS.
//
// Measured 2026-09-06 over 11.7h. Five bots sealed in 1x1 capped pockets — walls
// on all four cardinals, confirmed by server-side RCON scans — at y=7, 35, 43,
// 47 and 60. `escapeStairUp` was called for them 342 times and succeeded 0.
//
//     yielded the body to the drowning rescue   46.9%
//     dig aborted                               29.2%
//     dig exceeded                              23.9%
//
// Each of those bots emitted ~7,300-7,800 water/drowning events in the window at
// mean health 19.6/20, including ~1,138 `drowning_ceiling_no_air` — the rescue
// concluding it cannot help, and holding the body anyway. A bot encased in stone
// is not drowning.
//
// The cause is the recorded `oxygen is fish` defect: mineflayer fills
// `bot.oxygenLevel` from ANY nearby entity's `air_supply`. This does not try to
// fix that sensor — three attempts already failed and were reverted. It asks a
// cheaper question instead: is there water here at all?
import assert from 'node:assert'
import fsmod from 'node:fs'
import test from 'node:test'
import { drowningCouldBeReal } from '../src/reflex.mjs'

test('POSITIVE CONTROL: the predicate answers both ways', () => {
  assert.equal(drowningCouldBeReal({ names: ['water'] }), true)
  assert.equal(drowningCouldBeReal({ names: ['stone'] }), false)
})

test('THE ENTOMBED CASE: sealed in stone is not drowning', () => {
  // isolated-a-Delta y=7: feet and head air, every cardinal solid, capped.
  const sealed = { isInWater: false,
    names: ['air', 'air', 'stone', 'stone', 'stone', 'stone',
            'stone', 'stone', 'stone', 'stone', 'stone'] }
  assert.equal(drowningCouldBeReal(sealed), false,
    'no water anywhere — the rescue cannot be real and must not hold the body')
  // deepslate at depth, same shape
  assert.equal(drowningCouldBeReal({ isInWater: false,
    names: Array(11).fill('deepslate') }), false)
})

test('A GENUINELY DROWNING BOT STILL YIELDS — every way it can present', () => {
  // The asymmetry is the point: a wrongly-yielded ramp resumes from the step it
  // stopped on; a wrongly-refused rescue does not get its bot back. Standing the
  // water rescue down globally multiplied drownings 7.5x.
  assert.equal(drowningCouldBeReal({ isInWater: true, names: ['air', 'air'] }), true,
    'isInWater alone is enough, whatever the blocks say')
  assert.equal(drowningCouldBeReal({ names: ['water', 'water'] }), true, 'submerged')
  assert.equal(drowningCouldBeReal({ names: ['air', 'water'] }), true, 'head under')
  assert.equal(drowningCouldBeReal({ names: ['water', 'air'] }), true, 'feet under')
  assert.equal(drowningCouldBeReal({ names: ['flowing_water'] }), true)
  assert.equal(drowningCouldBeReal({ names: ['bubble_column'] }), true)
  // Water merely BESIDE the bot still yields — generous on purpose.
  assert.equal(drowningCouldBeReal({ names: ['air', 'air', 'water'] }), true,
    'water beside the head is close enough to stand down for')
})

test('missing or unreadable observations do NOT invent a rescue', () => {
  // A chunk that has not loaded gives nulls. That is not evidence of water, and
  // reading it as such would restore the bug for exactly the bots whose chunks
  // are flaky.
  assert.equal(drowningCouldBeReal({ names: [null, null, null] }), false)
  assert.equal(drowningCouldBeReal({ names: [] }), false)
  assert.equal(drowningCouldBeReal({}), false)
  assert.equal(drowningCouldBeReal(), false)
})

test('it does NOT consult oxygenLevel — that is the broken field', () => {
  // `oxygen is fish`: mineflayer writes it from any nearby entity's air_supply,
  // and three fixes to it have already failed and been reverted. The predicate
  // must be immune to it.
  assert.equal(drowningCouldBeReal({ names: ['stone'], oxygenLevel: 0 }), false,
    'zero oxygen in solid rock is the phantom, not a reason to yield')
  assert.equal(drowningCouldBeReal({ names: ['water'], oxygenLevel: 20 }), true,
    'and full oxygen in water still yields')
})

test('WIRED IN: the yield is gated, and only the yield', () => {
  const raw = fsmod.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

  assert.match(code, /const drowningOwnsBody = \(\) =>/,
    'POSITIVE CONTROL: the yield predicate is still there')
  assert.match(code, /rescuing && drowningCouldBeReal\(/,
    'the yield must require BOTH an active rescue and water that exists')

  // It must gate the YIELD only. If `rescuing` itself were gated, a real
  // drowning rescue would stop running — a far larger change than this.
  const rescueSites = [...code.matchAll(/\brescuing\s*=\s*true/g)]
  assert.ok(rescueSites.length > 0, 'POSITIVE CONTROL: the rescue still arms itself')
  assert.doesNotMatch(code, /rescuing\s*=\s*true\s*&&\s*drowningCouldBeReal/,
    'the rescue itself must NOT be gated — only whether an escape stands down')
})
