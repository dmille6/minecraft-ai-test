// FEWER LLM DECISIONS (serving D, owner 11-01: "fewer decisions, so any server carries the fleet").
//
// MEASURED on the decision stream (/var/log/mcai/<bot>/llm-<bot>.jsonl, 10.0.0.31, 2026-11-01 00:00-12:38Z, 80 bots,
// 1,018 bot-hours, 73,384 model calls = 96.1/min fleet, 1.20/min/bot):
//   - 43.2% of model calls are vetoed by the admission gate and 6.5% are refused by the runner's failure pause, so half
//     the calls produce nothing (0.22 and 0.07 items per call, against 1.68 for an admitted one).
//   - The runner pause (runner.mjs: three consecutive failures -> EVERY skill is refused for pauseRecoveryMs, 120 s) is a
//     state the loop already holds. 4,730 of the 4,755 model calls made inside a pause were `idle` ticks, and every one of
//     them was refused whatever the model said: the answer cannot matter.
//   - After a `repeat_loop` veto with the state unchanged (same milestone, same 8x4x8 cell, same coarse inventory), the
//     next call is vetoed again 88% of the time and repeats the very key 63% of the time (n = 11,130). While the key still
//     fills the gate's repeat window (memoryRefuses === 'repeat_loop') that repeat is a certain veto.
//   - Rejected: "continue the last successful action" -- the model repeats its previous successful key only 12.8% of the
//     time (923 / 7,226), far below its own self-agreement, so a continuation rule would overrule it, not predict it.
//
// Added at the coordinator's request (11-01 ~13:45Z, "continue instead of wait"): bot-time 07:30-12:30Z, 80 bots,
// 400 bot-h -- in a skill 27.8%; the decision cooldown (LLM_DECISION_COOLDOWN_MS=30000 in the fleet env) 67.0% (after an
// admitted decision 28.1%, after a veto 27.9%, after a work order 7.1%, after a runner-paused call 3.9%); LLM latency
// 4.0%; anything else 1.2%. The bots are not busy: two thirds of their time is the wait between decisions.
//
//   CONTINUE   (FEWERDEC_CONTINUE=0 turns it off): after a decision whose skill RAN AND SUCCEEDED, the cooldown is not
//              waited out idle. The loop ticks again after FEWERDEC_CONTINUE_DELAY_MS and fills the window with
//              deterministic work only: the work-order chain as today (town deposit, builds, smelting...), else a
//              CONTINUATION -- the same gather with the same args, when the model's last decision was a gather that
//              served the rung and gained items, the gate's memory would admit it, and it has been continued fewer than
//              FEWERDEC_CONTINUE_MAX times. With neither, the tick WAITS for the rest of the cooldown: the model is never
//              asked earlier than today (the window is the cooldown that started when the model's decision finished), so
//              decisions/min can only fall. At most FEWERDEC_EARLY_MAX early ticks per window, and only after a success:
//              a failing order falls back to the normal cooldown and cannot spin.
//              Measured agreement, honestly: after a successful gather the model picks the same skill+block 69.2% live
//              (2,886 / 4,169) and 47-50% on the 30 replay items where this fires (its self-agreement there is 87-93%).
//              So a continuation is NOT a prediction of the model, and it never replaces the model's decision: it spends
//              the 30 s the bot used to stand still, and the model chooses right after it, about when it chose before.
//
// Three rules, each with its own off switch. Neither starts a skill, neither touches the admission gate's state, and
// neither applies to a non-idle trigger (a reflex handoff, a death, startup always reaches the model).
//
//   PAUSEWAIT  (FEWERDEC_PAUSEWAIT=0 turns it off): an `idle` tick inside the runner's pause makes no model call; the
//              loop wakes when the pause ends (plus a small margin), instead of up to one cooldown later.
//   VETOSKIP   (FEWERDEC_VETOSKIP=0 turns it off): one `idle` tick right after a vetoed model call is skipped when the
//              state signature is unchanged, the veto is recent, its reason is in the set, and -- for repeat_loop --
//              the gate's memory still refuses the vetoed key. At most FEWERDEC_VETOSKIP_MAX consecutive skips, then the
//              model is asked again (the chain is never closed by the rule). The skipped tick re-arms after
//              FEWERDEC_VETOSKIP_DELAY_MS (default 10 s, half the decision cooldown) so the delay a skip costs the rare
//              would-be-admitted call stays small.

export const FEWERDEC_DEFAULTS = Object.freeze({
  cont: true,
  contSkills: Object.freeze(['gather']),
  contMax: 2,
  earlyMax: 3,
  contDelayMs: 500,
  pauseWait: true,
  pauseMarginMs: 250,
  vetoSkip: true,
  vetoReasons: Object.freeze(['repeat_loop']),
  vetoSkipMax: 1,
  vetoSkipDelayMs: 10_000,
  vetoTtlMs: 90_000,
})

export const PAUSE_WAKE_CAP_MS = 60_000

const off = v => v === '0' || v === 'false' || v === 'off'
const num = (v, d) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? n : d }

/** The switches, read once from the environment. Unset = the defaults above (both rules on). */
export function fewerDecConfig (env = process.env) {
  const reasons = env.FEWERDEC_VETOSKIP_REASONS
  return {
    pauseWait: !off(env.FEWERDEC_PAUSEWAIT),
    pauseMarginMs: num(env.FEWERDEC_PAUSE_MARGIN_MS, FEWERDEC_DEFAULTS.pauseMarginMs),
    vetoSkip: !off(env.FEWERDEC_VETOSKIP),
    vetoReasons: new Set(reasons ? reasons.split(',').map(s => s.trim()).filter(Boolean) : FEWERDEC_DEFAULTS.vetoReasons),
    vetoSkipMax: num(env.FEWERDEC_VETOSKIP_MAX, FEWERDEC_DEFAULTS.vetoSkipMax),
    vetoSkipDelayMs: num(env.FEWERDEC_VETOSKIP_DELAY_MS, FEWERDEC_DEFAULTS.vetoSkipDelayMs),
    vetoTtlMs: num(env.FEWERDEC_VETO_TTL_MS, FEWERDEC_DEFAULTS.vetoTtlMs),
    cont: !off(env.FEWERDEC_CONTINUE),
    contSkills: new Set(env.FEWERDEC_CONTINUE_SKILLS ? env.FEWERDEC_CONTINUE_SKILLS.split(',').map(x => x.trim()).filter(Boolean) : FEWERDEC_DEFAULTS.contSkills),
    contMax: num(env.FEWERDEC_CONTINUE_MAX, FEWERDEC_DEFAULTS.contMax),
    earlyMax: num(env.FEWERDEC_EARLY_MAX, FEWERDEC_DEFAULTS.earlyMax),
    contDelayMs: num(env.FEWERDEC_CONTINUE_DELAY_MS, FEWERDEC_DEFAULTS.contDelayMs),
  }
}

/**
 * PAUSEWAIT. How long the runner's failure pause still refuses every skill, in ms; 0 = no pause (or it has already run
 * out, in which case the next run() auto-resumes and a decision is worth making).
 */
export function pauseRemainingMs ({ paused, pausedAt, now, recoveryMs }) {
  if (!paused || !Number.isFinite(pausedAt) || !Number.isFinite(recoveryMs)) return 0
  return Math.max(0, pausedAt + recoveryMs - now)
}

/** Should this tick skip the model because of the pause? -> { skip, wakeInMs } */
export function pauseWaitDecision ({ cfg, trigger, paused, pausedAt, now, recoveryMs }) {
  if (!cfg?.pauseWait || trigger !== 'idle') return { skip: false, wakeInMs: 0 }
  const left = pauseRemainingMs({ paused, pausedAt, now, recoveryMs })
  // capped below the liveness watchdog's 120 s idle limit (Claude review note 3): a longer pause just skips once more
  return left > 0 ? { skip: true, wakeInMs: Math.min(PAUSE_WAKE_CAP_MS, left + (cfg.pauseMarginMs ?? 0)) } : { skip: false, wakeInMs: 0 }
}

const bucket = n => (n <= 0 ? 0 : n < 4 ? 1 : n < 16 ? 2 : n < 64 ? 3 : 4)

/**
 * THE STATE SIGNATURE the measurement used: the task, the 8x4x8 cell the bot stands in, and the inventory by item with
 * counts bucketed (0 / 1-3 / 4-15 / 16-63 / 64+). Two ticks with the same signature put the model in front of the same
 * decision; anything that moves the bot a cell, finishes a rung or changes a stack's order of magnitude breaks it.
 */
export function decisionSig ({ milestoneId, pos, items }) {
  const cell = pos ? `${Math.floor(pos.x / 8)},${Math.floor(pos.y / 4)},${Math.floor(pos.z / 8)}` : '?'
  const inv = {}
  for (const it of items ?? []) if (it?.name) inv[it.name] = (inv[it.name] ?? 0) + (it.count ?? 1)
  const coarse = Object.keys(inv).sort().map(k => `${k}:${bucket(inv[k])}`).join(',')
  return `${milestoneId ?? '?'}|${cell}|${coarse}`
}

/**
 * VETOSKIP. `last` is the previous MODEL decision as the loop recorded it: { sig, skill, args, reason (the veto reason,
 * null when admitted), at, skips (consecutive skips since) }. `memoryRefuses(skill, args)` is the admission gate's
 * read-only memory check. -> { skip, why }
 */
export function vetoSkipDecision ({ cfg, trigger, last, sig, now, memoryRefuses }) {
  if (!cfg?.vetoSkip) return { skip: false, why: 'off' }
  if (trigger !== 'idle') return { skip: false, why: 'trigger' }
  if (!last || !last.reason) return { skip: false, why: 'not_vetoed' }
  if (!cfg.vetoReasons?.has(last.reason)) return { skip: false, why: 'reason' }
  if ((last.skips ?? 0) >= (cfg.vetoSkipMax ?? 0)) return { skip: false, why: 'max_skips' }
  if (!(now - last.at <= cfg.vetoTtlMs)) return { skip: false, why: 'stale' }
  if (last.sig !== sig) return { skip: false, why: 'state_changed' }
  // A repeat_loop veto is only certain while the key still fills the window: an escape clears it, other admitted keys
  // push it out, a peer's failures can turn it into a milestone-critical admission (memoryRefuses then says learned_avoid).
  if (last.reason === 'repeat_loop') {
    let still = null
    try { still = memoryRefuses?.(last.skill, last.args) ?? null } catch { still = null }
    if (still !== 'repeat_loop') return { skip: false, why: 'window_cleared' }
  }
  return { skip: true, why: last.reason }
}

/**
 * CONTINUE, after a run. What the loop remembers for a continuation: { skill, args, n } or null. `source` is 'model'
 * (the model's own admitted decision), 'continue' (a continuation) or 'order' (any other work order: never continued,
 * the order chain re-issues itself). n counts the continuations already made of this key.
 */
export function continueAfterRun ({ cfg, source, skill, args, status, serving, gained, prev }) {
  if (!cfg?.cont || status !== 'success' || !serving || !(gained > 0) || !cfg.contSkills?.has(skill)) return null
  if (source === 'model') return { skill, args: args ?? {}, n: 0 }
  if (source === 'continue' && prev && prev.skill === skill) return { skill, args: args ?? {}, n: (prev.n ?? 0) + 1 }
  return null
}

/** CONTINUE, at a tick with no work order: the continuation order, or null. */
export function continueOrder ({ cfg, cont, trigger, memoryRefuses }) {
  if (!cfg?.cont || !cont?.skill) return null
  // IDLE ONLY (Codex r1 BLOCKER): a death, a reflex handoff or startup must reach the model, never a stale continuation.
  if (trigger !== 'idle') return null
  if ((cont.n ?? 0) >= (cfg.contMax ?? 0)) return null
  let refused = 'unknown'
  try { refused = memoryRefuses?.(cont.skill, cont.args) ?? null } catch { refused = 'unknown' }
  if (refused) return null
  return { skill: cont.skill, args: { ...(cont.args ?? {}) }, why: `continue ${(cont.n ?? 0) + 1} of ${cfg.contMax}: the last ${cont.skill} served the task and gained items; filling the cooldown instead of standing still`, continuation: true }
}

/**
 * CONTINUE, the scheduler. After a tick: { delayMs, window } -- an early tick inside the cooldown window when the run
 * succeeded and the window still has early ticks left, else the normal cooldown (window cleared). `window` is
 * { until, early } or null; it opens when a decision's run succeeds and closes when the model is next asked.
 */
export function continueSchedule ({ cfg, ranOk, window, now, cooldownMs }) {
  if (!cfg?.cont || !ranOk) return { delayMs: cooldownMs, window: null }
  const step = Math.min(cfg.contDelayMs ?? 0, cooldownMs)   // never slower than the cooldown it fills
  // THE WINDOW IS SPENT (Claude review note 2): the cooldown went by in work, so it closes -- the next tick decides as
  // usual (the model, if no order), and a success there opens a fresh window with a fresh early-tick budget.
  if (window && now >= window.until) return { delayMs: step, window: null }
  const w = window ?? { until: now + cooldownMs, early: 0 }
  if (w.early >= (cfg.earlyMax ?? 0)) return { delayMs: Math.max(step, w.until - now), window: { ...w } }
  return { delayMs: step, window: { ...w, early: w.early + 1 } }
}

/** CONTINUE, at the model call: while the window is open, an idle tick waits for the rest of it (no model call). */
export function continueWait ({ cfg, window, now, trigger }) {
  if (!cfg?.cont || !window || trigger !== 'idle') return 0
  return Math.max(0, window.until - now)
}
