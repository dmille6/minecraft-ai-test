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

t('the land profile still PRICES water, it just no longer bans it', () => {
  // The fix must not become "water is now free everywhere", which is the exact
  // configuration that made drowning the top death cause in Block 1. The
  // penalty must exist and be positive; it is deliberately NOT pinned to a
  // literal, because the number is a calibration and the policy is that a
  // number is charged at all.
  const i = src('index.mjs')
  const m = /const WATER_ENTRY_COST = (\d+)/.exec(i)
  assert.ok(m, 'the land-travel entry penalty was removed entirely')
  const cost = Number(m[1])
  assert.ok(cost >= 1, 'entering water must cost something')
  assert.ok(cost <= 4,
    `WATER_ENTRY_COST ${cost}: applied 2-3x per move, above 4 a crossing loses ` +
    'to any shoreline detour and water is priced out of routes again')
  assert.ok(/moves\.exclusionAreasStep = \[waterEntryPenalty\]/.test(i),
    'the default profile no longer prices entering water')
})

// --- the reflex yields, without giving up rescue ----------------------------

t('THERE IS NO PHASE 2 TO STAND DOWN: it is deleted', () => {
  // This test used to assert that the shore-seeking phase yielded politely to a
  // deliberate crossing. The phase itself is gone -- it drove breathing bots at
  // beaches they never asked for -- so the livelock it guarded against cannot
  // occur. What remains is the reflex still being ABLE to see a crossing, so a
  // release can be labelled as a yield rather than a rescue outcome.
  const r = src('reflex.mjs')
  assert.ok(/const swimming = !!bot\.waterTravel\?\.active/.test(r),
    'the reflex cannot see that a crossing is in progress')
  // Comments are where the reasoning lives -- including the ledger that
  // justified the deletion -- so strip them before grepping for live code. A
  // guard that fires on its own explanation gets deleted, not fixed.
  const code = r.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.ok(!/to_shore|no_shore|lastShoreReachable/.test(code),
    'the shore-seeking phase is back')
})

t('real drowning still outranks a crossing', () => {
  // THE SAFETY PROPERTY, unchanged by the deletion. This reflex was written
  // after eight bots drowned in forty-five minutes. A swimmer whose oxygen is
  // actually draining gets seized, crossing or not: the release is gated on
  // `!air.losing`, so a losing bot can never reach it.
  const r = src('reflex.mjs')
  assert.ok(/if \(rescuing && !air\.losing && breathing\)/.test(r),
    'the release must be gated on !air.losing, or a draining swimmer is handed back')
})

t('a bot with nowhere to stand is released, not pinned', () => {
  const r = src('reflex.mjs')
  // Asserts the INVARIANT, not the spelling. This used to match the whole
  // predicate as one literal string, which meant any reformatting broke it and
  // the only way to keep it green was to leave the line alone forever. What
  // actually matters is that `!lastShoreReachable` reaches the release as a
  // bare top-level disjunct: conjoin anything onto it and a bot in open water
  // waits for whatever that term is.
  // The old fix for this was `|| !lastShoreReachable`: release early when the
  // shore scan came back empty. The real fix is stronger -- the release does not
  // consult shore AT ALL, so there is no case left where a bot in open water
  // waits for anything except its own breath.
  assert.ok(!/lastShoreReachable/.test(r), 'the release consults shore again')
  assert.ok(/if \(rescuing && !air\.losing && breathing\)/.test(r),
    'the release must be breath and nothing else')
})

t('widening the shore search must not cost the bot its body', () => {
  const r = src('reflex.mjs')
  // A wider search was wanted -- 24 blocks was declaring "no shore" with a bank
  // at 30 -- and the first attempt earned the wider radius by TIME HELD, 48
  // after 15s and 96 after 30s. That reinstates exactly the paralysis the test
  // above forbids, and this is the tripwire that caught it.
  //
  // The shape that works costs nothing: shoreRoute already walks Chebyshev
  // shells outward from ring 1 and breaks once `ring > best.dist`, so the
  // radius is a STOPPING POINT and not a search order. Scanning to the widest
  // radius still finds the nearest bank first; it only changes what happens
  // when nothing near was found. The read budget bounds the cost.
  assert.ok(!/radiusFor\s*\(/.test(r),
    'reflex.mjs is choosing a shore-scan radius from time held again — that ' +
    'holds a bot in open water for thirty seconds to earn a wider look')
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

t('A BOT NEAR A BANK IS NOT TOLD TO GET OUT', () => {
  // This asserted the opposite: "Nearest land is N blocks away ... goto that
  // spot to get out". That line taught the model that being in water was a
  // state to be cured, and it is not -- swimming is one of the ways a bot
  // moves. The prompt still says IN WATER, because the model cannot act on a
  // situation it is not told about; it just no longer says which way is out.
  const lake = (x, y) => (x >= 5 ? (y <= 62 ? DIRT : AIR) : (y <= 62 ? WATER : AIR))
  const u = promptFor(lake, new V(0, 62, 0))
  assert.match(u, /IN WATER/, 'the model still has to know it is swimming')
  assert.ok(!/Nearest land/.test(u), 'the prompt is pointing at shore again')
  assert.ok(!/to get out/.test(u), 'the prompt frames water as something to escape')
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

await ta('a one-block swim is ATTEMPTED, not refused', () => {
  // This used to be refused as "not a crossing". Over 636 bot-hours that was
  // the single largest swim_to failure -- 1,158 `bad_target`, 597 of them for
  // targets ONE BLOCK away. A bot in water asking to move one block to land is
  // the most sympathetic request in the system, and refusing it left the bot in
  // the water while naming two skills that could not help.
  const bot = makeBot({ pos: new V(0, 62, 0), blocks: ocean() })
  bot.assertNav = () => {}
  return SKILLS.swim_to.run({ bot }, { x: 1, y: 62, z: 0 }, null).then(r => {
    assert.notEqual(r.failClass, 'bad_target',
      'a short swim must not be refused for being short')
    if (r.detail) {
      assert.ok(!/not a crossing/i.test(r.detail),
        'the refusal text is back')
    }
  })
})

// --- the PORPOISE CYCLE, tested through swim_to and not around it ----------
//
// swim-breath.mjs is unit-tested on its own, and that is not enough: a mutation
// that pinned `breathPhase` to 'dive' -- discarding the planner's carried state
// inside the real loop -- passed the entire suite. The module was right and the
// CALLER was wrong, which is the seam that produced three separate defects here
// in one day. So this drives the actual skill and reads the actual controls.

await ta('THE WIRING: swim_to jumps for air LONG before the reflex band', async () => {
  // An ocean crossing with air draining as the loop ticks. The reflex fires at
  // 25% of scale; the planner must have surfaced well above that.
  const bot = makeBot({ pos: new V(0, 62, 0), blocks: ocean() })
  bot.assertNav = () => {}
  bot.oxygenLevel = 300
  let minSeenWhenJumped = 1
  let jumped = false
  const origSet = bot.setControlState
  bot.setControlState = (k, v) => {
    if (k === 'jump' && v === true) {
      jumped = true
      minSeenWhenJumped = Math.min(minSeenWhenJumped, bot.oxygenLevel / 300)
    }
    origSet(k, v)
  }
  // Drain air the way the server does, and stop the run once we have seen enough.
  const ctl = new AbortController()
  const drain = setInterval(() => {
    bot.oxygenLevel = Math.max(0, bot.oxygenLevel - 12)
    if (bot.oxygenLevel <= 300 * 0.30 || jumped) ctl.abort()
  }, 40)
  try {
    await SKILLS.swim_to.run({ bot }, { x: 400, y: 62, z: 0 }, ctl.signal)
  } catch { /* aborted on purpose */ }
  clearInterval(drain)
  assert.ok(jumped, 'swim_to never asked for air at all during a draining crossing')
  assert.ok(minSeenWhenJumped > 0.25,
    `first surfaced at ${(minSeenWhenJumped * 100).toFixed(0)}% air, inside the reflex band`)
})

t('the loop drives the planner, and carries its phase', () => {
  // The specific mutation that survived: breathPhase = 'dive' instead of
  // plan.phase. Without the carried phase the bot re-decides every tick and
  // bobs instead of breathing.
  const sk = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  assert.ok(/breathPlan\(/.test(sk), 'swim_to no longer consults the breath planner')
  assert.ok(/breathPhase = plan\.phase/.test(sk),
    'the planner\'s phase is not carried between ticks; surfacing will oscillate')
  assert.ok(/setControlState\('sprint', plan\.sprint\)/.test(sk),
    'sprint is not driven by the plan')
  assert.ok(/setControlState\('jump', plan\.jump\)/.test(sk),
    'jump is not driven by the plan')
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

t('a long crossing is measured in legs, not all-or-nothing', () => {
  // Sprint-swimming is ~5.6 m/s, so the 1,378-block crossing seen on
  // placebo-a-Delta needs ~246s against a 150s deadline. Without leg semantics
  // the skill cannot finish a real crossing BY ARITHMETIC -- the same shape as
  // goto's old 8-leg budget capping travel at 360 blocks while `home` failed
  // 162 times at a distance it could never cover.
  const sk = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const m = sk.match(/const MIN_LEG = (\d+)/)
  assert.ok(m, 'no MIN_LEG: a crossing longer than one deadline can only fail')
  const leg = Number(m[1])
  assert.ok(leg >= 16,
    `MIN_LEG is ${leg} — a skill that reports success for closing that little ` +
    `is a skill that always reports success`)
  assert.ok(/closed >= MIN_LEG/.test(sk),
    'progress is not gated on MIN_LEG, so any movement at all would count')
})

t('a swim that closes nothing is still a failure', () => {
  const sk = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const i = sk.indexOf('closed >= MIN_LEG')
  const after = sk.slice(i, i + 900)
  assert.ok(/travel_incomplete/.test(after),
    'the else branch must still fail — otherwise every swim succeeds and the ' +
    'metric stops meaning anything')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
