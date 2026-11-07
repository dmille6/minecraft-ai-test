// voyager-01: THE PROMPTS (design §2). The same text for every arm. Nothing from the fleet's job list, milestones or town
// plan is in here: the bot chooses its own tasks.

import { FACADE_DOC } from './facade.mjs'
import { KINDS } from './verifier.mjs'

export const CURRICULUM_SYSTEM = `You are the mind of a Minecraft bot exploring a world nobody has seen before. You decide what to do
next. Nobody gives you a list. Your goals: discover new things, get better tools, build things you find interesting, and stay
alive. The world is peaceful (no hostile mobs), there is no Nether and no End, and you cannot use any commands.

Propose ONE next task: something you cannot do yet that teaches you a new ability, or a project you want to build. Keep it
achievable in a few minutes from where you are. Build on what you already have; do not repeat a task you finished unless it
is a step toward something bigger. Avoid tasks that recently failed unless you change the approach.

Reply with ONLY one JSON object, no other text:
{"task": "<one sentence>", "why": "<one sentence>", "success": <one check>}
The check must be one of (${KINDS.join(', ')}):
  {"kind":"have","item":"<item id>","count":<1-64>}          your inventory gains that many (chest takes do not count)
  {"kind":"craft","item":"<item id>"}                       you craft at least one
  {"kind":"placed","block":"<block id>","count":<1-64>}      you place that many and they are still there
  {"kind":"structure","min_blocks":<4-200>,"max_span":<3-24>} you build one connected structure of at least that many placed blocks
  {"kind":"reach","y":<number>,"dir":"below"|"above"}       you end the task at or below/above that height
  {"kind":"reach","block":"<block id>","within":<1-8>}     you end within that distance of such a block
Use exact Minecraft ids (oak_log, cobblestone, iron_ingot, stone_pickaxe).`

function list (xs, n) { return xs.slice(-n).map(x => `- ${x}`).join('\n') || '- (none)' }

export function curriculumUser ({ state, skills, done, failed, refusal }) {
  const inv = Object.entries(state.inventory ?? {}).map(([k, v]) => `${k} x${v}`).join(', ') || 'empty'
  const blocks = Object.entries(state.blocks ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ${v}`).join(', ')
  const near = Object.entries(state.nearby ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing'
  return `STATE
position ${JSON.stringify(state.pos)}, health ${state.health}/20, food ${state.food}/20, biome ${state.biome}, ${state.day ? 'day' : 'night'}
inventory: ${inv}
holding: ${state.holding ?? 'nothing'}
blocks within 8: ${blocks || 'none loaded'}
nearby: ${near}

SKILLS YOU HAVE (name: what it did)
${skills.slice(0, 40).map(s => `- ${s.name}: ${s.description}`).join('\n') || '- (none yet)'}

RECENTLY FINISHED
${list(done, 10)}

RECENTLY FAILED
${list(failed, 10)}
${refusal ? `\nYOUR LAST PROPOSAL WAS REFUSED: ${refusal}\nPropose a different task.` : ''}
What is your next task? JSON only.`
}

export const CODER_SYSTEM = `You write JavaScript skills for a Minecraft bot. A skill is ONE async function that takes \`bot\` and uses
only the calls below. You may also call skills you already have by name, e.g. \`await getWood(bot)\`.

${FACADE_DOC}

Rules:
- Reply with ONLY one \`\`\`javascript code block (no explanation before or after it) containing exactly one \`async function camelCaseName(bot) { ... }\` and nothing else
  at the top level (no imports, no helpers outside the function; define helpers inside it).
- Check \`ok\` after each call and stop (throw an Error with a clear message) when something fails, so the next attempt knows why.
- Look before you act: call bot.observe() / bot.findBlocks() and use the coordinates they return.
- Prefer a few reliable steps over many fragile ones. Never loop forever.`

export function coderUser ({ task, state, related, previous }) {
  const rel = related.map(s => `// ${s.name}: ${s.description}\n${s.code}`).join('\n\n')
  let prev = ''
  if (previous) {
    prev = `\n\nYOUR PREVIOUS ATTEMPT (round ${previous.round}) FAILED.
CODE:
\`\`\`javascript
${previous.code}
\`\`\`
WHAT HAPPENED: ${previous.outcome}
EXECUTION LOG:
${previous.log.slice(-30).join('\n') || '(nothing ran)'}
WORLD CHANGE: ${previous.delta}
Fix it. Write the whole function again.`
  }
  return `TASK: ${task.task}
DONE WHEN: ${JSON.stringify(task.success)} (checked by reading the world afterwards, not by your return value)
STATE: position ${JSON.stringify(state.pos)}, inventory ${JSON.stringify(state.inventory)}, blocks within 8: ${JSON.stringify(state.blocks)}

SKILLS YOU CAN CALL:
${rel || '(none yet)'}${prev}`
}

/** Pull the first JSON object out of a reply (tolerates fences and prose around it). Pure. */
export function parseJsonObject (text) {
  const s = String(text ?? '')
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(s)
  const body = fence ? fence[1] : s
  const start = body.indexOf('{')
  if (start < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < body.length; i++) {
    const c = body[i]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(body.slice(start, i + 1)) } catch { return null } } }
  }
  return null
}
