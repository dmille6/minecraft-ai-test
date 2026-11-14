// IRONCHAIN-01 (B; docs/reports/ironchain-2026-11-09.md): the ore tunnel aims only at ore gather may take. One switch, read by
// skills.mjs (tunnelToOre's `eligible`). Its own file so the rollback is one env line and the test can read it without skills.
//
// MEASURED (fleet .31, 80 bots, 6 h to 11-09 13:10Z): 117 of 609 "every candidate is buried" gathers had ARRIVED at the
// tunnel's target ("tunnelled to iron at X", median 0 planned breaks) and still found nothing to take; 184 of 246 such rows in
// the live logs named a `lining` cell of the town stair's record -- an exposed iron ore in the stair's wall that gather never
// takes (record cells are never gather targets) and the tunnel always picked (it is the nearest ore from the landing).
//
// Rollback: IRONCHAIN_TUNNEL=0 -> the tunnel's own filter only (hazard + home radius), exactly as before.
export const ironchainTunnelOn = (env = process.env) => String(env?.IRONCHAIN_TUNNEL ?? '1').trim() !== '0'
export const IRONCHAIN_B = ironchainTunnelOn(typeof process !== 'undefined' ? process.env : {})
