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
import { EventEmitter } from 'node:events'
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

console.log('-- review fixes, pure --')
t('standing height: a bottom slab is half a block, a full block one, unknown one', () => {
  assert.equal(LP.standHeight({ shapes: [[0, 0, 0, 1, 0.5, 1]] }), 0.5)
  assert.equal(LP.standHeight({ shapes: [[0, 0, 0, 1, 1, 1]] }), 1)
  assert.equal(LP.standHeight({ shapes: [] }), 1)
  assert.equal(LP.standHeight(null), 1)
})
t('the goal uses the real feet: a node over a bottom slab sees a floor drop 0.5 down, not 1.0', () => {
  const onFloor = { x: 1.5, y: 64.0, z: 0.5 }
  const slabY = n => n.y - 0.5
  assert.equal(LP.pickupGoal(goals, onFloor, slabY).isEnd({ x: 0, y: 65, z: 0 }), true)
  assert.equal(LP.pickupGoal(goals, onFloor).isEnd({ x: 0, y: 65, z: 0 }), false, 'control: node.y alone rejects it')
  const high = { x: 1.5, y: 67.0, z: 0.5 }                         // 2.0 over node.y, 2.5 over the real feet
  assert.equal(LP.pickupGoal(goals, high).isEnd({ x: 0, y: 65, z: 0 }), true, 'control: node.y alone accepts it')
  assert.equal(LP.pickupGoal(goals, high, slabY).isEnd({ x: 0, y: 65, z: 0 }), false, 'the slab feet cannot reach 2.5 up')
})
const air = () => ({ name: 'air' })
const leaf = (extra = {}) => ({ name: 'oak_leaves', position: { x: 0, y: 66, z: 0 }, ...extra })
const V0 = (extra = {}) => LP.supportVeto({ block: leaf(), at: air, safeToBreak: () => true, canDig: true, ...extra })
t('supportVeto passes a plain leaf', () => assert.equal(V0(), null))
t('supportVeto FAILS CLOSED: no safety checker, out of reach, unknown neighbour, checker says no', () => {
  assert.equal(V0({ safeToBreak: null }), 'no_safety_checker')
  assert.equal(V0({ canDig: false }), 'out_of_reach')
  assert.equal(V0({ at: (x) => (x === 1 ? null : air()) }), 'unknown_neighbour')
  assert.equal(V0({ safeToBreak: () => false }), 'unsafe')
  assert.equal(V0({ safeToBreak: () => { throw new Error('x') } }), 'unsafe')
})
t('supportVeto: waterlogged support, water beside, lava, gravity and dripstone, last swing', () => {
  assert.equal(V0({ block: leaf({ getProperties: () => ({ waterlogged: true }) }) }), 'waterlogged')
  assert.equal(V0({ at: (x) => (x === 1 ? { name: 'water' } : air()) }), 'water_beside')
  assert.equal(V0({ at: (x, y) => (x === 1 && y === 66 ? { name: 'lava' } : air()) }), 'lava')
  assert.equal(V0({ at: (x, y) => (y === 67 ? { name: 'red_concrete_powder' } : air()) }), 'falling_block')
  assert.equal(V0({ at: (x, y) => (y === 65 ? { name: 'pointed_dripstone' } : air()) }), 'falling_block')
  assert.equal(V0({ at: (x, y) => (y === 67 ? { name: 'suspicious_sand' } : air()) }), 'falling_block')
  assert.equal(V0({ heldSpent: true }), 'last_swing')
})
t('support dig timeout comes from digTime; a dig that cannot fit is not started', () => {
  assert.equal(LP.supportDigTimeout(3000, 6000), 4250, 'a bare-handed grounded log (3 s) gets 4.25 s, not 3')
  assert.equal(LP.supportDigTimeout(15000, 6000), null, 'a bare-handed airborne log (15 s) is skipped')
  assert.equal(LP.supportDigTimeout(NaN, 6000), null)
})
const ent = (id, name, count = 1, at = { x: 1.5, y: 64, z: 0.5 }) => ({ id, name: 'item', position: at,
  getDroppedItem: () => (name ? { name, count } : null) })
const FAM = new Set(['oak_log'])
t('a drop of THIS dig: a new log, or a pre-existing log stack that GREW (merge)', () => {
  const cell = { x: 1, y: 64, z: 0 }
  assert.equal(LP.isDropFrom(ent(1, 'oak_log'), cell, FAM, new Map()), true)
  assert.equal(LP.isDropFrom(ent(1, 'oak_log', 2), cell, FAM, new Map([[1, 1]])), true, 'grew 1 -> 2')
  assert.equal(LP.isDropFrom(ent(1, 'oak_log', 1), cell, FAM, new Map([[1, 1]])), false, 'unchanged stack is not ours')
  assert.equal(LP.isDropFrom(ent(2, 'oak_sapling'), cell, FAM, new Map()), false, 'a sapling is not a log')
  assert.equal(LP.isDropFrom(ent(3, null), cell, FAM, new Map()), true, 'unidentified is TRACKED (acted on only once identified)')
})

// ============================================================ the fake world ===
// Server side, written independently of src/logpickup.mjs: vanilla pickup box, a
// 500 ms pickup delay, and PACKET-DRIVEN item motion -- a drop spawns mid-air in
// the broken cell (+0.4) and its position changes only when a "landing packet"
// arrives 450 ms later (entityMoved), exactly as mineflayer sees other entities.
const K = (x, y, z) => `${x},${y},${z}`
const ITEM_ID = 120, LOG_ID = 50, FALL_MS = 450
const SHAPES = { air: [], oak_slab: [[0, 0, 0, 1, 0.5, 1]] }
function world ({ blocks = {}, feet = [0.5, 64, 0.5], emptySlots = 10, thief = false, noDrop = false, mergeInto = false,
                  walkable = n => n.y === 64, jitter = 0, failName = 'NoPath', digTimes = {}, metaDelay = 0,
                  waterlogged = [], safety = true, heldItem = null, walkMs = 0, items = [], held = {} } = {}) {
  const w = new Map()
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) w.set(K(x, 63, z), 'grass_block')
  for (const [k, v] of Object.entries(blocks)) w.set(k, v)
  const wet = new Set(waterlogged)
  const name = (x, y, z) => w.get(K(Math.floor(x), Math.floor(y), Math.floor(z))) ?? 'air'
  const solid = (x, y, z) => !['air', 'water', 'lava'].includes(name(x, y, z))
  const top = (x, y, z) => { const s = SHAPES[name(x, y, z)]; return s ? (s.length ? s[0][4] : 0) : 1 }
  const blockAt = p => {
    const n = name(p.x, p.y, p.z), q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    return { name: n, type: n === 'oak_log' ? LOG_ID : 0, position: q, liquid: n === 'water' || n === 'lava',
             boundingBox: solid(q.x, q.y, q.z) ? 'block' : 'empty', diggable: solid(q.x, q.y, q.z),
             shapes: SHAPES[n] ?? [[0, 0, 0, 1, 1, 1]], getProperties: () => ({ waterlogged: wet.has(K(q.x, q.y, q.z)) }) }
  }
  const inv = new Map([['oak_log', 0], ...Object.entries(held)])
  let nextId = 1000, digCancel = null, walkCancel = null
  const seen = { gotos: [], goals: [], think: [], digs: [], halted: 0 }
  const bot = new EventEmitter()
  const restY = e => { let cy = Math.floor(e.position.y - 0.05); while (cy > 40 && !solid(e.position.x, cy, e.position.z)) cy--; return cy + top(e.position.x, cy, e.position.z) }
  const spawn = (n, at, count = 1, born = Date.now()) => {
    const id = nextId++
    bot.entities[id] = { id, name: 'item', born, metaAt: born + metaDelay, n, count, position: at, landAt: null,
                         getDroppedItem () { return Date.now() >= this.metaAt ? { name: this.n, count: this.count } : null } }
    return bot.entities[id]
  }
  Object.assign(bot, {
    seen,
    entity: { position: new Vec3(...feet), onGround: true, velocity: new Vec3(0, 0, 0) },
    entities: {},
    heldItem,
    registry: {
      blocksByName: { oak_log: { id: LOG_ID, name: 'oak_log', drops: [ITEM_ID] } },
      blocks: { [LOG_ID]: { name: 'oak_log' } },
      items: { [ITEM_ID]: { name: 'oak_log' } },
      itemsByName: { oak_log: { id: ITEM_ID, name: 'oak_log', stackSize: 64 } },
    },
    inventory: {
      items: () => [...inv.entries()].filter(([, c]) => c > 0).map(([n, c], i) => ({ name: n, count: c, stackSize: 64, slot: 36 + i })),
      emptySlotCount: () => emptySlots,
    },
    blockAt,
    canDigBlock: b => !!b && solid(b.position.x, b.position.y, b.position.z) &&
      Math.hypot(b.position.x + 0.5 - bot.entity.position.x, b.position.y + 0.5 - bot.entity.position.y - 1.65,
                 b.position.z + 0.5 - bot.entity.position.z) <= 5.1,
    digTime: b => digTimes[b.name] ?? (/_leaves$/.test(b.name) ? 50 : 30),
    findBlocks: ({ matching }) => [...w.entries()].filter(([, v]) => v === 'oak_log' && matching === LOG_ID)
      .map(([k]) => new Vec3(...k.split(',').map(Number)))
      .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)),
    findBlock: () => null,
    equip: async () => {},
    stopDigging: () => { digCancel?.() },
    nearestEntity: pred => Object.values(bot.entities).filter(pred)
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null,
    dig: b => new Promise((resolve, reject) => {
      const p = b.position, was = name(p.x, p.y, p.z)
      const timer = setTimeout(() => {
        digCancel = null
        seen.digs.push(`${was}@${p.x},${p.y},${p.z}`)
        w.delete(K(p.x, p.y, p.z))
        if (was === 'oak_log' && !noDrop) {
          const near = mergeInto && Object.values(bot.entities).find(e => e.n === 'oak_log' &&
            Math.abs(e.position.x - (p.x + 0.5)) <= 1.5 && Math.abs(e.position.z - (p.z + 0.5)) <= 1.5)
          if (near) near.count++
          else spawn('oak_log', new Vec3(p.x + 0.5, p.y + 0.4, p.z + 0.5))
        }
        resolve()
      }, bot.digTime(b))
      digCancel = () => { clearTimeout(timer); digCancel = null; reject(new Error('Digging aborted')) }
    }),
    pathfinder: {
      thinkTimeout: 5000,
      movements: safety ? { safeToBreak: () => true } : {},
      setGoal (g) { if (g === null) { seen.halted++; walkCancel?.() } },
      stop () {},
      goto: async goal => {
        seen.gotos.push(goal.constructor.name); seen.goals.push(goal); seen.think.push(bot.pathfinder.thinkTimeout)
        const nodes = []
        for (let x = -8; x <= 8; x++) for (let y = 60; y <= 72; y++) for (let z = -8; z <= 8; z++) {
          const n = { x, y, z }
          if (!solid(x, y, z) && !solid(x, y + 1, z) && solid(x, y - 1, z) && walkable(n) && goal.isEnd(n)) nodes.push(n)
        }
        if (walkMs) {
          await new Promise((resolve, reject) => {
            const tm = setTimeout(resolve, walkMs)
            walkCancel = () => { clearTimeout(tm); walkCancel = null; reject(Object.assign(new Error('stopped'), { name: 'PathStopped' })) }
          })
        }
        if (!nodes.length) throw Object.assign(new Error('no path'), { name: failName })
        const p = bot.entity.position
        nodes.sort((a, b) => Math.hypot(a.x + 0.5 - p.x, a.z + 0.5 - p.z) - Math.hypot(b.x + 0.5 - p.x, b.z + 0.5 - p.z))
        const n = nodes[0]
        bot.entity.position = new Vec3(n.x + 0.5 + jitter, n.y - 1 + top(n.x, n.y - 1, n.z), n.z + 0.5)
      },
    },
  })
  for (const it of items) { const e = spawn(it.name, new Vec3(...it.at), it.count ?? 1, Date.now() - 5000); if (it.meta === false) e.metaAt = Infinity }
  // the server: items fall (seen only when the landing packet arrives), then the pickup check
  const touches = (pp, ip) => ip.x + 0.125 > pp.x - 1.3 && ip.x - 0.125 < pp.x + 1.3 &&
                              ip.z + 0.125 > pp.z - 1.3 && ip.z - 0.125 < pp.z + 1.3 &&
                              ip.y + 0.25 > pp.y - 0.5 && ip.y < pp.y + 2.3
  const tick = setInterval(() => {
    const now = Date.now()
    for (const e of Object.values(bot.entities)) {
      const ry = restY(e)
      if (Math.abs(ry - e.position.y) > 1e-6) {
        if (e.landAt == null) e.landAt = now + FALL_MS
        if (now >= e.landAt) { e.position = new Vec3(e.position.x, ry, e.position.z); e.landAt = null; bot.emit('entityMoved', e) }
        continue
      }
      const age = now - e.born
      if (thief && age >= 300) { delete bot.entities[e.id]; continue }      // another player took it
      if (age >= 500 && touches(bot.entity.position, e.position) &&
          (emptySlots > 0 || ((inv.get(e.n) ?? 0) > 0 && inv.get(e.n) < 64))) {
        delete bot.entities[e.id]; inv.set(e.n, (inv.get(e.n) ?? 0) + e.count)
      }
    }
  }, 25)
  bot.close = () => clearInterval(tick)
  bot.held = (n = 'oak_log') => inv.get(n) ?? 0
  return bot
}
const target = (bot, x, y, z) => bot.blockAt(new Vec3(x, y, z))
const run = async (bot, tgt, { signal = new AbortController().signal, deadline } = {}) => {
  try { return { r: await collectManually(bot, tgt, signal, deadline ? { deadline } : undefined) } }
  catch (e) { return { e } } finally { bot.close() }
}
const CANOPY = { [K(1, 67, 0)]: 'oak_log', [K(1, 66, 0)]: 'oak_leaves' }

// ============================================================ wired: collectManually ===
console.log('-- through the real collectManually --')

await ta('CANOPY CATCH (packet-driven): the drop lands on leaves 3 up -> break_support -> collected', async () => {
  const bot = world({ blocks: CANOPY })
  const { r, e } = await run(bot, target(bot, 1, 67, 0))
  assert.equal(e, undefined, `threw: ${e?.message}`)
  assert.equal(bot.held(), 1, `the log never reached the bag: ${r?.pickup?.rows?.[0]?.detail}`)
  assert.equal(r?.pickup?.verdict, 'collected')
  const row = r.pickup.rows[0]
  assert.equal(row.args.strategy, 'break_support', `strategy was ${row.args.strategies} (${row.detail})`)
  assert.equal(row.args.dy, 3, 'the decision was made from the LANDED position, not mid-air')
  assert.equal(row.args.support, 'oak_leaves')
  assert.deepEqual(bot.seen.digs, ['oak_log@1,67,0', 'oak_leaves@1,66,0'], 'only the log and the one leaf were broken')
})

await ta('OPEN TRUNK: a drop inside the box -> wait -> collected, no walk at all', async () => {
  const bot = world({ blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const { r, e } = await run(bot, target(bot, 1, 64, 0))
  assert.equal(e, undefined, `threw: ${e?.message}`)
  assert.equal(bot.held(), 1)
  assert.equal(r.pickup.rows[0].args.strategy, 'wait')
  assert.deepEqual(bot.seen.gotos, [], 'a drop already in the box needs no walk')
})

await ta('SAPLINGS STILL COME HOME: the short sweep after the log takes a sapling 3 blocks off', async () => {
  const bot = world({ blocks: { [K(1, 64, 0)]: 'oak_log' }, items: [{ name: 'oak_sapling', at: [-2.5, 64, 0.5] }] })
  const { r } = await run(bot, target(bot, 1, 64, 0))
  assert.equal(r.pickup.verdict, 'collected')
  assert.equal(bot.held('oak_sapling'), 1, 'the sapling was left on the ground')
})

await ta('METADATA LATE: a drop identified 300 ms after it appeared is still collected', async () => {
  const bot = world({ metaDelay: 300, blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const { r } = await run(bot, target(bot, 1, 64, 0))
  assert.equal(bot.held(), 1, r?.pickup?.rows?.[0]?.detail)
})

await ta('UNIDENTIFIED: metadata never arrives -> not pursued, no support broken', async () => {
  const bot = world({ metaDelay: 1e9, blocks: CANOPY })
  const { r } = await run(bot, target(bot, 1, 67, 0))
  assert.deepEqual(bot.seen.digs, ['oak_log@1,67,0'], 'a support was broken for an item nobody identified')
  assert.equal(r.pickup.rows[0].args.reason, 'unidentified')
})

await ta('ELEVATED STUB: a drop on a trunk stub -> walk to a pickup-box node -> collected', async () => {
  const bot = world({ feet: [-2.5, 64, 0.5], jitter: -0.3,
                      blocks: { [K(1, 64, 0)]: 'oak_log', [K(1, 65, 0)]: 'oak_log', [K(1, 66, 0)]: 'oak_leaves' } })
  const { r, e } = await run(bot, target(bot, 1, 65, 0))
  assert.equal(e, undefined, `threw: ${e?.message}`)
  assert.equal(bot.held(), 1, `left behind: ${r?.pickup?.rows?.[0]?.detail}`)
  assert.equal(r.pickup.rows[0].args.strategy, 'walk')
  assert.equal(bot.seen.gotos[0], 'GoalPickupBox')
  assert.equal(bot.seen.think[0], LP.PICKUP_THINK_MS, 'A* think time must be capped for the pickup walk')
  assert.equal(bot.pathfinder.thinkTimeout, 5000, 'and restored afterwards')
})

await ta('BOTTOM SLAB: the only stance is on a slab (feet 0.5 under node.y) -> walk -> collected', async () => {
  const bot = world({ feet: [-2.5, 64, 0.5], walkable: n => n.x === 0 && n.y === 65 && n.z === 0,
                      blocks: { [K(1, 64, 0)]: 'oak_log', [K(0, 64, 0)]: 'oak_slab' } })
  const { r } = await run(bot, target(bot, 1, 64, 0))
  assert.equal(bot.held(), 1, `left behind: ${r?.pickup?.rows?.[0]?.detail}`)
  assert.equal(bot.entity.position.y, 64.5, 'the bot stands on the slab')
})

await ta('UNREACHABLE: a drop on a stone ledge 3 up -> left, pickup_failed; the sweep does not re-chase it', async () => {
  const bot = world({ blocks: { [K(1, 64, 0)]: 'stone', [K(1, 65, 0)]: 'stone', [K(1, 66, 0)]: 'stone', [K(1, 67, 0)]: 'oak_log' },
                      items: [{ name: 'oak_sapling', at: [-1.5, 64, 0.5] }] })   // fetching it leaves the log drop inside the sweep radius
  const t0 = Date.now()
  const { r, e } = await run(bot, target(bot, 1, 67, 0))
  assert.equal(e, undefined, `threw: ${e?.message}`)
  assert.equal(bot.held(), 0)
  assert.equal(r.pickup.verdict, 'pickup_failed')
  assert.equal(r.pickup.rows[0].args.reason, 'unreachable')
  assert.deepEqual(bot.seen.digs, ['oak_log@1,67,0'], 'stone is never broken to free a drop')
  assert.equal(bot.held('oak_sapling'), 1, 'the sapling sweep still ran')
  const chasedLog = bot.seen.goals.filter(g => g.constructor.name === 'GoalNear' && g.x === 1 && g.z === 0)
  assert.equal(chasedLog.length, 0, 'the sweep re-chased the judged log drop with GoalNear')
  assert.ok(Date.now() - t0 < 4500, `took ${Date.now() - t0} ms`)
})

await ta('BARE-HAND LOG SUPPORT (3.2 s dig): the support break gets a digTime-sized timeout -> collected', async () => {
  const bot = world({ digTimes: { oak_log: 3200 }, blocks: { [K(1, 67, 0)]: 'oak_log', [K(1, 66, 0)]: 'oak_log' } })
  const { r } = await run(bot, target(bot, 1, 67, 0))
  assert.ok(bot.seen.digs.includes('oak_log@1,66,0'), `the support dig was killed: ${r?.pickup?.rows?.[0]?.detail}`)
  assert.ok(bot.held() >= 1, r?.pickup?.rows?.[0]?.detail)
})

await ta('A SUPPORT DIG THAT CANNOT FIT (15 s) is not started', async () => {
  const bot = world({ digTimes: { oak_log: 15000 }, blocks: { [K(1, 67, 0)]: 'oak_log', [K(1, 66, 0)]: 'oak_log' } })
  // the target itself is broken first (slow, as on the fleet); then the support must be refused, not started
  bot.digTime = b => (b.position.y === 67 ? 30 : 15000)
  const { r } = await run(bot, target(bot, 1, 67, 0))
  assert.deepEqual(bot.seen.digs, ['oak_log@1,67,0'])
  assert.match(String(r.pickup.rows[0].args.veto), /dig_too_slow/)
})

for (const [label, opts, veto] of [
  ['LAVA beside the support', { blocks: { ...CANOPY, [K(2, 66, 0)]: 'lava' } }, 'lava'],
  ['a WATERLOGGED leaf', { blocks: CANOPY, waterlogged: [K(1, 66, 0)] }, 'waterlogged'],
  ['the held tool at its LAST SWING', { blocks: CANOPY, heldItem: { name: 'iron_axe', maxDurability: 250, durabilityUsed: 249 } }, 'last_swing'],
  ['NO SAFETY CHECKER', { blocks: CANOPY, safety: false }, 'no_safety_checker'],
  ['DRIPSTONE hanging under the leaf', { blocks: { ...CANOPY, [K(1, 65, 0)]: 'pointed_dripstone' } }, 'falling_block'],
]) {
  await ta(`SAFETY: ${label} -> the support is NOT broken (veto=${veto})`, async () => {
    const bot = world(opts)
    const { r, e } = await run(bot, target(bot, 1, 67, 0))
    assert.equal(e, undefined, `threw: ${e?.message}`)
    assert.deepEqual(bot.seen.digs, ['oak_log@1,67,0'], 'the support was broken')
    assert.equal(r.pickup.rows[0].args.veto, veto, r.pickup.rows[0].detail)
  })
}

await ta('MERGE: the drop merges into an older log stack on the leaves -> that stack is pursued -> collected', async () => {
  const bot = world({ mergeInto: true, blocks: { [K(2, 67, 0)]: 'oak_log', [K(1, 66, 0)]: 'oak_leaves' },
                      items: [{ name: 'oak_log', at: [1.5, 67, 0.5] }] })
  const { r } = await run(bot, target(bot, 2, 67, 0))
  assert.equal(r.pickup.verdict, 'collected', r.pickup.rows[0]?.detail)
  assert.equal(bot.held(), 2, 'the grown stack (old + new) reached the bag')
})

await ta('RETIRE IS NOT COMPLETION: a drop taken by someone else -> left, pickup_failed', async () => {
  const bot = world({ thief: true, blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const { r } = await run(bot, target(bot, 1, 64, 0))
  assert.equal(bot.held(), 0)
  assert.equal(r.pickup.verdict, 'pickup_failed', `verdict ${r.pickup.verdict}`)
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

const STUB = { [K(1, 64, 0)]: 'oak_log', [K(1, 65, 0)]: 'oak_log', [K(1, 66, 0)]: 'oak_leaves' }
await ta('HARD DEADLINE: a slow walk is clamped to the deadline and cancelled', async () => {
  const bot = world({ feet: [-2.5, 64, 0.5], walkMs: 4000, blocks: STUB })
  const t0 = Date.now()
  const { r, e } = await run(bot, target(bot, 1, 65, 0), { deadline: Date.now() + 1500 })
  assert.equal(e, undefined, `threw: ${e?.message}`)
  assert.ok(Date.now() - t0 < 2200, `ran ${Date.now() - t0} ms past a 1500 ms deadline`)
  assert.ok(bot.seen.halted >= 1, 'the in-flight walk was never cancelled')
  assert.notEqual(r.pickup.verdict, 'collected')
})

await ta('ABORT: an abort mid-walk rejects at once and cancels the walk', async () => {
  const bot = world({ feet: [-2.5, 64, 0.5], walkMs: 4000, blocks: STUB })
  const ac = new AbortController()
  let abortedAt = 0
  setTimeout(() => { abortedAt = Date.now(); ac.abort() }, 1200)
  const { e } = await run(bot, target(bot, 1, 65, 0), { signal: ac.signal })
  assert.ok(e?.aborted, `did not reject as aborted: ${e?.message}`)
  assert.ok(Date.now() - abortedAt < 400, `took ${Date.now() - abortedAt} ms to stop after the abort`)
  assert.ok(bot.seen.halted >= 1, 'the in-flight walk was never cancelled')
})

console.log('-- second-pass fixes --')
const it = (name) => ({ getDroppedItem: () => (name ? { name, count: 1 } : null) })
const inv = (pairs, emptySlots = 10, pad = 0) => ({
  items: [...pairs.map(([n, c]) => ({ name: n, count: c, stackSize: 64 })), ...Array.from({ length: pad }, (_, i) => ({ name: `junk${i}`, count: 64, stackSize: 64 }))],
  emptySlots })
t('the sweep wants saplings below the reserve and apples; never logs, never unidentified', () => {
  assert.equal(LP.SAPLING_RESERVE, 16)
  assert.equal(LP.sweepWants(it('oak_sapling'), inv([])), true)
  assert.equal(LP.sweepWants(it('apple'), inv([])), true)
  assert.equal(LP.sweepWants(it('oak_log'), inv([])), false, 'another log brings GoalNear(drop,1) back')
  assert.equal(LP.sweepWants(it(null), inv([])), false, 'unidentified is never chased')
  assert.equal(LP.sweepWants(it('cobblestone'), inv([])), false)
})
t('a sapling is skipped at 16 held of that species, not of another', () => {
  assert.equal(LP.sweepWants(it('oak_sapling'), inv([['oak_sapling', 16]])), false)
  assert.equal(LP.sweepWants(it('oak_sapling'), inv([['oak_sapling', 15]])), true)
  assert.equal(LP.sweepWants(it('birch_sapling'), inv([['oak_sapling', 16]])), true)
  assert.equal(LP.sweepWants(it('apple'), inv([['apple', 40]])), true, 'apples are food: always')
})
t('room: a partial stack, or >= 2 free slots; never at >= 34 used slots', () => {
  assert.equal(LP.sweepWants(it('apple'), inv([], 1)), false, 'one free slot is not enough')
  assert.equal(LP.sweepWants(it('apple'), inv([['apple', 3]], 0)), true, 'a partial stack takes it')
  assert.equal(LP.sweepWants(it('apple'), inv([['apple', 64]], 1)), false)
  assert.equal(LP.sweepWants(it('apple'), inv([['apple', 3]], 2, 33)), false, '34 used slots: hygiene trigger')
  assert.equal(LP.sweepWants(it('apple'), inv([], NaN)), false, 'unknown room: skip')
})

await ta('SWEEP: an earlier dig\'s log drop within 4 blocks is NOT chased', async () => {
  // an old log on a stone ledge 3 up, inside the 4-block sweep radius; the new log is an open trunk
  const bot = world({ blocks: { [K(1, 64, 0)]: 'oak_log', [K(-1, 64, 0)]: 'stone', [K(-1, 65, 0)]: 'stone', [K(-1, 66, 0)]: 'stone' },
                      items: [{ name: 'oak_log', at: [-0.5, 67, 0.5] }] })
  const { r } = await run(bot, target(bot, 1, 64, 0))
  assert.equal(r.pickup.verdict, 'collected')
  assert.equal(bot.seen.goals.filter(g => g.constructor.name === 'GoalNear').length, 0, 'the sweep chased another log')
})

await ta('SWEEP: an item with no metadata is NOT chased', async () => {
  const bot = world({ blocks: { [K(1, 64, 0)]: 'oak_log' }, items: [{ name: 'oak_sapling', at: [-2.5, 64, 0.5], meta: false }] })
  await run(bot, target(bot, 1, 64, 0))
  assert.equal(bot.seen.goals.filter(g => g.constructor.name === 'GoalNear').length, 0, 'an unidentified item was chased')
})

await ta('SWEEP: a sapling is skipped when 16 of that species are held', async () => {
  const bot = world({ blocks: { [K(1, 64, 0)]: 'oak_log' }, held: { oak_sapling: 16 },
                      items: [{ name: 'oak_sapling', at: [-2.5, 64, 0.5] }] })
  await run(bot, target(bot, 1, 64, 0))
  assert.equal(bot.held('oak_sapling'), 16)
  assert.equal(bot.seen.goals.filter(g => g.constructor.name === 'GoalNear').length, 0)
})

await ta('SWEEP ABORT: an abort during the sweep walk rejects at once and cancels it', async () => {
  const bot = world({ blocks: { [K(1, 64, 0)]: 'oak_log' }, walkMs: 4000, items: [{ name: 'oak_sapling', at: [-2.5, 64, 0.5] }] })
  const ac = new AbortController()
  let abortedAt = 0
  // the log is collected by waiting (no walk); the first walk is the sweep's
  bot.pathfinder.goto = (orig => async g => { if (!abortedAt) setTimeout(() => { abortedAt = Date.now(); ac.abort() }, 300); return orig(g) })(bot.pathfinder.goto)
  const { e } = await run(bot, target(bot, 1, 64, 0), { signal: ac.signal })
  assert.ok(e?.aborted, `did not reject as aborted: ${e?.message}`)
  assert.ok(Date.now() - abortedAt < 400, `took ${Date.now() - abortedAt} ms after the abort`)
  assert.ok(bot.seen.halted >= 1, 'the sweep walk was never cancelled')
})

await ta('INITIAL DIG, DEADLINE: a 3 s dig is clamped to the deadline and stopped', async () => {
  const bot = world({ digTimes: { oak_log: 3000 }, blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const t0 = Date.now()
  const { e } = await run(bot, target(bot, 1, 64, 0), { deadline: Date.now() + 800 })
  assert.ok(e, 'a dig past the deadline must not report success')
  assert.ok(Date.now() - t0 < 1300, `ran ${Date.now() - t0} ms past an 800 ms deadline`)
  assert.deepEqual(bot.seen.digs, [], 'the dig was not stopped')
})

await ta('INITIAL DIG, ABORT: an abort mid-dig rejects at once and stops the dig', async () => {
  const bot = world({ digTimes: { oak_log: 3000 }, blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const ac = new AbortController()
  let abortedAt = 0
  setTimeout(() => { abortedAt = Date.now(); ac.abort() }, 400)
  const { e } = await run(bot, target(bot, 1, 64, 0), { signal: ac.signal })
  assert.ok(e?.aborted, `did not reject as aborted: ${e?.message}`)
  assert.ok(Date.now() - abortedAt < 300, `took ${Date.now() - abortedAt} ms after the abort`)
  assert.deepEqual(bot.seen.digs, [], 'the dig was not stopped')
})

await ta('WALK BEFORE THE DIG, DEADLINE: a slow approach is clamped to the deadline', async () => {
  const bot = world({ feet: [-6.5, 64, 0.5], walkMs: 4000, blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const t0 = Date.now()
  const { e } = await run(bot, target(bot, 1, 64, 0), { deadline: Date.now() + 800 })
  assert.ok(e, 'must not report success')
  assert.ok(Date.now() - t0 < 1300, `ran ${Date.now() - t0} ms past an 800 ms deadline`)
  assert.ok(bot.seen.halted >= 1, 'the approach walk was never cancelled')
})

await ta('WALK BEFORE THE DIG, ABORT: an abort mid-approach rejects at once', async () => {
  const bot = world({ feet: [-6.5, 64, 0.5], walkMs: 4000, blocks: { [K(1, 64, 0)]: 'oak_log' } })
  const ac = new AbortController()
  let abortedAt = 0
  setTimeout(() => { abortedAt = Date.now(); ac.abort() }, 400)
  const { e } = await run(bot, target(bot, 1, 64, 0), { signal: ac.signal })
  assert.ok(e?.aborted, `did not reject as aborted: ${e?.message}`)
  assert.ok(Date.now() - abortedAt < 300, `took ${Date.now() - abortedAt} ms after the abort`)
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
  const high = {}
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1]]) high[K(x, 72, z)] = 'oak_log'
  const bot = world({ blocks: high })
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
