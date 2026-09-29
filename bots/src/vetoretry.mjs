// A VETO COSTS A WHOLE DECISION CYCLE. Retry it once, in the same tick, telling the model what was refused and why.
//
// MEASURED (both engines, 24 h to 2026-09-29 12:35Z, 60 bots on 80b3bbd): 48,536 of 121,174 decisions (40.1%) were
// vetoed by admission, holding 456 of 1,439 bot-hours (31.7%; median 32.7 s = the decision cooldown). Reasons:
// repeat_loop 165 h, learned_avoid 148 h, cooldown 78 h. 44.5% of vetoes were followed by the SAME key again, because the
// next prompt says THAT the bot was refused, not WHAT was refused.
// REPLAY (09-29, the fleet model on the warm spare 10.0.0.16, the exact deployed system prompt -- hash-verified -- 90
// real vetoed decisions): asking again without feedback changed the action 52/90 (58%, matching the fleet's own 55%);
// with this feedback, 87/90 (97%), 0 invalid. The value is the 30 s the bot no longer waits, and the different action.
// DESIGN (both engines): one retry; the grammar is not changed (excluding one args-level key is not expressible, and
// excluding the whole verb would forbid every gather to stop one); a retry that proposes the SAME key again is refused
// WITHOUT calling the gate, so probation and repeat state are untouched; anything else goes through the gate normally.
import { actionKey } from './skills.mjs'

/** Rejections the model can answer by choosing differently. Not safety refusals (border, elevation, unknown skill). */
export const RETRYABLE = new Set(['repeat_loop', 'learned_avoid', 'cooldown', 'deposit_not_worth_it', 'deposit_item_missing', 'bad_args'])

export function vetoFeedback (key, rejection) {
  return `Your proposal ${key} was refused by the admission gate: ${rejection.reason} (${String(rejection.detail ?? '').slice(0, 160)}). ` +
         'Proposing it again will be refused the same way. Choose a DIFFERENT action. Include the exact saw_end value given above.'
}

/**
 * One retry after a veto. Pure over its injected `decide` (the LLM) and `check` (the admission gate).
 * Returns { res, admitted, rejection, retried, result, key, retryKey, ms } -- res/admitted/rejection replace the
 * caller's when the retry was admitted; otherwise the ORIGINAL veto stands (the caller logs it as before).
 */
export async function vetoRetry ({ res, rejection, decide, check, now = () => Date.now() }) {
  const out = { res, admitted: null, rejection, retried: false, result: null, key: null, retryKey: null, ms: 0 }
  if (!res?.schemaValid || !rejection || !RETRYABLE.has(rejection.reason) || res.raw == null) return out
  const t0 = now()
  const key = actionKey(res.proposal.skill, res.proposal.args)
  out.key = key; out.retried = true
  let r2
  try { r2 = await decide([{ role: 'assistant', content: String(res.raw).slice(0, 500) }, { role: 'user', content: vetoFeedback(key, rejection) }]) }
  catch (e) { out.result = 'error'; out.ms = now() - t0; return out }
  out.ms = now() - t0
  if (!r2?.schemaValid) { out.result = 'invalid'; return out }
  out.retryKey = actionKey(r2.proposal.skill, r2.proposal.args)
  if (out.retryKey === key) { out.result = 'retry_same_key'; return out }     // refused without touching the gate
  const c2 = check(r2.proposal)
  if (c2?.ok) { out.res = r2; out.admitted = c2; out.rejection = null; out.result = 'admitted' }
  else { out.rejection = rejection; out.result = `vetoed:${c2?.reason ?? '?'}` }   // the ORIGINAL veto is what the decision records
  return out
}
