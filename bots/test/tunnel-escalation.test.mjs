// "USE MINE TO DIG DOWN" WAS ADVICE, AND ADVICE PRINTED IS NOT ADVICE TAKEN.
//
// Measured over 5h on 80 bots: `gather iron_ore` was asked 307 times and
// succeeded TEN. 176 of the 297 failures (59%) were the single line "every
// candidate is buried -- use mine to dig down". Iron appeared in perception
// 210,601 times and was USABLE 4.2% of the time, because underground ore has no
// exposed face and `gather` requires one.
//
// This is the same defect as the craft->gather boundary already documented in
// skills.mjs: the skill knows the next move and prints it as prose.
//
// The allowlist is the safety property under test. Escalating for dirt would
// turn a cheap failure into a tunnel, 80 bots over.
import assert from 'node:assert'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
// The pattern is read out of the source it governs, so the test cannot drift
// from the code by asserting its own private copy.
const m = /const WORTH_TUNNELLING = (\/.*\/)\n/.exec(SRC)
const RE = m ? eval(m[1]) : null

test('POSITIVE CONTROL: the pattern was found in the source', () => {
  assert.ok(RE, 'WORTH_TUNNELLING not found; every assertion below would be vacuous')
})

test('ORE is worth a tunnel, including deepslate and the 1.21 variants', () => {
  for (const n of ['iron_ore', 'deepslate_iron_ore', 'coal_ore', 'deepslate_coal_ore',
                   'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore',
                   'diamond_ore', 'deepslate_diamond_ore', 'nether_quartz_ore']) {
    assert.equal(RE.test(n), true, `${n} should be worth tunnelling for`)
  }
})

test('ancient_debris too -- the same shape of problem, and the only non-_ore member', () => {
  assert.equal(RE.test('ancient_debris'), true)
})

test('THINGS THAT LIE EXPOSED EVERYWHERE ARE NOT', () => {
  // The buried copy has to be the ONLY copy. There is exposed dirt on every
  // hillside; digging for it is a cheap failure made expensive.
  for (const n of ['dirt', 'stone', 'sand', 'gravel', 'cobblestone', 'grass_block',
                   'oak_log', 'birch_log', 'clay', 'snow', 'water', 'crafting_table']) {
    assert.equal(RE.test(n), false, `${n} must NOT trigger a tunnel`)
  }
})

test('the escalation happens AT MOST ONCE per gather run', () => {
  // A gather that tunnels every round is a gather that never returns.
  assert.match(SRC, /let escalated = false/,
    'the once-only flag must exist')
  assert.match(SRC, /WORTH_TUNNELLING\.test\([^)]*\)\s*&&\s*!escalated/,
    'the escalation must be gated on the once-only flag')
})

test('it calls mine, and reports what mine SAID rather than reclassifying it', () => {
  assert.match(SRC, /await mine\(ctx, \{ y: depth \}/,
    'the escalation must actually invoke mine')
  assert.match(SRC, /mine said: \$\{String\(mineSaid\)/,
    "mine's own refusal must reach the failure detail verbatim")
})

test('and it is observable, because an unlogged escalation cannot be measured', () => {
  assert.match(SRC, /kind: 'gather_escalated_to_mine'/)
})
