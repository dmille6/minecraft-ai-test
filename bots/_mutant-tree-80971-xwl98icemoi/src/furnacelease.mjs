// THE FURNACE LEASE (smeltjob-01; docs/reports/townprojects-design-2026-10-14.md 3.4): ONE bot in a furnace's window at a time.
//
// WHY. `smelt` takes whatever output a furnace holds, pulls out foreign input and empties the furnace on every exit
// (skills.mjs drainFurnace). Two bots at one furnace therefore interleave: each takes the other's ingots and input, the
// runner credits the wrong bot, and a per-order copper balance cannot be read. Today that is rare; a deterministic town
// smelt job makes it routine (Codex r1 P1 #7). So every furnace SESSION -- the milestone's `smelt`, the town job's, the
// drain's -- holds this lease from before the window opens until after it closes.
//
// HOW (blueprint.mjs's generation files, the shape both engines approved for the tree farm's builder lease):
//   * a lease is a FILE `<dir>/furnace-leases/<x_y_z>.g<N>.json`, created with flag 'wx' (O_EXCL): exactly one writer
//     wins each generation N, on any POSIX filesystem, with no lock;
//   * the CURRENT lease is the highest N; it is LIVE while now < its `until` and no `<...>.g<N>.released` marker exists;
//   * to take a furnace, a bot reads the highest N: a live lease of another holder is a refusal (`busy`); otherwise it
//     creates N+1. Creating N+1 can only succeed for one bot. After creating it, the taker re-lists: if a higher N exists
//     (a slow writer re-creating a pruned number, or two generations raced through), the lower one has LOST and steps
//     back. A torn (unreadable) highest generation is treated as LIVE until its file is older than the TTL (never a
//     free-for-all on a write in progress);
//   * release writes the `.released` marker (never deletes the generation: deleting would let the next taker re-create
//     the same N); old generations are pruned beyond the newest KEEP_GENERATIONS;
//   * TTL = the skill's whole budget plus the hard-stop grace, so a crashed or hard-stopped holder frees the furnace
//     without anyone releasing it (Claude r2 N4).
//
// FAIL-OPEN, ON PURPOSE: if the directory cannot be read or written (a test double, a full disk), the lease answers
// `{ ok: true, unleased: true }` and the session runs exactly as it does on the base -- the lease adds exclusion, it must
// never subtract smelting. The `unleased` flag is carried into the session row, so the read can count it.
//
// SCOPE: the directory is the town's (poolStateDir(memory.pool)). In an ISOLATED pool every bot has its own directory,
// so isolated bots exclude nobody -- exactly as today (Claude r2 N4). The town job itself is off there (D2).
import fs from 'node:fs'
import path from 'node:path'

/** A furnace session's worst case: the smelt deadline (150 s) + recovery, inside the runner's 180 s + 30 s hard stop. */
export const FURNACE_LEASE_TTL_MS = 240_000
/** Generations kept on disk per furnace (the rest are pruned; the highest is always kept). */
export const KEEP_GENERATIONS = 4

const keyOf = p => `${Math.floor(p.x)}_${Math.floor(p.y)}_${Math.floor(p.z)}`
const leaseDir = dir => path.join(dir, 'furnace-leases')
const GEN_RE = /^(-?\d+_-?\d+_-?\d+)\.g(\d+)\.json$/

/** The generations on disk for one furnace -> [N...] ascending. Pure over a directory listing. */
export function generationsOf (names = [], key) {
  const out = []
  for (const n of names) {
    const m = GEN_RE.exec(n)
    if (m && m[1] === key) out.push(Number(m[2]))
  }
  return out.sort((a, b) => a - b)
}

/**
 * IS THIS LEASE LIVE AT `now`? Pure. `rec` is the parsed generation (null when unreadable), `released` its marker,
 * `mtimeMs` the file's age for a torn record.
 */
export function leaseLive ({ rec = null, released = false, mtimeMs = 0, now = Date.now(), ttl = FURNACE_LEASE_TTL_MS } = {}) {
  if (released) return false
  if (!rec) return now - mtimeMs < ttl          // torn: live until it is older than any lease could be
  return now < Number(rec.until ?? 0)
}

function readGen (dir, key, n) {
  const file = path.join(leaseDir(dir), `${key}.g${n}.json`)
  let rec = null, mtimeMs = 0
  try { mtimeMs = fs.statSync(file).mtimeMs } catch { return null }
  try { rec = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { rec = null }
  let released = false
  try { fs.statSync(`${file.slice(0, -5)}.released`); released = true } catch { released = false }
  return { n, rec, released, mtimeMs }
}

/** Who holds furnace `pos` now -> { live, holder, n } (live false when free). Never throws. */
export function furnaceLeaseState (dir, pos, { now = Date.now() } = {}) {
  try {
    const key = keyOf(pos)
    const gens = generationsOf(fs.readdirSync(leaseDir(dir)), key)
    if (!gens.length) return { live: false, holder: null, n: 0 }
    const top = readGen(dir, key, gens[gens.length - 1])
    if (!top) return { live: false, holder: null, n: gens[gens.length - 1] }
    return { live: leaseLive({ ...top, now }), holder: top.rec?.holder ?? null, n: top.n }
  } catch (e) {
    if (e?.code === 'ENOENT') return { live: false, holder: null, n: 0 }
    return { live: false, holder: null, n: 0, unreadable: true }
  }
}

/**
 * TAKE furnace `pos` for `holder` -> { ok, n, release() } | { ok: false, busy: true, holder }.
 * Fail-open ({ ok: true, unleased: true }) when the directory cannot be used.
 */
export function acquireFurnaceLease (dir, pos, holder, { now = Date.now(), ttl = FURNACE_LEASE_TTL_MS, what = 'smelt' } = {}) {
  const key = keyOf(pos)
  const noop = { ok: true, unleased: true, n: 0, release () {} }
  let names
  try { fs.mkdirSync(leaseDir(dir), { recursive: true }); names = fs.readdirSync(leaseDir(dir)) } catch { return noop }
  const gens = generationsOf(names, key)
  const topN = gens.length ? gens[gens.length - 1] : 0
  if (topN) {
    const top = readGen(dir, key, topN)
    if (top && leaseLive({ ...top, now, ttl }) && top.rec?.holder !== holder) return { ok: false, busy: true, holder: top.rec?.holder ?? '?', n: topN }
  }
  const n = topN + 1
  const file = path.join(leaseDir(dir), `${key}.g${n}.json`)
  try {
    fs.writeFileSync(file, JSON.stringify({ holder, at: now, until: now + ttl, what, pos: key }), { flag: 'wx' })
  } catch (e) {
    if (e?.code === 'EEXIST') {
      // another bot created N first: it holds the furnace
      const won = readGen(dir, key, n)
      return { ok: false, busy: true, holder: won?.rec?.holder ?? '?', n }
    }
    return noop
  }
  // A HIGHER GENERATION BEATS US (a slow writer, or a race through two numbers): step back.
  try {
    const after = generationsOf(fs.readdirSync(leaseDir(dir)), key)
    const higher = after.filter(g => g > n)
    if (higher.length) {
      try { fs.writeFileSync(`${file.slice(0, -5)}.released`, String(now)) } catch { /* expires by TTL */ }
      const win = readGen(dir, key, higher[higher.length - 1])
      return { ok: false, busy: true, holder: win?.rec?.holder ?? '?', n: higher[higher.length - 1] }
    }
    // PRUNE old generations (never the newest KEEP_GENERATIONS, never ours)
    for (const g of after.slice(0, Math.max(0, after.length - KEEP_GENERATIONS))) {
      try { fs.unlinkSync(path.join(leaseDir(dir), `${key}.g${g}.json`)) } catch { /* another pruner */ }
      try { fs.unlinkSync(path.join(leaseDir(dir), `${key}.g${g}.released`)) } catch { /* none */ }
    }
  } catch { /* the listing failed after a successful create: we hold n */ }
  let done = false
  return {
    ok: true, n,
    release () {
      if (done) return
      done = true
      try { fs.writeFileSync(`${file.slice(0, -5)}.released`, String(Date.now())) } catch { /* expires by TTL */ }
    },
  }
}
