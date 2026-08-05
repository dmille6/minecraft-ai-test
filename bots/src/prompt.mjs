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
  const usage = [
    '  gather  args: {"block": "<block id e.g. oak_log>", "count": <integer>}',
    '  goto    args: {"x": <int>, "y": <int>, "z": <int>}',
    '  deposit args: {"item": "<item id>"}   (needs a chest nearby)',
    '  come    args: {}',
    '  follow  args: {}',
    '  home    args: {}',
    '  status  args: {}',
    '  eat     args: {}                       (eats food from inventory)',
    '  craft   args: {"item": "<item id e.g. stick>", "count": <integer>}',
    '  place   args: {"item": "<item id in inventory>"}',
    '  mine    args: {"y": <target depth, e.g. 12>}   (staircases down)',
    '  sleep   args: {}                       (needs a bed, only at night)',
  ].join('\n')
  return [
    `You are ${config.bot.name}, an autonomous ${config.bot.role} agent in Minecraft.`,
    ``,
    `Choose exactly ONE next skill to run. You do not write code and you do not`,
    `plan multiple steps -- a controller owns the plan and will tell you the`,
    `current task. Pick the single action that best advances that task.`,
    ``,
    `Available skills (${skillNames.join(', ')}):`,
    usage,
    ``,
    `Rules:`,
    `- Survival first. If health or hunger is low, prefer safe actions.`,
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
  ].join('\n')
}

/**
 * @returns {{user: string, sentinel: string, tokens: number, dropped: number}}
 */
export function buildUserPrompt({ bot, milestone, memory, lastOutcome, trigger, sentinel }) {
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
    `NEARBY: ${nearbyBlocks(bot).join(', ') || 'nothing notable'}`,
    `REACHABLE Y RANGE: ${Math.round(p.y) - 30} to ${Math.round(p.y) + 30} (you are at y=${p.y.toFixed(0)})`,
    Object.keys(memory.locations).length
      ? `KNOWN PLACES: ${Object.entries(memory.locations).map(([k, v]) => `${k}(${v.x},${v.y},${v.z})`).join(', ')}`
      : '',
    lastOutcome ? `LAST ACTION: ${lastOutcome}` : '',
    ``,
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
