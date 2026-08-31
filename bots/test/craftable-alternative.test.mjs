// "YOU CAN CRAFT golden_pickaxe RIGHT NOW FROM WHAT YOU CARRY" -- 17,523 TIMES,
// TO BOTS WITH NO GOLD.
//
// `craftableAlternative` exists to break exactly one trap: a bot sealed
// underground is told "gather oak_log first", cannot, and proposes it forever.
// When the named tool is unmakeable, it looks for one of the same KIND that is
// makeable and names that instead.
//
// It asked `recipesAll`, which returns every recipe that exists for an item and
// never consults the inventory. `recipesFor` is the one that checks -- mineflayer
// craft.js:203 (recipesFor, calls requirementsMetForRecipe) against :214
// (recipesAll, checks only whether a table is available). The function even
// built a `have` map of the inventory and then never read it: the intent
// showing through the defect.
//
// So the advice was always the FIRST alternative in rank order, craftable or
// not. golden_pickaxe shares wooden's mining rank, so for a bot that asked for a
// wooden pickaxe it came first every time -- and gold is the one metal nothing
// underground yields without smelting, which this fleet has never done.
//
// Over the block: 17,523 golden_pickaxe and 6,973 iron_pickaxe suggestions out
// of 24,764 -- 98.9% impossible -- concentrated on the frozen bots
// (hive-b-Echo 1,959, isolated-a-Alpha 885).
//
// isolated-a-Alpha is the bot this function was written FOR. The comment above
// TOOL_RANK names it. It sat at y=2 holding 24 cobbled_deepslate and 10 sticks
// -- a stone pickaxe, three blocks and two sticks away -- and was told 885 times
// to make gold.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { craftableAlternative, equivalentTools } from '../src/skills.mjs'
const require_ = createRequire(import.meta.url)

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const VERSION = '1.21.8'
const registry = require_('prismarine-registry')(VERSION)
const { Recipe } = require_('prismarine-recipe')(registry)

/**
 * A bot whose recipe methods behave the way mineflayer's really do.
 *
 * Reimplemented from craft.js rather than stubbed, because the entire bug is
 * the DIFFERENCE between these two functions. A fake that made them behave the
 * same could not have caught it.
 */
function botWith (inv) {
  const items = Object.entries(inv).map(([name, count], slot) => ({
    name, count, slot, type: registry.itemsByName[name]?.id,
  }))
  const countOf = id => items.filter(i => i.type === id).reduce((a, i) => a + i.count, 0)
  return {
    registry,
    inventory: { items: () => items, count: (id) => countOf(id) },
    // craft.js:214 -- ignores the inventory entirely. THE DEFECT.
    recipesAll: (id, meta, table) =>
      Recipe.find(id, meta).filter(r => !r.requiresTable || table),
    // craft.js:203 -- consults the inventory via requirementsMetForRecipe.
    recipesFor: (id, meta, minResultCount = 1, table) =>
      Recipe.find(id, meta).filter((r) => {
        if (r.requiresTable && !table) return false
        const n = Math.ceil(minResultCount / r.result.count)
        return r.delta.every(d => countOf(d.id) + d.count * n >= 0)
      }),
  }
}

// The inventory isolated-a-Alpha was actually carrying, from its own telemetry
// at 2026-08-31T06:04:12Z.
const ALPHA = {
  brown_egg: 2, oak_sapling: 9, leaf_litter: 2, flint: 2, rail: 1,
  pointed_dripstone: 4, apple: 1, diorite: 6, crafting_table: 98, gravel: 3,
  bamboo: 7, cobbled_deepslate: 24, granite: 7, stick: 10,
}

// --- the ground truth this all rests on -------------------------------------

t('the registry agrees a stone pickaxe is three cobbled_deepslate and two sticks', () => {
  const rs = Recipe.find(registry.itemsByName.stone_pickaxe.id, null)
  const shapes = rs.map(r => Object.fromEntries(
    r.delta.filter(d => d.count < 0).map(d => [registry.items[d.id].name, -d.count])))
  assert.ok(shapes.some(s => s.cobbled_deepslate === 3 && s.stick === 2),
    `cobbled_deepslate is not a stone-tool material in ${VERSION}: ${JSON.stringify(shapes)}`)
  assert.ok(rs.every(r => r.requiresTable), 'a pickaxe needs a 3x3 grid')
})

t('golden_pickaxe needs gold, which nothing underground yields unsmelted', () => {
  const rs = Recipe.find(registry.itemsByName.golden_pickaxe.id, null)
  const need = Object.fromEntries(
    rs[0].delta.filter(d => d.count < 0).map(d => [registry.items[d.id].name, -d.count]))
  assert.equal(need.gold_ingot, 3, JSON.stringify(need))
  assert.ok(!('gold_ingot' in ALPHA), 'the bot in question carried no gold')
})

t('golden_pickaxe is offered BEFORE stone_pickaxe, which is why it mattered', () => {
  // Not a defect on its own -- gold and wood mine the same tiers, so gold is a
  // legitimately cheaper answer when it is available. It is only fatal in
  // combination with never checking whether it IS available.
  const alts = equivalentTools('wooden_pickaxe')
  assert.ok(alts.indexOf('golden_pickaxe') < alts.indexOf('stone_pickaxe'),
    `rank order changed: ${alts}`)
})

// --- the fix ----------------------------------------------------------------

t('isolated-a-Alpha is told to craft the pickaxe it can actually make', () => {
  const advice = craftableAlternative(botWith(ALPHA), 'wooden_pickaxe')
  assert.match(advice, /stone_pickaxe/,
    `the one tool this inventory affords was not offered: ${JSON.stringify(advice)}`)
  assert.doesNotMatch(advice, /golden_pickaxe/,
    'gold was suggested to a bot carrying none')
  assert.doesNotMatch(advice, /iron_pickaxe/,
    'iron was suggested to a fleet that has never smelted an ingot')
})

t('a bot carrying nothing useful is told nothing, not a fantasy', () => {
  // Silence is the correct output here. Inventing a suggestion is how the old
  // version turned a dead end into a dead end the bot trusted.
  const advice = craftableAlternative(botWith({ brown_egg: 2, apple: 1 }), 'wooden_pickaxe')
  assert.equal(advice, '', `expected no advice, got ${JSON.stringify(advice)}`)
})

t('a bot that DOES carry gold is still told about gold', () => {
  const advice = craftableAlternative(botWith({ gold_ingot: 3, stick: 2 }), 'wooden_pickaxe')
  assert.match(advice, /golden_pickaxe/, 'the suggestion must still fire when it is true')
})

t('only tools of the same kind, and never a worse one', () => {
  const bot = botWith({ ...ALPHA, gold_ingot: 3 })
  assert.equal(craftableAlternative(bot, 'iron_pickaxe'), '',
    'stone and gold are worse than iron and must not be offered as substitutes')
  assert.equal(craftableAlternative(bot, 'oak_planks'), '',
    'planks are not a tool; equivalentTools must not match them')
})

t('missing recipe support degrades to silence, not to a throw', () => {
  const bare = { registry, inventory: { items: () => [] } }
  assert.equal(craftableAlternative(bare, 'wooden_pickaxe'), '')
  assert.equal(craftableAlternative({}, 'wooden_pickaxe'), '')
  assert.equal(craftableAlternative(botWith(ALPHA), null), '')
})

// --- THE MUTANT -------------------------------------------------------------

t('MUTANT: recipesAll in place of recipesFor reproduces the golden_pickaxe bug', () => {
  // The mutant is the original line, applied to a bot built from the real
  // registry and the real inventory. It must produce the exact advice the fleet
  // was given 17,523 times.
  const mutant = (bot, item) => {
    for (const alt of equivalentTools(item)) {
      const it = bot.registry?.itemsByName?.[alt]
      if (!it) continue
      const recipes = bot.recipesAll(it.id, null, true)      // <-- the defect
      if (recipes.length) return ` -- BUT you can craft ${alt} right now from what you carry, and it is strictly better; craft that instead.`
    }
    return ''
  }
  const bot = botWith(ALPHA)

  // ANCHOR: the mutant must actually reproduce the observed string. If this
  // assertion ever fails, the mutant is not the bug and its "death" below
  // proves nothing.
  assert.match(mutant(bot, 'wooden_pickaxe'), /golden_pickaxe/,
    'the mutant did not reproduce the original defect; it is testing nothing')

  // KILL: the shipped implementation must disagree with it on this input.
  const real = craftableAlternative(bot, 'wooden_pickaxe')
  assert.doesNotMatch(real, /golden_pickaxe/)
  assert.match(real, /stone_pickaxe/)
  assert.notEqual(real, mutant(bot, 'wooden_pickaxe'))
})

t('MUTANT: dropping the inventory check entirely is caught by the empty bot', () => {
  const mutant = (bot, item) => {
    const alt = equivalentTools(item)[0]
    return alt ? ` -- BUT you can craft ${alt} right now from what you carry, and it is strictly better; craft that instead.` : ''
  }
  const empty = botWith({ brown_egg: 2 })
  assert.match(mutant(empty, 'wooden_pickaxe'), /golden_pickaxe/, 'anchor: the mutant invents advice')
  assert.equal(craftableAlternative(empty, 'wooden_pickaxe'), '', 'the real one stays silent')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
