// A PRODUCTIVE REPEAT IS NOT A LOOP.
//
// MEASURED 2026-09-23 on the fleet's own logs: repeat_loop went from ~4-5% of decisions to
// 22% in a day, tracking three fleet-wide promotions on 09-14. The largest single step came
// from a promotion whose only bots/src commit was 2dfe261 -- "the livelock breaker fires on
// physical fixation, not on a rejected decision loop alone" -- 8.5-11.9% -> 19.1-20.9% with
// the fleet 100% on one sha either side of it.
//
// 2dfe261 was right. The old breaker relocated WORKING bots 30-57 blocks every 5-10 minutes
// (2,296 firings, 0% measured success) and every relocation was a blind walk down the fall
// channel. What it left behind is the hole these tests cover: `clearRepeatWindow()` has
// exactly ONE caller, inside the escape ladder's `done` branch, and 2dfe261 deliberately
// withholds that escape from the bots that are moving or gaining. So nothing cleared the
// window for a productive bot.
//
// Every ADMITTED key is pushed regardless of outcome, REPEAT_WINDOW is 4 and the window holds
// 8, so four successful identical actions get the fifth refused -- and it stays refused until
// four DIFFERENT actions rotate it out.
import assert from 'node:assert'
import { AdmissionControl } from '../src/admission.mjs'

let pass = 0, fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
  ok ? pass++ : fail++
}

const bot = {
  // both blocks must be REAL to the gate, or it refuses with bad_args before the repeat
  // check is ever reached -- which is what the first draft of this fixture did.
  registry: { blocksByName: { oak_log: { id: 1 }, stone: { id: 2 } },
              itemsByName: { oak_log: { id: 1 }, stone: { id: 2 } } },
  entity: { position: { x: 0, y: 70, z: 0 } },
  players: {},
  inventory: { items: () => [] },
}
const GATHER = { skill: 'gather', args: { count: 8, block: 'oak_log' } }
const MINE = { skill: 'gather', args: { count: 8, block: 'stone' } }

console.log('\n1. WITHOUT a productive signal the guard still fires -- the loop breaker must keep working')
{
  const gate = new AdmissionControl(null)
  const reasons = []
  for (let i = 0; i < 7; i++) reasons.push(gate.check({ ...GATHER }, bot).reason ?? 'ok')
  t('four admitted, then refused', reasons, ['ok', 'ok', 'ok', 'ok', 'repeat_loop', 'repeat_loop', 'repeat_loop'])
}

console.log('\n2. WITH a gain after each run the same action is never a loop')
{
  const gate = new AdmissionControl(null)
  const reasons = []
  for (let i = 0; i < 7; i++) {
    reasons.push(gate.check({ ...GATHER }, bot).reason ?? 'ok')
    gate.noteProductive(GATHER.skill, GATHER.args)      // the run put something in the inventory
  }
  t('a gaining repeater is admitted every time', reasons, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
}

console.log('\n3. A gain on ONE action does not erase evidence about another')
{
  const gate = new AdmissionControl(null)
  for (let i = 0; i < 4; i++) gate.check({ ...MINE }, bot)      // stone accumulates, never productive
  gate.check({ ...GATHER }, bot)
  gate.noteProductive(GATHER.skill, GATHER.args)                // oak_log gained
  t('the unproductive action is STILL refused', gate.check({ ...MINE }, bot).reason, 'repeat_loop')
  t('the productive one is still admitted', gate.check({ ...GATHER }, bot).reason ?? 'ok', 'ok')
}

console.log('\n4. It is keyed on the ARGS, not just the skill')
{
  const gate = new AdmissionControl(null)
  for (let i = 0; i < 4; i++) gate.check({ ...GATHER }, bot)
  gate.noteProductive('gather', { count: 8, block: 'stone' })              // a DIFFERENT key
  t('clearing another key does not unblock this one', gate.check({ ...GATHER }, bot).reason, 'repeat_loop')
  gate.noteProductive('gather', { count: 8, block: 'oak_log' })
  t('clearing the right key unblocks it', gate.check({ ...GATHER }, bot).reason ?? 'ok', 'ok')
}

// STRUCTURAL, because the cognitive loop cannot be driven from here: the call must be gated on
// a POSITIVE INVENTORY DELTA and not on r.status. Clearing on success would disable the guard
// where it earns its keep -- `explore` returns success almost always and produces nothing, and
// this project measured corr(success, items) = -0.059.
console.log('\n5. the wiring is gated on a gain, not on a success')
{
  const src = (await import('node:fs')).readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8')
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const call = stripped.indexOf('this.admission.noteProductive(')
  t('noteProductive is called in the loop', call > 0, true)
  const line = stripped.slice(stripped.lastIndexOf('\n', stripped.lastIndexOf('\n', call - 1) - 1), call)
  t('its guard tests a positive delta', /r\.delta[\s\S]*some\(v => v > 0\)/.test(line), true)
  t('its guard does NOT test r.status', /r\.status/.test(line), false)
}

console.log(`\n${pass}/${pass + fail} repeat-window cases pass`)
assert.equal(fail, 0, `${fail} failed`)
