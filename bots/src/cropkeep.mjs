// CROPFARM-01: THE SWITCH AND THE SEED KEEP (farms design docs/reports/farms-design-2026-11-03.md section 2; owner 11-03, ledger
// farms-1103). A LEAF MODULE (imports nothing): hygiene.mjs reads it at load to build NEVER_KEEP, and cropfarm.mjs (which imports
// paths.mjs -> ... -> hygiene.mjs) would make that an import cycle.
//
// WHY THE KEEP (measured 11-03): wheat seeds are on hygiene's NEVER_KEEP, so a bot never walks to them; the composter eats them
// (composter.mjs isCompostJunk keys on NEVER_KEEP); towndeposit's junk test never banks them (it reads NEVER_KEEP too); junkswap may
// drop them at a full chest. All 10 showcase bags and every town chest held none, and the park skipped its crops `no_seeds`. A
// farm whose seeds are thrown away is two correct guards composing into a dead end. While the farm is on in a pool, wheat_seeds
// leave NEVER_KEEP there, which flips the walk, the composter, the bank and junkswap together. The other seeds stay junk.
//
// CROPFARM = on | off; unset = on only in the pools CROPFARM_POOLS names (default 'showcase'). CROPFARM=off is the rollback: the
// project is never picked, seeds are junk again, the record stays a reservation.

/** The seeds a farm keeps (the crops it plants). */
export const KEPT_SEEDS = Object.freeze(['wheat_seeds'])
/** THE SWITCH -> bool. Pure. */
export function cropfarmOn (env = process.env, pool = '') {
  const v = String(env?.CROPFARM ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.CROPFARM_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes(String(pool ?? ''))
}
/** A NEVER_KEEP set less the farm's seeds while the farm is on in this pool -> a new Set (the base is never changed). Pure.
 *  decorator-01: less the decorator's flowers while the decorator is on in this pool (decorKeepOn). */
export function neverKeepFor (base, env = process.env, pool = env?.MEMORY_POOL ?? '') {
  const out = new Set(base)
  if (cropfarmOn(env, pool)) for (const s of KEPT_SEEDS) out.delete(s)
  if (decorKeepOn(env, pool)) for (const s of DECOR_KEPT) out.delete(s)
  return out
}

// DECORATOR-01 (owner 11-04, ledger decorator-1104; bots/src/decorator.mjs): THE DECORATOR'S FLOWERS ARE KEPT. poppy and dandelion are
// on hygiene's NEVER_KEEP, so the composter ate them as junk (composter.mjs isCompostJunk) and the peaceful kit composts every other
// small flower (peacefulkit.mjs): the nursery's harvest would have gone into the composter at the next full bag -- the cropfarm's seed
// trap again. While the decorator is on in a pool, every small flower leaves NEVER_KEEP there and the composter never takes one
// (composter.mjs compostAllowance `decorKeeps`). The switch is decorator.mjs decorOn's, restated (this module imports nothing:
// decorator.test.mjs asserts the two agree).
/** The small flowers the decorator plants (park.mjs SMALL_FLOWERS, restated) and its fern. */
// decorator-02: and the fern (the fern clusters' stock: OWNER 11-05 "never park/decor stock" into the compost drive)
export const DECOR_KEPT = Object.freeze(['poppy', 'dandelion', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'allium', 'blue_orchid', 'lily_of_the_valley', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'fern'])
/** THE DECORATOR'S SWITCH (decorator.mjs decorOn) -> bool. Pure. */
export function decorKeepOn (env = process.env, pool = '') {
  const v = String(env?.DECORATOR ?? '').trim().toLowerCase()
  if (['on', '1', 'true'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.DECORATOR_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool ?? ''))
}
/** The flowers no composter takes in this pool -> Set (empty with the decorator off). Pure. */
export const decorKeeps = (env = process.env, pool = env?.MEMORY_POOL ?? '') => new Set(decorKeepOn(env, pool) ? DECOR_KEPT : [])
