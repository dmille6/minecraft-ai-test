// A blind walk after a failed explore leg must not walk off a ledge or into lava.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { blindStepIsSafe, BLIND_STEP_BLOCKS, BLIND_STEP_MAX_DROP } from '../src/explorestep.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
// a world: map of "x,y,z" -> block name; everything else is air
const world = cells => (x, y, z) => { const n = cells[`${x},${y},${z}`]; return n ? { name: n, boundingBox: n === 'water' ? 'empty' : 'block' } : { name: 'air', boundingBox: 'empty' } }
const floorRow = (y, x0, x1, z, name = 'stone') => Object.fromEntries(Array.from({ length: x1 - x0 + 1 }, (_, i) => [`${x0 + i},${y},${z}`, name]))
const feet = { x: 0, y: 64, z: 0 }
const WEST = Math.PI / 2      // mineflayer yaw: forward = (-sin yaw, -cos yaw) -> yaw pi/2 walks toward -x

t('flat ground ahead is safe; the probe reads BLIND_STEP_BLOCKS cells', () => {
  const r = blindStepIsSafe(world(floorRow(63, -6, 0, 0)), feet, WEST)
  assert.ok(r.ok, r.why); assert.equal(r.cells, BLIND_STEP_BLOCKS)
})
t('a ledge: no floor within BLIND_STEP_MAX_DROP under the third cell refuses and names the cell', () => {
  const r = blindStepIsSafe(world({ ...floorRow(63, -2, 0, 0) }), feet, WEST)   // floor under cells 1-2 only
  assert.ok(!r.ok); assert.match(r.why, /drop deeper than 3 at -3,64,0/); assert.equal(r.cells, 2)
})
t('a step down of exactly maxDrop is allowed; one deeper is not', () => {
  const ok = blindStepIsSafe(world({ ...floorRow(63, -1, 0, 0), ...floorRow(64 - 1 - BLIND_STEP_MAX_DROP, -4, -2, 0) }), feet, WEST)
  assert.ok(ok.ok, ok.why)
  const bad = blindStepIsSafe(world({ ...floorRow(63, -1, 0, 0), ...floorRow(64 - 2 - BLIND_STEP_MAX_DROP, -4, -2, 0) }), feet, WEST)
  assert.ok(!bad.ok); assert.match(bad.why, /drop deeper/)
})
t('lava anywhere in the column ahead refuses, even under a floor-less cell, even at head height', () => {
  assert.match(blindStepIsSafe(world({ ...floorRow(63, -1, 0, 0), '-2,62,0': 'lava' }), feet, WEST).why, /lava below at -2,62,0/)
  assert.match(blindStepIsSafe(world({ ...floorRow(63, -4, 0, 0), '-2,64,0': 'lava' }), feet, WEST).why, /lava ahead at -2,64,0/)
  assert.match(blindStepIsSafe(world({ ...floorRow(63, -4, 0, 0), '-3,65,0': 'lava' }), feet, WEST).why, /lava ahead/)
})
t('a wall ends the probe as SAFE (walking into a wall is harmless), water is terrain and passes', () => {
  const r = blindStepIsSafe(world({ ...floorRow(63, -4, 0, 0), '-2,64,0': 'stone', '-2,65,0': 'stone' }), feet, WEST)
  assert.ok(r.ok); assert.match(r.why, /wall after 1 cell/)
  const w = blindStepIsSafe(world({ ...floorRow(63, -4, 0, 0), '-2,64,0': 'water', '-2,63,0': 'water', '-2,62,0': 'stone' }), feet, WEST)
  assert.ok(w.ok, w.why)
})
t('a read that throws refuses (never guess about the ground)', () => {
  const r = blindStepIsSafe(() => { throw new Error('chunk not loaded') }, feet, WEST)
  assert.ok(!r.ok); assert.match(r.why, /cannot read/)
})
t('the heading is honoured: the same ledge to the west is not seen when walking east', () => {
  const cells = { ...floorRow(63, -2, 0, 0), ...floorRow(63, 0, 6, 0) }
  assert.ok(!blindStepIsSafe(world(cells), feet, WEST).ok)
  assert.ok(blindStepIsSafe(world(cells), feet, -Math.PI / 2).ok)
})

const RAW = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
t("explore's blind walk is gated on blindStepIsSafe and a refusal turns without walking", () => {
  const c = strip(RAW)
  const s = c.indexOf('async function explore('); const f = c.slice(s, s + 20000)
  const probe = f.indexOf('const step = blindStepIsSafe('), walk = f.indexOf("bot.setControlState('forward', true)")
  assert.ok(probe > 0 && walk > probe, 'the probe must precede the walk')
  assert.match(f.slice(probe, walk), /if \(!step\.ok\) \{[\s\S]{0,400}kind: 'explore_step_refused'/, 'a refusal is logged and skips the walk')
  assert.match(f.slice(probe, walk), /\} else \{\s*$/m, 'the walk sits in the else branch')
})
t('MUTANT: an ungated walk (probe result ignored) is caught', () => {
  const c = strip(RAW)
  const s = c.indexOf('async function explore('); const f = c.slice(s, s + 20000)
  const anchor = 'if (!step.ok) {'
  assert.equal(f.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = f.replace(anchor, 'if (false) {')
  assert.ok(!/if \(!step\.ok\) \{[\s\S]{0,400}kind: 'explore_step_refused'/.test(bad.slice(bad.indexOf('const step = blindStepIsSafe('))))
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
