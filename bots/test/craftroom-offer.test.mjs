// craftroom-02: CAN CRAFT NOW stops advertising a craft the bag has no slot for, and names it as needing room instead.
//
// Behaviour: the REAL craftableNow over a fake bot with the real 1.21.8 registry and a recipe whose delta is the real one
// (2 sticks + 3 cobblestone -> stone_pickaxe): full bag -> not advertised, named under NO ROOM TO CRAFT with remedies;
// one free slot / an ingredient stack the craft empties -> advertised; the switch off -> advertised as before; an
// unreadable recipe -> advertised (the skill judges it). Anchored mutants.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-craftroom-offer'
process.env.BOT_NAME = process.env.BOT_NAME || 'RoomBot'
process.env.LOG_LEVEL = 'error'
delete process.env.CRAFTROOM_OFFER

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const P = await import('../src/prompt.mjs')
const SRC = new URL('../src/', import.meta.url)
const id = n => mcData.itemsByName[n].id
// the real stone_pickaxe recipe's delta: -3 cobblestone, -2 stick, +1 stone_pickaxe
const PICK = { delta: [{ id: id('cobblestone'), count: -3 }, { id: id('stick'), count: -2 }, { id: id('stone_pickaxe'), count: 1 }], requiresTable: true }
const item = (name, count, slot) => ({ name, count, slot, stackSize: mcData.itemsByName[name]?.stackSize ?? 64 })
// 36 occupied slots: cobble stacks and sticks that a pickaxe craft does not empty, plus filler
function bag ({ free = 0, sticks = 8 } = {}) {
  const out = [item('cobblestone', 64, 9), item('stick', sticks, 10), item('crafting_table', 1, 11)]
  let s = 12
  const filler = ['dirt', 'andesite', 'diorite', 'granite', 'gravel', 'oak_log', 'birch_log', 'sand', 'tuff', 'cobbled_deepslate', 'oak_sapling', 'apple']
  while (out.length < 36 - free) out.push(item(filler[out.length % filler.length], 64, s++))
  return out
}
const botWith = (items, { recipes = () => [PICK] } = {}) => ({
  registry: mcData, inventory: { items: () => items }, entity: { position: { y: 64 } },
  recipesFor: itId => (itId === id('stone_pickaxe') ? recipes() : []), findBlock: () => null,
})
const withEnv = async (v, fn) => {
  const was = process.env.CRAFTROOM_OFFER
  if (v == null) delete process.env.CRAFTROOM_OFFER; else process.env.CRAFTROOM_OFFER = v
  try { return await fn() } finally { if (was == null) delete process.env.CRAFTROOM_OFFER; else process.env.CRAFTROOM_OFFER = was }
}
async function withMutant (file, pairs, fn) {
  let src = readFileSync(new URL(file, SRC), 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 80))}`)
    assert.equal(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 80))}`)
    src = src.replace(old, neu)
  }
  const out = new URL(`./_mutant-craftroom-offer-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`)) } finally { try { unlinkSync(out) } catch {} }
}

test('FULL BAG: the pickaxe is not advertised; it is named as needing room, with remedies the bot can perform', () => {
  const line = P.craftableNow(botWith(bag()))
  assert.doesNotMatch(line, /CAN CRAFT NOW:.*stone_pickaxe/, line)
  assert.match(line, /NO ROOM TO CRAFT: stone_pickaxe -- the bag has no free slot .*place a block you carry, or deposit at the town chest/)
})
test('ROOM: one free slot -> advertised; an ingredient stack the craft empties (2 sticks) -> advertised (the slot it frees)', () => {
  assert.match(P.craftableNow(botWith(bag({ free: 1 }))), /^CAN CRAFT NOW: stone_pickaxe/)
  const emptied = P.craftableNow(botWith(bag({ sticks: 2 })))
  assert.match(emptied, /^CAN CRAFT NOW: stone_pickaxe/, 'the sticks stack leaves first and the pickaxe takes its slot')
  assert.doesNotMatch(emptied, /NO ROOM/)
})
test('UNKNOWN FITS: a recipe with no readable delta is advertised as before (the craft skill judges it)', () => {
  assert.match(P.craftableNow(botWith(bag(), { recipes: () => [{}] })), /^CAN CRAFT NOW: stone_pickaxe/)
  assert.equal(P.offerFits(bag(), mcData, null, 'stone_pickaxe'), true)
})
test('SWITCH: CRAFTROOM_OFFER=0 advertises it on a full bag, exactly as the base did', async () => {
  assert.equal(P.craftOfferRoomOn({}), true); assert.equal(P.craftOfferRoomOn({ CRAFTROOM_OFFER: '0' }), false)
  await withEnv('0', () => assert.match(P.craftableNow(botWith(bag())), /^CAN CRAFT NOW: stone_pickaxe/))
})
test('MUTANT: the room gate removed -> the FULL BAG test sees the pickaxe advertised', async () => {
  await withMutant('prompt.mjs', [['if (roomGate && !offerFits(items, bot.registry, r[0], name))', 'if (false)']], async (M) => {
    assert.match(M.craftableNow(botWith(bag())), /CAN CRAFT NOW:.*stone_pickaxe/, 'the FULL BAG test kills this mutant')
  })
})
test('MUTANT: offerFits ignores the stack the craft empties -> the ROOM test sees it withheld', async () => {
  await withMutant('prompt.mjs', [["    return room.ok || room.reason !== 'no_room'\n", "    return room.ok && room.before < 36\n"]], async (M) => {
    assert.doesNotMatch(M.craftableNow(botWith(bag({ sticks: 2 }))), /^CAN CRAFT NOW: stone_pickaxe/, 'the ROOM test kills this mutant')
  })
})
