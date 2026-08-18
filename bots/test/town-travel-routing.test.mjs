// THE TOWN ECONOMY IS A TRAVEL PROBLEM WEARING AN ECONOMY COSTUME.
//
// Measured over twelve days and ~620K skill events:
//
//   deposit  823 calls, EIGHT successes (199 items banked, four bots ever).
//            Of 815 failures, 650 (80%) are travel -- stranded 466, no_path 75,
//            interrupted 65, path_interrupted 44. Only 75 were the deposit
//            logic itself failing to find a chest.
//   sleep    505 calls, ZERO successes. 377 (75%) travel, 113 chosen in
//            daylight against a prompt that says night-only.
//
// Both walked home with a raw `goto`, so both inherited none of the repairs
// that made `home` work: retry across hazard interrupts, route repair via
// `surface` below sea level, chaining past goto's 16-leg/720-block ceiling,
// and reporting ground closed. `deposit` is a CO-PRIMARY endpoint in the
// pre-registration, and it cannot be measured through a walk that does not
// work.
//
// These tests pin the routing. A future edit that "simplifies" either call
// back to a bare goto silently re-breaks a co-primary endpoint, and the
// symptom would be a slow drift in a number nobody is watching.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/skills.mjs'), 'utf8')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

/** The body of a top-level `async function <name>` in skills.mjs. */
function body(name) {
  const start = src.indexOf(`async function ${name}(`)
  assert.notEqual(start, -1, `${name} not found`)
  const next = src.indexOf('\nasync function ', start + 1)
  return src.slice(start, next === -1 ? src.length : next)
}

t('deposit walks home through the rescue path, not a raw goto', () => {
  const b = body('deposit')
  assert.ok(/await home\(ctx/.test(b),
    'deposit must reach the town chest via home(), which retries through ' +
    'hazard interrupts and repairs its route')
  assert.ok(!/await goto\(ctx, \{ x: homeX/.test(b),
    'deposit must not re-introduce its own bare walk toward home')
})

t('sleep walks home through the rescue path, not a raw goto', () => {
  const b = body('sleepSkill')
  assert.ok(/await home\(ctx/.test(b),
    'sleep must reach the town beds via home() for the same reason')
  assert.ok(!/await goto\(ctx, \{ x: homeX/.test(b),
    'sleep must not re-introduce its own bare walk toward home')
})

t('deposit still rescans for a chest after the walk', () => {
  // A walk that fell short can still have brought the chest inside the 48-block
  // scan. Judging the walk before looking around threw away real arrivals.
  const b = body('deposit')
  const walk = b.indexOf('await home(ctx')
  const rescan = b.indexOf('findChest()', walk)
  const judge = b.indexOf("walked.status === 'failed'", walk)
  assert.ok(rescan !== -1 && rescan < judge,
    'the rescan must happen BEFORE the walk is judged a failure')
})

t('sleep still rescans for a bed after the walk', () => {
  const b = body('sleepSkill')
  const walk = b.indexOf('await home(ctx')
  const rescan = b.indexOf('findBed()', walk)
  const judge = b.indexOf("walked.status === 'failed'", walk)
  assert.ok(rescan !== -1 && rescan < judge,
    'the rescan must happen BEFORE the walk is judged a failure')
})

t('the nested budget fits inside the calling contracts', () => {
  // home carries its own deadline. Called from deposit or sleep it must yield
  // with time left for the chest/bed work, or the outer skill is killed by its
  // contract having done nothing but walk.
  const budget = Number(/const HOME_BUDGET_MS = ([\d_]+)/.exec(src)[1].replace(/_/g, ''))
  for (const skill of ['deposit', 'sleep']) {
    const m = new RegExp(`${skill}:\\s*\\{[^}]*maxMs:\\s*([\\d_]+)`).exec(src)
    const maxMs = Number(m[1].replace(/_/g, ''))
    assert.ok(budget < maxMs,
      `home's ${budget}ms budget must leave room inside ${skill}'s ${maxMs}ms contract`)
  }
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
