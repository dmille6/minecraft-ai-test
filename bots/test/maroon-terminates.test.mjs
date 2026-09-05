// THE TRAP WAS DETECTED 6,280 TIMES AND ACTED ON 58.
//
// Measured 2026-09-04 over six hours, fleet-wide. Per bot the pairing is exact,
// which is what gives the shape away:
//
//   board-c-Delta   `marooned` 350   `maroon_climb_refused` 350   then silence
//   board-c-Alpha   `marooned_ramp_cut` 177   `marooned_needs_scaffold` 177
//
// One-to-one. Every detection ending in a refusal, forever, while fifteen bots
// burned 8,477 decisions in six hours for zero successes -- 21% of all fleet
// inference spent by bots that could not act on the outcome.
//
// Three defects here, and none of them is the guard being wrong. Each guard is
// individually correct and they compose into a state with no legal move, which
// is this repo's named bug class.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import { maroonState, canFinishClimb } from '../src/reflex.mjs'

const BASE = { upIsOpen: true, entombed: false, canStartPath: false }

test('POSITIVE CONTROL: the states are still reachable', () => {
  // Without this every assertion below could pass because maroonState always
  // returned the same thing.
  assert.equal(maroonState({ ...BASE, haveBlocks: false }), 'need_scaffold')
  assert.equal(maroonState({ ...BASE, haveBlocks: true }), 'climb')
  assert.equal(maroonState({ ...BASE, haveBlocks: true, canStartPath: true }), 'none')
  assert.equal(maroonState({ ...BASE, haveBlocks: true, y: 207 }), 'stranded_high')
})

test('DEFECT 2: one block routed to a climb that always refused', () => {
  // `haveBlocks` at the call site was `.some()`, so a single placeable block
  // flipped this to 'climb'. `pillarOut` then asks canFinishClimb for
  // PILLAR_MAX_BLOCKS + 1 = 25 and declines. The bot was routed to a remedy
  // guaranteed to refuse instead of to the branch that ASKS for what is missing.
  for (const n of [1, 5, 12, 20, 24]) {
    assert.equal(maroonState({ ...BASE, haveBlocks: true, blockCount: n, climbNeed: 24 }),
      'need_scaffold', `${n} blocks cannot finish a 24-block climb — must ask, not climb`)
  }
})

test('...and enough blocks still climbs', () => {
  for (const n of [25, 26, 64]) {
    assert.equal(maroonState({ ...BASE, haveBlocks: true, blockCount: n, climbNeed: 24 }),
      'climb', `${n} blocks is enough; routing it to need_scaffold would strand it`)
  }
  // The boundary is canFinishClimb's, not a second opinion about it.
  assert.equal(canFinishClimb({ have: 25, need: 24 }), true)
  assert.equal(canFinishClimb({ have: 24, need: 24 }), false)
})

test('a caller that cannot count keeps the old behaviour', () => {
  // Absence of a count is not evidence of too few blocks. Every existing caller
  // that passes only the boolean must be unaffected.
  assert.equal(maroonState({ ...BASE, haveBlocks: true }), 'climb')
  assert.equal(maroonState({ ...BASE, haveBlocks: true, blockCount: null }), 'climb')
  assert.equal(maroonState({ ...BASE, haveBlocks: true, blockCount: undefined }), 'climb')
})

test('the count never overrides a MORE specific state', () => {
  // stranded_high and need_pickaxe are decided before the block question, and a
  // low count must not demote them — a bot at the build limit does not need
  // scaffold, it needs to descend.
  assert.equal(maroonState({ ...BASE, haveBlocks: true, blockCount: 1, y: 207 }), 'stranded_high')
  assert.equal(maroonState({ ...BASE, haveBlocks: true, blockCount: 1, cappedNeedsTool: true }),
    'need_pickaxe')
  assert.equal(maroonState({ ...BASE, haveBlocks: true, blockCount: 1, canStartPath: true }), 'none')
})

test('DEFECT 1: the maroon branch must read pillarOut’s answer', () => {
  // Source assertion, because the shape being asserted is that a return value is
  // USED — behaviour cannot reach a discarded value. Comments are stripped first:
  // this codebase quotes the code it explains, so a naive grep matches the prose.
  const raw = fs.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

  assert.ok(code.includes('export async function pillarOut') || code.includes('async function pillarOut'),
    'POSITIVE CONTROL: the stripper left the executable text intact')

  // WINDOWED on the maroon branch. There are three `pillarOut` call sites and
  // only this one was silent: the entombed branch reads the return value, and
  // the unstick-oscillation branch verifies the postcondition by measuring how
  // far the bot actually rose. Asserting "no call anywhere discards it" would
  // fail on that third site for the wrong reason.
  const i = code.indexOf("runner.interrupt('marooned')")
  assert.ok(i > 0, 'POSITIVE CONTROL: the maroon branch is still there')
  const branch = code.slice(i, i + 1800)

  assert.doesNotMatch(branch, /try\s*\{\s*await pillarOut\(bot\)\s*\}/,
    'the maroon branch discards pillarOut’s answer again — a refusal reads as a rescue')
  assert.match(branch, /pillarOutcome\s*=\s*await pillarOut\(bot\)/,
    'the maroon branch must capture the outcome')
  assert.match(branch, /pillarOutcome === 'needs_blocks'/,
    'and must branch on the refusal, the way the entombed path already does')
  assert.match(branch, /maroon_pillar_declined/,
    'the refusal must be RECORDED — a discarded refusal is the 350-to-350 silence')
  // ...and it must NOT cut a second ramp: `marooned_ramp_cut` is single-sourced
  // on purpose so success and failure keep one denominator. The suite caught the
  // first version of this fix doing exactly that.
  const raw2 = fs.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  assert.strictEqual(raw2.split("kind: 'marooned_ramp_cut'").length, 2,
    'marooned_ramp_cut is emitted from more than one place again')
})

test('DEFECT 5: the terminal rescue must not climb a bot that is too high', () => {
  const raw = fs.readFileSync(new URL('../src/watchdog.mjs', import.meta.url), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

  assert.ok(code.includes('watchdog_stranded'),
    'POSITIVE CONTROL: the escalation site still exists')
  assert.doesNotMatch(code, /run\('surface',\s*\{\},\s*\{\s*trigger:\s*'watchdog_stranded'/,
    'the unconditional climb is back — six of fifteen stranded bots are ABOVE y=125')
  assert.match(code, /STRANDED_HIGH_Y/,
    'the escalation must choose its direction from elevation')
})
