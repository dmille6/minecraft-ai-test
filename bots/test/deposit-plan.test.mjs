// THE DEPOSIT HANDS OVER THE PLAN, NOT THE INVENTORY: tools, scaffold and stations stay; iron goes first.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { depositPlan, DEPOSIT_ALWAYS } from '../src/bankable.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const inv = [
  { name: 'cobblestone', count: 40, type: 1 }, { name: 'stone_pickaxe', count: 1, type: 2 }, { name: 'iron_pickaxe', count: 1, type: 3 },
  { name: 'furnace', count: 2, type: 4 }, { name: 'crafting_table', count: 1, type: 5 }, { name: 'raw_iron', count: 9, type: 6 },
  { name: 'oak_log', count: 12, type: 7 }, { name: 'bucket', count: 1, type: 8 }, { name: 'leaf_litter', count: 30, type: 9 },
]
t('the only pickaxe of a family, the stations, the bucket and the junk are never in the plan', () => {
  const names = depositPlan(inv).map(p => p.name)
  for (const keep of ['furnace', 'crafting_table', 'bucket', 'leaf_litter']) assert.ok(!names.includes(keep), `${keep} must stay`)
  assert.ok(!names.includes('iron_pickaxe') && !names.includes('stone_pickaxe'), 'one pickaxe of each family is kept (there is one of each)')
})
t('a second pickaxe of the same family is banked; the scaffold reserve of 8 cobblestone stays', () => {
  const plan = depositPlan([...inv, { name: 'stone_pickaxe', count: 1, type: 2 }])
  assert.equal(plan.find(p => p.name === 'stone_pickaxe')?.count, 1, 'the spare pickaxe goes, the working one stays')
  assert.equal(plan.find(p => p.name === 'cobblestone')?.count, 32, '40 held, 8 kept to pillar out')
})
t('the valuable stacks go first, so a short chest keeps the iron', () => {
  const names = depositPlan(inv).map(p => p.name)
  assert.equal(names[0], 'raw_iron'); assert.ok(names.indexOf('oak_log') < names.indexOf('cobblestone'))
})
t('a named item restricts the plan to it EXACTLY, still under the reserve rules', () => {
  assert.deepEqual(depositPlan(inv, 'raw_iron'), [{ name: 'raw_iron', count: 9 }])
  assert.deepEqual(depositPlan(inv, 'iron_pickaxe'), [], 'the only iron pickaxe is not banked even when named')
  assert.deepEqual(depositPlan(inv, 'stone'), [], 'stone does not sweep in cobblestone')
})
t('ores are banked whether or not they are standing targets, and the wants admission judged with are honoured', () => {
  const ore = [...inv, { name: 'iron_ore', count: 32, type: 10 }, { name: 'redstone', count: 4, type: 11 }, { name: 'apple', count: 3, type: 12 }]
  const names = depositPlan(ore).map(p => p.name)
  assert.ok(names.includes('iron_ore') && names.includes('redstone'), 'DEPOSIT_ALWAYS')
  assert.ok(!names.includes('apple'), 'not wanted, not always -> ballast, stays')
  assert.ok(depositPlan(ore, null, { wants: ['apple'] }).map(p => p.name).includes('apple'), 'a wanted item is banked')
  assert.ok(DEPOSIT_ALWAYS.includes('iron_ore'))
})
t('the deposit skill hands over the plan (source anchor) and a mutant that deposits the raw inventory is caught', () => {
  const c = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const s = c.indexOf('async function deposit('); const f = c.slice(s, s + 6000)
  assert.match(f, /const plan = depositPlan\(bot\.inventory\.items\(\), item, \{ wants: bot\.currentWants \?\? \[\] \}\)/, 'the loop is driven by the plan, with the wants admission judged with')
  assert.ok(!/for \(const it of bot\.inventory\.items\(\)\) \{\s*check\(signal\)\s*if \(item && it\.name !== item\) continue/.test(f), 'the old everything loop is gone')
  const anchor = 'const plan = depositPlan(bot.inventory.items(), item, { wants: bot.currentWants ?? [] })'
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, "const plan = bot.inventory.items().map(it => ({ name: it.name, count: it.count }))")
  assert.ok(!bad.includes(anchor))
})

t('one station and one bucket stay even when they are wanted; the second copy goes', () => {
  const two = [{ name: 'furnace', count: 2, type: 4 }, { name: 'crafting_table', count: 1, type: 5 }, { name: 'bucket', count: 1, type: 8 }]
  const plan = depositPlan(two, null, { wants: ['furnace', 'crafting_table', 'bucket'] })
  assert.deepEqual(plan, [{ name: 'furnace', count: 1 }], 'the spare furnace goes; the only table and bucket stay')
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
