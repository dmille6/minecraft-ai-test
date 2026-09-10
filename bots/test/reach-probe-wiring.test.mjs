// THE WIRING, which is where this file's bugs actually live.
//
// Three times now a change in this codebase read a property that did not exist,
// passed every unit test, and was caught only by a canary: `.liquid` off an
// undecorated block, `this.visitedNodes` off an A* context, and
// `bot.packetWitness?.posPackets` off a FUNCTION. So the probe is exercised
// against a fake bot that records exactly what it was handed.
import assert from 'node:assert'
import { probeReachable, PROBE_SLATE, PROBE_TIMEOUT_MS, PROBE_RADIUS, PROBE_PUMPS } from '../src/reachprobe.mjs'
import { reachGoalClass, STANCE_REACH } from '../src/digreach.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// Stand-ins with the same shape the real library exposes.
//
// THE PROBE'S GOAL IS NOW reachGoal, NOT GoalLookAtBlock. It was built to match
// mineflayer-collectblock's own CollectBlock.js line 30, and collectblock is off
// by default -- gather walks with `collectManually`, which asks for the server's
// own 5.1 reach test. Measured over 48 scenes read off the live fleet by RCON,
// same walking movements and same 600ms: GoalLookAtBlock hit 2/48 at visited
// p50=29, reachGoal hit 10/48 at visited p50=9. The probe was refusing
// candidates the walk could reach, and paying a raycast per node to do it.
//
// So the stand-in is GoalGetToBlock, which is what reachGoal extends. Only its
// heuristic is ours to fake; the isEnd under test is the real one from
// src/digreach.mjs, because the probe decides which candidate was hit by calling
// that predicate rather than paraphrasing it.
class GoalGetToBlock {
  constructor (x, y, z) { this.x = x; this.y = y; this.z = z }
  heuristic (node) { return Math.abs(node.x - this.x) + Math.abs(node.y - this.y) + Math.abs(node.z - this.z) }
  isEnd (node) { return Math.abs(node.x - this.x) + Math.abs(node.y - this.y) + Math.abs(node.z - this.z) === 1 }
}
class GoalCompositeAny { constructor (goals) { this.goals = goals } }
class GoalLookAtBlock { constructor (pos, world) { this.pos = pos; this.world = world } }
const goals = { GoalGetToBlock, GoalCompositeAny }
const ReachGoal = reachGoalClass(goals)
const P = (x, y, z) => ({ x, y, z })
// The probe builds Vec3s and A* hands back nodes; both need distanceTo/offset
// only inside the real goal, so plain objects with x/y/z suffice here.

function makeBot (result, { movements = { canDig: false, tag: 'travel' } } = {}) {
  const seen = {}
  return {
    seen,
    entity: { position: P(0, 64, 0) },
    world: { raycast: () => null },
    // The dig-enabled clone gather lends to collectblock MUST be present on the
    // fake, or "the probe used the travel movements" passes by accident: with no
    // collectBlock on the bot, picking the wrong one still falls back to the
    // right one. A test that cannot fail is not a test.
    collectBlock: { movements: { canDig: true, tag: 'collect' } },
    pathfinder: {
      movements,
      getPathFromTo (moves, from, goal, opts) {
        seen.moves = moves; seen.goal = goal; seen.opts = opts; seen.from = from
        seen.pumps = 0
        const seq = Array.isArray(result) ? result : [result]
        return { next: () => {
          const r = seq[Math.min(seen.pumps, seq.length - 1)]
          seen.pumps++
          return { value: { result: r } }
        } }
      },
    },
  }
}
const CANDS = [P(3, 64, 0), P(9, 64, 0), P(20, 64, 0)]

t('a hit names the candidate the GOAL accepts, not the nearest one', () => {
  const bot = makeBot({ status: 'success', visitedNodes: 71, path: [P(1, 64, 0), P(8, 64, 0)] })
  const r = probeReachable(bot, CANDS, { goals })
  assert.equal(r.status, 'success')
  assert.deepEqual([r.hit.x, r.hit.y, r.hit.z], [9, 64, 0], 'ends beside 9,64,0 and within reach')
  assert.equal(r.visitedNodes, 71)
})

t('THE CASE THE OLD GOAL REFUSED: straight overhead is a hit', () => {
  // GoalLookAtBlock measures node-corner to block-centre from pos+1.6 and wants
  // a raycast onto a visible face, so a bot standing directly under a block
  // three above it reads 4.6 -- refused -- while canDigBlock reads 1.85. That
  // shape is the canopy oak_log, which was 43.4% of these failures.
  const bot = makeBot({ status: 'success', visitedNodes: 3, path: [] })
  const r = probeReachable(bot, [P(0, 67, 0)], { goals })
  assert.ok(r.hit, 'a block three blocks overhead is mineable from right here')
  assert.deepEqual([r.hit.x, r.hit.y, r.hit.z], [0, 67, 0])
})

t('out of reach is not a hit even when the path ended there', () => {
  const bot = makeBot({ status: 'success', visitedNodes: 9, path: [P(0, 64, 0)] })
  const r = probeReachable(bot, [P(20, 64, 0)], { goals })
  assert.equal(r.hit, null, '20 blocks away is outside the 4.5 reach')
})

t('IT MAY NOT REFUSE: noPath returns a miss, never a veto', () => {
  const bot = makeBot({ status: 'noPath', visitedNodes: 4210, path: [] })
  const r = probeReachable(bot, CANDS, { goals })
  assert.equal(r.hit, null, 'no hit')
  assert.equal(r.status, 'noPath')
  assert.equal(r.verdict.reachable, false, 'the verdict is RECORDED...')
  // ...and the caller reorders on hit only, so a miss cannot remove a candidate.
  assert.ok('hit' in r, 'the caller keys off .hit, which is null here')
})

t('a timeout is undecided, not unreachable', () => {
  const bot = makeBot({ status: 'timeout', visitedNodes: 900, path: [] })
  const r = probeReachable(bot, CANDS, { goals })
  assert.equal(r.hit, null)
  assert.equal(r.verdict.reachable, null, 'timeout must never read as unreachable')
})

t('IT USES THE TRAVEL MOVEMENTS, not a dig-enabled clone', () => {
  // `gather stone` at y=68 once reached 3.3GB and OOMed four times because a
  // dig-enabled A* was turned loose on a solid volume. The probe must walk.
  const bot = makeBot({ status: 'noPath', path: [] })
  probeReachable(bot, CANDS, { goals })
  assert.equal(bot.seen.moves.tag, 'travel')
  assert.equal(bot.seen.moves.canDig, false, 'the probe must not be allowed to dig')
})

t('the search is BOUNDED on both axes', () => {
  const bot = makeBot({ status: 'noPath', path: [] })
  probeReachable(bot, CANDS, { goals })
  assert.equal(bot.seen.opts.timeout, PROBE_TIMEOUT_MS)
  assert.equal(bot.seen.opts.searchRadius, PROBE_RADIUS)
  assert.ok(PROBE_RADIUS > 0, 'searchRadius is -1 (unlimited) everywhere else in this repo')
  assert.ok(PROBE_TIMEOUT_MS < 5000, 'must be well under thinkTimeout')
})

t('the slate is capped, so the O(goals) heuristic stays cheap', () => {
  const many = Array.from({ length: 200 }, (_, i) => P(i + 1, 64, 0))
  const bot = makeBot({ status: 'noPath', path: [] })
  const r = probeReachable(bot, many, { goals })
  assert.equal(r.checked, PROBE_SLATE)
  assert.equal(bot.seen.goal.goals.length, PROBE_SLATE, 'the composite gets exactly the slate')
})

t('it builds the goal THE WALK uses, not one of our own', () => {
  // collectManually paths with reachGoal. Verifying any other predicate is
  // verifying a claim nothing downstream makes -- which is what the old
  // GoalLookAtBlock probe was doing after collectblock was switched off.
  const bot = makeBot({ status: 'noPath', path: [] })
  probeReachable(bot, CANDS, { goals })
  assert.ok(bot.seen.goal instanceof GoalCompositeAny)
  assert.ok(bot.seen.goal.goals.every(g => g instanceof ReachGoal),
    'the composite is not built from reachGoal')
  assert.ok(bot.seen.goal.goals.every(g => g.reach === STANCE_REACH))
  assert.ok(bot.seen.goal.goals.every(g => !(g instanceof GoalLookAtBlock)),
    'still building the raycasting goal')
})

// --- it must cost nothing when anything is missing ---------------------------

t('a throwing pathfinder costs nothing', () => {
  const bot = makeBot({ status: 'success', path: [] })
  bot.pathfinder.getPathFromTo = () => { throw new Error('boom') }
  assert.equal(probeReachable(bot, CANDS, { goals }), null, 'must fall through, not propagate')
})

t('missing library pieces fall through instead of crashing gather', () => {
  const res = { status: 'success', path: [P(8, 64, 0)] }
  assert.equal(probeReachable(makeBot(res), CANDS, { goals: {} }), null)
  assert.equal(probeReachable(makeBot(res), CANDS, { goals: { GoalGetToBlock } }), null,
    'a composite goal is required')
  assert.equal(probeReachable(makeBot(res), CANDS, { goals: { GoalCompositeAny } }), null,
    'the per-block goal is required')
  assert.equal(probeReachable({ entity: { position: P(0, 64, 0) } }, CANDS, { goals }), null)
  assert.equal(probeReachable(makeBot(res), [], { goals }), null)
  assert.equal(probeReachable(makeBot(res), null, { goals }), null)
})

t('a generator that yields nothing usable is a fall-through', () => {
  const bot = makeBot(undefined)
  assert.equal(probeReachable(bot, CANDS, { goals }), null)
})

// --- the two defects the FLEET found in the first 555 probes ---------------

t('ALREADY THERE: success with an empty path is the strongest hit, not a miss', () => {
  // `status=success visited=0 hit=none` was the most common outcome on the
  // fleet. A* accepts the START node, so the path is empty -- the bot is
  // standing beside a candidate and that was being thrown away.
  const bot = makeBot({ status: 'success', visitedNodes: 0, path: [] })
  const r = probeReachable(bot, [P(1, 64, 0), P(40, 64, 0)], { goals })
  assert.ok(r.hit, 'a bot at 0,64,0 is within reach of a block at 1,64,0')
  assert.deepEqual([r.hit.x, r.hit.y, r.hit.z], [1, 64, 0])
})

t('...but only when the bot really is within reach of one', () => {
  const bot = makeBot({ status: 'success', visitedNodes: 0, path: [] })
  const r = probeReachable(bot, [P(9, 64, 0), P(20, 64, 0)], { goals })
  assert.equal(r.hit, null, 'nothing within reach: an empty path proves nothing')
})

t('a PARTIAL search is resumed, not discarded', () => {
  // partial was 24.7% of the first 555 fleet probes while using 41ms of a
  // 1500ms budget. compute() resumes the same search on the next next().
  const bot = makeBot([
    { status: 'partial', visitedNodes: 40, path: [] },
    { status: 'partial', visitedNodes: 90, path: [] },
    { status: 'success', visitedNodes: 150, path: [P(8, 64, 0)] },
  ])
  const r = probeReachable(bot, CANDS, { goals })
  assert.equal(r.status, 'success', 'the resumed search finished')
  assert.deepEqual([r.hit.x, r.hit.y, r.hit.z], [9, 64, 0])
  assert.ok(bot.seen.pumps >= 3, `expected resumes, saw ${bot.seen.pumps}`)
})

t('the pump is BOUNDED, so a partial forever is not a hang', () => {
  const bot = makeBot({ status: 'partial', visitedNodes: 40, path: [] })
  const r = probeReachable(bot, CANDS, { goals })
  assert.equal(r.status, 'partial')
  assert.equal(r.verdict.reachable, null, 'still undecided, never a refusal')
  assert.ok(bot.seen.pumps <= PROBE_PUMPS + 1,
    `pumped ${bot.seen.pumps} times, cap is ${PROBE_PUMPS}`)
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
