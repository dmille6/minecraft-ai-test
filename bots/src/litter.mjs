// LITTER-01: WHAT A WALK COULD NOT TAKE BACK IS HANDED TO THE CLEANUP CREW, CELL BY CELL.
// Design: docs/reports/walking-mess-design-2026-11-12.md on main, rule 3 ("what it cannot take back is counted and handed on, never
// silently left"). PURE but for the sink's injected file calls: nothing here imports a bot, a file or a clock.
//
// WHY. takeback-01 is live on the showcase. Measured there, 6 hours, town and margin: 951 walking placements; 828 receipts closed --
// dug 305 (37%), adopted or gone 138, kept for reuse 56, and LEFT why=expired 297 (36%): the bot walked out of reach and the receipt
// ran out with the block still standing. The only way such a block reached the grounds crew was the climbs ledger (placeaudit.mjs
// climbOf -> roughground.mjs surveyRough SCAFFOLD), which takes a ledgered block only where it stands ABOVE the ground round it and
// only in the surface band: a dirt step against a rise, the foot of a pillar, a bridge over a trench read as terrain and stay.
//
// WHAT.
//   THE HAND-OFF (the bot that placed the block): a receipt that closes `left` with why `expired` or `unseen`, in zone `town` or
//     `margin`, becomes an entry { at: [x, y, z], block, t, shape } in this bot's own file in the town's directory
//     (`litter-<bot>.json`, buildproj.mjs litterWrite: a temp file renamed into place). Bounded: LITTER.maxEntries, the oldest
//     dropped; an entry older than LITTER.keepMs is dropped. The write is queued and made off the walk (litterSink).
//   AN ENTRY IS BELIEVED FOR THREE HOURS (review r1, Codex 1; LITTER.keepMs). An entry says "this bot placed <block> at this cell";
//     the intake can only read the cell's NAME. Once the handed block is gone and ground has been put back in the same cell, the
//     name is the same (and dirt that greened reads as the ground round it): the name alone cannot tell the handed block from its
//     replacement. So the claim is believed only while it is fresh: the intake runs hourly, three hours gives an entry at least two
//     surveys, and an older one is dropped unread (`old`) -- by the owner's next write, and by the intake whatever the file says.
//   THE INTAKE (the keeper's survey: tidy.mjs siteStage -> roughIn -> roughground.mjs surveyRough `litter`, so the hourly refresh of
//     an open record, a stage's siting and a country band's siting all take it): an entry is a cut of the survey -- EXACTLY its cell --
//     when the survey's own column rule lets a ledgered scaffold be cut there (surveyRough `refuse`: the box, the yard and tree farm,
//     a reservation, the plan, a zone, a column already worked; never a record cell or its column) and litterVerdict says take.
//     A cell on another project's own dig list (its `clear` or `cut`) is that project's too (litterClaimed).
//     The cut rides the survey into the record (tidyrefresh.mjs refreshMerge: never a busy column, a guarded or a named cell) and is
//     dug by the visit's own cut path (buildrun.mjs `p.tidy`: the `_build op=clear kind=tidy` row a surveyed pillar logs).
//   NOTHING IS FOLDED OVER AN UNREADABLE RECORD (review r1, Codex 2; litterIntake): skills.mjs projectHeads skips a head it cannot
//     read, so a project whose record is unreadable loses its cells at every reader built on it. The intake first reads every
//     guarded project STRICTLY (tempstand.mjs otherCellsStrict: it throws when a head is not ok or its newest generation is
//     rejected); when that throws the survey gets NO entry (`_litter op=dropped why=records_unread`), and they wait for the next.
//   BUILT ON, AGAIN AT THE DIG (review r1, Codex 3; handedBare): a cut that came from the hand-off carries `handed: 1` on the
//     record, and the visit reads the cell over it immediately before the dig (skills.mjs `tidyOk`, which buildrun.mjs asks before
//     the walk and again after it): anything but air there and the cut is not dug in that visit -- it waits as a cut beside water
//     waits (runVisit `tidyWet`), is counted toward the crew's give-up, and is named (`_litter op=dropped why=built_on_at_dig`).
//     A handed pillar is dug top first, so the block under a handed block is bare by the time it is asked.
//   NEVER TAKEN (litterVerdict, takeback.mjs verdictFor's reading at the intake): a cell that no longer holds the handed block
//     (`gone`, `changed`), a record's cell (`record`), a cell with anything but air on it that is not a handed block taken with it
//     (`built_on`), a block at or under the lowest ground round it (`in_ground`: it fills a hole the survey would fill again, or it
//     lies under the town), one out of a standing bot's reach (`high`), one with water or lava against it (`water`).
//   GREENED. Dirt beside grass turns to grass_block in minutes (Paper 11-07: 24 of 24 within 7.4 min), and the intake runs hourly:
//     LITTER.greens names that one change as the same block. The cut carries the name the cell reads NOW (the visit digs by name).
//
// WHO REMOVES AN ENTRY: ONLY ITS OWNER, BY AGE OR BY THE BOUND. The file has one writer (the bot it is named for); the intake only
// reads. So nothing races: an entry is read again at every survey until it is LITTER.keepMs (three hours) old. A folded entry reads `known` from
// then on (its cell is on the record); a dropped one is dropped again, and the `dropped` row counts it only the first time (entries
// handed since the record's last survey).
// ROWS: `_litter_mode` at install; `_litter op=handed` (the placing bot, at most one a LITTER.rowMs); `_litter op=folded` and
// `_litter op=dropped` (the keeper, one each a survey that read an entry); `_litter op=dropped why=records_unread` (a survey that
// folded nothing: a record could not be read); `_litter op=dropped why=built_on_at_dig` (a visit that left a handed cut standing).
// SWITCH: LITTER=off|0|false|no -> nothing written, nothing read, nothing folded.

export const LITTER = Object.freeze({
  whys: Object.freeze(['expired', 'unseen']),     // takeback's `left` reasons with the block still standing where the bot left it
  zones: Object.freeze(['town', 'margin']),       // placeaudit.mjs placeZone
  maxEntries: 256,                                // a bot's file
  keepMs: 3 * 60 * 60_000,                        // how long an entry is believed: at least two of the hourly surveys (the header)
  flushMs: 2_000, rowMs: 600_000,
  greens: Object.freeze({ dirt: 'grass_block' }),
  rowCells: 4,
})
/** THE SWITCH. Pure. */
export const litterOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.LITTER ?? '').trim())

const K = at => `${at[0]},${at[1]},${at[2]}`
const AIRY = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const tallyOf = o => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join(',') || '-'

/** IS A CLOSED RECEIPT HANDED ON? -> bool. Pure. r: takeback's receipt { cell, block, zone }; why: its `left` reason. */
export function handable (r, why, T = LITTER) {
  return !!r && T.whys.includes(String(why)) && T.zones.includes(String(r.zone)) && Array.isArray(r.cell) && r.cell.length === 3 &&
    r.cell.every(Number.isInteger) && typeof r.block === 'string' && r.block !== '' && r.block !== '?'
}
/** The entry a receipt becomes. Pure. */
export const litterEntry = (r, now) => ({ at: r.cell.slice(0, 3), block: r.block, t: now, shape: String(r.shape ?? '-') })
/** Is this a well-formed entry? Pure. */
export const entryOk = e => !!e && Array.isArray(e.at) && e.at.length === 3 && e.at.every(Number.isInteger) && typeof e.block === 'string' && e.block !== '' && Number.isFinite(e.t)
/**
 * THE FILE'S CONTENT FROM A LIST -> entries, oldest first. Pure. Malformed entries and those older than keepMs go; a cell handed twice
 * keeps its newest entry; past maxEntries the OLDEST are dropped.
 */
export function litterKeep (entries, now, T = LITTER) {
  const byCell = new Map()
  for (const e of [...(entries ?? [])].filter(e => entryOk(e) && now - e.t <= T.keepMs).sort((a, b) => a.t - b.t)) { byCell.delete(K(e.at)); byCell.set(K(e.at), { at: e.at.slice(0, 3), block: e.block, t: e.t, shape: String(e.shape ?? '-') }) }
  return [...byCell.values()].slice(-T.maxEntries)
}
/**
 * THE ENTRIES WITH ANOTHER PROJECT'S CLAIM MARKED -> entries (`claimed: true` on a cell any of `records` names: a cell it builds, a
 * block it clears or cuts itself). Pure. The survey's `cells` hold every record's build cells; this adds their dig lists, so a block
 * another project has listed is that project's (litterVerdict `record`).
 */
export function litterClaimed (entries, records = []) {
  const named = new Set()
  for (const r of records ?? []) for (const q of [...(r?.cells ?? []), ...(r?.clear ?? []), ...(r?.cut ?? [])]) if (Array.isArray(q?.at)) named.add(K(q.at))
  return named.size ? (entries ?? []).map(e => (Array.isArray(e?.at) && named.has(K(e.at)) ? { ...e, claimed: true } : e)) : (entries ?? [])
}
/** Does the cell still hold the handed block? -> 'same' | 'greened' | null. Pure. */
export function sameBlock (handed, name, T = LITTER) {
  if (name === handed) return 'same'
  return T.greens && Object.prototype.hasOwnProperty.call(T.greens, handed) && T.greens[handed] === name ? 'greened' : null
}
/**
 * WHAT THE INTAKE DOES WITH ONE ENTRY -> { v: 'take' | 'held' | 'dropped', why }. Pure. The column's own refusals (the survey's
 * `refuse`) are the caller's; this is the cell's reading, in takeback.mjs verdictFor's order.
 *   name        the block in the cell now (null: unread);  above  the block over it (null: unread)
 *   aboveTaken  the cell over it is a handed block this same survey takes (a pillar comes down from its top)
 *   record      a record or the plan names the cell;  spoil  the block is the bots' material (tidy.mjs SPOIL)
 *   ring        the ground heights of the columns round it that are not a record's;  reach  how far over them a bot digs
 *   wet         water or lava against it;  now  the survey's clock: an entry older than T.keepMs is `old`, whatever the cell reads
 * `held` is asked again at the next survey (nothing was read, or nothing is known yet); `dropped` is not the crew's.
 */
export function litterVerdict (e, { name = null, above = null, aboveTaken = false, record = false, spoil = true, ring = [], reach = Infinity, wet = false, now = null } = {}, T = LITTER) {
  if (Number.isFinite(now) && !(now - e.t <= T.keepMs)) return { v: 'dropped', why: 'old' }
  if (name == null) return { v: 'held', why: 'unread' }
  const same = sameBlock(e.block, name, T)
  if (!same) return { v: 'dropped', why: AIRY(name) ? 'gone' : 'changed' }
  if (record) return { v: 'dropped', why: 'record' }
  if (!spoil) return { v: 'dropped', why: 'not_spoil' }
  if (above == null) return { v: 'held', why: 'unread' }
  if (!AIRY(above) && !aboveTaken) return { v: 'dropped', why: 'built_on' }
  const hs = (ring ?? []).filter(Number.isFinite)
  if (!hs.length) return { v: 'held', why: 'unread' }
  if (e.at[1] <= Math.min(...hs)) return { v: 'dropped', why: 'in_ground' }
  if (e.at[1] - Math.max(...hs) > reach) return { v: 'dropped', why: 'high' }
  if (wet) return { v: 'dropped', why: 'water' }
  return { v: 'take', why: same }
}
/**
 * THE ENTRIES A SURVEY MAY FOLD -> { entries, unread: null | { n, why } }. Never throws. `read()` every bot's entries (buildproj.mjs
 * litterRead); `strict()` the guarded projects read strictly (tempstand.mjs otherCellsStrict: it THROWS when one cannot be read or its
 * newest generation is rejected). A strict read that throws: NO entry for this survey (`unread`: how many waited, and why). Else the
 * entries with the other records' claims marked (litterClaimed).
 */
export function litterIntake ({ read = () => [], strict = () => new Set(), records = [] } = {}) {
  let entries = []
  try { entries = read() ?? [] } catch { entries = [] }
  if (!entries.length) return { entries: [], unread: null }
  try { strict() } catch (e) { return { entries: [], unread: { n: entries.length, why: String(e?.message ?? e).replace(/\s+/g, '_').slice(0, 60) } } }
  return { entries: litterClaimed(entries, records), unread: null }
}
/**
 * AT THE DIG: MAY THIS CUT BE DUG NOW? -> bool. Pure over `read`. A cut that came from the hand-off (`handed` on the record's cut
 * entry) only while the cell over it reads AIR now -- something set on it since the survey is someone's, and an unread cell is no
 * evidence. Any other cut: true (the caller's other checks stand).
 */
export function handedBare (cut, read) {
  if (!cut?.handed) return true
  const up = read(cut.at[0], cut.at[1] + 1, cut.at[2])
  return !!up && AIRY(String(up.name ?? '').replace(/\[.*\]$/, ''))
}
/** The handed cuts a visit left standing because something is on them now -> ["x,y,z"]. Pure. `waited`: runVisit's `tidyWet` keys. */
export function builtOnHeld (rec, waited = [], read = () => null) {
  const w = new Set(waited ?? [])
  return (rec?.cut ?? []).filter(c => c?.handed && w.has(K(c.at)) && !handedBare(c, read)).map(c => K(c.at))
}
export const unreadDetail = u => `op=dropped n=${u.n} why=records_unread record=${u.why}`
export const builtOnDetail = (keys, T = LITTER) => `op=dropped n=${keys.length} why=built_on_at_dig cells=${keys.slice(0, T.rowCells).join(';') || '-'}`
/**
 * THE INTAKE'S COUNT -> { read, seen, folded: [key], greened, known, held: { why: n }, dropped: { why: n }, old }. Pure.
 *   lit    { read, seen: [{ k, t, v, why }] }: the survey's verdicts (tidy.mjs siteStage `litter`)
 *   added  Set of the cut keys this publish ADDED to the record;  known  Set of the keys the record named before it
 *   since  the record's last survey: a `dropped` entry handed before it was counted then (`old`)
 * An entry is FOLDED when its cell is one of the added cuts, whichever rule of the survey cut it. A `take` the merge left out (its
 * column busy, its cell guarded) is held: `merge`.
 */
export function litterTally (lit, { added = new Set(), known = new Set(), since = 0 } = {}) {
  const out = { read: Number(lit?.read) || 0, seen: 0, folded: [], greened: 0, known: 0, held: {}, dropped: {}, old: 0 }
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1 }
  for (const s of lit?.seen ?? []) {
    out.seen++
    if (added.has(s.k)) { out.folded.push(s.k); if (s.why === 'greened') out.greened++ } else if (known.has(s.k)) out.known++
    else if (s.v === 'take') bump(out.held, 'merge')
    else if (s.v === 'held') bump(out.held, s.why)
    else if (!(s.t > since)) out.old++
    else bump(out.dropped, s.why)
  }
  return out
}
/** The `_litter` rows' details. Pure. */
export const handedDetail = ({ n = 0, by = {}, open = 0, written = 0, failed = 0 } = {}) => `op=handed n=${n} why=${tallyOf(by)} open=${open} written=${written} failed=${failed}`
export function foldedDetail (ty, { where = '-', gen = null, T = LITTER } = {}) {
  const cells = ty.folded.slice(0, T.rowCells).join(';') || '-'
  return `op=folded n=${ty.folded.length} why=${where} read=${ty.read} seen=${ty.seen} known=${ty.known} greened=${ty.greened} old=${ty.old} held=${tallyOf(ty.held)} cells=${cells}${gen == null ? '' : ` gen=${gen}`}`
}
export const droppedDetail = ty => `op=dropped n=${Object.values(ty.dropped).reduce((a, b) => a + b, 0)} why=${tallyOf(ty.dropped)}`
/** The intake's rows -> [{ status, detail }]: `folded` whenever an entry was read (its `read` is the denominator), `dropped` when any
 *  was. Pure. */
export function intakeRows (ty, opts = {}) {
  if (!ty || !(ty.read > 0)) return []
  const rows = [{ status: ty.folded.length ? 'success' : 'no_effect', detail: foldedDetail(ty, opts) }]
  if (Object.keys(ty.dropped).length) rows.push({ status: 'no_effect', detail: droppedDetail(ty) })
  return rows
}

// one state a file: a bot that reconnects installs again, and two writers of one file would race
const SINKS = new Map()
/**
 * THE HAND-OFF'S SINK for one bot -> { left, flush, final, state } | null (LITTER=off, or nowhere to write). Never throws.
 *   dir, holder   the town's directory and the bot's name (its file)
 *   io            { read(dir, holder) -> entries | null, write(dir, holder, entries, { now }) -> bool }, both async (buildproj.mjs)
 *   emit(kind, status, detail)   one row;  timers  false in tests (the caller flushes)
 * `left(r, why)` is takeback.mjs `onLeft`: synchronous, memory only; the file is written LITTER.flushMs later, whole, off the walk.
 */
export function litterSink ({ dir, holder, io, emit = () => {}, now = () => Date.now(), env = process.env, T = LITTER, timers = true, shared = SINKS } = {}) {
  const on = litterOn(env)
  try { emit('litter_mode', 'success', `phase=mode v=1 on=${on ? 1 : 0} max=${T.maxEntries} keep_h=${Math.round(T.keepMs / 360_000) / 10} whys=${T.whys.join('+')}`) } catch { /* telemetry */ }
  if (!on || !dir || !holder || typeof io?.write !== 'function') return null
  const key = `${dir}\n${holder}`
  if (!shared.has(key)) shared.set(key, { entries: [], loaded: false, dirty: false, busy: false, again: false, timer: null, rowTimer: null, sum: { n: 0, by: {} }, written: 0, failed: 0 })
  const st = shared.get(key)
  st.emit = emit   // the newest install's (a reconnected bot's rows carry its own snapshot; the timers below outlive an install)
  const row = () => {
    if (!st.sum.n) return
    const s = st.sum
    st.sum = { n: 0, by: {} }
    try { st.emit('litter', 'success', handedDetail({ n: s.n, by: s.by, open: st.entries.length, written: st.written, failed: st.failed })) } catch { /* telemetry */ }
  }
  const flush = async () => {
    if (st.busy) { st.again = true; return false }
    st.busy = true
    let ok = false
    try {
      // this bot's entries from before a restart, once (an unreadable file reads empty: the entries handed since are kept)
      if (!st.loaded) { let old = null; try { old = typeof io.read === 'function' ? await io.read(dir, holder) : null } catch { old = null } st.entries = litterKeep([...(old ?? []), ...st.entries], now(), T); st.loaded = true }
      if (st.dirty) {
        st.dirty = false
        st.entries = litterKeep(st.entries, now(), T)
        try { ok = !!(await io.write(dir, holder, st.entries, { now: now() })) } catch { ok = false }
        if (ok) st.written++; else { st.failed++; st.dirty = true }
      }
    } catch { /* the hand-off is best effort */ } finally { st.busy = false }
    if (st.again) { st.again = false; if (st.dirty) return flush() }
    return ok
  }
  const left = (r, why) => {
    try {
      if (!handable(r, why, T)) return false
      st.entries = litterKeep([...st.entries, litterEntry(r, now())], now(), T)
      st.sum.n++; st.sum.by[why] = (st.sum.by[why] ?? 0) + 1
      st.dirty = true
      if (timers && !st.timer) { st.timer = setTimeout(() => { st.timer = null; void flush() }, T.flushMs); st.timer.unref?.() }
      if (timers && !st.rowTimer) { st.rowTimer = setInterval(row, T.rowMs); st.rowTimer.unref?.() }
      return true
    } catch { return false }
  }
  const final = () => {
    try { row() } catch { /* telemetry */ }
    try { if (st.rowTimer) { clearInterval(st.rowTimer); st.rowTimer = null } } catch { /* gone */ }
    try { if (st.dirty) void flush() } catch { /* best effort */ }
  }
  return { left, flush, row, final, state: st }
}
