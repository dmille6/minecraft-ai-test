// INDEXFETCH-01SHOW (owner 11-19: "IF we have the material in a chest ... the bots go get it no time limit"): a build draw short of
// an item the readable town index shows in some container notes a fetch want; the build order issues a dedicated trip ahead of its
// cooldown; the trip goes straight to the containers the index names (no 12-container cap; a walk cap per container, a trip cap, one
// retry), verifies every open, corrects a stale entry and never retries it, backs the item off after a trip that left it short, and
// the build follows with the material. Behaviour through the pure functions (indexfetch.mjs) and the real shop.mjs order, the
// composed chains, anchored mutants, the wiring (structural).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-indexfetch-${process.pid}`
process.env.BOT_NAME = 'TestBot'

const F = await import('../src/indexfetch.mjs')
const S = await import('../src/shop.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }
const F_PATH = new URL('../src/indexfetch.mjs', import.meta.url)
const S_PATH = new URL('../src/shop.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const NOW = 1.8e12
// the index fixture (indexsearch2.test.mjs's shape): a known observation at `at`
const obs = (k, names, at = NOW - 60_000) => ({ last: { t: 'obs', at, id: `o${k}${at}` }, obs: { id: `o${k}${at}`, at, h: [k], names, used: 1, size: 27 }, ops: {} })
const dirty = (k, names, at = NOW - 60_000) => ({ ...obs(k, names, at), last: { t: 'dirty', at: at + 1, id: 'd' } })
const pos = k => k.split(',').map(Number)
const dist = from => k => { const [x, , z] = pos(k); return Math.hypot(x - from[0], z - from[2]) }

/** A FAKE TOWN: chests by key with real contents; an open re-observes the index (as townIndexObserve does); a walk costs time. */
function town (chests, { unreachable = new Set(), walk = 10_000, ix = true } = {}) {
  const contents = Object.fromEntries(Object.entries(chests).map(([k, v]) => [k, { ...v.real }]))
  const index = Object.fromEntries(Object.entries(chests).map(([k, v]) => [k, obs(k, Object.fromEntries(Object.entries(v.index).map(([n, c]) => [n, [c, 1]])))]))
  let clock = NOW
  const bag = {}
  const visits = []
  const corrected = []
  const ops = {
    now: () => clock,
    visit: async (tg, { walkMs, want }) => {
      visits.push(tg.k)
      clock += Math.min(walk, walkMs)
      if (unreachable.has(tg.k)) return { opened: false, fail: 'chest_unreachable' }
      const here = contents[tg.k]
      const saw = { ...here }
      if (ix) index[tg.k] = obs(tg.k, Object.fromEntries(Object.entries(here).map(([n, c]) => [n, [c, 1]])), clock)
      const took = {}
      for (const [n, c] of Object.entries(want)) { const g = Math.min(c, here[n] ?? 0); if (g > 0) { took[n] = g; here[n] -= g; bag[n] = (bag[n] ?? 0) + g } }
      // the withdraw's clicks mark the entry dirty (townIndexDirty pre/post): unknown until the next open
      if (Object.keys(took).length) index[tg.k] = dirty(tg.k, {}, clock)
      clock += 1_500
      return { opened: true, saw, took, ix: ix ? `o${clock}` : null, fail: null }
    },
    correct: k => { corrected.push(k); index[k] = dirty(k, {}); return true },
  }
  const plan = from => (short, exclude) => F.fetchTargets(index, short, { now: clock, exclude, dist: dist(from) })
  return { ops, plan, index, bag, visits, corrected, contents, clock: () => clock }
}

// SHOWCASE 11-19 (shortage report 21:06Z): the stepwell short 7 torches with the index holding 116; the decor short 1 bone meal, 6
const NEAR = '10,64,10', MID = '40,64,-30', FAR = '-95,66,80'

await t('fetchTargets: the containers the index says hold a short item, nearest first; known and stale (no mutation) count, dirty/unknown/future/too old do not', () => {
  const ents = {
    [NEAR]: obs(NEAR, { cobblestone: [64, 1] }),
    [MID]: obs(MID, { torch: [20, 1] }, NOW - 7 * 3600_000),           // stale: no open for 7 h, still evidence
    [FAR]: obs(FAR, { torch: [96, 2], bone_meal: [6, 1] }),
    '1,64,1': dirty('1,64,1', { torch: [64, 1] }),
    '2,64,2': obs('2,64,2', { torch: [64, 1] }, NOW + 3600_000),        // from the future
    '3,64,3': obs('3,64,3', { torch: [64, 1] }, NOW - 25 * 3600_000),   // older than a day
  }
  const ts = F.fetchTargets(ents, { torch: 7 }, { now: NOW, dist: dist([0, 64, 0]) })
  assert.deepEqual(ts.map(x => x.k), [MID, FAR])
  assert.deepEqual(ts[1].names, { torch: 96 }, 'only the short items are named')
  assert.deepEqual(F.fetchTargets(ents, { torch: 7 }, { now: NOW, ok: k => k !== MID }).map(x => x.k), [FAR], 'a shut / zoned / outside container is out')
  assert.deepEqual(F.fetchTargets(ents, { torch: 7 }, { now: NOW, exclude: new Set([FAR]) }).map(x => x.k), [MID])
  assert.deepEqual(F.fetchTargets(null, { torch: 7 }), [], 'no index: no target')
  assert.deepEqual(F.fetchTargets(ents, { 'minecraft:odd name': 3 }), [], 'not a plain name: no target')
})
await t('fetchWantOf: short + held in a target + the draw\'s own allowance lets it go + not backed off', () => {
  const ts = F.fetchTargets({ [FAR]: obs(FAR, { torch: [116, 2], bone_meal: [6, 1] }) }, { torch: 7, bone_meal: 1, spruce_stairs: 4 }, { now: NOW })
  assert.deepEqual(F.fetchWantOf({ torch: 7, bone_meal: 1, spruce_stairs: 4 }, ts, { now: NOW }), { torch: 7, bone_meal: 1 }, 'the stairs: nowhere in the index')
  // the decorator keeps 4 bone meal for the meadow: the allowance at the chest decides (6 - 4 = 2 > 0)
  const keep4 = (n, w, o) => (n === 'bone_meal' ? Math.max(0, Math.min(w, (o.here?.[n] ?? 0) - 4)) : w)
  assert.deepEqual(F.fetchWantOf({ bone_meal: 1 }, ts, { allows: (n, tg) => keep4(n, tg.names[n], { here: tg.names }), now: NOW }), { bone_meal: 1 })
  const keep9 = (n, tg) => Math.max(0, tg.names[n] - 9)
  assert.deepEqual(F.fetchWantOf({ bone_meal: 1 }, ts, { allows: keep9, now: NOW }), {}, 'all of it reserved: no trip for stock the draw may not touch')
  const bo = new Map([['torch', NOW + 60_000]])
  assert.deepEqual(F.fetchWantOf({ torch: 7 }, ts, { backoff: bo, now: NOW }), {}, 'backed off')
  assert.deepEqual(F.fetchWantOf({ torch: 7 }, ts, { backoff: bo, now: NOW + 61_000 }), { torch: 7 }, 'the back-off ends')
})

await t('THE CHAIN (stepwell-like): short 7 torches -> the index names a far chest -> the order issues the trip AHEAD of its cooldown -> fetched -> the build follows without the cooldown -> the visit needs nothing from town and places', async () => {
  const w = town({ [NEAR]: { index: { cobblestone: 64 }, real: { cobblestone: 64 } }, [FAR]: { index: { torch: 116 }, real: { torch: 116 } } })
  // 1. the draw: the visit's 12 near containers held none; left = 7 torches
  const left = { torch: 7 }
  const targets = w.plan([0, 64, 0])(left, new Set())
  assert.deepEqual(targets.map(x => x.k), [FAR], 'straight to the chest the index names; the near one is not a target')
  const items = F.fetchWantOf(left, targets, { now: NOW })
  assert.deepEqual(items, { torch: 7 })
  // 2. the order (real shop.mjs): inside the cooldown, the want is answered with the trip
  let want = { state: 'fetch', plot: 'stepwell', items, at: NOW }
  const ask = ({ now, plot }) => (!want || now - want.at >= F.FETCH.wantTtlMs || (want.plot && plot && want.plot !== plot) ? null
    : want.state === 'build' ? { cooldownFree: true } : { order: { skill: 'build_shop', args: { indexFetch: true, plot: want.plot } } })
  S.setFetchAsk(ask)
  try {
    const base = { on: true, shared: true, atTown: true, planned: true, record: { plot: 'stepwell', structure_complete: false }, freeSlots: 20 }
    const o1 = S.buildOrder({ ...base, now: NOW + 60_000, state: { lastStop: 'no_material', lastAt: NOW } })
    assert.deepEqual(o1.order, { skill: 'build_shop', args: { indexFetch: true, plot: 'stepwell' } })
    assert.equal(S.buildOrder({ ...base, health: 6, now: NOW + 60_000, state: { lastAt: NOW } }).order, null, 'low health: no trip (and no build)')
    // 3. the trip
    const r = await F.runFetchTrip({ items, plan: w.plan([0, 64, 0]), ops: w.ops, deadline: NOW + F.FETCH.tripMs })
    assert.equal(r.outcome, 'fetched')
    assert.deepEqual(r.found, { torch: 7 })
    assert.deepEqual(w.visits, [FAR], 'one container, the far one')
    assert.equal(w.contents[FAR].torch, 109)
    const bo = F.fetchBackoff(new Map(), items, r.found, { now: w.clock() })
    assert.equal(bo.size, 0, 'fetched in full: no back-off')
    // 4. the build follows: a new visit, inside the cooldown
    want = { state: 'build', plot: 'stepwell', items: {}, at: w.clock() }
    const o2 = S.buildOrder({ ...base, now: w.clock() + 1000, state: { lastStop: 'index_fetched', lastAt: w.clock() } })
    assert.deepEqual(o2.order, { skill: 'build_shop', args: {} }, 'the build, with no cooldown')
    want = null
    assert.equal(S.buildOrder({ ...base, now: w.clock() + 2000, state: { lastStop: 'index_fetched', lastAt: w.clock() } }).order, null, 'without the follow-up: the cooldown as before')
    // 5. the visit: the bill's torches are in the bag (the drawn share) -> nothing to draw, the lights are placed
    const need = S.needFromTown({ torch: 7 }, w.bag)
    assert.deepEqual(need, {}, 'the bag holds the bill')
    const placed = Math.min(7, w.bag.torch); assert.equal(placed, 7)
  } finally { S.setFetchAsk(null) }
})
await t('THE CHAIN (decor-like, through skills.mjs\'s own ask): a fresh want orders the trip; a lapsed want or another pick does not; the follow-up frees the cooldown', async () => {
  const K = await import('../src/skills.mjs')
  const bot = { username: 'TestBot', entity: { position: { x: 0, y: 64, z: 0 } }, inventory: { items: () => [] } }
  K.bagRoomInstall(bot)
  bot.indexFetchWant = { state: 'fetch', plot: 'decor', items: { bone_meal: 1 }, at: Date.now() }
  assert.deepEqual(K._indexfetch.fetchAsk({ now: Date.now(), plot: 'decor', freeSlots: 5 }).order.args, { indexFetch: true, plot: 'decor' })
  assert.equal(K._indexfetch.fetchAsk({ now: Date.now(), plot: 'civicP', freeSlots: 5 }), null, 'the pick moved on')
  assert.equal(K._indexfetch.fetchAsk({ now: Date.now() + F.FETCH.wantTtlMs + 1, plot: 'decor', freeSlots: 5 }), null, 'lapsed')
  assert.equal(K._indexfetch.fetchAsk({ now: Date.now(), plot: 'decor', freeSlots: 0 }), null, 'no bag slot: no trip')
  bot.indexFetchWant = { state: 'build', plot: 'decor', items: {}, at: Date.now() }
  assert.deepEqual(K._indexfetch.fetchAsk({ now: Date.now(), plot: 'decor', freeSlots: 5 }), { cooldownFree: true })
  bot.indexFetchWant = null
  assert.equal(K._indexfetch.fetchAsk({ now: Date.now(), plot: 'decor' }), null)
  S.setFetchAsk(null)
})
await t('A PENDING FETCH GOES BEFORE THE IDLE-WORK ASKS (Codex r1): a short draw\'s no_material is buildIdle, yet the bot fetches instead of leaving on an expedition', () => {
  S.setExpeditionAsk(() => ({ ok: true, phase: 'trip' }))
  try {
    const base = { on: true, shared: true, atTown: true, planned: true, record: { plot: 'decor', structure_complete: false }, freeSlots: 20 }
    S.setFetchAsk(() => ({ order: { skill: 'build_shop', args: { indexFetch: true, plot: 'decor' } } }))
    assert.deepEqual(S.buildOrder({ ...base, now: NOW + 60_000, state: { lastStop: 'no_material', lastAt: NOW } }).order.args, { indexFetch: true, plot: 'decor' })
    S.setFetchAsk(() => null)
    assert.deepEqual(S.buildOrder({ ...base, now: NOW + 60_000, state: { lastStop: 'no_material', lastAt: NOW } }).order.args, { expedition: true, phase: 'trip' }, 'no want: the expedition as before')
  } finally { S.setExpeditionAsk(null); S.setFetchAsk(null) }
})
await t('THE WANT RECONCILED AT THE TRIP (Codex r3): what the bag gained since the want was noted comes off it; a fully covered want is no trip', () => {
  assert.deepEqual(F.fetchStillWanted({ spruce_planks: 12, torch: 7 }, { spruce_planks: 0, torch: 2 }, { spruce_planks: 16, torch: 2 }), { torch: 7 }, 'the visit crafted the planks')
  assert.deepEqual(F.fetchStillWanted({ torch: 7 }, { torch: 5 }, { torch: 1 }), { torch: 7 }, 'spent meanwhile: still the want, never more')
  assert.deepEqual(F.fetchStillWanted({ torch: 7 }, { torch: 0 }, { torch: 3 }), { torch: 4 })
  assert.deepEqual(F.fetchStillWanted({ torch: 7 }, {}, { torch: 30 }), { torch: 7 }, 'no baseline: as noted')
  // Codex r4: crafted 4 stairs then placed them -- the bag is back at its baseline, the PEAK (skills.mjs fetchPeakWatch) covers it
  assert.deepEqual(F.fetchStillWanted({ spruce_stairs: 4 }, { spruce_stairs: 0 }, { spruce_stairs: 4 }), {}, 'the peak since the want')
})
await t('MUTANT KILLED: the bag\'s gain ignored at the trip', async () => {
  await withMutant(F_PATH, '    if (c - gained > 0) out[n] = c - gained\n', '    if (c > 0) out[n] = c\n', async m => {
    assert.deepEqual(m.fetchStillWanted({ spruce_planks: 12 }, { spruce_planks: 0 }, { spruce_planks: 16 }), {}, 'killed')
  }).then(() => assert.fail('mutant survived'), e => assert.match(String(e?.message), /killed/))
})
await t('THE PEAK IS SAMPLED AFTER A SLOT BATCH (Codex r5): a stack moved between slots in one window_items pass is not a gain', async () => {
  const K = await import('../src/skills.mjs')
  const { EventEmitter } = await import('node:events')
  const slots = new Map([[36, { name: 'torch', count: 8, slot: 36 }]])
  const inv = new EventEmitter(); inv.items = () => [...slots.values()]
  const bot = { username: 'TestBot', entity: { position: { x: 0, y: 64, z: 0 } }, inventory: inv }
  K.bagRoomInstall(bot)
  bot.indexFetchWant = { state: 'fetch', plot: 'stepwell', items: { torch: 7 }, bag0: { torch: 8 }, peak: { torch: 8 }, pol: {}, at: Date.now() }
  K._indexfetch.fetchPeakWatch(bot)
  // the pass: slot 9 set first (both stacks counted), then slot 36 cleared -- synchronously, as mineflayer's window_items does
  slots.set(9, { name: 'torch', count: 8, slot: 9 }); inv.emit('updateSlot', 9)
  slots.delete(36); inv.emit('updateSlot', 36)
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r))
  assert.equal(bot.indexFetchWant.peak.torch, 8, 'no spike')
  assert.deepEqual(F.fetchStillWanted(bot.indexFetchWant.items, bot.indexFetchWant.bag0, bot.indexFetchWant.peak), { torch: 7 })
  // a real gain (a craft of 4 stairs-worth: 8 more torches) is seen
  slots.set(10, { name: 'torch', count: 8, slot: 10 }); inv.emit('updateSlot', 10)
  await new Promise(r => setImmediate(r))
  assert.equal(bot.indexFetchWant.peak.torch, 16)
  bot.indexFetchWant = null; S.setFetchAsk(null)
})
await t('MUTANT KILLED: the peak read mid-batch (a moved stack reads as a gain)', async () => {
  await withMutant(new URL('../src/skills.mjs', import.meta.url), 'if (!queued) { queued = true; setImmediate(sample) }', 'sample()', async K => {
    const { EventEmitter } = await import('node:events')
    const slots = new Map([[36, { name: 'torch', count: 8, slot: 36 }]])
    const inv = new EventEmitter(); inv.items = () => [...slots.values()]
    const bot = { username: 'TestBot', entity: { position: { x: 0, y: 64, z: 0 } }, inventory: inv }
    K.bagRoomInstall(bot)
    bot.indexFetchWant = { state: 'fetch', plot: 'stepwell', items: { torch: 7 }, bag0: { torch: 8 }, peak: { torch: 8 }, pol: {}, at: Date.now() }
    K._indexfetch.fetchPeakWatch(bot)
    slots.set(9, { name: 'torch', count: 8, slot: 9 }); inv.emit('updateSlot', 9)
    slots.delete(36); inv.emit('updateSlot', 36)
    await new Promise(r => setImmediate(r))
    assert.equal(bot.indexFetchWant.peak.torch, 8, 'killed')
  }).then(() => assert.fail('mutant survived'), e => assert.match(String(e?.message), /killed/))
})
await t('A STALE INDEX: the far chest the index says holds 116 shows 0 -> a miss, its entry corrected, never retried in the trip; the item backs off (no loop)', async () => {
  const w = town({ [MID]: { index: { torch: 116 }, real: {} }, [FAR]: { index: { torch: 3 }, real: { torch: 3 } } })
  const r = await F.runFetchTrip({ items: { torch: 7 }, plan: w.plan([0, 64, 0]), ops: w.ops, deadline: NOW + F.FETCH.tripMs })
  assert.deepEqual(w.visits, [MID, FAR], 'each container once: the stale one not again')
  assert.deepEqual(r.misses, [{ k: MID, item: 'torch', idx: 116, saw: 0 }])
  assert.equal(r.fixed, 1)
  assert.deepEqual(w.index[MID].obs.names, {}, 'the entry now says what the open saw')
  assert.equal(r.outcome, 'partial'); assert.deepEqual(r.found, { torch: 3 })
  const bo = F.fetchBackoff(new Map(), { torch: 7 }, r.found, { now: w.clock() })
  assert.ok(F.fetchBackedOff(bo, 'torch', w.clock() + 1000))
  // the next short draw: the corrected index names nothing; and the back-off would hold it anyway
  const again = F.fetchWantOf({ torch: 4 }, w.plan([0, 64, 0])({ torch: 4 }, new Set()), { backoff: bo, now: w.clock() })
  assert.deepEqual(again, {})
  assert.deepEqual(w.plan([0, 64, 0])({ torch: 4 }, new Set()).map(x => x.k), [], 'no target is left at all')
})
await t('A STALE INDEX WITH NO OBSERVATION WRITTEN: the miss is corrected by a dirty mark (the entry is unknown to every reader)', async () => {
  const w = town({ [FAR]: { index: { bone_meal: 6 }, real: { bone_meal: 1 } } }, { ix: false })
  const r = await F.runFetchTrip({ items: { bone_meal: 4 }, plan: w.plan([0, 64, 0]), ops: w.ops, deadline: NOW + F.FETCH.tripMs })
  assert.deepEqual(w.corrected, [FAR]); assert.equal(r.fixed, 1)
  assert.deepEqual(F.fetchTargets(w.index, { bone_meal: 1 }, { now: w.clock() }), [])
  assert.equal(r.outcome, 'partial')
})
await t('AN UNREACHABLE CHEST: one retry, then the trip ends (bounded), the item backs off', async () => {
  const w = town({ [FAR]: { index: { torch: 116 }, real: { torch: 116 } } }, { unreachable: new Set([FAR]), walk: 45_000 })
  const r = await F.runFetchTrip({ items: { torch: 7 }, plan: w.plan([0, 64, 0]), ops: w.ops, deadline: NOW + F.FETCH.tripMs })
  assert.deepEqual(w.visits, [FAR, FAR], 'the walk, and ONE retry')
  assert.equal(r.outcome, 'unreachable'); assert.deepEqual(r.unreachable, [FAR])
  assert.ok(r.ms <= F.FETCH.tripMs, String(r.ms))
  const bo = F.fetchBackoff(new Map(), { torch: 7 }, r.found, { now: w.clock() })
  assert.ok(F.fetchBackedOff(bo, 'torch', w.clock() + F.FETCH.backoffMs - 1)); assert.ok(!F.fetchBackedOff(bo, 'torch', w.clock() + F.FETCH.backoffMs + 1))
})
await t('THE TRIP CAP: twenty unreachable chests -- the trip stops at its cap, never past it', async () => {
  const chests = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${i * 10},64,${i}`, { index: { torch: 5 }, real: { torch: 5 } }]))
  const w = town(chests, { unreachable: new Set(Object.keys(chests)), walk: 30_000 })
  const deadline = NOW + F.FETCH.tripMs
  const r = await F.runFetchTrip({ items: { torch: 7 }, plan: w.plan([0, 64, 0]), ops: w.ops, deadline })
  assert.ok(w.clock() <= deadline + 30_000, 'at most one walk past the last check')
  assert.ok(w.visits.length <= Math.ceil(F.FETCH.tripMs / 30_000) + 1, String(w.visits.length))
  assert.equal(r.outcome, 'trip_cap')
})
await t('NO 12-CONTAINER CAP: fifteen chests of 1 torch each, all within the trip, give all 15', async () => {
  const chests = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`${i},64,${i}`, { index: { torch: 1 }, real: { torch: 1 } }]))
  const w = town(chests, { walk: 2_000 })
  const r = await F.runFetchTrip({ items: { torch: 15 }, plan: w.plan([0, 64, 0]), ops: w.ops, deadline: NOW + F.FETCH.tripMs })
  assert.equal(r.found.torch, 15); assert.equal(w.visits.length, 15); assert.equal(r.outcome, 'fetched')
})
await t('AN UNREADABLE INDEX: no target, no want, and the order is exactly today\'s (cooldown, then the build)', () => {
  assert.deepEqual(F.fetchTargets(null, { torch: 7 }), [])
  assert.deepEqual(F.fetchTargets(undefined, { torch: 7 }), [])
  assert.deepEqual(F.fetchWantOf({ torch: 7 }, F.fetchTargets(null, { torch: 7 })), {})
  S.setFetchAsk(() => null)   // no want noted
  try {
    const base = { on: true, shared: true, atTown: true, planned: true, record: { plot: 'stepwell', structure_complete: false }, freeSlots: 20 }
    assert.equal(S.buildOrder({ ...base, now: NOW + 60_000, state: { lastAt: NOW } }).order, null)
    assert.deepEqual(S.buildOrder({ ...base, now: NOW + 11 * 60_000, state: { lastAt: NOW } }).order, { skill: 'build_shop', args: {} })
  } finally { S.setFetchAsk(null) }
})
await t('the rows: _index_fetch names item, need, tried, found, the miss corrections, ms and the outcome, under 300 characters', () => {
  const d = F.indexFetchDetail({ plot: 'stepwell', items: { torch: 7 }, r: { tried: [`${MID}:miss`, `${FAR}:ok`], found: { torch: 7 }, misses: [{ k: MID, item: 'torch', idx: 116, saw: 0 }], fixed: 1, ms: 34012, outcome: 'fetched' }, then: 'build' })
  assert.match(d, /^op=trip plot=stepwell item=torch need=torch:7 tried=2:40,64,-30:miss;-95,66,80:ok found=torch:7 miss=40,64,-30:torch:116>0 fixed=1 ms=34012 outcome=fetched then=build$/)
  assert.ok(F.indexFetchDetail({ items: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`item_${i}_long_name`, 64])), r: { tried: Array(40).fill('-100,64,-100:chest_unreachable') } }).length <= 300)
})

await t('THE DISTANCE ROW (control 11-19): a capped / refused trip names every planned container, its distance from the start and what became of it', () => {
  const targets = [{ k: FAR, d: 125.4 }, { k: MID, d: 50.2 }, { k: NEAR, d: 14.1 }]
  const d = F.indexFetchDistDetail({ plot: 'stepwell', outcome: 'trip_cap', ms: 120001, from: { x: -2.3, y: 62, z: -72.8 }, targets, tried: [`${NEAR}:chest_unreachable`, `${MID}:ok`] })
  assert.equal(d, `op=dist plot=stepwell outcome=trip_cap ms=120001 from=-2,62,-73 n=3 near=14 far=125 dist=${NEAR}:14:unreach;${MID}:50:ok;${FAR}:125:untried`)
  const many = Array.from({ length: 40 }, (_, i) => ({ k: `${-100 - i},64,${-100 - i}`, d: 100 + i }))
  const big = F.indexFetchDistDetail({ outcome: 'refused', targets: many })
  assert.ok(big.length <= 300, String(big.length)); assert.match(big, /;\+$/)
})
await t('THE TRIP GOES ONLY WHERE THE ALLOWANCE LETS SOMETHING GO (rig run 7): the hall\'s chests under the torch reserve are not walked to', () => {
  const ents = { '16,71,-51': obs('16,71,-51', { torch: [15, 1], lantern: [73, 2] }), '22,71,-51': obs('22,71,-51', { torch: [11, 1] }), '-13,71,-6': obs('-13,71,-6', { torch: [50, 1] }) }
  const ts = F.fetchTargets(ents, { torch: 8, lantern: 4 }, { now: NOW, dist: dist([-61, 65, -73]) })
  assert.deepEqual(ts.map(t => t.k), ['16,71,-51', '-13,71,-6', '22,71,-51'], 'by distance alone: a hall chest first')
  const reserve32 = (n, t) => (n === 'torch' ? Math.max(0, t.names[n] - 32) : t.names[n])
  const ok = F.fetchAllowed(ts, reserve32)
  assert.deepEqual(ok.map(t => [t.k, t.names]), [['16,71,-51', { lantern: 73 }], ['-13,71,-6', { torch: 50 }]])
})
await t('MUTANT KILLED: the allowance filter passes every target', async () => {
  await withMutant(F_PATH, '    if (Object.keys(names).length) out.push({ ...t, names })\n', '    out.push(t)\n', async m => {
    assert.deepEqual(m.fetchAllowed([{ k: 'a', names: { torch: 11 } }], () => 0), [], 'killed')
  }).then(() => assert.fail('mutant survived'), e => assert.match(String(e?.message), /killed/))
})
await t('MUTANT KILLED: a visited chest not excluded (the stale chest is reopened while its entry could not be corrected)', async () => {
  await withMutant(F_PATH, '    for (const h of halves) visited.add(h)   // never again', '    void halves   // never again', async m => {
    const w = town({ [MID]: { index: { torch: 116 }, real: {} } }, { ix: false })
    w.ops.correct = () => false
    await m.runFetchTrip({ items: { torch: 7 }, plan: (short, ex) => m.fetchTargets({ [MID]: obs(MID, { torch: [116, 1] }) }, short, { now: NOW, exclude: ex }), ops: w.ops, deadline: NOW + 10 * F.FETCH.tripMs })
    assert.equal(w.visits.length, 1, 'killed: the stale chest was visited again')
  }).then(() => assert.fail('mutant survived'), e => assert.match(String(e?.message), /killed/))
})
await t('A MISS WHOSE CORRECTION FAILED is still never retried in the trip (the real code)', async () => {
  const w = town({ [MID]: { index: { torch: 116 }, real: {} } }, { ix: false })
  w.ops.correct = () => false
  const r = await F.runFetchTrip({ items: { torch: 7 }, plan: (short, ex) => F.fetchTargets({ [MID]: obs(MID, { torch: [116, 1] }) }, short, { now: NOW, exclude: ex }), ops: w.ops, deadline: NOW + 10 * F.FETCH.tripMs })
  assert.equal(w.visits.length, 1); assert.equal(r.fixed, 0); assert.equal(r.outcome, 'miss')
})
await t('MUTANT KILLED: the retry unbounded', async () => {
  await withMutant(F_PATH, '      if (n <= retries) retryQ.push({ k: tg.k, halves })\n', '      retryQ.push({ k: tg.k, halves })\n', async m => {
    const w = town({ [FAR]: { index: { torch: 116 }, real: { torch: 116 } } }, { unreachable: new Set([FAR]), walk: 5_000 })
    await m.runFetchTrip({ items: { torch: 7 }, plan: w.plan([0, 64, 0]), ops: w.ops, deadline: NOW + F.FETCH.tripMs })
    assert.equal(w.visits.length, 2, 'killed')
  }).then(() => assert.fail('mutant survived'), e => assert.match(String(e?.message), /killed/))
})
await t('MUTANT KILLED: the trip cap dropped', async () => {
  await withMutant(F_PATH, '    if (msLeft < minMs) { cap = true; break }\n', '', async m => {
    const chests = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${i * 10},64,${i}`, { index: { torch: 5 }, real: { torch: 5 } }]))
    const w = town(chests, { unreachable: new Set(Object.keys(chests)), walk: 30_000 })
    await m.runFetchTrip({ items: { torch: 7 }, plan: w.plan([0, 64, 0]), ops: w.ops, deadline: NOW + F.FETCH.tripMs })
    assert.ok(w.visits.length <= Math.ceil(F.FETCH.tripMs / 30_000) + 1, 'killed')
  }).then(() => assert.fail('mutant survived'), e => assert.match(String(e?.message), /killed/))
})
await t('MUTANT KILLED: the back-off ignored by the want (a failed trip loops)', async () => {
  await withMutant(F_PATH, ' || fetchBackedOff(backoff, n, now)) continue\n', ') continue\n', async m => {
    const ts = m.fetchTargets({ [FAR]: obs(FAR, { torch: [116, 2] }) }, { torch: 7 }, { now: NOW })
    assert.deepEqual(m.fetchWantOf({ torch: 7 }, ts, { backoff: new Map([['torch', NOW + 1]]), now: NOW }), {}, 'killed')
  }).then(() => assert.fail('mutant survived'), e => assert.match(String(e?.message), /killed/))
})
await t('MUTANT KILLED: the allowance not consulted (a trip for reserved stock)', async () => {
  await withMutant(F_PATH, '    for (const t of holds) { let a = 0; try { a = Number(allows(n, t)) || 0 } catch { a = 0 } if (a > 0) { can = true; break } }\n', '    can = holds.length > 0\n', async m => {
    const ts = m.fetchTargets({ [FAR]: obs(FAR, { bone_meal: [4, 1] }) }, { bone_meal: 1 }, { now: NOW })
    assert.deepEqual(m.fetchWantOf({ bone_meal: 1 }, ts, { allows: () => 0, now: NOW }), {}, 'killed')
  }).then(() => assert.fail('mutant survived'), e => assert.match(String(e?.message), /killed/))
})
await t('MUTANT KILLED: the order\'s fetch ask not wired (the want waits out the cooldown)', async () => {
  await withMutant(S_PATH, '      if (fa?.order) return { order: fa.order, skip: null }\n      fetchFree', '      fetchFree', async m => {
    m.setFetchAsk(() => ({ order: { skill: 'build_shop', args: { indexFetch: true, plot: 'stepwell' } } }))
    const base = { on: true, shared: true, atTown: true, planned: true, record: { plot: 'stepwell', structure_complete: false }, freeSlots: 20 }
    assert.deepEqual(m.buildOrder({ ...base, now: NOW + 60_000, state: { lastAt: NOW } }).order?.args, { indexFetch: true, plot: 'stepwell' }, 'killed')
  }).then(() => assert.fail('mutant survived'), e => assert.match(String(e?.message), /killed/))
})
await t('MUTANT KILLED: the follow-up keeps the cooldown (the fetched material waits 10 min in the bag)', async () => {
  await withMutant(S_PATH, 'if (cooldown && !fetchFree && now', 'if (cooldown && now', async m => {
    m.setFetchAsk(() => ({ cooldownFree: true }))
    const base = { on: true, shared: true, atTown: true, planned: true, record: { plot: 'stepwell', structure_complete: false }, freeSlots: 20 }
    assert.deepEqual(m.buildOrder({ ...base, now: NOW + 60_000, state: { lastAt: NOW } }).order, { skill: 'build_shop', args: {} }, 'killed')
  }).then(() => assert.fail('mutant survived'), e => assert.match(String(e?.message), /killed/))
})

await t('WIRED: the draw notes the want; build_shop dispatches the trip; the ask is installed; the open\'s observation rides on the visit', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  for (const line of [
    "if (why === 'build' && out.short && !out.unsettled && INDEXFETCH.on && bot.shopVisitBusy === true) {",
    'try { const fw = indexFetchNote(bot, Object.fromEntries(Object.entries(left).filter(([n]) => !zero.has(n))), allow, reserve); if (fw) out.fetch = fw }',
    'if (args?.indexFetch === true && INDEXFETCH.on) return indexFetchVisit(ctx, args, signal)',
    'if (INDEXFETCH.on) setFetchAsk(fetchAsk)',
    'diag.ix = opened.ix ?? null',
    'bot.indexFetchBackoff = fetchBackoff(bot.indexFetchBackoff ?? new Map(), w.items, r.found)',
    "if (got) { bot.indexFetchWant = { state: 'build', plot, items: {}, at: Date.now() };",
    "if (!townIndexEntries(bot)) { row(null, 'stop', 'unreadable');",
    "if (why === 'aborted') { fetchSettle(bot, w, plot, r, held0, 'stop', row); throw e }",
    'for (const [k, c] of Object.entries(v?.took ?? {})) if (Number(c) > 0) sofar[k] = (sofar[k] ?? 0) + Number(c)',
    'for (const [n, c] of Object.entries(items)) { merged[n] = Math.max(merged[n] ?? 0, c); pol[n] = { allow, reserve };',
    'const c = pol.allow(n, c0, { others, here, reserve: pol.reserve, taking: matsTaking(bot, n) })',
    'minMs: WITHDRAW_VISIT_MIN_MS,',
    'const msLeft = cap => Math.max(0, Math.min(cap, deadline - Date.now()))',
    "bot.inventory?.on?.('updateSlot', () => { if (!queued) { queued = true; setImmediate(sample) } })",
    "if (dr.at == null) throw new Error('no drawn record')",
    'plan: (short, exclude) => fetchAllowed(fetchPlanNow(bot, short, exclude), fetchPolAllows(bot, w)),',
    "if (r.cap || ['trip_cap', 'refused', 'unreachable', 'no_target'].includes(r.outcome)) { try { logEvent({ kind: 'index_fetch', status: 'no_effect', snapshot: snapshot(bot), detail: indexFetchDistDetail({ plot, outcome: r.outcome, ms: r.ms, from, targets: plan0, tried: r.tried }) })",
    'w.items = fetchStillWanted(w.items, w.bag0, top)',
  ]) assert.ok(src.includes(line), `missing: ${line}`)
  // Codex r1 BLOCKER 2: the trip's one-container visit never skips the container itself (its retry would be filtered out)
  const body = src.slice(src.indexOf('async function fetchVisitOne'), src.indexOf('async function indexFetchVisit'))
  assert.ok(body.length > 200 && !body.includes('searchFailSkip('), 'fetchVisitOne calls searchFailSkip')
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')
