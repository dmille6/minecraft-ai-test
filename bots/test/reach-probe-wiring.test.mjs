// THE WIRING, which is where this file's bugs actually live.
//
// Three times now a change in this codebase read a property that did not exist,
// passed every unit test, and was caught only by a canary: `.liquid` off an
// undecorated block, `this.visitedNodes` off an A* context, and
// `bot.packetWitness?.posPackets` off a FUNCTION. So the probe is exercised
// against a fake bot that records exactly what it was handed.
import assert from 'node:assert'
import { probeReachable, PROBE_SLATE, PROBE_TIMEOUT_MS, PROBE_RADIUS } from '../src/reachprobe.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// Stand-ins with the same shape the real library exposes.
class GoalGetToBlock { constructor (x, y, z) { Object.assign(this, { x, y, z }) } }
class GoalCompositeAny { constructor (goals) { this.goals = goals } }
const goals = { GoalGetToBlock, GoalCompositeAny }
const P = (x, y, z) => ({ x, y, z })

function makeBot (result, { movements = { canDig: false, tag: 'travel' } } = {}) {
  const seen = {}
  return {
    seen,
    entity: { position: P(0, 64, 0) },
    // The dig-enabled clone gather lends to collectblock MUST be present on the
    // fake, or "the probe used the travel movements" passes by accident: with no
    // collectBlock on the bot, picking the wrong one still falls back to the
    // right one. A test that cannot fail is not a test.
    collectBlock: { movements: { canDig: true, tag: 'collect' } },
    pathfinder: {
      movements,
      getPathFromTo (moves, from, goal, opts) {
        seen.moves = moves; seen.goal = goal; seen.opts = opts; seen.from = from
        return { next: () => ({ value: { result } }) }
      },
    },
  }
}
const CANDS = [P(4, 64, 0), P(9, 64, 0), P(20, 64, 0)]

t('a hit names the candidate A* actually reached', () => {
  // path ends orthogonally adjacent to (9,64,0)
  const bot = makeBot({ status: 'success', visitedNodes: 71, path: [P(1, 64, 0), P(8, 64, 0)] })
  const r = probeReachable(bot, CANDS, { goals })
  assert.equal(r.status, 'success')
  assert.deepEqual([r.hit.x, r.hit.y, r.hit.z], [9, 64, 0])
  assert.equal(r.visitedNodes, 71)
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

t('it builds a composite of GoalGetToBlock, not GoalBlock', () => {
  // GoalGetToBlock.isEnd is orthogonal adjacency INCLUDING vertical, which is
  // the whole point: standing on top of a block is a legal mining stance and
  // the local test it replaces never considered it.
  const bot = makeBot({ status: 'noPath', path: [] })
  probeReachable(bot, CANDS, { goals })
  assert.ok(bot.seen.goal instanceof GoalCompositeAny)
  assert.ok(bot.seen.goal.goals.every(g => g instanceof GoalGetToBlock))
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
  assert.equal(probeReachable(makeBot(res), CANDS, { goals: { GoalGetToBlock } }), null)
  assert.equal(probeReachable({ entity: { position: P(0, 64, 0) } }, CANDS, { goals }), null)
  assert.equal(probeReachable(makeBot(res), [], { goals }), null)
  assert.equal(probeReachable(makeBot(res), null, { goals }), null)
})

t('a generator that yields nothing usable is a fall-through', () => {
  const bot = makeBot(undefined)
  assert.equal(probeReachable(bot, CANDS, { goals }), null)
})

t('success with an empty path does not claim a hit', () => {
  const bot = makeBot({ status: 'success', visitedNodes: 3, path: [] })
  const r = probeReachable(bot, CANDS, { goals })
  assert.equal(r.hit, null, 'no end node means no verified candidate')
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
