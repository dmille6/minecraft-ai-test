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
export const LOCK_STALE_MS = 30_000
export const LOCK_WAIT_MS = 2_000
const COBBLE = new Set(['cobblestone', 'cobbled_deepslate'])
export const isCobbleName = n => COBBLE.has(n)

/** cobble in a list of items (a container window's containerItems(), or a bag). */
export function cobbleIn (items = []) {
  let n = 0
  for (const it of (Array.isArray(items) ? items : [])) if (it?.name && COBBLE.has(it.name)) n += Number(it.count) || 0
  return n
}

/**
 * THE TOWN'S COBBLE, AS FAR AS ANYONE KNOWS -> { lb, complete, unknown, reserved, mine }. Pure.
 *   lb         sum of FRESH observations of containers still in town (a lower bound: an unobserved one adds >= 0)
 *   complete   the scan covered the whole town (`coverage`) AND every container in `keys` has a fresh count
 *   unknown    the keys without one -- including any container with an EXPIRED, UNRELEASED reservation newer than its
 *              count (Codex r1 P1: a crash between a transfer and its observation must force a recount, never quietly
 *              give the capacity back)
 *   reserved   EVERY live reservation, this bot's own included (Codex r1 P1: a batch's earlier, not yet observed stacks
 *              are charged before the next one is admitted)
 * `gone`: keys whose block was read and is no longer a container -- their counts no longer count.
 */
export function townCobble (ledger = {}, keys = [], now = Date.now(), { me = null, coverage = true, gone = [] } = {}) {
  const obs = ledger?.obs ?? {}
  const res = ledger?.res ?? {}
  const goneSet = new Set(gone)
  const dirty = new Set()
  for (const r of Object.values(res)) {
    if (!r?.k || !Number.isFinite(r.at)) continue
    const expired = !(now - r.at < RES_TTL_MS)
    if (expired && !(obs[r.k] && obs[r.k].at > r.at)) dirty.add(r.k)   // unreleased and never re-counted since
  }
  const fresh = k => !goneSet.has(k) && !dirty.has(k) && obs[k] && Number.isFinite(obs[k].at) && now - obs[k].at < OBS_TTL_MS
  let lb = 0
  for (const k of Object.keys(obs)) if (fresh(k)) lb += Math.max(0, Number(obs[k].n) || 0)
  const all = [...new Set([...(Array.isArray(keys) ? keys : []), ...dirty])].filter(k => !goneSet.has(k))
  const unknown = all.filter(k => !fresh(k))
  let reserved = 0, mine = 0
  for (const r of Object.values(res)) {
    if (!(Number.isFinite(r?.at) && now - r.at < RES_TTL_MS)) continue
    reserved += Number(r.n) || 0
    if (me != null && r.bot === me) mine += Number(r.n) || 0
  }
  return { lb, complete: !!coverage && all.length > 0 && unknown.length === 0, unknown, reserved, mine }
}

/**
 * MAY THIS WHOLE STACK GO INTO THE TOWN? -> 'bank' | 'at_cap' | 'unknown'. Pure.
 *   at_cap   the town is PROVEN at the cap: what is known plus what others are bringing already reaches it, or this stack
 *            would carry a complete count past it. (A lower bound at or over the cap needs no completeness.)
 *   unknown  a container has no fresh count and the known part is below the cap: reconcile first.
 */
export function cobbleAdmit (view, stack, cap = TOWN_COBBLE_CAP) {
  const base = (Number(view?.lb) || 0) + (Number(view?.reserved) || 0)
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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** The ledger -> { obs: {}, res: {} }. Another world's ledger reads as empty. */
export function readLedger (dir, key, world = null) {
  try {
    const r = JSON.parse(fs.readFileSync(ledgerFile(dir, key), 'utf8'))
    if ((r?.world ?? null) !== (world ?? null)) return { obs: {}, res: {} }
    return { obs: r?.obs ?? {}, res: r?.res ?? {} }
  } catch { return { obs: {}, res: {} } }
}

/**
 * READ-MODIFY-WRITE UNDER THE TOWN'S LOCK -> Promise<{ ok, value }>. ASYNC: waiting never blocks the bot's event loop (Codex
 * r1). The lock is an exclusive create of <file>.lock holding a unique TOKEN. A lock older than LOCK_STALE_MS is a crashed
 * holder's: it is broken by an atomic rename to a private name (only one contender can win that rename) and removed.
 * THE COMMIT CHECKS THE TOKEN (Codex r1 P1): immediately before the rename that publishes the ledger, the lock file must
 * still hold THIS holder's token -- a holder paused past LOCK_STALE_MS whose lock was broken finds another token and
 * writes nothing. Release removes the lock only if it still holds this token. No lock within LOCK_WAIT_MS, or a lost
 * lock -> { ok: false }: the caller treats the town as UNKNOWN (nothing is banked on a guess).
 */
export async function withLedger (dir, key, world, fn, { now = () => Date.now() } = {}) {
  const file = ledgerFile(dir, key)
  const lock = `${file}.lock`
  const token = `${process.pid}-${now()}-${Math.random().toString(36).slice(2)}`
  const holds = () => { try { return fs.readFileSync(lock, 'utf8') === token } catch { return false } }
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* exists */ }
  const t0 = now()
  for (;;) {
    try { fs.writeFileSync(lock, token, { flag: 'wx' }); break } catch (e) {
      if (e?.code !== 'EEXIST') return { ok: false }
      try {
        if (now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          const aside = `${lock}.${token}.stale`
          fs.renameSync(lock, aside)                     // only one contender wins this
          try { fs.unlinkSync(aside) } catch { /* gone */ }
          continue
        }
      } catch { continue }                             // it vanished between the checks: try again
      if (now() - t0 > LOCK_WAIT_MS) return { ok: false }
      await sleep(20)
    }
  }
  try {
    const ledger = readLedger(dir, key, world)
    const value = fn(ledger)
    const keep = now()
    for (const [id, r] of Object.entries(ledger.res)) if (!(keep - (r?.at ?? 0) < OBS_TTL_MS)) delete ledger.res[id]
    for (const [k, o] of Object.entries(ledger.obs)) if (!(keep - (o?.at ?? 0) < OBS_TTL_MS * 4)) delete ledger.obs[k]
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ world: world ?? null, obs: ledger.obs, res: ledger.res }))
    if (!holds()) { try { fs.unlinkSync(tmp) } catch { /* gone */ } return { ok: false } }
    fs.renameSync(tmp, file)
    return { ok: true, value }
  } catch { return { ok: false } } finally {
    if (holds()) { try { fs.unlinkSync(lock) } catch { /* gone */ } }
  }
}
