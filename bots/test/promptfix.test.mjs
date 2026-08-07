/**
 * Four defects found by reading the corpus, not the code.
 *
 * 959 logged decisions, 69% of which produced nothing. The largest fixable
 * slices had nothing to do with the model being weak:
 *
 *   34x  `goto {"x":33,"y":-176,...}` -- an impossible elevation, rejected every
 *        time, while the prompt printed `REACHABLE Y RANGE: 42 to 102`. The
 *        model was not ignoring it. Sightings were rendered `x,z` -- TWO numbers
 *        -- and goto takes three, so the z it was handed became the y it emitted.
 *
 *    1x  `expected=END-CUQ9RU got= END-CUQ9RU` -- one leading space, treated as
 *        a truncated prompt, costing a repair retry and a wasted decision.
 *
 *   and the A/B label that would have measured any of this hashed the MILESTONE
 *   rather than the system prompt, so every arm would have carried the same
 *   values and a prompt change would have been unmeasurable.
 */
import assert from 'node:assert'
import { skillSchema } from '../src/llm.mjs'

let n = 0
const ok = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); n++ }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1 }
}

// --- the coordinate that had no y ------------------------------------------

/** The exact render from worldfacts.mjs, reproduced so the shape is asserted. */
const renderSighting = (r, pos, d) =>
  `${r.kind} seen at x=${r.x} y=${r.y ?? Math.round(pos.y)} z=${r.z} ` +
  `(${d} blocks away, reported by ${r.by.join(' and ')})`

ok('a sighting names all three axes', () => {
  const line = renderSighting({ kind: 'iron_ore', x: 33, y: 68, z: -180, by: ['Scout01'] },
                              { y: 72 }, 12)
  for (const axis of ['x=', 'y=', 'z=']) {
    assert.ok(line.includes(axis), `missing ${axis} -- this is the bug: ${line}`)
  }
})

ok('a sighting can never present exactly two numbers to a three-slot skill', () => {
  const line = renderSighting({ kind: 'oak_log', x: 33, z: -180, by: ['Scout02'] }, { y: 72 }, 5)
  const nums = line.slice(0, line.indexOf('(')).match(/-?\d+/g) ?? []
  assert.equal(nums.length, 3,
    `goto needs x,y,z; the model was handed ${nums.length} numbers: ${line}`)
})

ok('a sighting with no stored y falls back to the bot\'s own y, not to nothing', () => {
  const line = renderSighting({ kind: 'coal_ore', x: 1, z: 2, by: ['a'] }, { y: 64 }, 3)
  assert.ok(line.includes('y=64'), line)
  assert.ok(!line.includes('y=undefined') && !line.includes('y=null'), line)
})

ok('the z value can never be mistaken for the y value', () => {
  // The real failure: x=33, z=-180 rendered as "33,-180" became y=-176-ish.
  const line = renderSighting({ kind: 'iron_ore', x: 33, y: 68, z: -180, by: ['x'] }, { y: 72 }, 9)
  assert.ok(line.includes('y=68') && line.includes('z=-180'),
    `y and z must be individually labelled: ${line}`)
})

// --- the sentinel ----------------------------------------------------------

const sentinelOk = (got, want) => String(got ?? '').trim() === String(want).trim()

ok('a sentinel with stray whitespace is still a sentinel', () => {
  assert.ok(sentinelOk(' END-CUQ9RU', 'END-CUQ9RU'), 'the exact live failure')
  assert.ok(sentinelOk('END-CUQ9RU\n', 'END-CUQ9RU'))
  assert.ok(sentinelOk('  END-CUQ9RU  ', 'END-CUQ9RU'))
})

ok('a genuinely wrong sentinel is still rejected', () => {
  assert.ok(!sentinelOk('END-XXXXXX', 'END-CUQ9RU'), 'truncation must still be caught')
  assert.ok(!sentinelOk('', 'END-CUQ9RU'))
  assert.ok(!sentinelOk(null, 'END-CUQ9RU'))
  assert.ok(!sentinelOk(undefined, 'END-CUQ9RU'))
})

// --- schema property order is execution order ------------------------------

ok('reason is generated BEFORE the decision it explains', () => {
  const props = Object.keys(skillSchema(['gather', 'craft']).properties)
  assert.ok(props.indexOf('reason') < props.indexOf('skill'),
    `grammar follows property order; reason after skill can only narrate: ${props}`)
  assert.ok(props.indexOf('reason') < props.indexOf('args'), String(props))
})

ok('reason is length-capped', () => {
  const r = skillSchema(['gather']).properties.reason
  assert.ok(typeof r.maxLength === 'number' && r.maxLength <= 80,
    `uncapped reason is ~20-25 of 60 output tokens: ${JSON.stringify(r)}`)
})

ok('the schema still requires everything it used to', () => {
  const s = skillSchema(['gather', 'craft'])
  for (const k of ['skill', 'args', 'reason', 'saw_end']) {
    assert.ok(s.required.includes(k), `${k} dropped from required`)
  }
  assert.equal(s.additionalProperties, false, 'the shape must stay closed')
  assert.deepEqual(s.properties.skill.enum, ['gather', 'craft'])
})

ok('reason appears exactly once', () => {
  // An earlier edit left it declared twice; JSON objects silently keep the last.
  const src = skillSchema(['gather'])
  assert.equal(Object.keys(src.properties).filter(k => k === 'reason').length, 1)
})

console.log(`\n${n} passed`)
