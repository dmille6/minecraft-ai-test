// THE EVIDENCE GATE: no conclusion without the observation that supports it.
//
// Twelve defects found in one session were all the same defect wearing
// different clothes -- an operation reporting a conclusion its evidence did not
// reach:
//
//   a search that hit OUR 25s budget      reported "no route exists"    393x
//   an absent log line                    reported "still on the old code"
//   a 1s probe on a 105-block climb       reported "stranded"
//   `mine {"y":71}` from y=68             reported "reached y=68", recorded
//                                         as a success, clearing the avoid rule
//                                         that was the only thing capable of
//                                         breaking the loop (4 of 6 bots)
//   placeBlock returning without throwing reported a block placed
//
// Every one of them was a policy that lived in one branch of one function and
// could therefore be undone by editing that function. This file is the
// structural half: it asserts the invariants over the SOURCE and over the
// runner, so the next person to reintroduce one has to delete an assertion
// rather than merely forget a rule.
//
// scripts/preflight.sh globs bots/test/*.test.mjs, so this runs before deploy.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The runner writes a skill record per call, so give it somewhere disposable to
// write before anything reads config.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-gate-'))
process.env.LOG_DIR = path.join(TMP, 'logs')
process.env.STATE_DIR = path.join(TMP, 'state')
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error'

const { SKILLS, SKILL_CONTRACTS, UNKNOWN_FAIL_CLASSES, statusFor, classifyOutcome } =
  await import('../src/skills.mjs')
const { EVIDENCE_ABOUT_THE_ACTION, EVIDENCE_ONLY_IF_STUCK, EVIDENCE_ONLY_IF_HERE,
        evidenceScope } = await import('../src/cognitive.mjs')
// Every evidence set, enumerated once. The guard below was written when
// there were two and kept passing after a third was added -- a window too
// narrow to see the thing it forbade.
const EVIDENCE_SETS = { action: EVIDENCE_ABOUT_THE_ACTION, situation: EVIDENCE_ONLY_IF_STUCK,
                        place: EVIDENCE_ONLY_IF_HERE }
const { Lessons } = await import('../src/lessons.mjs')
const { Runner } = await import('../src/runner.mjs')

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// ---------------------------------------------------------------------------
// 1. EVERY FAILED RETURN NAMES ITS CLASS
//
// A source scan, and that is the point. The alternative -- calling every skill
// and inspecting the result -- cannot reach a branch that needs a bot wedged in
// a canopy at y=-42, which is exactly where the unclassified returns hid.
//
// Until this ran, `classifyFailure(result.detail)` in the runner recovered the
// class by regexing the prose the skill had just written, so wording and
// taxonomy were two encodings of one idea that drifted the moment either
// changed. "pathfinding exceeded 25000ms" matched the classifier's "no path"
// rule; a fifth of all failures were filed under a cause the pathfinder had
// never reported.
// ---------------------------------------------------------------------------

/**
 * Object literals that are RETURNED with a failed/unknown status.
 *
 * Deliberately not a bare grep for `status: 'failed'`: skills.mjs also builds
 * logEvent({ kind: 'trapped_in_canopy', status: 'failed', ... }) documents,
 * which are telemetry rows and not skill results. The discriminator is what
 * precedes the opening brace -- `return`, or the `?`/`:` of a returned ternary.
 */
function returnedOutcomes(src) {
  const out = []
  for (const m of src.matchAll(/status:\s*'(failed|unknown)'/g)) {
    let depth = 0, j = m.index
    while (j >= 0) {
      if (src[j] === '}') depth++
      else if (src[j] === '{') { if (depth === 0) break; depth-- }
      j--
    }
    const before = src.slice(Math.max(0, j - 40), j).trimEnd()
    if (!/(\breturn\b|\?|:|=>)$/.test(before)) continue     // logEvent(...) and friends
    depth = 0
    let k = m.index + m[0].length
    while (k < src.length) {
      if (src[k] === '{') depth++
      else if (src[k] === '}') { if (depth === 0) break; depth-- }
      k++
    }
    out.push({ status: m[1], body: src.slice(j, k + 1), line: src.slice(0, m.index).split('\n').length })
  }
  return out
}

await t('every failed/unknown return in skills.mjs carries a failClass', () => {
  const src = read('skills.mjs')
  const found = returnedOutcomes(src)
  assert.ok(found.length > 30, `the scan found only ${found.length} returns; it has stopped working`)
  const naked = found.filter(o => !/failClass/.test(o.body))
  assert.equal(naked.length, 0,
    'these returns leave their cause to be guessed from prose:\n' +
    naked.map(o => `        skills.mjs:${o.line}  ${o.body.replace(/\s+/g, ' ').slice(0, 90)}`).join('\n'))
})

await t('the scan would actually catch a naked return', () => {
  // A test that cannot fail is not a test. This is the shape the scan exists to
  // reject, and the shape it must NOT reject (a logEvent row) alongside it.
  const bad = "  return { status: 'failed', detail: 'something went wrong' }"
  assert.equal(returnedOutcomes(bad).length, 1)
  assert.ok(!/failClass/.test(returnedOutcomes(bad)[0].body))
  const telemetry = "  logEvent({ kind: 'trapped_in_canopy', status: 'failed', detail: 'x' })"
  assert.equal(returnedOutcomes(telemetry).length, 0, 'a logEvent row is not a skill result')
})

// ---------------------------------------------------------------------------
// 2. THE PROSE CLASSIFIER IS OFF THE LIVE WRITE PATH
//
// classifyFailure stays in state.mjs and stays tested (failclass*.test.mjs),
// because reclassifying the 16h of history already in Elasticsearch the same
// way the live fleet does is the one job it is honest at. What it may never do
// again is mint a class for a record being written now.
// ---------------------------------------------------------------------------

await t('runner.mjs and cognitive.mjs do not import classifyFailure', () => {
  for (const f of ['runner.mjs', 'cognitive.mjs']) {
    const importLines = read(f).split('\n').filter(l => /^import\b/.test(l.trim()) ||
                                                        /^\s+\w+.*from '\.\//.test(l))
    assert.ok(!importLines.some(l => l.includes('classifyFailure')),
      `${f} imports classifyFailure; a regex over a sentence is not an observation`)
  }
})

await t('nothing on the write path calls classifyFailure', () => {
  for (const f of ['runner.mjs', 'cognitive.mjs', 'skills.mjs', 'reflex.mjs', 'watchdog.mjs']) {
    const calls = read(f).split('\n')
      .filter(l => /classifyFailure\s*\(/.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    assert.deepEqual(calls, [], `${f} still calls it: ${calls.join(' | ')}`)
  }
})

// ---------------------------------------------------------------------------
// 3. `unknown` IS NEVER EVIDENCE
// ---------------------------------------------------------------------------

await t('no unknown class is also an evidence class', () => {
  for (const fc of UNKNOWN_FAIL_CLASSES) {
    for (const [name, set] of Object.entries(EVIDENCE_SETS)) {
      assert.ok(!set.has(fc),
        `${fc} names a budget we set, not something the world said -- it is in the ${name} set`)
    }
    assert.equal(evidenceScope(fc), null,
      `${fc} is unknowable, so it must get a vote in no store at all`)
  }
})

await t('statusFor separates the searches we finished from the ones we cut short', () => {
  // The pathfinder itself makes this distinction (lib/goto.js: NoPath vs
  // Timeout) and our code collapsed it for 16 hours.
  assert.equal(statusFor('no_path'), 'failed', 'A* exhausted the space: a real no')
  assert.equal(statusFor('path_timeout'), 'unknown', 'thinkTimeout expired mid-search')
  assert.equal(statusFor('path_budget'), 'unknown', 'our own 25s wall clock')
  assert.equal(statusFor('collect_budget'), 'unknown', 'our own 40s harvest clock')
  assert.equal(statusFor('nothing_found'), 'failed', 'we looked and it is not there')
})

await t('the cognitive layer routes unknown away from the lessons store', () => {
  // Structural: the branch exists, and it records nothing. Reading the source is
  // the only way to assert "this code path does NOT call X" without a live bot.
  const src = read('cognitive.mjs')
  const i = src.indexOf("if (r.status === 'unknown')")
  assert.ok(i > 0, 'the unknown branch has been removed from the cognitive loop')
  const branch = src.slice(i, src.indexOf("} else if (r.status === 'failed')", i))
  assert.ok(!/lessons\.record/.test(branch),
    'an unknown must not write a lesson, neither a success nor an avoid rule')
})

// ---------------------------------------------------------------------------
// 4. recordSuccess() CANNOT BE CALLED WITHOUT A MEASUREMENT
//
// Not "is detected afterwards" -- the cognitive layer already detected the mine
// livelock, logged "skill returned cleanly but changed nothing", and called
// recordSuccess() on the next line anyway.
// ---------------------------------------------------------------------------

const freshLessons = name => new Lessons(path.join(TMP, `lessons-${name}.json`))

await t('a win with no evidence is refused', () => {
  const L = freshLessons('noevidence')
  for (const nothing of [undefined, null, [], {}, '', 0]) {
    assert.throws(() => L.recordSuccess('mine', { y: 71 }, nothing), /must carry the observation/,
      `recordSuccess accepted ${JSON.stringify(nothing ?? null)} as proof of a win`)
  }
  assert.equal(Object.keys(L.data.worked).length, 0, 'a refused win must not be half-written')
})

await t('the shape of evidence is not evidence', () => {
  const L = freshLessons('shape')
  // `delta.informed` was a boolean the runner set to `skillName === 'status'`:
  // true by construction, so every status call met its contract and the fleet
  // recorded 115 wins for reporting its own position.
  assert.throws(() => L.recordSuccess('status', {}, { informed: true }), /must carry the observation/)
  assert.throws(() => L.recordSuccess('goto', { x: 1 }, { distance_moved: 0 }), /must carry the observation/,
    'zero blocks moved is a measurement that nothing happened')
})

await t('a measured win is recorded, and remembers what measured it', () => {
  const L = freshLessons('measured')
  L.recordSuccess('gather', { block: 'oak_log' }, ['inventory_gain: oak_log +3'])
  L.recordSuccess('goto', { x: 10, y: 64, z: 10 }, { distance_moved: 41 })
  const gathered = Object.values(L.data.worked).find(e => e.skill === 'gather')
  assert.equal(gathered.wins, 1)
  assert.match(gathered.why, /oak_log \+3/, 'a stored win must be auditable back to a number')
  assert.match(Object.values(L.data.worked).find(e => e.skill === 'goto').why, /distance_moved: 41/)
})

await t('success is still disproof of an avoid rule', () => {
  // The disproof channel must stay at least as wide as the accrual channel --
  // requiring evidence must not quietly turn the store back into a ratchet.
  const L = freshLessons('disproof')
  const a = { item: 'stick' }
  for (let i = 0; i < 3; i++) L.recordFailure('craft', a, 'missing_ingredients', null, 'oak_planks')
  const before = L.entryFor('craft', a).fails
  L.recordSuccess('craft', a, ['inventory_gain: stick +4'])
  assert.ok((L.entryFor('craft', a)?.fails ?? 0) < before,
    'a success that does not weaken the rule is not disproof')
})

await t('every callable skill declares a contract', () => {
  // A skill with no contract has `expects: []`, which no observation can
  // satisfy -- so it would be downgraded to unknown forever, silently.
  for (const name of Object.keys(SKILLS)) {
    assert.ok(SKILL_CONTRACTS[name], `${name} has no entry in SKILL_CONTRACTS`)
  }
})

// ---------------------------------------------------------------------------
// 5. THE RUNNER DOWNGRADES A SUCCESS WITH NOTHING BEHIND IT
//
// Scout02's exact circuit, every 70 seconds:
//     LLM -> mine args={"y":71}   (the bot is at y=68; mine only descends)
//     skill mine -> success detail=reached y=68
//     skill returned cleanly but changed nothing      <- noticed
//     ...recordSuccess()                              <- recorded anyway
// ---------------------------------------------------------------------------

const V = (x, y, z) => ({
  x, y, z,
  offset: (a, b, c) => V(x + a, y + b, z + c),
  distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
  clone: () => V(x, y, z),
})

function runnerBot({ pos = V(500, 68, 500), inventory = [] } = {}) {
  return {
    entity: { position: pos }, health: 20, food: 20, entities: {},
    inventory: { items: () => inventory },
    registry: { blocksByName: {}, itemsByName: {}, items: {}, blocks: {} },
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    findBlock: () => null,
    pathfinder: { setGoal() {} },
    chat() {},
  }
}

/** Swap a real skill's body, so the contract under test is the real one. */
async function withSkill(name, impl, fn) {
  const original = SKILLS[name].run
  SKILLS[name].run = impl
  try { return await fn() } finally { SKILLS[name].run = original }
}

await t('a success that changed nothing becomes unknown, not success', async () => {
  const bot = runnerBot()
  const r = await withSkill('mine', async () => ({ status: 'success', detail: 'reached y=68' }),
    () => new Runner(bot).run('mine', { y: 71 }))
  assert.equal(r.status, 'unknown',
    'mine expects inventory_gain|position; the bot moved 0 blocks and gained nothing')
  assert.equal(r.failClass, 'no_measurable_change')
  assert.deepEqual(r.contractEvidence, [], 'there was nothing to carry')
})

await t('the downgrade is to unknown, never to failed', async () => {
  // We know nothing happened. We do NOT know the action is impossible, and
  // `failed` is the claim that reaches the lessons store.
  const bot = runnerBot()
  const r = await withSkill('gather', async () => ({ status: 'success', detail: 'collected 3 oak_log' }),
    () => new Runner(bot).run('gather', { block: 'oak_log', count: 3 }))
  assert.equal(r.status, 'unknown')
  assert.notEqual(r.status, 'failed')
})

await t('a real success passes through with its evidence attached', async () => {
  const inv = []
  const bot = runnerBot({ inventory: inv })
  const r = await withSkill('gather', async () => { inv.push({ name: 'oak_log', count: 3 }); return { status: 'success', detail: 'collected 3 oak_log' } },
    () => new Runner(bot).run('gather', { block: 'oak_log', count: 3 }))
  assert.equal(r.status, 'success')
  assert.ok(r.contractEvidence.length, 'a success must arrive carrying what earned it')
  assert.match(r.contractEvidence.join(';'), /oak_log \+3/)
})

await t('the milestone cannot turn a real harvest into an unknown', async () => {
  // The runner asks the CONTRACT question against a null wanted-set. Asking the
  // milestone question here would mean gathering the right thing one step early
  // scored as "nothing happened", which is the ratchet the disproof channel
  // exists to prevent.
  const { because } = classifyOutcome('gather', 'success', { inventory: { dirt: 8 } }, null)
  assert.ok(because.length, 'off-milestone work still met the contract')
})

await t('a downgraded no-op counts toward the consecutive-failure pause', async () => {
  // Transient throttles treat a don't-know like a no; only the persistent
  // lessons store ignores it. A no-op that RESET the failure streak is how a
  // livelock hides from every guard at once.
  const bot = runnerBot()
  const runner = new Runner(bot)
  await withSkill('mine', async () => ({ status: 'success', detail: 'reached y=68' }), async () => {
    await runner.run('mine', { y: 71 })
    await runner.run('mine', { y: 71 })
  })
  assert.equal(runner.consecutiveFailures, 2,
    'two calls that achieved nothing must not read as two clean successes')
})

await t('a skill that throws still hands back a class', async () => {
  const bot = runnerBot()
  const r = await withSkill('craft', async () => { throw new Error('kaboom') },
    () => new Runner(bot).run('craft', { item: 'stick' }))
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'skill_error', 'an exception is a bug in us, not a fact about the world')
})

await t('an escaped budget expiry is unknown, not failed', async () => {
  const bot = runnerBot()
  const r = await withSkill('goto', async () => {
    throw Object.assign(new Error('pathfinding exceeded 25000ms'),
                        { failClass: 'path_budget', budgetExceeded: true })
  }, () => new Runner(bot).run('goto', { x: 1, y: 64, z: 1 }))
  assert.equal(r.status, 'unknown', 'our wall clock expiring says nothing about the route')
  assert.equal(r.failClass, 'path_budget')
})

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
