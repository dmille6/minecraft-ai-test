// MAKE_MATERIAL (mats-01): the building tier's materials job. Design docs/reports/building-tier-2026-10-23.md section 3
// (r7.1, approved by both engines), owner answers 10-23 (Q3 charcoal from surplus logs for torches only; the BUILD_RESERVE
// table of reserve-proposal-2026-10-23.md, declared in stocktarget.mjs by matset-01).
//
// A DETERMINISTIC TOWN JOB, never the model's verb (the brain's `build` verb went unchosen for 24 h; advice printed is not
// advice taken). It turns town stock ABOVE THE RESERVE into building parts, BUFFERS ONLY in mats-01 (no project exists yet):
//   bricks       12 cobblestone, smelted on exactly 8 planks (2 logs), -> 12 stone -> 12 stone_bricks (2x2, no table)
//   panes        6 sand on 4 planks (1 log) -> 6 glass -> 16 glass_pane (table)
//   cut_copper   36 copper_ingot -> 4 copper_block -> 4 cut_copper (table)
//   copper_door  6 copper_ingot -> 3 copper_door (table)
//   torch        Q3: 6 logs smelted on 4 planks (1 log) -> 6 charcoal, + 6 sticks (1 log) -> 24 torches. The job's OWN charcoal
//                only: made and crafted in one order, never the town's or the bag's (the bag's coal/charcoal are the iron
//                ladder's).
// FUEL IS PLANKS ONLY, IN EXACT BATCHES (1 plank = 1.5 smelts: 8 planks burn 12 items with nothing part-burnt). Never coal,
// never charcoal, never iron, never a tool or the kit (B3) -- code, not configuration (FORBIDDEN below).
//
// EVERY DECISION IS HERE AND PURE (CLAUDE.md "extract the decision"); skills.mjs only walks, opens, clicks, waits, measures.

import { BUILD_RESERVE, PROJECT_PARTS } from './stocktarget.mjs'

export const MATS_V = 1
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak']
export const LOG_NAMES = Object.freeze(WOODS.map(w => `${w}_log`))
export const PLANKS_OF = Object.freeze(Object.fromEntries(WOODS.map(w => [`${w}_log`, `${w}_planks`])))
export const PLANK_NAMES = Object.freeze(Object.values(PLANKS_OF))
export const isLog = n => LOG_NAMES.includes(n)
export const isPlanks = n => PLANK_NAMES.includes(n)

/** Smelts per plank (300 ticks / 200). A batch's planks are exact: `n` items need n / 1.5 planks, a whole number. */
export const SMELTS_PER_PLANK = 1.5
export const planksFor = n => n / SMELTS_PER_PLANK

/**
 * THE KINDS. `inputs`: what the job takes (from the bag above its keeps, then the town above the reserve). `log` is ONE
 * species, chosen by the order (the most-stocked one). `smelt`: one furnace session (input, count, its planks); `crafts`:
 * in order, each { out, n } (n = how many of `out` to make). `makes`: the part and its count. `slots`: the free bag slots the
 * order needs after the keeps (design 3.2: inputs, planks, parts, a furnace leftover = 4; copper = 3). `table`: a crafting
 * table recipe is in the chain.
 */
export const KINDS = Object.freeze({
  bricks: Object.freeze({ part: 'stone_bricks', makes: 12, slots: 4, table: false,
    inputs: { cobblestone: 12, log: 2 }, smelt: { input: 'cobblestone', n: 12, out: 'stone', planks: 8 },
    crafts: [{ out: 'planks', n: 8 }, { out: 'stone_bricks', n: 12 }] }),
  panes: Object.freeze({ part: 'glass_pane', makes: 16, slots: 4, table: true,
    inputs: { sand: 6, log: 1 }, smelt: { input: 'sand', n: 6, out: 'glass', planks: 4 },
    crafts: [{ out: 'planks', n: 4 }, { out: 'glass_pane', n: 16 }] }),
  cut_copper: Object.freeze({ part: 'cut_copper', makes: 4, slots: 3, table: true,
    inputs: { copper_ingot: 36 }, smelt: null, crafts: [{ out: 'copper_block', n: 4 }, { out: 'cut_copper', n: 4 }] }),
  copper_door: Object.freeze({ part: 'copper_door', makes: 3, slots: 3, table: true,
    inputs: { copper_ingot: 6 }, smelt: null, crafts: [{ out: 'copper_door', n: 3 }] }),
  torch: Object.freeze({ part: 'torch', makes: 24, slots: 4, table: false,
    inputs: { log: 8 }, smelt: { input: 'log', n: 6, out: 'charcoal', planks: 4 },
    crafts: [{ out: 'planks', n: 8 }, { out: 'stick', n: 8 }, { out: 'torch', n: 24 }] }),
})
/** The order the job considers them in: the most-used part first. */
export const KIND_ORDER = Object.freeze(['bricks', 'cut_copper', 'copper_door', 'panes', 'torch'])
for (const k of Object.values(KINDS)) if (k.smelt && planksFor(k.smelt.n) !== k.smelt.planks) throw new Error(`mats: ${k.part} planks are not exact`)

/**
 * NEVER INPUTS, WHATEVER A SETTING SAYS (design 3.3): the iron ladder (raw iron, ingots, nuggets, ores, coal, charcoal), every
 * tool, bucket and shears, and anything with a durability. The job's own charcoal (torch kind) is MADE by it and never taken.
 * The conservation gate books these BY NAME: the bag must not hold fewer of any of them after an order than before.
 */
export const FORBIDDEN_RE = /^(raw_iron|iron_ingot|iron_nugget|iron_ore|deepslate_iron_ore|coal|charcoal|coal_block|bucket|water_bucket|lava_bucket|milk_bucket|shears|flint_and_steel)$|_(pickaxe|axe|shovel|hoe|sword)$|_(helmet|chestplate|leggings|boots)$/
export const isForbidden = n => typeof n === 'string' && FORBIDDEN_RE.test(n)

/** One maker per town (design 3.2): the materials lease. */
export const MATS_LEASE_TTL_MS = 240_000
const envMs = (name, dflt) => { const v = Number(process.env[name]); return process.env[name] != null && process.env[name] !== '' && Number.isFinite(v) && v >= 0 ? v : dflt }
/** Bounds (design 3.2): one order per bot per 10 min, a 20 min backoff on failure; the sandbox paces its own (env). */
export const MATS_COOLDOWN_MS = envMs('MATS_COOLDOWN_MS', 10 * 60 * 1000)
export const MATS_BACKOFF_MS = 20 * 60 * 1000
export const MATS_PAUSE_AFTER = 6
export const MATS_PAUSE_MS = 6 * 60 * 60 * 1000
/** The index must have SEEN this share of the town's containers (known and fresh) before a part count is believed: an
 *  unknown container counts 0, which under-counts inputs (safe) but also under-counts parts, which would let the job make
 *  parts past the buffer. Below it the order skips `index_coverage` (count_town re-reads the unknown ones). */
export const MATS_MIN_COVERAGE = 0.8
/** The design's town-job body budget (TP: at most 10 min per bot-hour of town jobs). */
export const MATS_BODY_MS_PER_HOUR = 10 * 60 * 1000

/** BUFFERS, per town, a setting (design 3.2): production stops at them; they are not stock targets. torch: Q3's part,
 *  its buffer the stock towns hold today (64), so the job tops a town up to it and never past it. */
export const MATS_BUFFERS_DEFAULT = Object.freeze({ stone_bricks: 128, glass_pane: 32, cut_copper: 24, copper_door: 3, torch: 64 })
export const RESERVE_KEYS = Object.freeze(Object.keys(BUILD_RESERVE))

const parseTable = (raw, keys, dflt) => {
  const s = String(raw ?? '').trim()
  if (!s) return { table: { ...dflt }, src: 'default' }
  let j
  try { j = JSON.parse(s) } catch { return { table: { ...dflt }, src: 'invalid' } }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { table: { ...dflt }, src: 'invalid' }
  const out = { ...dflt }
  for (const [k, v] of Object.entries(j)) {
    // an unknown key or a value that is not a whole number >= 0 makes the WHOLE setting invalid: the defaults hold
    if (!keys.includes(k) || !Number.isInteger(v) || v < 0) return { table: { ...dflt }, src: 'invalid' }
    out[k] = v
  }
  return { table: out, src: 'env' }
}
/** THE BUILD RESERVE AS A SETTING (design 3.3): MATS_RESERVE (JSON, a subset of the keys) over BUILD_RESERVE. Invalid -> the
 *  declared table, said in the licence row (src=invalid). */
export const matsReserve = (env = process.env) => parseTable(env?.MATS_RESERVE, RESERVE_KEYS, BUILD_RESERVE)
export const matsBuffers = (env = process.env) => parseTable(env?.MATS_BUFFERS, Object.keys(MATS_BUFFERS_DEFAULT), MATS_BUFFERS_DEFAULT)

/** IS THE JOB ON -> { on, why }. Off with MATS=0|off|false, and in an ISOLATED pool (TP D2 / town plan O8). */
export function matsEnabled (env = {}, scope = null) {
  const v = String(env?.MATS ?? '').trim().toLowerCase()
  if (['0', 'off', 'false', 'no'].includes(v)) return { on: false, why: 'switched off (MATS)' }
  if (scope === 'isolated') return { on: false, why: 'isolated pool (TP D2: town state is per bot there)' }
  return { on: true, why: null }
}

/** A reserve key's stock in a {name: n} map. */
export function reserveCount (key, stock = {}) {
  const s = stock ?? {}
  if (key === 'logs') return LOG_NAMES.reduce((t, n) => t + (Number(s[n]) || 0), 0)
  if (key === 'planks') return PLANK_NAMES.reduce((t, n) => t + (Number(s[n]) || 0), 0)
  if (key === 'sticks') return Number(s.stick) || 0
  if (key === 'sand') return (Number(s.sand) || 0) + (Number(s.red_sand) || 0)
  return Number(s[key]) || 0
}
/** Which reserve key an input name draws from (null: none -- then it is not an allowed input at all). */
export function reserveKeyOf (name) {
  if (isLog(name)) return 'logs'
  if (isPlanks(name)) return 'planks'
  if (name === 'stick') return 'sticks'
  if (name === 'sand' || name === 'red_sand') return 'sand'
  if (['cobblestone', 'copper_ingot', 'torch'].includes(name)) return name
  return null
}
/** SPENDABLE town stock of a reserve key: the indexed stock less the reserve, never below 0 (design 3.3). */
export const spendable = (key, stock, reserve) => Math.max(0, reserveCount(key, stock) - (Number(reserve?.[key]) || 0))

/** The log species an order uses: the most-stocked in town with at least `need` spendable, ties by name. Pure. */
export function pickLog (stock = {}, need = 1, reserve = BUILD_RESERVE) {
  const total = spendable('logs', stock, reserve)
  if (total < need) return null
  let best = null
  for (const n of LOG_NAMES) {
    const c = Number(stock?.[n]) || 0
    if (c >= need && (!best || c > best.c || (c === best.c && n < best.n))) best = { n, c }
  }
  return best?.n ?? null
}

/**
 * WHAT ONE ORDER OF `kind` TAKES -> { take: {name: n}, fromBag: {name: n}, log, short } | null. Pure.
 *   bagSpare  {name: n} the bag holds ABOVE its keeps (towndeposit townKeeps) -- cobblestone from the bag first (the owner's
 *             cobble-in-bags concern), never any other input from the bag (the bag's logs, sand and ingots are its keeps' or
 *             the deposit flows')
 *   stock     the town's indexed stock {name: n}; reserve the BUILD_RESERVE table
 * null when the town cannot supply the rest above the reserve.
 */
export function orderInputs (kind, { bagSpare = {}, stock = {}, reserve = BUILD_RESERVE } = {}) {
  const k = KINDS[kind]
  if (!k) return null
  const take = {}, fromBag = {}
  let log = null
  for (const [name, n] of Object.entries(k.inputs)) {
    if (name === 'log') {
      log = pickLog(stock, n, reserve)
      if (!log) return null
      take[log] = n
      continue
    }
    const own = name === 'cobblestone' ? Math.min(n, Math.max(0, Number(bagSpare?.cobblestone) || 0)) : 0
    if (own > 0) fromBag[name] = own
    const rest = n - own
    if (rest <= 0) continue
    const rk = reserveKeyOf(name)
    if (!rk || spendable(rk, stock, reserve) < rest) return null
    take[name] = rest
  }
  return { take, fromBag, log }
}

/** The town's count of a part (the part's own name, every PROJECT_PARTS variant of it not counted: buffers name a base part). */
export const partCount = (part, stock = {}) => Number(stock?.[part]) || 0

const lazy = v => (typeof v === 'function' ? v() : v)

/**
 * THE ORDER -> { order, kind, state, skip }. Pure; cognitive.mjs supplies the readings (lazy ones are read only after every
 * cheap gate passed). `skip` names why nothing was issued -- the read's denominator; a skip leaves the bot every other move.
 *   on, shared   the switch and a shared town (isolated pools keep per-bot town state: off)
 *   holds        a milestone rung is ready (or waits only on room): the rung always wins
 *   atTown       at town (TOWN_RADIUS)
 *   noteOpen     an earlier order's carry note is open: mats_return runs first (its own order), never a new order
 *   freeSlots    36 - occupied slots;  bagSpare  the bag above its keeps
 *   town         lazy -> { stock: {name: n}, coverage: 0..1 } from the town index (known, fresh containers only)
 *   furnace      lazy -> a qualifying cold furnace exists (for smelt kinds) -- skills.mjs matsFurnaceCandidates
 *   table        lazy -> a crafting table is reachable or carried (for table kinds)
 *   lease        lazy -> the town's materials lease is free (one maker per town)
 *   bodyMs       this bot's town-job body time in the last hour (the 10 min/bot-hour budget)
 *   unknown      lazy -> how many never-opened town containers a count can reach (skills.mjs indexRecountKeys): below the
 *                coverage the order COUNTS them (kind `count`) instead of skipping
 */
export function materialOrder ({ now = 0, on = true, shared = true, atTown = false, holds = false, noteOpen = false, freeSlots = 0,
                                 bagSpare = {}, town = null, furnace = () => true, table = () => true, lease = () => true, unknown = () => 0,
                                 bodyMs = 0, reserve = BUILD_RESERVE, buffers = MATS_BUFFERS_DEFAULT, state = {} } = {}) {
  const s = { ...state }
  const no = skip => ({ order: null, kind: null, state: s, skip })
  if (!on) return no('off')
  if (!shared) return no('isolated')
  if (holds) return no('milestone')
  if (!atTown) return no('away')
  if (noteOpen) return no('note_open')
  if (now < (s.pausedUntil ?? 0)) return no('paused')
  if (now - (s.lastIssuedAt ?? -Infinity) < MATS_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return no('cooldown')
  if (bodyMs >= MATS_BODY_MS_PER_HOUR) return no('body_budget')
  if (freeSlots < Math.min(...Object.values(KINDS).map(k => k.slots))) return no('room')
  // the town read only after the cheap gates; the cooldown is charged for the LOOK
  s.lastIssuedAt = now
  const t = lazy(town)
  if (!t || !t.stock) return no('index_unreadable')
  if (!(t.coverage >= MATS_MIN_COVERAGE)) {
    // THE REMEDY IS PERFORMED, NOT PRINTED (CLAUDE.md): with never-opened town containers in reach, the order counts them
    // (count_town's own index count, at most three a visit); only with none left is it a skip
    const u = Number(lazy(unknown)) || 0
    if (u > 0) return { order: { skill: 'make_material', args: { kind: 'count' }, why: `the town index has seen ${Math.round(t.coverage * 100)}% of the town's containers (it needs ${Math.round(MATS_MIN_COVERAGE * 100)}%): open the ${u} never-opened one(s) first (town materials job)` }, kind: 'count', state: s, skip: null }
    return no('index_coverage')
  }
  const reasons = []
  for (const kind of KIND_ORDER) {
    const k = KINDS[kind]
    const short = (Number(buffers?.[k.part]) || 0) - partCount(k.part, t.stock)
    if (short <= 0) { reasons.push('stocked'); continue }
    if (freeSlots < k.slots) { reasons.push('room'); continue }
    const inp = orderInputs(kind, { bagSpare, stock: t.stock, reserve })
    if (!inp) { reasons.push('inputs'); continue }
    if (k.smelt && !lazy(furnace)) { reasons.push('no_furnace'); continue }
    if (k.table && !lazy(table)) { reasons.push('no_table'); continue }
    if (!lazy(lease)) return no('lease_busy')
    return {
      order: { skill: 'make_material', args: { kind },
               why: `the town holds ${partCount(k.part, t.stock)} ${k.part}, below its buffer of ${buffers[k.part]}, and has the inputs above its reserve: make ${k.makes} (town materials job)` },
      kind, state: s, skip: null, inputs: inp,
    }
  }
  // the most informative reason a part was not made (the read's denominator): inputs > no_furnace > no_table > room > stocked
  for (const r of ['inputs', 'no_furnace', 'no_table', 'room']) if (reasons.includes(r)) return no(r)
  return no('stocked')
}

/** THE RECOVERY ORDER (mats_return, design 3.2): an open carry note at town runs FIRST, before any other town order. */
export function returnOrder ({ on = true, atTown = false, noteOpen = false, now = 0, state = {} } = {}) {
  const s = { ...state }
  if (!on || !atTown || !noteOpen) return { order: null, state: s, skip: !noteOpen ? 'no_note' : !atTown ? 'away' : 'off' }
  if (now - (s.lastReturnAt ?? -Infinity) < 60_000) return { order: null, state: s, skip: 'cooldown' }
  s.lastReturnAt = now
  return { order: { skill: 'mats_return', args: {}, why: 'a materials order did not finish: reconcile its carry note (craft any stone, bank the parts and what was taken)' }, state: s, skip: null }
}

/** AFTER THE ORDER RAN -> new state (smeltjob's pattern): success clears; failure backs off; one reason six times pauses 6 h. */
export function matsOutcome (status, why = null, now = 0, state = {}) {
  const s = { ...state }
  if (status === 'success') { s.streak = null; return s }
  if (status === 'failed') s.backoffUntil = now + MATS_BACKOFF_MS
  if (status === 'aborted' || why === 'interrupted') return s
  const key = why ?? status
  const n = s.streak?.why === key ? (s.streak.n ?? 0) + 1 : 1
  s.streak = { why: key, n }
  if (n >= MATS_PAUSE_AFTER) { s.pausedUntil = now + MATS_PAUSE_MS; s.streak = null }
  return s
}

/**
 * DOES THIS FURNACE QUALIFY (design 3.2, Codex r1/r2 P1, Claude r1 P2) -> { ok, why }. Pure over what the server sent:
 *   lit       the BLOCK STATE (mineflayer's furnace.fuel misses the open's data slots: Paper 10-07) -- an empty fuel slot can
 *             coexist with coal still burning, and the block reads lit=true then (MAT-HOT)
 *   input, fuel, output   the three slots at the open: null (empty) or { name, count }
 *   own       the output name this job may find (its own leftover: stone, glass or charcoal of an earlier session)
 * Cold, input empty, fuel EMPTY (mats-01 narrows the design's "empty or planks": a part-used plank stack of another
 * session's cannot be booked by name), output empty or this job's own. Anything else is a free skip: furnace_drain owns
 * foreign contents.
 */
export function furnaceQualifies ({ lit = null, input = null, fuel = null, output = null, own = null } = {}) {
  if (lit !== false) return { ok: false, why: lit === true ? 'lit' : 'lit_unknown' }
  if (input) return { ok: false, why: `input:${input.name}` }
  if (fuel) return { ok: false, why: `fuel:${fuel.name}` }
  if (output && output.name !== own) return { ok: false, why: `output:${output.name}` }
  return { ok: true, why: null }
}

/** How many of a smelt kind's batch to load with `msLeft` at the furnace: the whole batch, or the largest multiple of the
 *  next craft's unit (4 stone, 6 glass, 1 charcoal) the clock affords -- never one item the craft cannot use whole. Pure. */
export function batchFor (kind, msLeft, msPerItem = 10_000) {
  const k = KINDS[kind]
  if (!k?.smelt) return 0
  const unit = { stone: 4, glass: 6, charcoal: 1 }[k.smelt.out] ?? 1
  const byClock = Math.floor(Math.max(0, msLeft) / msPerItem)
  const n = Math.min(k.smelt.n, byClock)
  return n - (n % unit)
}
/** Planks to load for `n` items: n / 1.5, rounded UP (a short batch burns at most one part-used plank). Pure. */
export const planksToLoad = n => Math.ceil(n / SMELTS_PER_PLANK)

// ---- the carry note (design 3.2 recovery; the tidy-01 pattern) ----------------------------------------------------------

/** A note's fields, one place. `took` what came out of town, `fromBag` the bag's own share, `bag0` the opening bag of every
 *  name the order touches, `keep` what an interrupted order leaves under the note (1-3 stone: it never banks and closes). */
export function newNote ({ bot = null, kind, took = {}, fromBag = {}, bag0 = {}, at = 0, order = null } = {}) {
  return { v: MATS_V, bot, kind, took: { ...took }, fromBag: { ...fromBag }, bag0: { ...bag0 }, at, order, phase: 'open', keep: {} }
}
/** The names an order of `kind` touches (the note's bag0, the balance's families). */
export function touchedNames (kind, log = null) {
  const k = KINDS[kind]
  if (!k) return []
  const s = new Set([k.part])
  for (const n of Object.keys(k.inputs)) s.add(n === 'log' ? log : n)
  if (k.smelt) s.add(k.smelt.out)
  for (const c of k.crafts) s.add(c.out === 'planks' ? (log ? PLANKS_OF[log] : null) : c.out)
  // EVERY WOOD NAME for a kind that crafts planks: craft may make the sticks from another species' planks the bag holds, so
  // the wood family is booked over every log and plank name (and the stick), never one species alone
  if (k.crafts.some(c => c.out === 'planks')) { for (const n of [...LOG_NAMES, ...PLANK_NAMES]) s.add(n); s.add('stick') }
  s.delete(null)
  return [...s]
}

/**
 * THE RECOVERY PLAN -> { craftStone, bank: {name: n}, keep: {name: n}, close }. Pure over the note and the bag NOW.
 * The bag's count of each touched name above the note's bag0 is the order's: parts and unspent inputs are banked; stone
 * (bricks) is crafted in fours first; a 1-3 stone remainder is KEPT under the open note (consumed by the next bricks order,
 * which then smelts 12 minus it) -- never banked-and-closed, since stone's 64 town target may refuse it (Codex r2 P2).
 */
export function returnPlan (note, bag = {}) {
  if (!note?.kind || !KINDS[note.kind]) return { craftStone: 0, bank: {}, keep: {}, close: true }
  const above = n => Math.max(0, (Number(bag?.[n]) || 0) - (Number(note.bag0?.[n]) || 0))
  const bank = {}, keep = {}
  let craftStone = 0
  if (note.kind === 'bricks') {
    const st = above('stone')
    craftStone = st - (st % 4)
    if (st % 4) keep.stone = st % 4
  }
  for (const n of Object.keys(note.bag0 ?? {})) {
    if (n === 'stone') continue
    const extra = above(n) + (n === 'stone_bricks' ? craftStone : 0)
    if (extra > 0) bank[n] = extra
  }
  return { craftStone, bank, keep, close: !Object.keys(keep).length }
}

// ---- conservation (the read's defect gates, computed in the row and re-derived by the read) -----------------------------

/**
 * ONE ORDER'S BALANCE BY FAMILY -> { verdict, families: { fam: diff }, forbidden: {name: n}, fuel: {burned, expected} }. Pure.
 * Families (units 1:1 by recipe): stone family cobblestone = stone = stone_bricks; glass family sand = glass, 16 panes per 6;
 * copper family copper_ingot = 9 per copper_block = 9 per cut_copper (4:4), 2 per door; wood family log = 4 planks,
 * 2 planks = 4 sticks; light family (torch kind) charcoal = 4 torches, each torch also 1/4 stick.
 * IN = bag0 + withdrawn + prior (furnace output this job found and took); OUT = bag1 + deposited + furnaceLeft + consumed by
 * recipe/fuel. Rather than modelling every recipe, the row books, per touched name, the four boundary counts, and the
 * family conversion is done here.
 *   forbidden: any FORBIDDEN name the bag holds fewer of after the order than before (bag0 > bag1): a defect, never excused.
 */
export function familyUnits (kind, counts = {}) {
  const c = n => Number(counts?.[n]) || 0
  const logs = LOG_NAMES.reduce((t, n) => t + c(n), 0), planks = PLANK_NAMES.reduce((t, n) => t + c(n), 0)
  if (kind === 'bricks') return { stone: c('cobblestone') + c('stone') + c('stone_bricks'), wood: logs * 4 + planks }
  if (kind === 'panes') return { glass: (c('sand') + c('red_sand') + c('glass')) * 16 + c('glass_pane') * 6, wood: logs * 4 + planks }
  if (kind === 'cut_copper') return { copper: c('copper_ingot') + c('copper_block') * 9 + c('cut_copper') * 9 }
  if (kind === 'copper_door') return { copper: c('copper_ingot') + c('copper_door') * 2 }
  // torch: a torch embodies 1/4 stick (1/8 plank unit) and 1/4 charcoal; a charcoal is one log smelted (its 4 wood units
  // leave the wood family and 1 enters `light`, booked from `smelted` in matsBalance)
  if (kind === 'torch') return { wood: logs * 4 + planks + c('stick') / 2 + c('torch') / 8, light: c('charcoal') + c('torch') / 4 }
  return {}
}
export function matsBalance ({ kind, bag0 = {}, bag1 = {}, withdrawn = {}, deposited = {}, prior = {}, furnaceLeft = {}, burnedPlanks = 0,
                               smelted = 0, forbidden0 = {}, forbidden1 = {}, uncertain = false } = {}) {
  const sum = (...ms) => { const o = {}; for (const m of ms) for (const [k, v] of Object.entries(m ?? {})) o[k] = (o[k] ?? 0) + (Number(v) || 0); return o }
  const IN = familyUnits(kind, sum(bag0, withdrawn, prior)), OUT = familyUnits(kind, sum(bag1, deposited, furnaceLeft))
  const families = {}
  for (const f of new Set([...Object.keys(IN), ...Object.keys(OUT)])) families[f] = (OUT[f] ?? 0) - (IN[f] ?? 0)
  // what the recipes consume by design: the fuel planks burned; the torch kind's logs smelted into charcoal leave the wood
  // family (4 units per log) and enter the torch family as charcoal (4 torches per charcoal)
  if ('wood' in families) families.wood += burnedPlanks
  if (kind === 'torch') { families.wood += smelted * 4; families.light -= smelted }
  const forbidden = {}
  for (const [n, v] of Object.entries(forbidden0 ?? {})) { const d = (Number(v) || 0) - (Number(forbidden1?.[n]) || 0); if (d > 0) forbidden[n] = d }
  const expected = KINDS[kind]?.smelt ? planksToLoad(smelted) : 0
  // forbidden first (never excused), then a LOSS (a family short: items left the boundary unaccounted), then fuel over the
  // batch's planks; a GAIN (more than went in: an auto-pickup of a touched name on a walk) is reported, never a defect
  const lost = Object.values(families).some(d => d < -1e-9), gained = Object.values(families).some(d => d > 1e-9)
  const verdict = Object.keys(forbidden).length ? 'forbidden' : uncertain ? 'unreconciled' : lost ? 'loss' : burnedPlanks > expected ? 'overburn' : gained ? 'gain' : 'ok'
  return { verdict, families, forbidden, fuel: { burned: burnedPlanks, expected } }
}

/** The forbidden names' counts in a bag map (the gate's before/after). Pure. */
export function forbiddenCounts (bag = {}) {
  const o = {}
  for (const [n, v] of Object.entries(bag ?? {})) if (isForbidden(n) && v > 0) o[n] = v
  return o
}

// ---- rows ----------------------------------------------------------------------------------------------------------------

const v = x => (x == null ? '-' : String(x))
const kvs = m => Object.entries(m ?? {}).filter(([, n]) => n).map(([k, n]) => `${k}:${Math.round(n * 100) / 100}`).join(',') || '-'
/** The `_make_material` row's detail, one place, so the read parses ONE format (scripts/host/matsread.py). */
export function matsDetail (f = {}) {
  // THE GATES' FIELDS FIRST (the logger's cap may cut the tail, never these): verdict, made, forbidden, stone, note, took and the
  // job's own reading of the town stock (zeros kept: the read's reserve gate needs them), then the accounting
  const kv0 = m => Object.entries(m ?? {}).map(([k, n]) => `${k}:${Math.round(n * 100) / 100}`).join(',') || '-'
  return [`kind=${v(f.kind)}`, `stop=${v(f.stop)}`, `verdict=${v(f.verdict)}`, `made=${v(f.made)}`, `forbidden=${kvs(f.forbidden)}`,
    `stone=${v(f.stone)}`, `note=${v(f.note)}`, `took=${kvs(f.took)}`, `stock=${kv0(f.stock)}`, `reserve=${v(f.reserveSrc)}`,
    `part=${v(f.part)}`, `log=${v(f.log)}`, `bag=${kvs(f.fromBag)}`, `smelted=${v(f.smelted)}`, `planks=${v(f.burned)}/${v(f.expected)}`,
    `dep=${kvs(f.deposited)}`, `prior=${kvs(f.prior)}`, `left=${kvs(f.furnaceLeft)}`, `fam=${kvs(f.families)}`,
    `kept_lost=${v(f.keptLost)}`, `furnace=${v(f.furnace)}`, `lease=${v(f.lease)}`, `t0=${v(f.t0)}`].join(' ')
}
/** The `_mats_mode` licence row (once per spawn): a kind the baseline cannot write. */
export function matsModeDetail ({ on = true, why = null, reserve = matsReserve(), buffers = matsBuffers() } = {}) {
  return `phase=mode v=${MATS_V} on=${on ? 1 : 0}${why ? ` why=${String(why).replace(/\s+/g, '_')}` : ''} kinds=${KIND_ORDER.join(',')} ` +
    `reserve=${Object.entries(reserve.table).map(([k, n]) => `${k}:${n}`).join(',')} reserve_src=${reserve.src} ` +
    `buffers=${Object.entries(buffers.table).map(([k, n]) => `${k}:${n}`).join(',')} buffers_src=${buffers.src} fuel=planks coverage=${MATS_MIN_COVERAGE}`
}
/** The part names a project may later count: every buffered part is one (a structural test asserts it). */
export const BUFFERED_PARTS = Object.freeze(Object.keys(MATS_BUFFERS_DEFAULT))
export const PARTS_SET = new Set(PROJECT_PARTS)
