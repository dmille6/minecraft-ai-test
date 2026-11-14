// PLACEAUDIT-01: THE `_place_town` INSTRUMENT (owner 11-04: "if a bot needs to place a dirt block to get somewhere that means there
// isnt access or the bot was too lazy to use the access"; the groundskeeper plan's piece 2: measure before changing travel).
// TELEMETRY ONLY: nothing in this file, and nothing that reads what it writes, decides anything. Removing it changes no behaviour.
//
// WHY. No row records where a bot places a block outside a build: the pathfinder's scaffold (its towers and bridges), the escape
// reflexes' pillars, ladders and lids place through mineflayer's `bot.placeBlock` and log nothing with a position (`_scaffold_pick`
// names the material, `_inventory_mutation` the count). The LIVE showcase (11-04 copy) has 22 dirt blocks standing loose inside the
// wall, 13 of them on or beside builds -- the groundskeeper now clears them (gkstage-01 `inwall`); this says who keeps placing them,
// why and where, so access can be built where bots climb (piece 3) and the take-back-down (piece 4, tier 3) is sized on data.
//
// HOW (the `_dig_town` pattern, digtown.mjs): `bot.placeBlock` -- the one entry the pathfinder (mineflayer-pathfinder 2.4.5
// index.js:556), reflex.mjs, ladder.mjs, lidplace.mjs and the skills call -- is wrapped: the cell, the held block, the bot's feet, the
// pathfinder's building state, the async dig scope (digtown.mjs currentDigScope: goto's legs and the reflex tick run in one) and the
// CALLER (the first frame of the call stack outside this file and mineflayer itself) are read synchronously, then the ORIGINAL is
// called with the SAME arguments and its OWN promise is returned (the pathfinder's .then/.catch chain is unchanged). The outcome is
// mineflayer's own: placeBlockWithOptions resolves only once the server's block update changed the cell's type (place_block.js:8-27),
// and throws otherwise -- `placed` / `failed`. The direct build clicks (buildbot.mjs `send`: the projects' cells) do not pass here;
// they are the `_build op=place` rows.
// ROWS: `_place_town` for every placement in the town or its margin (placeZone), never sampled;
// `_place_town_sum` once a minute when anything was placed anywhere: exact counts by zone.reason.outcome.
import { currentDigScope } from './digtown.mjs'
import { homeOf } from './townground.mjs'

export const SUMMARY_MS = 60_000
/** THE SWITCH: PLACEAUDIT=off|0|false|no -> not installed; on by default (telemetry). Pure. */
export const placeAuditOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.PLACEAUDIT ?? '').trim())
/** THE TOWN for this instrument: within PLACE_TOWN_R of home (the LIVE showcase wall's interior reaches 45 from home; townground's
 *  dig box is only 16), never deeper than home.y - PLACE_TOWN_DEPTH; PLACE_MARGIN beyond it is `margin`. */
export const PLACE_TOWN_R = 48
export const PLACE_MARGIN = 16
export const PLACE_TOWN_DEPTH = 12
/** 'town' | 'margin' | null. Pure. */
export function placeZone (cell, home) {
  const h = homeOf(home)
  if (!h || !Array.isArray(cell)) return null
  const d = Math.max(Math.abs(cell[0] - Math.floor(h.x)), Math.abs(cell[2] - Math.floor(h.z)))
  if (cell[1] < Math.floor(h.y) - PLACE_TOWN_DEPTH) return null
  return d <= PLACE_TOWN_R ? 'town' : d <= PLACE_TOWN_R + PLACE_MARGIN ? 'margin' : null
}
const N = v => Math.floor(Number(v))

/**
 * WHO PLACED IT AND WHY -> { reason, by }. Pure.
 *   frames    the call stack's lines, top first (new Error().stack.split('\n').slice(1))
 *   building  bot.pathfinder.isBuilding() at the call;  scope  currentDigScope() ({ purpose, by } | null)
 * reason: 'pathfinder' (its scaffold: a tower or a bridge) | 'reflex' (an escape's pillar, a seal) | 'ladder' | 'lid' | 'skill' (a
 * skill's own placement, `by` its function) | 'other'. The pathfinder wins (its tick runs outside every scope); then a reflex frame or
 * a survival scope; then the first of our own source files on the stack.
 */
export function placeReason ({ frames = [], building = false, scope = null } = {}) {
  const fs = (frames ?? []).map(String)
  if (building || fs.some(f => f.includes('mineflayer-pathfinder'))) return { reason: 'pathfinder', by: scope?.by ? String(scope.by) : 'pathfinder' }
  const own = fs.find(f => /\/src\/[a-z0-9_-]+\.mjs/.test(f) && !/placeaudit\.mjs/.test(f))
  const file = own ? /\/src\/([a-z0-9_-]+)\.mjs/.exec(own)[1] : null
  const fn = own ? (/at (?:async )?([A-Za-z0-9_$.]+) \(/.exec(own)?.[1] ?? '?') : null
  if (file === 'reflex' || file === 'escape' || file === 'floodpocket' || file === 'climbflood' || scope?.purpose === 'survival') return { reason: 'reflex', by: fn ?? String(scope?.by ?? 'reflex') }
  if (file === 'ladder') return { reason: 'ladder', by: fn ?? 'ladder' }
  if (file === 'lidplace') return { reason: 'lid', by: fn ?? 'lidplace' }
  if (file) return { reason: 'skill', by: `${file}:${fn}` }
  return { reason: 'other', by: scope?.by ? String(scope.by) : '?' }
}
/**
 * THE PLACEMENT'S SHAPE against the bot's feet -> 'pillar' (the cell under the feet column: a tower) | 'bridge' (below the feet,
 * another column) | 'step' (at the feet's height or above). Pure. cell, feet: [x, y, z] (feet null: 'unknown').
 */
export function placeShape (cell, feet) {
  if (!Array.isArray(feet)) return 'unknown'
  if (cell[0] === feet[0] && cell[2] === feet[2] && cell[1] < feet[1]) return 'pillar'
  if (cell[1] < feet[1]) return 'bridge'
  return 'step'
}
export const emptySummary = () => ({ all: 0, by: {}, ierr: 0 })
/** The minute's counts as a compact detail. Pure. */
export function summaryDetail (sum, windowS) {
  const rest = Object.entries(sum.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('; ')
  return `w=${windowS}s all=${sum.all} ierr=${sum.ierr}${rest ? ` | ${rest}` : ''}`
}

/**
 * Install the wrapper on one bot -> { final, stats } | null (already wrapped, or no placeBlock). Never throws into the caller.
 *   home  { x, y, z };  emitPlace({ detail, args }), emitSummary({ detail, args })
 */
export function attachPlaceAudit (bot, { home, emitPlace, emitSummary, timers = true, now = () => Date.now(), summaryMs = SUMMARY_MS } = {}) {
  // once a BOT (never by the function on top: skills.mjs's bag tally wraps placeBlock for a visit and restores only when it is still on
  // top -- a second install at a respawn under it would double every row and strand its restore)
  if (!bot || typeof bot.placeBlock !== 'function' || bot.placeBlock.__placeaudit || bot.__placeAudit) return null
  bot.__placeAudit = true
  const orig = bot.placeBlock
  let sum = emptySummary(), winStart = now(), closed = false
  const stats = { wrapped: 0, settled: 0 }
  const capture = (ref, face) => {
    const p = ref?.position
    if (!p || !face) return null
    const cell = [N(p.x + face.x), N(p.y + face.y), N(p.z + face.z)]
    if (!cell.every(Number.isFinite)) return null
    const e = bot.entity?.position
    const feet = e ? [Math.floor(e.x), Math.floor(e.y + 1e-6), Math.floor(e.z)] : null
    let building = false
    try { building = !!bot.pathfinder?.isBuilding?.() } catch { sum.ierr++ }
    const frames = String(new Error().stack ?? '').split('\n').slice(1)
    const { reason, by } = placeReason({ frames, building, scope: currentDigScope() })
    const zone = placeZone(cell, home)
    return { cell, feet, block: bot.heldItem?.name ?? '?', reason, by, shape: placeShape(cell, feet), zone, profile: String(bot.movementProfile ?? '?'), t0: now() }
  }
  const settle = (rec, err) => {
    if (closed || !rec) return
    try {
      const outcome = err ? 'failed' : 'placed'
      stats.settled++
      sum.all++
      const k = `${rec.zone ?? 'out'}.${rec.reason}.${rec.shape}.${outcome}`
      sum.by[k] = (sum.by[k] ?? 0) + 1
      if (rec.zone) {
        const args = { x: rec.cell[0], y: rec.cell[1], z: rec.cell[2], block: rec.block, reason: rec.reason, by: rec.by, shape: rec.shape, zone: rec.zone, outcome, feet: rec.feet, profile: rec.profile, ms: now() - rec.t0 }
        try { emitPlace({ detail: `pos=${rec.cell.join(',')} block=${rec.block} reason=${rec.reason} by=${rec.by} shape=${rec.shape} zone=${rec.zone} outcome=${outcome} profile=${rec.profile}`, args }) } catch { sum.ierr++ }
      }
    } catch { sum.ierr++ }
  }
  const wrapped = function (...args) {
    let rec = null
    try { rec = closed ? null : capture(args[0], args[1]); if (rec) stats.wrapped++ } catch { rec = null; sum.ierr++ }
    // the caller's arguments exactly as given (Codex r1 BLOCKER: never an explicit undefined for an omitted one)
    const pr = orig.apply(this, args)
    // observe only: the caller gets the ORIGINAL promise (its rejection still reaches the caller's catch)
    try { Promise.resolve(pr).then(() => settle(rec, null), e => settle(rec, e ?? new Error('failed'))) } catch { sum.ierr++ }
    return pr
  }
  wrapped.__placeaudit = true
  bot.placeBlock = wrapped
  const flush = () => {
    if (!sum.all && !sum.ierr) { winStart = now(); return }
    try { emitSummary({ detail: summaryDetail(sum, Math.round((now() - winStart) / 1000)), args: { all: sum.all, by: { ...sum.by }, ierr: sum.ierr } }) } catch { /* telemetry */ }
    sum = emptySummary(); winStart = now()
  }
  let timer = null
  if (timers) { timer = setInterval(flush, summaryMs); timer.unref?.() }
  const final = () => { if (closed) return; flush(); closed = true; if (timer) clearInterval(timer) }
  return { final, flush, stats }
}

// ================================================================================================================================
// ACCESS-02: THE CLIMBS LEDGER (the groundskeeper's second input for its staircases). LIVE showcase 11-04 15:52-21:40Z: 1,389
// `_place_town` rows; 173 pathfinder/reflex pillars and steps PLACED at the surface band (y >= home.y - 4) in 136 cells, 33 3x3
// spots with two or more (the busiest 17). The instrument stays an observer: it only APPENDS what it saw to a per-bot town file
// (`climbs-<bot>.jsonl`, bounded); the groundskeeper's inwall survey reads every bot's file (tidy.mjs climbSpots) and decides there.
// ================================================================================================================================
export const CLIMB = Object.freeze({ band: 4, keepMs: 48 * 60 * 60_000, maxLines: 2000, keepLines: 1000 })
/** Is a `_place_town` placement a CLIMB the ledger keeps? -> bool. Pure. Placed, in the town, by the pathfinder or a reflex, a pillar or
 *  a step, at the surface band (no deeper than home.y - CLIMB.band: a mine under the town is no climb). */
export function climbOf (args, home, T = CLIMB) {
  // roughground-01 (owner 11-07: floating dirt beams in the trees round the town): the bridges too, and the town's MARGIN (the first
  // band outside the wall): the keeper takes back what still stands of them (roughground.mjs surveyRough's SCAFFOLD); climbSpots
  // keeps building its staircases from the town's pillars and steps only
  return !!args && args.outcome === 'placed' && (args.zone === 'town' || args.zone === 'margin') && (args.reason === 'pathfinder' || args.reason === 'reflex') &&
    (args.shape === 'pillar' || args.shape === 'step' || args.shape === 'bridge') && Number.isFinite(args.y) && !!home && args.y >= Math.floor(home.y) - T.band
}
