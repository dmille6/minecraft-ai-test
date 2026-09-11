// THE DIG-APPROACH WALK WAS BEING CANCELLED BY GATHER'S OWN DIG WATCHDOG.
//
// Measured on the canary (board-c, f9ddbc4, 90 minutes, full walk of the pool's
// logs): 38 `_dig_approach` fires, 11 in reach, 22 `PathStopped`. Every one of
// the 22 was one bot, and every one ended 1.00 s after the walk began -- the
// travel walk's no-path verdict at :31.498, the plan 22 ms later, the walk
// stopped at :32.523; the same second in all three attempts of every burst.
// One second is withTimeout's dig watchdog: it polls at 1000 ms and calls
// pathfinder.stop() on any dig whose block the HELD item cannot harvest. That
// is the right rule for the target block, whose drop is the point, and the
// wrong rule for the blocks in the way of it.
//
// The pathfinder's side of the chain, for the record (node_modules/
// mineflayer-pathfinder): stop() only sets a flag; stopDigging() rejects the
// dig, the dig handler calls resetPath('dig_error'), resetPath ends with
// `if (stopPathing) return stop()`, and that emits path_stop, which lib/goto.js
// turns into PathStopped. The `[visited= ms=]` numbers in the event are the
// PLANNER's, so "stopped 20 ms in" was a misreading; the walk's own duration
// was never logged. It is now.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { collectManually, withTimeout } from '../src/skills.mjs'
import { observeApproachDig, approachVerdict, approachDigMs, approachDigCost, isOreLike, planDigApproach, withApproachBound } from '../src/digapproach.mjs'
import { eyeToBlock } from '../src/digreach.mjs'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
function stripComments (s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
const src = stripComments(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))

// ------------------------------------------------ the watchdog composition ---
//
// A fake pathfinder whose walk digs one block the held item cannot harvest and
// arrives 1300 ms later -- unless something calls stop(), in which case it
// rejects PathStopped the way lib/goto.js does. That is the whole chain in
// miniature: withTimeout + watchDigging + the pathfinder's stop flag.

function diggingBot ({ holds = null } = {}) {
  const bot = new EventEmitter()
  const seen = { stopped: 0, stopDigging: 0 }
  const WALL = new Vec3(3, 64, 0)
  let wall = 'stone'
  Object.assign(bot, {
    heldItem: holds,
    targetDigBlock: null,
    // Like the real bot.blockAt: it needs a Vec3 (it calls .floored()). The
    // first fake here accepted a plain {x,y,z} and the fleet read dug=none.
    blockAt: p => { const q = p.floored(); return { name: q.equals(WALL) ? wall : 'air', position: q } },
    stopDigging: () => { seen.stopDigging++ },
    pathfinder: {
      stop: () => { seen.stopped++ },
      goto: () => new Promise((resolve, reject) => {
        bot.targetDigBlock = { name: 'stone', position: WALL.clone(), canHarvest: type => type === 'pick' }
        const tick = setInterval(() => {
          if (seen.stopped) {
            clearInterval(tick); bot.targetDigBlock = null
            reject(Object.assign(new Error('Path was stopped'), { name: 'PathStopped' }))
          }
        }, 20)
        setTimeout(() => {
          if (seen.stopped) return
          clearInterval(tick); bot.targetDigBlock = null
          wall = 'air'                                   // the server's view after the dig
          bot.emit('diggingCompleted', { name: 'air' })  // what mineflayer really emits: the NEW block
          resolve()
        }, 1300)
      }),
    },
  })
  return { bot, seen }
}

await ta('CONTROL: with the watchdog on, a bare-handed dig through stone is stopped at ~1 s', async () => {
  // The defect, reproduced. If this ever passes without stop() being called,
  // the watchdog moved and the fix below is being tested against nothing.
  const { bot, seen } = diggingBot()
  const t0 = Date.now()
  const e = await withTimeout(bot.pathfinder.goto(), 5000, bot).then(() => null, x => x)
  assert.ok(e, 'the walk must have been cancelled')
  assert.equal(e.name, 'PathStopped')
  assert.equal(seen.stopped, 1, 'the watchdog calls pathfinder.stop() exactly once')
  const ms = Date.now() - t0
  assert.ok(ms >= 950 && ms < 1300, `cancelled at ${ms} ms: the watchdog polls at 1000`)
})

await ta('FIX: with needsDrop:false the same walk digs through and arrives', async () => {
  const { bot, seen } = diggingBot()
  await withTimeout(bot.pathfinder.goto(), 5000, bot, { needsDrop: false })
  assert.equal(seen.stopped, 0, 'nothing may stop a walk that wants the hole')
  assert.equal(seen.stopDigging, 0)
})

await ta('the budget still binds when the watchdog is off', async () => {
  // Turning the watchdog off must not turn the clock off: a 400 ms budget
  // against a 1300 ms walk is a budget failure, tagged as one.
  const { bot } = diggingBot()
  const e = await withTimeout(bot.pathfinder.goto(), 400, bot, { needsDrop: false }).then(() => null, x => x)
  assert.ok(e && e.budgetExceeded, 'the wall clock must still expire')
  assert.equal(e.failClass, 'path_budget')
})

// --------------------------------------------------- the passive observer ---

await ta('observeApproachDig names the block the held item could not harvest, and cancels nothing', async () => {
  const { bot, seen } = diggingBot({ holds: { type: 'dirt', name: 'dirt' } })
  const w = observeApproachDig(bot, { pollMs: 50 })
  await bot.pathfinder.goto()
  const r = w.stop()
  assert.equal(r.unharvestable, 'stone')
  assert.equal(r.held, 'dirt')
  assert.deepEqual(r.dug, ['stone'], 'the block that broke is named by what it WAS, not by the air it became')
  assert.ok(r.walkMs >= 1200, `walk_ms=${r.walkMs} must be the walk, not the plan`)
  assert.equal(seen.stopped, 0); assert.equal(seen.stopDigging, 0)
})

await ta('a harvestable dig reads as unharvestable=none, held=null', async () => {
  const { bot } = diggingBot({ holds: { type: 'pick', name: 'stone_pickaxe' } })
  const w = observeApproachDig(bot, { pollMs: 50 })
  await bot.pathfinder.goto()
  const r = w.stop()
  assert.equal(r.unharvestable, null)
  assert.equal(r.held, null)
  assert.deepEqual(r.dug, ['stone'])
})

await ta('the observer attaches NO listener (the pathfinder strips them), and stop() is idempotent', async () => {
  const { bot } = diggingBot()
  const w = observeApproachDig(bot, { pollMs: 50 })
  assert.equal(bot.listenerCount('diggingCompleted'), 0)
  assert.equal(bot.listenerCount('diggingAborted'), 0)
  const a = w.stop()
  assert.deepEqual(a.dug, [])
  assert.strictEqual(w.stop(), a)
})

await ta('a dig that was seen but did not break is attempted, not dug', async () => {
  const { bot, seen } = diggingBot()
  const w = observeApproachDig(bot, { pollMs: 50 })
  const walk = bot.pathfinder.goto()
  await sleep(300); seen.stopped++              // cancelled from outside, wall still stands
  await walk.catch(() => {})
  const r = w.stop()
  assert.deepEqual(r.attempted, ['stone']); assert.deepEqual(r.dug, [])
})

// ------------------------------------------ the walk is bounded in COST ---

await ta('withApproachBound holds the runtime search to the plan\'s cap and gives it back, even on a throw', async () => {
  const bot = { pathfinder: { searchRadius: -1 } }
  let during = null
  await withApproachBound(bot, async () => { during = bot.pathfinder.searchRadius })
  assert.equal(during, 400, 'the re-plans inside goto() get the probe\'s cost cap')
  assert.equal(bot.pathfinder.searchRadius, -1, 'and the fleet-wide setting is restored')
  await withApproachBound(bot, async () => { throw new Error('PathStopped') }).catch(() => {})
  assert.equal(bot.pathfinder.searchRadius, -1, 'restored on rejection too')
  assert.equal(await withApproachBound({}, async () => 7), 7, 'no pathfinder: the walk still runs')
})

t('index.mjs runs the borrowed walk inside withApproachBound', () => {
  const idx = stripComments(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
  const body = idx.slice(idx.indexOf('bot.withGatherMovements = async'), idx.indexOf('bot.withGatherMovements = async') + 400)
  assert.match(body, /setMovements\(gatherMoves\)[\s\S]*withApproachBound\(bot, fn\)[\s\S]*finally[\s\S]*setMovements\(moves\)/,
    'the bound must wrap the walk, inside the profile swap')
})

// ------------------------------------------ ore is not a wall ---

t('isOreLike names ore and raw blocks, not stone', () => {
  for (const n of ['iron_ore', 'deepslate_iron_ore', 'ancient_debris', 'raw_iron_block']) assert.ok(isOreLike(n), n)
  for (const n of ['stone', 'cobblestone', 'dirt', 'oak_log', 'iron_block', null]) assert.ok(!isOreLike(n), String(n))
})

t('approachDigCost names the ore a tool-less bot would destroy, and a pickaxe clears it', () => {
  const ore = { name: 'iron_ore', digTime: () => 1000, canHarvest: type => type === 'pick' }
  const stone = { name: 'stone', digTime: () => 1000, canHarvest: type => type === 'pick' }
  const bot = { blockAt: p => (p.y === 1 ? ore : stone), pathfinder: { bestHarvestTool: () => null }, entity: { effects: {} } }
  const path = [{ toBreak: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }] }]
  const c = approachDigCost(bot, path)
  assert.deepEqual(c.destroys, ['iron_ore'], 'stone without a drop is fine; ore without a drop is a loss')
  assert.equal(c.ms, 2000)
  bot.pathfinder.bestHarvestTool = () => ({ type: 'pick' })
  assert.deepEqual(approachDigCost(bot, path).destroys, [])
  const v = approachVerdict({ status: 'success', path, endsInReach: true, digMs: 10, destroys: ['iron_ore'] })
  assert.equal(v.take, false); assert.match(v.why, /destroy iron_ore without a tool/)
})


await ta('the observer records the open window and every block a dig was seen on', async () => {
  const { bot } = diggingBot({ holds: { type: 'dirt', name: 'dirt' } })
  bot.currentWindow = { type: 'minecraft:generic_9x3' }
  const w = observeApproachDig(bot, { pollMs: 50 })
  await bot.pathfinder.goto()
  const r = w.stop()
  assert.equal(r.window, 'minecraft:generic_9x3', 'a hung chest window is the rival explanation; it must be named')
  assert.deepEqual(r.attempted, ['stone'], 'attempted comes from the poll, not the strippable listener')
})

// ------------------------------------------ the plan is bounded in TIME ---
//
// Cost and count were the two bounds. Neither is a clock: cost 400 admits
// sixteen bare-handed stone digs, and sixteen bare-handed stone digs take two
// minutes against a fifteen-second walk. Without the watchdog the plan has to
// refuse what the clock cannot hold, and say the number.

t('approachVerdict refuses a plan whose digs outlast the walk budget, and says so', () => {
  const path = [{ x: 1, y: 2, z: 3, toBreak: [{ x: 1, y: 2, z: 3 }, { x: 1, y: 3, z: 3 }] }]
  const v = approachVerdict({ status: 'success', path, endsInReach: true, digMs: 15001, budgetMs: 15000 })
  assert.equal(v.take, false)
  assert.match(v.why, /15001ms, over the 15000ms walk budget/)
  const ok = approachVerdict({ status: 'success', path, endsInReach: true, digMs: 15000, budgetMs: 15000 })
  assert.equal(ok.take, true, 'exactly the budget is affordable')
  assert.equal(ok.digMs, 15000)
  const inf = approachVerdict({ status: 'success', path, endsInReach: true, digMs: Infinity })
  assert.equal(inf.take, false); assert.match(inf.why, /infinite/)
  const nan = approachVerdict({ status: 'success', path, endsInReach: true, digMs: NaN })
  assert.equal(nan.take, false, 'an unpriceable plan is not a free one')
})

t('approachDigMs prices DISTINCT blocks with the best tool the bot holds, zero for the unknown', () => {
  const stone = { name: 'stone', digTime: (type) => type === 'pick' ? 600 : 7500 }
  const bot = {
    blockAt: p => (p.y === 9 ? { name: 'mystery' } : stone),
    pathfinder: { bestHarvestTool: () => null },
    entity: { effects: {} },
  }
  const path = [{ toBreak: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }] }, { toBreak: [{ x: 0, y: 2, z: 0 }, { x: 0, y: 9, z: 0 }] }]
  assert.equal(approachDigMs(bot, path), 15000, 'two stone digs bare-handed; the repeat and the unknown cost nothing')
  bot.pathfinder.bestHarvestTool = () => ({ type: 'pick' })
  assert.equal(approachDigMs(bot, path), 1200, 'the tool the pathfinder will equip is the one priced')
  assert.equal(approachDigMs(bot, null), 0)
  assert.equal(approachDigMs(bot, [{ toBreak: [null] }]), 0)
})

t('planDigApproach refuses the bare-handed two-stone approach and takes it with a pickaxe', () => {
  // 8000 ms each bare-handed: two of them are 16 s against a 15 s walk.
  const stone = { name: 'stone', digTime: (type) => type === 'pick' ? 600 : 8000 }
  const plan = { status: 'success', path: [{ x: 1, y: 64, z: 0, toBreak: [{ x: 1, y: 64, z: 0 }] },
                                           { x: 2, y: 64, z: 0, toBreak: [{ x: 2, y: 64, z: 0 }] }] }
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 }, effects: {} },
    gatherMovements: { canDig: true },
    blockAt: () => stone,
    pathfinder: { bestHarvestTool: () => null, getPathFromTo: () => ({ next: () => ({ value: { result: plan } }) }) },
  }
  const args = { goals: { GoalGetToBlock: class { constructor (x, y, z) { Object.assign(this, { x, y, z }) } heuristic () { return 0 } } },
                 reachGoalFor: (g, t) => new g.GoalGetToBlock(t.x, t.y, t.z), endsInReach: () => true }
  const bare = planDigApproach(bot, { x: 5, y: 64, z: 0 }, args)
  assert.equal(bare.take, false, 'two bare-handed stone digs outlast the budget'); assert.match(bare.why, /16000ms, over the 15000ms/)
  bot.pathfinder.bestHarvestTool = () => ({ type: 'pick' })
  const picked = planDigApproach(bot, { x: 5, y: 64, z: 0 }, args)
  assert.equal(picked.take, true); assert.equal(picked.digMs, 1200)
})

t('a bot that is not an emitter still gets a report', () => {
  const w = observeApproachDig({ targetDigBlock: null })
  const r = w.stop()
  assert.deepEqual(r.dug, []); assert.equal(r.unharvestable, null)
})

// ------------------------------------------------ the chain through gather ---
//
// collectManually's real code path: the travel walk fails, the dig plan is
// small, the borrowed walk digs an unharvestable block and takes 1.3 s. With the
// watchdog on this is the fleet's PathStopped; with it off the bot arrives.

function chainBot () {
  const seen = { gotos: [], borrowed: 0, stopped: 0, dug: [] }
  let at = { x: 0, y: 64, z: 0 }
  const TARGET = { x: 6, y: 64, z: 0 }
  const world = new Map([['6,64,0', 'oak_log']])
  const plan = { status: 'success', path: [{ x: 3, y: 64, z: 0, toBreak: [{ x: 3, y: 64, z: 0 }] }, { x: 4, y: 64, z: 0, toBreak: [] }] }
  const bot = new EventEmitter()
  Object.assign(bot, {
    entity: { position: at },
    heldItem: { type: 'dirt', name: 'dirt' },
    targetDigBlock: null,
    gatherMovements: { canDig: true },
    blockAt: p => {
      const n = world.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`)
      return n ? { name: n, position: p, diggable: true } : { name: 'air', position: p, diggable: false }
    },
    canDigBlock: b => !!b && b.name !== 'air' && eyeToBlock(at, b.position) <= 5.1,
    inventory: { items: () => [] },
    equip: async () => {},
    dig: async b => { seen.dug.push(`${b.position.x},${b.position.y},${b.position.z}`); world.delete('6,64,0') },
    stopDigging: () => {},
    nearestEntity: () => null,
    withGatherMovements: async fn => { seen.borrowed++; return fn() },
    pathfinder: {
      movements: { canDig: false },
      stop: () => { seen.stopped++ },
      goto: () => new Promise((resolve, reject) => {
        if (seen.borrowed === 0) { seen.gotos.push('travel'); return resolve() }   // never arrives
        seen.gotos.push('gather')
        bot.targetDigBlock = { name: 'stone', position: new Vec3(3, 64, 0), canHarvest: () => false }
        const tick = setInterval(() => {
          if (seen.stopped) { clearInterval(tick); bot.targetDigBlock = null; reject(Object.assign(new Error('stopped'), { name: 'PathStopped' })) }
        }, 20)
        setTimeout(() => {
          if (seen.stopped) return
          clearInterval(tick); bot.targetDigBlock = null
          at = Object.assign(at, { x: 4, y: 64, z: 0 })
          resolve()
        }, 1300)
      }),
      getPathFromTo: () => ({ next: () => ({ value: { result: plan } }) }),
    },
  })
  return { bot, target: bot.blockAt(TARGET), seen }
}

await ta('THE CHAIN: gather\'s dig-approach breaks the wall it was refused at and reaches the target', async () => {
  const { bot, target, seen } = chainBot()
  await collectManually(bot, target, new AbortController().signal)
  assert.deepEqual(seen.gotos, ['travel', 'gather'])
  assert.equal(seen.stopped, 0, 'the watchdog fired on the approach walk -- the fleet\'s 22 PathStopped')
  assert.deepEqual(seen.dug, ['6,64,0'], 'the target was dug after the approach')
})

// ------------------------------------------------------------ the wiring ---
//
// The call site is what turns the watchdog off, and a call site is a thing a
// refactor can lose. Comments stripped first: this file's comments quote the
// code they explain.


t('the dig-approach walk, and only it, runs with needsDrop:false', () => {
  const line = /withGatherMovements\(\(\) =>\s*withTimeout\(bot\.pathfinder\.goto\([^)]*\)[^)]*\), APPROACH_WALK_MS, bot, \{ needsDrop: false \}\)/g
  const hits = src.match(line) ?? []
  assert.equal(hits.length, 1, `expected exactly one dig-approach walk with needsDrop:false, found ${hits.length}`)
})

t('the _dig_approach event carries the walk, not just the plan', () => {
  const ev = src.slice(src.indexOf("kind: 'dig_approach'"), src.indexOf("kind: 'dig_approach'") + 1200)
  for (const f of ['walk_ms=', 'dig_ms=', 'attempted=', 'dug=', 'unharvestable=', 'held=', 'window=']) {
    assert.ok(ev.includes(f), `the event must print ${f}`)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
