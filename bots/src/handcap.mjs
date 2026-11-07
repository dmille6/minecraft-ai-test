// HANDCAP-01: A SHAFT CAP THE BARE HAND BREAKS IS NOT A TOOL PROBLEM (showcase 11-05/06; tier 3, reflex scope).
//
// WHY. showcase-Gale sat 22.3 h of 24 at 64.5,58,38.5, at the bottom of a 5-tall open shaft capped by STONE, holding 540
// cobblestone, 5 sticks, a crafting table and one iron_pickaxe at 1 of 250 uses: 608 `_marooned_needs_pickaxe` rows ("column
// above is capped by stone, and no usable tool is available"). The guard that refused is reflex.mjs `shaftCapNeedsTool`: it
// calls a cap a tool problem unless the bare hand can HARVEST it (`canHarvest(null)`) or toolFor offers a tool -- and toolFor
// never offers a pickaxe at HARD_STOP (1 use). So maroonState answered `need_pickaxe` and asked the goal layer for two
// pickaxes. That remedy was not executable from there: the crafting table had nowhere to go ("no solid block with a free
// space above it within reach, blocked_above=24"), and the bot stands inside the taiga village's protected box above its
// floor_y, where protectzone.mjs refuses `craft` at a table for EVERY purpose (survival included) -- so no table placed
// there could ever be used. 22 hours of a remedy that could not be taken.
//
// THE CLIMB NEVER NEEDED A TOOL. pillarOut breaks its headroom BARE-HANDED by design (digHand: bare first; "for escape
// purposes breaking is all that matters"), and digbudget.mjs prices stone at 7,500 ms by hand, deepslate 15,000, cobbled
// deepslate 17,500 -- all under MAX_DIG_MS (30 s); obsidian (250 s) and bedrock stay refused. So the cap needs a tool only
// when the bare hand cannot BREAK it within the climb's own refusal rule (planDigSplit on the GROUNDED prediction, exactly
// what pillarOut asks). Harvesting is beside the point: the climb wants the hole, not the drop.
//
// THE RULE: a cap whose grounded bare-hand break time is KNOWN and planDigSplit does not refuse is not a tool problem, so the
// marooned state is `climb` (pillarOut: survival purpose, so a protected zone admits its dig and pillar, and escapeguard
// still passes over a structure's or a record's cell). Unknown dig time keeps the old answer (a tool problem): no new
// behaviour on a block the registry cannot price. No pickaxe is spent: the 1-use copy stays in the bag (the "spend the last
// use" variant is unnecessary -- the hand already breaks every cap the last use could, and keeps the copy for last-swing).
//
// MAROON_HANDCAP=off is the rollback (=on forces it on). Unset: on only in MAROON_HANDCAP_POOLS (default `showcase`).
import { planDigSplit } from './digbudget.mjs'

const onOff = v => {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (/^(off|0|false|no)$/.test(s)) return false
  if (/^(on|1|true|yes)$/.test(s)) return true
  return null
}

/** The switch -> { on, why }. Pure. */
export function handCapSwitch (env = {}, pool = '') {
  const forced = onOff(env?.MAROON_HANDCAP)
  if (forced != null) return { on: forced, why: `MAROON_HANDCAP=${forced ? 'on' : 'off'}` }
  const pools = String(env?.MAROON_HANDCAP_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  const on = pools.includes(String(pool ?? ''))
  return { on, why: on ? `pool ${pool} listed` : `pool ${pool || '-'} not listed` }
}
export const HANDCAP = Object.freeze(handCapSwitch(typeof process !== 'undefined' ? process.env : {},
  typeof process !== 'undefined' ? (process.env.MEMORY_POOL ?? '') : ''))

/**
 * MAY THE CLIMB BREAK THIS CAP BARE-HANDED? -> boolean. Pure. `bareMs` the GROUNDED bare-hand prediction (predictedDigMs(cap,
 * null) with no env -- the same number pillarOut's refusal reads). Unknown (null / NaN / <= 0) -> false: the old answer.
 */
export function handBreaksCap (bareMs, { on = HANDCAP.on } = {}) {
  if (!on) return false
  const p = Number(bareMs)
  if (bareMs == null || !Number.isFinite(p) || p <= 0) return false
  return !planDigSplit({ hardnessMs: p }).refuse
}

/** The licence row's detail (`_handcap_mode`, once per spawn). Pure. */
export function handCapModeDetail (sw = HANDCAP) {
  return `on=${sw.on ? 1 : 0} why=${sw.why} rule=bare_break_under_max_dig unknown=tool_problem spend_last_use=0`
}
