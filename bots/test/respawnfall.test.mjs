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
  descentDone, rankStarts, cheapestStart, skyEscapeBlocked, fullCube, ELEVATED_MIN, SAFE_DROP, SPAWN_WINDOW_MS, MARGIN, SAVE_MIN, START_RADIUS, EDGE_SIDES } = RF

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
  // a placed block in a 1x1 shaft through rock, a 5-high hollow under it: walled all round, so only the own test can see it
  const shaft = (x, y, z) => (x === 300 && z === 300 ? (y === 90 ? COBBLE : y >= 85 && y < 90 ? AIR : y > 90 ? AIR : STONE) : (y <= 95 ? STONE : AIR))
  assert.equal(doneAt(columnReader(shaft), 300, 90, 300).done, false, 'breaking it is a fall of 6')
  await withMutant(RF_URL, '  if (!(own.open <= SAFE_DROP - 1 || own.landing === \'water\'))', '  if (!(own.open <= ELEVATED_MIN || own.landing === \'water\'))', async m => {
    assert.equal(m.doneAt(m.columnReader(shaft), 300, 90, 300).done, true)
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
  await withMutant(RF_URL, '      if (own.ok && own.cost - p.cost < SAVE_MIN + walk) continue\n', '', async m => {
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

// ---------------------------------------------------------------- wiring (structural, comments stripped)
await ta('WIRING: the order runs ahead of every order but keep-out; admission; the lattice and the watchdog ask the gate; spawn is stamped', async () => {
  const strip = u => readFileSync(new URL(u, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  const cog = strip('../src/cognitive.mjs')
  const iSky = cog.indexOf('{ const sd = this.#skyDescendOrder(order); if (sd) order = sd }'), iKo = cog.indexOf('{ const ko = this.#keepoutExitOrder(order); if (ko) order = ko }')
  assert.ok(iSky > 0 && iKo > iSky, 'the sky order precedes keep-out\'s (which therefore wins)')
  assert.ok(cog.includes('bot.skyActive = d.state.active === true'), 'the open episode is published for the lattice')
  assert.ok(/if \(skill === 'sky_descend' && !bot\?\.inventoryUnsettled\) return \{ ok: true/.test(strip('../src/admission.mjs')))
  assert.ok(/if \(skyEscapeBlocked\(this\.bot\)\) return/.test(strip('../src/watchdog.mjs')))
  const rfx = strip('../src/reflex.mjs')
  assert.ok(rfx.includes('if (!escaping && !marooned && !runner.isBusy() && !skyEscapeBlocked(bot) && Date.now() >= airPocketBreatheUntil &&'), 'the maroon lattice asks the gate')
  assert.ok(rfx.includes('longEnough && !poolEscaping && !skyEscapeBlocked(bot) &&'), 'the last-resort branch asks the gate')
  assert.ok(/bot\.on\('spawn', \(\) => \{ bot\.lastSpawnAt = Date\.now\(\) \}\)/.test(strip('../src/index.mjs')))
  assert.ok(/sky_descend: \{ run: skyDescend, usage: 'sky_descend', args: \[\], chatOnly: true, rescue: true \}/.test(strip('../src/skills.mjs')))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
