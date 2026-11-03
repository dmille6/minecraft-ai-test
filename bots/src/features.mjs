// THE BUILDING FEATURES' SPAWN WORK -- moved verbatim out of index.mjs's spawn handler (fun mode, 2026-10-28).
//
// index.mjs is on config/protected-paths.txt whole (it owns connect, death, respawn and reconnect), so every
// building feature that added a licence row or an install there became tier 3. Those lines live here instead,
// and connect() calls installFeatures(bot) once per spawn from the same place they ran. A new building feature
// adds its install and its `_<feature>_mode` row HERE. Safety features' rows (keepout, lavastep, poolescape)
// stay in index.mjs, protected.
//
// Same statements, same order, same try/catch: nothing here may throw into the spawn handler.

import { log, logEvent } from './logger.mjs'
import { lavatargetModeDetail } from './lavatarget.mjs'   // lavatarget-01's licence row
import { snapshot } from './state.mjs'
import { config } from './config.mjs'
import { kitSearchModeDetail, ironpickModeDetail } from './toolkit.mjs'
import { townPlanModeDetail } from './townplan.mjs'   // townplan-01's licence row
import { townPlanZones, townPlanSeed } from './skills.mjs'
import { installCobbleCap } from './skills.mjs'
import { cobbleCapModeDetail } from './cobblecap.mjs'
import { cobbleKeepModeDetail } from './cobblecap.mjs'   // cobblekeep-01's licence row (its own statement)
import { townIndexModeDetail } from './townindex.mjs'   // townindex-01's licence row (its own statement)
import { ironsmeltModeDetail } from './smeltjob.mjs'   // ironsmelt-01's licence row
import { foundModeDetail, FOUND } from './found.mjs'   // found-01's licence row
import { junkoutModeDetail } from './bagallowance.mjs'   // junkout-01's licence row (its own statement)
import { lidClearModeDetail } from './lidrule.mjs'
import { townSearchModeDetail } from './withdrawpick.mjs'
import { plinthModeDetail } from './plinth.mjs'   // plinth-02's licence row (its own statement)
import { plinth021ModeDetail, townRecordsShared } from './plinth.mjs'   // plinth-02.1's licence row (its own statement)
import { plinthFirstModeDetail, plinthFirstPolicy } from './plinth.mjs'   // plinthfirst-01's licence row (its own statement)
import { wellcareModeDetail } from './wellcare.mjs'   // wellcare-01's licence row (its own statement)
import { lidPlaceModeDetail } from './lidplace.mjs'   // lidplace-01's licence row
import { ledgerModeDetail } from './ledger.mjs'   // ledger-01's licence row
import { furnaceSeenModeDetail } from './smeltjob.mjs'   // furnaceseen-01's mode row
import { sortSwitches, sortModeDetail } from './sortstore.mjs'   // sortstore-01's mode row
import { matsModeDetail, matsEnabled, matsReserve, matsBuffers } from './mats.mjs'   // mats-01's licence row (its own statement)
import { createHash as shopHash } from 'node:crypto'
import { shopStoodTick, shopFootprintRefresh } from './skills.mjs'   // shop-01: the walks' seeds, the footprint
import { SHOP, buildModeDetail, STOOD_EVERY_MS } from './shop.mjs'   // shop-01's licence row
import { readMatsNote, matsHoldNote } from './skills.mjs'   // mats-01 x junkout-01: an open note's obligations held again at spawn
import { SHAFT, SHAFT_COOLDOWN_MS } from './shop.mjs'   // shaft-02's licence row
import { SHAFT_BLUEPRINT, LANDING_FEET } from './shaftgeom.mjs'
import { deepModeDetail } from './deepmine.mjs'   // deepminer-01's licence row
import { expeditionInstall } from './skills.mjs'   // expedition-01: the order's ask and the licence row
import { copperRunInstall } from './skills.mjs'   // copperrun-01: the hall's copper ask and its licence row
import { copperhallModeDetail } from './copperhall.mjs'   // copperhall-01's licence row
import { COPPERHALL } from './shop.mjs'
import { YARD } from './shop.mjs'   // stockyard-01's licence row
import { yardModeDetail } from './yard.mjs'
import { SINKS } from './shop.mjs'   // picker-01's licence row
import { sinkModeDetail } from './sinks.mjs'
import { tapRecords } from './logger.mjs'   // showchat-01: the read-only record tap the announcements are made from
import { showchatOn, showchatModeDetail, makeSpeaker, quietChatter, KILL_FILE } from './showchat.mjs'   // showchat-01
import { poolStateDir } from './worldfacts.mjs'
import fs from 'node:fs'
import path from 'node:path'

// showchat-01: ONE speaker per process. A reconnect builds a new bot object and calls installFeatures again: the old tap goes.
let showchatUntap = null
/** SHOWCHAT-01 (showchat.mjs): the showcase's templated announcements + the chatter filter. Never throws. */
export function installShowchat (bot, { env = process.env, pool = config.memory.pool } = {}) {
  const on = showchatOn(env, pool)
  const dir = poolStateDir(pool)
  let killed = false
  try { killed = fs.existsSync(path.join(dir, KILL_FILE)) } catch {}
  try { logEvent({ kind: 'showchat_mode', status: 'success', snapshot: snapshot(bot), detail: showchatModeDetail({ on, pool, killed }) }) } catch {}
  if (!on) return null
  if (showchatUntap) { try { showchatUntap() } catch {} showchatUntap = null }
  const stats = { noise: 0 }
  const say = quietChatter(bot, stats)
  if (!say) return null
  const sp = makeSpeaker({
    bot, say, dir,
    emit: row => { try { logEvent({ ...row, snapshot: snapshot(bot) }) } catch {} },
    names: () => { try { return [...Object.keys(bot.players ?? {}), 'mike'] } catch { return ['mike'] } },
  })
  // the wrapper counts into its own object; the speaker's flush reports it
  const untap = tapRecords(rec => { sp.stats.noise += stats.noise; stats.noise = 0; sp.onRecord(rec) })
  const timer = setInterval(() => { try { sp.stats.noise += stats.noise; stats.noise = 0; sp.flush() } catch {} }, 60_000); timer.unref?.()
  const mine = () => { untap(); clearInterval(timer) }
  showchatUntap = mine
  // only THIS bot's speaker goes with this bot's `end` (a late `end` from an old bot never untaps the new one)
  bot.once?.('end', () => { try { sp.flush(true) } catch {} mine(); if (showchatUntap === mine) showchatUntap = null })
  return sp
}

/** Once per spawn, from index.mjs's spawn handler. Never throws. */
export function installFeatures (bot) {
  // expedition-01: the ask buildOrder puts to a bot the projects cannot use, and `_expedition_mode` (on=0 under EXPEDITION=off)
  try { expeditionInstall(bot) } catch (e) { log('warn', 'expedition not installed', { error: e.message }) }
  try { copperRunInstall(bot) } catch (e) { log('warn', 'copper run not installed', { error: e.message }) }
  // copperhall-01: the copper hall's licence row (copperhall.mjs; the project itself is shop.mjs PROJECTS, its gate skills.mjs hallOpenNow)
  try { logEvent({ kind: 'copperhall_mode', status: 'success', snapshot: snapshot(bot), detail: copperhallModeDetail(COPPERHALL.on) }) } catch { /* telemetry */ }
  // stockyard-01: the stockpile yard's licence row (yard.mjs; the project itself is shop.mjs PROJECTS, its visit skills.mjs yardVisit)
  try { logEvent({ kind: 'yard_mode', status: 'success', snapshot: snapshot(bot), detail: yardModeDetail(YARD.on) }) } catch { /* telemetry */ }
  // picker-01: the town sinks' licence row (sinks.mjs; the plots are shop.mjs PROJECTS' sink entries, the visit skills.mjs buildSink)
  try { logEvent({ kind: 'sink_mode', status: 'success', snapshot: snapshot(bot), detail: sinkModeDetail(SINKS.on, SINKS.kinds) }) } catch { /* telemetry */ }
  // showchat-01: the showcase's announcements (`_showchat_mode`; on=0 outside the showcase pool or under SHOWCHAT=off)
  try { installShowchat(bot) } catch (e) { log('warn', 'showchat not installed', { error: e.message }) }
  // THE TOWN COBBLE CAP (cobblecap.mjs): the deposit plan reads the town's reconciled cobble through this bot's view
  try { installCobbleCap(bot) } catch (e) { log('warn', 'cobble cap not installed', { error: e.message }) }
  // cobblecap-1000: the licence row, once per spawn -- the build's own `_cobblecap_mode` kind (cobblecap.mjs cobbleCapModeDetail)
  try { logEvent({ kind: 'cobblecap_mode', status: 'success', snapshot: snapshot(bot), detail: cobbleCapModeDetail() }) } catch {}
  // lavatarget-01: the licence row, once per spawn (LAVATARGET=0 -> on=0)
  try { logEvent({ kind: 'lavatarget_mode', status: 'success', snapshot: snapshot(bot), detail: lavatargetModeDetail() }) } catch {}
  // lidplace-01: the licence row, once per spawn -- `_lidplace_mode`, a kind the base cannot write (lidplace.mjs lidPlaceModeDetail;
  // on=0 under LIDPLACE=0, so the rollback is visible too)
  try { logEvent({ kind: 'lidplace_mode', status: 'success', snapshot: snapshot(bot), detail: lidPlaceModeDetail(process.env) }) } catch {}
  // lidclear-01: the licence row, once per spawn -- `_lidclear_mode`, a kind the base cannot write (lidrule.mjs lidClearModeDetail)
  try { logEvent({ kind: 'lidclear_mode', status: 'success', snapshot: snapshot(bot), detail: lidClearModeDetail() }) } catch {}
  // townsearch-01: the licence row, once per spawn -- `_townsearch_mode`, a kind the base cannot write (withdrawpick.mjs townSearchModeDetail)
  try { logEvent({ kind: 'townsearch_mode', status: 'success', snapshot: snapshot(bot), detail: townSearchModeDetail() }) } catch {}
  // toolkit-03: the licence row, once per spawn -- `_toolkit_search_mode`, a kind the base cannot write (toolkit.mjs kitSearchModeDetail)
  try { logEvent({ kind: 'toolkit_search_mode', status: 'success', snapshot: snapshot(bot), detail: kitSearchModeDetail() }) } catch {}
  // ironpick-01: the licence row, once per spawn -- `_toolkit_ironpick_mode`, a kind the base cannot write (toolkit.mjs ironpickModeDetail;
  // on=0 under TOOLKIT_IRONPICK=off, so the rollback is visible too)
  try { logEvent({ kind: 'toolkit_ironpick_mode', status: 'success', snapshot: snapshot(bot), detail: ironpickModeDetail() }) } catch {}
  // plinth-02: the licence row, once per spawn -- the build's own `_plinth_mode` kind (plinth.mjs plinthModeDetail)
  try { logEvent({ kind: 'plinth_mode', status: 'success', snapshot: snapshot(bot), detail: plinthModeDetail(bot.worldId) }) } catch {}
  // plinth-02.1: the licence row, once per spawn -- `_plinth021_mode` (plinth.mjs plinth021ModeDetail)
  try { logEvent({ kind: 'plinth021_mode', status: 'success', snapshot: snapshot(bot), detail: plinth021ModeDetail({ shared: townRecordsShared({ scope: config.memory.scope, pool: config.memory.pool, name: bot.username ?? '' }), worldId: bot.worldId }) }) } catch {}
  // plinthfirst-01: the licence row, once per spawn -- `_plinthfirst_mode` (plinth.mjs plinthFirstModeDetail); CONFIGURATION only
  try { logEvent({ kind: 'plinthfirst_mode', status: 'success', snapshot: snapshot(bot), detail: plinthFirstModeDetail({ on: plinthFirstPolicy({ scope: config.memory.scope, pool: config.memory.pool, name: bot.username ?? '', env: process.env }), shared: townRecordsShared({ scope: config.memory.scope, pool: config.memory.pool, name: bot.username ?? '' }), worldId: bot.worldId }) }) } catch {}
  // wellcare-01: the licence row, once per spawn -- the build's own `_wellcare_mode` kind (wellcare.mjs wellcareModeDetail)
  try { logEvent({ kind: 'wellcare_mode', status: 'success', snapshot: snapshot(bot), detail: wellcareModeDetail() }) } catch {}
  // cobblekeep-01: the licence row, once per spawn -- `_cobblekeep_mode`, a kind the base cannot write (cobblecap.mjs cobbleKeepModeDetail)
  try { logEvent({ kind: 'cobblekeep_mode', status: 'success', snapshot: snapshot(bot), detail: cobbleKeepModeDetail() }) } catch {}
  // townindex-01: the licence row, once per spawn -- `_townindex_mode`, a kind the base cannot write (townindex.mjs)
  try { logEvent({ kind: 'townindex_mode', status: 'success', snapshot: snapshot(bot), detail: townIndexModeDetail() }) } catch {}
  // ironsmelt-01: the licence row, once per spawn -- `_ironsmelt_mode`, a kind the base cannot write (smeltjob.mjs)
  try { logEvent({ kind: 'ironsmelt_mode', status: 'success', snapshot: snapshot(bot), detail: ironsmeltModeDetail() }) } catch {}
  // townplan-01 / found-01: the licence rows, once per spawn -- `_townplan_mode` and `_found_mode`, kinds the base cannot write
  try {
    const z = townPlanZones(bot), sd = townPlanSeed(bot)
    logEvent({ kind: 'townplan_mode', status: 'success', snapshot: snapshot(bot), detail: townPlanModeDetail({ seed: sd.use ? 'ok' : `${sd.ok ? '' : 'bad:'}${sd.why}`, zones: z.known ? `${z.zones.length}` : `unknown:${z.why}` }) })
  } catch {}
  if (FOUND.on) try { logEvent({ kind: 'found_mode', status: 'success', snapshot: snapshot(bot), detail: foundModeDetail() }) } catch {}   // dormant: no row (the read's arms line)
  // junkout-01: the licence row, once per spawn -- `_junkout_mode`, a kind the base cannot write (bagallowance.mjs junkoutModeDetail)
  try { logEvent({ kind: 'junkout_mode', status: 'success', snapshot: snapshot(bot), detail: junkoutModeDetail() }) } catch {}
  // ONE TRUNK (W3, 10-28): the showcase lineage's building rows, moved here from index.mjs's spawn handler like the rows above
  // ledger-01: the licence row (once per spawn; `on=on|off`, the cooperation design's A7 contract)
  try { logEvent({ kind: 'ledger_mode', status: 'success', snapshot: snapshot(bot), detail: ledgerModeDetail() }) } catch {}
  // sortstore-01: the sorted storehouse's switches (the homes are the plan's, read when a deposit or the upkeep asks)
  try { const sw = sortSwitches(process.env, process.env.MEMORY_POOL ?? ''); if (sw.on) logEvent({ kind: 'sortstore_mode', status: 'success', snapshot: snapshot(bot), detail: sortModeDetail(sw) }) } catch {}
  // furnaceseen-01: its mode row (the A7 contract `on=on|off`); the per-walk evidence is `_furnace_seen_skip`
  try { logEvent({ kind: 'furnace_seen_mode', status: 'success', snapshot: snapshot(bot), detail: furnaceSeenModeDetail() }) } catch {}
  // mats-01: the licence row, once per spawn -- `_mats_mode`, a kind the base cannot write (mats.mjs)
  try { matsHoldNote(bot, readMatsNote(bot)) } catch {}   // holds live in memory: an open note's are set again at spawn
  try { const sw = matsEnabled(process.env, config.memory.scope); logEvent({ kind: 'mats_mode', status: 'success', snapshot: snapshot(bot), detail: matsModeDetail({ on: sw.on, why: sw.why, reserve: matsReserve(), buffers: matsBuffers() }) }) } catch {}
  // shaft-02: the licence row, once per spawn -- `_shaft_mode`, a kind the base cannot write (on=0 under SHAFT=off: the rollback is
  // visible too)
  try { logEvent({ kind: 'shaft_mode', status: 'success', snapshot: snapshot(bot), detail: `on=${SHAFT.on ? 1 : 0} blueprint=${SHAFT_BLUEPRINT} landings=${LANDING_FEET.join('+')} cooldown_s=${SHAFT_COOLDOWN_MS / 1000}` }) } catch {}
  // deepminer-01: the licence row, once per spawn -- `_deepmine_mode`, a kind the base cannot write (on=0 under DEEPMINE=off)
  try { logEvent({ kind: 'deepmine_mode', status: 'success', snapshot: snapshot(bot), detail: deepModeDetail() }) } catch {}
  // shop-01: the licence row, once per spawn -- `_build_mode`, a kind the base cannot write (cooperation A7), naming the reserve in
  // force by a short hash; the spawn time (no dig in the first 3 s: the ghost-block rule); the walks' seeds and the footprint
  if (SHOP.on) {
    try { logEvent({ kind: 'build_mode', status: 'success', snapshot: snapshot(bot), detail: buildModeDetail(shopHash('sha256').update(JSON.stringify(matsReserve().table ?? {})).digest('hex').slice(0, 8)) }) } catch {}
    bot.shopSpawnAt = Date.now()
    bot.on('spawn', () => { bot.shopSpawnAt = Date.now() })
    try { shopFootprintRefresh(bot) } catch {}
    const shopTimer = setInterval(() => { try { shopStoodTick(bot) } catch {} }, STOOD_EVERY_MS); shopTimer.unref?.()
    const shopFpTimer = setInterval(() => { try { shopFootprintRefresh(bot) } catch {} }, 60_000); shopFpTimer.unref?.()
    bot.once('end', () => { clearInterval(shopTimer); clearInterval(shopFpTimer) })
  }
}
