// THE MOVEMENT OWNER, pure parts -- step 1 of docs/movement-owner-design.md v3 (plan: docs/movement-owner-step1-plan.md
// v2). One object owns ASSESS and ESCAPE for the entombed and marooned classes and the livelock ladder; the existing
// reflex arms become detectors and their bodies become rungs the owner runs ONE AT A TIME under an EPISODE. Nothing in
// this file touches the bot: it decides. The runtime (owner-runtime, the next commit) drives it under the arbiter.
//
// Why an episode: every trap this month was two correct guards meeting where the bot had no legal move, and every
// "fix" re-picked the same failing rung forever (escapePlan is stateless; a refused pillar was scored as a failed
// escape). An episode remembers what was tried, spends one deadline and one block budget, latches the UNCHANGED
// failed strategy (never the machine), and closes only on the class's own predicate plus the shared postcondition.
import { escapedFrom } from './recovery.mjs'

export const STATES = Object.freeze(['WORK', 'ASSESS', 'ESCAPE', 'RETURN', 'SAFE_HOLD'])
export const CLASSES = Object.freeze(['entombed', 'marooned', 'ladder'])
export const EPISODE_DEADLINE_MS = 180_000
export const EPISODES_PER_CLASS_PER_HOUR = 3        // per (class, strategy) latch on episodes that ended in a HOLD, never on openings; a NEW class always opens (Codex, plan v2 §6)
export const BLOCK_BUDGET_EXTRA = 2                   // the entombment climb's need + 2 (design §Budgets)
export const BLOCK_REFUSAL_RETRIES = 2                // how often a rung may claim needs_blocks against a live gate that says otherwise, before it latches
export const BUDGET_OVERRUN = 2                       // the episode's spend cap: twice one climb's worth, against the LIVE need. The budget frozen at assess was never enforced anywhere (owner-01b review, 18 Sep): blocksSpent was accumulated and compared to nothing.
export const LADDER_BLOCK_RESERVE = 4                 // the livelock dig leg's floor (cognitive.mjs reserve)
const RUNGS = Object.freeze({
  entombed: ['pillar', 'stair', 'underfoot'],            // reflex.mjs: measured pillar-out, then the stair ramp, then harvest underfoot
  marooned: ['adjacent', 'pillar', 'stair', 'underfoot'],
  ladder: ['walk', 'dig'],                               // cognitive.mjs #escape: relocation walk, then the dig leg
})
export const OUTCOMES = Object.freeze(['ran', 'refused', 'failed', 'preempted', 'exhausted'])

/** The rungs a class may run, in order. */
export function rungsFor (cls) { return RUNGS[cls] ? [...RUNGS[cls]] : [] }

/** Open an episode. `climbNeed` sizes the block budget; `blocks` is what the bot holds now. */
export function newEpisode ({ cls, at, now = Date.now(), blocks = 0, climbNeed = 0, deadlineMs = EPISODE_DEADLINE_MS, id = null } = {}) {
  if (!RUNGS[cls]) throw new Error(`unknown recovery class ${cls}`)
  return Object.freeze({
    id: id ?? `${cls}:${Math.round(at?.x ?? 0)},${Math.round(at?.y ?? 0)},${Math.round(at?.z ?? 0)}:${now}`,
    cls, at: at ? { x: at.x, y: at.y, z: at.z } : null, startedAt: now, deadline: now + deadlineMs,
    blockBudget: Math.max(0, (climbNeed | 0) + BLOCK_BUDGET_EXTRA), blocksAtStart: blocks | 0, blocksSpent: 0,
    tried: Object.freeze([]), hazards: Object.freeze([]), state: 'ASSESS',
  })
}

/** A transition record: the only place policy strings are made; every row logs one. */
export function transition (from, to, { reason, budget = null, postcondition = null } = {}) {
  if (!STATES.includes(from) || !STATES.includes(to)) throw new Error(`bad transition ${from} -> ${to}`)
  return Object.freeze({ from, to, reason: String(reason ?? ''), budget, postcondition })
}

/**
 * The next rung to run, or null. Skips a rung whose last outcome was refused/failed/exhausted; a PREEMPTED rung stays
 * eligible (design v3 §2). Refuses `pillar` and `dig` without the blocks they need. Null past the deadline. Pure.
 */
export function nextRung (episode, obs = {}, now = Date.now()) {
  if (!episode) return null
  if (now >= episode.deadline) return null
  // STAND DOWN FOR THE AIR REFLEX -- and ONLY for it. Owner directive: water is terrain and the only water reflex is
  // getting air. `isEntombed` reads "walled in" for a SUBMERGED bot too, so the owner opened escape episodes on
  // swimming bots and contended for the body at PRIORITY.escape against the air reflex, which outranks it. Measured
  // on owner-01b, 18 Sep: 15 of 240 rung rows were `refused why=body held by air`, and hive-a-Bravo spent
  // 16:31:28-16:32:51 in a refuse/preempt cycle one block from a recorded drowning site before drowning there.
  //
  // THE TEST IS OWNERSHIP, NOT WETNESS. The first version of this gate keyed on `isInWater`, and the second reviewer
  // found the trap that creates: a bot walled in with ONE BLOCK of water at its feet, head in air, full oxygen and a
  // pocket full of blocks is not an air emergency -- `assessAir` declines it -- so gating on wetness left that bot
  // with no rung and no reflex, which is this project's oldest bug class (two correct guards, no legal move).
  // Wetness is not a handoff acknowledgement. Stand down when the air reflex HOLDS the body, or when the head is
  // where only the air reflex can help; a wet-footed bot with a breathing head still climbs out.
  if (obs.airOwns || obs.headUnderwater) return null
  const blocks = obs.blocks | 0
  // The LIVE climb need, re-measured by the caller each assess; falls back to the frozen budget only when absent.
  const need = obs.climbNeed == null ? Math.max(0, episode.blockBudget - BLOCK_BUDGET_EXTRA) : obs.climbNeed | 0
  const skipped = []; if (obs.skipped) obs.skipped.length = 0
  const last = {}
  for (const t of episode.tried) last[t.rung] = t
  // WANT OF BLOCKS IS A GATE, NOT AN ATTEMPT. It is re-evaluated here from LIVE facts every pass -- `obs.climbNeed` is
  // re-measured by the caller at each assess -- so it must never latch: a rung the bot cannot afford this second may
  // be affordable the next, and a rung recorded `refused` is skipped for the rest of the episode.
  //
  // Measured on owner-01b, 18 Sep: 71 episodes opened, 9 closed, 55 held. reflex judged the LIVE need against the
  // budget FROZEN at assess (`episode budget 8 < 16`) on a bot carrying 108 placeable blocks, recorded a `refused`,
  // and the episode could then only hold. The budget is a SPEND CAP, never an affordability test.
  const spendCap = Math.max(episode.blockBudget, need + BLOCK_BUDGET_EXTRA) * BUDGET_OVERRUN
  const affordable = blocks >= need + BLOCK_BUDGET_EXTRA && episode.blocksSpent < spendCap
  // BOUNDED. A rung that reports `needs_blocks` while the live gate says the bot can afford it disagrees with the
  // inventory, and an unbounded re-admission would spin on that disagreement for the whole deadline. Two retries,
  // then it latches like any other refusal.
  const blockRefusals = r => episode.tried.filter(t => t.rung === r && t.outcome === 'refused' && /^needs_blocks/.test(t.why ?? '')).length
  const notLatched = (t, r) => t.outcome === 'refused' && /^needs_blocks/.test(t.why ?? '') && blockRefusals(r) <= BLOCK_REFUSAL_RETRIES
  for (const rung of rungsFor(episode.cls)) {
    const t = last[rung]; const o = t?.outcome
    // A rung that ran out of blocks mid-climb is re-gated live below, not latched; every other refusal is final.
    if (t && notLatched(t, rung)) { /* the gate decides, not this record */ }
    else if (o === 'refused' || o === 'failed' || o === 'exhausted') continue
    if (rung === 'pillar' && !affordable) { skipped.push({ rung, why: episode.blocksSpent >= spendCap ? `over_budget (spent ${episode.blocksSpent} >= ${spendCap})` : `needs_blocks (holds ${blocks} < ${need + BLOCK_BUDGET_EXTRA})` }); continue }
    if (rung === 'dig' && blocks < LADDER_BLOCK_RESERVE) continue
    if (obs.skipped) obs.skipped.push(...skipped)
    return { rung, reason: o === 'preempted' ? `retry ${rung} after preemption` : o === 'refused' ? `retry ${rung}: affordable again (holds ${blocks}, needs ${need + BLOCK_BUDGET_EXTRA})` : `first ${rung} for ${episode.cls}`,
             budget: { deadlineMs: Math.max(0, episode.deadline - now), blocks: Math.max(0, episode.blockBudget - episode.blocksSpent) } }
  }
  if (obs.skipped) obs.skipped.push(...skipped)
  return null
}

/** Record a rung's outcome. Immutable: returns the next episode. */
export function recordRung (episode, { rung, outcome, why = null, blocksSpent = 0, ms = 0, hazard = null } = {}) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`bad outcome ${outcome}`)
  return Object.freeze({ ...episode,
    tried: Object.freeze([...episode.tried, Object.freeze({ rung, outcome, why: why == null ? null : String(why).slice(0, 80), blocksSpent: blocksSpent | 0, ms: ms | 0 })]),
    blocksSpent: episode.blocksSpent + (blocksSpent | 0),
    hazards: hazard ? Object.freeze([...episode.hazards, hazard]) : episode.hazards,
    state: 'ESCAPE' })
}

/**
 * Is the episode CLOSED? The shared relocation postcondition AND the class's own predicate (design v3 §5/§3):
 * entombed needs !entombed and supported feet; marooned needs a startable path; the ladder needs relocation alone.
 * A failed rung never closes an episode; only a successful exit is judged here (v3 §2).
 */
export function closeEpisode (episode, before, after, pred = {}) {
  if (!episode) return { closed: false, why: 'no episode' }
  const moved = escapedFrom(before, after)
  switch (episode.cls) {
    case 'entombed':
      if (pred.entombed) return { closed: false, why: 'still entombed' }
      if (!pred.supported) return { closed: false, why: 'feet unsupported' }
      return moved ? { closed: true, why: 'relocated, not entombed, supported' } : { closed: false, why: 'not relocated' }
    case 'marooned':
      if (!pred.canStartPath) return { closed: false, why: 'no path can start' }
      return moved ? { closed: true, why: 'relocated and a path can start' } : { closed: false, why: 'not relocated' }
    case 'ladder':
      return moved ? { closed: true, why: 'relocated' } : { closed: false, why: 'not relocated' }
    default: return { closed: false, why: `unknown class ${episode.cls}` }
  }
}

/** Why the machine holds still: past the deadline, every rung spent, or nothing runnable now. */
export function holdReason (episode, obs = {}, now = Date.now()) {
  if (!episode) return 'no_episode'
  if (now >= episode.deadline) return 'deadline'
  if (obs.airOwns || obs.headUnderwater) return 'air'   // named, so the read separates a stand-down from an exhausted ladder
  const spent = rungsFor(episode.cls).every(r => ['refused', 'failed', 'exhausted'].includes(episode.tried.filter(t => t.rung === r).map(t => t.outcome).pop()))
  if (spent) return 'exhausted'
  return nextRung(episode, obs, now) ? 'runnable' : 'no_rung'
}

/** SAFE-HOLD exits on EVIDENCE, not only displacement (design v2 §3). */
export function safeHoldExit (hold, evidence = {}) {
  if (!hold) return { exit: false, why: 'not holding' }
  const kinds = ['displaced', 'inventoryChanged', 'blockChangedNearby', 'pathStartable', 'newRequest']
  const hit = kinds.filter(k => evidence[k] === true)
  return hit.length ? { exit: true, why: hit.join('+') } : { exit: false, why: 'no new evidence' }
}

/**
 * Exhaustion latches the STRATEGY, never the machine: a (class, strategy) that failed unchanged within the hour is
 * not re-opened; a different class, or the same class after displacement, always opens. `history` is a list of
 * {cls, strategy, at(ms), pos}. Pure.
 */
export function mayOpen ({ cls, strategy, pos, now = Date.now(), history = [], cap = EPISODES_PER_CLASS_PER_HOUR, displacedBy = escapedFrom } = {}) {
  const recent = history.filter(h => h.cls === cls && h.strategy === strategy && now - h.at < 3_600_000)
  if (recent.length < cap) return { open: true, why: `${recent.length}/${cap} this hour` }
  const lastPos = recent[recent.length - 1].pos
  if (lastPos && pos && displacedBy(lastPos, { ...pos, wet: false })) return { open: true, why: 'displaced since the last attempt' }
  return { open: false, why: `${cls}/${strategy} latched: ${recent.length} unchanged attempts this hour` }
}
