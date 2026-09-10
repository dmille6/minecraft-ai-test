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

import { SKILLS, actionKey } from './skills.mjs'
import { smeltRecipeFor } from './smelting.mjs'
import { config } from './config.mjs'
import { horizontalDistanceFromSpawn } from './state.mjs'
import { shoreRoute } from './shore.mjs'
import { bankableInventory, depositDue } from './bankable.mjs'


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
const MAX_WATER_VETO_STREAK = 3

// Travel verbs that walk. A bot afloat in open water cannot execute these: the
// land movement profile prices a wet step at ~86 against ~1 and the `cost > 100`
// guards delete wet neighbours, so A* has nowhere to go. Measured in one 10-min
// window on the marooned bots: 850 _path_reset and 91 _path_noPath.
const LAND_TRAVEL = new Set(['goto', 'explore'])

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

export class AdmissionControl {
  constructor(lessons = null) {
    this.lessons = lessons
    this.failedCooldowns = new Map()   // key -> expiry timestamp
    this.recent = []                   // last N admitted keys, for repeat detection
    this.blockedCount = {}             // per-key block tally, for probation
    this.vetoStreak = 0                // consecutive learned_avoid rejections
    this.activeMilestoneId = null      // set by the cognitive layer each decision
    this.waterVetoStreak = 0           // consecutive water-rule rejections
  }

  static key(skill, args) { return actionKey(skill, args) }

  /** Record that a proposal we admitted ended in failure, so we stop re-picking it. */
  noteFailure(skill, args) {
    this.failedCooldowns.set(AdmissionControl.key(skill, args),
                             Date.now() + config.skills.failedCooldownMs)
  }

  noteSuccess(skill, args) {
    this.failedCooldowns.delete(AdmissionControl.key(skill, args))
  }

  /** Called after an escape action, so the model gets a clean slate to choose from. */
  clearRepeatWindow() { this.recent = [] }

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

    // --- argument sanity, per skill ---------------------------------------
    if (skill === 'gather') {
      if (!args.block || typeof args.block !== 'string') {
        return { ok: false, reason: 'bad_args', detail: 'gather needs a block name' }
      }
      if (!bot.registry.blocksByName[args.block]) {
        return { ok: false, reason: 'bad_args', detail: `"${args.block}" is not a real block` }
      }
      const n = Number(args.count)
      if (!Number.isFinite(n) || n <= 0 || n > 128) {
        return { ok: false, reason: 'bad_args', detail: `count ${args.count} outside 1..128` }
      }
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
    if (skill === 'deposit') {
      const items = bot.inventory?.items?.() ?? []
      const bank = bankableInventory(items, { wants: wanted ? [wanted].flat() : [] })
      const onDepositMilestone = this.activeMilestoneId === 'deposit_surplus'
      const due = depositDue({
        bankable: bank.count,
        distHome: horizontalDistanceFromSpawn(bot.entity.position),
        storageWithin48: !!bot.findBlock?.({
          matching: b => ['chest','barrel','trapped_chest']
            .includes(bot.registry?.blocks?.[b.type]?.name), maxDistance: 48 }),
        onDepositMilestone,
        occupiedSlots: items.length,
      })
      if (!due) {
        return { ok: false, reason: 'deposit_not_worth_it',
                 detail: `${bank.count} bankable items and no storage in reach — ` +
                         `bank it when you are next near the chest, not from out here` }
      }
    }

    if (skill === 'swim_to') {
      const { x, y, z } = args
      if (![x, y, z].every(v => Number.isFinite(Number(v)))) {
        return { ok: false, reason: 'bad_args', detail: 'swim_to needs numeric x, y, z' }
      }
      if (!inWater(bot)) {
        return { ok: false, reason: 'not_in_water',
                 detail: 'swim_to crosses water and you are on land — use goto' }
      }
      const dw = horizontalDistanceFromSpawn({ x: Number(x), z: Number(z) })
      if (dw > config.world.borderRadius) {
        return { ok: false, reason: 'outside_border', detail: `${Math.round(dw)} > ${config.world.borderRadius}` }
      }
    }

    // WALKING IS NOT AN OPTION OUT HERE.
    //
    // Not a hazard rule and not a discouragement: a statement of fact about the
    // movement profile. If the bot is afloat with no shore in reach, goto and
    // explore cannot produce a route, so admitting them spends a decision to
    // learn something already known. The rejection names the verb that DOES
    // work, so the model always has a legal move -- which is what keeps this
    // from being a dead end rather than a redirect.
    //
    // Note the ordering: a bot in water WITH a shore in reach is left alone,
    // because walking to that shore is exactly the right move and is what the
    // observation tells it to do.
    if (LAND_TRAVEL.has(skill) && inWater(bot) && shoreRoute(bot).dir !== 'shore') {
      if (this.waterVetoStreak >= MAX_WATER_VETO_STREAK) {
        this.waterVetoStreak = 0
        return { ok: true, skill, args, kind: 'forced',
                 forced: `${MAX_WATER_VETO_STREAK} consecutive water vetoes` }
      }
      this.waterVetoStreak++
      return {
        ok: false, reason: 'water_blocks_land_travel',
        detail: `you are afloat with no shore within reach; ${skill} walks and cannot ` +
                `route from here — use swim_to <x> <y> <z> to cross`,
      }
    }
    if (!LAND_TRAVEL.has(skill) || !inWater(bot)) this.waterVetoStreak = 0

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
      const here = bot.entity?.position?.y
      if (Number.isFinite(here) && y >= here - 1) {
        return { ok: false, reason: 'bad_args',
                 detail: `mine only digs DOWNWARD and you are at y=${Math.round(here)}; ` +
                         `a target of y=${y} is at or above you. Use a LOWER y to descend, ` +
                         `or goto/surface to move upward.` }
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
      const n = this.lessons?.bumpBlocked
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
    const repeats = this.recent.filter(k => k === key).length
    if (repeats >= REPEAT_WINDOW) {
      return { ok: false, reason: 'repeat_loop', detail: `chose the identical action ${repeats}x in a row` }
    }

    this.recent.push(key)
    if (this.recent.length > REPEAT_WINDOW * 2) this.recent.shift()
    this.vetoStreak = 0
    return { ok: true, skill, args, kind: 'normal' }
  }
}
