// townfloor-01 (10-14): fill_town, the skill, driven through the REAL SKILLS table on a fake dug-out town, and the order
// through the REAL CognitiveLoop.
//
// The chain this proves (CLAUDE.md: test the refusal CHAIN, not the single guard): at town with surplus stone the loop
// issues fill_town -- but a milestone conversion that is ready goes first, and away from town or without surplus nothing
// fires; a visit takes the town's lease, plans from the world, places bounded and re-proves every click; the decorations
// go first and the 64-cobble reserve is never spent; a drop is retried by a replan and a cell dropped twice is skipped;
// a body or a chest that appears is never placed into or beside; nothing left to reach holds the town an hour; another
// builder's lease, no funds or being away refuse with the remedy named; an abort releases the lease and the hand.
// The fake server refuses what Paper refuses: a place into a full cell, into a body, out of reach, a bottom face.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-townfloor-${process.pid}`
process.env.BOT_NAME = 'FloorBot'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'floortest'
process.env.FLOOR_COOLDOWN_MS = '0'
// the visit's time bound (production 100 s; the suite's 300 ms skill budget would make it 2 s): the plan's own speed is not
// what these tests measure
process.env.FLOOR_VISIT_MS = '60000'
const STORE = mkdtempSync(path.join(tmpdir(), 'floor-store-'))
process.env.POOL_STATE_DIR = STORE
const { Vec3 } = await import('vec3')
const F = await import('../src/townfloor.mjs')
const S = await import('../src/skills.mjs')
const { SKILLS, SKILL_CONTRACTS } = S
const { isHousekeeping } = await import('../src/hygiene.mjs')
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.8')
const PBlock = require('prismarine-block')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 6).join('\n        ')}`)
  }
}
const HOME = { x: 0, y: 64, z: 0 }
const L = 62
const KEY = (x, y, z) => `${x},${y},${z}`
const REC = path.join(STORE, 'townfloor-0_64_0.json')
const leaseFiles = () => readdirSync(STORE).filter(f => /^townfloor-0_64_0\.lease\.g\d+\.json$/.test(f))
const reset = () => { rmSync(REC, { force: true }); for (const f of leaseFiles()) rmSync(path.join(STORE, f), { force: true }) }
const rowsNow = kind => { try { return readFileSync(`${process.env.LOG_DIR}/skill-FloorBot.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] } }
const rowsOf = async kind => { await new Promise(r => setTimeout(r, 200)); return rowsNow(kind) }
const carve = (cells, x0, x1, y0, y1, z0, z1, n = 'air') => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) cells[KEY(x, y, z)] = n; return cells }
/** A 3x3x3 pit at 8..10 with a walkable stair cut into its east side; and a 3x3 hole one deep at -10..-8. */
const dugTown = () => { const c = carve({}, 8, 10, 60, 62, 8, 10); carve(c, 11, 11, 61, 62, 9, 9); carve(c, 12, 12, 62, 62, 9, 9); carve(c, -10, -8, 62, 62, -10, -8); return c }

const STATE = {}
const stateOf = name => STATE[name] ??= (REG.blocksByName[name].defaultState ?? REG.blocksByName[name].minStateId)
function fakeTown ({ items = [], name = 'FloorBot', cells = dugTown(), at = null } = {}) {
  const world = new Map(Object.entries(cells))
  const nameAt = (x, y, z) => world.get(KEY(x, y, z)) ?? (Math.abs(x) > 40 || Math.abs(z) > 40 ? null : y > L ? 'air' : y === L ? (Math.max(Math.abs(x), Math.abs(z)) <= 6 ? 'stone_bricks' : 'grass_block') : 'stone')
  const blockAt = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
    if (y < 30 || y > 100) return null
    const n = nameAt(x, y, z)
    if (!n) return null
    const b = PBlock.fromStateId(stateOf(n), 0); b.position = new Vec3(x, y, z); return b
  }
  const slots = Array(46).fill(null)
  let si = 9
  for (const [n, c] of items) { slots[si] = { name: n, count: c, slot: si, type: REG.itemsByName[n].id, stackSize: 64 }; si++ }
  const st = { places: [], goals: [], refused: [], faces: [], placeHook: null, drop: null }
  const bot = {
    username: name, worldId: 'w1', registry: REG, quickBarSlot: 0, entities: {}, players: {}, currentWindow: null,
    entity: { position: at ?? new Vec3(0.5, L + 1, 0.5), height: 1.8, width: 0.6 },
    get heldItem () { return slots[36 + bot.quickBarSlot] ?? null },
    inventory: { slots, items: () => slots.slice(9, 45).filter(s => s && s.count > 0) },
    blockAt,
    findBlocks: ({ matching, maxDistance, point, count = 1 }) => {
      const from = point ?? bot.entity.position
      if (typeof matching !== 'function') return []
      return [...world.keys()].map(k => new Vec3(...k.split(',').map(Number))).filter(v => v.distanceTo(from) <= maxDistance && matching(blockAt(v))).slice(0, count)
    },
    findBlock: o => { const r = bot.findBlocks({ ...o, count: 1 })[0]; return r ? blockAt(r) : null },
    equip: async (item, dest) => {
      assert.equal(dest, 'hand')
      if (!item || slots[item.slot] !== item) throw new Error('not in inventory')
      if (item.slot >= 36) { bot.quickBarSlot = item.slot - 36; return }
      const d = 36, other = slots[d], from = item.slot
      slots[d] = item; item.slot = d; slots[from] = other; if (other) other.slot = from
      bot.quickBarSlot = 0
    },
    lookAt: async () => {}, setControlState () {}, clearControlStates () {}, waitForTicks: async () => { await st.tickHook?.(); await new Promise(r => setImmediate(r)) },
    pathfinder: {
      setGoal () {}, stop () {},
      goto: async goal => {
        st.goals.push([goal.x, goal.y, goal.z])
        await st.gotoHook?.(goal)
        const ok = blockAt(new Vec3(goal.x, goal.y, goal.z))?.boundingBox === 'empty' && blockAt(new Vec3(goal.x, goal.y + 1, goal.z))?.boundingBox === 'empty' && blockAt(new Vec3(goal.x, goal.y - 1, goal.z))?.boundingBox === 'block'
        if (!ok) throw new Error('no path')
        bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5)
      },
    },
    _placeBlockWithOptions: async (ref, face) => {
      const at = ref.position.plus(face)
      const h = bot.heldItem
      assert.ok(h, 'placing with an empty hand')
      st.faces.push(face.y)
      if (face.y === -1) { st.refused.push('bottom'); throw new Error('a bottom face') }
      const target = blockAt(at)
      const eye = bot.entity.position.offset(0, 1.62, 0)
      const fc = ref.position.offset(0.5 + face.x * 0.5, 0.5 + face.y * 0.5, 0.5 + face.z * 0.5)
      if (eye.distanceTo(fc) > 5.5) { st.refused.push('reach'); throw new Error('out of reach') }
      if (!['air', 'cave_air', 'short_grass'].includes(target.name)) { st.refused.push('full'); throw new Error('placing into a full cell') }
      for (const e of [bot.entity, ...Object.values(bot.entities)]) {
        const f = e.position
        if (e.name !== 'item' && f.x + 0.3 > at.x && f.x - 0.3 < at.x + 1 && f.z + 0.3 > at.z && f.z - 0.3 < at.z + 1 && f.y + 1.8 > at.y && f.y < at.y + 1) { st.refused.push('body'); throw new Error('a body in the cell') }
      }
      // THE SERVER DROPS IT (no block update): the test says which cell, how many times
      if (st.drop && st.drop.key === KEY(at.x, at.y, at.z) && st.drop.n > 0) { st.drop.n--; st.dropped = (st.dropped ?? 0) + 1; return }
      if (st.dropAll) { st.dropped = (st.dropped ?? 0) + 1; return }
      world.set(KEY(at.x, at.y, at.z), h.name); h.count--; if (!h.count) slots[h.slot] = null
      st.places.push(KEY(at.x, at.y, at.z))
      await st.placeHook?.(at)
    },
    dig: async () => { throw new Error('the floor never digs') },
  }
  const read = (x, y, z) => { const b = blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes, hardness: b.hardness, props: null } : null }
  return { bot, st, world, read, slots }
}
const visit = async (town, signal = { aborted: false }) => SKILLS.fill_town.run({ bot: town.bot }, {}, signal)
const bag = town => town.bot.inventory.items().reduce((m, it) => ({ ...m, [it.name]: (m[it.name] ?? 0) + it.count }), {})
const cobble = town => (bag(town).cobblestone ?? 0) + (bag(town).cobbled_deepslate ?? 0)
const recNow = () => JSON.parse(readFileSync(REC, 'utf8'))

await t('registered: fill_town is chatOnly housekeeping with a world_change contract', () => {
  assert.ok(SKILLS.fill_town?.run); assert.equal(SKILLS.fill_town.chatOnly, true)
  assert.equal(isHousekeeping('fill_town'), true)
  assert.deepEqual(SKILL_CONTRACTS.fill_town.expects, ['world_change'])
})

await t('THE CHAIN: visits fill the dug-out floor bounded at 32 per visit, decorations first, never below the 64 reserve; every block placed is a target the plan allowed; the last visit finds nothing and holds the town', async () => {
  reset()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 30], ['andesite', 5]] })
  const targets = new Set(F.floorCells(town.read, HOME).targets.map(c => KEY(c.x, c.y, c.z)))
  assert.equal(targets.size, 39, 'positive control: the 30-cell pit and stair and the 9-cell hole are targets')
  const r1 = await visit(town)
  assert.equal(r1.status, 'success', r1.detail); assert.equal(r1.placed, F.FLOOR_STEPS_PER_VISIT, `bounded per visit: ${r1.detail}`)
  assert.equal(bag(town).andesite ?? 0, 0, 'the decorations went first')
  assert.equal(cobble(town), 67, 'spent 27 of the 30 above the reserve')
  assert.ok(town.st.places.every(k => targets.has(k)), `only targets: ${town.st.places.filter(k => !targets.has(k))}`)
  assert.equal(new Set(town.st.places).size, town.st.places.length, 'no cell twice')
  assert.deepEqual(town.st.refused, [], 'the server never refused a click')
  assert.ok(!town.st.faces.includes(-1))
  const steps = await rowsOf('_town_floor_step')
  assert.equal(steps.length, 32, 'one row per block')
  assert.match(steps[0].skill.detail, /^at=-?\d+,\d+,-?\d+ block=andesite stand=/)
  const visitRow = (await rowsOf('_town_floor')).at(-1)
  assert.match(visitRow.skill.detail, /^stage=visit placed=32 /)
  assert.equal(recNow().placed, 32); assert.equal(recNow().visits, 1)
  assert.equal(S.townFloorState(town.bot).lease.free, true, 'the lease was released')
  // 3 above the reserve now: the next visit refuses with the remedy, places nothing
  const r2 = await visit(town)
  assert.equal(r2.status, 'no_effect'); assert.equal(r2.failClass, 'floor_unfunded'); assert.match(r2.detail, /mine stone with a pickaxe/)
  assert.equal(town.st.places.length, 32)
  // funded again: the rest, then nothing to do
  town.slots[20] = { name: 'cobblestone', count: 64, slot: 20, type: REG.itemsByName.cobblestone.id, stackSize: 64 }
  const r3 = await visit(town)
  assert.equal(r3.status, 'success', r3.detail); assert.equal(r3.placed, 7)
  assert.equal(cobble(town), 67 + 64 - 7)
  assert.equal(F.floorCells(town.read, HOME).targets.length, 0, 'the floor is whole')
  const r4 = await visit(town)
  assert.equal(r4.status, 'no_effect'); assert.equal(r4.failClass, 'floor_none', r4.detail)
  assert.ok(recNow().noneAt > 0)
  assert.equal(S.townFloorState(town.bot).held, true, 'the town holds every bot\'s order for an hour')
  assert.equal((await visit(town)).failClass, 'floor_none', 'held: no plan is even made')
})

await t('A DROPPED PLACEMENT is retried by a replan; a cell dropped twice is skipped for a day, the rest is filled', async () => {
  reset()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64]], cells: carve({}, -10, -8, 62, 62, -10, -8) })
  const first = F.planFloor({ read: town.read, home: HOME, maxSteps: 1 }).steps[0].c
  town.st.drop = { key: KEY(...first), n: 9 }
  const r = await visit(town)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(r.placed, 8, 'the other eight')
  assert.ok(!town.st.places.includes(KEY(...first)))
  const k = String(F.cellKey(...first))
  assert.ok(recNow().stuck[k].n >= 2, JSON.stringify(recNow().stuck))
  assert.ok(F.stuckSkips(recNow(), Date.now()).has(Number(k)))
})

await t('A BODY in the next cell, or a CHEST put beside it mid-visit: never placed into or beside; the visit replans around it', async () => {
  reset()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64]], cells: carve({}, -10, -8, 62, 62, -10, -8) })
  town.bot.entities = { 7: { type: 'player', username: 'Other', position: new Vec3(-8.5, 62, -8.5), height: 1.8, width: 0.6 } }
  let chestAt = -1
  town.st.placeHook = () => { if (chestAt < 0) { chestAt = town.st.places.length; town.world.set(KEY(-10, 63, -10), 'chest') } }
  const r = await visit(town)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(!town.st.places.includes(KEY(-9, 62, -9)), 'never into the body')
  const beside = new Set([KEY(-10, 62, -10), KEY(-9, 62, -10), KEY(-10, 62, -9)])
  const after = town.st.places.slice(chestAt).filter(k => beside.has(k))
  assert.deepEqual(after, [], 'nothing beside the chest once it stood there')
  assert.ok(town.st.places.length >= 4, `positive control: the cells away from both were filled (${town.st.places})`)
  assert.deepEqual(town.st.refused, [], 'the server never had to refuse')
})

await t('THE CLICK IS RE-PROVED AT ITS TURN: a chest set down beside the next cell during the click\'s pacing (after its pre-check) -> never placed beside it', async () => {
  reset()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64]], cells: carve({}, -10, -8, 62, 62, -10, -8) })
  const second = F.planFloor({ read: town.read, home: HOME, maxSteps: 2 }).steps[1].c
  let fired = -1
  town.st.tickHook = () => { if (fired < 0 && town.st.places.length === 1) { fired = 1; town.world.set(KEY(second[0], 63, second[2]), 'chest') } }
  const r = await visit(town)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(fired, 1, 'positive control: the chest went down between the first and the second click')
  const beside = town.st.places.slice(1).filter(k => { const [x, y, z] = k.split(',').map(Number); return Math.abs(x - second[0]) <= 1 && Math.abs(z - second[2]) <= 1 && y >= 62 })
  assert.deepEqual(beside, [], 'nothing beside the chest after it appeared')
  assert.ok(town.st.places.length >= 2, `the rest goes on: ${town.st.places}`)
})

await t('A LEASE TAKEN OVER MID-VISIT (expired and re-taken by another bot): the stale holder places nothing more and writes no record', async () => {
  reset()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64]], cells: carve({}, -10, -8, 62, 62, -10, -8) })
  town.st.placeHook = () => {
    if (town.st.places.length !== 2) return
    const n = Math.max(...leaseFiles().map(f => Number(/g(\d+)/.exec(f)[1])))
    writeFileSync(path.join(STORE, `townfloor-0_64_0.lease.g${n + 1}.json`), JSON.stringify({ by: 'Thief', token: 't', at: Date.now(), until: Date.now() + 60_000, n: n + 1 }))
  }
  const r = await visit(town)
  assert.equal(town.st.places.length, 2, 'nothing after the takeover')
  assert.equal(r.status, 'success', 'the two it placed are real')
  assert.equal(existsSync(REC), false, 'the stale holder wrote no record')
  assert.equal(S.townFloorState(town.bot).lease.holder, 'Thief', 'the new holder keeps the lease')
})

await t('A JUNK WELL SITE RECORDED MID-VISIT is a keep-out at the very next click (the keep-outs are read again per click)', async () => {
  reset()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64]], cells: carve({}, -12, -8, 62, 62, -10, -8) })
  const { createSiteGen } = await import('../src/composter.mjs')
  let at = -1
  town.st.placeHook = () => { if (at < 0) { at = town.st.places.length; createSiteGen(STORE, 'junkwell-site-0_64_0', 1, { x: -11, y: 62, z: -9 }, 'w1') } }
  const r = await visit(town)
  assert.equal(r.status, 'success', r.detail)
  const near = town.st.places.slice(at).filter(k => { const [x, , z] = k.split(',').map(Number); return Math.abs(x + 11) <= 2 && Math.abs(z + 9) <= 2 })
  assert.deepEqual(near, [], 'nothing within the site\'s 5x5 once it was recorded')
  assert.ok(at >= 1, 'positive control: the record went down after the first click')
  assert.ok(town.st.places.some(k => k.startsWith('-8,')), 'positive control: the cells outside the 5x5 are still filled')
  for (const f of readdirSync(STORE).filter(f => f.startsWith('junkwell-site-'))) rmSync(path.join(STORE, f), { force: true })
})

await t('ONE BUILDER PER TOWN: two fill_town runs started together on one store -- exactly one takes the lease and places, the other refuses without a click', async () => {
  reset()
  const cells = carve({}, -10, -8, 62, 62, -10, -8)
  const a = fakeTown({ name: 'FloorBot', items: [['cobblestone', 64], ['cobblestone', 64]], cells })
  const b = fakeTown({ name: 'FloorTwo', items: [['cobblestone', 64], ['cobblestone', 64]], cells, at: new Vec3(1.5, L + 1, 0.5) })
  const [ra, rb] = await Promise.all([visit(a), visit(b)])
  const placers = [a, b].filter(x => x.st.places.length > 0)
  assert.equal(placers.length, 1, `exactly one placed: ${ra.status}/${ra.failClass} ${rb.status}/${rb.failClass}`)
  const other = placers[0] === a ? rb : ra
  assert.equal(other.failClass, 'floor_lease', other.detail)
})

await t('REFUSALS NAME THE STATE: another builder\'s lease, or being away from town -- nothing placed, no lease taken', async () => {
  reset()
  const town = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64]] })
  writeFileSync(path.join(STORE, 'townfloor-0_64_0.lease.g1.json'), JSON.stringify({ by: 'Other', token: 'x', at: Date.now(), until: Date.now() + 60_000, n: 1 }))
  const r = await visit(town)
  assert.equal(r.status, 'no_effect'); assert.equal(r.failClass, 'floor_lease'); assert.match(r.detail, /Other is filling/)
  assert.equal(S.townFloorState(town.bot).lease.free, false)
  reset()
  const away = fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64]], at: new Vec3(60.5, 63, 0.5) })
  const r2 = await visit(away)
  assert.equal(r2.status, 'no_effect'); assert.match(r2.detail, /never a trip/)
  assert.equal(away.st.places.length + town.st.places.length, 0)
  assert.equal(leaseFiles().length, 0, 'no lease taken')
})

await t('AN ABORT mid-visit releases the lease at once and restores the hand', async () => {
  reset()
  const town = fakeTown({ items: [['stone_pickaxe', 1], ['cobblestone', 64], ['cobblestone', 64]] })
  await town.bot.equip(town.bot.inventory.items().find(i => i.name === 'stone_pickaxe'), 'hand')
  const sig = { aborted: false, addEventListener () {}, removeEventListener () {} }
  town.st.placeHook = () => { if (town.st.places.length === 3) sig.aborted = true }
  await assert.rejects(visit(town, sig), e => e.aborted)
  assert.equal(town.st.places.length, 3)
  assert.equal(S.townFloorState(town.bot).lease.free, true, 'released')
  assert.equal(town.bot.heldItem?.name, 'stone_pickaxe', 'the hand is restored')
})

// ---- the order through the REAL CognitiveLoop ---------------------------------------------------------------------------
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const ldir = mkdtempSync(path.join(tmpdir(), 'mcai-floor-'))
let lseq = 0
const freshLessons = () => { const Ls = new Lessons(path.join(ldir, `l${lseq++}.json`)); Ls.data.avoid = {}; Ls.data.worked = {}; return Ls }
function loopTown (opts = {}) {
  const town = fakeTown(opts)
  Object.assign(town.bot, {
    health: 20, food: 20, oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' },
    recipesFor: opts.recipesFor ?? (() => []), recipesAll: () => [], clearControlStates: () => {}, experience: { level: 0 },
  })
  return town
}
async function decisions (bot, n) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    if (skill === 'fill_town') {
      const r = await SKILLS[skill].run({ bot }, args ?? {}, null)
      ran.push({ skill, status: r.status, placed: r.placed ?? 0 })
      return { ...r, delta: { placed: Number(r.placed ?? 0) } }
    }
    ran.push({ skill, status: 'success' })
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new CognitiveLoop(bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 200 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  ran.rung = loop.milestones.current()?.id
  return ran
}

// THE ZONE GATE: this file runs on the floor's base (no town-ground zone: the order must never fire) and on its composition
// with townzone-01 (the zone: the order fires). Which one this build is, is a property of the code (zoneLive).
const ZONE = F.zoneLive()
await t(`LOOP CHAIN: at town with surplus stone and a dug floor, ${ZONE ? 'the first decision is fill_town and it fills (the zone is in this build)' : 'NO fill_town -- this build has no town-ground zone, so a gatherer would dig the fill back out'}`, async () => {
  reset()
  const town = loopTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['crafting_table', 1], ['stone_pickaxe', 1]] })
  const ran = await decisions(town.bot, 2)
  assert.ok(ran.length >= 1, 'positive control: the loop decided')
  if (ZONE) {
    assert.equal(ran[0]?.skill, 'fill_town', JSON.stringify(ran))
    assert.equal(ran[0].status, 'success'); assert.ok(ran[0].placed > 0)
  } else {
    assert.ok(!ran.some(x => x.skill === 'fill_town'), JSON.stringify(ran))
    assert.equal((await visit(fakeTown({ items: [['cobblestone', 64], ['cobblestone', 64]] }))).status, 'success', 'positive control: the skill itself works; only the ORDER waits for the zone')
  }
})

await t(`REFUSAL CHAIN IN THE LOOP: a floor that cannot make progress (every click dropped) backs off and the bot goes on with the model's work -- no fill_town loop${ZONE ? '' : ' (this build: the order never fires at all)'}`, async () => {
  reset()
  const town = loopTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['crafting_table', 1], ['stone_pickaxe', 1]] })
  town.st.dropAll = true
  const ran = await decisions(town.bot, 5)
  assert.ok(ran.length >= 3, `positive control: the loop kept deciding (${JSON.stringify(ran)})`)
  const floors = ran.filter(x => x.skill === 'fill_town')
  if (ZONE) {
    assert.equal(floors.length, 1, `one attempt, then the backoff: ${JSON.stringify(ran)}`)
    assert.equal(floors[0].status, 'failed')
    assert.ok(ran.slice(ran.indexOf(floors[0]) + 1).length >= 2 && ran.slice(ran.indexOf(floors[0]) + 1).every(x => x.skill !== 'fill_town'), 'the model\'s work resumes')
  } else assert.equal(floors.length, 0)
})

await t('LOOP CONTROLS: away from town, or with only the 64 reserve, the loop never issues fill_town (the model decides)', async () => {
  reset()
  const away = loopTown({ items: [['cobblestone', 64], ['cobblestone', 64], ['stone_pickaxe', 1]], at: new Vec3(60.5, 63, 0.5) })
  const r1 = await decisions(away.bot, 2)
  assert.ok(r1.length >= 1 && !r1.some(x => x.skill === 'fill_town'), JSON.stringify(r1))
  reset()
  const poor = loopTown({ items: [['cobblestone', 64], ['stone_pickaxe', 1]] })
  const r2 = await decisions(poor.bot, 2)
  assert.ok(r2.length >= 1 && !r2.some(x => x.skill === 'fill_town'), JSON.stringify(r2))
})

await t('LOOP CHAIN, A MILESTONE FIRST: a craft-ready rung (the stone pickaxe from cobble, sticks and a table) is dispatched before the floor', async () => {
  reset()
  const town = loopTown({ items: [['dirt', 16], ['oak_log', 64], ['oak_log', 64], ['sand', 8], ['cobblestone', 64], ['cobblestone', 64], ['crafting_table', 1],
                                  ['wooden_pickaxe', 1], ['stick', 8], ['furnace', 1], ['raw_copper', 5]],
                          recipesFor: id => (id === REG.itemsByName.stone_pickaxe.id ? [{ delta: [] }] : []) })
  const ran = await decisions(town.bot, 2)
  assert.match(ran.rung ?? '', /stone_pickaxe/, 'positive control: the active rung is the stone pickaxe')
  assert.equal(ran[0]?.skill, 'craft', `the rung goes first: ${JSON.stringify(ran)} rung=${ran.rung}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
