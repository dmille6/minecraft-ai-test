// A log inside its own canopy is covered, not buried -- and it is the LAST
// candidate tried, never a competitor to an open one.
//
// leaf-01 (2850cde) widened `isExposed` so a leaf face exposed a log, putting
// these blocks straight into the main candidate list. It read **logs acquired
// -0.65 DiD** on board-a+board-c over 180 min and was reverted by its own gate,
// with 209 gather runs of exposure -- it fired, and made the fleet worse. The
// reach probe keeps the nearest FOUR candidates and its goal tests DISTANCE
// ONLY, so covered logs at 2/3/4/5 blocks filled the slate and the hit was
// promoted ahead of a genuinely open log further away.
//
// So the admission rule below is byte-for-byte leaf-01's, and rank is the only
// variable. These tests exist to hold that line.
import assert from 'node:assert/strict'
import test from 'node:test'
import { isExposed, foliageCovered, coverFallback, barrenFailClass,
         BREAKABLE_COVER, COVER_EXEMPT_TARGET } from '../src/skills.mjs'

const P = (x, y, z) => ({ x, y, z, offset: (a, b, c) => P(x + a, y + b, z + c) })
const key = p => `${p.x},${p.y},${p.z}`
// `world` maps a coordinate to a block name; anything unnamed is solid stone.
// The block AT the origin is the target and is named separately.
function botAt (targetName, world, { missing = null } = {}) {
  return {
    blockAt (p) {
      if (p.x === 0 && p.y === 0 && p.z === 0) {
        return targetName === null ? missing : { name: targetName, boundingBox: 'block' }
      }
      const n = world[key(p)]
      if (n === undefined) return { name: 'stone', boundingBox: 'block' }
      if (n === null) return missing
      const empty = n === 'air' || n === 'cave_air' || n === 'water'
      return { name: n, boundingBox: empty ? 'empty' : 'block' }
    },
  }
}
const at = P(0, 0, 0)
const N = { up: '0,1,0', down: '0,-1,0', east: '1,0,0', west: '-1,0,0', south: '0,0,1', north: '0,0,-1' }
const ALL_LEAVES = Object.fromEntries(Object.values(N).map(k => [k, 'oak_leaves']))

// ---------------------------------------------------------------- admission

test('THE BUG: a log sealed inside its own canopy is covered, not buried', () => {
  const bot = botAt('oak_log', ALL_LEAVES)
  assert.equal(isExposed(bot, at), false, 'isExposed must still call it buried -- it is unchanged')
  assert.equal(foliageCovered(bot, at), true)
})

test('THE leaf-01 REGRESSION: a log with an open face is NOT routed through the fallback', () => {
  // Conjunctive with !isExposed on purpose. A block with a real air face is
  // already a normal candidate; admitting it here too would let the fallback
  // compete with the list it exists to back up.
  const bot = botAt('oak_log', { ...ALL_LEAVES, [N.east]: 'air' })
  assert.equal(isExposed(bot, at), true)
  assert.equal(foliageCovered(bot, at), false)
})

test('a log encased in stone stays buried -- that refusal is correct', () => {
  assert.equal(foliageCovered(botAt('oak_log', {}), at), false)
})

test('one leaf face among five stone faces counts, and that scope is deliberate', () => {
  // The pathfinder equips and breaks obstructing blocks en route, and every leaf
  // type is hardness 0.2 with no tool requirement. Broader than the motivating
  // case, unchanged from leaf-01 so that rank is the only variable.
  assert.equal(foliageCovered(botAt('oak_log', { [N.north]: 'birch_leaves' }), at), true)
})

test('every leaf variant counts, not just oak', () => {
  for (const leaf of ['oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
                      'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves',
                      'azalea_leaves', 'flowering_azalea_leaves', 'pale_oak_leaves']) {
    assert.equal(foliageCovered(botAt('oak_log', { [N.up]: leaf }), at), true, leaf)
  }
})

test('LOGS ONLY: leaf-covered dirt is not admitted, because widening it broke gather dirt', () => {
  // One leaf-adjacent DIRT block made reachable.length !== 0, switching off the
  // alternative-source search that finds an accessible grass_block -- a verified
  // regression that turned a working gather into a failure.
  for (const t of ['dirt', 'grass_block', 'stone', 'sand', 'iron_ore', 'oak_leaves']) {
    assert.equal(foliageCovered(botAt(t, ALL_LEAVES), at), false, t)
  }
})

test('every log variant is a valid target', () => {
  for (const t of ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log',
                   'dark_oak_log', 'mangrove_log', 'cherry_log', 'pale_oak_log']) {
    assert.equal(foliageCovered(botAt(t, ALL_LEAVES), at), true, t)
  }
})

test('the target rule is anchored: oak_wood and a bare "logs" are out, stripped logs are in', () => {
  // Anchoring matters: a surviving mutant once showed nothing distinguished
  // /_log$/ from /log/. `oak_wood` and `logs` must not match.
  assert.equal(COVER_EXEMPT_TARGET.test('oak_wood'), false)
  assert.equal(COVER_EXEMPT_TARGET.test('logs'), false)
  assert.equal(COVER_EXEMPT_TARGET.test('stripped_oak_log'), true, 'stripped logs ARE logs')
  assert.equal(BREAKABLE_COVER.test('leaves_something'), false)
  assert.equal(BREAKABLE_COVER.test('oak_leaves'), true)
})

test('an unreadable target or neighbour refuses rather than throwing', () => {
  assert.equal(foliageCovered(botAt(null, ALL_LEAVES), at), false)
  assert.equal(foliageCovered(botAt('oak_log', { [N.up]: null }), at), false,
    'a null neighbour is not air here: blockAt returning null already makes isExposed true')
})

// ------------------------------------------------------------------- rank

const openLog = P(9, 0, 9)
const covered = [P(1, 0, 0), P(2, 0, 0)]
// P carries an `offset` closure, so deepEqual on two separately-built P's
// compares functions and fails for a reason that has nothing to do with rank.
const coords = a => (a ?? []).map(q => `${q.x},${q.y},${q.z}`)

test('THE WHOLE POINT: a covered log never enters while ANY open candidate survives', () => {
  assert.equal(coverFallback([openLog], covered), null)
  assert.equal(coverFallback([openLog, P(3, 0, 3)], covered), null)
})

test('it enters only when the primary list is empty', () => {
  assert.deepEqual(coords(coverFallback([], covered)), coords(covered))
})

test('an empty covered set is null, not an empty slate -- the caller must not log a fire', () => {
  assert.equal(coverFallback([], []), null)
  assert.equal(coverFallback([], null), null)
})

test('A BANKED LOG IS NOT GAMBLED: a partial success blocks the fallback', () => {
  // The fallback sits ABOVE `if (collected > 0) return success` in gather.
  // Without this guard, a run that had already banked a log went on to try a
  // covered one; when that attempt threw, `collected = gained` overwrote the
  // banked count with 0 and the run returned FAILED. Found by Codex pass 1 by
  // executing gather, not by reading it.
  assert.equal(coverFallback([], covered, { collected: 1 }), null)
  assert.equal(coverFallback([], covered, { collected: 12 }), null)
  assert.deepEqual(coords(coverFallback([], covered, { collected: 0 })), coords(covered))
})

test('MUTANT KILLED: without the collected guard a banked log is put back at risk', async () => {
  await withMutant(SKILLS_PATH,
    "  if (collected > 0) return null\n",
    "",
    async mod => {
      assert.deepEqual(coords(mod.coverFallback([], covered, { collected: 3 })), coords(covered),
        'the mutant did not remove the partial-success guard')
    })
})

test('a missing primary list refuses rather than defaulting to "empty"', () => {
  // Defaulting the other way would make a caller bug read as "nothing was
  // reachable", which is exactly the displacement this file exists to prevent.
  assert.equal(coverFallback(null, covered), null)
  assert.equal(coverFallback(undefined, covered), null)
})

test('within the fallback, a log the bot can stand beside outranks one it cannot', () => {
  const near = P(1, 0, 0), far = P(2, 0, 0)
  const approachable = q => q.x === 2
  assert.deepEqual(coords(coverFallback([], [near, far], { approachable })), coords([far, near]))
})

test('with no approachable test, order is preserved', () => {
  assert.deepEqual(coords(coverFallback([], [P(1, 0, 0), P(2, 0, 0)])), ['1,0,0', '2,0,0'])
})

// ----------------------------------------------------------------- mutants
// A source test that has never been seen to fail is not a test. Each mutant
// asserts its anchor is present AND unique before it is applied -- a mutation
// that silently fails to apply reads as "killed".
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

test('MUTANT KILLED: dropping the emptiness guard makes the helper displace (gather has its own guard too)', async () => {
  // Codex pass 1 correction: this kills the guard IN THE HELPER only. gather's
  // own `reachable.length === 0` would still stop the call, so this does not by
  // itself rebuild leaf-01 -- it proves the helper is not vacuous, which is
  // what a pure function can be asked. The structural test below covers the
  // call site, which behaviour cannot reach without driving the whole loop.
  await withMutant(SKILLS_PATH,
    "  if (!Array.isArray(primary) || primary.length !== 0) return null",
    "  if (!Array.isArray(primary)) return null",
    async mod => {
      assert.deepEqual(coords(mod.coverFallback([openLog], covered)), coords(covered),
        'the mutant is not reproducing the -0.65 DiD defect, so the test above proves nothing')
    })
})

test('MUTANT KILLED: /log/ unanchored admits a bare "logs" name', async () => {
  // Codex pass 1 correction: /log/ does NOT match oak_wood, so the earlier name
  // for this mutant was false. `logs` is what actually discriminates.
  await withMutant(SKILLS_PATH,
    "export const COVER_EXEMPT_TARGET = /_log$/",
    "export const COVER_EXEMPT_TARGET = /log/",
    async mod => {
      assert.equal(mod.foliageCovered(botAt('logs', ALL_LEAVES), at), true,
        'the mutant did not widen the target rule')
    })
})

test('MUTANT KILLED: without !isExposed the PREDICATE admits an open-faced log', async () => {
  // Also narrowed after pass 1: a safe open candidate already blocks the
  // fallback in gather, so the competition claim was stronger than the mutant.
  await withMutant(SKILLS_PATH,
    "  if (isExposed(bot, p)) return false\n",
    "",
    async mod => {
      assert.equal(mod.foliageCovered(botAt('oak_log', { ...ALL_LEAVES, [N.east]: 'air' }), at), true,
        'the mutant did not remove the conjunctive guard')
    })
})

test('MUTANT KILLED: widening the cover rule makes stone a way in', async () => {
  await withMutant(SKILLS_PATH,
    "export const BREAKABLE_COVER = /_leaves$/",
    "export const BREAKABLE_COVER = /./",
    async mod => {
      assert.equal(mod.foliageCovered(botAt('oak_log', {}), at), true,
        'the mutant did not widen the cover rule -- a stone-encased log must stay buried in the real one')
    })
})

test('the call site passes the LIVE candidate list as the primary -- not [] -- and isExposed is untouched', () => {
  // Structural, because behaviour cannot reach it without driving the whole
  // gather loop. Comments are stripped first: this codebase's comments quote
  // the code they explain, so a naive grep matches the explanation.
  const src = readFileSync(SKILLS_PATH, 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.ok(src.includes('coverFallback(\n        reachable, positions.filter'),
    'the fallback must be handed the live reachable list; handing it [] would fire it always')
  assert.ok(src.includes('if (reachable.length === 0 && collected === 0) {'),
    'the call site must not even scan positions once a log is banked')
  assert.equal(src.split('isExposed (bot, p) {')[1].split('}')[0].includes('_leaves'), false,
    'isExposed must stay unwidened -- leaf-01 widened it and read -0.65 DiD')
})


// --------------------------------------------------- what a barren run teaches

test('A SPECULATIVE LAST RESORT MUST NOT TEACH: cover rounds downgrade no_path', () => {
  // `no_path` is in cognitive.mjs's EVIDENCE_ABOUT_THE_ACTION, so it calls
  // lessons.recordFailure and becomes a PERSISTENT avoid rule against
  // `gather oak_log`. `unreachable` is in none of those sets. Codex pass 2
  // executed the loop: three covered logs and a collect that returns nothing
  // gave HEAD one `unreachable` and the patched build three attempts and a
  // `no_path`. That is how a fallback poisons the tech tree.
  assert.equal(barrenFailClass(0, 3, 0), 'no_path', 'an ordinary barren run is unchanged')
  assert.equal(barrenFailClass(0, 3, 1), 'unreachable')
  assert.equal(barrenFailClass(0, 3, 3), 'unreachable')
})

test('a timeout is still a timeout, cover or not -- that class was never the danger', () => {
  assert.equal(barrenFailClass(3, 3, 0), 'collect_budget')
  assert.equal(barrenFailClass(3, 3, 2), 'collect_budget')
  assert.equal(barrenFailClass(4, 3, 0), 'collect_budget')
})

test('ONE cover round is enough to downgrade, because barren cannot be attributed', () => {
  // Deliberately not "all rounds were cover". The barren counter does not say
  // which candidate was barren, and this file's standing mistake is deriving a
  // durable claim from a failure nobody could classify.
  assert.equal(barrenFailClass(0, 9, 1), 'unreachable')
})

test('MUTANT KILLED: leaving no_path in place for cover rounds re-arms the avoid rule', async () => {
  await withMutant(SKILLS_PATH,
    "  return coverRounds > 0 ? 'unreachable' : 'no_path'",
    "  return 'no_path'",
    async mod => {
      assert.equal(mod.barrenFailClass(0, 3, 3), 'no_path',
        'the mutant did not restore the persistent class')
    })
})

test('the outcome row is actually wired, and on both exits', () => {
  // Codex pass 2 found every test passing with the emission disabled
  // (`if (false && viaCover > 0)`). Structural, because behaviour cannot reach
  // it without driving the loop; comments stripped first because this
  // codebase's comments quote the code they explain.
  const src = readFileSync(SKILLS_PATH, 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.equal(src.split("kind: 'gather_cover_outcome'").length - 1, 2,
    'the outcome row must be emitted at the accounting AND at the all-excluded return')
  assert.ok(src.includes('if (viaCover > 0) {'),
    'the outcome row must be guarded on the fallback having fired')
  assert.equal(src.split('coverRounds++').length - 1, 1,
    'the run-scoped counter must be incremented exactly where the fallback fires')
  assert.ok(src.includes('barrenFailClass(timedOut, barren, coverRounds)'),
    'the barren return must ask barrenFailClass rather than re-deriving the class')
})
