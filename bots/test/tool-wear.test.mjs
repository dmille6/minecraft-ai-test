import assert from 'node:assert/strict'
import { toolWear, snapshot } from '../src/state.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const bot = { inventory: { items: () => [{ name: 'iron_pickaxe', count: 1, durabilityUsed: 212, maxDurability: 250 }, { name: 'cobblestone', count: 40 }, { name: 'stone_shovel', count: 1, durabilityUsed: 3, maxDurability: 131 }, { name: 'wooden_pickaxe', count: 1 }] }, entity: { position: { x: 0, y: 64, z: 0 } }, health: 20, food: 20 }
t('every tool with durability data is reported with its uses and maximum; blocks and tools without data are not', () => {
  assert.deepEqual(toolWear(bot), { iron_pickaxe: { used: 212, max: 250 }, stone_shovel: { used: 3, max: 131 } })
  assert.deepEqual(toolWear({}), {})
})
t('the snapshot carries it under `tools` and the inventory counts are untouched', () => {
  const s = snapshot(bot)
  assert.deepEqual(s.bot.tools, { iron_pickaxe: { used: 212, max: 250 }, stone_shovel: { used: 3, max: 131 } })
  assert.equal(s.bot.inventory.cobblestone, 40)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
