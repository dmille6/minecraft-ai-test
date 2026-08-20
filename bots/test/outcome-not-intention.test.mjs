// THE BUG THIS EXISTS TO PREVENT, three times over.
//
// `drowning_escaped` logged success when the 20-second ceiling expired with the
// bot still floating. `livelock_escape` logged `status: 'failed'` on a line ABOVE
// the goto that relocated the bot -- 2,296 events in a day, 0% success, whether
// or not it moved. `trapped_in_canopy` did the same above its dig loop: 217
// events, 0% success, unmeasured.
//
// Each was invisible for the same reason: the event is named after the ACTION, so
// a reader sees 0% and concludes the rescue is broken. It was not broken. It was
// UNMEASURED -- worse, because a broken rescue can be found and a fabricated
// statistic cannot. The shakedown gate flagged all three as defects on its first
// real run, which is how two of them were finally caught.
//
// THE RULE IS NOT "never write a literal status". This codebase has two correct
// shapes and the tests must permit both:
//
//   (a) ONE kind, status computed after the action     -- livelock, canopy
//   (b) TWO kinds, one per outcome, each emitted inside
//       the branch that already knows                  -- drowning, self-source
//
// What is forbidden is claiming an outcome the code has not determined yet.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const SRC = join(import.meta.dirname, '..', 'src')
const read = f => readFileSync(join(SRC, f), 'utf8')

function statusFor(src, kind) {
  const out = []
  for (const m of src.matchAll(new RegExp(`kind:\\s*'${kind}'`, 'g'))) {
    const s = src.slice(m.index, m.index + 400).match(/status:\s*([^,\n]+)/)
    if (s) out.push(s[1].trim())
  }
  return out
}
const isLiteral = e => /^'(success|failed|unknown|aborted)'$/.test(e)

// ---- shape (a): one kind, computed status ----------------------------------
for (const [file, kind] of [['cognitive.mjs','livelock_escape'], ['skills.mjs','trapped_in_canopy']]) {
  t(`${kind} computes its status`, () => {
    const got = statusFor(read(file), kind)
    assert.ok(got.length, `${kind} is not logged in ${file} -- stale test?`)
    for (const e of got) {
      assert.ok(!isLiteral(e),
        `${file}: ${kind} hardcodes ${e}. It uses one kind for both outcomes, so ` +
        `the status must come from a value computed AFTER the action.`)
    }
  })
}

t('the canopy event is emitted AFTER the dig loop, not before it', () => {
  const src = read('skills.mjs')
  const dig = src.indexOf('for (let i = 0; i < 12; i++)')
  const ev  = src.indexOf("kind: 'trapped_in_canopy'")
  assert.ok(dig > 0 && ev > 0, 'canopy escape no longer recognisable')
  assert.ok(ev > dig,
    'the event is logged BEFORE the dig loop -- that is the original bug, exactly')
})

t('the livelock event is emitted AFTER the relocation runs', () => {
  const src = read('cognitive.mjs')
  const go = src.indexOf("this.runner.run('goto'")
  const ev = src.indexOf("kind: 'livelock_escape'")
  assert.ok(go > 0 && ev > 0, 'livelock breaker no longer recognisable')
  assert.ok(ev > go, 'the event is logged BEFORE the goto -- that is the original bug')
})

// ---- shape (b): one kind per outcome ---------------------------------------
t('drowning uses a distinct kind for the un-rescued case', () => {
  const src = read('reflex.mjs')
  assert.ok(statusFor(src, 'drowning_escaped').every(e => e === "'success'"),
    'drowning_escaped should mean escaped, unconditionally')
  assert.ok(src.includes('drowning_released_timeout'),
    'the ceiling-expiry case needs its OWN kind, or a floating bot counts as rescued')
})

t('self-sourcing uses a distinct kind for the nothing-to-dig case', () => {
  const src = read('reflex.mjs')
  assert.ok(statusFor(src, 'marooned_self_sourced').every(e => e === "'success'"),
    'marooned_self_sourced should only be emitted when blocks were actually gained')
  const win = src.indexOf("kind: 'marooned_self_sourced'")
  const lose = src.indexOf("kind: 'marooned_needs_scaffold'")
  assert.ok(win > 0 && lose > 0 && lose > win,
    'the failure branch must exist and follow the success branch')
})

t('state observations keep a fixed status and are gate-suppressed instead', () => {
  const got = statusFor(read('reflex.mjs'), 'marooned_needs_scaffold')
  assert.ok(got.length && got.every(e => e === "'failed'"),
    'a REQUEST event has no outcome to report; TERMINAL_LABELS suppresses it')
})

t('every outcome event the gate can see is classified one way or the other', () => {
  const gate = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'shakedown-gate.py'), 'utf8')
  const terminal = new Set([...gate.matchAll(/'(_[a-z_]+)'/g)].map(m => m[1]))
  // These are ACTIONS: they must never be suppressed, because a 0% rate on them
  // is a real finding once the status is honest.
  for (const k of ['_livelock_escape', '_trapped_in_canopy']) {
    assert.ok(!terminal.has(k),
      `${k} is in TERMINAL_LABELS. It names an action with a measurable outcome; ` +
      `suppressing it hides the very defect the gate exists to catch.`)
  }
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
