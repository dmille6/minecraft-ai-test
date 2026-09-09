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
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const raw = fs.readFileSync(path.join(SRC, 'skills.mjs'), 'utf8')
const CODE = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

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

test('storage_full builds a chest instead of only naming one', () => {
  assert.match(CODE, /if \(!noRecovery\) \{[\s\S]{0,400}?craft\(ctx, \{ item: 'chest', count: 1 \}/,
    'it must actually craft the chest')
  assert.match(CODE, /place\(ctx, \{ item: 'chest' \}, signal\)/,
    'and put it down')
})

test('the recovery cannot re-enter itself', () => {
  // A bounded recovery that can re-enter is an unbounded recovery. A bot that
  // can craft but never place would otherwise make a chest per attempt forever.
  // Matches the FLAG, not the whole argument list — the first version pinned
  // the exact call text and broke the moment `preferAt` was added alongside it.
  // An assertion that fails on a correct edit trains you to weaken assertions.
  assert.match(CODE, /deposit\(ctx, \{ item \}, signal, \{[^}]*noRecovery: true/,
    'the retry must disable the recovery path')
  assert.match(CODE, /noRecovery = false[^)]*\} = \{\}\)/,
    'and the guard is a real parameter with a default, not an ambient flag')
})

test('every failure branch still reports storage_full and says what happened', () => {
  // Three distinct ways this can end badly and each must stay countable:
  // could not craft, could not place, placed but still could not bank.
  const branch = CODE.slice(CODE.indexOf('if (!noRecovery)'))
  const classes = branch.match(/failClass: 'storage_full'/g) ?? []
  assert.ok(classes.length >= 3,
    `each failure mode keeps the class — found ${classes.length}`)
  assert.match(branch, /could not make another/, 'the craft failure names itself')
  assert.match(branch, /nowhere to put a new one/, 'and so does the place failure')
})

test('the retry opens the NEW chest, not the full one it just left', () => {
  // Caught by ChatGPT reviewing this change: without it, the retry calls
  // findChest() and gets the NEAREST container -- very often the same full one,
  // because the new chest is placed adjacent to the bot and so is the old one.
  // The recovery would have looked like it ran and changed nothing.
  assert.match(CODE, /preferAt: put\.at/, 'the retry is handed the new chest position')
  assert.match(CODE, /if \(preferAt\) \{[\s\S]{0,200}?isContainer\(b\)\) chestBlock = b/,
    'and deposit prefers that container over the nearest one')
  assert.match(CODE, /placed: 1, at,/,
    'place returns the position structurally — not parsed back out of its prose')
})

test('the old dead-end refusal is gone from the recovery path', () => {
  // The unconditional version must only survive as the noRecovery tail.
  const idx = CODE.indexOf('if (!noRecovery)')
  assert.ok(idx > 0, 'the recovery exists')
  const before = CODE.slice(0, idx)
  assert.ok(!/failClass: 'storage_full'/.test(before),
    'nothing may refuse with storage_full before the remedy has been tried')
})
