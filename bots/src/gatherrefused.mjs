// ATLASGATHER-01show: A GATHER REMEMBERS THE SPOTS THAT REFUSED IT, AND DOES NOT RETURN TO THEM.
//
// Showcase 11-22 00:40-03:40Z (ES, 15 bots): gather failed 387 of 572. 102 "sand found but all N candidates are beside water or
// under falling blocks", 63 "spruce_log: all N candidate(s) in range refused -- could not stand within reach of any of them",
// 23 stone beside water, 18 dirt protected / built, 17 iron_ore buried, 16 no stone open to the sky. The SAME refused spots were
// tried again and again, visit after visit: gatherRun's `excluded` set lives for one run only (on purpose: a block unreachable
// from here may be fine from elsewhere), so the next visit enumerated the same 32 nearest cells, every one the shore or the stump
// that refused the last visit, and no fresh candidate further out ever entered the 32.
//
// So a refusal is a RECORD, per bot: { kind, cell, class, until }. The enumeration skips a recorded cell (so the 32 are the nearest
// that have NOT refused), and a search emptied by records is the logwalk walk-out's trigger (gatherbuilt.walkOutDue `refused`), then
// a refusal that names a `goto` point (memoRefusal). Nothing here decides a dig or a path: it only stops the search offering a cell
// that already refused, so it cannot make a gather less safe than the base's.
//
// A RECORD EXPIRES (TTL by class) AND IS RE-ASKED WHEN READ: a class whose cause the world can change (water drained, the sand
// beside it dug, a roof opened) is re-checked against the live cell by the caller's `still(cls)`; a record whose cause is gone is
// dropped (the block changed). `no_stand` has no cheap re-ask (it is a fact about the route from where the bot stood), so it is
// kept shorter, and a single weak failure is not yet a record (NEED strikes); the all-refused ending records it at once.
//
// Per bot, not shared: the bots' shared map (atlas.mjs) holds FINDS (where wood is), not cells that refused; a shared store would
// need its own file, merge and expiry. A per-bot record already cuts the repeats (the same bot revisits: 6.4 failures a bot-hour).

export const REFUSE_CLASSES = Object.freeze(['liquid', 'falling', 'unsafe', 'protected', 'no_stand', 'buried'])
/** How long a record stands (ms), by class. */
export const TTL_MS = Object.freeze({ liquid: 2 * 3_600_000, falling: 2 * 3_600_000, unsafe: 2 * 3_600_000, protected: 2 * 3_600_000, buried: 2 * 3_600_000, no_stand: 3_600_000 })
/** Failures that make a record, by class (default 1). A stand failure can be the route, not the cell: two, or the all-refused ending. */
export const NEED = Object.freeze({ no_stand: 2 })
/** A bot's records are bounded (oldest dropped). */
export const MAX_RECORDS = 512

const ckey = (kind, p) => `${kind}@${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
const fin = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)

/** breakVeto's word -> a record class | null (null: not recorded; an entity above is gone in seconds). Pure. */
export function classOfVeto (v) {
  if (v === 'liquid' || v === 'both') return 'liquid'
  if (v === 'falling') return 'falling'
  if (v === 'built') return 'protected'
  if (v === 'entity') return null
  return 'unsafe'
}

/** A new, empty memory (a Map: key -> record). */
export const newMemory = () => new Map()

/**
 * Record a refusal. Mutates `mem`. Returns the record's class when it now STANDS (refuses the cell), else null (a weak first strike).
 * `strong`: the failure is conclusive (counts all NEED strikes). A same-class repeat refreshes the expiry.
 */
export function noteRefusal (mem, { kind, pos, cls, now = Date.now(), strong = false } = {}) {
  if (!(mem instanceof Map) || !kind || !fin(pos) || !REFUSE_CLASSES.includes(cls)) return null
  const k = ckey(kind, pos)
  const need = NEED[cls] ?? 1
  const old = mem.get(k)
  const n = Math.min(need, (old && old.cls === cls && old.until > now ? old.n : 0) + (strong ? need : 1))
  mem.delete(k)   // re-insert: the Map's order is age
  mem.set(k, { kind, x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), cls, n, until: now + (TTL_MS[cls] ?? TTL_MS.liquid) })
  if (mem.size > MAX_RECORDS) {
    for (const [kk, r] of mem) { if (r.until <= now) mem.delete(kk) }
    while (mem.size > MAX_RECORDS) mem.delete(mem.keys().next().value)
  }
  return n >= need ? cls : null
}

/**
 * Does a standing record refuse this cell? -> the class | null. A record is read only while it has not expired and has its strikes;
 * `still(cls)` (optional) re-asks the live cell: false = the cause is gone (the block or its neighbours changed), the record is
 * dropped. A `still` that throws keeps the record (the TTL bounds it).
 */
export function isRefused (mem, { kind, pos, now = Date.now(), still = null } = {}) {
  if (!(mem instanceof Map) || mem.size === 0 || !kind || !fin(pos)) return null
  const k = ckey(kind, pos)
  const r = mem.get(k)
  if (!r) return null
  if (r.until <= now) { mem.delete(k); return null }
  if (r.n < (NEED[r.cls] ?? 1)) return null
  if (typeof still === 'function') {
    let keep = true
    try { keep = still(r.cls) !== false } catch { keep = true }
    if (!keep) { mem.delete(k); return null }
  }
  return r.cls
}

/** Standing records of a kind, for a count / a message -> { n, classes: {cls: n} }. Pure over `mem`. */
export function standing (mem, kind, now = Date.now()) {
  const classes = {}; let n = 0
  if (mem instanceof Map) for (const r of mem.values()) { if (r.kind === kind && r.until > now && r.n >= (NEED[r.cls] ?? 1)) { n++; classes[r.cls] = (classes[r.cls] ?? 0) + 1 } }
  return { n, classes }
}

export const classesLabel = classes => Object.entries(classes ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' ')

/** Is the refusal due: the search came up empty ONLY because records skipped cells, nothing taken yet, and the walks are spent. Pure. */
export const refusalDue = ({ positions = 0, refused = 0, collected = 0 } = {}) => positions === 0 && refused > 0 && collected === 0

/**
 * The refusal (remedy first: gather keeps the start of an error). Every remedy named is one the bot can perform from where it is:
 * a `goto` to a point it can walk to. Pure.
 */
export function refusedRefusal ({ block, n, classes = {}, point = null, walked = 0, to = null, maxDistance = 32, out = 25 } = {}) {
  const go = point ? `goto x=${point.x} z=${point.z} (${out}+ blocks away) and gather ${block} there` : `explore ${out}+ blocks away, then gather ${block}`
  return `${go} -- all ${n} ${block} within ${maxDistance} blocks refused this bot before (${classesLabel(classes)}) and are not tried again for ${Math.round(TTL_MS.liquid / 3_600_000)} h` +
    (walked ? `; walked out ${walked} time(s)${to ? ` (to ${to.x},${to.z})` : ''} and found none there either` : '')
}

/** The `_gather_refused` row detail. Pure. */
export const refusedRowDetail = ({ op, block, skipped = 0, noted = 0, classes = {}, found = null } = {}) =>
  `op=${op} block=${block} skipped=${skipped}${noted ? ` noted=${noted}` : ''}${found == null ? '' : ` found=${found}`}${classesLabel(classes) ? ` classes=${classesLabel(classes).replace(/ /g, ',')}` : ''}`

const _byBot = new WeakMap()
/** The bot's memory, ONE PER DIMENSION (Codex r1 BLOCKER 1: an Overworld refusal at x,y,z says nothing of the Nether's x,y,z). Never throws. */
export function memoryOf (bot) {
  if (!bot || typeof bot !== 'object') return newMemory()
  let dim = 'overworld'
  try { dim = String(bot.game?.dimension ?? 'overworld').replace(/^minecraft:/, '') } catch { dim = 'overworld' }
  let byDim = _byBot.get(bot)
  if (!byDim) { byDim = new Map(); _byBot.set(bot, byDim) }
  let m = byDim.get(dim)
  if (!m) { m = newMemory(); byDim.set(dim, m) }
  return m
}
