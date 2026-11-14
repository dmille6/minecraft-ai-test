// STUCKCLOSE-01 (control session 11-08): A TIDY STAGE WHOSE LAST CUTS THE TOWN CANNOT REACH CLOSES.
//
// MEASURED (fleet .31, scripts/lib/telemetry.py full walk, 12 h to 11-08 ~20:00Z: 1,197,814 rows, 80 bots, 2,574 _build_visit rows
// in 16 pools -- the positive control): hive-b's tidy ended `complete` 219 times, isolated-c's 179, board-a's 172 (the status report's
// "stuck ... (complete)"), placing 0, each reading "complete; cuts left N/M, fills left 0/F", and the record never closed. The cuts
// left are exactly the cuts the town's buildretry ledger HOLDS (hive-b 2 of 38, isolated-c 4 of 8, board-a 2 of 28: summed visits
// 3-11, why=unreached): 223 / 178 / 187 `_build op=deferred kind=retry` rows in the same window. TWO CORRECT GUARDS COMPOSED INTO A
// DEAD END: buildretry-01 holds a cut the town's walks keep failing (no walk, no dig, so the visit's clears never EVALUATE it), and
// the tidy gives a cut up only after TIDY_CUT_TRIES visits of ONE bot's connection evaluated it (bot.tidyGiven, tidy.mjs
// tidyNoteCuts). A held cut is never evaluated, so it is never given up; it stays `cutLeft`, so the stage never completes and no visit
// is ever empty (gkwork.mjs visitEmpty), so the town's strikes never come in either. Every keeper visit since: 13 s, nothing to do.
//
// THE RULES (pure; skills.mjs buildTidy supplies the ledger and keeps the files):
// 1. A CUT THE TOWN HAS FAILED is given up by the town: a standing cut whose summed buildretry entry (every holder, after resets,
//    inside RETRY_FORGET_MS) has RETRY_VISITS failing visits counts as given in the stage's progress -- the town-wide twin of the
//    per-bot TIDY_CUT_TRIES -- so the stage completes (or its empty visits strike) and the land plan moves on.
// 2. The visit does not walk to such a cut (it is held anyway), and a tidy cut a visit finds NO dig stand for is counted in the town's
//    ledger (buildrun.mjs `p.tidyTownCount`), so a stand-less cut reaches rule 1 too instead of waiting on one bot's three visits.
// 3. The completion names the given cuts on the record's `waived` (why `cut_given:<ledger why>`), so gkforever.mjs gkfDeadCarry
//    keeps them out of the next generations for GKF.deadMs and retries them after -- never a silent forever.
// STUCKCLOSE=0 is the rollback (every rule off: the build before it).
import { RETRY_VISITS } from './buildretry.mjs'

/** THE SWITCH -> bool. STUCKCLOSE=0|off|false|no: off; default on. Pure. */
export const stuckcloseOn = (env = process.env) => !['0', 'off', 'false', 'no'].includes(String(env?.STUCKCLOSE ?? '1').trim().toLowerCase())

/** Has the TOWN failed this cell enough to give it up? `entry` a summed buildretry ledger entry. -> bool. Pure. */
export const townFailed = (entry, visits = RETRY_VISITS) => !!entry && Number(entry.visits) >= visits

/**
 * THE CUTS THE TOWN GIVES UP -> Map key -> ledger why. Pure. The record's cuts that still stand (`standing(cut)`) and whose summed
 * ledger entry (`ledger`: buildretry.mjs retryRead) is townFailed. A cut no longer standing is done, never given.
 */
export function townGivenCuts (rec, ledger = {}, { standing = () => true, visits = RETRY_VISITS } = {}) {
  const out = new Map()
  for (const c of rec?.cut ?? []) {
    if (!Array.isArray(c?.at)) continue
    const k = c.at.join(',')
    if (out.has(k) || !townFailed(ledger?.[k], visits) || !standing(c)) continue
    out.set(k, String(ledger[k].why || 'failed').slice(0, 40))
  }
  return out
}

/** THE RECORD'S WAIVERS WITH THE GIVEN CUTS -> waived map (a new object). Pure. A key already waived keeps its entry. */
export function givenWaivers (waived = {}, given = new Map(), { now = Date.now(), by = '?' } = {}) {
  const w = { ...(waived ?? {}) }
  for (const [k, why] of given) if (!Object.prototype.hasOwnProperty.call(w, k)) w[k] = { why: `cut_given:${why}`, at: now, by }
  return w
}
