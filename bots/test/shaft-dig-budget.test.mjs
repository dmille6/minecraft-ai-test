// THE SHAFT DIG IS PRICED WHERE THE BOT IS, AND A PICKAXE IN HAND IS NOT A MISSING PICKAXE.
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { shaftDigBudget, climbPrerequisite, climbAdvice } from '../src/skills.mjs'
import { MIN_DIG_MS } from '../src/digbudget.mjs'
const require_ = createRequire(import.meta.url)
const registry = require_('prismarine-registry')('1.21.8'); const Block = require_('prismarine-block')(registry)
const rblock = name => Block.fromStateId(registry.blocksByName[name].defaultState, 0)
const pick = name => ({ name, type: registry.itemsByName[name].id, count: 1, enchants: [] })
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const stone = rblock('stone'); const wooden = pick('wooden_pickaxe')
const grounded = { notOnGround: false, inWater: false, enchantments: [], effects: undefined }
const delta = { notOnGround: true, inWater: true, enchantments: [], effects: undefined }   // hive-a-Delta: airborne, head in water

t('hive-a-Delta: stone with a wooden pickaxe, airborne in water, is never refused and gets far more than the 15 s floor', () => {
  const b = shaftDigBudget(stone, wooden, delta)
  assert.equal(b.refuse, false)
  assert.ok(b.hardnessMs < 3000, `hardness priced grounded with the tool: ${b.hardnessMs}`)
  assert.ok(b.actualMs > 15000, `the real swing is 25x slower: ${b.actualMs}`)
  assert.ok(b.budgetMs >= b.actualMs * 1.5, `budget ${b.budgetMs} covers the actual ${b.actualMs}`)
  assert.ok(b.budgetMs > MIN_DIG_MS * 2, 'the old grounded budget would have expired')
})
t('grounded stone with a wooden pickaxe keeps the floor budget; bare-handed obsidian is still refused', () => {
  const b = shaftDigBudget(stone, wooden, grounded)
  assert.equal(b.refuse, false); assert.equal(b.budgetMs, MIN_DIG_MS)
  assert.equal(shaftDigBudget(rblock('obsidian'), null, grounded).refuse, true, 'hardness refusal is unchanged')
  assert.equal(shaftDigBudget(rblock('obsidian'), null, delta).refuse, true, 'the situation never rescues a hardness refusal')
})
t('a dig that failed WITH a pickaxe in hand asks for no pickaxe; by hand it still does', () => {
  assert.equal(climbPrerequisite('dig failed on stone with wooden_pickaxe: Digging aborted'), null)
  assert.equal(climbPrerequisite('dig failed on stone with wooden_pickaxe: dig exceeded 15000ms'), null)
  assert.equal(climbPrerequisite('dig failed on stone by hand: dig exceeded 15000ms')?.items?.[0], 'wooden_pickaxe')
  assert.equal(climbPrerequisite('cannot break obsidian by hand')?.items?.[0], 'wooden_pickaxe')
  assert.match(climbAdvice('dig failed on stone with wooden_pickaxe: Digging aborted'), /cut short with a pickaxe in hand/)
  assert.match(climbAdvice('dig failed on stone by hand: dig exceeded 15000ms'), /needs a pickaxe/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
