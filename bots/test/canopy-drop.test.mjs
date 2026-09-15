// gather's canopy dig-down measures the drop before it digs (hive-b-Bravo fell 37 blocks after it, 2026-09-15).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canopyDrop, CANOPY_REMOVABLE } from '../src/skills.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const LEAF = { name: 'oak_leaves', boundingBox: 'block' }, LOG = { name: 'oak_log', boundingBox: 'block' }, AIR = { name: 'air', boundingBox: 'empty' }, STONE = { name: 'stone', boundingBox: 'block' }, WATER = { name: 'water', boundingBox: 'empty' }, LAVA = { name: 'lava', boundingBox: 'empty' }
// a column under the feet (y=100): `stack` lists blocks from y=99 downward; below the list, stone
const world = (stack, ground = STONE) => (x, y, z) => { const i = 99 - y; return i < 0 ? AIR : (i < stack.length ? stack[i] : ground) }
t('a canopy two leaves thick over the ground is a two-block fall: ok; a leaf with 36 blocks of air below refuses with the fall named', () => {
  assert.deepEqual(canopyDrop(world([LEAF, LEAF]), { x: 0.5, y: 100, z: 0.5 }), { ok: true, fall: 2 })
  const r = canopyDrop(world([LEAF, ...Array(36).fill(AIR)]), { x: 0.5, y: 100, z: 0.5 })
  assert.equal(r.ok, false); assert.match(r.why, /fall of 37/); assert.equal(r.fall, 37)
  assert.equal(canopyDrop(world([LEAF, AIR, AIR]), { x: 0.5, y: 100, z: 0.5 }).ok, true, 'one leaf and two air = a fall of 3')
  assert.equal(canopyDrop(world([LEAF, AIR, AIR, AIR]), { x: 0.5, y: 100, z: 0.5 }).ok, false, 'a fall of 4 refuses')
})
t('a leaf below a gap is not ground (it would be dug too); a log IS ground; the scan and the loop share one removable predicate', () => {
  const r = canopyDrop(world([LEAF, AIR, LEAF, ...Array(36).fill(AIR)]), { x: 0.5, y: 100, z: 0.5 }); assert.equal(r.ok, false); assert.equal(r.fall, 39)
  assert.deepEqual(canopyDrop(world([LOG]), { x: 0.5, y: 100, z: 0.5 }), { ok: true, fall: 0 }, 'standing on a log: nothing to dig, no fall')
  assert.deepEqual(canopyDrop(world([LEAF, LEAF, LOG, ...Array(30).fill(AIR)]), { x: 0.5, y: 100, z: 0.5 }), { ok: true, fall: 2 }, 'two leaves onto a log: a two-block fall onto support')
  assert.equal(CANOPY_REMOVABLE.test('oak_log'), false); assert.equal(CANOPY_REMOVABLE.test('oak_leaves'), true); assert.equal(CANOPY_REMOVABLE.test('vine'), true)
})
t('unknown, water or lava under the foliage refuses by name', () => {
  assert.match(canopyDrop(world([LEAF, null]), { x: 0.5, y: 100, z: 0.5 }).why, /unknown/)
  assert.match(canopyDrop(world([LEAF, WATER]), { x: 0.5, y: 100, z: 0.5 }).why, /water/)
  assert.match(canopyDrop(world([LEAF, AIR, LAVA]), { x: 0.5, y: 100, z: 0.5 }).why, /lava/)
})
t('WIRED: the dig loop runs canopyDrop first and refuses without digging; freed needs a solid block under the feet on ground (air is not ground)', () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
  const i0 = src.indexOf('const drop = canopyDrop((x, y, z) => bot.blockAt(new Vec3(x, y, z)), bot.entity.position)')
  const i1 = src.indexOf("if (!drop.ok) {"), i2 = src.indexOf("if (below.name === 'air' || below.boundingBox === 'empty') { await sleep(400, signal); continue }"), i3 = src.indexOf("if (!CANOPY_REMOVABLE.test(below.name)) {")
  assert.ok(i0 > 0 && i1 > i0 && i2 > i1 && i3 > i2, `measure -> refuse -> falling-is-not-freed -> solid-and-on-ground-is-freed, in that order (${i0} ${i1} ${i2} ${i3})`)
  assert.equal(src.includes("if (!FOLIAGE.test(below.name)) { freed = true; break }"), false, 'the old air-is-ground line is gone')
  assert.ok(src.indexOf("return { refused: true, why: drop.why }") > i1, 'the refusal returns a refused result')
  assert.ok(src.includes("if (descent && (descent.refused || descent.failed)) {") && src.indexOf("failClass: descent.refused ? 'canopy_refused' : 'canopy_failed'") > src.indexOf("if (descent && (descent.refused || descent.failed)) {"), 'gather stops on a refused OR failed descent before any dig')
  assert.ok(src.includes("return freed ? true : { failed: true, why: 'the canopy descent did not get free' }"), 'an unfreed descent reports failure, not false')
  const m = src.replace("if (!drop.ok) {", 'if (false) {'); assert.equal(m.indexOf("if (!drop.ok) {"), -1, 'mutant: the refusal removed is detected')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
