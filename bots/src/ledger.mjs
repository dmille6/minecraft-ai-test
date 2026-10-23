// THE TOWN LEDGER, stage 1 (ledger-01; cooperation-tier design r9.1 docs/reports/cooperation-tier-2026-10-23.md sections 4.2,
// 4.3 and 6.4; comms design 2026-10-21 section 4). OWNER 2026-10-23 "all yes". Observe-only: NOTHING reads it in ledger-01.
//
// WHAT IS RECORDED: one `station` record at every OPEN of a TOWN furnace (by any skill: the drain, smelt, smelt_town) and
// one at every LOAD's verifying view (after this bot put input or fuel in), each carrying what the SERVER showed in the
// furnace's three slots (input, fuel, output) and whether it was lit. Every record is ITS OWN raw evidence AND carries its
// OUTCOME, in ONE append (design 6.4, Claude r9 #3: a crash between two appends could leave evidence with no outcome):
//   entry      a new station fact: the furnace's state changed, or the last entry is older than COALESCE_MS
//   coalesced  identical slots to the furnace's NEWEST entry (from ANY bot) written < COALESCE_MS ago: `into` names that
//              entry (design 6.4, Claude r9 #1: never the writer's own stale `last`, so a repeat after a townmate's
//              contrary entry is a new entry, not a coalesce into an old one)
//   drop       a refresh over the per-bot observation cap (OBS_CAP_PER_H); a CHANGED state is never dropped
// So every open maps to exactly one outcome, and the L1 gate (ledgerread.py) checks that mapping.
//
// WHY (measured 10-22/23, 24 h, 13 shared towns): 870 of 1,435 "is empty" drains repeated a townmate's finding within 60
// min with no load between -- 2.51 bot-h a day. furnaceseen-01 (B3) is the consumer; ledger-01 only records.
//
// THE FILE: `ledger-<hx>_<hy>_<hz>.g<N>.jsonl` in the town's state directory, beside the town index. Append-only, one record
// per line, newline FIRST (a dead writer's fragment is closed off), no lock (the fold is order-independent per furnace:
// newest `at` wins, ties by id). ROTATION as townindex: a writer finding generation N past LEDGER_ROTATE_BYTES links N+1
// with the fold of N-1 and N as its first line; readers fold N-1 and N.
//
// LEDGER=off is the one-setting rollback (nothing written: today's behaviour).

import fs from 'node:fs'
import path from 'node:path'

export const LEDGER = Object.freeze({ on: process.env.LEDGER !== 'off' })
export const LEDGER_V = 1
/** Identical slots within this of the furnace's newest entry coalesce into it (comms 4.4's durable refresh period). */
export const COALESCE_MS = 10 * 60 * 1000
/** Refreshes (an unchanged state past COALESCE_MS) a bot may write per hour; changed states are never capped. */
export const OBS_CAP_PER_H = 120
/** A station fact is live for this long (comms 4.2: 60 min, refreshed by each open). */
export const STATION_TTL_MS = 60 * 60 * 1000
export const LEDGER_ROTATE_BYTES = Number(process.env.LEDGER_ROTATE_BYTES) > 0 ? Number(process.env.LEDGER_ROTATE_BYTES) : 4 * 1024 * 1024
export const LEDGER_MAX_READ_BYTES = 64 * 1024 * 1024

// ---- pure ------------------------------------------------------------------------------------------------------------

/** A furnace slot item -> [name, count] or null. Pure. */
export const slotOf = it => (it?.name && Number(it.count) > 0 ? [it.name, Number(it.count)] : null)

/** The three slots and the lit flag -> { in, fuel, out, lit }. Pure. */
export function furnaceSlots ({ input = null, fuel = null, output = null, lit = false } = {}) {
  return { in: slotOf(input), fuel: slotOf(fuel), out: slotOf(output), lit: !!lit }
}

/** 'lit' | 'empty' | 'holds'. Pure. */
export function stationState (s) {
  if (s?.lit) return 'lit'
  return !s?.in && !s?.fuel && !s?.out ? 'empty' : 'holds'
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** Do two slot sets show the same furnace? Pure. */
export const slotsEqual = (a, b) => same(a?.in, b?.in) && same(a?.fuel, b?.fuel) && same(a?.out, b?.out) && !!a?.lit === !!b?.lit

/**
 * THE OUTCOME OF ONE OBSERVATION -> { outcome: 'entry' } | { outcome: 'coalesced', into } | { outcome: 'drop' }. Pure.
 *   newest      the furnace's newest ENTRY in the town ledger (from any bot), or null
 *   rec         { at, slots }
 *   refreshes   this bot's refresh entries in the last hour (the cap's count)
 */
export function stationOutcome (newest, rec, refreshes = 0) {
  if (newest && slotsEqual(newest.slots, rec.slots)) {
    if (rec.at - newest.at < COALESCE_MS) return { outcome: 'coalesced', into: newest.id }
    return refreshes >= OBS_CAP_PER_H ? { outcome: 'drop' } : { outcome: 'entry', refresh: true }
  }
  return { outcome: 'entry' }
}

/** The fold -> { furnaces: { f: newest entry }, entries, coalesced, dropped, bad }. Pure. Newest `at` wins, ties by id. */
export function foldLedger (records = []) {
  const furnaces = {}
  let entries = 0, coalesced = 0, dropped = 0, bad = 0
  for (const r of records) {
    if (r?.t === 'ckpt') { for (const [f, e] of Object.entries(r.furnaces ?? {})) take(f, e); continue }
    if (r?.t !== 'station' || !r.f || !Number.isFinite(Number(r.at))) { bad++; continue }
    if (r.outcome === 'coalesced') { coalesced++; continue }
    if (r.outcome === 'drop') { dropped++; continue }
    if (r.outcome !== 'entry') { bad++; continue }
    entries++
    take(r.f, r)
  }
  function take (f, e) {
    const cur = furnaces[f]
    if (!cur || e.at > cur.at || (e.at === cur.at && String(e.id) > String(cur.id))) {
      furnaces[f] = { id: e.id, at: e.at, by: e.by, bot: e.bot, phase: e.phase, slots: e.slots, state: e.state }
    }
  }
  return { furnaces, entries, coalesced, dropped, bad }
}

/** The live station fact for furnace `f` at `now` -> the entry, or null (none, or older than STATION_TTL_MS). Pure. */
export function liveStation (view, f, now = Date.now()) {
  const e = view?.furnaces?.[f]
  return e && now - e.at < STATION_TTL_MS && e.at <= now + 60_000 ? e : null
}

// ---- the file --------------------------------------------------------------------------------------------------------

export const ledgerHomeKey = home => `${home.x}_${home.y}_${home.z}`
export const ledgerFile = (dir, hk, gen) => path.join(dir, `ledger-${hk}.g${gen}.jsonl`)
const GEN_RE = hk => new RegExp(`^ledger-${hk.replace(/[^0-9_-]/g, '')}\\.g(\\d+)\\.jsonl$`)

export function ledgerGens (dir, hk) {
  const re = GEN_RE(hk)
  let names
  try { names = fs.readdirSync(dir) } catch (e) { if (e?.code === 'ENOENT') return []; throw e }
  return names.map(f => re.exec(f)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b)
}
export const currentLedgerGen = (dir, hk) => ledgerGens(dir, hk).at(-1) ?? 1
const lineOf = rec => '\n' + JSON.stringify(rec) + '\n'

function parseBuf (buf) {
  const last = buf.lastIndexOf(10)
  const records = []
  if (last >= 0) {
    for (const ln of buf.subarray(0, last).toString('utf8').split('\n')) {
      if (!ln) continue
      try { records.push(JSON.parse(ln)) } catch { /* a dead writer's fragment */ }
    }
  }
  return records
}
function readWhole (f) {
  let st
  try { st = fs.statSync(f) } catch (e) { return e?.code === 'ENOENT' ? { missing: true } : null }
  if (st.size > LEDGER_MAX_READ_BYTES) return null
  try { return { records: parseBuf(fs.readFileSync(f)) } } catch { return null }
}

/** Every record of generations N-1 and N -> { records, ok }. ok false: the ledger could not be read (never "empty"). */
export function readLedgerRecords (dir, hk) {
  try {
    const gens = ledgerGens(dir, hk)
    if (!gens.length) return { records: [], ok: true }
    const g = gens.at(-1)
    const out = []
    for (const n of [g - 1, g]) {
      if (n < 1) continue
      const r = readWhole(ledgerFile(dir, hk, n))
      if (!r) return { records: [], ok: false }
      if (!r.missing) out.push(...r.records)
    }
    return { records: out, ok: true }
  } catch { return { records: [], ok: false } }
}

/** The town ledger folded now -> { view, ok }. */
export function readLedger (dir, hk, world = null) {
  const r = readLedgerRecords(dir, hk)
  // every record, checkpoints included, belongs to ONE world (a checkpoint is written per world, with its `w`)
  return { view: foldLedger(r.records.filter(x => (x?.w ?? null) === (world ?? null))), ok: r.ok }
}

export function rotateLedger (dir, hk, gen) {
  const next = ledgerFile(dir, hk, gen + 1)
  if (fs.existsSync(next)) return false
  const tmp = `${next}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    const recs = []
    for (const g of [gen - 1, gen]) {
      if (g < 1) continue
      const r = readWhole(ledgerFile(dir, hk, g))
      if (r && !r.missing) recs.push(...r.records)
    }
    const byWorld = {}
    for (const x of recs) (byWorld[JSON.stringify(x?.w ?? null)] ??= []).push(x)
    const lines = Object.entries(byWorld).map(([w, xs]) => lineOf({ t: 'ckpt', v: LEDGER_V, gen: gen + 1, at: Date.now(), w: JSON.parse(w), furnaces: foldLedger(xs).furnaces })).join('')
    fs.writeFileSync(tmp, lines)
    try { fs.linkSync(tmp, next) } catch { return false }
  } catch { return false } finally { try { fs.unlinkSync(tmp) } catch { /* gone */ } }
  for (const g of ledgerGens(dir, hk)) if (g < gen) { try { fs.unlinkSync(ledgerFile(dir, hk, g)) } catch { /* gone */ } }
  return true
}

/** APPEND ONE RECORD -> true when written (never throws). One line, one write, newline first. */
export function appendLedger (dir, hk, world, rec, { rotateBytes = LEDGER_ROTATE_BYTES } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    let g = currentLedgerGen(dir, hk)
    try { if (fs.statSync(ledgerFile(dir, hk, g)).size > rotateBytes && rotateLedger(dir, hk, g)) g = g + 1 } catch { /* no file yet */ }
    const ln = lineOf({ v: LEDGER_V, ...rec, w: world ?? null })
    fs.appendFileSync(ledgerFile(dir, hk, g), ln)
    for (let i = 0; i < 3; i++) {
      const g2 = currentLedgerGen(dir, hk)
      if (g2 === g) break
      g = g2
      fs.appendFileSync(ledgerFile(dir, hk, g), ln)
    }
    return true
  } catch { return false }
}

// ---- the writer (one per process) ------------------------------------------------------------------------------------

const REFRESHES = []          // this process's refresh-entry times (the cap's window)
export const resetLedgerCap = () => { REFRESHES.length = 0 }

/**
 * RECORD ONE FURNACE OBSERVATION -> the record (with its outcome), or null when nothing was written (the ledger off, or the
 * write failed). `phase` is 'open' (what the server showed at the open) or 'load' (the verifying view after a load).
 */
export function recordStation (dir, hk, world, { id, f, bot, by, phase = 'open', slots, at = Date.now() } = {}, opts = {}) {
  if (!LEDGER.on || !f || !slots) return null
  try {
    const { view } = readLedger(dir, hk, world)
    const newest = view.furnaces[f] ?? null
    while (REFRESHES.length && at - REFRESHES[0] > 3600_000) REFRESHES.shift()
    const o = stationOutcome(newest, { at, slots }, REFRESHES.length)
    const rec = { t: 'station', id, f, at, bot, by, phase, slots, state: stationState(slots), outcome: o.outcome }
    if (o.into) rec.into = o.into
    if (!appendLedger(dir, hk, world, rec, opts)) return null
    if (o.refresh) REFRESHES.push(at)
    return rec
  } catch { return null }
}

/** The `_ledger_mode` licence row (once per spawn): `on=on|off` (the cooperation design's A7 contract), a kind the base cannot write. */
export const ledgerModeDetail = () =>
  `phase=mode on=${LEDGER.on ? 'on' : 'off'} v=${LEDGER_V} coalesce_min=${COALESCE_MS / 60000} cap_per_h=${OBS_CAP_PER_H} ttl_min=${STATION_TTL_MS / 60000} records=station`

/** The `_ledger_station` row's detail (one per record written). Pure. */
export const ledgerStationDetail = rec =>
  `id=${rec.id} f=${rec.f} phase=${rec.phase} by=${rec.by} state=${rec.state} outcome=${rec.outcome}${rec.into ? ` into=${rec.into}` : ''} in=${rec.slots.in ? rec.slots.in.join(':') : '0'} fuel=${rec.slots.fuel ? rec.slots.fuel.join(':') : '0'} out=${rec.slots.out ? rec.slots.out.join(':') : '0'} lit=${rec.slots.lit ? 1 : 0}`
