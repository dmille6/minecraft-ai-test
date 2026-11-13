// TIDYREFRESH-01 (cleanup pass 2, 11-10, measured on the showcase). PURE: nothing here touches a bot or a file.
//
// WHY. The showcase's inside-the-wall tidy record was sited 11-08 04:47Z (1,100 cuts, 1,622 fills) and was still open 45 h later
// (294 fills and 8 cuts left on the 11-10 01:52Z copy). The keeper re-surveys only after a stage COMPLETES (skills.mjs buildTidy:
// tidyDue / gkStageDue), so every pillar, beam and pit the bots made after 04:47Z was never planned (pass 2: 532 of the 688 in-wall
// leftovers were made after the siting), the rough survey's 1,200-cell cap (161 cut off) was never paged, and the outer rings never
// opened. And a cut one bot gave up (tidy.mjs TIDY_CUT_TRIES, a per-connection memory) was still open for every other bot: a stage
// completes only for a keeper that gave up the same cuts itself.
//
// WHAT.
//   (a) THE REFRESH: while the inside-the-wall record is OPEN, the keeper surveys the inside again every `everyMs` (the hour of
//       roughground.mjs ROUGH.inwallEveryMs, the inside-the-wall clock) and ADDS what the new survey finds: whole columns only,
//       never a column the record still works, never a cell the record already names (its carried cells, its waivers, its done cuts),
//       never a cell another project's record names now (`guard`), never a stand or a plot's levelling (their teardown and their
//       plot bookkeeping ride on the siting). The added fills get new segment groups (after the record's highest), their layers
//       chained as tidyRecord chains them. Nothing is ever dropped from the record.
//   (b) THE TOWN GIVES A CUT UP: a cut a crew bot's visits gave up (TIDY_CUT_TRIES evaluated visits, the cut still standing) is
//       named on the record's `waived` list, so the completion, the other crew bots' cut lists and the next keeper read it given up
//       too -- with the fills a crust cut would have opened (`opener`: under a cut that stays standing, nothing is opened). The
//       remedy is the next inside-the-wall survey: the refresh never re-adds a waived cell on this record, and the record after it
//       (inwallFirst, the hour after the completion) plans the cut again from fresh ground.
//   (c) THE CAP PAGES: the refresh passes the record's open columns to the rough survey as `busy` (tidy.mjs siteStage `busy`), so
//       work already planned no longer fills the 1,200-cell cap: each refresh takes the next page, nearest home first.
// TIDYREFRESH=off is the rollback (no refresh, no town give-up: the record as before).

import { handedOld } from './litter.mjs'   // litter-01 r2: a hand-off's cut past its life is done with (pure)

export const TIDYREFRESH = Object.freeze({ everyMs: 60 * 60_000, addMax: 1200, inwallId: 'inwall' })
/** THE SWITCH: TIDYREFRESH=off|0|false|no -> off; on by default. Pure. */
export const tidyRefreshOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.TIDYREFRESH ?? '').trim())

const k2 = (x, z) => `${x},${z}`
const kOf = at => at.join(',')
const colOf = at => k2(at[0], at[2])
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const SEG = /^T-(\d+)-(\d+)$/
const hasOwn = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)

/** When was this record's inside last surveyed? -> ms | null: its own refresh, else its siting. Pure. */
export const refreshedAt = rec => {
  const a = Number(rec?.refreshAt), s = Number(rec?.sitedAt)
  if (Number.isFinite(a) && a > 0) return Math.max(a, Number.isFinite(s) ? s : 0)
  return Number.isFinite(s) && s > 0 ? s : null
}
/**
 * IS AN OPEN RECORD DUE ITS REFRESH? -> bool. Pure. Only an open tidy record of the inside-the-wall stage, surveyed `everyMs` ago or
 * more; a survey time in the future (a clock jump, another host's clock) reads not due.
 */
export function refreshDue (rec, { now = Date.now(), env = process.env, T = TIDYREFRESH } = {}) {
  if (!tidyRefreshOn(env) || !rec || rec.structure_complete || rec.blueprint !== 'tidy@1' || rec.stageId !== T.inwallId) return false
  const at = refreshedAt(rec)
  return Number.isFinite(at) && at <= now + 60_000 && now - at >= T.everyMs
}

/**
 * THE COLUMNS THE RECORD STILL WORKS -> Set "x,z". Pure over `read`. Every cut still standing (unread = standing) that is not
 * waived, every fill not done (`done(cell)`: the visit's own done test) that is not carried (`prev`) or waived, every clear still
 * standing that is not waived. litter-01 r2: never a hand-off's cut past its life (litter.mjs handedOld at `now`): nobody will dig
 * it, so it must not keep its column out of every later survey.
 */
export function openColumns (rec, read, { done = () => false, now = Date.now() } = {}) {
  const w = rec?.waived ?? null
  const out = new Set()
  for (const c of rec?.cut ?? []) { if (hasOwn(w, kOf(c.at)) || handedOld(c, now)) continue; const b = read(...c.at); if (!b || nm(b) === c.name) out.add(colOf(c.at)) }
  for (const c of rec?.cells ?? []) { if (c.prev || hasOwn(w, kOf(c.at))) continue; if (!done(c)) out.add(colOf(c.at)) }
  for (const c of rec?.clear ?? []) { if (hasOwn(w, kOf(c.at))) continue; const b = read(...c.at); if (!b || nm(b) === c.name) out.add(colOf(c.at)) }
  return out
}

/**
 * THE MERGE -> { rec: the new record | null (nothing to add), added: { cut, fill, clear, cols }, skipped: { why: n } }. Pure.
 *   cur    the open record (the head NOW: called inside the publish's mutate)
 *   fresh  the new survey's record (tidy.mjs siteStage, coreFills applied), or null (the survey found nothing)
 *   busy   Set "x,z": the columns `cur` still works (openColumns)
 *   guard  Set "x,y,z": every cell another project's record names now (and the markers, the bridges: the visit's guard)
 * A fresh column is added WHOLE or not at all: its cuts, its fills, the leaves in its fills (a `leaves` clear at a fill cell).
 */
export function refreshMerge (cur, fresh, { busy = new Set(), guard = new Set(), now = Date.now(), T = TIDYREFRESH } = {}) {
  const skipped = {}
  const skip = (why, n = 1) => { skipped[why] = (skipped[why] ?? 0) + n }
  const none = { rec: null, added: { cut: 0, fill: 0, clear: 0, cols: 0 }, skipped }
  if (!cur || cur.structure_complete || !fresh) return none
  const known = new Set([...(cur.cells ?? []), ...(cur.cut ?? []), ...(cur.clear ?? [])].map(c => kOf(c.at)))
  for (const k of Object.keys(cur.waived ?? {})) known.add(k)
  // the fresh entries by column
  const cols = new Map()
  const col = k => { if (!cols.has(k)) cols.set(k, { cut: [], cells: [], clear: [], bad: null }); return cols.get(k) }
  const bad = (e, why) => { if (!e.bad) e.bad = why }
  for (const c of fresh.cut ?? []) { const e = col(colOf(c.at)); e.cut.push(c); if (c.teardown || c.plot != null) bad(e, 'stand_or_plot') }
  for (const c of fresh.cells ?? []) { const e = col(colOf(c.at)); e.cells.push(c); if (c.role === 'access' || c.plot != null || c.prev) bad(e, 'stand_or_plot') }
  const fillK = new Set((fresh.cells ?? []).map(c => kOf(c.at)))
  for (const c of fresh.clear ?? []) { if (c.kind === 'leaves' && fillK.has(kOf(c.at))) col(colOf(c.at)).clear.push(c) }
  for (const [k, e] of cols) {
    if (busy.has(k)) { bad(e, 'busy'); continue }
    for (const q of [...e.cut, ...e.cells, ...e.clear]) {
      const key = kOf(q.at)
      if (guard.has(key)) { bad(e, 'guarded'); break }
      if (known.has(key)) { bad(e, 'known'); break }
    }
  }
  // a crust cut and the hollow it opens go together (roughground-1b): never one without the other
  const ok = k => { const e = cols.get(k); return !!e && !e.bad }
  for (let changed = true; changed;) {
    changed = false
    for (const [, e] of cols) {
      if (e.bad) continue
      const brk = e.cut.some(c => (c.hollow ?? []).some(h => !ok(colOf(h)))) || e.cells.some(c => Array.isArray(c.opener) && !ok(colOf(c.opener)))
      if (brk) { bad(e, 'hollow_split'); changed = true }
    }
  }
  for (const [, e] of cols) if (e.bad) skip(e.bad, e.cut.length + e.cells.length)
  // nearest home first, at most addMax entries a refresh (whole columns)
  const home = cur.home ?? fresh.home ?? { x: 0, z: 0 }
  const dist = k => { const [x, z] = k.split(',').map(Number); return Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) }
  const take = [...cols.entries()].filter(([, e]) => !e.bad && (e.cut.length || e.cells.length)).sort((a, b) => dist(a[0]) - dist(b[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const chosen = []
  let n = 0
  for (const [k, e] of take) {
    const m = e.cut.length + e.cells.length
    if (n + m > T.addMax) { skip('add_max', m); continue }
    n += m; chosen.push([k, e])
  }
  // the new fills' segments: fresh group gg becomes group off + gg (off: after cur's highest T-group), the layer kept
  let maxG = -1
  for (const s of cur.segments ?? []) { const m = SEG.exec(String(s.seg)); if (m) maxG = Math.max(maxG, Number(m[1])) }
  for (const c of cur.cells ?? []) { const m = SEG.exec(String(c.seg)); if (m) maxG = Math.max(maxG, Number(m[1])) }
  const off = maxG + 1
  const segName = sg => { const m = SEG.exec(String(sg)); return m ? `T-${String(off + Number(m[1])).padStart(2, '0')}-${Number(m[2])}` : null }
  // a column with a fill outside the T-segments (none in an inside-the-wall survey) is never added: it waits for the next record
  const kept = chosen.filter(([, e]) => { if (e.cells.every(c => segName(c.seg))) return true; skip('no_segment', e.cut.length + e.cells.length); return false })
  if (!kept.length) return none
  const cells = [], cut = [], clear = []
  for (const [, e] of kept) {
    for (const c of e.cells) cells.push({ ...c, seg: segName(c.seg), added: now })
    for (const c of e.cut) cut.push({ ...c, added: now })
    for (const c of e.clear) clear.push(c)
  }
  const segSet = new Set(cells.map(c => c.seg))
  const deps0 = new Map((fresh.segments ?? []).map(s => [segName(s.seg), (s.deps ?? []).map(segName)]))
  const lk = sg => { const m = SEG.exec(sg); return [Number(m[2]), Number(m[1])] }
  const segments = [...segSet].sort((a, b) => { const [ka, ga] = lk(a), [kb, gb] = lk(b); return ka - kb || ga - gb }).map(seg => ({ seg, deps: (deps0.get(seg) ?? []).filter(d => d && segSet.has(d)) }))
  const rec = {
    ...cur,
    cells: [...(cur.cells ?? []), ...cells],
    cut: [...(cur.cut ?? []), ...cut.sort((a, b) => b.at[1] - a.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])],
    clear: [...(cur.clear ?? []), ...clear],
    segments: [...(cur.segments ?? []), ...segments],
    bom: { ...(cur.bom ?? {}), earth: (Number(cur.bom?.earth) || 0) + cells.length },
  }
  return { rec, added: { cut: cut.length, fill: cells.length, clear: clear.length, cols: kept.length }, skipped }
}

/** The record after a refresh's survey (with or without additions): the clock and the refresh's own summary. Pure. */
export function refreshStamp (rec, { now = Date.now(), added = null, skipped = {}, cap = 0 } = {}) {
  const n = (Number(rec?.refreshed?.n) || 0) + 1
  return { ...rec, refreshAt: now, refreshed: { n, at: now, cut: added?.cut ?? 0, fill: added?.fill ?? 0, cols: added?.cols ?? 0, cap: Number(cap) || 0, skipped } }
}

/**
 * TIDYGROW-01 (LIVE showcase 11-10 06:50-16:01Z: every refresh was TWO generations of the ~400 KB tidy record, 0-60 s apart -- the
 * refresh (bom, cells, cut, segments) and then gkPlanAdditions' claim retirement (claimed, cut: the cuts the survey had just planned
 * inside a sited building's claim). 10 of the record's 11 generations that day; recordHead reads every generation, 226 ms of a 519 ms
 * pass over the town's 31 records): the refresh's body is the claim retirement's too, IN THE SAME PUBLISH, so one refresh is one
 * generation and the claim pass after it finds nothing to retire. `retire` is tidy.mjs claimRetire (null: nothing inside a claim).
 * TIDYREFRESH=off: no refresh at all, as before. Pure.
 */
export const refreshClaimed = (rec, claims = [], retire = () => null) => (Array.isArray(claims) && claims.length ? retire(rec, claims) : null) ?? rec

/**
 * (b) THE CUTS THE TOWN GIVES UP -> [{ k, why }]. Pure over `read`. Every cut of `rec` this bot gave up (`given(key)`: tidy.mjs
 * tidyGivenUp over its own tries) that still stands (READ standing: an unread cell is no evidence) and is not on the record's waived
 * list yet -- and, for a crust cut, the fills of the hollow it would open (`opener` = that cut: with the crust kept, nothing is opened
 * and they are no work). The `why` names the remedy: the next inside-the-wall survey plans the cut again.
 */
export const CUT_GIVEN_WHY = 'cut_given_up: no crew visit could dig it; the next inside-the-wall survey plans it again'
export function cutGiveUps (rec, read, { given = () => false, now = Date.now() } = {}) {
  const w = rec?.waived ?? null
  const out = []
  const gone = new Set()
  for (const c of rec?.cut ?? []) {
    const k = kOf(c.at)
    if (hasOwn(w, k) || !given(k) || handedOld(c, now)) continue   // litter-01 r2: an expired hand-off's cut is done already: no waiver
    const b = read(...c.at)
    if (!b || nm(b) !== c.name) continue
    out.push({ k, why: CUT_GIVEN_WHY }); gone.add(k)
  }
  if (gone.size) {
    for (const q of rec?.cells ?? []) {
      if (!Array.isArray(q.opener) || !gone.has(kOf(q.opener)) || hasOwn(w, kOf(q.at))) continue
      out.push({ k: kOf(q.at), why: `under_kept_cut ${kOf(q.opener)}: the crust stands, the hollow stays closed` })
    }
  }
  return out
}
/** Is this key on the record's waived list (the town gave it up)? Pure. */
export const cutWaived = (rec, k) => hasOwn(rec?.waived ?? null, k)
