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
t('guard 3: the stand-off runs only for an idle bot on dry ground (no skill, no arm, not in water, 20 s after the last skill), once per 10 s, ends by position feedback and clears forward', () => {
  assert.match(rfx, /if \(!runner\.isBusy\(\) && !escaping && !marooned && (?:!pocketing && )?!standOffInWater && Date\.now\(\) - \(runner\.lastEndedAt \?\? 0\) > 20_000 && Date\.now\(\) - lastStandOffAt > 10_000\) \{/)
  assert.match(rfx, /const so = lavaStandOff\(bmap\(bot\), feetCell\)/)
  assert.match(rfx, /if \(Math\.hypot\(q\.x - dest\.x, q\.z - dest\.z\) < 0\.3\) break/, 'position feedback ends the step inside the destination')
  assert.match(rfx, /finally \{ bot\.setControlState\('forward', false\) \}/, 'forward is cleared whatever happens')
  assert.match(run, /this\.lastEndedAt = Date\.now\(\)/, 'the runner records when a skill ended')
  assert.equal((rfx.match(/lavaStandOff\(/g) || []).length, 1, 'one call site')
})
t('guard 1b: explore\'s failed-leg fallback walk runs stepLineSafe on its own line before any control state, and a refused step does not walk', () => {
  const src = strip('../src/skills.mjs')
  const CHECK = 'const v = stepLineSafe((x, y, z) => bot.blockAt(new Vec3(x, y, z)), bot.entity.position, cand)'
  const REFUSE = 'if (!stepOk) { await sleep(300, signal); continue }'
  const WALK = "bot.setControlState('forward', true)\n        await sleep(1200, signal)"
  const order = (t) => { const i0 = t.indexOf(CHECK), i1 = t.indexOf(REFUSE), i2 = t.indexOf(WALK); return i0 > 0 && i1 > i0 && i2 > i1 }
  assert.equal(src.split(CHECK).length - 1, 1, 'one call site'); assert.equal(src.split(REFUSE).length - 1, 1, 'one refusal')
  assert.ok(order(src), 'check -> refuse-without-walking -> walk, in that order')
  assert.equal(order(src.replace(REFUSE, '')), false, 'mutant: deleting the refusal is detected')
  assert.equal(order(src.replace(CHECK, '')), false, 'mutant: deleting the check is detected')
  assert.equal(src.includes("bot.setControlState('jump', true)\n        await sleep(1200, signal)"), false, 'the fallback walk is grounded: no jump held (a hop can leave the checked line)')
  // The candidate ORDER is decision logic and is no longer asserted by matching an array
  // literal -- that assertion broke when the LIST changed rather than when the DECISION changed,
  // which is what this repo's rules forbid. Order and geometry live in the pure `stepCandidates`
  // and `retraceHeading`, tested behaviourally in blind-step-retrace.test.mjs. What stays HERE is
  // the structural invariant this file exists for: the loop takes its headings from that function
  // and nothing else builds a heading list inline.
  assert.equal(src.split('for (const [cand, cn] of stepCandidates(ang, turn, _retrace))').length - 1, 1,
               'the loop takes its headings from the pure stepCandidates')
  assert.equal(/for \(const cand of \[ang/.test(src), false,
               'no inline candidate array survives alongside it')
  // And the OUTCOME row must be emitted AFTER the walk, never before it. blindstep-01 logged its
  // new candidate before setControlState, so its exposure floor counted intentions and could have
  // been met without a bot moving at all.
  const RETRACE_LOG = "kind: 'explore_blind_step_retrace'"
  assert.equal(src.split(RETRACE_LOG).length - 1, 1, 'one retrace outcome row')
  assert.ok(src.indexOf(WALK) < src.indexOf(RETRACE_LOG),
            'the retrace outcome is logged AFTER the walk, so it measures displacement not intent')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
