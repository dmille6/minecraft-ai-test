/**
 * FULLPLACE-01 (OWNER 2026-11-12, "build it and deploy now"): A FULL-CHEST TOWN DEPOSIT RUNS ITS OWN REMEDY.
 *
 * The town deposit (towndeposit.mjs, the deterministic full-bag order) ended `town_storage_full` with the advice
 * "deposit (no item) tries other chests and can build a new one". The deposit verb is the ONLY path to the full-chest
 * recovery (skills.mjs fullChestRecovery: sweep the town's containers, then place the carried chest), and the advice was
 * left to the model. Measured 11-12 (telemetry.py, 6 h, 536,745 rows / 80 bots): 315 such refusals, a deposit within the
 * next five skills after 48 of them (15%). hive-c: 42 refusals, 0 deposits, 0 new-chest rows; placebo-d: 69 / 0 / 0 --
 * the towns where all five bags sat at 34+ of 36 slots. placebo-c, whose bots did deposit (168 tries), had none full.
 * Advice printed is not advice taken (CLAUDE.md, refusals): so the run that found every chest full now runs the deposit
 * verb itself, on the same runner clock, and reports what THAT did.
 *
 * Only the full-bag order: never a tail run (a bag that is not full), never a rows-only plan (the verb does not bank the
 * bag allowance's rows -- bagbudget-01), never with too little of the skill's clock left for the verb to start.
 * Rollback: FULLPLACE=off (the refusal and its advice are then exactly the base's).
 */
export const FULLPLACE = Object.freeze({ on: String(process.env.FULLPLACE ?? '').trim().toLowerCase() !== 'off' })

/** A STAND-IN FOR THE VERB, for tests only: null in production, where skills.mjs runs its own `deposit`. */
export const fullPlaceVerb = { run: null }

/** The least of the runner's clock the deposit verb is started with: a third of the skill timeout, at most a minute. */
export const fullPlaceMinMs = (timeoutMs = 180_000) => Math.max(0, Math.min(60_000, Math.floor((Number(timeoutMs) || 0) / 3)))

/**
 * Does this town-deposit run go on into the deposit verb? -> { go, why }. Pure.
 * `tried` is the run's [{ result }]; `allowOnly` a plan of bag-allowance rows only; `tail` a not-full bag's tail run;
 * `banked` what the run itself banked; `msLeft` what is left of the runner's clock; `minMs` the least the verb needs.
 */
export function fullPlaceChain ({ on = FULLPLACE.on, tried = [], allowOnly = false, tail = false, banked = 0, msLeft = 0, minMs = fullPlaceMinMs() } = {}) {
  if (!on) return { go: false, why: 'off' }
  const t = Array.isArray(tried) ? tried : []
  if (!t.length || !t.every(x => x?.result === 'full')) return { go: false, why: 'not_all_full' }
  if (tail) return { go: false, why: 'tail' }
  if (allowOnly) return { go: false, why: 'allowance_only' }
  if (banked > 0) return { go: false, why: 'banked' }
  if (!(msLeft >= minMs)) return { go: false, why: 'no_time' }
  return { go: true, why: 'chests_full' }
}

const cut = (s, n) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x }

/**
 * The town deposit's result after the deposit verb ran in its place -> { status, failClass?, detail }. Pure.
 * A deposit that banked is the town deposit's success. Anything else stays `town_storage_full` (the order's 15-min
 * backoff, as before) and carries the verb's own words: its refusals name their own remedies (chestfull.mjs).
 * `threw` = the verb threw something that was not an abort.
 */
export function fullPlaceResult (dep = null, threw = null) {
  if (dep?.status === 'success') {
    return { status: 'success', detail: cut(`the town chests in reach were full, so the deposit ran: ${dep.detail ?? 'banked'}`, 400) }
  }
  const said = threw ? `it threw ${cut(threw?.message ?? threw, 120)}` : cut(dep?.detail ?? 'it returned nothing', 300)
  return { status: 'failed', failClass: 'town_storage_full',
           detail: `the town chests in reach are full, and the deposit that ran next did not bank: ${said}` }
}

/** The `_fullplace` row's detail: key=value, the verb's status first. Under the logger's 300-character cap. Pure. */
export function fullPlaceDetail ({ dep = null, threw = null, slotsBefore = 0, slotsAfter = 0, bagBefore = 0, bagAfter = 0, ms = 0, full = 0 } = {}) {
  const status = threw ? 'threw' : (dep?.status ?? 'none')
  const fail = threw ? 'exception' : (dep?.failClass ?? '-')
  const why = cut(threw ? (threw?.message ?? threw) : (dep?.detail ?? '-'), 150).replace(/\s+/g, '_')
  return cut(`via=town_deposit deposit=${status} fail=${fail} full_chests=${full} slots=${slotsBefore}->${slotsAfter} bag=${bagBefore}->${bagAfter} ms=${ms} why=${why}`, 300)
}
