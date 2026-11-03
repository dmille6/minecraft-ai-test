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
/** A NEVER_KEEP set less the farm's seeds while the farm is on in this pool -> a new Set (the base is never changed). Pure. */
export function neverKeepFor (base, env = process.env, pool = env?.MEMORY_POOL ?? '') {
  const out = new Set(base)
  if (cropfarmOn(env, pool)) for (const s of KEPT_SEEDS) out.delete(s)
  return out
}
