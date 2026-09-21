// ASK FOR WHAT THE SCOREBOARD ACCEPTS.
//
// Three role ladders named `oak_log` while the counter beside them (woodUnits ->
// countAny(b, LOGS)) and the stockpile hint had already been widened to any log.
// The file's own comment records that bots "were then sent to gather more oak
// specifically". The fix was half-applied: scoreboard and hint took any log, the
// GOAL still said oak.
//
// Measured 2026-09-21, 12 h / 414,145 rows, selection controlled by restricting
// to runs where the SAME bot had seen both species in one affordance scan within
// 180 s: oak 13.9% success over 3,302 runs, birch 38.6% over 132. 2.8x, and the
// fleet still asked oak 25:1.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import * as MS from '../src/milestones.mjs'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const bot = inv => ({ inventory: { items: () => Object.entries(inv)
  .map(([name, count]) => ({ name, count })) } })

// THE REGRESSION TEST FOR THE CRASH I CAUSED WRITING THIS.
// The role ladders are evaluated at MODULE LOAD and now reference LOGS. With the
// declaration still further down the file, importing this module threw
// `Cannot access 'LOGS' before initialization` -- every bot would have failed to
// start. A const is hoisted into the temporal dead zone, not initialised, so it
// fails at IMPORT, which is why a behaviour test that never imports cleanly would
// not have caught it.
await ta('the module IMPORTS -- no temporal dead zone in the role ladders', async () => {
  const m = await import('../src/milestones.mjs')
  assert.ok(m, 'milestones.mjs failed to import')
  assert.ok(typeof m === 'object')
})

// MILESTONES_BY_ROLE is exported, so these are BEHAVIOUR tests on the real ladder
// objects. The first draft guarded on `MS.ROLES ?? null` and printed "not
// exported" -- two tests that passed without running their assertions, which is
// the shape this repo has scored as "killed" before.
const ladder = MS.MILESTONES_BY_ROLE
t('the ladder is actually reachable from the test', () => {
  assert.ok(ladder && typeof ladder === 'object', 'MILESTONES_BY_ROLE is not exported')
  assert.ok(Object.keys(ladder).length >= 3, `expected several roles, got ${Object.keys(ladder)}`)
})

t('ONLY the live chain changed: gatherer is any-log, scout and miner untouched', () => {
  // Measured 2026-09-21: ALL 80 bots carry role `gatherer`, so the scout and
  // miner ladders reach nobody. Changing them would have been a pure inert edit
  // and is exactly the trap this project keeps falling into, so they are left
  // verbatim and this test pins that.
  const anyLog = []
  for (const [role, rungs] of Object.entries(ladder)) {
    for (const r of rungs ?? []) if (Array.isArray(r?.wantsAny)) anyLog.push(`${role}:${r.id}`)
  }
  assert.deepStrictEqual(anyLog, ['gatherer:gather_oak_log_12'],
    `expected exactly the live gatherer wood rung to be widened, got: ${anyLog.join(', ') || 'none'}`)
  for (const role of ['scout', 'miner']) {
    const oak = (ladder[role] ?? []).filter(r => r?.wants === 'oak_log')
    assert.ok(oak.length >= 1, `${role} was modified; it runs on nobody and must be left alone`)
  }
})

t('the wood rung is DONE on birch alone — the whole point', () => {
  const rungs = Object.values(ladder).flat().filter(r => Array.isArray(r?.wantsAny))
  assert.strictEqual(rungs.length, 1, `expected exactly 1 any-log rung, found ${rungs.length}`)
  for (const r of rungs) {
    const n = Number(String(r.id).split('_').pop())
    assert.ok(r.done(bot({ birch_log: n })),
      `${r.id} is not satisfied by ${n} birch_log -- it still only counts oak`)
    assert.ok(r.done(bot({ spruce_log: n })), `${r.id} is not satisfied by spruce_log`)
    assert.ok(!r.done(bot({ birch_log: n - 1 })), `${r.id} is satisfied one log short`)
    // and a mixed bag must count together, which is what woodUnits already did
    assert.ok(r.done(bot({ oak_log: 1, birch_log: n - 1 })),
      `${r.id} does not add oak and birch together`)
  }
})

t('wantsAny SURVIVES MilestoneController.status() — the path cognitive actually reads', () => {
  // The first version of this change put wantsAny on the ladder object and never
  // forwarded it through status(), so it never left milestones.mjs and the whole
  // thing was inert. Codex pass 1 proved that by calling status() directly. A
  // test on the ladder literal cannot see it; this one goes through the real path.
  const chain = ladder.gatherer
  const wood = chain[1]
  const status = MS.MilestoneController.prototype.status.call(
    { current: () => wood, index: 1, chain, cycle: 0, completions: {},
      bot: { inventory: { items: () => [] } } })
  assert.strictEqual(status.wants, 'oak_log', 'wants must stay a single registry key')
  assert.ok(Array.isArray(status.wantsAny), 'wantsAny was dropped by status() — inert again')
  assert.ok(status.wantsAny.includes('birch_log'), 'wantsAny reached status() without birch')
})

t('a milestone WITHOUT a family still reports wantsAny null, not undefined', () => {
  const chain = ladder.gatherer
  const dirt = chain[0]
  const status = MS.MilestoneController.prototype.status.call(
    { current: () => dirt, index: 0, chain, cycle: 0, completions: {},
      bot: { inventory: { items: () => [] } } })
  assert.strictEqual(status.wantsAny, null, 'a single-block rung should carry null, not a stray array')
})

t('every any-log rung still offers the scan the full list', () => {
  for (const r of Object.values(ladder).flat().filter(x => Array.isArray(x?.wantsAny))) {
    assert.ok(r.wantsAny.includes('birch_log'), `${r.id} omits birch from wantsAny`)
    assert.strictEqual(typeof r.wants, 'string', `${r.id} made wants non-string`)
    assert.ok(r.wantsAny.includes(r.wants), `${r.id}: wants is not in wantsAny`)
  }
})

t('the describe and hint tell the model any kind counts', () => {
  for (const r of Object.values(ladder).flat().filter(x => Array.isArray(x?.wantsAny))) {
    assert.match(r.describe, /any kind/i, `${r.id} still tells the model to get one species`)
    assert.match(r.hint, /any other log/i, `${r.id} hint does not widen`)
  }
})

t('SOURCE: the three gather rungs use gatherAny(LOGS, ...)', () => {
  // Behaviour cannot reach the ladder literals from here when ROLES is not
  // exported, and CLAUDE.md allows a source assertion for a value wired into a
  // call site. Anchored on the executable line with comments stripped, because
  // this file's comments quote the code they explain.
  const src = readFileSync(new URL('../src/milestones.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const anyLog = (src.match(/M\.gatherAny\(LOGS,/g) ?? []).length
  const oak = (src.match(/M\.gather\('oak_log',/g) ?? []).length
  assert.strictEqual(anyLog, 1, `expected exactly 1 gatherAny(LOGS,...) rung, found ${anyLog}`)
  assert.strictEqual(oak, 2, `expected scout+miner to KEEP their oak rungs, found ${oak}`)
})

t('LOGS is declared before the ladders that use it', () => {
  const src = readFileSync(new URL('../src/milestones.mjs', import.meta.url), 'utf8')
  const decl = src.indexOf('const LOGS = [')
  const use = src.indexOf('M.gatherAny(LOGS,')
  assert.ok(decl > -1 && use > -1, 'could not locate both the declaration and a use')
  assert.ok(decl < use,
    'LOGS is declared AFTER the ladder that uses it -- this is the import crash again')
})

t('wants stays a STRING so the registry-key consumers keep working', () => {
  // cognitive.mjs #wantedItems does registry.itemsByName[wants] and new Set([wants]);
  // workorder.mjs readyFor does the same. An array makes both silently do nothing.
  const src = readFileSync(new URL('../src/milestones.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(src, /wants: names\[0\]/,
    'wants must remain a single string; the wider list belongs in wantsAny')
  assert.match(src, /wantsAny: names/, 'wantsAny must carry the full list')
})

// ------------------------------------------------------------------ mutants ---
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 50))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const MSRC = new URL('../src/milestones.mjs', import.meta.url)

await ta('MUTANT KILLED: wants becoming the whole array breaks the registry lookup', async () => {
  // The first version of this only checked that the replacement text existed,
  // which kills nothing (Codex pass 2). It now runs the REAL assertion -- wants
  // must be a single string, because registry.itemsByName[wants] and
  // new Set([wants]) both silently do nothing with an array -- and requires it
  // to fail against the mutant.
  await withMutant(MSRC, '    wants: names[0],', '    wants: names,', async mod => {
    const wood = mod.MILESTONES_BY_ROLE.gatherer[1]
    let threw = null
    try { assert.strictEqual(typeof wood.wants, 'string') } catch (e) { threw = e }
    assert.ok(threw, 'the REAL assertion still passed against the mutant')
  })
  assert.strictEqual(typeof ladder.gatherer[1].wants, 'string')
})

t('THE RUNG ID IS UNCHANGED — it is a persistence key, not a label', () => {
  // Renaming it silently resets that rung's stored attempts, skips and
  // completions, and in a canary it would reset them on ONE ARM ONLY, confounding
  // the advancement endpoint this change is read on (Codex pass 2).
  assert.strictEqual(ladder.gatherer[1].id, 'gather_oak_log_12',
    'the wood rung id changed; its persisted history is now orphaned on one arm')
})

await ta('MUTANT KILLED: putting oak back in the live rung', async () => {
  // The mutant must make the REAL behaviour assertion fail: the wood rung stops
  // being satisfied by birch.
  await withMutant(MSRC,
    "    M.gatherAny(LOGS, 12, 'Wood too.', 'log', 'gather_oak_log_12'),",
    "    M.gather('oak_log', 12, 'Wood too.'),",
    async mod => {
      const wood = mod.MILESTONES_BY_ROLE.gatherer[1]
      let threw = null
      try {
        assert.ok(wood.done(bot({ birch_log: 12 })),
          'the wood rung is not satisfied by 12 birch')
      } catch (e) { threw = e }
      assert.ok(threw, 'the REAL assertion still passed against the oak mutant')
    })
})

await ta('A PREREQ DETOUR DOES NOT INHERIT THE GOAL FAMILY', async () => {
  // Codex pass 2 reproduced this: applyPrereq spreads the milestone and swaps
  // `wants` to the detour item, but the spread carried `wantsAny` across -- so a
  // scaffold-dirt detour still wanted all eight logs, birch counted as progress
  // toward fetching dirt, and birch gathering earned the milestone-critical
  // admission exemption on a task with nothing to do with wood.
  const mod = await import('../src/cognitive.mjs')
  const applyPrereq = mod.applyPrereq ?? mod.default?.applyPrereq
  const wood = ladder.gatherer[1]
  const base = MS.MilestoneController.prototype.status.call(
    { current: () => wood, index: 1, chain: ladder.gatherer, cycle: 0, completions: {},
      bot: { inventory: { items: () => [] } } })
  if (typeof applyPrereq !== 'function') {
    // not exported: assert the source guarantee instead, anchored on the
    // executable line with comments stripped
    const src = readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.match(src, /wantsAny: Array\.isArray\(prereq\.items\)/,
      'applyPrereq does not override wantsAny; the detour inherits the goal family')
    return
  }
  const out = applyPrereq(base, { items: ['dirt'], count: 4, describe: 'd',
                                  fromSkill: 'place', since: Date.now() }, 0, Date.now())
  const task = out?.task ?? out
  assert.strictEqual(task.wants, 'dirt')
  assert.ok(!Array.isArray(task.wantsAny) || !task.wantsAny.includes('birch_log'),
    'the dirt detour still wants birch — the goal family leaked into it')
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
