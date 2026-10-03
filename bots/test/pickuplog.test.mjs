// Pickup telemetry (pickuplog.mjs): where bag junk comes from. TELEMETRY ONLY -- these tests check what the rows
// SAY and that the listener can never hurt the bot; nothing in the bot reads the rows.
//
// The fake bot mirrors mineflayer 4.37.1's wiring: its own `collect` packet handler is registered on _client FIRST
// and emits playerCollect synchronously, exactly as lib/plugins/entities.js does; the pickup log prepends its raw
// listener so pickupItemCount is recorded before playerCollect fires.
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-pickuplog-'))
const {
  attachPickupLog, attributeTo, mainArg, pickupMode, resolveCollected, ActionRing, ringLabel, sampleContext,
  junkRow, addPickup, formatPickups, isJunk, JUNK_ITEMS, SAPLINGS, noteSought,
} = await import('../src/pickuplog.mjs')
const { NEVER_KEEP } = await import('../src/hygiene.mjs')
const { logEvent, logSkill, tapRecords } = await import('../src/logger.mjs')
const { pickupNearbyItems } = await import('../src/skills.mjs')

const V = (x, y, z) => ({ x, y, z, distanceTo (o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) } })
const drop = (id, name, count = 1, pos = V(1, 64, 1)) =>
  ({ id, name: 'item', position: pos, getDroppedItem: () => ({ name, count }) })

/** A bot whose _client behaves like mineflayer's: the library's collect handler is registered first. */
function fakeBot ({ blocks = null } = {}) {
  const bot = new EventEmitter()
  bot.entity = { id: 7, position: V(10.4, 64, -3.6) }
  bot.game = { dimension: 'minecraft:overworld' }
  bot.entities = { 7: bot.entity, 99: { id: 99, name: 'player' } }
  bot._client = new EventEmitter()
  bot._client.on('collect', pk =>
    bot.emit('playerCollect', bot.entities[pk.collectorEntityId], bot.entities[pk.collectedEntityId]))
  bot.blockAt = (p) => (blocks ? { name: blocks(p.x, p.y, p.z) } : { name: 'air' })
  return bot
}
/** The server picking an entity up: the collect packet (count included), as the protocol delivers it. */
function serverCollect (bot, entity, collectorId = bot.entity.id, pickupItemCount = null) {
  bot.entities[entity.id] = entity
  bot._client.emit('collect', { collectedEntityId: entity.id, collectorEntityId: collectorId,
                                pickupItemCount: pickupItemCount ?? entity.getDroppedItem?.()?.count ?? 1 })
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

// ------------------------------------------------------------------ the junk set -----

test('JUNK_ITEMS is NEVER_KEEP + every sapling + bamboo + apple, and nothing a bot needs', () => {
  for (const n of NEVER_KEEP) assert.ok(isJunk(n), n)
  for (const n of SAPLINGS) assert.ok(isJunk(n), n)
  for (const n of ['bamboo', 'apple', 'leaf_litter', 'some_future_sapling']) assert.ok(isJunk(n), n)
  for (const n of ['oak_log', 'cobblestone', 'iron_ore', 'raw_iron', 'stick', 'oak_planks', null, undefined]) assert.equal(isJunk(n), false, String(n))
  assert.ok(JUNK_ITEMS.has('oak_sapling') && JUNK_ITEMS.has('apple'))
})

// ------------------------------------------------------------------ attribution -----

test('attribution: running skill with its main arg, else the reflex holding the body, else idle', () => {
  assert.equal(attributeTo({ skill: 'gather', args: { count: 4, block: 'oak_log' }, reflex: 'escape' }), 'gather:oak_log')
  assert.equal(attributeTo({ skill: 'craft', args: { item: 'stick', count: 4 } }), 'craft:stick')
  assert.equal(attributeTo({ skill: 'mine', args: { y: -20 } }), 'mine:y-20')
  assert.equal(attributeTo({ skill: 'explore', args: { blocks: 60 } }), 'explore')
  assert.equal(attributeTo({ skill: 'goto', args: { x: 1, y: 2, z: 3 } }), 'goto')
  assert.equal(attributeTo({ skill: null, reflex: 'drown_rescue' }), 'reflex:drown_rescue')
  assert.equal(attributeTo({ holder: 'entombed' }), 'reflex:entombed')
  assert.equal(attributeTo({}), 'idle')
  assert.equal(mainArg('gather', null), null)
})

test('mode: sought only for the id being walked to, within the ttl, or the current follow goal', () => {
  const seeking = new Map([[5, { at: 1000, by: 'pickup' }]])
  assert.deepEqual(pickupMode({ id: 5, seeking, now: 2000 }), { mode: 'sought', by: 'pickup' })
  assert.deepEqual(pickupMode({ id: 6, seeking, now: 2000 }), { mode: 'passive', by: null })
  assert.deepEqual(pickupMode({ id: 5, seeking, now: 1000 + 15_001 }), { mode: 'passive', by: null })
  assert.deepEqual(pickupMode({ id: 6, seeking, now: 2000, goalEntityId: 6 }), { mode: 'sought', by: 'goal' })
})

test('resolve: the packet count wins over the stack; a non-item entity is named by its entity name', () => {
  assert.deepEqual(resolveCollected(drop(1, 'bamboo', 5), 3), { name: 'bamboo', count: 3 })
  assert.deepEqual(resolveCollected(drop(1, 'bamboo', 5), undefined), { name: 'bamboo', count: 5 })
  assert.deepEqual(resolveCollected({ id: 2, name: 'arrow', getDroppedItem: () => null }, 1), { name: 'arrow', count: 1 })
  assert.deepEqual(resolveCollected({ id: 3, name: 'item' }, null), { name: '?', count: 1 })
})

// ------------------------------------------------------------------ the listener -----

test('own non-junk pickups aggregate into ONE _pickups row per flush, count from the packet, nothing when empty', () => {
  const bot = fakeBot()
  const { pl, summaries, junk } = harness(bot, { context: () => ({ skill: 'mine', args: { y: -20 } }) })
  pl.flush()
  assert.equal(summaries.length, 0, 'an empty minute must write nothing')
  serverCollect(bot, drop(201, 'cobblestone', 5), 7, 3)     // stack of 5, server took 3
  serverCollect(bot, drop(202, 'cobblestone', 1))
  serverCollect(bot, drop(203, 'raw_iron', 1))
  pl.flush()
  assert.equal(junk.length, 0)
  assert.deepEqual(summaries, ['cobblestone 4 mine:y-20 passive; raw_iron 1 mine:y-20 passive | 5 items in 3 pickups'])
  pl.flush()
  assert.equal(summaries.length, 1, 'the aggregate was not cleared')
})

test("another player's collection is ignored (the server broadcasts every pickup in range)", () => {
  const bot = fakeBot()
  const { pl, summaries, junk } = harness(bot)
  serverCollect(bot, drop(301, 'oak_sapling'), 99)
  serverCollect(bot, drop(302, 'cobblestone'), 99)
  pl.flush()
  assert.equal(junk.length, 0); assert.equal(summaries.length, 0)
  assert.equal(pl.stats.junk + pl.stats.other, 0)
})

test('a throwing resolver, context or sampler never throws out of the handler', () => {
  const bot = fakeBot()
  const { pl, junk } = harness(bot, { resolve: () => { throw new Error('metadata gone') } })
  assert.doesNotThrow(() => serverCollect(bot, drop(401, 'bamboo')))
  assert.equal(pl.stats.errors, 1)
  assert.equal(junk.length, 0)

  const bot2 = fakeBot()
  const h2 = harness(bot2, { context: () => { throw new Error('runner gone') }, sample: () => { throw new Error('world gone') } })
  assert.doesNotThrow(() => serverCollect(bot2, drop(402, 'bamboo')))
  assert.ok(h2.pl.stats.errors >= 1)

  const bot3 = fakeBot()
  harness(bot3, { emitJunk: () => { throw new Error('disk full') } })
  assert.doesNotThrow(() => serverCollect(bot3, drop(403, 'bamboo')))
  assert.doesNotThrow(() => bot3.emit('playerCollect', null, null))
  assert.doesNotThrow(() => bot3.emit('playerCollect', bot3.entity, undefined))
})

test('a junk pickup writes ONE _junk_pickup row per event with item, place, skill, owner, recent actions and context', () => {
  const blocks = (x, y, z) => (y === 63 ? 'grass_block' : y === 65 && Math.abs(x - 10) <= 1 ? 'oak_leaves' : x === 12 && y === 64 ? 'short_grass' : 'air')
  const bot = fakeBot({ blocks })
  const ctx = { skill: 'gather', args: { count: 4, block: 'oak_log' }, reflex: null }
  const { pl, junk, clock, record } = harness(bot, { context: () => ctx })
  record({ skill: { name: 'explore', status: 'success', args: { blocks: 40 } } })   // 40 s ago: outside the window
  clock.advance(10_000)
  record({ skill: { name: '_path_reset', status: 'success' } })
  clock.advance(1_000)
  record({ skill: { name: '_pickups', status: 'success' } })                         // our own kind: ignored
  bot.emit('diggingCompleted', { name: 'oak_log' })
  bot.emit('diggingCompleted', { name: 'oak_log' })
  clock.advance(1_000)
  bot.emit('diggingCompleted', { name: 'oak_leaves' })
  clock.advance(30_000)
  record({ skill: { name: '_entombed', status: 'failed' } })
  clock.advance(2_000)
  serverCollect(bot, drop(501, 'oak_sapling', 2))
  serverCollect(bot, drop(502, 'apple', 1))
  assert.equal(junk.length, 2, 'one row per junk pickup')
  const { detail, args } = junk[0]
  assert.ok(detail.length <= 300)
  assert.ok(detail.startsWith('oak_sapling x2 passive gather:oak_log at 10,64,-4 overworld'), detail)
  assert.equal(args.item, 'oak_sapling'); assert.equal(args.count, 2); assert.equal(args.mode, 'passive')
  assert.deepEqual([args.x, args.y, args.z, args.dim], [10, 64, -4, 'overworld'])
  assert.equal(args.skill, 'gather:oak_log'); assert.equal(args.source, 'gather:oak_log'); assert.equal(args.owner, null)
  // Last 3 in the preceding 30 s: the two digs (collapsed) and the leaf dig are 32 s old, so only _entombed is in.
  assert.deepEqual(args.recent, ['_entombed:failed -2s'])
  assert.equal(args.feet, 'air'); assert.equal(args.below, 'grass_block')
  assert.equal(args.leaves, 21, 'leaves at y=65 for x 9..11 over all 7 z of the box')
  assert.equal(args.grass, 7, 'short_grass at x=12, y=64 over all 7 z')
  assert.equal(args.bamboo, 0)
  assert.ok(Number.isFinite(args.sample_us))
  assert.equal(pl.stats.junk, 2)
})

test('recent actions: last 3 within 30 s, repeats collapsed, own kinds ignored', () => {
  const r = new ActionRing(5)
  r.push('gather:oak_log:success', 0)
  r.push('dig:stone', 10_000); r.push('dig:stone', 11_000); r.push('dig:stone', 12_000)
  r.push(ringLabel({ skill: { name: '_junk_pickup', status: 'success' } }), 12_500)
  r.push(ringLabel({ skill: { name: '_path_reset', status: 'success' } }), 13_000)
  r.push(ringLabel({ skill: { name: 'craft', status: 'failed', args: { item: 'stick' } } }), 14_000)
  assert.deepEqual(r.recent(15_000), ['dig:stone x3 -3s', '_path_reset -2s', 'craft:stick:failed -1s'])
  assert.deepEqual(r.recent(15_000, { n: 5 }), ['gather:oak_log:success -15s', 'dig:stone x3 -3s', '_path_reset -2s', 'craft:stick:failed -1s'])
  assert.deepEqual(r.recent(43_500), ['craft:stick:failed -30s'], 'the edge of the 30 s window')
  assert.deepEqual(r.recent(60_000), [], 'nothing in the last 30 s')
  for (let i = 0; i < 20; i++) r.push(`x${i}`, 70_000 + i)
  assert.equal(r.items.length, 5, 'the ring is bounded')
})

test('sought: a drop pickupNearbyItems walks to is sought; one collected on the way is passive', async () => {
  const bot = fakeBot()
  const target = { ...drop(601, 'oak_sapling'), position: V(13, 64, -3) }
  const bystander = drop(602, 'bamboo')
  const alive = new Map([[601, target]])
  bot.nearestEntity = pred => [...alive.values()].filter(pred)[0] ?? null
  bot.pathfinder = { async goto (goal) {
    serverCollect(bot, bystander)                     // the server hands over an item within reach on the way
    bot.entity.position = V(goal.x, goal.y, goal.z)
    alive.delete(601); serverCollect(bot, target)     // arriving collects the target
  } }
  const { junk } = harness(bot, { context: () => ({ skill: 'gather', args: { block: 'oak_log' } }) })
  await pickupNearbyItems(bot, null)
  assert.deepEqual(junk.map(r => [r.args.item, r.args.mode, r.args.sought_by]),
    [['bamboo', 'passive', null], ['oak_sapling', 'sought', 'pickup']])
})

test('sought: a pathfinder goal FOLLOWING an item entity (mineflayer-collectblock) marks it sought', () => {
  const bot = fakeBot()
  const d = drop(701, 'bamboo')
  const { junk } = harness(bot)
  bot.emit('goal_updated', { entity: d }, true)
  serverCollect(bot, d)
  serverCollect(bot, drop(702, 'bamboo'))
  const d3 = drop(703, 'apple'); bot.pathfinder = { goal: { entity: d3 } }
  serverCollect(bot, d3)
  assert.deepEqual(junk.map(r => [r.args.mode, r.args.sought_by]), [['sought', 'follow'], ['passive', null], ['sought', 'goal']])
})

test('noteSought is per bot and never throws', () => {
  assert.doesNotThrow(() => noteSought(null, 1)); assert.doesNotThrow(() => noteSought({}, null))
  const a = fakeBot(), b = fakeBot()
  const ha = harness(a), hb = harness(b)
  noteSought(a, 801)
  serverCollect(a, drop(801, 'apple')); serverCollect(b, drop(801, 'apple'))
  assert.equal(ha.junk[0].args.mode, 'sought'); assert.equal(hb.junk[0].args.mode, 'passive')
})

test('final() writes the last summary exactly once and unsubscribes the logger tap', () => {
  const bot = fakeBot()
  const h = harness(bot)
  serverCollect(bot, drop(901, 'cobblestone'))
  h.pl.final(); h.pl.final()
  assert.equal(h.summaries.length, 1)
  h.record({ skill: { name: '_x', status: 'success' } })
  assert.equal(h.pl.ring.items.length, 0, 'the tap outlived final()')
})

// ------------------------------------------------------------------ formatting -----

test('summary: largest groups first; when it does not fit, the smallest go and the tail counts them', () => {
  const agg = new Map()
  addPickup(agg, { name: 'cobblestone', count: 30, source: 'mine:y-20', mode: 'passive' })
  addPickup(agg, { name: 'oak_log', count: 12, source: 'gather:oak_log', mode: 'sought' })
  addPickup(agg, { name: 'oak_log', count: 1, source: 'gather:oak_log', mode: 'sought' })
  assert.equal(formatPickups(agg), 'cobblestone 30 mine:y-20 passive; oak_log 13 gather:oak_log sought | 43 items in 3 pickups')
  for (let i = 0; i < 40; i++) addPickup(agg, { name: `item_${String(i).padStart(2, '0')}`, count: 1, source: 'explore', mode: 'passive' })
  const s = formatPickups(agg, { errors: 2, junk: 4 })
  assert.ok(s.length <= 300, `${s.length}`)
  assert.ok(s.startsWith('cobblestone 30 mine:y-20 passive; oak_log 13 gather:oak_log sought; '), s)
  assert.match(s, /\| 83 items in 43 pickups; junk 4 pickups in _junk_pickup rows; err=2; \+\d+ groups \(\d+ items\) not shown$/)
  const shown = Number(s.match(/\+(\d+) groups/)[1])
  assert.equal(s.split(' | ')[0].split('; ').length + shown, 42, 'every group is shown or counted')
})

test('junk row detail is most-important-first and capped; args keep everything the cap cuts', () => {
  const recent = ['a'.repeat(120), 'b'.repeat(120), 'c'.repeat(120)]
  const { detail, args } = junkRow({ name: 'bamboo', count: 3, mode: 'sought', by: 'pickup', source: 'explore',
    pos: { x: 1.6, y: 70, z: -0.4 }, dim: 'overworld', skill: 'explore', owner: 'escape', recent,
    ctx: { feet: 'air', below: 'grass_block', leaves: 0, bamboo: 9, grass: 4, unloaded: 0 } })
  assert.equal(detail.length, 300)
  assert.ok(detail.startsWith('bamboo x3 sought(pickup) explore at 2,70,0 overworld | feet=air below=grass_block leaves=0 bamboo=9 grass=4 | recent: '), detail)
  assert.deepEqual(args.recent, recent); assert.equal(args.owner, 'escape'); assert.equal(args.bamboo, 9)
})

// ------------------------------------------------------------------ context sampling -----

test('context sampling never throws, skips unloaded columns, and returns null with nothing to read', () => {
  assert.equal(sampleContext(null), null)
  assert.equal(sampleContext({ entity: {} }), null)
  assert.equal(sampleContext({ entity: { position: V(0, 64, 0) }, blockAt () { throw new Error('boom') } }), null)
  assert.equal(sampleContext({ entity: { position: V(0, 64, 0) }, blockAt: () => null }), null, 'feet not loaded')
  const half = { entity: { position: V(0.5, 64, 0.5) }, blockAt: p => (p.x > 1 ? null : { name: p.y === 64 ? 'bamboo' : 'stone' }) }
  const c = sampleContext(half)
  assert.equal(c.unloaded, 14, 'the two x columns beyond 1 are unloaded: 2 x 7')
  assert.equal(c.bamboo, 35, 'one layer of bamboo over the 5 x 7 loaded columns')
})

test('context sampling on a REAL prismarine world (1.21.11 chunks): right counts, unloaded edge, well under 1 ms', () => {
  const require_ = createRequire(import.meta.url)
  const { Vec3 } = require_('vec3')
  const registry = require_('prismarine-registry')('1.21.11')
  const Chunk = require_('prismarine-chunk')(registry)
  const World = require_('prismarine-world')(registry)
  const world = new World(null).sync
  const id = n => registry.blocksByName[n].defaultState
  for (const [cx, cz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const ch = new Chunk({ minY: -64, worldHeight: 384 })
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) ch.setBlockStateId(new Vec3(x, 63, z), id('grass_block'))
    world.setColumn(cx, cz, ch)
  }
  world.setBlockStateId(new Vec3(1, 65, 1), id('oak_leaves'))
  world.setBlockStateId(new Vec3(-2, 64, 0), id('short_grass'))
  world.setBlockStateId(new Vec3(0, 64, 3), id('bamboo'))
  world.setBlockStateId(new Vec3(0, 66, 0), id('oak_leaves'))   // above the 3-layer box: not counted
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, world, registry }
  assert.deepEqual(sampleContext(bot), { feet: 'air', below: 'grass_block', leaves: 1, bamboo: 1, grass: 1, unloaded: 0 })
  // At x=14 the box reaches x=17; x=16 and 17 are chunk 1, which is not loaded: 2 x-columns x 7 z-columns.
  assert.equal(sampleContext({ ...bot, entity: { position: new Vec3(14.5, 64, 0.5) } }).unloaded, 14)
  const N = 500
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < N; i++) sampleContext(bot)
  const us = Number(process.hrtime.bigint() - t0) / 1000 / N
  console.log(`  sampleContext on a real world: ${us.toFixed(1)} us per sample`)
  assert.ok(us < 1000, `${us} us per sample`)
})

// ------------------------------------------------------------------ the logger -----

test('logger: logEvent carries structured args, and a tap sees every record and cannot break logging', () => {
  const seen = []
  const off = tapRecords(rec => seen.push(rec.skill.name))
  const bad = tapRecords(() => { throw new Error('tap bug') })
  const rec = logEvent({ kind: 'junk_pickup', detail: 'x', args: { item: 'bamboo', recent: ['a'] } })
  assert.deepEqual(rec.skill.args, { item: 'bamboo', recent: ['a'] })
  assert.deepEqual(logEvent({ kind: 'other', detail: 'y' }).skill.args, {}, 'other events keep {}')
  logSkill({ skill: 'gather', args: { block: 'oak_log' }, status: 'success', startedAt: Date.now() })
  off(); bad()
  logEvent({ kind: 'after', detail: 'z' })
  assert.deepEqual(seen, ['_junk_pickup', '_other', 'gather'])
})
