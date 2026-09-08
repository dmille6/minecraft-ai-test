/**
 * IS ANY OF THESE BLOCKS ACTUALLY REACHABLE? ASK A*, DO NOT GUESS.
 *
 * `gather` ranked candidate blocks with a LOCAL test -- "does a standable cell
 * exist beside this block" -- and then handed the best guess to collectblock,
 * three times, at 40s each, before reporting "found but unreachable".
 *
 * Measured over 5h on 80 bots: that reported 1,625 of 5,799 gather attempts
 * (28.0%), across 77 of 80 bots. Among the 73 bots that were travelling freely
 * it was still 22.3% of their attempts, so it is not an artifact of the handful
 * of stuck bots -- it is what the healthy fleet spends its gathering on.
 *
 * A local test cannot answer a global question. This codebase already learned
 * that once: an earlier prompt line called blocks `usable` on local tests alone,
 * moved gather success 16.3% -> 16.0% while attempts rose 8%, and now carries
 * the literal label "reachability NOT checked". The candidate ranking had the
 * same defect and no label.
 *
 * mineflayer-pathfinder 2.4.5 ships `GoalCompositeAny`, which we use nowhere.
 * Its heuristic is the MINIMUM over its sub-goals and its isEnd is ANY of them,
 * so one A* search answers "get me to whichever of these I can actually reach".
 * The library's own tutorial names this exact case: a composite over every oak
 * log "would result in it pathing to the easiest oak log to get to".
 *
 * TWO SAFETY PROPERTIES, BOTH DELIBERATE.
 *
 * 1. The probe runs on WALKING movements (canDig=false). `gather stone` at y=68
 *    once took a bot from 130MB to 3.3GB in 200s and OOM-killed it four times,
 *    because collectblock's dig-enabled movements turn A* loose on a solid
 *    volume where nearly every neighbour is legal. A min-heuristic over
 *    scattered goals is LESS informed than a single-goal heuristic -- it stays
 *    admissible, so the answer is still correct, but the search fans out more.
 *    Combining "less informed" with "can dig anywhere" is how that OOM comes
 *    back. So the probe asks only whether the bot can WALK to a block's side;
 *    collectblock still does the digging of the target itself.
 *
 * 2. The slate is BOUNDED. The composite's heuristic is O(goals) at every node
 *    expansion, so an unbounded slate makes every node more expensive at the
 *    same time as the search widens.
 *
 * A refusal from this probe is worth more than a guess: it means A* exhausted
 * the walkable space without reaching any candidate, which is the honest form
 * of "found but unreachable" and arrives in one search instead of two minutes.
 */

/**
 * The candidates worth offering A*, nearest first and bounded.
 *
 * Pure: plain {x,y,z} in, plain array out, so the bound and the ordering can be
 * tested without a bot, a world, or a pathfinder.
 */
export function candidateSlate (positions, from, { limit = 12, maxDist = 64 } = {}) {
  if (!Array.isArray(positions) || !from) return []
  const fx = Number(from.x), fy = Number(from.y), fz = Number(from.z)
  if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) return []
  const seen = new Set()
  const out = []
  for (const p of positions) {
    if (!p) continue
    const x = Number(p.x), y = Number(p.y), z = Number(p.z)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    // Block coordinates are floor(), never round(). Getting this wrong put a
    // reported drop one block off twice in one day.
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z)
    const key = `${bx},${by},${bz}`
    if (seen.has(key)) continue
    const d = Math.hypot(bx - fx, by - fy, bz - fz)
    if (d > maxDist) continue
    seen.add(key)
    out.push({ x: bx, y: by, z: bz, dist: d })
  }
  out.sort((a, b) => a.dist - b.dist)
  return out.slice(0, Math.max(0, limit))
}

/**
 * Which slate entry did the path actually end next to?
 *
 * GoalGetToBlock's own isEnd is |dx| + |dy adjusted| + |dz| === 1, i.e. the bot
 * stands ORTHOGONALLY adjacent to the block, which includes from above and from
 * below. That is a wider and more correct notion of "can mine this from here"
 * than the four-cardinal, two-height test it replaces, and it is the library's
 * definition rather than ours.
 *
 * Pure, and separate from the search, because "the search succeeded" and "it
 * succeeded at the target I think it did" are two claims and the second one is
 * where an off-by-one hides.
 */
export function slateHitBy (endNode, slate) {
  if (!endNode || !Array.isArray(slate)) return null
  const ex = Math.floor(Number(endNode.x)), ey = Math.floor(Number(endNode.y)), ez = Math.floor(Number(endNode.z))
  if (!Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(ez)) return null
  for (const c of slate) {
    const dy = ey - c.y
    if (Math.abs(ex - c.x) + Math.abs(dy < 0 ? dy + 1 : dy) + Math.abs(ez - c.z) === 1) return c
  }
  return null
}

/**
 * Turn a probe outcome into the words the failure will carry.
 *
 * Separated out because the STRING is the observation the model reads, and this
 * project has already shipped a refusal whose prose disagreed with its own
 * failure class -- `classifyFailure` read the class out of the wording, so two
 * differently-caused failures became the same lesson.
 */
export function probeVerdict ({ status, checked = 0, nearest = null } = {}) {
  if (status === 'success') return { reachable: true, why: null }
  if (status === 'timeout' || status === 'partial') {
    return { reachable: null,
             why: `could not decide reachability for ${checked} candidate(s) in the search budget` }
  }
  if (status === 'noPath') {
    return { reachable: false,
             why: `none of the ${checked} nearest candidate(s) can be walked to` +
                  (nearest != null ? ` (closest was ${Math.round(nearest)} blocks away)` : '') }
  }
  return { reachable: null, why: null }
}

/** Bounds. Each is a refusal to repeat a specific incident, not a tuning knob. */
export const PROBE_SLATE = 12        // heuristic AND isEnd are O(goals) per node
export const PROBE_TIMEOUT_MS = 1500 // vs thinkTimeout 5000: this is a probe, not a plan
export const PROBE_RADIUS = 96        // searchRadius is -1 (unlimited) everywhere else in this
                                     // repo, which is how one gather reached 3.3GB and OOMed
                                     // four times
export const PROBE_PUMPS = 6         // bounded resumes of a `partial` search; see probeReachable

/**
 * Ask A* which candidate the bot can actually WALK to. Returns a hit or null.
 *
 * THIS FUNCTION MAY SELECT. IT MAY NOT REFUSE.
 *
 * The probe walks (canDig=false); collectblock digs (canDig=true). So a `noPath`
 * here does NOT mean the block is ungatherable -- it means it is not WALKABLE
 * to, and collectblock might still tunnel to it. Treating that as a refusal
 * would add a new over-broad guard, which is this project's most repeated
 * mistake: four separate traps were two individually-correct guards meeting
 * where the bot had no legal move. So the caller reorders on a hit and changes
 * nothing on a miss.
 *
 * The returned `verdict` is recorded for measurement only. It is the evidence
 * for whether a future version may refuse -- specifically, how often a probe
 * hit is still followed by a collect failure, which is the number that says the
 * precheck is measuring the wrong thing.
 */
export function probeReachable (bot, positions, { goals, slate: slateSize = PROBE_SLATE,
                                                  timeout = PROBE_TIMEOUT_MS,
                                                  radius = PROBE_RADIUS } = {}) {
  const at = bot?.entity?.position
  if (!at || !goals?.GoalCompositeAny || !goals?.GoalGetToBlock) return null
  if (typeof bot?.pathfinder?.getPathFromTo !== 'function') return null
  const slate = candidateSlate(positions, at, { limit: slateSize })
  if (!slate.length) return null

  const t0 = Date.now()
  let result
  try {
    const goal = new goals.GoalCompositeAny(
      slate.map(c => new goals.GoalGetToBlock(c.x, c.y, c.z)))
    // The TRAVEL movements, deliberately. See the note above.
    const moves = bot.pathfinder.movements
    const gen = bot.pathfinder.getPathFromTo(moves, at, goal,
      { timeout, searchRadius: radius, optimizePath: true })
    result = gen.next()?.value?.result
    // A `partial` IS NOT AN ANSWER, AND IT WAS 24.7% OF THE FIRST 555 PROBES.
    //
    // compute() returns `partial` when it exhausts its per-tick slice with work
    // still to do; the generator resumes the same search on the next next().
    // Taking only the first yield threw a quarter of all probes away while
    // spending 41ms of a 1500ms budget -- measured p90 on the fleet. So pump it,
    // bounded by BOTH the wall clock and a step count, because an unbounded
    // pump is just the unbounded search this file exists to avoid.
    for (let i = 0; i < PROBE_PUMPS && result?.status === 'partial'
                    && Date.now() - t0 < timeout; i++) {
      result = gen.next()?.value?.result ?? result
    }
  } catch {
    // A probe that throws must cost nothing. Falling through to the existing
    // ranking is always safe, because the probe only ever reorders.
    return null
  }
  if (!result) return null

  // AN EMPTY PATH ON SUCCESS MEANS "ALREADY THERE", NOT "NOWHERE".
  //
  // The first fleet read showed `status=success visited=0 hit=none` as the most
  // common outcome by far: A* accepts the START node, so the path is empty and
  // reading the last element gives null. That is a bot already standing beside
  // one of its candidates -- the strongest possible hit -- and it was being
  // discarded. Fall back to the bot's own position, floored, which is the node
  // A* actually accepted.
  const end = Array.isArray(result.path) && result.path.length
    ? result.path[result.path.length - 1]
    : { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) }
  const hit = result.status === 'success' ? slateHitBy(end, slate) : null
  return {
    hit,
    status: result.status,
    checked: slate.length,
    visitedNodes: typeof result.visitedNodes === 'number' ? result.visitedNodes : null,
    nearest: slate[0]?.dist ?? null,
    ms: Date.now() - t0,
    verdict: probeVerdict({ status: result.status, checked: slate.length, nearest: slate[0]?.dist }),
  }
}
