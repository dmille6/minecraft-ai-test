#!/usr/bin/env node
// OVERSEER-01SHOW (owner 11-17, phase 1): ONE CYCLE of the host's overseer -- the I/O around bots/src/overseer.mjs overseerCycle (the
// one implementation of the rules). scripts/host/overseer.py runs it every 15 minutes (cron) with the telemetry it read; this reads
// the town's directory and the overseer's state, runs the cycle, and writes the bots' lists, the book and the set-aside list.
//
//   node overseer-cycle.mjs < input.json > summary.json
//   input: { now, home: [x, y, z], radius, pool, state, zones, live, scratch, bots: [{ name, online, pos: [x, y, z] }],
//            rows: [{ bot, t, detail }] (the `_worklist` rows of the last hours, any op) }
//
// SOURCES. The clean-up record's removals (`project-<home>.tidy`, its `cut` list -- scarjobs.py's entries reach it through the
// keeper's litter fold); every record's `cells` are the guard (a cell a project builds is never a removal); protected-zones.json.
// LIVE (input.live): `worklist-<bot>.json` into the town's directory, atomically; a bot with no list now has its old file removed.
// DRY: the lists go to `scratch`; the town's directory is never touched, except once when the switch goes off (stopLive: the
// lists the live book says it published are removed and the stop is recorded). Zones are required (no file: no cycle). The book is kept per mode (state/book.live.json, state/book.dry.json): a dry run's stalls never reach a live book.
// r6: the book is read with what is PUBLISHED on disk (publishedIds): a job on one bot's live list is listed to no other until
// that list is rewritten without it or expires (60 min) -- whatever crashed between the book and the lists. Reports are taken
// once by identity (readRows `seen`), never by a time cursor. Install conditions: overseer.py's header.
// overseer-02show: `dry: true` is the HARD dry run (overseer.py --dry, the test world's practice run): only the overseer's state
// (book.dry.json, setaside.json, decisions.jsonl) is written; overseer.py refuses to publish any staged write outside --state.
// Phase 1 is removals only within `radius` of home. Nothing here reads the world: the bot reads every block again before it digs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { overseerCycle, readRows, listLease, publishedIds, decisions, OVERSEER, OVERSEER_V1 } from '../../bots/src/overseer.mjs'
import { gradeTarget, GRADE } from '../../bots/src/gradetidy.mjs'
import { recordHead, projKey, leaseState } from '../../bots/src/buildproj.mjs'

const REC_KEY_RE = /^(project-[^.]+\.[^.]+)\.g\d+\.json$/   // a record generation (a lease or a slot has more dots)
export const LIST_RE = /^worklist-[A-Za-z0-9_-]+\.json$/
const safe = s => String(s).replace(/[^A-Za-z0-9_-]/g, '_')
export const listPlot = bot => `worklist-${safe(bot)}`         // worklist.mjs worklistPlot (the bot's own record)
export const listFile = bot => `worklist-${safe(bot)}.json`     // worklist.mjs worklistFile

function writeAtomic (file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(obj))
  fs.renameSync(tmp, file)
}
/**
 * r7: THE WRITES, direct or STAGED. With `stage` (a directory), nothing is published here: every write goes to the stage and the
 * plan (writes and removals, in order) to <stage>/manifest.json, which overseer.py applies only after it has checked this
 * process's peak memory -- an over-cap cycle publishes nothing.
 */
export function makeIo (stage = null, run = null) {
  const lines = rows => rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
  if (!stage) return { write: writeAtomic, unlink: f => { try { fs.unlinkSync(f) } catch { /* gone */ } }, append: (f, rows) => { if (rows.length) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, lines(rows)) } }, finish: () => null }
  // r8: the stage is this run's own (stage/<run>): created fresh, never shared with another run
  if (fs.existsSync(stage)) throw new Error(`stage exists: ${stage}`)
  fs.mkdirSync(stage, { recursive: true })
  const plan = []
  return {
    write: (dest, obj) => { const src = path.join(stage, `${plan.length}.json`); writeAtomic(src, obj); plan.push({ op: 'write', dest, src }) },
    unlink: dest => { plan.push({ op: 'unlink', dest }) },
    // overseer-02show: rows appended to a log (the decision log) -- staged like a write, appended by overseer.py
    append: (dest, rows) => { if (!rows.length) return; const src = path.join(stage, `${plan.length}.jsonl`); fs.writeFileSync(src, lines(rows)); plan.push({ op: 'append', dest, src }) },
    finish: () => { writeAtomic(path.join(stage, 'manifest.json'), { v: 1, run, plan }); return plan.length },
  }
}
const readJ = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { if (e?.code === 'ENOENT') return dflt; throw e } }

/**
 * The town directory's readings -> { cells, guard, keys, onRecord, excluded } | throws (an unreadable record is no cycle: nothing
 * is written).
 *
 * overseer-02show, THE POOL AS THE SHOWCASE STACK WRITES IT (read on the test world's `_pool-showcase`, 11-19: tidy gen 198, 2,551
 * cuts). Phase 1 lists PLAIN REMOVALS only. A cut the clean-up record carries for another reason is not one, and stays with the
 * shared visit that knows how to do it:
 *   hollow    a crust over a hollow (dug with its fills: hollowClear, the grade's pairing)          -- 372 of 2,551 on 11-19
 *   plot      a site prep's cut (the keeper's, in layers)                                            -- 5
 *   teardown  a teardown (its order matters)                                                         -- 6
 *   handed    a handed litter cut (dug only while bare: handedBare, which the list visit does not make) -- 6
 *   waived    `rec.waived` names the cell (the town gave it up: no_stand, cover kept, ...)
 *   claimed   inside a `rec.claimed` box (a sited building's ground: tidy.mjs claimedAt)
 *   fillcol   its column is one `rec.fillcol.cols` is filling
 *   grade     its column is in the grade gate of <pool>/grade-target.json (gradetidy: a cut there waits for its cap)
 * `onRecord(key)`: is the cell still a plain removal the record offers? (overseer.mjs recheck closes a job `off_record` when not.)
 */
export function townReadings (pool, home) {
  const keys = new Set()
  for (const f of fs.readdirSync(pool)) { const m = REC_KEY_RE.exec(f); if (m) keys.add(m[1]) }
  const guard = new Set()
  for (const k of keys) {
    if (k.includes('.worklist-')) continue
    const h = recordHead(pool, k)
    if (!h.ok || (h.rejected?.length ?? 0) > 0) throw new Error(`record unreadable: ${k}`)
    for (const c of h.head?.rec?.cells ?? []) if (Array.isArray(c?.at)) guard.add(c.at.join(','))
  }
  const tk = projKey(home, 'tidy')
  const th = keys.has(tk) ? recordHead(pool, tk) : { ok: true, head: null }
  if (!th.ok) throw new Error('tidy record unreadable')
  const rec = th.head?.rec ?? null
  const excluded = { hollow: 0, plot: 0, teardown: 0, handed: 0, waived: 0, claimed: 0, fillcol: 0, grade: 0 }
  // a finished record's removals are done; an open one's `cut` entries are the removals still listed
  if (!rec || rec.structure_complete) return { cells: [], guard, keys, onRecord: () => false, excluded, cuts: 0 }
  const waived = rec.waived && typeof rec.waived === 'object' ? rec.waived : {}
  const claims = Object.entries(rec.claimed && typeof rec.claimed === 'object' ? rec.claimed : {})
    .filter(([, c]) => Array.isArray(c?.box) && c.box.length === 4).map(([plot, c]) => ({ plot, box: c.box }))
  const fillCols = new Set(Object.keys(rec.fillcol?.cols ?? {}))
  let gate = null
  const gf = path.join(pool, GRADE.file)
  if (fs.existsSync(gf)) {
    let raw
    try { raw = JSON.parse(fs.readFileSync(gf, 'utf8')) } catch (e) { throw new Error(`grade target unreadable: ${e?.message ?? e}`) }
    const g = gradeTarget(raw)
    if (!g.ok) throw new Error(`grade target refused: ${g.why}`)   // a gate we cannot read: no cycle (never list a cut it holds)
    gate = g.t.gate
  }
  const why = c => {
    const k = c.at.slice(0, 3).join(','), col = `${c.at[0]},${c.at[2]}`
    if (c.hollow) return 'hollow'
    if (c.plot) return 'plot'
    if (c.teardown) return 'teardown'
    if (c.handed) return 'handed'
    if (Object.prototype.hasOwnProperty.call(waived, k)) return 'waived'
    if (claims.some(q => c.at[0] >= q.box[0] && c.at[0] <= q.box[2] && c.at[2] >= q.box[1] && c.at[2] <= q.box[3])) return 'claimed'
    if (fillCols.has(col)) return 'fillcol'
    if (gate?.has(col)) return 'grade'
    return null
  }
  const cells = [], plain = new Set()
  const cuts = (rec.cut ?? []).filter(c => Array.isArray(c?.at) && c.at.length >= 3)
  for (const c of cuts) {
    const w = why(c)
    if (w) { excluded[w]++; continue }
    plain.add(c.at.slice(0, 3).join(','))
    cells.push({ at: c.at.slice(0, 3), block: c.name })
  }
  return { cells, guard, keys, onRecord: k => plain.has(k), excluded, cuts: cuts.length }
}

/** overseer-02show: the rules in force -> OVERSEER (02show), or OVERSEER_V1 (`{ base: 'v1' }`), with any listed value overridden. */
export function rulesOf (r = null) {
  const base = r?.base === 'v1' ? OVERSEER_V1 : OVERSEER
  const over = Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => k !== 'base' && k in OVERSEER))
  return { ...base, ...over }
}
const ruleSummary = T => ({ progressClock: T.progressClock, releaseMin: T.releaseMs / 60_000, unstickClock: T.unstickClock, unstickAfterMin: T.unstickAfterMs / 60_000,
  quarantine: `${T.quarantineFails}x${T.quarantineBots}`, quarantineTtlH: T.quarantineTtlMs / 3_600_000, quarantineOnRelease: T.quarantineOnRelease, requeueMax: T.requeueMax })
/** r1 C6: LIVE -> NOT LIVE. When the live book says lists were published, the town's list files are removed once and the book
 *  records when -> the number removed, or null (nothing was published: nothing in the town is touched). */
export function stopLive (inp, now, io = makeIo()) {
  const f = path.join(inp.state, 'book.live.json')
  const st = readJ(f, null)
  if (!st?.published) return null
  let n = 0
  for (const x of fs.readdirSync(inp.pool)) if (LIST_RE.test(x)) { io.unlink(path.join(inp.pool, x)); n++ }
  io.write(f, { ...st, published: false, stoppedAt: now, stoppedRemoved: n })
  return n
}
/** ONE CYCLE over the input -> the summary (and, unless `write` is false, the files written). */
export function runCycle (inp, { write = true } = {}) {
  const now = Number(inp.now) || Date.now()
  const home = { x: inp.home[0], y: inp.home[1], z: inp.home[2] }
  // overseer-02show: --dry (inp.dry) is a HARD dry run -- never live whatever the switch says, no list file written anywhere (the
  // decision log carries what the lists would hold), no published list read, and no stopLive: the town's directory is only read
  if (inp.dry && inp.live) throw new Error('dry and live both set')
  const mode = inp.live ? 'live' : 'dry'
  const bookFile = path.join(inp.state, `book.${mode}.json`)
  const st = readJ(bookFile, { v: 1, book: [], seen: [], givenAt: {}, unstuckAt: {} })
  // overseer-02show: the rules -- the 02show defaults, or the 01show ones (inp.rules.base 'v1'), with any value overridden
  const T = rulesOf(inp.rules)
  // r1 C4: the zones are REQUIRED -- no file, an unreadable one or one without a zone list is no cycle (protection never fails open)
  if (!inp.zones) throw new Error('zones: no --zones given')
  let zdoc = null
  try { zdoc = readJ(inp.zones, null) } catch (e) { throw new Error(`zones unreadable: ${inp.zones}: ${e?.message ?? e}`) }
  if (!zdoc || !Array.isArray(zdoc.zones)) throw new Error(`zones unreadable: ${inp.zones}`)
  const zones = zdoc.zones
  const { cells, guard, onRecord, excluded, cuts } = townReadings(inp.pool, home)
  const rr = readRows(inp.rows ?? [], { seen: st.seen ?? [], now })
  const holds = new Map()
  for (const j of st.book) if (j.state === 'open' && j.owner) holds.set(j.owner, true)
  // overseer-02show: workAt (any finished work) and actAt (any successful action) from the host's read; seenSince = when this book
  // first saw the bot (an unstick is never ordered on a clock the host has not watched)
  const firstSeen = { ...(st.firstSeen ?? {}) }
  for (const b of inp.bots ?? []) firstSeen[b.name] ??= now
  const bots = (inp.bots ?? []).map(b => ({ name: b.name, online: b.online !== false, pos: b.pos ?? null, rate: rr.stats[b.name]?.rate ?? 0,
    lastProgressAt: rr.stats[b.name]?.lastProgressAt ?? null, givenAt: st.givenAt?.[b.name] ?? now, unstuckAt: st.unstuckAt?.[b.name] ?? null,
    workAt: b.workAt ?? null, actAt: b.actAt ?? null, seenSince: firstSeen[b.name] }))
  for (const k of Object.keys(firstSeen)) if (!bots.some(b => b.name === k)) delete firstSeen[k]   // a bot that left starts afresh
  const leased = bot => { try { return leaseState(inp.pool, projKey(home, listPlot(bot)), listLease(bot))?.holdsUntil ?? 0 } catch { return 0 } }
  // r6: what is PUBLISHED now, read from disk (the truth after any crash) -- a job on one bot's live list is listed to no other
  const pubDir = inp.live ? inp.pool : inp.dry ? null : inp.scratch
  const pubDocs = []
  for (const f of pubDir && fs.existsSync(pubDir) ? fs.readdirSync(pubDir) : []) {
    if (!LIST_RE.test(f)) continue
    try { pubDocs.push(JSON.parse(fs.readFileSync(path.join(pubDir, f), 'utf8'))) } catch (e) { if (e?.code !== 'ENOENT') throw new Error(`published list unreadable: ${f}`) }
  }
  const onDisk = publishedIds(pubDocs, now)
  const c = overseerCycle({ onDisk, book: st.book, reports: rr.reports, cells, bots, zones, guard: k => guard.has(k), leased, home, radius: Number(inp.radius) || 128, now, onRecord, release: inp.release ?? null, needRows: inp.needRows ?? [], T })
  // overseer-02show: "needs material" is a project's label, kept in the book (first and last seen, the bots that said it)
  const needs = { ...(st.needs ?? {}) }
  for (const n of c.needs) { const x = (needs[n.project] ??= { since: now, n: 0, bots: [], why: n.why }); x.last = now; x.n++; if (!x.bots.includes(n.bot)) x.bots.push(n.bot) }
  // the clocks the next cycle needs: when a bot was first given work (since it last held none), when it was last sent `unstick`
  const givenAt = {}, unstuckAt = { ...(st.unstuckAt ?? {}) }
  for (const j of c.book) if (j.state === 'open' && j.owner) givenAt[j.owner] = holds.has(j.owner) ? (st.givenAt?.[j.owner] ?? now) : now
  for (const o of c.orders) unstuckAt[o.bot] = now
  // overseer-02show: THE DECISION LOG -- one row a decision, joinable to the bots' own skill rows by bot (their bot.name), time and
  // cell (`cell=x,y,z` in their build rows); in live, `list` is the `list=<issued>` their `_worklist` rows echo
  const iso = new Date(now).toISOString()
  const ctx = new Map((inp.bots ?? []).map(b => [b.name, b]))
  const dec = decisions(st.book, c.book, { orders: c.orders, lists: c.lists, bots, now, released: c.released, expired: c.expired, requeued: c.requeued, needs: c.needs, rules: c.rules, T }).map(d => ({ at: iso, run: inp.run ?? null, mode, ...d,
    ...(d.bot && ctx.has(d.bot) ? { bot_pos: ctx.get(d.bot).pos ?? null, bot_seen: ctx.get(d.bot).seen ? new Date(ctx.get(d.bot).seen).toISOString() : null, bot_online: ctx.get(d.bot).online !== false } : {}) }))
  const tally = {}
  for (const d of dec) tally[d.kind] = (tally[d.kind] ?? 0) + 1
  const summary = { at: now, mode, ...(inp.dry ? { dry: true } : {}), rules: ruleSummary(T), release: inp.release ?? null, needs, row: c.row, cuts, excluded, offered: cells.length, decisions: tally, lists: Object.fromEntries(Object.entries(c.lists).map(([b, d]) => [b, d.order ? `order:${d.order.kind}` : d.jobs.length])),
    orders: c.orders, reports: rr.reports.length, setAside: c.setAside.length }
  if (!write) return { summary, cycle: c }
  // r5: THE BOOK FIRST. A crash after it and before the lists leaves the old lists, which expire (listDoc: 30 min) -- and the
  // book's notBefore already guards every move; the other order could leave lists the book never knew it gave out.
  const io = makeIo(inp.stage ?? null, inp.run ?? null)
  io.write(bookFile, { ...(inp.live ? { published: Object.keys(c.lists).length > 0 || !!st.published } : {}), v: 1, book: c.book, seen: rr.seen, givenAt, unstuckAt, firstSeen, needs, at: now })
  io.append(path.join(inp.state, 'decisions.jsonl'), dec)
  if (inp.live) {
    for (const [b, d] of Object.entries(c.lists)) io.write(path.join(inp.pool, listFile(b)), d)
    // a list file this cycle did not write is removed: a bot with no list now
    for (const f of fs.readdirSync(inp.pool)) if (LIST_RE.test(f) && !Object.keys(c.lists).some(b => listFile(b) === f)) io.unlink(path.join(inp.pool, f))
  } else if (inp.dry) {
    // overseer-02show: HARD DRY -- nothing more: no list anywhere, no stop. Only the overseer's own state (book, set-aside, log).
  } else {
    // r1 C6: DRY NEVER WRITES TO OR DELETES FROM THE TOWN. The one exception is the switch going off: the live book says lists
    // were published, so they are removed ONCE and the live book records it; after that dry touches only scratch.
    summary.stopped = stopLive(inp, now, io)
    for (const [b, d] of Object.entries(c.lists)) io.write(path.join(inp.scratch, listFile(b)), d)
  }
  io.write(path.join(inp.state, 'setaside.json'), { v: 1, at: now, mode, n: c.setAside.length, jobs: c.setAside })
  summary.staged = io.finish()
  return { summary, cycle: c }
}

// overseer-02show: compared by REAL path -- run through a symlinked tree (the install's `tree` link, macOS /var) the plain paths differ
// and the cycle would silently do nothing (`node: no summary` on every cycle)
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const inp = JSON.parse(fs.readFileSync(0, 'utf8'))
  try { process.stdout.write(JSON.stringify(runCycle(inp).summary) + '\n') } catch (e) { process.stdout.write(JSON.stringify({ error: String(e?.message ?? e) }) + '\n'); process.exit(2) }
}
