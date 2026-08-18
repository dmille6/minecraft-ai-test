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
import { SKILLS } from '../src/skills.mjs'
import { buildSystemPrompt } from '../src/prompt.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// Mirrors cognitive.mjs:81 exactly. If that filter changes, this must too --
// and the test failing is the notification.
const SKILL_NAMES = Object.keys(SKILLS).filter(n => !SKILLS[n].chatOnly)
const sys = buildSystemPrompt(SKILL_NAMES)
const documented = n => new RegExp(`^\\s+${n}\\s+args:`, 'm').test(sys)

t('every selectable skill has a usage line', () => {
  // `board` is the deliberate exception: it is offered only under the arms that
  // have a board in their world, so its line is conditional on memory scope.
  const missing = SKILL_NAMES.filter(n => n !== 'board' && !documented(n))
  assert.deepEqual(missing, [],
    `selectable but undocumented: ${missing.join(', ')}. The model can emit ` +
    `these (they are in the schema enum) and is told they exist, but not what ` +
    `they take or what they are for.`)
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

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
