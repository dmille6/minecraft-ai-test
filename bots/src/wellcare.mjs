// THE WELL CLEAN-UP BUNDLE (wellcare-01; OWNER 10-17 ~12:50Z "yes, lets do your suggest"). Pure decisions only: the caller
// (skills.mjs, cognitive.mjs, well.mjs wellOrder) reads the world and supplies the answers. Three fixes ship as one canary:
//
//   1. minewell-02 -- `mine` never digs a known well's or plinth's shell (minewell.mjs; its per-dig stop now asks
//      skills.mjs wellCellAt, the one well/plinth cell test lidclear and wear_out use).
//   2. NO WELL ORDER FOR A BOT DEEP UNDER THE STAND (this file: wellOutOfReach). The well order measured distance from
//      home horizontally only, so a bot mining 20 below the town got dispose_well / build_well and walked into a timeout.
//   3. NO STATION ON A WELL (this file: stationKeepOut). place() had no well/plinth exclusion, so a town craft could put
//      its crafting table (or a furnace, a chest, a bed) on the well's stand, over its shaft, or on a plinth's stair.

// ---- 2. the well order's vertical reach ---------------------------------------------------------------------------------
//
// MEASURED 10-17 (fleet, 72 h to 12:55Z, 4.29 M rows walked, 80 bots, 16 pools; the order's START = the same bot's last row
// before the order's @timestamp, its bot.pos; the stand from the row's named cell or the pool's well rows). Positive control:
// the same query finds 236 dispose_well successes and 280 dispose_well well_unreachable failures (all 16 pools walked).
//   dispose_well, start_y - stand_y:   success share
//     -1..+2   84% (n 38)    -4..-1   80% (25)    -7..-4   65% (17)    -9..-7  60% (10)
//     -11..-9  50% (20)      -13..-11 60% (20)   -16..-13  32% (31)    -20..-16 16% (44)   -25..-20 11% (38)   <= -25  2% (149)
//   build_well: 0 successes of 25 orders that started more than 12 below the stand (all well_unreachable).
// The walk (HK_PATH_MS, <= 25 s) stops reaching the stand more often than not past 12 below it. An order beyond that costs
// the walk and then the 15-min dispose backoff (well.mjs wellOrderOutcome), which also hides the town well from the room
// remedy (cognitive.mjs #roomRemedy) -- so the bot loses its next real chance as well.
export const WELL_REACH_BELOW = 12

/**
 * IS THE STAND BEYOND THE WALK'S VERTICAL REACH? -> { below, standY, feetY, limit } | null. Pure.
 * `below` = standY - feetY. Null (in reach) when either height is unknown: no reading is never a refusal.
 */
export function wellOutOfReach ({ feetY = null, standY = null, limit = WELL_REACH_BELOW } = {}) {
  if (!Number.isFinite(feetY) || !Number.isFinite(standY)) return null
  const below = standY - feetY
  if (!(below > limit)) return null
  return { below: Math.round(below * 10) / 10, standY, feetY: Math.round(feetY * 10) / 10, limit }
}

/**
 * THE REMEDY A HELD ORDER NAMES: `surface` -- the bot's own climb (digs, pillars) to sea level (63) from anywhere below it.
 * MEASURED (the same 72 h): all 417 orders that started more than 12 below their stand started BELOW 63, under stands at y
 * 58-75, so sea level is within 12 of every one of those stands. Above sea level (0 of 417) `surface` refuses and `goto` /
 * `home` are horizontal (Paper 10-17), so the row says `walk_up`.
 *
 * WHY A HOLD AND NOT A SCHEDULER CLIMB (r5; Claude r1 P2 asked for the remedy to be performed; r3/r4 did, and both engines
 * then found the climb's own defects: it overshoots stands below 63, cannot reach stands above 75, and surface's shaft dig
 * never reads the well's cells, so it can open a well from below). The hold costs the bot nothing it had: dispose_well is
 * scheduler-only (chatOnly), the bot keeps its turn, and nothing is charged while held. The base's order from deep (72 h:
 * 327 orders, 25 succeeded) walked the bot up a median 2 blocks (p75 11) and then backed the dispose off 15 min; held, the
 * order is given on the first scan in reach -- base bots were next within 12 of the stand after a median 12.4 min (p75 39,
 * 119 of 326 within 5 min, 276 within 60 min).
 */
export const SEA_LEVEL_Y = 63
export const wellDeepRemedy = feetY => (Number.isFinite(feetY) && feetY < SEA_LEVEL_Y ? 'surface' : 'walk_up')

/** The `_well_deep` row (key=value; the read parses fields). */
export const wellDeepDetail = ({ skill, below, standY, feetY, limit }) =>
  `order=${String(skill ?? '-').replace(/_well$/, '')} below=${below} stand_y=${standY} feet_y=${feetY} limit=${limit} remedy=${wellDeepRemedy(feetY)} action=hold`

/** The licence row, written once per spawn by index.mjs (`_wellcare_mode`, a kind no other build writes). */
export const wellcareModeDetail = () => `phase=mode v=1 reach_below=${WELL_REACH_BELOW} station_keepout=1 mine_shell=wellCellAt`

// ---- 3. a station never on the well -------------------------------------------------------------------------------------
//
// THE CELLS A BLOCK MUST NOT GO INTO, for every known well column `c` (skills.mjs knownWellCells: the town's wells, the
// recorded site, every plinth column with its stair):
//   well    the shell -- wellBreakCost's box (+-2, c.y-3 .. c.y) and a plinth's stair treads. The caller supplies this as
//           `shell`: skills.mjs wellCellAt (true / false / null = the cells could not be read: refused, fail closed);
//   shaft   the column itself from the floor up, c.y-2 .. c.y+3 (the throw goes down it; a block there caps the well);
//   stand   the four cells beside the cap at the thrower's feet and head (c.y+1, c.y+2): every stand a well may use
//           (well.mjs standCandidates: the facing side and the two along the flap; the column's facing is not carried, so
//           all four cardinals are kept);
//   stair   the feet and head cells over each plinth stair tread (the only way up a raised well).
// THE BUILDER'S OWN TABLE (`own`: build_well's cell from plinth.mjs wellTableCell, walk-proven, for THIS column) may sit in
// that column's box at ring >= 2 -- the plinth's outer ring top, as plinth-02 places it on board-c (365,73,135) -- and the
// caller then passes `shell` for every OTHER column (well.mjs wellBreakCost's own `skip`). The shaft, a stand and the stair
// are refused for it too.
export const STATION_SHAFT_UP = 3
const CARDINALS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** -> 'well' | 'shaft' | 'stand' | 'stair' | 'unknown' | null. Pure. */
export function stationKeepOut (cols, cell, { shell = false, own = null } = {}) {
  if (!cell || !Number.isFinite(cell.x)) return null
  for (const c of (Array.isArray(cols) ? cols : [])) {
    if (!c || !Number.isFinite(c.x)) continue
    if (cell.x === c.x && cell.z === c.z && cell.y >= c.y - 2 && cell.y <= c.y + STATION_SHAFT_UP) return 'shaft'
    if ((cell.y === c.y + 1 || cell.y === c.y + 2) && CARDINALS.some(([dx, dz]) => cell.x === c.x + dx && cell.z === c.z + dz)) return 'stand'
    for (const t of (Array.isArray(c.stair) ? c.stair : [])) {
      if (Array.isArray(t) && cell.x === t[0] && cell.z === t[2] && (cell.y === t[1] + 1 || cell.y === t[1] + 2)) return 'stair'
    }
  }
  if (own && Number.isFinite(own.x) && Math.max(Math.abs(cell.x - own.x), Math.abs(cell.z - own.z)) < 2 &&
      cell.y >= own.y - 3 && cell.y <= own.y) return 'well'   // the builder's exemption is the outer ring only, never the 3x3
  if (shell === null) return 'unknown'
  if (shell) return 'well'
  return null
}

/** The `_station_well` row: a placement candidate (or an explicit cell) refused for the well, and where it went instead. */
export const stationWellDetail = ({ action, item, kind, at = null, n = 1, by = '-' }) =>
  `action=${action} item=${item} kind=${kind} n=${n}${at ? ` at=${at.x},${at.y},${at.z}` : ''} by=${by}`

/** Within this many blocks (Chebyshev, horizontal; and 6 vertically) of a known well column a station placement is recorded
 *  (`_station_placed`), so the read can judge it against the well's cells itself. */
export const STATION_NEAR_WELL = 6
export function nearWell (cols, cell) {
  for (const c of (Array.isArray(cols) ? cols : [])) {
    if (c && Number.isFinite(c.x) && Math.max(Math.abs(cell.x - c.x), Math.abs(cell.z - c.z)) <= STATION_NEAR_WELL && Math.abs(cell.y - c.y) <= 6) return c
  }
  return null
}
