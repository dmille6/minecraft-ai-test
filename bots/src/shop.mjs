// SHOP-01, THE WORKSHOP JOB'S POLICY (stage C; design docs/reports/building-tier-2026-10-23.md sections 4-5, cooperation A2/A7/A9).
// Pure: the switch, the town order, the bill, spendableFor, the footprint price, the pool's stood cells, the rows. The skill
// (skills.mjs build_shop) supplies readings and effects; the visit itself is buildrun.mjs.

import fs from 'node:fs'
import path from 'node:path'
import { reserveKeyOf, reserveCount, takeAllowed, LOG_NAMES, PLANKS_OF } from './mats.mjs'
import { monumentOn, MONUMENT_PLOT, MONUMENT_BLUEPRINT, MONUMENT_BUILDERS } from './ziggurat.mjs'
import { pathsOn, PATHS_PLOT, PATHS_BLUEPRINT, PATHS_BUILDERS } from './paths.mjs'
import { wallOn, WALL_PLOT, WALL_BLUEPRINT, WALL_BUILDERS, wallextOn, WALLEXT_PLOT, WALLEXT_BLUEPRINT } from './wall.mjs'
import { SHAFT_PLOT, SHAFT_BLUEPRINT, stairStartRefusal } from './shaftgeom.mjs'
import { treefarmOn, TREEFARM_PLOT, TREEFARM_BLUEPRINT, TREEFARM_BUILDERS } from './treefarm.mjs'
import { cropfarmOn, CROPFARM_PLOT, CROPFARM_BLUEPRINT, CROPFARM_BUILDERS } from './cropfarm.mjs'   // cropfarm-01
import { tidyOn, TIDY_PLOT, TIDY_BLUEPRINT, TIDY_BUILDERS } from './tidy.mjs'
import { storehouseOn, STORE_PLOT, STORE_BLUEPRINT, STORE_BUILDERS } from './storehouse.mjs'
import { copperhallOn, HALL_PLOT, HALL_BLUEPRINT, HALL_BUILDERS } from './copperhall.mjs'   // copperhall-01
import { yardOn, YARD_PLOT, YARD_BLUEPRINT, YARD_BUILDERS } from './yard.mjs'   // stockyard-01
import { hubSwitches, HUB_PLOT, HUB_BLUEPRINT, HUB_BUILDERS } from './storehub.mjs'   // storehub-01
import { shopchestOn, SHOPCHEST_PLOT, SHOPCHEST_BLUEPRINT, SHOPCHEST_BUILDERS } from './shopchest.mjs'
import { gkOn, GK } from './groundskeeper.mjs'   // groundskeeper-01
import { sinksOn, sinkKindsOn, SINK_KINDS, SINK_PLOTS, SINK_BLUEPRINTS, SINK_BUILDERS, SINK, SINK_STREAK, isSinkPlot, sinkKindOf } from './sinks.mjs'   // picker-01

/** SHOP=off is the rollback; anything else runs the job (the variant's code is the change). */
export const SHOP = Object.freeze({ on: process.env.SHOP !== 'off' })
export const SHOP_BLUEPRINT = 'workshop@1'
export const SHOP_PLOT = 'shop'
/**
 * HOUSE-01: THE TOWN'S PROJECTS, IN ORDER (owner backlog 10-29: house-01 after the workshop). The build_shop job builds ONE
 * project at a time: the first whose record is not complete, or a complete one that is damaged (repaired first, in order).
 * HOUSE=off is the rollback: the workshop alone, exactly as before. A house is house@1 (5x5 shell on a 7x7 pad, an OPEN 1x2
 * doorway like the workshop's -- owner Q2: real doors only after a Paper-proven door change -- so no sealed interior, no
 * exit_house). Each project is its own record chain (`project-<home>.<plot>`): leases, slots, shares and the progress clock are
 * per project; the footprint price, the keep-outs and the sapling boxes cover EVERY project's record.
 */
export const HOUSE = Object.freeze({ on: !['off', '0', 'false', 'no'].includes(String(process.env.HOUSE ?? '').trim().toLowerCase()) })
/**
 * MONUMENT-01: THE ZIGGURAT is the third project (ziggurat.mjs; OWNER 10-29 "top priority" on the showcase): after the workshop,
 * built ALONGSIDE the house -- a bot whose first open project has no free admission slot works the next one (activeProject's
 * `free`) -- with its own builders (MONUMENT_BUILDERS) and its own visit (skills.mjs buildMonument). On in every pool since
 * zigfleet-01, the fleet rollout (ziggurat.mjs monumentOn; MONUMENT=off is the rollback).
 */
export const MONUMENT = Object.freeze({ on: monumentOn(process.env, process.env.MEMORY_POOL ?? '') })
/**
 * PATHS-01: THE TOWN'S PATHS are the fourth project (paths.mjs; owner showcase list 10-29: house-01 -> paths-01 -> wall-01): after
 * the house, laid from the core to every complete project's front, the farm and the well. On in the showcase pool, off in the
 * fleet's until its rollout (paths.mjs pathsOn; PATHS=off is the rollback).
 */
export const PATHS = Object.freeze({ on: pathsOn(process.env, process.env.MEMORY_POOL ?? '') })
/**
 * WALL-01: THE TOWN WALL is the fifth project (wall.mjs; owner showcase list 10-29: house-01 -> paths-01 -> wall-01): after the
 * paths (its gateways are where they cross), a cobblestone rampart round the plan area. On in the showcase pool, off in the fleet's
 * until its rollout (wall.mjs wallOn; WALL=off is the rollback). It needs the paths (and the house) on.
 */
export const TOWNWALL = Object.freeze({ on: wallOn(process.env, process.env.MEMORY_POOL ?? '') })
/** WALLEXT-01: THE WALL EXTENSION (wall.mjs siteWallExt; owner 11-04 "extend the wall around the new building leaving room for
 *  additional buildings"), after the storage hall: the same rampart round the hall and the plots beside it, sharing the old wall's
 *  line. WALLEXT=off is the rollback (a sited extension stays guarded); on in the showcase pool only. Needs the wall and the hall on. */
export const TOWNWALLEXT = Object.freeze({ on: wallextOn(process.env, process.env.MEMORY_POOL ?? '') })
/**
 * SHAFT-02: THE TOWN STAIR (shaftgeom.mjs; docs/reports/mineshaft-2026-10-30/design.md; OWNER 10-30 "a common mineshaft"): a
 * lined 3x3 spiral stair to feet y=16 with landings at 48/32/16, ONE builder, its own excavation visit (skills.mjs buildStair).
 * Right after the workshop (design r2: before the house, or only the third free bot reaches it): one bot takes its slot, the
 * rest go on to the next open project. SHAFT=on|off, SHAFT_POOLS (default every pool: the canary's code runs only on the canary
 * pools, so the variant is the rollout). Off stops the building and the use; a sited stair's cells stay protected
 * (projectsGuarded).
 * SHOWCASE-ON-FLEET (control session 10-31): the default left the SHOWCASE town out -- the owner's showcase list (10-29) had no
 * town stair. SHOWSHAFT-01 (OWNER 11-01 showcase item 2: "the showcase town mineshaft + a deep miner"; deepminer-01 KEPT and
 * promoted fleet-wide 11-03 06:09Z, so the showcase's protected tree carries it): the showcase is no longer left out -- the
 * stair and its one deep miner run there as in every fleet pool. SHAFT=off (or a SHAFT_POOLS without `showcase`) is the
 * rollback; DEEPMINE=off stops the miner alone.
 */
export const SHAFT_DEFAULT_OFF_POOLS = Object.freeze([])
export function shaftOn (env = process.env, pool = '') {
  const v = String(env?.SHAFT ?? '').toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false') return false
  if (env?.SHAFT_POOLS == null && SHAFT_DEFAULT_OFF_POOLS.includes(String(pool))) return false
  const pools = String(env?.SHAFT_POOLS ?? '*').split(',').map(q => q.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
export const SHAFT = Object.freeze({ on: shaftOn(process.env, process.env.MEMORY_POOL ?? '') })
export const SHAFT_BUILDERS = 1
export const SHAFT_COOLDOWN_MS = 2 * 60_000    // a stair visit is short (the runner's clock) and digs, so it is asked again sooner
/**
 * TREEFARM-04: THE TOWN TREE FARM is the sixth project (treefarm.mjs; owner showcase list 10-29, item 4): after the paths (a leg
 * reaches its front once it stands), a levelled grid of saplings with growth torches, harvested and replanted as upkeep. On in the
 * showcase pool, off in the fleet's until its rollout (treefarm.mjs treefarmOn; TREEFARM=off is the rollback). Needs the paths.
 */
export const TREEFARM = Object.freeze({ on: treefarmOn(process.env, process.env.MEMORY_POOL ?? '') })
/** CROPFARM-01: THE TOWN WHEAT FARM (cropfarm.mjs; owner 11-03, ledger farms-1103), after the tree farm; its harvest and replant are
 *  upkeep (`due`). CROPFARM=off is the rollback; on in the showcase pool only (cropkeep.mjs cropfarmOn) until a fleet rollout. */
export const CROPFARM = Object.freeze({ on: cropfarmOn(process.env, process.env.MEMORY_POOL ?? '') })
/**
 * STOREHOUSE-01: THE TOWN STOREHOUSE is the seventh project (storehouse.mjs; town plan 10-20 + owner 10-23 Q1 "after shop-01"):
 * walls, roof, a doorway and lights round the plan's store plot and the containers already in it. On in the showcase pool, off in
 * the fleet's until its rollout (storehouse.mjs storehouseOn; STOREHOUSE=off is the rollback). Needs the house switch on.
 */
export const STOREHOUSE = Object.freeze({ on: storehouseOn(process.env, process.env.MEMORY_POOL ?? '') })
/** SHOPCHEST-01: THE WORKSHOP'S MATERIALS CHESTS (shopchest.mjs; OWNER 10-28 workshop uses no.2), a one-visit project after the
 *  workshop, before the storehouse. SHOPCHEST=off is the rollback; on in the showcase pool only until a fleet rollout. */
export const SHOPCHEST = Object.freeze({ on: shopchestOn(process.env, process.env.MEMORY_POOL ?? '') })
/** COPPERHALL-01: THE COPPER HALL (copperhall.mjs; owner 11-01 showcase item 5), after the storehouse, before the tidy (last). Offered
 *  only once the town holds its copper (activeProject skips a `waiting` project). COPPERHALL=off is the rollback; on in the
 *  showcase pool only. Needs the house and storehouse switches on. */
export const COPPERHALL = Object.freeze({ on: copperhallOn(process.env, process.env.MEMORY_POOL ?? '') })
/** STOREHUB-01: THE SORTED HALL (storehub.mjs; owner 11-03 storage hub, "yes to all"), after the copper hall (the owner's showcase
 *  order: the copper hall's finish first), before the yard. Sited beside the storehouse, else in the town ring; when it stands, its
 *  upkeep (`due`, first among the upkeeps: the labels and one clerk move-set) is the hub's clerk. STOREHUB=off is the rollback; on in
 *  the showcase pool only. Needs the house and storehouse switches on. */
export const STOREHUB = Object.freeze(hubSwitches(process.env, process.env.MEMORY_POOL ?? ''))
/**
 * TIDY-01: THE TOWN-GROUND TIDY is the LAST project, with no `after` (tidy.mjs): only a bot no other project admits works it -- every
 * other open project full, stuck or waiting -- so it never displaces building. It cuts the bots' pillars, fills their pits and
 * grades the paths' corridors; it reserves nothing (projectsGuarded leaves it out: no footprint, no sapling box, no siting zone,
 * never another project's input). On in every fleet pool, off in the showcase unless named (tidy.mjs tidyOn; TIDY=off is the
 * rollback).
 */
export const TIDY = Object.freeze({ on: tidyOn(process.env, process.env.MEMORY_POOL ?? '') })
/** STOCKYARD-01: THE TOWN STOCKPILE YARD (yard.mjs; OWNER 11-02 ~13:00Z), before the tidy (last): never ahead of an open project (an
 *  unsited yard that cannot site would hold the order), no `after`; one builder. YARD=off is the rollback; on in the showcase pool only until a fleet rollout. */
export const YARD = Object.freeze({ on: yardOn(process.env, process.env.MEMORY_POOL ?? '') })
/** GROUNDSKEEPER-01 (groundskeeper.mjs): one leased bot a town works the tidy -- its only builder (the lease is the slot, the yard
 *  clerk's pattern) -- through the land plan's stages; GROUNDSKEEPER=off is tidy-01 exactly as before (3 builders). */
export const GROUNDS = Object.freeze({ on: TIDY.on && gkOn(process.env, process.env.MEMORY_POOL ?? '') })
/**
 * PICKER-01: THE TOWN SINKS (sinks.mjs; OWNER 11-02 resource model Q3 + 11-03 "do it"): three REPEATABLE projects -- road segments,
 * wall towers, ziggurat growth (shrines) -- each a growing record of seeded instances, offered only when no finite project has a
 * slot for this bot, after the bounded upkeeps that go first and before the others, while the town's stone is above its target
 * (activeProject's sink tier; skills.mjs shopActive computes each sink's `sinkOpen` / `sinkNext`). Before the tidy (last). On in
 * the showcase pool only (sinks.mjs sinksOn); SINKS=off is the rollback; SINK_KINDS narrows the kinds.
 */
export const SINKS = Object.freeze({ on: sinksOn(process.env, process.env.MEMORY_POOL ?? ''), kinds: Object.freeze(sinkKindsOn(process.env)) })
export const PROJECTS = Object.freeze([
  Object.freeze({ plot: SHOP_PLOT, blueprint: SHOP_BLUEPRINT }),
  Object.freeze({ plot: SHAFT_PLOT, blueprint: SHAFT_BLUEPRINT, builders: SHAFT_BUILDERS }),   // no `after`: the stair needs no workshop (exposure: 7 of 12 shared towns have one, 10-30)
  Object.freeze({ plot: 'house1', blueprint: 'house@1', after: SHOP_PLOT }),
  Object.freeze({ plot: MONUMENT_PLOT, blueprint: MONUMENT_BLUEPRINT, after: SHOP_PLOT, builders: MONUMENT_BUILDERS }),
  Object.freeze({ plot: PATHS_PLOT, blueprint: PATHS_BLUEPRINT, after: 'house1', builders: PATHS_BUILDERS }),
  Object.freeze({ plot: WALL_PLOT, blueprint: WALL_BLUEPRINT, after: PATHS_PLOT, builders: WALL_BUILDERS }),
  Object.freeze({ plot: TREEFARM_PLOT, blueprint: TREEFARM_BLUEPRINT, after: PATHS_PLOT, builders: TREEFARM_BUILDERS }),
  Object.freeze({ plot: CROPFARM_PLOT, blueprint: CROPFARM_BLUEPRINT, after: TREEFARM_PLOT, builders: CROPFARM_BUILDERS }),   // cropfarm-01
  Object.freeze({ plot: SHOPCHEST_PLOT, blueprint: SHOPCHEST_BLUEPRINT, after: SHOP_PLOT, builders: SHOPCHEST_BUILDERS }),
  Object.freeze({ plot: STORE_PLOT, blueprint: STORE_BLUEPRINT, after: SHOP_PLOT, builders: STORE_BUILDERS }),
  Object.freeze({ plot: HALL_PLOT, blueprint: HALL_BLUEPRINT, after: STORE_PLOT, builders: HALL_BUILDERS }),
  Object.freeze({ plot: HUB_PLOT, blueprint: HUB_BLUEPRINT, after: STORE_PLOT, builders: HUB_BUILDERS }),   // storehub-01
  Object.freeze({ plot: WALLEXT_PLOT, blueprint: WALLEXT_BLUEPRINT, after: HUB_PLOT, builders: WALL_BUILDERS }),   // wallext-01: round the standing hall
  Object.freeze({ plot: YARD_PLOT, blueprint: YARD_BLUEPRINT, builders: YARD_BUILDERS }),
  ...SINK_KINDS.map(k => Object.freeze({ plot: SINK_PLOTS[k], blueprint: SINK_BLUEPRINTS[k], builders: SINK_BUILDERS, sink: true })),   // picker-01
  Object.freeze({ plot: TIDY_PLOT, blueprint: TIDY_BLUEPRINT, builders: GROUNDS.on ? 1 + GK.helpersMax : TIDY_BUILDERS }),   // gkhelpers-01: the keeper and its helpers
])
export const projectsOn = (on = HOUSE.on, mon = MONUMENT.on, paths = PATHS.on, wall = TOWNWALL.on, shaft = SHAFT.on, farm = TREEFARM.on, tidy = TIDY.on, store = STOREHOUSE.on, chest = SHOPCHEST.on, hall = COPPERHALL.on, yard = YARD.on, sinks = SINKS.on, kinds = SINKS.kinds, crop = CROPFARM.on, hub = STOREHUB.on, ext = TOWNWALLEXT.on) => PROJECTS.filter(p => p.plot === SHOP_PLOT || (p.sink ? sinks && kinds.includes(sinkKindOf(p.plot)) : p.plot === HUB_PLOT ? hub && store && on : p.plot === WALLEXT_PLOT ? ext && wall && hub && store && paths && on : p.plot === CROPFARM_PLOT ? crop && farm && paths && on : p.plot === YARD_PLOT ? yard : p.plot === SHAFT_PLOT ? shaft : p.plot === MONUMENT_PLOT ? mon : p.plot === PATHS_PLOT ? paths && on : p.plot === WALL_PLOT ? wall && paths && on : p.plot === TREEFARM_PLOT ? farm && paths && on : p.plot === TIDY_PLOT ? tidy : p.plot === STORE_PLOT ? store && on : p.plot === SHOPCHEST_PLOT ? chest && on : p.plot === HALL_PLOT ? hall && store && on : on))
/** The projects whose records are PROTECTED (keep-outs, the footprint, siting zones): the ones on, plus the town stair always --
 *  switching the stair off stops its building and its use, never its protection (Codex design r0: "switching off must not erase
 *  protection"). Pure. */
export const projectsGuarded = (list = projectsOn()) => {
  // tidy-01: the tidy guards nothing (its fills are ground, its cuts are spoil): never a footprint, a keep-out or a siting input
  const l = list.filter(p => p.plot !== TIDY_PLOT)
  const out = l.some(p => p.plot === SHAFT_PLOT) ? l : [...l, PROJECTS.find(p => p.plot === SHAFT_PLOT)]
  // picker-01: every sink plot stays guarded whatever the switch (SINKS=off stops the building, never a sited instance's protection)
  for (const p of PROJECTS) if (p.sink && !out.some(q => q.plot === p.plot)) out.push(p)
  // cropfarm-01 (Codex design: keep the reservation when farming is off): a sited crop farm stays guarded whatever its switch
  for (const p of PROJECTS) if (p.plot === CROPFARM_PLOT && !out.some(q => q.plot === p.plot)) out.push(p)
  // wallext-01: a sited wall extension stays guarded whatever its switch (its cells, its zones, its plots)
  for (const p of PROJECTS) if (p.plot === WALLEXT_PLOT && !out.some(q => q.plot === p.plot)) out.push(p)
  return out
}
/** A project's admission slots (the workshop's and a house's BUILDERS_MAX). Pure. */
export const buildersOf = p => p?.builders ?? BUILDERS_MAX
/**
 * THE PROJECT THE JOB WORKS ON NOW -> a PROJECTS entry. Pure. `states` [{ plot, exists, complete, damaged, free?, due? }] in PROJECTS
 * order (a missing state reads as no record). The first damaged complete project (repairs first), else the first not complete
 * whose `after` project is complete -- monument-01: the first such with an admission slot free for this bot (`free`, absent =
 * free), else the first such -- else the LAST project (everything stands: the order reads it complete and stays quiet).
 */
export function activeProject (states = [], list = projectsOn(), { upkeepTurn = false } = {}) {
  const st = p => states.find(s => s?.plot === p.plot) ?? { plot: p.plot, exists: false, complete: false, damaged: false }
  // sinkfix-01: the sink this bot may work now (see the sink tier below), read first -- a project this bot's own last visit found
  // nothing to do at (`idle`, idleMarks) yields to it, as a repair and as an open project
  // towndress-01 r1 (Codex r1 BLOCKER): a standing sink with upkeep DUE (a dress batch's unwritten signs) is offered too -- else, its next
  // batch unfunded, the signs waited behind every free finite project for good
  const sink = list.find(p => p.sink && (st(p).sinkOpen || st(p).sinkNext || (st(p).exists && st(p).complete && st(p).due)) && st(p).free !== false && !st(p).stuck && st(p).idle !== true) ?? null
  const yields = s => !!sink && s.idle === true
  for (const p of list) { const s = st(p); if (s.exists && s.complete && s.damaged && !yields(s)) return p }
  const open = []
  for (const p of list) {
    // picker-01: a sink is never in the finite order (its tier is below)
    if (p.sink) continue
    const s = st(p)
    if (s.exists && s.complete) continue
    if (p.after && !st(list.find(q => q.plot === p.after) ?? { plot: p.after }).complete) continue
    // copperhall-01: an unsited project WAITING on its opening rule (the hall's copper) is not offered; the next one is
    if (!s.exists && s.waiting === true) continue
    open.push(p)
  }
  // PICKER-01 (sinks.mjs): the sink a bot may work now -- an open instance, or the next one the picker wants (`sinkOpen` / `sinkNext`:
  // skills.mjs shopActive's states, in the picker's order: sinks.mjs sinkOrder), with an admission slot for this bot. Offered only
  // when no finite project has a slot for this bot (LIVE showcase 11-03 09:40-15:38Z: 67 of 101 tidy visits `keeper_held` -- the
  // keeper's grounds were every other bot's `open[0]` fallback), after the bounded upkeeps that go first, and -- after SINK_STREAK
  // sink visits (`upkeepTurn`) -- after one ordinary upkeep too. With no sink to offer, the order is exactly as before.
  // SINKFIX-01 (LIVE showcase 11-03 18:40-21:25Z, fold cbd2f51b: 158 sink picks, 0 sited, 0 sink visits -- every build order went
  // to the finished town stair as a REPAIR (80 visits, `complete`, nothing dug or placed: its damage read is transient) and, between
  // its three repair tries an hour, to the sited copper hall waiting on copper (11 visits, 0 placed) or the tidy): a finite project
  // this bot visited without effect in the last IDLE_MS yields to a wanted sink; with no sink, exactly as before
  const freeOpen = open.find(p => st(p).free !== false && !yields(st(p)))
  if (freeOpen) return freeOpen
  if (open.length && !sink) return open[0]
  if (sink) {
    for (const p of list) { const s = st(p); if (s.exists && s.complete && s.due && s.dueFirst) return p }
    if (upkeepTurn) for (const p of list) { const s = st(p); if (s.exists && s.complete && s.due && !p.sink) return p }
    return sink
  }
  // wall-01: a complete project that only wants a visit for its upkeep (`due`: the ziggurat's tidy) after every open one
  // sortstore-01: an upkeep marked `dueFirst` (the storehouse's labels and tidy: bounded, at most once per 10 min a bot) goes ahead of
  // the other upkeeps (LIVE showcase 11-01 17-22Z: 74 of 80 build visits went to a complete ziggurat whose `due` stays true and does
  // nothing; the storehouse, last in PROJECTS, would never get its turn)
  for (const p of list) { const s = st(p); if (s.exists && s.complete && s.due && s.dueFirst) return p }
  for (const p of list) { const s = st(p); if (s.exists && s.complete && s.due) return p }
  // copperhall-01 (Claude review r1 BLOCK): never a WAITING project as the fallback -- in the showcase (tidy and stair off) the
  // hall is the list's last, and an unsited "active" hall made every order a build_shop that ended copper_wait, the expeditions
  // never asked; the last project that is not waiting reads complete and the order stays quiet (the bot may go out)
  // picker-01: never a sink as the fallback (a sink is offered only by its own tier, above)
  for (let i = list.length - 1; i >= 0; i--) { const s = st(list[i]); if (!list[i].sink && !(!s.exists && s.waiting === true)) return list[i] }
  return list.filter(p => !p.sink).at(-1) ?? list[list.length - 1]
}
/**
 * A REPAIR THAT DOES NOT TAKE WAITS (wall-01, LIVE showcase 10-30 07:21Z on: a path cell under a block someone set on it read as
 * damage the paths' visit cannot mend -- `clears_wait`, nothing done -- and, repairs coming first, every bot's build order went to
 * it while the wall stood open). A project this bot has visited as a REPAIR REPAIR_TRIES times within REPAIR_WINDOW_MS and that
 * still reads damaged is taken as only `due` (after every open project) until the window ends; then it is a repair again. Pure.
 *   mem   Map plot -> { n, first } (the bot's own, for the connection)
 */
export const REPAIR_TRIES = 3
/**
 * THE TIDY AFTER A REPAIR (zigtidy-02, LIVE showcase 10-30: no tidy row from 07:16Z on -- since wall-01 r3 a finished ziggurat's
 * tidy was only `due`, after every open project, and the paths stood open all day at 261/263 `clears_wait`; the voidfill repair's
 * climbs left ten pillars by 22:30Z). For TIDY_AFTER_REPAIR_MS after the record's last REPAIR COMPLETION (a visit that placed and
 * ended complete; `repairedAt`, a town file) the tidy is a REPAIR (first), still bounded per bot by ZIG_TIDY_VISITS a pillar and
 * by repairBackoff; after it, `due` as before. A stamp more than a minute in the future (a bad clock) opens nothing. Pure.
 */
export const TIDY_AFTER_REPAIR_MS = 2 * 60 * 60_000
export const tidyIsRepair = (repairedAt, now = Date.now()) => Number.isFinite(repairedAt) && repairedAt <= now + 60_000 && now - repairedAt < TIDY_AFTER_REPAIR_MS
/** A COMPLETE record's stuck stamp is STALE when every cell it names is a record cell that reads done now (`cellDone(cell)`: the
 *  caller's world read; unread is not done). zigtidy-02 (buildproj.mjs stuckAt `stale`). Pure. */
export function stuckStale (keys = [], record = null, cellDone = () => false) {
  const byKey = new Map((record?.cells ?? []).map(c => [c.at.join(','), c]))
  return keys.every(k => { const c = byKey.get(k); return !!c && cellDone(c) === true })
}
/** An OPEN record's stuck stamp is STALE when the record has other work: an open cell (`cellOpen(cell) === true`: the caller's world
 *  read, read and not done; unread is not open) in a segment none of the stamp's cells is in -- the stamp was written when nothing
 *  else was open (buildrun.mjs settleStuck `stalled`), so the 6-h back-off holds only the stuck segment, never the rest of the
 *  project (wallstuck-01, LIVE showcase 10-30 23:17Z: Gale's stamp on W-03 held W-01's two open cells too). A light cell is never
 *  "other work" (its torch is the material run's). Pure. */
export function stuckOtherWork (keys = [], record = null, cellOpen = () => false) {
  const byKey = new Map((record?.cells ?? []).map(c => [c.at.join(','), c]))
  const segs = new Set(keys.map(k => byKey.get(k)?.seg).filter(Boolean))
  if (!segs.size) return false
  return (record?.cells ?? []).some(c => c.role !== 'light' && !segs.has(c.seg) && cellOpen(c) === true)
}
export const REPAIR_WINDOW_MS = 60 * 60_000
/**
 * SINKFIX-01: A VISIT THAT CHANGED NOTHING (no block placed, cleared or planted -- `no_effect`) marks its plot IDLE for this bot for
 * IDLE_MS; a visit that did something clears the mark. The bookkeeping stops (a full slot set, the switch, an unread file, an
 * abort: no visit happened) neither mark nor clear. A sink is never marked (its own no-site wait is sinks.mjs's). Pure over `mem`
 * (mutated: Map plot -> until ms).
 */
/** sinkfix-02: how far under the town's ground a bot may be when a sink visit is ordered (deeper: it is in a mine). */
export const SINK_SURFACE_DY = 8
export const IDLE_MS = 60 * 60_000   // = REPAIR_WINDOW_MS: a no-effect project is asked again once an hour by each bot
export const IDLE_NOT_A_VISIT = Object.freeze(new Set(['slots_full', 'off', 'zones_unknown', 'no_plan', 'aborted', 'record_unreadable', 'lost_record', 'state_unwritable', 'room', 'underground']))
export function noteIdle (mem, plot, result, now = Date.now()) {
  if (!mem || !plot || !result) return
  if (result.status === 'success') { mem.delete(plot); return }
  // SINKFIX-02 (LIVE showcase 11-04 01:25-03:17Z: the one open road instance headed the sink order for 2 h while 16 of its 21 visits
  // ABORTED -- 13 the stuck reflex at the same approach under the canopy, 3 started in a mine and entombed): a SINK's aborted or
  // no-effect visit marks it too, so this bot works the next sink kind for IDLE_MS; a finite project's abort still marks nothing
  if (result.status === 'aborted') { if (isSinkPlot(plot)) mem.set(plot, now + IDLE_MS); return }
  if (result.status !== 'no_effect' || IDLE_NOT_A_VISIT.has(String(result.stop ?? ''))) return
  mem.set(plot, now + IDLE_MS)
}
/** The states with this bot's idle marks (`idle: true` while a mark holds). Pure. */
export const idleMarks = (states = [], mem = null, now = Date.now()) => (mem?.size ? states.map(s => (s && (mem.get(s.plot) ?? -Infinity) > now ? { ...s, idle: true } : s)) : states)
export function repairBackoff (states = [], mem = null, now = Date.now()) {
  if (!mem) return states
  return states.map(st => {
    const e = st?.damaged ? mem.get(st.plot) : null
    return e && e.n >= REPAIR_TRIES && now - e.first < REPAIR_WINDOW_MS ? { ...st, damaged: false, due: true } : st
  })
}
/** A visit starting on `pick` as a repair (its state damaged) is counted (a window older than REPAIR_WINDOW_MS starts again). Pure
 *  over `mem` (mutated). */
export function noteRepair (mem, pick, states = [], now = Date.now()) {
  if (!mem || !pick) return
  const st = states.find(x => x?.plot === pick.plot)
  if (!st?.damaged) return
  const e = mem.get(pick.plot)
  mem.set(pick.plot, e && now - e.first < REPAIR_WINDOW_MS ? { n: e.n + 1, first: e.first } : { n: 1, first: now })
}
/**
 * A STUCK PROJECT WAITS BEHIND THE OTHERS (stuckwait-01, LIVE showcase 10-30 10:24Z on: the ziggurat's repair hit two cells no
 * stand reached -- a sealed void an escape dug in its core -- and its F4 back-off (any builder's stuck_on_cell holds the ORDER for
 * SHOP_STUCK_RETRY_MS) held EVERY bot's build_shop for 6 h, because the stuck ziggurat stayed the active project (repairs first)
 * while the wall stood open at 198 of 941). A project whose stuck stamp is inside the back-off is taken as only `due` when complete
 * (after every open project, as repairBackoff does) and as not `free` when open (the next open project first); with nothing else
 * to work, activeProject still returns it and the order's back-off holds as before. Pure.
 *   stuckOf  plot -> the project's stuck stamp ms | null (buildproj.mjs stuckAt); a throw reads as none
 */
export function stuckBackoff (states = [], stuckOf = null, now = Date.now()) {
  if (typeof stuckOf !== 'function') return states
  return states.map(st => {
    if (!st?.exists) return st
    let sa = null
    try { sa = stuckOf(st.plot) } catch { sa = null }
    if (!(Number.isFinite(sa) && sa <= now + 60_000 && now - sa < stuckWindowOf(st.plot))) return st
    return st.complete ? { ...st, damaged: false, due: true, stuck: true } : { ...st, free: false, stuck: true }
  })
}
/** THE OTHER PROJECTS' RECORDS AS SITING ZONES -> [{ box: [x0,y0,z0,x1,y1,z1] }]: each record's x/z box widened by `margin`
 *  (a walk lane between buildings and the stand ring), every height. Pure. */
export const PROJECT_GAP = 3
export function recordZones (records = [], margin = PROJECT_GAP) {
  const out = []
  for (const r of records) {
    // paths-01: a record that names its own zones (the paths: their columns + 1; a box would be the whole town)
    if (Array.isArray(r?.zones)) { for (const z of r.zones) if (Array.isArray(z?.box) && z.box.length === 6 && z.box.every(Number.isFinite)) out.push(z); continue }
    const b = r?.box
    if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) continue
    out.push({ box: [b[0] - margin, -64, b[1] - margin, b[2] + margin, 320, b[3] + margin], why: `project:${r.plot ?? '?'}` })
  }
  return out
}
export const BUILDERS_MAX = 2
export const SHOP_COOLDOWN_MS = Number(process.env.SHOP_COOLDOWN_MS) > 0 ? Number(process.env.SHOP_COOLDOWN_MS) : 10 * 60_000   // a setting (sandbox pacing)
export const SHOP_SITE_RETRY_MS = 24 * 60 * 60_000       // S1: no site -> re-fit daily
export const SHOP_STUCK_RETRY_MS = 6 * 60 * 60_000       // F4: a cell no stand reached in STUCK_VISITS visits -> ask again in 6 h
/** shaft-03 (LIVE 10-31: 11 towns' stairs held 6 h at a time, then again, by single `walk_failed` / `no_reach` / `no_support`
 *  visits -- the stamp is the PROJECT's, so one bot's failed visit holds every bot): a stair stamp holds 30 min. Its failures
 *  are one visit's, not "a cell no stand reached in 3 visits"; the stair's own cooldown asks again in 2 min. */
export const SHAFT_STUCK_RETRY_MS = 30 * 60_000
// storehouse-01 r4 (LIVE showcase 11-01 14:45Z: the three torches deferred no_stand while a spruce's leaves walled the doorway in,
// and the stamp held the whole order 6 h): a storehouse stamp holds 30 min, as the stair's -- its next visit tidies the doorway first
export const stuckWindowOf = plot => (plot === SHAFT_PLOT || plot === STORE_PLOT ? SHAFT_STUCK_RETRY_MS : SHOP_STUCK_RETRY_MS)
export const SHOP_HEALTH_MIN = 10
export const SHOP_BAG_SLOTS_MIN = 8                      // the bill rides in the bag: at least this many free slots
export const MONUMENT_BAG_SLOTS_MIN = 2                  // monument-01: the ziggurat is built mostly from the cobble a bag already holds
/** The projects a bag needs only MONUMENT_BAG_SLOTS_MIN free slots for (paths-01: a shovel's use draws nothing). */
/** wall-01: the wall is built from the cobblestone the bags carry, as the ziggurat is. */
/** treefarm-04: the farm plants from the bag's saplings and takes its harvest into it. */
/** tidy-01: the tidy fills from the dirt and cobblestone a bag already holds. */
/** picker-01: a sink is built from the cobblestone and stone a bag already holds, as the ziggurat is. */
export const LIGHT_PLOTS = Object.freeze(new Set([MONUMENT_PLOT, PATHS_PLOT, WALL_PLOT, WALLEXT_PLOT, SHAFT_PLOT, TREEFARM_PLOT, TIDY_PLOT, ...Object.values(SINK_PLOTS)]))
/** THE ACTIVE PROJECT'S PLOT for an order with no record yet (skills.mjs installs shopActive's: an unsited project's bag rule). */
let activePlotOf = () => null
export function setActivePlot (fn) { if (typeof fn === 'function') activePlotOf = fn }
/**
 * EXPEDITION-01: the expedition's ask (skills.mjs expeditionAsk -> expedition.mjs expeditionAdmit over the bot's readings), set at
 * load like activePlotOf. Asked by buildOrder only when the build order has nothing for the bot: every project complete, or the
 * last visit stopped no_material. -> { ok, phase } | null. Unset (or EXPEDITION=off): never asked.
 */
let expeditionAskOf = null
/**
 * HAS THE BUILD ORDER NO USE FOR THIS BOT? -> bool. Pure. Every project complete; or the bot's last visit stopped for want of
 * material; or the ACTIVE project's record is itself complete (only a `due` upkeep left) and the last visit found nothing to do
 * there (LIVE showcase 10-31 16:54Z: the finished farm's 3 trees no bot can fell kept `complete` false). A `complete` stop alone
 * is not idle: the visit that completes one project ends `complete` while the next one stands open (Codex r4 BLOCK).
 */
// IDLEKEEP-01 (LIVE showcase 11-03 04:15-06:17Z: copperrun-01 never exposed -- 0 copper_run rows, 0 expedition rows -- while
// 87 of 113 build visits ended `keeper_held` in ~0.2 s: with every other project complete, the only open one was the
// groundskeeper's tidy, which is another bot's, so every non-keeper's order came back each 10 min, did nothing, and its
// lastStop `keeper_held` was never idle). `keeper_held` is the order having no use for this bot, like `no_material`.
export const IDLE_STOPS = Object.freeze(['no_material', 'keeper_held'])
export const buildIdle = ({ complete = false, record = null, lastStop = null } = {}) =>
  !!complete || IDLE_STOPS.includes(lastStop) || (lastStop === 'complete' && record?.structure_complete === true)
export function setExpeditionAsk (fn) { expeditionAskOf = typeof fn === 'function' ? fn : null }
/**
 * COPPERRUN-01: the copper run's ask (skills.mjs copperAsk -> copperhall.mjs copperRunOrder), set at install like the expedition's.
 * Asked by buildOrder in the same idle branch, BEFORE the expedition: a bot the projects cannot use fetches the waiting hall's
 * copper first. -> { order } | null. Unset (or COPPERRUN/COPPERHALL off): never asked.
 */
let copperAskOf = null
export function setCopperAsk (fn) { copperAskOf = typeof fn === 'function' ? fn : null }
/** groundskeeper-01: does THIS bot hold its town's keeper lease now (skills.mjs keeperNow; no cognitive change)? */
let keeperOf = () => false
export function setKeeperNow (fn) { if (typeof fn === 'function') keeperOf = fn }
/**
 * SINKFIX-03: THE PLOT THIS BOT LAST FAILED TO SITE (skills.mjs buildShop records it; cognitive.mjs's order state knows only the
 * bot's last STOP). LIVE showcase 11-04 07:09-08:09Z (15 bots): after one `no_site` -- the crop farm's or the road's -- every bot's
 * build order went quiet for SHOP_SITE_RETRY_MS (24 h): a sink wanting its next instance reads unsited, so the tower the picker
 * wanted (`tower:ok`) was held by the ROAD's failure; build work fell from 145 to 23 blocks/h. The site retry holds only the plot that
 * failed; an unknown plot (no hook, a restart) holds as before.
 */
let noSitePlotOf = () => null
export function setNoSitePlot (fn) { if (typeof fn === 'function') noSitePlotOf = fn }
/** Does the bot's last `no_site` hold the order for this plot? Pure. */
export const siteRetryHolds = (plot, failed) => failed == null || plot == null || failed === plot
/** showcase siteprep fold (Codex fold review BLOCKER): a plot the keeper PREPARED for this bot's sink kind (skills.mjs: siteprep's
 *  prepClaimFor) is never held by the bot's own 24-h site retry -- the claim bypasses the no-site waits, else a prepared plot whose
 *  every eligible bot had failed that kind expired unclaimed (PREP.readyMs). Unset or throwing: no claim. */
/**
 * SINKFIX-04: IS THIS BOT'S LAST VISIT TO A PLOT IDLE-MARKED (shop.mjs noteIdle, skills.mjs bot.shopIdle)? LIVE 11-04 10:44-11:47Z:
 * tidy 46 visits, 0 placed -- 32 helpers told `nothing of the grounds is this helper's now`, 11 helper visits `complete` with nothing
 * done: with no sink to yield to, the order offered the grounds again every cooldown. The TIDY's order stays quiet for this bot
 * while its mark holds (a sink wanted is offered instead, as before); every other project's order is unchanged.
 */
let idleOf = () => false
export function setIdleNow (fn) { if (typeof fn === 'function') idleOf = fn }
/** THE SITEPREP-02 FOLD (Codex fold review BLOCKER): is the grounds order quiet for this bot? -> bool. Pure. sinkfix-04 quiets it while the
 *  bot's own idle mark holds -- but the KEEPER's prep ticks run as grounds visits, and a tick that grades and chooses nothing yet is a
 *  no-effect visit that marks it: the next tick waited an hour (LIVE 11-04 12:10-12:41Z: one SP1 tick in 30 min, three an hour
 *  before). The keeper (the GK lease itself, never a helper) with a site request to search or prepare is never quiet. */
export const tidyQuiet = ({ idle = false, keeper = false, prepWork = false } = {}) => !!idle && !(keeper && prepWork)
let prepClaimedOf = () => false
export function setPrepClaimed (fn) { if (typeof fn === 'function') prepClaimedOf = fn }
const prepClaimed = plot => { try { return !!prepClaimedOf(plot) } catch { return false } }
/** The order's cooldown for a plot -> ms: the stair's SHAFT_COOLDOWN_MS, the KEEPER's tidy GK.cooldownMs (its grounds are its job),
 *  else SHOP_COOLDOWN_MS. Pure but for the keeper hook. */
export function orderCooldown (plot) {
  if (plot === SHAFT_PLOT) return SHAFT_COOLDOWN_MS
  if (isSinkPlot(plot)) return SINK.cooldownMs   // picker-01: a sink visit is bounded and its work is ready (the stair's rule)
  if (plot === TIDY_PLOT) { let k = false; try { k = !!keeperOf() } catch { k = false } if (k) return GK.cooldownMs }
  return SHOP_COOLDOWN_MS
}
export const SHOP_BILL_CAP = 4 * 64                      // at most this many blocks drawn per visit
export const SHOP_VISIT_MS = 8 * 60_000
// the walks a footprint is priced on (design 4.4 scope, Codex r1 P2): WORK and TRAVEL. The escape and reflex walks (ascend,
// descend, water) keep their survival digs: damage is rebuilt on the next visit
export const FOOTPRINT_PROFILES = Object.freeze(new Set(['walk', 'gather', 'tunnel', 'composter_walk', 'town_deposit_walk']))
export const TOWN_R = 16

/** THE FOOTPRINT -> Set "x,y,z" of every record cell + 1 (a 3x3x3 around each). Pure. */
export function footprintCells (record) {
  const out = new Set()
  for (const c of record?.cells ?? []) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) out.add(`${c.at[0] + dx},${c.at[1] + dy},${c.at[2] + dz}`)
  return out
}
/**
 * NO SAPLING IN A PROJECT'S COLUMNS (fell-01, LIVE 10-27 showcase: a spruce stood in shop pad cell 25,72,28 with its trunk up
 * through the wall cells; the builder could never place there). A tree grows UP and its leaves spread ~2 blocks, so the guard
 * is the record cells' x/z box widened by SAPLING_MARGIN, at every height. -> { x0, z0, x1, z1 } | null (no record). Pure.
 */
export const SAPLING_MARGIN = 2
export function saplingBox (record, margin = SAPLING_MARGIN) {
  const cs = record?.cells ?? []
  if (!cs.length) return null
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const c of cs) { x0 = Math.min(x0, c.at[0]); x1 = Math.max(x1, c.at[0]); z0 = Math.min(z0, c.at[2]); z1 = Math.max(z1, c.at[2]) }
  return { x0: x0 - margin, z0: z0 - margin, x1: x1 + margin, z1: z1 + margin }
}
/** The project's OPEN-or-built record cells as "x,y,z" keys (the place skill's keep-out; shopwalls-05). Pure. */
export const recordCellKeys = record => new Set((record?.cells ?? []).map(c => c.at.join(',')))
/** A place() candidate ({ ref, face }) whose target cell (ref + face) is a record cell? Pure. LIVE showcase 10-28 16:33Z: an
 *  idle `place crafting_table` put the table into the workshop's last open roof cell 24,75,31; every visit then read
 *  `blocked: 1 open, 0 placeable now`. */
export const recordCellHit = (cells, c) => { const p = c?.ref?.position; return !!(p && cells?.size && cells.has(`${p.x + (c.face?.x ?? 0)},${p.y + (c.face?.y ?? 0)},${p.z + (c.face?.z ?? 0)}`)) }
/** May a sapling go into the cell at column (x, z)? false inside the box -- or inside any box of a list (house-01: one per
 *  project record). Pure. */
export const saplingAllowedAt = (box, x, z) => (Array.isArray(box) ? box.every(b => saplingAllowedAt(b, x, z)) : box?.cols ? !box.cols.has(`${x},${z}`) : (!box || x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1))
/** A place() candidate ({ ref, face }) for a sapling: its target cell (ref + face) outside the box? Pure. */
export const saplingCandidateOk = (box, c) => { const p = c?.ref?.position; return !p || saplingAllowedAt(box, p.x + (c.face?.x ?? 0), p.z + (c.face?.z ?? 0)) }
/** The footprint's price for a block on the current walk: 100 (mineflayer-pathfinder drops the move) on a work or travel walk,
 *  else 0. One Set lookup (the A* hot path). Pure. */
export const footprintCost = (cells, profile, block) => {
  const p = block?.position
  if (!p || !cells || !FOOTPRINT_PROFILES.has(profile)) return 0
  const k = `${p.x},${p.y},${p.z}`
  if (cells.size && cells.has(k)) return 100
  // MONUMENT-01 (`cells.solidOnly`: the ziggurat's record cells, no halo): priced while the cell holds a SOLID block, judged at the
  // check itself (Codex r6 BLOCK 1: a built-cells set refreshed every 60 s left a cell built since unpriced). So a walk never breaks
  // a built cell, and an OPEN one takes the pathfinder's scaffold -- LIVE showcase 10-29 16:00-16:40Z: 19 `_reflex_stuck` in the
  // foundation's hollows, builders who could neither break the canopy in the +1 halo nor pillar out of their own open cell.
  if (cells.solidOnly?.has?.(k) && block.boundingBox === 'block') return 100
  // ZIGTIDY-02 (`cells.soft`: a COMPLETE ziggurat's tread tops, ziggurat.mjs zigTreadTops): a walk's scaffold there is PRICED, not
  // forbidden -- LIVE showcase 10-30 16:45-22:30Z: ten dirt pillars on the finished treads, the walks to the top climbing each
  // 2-high tier wall by a 1x1 tower beside it instead of taking the grand stair. A bot with no other way still climbs
  return cells.soft?.get?.(k) ?? 0
}
/** The pathfinder entry for the footprint (one fn for exclusionAreasBreak and exclusionAreasPlace), TAGGED so an escape clone can
 *  drop it. `cells()` / `profile()` are read at search time. */
export function footprintEntry (cells, profile) {
  const f = block => footprintCost(cells(), profile(), block)
  f.shopFootprint = true
  return f
}
/**
 * AN ESCAPE CLONE CARRIES NO FOOTPRINT PRICE (W3 one-trunk merge, Codex P1): the price read the ACTIVE profile, so a probe
 * searched on the ascend/descend/water/deck Movements while the active profile was still `walk` (skills.mjs surface) was
 * vetoed on workshop cells, and the climb could fall back to a shaft that fails. Bound to the Movements object instead,
 * as nobridge-01 r2 did: the clone's own arrays without the tagged entries. Mutates and returns `m`.
 */
export function withoutFootprint (m) {
  if (!m) return m
  for (const k of ['exclusionAreasBreak', 'exclusionAreasPlace']) if (Array.isArray(m[k])) m[k] = m[k].filter(f => !f?.shopFootprint)
  return m
}

/**
 * THE BILL of the open cells -> { name: n }. Pure. `has(name)` is the bag; the first palette choice, a fallback only when the
 * first is not in the town (`inTown(name)`); '$planks' resolves to `planks` (the town's most-stocked species).
 */
export function billOf (record, palette, read, { done, inTown = () => true, planks = 'oak_planks' } = {}) {
  const out = {}
  for (const c of record?.cells ?? []) {
    if (done(read(...c.at), palette, c.role)) continue
    const name = c.role === 'fill' ? 'cobblestone' : resolve(palette, c.role, inTown, planks)
    if (name) out[name] = (out[name] ?? 0) + 1
  }
  return out
}
/** A role's names in palette order ('$planks' -> the planks species, '$role' -> that role's names, once each). Pure. */
export function roleNames (palette, role, planks = 'oak_planks', seen = new Set([role])) {
  const out = []
  for (const choice of palette?.[role] ?? []) {
    if (choice === '*solid') continue                       // a done-rule (buildrun.mjs SOLID_ANY), not a block
    if (choice === '$planks') out.push(planks)
    else if (choice.startsWith('$')) { const r = choice.slice(1); if (!seen.has(r)) { seen.add(r); out.push(...roleNames(palette, r, planks, seen)) } } else out.push(choice)
  }
  return [...new Set(out)]
}
/** The block a bill counts for a role: the first of its names the town stocks, else its first name. Pure. */
function resolve (palette, role, inTown, planks) {
  const names = roleNames(palette, role, planks)
  return names.find(n => inTown(n)) ?? names[0] ?? null
}
/**
 * THE PROJECT'S SHARE OF THE BAG (Paper 10-25, SHOP-KILL and CHAIN-1: a deadlock) -> { name: n }: the drawn record clamped to
 * what the bag holds now. Pure. Why: the visit's keeps (towndeposit townKeeps: STOCKPILE_KEEP wood, the stone family) are
 * computed from the bag at the visit's start, so materials an EARLIER visit drew and did not place (a kill, a deps_open stop, a
 * no_material stop: matsBank cannot bank a kept name back) became the bag's own stockpile -- held, unspendable, and the town
 * already at BUILD_RESERVE: the builder held 36 planks and stopped `no_material` on one wall cell for 40 minutes.
 */
export function drawnHeld (drawn = {}, held = {}, bagAt = null) {
  // a DECREASE of the bag since the record was written (another job spent some: the peaceful kit's composter) comes off the
  // project's share first, so the bot's own stock is never relabelled the project's (r10, Codex P2); with no baseline, the
  // clamp to the bag alone. An increase (a pickup) is the bot's own.
  const out = {}
  for (const [n, c] of Object.entries(drawn ?? {})) {
    const fell = bagAt && Number.isFinite(Number(bagAt[n])) ? Math.max(0, Number(bagAt[n]) - (Number(held?.[n]) || 0)) : 0
    const v = Math.min((Number(c) || 0) - fell, Number(held?.[n]) || 0)
    if (v > 0) out[n] = v
  }
  return out
}
/** How long a share outlives its last write (a visit, or the decrease below) before it is the bag's own: a builder that has not
 *  visited for this long holds no workshop materials (r16 reviews, both P2: a share that never empties barred the bot from
 *  every town station for good). A live build rewrites its share at every take, placement and exit. */
export const SHARE_TTL_MS = 2 * 3600_000
/**
 * THE SHARE'S STATE for the town-station gate (skills.mjs shopShareHeld) -> { held: bool, share, write: null | {} | share }.
 * Pure. Not held when: no share; written longer than SHARE_TTL_MS ago; or the workshop is COMPLETE and the share is no newer
 * than the completion (another builder finished: a completed build's leftovers are the bag's own -- `write: {}` clears it).
 * A share the bag has fallen below (another job spent some) is RETIRED down to what is left (`write: share`), so a later
 * pickup of the same name is the bot's own and never resurrects it (r16 Codex P2: drawn 4, baseline 20, bag 16 then 20).
 */
export function shareState (dr = {}, held = {}, { now = Date.now(), complete = false, completeAt = null, ttl = SHARE_TTL_MS } = {}) {
  const drawn = dr?.drawn ?? {}
  if (!Object.keys(drawn).length) return { held: false, share: {}, write: null }
  const at = Number(dr?.at)
  // a complete record WITHOUT its completion time is no boundary (r17 Codex P2): the share stands until its TTL
  if (complete && Number.isFinite(Number(completeAt)) && !(at > Number(completeAt))) return { held: false, share: {}, write: {} }
  if (!Number.isFinite(at) || now - at > ttl) return { held: false, share: {}, write: null }
  const share = drawnHeld(drawn, held, dr?.bag)
  const fell = Object.keys(drawn).some(n => (share[n] ?? 0) < (Number(drawn[n]) || 0))
  return { held: Object.keys(share).length > 0, share, write: fell ? share : null }
}
/** The bag less the project's share -> { name: n }: what the bot owns, the only counts its keeps are computed from. Pure. */
export function ownCounts (held = {}, drawn = {}) {
  const out = {}
  for (const [n, c] of Object.entries(held ?? {})) { const v = (Number(c) || 0) - (Number(drawn?.[n]) || 0); if (v > 0) out[n] = v }
  return out
}
/** The drawn record after a visit -> { name: n }: drawn + took + crafted - placed - back, never below 0 nor above the bag. Pure. */
export function drawnAfter ({ drawn = {}, took = {}, crafted = {}, placed = {}, back = {}, bag1 = {} } = {}) {
  const names = new Set([drawn, took, crafted, placed, back].flatMap(m => Object.keys(m ?? {})))
  const n = (m, k) => Number(m?.[k]) || 0
  const out = {}
  for (const k of names) { const v = Math.min(n(bag1, k), n(drawn, k) + n(took, k) + n(crafted, k) - n(placed, k) - n(back, k)); if (v > 0) out[k] = v }
  return out
}
/** What the visit still needs from town -> { name: n }: the bill less the bag, capped at SHOP_BILL_CAP in all. Pure. */
export function needFromTown (bill, bag = {}, cap = SHOP_BILL_CAP) {
  const out = {}
  let left = cap
  for (const [n, c] of Object.entries(bill).sort((a, b) => b[1] - a[1])) {
    const want = Math.max(0, c - (Number(bag[n]) || 0))
    const take = Math.min(want, left)
    if (take > 0) { out[n] = take; left -= take }
  }
  return out
}
/**
 * PLANKS FROM THE TOWN'S LOGS (shopwalls-1028; LIVE showcase 10-28 11:50Z on: pad and ring done, then every visit stopped
 * `no_material why=wall_for_wall-F` for hours -- the town held 0 planks and 412 spruce logs, the bill asked for `oak_planks`,
 * the withdraw found none, and nothing crafted planks for a project: the mats job has no planks kind). -> { log, logs, planks }
 * | null. Pure. `want` is the visit's needs, `spare(name)` what the bag holds above its keeps AFTER the town draw, `town` the
 * indexed stock. The shortfall is every *_planks the needs name (any species: a '$planks' cell takes any) less the bag's spare
 * planks of every species; it is drawn as whole logs (1 log -> 4 planks) of the town's most-stocked log species. The town's
 * reserve is not judged here: the withdraw's own `allow` (the project reserve) caps what is taken.
 */
/** IS A NAME "IN TOWN" FOR THE BILL'S PALETTE CHOICE -> (name) => bool. Pure. Its stock, or -- for planks -- any log in town (the
 *  visit crafts them: planksFromLogs). Without the second half a trim cell (['cut_copper', '$planks']) in a town of logs and no
 *  planks resolved to cut_copper, which the town cannot supply: its planks were never drawn and the trim stopped no_material. */
export const billInTown = (town = {}) => {
  const logs = LOG_NAMES.some(n => (Number(town?.[n]) || 0) > 0)
  return n => (Number(town?.[n]) || 0) > 0 || (/_planks$/.test(n) && logs)
}
export function planksFromLogs (want = {}, { spare = () => 0, town = {} } = {}) {
  const wanted = Object.entries(want ?? {}).filter(([n]) => /_planks$/.test(n)).reduce((t, [, c]) => t + (Number(c) || 0), 0)
  if (wanted <= 0) return null
  const held = Object.values(PLANKS_OF).reduce((t, n) => t + Math.max(0, Number(spare(n)) || 0), 0)
  const short = wanted - held
  if (short <= 0) return null
  let log = null
  for (const n of LOG_NAMES) { const c = Number(town?.[n]) || 0; if (c > 0 && (!log || c > (Number(town[log]) || 0))) log = n }
  if (!log) return null
  const logs = Math.ceil(short / 4)
  return { log, logs, planks: PLANKS_OF[log] }
}
/**
 * WHAT A VISIT DRAWS -> { name: n } (r2): the open cells' bill; a sapling for every pending replant whose cell holds none (Codex r1
 * P2: C1's remedy made executable -- the town's saplings come with the bill); and the inputs of a station the town cannot supply
 * (8 cobblestone a furnace, 4 planks a table: Claude r1 P3-4, the craft never eats the fill). Pure.
 */
export function visitNeeds (record, bill, { saplingAt = () => false, town = {}, spare = {}, planks = 'oak_planks' } = {}) {
  const out = { ...bill }
  for (const r of record?.replant ?? []) if (r?.sapling && r.state !== 'skipped' && !saplingAt(r.cell)) out[r.sapling] = (out[r.sapling] ?? 0) + 1
  // shopchest-01: a chest the town cannot supply is crafted the same way (8 planks)
  for (const [item, input, n] of [['furnace', 'cobblestone', 8], ['crafting_table', planks, 4], ['chest', planks, 8]]) {
    const lack = (Number(bill[item]) || 0) - (Number(spare[item]) || 0)
    if (lack > 0 && (Number(town[item]) || 0) < lack) out[input] = (out[input] ?? 0) + n * lack
  }
  return out
}
/** THE LEFTOVERS -> [name]: what the visit drew (`took`) that the bag still holds ABOVE its count at the visit's start (`held0`),
 *  so never anything the bot owned before the visit or kept (matsBank then banks at most `took` of each, above `held0`). Pure. */
export function leftoverNames (took = {}, held0 = {}, heldNow = {}) {
  return Object.keys(took).filter(n => (Number(took[n]) || 0) > 0 && (Number(heldNow[n]) || 0) > (Number(held0[n]) || 0))
}
/**
 * THE VISIT'S BAG BALANCE (read r1: Codex P1-2, Claude P3-4) -> { name: { bag0, took, crafted, placed, back, bag1, unexplained } }
 * for every name the visit touched. Pure. unexplained = bag1 - (bag0 + took + crafted - placed - back): NEGATIVE is a loss the visit
 * cannot account for (a pickup on the way makes it positive; the pathfinder's scaffold of cobblestone or planks makes it
 * negative and is legitimate for those two -- SCAFFOLD_NAMES -- so the read gates only the other names).
 */
export function bagBalance ({ bag0 = {}, took = {}, crafted = {}, placed = {}, back = {}, bag1 = {} } = {}) {
  const names = new Set([...Object.keys(took), ...Object.keys(crafted), ...Object.keys(placed), ...Object.keys(back)])
  const out = {}
  const n = (m, k) => Number(m?.[k]) || 0
  for (const k of names) {
    const v = { bag0: n(bag0, k), took: n(took, k), crafted: n(crafted, k), placed: n(placed, k), back: n(back, k), bag1: n(bag1, k) }
    v.unexplained = v.bag1 - (v.bag0 + v.took + v.crafted - v.placed - v.back)
    out[k] = v
  }
  return out
}
export const SCAFFOLD_NAMES = Object.freeze(new Set(['cobblestone', 'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'pale_oak_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks']))
/** `_build_bag` detail: `project=shop name=bag0/took/crafted/placed/back/bag1 ...` (under 300 characters: names by unexplained first). */
export const buildBagDetail = (project, bal, { exit = '-', silent = '-', drawn = '-' } = {}) => {
  const parts = Object.entries(bal).sort((a, b) => a[1].unexplained - b[1].unexplained).map(([k, v]) => `${k}=${v.bag0}/${v.took}/${v.crafted}/${v.placed}/${v.back}/${v.bag1}`)
  let s = `project=${project} exit=${String(exit).replace(/\s+/g, '_').slice(0, 24)} silent=${silent} drawn=${drawn}`
  for (const p of parts) { if ((s + ' ' + p).length > 290) break; s += ' ' + p }
  return s
}
/** The skill's contract time (skills.mjs build_shop maxMs) and the least left for a bank to start (Claude r3 P3-1). */
export const SHOP_SKILL_MS = 600_000
export const SHOP_BANK_MIN_MS = 150_000
/**
 * HOW MUCH OF A NAME THE VISIT MAY TAKE from the container it stands at (matsWithdraw's `allow`) -> n. Pure. A reserved family
 * is mats.mjs takeAllowed (the BUILD_RESERVE and the outstanding draws, judged at the take); a building PART has no reserve
 * (Paper r1: takeAllowed answers 0 for a name with no reserve key, so stone bricks, panes, cut copper, stations and saplings
 * were never drawn) and is taken up to what the container shows.
 */
export function shopAllow (name, want, o = {}) {
  if (reserveKeyOf(name)) return takeAllowed(name, want, o)
  return Math.max(0, Math.min(Number(want) || 0, Number(o?.here?.[name]) || 0))
}
/**
 * SPENDABLE FOR A PROJECT (cooperation A9) -> n. Pure. The town's stock of `item` less its BUILD_RESERVE (by reserve family, the
 * whole family's stock above the family's reserve: mats.mjs reserveCount) less every OTHER claim on it (draws in flight, other
 * projects' claims: `claims` { name: n }), never below 0. A building part (no reserve key) is all of its stock less claims.
 */
export function spendableFor (item, stock = {}, { reserve = {}, claims = {} } = {}) {   // reserve: mats.mjs matsReserve().table (its one reader)
  const rk = reserveKeyOf(item)
  const own = Number(stock[item]) || 0
  const claimed = Number(claims[item]) || 0
  if (!rk) return Math.max(0, own - claimed)
  const famAbove = Math.max(0, reserveCount(rk, stock) - (Number(reserve?.[rk]) || 0))
  return Math.max(0, Math.min(own, famAbove) - claimed)
}

/**
 * THE TOWN ORDER (host part of buildEligible, design 4.1/A8) -> { order, skip }. Pure. At town only, shared towns only, no
 * milestone holding, after the cooldown; the record complete is no order; S1 (no site) waits a day; a full slot set, low health,
 * or a bag without room is a skip with its reason.
 */
export function buildOrder ({ on = SHOP.on, shared = true, atTown = false, holds = false, now = 0, state = {}, record = null,
  complete = false, slotsFree = true, health = 20, freeSlots = 36, planned = true, stuckAt = null, feet = null, groundY = null } = {}) {
  if (!on || !shared || !atTown || holds) return { order: null, skip: null }
  // no town plan yet: nothing to site a workshop in, and no order (it would only displace the model's turn)
  if (!planned) return { order: null, skip: null }
  // picker-01: a SINK as the active project is no finite work -- the copper run (a waiting finite project's need) and the expedition
  // (one slot) are asked first, as for a bot the projects cannot use; the expedition's ask is told the projects are done
  let sinkNow = false
  try { sinkNow = isSinkPlot(record?.plot ?? activePlotOf()) } catch { sinkNow = false }
  // EXPEDITION-01 (owner showcase item 5): a bot the town's projects cannot use (all complete, or its last visit found no
  // material) may go on a short expedition -- the same order, the visit's args say which (skills.mjs buildShop)
  // copperrun-01: the waiting hall's copper first (its own skips say why not); then the expedition exactly as before
  if ((sinkNow || buildIdle({ complete, record, lastStop: state.lastStop })) && copperAskOf) {
    let cr = null
    try { cr = copperAskOf({ now, health, freeSlots }) } catch { cr = null }
    if (cr?.order) return { order: cr.order, skip: null }
  }
  if ((sinkNow || buildIdle({ complete, record, lastStop: state.lastStop })) && expeditionAskOf) {
    let ex = null
    try { ex = expeditionAskOf({ now, health, freeSlots, complete: complete || sinkNow, lastStop: state.lastStop ?? null }) } catch { ex = null }
    if (ex?.ok) return { order: { skill: 'build_shop', args: { expedition: true, phase: ex.phase ?? 'trip' } }, skip: null }
  }
  if (complete) return { order: null, skip: 'complete' }
  // shaft-02: the town stair's visit is asked again after SHAFT_COOLDOWN_MS (its record's plot, or the active plot unsited)
  let plot0 = record?.plot ?? null
  if (!record) { try { plot0 = activePlotOf() } catch { plot0 = null } }
  if (now - (state.lastAt ?? -Infinity) < orderCooldown(plot0)) return { order: null, skip: null }
  { let idle = false; try { idle = plot0 === TIDY_PLOT && !!idleOf(plot0) } catch { idle = false } if (idle) return { order: null, skip: 'idle' } }
  let failedSite = null
  try { failedSite = noSitePlotOf() } catch { failedSite = null }
  if (!record && state.lastStop === 'no_site' && now - (state.lastAt ?? -Infinity) < SHOP_SITE_RETRY_MS && !prepClaimed(plot0) && siteRetryHolds(plot0, failedSite)) return { order: null, skip: 'no_site' }
  // F4 back-off: the PROJECT's (`stuckAt`, the stuck files: across restarts and bots -- Claude r21 P3-3), or this bot's own stop.
  // `stuckAt` may be a function, read only here, past the cheap skips (Claude r22 P3); a stamp more than a minute in the FUTURE
  // (a skewed or bad clock) is ignored rather than holding the project skew + 6 h
  const sa = typeof stuckAt === 'function' ? stuckAt(now) : stuckAt
  if (Number.isFinite(sa) && sa <= now + 60_000 && now - sa < stuckWindowOf(plot0)) return { order: null, skip: 'stuck_on_cell' }
  // shaft-03: the stair's visit starts at the surface or on the stair (shaftgeom.mjs stairStartRefusal): a bot in a mine under
  // the town is asked again when it is up (its own surface or the stair's ascent; the order's cooldown is not charged)
  if (plot0 === SHAFT_PLOT && stairStartRefusal(record, feet, groundY)) return { order: null, skip: 'underground' }
  // sinkfix-02: a sink visit starts at the surface (LIVE 11-04: three road visits ordered at y 23-26 in a mine, aborted entombed)
  if (isSinkPlot(plot0) && Array.isArray(feet) && Number.isFinite(groundY) && feet[1] < groundY - SINK_SURFACE_DY) return { order: null, skip: 'underground' }
  if (state.lastStop === 'stuck_on_cell' && now - (state.lastAt ?? -Infinity) < SHOP_STUCK_RETRY_MS) return { order: null, skip: 'stuck_on_cell' }
  if (!slotsFree) return { order: null, skip: 'slots_full' }
  if (health <= SHOP_HEALTH_MIN) return { order: null, skip: 'health' }
  let plot = record?.plot ?? null
  if (!record) { try { plot = activePlotOf() } catch { plot = null } }
  // stockyard-01: the yard's visit EMPTIES a bag (its piles take the bag's surplus): a full bag is the reason for it, never a refusal
  if (plot !== YARD_PLOT && freeSlots < (LIGHT_PLOTS.has(plot) ? MONUMENT_BAG_SLOTS_MIN : SHOP_BAG_SLOTS_MIN)) return { order: null, skip: 'room' }
  return { order: { skill: 'build_shop', args: {} }, skip: null }
}

// ---- the pool's stood cells (D3 at runtime: step 1's carried item) ------------------------------------------------------------

export const STOOD_MAX_LINES = 20_000
export const STOOD_EVERY_MS = 30_000
export const STOOD_REPEAT_MS = 10 * 60_000
const stoodFile = (dir, key) => path.join(dir, `${key}.stood.jsonl`)
/** Append one in-town feet cell (the caller rate-limits). Rotates at STOOD_MAX_LINES (the old file kept as .old). Never throws. */
export function stoodAppend (dir, key, cell, { now = Date.now(), by = null } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const f = stoodFile(dir, key)
    let lines = 0
    try { lines = fs.readFileSync(f, 'utf8').split('\n').length } catch { /* none yet */ }
    if (lines >= STOOD_MAX_LINES) { try { fs.renameSync(f, `${f}.old`) } catch { /* another rotated it */ } }
    fs.appendFileSync(f, JSON.stringify({ c: cell, at: now, by }) + '\n')
  } catch { /* telemetry-grade: the walk falls back to home's cell */ }
}
/** The pool's distinct stood cells inside the town circle of `home` -> [[x, y, z]] (both files, torn lines skipped). Pure over
 *  the files. */
export function stoodRead (dir, key, home) {
  const seen = new Set(), out = []
  for (const f of [`${stoodFile(dir, key)}.old`, stoodFile(dir, key)]) {
    let text = ''
    try { text = fs.readFileSync(f, 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let r
      try { r = JSON.parse(line) } catch { continue }
      const c = r?.c
      if (!Array.isArray(c) || c.length !== 3 || !c.every(Number.isInteger)) continue
      if (Math.max(Math.abs(c[0] - home.x), Math.abs(c[2] - home.z)) > TOWN_R) continue
      const k = c.join(',')
      if (!seen.has(k)) { seen.add(k); out.push(c) }
    }
  }
  return out
}

// ---- rows (detail strings only: no new ES fields -- an unmapped field rejects whole documents, town plan 4.2) -------------------

const LONG = new Set(['why', 'segs'])   // `segs`: a whole workshop's segment list is ~72 chars (Codex/Claude r26 P3)
const fmt = (keys, f) => keys.filter(k => f[k] != null).map(k => `${k}=${String(Array.isArray(f[k]) ? f[k].join(',') : f[k]).replace(/\s+/g, '_').slice(0, LONG.has(k) ? 120 : 48)}`).join(' ')
export const buildModeDetail = (reserveSha = '-') => `phase=mode v=1 shop=${SHOP.on ? 'on' : 'off'} blueprints=${projectsOn().map(p => p.blueprint).join(',')} builders_max=${BUILDERS_MAX} reserve=${reserveSha}`
// EVERY FIELD A ROW CARRIES THAT THE READ READS (Paper 10-26 SHOP-TERRAIN seeded r24: the whitelist dropped the F2/F4 fields --
// `to`, `result`, `visits`, `n`, `segs`, `waiting`, `stalled`, `early`, `why` -- so the stuck row reached the logs as
// `op=stuck_on_cell cell=...` and the read's STALLED POOLS could never see a stall; the fake runner's e.log kept the objects)
export const buildRowDetail = f => fmt(['project', 'op', 'seg', 'cell', 'block', 'kind', 'saplings', 'gen', 'to', 'result', 'visits', 'n', 'segs', 'waiting', 'stalled', 'early', 'why'], f)
export const buildSegDetail = f => fmt(['project', 'seg', 'open', 'done', 'material_open', 'found_done', 'found_open', 'why'], f)
export const buildVisitDetail = f => fmt(['project', 'outcome', 'stop', 'placed', 'refused', 'silent', 'cleared', 'planted', 'unknown', 'slot', 'gen', 'took', 'back', 'crew', 'gathered', 'floor', 'fromMats', 'fromYard', 'ms', 'why'], f)   // gkhelpers-01: crew gathered floor; yarduse-01: fromYard
