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
// Phase 1 is removals only within `radius` of home. Nothing here reads the world: the bot reads every block again before it digs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { overseerCycle, readRows, listLease, publishedIds } from '../../bots/src/overseer.mjs'
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
export function makeIo (stage = null) {
  if (!stage) return { write: writeAtomic, unlink: f => { try { fs.unlinkSync(f) } catch { /* gone */ } }, finish: () => null }
  fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true })
  const plan = []
  return {
    write: (dest, obj) => { const src = path.join(stage, `${plan.length}.json`); writeAtomic(src, obj); plan.push({ op: 'write', dest, src }) },
    unlink: dest => { plan.push({ op: 'unlink', dest }) },
    finish: () => { writeAtomic(path.join(stage, 'manifest.json'), { v: 1, plan }); return plan.length },
  }
}
const readJ = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { if (e?.code === 'ENOENT') return dflt; throw e } }

/** The town directory's readings -> { cells, guard, keys } | throws (an unreadable record is no cycle: nothing is written). */
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
  // a finished record's removals are done; an open one's `cut` entries are the removals still listed
  const cells = rec && !rec.structure_complete ? (rec.cut ?? []).filter(c => Array.isArray(c?.at)).map(c => ({ at: c.at.slice(0, 3), block: c.name })) : []
  return { cells, guard, keys }
}

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
  const mode = inp.live ? 'live' : 'dry'
  const bookFile = path.join(inp.state, `book.${mode}.json`)
  const st = readJ(bookFile, { v: 1, book: [], seen: [], givenAt: {}, unstuckAt: {} })
  // r1 C4: the zones are REQUIRED -- no file, an unreadable one or one without a zone list is no cycle (protection never fails open)
  if (!inp.zones) throw new Error('zones: no --zones given')
  let zdoc = null
  try { zdoc = readJ(inp.zones, null) } catch (e) { throw new Error(`zones unreadable: ${inp.zones}: ${e?.message ?? e}`) }
  if (!zdoc || !Array.isArray(zdoc.zones)) throw new Error(`zones unreadable: ${inp.zones}`)
  const zones = zdoc.zones
  const { cells, guard } = townReadings(inp.pool, home)
  const rr = readRows(inp.rows ?? [], { seen: st.seen ?? [], now })
  const holds = new Map()
  for (const j of st.book) if (j.state === 'open' && j.owner) holds.set(j.owner, true)
  const bots = (inp.bots ?? []).map(b => ({ name: b.name, online: b.online !== false, pos: b.pos ?? null, rate: rr.stats[b.name]?.rate ?? 0,
    lastProgressAt: rr.stats[b.name]?.lastProgressAt ?? null, givenAt: st.givenAt?.[b.name] ?? now, unstuckAt: st.unstuckAt?.[b.name] ?? null }))
  const leased = bot => { try { return leaseState(inp.pool, projKey(home, listPlot(bot)), listLease(bot))?.holdsUntil ?? 0 } catch { return 0 } }
  // r6: what is PUBLISHED now, read from disk (the truth after any crash) -- a job on one bot's live list is listed to no other
  const pubDir = inp.live ? inp.pool : inp.scratch
  const pubDocs = []
  for (const f of fs.existsSync(pubDir) ? fs.readdirSync(pubDir) : []) {
    if (!LIST_RE.test(f)) continue
    try { pubDocs.push(JSON.parse(fs.readFileSync(path.join(pubDir, f), 'utf8'))) } catch (e) { if (e?.code !== 'ENOENT') throw new Error(`published list unreadable: ${f}`) }
  }
  const onDisk = publishedIds(pubDocs, now)
  const c = overseerCycle({ onDisk, book: st.book, reports: rr.reports, cells, bots, zones, guard: k => guard.has(k), leased, home, radius: Number(inp.radius) || 128, now })
  // the clocks the next cycle needs: when a bot was first given work (since it last held none), when it was last sent `unstick`
  const givenAt = {}, unstuckAt = { ...(st.unstuckAt ?? {}) }
  for (const j of c.book) if (j.state === 'open' && j.owner) givenAt[j.owner] = holds.has(j.owner) ? (st.givenAt?.[j.owner] ?? now) : now
  for (const o of c.orders) unstuckAt[o.bot] = now
  const summary = { at: now, mode, row: c.row, lists: Object.fromEntries(Object.entries(c.lists).map(([b, d]) => [b, d.order ? `order:${d.order.kind}` : d.jobs.length])),
    orders: c.orders, reports: rr.reports.length, setAside: c.setAside.length }
  if (!write) return { summary, cycle: c }
  // r5: THE BOOK FIRST. A crash after it and before the lists leaves the old lists, which expire (listDoc: 30 min) -- and the
  // book's notBefore already guards every move; the other order could leave lists the book never knew it gave out.
  const io = makeIo(inp.stage ?? null)
  io.write(bookFile, { ...(inp.live ? { published: Object.keys(c.lists).length > 0 || !!st.published } : {}), v: 1, book: c.book, seen: rr.seen, givenAt, unstuckAt, at: now })
  if (inp.live) {
    for (const [b, d] of Object.entries(c.lists)) io.write(path.join(inp.pool, listFile(b)), d)
    // a list file this cycle did not write is removed: a bot with no list now
    for (const f of fs.readdirSync(inp.pool)) if (LIST_RE.test(f) && !Object.keys(c.lists).some(b => listFile(b) === f)) io.unlink(path.join(inp.pool, f))
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inp = JSON.parse(fs.readFileSync(0, 'utf8'))
  try { process.stdout.write(JSON.stringify(runCycle(inp).summary) + '\n') } catch (e) { process.stdout.write(JSON.stringify({ error: String(e?.message ?? e) }) + '\n'); process.exit(2) }
}
