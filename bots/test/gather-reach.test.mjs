// WHY DOES A GATHERING BOT ARRIVE OUT OF REACH?
//
// Measured on the fleet, 3h window, sha a7571cc + 62e169e, full walk of
// /var/log/mcai/*/skill-*.jsonl: 673 of 4,640 gather runs (14.5%) across 75 of
// the 80 bots carried at least one `arrived_out_of_reach`, 1,269 messages in
// all. Against ONE `dig_unconfirmed` in the same scan -- the same query, same
// window, so the zero is a reading and not a blind spot. Once the bot is in
// reach the dig lands. It is purely an arrival problem.
//
// THE CANDIDATE EXPLANATIONS, AND WHICH ONES SURVIVE.
//
// (c) "it arrived inside GoalNear's radius 2, which is still outside the 5.1
// reach" is the one that sounds most likely and it is ARITHMETICALLY
// IMPOSSIBLE. Exhaustively below: the worst node GoalNear(p,2) will accept puts
// the eye 3.15 from the block centre, against a limit of 5.1. The fleet agrees
// -- the smallest distance in 1,269 refusals was 3.1, and the largest node
// GoalNear(p,2) accepts reports 2.55 by the same measure the log prints. So
// every one of those refusals is a bot that did not arrive at all.
//
// What is left is that GoalNear(p,2) is the wrong request. It is STRICTER than
// the test it is checked against, and for a block in a wall, in a ceiling, or
// up a tree its acceptance set is EMPTY -- while the block is diggable from
// dozens of nodes the bot can walk to. An empty acceptance set is the most
// expensive query A* can be given: it has to drain the whole walkable world to
// say no. That is measured here, against the real Movements and the real AStar.
//
// These are behaviour tests over the library's own classes, not greps. The one
// thing a grep could never establish is the number that decides this: how many
// nodes each goal costs when it cannot be satisfied.
import assert from 'node:assert'
import test from 'node:test'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
import {
  mkWorld, mkBot, fleetMovements, reachable, inReach, neighbourGoal, goals,
} from './helpers/reachlab.mjs'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const require_ = createRequire(import.meta.url)
const AStar = require_('mineflayer-pathfinder/lib/astar')
const { eyeToBlock, nodeToBlock, withinDigReach, reachGoal, reachRefusal,
        SERVER_REACH, STANCE_REACH } = await import('../src/digreach.mjs')

// A short think budget so the suite is not held for 5s per unsatisfiable goal.
// The POINT of those cases is the node count, which is already six orders of
// magnitude apart at 1.2s.
const THINK_MS = 1200

const GROUND = 63
const scene = {
  'block at foot level': {
    w: (x, y, z) => (x === 6 && z === 0 && y === 64) ? 'oak_log' : (y <= GROUND ? 'stone' : 'air'),
    p: new Vec3(6, 64, 0), start: new Vec3(0, 64, 0),
  },
  'block one up': {
    w: (x, y, z) => (x === 6 && z === 0 && (y === 64 || y === 65)) ? 'oak_log' : (y <= GROUND ? 'stone' : 'air'),
    p: new Vec3(6, 65, 0), start: new Vec3(0, 64, 0),
  },
  'block one down': {
    w: (x, y, z) => y <= GROUND ? 'stone' : 'air',
    p: new Vec3(6, 63, 0), start: new Vec3(0, 64, 0),
  },
  'block in a wall': {
    w: (x, y, z) => (x >= 6 && y <= 68) ? 'stone' : (y <= GROUND ? 'stone' : 'air'),
    p: new Vec3(6, 66, 0), start: new Vec3(0, 64, 0),
  },
  'block in a ceiling': {
    w: (x, y, z) => (y === 67 && x >= 3 && x <= 9 && z >= -3 && z <= 3) ? 'stone' : (y <= GROUND ? 'stone' : 'air'),
    p: new Vec3(6, 67, 0), start: new Vec3(0, 64, 0),
  },
  'ore in a cave floor': {
    w: (x, y, z) => {
      if (x === 6 && z === 0 && y === 54) return 'iron_ore'
      if ((y === 55 || y === 56) && z >= -1 && z <= 1 && x >= -2 && x <= 8) return 'air'
      return y <= GROUND ? 'stone' : 'air'
    },
    p: new Vec3(6, 54, 0), start: new Vec3(0, 55, 0),
  },
  // oak_log is 43.4% of the fleet's arrived_out_of_reach runs and this is what
  // it looks like: findBlocks returns a trunk section in the canopy, which has
  // an exposed face and is therefore a legal candidate.
  'oak log five up a trunk': {
    w: (x, y, z) => (x === 6 && z === 0 && y >= 64 && y <= 70) ? 'oak_log' : (y <= GROUND ? 'stone' : 'air'),
    p: new Vec3(6, 69, 0), start: new Vec3(0, 64, 0),
  },
}

/** One real A* search, resumed to completion or to its own budget. */
function search (world, m, start, goal) {
  const s = Object.assign(new Vec3(start.x, start.y, start.z),
    { remainingBlocks: 0, hash: `${start.x},${start.y},${start.z}` })
  const a = new AStar(s, m, goal, THINK_MS, 40, -1)
  let r = a.compute()
  for (let i = 0; r.status === 'partial' && i < 500; i++) r = a.compute()
  const end = r.path?.length ? r.path[r.path.length - 1] : s
  return { status: r.status, visited: r.visitedNodes, end }
}

function bench (s, mkGoal) {
  const world = mkWorld(s.w)
  const bot = mkBot(world, s.start)
  const m = fleetMovements(bot)
  const goal = mkGoal(world, s.p)
  if (!goal) return { status: 'unbuildable', visited: 0, arrives: false, stances: 0 }
  const r = search(world, m, s.start, goal)
  const nodes = reachable(m, s.start, 1500)
  return {
    ...r,
    arrives: r.status === 'success' && inReach(r.end, s.p),
    stances: nodes.filter(n => { try { return goal.isEnd(n) } catch { return false } }).length,
    diggableFrom: nodes.filter(n => inReach(n, s.p)).length,
  }
}

const NEAR2 = (_w, p) => new goals.GoalNear(p.x, p.y, p.z, 2)
const LOOKAT = (w, p) => new goals.GoalLookAtBlock(p, w)
const GETTO = (_w, p) => new goals.GoalGetToBlock(p.x, p.y, p.z)
const REACH = (_w, p) => reachGoal(goals, p)

// -------------------------------------------------------- the arithmetic ---

test('eyeToBlock is mineflayer canDigBlock arithmetic, recomputed independently', () => {
  // digging.js:224 -- block.position.offset(.5,.5,.5).distanceTo(pos.offset(0,1.65,0))
  for (const [bx, by, bz, px, py, pz] of [
    [0, 64, 0, 0.5, 64, 0.5], [3, 70, -2, 0.1, 64.9, 1.2], [-8, 12, 40, -8.5, 11.3, 41.7],
  ]) {
    const want = Math.hypot(bx + 0.5 - px, by + 0.5 - (py + 1.65), bz + 0.5 - pz)
    assert.ok(Math.abs(eyeToBlock({ x: px, y: py, z: pz }, { x: bx, y: by, z: bz }) - want) < 1e-9)
  }
  assert.equal(withinDigReach({ x: 0.5, y: 64, z: 0.5 }, { x: 0, y: 64, z: 0 }), true)
  assert.equal(withinDigReach({ x: 0.5, y: 64, z: 0.5 }, { x: 9, y: 64, z: 0 }), false)
})

test('(c) is impossible: no node GoalNear(p,2) accepts is ever out of dig reach', () => {
  const p = new Vec3(0, 64, 0)
  const g = new goals.GoalNear(p.x, p.y, p.z, 2)
  let accepted = 0, worstEye = 0, worstReported = 0, over = 0
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dz = -4; dz <= 4; dz++) {
        const n = new Vec3(p.x + dx, p.y + dy, p.z + dz)
        if (!g.isEnd(n)) continue
        accepted++
        const eye = nodeToBlock(n, p)
        worstEye = Math.max(worstEye, eye)
        // the quantity the old log line printed: feet to the block's corner
        worstReported = Math.max(worstReported,
          new Vec3(n.x + 0.5, n.y, n.z + 0.5).distanceTo(p))
        if (eye > SERVER_REACH) over++
      }
    }
  }
  assert.ok(accepted > 30, `positive control: the sweep found stances at all (${accepted})`)
  assert.equal(over, 0, 'GoalNear(p,2) cannot accept an out-of-reach node')
  assert.ok(worstEye < 3.2, `worst eye-to-centre is ${worstEye.toFixed(2)}, limit ${SERVER_REACH}`)
  // The fleet's smallest observed refusal distance was 3.1 by this measure,
  // which is already past what an arrival could produce.
  assert.ok(worstReported < 2.6,
    `worst reported distance from an accepted node is ${worstReported.toFixed(2)}; ` +
    'the fleet never reported below 3.1, so none of them had arrived')
})

test('POSITIVE CONTROL: the same sweep DOES find violations for a wider radius', () => {
  // A sweep that can only ever answer "no violations" is not evidence. Radius 6
  // genuinely admits nodes past 5.1, and the sweep sees them.
  const p = new Vec3(0, 64, 0)
  const g = new goals.GoalNear(p.x, p.y, p.z, 6)
  let over = 0
  for (let dx = -7; dx <= 7; dx++) {
    for (let dy = -7; dy <= 7; dy++) {
      for (let dz = -7; dz <= 7; dz++) {
        const n = new Vec3(p.x + dx, p.y + dy, p.z + dz)
        if (g.isEnd(n) && nodeToBlock(n, p) > SERVER_REACH) over++
      }
    }
  }
  assert.ok(over > 0, 'the sweep must be able to see a violation, or it proves nothing')
})

test('the proposed goal never accepts a stance the server would refuse', () => {
  const p = new Vec3(0, 64, 0)
  const g = reachGoal(goals, p)
  assert.ok(g, 'positive control: the goal builds against the real library')
  let accepted = 0
  for (let dx = -8; dx <= 8; dx++) {
    for (let dy = -8; dy <= 8; dy++) {
      for (let dz = -8; dz <= 8; dz++) {
        const n = new Vec3(p.x + dx, p.y + dy, p.z + dz)
        if (!g.isEnd(n)) continue
        accepted++
        assert.ok(nodeToBlock(n, p) <= STANCE_REACH)
        assert.ok(nodeToBlock(n, p) <= SERVER_REACH, 'and therefore inside canDigBlock')
      }
    }
  }
  assert.ok(accepted > 100, `and it is far wider than GoalNear(p,2): ${accepted} stances`)
  // Strictly a superset of the goal it replaces, so nothing that works today
  // can stop working.
  const near = new goals.GoalNear(p.x, p.y, p.z, 2)
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -3; dz <= 3; dz++) {
        const n = new Vec3(p.x + dx, p.y + dy, p.z + dz)
        if (near.isEnd(n)) assert.ok(g.isEnd(n), `${dx},${dy},${dz} regressed`)
      }
    }
  }
})

test('the heuristic stays admissible after the reach is subtracted', () => {
  const p = new Vec3(0, 64, 0)
  const g = reachGoal(goals, p)
  const base = new goals.GoalGetToBlock(p.x, p.y, p.z)
  for (let dx = -12; dx <= 12; dx += 3) {
    for (let dy = -12; dy <= 12; dy += 3) {
      const n = new Vec3(dx, 64 + dy, 0)
      assert.ok(g.heuristic(n) <= base.heuristic(n), 'never larger than the library estimate')
      assert.ok(g.heuristic(n) >= 0, 'and never negative, which would break the heap ordering')
    }
  }
  assert.equal(g.heuristic(new Vec3(0, 64, 0)), 0, 'zero when already there')
})

// ------------------------------------------------------ the planner cost ---

test('GoalNear(p,2) is UNSATISFIABLE for a wall, a ceiling and a canopy log', () => {
  for (const name of ['block in a wall', 'block in a ceiling', 'oak log five up a trunk']) {
    const r = bench(scene[name], NEAR2)
    assert.equal(r.status, 'timeout', `${name}: A* could not even fail cheaply`)
    assert.equal(r.stances, 0, `${name}: no reachable node satisfies GoalNear(p,2)`)
    assert.ok(r.visited > 20_000,
      `${name}: it drained ${r.visited} nodes proving that, at 5s of thinkTimeout on the fleet`)
    assert.ok(r.diggableFrom > 10,
      `${name}: and the block was diggable from ${r.diggableFrom} nodes the bot could walk to`)
  }
})

test('the reach goal reaches all seven scenes, cheaply', () => {
  for (const [name, s] of Object.entries(scene)) {
    const r = bench(s, REACH)
    assert.equal(r.status, 'success', `${name}: ${r.status}`)
    assert.ok(r.arrives, `${name}: and the node it stops on passes canDigBlock`)
    assert.ok(r.visited < 500, `${name}: in ${r.visited} nodes`)
  }
})

test('GoalLookAtBlock fixes the wall and NOT the ceiling or the canopy', () => {
  // This matters because it is the goal the reach probe already uses, so it is
  // the obvious thing to switch the walk to. It is a real improvement on the
  // wall. It is not a fix: its reach test is `node.distanceTo(pos + 1.6) <= 4.5`
  // measured corner to corner, which refuses a bot standing directly under a
  // block three above it -- 4.6 by that measure, 1.85 by canDigBlock's.
  assert.equal(bench(scene['block in a wall'], LOOKAT).status, 'success')
  for (const name of ['block in a ceiling', 'oak log five up a trunk']) {
    const r = bench(scene[name], LOOKAT)
    assert.equal(r.status, 'timeout', `${name}: still unsatisfiable`)
    assert.ok(r.diggableFrom > 10, `${name}: while ${r.diggableFrom} legal stances exist`)
  }
})

test('GoalGetToBlock and an explicit standable-neighbour composite fail the same cases', () => {
  // Both encode ADJACENCY, and a block in a wall or a canopy has no standable
  // neighbour at all -- so the composite cannot even be built.
  assert.equal(bench(scene['block in a wall'], GETTO).status, 'timeout')
  assert.equal(bench(scene['oak log five up a trunk'], GETTO).status, 'timeout')
  assert.equal(bench(scene['block in a wall'], neighbourGoal).status, 'unbuildable')
  assert.equal(bench(scene['oak log five up a trunk'], neighbourGoal).status, 'unbuildable')
  // ...and they are fine on the easy scenes, which is the control: the harness
  // is not simply reporting failure for everything.
  assert.equal(bench(scene['block at foot level'], GETTO).status, 'success')
  assert.equal(bench(scene['ore in a cave floor'], GETTO).status, 'success')
})

test('the canopy log was already in reach: the walk was never needed', () => {
  // The bot standing at the foot of the trunk can dig a log five blocks up --
  // eye at feet+1.65, centre at feet+5.5, 3.85 against 5.1. Every second spent
  // planning a route to it was spent on a question already answered.
  const s = scene['oak log five up a trunk']
  assert.equal(withinDigReach({ x: 5.5, y: 64, z: 0.5 }, s.p), true)
  assert.equal(withinDigReach({ x: 0.5, y: 64, z: 0.5 }, s.p), false, 'but not from the start')
})

// ----------------------------------------------------- the refusal itself ---

test('reachRefusal separates the three things canDigBlock actually tests', () => {
  const target = { x: 10, y: 64, z: 5 }
  const gone = reachRefusal({ blockName: 'air', wanted: 'oak_log', target, dist: 2.1, pathSaid: 'resolved' })
  assert.equal(gone.failClass, 'target_changed')
  assert.match(gone.detail, /is air now, not oak_log/)

  const hard = reachRefusal({ blockName: 'bedrock', wanted: 'bedrock', target, dist: 2.1, pathSaid: 'resolved' })
  assert.equal(hard.failClass, 'target_undiggable')

  const far = reachRefusal({ blockName: 'oak_log', wanted: 'oak_log', target, dist: 14.2, pathSaid: 'NoPath' })
  assert.equal(far.failClass, 'arrived_out_of_reach')
  assert.match(far.detail, /14\.2/)
  // THE PATHFINDER'S OWN WORD, QUOTED. The message this replaces asserted "goto
  // returned without moving" unconditionally -- a claim about the pathfinder
  // that the code never asked the pathfinder about, and the reason reading 673
  // of these took five telemetry passes.
  assert.match(far.detail, /pathfinder said: NoPath/)

  const quiet = reachRefusal({ blockName: 'oak_log', wanted: 'oak_log', target, dist: 14.2, pathSaid: 'resolved' })
  assert.match(quiet.detail, /pathfinder said: resolved/,
    'a clean resolve after an empty path is the library\'s success-shaped no-path')
})

test('an unloaded chunk is not reported as out of reach', () => {
  // bot.blockAt returns null past the loaded edge. Calling that "still 40 blocks
  // away" is a claim about geometry derived from a missing chunk.
  const r = reachRefusal({ blockName: null, wanted: 'iron_ore', target: { x: 1, y: 2, z: 3 }, dist: 3, pathSaid: 'resolved' })
  assert.equal(r.failClass, 'target_changed')
  assert.match(r.detail, /nothing \(unloaded\)/)
})
