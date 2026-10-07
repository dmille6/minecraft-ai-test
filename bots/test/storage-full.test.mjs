// THE CHEST IS FULL AND THE REFUSAL KNEW THE REMEDY WITHOUT PERFORMING IT.
//
// Measured over six hours: 108 `storage_full` refusals across 33 DISTINCT BOTS,
// one of them carrying 806 bankable items. The town chest is 27 slots and there
// are five bots per world, so it fills and then refuses everyone.
//
// The code's own comment said "the remedy is another chest rather than another
// attempt" -- and stopped there. That is this repo's most expensive recurring
// bug: a refusal that names a remedy the bot never takes. A chest is eight
// planks; any bot that can gather wood can make one.
//
// Adding chests by RCON would be changing the world to fix a bot, which is a
// standing prohibition. Teaching a bot to build storage is a capability.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// BEHAVIOUR, NOT SOURCE TEXT (2026-10-03). These tests used to match the recovery's source with regexes -- one of them
// pinned the unconditional `craft(ctx, { item: 'chest' ...})` that was the defect: 75 of 90 full-chest blocks in 24 h
// were bots CARRYING a chest. They now drive deposit through the real skill against fakeworld.mjs.
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-storagefull-logs-'))
process.env.BOT_NAME = 'StorageBot'
// The production watchdog (the recovery's clock is config.skills.defaultTimeoutMs; the runner sets 300 ms for tests).
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
const freshPool = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-storagefull-pool-')) }
freshPool()
const { SKILLS } = await import('../src/skills.mjs')
const { fakeWorld, stack, total } = await import('./fakeworld.mjs')
const run = bot => SKILLS.deposit.run({ bot }, {}, new AbortController().signal)
const town = bag => { freshPool(); const w = fakeWorld({ bag }); w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0); return w }

test('a chest is genuinely craftable from what bots carry', async () => {
  // The remedy has to be performable, not merely nameable. Eight planks.
  const mcd = (await import('minecraft-data')).default('1.21.8')
  const chest = mcd.itemsByName.chest
  assert.ok(chest, 'chest exists in the registry')
  const recipes = mcd.recipes[chest.id] ?? []
  assert.ok(recipes.length > 0, 'and it has a recipe — otherwise the remedy is fiction')
  const shaped = recipes[0]
  const ings = (shaped.ingredients ?? shaped.inShape?.flat() ?? []).filter(x => x != null && x !== -1)
  assert.equal(ings.length, 8, 'eight planks, which is two logs')
})

test('a full town chest and a CARRIED chest: the carried one is put down and the deposit lands in it', async () => {
  const w = town([stack('oak_log', 64), stack('chest', 1)])
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.placed.length, 1)
  assert.equal(w.spy.recipesFor + w.spy.craft, 0, 'nothing crafted')
  assert.equal(w.spy.opened.at(-1), w.spy.placed[0], 'the retry opened the NEW chest, not the full one it just left')
  assert.match(r.detail, /placed the chest it carried/)
})

test('the recovery cannot re-enter itself: a new chest that also takes nothing ends it -- one chest, one claim', async () => {
  const w = town([stack('oak_log', 64), stack('chest', 2)])
  const place = w.bot.placeBlock
  w.bot.placeBlock = async (ref, face) => { await place(ref, face); const k = w.spy.placed.at(-1).split(',').map(Number); w.fill(...k) }
  const r = await run(w.bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'storage_full')
  assert.equal(w.spy.placed.length, 1, 'exactly one chest, though two were carried')
  assert.match(r.detail, /placed a new chest at .* and still could not bank/)
})

test('every failure branch reports storage_full and names what happened', async () => {
  // could not make one: no chest carried, nothing to craft it from
  const a = town([stack('oak_log', 64)])
  const ra = await run(a.bot)
  assert.equal(ra.failClass, 'storage_full'); assert.match(ra.detail, /no chest could be crafted/)
  // could not put it down: every placement is refused and the cell never changes
  const b = town([stack('oak_log', 64), stack('chest', 1)])
  b.bot.placeBlock = async () => { throw new Error('Event blockUpdate did not fire') }
  const rb = await run(b.bot)
  assert.equal(rb.failClass, 'storage_full'); assert.match(rb.detail, /could not be put down/)
  assert.equal(b.bag.find(i => i.name === 'chest').count, 1, 'the chest is still in the bag')
  assert.equal(total(b.bag), 65)
})

test('a LATE ACK is read back before another cell is tried: one chest, never two', async () => {
  const w = town([stack('oak_log', 64), stack('chest', 2)])
  const place = w.bot.placeBlock
  let calls = 0
  w.bot.placeBlock = async (ref, face) => { calls++; setTimeout(() => { place(ref, face) }, 400); throw new Error('Event blockUpdate did not fire') }
  const r = await run(w.bot)
  assert.equal(calls, 1, 'no second cell was tried while the first could still land')
  assert.equal(w.spy.placed.length, 1)
  assert.equal(r.status, 'success', r.detail)
})
