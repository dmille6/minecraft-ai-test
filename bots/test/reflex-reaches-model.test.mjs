// THE REFLEX MUST BE ABLE TO TELL THE MODEL WHY IT TOOK THE BODY.
//
// Measured 2026-08-26, fleet-wide, 21,180 decisions over three hours:
//
//     idle 99.0%   liveness_restart 0.7%   startup 0.3%   death 0.1%
//
// The reflex raises EIGHT reasons -- stranded_high, entombed, marooned,
// drowning, suffocating, low_health, danger_block, stuck -- and not one of
// them ever reached the model. `runner.interrupt(reason)` stored the reason
// and aborted the skill; `cognitive.notify()` was called from exactly one
// place in the tree, on death. The handoff the reflex's own comments describe
// ("planning a descent is cognitive work, not a 500ms reflex") ran through a
// channel that carried nothing.
//
// Two bots sat at y=320 for six hours reading `TRIGGER: idle` on their 59th
// diagnosed stranding, holding the pickaxe they kept trying to craft.
//
// These are wiring tests on purpose. Every unit test in this tree passed
// throughout, because nothing they covered was wrong.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { CognitiveLoop } from '../src/cognitive.mjs'
import { yContext } from '../src/prompt.mjs'
import { CLIMB_CEILING } from '../src/reflex.mjs'

const src = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')
// Comments are prose, not wiring. This file's own explanation of why the
// runner must NOT call notify() contains the string `notify()`, which a naive
// source scan reads as the very thing it forbids -- a test that fails because
// the code is well documented is a broken test.
const code = f => src(f).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const runner = code('runner.mjs')
const cognitive = code('cognitive.mjs')
const reflex = code('reflex.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

t('EVERY reason ANY layer raises is classified — ranked or suppressed', () => {
  // Derived from the source, never from a list written by hand. The first
  // version of this test scanned reflex.mjs alone and reported "six reasons";
  // the watchdog raises two more and `runner.interrupt(air.kind)` supplies two
  // that appear nowhere as a literal. A reason nobody classified silently
  // ranks 0 and loses every tie it enters.
  const raised = new Set()
  for (const f of ['reflex.mjs', 'watchdog.mjs', 'cognitive.mjs', 'index.mjs']) {
    for (const m of code(f).matchAll(/\.(?:interrupt|cancel)\('([a-z_]+)'\)/g)) raised.add(m[1])
    if (/\.interrupt\(air\.kind\)/.test(code(f))) { raised.add('drowning'); raised.add('suffocating') }
  }
  assert.ok(raised.size >= 10, `expected >=10 raised reasons, found ${raised.size}: ${[...raised]}`)
  const unclassified = [...raised].filter(r =>
    !(r in CognitiveLoop.TRIGGER_RANK) && !CognitiveLoop.TRIGGER_SUPPRESSED.has(r))
  assert.deepStrictEqual(unclassified, [],
    `unclassified interrupt reasons: ${unclassified.join(', ')} — each must be ` +
    'ranked in TRIGGER_RANK or listed in TRIGGER_SUPPRESSED, never left to default')
})

t('a human stop must not wake a fresh decision', () => {
  assert.ok(CognitiveLoop.TRIGGER_SUPPRESSED.has('user_stop'),
    'user_stop would raise a trigger — the bot decides again the instant a ' +
    'human stops it, which is the opposite of what was asked')
  assert.ok(!('user_stop' in CognitiveLoop.TRIGGER_RANK),
    'user_stop is both ranked and suppressed — one of the two is a mistake')
})

t('THE WIRING: the runner hands the reason back to its caller', () => {
  assert.ok(/const interruptedBy = this\.interruptedReason/.test(runner) &&
            /\n      interruptedBy,/.test(runner),
    'runner.run() no longer returns interruptedBy — the reason dies with the skill')
})

t('THE WIRING: the runner must NOT dispatch it itself', () => {
  // Calling notify() from the runner fires before run() returns to the
  // CognitiveLoop's own #tick(), nesting a decision inside the one still
  // unwinding -- and notify() drops anything arriving while the runner is
  // busy, which during an abort it still is.
  assert.ok(!/onInterrupted|notify\(/.test(runner),
    'runner.mjs dispatches the interrupt itself — that nests a decision inside ' +
    'the one still unwinding, and notify() drops it while the runner is busy')
})

t('THE WIRING: the cognitive loop picks it up and spends it on the next tick', () => {
  assert.ok(/if \(r\.interruptedBy\) this\.#raiseTrigger\(r\.interruptedBy/.test(cognitive),
    'the returned reason is never read — it is data nobody consumes')
  assert.ok(/#tick\(this\.#takePendingTrigger\(\) \?\? 'idle'\)/.test(cognitive),
    'the scheduler still ticks a hard-coded idle, so the reason never reaches ' +
    'the prompt even though it was recorded')
})

t('PRIORITY, not last-wins: stuck must not bury stranded_high', () => {
  // Two reflexes can fire in quick succession and the runner keeps only the
  // newest reason, so the symptom can overwrite the diagnosis.
  const R = CognitiveLoop.TRIGGER_RANK
  assert.ok(R.stranded_high > R.stuck,
    'a bot stranded at the build limit is also "stuck"; if stuck outranks it ' +
    'the model is told the symptom and never the diagnosis')
  assert.ok(R.entombed > R.stuck && R.marooned > R.stuck)
  assert.ok(R.drowning > R.danger_block)
})

t('the trigger reaches the prompt the model actually reads', () => {
  assert.ok(/TRIGGER: \$\{trigger\}/.test(code('prompt.mjs')),
    'buildUserPrompt no longer renders TRIGGER — the whole chain is decorative')
})

// ---------------------------------------------------------------------------
// The other half of what the stranded bots read. TRIGGER told them nothing;
// this line told them something WRONG.
// ---------------------------------------------------------------------------

t('a stranded bot is told the ground is below it, not that the sky is reachable', () => {
  const line = yContext(320)
  assert.ok(/DESCEND/.test(line), `no descent instruction: ${line}`)
  assert.ok(/230 blocks BELOW/.test(line),
    `the distance to ground is not stated: ${line}`)
  // The exact regression: the old line rendered "290 to 350" for y=320, which
  // is the sky, and was the only elevation information in the prompt.
  assert.ok(!/\b(29[0-9]|3[0-4][0-9]|350)\b to \b/.test(line),
    `still offering a band above the bot: ${line}`)
})

t('the elevation line is ABSOLUTE, so it can disagree with the bot', () => {
  // A relative window agrees with the bot wherever it stands, which is exactly
  // why it could not tell a stranded one it was somewhere silly.
  const surface = yContext(72)
  const high = yContext(CLIMB_CEILING + 5)
  assert.notStrictEqual(surface, high, 'the line does not vary with elevation at all')
  assert.ok(/y=62-90/.test(surface) && /y=62-90/.test(high),
    'the terrain band is not stated absolutely in both cases')
})

t('underground and stranded get DIFFERENT advice', () => {
  // Both are "not on the surface" and they need opposite verbs. Folding them
  // together is how a stranded bot gets told to climb.
  const below = yContext(14)
  const above = yContext(320)
  assert.ok(/surface/.test(below) && !/DESCEND/.test(below),
    `underground advice mentions descending: ${below}`)
  assert.ok(/DESCEND/.test(above) && !/\bUse surface\b/.test(above),
    `stranded advice tells the bot to surface — that is the direction it came from: ${above}`)
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
