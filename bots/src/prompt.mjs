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
import { inventorySummary, isNight } from './state.mjs'
import { shoreRoute } from './reflex.mjs'
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

function nearbyBlocks(bot, limit = 8) {
  const interesting = ['oak_log', 'birch_log', 'spruce_log', 'dirt', 'grass_block',
    'stone', 'coal_ore', 'iron_ore', 'water', 'lava', 'sand', 'crafting_table', 'chest']
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
    '  swim_to args: {"x": <int>, "y": <int>, "z": <int>}  (CROSSING WATER on purpose. ONLY valid when an IN WATER line appears above — on land it is rejected before it runs. goto walks around water and cannot route across open water; swim_to swims it, and ends when you reach land near the target)',
    '  deposit args: {"item": "<item id>"}   (walks home to the town chest if none nearby; omit item to deposit everything)',
    '  withdraw args: {"item": "<item id>", "count": <integer>}  (takes from a chest or barrel within 48 blocks)',
    '  home    args: {}',
    '  status  args: {}',
    '  eat     args: {}                       (eats food from inventory)',
    '  craft   args: {"item": "<item id e.g. stick>", "count": <integer>}',
    '  place   args: {"item": "<item id in inventory>"}   (places NEXT TO you, not underfoot — to climb out of a hole use surface)',
    '  build   args: {"plan": "pillar", "block": "<block id>"}',
    '  mine    args: {"y": <target depth, e.g. 12>}   (staircases down)',
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
  const shore = shoreRoute(bot)
  if (shore.dir === 'shore') {
    return `IN WATER: you are swimming. Nearest land is ${shore.dist.toFixed(0)} blocks away at ` +
           `${Math.round(shore.target.x)},${Math.round(shore.target.y)},${Math.round(shore.target.z)}. ` +
           `goto that spot to get out.`
  }
  // TELLING IT TO SWIM WITHOUT TELLING IT WHERE IS WORSE THAN SAYING NOTHING.
  //
  // The first version of this line said "use swim_to <x> <y> <z> to cross to
  // where you want to be" and stopped there. A bot in open water does not know
  // where land is -- that is the definition of the situation -- so the model
  // supplied the only coordinates it had, its own, and asked for one-block and
  // zero-block "crossings". Measured within ten minutes of shipping it:
  //
  //     _swim_started | crossing 1b to 542,191
  //     _swim_started | crossing 0b to 544,185
  //     swim_to       | stalled 0b out; closed 0b of 1b
  //     swim_to       | aborted: oxygen 3, letting the reflex surface us
  //
  // An instruction the model cannot act on gets answered with an action that
  // does nothing, and it reads as the SKILL failing rather than the PROMPT
  // failing. So name a destination it can actually use: home is the one place
  // every bot knows, it is on land by construction, and swimming toward it is
  // never the wrong direction when the alternative is treading water.
  const hx = config.world.homeX, hy = config.world.homeY, hz = config.world.homeZ
  const d = Math.hypot(hx - at.x, hz - at.z)
  return `IN WATER: you are in OPEN WATER with no land within 24 blocks. This is not an ` +
         `emergency — you are at the surface and breathing. goto cannot cross water; it ` +
         `walks around it. Your town is ${d.toFixed(0)} blocks ${bearing(hx - at.x, hz - at.z)} ` +
         `at ${hx},${hy},${hz} — swim_to ${hx} ${hy} ${hz} heads back to land. Give swim_to a ` +
         `destination that is actually across the water, never your own position.`
}

/** Compass direction, because "west" is actionable and "dx=-812" is not. */
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

function craftableNow (bot) {
  try {
    const items = bot.inventory?.items() ?? []
    // A carried crafting table can be placed, so 3x3 recipes are reachable.
    const hasTable = items.some(i => i.name === 'crafting_table')
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
    return `CAN CRAFT NOW: ${made.join(', ')}` +
           (hasTable ? ' (you carry a crafting_table — place it first for the 3x3 recipes)' : '')
  } catch { return '' }
}

export function buildUserPrompt({ bot, milestone, memory, lastOutcome, trigger, sentinel, lessons }) {
  const p = bot.entity.position
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
    `NEARBY: ${nearbyBlocks(bot).join(', ') || 'nothing notable'}`,
    waterSituation(bot),
    `REACHABLE Y RANGE: ${Math.round(p.y) - 30} to ${Math.round(p.y) + 30} (you are at y=${p.y.toFixed(0)})`,
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
  return { user, sentinel, tokens: estTokens(user), dropped }
}

export function makeSentinel() {
  return 'END-' + Math.random().toString(36).slice(2, 8).toUpperCase()
}
