// THE SLIM BAG ALLOWANCE (junkout-01; OWNER 2026-10-21 ~20:30Z "yes build it, i approve of your recommendations").
// Design and evidence: docs/reports/junkout-01-design-2026-10-21.md. Reused from bagbudget-01 (branch
// bagbudget-on-9e7d998-paper, reviewed by both engines; closed INCONCLUSIVE, unexposed): the whole-stack planner, the
// station list, the "never a chest's" and "another layer owns it" rules, the bank row in parts. NOT reused (outside the
// owner's "exactly this"): its ladder, food and building-stone rows, its last-swing row P, its deletion-first wait and its
// keep-constant consolidation.
//
// MEASURED 10-21 (newest bag per bot, 80 bags, 2,462 slots): bone_meal 83 slots on 77 bots, torch 72 on 68, and no layer
// has an exit for either (bankable `not_wanted`, not the well's, not the composter's). Stations: never a second stack.
// Stone pickaxes beyond the best working pickaxe + 2 spares: 25 copies in 19 bags, every one SPENT.
//
// A WHOLE KIND OR NOTHING. The town deposit moves WHOLE stacks (two clicks into an empty container slot, read back from the
// server), so a kind that fits one stack is one slot: banking 7 of 8 chests frees nothing and is never planned.
//
// Pure, and a LEAF (no imports): every layer can import it without a cycle.

/** BAG_ALLOWANCE=on|off, default on; anything else reads as on and the mode row says so. Pure. */
export function bagAllowanceMode (env = {}) {
  const raw = env?.BAG_ALLOWANCE
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: null }
  const v = String(raw).trim().toLowerCase()
  if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }
  return { on: true, mode: 'on', note: `BAG_ALLOWANCE=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const BAG_ALLOWANCE = Object.freeze(bagAllowanceMode(typeof process !== 'undefined' ? process.env : {}))

/** JUNK_VISIT=on|off, default on: the well's and the composter's town-visit orders (well.mjs, composter.mjs). Pure. */
export function junkVisitMode (env = {}) {
  const raw = env?.JUNK_VISIT
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: null }
  const v = String(raw).trim().toLowerCase()
  if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }
  return { on: true, mode: 'on', note: `JUNK_VISIT=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const JUNK_VISIT = Object.freeze(junkVisitMode(typeof process !== 'undefined' ? process.env : {}))

/**
 * THE NUMBERS (the owner's rows).
 *   station      one of each station and bucket stays (bagbudget row K: the tech ladder is satisfied by HOLDING them; the
 *                carried chest is the full-town recovery's; a carried composter is the composter build's zero-craft route)
 *   torch        0: no consumer on this base (kitshrink-01: 0 crafts, 1 placed in 24 h; peaceful worlds)
 *   boneMeal     0: no consumer in bots/src (the composter MAKES it); the town's, for tree farms
 *   stoneSpares  stone pickaxes kept beyond the best working pickaxe (towndeposit.mjs stonePickSteps)
 * "Capped" with whole stacks: a bag holds one stack of each, so a cap above 0 keeps the slot. They are constants.
 */
export const ALLOWANCE = Object.freeze({ station: 1, torch: 0, boneMeal: 0, stoneSpares: 2 })

/** Row K: the stations (bagbudget-01's list). */
export const STATIONS = Object.freeze(['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'barrel', 'composter',
  'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket'])
const STATION_SET = new Set(STATIONS)

/** WHICH ROW A NAME IS IN -> 'station' | 'torch' | 'bone_meal' | null (no row: the name stays whole). Pure. */
export function allowanceRow (name) {
  if (typeof name !== 'string') return null
  if (STATION_SET.has(name)) return 'station'
  if (name === 'torch') return 'torch'
  if (name === 'bone_meal') return 'bone_meal'
  return null
}

/** WHAT THE ROW KEEPS of `name` -> a number (Infinity = the whole kind: no row). Pure. */
export function rowKeep (name) {
  switch (allowanceRow(name)) {
    case 'station': return ALLOWANCE.station
    case 'torch': return ALLOWANCE.torch
    case 'bone_meal': return ALLOWANCE.boneMeal
    default: return Infinity
  }
}

const countsOf = items => {
  const c = {}
  for (const it of (Array.isArray(items) ? items : [])) if (it?.name) c[it.name] = (c[it.name] ?? 0) + (Number(it.count) || 0)
  return c
}

/**
 * THE STACKABLE ROWS' SURPLUS -> [{ slot, name, count, row }]: whole stacks, smallest first per name, while what remains of
 * the name stays >= its keep. Pure over mineflayer Items ({ name, count, slot }).
 *   owned(name)  true when another layer owns the name, or it is never a chest's: never listed here
 *   keeps        { name: n } other floors (townKeeps: the goal, the stockpile ...): the keep is max(row, floor)
 *   room(name)   how many of the name this visit may still move (the visit's CREDIT_CAP less what it moved)
 */
export function allowanceSteps (items = [], { owned = () => false, keeps = {}, room = () => Infinity } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (Number(it.count) || 0) > 0 && Number.isInteger(it.slot))
  const counts = countsOf(list)
  const out = []
  for (const name of Object.keys(counts).sort()) {
    if (owned(name)) continue
    const keep = Math.max(rowKeep(name), Math.max(0, Number(keeps?.[name]) || 0))
    if (!Number.isFinite(keep)) continue
    let left = Math.min(counts[name] - keep, Math.max(0, Number(room(name)) || 0))
    if (!(left > 0)) continue
    const copies = list.filter(it => it.name === name).sort((a, b) => a.count - b.count || a.slot - b.slot)
    for (const it of copies) {
      if (it.count > left) break
      out.push({ slot: it.slot, name, count: it.count, row: allowanceRow(name) })
      left -= it.count
    }
  }
  return out
}

// ---- once per town visit (the visit orders: well.mjs wellVisitOrder, composter.mjs compostVisitOrder, towndeposit.mjs
// tailOrder) -------------------------------------------------------------------------------------------------------------

/** A visit order re-arms only after this long of decisions OUTSIDE town (the town deposit's TD_REARM_OUTSIDE_MS)... */
export const VISIT_REARM_OUTSIDE_MS = 60 * 1000
/** ...or this long after its issue while the bot stays in town (the well and the composter; the tail uses the town
 *  deposit's own 15 min). */
export const VISIT_STAY_MS = 20 * 60 * 1000

/**
 * THE VISIT LATCH, TICKED ON EVERY DECISION (Codex design r1 P1-1: a latch updated only when its order gets a turn misses
 * the departures it re-arms on). -> the new state. Pure.
 *   state  { latched, issuedAt, outsideSince, armed, armedUsed }
 * `armed` says WHY the latch is open, for the order's row and the read's J5 (Claude design r2 P2-1): 'first' (nothing issued
 * yet in this process), 'out:<first>-<last>' (the decisions outside the zone that re-armed it, ms in base 36), 'stay' (the
 * stay window ran out).
 */
export function visitLatchTick (state = {}, { now = 0, atTown = false, stayMs = VISIT_STAY_MS, outsideMs = VISIT_REARM_OUTSIDE_MS } = {}) {
  const s = { ...state }
  const t36 = v => Math.max(0, Math.floor(Number(v) || 0)).toString(36)
  if (!atTown) {
    if (s.outsideSince == null) s.outsideSince = now
    if (s.latched && now - s.outsideSince >= outsideMs) { s.latched = false; s.armed = `out:${t36(s.outsideSince)}-${t36(now)}` }
    return s
  }
  s.outsideSince = null
  if (s.latched && now - (s.issuedAt ?? -Infinity) >= stayMs) { s.latched = false; s.armed = 'stay' }
  return s
}
/** The latch's reason as an order carries it ('first' until something was issued). */
export const visitArmed = (state = {}) => state?.armed ?? 'first'
/** A visit order was ISSUED -> the latched state (charged at issue, so a skip or a failure still spends the visit too). */
export const visitLatchIssue = (state = {}, now = 0) => ({ ...state, latched: true, issuedAt: now, outsideSince: null, armedUsed: visitArmed(state), armed: null })
/** The runner declined to start it (it never ran) -> the visit is not spent, and the reason that armed it stands again. */
export const visitLatchDeclined = (state = {}) => ({ ...state, latched: false, armed: state?.armedUsed ?? state?.armed ?? 'first' })
/** One id per issued visit order, carried by the order, the skill's rows and the read (Codex design r1 P2-6). */
export const visitId = (name, now) => `${String(name || 'bot').replace(/[^A-Za-z0-9_-]/g, '_')}.${Math.max(0, Math.floor(Number(now) || 0)).toString(36)}`

/** The licence row's detail (once per process: `_junkout_mode`). */
export function junkoutModeDetail (allowance = BAG_ALLOWANCE, visit = JUNK_VISIT) {
  const note = [allowance.note, visit.note].filter(Boolean).join(';')
  return `phase=mode visit=${visit.on ? 1 : 0} allowance=${allowance.on ? 1 : 0} rows=station:${ALLOWANCE.station},torch:${ALLOWANCE.torch},bone_meal:${ALLOWANCE.boneMeal},stone_spares:${ALLOWANCE.stoneSpares}${note ? ` note=${note.replace(/\s+/g, '_')}` : ''}`.slice(0, 300)
}

/**
 * THE BANK ROWS (`_junkout phase=bank`): what the rows planned (`allow`: the name, the START count : the SERVER-verified
 * banked) and EVERY other name the visit banked (`other`) -- the read's junk-into-chest gate reads both. COMPLETE, IN
 * PARTS (bagbudget-01, Codex design r2 P2-3): when one row would pass 300 the names continue on further rows, each
 * `part=i/n`, every part carrying the head; `v=` the visit's id (the read never joins parts of two visits). Pure.
 *   mode       'tail' (the not-full visit order) | 'full' (rows appended to a full bag's town deposit)
 *   keepPicks  stone pickaxe copies the plan kept (the best working one + the spares), or null when it had none to judge
 */
export function junkoutBankDetails ({ planned = [], heldBefore = {}, banked = {}, slotsBefore = null, slotsAfter = null, peaceful = null, visit = null, mode = 'tail', keepPicks = null, dh = null, dy = null, armed = null, attempted = {} } = {}) {
  const allow = [...new Set(planned.map(s => s.name))].sort()
  const rows = {}
  for (const s of planned) rows[s.row] = (rows[s.row] ?? 0) + 1
  const n = v => Math.max(0, Number(v) || 0)
  const got = allow.reduce((t, k) => t + n(banked?.[k]), 0)
  const other = Object.keys(banked ?? {}).filter(k => n(banked[k]) > 0 && !allow.includes(k)).sort()
  const head = `phase=bank v=${visit ?? '-'} mode=${mode} armed=${armed ?? '-'} dh=${dh ?? '?'} dy=${dy ?? '?'} peaceful=${peaceful == null ? '?' : peaceful ? 1 : 0} stacks=${planned.length} banked=${got} ` +
    `slots=${slotsBefore ?? '?'}->${slotsAfter ?? '?'} keep_picks=${keepPicks ?? '-'} rows=${Object.entries(rows).sort().map(([k, v]) => `${k}:${v}`).join(',') || '-'}`
  // try= a name CLICKED into a chest this run beyond what the server verified (an abort, an unverified re-open): it may be there
  const tried = Object.keys(attempted ?? {}).filter(k => n(attempted[k]) > n(banked?.[k])).sort()
  const tokens = [...allow.map(k => `allow=${k}=${n(heldBefore?.[k])}:${n(banked?.[k])}`), ...other.map(k => `other=${k}:${n(banked[k])}`),
    ...tried.map(k => `try=${k}:${n(attempted[k]) - n(banked?.[k])}`)]
  const parts = [[]]
  const len = p => `${head} part=99/99 ${p.join(' ')}`.length
  for (const t of tokens) {
    const cur = parts[parts.length - 1]
    if (cur.length && len([...cur, t]) > 300) parts.push([t]); else cur.push(t)
  }
  return parts.map((p, i) => `${head} part=${i + 1}/${parts.length} ${p.join(' ') || '-'}`.slice(0, 300))
}

/**
 * The visit orders' rows (`_junkout phase=well|compost`), key=value, the gates' fields first: the visit id, the ORDER-time
 * horizontal distance from home `dh` (the read's J3), and for the well what the throws were AS THE SERVER NAMED THEM --
 * `offlist` (off the list), `swords`, `cobble`, `stock` clicked (the read's J4: a visit throws listed junk only).
 */
export function junkoutVisitDetail ({ phase = 'well', vid = null, armed = null, dh = null, dy = null, dw = null, slotsBefore = null, slotsAfter = null, listed = null, n = 0,
                                      offlist = 0, swords = 0, cobble = 0, stock = 0, status = '?', stop = null } = {}) {
  const k = v => Math.max(0, Number(v) || 0)
  return `phase=${phase} vid=${vid ?? '-'} armed=${armed ?? '-'} dh=${dh ?? '?'} dy=${dy ?? '?'} dw=${dw ?? '?'} offlist=${k(offlist)} swords=${k(swords)} cobble=${k(cobble)} stock=${k(stock)} ` +
    `slots=${slotsBefore ?? '?'}->${slotsAfter ?? '?'} listed=${listed ?? '-'} n=${k(n)} status=${status}${stop ? ` stop=${String(stop).replace(/\s+/g, '_').slice(0, 80)}` : ''}`.slice(0, 300)
}
