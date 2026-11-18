// DRAWSHORT-01SHOW (item 10, control 11-18): a building visit that ran out of a block the town's index stocks is `draw_short` -- not an
// idle stop, the order asks again after its cooldown -- at most DRAW_SHORT_MAX times a plot, then `no_material` as before; the visit's
// draw is on its `_build_bag` row (need, the containers tried, what stayed short); and a room trip never throws the stone its own pick
// is about to lay (the keep is the pick's open bill of the family, buildfirst.mjs roomKeepFor). Behaviour first, then the composed
// chain through the real shop.mjs order, anchored mutants, the wiring (structural).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-drawshort-${process.pid}`
process.env.BOT_NAME = 'TestBot'

const B = await import('../src/buildfirst.mjs')
const S = await import('../src/shop.mjs')
const G = await import('../src/grounds2.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }
const BF_PATH = new URL('../src/buildfirst.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const ONE = /_(pickaxe|axe|shovel|hoe|sword)$|^shears$/
function bagOf (counts) {
  const out = []
  let slot = 9
  for (const [name, n0] of Object.entries(counts)) { let n = n0; const per = ONE.test(name) ? 1 : 64; while (n > 0) { const c = Math.min(per, n); out.push({ name, count: c, slot: slot++ }); n -= c } }
  return out
}
const fam = items => items.filter(i => B.ROOM_WELL_NAMES.includes(i.name)).reduce((s, i) => s + i.count, 0)
const PAL = Object.freeze({ roof: ['spruce_stairs', 'stone_brick_stairs'], under: ['spruce_planks'] })
const namesOf = role => S.roleNames(PAL, role)
// LIVE town index 11-18 14:49Z (35 containers): spruce_stairs 132, stone_brick_stairs 122
const TOWN = Object.freeze({ spruce_stairs: 132, stone_brick_stairs: 122, spruce_planks: 353 })

await t('drawShortStop: a no_material on a role the town stocks is draw_short; DRAW_SHORT_MAX of them, then no_material (capped)', () => {
  const ask = count => B.drawShortStop({ stop: 'no_material', why: 'roof for roof', namesOf, town: TOWN, count })
  assert.deepEqual(ask(0), { stop: 'draw_short', capped: false, names: ['spruce_stairs', 'stone_brick_stairs'] })
  assert.equal(ask(B.DRAW_SHORT_MAX - 1).stop, 'draw_short')
  assert.deepEqual({ stop: ask(B.DRAW_SHORT_MAX).stop, capped: ask(B.DRAW_SHORT_MAX).capped }, { stop: 'no_material', capped: true })
  assert.equal(B.DRAW_SHORT_MAX, 2)
})
await t('drawShortStop: a REAL gap (the town stocks none of the role) stays no_material; any other stop passes through', () => {
  assert.deepEqual(B.drawShortStop({ stop: 'no_material', why: 'roof for roof', namesOf, town: { spruce_planks: 9 }, count: 0 }), { stop: 'no_material', capped: false, names: [] })
  assert.equal(B.drawShortStop({ stop: 'deadline', why: 'x', namesOf, town: TOWN }).stop, 'deadline')
  assert.equal(B.drawShortStop({ stop: 'no_material', why: '', namesOf, town: TOWN }).stop, 'no_material', 'no role named: as before')
  assert.equal(B.drawShortStop({ stop: 'no_material', why: 'roof for roof', namesOf: () => { throw new Error('x') }, town: TOWN }).stop, 'no_material')
})
await t('draw_short is NOT an idle stop (the order is not sent to the expedition / copper / market asks), and the grounds take the bot meanwhile', () => {
  assert.equal(S.buildIdle({ complete: false, record: { plot: 'civicH' }, lastStop: 'draw_short' }), false)
  assert.equal(S.buildIdle({ complete: false, record: { plot: 'civicH' }, lastStop: 'no_material' }), true, 'the capped case: as before')
  assert.ok(G.FALL_STOPS.includes('draw_short'))
})
await t('THE CHAIN through the real order: draw_short -> the order issues the build again after its cooldown; capped -> no_material -> buildIdle, as before', () => {
  const base = { on: true, shared: true, atTown: true, planned: true, record: { plot: 'civicH', structure_complete: false }, freeSlots: 20 }
  let count = 0, now = 1.8e12
  const visit = () => { const d = B.drawShortStop({ stop: 'no_material', why: 'roof for roof', namesOf, town: TOWN, count }); if (d.stop === 'draw_short') count++; return d.stop }
  const s1 = visit()
  assert.equal(s1, 'draw_short')
  assert.equal(S.buildOrder({ ...base, now: now + 60_000, state: { lastStop: s1, lastAt: now } }).order, null, 'inside the cooldown: nothing')
  assert.deepEqual(S.buildOrder({ ...base, now: now + 11 * 60_000, state: { lastStop: s1, lastAt: now } }).order, { skill: 'build_shop', args: {} }, 'after it: the build again')
  const s2 = visit(); assert.equal(s2, 'draw_short')
  const s3 = visit(); assert.equal(s3, 'no_material', 'the third: the back-off as before')
  assert.equal(S.buildIdle({ complete: false, record: base.record, lastStop: s3 }), true)
})
await t('drawDetail / buildBagDetail: need, tried (n and the list), short -- the row stays under 300 characters', () => {
  const d = S.drawDetail({ need: { spruce_stairs: 24, spruce_planks: 10 }, tried: ['22,73,28:chest_unreachable', '-5,71,8:success'], short: { spruce_stairs: 24 } })
  assert.match(d, /^need=spruce_stairs:24,spruce_planks:10 tried=2:22,73,28:chest_unreachable;-5,71,8:ok short=spruce_stairs:24$/)
  const bal = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`item_${i}_with_a_long_name`, { bag0: 1, took: 2, crafted: 0, placed: 3, back: 0, bag1: 0, unexplained: -i }]))
  const row = S.buildBagDetail('civicH', bal, { exit: 'no_material', silent: 0, drawn: 'ok', draw: { need: { spruce_stairs: 24 }, tried: Array(14).fill('12,71,-57:success'), short: { spruce_stairs: 24 } } })
  assert.ok(row.length <= 300, String(row.length))
  assert.match(row, / need=spruce_stairs:24 tried=14:/)
  assert.ok(!/need=/.test(S.buildBagDetail('shop', bal)), 'no draw: the row as before')
})
await t('THE KEEP FOR THE PICK: never below 64, the pick\'s own open bill of the family up to ROOM_KEEP_MAX', () => {
  assert.equal(B.roomKeepFor(0), 64)
  assert.equal(B.roomKeepFor(85), 85, 'the warehouse ground: 85 fills left')
  assert.equal(B.roomKeepFor(5000), B.ROOM_KEEP_MAX)
  assert.equal(B.ROOM_KEEP_MAX, 256)
})
await t('THE WAREHOUSE CHAIN: a bot at 36/36 sent to the ground (85 fills) -> the room trip leaves it 85 of the family -> the visit lays them', () => {
  const bag = bagOf({ cobblestone: 192, cobbled_deepslate: 128, clay: 57, sand: 56, andesite: 44, diorite: 16, dirt: 35, wheat_seeds: 60, sugar_cane: 46, spruce_log: 19, spruce_sapling: 16, iron_axe: 1, stone_pickaxe: 2, iron_pickaxe: 1, stone_hoe: 1, shears: 1, gravel: 64 * 14 })
  const free = 36 - bag.length
  const keep = B.roomKeepFor(85)
  const w = B.roomWellStacks(bag, { need: 8, freeSlots: free, keep })
  const gone = new Set(w.stacks.map(s => s.slot))
  const after = bag.filter(i => !gone.has(i.slot))
  assert.ok(fam(after) >= 85, `${fam(after)} of the family left for 85 fills`)
  // the plain 64 keep would have thrown the fills' stone
  const plain = B.roomWellStacks(bag, { need: 8, freeSlots: free, keep: 64 })
  assert.ok(fam(bag.filter(i => !new Set(plain.stacks.map(s => s.slot)).has(i.slot))) < 85, 'without the pick keep: short of the fills')
})
await t('MUTANT KILLED: the cap dropped (draw_short for ever)', async () => {
  await withMutant(BF_PATH, "  if ((Number(count) || 0) >= max) return { stop: 'no_material', capped: true, names }\n", '', async m => {
    assert.equal(m.drawShortStop({ stop: 'no_material', why: 'roof for roof', namesOf, town: TOWN, count: 9 }).stop, 'draw_short', 'killed')
  })
})
await t('MUTANT KILLED: the stock test dropped (a real gap read as draw_short)', async () => {
  await withMutant(BF_PATH, "  if (!role || !names.length) return { stop, capped: false, names: [] }\n", '', async m => {
    assert.equal(m.drawShortStop({ stop: 'no_material', why: 'roof for roof', namesOf, town: {}, count: 0 }).stop, 'draw_short', 'killed')
  })
})
await t('MUTANT KILLED: the pick keep floored at 64 only', async () => {
  await withMutant(BF_PATH, 'export const roomKeepFor = (bill = 0) => Math.max(ROOM_WELL_KEEP, Math.min(ROOM_KEEP_MAX, Math.floor(Number(bill) || 0)))', 'export const roomKeepFor = (bill = 0) => ROOM_WELL_KEEP', async m => {
    assert.equal(m.roomKeepFor(85), 64, 'killed')
  })
})
await t('THE SEARCH (sandbox2 11-18): the index judges a plain item name exactly, so a build draw is sent first to the containers holding it', async () => {
  const IX = await import('../src/indexsearch2.mjs')
  assert.equal(IX.indexJudges(['spruce_stairs', 'lantern'], { exact: true }), true)
  assert.equal(IX.indexJudges(['spruce_stairs']), false, 'any other search: as before (coal, stone ... stay unjudged)')
  assert.equal(IX.needLacks('spruce_stairs', { spruce_stairs: [85, 2] }, { exact: true }), false)
  assert.equal(IX.needLacks('spruce_stairs', { stone_brick_stairs: [14, 1] }, { exact: true }), true)
  assert.equal(IX.needLacks('minecraft:odd name', {}, { exact: true }), null, 'anything not a plain name: not judged, as before')
  const obs = (k, names, at) => ({ last: { t: 'obs', at, id: `o${at}` }, obs: { id: `o${at}`, at, h: [k], names, used: 1, size: 27 }, ops: {} })   // indexsearch2.test.mjs's fixture
  const ev = IX.indexEvidence({ '20,71,-57': obs('20,71,-57', { spruce_stairs: [85, 2] }, 1.8e12), '-7,71,8': obs('-7,71,8', { stone_brick_wall: [40, 1] }, 1.8e12) },
    [{ k: '20,71,-57', halves: ['20,71,-57'] }, { k: '-7,71,8', halves: ['-7,71,8'] }], ['spruce_stairs'], { now: 1.8e12 + 1000, exact: true })
  assert.equal(ev.judged, true); assert.ok(ev.pos.has('20,71,-57')); assert.ok(ev.neg.has('-7,71,8'))
})
await t('MUTANT KILLED: plain item names left unjudged (the draw ranks the town by distance alone)', async () => {
  await withMutant(new URL('../src/indexsearch2.mjs', import.meta.url), "  if (exact && typeof need === 'string' && ITEM_NAME_RE.test(need)) return heldOf(names, n => n === need) === 0\n", '', async m => {
    assert.equal(m.indexJudges(['spruce_stairs'], { exact: true }), false, 'killed')
  })
})
await t('WIRED: the visit maps no_material through drawShortStop with a cap row; the bag row carries the draw; the room trip keeps its pick\'s bill', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  for (const line of [
    "const d = drawShortStop({ stop: r.stop, why: r.why ?? '', namesOf: role => roleNames(pal, role), town, count: m.get(plot) ?? 0 })",
    "if (d.stop === 'draw_short') m.set(plot, (m.get(plot) ?? 0) + 1)",
    "kind: 'draw_short'",
    "setBagDraw(() => activeMem?.bot?.drawLog ?? null)",
    'bot.drawLog = null',
    "for (let i = 0; (i < 12 || (i < 12 + WITHDRAW_SHORT_EXTRA && (shortExtra || bot.bfShortExtra === true) && stockedShort())) && want() && next.block && pc.msLeft(Infinity) >= WITHDRAW_VISIT_MIN_MS; i++) {",
    'const WITHDRAW_SHORT_EXTRA = 6',
    'bot.bfShortExtra = true',
    'const keep = roomPickKeepNow(bot, plot)',
    'bot.roomYardKeep = roomPickKeepNow(bot, plot)',
    "if ('cobblestone' in out) out.cobblestone = Math.max(out.cobblestone ?? 0, Math.min(cob, K))",
    'r = await disposeWell(ctx, { roomPlan: { need, plot } }, signal)',
  ]) assert.ok(src.includes(line), `missing: ${line}`)
  assert.ok(strip(readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8')).includes("export const IDLE_STOPS = Object.freeze(['no_material', 'keeper_held'])"), 'draw_short stays out of IDLE_STOPS')
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')
