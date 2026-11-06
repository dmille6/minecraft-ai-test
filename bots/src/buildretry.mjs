// BUILDRETRY-01 (codeeval 2026-11-06 phase 2.1): THE BUILD RETRY HOLE CLOSED FOR EVERY PROJECT. A cell a visit keeps failing --
// a listed clear no dig stand reaches or whose dig never lands, a foreign block in a record cell whose dig fails, a placement whose
// attempts are spent, a block the visit never digs -- is COUNTED across visits and builders here; at RETRY_VISITS failing visits it
// is HELD for RETRY_HOLD_MS: no walk, no dig, no click on it (its segment is deferred into the F4 stuck map, buildrun.mjs, so the
// project's own stuck_on_cell, waiver and 6 h order back-off apply), then it is tried once more. A success (the cell done, the
// listed block gone) by ANY builder resets it.
//
// MEASURED (fleet .31, scripts/lib/telemetry.py full walks): 24 h before stuckproj-01 (1,920 bot-h): 7,750 of 7,775 clear_failed
// rows on 7 oak_leaves cells, isolated-c's monument 24.6 bot-h in 556 visits on 3 of them (no_stand: never in the stuck map);
// placebo-b tidy 305 `blocked` visits on one leaves cell, board-d tidy 215 `blocked` on a block no dig ever tries (no row at all).
// 6 h after stuckproj-01 (481 bot-h): board-d tidy still 101 `blocked` visits; placebo-d wall 16 `deadline` visits spent on ~20 dig
// walks each to listed clears that end `unreached` (clears() skips a stand-less one SILENTLY: nothing counted, every visit again);
// 72 of 172 failing cells failed in 3+ visits. Codex design (independent) reconciled in docs/reports/phase2-build-design-2026-11-06.md.
//
// One file per holder (buildproj.mjs's stuck-map rule: no lost update between two builders), summed by the reader. BUILDRETRY=0 is
// the rollback: every visit exactly as before (nothing read, nothing written, nothing held).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const buildRetryOn = (env = process.env) => !['0', 'off', 'false', 'no'].includes(String(env?.BUILDRETRY ?? '').trim().toLowerCase())
export const RETRY_VISITS = 3                     // failing visits (summed over builders) before a cell is held
export const RETRY_HOLD_MS = 2 * 60 * 60_000      // a held cell is not tried until its last failure is this old
export const RETRY_FORGET_MS = 24 * 60 * 60_000   // a failure older than this no longer counts (F4's STUCK_FORGET_MS)
export const RETRY_RESET_KEEP_MS = 48 * 60 * 60_000
const KEY = /^-?\d+,-?\d+,-?\d+$/

const fileOf = (dir, key, holder) => path.join(dir, `${key}.retry.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
const namesOf = (dir, key) => {
  try {
    const pre = `${key}.retry.`
    return fs.readdirSync(dir).filter(n => n.startsWith(pre) && n.endsWith('.json'))
  } catch { return [] }
}
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const clean = j => {
  const cells = {}, resets = {}
  for (const [k, v] of Object.entries(j?.cells ?? {})) {
    if (!KEY.test(k) || !(Number(v?.visits) > 0) || !Number.isFinite(Number(v?.lastAt))) continue
    cells[k] = { visits: Math.floor(Number(v.visits)), firstAt: Number(v.firstAt) || Number(v.lastAt), lastAt: Number(v.lastAt), why: String(v.why ?? '').slice(0, 60) }
  }
  for (const [k, v] of Object.entries(j?.resets ?? {})) if (KEY.test(k) && Number.isFinite(Number(v))) resets[k] = Number(v)
  return { cells, resets }
}
/** One holder's own file -> { cells, resets } ({} parts when none or unreadable). */
export function retryOwn (dir, key, holder) { return clean(readJ(fileOf(dir, key, holder))) }
/**
 * THE SUMMED LEDGER -> { 'x,y,z': { visits, firstAt, lastAt, why } }. Every holder's entries newer than `since` and newer than the
 * latest RESET any holder wrote for that cell (a success by B voids A's older failures: Codex design), visits summed. Never throws.
 */
export function retryRead (dir, key, { now = Date.now(), forget = RETRY_FORGET_MS } = {}) {
  const files = namesOf(dir, key).map(n => clean(readJ(path.join(dir, n))))
  const reset = {}
  for (const f of files) for (const [k, t] of Object.entries(f.resets)) if (!(reset[k] >= t)) reset[k] = t
  const out = {}
  const since = now - forget
  for (const f of files) {
    for (const [k, v] of Object.entries(f.cells)) {
      if (v.lastAt < since || v.lastAt > now + 60_000 || (reset[k] != null && v.lastAt <= reset[k])) continue
      const o = out[k]
      out[k] = o ? { visits: o.visits + v.visits, firstAt: Math.min(o.firstAt, v.firstAt), lastAt: Math.max(o.lastAt, v.lastAt), why: v.lastAt >= o.lastAt ? v.why : o.why } : { ...v }
    }
  }
  return out
}
/** Is a summed entry HELD now? RETRY_VISITS failing visits or more, the last one inside RETRY_HOLD_MS. Pure. */
export function retryHeld (entry, now = Date.now(), { visits = RETRY_VISITS, hold = RETRY_HOLD_MS } = {}) {
  return !!entry && Number(entry.visits) >= visits && Number.isFinite(Number(entry.lastAt)) && now - Number(entry.lastAt) < hold && Number(entry.lastAt) <= now + 60_000
}
/**
 * THE HOLDER'S FILE AFTER A VISIT -> { cells, resets }. Pure. `failed` Map key -> why (each key ONCE a visit, however many attempts
 * or reasons), `resolved` keys that read done / gone now. A failed key counts one more visit (its own count restarts after a reset
 * it has not seen); a resolved key leaves the cells and writes a reset; entries older than `forget`, resets older than RETRY_RESET_KEEP_MS
 * are dropped. A key both failed and resolved in one visit (a remedy landed after a failure) is resolved.
 */
export function retryAfter (own = { cells: {}, resets: {} }, failed = new Map(), resolved = new Set(), { now = Date.now(), forget = RETRY_FORGET_MS, seen = {} } = {}) {
  const cells = {}, resets = {}
  for (const [k, t] of Object.entries(own?.resets ?? {})) if (now - t < RETRY_RESET_KEEP_MS) resets[k] = t
  // r1 (Codex r1 BLOCK): ANOTHER holder's reset voids this holder's older failures too (`seen`: every holder's latest reset) --
  // else A's three old failures came back with A's next one, 4 visits and a hold at once
  const voidAt = k => Math.max(resets[k] ?? -Infinity, Number(seen?.[k]) || -Infinity)
  for (const [k, v] of Object.entries(own?.cells ?? {})) if (now - v.lastAt < forget && !(v.lastAt <= voidAt(k))) cells[k] = { ...v }
  for (const [k, why] of failed) {
    if (resolved.has(k)) continue
    const v = cells[k]
    cells[k] = { visits: (v?.visits ?? 0) + 1, firstAt: v?.firstAt ?? now, lastAt: now, why: String(why ?? '').slice(0, 60) }
  }
  for (const k of resolved) { delete cells[k]; resets[k] = now }
  return { cells, resets }
}
/** Every holder's latest reset per cell -> { 'x,y,z': ms }. Never throws. */
export function retryResets (dir, key) {
  const out = {}
  for (const n of namesOf(dir, key)) for (const [k, t] of Object.entries(clean(readJ(path.join(dir, n))).resets)) if (!(out[k] >= t)) out[k] = t
  return out
}
/** Replace THIS HOLDER's file (temp + rename) -> true | false (never throws). */
export function retryWrite (dir, key, holder, { cells = {}, resets = {} } = {}, now = Date.now()) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const f = fileOf(dir, key, holder), tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, holder, at: now, cells, resets }))
    fs.renameSync(tmp, f)
    return true
  } catch { return false }
}
/**
 * THE VISIT'S DEFAULT DEFERRAL (buildrun.mjs, after every project remedy) -> [{ k, why }] | null. Pure. `open` the segment's open
 * cells; `why(c)` names a cell that is HARD this visit (held, unreached, a kept block, no stand, attempts spent) or null (it has a
 * chance left); `waits(c)` it waits on an open cell below it. Every open cell hard or waiting (at least one hard) -> the hard ones;
 * any cell with a chance left -> null (the visit's old stop stands: retried at once).
 */
export function retryDeferrals (open = [], { why = () => null, waits = () => false } = {}) {
  const out = []
  for (const c of open) {
    const w = why(c)
    if (w) { out.push({ k: c.at.join(','), why: String(w).slice(0, 60) }); continue }
    if (!waits(c)) return null
  }
  return out.length ? out : null
}
