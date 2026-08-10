// WHEN A* RUNS OUT OF TIME, WHICH HALF-FINISHED ROUTE DO YOU KEEP?
//
// Baritone's A* is not smarter than mineflayer-pathfinder's. The heuristics are
// near-identical in design and both admissible: Baritone's costHeuristic is
// 3.563 against a SPRINT_ONE_BLOCK_COST of 3.564; pathfinder's is
// `distanceXZ + |dy|` against a minimum move cost of 1. The entire difference is
// what each does when the search does NOT finish -- which is our failure mode,
// not an edge case. `path_timeout` is one of our largest fail classes and A*
// routinely blows its 5s budget underground.
//
// mineflayer-pathfinder keeps one candidate (lib/astar.js):
//
//     if (neighborNode.h < this.bestNode.h) this.bestNode = neighborNode
//
// That is pure greedy-best-h: the node that ends up nearest the goal in a
// straight line, with no regard for what it cost to get there. It happily
// returns a route that burrowed twenty blocks into a hillside to shave two
// blocks off the straight-line distance, and then the bot walks into it.
//
// Baritone keeps SEVEN candidates (AbstractNodeCostSearch.COEFFICIENTS =
// {1.5, 2, 2.5, 3, 4, 5, 10}), each minimising `h + g/coefficient`, and on
// timeout returns the one from the LOWEST coefficient that actually travels at
// least MIN_DIST_PATH = 5 blocks from the start. Low coefficient means g is
// weighted heavily, which means "don't pay much to get closer" -- the
// conservative choice. Above coefficient 3 its own source calls the results
// "pretty terrible". Ours is the coefficient-of-infinity case: the degenerate
// member of that family, the one Baritone warns about.
//
// HOW THIS IS ATTACHED, and what it costs.
//
// The library exports the AStar class from lib/astar.js, and Node caches
// modules, so patching the prototype changes the searches the bots actually
// walk -- not just the ones we start ourselves through getPathTo. No file
// patching, no patch-package, no postinstall step to forget on a new host.
//
// TWO HONEST LIMITATIONS, both deliberate:
//
//  1. The family is built from nodes the library offers us, and it only offers
//     a node when `neighborNode.h < this.bestNode.h`. So we score the
//     h-improving frontier rather than every generated node as Baritone does.
//     That still discriminates the pathology -- among nodes that got closer, it
//     prefers the ones that did not pay much g to do it -- but it is a subset,
//     and a fuller version would mean copying compute() and owning a divergent
//     fork of the search loop.
//
//  2. We substitute only on `timeout` and `noPath`, never on `partial` or
//     `success`. `partial` is returned every tick during ordinary operation and
//     the library resumes the SAME search next tick; swapping the path there
//     would fight the incremental search and oscillate. Baritone's bestSoFar
//     applies where its search has ended, and so does ours.
import { createRequire } from 'node:module'
import { log } from './logger.mjs'

const require_ = createRequire(import.meta.url)

// Baritone's values. Its source points at a Google Doc for the derivation and
// the link is dead, so treat these as a starting point to tune rather than as
// received wisdom -- which is also why the chosen coefficient is logged.
const COEFFICIENTS = [1.5, 2, 2.5, 3, 4, 5, 10]

// A candidate that has not travelled this far has not established anything, and
// returning it just means walking a couple of blocks and re-planning. Baritone
// calls this MIN_DIST_PATH.
const MIN_DIST_PATH = 5

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** Which coefficient produced each returned path, so the effect is measurable. */
export const backoffStats = { substituted: 0, kept: 0, byCoefficient: {} }

export function installPathBackoff() {
  let AStar
  try {
    AStar = require_('mineflayer-pathfinder/lib/astar')
  } catch (e) {
    log('warn', 'path backoff not installed', { err: e.message })
    return false
  }
  if (AStar.prototype.__backoffInstalled) return true

  // Collect the family. The library assigns `this.bestNode` in two places -- the
  // constructor's start node, and the h-improving update in compute() -- and
  // both go through this setter.
  Object.defineProperty(AStar.prototype, 'bestNode', {
    configurable: true,
    get() { return this.__best },
    set(node) {
      this.__best = node
      if (!this.__family) {
        // The constructor assigns the start node before compute() runs, so the
        // first node through this setter IS the origin. The class does not
        // retain `start` anywhere else -- checked, it stores `startTime` and
        // nothing else -- so without capturing it here the distance test below
        // would never fire and this whole file would be a no-op.
        this.__startNode = node
        this.__family = COEFFICIENTS.map(() => node)
        return
      }
      for (let i = 0; i < COEFFICIENTS.length; i++) {
        const score = n => n.h + n.g / COEFFICIENTS[i]
        if (score(node) < score(this.__family[i])) this.__family[i] = node
      }
    },
  })

  const original = AStar.prototype.makeResult
  AStar.prototype.makeResult = function (status, node) {
    // 'success' is a real route to the goal; 'partial' is an unfinished search
    // the library is about to resume. Neither is ours to second-guess.
    if (status !== 'timeout' && status !== 'noPath') return original.call(this, status, node)

    const family = this.__family
    const origin = this.__startNode?.data
    if (!family || !origin) { backoffStats.kept++; return original.call(this, status, node) }

    for (let i = 0; i < COEFFICIENTS.length; i++) {
      const cand = family[i]
      if (!cand || cand === node) continue
      if (dist(cand.data, origin) < MIN_DIST_PATH) continue
      backoffStats.substituted++
      const key = String(COEFFICIENTS[i])
      backoffStats.byCoefficient[key] = (backoffStats.byCoefficient[key] ?? 0) + 1
      return original.call(this, status, cand)
    }
    // Nobody in the family got anywhere. That is a genuinely stuck start, and
    // it is the case our `stranded` class exists to name -- so hand back what
    // the library chose and let the caller draw that conclusion.
    backoffStats.kept++
    return original.call(this, status, node)
  }

  AStar.prototype.__backoffInstalled = true
  return true
}
