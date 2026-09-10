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
const { orderFor, readyFor } = await import('../src/workorder.mjs')

test('a craft rung whose recipe is satisfiable becomes a craft order', () => {
  const o = orderFor({ id: 'craft_stone_pickaxe_1', wants: 'stone_pickaxe', craftReady: true })
  assert.equal(o.skill, 'craft')
  assert.deepEqual(o.args, { item: 'stone_pickaxe', count: 1 })
})

test('a smelt rung orders the INPUT, never the output', () => {
  // `smelt item=iron_ingot` has no recipe the registry will ever return. The
  // milestone hint says so explicitly, and this project has twice shipped
  // advice naming a move the model cannot make.
  const o = orderFor({ id: 'smelt_iron_ingot_3', wants: 'iron_ingot',
                       smeltReady: true, smeltInput: 'raw_iron' })
  assert.equal(o.skill, 'smelt')
  assert.equal(o.args.item, 'raw_iron', 'the input, not iron_ingot')
})

test('NOT ready means no order — the model still decides', () => {
  assert.equal(orderFor({ id: 'craft_stone_pickaxe_1', wants: 'stone_pickaxe', craftReady: false }), null)
  assert.equal(orderFor({ id: 'smelt_iron_ingot_3', wants: 'iron_ingot', smeltReady: true, smeltInput: null }), null)
})

test('non-conversion rungs are left alone', () => {
  // gather/travel/survey rungs are the model's business. A work order that
  // claimed those would be a planner, and the chain is not one.
  for (const id of ['gather_iron_ore_3', 'stockpile_wood', 'return_home', 'survey_wider']) {
    assert.equal(orderFor({ id, wants: 'anything', craftReady: true, smeltReady: true, smeltInput: 'x' }),
      null, `${id} must not be auto-dispatched`)
  }
})

test('a PREEMPTED rung is not auto-crafted', () => {
  // applyPrereq rewrites the active task to `<id>+prereq` with a different
  // `wants` when a skill reports a missing material. The bot then needs the
  // PREREQ, not the craft, so the anchored rung patterns must decline it --
  // and this is the one place the id arrives in a shape I did not choose.
  assert.equal(orderFor({ id: 'craft_stone_pickaxe_1+prereq', wants: 'cobblestone',
                          craftReady: true }), null)
})

test('a missing milestone yields nothing, never a throw', () => {
  assert.equal(orderFor({}), null)
  assert.equal(orderFor({ id: null, wants: null }), null)
  assert.equal(orderFor(), null)
})

test('readyFor uses the SKILL predicate, and a placed table counts', async () => {
  // The distinction that made the prompt affordance line wrong for weeks: craft
  // resolves prerequisites by PLACING a table, so the commonest state right
  // after a craft is table-on-ground, none-in-pack.
  let askedWithTable = null
  const bot = {
    inventory: { items: () => [{ name: 'cobblestone', count: 20 }, { name: 'stick', count: 4 }] },
    registry: { itemsByName: { stone_pickaxe: { id: 889 } }, blocks: { 7: { name: 'crafting_table' } } },
    findBlock: ({ matching }) => matching({ type: 7 }) ? { type: 7, position: { x: 1, y: 2, z: 3 } } : null,
    recipesFor: (id, meta, n, table) => { askedWithTable = table; return [{ id }] },
  }
  const r = readyFor(bot, { id: 'craft_stone_pickaxe_1', wants: 'stone_pickaxe' })
  assert.equal(r.craftReady, true)
  assert.equal(askedWithTable, true, 'a PLACED table must be offered to recipesFor')
})

test('readyFor never throws on a broken world', () => {
  // It runs every decision. An exception here costs the bot its turn.
  const bot = { inventory: { items () { throw new Error('boom') } } }
  assert.doesNotThrow(() => readyFor(bot, { id: 'craft_x_1', wants: 'x' }))
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
      const o = mod.orderFor({ id: 'smelt_iron_ingot_3', wants: 'iron_ingot',
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
      mod.orderFor({ id: 'craft_stone_pickaxe_1', wants: 'stone_pickaxe', craftReady: false }),
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
      const r = mod.readyFor(bot, { id: 'craft_stone_pickaxe_1', wants: 'stone_pickaxe' })
      assert.equal(asked, null, 'the mutant must actually differ')
      assert.equal(r.craftReady, false)
    })
})
