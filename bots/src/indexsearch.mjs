// INDEXSEARCH-01: THE TOWN SEARCH OPENS THE CONTAINERS THE INDEX SAYS HOLD THE NEED FIRST (design
// docs/reports/town-plan-2026-10-20.md section 7.7; OWNER 10-20 ~12:30Z "yes, lets do this").
//
// WHY (measured 10-20, 24 h of rows; the 00:15Z read-only RCON census): 428 of 660 `toolkit` runs failed "no town container in
// reach holds 1 iron ingot with 4 to spare" and 441 of 1,582 `smelt_town` runs found "no coal in the town containers looked
// in", in towns that held both -- iron ingots in 9-25 containers per town. toolkit-03 moved the kit's iron and the job's coal
// onto withdraw_pick's every-container search (withdrawpick.mjs townSearchOrder over skills.mjs townSearchView), but that
// search puts a container first (tier 0) only when the STOCK JOURNAL counts the need, and iron, copper and coal are no
// journal group: the iron's container was one unknown among all, taken nearest the bot first.
//
// THE RULE: the town index (townindex-01, townindex.mjs) knows what each container held at its last open. For every need the
// index can count, a KNOWN (opened since its last mutation) and FRESH (< 6 h) entry holding enough of it becomes a count the
// search ranks by -- tier 0, ahead of the unknown containers. Only POSITIVE evidence is added: an index entry holding none,
// and every stale / dirty / unknown entry, changes nothing (they stay tier 1, nearest first, as today); a journal count newer
// than the index's wins; a miss recorded after the index's open still rules the container out (townSearchOrder: a count no
// newer than a miss is stale). So the search only ever opens the right container EARLIER; it never skips one it opened before.
//
//   need          what the index counts                        enough
//   kit_iron      iron_ingot                                    4 + TOWN_IRON_KEEP (the kit's whole draw and the keep)
//   kit_iron_<n>  iron_ingot                                    n + TOWN_IRON_KEEP
//   coal          the job's fuels (smeltjob.mjs JOB_FUELS)      1
//   raw_copper    raw_copper (the job's input)                  1
//   raw_iron      raw_iron (ironsmelt-01: the job's first input) 1
//   stick / cobblestone / planks   withdrawpick NEEDS' matchers 1
//   pick, trippick: never -- the index records no wear, and a spent copy is no pickaxe
//
// KITSTICKS (the design's stated requirement on toolkit-03, section 7.7 / 8 K1, shipped here because toolkit-03 does not meet
// it): toolkit-03 takes the kit's sticks only from the iron's own container, or makes them from the bag's wood; a bag with no
// wood refuses iron from a container without sticks (kitTakes `noSticks`). Now, when the bag cannot make the sticks
// (kitSticksAtRisk), the toolkit first draws them from WHICHEVER town container holds them (the same town search, need
// `stick`: the journal counts sticks), then draws the iron from any container. KITSTICKS=off is its own rollback.
//
// INDEXSEARCH=off is the one-setting rollback of the ranking (today's search exactly).

import { indexHolding } from './townindex.mjs'
import { NEEDS } from './withdrawpick.mjs'
import { KIT_IRON_NEED, TOWN_IRON_KEEP } from './toolkit.mjs'
import { SMELT_JOB_INPUT, SMELT_JOB_FUEL, JOB_FUELS, SMELT_IRON_INPUT } from './smeltjob.mjs'

const onOff = (v, dflt = true) => (v == null || String(v).trim() === '' ? dflt : String(v).trim().toLowerCase() !== 'off')
export const INDEXSEARCH = Object.freeze({ on: onOff(typeof process !== 'undefined' ? process.env.INDEXSEARCH : null) })
export const KITSTICKS = Object.freeze({ on: onOff(typeof process !== 'undefined' ? process.env.KITSTICKS : null) })

/** An index observation stamped later than this past the reader's clock is ignored (cross-host clock skew). */
export const FUTURE_SLACK_MS = 60_000
/** What the index counts for `need`, and how much is enough -> { match, min } | null (a need the index cannot judge). Pure. */
export function indexNeed (need, { keep = TOWN_IRON_KEEP } = {}) {
  const n = String(need ?? '')
  if (n === KIT_IRON_NEED) return { match: x => x === 'iron_ingot', min: 4 + keep }
  const m = new RegExp(`^${KIT_IRON_NEED}_(\\d+)$`).exec(n)
  if (m) return { match: x => x === 'iron_ingot', min: Math.max(1, Number(m[1])) + keep }
  if (n === SMELT_JOB_FUEL) return { match: x => JOB_FUELS.includes(x), min: 1 }
  if (n === SMELT_JOB_INPUT) return { match: x => x === SMELT_JOB_INPUT, min: 1 }
  // x ironsmelt-01 (Codex + Claude design r1): the job's IRON pass is ranked too -- a known holder of raw iron first
  if (n === SMELT_IRON_INPUT) return { match: x => x === SMELT_IRON_INPUT, min: 1 }
  if (NEEDS[n]) return { match: NEEDS[n].match, min: 1 }
  return null
}

/**
 * THE INDEX'S COUNTS FOR THE SEARCH -> { need: { k: { n, at, src: 'ix' } } }. Pure. `entries`: the town index's fold
 * ({ k: entry }); `keys`: the search's containers (one key per double chest, as the index keys them). Only a KNOWN, fresh entry
 * holding at least the need's `min` is a count.
 */
export function indexSearchCounts (entries = {}, keys = [], needs = [], now = Date.now()) {
  const out = {}
  for (const need of (Array.isArray(needs) ? needs : [])) {
    const spec = indexNeed(need)
    out[need] = {}
    if (!spec) continue
    for (const k of (Array.isArray(keys) ? keys : [])) {
      const h = indexHolding(entries?.[k], spec.match, now)
      // an observation stamped in the FUTURE (another host's clock ahead by more than FUTURE_SLACK_MS) is no count at all: it
      // could outrank every later look (Claude code r1 P3); clamping it to `now` re-advanced it at every read (Codex code r2 P3)
      if (h && h.n >= spec.min && h.at <= now + FUTURE_SLACK_MS) out[need][k] = { n: h.n, at: h.at, src: 'ix' }
    }
  }
  return out
}

/** THE SEARCH'S COUNTS: the journal's, with an index count wherever the journal has none or an older one -> same shape. Pure. */
export function mergeSearchCounts (journal = {}, index = {}) {
  const out = {}
  for (const need of new Set([...Object.keys(journal ?? {}), ...Object.keys(index ?? {})])) {
    const j = { ...(journal?.[need] ?? {}) }
    for (const [k, c] of Object.entries(index?.[need] ?? {})) {
      const have = j[k]
      if (!have || !Number.isFinite(have.at) || c.at > have.at) j[k] = c
    }
    out[need] = j
  }
  return out
}

/** Was the container the search ranks first put there by the index? (a tier-0 entry whose count is the index's) Pure. */
export const firstFromIndex = (order = [], counts = {}, need) => !!(order?.[0] && order[0].tier === 0 && counts?.[need]?.[order[0].k]?.src === 'ix')

/** The `_index_search` change row (one per search pass that ran; its duration spans the pass's walks). Pure, <= 300. */
export const indexSearchRow = ({ by = '-', need = '-', town = 0, cand = 0, ix = 0, first = '-', visits = 0, took = 0, hit = 0, tried = [] } = {}) =>
  `by=${by} need=${need} town=${town} cand=${cand} ix=${ix} first=${first} visits=${visits} took=${took ? 1 : 0} hit=${hit ? 1 : 0} tried=[${(tried ?? []).join(';')}]`.slice(0, 300)

/** The `_indexsearch_mode` licence row (once per spawn): a kind the baseline cannot write. */
export const indexSearchModeDetail = () =>
  `phase=mode rank=${INDEXSEARCH.on ? 'index' : 'off'} kitsticks=${KITSTICKS.on ? 'on' : 'off'} needs=kit_iron,coal,raw_copper,raw_iron,stick,cobblestone,planks fresh_h=6 positive_only=1`

/** How many sticks the kit's pre-draw takes from one container -> n (0: none here). Pure. */
export const kitStickTake = (inChest = [], want = 0) => Math.max(0, Math.min(Number(want) || 0,
  (Array.isArray(inChest) ? inChest : []).reduce((t, it) => t + (it?.name === 'stick' ? (it.count ?? 0) : 0), 0)))
/** Visits the kit's stick pre-draw may make (the iron's search keeps KIT_SEARCH_VISITS of its own). */
export const KIT_STICK_VISITS = 4
/** ...and it starts none inside this much of the draw's clock beyond the crafts' reserve (the iron's search keeps it). */
export const KIT_STICK_IRON_RESERVE_MS = 30_000
