// WORKBOARD-01 (codeeval 2026-11-06 phase 3 item 1, OWNER 11-08 "do all your recommendations now"): THE TOWN WORK BOARD, PHASE A.
// Design: docs/reports/workboard-design-2026-11-08.md (Claude + Codex independent designs, reconciled).
//
// MEASURED (fleet 1e593b9b, 80 bots, 24 h to 11-08 20:00Z, 1,920.0 bot-h, telemetry.py/busytime.py full walks): decision time
// 54.3% (1,042 bot-h); the idle_work rung holds 50.4% of all time. Its GROUNDS lap (gkforever-01) took 395.8 of 765 idle-batch
// bot-h on 11-08 00:00-20:30Z, and 2,613 of 2,911 grounds batches (354 bot-h, 89%) ended with ZERO visits that changed the ground:
// 82% opened within 48 blocks of the town, yet only 30% held ANY build visit -- the model ran explore/goto/place/home/gather/bucket
// 25,077 times inside them against 1,568 build_shop orders. The workshop order is the chain's last town slot, needs atTown at that
// tick, and waits a per-bot cooldown; the model, given "stay at town", wanders off first.
//
// THE BOARD (phase A: build and tidy jobs only, on a grounds lap only). Jobs are COMPUTED ON READ from what already exists -- the
// project records, their slot leases and every back-off shopActive applies (stuck, unsited, buildnext, starve, the keeper/crew
// order) -- so there is one rule and no second picker: the town's job for this bot is shopActive's pick, when that pick is
// WORKABLE (boardJob). A bot on a grounds lap gets it as an ORDER, never as advice:
//   away from town (<= WB.travelMax, |dy| <= WB.dyMax)   claim one of the project's admission slots (the visit's own slot lease,
//                                                       buildproj.mjs takeSlot: a traveller holds it, so others do not herd), then
//                                                       `home` -- the walk is the skill's, inside the runner's one slot
//   at town                                             `build_shop`, pinned to the job's project (skills.mjs boardPin), without
//                                                       the shop's per-bot cooldown: the board paces it per job instead
// and the LLM is asked only when no job fits (boardStep `yield`). Every refusal the order can meet ends in a per-(bot, job) back-off
// with a deadline (boardAfter), so the bot never loops on an order that cannot run; the gate's memory is asked BEFORE an order is
// issued (`refuses`), so the board never spends a veto.
// WORKBOARD=off is the rollback (the chain exactly as before); WORKBOARD=shadow computes and logs, issues nothing.
// SHOWCASE (workboard-01show): the showcase has no idle_work rung; its lap is the PATROL rung (51.8% of showcase bot time, 24 h to
// 11-08 20:00Z, 334.1 bot-h, 14 bots; 50.0% of its decision time), so the population there is a bot on `patrol` (cognitive.mjs).

/** The switch: 'on' (the variant's default), 'shadow', 'off'. */
export function workboardMode (env = process.env) {
  const v = String(env?.WORKBOARD ?? 'on').trim().toLowerCase()
  if (['off', '0', 'false', 'no'].includes(v)) return 'off'
  if (v === 'shadow') return 'shadow'
  return 'on'
}

export const WB = Object.freeze({
  travelMax: 128,              // horizontal blocks from the town: a farther bot is not recruited (RimWorld's lesson: distance first)
  dyMax: 24,                   // |feet y - town y|: an underground bot is not sent home by the board (the return rungs own that)
  townR: 48,                   // composter.mjs TOWN_RADIUS: the radius every town order uses for "at town"
  claimTtlMs: 5 * 60_000,      // a traveller's slot claim: `home`'s maxMs (240 s) plus a minute
  emptyMs: [2 * 60_000, 10 * 60_000, 30 * 60_000],   // after 1, 2, 3+ visits in a row on a job that changed nothing
  declineMs: 2 * 60_000,       // the runner declined, or the gate refused the order
  travelFailMs: 30 * 60_000,   // a walk home that did not arrive: no more board walks for this bot for this long
  healthMin: 10,               // shop.mjs SHOP_HEALTH_MIN
  roomHeavy: 8,                // shop.mjs SHOP_BAG_SLOTS_MIN
  roomLight: 2,                // shop.mjs MONUMENT_BAG_SLOTS_MIN (LIGHT_PLOTS)
  rowEveryMs: 10 * 60_000,     // a yield/shadow row per reason at most this often per bot
  chainMs: 10 * 60_000,        // showcase: a worked visit lifts the workshop step's cooldown for this long
})

/** Phase A never dispatches these plots (the stair digs and has its own start rule; Codex design r0). */
export const BOARD_SKIP_PLOTS = Object.freeze(new Set(['shaft']))

/**
 * IS THIS PROJECT STATE A JOB FOR THIS BOT NOW? -> null (workable) | why. Pure. `st` is one of shopActive's marked states
 * ({ plot, exists, complete, damaged, due, free, stuck, unsited, nextHeld, starved }).
 */
export function jobBlocked (st) {
  if (!st || !st.plot) return 'no_state'
  if (BOARD_SKIP_PLOTS.has(st.plot)) return 'skip_plot'
  if (st.exists && st.complete && !st.damaged && !st.due) return 'complete'
  if (st.waiting === true && !st.exists) return 'waiting'   // showcase: an unsited project waiting on its opening rule
  if (st.planner && st.waiting !== false) return 'waiting'
  if (st.idle === true) return 'idle'                        // showcase sinkfix-01: this bot's own no-effect visit there (IDLE_MS)
  if (st.stuck) return 'stuck'
  if (st.unsited) return 'unsited'
  if (st.nextHeld) return `held_${st.nextHeld}`
  if (st.free === false) return 'full'
  return null
}

/** shopActive's pick and the marked states -> the job { plot, workable, why, starved, cands }. Pure. `cands` = workable states. */
export function boardJob (pick, states = []) {
  const cands = (states ?? []).filter(s => jobBlocked(s) == null).length
  if (!pick?.plot) return { plot: null, workable: false, why: 'no_pick', starved: false, cands }
  const st = (states ?? []).find(s => s?.plot === pick.plot) ?? { plot: pick.plot, exists: false, complete: false, damaged: false }
  const why = jobBlocked(st)
  return { plot: pick.plot, workable: why == null, why: why ?? 'ok', starved: !!st.starved, cands }
}

/**
 * MAY THIS BOT TAKE A BOARD JOB NOW? -> { ok, why, travel }. Pure. The bot's own fitness, read before anything is claimed so a
 * bot that could not do the visit never walks to it (MineColonies' lesson: feasibility at the claim, not at the arrival).
 *   lap        a grounds batch of the idle_work rung is open (idlework.mjs groundsBatchOpen)
 *   holds      a milestone step holds the turn (smeltjob.mjs milestoneHolds)
 *   dist, dy   horizontal blocks and feet-y difference from the town home
 *   light      the job's plot is one of shop.mjs LIGHT_PLOTS (2 free slots, not 8)
 *   travelHeldUntil  this bot's travel back-off
 */
export function boardEligible ({ lap = false, holds = false, health = 20, freeSlots = 36, light = false, dist = Infinity, dy = 0,
  travelHeldUntil = 0, now = 0, W = WB } = {}) {
  if (!lap) return { ok: false, why: 'not_grounds_lap', travel: false }
  if (holds) return { ok: false, why: 'milestone_holds', travel: false }
  if (!(health > W.healthMin)) return { ok: false, why: 'health', travel: false }
  if (freeSlots < (light ? W.roomLight : W.roomHeavy)) return { ok: false, why: 'room', travel: false }
  if (!Number.isFinite(dist)) return { ok: false, why: 'no_position', travel: false }
  if (Math.abs(Number(dy) || 0) > W.dyMax) return { ok: false, why: 'depth', travel: false }
  if (dist <= W.townR) return { ok: true, why: 'at_town', travel: false }
  if (dist > W.travelMax) return { ok: false, why: 'too_far', travel: false }
  if (Number.isFinite(travelHeldUntil) && now < travelHeldUntil) return { ok: false, why: 'travel_backoff', travel: false }
  return { ok: true, why: 'travel', travel: true }
}

/** This bot's back-off on `plot` -> until ms | null. Pure. */
export function boardHeld (mem, plot, now = 0) {
  const u = mem?.jobs?.[plot]?.until
  return Number.isFinite(u) && now < u ? u : null
}

/**
 * THE BOARD'S STEP -> { order, owns, why }. Pure. `owns`: the board answers for this tick's workshop slot (the chain's own
 * workshop step stands down, so the shop's per-bot cooldown and the board's per-job pacing never both decide). An `order` is
 * { skill, args: {}, why, board: { plot, travel } }; the caller claims the slot for a travel order and pins the project.
 *   mode       workboardMode()
 *   elig       boardEligible(...)
 *   job        boardJob(...), or null (skills.mjs boardJobNow: the board cannot read the town)
 *   refuses    (skill, args) -> 'cooldown' | 'learned_avoid' | 'repeat_loop' | null (AdmissionControl.memoryRefuses)
 */
export function boardStep ({ mode = 'off', elig = null, job = null, mem = null, now = 0, refuses = () => null, travelOnly = false } = {}) {
  if (mode === 'off') return { order: null, owns: false, why: 'off' }
  // SHOWCASE (travelOnly): at town the chain's own workshop step issues the order -- its buildOrder carries the showcase's asks
  // (enchant, copper run, market, expedition, the room remedies) -- and the board only lifts its cooldown after a visit that worked
  // (cognitive.mjs boardChainAt); the board itself orders only the walk to town
  if (travelOnly && elig?.ok && !elig.travel) return { order: null, owns: false, why: 'at_town:chain' }
  if (!job) return { order: null, owns: false, why: 'no_board' }   // the board cannot read the town: the chain as before
  if (!elig?.ok) return { order: null, owns: false, why: elig?.why ?? 'ineligible' }
  // a pick phase A never dispatches (the stair) is the chain's as before: owning it would starve the stair's own order (Claude code
  // review r1 BLOCKER: the town stair is the active pick for every bot while it is open)
  if (job?.why === 'skip_plot') return { order: null, owns: false, why: 'no_job:skip_plot' }
  if (!job?.workable) return { order: null, owns: true, why: `no_job:${job?.why ?? '-'}` }
  // this bot's back-off on the job: the chain's own workshop step decides (its cooldown and gates, exactly as before) -- never
  // worse than the base, and never an order on the same back-off clock twice (Claude code review r1 note 2)
  if (boardHeld(mem, job.plot, now) != null) return { order: null, owns: false, why: 'job_backoff' }
  const skill = elig.travel ? 'home' : 'build_shop'
  let r = null
  try { r = refuses(skill, {}) } catch { r = 'read_failed' }
  if (r) return { order: null, owns: true, why: `refused:${r}` }
  if (mode === 'shadow') return { order: null, owns: false, why: `shadow:${skill}` }
  const why = elig.travel ? `town work board: walk to town for the ${job.plot} job` : `town work board: the ${job.plot} job`
  return { order: { skill, args: {}, why, board: { plot: job.plot, travel: !!elig.travel } }, owns: true, why: `issue:${skill}` }
}

/** SHOWCASE: may the workshop step skip its cooldown now? -> bool. Pure. On, on the board's lap, and the bot's last build_shop visit
 *  worked within WB.chainMs (an empty one sends the order back to its cooldown: exactly the base). */
export const boardChains = ({ mode = 'off', lap = false, chainAt = 0, now = 0, W = WB } = {}) =>
  mode === 'on' && !!lap && Number.isFinite(chainAt) && chainAt > 0 && now - chainAt >= 0 && now - chainAt < W.chainMs
/** Did a visit change anything? Pure (skills.mjs buildNextAfter's rule: a success, or anything placed). */
export const visitWorked = r => !!r && (r.status === 'success' || (Number(r.placed) || 0) > 0)

/**
 * AFTER A BOARD ORDER -> { mem, backoffMs, worked }. Pure; never mutates `mem`. Every outcome that did not work ends in a back-off
 * with a deadline on THAT job for THIS bot, so the next tick yields to the next job or the model instead of re-issuing:
 *   refused / declined         WB.declineMs on the job (a travel order: on the walk)
 *   a walk that did not arrive WB.travelFailMs on every board walk (`travelUntil`)
 *   a visit that worked        clears the job's streak: the next visit may follow at once (no shop cooldown)
 *   a visit that did not       WB.emptyMs[n-1] for the n-th in a row
 */
export function boardAfter (mem, { plot = null, travel = false, refused = false, declined = false, arrived = false, r = null, now = 0, W = WB } = {}) {
  const m = { jobs: { ...(mem?.jobs ?? {}) }, travelUntil: Number(mem?.travelUntil) || 0 }
  if (!plot) return { mem: m, backoffMs: 0, worked: false }
  if (refused || declined) {
    if (travel) m.travelUntil = now + W.declineMs
    else m.jobs[plot] = { n: Number(m.jobs[plot]?.n) || 0, until: now + W.declineMs }
    return { mem: m, backoffMs: W.declineMs, worked: false }
  }
  if (travel) {
    if (!arrived) { m.travelUntil = now + W.travelFailMs; return { mem: m, backoffMs: W.travelFailMs, worked: false } }
    return { mem: m, backoffMs: 0, worked: false }
  }
  if (visitWorked(r)) { delete m.jobs[plot]; return { mem: m, backoffMs: 0, worked: true } }
  const n = (Number(m.jobs[plot]?.n) || 0) + 1
  const ms = W.emptyMs[Math.min(n, W.emptyMs.length) - 1]
  m.jobs[plot] = { n, until: now + ms }
  return { mem: m, backoffMs: ms, worked: false }
}

/** A `workboard` row's detail (fixed key order; detail strings only, no new ES fields). Pure. */
const FIELDS = ['op', 'mode', 'skill', 'plot', 'why', 'dist', 'cands', 'starved', 'status', 'stop', 'placed', 'worked', 'backoff_s', 'slot', 'gen']
export function boardDetail (f = {}) {
  return FIELDS.filter(k => f[k] != null && f[k] !== '').map(k => `${k}=${String(f[k]).replace(/\s+/g, '_').slice(0, 60)}`).join(' ')
}

/** Rate limit for the yield/shadow rows -> { emit, last }. Pure. */
export function rowDue (last = {}, key, now = 0, every = WB.rowEveryMs) {
  const t = Number(last?.[key])
  if (Number.isFinite(t) && now - t < every) return { emit: false, last }
  return { emit: true, last: { ...last, [key]: now } }
}
