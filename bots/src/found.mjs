// FOUNDING (found-01; design docs/reports/town-plan-2026-10-20.md sections 5, 7.1, 8 F1-F6; build spec
// docs/reports/townplan-found-spec-2026-10-21.md section 2). A TOWN'S FIRST CHEST, CRAFTING TABLE AND FURNACE GO INTO THEIR
// PLOTS -- crafted when the bot has none.
//
// WHY: with no container in town, `deposit` fails nothing_found, `town_deposit` returns no_effect and the full-town recovery
// has nothing to anchor on: nothing ever places a fresh town's FIRST chest (design 5). And the bench's 769 tables and 176
// furnaces stand wherever a craft or a smelt happened. found-01 places the first container in the plan's overflow cell, each
// group's home in the next store cell as its first stack arrives, and the workshop's first table and furnace in their station
// cells. Every placement goes through the plan's reservation protocol (planstore.mjs), and a placed cell is permanent.
//
// PURE: the decisions (eligibility, materials, the station rule, the found slot, the lease). skills.mjs walks, crafts and
// places; cognitive.mjs supplies the readings and keeps the per-bot state. FOUND=off is the one-setting rollback.

import fs from 'node:fs'
import path from 'node:path'
import { LOGS, PLANKS, COBBLE, PLANKS_MEANS, STOCKPILE_KEEP, WOOD_KEEP } from './towndeposit.mjs'
import { scaffoldKeep } from './bankable.mjs'

// THE SWITCH. townplan-01 shipped this code DORMANT (FOUND=on only); found-01 makes it default-on. FOUND=off is its rollback.
export const FOUND = Object.freeze({ on: process.env.FOUND !== 'off' })
/** Per bot, after any found order was issued. */
export const FOUND_COOLDOWN_MS = 10 * 60 * 1000
/** The town-wide found lease and the reservation's TTL (design 4.6: the found lease, 4 min). */
export const FOUND_LEASE_MS = 4 * 60 * 1000
/** The founding floor (build spec 2.1): the stockpile's lap-0 targets, not its 64-unit cap. */
export const FLOOR_WOOD_UNITS = 8
export const FLOOR_STONE = 8
/**
 * MAY FOUNDING SPEND BELOW THE 64-UNIT STOCKPILE? -- OWNER DECISION 2026-10-22 ~13:00Z: YES, to craft the first table, chest and
 * furnace, for founding only.
 * true: the floor above (8 wood units + 4 planks + the scaffold reserve; 8 cobblestone + the reserve). false: the stockpile's own
 * caps (WOOD_KEEP 16 for wood since logbank-01, STOCKPILE_KEEP 64 for stone) -- a fresh bot then founds nothing until it holds more than 64. Founding only: no other order
 * reads it.
 */
export const FOUND_BELOW_STOCKPILE = true
/** A body standing in the cell on arrival is a FREE skip: the cooldown and the visit are refunded and the order may be issued
 *  again this long after (a body moves; Paper FOUND-NOFIT 10-22: a founder standing in the next cell cost two bots their visit). */
export const FOUND_RETRY_MS = 60 * 1000
/** ...at most this many free skips per CELL per visit (Claude code r9 P2: a body that never leaves -- an armour stand, a boat --
 *  would otherwise be retried every minute for ever); the next one is charged as before. */
export const FOUND_BODY_SKIPS_MAX = 2
/** What a found craft needs. */
export const CHEST_PLANKS = 8
export const TABLE_PLANKS = 4
export const FURNACE_COBBLE = 8

const countsOf = items => {
  const c = {}
  for (const it of (Array.isArray(items) ? items : [])) if (it?.name) c[it.name] = (c[it.name] ?? 0) + (Number(it.count) || 0)
  return c
}
const sum = (c, names) => names.reduce((t, n) => t + (c[n] ?? 0), 0)

/**
 * WHAT A FOUND CRAFT MAY SPEND -> { planks, cobble }: the PLANK-equivalents above the founding floor, and the stone above it.
 * Pure (build spec 2.1). Wood units = logs + floor(planks / 4). The floor is max(FLOOR_WOOD_UNITS, the active rung's wants
 * of wood) units + PLANKS_MEANS planks + the scaffold reserve's planks; stone, max(FLOOR_STONE, the rung's stone wants) + the
 * scaffold reserve's stone. `wanted` = the active rung's wanted names with counts ({ name: n }).
 */
export function foundMeans (items = [], { wanted = {}, belowStockpile = FOUND_BELOW_STOCKPILE } = {}) {
  const floorWood = belowStockpile ? FLOOR_WOOD_UNITS : WOOD_KEEP, floorStoneMin = belowStockpile ? FLOOR_STONE : STOCKPILE_KEEP
  const c = countsOf(items)
  const logs = sum(c, LOGS), planks = sum(c, PLANKS)
  const wantWood = Object.entries(wanted ?? {}).filter(([n]) => LOGS.includes(n)).reduce((t, [, v]) => t + (Number(v) || 0), 0) +
                   Math.ceil(Object.entries(wanted ?? {}).filter(([n]) => PLANKS.includes(n)).reduce((t, [, v]) => t + (Number(v) || 0), 0) / 4)
  // THE SCAFFOLD RESERVE, on its own (bankable.mjs scaffoldKeep: 8 of the cheapest scaffold blocks held): it is kept whatever
  // the stockpile rules say, so a bot can always pillar out
  const sk = scaffoldKeep(c)
  const scaffoldPlanks = PLANKS.reduce((t, n) => t + (sk[n] ?? 0), 0) + 4 * LOGS.reduce((t, n) => t + (sk[n] ?? 0), 0)
  const scaffoldStone = COBBLE.reduce((t, n) => t + (sk[n] ?? 0), 0)
  const floorPlanks = 4 * Math.max(floorWood, wantWood) + PLANKS_MEANS + scaffoldPlanks
  const plankEq = planks + 4 * logs
  const stone = sum(c, ['cobblestone', 'cobbled_deepslate', 'blackstone'])
  const wantStone = Object.entries(wanted ?? {}).filter(([n]) => COBBLE.includes(n)).reduce((t, [, v]) => t + (Number(v) || 0), 0)
  const floorStone = Math.max(floorStoneMin, wantStone) + scaffoldStone
  return { planks: Math.max(0, plankEq - floorPlanks), cobble: Math.max(0, stone - floorStone), floorPlanks, floorStone, plankEq, stone }
}

/**
 * THE STATION RULE (build spec 2.1; Codex spec r2 P1: the ladder rescans earlier rungs only after the chain, so a bot that gives
 * away its only table can skip its pickaxe rungs) -> { ok, spare, why }. Pure. A bot never ends without the station kind it
 * places: holding >= 2 it gives one; holding exactly 1 it first crafts a SPARE (materials above the floor); holding 0 it crafts
 * one AND its spare... no: holding 0 it crafts ONE to place and keeps none -- the ladder's own rung is its remedy only when it
 * already holds none (nothing changes for it). Holding 1 with no means for a spare: not eligible.
 */
export function stationRule (kind, items = [], means = foundMeans(items)) {
  const held = countsOf(items)[kind] ?? 0
  const cost = kind === 'crafting_table' ? { planks: TABLE_PLANKS, cobble: 0 } : { planks: 0, cobble: FURNACE_COBBLE }
  const can = n => means.planks >= cost.planks * n && means.cobble >= cost.cobble * n
  if (held >= 2) return { ok: true, crafts: 0, why: 'gives one of its spares' }
  if (held === 1) return can(1) ? { ok: true, crafts: 1, why: 'crafts a spare first, then gives one' } : { ok: false, crafts: 0, why: `holds its only ${kind} and cannot craft a spare above the founding floor` }
  // holding none: crafting one to give leaves it exactly as it was (none held); the ladder's rung was already its remedy
  return can(1) ? { ok: true, crafts: 1, why: `crafts one to place (it held none)` } : { ok: false, crafts: 0, why: `no ${kind} and no means above the founding floor` }
}

/** A chest for found_store: carried, or 8 planks above the floor. Pure. */
export function chestMeans (items = [], means = foundMeans(items)) {
  const held = countsOf(items).chest ?? 0
  if (held >= 1) return { ok: true, craft: false, why: 'carries a chest' }
  return means.planks >= CHEST_PLANKS ? { ok: true, craft: true, why: 'crafts a chest above the founding floor' } : { ok: false, craft: false, why: `no chest and fewer than ${CHEST_PLANKS} planks above the founding floor` }
}

const isCell = c => c && Array.isArray(c.at)
const freeCells = cells => (cells ?? []).filter(c => isCell(c) && c.state === 'free' && !Number.isFinite(c.seenSince))
/** The plan's store and work plots. Pure. */
export const storeOf = plan => (plan?.plots ?? []).find(p => p.id === 'store') ?? null
export const workOf = plan => (plan?.plots ?? []).find(p => p.id === 'work') ?? null

/**
 * THE GROUPS THE PLAN'S STORE ALREADY HOMES (greenfield: placed or reserved cells with a group) and whether an UNASSIGNED placed
 * container exists (role null: a free container a homeless group takes first). Pure.
 */
export function storeHomes (plan) {
  const st = storeOf(plan)
  const homes = new Set(), unassigned = []
  for (const c of st?.cells ?? []) {
    if (c.group && (c.state === 'placed' || c.state === 'reserved')) homes.add(c.group)
    if (c.state === 'placed' && (c.role ?? null) === null) unassigned.push(c)
  }
  for (const [g, ks] of Object.entries(plan?.groups?.homes ?? {})) if ((ks ?? []).length) homes.add(g)
  return { homes, unassigned }
}

/**
 * THE FOUND SLOT'S DECISION (build spec 2.1) -> { order: { skill, args, why } | null, skip: reason | null }. Pure. In order F1,
 * F2, F3b, F3, the first eligible. Readings:
 *   plan          the head plan (this world), null: none
 *   zonesKnown    protected zones known (1.7)
 *   items         the bag;  wanted  the active rung's wants { name: n }
 *   townContainer any container in inTown (F2 needs none)
 *   ready(cell)   READY now (live read) -> bool;  leaseFree  the found lease is free (or ours)
 *   depositWouldIssue  the town deposit would issue now (its dry decision)
 *   bankGroups    the groups of stacks either deposit path would bank now (F3)
 *   craftFits(item) the bag's room plan admits crafting it
 *   state         { lastAt, visit, visitUsed }   now
 */
export function foundOrder ({ plan = null, zonesKnown = true, items = [], wanted = {}, townContainer = false, ready = () => false,
                              leaseFree = true, depositWouldIssue = false, bankGroups = [], craftFits = () => true,
                              state = {}, now = 0, mode = null } = {}) {
  const skip = why => ({ order: null, skip: why })
  if (!FOUND.on) return skip('off')
  if (!plan) return skip('no_plan')
  if (!zonesKnown) return skip('zones_unknown')
  if (state.visitUsed) return skip('visit_used')
  if (now - (state.lastAt ?? -Infinity) < FOUND_COOLDOWN_MS) return skip('cooldown')
  if (now < (state.retryAt ?? -Infinity)) return skip('retry_wait')
  if (!leaseFree) return skip('lease_busy')
  const means = foundMeans(items, { wanted })
  const work = workOf(plan), store = storeOf(plan)
  const st = (work?.stations ?? [])
  const s0 = st.find(c => c.kind === 'crafting_table') ?? null
  const s1 = st.find(c => c.kind === 'furnace') ?? null
  const cands = []
  // F1: the workshop table
  if (s0 && s0.state === 'free' && !Number.isFinite(s0.seenSince) && ready(s0)) {
    const r = stationRule('crafting_table', items, means)
    if (r.ok && (r.crafts === 0 || craftFits('crafting_table'))) cands.push({ step: 'F1', skill: 'found_work', args: { kind: 'crafting_table', at: s0.at, crafts: r.crafts }, why: `the workshop's table goes in its station cell (${r.why})` })
  }
  // F2: the town's first container
  if (!townContainer && store && store.kind !== 'cluster') {
    // the overflow cell, else a cell with NO intent: never a cell another group's home is meant for (a reservation may set an
    // intent on a cell with none, never change one -- planstore; Claude/Codex code r2 P2)
    const cell = freeCells(store.cells).find(c => c.role === 'overflow' && ready(c)) ?? freeCells(store.cells).find(c => (c.role ?? null) === null && ready(c))
    const m = chestMeans(items, means)
    if (cell && m.ok && (!m.craft || craftFits('chest'))) cands.push({ step: 'F2', skill: 'found_store', args: { at: cell.at, role: 'overflow', group: null, craft: m.craft }, why: `the town has no container: its first chest goes in the overflow cell (${m.why})` })
  }
  // F3b: the workshop furnace, once the table is placed
  if (s0?.state === 'placed' && s1 && s1.state === 'free' && !Number.isFinite(s1.seenSince) && ready(s1)) {
    const r = stationRule('furnace', items, means)
    if (r.ok && (r.crafts === 0 || craftFits('furnace'))) cands.push({ step: 'F3b', skill: 'found_work', args: { kind: 'furnace', at: s1.at, crafts: r.crafts }, why: `the workshop's furnace goes in its station cell (${r.why})` })
  }
  // F3: a homeless group's home (greenfield: the next store cell; retrofit: the recovery's siting, no free container)
  if (townContainer && store) {
    const { homes, unassigned } = storeHomes(plan)
    const g = (bankGroups ?? []).find(x => x && !homes.has(x))
    const m = chestMeans(items, means)
    if (g && !unassigned.length && m.ok && (!m.craft || craftFits('chest'))) {
      if (store.kind !== 'cluster') {
        // THIS group's own cell first (a gone home keeps its intent; an expired or released reservation keeps only an intent it did
        // not set itself), then a cell with no intent; never one meant for
        // the overflow or another group (Claude/Codex code r2 P2: the walk refuses changing an intent, so such a pick looped)
        const free = freeCells(store.cells)
        const cell = free.find(c => c.role === 'home' && c.group === g && ready(c)) ?? free.find(c => (c.role ?? null) === null && ready(c))
        if (cell) cands.push({ step: 'F3', skill: 'found_store', args: { at: cell.at, role: 'home', group: g, craft: m.craft, carried: !m.craft }, why: `the first stack of ${g} has no home: its chest goes in the next store cell (${m.why})` })
      } else if (plan.groups?.status === 'allocated' && !(plan.groups.drain ?? []).length && !(plan.groups.overflow ?? []).length) {
        cands.push({ step: 'F3', skill: 'found_store', args: { at: null, role: 'home', group: g, craft: m.craft, carried: !m.craft, cluster: true }, why: `the first stack of ${g} has no home and the town has no free container (${m.why})` })
      }
    }
  }
  if (!cands.length) return skip('nothing')
  // THE DEPOSIT'S PRIORITY (build spec 2.1): when it would issue now, only an F3 with a CARRIED chest goes ahead of it
  if (depositWouldIssue) {
    const f3 = cands.find(c => c.step === 'F3' && c.args.carried)
    return f3 ? { order: { skill: f3.skill, args: { ...f3.args, step: f3.step }, why: f3.why }, skip: null } : skip('deposit_first')
  }
  const c = cands[0]
  return { order: { skill: c.skill, args: { ...c.args, step: c.step }, why: c.why }, skip: null }
}

/**
 * A HOMELESS GROUP TAKES AN UNASSIGNED CONTAINER FIRST (build spec 2.1 F3; Claude/Codex code r1 P2: in greenfield nothing else
 * ever gives a recovery-placed `role: null` chest a group, and F3 waits for no unassigned container -- so without this the town
 * would never found a group home again). -> { at, group } | null. Pure. Greenfield sections only (retrofit: maintainPlan's (b)).
 * The bag's first bankable group with no home takes the first unassigned PLACED store cell (role null -> home: a placed cell's
 * role may be set once from null, planstore's rule).
 */
export function foundAssign ({ plan = null, bankGroups = [] } = {}) {
  if (!FOUND.on || !plan || plan.mode !== 'greenfield') return null
  const st = storeOf(plan)
  if (!st || st.kind === 'cluster' || st.kind === 'unplaced') return null
  const { homes, unassigned } = storeHomes(plan)
  const c = unassigned.find(x => (x.role ?? null) === null)
  const g = (bankGroups ?? []).find(x => x && !homes.has(x))
  return c && g ? { at: [...c.at], group: g } : null
}

/** The per-bot found state after an order was ISSUED (the cooldown and the visit are charged at issue). Pure. */
export const foundIssued = (state = {}, now = 0) => ({ ...state, prevLastAt: state.lastAt ?? null, lastAt: now, visitUsed: true })
/** A FREE SKIP after the order was issued (a body in the cell): the visit and the cooldown it charged are given back, and the next
 *  order waits FOUND_RETRY_MS. Pure. */
export function foundRetry (state = {}, now = 0, at = null) {
  const k = Array.isArray(at) ? at.join(',') : '-'
  const n = state.bodySkips?.[k] ?? 0
  if (n >= FOUND_BODY_SKIPS_MAX) return state   // the cap: this one stays charged
  return { ...state, lastAt: state.prevLastAt ?? null, visitUsed: false, retryAt: now + FOUND_RETRY_MS, bodySkips: { ...(state.bodySkips ?? {}), [k]: n + 1 } }
}
/** A visit ends when the bot leaves the town circle; a new one starts on its return. Pure. */
export const foundVisit = (state = {}, inTown = false) => (inTown ? state : { ...state, visitUsed: false, bodySkips: {} })

// ---- the town-wide found lease (the furnace lease's file shape: `wx` generations, a live TTL) --------------------------------

const leaseFile = (dir, key, n) => path.join(dir, `${key}.found-lease.g${n}.json`)
const LEASE_RE = key => new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.found-lease\\.g(\\d+)\\.json$`)
function leaseGens (dir, key) {
  let names
  try { names = fs.readdirSync(dir) } catch (e) { if (e?.code === 'ENOENT') return []; throw e }
  const re = LEASE_RE(key)
  return names.map(n => re.exec(n)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b)
}
/** IS THE LEASE LIVE? Pure. A TORN record (a kill inside the write, a zero-length file after a power loss: Claude code r1 P2)
 *  is live only until it is older than any lease could be -- furnacelease.mjs leaseLive's rule -- never for ever. */
export function foundLeaseLive ({ rec = null, released = false, mtimeMs = 0, now = Date.now(), ttl = FOUND_LEASE_MS } = {}) {
  if (released) return false
  if (!rec) return now - mtimeMs < ttl
  return now < Number(rec.until ?? 0)
}
/** The current lease -> { gen, rec, live } | null. Never throws (an unreadable directory reads as BUSY: never two founders). */
export function foundLeaseState (dir, key, now = Date.now()) {
  try {
    const g = leaseGens(dir, key).at(-1)
    if (g == null) return null
    let rec = null, mtimeMs = now
    try { mtimeMs = fs.statSync(leaseFile(dir, key, g)).mtimeMs } catch { /* vanished: read as just written */ }
    try { rec = JSON.parse(fs.readFileSync(leaseFile(dir, key, g), 'utf8')) } catch { rec = null }
    const released = fs.existsSync(`${leaseFile(dir, key, g)}.released`)
    return { gen: g, rec, live: foundLeaseLive({ rec, released, mtimeMs, now }) }
  } catch { return { gen: null, rec: null, live: true } }
}
/** Take the lease -> { ok, gen } | { ok: false, why }. Exactly one taker per generation (`wx`), and a later generation wins. */
export function takeFoundLease (dir, key, holder, { now = Date.now(), ttl = FOUND_LEASE_MS, planGen = null } = {}) {
  const cur = foundLeaseState(dir, key, now)
  if (cur?.live && cur.rec?.holder !== holder) return { ok: false, why: `held by ${cur.rec?.holder ?? 'an unreadable lease'}` }
  const n = (cur?.gen ?? 0) + 1
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(leaseFile(dir, key, n), JSON.stringify({ holder, at: now, until: now + ttl, planGen }), { flag: 'wx' })
  } catch { return { ok: false, why: 'lost the race for the lease' } }
  const after = leaseGens(dir, key).at(-1)
  if (after !== n) return { ok: false, why: 'a later lease generation exists' }
  return { ok: true, gen: n }
}
/** Is the lease still ours (generation `gen`, live)? Re-checked immediately before a click. */
export function holdsFoundLease (dir, key, holder, gen, now = Date.now()) {
  const cur = foundLeaseState(dir, key, now)
  return !!cur && cur.gen === gen && cur.live && cur.rec?.holder === holder
}
/** Renew our lease (a new generation by the same holder) -> the new gen | null. */
export function renewFoundLease (dir, key, holder, gen, { now = Date.now(), ttl = FOUND_LEASE_MS, planGen = null } = {}) {
  if (!holdsFoundLease(dir, key, holder, gen, now)) return null
  const r = takeFoundLease(dir, key, holder, { now, ttl, planGen })
  return r.ok ? r.gen : null
}
/** Release (a marker file; the generation is never deleted). Never throws. */
export function releaseFoundLease (dir, key, holder, gen) {
  // OURS (the newest generation, our name) whatever the clock says: a release after the TTL is harmless, a skipped one is not
  try {
    const cur = foundLeaseState(dir, key)
    if (cur && cur.gen === gen && cur.rec?.holder === holder) fs.writeFileSync(`${leaseFile(dir, key, gen)}.released`, String(Date.now()))
  } catch { /* lapses at its TTL */ }
}

// ---- rows ---------------------------------------------------------------------------------------------------------------------

export const foundModeDetail = () => `phase=mode found=${FOUND.on ? 'on' : 'off'} v=1 cooldown_min=${FOUND_COOLDOWN_MS / 60000} lease_s=${FOUND_LEASE_MS / 1000} floor_wood=${FLOOR_WOOD_UNITS} floor_stone=${FLOOR_STONE} below_stockpile=${FOUND_BELOW_STOCKPILE ? 1 : 0} retry_s=${FOUND_RETRY_MS / 1000}`
export const foundRowDetail = (f = {}) => ['order', 'kind', 'step', 'outcome', 'at', 'source', 'gen', 'role', 'group', 'lease', 'spare', 'ms', 'why']
  .filter(k => f[k] != null).map(k => `${k}=${String(Array.isArray(f[k]) ? f[k].join(',') : f[k]).replace(/\s+/g, '_').slice(0, k === 'why' ? 120 : 40)}`).join(' ')
