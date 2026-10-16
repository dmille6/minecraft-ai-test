// A CHEST UNDER A SOLID BLOCK DOES NOT OPEN -- look at the lid before the twenty-second timeout does.
// (lidclear-01, 10-16: the lid's rule moved to lidrule.mjs and its clear to skills.mjs clearChestLid, shared by the
// deposit, the withdraw and the recount; their behaviour is tested in lidclear.test.mjs. This file keeps the deposit's
// order -- the lid, then sneak released, then an open bounded at 8 s with named classes.)
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { chestLidBlocked } from '../src/skills.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
t('a full cube on the lid blocks it; air, water, a slab, a torch and a stair do not', () => {
  assert.equal(chestLidBlocked({ name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }), true)
  assert.equal(chestLidBlocked({ name: 'dirt', boundingBox: 'block' }), true, 'a solid without shapes is assumed full')
  assert.equal(chestLidBlocked({ name: 'air', boundingBox: 'empty' }), false)
  assert.equal(chestLidBlocked({ name: 'water', boundingBox: 'empty' }), false)
  assert.equal(chestLidBlocked({ name: 'stone_slab', boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.5, 1]] }), false)
  assert.equal(chestLidBlocked({ name: 'oak_stairs', boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0.5, 1, 1, 1]] }), false)
  assert.equal(chestLidBlocked(null), false)
})
const depositFn = () => {
  const c = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const s = c.indexOf('async function deposit(')
  assert.ok(s > 0, 'ANCHOR MISSING: async function deposit(')
  return c.slice(s, c.indexOf('\n}\n', s))
}
const LID = "const lc = await clearChestLid(bot, chestBlock.position, { signal, msLeft, by: 'deposit' })"
const OPEN = 'chest = await withTimeout(bot.openContainer(chestBlock), ob.ms'
const order = f => {
  const lid = f.indexOf(LID), open = f.indexOf(OPEN)
  assert.ok(lid > 0 && open > lid, 'the lid is cleared before the open')
  assert.match(f.slice(lid, open), /const ob = bounded\(8_000\)/, 'the open\'s ceiling is 8 s')
  assert.match(f.slice(lid, open), /setControlState\('sneak', false\)/, 'sneak is released before opening')
  assert.match(f.slice(open, open + 900), /failClass: 'container_open'/, 'a failed open is classified')
  assert.match(f.slice(lid, open), /failClass: 'container_blocked'/, 'a blocked lid is classified')
}
t('the deposit clears the lid, releases sneak, and opens the chest under an 8-second budget with a named class', () => order(depositFn()))
t('MUTANT: opening without the lid clear is caught (the anchor present and unique)', () => {
  const f = depositFn()
  assert.equal(f.split(LID).length - 1, 1, 'ANCHOR MISSING or not unique')
  assert.throws(() => order(f.replace(LID, 'const lc = { outcome: \'not_blocked\' }')), /cleared before the open/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
