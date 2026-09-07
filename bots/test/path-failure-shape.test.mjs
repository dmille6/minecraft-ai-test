// `no_path` IS FOUR DIFFERENT PROBLEMS RECORDED AS ONE WORD.
//
// Measured 2026-09-07 over 6.67h: no_path is 22.8% of gather runs at a median
// 19.6s each -- 13.3 bot-hours of the window, against 0.67 for the entire
// no_safe_target class. A 20:1 ratio of wasted fleet time, on the bucket we
// understand least.
//
// The four need different fixes, and the discriminator is how much of the
// search happened. astar.js returns 'noPath' only after the open heap DRAINS,
// so a noPath with one visited node is not "the goal is unreachable" -- it is
// "the bot had no legal move at all", which is a claim about the bot's own
// cell, not about the goal.
import assert from 'node:assert'
import test from 'node:test'
import { pathFailureShape } from '../src/pathbackoff.mjs'

test('a drained search that explored is a disconnected region', () => {
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: 4211 }), 'disconnected')
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: 2 }), 'disconnected')
})

test('one visited node means the bot could not move, not that the goal was far', () => {
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: 1 }), 'no_legal_move')
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: 0 }), 'no_legal_move')
})

test('the same, in liquid, is the WONTFIX case and must be named separately', () => {
  // mineflayer-pathfinder cannot plan ANY vertical move from a liquid node:
  // getMoveUp/Down/DropDown/ParkourForward each return early on a liquid check.
  // Issue #117 closed WONTFIX 2022-05-30, #137 open since 2021. A submerged bot
  // in a walled pocket is unpathable BY DESIGN, so it needs a surface-first
  // pre-step, not a better search. Folding it into no_legal_move would hide the
  // one failure with a known, maintainer-endorsed remedy.
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: 1, startLiquid: true }),
    'sealed_in_liquid')
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: 0, startLiquid: true }),
    'sealed_in_liquid')
})

test('being in liquid is only interesting when nothing else was reachable', () => {
  // A bot swimming across a lake with 4,000 visited nodes is not sealed in.
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: 4211, startLiquid: true }),
    'disconnected')
})

test('a timeout is a budget problem, never a reachability one', () => {
  assert.equal(pathFailureShape({ status: 'timeout', visitedNodes: 1 }), 'budget')
  assert.equal(pathFailureShape({ status: 'timeout', visitedNodes: 9999, startLiquid: true }),
    'budget', 'timeout wins over every other signal')
})

test('it does not classify the outcomes that are not failures', () => {
  assert.equal(pathFailureShape({ status: 'success', visitedNodes: 12 }), null)
  assert.equal(pathFailureShape({ status: 'partial', visitedNodes: 12 }), null)
  assert.equal(pathFailureShape({}), null)
  assert.equal(pathFailureShape(), null)
})

test('a missing count is UNKNOWN, never silently a category', () => {
  // The instrument must be able to say it does not know. Defaulting a missing
  // visitedNodes to 0 would file every un-instrumented failure as
  // "no_legal_move" -- a detector answering uniformly, which is this repo's
  // most expensive recurring bug.
  assert.equal(pathFailureShape({ status: 'noPath' }), 'unknown')
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: undefined }), 'unknown')
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: null }), 'unknown')
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: 'lots' }), 'unknown')
  assert.equal(pathFailureShape({ status: 'noPath', visitedNodes: NaN }), 'unknown')
})

test('POSITIVE CONTROL: every category is actually reachable', () => {
  // Four categories that no input can produce would be four dead branches, and
  // this file would be asserting the shape of nothing.
  const got = new Set([
    pathFailureShape({ status: 'noPath', visitedNodes: 900 }),
    pathFailureShape({ status: 'noPath', visitedNodes: 1 }),
    pathFailureShape({ status: 'noPath', visitedNodes: 1, startLiquid: true }),
    pathFailureShape({ status: 'timeout' }),
    pathFailureShape({ status: 'noPath' }),
  ])
  assert.deepEqual([...got].sort(),
    ['budget', 'disconnected', 'no_legal_move', 'sealed_in_liquid', 'unknown'])
})
