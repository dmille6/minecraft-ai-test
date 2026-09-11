// THE MODEL IS TOLD WHAT THE GATE WILL REFUSE.
//
// Three cooldown canaries (2026-09-11): a shorter wait bought +41% model calls
// that became vetoed re-proposals of just-failed actions. The prompt said
// "rejected: cooldown (gather with these args failed recently)" -- not which
// args, not what else is off-limits -- and the 7B model proposed it again.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { AdmissionControl } from '../src/admission.mjs'
import { buildUserPrompt, offLimitsLine } from '../src/prompt.mjs'
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

t('offLimits lists only unexpired cooldowns, with seconds left, longest first, capped', () => {
  const ac = new AdmissionControl(null)
  const now = 1_000_000
  ac.failedCooldowns.set('gather:{"block":"oak_log"}', now + 41_000)
  ac.failedCooldowns.set('goto:{"x":380,"y":63,"z":235}', now + 12_000)
  ac.failedCooldowns.set('craft:{"item":"furnace"}', now - 1)          // expired
  const o = ac.offLimits(now)
  assert.deepEqual(o.map(e => [e.skill, e.secondsLeft]), [['gather', 41], ['goto', 12]])
  assert.deepEqual(o[0].args, { block: 'oak_log' })
  for (let i = 0; i < 10; i++) ac.failedCooldowns.set(`explore:{"blocks":${i}}`, now + 5_000 + i)
  assert.equal(ac.offLimits(now).length, 6, 'capped so the prompt cannot grow with the failure count')
  assert.deepEqual(new AdmissionControl(null).offLimits(now), [])
})

t('offLimitsLine renders args and seconds, and is empty when nothing is off-limits', () => {
  assert.equal(offLimitsLine([]), ''); assert.equal(offLimitsLine(undefined), '')
  const line = offLimitsLine([{ skill: 'gather', args: { block: 'oak_log' }, secondsLeft: 41 }, { skill: 'goto', args: { x: 380, y: 63, z: 235 }, secondsLeft: 12 }])
  assert.match(line, /^OFF-LIMITS/); assert.match(line, /gather block=oak_log \(41s\)/); assert.match(line, /goto x=380 y=63 z=235 \(12s\)/)
})

t('offLimitsLine is bounded: fields clipped and de-lined, the whole line capped, six long entries still fit the cap', () => {
  const long = offLimitsLine([{ skill: 'gather', args: { block: 'x'.repeat(200), note: 'a\nb' }, secondsLeft: 9 }])
  assert.ok(long.length <= 240, `line ${long.length} > 240`); assert.ok(!/\n/.test(long)); assert.match(long, /block=x{32}[ )]/)
  const six = offLimitsLine(Array.from({ length: 6 }, (_, i) => ({ skill: 'gather', args: { block: 'deepslate_redstone_ore_' + i, count: 64 }, secondsLeft: 40 - i })))
  assert.ok(six.length <= 240 && six.startsWith('OFF-LIMITS'), 'six long entries are truncated to the cap, never dropped as a whole')
  assert.equal(offLimitsLine([{ skill: 'goto', args: {}, secondsLeft: -3 }]), 'OFF-LIMITS (failed recently; the gate refuses these until the timer ends, choose something else): goto (0s)')
})

t('an expired entry vanishes at the next snapshot (the action is eligible again)', () => {
  const ac = new AdmissionControl(null); const now = 5_000_000
  ac.failedCooldowns.set('gather:{"block":"oak_log"}', now + 1_000)
  assert.equal(ac.offLimits(now).length, 1); assert.equal(ac.offLimits(now + 1_000).length, 0)
})

const promptWith = (offLimits) => {
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 6 } }, health: 20, food: 20, time: { day: 1, age: 1 },
    inventory: { items: () => [] }, registry: mcData, recipesFor: () => [],
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }), findBlock: () => null, findBlocks: () => [], entities: {}, players: {},
  }
  return buildUserPrompt({ bot, milestone: { describe: 't', progress: '0/1' }, memory: { locations: {}, events: [] },
    lastOutcome: null, trigger: 't', sentinel: 'x', lessons: [], offLimits }).user
}
t('the prompt carries the OFF-LIMITS line when the gate has refusals, and not otherwise', () => {
  assert.match(promptWith([{ skill: 'gather', args: { block: 'oak_log' }, secondsLeft: 41 }]), /OFF-LIMITS .*gather block=oak_log \(41s\)/)
  assert.ok(!/OFF-LIMITS/.test(promptWith([])), 'an idle bot\'s prompt must not grow')
  assert.ok(!/OFF-LIMITS/.test(promptWith(undefined)))
})

const COG = readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8')
t('the loop passes the gate\'s refusals to the prompt and names the vetoed proposal, args included', () => {
  const c = strip(COG)
  assert.match(c, /offLimits: this\.admission\.offLimits\(\)/, 'buildUserPrompt must receive the live off-limits table')
  assert.match(c, /this\.lastOutcome = `rejected \$\{what\}: \$\{String\(why \?\? ''\)\.slice\(0, 96\)\}`/, 'the rejection names what was vetoed and keeps the reason')
  assert.match(c, /: 'proposal'\)\.slice\(0, 60\)/, 'the proposal is clipped so the reason survives')
})
t('MUTANT: dropping the wiring is caught', () => {
  const anchor = 'offLimits: this.admission.offLimits(),'
  assert.equal(COG.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  assert.ok(!/offLimits: this\.admission\.offLimits\(\)/.test(strip(COG.replace(anchor, ''))))
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
