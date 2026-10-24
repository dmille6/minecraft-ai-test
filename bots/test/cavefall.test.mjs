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
process.env.OLLAMA_MODEL ??= 'test'
process.env.LOG_DIR ??= mkdtempSync(join(tmpdir(), 'cavefall-test-'))
const CF = await import('../src/cavefall.mjs')
const SK = await import('../src/skills.mjs')
const { cellKind, fallDamage, standable, dropIfRemoved, floorOverDrop, underFeet, floorRefusal, allFloorsMessage, cavefallOn, cavefallModeDetail, SAFE_DROP, SCAN, NEEDS_SUPPORT } = CF

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
await ta('a body on T overlaps the open neighbour columns: the WORST fall among them decides (water under T, rock beside)', () => {
  // the shelf's east edge cell (4,29,6): T's own column is flooded deep; the open column east of it (x=5) lands on rock 14 below
  const set = {}
  for (let y = 8; y <= 28; y++) set[key(4, y, 6)] = y <= 20 ? 'water' : 'air'
  for (let y = 8; y <= 28; y++) set[key(5, y, 6)] = y === 15 ? 'stone' : 'air'
  const v = floorOverDrop({ target: { x: 4, y: 29, z: 6 }, at: shelf('deep', set).at })
  assert.equal(v.skip, true); assert.deepEqual(v.col, [1, 0]); assert.equal(v.landing, 'solid')
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
  assert.match(m.slice(0, 40), /^floor_dig: gather dirt elsewhere/)
  assert.match(m, /3,29,6 is a floor over a 21.3125-block drop onto stalagmite/)
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
  assert.throws(() => SK.cavefallDigCheck(bot, blockOf(s, T)), e => e.failClass === 'no_safe_target' && /^floor_dig: gather dirt elsewhere/.test(e.message))
  assert.doesNotThrow(() => SK.cavefallDigCheck(bot, blockOf(s, T), { on: false }))
  assert.equal(SK.cavefallSkip(bot, new Vec3(3, 29, 6), { on: false }).skip, false)
})
await ta('cavefallDigCheck: over ground and over water it lets the dig through', () => {
  for (const u of ['ground', 'water']) { const s = shelf(u); const { bot } = fakeBot(s, CENTRE); assert.doesNotThrow(() => SK.cavefallDigCheck(bot, blockOf(s, T)), u) }
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
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const CF_URL = new URL('../src/cavefall.mjs', import.meta.url)
const SK_URL = new URL('../src/skills.mjs', import.meta.url)

await ta('MUTANT KILLED (wiring): without the dig-time call collectManually digs the shelf cell over the cave', async () => {
  // both calls removed: the pre-walk one and the dig-time one
  await withMutant(SK_URL, '  cavefallDigCheck(bot, block)\n', '', async m1 => {
    const r = await collect(m1, 'drip')
    assert.equal(r.dug, false, 'the pre-walk call alone still refuses it')
  })
  const src = readFileSync(SK_URL, 'utf8')
  const pre = '  cavefallDigCheck(bot, block, { quiet: true })\n', dig = '  cavefallDigCheck(bot, block)\n'
  assert.ok(src.split(pre).length === 2 && src.split(dig).length === 2, 'both calls present exactly once')
  const both = src.replace(pre, '').replace(dig, '').replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-both.mjs`, import.meta.url)
  writeFileSync(out, both)
  try { const m = await import(out.href); const r = await collect(m, 'drip'); assert.equal(r.dug, true, 'with neither call the floor over the cave is dug') }
  finally { try { unlinkSync(out) } catch {} }
})
await ta('MUTANT KILLED (wiring): the candidate filter -- removing caveSkip from safeTarget admits the floors again', async () => {
  // gatherRun is not callable on a fake bot; the filter's predicate is asserted through the line that composes it
  const src = readFileSync(SK_URL, 'utf8').replace(/\/\/.*$/gm, '')
  const line = 'const safeTarget = p => !caveSkip(p) && townTargetPermit('
  assert.ok(src.split(line).length === 2, 'the filter line composes caveSkip exactly once (comments stripped)')
  assert.ok(/const caveSkip = p => caveVerdict\(p\)\.skip/.test(src) && /caveMemo\.set\(k, cavefallSkip\(bot, p\)\)/.test(src), 'caveSkip is the live rule')
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
await ta('MUTANT KILLED: reading only T\'s column misses the rock beside a flooded column', async () => {
  const set = {}
  for (let y = 8; y <= 28; y++) set[key(4, y, 6)] = y <= 20 ? 'water' : 'air'
  for (let y = 8; y <= 28; y++) set[key(5, y, 6)] = y === 15 ? 'stone' : 'air'
  const at = shelf('deep', set).at
  await withMutant(CF_URL, "    if (cellKind(b) === 'open') cols.push([dx, dz])", '', async m => {
    assert.equal(m.floorOverDrop({ target: { x: 4, y: 29, z: 6 }, at }).skip, false)
  })
})
await ta('MUTANT KILLED: without the carpet rule the dirt under a carpet over the cave is dug', async () => {
  const at = shelf('drip', { [key(3, 30, 6)]: 'white_carpet' }).at
  await withMutant(CF_URL, "return k === 'open' || NEEDS_SUPPORT.test(String(a.name ?? ''))", "return k === 'open'", async m => {
    assert.equal(m.floorOverDrop({ target: T, at }).skip, false)
  })
})
await ta('MUTANT KILLED: dropping the standable test skips a cave-roof ore the bot stands under', async () => {
  const at = shelf('drip', { [key(8, 20, 6)]: 'iron_ore', [key(8, 21, 6)]: 'stone' }).at
  await withMutant(CF_URL, "    if (!standable(at, t)) return { skip: false, why: 'nothing can stand on it' }\n", '', async m => {
    assert.equal(m.floorOverDrop({ target: { x: 8, y: 20, z: 6 }, at }).skip, true)
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
