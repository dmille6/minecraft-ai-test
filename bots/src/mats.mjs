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
/** THE WOOD FAMILY'S NAMES FOR ACCOUNTING (Codex r1 P2-12): every log, stem and plank a stick or plank recipe accepts in 1.21
 *  (bamboo, crimson and warped too), so a craft that picks another species is still booked. Inputs stay LOG_NAMES. */
export const ACCT_LOGS = Object.freeze([...LOG_NAMES, 'crimson_stem', 'warped_stem'])
export const ACCT_PLANKS = Object.freeze([...PLANK_NAMES, 'bamboo_planks', 'crimson_planks', 'warped_planks'])

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
/** THE BALANCE'S GATE SET (Claude r1 P2): the iron ladder and the fuels by name. A TOOL is never an input either (above), but a
 *  tool can break on the order's own walk or a lid dig -- a pickaxe wearing out is not the job burning the kit -- so tools are
 *  booked apart (tools_lost, reported) and never read as a forbidden input. */
export const GATED_RE = /^(raw_iron|iron_ingot|iron_nugget|iron_ore|deepslate_iron_ore|coal|charcoal|coal_block)$/
export const isGated = n => typeof n === 'string' && GATED_RE.test(n)

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
 *   unknown      lazy -> how many town containers the index does not KNOW (never opened, stale or dirty) a recount can reach
 *                (skills.mjs matsRecountKeys): below the coverage the order RECOUNTS them (kind `count`) instead of skipping
 */
export function materialOrder ({ now = 0, on = true, shared = true, atTown = false, holds = false, noteOpen = false, freeSlots = 0,
                                 bagSpare = {}, town = null, furnace = () => true, table = () => true, lease = () => true, unknown = () => 0, bankRoom = () => true,
                                 bodyMs = 0, reserve = BUILD_RESERVE, partReserve = null, buffers = MATS_BUFFERS_DEFAULT, state = {} } = {}) {
  const s = { ...state }
  const no = (skip, more = {}) => ({ order: null, kind: null, state: s, skip, ...more })
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
  // THE REMEDY IS PERFORMED, NOT PRINTED (CLAUDE.md): a town container the index does not KNOW (never opened, stale or dirty:
  // Codex r1 P2-9) that a recount can reach is recounted FIRST, AT ANY COVERAGE (Codex r2 P2-5: at 80% the unknown fifth may
  // hold the buffer's parts) -- count_town's own reconciliation, at most three a visit. With none left in reach (each one
  // that could not be opened sits out its 10 min backoff), the order needs the coverage floor; the parts in a container no
  // recount can open are the buffer's one residual (named in the registration).
  const u = Number(lazy(unknown)) || 0
  if (u > 0) return { order: { skill: 'make_material', args: { item: 'count' }, why: `the town index does not know ${u} of the town's containers in reach (it knows ${Math.round(t.coverage * 100)}%): recount them first (town materials job)` }, kind: 'count', state: s, skip: null }
  if (!(t.coverage >= MATS_MIN_COVERAGE)) return no('index_coverage', { coverage: t.coverage })
  // NO ROOM IN TOWN, NO ORDER: a part made with nowhere in town to bank it would sit in a bag until its note was given up
  if (!lazy(bankRoom)) return no('town_full', { coverage: t.coverage })
  const reasons = []
  for (const kind of KIND_ORDER) {
    const k = KINDS[kind]
    const why = r => reasons.push(`${kind}:${r}`)
    // HEADROOM (Codex r1 P2-10): an order runs only when its WHOLE batch fits under the buffer -- the buffer is a hard cap
    const short = (Number(buffers?.[k.part]) || 0) - partCount(k.part, t.stock)
    if (short < k.makes) { why('stocked'); continue }
    if (freeSlots < k.slots) { why('room'); continue }
    // the project reserve (OWNER 10-27): a project part's inputs are judged on the lowered table when the caller passes one
    const inp = orderInputs(kind, { bagSpare, stock: t.stock, reserve: (partReserve && matsKindForProject(kind)) ? partReserve : reserve })
    if (!inp) { why('inputs'); continue }
    if (k.smelt && !lazy(furnace)) { why('no_furnace'); continue }
    if (k.table && !lazy(table)) { why('no_table'); continue }
    if (!lazy(lease)) return no('lease_busy', { coverage: t.coverage, kinds: reasons.join(',') })
    return {
      // the kind travels as `item` (an arg the skill grammar already has: args-sayable.test)
      order: { skill: 'make_material', args: { item: kind },
               why: `the town holds ${partCount(k.part, t.stock)} ${k.part}, below its buffer of ${buffers[k.part]}, and has the inputs above its reserve: make ${k.makes} (town materials job)` },
      kind, state: s, skip: null, inputs: inp,
    }
  }
  // the most informative reason a part was not made (the read's denominator): inputs > no_furnace > no_table > room > stocked;
  // every kind's own reason travels too (`kinds`: Claude r2 P2-A -- a town with no sand says `inputs` while bricks lacked a
  // furnace), with the coverage the reading had
  const more = { coverage: t.coverage, kinds: reasons.join(',') }
  for (const r of ['inputs', 'no_furnace', 'no_table', 'room']) if (reasons.some(x => x.endsWith(`:${r}`))) return no(r, more)
  return no('stocked', more)
}

/** THE RECOVERY ORDER (mats_return, design 3.2): an open carry note at town runs FIRST, before any other town order. */
export function returnOrder ({ on = true, atTown = false, noteOpen = false, now = 0, waitUntil = 0, state = {} } = {}) {
  const s = { ...state }
  if (!on || !atTown || !noteOpen) return { order: null, state: s, skip: !noteOpen ? 'no_note' : !atTown ? 'away' : 'off' }
  // A WAITING RECOVERY YIELDS (Codex r4 P1): after a wait (the furnace lit or leased, a bag without room) the note says when to
  // look again, and until then every other town order has the decision -- the town deposit that makes room among them
  if (now < (Number(waitUntil) || 0)) return { order: null, state: s, skip: 'waiting' }
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
 *  name the order touches, `furnace` and `loaded` what the session put in (written BEFORE the furnace is loaded, so a kill
 *  mid-session leaves a record mats_return can drain against), `tries` the recovery attempts so far. */
export function newNote ({ bot = null, kind, took = {}, fromBag = {}, bag0 = {}, at = 0, order = null } = {}) {
  return { v: MATS_V, bot, kind, took: { ...took }, fromBag: { ...fromBag }, bag0: { ...bag0 }, at, order, phase: 'open', furnace: null, loaded: null, tries: 0,
    sticks: 0, deposited: {} }
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
  // the wood family is booked over every log, stem, plank name and the stick (Codex r1 P2-12)
  if (k.crafts.some(c => c.out === 'planks')) { for (const n of [...ACCT_LOGS, ...ACCT_PLANKS]) s.add(n); s.add('stick') }
  s.delete(null)
  return [...s]
}
/** The order's OBLIGATIONS -- what it must not leave in a bag: its part, and the intermediate it made (stone is crafted in
 *  fours, glass is a part itself, charcoal becomes torches). Unspent INPUTS (cobble, logs, sand, ingots, planks, sticks) are
 *  ordinary bag items once the order ends: the town deposit and the ordinary flows bank them, and the row books them
 *  (inputs_left), never an obligation that could hold a note open (Codex r1 P1-2). */
export function obligations (kind) {
  const k = KINDS[kind]
  if (!k) return []
  // cut_copper's copper_block is its intermediate (Codex r3 P2-6: a cut between the two crafts left four blocks unowed)
  return [...new Set([k.part, ...(k.smelt ? [k.smelt.out] : []), ...(kind === 'panes' ? ['glass'] : []), ...(kind === 'cut_copper' ? ['copper_block'] : [])])]
}

/**
 * THE RECOVERY PLAN -> { craftStone, torches, panes, bank: {name: n}, stoneLeft, charcoalLeft, inputsLeft: {name: n} }. Pure over
 * the note and the bag NOW. A count above the note's bag0 is the order's ONLY UP TO WHAT THE NOTE RECORDS (Claude r2 P2-D: bag0
 * goes stale -- charcoal or sticks the bot gets later for its own ladder are never the order's):
 *   the intermediate (stone, glass, charcoal)  at most the batch the furnace was loaded with (note.loaded.input.n; none loaded: 0)
 *   sticks                                     at most the sticks the order crafted (note.sticks)
 *   the part                                   at most the kind's batch (KINDS.makes), with what this plan crafts
 *   craftStone   stone in fours into bricks (a 1-3 remainder is ORDINARY stone afterwards, reported: stoneLeft)
 *   torches      the order's charcoal x the order's sticks; charcoal with no stick to make it a torch is charcoalLeft -- an
 *                OBLIGATION (Codex r2 P2-8: the owner's "charcoal for torches only"): it holds the note open, never banked
 *   panes        the order's glass in sixes
 *   bank         the part (and glass) above bag0, capped, after the crafts
 *   inputsLeft   unspent inputs above bag0 (booked, never an obligation)
 */
export function returnPlan (note, bag = {}) {
  const empty = { craftStone: 0, torches: 0, panes: 0, cutCopper: 0, bank: {}, stoneLeft: 0, charcoalLeft: 0, sticksShort: 0, stickWood: null, inputsLeft: {} }
  if (!note?.kind || !KINDS[note.kind]) return empty
  const k = KINDS[note.kind]
  const above = n => Math.max(0, (Number(bag?.[n]) || 0) - (Number(note.bag0?.[n]) || 0))
  const batch = k.smelt ? Math.max(0, Number(note.loaded?.input?.n) || 0) : 0
  const out = { ...empty, bank: {}, inputsLeft: {} }
  const mid = k.smelt ? Math.min(above(k.smelt.out), batch) : 0
  if (note.kind === 'bricks') { out.craftStone = mid - (mid % 4); out.stoneLeft = mid % 4 }
  if (note.kind === 'torch') {
    out.torches = Math.min(mid, above('stick'), Math.max(0, Number(note.sticks) || 0))
    out.charcoalLeft = mid - out.torches
    // THE REMEDY FOR CHARCOAL WITH NO STICK OF THE ORDER'S (Codex r3 P2-5, Claude r3 P3-1): the recovery makes the sticks from WOOD
    // ABOVE bag0 (the order's own planks first, else its own log) -- never the kit's sticks or planks (below bag0)
    if (out.charcoalLeft > 0) {
      // the new sticks first refill the bag's own deficit below bag0 (Claude r4 P3-3), then make the torches
      out.sticksShort = out.charcoalLeft + Math.max(0, (Number(note.bag0?.stick) || 0) - (Number(bag?.stick) || 0))
      // a species whose SURPLUS funds every craft (2 planks -> 4 sticks), else the most surplus one, crafts capped by it; else a log
      // of the order's (4 planks, 2 crafts) -- never a plank below bag0 (Codex r4 P3)
      const crafts = Math.ceil(out.sticksShort / 4)
      const pls = ACCT_PLANKS.filter(n => above(n) >= 2).sort((a, b) => above(b) - above(a))
      const full = pls.find(n => above(n) >= 2 * crafts), lg = LOG_NAMES.find(n => above(n) >= 1)
      const partial = pls.length ? { planks: pls[0], crafts: Math.min(crafts, Math.floor(above(pls[0]) / 2)) } : null
      const logW = lg ? { log: lg, planks: PLANKS_OF[lg], crafts: Math.min(crafts, 2) } : null
      // whichever funds MORE of the crafts (Claude r5 P3-6); a tie keeps the planks (no log spent)
      out.stickWood = full ? { planks: full, crafts } : (partial && (!logW || partial.crafts >= logW.crafts)) ? partial : logW
    }
  }
  if (note.kind === 'cut_copper') { const bl = Math.min(above('copper_block'), 4); out.cutCopper = bl >= 4 ? 4 : 0; if (bl - out.cutCopper > 0) out.bank.copper_block = bl - out.cutCopper }
  if (note.kind === 'panes') out.panes = Math.floor(mid / 6)
  const made = { stone_bricks: out.craftStone, torch: out.torches * 4, glass_pane: out.panes * 16, cut_copper: out.cutCopper }
  const partCap = k.makes
  const p = Math.min(partCap, above(k.part) + (made[k.part] ?? 0))
  if (p > 0) out.bank[k.part] = p
  if (note.kind === 'panes') { const g = mid - out.panes * 6; if (g > 0) out.bank.glass = g }
  for (const n of Object.keys(note.bag0 ?? {})) {
    if (obligations(note.kind).includes(n)) continue
    const extra = above(n) - (n === 'stick' ? out.torches : 0)
    if (extra > 0) out.inputsLeft[n] = extra
  }
  return out
}
/** May the note close? -> true when nothing the order owes is left: no part or intermediate of the order's in the bag (beyond a
 *  stone remainder < 4, reported), no charcoal of the order's still to become torches, and no recorded furnace to drain. */
export function noteSettled (note, bag = {}, { furnaceDone = true } = {}) {
  if (!note) return true
  if (note.furnace && !furnaceDone) return false
  const p = returnPlan(note, bag)
  return p.craftStone === 0 && p.torches === 0 && p.panes === 0 && p.cutCopper === 0 && p.charcoalLeft === 0 && !Object.keys(p.bank).length
}
/**
 * THE RECOVERY'S BALANCE (Codex r2 P1-4: a closing recovery must prove reconciliation, not absence) -> { verdict, batch, out,
 * back, short }. Pure. For a smelt kind whose furnace was loaded: the batch's n input became output units -- the intermediate
 * in the bag (capped by the batch), the part in the bag, banked by this recovery or deposited by the order before it stopped
 * (in output units: a brick = 1 stone, 16 panes = 6 glass, 4 torches = 1 charcoal) -- or came back as input (the bag's input
 * over its count right after the load, note.loaded.inputAfter). short = batch - out - back > 0 is a LOSS (noted stone spent
 * on the way back, a stack dropped). A kind with no furnace, or a note never loaded, has nothing in flight: ok. RESIDUAL
 * (named): input the bot gains on the way (cobble mined) can hide a shortfall up to that gain -- `back` is reported.
 */
export function recoveryBalance (note, { bag = {}, banked = {}, placed = {} } = {}) {
  const k = KINDS[note?.kind]
  if (k && !k.smelt) return copperBalance(note, { bag, banked })
  const n = Math.max(0, Number(note?.loaded?.input?.n) || 0)
  if (!k?.smelt || !n) return { verdict: 'ok', batch: 0, out: 0, back: 0, short: 0 }
  const above = x => Math.max(0, (Number(bag?.[x]) || 0) - (Number(note.bag0?.[x]) || 0))
  const per = { stone_bricks: 1, glass_pane: 6 / 16, torch: 1 / 4 }[k.part] ?? 1
  const dep = Number(note.deposited?.[k.part]) || 0, depMid = Number(note.deposited?.[k.smelt.out]) || 0
  const partUnits = (Math.min(k.makes, above(k.part)) + (Number(banked?.[k.part]) || 0) + dep) * per
  const midUnits = Math.min(n, above(k.smelt.out)) + (Number(banked?.[k.smelt.out]) || 0) + depMid
  const out = Math.min(n, midUnits + partUnits)
  const inName = note.loaded.input.name
  // the bag's input after the load; a kill between the first record and the load has only inputBefore (the bag before it):
  // its "after" is inputBefore - n (Codex r4 P2-4), so input never loaded counts as back, not lost
  const after = Number.isFinite(Number(note.loaded.inputAfter)) && note.loaded.inputAfter != null ? Number(note.loaded.inputAfter)
    : Number.isFinite(Number(note.loaded.inputBefore)) && note.loaded.inputBefore != null ? Number(note.loaded.inputBefore) - n : NaN
  // input the recovery itself placed as scaffold came back first (Claude r4 P3-2 B: counted by countPlacements)
  // INPUT ONCE SEEN BACK STAYS BACK (Codex r6 P2): an ordinary deposit between attempts banks what came back without the note
  // knowing -- note.backSeen keeps the most any attempt saw
  const backNow = Number.isFinite(after) ? Math.max(0, (Number(bag?.[inName]) || 0) + (Number(placed?.[inName]) || 0) - after) : 0
  const back = Math.min(n - out, Math.max(backNow, Number(note.backSeen) || 0))
  const short = Math.max(0, Math.round((n - out - back) * 100) / 100)
  return { verdict: short > 1e-9 ? 'loss' : 'ok', batch: n, out: Math.round(out * 100) / 100, back, short }
}
/** How long a recovery that WAITED yields before it looks again (Codex r4 P1), BY WHY: a furnace still burning or leased by a
 *  dead process needs only the burn and the lease TTL to run out (90 s, Paper r5 kill: a flat 3 min outlasted the scene); a bag
 *  without room or an unloaded chunk needs the town deposit or a trip, so it yields longer (3 min). */
export const MATS_RETURN_WAIT_MS = 3 * 60 * 1000
export const matsReturnWaitMs = drained => (/^(lit|busy|unreadable_or_lit)$/.test(String(drained)) ? 90_000 : MATS_RETURN_WAIT_MS)
/** Recovery attempts before a note is given up as ABANDONED (reported, never silently: the read counts them). */
export const MATS_RETURN_MAX = 6
export const MATS_RETURN_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * WHAT A RECOVERY MAY DRAIN (Codex r1 P1-5) -> { ok, why }. Pure over the furnace's three slots at the open and the note's
 * `loaded` record { input: { name, n }, fuel: { name, n }, out, prior }: only the order's own input (at most what it put in),
 * its own fuel (at most what it put in) and its own output (at most the input put in plus the prior it took back). Anything
 * else -- another name, more than the order loaded -- is another session's, and furnace_drain's.
 */
export function recoveryContentsOk (loaded, { input = null, fuel = null, output = null } = {}) {
  if (!loaded?.input?.name || !loaded?.fuel?.name) return { ok: false, why: 'no_load_record' }
  if (input && (input.name !== loaded.input.name || input.count > loaded.input.n)) return { ok: false, why: `input:${input.name}` }
  if (fuel && (fuel.name !== loaded.fuel.name || fuel.count > loaded.fuel.n)) return { ok: false, why: `fuel:${fuel.name}` }
  if (output && (output.name !== loaded.out || output.count > loaded.input.n)) return { ok: false, why: `output:${output.name}` }
  return { ok: true, why: null }
}

/** THE RECOVERY'S VERDICT -> the balance's, except a loss of the WHOLE batch with nothing of it anywhere after the furnace was
 *  found EMPTY: another bot's furnace_drain may have taken the burnt batch into town while this one waited (Claude r4 P3-2 A) --
 *  or it was lost (Codex r5 P2-2). An empty furnace proves neither, so it is UNRECONCILED: visible, counted toward the read's
 *  unreconciled share (blocks KEEP above 5%), never the G2 REVERT. Part of the batch found is still judged. Pure. */
export function recoveryVerdict (bal, drained, kind = null) {
  if (!bal) return null
  // a copper kind has no furnace to find empty: once crafting began, NOTHING of it anywhere is the same ambiguity -- a deposit the
  // job cannot see (the town deposit at 34+, the model's own) or a loss (Claude r6 P3-1)
  const nowhere = bal.verdict === 'loss' && bal.out === 0 && bal.back === 0
  if (nowhere && (drained === 'empty' || (KINDS[kind] && !KINDS[kind].smelt))) return 'unreconciled'
  return bal.verdict
}
/**
 * THE COPPER KINDS' RECOVERY BALANCE (Codex r3 P2-6) -> as recoveryBalance. The ingots the order took (town and bag) are in
 * copper units: still ingots above bag0 (capped by the batch), blocks (9), cut copper (9) or doors (2), in the bag, banked now
 * or deposited by the order or an earlier attempt. short > 0 is a LOSS. RESIDUAL (named): ingots the bot gains on the way
 * (the town smelt job's) can hide a shortfall up to that gain.
 */
export function copperBalance (note, { bag = {}, banked = {} } = {}) {
  const n = (Number(note?.took?.copper_ingot) || 0) + (Number(note?.fromBag?.copper_ingot) || 0)
  if (!n) return { verdict: 'ok', batch: 0, out: 0, back: 0, short: 0 }
  const above = x => Math.max(0, (Number(bag?.[x]) || 0) - (Number(note.bag0?.[x]) || 0))
  const got = x => above(x) + (Number(banked?.[x]) || 0) + (Number(note.deposited?.[x]) || 0)
  const parts = note.kind === 'cut_copper' ? 9 * (Math.min(4, got('copper_block')) + Math.min(4, got('cut_copper'))) : 2 * Math.min(3, got('copper_door'))
  const out = Math.min(n, parts)
  // NEVER CRAFTED, BY THE NOTE'S OWN WRITE-AHEAD (Codex r5 P2-1): note.crafting is written before the first copper craft, so a note
  // without it holds only inputs -- the ingots are inputs wherever they went (a deposit between attempts). Once crafting began,
  // the retained ingots are back and the rest must be parts: a craft is interruptible, so one block of four is 9 + 27 back.
  if (!note.crafting) return { verdict: 'ok', batch: n, out, back: Math.min(n - out, above('copper_ingot')), short: 0 }
  // the retained ingots once seen stay back (Codex r6 P2: a town deposit between attempts banks them, the note never hears)
  const back = Math.min(n - out, Math.max(above('copper_ingot'), Number(note.backSeen) || 0))
  const short = Math.max(0, n - out - back)
  return { verdict: short > 0 ? 'loss' : 'ok', batch: n, out, back, short }
}

/** MAY THIS ATTEMPT RECORD INPUT AS BACK (note.backSeen)? -> true when its drain TOUCHED the furnace or there is none. Pure
 *  (Claude r9 P3-2: the decision extracted, not pinned by a source regex). An untouched wait (lit, busy, unloaded, bag_full,
 *  unreadable_or_lit, window, unreachable) still has the loaded input inside, so anything "back" then is input gathered meanwhile
 *  (Claude r7 P3-1); a PARTIAL drain (drained:N, output stuck) did return input (Codex r8 P2); an empty furnace or one that is GONE
 *  holds nothing of the batch any more (Claude r9 P3-1: gone, as r8 had it). */
export function backSeenTouched (note, drained) {
  if (!note?.furnace) return true
  return /^(drained:\d+|empty|gone)$/.test(String(drained ?? ''))
}

/** THE RECOUNT'S OWN BACKOFF (Claude r3 P2-3): a container that could not be counted sits out its backoff -- the order's trigger
 *  must not see it, or a town with one unreachable container is all `count` orders. Pure: keys, a Map k -> { until }, now. */
export function matsRecountable (keys = [], failed = new Map(), now = Date.now(), keyOf = k => k) {
  return keys.filter(k => !((failed?.get?.(keyOf(k))?.until ?? 0) > now))
}

/**
 * THE RESERVE AT THE TAKE (Codex r1 P1-1) -> how many of `name` this visit may take. Pure. `others` = the town's indexed stock
 * in every OTHER known container (the visited one excluded: its index entry is stale the moment anyone takes from it);
 * `here` = what the server shows in the visited container now. The reserve is judged on others + here, so a withdrawal by
 * another bot since the order's reading is seen, never spent through.
 */
export function takeAllowed (name, want, { others = {}, here = {}, reserve = BUILD_RESERVE, taking = {} } = {}) {
  const rk = reserveKeyOf(name)
  if (!rk) return 0
  const sum = {}
  for (const m of [others, here]) for (const [n, c] of Object.entries(m ?? {})) sum[n] = (sum[n] ?? 0) + (Number(c) || 0)
  // THE OUTSTANDING DRAWS (Codex r2 P1-3; design 3.3 "claims subtracted"): every other bot's withdraw records a confirmed DRAW
  // claim in the town's stock journal before its clicks; until its post-transfer count releases it, that stock is already on
  // its way out of the containers this reading counts
  const out = Math.max(0, Number(taking?.[rk]) || 0)
  return Math.max(0, Math.min(Number(want) || 0, Number(here?.[name]) || 0, spendable(rk, sum, reserve) - out))
}

/**
 * THE RECIPE THAT USES ONLY WHAT IT MAY (Codex r1 P2-12; Q3) -> the first recipe whose every ingredient is in `allowed` and
 * that consumes `must` (when given). Pure over prismarine-recipe objects ({ delta: [{ id, count }] }, negative = consumed)
 * and a registry name lookup. The sticks come from the order's own planks; the torch from charcoal and a stick, never coal.
 */
export function recipeUsing (recipes = [], nameOf = () => null, { allowed = [], must = null } = {}) {
  const ok = new Set(allowed)
  for (const r of recipes ?? []) {
    const used = (r?.delta ?? []).filter(d => d.count < 0).map(d => nameOf(d.id))
    if (!used.length || used.some(n => !ok.has(n))) continue
    if (must && !used.includes(must)) continue
    return r
  }
  return null
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
  const logs = ACCT_LOGS.reduce((t, n) => t + c(n), 0), planks = ACCT_PLANKS.reduce((t, n) => t + c(n), 0)
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
                               smelted = 0, forbidden0 = {}, forbidden1 = {}, uncertain = false, cut = false, placed = {} } = {}) {
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
  // A SESSION CUT BY THE CLOCK holds one freshly lit plank whatever it smelted (Claude r2 P2-B): one plank over is the clock's
  const expected = KINDS[kind]?.smelt ? planksToLoad(smelted) + (cut ? 1 : 0) : 0
  // THE ORDER'S OWN PLACEMENTS (Claude r2 P2-C, design 3.2): cobble, logs and planks are pathfinder scaffold on the order's
  // walks; what the bag counted placed (skills.mjs countPlacements) explains a shortfall -- SCAFFOLD, a reported loss, never
  // the defect gate. A shortfall beyond them is a LOSS.
  const pu = familyUnits(kind, placed)
  const lostRaw = Object.values(families).some(d => d < -1e-9)
  const lost = Object.entries(families).some(([f, d]) => d + (pu[f] ?? 0) < -1e-9), gained = Object.values(families).some(d => d > 1e-9)
  // forbidden first (never excused), then a LOSS (a family short beyond the placements: items left the boundary unaccounted),
  // then scaffold, then fuel over the batch's planks; a GAIN (an auto-pickup of a touched name on a walk) is reported
  const verdict = Object.keys(forbidden).length ? 'forbidden' : uncertain ? 'unreconciled' : lost ? 'loss' : lostRaw ? 'scaffold'
    : burnedPlanks > expected ? 'overburn' : gained ? 'gain' : 'ok'
  return { verdict, families, forbidden, fuel: { burned: burnedPlanks, expected } }
}

/** The forbidden names' counts in a bag map (the gate's before/after). Pure. */
export function forbiddenCounts (bag = {}) {
  const o = {}
  for (const [n, v] of Object.entries(bag ?? {})) if (isGated(n) && v > 0) o[n] = v
  return o
}
/** The bag's tools (FORBIDDEN, not gated) by name: booked before and after, the loss reported as tools_lost. Pure. */
export function toolCounts (bag = {}) {
  const o = {}
  for (const [n, v] of Object.entries(bag ?? {})) if (isForbidden(n) && !isGated(n) && v > 0) o[n] = v
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
  // stock= BEFORE took= and stop= (Claude r1 P1-3: a long stop pushed stock= past the 300-char cut, mid-number)
  // smelted= right after made= (Codex r2 P2-7: at the tail a long stock= pushed it to the 300-char cut, and the read's instrument
  // treated a cut smelted= as zero)
  return [`kind=${v(f.kind)}`, `verdict=${v(f.verdict)}`, `made=${v(f.made)}`, `smelted=${v(f.smelted)}`, `forbidden=${kvs(f.forbidden)}`,
    `stone=${v(f.stone)}`, `note=${v(f.note)}`, `ml=${v(f.ml)}`, `stock=${kv0(f.stock)}`, `took=${kvs(f.took)}`, `reserve=${v(f.reserveSrc)}`,
    `stop=${v(String(f.stop ?? '-').slice(0, 60))}`, `inputs_left=${kvs(f.inputsLeft)}`, `tools_lost=${kvs(f.toolsLost)}`,
    `part=${v(f.part)}`, `log=${v(f.log)}`, `bag=${kvs(f.fromBag)}`, `planks=${v(f.burned)}/${v(f.expected)}${f.cut ? '+cut' : ''}`, `placed=${kvs(f.placed)}`,
    `dep=${kvs(f.deposited)}`, `prior=${kvs(f.prior)}`, `left=${kvs(f.furnaceLeft)}`, `fam=${kvs(f.families)}`,
    `stone_left=${v(f.stoneLeft)}`, `furnace=${v(f.furnace)}`, `lease=${v(f.lease)}`, `t0=${v(f.t0)}`].join(' ')
}
/** The `_mats_mode` licence row (once per spawn): a kind the baseline cannot write. */
export function matsModeDetail ({ on = true, why = null, reserve = matsReserve(), buffers = matsBuffers() } = {}) {
  return `phase=mode v=${MATS_V} on=${on ? 1 : 0}${why ? ` why=${String(why).replace(/\s+/g, '_')}` : ''} kinds=${KIND_ORDER.join(',')} ` +
    `reserve=${Object.entries(reserve.table).map(([k, n]) => `${k}:${n}`).join(',')} reserve_src=${reserve.src} ` +
    `buffers=${Object.entries(buffers.table).map(([k, n]) => `${k}:${n}`).join(',')} buffers_src=${buffers.src} fuel=planks coverage=${MATS_MIN_COVERAGE} project_reserve=${projectReserveOn() ? 1 : 0}`
}
/** The part names a project may later count: every buffered part is one (a structural test asserts it). */
export const BUFFERED_PARTS = Object.freeze(Object.keys(MATS_BUFFERS_DEFAULT))
export const PARTS_SET = new Set(PROJECT_PARTS)

// ---- the project reserve (OWNER DECISION 2026-10-27) -------------------------------------------------------------------------
// "if there is a building in process of being built the bots can use up to 80% of the reserves in chests, once the building
// project is complete the reserves go back to 100%". Applied ONLY to draws for project work (mats-01 making a PROJECT_PARTS
// part, the workshop's withdrawals); tool crafts, kits, smelting jobs and deposits keep the full table.
export const PROJECT_RESERVE_KEEP = 0.2                     // the floor kept while a project is active: 20% (80% spendable)
export const PROJECT_STALL_MS = 24 * 60 * 60_000            // no placement for this long: the project stops counting as active
/** The kill switch: RESERVE_PROJECT=0|off|false|no -> off. Default on. */
export function projectReserveOn (env = process.env) {
  return !['0', 'off', 'false', 'no'].includes(String(env?.RESERVE_PROJECT ?? '').trim().toLowerCase())
}
/**
 * IS A PROJECT ACTIVE FOR THE RESERVE? -> { active, why }. Pure. why: off | no_project | complete | no_clock | stalled | active.
 * `progressAt`: the last placement on the project (or when this mode was first seen, so a project stalled for want of the very
 * materials the lowered floor frees gets one window), ms. A project with no progress for `stallMs` is not active.
 */
export function projectReserveState ({ on = true, exists = false, complete = false, progressAt = null, now = Date.now(), stallMs = PROJECT_STALL_MS } = {}) {
  if (!on) return { active: false, why: 'off' }
  if (!exists) return { active: false, why: 'no_project' }
  if (complete) return { active: false, why: 'complete' }
  if (!Number.isFinite(Number(progressAt)) || progressAt === null) return { active: false, why: 'no_clock' }
  if (now - Number(progressAt) >= stallMs) return { active: false, why: 'stalled' }
  return { active: true, why: 'active' }
}
/** One family's floor while a project is active: 20% of the normal one, rounded up. Pure. */
export const projectFloor = n => Math.ceil((Math.max(0, Number(n) || 0)) * PROJECT_RESERVE_KEEP)
/**
 * THE EFFECTIVE RESERVE -> { table, lowered }. Pure. Lowered only when the project is active AND the draw is project work;
 * any other draw gets the full table back unchanged.
 */
export function effectiveReserve (reserve = BUILD_RESERVE, { active = false, forProject = false } = {}) {
  if (!active || !forProject) return { table: { ...reserve }, lowered: false }
  return { table: Object.fromEntries(Object.entries(reserve).map(([k, v]) => [k, projectFloor(v)])), lowered: true }
}
/** Is a mats kind project work? Its part is a PROJECT_PARTS part (bricks, panes, cut copper, doors; torches are not). */
export const matsKindForProject = kind => !!KINDS[kind] && PARTS_SET.has(KINDS[kind].part)
/** The rows: `_reserve_mode` on a change of mode, `_reserve_draw` for every reserved-family take under the lowered floor. */
export const reserveModeDetail = ({ active, why, gen = '-', progressAt = null, now = Date.now() }) =>
  `phase=mode active=${active ? 1 : 0} why=${why} gen=${gen} idle_min=${Number.isFinite(Number(progressAt)) && progressAt !== null ? Math.round((now - progressAt) / 60_000) : '-'} keep=${PROJECT_RESERVE_KEEP}`
export const reserveDrawDetail = ({ by, name, n, family, normal, effective, gen = '-', unconfirmed = null }) =>
  `phase=draw by=${by} name=${name} n=${n} family=${family} floor_normal=${normal} floor_effective=${effective} gen=${gen}` +
  (unconfirmed ? ` unconfirmed=${unconfirmed}` : '')
