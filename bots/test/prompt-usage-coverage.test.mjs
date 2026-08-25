// EVERY SKILL THE MODEL CAN SELECT MUST BE DOCUMENTED TO IT.
//
// `SKILL_NAMES` in cognitive.mjs is `Object.keys(SKILLS)` minus chatOnly, and
// it feeds two things at once: the JSON schema's `skill` enum -- which Ollama
// compiles into a GBNF grammar -- and the prompt's "Available skills (...)"
// line. The hand-maintained usage block underneath is a THIRD list, and
// nothing tied it to the other two.
//
// So they drifted. `build`, `withdraw`, `explore` and `surface` were all
// selectable, and named in the available list, with no line saying what their
// arguments were or what they were for. Over roughly 200,000 logged decisions
// `build` was proposed ZERO times and `withdraw` 25 -- the signature of an
// affordance the model was offered and could not use. Adding a skill to the
// registry is a one-line change; remembering to document it is a habit, and
// habits are what this file replaces.
//
// This asserts the registry, the enum, and the prose stay one list.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { SKILLS } from '../src/skills.mjs'
import { config } from '../src/config.mjs'
import { buildSystemPrompt } from '../src/prompt.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// Mirrors cognitive.mjs:81 exactly. If that filter changes, this must too --
// and the test failing is the notification.
// Mirrors cognitive.mjs exactly, INCLUDING the scope gate. If that filter
// changes, this must too -- and the test failing is the notification.
const HAS_BOARD = config.memory.scope === 'board' || config.memory.scope === 'checkpoint'
const SKILL_NAMES = Object.keys(SKILLS)
  .filter(n => !SKILLS[n].chatOnly)
  .filter(n => n !== 'board' || HAS_BOARD)
const sys = buildSystemPrompt(SKILL_NAMES)
const documented = n => new RegExp(`^\\s+${n}\\s+args:`, 'm').test(sys)

t('every selectable skill has a usage line', () => {
  // THE EXEMPTION IS GONE, and it was hiding a real defect for the whole run.
  //
  // `board` used to be excused here as "conditional on memory scope" -- true of
  // its USAGE LINE, and not of its NAME, which was offered to every arm. Hive
  // and isolated bots were handed a verb with no explanation, for a lectern
  // their world does not contain. The one skill this test exempted was the one
  // skill that was broken.
  //
  // Availability is now gated on scope in cognitive.mjs, so the two lists agree
  // and no exemption is needed.
  const missing = SKILL_NAMES.filter(n => !documented(n))
  assert.deepEqual(missing, [],
    `selectable but undocumented: ${missing.join(', ')}. The model can emit ` +
    `these (they are in the schema enum) and is told they exist, but not what ` +
    `they take or what they are for.`)
})

t('AVAILABILITY AND DOCUMENTATION AGREE IN EVERY ARM', () => {
  // Rendered per memory scope. `board` was listed for all four arms while its
  // usage line existed only in two, so hive and isolated bots could emit a verb
  // for a lectern their world does not have.
  const src = readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8')
  assert.ok(/HAS_BOARD/.test(src),
    'nothing gates board availability on memory scope; the two lists can drift again')
  assert.ok(/n !== 'board' \|\| HAS_BOARD/.test(src),
    'board is still offered to arms that have no board')
})

t('the available-skills list matches the documented set', () => {
  const m = sys.match(/Available skills \(([^)]*)\)/)
  assert.ok(m, 'the prompt no longer advertises an available-skills list')
  const advertised = m[1].split(',').map(s => s.trim()).filter(Boolean)
  assert.deepEqual([...advertised].sort(), [...SKILL_NAMES].sort(),
    'the advertised list has drifted from SKILL_NAMES')
})

t('chatOnly skills are never advertised', () => {
  // come/follow are operator commands. Offering them to the model spends a
  // decision on something that cannot advance any task.
  for (const n of Object.keys(SKILLS).filter(k => SKILLS[k].chatOnly)) {
    assert.ok(!SKILL_NAMES.includes(n), `${n} is chatOnly but selectable`)
  }
})

t('place is NOT advertised as a way out of a hole', () => {
  // place() scans the eight horizontal neighbours for a solid block with space
  // above; it never places underfoot. Pillaring is inside surface(). A hint
  // saying otherwise would send trapped bots to a verb that cannot free them --
  // worse than no hint, because it looks like the answer.
  const line = sys.split('\n').find(l => /^\s+place\s+args:/.test(l)) ?? ''
  // Strip explicit denials first -- "not underfoot" is the correction, not the
  // defect, and a naive keyword match cannot tell the two apart.
  const affirmative = line.replace(/\bnot\s+(underfoot|beneath[^,;.]*|below[^,;.]*)/gi, '')
  assert.ok(!/beneath you|underfoot|below you/i.test(affirmative),
    `place's usage line implies it places underfoot, which it does not: "${line.trim()}"`)
  assert.ok(/surface/i.test(line),
    'place should point at surface for escaping, since that is the skill that pillars')
})

t('surface is described as the escape skill and names its prerequisite loop', () => {
  const line = sys.split('\n').find(l => /^\s+surface\s+args:/.test(l)) ?? ''
  assert.ok(line, 'surface has no usage line')
  // The measured fix for the trap was promoting the prerequisite into the TASK
  // (0/13 -> 3/13 on 7b, 12/13 on 32b). The prompt should describe that loop
  // so the model recognises it when applyPrereq hands it back.
  assert.ok(/scaffold|gather .* again|run surface again/i.test(line),
    `surface's line should tell the model what to do when it needs scaffold: "${line.trim()}"`)
})


t('skills the model CANNOT select are not documented to it', () => {
  // The reverse of the coverage rule, and it bit immediately: `sleep` became
  // operator-only, was correctly dropped from the available list, and its usage
  // line stayed behind -- so the prompt described an action the grammar would
  // not let the model emit. A described-but-unavailable verb is worse than an
  // undocumented one: it spends prompt tokens teaching an impossible move.
  const chatOnly = Object.keys(SKILLS).filter(n => SKILLS[n].chatOnly)
  const leaked = chatOnly.filter(n => documented(n))
  assert.deepEqual(leaked, [],
    `documented but not selectable: ${leaked.join(', ')}`)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
