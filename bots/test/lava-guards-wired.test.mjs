// The three lava guards are wired where the design says (source invariants, comments stripped, one mutant each).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = f => readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
const idx = strip('../src/index.mjs'), rfx = strip('../src/reflex.mjs'), run = strip('../src/runner.mjs')
t('guard 1: every path_update with a path runs corridorSafe on the executed nodes and a refusal clears the goal before the first step', () => {
  const m = idx.match(/bot\.on\('path_update', \(r\) => \{[\s\S]{0,900}?const v = corridorSafe\([^\n]*\n[\s\S]{0,300}?if \(!v\.safe\) \{\s*try \{ bot\.pathfinder\.setGoal\(null\) \}/g) || []
  assert.equal(m.length, 1, 'wired once inside the path_update listener, clearing the goal on refusal')
  assert.equal((idx.replace(m[0], m[0].replace('bot.pathfinder.setGoal(null)', '0')).match(/if \(!v\.safe\) \{\s*try \{ bot\.pathfinder\.setGoal\(null\) \}/g) || []).length, 0, 'MUTANT: a refusal that does not stop the leg is caught')
})
t('guard 2: the surface_out push runs holdForwardSafe and clears forward explicitly on refusal', () => {
  const m = rfx.match(/const hv = holdForwardSafe\(bmap\(bot\), \{[^}]*\}, dir\)\s*if \(!hv\.safe\) \{\s*bot\.setControlState\('forward', false\)/g) || []
  assert.equal(m.length, 1)
  assert.equal((rfx.replace(/bot\.setControlState\('forward', false\)\s*if \(Date\.now\(\) - lastHoldLavaAt/, 'if (Date.now() - lastHoldLavaAt').match(/if \(!hv\.safe\) \{\s*bot\.setControlState\('forward', false\)/g) || []).length, 0, 'MUTANT: a refusal that merely refrains is caught')
})
t('guard 3: the stand-off runs only for an idle bot (no skill, no arm, 20 s after the last skill), once per 10 s, ends by position feedback and clears forward', () => {
  assert.match(rfx, /if \(!runner\.isBusy\(\) && !escaping && !marooned && (?:!pocketing && )?Date\.now\(\) - \(runner\.lastEndedAt \?\? 0\) > 20_000 && Date\.now\(\) - lastStandOffAt > 10_000\) \{/)
  assert.match(rfx, /const so = lavaStandOff\(bmap\(bot\), feetCell\)/)
  assert.match(rfx, /if \(Math\.hypot\(q\.x - dest\.x, q\.z - dest\.z\) < 0\.3\) break/, 'position feedback ends the step inside the destination')
  assert.match(rfx, /finally \{ bot\.setControlState\('forward', false\) \}/, 'forward is cleared whatever happens')
  assert.match(run, /this\.lastEndedAt = Date\.now\(\)/, 'the runner records when a skill ended')
  assert.equal((rfx.match(/lavaStandOff\(/g) || []).length, 1, 'one call site')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
