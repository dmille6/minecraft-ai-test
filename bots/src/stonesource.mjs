// WITHDRAW BEFORE DIG (docs/reports/ziggurat-mineshaft-2026-10-15.md section 5.1; stonewithdraw-01). PURE.
//
// WHY. 94% of gather-stone runs start with fewer than 64 cobble in the bag (the 64 reserve refilling itself), while the
// town's chests sit at their 256 cap and refuse cobble (journal fold 10-15: 4,413 across the 12 shared towns, eight at
// the cap). Digging new stone beside a town that holds it is the unneeded dig. Near town, at the surface, the stone is
// WITHDRAWN instead. Measured cut: ~0.2-0.75k cobble a day (shared pools); small, cheap, and it drains chests that refuse
// deposits.
//
// THE DECISION IS DETERMINISTIC (CLAUDE.md "advice printed is not advice taken"): the model proposes gather in ~90% of
// these runs, so an admitted `gather stone|cobblestone|...` is REWRITTEN to `withdraw cobblestone <n>` when every
// condition below holds. Anything else -- a refusal of the rewrite -- leaves the gather exactly as the model asked: the
// fallback is today's behaviour, so the rule can never be a dead end.
export const STONE_GATHER = new Set(['stone', 'cobblestone', 'cobbled_deepslate', 'deepslate'])
/** Horizontal (Chebyshev) reach from home within which the town's chests are the nearer source. */
export const WITHDRAW_NEAR = 48
/** At the surface: no lower than this below home.y. A deeper bot keeps its gather (stage-2 reviews). */
export const WITHDRAW_SURFACE_DY = -8
/** The town keeps at least this much cobble after a withdrawal (the reserve the cap's own valve keeps; design 5.1). */
export const TOWN_STONE_FLOOR = 64
/** Triggers that mean the bot is stuck: it gathers stone to climb OUT, and a walk home is the wrong remedy. */
export const STUCK_TRIGGERS = /entomb|stuck|strand|marooned|drown|low_health|trapped|pit|livelock|suffocat|flooded|danger/

/**
 * -> { source: 'withdraw' | 'gather', reason, count }. Pure.
 *   block        the gather's block;  count  the gather's count
 *   pos, home    {x,y,z}
 *   town         { avail, complete } -- the cobble view (cobblecap townStock: avail = fresh floor less live takes)
 *   trigger      the decision's trigger (e.g. 'idle', 'entombed')
 *   cooling      the admission memory refuses `withdraw cobblestone` now (cooldown / learned_avoid / repeat_loop)
 *   from         "x,y,z": the fresh-counted town container holding the need (cobbleContainer), or null
 */
export function stoneSource ({ block, count = 16, pos = null, home = null, town = null, trigger = '', cooling = null, from = null } = {}) {
  const n = Math.max(1, Math.min(64, Math.floor(Number(count) || 16)))
  const geo = pos && home ? { d: Math.max(Math.abs(pos.x - home.x), Math.abs(pos.z - home.z)), dy: Math.round(pos.y - home.y) } : {}
  const gather = reason => ({ source: 'gather', reason, count: n, ...geo })
  if (!STONE_GATHER.has(String(block ?? ''))) return gather('not_stone')
  if (!pos || !home || ![pos.x, pos.y, pos.z, home.x, home.y, home.z].every(Number.isFinite)) return gather('no_position')
  if (STUCK_TRIGGERS.test(String(trigger ?? ''))) return gather('stuck_trigger')
  const d = Math.max(Math.abs(pos.x - home.x), Math.abs(pos.z - home.z))
  if (d > WITHDRAW_NEAR) return gather('far_from_town')
  if (cooling) return gather(`withdraw_${cooling}`)
  const avail = Number(town?.avail)
  if (!Number.isFinite(avail) || town?.known === false) return gather('town_unknown')
  if (avail - n < TOWN_STONE_FLOOR) return gather('town_short')
  // THE CONTAINER THAT HOLDS IT (Claude stage-2 P1-2: the withdraw searches the 3 containers nearest the BOT, the view counts
  // every town container): a rewrite needs a fresh-counted container with the cobble, which the withdraw opens first
  if (!from) return gather('no_counted_container')
  // AT THE SURFACE ONLY (both stage-2 reviews: a walk probe to home does not prove the withdraw's own route, which may call
  // home() and goto's dig retry from depth; a bot below the band keeps its gather). The measured cut is the surface share.
  if (pos.y - home.y < WITHDRAW_SURFACE_DY) return gather('below_surface')
  return { source: 'withdraw', reason: 'surface', count: n, from, ...geo }
}

/** The cobble a withdrawal for this gather asks for: the gather's count, 1..64 (stoneSource uses the same rule). Pure. */
export const withdrawWant = args => ({ item: 'cobblestone', count: Math.max(1, Math.min(64, Math.floor(Number(args?.count) || 16))) })

/**
 * APPLY THE VERDICT TO AN ADMITTED PROPOSAL -> the admitted action to run. Pure. Only an admitted stone gather can change,
 * and only to `withdraw cobblestone <count>`; the original is kept in `rewrittenFrom` for the row and the read.
 */
export function rewriteForStone (admitted, verdict) {
  if (!admitted || admitted.skill !== 'gather' || !STONE_GATHER.has(String(admitted.args?.block ?? ''))) return admitted
  if (verdict?.source !== 'withdraw') return admitted
  // alt: the town's cobble count includes cobbled_deepslate (Codex stage-2 P2-1): the withdraw takes it when there is no cobblestone
  return { ...admitted, skill: 'withdraw', args: { item: 'cobblestone', count: verdict.count, alt: 'cobbled_deepslate', ...(verdict.from ? { from: verdict.from } : {}) }, rewrittenFrom: { skill: 'gather', args: admitted.args } }
}

/** A rewrite that did not succeed backs off this long, whatever its count (Claude stage-2 P1-1). */
export const STONE_BACKOFF_MS = 10 * 60_000
/** The rewrite backoff after a rewritten withdraw ended -> the new "no rewrite until" time. Pure. */
export const stoneBackoffAfter = (status, now, until = 0) => status === 'success' ? until : Math.max(until, now + STONE_BACKOFF_MS)

/**
 * WHICH TOWN CONTAINER HOLDS THE COBBLE -> "x,y,z" | null. Pure. From the journal's fresh observations (cobblecap foldJournal
 * state.obs: k -> { n, at, ... }): a container counted within `ttlMs` whose cobble count covers `need`, nearest the bot.
 */
export function cobbleContainer (obs = {}, pos = null, need = 16, now = Date.now(), ttlMs = 60 * 60_000) {
  let best = null, bd = Infinity
  for (const [k, o] of Object.entries(obs ?? {})) {
    if (!o || !Number.isFinite(o.at) || now - o.at >= ttlMs) continue
    if (!(Number(o.n) >= need)) continue
    const [x, y, z] = k.split(',').map(Number)
    if (![x, y, z].every(Number.isFinite)) continue
    const d = pos ? Math.hypot(x - pos.x, y - pos.y, z - pos.z) : 0
    if (d < bd) { bd = d; best = k }
  }
  return best
}
