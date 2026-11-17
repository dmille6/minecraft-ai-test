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
// Phase 1 is removals only within `radius` of home. Nothing here reads the world: the bot reads every block again before it digs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { overseerCycle, readRows, listLease } from '../../bots/src/overseer.mjs'
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
export function stopLive (inp, now) {
  const f = path.join(inp.state, 'book.live.json')
  const st = readJ(f, null)
  if (!st?.published) return null
  let n = 0
  for (const x of fs.readdirSync(inp.pool)) if (LIST_RE.test(x)) { try { fs.unlinkSync(path.join(inp.pool, x)); n++ } catch { /* gone */ } }
  writeAtomic(f, { ...st, published: false, stoppedAt: now, stoppedRemoved: n })
  return n
}
/** ONE CYCLE over the input -> the summary (and, unless `write` is false, the files written). */
export function runCycle (inp, { write = true } = {}) {
  const now = Number(inp.now) || Date.now()
  const home = { x: inp.home[0], y: inp.home[1], z: inp.home[2] }
  const mode = inp.live ? 'live' : 'dry'
  const bookFile = path.join(inp.state, `book.${mode}.json`)
  const st = readJ(bookFile, { v: 1, book: [], cursor: 0, givenAt: {}, unstuckAt: {} })
  // r1 C4: the zones are REQUIRED -- no file, an unreadable one or one without a zone list is no cycle (protection never fails open)
  if (!inp.zones) throw new Error('zones: no --zones given')
  let zdoc = null
  try { zdoc = readJ(inp.zones, null) } catch (e) { throw new Error(`zones unreadable: ${inp.zones}: ${e?.message ?? e}`) }
  if (!zdoc || !Array.isArray(zdoc.zones)) throw new Error(`zones unreadable: ${inp.zones}`)
  const zones = zdoc.zones
  const { cells, guard } = townReadings(inp.pool, home)
  const rr = readRows(inp.rows ?? [], { cursor: st.cursor ?? 0, now })
  const holds = new Map()
  for (const j of st.book) if (j.state === 'open' && j.owner) holds.set(j.owner, true)
  const bots = (inp.bots ?? []).map(b => ({ name: b.name, online: b.online !== false, pos: b.pos ?? null, rate: rr.stats[b.name]?.rate ?? 0,
    lastProgressAt: rr.stats[b.name]?.lastProgressAt ?? null, givenAt: st.givenAt?.[b.name] ?? now, unstuckAt: st.unstuckAt?.[b.name] ?? null }))
  const leased = bot => { try { return leaseState(inp.pool, projKey(home, listPlot(bot)), listLease(bot))?.holdsUntil ?? 0 } catch { return 0 } }
  const c = overseerCycle({ book: st.book, reports: rr.reports, cells, bots, zones, guard: k => guard.has(k), leased, home, radius: Number(inp.radius) || 128, now })
  // the clocks the next cycle needs: when a bot was first given work (since it last held none), when it was last sent `unstick`
  const givenAt = {}, unstuckAt = { ...(st.unstuckAt ?? {}) }
  for (const j of c.book) if (j.state === 'open' && j.owner) givenAt[j.owner] = holds.has(j.owner) ? (st.givenAt?.[j.owner] ?? now) : now
  for (const o of c.orders) unstuckAt[o.bot] = now
  const summary = { at: now, mode, row: c.row, lists: Object.fromEntries(Object.entries(c.lists).map(([b, d]) => [b, d.order ? `order:${d.order.kind}` : d.jobs.length])),
    orders: c.orders, reports: rr.reports.length, setAside: c.setAside.length }
  if (!write) return { summary, cycle: c }
  if (inp.live) {
    for (const [b, d] of Object.entries(c.lists)) writeAtomic(path.join(inp.pool, listFile(b)), d)
    // a list file this cycle did not write is removed: a bot with no list now
    for (const f of fs.readdirSync(inp.pool)) if (LIST_RE.test(f) && !Object.keys(c.lists).some(b => listFile(b) === f)) { try { fs.unlinkSync(path.join(inp.pool, f)) } catch { /* gone */ } }
  } else {
    // r1 C6: DRY NEVER WRITES TO OR DELETES FROM THE TOWN. The one exception is the switch going off: the live book says lists
    // were published, so they are removed ONCE and the live book records it; after that dry touches only scratch.
    summary.stopped = stopLive(inp, now)
    for (const [b, d] of Object.entries(c.lists)) writeAtomic(path.join(inp.scratch, listFile(b)), d)
  }
  writeAtomic(bookFile, { ...(inp.live ? { published: Object.keys(c.lists).length > 0 || !!st.published } : {}), v: 1, book: c.book, cursor: rr.cursor, givenAt, unstuckAt, at: now })
  writeAtomic(path.join(inp.state, 'setaside.json'), { v: 1, at: now, mode, n: c.setAside.length, jobs: c.setAside })
  return { summary, cycle: c }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inp = JSON.parse(fs.readFileSync(0, 'utf8'))
  try { process.stdout.write(JSON.stringify(runCycle(inp).summary) + '\n') } catch (e) { process.stdout.write(JSON.stringify({ error: String(e?.message ?? e) }) + '\n'); process.exit(2) }
}
