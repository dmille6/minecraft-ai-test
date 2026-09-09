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

test('ZERO BLOCKS is required, because one block outranks the bottom rung', () => {
  // Holding even one placeable block puts pillar_up above step_off, so reaching
  // the bottom WITH blocks means something else is wrong and killing the bot
  // would not fix it.
  const i = CODE.indexOf("'last_resort_drop'")
  assert.ok(i > 0, 'POSITIVE CONTROL: the last-resort block must exist')
  assert.match(CODE.slice(Math.max(0, i - 1400), i), /terminal \? est\.blocks === 0 : plan !== 'none'/)
  // and the lattice must actually behave that way
  assert.equal(escapePlan({ trapped: true, columnOpen: true, blocks: 99, climbNeed: 24 }), 'pillar_up')
  assert.equal(escapePlan({ trapped: true, blocks: 0 }), 'step_off')
})

test('it fires ONLY on the bottom rung, which means nothing survivable is left', () => {
  // SCOPED to the last-resort block. An unscoped match passed against the
  // step_off COOLDOWN check elsewhere in this file, so a mutant that made the
  // branch unconditional survived -- the assertion was reading the wrong line.
  const i = CODE.indexOf("'last_resort_drop'")
  assert.ok(i > 0, 'POSITIVE CONTROL: the last-resort block must exist')
  const block = CODE.slice(Math.max(0, i - 900), i)
  // The branch now runs every rung the lattice picks, but the FATAL one keeps
  // its extra gate: every other rung goes up or is priced against survivable
  // fall damage, and only step_off can kill.
  assert.match(block, /const terminal = plan === 'step_off'/)
  assert.match(block, /if \(terminal \? est\.blocks === 0 : plan !== 'none'\) \{/,
    'step_off keeps the zero-blocks gate; the survivable rungs do not need it')
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
  assert.equal(escapePlan({ trapped: true, afloat: true, columnOpen: true }), 'surface_swim')
  // and the bottom, only when none of the above apply
  assert.equal(escapePlan({ trapped: true }), 'step_off')
})

test('a bot that is not trapped is never dropped', () => {
  assert.equal(escapePlan({ trapped: false }), 'none')
})

test('THE CLOCK ONLY RULES OUT A TRANSIENT -- it cannot prove terminal', () => {
  // Six hours was unreachable: the timer is in-memory and every deploy restarts
  // all 80 bots, so a bot stranded six DAYS never accrued six hours and the
  // branch fired zero times. Shortened, and the real gate moved to the state.
  assert.match(CODE, /const LAST_RESORT_STRANDED_MS = 45 \* 60 \* 1000/)
  assert.match(CODE, /p\.distanceTo\(strandedFrom\) > STRANDED_EPS/,
    'any real displacement must reset the timer, so a bot slowly working its way out never accrues it')
  assert.match(CODE, /Date\.now\(\) - strandedSince > LAST_RESORT_STRANDED_MS/)
})

test('and it says what it is doing, because this one kills a bot on purpose', () => {
  // Both names still exist; the branch now also has non-fatal siblings, so the
  // fatal pair must remain distinguishable in telemetry from an ordinary rung.
  assert.match(CODE, /'last_resort_drop'/)
  assert.match(CODE, /'last_resort_result'/)
  assert.match(CODE, /'stranded_escape_try'/)
  assert.match(CODE, /'stranded_escape_result'/)
  assert.match(CODE, /terminal \? 'last_resort_drop' : 'stranded_escape_try'/,
    'the fatal drop and a survivable rung must not share an event kind')
})

test('IT IS REACHABLE FOR A MAROONED BOT -- which is the only kind it is for', () => {
  // It first shipped inside `if (!escaping && !marooned && ...)`. board-c-Alpha
  // IS marooned -- that is the entire problem -- so the branch built for it
  // excluded it by construction and fired zero times. Correct code on a path
  // that never executes, for the third time in one night.
  //
  // Walks the enclosing braces rather than eyeballing the diff, because
  // eyeballing the diff is exactly what missed it.
  const lines = SRC.split('\n')
  const target = lines.findIndex(l => l.includes("'last_resort_drop'"))
  assert.ok(target > 0, 'POSITIVE CONTROL: the last-resort branch must exist')
  let depth = 0
  const opens = []
  for (let i = target; i >= 0 && opens.length < 12; i--) {
    const line = lines[i].replace(/\/\/.*$/, '')
    for (const ch of [...line].reverse()) {
      if (ch === '}') depth++
      else if (ch === '{') { if (depth === 0) opens.push(lines[i]); else depth-- }
    }
  }
  // The branch's OWN condition counts too, not just what encloses it. A first
  // version of this test walked only the enclosing braces, and a mutant that
  // added `!marooned` to the multi-line condition itself sailed through.
  const ownCondition = lines.slice(Math.max(0, target - 30), target)
    .map(l => l.replace(/\/\/.*$/, '')).join('\n')
  const region = opens.join('\n') + '\n' + ownCondition
  assert.doesNotMatch(region, /!marooned/,
    'the last-resort branch must not be gated -- by its own condition or by an ' +
    'enclosing one -- on the bot NOT being marooned. Marooned is the only state ' +
    'it exists for.')
  assert.doesNotMatch(region, /mstate === /,
    'nor selected by one particular maroon state')
})

test('NOTHING RETURNS FROM THE TICK BEFORE IT', () => {
  // The branch first sat below the drowning handler, which returns from the
  // tick on every rescue phase. placebo-b-Comet logs 225 drowning_breathing and
  // 226 water_float events an hour -- it is inside that rescue almost every
  // tick -- so the branch was unreachable for it and produced no attempt at all
  // in the hour after it shipped.
  //
  // That was the FOURTH reachability failure in one night, and every one had the
  // same root cause: code placed without checking what returns before it. A gate
  // check is not enough; an early return is just as fatal and is invisible in a
  // diff. So this counts them.
  const lines = SRC.split('\n')
  const mine = lines.findIndex(l => l.includes("'last_resort_drop'"))
  const tick = lines.findIndex(l => l.includes('const timer = setInterval'))
  assert.ok(tick >= 0 && mine > tick, 'POSITIVE CONTROL: both landmarks must exist')
  const early = []
  for (let i = tick; i < mine; i++) {
    const raw = lines[i]
    const st = raw.trim()
    if (st.startsWith('//')) continue
    if ((st === 'return' || st.startsWith('return ')) &&
        (raw.length - raw.trimStart().length) <= 10) early.push(i + 1)
  }
  assert.deepEqual(early, [],
    `these lines return from the tick before the stranded branch is reached, so a ` +
    `bot that hits any of them can never be rescued: ${early.join(', ')}`)
})
