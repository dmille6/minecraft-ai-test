// MINECREW-01SHOW (showcase, 11-16; OWNER: "limit underground work to a small crew with a real purpose"; "at most 3 people mining,
// probably just 2"; "more miners if we run out of some material, but we seem to have a surplus of everything mined"; "I'd much
// rather people clean, terraform, and make the landscape beautiful when there is nothing else to do").
//
// THE CASE (LIVE showcase, 14 bots, 3 h, 11-16): 11 of 14 bots below y 55 at one moment, nobody having sent them. The model chose
// `mine` 440 times (typical {"y":16}: prompt.mjs told every bot "mine with y=16 walks down the town stair"), `gather` of iron ore
// 191 times (7 ore), and the one real underground job, the deep miner, ended 73 of 93 orders `no_effect`. 357 runs were bots
// digging themselves out; both recent drownings and a lava death were underground. The bags held 22 iron pickaxes, 1,667
// cobblestone. And a bot under rock gets no build order at all (shop.mjs buildOrder: skip `underground`), so it stayed the model's.
//
// THE SHAPE (pure here; minecrewio.mjs reads the town's files; cognitive.mjs wires it; admission.mjs asks the bot's hook):
//   1. ONE COUNT. Every underground body holds one lease on `project-<home>.minecrew`: slot1..slotM for mining (M = MINECREW_MAX,
//      default 2, clamped 1..3 -- model mining AND the deep miner's trips, which take a crew slot before a new trip is ordered),
//      slot3 for a build's own material run (the coal run, the copper run) that goes below the line. Three names: never 4 bodies.
//   2. A NEED, PER MATERIAL (mineNeed over the town index and a census of the bots' own pickaxes): with a surplus nobody mines by
//      choice. A grant names its material; a holder gathers that ore only.
//   3. WHAT IS LIMITED (crewKind): `mine` to a target below the way-up line (HOME_Y - 8: round 2), the model's `gather` of an ore (it tunnels by
//      itself: skills.mjs WORTH_TUNNELLING), a new iron or diamond deep trip. NEVER stone or dirt (the scaffold a climb asks for,
//      the cobble a pickaxe needs), never an escape, never a build's own digging, never `mine` from a height down to the surface.
//   4. THE STEER (crewSteer), deterministic and AHEAD of the model: a bot with no slot that is under rock is sent up (the town
//      stair inside the town -- `crew_up`: stair or no move, never a dig -- `surface` outside it); one far from town is sent home;
//      one at the surface near town is ordered to the grounds (build_shop {grounds, why: 'idle'}: grounds2.mjs groundsOnly), every
//      CREW.idleMs, off the build order's own 10-minute clock. So an idle bot is rarely asked, and a refusal is followed 50 ms later
//      by the same steer with `force`. While a turn is on OFFER the steer leaves one decision per CREW.idleMs to the model (else
//      no bot it keeps busy could take the turn); a town with no stair has only the climb as its way up.
// THE CHAINS (bots/test/minecrew.test.mjs composes each): a climb that needs scaffold (the prerequisite becomes the task: the steer
// stands aside, stone is never refused), an entombed bot with no pickaxe, the gate's own memory (cooldown, repeat window), a bot
// under rock with no build order, the iron rung (closed at its means, never re-admitted through the milestone's wants), the
// deploy-hour herd (jitter), a turn that ends below ground (the same way up), the build order's clock (an idle visit never moves
// it), the patrol rung against the home order.
// REVIEW ROUND 1 (two engines; the chains below each have a test):
//   - NO HOT LOOP: a refusal is followed by the 50 ms tick only when the steer HAS an order; else the decision cooldown stands,
//     fewerdec's veto skip takes a `mine_crew` veto too, and the refusal is not the livelock breaker's (its remedy is a dig).
//   - TWO LINES, ONE WAY UP: the crew's line (HOME_Y - 15) limits `mine`; the WAY-UP line is the grounds' own (HOME_Y - 8) -- a bot
//     under rock in the band between them had neither work nor a way up. Under no roof below it, the order is `home`.
//   - PER MATERIAL, EVERYWHERE: a turn is FOR a material (crewView `allowed`); the gate, the iron rung and the ores a bot is shown
//     read that one list; a holder is told what its turn is for and never to leave; its slot closes when ITS material is stocked.
//   - A PREREQUISITE WHOSE ONLY MEANS IS A REFUSED ORE is never the task (prereqBlocked).
//   - A way up for every refused bot: the deploy jitter holds only UNFORCED orders; three stair tries that did not arrive owe one
//     climb per back-off. A material run admitted with no slot is watched and takes slot 3 (or stands down) below the line. An
//     open deep trip the crew can no longer count is sent home through its own return phase. An index unread for 30 min reads
//     as a town with no stock. A bot's rest and the need's hysteresis survive a restart (its census line).
// REVIEW ROUND 2:
//   - ONE LINE FOR `mine` AND THE WAY UP (the band is closed): `mine` is judged against the WAY-UP line (HOME_Y - 8). Judged
//     against the crew's deeper line, a descent to the band was free and the way up followed it: mine, crew_up, mine, ... with
//     no refusal and nothing counting it. The crew's line stays the measure of "deep" for a material run and the state row.
//   - THE WAY UP IS NOT HELD BY THE REPEAT WINDOW (the model's own earlier `surface` choices filled it and the owed climb read
//     `memory` for good): its bound is its own tries and back-off. The deploy jitter counts from the spawn.
//   - COAL WITH AN INDEX THAT NEVER READS: open while this bot's own smelt job ended `no_fuel` within CREW.noFuelFreshMs.
// SWITCH: MINECREW=off|0|false|no -> none of it: no hook, no steer, no prompt change, the rungs as before, no file read or written.

const OFF = /^(off|0|false|no)$/i
const ENV = typeof process !== 'undefined' ? process.env : {}
/** THE SWITCH -> bool. On unless MINECREW says off. Pure. */
export const mineCrewOn = (env = ENV) => !OFF.test(String(env?.MINECREW ?? '').trim())
/** Never more than this many bodies below the line, whatever the environment says (the three lease names). */
export const CREW_HARD_MAX = 3
/** THE MINING SLOTS -> { max, clamped, raw }. Pure. Unset: 2. An integer is clamped to 1..CREW_HARD_MAX; anything else is 2. */
export function crewMaxOf (env = ENV) {
  const raw = String(env?.MINECREW_MAX ?? '').trim()
  if (raw === '') return { max: 2, clamped: false, raw: null }
  const n = Number(raw)
  if (!Number.isInteger(n)) return { max: 2, clamped: true, raw }
  const max = Math.min(CREW_HARD_MAX, Math.max(1, n))
  return { max, clamped: max !== n, raw }
}
/** THE LINE -> y: a body under rock below it is underground. HOME_Y - 15 (any world), MINECREW_Y overrides. Pure. */
export function crewLineOf (homeY, env = ENV) {
  const v = String(env?.MINECREW_Y ?? '').trim()
  return v !== '' && Number.isFinite(Number(v)) ? Number(v) : Number(homeY) - 15
}
/** THE WAY-UP LINE -> y: under rock below it a bot is underground for the town's surface work -- the GROUNDS' own line
 *  (groundskeeper.mjs GK_FIT.surfaceDy 8: a test holds the two equal), which is also where the build order stops ordering
 *  (shop.mjs SINK_SURFACE_DY). Between it and the crew's line a bot would get neither work nor a way up: the steer's way up, and
 *  the refusal's "come up", read THIS line. Pure. */
export const CREW_UP_DY = 8
export const crewUpLineOf = homeY => Number(homeY) - CREW_UP_DY
const msOf = (v, d) => (Number(v) > 0 ? Number(v) : d)
/** ttlMs: a slot's lease (deepmine.mjs LEASE_TTL_MS); termMs / restMs: a model miner's turn and its rest (deepmine.mjs TRIP_MAX_MS,
 *  COOLDOWN_MS); idleMs: the idle grounds order's rhythm; idleBackoffMs: after 2, 3, 4+ idle visits in a row that fixed nothing
 *  (an abort counts); upTries / upBackoffMs: way-up runs that did not arrive before the steer stops asking; upJitterMs: the first
 *  way-up order of a bot waits its share of this (the deploy hour); homeR: beyond it the steer sends the bot home (the grounds'
 *  own reach, groundskeeper.mjs GK_FIT.awayR); townR: inside it the way up is the stair alone; upAfterMs: a holder above the line
 *  this long has come up. */
export const CREW = Object.freeze({ plot: 'minecrew', runSlot: 3, ttlMs: 8 * 60_000, termMs: 40 * 60_000, restMs: 20 * 60_000,
  idleMs: msOf(ENV?.MINECREW_IDLE_MS, 3 * 60_000), idleBackoffMs: Object.freeze([10 * 60_000, 20 * 60_000, 40 * 60_000]),
  upTries: 3, upBackoffMs: 10 * 60_000, upJitterMs: msOf(ENV?.MINECREW_UP_JITTER_MS, 20 * 60_000), homeR: 128, townR: 48, homeEveryMs: 10 * 60_000,
  readMs: 60_000, heartbeatMs: msOf(ENV?.MINECREW_HEARTBEAT_MS, 2 * 60_000), upAfterMs: msOf(ENV?.MINECREW_UP_AFTER_MS, 2 * 60_000), censusEveryMs: 10 * 60_000, censusFreshMs: 30 * 60_000,
  stateRowMs: 5 * 60_000, noneRowMs: 60_000,
  // indexUnreadMs: a town index unread this long is read as a town with no stock (iron may open); holderFails: limited runs in a
  // row that leave a holder above the way-up line before its slot is let go; runWatchMs: how often a material run admitted with
  // no slot is looked at (below the line it needs slot 3 at once); lowR: an unroofed bot below the grounds' line is sent home
  // only when further than this from it
  // noFuelFreshMs: how long this bot's own smelt job's `no_fuel` stop speaks for the town's coal while the index does not read;
  // strandedMs: under rock below the way-up line with no turn this long (two back-offs), the crew's refusals count for the
  // decision loop's livelock breaker again (the existing rescue of a bot nothing moves)
  noFuelFreshMs: 60 * 60_000, strandedMs: msOf(ENV?.MINECREW_STRANDED_MS, 20 * 60_000),
  // stockFreshMs (review r3): a container's observation older than this no longer counts as STOCK (townindex.mjs INDEX_STALE_MS, 6 h:
  // a test holds them equal) -- the index has no record for a chest that is gone, so its last contents would close mining for ever
  stockFreshMs: 6 * 60 * 60_000,
  indexUnreadMs: 30 * 60_000, holderFails: 3, runWatchMs: msOf(ENV?.MINECREW_RUN_WATCH_MS, 1000), lowR: 16 })
export const MINECREW = Object.freeze({ on: mineCrewOn(), ...crewMaxOf() })

// ---- the need ------------------------------------------------------------------------------------------------------------------
/**
 * THE MINED MATERIALS THE TOWN CAN RUN SHORT OF. floor: short below it; ceil: stocked at it (between: the last answer). names:
 * the index's item names and what each counts for. census: also needs a bot that lacks the tool (the bags are not in the index).
 * newTown: a town with no container yet may open for it (iron: the ladder; coal has nowhere to be banked -- coalrun.mjs).
 *   iron  24 = toolkit.mjs TOWN_IRON_RESERVE 16 + one kit's 7 ingots (below it no kit can be funded); 48 = 24 + deepmine.mjs IRON_GOAL
 *   coal  32 = coalrun.mjs COAL_FLOOR (the coal run's own line; a test holds them equal); 64 = a stack (512 items smelted).
 *         Charcoal is not counted: the town's smelt jobs burn coal only (smeltjob.mjs JOB_FUELS).
 */
export const MATERIALS = Object.freeze({
  iron: Object.freeze({ floor: 24, ceil: 48, names: Object.freeze({ iron_ingot: 1, raw_iron: 1, iron_block: 9, raw_iron_block: 9 }), census: true, newTown: true, ores: Object.freeze(['iron_ore', 'deepslate_iron_ore']) }),
  coal: Object.freeze({ floor: 32, ceil: 64, names: Object.freeze({ coal: 1, coal_block: 9 }), census: false, newTown: false, fuel: true, ores: Object.freeze(['coal_ore', 'deepslate_coal_ore']) }),
})
/**
 * THE TOWN'S STOCK OF THEM -> { ok, containers, have: { material: n }, obsidian }. Pure over townindex.mjs readIndex's entries.
 * Every container's LAST observation counts as a container, dirty or not (skills.mjs deepObsTown's rule: an estimate of a need,
 * never a withdrawal) -- but its MINED MATERIALS count only while that observation is younger than `freshMs` (review r3: the index
 * never forgets a chest that was destroyed or is never opened again; 64 ingots seen there once refused every miner for good while
 * the standing chests were empty). A stale container is still a container (`stale` counts them): the town is not "new", its
 * stock simply reads lower, mining opens for at most the crew, and the first bot that opens the chest (any deposit) restores it.
 * ok false: no index (off, unreadable). obsidian null with no container observed (never aged: it gates nothing closed).
 */
export function crewStock (entries, { now = Date.now(), freshMs = CREW.stockFreshMs } = {}) {
  const have = Object.fromEntries(Object.keys(MATERIALS).map(m => [m, 0]))
  if (!entries || typeof entries !== 'object') return { ok: false, containers: 0, have, obsidian: null, stale: 0 }
  let containers = 0, obsidian = 0, stale = 0
  for (const e of Object.values(entries)) {
    const names = e?.obs?.names
    if (!names || typeof names !== 'object') continue
    containers++
    obsidian += Math.max(0, Number(names.obsidian?.[0]) || 0)
    if (!(Number.isFinite(e.obs.at) && now - e.obs.at < freshMs)) { stale++; continue }
    for (const [m, def] of Object.entries(MATERIALS)) for (const [n, k] of Object.entries(def.names)) have[m] += k * Math.max(0, Number(names[n]?.[0]) || 0)
  }
  return { ok: true, containers, have, obsidian: containers > 0 ? obsidian : null, stale }
}
/**
 * IS THE TOWN SHORT OF A MINED MATERIAL? -> { open, short: [material], why: { material: reason }, stockOpen: { material: bool } }.
 * Pure. `stock`: crewStock's. `lacking`: bots of the town (this one included) with no trip-worthy iron pickaxe (the census), or
 * null when it could not be read. `was`: the last answer's `stockOpen` (the hysteresis lives on the STOCK's answer, so a census
 * that closes a material does not forget that its stock is low).
 * `unreadMs`: how long the index has not read. why: low | refilling | stocked | no_town_stock | no_container | index_unread |
 * index_unread_long | index_unread_no_fuel | no_one_lacks | census_unread
 * `noFuelMs`: how long ago this bot's own smelt job last ended `no_fuel` (smeltjob.mjs: it opened the town's containers and
 * found no coal; a smelt job's success since clears it) | null. With the index unread for T.indexUnreadMs it is the one reading
 * of the town's coal left: coal (`fuel`) opens while it is younger than T.noFuelFreshMs, and closes again by itself.
 */
export function mineNeed ({ stock = null, lacking = null, was = {}, unreadMs = 0, noFuelMs = null, T = CREW } = {}) {
  const why = {}, short = [], stockOpen = {}
  for (const [m, def] of Object.entries(MATERIALS)) {
    let open
    // an index that has not read for T.indexUnreadMs (TOWNINDEX=off, a file that never opens) says nothing for good: read as a
    // town with no stock, else mining would be closed for ever where the index is off
    if (!stock?.ok && Number(unreadMs) >= T.indexUnreadMs) {
      const dry = def.fuel === true && noFuelMs != null && Number.isFinite(Number(noFuelMs)) && Number(noFuelMs) >= 0 && Number(noFuelMs) < T.noFuelFreshMs
      open = !!def.newTown || dry; why[m] = def.newTown ? 'index_unread_long' : dry ? 'index_unread_no_fuel' : 'index_unread'
    }
    else if (!stock?.ok) { open = was?.[m] === true; why[m] = 'index_unread' }
    else if (!(stock.containers > 0)) { open = !!def.newTown; why[m] = def.newTown ? 'no_town_stock' : 'no_container' }
    else {
      const have = Number(stock.have?.[m]) || 0
      if (have >= def.ceil) { open = false; why[m] = 'stocked' }
      else if (have < def.floor) { open = true; why[m] = 'low' }
      else { open = was?.[m] === true; why[m] = open ? 'refilling' : 'stocked' }
    }
    stockOpen[m] = open
    if (open && def.census && !(Number(lacking) >= 1)) { open = false; why[m] = lacking == null ? 'census_unread' : 'no_one_lacks' }
    if (open) short.push(m)
  }
  return { open: short.length > 0, short, why, stockOpen }
}
/** THE CENSUS -> how many bots lack a trip-worthy iron pickaxe: the files written within `fresh` (never one stamped in the
 *  future), this bot's own answer counted from its bag, not its file. Pure. files: [{ holder, at, ironPick: 0 | 1 }]. */
export function censusLacking (files = [], { me = null, ownLacks = false, now = Date.now(), fresh = CREW.censusFreshMs } = {}) {
  let n = ownLacks ? 1 : 0
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || f.holder === me || !Number.isFinite(f.at) || f.at > now + 60_000 || now - f.at >= fresh) continue
    if (f.ironPick === 0) n++
  }
  return n
}

// ---- what is limited ----------------------------------------------------------------------------------------------------------
const oresOf = ms => ms.flatMap(m => MATERIALS[m]?.ores?.slice(0, 1) ?? []).join(' or ')
/** A block gather digs down for by itself (skills.mjs WORTH_TUNNELLING; a test holds the two equal). Pure. */
export const isOreBlock = name => /(_ore|^ancient_debris$)/.test(String(name ?? ''))
/** The material an ore block is mined for -> 'iron' | 'coal' | 'copper' | ... | null (not an ore). Pure. */
export function oreMaterial (name) {
  const s = String(name ?? '')
  if (s === 'ancient_debris') return 'netherite'
  const m = /^(?:deepslate_|nether_)?([a-z_]+?)_ore$/.exec(s)
  return m ? m[1] : null
}
/**
 * IS THIS PROPOSAL UNDERGROUND WORK THE CREW LIMITS? -> null (no) | { kind: 'mine' | 'ore' | 'run', material, target?, block? }. Pure.
 *   mine    its target, clamped as the skill clamps it (skills.mjs mine: `Number(y) || 12`, never above feet - 1, never below -59),
 *           lies BELOW the WAY-UP line (`upLineY`: the line the steer sends a bot with no turn up from -- review r2: judged
 *           against the crew's deeper line, a descent into the band between them was free and the way up followed it, for
 *           ever). A descent that ends at or above it is free: a bot stranded high must be able to mine down. `target`/`line`
 *           are what the refusal names.
 *   gather  of an ore: `ore` from the model or a continuation, `run` from a deterministic order (the coal run, the copper run).
 * Nothing else: never stone, dirt, logs; never explore, surface, home.
 */
export function crewKind (skill, args, { y = null, lineY = null, upLineY = null, fromOrder = false } = {}) {
  if (skill === 'mine') {
    if (!Number.isFinite(lineY)) return null
    const line = Number.isFinite(upLineY) ? Math.max(lineY, upLineY) : lineY
    let target = Number(args?.y) || 12
    if (Number.isFinite(y)) target = Math.min(target, Math.floor(y) - 1)
    target = Math.max(-59, target)
    return target < line ? { kind: 'mine', material: null, target, line } : null
  }
  if (skill === 'gather') {
    const block = String(args?.block ?? '')
    if (!isOreBlock(block)) return null
    return { kind: fromOrder ? 'run' : 'ore', material: oreMaterial(block), block }
  }
  return null
}
/**
 * THE GATE -> { ok: true, take: null | 'mining' | 'renew' | 'run', for } | { ok: false, why }. Pure; the slot itself is taken by
 * the caller (minecrewio.mjs: one taker per lease generation) only for a proposal the whole admission gate admitted.
 *   kind      crewKind's answer (null: not limited)        need   mineNeed's
 *   hold      this bot's own live MINING slot { since, for } | null (a deep trip's slot is not passed: its orders are deep_mine)
 *   restUntil this bot rests from the crew until then       oreBelow  a run's nearest ore lies below the line (null: unknown)
 * why: no_need | not_short (an ore the town is not short of) | not_yours (a holder's turn is for another material) | turn_over |
 * resting
 */
export function crewGate ({ on = MINECREW.on, kind = null, need = null, hold = null, now = Date.now(), restUntil = 0, oreBelow = null, T = CREW } = {}) {
  const yes = (take = null, f = null) => ({ ok: true, take, for: f })
  const no = why => ({ ok: false, why })
  if (!on || !kind) return yes()
  // a build's own material run: a slot only when it goes below the line (unknown: the order's own guards decide, as before)
  if (kind.kind === 'run') return oreBelow === true ? yes('run', 'run') : yes()
  const short = Array.isArray(need?.short) ? need.short : []
  const since = hold && Number.isFinite(Number(hold.since)) ? Number(hold.since) : now
  if (hold && now - since >= T.termMs) return no('turn_over')
  if (!need?.open) return no('no_need')
  if (kind.kind === 'ore' && !short.includes(kind.material)) return no('not_short')
  // a holder mines FOR the material its turn was granted for (crewAllowed: the rung, the ores it is shown and this gate agree)
  if (hold && kind.kind === 'ore' && MATERIALS[hold.for] && kind.material !== hold.for) return no('not_yours')
  if (hold) return yes('renew', hold.for ?? short[0])
  if (now < (Number(restUntil) || 0)) return no('resting')
  return yes('mining', kind.kind === 'ore' ? kind.material : short[0])
}
/**
 * THE REFUSAL'S TEXT: why, and A REMEDY THE BOT CAN PERFORM FROM WHERE IT IS (below the line: the way up; at the surface: the
 * town's work). Pure. Under 300 characters.
 */
export function crewRefusal ({ why = null, kind = null, need = null, held = null, max = MINECREW.max, below = false, hold = null, restUntil = 0, now = Date.now() } = {}) {
  const short = Array.isArray(need?.short) ? need.short : []
  // A HOLDER IS NEVER TOLD TO LEAVE: its turn stands -- it is told what its turn is for (the ore it may gather, or to mine on)
  if (hold && (why === 'not_short' || why === 'not_yours' || why === 'no_need')) {
    const mine = MATERIALS[hold.for] ? oresOf([hold.for]) : oresOf(short)
    const what = why === 'not_yours' ? `your turn is not for ${kind?.material ?? 'that'}` : `the town is not short of ${kind?.material ?? 'that'}`
    return `mining is a town crew job: ${what}. Your turn is for ${hold.for ?? (short.join(', ') || 'the crew')}: ${mine ? `gather ${mine}, or ` : ''}mine deeper for it.`.slice(0, 300)
  }
  const reason = why === 'no_need' ? 'the town is not short of anything mined'
    : why === 'not_short' ? `the town is not short of ${kind?.material ?? 'that ore'}${short.length ? ` (it is short of ${short.join(', ')})` : ''}`
    : why === 'crew_full' ? `the mine crew is full (${held ?? max} of ${max})`
    : why === 'resting' ? `your mine-crew turn is over; you rest ${Math.max(1, Math.ceil(((Number(restUntil) || 0) - now) / 60_000))} more min`
    : why === 'turn_over' ? 'your mine-crew turn is over'
    : why === 'run_busy' ? 'another bot holds the material-run slot below ground; this run waits its normal retry'
    : 'mining is the town crew\'s job'
  // a refused `mine` is told the line it was judged against (the MINING line names the same one)
  const where = !hold && kind?.kind === 'mine' && Number.isFinite(kind.line) ? ` (mine below y=${Math.floor(kind.line)} is the crew's)` : ''
  // `below`: under rock below the WAY-UP line (crewUpLineOf: the same test the steer's way up uses) -- there the remedy is the
  // way up; anywhere else the bot can walk to the town's work
  const remedy = below
    ? 'Come up: run surface (it takes the town stair when it can), then home.'
    : 'Work at the surface instead: home, deposit, or wait -- the town orders clean-up and building when you are near home.'
  return `mining is a town crew job: ${reason}${where}. ${remedy}`.slice(0, 300)
}
/**
 * MAY A NEW DEEP TRIP START? -> { ok, for, why }. Pure. `target`: deepmine.mjs deepMineOrder's ('build' | 'diamond' | 'iron').
 *   build     allowed with the need closed (the town mine's own construction) -- but a second bot ordered `build` while another
 *             holds the build lease makes an ORE trip inside the skill (skills.mjs deepMine), so `buildBusy` reads it as
 *             `oreTarget` (deepmine.mjs tripTarget of the bag with no mine)
 *   iron      only while the town is short of iron or coal (the trip works both)
 *   diamond   closed, unless a need names diamonds (none does) or the trip would take the obsidian sub-goal (`obsWant` > 0:
 *             deepmine.mjs obsidianWant -- obsidian is a diamond trip's sub-goal, never a trip of its own)
 */
export function deepTripGate ({ on = MINECREW.on, target = null, need = null, obsWant = 0, buildBusy = false, oreTarget = null } = {}) {
  if (!on) return { ok: true, for: null, why: 'off' }
  const short = Array.isArray(need?.short) ? need.short : []
  let t = target
  if (t === 'build' && buildBusy) t = oreTarget
  if (t === 'build') return { ok: true, for: 'build', why: 'build' }
  if (t === 'iron') { const m = ['iron', 'coal'].find(x => short.includes(x)); return m ? { ok: true, for: m, why: 'need' } : { ok: false, for: null, why: 'no_need' } }
  if (t === 'diamond') {
    if (short.includes('diamond')) return { ok: true, for: 'diamond', why: 'need' }
    return Number(obsWant) > 0 ? { ok: true, for: 'obsidian', why: 'obsidian' } : { ok: false, for: null, why: 'no_need' }
  }
  return { ok: false, for: null, why: 'no_target' }
}

// ---- the steer -----------------------------------------------------------------------------------------------------------------
/** A bot's share of the first way-up order's wait -> [0, CREW.upJitterMs) (FNV-1a over its name: the same at every asking). Pure. */
export function upJitterMs (me, T = CREW) {
  let h = 0x811c9dc5
  for (const ch of `minecrew_up|${me ?? ''}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return Math.floor((h / 0x100000000) * T.upJitterMs)
}
/**
 * WHAT AN IDLE BOT WITH NO CREW SLOT DOES NOW -> { order: { skill, args, why } | null, kind: 'up' | 'home' | 'grounds' | 'none',
 * why, state }. Pure. Asked at the END of the order chain (every town job and build order keeps its turn), AHEAD of the model.
 *   holds / tripOpen   it holds a mining slot / a deep trip is open: its work is underground
 *   prereqOpen         a prerequisite is the task (scaffold for a climb, a pickaxe to dig out): the model gathers it first
 *   jobOpen            an order of its own is pending this tick
 *   y, lineY, roofed   feet, the line, solid rock overhead (true / false / null: unread)     distHome  horizontal, to home
 *   stair              the town has a stair with an exit to walk up (skills.mjs stairAscend's own preconditions)
 *   state              { upTries, upBackoffUntil, upNotBefore, homeAt, idleAt, idleN, idleBackoffUntil, offerAskAt }
 *   force              a mining proposal was just refused: the rhythms are not waited out (the links, the tries and the back-offs are)
 *   refuses(skill)     the admission gate's memory would refuse the order (cooldown, learned failures, a full repeat window)
 *   grounds()          lazy -> { ok, why }: may this bot work the grounds now (skills.mjs groundsIdleAsk: grounds2.mjs groundsWork)
 *   jitterMs           this bot's share of the first way-up order's wait, counted from `jitterFrom` (the spawn; unset: now)
 *   offer              a mine-crew turn is free and the town is short (crewView): one decision per T.idleMs is left to the model
 * S1 under rock below the WAY-UP line (`upLineY`: the grounds' own) -> the way up: `crew_up` (the town stair or no move, never a
 *    dig) within T.townR of home, `surface` outside it; after T.upTries `crew_up` that did not arrive, one `surface` per back-off.
 *    S2 at the surface beyond T.homeR -> `home`. S3 at the surface within it -> the grounds. Else nothing: the model,
 *    with mining hidden and refused.
 * why (none): off | crew | trip | prereq | job | offer | unknown | up_backoff | jitter | memory | rhythm | backoff | groundsWork's
 */
export function crewSteer ({ on = MINECREW.on, holds = false, tripOpen = false, prereqOpen = false, jobOpen = false, offer = false, y = null, lineY = null, upLineY = lineY, roofed = null,
  distHome = null, stair = true, now = Date.now(), state = {}, force = false, refuses = () => null, grounds = () => ({ ok: false, why: 'unknown' }), jitterMs = 0, jitterFrom = null, T = CREW } = {}) {
  const s = { ...(state ?? {}) }
  const none = why => ({ order: null, kind: 'none', why, state: s })
  if (!on) return none('off')
  if (holds) return none('crew')
  if (tripOpen) return none('trip')
  if (prereqOpen) return none('prereq')
  if (jobOpen) return none('job')
  // A TURN IS ON OFFER (the town is short of something and a slot is free): the steer runs AHEAD of the model, so a bot it keeps
  // busy would never be asked and the offer would never be taken -- two correct rules, an empty crew. Once every T.idleMs the
  // steer stands aside for ONE decision: the model reads the MINING line and may take the turn; else the ladder as before.
  if (offer && !force && now - (Number.isFinite(s.offerAskAt) ? s.offerAskAt : -Infinity) >= T.idleMs) { s.offerAskAt = now; return none('offer') }
  if (![y, upLineY, distHome].every(Number.isFinite)) return none('unknown')
  const asked = sk => { try { return !!refuses(sk, {}) } catch { return true } }
  // THE WAY UP IS NOT HELD BY THE REPEAT WINDOW (review r2): the window fills with the MODEL's own earlier `surface` choices and
  // has no expiry, so the owed climb read `memory` for good. The way up has its own bound (T.upTries, one climb, the back-off);
  // a cooldown still holds it (that one expires).
  const askedUp = sk => { try { const m = refuses(sk, {}); return !!m && m !== 'repeat_loop' } catch { return true } }
  const how = force ? 'forced' : 'idle'
  const upWhy = skill => `mine crew: no turn underground -- ${skill === 'crew_up' ? 'walking up the town stair' : 'climbing out'} (y=${Math.floor(y)}, the town's work begins at y=${Math.floor(upLineY)})`
  // UNDER ROCK BELOW THE WAY-UP LINE (the grounds' own line, not the crew's deeper one: in the band between them the grounds
  // answer `underground` and the build order skips the bot too -- it would have neither work nor a way up)
  if (y < upLineY && roofed === true) {
    // THE STAIR TRIES ARE SPENT (three `crew_up` that did not arrive: the bot is not connected to the stair): ONE climb is owed
    // per back-off -- a bot the stair does not reach must still come up, and a refusal's remedy must be an order
    if (s.upClimbOwed === true) {
      if (askedUp('surface')) return none('memory')
      s.upClimbOwed = false
      return { order: { skill: 'surface', args: {}, why: upWhy('surface') }, kind: 'up', why: 'climb', climb: true, state: s }
    }
    if (now < (Number(s.upBackoffUntil) || 0)) return none('up_backoff')
    // the deploy hour's spread is for UNFORCED first orders: a bot just refused mining gets its way up now
    // ...and the spread counts from the SPAWN (`jitterFrom`), not from the first time this bot is under rock -- hours after a deploy
    // there is no herd to spread, only a bot kept waiting below
    if (!Number.isFinite(s.upNotBefore)) s.upNotBefore = (Number.isFinite(jitterFrom) ? jitterFrom : now) + Math.max(0, Number(jitterMs) || 0)
    if (!force && now < s.upNotBefore) return none('jitter')
    // inside the town the way up is the STAIR first (never at once a climb that digs up through the town's ground) -- where the
    // town has a stair to walk; a town with none has only the climb (a refusal with no remedy would leave the bot under it)
    const skill = distHome <= T.townR && stair ? 'crew_up' : 'surface'
    if (askedUp(skill)) return none('memory')
    return { order: { skill, args: {}, why: upWhy(skill) }, kind: 'up', why: how, state: s }
  }
  if (distHome > T.homeR) {
    if (!force && now - (Number.isFinite(s.homeAt) ? s.homeAt : -Infinity) < T.homeEveryMs) return none('rhythm')
    // review r3: the HOME order is a way to the town's work too -- the model's own earlier `home` choices fill the window (it has no
    // expiry, and a refused `mine` moves nothing in it): held by it, a bot far from town that keeps choosing `mine` was refused for
    // good with no order ever following. Its bound is its own rhythm and the cooldown of a walk that failed.
    if (askedUp('home')) return none('memory')
    s.homeAt = now
    return { order: { skill: 'home', args: {}, why: `mine crew: nothing to do ${Math.round(distHome)} blocks from town -- coming home to the town's work` }, kind: 'home', why: how, state: s }
  }
  if (now < (Number(s.idleBackoffUntil) || 0)) return none('backoff')
  if (!force && now - (Number.isFinite(s.idleAt) ? s.idleAt : -Infinity) < T.idleMs) return none('rhythm')
  if (asked('build_shop')) return none('memory')
  let g = null
  try { g = grounds() } catch { g = null }
  // THE GROUNDS ANSWER `underground` FOR A BOT UNDER NO ROOF (low open ground, a pit, a river bed below their line): it is not
  // sent "up" -- there is nothing over it -- but it is not left there either: home is on the town's ground, a walk away
  if (g?.ok !== true && g?.why === 'underground' && distHome > T.lowR && (force || now - (Number.isFinite(s.homeAt) ? s.homeAt : -Infinity) >= T.homeEveryMs) && !askedUp('home')) {
    s.homeAt = now
    return { order: { skill: 'home', args: {}, why: `mine crew: below the town's ground (y=${Math.floor(y)}) with nothing to do -- walking home to the town's work` }, kind: 'home', why: 'low', state: s }
  }
  if (!g?.ok) return none(String(g?.why ?? 'unknown'))
  s.idleAt = now
  return { order: { skill: 'build_shop', args: { grounds: true, why: 'idle' }, why: 'mine crew: idle at the surface -- the town\'s grounds (clean-up, levelling, planting)' }, kind: 'grounds', why: how, state: s }
}
/**
 * AFTER A STEER ORDER -> the new state. Pure.
 *   notRun    the gate refused it or the runner declined it: never a try, and its rhythm is given back
 *   arrived   (up) the bot is no longer under rock below the line        worked  (grounds) the visit placed or cleared something
 * Way up: T.upTries runs that did not arrive -> T.upBackoffMs; when they were the stair's (`skill` crew_up) ONE climb is owed
 * for that back-off (`climb`: it is no try). The model and the watchdog have the body meanwhile. Grounds: 2, 3,
 * 4+ visits in a row that fixed nothing -- AN ABORTED ONE COUNTS HERE (grounds2.mjs groundsAfter does not count it, so without this
 * a visit that keeps aborting would be ordered again every T.idleMs) -> T.idleBackoffMs.
 */
export function steerAfter (state = {}, { kind = null, skill = null, climb = false, notRun = false, arrived = false, worked = false, now = Date.now(), T = CREW } = {}) {
  const s = { ...(state ?? {}) }
  if (notRun) { if (kind === 'grounds') s.idleAt = -Infinity; if (kind === 'home') s.homeAt = -Infinity; if (kind === 'up' && climb) s.upClimbOwed = true; return s }
  if (kind === 'up') {
    if (arrived) { s.upTries = 0; s.upBackoffUntil = 0; s.upClimbOwed = false; return s }
    if (climb) return s   // the one climb a back-off owes: it ran, the back-off stands
    s.upTries = (Number(s.upTries) || 0) + 1
    // the stair's tries spent -> the back-off, and (for the stair-only order) the one climb it owes
    if (s.upTries >= T.upTries) { s.upTries = 0; s.upBackoffUntil = now + T.upBackoffMs; if (skill === 'crew_up') s.upClimbOwed = true }
    return s
  }
  if (kind === 'grounds') {
    if (worked) { s.idleN = 0; s.idleBackoffUntil = 0; return s }
    s.idleN = (Number(s.idleN) || 0) + 1
    if (s.idleN >= 2) s.idleBackoffUntil = now + T.idleBackoffMs[Math.min(s.idleN - 2, T.idleBackoffMs.length - 1)]
    return s
  }
  return s
}
/** Is this build_shop order the steer's idle grounds visit (it must not move the build order's own clock)? Pure. */
export const crewIdleVisit = (args, on = MINECREW.on) => !!on && args?.grounds === true && args?.why === 'idle'

// ---- what the bot is shown, and its rungs -----------------------------------------------------------------------------------
/** The rule that replaces prompt.mjs's two "mine down for iron" rules while the crew is on: the same bytes for every bot. */
export const CREW_RULE_LINES = Object.freeze([
  // (the smelt route to iron stays named -- smelt-wiring.test.mjs: `craft iron_pickaxe` is not something the model can reason its
  // way to -- but only for raw iron the bot CARRIES: review r1 B3, a bot holding none smelted and was told to fetch some)
  '- Iron tools: if you CARRY raw_iron, smelt item=raw_iron gives iron_ingot; 3 iron_ingot + 2 sticks ->',
  '  iron_pickaxe. Never smelt a raw item you do not carry.',
  '- Mining underground is a town crew\'s job. Choose mine to go below the surface, or gather an ore,',
  '  ONLY when the MINING line says a turn is yours or free; otherwise work at the surface.',
])
/**
 * THE BOT'S VIEW -> { on, holds, for, offer, closed, short, allowed, lineY, held, max, minsLeft }. Pure.
 *   holds   it holds a mining slot (its turn)          offer  the town is short of something, a slot is free, it is not resting
 *   closed  neither: mining is hidden from it (the MINING line, the ores in NEARBY, the mining rungs)
 *   lineY   the line `mine` is judged against for this bot (the way-up line: crewKind) -- the MINING line and the refusal name it
 *   allowed the materials whose ORE this bot may gather now, exactly as crewGate judges it: a holder's own (its turn's material
 *           while the town is short of it; any short one when its turn names none), an offer's short ones, none when closed.
 *           The iron rung, the ores it is shown and the gate read this ONE list (a rung the gate refuses must not be the task).
 */
export function crewView ({ on = MINECREW.on, hold = null, need = null, held = null, max = MINECREW.max, readOk = false, restUntil = 0, lineY = null, now = Date.now(), T = CREW } = {}) {
  if (!on) return { on: false, holds: false, offer: false, closed: false }
  const holds = !!hold
  const short = Array.isArray(need?.short) ? need.short : []
  const offer = !holds && !!need?.open && readOk && Number.isFinite(held) && held < max && now >= (Number(restUntil) || 0)
  const allowed = holds ? (MATERIALS[hold.for] ? short.filter(m => m === hold.for) : short) : offer ? short : []
  return { on: true, holds, for: hold?.for ?? null, offer, closed: !holds && !offer, short, allowed, lineY, held, max,
    minsLeft: holds ? Math.max(0, Math.ceil((T.termMs - (now - (Number(hold.since) || now))) / 60_000)) : null }
}
/** The MINING line of the user prompt ('' while the crew is off). Pure. */
export function miningLine (v) {
  if (!v?.on) return ''
  if (v.holds) {
    const ores = oresOf(v.allowed ?? [])
    return `MINING: you hold a mine-crew turn${v.for ? ` for ${v.for}` : ''} (${v.minsLeft ?? '?'} min left): mine with y=16 walks down the town stair${ores ? `; gather ${ores}` : ''}.`
  }
  if (v.offer) return `MINING: the town is short of ${v.short.join(' and ')} and a mine-crew turn is free (${v.held} of ${v.max} taken): mine with y=16, or gather ${oresOf(v.short)}, takes it.`
  return `MINING: closed for you (${v.short?.length ? `the crew is full or you are resting; short of ${v.short.join(', ')}` : 'the town has a surplus of everything mined'}). Do not choose mine to go underground${Number.isFinite(v.lineY) ? ` (below y=${Math.floor(v.lineY)})` : ''}, or gather an ore; stay near home -- the town orders clean-up and building there.`
}
/** Are the mining rungs (the iron-ore rung, the stone stockpile) and the patrol rung stepped over for this bot? Pure over the
 *  view cognitive.mjs leaves on the bot (absent: the crew is off -- the rungs as before). */
export const crewRungClosed = bot => { const v = bot?.mineCrewView; return !!v && v.on === true && v.closed === true }
/** May this bot gather the ORE of `material` now (crewView's `allowed`)? Absent view: the crew is off -- yes, as before. Pure. */
export const crewOreOpen = (bot, material) => { const v = bot?.mineCrewView; return !v || v.on !== true || (Array.isArray(v.allowed) && v.allowed.includes(material)) }
/** Is this ore block hidden from the bot's prompt (an ore it may not gather is not named to it)? Pure over the view. */
export const crewOreHidden = (v, name) => !!v && v.on === true && isOreBlock(name) && !(Array.isArray(v.allowed) && v.allowed.includes(oreMaterial(name)))

// ---- prerequisites ---------------------------------------------------------------------------------------------------------
const DROP_MATERIAL = Object.freeze({ raw_iron: 'iron', raw_copper: 'copper', raw_gold: 'gold', coal: 'coal', diamond: 'diamond', redstone: 'redstone', lapis_lazuli: 'lapis', emerald: 'emerald', quartz: 'quartz', netherite_scrap: 'netherite' })
/** The mined material an item comes from -> material | null: an ore block, or what one drops. Pure. */
export const minedMaterial = name => oreMaterial(name) ?? DROP_MATERIAL[String(name ?? '')] ?? null
/**
 * IS THIS PREREQUISITE ONE THE CREW FORBIDS THE BOT TO FULFIL? -> bool. Pure. Every item it accepts is an ore or an ore's drop
 * (smelt with nothing to smelt answers `need: [raw_iron]`) and the bot may gather none of those ores now (crewView `allowed`).
 * Such a prerequisite must not become the task: the gate refuses its only means, and while it stood the steer stood aside --
 * fifteen minutes of refusals. A prerequisite with any other item (dirt or cobble for a climb, a pickaxe) is the bot's to meet.
 */
export function prereqBlocked (need, v) {
  if (!v || v.on !== true) return false
  const items = Array.isArray(need?.items) ? need.items : []
  if (!items.length) return false
  return items.every(it => { const m = minedMaterial(it); return m != null && !(Array.isArray(v.allowed) && v.allowed.includes(m)) })
}

// ---- rows ------------------------------------------------------------------------------------------------------------------------
/** `_minecrew` detail: `op=<op> k=v ...` (unset fields left out). Pure. Under 300 characters. */
export function crewRow (op, f = {}) {
  const out = [`op=${op}`]
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== '') out.push(`${k}=${String(v).replace(/\s+/g, '_')}`)
  return out.join(' ').slice(0, 300)
}
/** `_minecrew_mode`: the licence row, once per spawn (on=0 under MINECREW=off: a rollback is visible too). Pure. */
export const crewModeDetail = (M = MINECREW, lineY = null) =>
  `on=${M.on ? 1 : 0} max=${M.max} hard_max=${CREW_HARD_MAX} clamped=${M.clamped ? 1 : 0} raw=${M.raw ?? '-'} line_y=${lineY ?? '-'} term_min=${CREW.termMs / 60_000} rest_min=${CREW.restMs / 60_000} ttl_min=${CREW.ttlMs / 60_000} idle_s=${CREW.idleMs / 1000} ` +
  Object.entries(MATERIALS).map(([m, d]) => `${m}=${d.floor}/${d.ceil}`).join(' ')
/** A tally of steer answers for the state row -> 'why:n,why:n' ('-' when empty). Pure. */
export const tallyLine = t => Object.entries(t ?? {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(',') || '-'
