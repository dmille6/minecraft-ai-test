// CAVEFALL-01 (docs/reports/cavefall-01-design-2026-10-24.md): gather never digs a FLOOR OVER A HARMFUL DROP -- a cell
// something can stand on whose removal would drop a body standing on it (and the item) onto rock from more than 3, onto a
// stalagmite tip, into lava, or into the unknown. Short drops onto rock (the ordinary self-dig) and water are untouched.
//
// Behaviour only. The worlds are REAL prismarine blocks from the 1.21.8 registry (test/helpers/reachlab.mjs mkWorld), so
// collision shapes (carpet 1/16, slab 1/2, fence 1.5, the stalagmite tip) and block states are the game's, not hand-made
// literals. The shape is the fleet's cave-fall cluster: a 3x5 dirt shelf at y=29 off a stone cliff, over a cave floor at
// y=7 (stalagmites at y=8). The executor (skills.mjs) runs on a fake bot. Mutants are anchored (present and unique).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Vec3 } from 'vec3'
import { mkWorld } from './helpers/reachlab.mjs'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const MC = require_('minecraft-data')('1.21.8')
const PB = require_('prismarine-block')('1.21.8')
/** A block in a given state (e.g. an OPEN trapdoor: one thin wall at z 0.8125..1). */
const stateBlock = (name, props) => PB.fromProperties(MC.blocksByName[name].id, props, 0)
const OPEN_TRAPDOOR = () => stateBlock('oak_trapdoor', { facing: 'north', half: 'bottom', open: true, powered: false, waterlogged: false })
/** Overlay real block objects on a shelf world. */
const withBlocks = (sh, cells) => ({ ...sh, at: (x, y, z) => { const k = `${x},${y},${z}`; return k in cells ? cells[k] : sh.at(x, y, z) } })
process.env.OLLAMA_MODEL ??= 'test'
process.env.HOME_X ??= '5000'; process.env.HOME_Y ??= '65'; process.env.HOME_Z ??= '5000'   // the town's ground far from every fixture
process.env.LOG_DIR ??= mkdtempSync(join(tmpdir(), 'cavefall-test-'))
const CF = await import('../src/cavefall.mjs')
const SK = await import('../src/skills.mjs')
const CF_URL = new URL('../src/cavefall.mjs', import.meta.url)
const SK_URL = new URL('../src/skills.mjs', import.meta.url)
const { cellKind, fallDamage, standable, dropIfRemoved, floorOverDrop, underFeet, floorRefusal, allFloorsMessage, skipDetail, baseFront, describeFloor, cavefallOn, cavefallModeDetail, SAFE_DROP, SCAN, NEEDS_SUPPORT } = CF

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}

// ---------------------------------------------------------------- worlds (block NAMES -> real registry blocks)
const key = (x, y, z) => `${x},${y},${z}`
/**
 * under: 'drip' (stalagmite tips at y=8), 'ground' (stone up to y=28), 'water' (y 8..9), 'lava' (y=8), 'unknown' (y < 20
 * unloaded), 'deep' (no floor). `set` overrides cells by name ('__unknown__' = unloaded).
 */
function shelf (under = 'drip', set = {}) {
  const fn = (x, y, z) => {
    const k = key(x, y, z)
    if (k in set) return set[k]
    if (y > 40 || y < -64) return 'air'
    if (x >= 0 && x <= 1 && y <= 29 && y >= 7) return 'stone'
    if (x >= 2 && x <= 4 && z >= 4 && z <= 8 && y === 29) return 'dirt'
    if (y > 29) return 'air'
    if (under === 'unknown' && y < 20) return '__unknown__'
    if (under === 'deep') return 'air'
    if (y <= 7) return 'stone'
    if (under === 'ground' && y <= 28) return 'stone'
    if (under === 'water' && y <= 9) return 'water'
    if (under === 'lava' && y === 8) return 'lava'
    if (under === 'drip' && y === 8) return 'pointed_dripstone'
    return 'air'
  }
  const w = mkWorld(fn)
  return { w, at: (x, y, z) => w.getBlock(new Vec3(x, y, z)) }
}
const T = { x: 3, y: 29, z: 6 }               // the shelf's centre cell
const CENTRE = { x: 3.5, y: 30, z: 6.5 }      // a body standing on it

// ---------------------------------------------------------------- the pure rule
await ta('cellKind on real blocks: unloaded is unknown; only an UP TIP is a stalagmite; carpet/slab/fence are solid; grass, snow(1) open', () => {
  const { at } = shelf('drip')
  assert.equal(cellKind(null), 'unknown')
  assert.equal(cellKind(at(3, 8, 6)), 'stalagmite')
  assert.equal(cellKind({ name: 'pointed_dripstone', props: { vertical_direction: 'up', thickness: 'frustum' }, boundingBox: 'block' }), 'solid')
  assert.equal(cellKind({ name: 'pointed_dripstone', props: { vertical_direction: 'down', thickness: 'tip' }, boundingBox: 'block' }), 'solid')
  const w = mkWorld(() => 'air')
  for (const [n, k] of [['white_carpet', 'solid'], ['stone_slab', 'solid'], ['oak_fence', 'solid'], ['short_grass', 'open'], ['snow', 'open'], ['water', 'water'], ['lava', 'lava'], ['magma_block', 'lava']]) {
    const b = mkWorld(() => n).getBlock(new Vec3(0, 0, 0)); assert.equal(cellKind(b), k, n)
  }
  assert.equal(cellKind(w.getBlock(new Vec3(0, 0, 0))), 'open')
})
await ta('fallDamage: rock ceil(d - 3), a stalagmite tip ceil(2(d - 1)), water 0, lava/unknown/deep not survivable', () => {
  assert.equal(fallDamage(3, 'solid'), 0); assert.equal(fallDamage(3.0625, 'solid'), 1); assert.equal(fallDamage(23, 'solid'), 20)
  assert.equal(fallDamage(1, 'stalagmite'), 0); assert.equal(fallDamage(2, 'stalagmite'), 2); assert.equal(fallDamage(11, 'stalagmite'), 20)
  assert.equal(fallDamage(80, 'water'), 0)
  for (const k of ['lava', 'unknown', 'deep']) assert.equal(fallDamage(1, k), Infinity)
  assert.equal(SAFE_DROP, 3)
})
await ta('the shelf cell over the cave is a floor over a drop: 21 onto a stalagmite tip (its 0.6875 top), skipped', () => {
  const v = floorOverDrop({ target: T, at: shelf('drip').at })
  assert.equal(v.skip, true); assert.equal(v.landing, 'stalagmite'); assert.equal(v.drop, 30 - (8 + 0.6875))
})
await ta('over ground (a 1-block self-dig) and over water the shelf cell is an ordinary target: the base dig is kept', () => {
  const g = floorOverDrop({ target: T, at: shelf('ground').at })
  assert.equal(g.skip, false); assert.equal(g.drop, 1); assert.equal(g.damage, 0)
  assert.equal(floorOverDrop({ target: T, at: shelf('water').at }).skip, false)
})
await ta('over lava, an unloaded column or no floor at all the shelf cell is skipped', () => {
  for (const u of ['lava', 'unknown', 'deep']) assert.equal(floorOverDrop({ target: T, at: shelf(u).at }).skip, true, u)
})
await ta('a drop of exactly 3 onto rock is allowed, 4 is skipped; a tip 1.3 below is skipped (ceil(2 x 0.3125) = 1)', () => {
  const at3 = shelf('ground', { [key(3, 28, 6)]: 'air', [key(3, 27, 6)]: 'air', [key(3, 26, 6)]: 'stone' }).at
  assert.equal(floorOverDrop({ target: T, at: at3 }).drop, 3); assert.equal(floorOverDrop({ target: T, at: at3 }).skip, false)
  const at4 = shelf('ground', { [key(3, 28, 6)]: 'air', [key(3, 27, 6)]: 'air', [key(3, 26, 6)]: 'air', [key(3, 25, 6)]: 'stone' }).at
  assert.equal(floorOverDrop({ target: T, at: at4 }).drop, 4); assert.equal(floorOverDrop({ target: T, at: at4 }).skip, true)
  const s1 = shelf('ground', { [key(3, 28, 6)]: 'pointed_dripstone' }).at   // a tip right under T: top 28.6875, drop 1.3125
  assert.equal(floorOverDrop({ target: T, at: s1 }).skip, true)
})
await ta('STRADDLE (Claude r1 P2-3, physics corrected): water deep under T, rock high under the open neighbour -> skipped', () => {
  // a falling body stops at the FIRST thing any part of it meets: centred on T it lands in water at y 11 (safe); straddling
  // the open east column it meets rock at y 21 first -- a 9-block fall
  const set = {}
  for (let y = 8; y <= 28; y++) set[key(4, y, 6)] = y <= 10 ? 'water' : 'air'
  for (let y = 8; y <= 28; y++) set[key(5, y, 6)] = y === 20 ? 'stone' : 'air'
  const v = floorOverDrop({ target: { x: 4, y: 29, z: 6 }, at: shelf('deep', set).at })
  assert.equal(v.skip, true); assert.deepEqual(v.col, [1, 0]); assert.equal(v.landing, 'solid'); assert.equal(v.drop, 9)
})
await ta('A LIP BESIDE A RAVINE (Codex r2 P2-5): rock 1 under T and an open ravine beside it -> allowed (the body meets T\'s floor first)', () => {
  const v = floorOverDrop({ target: { x: 4, y: 29, z: 6 }, at: shelf('deep', { [key(4, 28, 6)]: 'stone' }).at })
  assert.equal(v.skip, false); assert.equal(v.drop, 1)
})
await ta('PARTIAL SHAPES (Codex r2 P1): an open trapdoor under T is not a floor the body meets; one above T leaves room to stand', () => {
  const sh = shelf('drip')
  const under = withBlocks(sh, { [key(3, 28, 6)]: OPEN_TRAPDOOR() })
  const v = floorOverDrop({ target: T, at: under.at })
  assert.equal(v.skip, true, 'the trapdoor wall at z 0.81..1 misses a centred body'); assert.equal(v.landing, 'stalagmite')
  const above = withBlocks(sh, { [key(3, 30, 6)]: OPEN_TRAPDOOR() })
  assert.equal(standable(above.at, T), true); assert.equal(floorOverDrop({ target: T, at: above.at }).skip, true)
  // a CLOSED trapdoor directly under T IS a floor (full-width slab 0..0.1875): a 1-block drop
  const closed = withBlocks(sh, { [key(3, 28, 6)]: stateBlock('oak_trapdoor', { facing: 'north', half: 'bottom', open: false, powered: false, waterlogged: false }) })
  assert.equal(floorOverDrop({ target: T, at: closed.at }).skip, false)
})
await ta('A CLIFF LIP and A SHAFT RIM (Claude r2 P1) are kept: the body meets the rock under T first', () => {
  // the cliff's edge cell (1,29,6): solid all the way down in its own column, the cave beside it
  const lip = floorOverDrop({ target: { x: 1, y: 29, z: 6 }, at: shelf('drip').at })
  assert.equal(lip.skip, false); assert.equal(lip.drop, 1)
  // the rim of a 5-deep self-dug shaft beside T on solid ground
  const set = {}; for (let y = 24; y <= 28; y++) set[key(4, y, 6)] = 'air'; set[key(4, 29, 6)] = 'air'
  const rim = floorOverDrop({ target: T, at: shelf('ground', set).at })
  assert.equal(rim.skip, false); assert.equal(rim.drop, 1)
})
await ta('EDGE PLACEMENTS (Codex r3 P1): a fence post 2 under T over the cave does not hold a body standing at T\'s edge -> skipped', () => {
  // a centred body (and r3's half-straddles) met the post; a body at x 0.97 misses it and falls to the stalagmites
  // a lone dirt cell over the cave (no shelf neighbour to hold an edge placement), the post 2 under it
  const L = { x: 8, y: 29, z: 8 }
  const v = floorOverDrop({ target: L, at: shelf('drip', { [key(8, 29, 8)]: 'dirt', [key(8, 27, 8)]: 'oak_fence' }).at })
  assert.equal(v.skip, true); assert.equal(v.landing, 'stalagmite')
  // a full-width block 2 under it holds every placement: harmless (the positive control)
  assert.equal(floorOverDrop({ target: L, at: shelf('drip', { [key(8, 29, 8)]: 'dirt', [key(8, 27, 8)]: 'stone' }).at }).skip, false)
  // on the shelf, the same post under the centre cell: every edge placement that misses it rests on a shelf neighbour -> held
  assert.equal(floorOverDrop({ target: T, at: shelf('drip', { [key(3, 27, 6)]: 'oak_fence' }).at }).skip, false)
})
await ta('DEPARTURE HEIGHT (Codex r3 P2): a fence target departs from 1.5, so 3.5 above rock is harmful; a slab from 0.5', () => {
  const set = { [key(3, 29, 6)]: 'oak_fence', [key(3, 28, 6)]: 'air', [key(3, 27, 6)]: 'air', [key(3, 26, 6)]: 'stone' }
  const v = floorOverDrop({ target: T, at: shelf('ground', set).at })
  assert.equal(v.drop, 3.5); assert.equal(v.skip, true)
  const slab = floorOverDrop({ target: T, at: shelf('ground', { ...set, [key(3, 29, 6)]: 'stone_slab' }).at })
  assert.equal(slab.drop, 2.5); assert.equal(slab.skip, false)
})
await ta('standable: open above, or a block that needs T (carpet, rail) above; not under a solid block or a slab', () => {
  const { at } = shelf('drip', { [key(3, 30, 6)]: 'white_carpet', [key(2, 30, 6)]: 'stone_slab', [key(4, 30, 6)]: 'rail' })
  assert.equal(standable(at, T), true, 'carpet'); assert.equal(standable(at, { x: 4, y: 29, z: 6 }), true, 'rail')
  assert.equal(standable(at, { x: 2, y: 29, z: 6 }), false, 'a slab on top is its own floor')
  assert.ok(NEEDS_SUPPORT.test('white_carpet') && NEEDS_SUPPORT.test('moss_carpet') && NEEDS_SUPPORT.test('snow') && NEEDS_SUPPORT.test('stone_pressure_plate'))
})
await ta('CARPET ON THE SHELF (Codex/Claude r1): the dirt under a carpet over the cave is skipped -- the carpet pops with it', () => {
  assert.equal(floorOverDrop({ target: T, at: shelf('drip', { [key(3, 30, 6)]: 'white_carpet' }).at }).skip, true)
})
await ta('a CEILING block (ore in a cave roof, rock above it) is never a floor: the bot under it may dig it', () => {
  const { at } = shelf('drip', { [key(8, 20, 6)]: 'iron_ore', [key(8, 21, 6)]: 'stone' })
  assert.equal(floorOverDrop({ target: { x: 8, y: 20, z: 6 }, at }).skip, false)
  assert.equal(floorOverDrop({ target: { x: 8, y: 20, z: 6 }, at }).why, 'nothing can stand on it')
})
await ta('a cell that is not solid (air, water, a plant) is not a floor; a throwing reader fails closed only below T', () => {
  const { at } = shelf('drip')
  assert.equal(floorOverDrop({ target: { x: 3, y: 30, z: 6 }, at }).skip, false)
  assert.equal(floorOverDrop({ target: null, at }).skip, false)
  const v = floorOverDrop({ target: T, at: (x, y, z) => { if (y < 29) throw new Error('boom'); return at(x, y, z) } })
  assert.equal(v.skip, true); assert.equal(v.landing, 'unknown')
})
await ta('underFeet: the support cells under a 0.6-wide body (1, 2 or 4)', () => {
  assert.equal(underFeet(CENTRE, T), true); assert.equal(underFeet({ x: 3.9, y: 30, z: 6.5 }, { x: 4, y: 29, z: 6 }), true)
  assert.equal(underFeet(CENTRE, { x: 4, y: 29, z: 6 }), false); assert.equal(underFeet({ x: 3.5, y: 30.5, z: 6.5 }, { x: 3, y: 30, z: 6 }), true)
})
await ta('the messages put the remedy FIRST (gather keeps 120 characters of an error), and the rollback is one setting', () => {
  const v = floorOverDrop({ target: T, at: shelf('drip').at })
  const m = floorRefusal({ name: 'dirt', target: T, verdict: v })
  assert.match(m.slice(0, 40), /^floor_dig: dig elsewhere -- dirt at/)
  assert.match(m, /dirt at 3,29,6 is a floor over a 21.31-block drop onto stalagmite/)
  const a = allFloorsMessage({ name: 'dirt', n: 15, verdicts: [v] })
  assert.match(a, /^dirt found but all 15 candidate\(s\) are floors over a drop into a cave \(onto stalagmite\)/); assert.match(a, /gather dirt elsewhere, or explore$/)
  assert.equal(cavefallOn({}), true); assert.equal(cavefallOn({ CAVEFALL: '0' }), false)
  assert.match(cavefallModeDetail({}), /^on=1 rule=floor_over_drop/); assert.match(cavefallModeDetail({ CAVEFALL: '0' }), /^on=0 /)
  assert.equal(SCAN, 32)
})

// ---------------------------------------------------------------- the executor (skills.mjs) on a fake bot
function fakeBot (world, pos) {
  const walks = []
  const bot = {
    entity: { position: new Vec3(pos.x, pos.y, pos.z) },
    blockAt: v => world.at(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)),
    canDigBlock: () => true,
    pathfinder: { goto: async g => { walks.push(g) }, setGoal () {}, stop () {}, isMoving: () => false },
    inventory: { items: () => [] }, heldItem: null, equip: async () => {}, entities: {},
  }
  return { bot, walks }
}
const blockOf = (world, c) => world.at(c.x, c.y, c.z)

await ta('cavefallSkip / cavefallDigCheck: refuses the shelf cell over the cave with no_safe_target, remedy first; on:false is the base', () => {
  const s = shelf('drip'); const { bot } = fakeBot(s, CENTRE)
  assert.equal(SK.cavefallSkip(bot, new Vec3(3, 29, 6)).skip, true)
  assert.throws(() => SK.cavefallDigCheck(bot, blockOf(s, T)), e => e.failClass === 'no_safe_target' && /^floor_dig: dig elsewhere/.test(e.message))
  assert.doesNotThrow(() => SK.cavefallDigCheck(bot, blockOf(s, T), { on: false }))
  assert.equal(SK.cavefallSkip(bot, new Vec3(3, 29, 6), { on: false }).skip, false)
})
await ta('cavefallDigCheck: over ground and over water it lets the dig through', () => {
  for (const u of ['ground', 'water']) { const s = shelf(u); const { bot } = fakeBot(s, CENTRE); assert.doesNotThrow(() => SK.cavefallDigCheck(bot, blockOf(s, T)), u) }
})
await ta("THE ALLOWED ROW (Claude r2 P3-5): a standing floor dig with a 2-block drop writes one row, in the read's format", async () => {
  const set = { [key(3, 28, 6)]: 'air', [key(3, 27, 6)]: 'stone' }   // T over a 1-deep pocket: drop 2 onto rock, harmless
  const s2 = shelf('ground', set); const { bot } = fakeBot(s2, CENTRE)
  const { tapRecords } = await import('../src/logger.mjs')
  const rows = []
  const untap = tapRecords(rec => { if (rec?.skill?.name === '_cavefall_floor') rows.push(rec) })
  try {
    assert.doesNotThrow(() => SK.cavefallDigCheck(bot, blockOf(s2, T)))
    assert.equal(rows.length, 1, 'one _cavefall_floor row'); assert.match(rows[0].skill.detail, /^allowed: dirt at 3,29,6; drop 2 onto solid/)
    // quiet (the pre-walk call) and a 1-block drop (the plain self-dig) write none
    SK.cavefallDigCheck(bot, blockOf(s2, T), { quiet: true })
    const g = shelf('ground'); SK.cavefallDigCheck(fakeBot(g, CENTRE).bot, blockOf(g, T))
    assert.equal(rows.length, 1)
  } finally { untap() }
  const v = floorOverDrop({ target: T, at: s2.at })
  const d = describeFloor({ decision: 'allowed', target: T, name: 'dirt', verdict: v })
  assert.equal(d, 'allowed: dirt at 3,29,6; drop 2 onto solid (damage 0)')
  // the read's own pattern (scripts/host/cavefallread.py FLOOR), verbatim
  const FLOOR = /^(allowed|refused): (\S+) at (-?\d+),(-?\d+),(-?\d+); drop ([\d.]+|\?) onto (\w+)/
  assert.ok(FLOOR.test(d)); assert.ok(FLOOR.test(describeFloor({ decision: 'refused', target: T, name: 'dirt', verdict: floorOverDrop({ target: T, at: shelf('drip').at }) })))
})
await ta('skipDetail splits own-column and neighbour-column skips, with landing kinds', () => {
  const d = skipDetail({ name: 'dirt', considered: 9, verdicts: [{ col: [0, 0], landing: 'stalagmite' }, { col: [1, 0], landing: 'solid' }, { col: [0, 0], landing: 'stalagmite' }] })
  assert.equal(d, 'dirt: 3 of 9 candidate(s) are floors over a harmful drop; skipped own=2 nbr=1 land=stalagmite:2,solid:1 front=0')
  assert.match(skipDetail({ name: 'dirt', considered: 1, verdicts: [{ col: [0, 0], landing: 'deep' }], front: true }), / front=1$/)
})
await ta('baseFront: the base\'s two tiers (approachable first, then nearest) decide whether a skipped floor was its pick', () => {
  const eye = { x: 3.5, y: 30, z: 6.5 }
  const S = { x: 3, y: 29, z: 6 }, K = { x: 9, y: 29, z: 6 }
  assert.equal(baseFront({ pos: eye, skipped: [S], kept: [K] }), true)
  assert.equal(baseFront({ pos: eye, skipped: [K], kept: [S] }), false)
  assert.equal(baseFront({ pos: eye, skipped: [S], kept: [] }), true); assert.equal(baseFront({ pos: eye, skipped: [], kept: [S] }), false)
  // a NEARER skipped floor that is not approachable loses to an approachable kept one (the base's first tier)...
  const appr = c => c !== S
  assert.equal(baseFront({ pos: eye, skipped: [S], kept: [K], approachable: appr }), false)
  // ...but when nothing kept is approachable either, distance decides again (Claude r5 P3-2)
  assert.equal(baseFront({ pos: eye, skipped: [S], kept: [K], approachable: () => false }), true)
  // findBlocks' distance (block coordinates from the floored position), not eye-to-centre (Codex r6 P2)
  assert.equal(baseFront({ pos: { x: 0.5, y: 0, z: 0.5 }, skipped: [{ x: 2, y: 2, z: 0 }], kept: [{ x: 2, y: -1, z: 0 }] }), false)
})
await ta('THE FAST PATH changes no verdict: with and without it, the same skip on every cell of four worlds (shelf, cliff, cave floor, roof)', async () => {
  // Codex r4 P2-2's case: stone T on stone, LAVA beside the cell under T, open beside T -- and an unloaded neighbour
  const lavaSide = mkWorld((x, y, z) => (x === 20 && z === 20 && (y === 10 || y === 9)) ? 'stone' : (x === 21 && z === 20 && y === 9) ? 'lava' : 'air')
  // Codex r5 P2-1: stone T boxed in by stone (under and all four cardinals), a CARPET on it, lava diagonally above the side
  const carpetBox = mkWorld((x, y, z) => (y === 0 && Math.abs(x - 30) + Math.abs(z - 30) <= 1) || (x === 30 && z === 30 && y === -1) ? 'stone'
    : (x === 30 && z === 30 && y === 1) ? 'white_carpet' : (x === 31 && z === 31 && y === 1) ? 'lava' : 'air')
  const unkSide = mkWorld((x, y, z) => (x === 20 && z === 20 && (y === 10 || y === 9)) ? 'stone' : (x === 19 && z === 20 && y === 10) ? '__unknown__' : 'air')
  const worlds = [shelf('drip'), shelf('ground'), shelf('water'), shelf('drip', { [key(8, 20, 6)]: 'iron_ore', [key(8, 21, 6)]: 'stone', [key(3, 30, 6)]: 'white_carpet' }),
    { at: (x, y, z) => lavaSide.getBlock(new Vec3(x, y, z)) }, { at: (x, y, z) => unkSide.getBlock(new Vec3(x, y, z)) },
    { at: (x, y, z) => carpetBox.getBlock(new Vec3(x, y, z)) }]
  const cells = [{ x: 20, y: 10, z: 20 }, { x: 20, y: 9, z: 20 }, { x: 30, y: 0, z: 30 }]
  for (let x = -1; x <= 9; x++) for (const y of [7, 8, 20, 28, 29]) for (let z = 3; z <= 9; z += 3) cells.push({ x, y, z })
  const fast = worlds.map(w => cells.map(c => floorOverDrop({ target: c, at: w.at }).skip))
  assert.equal(fast[4][0], false, 'the lava-beside case: the cube under T catches the body first (a tie goes to the solid)')
  assert.equal(fast[5][0], true, 'an UNLOADED cell beside T at the body\'s own level is never assumed safe')
  assert.equal(fast[6][2], true, 'a carpet on a boxed-in T lifts the feet over the cardinals: the lava beside them is met (Codex r5)')
  const src = readFileSync(CF_URL, 'utf8')
  const fast1 = "    if (fullCube(rd(t.x, t.y + 1, t.z))) return { skip: false, why: 'nothing can stand on it' }\n"
  const i2 = src.indexOf('    if (!carries && fullCube(b) && fullCube(rd(t.x, t.y - 1, t.z))'), j2 = src.indexOf('    }\n', i2) + 6
  assert.ok(src.split(fast1).length === 2 && i2 > 0, 'both fast-path anchors present once')
  const slowSrc = (src.slice(0, i2) + src.slice(j2)).replace(fast1, '').replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-slow.mjs`, import.meta.url)
  writeFileSync(out, slowSrc)
  try {
    const m = await import(out.href)
    const slow = worlds.map(w => cells.map(c => m.floorOverDrop({ target: c, at: w.at }).skip))
    assert.deepEqual(slow, fast)
  } finally { try { unlinkSync(out) } catch {} }
  assert.ok(fast.flat().some(Boolean) && fast.flat().some(v => !v), 'the cells include both verdicts')
})
/** collectManually end to end: did it dig, and did it walk first? */
async function collect (mod, under, pos = CENTRE, { canDig = true } = {}) {
  const s = shelf(under); const { bot, walks } = fakeBot(s, pos)
  bot.canDigBlock = () => canDig
  let dug = false
  bot.dig = async () => { dug = true }
  let err = null
  try { await mod.collectManually(bot, blockOf(s, T), new AbortController().signal) } catch (e) { err = e }
  return { dug, walks: walks.length, err }
}
await ta('WIRING (behaviour): collectManually never digs the shelf cell over the cave, and does not walk for it either', async () => {
  const cave = await collect(SK, 'drip')
  assert.equal(cave.dug, false); assert.equal(cave.err?.failClass, 'no_safe_target')
  const far = await collect(SK, 'drip', { x: 0.5, y: 30, z: 6.5 }, { canDig: false })   // out of reach: it would walk first
  assert.equal(far.walks, 0, 'no stance walk is spent on a floor that will not be dug'); assert.equal(far.dug, false)
  const ground = await collect(SK, 'ground')
  assert.equal(ground.dug, true, 'over ground the base self-dig is unchanged')
})
await ta('THE LAST WORD (Codex r2 P2-3): the floor under T removed DURING the look -> the dig-time re-ask refuses it', async () => {
  // over ground the pre-walk check passes; the look (an await) is when another bot digs out the ground under T
  const live = {}
  const sh = shelf('ground')
  const world = { at: (x, y, z) => { const k = key(x, y, z); return k in live ? live[k] : sh.at(x, y, z) } }
  const { bot } = fakeBot(world, CENTRE)
  const AIR = mkWorld(() => 'air').getBlock(new Vec3(0, 0, 0))
  bot.lookAt = async () => { for (let y = 8; y <= 28; y++) live[key(3, y, 6)] = AIR }
  let dug = false
  bot.dig = async () => { dug = true }
  let err = null
  try { await SK.collectManually(bot, blockOf(world, T), new AbortController().signal) } catch (e) { err = e }
  assert.equal(dug, false); assert.equal(err?.failClass, 'no_safe_target')
})
/** The same scene, run against a module (for the mutant). */
async function lookRemovesFloor (mod) {
  const live = {}
  const sh = shelf('ground')
  const world = { at: (x, y, z) => { const k = key(x, y, z); return k in live ? live[k] : sh.at(x, y, z) } }
  const { bot } = fakeBot(world, CENTRE)
  const AIR = mkWorld(() => 'air').getBlock(new Vec3(0, 0, 0))
  bot.lookAt = async () => { for (let y = 8; y <= 28; y++) live[key(3, y, 6)] = AIR }
  let dug = false
  bot.dig = async () => { dug = true }
  try { await mod.collectManually(bot, blockOf(world, T), new AbortController().signal) } catch { /* refused or the fake pickup */ }
  return dug
}

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

await ta('MUTANT KILLED (wiring): without the dig-time call collectManually digs the shelf cell over the cave', async () => {
  // both calls removed: the pre-walk one and the dig-time one
  await withMutant(SK_URL, '    if (CAVEFALL_ON) cavefallDigCheck(bot, block)\n', '', async m1 => {
    const r = await collect(m1, 'drip')
    assert.equal(r.dug, false, 'the pre-walk call alone still refuses it')
  })
  const src = readFileSync(SK_URL, 'utf8')
  const pre = '  cavefallDigCheck(bot, block, { quiet: true })\n', dig = '    if (CAVEFALL_ON) cavefallDigCheck(bot, block)\n'
  assert.ok(src.split(pre).length === 2 && src.split(dig).length === 2, 'both calls present exactly once')
  const both = src.replace(pre, '').replace(dig, '').replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-both.mjs`, import.meta.url)
  writeFileSync(out, both)
  try { const m = await import(out.href); const r = await collect(m, 'drip'); assert.equal(r.dug, true, 'with neither call the floor over the cave is dug') }
  finally { try { unlinkSync(out) } catch {} }
})
await ta('caveFilter (behaviour): one verdict per cell across the exposed list and the fallbacks; counts and allSkipped', () => {
  const sh = shelf('drip'); const { bot } = fakeBot(sh, CENTRE)
  let reads = 0
  const counted = { ...bot, blockAt: v => { reads++; return bot.blockAt(v) } }
  const f = SK.caveFilter(counted)
  const shelfCells = [new Vec3(3, 29, 6), new Vec3(2, 29, 6), new Vec3(4, 29, 5)]
  assert.deepEqual(shelfCells.map(f.skip), [true, true, true])
  const r1 = reads
  assert.deepEqual(shelfCells.map(f.skip), [true, true, true]); assert.equal(reads, r1, 'memoised: a fallback re-asking a cell reads nothing')
  assert.equal(f.considered(), 3); assert.equal(f.skipped().length, 3); assert.equal(f.allSkipped(), true)
  // a cliff-top cell (rock under it) is an ordinary target: no longer all skipped
  assert.equal(f.skip(new Vec3(1, 29, 6)), false); assert.equal(f.allSkipped(), false); assert.equal(f.considered(), 4)
  assert.equal(SK.caveFilter(counted).allSkipped(), false, 'nothing asked is not "all skipped"')
  assert.equal(SK.caveFilter(counted, { on: false }).skip(new Vec3(3, 29, 6)), false)
})
await ta('WIRING (structural, comments stripped): safeTarget starts with the cave filter, and the round counts after both fallbacks', () => {
  // gatherRun does not run on a fake bot; caveFilter's behaviour is tested above and Paper runs gather end to end. This
  // asserts the two executable lines that wire it, and the mutant below proves the assertion can fail.
  const wired = src => {
    const c = src.replace(/\/\/.*$/gm, '')
    const body = c.slice(c.indexOf('async function gatherRun'), c.indexOf('async function keepoutExit'))
    const iFilter = body.indexOf('const safeTarget = p => !caveSkip(p) && baseSafe(p)')
    const iCave = body.indexOf('const cave = caveFilter(bot)'), iSkip = body.indexOf('const caveSkip = cave.skip')
    const iSource = body.indexOf('const cand = found.filter(exposed).filter(safeTarget)')
    const iCover = body.indexOf('positions.filter(q => foliageCovered(bot, q)).filter(safeTarget)')
    const iCoverEnd = body.indexOf('coverRounds++'), iCount = body.indexOf('const caveSkipped = caveInBorder()')
    // both fallbacks pass their candidates through safeTarget, and the round is counted AFTER the foliage fallback
    const iEnum = body.indexOf('if (b.position && searchFrom && b.position.distanceTo(searchFrom) <= maxDistance && cave.skip(b.position)) return false'), iNotTown = body.indexOf('const notTown = id => b => {')
    return iCave > 0 && iNotTown > iCave && iEnum > iNotTown && iEnum < iSkip && iSkip > iCave && iFilter > iSkip && iSource > iFilter && iCover > iSource && iCount > iCoverEnd && iCoverEnd > iCover
  }
  const src = readFileSync(SK_URL, 'utf8')
  assert.equal(wired(src), true)
  // each mutant makes the assertion fail (Codex r3 P2-5): filter removed; either fallback bypassing it; counting moved early
  const muts = [
    ['const safeTarget = p => !caveSkip(p) && baseSafe(p)', 'const safeTarget = p => baseSafe(p)'],
    ['const cand = found.filter(exposed).filter(safeTarget)', 'const cand = found.filter(exposed)'],
    ['positions.filter(q => foliageCovered(bot, q)).filter(safeTarget)', 'positions.filter(q => foliageCovered(bot, q))'],
    ['      if (b.position && searchFrom && b.position.distanceTo(searchFrom) <= maxDistance && cave.skip(b.position)) return false\n', ''],
  ]
  for (const [old, neu] of muts) {
    assert.ok(src.split(old).length === 2, `anchor present once: ${old.slice(0, 40)}`)
    assert.equal(wired(src.replace(old, neu)), false, `the mutant fails the assertion: ${neu.slice(0, 40)}`)
  }
  const cnt = '    const caveSkipped = caveInBorder()\n', at = '    const caveSkip = cave.skip'
  assert.ok(src.split(cnt).length === 2, 'count anchor present once'); assert.ok(src.split(at).length === 2, 'reinsertion anchor present once (Claude r4 P2-2)')
  const i = src.indexOf(at), eol = src.indexOf('\n', i) + 1
  const early = src.replace(cnt, '').slice(0, eol) + cnt + src.replace(cnt, '').slice(eol)
  assert.ok(early.indexOf(cnt) > 0 && early.indexOf(cnt) < early.indexOf('if (reachable.length === 0 && !viaSource)'), 'the mutant really moved the count before the fallbacks')
  assert.equal(wired(early), false, 'counting before the fallbacks fails the assertion')
  // the emptied search refuses BEFORE gather's early "nothing found" return (Claude r4 P1 / Codex r4 P2-1)
  const body = src.slice(src.indexOf('async function gatherRun'))
  const iEarly = body.indexOf('if (positions.length === 0 && !caveInBorder().length) {')
  assert.ok(iEarly > 0 && iEarly < body.indexOf("failClass: 'nothing_found'"), 'the early nothing_found return is taken only with no skip in the border')
})
await ta('MUTANT KILLED: a stalagmite read as rock lets a 2.3-block drop onto a tip through', async () => {
  const at = shelf('ground', { [key(3, 28, 6)]: 'air', [key(3, 27, 6)]: 'pointed_dripstone' }).at   // drop 2.3125: free onto rock, 3 onto a tip
  assert.equal(floorOverDrop({ target: T, at }).skip, true)
  await withMutant(CF_URL, "return up && tip ? 'stalagmite' : 'solid'", "return 'solid'", async m => {
    assert.equal(m.floorOverDrop({ target: T, at }).skip, false)
  })
})
await ta('MUTANT KILLED: an unloaded cell read as open turns an unknown column into a short "free" drop', async () => {
  const at = shelf('ground', { [key(3, 28, 6)]: '__unknown__', [key(3, 27, 6)]: 'air' }).at
  assert.equal(floorOverDrop({ target: T, at }).skip, true)
  await withMutant(CF_URL, "if (b == null) return 'unknown'", "if (b == null) return 'open'", async m => {
    assert.equal(m.floorOverDrop({ target: T, at }).skip, false)
  })
})
await ta('MUTANT KILLED: without the water branch a dig over water is refused (swimming is travel)', async () => {
  await withMutant(CF_URL, "if (landing === 'water') return 0", '', async m => {
    assert.equal(m.floorOverDrop({ target: T, at: shelf('water').at }).skip, true)
  })
})
await ta('MUTANT KILLED: ignoring the straddle scenarios misses the rock beside a flooded column', async () => {
  const set = {}
  for (let y = 8; y <= 28; y++) set[key(4, y, 6)] = y <= 10 ? 'water' : 'air'
  for (let y = 8; y <= 28; y++) set[key(5, y, 6)] = y === 20 ? 'stone' : 'air'
  const at = shelf('deep', set).at
  assert.equal(floorOverDrop({ target: { x: 4, y: 29, z: 6 }, at }).skip, true)
  await withMutant(CF_URL, 'export const PLACEMENTS = [-0.28, -0.12, 0.03, 0.19, 0.34, 0.5, 0.66, 0.81, 0.97, 1.12, 1.28]', 'export const PLACEMENTS = [0.5]', async m => {
    assert.equal(m.floorOverDrop({ target: { x: 4, y: 29, z: 6 }, at }).skip, false)
  })
})
await ta('MUTANT KILLED: without the carpet rule the dirt under a carpet over the cave is dug', async () => {
  const at = shelf('drip', { [key(3, 30, 6)]: 'white_carpet' }).at
  await withMutant(CF_URL, "const carried = above && NEEDS_SUPPORT.test(String(above.name ?? '')) ? above : null", 'const carried = null', async m => {
    assert.equal(m.floorOverDrop({ target: T, at }).skip, false)
  })
})
await ta('MUTANT KILLED: dropping the standable test skips a cave-roof ore the bot stands under', async () => {
  const at = shelf('drip', { [key(8, 20, 6)]: 'iron_ore', [key(8, 21, 6)]: 'stone' }).at
  const src0 = readFileSync(CF_URL, 'utf8')
  const fastRoof = "    if (fullCube(rd(t.x, t.y + 1, t.z))) return { skip: false, why: 'nothing can stand on it' }\n"
  assert.ok(src0.split(fastRoof).length === 2)
  await withMutant(CF_URL, 'if (meets(b, y, c.fp, feet + 0.01, feet + BODY_H)) blocked = true', 'if (false) blocked = true', async m0 => {
    assert.equal(m0.floorOverDrop({ target: { x: 8, y: 20, z: 6 }, at }).skip, false, 'the fast path alone still keeps it')
  })
  const both = src0.replace(fastRoof, '').replace('if (meets(b, y, c.fp, feet + 0.01, feet + BODY_H)) blocked = true', 'if (false) blocked = true').replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-roof.mjs`, import.meta.url)
  writeFileSync(out, both)
  try { const m = await import(out.href); assert.equal(m.floorOverDrop({ target: { x: 8, y: 20, z: 6 }, at }).skip, true) } finally { try { unlinkSync(out) } catch {} }
})

await ta('MUTANT KILLED: a landing that ignores the footprint lands the body on an open trapdoor it would miss', async () => {
  const under = withBlocks(shelf('drip'), { [key(3, 28, 6)]: OPEN_TRAPDOOR() })
  await withMutant(CF_URL, 'if (s[0] < fp.x[1] && s[3] > fp.x[0] && s[2] < fp.z[1] && s[5] > fp.z[0]) top', 'if (true) top', async m => {
    assert.equal(m.floorOverDrop({ target: T, at: under.at }).skip, false)
  })
})
await ta('MUTANT KILLED: without the partial-shape rule above T, an open trapdoor over the shelf cell hides the floor', async () => {
  const above = withBlocks(shelf('drip'), { [key(3, 30, 6)]: OPEN_TRAPDOOR() })
  await withMutant(CF_URL, 'const meets = (b, cy, fp, lo, hi) => shapesOf(b).some(s => s[0] < fp.x[1] && s[3] > fp.x[0] && s[2] < fp.z[1] && s[5] > fp.z[0] && ', 'const meets = (b, cy, fp, lo, hi) => shapesOf(b).some(s => ', async m => {
    assert.equal(m.floorOverDrop({ target: T, at: above.at }).skip, false)
  })
})

await ta('MUTANT KILLED: without the re-ask after the look, a floor dug out during the look is dug', async () => {
  assert.equal(await lookRemovesFloor(SK), false)
  await withMutant(SK_URL, '    if (CAVEFALL_ON) cavefallDigCheck(bot, block)\n', '', async m => {
    assert.equal(await lookRemovesFloor(m), true)
  })
})

await ta('MUTANT KILLED: without the PRE-WALK call alone, a far floor over the cave is walked to first (then refused at the dig)', async () => {
  await withMutant(SK_URL, '  cavefallDigCheck(bot, block, { quiet: true })\n', '', async m => {
    const r = await collect(m, 'drip', { x: 0.5, y: 30, z: 6.5 }, { canDig: false })
    assert.equal(r.walks, 1, 'the mutant spends a stance walk'); assert.equal(r.dug, false, 'the dig-time re-ask still refuses')
  })
})
await ta('CAVEFALL=0 keeps the base dig sequence exactly: no forced look, dig(block, undefined) (Claude r3 P3-4)', async () => {
  const { execFileSync } = await import('node:child_process')
  const { pathToFileURL } = await import('node:url')
  const script = join(mkdtempSync(join(tmpdir(), 'cavefall-off-')), 'off.mjs')
  writeFileSync(script, `
    const { Vec3 } = await import(${JSON.stringify(import.meta.resolve('vec3'))})
    const SK = await import(${JSON.stringify(SK_URL.href)})
    const { mkWorld } = await import(${JSON.stringify(new URL('./helpers/reachlab.mjs', import.meta.url).href)})
    const w = mkWorld((x, y, z) => (y <= 29 && x >= 0 && x <= 6 && z >= 0 && z <= 9) ? 'stone' : 'air')
    const looks = [], digs = []
    const bot = { entity: { position: new Vec3(3.5, 30, 6.5) }, blockAt: v => w.getBlock(v), canDigBlock: () => true,
      pathfinder: { goto: async () => {}, setGoal () {}, stop () {} }, inventory: { items: () => [] }, heldItem: null, equip: async () => {}, entities: {},
      lookAt: async (p, force) => { looks.push(force) }, dig: async (b, f) => { digs.push(f === undefined ? 'undefined' : f) } }
    try { await SK.collectManually(bot, w.getBlock(new Vec3(3, 29, 6)), new AbortController().signal) } catch {}
    console.log(JSON.stringify({ looks, digs }))
  `)
  const run = env => JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, ...env }, cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }).trim().split('\n').pop())
  const off = run({ CAVEFALL: '0' }), on = run({ CAVEFALL: '1' })
  assert.deepEqual(off, { looks: [], digs: ['undefined'] }, 'the base: the library looks inside dig')
  assert.deepEqual(on, { looks: [true], digs: ['ignore'] }, 'on: an instant look, the re-ask, then dig with ignore')
  void pathToFileURL
})

// ---------------------------------------------------------------- gather itself (gatherRun) on a fake findBlocks that applies the
// matcher, as keepout-protectzone-compose.test.mjs's gatherWorld does: the enumeration-time verdict, the all-floors refusal
// and its row, and a mixed round taking the nearest dirt that is not a floor (Claude r4 P1, Codex r4 P2-1)
function gatherShelf ({ shelfDirt, rockDirt = [], at = [3.5, 30, 6.5] }) {
  const MCD = MC
  const D = MCD.blocksByName.dirt
  const dirt = [...shelfDirt, ...rockDirt]
  const set = new Set(dirt.map(([x, y, z]) => key(x, y, z)))
  const rock = new Set([...rockDirt.map(([x, y, z]) => key(x, y - 1, z)), ...[...Array(15)].map((_, i) => key(0, 29 - i, 6))])
  const digs = []
  const blk = (x, y, z) => {
    const isDirt = set.has(key(x, y, z)), isRock = !isDirt && rock.has(key(x, y, z))
    const t = isDirt ? D : isRock ? MCD.blocksByName.stone : MCD.blocksByName.air
    return { name: t.name, type: t.id, position: new Vec3(x, y, z), boundingBox: (isDirt || isRock) ? 'block' : 'empty', diggable: isDirt,
             canHarvest: () => true, digTime: () => 50, material: 'mineable/shovel', hardness: isDirt ? 0.5 : 0 }
  }
  const bot = {
    entity: { position: new Vec3(...at), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20,
    inventory: { items: () => [], emptySlotCount: () => 30 },
    registry: { blocksByName: MCD.blocksByName, blocks: MCD.blocks, itemsByName: MCD.itemsByName },
    blockAt: p => blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && b.type === matching)
      if (!fn({ type: D.id, name: 'dirt' })) return []
      return dirt.map(([x, y, z]) => blk(x, y, z)).filter(b => b.position.distanceTo(bot.entity.position) <= maxDistance && fn(b))
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, count).map(b => b.position)
    },
    collectBlock: { movements: {} },
    pathfinder: { movements: {}, setMovements () {}, setGoal () {}, stop () {}, isMining: () => false, async goto () {} },
    nearestEntity: () => null, entities: {},
    async dig (b) { digs.push(b.position); set.delete(key(b.position.x, b.position.y, b.position.z)) },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
    fireSitesNow: () => [], protectZones: () => [],
  }
  return { bot, digs }
}
const SHELF_CELLS = []; for (let x = 2; x <= 4; x++) for (let z = 4; z <= 8; z++) SHELF_CELLS.push([x, 29, z])
const runGather = bot => SK.SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
await ta('GATHER (behaviour): every dirt in range a floor over the void -> no_safe_target, the all-floors message, one skip row, no dig', async () => {
  const { tapRecords } = await import('../src/logger.mjs')
  const rows = []; const untap = tapRecords(r => { if (r?.skill?.name === '_cavefall_skip') rows.push(r.skill.detail) })
  try {
    const { bot, digs } = gatherShelf({ shelfDirt: SHELF_CELLS })
    const r = await runGather(bot)
    assert.equal(digs.length, 0, `dug ${JSON.stringify(digs)}`)
    assert.equal(r.failClass, 'no_safe_target', JSON.stringify(r).slice(0, 200)); assert.match(r.detail, /are floors over a drop into a cave/)
    assert.ok(rows.length >= 1, 'a skip row'); assert.match(rows[0], /^dirt: 15 of \d+ candidate\(s\) are floors over a harmful drop; skipped own=15 /)
    assert.match(rows[0], / front=1$/, 'with nothing kept, an exposed, permitted shelf cell is the base\'s front pick')
  } finally { untap() }
})
await ta('GATHER (behaviour): a mixed round digs the nearest dirt that is NOT a floor (on rock 6 blocks off), never a shelf cell', async () => {
  const { bot, digs } = gatherShelf({ shelfDirt: SHELF_CELLS, rockDirt: [[9, 29, 6]] })
  await runGather(bot)
  assert.ok(digs.length >= 1, 'it dug'); assert.deepEqual([digs[0].x, digs[0].y, digs[0].z], [9, 29, 6])
  assert.ok(!digs.some(p => p.x >= 2 && p.x <= 4 && p.y === 29), 'never the shelf')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
