// CLEANZONE-02 (cleanzone.mjs + skills.mjs gather): gather does not take the ground inside the clean zone, and when that
// empties its search it WALKS OUT and searches again (the remedy, performed). The REAL gather skill is driven through the
// refusal chain over townground.test.mjs's fake world; the rule itself is pure and tested as such.
process.env.LOG_DIR ??= '/tmp'
process.env.STATE_DIR ??= '/tmp'
process.env.HOME_X = '200'; process.env.HOME_Y = '65'; process.env.HOME_Z = '200'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const CZ = await import('../src/cleanzone.mjs')
const SK = await import('../src/skills.mjs')
const { SKILLS } = SK
const HOME = { x: 200, y: 65, z: 200 }
const ZONE = CZ.cleanZoneOf(HOME)
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)

async function withMutantsAll (url, pairs, fn) {
  let src = readFileSync(url, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
    assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const ENUM = ["      if (b.position && gatherZoneHit(bot, b.position, b.name)) { if (searchFrom", "      if (false) { if (searchFrom"]
const SAFE = ["      !gatherZoneHit(bot, p, bot.blockAt(p)?.name) &&", "      true &&"]
const SWING = ["  else if (gatherZoneHit(bot, block.position, block.name)) {\n", "  else if (false) {\n"]

// ---- pure ----------------------------------------------------------------------------------------------------------
test('RULE: terrain inside the zone\'s square is not a gather target at any depth; logs, leaves, crops and ores are', () => {
  assert.equal(ZONE.R, 64); assert.equal(ZONE.hy, 65)
  for (const n of ['dirt', 'grass_block', 'sand', 'gravel', 'stone', 'cobblestone', 'deepslate']) assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 230, y: 63, z: 200 }, n, 64), true, n)
  for (const n of ['oak_log', 'spruce_leaves', 'wheat', 'iron_ore', 'coal_ore', 'sugar_cane']) assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 230, y: 63, z: 200 }, n, 64), false, n)
  assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 264, y: 63, z: 136 }, 'dirt', 64), true, 'the square\'s corner')
  assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 265, y: 63, z: 200 }, 'dirt', 64), false, 'one past the square')
  assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 230, y: 20, z: 200 }, 'stone', 64), true, 'a surface bot may not take the rock under the town either (the pit again)')
  assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 230, y: 300, z: 200 }, 'dirt', 64), true, 'no upper cutoff')
  assert.equal(CZ.gatherZoneRefuses(null, { x: 230, y: 63, z: 200 }, 'dirt', 64), false, 'no zone (no home): fails open')
  assert.equal(CZ.gatherZoneRefuses(ZONE, null, 'dirt', 64), false)
})
test('RULE, the one exception: a bot that is itself below the band may take terrain that is also below it', () => {
  const deepY = ZONE.hy - CZ.GATHER_ZONE.deep
  assert.equal(deepY, 41)
  assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 210, y: 30, z: 200 }, 'stone', 32), false, 'a miner takes the rock around it')
  assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 210, y: 40, z: 200 }, 'stone', 40.5), false, 'just under the band, both')
  assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 210, y: 41, z: 200 }, 'stone', 32), true, 'the cell is in the band')
  assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 210, y: 30, z: 200 }, 'stone', 41), true, 'the bot is in the band')
  assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 210, y: 30, z: 200 }, 'stone', null), true, 'the bot\'s height unknown: no exception')
  assert.equal(CZ.gatherZoneRefuses(ZONE, { x: 210, y: 30, z: 200 }, 'stone', NaN), true)
})
test('EXITS: the four points beyond the square, nearest first; never across the town; none without a zone', () => {
  const R = ZONE.R + CZ.GATHER_ZONE.out
  assert.deepEqual(CZ.gatherExitPoints({ x: 230, y: 64, z: 205 }, ZONE), [{ x: 200 + R, z: 205 }, { x: 230, z: 200 + R }, { x: 230, z: 200 - R }, { x: 200 - R, z: 205 }])
  assert.deepEqual(CZ.gatherExitPoints({ x: 200.5, y: 64, z: 150.2 }, ZONE)[0], { x: 200, z: 200 - R })
  const fromOutside = CZ.gatherExitPoints({ x: 268, y: 64, z: 200 }, ZONE)
  assert.ok(!fromOutside.some(p => p.x === 200 - R), 'a bot east of the square is never sent to the west exit')
  for (const p of CZ.gatherExitPoints({ x: 230, y: 64, z: 205 }, ZONE)) assert.equal(CZ.inZoneSquare(ZONE, p.x, p.z), false, 'every exit is outside')
  assert.deepEqual(CZ.gatherExitPoints({ x: 230, z: 205 }, null), [])
  assert.deepEqual(CZ.gatherExitPoints(null, ZONE), [])
})
test('SWITCH and WORDS: GATHERZONE=off turns it off; the remedy names a place a goto can be given', () => {
  for (const v of ['off', '0', 'false', 'no']) assert.equal(CZ.gatherZoneOn({ GATHERZONE: v }), false)
  for (const v of [undefined, '', '1', 'on']) assert.equal(CZ.gatherZoneOn({ GATHERZONE: v }), true)
  assert.match(CZ.gatherZoneRemedy(ZONE, { x: 270, z: 205 }), /within 64 blocks of home .*: goto 270 65 205 and gather there$/)
  assert.match(CZ.gatherZoneRemedy(ZONE), /gather more than 64 blocks from home$/)
  assert.equal(CZ.gatherZoneModeDetail({}, ZONE), 'op=mode on=1 r=64 deep_y=41 out=6 walk_ms=25000 exits=2 trap_r=3 trap_max=8')
})

// ---- the refusal chain through the REAL gather -----------------------------------------------------------------------
// townground.test.mjs's fake bot (findBlocks behaves like mineflayer's: palette pre-check without a position, then per cell),
// with a pathfinder.goto that WALKS: a GoalNearXZ moves the bot there (walk: 'ok'), throws (walk: 'fail') or goes nowhere.
function gatherWorld ({ dirt, at = [200.5, 64, 200.5], walk = 'ok', items = [], matcherFirst = false, tower = [mcData.itemsByName.dirt.id, mcData.itemsByName.cobblestone.id] }) {
  const D = mcData.blocksByName.dirt, AIRT = mcData.blocksByName.air
  const set = new Set(dirt.map(([x, y, z]) => `${x},${y},${z}`))
  const rock = new Set(dirt.map(([x, y, z]) => `${x},${y - 1},${z}`))
  const digs = [], walks = [], events = [], hang = { reject: null, halts: 0 }
  const blk = (x, y, z) => {
    const isDirt = set.has(`${x},${y},${z}`)
    const isRock = !isDirt && rock.has(`${x},${y},${z}`)
    const t = isDirt ? D : isRock ? mcData.blocksByName.stone : AIRT
    return { name: t.name, type: t.id, position: new Vec3(x, y, z), boundingBox: (isDirt || isRock) ? 'block' : 'empty', diggable: isDirt,
             canHarvest: () => true, digTime: () => 50, material: 'mineable/shovel', hardness: isDirt ? 0.5 : 0 }
  }
  const bot = {
    entity: { position: new Vec3(...at), velocity: new Vec3(0, 0, 0), onGround: true, yaw: 0 },
    health: 20, food: 20,
    inventory: { items: () => items, emptySlotCount: () => 30 },
    registry: { blocksByName: mcData.blocksByName, blocks: mcData.blocks, itemsByName: mcData.itemsByName },
    blockAt: p => blk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    findBlocks ({ matching, maxDistance = 16, count = 1 }) {
      const fn = typeof matching === 'function' ? matching : (b => b && (Array.isArray(matching) ? matching.includes(b.type) : b.type === matching))
      if (!fn({ type: D.id, name: 'dirt' })) return []
      // matcherFirst: as mineflayer does it (blocks.js: the matcher is asked BEFORE the distance test)
      const inRange = b => b.position.distanceTo(bot.entity.position) <= maxDistance
      return [...set].map(k => blk(...k.split(',').map(Number))).filter(b => matcherFirst ? (fn(b) && inRange(b)) : (inRange(b) && fn(b)))
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, count).map(b => b.position)
    },
    collectBlock: { movements: {} },
    pathfinder: { movements: { scafoldingBlocks: tower }, setMovements () {}, stop () {}, isMining: () => false,
      setGoal (g) { if (g === null) { hang.halts++; hang.reject?.(Object.assign(new Error('The goal was changed before it could be completed!'), { name: 'GoalChanged' })); hang.reject = null } },
      async goto (goal) {
        if (goal?.constructor?.name !== 'GoalNearXZ') return
        walks.push([goal.x, goal.z]); events.push('walk')
        // 'nopath': the library's own rejection when the A* drained its heap; 'changed': another goal took over;
        // 'short': the bot gets 6 blocks toward the exit and no further; 'stay': the library's empty-path RESOLVE
        if (walk === 'nopath') throw Object.assign(new Error('No path to the goal!'), { name: 'NoPath' })
        // 'budget': skills.mjs withTimeout's own rejection when the walk's time ran out (the bot did not move)
        if (walk === 'budget') throw Object.assign(new Error('walking out of the town before gathering exceeded 25000ms'), { failClass: 'walking out of the town before gathering_budget', budgetExceeded: true })
        if (walk === 'changed') throw Object.assign(new Error('The goal was changed before it could be completed!'), { name: 'GoalChanged' })
        if (walk === 'hang') return new Promise((resolve, reject) => { hang.reject = reject })
        const p = bot.entity.position
        // 'valve': the first two walks find no route (resolve, unmoved); from the third the route exists (cleanzone-01's valve)
        if (walk === 'valve' && walks.length >= 3) bot.entity.position = new Vec3(goal.x + 0.5, p.y, goal.z + 0.5)
        if (walk === 'ok') bot.entity.position = new Vec3(goal.x + 0.5, p.y, goal.z + 0.5)
        if (walk === 'short') bot.entity.position = new Vec3(p.x + 6 * Math.sign(goal.x - p.x), p.y, p.z + 6 * Math.sign(goal.z - p.z))
      } },
    nearestEntity: () => null, entities: {},
    async dig (b) { digs.push(b.position); events.push('dig'); set.delete(`${b.position.x},${b.position.y},${b.position.z}`) },
    async equip () {}, async lookAt () {}, assertNav () {}, chat () {}, setControlState () {}, clearControlStates () {},
    withGatherMovements: async fn => fn(),
  }
  return { bot, digs, walks, events, hang }
}
// 40 dirt cells in the zone, 25-32 blocks east of home: OUTSIDE townground's 16-block box (the base takes them), INSIDE the zone
const zoneDirt = []
for (let i = 0; i < 40; i++) zoneDirt.push([225 + (i % 8), 63, 198 + Math.floor(i / 8)])
// three beyond the east exit (the exit is at x = 270): out of the 32-block search from home, in it from the exit
const outside = [[275, 63, 200], [276, 63, 200], [277, 63, 200]]
const inSquare = p => CZ.inZoneSquare(ZONE, p.x, p.z)
const run = (mod, bot, args = { block: 'dirt', count: 1 }) => mod.SKILLS.gather.run({ bot }, args, new AbortController().signal).catch(e => ({ status: 'threw', detail: e.message }))

test('POSITIVE CONTROL: with GATHERZONE=off the real gather takes the dirt inside the zone (the harness can see a zone dig)', async () => {
  process.env.GATHERZONE = 'off'
  try {
    const { bot, digs, walks } = gatherWorld({ dirt: [...zoneDirt, ...outside], at: [224.5, 64, 200.5] })
    const r = await run(SK, bot)
    assert.ok(digs.length > 0 && digs.every(inSquare), `the base digs in the zone (digs ${JSON.stringify(digs)}, ${JSON.stringify(r).slice(0, 160)})`)
    assert.deepEqual(walks, [])
  } finally { delete process.env.GATHERZONE }
})
test('CHAIN: every dirt cell in reach is the zone\'s -> gather WALKS to the nearest exit and takes the dirt beyond it', async () => {
  const { bot, digs, walks } = gatherWorld({ dirt: [...zoneDirt, ...outside], at: [224.5, 64, 200.5] })
  const r = await run(SK, bot)
  assert.deepEqual(walks, [[270, 200]], 'one walk, to the east exit (the nearest)')
  assert.ok(digs.length > 0, `something was gathered (${JSON.stringify(r).slice(0, 200)})`)
  for (const p of digs) assert.equal(inSquare(p), false, `dug the zone's ground at ${p}`)
  assert.ok(digs.some(p => p.x >= 275), 'the dirt beyond the exit is what was taken')
})
test('CHAIN: dirt outside the zone already in reach -> no walk; the search reaches past the zone\'s cells', async () => {
  const near = [[266, 63, 240], [267, 63, 240]]
  const edge = []
  for (let i = 0; i < 40; i++) edge.push([256 + (i % 8), 63, 236 + Math.floor(i / 8)])
  const { bot, digs, events } = gatherWorld({ dirt: [...edge, ...near], at: [258.5, 64, 240.5] })
  const r = await run(SK, bot)
  assert.ok(digs.length > 0 && digs.every(p => !inSquare(p)), `only the outside dirt (${JSON.stringify(digs)}, ${JSON.stringify(r).slice(0, 160)})`)
  // the fake world never puts an item in the bag, so the run goes on after its digs; what matters is the ORDER: the dirt in
  // reach was dug before any walk was considered
  assert.equal(events[0], 'dig', `the first thing gather did was dig, not walk (${events.join(' ')})`)
  assert.ok(events.indexOf('walk') === -1 || events.indexOf('walk') >= digs.filter(p => p.x >= 266).length, 'no walk before the reachable dirt was taken')
})
test('CHAIN: only the zone\'s dirt anywhere and walks that stop short -> two exits tried, then a refusal that names one; nothing dug', async () => {
  const { bot, digs, walks } = gatherWorld({ dirt: zoneDirt, at: [210.5, 64, 200.5], walk: 'short' })
  const r = await run(SK, bot)
  assert.equal(digs.length, 0)
  assert.equal(walks.length, CZ.GATHER_ZONE.exits, 'the exits were tried, no more')
  assert.notEqual(walks[0].join(), walks[1].join(), 'a different exit the second time')
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'no_safe_target', 'the ground is there and may not be taken: town_ground\'s own class, not nothing_found')
  assert.match(String(r.detail), /town's ground is kept within 64 blocks of home .*goto -?\d+ 65 -?\d+ and gather there/, `the refusal names the place: ${r.detail}`)
  assert.equal(bot.gatherTrap, undefined, 'a bot that moved is not trapped')
})
test('CHAIN: the walk is taken over by another goal -> not a trap; the next exit is tried, then the refusal; nothing dug, nothing thrown', async () => {
  const { bot, digs, walks } = gatherWorld({ dirt: [...zoneDirt, ...outside], at: [224.5, 64, 200.5], walk: 'changed' })
  const r = await run(SK, bot)
  assert.equal(digs.length, 0)
  assert.equal(walks.length, CZ.GATHER_ZONE.exits)
  assert.equal(r.status, 'failed'); assert.match(String(r.detail), /goto -?\d+ 65 -?\d+ and gather there/)
  assert.equal(bot.gatherTrap, undefined)
})
// THE DEAD END CODEX NAMED (review 11-13): a bot with nothing to climb with, in a pit inside the zone. No route starts where
// it stands, so it cannot walk out; the dirt beside it is its way out (climbPrerequisite asks for exactly that).
for (const mode of ['stay', 'nopath', 'budget']) {
  test(`CHAIN, TRAPPED (${mode === 'stay' ? 'the walk resolves on an empty path' : mode === 'nopath' ? 'the walk rejects NoPath' : 'the walk spends its whole budget without moving'}): the bot keeps the ground beside it -- a few cells, near where it stands, and no more`, async () => {
    const pit = []
    for (let i = 0; i < 30; i++) pit.push([223 + (i % 6), 63, 198 + Math.floor(i / 6)])      // around the bot
    const { bot, digs, walks } = gatherWorld({ dirt: [...pit, ...zoneDirt.filter(([x]) => x >= 230)], at: [224.5, 64, 200.5], walk: mode })
    const r = await run(SK, bot, { block: 'dirt', count: 16 })
    assert.equal(walks.length, 1, 'one walk was enough to know')
    assert.ok(digs.length > 0, `the trapped bot got its dirt (${JSON.stringify(r).slice(0, 200)})`)
    assert.ok(digs.length <= CZ.GATHER_ZONE.trapMax, `at most trapMax cells (${digs.length})`)
    for (const p of digs) assert.ok(Math.abs(p.x - 224) <= CZ.GATHER_ZONE.trapR && Math.abs(p.z - 200) <= CZ.GATHER_ZONE.trapR && Math.abs(p.y - 64) <= CZ.GATHER_ZONE.trapR, `only beside the bot: ${p}`)
    assert.ok(bot.gatherTrap && bot.gatherTrap.left === CZ.GATHER_ZONE.trapMax - digs.length, 'each cell taken is counted')
  })
}
test('MUTANT KILLED: without the trap, the pit is the dead end -- a bot that cannot walk out gets no dirt at all', async () => {
  await withMutantsAll(SKILLS_URL, [["&& !gatherTrapAllows(bot?.gatherTrap, p, Date.now()) }", "}"]], async mod => {
    const pit = []
    for (let i = 0; i < 30; i++) pit.push([223 + (i % 6), 63, 198 + Math.floor(i / 6)])
    const { bot, digs } = gatherWorld({ dirt: pit, at: [224.5, 64, 200.5], walk: 'stay' })
    const r = await run(mod, bot, { block: 'dirt', count: 16 })
    assert.equal(digs.length, 0); assert.notEqual(r.status, 'success')
  })
})
test('MUTANT KILLED: without the budget case, a bot whose walk times out where it stands is refused and gets no dirt (the loop Iris ran nine times)', async () => {
  const src = readFileSync(new URL('../src/cleanzone.mjs', import.meta.url), 'utf8')
  const old = "  if (err && err.name !== 'NoPath' && err.budgetExceeded !== true) return false\n"
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING or not unique')
  const czOut = new URL(`./_mutant-cz-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(czOut, src.replace(old, "  if (err && err.name !== 'NoPath') return false\n").replace(/from '\.\//g, "from '../src/"))
  try {
    const name = czOut.pathname.split('/').pop()
    await withMutantsAll(SKILLS_URL, [["from './cleanzone.mjs'   // cleanzone-02", `from '../test/${name}'   // cleanzone-02`]], async mod => {
      const pit = []
      for (let i = 0; i < 30; i++) pit.push([223 + (i % 6), 63, 198 + Math.floor(i / 6)])
      const { bot, digs, walks } = gatherWorld({ dirt: pit, at: [224.5, 64, 200.5], walk: 'budget' })
      const r = await run(mod, bot, { block: 'dirt', count: 16 })
      assert.equal(digs.length, 0); assert.equal(walks.length, CZ.GATHER_ZONE.exits); assert.equal(r.status, 'failed')
    })
  } finally { try { unlinkSync(czOut) } catch {} }
})
test('TRAP, pure: only a walk that went nowhere with no route (resolved, or NoPath) is a trap; it allows few cells, near, briefly', () => {
  const from = { x: 224, y: 64, z: 200 }
  assert.equal(CZ.gatherWalkTrapped(from, { x: 224, y: 64, z: 200 }, null), true, 'resolved without moving: the empty path')
  assert.equal(CZ.gatherWalkTrapped(from, { x: 225, y: 63, z: 201 }, Object.assign(new Error('x'), { name: 'NoPath' })), true)
  assert.equal(CZ.gatherWalkTrapped(from, { x: 224, y: 64, z: 200 }, Object.assign(new Error('x'), { name: 'GoalChanged' })), false, 'a reflex took the goal: not a trap')
  assert.equal(CZ.gatherWalkTrapped(from, { x: 224, y: 64, z: 200 }, Object.assign(new Error('walking exceeded 25000ms'), { budgetExceeded: true })), true, 'the whole budget spent without moving: no route starts here either (Iris, 11-13)')
  assert.equal(CZ.gatherWalkTrapped(from, { x: 240, y: 64, z: 200 }, Object.assign(new Error('walking exceeded 25000ms'), { budgetExceeded: true })), false, 'a budget that ran out on a bot that MOVED is a long walk, not a trap')
  assert.equal(CZ.gatherWalkTrapped(from, { x: 224, y: 64, z: 200 }, new Error('some other failure')), false, 'an unnamed failure is not a trap')
  assert.equal(CZ.gatherWalkTrapped(from, { x: 226, y: 64, z: 200 }, null), false, 'it moved')
  assert.equal(CZ.gatherWalkTrapped(from, null, null), false)
  const trap = CZ.gatherTrapOf({ x: 224, y: 64, z: 200 }, 1000)
  assert.deepEqual(trap, { at: [224, 64, 200], until: 1000 + CZ.GATHER_ZONE.trapMs, left: CZ.GATHER_ZONE.trapMax })
  assert.equal(CZ.gatherTrapAllows(trap, { x: 227, y: 61, z: 197 }, 2000), true, 'within trapR on every axis')
  assert.equal(CZ.gatherTrapAllows(trap, { x: 228, y: 64, z: 200 }, 2000), false, 'one too far')
  assert.equal(CZ.gatherTrapAllows(trap, { x: 224, y: 64, z: 200 }, trap.until), false, 'expired')
  assert.equal(CZ.gatherTrapAllows({ ...trap, left: 0 }, { x: 224, y: 64, z: 200 }, 2000), false, 'spent')
  assert.equal(CZ.gatherTrapAllows(null, { x: 224, y: 64, z: 200 }, 2000), false)
})
test('ABORT: an interrupt during the walk halts the path at once and the run ends; the listener is gone afterwards', async () => {
  const { bot, digs, hang } = gatherWorld({ dirt: [...zoneDirt, ...outside], at: [224.5, 64, 200.5], walk: 'hang' })
  const ac = new AbortController()
  const t0 = Date.now()
  const p = SK.SKILLS.gather.run({ bot }, { block: 'dirt', count: 1 }, ac.signal).then(r => ({ r }), e => ({ e }))
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.ok(hang.reject, 'the walk is under way')
  ac.abort()
  const out = await p
  assert.ok(Date.now() - t0 < 5000, `the run ended on the interrupt, not on the ${CZ.GATHER_ZONE.walkMs} ms walk budget (${Date.now() - t0} ms)`)
  assert.ok(hang.halts >= 1, 'the path was halted (setGoal(null))')
  assert.equal(digs.length, 0)
  assert.ok(out.e || out.r?.status !== 'success', 'an interrupted gather is not a success')
})
test('A BOT BEYOND THE SQUARE has performed the remedy: with nothing to take there the answer is the base\'s nothing_found, never "go where you are"', async () => {
  // standing on the east exit; the zone's dirt is in range behind it, nothing else
  const edge = []
  for (let i = 0; i < 12; i++) edge.push([258 + (i % 6), 63, 199 + Math.floor(i / 6)])
  const a = gatherWorld({ dirt: edge, at: [270.5, 64, 200.5] })
  const ra = await run(SK, a.bot)
  assert.deepEqual(a.walks, []); assert.equal(a.digs.length, 0)
  assert.equal(ra.failClass, 'nothing_found', JSON.stringify(ra).slice(0, 200))
  assert.doesNotMatch(String(ra.detail), /goto -?\d+ 65 -?\d+ and gather there/)
  // and the same after a walk out that found nothing beyond the exit, with the zone's dirt IN RANGE of the exit too
  const b = gatherWorld({ dirt: [...zoneDirt, ...edge], at: [224.5, 64, 200.5], walk: 'ok' })
  const rb = await run(SK, b.bot)
  assert.deepEqual(b.walks, [[270, 200]], 'one walk; a bot that is out is not walked again')
  assert.equal(b.digs.length, 0)
  assert.equal(rb.failClass, 'nothing_found', JSON.stringify(rb).slice(0, 200))
})
test('MUTANT KILLED: without the inside-the-square condition, the bot that walked out is walked again', async () => {
  await withMutantsAll(SKILLS_URL, [[" && gzFrom && inZoneSquare(gatherZoneNow(), gzFrom.x, gzFrom.z)) {", " && gzFrom) {"]], async mod => {
    const edge = []
    for (let i = 0; i < 12; i++) edge.push([258 + (i % 6), 63, 199 + Math.floor(i / 6)])
    const { bot, walks } = gatherWorld({ dirt: [...zoneDirt, ...edge], at: [224.5, 64, 200.5], walk: 'ok' })
    const r = await run(mod, bot)
    assert.ok(walks.length > 1, `the mutant walks a bot that is already out a second time (${walks.length} walks, ${r.failClass})`)
  })
})
test('ONLY ZONE CELLS IN RANGE COUNT: the zone\'s dirt beyond the search did not empty it -> the base\'s nothing_found, no walk', async () => {
  const far = []
  for (let i = 0; i < 12; i++) far.push([150 + (i % 6), 63, 199 + Math.floor(i / 6)])     // 50+ blocks west of the bot, in the zone
  const { bot, digs, walks } = gatherWorld({ dirt: far, at: [210.5, 64, 200.5], matcherFirst: true })
  const r = await run(SK, bot)
  assert.deepEqual(walks, [], 'nothing in range was skipped: no walk')
  assert.equal(digs.length, 0); assert.equal(r.failClass, 'nothing_found')
})
test('MUTANT KILLED: without the range guard, zone cells beyond the search send the bot walking', async () => {
  await withMutantsAll(SKILLS_URL, [["{ if (searchFrom && b.position.distanceTo(searchFrom) <= maxDistance) zoneSkipped++; return false }", "{ zoneSkipped++; return false }"]], async mod => {
    const far = []
    for (let i = 0; i < 12; i++) far.push([150 + (i % 6), 63, 199 + Math.floor(i / 6)])
    const { bot, walks } = gatherWorld({ dirt: far, at: [210.5, 64, 200.5], matcherFirst: true })
    await run(mod, bot)
    assert.ok(walks.length > 0)
  })
})
test('TRAPPED BUT HOLDING WHAT A CLIMB NEEDS: no digging beside the bot; the SAME walk is made again and the third gets out (the valve), then the dirt beyond', async () => {
  const pit = []
  for (let i = 0; i < 30; i++) pit.push([223 + (i % 6), 63, 198 + Math.floor(i / 6)])
  const { bot, digs, walks } = gatherWorld({ dirt: [...pit, ...outside], at: [224.5, 64, 200.5], walk: 'valve', items: [{ name: 'dirt', count: 64, type: mcData.itemsByName.dirt.id }] })
  const r = await run(SK, bot, { block: 'dirt', count: 1 })
  assert.deepEqual(walks, [[270, 200], [270, 200], [270, 200]], `three walks to the same exit (${JSON.stringify(r).slice(0, 160)})`)
  assert.equal(bot.gatherTrap, undefined, 'no trap is granted to a bot that can climb')
  assert.ok(digs.length > 0 && digs.every(p => !inSquare(p)), 'nothing dug in the zone; the dirt beyond the exit was taken')
})
test('TRAPPED AND HOLDING, and the walks never find a route: a bounded number of walks, then a refusal that names the exit as a goto (not surface)', async () => {
  const pit = []
  for (let i = 0; i < 30; i++) pit.push([223 + (i % 6), 63, 198 + Math.floor(i / 6)])
  const { bot, digs, walks } = gatherWorld({ dirt: pit, at: [224.5, 64, 200.5], walk: 'stay', items: [{ name: 'dirt', count: 64, type: mcData.itemsByName.dirt.id }] })
  const r = await run(SK, bot, { block: 'dirt', count: 16 })
  assert.equal(walks.length, 1 + CZ.GATHER_ZONE.climbTries); assert.equal(digs.length, 0)
  assert.equal(bot.gatherTrap, undefined)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'no_safe_target')
  assert.match(String(r.detail), /you hold \d+ blocks to climb with: .*goto 270 65 200 and gather there/)
  assert.doesNotMatch(String(r.detail), /surface/)
})
test('SAND IS NOT A TOWER: a pit bot holding 64 sand (which the pathfinder never places) is trapped like an empty-handed one and keeps the ground beside it', async () => {
  const pit = []
  for (let i = 0; i < 30; i++) pit.push([223 + (i % 6), 63, 198 + Math.floor(i / 6)])
  const { bot, digs, walks } = gatherWorld({ dirt: pit, at: [224.5, 64, 200.5], walk: 'stay', items: [{ name: 'sand', count: 64, type: mcData.itemsByName.sand.id }, { name: 'gravel', count: 32, type: mcData.itemsByName.gravel.id }] })
  await run(SK, bot, { block: 'dirt', count: 16 })
  assert.equal(walks.length, 1, 'no repeated walk toward a tower it cannot build')
  assert.ok(digs.length > 0 && digs.length <= CZ.GATHER_ZONE.trapMax, 'the trap is granted')
  // and with no tower list at all the answer is the same (0 held), never a crash
  const w2 = gatherWorld({ dirt: pit, at: [224.5, 64, 200.5], walk: 'stay', items: [{ name: 'dirt', count: 64, type: mcData.itemsByName.dirt.id }], tower: [] })
  await run(SK, w2.bot, { block: 'dirt', count: 16 })
  assert.equal(w2.walks.length, 1); assert.ok(w2.digs.length > 0)
})
test('MUTANT KILLED: without the repeated walk, a bot that could have climbed out is refused after one walk', async () => {
  await withMutantsAll(SKILLS_URL, [["            if (zoneClimb < GATHER_ZONE.climbTries) {", "            if (false) {"]], async mod => {
    const pit = []
    for (let i = 0; i < 30; i++) pit.push([223 + (i % 6), 63, 198 + Math.floor(i / 6)])
    const { bot, digs, walks } = gatherWorld({ dirt: [...pit, ...outside], at: [224.5, 64, 200.5], walk: 'valve', items: [{ name: 'dirt', count: 64, type: mcData.itemsByName.dirt.id }] })
    const r = await run(mod, bot, { block: 'dirt', count: 1 })
    assert.equal(walks.length, 1); assert.equal(digs.length, 0); assert.equal(r.status, 'failed')
  })
})
test('CHAIN, the exception: a bot down in the mine takes the ground around it without walking anywhere', async () => {
  const deep = []
  for (let i = 0; i < 6; i++) deep.push([226 + i, 29, 200])
  const { bot, digs, walks } = gatherWorld({ dirt: deep, at: [224.5, 30, 200.5] })
  const r = await run(SK, bot)
  assert.deepEqual(walks, [])
  assert.ok(digs.length > 0 && digs.every(p => p.y === 29), `the deep dirt was taken (${JSON.stringify(r).slice(0, 160)})`)
})
test('LAYERS: enumeration and target filters removed -> the check at the swing still refuses; all three removed -> the zone is dug', async () => {
  await withMutantsAll(SKILLS_URL, [ENUM, SAFE], async mod => {
    const { bot, digs } = gatherWorld({ dirt: zoneDirt, at: [224.5, 64, 200.5] })
    await run(mod, bot)
    assert.equal(digs.length, 0, 'the swing-time conjunction holds on its own')
  })
  await withMutantsAll(SKILLS_URL, [ENUM, SAFE, SWING], async mod => {
    const { bot, digs } = gatherWorld({ dirt: zoneDirt, at: [224.5, 64, 200.5] })
    await run(mod, bot)
    assert.ok(digs.length > 0 && digs.every(inSquare), 'all three layers gone: the zone IS dug (each mutant applied)')
  })
})
test('MUTANT KILLED: without the enumeration filter the zone\'s cells fill the search and the walk never happens', async () => {
  await withMutantsAll(SKILLS_URL, [ENUM], async mod => {
    const { bot, digs, walks } = gatherWorld({ dirt: [...zoneDirt, ...outside], at: [224.5, 64, 200.5] })
    await run(mod, bot)
    assert.deepEqual(walks, [], 'no walk: the search was never emptied')
    assert.ok(!digs.some(p => !inSquare(p)), 'and the dirt beyond the exit is never reached')
  })
})
test('MUTANT KILLED: a walk-out that does not search again leaves the dirt beyond the exit untaken', async () => {
  await withMutantsAll(SKILLS_URL, [["        try { logEvent({ kind: 'gather_zone', status: outNow ? 'success' : 'failed'", "        if (outNow) return { status: 'failed', detail: 'mutant: walked and stopped' }\n        try { logEvent({ kind: 'gather_zone', status: outNow ? 'success' : 'failed'"]], async mod => {
    const { bot, digs, walks } = gatherWorld({ dirt: [...zoneDirt, ...outside], at: [224.5, 64, 200.5] })
    const r = await run(mod, bot)
    assert.equal(walks.length, 1); assert.equal(digs.length, 0); assert.notEqual(r.status, 'success')
  })
})
