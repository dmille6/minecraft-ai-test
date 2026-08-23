// THE MODEL CANNOT CHOOSE WHAT IT CANNOT SEE.
//
// The observation carried INVENTORY -- raw names and counts -- and left a 7B
// model to derive recipes from it. isolated-a-Alpha sat entombed at y=2 for TEN
// HOURS carrying exactly this:
//
//     cobbled_deepslate 24    stick 6    crafting_table 99
//
// A stone pickaxe is 3 cobblestone-family blocks plus 2 sticks, and
// cobbled_deepslate qualifies in 1.21.8. It could have dug out at any moment. It
// never tried, and spent those hours failing to craft the WOODEN pickaxe its
// milestone named -- wood being on the surface, the surface needing a pickaxe.
//
// This is the same defect as the water work, twice: swim_to shipped before
// anything told the model it was in water, and then told it to swim without
// saying where. Here the capability existed, the materials were in the bot's
// pockets, and nothing connected the two.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { buildUserPrompt } from '../src/prompt.mjs'
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Recipe } = require_('prismarine-recipe')('1.21.8')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

/** A bot carrying `inv`, with a real inventory-aware recipesFor. */
function botWith (inv) {
  const items = Object.entries(inv).map(([name, count], slot) => ({
    name, count, slot, type: mcData.itemsByName[name]?.id,
  }))
  const held = (id) => items.filter(i => i.type === Number(id)).reduce((t, i) => t + i.count, 0)
  return {
    entity: { position: { x: 633, y: 2, z: 276 } },
    health: 20, food: 20, time: { day: 1, age: 1 },
    inventory: { items: () => items },
    registry: mcData,
    recipesFor: (id, meta, min, table) => Recipe.find(id, meta).filter(r => {
      if (r.requiresTable && !table) return false
      const need = {}
      for (const d of r.delta) if (d.count < 0) need[d.id] = (need[d.id] ?? 0) - d.count
      return Object.entries(need).every(([rid, n]) => held(rid) >= n)
    }),
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    findBlock: () => null,
    findBlocks: () => [],
    entities: {},
    players: {},
  }
}
const promptFor = (inv) => buildUserPrompt({
  bot: botWith(inv), milestone: { describe: 'test', progress: '0/1' },
  memory: { locations: {}, events: [] }, lastOutcome: null,
  trigger: 'test', sentinel: 'x', lessons: [],
}).user

t('THE TEN-HOUR INVENTORY: the way out is named', () => {
  const u = promptFor({ cobbled_deepslate: 24, stick: 6, crafting_table: 99, granite: 7 })
  const line = u.split('\n').find(l => l.startsWith('CAN CRAFT NOW'))
  assert.ok(line, 'no CAN CRAFT line at all — the bot is still on its own')
  assert.match(line, /stone_pickaxe/,
    'the exact tool that would have dug this bot out is still not mentioned')
})

t('it says the crafting table must be placed', () => {
  const u = promptFor({ cobbled_deepslate: 24, stick: 6, crafting_table: 99 })
  assert.match(u, /place it first/i,
    'a 3x3 recipe needs a placed table; carrying one is not enough')
})

t('a bot with nothing gets no line, not an empty one', () => {
  // Prompt budget is real and events are dropped to fit it. A header with
  // nothing after it spends that budget on noise.
  const u = promptFor({ brown_egg: 2 })
  assert.ok(!u.includes('CAN CRAFT NOW'), 'an empty craft line was emitted')
})

t('it lists what is MAKEABLE, not what exists in the recipe book', () => {
  // recipesFor checks requirementsMetForRecipe. If this ever regresses to
  // recipesAll the line becomes a catalogue and stops being advice.
  const u = promptFor({ cobbled_deepslate: 24, stick: 6, crafting_table: 99 })
  const line = u.split('\n').find(l => l.startsWith('CAN CRAFT NOW')) || ''
  assert.ok(!/iron_pickaxe/.test(line),
    'iron_pickaxe listed with no iron — the check is not inventory-aware')
})

t('planks and sticks alone do not conjure a stone pickaxe', () => {
  const u = promptFor({ oak_planks: 8, stick: 4, crafting_table: 1 })
  const line = u.split('\n').find(l => l.startsWith('CAN CRAFT NOW')) || ''
  assert.match(line, /wooden_pickaxe/, 'wood should make a wooden pickaxe')
  assert.ok(!/stone_pickaxe/.test(line), 'no cobblestone, so no stone pickaxe')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
