// DEPOSITOFFER-01 (idlegap design 2026-11-03 §1 "Deposit refusals"; owner overnight grant 11-04): THE MODEL IS NOT OFFERED A
// DEPOSIT THE GATE WOULD REFUSE.
//
// Measured (storehub design 00d9056e): 16,381 deposit proposals a day, 15,831 refused before they start. Post-cooldown15-02
// (11-03 19:30 - 11-04 04:00Z, 680 bot-h): deposit_nothing_to_bank 8,989 vetoes / 38.7 between-hours, deposit_not_worth_it
// 1,944 / 8.4 h -- each one a ~2 s model call and a ~15.7 s cooldown with nothing done. Advice does not fix this (the CARRYING
// line is already gated; the model proposes deposit anyway), so the option itself goes: when an UNNAMED deposit -- the widest
// deposit there is (a named plan is a subset of it) -- would be refused, `deposit` leaves that call's skill enum, which the
// grammar enforces. A named deposit the unnamed one would admit is still offered and still judged by check().
//
// THE SAME DECISION AS THE GATE, NOT A COPY OF IT: admission.mjs check() decides nothing_to_bank / not_worth_it with
// depositVerdict below, and the offer asks the gate's own reader (AdmissionControl.depositRunnable) with item = null.
//
// THE RUNG'S OWN FLOOR (found building this; the design's `#N` diagnosis was half of it). On deposit_surplus the gate refused
// 1,097 of 1,097 not_worth_it with 4-9 bankable (live logs 11-04 00:00-06:40Z): the rung is current from 4 bankable with storage in
// reach, but depositDue's 12-item floor runs BEFORE its milestone clause -- and the milestone clause compared
// 'deposit_surplus' to 'deposit_surplus#N', so it was never true either. Offering by the old gate would have taken the rung's
// own skill away on its own rung (CLAUDE.md: two correct guards composing into a dead end). On the rung the floor is 1.
import { depositDue } from './bankable.mjs'

/** DEPOSITOFFER=0 turns the offer filter off (the gate fix stays: it is a correctness fix). */
export function depositOfferConfig (env = process.env) {
  return { on: String(env.DEPOSITOFFER ?? '1') !== '0' }
}

/** Sustaining ids carry `#N` (`deposit_surplus#3207`); a prerequisite override (`...+prereq`) is not the rung. */
export function isDepositMilestone (id) {
  return typeof id === 'string' && /^deposit_surplus(#\d+)?$/.test(id)
}

export const NEAR_HOME = 96
export const MIN_BANKABLE = 12

/**
 * THE GATE'S DEPOSIT DECISION, pure. -> { ok: true } | { ok: false, reason: 'bank_closed' | 'deposit_nothing_to_bank' |
 * 'deposit_not_worth_it' }. `storageWithin48` may be a function: it is read only when the answer depends on it (the world
 * scan is the expensive part, and the offer asks on every model call).
 */
export function depositVerdict ({ closed = false, planLength = 0, reconcile = false, bankable = 0, occupiedSlots = 0,
                                 distHome = Infinity, storageWithin48 = false, onDepositMilestone = false }) {
  if (closed) return { ok: false, reason: 'bank_closed' }
  if (!(planLength > 0) && !reconcile) return { ok: false, reason: 'deposit_nothing_to_bank' }
  if (reconcile) return { ok: true }
  const minBankable = onDepositMilestone ? 1 : MIN_BANKABLE
  const needsStorage = bankable > 0 && !(bankable < minBankable && occupiedSlots < 30) && !(distHome <= NEAR_HOME) && !onDepositMilestone
  const storage = needsStorage ? !!(typeof storageWithin48 === 'function' ? storageWithin48() : storageWithin48) : false
  const due = depositDue({ bankable, distHome, storageWithin48: storage, onDepositMilestone, occupiedSlots, minBankable, nearHome: NEAR_HOME })
  return due ? { ok: true } : { ok: false, reason: 'deposit_not_worth_it' }
}

/**
 * THE OFFER, pure: which skills this model call may name. -> { skills, suppressed: null | 'deposit', why }.
 * Off, or the verdict admits, or no verdict could be read (null: a read failed) -> the full list (the old behaviour).
 */
export function offeredSkills ({ cfg, names, verdict }) {
  if (!cfg?.on || !verdict || verdict.ok || !names.includes('deposit')) return { skills: names, suppressed: null, why: null }
  return { skills: names.filter(n => n !== 'deposit'), suppressed: 'deposit', why: verdict.reason ?? 'refused' }
}

/** One depositoffer_tally row per bot per 10 min: the canary read's own line (all counts since the last row). */
export const TALLY_MS = 10 * 60 * 1000
export function tallyLine ({ secs, c }) {
  const g = k => c[k] ?? 0
  const calls = g('model_calls')
  const perMin = secs > 0 ? (calls * 60 / secs).toFixed(2) : '0'
  const skillsPerH = secs > 0 ? (g('skills_run') * 3600 / secs).toFixed(1) : '0'
  const refusalsPerCall = calls > 0 ? (g('model_refused') / calls).toFixed(3) : '0'
  return `secs=${Math.round(secs)} model_calls=${calls} calls_per_min=${perMin} model_refused=${g('model_refused')} refusals_per_call=${refusalsPerCall} ` +
    `deposit_refused=${g('deposit_refused')} skills_run=${g('skills_run')} skills_per_bot_h=${skillsPerH} offered=${g('offered')} ` +
    `suppressed=${g('suppressed')} sup_nothing=${g('sup_deposit_nothing_to_bank')} sup_not_worth=${g('sup_deposit_not_worth_it')} ` +
    `sup_closed=${g('sup_bank_closed')} read_failed=${g('read_failed')}`
}
