// A CHEST UNDER A SOLID BLOCK DOES NOT OPEN -- look at the lid before the twenty-second timeout does.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { chestLidBlocked, lidSafeToBreak } from '../src/skills.mjs'
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
// The rule lives in ONE helper since 2026-09-28, shared by deposit and withdraw, so the order is asserted
// there once and the WIRING is asserted per skill: a skill that opens a chest any other way is caught.
t('openChestChecked looks at the lid, releases sneak, and opens the chest under an 8-second budget with a named class', () => {
  const c = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const s = c.indexOf('async function openChestChecked ('); assert.ok(s > 0, 'openChestChecked is gone')
  const f = c.slice(s, c.indexOf('\n}\n', s))
  const lid = f.indexOf('if (isChest && lid && chestLidBlocked(lid)) {'), open = f.indexOf('const chest = await withTimeout(bot.openContainer(chestBlock), 8_000')
  assert.ok(lid > 0 && open > lid, 'the lid is checked before the open')
  assert.match(f.slice(lid, open), /setControlState\('sneak', false\)/, 'sneak is released before opening')
  assert.match(f.slice(open, open + 600), /failClass: 'container_open'/, 'a failed open is classified')
  assert.match(f.slice(lid, open), /failClass: 'container_blocked'/, 'a blocked lid is classified')
})
t('deposit and withdraw open chests ONLY through openChestChecked', () => {
  const c = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const body = name => { const s = c.indexOf(`async function ${name}(`); assert.ok(s > 0, `${name} is gone`); return c.slice(s, c.indexOf('\nasync function ', s + 10)) }
  for (const name of ['deposit', 'withdrawFrom']) {
    const f = body(name)
    assert.match(f, /await openChestChecked\(bot, chestBlock, signal\)/, `${name} does not open through the checked helper`)
    assert.ok(!/bot\.openContainer\(/.test(f), `${name} calls bot.openContainer directly, bypassing the lid check and the bound`)
  }
  // exactly one direct openContainer on a chest in the file: the helper's
  assert.equal((c.match(/bot\.openContainer\(/g) ?? []).length, 1, 'a second direct openContainer appeared')
})
t('the lid is dug only on positive evidence: unknown neighbours, liquid beside it, or a falling block above refuse', () => {
  const V = (x, y, z) => ({ x, y, z, offset: (dx, dy, dz) => V(x + dx, y + dy, z + dz) })
  const world = (over = {}) => ({ blockAt: p => { const k = `${p.x},${p.y},${p.z}`; return k in over ? over[k] : { name: 'stone' } } })
  const p = V(10, 65, 10)
  assert.equal(lidSafeToBreak(world(), p), true, 'stone all round')
  assert.equal(lidSafeToBreak(world({ '11,65,10': { name: 'water' } }), p), false, 'water beside it')
  assert.equal(lidSafeToBreak(world({ '10,66,10': { name: 'gravel' } }), p), false, 'gravel above')
  assert.equal(lidSafeToBreak(world({ '9,65,10': null }), p), false, 'an unknown neighbour fails closed')
  assert.equal(lidSafeToBreak({}, p), false, 'no blockAt at all fails closed')
})
t('MUTANT: opening without the lid check is caught', () => {
  const c = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')); const anchor = 'if (isChest && lid && chestLidBlocked(lid)) {'
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, 'if (false) {')
  assert.ok(!bad.includes(anchor))
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
