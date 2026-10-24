// CAVEFALL-01 (docs/reports/cavefall-01-design-2026-10-24.md): gather never digs the block under the feet over a harmful
// drop; it steps beside it first, and only skips the candidate (naming the remedy) when no stance beside it is reachable.
//
// Behaviour only: the pure rule (cavefall.mjs) on synthetic worlds shaped like the fleet's cave-fall cluster (a dirt shelf
// at y=29 over a cave floor at y=7 with stalagmites), and the REAL executor (skills.mjs cavefallFloorGuard) on a fake bot
// whose pathfinder moves it to the goal cell, or does not. Mutants are anchored (present and unique) and must turn a
// named assertion red.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { Vec3 } from 'vec3'
process.env.OLLAMA_MODEL ??= 'test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.LOG_DIR ??= mkdtempSync(join(tmpdir(), 'cavefall-test-'))
const CF = await import('../src/cavefall.mjs')
const SK = await import('../src/skills.mjs')
const { supportY, supportCells, cellKind, dropBelow, fallDamage, floorDigVerdict, sideStances, floorRefusal, cavefallOn, cavefallModeDetail, SAFE_DROP, SCAN } = CF

let pass = 0, fail = 0
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}

// ---------------------------------------------------------------- synthetic worlds
const B = {
  air: { name: 'air', boundingBox: 'empty' }, stone: { name: 'stone', boundingBox: 'block' }, dirt: { name: 'dirt', boundingBox: 'block' },
  drip: { name: 'pointed_dripstone', boundingBox: 'block' }, water: { name: 'water', boundingBox: 'empty' }, lava: { name: 'lava', boundingBox: 'empty' },
  grass: { name: 'short_grass', boundingBox: 'empty' },
}
const key = (x, y, z) => `${x},${y},${z}`
/**
 * The fleet's shape: a 2-wide stone cliff at x 0..1 (top y=29), a 3x5 dirt shelf x 2..4, z 4..8 at y=29, a cave below
 * (floor stone at y=7). under: 'drip' (stalagmites at y=8), 'ground' (stone up to y=28), 'water' (y 8..9), 'lava' (y 8),
 * 'unknown' (cells y<20 unloaded), 'deep' (no floor at all).
 */
function shelfWorld (under = 'drip', { shelf = true } = {}) {
  const m = new Map()
  return {
    m,
    at (x, y, z) {
      const k = key(x, y, z)
      if (m.has(k)) return m.get(k)
      if (y > 40 || y < -64) return B.air
      if (x >= 0 && x <= 1 && y <= 29 && y >= 7) return B.stone                    // the cliff
      if (shelf && x >= 2 && x <= 4 && z >= 4 && z <= 8 && y === 29) return B.dirt   // the shelf
      if (y > 29) return B.air
      if (under === 'unknown' && y < 20) return null
      if (under === 'deep') return B.air
      if (y <= 7) return B.stone
      if (under === 'ground' && y <= 28) return B.stone
      if (under === 'water' && y <= 9) return B.water
      if (under === 'lava' && y === 8) return B.lava
      if (under === 'drip' && y === 8) return B.drip
      return B.air
    },
  }
}
const CENTRE = { x: 3.5, y: 30, z: 6.5 }        // on shelf cell (3,29,6)
const UNDER = { x: 3, y: 29, z: 6 }

// ---------------------------------------------------------------- the pure rule
await ta('supportY: feet 31.0 stand on y=30, feet 31.5 (a slab) on y=31', () => {
  assert.equal(supportY(31), 30); assert.equal(supportY(31.5), 31); assert.equal(supportY(31.0000001), 30); assert.equal(supportY(30.9999999), 30)
})
await ta('supportCells: centred is one cell, an edge two, a corner four (the 0.6-wide box)', () => {
  assert.equal(supportCells({ x: 3.5, y: 30, z: 6.5 }).length, 1)
  assert.deepEqual(supportCells({ x: 3.2, y: 30, z: 6.5 }).map(c => c.x).sort(), [2, 3])
  assert.equal(supportCells({ x: 3.1, y: 30, z: 6.9 }).length, 4)
  assert.deepEqual(supportCells({ x: 3.5, y: 30, z: 6.5 })[0], { x: 3, y: 29, z: 6 })
})
await ta('cellKind: unloaded is unknown, never open; dripstone is a stalagmite; grass is open', () => {
  assert.equal(cellKind(null), 'unknown'); assert.equal(cellKind(B.drip), 'stalagmite'); assert.equal(cellKind(B.lava), 'lava')
  assert.equal(cellKind(B.water), 'water'); assert.equal(cellKind(B.stone), 'solid'); assert.equal(cellKind(B.grass), 'open'); assert.equal(cellKind(B.air), 'open')
  assert.equal(cellKind({ name: 'flowing_lava', boundingBox: 'empty' }), 'lava')
})
await ta('dropBelow: the shelf over the cave is a 21-block drop onto a stalagmite; over ground, 1 onto stone', () => {
  assert.deepEqual(dropBelow(shelfWorld('drip').at, UNDER), { drop: 21, landing: 'stalagmite', landY: 8 })
  assert.deepEqual(dropBelow(shelfWorld('ground').at, UNDER), { drop: 1, landing: 'solid', landY: 28 })
  assert.equal(dropBelow(shelfWorld('water').at, UNDER).landing, 'water')
  assert.equal(dropBelow(shelfWorld('lava').at, UNDER).landing, 'lava')
  assert.equal(dropBelow(shelfWorld('unknown').at, UNDER).landing, 'unknown')
  assert.deepEqual(dropBelow(shelfWorld('deep').at, UNDER), { drop: SCAN + 1, landing: 'deep', landY: null })
})
await ta('fallDamage: 3 onto stone is free, 4 costs 1; a stalagmite doubles (2d - 1); water is free; lava/unknown/deep are not survivable', () => {
  assert.equal(fallDamage(3, 'solid'), 0); assert.equal(fallDamage(4, 'solid'), 1); assert.equal(fallDamage(22, 'solid'), 19); assert.equal(fallDamage(23, 'solid'), 20)
  assert.equal(fallDamage(1, 'stalagmite'), 1); assert.equal(fallDamage(11, 'stalagmite'), 21); assert.equal(fallDamage(12, 'stalagmite'), 23)
  assert.equal(fallDamage(60, 'water'), 0)
  for (const k of ['lava', 'unknown', 'deep']) assert.equal(fallDamage(2, k), Infinity)
  assert.equal(SAFE_DROP, 3)
})
await ta('floorDigVerdict: the shelf cell under a centred bot over the cave is a floor dig, REFUSED', () => {
  const v = floorDigVerdict({ pos: CENTRE, target: UNDER, at: shelfWorld('drip').at })
  assert.equal(v.floor, true); assert.equal(v.allow, false); assert.equal(v.landing, 'stalagmite'); assert.equal(v.drop, 21)
})
await ta('floorDigVerdict: over ground (a 1-block drop) the floor dig is ALLOWED -- the base behaviour is kept', () => {
  const v = floorDigVerdict({ pos: CENTRE, target: UNDER, at: shelfWorld('ground').at })
  assert.equal(v.floor, true); assert.equal(v.allow, true); assert.equal(v.damage, 0)
})
await ta('floorDigVerdict: over water the floor dig is ALLOWED (swimming is travel); over lava, unknown or deep it is refused', () => {
  assert.equal(floorDigVerdict({ pos: CENTRE, target: UNDER, at: shelfWorld('water').at }).allow, true)
  for (const u of ['lava', 'unknown', 'deep']) assert.equal(floorDigVerdict({ pos: CENTRE, target: UNDER, at: shelfWorld(u).at }).allow, false, u)
})
await ta('floorDigVerdict: a target beside the bot, or one the box does not overlap, is not a floor dig', () => {
  const w = shelfWorld('drip')
  assert.equal(floorDigVerdict({ pos: CENTRE, target: { x: 4, y: 29, z: 6 }, at: w.at }).floor, false)
  assert.equal(floorDigVerdict({ pos: CENTRE, target: { x: 3, y: 28, z: 6 }, at: w.at }).floor, false)
  assert.equal(floorDigVerdict({ pos: CENTRE, target: { x: 3, y: 30, z: 6 }, at: w.at }).floor, false)
})
await ta('floorDigVerdict: a bot straddling two shelf cells keeps a support, so neither is a floor dig; straddling the edge, it is', () => {
  const w = shelfWorld('drip')
  assert.equal(floorDigVerdict({ pos: { x: 3.1, y: 30, z: 6.5 }, target: UNDER, at: w.at }).floor, false)    // also on (2,29,6)
  // the shelf's east edge: x=4.9 overlaps (4,29,6) and (5,29,6), which is open over the cave
  const v = floorDigVerdict({ pos: { x: 4.9, y: 30, z: 6.5 }, target: { x: 4, y: 29, z: 6 }, at: w.at })
  assert.equal(v.floor, true); assert.equal(v.allow, false)
})
await ta('floorDigVerdict: never throws; a reader that throws reads as unknown (refused), a missing position as not a floor dig', () => {
  assert.equal(floorDigVerdict({ pos: null, target: UNDER, at: () => B.stone }).floor, false)
  const w = shelfWorld('drip')
  const v = floorDigVerdict({ pos: CENTRE, target: UNDER, at: (x, y, z) => { if (y < 29) throw new Error('boom'); return w.at(x, y, z) } })
  assert.equal(v.floor, true); assert.equal(v.allow, false); assert.equal(v.landing, 'unknown')
})
await ta('sideStances: on the shelf centre the four shelf neighbours come first (cardinals), the target is never one', () => {
  const s = sideStances({ pos: CENTRE, target: UNDER, at: shelfWorld('drip').at })
  assert.deepEqual(s.slice(0, 4), [{ x: 4, y: 30, z: 6 }, { x: 2, y: 30, z: 6 }, { x: 3, y: 30, z: 7 }, { x: 3, y: 30, z: 5 }])
  assert.ok(!s.some(c => c.x === 3 && c.z === 6))
  assert.equal(s.length, 8)
})
await ta('sideStances: a cell over the cave (no floor), a stalagmite floor, or one with no headroom is not a stance', () => {
  const w = shelfWorld('drip')
  // the bot on the shelf's NE corner cell (4,29,8): only the two shelf neighbours (3,8) and (4,7) and the diagonal (3,7)
  const s = sideStances({ pos: { x: 4.5, y: 30, z: 8.5 }, target: { x: 4, y: 29, z: 8 }, at: w.at })
  assert.deepEqual(s, [{ x: 3, y: 30, z: 8 }, { x: 4, y: 30, z: 7 }, { x: 3, y: 30, z: 7 }])
  w.m.set(key(3, 29, 8), B.drip); w.m.set(key(4, 31, 7), B.stone)
  assert.deepEqual(sideStances({ pos: { x: 4.5, y: 30, z: 8.5 }, target: { x: 4, y: 29, z: 8 }, at: w.at }), [{ x: 3, y: 30, z: 7 }])
})
await ta('sideStances: a lone 1x1 dirt cell over the cave has no stance at all', () => {
  const w = shelfWorld('drip', { shelf: false }); w.m.set(key(6, 29, 6), B.dirt)
  assert.deepEqual(sideStances({ pos: { x: 6.5, y: 30, z: 6.5 }, target: { x: 6, y: 29, z: 6 }, at: w.at }), [])
})
await ta('the refusal names a remedy the bot can perform from where it stands, and the rollback is one setting', () => {
  const v = floorDigVerdict({ pos: CENTRE, target: UNDER, at: shelfWorld('drip').at })
  const msg = floorRefusal({ name: 'dirt', target: UNDER, verdict: v, tried: 0 })
  assert.match(msg, /^floor_dig: dirt at 3,29,6/); assert.match(msg, /21-block drop onto stalagmite/)
  assert.match(msg, /walk off it onto solid ground first/); assert.match(msg, /gather dirt somewhere else/)
  assert.equal(cavefallOn({}), true); assert.equal(cavefallOn({ CAVEFALL: '0' }), false); assert.equal(cavefallOn({ CAVEFALL: '1' }), true)
  assert.match(cavefallModeDetail({}), /^on=1 /); assert.match(cavefallModeDetail({ CAVEFALL: '0' }), /^on=0 /)
})

// ---------------------------------------------------------------- the executor (skills.mjs), on a fake bot
/**
 * A fake bot on a synthetic world. pathfinder.goto(GoalBlock) moves the bot to the goal cell's centre when `moves` is true
 * (and records the goal); otherwise it rejects like a pathfinder that found no way.
 */
function fakeBot (world, pos, { moves = true, reach = true } = {}) {
  const goals = []
  const bot = {
    entity: { position: new Vec3(pos.x, pos.y, pos.z) },
    blockAt: v => { const b = world.at(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)); return b ? { ...b, position: new Vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)) } : null },
    canDigBlock: () => reach,
    pathfinder: {
      goto: async g => {
        goals.push({ x: g.x, y: g.y, z: g.z })
        if (!moves) throw Object.assign(new Error('No path to the goal!'), { name: 'NoPath' })
        bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5)
      },
      setGoal () {}, stop () {}, isMoving: () => false,
    },
    inventory: { items: () => [] },
  }
  return { bot, goals }
}
const blockOf = (world, c) => ({ ...world.at(c.x, c.y, c.z), position: new Vec3(c.x, c.y, c.z) })

await ta('EXECUTOR: a floor dig over the cave walks to the first stance beside it, then lets the dig go ahead', async () => {
  const w = shelfWorld('drip'); const { bot, goals } = fakeBot(w, CENTRE)
  await SK.cavefallFloorGuard(bot, blockOf(w, UNDER), new AbortController().signal, { on: true })
  assert.deepEqual(goals, [{ x: 4, y: 30, z: 6 }])
  assert.equal(floorDigVerdict({ pos: bot.entity.position, target: UNDER, at: w.at }).floor, false, 'from the stance the dig is a side dig')
})
await ta('EXECUTOR: no stance beside it -> no_safe_target with the remedy, and no walk was tried', async () => {
  const w = shelfWorld('drip', { shelf: false }); w.m.set(key(6, 29, 6), B.dirt)
  const { bot, goals } = fakeBot(w, { x: 6.5, y: 30, z: 6.5 })
  await assert.rejects(SK.cavefallFloorGuard(bot, blockOf(w, { x: 6, y: 29, z: 6 }), new AbortController().signal, { on: true }),
    e => e.failClass === 'no_safe_target' && /walk off it onto solid ground first/.test(e.message) && /there is no stance beside it/.test(e.message))
  assert.equal(goals.length, 0)
})
await ta('EXECUTOR: stances that cannot be walked to are tried (at most 3), then refused naming how many', async () => {
  const w = shelfWorld('drip'); const { bot, goals } = fakeBot(w, CENTRE, { moves: false })
  await assert.rejects(SK.cavefallFloorGuard(bot, blockOf(w, UNDER), new AbortController().signal, { on: true, stepMs: 200 }),
    e => e.failClass === 'no_safe_target' && /3 tried/.test(e.message))
  assert.equal(goals.length, 3)
})
await ta('EXECUTOR: a stance from which the target is out of reach is not accepted; the next one is tried', async () => {
  const w = shelfWorld('drip'); const { bot, goals } = fakeBot(w, CENTRE, { reach: false })
  await assert.rejects(SK.cavefallFloorGuard(bot, blockOf(w, UNDER), new AbortController().signal, { on: true, stepMs: 200 }), e => e.failClass === 'no_safe_target')
  assert.equal(goals.length, 3)
})
await ta('EXECUTOR: over ground, water, or a target beside the bot it does nothing (no walk): the base dig is unchanged', async () => {
  for (const u of ['ground', 'water']) {
    const w = shelfWorld(u); const { bot, goals } = fakeBot(w, CENTRE)
    await SK.cavefallFloorGuard(bot, blockOf(w, UNDER), new AbortController().signal, { on: true })
    assert.equal(goals.length, 0, u)
  }
  const w = shelfWorld('drip'); const { bot, goals } = fakeBot(w, CENTRE)
  await SK.cavefallFloorGuard(bot, blockOf(w, { x: 4, y: 29, z: 6 }), new AbortController().signal, { on: true })
  assert.equal(goals.length, 0)
})
await ta('EXECUTOR: CAVEFALL=0 (on: false) is the base exactly -- no walk, no throw, even over the cave', async () => {
  const w = shelfWorld('drip'); const { bot, goals } = fakeBot(w, CENTRE)
  await SK.cavefallFloorGuard(bot, blockOf(w, UNDER), new AbortController().signal, { on: false })
  assert.equal(goals.length, 0)
})
await ta('EXECUTOR: an abort before the walk propagates as an abort, not as a refusal', async () => {
  const w = shelfWorld('drip'); const { bot } = fakeBot(w, CENTRE)
  const ac = new AbortController(); ac.abort()
  await assert.rejects(SK.cavefallFloorGuard(bot, blockOf(w, UNDER), ac.signal, { on: true }), e => e.aborted === true || e.name === 'Aborted' || /abort/i.test(String(e.message)))
})

// ---------------------------------------------------------------- mutants (anchored: present and unique)
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

await ta('MUTANT KILLED: ignoring the other support cells makes a straddling bot refuse a harmless dig', async () => {
  await withMutant(CF_URL, 'if (others > 0) return', 'if (others > 99) return', async m => {
    assert.equal(m.floorDigVerdict({ pos: { x: 3.1, y: 30, z: 6.5 }, target: UNDER, at: shelfWorld('drip').at }).floor, true)
  })
})
await ta('MUTANT KILLED: treating a stalagmite like stone lets a 3-block drop onto one through', async () => {
  // a shelf 3 above a stalagmite: free onto stone, 5 damage onto the tip
  const w = shelfWorld('ground'); for (let y = 26; y <= 28; y++) w.m.set(key(3, y, 6), y === 26 ? B.drip : B.air)
  assert.equal(floorDigVerdict({ pos: CENTRE, target: UNDER, at: w.at }).allow, false)
  await withMutant(CF_URL, "if (n === 'pointed_dripstone') return 'stalagmite'", '', async m => {
    assert.equal(m.floorDigVerdict({ pos: CENTRE, target: UNDER, at: w.at }).allow, true)
  })
})
await ta('MUTANT KILLED: an unloaded cell read as open would turn an unknown column into a short, "free" drop', async () => {
  // the cell under the shelf is unloaded and stone sits 3 below: the truth is "unknown" (refused); the mutant reads 3 onto stone
  const w = shelfWorld('ground'); w.m.set(key(3, 28, 6), null); w.m.set(key(3, 27, 6), B.air)
  assert.equal(floorDigVerdict({ pos: CENTRE, target: UNDER, at: w.at }).allow, false)
  await withMutant(CF_URL, "if (b == null) return 'unknown'", "if (b == null) return 'open'", async m => {
    assert.equal(m.floorDigVerdict({ pos: CENTRE, target: UNDER, at: w.at }).allow, true)
  })
})
await ta('MUTANT KILLED: dropping the water branch refuses a dig over water (swimming is travel)', async () => {
  await withMutant(CF_URL, "if (landing === 'water') return 0", '', async m => {
    assert.equal(m.floorDigVerdict({ pos: CENTRE, target: UNDER, at: shelfWorld('water').at }).allow, false)
  })
})
await ta('MUTANT KILLED: a stance whose floor is the target itself would be offered', async () => {
  // straddle so that the box overlaps the target only, and (3,30,6) would be the target's own column
  await withMutant(CF_URL, 'if (same({ x: s.x, y: s.y - 1, z: s.z }, t)) continue', '', async m => {
    const s = m.sideStances({ pos: { x: 4.5, y: 30, z: 6.5 }, target: UNDER, at: shelfWorld('drip').at })
    assert.ok(s.some(c => c.x === 3 && c.z === 6), 'the mutant offers the target column')
  })
  assert.ok(!sideStances({ pos: { x: 4.5, y: 30, z: 6.5 }, target: UNDER, at: shelfWorld('drip').at }).some(c => c.x === 3 && c.z === 6))
})
/** collectManually end to end on the fake bot: where was the bot standing when bot.dig was called? */
async function digStance (mod, under = 'drip') {
  const w = shelfWorld(under); const { bot } = fakeBot(w, CENTRE)
  let at = null
  bot.dig = async b => { at = { ...bot.entity.position }; w.m.set(key(b.position.x, b.position.y, b.position.z), B.air) }
  bot.heldItem = null; bot.equip = async () => {}; bot.entities = {}
  try { await mod.collectManually(bot, blockOf(w, UNDER), new AbortController().signal) } catch { /* the pickup sweep may refuse on the fake bot */ }
  return at
}
await ta("WIRING (behaviour): gather's dig site digs the shelf cell from BESIDE it over the cave, and from on top over ground", async () => {
  const cave = await digStance(SK, 'drip')
  assert.ok(cave, 'the dig happened'); assert.notDeepEqual([Math.floor(cave.x), Math.floor(cave.z)], [3, 6], 'dug from a stance beside the target')
  const ground = await digStance(SK, 'ground')
  assert.ok(ground, 'the dig happened'); assert.deepEqual([Math.floor(ground.x), Math.floor(ground.z)], [3, 6], 'over ground the base dig (standing on it) is unchanged')
})
await ta('MUTANT KILLED (wiring): collectManually without the guard call digs the floor it stands on over the cave', async () => {
  await withMutant(SK_URL, '  await cavefallFloorGuard(bot, block, signal)\n', '', async m => {
    const cave = await digStance(m, 'drip')
    assert.ok(cave, 'the mutant dug'); assert.deepEqual([Math.floor(cave.x), Math.floor(cave.z)], [3, 6], 'the mutant dug standing on the target')
  })
})
await ta('MUTANT KILLED: an executor that skips the re-judgement after the walk accepts a walk that went nowhere', async () => {
  await withMutant(SK_URL, 'if (!v.floor || v.allow) {', 'if (true) {', async m => {
    const w = shelfWorld('drip'); const { bot } = fakeBot(w, CENTRE, { moves: false })
    await m.cavefallFloorGuard(bot, blockOf(w, UNDER), new AbortController().signal, { on: true, stepMs: 200 })   // resolves: the mutant digs the floor
  })
  const w = shelfWorld('drip'); const { bot } = fakeBot(w, CENTRE, { moves: false })
  await assert.rejects(SK.cavefallFloorGuard(bot, blockOf(w, UNDER), new AbortController().signal, { on: true, stepMs: 200 }))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
