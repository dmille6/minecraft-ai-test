// OVERSEER-01 (owner 11-17: "i want each bot to have a list of jobs to do, and every once in a while, a system or a mayor/overseer
// checks everyones list redistributes work, adds more work (from junk scans like this) and fixes issues where bots cant complete
// work or are stuck and stalled"). Design: docs/reports/overseer-design-2026-11-17.md.
//
// PURE. Nothing here reads a file, a bot or the world. The ONE writer is a host-side cycle (every OVERSEER.cycleMs) that loads the
// job book, the bots' visit reports and the scar meter's entries, calls overseerCycle, and writes the book back plus one list file a
// bot (worklist-01show's `worklist-<bot>.json`, listDoc below). A bot only READS its own list and reports; it never writes the book.
//
// NO SECOND LOCKING SCHEME. The book is a PARTITION: a cell is in at most one bot's list, a column (x, z) is never split between two
// bots (a pillar's jobs depend on each other top-down). The bot works its list under buildrun.mjs's existing clear-part lease
// (`clearPart = { lease: listLease(bot), has }`, the storehouse quadrants' mechanism) on its own record, so the one-holder-per-cell
// guarantee is the lease the visits already use. A job moved away from a bot is not handed on until that bot's lease could have
// lapsed (`notBefore`), so the old and new owners never overlap.
//
// THE JOB (one record a cell):
//   { id, kind, at: [x,y,z], block, src: { from, ref }, stand: [x,y,z]|null, owner: bot|null, notBefore: ms, state, why,
//     attempts: [{ bot, at, why }], avoid: [bot], added: ms, closedAt: ms|null }
//   state: open | done | gone | quarantined.  `from`: 'scar' | 'tidy' | ... (the record it came from), `ref` that record's key.

export const OVERSEER = Object.freeze({
  cycleMs: 15 * 60_000,
  leaseMs: 4 * 60_000 + 60_000,  // buildproj.mjs LEASE_TTL_MS + its reclaim: a moved job waits this long past the move
  rateFloor: 2,                  // jobs/h a bot with no measured rate is credited (a new bot still gets work)
  slack: 1.5,                    // rebalance when the slowest list's hours-to-finish > slack x the fastest's
  minMove: 3,                    // ...and it would move at least this many jobs
  maxMovesPerCycle: 60,
  maxList: 200,                  // a bot's list never holds more (WORKLIST.maxJobs is 400)
  quarantineFails: 3,            // a job failed this many times...
  quarantineBots: 2,             // ...by this many different bots -> quarantined with its commonest reason
  avoidAfter: 2,                 // one bot failing a job this many times -> it goes to another bot
  stallMs: 30 * 60_000,
  unstickMs: 10 * 60_000,        // a bot sent `unstick` is given no new work this long (the host passes `unstuckAt` back)          // a bot holding jobs with no progress this long -> its list is reassigned, it gets `unstick`
  intakeMax: 300,                // scar entries taken a cycle
  keepClosedMs: 24 * 60 * 60_000, // done / gone jobs kept this long so a scan does not re-add a cell just closed
})

const FAIL_NOT = new Set(['done', 'gone'])
export const cellKey = at => `${at[0]},${at[1]},${at[2]}`
export const colKey = at => `${at[0]},${at[2]}`
export const jobId = (kind, at) => `${kind === 'remove' ? 'r' : kind[0]}:${cellKey(at)}`
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[2] - b[2]))   // the larger axis, as the bots order work
const safe = s => String(s).replace(/[^A-Za-z0-9]/g, '')
/** The clear-part lease a bot's list is worked under (buildrun.mjs clearLeaseOf accepts /^seg-clear-[A-Za-z0-9]+$/). Pure. */
export const listLease = bot => `seg-clear-wl${safe(bot)}`

/** A new job from a cell. Pure. */
export function newJob ({ kind, at, block, from, ref = null, stand = null }, now) {
  return { id: jobId(kind, at), kind, at: at.slice(0, 3), block, src: { from, ref }, stand, owner: null, notBefore: 0, state: 'open', why: null, attempts: [], avoid: [], added: now, closedAt: null }
}

/** Is a cell inside a protected zone (protected-zones.json `box` [x0,y0,z0,x1,y1,z1])? Pure. */
export function inZone (at, zones = []) {
  return zones.some(z => { const b = z.box; return Array.isArray(b) && at[0] >= b[0] && at[0] <= b[3] && at[1] >= b[1] && at[1] <= b[4] && at[2] >= b[2] && at[2] <= b[5] })
}

/**
 * SCAR INTAKE -> { added: [job], skipped: { dup, zone, record, malformed, cap } }. Pure. `entries` the scar jobs file's
 * (scarjobs.py: { at, block, t, shape }); every job already in the book (ANY state: a quarantined or just-closed cell is not
 * re-added) is a dup; `guard(key)` a record names the cell; zones: protected-zones.json's.
 */
export function intakeScar (entries = [], book = [], { zones = [], guard = () => false, now = Date.now(), from = 'scar', home = null, radius = Infinity, T = OVERSEER } = {}) {
  const have = new Set(book.map(j => j.id)), added = [], skipped = { dup: 0, zone: 0, record: 0, malformed: 0, cap: 0, far: 0 }
  for (const e of entries) {
    const at = e?.at
    if (!Array.isArray(at) || at.length !== 3 || !at.every(Number.isInteger) || typeof e.block !== 'string' || !e.block) { skipped.malformed++; continue }
    const id = jobId('remove', at)
    if (have.has(id)) { skipped.dup++; continue }
    if (home && dist(home, at) > radius) { skipped.far++; continue }   // overseer-01show phase 1: the town's 128 blocks
    if (inZone(at, zones)) { skipped.zone++; continue }
    if (guard(cellKey(at))) { skipped.record++; continue }
    if (added.length >= T.intakeMax) { skipped.cap++; continue }
    have.add(id); added.push(newJob({ kind: 'remove', at, block: e.block, from, ref: e.shape ?? null }, now))
  }
  return { added, skipped }
}

/**
 * ONE ATTEMPT -> the job after it. Pure. why: 'done' | 'gone' closes it; anything else is a failure. A bot failing it
 * T.avoidAfter times is added to `avoid` and the job is unowned (another bot gets it). T.quarantineFails failures by
 * T.quarantineBots different bots -> quarantined, `why` the commonest reason (ties: the latest).
 */
export function recordAttempt (job, { bot, why, now = Date.now() }, T = OVERSEER) {
  const j = { ...job, attempts: [...job.attempts, { bot, at: now, why }], avoid: [...job.avoid] }
  if (why === 'done' || why === 'gone') return { ...j, state: why, owner: null, closedAt: now }
  const fails = j.attempts.filter(a => !FAIL_NOT.has(a.why))
  const byBot = fails.filter(a => a.bot === bot).length
  if (byBot >= T.avoidAfter && !j.avoid.includes(bot)) { j.avoid.push(bot); if (j.owner === bot) j.owner = null }
  const bots = new Set(fails.map(a => a.bot))
  if (fails.length >= T.quarantineFails && bots.size >= T.quarantineBots) {
    const n = new Map(); fails.forEach((a, i) => n.set(a.why, [(n.get(a.why)?.[0] ?? 0) + 1, i]))
    const top = [...n.entries()].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1])[0][0]
    return { ...j, state: 'quarantined', owner: null, why: `${top} x${fails.length} by ${bots.size} bots` }
  }
  return j
}

/**
 * A VISIT'S REPORT into the book -> the book. Pure. `rep.ids` is worklist-01show's visitReport shape: { done, gone, refused,
 * unreachable } (refused ids carry no per-id reason there; `whyOf(id)` may supply one, else 'refused'). Ids not in the book are ignored.
 */
export function ingestReport (book, bot, rep, { now = Date.now(), whyOf = () => null, T = OVERSEER } = {}) {
  const say = new Map()
  for (const id of rep?.ids?.done ?? []) say.set(id, 'done')
  for (const id of rep?.ids?.gone ?? []) say.set(id, 'gone')
  for (const id of rep?.ids?.refused ?? []) say.set(id, whyOf(id) ?? rep?.why?.[id] ?? 'refused')
  for (const id of rep?.ids?.unreachable ?? []) say.set(id, 'unreachable')
  return book.map(j => (say.has(j.id) && j.state === 'open' ? recordAttempt(j, { bot, why: say.get(j.id), now }, T) : j))
}

const open = (j, now) => j.state === 'open'
const weight = (b, T) => Math.max(Number(b.rate) || 0, T.rateFloor)

/**
 * SPLIT: give every open unowned job an owner -> the book. Pure. Whole columns only, a column to the nearest bot (to its body,
 * else its home) that is online, not avoided by any of the column's jobs, and under its share (total open x its rate weight,
 * at most T.maxList). A job with `notBefore` in the future, or a column part-owned already, waits.
 */
export function splitOpen (book, bots = [], { now = Date.now(), T = OVERSEER } = {}) {
  const live = bots.filter(b => b.online !== false)
  if (!live.length) return book
  const out = book.map(j => ({ ...j }))
  const openJobs = out.filter(j => open(j, now))
  const sumW = live.reduce((s, b) => s + weight(b, T), 0)
  const load = new Map(live.map(b => [b.name, 0]))
  for (const j of openJobs) if (j.owner && load.has(j.owner)) load.set(j.owner, load.get(j.owner) + 1)
  const cap = new Map(live.map(b => [b.name, Math.min(T.maxList, Math.ceil(openJobs.length * weight(b, T) / sumW))]))
  const cols = new Map()
  for (const j of openJobs) { const k = colKey(j.at); if (!cols.has(k)) cols.set(k, []); cols.get(k).push(j) }
  const todo = []
  for (const [k, js] of cols) {
    const owned = js.find(j => j.owner)
    if (owned) { for (const j of js) if (!j.owner && j.notBefore <= now && !j.avoid.includes(owned.owner)) { j.owner = owned.owner; load.set(owned.owner, (load.get(owned.owner) ?? 0) + 1) }; continue }
    if (js.some(j => j.notBefore > now)) continue
    todo.push([k, js])
  }
  const posOf = b => b.pos ?? b.home ?? [0, 0, 0]
  // nearest first: the column whose nearest bot is closest is placed first, so near work is never pushed out by far work
  const near = js => Math.min(...live.map(b => dist(posOf(b), js[0].at)))
  todo.sort((a, b) => near(a[1]) - near(b[1]) || (a[0] < b[0] ? -1 : 1))
  for (const [, js] of todo) {
    const avoid = new Set(js.flatMap(j => j.avoid))
    const pick = live.filter(b => !avoid.has(b.name) && load.get(b.name) < cap.get(b.name))   // under its share: the whole column (a share is a target, a column is never cut)
      .sort((a, b) => dist(posOf(a), js[0].at) - dist(posOf(b), js[0].at) || (a.name < b.name ? -1 : 1))[0]
    if (!pick) continue
    for (const j of js) j.owner = pick.name
    load.set(pick.name, load.get(pick.name) + js.length)
  }
  return out
}

/**
 * REBALANCE BY MEASURED RATE -> { book, moved }. Pure. hours(b) = its open jobs / its rate (jobs/h, floor T.rateFloor). While the
 * slowest exceeds T.slack x the fastest, move whole columns from the slowest to the fastest -- the donor's columns nearest the
 * receiver, never one the donor's lease holds (`leased(bot) -> until ms`; those wait) -- if at least T.minMove jobs would move.
 * A moved job carries `notBefore` = now + T.leaseMs: its new owner does not see it before the old one's lease has lapsed.
 */
export function rebalance (book, bots = [], { now = Date.now(), leased = () => 0, T = OVERSEER } = {}) {
  const live = bots.filter(b => b.online !== false)
  const out = book.map(j => ({ ...j }))
  let moved = 0
  for (let round = 0; round < 50 && moved < T.maxMovesPerCycle; round++) {
    const n = new Map(live.map(b => [b.name, 0]))
    for (const j of out) if (open(j, now) && n.has(j.owner)) n.set(j.owner, n.get(j.owner) + 1)
    const hrs = live.map(b => [b, n.get(b.name) / weight(b, T)]).sort((a, b) => b[1] - a[1] || (a[0].name < b[0].name ? -1 : 1))
    if (hrs.length < 2) break
    const [slow, hs] = hrs[0], [fast, hf] = hrs[hrs.length - 1]
    if (hs <= T.slack * Math.max(hf, 1 / weight(fast, T))) break
    // how many to move to even the two: x such that (ns - x)/ws = (nf + x)/wf
    const ws = weight(slow, T), wf = weight(fast, T)
    const want = Math.floor((n.get(slow.name) * wf - n.get(fast.name) * ws) / (ws + wf))
    if (want < T.minMove) break
    const cols = new Map()
    for (const j of out) if (open(j, now) && j.owner === slow.name) { const k = colKey(j.at); if (!cols.has(k)) cols.set(k, []); cols.get(k).push(j) }
    const fp = fast.pos ?? fast.home ?? [0, 0, 0]
    const order = [...cols.values()].filter(js => !js.some(j => j.avoid.includes(fast.name))).sort((a, b) => dist(fp, a[0].at) - dist(fp, b[0].at))
    let step = 0
    const until = Math.max(now, leased(slow.name) ?? 0) + T.leaseMs
    for (const js of order) {
      if (step + js.length > want || moved + js.length > T.maxMovesPerCycle) continue
      for (const j of js) { j.owner = fast.name; j.notBefore = until }
      step += js.length; moved += js.length
    }
    if (!step) break
  }
  return { book: out, moved }
}

/**
 * STALLS -> { book, orders }. Pure. A bot that holds open jobs and has made no progress (`lastProgressAt`: its last done/gone job,
 * or the time it was first given work) for T.stallMs: its jobs are released (owner null, notBefore past its lease) and it gets
 * one order { bot, order: 'unstick', why } -- the existing escape/crew_up path, deterministic, not advice. An offline bot's
 * jobs are released with no order.
 */
export function stalls (book, bots = [], { now = Date.now(), leased = () => 0, T = OVERSEER } = {}) {
  const orders = [], drop = new Map()
  const holds = new Map()
  for (const j of book) if (j.state === 'open' && j.owner) holds.set(j.owner, (holds.get(j.owner) ?? 0) + 1)
  for (const b of bots) {
    if (!holds.get(b.name)) continue
    if (b.online === false) { drop.set(b.name, 'offline'); continue }
    const since = Number(b.lastProgressAt ?? b.givenAt ?? now)
    if (now - since >= T.stallMs) { drop.set(b.name, 'no_progress'); orders.push({ bot: b.name, order: 'unstick', why: `no_progress ${Math.round((now - since) / 60_000)}m holding ${holds.get(b.name)}` }) }
  }
  // a bot no longer in the roster at all: its jobs are released too
  for (const [owner] of holds) if (!bots.some(b => b.name === owner)) drop.set(owner, 'gone')
  const out = book.map(j => (j.state === 'open' && drop.has(j.owner) ? { ...j, owner: null, notBefore: Math.max(now, leased(j.owner) ?? 0) + T.leaseMs } : j))
  return { book: out, orders }
}

/** Closed jobs older than T.keepClosedMs leave the book. Pure. */
export const prune = (book, now, T = OVERSEER) => book.filter(j => j.state === 'open' || j.state === 'quarantined' || now - (j.closedAt ?? now) < T.keepClosedMs)

/** A bot's list file (worklist-01show's v1 format; its listCheck refuses anything else). Pure. Only jobs it may start now. */
export function listDoc (book, bot, { home, now = Date.now(), saved = now, ttlMs = 2 * OVERSEER.cycleMs, project = 'tidy', order = null, T = OVERSEER } = {}) {
  const jobs = (order ? [] : book.filter(j => j.state === 'open' && j.owner === bot && j.notBefore <= now)).slice(0, T.maxList)
    .sort((a, b) => a.at[0] - b.at[0] || a.at[2] - b.at[2] || b.at[1] - a.at[1])     // a column top first
    .map(j => ({ id: j.id, kind: j.kind, at: j.at, ...(j.block ? { block: j.block } : {}) }))
  // a pillar's lower block comes after the one above it (the same column, the next y up, also on the list)
  const ids = new Set(jobs.map(j => j.id))
  for (const j of jobs) { const up = jobId(j.kind, [j.at[0], j.at[1] + 1, j.at[2]]); if (ids.has(up)) j.after = [up] }
  return { v: 1, kind: 'worklist', project, bot, home: [Math.floor(home.x), Math.floor(home.y), Math.floor(home.z)], issued: now, saved, expires: now + ttlMs, jobs,
    ...(order ? { order: { kind: order.order, id: `${order.order}:${bot}:${now}`, why: String(order.why ?? '').slice(0, 120) } } : {}) }
}

/**
 * THE CYCLE -> { book, lists, orders, row, setAside }. Pure. In order: reports in, intake (the clean-up record's removals `cells`,
 * then scar entries), stalls, split, rebalance, prune.
 *   reports [{ bot, rep }]   cells / scar: entries ({ at, block })   bots [{ name, online, pos, home, rate, lastProgressAt, givenAt, unstuckAt }]
 *   radius: phase 1 takes cells within this many blocks of `home` (the larger axis) only.
 * A stalled bot's list carries its `unstick` order and no jobs (overseer-01show: the bot reads the order from its own file).
 * The host stores each order's time as that bot's `unstuckAt`.
 */
export function overseerCycle ({ book = [], reports = [], cells = [], scar = [], bots = [], zones = [], guard = () => false, leased = () => 0, home, radius = Infinity, now = Date.now(), whyOf, T = OVERSEER } = {}) {
  let b = book
  for (const r of reports) b = ingestReport(b, r.bot, r.rep, { now, whyOf, T })
  const h3 = home ? [Math.floor(home.x), Math.floor(home.y), Math.floor(home.z)] : null
  const fromRec = intakeScar(cells, b, { zones, guard, now, from: 'tidy', home: h3, radius, T })
  b = [...b, ...fromRec.added]
  const intake = intakeScar(scar, b, { zones, guard, now, from: 'scar', home: h3, radius, T: { ...T, intakeMax: Math.max(0, T.intakeMax - fromRec.added.length) } })
  b = [...b, ...intake.added]
  const st = stalls(b, bots, { now, leased, T }); b = st.book
  const stalled = new Set(st.orders.map(o => o.bot))
  const workers = bots.filter(x => !stalled.has(x.name) && !(now - Number(x.unstuckAt ?? -Infinity) < T.unstickMs))
  b = splitOpen(b, workers, { now, T })
  const rb = rebalance(b, workers, { now, leased, T }); b = splitOpen(rb.book, workers, { now, T })
  b = prune(b, now, T)
  const lists = {}
  if (home) {
    for (const x of workers) if (x.online !== false) lists[x.name] = listDoc(b, x.name, { home, now, T })
    for (const o of st.orders) lists[o.bot] = listDoc(b, o.bot, { home, now, order: o, T })
  }
  const count = s => b.filter(j => j.state === s).length
  const added = fromRec.added.length + intake.added.length, sk = k => fromRec.skipped[k] + intake.skipped[k]
  const row = `op=cycle open=${count('open')} unowned=${b.filter(j => j.state === 'open' && !j.owner).length} quarantined=${count('quarantined')} added=${added} dup=${sk('dup')} zone=${sk('zone')} record=${sk('record')} far=${sk('far')} moved=${rb.moved} unstick=${st.orders.length} lists=${Object.keys(lists).length}`
  const setAside = b.filter(j => j.state === 'quarantined').map(j => ({ id: j.id, at: j.at, block: j.block, why: j.why, from: j.src?.from ?? null, tries: j.attempts.length }))
  return { book: b, lists, orders: st.orders, row, setAside }
}

// ---------------------------------------------------------------- THE REPORT'S WIRE FORMAT (overseer-01show)
// A bot's visit writes `_worklist op=ids list=<issued> ids=<t>:<id>[=<why>];...` rows (worklist.mjs, the bot side), as many as its
// report needs, each within the logger's 300 characters: t = d (done) | g (gone) | r (refused, its why) | u (unreachable). The host's
// cycle reads them back with parseIdRow. One codec, both directions, here.
export const ID_TAGS = Object.freeze({ done: 'd', gone: 'g', refused: 'r', unreachable: 'u' })
const TAG_OF = Object.freeze(Object.fromEntries(Object.entries(ID_TAGS).map(([k, v]) => [v, k])))
/** A refusal that says nothing about the job (it waits on another, or its chunk was not read): never reported as an attempt. */
export const NOT_AN_ATTEMPT = Object.freeze(new Set(['blocked', 'unread']))
/** A visit's report -> the id rows' details (each <= rowMax). Pure. `rep` = worklist.mjs visitReport's ({ ids, why }). */
export function idRows (rep, { issued = 0, rowMax = 300 } = {}) {
  const ent = []
  for (const [k, t] of Object.entries(ID_TAGS)) {
    for (const id of rep?.ids?.[k] ?? []) {
      const why = k === 'refused' ? String(rep?.why?.[id] ?? 'refused').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 24) : null
      if (why && NOT_AN_ATTEMPT.has(why)) continue
      ent.push(`${t}:${id}${why ? `=${why}` : ''}`)
    }
  }
  const head = `op=ids list=${Number(issued) || 0} ids=`, out = []
  let cur = []
  for (const e of ent) {
    if (head.length + e.length > rowMax) continue   // an id that can never fit (ids are capped at 40): dropped, not split
    if (cur.length && head.length + cur.join(';').length + 1 + e.length > rowMax) { out.push(head + cur.join(';')); cur = [] }
    cur.push(e)
  }
  if (cur.length) out.push(head + cur.join(';'))
  return out
}
/** An id row's detail -> { list, ids: { done, gone, refused, unreachable }, why: { id: why } } | null. Pure. */
export function parseIdRow (detail) {
  const m = /^op=ids list=(\d+) ids=(\S+)$/.exec(String(detail ?? '').trim())
  if (!m) return null
  const rep = { list: Number(m[1]), ids: { done: [], gone: [], refused: [], unreachable: [] }, why: {} }
  for (const e of m[2].split(';')) {
    const x = /^([dgru]):([^=;\s]+)(?:=([A-Za-z0-9_]+))?$/.exec(e)
    if (!x) continue
    const k = TAG_OF[x[1]]
    rep.ids[k].push(x[2])
    if (k === 'refused') rep.why[x[2]] = x[3] ?? 'refused'
  }
  return rep
}
/**
 * TELEMETRY ROWS -> { reports, stats, cursor }. Pure. rows [{ bot, t (ms), detail }] of the `_worklist` kind (any op); only rows
 * after `cursor` become reports (a row is ingested once); stats per bot over the last `windowMs`: rate = done+gone an hour,
 * lastProgressAt = its newest done/gone (from every row given, cursor or not).
 */
export function readRows (rows = [], { cursor = 0, now = Date.now(), windowMs = 2 * 60 * 60_000 } = {}) {
  const reports = [], stats = {}
  let top = cursor
  for (const r of [...rows].sort((a, b) => a.t - b.t)) {
    const rep = parseIdRow(r.detail)
    if (!rep || !r.bot) continue
    const s = (stats[r.bot] ??= { closed: 0, lastProgressAt: null })
    const n = rep.ids.done.length + rep.ids.gone.length
    if (n && now - r.t <= windowMs) s.closed += n
    if (n) s.lastProgressAt = Math.max(s.lastProgressAt ?? 0, r.t)
    if (r.t > cursor) { reports.push({ bot: r.bot, rep }); top = Math.max(top, r.t) }
  }
  for (const s of Object.values(stats)) s.rate = s.closed / (windowMs / 3_600_000)
  return { reports, stats, cursor: top }
}
