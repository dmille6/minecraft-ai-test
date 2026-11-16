// COMPACT-01 (bagfix-02show (c); OWNER 11-16: "compact first where a recipe exists ... compaction also frees many chest slots").
// PURE, and a LEAF (no imports): the recipes, what a town keeps loose, the bag's own compaction, and the clerk's two chest passes.
//
// LIVE 11-16 20:01Z (the town index, 33 containers, 867 of 891 slots): coal 325 in 53 slots, copper_ingot 787 in 48, lapis 330 in 24,
// diamond 112 in 24, moss_block 410 in 93, wheat 134 in 19, stick 74 in 12 -- the chests are full of FRAGMENTS, and nine of a mineral
// are one block. Two exits, both the bots' own crafting and banking (no admin command):
//   COMPACT  nine (or four) of a kind crafted into its block: for what a bag banks at the yard (nuggets, clay balls, snowballs), and
//            by the clerk for what already sits in the chests -- never below what the town keeps LOOSE (compactKeep: the smelts'
//            coal, the toolkits' iron, the build reserve's copper), so no consumer finds a block where it looked for an ingot.
//   MERGE    one name's fragments drawn from the chests and banked again: the deposit merges (bagfix.mjs mergeFit), so 93 slots of
//            moss come back as 7.
// COMPACT=off|0|false|no is the rollback of all of it; COMPACT_KEEP ("coal:128,iron_ingot:64,*:0") the loose keeps.

const isOff = v => ['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
/** from -> { n, to }: `n` of `from` craft one `to` (every one a vanilla 2x2 or 3x3 storage recipe, reversible but for clay and snow). */
export const RECIPES = Object.freeze({
  coal: { n: 9, to: 'coal_block' }, iron_ingot: { n: 9, to: 'iron_block' }, copper_ingot: { n: 9, to: 'copper_block' },
  lapis_lazuli: { n: 9, to: 'lapis_block' }, redstone: { n: 9, to: 'redstone_block' }, diamond: { n: 9, to: 'diamond_block' },
  gold_ingot: { n: 9, to: 'gold_block' }, iron_nugget: { n: 9, to: 'iron_ingot' }, wheat: { n: 9, to: 'hay_block' },
  clay_ball: { n: 4, to: 'clay' }, snowball: { n: 4, to: 'snow_block' },
})
/** What a BAG compacts before it banks (the row's kinds with a recipe): nothing a bot's own next craft reads. */
export const BAG_COMPACTS = Object.freeze(['iron_nugget', 'clay_ball', 'snowball'])
/** What the town keeps LOOSE of each kind (the clerk never compacts below it): the smelt jobs' coal, the toolkits' and buckets'
 *  iron, the build reserve's copper (stocktarget.mjs BUILD_RESERVE.copper_ingot 512), a stack of each trade mineral, bread's wheat. */
export const KEEP_DEFAULT = 'coal:128,iron_ingot:64,copper_ingot:512,lapis_lazuli:64,redstone:64,diamond:16,gold_ingot:16,wheat:64,*:0'
export function keepTable (raw) {
  const out = {}
  for (const part of String(raw == null || String(raw).trim() === '' ? KEEP_DEFAULT : raw).split(',')) {
    const [k, v] = part.split(':').map(x => x.trim())
    const n = Number(v)
    if (k && Number.isFinite(n) && n >= 0) out[k] = Math.floor(n)
  }
  if (!Number.isFinite(out['*'])) out['*'] = 0
  return Object.freeze(out)
}
/** THE SWITCH AND ITS NUMBERS -> { on, keep, minCrafts, maxStacks, mergeMin }. Pure. */
export function compactSettings (env = {}) {
  const num = (v, d, lo, hi) => { const n = Number(String(v ?? '').trim()); return String(v ?? '').trim() !== '' && Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : d }
  return Object.freeze({ on: !isOff(env?.COMPACT), keep: keepTable(env?.COMPACT_KEEP), minCrafts: num(env?.COMPACT_MIN_CRAFTS, 7, 1, 64), maxStacks: num(env?.COMPACT_MAX_STACKS, 8, 1, 27), mergeMin: num(env?.COMPACT_MERGE_MIN, 3, 1, 27) })
}
export const COMPACT = compactSettings(typeof process !== 'undefined' ? process.env : {})
export const compactKeepOf = (name, keep = COMPACT.keep) => (Number.isFinite(keep?.[name]) ? keep[name] : (keep?.['*'] ?? 0))

/**
 * THE BAG'S OWN COMPACTION -> [{ from, to, crafts, uses }]. Pure. Each BAG_COMPACTS name the bag holds above `keeps[name]`, in whole
 * crafts. `free` the bag's free slots: a craft whose product has no stack to join needs one (none: nothing is planned -- a craft
 * into a full bag drops its product).
 */
export function bagCompact (held = {}, { keeps = {}, free = 0, on = COMPACT.on } = {}) {
  if (!on) return []
  const out = []
  let room = Math.max(0, Number(free) || 0)
  for (const from of BAG_COMPACTS) {
    const r = RECIPES[from]
    const crafts = Math.floor(Math.max(0, (Number(held?.[from]) || 0) - Math.max(0, Number(keeps?.[from]) || 0)) / r.n)
    if (!(crafts > 0)) continue
    if (!((Number(held?.[r.to]) || 0) > 0)) { if (!(room > 0)) continue; room-- }
    out.push({ from, to: r.to, crafts, uses: crafts * r.n })
  }
  return out
}
/**
 * THE CLERK'S COMPACTION -> { from, to, take, crafts } | null. Pure. `stock` the town's indexed stock { name: n }; `free` the clerk's
 * free bag slots. The kind with the most to compact above its loose keep; at most COMPACT.maxStacks stacks a visit and never more
 * than the bag takes with two slots to spare (the product and the remainder); under COMPACT.minCrafts crafts it is not worth a visit.
 */
export function chestCompact (stock = {}, { free = 0, settings = COMPACT, stackOf = () => 64 } = {}) {
  if (!settings?.on || !stock) return null
  const slots = Math.min(settings.maxStacks, Math.max(0, (Number(free) || 0) - 2))
  let best = null
  for (const [from, r] of Object.entries(RECIPES)) {
    const over = (Number(stock[from]) || 0) - compactKeepOf(from, settings.keep)
    const take = Math.floor(Math.min(over, slots * (Number(stackOf(from)) || 64)) / r.n) * r.n
    const crafts = take / r.n
    if (!(crafts >= settings.minCrafts)) continue
    if (!best || take > best.take) best = { from, to: r.to, take, crafts }
  }
  return best
}
/**
 * THE CLERK'S MERGE -> { name, take, slots, after } | null. Pure. `held` the town index's { name: [count, slots] } summed over the
 * town's containers. The name wasting the most slots (its slots less what its count needs), at least COMPACT.mergeMin; `take` what
 * the bag can carry of it in `free - 1` slots (whole stacks' worth), `after` the slots that much needs once merged. Never a name
 * that does not stack, never one `skip` names (a row's kind in its own chest, the cap's cobble).
 */
export function mergePick (held = {}, { free = 0, settings = COMPACT, stackOf = () => 64, skip = () => false } = {}) {
  if (!settings?.on) return null
  const slots = Math.max(0, (Number(free) || 0) - 1)
  let best = null
  for (const [name, e] of Object.entries(held ?? {})) {
    const count = Number(e?.[0]) || 0, used = Number(e?.[1]) || 0, max = Number(stackOf(name)) || 1
    if (!(max > 1) || skip(name)) continue
    const waste = used - Math.ceil(count / max)
    if (!(waste >= settings.mergeMin)) continue
    const take = Math.min(count, slots * max)
    if (!(take > 0)) continue
    if (!best || waste > best.waste) best = { name, take, slots: used, after: Math.ceil(count / max), waste }
  }
  return best
}
/** May the clerk take `want` of `name` from a chest now (matsWithdraw's `allow`)? -> n. Pure. Never below the loose keep, judged on the
 *  town's stock elsewhere + what this chest shows (mats.mjs takeAllowed's shape). `keep` 0 for a merge (what is taken comes back). */
export function compactAllow (name, want, { others = {}, here = {} } = {}, keep = 0) {
  const have = (Number(others?.[name]) || 0) + (Number(here?.[name]) || 0)
  return Math.max(0, Math.min(Number(want) || 0, Number(here?.[name]) || 0, have - Math.max(0, Number(keep) || 0)))
}
/** `_compact` row detail. Pure. */
export function compactDetail ({ op = '-', from = '-', to = '-', took = 0, made = 0, banked = {}, slots = '-', why = '-' } = {}) {
  const m = Object.entries(banked ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  return `op=${op} from=${from} to=${to} took=${took} made=${made} banked=${m} slots=${slots} why=${String(why).replace(/\s+/g, '_').slice(0, 60)}`.slice(0, 300)
}
/** `_compact_mode` licence row detail. Pure. */
export const compactModeDetail = (s = COMPACT) => `on=${s.on ? 1 : 0} min_crafts=${s.minCrafts} max_stacks=${s.maxStacks} merge_min=${s.mergeMin} keep=${Object.entries(s.keep).map(([k, v]) => `${k}:${v}`).join(',')}`.slice(0, 300)
