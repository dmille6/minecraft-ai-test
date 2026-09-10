// Prompt assembly -- ADR-0002 D2 and D4.
//
// Compressed structured state, sliced to a token budget CLIENT-SIDE. Ollama
// truncates silently at num_ctx, so we never let a prompt get near it: we cut
// oldest events first and never the current task.
//
// Memory is structured state plus a short rolling event window -- facts update
// in place, events expire. No growing prose summaries: structured memory is
// bounded by schema, so a four-hour soak cannot grow its own context until it
// truncates.

import { SKILLS } from './skills.mjs'
import { fuelTicks, smeltRecipeFor } from './smelting.mjs'
import { inventorySummary, isNight } from './state.mjs'
import { CLIMB_CEILING } from './reflex.mjs'
import { mineTargetHint } from './mining.mjs'
import { isExposed, isSafeToBreak } from './skills.mjs'
import { logEvent } from './logger.mjs'
import { bankableInventory, depositDue } from './bankable.mjs'
import { config } from './config.mjs'

const MAX_EVENTS = 12
// Rough but adequate: we only need to know when we are near the ceiling, and
// erring small costs a little context while erring large costs correctness.
const estTokens = s => Math.ceil(s.length / 3.6)

export class WorkingMemory {
  constructor() {
    this.events = []          // rolling window
    this.locations = {}       // name -> {x,y,z}, updated in place
    this.notes = {}           // structured facts, updated in place
  }
  addEvent(text) {
    this.events.push({ t: Date.now(), text: String(text).slice(0, 160) })
    while (this.events.length > MAX_EVENTS) this.events.shift()
  }
  remember(name, pos) {
    this.locations[name] = { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) }
  }
}

const INTERESTING_BLOCKS = ['oak_log', 'birch_log', 'spruce_log', 'dirt', 'grass_block',
  'stone', 'coal_ore', 'iron_ore', 'water', 'lava', 'sand', 'crafting_table', 'chest']

/**
 * WHAT THE BOT NEEDS GOES FIRST, BECAUSE THE SCAN RUNS OUT BEFORE THE LIST DOES.
 *
 * Both readers below walk INTERESTING_BLOCKS in LIST ORDER and stop early --
 * `nearbyBlocks` at `limit` (8) entries, `actionableBlocks` at ACTIONABLE_TOTAL
 * (48) checked positions, which is six types at eight each. `iron_ore` is
 * EIGHTH of thirteen. In a forest world the logs, dirt, grass and stone ahead of
 * it consume the whole budget, so iron is never checked and never named in the
 * prompt -- and a capability the observation does not name may as well not
 * exist, which this project has already paid for four times.
 *
 * Measured 2026-09-08, 6h, 80 bots: iron_ore was present in 29,656 affordance
 * scans and USABLE 11,501 times, while `gather` asked for it 73 times -- 0.6% of
 * the requests for something the fleet could see and take. Meanwhile 2,000
 * gather attempts went to dirt.
 *
 * So the milestone's `wants` is hoisted to the front of the walk. It does not
 * change what is scanned, only the order, and therefore which entries survive
 * the cut. Only names already in the list are hoisted: a milestone that wants an
 * ITEM (raw_iron) rather than a block must not turn into a block scan.
 *
 * Pure, so the ordering is testable without a bot.
 */
export function scanOrder (wants, list = INTERESTING_BLOCKS) {
  const asked = (Array.isArray(wants) ? wants : [wants])
    .filter(w => typeof w === 'string' && list.includes(w))
  return [...new Set([...asked, ...list])]
}

function nearbyBlocks(bot, limit = 8, { wants = null } = {}) {
  const interesting = scanOrder(wants)
  const out = []
  for (const name of interesting) {
    const t = bot.registry.blocksByName[name]
    if (!t) continue
    const p = bot.findBlock({ matching: t.id, maxDistance: 40 })
    if (p) out.push(`${name}@${Math.round(bot.entity.position.distanceTo(p.position))}m`)
    if (out.length >= limit) break
  }
  return out
}

// Bounds for the actionability scan. It runs once per decision (~30s), not per
// reflex tick, so it can afford ~6 blockAt per candidate -- but sand and stone
// are everywhere and would otherwise dominate the budget without adding
// information, so each type and the whole scan are capped.
const ACTIONABLE_PER_TYPE = 8
const ACTIONABLE_TOTAL = 48

/**
 * WHAT IS VISIBLE VS WHAT CAN ACTUALLY BE TAKEN.
 *
 * NEARBY has always reported findBlock hits -- visibility. Three hours of
 * fleet telemetry, of 7,031 non-successes:
 *
 *     435  "found but every candidate is BURIED — use mine to dig down"
 *     262  "found but unreachable after N attempts"
 *     227  "found but all candidates are beside water or under falling blocks"
 *
 * Every one of those was decided by tests the gather skill already runs, after
 * the decision had been spent. This runs the same two FACT tests before it.
 *
 * NEARBY IS NOT FILTERED, deliberately. Hiding a visible-but-unusable resource
 * risks a bot reading "nothing notable" while standing beside a forest and
 * wandering off to explore; and the masking literature is clear that a filter
 * encoding preferences rather than facts prevents the agent from ever learning
 * the better policy. So this ADDS a line and hides nothing. `approachable`
 * stays out of it entirely -- "can stand beside" is a heuristic, not proof of
 * reachability, and it has no business gating anything.
 */
export function actionableBlocks (bot, limit = 8, { wants = null } = {}) {
  const t0 = Date.now()
  const out = []
  const stats = []
  let budget = ACTIONABLE_TOTAL
  for (const name of scanOrder(wants)) {
    if (budget <= 0 || out.length >= limit) break
    const type = bot.registry?.blocksByName?.[name]
    if (!type) continue
    let found = []
    try {
      found = bot.findBlocks?.({ matching: type.id, maxDistance: 40,
                                 count: ACTIONABLE_PER_TYPE }) ?? []
    } catch { found = [] }
    if (!found.length) continue
    const checked = found.slice(0, Math.min(ACTIONABLE_PER_TYPE, budget))
    budget -= checked.length
    let usable = 0, unsafe = 0
    for (const p of checked) {
      if (!isExposed(bot, p)) continue          // buried
      if (!isSafeToBreak(bot, p)) { unsafe++; continue }
      usable++
    }
    stats.push({ block: name, visible: found.length, checked: checked.length,
                 usable, unsafe })
    // `usable` WAS A LIE OF OMISSION AND IT COST A NIGHT.
    //
    // Both facts behind it -- isExposed and isSafeToBreak -- are LOCAL. Neither
    // says anything about whether the bot can get there, and unreachability is
    // the dominant failure: 264/h "found but unreachable" against 281/h buried.
    // A bot stranded at y=320 read `oak_log visible=8 usable=8` about logs 230
    // blocks below it. Measured over 7.4h the line moved gather success 16.3%
    // -> 16.0% while attempts rose 8%, which is what a confident wrong signal
    // looks like.
    //
    // So the field says what it actually checked, and names the property it
    // does NOT know. An observation that overclaims is worse than no
    // observation, because the model has no way to discount it.
    out.push(`${name} visible=${found.length} exposed_safe=${usable}` +
             (unsafe ? ` unsafe=${unsafe}` : ''))
  }
  const scanMs = Date.now() - t0
  // COUNTED, NOT JUST RENDERED. Tomorrow's question is whether naming
  // actionability helped, and that needs the denominator -- how many were
  // visible -- beside how many were usable.
  //
  // Deliberately an event and not a new field on the decision row: that index
  // is dynamic:strict, so an unmapped key rejects the WHOLE document with no
  // symptom but a dropped-events line in Filebeat. A telemetry addition that
  // silently deletes all the other telemetry is not an addition.
  //
  // It also carries the backfire check. If bots stop acting on resources they
  // can see, it shows up here as visible>0 with usable=0, and that number
  // exists from the first decision rather than being reconstructed later.
  if (stats.length) {
    const visible = stats.reduce((a, s) => a + s.visible, 0)
    const usable = stats.reduce((a, s) => a + s.usable, 0)
    const unsafe = stats.reduce((a, s) => a + s.unsafe, 0)
    logEvent({
      kind: 'affordance_scan',
      status: usable > 0 ? 'success' : 'no_effect',
      detail: `visible=${visible} usable=${usable} unsafe=${unsafe} ` +
              `scan_ms=${scanMs} | ` +
              stats.map(s => `${s.block}:${s.visible}/${s.checked}/${s.usable}`).join(' '),
    })
  }
  return { line: out.length
             ? `BLOCK CHECKS (reachability NOT checked): ${out.join('; ')}`
             : 'BLOCK CHECKS: nothing visible',
           stats, scanMs }
}

export function buildSystemPrompt(skillNames) {
  // Exact argument KEYS, not prose usage. The model reliably emitted
  // {item: "oak_log"} for gather when told "gather <count> <block_name>",
  // because "oak_log" reads like an item. Naming the JSON keys removes the
  // ambiguity at the source instead of rejecting it afterwards.
  // EVERY SELECTABLE SKILL NEEDS A LINE HERE, and the hints must describe what
  // the skill ACTUALLY does.
  //
  // Both halves were violated. `SKILL_NAMES` is every non-chatOnly skill, and
  // it feeds the schema enum AND the "Available skills" list -- so the model
  // could select `build`, `withdraw`, `explore` and `surface` while this block
  // documented none of them. Over ~200K logged decisions `build` was proposed
  // ZERO times and `withdraw` 25, which is what an undocumented affordance
  // looks like from the outside. A preflight assertion now fails if the two
  // lists diverge again.
  //
  // The accuracy half matters just as much. 732 decisions stated an intent to
  // "pillar out" of a hole and fell back to `gather`, and the tempting fix was
  // to advertise `place` as the way out. It is not: place() searches the eight
  // HORIZONTAL neighbours (and one step up or down) for a solid block with room
  // above it -- it never places underfoot. Pillaring lives inside `surface`,
  // which jumps and places under the feet. Advertising `place` as an escape
  // would have manufactured a false affordance and taught the model to pick a
  // verb that cannot do the job.
  // `come`, `follow` and `sleep` are chatOnly and therefore NOT in this list:
  // the schema enum excludes them, so the grammar makes them inexpressible and
  // documenting them spends prompt tokens teaching moves the model cannot make.
  // prompt-usage-coverage.test.mjs asserts both directions of that rule.
  const usage = [
    '  gather  args: {"block": "<block id e.g. oak_log>", "count": <integer>}',
    '  goto    args: {"x": <int>, "y": <int>, "z": <int>}',
    '  deposit args: {"item": "<item id>"}   (walks home to the town chest if none nearby; omit item to deposit everything)',
    '  withdraw args: {"item": "<item id>", "count": <integer>}  (takes from a chest or barrel within 48 blocks)',
    '  home    args: {}',
    '  status  args: {}',
    '  eat     args: {}                       (eats food from inventory)',
    '  craft   args: {"item": "<item id e.g. stick>", "count": <integer>}',
    // THE MODEL CANNOT SEE A CAPABILITY THAT IS NOT NAMED HERE -- four failures
    // in one day were exactly that. The item named is the INPUT, because that
    // is what the bot is carrying and looking at; asking for the output would
    // make the model translate raw_iron -> iron_ingot with no table to do it.
    '  smelt   args: {"item": "<the RAW item you carry, e.g. raw_iron>", "count": <integer>}',
    '          (cooks it in a furnace: raw_iron -> iron_ingot, raw_copper -> copper_ingot,',
    '           any log -> charcoal, sand -> glass, raw meat -> cooked. Needs a furnace:',
    '           it places one from your inventory if there is none nearby. Needs fuel:',
    '           coal, charcoal, planks or logs. One coal smelts 8 items, 10s each.)',
    '  place   args: {"item": "<item id in inventory>"}   (places NEXT TO you, not underfoot — to climb out of a hole use surface)',
    '  bucket  args: {"action": "fill"|"pour"}  (fill scoops a water SOURCE within reach — flowing water will not fill it, and a source that would refill in 5 ticks is refused. pour places a water source in a free cell within reach: ride it down a shaft, or make water where you need it. Needs a bucket; craft one from 3 iron_ingot at a crafting_table)',
    '  build   args: {"plan": "pillar", "block": "<block id>"}',
    // "target depth" was read as a DEPTH TO DIG rather than an elevation to
    // stop at, and the gate refused the result 2,211 times in three hours --
    // 10% of every decision the fleet made, the single largest abort reason.
    // The verb only descends, so the constraint is stated where the argument
    // is described rather than left to be discovered by rejection.
    '  mine    args: {"y": <ABSOLUTE elevation to stop at — MUST BE LOWER THAN YOUR CURRENT y>}',
    '          (staircases DOWNWARD only; it cannot climb. To go UP use surface.',
    '           Your current y is in the ELEVATION line. Terrain sits near y=62-90,',
    '           ores are below y=16. A y at or above your own is always refused.)',
    '  explore args: {"blocks": <distance, e.g. 60>}  (travels away from spawn looking for new ground)',
    '  surface args: {}                       (THE WAY OUT when stuck below ground: climbs, and pillars up under itself using blocks you carry. If it reports needing scaffold, gather that block and run surface again)',
    // ARM-SPECIFIC CAPABILITY APPENDIX. The board exists only in the arms that
    // have one, and the placebo arm gets a structurally equivalent line for a
    // trip that shares nothing -- if one arm's prompt gains an affordance, the
    // control's must gain one of the same shape, or the comparison measures
    // prompt length as well as memory.
    ...(config.memory.scope === 'board'
        ? ['  board   args: {}                       (walk to the town board: file what you have learned, read what others filed)']
        : config.memory.scope === 'checkpoint'
        ? ['  board   args: {}                       (walk to the town totem and checkpoint your own memory)']
        : []),
  ].join('\n')
  // IDENTITY GOES LAST, AND THAT IS A PERFORMANCE DECISION.
  //
  // llama.cpp (and therefore Ollama) reuses the KV cache for a shared prompt
  // PREFIX. This block used to open with `You are ${config.bot.name}` -- a
  // unique token 0 per bot -- so no two bots in the fleet shared a single
  // cached token, and every request paid full prefill.
  //
  // Measured on the Studio with a 940-token prompt, two different bot names:
  //     identity first:  2.05s then 2.17s   (no sharing)
  //     identity last:   2.18s then 0.19s   (11x faster on the second)
  //
  // Everything above the identity line is byte-identical across the fleet, so
  // the second and subsequent bots to ask hit a warm cache. With 13 bots
  // against shared endpoints this is the cheapest latency win available.
  return [
    `Choose exactly ONE next skill to run. You do not write code and you do not`,
    `plan multiple steps -- a controller owns the plan and will tell you the`,
    `current task. Pick the single action that best advances that task.`,
    ``,
    `Available skills (${skillNames.join(', ')}):`,
    usage,
    ``,
    `Rules:`,
    `- Survival first. If health or hunger is low, prefer safe actions.`,
    // ENGLISH, STATED EXPLICITLY. qwen2.5 is bilingual and the 7B on instance #1
    // began emitting the reason field in Chinese -- correct reasoning
    // ("try to gather stone to make a stone pickaxe"), unreadable telemetry. The
    // JSON schema constrains structure, not language, so nothing downstream was
    // going to catch it. This line lives above the identity line so it stays part
    // of the byte-identical shared prefix and costs no cache locality.
    `- Write the reason field in English.`,
    // The town chest is a fact of the world, and the death-economics behind it
    // are the fact that matters: Block 1's biggest producer drowned with full
    // pockets over and over, and nothing it gathered outlived it. Same for
    // every bot, so this line stays in the byte-identical shared prefix.
    `- A town stockpile chest sits at home. Items you CARRY are lost when you`,
    `  die; items you DEPOSIT are kept forever and count as the colony's`,
    `  progress. When your inventory holds more than you need for the current`,
    `  task, run deposit.`,
    `- Beds stand at home, and the town keeps torches in the stockpile chest.`,
    `  Sleeping at night moves your respawn to your bed, so dying costs you`,
    `  far less travel. At night, prefer sleep over wandering in the dark.`,
    `- Stay inside the world border (radius ${config.world.borderRadius} from 0,0).`,
    `- For goto, y is ELEVATION, not distance. Terrain here sits around y=62-90.`,
    `  Use a y close to your current one. y=140 is high in the sky and`,
    `  unreachable; picking it wastes the whole decision.`,
    `- If an action just failed, do NOT repeat it identically; try a different`,
    `  approach or a different target.`,
    `- Crafting needs ingredients. If craft fails for missing materials, gather`,
    `  them first: 1 oak_log -> 4 oak_planks; 2 oak_planks -> 4 stick;`,
    `  4 oak_planks -> 1 crafting_table; 3 planks + 2 sticks -> wooden_pickaxe;`,
    `  3 cobblestone + 2 sticks -> stone_pickaxe. Stone needs a pickaxe to drop`,
    `  cobblestone, so make a wooden pickaxe before mining.`,
    // IRON IS NOW REACHABLE AND THE PROMPT HAS TO SAY SO. `craft iron_pickaxe`
    // is not a craft the model can reason its way to: the ingot is not in any
    // crafting recipe the registry will show it, because a furnace makes it.
    `- Iron: mine down to find iron ore, gather it (you get raw_iron), then`,
    `  smelt item=raw_iron to get iron_ingot. 3 iron_ingot + 2 sticks ->`,
    `  iron_pickaxe. Smelting needs a furnace (8 cobblestone) and fuel.`,
    `- "reason" must be one short sentence explaining the choice.`,
    `- Copy the saw_end value from the end of the user message exactly.`,
    ``,
    // Last line on purpose -- see the note above buildSystemPrompt's return.
    `You are ${config.bot.name}, an autonomous ${config.bot.role} agent in Minecraft.`,
  ].join('\n')
}

/**
 * @returns {{user: string, sentinel: string, tokens: number, dropped: number}}
 */
// TELLING THE MODEL IT IS IN WATER, which it previously had no way to know.
//
// The STATE line carried health, hunger, position and time of day, and nothing
// about the medium the bot was standing in. So `swim_to` shipped with a usage
// line saying "use this when you are ALREADY IN WATER" to a model that was never
// told when that was true -- a capability the fleet had on paper and could not
// reach.
//
// It deliberately reuses shoreRoute, the SAME detector the drowning reflex
// steers by. If the model's picture of the shoreline and the reflex's ever
// disagree, the model will ask for crossings the body then fights, which is the
// livelock this whole change set exists to remove.
function waterSituation (bot) {
  const at = bot?.entity?.position
  if (!at || !bot.blockAt) return ''
  const feet = bot.blockAt(at)
  const inWater = !!feet && (feet.name === 'water' || feet.name === 'bubble_column')
  if (!inWater) return ''
  // THIS LINE USED TO POINT AT LAND. It opened with "Nearest land is N blocks
  // away ... goto that spot to get out", which told the model that being in
  // water was a state to be cured. It is not. Swimming is one of the ways a bot
  // moves, alongside walking and jumping, and a prompt that frames it as an
  // emergency gets a bot that abandons a crossing halfway.
  //
  // TELLING IT TO SWIM WITHOUT TELLING IT WHERE IS WORSE THAN SAYING NOTHING.
  //
  // An earlier version said "use swim_to <x> <y> <z> to cross to where you want
  // to be" and stopped there. A bot in open water does not know where anything
  // is, so the model supplied the only coordinates it had -- its own -- and
  // asked for one-block and zero-block "crossings":
  //
  //     _swim_started | crossing 1b to 542,191
  //     _swim_started | crossing 0b to 544,185
  //     swim_to       | stalled 0b out; closed 0b of 1b
  //
  // An instruction the model cannot act on gets answered with an action that
  // does nothing, and it reads as the SKILL failing rather than the PROMPT
  // failing. So name a destination it can actually use. Home is the one place
  // every bot knows and it is on land by construction -- offered as a known
  // coordinate, not as an escape.
  const hx = config.world.homeX, hy = config.world.homeY, hz = config.world.homeZ
  const d = Math.hypot(hx - at.x, hz - at.z)
  // "goto cannot cross water" WAS NEVER TRUE, and this line taught it to the
  // model 1,278 times a day. mineflayer-pathfinder swims unconditionally, and
  // the only thing genuinely missing was stepping back out onto a shore -- a
  // height-arithmetic bug, now fixed in watermoves.mjs. The destination advice
  // below is kept verbatim: it was earned separately, by a bot that asked for
  // zero-block crossings because it had been told to swim without being told
  // where to.
  return `IN WATER: you are swimming. This is travel, not an emergency — swimming is a ` +
         `way of moving, like walking. Getting air when it runs low is handled for you, ` +
         `so you do not need to head for land. goto and explore work here exactly as they ` +
         `do on land; the route simply swims. Your town is ${d.toFixed(0)} ` +
         `blocks ${bearing(hx - at.x, hz - at.z)} at ${hx},${hy},${hz} — goto ${hx} ` +
         `${hy} ${hz} heads there. Give a destination that is actually somewhere else, ` +
         `never your own position.`
}

/** Compass direction, because "west" is actionable and "dx=-812" is not. */
// Terrain band for this world, stated once. The system prompt quotes the same
// numbers; if they ever disagree the model gets two answers to one question.
const TERRAIN_LOW = 62
const TERRAIN_HIGH = 90

/**
 * WHAT THIS LINE USED TO SAY, AND WHAT IT COST.
 *
 *     `REACHABLE Y RANGE: ${y - 30} to ${y + 30} (you are at y=${y})`
 *
 * It is relative to wherever the bot already is, so it can only ever agree
 * with the bot. Two bots sat at the build limit for six hours reading
 *
 *     REACHABLE Y RANGE: 290 to 350 (you are at y=320)
 *
 * which says the SKY is reachable and never mentions that the ground is 250
 * blocks below. It was the only elevation information in the whole prompt, and
 * it argued for staying exactly where they were.
 *
 * An absolute band cannot do that: it is the same sentence wherever the bot
 * stands, so it disagrees with a bot that has climbed somewhere silly. The
 * stranded case names `mine` because an affordance the observation does not
 * name is one the model does not have -- and both stranded bots were carrying
 * the pickaxe `mine` needs while trying to craft another one.
 */
export function yContext (y) {
  const yr = Math.round(y)
  // The mine constraint travels WITH the elevation, on every branch, because the
  // model cannot obey a rule the observation does not carry.
  const mh = mineTargetHint(y)
  const tail = mh ? ` ${mh}` : ''
  if (yr >= CLIMB_CEILING) {
    return `ELEVATION: y=${yr} — ABOVE THE CLIMB CEILING (${CLIMB_CEILING}). ` +
      `Ground is ~${yr - TERRAIN_HIGH} blocks BELOW you, around y=${TERRAIN_LOW}-${TERRAIN_HIGH}. ` +
      `Climbing cannot help and falling from here is lethal: you must DESCEND ` +
      `(mine digs a staircase down). Do not goto a distant target until you are down.` + tail
  }
  if (yr < TERRAIN_LOW) {
    return `ELEVATION: y=${yr} — below the surface, which is around ` +
      `y=${TERRAIN_LOW}-${TERRAIN_HIGH}. Use surface to get out before a distant goto.` + tail
  }
  return `ELEVATION: y=${yr}. Surface terrain here is y=${TERRAIN_LOW}-${TERRAIN_HIGH}; ` +
    `keep goto targets near your current elevation.` + tail
}

function bearing (dx, dz) {
  // +x is east and +z is south in Minecraft.
  const dirs = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast']
  const a = Math.atan2(dz, dx) * 180 / Math.PI
  return dirs[Math.round(((a + 360) % 360) / 45) % 8]
}

// WHAT THE BOT COULD MAKE RIGHT NOW, WHICH IT WAS NEVER TOLD.
//
// The observation carried INVENTORY -- raw item names and counts -- and left the
// model to derive recipes from it. That is a lot to ask of a 7B model, and it
// failed in the most expensive way available:
//
// isolated-a-Alpha sat entombed at y=2 for TEN HOURS carrying 24
// cobbled_deepslate, 6 sticks and 99 crafting tables. A stone pickaxe is 3
// cobblestone-family blocks plus 2 sticks; cobbled_deepslate qualifies. It could
// have dug itself out at any moment. It never tried, because nothing ever told
// it that it could, and it spent those hours failing to craft the wooden pickaxe
// its milestone named -- wood being on the surface, and the surface needing a
// pickaxe.
//
// This is the same shape as the IN WATER line: the model cannot choose what it
// cannot see. Inventory-aware (`recipesFor` checks requirementsMetForRecipe), so
// it lists what is ACTUALLY makeable, not what exists in the recipe book.
//
// Curated rather than exhaustive: this runs once per ~30s cognitive cycle, and
// the useful answer is "which rung of the ladder is open", not a catalogue.
const CRAFT_TARGETS = [
  'stone_pickaxe', 'iron_pickaxe', 'wooden_pickaxe',
  'stone_axe', 'wooden_axe', 'stone_sword', 'wooden_sword', 'stone_shovel',
  'furnace', 'crafting_table', 'chest', 'ladder', 'torch', 'stick', 'oak_planks',
]

/**
 * Can this bot reach a crafting table, and how?
 *
 * A CARRIED table was the only thing that counted, and that hid real
 * opportunities. `craft` resolves its own prerequisites by crafting a table and
 * PLACING it, so the common state right after a successful craft is: table on
 * the ground, none in the pack -- and the affordance line then told the bot it
 * could not make any 3x3 recipe while it stood next to one.
 *
 * 32 blocks because that is the radius `craft` itself searches before walking
 * (skills.mjs findChest/table scan), so this promises exactly what the skill
 * will deliver rather than a different number.
 *
 * Pure-but-for-the-world-read and exported, because "which recipes are
 * available" is a decision the model acts on, and a source grep cannot tell a
 * correct affordance from a comment about one.
 */
export function tableAccess (bot) {
  const items = bot.inventory?.items?.() ?? []
  if (items.some(i => i.name === 'crafting_table')) return { has: true, carried: true, near: null }
  let near = null
  try {
    near = bot.findBlock?.({
      matching: b => bot.registry?.blocks?.[b.type]?.name === 'crafting_table',
      maxDistance: 32,
    }) ?? null
  } catch { near = null }
  return { has: !!near, carried: false, near }
}

function craftableNow (bot) {
  try {
    const items = bot.inventory?.items() ?? []
    // A carried table can be placed; a PLACED one within reach counts too.
    const access = tableAccess(bot)
    const hasTable = access.has
    const made = []
    for (const name of CRAFT_TARGETS) {
      if (items.some(i => i.name === name && i.count > 0) && !name.endsWith('_pickaxe')) continue
      const it = bot.registry?.itemsByName?.[name]
      if (!it) continue
      const r = bot.recipesFor(it.id, null, 1, hasTable ? true : null)
      if (r && r.length) made.push(name)
      if (made.length >= 6) break
    }
    if (!made.length) return ''
    // SAY WHICH, because the two need different next actions: one is "put it
    // down", the other is "walk to it", and telling a bot to place a table it
    // does not carry is a remedy it cannot perform.
    const how = access.carried
      ? ' (you carry a crafting_table — place it first for the 3x3 recipes)'
      : access.near
        ? ` (a crafting_table is already placed at ${access.near.position.x},` +
          `${access.near.position.y},${access.near.position.z} — craft will walk to it)`
        : ''
    return `CAN CRAFT NOW: ${made.join(', ')}${how}`
  } catch { return '' }
}

/**
 * CAN SMELT NOW -- the observation without which `smelt` is present, not shipped.
 *
 * The four cases in affordances.json are all the same failure: a capability
 * that existed, was documented, and was silent, and whose silence was
 * indistinguishable from the model declining to use it. swim_to shipped with a
 * usage line and ZERO uses until `IN WATER` named the situation.
 *
 * Smelting is the worst possible candidate for silence, because the model
 * cannot derive it. `CAN CRAFT NOW` is built from bot.recipesFor, and there is
 * no smelting recipe in the registry AT ALL -- minecraft-data ships none (see
 * smelting.mjs). So a bot holding raw_iron, a furnace and a coal has every
 * ingredient of the fleet's first ingot and not one signal that says so.
 * Measured right now: 59 of 80 bots carry a furnace, 30 carry coal, 13 hold
 * raw_iron, and `iron_ingot` has never existed.
 *
 * SILENT WHEN IT DOES NOT APPLY, which the affordance contract requires and
 * which is half the point: a line that is always on carries no information and
 * costs tokens on every decision. This one needs an input, a furnace and fuel
 * to be simultaneously true, so it fires exactly when smelt would work.
 */
function smeltableNow (bot) {
  try {
    const items = bot.inventory?.items?.() ?? []
    if (!items.length) return ''
    const held = {}
    for (const i of items) held[i.name] = (held[i.name] ?? 0) + i.count

    // Fuel and furnace are the two things smelt cannot proceed without, and
    // naming which one is missing would be a different line -- this one only
    // fires when the bot can actually act, so it never advertises a dead end.
    if (!(held.furnace > 0 || bot.findBlock?.({
      matching: b => bot.registry?.blocks?.[b.type]?.name === 'furnace', maxDistance: 32,
    }))) return ''
    if (!Object.keys(held).some(n => fuelTicks(n) > 0)) return ''

    const pairs = []
    for (const name of Object.keys(held)) {
      const r = smeltRecipeFor(name)
      // Never suggest burning the last of something that IS the fuel unless
      // there is enough for both jobs -- the same guard smeltPlan applies, so
      // the line cannot promise a smelt the skill will then refuse.
      if (!r) continue
      if (fuelTicks(name) > 0 && held[name] < 2 &&
          !Object.keys(held).some(o => o !== name && fuelTicks(o) > 0)) continue
      pairs.push(`${name} -> ${r.output}`)
      if (pairs.length >= 4) break
    }
    if (!pairs.length) return ''
    return `CAN SMELT NOW: ${pairs.join(', ')} (smelt item=<the raw one>; ` +
           `you have a furnace and fuel). This is the ONLY way to get an ingot.`
  } catch { return '' }
}

// MILESTONES CREATE OBLIGATIONS; THE OBSERVATION CREATES BEHAVIOUR.
//
// `deposit_surplus` was added to the SUSTAINING chain and produced ZERO deposits
// in six bot-hours, because it sits behind `return`, which requires being within
// 15 blocks of home -- and the median bot is 804 blocks away, with only 9% of
// samples inside 100. The rung was placed behind a gate bots essentially never
// pass. The model asked for `deposit` once in ~630 tool calls.
//
// This is the third time today the same thing has been true: a capability
// existed, the goal layer knew about it, and nothing changed until the
// OBSERVATION named it. `IN WATER` moved swim behaviour within minutes.
// `CAN CRAFT NOW` moved a ten-hour-entombed bot from asking for a wooden pickaxe
// to asking for a stone one, also within minutes.
//
// So the same treatment. Shown only when a deposit is actually WORTH making --
// the same predicate the admission gate uses -- because a line urging a bot to
// bank from 800 blocks out would be advice it should not take.
function depositSituation (bot, memory) {
  try {
    const items = bot.inventory?.items?.() ?? []
    if (!items.length) return ''
    const bank = bankableInventory(items)
    const home = memory?.locations?.home
    const p = bot.entity?.position
    if (!p) return ''
    const distHome = home
      ? Math.hypot(home.x - p.x, home.z - p.z)
      : Math.hypot(config.world.homeX - p.x, config.world.homeZ - p.z)
    const storage = bot.findBlock?.({
      matching: b => ['chest', 'barrel', 'trapped_chest']
        .includes(bot.registry?.blocks?.[b.type]?.name),
      maxDistance: 48,
    })
    if (!depositDue({ bankable: bank.count, distHome, storageWithin48: !!storage,
                      occupiedSlots: items.length })) return ''
    const where = storage
      ? `storage is ${Math.round(p.distanceTo(storage.position))} blocks away`
      : `the town chest is ${Math.round(distHome)} blocks away`
    return `CARRYING: ${bank.count} items worth banking and ${where}. ` +
           `Use deposit — banked items survive your death, carried ones do not. ` +
           `Your tools and climb-out blocks are kept automatically.`
  } catch { return '' }
}

/**
 * THE BUCKET LINE. A capability is not shipped until the observation names it.
 *
 * This project has paid for that four times in a day, and the affordance
 * registry now enforces it: a new skill with no observation "defaults to
 * invisible, and invisible reads as the model choosing not to use it".
 *
 * So the line appears only for a bot that HOLDS one -- 78 of 80 have never held
 * a bucket, and a verb they cannot perform is noise in every decision they make
 * -- and it names the skill, the two verbs, and the one Minecraft rule that
 * otherwise wastes the attempt silently (flowing water will not fill).
 */
export function bucketSituation (bot) {
  try {
    const items = bot.inventory?.items?.() ?? []
    const empty = items.filter(i => i.name === 'bucket').reduce((n, i) => n + (i.count ?? 0), 0)
    const full = items.filter(i => i.name === 'water_bucket').reduce((n, i) => n + (i.count ?? 0), 0)
    if (!empty && !full) return ''
    // NAME THE OPPORTUNITY, NOT JUST THE CAPABILITY.
    //
    // The first version said "you have an empty bucket, fill it on a water
    // source" and the model dutifully tried: 29 of 30 `bucket fill` calls in the
    // hour after the arg became expressible failed with "not water (air)" or
    // "not water (stone)". The line named a verb the bot could say and a
    // situation it was not in.
    //
    // So the fill half only appears when a water SOURCE is actually within
    // reach, checked the same way the skill checks it. An affordance that is not
    // true where the bot is standing is noise in every decision it makes.
    const at = (dx, dy, dz) => { try { return bot.blockAt(bot.entity.position.offset(dx, dy, dz)) } catch { return null } }
    let source = null
    for (let dy = 1; dy >= -1 && !source; dy--) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const b = at(dx, dy, dz)
        // metadata 0 is a SOURCE. Flowing water will not fill a bucket, and
        // offering it is how the 29 failures happened.
        if (b && b.name === 'water' && b.metadata === 0) { source = true; break }
      }
    }
    const parts = []
    if (full) parts.push(`${full} water_bucket — bucket action=pour places a water source in a ` +
                         `free cell within reach; you can ride it down instead of falling`)
    if (empty && source) parts.push(`${empty} empty bucket AND a water source within reach — ` +
                                    `bucket action=fill takes it`)
    if (!parts.length) return ''
    return `CARRYING A BUCKET: ${parts.join('. ')}.`
  } catch { return '' }
}

export function buildUserPrompt({ bot, milestone, memory, lastOutcome, trigger, sentinel, lessons }) {
  const p = bot.entity.position
  const actionable = actionableBlocks(bot, 8, { wants: milestone?.wants })
  const inv = inventorySummary(bot)
  const invStr = Object.entries(inv).map(([k, v]) => `${k} x${v}`).join(', ') || 'empty'

  const head = [
    `TASK: ${milestone.describe}`,
    `PROGRESS: ${milestone.progress}`,
    milestone.hint ? `HINT: ${milestone.hint}` : '',
    ``,
    `TRIGGER: ${trigger}`,
    `STATE: health ${bot.health ?? '?'}/20, hunger ${bot.food ?? '?'}/20, ` +
      `position ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}, ` +
      `${isNight(bot) ? 'night' : 'day'}, day ${Math.floor(bot.time?.day ?? 0)}`,
    `INVENTORY: ${invStr}`,
    craftableNow(bot),
    smeltableNow(bot),
    depositSituation(bot, memory),
    `NEARBY: ${nearbyBlocks(bot, 8, { wants: milestone?.wants }).join(', ') || 'nothing notable'}`,
    actionable.line,
    waterSituation(bot),
    bucketSituation(bot),
    yContext(p.y),
    Object.keys(memory.locations).length
      ? `KNOWN PLACES: ${Object.entries(memory.locations).map(([k, v]) => `${k}(${v.x},${v.y},${v.z})`).join(', ')}`
      : '',
    lastOutcome ? `LAST ACTION: ${lastOutcome}` : '',
    ``,
    // Persistent across restarts, unlike RECENT EVENTS. This is the only part
    // of the prompt that carries experience from previous runs, and it is
    // built from counted outcomes rather than generated text.
    ...(lessons?.length ? ['LESSONS FROM PAST RUNS:', ...lessons.map(l => `  - ${l}`), ''] : []),
  ].filter(Boolean)

  // Events are the only unbounded part, so they are what we drop first.
  const budget = config.llm.promptTokenBudget
  let events = memory.events.slice()
  let dropped = 0
  const render = evs => [
    ...head,
    evs.length ? `RECENT EVENTS (oldest first):` : '',
    ...evs.map(e => `  - ${e.text}`),
    ``,
    `saw_end: ${sentinel}`,
  ].filter(Boolean).join('\n')

  let user = render(events)
  while (estTokens(user) > budget && events.length > 0) {
    events.shift(); dropped++
    user = render(events)
  }
  // The scan's COUNTS travel with the decision, not just its rendered line.
  // Tomorrow's question is whether this helped, and that needs the denominator
  // -- how many were visible -- beside how many were usable. A prompt line
  // alone would leave us re-parsing prose to find out, which is the mistake
  // that once recorded our own 25s wall clock as "no route exists" 393 times.
  return { user, sentinel, tokens: estTokens(user), dropped,
           affordance: { blocks: actionable.stats, scanMs: actionable.scanMs } }
}

export function makeSentinel() {
  return 'END-' + Math.random().toString(36).slice(2, 8).toUpperCase()
}
