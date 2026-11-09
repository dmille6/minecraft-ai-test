// PIPELINED DECISIONS (pipeline-01; landscape survey 2026-11-09 idea #1: "plan while acting").
//
// MEASURED on the fleet, 24 h to 11-09 12:00Z, 80 bots, 1,920 bot-h, 165,906 model calls (docs/reports/pipeline-design-
// 2026-11-09.md; ~/pipeline-1109/pipegaps.py + piperuns.py on the canary host). The gap before a model call is the 15 s
// decision cooldown almost every time (84-100% of calls sit in the 15-20 s bin), and WHAT ENDED BEFORE IT decides whether
// the gap is pacing or plain waiting:
//   after a SUCCESSFUL run           215 bot-h = 11.2% of bot time (+ 27 bot-h of the call itself); 18% of those calls vetoed
//   after a veto (+ VETOSKIP)        229 bot-h = 11.9%   -- pacing: shorter waits here buy re-proposals (cooldown-20s, 09-11:
//                                                         three canaries, "+41% calls became vetoed re-proposals")
//   after a failed / unknown run     208 bot-h = 10.8%   -- pacing: the failed key's 45 s cooldown, re-proposal risk
//   the runner's failure pause       202 bot-h = 10.5%   -- a safety valve (3 failures in a row)
// Only the first is a wait-for-decision: the bot finished, nothing argues against deciding now. That is what this removes.
//
// Two rules, one switch (PIPELINE=off|shadow|on; unset = PIPELINE_DEFAULTS.mode, `on` on the canary variant -- a code
// version the manifest and the tripper can see, as cooldown15 was; PIPELINE=off is the one-env rollback; junk = off):
//   NO WAIT AFTER SUCCESS (on): after a run that ENDED `success`, lasted >= minRunMs, with no reflex interrupt and no reflex
//     trigger pending, the next tick comes after nextDelayMs (500 ms, the CONTINUE early tick's step) and does not wait out
//     the cooldown window: the work-order chain runs first exactly as today, and with no order the model is asked at once.
//     Bounded by maxPerMin no-wait decisions per rolling minute (a Mindcraft-style runaway guard). Every other outcome
//     keeps today's pacing.
//   PREFETCH (shadow + on): a MODEL-admitted run that is still going after prefetchAfterMs (3 s: 67% of failed model runs
//     end inside 2 s, the median success runs 16.8 s) starts the NEXT model call in the background, with the prompt of
//     that moment and the line "LAST ACTION: <skill> -> running now; plan the next action as if it succeeds". When the
//     skill ends the prefetch is used only if: the run succeeded and the rule above armed, no reflex interrupted it, the
//     tick is `idle`, no order took the turn, the task (milestone) is the one it was asked under, it is younger than
//     maxAgeMs, and the admission gate's DRY check (AdmissionControl.dryCheck: the same #check, nothing written) admits
//     it. Then the real check() admits it as the decision of this tick. Otherwise a fresh model call is made at once
//     (on) -- the gate only ever judges ONE proposal per decision.
//   SHADOW: prefetches run and are judged at the next model call exactly as above, but the fresh call is always made and
//     used; the row says whether the prefetch would have been used and whether it AGREES with the fresh pick (same
//     action key). Pacing is unchanged. The cost of shadow is the prefetch calls only.
//
// Reflexes stay outside the model and always win: a reflex interrupt (r.interruptedBy -> a ranked pending trigger) or any
// non-idle trigger voids the prefetch and the no-wait arm; the next decision goes to the model fresh, as today. The model
// never interrupts a running skill (2503.03505 lets its planner set the interrupt flag; here only deterministic reflexes do).
//
// The prefetch is NOT aborted when it is not needed: EndpointPool.markFail would count a caller's abort as an endpoint
// failure and cool the endpoint for every decision. It finishes and is dropped; its cost is counted on its `pipeline` row.

export const PIPELINE_DEFAULTS = Object.freeze({
  mode: 'on',
  prefetchAfterMs: 3000,
  maxAgeMs: 60_000,
  waitCapMs: 8000,          // at use, a prefetch still in flight is awaited at most this long, then a fresh call
  minP: 0.3,                // prefetch only skills whose runs alive at prefetchAfterMs succeed at least this often (this bot)
  alpha: 0.1,               // EWMA weight of one run in that estimate; prior 0.5
  minRunMs: 1000,           // a run shorter than this never arms the no-wait rule (an instant "success" must not spin)
  nextDelayMs: 500,
  maxPerMin: 4,
})

export const PIPELINE_MODES = Object.freeze(['off', 'shadow', 'on'])
export const PIPELINE_TALLY_MS = 10 * 60 * 1000

const off = v => v === '0' || v === 'false' || v === 'off'
const num = (v, d) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? n : d }

/** PIPELINE=off|shadow|on (anything else = off), plus the knobs. Read once from the environment. */
export function pipelineConfig (env = process.env) {
  const D = PIPELINE_DEFAULTS
  const m = String(env.PIPELINE ?? '').trim().toLowerCase()
  const mode = m === '' ? D.mode : PIPELINE_MODES.includes(m) ? m : 'off'
  return {
    // active = the arm is computed and rows written; prefetch can be switched off alone (PIPELINE_PREFETCH=0): then `on` is
    // the no-wait rule only (a fresh call at the end of a successful run), at no extra inference
    mode, on: mode === 'on', shadow: mode === 'shadow', active: mode !== 'off', prefetch: mode !== 'off' && !off(env.PIPELINE_PREFETCH),
    prefetchAfterMs: num(env.PIPELINE_PREFETCH_AFTER_MS, D.prefetchAfterMs),
    maxAgeMs: num(env.PIPELINE_MAX_AGE_MS, D.maxAgeMs),
    waitCapMs: num(env.PIPELINE_WAIT_CAP_MS, D.waitCapMs),
    minP: Math.min(1, num(env.PIPELINE_MIN_P, D.minP)),
    alpha: Math.min(1, num(env.PIPELINE_ALPHA, D.alpha)) || D.alpha,
    minRunMs: num(env.PIPELINE_MIN_RUN_MS, D.minRunMs),
    nextDelayMs: num(env.PIPELINE_NEXT_DELAY_MS, D.nextDelayMs),
    maxPerMin: num(env.PIPELINE_MAX_PER_MIN, D.maxPerMin),
  }
}

/** This bot's estimate that a run of `skill` still going at prefetchAfterMs ends in success (prior 0.5). */
export function skillP (stats, skill) {
  const s = stats?.[skill]
  return Number.isFinite(s) ? s : 0.5
}

/** One run alive at prefetchAfterMs ended: fold its outcome into the estimate. -> a new stats object. */
export function noteRunP (stats, skill, success, alpha = PIPELINE_DEFAULTS.alpha) {
  if (!skill) return stats ?? {}
  const p = skillP(stats, skill)
  return { ...(stats ?? {}), [skill]: p + alpha * ((success ? 1 : 0) - p) }
}

/** At a run's start: will a prefetch be armed for it? -> { go, why } */
export function prefetchAtStart ({ cfg, source, skill, stats, pending }) {
  if (!cfg?.prefetch) return { go: false, why: 'off' }
  if (source !== 'model') return { go: false, why: 'not_model' }   // after an order the next decision is an order half the time
  if (pending) return { go: false, why: 'in_flight' }
  if (skillP(stats, skill) < (cfg.minP ?? 0)) return { go: false, why: 'low_p' }
  return { go: true, why: 'armed' }
}

/** The line that stands in for LAST ACTION in a prefetch's prompt: the post-skill state is predicted, not observed. */
export function runningLine (skill, args) {
  let a = ''
  try { a = JSON.stringify(args ?? {}) } catch { a = '{}' }
  return `${skill} ${a} -> running now; plan the NEXT action as if it succeeds`.slice(0, 220)
}

/**
 * After a tick's run: does it arm the next decision (no wait; the prefetch may be used)? -> { arm, why }.
 * Only a run that RAN and ENDED `success`, long enough, with no reflex in it or waiting, and the runner not paused.
 */
export function armAfterRun ({ cfg, executed, declined, status, interruptedBy, pendingTrigger, paused, runMs }) {
  if (!cfg?.active) return { arm: false, why: 'off' }
  if (interruptedBy) return { arm: false, why: 'interrupted' }
  if (!executed || declined) return { arm: false, why: 'not_run' }
  if (pendingTrigger) return { arm: false, why: 'trigger_pending' }
  if (paused) return { arm: false, why: 'paused' }
  if (status !== 'success') return { arm: false, why: `run_${String(status ?? 'none').replace(/[^a-z_]/g, '') || 'none'}` }
  if (!(runMs >= (cfg.minRunMs ?? 0))) return { arm: false, why: 'short_run' }
  return { arm: true, why: 'success' }
}

/** The runaway guard: may one more decision skip the wait now? `recent` = timestamps of earlier no-wait decisions. */
export function noWaitAllowed ({ cfg, recent, now }) {
  if (!cfg?.on) return false
  const n = (recent ?? []).filter(t => now - t < 60_000).length
  return n < (cfg.maxPerMin ?? 0)
}

/**
 * At the model call: may the prefetch stand in for it? Everything but the gate. -> { use, why }.
 * `pf` = { armId, milestoneId, startedAt, done, res }, `arm` = { id, at } (or null).
 */
export function prefetchUsable ({ cfg, pf, arm, trigger, pendingTrigger, milestoneId, now }) {
  if (!cfg?.prefetch) return { use: false, why: 'off' }
  if (!pf) return { use: false, why: 'none' }
  if (!arm || arm.id !== pf.armId) return { use: false, why: 'not_armed' }
  if (trigger !== 'idle' || pendingTrigger) return { use: false, why: 'trigger' }
  if ((pf.milestoneId ?? null) !== (milestoneId ?? null)) return { use: false, why: 'task_changed' }
  if (!(now - pf.startedAt <= (cfg.maxAgeMs ?? 0))) return { use: false, why: 'too_old' }
  if (pf.done && !(pf.res?.schemaValid && pf.res?.proposal?.skill)) return { use: false, why: 'no_proposal' }
  return { use: true, why: pf.done ? 'ready' : 'in_flight' }
}

/** One `pipeline` row's detail: what the prefetch was, what became of it, and (shadow, fallbacks) the fresh pick. */
export function pipelineDetail ({ mode, use, why, pre, fresh, agree, ageMs, waitMs, latMs, savedMs, ptok, ctok }) {
  const f = v => (v == null ? '-' : String(v))
  return `mode=${mode} use=${use} why=${why} pre=${f(pre)} fresh=${f(fresh)} agree=${agree == null ? '-' : agree ? 1 : 0} ` +
         `age_ms=${f(ageMs)} wait_ms=${f(waitMs)} lat_ms=${f(latMs)} saved_ms=${f(savedMs)} ptok=${f(ptok)} ctok=${f(ctok)}`
}

/** One pipeline_tally row per bot per 10 min. */
export function tallyLine ({ secs, c }) {
  return `secs=${Math.round(secs)} ` + Object.entries(c ?? {}).sort().map(([k, v]) => `${k}=${v}`).join(' ')
}
