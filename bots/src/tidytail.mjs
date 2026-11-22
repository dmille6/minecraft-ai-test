// TIDYTAIL-01SHOW: THE TIDY'S TAIL IS SET ASIDE WITH A PROOF, AND A PROJECT WITH ONLY SET-ASIDE CELLS IS NOT OFFERED.
// (the stepwell-03show pattern, stepwell.mjs asideRefusal / asideFor / stampStale, for the grounds' fills.)
//
// LIVE showcase 11-22 00:40-03:40Z (ES, 15 bots): 116 of 385 build_shop rows in 3 h ended no_effect with "18 cell(s) no stand has
// reached in 3+ visits (first 14,68,-36; 27 open cell(s) wait on it); nothing else is open: the project is STALLED; cuts left 0/2967,
// fills left 27/7714" -- the same at 4,65,-65 / -33,67,-81 / 4,64,-66 / 9,68,-44. The waiver that should end it is the keeper's alone
// (crewCaps.waive), never names a seal (an `opener` fill) and is read once the visit ends `stuck_on_cell`; every other bot's visit
// walked at the same cells and ended with nothing done.
//
// THE RULES (pure; skills.mjs buildTidy supplies the readings and publishes the record):
// 1. A FILL CELL NO STAND HAS REACHED IN TAIL.visits VISITS (the stuck map's town-wide count) ON A STALLED VISIT is SET ASIDE, by any
//    role: named on the record (`aside`: why, when, by whom, the CODE VERSION that proved it). Set aside is not waived: the cell stays
//    owed (the completion, the progress and the waiver room are unchanged) -- the visit only stops walking at it.
// 2. THE PROOF IS READ AGAIN BEFORE EVERY SCAN (tailReread): an entry of another code version (a later release revisits it, as the step
//    well's stamp does), older than TAIL.ttlMs, whose cell reads unread, or whose cell is laid now, leaves the set. The proof names why
//    (`no_stand` only: a cell refused for footing, cover or material has a remedy the bot can perform and is never set aside).
// 3. THE CELLS RESTING ON A SET-ASIDE CELL go with it (fillcolumn.mjs waiveRests: an open fill above it that no side holds); a cell a
//    side holds stays open and is worked as before.
// 4. WHEN ONLY SET-ASIDE CELLS REMAIN (no cut, no clear, nothing unread, every open fill in the set) the record carries a `tail` mark
//    (code version, time, the stage's signature): the project counts as done for offering (tailQuiet) for TAIL.holdMs. A re-survey
//    (the signature moves), another code version or the hold's end opens it again; the one visit that then finds it still so renews it.
// TIDYTAIL=0|off|false|no: everything as before.
import { gkwSig } from './gkwork.mjs'
import { waiveRests, FILLCOLUMN } from './fillcolumn.mjs'
import { stuckStale } from './shop.mjs'   // tidytail-01show (Codex r2): the stamp's own rule

export const TAIL = Object.freeze({
  visits: 3,                    // = buildrun.mjs STUCK_VISITS: the town-wide count a cell must carry
  ttlMs: 6 * 60 * 60_000,       // a proof older than this is read again by a walk (= SHOP_STUCK_RETRY_MS)
  holdMs: 3 * 60 * 60_000,      // a tail-only project is not offered for this long, then one visit renews it
  max: 60,                      // cells set aside in one visit
})
/** THE SWITCH -> bool. TIDYTAIL=0|off|false|no: off; default on. Pure. */
export const tailOn = (env = process.env) => !['0', 'off', 'false', 'no'].includes(String(env?.TIDYTAIL ?? '1').trim().toLowerCase())

const keyOf = at => at.join(',')
const NO_STAND = /(^|\s)no_stand(\s|$)/

/** The deferred cells this STALLED visit sets aside -> [{ k, why }]. Pure. `deferred` is buildrun.mjs's `out.deferred` ([{ k, why, visits }]),
 *  `live` the set already aside, `done(cell)` reads a laid fill. A record fill (never a carried `prev` cell) that reads, is not laid, was
 *  deferred for want of a stand (`no_stand`, never a footing, cover or material reason) and carries TAIL.visits visits. */
export function tailAsideFor ({ rec, deferred = [], stalled = false, live = new Set(), read, done = () => false, T = TAIL } = {}) {
  if (!stalled || !rec) return []
  const cells = new Map((rec.cells ?? []).filter(c => c && Array.isArray(c.at) && !c.prev).map(c => [keyOf(c.at), c]))
  const out = []
  for (const d of deferred ?? []) {
    if (out.length >= T.max) break
    const k = String(d?.k ?? ''), c = cells.get(k)
    if (!c || live.has(k) || out.some(o => o.k === k)) continue
    if (rec.waived && Object.prototype.hasOwnProperty.call(rec.waived, k)) continue
    if (!NO_STAND.test(String(d?.why ?? ''))) continue
    if ((Number(d?.visits) || 0) < T.visits) continue
    if (!read(...c.at)) continue          // unread: no evidence
    if (done(c)) continue
    out.push({ k, why: `no_stand:${Number(d.visits)}` })
  }
  return out
}

/** THE CELLS RESTING ON THE CELLS SET ASIDE NOW -> [{ k, why }]. Pure. fillcolumn.mjs waiveRests' own finding, with no waiver budget (a set-aside
 *  names no waiver: it spends no room, and an exhausted repair budget must not leave a dependent open -- Codex r1). */
export function tailRests ({ rec, adds = [], read, done = () => false, guard = new Set() } = {}) {
  if (!adds.length) return []
  const T = { ...FILLCOLUMN, outMin: 1e9, outShare: 1 }
  return waiveRests(rec, adds, read, { done, guard, T }).map(d => ({ k: d.k, why: `rests_on:${String(d.why).split(' ').pop()}` }))
}

/** THE SET READ AGAIN BEFORE A SCAN -> { live: Set<k>, drop: [{ k, why }] }. Pure. Every entry of `rec.aside` is judged on the world now. */
export function tailReread ({ rec, read, done = () => false, code = null, now = Date.now(), T = TAIL } = {}) {
  const live = new Set(), drop = []
  const cells = new Map((rec?.cells ?? []).filter(c => c && Array.isArray(c.at)).map(c => [keyOf(c.at), c]))
  for (const [k, e] of Object.entries(rec?.aside ?? {})) {
    const c = cells.get(k)
    if (!c) drop.push({ k, why: 'gone' })
    else if ((e?.code ?? null) !== code) drop.push({ k, why: 'version' })
    else if (!(Number.isFinite(e?.at) && e.at <= now + 60_000 && now - e.at < T.ttlMs)) drop.push({ k, why: 'expired' })
    else if (!read(...c.at)) drop.push({ k, why: 'unread' })
    else if (done(c)) drop.push({ k, why: 'laid' })
    else live.add(k)
  }
  return { live, drop }
}

/** ONLY THE SET-ASIDE CELLS REMAIN -> bool. Pure. `open`: the keys of every open fill and clear (tidy.mjs tidyLeftKeys), `aside` the set
 *  in force, `cutLeft` the cuts left, `unread` any unread cell. At least one open cell is in the set. */
export function tailOnly ({ open = [], aside = new Set(), cutLeft = 0, unread = false } = {}) {
  if (unread || Number(cutLeft) > 0 || !open.length) return false
  return open.every(k => aside.has(k))
}

/** THE RECORD AFTER A VISIT'S SET-ASIDE DECISIONS -> the record | null (nothing changes). Pure. Drops leave, adds enter (this code's
 *  version, now, by whom), and the `tail` mark follows `only`. A mark newer than half the hold is not rewritten (no generation a visit). */
export function tailNext (rec, { drops = [], adds = [], only = false, code = null, now = Date.now(), by = null, T = TAIL } = {}) {
  if (!rec) return null
  const aside = { ...(rec.aside ?? {}) }
  let changed = false
  for (const d of drops) if (Object.prototype.hasOwnProperty.call(aside, d.k)) { delete aside[d.k]; changed = true }
  for (const d of adds) if (!aside[d.k]) { aside[d.k] = { why: d.why, at: now, by, code }; changed = true }
  const sig = gkwSig(rec), had = rec.tail ?? null
  let tail = had
  if (only) {
    const fresh = had && had.code === code && had.sig === sig && Number.isFinite(had.at) && had.at <= now && now - had.at < T.holdMs / 2 && had.n === Object.keys(aside).length
    if (!fresh) { tail = { code, at: now, sig, n: Object.keys(aside).length }; changed = true }
  } else if (had) { tail = null; changed = true }
  if (!changed) return null
  const next = { ...rec, aside }
  if (tail) next.tail = tail; else delete next.tail
  if (!Object.keys(aside).length) delete next.aside
  return next
}

/** IS THE TIDY DONE FOR OFFERING -> bool. Pure. Only set-aside cells remained at the mark, the mark is this code's, this stage's
 *  (the signature) and younger than TAIL.holdMs. A complete record is complete anyway (false: nothing to add). */
export function tailQuiet (rec, { code = null, now = Date.now(), T = TAIL } = {}) {
  const t = rec?.tail
  if (!t || rec.structure_complete) return false
  return t.code === code && t.sig === gkwSig(rec) && Number.isFinite(t.at) && t.at <= now + 60_000 && now - t.at < T.holdMs
}

/** THE YARD ROW'S VISIT OUTCOME -> { status, stop }. Pure. A chest banked into or a chest placed is work: `success`, never `no_effect`. */
export function yardRowOutcome ({ banked = {}, placed = 0 } = {}) {
  const nb = Object.values(banked ?? {}).reduce((t, v) => t + (Number(v) || 0), 0)
  const work = nb + (Number(placed) || 0) > 0
  return { status: work ? 'success' : 'no_effect', stop: work ? 'row' : 'row_none', banked: nb, placed: Number(placed) || 0 }
}

/**
 * tidytail-01show (Codex r2 BLOCKER): THE STUCK STAMP AND THE SET-ASIDE. The stalled visit that set the tail aside also wrote the
 * project's 6 h stuck stamp (buildrun settleStuck). Once the tail's hold ends -- its life, or a new release -- the project is
 * offered again, and that stamp would hold it six more hours. A tidy stamp whose every cell is done OR set aside in the record
 * holds nothing (stepwell-03show's rule for its own stamps). Pure: `done(cell)` the caller's read.
 */
export function tidyStampStale (keys = [], rec = null, done = () => false) {
  const aside = rec?.aside ?? {}
  return stuckStale(keys, rec, c => done(c) === true || Object.prototype.hasOwnProperty.call(aside, c.at.join(',')))
}
