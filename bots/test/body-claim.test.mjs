// A SKILL DRIVING THE BODY BY HAND MUST BE ABLE TO SAY SO.
//
// 27 of 80 bots sat immobile underground with no pickaxe. Two interrupters,
// each sufficient on its own, were stopping the climb that would free them:
//
//  1. `withTimeout` unconditionally installed a watchdog that cancels any dig
//     where `!block.canHarvest(heldItem)`. On 1.21.8 `canHarvest(null)` returns
//     `null` for stone/deepslate/andesite/tuff -- and `undefined` when holding
//     a scaffold block, which is what the climb equips. Both falsy, so it fired
//     on the FIRST poll and killed every bare-handed climb dig at ~1000ms,
//     making digbudget.mjs's 15,000ms and 24,500ms budgets unreachable for the
//     exact case they were written for.
//
//  2. The entombment reflex saw a bot sealed in a one-block column of a skill's
//     making, called it entombed, tried its own pillar, had that refused for
//     want of blocks, and disturbed the body anyway -- observed as
//     `dig failed on stone: Digging aborted`.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Runner } from '../src/runner.mjs'
import { climbPrereqFor, canFinishClimb } from '../src/reflex.mjs'
const require_ = createRequire(import.meta.url)

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const strip = f => readFileSync(new URL(f, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

// --- 1. the dig policy ------------------------------------------------------

t('THE REGISTRY AGREES: a pickaxeless bot cannot "harvest" stone', () => {
  const mcData = require_('minecraft-data')('1.21.8')
  const Block = require_('prismarine-block')('1.21.8')
  const cob = mcData.itemsByName.cobblestone.id
  for (const n of ['stone', 'deepslate', 'andesite', 'tuff']) {
    const b = new Block(mcData.blocksByName[n].id, 0, 0)
    assert.ok(!b.canHarvest(null), `${n}: canHarvest(null) is truthy; re-read this test`)
    assert.ok(!b.canHarvest(cob), `${n}: canHarvest(cobblestone) is truthy; re-read this test`)
  }
  // and the contrast that proves the guard is not simply always-on
  const dirt = new Block(mcData.blocksByName.dirt.id, 0, 0)
  assert.ok(dirt.canHarvest(null), 'dirt should be harvestable bare-handed')
})

t('the harvest watchdog is ON by default — gather still wants the drop', () => {
  const code = strip('../src/skills.mjs')
  const m = code.match(/function withTimeout\([^)]*\{([^}]*)\}\s*=\s*\{\}\)/)
  assert.ok(m, 'withTimeout signature moved; re-read this test')
  assert.match(m[1], /needsDrop\s*=\s*true/, 'the default must stay true')
})

t('THE CLIMB OPTS OUT: it wants the hole, not the cobble', () => {
  const code = strip('../src/skills.mjs')
  const digs = code.match(/withTimeout\(bot\.dig\([^;]*?\}\)/gs) ?? []
  assert.equal(digs.length, 3, `expected 3 dig call sites, found ${digs.length}`)
  const optedOut = digs.filter(d => /needsDrop:\s*false/.test(d))
  assert.equal(optedOut.length, 2,
    'exactly the two escape digs (the climb and the floor-break) may opt out')
  // gather must NOT be one of them: it mines for the item
  const gatherDig = digs.find(d => /20_000/.test(d))
  assert.ok(gatherDig, "could not find gather's dig by its 20s budget")
  assert.ok(!/needsDrop:\s*false/.test(gatherDig),
    'gather opted out of the harvest guard — it mines for the DROP and would spin on unharvestable stone')
})

// --- 2. the body claim ------------------------------------------------------

const mkRunner = () => {
  const r = Object.create(Runner.prototype)
  r.current = { skill: 'surface' }
  r.generation = 1
  r.bodyClaim = null
  r.bot = { entity: { position: { y: 40 } } }
  return r
}

t('a claim is honoured only for its own type', () => {
  const r = mkRunner(); r.claimBody('climb')
  assert.ok(r.bodyClaimFor('climb'), 'the climb claim is not honoured')
  assert.equal(r.bodyClaimFor('swim'), null, 'a climb claim quieted a water reader')
})

t('AN IDLE RUNNER CANNOT CLAIM, and a finished skill cannot hold one', () => {
  const r = mkRunner(); r.current = null
  r.claimBody('climb')
  assert.equal(r.bodyClaimFor('climb'), null, 'an idle runner issued a live claim')
  const r2 = mkRunner(); r2.claimBody('climb')
  r2.current = null                       // the skill ended
  assert.equal(r2.bodyClaimFor('climb'), null, 'a claim outlived its skill')
  assert.equal(r2.bodyClaim, null, 'and it was not cleared')
})

t('a superseded run cannot hold the body', () => {
  const r = mkRunner(); r.claimBody('climb')
  r.generation = 2                        // hard stop, next skill started
  assert.equal(r.bodyClaimFor('climb'), null, 'a zombie run still owned the body')
})

t('A ZOMBIE CANNOT RENEW A NEWER CLAIM', () => {
  // The lifecycle attack that matters, and the one the first version of this
  // API was open to. After a hard stop the abandoned skill is still looping and
  // still holds its handle; when it calls renew, a type-only check would
  // refresh whatever claim the NEWER run had since installed, holding the
  // reflex off a bot the zombie has nothing to do with. Silently.
  // The protection is that renew CLOSES OVER its own claim object, so a
  // superseded handle can only ever refresh a record nothing reads any more.
  // A type-keyed `renewBody(what)` on the runner would not have this property:
  // it would look up whatever claim is current and refresh that one.
  const r = mkRunner()
  const zombie = r.claimBody('climb')
  const live = r.claimBody('climb')            // a newer run claims
  const liveClaim = r.bodyClaim
  liveClaim.at = Date.now() - (Runner.CLAIM_STEP_TTL_MS + 1)
  zombie.renew()                                // the abandoned skill's next step
  assert.equal(liveClaim.at, r.bodyClaim.at,
    'a superseded handle reached into the live claim')
  assert.equal(r.bodyClaimFor('climb'), null,
    'a superseded handle kept a stale claim alive')
  live.renew()                                  // the real owner still can
  assert.ok(r.bodyClaimFor('climb'), 'the live handle could not renew its own claim')
  assert.equal(typeof Runner.prototype.renewBody, 'undefined',
    'a type-keyed renewBody on the runner is exactly the hole the closure closes')
})

t('a zombie release cannot clear a newer claim', () => {
  // This is the exact bug in bot.waterTravel, whose clear is `= null`
  // unguarded: an abandoned skill unwinding minutes later nulls whatever a
  // newer skill has since installed.
  const r = mkRunner()
  const oldHandle = r.claimBody('climb')
  r.claimBody('climb')                    // a newer run claims
  const newer = r.bodyClaim
  oldHandle.release()                     // the old skill finally unwinds
  assert.strictEqual(r.bodyClaim, newer, 'a stale release cleared a live claim')
})

t('an un-renewed claim goes stale in one step, not one skill budget', () => {
  const r = mkRunner(); const h = r.claimBody('climb')
  r.bodyClaim.at = Date.now() - (Runner.CLAIM_STEP_TTL_MS + 1)
  assert.equal(r.bodyClaimFor('climb'), null, 'a stalled climb held the reflex off')
  assert.ok(r.bodyClaim, 'a stale claim must stay visible to telemetry, not be erased')
  h.renew()
  assert.ok(r.bodyClaimFor('climb'), 'renewal did not restore the claim')
})

t('the absolute ceiling is derived from the runner lifecycle, not chosen', () => {
  // NOT a raw ordering assertion. The repo's own runner (scripts/run-tests.mjs)
  // sets SKILL_TIMEOUT_MS=300 so the suite does not wait three minutes on one
  // test, which makes CLAIM_MAX_MS 600ms here. The first version of this test
  // asserted CLAIM_MAX_MS > CLAIM_STEP_TTL_MS, passed standalone, and turned
  // the suite red the moment it was run the way this repo runs tests.
  const PROD_TIMEOUT = 180_000, PROD_GRACE = 30_000
  assert.ok(PROD_TIMEOUT + PROD_GRACE > Runner.CLAIM_STEP_TTL_MS,
    'in production the ceiling must sit above the per-step TTL')
  const code = strip('../src/runner.mjs')
  assert.match(code, /CLAIM_MAX_MS\s*=\s*config\.skills\.defaultTimeoutMs\s*\+\s*HARD_STOP_GRACE_MS/,
    'the ceiling must be the sum, so it cannot drift when the timeout is retuned')
})

t('THERE IS NO UNTYPED READER: "is any skill running?" stays unaskable', () => {
  assert.equal(typeof Runner.prototype.hasClaim, 'undefined',
    'an untyped reader is the 7.5x-drownings question wearing a new hat')
  const reflex = strip('../src/reflex.mjs')
  const reads = reflex.match(/bodyClaim\w*/g) ?? []
  assert.ok(reads.length > 0, 'the reflex no longer consults the claim at all')
  for (const r of reads) {
    assert.equal(r, 'bodyClaimFor', `reflex.mjs touches ${r}; only bodyClaimFor('climb') is allowed`)
  }
  assert.match(reflex, /bodyClaimFor\?\.\('climb'\)/, "the reflex must ask for 'climb' specifically")
})

t('NO WATER PATH READS IT — checked globally, not in a window', () => {
  // The first version of this inspected a 1,600-character window around the
  // climb read. A `bodyClaimFor('swim')` inserted into the drowning branch 650
  // lines earlier passed it, along with every drowning and air test. Given this
  // project's 7.5x-drownings history, a guard named this that cannot see a
  // water path reading the claim is worse than no guard.
  const reflex = strip('../src/reflex.mjs')
  const calls = [...reflex.matchAll(/bodyClaimFor\??\.?\(\s*'([a-z_]+)'\s*\)/g)].map(m => m[1])
  assert.equal(calls.length, 1,
    `expected exactly one claim read in reflex.mjs, found ${calls.length}: ${calls}`)
  assert.equal(calls[0], 'climb', `the reflex reads a '${calls[0]}' claim; only 'climb' is allowed`)
  // and nothing may read it with a computed argument, which would dodge the above
  assert.ok(!/bodyClaimFor\??\.?\(\s*[^'\s)]/.test(reflex),
    'a claim is read with a non-literal argument, which this guard cannot check')
})

// --- 3. a refusal is not a failure -----------------------------------------

t('A REFUSAL ASKS FOR BLOCKS, NOT A PICKAXE, AND BACKS OFF', () => {
  // Not counting a refusal at all would leave the reflex retrying every 15s
  // forever and never telling the goal layer anything -- a livelock wearing a
  // fix's clothes. And the give-up branch it used to reach asks for a PICKAXE,
  // which is the wrong thing: what a refused climb is short of is BLOCKS.
  const code = strip('../src/reflex.mjs')
  const i = code.indexOf("climbed === 'needs_blocks'")
  assert.ok(i > 0, 'the refusal branch is gone')
  const branch = code.slice(i, i + 2600)
  assert.match(branch, /climbRefusals\+\+/, 'a refusal is not counted at all — it will spin')
  // Scoped to the REFUSAL ARM. Resetting on the success path is correct and
  // must stay; resetting inside the refusal arm is what makes the backoff flat,
  // so a permanently blocked bot would be interrupted at a fixed rate forever.
  const arm = branch.slice(0, branch.indexOf('else if ('))
  assert.ok(!/climbRefusals = 0/.test(arm),
    'the refusal arm resets its own counter, flattening the backoff')
  assert.match(arm, /climbRefusals \/ ESCAPE_GIVE_UP_AFTER/,
    'the backoff must escalate with the refusal count, not sit at a fixed delay')
  assert.match(branch, /pendingPrereq/, 'a refusal never tells the goal layer anything')
  assert.match(branch, /climbPrereqFor\(climbed\)/,
    'the ask must be derived from the reason the climb gave, not chosen at the call site')
  assert.match(branch, /lastEscapeAt = Date\.now\(\) \+/, 'a refusal must back off')
})

t('A REFUSED PILLAR IS NOT SCORED AS A FAILED ESCAPE — but an EXHAUSTED one is', () => {
  const code = strip('../src/reflex.mjs')
  assert.match(code, /let climbed = null[\s\S]{0,120}climbed = await pillarOut\(bot\)/,
    "pillarOut's answer is discarded again, so a refusal cannot be told from an attempt")
  // The invariant, not a character window: `escapeFailures++` must sit in the
  // ELSE-IF arm, so it is unreachable when the pillar declined to start.
  // Structural, not a character window: whatever sits between the refusal arm
  // opening and the else-if must not advance the counter.
  const start = code.indexOf("if (climbed === 'needs_blocks'")
  const elseIf = code.indexOf('else if (', start)
  assert.ok(start > 0 && elseIf > start, 'the refusal / escape-failure branches are gone')
  const refusalArm = code.slice(start, elseIf)
  assert.ok(!/escapeFailures\+\+/.test(refusalArm),
    'the refusal arm itself advances the give-up counter')
  const failureArm = code.slice(elseIf, code.indexOf('\n', code.indexOf('escapeFailures++', elseIf)))
  assert.match(failureArm, /position\.y - yBefore < 1/,
    'the failure arm no longer tests that the bot actually failed to rise')
  // 'exhausted' means the pillar ran out PARTWAY and left the bot worse off
  // than it started. That is an attempt that failed, not a decline to start,
  // and it must reach the failure arm.
  assert.ok(!/exhausted/.test(refusalArm),
    "'exhausted' is being treated as a refusal; it is a failed attempt")
  assert.match(code, /return 'exhausted'/, "pillarOut no longer names the exhausted case")
})

t('the entombment guard stands down for a climb', () => {
  const code = strip('../src/reflex.mjs')
  assert.match(code, /!escaping && !marooned && !climbing && isEntombed\(bot\)/,
    'the entombed branch still has no climb guard')
})

// --- the ask, tested behaviourally rather than by grepping the branch -------
//
// A source-grep version of this passed against a mutant that hardcoded
// `needsTool = false`: both `needs_pickaxe` and `wooden_pickaxe` still appeared
// in the text of the ternary. Fifth time today a grep test passed for the wrong
// reason in this repo, so the decision is now a pure function.

t('A TOOL-SHORT CLIMB ASKS FOR A TOOL', () => {
  const r = climbPrereqFor('needs_pickaxe')
  assert.ok(r, 'no prerequisite for a tool-short refusal')
  assert.ok(r.items.every(i => /_pickaxe$/.test(i)), `asked for ${r.items}`)
  assert.equal(r.count, 1)
})

t('A BLOCK-SHORT CLIMB ASKS FOR BLOCKS', () => {
  const r = climbPrereqFor('needs_blocks')
  assert.ok(r.items.includes('dirt') && r.items.includes('cobblestone'), `asked for ${r.items}`)
  assert.ok(!r.items.some(i => /_pickaxe$/.test(i)), 'a block-short climb was sent for a tool')
})

t('THE ASK MUST ACTUALLY SATISFY THE CLIMB — the closed livelock', () => {
  // canFinishClimb demands need + 1 + (headroomBlocked ? 1 : 0), and being
  // entombed implies a blocked ceiling. applyPrereq clears at have >= count, so
  // asking for less means the prerequisite is marked SATISFIED while the climb
  // still refuses -- the bot sits entombed forever holding exactly what it was
  // told to fetch, and the telemetry says the goal layer was asked.
  const { count } = climbPrereqFor('needs_blocks')
  assert.ok(canFinishClimb({ have: count, need: 24, headroomBlocked: true }),
    `asking for ${count} blocks does not satisfy a 24-block climb with a blocked ceiling`)
  assert.ok(!canFinishClimb({ have: count - 1, need: 24, headroomBlocked: true }),
    'the ask is more generous than it needs to be; tighten it or this test is vacuous')
})

t('an attempt that ran out partway asks for nothing — it is a failure, not a refusal', () => {
  assert.equal(climbPrereqFor('exhausted'), null)
  assert.equal(climbPrereqFor(undefined), null)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
