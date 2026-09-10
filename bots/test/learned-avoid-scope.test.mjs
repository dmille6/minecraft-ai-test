// A LESSON MUST BE ABOUT THE THING IT CLAIMS TO BE ABOUT.
//
// `nothing_found` is the largest failure class on the rules that block this
// experiment's primary endpoint -- 68% of the `gather oak_log` rule, 9,909 of
// 51,742 recorded failures fleet-wide. It means "no target within N blocks of
// where I am standing", which is a fact about a PLACE, and it was stored as a
// permanent fact about a VERB.
//
// Everything below is behaviour. The decision is an exported pure function
// (placeVerdict), the store is a real Lessons on a real file, the routing is
// asserted by driving the real CognitiveLoop, and every claim that something
// does NOT happen is paired with a control showing the same instrument seeing
// it happen.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-lascope'
process.env.BOT_NAME = process.env.BOT_NAME || 'ScopeBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'

const { Lessons, placeVerdict, PLACE_RADIUS, PLACE_MEMORY, EVIDENCE_ONLY_IF_HERE } =
  await import('../src/lessons.mjs')
const { EVIDENCE_ABOUT_THE_ACTION, EVIDENCE_ONLY_IF_STUCK, evidenceScope, CognitiveLoop } =
  await import('../src/cognitive.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-lascope-'))
let seq = 0
const fresh = () => {
  const L = new Lessons(path.join(dir, `l${seq++}.json`))
  L.data.avoid = {}; L.data.worked = {}
  return L
}
const OAK = { block: 'oak_log', count: 16 }
const at = (x, z, y = 70) => ({ x, y, z })
const nf = (L, pos) => L.recordFailure('gather', OAK, 'nothing_found', pos)
const count = L => L.failCount('gather', OAK)

// ===========================================================================
// 1. THE POLICY, STATED ONCE
// ===========================================================================
console.log('\n-- the classification policy --')

t('nothing_found is evidence about a PLACE', () =>
  assert.equal(evidenceScope('nothing_found'), 'place'))
t('no_path is still evidence about the ACTION', () =>
  assert.equal(evidenceScope('no_path'), 'action'))
t('missing_ingredients is still SITUATIONAL', () =>
  assert.equal(evidenceScope('missing_ingredients'), 'situation'))
t('anything unnamed still gets no vote at all', () => {
  for (const fc of ['other', 'interrupted', 'path_budget', 'a_class_added_next_week', ''])
    assert.equal(evidenceScope(fc), null, `${fc} must not train the gate`)
})
t('the set lessons.mjs obeys IS the set cognitive.mjs publishes', () => {
  // Not a copy. A second declaration is the stale-mirror bug that
  // scripts/purge-situational-lessons.py already carries a warning about, and
  // it is exactly how "the policy Set is not bound to the call" happens.
  const fromCognitive = new Map([['x', EVIDENCE_ONLY_IF_HERE]])
  assert.ok(fromCognitive.get('x') === EVIDENCE_ONLY_IF_HERE)
  assert.ok(!EVIDENCE_ABOUT_THE_ACTION.has('nothing_found'))
  assert.ok(!EVIDENCE_ONLY_IF_STUCK.has('nothing_found'))
})

// ===========================================================================
// 2. placeVerdict -- LITERAL distances, so the constant is actually pinned
// ===========================================================================
//
// The first draft's assertions used PLACE_RADIUS as their own probe value, so
// they held for ANY value and `64 -> 6` passed the whole suite. Every distance
// below is a literal, and the mutant at the bottom proves it.
console.log('\n-- placeVerdict: literal distances, so PLACE_RADIUS is pinned --')

const ORIGIN = [at(0, 0)]
t('PLACE_RADIUS is 96 and PLACE_MEMORY is 8', () => {
  assert.equal(PLACE_RADIUS, 96)
  assert.equal(PLACE_MEMORY, 8)
})
t('no history at all is a SEED, never a move', () =>
  assert.equal(placeVerdict([], at(9999, 9999)), 'seed'))
t('standing still is known', () =>
  assert.equal(placeVerdict(ORIGIN, at(0, 0)), 'known'))
t('60 blocks away is still the same question', () =>
  assert.equal(placeVerdict(ORIGIN, at(60, 0)), 'known'))
t('95 blocks away is still the same question', () =>
  assert.equal(placeVerdict(ORIGIN, at(95, 0)), 'known'))
t('exactly 96 is still the same question (<=, not <)', () =>
  assert.equal(placeVerdict(ORIGIN, at(96, 0)), 'known'))
t('97 blocks away is a NEW question', () =>
  assert.equal(placeVerdict(ORIGIN, at(97, 0)), 'new'))
t('65 blocks away -- two 48-radius searches that still overlap -- is NOT new', () =>
  assert.equal(placeVerdict(ORIGIN, at(65, 0)), 'known',
    'the first draft used 2x the DEFAULT radius and called this a new place'))

t('distance is HORIZONTAL: digging 900 blocks straight down is not a new place', () =>
  assert.equal(placeVerdict([at(0, 0, 70)], at(0, 0, -830)), 'known',
    'a 3D metric grants amnesty exactly when the bot has descended away from the wood'))
t('but a horizontal walk at the same depth is', () =>
  assert.equal(placeVerdict([at(0, 0, 70)], at(400, 400, 70)), 'new'))

t('an unknown position is UNUSABLE, never cheaper than a known one', () => {
  for (const bad of [null, undefined, {}, { x: NaN, y: 70, z: 0 }, { x: 0, y: 70, z: Infinity }])
    assert.equal(placeVerdict(ORIGIN, bad), 'unusable',
      'a mid-respawn gap in bot.entity must not be a free amnesty on every rule')
})
t('junk in the history is filtered, not trusted', () =>
  assert.equal(placeVerdict([null, { x: NaN, z: 0 }], at(0, 0)), 'seed'))

t('past PLACE_MEMORY distinct regions it is about the verb, not the place', () => {
  const eight = Array.from({ length: 8 }, (_, i) => at(i * 500, 0))
  assert.equal(placeVerdict(eight, at(99999, 99999)), 'saturated')
  assert.equal(placeVerdict(eight.slice(0, 7), at(99999, 99999)), 'new',
    'control: with room to remember, the same position is a new place')
})

// ===========================================================================
// 3. THE PREMISE THE RADIUS RESTS ON, measured from the skill itself
// ===========================================================================
//
// PLACE_RADIUS = 96 is only defensible as 2x the LARGEST radius any
// nothing_found emitter searches. gather's maxDistance is model-supplied and
// clamped, and `maxDistance` is not in the avoid key -- SKILLS.gather.args is
// ['count','block'] -- so one key genuinely mixes radii. This reads the clamp
// out of the skill's own behaviour rather than out of a source grep.
console.log('\n-- the radius premise, read from gather itself --')

const gatherBot = () => ({
  entity: { position: { x: 0, y: 70, z: 0 } },
  registry: { blocksByName: { oak_log: { id: 17 } }, itemsByName: { oak_log: { id: 17 } },
              blocks: {}, items: {}, blocksArray: [] },
  inventory: { items: () => [] },
  findBlocks: () => [], findBlock: () => null,
  blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
})
const gatherRadius = async maxDistance => {
  const r = await SKILLS.gather.run({ bot: gatherBot() }, { block: 'oak_log', count: 4, maxDistance }, null)
  assert.equal(r.failClass, 'nothing_found', `expected nothing_found, got ${r.failClass}: ${r.detail}`)
  return Number(/within (\d+) blocks/.exec(r.detail)?.[1])
}

await ta('gather defaults to 32 and clamps to 48, and PLACE_RADIUS is twice the clamp', async () => {
  assert.equal(await gatherRadius(undefined), 32, 'the documented default moved')
  assert.equal(await gatherRadius(9999), 48, 'the clamp moved')
  assert.equal(await gatherRadius(12), 12, 'control: a smaller radius is honoured, so this reads the real value')
  // deposit and withdraw hard-code 48, which is the same number, so the clamp
  // is the largest search any nothing_found emitter performs.
  assert.ok(PLACE_RADIUS >= 2 * 48,
    `two ${48}-radius searches ${PLACE_RADIUS} apart would still overlap`)
})

// --- A VOCABULARY MISS IS NOT A PLACE, AND IT NEVER REACHES THIS STORE ------
//
// The obvious objection to a place-scoped reset is that `nothing_found` has
// more than one cause and only one of them is spatial. skills.mjs:723 documents
// the vocabulary case -- "coal" against a world containing `coal_ore`,
// "cobblestone" while standing on `stone`, `deepslate_` variants below y=0 --
// and moving does not cure any of those, so a place-reset would clear a rule
// that should have stood.
//
// Measured rather than assumed: it cannot happen, because resolveBlockName runs
// FIRST and a name it cannot resolve returns `unknown_block`, which is in none
// of the three evidence sets and therefore never becomes an avoid rule at all.
// There is no rule for a place-reset to wrongly clear. The aliases it CAN
// resolve are then genuinely spatial questions about the resolved block.
await ta('an unresolvable name is unknown_block, which gets no vote in any store', async () => {
  const r = await SKILLS.gather.run({ bot: gatherBot() },
    { block: 'unobtainium', count: 4 }, null)
  assert.equal(r.failClass, 'unknown_block',
    'a vocabulary miss must not be filed as "I looked and it was not here"')
  assert.equal(evidenceScope('unknown_block'), null,
    'so it never becomes an avoid rule, and no place-reset can clear one')
  // POSITIVE CONTROL: the same call with a name the registry knows really does
  // produce nothing_found, so the assertion above is about the NAME, not about
  // a stub that cannot fail any other way.
  const ok = await SKILLS.gather.run({ bot: gatherBot() }, { block: 'oak_log', count: 4 }, null)
  assert.equal(ok.failClass, 'nothing_found')
})

await ta('an ALIAS resolves, so what is left really is a question about here', async () => {
  const bot = gatherBot()
  bot.registry.blocksByName.coal_ore = { id: 16 }
  const r = await SKILLS.gather.run({ bot }, { block: 'coal', count: 4 }, null)
  assert.equal(r.failClass, 'nothing_found')
  assert.match(r.detail, /coal -> coal_ore/,
    'the resolution is reported, so "we found it under another name" stays distinguishable')
})

// ===========================================================================
// 4. THE COUNTER, through a real store
// ===========================================================================
console.log('\n-- the counter restarts when the place does, and only then --')

t('failing repeatedly WITHOUT moving still accrues', () => {
  const L = fresh()
  for (let i = 0; i < 10; i++) nf(L, at(0, i))     // shuffling a few blocks
  assert.equal(count(L), 10)
})

t('and then a genuine walk restarts the streak', () => {
  const L = fresh()
  for (let i = 0; i < 10; i++) nf(L, at(0, 0))
  assert.equal(count(L), 10, 'precondition')
  nf(L, at(2000, 2000))
  assert.equal(count(L), 1)
})

t('CONTROL: a class that is NOT place-scoped still ratchets across the same walk', () => {
  // Without this the test above would pass on a store that had simply forgotten
  // how to count.
  const L = fresh()
  for (let i = 0; i < 10; i++) L.recordFailure('gather', OAK, 'no_path', at(0, 0))
  L.recordFailure('gather', OAK, 'no_path', at(2000, 2000))
  assert.equal(count(L), 11)
})

t('an unknown position accrues and resets nothing', () => {
  const L = fresh()
  for (let i = 0; i < 10; i++) nf(L, at(0, 0))
  nf(L, null)
  assert.equal(count(L), 11)
})

// --- B5: OSCILLATION MUST NOT DEFEAT LEARNING ------------------------------
//
// The first draft remembered one `where` and compared against it, so a bot
// bouncing between two spots reset on EVERY failure: 40 failures gave a fail
// count of 1. Remembering the LIST is the fix -- the second visit to either
// spot is `known`.
console.log('\n-- oscillation must not defeat learning --')

const oscillate = (L, n, apart) => {
  for (let i = 0; i < n; i++) nf(L, i % 2 ? at(apart, 0) : at(0, 0))
  return count(L)
}
t('40 failures alternating 300 blocks apart still teach the rule', () => {
  const got = oscillate(fresh(), 40, 300)
  assert.ok(got >= 38, `expected the streak to survive oscillation, got ${got}`)
})
t('40 failures alternating 70 blocks apart are one place, and count as 40', () => {
  assert.equal(oscillate(fresh(), 40, 70), 40)
})
t('POSITIVE CONTROL: 40 failures at one spot count as 40', () => {
  const L = fresh()
  for (let i = 0; i < 40; i++) nf(L, at(0, 0))
  assert.equal(count(L), 40)
})
t('a bot that keeps genuinely relocating stops being forgiven after PLACE_MEMORY regions', () => {
  const L = fresh()
  for (let i = 0; i < PLACE_MEMORY; i++) nf(L, at(i * 500, 0))
  assert.equal(count(L), 1, 'each of the first eight regions restarts the streak')
  for (let i = 0; i < 5; i++) nf(L, at(50000 + i * 500, 0))
  assert.equal(count(L), 6, 'past eight regions it is about the verb and accrues normally')
})

t('place memory decays with the rule it qualifies', () => {
  const L = fresh()
  for (let i = 0; i < PLACE_MEMORY; i++) nf(L, at(i * 500, 0))
  const k = Object.keys(L.data.avoid)[0]
  assert.ok(L.data.avoid[k].placesBy?.[process.env.BOT_NAME]?.length === PLACE_MEMORY, 'precondition')
  L.data.avoid[k].fails = 20
  L.data.avoid[k].last = Date.now() - 7 * 60 * 60 * 1000    // older than DECAY_MS
  L.savesSincePrune = 24
  L.dirty = true
  L.save()
  assert.equal(L.data.avoid[k].placesBy, undefined,
    'a rule that saturated its regions in hour one would never be place-scoped again')
})

// ===========================================================================
// 5. THE ROUTING, driven through the REAL CognitiveLoop
// ===========================================================================
//
// THIS IS THE TEST THE FIRST DRAFT DID NOT HAVE. Its policy Set was not bound
// to the recordFailure call at all: mutating the call site's `true` to `false`
// switched the feature off with the whole suite green. There is no longer an
// argument at that call site -- the scoping is decided inside recordFailure
// from the class -- and this drives the real #tick, the real routing branch and
// a real Lessons store to prove the whole chain end to end.
console.log('\n-- the real cognitive loop, the real branch, a real store --')

const loopBot = pos => {
  const b = {
    entity: { position: pos, velocity: { x: 0, y: 0, z: 0 } },
    health: 20, food: 20, oxygenLevel: 300,
    time: { day: 1, age: 1, timeOfDay: 1000 },
    game: { dimension: 'overworld' },
    inventory: { items: () => [] },
    registry: { blocksByName: { oak_log: { id: 17 } }, itemsByName: {}, blocks: {}, items: {},
                biomesArray: [], biomes: {} },
    recipesFor: () => [], recipesAll: () => [],
    findBlock: () => null, findBlocks: () => [],
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    setControlState: () => {}, clearControlStates: () => {},
    players: {}, entities: {}, experience: { level: 0 },
  }
  return b
}

/** One real decision: the LLM proposes gather, the runner returns nothing_found. */
const oneDecision = async (lessons, pos) => {
  const runner = {
    isBusy: () => false,
    run: async () => ({ status: 'failed', failClass: 'nothing_found',
                        detail: 'no oak_log within 32 blocks' }),
  }
  const loop = new CognitiveLoop(loopBot(pos), runner, lessons, null)
  loop.llm = { decide: async () => ({
    schemaValid: true, latencyMs: 1,
    proposal: { skill: 'gather', args: OAK, reason: 'probe' },
  }) }
  loop.start()
  await new Promise(r => setTimeout(r, 120))
  loop.stop()
}

await ta('a nothing_found failure reaches the store through the production branch', async () => {
  const L = fresh()
  await oneDecision(L, at(0, 0))
  assert.equal(count(L), 1, 'the routing branch dropped it entirely')
})

await ta('END TO END: five failures here accrue, and one after a walk restarts them', async () => {
  const L = fresh()
  for (let i = 0; i < 5; i++) await oneDecision(L, at(0, 0))
  assert.equal(count(L), 5, 'five real decisions must accrue five failures')
  await oneDecision(L, at(3000, 3000))
  assert.equal(count(L), 1, 'the walk did not restart the streak through the real loop')
})

await ta('END TO END CONTROL: a sixth failure in the SAME place does not restart them', async () => {
  const L = fresh()
  for (let i = 0; i < 5; i++) await oneDecision(L, at(0, 0))
  await oneDecision(L, at(10, 10))
  assert.equal(count(L), 6)
})

// ===========================================================================
// 6. THE REFUSAL CHAIN
// ===========================================================================
console.log('\n-- the chain: a bot that walked away is admitted again --')

t('underground the rule bites, and after the walk the gate admits again', () => {
  const L = fresh()
  for (let i = 0; i < 10; i++) nf(L, at(0, 0, -55))
  const gate = new AdmissionControl(L)
  const bot = { registry: { blocksByName: { oak_log: {} }, itemsByName: {} }, players: {},
                entity: { position: at(0, 0, -55) }, inventory: { items: () => [] } }
  const before = gate.check({ skill: 'gather', args: OAK, reason: 'x' }, bot, null)
  assert.equal(before.ok, false, 'precondition: ten failures in one spot is a real rule')
  assert.equal(before.reason, 'learned_avoid')

  // The remedy is a walk, and the walk itself is what clears the rule -- no
  // advisory text the model has to notice and act on. Executable from anywhere.
  nf(L, at(900, 900, 72))
  assert.equal(count(L), 1)
  const after = gate.check({ skill: 'gather', args: OAK, reason: 'x' },
    { ...bot, entity: { position: at(900, 900, 72) } }, null)
  assert.equal(after.ok, true, 'the walk was performed and the door is still shut')
})

// ===========================================================================
// 7. THE MIRROR IN THE PURGE SCRIPT (no longer left to vigilance)
// ===========================================================================
console.log('\n-- scripts/purge-situational-lessons.py must agree with the running code --')

t('the purge script still classes nothing_found as evidence, and knows it is place-scoped', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const py = fs.readFileSync(path.join(here, '../../scripts/purge-situational-lessons.py'), 'utf8')
  const setOf = name => {
    const m = new RegExp(`^${name} = \\{([^}]*)\\}`, 'm').exec(py)
    assert.ok(m, `${name} not found in the purge script`)
    return new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]))
  }
  const still = setOf('STILL_EVIDENCE')
  const notEv = setOf('NOT_EVIDENCE')
  const placeScoped = setOf('PLACE_SCOPED')

  assert.deepEqual([...placeScoped].sort(), [...EVIDENCE_ONLY_IF_HERE].sort(),
    'the script has a different idea of which classes are place-scoped')
  // STILL_EVIDENCE is the union of the two sets that DO write avoid rules.
  const live = new Set([...EVIDENCE_ABOUT_THE_ACTION, ...EVIDENCE_ONLY_IF_HERE])
  assert.deepEqual([...still].sort(), [...live].sort(),
    'the script would purge (or spare) rules the running code does not agree about')
  // And the two lists must stay disjoint, or a class is both purged and kept.
  for (const fc of still) assert.ok(!notEv.has(fc), `${fc} is in both lists`)
})

// ===========================================================================
// 8. MUTANTS
// ===========================================================================
//
// withMutant, verbatim from bots/test/climb-escape.test.mjs:447. It writes a
// SEPARATE _mutant-<pid>-<rand>.mjs and NEVER touches src/. The previous
// attempt at this work mutated bots/src/*.mjs in place and restored in a
// `finally`; scripts/run-tests.mjs kills a slow file with SIGKILL, which is
// uncatchable, so the restore never ran and a permanently mutated source file
// was left on disk. fleet-recycle restarts every bot onto $H/src every six
// hours, so that is a fleet hazard.
console.log('\n-- mutants: each assertion must fail for the reason claimed --')

const LESSONS_PATH = new URL('../src/lessons.mjs', import.meta.url)
const COGNITIVE_PATH = new URL('../src/cognitive.mjs', import.meta.url)

async function withMutant (p, old, neu, fn) {
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

await ta('MUTANT KILLED: PLACE_RADIUS = 6 changes what the literal distances say', async () => {
  await withMutant(LESSONS_PATH, 'export const PLACE_RADIUS = 96', 'export const PLACE_RADIUS = 6',
    async mod => {
      assert.equal(mod.PLACE_RADIUS, 6, 'the mutant did not take')
      assert.equal(mod.placeVerdict(ORIGIN, at(95, 0)), 'new',
        'the assertions above were written against PLACE_RADIUS itself and hold for any value')
    })
})

await ta('MUTANT KILLED: without the place gate, a walk teaches nothing new', async () => {
  await withMutant(LESSONS_PATH,
    '    if (EVIDENCE_ONLY_IF_HERE.has(failClass)) {',
    '    if (false && EVIDENCE_ONLY_IF_HERE.has(failClass)) {',
    async mod => {
      const L = new mod.Lessons(path.join(dir, 'm-gate.json'))
      L.data.avoid = {}
      for (let i = 0; i < 10; i++) L.recordFailure('gather', OAK, 'nothing_found', at(0, 0))
      L.recordFailure('gather', OAK, 'nothing_found', at(2000, 2000))
      assert.equal(L.failCount('gather', OAK), 11, 'the streak reset without the gate')
    })
})

await ta('MUTANT KILLED: remembering only the LAST place lets oscillation erase the rule', async () => {
  // This is precisely the first draft's design, and B5's finding.
  await withMutant(LESSONS_PATH,
    '  const seen = (Array.isArray(places) ? places : [])',
    '  const seen = (Array.isArray(places) ? places.slice(-1) : [])',
    async mod => {
      const L = new mod.Lessons(path.join(dir, 'm-osc.json'))
      L.data.avoid = {}
      for (let i = 0; i < 40; i++)
        L.recordFailure('gather', OAK, 'nothing_found', i % 2 ? at(300, 0) : at(0, 0))
      assert.equal(L.failCount('gather', OAK), 1,
        '40 alternating failures must collapse to 1 under the one-place design')
    })
})

await ta('MUTANT KILLED: dropping the routing means nothing_found never reaches the store', async () => {
  await withMutant(COGNITIVE_PATH,
    'if (EVIDENCE_ABOUT_THE_ACTION.has(fc) || EVIDENCE_ONLY_IF_HERE.has(fc)) {',
    'if (EVIDENCE_ABOUT_THE_ACTION.has(fc)) {',
    async mod => {
      const L = fresh()
      const runner = { isBusy: () => false,
        run: async () => ({ status: 'failed', failClass: 'nothing_found', detail: 'no oak_log within 32 blocks' }) }
      const loop = new mod.CognitiveLoop(loopBot(at(0, 0)), runner, L, null)
      loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1,
        proposal: { skill: 'gather', args: OAK, reason: 'probe' } }) }
      loop.start()
      await new Promise(r => setTimeout(r, 120))
      loop.stop()
      assert.equal(L.failCount('gather', OAK), 0,
        'the end-to-end tests above would pass even with the branch removed')
    })
})

// --- THE WIDENING MUTANT, run against the REAL guards ----------------------
//
// A third evidence set is a maintenance hazard: the "is this class enforced"
// guards existed in three places and the first draft widened one of them, so a
// mutant that added collect_budget, goal_changed, path_timeout and stagnation
// to the new Set survived the entire suite. All three are widened now, and this
// proves it by running livelock.test.mjs and evidence-gate.test.mjs -- the real
// files, unmodified -- against a mutated COPY of the tree.
//
// A copy, not an in-place edit: src/ is never written to. It lives under bots/
// so that node_modules still resolves, and it is a directory run-tests.mjs does
// not scan (it reads test/ non-recursively), so even a SIGKILL that skips the
// cleanup leaves inert junk rather than a mutated production file.
console.log('\n-- the widening mutant, against the real three-set guards --')

await ta('MUTANT KILLED: widening the place set is caught by every guard', async () => {
  const botsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const tree = path.join(botsDir, `_mutant-tree-${process.pid}-${Math.random().toString(36).slice(2)}`)
  const ANCHOR = "export const EVIDENCE_ONLY_IF_HERE = new Set([\n  'nothing_found',\n])"
  const lessonsSrc = fs.readFileSync(path.join(botsDir, 'src/lessons.mjs'), 'utf8')
  assert.ok(lessonsSrc.includes(ANCHOR), 'MUTATION DID NOT APPLY: the set literal moved')
  assert.ok(lessonsSrc.split(ANCHOR).length === 2, 'the mutation target is not unique')

  fs.cpSync(path.join(botsDir, 'src'), path.join(tree, 'src'), { recursive: true })
  fs.cpSync(path.join(botsDir, 'test'), path.join(tree, 'test'), { recursive: true,
    filter: s => !path.basename(s).startsWith('_mutant-tree-') })
  fs.writeFileSync(path.join(tree, 'src/lessons.mjs'), lessonsSrc.replace(ANCHOR,
    "export const EVIDENCE_ONLY_IF_HERE = new Set([\n  'nothing_found',\n" +
    "  'collect_budget', 'goal_changed', 'path_timeout', 'stagnation',\n])"))

  const { spawnSync } = await import('node:child_process')
  try {
    for (const file of ['livelock.test.mjs', 'evidence-gate.test.mjs']) {
      const r = spawnSync(process.execPath, [path.join(tree, 'test', file)],
        { encoding: 'utf8', env: { ...process.env, LOG_LEVEL: 'error' } })
      assert.notEqual(r.status, 0,
        `${file} passed against a set widened with our own budgets -- ` +
        'its guard is still only looking at two of the three sets')
    }
    // POSITIVE CONTROL: the same two files, run the same way against the
    // UNMUTATED copy, must pass -- otherwise the failures above prove only that
    // the copy does not run.
    fs.writeFileSync(path.join(tree, 'src/lessons.mjs'), lessonsSrc)
    for (const file of ['livelock.test.mjs', 'evidence-gate.test.mjs']) {
      const r = spawnSync(process.execPath, [path.join(tree, 'test', file)],
        { encoding: 'utf8', env: { ...process.env, LOG_LEVEL: 'error' } })
      assert.equal(r.status, 0, `${file} fails even unmutated:\n${r.stdout}\n${r.stderr}`)
    }
  } finally {
    fs.rmSync(tree, { recursive: true, force: true })
  }
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
