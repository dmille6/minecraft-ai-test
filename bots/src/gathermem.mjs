// GATHERMEM-01 (wasted attempts, 2026-11-07; docs/reports/wasted-attempts-2026-11-07.md): a bot remembers the gather
// targets that just failed it and the places where a gather just found nothing it could take. Pure parts (no bot, no world
// reads); gather (skills.mjs gather/gatherRun), admission (admission.mjs) and the observation (prompt.mjs) consume them.
//
// MEASURED (fleet .31, 80 bots, 24 h to 11-07 13:25Z, 1,920 bot-h, 155,944 skill runs): gather failures cost 263.5 bot-h
// (13.7% of fleet time). 8,411 of them (93.7 bot-h) were the SAME bot failing the SAME block the SAME way within 16 blocks
// and 10 minutes of its last try, with no success between: iron_ore 43.2 bot-h, sand 23.5 (sandrung-01 removes most of it),
// oak_log 9.7, coal_ore 7.7, deepslate_iron_ore 3.7, dirt 3.6. gatherRun's own `excluded` set is per RUN, so the next run
// re-scans the same nearest candidates and walks to the same ones that just refused it (no_path: median 20.3 s, 4 blocks).
//
// TWO MEMORIES, both per bot, in RAM only (a restart forgets: a transient geometric fact is not a lesson):
//   TARGETS  an attempted candidate cell that threw or yielded nothing (a barren round). Keyed by block + cell; it holds while
//            the bot is within TARGET_MOVE of where it tried from, for TARGET_TTL_MS. gather RANKS fresh candidates before
//            remembered ones (never drops one), so the next run tries cells it has not yet failed. A success at the cell or an
//            abort (an interruption: the reflex took the body, says nothing of the cell) never writes one.
//   AREAS    a whole run that found nothing it could take here: every candidate unsafe (no_safe_target), buried
//            (unreachable: "use mine"), every candidate refused, or every candidate one it has just failed. Keyed by block;
//            it holds within AREA_NEAR of where the run stood, for AREA_TTL_MS. Admission refuses the same (gather, block)
//            there with a remedy the bot can perform (mine for an ore; any other block; walk AREA_NEAR+ blocks), and the
//            observation names it before the decision.
// Both expire, so the bot always tries again later (the memory is a delay, never a ban); moving away clears them.
//
// Kill switch: GATHERMEM=0 (no memory written or read: the base exactly).
export const gatherMemOn = (env = process.env) => String(env?.GATHERMEM ?? '1').trim() !== '0'

export const TARGET_TTL_MS = 6 * 60_000     // a failed cell is tried last for 6 min...
export const TARGET_MOVE = 8                // ...while the bot is within 8 blocks of where it tried from
export const TARGET_CAP = 128               // newest entries kept per bot
export const AREA_TTL_MS = 4 * 60_000       // a (gather, block) that found nothing takeable is refused here for 4 min...
export const AREA_NEAR = 16                 // ...within 16 blocks of where that run stood
export const AREA_CAP = 16
/** The run outcomes that are facts about HERE (what the scan of this place returns), and so write an AREA entry. */
export const AREA_CLASSES = Object.freeze(new Set(['no_safe_target', 'unreachable', 'nothing_found']))
/** Ores: their remedy is `mine` (it tunnels to ore it can see); anything else is gathered elsewhere. */
const ORE = /(_ore|ancient_debris)$/

const fin = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
const cellOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) })
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const live = (list, now) => (Array.isArray(list) ? list : []).filter(e => e && Number.isFinite(e.until) && e.until > now)

/** Record a failed target -> the new list. Pure. `cell` the candidate block, `from` where the bot stood when it set out. */
export function noteTargetFailure (list, { block, cell, from, why = 'failed', now = Date.now() } = {}) {
  const keep = live(list, now)
  if (!block || !fin(cell) || !fin(from)) return keep
  const c = cellOf(cell)
  const rest = keep.filter(e => !(e.block === block && e.cell.x === c.x && e.cell.y === c.y && e.cell.z === c.z))
  return [...rest, { block, cell: c, from: { x: from.x, y: from.y, z: from.z }, why, until: now + TARGET_TTL_MS }].slice(-TARGET_CAP)
}

/** Forget a cell that just yielded -> the new list. Pure. */
export function clearTarget (list, { block, cell, now = Date.now() } = {}) {
  if (!fin(cell)) return live(list, now)
  const c = cellOf(cell)
  return live(list, now).filter(e => !(e.block === block && e.cell.x === c.x && e.cell.y === c.y && e.cell.z === c.z))
}

/** Is this candidate one the bot failed recently, from about here? -> entry | null. Pure. */
export function rememberedTarget (list, { block, cell, pos, now = Date.now() } = {}) {
  if (!fin(cell) || !fin(pos)) return null
  const c = cellOf(cell)
  return live(list, now).find(e => e.block === block && e.cell.x === c.x && e.cell.y === c.y && e.cell.z === c.z &&
    dist3(e.from, pos) <= TARGET_MOVE) ?? null
}

/**
 * RANK, NEVER DROP -> { list, fresh, remembered }. Pure. Fresh candidates first, in the order given (the caller's own
 * ranking: approachable, then the A* hit, then distance), remembered ones after them in the same order. Nothing is removed,
 * so a remembered cell is still tried when no fresh one is left -- it is only tried LAST.
 */
export function rankByMemory (cands = [], isRemembered = () => false) {
  const fresh = [], old = []
  for (const q of Array.isArray(cands) ? cands : []) (isRemembered(q) ? old : fresh).push(q)
  return { list: [...fresh, ...old], fresh: fresh.length, remembered: old.length }
}

/**
 * EVERY CANDIDATE IS ONE THAT JUST FAILED -> boolean. Pure. Then the run would walk the same failing route again: it ends
 * without walking (and writes an AREA entry). Only on the run's first round with nothing collected and at least one
 * candidate -- an empty list is the scan's own answer, never this.
 */
export function allRemembered ({ fresh = 0, remembered = 0, collected = 0, rounds = 1 } = {}) {
  return rounds === 1 && collected === 0 && fresh === 0 && remembered > 0
}

/** Record a run that found nothing takeable here -> the new list. Pure. */
export function noteAreaRefusal (list, { block, pos, failClass, now = Date.now() } = {}) {
  const keep = live(list, now)
  if (!block || !fin(pos) || !(AREA_CLASSES.has(failClass) || failClass === 'remembered')) return keep
  const rest = keep.filter(e => !(e.block === block && dist3(e.at, pos) <= AREA_NEAR))
  return [...rest, { block, at: { x: pos.x, y: pos.y, z: pos.z }, failClass, since: now, until: now + AREA_TTL_MS }].slice(-AREA_CAP)
}

/** Is (gather, block) refused here? -> entry | null. Pure. */
export function areaRefusal (list, { block, pos, now = Date.now() } = {}) {
  if (!block || !fin(pos)) return null
  return live(list, now).find(e => e.block === block && dist3(e.at, pos) <= AREA_NEAR) ?? null
}

/** The remedy a refused (gather, block) names: one the bot can perform from where it stands. Pure. */
export function areaRemedy (block) {
  return ORE.test(String(block ?? ''))
    ? `use mine (it tunnels to the ${block} it can see), gather another block, or walk ${AREA_NEAR}+ blocks and gather it there`
    : `gather another block, or walk ${AREA_NEAR}+ blocks (explore or goto) and gather ${block} there`
}

/** Admission's refusal detail for a hit. Pure. */
export function areaRefusalDetail (hit, now = Date.now()) {
  const ago = Math.max(0, Math.round((now - hit.since) / 1000)), left = Math.max(1, Math.ceil((hit.until - now) / 1000))
  const why = hit.failClass === 'no_safe_target' ? 'every candidate here is beside water or under falling blocks'
    : hit.failClass === 'nothing_found' ? `none within reach of here`
    : hit.failClass === 'remembered' ? 'every candidate here is one that just failed you'
    : 'every candidate here is buried or could not be reached'
  return `gather ${hit.block} found nothing it could take here ${ago}s ago (${why}); ${areaRemedy(hit.block)} (${left}s left)`
}

/** The observation's line for the blocks refused here (prompt.mjs). Pure. '' when none. */
export function areaLine (list, { pos, now = Date.now() } = {}) {
  if (!fin(pos)) return ''
  const hits = live(list, now).filter(e => dist3(e.at, pos) <= AREA_NEAR)
  if (!hits.length) return ''
  const names = [...new Set(hits.map(e => e.block))]
  return `GATHER REFUSED HERE (for a few minutes): ${names.map(b => `${b} -- ${areaRemedy(b)}`).join('; ')}`
}
