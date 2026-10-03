// A BROKEN LOG IS NOT A GATHERED LOG.
//
// 10-03, 80 bots, 3 h, both engines: 291 of 949 failed log gathers (31%, 48 bots)
// broke the log and failed to pick up the drop; after three barren rounds that
// was filed `no_path` -- an avoid rule against `gather oak_log`. The pickup walk
// asked for GoalNear(drop, 1), whose acceptance set is empty for a drop resting
// on leaves or a trunk stub, and every drop was retired whether or not it was
// collected. See src/logpickup.mjs.
//
// Behaviour only. The pure parts are asked directly; the wiring is driven through
// the REAL collectManually and the REAL gather against a fake world whose server
// side (item physics, pickup box, pickup delay) is written here independently of
// the code under test, so a mutant in logpickup.mjs cannot also move the oracle.
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import pkg from 'mineflayer-pathfinder'

process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-logpickup'
process.env.BOT_NAME = process.env.BOT_NAME || 'PickupBot'
process.env.LOG_LEVEL = 'error'

const { goals } = pkg
const LP = await import('../src/logpickup.mjs')
const { collectManually, SKILLS, barrenFailClass } = await import('../src/skills.mjs')
const { evidenceScope, EVIDENCE_ABOUT_THE_ACTION, EVIDENCE_ONLY_IF_STUCK, EVIDENCE_ONLY_IF_HERE } =
  await import('../src/cognitive.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// ============================================================ pure: the box ===
console.log('-- the pickup box (vanilla Player.aiStep: inflate(1.0, 0.5, 1.0)) --')
const F = { x: 0.5, y: 64, z: 0.5 }
t('the numbers are vanilla: 1.425 across, -0.75 below, 2.3 above', () => {
  assert.equal(LP.BOX_H, 1.425); assert.equal(LP.BOX_BELOW, -0.75); assert.equal(LP.BOX_ABOVE, 2.3)
})
t('a drop at the feet is inside', () => assert.equal(LP.inPickupBox(F, { x: 0.5, y: 64, z: 0.5 }), true))
t('a drop one block over on the floor is inside', () => assert.equal(LP.inPickupBox(F, { x: 1.5, y: 64, z: 0.5 }), true))
t('a drop two blocks over is not', () => assert.equal(LP.inPickupBox(F, { x: 2.5, y: 64, z: 0.5 }), false))
t('a drop resting 2.0 up (on a block at head height) is inside', () =>
  assert.equal(LP.inPickupBox(F, { x: 1.5, y: 66.0, z: 0.5 }), true))
t('a drop resting 3.0 up (on leaves over the head) is NOT, however long the bot waits', () =>
  assert.equal(LP.inPickupBox(F, { x: 1.5, y: 67.0, z: 0.5 }), false))
t('a drop 1 below the feet (in a hole) is not', () => assert.equal(LP.inPickupBox(F, { x: 0.5, y: 63, z: 0.5 }), false))
t('garbage positions are outside, never inside', () => {
  assert.equal(LP.inPickupBox(null, F), false); assert.equal(LP.inPickupBox(F, { x: NaN, y: 64, z: 0 }), false)
})

console.log('-- the goal: pickup-box containment, not GoalNear(drop, 1) --')
const drop = { x: 1.5, y: 65.0, z: 0.5 }            // resting on a 1-high trunk stub at (1,64,0)
const G = LP.pickupGoal(goals, drop)
t('a node beside the stub is an end: its body box contains the drop', () => {
  assert.equal(G.isEnd({ x: 0, y: 64, z: 0 }), true)
  assert.equal(G.isEnd({ x: 2, y: 64, z: 0 }), true)
})
t('control: GoalNear(drop, 1) rejects the same nodes -- that is the empty acceptance set', () => {
  const near = new goals.GoalNear(drop.x, drop.y, drop.z, 1)
  assert.equal(near.isEnd({ x: 0, y: 64, z: 0 }), false)
  assert.equal(near.isEnd({ x: 2, y: 64, z: 0 }), false)
})
t('a node two blocks off is not an end (planner slack 0.35 respected)', () =>
  assert.equal(G.isEnd({ x: -1, y: 64, z: 0 }), false))
t('an elevated drop (3 up) has no end on the floor below it', () => {
  const g = LP.pickupGoal(goals, { x: 1.5, y: 67.0, z: 0.5 })
  for (const n of [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 1 }]) assert.equal(g.isEnd(n), false)
})
t('the heuristic is a lower bound at every end node (admissible)', () => {
  for (const n of [{ x: 0, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }, { x: 1, y: 65, z: 1 }]) assert.equal(G.heuristic(n), 0)
})
t('no goals module -> no goal (the caller says so instead of walking blind)', () =>
  assert.equal(LP.pickupGoal({}, drop), null))

console.log('-- strategy by drop offset --')
const S = (dropAt, extra = {}) => LP.choosePickupStrategy({ feet: F, drop: dropAt, logName: 'oak_log', breaksLeft: 2, supportOk: true, ...extra })
t('inside the box -> wait', () => assert.equal(S({ x: 1.5, y: 64, z: 0.5 }, { supportName: 'grass_block' }), 'wait'))
t('on the floor, out of reach -> walk', () => assert.equal(S({ x: 4.5, y: 64, z: 0.5 }, { supportName: 'grass_block' }), 'walk'))
t('3 up on leaves, support breakable -> break_support', () => assert.equal(S({ x: 1.5, y: 67, z: 0.5 }, { supportName: 'oak_leaves' }), 'break_support'))
t('3 up on the gathered log -> break_support', () => assert.equal(S({ x: 1.5, y: 67, z: 0.5 }, { supportName: 'oak_log' }), 'break_support'))
t('3 up on a DIFFERENT log or on stone -> walk (not ours to break)', () => {
  assert.equal(S({ x: 1.5, y: 67, z: 0.5 }, { supportName: 'birch_log' }), 'walk')
  assert.equal(S({ x: 1.5, y: 67, z: 0.5 }, { supportName: 'stone' }), 'walk')
})
t('3 up on leaves but unsafe/out of reach -> walk', () => assert.equal(S({ x: 1.5, y: 67, z: 0.5 }, { supportName: 'oak_leaves', supportOk: false }), 'walk'))
t('3 up on leaves with no breaks left -> walk', () => assert.equal(S({ x: 1.5, y: 67, z: 0.5 }, { supportName: 'oak_leaves', breaksLeft: 0 }), 'walk'))
t('2.0 up on leaves is in the box -> wait, nothing is broken', () => assert.equal(S({ x: 1.5, y: 66, z: 0.5 }, { supportName: 'oak_leaves' }), 'wait'))

t('lava anywhere around the support or under it refuses the break; unknown refuses too', () => {
  const air = () => ({ name: 'air' })
  assert.equal(LP.supportLavaFree(air, { x: 0, y: 66, z: 0 }), true)
  assert.equal(LP.supportLavaFree((x, y) => (y === 63 ? { name: 'lava' } : air()), { x: 0, y: 66, z: 0 }), false)
  assert.equal(LP.supportLavaFree((x) => (x === 1 ? { name: 'lava' } : air()), { x: 0, y: 66, z: 0 }), false)
  assert.equal(LP.supportLavaFree((x) => (x === 1 ? null : air()), { x: 0, y: 66, z: 0 }), false)
})
t('room: an empty slot, or a short stack of the log; a full bag of other things has none', () => {
  assert.equal(LP.hasRoomFor([], 1, 'oak_log'), true)
  assert.equal(LP.hasRoomFor([{ name: 'oak_log', count: 63 }], 0, 'oak_log'), true)
  assert.equal(LP.hasRoomFor([{ name: 'oak_log', count: 64 }, { name: 'dirt', count: 1 }], 0, 'oak_log'), false)
  assert.equal(LP.hasRoomFor([], undefined, 'oak_log'), true, 'an unreadable slot count is not a full bag')
})

console.log('-- verdicts and fail classes --')
t('only an inventory gain is a collection', () => {
  assert.equal(LP.transactionVerdict({ gained: 1, sawDrop: true }), 'collected')
  assert.equal(LP.transactionVerdict({ gained: 0, sawDrop: true }), 'pickup_failed')
  assert.equal(LP.transactionVerdict({ gained: 0, sawDrop: false }), 'break_unconfirmed')
  assert.equal(LP.transactionVerdict({ gained: 0, sawDrop: true, bagFull: true }), 'inventory_full')
})
t('a barren run whose blocks BROKE is pickup_failed, not no_path', () => {
  assert.equal(barrenFailClass(0, 3, 0, { pickupFailed: 3 }), 'pickup_failed')
  assert.equal(barrenFailClass(0, 3, 0, { pickupFailed: 1 }), 'pickup_failed')
  assert.equal(barrenFailClass(0, 3, 0, { unconfirmed: 2 }), 'break_unconfirmed')
})
t('control: a barren run with no break is still no_path (and the old cases are unchanged)', () => {
  assert.equal(barrenFailClass(0, 3, 0), 'no_path')
  assert.equal(barrenFailClass(0, 3, 0, { pickupFailed: 0, unconfirmed: 0 }), 'no_path')
  assert.equal(barrenFailClass(3, 3, 0), 'collect_budget')
  assert.equal(barrenFailClass(0, 3, 1), 'unreachable')
})
t('neither new class is evidence anywhere: no avoid rule, no situational lesson', () => {
  for (const fc of ['pickup_failed', 'break_unconfirmed', 'inventory_full']) {
    assert.equal(evidenceScope(fc), null, `${fc} would vote`)
    for (const s of [EVIDENCE_ABOUT_THE_ACTION, EVIDENCE_ONLY_IF_STUCK, EVIDENCE_ONLY_IF_HERE]) assert.equal(s.has(fc), false)
  }
  assert.equal(evidenceScope('no_path'), 'action', 'positive control: the instrument does see a voting class')
})

// ============================================================ the fake world ===
// Server side, written independently of src/logpickup.mjs: vanilla pickup box,
// 500 ms pickup delay, items fall to the first solid block.
const K = (x, y, z) => `${x},${y},${z}`
const ITEM_ID = 120, LOG_ID = 50
function world ({ blocks = {}, feet = [0.5, 64, 0.5], emptySlots = 10, thief = false, noDrop = false,
                  walkable = n => n.y === 64, jitter = 0, failName = 'NoPath', logs = 0 } = {}) {
  const w = new Map()
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) w.set(K(x, 63, z), 'grass_block')
  for (const [k, v] of Object.entries(blocks)) w.set(k, v)
  const name = (x, y, z) => w.get(K(Math.floor(x), Math.floor(y), Math.floor(z))) ?? 'air'
  const solid = (x, y, z) => name(x, y, z) !== 'air'
  const blockAt = p => {
    const n = name(p.x, p.y, p.z)
    return { name: n, type: n === 'oak_log' ? LOG_ID : 0, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
             boundingBox: n === 'air' ? 'empty' : 'block', diggable: n !== 'air' }
  }
  let held = logs, nextId = 1000
  const seen = { gotos: [], think: [], digs: [], rows: [] }
  const bot = {
    seen,
    entity: { position: new Vec3(...feet), onGround: true, velocity: new Vec3(0, 0, 0) },
    entities: {},
    heldItem: null,
    registry: {
      blocksByName: { oak_log: { id: LOG_ID, name: 'oak_log', drops: [ITEM_ID] } },
      blocks: { [LOG_ID]: { name: 'oak_log' } },
      items: { [ITEM_ID]: { name: 'oak_log' } },
      itemsByName: { oak_log: { id: ITEM_ID, name: 'oak_log', stackSize: 64 } },
    },
    inventory: {
      items: () => (held > 0 ? [{ name: 'oak_log', count: held, stackSize: 64, slot: 36 }] : []),
      emptySlotCount: () => emptySlots,
    },
    blockAt,
    canDigBlock: b => !!b && b.name !== 'air' &&
      Math.hypot(b.position.x + 0.5 - bot.entity.position.x, b.position.y + 0.5 - bot.entity.position.y - 1.65,
                 b.position.z + 0.5 - bot.entity.position.z) <= 5.1,
    findBlocks: ({ matching }) => [...w.entries()].filter(([, v]) => v === 'oak_log' && matching === LOG_ID)
      .map(([k]) => new Vec3(...k.split(',').map(Number)))
      .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)),
    findBlock: () => null,
    equip: async () => {},
    stopDigging: () => {},
    nearestEntity: pred => Object.values(bot.entities).filter(pred)
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null,
    dig: async b => {
      const p = b.position, was = name(p.x, p.y, p.z)
      seen.digs.push(`${was}@${p.x},${p.y},${p.z}`)
      w.delete(K(p.x, p.y, p.z))
      if (was === 'oak_log' && !noDrop) {
        const id = nextId++
        bot.entities[id] = { id, name: 'item', born: Date.now(), position: new Vec3(p.x + 0.5, p.y + 0.25, p.z + 0.5),
                             getDroppedItem: () => ({ name: 'oak_log', count: 1 }) }
        settle()
      }
    },
    pathfinder: {
      thinkTimeout: 5000,
      movements: { safeToBreak: () => true },
      setGoal () {}, stop () {},
      goto: async goal => {
        seen.gotos.push(goal.constructor.name); seen.think.push(bot.pathfinder.thinkTimeout)
        const nodes = []
        for (let x = -8; x <= 8; x++) for (let y = 60; y <= 72; y++) for (let z = -8; z <= 8; z++) {
          const n = { x, y, z }
          if (!solid(x, y, z) && !solid(x, y + 1, z) && solid(x, y - 1, z) && walkable(n) && goal.isEnd(n)) nodes.push(n)
        }
        if (!nodes.length) throw Object.assign(new Error('no path'), { name: failName })
        const p = bot.entity.position
        nodes.sort((a, b) => Math.hypot(a.x + 0.5 - p.x, a.z + 0.5 - p.z) - Math.hypot(b.x + 0.5 - p.x, b.z + 0.5 - p.z))
        bot.entity.position = new Vec3(nodes[0].x + 0.5 + jitter, nodes[0].y, nodes[0].z + 0.5)
      },
    },
  }
  // items fall to the first solid block, then the server's pickup check
  function settle () {
    for (const e of Object.values(bot.entities)) {
      let cy = Math.floor(e.position.y - 0.05)
      while (cy > 40 && !solid(e.position.x, cy, e.position.z)) cy--
      e.position = new Vec3(e.position.x, cy + 1, e.position.z)
    }
  }
  const touches = (pp, ip) => ip.x + 0.125 > pp.x - 1.3 && ip.x - 0.125 < pp.x + 1.3 &&
                              ip.z + 0.125 > pp.z - 1.3 && ip.z - 0.125 < pp.z + 1.3 &&
                              ip.y + 0.25 > pp.y - 0.5 && ip.y < pp.y + 2.3
  const tick = setInterval(() => {
    settle()
    for (const e of Object.values(bot.entities)) {
      const age = Date.now() - e.born
      if (thief && age >= 300) { delete bot.entities[e.id]; continue }        // another player took it
      if (age >= 500 && touches(bot.entity.position, e.position) && (emptySlots > 0 || (held > 0 && held < 64))) {
        delete bot.entities[e.id]; held++
      }
    }
  }, 25)
  bot.close = () => clearInterval(tick)
  bot.held = () => held
  return bot
}
const target = (bot, x, y, z) => bot.blockAt(new Vec3(x, y, z))
const run = async (bot, tgt) => {
  try { return { r: await collectManually(bot, tgt, new AbortController().signal) } }
  catch (e) { if (e.aborted) throw e; return { e } } finally { bot.close() }
}

// ============================================================ wired: collectManually ===
console.log('-- through the real collectManually --')

await ta('CANOPY CATCH: a drop on leaves 3 up -> break_support -> collected', async () => {
  const bot = world({ blocks: { [K(1, 67, 0)]: 'oak_log', [K(1, 66, 0)]: 'oak_leaves' } })
  const { r, e } = await run(bot, target(bot, 1, 67, 0))
  assert.equal(e, undefined, `threw: ${e?.message}`)
  assert.equal(bot.held(), 1, 'the log never reached the bag')
  assert.equal(r?.pickup?.verdict, 'collected')
  const row = r.pickup.rows[0]
  assert.equal(row.args.strategy, 'break_support', `strategy was ${row.args.strategies}`)
  assert.equal(row.args.outcome, 'collected'); assert.equal(row.args.delta, 1); assert.equal(row.args.dy, 3)
  assert.equal(row.args.support, 'oak_leaves')
  assert.deepEqual(bot.seen.digs, ['oak_log@1,67,0', 'oak_leaves@1,66,0'], 'only the log and the one leaf were broken')
})

await ta('OPEN TRUNK: a drop inside the box -> wait -> collected, no walk at all', async () => {
  const bot = world({ blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const { r, e } = await run(bot, target(bot, 1, 64, 0))
  assert.equal(e, undefined, `threw: ${e?.message}`)
  assert.equal(bot.held(), 1)
  assert.equal(r.pickup.verdict, 'collected')
  assert.equal(r.pickup.rows[0].args.strategy, 'wait')
  assert.deepEqual(bot.seen.gotos, [], 'a drop already in the box needs no walk')
})

await ta('ELEVATED STUB: a drop on a trunk stub -> walk to a pickup-box node -> collected', async () => {
  // The leaf over the stub makes the stub top unstandable, so GoalNear(drop, 1) has no end at all.
  const bot = world({ feet: [-2.5, 64, 0.5], jitter: -0.3,
                      blocks: { [K(1, 64, 0)]: 'oak_log', [K(1, 65, 0)]: 'oak_log', [K(1, 66, 0)]: 'oak_leaves' } })
  const { r, e } = await run(bot, target(bot, 1, 65, 0))
  assert.equal(e, undefined, `threw: ${e?.message}`)
  assert.equal(bot.held(), 1, `left behind: ${r?.pickup?.rows?.[0]?.detail}`)
  assert.equal(r.pickup.rows[0].args.strategy, 'walk')
  assert.deepEqual(bot.seen.gotos, ['GoalPickupBox'])
  assert.deepEqual(bot.seen.think, [LP.PICKUP_THINK_MS], 'A* think time must be capped for the pickup walk')
  assert.equal(bot.pathfinder.thinkTimeout, 5000, 'and restored afterwards')
})

await ta('UNREACHABLE: a drop on a stone ledge 3 up -> left, verdict pickup_failed, quickly', async () => {
  const bot = world({ blocks: { [K(1, 64, 0)]: 'stone', [K(1, 65, 0)]: 'stone', [K(1, 66, 0)]: 'stone', [K(1, 67, 0)]: 'oak_log' } })
  const t0 = Date.now()
  const { r, e } = await run(bot, target(bot, 1, 67, 0))
  assert.equal(e, undefined, `threw: ${e?.message}`)
  assert.equal(bot.held(), 0)
  assert.equal(r.pickup.verdict, 'pickup_failed')
  assert.equal(r.pickup.rows[0].args.outcome, 'left')
  assert.equal(r.pickup.rows[0].args.reason, 'unreachable')
  assert.deepEqual(bot.seen.digs, ['oak_log@1,67,0'], 'stone is never broken to free a drop')
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`)
})

await ta('RETIRE IS NOT COMPLETION: a drop taken by someone else -> left, pickup_failed', async () => {
  const bot = world({ thief: true, blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const { r } = await run(bot, target(bot, 1, 64, 0))
  assert.equal(bot.held(), 0)
  assert.equal(r.pickup.verdict, 'pickup_failed', `verdict ${r.pickup.verdict}`)
  assert.equal(r.pickup.rows[0].args.outcome, 'left')
  assert.equal(r.pickup.rows[0].args.reason, 'vanished')
})

await ta('NO DROP EVER APPEARED: the server never confirmed the break -> break_unconfirmed', async () => {
  const bot = world({ noDrop: true, blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const { r } = await run(bot, target(bot, 1, 64, 0))
  assert.equal(r.pickup.verdict, 'break_unconfirmed')
  assert.equal(r.pickup.rows[0].args.reason, 'no_drop_seen')
})

await ta('FULL BAG: no slot for the log -> inventory_full, no walking', async () => {
  const bot = world({ emptySlots: 0, feet: [-2.5, 64, 0.5], blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const { r } = await run(bot, target(bot, 1, 64, 0))
  assert.equal(r.pickup.verdict, 'inventory_full')
  assert.deepEqual(bot.seen.gotos, [])
})

// ============================================================ wired: gather ===
console.log('-- through the real gather --')
const gather = async bot => { try { return await SKILLS.gather.run({ bot }, { block: 'oak_log', count: 4 }, null) } finally { bot.close() } }
const ledges = { }
for (const [x, z] of [[1, 0], [-1, 0], [0, 1]]) {
  for (const y of [64, 65, 66]) ledges[K(x, y, z)] = 'stone'
  ledges[K(x, 67, z)] = 'oak_log'
}

await ta('UNREACHABLE DROPS: the run is pickup_failed, NOT no_path, and gets no vote', async () => {
  const bot = world({ blocks: ledges })
  const r = await gather(bot)
  assert.equal(bot.seen.digs.filter(d => d.startsWith('oak_log')).length, 3, `digs: ${bot.seen.digs}`)
  assert.equal(r.failClass, 'pickup_failed', `${r.failClass}: ${r.detail}`)
  assert.equal(evidenceScope(r.failClass), null, 'an unpicked drop must not become an avoid rule')
})

await ta('control: ROUTE FAILURE is still no_path (logs out of reach, nothing broken)', async () => {
  const air = {}
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1]]) air[K(x, 72, z)] = 'oak_log'
  const bot = world({ blocks: air })
  const r = await gather(bot)
  assert.deepEqual(bot.seen.digs, [], 'nothing was in reach, so nothing broke')
  assert.equal(r.failClass, 'no_path', `${r.failClass}: ${r.detail}`)
  assert.equal(evidenceScope(r.failClass), 'action')
})

await ta('GHOST BREAKS: no drop on any round -> break_unconfirmed', async () => {
  const blocks = {}
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1]]) blocks[K(x, 64, z)] = 'oak_log'
  const bot = world({ noDrop: true, blocks })
  const r = await gather(bot)
  assert.equal(r.failClass, 'break_unconfirmed', `${r.failClass}: ${r.detail}`)
})

await ta('FULL BAG: gather stops after ONE broken log and says inventory_full', async () => {
  const blocks = {}
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1]]) blocks[K(x, 64, z)] = 'oak_log'
  const bot = world({ emptySlots: 0, blocks })
  const r = await gather(bot)
  assert.equal(r.failClass, 'inventory_full', `${r.failClass}: ${r.detail}`)
  assert.equal(bot.seen.digs.length, 1, 'it kept breaking logs it could not take')
  assert.match(r.detail, /deposit|wear_out/, 'the refusal names a remedy')
})

await ta('control: open trunks are gathered (the instrument sees a success)', async () => {
  const blocks = {}
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) blocks[K(x, 64, z)] = 'oak_log'
  const bot = world({ blocks })
  const r = await gather(bot)
  assert.equal(r.status, 'success', `${r.failClass}: ${r.detail}`)
  assert.equal(bot.held(), 4)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
