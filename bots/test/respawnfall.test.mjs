// RESPAWNFALL-01 (docs/reports/respawnfall-01-design-2026-10-24.md): a bot that (re)spawns on a high platform climbs down by
// rideFloorDown, or -- carrying too few blocks -- stays and raises `_needs_rescue`, instead of walking off the edge.
//
// Behaviour only: the pure rule (respawnfall.mjs) on a world shaped like isolated-a's platform (a 1-block-thick cobblestone
// deck at y=180 over open air down to the town's ground at y=72), the order's decision, and the REAL skill (skills.mjs
// skyDescend, which runs the REAL rideFloorDown) on a fake bot whose physics is the one rule that matters here: when the block
// under its feet is broken it falls to the next solid. Mutants are anchored (present and unique).
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
const { elevation, columnUnder, supportOf, blocksNeeded, descendOrder, stayRefusal, respawnfallOn, respawnfallModeDetail, descentCost, descentDone, cheapestStart, ELEVATED_MIN, SAFE_DROP, SPAWN_WINDOW_MS, MARGIN, SAVE_MIN, START_RADIUS } = RF

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const STONE = { name: 'stone', boundingBox: 'block' }, COBBLE = { name: 'cobblestone', boundingBox: 'block' }, AIR = { name: 'air', boundingBox: 'empty' }
const WATER = { name: 'water', boundingBox: 'empty' }, LAVA = { name: 'lava', boundingBox: 'empty' }
const key = (x, y, z) => `${x},${y},${z}`
/** isolated-a's shape: ground (stone) up to y=71 (feet 72); a cobblestone deck at y=180 for x 350..360, z 145..155. */
function skyWorld ({ deckY = 180, ground = 71, under = null, pillar = null } = {}) {
  const m = new Map()
  const at = (x, y, z) => {
    const k = key(x, y, z)
    if (m.has(k)) return m.get(k)
    if (y === deckY && x >= 350 && x <= 360 && z >= 145 && z <= 155) return COBBLE
    if (pillar && x === pillar.x && z === pillar.z && y < deckY && y > ground) return COBBLE
    if (under && y === ground + 1) return under
    if (y <= ground) return STONE
    return AIR
  }
  return { m, at }
}
const ON_DECK = { x: 355.5, y: 181, z: 150.5 }

// ---------------------------------------------------------------- the pure rule
await ta('elevation: the deck at y=180 over open air to the ground at 71 is elevated (108 open onto solid)', () => {
  const e = elevation({ pos: ON_DECK, at: skyWorld().at })
  assert.equal(e.elevated, true); assert.equal(e.open, 108); assert.equal(e.landing, 'solid')
  assert.deepEqual(supportOf(ON_DECK), { x: 355, y: 180, z: 150 })
})
await ta('elevation: ordinary ground, a 7-open ledge, a water landing, air under the feet, and unloaded below are NOT elevated', () => {
  assert.equal(elevation({ pos: { x: 355.5, y: 72, z: 150.5 }, at: skyWorld().at }).elevated, false)
  const low = skyWorld({ deckY: 79 })    // 7 open cells under the deck
  assert.equal(elevation({ pos: { x: 355.5, y: 80, z: 150.5 }, at: low.at }).open, 7)
  assert.equal(elevation({ pos: { x: 355.5, y: 80, z: 150.5 }, at: low.at }).elevated, false)
  assert.equal(ELEVATED_MIN, 8); assert.equal(elevation({ pos: { x: 355.5, y: 81, z: 150.5 }, at: skyWorld({ deckY: 80 }).at }).elevated, true)
  assert.equal(elevation({ pos: ON_DECK, at: skyWorld({ under: WATER }).at }).elevated, false, 'swimming is travel')
  assert.equal(elevation({ pos: ON_DECK, at: skyWorld({ under: LAVA }).at }).elevated, true)
  assert.equal(elevation({ pos: { x: 340.5, y: 181, z: 150.5 }, at: skyWorld().at }).elevated, false, 'no solid support')
  assert.equal(elevation({ pos: ON_DECK, at: skyWorld().at, onGround: false }).elevated, false, 'in the air: not standing')
  const unk = skyWorld(); const e = elevation({ pos: ON_DECK, at: (x, y, z) => (y < 120 ? null : unk.at(x, y, z)) })
  assert.equal(e.elevated, false); assert.equal(e.unknown, true)
})
await ta('elevation never throws: a reader that throws below reads as unknown', () => {
  const w = skyWorld()
  const e = elevation({ pos: ON_DECK, at: (x, y, z) => { if (y < 150) throw new Error('boom'); return w.at(x, y, z) } })
  assert.equal(e.elevated, false); assert.equal(e.unknown, true)
  assert.equal(elevation({ pos: null, at: w.at }).elevated, false)
})
await ta('blocksNeeded: one per open cell down to SAFE_DROP above the landing; an existing column under the deck costs nothing', () => {
  assert.equal(blocksNeeded(elevation({ pos: ON_DECK, at: skyWorld().at })), 108 - SAFE_DROP)
  const pil = skyWorld({ pillar: { x: 355, z: 150 } })
  assert.equal(columnUnder(pil.at, { x: 355, y: 180, z: 150 }).open, 0)
  const pe = elevation({ pos: ON_DECK, at: pil.at })
  assert.equal(pe.elevated, true, 'a pillar top inside the deck is still on the platform: the void is one step away')
  assert.equal(blocksNeeded(pe), 0, 'its own column is solid: rideFloorDown rides it for free')
  // a natural plateau: solid all round and below -- not elevated
  assert.equal(elevation({ pos: { x: 355.5, y: 72, z: 150.5 }, at: skyWorld().at }).elevated, false)
})
await ta('descendOrder: issues inside the spawn window for an elevated bot; not outside it; an active episode continues past it; off is off', () => {
  const el = elevation({ pos: ON_DECK, at: skyWorld().at })
  const now = 10_000_000
  const a = descendOrder({ now, lastSpawnAt: now - 1000, el })
  assert.equal(a.issue, true); assert.equal(a.state.active, true)
  assert.equal(descendOrder({ now, lastSpawnAt: now - SPAWN_WINDOW_MS - 1, el }).issue, false, 'a cave shelf long after a spawn is not this rule')
  assert.equal(descendOrder({ now, lastSpawnAt: null, el }).issue, false)
  assert.equal(descendOrder({ now, lastSpawnAt: now - SPAWN_WINDOW_MS - 1, el, state: a.state }).issue, true, 'a long descent continues')
  const g = descendOrder({ now, lastSpawnAt: now - 1000, el: { elevated: false, why: 'only 2 open below' }, state: a.state })
  assert.equal(g.issue, false); assert.equal(g.state.active, false, 'grounded: the episode ends')
  assert.equal(descendOrder({ now, lastSpawnAt: now - 1000, el, on: false }).issue, false)
})
await ta('the refusal names what the bot can do from where it stands, and the rollback is one setting', () => {
  const el = elevation({ pos: ON_DECK, at: skyWorld().at })
  const m = stayRefusal({ el, have: 10, need: blocksNeeded(el) })
  assert.match(m, /^sky_descend: staying put -- 108 open blocks below onto solid/); assert.match(m, new RegExp(`needs ${blocksNeeded(el) + MARGIN} placeable blocks \\(carrying 10, logs counted as 4 planks\\)`))
  assert.match(m, /Pick up blocks \(cobblestone, dirt, logs\) and it climbs down at once/); assert.match(m, /waits here for rescue/)
  assert.match(stayRefusal({ el, have: 0, need: 0, why: 'lava under the column at y=90' }), /no safe column within 8 \(lava under the column at y=90\); walking off is a fall/)
  assert.equal(respawnfallOn({}), true); assert.equal(respawnfallOn({ RESPAWNFALL: '0' }), false)
  assert.match(respawnfallModeDetail({}), /^on=1 /); assert.match(respawnfallModeDetail({ RESPAWNFALL: '0' }), /^on=0 /)
})

await ta('elevation: a natural cliff top (one deadly side) and a corner (two) are NOT a platform; a lone pillar (four) is', () => {
  // ground at 71; a solid plateau x <= 355 up to y=90; the valley beyond it stays at 71
  const w = (x, y, z) => (y <= 71 || (x <= 355 && y <= 90) ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 355.5, y: 91, z: 150.5 }, at: w }).elevated, false, 'cliff edge')
  const corner = (x, y, z) => (y <= 71 || (x <= 355 && z <= 150 && y <= 90) ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 355.5, y: 91, z: 150.5 }, at: corner }).elevated, false, 'corner')
  const spire = (x, y, z) => (y <= 71 || (x === 355 && z === 150 && y <= 90) ? STONE : AIR)
  assert.equal(elevation({ pos: { x: 355.5, y: 91, z: 150.5 }, at: spire }).elevated, true, 'a lone pillar')
  assert.equal(RF.EDGE_SIDES, 3)
  assert.equal(descentCost(w, { x: 355, y: 90, z: 150 }).steps, 0, 'a cliff top costs nothing: it is already off the platform')
})
await ta('MUTANT KILLED: the side rule on ONE deadly side makes a bot that spawns beside a ravine dig itself a shaft', async () => {
  await withMutant(RF_URL, '  if (edge && sides >= EDGE_SIDES) return', '  if (edge && sides >= 1) return', async m => {
    const w = (x, y, z) => (y <= 71 || (x <= 355 && y <= 90) ? STONE : AIR)
    assert.equal(m.elevation({ pos: { x: 355.5, y: 91, z: 150.5 }, at: w }).elevated, true)
  })
})

// ---------------------------------------------------------------- the skill, on a fake bot with fall physics
function fakeBot (world, pos, { blocks = 200, placeWorks = true } = {}) {
  const items = blocks ? [{ name: 'cobblestone', count: blocks, type: 1 }] : []
  const rows = []
  const bot = {
    entity: { position: new Vec3(pos.x, pos.y, pos.z), onGround: true, velocity: new Vec3(0, 0, 0) },
    blockAt: v => { const b = world.at(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)); return b ? { ...b, position: new Vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)), digTime: () => 50 } : null },
    inventory: { items: () => items.filter(i => i.count > 0) },
    heldItem: null, equip: async () => {}, entities: {},
    pathfinder: { goto: async g => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5) }, setGoal () {}, stop () {} },
    _placeBlockWithOptions: async (ref, face) => {
      if (!placeWorks) return
      world.m.set(key(ref.position.x + face.x, ref.position.y + face.y, ref.position.z + face.z), COBBLE); if (items[0]) items[0].count--
    },
    dig: async b => {
      world.m.set(key(b.position.x, b.position.y, b.position.z), AIR)
      // the one law: with nothing under the feet, fall to the next solid
      const p = bot.entity.position
      let y = Math.floor(p.y) - 1
      while (y > -64 && world.at(Math.floor(p.x), y, Math.floor(p.z)).boundingBox !== 'block') y--
      bot.entity.position = new Vec3(p.x, y + 1, p.z)
      if (items[0]) items[0].count++
    },
    stopDigging () {},
  }
  return { bot, rows, items }
}
const ac = () => new AbortController().signal

await ta('SKILL: on a deck (y=100, 28 open) with 200 cobblestone it climbs down to the ground (one block at a time), and says so', async () => {
  const w = skyWorld({ deckY: 100 }); const { bot } = fakeBot(w, { x: 355.5, y: 101, z: 150.5 })
  const r = await SK.skyDescend({ bot }, {}, ac(), { stayMs: 50, runMs: 600_000 })
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.match(r.detail, /^climbed down 2\d blocks/)
  assert.ok(columnUnder(w.at, supportOf(bot.entity.position)).open <= SAFE_DROP, `ended ${bot.entity.position.y}`)
  assert.equal(descentDone(w.at, supportOf(bot.entity.position)), true)
})
await ta('SKILL: over its own column it rides it down for free (no block placed)', async () => {
  const w = skyWorld({ deckY: 110 }); for (let y = 80; y < 110; y++) w.m.set(key(355, y, 150), COBBLE)   // a column up to 109, open below 80
  const { bot, items } = fakeBot(w, { x: 355.5, y: 111, z: 150.5 }, { blocks: 200 })
  let placed = 0; const p0 = bot._placeBlockWithOptions; bot._placeBlockWithOptions = async (...a) => { placed++; return p0(...a) }
  const r = await SK.skyDescend({ bot }, {}, ac(), { stayMs: 50, runMs: 600_000 })
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.ok(bot.entity.position.y <= 76, `rode the column (${bot.entity.position.y})`)
  assert.equal(placed, 8 - SAFE_DROP, 'only the 8-cell gap under the column (79..72) is bridged, to SAFE_DROP above the ground')
})
await ta('SKILL: too few blocks -> it STAYS (no dig, no walk), needs_rescue, and the watchdog hold is set', async () => {
  const w = skyWorld(); const { bot } = fakeBot(w, ON_DECK, { blocks: 10 })
  let dug = 0; const dig0 = bot.dig; bot.dig = async b => { dug++; return dig0(b) }
  let walked = 0; bot.pathfinder.goto = async () => { walked++ }
  const t0 = Date.now()
  const r = await SK.skyDescend({ bot }, {}, ac(), { stayMs: 200, runMs: 600_000 })
  assert.equal(r.failClass, 'needs_rescue'); assert.match(r.detail, /staying put/)
  assert.equal(dug, 0); assert.equal(walked, 0); assert.equal(bot.entity.position.y, 181)
  assert.ok(Date.now() - t0 >= 190, 'it held the body for the stay'); assert.ok((bot.skyHoldUntil ?? 0) > Date.now(), 'the watchdog hold reaches past the stay')
})
await ta('SKILL: a placement that never takes -> the first step fails, it stays and flags, never digging its floor out from under itself', async () => {
  const w = skyWorld({ deckY: 100 }); const { bot } = fakeBot(w, { x: 355.5, y: 101, z: 150.5 }, { blocks: 200, placeWorks: false })
  let dug = 0; bot.dig = async () => { dug++ }
  const r = await SK.skyDescend({ bot }, {}, ac(), { stayMs: 50, runMs: 600_000 })
  assert.equal(r.failClass, 'needs_rescue'); assert.match(r.detail, /the first step down failed \(could not place beneath the floor\)/)
  assert.equal(dug, 0, 'rideFloorDown never breaks the floor before its placement reads back')
})
await ta('SKILL: not elevated -> no_effect, nothing done', async () => {
  const w = skyWorld(); const { bot } = fakeBot(w, { x: 355.5, y: 72, z: 150.5 })
  const r = await SK.skyDescend({ bot }, {}, ac(), { stayMs: 50 })
  assert.equal(r.status, 'no_effect')
})
await ta('SKILL: an off-centre bot is centred on its support cell before the first step (a straddling body would not drop)', async () => {
  const w = skyWorld({ deckY: 100 }); const { bot } = fakeBot(w, { x: 355.95, y: 101, z: 150.5 })
  let centred = null; const g0 = bot.pathfinder.goto; bot.pathfinder.goto = async g => { centred ??= { x: g.x, y: g.y, z: g.z }; return g0(g) }
  await SK.skyDescend({ bot }, {}, ac(), { stayMs: 50, runMs: 600_000 })
  assert.deepEqual(centred, { x: 355, y: 101, z: 150 })
})

// ---------------------------------------------------------------- the cheapest column (isolated-a's pillar at 354,148)
/** isolated-a's own shape: the pillar column at (354,148) from the ground to the deck, with gaps (the backup's y 96..183). */
const PILLAR_GAPS = [120, 121, 122, 140]
function pillarWorld ({ deckY = 180, gaps = PILLAR_GAPS, lavaAt = null } = {}) {
  const w = skyWorld({ deckY })
  for (let y = 72; y < deckY; y++) if (!gaps.includes(y)) w.m.set(key(354, y, 148), COBBLE)
  if (lavaAt != null) w.m.set(key(354, lavaAt, 148), LAVA)
  return w
}
await ta('descentCost: a deck cell over the void costs its open run less SAFE_DROP; the pillar costs only its gaps', () => {
  const w = pillarWorld()
  const v = descentCost(w.at, { x: 357, y: 180, z: 152 })
  assert.equal(v.ok, true); assert.equal(v.cost, 108 - SAFE_DROP)
  const p = descentCost(w.at, { x: 354, y: 180, z: 148 })
  assert.equal(p.ok, true); assert.equal(p.cost, PILLAR_GAPS.length, JSON.stringify(p))
  assert.ok(p.endY <= 72 + ELEVATED_MIN, 'it rides the pillar down until no side is a deadly drop')
})
await ta('descentCost: lava in the column, or an unloaded cell, is never priced (rideFloorDown stops at a liquid two below)', () => {
  assert.equal(descentCost(pillarWorld({ lavaAt: 100 }).at, { x: 354, y: 180, z: 148 }).ok, false)
  assert.match(descentCost(pillarWorld({ lavaAt: 100 }).at, { x: 354, y: 180, z: 148 }).why, /lava under the column/)
  const w = pillarWorld()
  assert.equal(descentCost((x, y, z) => (y < 130 ? null : w.at(x, y, z)), { x: 354, y: 180, z: 148 }).ok, false)
})
await ta('cheapestStart: from spawn (355,150) the pillar three cells away wins; the own cell wins when nothing saves SAVE_MIN', () => {
  const w = pillarWorld()
  const b = cheapestStart({ at: w.at, support: { x: 355, y: 180, z: 150 } })
  assert.deepEqual(b.cell, { x: 354, y: 180, z: 148 }); assert.equal(b.cost, PILLAR_GAPS.length); assert.equal(b.own, false)
  // with no pillar every deck cell costs the same: the own cell is kept (no walk across a deck for nothing)
  const o = cheapestStart({ at: skyWorld().at, support: { x: 355, y: 180, z: 150 } })
  assert.equal(o.own, true); assert.equal(o.cost, 108 - SAFE_DROP)
  // a pillar out of START_RADIUS is not considered; a cell the caller cannot reach is filtered
  assert.equal(cheapestStart({ at: w.at, support: { x: 354 + START_RADIUS + 1, y: 180, z: 148 } }).own, true)
  assert.equal(cheapestStart({ at: w.at, support: { x: 355, y: 180, z: 150 }, reach: c => !(c.x === 354 && c.z === 148) }).own, true)
  // a cell with no headroom is not a stance
  const h = pillarWorld(); h.m.set(key(354, 182, 148), COBBLE)
  assert.equal(cheapestStart({ at: h.at, support: { x: 355, y: 180, z: 150 } }).own, true)
})
await ta('SKILL: 10 blocks on the deck -- it walks (deck profile) to the pillar and rides it down instead of staying', async () => {
  const w = pillarWorld({ deckY: 110, gaps: [95, 96] }); const { bot } = fakeBot(w, { x: 355.5, y: 111, z: 150.5 }, { blocks: 10 })
  const profiles = []; bot.withDeckMovements = async fn => { profiles.push('deck'); return fn() }
  const seen = []; const g0 = bot.pathfinder.goto; bot.pathfinder.goto = async g => { seen.push({ x: g.x, y: g.y, z: g.z }); return g0(g) }
  const r = await SK.skyDescend({ bot }, {}, ac(), { stayMs: 50, runMs: 600_000 })
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.match(r.detail, /walked to 354,110,148:arrived/)
  assert.deepEqual(seen[0], { x: 354, y: 111, z: 148 }); assert.equal(profiles[0], 'deck', 'the walk ran on the deck profile')
  assert.ok(bot.entity.position.y <= 72 + ELEVATED_MIN, `rode down (${bot.entity.position.y})`)
  assert.equal(descentDone(w.at, supportOf(bot.entity.position)), true)
})
await ta('SKILL: a walk that ends short is priced where it ended (here: too few blocks there, so it stays)', async () => {
  const w = pillarWorld({ deckY: 110, gaps: [95, 96] }); const { bot } = fakeBot(w, { x: 355.5, y: 111, z: 150.5 }, { blocks: 10 })
  bot.pathfinder.goto = async () => { bot.entity.position = new Vec3(356.5, 111, 150.5) }   // walked the wrong way
  let dug = 0; bot.dig = async () => { dug++ }
  const r = await SK.skyDescend({ bot }, {}, ac(), { stayMs: 50, runMs: 600_000 })
  assert.equal(r.failClass, 'needs_rescue'); assert.equal(dug, 0)
})
await ta('SKILL: short of blocks but carrying logs -- it crafts planks in the 2x2 grid, then climbs down', async () => {
  const w = skyWorld({ deckY: 100 }); const { bot, items } = fakeBot(w, { x: 355.5, y: 101, z: 150.5 }, { blocks: 0 })
  items.push({ name: 'oak_log', count: 10, type: 2 })
  bot.registry = { itemsByName: { oak_planks: { id: 7 } } }
  const crafts = []
  bot.recipesFor = (id, meta, n, table) => (id === 7 && table === null ? [{ id: 7 }] : [])
  bot.craft = async (recipe, n) => { crafts.push(n); items.find(i => i.name === 'oak_log').count -= n; items.unshift({ name: 'oak_planks', count: 4 * n, type: 7 }) }
  const r = await SK.skyDescend({ bot }, {}, ac(), { stayMs: 50, runMs: 600_000 })
  const need = 28 - SAFE_DROP + MARGIN
  assert.ok(crafts.length >= 1 && crafts.reduce((a, b) => a + b, 0) === Math.ceil((need - 10) / 3), `crafted ${crafts}`)
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.match(r.detail, /crafted planks from \d+ log/)
})
await ta('MUTANT KILLED: without the SAVE_MIN bar a bot walks across the deck to save nothing', async () => {
  await withMutant(RF_URL, '      const saves = best ? (best.own ? best.cost - d.cost >= SAVE_MIN :', '      const saves = best ? (best.own ? best.cost - d.cost >= 0 :', async m => {
    const o = m.cheapestStart({ at: skyWorld().at, support: { x: 355, y: 180, z: 150 } })
    assert.equal(o.own, false)
  })
  assert.equal(SAVE_MIN, 4)
})
await ta('MUTANT KILLED: a descent that ignores a deadly SIDE stops on the pillar mid-air with the void one step away', async () => {
  await withMutant(RF_URL, '  if (sides >= EDGE_SIDES) return { exposed: true, own }\n', '', async m => {
    const p = m.descentCost(pillarWorld().at, { x: 354, y: 180, z: 148 })
    assert.ok(p.endY > 72 + ELEVATED_MIN, `the mutant stops at ${p.endY}`)
  })
})
await ta('MUTANT KILLED: pricing lava as an ordinary open cell sends a bot down a column into lava', async () => {
  await withMutant(RF_URL, "    if (k === 'lava' || k === 'water' || k2 === 'lava' || k2 === 'water') {", '    if (false) {', async m => {
    assert.equal(m.descentCost(pillarWorld({ lavaAt: 100 }).at, { x: 354, y: 180, z: 148 }).ok, true)
  })
})

// ---------------------------------------------------------------- wiring (structural, comments stripped) + mutants
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
await ta('MUTANT KILLED: a water landing read as deadly would make a bot over a lake climb down a 100-block pillar for nothing', async () => {
  await withMutant(RF_URL, "  if (c.landing === 'water') return { elevated: false, why: 'water below: a fall into it is safe', support: s, ...c }\n", '', async m => {
    assert.equal(m.elevation({ pos: ON_DECK, at: skyWorld({ under: WATER }).at }).elevated, true)
  })
})
await ta('MUTANT KILLED: guessing through an unloaded column (unknown read as solid ground) would skip a real descent... or start a blind one', async () => {
  await withMutant(RF_URL, "  if (b == null) return 'unknown'\n", "  if (b == null) return 'open'\n", async m => {
    const w = skyWorld(); const e = m.elevation({ pos: ON_DECK, at: (x, y, z) => (y < 120 ? null : w.at(x, y, z)) })
    assert.notEqual(e.unknown, true)
  })
})
await ta('MUTANT KILLED: without the spawn window every cave shelf would trigger a descent', async () => {
  await withMutant(RF_URL, "  if (!inWindow && !s.active) return { issue: false, why: 'not since a spawn', state: s }\n", '', async m => {
    const el = elevation({ pos: ON_DECK, at: skyWorld().at })
    assert.equal(m.descendOrder({ now: 1e9, lastSpawnAt: null, el }).issue, true)
  })
})
await ta('MUTANT KILLED: a skill that skips the block count walks into a descent it cannot finish (it digs instead of staying)', async () => {
  await withMutant(SK_URL, '  if (have < need + SKY_MARGIN) {\n    const why = Number.isFinite(need)', '  if (false) {\n    const why = Number.isFinite(need)', async m => {
    const w = skyWorld(); const { bot } = fakeBot(w, ON_DECK, { blocks: 10 })
    const r = await m.skyDescend({ bot }, {}, ac(), { stayMs: 50, runMs: 600_000 })
    assert.notEqual(r.detail.startsWith('sky_descend: staying put -- 108'), true)
  })
})
await ta('MUTANT KILLED: a stay without the watchdog hold leaves the bot to the relocation walk', async () => {
  await withMutant(SK_URL, '    bot.skyHoldUntil = end + 60_000\n', '', async m => {
    const w = skyWorld(); const { bot } = fakeBot(w, ON_DECK, { blocks: 0 })
    await m.skyDescend({ bot }, {}, ac(), { stayMs: 50 })
    assert.equal(bot.skyHoldUntil, undefined)
  })
})
await ta('WIRING: the order runs ahead of every order but keep-out, admission lets it through, the watchdog stands aside, spawn is stamped', async () => {
  const strip = u => readFileSync(new URL(u, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  const cog = strip('../src/cognitive.mjs')
  const iSky = cog.indexOf('{ const sd = this.#skyDescendOrder(order); if (sd) order = sd }'), iKo = cog.indexOf('{ const ko = this.#keepoutExitOrder(order); if (ko) order = ko }')
  assert.ok(iSky > 0 && iKo > iSky, 'the sky order precedes keep-out\'s (which therefore wins)')
  assert.ok(/if \(skill === 'sky_descend' && !bot\?\.inventoryUnsettled\) return \{ ok: true/.test(strip('../src/admission.mjs')))
  assert.ok(/if \(\(this\.bot\.skyHoldUntil \?\? 0\) > Date\.now\(\)\) return/.test(strip('../src/watchdog.mjs')))
  assert.ok(/bot\.on\('spawn', \(\) => \{ bot\.lastSpawnAt = Date\.now\(\) \}\)/.test(strip('../src/index.mjs')))
  assert.ok(/sky_descend: \{ run: skyDescend, usage: 'sky_descend', args: \[\], chatOnly: true, rescue: true \}/.test(strip('../src/skills.mjs')))
  // THE DELIBERATE FALL IS REFUSED FOR A HELD BOT, AT BOTH OF ITS SITES (escape.mjs's bottom rung, step_off)
  const rfx = strip('../src/reflex.mjs')
  assert.ok(rfx.includes("if (!(terminal && skyHoldActive(bot)) && (terminal ? est.blocks === 0 : plan !== 'none')) {"), 'the last-resort drop asks the hold')
  assert.ok(rfx.includes("} else if (plan === 'step_off' && skyHoldActive(bot)) {"), 'the stranded_high lattice asks the hold')
  assert.ok(/import \{ skyHoldActive \} from '\.\/respawnfall\.mjs'/.test(rfx))
  assert.equal(RF.skyHoldActive({ skyHoldUntil: Date.now() + 1000 }), true); assert.equal(RF.skyHoldActive({}), false); assert.equal(RF.skyHoldActive({ skyHoldUntil: Date.now() - 1 }), false)
  // the mutant of the order line fails the first assertion
  assert.equal(cog.replace('{ const sd = this.#skyDescendOrder(order); if (sd) order = sd }', '').indexOf('{ const sd = this.#skyDescendOrder(order); if (sd) order = sd }'), -1)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
