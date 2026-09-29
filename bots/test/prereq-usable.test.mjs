// A TOOL AT ITS FLOOR IS NOT A TOOL: prerequisite satisfaction counts only copies that can do the work.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-prereq'
const { prereqHave, applyPrereq } = await import('../src/cognitive.mjs')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const pick = (name, left, max = 131) => ({ name, count: 1, maxDurability: max, durabilityUsed: max - left })
const PICKS = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe']
const need = { items: PICKS, count: 1, since: 0, fromSkill: 'surface', describe: 'Get a pickaxe.' }

t('six SPENT pickaxes (1 use each) do not satisfy "get a pickaxe" -- the fleet case, 88% of pickaxe prerequisites', () => {
  assert.equal(prereqHave(Array.from({ length: 6 }, () => pick('stone_pickaxe', 1)), need), 0)
})
t('a pickaxe with 2 uses does (the tool picker would swing it: remaining > HARD_STOP)', () => {
  assert.equal(prereqHave([pick('stone_pickaxe', 1), pick('wooden_pickaxe', 2, 59)], need), 1)
})
t('a task that names minUses raises the bar (the ore tunnel sets it)', () => {
  assert.equal(prereqHave([pick('stone_pickaxe', 30)], { ...need, minUses: 40 }), 0)
  assert.equal(prereqHave([pick('stone_pickaxe', 40)], { ...need, minUses: 40 }), 1)
})
t('non-durable items count by stack size, and unwanted items never count', () => {
  const blocks = { items: ['dirt', 'cobblestone'], count: 8 }
  assert.equal(prereqHave([{ name: 'dirt', count: 5 }, { name: 'cobblestone', count: 4 }, { name: 'stone', count: 64 }], blocks), 9)
})
t('THE CHAIN through applyPrereq: spent-only keeps the detour; a crafted pickaxe clears it as satisfied', () => {
  const milestone = { id: 'gather_iron_ore_3', wants: 'iron_ore' }
  const spent = Array.from({ length: 3 }, () => pick('stone_pickaxe', 1))
  const before = applyPrereq(milestone, need, prereqHave(spent, need), 1)
  assert.equal(before.clear, null); assert.equal(before.task.id, 'gather_iron_ore_3+prereq')
  const after = applyPrereq(milestone, need, prereqHave([...spent, pick('stone_pickaxe', 131)], need), 1)
  assert.equal(after.clear, 'satisfied')
})
t('WIRED: the controller counts through prereqHave (comments stripped)', () => {
  const src = readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(src, /#prereqHave\(\) \{\s*return prereqHave\(this\.bot\.inventory\?\.items\(\) \?\? \[\], this\.prereq\)/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
