// THE CO-PRIMARY ENDPOINT NOBODY ASKED FOR.
//
// "deposited items per bot-hour" is co-primary in the pre-registration. The
// `deposit` skill works -- 107 successes, 4,938 items -- and until now NO
// milestone requested it. The nearest, `return`, is scored on POSITION: a bot
// satisfies it by standing within 15 blocks of home with a full inventory and
// walking away. 647 deposit calls across 1.18M events were the model choosing it
// unprompted.
//
// The obvious fix fails twice on this fleet's measured state. Inventories sit at
// a MEDIAN OF 16 of 36 stacks, so "deposit when full" would never fire. And the
// median distance from town is 804 BLOCKS with only 9% of samples within 100, so
// "walk home and bank" is a six-minute round trip through the travel failures
// that already kill deposits: 156 stuck, 107 drowning, 53 stagnation.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { bankableInventory, depositDue } from '../src/bankable.mjs'
import { buildUserPrompt } from '../src/prompt.mjs'
const mcData = createRequire(import.meta.url)('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const inv = (o) => Object.entries(o).map(([name, count], slot) => ({ name, count, slot }))

// --- what counts -------------------------------------------------------------

t('junk is not banked, however much of it there is', () => {
  // The real inventory of a bot that spent ten hours entombed. Depositing 99
  // crafting tables would inflate a co-primary endpoint without meaning anything.
  const b = bankableInventory(inv({ crafting_table: 99, leaf_litter: 6, brown_egg: 2,
                                    bamboo: 7, oak_sapling: 9 }))
  assert.equal(b.count, 0, `banked ${b.count} items of pure ballast`)
  assert.ok(b.junk > 100)
})

t('real output is banked', () => {
  const b = bankableInventory(inv({ oak_log: 18, cobblestone: 24 }))
  assert.ok(b.count > 20, `expected real output to count, got ${b.count}`)
})

t('THE TOOL IS NOT SURPLUS', () => {
  // Banking your only pickaxe underground is how a bot spends ten hours entombed
  // with the answer in its pockets. One of each family stays.
  const b = bankableInventory(inv({ stone_pickaxe: 1, oak_log: 20 }))
  assert.ok(!('stone_pickaxe' in b.detail), 'the bot banked its only pickaxe')
  const two = bankableInventory(inv({ stone_pickaxe: 3, oak_log: 20 }))
  assert.equal(two.detail.stone_pickaxe, 2, 'spares are surplus; the last one is not')
})

t('the climb-out reserve is not surplus either', () => {
  // Same principle as the descent contract: never bank the exit.
  const b = bankableInventory(inv({ cobblestone: 10 }))
  assert.equal(b.count, 2, `banked ${b.count} of 10 cobblestone; 8 are the way out`)
})

t('one absurd stack cannot dominate the endpoint', () => {
  const b = bankableInventory(inv({ oak_log: 999 }), { creditCap: 64 })
  assert.equal(b.count, 64, 'credit is capped so a hoard cannot game the metric')
})

// --- when it is worth doing ---------------------------------------------------

t('DO NOT WALK 804 BLOCKS TO BANK A HANDFUL', () => {
  // The median bot is 804 blocks from town. This is the clause that stops a
  // co-primary endpoint from being bought with six-minute round trips through
  // the travel failures that already dominate deposit failure.
  assert.equal(depositDue({ bankable: 40, distHome: 804 }), false)
  assert.equal(depositDue({ bankable: 40, distHome: 1566 }), false)
})

t('but bank it when banking is cheap', () => {
  assert.equal(depositDue({ bankable: 40, distHome: 40 }), true, 'already near the chest')
  assert.equal(depositDue({ bankable: 40, distHome: 804, storageWithin48: true }), true,
    'storage in sight costs nothing to use')
  assert.equal(depositDue({ bankable: 40, distHome: 804, onDepositMilestone: true }), true,
    'the bot accepted a deposit goal')
})

t('a trivial surplus is not worth a trip even when close', () => {
  assert.equal(depositDue({ bankable: 3, distHome: 10 }), false)
})

t('a nearly-full pack overrides the surplus threshold', () => {
  // Slots matter independently of value: a bot with no room cannot gather.
  assert.equal(depositDue({ bankable: 3, distHome: 10, occupiedSlots: 32 }), true)
})

// --- the failure I actually shipped and caught -------------------------------

t('THE MILESTONE MUST BE SATISFIABLE WHERE IT CANNOT BE DONE', () => {
  // The first version of deposit_surplus completed only when bankable < 4. A bot
  // carrying surplus with no chest in reach could NEVER complete it, and sat on
  // it for all 60 refreshes of survey.test.mjs, blocking the sustaining chain
  // forever -- the exact failure the note under M.travel warns about, made an
  // hour after I quoted that note.
  //
  // The rung now reads "bank your surplus WHERE YOU CAN", vacuously met where
  // there is no storage. This also survives the town chest being destroyed.
  const src = readFileSync(new URL('../src/milestones.mjs', import.meta.url), 'utf8')
  const i = src.indexOf("id: 'deposit_surplus'")
  const body = src.slice(i, i + 1400)
  assert.ok(/findBlock/.test(body),
    'deposit_surplus can only complete by emptying the pack — it will block forever ' +
    'for any bot that has no chest in reach')
  // NOTE ON COVERAGE: this is a source assertion and it is deliberately the
  // WEAKER of two guards. The real one is survey.test.mjs, which drives the
  // milestone controller for 60 refreshes and fails outright if the chain
  // blocks -- it is what caught this bug in the first place. A mutation
  // replacing `return !chest` with `return false` survives THIS test and is
  // killed by that one.
})

// --- the observation, which is what actually changes behaviour ---------------

const promptWith = (invObj, pos) => {
  const items = Object.entries(invObj).map(([name, count], slot) =>
    ({ name, count, slot, type: mcData.itemsByName[name]?.id }))
  const bot = {
    entity: { position: { ...pos, distanceTo: () => 6 } },
    health: 20, food: 20, time: { day: 1, age: 1 },
    inventory: { items: () => items },
    registry: mcData,
    recipesFor: () => [],
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    findBlock: () => null, findBlocks: () => [], entities: {}, players: {},
  }
  return buildUserPrompt({ bot, milestone: { describe: 't', progress: '0/1' },
    memory: { locations: {}, events: [] }, lastOutcome: null,
    trigger: 't', sentinel: 'x', lessons: [] }).user
}

t('a bot NEAR HOME with surplus is told to bank it', () => {
  // The milestone alone produced ZERO deposits in six bot-hours, because it sits
  // behind `return` and the median bot is 804 blocks from home. The observation
  // is what moved swim behaviour and craft behaviour today; same treatment.
  const u = promptWith({ oak_log: 40, cobblestone: 40 }, { x: 20, y: 64, z: 20 })
  assert.match(u, /CARRYING/, 'no deposit line for a bot standing next to the chest with surplus')
  assert.match(u, /survive your death/, 'the reason to bank is not stated')
})

t('A BOT 800 BLOCKS OUT IS NOT TOLD TO WALK HOME', () => {
  // The whole point of the predicate. Telling a bot to bank from out here is
  // advice it should not take, through the travel failures that already kill
  // most deposit attempts.
  const u = promptWith({ oak_log: 40, cobblestone: 40 }, { x: 900, y: 64, z: 900 })
  assert.ok(!u.includes('CARRYING'), 'the bot was urged to bank from 800+ blocks out')
})

t('a bot carrying only junk is told nothing', () => {
  const u = promptWith({ crafting_table: 99, leaf_litter: 8 }, { x: 20, y: 64, z: 20 })
  assert.ok(!u.includes('CARRYING'), 'ballast was described as worth banking')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
