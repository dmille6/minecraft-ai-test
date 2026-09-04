// THE GATE REFUSED THE BLOCK THE TASK NAMED.
//
// The brief this test came from said: gather finds oak_log, every candidate is
// BURIED, the failure accrues, four of them blacklist `gather oak_log`, and the
// bot can no longer attempt the thing it most needs. Fix: stop letting `buried`
// feed learned_avoid.
//
// THAT EDGE DOES NOT EXIST. Measured 2026-09-04 on the live fleet, two ways:
//
//   CODE   gather's buried branch returns failClass 'unreachable'
//          (skills.mjs, "found but every candidate is buried"). cognitive.mjs
//          routes on the skill's own failClass -- runner.mjs took the prose
//          classifier off the write path on purpose -- and 'unreachable' is in
//          none of the three evidence sets, so it is logged and given no vote.
//
//   DATA   64 live lesson stores, 809 avoid entries, 52,093 recorded failures.
//          The classes present are no_path 20,669 / nothing_found 13,629 /
//          missing_ingredients 13,626 / needs_station 4,161 / bad_target 8.
//          `buried` 0. `unreachable` 0. That zero's positive control is the
//          52,093 the same query found in the same field in the same files.
//
// So `buried` in EVIDENCE_ABOUT_THE_ACTION is a name nothing mints, and the
// proposed fix was a no-op. Section 1 pins that, so the next reader does not
// have to re-derive it.
//
// WHAT WAS ACTUALLY BROKEN, found while checking the above.
//
// The admission gate has an exemption -- milestone_critical -- whose whole job
// is that "a gate may not make the goal unreachable": an action producing what
// the current milestone needs is never hard-blocked, because an attempt is the
// only thing that can ever clear the rule blocking it. It reads
// `milestone.wants`. M.gather and M.craft set that. The SUSTAINING rungs are
// hand-written object literals and did not -- including the two the primary
// endpoint is measured on.
//
// Measured over 12h, 79,393 decisions, all 80 bots (llm-*.jsonl, llm.admission):
//
//   milestone_critical firings, total                      5,641   over 18 tasks
//     ...on "Collect N oak_log."      (M.gather rung)         556  <- CONTROL
//     ...on "Stockpile N oak logs."   (SUSTAINING rung)         0
//     ...on "Stockpile N cobblestone."(SUSTAINING rung)         0
//
//   learned_avoid vetoes where the ACTIVE TASK NAMES THE VETOED BLOCK:
//     gather oak_log     while "Stockpile N oak logs."      1,437
//     gather cobblestone while "Stockpile N cobblestone."   1,128
//
// Same skill, same blocks, same arms, same window. The only difference is which
// milestone object happened to be active. Those two rungs are 22.2% of every
// decision the fleet makes.
//
// This is the SECOND time this key has gone missing -- see the note on `wants`
// in M.gather, which records the first ("0 firings against 10 learned_avoid
// rejections in 40 minutes"). It came back because nothing made it impossible.
// So the fix is two values plus a tripwire that raises, and this file tests the
// tripwire's decision as an exported pure function rather than grepping for the
// values.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-mwants'
process.env.BOT_NAME = process.env.BOT_NAME || 'WantsBot'
process.env.MEMORY_SCOPE = process.env.MEMORY_SCOPE || 'isolated'
process.env.LOG_LEVEL = 'error'

const require_ = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const MILESTONES_PATH = new URL('../src/milestones.mjs', import.meta.url)

const { measuredItem, wantsGaps, SUSTAINING, MILESTONES_BY_ROLE, MilestoneController } =
  await import('../src/milestones.mjs')
const { evidenceScope, EVIDENCE_ABOUT_THE_ACTION, CognitiveLoop } =
  await import('../src/cognitive.mjs')
const { Lessons } = await import('../src/lessons.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const mcData = require_('minecraft-data')('1.21.8')
const isItem = n => !!mcData.itemsByName[n]

// ===========================================================================
// 1. THE NULL RESULT: a buried failure never reaches the avoid counter
// ===========================================================================
console.log('-- a "buried" gather failure has no vote, and never did --')

// The three names the taxonomy actually uses, so the negative below is read
// against a positive from the same instrument.
t('CONTROL: the classes that DO feed the counter still do', () => {
  assert.equal(evidenceScope('no_path'), 'action')
  assert.equal(evidenceScope('nothing_found'), 'place')
  assert.equal(evidenceScope('missing_ingredients'), 'situation')
})

t('the class gather ACTUALLY emits for buried has no vote', () => {
  assert.equal(evidenceScope('unreachable'), null,
    '`unreachable` now votes; the null result this file documents has changed')
})

t('`buried` is in the action set, and nothing in src can mint it', () => {
  // A STRUCTURAL ASSERTION, of the kind behaviour cannot reach: this is about
  // a string being ABSENT from every return in the tree. Comments are stripped
  // first because this codebase's comments quote the code they explain -- the
  // word "buried" appears in a dozen of them.
  assert.ok(EVIDENCE_ABOUT_THE_ACTION.has('buried'),
    'if `buried` has left the set, delete this test rather than weakening it')
  const stripped = fs.readFileSync(path.join(here, '../src/skills.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
  const emitted = [...stripped.matchAll(/failClass:\s*'([a-z_]+)'/g)].map(m => m[1])
  assert.ok(emitted.length > 20, `only ${emitted.length} failClass literals found; the scan broke`)
  assert.ok(emitted.includes('unreachable'), 'CONTROL: the scan cannot see `unreachable` either')
  assert.ok(!emitted.includes('buried'),
    'a skill now emits failClass "buried", which DOES vote — re-measure before shipping')
})

// --- the same claim, end to end, through the real loop ----------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwants-'))
const fresh = () => new Lessons(path.join(tmp, `l-${Math.random().toString(36).slice(2)}.json`))
const OAK = { block: 'oak_log', count: 1 }
const AT = { x: 0, y: 57, z: 0, offset: () => AT }

const loopBot = () => ({
  entity: { position: { ...AT }, velocity: { x: 0, y: 0, z: 0 } },
  health: 20, food: 20, oxygenLevel: 300,
  time: { day: 1, age: 1, timeOfDay: 1000 },
  game: { dimension: 'overworld' },
  inventory: { items: () => [] },
  registry: { blocksByName: { oak_log: { id: 17 } }, itemsByName: mcData.itemsByName,
              blocks: {}, items: {}, biomesArray: [], biomes: {} },
  recipesFor: () => [], recipesAll: () => [],
  findBlock: () => null, findBlocks: () => [],
  blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
  setControlState: () => {}, clearControlStates: () => {},
  players: {}, entities: {}, experience: { level: 0 },
})

/** One real decision whose skill fails with exactly what the fleet logs. */
const oneDecision = async (lessons, result, rung = null) => {
  const loop = new CognitiveLoop(loopBot(), { isBusy: () => false, run: async () => result },
                                 lessons, null)
  if (rung) { loop.milestones.chain = [rung]; loop.milestones.index = 0 }
  loop.llm = { decide: async () => ({
    schemaValid: true, latencyMs: 1,
    proposal: { skill: 'gather', args: OAK, reason: 'probe' },
  }) }
  loop.start()
  await new Promise(r => setTimeout(r, 150))
  loop.stop()
  return loop
}

// The exact string and class the live fleet writes, taken from skills.mjs.
const BURIED = { status: 'failed', failClass: 'unreachable',
                 detail: 'oak_log found but every candidate is buried — use mine to dig down' }
const NO_PATH = { status: 'failed', failClass: 'no_path',
                  detail: 'oak_log found but unreachable after 3 attempts' }

await ta('CONTROL: a no_path gather failure DOES reach the store', async () => {
  const L = fresh()
  await oneDecision(L, NO_PATH)
  assert.equal(L.failCount('gather', OAK), 1,
    'the loop recorded nothing at all — the control is broken, so the negative below proves nothing')
})

await ta('a BURIED gather failure moves the counter by zero', async () => {
  const L = fresh()
  for (let i = 0; i < 6; i++) await oneDecision(L, BURIED)
  assert.equal(L.failCount('gather', OAK), 0,
    'buried now accrues; the brief\'s premise has become true and this file is stale')
})

// ===========================================================================
// 2. THE DECISION, extracted and pure
// ===========================================================================
console.log('\n-- measuredItem: what does a rung\'s own progress line count? --')

t('the two rungs at issue: an item is counted', () => {
  assert.equal(measuredItem('6/48 oak_log', isItem), 'oak_log')
  assert.equal(measuredItem('12/40 cobblestone', isItem), 'cobblestone')
})

t('trailing prose does not hide the count', () => {
  // M.smelt and M.craft both render explanatory text AFTER the fraction. An
  // end-anchored match called BOTH of them violations and the two real ones
  // clean -- the inverted-assertion failure this repo has shipped before.
  assert.equal(measuredItem('0/1 iron_ingot (3 raw_iron to smelt)', isItem), 'iron_ingot')
  assert.equal(measuredItem('2/1 wooden_pickaxe (1 of them better)', isItem), 'wooden_pickaxe')
})

t('counting something that is not an item counts nothing', () => {
  assert.equal(measuredItem('45/80 blocks out', isItem), null)              // patrol
  assert.equal(measuredItem('4/16 deposits beyond 60m', isItem), null)      // survey
  assert.equal(measuredItem('4/6 beyond 100m (level 2)', isItem), null)     // survey_wider
  assert.equal(measuredItem('40 blocks from home', isItem), null)           // return
  assert.equal(measuredItem('7 bankable items carried', isItem), null)      // deposit_surplus
})

t('an instrument that cannot see reports nothing, not an absence', () => {
  // The default predicate says "nothing is an item". A caller with no registry
  // -- a bot mid-respawn, a test stub -- must not be handed a fabricated gap.
  assert.equal(measuredItem('6/48 oak_log'), null)
  assert.equal(measuredItem(null, isItem), null)
  assert.equal(measuredItem(undefined, isItem), null)
})

// ===========================================================================
// 3. THE INVARIANT, over every rung the fleet can actually be given
// ===========================================================================
console.log('\n-- every rung in every role chain declares what it counts --')

// A stub bot poor enough that no rung is complete, so every progress line
// renders its unfinished form.
const auditBot = {
  entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 400 } },
  inventory: { items: () => [] },
  // The REAL registry. The gate's arg check asks whether the block exists, and
  // a stub that answers "no" turns every gate question below into `bad_args` --
  // a rejection that has nothing to do with the thing under test.
  registry: { itemsByName: mcData.itemsByName, blocksByName: mcData.blocksByName,
              blocks: mcData.blocks, items: mcData.items },
  recipesFor: () => [], recipesAll: () => [],
  findBlock: () => null, findBlocks: () => [],
  blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
  players: {},
}
const render = m => {
  const p = m.progress(auditBot, 0, null, 0)
  return typeof p === 'string' ? p : String(p)
}

for (const role of Object.keys(MILESTONES_BY_ROLE)) {
  t(`role "${role}": no rung counts an item it does not declare`, () => {
    const chain = [...MILESTONES_BY_ROLE[role], ...SUSTAINING]
    assert.ok(chain.length > 5, `chain for ${role} is suspiciously short (${chain.length})`)
    // CONTROL: the audit can see a gap at all. Same call, one rung with its
    // `wants` knocked out, and it must be found.
    const planted = wantsGaps(
      chain.map(m => (m.id === 'stockpile_wood' ? { ...m, wants: null } : m)), render, isItem)
    assert.ok(planted.some(g => g.id === 'stockpile_wood'),
      'the audit cannot see a planted gap, so finding none below means nothing')
    const gaps = wantsGaps(chain, render, isItem)
    assert.deepEqual(gaps, [],
      `rungs counting an item they do not declare: ${JSON.stringify(gaps)}`)
  })
}

t('and the two rungs the endpoint is measured on declare the right thing', () => {
  const wood = SUSTAINING.find(m => m.id === 'stockpile_wood')
  const stone = SUSTAINING.find(m => m.id === 'stockpile_stone')
  assert.equal(wood?.wants, 'oak_log')
  assert.equal(stone?.wants, 'cobblestone')
})

// ===========================================================================
// 4. THE COMPOSED CHAIN
//    a failing gather -> what the counter does -> is the next attempt admissible
// ===========================================================================
console.log('\n-- the chain, not the guard --')

const woodRung = SUSTAINING.find(m => m.id === 'stockpile_wood')

/** The gate's answer for `gather oak_log` while `rung` is the active task. */
const askGate = (lessons, rung) => {
  const ctl = new MilestoneController(auditBot, 'gatherer', null, null)
  ctl.chain = [rung]; ctl.index = 0
  const wanted = ctl.status().wants ? new Set([ctl.status().wants]) : null
  const A = new AdmissionControl(lessons)
  return A.check({ skill: 'gather', args: OAK }, auditBot, wanted)
}

await ta('CHAIN: buried x6 leaves the action admissible, because nothing accrued', async () => {
  const L = fresh()
  for (let i = 0; i < 6; i++) await oneDecision(L, BURIED, woodRung)
  assert.equal(L.failCount('gather', OAK), 0, 'link 2 of the chain moved when it should not')
  assert.equal(askGate(L, woodRung).ok, true, 'link 3: an unaccrued rule blocked the action')
})

await ta('CHAIN: real evidence x6 DOES accrue past the threshold', async () => {
  const L = fresh()
  for (let i = 0; i < 6; i++) await oneDecision(L, NO_PATH, woodRung)
  assert.ok(L.failCount('gather', OAK) >= 4,
    `only ${L.failCount('gather', OAK)} accrued; the rest of this chain tests nothing`)
})

t('CHAIN: and the task that NAMES oak_log still gets its attempt', () => {
  // The live shape: a pooled rule far past any decay horizon. cited_fails on
  // real vetoes ran median 141, p90 728, max 3,670 -- at 3/hr forgiveness the
  // median needs 46 hours of total idleness on that key to fall below 4.
  const L = fresh()
  L.data.avoid['gather:{"block":"oak_log","count":1}'] =
    { skill: 'gather', args: OAK, fails: 141, classes: { no_path: 60, nothing_found: 81 },
      since: Date.now(), last: Date.now() }
  assert.equal(L.failCount('gather', OAK), 141, 'precondition: the rule is live')
  const r = askGate(L, woodRung)
  assert.equal(r.ok, true, 'the gate still refuses the block its own task names')
  assert.equal(r.kind, 'milestone_critical',
    `admitted, but not for this reason (${r.kind}) — a lucky probation slot is not the fix`)
})

t('CHAIN: the exemption stays narrow — an unrelated block is still blocked', () => {
  const L = fresh()
  L.data.avoid['gather:{"block":"sand","count":8}'] =
    { skill: 'gather', args: { block: 'sand', count: 8 }, fails: 141, classes: {},
      since: Date.now(), last: Date.now() }
  const ctl = new MilestoneController(auditBot, 'gatherer', null, null)
  ctl.chain = [woodRung]; ctl.index = 0
  const A = new AdmissionControl(L)
  const r = A.check({ skill: 'gather', args: { block: 'sand', count: 8 } }, auditBot,
                    new Set([ctl.status().wants]))
  assert.equal(r.ok, false, 'wood milestone now exempts gathering sand; the exemption is not narrow')
})

t('the tripwire fires when a rung loses its wants, once and only once', () => {
  // The report goes to logger.mjs, which a test cannot read back cleanly; the
  // once-per-id set IS the observable, and it is the half that matters -- a
  // tripwire firing 79,000 times a day is how the last one went unnoticed.
  const ctl = new MilestoneController(auditBot, 'gatherer', null, null)
  ctl.chain = [{ ...woodRung, wants: null }]; ctl.index = 0
  assert.equal(ctl.wantsWarned.size, 0, 'precondition: nothing reported yet')
  ctl.status(); ctl.status(); ctl.status()
  assert.equal(ctl.wantsWarned.size, 1, 'the tripwire did not fire, or fired per call')
  assert.ok(ctl.wantsWarned.has('stockpile_wood'))
})

t('...and stays quiet on a rung that is correct', () => {
  const ctl = new MilestoneController(auditBot, 'gatherer', null, null)
  ctl.chain = [woodRung]; ctl.index = 0
  ctl.status(); ctl.status()
  assert.equal(ctl.wantsWarned.size, 0,
    'the tripwire reports a gap on a rung that declares exactly what it counts')
})

// ===========================================================================
// 5. MUTANTS
// ===========================================================================
console.log('\n-- mutants --')

/**
 * Reuses the shape from climb-escape.test.mjs: assert the anchor is PRESENT and
 * UNIQUE before writing, and write the mutant into test/, never into src/ --
 * the runner SIGKILLs on timeout and an in-place mutant would survive on disk
 * and be deployed by the next fleet-recycle.
 */
async function withMutant (url, old, neu, fn) {
  const src = fs.readFileSync(url, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.equal(src.split(old).length, 2,
    `the mutation target appears ${src.split(old).length - 1} times; the mutant is ambiguous`)
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`,
                      import.meta.url)
  fs.writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}

await ta('MUTANT KILLED: without `wants`, stockpile_wood vetoes the block it asks for', async () => {
  await withMutant(MILESTONES_PATH,
    "    id: 'stockpile_wood',\n    wants: 'oak_log',",
    "    id: 'stockpile_wood',",
    async mod => {
      const rung = mod.SUSTAINING.find(m => m.id === 'stockpile_wood')
      assert.equal(rung.wants, undefined, 'the mutant did not remove the key')
      const L = fresh()
      L.data.avoid['gather:{"block":"oak_log","count":1}'] =
        { skill: 'gather', args: OAK, fails: 141, classes: {}, since: Date.now(), last: Date.now() }
      const ctl = new mod.MilestoneController(auditBot, 'gatherer', null, null)
      ctl.chain = [rung]; ctl.index = 0
      assert.equal(ctl.status().wants, null, 'the mutant still reports a want')
      const r = new AdmissionControl(L).check({ skill: 'gather', args: OAK }, auditBot, null)
      assert.equal(r.ok, false,
        'the mutant still admits the action, so the test above proves nothing')
      assert.equal(r.reason, 'learned_avoid')
      // And the audit must SEE it, or the tripwire is decoration.
      assert.ok(mod.wantsGaps([rung], render, isItem).some(g => g.id === 'stockpile_wood'),
        'the audit does not report the very gap this bug was')
    })
})

await ta('MUTANT KILLED: an end-anchored measuredItem inverts the audit', async () => {
  // The first draft of this regex was end-anchored. It reads `0/1 iron_ingot
  // (3 raw_iron to smelt)` as counting nothing, so the two rungs that DO
  // declare `wants` become the violations and the two that did not look clean.
  await withMutant(MILESTONES_PATH,
    "  const m = /(\\d+)\\s*\\/\\s*(\\d+)\\s+([a-z][a-z0-9_]*)/.exec(String(progress ?? ''))",
    "  const m = /(\\d+)\\s*\\/\\s*(\\d+)\\s+([a-z][a-z0-9_]*)$/.exec(String(progress ?? ''))",
    async mod => {
      assert.equal(mod.measuredItem('0/1 iron_ingot (3 raw_iron to smelt)', isItem), null,
        'the mutant is not reproducing the end-anchored defect')
      const chain = [...mod.MILESTONES_BY_ROLE.miner, ...mod.SUSTAINING]
      const gaps = mod.wantsGaps(chain, render, isItem)
      assert.ok(gaps.length > 0,
        'the audit passes under the inverted regex, so it is not testing the regex')
      assert.ok(gaps.some(g => g.declared && g.measured === null),
        'the mutant did not produce the inversion this test exists to catch')
    })
})

await ta('MUTANT KILLED: dropping the registry check mints "blocks" as a want', async () => {
  await withMutant(MILESTONES_PATH,
    '  return isItem(m[3]) ? m[3] : null',
    '  return m[3]',
    async mod => {
      assert.equal(mod.measuredItem('45/80 blocks out', isItem), 'blocks',
        'the mutant is not reproducing the unchecked-token defect')
      const gaps = mod.wantsGaps([...mod.SUSTAINING], render, isItem)
      assert.ok(gaps.some(g => g.id === 'patrol'),
        'the audit tolerates a fabricated item name, so the registry check is untested')
    })
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
