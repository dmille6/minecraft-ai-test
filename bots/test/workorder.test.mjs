// THE LADDER WAS A SCOREBOARD, NOT AN ACTUATOR.
//
// Measured: when the milestone chain lands on a craft rung the model picks the
// craft verb 27-60% of the time against an 8.4% baseline, so the goal channel
// works. craft succeeds 36.7% at 5.8 items per success and smelt 68.6% -- the
// two highest-value verbs in the fleet -- so the skills work. What fails is
// CHOOSING: the fleet calls gather 26 times for every smelt while carrying idle
// stockpiles (292 cobblestone on one bot, 806 bankable items on another).
//
// This is `advice printed is not advice taken` applied to the tech ladder.
import assert from 'node:assert'
import test from 'node:test'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { orderFor, readyFor, rungId } = await import('../src/workorder.mjs')

// A position that behaves like the real one. The last inert deploy happened
// because a fixture was invented rather than copied; `readyFor` now calls
// `.offset()` and `.distanceTo()`, so a fake without them would silently make
// stationInReach return false and every craft test would pass for the wrong
// reason.
const vec = (x, y, z) => ({
  x, y, z,
  offset: (dx, dy, dz) => vec(x + dx, y + dy, z + dz),
  distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
})

// A bot standing at the origin with a crafting table `dist` blocks east.
const botWithTable = (dist, { carried = false, recipes = true } = {}) => {
  const asked = { table: undefined }
  const items = carried ? [{ name: 'crafting_table', count: 1 }] : []
  return {
    asked,
    entity: { position: vec(0, 64, 0) },
    inventory: { items: () => [...items, { name: 'cobblestone', count: 20 }, { name: 'stick', count: 4 }] },
    registry: { itemsByName: { stone_pickaxe: { id: 889 } }, blocks: { 7: { name: 'crafting_table' } } },
    findBlock: ({ matching, maxDistance }) =>
      (matching({ type: 7 }) && dist <= maxDistance) ? { type: 7, position: vec(dist, 64, 0) } : null,
    recipesFor: (id, m, n, table) => { asked.table = table; return (recipes && table) ? [{ id }] : [] },
  }
}

test('a craft rung whose recipe is satisfiable becomes a craft order', () => {
  const o = orderFor({ id: 'craft_stone_pickaxe_1#351', wants: 'stone_pickaxe', craftReady: true })
  assert.equal(o.skill, 'craft')
  assert.deepEqual(o.args, { item: 'stone_pickaxe', count: 1 })
})

test('a smelt rung orders the INPUT, never the output', () => {
  // `smelt item=iron_ingot` has no recipe the registry will ever return. The
  // milestone hint says so explicitly, and this project has twice shipped
  // advice naming a move the model cannot make.
  const o = orderFor({ id: 'smelt_iron_ingot_3#400', wants: 'iron_ingot',
                       smeltReady: true, smeltInput: 'raw_iron' })
  assert.equal(o.skill, 'smelt')
  assert.equal(o.args.item, 'raw_iron', 'the input, not iron_ingot')
})

test('NOT ready means no order — the model still decides', () => {
  assert.equal(orderFor({ id: 'craft_stone_pickaxe_1#351', wants: 'stone_pickaxe', craftReady: false }), null)
  assert.equal(orderFor({ id: 'smelt_iron_ingot_3#400', wants: 'iron_ingot', smeltReady: true, smeltInput: null }), null)
})

test('non-conversion rungs are left alone', () => {
  // gather/travel/survey rungs are the model's business. A work order that
  // claimed those would be a planner, and the chain is not one.
  for (const id of ['gather_iron_ore_3#12', 'stockpile_wood#3', 'return#1', 'survey_wider#9',
                    'gather_iron_ore_3', 'patrol', 'idle']) {
    assert.equal(orderFor({ id, wants: 'anything', craftReady: true, smeltReady: true, smeltInput: 'x' }),
      null, `${id} must not be auto-dispatched`)
  }
})

test('THE SHIPPED-INERT BUG: the emitted id carries a cycle suffix', () => {
  // status() emits `${m.id}#${cycle}` for a sustaining rung, and on the live
  // fleet that is 100% of rung ids -- `#0` included. v1 anchored on the shape
  // the CONSTRUCTOR builds, matched none of them, and shipped completely inert
  // across 80 bots and 20,193 rows. Its tests passed because the fixtures were
  // written from the same wrong assumption, so code and fixture were wrong
  // together and agreed. Every fixture in this file now uses the emitted shape;
  // these ids are copied from the live logs.
  assert.equal(rungId('craft_iron_pickaxe_1#351'), 'craft_iron_pickaxe_1')
  assert.equal(rungId('smelt_iron_ingot_3#0'), 'smelt_iron_ingot_3')
  assert.equal(rungId('craft_crafting_table_1'), 'craft_crafting_table_1')
  assert.equal(rungId('craft_x_1#5+prereq'), 'craft_x_1#5+prereq', 'a prereq suffix is not a cycle suffix')
  for (const id of ['craft_iron_pickaxe_1#351', 'craft_furnace_1#431',
                    'craft_crafting_table_1#0', 'craft_wooden_pickaxe_1#292']) {
    assert.ok(orderFor({ id, wants: 'x', craftReady: true }),
      `${id} is a shape the fleet actually emits and must produce an order`)
  }
})

test('a PREEMPTED rung is not auto-crafted', () => {
  // applyPrereq rewrites the active task to `<id>+prereq` with a different
  // `wants` when a skill reports a missing material. The bot then needs the
  // PREREQ, not the craft, so the anchored rung patterns must decline it --
  // and this is the one place the id arrives in a shape I did not choose.
  assert.equal(orderFor({ id: 'craft_stone_pickaxe_1#351+prereq', wants: 'cobblestone',
                          craftReady: true }), null)
})

test('a missing milestone yields nothing, never a throw', () => {
  assert.equal(orderFor({}), null)
  assert.equal(orderFor({ id: null, wants: null }), null)
  assert.equal(orderFor(), null)
})

test('readyFor uses the SKILL predicate, and a table IN REACH counts', () => {
  // The distinction that made the prompt affordance line wrong for weeks:
  // craft resolves prerequisites by PLACING a table, so the commonest state
  // right after a craft is table-on-ground, none-in-pack.
  const bot = botWithTable(3)
  const r = readyFor(bot, { id: 'craft_stone_pickaxe_1#351', wants: 'stone_pickaxe' })
  assert.equal(r.craftReady, true)
  assert.equal(bot.asked.table, true, 'a reachable placed table must be offered to recipesFor')
})

test('THE no_path BUG: a table beyond reach is NOT ready', () => {
  // Every distance here is one the fleet actually refused at, copied from the
  // failure details: "crafting_table is 7/9/11/12/19 blocks away and could not
  // be reached". v1 accepted all of them because it asked maxDistance:32.
  for (const d of [7, 9, 11, 12, 19]) {
    const bot = botWithTable(d)
    const r = readyFor(bot, { id: 'craft_stone_pickaxe_1#351', wants: 'stone_pickaxe' })
    assert.equal(r.craftReady, false, `a table ${d} blocks away must not read as ready`)
    assert.equal(orderFor(r), null, `and must not produce an order at ${d} blocks`)
  }
})

test('a CARRIED table is ready at any distance -- craft places it itself', () => {
  const bot = botWithTable(40, { carried: true })
  const r = readyFor(bot, { id: 'craft_stone_pickaxe_1#351', wants: 'stone_pickaxe' })
  assert.equal(r.craftReady, true)
  assert.equal(bot.asked.table, true)
})

test('the reach bound is the SKILL constant, not a number typed here', async () => {
  const { STATION_REACH } = await import('../src/skills.mjs')
  assert.equal(typeof STATION_REACH, 'number')
  // Derive the boundary with the measurement the SKILLS make -- bot position to
  // block CENTRE -- rather than assuming it lands on a whole number. It does
  // not: a table 4 east measures 4.56, because the +0.5,+0.5,+0.5 centre offset
  // adds most of a block. Effective reach on the block grid is 3, not 4, and
  // guessing that from STATION_REACH alone would have been wrong.
  const centreDist = d => Math.hypot(d + 0.5, 0.5, 0.5)
  const ready = d => readyFor(botWithTable(d),
    { id: 'craft_stone_pickaxe_1#351', wants: 'stone_pickaxe' }).craftReady
  for (const d of [1, 2, 3, 4, 5, 6, 12]) {
    assert.equal(ready(d), centreDist(d) <= STATION_REACH,
      `a table ${d} east measures ${centreDist(d).toFixed(2)} against STATION_REACH=${STATION_REACH}`)
  }
  // and the boundary is real, not vacuous: some of those are in and some are out
  assert.ok(ready(3) && !ready(4), 'the fixture must straddle the bound')
})

test('readyFor never throws on a broken world', () => {
  // It runs every decision. An exception here costs the bot its turn.
  const bot = { inventory: { items () { throw new Error('boom') } } }
  assert.doesNotThrow(() => readyFor(bot, { id: 'craft_x_1#7', wants: 'x' }))
})

test('the hook is wired and emits a liveness counter', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const src = fs.readFileSync(path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cognitive.mjs'), 'utf8')
  const exec = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(exec, /const order = orderFor\(readyFor\(this\.bot, milestone\)\)/)
  assert.match(exec, /kind: 'work_order'/, 'it must be observable or it can ship inert')
  // Synthesised as a PROPOSAL so admission still vets it and the outcome still
  // feeds noteAttempt -- bypassing those would let a bot loop forever on an
  // impossible rung through a new door.
  assert.match(exec, /const res = order\s*\n?\s*\?\s*\{ schemaValid: true/,
    'the order goes through the normal proposal path')
})

// --- MUTANTS ----------------------------------------------------------------
//
// withMutant, verbatim from bots/test/bootstrap-table.test.mjs:260. It writes a
// SEPARATE _mutant-*.mjs and never touches src/ -- run-tests.mjs kills a slow
// file with SIGKILL, which is uncatchable, so an in-place mutant survives on
// disk and fleet-recycle deploys it within six hours.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const WORKORDER_PATH = new URL('../src/workorder.mjs', import.meta.url)

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

test('MUTANT KILLED: ordering the OUTPUT of a smelt rung', async () => {
  await withMutant(WORKORDER_PATH,
    "return { skill: 'smelt', args: { item: smeltInput, count: 1 },",
    "return { skill: 'smelt', args: { item: wants, count: 1 },",
    mod => {
      const o = mod.orderFor({ id: 'smelt_iron_ingot_3#400', wants: 'iron_ingot',
                               smeltReady: true, smeltInput: 'raw_iron' })
      assert.notEqual(o.args.item, 'raw_iron', 'the mutant must actually differ')
    })
})

test('MUTANT KILLED: dispatching a rung the bot cannot perform', async () => {
  // The whole safety property. Without the readiness check this is a bot that
  // calls `craft` every 30s forever on a rung it has no materials for, and
  // never reaches the LLM to do anything else.
  await withMutant(WORKORDER_PATH, 'if (c && craftReady) {', 'if (c) {',
    mod => assert.notEqual(
      mod.orderFor({ id: 'craft_stone_pickaxe_1#351', wants: 'stone_pickaxe', craftReady: false }),
      null, 'the mutant must actually differ'))
})

test('MUTANT KILLED: a placed crafting table stops counting', async () => {
  await withMutant(WORKORDER_PATH,
    'craftReady = !!def && (bot.recipesFor(def.id, null, 1, near ? true : null) ?? []).length > 0',
    'craftReady = !!def && (bot.recipesFor(def.id, null, 1, carried ? true : null) ?? []).length > 0',
    mod => {
      let asked = null
      const bot = {
        inventory: { items: () => [{ name: 'cobblestone', count: 20 }] },
        registry: { itemsByName: { stone_pickaxe: { id: 889 } }, blocks: { 7: { name: 'crafting_table' } } },
        findBlock: ({ matching }) => matching({ type: 7 }) ? { type: 7 } : null,
        recipesFor: (id, m, n, table) => { asked = table; return table ? [{ id }] : [] },
      }
      const r = mod.readyFor(bot, { id: 'craft_stone_pickaxe_1#351', wants: 'stone_pickaxe' })
      assert.equal(asked, null, 'the mutant must actually differ')
      assert.equal(r.craftReady, false)
    })
})

test('MUTANT KILLED: not stripping the cycle suffix (the v1 bug, exactly)', async () => {
  await withMutant(WORKORDER_PATH,
    "export const rungId = id => String(id ?? '').replace(CYCLE_SUFFIX, '')",
    "export const rungId = id => String(id ?? '')",
    mod => assert.equal(
      mod.orderFor({ id: 'craft_iron_pickaxe_1#351', wants: 'iron_pickaxe', craftReady: true }),
      null, 'the mutant must actually differ -- this is what shipped inert'))
})

test('MUTANT KILLED: reach widened back to the search radius (the no_path bug)', async () => {
  await withMutant(WORKORDER_PATH,
    '    maxDistance: Math.ceil(STATION_REACH) + 1,\n  })\n  if (!b?.position?.offset) return false\n  return bot.entity.position.distanceTo(b.position.offset(0.5, 0.5, 0.5)) <= STATION_REACH',
    '    maxDistance: 32,\n  })\n  if (!b?.position?.offset) return false\n  return true',
    mod => {
      const bot = botWithTable(12)
      assert.equal(mod.readyFor(bot, { id: 'craft_stone_pickaxe_1#351', wants: 'stone_pickaxe' }).craftReady,
        true, 'the mutant must actually differ -- this is exactly what shipped')
    })
})
