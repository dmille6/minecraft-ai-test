// promptcache-01: the decision prompt's cacheable prefix and its repeats.
//
// 1. The bot's identity line opens the USER message, so the SYSTEM message is byte-identical across bots and a hybrid
//    model's checkpoint at the start of the last user message is shared (measured 10-31: cache_n 0 -> 1,173).
// 2. RECENT EVENTS drops the repeat of LAST ACTION, collapses consecutive identical events, and drops bracketed
//    diagnostics.
// 3. Peer lines carry report counts, not name lists.
// Behaviour tests on the exported pure functions plus the composed buildUserPrompt / WorldFacts.promptLines output.
process.env.BOT_NAME = 'pool-x-Alpha'
process.env.BOT_ROLE = 'gatherer'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const { buildSystemPrompt, buildUserPrompt, identityLine, compactEvents } = await import('../src/prompt.mjs')
const { WorldFacts, seenLine, hazardLine } = await import('../src/worldfacts.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const mcData = createRequire(import.meta.url)('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const names = Object.keys(SKILLS).filter(n => !SKILLS[n].chatOnly)
const fakeBot = () => ({
  entity: { position: { x: 10, y: 70, z: 10, distanceTo: () => 6, offset: () => ({}) } },
  health: 20, food: 20, time: { day: 1, age: 1 },
  inventory: { items: () => [] },
  registry: mcData, recipesFor: () => [],
  blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
  findBlock: () => null, findBlocks: () => [], entities: {}, players: {},
})
const prompt = (events, lastOutcome) => buildUserPrompt({
  bot: fakeBot(), milestone: { describe: 'Collect 8 sand.', progress: '3/8 sand' },
  memory: { locations: {}, events: events.map(text => ({ t: 0, text })) }, lastOutcome,
  trigger: 'idle', sentinel: 'END-TEST', lessons: [],
}).user

// ---- 1. identity ----------------------------------------------------------------------------------------------------
t('the SYSTEM message carries no bot identity (byte-identical across the bots of a scope)', () => {
  const sys = buildSystemPrompt(names)
  assert.ok(!sys.includes('pool-x-Alpha'), 'the bot name is in the system message')
  assert.ok(!/You are /.test(sys), 'an identity sentence is in the system message')
  assert.ok(sys.endsWith('- Copy the saw_end value from the end of the user message exactly.'),
    `the system message must end on the shared rules, ends: ${JSON.stringify(sys.slice(-80))}`)
})

t('the USER message opens with the identity line, unchanged in wording', () => {
  assert.equal(identityLine(), 'You are pool-x-Alpha, an autonomous gatherer agent in Minecraft.')
  const u = prompt([], null)
  assert.equal(u.split('\n')[0], identityLine())
  assert.equal(u.split('\n')[1], 'TASK: Collect 8 sand.')
  assert.equal(u.split('\n').filter(l => l === identityLine()).length, 1, 'identity appears exactly once')
})

// ---- 2. events --------------------------------------------------------------------------------------------------------
t('the final event is not repeated when LAST ACTION already says it', () => {
  const last = 'gather -> failed: sand found but all 3 candidates are beside water'
  assert.deepEqual(compactEvents(['goto -> success: arrived', last], last), ['goto -> success: arrived'])
  const u = prompt(['goto -> success: arrived', last], last)
  assert.equal(u.split('\n').filter(l => l.includes('beside water')).length, 1, 'the outcome is shown once, in LAST ACTION')
  assert.ok(u.includes(`LAST ACTION: ${last}`))
})

t('a LAST ACTION longer than an event is matched on the 160-char event it produced', () => {
  const last = 'mine -> unknown: ' + 'x'.repeat(200)
  assert.deepEqual(compactEvents(['a', last.slice(0, 160)], last), ['a'])
})

t('an event that only resembles LAST ACTION, or is not the newest, is kept', () => {
  const last = 'gather -> failed: no sand'
  assert.deepEqual(compactEvents([last, 'reflex took over (entombed): entombed'], last),
    [last, 'reflex took over (entombed): entombed'])
  assert.deepEqual(compactEvents(['gather -> failed: no sand here'], last), ['gather -> failed: no sand here'])
  assert.deepEqual(compactEvents(['x'], null), ['x'])
})

t('consecutive identical events collapse with a count; separated repeats stay separate; order is kept', () => {
  assert.deepEqual(compactEvents(['a', 'b', 'b', 'b', 'a', 'c'], null), ['a', 'b (x3)', 'a', 'c'])
})

t('bracketed diagnostics are dropped, including one the 160-char cut left open', () => {
  assert.deepEqual(compactEvents([
    'gather -> failed: dirt found but unreachable after 3 attempts [probe: success, slate 4, A* reached a candidate] [collect threw nothing -- it returned without ga',
    'goto -> success (valuable): arrived at 349,47,141 [position: moved 14 blocks]',
  ], null), [
    'gather -> failed: dirt found but unreachable after 3 attempts',
    'goto -> success (valuable): arrived at 349,47,141',
  ])
})

t('events that differ only in their diagnostics collapse into one', () => {
  assert.deepEqual(compactEvents([
    'gather -> failed: dirt found but unreachable [probe: success, slate 4]',
    'gather -> failed: dirt found but unreachable [probe: success, slate 3, A* reached none]',
  ], null), ['gather -> failed: dirt found but unreachable (x2)'])
})

t('an event that was nothing but a diagnostic leaves no empty bullet', () => {
  assert.deepEqual(compactEvents(['[probe: success]', 'a'], null), ['a'])
})

t('no events -> no RECENT EVENTS header; empty input is safe', () => {
  assert.deepEqual(compactEvents([], 'x'), [])
  assert.deepEqual(compactEvents(undefined, null), [])
  const only = 'gather -> failed: no sand'
  assert.ok(!prompt([only], only).includes('RECENT EVENTS'), 'a header with nothing under it')
})

// ---- 3. peer lines ----------------------------------------------------------------------------------------------------
t('seenLine: counts instead of names; first-hand marked; a lone peer keeps its name', () => {
  const r = { kind: 'sand', x: 1, y: 72, z: 3, d: 2 }
  assert.equal(seenLine({ ...r, by: ['a', 'pool-x-Alpha', 'b'] }, 'pool-x-Alpha'),
    'sand seen at x=1 y=72 z=3 (2 blocks away, 3 reports, incl. you)')
  assert.equal(seenLine({ ...r, by: ['a', 'b'] }, 'pool-x-Alpha'), 'sand seen at x=1 y=72 z=3 (2 blocks away, 2 reports)')
  assert.equal(seenLine({ ...r, by: ['a'] }, 'pool-x-Alpha'), 'sand seen at x=1 y=72 z=3 (2 blocks away, reported by a)')
  assert.equal(seenLine({ ...r, by: ['pool-x-Alpha'] }, 'pool-x-Alpha'), 'sand seen at x=1 y=72 z=3 (2 blocks away, 1 report, incl. you)')
})

t('hazardLine: N other bots, or the one name', () => {
  const s = { kind: 'entombed', count: 10, x: 386, y: 21, z: 135 }
  assert.equal(hazardLine(['a', 'b', 'c'], s), '3 other bots hit entombed 10x near 386,21,135 — avoid it')
  assert.equal(hazardLine(['a'], s), 'a hit entombed 10x near 386,21,135 — avoid it')
})

t('WorldFacts.promptLines composes them: every axis labelled, own name never listed, own-only hazard skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-wf-'))
  const f = path.join(dir, 'facts.json')
  fs.writeFileSync(f, JSON.stringify({ schema: 1, unreachable: {},
    resources: [{ kind: 'oak_log', x: 15, y: 73, z: 10, by: ['pool-x-Bravo', 'pool-x-Alpha', 'pool-x-Echo'] }],
    sites: [
      { kind: 'entombed', x: 20, y: 40, z: 10, count: 8, by: ['pool-x-Bravo', 'pool-x-Delta', 'pool-x-Alpha'] },
      { kind: 'entombed', x: 12, y: 40, z: 10, count: 3, by: ['pool-x-Alpha'] },
    ] }))
  const lines = new WorldFacts(f).promptLines({ x: 10, y: 70, z: 10 })
  assert.deepEqual(lines, [
    'oak_log seen at x=15 y=73 z=10 (5 blocks away, 3 reports, incl. you)',
    '2 other bots hit entombed 8x near 20,40,10 — avoid it',
  ])
  assert.ok(!lines.join('\n').includes('pool-x-Alpha'))
  fs.rmSync(dir, { recursive: true, force: true })
})

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
