// AN EXPLORE UNDER A TASK WALKS TOWARD THAT TASK'S MATERIAL -- never to iron because iron is first in a list.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-explore'
const { exploreKindsFor, exploreArgsFor, SIGHTABLE } = await import('../src/exploreintent.mjs')
const { knownTarget, exploreStopAt, exploreBearing } = await import('../src/skills.mjs')
const { MILESTONES_BY_ROLE, SUSTAINING } = await import('../src/milestones.mjs')
const { SURVEY_BLOCKS, scaffoldPrereq, pickaxePrereq } = await import('../src/reflex.mjs')
const { applyPrereq } = await import('../src/cognitive.mjs')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// A bot at `at` with sightings { kind: [[x, z], ...] } and optional death sites.
function botWith (sightings, at = { x: 0, y: 64, z: 0 }, deaths = []) {
  return {
    entity: { position: at },
    worldFacts: {
      resourcesNear: (kind, pos) => (sightings[kind] ?? []).map(([x, z]) => ({ kind, x, y: 64, z }))
        .sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z)),
      deathSites: () => deaths,
    },
  }
}
const rung = id => [...Object.values(MILESTONES_BY_ROLE).flat(), ...SUSTAINING].find(m => m?.id === id)

t('THE FINDING: under a sand task with iron AND sand sighted, the task-aimed walk goes to sand; legacy went to iron', () => {
  const bot = botWith({ iron_ore: [[40, 0]], sand: [[0, 90]] })
  const task = { id: 'gather_sand_8', wants: 'sand' }
  assert.equal(knownTarget(bot, null).kind, 'iron_ore', 'positive control: the old order picks iron')
  assert.equal(knownTarget(bot, exploreArgsFor({ blocks: 60 }, task).args.toward).kind, 'sand')
})
t('a FAMILY takes the nearest member, not the first member with a sighting anywhere', () => {
  const bot = botWith({ oak_log: [[300, 0]], spruce_log: [[0, 40]] })
  const hit = knownTarget(bot, ['oak_log', 'birch_log', 'spruce_log'])
  assert.equal(hit.kind, 'spruce_log'); assert.equal(Math.round(hit.dist), 40)
})
t('a family keeps the 24-block floor and the death-site refusal', () => {
  const near = botWith({ oak_log: [[10, 0], [50, 0]] })
  assert.equal(knownTarget(near, ['oak_log']).x, 50)
  const dead = botWith({ oak_log: [[50, 0]] }, undefined, [{ x: 50, y: 64, z: 0, kind: 'death:lava', count: 4, last: Date.now() }])
  const r = knownTarget(dead, ['oak_log'])
  assert.equal(r?.kind, undefined, `a sighting on a death site must not be a target: ${JSON.stringify(r)}`)
  assert.equal(r?.skipped, 1, 'the refusal is counted, so the row can report it')
})
t('NO SIGHTING OF THE MATERIAL: no target -- never a fall-through to iron', () => {
  const bot = botWith({ iron_ore: [[40, 0]], coal_ore: [[0, 40]] })
  assert.equal(knownTarget(bot, ['sand']), null)
})
t('a single-string toward (chat command) and no toward behave exactly as before', () => {
  const bot = botWith({ iron_ore: [[400, 0]], oak_log: [[30, 0]] })
  assert.equal(knownTarget(bot, 'iron_ore').kind, 'iron_ore')
  assert.equal(knownTarget(bot, null).kind, 'iron_ore')
})

t('every kind the resolver can name is one the reflex actually records as a sighting', () => {
  for (const k of SIGHTABLE) assert.ok(SURVEY_BLOCKS.includes(k), `${k} is never sighted`)
})
t('THE REAL RUNGS: gather/stockpile rungs aim; craft, smelt, survey, patrol, travel and deposit do not', () => {
  const all = [...Object.values(MILESTONES_BY_ROLE).flat(), ...SUSTAINING].filter(m => m?.id)
  let aimed = 0, left = 0
  for (const m of all) {
    const r = exploreKindsFor(m)
    if (/^(craft|smelt|survey|patrol|travel|deposit|stockpile_stone|gather_cobblestone)/.test(m.id)) { assert.equal(r, null, `${m.id} must keep today's explore`); left++ }
    if (r) { aimed++; for (const k of r.kinds) assert.ok(SIGHTABLE.includes(k), `${m.id} -> ${k}`) }
  }
  assert.ok(aimed >= 4 && left >= 8, `the sweep must reach both kinds of rung (aimed ${aimed}, left ${left})`)
  assert.deepEqual(exploreKindsFor(rung('gather_oak_log_12')).kinds, ['oak_log', 'birch_log', 'spruce_log'])
  assert.deepEqual(exploreKindsFor(rung('stockpile_wood')).kinds, ['oak_log', 'birch_log', 'spruce_log'])
  assert.equal(exploreKindsFor(rung('stockpile_stone')), null, 'stone is out of scope (buried, not distant)')
  assert.deepEqual(exploreKindsFor(rung('gather_iron_ore_3')).kinds, ['iron_ore'])
})
t('wants is literal (gather oak_log counts oak only); a lap suffix still names the stockpile', () => {
  assert.deepEqual(exploreKindsFor({ id: 'gather_oak_log_8', wants: 'oak_log' }).kinds, ['oak_log'])
  assert.deepEqual(exploreKindsFor({ id: 'stockpile_wood#7', wants: null }).kinds, ['oak_log', 'birch_log', 'spruce_log'])
  assert.deepEqual(exploreKindsFor({ id: 'gather_x', wants: 'minecraft:SAND' }).kinds, ['sand'])
  assert.equal(exploreKindsFor({ id: 'gather_cobblestone_16', wants: 'cobblestone' }), null)
})
t('THE REAL DETOURS through applyPrereq: neither the pickaxe nor the scaffold detour is aimed (a wood rung underneath)', () => {
  for (const need of [pickaxePrereq('x'), scaffoldPrereq('x')]) {
    const { task } = applyPrereq({ id: 'stockpile_wood#2', wants: null }, { ...need, since: Date.now(), fromSkill: 'surface' }, 0)
    assert.match(task.id, /\+prereq$/, 'the detour is in force')
    assert.equal(exploreKindsFor(task), null, `${task.wants} detour must not aim the walk`)
  }
})
t('a family whose MAIN item is sightable drops only the unsightable members', () => {
  assert.deepEqual(exploreKindsFor({ id: 'g', wants: 'sand', wantsAny: ['sand', 'red_sand'] }).kinds, ['sand'])
  assert.equal(exploreKindsFor({ id: 'g', wants: 'dirt', wantsAny: ['dirt', 'sand'] }), null, 'an unsightable MAIN item is never aimed via a sightable member')
})
t('the runner gets a COPY: the admitted args (the gate keys) are untouched; an explicit toward is never replaced', () => {
  const admitted = { blocks: 60 }
  const { args } = exploreArgsFor(admitted, { id: 'gather_sand_8', wants: 'sand' })
  assert.deepEqual(admitted, { blocks: 60 }); assert.deepEqual(args.toward, ['sand']); assert.equal(args.intentTask, 'gather_sand_8')
  assert.equal(exploreArgsFor({ blocks: 60, toward: 'coal_ore' }, { wants: 'sand' }).args.toward, 'coal_ore')
  assert.equal(exploreArgsFor({ blocks: 60 }, { id: 'patrol', wants: null }).args.toward, undefined)
})

t('STOP AT THE THING: a sighting 35 blocks off ends the walk at 35, not 80; never under 20; never past `blocks`', () => {
  assert.equal(exploreStopAt(80, 35.4), 35); assert.equal(exploreStopAt(80, 5), 20); assert.equal(exploreStopAt(60, 300), 60)
})
t('AN ABSENT HEADING IS NOT DUE EAST: null walks away from spawn (positive control: heading 0 IS east)', () => {
  const mid = () => 0.5
  assert.equal(exploreBearing(0, { x: 0, z: 100 }, mid), 0)
  assert.ok(Math.abs(exploreBearing(null, { x: 0, z: 100 }, mid) - Math.PI / 2) < 1e-9)
  assert.ok(Math.abs(exploreBearing('', { x: -100, z: 0 }, mid) - Math.PI) < 1e-9)
  assert.ok(Math.abs(exploreBearing(90, { x: 0, z: 0 }, mid) - Math.PI / 2) < 1e-9)
})

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
t('WIRED: the decision loop runs explore with the task-aimed copy; explore writes the row only for an aimed walk', () => {
  const cog = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  assert.match(cog, /const runArgs = admitted\.skill === 'explore' \? exploreArgsFor\(admitted\.args, milestone\)\.args : admitted\.args\s*const r = await this\.runner\.run\(admitted\.skill, runArgs,/)
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.match(sk, /if \(intended\) \{[\s\S]{0,200}kind: 'explore_toward_milestone'/)
  assert.match(sk, /if \(intended && known\?\.kind\) want = exploreStopAt\(want, known\.dist\)/)
  assert.match(sk, /let ang = exploreBearing\(heading, start\)/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
