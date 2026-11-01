// CEILESCAPE-01: NEVER START A RAMP SWING THAT CANNOT FINISH (docs/reports/ceilescape-01-design-2026-10-24.md). Pure: no bot.
//
// WHY. board-a-Comet has floated in one water column under copper ore since ~09-28 (docs/reports/boarda-comet-trap-2026-10-23.md):
// 864 escape ramps in 7 days, each one swinging a bare hand at copper_ore for the whole 60 s budget and stopping "dig exceeded".
// The ramp prices the ceiling GROUNDED and DRY (15 s, under the 30 s cap), but the bot is in water at the eye and off the
// ground, and the registry's price there is 375 s. One cheap exit -- the ladder and dirt east of it, 33.75 s at the same
// penalties -- was reachable only after a FLOOD refusal, never after a timeout. placebo-c-Bravo (a sealed flooded stone shaft)
// is the same arithmetic with no exit at all: 1,331 timeouts in 7 days.
//
// THE FACT THIS RESTS ON (design section 2). mineflayer fixes a dig's wait when the dig STARTS: `waitTime = bot.digTime(block)`
// from the HELD item, the eye-level water and onGround at that moment, then `setTimeout(finishDigging, waitTime)`
// (lib/plugins/digging.js:27, 135, 248-252). `digBounded` stops it at the time left (`stopDigging` sends the abort), and an
// aborted dig's progress is discarded. So a swing whose start price exceeds the time left cannot complete on its own and leaves
// nothing behind: declining it removes no move that could have worked. Every branch here acts ONLY where today's swing is
// certain to time out, so an affordable swing takes exactly today's path.
//
// The registry stays the only source of hardness: `canBreak` and every refusal stay on the GROUNDED price (dig-split.test.mjs).
// The environmental price only answers "can THIS swing finish in the time left" -- the question the deadline already asks.

/** CEILESCAPE=0 turns the new branch off (the one-setting rollback): the ramp then swings as it does today, and the
 *  `_ceilescape` row still says what it WOULD have done (`action=off`). Anything else, or unset, leaves it on. */
export const ceilEscapeOn = (env = typeof process !== 'undefined' ? process.env : {}) => String(env?.CEILESCAPE ?? '1') !== '0'

export const CE_RESERVE_MS = 3000          // a lateral exit must leave this much of the ramp's budget unspent
export const CE_MOVE_MS = 4500             // the sidestep's look, a swim-up of at most 2000 and a forward of at most 2000, + 250 settle
export const CE_DIG_OVERHEAD_MS = 250      // per dig: the look at the face and the hand check before the swing (Codex r1 P2-7)
export const CE_FLOW_SETTLE_MS = 300       // = reflex.mjs FLOW_SETTLE_MS, paid after every dig (digChecked); a test pins the equality
export const CE_FALLING_SETTLE_MS = 500    // = reflex.mjs FALLING_SETTLE_MS, paid once after a sidestep's digs
export const CE_SETTLE_SAMPLE_MS = 1000    // the stable-state sampler: two samples this far apart must agree...
export const CE_SETTLE_MAX_MS = 5000       // ...or this much time has passed
export const CE_REPLANS = 1                // a sidestep displaced during its digs is re-planned from scratch at most this often
export const CE_RESCUE_ROW_MS = 30 * 60_000   // one `_needs_rescue` row per cell per this long (the decision row is every firing)

const DIR = { '0,-1': 'N', '1,0': 'E', '0,1': 'S', '-1,0': 'W' }
/** N/E/S/W for a unit cardinal {x,z}. */
export const dirName = bear => DIR[`${bear?.x ?? 0},${bear?.z ?? 0}`] ?? '?'

/** The environment as a compact tag for rows: g1 = on the ground, w1 = eye in water. */
export const envTag = env => `g${env?.notOnGround ? 0 : 1}w${env?.inWater ? 1 : 0}`

const known = ms => Number.isFinite(ms) && ms >= 0
const s = ms => (known(ms) ? (ms / 1000).toFixed(1) : '?')

/** May this ONE swing start? Unknown price = yes ("try it", as planDig has it); otherwise only if it can finish in `leftMs`. */
export const swingFits = (priceMs, leftMs) => !known(priceMs) || priceMs <= leftMs

/**
 * THE FULL COST OF ONE SIDESTEP, or null when any part of it cannot be priced ("I cannot price it" is not "it is cheap").
 *   digMs     each cell the sidestep breaks, at the bot's CURRENT price (the held item and environment it digs them with)
 *   newCeilMs the new column's ceiling at the price it will be dug at after the step (0 when that cell is already open)
 * Plus, per dig, the look/hand overhead and the flow settle; one falling settle when anything is dug; the move; and for a
 * solid new ceiling its own overhead, flow settle and falling settle (Codex r2 P2-6).
 */
export function sidestepCostMs ({ digMs = [], newCeilMs = 0 } = {}) {
  if (!Array.isArray(digMs) || !digMs.every(known) || !known(newCeilMs)) return null
  const digs = digMs.reduce((a, b) => a + b, 0)
  return digs + digMs.length * (CE_DIG_OVERHEAD_MS + CE_FLOW_SETTLE_MS) + (digMs.length ? CE_FALLING_SETTLE_MS : 0) +
         CE_MOVE_MS + (newCeilMs ? newCeilMs + CE_DIG_OVERHEAD_MS + CE_FLOW_SETTLE_MS + CE_FALLING_SETTLE_MS : 0)
}

/**
 * WHAT A FRESH FIRING CAN SPEND on a swing it must first settle for (Codex r2 P2-5, Claude r2 P3-1): a swing that does not fit
 * at its first price is re-priced only after the settle, so "would fit a full firing" means after that settle too. Comparing
 * against the bare budget left a 1-5 s window in which every firing waited and none ever escalated.
 */
export const freshBudgetMs = fullMs => Math.max(0, fullMs - CE_SETTLE_MAX_MS)

/**
 * THE CEILING DECISION.
 *   ceilingMs   the ceiling's price NOW (the hand that will dig it + environment; after the settle when the first did not fit)
 *   leftMs      the ramp's budget left;  fullMs  a whole firing's budget (escapeStairUp's budgetMs)
 *   candidates  [{ bear, digMs: [...], newCeilMs, wet }] -- every bearing allowed, in escapeBearings order; `wet` = the
 *               destination feet cell is water now
 *   refusals    [{ bear, reason }] -- the bearings that were not, for the reason text
 *   moved       a sidestep was already taken this firing (one per firing)
 * -> { action: 'ceiling' }                       today's code: the swing fits the time left, or its price is unknown
 *  | { action: 'lateral', bear, costMs, ranked } the cheapest sidestep that fits the time left (ties: dry first, then facing)
 *  | { action: 'wait', reason, ranked }          no swing now and NO flag: a fresh firing (after its settle) would fit the
 *                                                ceiling or a sidestep -- which this decision itself takes when it fits --
 *                                                or this firing already moved the bot (Claude r1 P1-3)
 *  | { action: 'escalate', reason, bestMs, best, ranked }  not even a fresh firing fits anything: a named stop and the flag
 */
export function ceilingEscapeDecision ({ ceilingMs = null, leftMs = 0, fullMs = 60_000, candidates = [], refusals = [],
                                         block = 'the ceiling', moved = false } = {}) {
  // No reserve on this comparison on purpose: an affordable ceiling must take exactly today's path (the "unchanged" case).
  if (swingFits(ceilingMs, leftMs)) return { action: 'ceiling' }
  const ranked = candidates
    .map((c, i) => ({ ...c, i, costMs: sidestepCostMs(c) }))
    .sort((a, b) => (a.costMs ?? Infinity) - (b.costMs ?? Infinity) || (a.wet ? 1 : 0) - (b.wet ? 1 : 0) || a.i - b.i)
  const best = ranked.find(c => c.costMs != null) ?? null
  const fitsIn = (c, ms) => c.costMs != null && c.costMs + CE_RESERVE_MS <= ms
  const fresh = freshBudgetMs(fullMs)
  const head = `${block} ${s(ceilingMs)}s against ${s(leftMs)}s left`
  const bestText = best ? `best bearing ${dirName(best.bear)} ${s(best.costMs)}s` : 'no side column'
  const why = refusals.length ? ` (${refusals.map(r => `${dirName(r.bear)}: ${r.reason}`).join('; ')})` : ''
  if (moved) return { action: 'wait', reason: `${head} after this firing's sidestep; the next firing re-plans from here`, ranked }
  const pick = ranked.find(c => fitsIn(c, leftMs)) ?? null
  if (pick) return { action: 'lateral', bear: pick.bear, costMs: pick.costMs, ranked }
  if (swingFits(ceilingMs, fresh) || ranked.some(c => fitsIn(c, fresh))) {
    return { action: 'wait', reason: `${head}; ${bestText}; a fresh firing (${s(fresh)}s after its settle) would fit${why}`, ranked }
  }
  return {
    action: 'escalate',
    reason: `no affordable ramp exit: ${head}; ${bestText}, and nothing fits a fresh firing (${s(fresh)}s)${why}`,
    bestMs: best?.costMs ?? null,
    best: best?.bear ?? null,
    ranked,
  }
}

/**
 * THE FIRST SWING OF A FIRING THAT CANNOT FINISH, ON THE STEP LOOP (placebo-c-Bravo's marooned ramps time out on a STEP).
 * Only the swing is declined -- the step loop then stops exactly where today's would have timed out, and cells already
 * cleared stay cleared, so a step two affordable swings long still completes over two firings (Codex r1 P1-2). No other
 * bearing is substituted (both reviews: no measured beneficiary). This decides only whether the stop is ALSO an escalation.
 *
 * THE CHOOSER'S BEARING DECIDES (Codex r2 P2-5): the loop will pick the same bearing again from the same cell, so another
 * bearing that could start is named in the reason, not counted as a way out. A bearing whose step needs NO swing is
 * different (Claude r2 P2-2): that is a move the bot has, so a firing with one is never escalated.
 *   chosen  { bear, priceMs }      the swing the loop was about to start
 *   others  [{ bear, priceMs }]    the first swing of every other bearing stairUpStep allows (priceMs 0: no dig needed)
 * -> { escalate: boolean, reason }
 */
export function firstSwingEscalation ({ chosen = null, others = [], leftMs = 0, fullMs = 60_000, block = 'the step' } = {}) {
  const fresh = freshBudgetMs(fullMs)
  const head = `${block} ${dirName(chosen?.bear)} ${s(chosen?.priceMs)}s against ${s(leftMs)}s left`
  if (swingFits(chosen?.priceMs, fresh)) return { escalate: false, reason: `the next swing cannot finish: ${head}; a fresh firing (${s(fresh)}s) would fit it` }
  const free = others.filter(o => o.priceMs === 0)
  if (free.length) return { escalate: false, reason: `the next swing cannot finish: ${head}; ${free.map(o => dirName(o.bear)).join(',')} needs no swing` }
  const could = others.filter(o => swingFits(o.priceMs, fresh))
  return { escalate: true,
           reason: `no affordable first swing: ${head}; the chooser's bearing fits no fresh firing (${s(fresh)}s)` +
                   (could.length ? `; ${could.map(o => dirName(o.bear)).join(',')} could start but is not the chooser's` : '') }
}

/**
 * HAS THE ENVIRONMENT SETTLED? `samples` are [{ t, onGround, inWater }] oldest first. Stable = the last two agree and are at
 * least CE_SETTLE_SAMPLE_MS apart; done = stable, or CE_SETTLE_MAX_MS has passed since the first. Pure.
 */
export function envSettled (samples = []) {
  const n = samples.length
  if (!n) return { done: false, stable: false }
  const a = samples[n - 2], b = samples[n - 1]
  const stable = !!a && !!b.onGround === !!a.onGround && !!b.inWater === !!a.inWater && b.t - a.t >= CE_SETTLE_SAMPLE_MS
  return { done: stable || b.t - samples[0].t >= CE_SETTLE_MAX_MS, stable }
}

const WATER = /^(water|flowing_water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
const isWater = b => !!b && (WATER.test(b.name ?? '') || b.isWaterlogged === true)
const solid = b => !!b && b.boundingBox === 'block'
/** A water cell's level: 0 a source, 1-7 flowing, 8+ falling; null when it cannot be read (prismarine-block: properties.level). */
export function waterLevel (b) {
  if (!b || !/^(water|flowing_water)$/.test(b.name ?? '') || b.isWaterlogged === true) return null
  const v = Number(b.getProperties?.()?.level ?? b._properties?.level)
  return Number.isFinite(v) ? v : null
}

/**
 * WOULD WATER ENTER THIS CELL ONCE IT IS OPEN? `at(dx,dy,dz)` is relative to the cell. -> reason | null. Pure.
 *
 * The destination HEAD cell of a sidestep must stay breathable, and for a bot that starts SUBMERGED the shared flood check
 * exempts water (`overheadBreakRisk` with `submerged`), so nothing else asks this (Codex r1 P1-3: refuse unsafe head flooding
 * independently of the wet-feet rule). CONSERVATIVE BY CONSTRUCTION (Codex r2 P1-3, Claude r2 P3-4): every water neighbour
 * floods the cell EXCEPT the one case vanilla's FlowingFluid.spread provably keeps out --
 *   a FLOWING or FALLING (non-source) water cell whose cell below is plain WATER (a water hole: it flows down, never
 *   sideways) and which has NO source beside it (vanilla also spreads sideways after a downward flow when 3 sources
 *   neighbour it; any source at all refuses here). Level 7 is vanilla's last level and spreads nowhere.
 * Everything else refuses: water above; a source; a waterlogged block (it holds a source); flowing water over air, a
 * waterlogged block, a plant, a slab or any other non-water cell; an unreadable level; an unloaded cell. Face occlusion is
 * ignored, which can only refuse more. Paper is the arbiter; the sidestep re-asks this before it moves.
 * Comet's east head cell passes on exactly that exemption (its own level-2 head water rests on falling water); its west
 * head cell (falling water on stone beside it) refuses.
 */
export function cellFloods (at) {
  const up = at(0, 1, 0)
  if (!up) return 'terrain not loaded above the head cell'
  if (isWater(up)) return `water above the head cell (${up.name})`
  const plainWater = b => !!b && /^(water|flowing_water)$/.test(b.name ?? '') && b.isWaterlogged !== true
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = at(x, 0, z)
    if (!n) return 'terrain not loaded beside the head cell'
    if (!isWater(n)) continue
    const lv = waterLevel(n)
    if (lv === null || lv === 0) return `a water source beside the head cell (${n.name})`
    if (lv === 7) continue
    const under = at(x, -1, z)
    if (!under) return 'terrain not loaded beside the head cell'
    if (!plainWater(under)) return `water beside the head cell spreads in (level ${lv} over ${under.name})`
    for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (x + a === 0 && z + c === 0) continue                    // the cell itself
      const m = at(x + a, 0, z + c)
      if (!m) return 'terrain not loaded beside the head cell'
      if (isWater(m) && (waterLevel(m) === 0 || waterLevel(m) === null)) return `water beside the head cell has a source beside it (${m.name})`
    }
  }
  return null
}

/**
 * Is a `_needs_rescue` row due? One per cell per CE_RESCUE_ROW_MS (Claude r2 P3-3: a bot that alternates between two cells,
 * as placebo-c-Bravo does between its entombed and marooned heights, is limited per cell, not reset by every change).
 * `seen` is a Map of cell key -> last row time, kept to the 8 most recent cells. Pure apart from updating `seen` when due.
 */
export function rescueRowDue (seen, cell, now = Date.now()) {
  if (!cell) return false
  const k = `${cell.x},${cell.y},${cell.z}`
  const last = seen?.get?.(k)
  if (last != null && now - last < CE_RESCUE_ROW_MS) return false
  if (seen?.set) {
    seen.delete(k); seen.set(k, now)
    while (seen.size > 8) seen.delete(seen.keys().next().value)
  }
  return true
}

/** The `_ceilescape_mode` licence row, once per spawn (index.mjs): on=0 under CEILESCAPE=0, so the rollback is visible. Pure. */
export function ceilEscapeModeDetail (env = typeof process !== 'undefined' ? process.env : {}) {
  return `on=${ceilEscapeOn(env) ? 1 : 0} reserve_ms=${CE_RESERVE_MS} move_ms=${CE_MOVE_MS} ` +
    `settle_ms=${CE_SETTLE_SAMPLE_MS}/${CE_SETTLE_MAX_MS} replans=${CE_REPLANS} rescue_row_min=${CE_RESCUE_ROW_MS / 60_000}`
}
