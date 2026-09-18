// The actuator gate attributes the pathfinder's physics tick and refuses every other contextless mover while held.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Arbiter, PRIORITY } from '../src/arbiter.mjs'
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const mkBot = () => { const b = new EventEmitter(); b.controls = []; b.setControlState = (k, v) => { b.controls.push([k, v]) }; b.clearControlStates = () => { b.controls.push(['clear']) }; b.stopDigging = () => {}; b.dig = async () => 'dug'; b.placeBlock = async () => 'placed'; b.look = async () => {}; b.lookAt = async () => {}; b.pathfinder = { goals: [], setGoal (g) { this.goals.push(g) }, async goto (g) { this.goals.push(g); return 'went' }, stop () {} }; return b }
await t('while a grant holds and has bound the pathfinder, a call from inside a physicsTick emission is admitted and a bare contextless call is refused', async () => {
  const refused = []; const arb = new Arbiter({ log: () => {} }); const bot = mkBot()
  arb.installActuatorGate(bot, { onRefuse: (name) => refused.push(name) })
  const g = await arb.acquire({ owner: 'owner:entombed', priority: PRIORITY.escape })
  await arb.within(g, async () => { await bot.pathfinder.goto({ x: 1 }) })   // the holder's own goto binds the tick
  assert.equal(arb.bound, g)
  bot.on('physicsTick', () => { bot.setControlState('forward', true) })   // what mineflayer-pathfinder does
  bot.emit('physicsTick'); assert.deepEqual(bot.controls, [['forward', true]], 'the tick moved the body')
  bot.setControlState('jump', true)   // unstick / last-resort style: contextless, not the tick
  assert.deepEqual(bot.controls, [['forward', true]], 'the contextless call did not move the body'); assert.deepEqual(refused, ['setControlState'])
  arb.release(g, 'done')
  assert.deepEqual(bot.controls.at(-1), ['clear'], 'releasing a bound grant runs the arbiter stop (raw clear)')
  bot.setControlState('sneak', true); assert.deepEqual(bot.controls.at(-1), ['sneak', true], 'a free body admits legacy contextless calls')
})
await t('a rung running inside within(grant) is admitted by the gate; the same call outside it while held is refused', async () => {
  const refused = []; const arb = new Arbiter({ log: () => {} }); const bot = mkBot()
  arb.installActuatorGate(bot, { onRefuse: (name) => refused.push(name) })
  const g = await arb.acquire({ owner: 'owner:entombed', priority: PRIORITY.escape })
  assert.equal(await arb.within(g, () => bot.dig()), 'dug')
  await assert.rejects(() => bot.dig(), /refused/); assert.deepEqual(refused, ['dig'])
  arb.release(g, 'done')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
