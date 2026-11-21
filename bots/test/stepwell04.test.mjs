// STEPWELL-04SHOW: THE TANK'S STOCK. (stepwellvisit.mjs postsDraw / postsCraft / trimFetch / faceFetch / stockTank / pickPlaceItem /
// tankWithRemedy / tankStamps / tankRemedy; skills.mjs buildStepwellRun wires them.)
// LIVE showcase 11-21: every tank visit ended `no trim block in the bag at y 62 -- carry cobblestone` and wrote a 6 h stuck stamp.
// The bag keeps 64 of its stone (towndeposit.mjs townKeeps, cobblestone first) and only blocks above the keep are placed: Lumen came
// with 98 cobblestone (34 placeable), crafted 48 into posts and kept 50, all under the keep; the town fetch was skipped on the raw
// stone count (48+) before the craft, while the town held 624 stone_bricks and 6,526 cobblestone_wall.
// Behaviour through THE CHAIN on a fake world with the real visit loop and the real keep: the base's stock-up (the positive control)
// ends no_material on the y 62 rim layer with no trim placed; the head's draws the posts from the town's walls, crafts none, fetches
// stone_bricks and lays the trim; a run short of top stone fetches it and goes on (rule 4); a face never takes the tops' stone while
// another stone will do. Anchored mutants (each asserts its anchor present and unique) for every rule.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const S = await import('../src/stepwell.mjs')
const V = await import('../src/stepwellvisit.mjs')
const { townKeeps } = await import('../src/towndeposit.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const SV_PATH = new URL('../src/stepwellvisit.mjs', import.meta.url)
// withMutant: bots/test/climb-escape.test.mjs's (the anchor present AND unique, or the mutant is never written)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')

// ---- a fake world (stepwell-aside.test.mjs's), the ground at G = 62: the LIVE rim layer is y 62 ------------------------------------
const G = 62
const EMPTY = /^(air|cave_air|torch|short_grass)$/
const mk = n => (n == null ? null : { name: n, boundingBox: EMPTY.test(n) || /_sapling$/.test(n) ? 'empty' : (/water|lava/.test(n) ? 'empty' : 'block') })
function world (over = {}) {
  const m = new Map(Object.entries(over))
  const base = (x, y, z) => (y > G ? 'air' : y === G ? 'grass_block' : y >= G - 3 ? 'dirt' : y >= G - 40 ? 'stone' : 'bedrock')
  const get = (x, y, z) => { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : base(x, y, z) }
  return { read: (x, y, z) => mk(get(x, y, z)), set: (c, n) => m.set(c.join(','), n), get: c => get(...c), m }
}
const SITE = { origin: { x: 0, z: 0 }, away: 's', g: G, W: 21, T: 1 }
const PAL = S.PALETTES[0]   // floor/trim stone_bricks then cobblestone; wall cobblestone then stone_bricks; post cobblestone_wall
const kOf = a => a.join(',')
const GOOD = { wall: 'stone', body: 'stone', under: 'dirt', floor: 'stone_bricks', trim: 'stone_bricks', post: 'cobblestone_wall', light: 'torch', tread: 'stone', dlight: 'torch' }
/** Every unit before `idx` built (its cuts open, its cells good), and `idx`'s own cuts open: the layers above are done. */
function builtAbove (w, P, idx, { cutOwn = true } = {}) {
  for (let i = 0; i < idx; i++) {
    const u = P.units[i]
    for (const c of u.cut) w.set(c, 'air')
    for (const k of ['faces', 'under', 'tops', 'posts', 'lights']) for (const c of u[k]) w.set(c, GOOD[P.byKey.get(kOf(c)).role])
  }
  if (cutOwn) for (const c of P.units[idx].cut) w.set(c, 'air')
}
const RIM = P => P.units.findIndex(u => u.y === G)
/** A fake bot with a BAG: a placement holds what the real pick takes from the bag ABOVE THE KEEP (botBuildEffects' `has`). */
function bagBot (w, bag, keep, { start, log = [] } = {}) {
  let feet = [...start]
  let t = 0
  const spare = n => (bag[n] ?? 0) - (keep[n] ?? 0)
  return {
    get read () { return w.read },
    feet: () => feet,
    walkTo: async c => {
      const fl = w.read(c[0], c[1] - 1, c[2]), f = w.read(...c), h = w.read(c[0], c[1] + 1, c[2])
      if (!(fl?.boundingBox === 'block' && f?.boundingBox === 'empty' && h?.boundingBox === 'empty')) return false
      feet = [...c]; t += 1; return true
    },
    dig: async c => { w.set(c, 'air'); log.push(['dig', c]); t += 1; return 'confirmed' },
    place: async (c, role, at = {}) => {
      const item = V.pickPlaceItem(role, PAL, spare, { topsOwed: at?.topsOwed ?? 0 })
      if (!item) return 'no_material'
      bag[item] -= 1; w.set(c, item); log.push(['place', c, role, item]); t += 1
      return 'confirmed'
    },
    toolOk: () => true,
    fence: () => true,
    log: (op, d) => log.push([op, d]),
    now: () => t,
    aborted: () => false,
  }
}
const START = [10, G + 1, -2]
const visitOf = (P, e) => () => V.runStepwellVisit({ plan: P, exit: P.exit, onStop: async () => {} }, e, { opsMax: 400, lights: () => false })
/** THE SHOWCASE TOWN (the town index 11-21) and its withdraw: cobblestone keeps the build reserve (64: the 46 give nothing). */
function townOf (stock = { cobblestone: 46, cobbled_deepslate: 2002, stone_bricks: 624, cobblestone_wall: 6526 }, { reserve = { cobblestone: 64 } } = {}) {
  const st = { ...stock }, took = {}, order = []
  return {
    st, took, order,
    view: () => ({ ...st }),
    draw: bag => async (name, n) => {
      const got = Math.max(0, Math.min(n, (st[name] ?? 0) - (reserve[name] ?? 0)))
      if (got > 0) order.push(name)
      st[name] = (st[name] ?? 0) - got; bag[name] = (bag[name] ?? 0) + got; took[name] = (took[name] ?? 0) + got
      return got
    },
  }
}
const LUMEN = () => ({ cobblestone: 98, torch: 8, stone_pickaxe: 1 })
const placedOf = (log, role) => log.filter(q => q[0] === 'place' && q[2] === role)
const POSTS_LEFT = P => P.cells.filter(e => e.role === 'post').length

console.log('THE RULES (pure)')
await t('postsDraw: the posts come from the town\'s walls first, up to the visit\'s 48, less the walls held', () => {
  assert.strictEqual(V.postsDraw({ bag: LUMEN(), postsLeft: 195 }), 48)
  assert.strictEqual(V.postsDraw({ bag: { cobblestone_wall: 50 }, postsLeft: 195 }), 0)
  assert.strictEqual(V.postsDraw({ bag: { cobblestone_wall: 8 }, postsLeft: 10 }), 2)
  assert.strictEqual(V.postsDraw({ bag: {}, postsLeft: 0 }), 0)
})
await t('postsCraft: only cobblestone above BOTH the keep and the next layer\'s owed tops is crafted (the Lumen bag crafts none)', () => {
  const bag = LUMEN(), keep = townKeeps(bag).keep
  assert.strictEqual(keep.cobblestone, 64, 'the real keep: 64 of the stone, cobblestone first')
  assert.strictEqual(V.postsCraft({ bag, keep, postsLeft: 195, topsOwed: 151 }), 0, 'LIVE: 98 - 64 - 151 < 0')
  assert.strictEqual(V.postsCraft({ bag, keep, postsLeft: 195, topsOwed: 0 }), 30, 'above the keep alone: 34 -> five batches')
  assert.strictEqual(V.postsCraft({ bag: { cobblestone: 300 }, keep: { cobblestone: 64 }, postsLeft: 195, topsOwed: 151 }), 48)
  assert.strictEqual(V.postsCraft({ bag: { cobblestone: 300, cobblestone_wall: 48 }, keep: { cobblestone: 64 }, postsLeft: 195, topsOwed: 0 }), 0, 'walls held: none')
})
await t('trimFetch: on what is PLACEABLE (above the keep), stone_bricks first, then cobblestone; deepslate is never top stone', () => {
  const bag = LUMEN(), keep = townKeeps(bag).keep
  const town = { cobblestone: 46, stone_bricks: 624, cobbled_deepslate: 2002 }
  assert.deepStrictEqual(V.trimFetch({ bag, keep, topsOwed: 151, palette: PAL, town }), { name: 'stone_bricks', n: 117 })
  assert.deepStrictEqual(V.trimFetch({ bag, keep, topsOwed: 151, palette: PAL, town, tried: ['stone_bricks'] }), { name: 'cobblestone', n: 46 })
  assert.deepStrictEqual(V.trimFetch({ bag, keep, topsOwed: 151, palette: PAL, town: { cobblestone: 900 } }), { name: 'cobblestone', n: 117 }, 'no bricks in town')
  assert.deepStrictEqual(V.trimFetch({ bag, keep, topsOwed: 400, palette: PAL, town: null }), { name: 'stone_bricks', n: 128 }, 'town unread: asked, at most 128')
  assert.strictEqual(V.trimFetch({ bag, keep, topsOwed: 30, palette: PAL, town }), null, '34 placeable cover 30')
  assert.strictEqual(V.trimFetch({ bag, keep, topsOwed: 151, palette: PAL, town: { cobbled_deepslate: 2002 } }), null, 'the town has no top stone')
  // ONYX: 50 cobblestone + 51 cobbled_deepslate -- the keep takes all 50 cobblestone; the 37 deepslate above it are no trim
  const onyx = { cobblestone: 50, cobbled_deepslate: 51 }, ok = townKeeps(onyx).keep
  assert.deepStrictEqual(V.trimFetch({ bag: onyx, keep: ok, topsOwed: 151, palette: PAL, town }), { name: 'stone_bricks', n: 128 })
})
await t('townView (rig 11-21): only a fully known scan is the town\'s stock; a stale or partial index is unknown (every source asked)', () => {
  const stock = { stone_bricks: 308, cobblestone: 29 }
  assert.deepStrictEqual(V.townView({ stock, known: 35, keys: 35, coverage: 1 }), stock)
  assert.strictEqual(V.townView({ stock: {}, known: 0, keys: 35, coverage: 0 }), null, 'LIVE rig: every entry stale')
  assert.strictEqual(V.townView({ stock, known: 20, keys: 35, coverage: 20 / 35 }), null, 'partial')
  assert.strictEqual(V.townView(null), null)
  // the chain: an unknown town asks for the bricks; the stale empty stock would have skipped them
  const bag = LUMEN(), keep = townKeeps(bag).keep
  assert.deepStrictEqual(V.trimFetch({ bag, keep, topsOwed: 151, palette: PAL, town: V.townView({ stock: {}, known: 0, keys: 35, coverage: 0 }) }), { name: 'stone_bricks', n: 117 })
  assert.strictEqual(V.trimFetch({ bag, keep, topsOwed: 151, palette: PAL, town: {} }), null, 'control: the empty stock read as a proof skips every source')
})
await t('MUTANT KILLED: townView takes any reading as the stock (the rig\'s stale index)', async () => {
  await withMutant(SV_PATH, "export const townView = ts => (ts && ts.known > 0 && Number(ts.coverage) >= 1 && ts.stock && typeof ts.stock === 'object' ? ts.stock : null)", 'export const townView = ts => ts?.stock ?? null', async M => {
    assert.deepStrictEqual(M.townView({ stock: {}, known: 0, keys: 35, coverage: 0 }), {})
  })
})
await t('faceFetch: the face stone on what is placeable beyond the owed tops, cobbled_deepslate first', () => {
  const bag = LUMEN(), keep = townKeeps(bag).keep
  assert.deepStrictEqual(V.faceFetch({ bag, keep, topsOwed: 151, palette: PAL, town: { cobbled_deepslate: 2002, cobblestone: 46 } }), { name: 'cobbled_deepslate', n: 64 })
  assert.strictEqual(V.faceFetch({ bag: { ...bag, cobbled_deepslate: 64 }, keep, topsOwed: 151, palette: PAL, town: null }), null)
  assert.strictEqual(V.faceFetch({ bag: { cobblestone: 300 }, keep: { cobblestone: 64 }, topsOwed: 151, palette: PAL }), null, '236 placeable less 151 owed = 85')
})
await t('pickPlaceItem: a face takes the tops\' stone only beyond the owed tops; a top and a seal take their first item', () => {
  const sp = m => n => m[n] ?? 0
  assert.strictEqual(V.pickPlaceItem('wall', PAL, sp({ cobblestone: 10, cobbled_deepslate: 3 }), { topsOwed: 5 }), 'cobblestone')
  assert.strictEqual(V.pickPlaceItem('wall', PAL, sp({ cobblestone: 5, cobbled_deepslate: 3 }), { topsOwed: 5 }), 'cobbled_deepslate')
  assert.strictEqual(V.pickPlaceItem('under', PAL, sp({ cobblestone: 5, cobbled_deepslate: 3 }), { topsOwed: 5 }), 'cobbled_deepslate')
  assert.strictEqual(V.pickPlaceItem('wall', PAL, sp({ cobblestone: 5 }), { topsOwed: 5 }), 'cobblestone', 'nothing else held: the face is laid')
  assert.strictEqual(V.pickPlaceItem('trim', PAL, sp({ cobblestone: 5, stone_bricks: 1 }), { topsOwed: 5 }), 'stone_bricks')
  assert.strictEqual(V.pickPlaceItem('seal', PAL, sp({ cobblestone: 1, cobbled_deepslate: 9 }), { topsOwed: 5 }), 'cobblestone')
  assert.strictEqual(V.pickPlaceItem('trim', PAL, sp({ cobbled_deepslate: 9 }), {}), null)
})
await t('tankStamps / tankRemedy: no stamp after a fetch of the missing top stone; every remedy names what the bot does', () => {
  assert.strictEqual(V.tankStamps({ stop: 'no_material', role: 'trim', placed: 0, dug: 0 }), true)
  assert.strictEqual(V.tankStamps({ stop: 'no_material', role: 'trim', placed: 0, dug: 0, fetched: { stone_bricks: 117 } }), false)
  assert.strictEqual(V.tankStamps({ stop: 'no_material', placed: 3, dug: 0 }), false)
  assert.strictEqual(V.tankStamps({ stop: 'passed', placed: 0, dug: 0, fetched: { stone_bricks: 4 } }), false, 'a fetch: never stamped')
  assert.strictEqual(V.tankStamps({ stop: 'unknown', placed: 0, dug: 0, fetched: { stone_bricks: 128 } }), false, 'Codex r1: unloaded after the fetch')
  assert.strictEqual(V.tankStamps({ stop: 'passed', placed: 0, dug: 0, fetched: {} }), true)
  assert.strictEqual(V.tankStamps({ stop: 'time', placed: 0, dug: 0 }), false)
  assert.match(V.tankRemedy({ stop: 'no_material', role: 'trim', fetched: { stone_bricks: 117 } }), /fetched 117 stone_bricks from town/)
  assert.match(V.tankRemedy({ stop: 'no_material', role: 'trim' }), /town gives no stone_bricks or cobblestone: mine cobblestone/)
  assert.match(V.tankRemedy({ stop: 'no_material', role: 'post' }), /withdraw cobblestone_wall/)
  assert.match(V.tankRemedy({ stop: 'no_pickaxe' }), /pickaxe/)
})

await t('stockTank: no draw or craft is started once the visit\'s own share of the clock is all that is left (rig 11-21)', async () => {
  const bag = LUMEN(), keep = townKeeps(bag).keep, town = townOf(), crafted = []
  const st = { bag: () => ({ ...bag }), keep, palette: PAL, postsLeft: 195, owed: () => 151, town: town.view, draw: town.draw(bag), craft: async n => crafted.push(n) }
  const out = await V.stockTank(st, { timeOk: () => false })
  assert.deepStrictEqual([out.drawn, crafted, town.order], [{}, [], []])
  let calls = 0
  const out2 = await V.stockTank(st, { timeOk: () => ++calls <= 1 })
  assert.deepStrictEqual(Object.keys(out2.drawn), ['cobblestone_wall'], 'the walls drawn, then the clock is the tank\'s')
})
await t('drawReserveMs: a draw ends workMs before the visit\'s deadline (the 180 s skill, the 120 s visit -> 120 s reserved), never under 30 s', () => {
  assert.strictEqual(V.drawReserveMs({ skillDeadline: 180_000, visitDeadline: 120_000 }), 120_000)
  assert.strictEqual(V.drawReserveMs({ skillDeadline: 180_000, visitDeadline: 600_000 }), 30_000)
  assert.strictEqual(V.drawReserveMs({}), 30_000)
})
console.log('THE CHAIN (the real visit loop, the real keep)')
/** THE BASE'S STOCK-UP (d78215c15 skills.mjs buildStepwellRun, the tank's branch), for the positive control: the town draw only under
 *  48 raw stone, the craft from raw cobblestone (walls < 6 and cobblestone >= 48 + 16). */
async function baseStock (bag, postsLeft, town) {
  const raw = ['cobblestone', 'cobbled_deepslate', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'deepslate', 'stone_bricks'].reduce((t, n) => t + (bag[n] ?? 0), 0)
  if (raw < 48) await town.draw(bag)('cobblestone', 64)
  const want = Math.min(postsLeft, 48)
  if (postsLeft > 0 && (bag.cobblestone_wall ?? 0) < Math.min(postsLeft, 6) && bag.cobblestone >= want + 16) { const n = Math.ceil(want / 6) * 6; bag.cobblestone -= n; bag.cobblestone_wall = (bag.cobblestone_wall ?? 0) + n }
}
await t('POSITIVE CONTROL (the base, LIVE): Lumen\'s 98 cobblestone, the posts crafted from the kept stone, no fetch -> no trim at y 62', async () => {
  const P = S.planTank(SITE), w = world(), i = RIM(P)
  builtAbove(w, P, i)
  for (const c of P.units[i].tops) w.set(c, 'air')
  const bag = LUMEN(), keep = townKeeps(bag).keep, town = townOf(), log = []
  await baseStock(bag, POSTS_LEFT(P), town)
  assert.deepStrictEqual([bag.cobblestone, bag.cobblestone_wall, town.took.cobblestone ?? 0], [50, 48, 0], 'LIVE: 48 crafted, 50 left, nothing fetched')
  const r = await visitOf(P, bagBot(w, bag, keep, { start: START, log }))()
  assert.strictEqual(r.stop, 'no_material')
  assert.strictEqual(r.role, 'trim')
  assert.strictEqual(r.y, G)
  assert.strictEqual(placedOf(log, 'trim').length, 0, 'no trim placed')
  assert.strictEqual(V.tankStamps(r), true, 'and the 6 h stamp')
})
async function lumenHead (M = V, { stock = true, townStock } = {}) {
  const P = S.planTank(SITE), w = world(), i = RIM(P)
  builtAbove(w, P, i)
  for (const c of P.units[i].tops) w.set(c, 'air')
  const bag = LUMEN(), keep = townKeeps(bag).keep, town = townOf(townStock), log = []
  const crafted = []
  const owed = () => M.nextTopsOwed(w.read, P).n
  const st = { bag: () => ({ ...bag }), keep, palette: PAL, postsLeft: POSTS_LEFT(P), owed, town: town.view, draw: town.draw(bag),
    craft: async n => { crafted.push(n); bag.cobblestone -= n; bag.cobblestone_wall = (bag.cobblestone_wall ?? 0) + n } }
  const pre = stock ? await M.stockTank(st) : { drawn: {}, crafted: 0 }
  const e = bagBot(w, bag, keep, { start: START, log })
  // the bag's pick is the module under test (a mutant's pickPlaceItem when M is one)
  const spare = n => (bag[n] ?? 0) - (keep[n] ?? 0)
  e.place = async (c, role, at = {}) => {
    const item = M.pickPlaceItem(role, PAL, spare, { topsOwed: at?.topsOwed ?? 0 })
    if (!item) return 'no_material'
    bag[item] -= 1; w.set(c, item); log.push(['place', c, role, item]); return 'confirmed'
  }
  const r = await M.tankWithRemedy({ run: () => M.runStepwellVisit({ plan: P, exit: P.exit, onStop: async () => {} }, e, { opsMax: 400, lights: () => false }), stock: st, now: () => 0, deadline: Infinity })
  return { P, w, i, bag, keep, town, log, crafted, pre, r }
}
await t('THE LUMEN CASE (the head): the posts drawn from the town\'s walls, none crafted, stone_bricks fetched, the y 62 trim laid', async () => {
  const { P, w, i, town, log, crafted, pre, r } = await lumenHead()
  assert.strictEqual(pre.drawn.cobblestone_wall, 48, 'the posts from the town\'s walls')
  assert.deepStrictEqual(crafted, [], 'no post crafted from the kept cobblestone')
  assert.ok((town.took.stone_bricks ?? 0) >= 117, `stone_bricks fetched: ${town.took.stone_bricks}`)
  const trims = P.units[i].tops.filter(c => P.byKey.get(kOf(c)).role === 'trim')
  assert.ok(placedOf(log, 'trim').length > 0, 'trim placed')
  assert.strictEqual(trims.filter(c => S.cellGood('trim', w.read(...c)) !== true).length, 0, 'every trim cell of the y 62 layer laid')
  assert.ok(placedOf(log, 'post').length > 0, 'and posts on it')
  assert.notStrictEqual(r.stop === 'no_material' && ['trim', 'floor'].includes(r.role), true, `no top refused at the end: ${r.stop}/${r.role}`)
  assert.strictEqual(V.tankStamps(r), false, 'no 6 h stamp')
})
await t('RULE 4 alone (no stock-up): the run short of trim fetches stone_bricks and runs again; no stamp', async () => {
  const { log, town, r } = await lumenHead(V, { stock: false })
  assert.ok(r.runs >= 2, `ran again: ${r.runs}`)
  assert.ok((r.fetched.stone_bricks ?? 0) > 0 && (town.took.stone_bricks ?? 0) === r.fetched.stone_bricks)
  assert.ok(placedOf(log, 'trim').filter(q => q[3] === 'stone_bricks').length > 0, 'the fetched bricks laid as trim')
  assert.strictEqual(V.tankStamps(r), false)
})
await t('RULE 4, the town without top stone: one run, the stamp, and the remedy says mine cobblestone', async () => {
  const P = S.planTank(SITE), w = world(), i = RIM(P)
  builtAbove(w, P, i)
  for (const c of P.units[i].tops) w.set(c, 'air')
  // the bag's cobblestone all under the keep (nothing placeable): the visit does nothing, and the town has no top stone to give
  const bag = { cobblestone: 64, torch: 8 }, keep = townKeeps(bag).keep, town = townOf({ cobblestone: 46, cobbled_deepslate: 2002 })
  const e = bagBot(w, bag, keep, { start: START })
  const r = await V.tankWithRemedy({ run: visitOf(P, e), stock: { bag: () => ({ ...bag }), keep, palette: PAL, owed: () => V.nextTopsOwed(w.read, P).n, town: town.view, draw: town.draw(bag) }, now: () => 0 })
  assert.strictEqual(r.runs, 1)
  assert.strictEqual(r.stop, 'no_material')
  assert.deepStrictEqual(r.fetched, {})
  assert.strictEqual(r.placed, 0)
  assert.strictEqual(V.tankStamps(r), true)
  assert.match(V.tankRemedy(r), /mine cobblestone/)
})
/** CODEX r1 BLOCKER's case: the bag's stone all under the keep (the first run does nothing), the withdraw walks the bot to the town's
 *  chests where the tank reads UNLOADED (null), and `back()` walks it to the exit again (the tank loaded). */
async function farTown (M = V, { withBack = true } = {}) {
  const P = S.planTank(SITE), w = world(), i = RIM(P)
  builtAbove(w, P, i)
  for (const c of P.units[i].tops) w.set(c, 'air')
  const bag = { cobblestone: 64, torch: 8 }, keep = townKeeps(bag).keep, town = townOf(), log = []
  let far = false, backs = 0
  const e = bagBot(w, bag, keep, { start: START, log })
  const spare = n => (bag[n] ?? 0) - (keep[n] ?? 0)
  Object.defineProperty(e, 'read', { get: () => (far ? () => null : w.read) })
  e.place = async (c, role, at = {}) => {
    const item = M.pickPlaceItem(role, PAL, spare, { topsOwed: at?.topsOwed ?? 0 })
    if (!item) return 'no_material'
    bag[item] -= 1; w.set(c, item); log.push(['place', c, role, item]); return 'confirmed'
  }
  const draw0 = town.draw(bag)
  const stock = { bag: () => ({ ...bag }), keep, palette: PAL, owed: () => M.nextTopsOwed(w.read, P).n, town: town.view, draw: async (n, k) => { far = true; return draw0(n, k) } }
  const r = await M.tankWithRemedy({ run: () => M.runStepwellVisit({ plan: P, exit: P.exit, onStop: async () => {} }, e, { opsMax: 400, lights: () => false }), stock, now: () => 0,
    ...(withBack ? { back: async () => { backs++; far = false } } : {}) })
  return { r, log, backs }
}
await t('CODEX r1 BLOCKER: after a fetch at the town\'s chests the visit walks back to the tank (back) and lays the trim; never a stamp', async () => {
  const { r, log, backs } = await farTown()
  assert.ok(backs >= 1, 'walked back')
  assert.ok(placedOf(log, 'trim').length > 0, `trim laid after the walk back: ${r.stop}`)
  assert.strictEqual(V.tankStamps(r), false)
})
await t('CODEX r1 BLOCKER (control): with no walk back the rerun reads the tank unloaded (unknown) -- and still no stamp after the fetch', async () => {
  const { r, log } = await farTown(V, { withBack: false })
  assert.strictEqual(r.stop, 'unknown')
  assert.strictEqual(placedOf(log, 'trim').length, 0)
  assert.ok(Object.values(r.fetched).some(v => v > 0))
  assert.strictEqual(V.tankStamps(r), false)
})
/** A layer with faces and tops (below the rim): the bag's cobblestone above the keep is exactly the tops owed; deepslate for the faces. */
async function facesLayer (M = V) {
  const P = S.planTank(SITE), w = world(), i = RIM(P) + 1
  builtAbove(w, P, i)
  const u = P.units[i]
  const owedTops = M.topsOwedIn(w.read, P, u)
  const faces = u.faces.filter(c => S.cellDone(w.read, P, c) !== true).length
  assert.ok(owedTops > 0 && faces > 10, `a layer with both: tops ${owedTops}, faces ${faces}`)
  const bag = { cobblestone: 64 + owedTops, cobbled_deepslate: faces + 8, cobblestone_wall: u.posts.length }, keep = townKeeps(bag).keep
  assert.deepStrictEqual([keep.cobblestone, keep.cobbled_deepslate ?? 0], [64, 0])
  const log = []
  const e = bagBot(w, bag, keep, { start: START, log })
  const spare = n => (bag[n] ?? 0) - (keep[n] ?? 0)
  e.place = async (c, role, at = {}) => {
    const item = M.pickPlaceItem(role, PAL, spare, { topsOwed: at?.topsOwed ?? 0 })
    if (!item) return 'no_material'
    bag[item] -= 1; w.set(c, item); log.push(['place', c, role, item]); return 'confirmed'
  }
  const r = await M.runStepwellVisit({ plan: P, exit: P.exit, onStop: async () => {} }, e, { opsMax: 400, lights: () => false })
  return { P, w, u, r, log }
}
await t('COMPOSED: the faces of a layer take the deepslate, so its tops still have their cobblestone (no refusal on that layer)', async () => {
  const { P, w, u, r, log } = await facesLayer()
  assert.ok(placedOf(log, 'wall').length > 0)
  assert.ok(placedOf(log, 'wall').every(q => q[3] === 'cobbled_deepslate'), 'every face laid with deepslate')
  assert.strictEqual(u.tops.filter(c => S.cellDone(w.read, P, c) !== true).length, 0, 'the layer\'s tops all laid')
  assert.ok(!(r.stop === 'no_material' && r.y === u.y), `no refusal on the layer: ${r.stop} at ${r.y}`)
})

console.log('MUTANTS (each anchor asserted present and unique)')
await t('MUTANT KILLED: postsCraft from the raw cobblestone (no keep, no owed tops) crafts the Lumen bag\'s posts', async () => {
  await withMutant(SV_PATH, 'const free = n0(bag.cobblestone) - n0(keep.cobblestone) - n0(topsOwed)', 'const free = n0(bag.cobblestone)', async M => {
    const bag = LUMEN(), keep = townKeeps(bag).keep
    assert.notStrictEqual(M.postsCraft({ bag, keep, postsLeft: 195, topsOwed: 151 }), 0)
  })
})
await t('MUTANT KILLED: the stock-up without the posts draw leaves the posts to the craft (no walls drawn)', async () => {
  await withMutant(SV_PATH, "  if (wd > 0 && timeOk()) await take('cobblestone_wall', wd)\n", '\n', async M => {
    const { pre } = await lumenHead(M)
    assert.notStrictEqual(pre.drawn.cobblestone_wall, 48)
  })
})
await t('MUTANT KILLED: trimFetch on the raw count (the keep ignored) under-fetches', async () => {
  await withMutant(SV_PATH, 'const deficit = Math.min(max, n0(topsOwed) - spareOf(bag, keep, topItems(palette)))', 'const deficit = Math.min(max, n0(topsOwed) - topItems(palette).reduce((s, x) => s + n0(bag[x]), 0))', async M => {
    const bag = LUMEN(), keep = townKeeps(bag).keep
    assert.notDeepStrictEqual(M.trimFetch({ bag, keep, topsOwed: 151, palette: PAL, town: { stone_bricks: 624 } }), { name: 'stone_bricks', n: 117 })
  })
})
await t('MUTANT KILLED: cobblestone fetched before stone_bricks', async () => {
  await withMutant(SV_PATH, "export const TRIM_FETCH_ORDER = Object.freeze(['stone_bricks', 'cobblestone'])", "export const TRIM_FETCH_ORDER = Object.freeze(['cobblestone', 'stone_bricks'])", async M => {
    assert.strictEqual(M.trimFetch({ bag: {}, keep: {}, topsOwed: 10, palette: PAL, town: { cobblestone: 900, stone_bricks: 624 } }).name, 'cobblestone')
    // a town with cobblestone to give: the head lays bricks, the mutant the town's cobblestone (positive control: the head)
    const ts = { cobblestone: 900, stone_bricks: 624, cobblestone_wall: 6526 }
    const head = await lumenHead(V, { stock: false, townStock: ts })
    assert.strictEqual(head.town.order[0], 'stone_bricks', 'the head: bricks first')
    const mut = await lumenHead(M, { stock: false, townStock: ts })
    assert.strictEqual(mut.town.order[0], 'cobblestone', 'the mutant takes the cobblestone first')
  })
})
await t('MUTANT KILLED: no refetch after a run short of trim (rule 4 off) -> one run, the stamp', async () => {
  await withMutant(SV_PATH, 'for (let i = 0; i < refetch && r.stop', 'for (let i = 0; i < 0 && r.stop', async M => {
    const { r } = await lumenHead(M, { stock: false })
    assert.strictEqual(r.runs, 1)
    assert.deepStrictEqual(r.fetched, {})
    assert.strictEqual(r.stop, 'no_material')
  })
})
await t('MUTANT KILLED: a face takes the tops\' cobblestone regardless (the reserve off) -> the layer\'s tops refused', async () => {
  await withMutant(SV_PATH, 'return have.find(n => !tops.includes(n) || topSpare > n0(topsOwed)) ?? have[0]', 'return have[0]', async M => {
    const { u, r } = await facesLayer(M)
    assert.strictEqual(r.stop, 'no_material')
    assert.strictEqual(r.y, u.y)
  })
})
await t('MUTANT KILLED: the visit loop stops passing the owed tops to the placement', async () => {
  await withMutant(SV_PATH, 'const r = await e.place(op.at, op.role, { topsOwed: topsOwedIn(read, plan, unit) })', 'const r = await e.place(op.at, op.role, {})', async M => {
    const { u, r } = await facesLayer(M)
    assert.strictEqual(r.stop, 'no_material')
    assert.strictEqual(r.y, u.y)
  })
})
await t('MUTANT KILLED: the walk back before a rerun dropped -> the rerun reads the tank unloaded', async () => {
  await withMutant(SV_PATH, '    if (back) { try { await back() } catch (err) { if (err?.aborted) throw err } }\n', '\n', async M => {
    const { r, log } = await farTown(M)
    assert.strictEqual(r.stop, 'unknown')
    assert.strictEqual(placedOf(log, 'trim').length, 0)
  })
})
await t('MUTANT KILLED: a fetch spares the stamp only on no_material (the base of Codex r1\'s blocker)', async () => {
  await withMutant(SV_PATH, 'return !Object.values(r.fetched ?? {}).some(v => v > 0)', "return !(r.stop === 'no_material' && Object.values(r.fetched ?? {}).some(v => v > 0))", async M => {
    const { r } = await farTown(M, { withBack: false })
    assert.strictEqual(M.tankStamps(r), true)
  })
})
await t('MUTANT KILLED: a fetch no longer spares the stamp', async () => {
  await withMutant(SV_PATH, 'return !Object.values(r.fetched ?? {}).some(v => v > 0)', 'return true', async M => {
    assert.strictEqual(M.tankStamps({ stop: 'no_material', role: 'trim', placed: 0, dug: 0, fetched: { stone_bricks: 117 } }), true)
  })
})

await t('MUTANT KILLED: the stock-up ignores the clock', async () => {
  await withMutant(SV_PATH, '    for (let f; timeOk() && (f = fn(', '    for (let f; (f = fn(', async M => {
    const bag = LUMEN(), keep = townKeeps(bag).keep, town = townOf()
    const out = await M.stockTank({ bag: () => ({ ...bag }), keep, palette: PAL, postsLeft: 195, owed: () => 151, town: town.view, draw: town.draw(bag), craft: async () => {} }, { timeOk: () => false })
    assert.ok(Object.keys(out.drawn).length > 0)
  })
})
await t('MUTANT KILLED: the draw clock ignores the visit (the withdraw\'s 30 s alone)', async () => {
  await withMutant(SV_PATH, 'const r = Number(skillDeadline) - (Number(visitDeadline) - workMs)', 'const r = 0', async M => {
    assert.strictEqual(M.drawReserveMs({ skillDeadline: 180_000, visitDeadline: 120_000 }), 30_000)
  })
})
console.log('THE WIRING (structural: skills.mjs buildStepwellRun)')
const SKS = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const RUN = SKS.slice(SKS.indexOf('async function buildStepwellRun ('), SKS.indexOf('async function foundStore ('))
const WIRES = [
  ['the stock-up runs before the visit', /await swStockTank\(\{ bag: \(\) => heldMap\(bot\), keep, palette: pal, postsLeft, owed: topsOwed, town: swTown, draw: swDraw,/],
  ['the visit runs through the remedy', /const r = await swTankWithRemedy\(\{ now, deadline, back: \(\) => stairWalk\(bot, rec\.exit, STEPWELL_WALK_MS, signal\), stock: \{ bag: \(\) => heldMap\(bot\), keep, palette: pal, town: swTown, owed: topsOwed, draw: swDraw \}, run: \(\) => runIt\(\(\) => runStepwellVisit\(\{/],
  ['the stamp follows tankStamps', /if \(swTankStamps\(r\)\) \{/],
  ['the stock-up keeps the tank\'s share of the clock', /\{ max: STEPWELL_POSTS_CRAFT, timeOk: \(\) => Date\.now\(\) < deadline - SWSTOCK\.workMs \}\)/],
  ['every tank draw ends before the visit\'s work share', /rsv = swDrawReserveMs\(\{ skillDeadline: withdrawClock\(ctx\)\.deadline, visitDeadline: t0 \+ budget - ZIG_VISIT_TAIL_MS \}\)/],
  ['the town\'s stock is read through townView', /const swTown = \(\) => \{ try \{ return swTownView\(matsTownStock\(bot\)\) \} catch \{ return null \} \}/],
  ['the remedy follows tankRemedy', /const remedy = swTankRemedy\(r\)/],
  ['the effects count above the keep', /palette: rec\.palette \?\? \{\}, signal, fence, keep,/],
]
for (const [name, re] of WIRES) {
  await t(`skills: ${name} (and a one-character mutant of it is not matched)`, () => {
    assert.ok(re.test(RUN), 'wired')
    const m = RUN.match(re)[0]
    assert.strictEqual(RUN.split(m).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
    assert.ok(!re.test(RUN.replace(m, m.replace(/[A-Za-z]/, '#'))), 'a one-character mutant of the executable line is not matched')
  })
}
await t('skills: the base\'s raw-count fetch and raw craft are gone from the tank\'s branch', () => {
  assert.ok(!/stairLiningCount\(bot\) < 48\) await draw\(\{ cobblestone: 64 \}\)/.test(RUN))
  assert.ok(!/countItem\(bot, 'cobblestone'\) >= wallsWant \+ 16/.test(RUN))
})

console.log(`\nstepwell04: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
