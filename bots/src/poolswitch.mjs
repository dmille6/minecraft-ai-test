// ONE TRUNK (control session 11-16; docs/reports/trunk-merge-2026-11-16/DECISIONS.md rows 2, 3 and 4): THREE MORE DECISIONS DEFAULT
// BY POOL, beside the visit's two (stuckcells.mjs visitSwitchDetail). Each is a place where the two lines truly disagree, so both
// behaviours stay: OFF by default in the showcase pool -- the code path is then the showcase line's exactly -- and ON in every
// other pool, as the fleet has it; the env name overrides either way. The switches live with the code they switch:
//   UNSITEDWAIT    shop.mjs unsitedWaitOn      the build order's no-site hold: the project's stamp (idlework-01 B), or the bot's own
//                                              stop for the plot that failed (sinkfix-03)
//   IDLEWORK_WELL  well.mjs wellBandOn         the junk well's dispose from 29 slots (idlework-02's band); bagroom-01's own rule is
//                                              BAGROOM_WELL, a separate switch
//   CRAFTSPARE     craftroom.mjs craftSpareOn  a bag of last-swing pickaxes: any craft may wear one while another stays (escdead-01
//                                              (b)), or only the rebuild of a pickaxe the bag holds (the showcase's rule)
//   SNOWKEEP       buildrun.mjs snowKeepOn     snow on a build cell (DECISIONS row 7): kept, never dug (the fleet's rule), or dug as
//                                              terrain (gkunblock-01, the showcase's)
// This file is only the spawn's licence row, `_poolswitch_mode` (features.mjs): which way each is, and whether the env or the pool
// said so -- a read of a bot's rows must be able to tell which line's behaviour it is looking at. PURE.

const SAID = ['0', 'off', 'false', 'no', '1', 'on', 'true', 'yes']
/** Where a pool-default switch's answer came from -> 'env' (its name is set to a value it reads) | 'pool'. Pure. */
export const poolSwitchWhy = (name, env = process.env) => (SAID.includes(String(env?.[name] ?? '').trim().toLowerCase()) ? 'env' : 'pool')
/** The row's detail -> 'unsitedwait=1 (pool) idlework_well=0 (env) craftspare=1 (pool) snowkeep=1 (pool) pool=hive-a'. Pure. */
export const poolSwitchDetail = ({ unsited = false, band = false, spare = false, snow = false, pool = '' } = {}, env = process.env) =>
  `unsitedwait=${unsited ? 1 : 0} (${poolSwitchWhy('UNSITEDWAIT', env)}) idlework_well=${band ? 1 : 0} (${poolSwitchWhy('IDLEWORK_WELL', env)}) ` +
  `craftspare=${spare ? 1 : 0} (${poolSwitchWhy('CRAFTSPARE', env)}) snowkeep=${snow ? 1 : 0} (${poolSwitchWhy('SNOWKEEP', env)}) pool=${String(pool || '-')}`
