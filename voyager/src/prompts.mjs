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

// ---------------------------------------------------------------------------------------------------------------------
// HARNESS 2 (11-12, owner "fix the harness"). Everything above is harness 1 and stays byte-identical: stages 3, 3b and 4
// are compared on it (test/harness2.test.mjs pins its hashes). An arm opts in with VOYAGER_HARNESS=2. Measured on the 3b
// Haiku arms before writing this:
//   - the proposer saw the first 40 skills in file order (alphabetical after a restart) of ~950, and 10 finished tasks;
//   - a third of its task texts were a thought revised in mid-sentence ("craft a stone_hoe-free useful item ... no,
//     instead"), and each one went back into RECENTLY FINISHED for the next proposal to imitate;
//   - the coder saw 5 skills by word overlap -- five rewrites of one ability -- and the prompt only said it "may" call them.

/** What a success check asks for, in a few plain words. History lines use this, never model-written text. Pure. */
export function describeOutcome (s) {
  switch (s?.kind) {
    case 'have': return `got ${s.count} ${s.item}`
    case 'craft': return `crafted ${s.item}`
    case 'placed': return `placed ${s.count} ${s.block}`
    case 'structure': return `built a connected structure of ${s.min_blocks}+ blocks within a span of ${s.max_span}`
    case 'reach': return s.y != null ? `ended ${s.dir} y=${s.y}` : `ended within ${s.within} of ${s.block}`
    default: return 'unknown outcome'
  }
}

const ABILITY_LABEL = { have: 'gathered or made', craft: 'crafted', placed: 'placed', structure: 'built structures', reach: 'reached' }
export const ABILITY_IDS_PER_KIND = 160

/**
 * Every outcome the library holds, grouped by check kind, with a count where it was repeated: the WHOLE picture in a few
 * hundred tokens, in place of 40 skill descriptions. `skills` need only {signature}. Pure.
 */
export function abilitySummary (skills) {
  const by = new Map()
  for (const s of skills) {
    const sig = String(s?.signature ?? '')
    const i = sig.indexOf(':')
    if (i < 1 || i === sig.length - 1) continue
    const kind = sig.slice(0, i), id = sig.slice(i + 1)
    if (!by.has(kind)) by.set(kind, new Map())
    by.get(kind).set(id, (by.get(kind).get(id) ?? 0) + 1)
  }
  const lines = []
  for (const kind of KINDS) {
    const m = by.get(kind)
    if (!m) continue
    // the most repeated first, so the repeats are seen even when the list is cut
    const ids = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    const shown = ids.slice(0, ABILITY_IDS_PER_KIND).map(([id, n]) => n >= 2 ? `${id} x${n}` : id)
    lines.push(`${ABILITY_LABEL[kind]}: ${shown.join(', ')}${ids.length > shown.length ? `, and ${ids.length - shown.length} more` : ''}`)
  }
  return lines.join('\n') || '(nothing yet)'
}

const V1_FORMAT_AT = CURRICULUM_SYSTEM.indexOf('Reply with ONLY one JSON object')
/** The reply format and the list of checks: the SAME text as harness 1 (sliced from it, so the two cannot drift). */
export const CURRICULUM_FORMAT = V1_FORMAT_AT > 0 ? CURRICULUM_SYSTEM.slice(V1_FORMAT_AT) : ''

export const CURRICULUM_SYSTEM_V2 = `You are the mind of a Minecraft bot exploring a world nobody has seen before. You decide what to do
next. Nobody gives you a list. Your goals: discover new things, get better tools, build things you find interesting, and stay
alive. The world is peaceful (no hostile mobs), there is no Nether and no End, and you cannot use any commands.

Propose ONE next task: something you cannot do yet that teaches you a new ability, or a project you want to build. Keep it
achievable in a few minutes from where you are, with what you carry or can get nearby.

WHAT YOU HAVE ALREADY DONE lists every outcome you have achieved; "x7" after one means you have done it seven times. Choose
an outcome that is not on that list, or a bigger project that combines several of them. Do not propose again an outcome
marked x3 or more unless it is a step of something bigger. Avoid what recently failed unless you change the approach.

Decide first, then write. "task" is ONE plain sentence of at most 200 characters that says what to do. Never write what to
avoid, and never correct yourself inside it.

${CURRICULUM_FORMAT}`

function stateLines (state) {
  const inv = Object.entries(state.inventory ?? {}).map(([k, v]) => `${k} x${v}`).join(', ') || 'empty'
  const blocks = Object.entries(state.blocks ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ${v}`).join(', ')
  const near = Object.entries(state.nearby ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing'
  return `STATE
position ${JSON.stringify(state.pos)}, health ${state.health}/20, food ${state.food}/20, biome ${state.biome}, ${state.day ? 'day' : 'night'}
inventory: ${inv}
holding: ${state.holding ?? 'nothing'}
blocks within 8: ${blocks || 'none loaded'}
nearby: ${near}`
}

/** `skills` = the library's active skills (need {signature}); `done`/`failed` = harness-written lines (describeOutcome). Pure. */
export function curriculumUserV2 ({ state, skills, done, failed, refusal }) {
  return `${stateLines(state)}

WHAT YOU HAVE ALREADY DONE (${skills.length} skills)
${abilitySummary(skills)}

RECENTLY FINISHED
${list(done, 10)}

RECENTLY FAILED
${list(failed, 10)}
${refusal ? `\nYOUR LAST PROPOSAL WAS REFUSED: ${refusal}\nPropose a different task.` : ''}
What is your next task? JSON only.`
}

export const CODER_SYSTEM_V2 = `${CODER_SYSTEM}
- Use what you already have. Read SKILLS YOU CAN CALL before you write: when one of them already does a step of this task,
  call it (\`await itsName(bot)\`) instead of writing that step again, and write new code only for the steps none of them
  does. A called skill throws an Error when it fails.
- Keep the function short: under about 80 lines, few comments. A reply that is cut off before the function ends cannot run.`

/**
 * The coder's message in two parts. `prefix` is the same for every round of one task (the task and the skills), so the
 * proxy can mark it as a cache prefix; `rest` changes every round (the state and the previous attempt).
 * `related` = skills shown with their code; `more` = further skills shown by name only (any library skill is callable).
 * @returns {{prefix: string, rest: string}}
 */
export function coderUserV2 ({ task, state, related, more = [], previous }) {
  const rel = related.map(s => `// ${s.name}: ${describeOutcome(s.task?.success)}\n${s.code}`).join('\n\n')
  const names = more.map(s => `- ${s.name}: ${describeOutcome(s.task?.success)}`).join('\n')
  const prefix = `TASK: ${task.task}
DONE WHEN: ${JSON.stringify(task.success)} (checked by reading the world afterwards, not by your return value)

SKILLS YOU CAN CALL (each takes only \`bot\`):
${rel || '(none yet)'}${names ? `\n\nMORE SKILLS YOU CAN CALL (by name; code not shown, each takes only \`bot\`):\n${names}` : ''}

`
  let prev = ''
  if (previous?.truncated) {
    prev = `\n\nYOUR PREVIOUS REPLY (round ${previous.round}) WAS CUT OFF at the length limit before the function ended, so nothing ran.
Write a much shorter function: call the skills above for the steps they already do, and leave out comments.`
  } else if (previous) {
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
  const rest = `STATE: position ${JSON.stringify(state.pos)}, inventory ${JSON.stringify(state.inventory)}, blocks within 8: ${JSON.stringify(state.blocks)}${prev}`
  return { prefix, rest }
}

/** Which prompts and reply limits a harness version uses. Harness 1 is the stage 3 / 3b / 4 harness, unchanged. Pure. */
export function promptSet (harness) {
  return Number(harness) >= 2
    // thinking tokens count against max_tokens: at 700 / 4,000 Haiku's replies were cut off on 6.5 % / 8.5 % of calls
    ? { version: 2, curriculumSystem: CURRICULUM_SYSTEM_V2, coderSystem: CODER_SYSTEM_V2, curriculumMaxTokens: 2000, codeMaxTokens: 10000 }
    : { version: 1, curriculumSystem: CURRICULUM_SYSTEM, coderSystem: CODER_SYSTEM, curriculumMaxTokens: 700, codeMaxTokens: 4000 }
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
