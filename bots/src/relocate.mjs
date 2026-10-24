// HOMEFIX-02 C2: A RELOCATION GOES SOMEWHERE DRY (docs/reports/homefix-02-design-2026-10-21.md §4 C2).
//
// homefix-01 made the watchdog's level-1 relocation actually run (H2a: 98% of verdicts v 27% on the old code), and the
// target it ran to was blind to terrain: a random point 45-70 blocks out AT THE BOT'S CURRENT Y. In hive-d that is often
// a frozen river's ice sheet (flat, open, pathable at y 63): 4 of 26 hive-d relocation successes ended on ice over water
// (15.4% v 4.3% ambient), and death 1 (hive-d-Echo 10-20 20:19Z) began with one. Simulated on the saved worlds the old
// target was a dry standable surface cell for only 102 of 224 canary verdicts.
//
// So a candidate must be a standable SURFACE cell (plinth.mjs columnSurface/standable, within the bot's y +- 8) whose
// floor is ground (not ice, magma or leaves), and goto's WHOLE ACCEPTED ARRIVAL VOLUME must be dry: goto grades success
// within 3 horizontally and |dy| <= 6 (skills.mjs arrivedAt), so with 2 of margin no water / lava / bubble column /
// waterlogged block / underwater plant / powder snow / ice may lie anywhere within Chebyshev 5 of the target column, from
// dy -8 to +7 of its feet (Codex r1 P1-2, r2 P2, r3 P1-3: capped water is not exempt -- the 1-high layer under ice is
// exactly the trap). An unreadable (null) cell refuses the candidate: an unloaded chunk is not evidence of dry ground.
// The near band (dy -3..+2) is scanned first and every scan returns on the first wet or unknown cell (Claude r3 P2).
// Pure: `read(x, y, z)` -> block | null, `rand()` -> [0, 1).
import { columnSurface, standable } from './plinth.mjs'

export const RELOCATE_TRIES = 16
export const RELOCATE_MIN_D = 45
export const RELOCATE_MAX_D = 70
export const RELOCATE_REGION = 5          // 3 (goto's horizontal acceptance) + 2
export const RELOCATE_NEAR0 = -3          // the near band, scanned first (the usual wet cells: a bank, a shore)
export const RELOCATE_NEAR1 = 2
export const RELOCATE_DY0 = -8            // the whole volume: goto accepts |dy| <= 6, + 2
export const RELOCATE_DY1 = 7

const WET = /^(water|flowing_water|lava|flowing_lava|bubble_column|powder_snow|kelp|kelp_plant|seagrass|tall_seagrass)$/
const ICE = /^(ice|packed_ice|blue_ice|frosted_ice)$/
const BAD_FLOOR = /^(ice|packed_ice|blue_ice|frosted_ice|magma_block)$|_leaves$/

function waterlogged (b) {
  try {
    const p = typeof b?.getProperties === 'function' ? b.getProperties() : (b?._properties ?? b?.properties)
    return p?.waterlogged === true || p?.waterlogged === 'true'
  } catch { return false }
}

/** Water, lava, a bubble column, an underwater plant, powder snow, a waterlogged block -- or ice (a sheet over water). Pure. */
export function wetOrIce (b) {
  if (!b) return false
  const n = String(b.name || '')
  return WET.test(n) || ICE.test(n) || waterlogged(b) || b.liquid === true
}

/** Every cell of the volume around (x, fy, z) is read and dry -> null; else 'unknown' | 'wet_near' | 'wet_far'. Pure. */
export function volumeWet (read, x, fy, z, { region = RELOCATE_REGION, dy0 = RELOCATE_DY0, dy1 = RELOCATE_DY1,
                                             near0 = RELOCATE_NEAR0, near1 = RELOCATE_NEAR1 } = {}) {
  const bands = [[Math.max(dy0, near0), Math.min(dy1, near1), 'wet_near'], [dy0, dy1, 'wet_far']]
  for (const [lo, hi, why] of bands) {
    for (let dx = -region; dx <= region; dx++) {
      for (let dz = -region; dz <= region; dz++) {
        for (let dy = lo; dy <= hi; dy++) {
          if (why === 'wet_far' && dy >= near0 && dy <= near1) continue
          const b = read(x + dx, fy + dy, z + dz)
          if (b == null) return 'unknown'
          if (wetOrIce(b)) return why
        }
      }
    }
  }
  return null
}

/**
 * IS THIS COLUMN A DRY RELOCATION TARGET? -> { ok, y, why }. Pure. `hy` is the bot's own y (rounded): the surface is
 * looked for within hy +- 8 (plinth.mjs columnSurface), so underground bots stay at their depth and surface bots at theirs.
 */
export function dryTarget (read, x, z, hy, opts = {}) {
  const f = columnSurface(read, x, z, hy)
  if (f === null) return { ok: false, why: 'unknown' }
  if (f === undefined) return { ok: false, why: 'no_surface' }
  const fy = f + 1
  if (!standable(read, x, fy, z)) return { ok: false, why: 'not_standable' }
  if (BAD_FLOOR.test(String(read(x, f, z)?.name || ''))) return { ok: false, why: 'floor' }
  // KEEPOUT-01 x HOMEFIX-02: never a relocation INTO the column above a marked lava pool -- `forbid(x, fy, z)` judges the target's
  // goto arrival region (keepout.mjs relocationForbidden: the 7x7 around it, 6 above and below its feet). Absent -> the base rule.
  // lavasight-01: a forbid may NAME its reason (a string); `true` stays keepout's, as before
  const fb = typeof opts.forbid === 'function' ? opts.forbid(x, fy, z) : false
  if (fb) return { ok: false, why: typeof fb === 'string' ? fb : 'keepout' }
  const wet = volumeWet(read, x, fy, z, opts)
  if (wet) return { ok: false, why: wet }
  return { ok: true, y: fy, why: null }
}

/** One try's candidate column: the old rule's bearing and distance (two rand() calls). Pure. */
export function drawCandidate (p, rand = Math.random, { minD = RELOCATE_MIN_D, maxD = RELOCATE_MAX_D } = {}) {
  const ang = rand() * Math.PI * 2
  const d = minD + rand() * (maxD - minD)
  return { x: Math.round(p.x + Math.cos(ang) * d), z: Math.round(p.z + Math.sin(ang) * d) }
}

function tryOnce (p, read, rand, opts, reasons) {
  const { x, z } = drawCandidate(p, rand, opts)
  let r
  try { r = dryTarget(read, x, z, Math.round(p.y), opts) } catch { r = { ok: false, why: 'unknown' } }
  if (!r.ok) reasons[r.why] = (reasons[r.why] ?? 0) + 1
  return { x, z, r }
}

/**
 * THE LEVEL-1 RELOCATION TARGET -> { ok, x, y, z, tries, reasons } | { ok: false, why: 'no_dry_target', tries, reasons }.
 * Pure (synchronous). `reasons` counts every rejection by kind, so the read sees why live candidates fail.
 */
export function pickRelocationTarget ({ p, read, rand = Math.random, tries = RELOCATE_TRIES, ...opts } = {}) {
  const reasons = {}
  if (!p || typeof read !== 'function') return { ok: false, why: 'no_dry_target', tries: 0, reasons: { no_position: 1 } }
  for (let i = 1; i <= tries; i++) {
    const { x, z, r } = tryOnce(p, read, rand, opts, reasons)
    if (r.ok) return { ok: true, x, y: r.y, z, tries: i, reasons }
  }
  return { ok: false, why: 'no_dry_target', tries, reasons }
}

/**
 * The same, yielding between tries (`pause()`, e.g. setImmediate) so 16 worst-case volume scans never hold the event
 * loop -- physics and the reflex tick -- in one stretch (Claude r3 P2). Same draws, same answer as the sync form.
 */
export async function pickRelocationTargetAsync ({ p, read, rand = Math.random, tries = RELOCATE_TRIES,
                                                   pause = () => new Promise(r => setImmediate(r)), ...opts } = {}) {
  const reasons = {}
  if (!p || typeof read !== 'function') return { ok: false, why: 'no_dry_target', tries: 0, reasons: { no_position: 1 } }
  for (let i = 1; i <= tries; i++) {
    const { x, z, r } = tryOnce(p, read, rand, opts, reasons)
    if (r.ok) return { ok: true, x, y: r.y, z, tries: i, reasons }
    if (i < tries) await pause()
  }
  return { ok: false, why: 'no_dry_target', tries, reasons }
}

/**
 * THE LANDING, judged with the SAME volume (Claude r3 P3-6): is the bot inside the target's checked volume, are its
 * feet/head wet, and does the target's volume still read dry now? -> fields for the `_relocate_landed` row. Pure.
 * A success inside the volume with wet feet while the volume still reads dry is the defect G5f names.
 */
export function landingCheck (read, pos, target, opts = {}) {
  const region = opts.region ?? RELOCATE_REGION, dy0 = opts.dy0 ?? RELOCATE_DY0, dy1 = opts.dy1 ?? RELOCATE_DY1
  const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z)
  const inRegion = Math.abs(fx - target.x) <= region && Math.abs(fz - target.z) <= region &&
                   fy - target.y >= dy0 && fy - target.y <= dy1
  const feet = read(fx, fy, fz), head = read(fx, fy + 1, fz)
  const wet = wetOrIce(feet) || wetOrIce(head)
  const now = volumeWet(read, target.x, target.y, target.z, opts)
  return { in_region: inRegion ? 1 : 0, wet: wet ? 1 : 0, feet: feet?.name ?? 'unknown', head: head?.name ?? 'unknown',
           region_dry_now: now == null ? 1 : 0, region_now: now ?? 'dry' }
}

/** `{no_surface: 3, wet_near: 2}` -> 'no_surface:3,wet_near:2' (a scalar for the row's args). Pure. */
export const reasonsLabel = (reasons = {}) => Object.entries(reasons).map(([k, v]) => `${k}:${v}`).join(',')
