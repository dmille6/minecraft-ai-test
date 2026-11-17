// WORKLIST-01 (worklist-01show; owner 11-16: "split that up between bots and lists, and let them work where they all can work
// because they all have different lists to work on ... this bot list idea could spread to other projects"). PURE: the switch, the
// file's checks, the work a visit takes from a list, the record it publishes, the visit's report. Nothing here touches a bot, a file
// or the world; skills.mjs worklistVisit wires it (the water walk's shape: boardwalk.mjs + waterWalkVisit).
//
// WHY. Twelve bots work one tidy record, and its cuts go through ONE lease (buildrun.mjs `seg-clear`): one bot digs, the others
// wait or fill. LIVE showcase 11-16, 8 h: 47 tidy visits, 0 cuts dug, 493 of 2,432 still standing (tidyflow.mjs header). The
// scar meter (scripts/host/scarmeter.py) lists thousands of blocks no survey of the bots reaches.
//
// WHAT. The HOST writes one file a bot into the town's directory, `worklist-<bot>.json` (scripts/host/worklists.py: the scar
// meter's cells, the scarjobs rules, one contiguous area a bot, a strip of columns between two bots' areas):
//     { v: 1, kind: 'worklist', project: 'tidy', bot, home: [x, y, z], issued, saved, expires, area, jobs: [job] }
//   a JOB, the fields every kind has:  { id, kind, at: [x, y, z], after: [ids], ... }
//     remove   + block          dig the block of that name out of the cell (this piece)
//     fill / place  + block (or role), support     plant  + item     haul  + item, n, from, to     (later pieces: read, never worked)
// The bot whose name the file carries works ITS list in a record of its own (key `worklist-<bot>`: its own slot and its own cut
// lease), through the real visit (buildrun.mjs runVisit, the cut path `p.tidy`). So four bots with four lists dig at once.
//
// THE LIST IS ADVICE. The bot reads every block again before it acts:
//   THE FILE is refused WHOLE (listCheck): another bot's, another home's, an unknown project, past its `expires`, a save older than
//     WORKLIST.maxAgeMs or from the future, more than WORKLIST.maxJobs jobs, one malformed job.
//   A JOB is worked only when (listWork) the cell reads the listed block NOW (dirt that greened is the same block; anything else:
//     `gone`), the block is the project's to remove (tidy: tidy.mjs SPOIL -- never natural stone, whatever the list says:
//     `not_spoil`), no record names the cell (`record`: every project's cells, the tidy's fills, bridges, markers -- read strictly,
//     and again before each dig), it is in no protected zone (`zone`) and no sited building's claim (`claim`), the cell is read
//     (`unread`), and every job it comes `after` is done or is dug before it in this visit (`blocked`: a block is never dug from
//     under one that stays). At the dig the visit asks again (skills.mjs `tidyOk`): the guard fresh, water beside the cell
//     (`water`), a body on it (`body`), the bot's own footing (`footing`); the dig itself is by name (buildrun.mjs digNamed).
//   A job this bot's visits evaluated WORKLIST.tries times with the block still standing is passed over by this bot (`given`) until
//     the host takes it off the list -- the remedy is the host's: its rebalance moves a job refused or unreached twice to its
//     `later` list (another method: a scaffold, the water walk), and a new file without the job ends the wait.
// A list with nothing to dig is no visit: the bot's order goes on to the shared tidy record (what only the bots' survey finds).
//
// ROWS: `_worklist op=visit` one a visit that read a list (the host's 15-minute rebalance reads it: done / gone / refused by why /
// unreachable / left, and the job ids, refusals first); `_worklist op=refused` when a file is refused whole (once a file);
// `_build op=clear project=worklist-<bot> kind=tidy` a block dug (the visit's own row).
// SWITCH: WORKLIST=off|0|false|no -> no lane: no file is read, the order is the shared record's as before.

import { SPOIL } from './tidy.mjs'
import { idRows } from './overseer.mjs'   // overseer-01show: the id rows' one codec (the host reads them back with parseIdRow)

export const WORKLIST_KINDS = Object.freeze(['remove', 'fill', 'place', 'plant', 'haul'])
export const WORKLIST = Object.freeze({
  maxAgeMs: 3 * 60 * 60_000,      // the save a list was made from is believed this long (the hand-off's life: litter.mjs LITTER.keepMs)
  skewMs: 60_000, maxJobs: 400,
  cutsPerVisit: 24, minVisitMs: 45_000, walkR: 136,
  tries: 3,                       // evaluated visits before this bot passes a job over (tidy.mjs TIDY_CUT_TRIES)
  does: Object.freeze(['remove']),
  rowMax: 300, idMax: 14,
})
/** What a project lets a list remove: the block names. tidy: the bots' own material only. A project not named here: the file is refused. */
export const WORKLIST_PROJECTS = Object.freeze({ tidy: Object.freeze({ remove: SPOIL }) })
/** THE SWITCH: WORKLIST=off|0|false|no -> off; on by default. Pure. */
export const worklistOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.WORKLIST ?? '').trim())
/** overseer-01show: THE TOWN'S SWITCH FILE. While `worklist.OFF` stands in the town's directory no bot reads a list or an order (the
 *  host's dry mode also removes the lists; this one acts at once, whatever the host does). */
export const WORKLIST_OFF_FILE = 'worklist.OFF'
export const WORKLIST_FILE_RE = /^worklist-[A-Za-z0-9_-]+\.json$/
/**
 * r1 C1: THE CELLS ON ANY BOT'S LIST NOW -> Set("x,y,z"). Pure. Every list file of this home not past its `expires` (any bot's,
 * this one's too): the shared record's draw never takes such a cell, so two bots under two leases never dig one cell.
 */
export function listedCells (docs = [], { home, now = Date.now() } = {}) {
  const out = new Set()
  for (const d of docs) {
    if (!d || d.v !== 1 || d.kind !== 'worklist' || !Array.isArray(d.jobs) || !Number.isFinite(d.expires) || now > d.expires) continue
    if (!home || !isInt3(d.home) || d.home[0] !== Math.floor(home.x) || d.home[1] !== Math.floor(home.y) || d.home[2] !== Math.floor(home.z)) continue
    for (const j of d.jobs) if (isInt3(j?.at)) out.add(K(j.at))
  }
  return out
}

const safe = s => String(s).replace(/[^A-Za-z0-9_-]/g, '_')
/** The bot's file in the town's directory, and its record's plot (the key is buildproj.mjs projKey(home, plot)). Pure. */
export const worklistFile = bot => `worklist-${safe(bot)}.json`
export const worklistPlot = bot => `worklist-${safe(bot)}`
const K = at => `${at[0]},${at[1]},${at[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const DIRT = /^(dirt|coarse_dirt|rooted_dirt|grass_block)$/
const isInt3 = a => Array.isArray(a) && a.length === 3 && a.every(Number.isInteger)

/** Is this a well-formed job? Pure. Every kind: an id, a known kind, a cell, `after` a list of ids when present; remove: its block. */
export function jobOk (j) {
  if (!j || typeof j.id !== 'string' || !j.id || j.id.length > 40 || /\s/.test(j.id) || !WORKLIST_KINDS.includes(j.kind) || !isInt3(j.at)) return false
  if (j.after != null && !(Array.isArray(j.after) && j.after.every(a => typeof a === 'string'))) return false
  if (j.kind === 'remove' && (typeof j.block !== 'string' || !j.block)) return false
  return true
}
/**
 * THE FILE'S CHECKS -> { ok, why, jobs, project, issued }. Pure. Refused WHOLE: no file, a wrong version or kind, another bot's,
 * another home's, a project this code does not know, past `expires`, a save older than maxAgeMs or further than skewMs ahead of
 * this clock, too many jobs, a malformed job, two jobs with one id.
 */
export function listCheck (doc, { bot, home, now = Date.now(), T = WORKLIST, projects = WORKLIST_PROJECTS } = {}) {
  const no = why => ({ ok: false, why, jobs: [], project: null, issued: null })
  if (!doc || typeof doc !== 'object') return no('no_file')
  if (doc.v !== 1 || doc.kind !== 'worklist' || !Array.isArray(doc.jobs)) return no('malformed')
  if (String(doc.bot) !== String(bot)) return no('other_bot')
  if (!isInt3(doc.home) || !home || doc.home[0] !== Math.floor(home.x) || doc.home[1] !== Math.floor(home.y) || doc.home[2] !== Math.floor(home.z)) return no('other_home')
  if (!Object.prototype.hasOwnProperty.call(projects, String(doc.project))) return no('project')
  const { issued, saved, expires } = doc
  if (![issued, saved, expires].every(Number.isFinite)) return no('malformed')
  if (now > expires) return no('expired')
  if (now - saved > T.maxAgeMs || saved - now > T.skewMs || issued - now > T.skewMs) return no('stale')
  if (doc.jobs.length > T.maxJobs) return no('too_many')
  const ids = new Set()
  for (const j of doc.jobs) { if (!jobOk(j) || ids.has(j.id)) return no('malformed'); ids.add(j.id) }
  return { ok: true, why: 'ok', jobs: doc.jobs, project: String(doc.project), issued }
}

/**
 * THE WORK OF ONE VISIT -> { cuts, status }. Pure over `read`.
 *   cuts     [{ at, kind: 'tidy', name, id }] in the list's order: the blocks to dig (name: what stands there NOW)
 *   status   Map id -> 'cut' | 'gone' | 'unread' | 'record' | 'zone' | 'claim' | 'not_spoil' | 'blocked' | 'given' | 'unsupported'
 * guard(k) a record names the cell; zone(at) a protected zone holds it; claim(at) a sited building's claim does; given(id) this
 * bot passed the job over; rule: the project's (WORKLIST_PROJECTS). A job `after` another is worked only when that one is gone
 * (or not on the list any more: the host closed it) or is a cut earlier in this same list.
 */
export function listWork (jobs, read, { guard = () => false, zone = () => false, claim = () => false, given = () => false, rule = WORKLIST_PROJECTS.tidy, T = WORKLIST } = {}) {
  const status = new Map(), cuts = []
  for (const j of jobs ?? []) {
    const say = s => { status.set(j.id, s) }
    if (!T.does.includes(j.kind)) { say('unsupported'); continue }
    const b = read(...j.at)
    if (!b) { say('unread'); continue }
    const n = nm(b)
    if (!(n === j.block || (DIRT.test(n) && DIRT.test(j.block)))) { say('gone'); continue }
    if (!rule.remove.test(n)) { say('not_spoil'); continue }
    if (guard(K(j.at))) { say('record'); continue }
    if (zone(j.at)) { say('zone'); continue }
    if (claim(j.at)) { say('claim'); continue }
    if ((j.after ?? []).some(a => status.has(a) && !['cut', 'gone'].includes(status.get(a)))) { say('blocked'); continue }
    if (given(j.id)) { say('given'); continue }
    say('cut'); cuts.push({ at: j.at.slice(0, 3), kind: 'tidy', name: n, id: j.id })
  }
  return { cuts, status }
}

/** THE RECORD the visit publishes under the bot's own key (the fence's generation; no cells: a removal list builds nothing). `listed`
 *  carries every remove job's cell and block, as the water walk's record does (boardwalk.mjs bw3RecordBody); `sig` moves with the
 *  file. Pure. */
export function listRecordBody (chk, { home, bot, now = Date.now() } = {}) {
  const listed = (chk?.jobs ?? []).filter(j => j.kind === 'remove').map(j => [j.at[0], j.at[1], j.at[2], j.block])
  return {
    v: 1, blueprint: 'worklist@1', plot: worklistPlot(bot), home: { x: home.x, y: home.y, z: home.z }, by: bot ?? null,
    cells: [], clear: [], cut: listed.map(q => ({ at: q.slice(0, 3), kind: 'tidy', name: q[3] })), replant: [], segments: [], zones: [],
    listed, project: chk?.project ?? null, sig: `${chk?.issued ?? 0}:${listed.length}`, builders_max: 1, structure_complete: false, sitedAt: now,
  }
}

/**
 * THE VISIT'S REPORT -> { n, done, gone, refused: { why: n }, unreachable, left, ids: { done, gone, refused, unreachable } }. Pure.
 *   status    listWork's map (before the visit);  cuts  its cuts
 *   standing(cut) -> bool: the block still stands AFTER the visit (unread = standing)
 *   tidied    runVisit's `tidied` keys (a stand was looked for);  waited  Map key -> why (the dig's own refusals: water, body, footing, record)
 * done: a cut whose block is gone now. refused: a job the list's checks or the dig's refused, by why. unreachable: a cut evaluated
 * with the block still standing and no refusal. left: a cut the visit never came to (its bound or its clock).
 */
export function visitReport ({ jobs = [], status = new Map(), cuts = [], standing = () => true, tidied = [], waited = new Map() } = {}) {
  const out = { n: jobs.length, done: 0, gone: 0, refused: {}, unreachable: 0, left: 0, ids: { done: [], gone: [], refused: [], unreachable: [] }, why: {} }
  const tried = new Set(tidied ?? []), cutOf = new Map(cuts.map(c => [c.id, c]))
  const refuse = (id, why) => { out.refused[why] = (out.refused[why] ?? 0) + 1; out.ids.refused.push(id); out.why[id] = why }
  for (const j of jobs) {
    const s = status.get(j.id)
    if (s === 'gone') { out.gone++; out.ids.gone.push(j.id); continue }
    if (s !== 'cut') { if (s) refuse(j.id, s); continue }
    const c = cutOf.get(j.id), k = K(c.at)
    if (!standing(c)) { out.done++; out.ids.done.push(j.id) } else if (waited.has(k)) refuse(j.id, waited.get(k)); else if (tried.has(k)) { out.unreachable++; out.ids.unreachable.push(j.id) } else out.left++
  }
  return out
}
const tally = o => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join(',') || '-'
/**
 * THE ROW -> the detail string, never longer than T.rowMax (the logger keeps 300). The counts always; then the job ids while they
 * fit, the ones the host must act on first: r (refused), u (unreachable), g (gone), d (done); `more` = ids left out.
 */
export function worklistDetail ({ op = 'visit', issued = 0, rep = null, cleared = 0, stop = '-', why = '' } = {}, T = WORKLIST) {
  if (op !== 'visit' || !rep) return `op=${op} list=${issued} why=${String(why).replace(/\s+/g, '_').slice(0, 80) || '-'}`
  let s = `op=visit list=${issued} n=${rep.n} done=${rep.done} gone=${rep.gone} refused=${tally(rep.refused)} unreachable=${rep.unreachable} left=${rep.left} cleared=${cleared} stop=${String(stop).replace(/\s+/g, '_').slice(0, 24)}`
  const all = [['r', rep.ids.refused], ['u', rep.ids.unreachable], ['g', rep.ids.gone], ['d', rep.ids.done]].flatMap(([t, ids]) => ids.map(id => `${t}:${id}`))
  const fit = []
  let len = s.length + ' ids='.length + ' more=9999'.length
  for (const x of all) { if (fit.length >= T.idMax || len + x.length + 1 > T.rowMax) break; fit.push(x); len += x.length + 1 }
  if (fit.length) s += ` ids=${fit.join(';')}`
  if (all.length > fit.length) s += ` more=${all.length - fit.length}`
  return s
}
/** Is a visit's report worth a row again? -> the signature a caller keeps: the same list with the same counts says nothing new. Pure. */
export const reportSig = (issued, rep) => `${issued}:${rep.done}:${rep.gone}:${tally(rep.refused)}:${rep.unreachable}:${rep.left}`
/** overseer-01show: a visit's report -> the `_worklist op=ids` rows' details (every id, its outcome, a refusal's why; each row within
 *  the logger's 300). The host's overseer reads them back (overseer.mjs parseIdRow). Pure. */
export const worklistIdRows = (rep, issued) => idRows(rep, { issued, rowMax: WORKLIST.rowMax })
/**
 * overseer-01show: THE OVERSEER'S ORDER in this bot's file -> { id, why } | null. Pure. Only from a file listCheck accepts (this bot's,
 * this home's, fresh), only `unstick`, and only once (`done(id)`: this bot already acted on it).
 */
export function unstickOf (doc, { bot, home, now = Date.now(), done = () => false, T = WORKLIST } = {}) {
  if (!listCheck(doc, { bot, home, now, T }).ok) return null
  const o = doc.order
  if (!o || o.kind !== 'unstick' || typeof o.id !== 'string' || !o.id || o.id.length > 80 || done(o.id)) return null
  return { id: o.id, why: String(o.why ?? '').slice(0, 120) }
}
