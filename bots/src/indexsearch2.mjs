// THE TOWN SEARCH SKIPS WHAT THE INDEX KNOWS IS NOT THERE (indexsearch-02 = storehub piece C; design
// docs/reports/storehub-design-2026-11-03.md section 3.7 and section 6 row C; OWNER 11-03 ~21:30Z "yes to all").
//
// MEASURED (storehub design 1.3, 24 h to 11-03): withdraw_pick 316 searches visited 7.9 chests on average (64 hit the 16
// cap) and 86% of visits found nothing; the kit's search 451 searches, 4.1 chests, 78% empty; showcase 93% / 68%. The town
// index (townindex.mjs) already knew what each of those chests held at its last open, and nothing in the search read it.
// REPLAYED (this piece, the index files on disk against every search's tried= list, the index state taken at the search's
// start): fleet 21.6 h, 243 withdraw_pick searches -- 575 of 908 visits were to a chest the index knew (fresh, clean) did
// not hold the need, and 0 of those 575 found it; 421 kit searches -- 1,239 of 1,669 visits, 0 hits among them. Showcase
// 24 h: withdraw_pick 58 of 67 visits, kit 84 of 137, 0 hits. Positive control: 357 of the kit's 380 hits (20 of
// withdraw_pick's 22) were in chests the index showed holding the need.
//
// THE RULE (pure; skills.mjs townSearchNext feeds it, withdrawpick.mjs townSearchOrder applies it):
//   NEGATIVE  a container whose index entry is KNOWN (townindex.mjs indexStateOf: no mutation since the observation or open
//             across it) and younger than the NEED'S OWN MISS LIFE (`ttl`: SEARCH_MISS_TTL_MS, 60 min, for the pickaxe, the
//             ingredients and the kit's iron -- never past INDEX_STALE_MS, the design's 6 h bound), not stamped more than
//             INDEX_FUTURE_SLACK_MS ahead, with no
//             deposit recorded into either half after it (town memory o=took, beyond RULE_OUT_TOOK_SLACK_MS: smeltjob's
//             rule-out rule), and whose observation fails EVERY need by that need's OWN miss rule (needLacks) -- the same
//             sentence a visit would have written into the miss memory, read off an open some other skill already made.
//             It is skipped -- except INDEX_RECHECK_VISITS per pass (below).
//   POSITIVE  the same freshness, and the observation passes some need: that container is tier 0 (with the journal's
//             holders), the design's "chests the index shows holding the need first".
//   UNJUDGED  a need needLacks does not know (null): no index evidence at all for that search -- today's behaviour.
//   NEVER     an `untrusted` container (an intake chest a hopper feeds: it changes with no dirty mark -- storehub piece D;
//             none exists yet, the set is empty until piece A registers the hub) is never given a negative.
// A NEGATIVE IS NO STRONGER THAN A MISS (Codex code r1 BLOCK: with the 6 h life, a search could end -- crafting, or the kit's
// no_iron and its backoff -- while a WRONG negative had hours left). It is exactly the look a visit would have written as a
// miss, so it lives as long as that miss: a wrong one ends when the miss it stands for would have, and the container is an
// ordinary candidate again (the journal's count of none -- withdrawpick.mjs zeroLive -- is the same kind of look, and is OUT
// for the miss life with no recheck at all).
// THE SECOND PASS (the design's "an index that is wrong still finds the item"): a negative is demoted, not forgotten -- each
// pass may still open INDEX_RECHECK_VISITS of them, the OLDEST observation first, after every other candidate. Its open
// writes a fresh observation (and a miss when it is empty), so a wrong negative is also corrected by the search itself, and a
// town with none of the need costs one visit instead of up to 16.
// REPLAYED AT THE 60-MIN LIFE: fleet 21.9 h, withdraw_pick 360 of 914 visits, kit 818 of 1,676; showcase 24 h 41 of 70 and
// 81 of 141 -- 0 hits among them (at 6 h: 575 / 1,239 / 58 / 84, also 0).
// The order's GATES (townSearchEmpty: townPickMiss, townIngredientMiss, townKitIronMiss) do not read the index: an order is
// issued exactly when it is today; only where it looks changes.
//
// INDEXSEARCH2=off is the one-setting rollback (no index evidence: today's search).

import { indexStateOf, INDEX_STALE_MS } from './townindex.mjs'
import { NEEDS, PICK_RE } from './withdrawpick.mjs'
import { tier } from './toolfor.mjs'
import { TOWN_IRON_KEEP, KIT_IRON_NEED, KIT_IRON_ANY } from './toolkit.mjs'
import { INDEX_FUTURE_SLACK_MS, RULE_OUT_TOOK_SLACK_MS } from './smeltjob.mjs'

const OFF = ['off', '0', 'false', 'no']
export const INDEXSEARCH2 = Object.freeze({ on: !OFF.includes(String((typeof process !== 'undefined' ? process.env?.INDEXSEARCH2 : '') ?? '').trim().toLowerCase()) })
/** Index-negative containers one search pass may still open (the oldest observation first): the self-correction. */
export const INDEX_RECHECK_VISITS = 1

const heldOf = (names, match) => {
  let n = 0
  for (const [name, v] of Object.entries(names ?? {})) if (match(name)) n += Math.max(0, Number(v?.[0]) || 0)
  return n
}
const kitIronSize = need => {
  if (need === KIT_IRON_NEED) return 4
  const m = new RegExp(`^${KIT_IRON_NEED}_(\\d+)$`).exec(String(need ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * DOES AN OBSERVATION RULE A CONTAINER OUT FOR `need`? -> true (it lacks it) | false (it may hold it) | null (the index
 * cannot judge this need). Pure. `names` the observation's { name: [count, slots] }. Each need by the rule its own miss is
 * written by:
 *   pick          no pickaxe of any kind (the index has no wear, so ANY pickaxe name is "may hold" -- never a negative)
 *   trippick      no stone-or-better pickaxe (oretunnel hasTripPickaxe's tier line; wear unknown, as above)
 *   cobblestone, stick, planks   none the recipe accepts (withdrawpick.mjs NEEDS[need].match)
 *   kit_iron, kit_iron_<n>       fewer than n + TOWN_IRON_KEEP iron ingots (toolkit.mjs kitIronMissNeeds)
 *   kit_iron_any  no iron ingot (the multi-container draw's miss)
 * Anything else (the smelt job's inputs have their own rule-out; mats' names) -> null.
 */
export function needLacks (need, names = {}) {
  if (need === 'pick') return heldOf(names, n => PICK_RE.test(n)) === 0
  if (need === 'trippick') return heldOf(names, n => PICK_RE.test(n) && tier(n) >= tier('stone_pickaxe')) === 0
  if (need === KIT_IRON_ANY) return heldOf(names, n => n === 'iron_ingot') === 0
  const k = kitIronSize(need)
  if (k != null) return heldOf(names, n => n === 'iron_ingot') < k + TOWN_IRON_KEEP
  if (Object.prototype.hasOwnProperty.call(NEEDS, need)) return heldOf(names, NEEDS[need].match) === 0
  return null
}
/** Can the index judge every one of these needs? Pure. */
export const indexJudges = (needs = []) => Array.isArray(needs) && needs.length > 0 && needs.every(n => needLacks(n, {}) != null)

/**
 * THE INDEX'S EVIDENCE FOR ONE SEARCH -> { neg: Map<k, at>, pos: Map<k, at>, judged }. Pure.
 *   entries    the town index's fold (townindex.mjs readIndex .entries: { lowerHalfKey: entry }); null -> no evidence
 *   containers [{ k, halves }]: the search's containers (townSearchView: one key per double chest, both halves named)
 *   needs      the search's needs; any need needLacks cannot judge -> no evidence at all (judged false)
 *   tookAt     { k: ms } the town memory's last deposit into the container (townSearchView's, either half)
 *   untrusted  keys never given a negative (hopper-fed intake chests)
 *   ttl        the evidence's life: the shortest miss life of the search's needs (never past INDEX_STALE_MS)
 * An entry is matched by either half's key (the index keys a double chest by its lower half, the scan by whichever it met).
 */
export function indexEvidence (entries, containers = [], needs = [], { now = Date.now(), tookAt = {}, untrusted = new Set(), ttl = INDEX_STALE_MS } = {}) {
  const life = Math.min(INDEX_STALE_MS, Number.isFinite(Number(ttl)) ? Number(ttl) : INDEX_STALE_MS)
  const neg = new Map(), pos = new Map()
  if (!entries || typeof entries !== 'object' || !indexJudges(needs)) return { neg, pos, judged: false }
  const byHalf = new Map()
  for (const [k, e] of Object.entries(entries)) {
    for (const h of [k, ...(Array.isArray(e?.obs?.h) ? e.obs.h : [])]) if (!byHalf.has(h)) byHalf.set(h, e)
  }
  for (const c of (Array.isArray(containers) ? containers : [])) {
    const k = c?.k
    if (k == null) continue
    const halves = Array.isArray(c.halves) && c.halves.length ? c.halves : [k]
    const e = halves.map(h => byHalf.get(h)).find(Boolean)
    if (!e || indexStateOf(e, now) !== 'known') continue
    const at = Number(e.obs?.at)
    if (!Number.isFinite(at) || at > now + INDEX_FUTURE_SLACK_MS || now - at >= life) continue
    const took = Number(tookAt?.[k])
    if (Number.isFinite(took) && took > at + RULE_OUT_TOOK_SLACK_MS) continue
    const lacks = needs.map(n => needLacks(n, e.obs.names ?? {}))
    if (lacks.every(x => x === true)) { if (!untrusted?.has?.(k)) neg.set(k, at) } else pos.set(k, at)
  }
  return { neg, pos, judged: true }
}

/** The `_indexsearch2_mode` licence row (once per spawn): a kind the base cannot write. */
export const indexSearch2ModeDetail = () =>
  `phase=mode index_search=${INDEXSEARCH2.on ? 'on' : 'off'} skip=known_lacks_every_need life=miss_ttl max_h=${INDEX_STALE_MS / 3600000} recheck=${INDEX_RECHECK_VISITS} needs=pick,trippick,cobblestone,stick,planks,kit_iron* gates=unchanged`
