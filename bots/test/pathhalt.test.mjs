// A STALE STOP: after halting the pathfinder, the NEXT walk must actually be tried. Real mineflayer-pathfinder 2.4.5.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-pathhalt'
const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const registry = require('prismarine-registry')('1.21.8')
const { pathfinder, goals } = require('mineflayer-pathfinder')
const { haltPath } = await import('../src/pathhalt.mjs')
const { withTimeout } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

function makeBot () {
  const bot = new EventEmitter()
  Object.assign(bot, { registry, version: '1.21.8', game: { minY: -64 }, entities: {}, world: { raycast: () => null } })
  bot.entity = { position: new Vec3(0.5, 64, 0.5), effects: {}, onGround: true, velocity: new Vec3(0, 0, 0) }
  bot.inventory = { items: () => [] }
  bot.blockAt = () => null
  bot.clearControlStates = () => {}; bot.setControlState = () => {}
  pathfinder(bot)
  return bot
}
// Does the next walk die on arrival? A stale flag makes setGoal() stop and emit path_stop synchronously.
function nextWalkDiesAtOnce (bot) {
  let stopped = false
  bot.once('path_stop', () => { stopped = true })
  bot.pathfinder.setGoal(new goals.GoalBlock(5, 64, 5))
  bot.removeAllListeners('path_stop')
  return stopped
}

await t('POSITIVE CONTROL: the old order (setGoal(null) then stop()) with no path leaves the next walk dead', () => {
  const bot = makeBot()
  bot.pathfinder.setGoal(null); bot.pathfinder.stop()
  assert.equal(nextWalkDiesAtOnce(bot), true)
})
await t('haltPath leaves the next walk alive', () => {
  const bot = makeBot()
  haltPath(bot)
  assert.equal(nextWalkDiesAtOnce(bot), false)
})
await t('haltPath with a goal set also leaves the next walk alive', () => {
  const bot = makeBot()
  bot.pathfinder.setGoal(new goals.GoalBlock(9, 64, 9))
  haltPath(bot)
  assert.equal(nextWalkDiesAtOnce(bot), false)
})
await t('the next goto is TRIED, not rejected PathStopped (goto level)', async () => {
  const bot = makeBot()
  haltPath(bot)
  const r = await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(5, 64, 5)).then(() => 'resolved', e => e?.name ?? 'rejected'),
                                new Promise(res => setTimeout(() => res('pending'), 100))])
  assert.equal(r, 'pending', `the walk ended at once: ${r}`)
  bot.pathfinder.setGoal(null)
})
await t('withTimeout\'s default timeout no longer poisons the next walk', async () => {
  const bot = makeBot()
  await withTimeout(new Promise(() => {}), 20, bot, { needsDrop: false }).catch(() => {})
  assert.equal(nextWalkDiesAtOnce(bot), false)
})

await t('the DIG WATCHER around a direct dig (no walk) no longer poisons the next walk (Claude review probe)', async () => {
  const bot = makeBot()
  let rej
  bot.targetDigBlock = { name: 'stone', canHarvest: () => false }
  bot.stopDigging = () => { bot.targetDigBlock = null; rej(new Error('Digging aborted')) }
  const dig = new Promise((_, r) => { rej = r })
  const e = await withTimeout(dig, 20000, bot, { what: 'dig', onTimeout: () => bot.stopDigging() }).catch(x => x)
  assert.match(String(e?.message), /Digging aborted/, 'the watcher fired and the dig settled first')
  assert.equal(nextWalkDiesAtOnce(bot), false)
})

// Structural: no bare stop() left where a stale flag can follow (comments stripped; this codebase quotes code in them).
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
await t('no bare pathfinder.stop() outside pathhalt.mjs, except the dig watcher inside withTimeout', () => {
  for (const f of ['skills.mjs', 'reflex.mjs']) {
    const src = strip(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
    const hits = src.split('\n').filter(l => /pathfinder\??\.stop\(\)/.test(l))
    const allowed = hits.filter(l => /try \{ bot\.pathfinder\.stop\(\) \} catch \{\}/.test(l))   // watchDigging: a withTimeout timer follows
    assert.equal(hits.length - allowed.length, 0, `${f}: ${hits.filter(h => !allowed.includes(h)).map(h => h.trim()).join(' | ')}`)
    if (f === 'skills.mjs') assert.equal(allowed.length, 1, 'exactly the one dig-watcher site')
  }
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
