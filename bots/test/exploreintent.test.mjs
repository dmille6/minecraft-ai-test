// AN EXPLORE UNDER A TASK WALKS TOWARD THAT TASK'S MATERIAL -- never to iron because iron is first in a list.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-explore'
const { exploreKindsFor, exploreArgsFor, SIGHTABLE } = await import('../src/exploreintent.mjs')
const { knownTarget, aimLeg, EXPLORE_ARRIVE, exploreBearing, SKILLS } = await import('../src/skills.mjs')
const { createRequire } = await import('node:module')
const { Vec3 } = createRequire(import.meta.url)('vec3')
const { MILESTONES_BY_ROLE, SUSTAINING } = await import('../src/milestones.mjs')
const { SURVEY_BLOCKS, scaffoldPrereq, pickaxePrereq } = await import('../src/reflex.mjs')
const { applyPrereq } = await import('../src/cognitive.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

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

await t('THE FINDING: under a sand task with iron AND sand sighted, the task-aimed walk goes to sand; legacy went to iron', () => {
  const bot = botWith({ iron_ore: [[40, 0]], sand: [[0, 90]] })
  const task = { id: 'gather_sand_8', wants: 'sand' }
  assert.equal(knownTarget(bot, null).kind, 'iron_ore', 'positive control: the old order picks iron')
  assert.equal(knownTarget(bot, exploreArgsFor({ blocks: 60 }, task).args.toward).kind, 'sand')
})
await t('a FAMILY takes the nearest member, not the first member with a sighting anywhere', () => {
  const bot = botWith({ oak_log: [[300, 0]], spruce_log: [[0, 40]] })
  const hit = knownTarget(bot, ['oak_log', 'birch_log', 'spruce_log'])
  assert.equal(hit.kind, 'spruce_log'); assert.equal(Math.round(hit.dist), 40)
})
await t('a family keeps the 24-block floor and the death-site refusal', () => {
  const near = botWith({ oak_log: [[10, 0], [50, 0]] })
  assert.equal(knownTarget(near, ['oak_log']).x, 50)
  const dead = botWith({ oak_log: [[50, 0]] }, undefined, [{ x: 50, y: 64, z: 0, kind: 'death:lava', count: 4, last: Date.now() }])
  const r = knownTarget(dead, ['oak_log'])
  assert.equal(r?.kind, undefined, `a sighting on a death site must not be a target: ${JSON.stringify(r)}`)
  assert.equal(r?.skipped, 1, 'the refusal is counted, so the row can report it')
})
await t('NO SIGHTING OF THE MATERIAL: no target -- never a fall-through to iron', () => {
  const bot = botWith({ iron_ore: [[40, 0]], coal_ore: [[0, 40]] })
  assert.equal(knownTarget(bot, ['sand']), null)
})
await t('a single-string toward (chat command) and no toward behave exactly as before', () => {
  const bot = botWith({ iron_ore: [[400, 0]], oak_log: [[30, 0]] })
  assert.equal(knownTarget(bot, 'iron_ore').kind, 'iron_ore')
  assert.equal(knownTarget(bot, null).kind, 'iron_ore')
})

await t('every kind the resolver can name is one the reflex actually records as a sighting', () => {
  for (const k of SIGHTABLE) assert.ok(SURVEY_BLOCKS.includes(k), `${k} is never sighted`)
})
await t('THE REAL RUNGS: gather/stockpile rungs aim; craft, smelt, survey, patrol, travel and deposit do not', () => {
  const all = [...Object.values(MILESTONES_BY_ROLE).flat(), ...SUSTAINING].filter(m => m?.id)
  let aimed = 0, left = 0
  for (const m of all) {
    const r = exploreKindsFor(m)
    if (/^(craft|smelt|survey|patrol|travel|deposit|stockpile_stone|gather_cobblestone)/.test(m.id)) { assert.equal(r, null, `${m.id} must keep today's explore`); left++ }
    if (/^gather_/.test(m.id) && !/^gather_(cobblestone|dirt)/.test(m.id)) assert.ok(r, `${m.id} must be aimed`)
    if (r) { aimed++; for (const k of r.kinds) assert.ok(SIGHTABLE.includes(k), `${m.id} -> ${k}`) }
  }
  assert.ok(aimed >= 4 && left >= 8, `the sweep must reach both kinds of rung (aimed ${aimed}, left ${left})`)
  assert.deepEqual(exploreKindsFor(rung('gather_oak_log_12')).kinds, ['oak_log', 'birch_log', 'spruce_log'])
  assert.deepEqual(exploreKindsFor(rung('stockpile_wood')).kinds, ['oak_log', 'birch_log', 'spruce_log'])
  assert.equal(exploreKindsFor(rung('stockpile_stone')), null, 'stone is out of scope (buried, not distant)')
  assert.deepEqual(exploreKindsFor(rung('gather_iron_ore_3')).kinds, ['iron_ore'])
})
await t('wants is literal (gather oak_log counts oak only); a lap suffix still names the stockpile', () => {
  assert.deepEqual(exploreKindsFor({ id: 'gather_oak_log_8', wants: 'oak_log' }).kinds, ['oak_log'])
  assert.deepEqual(exploreKindsFor({ id: 'stockpile_wood#7', wants: null }).kinds, ['oak_log', 'birch_log', 'spruce_log'])
  assert.deepEqual(exploreKindsFor({ id: 'gather_x', wants: 'minecraft:SAND' }).kinds, ['sand'])
  assert.equal(exploreKindsFor({ id: 'gather_cobblestone_16', wants: 'cobblestone' }), null)
})
await t('THE REAL DETOURS through applyPrereq: neither the pickaxe nor the scaffold detour is aimed (a wood rung underneath)', () => {
  for (const need of [pickaxePrereq('x'), scaffoldPrereq('x')]) {
    const { task } = applyPrereq({ id: 'stockpile_wood#2', wants: null }, { ...need, since: Date.now(), fromSkill: 'surface' }, 0)
    assert.match(task.id, /\+prereq$/, 'the detour is in force')
    assert.equal(exploreKindsFor(task), null, `${task.wants} detour must not aim the walk`)
  }
})
await t('LITERAL ITEMS (Codex review): a smelt detour counting the item iron_ore is not aimed; the iron RUNG (counts raw_iron) is', () => {
  assert.equal(exploreKindsFor({ id: 'smelt_iron_ingot_1+prereq', wants: 'iron_ore' }), null)
  assert.equal(exploreKindsFor({ id: 'x+prereq', wants: 'coal_ore' }), null)
  assert.deepEqual(exploreKindsFor({ id: 'x+prereq', wants: 'raw_iron' }).kinds, ['iron_ore'])
  assert.deepEqual(exploreKindsFor({ id: 'gather_iron_ore_3#2', wants: 'iron_ore' }).kinds, ['iron_ore'])
  assert.equal(exploreKindsFor({ id: 'gather_iron_ore_3+prereq', wants: 'wooden_pickaxe' }), null)
})
await t('a family whose MAIN item is sightable drops only the unsightable members', () => {
  assert.deepEqual(exploreKindsFor({ id: 'g', wants: 'sand', wantsAny: ['sand', 'red_sand'] }).kinds, ['sand'])
  assert.equal(exploreKindsFor({ id: 'g', wants: 'dirt', wantsAny: ['dirt', 'sand'] }), null, 'an unsightable MAIN item is never aimed via a sightable member')
})
await t('the runner gets a COPY: the admitted args (the gate keys) are untouched; an explicit toward is never replaced', () => {
  const admitted = { blocks: 60 }
  const { args } = exploreArgsFor(admitted, { id: 'gather_sand_8', wants: 'sand' })
  assert.deepEqual(admitted, { blocks: 60 }); assert.deepEqual(args.toward, ['sand']); assert.equal(args.intentTask, 'gather_sand_8')
  assert.equal(exploreArgsFor({ blocks: 60, toward: 'coal_ore' }, { wants: 'sand' }).args.toward, 'coal_ore')
  assert.equal(exploreArgsFor({ blocks: 60 }, { id: 'patrol', wants: null }).args.toward, undefined)
})

await t('aimLeg: bearing and distance to the sighting; arrival inside EXPLORE_ARRIVE', () => {
  const a = aimLeg({ x: 0, z: 0 }, { x: 0, z: 30 })
  assert.ok(Math.abs(a.ang - Math.PI / 2) < 1e-9); assert.equal(a.remaining, 30); assert.equal(a.arrived, false)
  assert.equal(aimLeg({ x: 0, z: 0 }, { x: EXPLORE_ARRIVE, z: 0 }).arrived, true)
})

// ---- explore() ITSELF, driven: a pathfinder that walks the bot to each leg's goal (both reviews: untested) ----
// `drift` lands each leg that many blocks to the side (+x), as GoalNear's range 3 allows: a walk that never re-aims
// accumulates it and misses the sighting.
// `short` lands each leg that many blocks before its goal, along the line of travel (GoalNear accepts within 3).
function walker (sightings, start = [0, 64, 0], { stall = () => false, drift = 0, short = 0 } = {}) {
  const bot = botWith(sightings, new Vec3(...start))
  Object.assign(bot, {
    inventory: { items: () => [] }, heldItem: null, health: 20, food: 20,
    look: async () => {}, setControlState () {}, clearControlStates () {}, deathSitesNow: () => [],
    blockAt: () => ({ name: 'grass_block', boundingBox: 'block' }),
    pathfinder: { setGoal () {}, stop () {}, goto: async g => {
      if (stall(bot.entity.position)) throw new Error('no path')
      const p = bot.entity.position, d = Math.hypot(g.x - p.x, g.z - p.z) || 1, k = Math.max(0, d - short) / d
      bot.entity.position = new Vec3(p.x + (g.x - p.x) * k + drift, p.y, p.z + (g.z - p.z) * k) } },
  })
  return bot
}
const run = (bot, args) => SKILLS.explore.run({ bot }, args, new AbortController().signal)
await t('DRIVEN: a task-aimed walk ARRIVES at the sighting and stops; the legacy walk runs its full budget past iron', async () => {
  const sightings = { iron_ore: [[40, 0]], sand: [[0, 50]] }
  const aimed = walker(sightings, undefined, { drift: 2.5 })
  const r = await run(aimed, { blocks: 80, toward: ['sand'], intentTask: 'gather_sand_8' })
  const left = Math.hypot(aimed.entity.position.x - 0, aimed.entity.position.z - 50)
  assert.equal(r.status, 'success'); assert.ok(left <= EXPLORE_ARRIVE, `ended ${left.toFixed(1)} from the sand`)
  const legacy = walker(sightings)
  await run(legacy, { blocks: 80 })
  const past = Math.hypot(legacy.entity.position.x, legacy.entity.position.z)
  assert.ok(past > 70, `positive control: the legacy walk overshoots the 40-block iron to ~80 (${past.toFixed(0)})`)
})
await t('DRIVEN: ARRIVING is success even under 20 blocks moved (a sighting at the 24-block floor, legs landing 3 short)', async () => {
  const bot = walker({ sand: [[0, 24]] }, undefined, { short: 3 })
  const r = await run(bot, { blocks: 60, toward: ['sand'] })
  const moved = Math.hypot(bot.entity.position.x, bot.entity.position.z)
  assert.ok(moved < 20, `the case needs < 20 moved (${moved.toFixed(1)})`)
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`); assert.match(r.detail, /arrived at the sand sighting/)
})
await t('DRIVEN: the material has no sighting -- the walk goes outward from spawn, not to the sighted iron', async () => {
  const bot = walker({ iron_ore: [[-60, 0]] }, [0, 64, 100])
  await run(bot, { blocks: 60, toward: ['sand'] })
  assert.ok(bot.entity.position.z > 130, `walked outward (+z), ended at ${bot.entity.position.x.toFixed(0)},${bot.entity.position.z.toFixed(0)}`)
})
await t('AN ABSENT HEADING IS NOT DUE EAST: null walks away from spawn (positive control: heading 0 IS east)', () => {
  const mid = () => 0.5
  assert.equal(exploreBearing(0, { x: 0, z: 100 }, mid), 0)
  assert.ok(Math.abs(exploreBearing(null, { x: 0, z: 100 }, mid) - Math.PI / 2) < 1e-9)
  assert.ok(Math.abs(exploreBearing('', { x: -100, z: 0 }, mid) - Math.PI) < 1e-9)
  assert.ok(Math.abs(exploreBearing(90, { x: 0, z: 0 }, mid) - Math.PI / 2) < 1e-9)
})

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
await t('WIRED: the decision loop runs explore with the task-aimed copy; explore writes the row only for an aimed walk', () => {
  const cog = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  assert.match(cog, /const runArgs = admitted\.skill === 'explore' \? exploreArgsFor\(admitted\.args, milestone\)\.args : admitted\.args\s*const r = await this\.runner\.run\(admitted\.skill, runArgs,/)
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.match(sk, /if \(intended\) \{[\s\S]{0,200}kind: 'explore_toward_milestone'/)
  assert.match(sk, /if \(aimAt\) \{\s*const a = aimLeg\(from, aimAt\)\s*if \(a\.arrived\) \{ arrived = true; break \}\s*if \(reaim\) ang = a\.ang/)
  assert.match(sk, /let ang = exploreBearing\(heading, start\)/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
