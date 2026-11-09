// Admission layer -- ADR-0002.
//
// A deterministic gate between the model and the runner. Even schema-valid
// output is checked here before anything executes.
//
// This is what makes the model ADVISORY rather than authoritative, and it is
// the cleanest expression of "reliability before intelligence" in the design.
// Every rejection carries a reason code, which turns the useless observation
// "the model is unreliable" into a distribution over specific, fixable causes
// you can query in Kibana.

import { cooldownHit, KEEPOUT_COOLDOWN_MS, KEEPOUT_COOLDOWN_NEAR } from './keepout.mjs'
import { gatherMemOn, areaRefusal, areaRefusalDetail } from './gathermem.mjs'
import { SKILLS, actionKey, foodSkipNow, stockRefusedRow, craftableFromBag } from './skills.mjs'
import { swordCraftRefusal, unwantedSword } from './peacefulkit.mjs'
import { smeltRecipeFor } from './smelting.mjs'
import { config } from './config.mjs'
import { horizontalDistanceFromSpawn } from './state.mjs'
import { shoreRoute } from './shore.mjs'
import { bankableInventory, depositPlan, depositNoopReason, bankableExclusion, cobbleReconcileProbe, DEPOSIT_ALWAYS } from './bankable.mjs'
import { depositVerdict, onDepositRung } from './depositoffer.mjs'
import { bankClosed, bankClosedDetail, depositTargetOk, inTown } from './chestfull.mjs'
import { resolveBlockName } from './drops.mjs'
import { mineTargetOk, mineTargetCeiling } from './mining.mjs'
import { redundantCraft } from './toolhygiene.mjs'
import { swingRewrite } from './pickswings.mjs'   // ironchain-02: an iron pickaxe asked for swings, with no iron, is a stone one
import { repeatWorkConfig, repeatDecision, ledgerSet, PROGRESS_SKILLS, tallyLine as repeatWorkTallyLine, TALLY_MS as REPEAT_WORK_TALLY_MS } from './repeatwork.mjs'
import { logEvent } from './logger.mjs'
import { townLogCapState, townLogTop, logGateOn, isLogBlock, bagWoodUnits, logGatherGate, logGateDetail, LOGGATE_RUNG_LOGS } from './logcap.mjs'   // loggate-01
import { WOOD_KEEP } from './woodkeep.mjs'
import { snapshot } from './state.mjs'


const REPEAT_WINDOW = 4
// Consecutive learned_avoid vetoes before the gate must let something through.
const MAX_VETO_STREAK = 4

// THE SAME VALVE, FOR THE WATER RULE, AND IT IS NOT OPTIONAL.
//
// MAX_VETO_STREAK lives inside the learned_avoid branch, so a STRUCTURAL
// rejection added earlier in check() gets no escape valve at all. A bot in open
// water proposing goto would then be refused every decision, forever, with no
// path out -- which is the admission gate freezing shut, the exact failure in
// the taxonomy that climbed 23% -> 72% over sixteen hours while every dashboard
// looked fine. Any rule that can be true for a long time needs its own bound.

// Travel verbs that walk. A bot afloat in open water cannot execute these: the
// land movement profile prices a wet step at ~86 against ~1 and the `cost > 100`
// guards delete wet neighbours, so A* has nowhere to go. Measured in one 10-min
// window on the marooned bots: 850 _path_reset and 91 _path_noPath.

// --------------------------------------------------------------------------
// THE BOOTSTRAP EXEMPTION'S TWO QUESTIONS, PULLED OUT AND MADE PURE
// --------------------------------------------------------------------------
//
// Both used to be one line inside check(), and that line was wrong in a way no
// test could see. They are decisions, so they are exported functions with
// asserted behaviour -- see test/bootstrap-table.test.mjs.

/**
 * Where would a crafting table come from, if the bot needed one right now?
 *
 * ASK "CAN I GET TO A TABLE", NOT "DO I HAVE ONE". The craft skill has three
 * routes and takes them in this order (skills.mjs): a table already placed
 * within 32 blocks; one in the pack, which it places; or none at all, in which
 * case -- when nothing else is missing -- it CRAFTS one and places it. That
 * third route is not hypothetical: it was added because the measured modal
 * blocked bot was
 *
 *     Miner01   4 oak_log, 14 oak_planks, 5 stick   -- and no table
 *
 * which can trivially make one. A gate that only counted tables in inventory
 * and tables on the ground would refuse exactly that bot, so this asks the
 * third question too. `crafting_table` itself has requiresTable = false, so
 * recipesFor answers it with no table argument at all.
 *
 * maxDistance 32 is not a free parameter: it must equal the craft skill's own
 * findBlock radius, or the gate admits bots the skill will then refuse.
 *
 * @returns {'reach'|'pack'|'craft'|null}
 */
export function tableRoute(bot) {
  try {
    const near = bot?.findBlock?.({
      matching: b => bot.registry?.blocks?.[b.type]?.name === 'crafting_table',
      maxDistance: 32,
    })
    if (near) return 'reach'
    if (bot?.inventory?.items?.().some(i => i.name === 'crafting_table')) return 'pack'
    const t = bot?.registry?.itemsByName?.crafting_table
    if (t && (bot.recipesFor?.(t.id, null, 1, null) ?? []).length > 0) return 'craft'
    return null
  } catch { return null }
}

/** What one craft consumes, as {name: count}. `null` when it cannot be priced. */
export function recipeCost(recipe, registry) {
  const out = {}
  for (const d of recipe?.delta ?? []) {
    if (d.count >= 0) continue                       // positive = produced
    const n = registry?.items?.[d.id]?.name
    if (!n) return null
    out[n] = (out[n] ?? 0) + (-d.count)
  }
  return out
}

/**
 * Can ONE inventory pay for the pickaxe AND, when it must make one, the table?
 *
 * THE TABLE IS NOT FREE WHEN IT HAS TO BE CRAFTED. A crafting_table is 4 planks
 * and a wooden_pickaxe is 3 planks + 2 sticks, and mineflayer's recipesFor
 * prices each recipe against the inventory in ISOLATION -- so a bot holding
 * exactly 4 planks and 2 sticks passes both checks separately and can satisfy
 * neither after the other. Admitting it would be the 3f1e942 regression in
 * miniature: a cheap veto traded for an expensive failure, each doomed attempt
 * costing a runner slot instead of a rejection.
 *
 * A cost of `null` means "could not be priced", and an unpriceable cost is
 * treated as PAYABLE. mineflayer has already said the recipe is satisfiable on
 * its own; the only thing this function adds is the interaction between two
 * recipes, and with no information about that interaction there is no grounds
 * for an extra refusal.
 *
 * @param have        {name: count} held right now
 * @param pickCosts   one entry per candidate pickaxe recipe
 * @param tableCosts  one entry per candidate table recipe, or null when the
 *                    table costs nothing (already placed, or already in the pack)
 */
export function affordsBootstrap(have, pickCosts, tableCosts = null) {
  const pays = (inv, c) => c == null ||
    Object.entries(c).every(([n, k]) => (inv[n] ?? 0) >= k)
  const picks = pickCosts ?? []
  if (!picks.length) return false
  if (tableCosts == null) return picks.some(c => pays(have, c))
  const tables = tableCosts
  if (!tables.length) return false
  for (const p of picks) {
    if (!pays(have, p)) continue
    const left = { ...have }
    for (const [n, k] of Object.entries(p ?? {})) left[n] = (left[n] ?? 0) - k
    if (tables.some(t => pays(left, t))) return true
  }
  return false
}

/** Everything the bot is carrying, summed by name. */
export function heldCounts(bot) {
  const out = {}
  for (const i of bot?.inventory?.items?.() ?? []) out[i.name] = (out[i.name] ?? 0) + (i.count ?? 0)
  return out
}

const inWater = (bot) => {
  const b = bot?.blockAt?.(bot.entity?.position)
  return !!b && (b.name === 'water' || b.name === 'bubble_column')
}

/**
 * Normalise a deposit's item argument against the inventory. Wildcards ('', none,
 * null, any, all, everything, items) mean "everything bankable" -> item null. A
 * real name the bot holds passes through; a real name it does NOT hold is
 * `missing`. Pure, exported for the admission test.
 */
export const DEPOSIT_WILDCARDS = new Set(['', 'none', 'null', 'any', 'all', 'everything', 'items', 'inventory', 'undefined'])
export function depositItemArg (items, item) {
  const name = item == null ? '' : String(item).trim().toLowerCase()
  if (DEPOSIT_WILDCARDS.has(name)) return { item: null, missing: false }
  const held = (items ?? []).some(it => it?.name === name)   // EXACT: 'stone' must not admit cobblestone (Codex)
  return held ? { item: name, missing: false } : { item: name, missing: true }
}

/** gathermem-01: the area entry refusing (gather, block) where `bot` stands -> entry | null. GATHERMEM=0: never. */
function gatherAreaHit (bot, block, now = Date.now()) {
  if (!gatherMemOn() || !block || !Array.isArray(bot?.gatherAreas) || !bot.gatherAreas.length) return null
  const p = bot.entity?.position
  return p ? areaRefusal(bot.gatherAreas, { block, pos: { x: p.x, y: p.y, z: p.z }, now }) : null
}

export class AdmissionControl {
  constructor(lessons = null) {
    this.lessons = lessons
    this.failedCooldowns = new Map()   // key -> expiry timestamp
    this.recent = []                   // last N admitted keys, for repeat detection
    this.blockedCount = {}             // per-key block tally, for probation
    this.vetoStreak = 0                // consecutive learned_avoid rejections
    this.activeMilestoneId = null      // set by the cognitive layer each decision
    // REPEATWORK-01 (repeatwork.mjs): the window does not refuse a gather whose last run of that key, on this rung, gained
    this.repeatWork = repeatWorkConfig(process.env)
    this.lastRun = new Map()           // key -> { gain, milestoneId, targeted }: the key's LAST run (bounded, LEDGER_MAX)
    this.rwTally = null                // one repeatwork_tally row per 10 min
    this.rwBot = null                  // the bot the last check() judged: the tally row's snapshot
    this.rwWhy = null                  // this proposal's repeat outcome, handed from #check to check()
  }

  static key(skill, args) { return actionKey(skill, args) }

  /** Record that a proposal we admitted ended in failure, so we stop re-picking it. */
  noteFailure(skill, args) {
    this.failedCooldowns.set(AdmissionControl.key(skill, args),
                             Date.now() + config.skills.failedCooldownMs)
    this.#noteRun(skill, args, false)
  }

  /** Called by the cognitive layer only for a VALUABLE success: the contract was met and the gain is one the rung wants. */
  noteSuccess(skill, args) {
    this.failedCooldowns.delete(AdmissionControl.key(skill, args))
    this.#noteRun(skill, args, true)
    if (skill === 'withdraw' && isLogBlock(args?.item)) this.logGateTriedAt = null   // loggate-01: the withdrawal brought wood
  }

  /** LOGGATE-01: the gate's decision for a proposed gather (logcap.mjs logGatherGate), or null (not a log, off, uncapped,
   *  or anything thrown: the gate never breaks a decision -- null is the base). */
  #logGate (args, bot, wanted = null) {
    try {
      if (!logGateOn() || !isLogBlock(args?.block)) return null
      const cap = townLogCapState(bot)
      if (!cap?.capped) return null
      const items = bot?.inventory?.items?.() ?? []
      const wood = bagWoodUnits(items)
      // the logs the ACTIVE rung counts (its wanted names) that the bag holds, when that rung wants a log at all
      const want = wanted instanceof Set ? wanted : new Set(Array.isArray(wanted) ? wanted : [])
      const rungLogs = [...want].some(isLogBlock) ? items.reduce((t, it) => t + (want.has(it?.name) && isLogBlock(it?.name) ? (it.count ?? 0) : 0), 0) : null
      const pos = bot?.entity?.position
      const near = !!pos && inTown({ x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }, pos)
      let top = null
      if (near && (wood < WOOD_KEEP || (rungLogs != null && rungLogs < LOGGATE_RUNG_LOGS))) top = townLogTop(bot)   // the town index is read only for a bot in town that is short
      const g = logGatherGate({ block: args.block, count: args.count, cap, wood, keep: WOOD_KEEP, inTown: near, top, triedAt: this.logGateTriedAt ?? null, rungLogs })
      return g.act === 'pass' ? null : { ...g, wood, cap }
    } catch { return null }
  }
  #logGateRow (bot, g, args, asked, to = null) {
    if (this.dry) return
    try {
      logEvent({ kind: 'loggate', status: g.act === 'refuse' ? 'failed' : 'success', snapshot: snapshot(bot),
                 detail: logGateDetail(g, { block: args.block, asked, wood: g.wood, cap: g.cap, to }) })
    } catch { /* telemetry */ }
  }

  /** REPEATWORK-01: the outcome of the key's last run. Its rung is the one it was ADMITTED on: check() writes the entry for
   *  every admission (each path, the early ones included); a key with no entry (evicted) earns nothing. */
  #noteRun(skill, args, gain) {
    try {
      const key = AdmissionControl.key(skill, args)
      const prev = this.lastRun.get(key)
      ledgerSet(this.lastRun, key, { gain: gain && !!prev, milestoneId: prev?.milestoneId ?? null, targeted: prev?.targeted === true })
      if (PROGRESS_SKILLS.has(skill)) this.#rwCount(gain ? 'gather_gains' : 'gather_fails')
    } catch { /* bookkeeping must never break a decision */ }
  }

  /** REPEATWORK-01: one repeatwork_tally row per bot per 10 min (repeatwork.mjs tallyLine). */
  #rwCount(...whats) {
    const now = Date.now()
    this.rwTally ??= { t0: now, c: {} }
    for (const w of whats) this.rwTally.c[w] = (this.rwTally.c[w] ?? 0) + 1
    if (now - this.rwTally.t0 >= REPEAT_WORK_TALLY_MS) {
      try { logEvent({ kind: 'repeatwork_tally', status: 'success', detail: repeatWorkTallyLine({ secs: (now - this.rwTally.t0) / 1000, c: this.rwTally.c }), snapshot: this.rwBot ? snapshot(this.rwBot) : undefined }) } catch { /* telemetry only */ }
      this.rwTally = { t0: now, c: {} }
    }
  }

  /** Called after an escape action, so the model gets a clean slate to choose from. */
  clearRepeatWindow() { this.recent = [] }

  /** fewerdec CONTINUE: a continuation admitted as `normal` gives back its repeat-window place (only the newest entry,
   *  only when it is that key), so the model's own repeat is judged on the model's own choices. */
  forgetLastAdmitted(key) { if (this.recent.length && this.recent[this.recent.length - 1] === key) this.recent.pop() }

  /**
   * WOULD THE GATE'S MEMORY REFUSE THIS? -> 'cooldown' | 'learned_avoid' | 'repeat_loop' | null. A READ: nothing here
   * mutates (no probation count, no streak, no window push). CONSERVATIVE on purpose (orderroom-01): a remedy order is
   * not issued when its key is cooling down, carries >= 4 learned failures (probation may still let one through -- the
   * remedy is skipped rather than gambled), or already fills the repeat window. The next remedy, or the model, takes the
   * turn instead of a refused order. Never used to ADMIT anything: check() stays the only door.
   */
  memoryRefuses(skill, args, now = Date.now()) {
    const key = AdmissionControl.key(skill, args)
    const until = this.failedCooldowns.get(key)
    if (until && now < until) return 'cooldown'
    // GATHERMEM-01: a (gather, block) that found nothing takeable where the bot now stands -- an order is not issued into it
    if (skill === 'gather' && gatherAreaHit(this.lastBot, args?.block, now)) return 'gather_area'
    if ((this.lessons?.failCount?.(skill, args) ?? 0) >= 4) return 'learned_avoid'
    // REPEATWORK-01: the same decision check() makes (repeatwork.mjs repeatDecision)
    if (this.#repeat(skill, key).refuse) return 'repeat_loop'
    return null
  }

  /** REPEATWORK-01: the window's decision for this key, through the one pure rule (memoryRefuses and check both ask here). */
  #repeat(skill, key) {
    return repeatDecision({ cfg: this.repeatWork, skill, repeats: this.recent.filter(k => k === key).length, window: REPEAT_WINDOW,
                            last: this.lastRun.get(key), milestoneId: this.activeMilestoneId ?? null })
  }

  /**
   * WOULD check() REFUSE THIS DEPOSIT ON ITS DEPOSIT RULES? -> depositVerdict's { ok } | { ok: false, reason } (bank_closed /
   * deposit_nothing_to_bank / deposit_not_worth_it). DEPOSITOFFER-01: check() decides with this, and the prompt's offer asks
   * it with item = null (the widest deposit: a named plan is a subset of the unnamed one). No rows and no wants written to
   * the bot; the one write is bankClosed()'s own lapse/reopen of bot.bankClosed (chestfull.mjs), which the deposit_surplus
   * rung's done() and the prompt already trigger every tick. `pre` lets check() pass what it already computed.
   */
  depositRunnable(bot, item = null, wanted = null, milestoneId = this.activeMilestoneId, pre = null) {
    const closed = bankClosed(bot)
    if (closed) return { ok: false, reason: 'bank_closed' }
    const items = pre?.items ?? bot.inventory?.items?.() ?? []
    const wants = pre?.wants ?? [...(wanted ? [wanted].flat() : []), ...DEPOSIT_ALWAYS]
    const noSwords = pre?.noSwords ?? foodSkipNow(bot).active
    const bank = pre?.bank ?? bankableInventory(items, { wants, noSwords })
    const capNames = item == null ? ['cobblestone', 'cobbled_deepslate'] : /^(cobblestone|cobbled_deepslate)$/.test(item) ? [item] : []
    const reconcile = capNames.some(n => bankableExclusion(items, n, { wants, noSwords }) === 'town_cobble_unknown') && cobbleReconcileProbe().can
    return depositVerdict({
      planLength: depositPlan(items, item, { wants, noSwords }).length,
      reconcile,
      bankable: bank.count,
      occupiedSlots: items.length,
      distHome: horizontalDistanceFromSpawn(bot.entity.position),
      // A DEEP container is not storage (chestfull-02, depositTargetOk): the deposit will not use it. Read only when needed.
      storageWithin48: () => !!bot.findBlock?.({
        matching: b => ['chest','barrel','trapped_chest']
          .includes(bot.registry?.blocks?.[b.type]?.name) &&
          depositTargetOk({ x: config.world.homeX, y: config.world.homeY, z: config.world.homeZ }, b.position), maxDistance: 48 }),
      // THE `#N` FIX: sustaining ids are `deposit_surplus#3207`; `=== 'deposit_surplus'` was never true on the fleet
      // (DEPOSITRUNG=0 is its rollback: depositoffer.mjs onDepositRung)
      onDepositMilestone: onDepositRung(milestoneId),
    })
  }

  /**
   * What this action would put in the inventory, or null when we cannot say.
   * Deliberately narrow: only the two skills whose output is named directly in
   * their own args. Guessing what `mine` or `explore` might yield would make
   * the never-block rule that follows unfalsifiable.
   */
  static #output(skill, args) {
    if (skill === 'craft') return args?.item ?? null
    if (skill === 'gather') return args?.block ?? args?.item ?? null
    // WITHOUT THIS LINE `smelt` CAN NEVER RECEIVE THE MILESTONE EXEMPTION.
    //
    // This table was `craft`/`gather` and a default of null, so any new
    // producing verb silently fell through to "produces nothing" -- and the
    // milestone_critical branch below is the guard that stops the gate making
    // its own goal unreachable. A brand-new verb is the WORST case for that: it
    // starts with no record, four failures put it over the threshold, and
    // without an exemption the only rung that reaches iron would be shut before
    // the fleet ever smelted once.
    //
    // smelt takes the INPUT (`raw_iron`) and produces the OUTPUT
    // (`iron_ingot`), so the name the milestone wants is not the name in the
    // args -- which is exactly why the default was wrong rather than merely
    // incomplete.
    if (skill === 'smelt') return smeltRecipeFor(args?.item)?.output ?? null
    return null
  }

  static #produces(skill, args, wanted) {
    const out = AdmissionControl.#output(skill, args)
    if (!out || !wanted) return false
    return wanted instanceof Set ? wanted.has(out) : Array.isArray(wanted) && wanted.includes(out)
  }

  /**
   * @returns {{ok: true, skill, args} | {ok: false, reason: string, detail: string}}
   */
  check(proposal, bot, wanted = null) {
    this.lastBot = bot ?? this.lastBot   // gathermem-01: memoryRefuses reads where the bot stands (it is not passed one)
    const out = this.#check(proposal, bot, wanted)
    // REPEATWORK-01: EVERY admission -- normal, milestone_critical, forced, bootstrap, the safety orders -- starts the key's
    // run with no gain on this rung (both reviews r1: an early return used to keep an older run's verdict). Only the run's
    // own valuable outcome (noteSuccess) turns it on.
    if (out?.ok) {
      try {
        ledgerSet(this.lastRun, AdmissionControl.key(out.skill, out.args), { gain: false, milestoneId: this.activeMilestoneId ?? null,
          targeted: !!(wanted && ((wanted instanceof Set ? wanted.size : wanted.length) > 0)) })
      } catch { /* bookkeeping must never break a decision */ }
    }
    // REPEATWORK-01's tally: every proposal judged (model and order alike), refused or admitted
    const why = this.rwWhy; this.rwWhy = null
    try { if (bot) this.rwBot = bot; this.#rwCount('checks', out?.ok ? 'admitted' : 'refused', ...(why ? [why] : [])) } catch { /* telemetry only */ }
    return out
  }

  /**
   * PIPELINE-01 (pipeline.mjs): WOULD check() ADMIT THIS NOW? The same #check, with nothing written: the repeat window,
   * the veto streak, the probation counters (in memory and persisted), the counters and the bot's deposit wants are put
   * back, and no row is logged. A prefetched pick is judged here first, so the gate's state only ever sees the ONE
   * proposal a decision runs through check().
   */
  dryCheck(proposal, bot, wanted = null) {
    const keep = { recent: this.recent.slice(), vetoStreak: this.vetoStreak, forcedAdmissions: this.forcedAdmissions,
      milestoneCriticalAdmissions: this.milestoneCriticalAdmissions, blockedCount: { ...this.blockedCount },
      normalisations: this.normalisations, resolutions: this.resolutions, rwWhy: this.rwWhy }
    const hadWants = !!bot && Object.prototype.hasOwnProperty.call(bot, 'currentWants'), wants = bot?.currentWants
    this.dry = true
    // a COPY: #check normalises args in place, and the real check() must see the proposal as the model wrote it
    try { return this.#check(proposal && typeof proposal === 'object' ? structuredClone(proposal) : proposal, bot, wanted) }
    catch (e) { return { ok: false, reason: 'dry_error', detail: String(e?.message ?? e).slice(0, 120) } }
    finally {
      this.dry = false
      Object.assign(this, keep)
      if (bot) { if (hadWants) bot.currentWants = wants; else delete bot.currentWants }
    }
  }

  #check(proposal, bot, wanted = null) {
    if (!proposal || typeof proposal !== 'object') {
      return { ok: false, reason: 'no_proposal', detail: 'model produced nothing usable' }
    }
    const { skill } = proposal
    const args = { ...(proposal.args ?? {}) }

    // Normalise one unambiguous confusion: gather takes `block`, but models
    // reach for `item` because block ids read like item ids. The intent is not
    // in doubt, so rejecting it would be pedantic -- but it IS recorded, so the
    // rate stays visible in telemetry rather than being silently absorbed.
    if (skill === 'gather' && !args.block && typeof args.item === 'string') {
      args.block = args.item
      delete args.item
      this.normalisations = (this.normalisations ?? 0) + 1
    }

    // --- known skill ------------------------------------------------------
    if (!SKILLS[skill]) {
      return { ok: false, reason: 'unknown_skill', detail: `"${skill}" is not in the registry` }
    }

    // KEEPOUT-01: THE EXIT FROM A FIRE COLUMN IS NOT GATED BY MEMORY (Codex r1 P1-1). It is a deterministic safety order that
    // cognitive.mjs issues only for a body inside a column and bounds itself (3 attempts that do not get out -> a 5-min back-off
    // that hands the body to the escape ladder); the repeat window, a cooldown or a learned rule must never be what keeps a
    // bot standing over a marked lava pool.
    // (an inventory click in flight still waits: the escape step equips a tool -- Claude r2 P3-4)
    if (skill === 'keepout_exit' && !bot?.inventoryUnsettled) return { ok: true, skill, args: {}, kind: 'keepout_exit' }
    // RESPAWNFALL-01: the climb down from a high platform is the same kind of deterministic safety order (cognitive.mjs issues
    // it only for an elevated bot after a spawn); no repeat window or learned rule may keep a bot standing at a deadly edge
    if (skill === 'sky_descend' && !bot?.inventoryUnsettled) return { ok: true, skill, args: {}, kind: 'sky_descend' }
    // DEEPMINER-01: the town deep miner's trip is a deterministic job (cognitive.mjs issues it, one call per phase step, the same
    // args every call): the repeat window, a cooldown or a learned rule must not strand a trip half way (it bounds itself:
    // deepmine.mjs CALLS_MAX, TRIP_MAX_MS, RETURN_TRIES)
    if (skill === 'deep_mine' && !bot?.inventoryUnsettled) return { ok: true, skill, args: args ?? {}, kind: 'deep_mine' }
    if (skill === 'deep_mine') return { ok: false, reason: 'inventory_unsettled', detail: `wait: a stack is still being put back from the cursor (${String(bot.inventoryUnsettled.why ?? '').slice(0, 60)})` }
    if (skill === 'sky_descend') return { ok: false, reason: 'inventory_unsettled', detail: `wait: a stack is still being put back from the cursor (${String(bot.inventoryUnsettled.why ?? '').slice(0, 60)})` }
    if (skill === 'keepout_exit') return { ok: false, reason: 'inventory_unsettled', detail: `wait: a stack is still being put back from the cursor (${String(bot.inventoryUnsettled.why ?? '').slice(0, 60)})` }

    // --- argument sanity, per skill ---------------------------------------
    if (skill === 'gather') {
      if (!args.block || typeof args.block !== 'string') {
        return { ok: false, reason: 'bad_args', detail: 'gather needs a block name' }
      }
      // A missing plural or an item-for-block is a name the model MEANT. Resolve
      // those two shapes and rewrite args in place -- cognitive.mjs runs
      // `admitted.args`, so the skill receives a real block. Anything else is a
      // genuinely invented name and still fails here.
      const resolved = resolveBlockName(bot.registry, args.block)
      if (!resolved) {
        return { ok: false, reason: 'bad_args', detail: `"${args.block}" is not a real block` }
      }
      if (resolved.via !== 'exact') {
        // Same treatment as the item/block normalisation above: the rewrite is
        // applied, and COUNTED, so the rate stays visible in telemetry rather
        // than being silently absorbed into a healthier-looking veto rate.
        args.block = resolved.block
        this.resolutions = (this.resolutions ?? 0) + 1
      }
      const n = Number(args.count)
      if (!Number.isFinite(n) || n <= 0 || n > 128) {
        return { ok: false, reason: 'bad_args', detail: `count ${args.count} outside 1..128` }
      }
    }

    // LOGGATE-01 (logcap.mjs): THE TOWN'S LOG LIMIT IS A REFUSAL, NOT A PROMPT LINE. A gather of a log while the bot's town is
    // capped: a bot that holds its wood keep is refused (432 such cuts succeeded in 6 h in capped towns, 11-12); a bot short
    // of wood is sent to the town's own logs (a withdrawal, admitted through this same check), or -- away from town, no log
    // in the index, a withdrawal tried in the last 10 min, or the withdrawal not admissible now -- cuts only what it is short.
    if (skill === 'gather') {
      const g = this.#logGate(args, bot, wanted)
      if (g) {
        const asked = args.count
        if (g.act === 'refuse') {
          this.#logGateRow(bot, g, args, asked)
          return { ok: false, reason: 'log_cap', detail: g.detail }
        }
        if (g.act === 'withdraw') {
          const p = { skill: 'withdraw', args: { item: g.item, count: g.count }, reason: proposal.reason }
          // would the withdrawal be admitted? asked without touching the gate's state (inside a dry check, state is restored by it)
          const probe = this.dry ? this.#check(structuredClone(p), bot, wanted) : this.dryCheck(p, bot, wanted)
          if (probe.ok) {
            if (this.dry) return probe
            this.logGateTriedAt = Date.now()
            this.#logGateRow(bot, g, args, asked, `withdraw:${g.item}:${g.count}`)
            return this.#check(p, bot, wanted)
          }
          // the withdrawal is not admissible now (a cooldown, a full cursor, a learned rule): never a refusal while short of wood
          args.count = g.cut
          this.#logGateRow(bot, { ...g, act: 'clamp', why: `withdraw_${probe.reason ?? 'refused'}` }, args, asked, `gather:${g.cut}`)
        } else if (g.act === 'clamp') {
          args.count = g.count
          this.#logGateRow(bot, g, args, asked, `gather:${g.count}`)
        }
      }
    }

    // KEEPOUT-01: A REFUSED (gather, block) OR mine IS SUPPRESSED NEAR THE COLUMN (keepout.mjs cooldownHit; design 4.6 rows 2-3).
    // The run that met the column ended without a dig and charged a 10-min cooldown; within 32 blocks of the column the same
    // proposal is refused HERE, so the next decision is a different one. The remedy is a move the bot can make from here.
    if ((skill === 'gather' || skill === 'mine') && Array.isArray(bot?.keepoutCooldowns) && bot.keepoutCooldowns.length) {
      const hit = cooldownHit(bot.keepoutCooldowns, { skill, block: skill === 'gather' ? args.block : null, pos: bot.entity?.position })
      if (hit) {
        return { ok: false, reason: 'keepout_cooldown',
                 detail: `${skill}${skill === 'gather' ? ` ${args.block}` : ''} was refused ${Math.round((Date.now() - (hit.until - KEEPOUT_COOLDOWN_MS)) / 1000)}s ago here: ` +
                         `every candidate near is in the column above a marked lava pool (${hit.site.x},${hit.site.y},${hit.site.z}); ` +
                         `walk ${KEEPOUT_COOLDOWN_NEAR}+ blocks from it, or do something else (${Math.ceil((hit.until - Date.now()) / 1000)}s left)` }
      }
    }

    // GATHERMEM-01: A GATHER THAT JUST FOUND NOTHING TAKEABLE HERE IS NOT RUN AGAIN HERE FOR A FEW MINUTES (gathermem.mjs).
    // The run that wrote the entry scanned this spot and found every candidate unsafe, buried, refused or just failed; the
    // same scan from the same spot returns the same answer, and 8,411 same-spot repeats cost the fleet 93.7 bot-h a day.
    // The detail names a remedy executable from here (mine for an ore, another block, or walk away), and the entry expires.
    if (skill === 'gather') {
      const hit = gatherAreaHit(bot, args.block)
      if (hit) return { ok: false, reason: 'gather_area', detail: areaRefusalDetail(hit) }
    }

    // SWIM_TO IS FOR WATER, AND SAYING SO HERE SAVES A WHOLE DECISION.
    //
    // The skill already refuses a dry bot, but by then the proposal has been
    // admitted, dispatched and burned a ~30s cognitive cycle. Measured in 45
    // minutes: 18 wasted decisions, placebo-b-Delta alone accounting for 6. The
    // model reaches for swim_to because the system prompt advertises it
    // unconditionally, while the IN WATER hint only appears when it is true.
    // A DEPOSIT THAT COSTS MORE THAN IT BANKS IS NOT A DEPOSIT.
    //
    // The measured fleet sits a MEDIAN OF 804 BLOCKS from town with 16 of 36
    // stacks used. Admitting "deposit" out there sends a bot on a six-minute
    // round trip to bank a handful of cobblestone, through the travel failures
    // that already account for most deposit failures (156 stuck, 107 drowning).
    //
    // So the gate asks whether banking is CHEAP, not whether the bot is full:
    // storage in sight, already near home, or working a deposit goal it accepted.
    // The milestone creates the demand; this stops the demand being answered in
    // the most expensive possible place.
    // A BUCKET ACTION WITHOUT A BUCKET IS NOT A PLAN.
    //
    // `bucket` ran 177 times fleet-wide and failed 177 times; 68 of those were
    // `no empty bucket`, i.e. the bot did not have one. The skill refuses
    // correctly at bucket.mjs:73 -- but by then the proposal has been admitted,
    // dispatched, and has burned a ~30s decision cycle. On a fleet where the
    // cooldown is two thirds of every bot-hour, a decision spent learning
    // something the inventory already knew is the most expensive kind of no-op.
    //
    // placebo-b-Comet, one of six bots that produced NOTHING in a 40-minute
    // window, spent 12 of its 50 skill runs here, 11 of them on this exact
    // refusal, while stuck at y=-19.
    //
    // Same shape as the deposit gate below: ask whether the action is possible
    // from where the bot stands, not whether the model was allowed to want it.
    if (skill === 'bucket') {
      const items = bot.inventory?.items?.() ?? []
      const action = String(args?.action ?? 'fill').toLowerCase()
      const has = n => items.some(i => i.name === n)
      if (action === 'pour' && !has('water_bucket') && !has('lava_bucket')) {
        return { ok: false, reason: 'no_filled_bucket',
                 detail: 'nothing to pour — you are not carrying a full bucket' }
      }
      if (action !== 'pour' && !has('bucket')) {
        return { ok: false, reason: 'no_empty_bucket',
                 detail: has('water_bucket')
                   ? 'your bucket is already full — pour it out before filling again'
                   : 'you have no bucket to fill; craft one from 3 iron ingots first' }
      }
    }

    // A CURSOR THAT COULD NOT BE EMPTIED holds the chest window open (skills.mjs holdUnsettled, withdraw): nothing may
    // run -- any inventory click would land past it, and a close would drop it -- until it settles.
    if (bot?.inventoryUnsettled) {
      return { ok: false, reason: 'inventory_unsettled', detail: `wait: a stack is still being put back from the cursor (${String(bot.inventoryUnsettled.why ?? '').slice(0, 60)})` }
    }

    // A WITHDRAW NAMES WHAT IT NEEDS (withdrawpick.mjs, Codex): the old bare form took the most plentiful item -- the
    // town's cobblestone -- into a bag that was already full.
    if (skill === 'withdraw') {
      const it = String(args?.item ?? '').trim().toLowerCase()
      if (!it || ['none', 'null', 'any', 'anything', 'all', 'everything', 'items', 'undefined'].includes(it)) {
        return { ok: false, reason: 'withdraw_needs_item',
                 detail: 'name what you need: withdraw <item> [count], e.g. withdraw stone_pickaxe or withdraw stick 2' }
      }
    }

    if (skill === 'deposit') {
      // THE BANK IS CLOSED for this bot after a full-chest refusal (chestfull.mjs): nothing it carries can go in until it
      // reopens, so the deposit is refused here, before any walk, with a remedy it can act on from anywhere.
      const closed = bankClosed(bot)
      if (closed) return { ok: false, reason: 'bank_closed', detail: bankClosedDetail(closed) }
      const items = bot.inventory?.items?.() ?? []
      // THE NAMED ITEM MUST BE IN HAND (2026-09-13: 842 of 1,748 deposit runs in 24 h
      // did nothing -- "nothing matching none/null/wheat_seeds to hand over"). A
      // wildcard word means "everything bankable"; a real name the bot does not
      // hold is refused here, before a walk to the chest.
      const arg = depositItemArg(items, args?.item)
      if (arg.missing) {
        return { ok: false, reason: 'deposit_item_missing',
                 detail: `you hold no ${args.item}; deposit what you carry (say deposit with no item) or gather it first` }
      }
      if (args) args.item = arg.item
      // NO SWORD IS BANKED IN A PEACEFUL WORLD (peacefulkit.mjs, owner 10-07 ~19:50Z): a named sword deposit is refused here,
      // before the walk home, with the rule (the bank would hand over nothing).
      if (arg.item && unwantedSword({ name: arg.item }, foodSkipNow(bot).active)) {
        return { ok: false, reason: 'peaceful_sword_deposit',
                 detail: `not a banking target (swords are not banked in a peaceful world): keep the ${arg.item}, or deposit something else` }
      }
      // THE SAME POLICY AS EXECUTION (Codex, deposit pass 2): the always-banked ores count here too, and the wants
      // this gate judged with are handed to the skill through the bot (the runner's ctx carries no wants).
      const wants = [...(wanted ? [wanted].flat() : []), ...DEPOSIT_ALWAYS]
      bot.currentWants = wants
      // THE SWITCH, READ HERE (Codex, junkwell merge): a spare sword never makes a deposit due while peaceful.
      const noSwords = foodSkipNow(bot).active
      const bank = bankableInventory(items, { wants, noSwords })
      // AN EMPTY REQUESTED PLAN IS REFUSED HERE, BEFORE ANY WALK (nojunk SYNTHESIS 10-04; Codex on the cobble rule 10-07):
      // `deposit cobblestone` with only reserve cobble, or a plain deposit with nothing bankable, names its rule now.
      // ...EXCEPT THE TOWN COBBLE CAP'S RECONCILIATION (cobblecap.mjs; both reviews r1): cobble the cap cannot judge yet (a
      // container never counted) is the one empty plan a deposit can change -- it counts the uncounted ones. Only where the
      // deposit WILL count (both reviews r2): in town by the deposit's own boundary (inTown, not distance from the origin),
      // with an uncounted container outside its backoff (the probe), and for the requested name only.
      // DEPOSITOFFER-01: the decision is depositRunnable (below) -- the same reader the prompt's offer asks with item = null
      const dv = this.depositRunnable(bot, args?.item ?? null, wanted, this.activeMilestoneId, { items, wants, noSwords, bank })
      if (dv.reason === 'deposit_nothing_to_bank') {
        // THE CAP'S REFUSAL IS A ROW HERE TOO (Codex fold-r1 P2: a bag holding only capped surplus is refused here, before
        // any skill runs, so the skill's rows never see it); throttled -- admission is asked on every proposal
        // PIPELINE-01 dryCheck (Codex r1): no row and no throttle stamp for a refusal that is only asked about
        if (!this.dry) stockRefusedRow(bot, 'admission', items, { wants, noSwords }, { throttleMs: 60_000 })
        return { ok: false, reason: 'deposit_nothing_to_bank', detail: depositNoopReason(items, args?.item ?? null, { wants, noSwords }) }
      }
      if (dv.reason === 'deposit_not_worth_it') {
        return { ok: false, reason: 'deposit_not_worth_it',
                 detail: `${bank.count} bankable items and no storage in reach — ` +
                         `bank it when you are next near the chest, not from out here` }
      }
    }

    // THE WATER VETO IS GONE, AND ITS OWN ESCAPE HATCH IS WHY.
    //
    // It claimed a fact: "goto and explore cannot produce a route from open
    // water". The claim was false, and the veto contained the proof. Every third
    // consecutive rejection it let one through as `forced` -- 274 of those, from
    // provably shore-less open water, and they succeeded 85.4% of the time with
    // a median displacement of 39.3 blocks. That beats this fleet's dry-land
    // travel (70.6%, 29.2 blocks) and is 22x what the verb it recommended
    // managed (1.8 blocks).
    //
    // mineflayer-pathfinder swims unconditionally -- index.js:607-613 holds
    // forward and jump whenever isInWater, and there is no option to turn it on
    // because it is never off. The one thing genuinely missing was stepping OUT,
    // and that was a height-arithmetic bug now fixed in watermoves.mjs.
    //
    // What it cost while it stood: 1,278 vetoes a day, 5% of every decision the
    // fleet made, across 41 bots. The model ignored the named remedy 95% of the
    // time and re-proposed `explore` instead -- the bots were routing around our
    // own rule, and they were right to.

    if (skill === 'goto') {
      const { x, y, z } = args
      if (![x, y, z].every(v => Number.isFinite(Number(v)))) {
        return { ok: false, reason: 'bad_args', detail: 'goto needs numeric x, y, z' }
      }
      // Never let a goal chase the bot past the world border into ungenerated
      // chunks -- the whole point of pregenerating and setting a border.
      const d = horizontalDistanceFromSpawn({ x: Number(x), z: Number(z) })
      if (d > config.world.borderRadius) {
        return { ok: false, reason: 'outside_border', detail: `${Math.round(d)} > ${config.world.borderRadius}` }
      }
      // Absolute bounds are far too loose to be useful: the model repeatedly
      // chose y=140 while standing at y=70, which passes any sane global check
      // and then fails to path because it is 70 blocks up in open sky.
      // Plausibility is RELATIVE to where the bot currently is.
      // ASYMMETRIC, because the two directions are not alike. The comment above
      // describes the case this was built for -- "y=140 while standing at
      // y=70" -- and that is UP. A bot cannot fly, so a target far overhead is
      // implausible on its face.
      //
      // Down is different: a bot can fall, dig, or walk down terrain. Written
      // with Math.abs, this refused every attempt by a stranded bot to aim at
      // the ground. Measured over six hours, three bots at y>=200 made 164
      // descent attempts -- 13% of their decisions -- and roughly half were
      // refused right here, reading "y=73 is 247 blocks from your y=320".
      // They were complying with an instruction the gate would not let them
      // act on.
      //
      // A downward target that cannot be pathed still fails -- at the
      // pathfinder, which is the layer entitled to make claims about the
      // world, and which records real evidence when it does.
      const dy = Number(y) - bot.entity.position.y
      if (dy > 40) {
        return {
          ok: false, reason: 'unreachable_elevation',
          detail: `y=${y} is ${Math.round(dy)} blocks ABOVE your y=${bot.entity.position.y.toFixed(0)} — ` +
                  `you cannot climb that in one move. Descending is not limited this way.`,
        }
      }
    }

    if (skill === 'craft') {
      if (!args.item || typeof args.item !== 'string') {
        return { ok: false, reason: 'bad_args', detail: 'craft needs an item name' }
      }
      if (!bot.registry.itemsByName[args.item]) {
        return { ok: false, reason: 'bad_args', detail: `"${args.item}" is not a real item` }
      }
      const n = Number(args.count ?? 1)
      if (!Number.isFinite(n) || n <= 0 || n > 64) {
        return { ok: false, reason: 'bad_args', detail: `count ${args.count} outside 1..64` }
      }
      // TOOL HYGIENE, PART 1 (toolhygiene.mjs): no second pickaxe beside one that already does everything any goal
      // asks, no second crafting_table/furnace in the bag. THE single admission point: model proposals and work
      // orders both arrive here. Never refuses what the task wants (`wanted`), so it cannot strand a rung; the
      // detail names the remedy (dig with the held copy / the skill places the carried station).
      const redundant = redundantCraft(args.item, bot.inventory?.items?.() ?? [], { wanted, y: bot.entity?.position?.y, exitShort: bot.exitPickShort })
      if (redundant) return { ok: false, reason: 'redundant_craft', detail: redundant.detail, redundant }
      // IRONCHAIN-02 (pickswings.mjs): admitted above ONLY for a swing reserve, an iron pickaxe the bag cannot make becomes the
      // stone one it can -- rewritten in place, as block names are (cognitive.mjs runs `admitted.args`); one row per rewrite
      const swing = swingRewrite({ item: args.item, items: bot.inventory?.items?.() ?? [], wanted, y: bot.entity?.position?.y, exitShort: bot.exitPickShort,
                                   stoneMakeable: () => craftableFromBag(bot, 'stone_pickaxe') })
      if (swing) {
        args.item = swing.to
        try { logEvent({ kind: 'pick_swings', status: 'success', detail: swing.detail, snapshot: snapshot(bot) }) } catch { /* telemetry never costs the decision */ }
      }
      // NO SWORD IN A PEACEFUL WORLD (peacefulkit.mjs, owner 10-07; the food policy's switch). Before any walk to a table.
      const noSword = swordCraftRefusal(args.item, foodSkipNow(bot).active)
      if (noSword) return { ok: false, reason: 'peaceful_no_sword', detail: noSword }
    }

    if (skill === 'place') {
      if (!args.item || typeof args.item !== 'string') {
        return { ok: false, reason: 'bad_args', detail: 'place needs an item name' }
      }
      if (!bot.inventory.items().some(i => i.name === args.item)) {
        return { ok: false, reason: 'bad_args', detail: `no ${args.item} in inventory to place` }
      }
    }

    if (skill === 'mine') {
      const y = Number(args.y ?? 12)
      // NO UPPER CONSTANT. This read `y > 120` and it cost a bot six hours:
      // stranded at the build limit, correctly told to descend, it proposed
      // `mine {y:173}` -- 147 blocks down, well below the climb ceiling -- and
      // was refused with "outside -59..120". The constant was a proxy for "do
      // not ask to mine into the sky", written when every bot was near the
      // surface, and above y=120 it forbids the one action that can help.
      //
      // The proxy was never needed: the downward precondition a few lines
      // below already refuses any target at or above the bot, and it does so
      // with the same rule at y=72 and at y=320.
      if (!Number.isFinite(y) || y < -59) {
        return { ok: false, reason: 'bad_args',
                 detail: `mine target y=${args.y} is below bedrock (-59)` }
      }
      // TWO PRECONDITIONS THAT WERE COSTING A WHOLE EXECUTION EACH.
      //
      // `mine` only digs downward and refuses without a pickaxe, but both
      // checks live INSIDE the skill -- so a doomed proposal was dispatched to
      // the runner, failed, and incremented the consecutive-failure streak that
      // pauses the runner for 120s. Every skill attempted during that pause
      // then returns `runner_paused`, so one impossible argument can cost four
      // decisions rather than one. Miner01 was observed cycling exactly this at
      // y=89, asking to mine to y=100.
      //
      // Fleet-wide these two are 5,255 of 7,380 mine calls -- 71% of everything
      // the verb was ever asked to do. Rejecting at admission is not a new
      // capability and invents no intent: the same proposal is refused, just
      // before it can cost a runner slot and poison the streak. The model still
      // gets the reason, and telemetry still records the mistake.
      // Identical rule to before -- `mineTargetOk` is `y >= here - 1` re-expressed
      // as a ceiling -- but the refusal now names the number, and prompt.mjs
      // prints the SAME number from the SAME function before the model proposes.
      const here = bot.entity?.position?.y
      if (!mineTargetOk(here, y)) {
        const cap = mineTargetCeiling(here)
        return { ok: false, reason: 'bad_args',
                 detail: `mine only digs DOWNWARD, and it descends to an ELEVATION rather ` +
                         `than digging a single block. You are at y=${Math.round(here)}, so ` +
                         `the highest target it can act on is y=${cap}. Pass y=${cap} or ` +
                         `lower; use gather for a block you can see, or goto/surface to ` +
                         `move upward.` }
      }
      const hasPick = bot.inventory?.items?.().some(i => /_pickaxe$/.test(i.name))
      if (!hasPick && Number.isFinite(here) && here - y > 2) {
        return { ok: false, reason: 'bad_args',
                 detail: `no pickaxe, so descending would strand this bot beside stone it ` +
                         `cannot mine — craft a wooden_pickaxe first` }
      }
    }

    if (skill === 'follow' || skill === 'come') {
      const p = args.player
      // `if (p && ...)` short-circuits when p is undefined, so this validated a
      // WRONG player and waved through a MISSING one -- 29 proposals with no
      // player at all reached the skill layer and failed there. Rejecting a bad
      // value while accepting no value is the same missing-inverse shape as the
      // failure counts that only ever rose.
      if (!p) {
        return { ok: false, reason: 'bad_args', detail: `${skill} needs a player name` }
      }
      if (!bot.players[p]) {
        return { ok: false, reason: 'no_such_player', detail: `${p} is not online` }
      }
    }

    // --- cooldown on things that just failed -------------------------------
    const key = AdmissionControl.key(skill, args)
    const until = this.failedCooldowns.get(key)
    if (until && Date.now() < until) {
      return {
        ok: false, reason: 'cooldown',
        detail: `${skill} with these args failed recently; ${Math.ceil((until - Date.now()) / 1000)}s left`,
      }
    }

    // --- what past RUNS learned ---------------------------------------------
    // A within-run cooldown forgets everything at restart, so the bot would
    // cheerfully retry an action that has failed on every run since the world
    // was created. This is the persistent half of that.
    const priorFails = this.lessons?.failCount(skill, args) ?? 0

    // A GATE MAY NOT MAKE THE GOAL UNREACHABLE.
    //
    // Every individual veto here is defensible; their sum was a fleet standing
    // still. Instance #1 reached a state where the whole early tech tree --
    // gather oak_log, craft oak_planks, craft stick, craft wooden_pickaxe --
    // was learned-blocked at once. Each rung was blocked because it had failed,
    // and it had failed because the rung below it was blocked. The gate had
    // made its own milestone unsatisfiable and then enforced that forever.
    //
    // So an action that PRODUCES something the current milestone needs is never
    // hard-blocked on learned evidence. It still carries its record, is still
    // logged, still counts -- but the bot is allowed to try, because the only
    // thing that can ever clear the rule is an attempt, and refusing the
    // attempt is what made the state permanent. Preference is unaffected; this
    // is purely about never closing the last door.
    if (priorFails >= 4 && wanted && AdmissionControl.#produces(skill, args, wanted)) {
      this.vetoStreak = 0
      this.milestoneCriticalAdmissions = (this.milestoneCriticalAdmissions ?? 0) + 1
      return { ok: true, skill, args, kind: 'milestone_critical',
               forced: `produces ${AdmissionControl.#output(skill, args)}, which the milestone needs` }
    }

    // THE BOOTSTRAP DEADLOCK, made narrow on purpose.
    //
    // `craft wooden_pickaxe` is vetoed 14,533 times fleet-wide while `mine`
    // fails `missing_tool` 2,408 times for want of exactly that pickaxe. The
    // rung is blocked because it failed, and it failed because the bot had no
    // materials -- but the veto outlives the shortage, so acquiring the tool
    // stays forbidden long after it became possible. milestone_critical above
    // only covers it when the CURRENT milestone names the pickaxe; a bot whose
    // milestone is "gather stone" needs the tool just as much and gets no
    // exemption.
    //
    // Deliberately not a blanket craft exemption, which would erase a real
    // memory contrast for ordinary recipes. This fires only when the bot holds
    // NO pickaxe at all -- a state check, not a memory one, so it is identical
    // in every arm and leaves the shared-vs-isolated comparison intact.
    // WOODEN specifically, not every pickaxe. A stone pickaxe needs cobblestone,
    // which needs a pickaxe to mine -- so higher tiers are downstream of the
    // bootstrap rather than part of it, and exempting them would widen this
    // into the blanket craft exemption the narrowness exists to avoid.
    // livelock.test.mjs uses `craft stone_pickaxe` as its example of an action
    // that must STAY blocked, and it is right to.
    // ...AND ONLY IF THE BOT CAN ACTUALLY MAKE ONE.
    //
    // The first version checked "holds no pickaxe" and stopped there, which
    // admitted the craft for bots with no wood either. Measured over the next
    // few hours: 116 `craft wooden_pickaxe` attempts, 150 of 160 craft calls
    // failing `missing_ingredients`, and crafting output collapsing from 37
    // successes in 69 bot-hours to 1 in 27. A cheap veto had been traded for an
    // expensive failure -- each doomed attempt now costs a runner slot instead
    // of a rejection.
    //
    // recipesFor() is the same call the craft skill itself uses to decide
    // whether the recipe is satisfiable right now, so this asks exactly the
    // question the skill would answer a second later. When the answer is no,
    // the veto is CORRECT: the bot needs to gather wood, and the milestone
    // chain is what should be driving that.
    //
    // ...AND FOR ITS WHOLE LIFE IT ASKED A QUESTION WHOSE ANSWER IS ALWAYS NO.
    //
    // The fourth argument to recipesFor is `craftingTable`, and this passed
    // `null`. mineflayer's requirementsMetForRecipe (lib/plugins/craft.js:224)
    // opens with `if (recipe.requiresTable && !craftingTable) return false`, and
    // ALL TWELVE wooden_pickaxe recipes have requiresTable = true -- verified
    // against minecraft-data for 1.21.8, 1.21.11 and 1.21.4, with
    // crafting_table, stick and oak_planks as the positive control that the same
    // query does find table-free recipes (12, 13 and 1 of them respectively).
    // prismarine-recipe's computeRequiresTable (lib/recipe.js:39-55) has three
    // return paths -- `inShape.length > 2`, any `row.length > 2`, and
    // `spaceLeft < 0` -- and a pickaxe trips the first.
    //
    // So this returned [] on EVERY call it has ever made, and the exemption
    // below has never once fired in production. Both halves of the fix matter:
    // `true` for the table argument, because the skill will place or make one;
    // and tableRoute() to check it actually can, because a blanket `true` is the
    // 3f1e942 regression -- 160 craft calls, 150 missing_ingredients, output
    // down from 37 successes in 69 bot-hours to 1 in 27.
    //
    // NOT MODELLED, DELIBERATELY: the skill also recurses one level down and
    // would turn 4 oak_log into planks. A bot holding logs and no planks is
    // therefore refused here. That is the conservative direction against a
    // measured regression, and it is not a dead end -- `craft oak_planks` is a
    // different avoid key, needs no table, and is not vetoed; probation lets
    // every 5th attempt through; MAX_VETO_STREAK forces one through after four;
    // and milestone_critical above already exempts the case outright when the
    // active milestone names the pickaxe. Tested as a chain, not as a guard.
    const canCraftPick = () => {
      try {
        const def = bot.registry?.itemsByName?.wooden_pickaxe
        if (!def) return false
        const route = tableRoute(bot)
        if (!route) return false
        const picks = bot.recipesFor?.(def.id, null, 1, true) ?? []
        if (!picks.length) return false
        if (route !== 'craft') return true
        // The table has to come out of the same planks the pickaxe needs.
        const tdef = bot.registry?.itemsByName?.crafting_table
        const tables = tdef ? (bot.recipesFor?.(tdef.id, null, 1, null) ?? []) : []
        return affordsBootstrap(
          heldCounts(bot),
          picks.map(r => recipeCost(r, bot.registry)),
          tables.map(r => recipeCost(r, bot.registry)))
      } catch { return false }
    }
    if (priorFails >= 4 && skill === 'craft' && args.item === 'wooden_pickaxe' &&
        !bot.inventory?.items?.().some(i => /_pickaxe$/.test(i.name)) && canCraftPick()) {
      this.vetoStreak = 0
      return { ok: true, skill, args, kind: 'bootstrap',
               forced: 'holds no pickaxe; acquiring the first tool is never hard-blocked' }
    }

    if (priorFails >= 4) {
      // PROBATION. A learned block with no way to be disproved is permanent,
      // and the world changes: terrain gets mined, inventories fill, the bot
      // moves. Observed live -- Scout01 made zero executed decisions across an
      // entire run because every action its milestone required had been
      // learned-blocked, and nothing could ever clear them.
      //
      // Every 5th attempt goes through. If it fails the count rises and the
      // block tightens; if it succeeds, recordSuccess() weakens the rule. That
      // is the inverse the guard was missing -- the fifth instance of this
      // shape in this codebase.
      const k = AdmissionControl.key(skill, args)
      // Persisted: a reconnect must not reset the countdown (see bumpBlocked).
      // PIPELINE-01 dryCheck: the count this proposal WOULD reach, nothing written (persisted or in memory)
      const n = this.dry
        ? (this.lessons?.bumpBlocked ? (this.lessons.data?.progress?.blocked?.[k] ?? 0) : (this.blockedCount[k] ?? 0)) + 1
        : this.lessons?.bumpBlocked
        ? this.lessons.bumpBlocked(k)
        : (this.blockedCount[k] = (this.blockedCount[k] ?? 0) + 1)

      // PRESSURE VALVE. Probation is per-key, so it cannot see the situation
      // where EVERY key the model reaches for is blocked -- each individual
      // veto is defensible while their sum is a bot that does nothing. That is
      // the state the fleet reached: 72% of decisions rejected, the two most
      // blocked actions being `gather oak_log` and `craft stick`, which are
      // exactly the milestone chain it was trying to complete.
      //
      // A gate whose veto rate can reach 100% is not a safety mechanism, it is
      // the failure. After MAX_VETO_STREAK consecutive learned_avoid rejections
      // the next proposal goes through whatever its record, because acting on
      // poor evidence beats not acting at all -- and the outcome becomes new
      // evidence, which a refusal never does.
      if (n % 5 !== 0 && this.vetoStreak >= MAX_VETO_STREAK) {
        this.vetoStreak = 0
        this.forcedAdmissions = (this.forcedAdmissions ?? 0) + 1
        return { ok: true, skill, args, kind: 'forced', forced: `${MAX_VETO_STREAK} consecutive vetoes` }
      }

      if (n % 5 !== 0) {
        this.vetoStreak = (this.vetoStreak ?? 0) + 1
        return {
          ok: false, reason: 'learned_avoid',
          detail: `${skill} with these args has failed ${priorFails}x across runs (retry in ${5 - (n % 5)})`,
          // CITE THE EVIDENCE. Without this a block is unattributable prose, and
          // "did this bot inherit a peer's belief?" becomes unanswerable after
          // the fact -- you cannot tell a block caused by a hive-mate's lesson
          // from one caused by the bot's own, or by a different rule entirely.
          cited: this.lessons?.entryFor?.(skill, args) ?? null,
        }
      }
      // fall through on probation
    }

    // --- oscillation guard --------------------------------------------------
    // REPEATWORK-01: ...unless this gather's last run, on this rung, gained what the rung wants (repeatwork.mjs)
    const repeats = this.recent.filter(k => k === key).length
    const rd = this.#repeat(skill, key)
    if (rd.refuse) {
      this.rwWhy = 'repeat_refused'   // counted by check() with the rest of this proposal's keys (one write)
      return { ok: false, reason: 'repeat_loop', detail: `chose the identical action ${repeats}x in a row` }
    }
    if (rd.why === 'progress') {
      this.rwWhy = 'progress_admits'
      if (!this.dry) try { logEvent({ kind: 'repeat_progress', status: 'success', detail: `${key} repeats=${repeats} rung=${this.activeMilestoneId ?? '-'} -- its last run on this rung gained a wanted item`.slice(0, 300), snapshot: snapshot(bot) }) } catch { /* telemetry only */ }
    }

    this.recent.push(key)
    if (this.recent.length > REPEAT_WINDOW * 2) this.recent.shift()
    this.vetoStreak = 0
    return { ok: true, skill, args, kind: 'normal' }
  }
}
