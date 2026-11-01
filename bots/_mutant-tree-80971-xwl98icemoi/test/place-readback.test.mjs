// A PLACEMENT LANDED WHEN THE CELL CHANGED, NOT WHEN IT BECAME SOLID.
//
// The old read-back was `put.boundingBox === 'empty'` -> not placed, which asks
// whether the new block is SOLID. Every non-solid placeable answers no: saplings,
// torches, every plant. Measured on the fleet over 24 h -- torch 0 successes from
// 16 attempts, while dirt managed 22/26 and crafting_table 13/16. The fleet holds
// 485 saplings a day and could never be credited with planting one.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { placementLanded } from '../src/skills.mjs'
const require_ = createRequire(import.meta.url)
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

t('a non-solid placement LANDS -- this is the whole bug', () => {
  assert.equal(placementLanded({ before: 'air', after: 'oak_sapling' }), true)
  assert.equal(placementLanded({ before: 'air', after: 'birch_sapling' }), true)
  assert.equal(placementLanded({ before: 'air', after: 'torch' }), true)
  assert.equal(placementLanded({ before: 'air', after: 'wall_torch' }), true, 'a torch on a side face becomes wall_torch')
})

t('a solid placement still lands (no regression on what already worked)', () => {
  for (const b of ['dirt', 'crafting_table', 'ladder', 'oak_log', 'tuff_bricks']) {
    assert.equal(placementLanded({ before: 'air', after: b }), true, b)
  }
})

t('nothing placed is still a failure', () => {
  assert.equal(placementLanded({ before: 'air', after: 'air' }), false)
  assert.equal(placementLanded({ before: 'air', after: null }), false)
  assert.equal(placementLanded({ before: 'air', after: undefined }), false)
  assert.equal(placementLanded({}), false)
})

t('an UNCHANGED replaceable cell is a failure -- stricter than the old "not air" test', () => {
  // The target cell is offset off a reference FACE and may legally start as
  // short_grass or snow. `name !== 'air'` alone would have scored these placed.
  assert.equal(placementLanded({ before: 'short_grass', after: 'short_grass' }), false)
  assert.equal(placementLanded({ before: 'snow', after: 'snow' }), false)
  // ...but replacing it really did place something
  assert.equal(placementLanded({ before: 'short_grass', after: 'oak_sapling' }), true)
})

t('GROUND TRUTH: the blocks the fleet places, classified by minecraft-data', () => {
  const mcData = require_('minecraft-data')('1.21.11')
  const empty = ['oak_sapling', 'birch_sapling', 'torch']
  const solid = ['dirt', 'crafting_table', 'ladder']
  for (const n of empty) {
    assert.equal(mcData.blocksByName[n].boundingBox, 'empty', `${n} must be the empty case`)
    assert.equal(placementLanded({ before: 'air', after: n }), true, `${n} must now land`)
  }
  for (const n of solid) {
    assert.equal(mcData.blocksByName[n].boundingBox, 'block', `${n} must be the solid case`)
    assert.equal(placementLanded({ before: 'air', after: n }), true, `${n} must still land`)
  }
})

const SRC = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')

t('the old solidity test is GONE from the place read-back', () => {
  const s = strip(SRC)
  assert.ok(!/put\.boundingBox === 'empty'/.test(s), 'the solidity test must not survive')
  assert.match(s, /if \(!placementLanded\(\{ before: cellBefore, after: put\?\.name \}\)\)/,
    'the read-back must go through the pure function')
  assert.match(s, /const cellBefore = bot\.blockAt\(/, 'the before-cell must be captured')
})

t('MUTANT: reinstating the solidity test is caught', () => {
  const anchor = 'if (!placementLanded({ before: cellBefore, after: put?.name })) {'
  assert.equal(SRC.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const mutant = strip(SRC.replace(anchor, "if (!put || put.name === 'air' || put.boundingBox === 'empty') {"))
  assert.ok(/put\.boundingBox === 'empty'/.test(mutant), 'the mutant must reintroduce it')
  assert.ok(!/if \(!placementLanded\(\{ before: cellBefore/.test(mutant), 'and must fail the wiring assertion')
})

t('MUTANT: dropping the before-capture is caught', () => {
  const anchor = "      const cellBefore = bot.blockAt(ref.position.offset(face.x, face.y, face.z))?.name ?? null\n"
  assert.equal(SRC.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  assert.ok(!/const cellBefore = bot\.blockAt\(/.test(strip(SRC.replace(anchor, ''))))
})

t('MUTANT: making placementLanded always true is caught by behaviour, not by text', () => {
  // The decision is a pure function, so the real mutant is semantic: if it
  // returned true unconditionally, the "nothing placed" test above would fail.
  const alwaysTrue = () => true
  assert.equal(alwaysTrue({ before: 'air', after: 'air' }), true)
  assert.notEqual(placementLanded({ before: 'air', after: 'air' }), alwaysTrue(),
    'placementLanded must NOT be the always-true function')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
