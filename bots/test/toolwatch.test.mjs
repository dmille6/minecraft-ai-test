import assert from 'node:assert/strict'
import { diffTools } from '../src/toolwatch.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const it = (name, left, slot, max = 250) => ({ name, slot, count: 1, maxDurability: max, durabilityUsed: max - left })
t('a hotbar swap is not a loss; a vanished tool is, and it is `broke` only when it had two or fewer uses left', () => {
  assert.deepEqual(diffTools([it('iron_pickaxe', 40, 3)], [it('iron_pickaxe', 40, 0)]), [])
  assert.deepEqual(diffTools([it('iron_pickaxe', 2, 3)], []), [{ name: 'iron_pickaxe', lost: 1, least: 2, max: 250, broke: true }])
  assert.deepEqual(diffTools([it('iron_pickaxe', 40, 3)], []), [{ name: 'iron_pickaxe', lost: 1, least: 40, max: 250, broke: false }])
})
t('duplicates are reconciled by wear, not collapsed: the spent copy vanishing is a break; the FRESH copy vanishing while the one-use copy survives is not', () => {
  assert.deepEqual(diffTools([it('iron_pickaxe', 1, 3), it('iron_pickaxe', 200, 4)], [it('iron_pickaxe', 200, 4)]), [{ name: 'iron_pickaxe', lost: 1, least: 1, max: 250, broke: true }])
  assert.deepEqual(diffTools([it('iron_pickaxe', 1, 3), it('iron_pickaxe', 200, 4)], [it('iron_pickaxe', 1, 3)]), [{ name: 'iron_pickaxe', lost: 1, least: 200, max: 250, broke: false }])
  assert.deepEqual(diffTools([it('iron_pickaxe', 40, 3)], [it('iron_pickaxe', 38, 3)]), [], 'a copy that wore down two uses is the same copy')
  assert.deepEqual(diffTools([it('iron_pickaxe', 40, 3)], [it('iron_pickaxe', 41, 3)]), [{ name: 'iron_pickaxe', lost: 1, least: 40, max: 250, broke: false }], 'wear cannot fall: a fuller copy is a different copy, so the old one is gone')
})
t('non-tools and unknown durability: cobblestone is ignored; a tool without durability data is never `broke`', () => {
  assert.deepEqual(diffTools([{ name: 'cobblestone', count: 9 }], []), [])
  assert.deepEqual(diffTools([{ name: 'stone_axe', count: 1 }], []), [{ name: 'stone_axe', lost: 1, least: Infinity, max: null, broke: false }])
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
