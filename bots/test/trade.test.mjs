// coalsale-01 (T2) + T4 buying: trade.mjs's pure decisions on mineflayer-shaped trade lists (the 1.21.8 shape proven in
// sandbox4 11-03), the census buyer list, and the two cognitive.mjs hooks (structural, comment-stripped, mutant-proved).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-trade-logs-'))
process.env.BOT_NAME = 'TradeBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-trade-pool-'))
const T = await import('../src/trade.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }
const it = (name, count = 1, extra = {}) => ({ name, count, ...extra })
const tr = (in1, out, { in2 = null, uses = 0, max = 16, price = null, off = false } = {}) => ({ inputItem1: in1, outputItem: out, inputItem2: in2, hasItem2: !!in2, nbTradeUses: uses, maximumNbTradeUses: max, realPrice: price ?? in1.count, tradeDisabled: off })
const HOME = { x: 355, y: 73, z: 147 }

await t('the census ships for every fleet pool; 11 pools have a coal buyer within 700 b of 355,73,147 or their town; 4 have none', () => {
  const pools = ['board-a', 'board-b', 'board-c', 'board-d', 'hive-a', 'hive-b', 'hive-c', 'hive-d', 'isolated-a', 'isolated-b', 'isolated-c', 'isolated-d', 'placebo-a', 'placebo-b', 'placebo-c', 'placebo-d']
  const n = Object.fromEntries(pools.map(p => [p, T.censusOf(p).length]))
  for (const p of ['board-b', 'hive-d', 'placebo-a', 'placebo-d']) assert.equal(n[p], 0, p)
  assert.ok(n['board-a'] >= 10 && n['isolated-c'] >= 10, JSON.stringify(n))
  const d = T.pickDestination(T.censusOf('board-a'), HOME)
  assert.ok(d && d.dist >= 550 && d.dist <= 700, JSON.stringify(d))
  assert.ok(T.COAL_BUYERS.includes(d.p) || d.buyer === false)
  assert.equal(T.pickDestination([], HOME), null)
  assert.equal(T.pickDestination(T.censusOf('board-a'), HOME, { radius: 100 }), null, 'the radius bounds it')
})

await t('pickDestination: a coal buyer before any other profession; a failed spot avoided', () => {
  const l = [{ p: 'farmer', x: 400, y: 70, z: 147 }, { p: 'armorer', x: 900, y: 70, z: 147 }, { p: 'toolsmith', x: 950, y: 70, z: 147 }]
  assert.equal(T.pickDestination(l, HOME).p, 'armorer')
  assert.equal(T.pickDestination(l, HOME, { avoid: [{ x: 900, z: 147 }] }).p, 'toolsmith')
  assert.equal(T.pickDestination([l[0]], HOME).buyer, false, 'no buyer: the nearest villager, to roam from')
})

await t('coalForTrip: only coal above the town keep (64), at most 60 carried, whole trades of 15', () => {
  assert.equal(T.coalForTrip({ townCoal: 500, held: 0 }), 60)
  assert.equal(T.coalForTrip({ townCoal: 500, held: 20 }), 40, '20 held + 40 = 60 = four trades')
  assert.equal(T.coalForTrip({ townCoal: 70, held: 0 }), 0, 'only 6 above the keep: no trade')
  assert.equal(T.coalForTrip({ townCoal: 94, held: 0 }), 30)
  assert.equal(T.coalForTrip({ townCoal: 10, held: 16 }), 0, 'the bag already has a trade: draw nothing')
  assert.equal(T.coalForTrip({ townCoal: 64, held: 0 }), 0, 'POSITIVE: the keep itself is never drawn')
})

await t('tripAdmit: each refusal, then go', () => {
  const base = { on: true, census: 10, dest: { x: 1, z: 1 }, now: 1e9, state: {}, atTown: true, timeOfDay: 1000, health: 20, freeSlots: 20, take: 30, held: 0, leased: false }
  assert.deepEqual(T.tripAdmit(base), { ok: true, why: 'go' })
  for (const [k, v, why] of [['on', false, 'off'], ['census', 0, 'no_census'], ['dest', null, 'no_destination'], ['atTown', false, 'away'],
    ['timeOfDay', 13000, 'not_morning'], ['health', 12, 'health'], ['freeSlots', 2, 'bag'], ['take', 0, 'no_goods'], ['leased', true, 'leased']]) {
    assert.equal(T.tripAdmit({ ...base, [k]: v }).why, why, k)
  }
  assert.equal(T.tripAdmit({ ...base, state: { lastTripAt: 1e9 - 1000 } }).why, 'cooldown')
  assert.equal(T.tripAdmit({ ...base, state: { backoffUntil: 2e9 } }).why, 'backoff')
})

await t('turnHome: reasons, never a timer except the stranded cap (45 min)', () => {
  const trip = T.newTrip({ now: 0, home: HOME, dest: { x: 900, y: 70, z: 147 }, take: 60 })
  const r = (o = {}) => T.turnHome(trip, { now: 60_000, timeOfDay: 3000, health: 20, freeSlots: 20, coal: 60, emeralds: 0, ...o })
  assert.equal(r(), null, 'working: no reason')
  assert.equal(r({ now: 44 * 60_000 }), null, '44 min is not a reason')
  assert.equal(r({ now: 45 * 60_000 }), 'stranded')
  assert.equal(r({ timeOfDay: 13000 }), 'night')
  assert.equal(r({ health: 9 }), 'health')
  assert.equal(r({ freeSlots: 0 }), 'bag_full')
  assert.equal(r({ coal: 5 }), 'no_goods')
  trip.sold = 60; assert.equal(r({ coal: 0 }), 'sold')
  assert.equal(r({ coal: 0, emeralds: 4, buyLeft: true }), null, 'still emeralds to spend at a mason')
  trip.earned = 8; assert.equal(r({ coal: 30 }), 'goal')
})

await t('breadcrumbs: dropped every 24 b; home walks them back nearest first; null at home', () => {
  const trip = T.newTrip({ now: 0, home: { x: 0, y: 64, z: 0 }, dest: { x: 100, y: 64, z: 0 }, take: 0 })
  for (let x = 0; x <= 100; x += 5) T.dropCrumb(trip, { x, y: 64, z: 0 })
  assert.deepEqual(trip.crumbs.map(c => c.x), [0, 25, 50, 75, 100])
  assert.deepEqual(T.nextCrumbHome(trip, { x: 100, y: 64, z: 0 }), { x: 75, y: 64, z: 0 })
  assert.deepEqual(T.nextCrumbHome(trip, { x: 60, y: 64, z: 3 }), { x: 50, y: 64, z: 0 }, 'off the line: the nearest crumb first')
  assert.equal(T.nextCrumbHome(trip, { x: 1, y: 64, z: 1 }), null)
})

await t('roamPoint: three legs round the first destination, then none', () => {
  const trip = T.newTrip({ now: 0, home: HOME, dest: { x: 900, y: 70, z: 147 }, take: 0 })
  const pts = []
  for (let i = 0; i < 4; i++) { const p = T.roamPoint(trip); pts.push(p); if (p) trip.roam++ }
  assert.equal(pts.filter(Boolean).length, 3); assert.equal(pts[3], null)
  assert.ok(pts.slice(0, 3).every(p => Math.hypot(p.x - 900, p.z - 147) >= 63 && Math.hypot(p.x - 900, p.z - 147) <= 130))
})

await t('merchantOf / tradeCandidates: coal buyers first, then mason/librarian; babies, sleepers, tried and others left out', () => {
  const V = (id, prof, x, md = {}) => { const m = []; m[18] = { villagerProfession: prof, level: 1 }; for (const [k, v] of Object.entries(md)) m[+k] = v; return { id, uuid: `u${id}`, name: 'villager', position: { x, y: 64, z: 0 }, metadata: m } }
  const ents = { 1: V(1, 10, 2), 2: V(2, 13, 9), 3: V(3, 5, 1), 4: V(4, 1, 3, { 16: true }), 5: V(5, 14, 4, { 6: 2 }), 6: V(6, 9, 5), 7: V(7, 6, 40) }
  const c = T.tradeCandidates(ents, { x: 0, z: 0 })
  assert.deepEqual(c.map(m => m.profession), ['toolsmith', 'mason', 'librarian'])
  assert.deepEqual(T.tradeCandidates(ents, { x: 0, z: 0 }, ['u2']).map(m => m.profession), ['mason', 'librarian'])
  assert.deepEqual(T.tradeCandidates(ents, { x: 0, z: 0 }, [], { radius: 50 }).map(m => m.profession)[1], 'fisherman')
  assert.equal(T.merchantOf({ name: 'cow', position: { x: 0, y: 0, z: 0 } }), null)
})

await t('sellPlan: only coal -> emerald offers still open, limited by uses and the coal held; never a two-input or disabled offer', () => {
  const trades = [tr(it('emerald'), it('stone_axe')), tr(it('coal', 15), it('emerald'), { uses: 14, max: 16 }), tr(it('coal', 15), it('emerald'), { off: true }), tr(it('coal', 10), it('emerald'))]
  assert.deepEqual(T.sellPlan(trades, { coal: 60 }), [{ i: 1, times: 2, price: 15, item: 'coal' }, { i: 3, times: 3, price: 10, item: 'coal' }])
  assert.deepEqual(T.sellPlan(trades, { coal: 14 }), [{ i: 3, times: 1, price: 10, item: 'coal' }])
  assert.deepEqual(T.sellPlan([tr(it('emerald'), it('bread', 6))], { coal: 60 }), [], 'POSITIVE: a farmer novice buys no coal')
})

await t('buyPlan (T4): a wanted book first (only when offered), then mason building blocks, inside the emeralds held', () => {
  const book = (id) => it('enchanted_book', 1, { components: [{ type: 'stored_enchantments', data: { enchantments: [{ id, level: 1 }] } }] })
  const reg = { enchantments: { 7: { name: 'mending' }, 9: { name: 'sharpness' } } }
  const en = x => T.storedEnchants(x, reg)
  const trades = [tr(it('emerald', 1), it('bricks', 10), { max: 16 }), tr(it('emerald', 5), book(7), { in2: it('book'), max: 12 }), tr(it('emerald', 3), book(9)), tr(it('emerald', 1), it('chiseled_stone_bricks', 4))]
  assert.deepEqual(T.buyPlan(trades, { emeralds: 8, booksLeft: 1, enchName: en }).map(b => [b.what, b.times]), [['enchanted_book:minecraft:mending', 1], ['bricks', 3]])
  assert.deepEqual(T.buyPlan(trades, { emeralds: 8, booksLeft: 0, enchName: en }).map(b => [b.what, b.times]), [['bricks', 8]], 'book already bought this trip: blocks only')
  assert.deepEqual(T.buyPlan(trades, { emeralds: 0, enchName: en }), [])
  assert.deepEqual(T.buyPlan([tr(it('emerald', 1), it('stone_axe'))], { emeralds: 9 }), [], 'a tool is not a building block')
  assert.deepEqual(en(book(7)), ['minecraft:mending'])
})

await t('STRUCTURAL: cognitive.mjs issues the open trip (after the deep trip, never over one) and the start (before the coal run); mutants fail', () => {
  const src = fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
  const A1 = "if (!this.bot?.deepTrip) { const o = tradeTripOrder(this.bot); if (o) order = o }"
  const A2 = "const o = tradeStartOrder(this.bot, { now: Date.now(), atTown })"
  const A3 = "if (this.bot?.tradeTrip) delay = Math.min(delay, DEEP_TRIP_NEXT_MS)"
  const wired = s => { const x = strip(s); return x.includes(A1) && x.includes(A2) && x.includes(A3) && x.indexOf(A1) > x.indexOf('deepTripOrder(this.bot?.deepTrip); if (o) order = o') && x.indexOf(A2) < x.indexOf('coalRunOrder({') }
  assert.equal(wired(src), true)
  for (const a of [A1, A2, A3]) {
    assert.equal(src.split(a).length - 1, 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + a)
    assert.equal(wired(src.replace(a, '// ' + a)), false, 'mutant (commented out) must fail: ' + a)
  }
})

await t('COALSALE-02 stoneForTrip: only stone above the town keep (192), at most two stacks (128), whole trades of 20', () => {
  assert.equal(T.stoneForTrip({ townStone: 1000, held: 0 }), 120, '128 -> 6 whole trades = 120')
  assert.equal(T.stoneForTrip({ townStone: 250, held: 0 }), 40, '58 above the keep -> 2 trades')
  assert.equal(T.stoneForTrip({ townStone: 192, held: 0 }), 0, 'POSITIVE: the keep itself is never drawn')
  assert.equal(T.stoneForTrip({ townStone: 1000, held: 30 }), 90, '30 held + 90 = 120')
  assert.equal(T.townItemTotal({ a: { obs: { names: { stone: [300, 5] } } }, b: { obs: { names: { coal: [9, 1] } } }, c: {} }, 'stone'), 300)
})

await t('COALSALE-02 sellPlan: STONE first in whole trades of 20 within the window stock (uses left); coal only while coalOk', () => {
  const trades = [tr(it('coal', 15), it('emerald'), { max: 16 }), tr(it('stone', 20), it('emerald'), { uses: 14, max: 16 }), tr(it('emerald'), it('bricks', 10))]
  assert.deepEqual(T.sellPlan(trades, { coal: 60, stone: 128 }), [{ i: 1, times: 2, price: 20, item: 'stone' }, { i: 0, times: 4, price: 15, item: 'coal' }], 'stock: only 2 stone uses left')
  assert.deepEqual(T.sellPlan(trades, { coal: 60, stone: 128, coalOk: false }), [{ i: 1, times: 2, price: 20, item: 'stone' }])
  assert.deepEqual(T.sellPlan([tr(it('stone', 20), it('emerald'), { uses: 16, max: 16 })], { stone: 128 }), [], 'out of stock: nothing')
  assert.equal(T.stoneOfferOpen(trades), true)
  assert.equal(T.stoneOfferOpen([tr(it('stone', 20), it('emerald'), { uses: 16, max: 16 })]), false)
  assert.equal(T.stoneOfferOpen([tr(it('clay_ball', 10), it('emerald'))]), false, 'a NOVICE mason (clay) does not buy stone')
})

await t('COALSALE-02 trip rules: masons first when carrying stone; coal stops counting once a stone buyer is found; stone keeps a trip on only while a mason may still buy', () => {
  const V = (id, prof, x) => { const m = []; m[18] = { villagerProfession: prof, level: 2 }; return { id, uuid: `u${id}`, name: 'villager', position: { x, y: 64, z: 0 }, metadata: m } }
  const ents = { 1: V(1, 13, 2), 2: V(2, 10, 9) }
  assert.deepEqual(T.tradeCandidates(ents, { x: 0, z: 0 }, [], { stone: true }).map(m => m.profession), ['mason', 'toolsmith'])
  assert.deepEqual(T.tradeCandidates(ents, { x: 0, z: 0 }).map(m => m.profession), ['toolsmith', 'mason'])
  const trip = T.newTrip({ now: 0, home: HOME, dest: { x: 900, y: 70, z: 147 }, take: 0, stoneTake: 100 })
  assert.equal(trip.phase, 'stock')
  const r = (o = {}) => T.turnHome(trip, { now: 60_000, timeOfDay: 3000, coal: 0, stone: 0, ...o })
  assert.equal(r({ stone: 100 }), null, 'stone and no mason opened yet: carry on')
  trip.masonOpened = true
  assert.equal(r({ stone: 100 }), 'no_goods', 'a mason opened with no stone offer: stone is not a reason to stay')
  trip.stoneOffer = trip.stoneOpen = true
  assert.equal(r({ stone: 100 }), null)
  trip.stoneOpen = false
  assert.equal(r({ stone: 100 }), 'no_goods', 'its stock used up: stone is no reason to stay (sandbox4 STONE run: the trip roamed on with 88 stone)')
  trip.stoneOpen = true
  assert.equal(r({ coal: 60, stone: 0 }), 'no_goods', 'a stone buyer found: coal is kept as fuel, not a reason to stay')
  assert.equal(T.tripAdmit({ on: true, census: 5, dest: { x: 1, z: 1 }, now: 1e9, atTown: true, timeOfDay: 1000, freeSlots: 5, stoneTake: 120, masonKnown: true }).why, 'bag', 'two stacks need their slots')
  assert.equal(T.tripAdmit({ on: true, census: 5, dest: { x: 1, z: 1 }, now: 1e9, atTown: true, timeOfDay: 1000, freeSlots: 10, stoneTake: 120, masonKnown: true }).ok, true)
  assert.equal(T.tripAdmit({ on: true, census: 5, dest: { x: 1, z: 1 }, now: 1e9, atTown: true, timeOfDay: 1000, freeSlots: 10, stoneTake: 120, masonKnown: false }).why, 'no_goods', 'no mason in the census: stone is no reason')
  assert.equal(T.pickDestination([{ p: 'toolsmith', x: 400, y: 70, z: 147 }, { p: 'mason', x: 500, y: 70, z: 147 }], HOME, { want: 'stone' }).p, 'mason')
  const adm = o => T.tripAdmit({ on: true, census: 5, dest: { x: 1, z: 1 }, now: 1e9, atTown: true, timeOfDay: 1000, freeSlots: 10, masonKnown: true, ...o }).why
  assert.equal(adm({ stoneHeld: 192 }), 'heavy_bag', 'Codex review: a bag already over two stacks of stone does not leave')
  assert.equal(adm({ held: 61, take: 0 }), 'heavy_bag', 'nor over 60 coal')
  assert.equal(adm({ stoneHeld: 128 }), 'go', 'POSITIVE: exactly the limit goes')
})

await t('COALSALE-02 live sightings: employed adults merged by uuid into the pool list, joined to the census (no duplicate of a census villager)', () => {
  const now = 5
  const l = T.mergeLive([], [{ uuid: 'm1', profession: 'mason', level: 2, x: 900.5, y: 70, z: 147.2 }, { uuid: 'n', profession: 'none', x: 1, y: 1, z: 1 }, { uuid: 'b', profession: 'mason', baby: true, x: 1, y: 1, z: 1 }], now)
  assert.deepEqual(l, [{ uuid: 'm1', p: 'mason', level: 2, x: 900, y: 70, z: 147, at: 5 }])
  const c = T.censusOf('board-a', { live: l })
  assert.equal(c.filter(v => v.p === 'mason').length, 1)
  assert.equal(T.censusOf('board-a').some(v => v.p === 'mason'), false, 'MEASURED 11-05: no fleet census holds a mason')
  assert.equal(T.pickDestination(c, HOME, { want: 'stone' }).p, 'mason')
  assert.deepEqual(T.mergeLive(l, [{ uuid: 'm1', profession: 'mason', level: 3, x: 900, y: 70, z: 147 }], 9)[0].level, 3, 'newest wins')
})

await t('Claude review BLOCKER: the gate admits every call of an open trip (same args each time) -- no repeat window, cooldown or learned rule strands it; housekeeping', async () => {
  const { AdmissionControl } = await import('../src/admission.mjs')
  const { HOUSEKEEPING } = await import('../src/hygiene.mjs')
  const gate = new AdmissionControl({ failCount: () => 9, bumpBlocked: () => 1, entryFor: () => null })
  const bot = { registry: { blocksByName: {}, itemsByName: {} }, entity: { position: { y: 64 } }, players: {}, inventory: { items: () => [] } }
  for (let i = 0; i < 12; i++) assert.equal(gate.check({ skill: 'trade_trip', args: {} }, bot).ok, true, `call ${i}`)
  assert.equal(gate.check({ skill: 'trade_trip', args: {} }, { ...bot, inventoryUnsettled: { why: 'x' } }).reason, 'inventory_unsettled')
  assert.equal(HOUSEKEEPING.has('trade_trip'), true)
})

await t('MUTANT: without the admission branch, the trip\'s 5th identical call is refused (repeat_loop) -- the branch is what keeps it going', async () => {
  const src = fs.readFileSync(new URL('../src/admission.mjs', import.meta.url), 'utf8')
  const old = "    if (skill === 'trade_trip' && !bot?.inventoryUnsettled) return { ok: true, skill, args: {}, kind: 'trade_trip' }\n" +
    "    if (skill === 'trade_trip') return { ok: false, reason: 'inventory_unsettled', detail: `wait: a stack is still being put back from the cursor (${String(bot.inventoryUnsettled.why ?? '').slice(0, 60)})` }\n"
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-trade-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, '').replace(/from '\.\//g, "from '../src/"))
  try {
    const { AdmissionControl: A } = await import(out.href)
    const gate = new A(null)
    const bot = { registry: { blocksByName: {}, itemsByName: {} }, entity: { position: { y: 64 } }, players: {}, inventory: { items: () => [] } }
    const res = []
    for (let i = 0; i < 6; i++) res.push(gate.check({ skill: 'trade_trip', args: {} }, bot).reason ?? 'ok')
    assert.ok(res.includes('repeat_loop'), `mutant refused nothing: ${res}`)
  } finally { try { fs.unlinkSync(out) } catch {} }
})

await t('the skill is registered (chatOnly, never the model\'s) inside the runner timeout', async () => {
  const SK = await import('../src/skills.mjs')
  assert.equal(typeof SK.SKILLS.trade_trip?.run, 'function')
  assert.equal(SK.SKILLS.trade_trip.chatOnly, true)
  assert.ok(T.TRADE.callMs < 180_000)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
