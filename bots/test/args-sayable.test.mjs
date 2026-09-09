// A SKILL ARG THE GRAMMAR FORBIDS IS A SKILL THAT CANNOT BE USED.
//
// `additionalProperties: false` in skillSchema compiles into the GBNF Ollama
// samples against, so an arg missing from that object is not ignored -- it is
// UNSAYABLE. The model cannot emit it however clearly the prompt asks for it.
//
// Measured 2026-09-09, 3h, 80 bots:
//   bucket   63 runs, 63 failures, every one "got \"\"" for action
//   build    declares `plan`, could never receive one -- and the fleet placed
//            84 blocks in twelve hours
//   explore  declares `blocks`, the arg this project's notes blamed the model
//            for "usually omitting". It could never send it, so every failed
//            explore collapsed onto the single avoid key `explore:{}` -- which
//            those same notes record as 35,304 vetoes, the worst in the system.
//
// This test is the mechanism that keeps it from happening a fourth time.
import assert from 'node:assert'
import test from 'node:test'
import { SKILLS } from '../src/skills.mjs'
import { skillSchema } from '../src/llm.mjs'

const schema = skillSchema(Object.keys(SKILLS))
const argProps = schema.properties.args.properties

test('POSITIVE CONTROL: the schema really does close the arg object', () => {
  // If additionalProperties were true this whole test would be vacuous.
  assert.equal(schema.properties.args.additionalProperties, false)
  assert.ok(Object.keys(argProps).length > 3)
})

test('EVERY declared skill arg is expressible', () => {
  const declared = new Set(Object.keys(argProps))
  const broken = []
  for (const [name, s] of Object.entries(SKILLS)) {
    for (const a of s.args ?? []) if (!declared.has(a)) broken.push(`${name}.${a}`)
  }
  assert.deepEqual(broken, [],
    `these skills declare args the grammar forbids, so the model cannot use them: ${broken.join(', ')}`)
})

test('the three that were broken are covered by name', () => {
  for (const a of ['action', 'plan', 'blocks']) {
    assert.ok(argProps[a], `${a} must be in the schema`)
  }
})

test('and they are ENUMS where the value set is closed', () => {
  // A pattern makes debris unsayable; an enum makes a wrong value unsayable.
  assert.deepEqual(argProps.action.enum, ['fill', 'pour'])
  assert.deepEqual(argProps.plan.enum, ['shelter', 'wall', 'pillar'])
})

test('the build plan enum matches the blueprints that actually exist', () => {
  // An enum offering a plan `build` does not implement is a different way of
  // being unusable.
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const i = src.indexOf('BLUEPRINTS = {')
  assert.ok(i > 0, 'POSITIVE CONTROL: BLUEPRINTS must exist')
  const seg = src.slice(i, src.indexOf('\n}', i))
  const names = [...seg.matchAll(/^ {2}([a-z_]+):/gm)].map(m => m[1])
  assert.deepEqual([...argProps.plan.enum].sort(), [...names].sort(),
    `the enum and the blueprints disagree: enum=${argProps.plan.enum} blueprints=${names}`)
})
import { readFileSync } from 'node:fs'
