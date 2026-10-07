// THE TOWN COBBLE CAP (stonecap-01; OWNER 10-04 "keep 256 per town, bank only when it frees a slot"; the owner delegated the
// cap's design 10-07 to the operator and Codex). Codex's rule, built here:
//   - count cobble across the town's designated storage from RECONCILED chest observations (a bot that opens a town
//     container records what the server's window holds, and records it again after its own transfer), with RESERVATIONS
//     for concurrent deposits -- never a mayor's estimate;
//   - admit only WHOLE stacks that keep the town at or below 256, while the bot keeps its own 64 cobble + deepslate
//     (bankable.mjs COBBLE_RESERVE);
//   - UNKNOWN stock (a town container with no fresh observation) is reconciled before depositing: nothing is admitted
//     until every container in town has one -- "currently below 256" on a partial count permits overshoot;
//   - at the ceiling banking cannot relieve bag pressure: the surplus stays in the bag, or (only where the junk well is
//     part of the build) goes down the well. Never a new chest, never a toss.
//
// "Cobble" here is cobblestone + cobbled_deepslate, as everywhere in the cobble rule.
//
// THE LEDGER is one small JSON file per town in the pool's state dir (<townKey>.cobble.json), read-modify-written under an
// EXCLUSIVE lock file (fs 'wx' create; a stale lock older than LOCK_STALE_MS is broken) -- the 10-04 synthesis rejected
// an UNLOCKED town file for lost updates; this one is locked. Isolated pools keep one state dir per bot, so their bots
// do not see each other's reservations: the read reports it, and the canary never draws an isolated pool.

import fs from 'node:fs'
import path from 'node:path'

export const TOWN_COBBLE_CAP = 256
/** An observation older than this is no longer a count: the container is unknown again. */
export const OBS_TTL_MS = 6 * 60 * 60 * 1000
/** A reservation that was never released (a crash mid-transfer) stops counting after this. */
export const RES_TTL_MS = 3 * 60 * 1000
export const LOCK_STALE_MS = 5_000
export const LOCK_WAIT_MS = 1_500
const COBBLE = new Set(['cobblestone', 'cobbled_deepslate'])
export const isCobbleName = n => COBBLE.has(n)

/** cobble in a list of items (a container window's containerItems(), or a bag). */
export function cobbleIn (items = []) {
  let n = 0
  for (const it of (Array.isArray(items) ? items : [])) if (it?.name && COBBLE.has(it.name)) n += Number(it.count) || 0
  return n
}

/**
 * THE TOWN'S COBBLE, AS FAR AS ANYONE KNOWS -> { lb, complete, unknown, reservedOthers, mine }. Pure.
 *   lb              sum of FRESH observations (a lower bound on the town's cobble: an unobserved container adds >= 0)
 *   complete        every container in `keys` (the town's storage, as scanned now) has a fresh observation
 *   unknown         the keys without one
 *   reservedOthers  live reservations by other depositors (cobble on its way into the town)
 */
export function townCobble (ledger = {}, keys = [], now = Date.now(), { me = null } = {}) {
  const obs = ledger?.obs ?? {}
  const fresh = k => obs[k] && Number.isFinite(obs[k].at) && now - obs[k].at < OBS_TTL_MS
  let lb = 0
  for (const k of Object.keys(obs)) if (fresh(k)) lb += Math.max(0, Number(obs[k].n) || 0)
  const unknown = (Array.isArray(keys) ? keys : []).filter(k => !fresh(k))
  let reservedOthers = 0, mine = 0
  for (const [id, r] of Object.entries(ledger?.res ?? {})) {
    if (!(Number.isFinite(r?.at) && now - r.at < RES_TTL_MS)) continue
    if (me != null && r.bot === me) mine += Number(r.n) || 0
    else reservedOthers += Number(r.n) || 0
  }
  return { lb, complete: keys.length > 0 && unknown.length === 0, unknown, reservedOthers, mine }
}

/**
 * MAY THIS WHOLE STACK GO INTO THE TOWN? -> 'bank' | 'at_cap' | 'unknown'. Pure.
 *   at_cap   the town is PROVEN at the cap: what is known plus what others are bringing already reaches it, or this stack
 *            would carry a complete count past it. (A lower bound at or over the cap needs no completeness.)
 *   unknown  a container has no fresh count and the known part is below the cap: reconcile first.
 */
export function cobbleAdmit (view, stack, cap = TOWN_COBBLE_CAP) {
  const base = (Number(view?.lb) || 0) + (Number(view?.reservedOthers) || 0)
  if (base >= cap) return 'at_cap'
  if (!view?.complete) return 'unknown'
  return base + (Number(stack) || 0) <= cap ? 'bank' : 'at_cap'
}

/**
 * THE STACKS THAT GO, IN ORDER -> { bank: [stacks], refused: { at_cap, unknown } }. Pure. `stacks` are counts (already
 * whole stacks above the bot's own reserve, smallest first); each admitted one is charged before the next is judged.
 */
export function admitStacks (view, stacks = [], cap = TOWN_COBBLE_CAP) {
  const v = { ...view }
  const bank = [], refused = { at_cap: 0, unknown: 0 }
  for (const s of stacks) {
    const d = cobbleAdmit(v, s, cap)
    if (d === 'bank') { bank.push(s); v.lb = (Number(v.lb) || 0) + s } else refused[d]++
  }
  return { bank, refused }
}

// ---- the ledger file ---------------------------------------------------------------------------------------------

const ledgerFile = (dir, key) => path.join(dir, `${key}.cobble.json`)
const sleepSync = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* no wait */ } }

/** The ledger -> { obs: {}, res: {} }. Another world's ledger reads as empty. */
export function readLedger (dir, key, world = null) {
  try {
    const r = JSON.parse(fs.readFileSync(ledgerFile(dir, key), 'utf8'))
    if ((r?.world ?? null) !== (world ?? null)) return { obs: {}, res: {} }
    return { obs: r?.obs ?? {}, res: r?.res ?? {} }
  } catch { return { obs: {}, res: {} } }
}

/**
 * READ-MODIFY-WRITE UNDER THE TOWN'S LOCK -> { ok, value } (value = what `fn(ledger)` returned). The lock is an exclusive
 * create of <file>.lock; one older than LOCK_STALE_MS is a crashed holder's and is broken. No lock within LOCK_WAIT_MS
 * -> { ok: false } and nothing is written: the caller treats the town as UNKNOWN (nothing is banked on a guess).
 */
export function withLedger (dir, key, world, fn, { now = () => Date.now() } = {}) {
  const file = ledgerFile(dir, key)
  const lock = `${file}.lock`
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* exists */ }
  const t0 = now()
  let fd = null
  while (fd === null) {
    try { fd = fs.openSync(lock, 'wx') } catch (e) {
      if (e?.code !== 'EEXIST') return { ok: false }
      try { if (now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); continue } } catch { continue }
      if (now() - t0 > LOCK_WAIT_MS) return { ok: false }
      sleepSync(15)
    }
  }
  try {
    const ledger = readLedger(dir, key, world)
    const value = fn(ledger)
    const keep = now()
    for (const [id, r] of Object.entries(ledger.res)) if (!(keep - (r?.at ?? 0) < RES_TTL_MS)) delete ledger.res[id]
    for (const [k, o] of Object.entries(ledger.obs)) if (!(keep - (o?.at ?? 0) < OBS_TTL_MS * 4)) delete ledger.obs[k]
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ world: world ?? null, obs: ledger.obs, res: ledger.res }))
    fs.renameSync(tmp, file)
    return { ok: true, value }
  } catch { return { ok: false } } finally {
    try { fs.closeSync(fd) } catch { /* closed */ }
    try { fs.unlinkSync(lock) } catch { /* gone */ }
  }
}
