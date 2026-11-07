// GKWORK-01 (control session 11-07): THE GROUNDSKEEPER ALWAYS HAS WORK, OR LETS THE LEASE GO.
//
// MEASURED (telemetry.py full walks, 11-07):
// - SHOWCASE 24 h (15 bots, 273,065 skill rows): 29 keeper terms held 25.9 keeper-h; grounds visits filled 1.4% of it (17 visits,
//   1 success). The interior stage (tidy stage 1 `inwall`) has read "complete; cuts left 0/77, fills left 0/1331" on ~30 keeper visits
//   by 13 bots since 11-06 05:36Z, placed 0, and never completed: its completion waits on PER-BOT counters (bot.gkClears: 5 visits of
//   the same bot with nothing cleared; bot.gkParkWait: 6 of the same bot) while the keeper lease rotates every ~20 min (gklease's
//   no-work release) and every release restarts the bots. `clears_given_up` fired 11 times up to 11-03 and 0 times since. Each empty
//   visit also quiets the keeper's tidy order for the bot for an hour (shop.mjs noteIdle), so a term saw at most one tidy visit and
//   ended `no_work_visit` (15 of 29). The land plan never reached the next band.
// - FLEET (gkstay-01 63d28320, 2 h): 42 terms, grounds 7.3% of keeper time; 11 terms ended `stuck`: a STALLED stage (board-b: "3
//   cell(s) no stand has reached in 3+ visits; 15 open cell(s) wait on it; nothing else is open") whose waiver room (a tenth of the
//   stage, 12 of 69 already waived) is spent -- every keeper takes, gets stuck on the same cell, releases, rests (78 of 156 board-b
//   visits in 24 h; placebo-b 44/87, placebo-d 28/127).
//
// THE RULES (pure; skills.mjs supplies the readings and keeps the files):
// 1. THE TOWN COUNTS THE EMPTY VISITS (strike files, one per holder: never a write race). A tidy visit by a bot that may complete the
//    stage, which READ every cell (an unread cell is no evidence), found no cut or fill left and changed nothing, is a strike against
//    the stage (its identity: sitedAt + stage, not the record's generation, which every waiver moves). A visit that changed the ground
//    clears the strikes before it, town-wide. GKW.emptyVisits strikes inside GKW.windowMs: the SOFT holds give way (the clears wait,
//    the park's crew wait: both per-bot counters the rotation never lets reach their bound) and the stage completes, so the land plan
//    moves on to the next band.
// 2. THE KEEPER IS NOT QUIETED WHILE THE STAGE IS CLOSING (showcase shop.mjs tidyQuiet `closing`): its order returns at GK.cooldownMs,
//    so the strikes come in minutes, not one an hour.
// 3. A KEEPER WITH NOTHING IT CAN DO LETS GO AT ONCE: an empty visit whose stage could not complete although the town's strikes are
//    in (a HARD hold: an unread cell, a prep request, a felling stand up) releases the lease `no_work_now` and rests -- never holds it
//    20 min idle.
// 4. A STALLED STAGE GETS ITS STUCK CELLS WAIVED PAST THE TENTH: when the visit is STALLED (stuck_on_cell: nothing else is open) and
//    the ordinary waiver room is spent, the cells the town's stuck map has counted GKW.stallVisits+ visits are waived up to
//    GKW.stallShare of the stage, so the cells waiting on them become work (they are not waived). Fleet waived cells are carried 24 h
//    and retried (gkforever.mjs gkfDeadCarry).
// GKWORK=0 is the rollback (every rule off: the build before it).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const GKW = Object.freeze({
  emptyVisits: 3,               // strikes (empty visits, any bot, after the last visit that worked) that close a stage
  windowMs: 6 * 60 * 60_000,    // a strike older than this is forgotten
  keep: 8,                      // strike stamps kept per holder file
  stallVisits: 3,               // = buildrun.mjs STUCK_VISITS: the stuck map's town-wide count a stalled cell must carry
  stallShare: 0.25,             // the most of a stage's cells a stalled stage may have waived in all
  stallMax: 6,                  // stalled cells waived past the room in one visit
})
/** THE SWITCH -> bool. GKWORK=0|off|false|no: off; default on. Pure. */
export const gkworkOn = (env = process.env) => !['0', 'off', 'false', 'no'].includes(String(env?.GKWORK ?? '1').trim().toLowerCase())

/** The stage's identity for the strikes -> string. Pure. Not the generation (a waiver publishes a new one). */
export const gkwSig = rec => `${rec?.sitedAt ?? '-'}|${rec?.stageId ?? rec?.stage ?? 0}|${(rec?.cells ?? []).length}|${(rec?.cut ?? []).length}`

/** WAS THIS VISIT EMPTY (evidence the stage has nothing left to do)? -> bool. Pure. Every cell read, no cut or fill left, nothing
 *  placed, cleared or planted. An unread cell is never evidence (Codex design: unknown terrain never counts as clean). */
export function visitEmpty ({ cutLeft = 0, fillLeft = 0, placed = 0, cleared = 0, planted = 0, unread = false } = {}) {
  if (unread) return false
  return !(Number(cutLeft) > 0) && !(Number(fillLeft) > 0) && !(Number(placed) > 0) && !(Number(cleared) > 0) && !(Number(planted) > 0)
}
/** Did this visit change the ground (it clears the strikes before it)? -> bool. Pure. */
export const visitWorked = ({ placed = 0, cleared = 0, planted = 0 } = {}) => Number(placed) > 0 || Number(cleared) > 0 || Number(planted) > 0

/** THIS HOLDER'S STRIKE FILE AFTER A VISIT -> { v, sig, strikes: [ms], workAt }. Pure. A new stage starts it again. */
export function strikeNext (prev, { sig, empty = false, worked = false, now = Date.now(), G = GKW } = {}) {
  const same = prev && prev.sig === sig
  let strikes = same && Array.isArray(prev.strikes) ? prev.strikes.filter(t => Number.isFinite(t) && now - t < G.windowMs && t <= now) : []
  let workAt = same && Number.isFinite(prev.workAt) ? prev.workAt : null
  if (worked) { strikes = []; workAt = now }
  else if (empty) strikes = [...strikes, now].slice(-G.keep)
  return { v: 1, sig, strikes, workAt }
}
/** THE TOWN'S STRIKES against stage `sig` -> int. Pure over every holder's file: the stamps inside the window and after the latest
 *  visit (any holder) that changed the ground. */
export function strikesTotal (files = [], { sig, now = Date.now(), G = GKW } = {}) {
  const mine = (files ?? []).filter(f => f && f.sig === sig)
  const lastWork = Math.max(-Infinity, ...mine.map(f => (Number.isFinite(f.workAt) ? f.workAt : -Infinity)))
  let n = 0
  for (const f of mine) for (const t of f.strikes ?? []) if (Number.isFinite(t) && t > lastWork && t <= now && now - t < G.windowMs) n++
  return n
}
/** Do the town's strikes close the stage? -> bool. Pure. */
export const strikesClose = (total, G = GKW) => Number(total) >= G.emptyVisits

/** THE SOFT HOLDS GIVE WAY to a town-wide close -> { clearsOk, crewHolds }. Pure. The hard holds (unread, prep, a stand up) are the
 *  caller's and never give way here. */
export const softHoldsGive = ({ clearsOk = true, crewHolds = false, close = false } = {}) => (close ? { clearsOk: true, crewHolds: false } : { clearsOk: !!clearsOk, crewHolds: !!crewHolds })

/**
 * THE KEEPER AFTER ITS VISIT -> 'keep' | 'release'. Pure. An empty visit whose stage did not complete although the town's strikes are
 * in (a hard hold the keeper cannot work from here) lets the lease go now (`no_work_now`); a visit that worked, completed, or is still
 * collecting the town's strikes keeps it (its order comes back at the keeper's cooldown, not quieted: tidyQuiet `closing`).
 */
export function keeperAfterVisit ({ keeper = false, empty = false, completed = false, close = false, forestDue = false } = {}) {
  // the showcase batch20 fold (Codex BLOCKER): the keeper's OTHER grounds work -- the forest due -- keeps the lease (its order comes next)
  if (!keeper || completed || !empty || forestDue) return 'keep'
  return close ? 'release' : 'keep'
}
/** Is this bot's grounds order collecting the town's strikes (not to be quieted)? -> bool. Pure. `pending` = { at } | null. */
export const gkwClosing = (pending, now = Date.now(), G = GKW) => !!pending && Number.isFinite(pending.at) && now - pending.at >= 0 && now - pending.at < G.windowMs

/**
 * THE STALLED STAGE'S EXTRA WAIVERS -> [{ k, why }]. Pure. Only when the visit is STALLED (stuck_on_cell, nothing else open) and the
 * ordinary waiver gave nothing: the deferred cells the town's stuck map counted G.stallVisits+ visits, not yet waived, record cells
 * (never a light), at most G.stallMax this visit and the stage's waived total at most ceil(G.stallShare * cells).
 */
export function stallWaive (rec, deferred = [], { stalled = false, waivedNow = 0, G = GKW } = {}) {
  if (!stalled || Number(waivedNow) > 0) return []
  const cells = new Set((rec?.cells ?? []).filter(c => c.role !== 'light').map(c => c.at.join(',')))
  const have = rec?.waived ?? {}
  let room = Math.min(G.stallMax, Math.ceil(G.stallShare * cells.size) - Object.keys(have).length)
  const out = []
  for (const d of deferred ?? []) {
    if (room <= 0) break
    const k = String(d?.k ?? '')
    if (!cells.has(k) || Object.prototype.hasOwnProperty.call(have, k) || out.some(o => o.k === k)) continue
    if ((Number(d?.visits) || 0) < G.stallVisits) continue
    out.push({ k, why: `stalled:${String(d?.why ?? 'no_stand').slice(0, 60)}` }); room--
  }
  return out
}
/** What held an empty stage open, for the row -> 'clears:N,park:N,unread,prep,platform' | '-'. Pure. */
export function heldWhy ({ clearsLeft = 0, clearsOk = true, crewHeld = 0, crewHolds = false, unread = false, prep = false, platform = false } = {}) {
  const w = []
  if (!clearsOk && clearsLeft > 0) w.push(`clears:${clearsLeft}`)
  if (crewHolds && crewHeld > 0) w.push(`park:${crewHeld}`)
  if (unread) w.push('unread')
  if (prep) w.push('prep')
  if (platform) w.push('platform')
  return w.join(',') || '-'
}

// ---- the strike files (one per holder; a temp file renamed into place) ----------------------------------------------------------
const strikeFile = (dir, key, holder) => path.join(dir, `${key}.gkwork.${String(holder).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
/** Every holder's strike file for `key` -> [file]. Never throws (unreadable: skipped). */
export function strikeReadAll (dir, key) {
  const out = []
  try {
    const pre = `${key}.gkwork.`
    for (const n of fs.readdirSync(dir)) {
      if (!n.startsWith(pre) || !n.endsWith('.json')) continue
      try { const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); if (j && typeof j === 'object') out.push(j) } catch { /* skipped */ }
    }
  } catch { /* none */ }
  return out
}
export function strikeRead (dir, key, holder) { try { return JSON.parse(fs.readFileSync(strikeFile(dir, key, holder), 'utf8')) } catch { return null } }
/** Write this holder's strike file -> true | false (never throws). */
export function strikeWrite (dir, key, holder, rec) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const f = strikeFile(dir, key, holder), tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(rec))
    fs.renameSync(tmp, f)
    return true
  } catch { return false }
}
/**
 * ONE VISIT'S STRIKE BOOKKEEPING -> { sig, total, close, empty, worked }. Writes this holder's file, then reads the town's. Never
 * throws (an unwritable file: the strike is not counted, nothing closes on it).
 */
export function gkwVisit (dir, key, holder, rec, { empty = false, worked = false, now = Date.now(), G = GKW } = {}) {
  const sig = gkwSig(rec)
  try {
    const next = strikeNext(strikeRead(dir, key, holder), { sig, empty, worked, now, G })
    const ok = strikeWrite(dir, key, holder, next)
    const total = ok ? strikesTotal(strikeReadAll(dir, key), { sig, now, G }) : 0
    return { sig, total, close: empty && ok && strikesClose(total, G), empty, worked }
  } catch { return { sig, total: 0, close: false, empty, worked } }
}
