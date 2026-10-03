// Pickup telemetry, the review round on f5dd4d6 (Claude + Codex, both CHANGES, both "behaviour-neutral").
// Each block names the finding it pins. pickuplog.test.mjs covers the original behaviour.
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-pickuplog-review-'))
const {
  attachPickupLog, attributeTo, activeReflexOf, boundArgs, ActionRing, addPickup, formatPickups, noteSought,
} = await import('../src/pickuplog.mjs')
const { pickupNearbyItems } = await import('../src/skills.mjs')

const here = path.dirname(fileURLToPath(import.meta.url))
const V = (x, y, z) => ({ x, y, z, distanceTo (o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) } })
const drop = (id, name, count = 1, pos = V(1, 64, 1)) =>
  ({ id, name: 'item', position: pos, getDroppedItem: () => ({ name, count }) })

function fakeBot () {
  const bot = new EventEmitter()
  bot.entity = { id: 7, position: V(10.4, 64, -3.6) }
  bot.game = { dimension: 'overworld' }
  bot.entities = { 7: bot.entity }
  bot._client = new EventEmitter()
  bot._client.on('collect', pk =>
    bot.emit('playerCollect', bot.entities[pk.collectorEntityId], bot.entities[pk.collectedEntityId]))
  bot.blockAt = () => ({ name: 'air' })
  return bot
}
function serverCollect (bot, entity, collectorId = bot.entity.id) {
  bot.entities[entity.id] = entity
  bot._client.emit('collect', { collectedEntityId: entity.id, collectorEntityId: collectorId,
                                pickupItemCount: entity.getDroppedItem?.()?.count ?? 1 })
}
function harness (bot, opts = {}) {
  const summaries = [], junk = []
  let t = 1_000_000
  const clock = { now: () => t, advance: ms => { t += ms } }
  let taps = null
  const pl = attachPickupLog(bot, {
    emitSummary: d => summaries.push(d), emitJunk: r => junk.push(r), now: clock.now, timers: false,
    tap: fn => { taps = fn; return () => { taps = null } }, ...opts,
  })
  return { pl, summaries, junk, clock, record: rec => taps?.(rec) }
}

// ------------------------------------------------- 1. summary windows (Claude) -----

test('1: a junk-only minute still writes a summary, so the junk count never spans several windows', () => {
  const bot = fakeBot()
  const { pl, summaries, clock } = harness(bot)
  serverCollect(bot, drop(1, 'oak_sapling'))
  clock.advance(60_000); pl.flush()
  serverCollect(bot, drop(2, 'oak_sapling')); serverCollect(bot, drop(3, 'bamboo'))
  clock.advance(60_000); pl.flush()
  assert.equal(summaries.length, 2, `junk-only minutes wrote ${summaries.length} summaries`)
  assert.match(summaries[0], /^0 items in 0 pickups in 60s; junk 1 rows$/)
  assert.match(summaries[1], /^0 items in 0 pickups in 60s; junk 2 rows$/)
})

test('1: every count is labelled with its own window, and err= counts this window only', () => {
  const bot = fakeBot()
  let boom = true
  const { pl, summaries, clock } = harness(bot, { resolve: (e, c) => { if (boom) throw new Error('x'); return { name: 'cobblestone', count: c ?? 1 } } })
  serverCollect(bot, drop(10, 'cobblestone')); serverCollect(bot, drop(11, 'cobblestone'))
  clock.advance(45_000); pl.flush()
  boom = false
  serverCollect(bot, drop(12, 'cobblestone'))
  clock.advance(60_000); pl.flush()
  assert.equal(summaries.length, 2, 'an error-only window writes a row too')
  assert.match(summaries[0], /in 45s; err=2$/)
  assert.ok(!/err=/.test(summaries[1]), `errors leaked into the next window: ${summaries[1]}`)
  assert.match(summaries[1], /^cobblestone 1 idle passive \| 1 items in 1 pickups in 60s$/)
})

// ------------------------------------------------- 2. wiring (Claude) -----

const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

test('2: index.mjs attaches the log and the signal handler runs pickupFinal BEFORE closeLogs', () => {
  const src = stripComments(fs.readFileSync(path.join(here, '../src/index.mjs'), 'utf8'))
  assert.equal(src.match(/attachPickupLog\(bot,/g)?.length, 1, 'attachPickupLog(bot, ...) is not called exactly once')
  assert.match(src, /pickupFinal = pl\.final/)
  const sig = src.slice(src.indexOf("for (const sig of ['SIGINT', 'SIGTERM'])"))
  assert.ok(sig.length < src.length, 'signal handler not found')
  const handler = sig.slice(0, sig.indexOf('process.exit(0)'))
  const fin = handler.indexOf('pickupFinal?.()'), close = handler.indexOf('closeLogs()')
  assert.ok(fin > 0 && close > 0 && fin < close, `pickupFinal at ${fin}, closeLogs at ${close}`)
  assert.match(src, /reflex: reflexes\?\.activeReflex\?\.\(\)/, 'context does not read activeReflex')
  assert.match(src, /holder: runner\.arb\?\.holder\?\.owner/, 'context does not read the arbiter holder')
})

test('2: reflex.mjs exposes stop.activeReflex over the arms\' own flags', () => {
  const src = stripComments(fs.readFileSync(path.join(here, '../src/reflex.mjs'), 'utf8'))
  assert.match(src, /stop\.activeReflex = \(\) => activeReflexOf\(\{ rescuing, escaping, pocketing, marooned, eating \}\)/)
  assert.match(src, /return stop\n\}/)
})

test('2: activeReflexOf names each flag, the body-moving arms ahead of eating, null when none', () => {
  const none = { rescuing: false, escaping: false, pocketing: false, marooned: false, eating: false }
  assert.equal(activeReflexOf(none), null)
  assert.equal(activeReflexOf({ ...none, rescuing: true }), 'drown_rescue')
  assert.equal(activeReflexOf({ ...none, escaping: true }), 'escape')
  assert.equal(activeReflexOf({ ...none, pocketing: true }), 'flooded_pocket')
  assert.equal(activeReflexOf({ ...none, marooned: true }), 'marooned')
  assert.equal(activeReflexOf({ ...none, eating: true }), 'eat')
  assert.equal(activeReflexOf({ ...none, eating: true, escaping: true }), 'escape')
})

// ------------------------------------------------- 3. stale sought (Codex) -----

test('3: a pursuit that is CANCELLED clears its marker: the same drop collected later in passing is passive', async () => {
  const bot = fakeBot()
  const d = { ...drop(301, 'oak_sapling'), position: V(13, 64, -3) }
  bot.nearestEntity = pred => [d].filter(pred)[0] ?? null
  bot.pathfinder = { async goto () { throw new Error('NoPath') } }      // the walk to it fails (timeout / no path)
  const { junk, clock } = harness(bot)
  await pickupNearbyItems(bot, null)
  clock.advance(2_000)                                                 // well inside the old 15 s ttl
  serverCollect(bot, d)
  assert.deepEqual(junk.map(r => r.args.mode), ['passive'])
})

test('3: an aborted pursuit clears its marker too', async () => {
  const bot = fakeBot()
  const d = { ...drop(302, 'bamboo'), position: V(13, 64, -3) }
  const ac = new AbortController()
  bot.nearestEntity = pred => [d].filter(pred)[0] ?? null
  bot.pathfinder = { async goto () { ac.abort(); throw Object.assign(new Error('aborted'), { aborted: true }) } }
  const { junk } = harness(bot)
  await assert.rejects(pickupNearbyItems(bot, ac.signal))
  serverCollect(bot, d)
  assert.deepEqual(junk.map(r => r.args.mode), ['passive'])
})

test('3: a follow goal that is REPLACED or cleared stops making its drop sought', () => {
  const bot = fakeBot()
  const a = drop(311, 'apple'), b = drop(312, 'apple'), c = drop(313, 'apple')
  const { junk } = harness(bot)
  bot.emit('goal_updated', { entity: a }, true)
  bot.emit('goal_updated', { entity: b }, true)                       // replaced: a is no longer pursued
  serverCollect(bot, a)
  serverCollect(bot, b)
  bot.emit('goal_updated', { entity: c }, true)
  bot.emit('goal_updated', null, false)                                // setGoal(null): cancelled
  serverCollect(bot, c)
  assert.deepEqual(junk.map(r => [r.args.item, r.args.mode]), [['apple', 'passive'], ['apple', 'sought'], ['apple', 'passive']])
})

test('3: a walk that ARRIVES without collecting releases its marker after the settle: a later pickup is passive', async () => {
  const bot = fakeBot()
  const d = { ...drop(303, 'apple'), position: V(13, 64, -3) }
  let walked = 0
  bot.nearestEntity = pred => (walked ? null : [d].filter(pred)[0] ?? null)
  bot.pathfinder = { async goto () { walked++ } }                       // resolves, but the drop is in foliage
  const { junk, clock } = harness(bot)
  await pickupNearbyItems(bot, null)
  clock.advance(3_000)
  serverCollect(bot, d)
  assert.deepEqual(junk.map(r => r.args.mode), ['passive'])
})

test('3: noteSought returns a release that clears only its own marker', () => {
  const bot = fakeBot()
  const { junk } = harness(bot)
  const r1 = noteSought(bot, 321, 'pickup')
  noteSought(bot, 322, 'pickup')
  r1()
  serverCollect(bot, drop(321, 'apple')); serverCollect(bot, drop(322, 'apple'))
  assert.deepEqual(junk.map(r => r.args.mode), ['passive', 'sought'])
})

// ------------------------------------------------- 4. ownership (Codex) -----

test('4: the arbiter holder and the reflex flag are SEPARATE fields, and a flag never overrides the holder', () => {
  assert.equal(attributeTo({ skill: 'gather', args: { block: 'oak_log' }, holder: 'entombed', reflex: 'eat' }), 'holder:entombed')
  assert.equal(attributeTo({ skill: 'gather', args: { block: 'oak_log' }, holder: 'gather', reflex: 'eat' }), 'gather:oak_log')
  assert.equal(attributeTo({ holder: 'marooned', reflex: 'escape' }), 'holder:marooned')
  assert.equal(attributeTo({ reflex: 'escape' }), 'reflex:escape')
  const bot = fakeBot()
  const { junk } = harness(bot, { context: () => ({ skill: 'explore', args: {}, holder: 'air', reflex: 'escape' }) })
  serverCollect(bot, drop(401, 'bamboo'))
  const a = junk[0].args
  assert.equal(a.holder, 'air'); assert.equal(a.reflex, 'escape'); assert.equal(a.source, 'holder:air')
  assert.ok(!('owner' in a), 'the merged owner field is gone')
  const bot2 = fakeBot()
  const h2 = harness(bot2, { context: () => ({ skill: null, holder: null, reflex: 'escape' }) })
  serverCollect(bot2, drop(402, 'bamboo'))
  assert.equal(h2.junk[0].args.holder, null, 'a reflex flag was written as the holder')
  assert.equal(h2.junk[0].args.reflex, 'escape'); assert.equal(h2.junk[0].args.source, 'reflex:escape')
  assert.match(junk[0].detail, /holder=air reflex=escape/)
})

// ------------------------------------------------- 5. args (Codex) -----

test('5: the structured row keeps a BOUNDED copy of the current skill args', () => {
  assert.deepEqual(boundArgs({ x: 10, y: 64, z: -3 }), { x: 10, y: 64, z: -3 })
  assert.deepEqual(boundArgs({ count: 4, block: 'oak_log' }), { count: 4, block: 'oak_log' })
  assert.equal(boundArgs(null), null)
  const big = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 'v'.repeat(500)]))
  big.nested = { deep: { deeper: 1 } }
  const b = boundArgs(big)
  assert.ok(Object.keys(b).length <= 8, `${Object.keys(b).length} keys`)
  assert.ok(JSON.stringify(b).length <= 400, `${JSON.stringify(b).length} bytes`)
  assert.ok(Object.values(b).every(v => typeof v !== 'object'), 'nested objects must not be copied')
  const bot = fakeBot()
  const args = { count: 8, block: 'oak_log' }
  const { junk } = harness(bot, { context: () => ({ skill: 'gather', args }) })
  serverCollect(bot, drop(501, 'oak_sapling'))
  args.count = 99                                                      // a later mutation must not reach the row
  assert.deepEqual(junk[0].args.skill_args, { count: 8, block: 'oak_log' })
})

// ------------------------------------------------- 6. ring window (Codex) -----

test('6: a repeat run spanning the 30 s cutoff counts only the repeats inside the window', () => {
  const r = new ActionRing()
  for (let s = 0; s <= 40; s += 5) r.push('dig:stone', s * 1000)      // 0,5,...,40 s: nine digs
  assert.deepEqual(r.recent(41_000), ['dig:stone x6 -1s'], 'digs at 15..40 s are the six inside 11..41 s')
  assert.deepEqual(r.recent(69_000), ['dig:stone -29s'])
  assert.deepEqual(r.recent(71_000), [])
})

// ------------------------------------------------- 7. bounds (Codex) -----

test('7: aggregation cardinality is capped; the excess is folded and counted, not dropped', () => {
  const agg = new Map()
  for (let i = 0; i < 500; i++) addPickup(agg, { name: `item_${i}`, count: 1, source: 'explore', mode: 'passive' })
  assert.ok(agg.size <= 65, `${agg.size} groups`)
  const total = [...agg.values()].reduce((s, g) => s + g.count, 0)
  assert.equal(total, 500, 'items were lost, not folded')
  const s = formatPickups(agg)
  assert.ok(s.length <= 300)
  assert.match(s, /500 items in 500 pickups/)
})

test('7: names and sources are byte-bounded', () => {
  const agg = new Map()
  addPickup(agg, { name: 'n'.repeat(5000), count: 1, source: 's'.repeat(5000), mode: 'passive' })
  const g = [...agg.values()][0]
  assert.ok(g.name.length <= 64 && g.source.length <= 64)
})

test('7: formatting is linear, not quadratic, in the number of groups', () => {
  const agg = new Map()
  for (let i = 0; i < 64; i++) addPickup(agg, { name: `item_${i}`, count: 100 - i, source: 'x'.repeat(60), mode: 'passive' })
  let built = 0
  const real = Array.prototype.join
  Array.prototype.join = function (...a) { built += this.length; return real.apply(this, a) }   // eslint-disable-line no-extend-native
  try { formatPickups(agg) } finally { Array.prototype.join = real }                          // eslint-disable-line no-extend-native
  assert.ok(built <= 4 * 64, `joined ${built} parts for 64 groups (quadratic would be ~2,000)`)
})

test('7: a junk burst writes at most junkPerSec rows a second; the excess is counted into the summary', () => {
  const bot = fakeBot()
  const { pl, junk, summaries, clock } = harness(bot, { junkPerSec: 5 })
  for (let i = 0; i < 40; i++) serverCollect(bot, drop(700 + i, 'leaf_litter'))
  assert.equal(junk.length, 5)
  clock.advance(1_000)
  serverCollect(bot, drop(799, 'leaf_litter'))
  assert.equal(junk.length, 6, 'the cap is per second, not forever')
  pl.flush()
  assert.match(summaries[0], /^leaf_litter 35 idle passive \| 35 items in 35 pickups in 1s; junk 6 rows; junk_capped 35$/)
})

// ------------------------------------------------- 8. finalization (Codex) -----

test('8: final() detaches every listener and flushes; a late event writes nothing', () => {
  const bot = fakeBot()
  const before = { pc: bot.listenerCount('playerCollect'), gu: bot.listenerCount('goal_updated'), dc: bot.listenerCount('diggingCompleted'), raw: bot._client.listenerCount('collect') }
  const { pl, junk, summaries } = harness(bot)
  serverCollect(bot, drop(801, 'apple'))
  pl.final()
  assert.equal(summaries.length, 1, 'the junk-only interval was not flushed at final')
  assert.equal(bot.listenerCount('playerCollect'), before.pc)
  assert.equal(bot.listenerCount('goal_updated'), before.gu)
  assert.equal(bot.listenerCount('diggingCompleted'), before.dc)
  assert.equal(bot._client.listenerCount('collect'), before.raw)
  serverCollect(bot, drop(802, 'apple')); serverCollect(bot, drop(803, 'cobblestone'))
  bot.emit('goal_updated', { entity: drop(804, 'apple') })
  pl.flush(); pl.final()
  assert.equal(junk.length, 1, 'a row was written after final()')
  assert.equal(summaries.length, 1, 'a summary was written after final()')
})

// ------------------------------------------------- 9. neutrality (Codex) -----

const ACTUATORS = ['dig', 'stopDigging', 'placeBlock', 'equip', 'unequip', 'toss', 'tossStack', 'setControlState',
  'clearControlStates', 'look', 'lookAt', 'activateItem', 'deactivateItem', 'consume', 'chat', 'attack']
function spiedBot (calls) {
  const bot = fakeBot()
  for (const a of ACTUATORS) bot[a] = async (...args) => { calls.push([a, JSON.stringify(args)]) }
  const alive = new Map()
  bot.nearestEntity = pred => [...alive.values()].filter(pred)[0] ?? null
  bot.pathfinder = {
    goal: null,
    setGoal (g) { calls.push(['setGoal', g ? `${g.x},${g.y},${g.z}` : 'null']); this.goal = g; bot.emit('goal_updated', g, false) },
    async goto (g) {
      calls.push(['goto', `${g.x},${g.y},${g.z}`])
      const hit = [...alive.values()].find(d => d.position.x === g.x)
      if (hit) { alive.delete(hit.id); serverCollect(bot, hit) }
    },
    stop () { calls.push(['stop', '']) },
  }
  return { bot, alive }
}
async function scenario (attach) {
  const calls = []
  const { bot, alive } = spiedBot(calls)
  if (attach) harness(bot)
  for (const [id, name, x] of [[901, 'oak_sapling', 11], [902, 'cobblestone', 12], [903, 'leaf_litter', 13]]) alive.set(id, { ...drop(id, name), position: V(x, 64, -4) })
  bot.emit('diggingCompleted', { name: 'oak_log' })
  bot.emit('goal_updated', { entity: alive.get(901) }, true)
  serverCollect(bot, drop(950, 'bamboo'))
  await pickupNearbyItems(bot, null)
  bot.pathfinder.setGoal(null)
  serverCollect(bot, drop(951, 'apple'))
  return { calls, left: [...alive.keys()] }
}

test('9: the same event sequence makes IDENTICAL actuator calls with the telemetry attached and without', async () => {
  const off = await scenario(false)
  const on = await scenario(true)
  assert.ok(off.calls.length >= 3, `the scenario exercised nothing: ${JSON.stringify(off.calls)}`)
  assert.deepEqual(on.calls, off.calls)
  assert.deepEqual(on.left, off.left)
})
