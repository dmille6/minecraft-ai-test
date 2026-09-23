// A REPEAT FROM 48 BLOCKS AWAY IS NOT A REPEAT.
//
// MEASURED on the fleet 2026-09-23. `actionKey` keeps only DECLARED args and `explore` declares
// exactly one, `blocks`. Over 2,717 explore proposals in four hours, 69% were the identical key
// explore:{"blocks":60} and another 22% were {"blocks":80} -- two values are 91% of all of them.
// So the oscillation guard saw "the identical action" constantly, and explore is 44.3%
// repeat_loop and ~54% of every repeat_loop the fleet produces.
//
// Whether those were real loops depends on whether the bot MOVED, and it mostly did: of 1,934
// consecutive identical-key explore pairs across all 80 bots, **75.7% had the bot more than 8
// blocks from where it made the previous one** -- median 48 blocks apart, p90 91, max 418. Only
// 24.3% were genuinely stationary. Three quarters of the counted repeats were explores of the
// same SIZE from different PLACES, which are different actions.
//
// The stationary case, which is what the guard exists for, must still trip at the same count.
import assert from 'node:assert'
import { AdmissionControl } from '../src/admission.mjs'
import { LIVELOCK_MIN_MOVE } from '../src/cognitive.mjs'

let pass = 0, fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
  ok ? pass++ : fail++
}

const bot = (x, z) => ({
  registry: { blocksByName: { oak_log: { id: 1 } }, itemsByName: { oak_log: { id: 1 } } },
  entity: { position: { x, y: 70, z } },
  players: {}, inventory: { items: () => [] },
})
const EXPLORE = { skill: 'explore', args: { blocks: 60 } }

console.log('\n1. STATIONARY: the guard still fires at the same count -- this is what it is for')
{
  const gate = new AdmissionControl(null)
  const r = []
  for (let i = 0; i < 7; i++) r.push(gate.check({ ...EXPLORE }, bot(0, 0)).reason ?? 'ok')
  t('four admitted from one spot, then refused', r,
    ['ok', 'ok', 'ok', 'ok', 'repeat_loop', 'repeat_loop', 'repeat_loop'])
}

console.log('\n2. MOVING: the same key from a new place every time is never a loop')
{
  const gate = new AdmissionControl(null)
  const r = []
  for (let i = 0; i < 7; i++) r.push(gate.check({ ...EXPLORE }, bot(i * 48, 0)).reason ?? 'ok')
  t('a bot exploring 48 blocks apart is admitted every time', r, Array(7).fill('ok'))
}

console.log('\n3. THE BOUNDARY is the same 8 blocks the livelock breaker uses')
{
  const gate = new AdmissionControl(null)
  for (let i = 0; i < 4; i++) gate.check({ ...EXPLORE }, bot(0, 0))
  t('7 blocks away still counts as the same place', gate.check({ ...EXPLORE }, bot(7, 0)).reason, 'repeat_loop')
  t('9 blocks away does not', gate.check({ ...EXPLORE }, bot(9, 0)).reason ?? 'ok', 'ok')
}

console.log('\n4. drifting back to the old spot re-arms it -- the memory is positional, not a reset')
{
  const gate = new AdmissionControl(null)
  for (let i = 0; i < 4; i++) gate.check({ ...EXPLORE }, bot(0, 0))
  t('far away: admitted', gate.check({ ...EXPLORE }, bot(200, 0)).reason ?? 'ok', 'ok')
  t('back at the origin: refused again', gate.check({ ...EXPLORE }, bot(1, 1)).reason, 'repeat_loop')
}

console.log('\n5. no position (a bot with no entity) behaves exactly as before')
{
  const gate = new AdmissionControl(null)
  const blind = { ...bot(0, 0), entity: null }
  const r = []
  for (let i = 0; i < 6; i++) r.push(gate.check({ ...EXPLORE }, blind).reason ?? 'ok')
  t('counts every proposal, as it always did', r, ['ok', 'ok', 'ok', 'ok', 'repeat_loop', 'repeat_loop'])
}

console.log('\n6. ONE notion of "has not moved" -- the two constants must not drift')
{
  const src = (await import('node:fs')).readFileSync(new URL('../src/admission.mjs', import.meta.url), 'utf8')
  const m = src.match(/^const REPEAT_NEAR_BLOCKS = (\d+)$/m)
  t('admission declares REPEAT_NEAR_BLOCKS', !!m, true)
  t('and it equals cognitive.LIVELOCK_MIN_MOVE', m ? Number(m[1]) : null, LIVELOCK_MIN_MOVE)
}

console.log(`\n${pass}/${pass + fail} spatial repeat cases pass`)
assert.equal(fail, 0, `${fail} failed`)
