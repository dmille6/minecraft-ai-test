// WATER TRAVEL HAS NO VERB, AND THAT IS THE POINT.
//
// This file replaces water-travel.test.mjs and water-admission.test.mjs, which
// between them asserted that `swim_to` exists, that the prompt advertises it,
// and that `goto` is REFUSED in open water. All three are now false on purpose.
//
// What was deleted, and why, in one place so the next reader does not have to
// reconstruct it:
//
//   swim_to travelled SUBMERGED for speed. Driving prismarine-physics directly
//   on a 1.21.8 ocean: submerged is 1.9600 b/s with sprint ON or OFF --
//   bit-identical, because prismarine-physics contains the string "swim" zero
//   times -- against 2.0853-2.1475 b/s at the surface. Diving was ~7% SLOWER.
//   The premise was not merely unreachable, it was inverted.
//
//   It arrived 111 times in 760 crossings (14.6%) across its life. The
//   admission veto that forbade `goto` in water had an escape hatch, and the
//   274 crossings it accidentally let through succeeded 85.4% with a median
//   displacement of 39.3 blocks -- better than this fleet's DRY LAND travel,
//   and 22x what swim_to managed.
//
// The invariant this file defends: the fleet has exactly one way to travel, and
// it works in water because the pathfinder swims. If someone reintroduces a
// swim verb, these tests should be the thing that argues with them.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.LOG_LEVEL ??= 'error'
const { SKILLS } = await import('../src/skills.mjs')
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8')
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('there is no swim verb', () => {
  assert.ok(!SKILLS.swim_to, 'swim_to is deleted; water travel is goto')
  // POSITIVE CONTROL: the registry is loaded and does contain travel verbs, so
  // the absence above is a real absence and not an empty import.
  assert.ok(SKILLS.goto, 'positive control: goto is registered')
  assert.ok(SKILLS.explore, 'positive control: explore is registered')
})

test('the prompt does not advertise one', () => {
  // STRIPPED, because the comment that explains the deletion quotes the string
  // it deleted -- and the first version of this test matched that comment and
  // failed. This codebase's comments habitually quote the code they discuss,
  // which is exactly why source assertions here must run on executable text.
  const p = strip(read('prompt.mjs'))
  assert.ok(!/swim_to\s+args:/.test(p), 'no usage line may offer a verb that does not exist')
  assert.ok(!/goto cannot cross water/.test(p),
    'and the prompt must stop teaching the model a thing that was never true')
  // Positive control: the strip did not simply empty the file.
  assert.match(p, /goto\s+args:/, 'goto is still advertised')
})

test('the IN WATER hint points at a verb that exists', () => {
  const p = read('prompt.mjs')
  const m = p.match(/IN WATER: you are swimming[\s\S]{0,700}?`\s*\n\}/)
  assert.ok(m, 'the IN WATER hint is still there — a bot afloat still needs telling where it is')
  assert.match(m[0], /goto|explore/, 'and it names a travel verb the model can actually select')
  assert.ok(!/swim_to/.test(m[0]), 'but not the deleted one')
})

test('admission no longer forbids land travel in water', () => {
  // The veto was 1,278 rejections a day, 5% of every decision across 41 bots,
  // and its own forced-passthrough disproved its premise.
  const a = strip(read('admission.mjs'))
  assert.ok(!/water_blocks_land_travel/.test(a), 'the veto is gone from executable code')
  assert.ok(!/waterVetoStreak/.test(a), 'and so is the streak counter it needed')
  assert.ok(!/MAX_WATER_VETO_STREAK/.test(a), 'and the constant behind its escape hatch')
})

test('nothing still reaches for the deleted skill', () => {
  for (const f of ['skills.mjs', 'admission.mjs', 'prompt.mjs', 'reflex.mjs', 'cognitive.mjs']) {
    const code = strip(read(f))
    assert.ok(!/\bswimTo\b/.test(code), `${f} still calls swimTo`)
    assert.ok(!/SKILLS\.swim_to|SKILLS\['swim_to'\]/.test(code), `${f} still indexes swim_to`)
    assert.ok(!/breathPlan/.test(code), `${f} still imports the deleted breath planner`)
  }
})

test('bot.waterTravel is never set, so nothing may depend on it', () => {
  // swim_to was the only writer. The reflex used it as an ownership signal
  // because swim_to threw away its pathfinder goal and failed the real test --
  // `runner.isBusy() && bot.pathfinder.goal`. goto holds a goal for the whole
  // crossing, so pathfinder-driven swimming is owned by the test that was
  // always there.
  for (const f of ['skills.mjs', 'reflex.mjs', 'index.mjs']) {
    assert.ok(!/waterTravel\s*=/.test(strip(read(f))), `${f} still assigns waterTravel`)
  }
})

test('the air reflex survives — swimming is travel, drowning is still danger', () => {
  // The owner directive is "the only water reflex is getting air". Deleting the
  // travel skill must not have deleted the rescue.
  const r = strip(read('reflex.mjs'))
  assert.match(r, /assessAir/, 'the air assessment is still wired')
  assert.match(r, /waterPosture/, 'and so is the posture hold that keeps a bot afloat')
})
