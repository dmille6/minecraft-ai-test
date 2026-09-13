// A DEPOSIT NAMES SOMETHING IN HAND, OR EVERYTHING -- never an item the bot does not hold.
import assert from 'node:assert'
import { depositItemArg, DEPOSIT_WILDCARDS } from '../src/admission.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const inv = [{ name: 'cobblestone', count: 40 }, { name: 'raw_iron', count: 3 }, { name: 'oak_log', count: 12 }]
t('wildcard words mean everything bankable', () => {
  for (const w of ['none', 'null', 'any', '', null, undefined, 'ALL', ' everything ']) assert.deepEqual(depositItemArg(inv, w), { item: null, missing: false }, String(w))
  assert.ok(DEPOSIT_WILDCARDS.has('none'))
})
t('a held item passes through, normalised; matching is EXACT (stone must not admit cobblestone)', () => {
  assert.deepEqual(depositItemArg(inv, 'Raw_Iron'), { item: 'raw_iron', missing: false })
  assert.equal(depositItemArg(inv, 'iron').missing, true, 'a substring of a held name is not a held item')
  assert.equal(depositItemArg([{ name: 'cobblestone', count: 5 }], 'stone').missing, true)
})
t('an item the bot does not hold is missing (the 842 no-effect runs: wheat_seeds, iron_ingot, apple)', () => {
  for (const w of ['wheat_seeds', 'iron_ingot', 'apple']) assert.equal(depositItemArg(inv, w).missing, true, w)
  assert.equal(depositItemArg([], 'cobblestone').missing, true, 'empty inventory')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
