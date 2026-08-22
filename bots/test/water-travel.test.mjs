// WATER IS TERRAIN, AND THE AGENT WAS BUILT NOT TO BELIEVE THAT.
//
// The platform priced a wet step at ~86 against ~1 on land, had no boat and no
// swim verb outside the drowning reflex, and the source said so plainly:
// "The bots do not need to cross water; they need to stop volunteering for it."
// That was a correct read of Block 1, where drowning was the top death cause.
// It is not a correct read of Minecraft, where water is most of the map.
//
// What it cost, measured 2026-08-22 on the 40-bot fleet:
//
//   board-b-Comet   (1544,425) -> (1556,473), ~50 blocks, while logging NINETY
//                   consecutive drowning_no_shore events
//   placebo-b-Delta (1728,335) -> (1852,334), reached land unaided
//   placebo-a-Echo  reached land unaided
//   drowning_reentry  74 firings against 108 releases
//
// All three were swimming. All three were logged as failed rescues. The reflex
// held them at `forward:false, jump:true` waiting for a shore outside its scan
// radius, released at the ceiling, and re-seized on the next submersion. The
// reentry counter was measuring that livelock.
//
// These tests pin the three pieces that had to ship together, because shipping
// any one alone just moves the livelock somewhere else: a swim verb, a movement
// profile that can plan water, and a reflex that yields to a deliberate crossing
// WITHOUT giving up real drowning rescue.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { SKILLS } from '../src/skills.mjs'
import { makeBot, ocean, V, AIR, WATER, DIRT } from './helpers/microworld.mjs'
import { buildUserPrompt } from '../src/prompt.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')

// --- the verb exists and is reachable --------------------------------------

t('swim_to is a selectable skill', () => {
  assert.ok(SKILLS.swim_to, 'no swim_to in the registry — the agent still has no word for crossing')
  assert.ok(!SKILLS.swim_to.chatOnly, 'swim_to must be selectable by the model, not just by chat')
})

t('the model is told what swim_to is for', () => {
  // A capability the LLM cannot see is a capability the fleet does not have.
  const p = src('prompt.mjs')
  assert.ok(/swim_to\s+args:/.test(p), 'swim_to has no usage line')
  assert.ok(/ALREADY IN WATER/i.test(p),
    'the prompt must say swim_to is for when you are already in water, or the model will use it as a goto')
})

// --- it refuses the job it cannot do ---------------------------------------

await ta('a dry bot asking to swim is refused, with a class', async () => {
  const bot = makeBot({ pos: new V(0, 64, 0), blocks: () => AIR })
  bot.assertNav = () => {}
  const r = await SKILLS.swim_to.run({ bot }, { x: 50, y: 64, z: 0 }, null)
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'unsupported',
    'a failure with no failClass leaves its cause to be guessed from prose')
  assert.match(r.detail, /not in water/i)
})

await ta('refusing does not leave waterTravel set', async () => {
  // A sticky flag would tell the drowning reflex to stand down FOREVER, which
  // converts a harmless refusal into a disabled safety layer.
  const bot = makeBot({ pos: new V(0, 64, 0), blocks: () => AIR })
  bot.assertNav = () => {}
  await SKILLS.swim_to.run({ bot }, { x: 50, y: 64, z: 0 }, null)
  assert.ok(!bot.waterTravel?.active, 'waterTravel left active after an early return')
})

// --- the movement profile ---------------------------------------------------

t('the water profile does not inherit the shared no-water policy', () => {
  const i = src('index.mjs')
  assert.ok(/waterMoves\.exclusionAreasStep\s*=\s*\[\]/.test(i),
    'waterMoves must REPLACE exclusionAreasStep. Every other profile copies the ' +
    'shared array by reference on purpose; inheriting it here would keep the ' +
    '25-per-step entry penalty and water would stay unreachable.')
  assert.ok(/bot\.waterMovements\s*=\s*waterMoves/.test(i), 'the profile is not exposed to skills')
})

t('a wet step is cheap enough to plan but not free', () => {
  const i = src('index.mjs')
  const m = i.match(/waterMoves\.liquidCost\s*=\s*(\d+)/)
  assert.ok(m, 'waterMoves sets no liquidCost')
  const cost = Number(m[1])
  assert.ok(cost >= 2 && cost <= 4,
    `liquidCost ${cost}: at 1 water is cheaper than land and bots volunteer for it ` +
    `again; above 4 a long crossing loses to any shoreline detour`)
})

t('the land profile still refuses water', () => {
  // The fix must not become "water is now free everywhere", which is the exact
  // configuration that made drowning the top death cause in Block 1.
  const i = src('index.mjs')
  assert.ok(/const WATER_ENTRY_COST = 25/.test(i), 'the land-travel entry penalty was removed')
  assert.ok(/moves\.exclusionAreasStep = \[waterEntryPenalty\]/.test(i),
    'the default profile no longer prices entering water')
})

// --- the reflex yields, without giving up rescue ----------------------------

t('phase 2 stands down during a deliberate crossing', () => {
  const r = src('reflex.mjs')
  assert.ok(/const swimming = !!bot\.waterTravel\?\.active/.test(r),
    'the reflex cannot see that a crossing is in progress')
  assert.ok(/!ashore\(\) && !rescueExpired\(\) && !swimming/.test(r),
    'phase 2 still steers the body while swim_to owns it — that is the livelock')
})

t('real drowning still outranks a crossing', () => {
  // THE SAFETY PROPERTY. This reflex was written after eight bots drowned in
  // forty-five minutes. Yielding to a swim must never yield oxygen loss.
  const r = src('reflex.mjs')
  const phase2 = r.indexOf('&& !swimming')
  assert.ok(phase2 > 0)
  // the guard sits inside a branch already gated on !air.losing
  const branch = r.slice(r.lastIndexOf('if (rescuing', phase2), phase2 + 40)
  assert.ok(/!air\.losing/.test(branch),
    'the swimming guard must sit inside a !air.losing branch, or a swimmer whose ' +
    'oxygen is draining would never be seized')
})

t('a bot with nowhere to stand is released, not pinned', () => {
  const r = src('reflex.mjs')
  assert.ok(/ashore\(\) \|\| rescueExpired\(\) \|\| swimming \|\| !lastShoreReachable/.test(r),
    'the release still waits for the ceiling when no shore exists — that is twenty ' +
    'seconds of paralysis per cycle for a bot in open water')
})

t('a yield is not counted as a rescue outcome', () => {
  const r = src('reflex.mjs')
  assert.ok(/drowning_yielded_to_swim/.test(r), 'no distinct kind for standing down')
  // It must NOT come from drowningRelease, whose three kinds are the escape-rate
  // denominator. A correct decision must not land there as a failure.
  const i = r.indexOf('drowning_yielded_to_swim')
  const near = r.slice(i - 400, i + 200)
  assert.ok(!/drowningRelease\(ashore\(\), \{\s*reason: 'swim/.test(near),
    'the yield is routed through drowningRelease and will pollute the escape rate')
})

// --- the model has to be able to SEE that it is in water --------------------

const promptFor = (blocks, pos) => {
  const bot = makeBot({ pos, blocks })
  bot.time = { day: 1, age: 100 }
  return buildUserPrompt({
    bot,
    milestone: { describe: 'test', progress: '0/1' },
    memory: { locations: {}, events: [] },
    lastOutcome: null, trigger: 'test', sentinel: 'x', lessons: [],
  }).user
}

t('a bot in open water is told so, and told what to do about it', () => {
  // swim_to shipped with "use this when you are ALREADY IN WATER" in its usage
  // line, to a model that was never told when that was true. A capability the
  // model cannot know applies is a capability the fleet does not have.
  const u = promptFor(ocean(), new V(0, 62, 0))
  assert.match(u, /IN WATER/, 'the observation never mentions water')
  assert.match(u, /swim_to/, 'it does not name the skill that solves this')
  assert.match(u, /not an emergency/i,
    'open water must be described as terrain; the whole bug was treating it as a crisis')
})

t('a bot near a bank is pointed at the bank, not told to swim the ocean', () => {
  const lake = (x, y) => (x >= 5 ? (y <= 62 ? DIRT : AIR) : (y <= 62 ? WATER : AIR))
  const u = promptFor(lake, new V(0, 62, 0))
  assert.match(u, /IN WATER/)
  assert.match(u, /Nearest land is \d+ blocks/, 'a reachable bank must be named with its distance')
})

t('a dry bot is not told about water at all', () => {
  // Prompt budget is real and events are dropped to fit it. A line that fires
  // on land would spend that budget on nothing.
  const u = promptFor(() => AIR, new V(0, 64, 0))
  assert.ok(!/IN WATER/.test(u), 'the water line fires when the bot is dry')
})

t('open water names a destination the model can actually use', () => {
  // The first version told the model to swim and did not say where. A bot in
  // open water does not know where land is -- that IS the situation -- so the
  // model supplied its own coordinates and asked for zero-block crossings.
  const u = promptFor(ocean(), new V(500, 62, 300))
  assert.match(u, /Your town is \d+ blocks/, 'no distance to a known destination')
  assert.match(u, /(north|south|east|west)/, 'no compass bearing — "dx=-500" is not actionable')
  assert.match(u, /swim_to 0 \d+ 0/, 'the concrete swim_to call is not spelled out')
  assert.match(u, /never your own position/,
    'nothing stops the model asking to swim to where it already is')
})

await ta('a one-block "crossing" is refused as a bad target', () => {
  // Accepting these turned a prompt defect into a skill that thrashed for
  // twelve seconds and aborted at oxygen 3.
  const bot = makeBot({ pos: new V(0, 62, 0), blocks: ocean() })
  bot.assertNav = () => {}
  return SKILLS.swim_to.run({ bot }, { x: 1, y: 62, z: 0 }, null).then(r => {
    assert.equal(r.status, 'failed')
    assert.equal(r.failClass, 'bad_target')
    assert.match(r.detail, /not a crossing/i)
  })
})

t('swim_to surfaces before it travels', () => {
  const sk = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const surf = sk.indexOf('SURFACE_MS')
  const loop = sk.indexOf('const DEADLINE_MS')
  assert.ok(surf > 0 && loop > 0, 'no surfacing phase in swim_to')
  assert.ok(surf < loop,
    'the surfacing phase must run BEFORE the travel loop, or a submerged bot ' +
    'swims horizontally and the oxygen guard fires having taken zero strokes')
  // Ordering alone is not enough: SURFACE_MS = 0 keeps the phase in the right
  // PLACE while removing it entirely, and an earlier version of this assertion
  // passed against exactly that mutant.
  const ms = sk.match(/const SURFACE_MS = ([0-9_]+)/)
  assert.ok(ms, 'SURFACE_MS is gone')
  const budget = Number(ms[1].replace(/_/g, ''))
  assert.ok(budget >= 2000,
    `SURFACE_MS is ${budget}ms — too short to actually reach the surface, so the ` +
    `phase is decoration`)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
