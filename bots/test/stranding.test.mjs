// A THRESHOLD REASONED ABOUT IN MINUTES AND IMPLEMENTED IN TICKS.
//
// The stranding watchdog requires its condition to hold for TWO CONSECUTIVE
// SIX-MINUTE WINDOWS before acting -- twelve minutes of patience, so a false
// positive costs waiting rather than an interrupted miner.
//
// The first version counted a "window" on every check() call. check() runs
// every 15 seconds. So two windows meant thirty seconds: deployed 2026-08-11,
// it exhausted both climb-out attempts inside a minute and wrote 43
// `stranded_underground` events in 22 minutes, one per sample:
//
//     01:22:03 STRANDED after 2 climb-outs -- needs intervention y=29
//     01:22:18 STRANDED after 2 climb-outs -- needs intervention y=29
//     01:22:33 STRANDED after 2 climb-outs -- needs intervention y=29
//
// The design was right and the units were wrong, which no amount of reading the
// design would have caught. Only the clock catches it.
import assert from 'node:assert'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'strand-test-'))
process.env.LOG_LEVEL ??= 'error'
process.env.WATCHDOG_STRAND_WINDOW_MS = '360000'    // 6 min
const { StagnationWatchdog } = await import('../src/watchdog.mjs')
const { config } = await import('../src/config.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const W = config.watchdog.strandWindowMs

/** A bot at a fixed depth whose inventory and milestone never change. */
function makeWatchdog({ y = -42, items = 0 } = {}) {
  const runs = []
  const bot = {
    entity: { position: { x: 0, y, z: 0 } },
    health: 20, food: 20,
    inventory: { items: () => (items ? [{ name: 'dirt', count: items }] : []) },
    time: { age: 1, day: 1 }, game: { dimension: 'overworld' },
    pathfinder: { getPathTo: () => null, movements: {}, setGoal() {}, stop() {} },
    quit() {},
  }
  const runner = {
    isBusy: () => false, cancel() {}, resume() {},
    run: async (skill) => { runs.push(skill) },
  }
  const wd = new StagnationWatchdog(bot, runner,
    { running: true, milestones: { allDone: false, status: () => ({ id: 'get_iron' }) } })
  return { wd, runs, bot }
}

/** Drive the private judgement the way the 15s timer would, over `mins`. */
async function tick(wd, mins, stepSec = 15) {
  const start = Date.now()
  for (let s = 0; s <= mins * 60; s += stepSec) {
    const at = start + s * 1000
    const realNow = Date.now
    Date.now = () => at
    try { await wd.judgeStranding() } finally { Date.now = realNow }
  }
}

await t('a stranded bot is NOT acted on inside the first window', async () => {
  const { wd, runs } = makeWatchdog({ y: -42 })
  await tick(wd, 5)                       // 5 minutes, under one window
  assert.equal(runs.length, 0,
    'acting before a full window is the bug that fired every 15 seconds')
})

await t('two full windows are required before a climb-out', async () => {
  const { wd, runs } = makeWatchdog({ y: -42 })
  await tick(wd, Math.ceil((W * 2) / 60000) + 1)
  assert.equal(runs.filter(r => r === 'surface').length, 1,
    'exactly one climb-out after two windows, not one per tick')
})

await t('climb-outs are spaced by a window, not by a tick', async () => {
  const { wd, runs } = makeWatchdog({ y: -42 })
  await tick(wd, Math.ceil((W * 3) / 60000) + 1)
  const n = runs.filter(r => r === 'surface').length
  assert.ok(n <= 2, `at most one climb-out per window; got ${n}`)
})

await t('a bot above the depth threshold is never stranded', async () => {
  const { wd, runs } = makeWatchdog({ y: 80 })
  await tick(wd, Math.ceil((W * 3) / 60000) + 1)
  assert.equal(runs.length, 0, 'y=80 is not underground')
})

await t('a working miner is NOT stranded -- inventory change is the tell', async () => {
  // Deep, no altitude gain, but collecting: exactly Miner01's normal day.
  const { wd, runs, bot } = makeWatchdog({ y: -30, items: 1 })
  let n = 1
  bot.inventory.items = () => [{ name: 'cobblestone', count: n++ }]
  await tick(wd, Math.ceil((W * 3) / 60000) + 1)
  assert.equal(runs.length, 0,
    'depth alone must never trigger it, or the watchdog interrupts the miner ' +
    'it was built to leave alone')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
