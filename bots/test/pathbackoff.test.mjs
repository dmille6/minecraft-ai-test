// WHEN A* RUNS OUT OF TIME, WHICH HALF-FINISHED ROUTE DO YOU KEEP?
//
// mineflayer-pathfinder keeps exactly one candidate (lib/astar.js):
//     if (neighborNode.h < this.bestNode.h) this.bestNode = neighborNode
// Pure greedy-best-h: whichever node ends up nearest the goal in a straight
// line, with no regard for what it cost to reach. Baritone keeps seven, each
// minimising h + g/coefficient over {1.5,2,2.5,3,4,5,10}, and returns the most
// conservative one that actually travelled >= 5 blocks. Ours is the
// coefficient-of-infinity case -- the degenerate member of that family.
//
// This patches a SHARED library prototype, so it governs every search the fleet
// runs. That is the point, and it is also why it is tested against the real
// class rather than a stand-in.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { installPathBackoff, backoffStats, pathFailureShape, flushPathShapes } from '../src/pathbackoff.mjs'

const require_ = createRequire(import.meta.url)
let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

assert.equal(installPathBackoff(), true, 'the patch must install')
const AStar = require_('mineflayer-pathfinder/lib/astar')

/** A node shaped like the library's PathNode, at a distance from the origin. */
const node = (x, g, h) => ({ data: { x, y: 0, z: 0, hash: `n${x}` }, g, h })

// makeResult reads startTime, closedDataSet.size and openHeap.size() for its
// bookkeeping fields. We are testing WHICH NODE it is handed, so those are
// stubbed rather than simulated.
function bare() {
  const a = Object.create(AStar.prototype)
  a.startTime = 0
  a.closedDataSet = new Set()
  a.openHeap = { size: () => 0 }
  return a
}

/** An AStar instance with a scripted family, without running a search. */
function withFamily(nodes) {
  const a = bare()
  a.bestNode = nodes[0]              // first assignment is the origin
  for (const n of nodes.slice(1)) a.bestNode = n
  return a
}

t('installing twice is harmless', () => {
  assert.equal(installPathBackoff(), true)
})

t('the origin is captured -- the class does not store `start`', () => {
  const a = withFamily([node(0, 0, 100)])
  assert.ok(a.__startNode, 'without this the distance test never fires and the file is a no-op')
  assert.equal(a.__startNode.data.x, 0)
})

t('success is never second-guessed', () => {
  const a = withFamily([node(0, 0, 100), node(50, 500, 1)])
  const r = a.makeResult('success', node(99, 10, 0))
  assert.equal(r.path.length >= 0, true)
  assert.equal(r.status, 'success')
})

t('partial is left alone, because the library resumes that same search', () => {
  const before = backoffStats.substituted
  const a = withFamily([node(0, 0, 100), node(50, 900, 1)])
  a.makeResult('partial', node(50, 900, 1))
  assert.equal(backoffStats.substituted, before,
    'substituting mid-search would fight the incremental search and oscillate')
})

t('on timeout the cheap candidate wins over the one that burrowed', () => {
  // x=40 got closer (h=1) but paid 900 to do it -- the hillside-burrow case.
  // x=20 is further out (h=30) and cost only 20.  h + g/1.5 favours x=20.
  const origin = node(0, 0, 100)
  const burrowed = node(40, 900, 1)
  const cheap = node(20, 20, 30)
  const a = bare()
  a.bestNode = origin
  a.bestNode = cheap
  a.bestNode = burrowed
  const r = a.makeResult('timeout', burrowed)
  // `cost` is the chosen node's g, which identifies it exactly. (`path` walks a
  // parent chain these synthetic nodes do not have, so it is empty by
  // construction and proves nothing.)
  assert.equal(r.cost, 20,
    `expected the conservative candidate (g=20), got g=${r.cost} — ` +
    `g=900 means the burrowing route was returned, which is the old behaviour`)
})

t('a candidate that went nowhere is not offered', () => {
  // Everything within MIN_DIST_PATH of the origin: nothing is established, so
  // the library's own choice stands and the caller can call it stranded.
  const before = backoffStats.kept
  const a = bare()
  a.bestNode = node(0, 0, 100)
  a.bestNode = node(2, 2, 98)
  a.makeResult('noPath', node(2, 2, 98))
  assert.equal(backoffStats.kept, before + 1,
    'returning a 2-block path just means walking 2 blocks and re-planning')
})

t('which coefficient won is recorded, since the values are unjustified upstream', () => {
  const a = bare()
  a.bestNode = node(0, 0, 100)
  a.bestNode = node(30, 30, 40)
  a.bestNode = node(60, 2000, 1)
  a.makeResult('timeout', node(60, 2000, 1))
  assert.ok(Object.keys(backoffStats.byCoefficient).length > 0,
    'a rising coefficient is a cheap per-bot measure of terrain difficulty')
})

// ---------------------------------------------------------------------------
// THE WIRING, NOT THE DECISION.
//
// pathFailureShape has its own behaviour tests and they all passed while the
// hook feeding it was reading two fields that do not exist: `this.visitedNodes`
// (makeResult COMPUTES that from closedDataSet.size at astar.js:60 -- it is
// never stored) and, in the sibling instrument, `.liquid` off an undecorated
// block. Both would have reported one category for 100% of traffic.
//
// A pure function tested with hand-built inputs cannot catch either. These
// drive the real patched prototype and assert the classification that comes out
// the other end.
t('the hook reads closedDataSet.size, not a field that does not exist', () => {
  const before = { ...backoffStats.shapes }
  const a = bare()
  a.closedDataSet = new Set(['only-the-start'])       // one visited node
  a.movements = { getBlock: () => ({ liquid: false }) }
  a.bestNode = node(0, 0, 100)
  a.makeResult('noPath', node(0, 0, 100))
  assert.equal((backoffStats.shapes.no_legal_move ?? 0), (before.no_legal_move ?? 0) + 1,
    'one visited node must classify as no_legal_move; `unknown` means the hook ' +
    'is reading a field the library does not have')
  assert.equal(backoffStats.shapes.unknown ?? 0, before.unknown ?? 0,
    'and nothing may land in unknown')
})

t('a submerged start is separated from a dry one on identical counts', () => {
  const before = { ...backoffStats.shapes }
  const a = bare()
  a.closedDataSet = new Set(['start'])
  a.movements = { getBlock: () => ({ liquid: true }) }
  a.bestNode = node(0, 0, 100)
  a.makeResult('noPath', node(0, 0, 100))
  assert.equal((backoffStats.shapes.sealed_in_liquid ?? 0), (before.sealed_in_liquid ?? 0) + 1,
    'the WONTFIX case must be distinguishable -- it is the one with a known remedy')
})

t('a search that explored is disconnected, not sealed', () => {
  const before = { ...backoffStats.shapes }
  const a = bare()
  a.closedDataSet = new Set(Array.from({ length: 900 }, (_, i) => `n${i}`))
  a.movements = { getBlock: () => ({ liquid: true }) }
  a.bestNode = node(0, 0, 100)
  a.makeResult('noPath', node(0, 0, 100))
  assert.equal((backoffStats.shapes.disconnected ?? 0), (before.disconnected ?? 0) + 1,
    'swimming across a lake with 900 nodes explored is not being sealed in')
})

t('the instrument never breaks the search it watches', () => {
  // An instrument that can wedge pathfinding is worse than no instrument, so
  // every input IT reads must be survivable: movements throwing, movements
  // absent, no getBlock, a node with no h.
  //
  // NOT closedDataSet: the library's own makeResult does `this.closedDataSet.size`
  // unconditionally at astar.js:60, so removing it breaks AStar itself and the
  // failure would be misattributed to this hook. Asserting that would have been
  // testing the library's precondition and calling it our bug.
  for (const [label, movements] of [
    ['getBlock throws', { getBlock: () => { throw new Error('boom') } }],
    ['no getBlock', {}],
    ['movements absent', undefined],
    ['getBlock returns junk', { getBlock: () => null }],
  ]) {
    const a = bare()
    a.closedDataSet = new Set(['s'])
    a.movements = movements
    a.bestNode = node(0, 0, 100)
    const r = a.makeResult('noPath', { data: { x: 0, y: 0, z: 0, hash: 'x' }, g: 0 })
    assert.ok(r && r.status === 'noPath', `a throwing instrument must not escape: ${label}`)
  }
})

t('the flush emits the tally and then resets, so counts are never double-reported', () => {
  flushPathShapes()                                    // drain whatever ran above
  assert.equal(flushPathShapes(), null, 'an empty flush emits nothing at all')
  const a = bare()
  a.closedDataSet = new Set(['s'])
  a.movements = { getBlock: () => ({ liquid: false }) }
  a.bestNode = node(0, 0, 100)
  a.makeResult('noPath', node(0, 0, 100))
  a.makeResult('timeout', node(0, 0, 100))
  const first = flushPathShapes()
  assert.ok(first, 'a flush after real failures must emit')
  assert.equal(first.no_legal_move, 1)
  assert.equal(first.budget, 1)
  assert.equal(flushPathShapes(), null,
    'the second flush must be empty -- a flush that does not reset reports the ' +
    'same failures every minute and inflates every proportion drawn from it')
})

t('POSITIVE CONTROL: the shapes tally is actually being written', () => {
  assert.ok(Object.keys(backoffStats.shapes).length >= 3,
    'if this is empty every assertion above passed vacuously')
  assert.ok((backoffStats.shapes.no_legal_move ?? 0) > 0 &&
            (backoffStats.shapes.sealed_in_liquid ?? 0) > 0,
    'at least two distinct categories must have been produced by the real hook')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
