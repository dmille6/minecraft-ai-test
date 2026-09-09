// PERMANENT STRANDING IS WORSE THAN DEATH, AND THE FLEET PROVED IT.
//
// board-c-Alpha has stood on one block since 2026-09-03: three stone pickaxes,
// one crafting table, nothing placeable, air on all four sides, and a 24-block
// drop costing 21 health against 20. No move gets it down alive and the owner's
// rule forbids fixing it from outside.
//
// It already died once -- "drowned; idle at the moment of death", 09-03 --
// respawned 1,063 blocks away and went back to work. Death here is RECOVERABLE.
// Six days of nothing is not. Owner decision, 2026-09-09.
import assert from 'node:assert'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { escapePlan } from '../src/escape.mjs'

const SRC = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
const CODE = SRC.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

test('NO UNDEFINED IDENTIFIER in the last-resort branch', () => {
  // The first draft tested `trappedNow`, which does not exist -- a
  // ReferenceError inside the 500ms reflex, which module load cannot catch and
  // which would have taken the whole loop down with it. Every name this branch
  // reads must be one the file actually defines.
  assert.doesNotMatch(CODE, /\btrappedNow\b/,
    'trappedNow is not defined anywhere in this file')
  assert.match(CODE, /const plan = est\.trapped \? escapePlan\(est\) : 'none'/,
    'trapped must come from the lattice observation the plan is computed from')
})

test('it fires ONLY on the bottom rung, which means nothing survivable is left', () => {
  // SCOPED to the last-resort block. An unscoped match passed against the
  // step_off COOLDOWN check elsewhere in this file, so a mutant that made the
  // branch unconditional survived -- the assertion was reading the wrong line.
  const i = CODE.indexOf("kind: 'last_resort_drop'")
  assert.ok(i > 0, 'POSITIVE CONTROL: the last-resort block must exist')
  const block = CODE.slice(Math.max(0, i - 900), i)
  assert.match(block, /if \(plan === 'step_off'\) \{/,
    'any plan other than the unconditional bottom must not take a fatal drop')
  assert.doesNotMatch(block, /if \(true\)/, 'the gate must not be short-circuited')
})

test('THE LATTICE STILL PREFERS EVERY SURVIVABLE OPTION', () => {
  // The guard is only as good as what escapePlan returns, so prove the bottom
  // rung really is the bottom: anything survivable outranks it.
  assert.equal(escapePlan({ trapped: true, underfootSolid: true, underfootDrop: 2 }), 'dig_down')
  assert.equal(escapePlan({ trapped: true, floorBelowSolid: true }), 'ride_floor_down')
  assert.equal(escapePlan({ trapped: true, lateralTread: true }), 'stair_up')
  assert.equal(escapePlan({ trapped: true, ladderReady: true }), 'climb_ladder')
  assert.equal(escapePlan({ trapped: true, columnOpen: true, blocks: 99, climbNeed: 24 }), 'pillar_up')
  assert.equal(escapePlan({ trapped: true, afloat: true }), 'surface_swim')
  // and the bottom, only when none of the above apply
  assert.equal(escapePlan({ trapped: true }), 'step_off')
})

test('a bot that is not trapped is never dropped', () => {
  assert.equal(escapePlan({ trapped: false }), 'none')
})

test('SIX HOURS, and movement resets it', () => {
  assert.match(CODE, /const LAST_RESORT_STRANDED_MS = 6 \* 60 \* 60 \* 1000/)
  assert.match(CODE, /p\.distanceTo\(strandedFrom\) > STRANDED_EPS/,
    'any real displacement must reset the timer, so a bot slowly working its way out never accrues it')
  assert.match(CODE, /Date\.now\(\) - strandedSince > LAST_RESORT_STRANDED_MS/)
})

test('and it says what it is doing, because this one kills a bot on purpose', () => {
  assert.match(CODE, /kind: 'last_resort_drop'/)
  assert.match(CODE, /kind: 'last_resort_result'/)
})
