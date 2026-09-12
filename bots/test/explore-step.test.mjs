// A blind walk after a failed explore leg must not walk off a ledge or into lava.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { blindStepIsSafe, pickBlindHeading, BLIND_STEP_BLOCKS, BLIND_STEP_MAX_DROP, BLIND_STEP_HEADINGS } from '../src/explorestep.mjs'
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
  const ok = blindStepIsSafe(world({ ...floorRow(63, -1, 0, 0), ...floorRow(64 - 1 - BLIND_STEP_MAX_DROP, -6, -2, 0) }), feet, WEST)
  assert.ok(ok.ok, ok.why)
  const bad = blindStepIsSafe(world({ ...floorRow(63, -1, 0, 0), ...floorRow(64 - 2 - BLIND_STEP_MAX_DROP, -6, -2, 0) }), feet, WEST)
  assert.ok(!bad.ok); assert.match(bad.why, /drop deeper/)
})
t('lava anywhere in the column ahead refuses, even under a floor-less cell, even at head height', () => {
  assert.match(blindStepIsSafe(world({ ...floorRow(63, -1, 0, 0), '-2,62,0': 'lava' }), feet, WEST).why, /lava at -2,62,0/)
  assert.match(blindStepIsSafe(world({ ...floorRow(63, -6, 0, 0), '-2,64,0': 'lava' }), feet, WEST).why, /lava at -2,64,0/)
  assert.match(blindStepIsSafe(world({ ...floorRow(63, -6, 0, 0), '-3,65,0': 'lava' }), feet, WEST).why, /lava at/)
})
t('a TWO-high wall ends the probe as SAFE (walking into a wall is harmless), water is terrain and passes', () => {
  const r = blindStepIsSafe(world({ ...floorRow(63, -6, 0, 0), '-2,64,0': 'stone', '-2,65,0': 'stone' }), feet, WEST)
  assert.ok(r.ok); assert.match(r.why, /wall after 1 cell/)
  const w = blindStepIsSafe(world({ ...floorRow(63, -6, 0, 0), '-2,64,0': 'water', '-2,63,0': 'water', '-2,62,0': 'stone' }), feet, WEST)
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
t("explore's blind walk is gated on pickBlindHeading; a refusal stands the leg, a pick walks ITS heading", () => {
  const c = strip(RAW)
  const s = c.indexOf('async function explore('); const f = c.slice(s, s + 20000)
  const probe = f.indexOf('const pick = pickBlindHeading('), walk = f.indexOf("bot.setControlState('forward', true)")
  assert.ok(probe > 0 && walk > probe, 'the probe must precede the walk')
  assert.match(f.slice(probe, walk), /if \(!pick\.step\.ok\) \{[\s\S]{0,400}kind: 'explore_step_refused'/, 'a refusal is logged and skips the walk')
  assert.match(f.slice(probe, walk), /\} else \{\s*ang = pick\.ang\s*await bot\.look\(ang, 0, true\)/, 'the walk looks along the picked heading')
})
t('MUTANT: an ungated walk (pick result ignored) is caught', () => {
  const c = strip(RAW)
  const s = c.indexOf('async function explore('); const f = c.slice(s, s + 20000)
  const anchor = 'if (!pick.step.ok) {'
  assert.equal(f.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = f.replace(anchor, 'if (false) {')
  assert.ok(!/if \(!pick\.step\.ok\) \{[\s\S]{0,400}kind: 'explore_step_refused'/.test(bad.slice(bad.indexOf('const pick = pickBlindHeading('))))
})

t('a ONE-high step is climbed and the probe continues at the new height: lava two cells past the step is still seen (Codex)', () => {
  // step at cell 1 (-1,64), then ground at y=64 beyond it (feet at 65), lava under cell 3
  const cells = { ...floorRow(63, -6, 0, 0), '-1,64,0': 'stone', ...floorRow(64, -6, -2, 0), '-3,64,0': 'lava' }
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok); assert.match(r.why, /lava at -3,64,0/)
  const ok = blindStepIsSafe(world({ ...floorRow(63, -6, 0, 0), '-1,64,0': 'stone', ...floorRow(64, -6, -2, 0) }), feet, WEST)
  assert.ok(ok.ok, ok.why); assert.equal(ok.cells, BLIND_STEP_BLOCKS)
})
t('a slab-height obstacle in the first cell does not end the probe early', () => {
  const cells = { ...floorRow(63, -6, 0, 0), '-1,64,0': 'stone_slab', ...floorRow(64, -6, -2, 0), '-4,64,0': 'lava' }
  assert.ok(!blindStepIsSafe(world(cells), feet, WEST).ok)
})
t('lava BESIDE the line refuses (the body is 0.6 wide): a diagonal heading passes lava one column over', () => {
  const NW = Math.PI / 4        // forward = (-sin, -cos) = (-0.71, -0.71): toward -x and -z
  const flat = {}; for (let x = -8; x <= 0; x++) for (let z = -8; z <= 0; z++) flat[`${x},63,${z}`] = 'stone'
  assert.ok(blindStepIsSafe(world(flat), feet, NW).ok)
  const r = blindStepIsSafe(world({ ...flat, '-2,64,-3': 'lava' }), feet, NW)   // beside the diagonal, not on it
  assert.ok(!r.ok, 'lava one column beside the heading was not seen'); assert.match(r.why, /lava beside/)
})
t('pickBlindHeading walks the first safe heading among up to BLIND_STEP_HEADINGS 60-degree turns, else reports the last refusal', () => {
  const cells = { ...floorRow(63, 0, 6, 0), ...floorRow(63, 0, 0, -6) }   // ground only to +x (EAST = -pi/2) and -z (NORTH = 0)
  for (let z = -6; z <= 0; z++) cells[`0,63,${z}`] = 'stone'
  const pick = pickBlindHeading(world(cells), feet, Math.PI / 2, -Math.PI / 3)   // start WEST (a ledge), turning toward north/east
  assert.ok(pick.step.ok, pick.step.why); assert.ok(pick.tried >= 2 && pick.tried <= BLIND_STEP_HEADINGS, `tried ${pick.tried}`)
  const none = pickBlindHeading(() => ({ name: 'air', boundingBox: 'empty' }), feet, 0, Math.PI / 3)   // void everywhere
  assert.ok(!none.step.ok); assert.equal(none.tried, BLIND_STEP_HEADINGS); assert.match(none.step.why, /drop deeper/)
})

t('a chain of small drops is ONE fall: every height is measured from the start, so a staircase down past maxDrop refuses (Codex, third pass)', () => {
  // ground descends one block per cell: 63, 62, 61, 60, 59 under cells 1..5 -> cell 4 lands at 60 = drop 3 (ok), cell 5 at 59 = drop 4 (refuse)
  const cells = {}; for (let i = 1; i <= 5; i++) cells[`${-i},${64 - i},0`] = 'stone'
  for (let i = 1; i <= 5; i++) for (let y = 64 - i + 1; y <= 63; y++) cells[`${-i},${y},0`] = 'air'
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok, 'a descending chain past maxDrop was allowed'); assert.match(r.why, /drop deeper than 3 at -5,64,0/); assert.equal(r.cells, 4)
})
t('lava beside an airborne body is checked at the START height band, not at an imagined landing', () => {
  // cell 1 drops to a floor at 61 (drop 2, fine); lava beside cell 2 at y=64 (start feet height): still refused
  const cells = { ...floorRow(61, -6, -1, 0), '-2,64,1': 'lava' }
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok); assert.match(r.why, /lava beside at -2,64,1/)
})

t('a low ceiling (solid at feet+2) is NOT a wall: the body walks under it, so a ledge inside a two-high tunnel still refuses (Codex, fourth pass)', () => {
  const cells = { ...floorRow(63, -2, 0, 0) }                       // floor under cells 1-2 only, then a drop
  for (let x = -6; x <= -1; x++) cells[`${x},66,0`] = 'stone'      // ceiling at feet+2 the whole way
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok, 'the ceiling branch approved a heading with a ledge under it'); assert.match(r.why, /drop deeper than 3 at -3,64,0/)
  const ok = blindStepIsSafe(world({ ...floorRow(63, -6, 0, 0), ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${-1 - i},66,0`, 'stone'])) }), feet, WEST)
  assert.ok(ok.ok, ok.why); assert.equal(ok.cells, BLIND_STEP_BLOCKS)
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
