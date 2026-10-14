// THE TOWN'S GROUND x MINEWELL-01's KEEP-OUT (townzone-01 on minewell-01, operator option (b), 10-15).
//
// Two planners in `mine` -- minewell's (every bearing's whole stair simulated against the wells' shells and a composed
// `forbid`, with its own walk-offs) and the zone's (a bearing filter, roof climb, walk-outs) -- could leave NO bearing
// (choice null: `choice.bear` threw) and undid each other's walks (a well walk-off promises only > 12 from home; the
// town's square is 16). Now the town is ONE MORE KEEP-OUT in minewell's composed `forbid`: one plan, one walk-off target
// that satisfies every keep-out at once, one per-dig stop. These tests drive the REAL mine skill's decision loop (plan ->
// walk off -> plan again -> stair) through the combinations, perform the remedy a refusal names, and kill mutants whose
// anchors are asserted present and unique.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
process.env.HOME_X = '200'; process.env.HOME_Y = '65'; process.env.HOME_Z = '200'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { Vec3 } from 'vec3'

const SK = await import('../src/skills.mjs')
const MW = await import('../src/minewell.mjs')
const { townDigClass, townKeepOut, TOWN_GROUND_HALF } = await import('../src/townground.mjs')
const HOME = { x: 200, y: 65, z: 200 }
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)
const MINEWELL_URL = new URL('../src/minewell.mjs', import.meta.url)

async function withPlannerMutant (old, neu, fn) {
  const src = readFileSync(MINEWELL_URL, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`
  const mw = new URL(`./_mutant-tzmw-${tag}.mjs`, import.meta.url), sk = new URL(`./_mutant-tzsk-${tag}.mjs`, import.meta.url)
  writeFileSync(mw, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  const skSrc = readFileSync(SKILLS_URL, 'utf8')
  assert.equal(skSrc.split("from './minewell.mjs'").length, 2, 'skills.mjs imports minewell.mjs once')
  writeFileSync(sk, skSrc.replace("from './minewell.mjs'", `from './_mutant-tzmw-${tag}.mjs'`).replace(/from '\.\/(?!_mutant-tzmw-)/g, "from '../src/"))
  try { return await fn(await import(sk.href), await import(mw.href)) } finally { for (const u of [mw, sk]) { try { unlinkSync(u) } catch {} } }
}

// ---- the micro-world: stone below y 65, air above; wells injected as known columns -----------------------------------
const V = (x, y, z) => new Vec3(x, y, z)
const AIR = { name: 'air', boundingBox: 'empty', type: 0 }, STONE = { name: 'stone', boundingBox: 'block', type: 1 }, WATER = { name: 'water', boundingBox: 'empty', type: 2 }
function world ({ at, wells = [], wet = () => false } = {}) {
  const carved = new Set(), digs = [], walks = []
  const k = (x, y, z) => `${x},${y},${z}`
  const base = p => carved.has(k(p.x, p.y, p.z)) ? AIR : wet(p.x, p.y, p.z) ? WATER : p.y < 65 ? STONE : AIR
  const bot = {
    entity: { position: V(...at), yaw: 0, velocity: V(0, 0, 0), onGround: true },
    health: 20, food: 20, oxygenLevel: 300, heldItem: { type: 1 },
    blockAt: p => ({ ...base(p), position: V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 50, material: 'rock' }),
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'cobblestone', count: 512 }] },
    equip: async () => {},
    dig: async b => { digs.push(V(b.position.x, b.position.y, b.position.z)); carved.add(k(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      movements: {}, setMovements () {}, setGoal () {}, stop () {}, isMining: () => false, isMoving: () => false,
      goto: async goal => {
        const to = V(goal.x, Math.floor(goal.y ?? bot.entity.position.y), goal.z)
        walks.push(to)
        if (base(to).boundingBox === 'block' || base(to.offset(0, 1, 0)).boundingBox === 'block') return
        bot.entity.position = to
      },
    },
    setControlState () {}, clearControlStates () {}, lookAt: async () => {}, registry: { blocksByName: {}, itemsByName: {} }, players: {}, entities: {},
    wellCellsNow: () => wells, _digs: digs, _walks: walks,
  }
  return bot
}
const runMine = (mod, bot, y = 40) => mod.SKILLS.mine.run({ bot }, { y }, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))
const townDigs = bot => bot._digs.filter(p => townDigClass(p, 'stone', HOME) === 'ground')
const shellDigs = (bot, wells) => bot._digs.filter(p => MW.shellOf(wells, p))

// THE CORNER: the bot on the square's north-east corner (216, 184). Town ground lies SOUTH and WEST of it; a junk well
// sits NORTH (cap 216,64,181) and another EAST (cap 219,64,184), so the outward stairs cut a shell. No bearing is clear.
const CORNER = [216, 65, 184]
const WELLS = [{ x: 216, y: 64, z: 181 }, { x: 219, y: 64, z: 184 }]

test('THE CORNER, pure: from the corner every bearing is blocked -- north and east by a shell, south and west by the town (positive control: the town alone leaves north and east)', () => {
  const bot = world({ at: CORNER })
  const nameAt = (x, y, z) => bot.blockAt(V(x, y, z)).name
  const k = MW.composeKeepOut(townKeepOut(HOME, nameAt))
  const B = { n: { x: 0, z: -1 }, e: { x: 1, z: 0 }, s: { x: 0, z: 1 }, w: { x: -1, z: 0 } }
  const p0 = { x: 216, y: 65, z: 184 }
  const of = (cols, b) => MW.stairClear(cols, p0, b, { forbid: k.forbid, forbidBottom: k.bottom })
  assert.equal(of([], B.n).clear, true, 'control: north is clear of the town'); assert.equal(of([], B.e).clear, true, 'control: east too')
  assert.equal(of([], B.s).hit?.kind, 'town'); assert.equal(of([], B.w).hit?.kind, 'town')
  assert.ok(of(WELLS, B.n).hit?.cap, 'north meets a shell'); assert.ok(of(WELLS, B.e).hit?.cap, 'east meets a shell')
})

test('THE CORNER through the real skill: well N/E + town S/W -> ONE walk-off to a start clear of both, then a stair -- no shell cell, no town ground', async () => {
  const bot = world({ at: CORNER, wells: WELLS })
  const r = await runMine(SK, bot)
  assert.equal(r.status, 'success', `${r.status} ${String(r.detail).slice(0, 200)}`)
  assert.deepEqual(shellDigs(bot, WELLS), [], 'dug a shell')
  assert.deepEqual(townDigs(bot), [], 'dug town ground')
  assert.ok(bot._walks.length >= 1, 'it walked off first')
  assert.ok(bot._digs.length > 3, 'and descended')
})

test('POSITIVE CONTROL: no wells -> from the corner the stair goes straight out (no walk), still no town ground', async () => {
  const bot = world({ at: CORNER })
  const r = await runMine(SK, bot)
  assert.equal(r.status, 'success', `${r.status} ${String(r.detail).slice(0, 160)}`)
  assert.deepEqual(townDigs(bot), [])
  assert.equal(bot._walks.filter(w => w.y >= 65).length, 0, 'no walk-off was needed')
})

test('MUTANT KILLED (minewell): starts judged against the wells only -- the plan takes the town\'s bearings and the per-dig stop ends the stair at once (no descent)', async () => {
  await withPlannerMutant('  const clearFrom = from => bearings.filter(b => stairClear(wells, from, b, { goalY, forbid, forbidBottom }).clear)\n',
    '  const clearFrom = from => bearings.filter(b => stairClear(wells, from, b, { goalY }).clear)\n', async mod => {
      const bot = world({ at: CORNER, wells: WELLS })
      const r = await runMine(mod, bot)
      assert.notEqual(r.status, 'success', `the mutant cannot descend: ${r.status} ${String(r.detail).slice(0, 160)}`)
      assert.deepEqual(townDigs(bot), [], 'the one per-dig stop still guards the town')
    })
})

// FULLY BOXED: the corner again, and every start the rings or the far starts could offer stands in water (the surface
// within 20 of the bot and within 30 of home is a moat) -- nothing anywhere near is a legal start.
const MOAT = (x, y, z) => y === 64 && !(x === 216 && z === 184) && (Math.max(Math.abs(x - 216), Math.abs(z - 184)) <= 20 || Math.hypot(x - 200, z - 200) < 30)

test('FULLY BOXED through the real skill: a refusal (never a throw, never a dig) that names the town AND the well and a move the bot can make -- and the move, performed, works', async () => {
  const bot = world({ at: CORNER, wells: WELLS, wet: MOAT })
  const r = await runMine(SK, bot)
  assert.notEqual(r.status, 'threw', `no null deref: ${r.detail}`)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'town_ground', r.detail)
  assert.equal(bot._digs.length, 0, 'nothing dug')
  assert.match(r.detail, /^reason=town_ground /)
  assert.match(r.detail, /the junk well/, 'the well is named too')
  const m = r.detail.match(/goto a dry spot (\d+)\+ blocks from home/)
  assert.ok(m, r.detail)
  // THE REMEDY, PERFORMED: a dry spot that far from home (south, away from the wells), then mine
  const spot = { x: HOME.x, y: 65, z: HOME.z + Number(m[1]) + 10 }
  await bot.pathfinder.goto(spot)
  assert.equal(bot.entity.position.z, spot.z, 'the walk was made')
  const again = await runMine(SK, bot)
  assert.equal(again.status, 'success', `${again.status} ${String(again.detail).slice(0, 160)}`)
  assert.deepEqual(shellDigs(bot, WELLS), []); assert.deepEqual(townDigs(bot), [])
})

test('THE ESCAPE EXEMPTION: a bot INSIDE a well column inside town gets the well\'s own way out (the rim), not the town\'s refusal -- nothing dug', async () => {
  const bot = world({ at: [216, 62, 181], wells: WELLS })
  bot.entity.position = V(216.5, 62.2, 181.5)
  const r = await runMine(SK, bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'forbidden', r.detail)
  assert.match(r.detail, /inside the junk well/)
  assert.equal(bot._digs.length, 0)
})

// ---- the composition itself (pure) ---------------------------------------------------------------------------------
test('COMPOSE: variadic -- the first part that claims a cell names it, the bottom is the lowest, a part without a forbid is ignored', () => {
  const farm = { forbid: c => c.x === 1 || false, bottom: 60 }, town = { forbid: c => (c.x === 2 ? 'town' : null), bottom: 53 }, mon = { forbid: c => (c.x === 3 ? 'monument' : null), bottom: 70 }
  const k = MW.composeKeepOut(farm, { forbid: null, bottom: null }, town, mon)
  assert.equal(k.forbid({ x: 1 }), true); assert.equal(k.forbid({ x: 2 }), 'town'); assert.equal(k.forbid({ x: 3 }), 'monument'); assert.equal(k.forbid({ x: 4 }), false)
  assert.equal(k.bottom, 53)
  assert.deepEqual(MW.composeKeepOut({ forbid: null }, undefined), { forbid: null, bottom: null })
  assert.equal(MW.keepOutLabel('town'), "the town's ground"); assert.equal(MW.keepOutLabel(true), 'the town tree farm'); assert.equal(MW.keepOutLabel('monument'), 'the town monument (the ziggurat)')
})

test('ONE TARGET FOR EVERY KEEP-OUT (pure): wells, a farm-like keep-out and the town at once -- the walk-off target and its bearings are clear under EACH of them separately', () => {
  const bot = world({ at: CORNER })
  const nameAt = (x, y, z) => bot.blockAt(V(x, y, z)).name
  const town = townKeepOut(HOME, nameAt)
  const plots = new Set(['217,64,178', '218,64,178', '219,64,178', '222,64,183', '222,64,184', '222,64,185'])   // a farm north-east, beyond the wells
  const farm = { forbid: c => plots.has(`${c.x},${c.y},${c.z}`), bottom: 64 }
  const k = MW.composeKeepOut(farm, town)
  const bearings = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]
  const standable = c => c.y === 65 && Math.hypot(c.x - 200, c.z - 200) > 12
  const p = MW.planMineStart({ cols: WELLS, p0: { x: 216, y: 65, z: 184 }, bearings, standable, forbid: k.forbid, forbidBottom: k.bottom, radius: MW.FAR_RADIUS })
  assert.equal(p.action, 'relocate', JSON.stringify(p))
  assert.deepEqual([...p.kinds].sort(), ['town', 'well'])
  for (const b of p.bearings) {
    assert.ok(MW.stairClear(WELLS, p.to, b, {}).clear, 'clear of the wells')
    assert.ok(MW.stairClear([], p.to, b, { forbid: farm.forbid, forbidBottom: farm.bottom }).clear, 'clear of the farm')
    assert.ok(MW.stairClear([], p.to, b, { forbid: town.forbid, forbidBottom: town.bottom }).clear, 'clear of the town')
  }
})

test('MUTANT KILLED (minewell): a two-argument compose (the shape structureguard-01 had) silently drops a third keep-out', async () => {
  await withPlannerMutant('export function composeKeepOut (...parts) {\n  const live = parts.filter(p => typeof p?.forbid === \'function\')\n',
    'export function composeKeepOut (a, b) {\n  const live = [a, b].filter(p => typeof p?.forbid === \'function\')\n', async (_sk, mw) => {
      const k = mw.composeKeepOut({ forbid: () => null, bottom: 60 }, { forbid: () => null, bottom: 60 }, { forbid: c => (c.x === 2 ? 'town' : null), bottom: 53 })
      assert.equal(k.forbid({ x: 2 }), false, 'the mutant lost the town')
    })
  const k = MW.composeKeepOut({ forbid: () => null, bottom: 60 }, { forbid: () => null, bottom: 60 }, { forbid: c => (c.x === 2 ? 'town' : null), bottom: 53 })
  assert.equal(k.forbid({ x: 2 }), 'town', 'the real compose keeps it')
})

test('NEVER A NULL CHOICE: mine guards chooseStairBearing\'s null and names a move (the allowed list empty)', () => {
  const fake = { entity: { yaw: 0 }, blockAt: () => ({ name: 'stone', boundingBox: 'block' }) }
  assert.equal(SK.chooseStairBearing(fake, V(0, 70, 0), 4, []), null)
  // the guard is executable code right after the call, before `choice.bear` (structural: behaviour cannot reach it -- a
  // 'go' plan always carries a bearing)
  const src = readFileSync(SKILLS_URL, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const i = src.indexOf('const choice = chooseStairBearing(bot, bot.entity.position.floored(), undefined, wellPlan.bearings)')
  assert.ok(i > 0 && src.indexOf('const choice = chooseStairBearing(bot, bot.entity.position.floored(), undefined, wellPlan.bearings)', i + 1) === -1, 'one call site')
  const guard = src.indexOf('if (!choice) {', i), use = src.indexOf('const bear = choice.bear', i)
  assert.ok(guard > i && guard < use, 'the guard sits between the call and the first use')
  assert.match(src.slice(guard, use), /goto a dry spot/)
})
