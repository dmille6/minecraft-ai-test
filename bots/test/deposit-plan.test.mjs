// THE DEPOSIT HANDS OVER THE PLAN, NOT THE INVENTORY: tools, scaffold and stations stay; iron goes first.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { depositPlan, DEPOSIT_ALWAYS, scaffoldKeep, isScaffoldItem, RESERVE_RECIPE } from '../src/bankable.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const BANKSRC = readFileSync(new URL('../src/bankable.mjs', import.meta.url), 'utf8')
const { PATHFINDER_SCAFFOLD } = await import('../src/scaffold.mjs')
const SCAFFOLD = new Set(PATHFINDER_SCAFFOLD)
const inv = [
  { name: 'cobblestone', count: 64, type: 1 }, { name: 'cobblestone', count: 40, type: 1 }, { name: 'stone_pickaxe', count: 1, type: 2 }, { name: 'iron_pickaxe', count: 1, type: 3 },
  { name: 'furnace', count: 2, type: 4 }, { name: 'crafting_table', count: 1, type: 5 }, { name: 'raw_iron', count: 9, type: 6 },
  { name: 'oak_log', count: 12, type: 7 }, { name: 'bucket', count: 1, type: 8 }, { name: 'leaf_litter', count: 30, type: 9 },
]
t('the only pickaxe of a family, the stations, the bucket and the junk are never in the plan', () => {
  const names = depositPlan(inv).map(p => p.name)
  for (const keep of ['furnace', 'crafting_table', 'bucket', 'leaf_litter']) assert.ok(!names.includes(keep), `${keep} must stay`)
  assert.ok(!names.includes('iron_pickaxe') && !names.includes('stone_pickaxe'), 'one pickaxe of each family is kept (there is one of each)')
})
t('a second pickaxe of the same family is banked; the cobble reserve of 64 stays (the cobble rule, stonecap)', () => {
  const plan = depositPlan([...inv, { name: 'stone_pickaxe', count: 1, type: 2 }])
  assert.equal(plan.find(p => p.name === 'stone_pickaxe')?.count, 1, 'the spare pickaxe goes, the working one stays')
  assert.equal(plan.find(p => p.name === 'cobblestone')?.count, 40, '104 held in [64, 40]: the whole 40 goes, 64 kept')
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
  // (2026-10-03, chest-full) the whole function, to its closing brace: a fixed-length window ran out as it grew.
  const s = c.indexOf('async function deposit('); const f = c.slice(s, c.indexOf('\n}\n', s))
  // THE ANCHOR MOVED 2026-09-23 and the invariant did not. The snapshot is taken
  // one line earlier (`planItems`) so the refusal sentence and the transfer read
  // the SAME inventory -- computing bankability twice is what got the previous
  // deposit patch refused in review. What is pinned here is unchanged: `plan`
  // comes from depositPlan, and the raw-inventory mutant is still caught.
  assert.match(f, /planItems = bot\.inventory\.items\(\)/, 'the snapshot the plan and the refusal share')
  // (2026-10-07, peacefulkit) the plan also carries the peaceful kit's ONE reading of the switch (`swords`), which the tool
  // transfer below reuses, so plan and transfer cannot disagree.
  assert.match(f, /const plan = depositPlan\(planItems, item, \{ wants: bot\.currentWants \?\? \[\], noSwords \}\)/, 'the loop is driven by the plan, with the wants admission judged with')
  assert.ok(!/for \(const it of bot\.inventory\.items\(\)\) \{\s*check\(signal\)\s*if \(item && it\.name !== item\) continue/.test(f), 'the old everything loop is gone')
  const anchor = 'const plan = depositPlan(planItems, item, { wants: bot.currentWants ?? [], noSwords })'
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, "const plan = planItems.map(it => ({ name: it.name, count: it.count }))")
  assert.ok(!bad.includes(anchor))
})

t('one station and one bucket stay even when they are wanted; the second copy goes', () => {
  const two = [{ name: 'furnace', count: 2, type: 4 }, { name: 'crafting_table', count: 1, type: 5 }, { name: 'bucket', count: 1, type: 8 }]
  const plan = depositPlan(two, null, { wants: ['furnace', 'crafting_table', 'bucket'] })
  assert.deepEqual(plan, [{ name: 'furnace', count: 1 }], 'the spare furnace goes; the only table and bucket stay')
})


// (2026-10-03) The source-text test that stood here -- "the alternates are tried before crafting" -- is replaced by
// behaviour in chest-full.test.mjs: another town container WITH ROOM is used before anything is placed, an unreadable
// one defers, and a carried chest is placed before any craft. It pinned the unconditional craft that was the defect.


// ---------------------------------------------------------------------------
// A DEPOSIT MUST NOT STRIP THE PATHFINDER OR THE PICKAXE (added 2026-09-26)
//
// STANDING_TARGETS banks oak_log, birch_log, jungle_log, oak_planks and stick, and the old
// reserve tested only /cobblestone|cobbled_deepslate|stone|dirt/. Those logs and planks are
// PATHFINDER_SCAFFOLD -- what mineflayer bridges and towers with -- and scaffold.mjs records
// that 16.2% of bots hold wood and nothing else A* will accept. 817 of 819 deposit
// skill_error rows in 24 h are pathfinder prose, so a deposit that SUCCEEDS strips what the
// next one needs to walk. And milestones gates the stone_pickaxe rung on
// `stick >= 2 || planks >= 2`; 874 sticks went into chests in 24 h and 0 came out.
t('the reserve is a TOTAL, spent on the cheapest scaffold -- not 8 of every family', () => {
  const k = scaffoldKeep({ cobblestone: 40, oak_log: 12, oak_planks: 6 }, 8)
  assert.equal(Object.values(k).reduce((a, b) => a + b, 0), 8, 'a total of 8, not 24')
  assert.equal(k.cobblestone, 8, 'spent on the cheapest scaffold present')
  assert.ok(!k.oak_log, 'so the logs stay bankable and deposit still does its job')
})

t('a WOOD-ONLY bot keeps wood -- the 16.2% case A* cannot bridge without', () => {
  assert.equal(scaffoldKeep({ oak_log: 12 }, 8).oak_log, 8)
  assert.equal(scaffoldKeep({ oak_planks: 20 }, 8).oak_planks, 8)
  assert.equal(scaffoldKeep({ oak_log: 3 }, 8).oak_log, 3, 'never more than it holds')
})

t('the ORIGINAL stone-family reserve survives -- cobblestone is not in the scaffold set', () => {
  assert.ok(!SCAFFOLD.has('cobblestone'),
    'if this becomes true the union in isScaffoldItem stops being load-bearing')
  assert.ok(isScaffoldItem('cobblestone'), 'and the regex arm is what covers it')
  assert.equal(scaffoldKeep({ cobblestone: 40 }, 8).cobblestone, 8)
  assert.equal(scaffoldKeep({ stone: 40 }, 8).stone, 8)
  assert.equal(scaffoldKeep({ cobbled_deepslate: 40 }, 8).cobbled_deepslate, 8)
})

t('stick is a RECIPE reserve: small, separate, and not part of the scaffold budget', () => {
  assert.equal(RESERVE_RECIPE, 2, 'a stone pickaxe costs two sticks')
  const k = scaffoldKeep({ cobblestone: 40, stick: 9 }, 8)
  assert.equal(k.stick, 2, 'do not hoard eight sticks; they are not scaffold')
  assert.equal(k.cobblestone, 8, 'and the scaffold budget is untouched by it')
  assert.equal(scaffoldKeep({ stick: 1 }, 8).stick, 1, 'never more than held')
})

t('nothing else is reserved, and dirt was always unreachable', () => {
  for (const n of ['coal', 'raw_iron', 'iron_ingot', 'diamond', 'cooked_beef']) {
    assert.ok(!isScaffoldItem(n), n + ' is not scaffold')
  }
  assert.ok(!isScaffoldItem('dirt'), 'dirt is not in STANDING_TARGETS, so the old branch was dead')
  assert.equal(Object.keys(scaffoldKeep({ cobblestone: 40 }, 0)).length, 0, 'reserveScaffold=0 disables it')
})

t('MUTANT: making the reserve per-item again is caught', () => {
  const anchor = '      const take = Math.min(budget, counts[name] ?? 0)\n'
  assert.ok(BANKSRC.includes(anchor), 'ANCHOR MISSING')
  assert.equal(BANKSRC.split(anchor).length - 1, 1, 'ANCHOR NOT UNIQUE')
  const mutant = BANKSRC.replace(anchor, '      const take = Math.min(reserveScaffold, counts[name] ?? 0)\n')
  assert.ok(!mutant.includes('Math.min(budget, counts[name]'),
    'the mutant must drop the shared budget, which is what makes it a TOTAL')
})

t('MUTANT: dropping the regex arm un-reserves cobblestone', () => {
  const anchor = "  return SCAFFOLD_SET.has(name) || /^(cobblestone|cobbled_deepslate|stone)$/.test(name)"
  assert.ok(BANKSRC.includes(anchor), 'ANCHOR MISSING')
  assert.equal(BANKSRC.split(anchor).length - 1, 1, 'ANCHOR NOT UNIQUE')
  const mutant = BANKSRC.replace(anchor, '  return SCAFFOLD_SET.has(name)')
  assert.ok(!mutant.includes('cobbled_deepslate|stone)$/.test(name)'),
    'and cobblestone would then be unreserved -- the regression this union prevents')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
