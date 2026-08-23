// TEN HOURS ENTOMBED WITH THE ANSWER IN ITS POCKETS.
//
// isolated-a-Alpha lost its pickaxe at y=-4 at 05:03 and was still sealed at y=2
// ten hours later, carrying:
//
//     cobbled_deepslate 24,  stick 6,  crafting_table 99
//
// A stone pickaxe costs 3 cobblestone-family blocks and 2 sticks, and
// minecraft-data confirms cobbled_deepslate is accepted for 1.21.8 stone tools.
// The bot could have dug itself out at any moment. Instead it failed, over and
// over, to craft the WOODEN pickaxe its milestone named -- because wood is on the
// surface, and the surface needs a pickaxe.
//
// The lesson was already written down in this repo, one function away, under
// M.travel: "A fixed coordinate can be genuinely unreachable ... and then the
// milestone can never complete and the bot loops on it forever. Rewarding
// displacement lets any workable route count."
//
// Craft never got the same treatment. A tool is a CAPABILITY, not an item name.
import assert from 'node:assert'
import { equivalentTools } from '../src/skills.mjs'
import { countItem } from '../src/state.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const botWith = (inv) => ({ inventory: { items: () =>
  Object.entries(inv).map(([name, count], slot) => ({ name, count, slot })) } })

t('a better tool of the same kind counts', () => {
  const alts = equivalentTools('wooden_pickaxe')
  for (const better of ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe']) {
    assert.ok(alts.includes(better), `${better} should satisfy a wooden_pickaxe goal`)
  }
})

t('a WORSE tool does not', () => {
  const alts = equivalentTools('iron_pickaxe')
  assert.ok(!alts.includes('wooden_pickaxe'), 'wood cannot stand in for iron')
  assert.ok(!alts.includes('stone_pickaxe'), 'stone cannot stand in for iron')
  assert.ok(alts.includes('diamond_pickaxe'))
})

t('a different KIND of tool never counts', () => {
  const alts = equivalentTools('wooden_pickaxe')
  assert.ok(!alts.some(a => a.endsWith('_axe') && !a.endsWith('_pickaxe')),
    'an axe is not a pickaxe, however good it is')
  assert.ok(!alts.some(a => a.endsWith('_sword')))
  assert.ok(!alts.some(a => a.endsWith('_shovel')))
})

t('the KIND is preserved, not just the tier', () => {
  // The discriminating case for the kind, which the pickaxe-only test above
  // cannot see: a mutation hardcoding the kind to "pickaxe" survived every
  // assertion in this file until this one existed.
  const axes = equivalentTools('wooden_axe')
  assert.ok(axes.includes('stone_axe'), 'a wooden_axe goal wants better AXES')
  assert.ok(!axes.some(a => a.endsWith('_pickaxe')), 'a pickaxe is not an axe')
  const swords = equivalentTools('stone_sword')
  assert.ok(swords.includes('iron_sword'))
  assert.ok(!swords.some(a => a.endsWith('_pickaxe') || a.endsWith('_axe')))
})

t('gold and wood are interchangeable, because they mine the same tiers', () => {
  // My first version of this test asserted the OPPOSITE -- that gold should not
  // satisfy a wooden goal, on the grounds that gold has worse durability. That
  // reasoning recreates the exact trap being fixed here. The wooden pickaxe
  // exists in the ladder to unlock cobblestone; a golden one does that too. A
  // milestone that rejects a working pickaxe because of its material is a
  // milestone that can strand a bot holding a working pickaxe.
  assert.ok(equivalentTools('wooden_pickaxe').includes('golden_pickaxe'))
  assert.ok(equivalentTools('golden_pickaxe').includes('wooden_pickaxe'))
  // But neither unlocks what stone does, so stone is still an upgrade over both.
  assert.ok(equivalentTools('golden_pickaxe').includes('stone_pickaxe'))
  assert.ok(!equivalentTools('stone_pickaxe').includes('golden_pickaxe'))
})

t('non-tools are unaffected', () => {
  assert.deepEqual(equivalentTools('oak_planks'), [])
  assert.deepEqual(equivalentTools('crafting_table'), [])
  assert.deepEqual(equivalentTools(''), [])
  assert.deepEqual(equivalentTools(undefined), [])
})

// --- the milestone predicate, which is what actually trapped the bot ---------

const craftDone = (item, n, bot) =>
  countItem(bot, item) + equivalentTools(item)
    .reduce((tot, alt) => tot + countItem(bot, alt), 0) >= n

t('holding a stone pickaxe satisfies "craft a wooden pickaxe"', () => {
  assert.equal(craftDone('wooden_pickaxe', 1, botWith({ stone_pickaxe: 1 })), true,
    'this exact refusal is what kept a bot underground for ten hours')
})

t('holding nothing still does not satisfy it', () => {
  assert.equal(craftDone('wooden_pickaxe', 1, botWith({ cobbled_deepslate: 24, stick: 6 })), false,
    'the MATERIALS for a pickaxe are not a pickaxe — the goal must stay unmet ' +
    'until the tool exists, or the bot never makes it')
})

t('a worse tool does not satisfy a better goal', () => {
  assert.equal(craftDone('iron_pickaxe', 1, botWith({ stone_pickaxe: 3 })), false)
})

t('counts are still counts', () => {
  assert.equal(craftDone('wooden_pickaxe', 2, botWith({ wooden_pickaxe: 1 })), false)
  assert.equal(craftDone('wooden_pickaxe', 2, botWith({ wooden_pickaxe: 1, iron_pickaxe: 1 })), true)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
