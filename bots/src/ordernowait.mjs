// ORDERNOWAIT-01: THE TOWN HALL AND THE COTTAGE NO LONGER WAIT FOR THE ENCHANTING WORKSHOP TO STAND (OWNER DECISION 2026-11-06
// ~01:25Z, relayed by the control session: "the town hall (X2) and cottage1 may start now, without waiting for the enchanting
// workshop ... so they site and build on their own plots. The owner's order still applies once sites exist (workshop first where it
// can be sited)").
//
// WHY. MEASURED showcase 11-05 00Z..11-06 03Z (all 15 bots, rotated files read): 2,169 `_build_visit` rows over 21 projects, 0 of
// them townhall or cottage1 -- every row naming either is a `_build_mode` licence (168: both blueprints ARE on). The enchanting
// workshop (X1) logged 14 `no_site` + 5 `replanned` visits 11-05, then sited on batch 13 (levelfall-01; record g5 open 02:44Z, 503
// cells). Both buildings carried `after: 'enchantshop'` (cottage.mjs COTTAGE_AFTER, townhall.mjs TOWNHALL_AFTER), and shop.mjs
// activeProject offers a project only when its `after` is COMPLETE -- so the hall and the house waited on the whole 503-cell workshop
// and its fit-out (book inputs: sugar cane 117, leather 39), with their own plots (X2, the first house plot) sited and empty.
//
// THE RULE: for the plots listed here, `after` stops being a gate. The ORDER is untouched: PROJECTS lists the workshop before the town
// hall and the cottage, so activeProject still gives a free workshop slot first (the owner's "workshop first where it can be sited");
// a bot the workshop has no slot for goes on to the hall, then the house. Each keeps its own opening rule (its plot of the sited
// extension; townhall.mjs townhallOpening / cottage.mjs cottageOpening) -- neither can take X1.
// ENCHANT_NOWAIT=off is the rollback (every `after` a gate, as before); unset = on only in ENCHANT_NOWAIT_POOLS (default 'showcase').

/** The plots whose `after` is a preference (the order), never a gate, while the switch is on. */
export const NOWAIT_PLOTS = Object.freeze(['townhall', 'cottage1'])
/** The project they used to wait for (the row names it). */
export const NOWAIT_AFTER = 'enchantshop'

const onOff = v => { const s = String(v ?? '').trim().toLowerCase(); return ['on', '1', 'true', 'yes'].includes(s) ? true : ['off', '0', 'false', 'no'].includes(s) ? false : null }
/** THE SWITCH -> { on }. ENCHANT_NOWAIT=on|off; unset = on only in ENCHANT_NOWAIT_POOLS (default 'showcase'). Pure. */
export function noWaitSwitches (env = process.env, pool = '') {
  const pools = String(env?.ENCHANT_NOWAIT_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return { on: onOff(env?.ENCHANT_NOWAIT) ?? pools.includes(String(pool)) }
}

/**
 * IS THIS PROJECT'S `after` MET? -> boolean. Pure. `afterComplete` is whether the `after` project's record is complete. A project with
 * no `after` is always met; one of NOWAIT_PLOTS whose `after` is NOWAIT_AFTER is met while `noWait` is on; every other `after` is met
 * only when complete (unchanged).
 */
export function afterMet (p, afterComplete, { noWait = false } = {}) {
  if (!p?.after) return true
  if (noWait && p.after === NOWAIT_AFTER && NOWAIT_PLOTS.includes(p.plot)) return true
  return !!afterComplete
}

/** `_ordernowait_mode` detail. Pure. */
export const noWaitModeDetail = (sw = {}) => `on=${sw.on ? 1 : 0} plots=${NOWAIT_PLOTS.join(',')} after=${NOWAIT_AFTER} order=unchanged`
