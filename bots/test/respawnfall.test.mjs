// RESPAWNFALL-01 (docs/reports/respawnfall-01-design-2026-10-24.md): a bot that (re)spawns on a high platform climbs down by
// rideFloorDown from the cheapest reachable column, or -- carrying too few blocks -- stays, held, and raises `_needs_rescue`.
//
// Behaviour only: the pure rule (respawnfall.mjs) on worlds shaped like isolated-a's platform (a 1-block-thick cobblestone
// deck over open air down to ground whose top is y=72, and a gappy pillar), the order's decision, the escape-lattice gate,
// and the REAL skill (skills.mjs skyDescend, which runs the REAL rideFloorDown) on a fake bot whose physics is the one rule
// that matters here: when the block under its feet is broken it falls to the next solid. Mutants are anchored (present and
// unique) and each asserts the behaviour the mutation breaks.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Vec3 } from 'vec3'
process.env.OLLAMA_MODEL ??= 'test'
process.env.LOG_DIR ??= mkdtempSync(join(tmpdir(), 'respawnfall-test-'))
const RF = await import('../src/respawnfall.mjs')
const SK = await import('../src/skills.mjs')
const RF_URL = new URL('../src/respawnfall.mjs', import.meta.url)
const SK_URL = new URL('../src/skills.mjs', import.meta.url)
const { elevation, columnUnder, columnReader, supportOf, doneAt, descendOrder, stayRefusal, respawnfallOn, respawnfallModeDetail, descentCost,
  descentDone, rankStarts, cheapestStart, skyEscapeBlocked, fullCube, regionAt, ELEVATED_MIN, SAFE_DROP, SPAWN_WINDOW_MS, MARGIN, SAVE_MIN, START_RADIUS, EDGE_SIDES } = RF

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const STONE = { name: 'stone', boundingBox: 'block' }, COBBLE = { name: 'cobblestone', boundingBox: 'block' }, AIR = { name: 'air', boundingBox: 'empty' }
const WATER = { name: 'water', boundingBox: 'empty' }, LAVA = { name: 'lava', boundingBox: 'empty' }
const SLAB = { name: 'cobblestone_slab', boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.5, 1]] }
const key = (x, y, z) => `${x},${y},${z}`
const GROUND_TOP = 72                                 // stone up to y=71: a body on the ground has feet at 72
/** isolated-a's shape: ground (stone) up to y=71; a cobblestone deck at deckY for x 350..360, z 145..155. */
function skyWorld ({ deckY = 180, ground = 71, under = null } = {}) {
  const m = new Map()
  const at = (x, y, z) => {
    const k = key(x, y, z)
    if (m.has(k)) return m.get(k)
    if (y === deckY && x >= 350 && x <= 360 && z >= 145 && z <= 155) return COBBLE
    if (under && y === ground + 1) return under
    if (y <= ground) return STONE
    return AIR
  }
  return { m, at }
}
/** isolated-a's pillar at (354,148): solid from the ground to the deck, with gaps (the backup's column has 44 of 88 cells). */
const PILLAR_GAPS = [120, 121, 122, 140]
function pillarWorld ({ deckY = 180, gaps = PILLAR_GAPS, lavaAt = null } = {}) {
  const w = skyWorld({ deckY })
  for (let y = GROUND_TOP; y < deckY; y++) if (!gaps.includes(y)) w.m.set(key(354, y, 148), COBBLE)
  if (lavaAt != null) w.m.set(key(354, lavaAt, 148), LAVA)
  return w
}
const ON_DECK = { x: 355.5, y: 181, z: 150.5 }
const feetAboveGround = bot => bot.entity.position.y - GROUND_TOP

// ---------------------------------------------------------------- the trigger
await ta('elevation: the deck at y=180 over open air to the ground is elevated (108 open onto solid); supportOf reads a slab', () => {
  const e = elevation({ pos: ON_DECK, at: skyWorld().at })
  assert.equal(e.elevated, true); assert.equal(e.open, 108); assert.equal(e.landing, 'solid')
  assert.deepEqual(supportOf(ON_DECK), { x: 355, y: 180, z: 150 })
  assert.deepEqual(supportOf({ x: 355.5, y: 180.5, z: 150.5 }), { x: 355, y: 180, z: 150 }, 'a bottom slab at 180 is the support')
  assert.equal(fullCube(SLAB), false); assert.equal(fullCube(COBBLE), true); assert.equal(fullCube(AIR), false)
})
await ta('elevation: ordinary ground, a 7-open ledge and a deck over a pond are NOT elevated; lava below is', () => {
  assert.equal(elevation({ pos: { x: 355.5, y: 72, z: 150.5 }, at: skyWorld().at }).elevated, false)
  const low = skyWorld({ deckY: 79 })    // 7 open cells under the deck
  assert.equal(elevation({ pos: { x: 355.5, y: 80, z: 150.5 }, at: low.at }).open, 7)
  assert.equal(elevation({ pos: { x: 355.5, y: 80, z: 150.5 }, at: low.at }).elevated, false)
  assert.equal(ELEVATED_MIN, 8); assert.equal(elevation({ pos: { x: 355.5, y: 81, z: 150.5 }, at: skyWorld({ deckY: 80 }).at }).elevated, true)
  assert.equal(elevation({ pos: ON_DECK, at: skyWorld({ under: WATER }).at }).elevated, false, 'swimming is travel: water under it and beside it')
  assert.equal(elevation({ pos: ON_DECK, at: skyWorld({ under: LAVA }).at }).elevated, true)
})
await ta('elevation: water under ONE column does not exempt deadly sides (Codex r1 P1-7)', () => {
  const w = skyWorld(); w.m.set(key(355, 72, 150), WATER)
  const e = elevation({ pos: ON_DECK, at: w.at })
  assert.equal(e.elevated, true); assert.match(e.why, /deadly drop on 4 sides/)
})
await ta('elevation: no position, in the air, no solid support and unloaded below are TRANSIENT, never a verdict', () => {
  const w = skyWorld()
  assert.equal(elevation({ pos: null, at: w.at }).transient, true)
  assert.equal(elevation({ pos: ON_DECK, at: w.at, onGround: false }).transient, true)
  assert.equal(elevation({ pos: { x: 340.5, y: 181, z: 150.5 }, at: w.at }).transient, true, 'no solid support')
  const e = elevation({ pos: ON_DECK, at: (x, y, z) => (y < 120 ? null : w.at(x, y, z)) })
  assert.equal(e.elevated, false); assert.equal(e.unknown, true); assert.equal(e.transient, true)
  const t = elevation({ pos: ON_DECK, at: (x, y, z) => { if (y < 150) throw new Error('boom'); return w.at(x, y, z) } })
  assert.equal(t.transient, true, 'a throwing reader reads as unknown')
})
await ta('elevation: a natural cliff top (one deadly side) and a corner (two) are NOT a platform; a lone pillar (four) is', () => {
  const cliff = (x, y, z) => (y <= 71 || (x <= 355 && y <= 90) ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 355.5, y: 91, z: 150.5 }, at: cliff }).elevated, false, 'cliff edge')
  const corner = (x, y, z) => (y <= 71 || (x <= 355 && z <= 150 && y <= 90) ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 355.5, y: 91, z: 150.5 }, at: corner }).elevated, false, 'corner')
  const spire = (x, y, z) => (y <= 71 || (x === 355 && z === 150 && y <= 90) ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 355.5, y: 91, z: 150.5 }, at: spire }).elevated, true, 'a lone pillar')
  assert.equal(EDGE_SIDES, 3)
})

// ---------------------------------------------------------------- done, the price, the starts
await ta('doneAt: a safe stance is <= SAFE_DROP-1 open under it, no deadly side and a safe exit; unreadable is unknown', () => {
  const w = skyWorld()
  const R = () => columnReader(w.at)
  // a single block in the air at y: own open y-72, sides open from y down
  const column = y => { const v = skyWorld(); v.m.set(key(300, y, 300), COBBLE); return v }
  assert.equal(doneAt(columnReader(column(74).at), 300, 74, 300).done, true, 'feet 75, ground top 72: every way off is <= 3')
  assert.equal(doneAt(columnReader(column(75).at), 300, 75, 300).done, false, 'own run 3: breaking it is a fall of 4')
  assert.equal(doneAt(R(), 355, 72 - 1, 150).done, true, 'the ground itself')
  // a pillar near the ground: own run 0, sides 6 open (stepping off is 6): no safe exit yet
  const p = pillarWorld()
  assert.equal(doneAt(columnReader(p.at), 354, 77, 148).done, false)
  assert.equal(doneAt(columnReader(p.at), 354, 74, 148).done, true)
  assert.equal(doneAt(columnReader((x, y, z) => (x === 355 ? null : w.at(x, y, z))), 354, 74, 148).unknown, true)
})
await ta('descentCost: a deck cell over the void costs its open run less SAFE_DROP-1; the pillar costs only its gaps', () => {
  const w = pillarWorld()
  const v = descentCost(w.at, { x: 357, y: 180, z: 152 })
  assert.equal(v.ok, true); assert.equal(v.cost, 108 - (SAFE_DROP - 1)); assert.equal(v.endY, GROUND_TOP + SAFE_DROP - 1)
  const p = descentCost(w.at, { x: 354, y: 180, z: 148 })
  assert.equal(p.ok, true); assert.equal(p.cost, PILLAR_GAPS.length, JSON.stringify(p)); assert.equal(p.endY, GROUND_TOP + SAFE_DROP - 1)
})
await ta('descentCost: lava, an unloaded cell, or a support it cannot break is never priced', () => {
  assert.match(descentCost(pillarWorld({ lavaAt: 100 }).at, { x: 354, y: 180, z: 148 }).why, /lava under the column/)
  const w = pillarWorld()
  assert.equal(descentCost((x, y, z) => (y < 130 ? null : w.at(x, y, z)), { x: 354, y: 180, z: 148 }).ok, false)
  const hard = descentCost(w.at, { x: 354, y: 180, z: 148 }, { diggable: (x, y) => (y === 150 ? { ok: false, why: 'cannot break obsidian at y=150 with what it carries' } : { ok: true }) })
  assert.equal(hard.ok, false); assert.match(hard.why, /obsidian/)
})
await ta('rankStarts: from spawn the reachable pillar wins; an unreachable one does not; a failed walk is excluded; a slab is not a stance', () => {
  const w = pillarWorld()
  const b = cheapestStart({ at: w.at, support: { x: 355, y: 180, z: 150 } })
  assert.deepEqual(b.cell, { x: 354, y: 180, z: 148 }); assert.equal(b.cost, PILLAR_GAPS.length); assert.equal(b.own, false)
  assert.equal(cheapestStart({ at: skyWorld().at, support: { x: 355, y: 180, z: 150 } }).own, true, 'no pillar: no walk for nothing')
  // UNREACHABLE: the pillar's deck cell cut off by a moat (air ring) at deck level
  const moat = pillarWorld(); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) moat.m.set(key(354 + dx, 180, 148 + dz), AIR)
  assert.equal(cheapestStart({ at: moat.at, support: { x: 355, y: 180, z: 150 } }).own, true)
  assert.equal(cheapestStart({ at: w.at, support: { x: 355, y: 180, z: 150 }, exclude: new Set(['354,180,148']) }).own, true)
  const h = pillarWorld(); h.m.set(key(354, 182, 148), COBBLE)
  assert.equal(cheapestStart({ at: h.at, support: { x: 355, y: 180, z: 150 } }).own, true, 'no headroom: not a stance')
  // the own support a slab: it is not priced; the nearest full cube is offered without the SAVE_MIN bar
  const s = skyWorld(); s.m.set(key(355, 180, 150), SLAB)
  const r = rankStarts({ at: s.at, support: { x: 355, y: 180, z: 150 } })
  assert.equal(r[0].own, false); assert.equal(r[0].dist, 1)
  assert.equal(cheapestStart({ at: w.at, support: { x: 355, y: 180, z: 150 }, radius: 1 }).own, true, 'out of radius')
  assert.equal(START_RADIUS, 8)
})
await ta('descendOrder: starts in the window; runs past it until a verified safe stance; transient keeps it open; off is off', () => {
  const el = elevation({ pos: ON_DECK, at: skyWorld().at })
  const now = 10_000_000
  const a = descendOrder({ now, lastSpawnAt: now - 1000, el })
  assert.equal(a.issue, true); assert.equal(a.state.active, true)
  assert.equal(descendOrder({ now, lastSpawnAt: now - SPAWN_WINDOW_MS - 1, el }).issue, false, 'a cave shelf long after a spawn is not this rule')
  assert.equal(descendOrder({ now, lastSpawnAt: null, el }).issue, false)
  const mid = { elevated: false, why: 'only 5 open below' }
  const b = descendOrder({ now: now + SPAWN_WINDOW_MS * 2, el: mid, done: { done: false, why: '5 open below' }, state: a.state })
  assert.equal(b.issue, true, 'not elevated by the trigger, but not done: the episode runs on'); assert.equal(b.state.active, true)
  const t = descendOrder({ now, el: { elevated: false, transient: true, why: 'not on the ground' }, done: null, state: a.state })
  assert.equal(t.issue, true); assert.equal(t.state.active, true); assert.match(t.why, /waiting/)
  const d = descendOrder({ now, el: { elevated: false, why: 'only 2 open below' }, done: { done: true }, state: a.state })
  assert.equal(d.issue, false); assert.equal(d.state.active, false, 'down: the episode ends')
  assert.equal(descendOrder({ now, el: { elevated: false, transient: true, why: 'x' }, done: { done: true }, state: a.state }).state.active, true, 'never ends on a transient reading')
  assert.equal(descendOrder({ now, lastSpawnAt: now - 1000, el, on: false }).issue, false)
})
await ta('the escape lattice stands aside while held or while an episode is open; nothing else', () => {
  assert.equal(skyEscapeBlocked({ skyHoldUntil: Date.now() + 1000 }), true)
  assert.equal(skyEscapeBlocked({ skyActive: true }), true)
  assert.equal(skyEscapeBlocked({ skyHoldUntil: Date.now() - 1, skyActive: false }), false)
  assert.equal(skyEscapeBlocked({}), false); assert.equal(skyEscapeBlocked(null), false)
})
await ta('the stay says only what is true and what happens next; the rollback is one setting', () => {
  const el = elevation({ pos: ON_DECK, at: skyWorld().at })
  const m = stayRefusal({ el, have: 10, need: 106 })
  assert.match(m, /^sky_descend: staying put -- 108 open blocks below onto solid; the cheapest column down needs 108 placeable blocks and it carries 10/)
  assert.match(m, /Held here for rescue \(_needs_rescue raised\)/); assert.doesNotMatch(m, /Pick up/)
  assert.match(stayRefusal({ el, have: 0, need: 0, why: 'lava under the column at y=90' }), /no column within 8 it can climb down \(lava under the column at y=90\)/)
  assert.equal(respawnfallOn({}), true); assert.equal(respawnfallOn({ RESPAWNFALL: '0' }), false)
  assert.match(respawnfallModeDetail({}), /^on=1 /); assert.match(respawnfallModeDetail({ RESPAWNFALL: '0' }), /^on=0 /)
})

// ---------------------------------------------------------------- the skill, on a fake bot with fall physics
function fakeBot (world, pos, { blocks = 200, placeWorks = true } = {}) {
  const items = blocks ? [{ name: 'cobblestone', count: blocks, type: 1 }] : []
  const log = { digs: 0, places: 0, gotos: [], heldDuringDig: [] }
  const bot = {
    entity: { position: new Vec3(pos.x, pos.y, pos.z), onGround: true, velocity: new Vec3(0, 0, 0) },
    blockAt: v => { const b = world.at(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)); return b ? { ...b, position: new Vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)), digTime: () => 50 } : null },
    inventory: { items: () => items.filter(i => i.count > 0) },
    heldItem: null, equip: async () => {}, entities: {},
    // the library's goal semantics: arrive at the goal cell's centre (a goal already met snaps a body > 0.2 off the centre)
    pathfinder: { goto: async g => { log.gotos.push({ x: g.x, y: g.y, z: g.z }); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5) }, setGoal () {}, stop () {} },
    _placeBlockWithOptions: async (ref, face) => {
      if (!placeWorks) return
      log.places++
      world.m.set(key(ref.position.x + face.x, ref.position.y + face.y, ref.position.z + face.z), COBBLE); if (items[0]) items[0].count--
    },
    dig: async b => {
      log.digs++; log.heldDuringDig.push(skyEscapeBlocked(bot))
      world.m.set(key(b.position.x, b.position.y, b.position.z), AIR)
      // the one law: with nothing under the feet, fall to the next solid (a straddling body stays up: the fake has no
      // footprint, so the tests that need one check the position before the dig)
      const p = bot.entity.position
      let y = Math.floor(p.y) - 1
      while (y > -64 && world.at(Math.floor(p.x), y, Math.floor(p.z)).boundingBox !== 'block') y--
      bot.entity.position = new Vec3(p.x, y + 1, p.z)
      if (items[0]) items[0].count++
    },
    stopDigging () {},
  }
  return { bot, items, log }
}
const ac = () => new AbortController().signal
const FAST = { stayMs: 50, runMs: 600_000 }

await ta('SKILL: on a deck (y=85, 13 open) with 200 cobblestone it climbs down to a safe stance, never more than 3 above the ground', async () => {
  const w = skyWorld({ deckY: 85 }); const { bot, log } = fakeBot(w, { x: 355.5, y: 86, z: 150.5 })
  const r = await SK.skyDescend({ bot }, {}, ac(), FAST)
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.match(r.detail, /^climbed down 11 blocks/)
  assert.ok(feetAboveGround(bot) <= SAFE_DROP && feetAboveGround(bot) >= 0, `ended ${bot.entity.position.y}`)
  assert.equal(descentDone(w.at, supportOf(bot.entity.position)).done, true)
  assert.ok(log.heldDuringDig.length && log.heldDuringDig.every(Boolean), 'the escape lattice was held off for every dig')
  assert.equal(bot.skyHoldUntil, 0, 'a finished descent releases the hold')
})
await ta('SKILL: over a column it rides it for free and bridges only the gap under it', async () => {
  const w = skyWorld({ deckY: 92 }); for (let y = 80; y < 92; y++) w.m.set(key(355, y, 150), COBBLE)   // a column 80..91, open 72..79
  const { bot, log } = fakeBot(w, { x: 355.5, y: 93, z: 150.5 }, { blocks: 200 })
  const r = await SK.skyDescend({ bot }, {}, ac(), FAST)
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.equal(feetAboveGround(bot), SAFE_DROP)
  assert.equal(log.places, 8 - (SAFE_DROP - 1), 'only the gap (79..72), to SAFE_DROP-1 open under the support')
})
await ta('SKILL: a FREE column needs no blocks (Codex r1 P1-4): a bare bot on a lone pillar rides it down', async () => {
  const w = skyWorld({ deckY: 0 }); for (let y = 72; y <= 84; y++) w.m.set(key(300, y, 300), COBBLE)
  const { bot } = fakeBot(w, { x: 300.5, y: 85, z: 300.5 }, { blocks: 0 })
  assert.equal(elevation({ pos: bot.entity.position, at: w.at }).elevated, true)
  const r = await SK.skyDescend({ bot }, {}, ac(), FAST)
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.ok(feetAboveGround(bot) <= SAFE_DROP)
})
await ta('SKILL: 10 blocks on the deck -- it walks (deck profile) to the reachable pillar and rides it down', async () => {
  const w = pillarWorld({ deckY: 92, gaps: [84, 85] }); const { bot, log } = fakeBot(w, { x: 355.5, y: 93, z: 150.5 }, { blocks: 10 })
  const profiles = []; bot.withDeckMovements = async fn => { profiles.push('deck'); return fn() }
  const r = await SK.skyDescend({ bot }, {}, ac(), FAST)
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.match(r.detail, /walked to 354,92,148:arrived/)
  assert.deepEqual(log.gotos[0], { x: 354, y: 93, z: 148 }); assert.equal(profiles[0], 'deck', 'the walk ran on the deck profile')
  assert.ok(feetAboveGround(bot) <= SAFE_DROP, `rode down (${bot.entity.position.y})`)
})
await ta('SKILL: a walk that never arrives excludes that column; out of tries it stays on its own (unaffordable) cell, no dig', async () => {
  const w = pillarWorld({ deckY: 92, gaps: [84, 85] }); const { bot, log } = fakeBot(w, { x: 355.5, y: 93, z: 150.5 }, { blocks: 10 })
  bot.pathfinder.goto = async g => { log.gotos.push(g) }   // never moves
  const r = await SK.skyDescend({ bot }, {}, ac(), FAST)
  assert.equal(r.failClass, 'needs_rescue', JSON.stringify(r)); assert.equal(log.digs, 0)
  assert.equal(new Set(log.gotos.map(g => `${g.x},${g.z}`)).size, log.gotos.length, 'each failed column tried once')
})
await ta('SKILL: short of blocks but carrying logs -- it crafts planks in the 2x2 grid, then climbs down', async () => {
  const w = skyWorld({ deckY: 85 }); const { bot, items } = fakeBot(w, { x: 355.5, y: 86, z: 150.5 }, { blocks: 0 })
  items.push({ name: 'oak_log', count: 10, type: 2 })
  bot.registry = { itemsByName: { oak_planks: { id: 7 } } }
  const crafts = []
  bot.recipesFor = (id, meta, n, table) => (id === 7 && table === null ? [{ id: 7 }] : [])
  bot.craft = async (recipe, n) => { crafts.push(n); items.find(i => i.name === 'oak_log').count -= n; items.unshift({ name: 'oak_planks', count: 4 * n, type: 7 }) }
  const r = await SK.skyDescend({ bot }, {}, ac(), FAST)
  const need = 13 - (SAFE_DROP - 1) + MARGIN
  assert.equal(crafts.reduce((a, b) => a + b, 0), Math.ceil((need - 10) / 3), `crafted ${crafts}`)
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.match(r.detail, /crafted planks from \d+ log/)
})
await ta('SKILL: too few blocks and no cheaper column -> it STAYS (no dig, no walk), needs_rescue, held', async () => {
  const w = skyWorld(); const { bot, log } = fakeBot(w, ON_DECK, { blocks: 10 })
  const t0 = Date.now()
  const r = await SK.skyDescend({ bot }, {}, ac(), { stayMs: 200, runMs: 600_000 })
  assert.equal(r.failClass, 'needs_rescue'); assert.match(r.detail, /staying put/); assert.match(r.detail, /Held here for rescue/)
  assert.equal(log.digs, 0); assert.equal(log.gotos.length, 0); assert.equal(bot.entity.position.y, 181)
  assert.ok(Date.now() - t0 >= 190, 'it held the body for the stay'); assert.ok(skyEscapeBlocked(bot), 'the hold reaches past the stay')
})
await ta('SKILL: a placement that never takes -> it stays and flags, never digging its floor out from under itself', async () => {
  const w = skyWorld({ deckY: 85 }); const { bot, log } = fakeBot(w, { x: 355.5, y: 86, z: 150.5 }, { blocks: 200, placeWorks: false })
  const r = await SK.skyDescend({ bot }, {}, ac(), FAST)
  assert.equal(r.failClass, 'needs_rescue'); assert.match(r.detail, /could not place beneath the floor/)
  assert.equal(log.digs, 0, 'rideFloorDown never breaks the floor before its placement reads back')
})
await ta('SKILL: not elevated and no episode -> no_effect; in the air -> it waits (no_effect), never acts', async () => {
  const w = skyWorld(); const { bot } = fakeBot(w, { x: 355.5, y: 72, z: 150.5 })
  assert.equal((await SK.skyDescend({ bot }, {}, ac(), FAST)).status, 'no_effect')
  const { bot: b2, log } = fakeBot(w, ON_DECK); b2.entity.onGround = false
  const r = await SK.skyDescend({ bot: b2 }, {}, ac(), FAST)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /waiting: not on the ground/); assert.equal(log.digs, 0)
})
await ta('SKILL: an off-centre bot is centred before the first step; one that cannot be centred is never dug under', async () => {
  const w = skyWorld({ deckY: 85 }); const { bot, log } = fakeBot(w, { x: 355.95, y: 86, z: 150.5 })
  await SK.skyDescend({ bot }, {}, ac(), FAST)
  assert.deepEqual(log.gotos[0], { x: 355, y: 86, z: 150 })
  const { bot: b2, log: l2 } = fakeBot(skyWorld({ deckY: 85 }), { x: 355.95, y: 86, z: 150.5 })
  b2.pathfinder.goto = async () => {}                          // the stop never snaps it
  const r = await SK.skyDescend({ bot: b2 }, {}, ac(), FAST)
  assert.equal(r.failClass, 'needs_rescue'); assert.match(r.detail, /could not centre/); assert.equal(l2.digs, 0)
})
await ta('SKILL: no floor dig inside the spawn grace (the server drops digs in the first seconds after a spawn)', async () => {
  const w = skyWorld({ deckY: 85 }); const { bot } = fakeBot(w, { x: 355.5, y: 86, z: 150.5 })
  bot.lastSpawnAt = Date.now()
  let firstDigAt = null; const d0 = bot.dig; bot.dig = async b => { firstDigAt ??= Date.now(); return d0(b) }
  await SK.skyDescend({ bot }, {}, ac(), FAST)
  assert.ok(firstDigAt - bot.lastSpawnAt >= RF.SPAWN_GRACE_MS - 20, `first dig ${firstDigAt - bot.lastSpawnAt} ms after the spawn`)
})

// ---------------------------------------------------------------- mutants (anchored: present and unique)
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
await ta('MUTANT KILLED: "done" at the trigger threshold leaves the bot 8 above the ground beside its pillar', async () => {
  // a floating block 4 over the ground (breaking it is a fall of 5), walled at feet and head height on all four sides, so
  // only the own test can see it (the void under it is open to the sky two cells out)
  const walls = new Set(['301,77,300', '299,77,300', '300,77,301', '300,77,299', '301,78,300', '299,78,300', '300,78,301', '300,78,299'])
  const shaft = (x, y, z) => (x === 300 && y === 76 && z === 300 ? COBBLE : walls.has(`${x},${y},${z}`) ? STONE : y <= 71 ? STONE : AIR)
  assert.equal(doneAt(columnReader(shaft), 300, 76, 300).done, false, 'breaking it is a fall of 5')
  await withMutant(RF_URL, '  if (!(own.landing === \'water\' || own.open + 1 + (own.landY == null ? 0 : 1 - topOf(R.block(x, own.landY, z))) <= SAFE_DROP))', '  if (!(own.landing === \'water\' || own.open <= ELEVATED_MIN))', async m => {
    assert.equal(m.doneAt(m.columnReader(shaft), 300, 76, 300).done, true)
  })
})
await ta('MUTANT KILLED: an episode that ends on a transient reading hands a mid-descent bot back to the model', async () => {
  await withMutant(RF_URL, '    if (done?.done === true && !el?.transient) {', '    if (done?.done === true || el?.transient) {', async m => {
    const s = m.descendOrder({ el: { elevated: false, transient: true, why: 'not on the ground' }, done: null, state: { active: true } })
    assert.equal(s.state.active, false)
  })
})
await ta('MUTANT KILLED: a reserve on a free column keeps a bare bot on its pillar for ever', async () => {
  await withMutant(SK_URL, '  const reserve = n => n + (n > 0 ? SKY_MARGIN : 0)', '  const reserve = n => n + SKY_MARGIN', async m => {
    const w = skyWorld({ deckY: 0 }); for (let y = 72; y <= 84; y++) w.m.set(key(300, y, 300), COBBLE)
    const { bot } = fakeBot(w, { x: 300.5, y: 85, z: 300.5 }, { blocks: 0 })
    assert.equal((await m.skyDescend({ bot }, {}, ac(), FAST)).failClass, 'needs_rescue')
  })
})
await ta('MUTANT KILLED: without the SAVE_MIN bar a bot walks across the deck to save nothing', async () => {
  // a deck cell two over with a 2-block stub under it: it saves 2 blocks, less than SAVE_MIN
  const stub = skyWorld(); stub.m.set(key(357, 179, 150), COBBLE); stub.m.set(key(357, 178, 150), COBBLE)
  assert.equal(cheapestStart({ at: stub.at, support: { x: 355, y: 180, z: 150 } }).own, true)
  await withMutant(RF_URL, '      if (own.ok && own.cost - p.cost < SAVE_MIN + walk && !(p.cost === 0 && own.cost > 0)) continue\n', '', async m => {
    assert.equal(m.cheapestStart({ at: stub.at, support: { x: 355, y: 180, z: 150 } }).own, false)
  })
  assert.equal(SAVE_MIN, 4)
})
await ta('MUTANT KILLED: pricing lava as an ordinary cell sends a bot down a column into lava', async () => {
  await withMutant(RF_URL, "    if (k === 'lava' || k === 'water' || k2 === 'lava' || k2 === 'water') {", '    if (false) {', async m => {
    assert.equal(m.descentCost(pillarWorld({ lavaAt: 100 }).at, { x: 354, y: 180, z: 148 }).ok, true)
  })
})
await ta('MUTANT KILLED: the side trigger on ONE deadly side makes a bot that spawns beside a ravine dig itself a shaft', async () => {
  await withMutant(RF_URL, '  return { exposed: sides >= EDGE_SIDES, own, sides, blind }', '  return { exposed: sides >= 1, own, sides, blind }', async m => {
    const cliff = (x, y, z) => (y <= 71 || (x <= 355 && y <= 90) ? STONE : AIR)
    assert.equal(m.elevation({ pos: { x: 355.5, y: 91, z: 150.5 }, at: cliff }).elevated, true)
  })
})
await ta('MUTANT KILLED: an unbounded ride runs a bot down its pillar past the safe stance into the ground', async () => {
  await withMutant(SK_URL, '    const r = await rideFloorDown(bot, { maxSteps: Math.max(1, Math.min(8, plan.steps)), signal, until })', '    const r = await rideFloorDown(bot, { maxSteps: 8, signal, until })', async m => {
    const w = skyWorld({ deckY: 92 }); for (let y = 72; y < 92; y++) w.m.set(key(355, y, 150), COBBLE)
    const { bot } = fakeBot(w, { x: 355.5, y: 93, z: 150.5 })
    await m.skyDescend({ bot }, {}, ac(), FAST)
    assert.ok(feetAboveGround(bot) < SAFE_DROP - 1 - 0.5 || feetAboveGround(bot) < 0, `the mutant ended ${feetAboveGround(bot)} above the ground`)
  })
})
await ta('MUTANT KILLED: a run that does not hold the body lets the escape lattice act mid-descent', async () => {
  await withMutant(SK_URL, '  bot.skyHoldUntil = Math.max(bot.skyHoldUntil ?? 0, until + 60_000)\n', '', async m => {
    const w = skyWorld({ deckY: 85 }); const { bot, log } = fakeBot(w, { x: 355.5, y: 86, z: 150.5 })
    await m.skyDescend({ bot }, {}, ac(), FAST)
    assert.ok(log.heldDuringDig.some(h => !h))
  })
})
await ta('MUTANT KILLED: without the centring check a straddling bot digs its floor', async () => {
  await withMutant(SK_URL, "  if (offOf() > 0.2) stopped = 'could not centre on its support (a straddling body would not drop)'\n", '', async m => {
    const { bot, log } = fakeBot(skyWorld({ deckY: 85 }), { x: 355.95, y: 86, z: 150.5 })
    bot.pathfinder.goto = async () => {}
    await m.skyDescend({ bot }, {}, ac(), FAST)
    assert.ok(log.digs > 0)
  })
})

// ---------------------------------------------------------------- r3: the region, lava, slabs, water, long transients
/** The deck plus a 3x3 patch two blocks thick (y=179 solid under it) centred on (355,150). */
const thickPatch = () => { const w = skyWorld(); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.m.set(key(355 + dx, 179, 150 + dz), COBBLE); return w }
/** The deck plus an oak on it at (355,150): trunk 181..184, a leaf cap at 185 and leaves round the top of the trunk. */
const treeOnDeck = () => {
  const w = skyWorld(); const LOG = { name: 'oak_log', boundingBox: 'block' }, LEAF = { name: 'oak_leaves', boundingBox: 'block' }
  for (let y = 181; y <= 184; y++) w.m.set(key(355, y, 150), LOG)
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { if (dx || dz) w.m.set(key(355 + dx, 184, 150 + dz), LEAF) }
  w.m.set(key(355, 185, 150), LEAF)
  return w
}
await ta('REGION: a thick patch of deck is still the platform -- not done, not a free start, and elevated (Claude r2 P1-1)', () => {
  const w = thickPatch()
  assert.equal(descentDone(w.at, { x: 355, y: 180, z: 150 }).done, false)
  assert.match(descentDone(w.at, { x: 355, y: 180, z: 150 }).why, /still on a platform/)
  const best = cheapestStart({ at: w.at, support: { x: 352, y: 180, z: 150 } })
  assert.ok(best.cost > 0, `no free start on the patch (${JSON.stringify(best)})`)
  assert.equal(elevation({ pos: ON_DECK, at: w.at }).elevated, true)
})
await ta('REGION: a bot on a tree standing on the deck is on the platform (Codex r2 P1-2)', () => {
  const e = elevation({ pos: { x: 355.5, y: 186, z: 150.5 }, at: treeOnDeck().at })
  assert.equal(e.elevated, true, JSON.stringify(e)); assert.match(e.why, /on a platform/)
})
await ta('REGION: a bot on the ground beside a bridge over a ravine is NOT on a platform (its own stance is grounded)', () => {
  // ground top 72; a ravine x 302..306 down to y=40; a one-block bridge at y=71 across it
  const m = new Map()
  for (let x = 302; x <= 306; x++) m.set(key(x, 71, 300), COBBLE)
  const at = (x, y, z) => m.get(key(x, y, z)) ?? (x >= 302 && x <= 306 && y > 40 ? AIR : y <= 71 ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 300.5, y: 72, z: 300.5 }, at }).elevated, false)
  assert.equal(regionAt(columnReader(at), { x: 300, y: 71, z: 300 }).platform, false)
  const mid = regionAt(columnReader(at), { x: 304, y: 71, z: 300 })
  assert.ok(mid.grounded && !mid.platform, 'from mid-bridge the banks are ground (and a ravine open on two sides is not a sky void)')
})
await ta('LAVA is never a landing: a deck over a lava lake is not priced and no stance over it is done (Codex r2 P1-1)', () => {
  const w = skyWorld({ deckY: 90, under: LAVA })
  for (let x = 340; x <= 370; x++) for (let z = 140; z <= 160; z++) w.m.set(key(x, 72, z), LAVA)
  assert.equal(descentCost(w.at, { x: 355, y: 90, z: 150 }).ok, false)
  assert.equal(doneAt(columnReader(w.at), 355, 75, 150).done, false)
})
await ta('A NATURAL PIT beside the landing is terrain: the pillar ride stops at the ground, not at the pit floor (Codex r2 P2-4)', () => {
  const m = new Map()
  for (let y = 72; y <= 89; y++) m.set(key(300, y, 300), COBBLE)
  const at = (x, y, z) => m.get(key(x, y, z)) ?? ((x === 301 && z === 300 && y > 44) ? AIR : y <= 71 ? STONE : AIR)
  const c = descentCost(at, { x: 300, y: 89, z: 300 })
  assert.equal(c.ok, true, JSON.stringify(c)); assert.ok(c.endY >= 71, `stopped at ${c.endY}`)
})
await ta('SLABS at the landing: the half block counts, so the descent goes one further (Codex r2 P2-5)', () => {
  const w = skyWorld(); for (let x = 340; x <= 370; x++) for (let z = 140; z <= 160; z++) w.m.set(key(x, 72, z), SLAB)
  const c = descentCost(w.at, { x: 357, y: 180, z: 152 })
  // landing top is 72.5: feet at endY + 1 must be within 3 of it
  assert.ok(c.endY + 1 - 72.5 <= SAFE_DROP, `feet ${c.endY + 1} over a slab top 72.5`)
})
await ta('A partial block inside the column is not a free ride (Claude r2 P3-7)', () => {
  const w = pillarWorld(); w.m.set(key(354, 150, 148), SLAB)
  assert.match(descentCost(w.at, { x: 354, y: 180, z: 148 }).why, /a partial block/)
})
await ta('WATER ends an episode (swimming is travel); a transient reading ends it after TRANSIENT_MAX_MS (both r2)', () => {
  const now = 10_000_000
  assert.equal(elevation({ pos: ON_DECK, at: skyWorld().at, inWater: true }).water, true)
  const w = descendOrder({ now, el: { elevated: false, water: true, why: 'in water' }, state: { active: true } })
  assert.equal(w.issue, false); assert.equal(w.state.active, false); assert.equal(w.ended, 'water')
  const tr = { elevated: false, transient: true, why: 'not on the ground' }
  const a = descendOrder({ now, el: tr, state: { active: true } })
  assert.equal(a.issue, true); assert.equal(a.state.transientSince, now)
  const b = descendOrder({ now: now + RF.TRANSIENT_MAX_MS + 1, el: tr, state: a.state })
  assert.equal(b.issue, false); assert.equal(b.ended, 'transient')
  // UNREADABLE geometry is held, however long (Codex r3 P1-3)
  const un = { elevated: false, transient: true, unknown: true, why: 'the column below is not loaded yet' }
  const u1 = descendOrder({ now, el: un, state: { active: true } })
  assert.equal(descendOrder({ now: now + 10 * RF.TRANSIENT_MAX_MS, el: un, state: u1.state }).state.active, true)
  const c = descendOrder({ now: now + 1000, el: { elevated: true, why: 'x' }, state: a.state })
  assert.equal(c.state.transientSince, null, 'a good reading resets the clock')
})
await ta('MUTANT KILLED: done without the region test ends an episode on a thick patch of deck', async () => {
  await withMutant(RF_URL, "  if (reg.platform) return { done: false, unknown: false, why: `still on a platform", "  if (false) return { done: false, unknown: false, why: `still on a platform", async m => {
    assert.equal(m.descentDone(thickPatch().at, { x: 355, y: 180, z: 150 }).done, true)
  })
})
await ta('MUTANT KILLED: a trigger without the region test leaves a bot on a tree on the deck to the model', async () => {
  await withMutant(RF_URL, '  if (reg.platform) return { elevated: true, why: `on a platform', '  if (false) return { elevated: true, why: `on a platform', async m => {
    assert.equal(m.elevation({ pos: { x: 355.5, y: 186, z: 150.5 }, at: treeOnDeck().at }).elevated, false)
  })
})
await ta('MUTANT KILLED: lava read as a landing makes a stance over a lava lake "done"', async () => {
  // ground everywhere up to y=75, but lava in the two cells under ONE support: only the own-column guard can see it
  const pit = (x, y, z) => (x === 300 && z === 300 && (y === 74 || y === 73) ? LAVA : y <= 75 ? STONE : AIR)
  assert.equal(doneAt(columnReader(pit), 300, 75, 300).done, false)
  await withMutant(RF_URL, "  if (own.landing === 'lava') return { done: false, unknown: false, why: 'lava below' }", '', async m => {
    assert.equal(m.doneAt(m.columnReader(pit), 300, 75, 300).done, true)
  })
})
await ta('MUTANT KILLED: an episode that ignores water keeps a swimming bot owned for ever', async () => {
  await withMutant(RF_URL, "    if (el?.water) { s.active = false; s.transientSince = null; return { issue: false, why: 'in water: swimming is travel', state: s, ended: 'water', fresh: true } }\n", '', async m => {
    assert.equal(m.descendOrder({ el: { elevated: false, water: true, why: 'in water' }, state: { active: true } }).state.active, true)
  })
})

await ta('REGION r4: a uniformly 2-thick deck floats; a 9-block hanging column is not ground; a jungle canopy is terrain (Codex r3)', () => {
  // a 2-thick deck 41 x 41 at y 179..180 over ground top 72
  const thick = (x, y, z) => ((y === 180 || y === 179) && Math.abs(x - 355) <= 20 && Math.abs(z - 150) <= 20 ? COBBLE : y <= 71 ? STONE : AIR)
  assert.equal(elevation({ pos: ON_DECK, at: thick }).elevated, true, 'thick deck')
  assert.equal(descentDone(thick, { x: 355, y: 180, z: 150 }).done, false)
  // the thick patch with a 9-block hanging column under a neighbouring deck cell
  const w = thickPatch(); for (let y = 171; y <= 179; y++) w.m.set(key(357, y, 150), COBBLE)
  assert.equal(descentDone(w.at, { x: 355, y: 180, z: 150 }).done, false, 'a hanging column is not ground')
  // a jungle canopy: one layer of leaves at y=90 over a forest floor at 71, a 2-layer patch in it
  const LEAF = { name: 'jungle_leaves', boundingBox: 'block' }
  const canopy = (x, y, z) => ((y === 90 || (y === 89 && Math.abs(x - 300) <= 1 && Math.abs(z - 300) <= 1)) && Math.abs(x - 300) <= 12 && Math.abs(z - 300) <= 12 ? LEAF : y <= 71 ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 300.5, y: 91, z: 300.5 }, at: canopy }).elevated, false, 'canopy')
  // a tree standing on a deck still triggers (its region reaches the deck's cobblestone)
  assert.equal(elevation({ pos: { x: 355.5, y: 186, z: 150.5 }, at: treeOnDeck().at }).elevated, true)
})

// ---------------------------------------------------------------- r5: caves, aquifers, block edges (Claude r3)
/** Natural ground (top 72) over a cave 20 x 20 x 10 (y 60..69) under a 2-thick roof (70, 71), with no mouth to the sky. */
const caveRoof = (x, y, z) => (Math.abs(x - 300) <= 10 && Math.abs(z - 300) <= 10 && y >= 60 && y <= 69 ? AIR : y <= 71 ? STONE : AIR)
await ta('A CAVE under a thin natural roof is not a platform: its void is not open to the sky (Claude r3 P1-1)', () => {
  assert.equal(elevation({ pos: { x: 300.5, y: 72, z: 300.5 }, at: caveRoof }).elevated, false)
  assert.equal(descentDone(caveRoof, { x: 300, y: 71, z: 300 }).done, true)
  // an aquifer 12 under the ground is ground too
  const aq = (x, y, z) => (y >= 50 && y <= 59 ? WATER : y <= 71 ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 300.5, y: 72, z: 300.5 }, at: aq }).elevated, false)
})
await ta('A BODY ON A BLOCK EDGE takes its support from under its hitbox, not from the air under its centre (Claude r3 P1-2)', () => {
  const w = skyWorld()
  // the deck's east edge is x=360: a body at x 361.2 has its centre over air and its west corner over the deck
  const p = { x: 361.2, y: 181, z: 150.5 }
  assert.deepEqual(RF.bodySupport(p, w.at), { x: 360, y: 180, z: 150 })
  const e = elevation({ pos: p, at: w.at })
  assert.equal(e.elevated, true); assert.deepEqual(e.support, { x: 360, y: 180, z: 150 })
})
await ta('MUTANT KILLED: a float test without the sky check turns every thin cave roof into a platform', async () => {
  await withMutant(RF_URL, '    return skyOpenAt(R, x, yy, z)                        // a deck\'s void is open to the sky; a cave\'s is not', '    return true', async m => {
    assert.equal(m.elevation({ pos: { x: 300.5, y: 72, z: 300.5 }, at: caveRoof }).elevated, true)
  })
})
await ta('MUTANT KILLED: ground that ignores a deadly run under a short solid stretch counts a hanging column as ground', async () => {
  await withMutant(RF_URL, '      if (sky !== false) return false\n', '', async m => {
    const w = thickPatch(); for (let y = 170; y <= 178; y++) w.m.set(key(355, y, 150), COBBLE)   // hangs under the patch centre
    assert.equal(descentDone(w.at, { x: 355, y: 180, z: 150 }).done, false)
    assert.equal(m.descentDone(w.at, { x: 355, y: 180, z: 150 }).done, true)
  })
})

await ta('r6 (Codex r4): a LONG hanging column is not ground; a single-layer canopy is terrain; a stair down is a free way down', () => {
  // a 2-thick deck with a 17-block column hanging under one cell (163..178)
  const thick = new Map()
  const at = (x, y, z) => thick.get(key(x, y, z)) ?? ((y === 180 || y === 179) && Math.abs(x - 355) <= 20 && Math.abs(z - 150) <= 20 ? COBBLE : y <= 71 ? STONE : AIR)
  for (let y = 163; y <= 178; y++) thick.set(key(357, y, 150), COBBLE)
  assert.equal(elevation({ pos: ON_DECK, at }).elevated, true)
  assert.equal(descentDone(at, { x: 357, y: 180, z: 150 }).done, false)
  assert.ok(cheapestStart({ at, support: { x: 355, y: 180, z: 150 } }).cost > 0)
  // one layer of jungle leaves at y=90 over the forest floor
  const LEAF = { name: 'jungle_leaves', boundingBox: 'block' }
  const canopy = (x, y, z) => (y === 90 && Math.abs(x - 300) <= 12 && Math.abs(z - 300) <= 12 ? LEAF : y <= 71 ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 300.5, y: 91, z: 300.5 }, at: canopy }).elevated, false)
  // a 1-wide stair from a floating block at 90 down to the ground, one block a step: free (its own column costs 16)
  const st = new Map()
  st.set(key(300, 90, 300), COBBLE)
  for (let i = 1; i <= 18; i++) st.set(key(300 + i, 90 - i, 300), COBBLE)
  const sat = (x, y, z) => st.get(key(x, y, z)) ?? (y <= 71 ? STONE : AIR)
  const b = rankStarts({ at: sat, support: { x: 300, y: 90, z: 300 }, radius: 24 })[0]
  assert.ok(b.cost <= 1 && !b.own, `the stair is taken, not the 16-block column (${JSON.stringify(b)})`)
})

await ta('r7 (Codex r5): a 70-block hanging column is not ground; a one-layer roof over an enclosed cave is terrain; a bare bot takes the stair', async () => {
  const hang = new Map()
  const at = (x, y, z) => hang.get(key(x, y, z)) ?? ((y === 180 || y === 179) && Math.abs(x - 355) <= 20 && Math.abs(z - 150) <= 20 ? COBBLE : y <= 71 ? STONE : AIR)
  for (let y = 109; y <= 178; y++) hang.set(key(355, y, 150), COBBLE)
  assert.equal(elevation({ pos: ON_DECK, at }).elevated, true)
  assert.equal(descentDone(at, { x: 355, y: 180, z: 150 }).done, false)
  const roof1 = (x, y, z) => (Math.abs(x - 300) <= 10 && Math.abs(z - 300) <= 10 && y >= 60 && y <= 70 ? AIR : y <= 71 ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 300.5, y: 72, z: 300.5 }, at: roof1 }).elevated, false)
  assert.equal(descentDone(roof1, { x: 300, y: 71, z: 300 }).done, true)
  // THE WHOLE SKILL, no blocks, default radius: a floating block at 90 with a stair down to the ground
  const st = new Map(); st.set(key(300, 90, 300), COBBLE)
  for (let i = 1; i <= 18; i++) st.set(key(300 + i, 90 - i, 300), COBBLE)
  const w = { m: st, at: (x, y, z) => st.get(key(x, y, z)) ?? (y <= 71 ? STONE : AIR) }
  const { bot } = fakeBot(w, { x: 300.5, y: 91, z: 300.5 }, { blocks: 0 })
  let r = null
  for (let k = 0; k < 6 && !(r && r.status === 'success' && descentDone(w.at, supportOf(bot.entity.position)).done); k++) r = await SK.skyDescend({ bot }, {}, ac(), FAST)
  assert.ok(descentDone(w.at, supportOf(bot.entity.position)).done, `walked the stair down (${JSON.stringify(r)} at ${bot.entity.position})`)
})

// ---------------------------------------------------------------- r7 (Claude r5): the r6 fixes, each with a mutant that fails
/** Natural ground (top 72) over a cave 21 x 21 (y 60..69) under a 2-thick roof, with a 3x3 mouth 12 cells east. */
const caveMouth = (x, y, z) => {
  const inCave = Math.abs(x - 300) <= 10 && Math.abs(z - 300) <= 10 && y >= 60 && y <= 69
  const mouth = Math.abs(x - 312) <= 1 && Math.abs(z - 300) <= 1 && y >= 60 && y <= 71
  return inCave || mouth || (x >= 310 && x <= 313 && Math.abs(z - 300) <= 1 && y >= 60 && y <= 69) ? AIR : y <= 71 ? STONE : AIR
}
/** A closed cave whose ceiling rises 10 under a hill (no opening). */
const dome = (x, y, z) => (Math.abs(x - 300) <= 10 && Math.abs(z - 300) <= 10 && y >= 60 && y <= (Math.abs(x - 306) <= 2 ? 80 : 69) ? AIR : y <= (Math.abs(x - 306) <= 3 ? 90 : 71) ? STONE : AIR)
const patchBy = col => { const w = thickPatch(); col(w); return w }
await ta('r7: a cave mouth 12 away and a dome are terrain; a thick patch beside a full pillar or a gappy hanging column is a platform', () => {
  assert.equal(elevation({ pos: { x: 300.5, y: 72, z: 300.5 }, at: caveMouth }).elevated, false, 'cave mouth')
  assert.equal(elevation({ pos: { x: 300.5, y: 72, z: 300.5 }, at: dome }).elevated, false, 'dome')
  const pillar = patchBy(w => { for (let y = 72; y <= 179; y++) w.m.set(key(358, y, 152), COBBLE) })
  assert.equal(elevation({ pos: { x: 355.5, y: 181, z: 150.5 }, at: pillar.at }).elevated, true, 'patch beside a full pillar')
  const gappy = patchBy(w => { for (const y of [...Array(11).keys()].map(i => 170 + i).concat([...Array(10).keys()].map(i => 157 + i))) w.m.set(key(358, y, 152), COBBLE) })
  assert.equal(descentDone(gappy.at, { x: 355, y: 180, z: 150 }).done, false, 'patch beside a gappy hanging column')
})
await ta('r7: a fence top is its own support; descendOrder says when the wait clock restarts', () => {
  const FENCE = { name: 'oak_fence', boundingBox: 'block', shapes: [[0.375, 0, 0.375, 0.625, 1.5, 0.625]] }
  const at = (x, y, z) => (x === 300 && y === 75 && z === 300 ? FENCE : y <= 71 ? STONE : AIR)
  assert.deepEqual(RF.bodySupport({ x: 300.5, y: 76.5, z: 300.5 }, at), { x: 300, y: 75, z: 300 })
  const el = elevation({ pos: ON_DECK, at: skyWorld().at })
  assert.equal(descendOrder({ now: 1e7, lastSpawnAt: 1e7 - 1000, el }).fresh, true, 'an episode starts fresh')
  assert.equal(descendOrder({ now: 1e7, el, state: { active: true } }).fresh, undefined, 'a running one does not')
  assert.equal(descendOrder({ now: 1e7, el: { elevated: false, why: 'x' }, done: { done: true }, state: { active: true } }).fresh, true, 'an ending one does')
})
await ta('MUTANT KILLED: a pillar counted as the region\'s ground makes a thick patch beside it look like the ground', async () => {
  await withMutant(RF_URL, ' && (exposedAt(R, c.x, c.y, c.z)?.sides ?? 0) <= 1) { grounded = true; break }', ') { grounded = true; break }', async m => {
    const pillar = patchBy(w => { for (let y = 72; y <= 179; y++) w.m.set(key(358, y, 152), COBBLE) })
    assert.equal(m.elevation({ pos: { x: 355.5, y: 181, z: 150.5 }, at: pillar.at }).elevated, false)
  })
})
await ta('MUTANT KILLED: one sky-open direction turns a cave mouth 12 away into a platform', async () => {
  await withMutant(RF_URL, 'export const SKY_SIDES = 3 ', 'export const SKY_SIDES = 1 ', async m => {
    assert.equal(m.elevation({ pos: { x: 300.5, y: 72, z: 300.5 }, at: caveMouth }).elevated, true)
  })
})
await ta('MUTANT KILLED: without the fence-top branch a bot on a fence reads as having no support', async () => {
  await withMutant(RF_URL, '  if (low.y !== s.y && kind(rd(low.x, low.y, low.z)) === \'solid\' && topOf(rd(low.x, low.y, low.z)) > 1) return low\n', '', async m => {
    const FENCE = { name: 'oak_fence', boundingBox: 'block', shapes: [[0.375, 0, 0.375, 0.625, 1.5, 0.625]] }
    const at = (x, y, z) => (x === 300 && y === 75 && z === 300 ? FENCE : y <= 71 ? STONE : AIR)
    assert.notDeepEqual(m.bodySupport({ x: 300.5, y: 76.5, z: 300.5 }, at), { x: 300, y: 75, z: 300 })
  })
})
await ta('MUTANT KILLED: an episode that never says fresh keeps the last episode\'s wait clock', async () => {
  await withMutant(RF_URL, '  return { issue: true, why: el.why, state: s, fresh: true }', '  return { issue: true, why: el.why, state: s }', async m => {
    const el = elevation({ pos: ON_DECK, at: skyWorld().at })
    assert.equal(m.descendOrder({ now: 1e7, lastSpawnAt: 1e7 - 1000, el }).fresh, undefined)
  })
})

// ---------------------------------------------------------------- wiring (structural, comments stripped)
await ta('WIRING: the order runs ahead of every order but keep-out; admission; the lattice and the watchdog ask the gate; spawn is stamped', async () => {
  const strip = u => readFileSync(new URL(u, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  const cog = strip('../src/cognitive.mjs')
  const iSky = cog.indexOf('{ const sd = this.#skyDescendOrder(order); if (sd) order = sd }'), iKo = cog.indexOf('{ const ko = this.#keepoutExitOrder(order); if (ko) order = ko }')
  assert.ok(iSky > 0 && iKo > iSky, 'the sky order precedes keep-out\'s (which therefore wins)')
  assert.ok(cog.includes('bot.skyActive = d.state.active === true'), 'the open episode is published for the lattice')
  assert.ok(cog.includes('if (!this.skyState?.active && !(bot.lastSpawnAt != null && Date.now() - bot.lastSpawnAt <= SPAWN_WINDOW_MS)) return null'), 'the flood runs only in a window or an episode')
  assert.ok(/if \(skill === 'sky_descend' && !bot\?\.inventoryUnsettled\) return \{ ok: true/.test(strip('../src/admission.mjs')))
  assert.ok(/if \(skyEscapeBlocked\(this\.bot\)\) return/.test(strip('../src/watchdog.mjs')))
  const rfx = strip('../src/reflex.mjs')
  assert.ok(rfx.includes('if (!escaping && !marooned && !skyEscapeBlocked(bot) && !runner.isBusy() && Date.now() >= airPocketBreatheUntil &&'), 'the maroon lattice asks the gate')
  assert.ok(/deckMoves\.infiniteLiquidDropdownDistance = false/.test(strip('../src/index.mjs')), 'the deck walk plans no plunge into water')
  assert.ok(rfx.includes('longEnough && !poolEscaping && !skyEscapeBlocked(bot) &&'), 'the last-resort branch asks the gate')
  assert.ok(/bot\.on\('spawn', \(\) => \{ bot\.lastSpawnAt = Date\.now\(\) \}\)/.test(strip('../src/index.mjs')))
  assert.ok(/sky_descend: \{ run: skyDescend, usage: 'sky_descend', args: \[\], chatOnly: true, rescue: true \}/.test(strip('../src/skills.mjs')))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
