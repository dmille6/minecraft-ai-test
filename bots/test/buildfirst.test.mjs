// BUILDFIRST-01SHOW (src/buildfirst.mjs has the case): idle bots go to an open building first, a building refused for bag room gets a
// remedy the bot performs (the room bank, else a WELL TRIP of the cobble family above the yard's keep), and a pick no remedy serves
// steps aside for this bot 10 minutes (the room hold). Behaviour first: the pure rules, then THE COMPOSED CHAIN through the real
// shop.mjs picker and order (activeProject, waitBackoff, buildOrder) and projturn's own marks -- a bot at 35/36 with an open landmark
// -> refused for room -> the well trip -> the building visit -> blocks placed -- and its dead ends (the well dead or unreachable,
// the yard with room, a pick whose cells are all unworkable, every building held: the grounds, never a loop). Then the steer
// (minecrew.mjs crewSteer issues the building order as is), anchored mutants, and the wiring (structural).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-buildfirst-${process.pid}`
process.env.BOT_NAME = 'TestBot'

const B = await import('../src/buildfirst.mjs')
const S = await import('../src/shop.mjs')
const PT = await import('../src/projturn.mjs')
const MC = await import('../src/minecrew.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }
const BF_PATH = new URL('../src/buildfirst.mjs', import.meta.url)
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const MC_PATH = new URL('../src/minecrew.mjs', import.meta.url)
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// A REAL BAG (showcase-Iris, 11-18 12:40Z, the last row: 36 of 36) laid out in slots by stack size
const ONE = /_(pickaxe|axe|shovel|hoe|sword)$|^shears$/
const IRIS = { stone_hoe: 1, iron_axe: 1, spruce_log: 19, stone_pickaxe: 2, cobbled_deepslate: 216, shears: 1, diorite: 16, gravel: 3, cobblestone: 488, sand: 56, sugar_cane: 46,
  furnace: 1, clay_ball: 228, bucket: 3, crafting_table: 1, andesite: 44, wheat_seeds: 60, composter: 1, chest: 1, spruce_sapling: 16, dirt: 35 }
function bagOf (counts) {
  const out = []
  let slot = 9
  for (const [name, n0] of Object.entries(counts)) {
    let n = n0
    const per = ONE.test(name) ? 1 : name === 'bucket' ? 16 : 64
    while (n > 0) { const c = Math.min(per, n); out.push({ name, count: c, slot: slot++ }); n -= c }
  }
  return out
}
const famOf = items => items.filter(i => B.ROOM_WELL_NAMES.includes(i.name)).reduce((s, i) => s + i.count, 0)
const NOW = 1.8e12
const MIN = 60_000

// ------------------------------------------------------------------------------------------------- the pure rules
await t('roomWellStacks: whole cobble-family stacks, smallest first, only what the room needs, the family keeps 64, nothing else ever', () => {
  const bag = bagOf(IRIS)
  assert.ok(bag.length >= 35, `${bag.length} slots`)
  const r = B.roomWellStacks(bag, { need: 8, freeSlots: 36 - bag.length })
  assert.equal(r.slots, 8 - (36 - bag.length), 'whole stacks up to 8 free, no more')
  assert.ok(r.stacks.every(s => B.ROOM_WELL_NAMES.includes(s.name)), 'only cobblestone and cobbled_deepslate')
  const thrown = r.stacks.reduce((s, x) => s + x.count, 0)
  assert.ok(famOf(bag) - thrown >= B.ROOM_WELL_KEEP, `the family keeps ${B.ROOM_WELL_KEEP}`)
  // a bag with little of the family: only what stands above the keep
  assert.equal(B.ROOM_WELL_KEEP, 64, 'the room trip keeps 64 (control 11-18)')
  assert.equal(B.roomWellStacks(bagOf({ cobblestone: 64, dirt: 64 * 30 }), { need: 8, freeSlots: 0 }).slots, 0, '64 cobble: nothing above the keep')
  assert.deepEqual(B.roomWellStacks(bagOf({ cobblestone: 150, dirt: 64 * 30 }), { need: 8, freeSlots: 0 }).stacks.map(x => x.count), [22, 64], '150: all but 64 (whole stacks)')
  // the room already there: nothing
  assert.equal(B.roomWellStacks(bag, { need: 8, freeSlots: 8 }).slots, 0)
  // the bank's slots count first (plus)
  assert.equal(B.roomWellStacks(bag, { need: 8, freeSlots: 1, plus: 3 }).slots, 4)
  // at most nine stacks a trip
  assert.ok(B.roomWellStacks(bagOf({ cobblestone: 64 * 30 }), { need: 30, freeSlots: 0 }).slots <= B.ROOM_WELL_MAX_STACKS)
})
await t('roomWellStacks: a kind the yard can take a stack of is the yard\'s, never the well\'s; a yardRoom that throws holds the kind', () => {
  const bag = bagOf(IRIS)
  const r = B.roomWellStacks(bag, { need: 8, freeSlots: 0, yardRoom: n => (n === 'cobblestone' ? 64 : 0) })
  assert.ok(r.stacks.every(s => s.name === 'cobbled_deepslate'), 'the yard has room for cobblestone: only deepslate goes')
  assert.equal(B.roomWellStacks(bag, { need: 8, freeSlots: 0, yardRoom: () => { throw new Error('x') } }).slots, 0)
})
await t('roomRoute: the bank alone when it reaches the room; else the well when alive and bank + well reach it; else none', () => {
  assert.equal(B.roomRoute({ need: 8, freeSlots: 1, bankSlots: 7 }), 'bank')
  assert.equal(B.roomRoute({ need: 8, freeSlots: 1, bankSlots: 1, wellSlots: 6, wellOk: true }), 'well')
  assert.equal(B.roomRoute({ need: 8, freeSlots: 1, bankSlots: 1, wellSlots: 6, wellOk: false }), null, 'a dead well: no remedy')
  assert.equal(B.roomRoute({ need: 8, freeSlots: 1, bankSlots: 1, wellSlots: 5, wellOk: true }), null, 'short: no remedy (never a trip that cannot reach the room)')
  assert.equal(B.roomRoute({ need: 8, freeSlots: 8 }), null, 'room already')
})
await t('wellAlive: a dead or unreachable well rests BUILDFIRST.wellRestMs for this bot; other stops never', () => {
  const rest = B.BUILDFIRST.wellRestMs
  for (const stop of ['unreachable', 'no_well', 'breached', 'short']) {
    assert.equal(B.wellAlive({ stop, at: NOW }, NOW + rest - 1), false, stop)
    assert.equal(B.wellAlive({ stop, at: NOW }, NOW + rest), true, `${stop} rests, then asks again`)
  }
  assert.equal(B.wellAlive({ stop: 'player_near', at: NOW }, NOW + 1), true)
  assert.equal(B.wellAlive(null, NOW), true)
})
await t('idleBuild: a building order goes first, BUILDFIRST.run in a row, then one grounds turn; a grounds or fallback order is never a building', () => {
  const bld = { skill: 'build_shop', args: {} }
  let run = 0; const seq = []
  for (let i = 0; i < 6; i++) { const d = B.idleBuild({ on: true, run, look: () => bld }); run = d.run; seq.push(d.order ? 'B' : 'G') }
  assert.equal(seq.join(''), 'BBGBBG', 'the clean-up keeps one idle order in three')
  for (const o of [null, { skill: 'build_shop', args: { grounds: true, why: 'idle' } }, { skill: 'build_shop', args: { plot: 'tidy', why: 'room_fallback' } }, { skill: 'build_shop', args: { expedition: true } }, { skill: 'anvil_apply', args: {} }]) {
    assert.equal(B.idleBuild({ on: true, run: 0, look: () => o }).order, null, JSON.stringify(o))
  }
  assert.equal(B.idleBuild({ on: true, run: 0, look: () => ({ skill: 'build_shop', args: { roomWell: true, plot: 'civicM', need: 8 } }) }).why, 'building', 'the room trip is the building\'s')
  assert.equal(B.idleBuild({ on: false, run: 0, look: () => bld }).order, null)
})

// ------------------------------------------------------------------------------------------------- THE COMPOSED CHAIN
// One bot through the real picker and order. The town: a complete house whose reroof reads damaged (a REPAIR, first in the order:
// the LIVE house1 g3) and two open landmarks. `world` says what a building visit can do: `workable` cells place, else stuck_on_cell.
const LIST = [{ plot: 'house1' }, { plot: 'civicM' }, { plot: 'civicH' }, { plot: 'tidy' }]
function town ({ house = 'repair', civics = 'open' } = {}) {
  return [
    house === 'repair' ? { plot: 'house1', exists: true, complete: true, damaged: true, broken: true } : { plot: 'house1', exists: true, complete: true, damaged: false },
    { plot: 'civicM', exists: true, complete: civics === 'done', damaged: false },
    { plot: 'civicH', exists: true, complete: civics === 'done', damaged: false },
    { plot: 'tidy', exists: true, complete: false, damaged: false },
  ]
}
/** A bot: its bag, its holds (noteWait's map), its last own stop, the well's state and the yard's room. */
function botOf ({ items = bagOf(IRIS), wellOk = true, yardRoom = () => 0, workable = { house1: false, civicM: true, civicH: true } } = {}) {
  return { items, mem: new Map(), view: new Map(), last: null, wellOk, yardRoom, workable, placed: {}, thrown: 0, holds: [], wellTrips: 0, grounds: 0, visits: [] }
}
const free = b => 36 - b.items.length
/** One idle decision and what it runs, through the real shop.mjs; -> what happened. */
function step (b, now, house = 'repair', civics = 'open') {
  const states = town({ house, civics })
  // projturn's own marks (the bot's last stuck stop holds that plot: turnHold), then the room / waiting holds (waitBackoff)
  const hold = PT.turnHold(b.last, now)
  const marked = S.waitBackoff(PT.turnBackoff(states, b.view, { me: 'TestBot', now, exempt: p => p === 'tidy', hold }), b.mem, now)
  const pick = S.activeProject(marked, LIST)
  S.setWaitNow(plot => S.waitHeld(b.mem, plot, now))
  S.setTurnNow({ stuckPlot: () => (hold?.plot ?? null), backedOff: () => false })
  S.setRoomHold((plot, at) => { S.noteWait(b.mem, plot, { stop: 'room' }, at); b.holds.push(plot) })
  S.setRoomAsk(({ freeSlots, plot, need }) => {
    const w = B.roomWellStacks(b.items, { need, freeSlots, yardRoom: b.yardRoom })
    const route = B.roomRoute({ need, freeSlots, bankSlots: 0, yardSlots: B.roomYardSlots(b.items, { yardRoom: b.yardRoom }), wellSlots: w.slots, wellOk: b.wellOk })
    return route === 'well' ? { order: { skill: 'build_shop', args: { roomWell: true, plot, need } } } : route === 'yard' ? { order: { skill: 'build_shop', args: { roomYard: true, plot, need } } } : null
  })
  const st = marked.find(s => s.plot === pick.plot)
  // the look is for a BUILDING: a pick that takes no turn (the grounds' lanes, upkeep, the sinks) is the grounds' own, never the look's
  const look = () => S.turnExempt(pick.plot) ? null : S.buildOrder({ on: true, shared: true, atTown: true, planned: true, now, state: b.last ? { lastStop: b.last.stop, lastAt: b.last.at } : {},
    record: { plot: pick.plot, structure_complete: !!st?.complete }, complete: !!(st?.complete && !st?.damaged), freeSlots: free(b), cooldown: false, fall: false, look: true }).order
  const d = B.idleBuild({ on: true, run: b.run ?? 0, look })
  b.run = d.run
  if (!d.order) { b.grounds++; return { kind: 'grounds', pick: pick.plot, why: d.why } }
  // THE VISIT: a yard trip (whole stacks onto the piles, 128 a visit, within the yard's room), or a well trip (whole stacks off the
  // bag), then the build when the room is there
  if (d.order.args.roomYard) {
    b.yardTrips = (b.yardTrips ?? 0) + 1
    let budget = 128, left = famOf(b.items)
    for (const it of [...b.items].filter(i => B.ROOM_WELL_NAMES.includes(i.name)).sort((x, y) => x.count - y.count)) {
      const room = b.yardRoom(it.name)
      if (room < 64 || it.count > budget || it.count > room || left - it.count < B.ROOM_WELL_KEEP) continue
      b.items = b.items.filter(i => i !== it); budget -= it.count; left -= it.count; b.yardTaken = (b.yardTaken ?? 0) + it.count
      const rest = b.yardRoom; const name = it.name, c = it.count; b.yardRoom = n => (n === name ? Math.max(0, rest(n) - c) : rest(n))
    }
    if (free(b) < d.order.args.need) { S.noteWait(b.mem, pick.plot, { stop: 'room' }, now); b.holds.push(pick.plot); return { kind: 'room_short', pick: pick.plot } }
  }
  if (d.order.args.roomWell) {
    b.wellTrips++
    const w = B.roomWellStacks(b.items, { need: d.order.args.need, freeSlots: free(b), yardRoom: b.yardRoom })
    const gone = new Set(w.stacks.map(s => s.slot))
    b.thrown += w.stacks.reduce((s, x) => s + x.count, 0)
    b.items = b.items.filter(i => !gone.has(i.slot))
    if (free(b) < d.order.args.need) { S.noteWait(b.mem, pick.plot, { stop: 'room' }, now); b.holds.push(pick.plot); return { kind: 'room_short', pick: pick.plot } }
  }
  b.visits.push(pick.plot)
  // projturn's own count (turnAfter's shape, kept in the sim's view): a visit start, and a no-progress REPAIR counted on its own
  const e = { n: 0, noAt: null, rn: 0, rnoAt: null, ...(b.view.get(pick.plot) ?? {}), at: now }
  if (!b.workable[pick.plot] && st?.complete) { e.rn++; e.rnoAt = now } else if (!b.workable[pick.plot]) { e.n++; e.noAt = now }
  b.view.set(pick.plot, e)
  if (b.workable[pick.plot]) { b.placed[pick.plot] = (b.placed[pick.plot] ?? 0) + 12; b.last = { plot: pick.plot, stop: 'deadline', at: now }; S.noteWait(b.mem, pick.plot, { status: 'success', stop: 'deadline' }, now); return { kind: 'built', pick: pick.plot } }
  b.last = { plot: pick.plot, stop: 'stuck_on_cell', at: now }
  return { kind: 'stuck', pick: pick.plot }
}
const reset = () => { S.setRoomAsk(null); S.setRoomHold(null); S.setTurnNow(null); S.setWaitNow(() => null) }

await t('THE CHAIN: a bot at 36/36, an open landmark -> refused for room -> the WELL TRIP -> the building visit -> blocks placed; the family keeps 128', () => {
  try {
    const b = botOf()
    const fam0 = famOf(b.items)
    const r = step(b, NOW, 'complete')
    assert.equal(r.kind, 'built'); assert.equal(r.pick, 'civicM')
    assert.equal(b.wellTrips, 1); assert.ok(free(b) >= 8, `${free(b)} free after the trip`)
    assert.ok(b.placed.civicM > 0, 'blocks placed on the landmark')
    assert.ok(famOf(b.items) >= B.ROOM_WELL_KEEP, 'the yard keep stays in the bag')
    assert.ok(fam0 - famOf(b.items) === b.thrown && b.thrown <= 8 * 64, 'only the room\'s stacks went')
    for (const n of ['iron_axe', 'stone_pickaxe', 'stone_hoe', 'shears', 'spruce_log', 'wheat_seeds', 'sugar_cane', 'chest', 'bucket']) assert.ok(b.items.some(i => i.name === n), `${n} kept`)
  } finally { reset() }
})
await t('THE CHAIN, a repair whose cells are all unworkable (LIVE house1): one visit, stuck_on_cell, then projturn\'s hold steps it aside and the landmark is built -- it never eats the turn', () => {
  try {
    const b = botOf({ items: bagOf({ cobblestone: 128, iron_pickaxe: 1 }) })   // room enough: the chain past the room
    const seq = Array.from({ length: 8 }, (_, i) => step(b, NOW + i * 3 * MIN))
    // buildfirst: the unfinished landmarks go ahead of the repair -- the unworkable repair is never the pick while they have work
    assert.equal(seq[0].pick, 'civicM')
    assert.equal(seq.filter(r => r.pick === 'house1').length, 0, JSON.stringify(seq))
    assert.ok((b.placed.civicM ?? 0) + (b.placed.civicH ?? 0) > 0)
    // every building unworkable: each is visited once, backs off (projturn: no progress), and the bot goes to the grounds -- no loop
    const c = botOf({ items: bagOf({ cobblestone: 128, iron_pickaxe: 1 }), workable: { house1: false, civicM: false, civicH: false } })
    const seq2 = Array.from({ length: 8 }, (_, i) => step(c, NOW + i * 3 * MIN))
    for (const p of ['house1', 'civicM', 'civicH']) assert.ok(seq2.filter(r => r.pick === p && r.kind === 'stuck').length <= 1, `${p}: ${JSON.stringify(seq2)}`)
    assert.ok(seq2.slice(-3).every(r => r.kind === 'grounds'), JSON.stringify(seq2))
  } finally { reset() }
})
await t('DEAD END, the well dead or unreachable: no trip, the pick is HELD 10 min, the next pick is tried, every building held -> the grounds; no loop, then asked again', () => {
  try {
    const b = botOf({ wellOk: false })
    const seq = [0, 1, 2, 3].map(i => step(b, NOW + i * MIN, 'complete'))
    assert.equal(b.wellTrips, 0)
    assert.deepEqual([...new Set(b.holds)].sort(), ['civicH', 'civicM'], 'each building held once, in turn')
    assert.equal(b.holds.length, 2, 'never re-held inside its hold (no loop of refusals)')
    assert.ok(seq.every(r => r.kind === 'grounds'), JSON.stringify(seq))
    // the hold ends: the building is asked again (and held again while the well stays dead)
    step(b, NOW + B.BUILDFIRST.holdMs + 5 * MIN, 'complete')
    assert.ok(b.holds.length > 2)
  } finally { reset() }
})
await t('THE YARD FIRST: while the piles have room the trip is the YARD\'s (128 a visit), never the well\'s; when they fill, the well takes over and the landmark is built', () => {
  try {
    const b = botOf({ yardRoom: n => (n === 'cobblestone' ? 300 : 0) })
    const seq = Array.from({ length: 8 }, (_, i) => step(b, NOW + i * (B.BUILDFIRST.holdMs + MIN), 'complete'))
    assert.ok(b.yardTrips >= 1, JSON.stringify(seq))
    assert.ok(b.yardTaken <= 300, 'never more than the yard\'s room')
    assert.ok(b.wellTrips >= 1, 'the yard full of cobblestone: the well takes the deepslate it cannot')
    assert.ok(b.placed.civicM > 0 || b.placed.civicH > 0, JSON.stringify(seq))
  } finally { reset() }
})
await t('roomYardSlots / roomRoute: the yard before the well; nothing above the keep or no yard room: no yard leg', () => {
  const bag = bagOf(IRIS)
  assert.equal(B.roomYardSlots(bag, { yardRoom: () => 0 }), 0)
  assert.equal(B.roomYardSlots(bag, { yardRoom: () => 1000, visitMax: 128 }), 3, 'whole stacks within one visit\'s 128 (24 + 40 + 64)')
  assert.equal(B.roomYardSlots(bagOf({ cobblestone: 64 }), { yardRoom: () => 1000 }), 0, 'the keep')
  assert.equal(B.roomRoute({ need: 8, freeSlots: 0, yardSlots: 2, wellSlots: 8, wellOk: true }), 'yard')
  assert.equal(B.roomRoute({ need: 8, freeSlots: 0, yardSlots: 0, wellSlots: 8, wellOk: true }), 'well')
})
await t('DEAD END, the trip falls short (too little of the family above the keep): never ordered -- held, the grounds', () => {
  try {
    const b = botOf({ items: bagOf({ cobblestone: 200, dirt: 64 * 33, iron_pickaxe: 1, iron_axe: 1 }) })
    const r = step(b, NOW, 'complete')
    assert.equal(b.wellTrips, 0); assert.equal(r.kind, 'grounds'); assert.ok(b.holds.includes('civicM'))
  } finally { reset() }
})
await t('THE ROOM HOLD AND PROJTURN: a held REPAIR (house1) yields to the open landmark without a repair attempt or a turn stamp being spent, and is first again when the hold ends', () => {
  try {
    const b = botOf({ wellOk: false, items: bagOf({ cobblestone: 64 * 35 }) })
    step(b, NOW, 'repair', 'done')                // the landmarks stand: house1 (the repair) is the pick, refused for room, held
    assert.equal(b.holds[0], 'house1')
    assert.equal(b.visits.length, 0, 'no visit began: turnBegin (the stamp and the repair count) was never reached')
    const states = S.waitBackoff(town({ civics: 'done' }), b.mem, NOW + MIN)
    assert.equal(S.activeProject(states, LIST).plot, 'tidy', 'held: the next pick (the grounds\' last resort here)')
    assert.equal(S.activeProject(S.waitBackoff(town({ civics: 'done' }), b.mem, NOW + B.BUILDFIRST.holdMs + 1), LIST).plot, 'house1', 'the hold ends: the repair is first again')
  } finally { reset() }
})
await t('THE CLEAN-UP NEVER STARVES: with buildings workable and room, one idle order in three is the grounds', () => {
  try {
    const b = botOf({ items: bagOf({ cobblestone: 128, iron_pickaxe: 1 }), workable: { house1: true, civicM: true, civicH: true } })
    const seq = Array.from({ length: 9 }, (_, i) => step(b, NOW + i * 5 * MIN, 'complete').kind)
    assert.equal(seq.filter(k => k === 'grounds').length, 3, seq.join(','))
  } finally { reset() }
})

await t('Codex r1 BLOCKER 1: a ROOM hold steps an UNSITED pick aside too (the next building is picked); other holds keep their shape', () => {
  const mem = new Map()
  S.noteWait(mem, 'civicM', { stop: 'room' }, NOW)
  const states = [{ plot: 'civicM', exists: false, complete: false }, { plot: 'civicH', exists: true, complete: false }]
  assert.equal(S.activeProject(S.waitBackoff(states, mem, NOW + 1), [{ plot: 'civicM' }, { plot: 'civicH' }]).plot, 'civicH')
  const leaf = new Map(); S.noteWait(leaf, 'civicM', { stop: 'leaf_decay' }, NOW)
  assert.equal(S.waitBackoff(states, leaf, NOW + 1)[0], states[0], 'a leaf hold on an unsited record: as before')
})

await t('Codex r2 BLOCKER 1: the idle look tells the room ask it is a look (the ask stamps nothing; the visit does)', () => {
  let seen = null
  try {
    S.setRoomAsk(a => { seen = { ...a, look: S.roomLookNow() }; return null })
    S.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: NOW, state: {}, record: { plot: 'civicM' }, freeSlots: 1, cooldown: false, fall: false, look: true })
    assert.equal(seen?.look, true)
    S.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: NOW, state: {}, record: { plot: 'civicM' }, freeSlots: 1 })
    assert.equal(seen?.look, false, 'the order itself: as before')
  } finally { reset() }
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  for (const line of ["const kept = new Set(hubCargoKeeps(bot) ?? [])", "roomWellStacks((bot.inventory?.items?.() ?? []).filter(it => !kept.has(it?.name)),", "bot.yardsMemo = null; try { bot.whRoomMemo?.clear?.() }", 'if (roomLookNow()) return null', "if (!look) roomStamp(bot, now)", 'bot.roomBankAt = t0', 'if (acc.roomCheck) { let ok = false; try { ok = acc.roomCheck(st.slot) } catch { ok = false } if (!ok) continue }',
    "if (roomPlanOf && !pit) out.acc.roomCheck = slot => { bot.yardsMemo = null;"]) assert.ok(src.includes(line), line)
})
await t('Codex r2 BLOCKER 2: a stack the plan no longer names (the yard freed room, or the room is there) is not thrown', () => {
  const bag = bagOf({ cobblestone: 64 * 8, cobbled_deepslate: 64 * 4, dirt: 64 * 24 })
  const first = B.roomWellStacks(bag, { need: 8, freeSlots: 0 }).stacks
  assert.ok(first.some(x => x.name === 'cobblestone'))
  const later = B.roomWellStacks(bag, { need: 8, freeSlots: 0, yardRoom: n => (n === 'cobblestone' ? 128 : 0) }).stacks
  assert.ok(later.every(x => x.name !== 'cobblestone'), 'the click-time plan drops the yard\'s kind')
})

await t('Codex r9 BLOCKER: the room remedy\'s own rate limit is "not now" -- a skip with NO room hold (the retry is not outlasted)', () => {
  const mem = new Map()
  try {
    S.setRoomHold((plot, at) => S.noteWait(mem, plot, { stop: 'room' }, at))
    S.setRoomAsk(() => ({ cooldown: true }))
    const r = S.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: NOW, state: {}, record: { plot: 'civicM' }, freeSlots: 1, cooldown: false, fall: false, look: true })
    assert.deepEqual(r, { order: null, skip: 'room' }); assert.equal(mem.size, 0)
    S.setRoomAsk(() => null)
    S.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: NOW, state: {}, record: { plot: 'civicM' }, freeSlots: 1, cooldown: false, fall: false, look: true })
    assert.equal(mem.size, 1, 'no remedy at all: the hold, as before')
  } finally { reset() }
})

await t('PICK ORDER: an UNFINISHED building (turn marks, a slot, not backed off) goes ahead of a repair; backed off or held, the repair is next', () => {
  const marked = PT.turnBackoff(town(), null, { me: 'TestBot', now: NOW, exempt: p => p === 'tidy' })
  assert.equal(S.activeProject(marked, LIST).plot, 'civicM', 'the landmark before house1\'s repair')
  const off = marked.map(st => (st.plot.startsWith('civic') ? { ...st, free: false, backoff: true } : st))
  assert.equal(S.activeProject(off, LIST).plot, 'house1', 'both landmarks backed off: the repair')
  assert.equal(S.activeProject(town(), LIST).plot, 'house1', 'no turn marks (PROJTURN off): the order as before')
})
await t('Codex r14 BLOCKER 2: the bot\'s sink turn keeps its place ahead of the building tier', () => {
  const L = [...LIST.slice(0, 3), { plot: 'road', sink: true }, LIST[3]]
  const marked = PT.turnBackoff([...town(), { plot: 'road', sink: true, sinkOpen: true }], null, { me: 'TestBot', now: NOW, exempt: p => p === 'tidy' || p === 'road' })
  assert.equal(S.activeProject(marked, L, { sinkTurn: true }).plot, 'house1', 'the sink turn: the order as before (repairs, then the sink)')
  assert.equal(S.activeProject(marked.map(x => (x.plot === 'house1' ? { ...x, damaged: false } : x)), L, { sinkTurn: true }).plot, 'road')
  assert.equal(S.activeProject(marked, L, { sinkTurn: false }).plot, 'civicM')
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(src.includes('wellSlots: w.slots + (w.slots ? (w.clay ?? 0) : 0)'), 'Codex r14 BLOCKER 1: the clay rides with the route')
  assert.ok(src.includes('(Math.ceil((blocks0 + c.crafts) / 64) - Math.ceil(blocks0 / 64))'), 'Codex r15: the product\'s new slots are charged')
})
await t('Codex r16 BLOCKER: the keeper\'s order (a grounds lane at the head of its list) keeps its place ahead of the building tier', () => {
  const K = [{ plot: 'tidy' }, ...LIST.slice(0, 3)]
  const marked = PT.turnBackoff(town(), null, { me: 'TestBot', now: NOW, exempt: p => p === 'tidy' })
  assert.equal(S.activeProject(marked, K).plot, 'house1', 'the keeper\'s list: the building tier stands aside (repairs first, as before)')
  assert.notEqual(S.activeProject(marked, K).plot, 'civicM')
  assert.equal(S.activeProject(marked, LIST).plot, 'civicM', 'any other bot: the building first')
})
await t('A REPAIR WITH 3 NO-PROGRESS VISITS backs off as a stuck project (its stuck window), not the finished record\'s 60 minutes', () => {
  const st = [{ plot: 'house1', exists: true, complete: true, damaged: true, broken: true }]
  const view = n => new Map([['house1', { at: NOW, n: 0, noAt: null, rn: n, rnoAt: NOW }]])
  const off = (n, dt) => PT.turnBackoff(st, view(n), { me: 'TestBot', now: NOW + dt, capOf: () => 6 * 60 * MIN })[0].backoff === true
  assert.equal(off(2, 61 * MIN), false, 'two: the 60-minute cap of a finished record')
  assert.equal(off(3, 61 * MIN), true, 'three: past the hour, still backed off (80 min and up)')
  assert.equal(off(5, 5 * 60 * MIN), true, 'five: the 6-hour stuck window')
  assert.equal(PT.REPAIR_STUCK_N, 3)
})
await t('CLAY: four balls a block -- the slots it frees (the product needs one free slot, the caller\'s)', () => {
  assert.equal(B.claySlotsSaved(228), 3, '228 balls (4 slots) -> 57 blocks (1)')
  assert.equal(B.claySlotsSaved(64), 0, 'one slot of balls -> one of blocks')
  assert.equal(B.claySlotsSaved(130), 1, '130 (3 slots) -> 32 blocks + 2 balls (2)')
  assert.equal(B.claySlotsSaved(3), 0)
})
await t('A CAP_UNKNOWN-HELD BOT RETRIES WHEN THE COUNT FRESHENS: the hold ends, the route is read again and the trip is ordered', () => {
  try {
    const b = botOf()
    b.wellOk = false                              // the cap unknown: the well leg offers nothing (roomWellPlanNow cap_unknown)
    step(b, NOW, 'complete')
    assert.ok(b.holds.includes('civicM') && b.wellTrips === 0)
    b.wellOk = true                               // the count freshens (a recount, a deposit's observation)
    const r = step(b, NOW + B.BUILDFIRST.holdMs + MIN, 'complete')
    assert.equal(b.wellTrips, 1, JSON.stringify(r)); assert.equal(r.kind, 'built')
  } finally { reset() }
})

// ------------------------------------------------------------------------------------------------- the steer
await t('crewSteer: an idle bot at the surface is given the building order AS IS (kind build); the grounds as before without one', () => {
  const base = { on: true, y: 70, lineY: 55, upLineY: 62, roofed: false, distHome: 10, now: NOW, state: {}, force: true }
  const bld = MC.crewSteer({ ...base, grounds: () => ({ ok: true, why: 'building', order: { skill: 'build_shop', args: { roomWell: true, plot: 'civicM', need: 8 } } }) })
  assert.equal(bld.kind, 'build'); assert.deepEqual(bld.order.args, { roomWell: true, plot: 'civicM', need: 8 })
  const g = MC.crewSteer({ ...base, grounds: () => ({ ok: true, why: 'ok' }) })
  assert.equal(g.kind, 'grounds'); assert.deepEqual(g.order.args, { grounds: true, why: 'idle' })
  // a building visit is no grounds visit for the steer's empty-visit back-off
  assert.deepEqual(MC.steerAfter({ idleN: 1 }, { kind: 'build', worked: false, now: NOW }), { idleN: 1 })
})

// ------------------------------------------------------------------------------------------------- mutants
await t('MUTANT KILLED: the room hold never written (the same refused pick for every bot, every cooldown)', async () => {
  await withMutant(SHOP_PATH, "    if (roomHoldOf && plot) { try { roomHoldOf(plot, now) } catch { /* bookkeeping */ } }\n", '', async m => {
    const mem = new Map()
    m.setRoomHold((plot, at) => m.noteWait(mem, plot, { stop: 'room' }, at))
    m.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: NOW, state: {}, record: { plot: 'civicM' }, freeSlots: 1, fall: false })
    assert.equal(mem.size, 0, 'killed')
    m.setRoomHold(null)
  })
})
await t('MUTANT KILLED: the look keeps the order\'s clock (an idle bot is never sent within 10 minutes of its last visit)', async () => {
  await withMutant(SHOP_PATH, '  if (cooldown && now - (state.lastAt ?? -Infinity) < orderCooldown(plot0)) return { order: null, skip: null }', '  if (now - (state.lastAt ?? -Infinity) < orderCooldown(plot0)) return { order: null, skip: null }', async m => {
    const r = m.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: NOW, state: { lastAt: NOW - MIN }, record: { plot: 'civicM' }, freeSlots: 20, cooldown: false, fall: false })
    assert.equal(r.order, null, 'killed')
  })
})
await t('MUTANT KILLED: the well trip ignores the yard keep', async () => {
  await withMutant(BF_PATH, '    if (left - it.count < keep) continue\n', '', async m => {
    assert.ok(famOf(bagOf({ cobblestone: 200 })) - m.roomWellStacks(bagOf({ cobblestone: 200 }), { need: 8, freeSlots: 0 }).stacks.reduce((s, x) => s + x.count, 0) < 128, 'killed')
  })
})
await t('MUTANT KILLED: the clean-up turn dropped (buildings take every idle order)', async () => {
  await withMutant(BF_PATH, "  if ((Number(run) || 0) >= B.run) return { order: null, why: 'grounds_turn', run: 0 }\n", '', async m => {
    let run = 0, g = 0
    for (let i = 0; i < 9; i++) { const d = m.idleBuild({ on: true, run, look: () => ({ skill: 'build_shop', args: {} }) }); run = d.run; if (!d.order) g++ }
    assert.equal(g, 0, 'killed')
  })
})
await t('MUTANT KILLED: the steer ignores the building order', async () => {
  await withMutant(MC_PATH, "  if (g.order?.skill === 'build_shop' && g.order.args?.grounds !== true) return", '  if (false) return', async m => {
    const d = m.crewSteer({ on: true, y: 70, lineY: 55, upLineY: 62, roofed: false, distHome: 10, now: NOW, state: {}, force: true, grounds: () => ({ ok: true, order: { skill: 'build_shop', args: {} } }) })
    assert.equal(d.kind, 'grounds', 'killed')
  })
})

// ------------------------------------------------------------------------------------------------- wiring (structural)
await t('WIRED: the room ask routes to the well trip, the dispatch reaches it, the throw uses the room plan, the hold is installed, the idle ask looks first', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  for (const line of [
    "if (r.route === 'well') {",
    "if (r.route === 'yard') {",
    'yardRoom: n => roomYardRoomNow(bot, n, now), visitMax: LANES.visitMax',
    "try { r = await buildShopVisit(ctx, {}, signal) } catch (e) { if (e?.aborted || signal?.aborted) book({ status: 'aborted', stop: 'aborted' }); throw e }",
    'book(r)',
    "if (stop === 'player_near' || stop === 'well_busy') { bot.roomBankAt = Date.now() - ROOM_BANK_EVERY_MS + ROOM_WELL_NEAR_RETRY_MS;",
    "if (ROOM_BUSY_STOPS.includes(String(stop)) && used() >= slotsBefore) { bot.roomBankAt = Date.now() - ROOM_BANK_EVERY_MS + ROOM_WELL_NEAR_RETRY_MS;",
    'for (let leg = 0; leg < ROOM_YARD_LEGS; leg++) {',
    "{ const cap = cobbleWellCap(bot); if (cap !== 'at_cap') return { stacks: [], slots: 0, why: `cap_${cap}` } }",
    "if (acc.capLast !== 'at_cap') continue",
    'if (args?.roomYard === true && BUILDFIRST.on) return roomYardVisit(ctx, args, signal)',
    "const ryPick = roomFallbackPick(b?.roomYardMark ?? null, now, !!b?.shopVisitBusy) ? list.find(p => p.plot === YARD_PLOT) ?? null : null",
    'if (args?.roomWell === true && BUILDFIRST.on) return roomWellVisit(ctx, args, signal)',
    'if (roomPlanOf && !pit) { const rp = roomPlanOf(bagNow); plan.stacks = rp.stacks; plan.stone = null; plan.junkStacks = rp.junkStacks }',
    'if (BUILDFIRST.on) setRoomHold((plot, now) => roomHoldNote(sbBot, plot, now))',
    "const d = idleBuild({ run: bot.bfRun ?? 0, look: () => idleBuildLook(bot, now) })",
    "if (d.order) return { ok: true, why: 'building', order: d.order }",
    'cooldown: false, fall: false, look: true',
    'if (shopBuildIdle({ complete, record: rec, lastStop: st.lastStop })) { bot.bfLookWhy =',
    "kind: 'room_well'",
  ]) assert.equal(src.split(line).length, 2, `missing or not unique: ${line}`)
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')
