// A blind walk after a failed explore leg must not walk off a ledge or into lava.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { blindStepIsSafe, pickBlindHeading, sweptColumns, BLIND_STEP_BLOCKS, BLIND_STEP_MAX_DROP, BLIND_STEP_HEADINGS, JUMP_CELLS, BODY_HALF_WIDTH } from '../src/explorestep.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
// a world: map of "x,y,z" -> block name; everything else is air
const world = cells => (x, y, z) => { const n = cells[`${x},${y},${z}`]; return n ? { name: n, boundingBox: n === 'water' ? 'empty' : 'block' } : { name: 'air', boundingBox: 'empty' } }
const floorRow = (y, x0, x1, z, name = 'stone') => Object.fromEntries(Array.from({ length: x1 - x0 + 1 }, (_, i) => [`${x0 + i},${y},${z}`, name]))
const feet = { x: 0.5, y: 64.0, z: 0.5 }     // centred in cell 0,0
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
  const r = blindStepIsSafe(world({ ...flat, '-1,64,-2': 'lava' }), feet, NW)   // beside the diagonal at cell 2, where the body's edge crosses
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

t('a gentle staircase of one-block drops is WALKABLE (Codex, eighth pass): the carried height comes down once the body must have landed', () => {
  // ground descends one block per cell: 63, 62, 61, 60, 59 under cells 1..5
  const cells = {}; for (let i = 1; i <= 5; i++) cells[`${-i},${64 - i},0`] = 'stone'
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(r.ok, r.why); assert.equal(r.cells, BLIND_STEP_BLOCKS)
})
t('a steep chain within one jump is ONE fall (Codex, third pass): two-block drops in consecutive cells refuse from the carried height', () => {
  // surfaces 61, 59 under cells 1-2: from a body still airborne at 64, cell 2 is a drop of 5
  const cells = { '-1,61,0': 'stone', '-2,59,0': 'stone', ...floorRow(59, -6, -3, 0) }
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok, 'a 2+2 chain within a jump was allowed'); assert.match(r.why, /drop deeper than 3 at -2,64,0/)
})
t('lava beside an airborne body is checked at the START height band, not at an imagined landing', () => {
  // cell 1 drops to a floor at 61 (drop 2, fine); lava beside cell 2 at y=64 (start feet height): still refused
  const cells = { ...floorRow(61, -6, -1, 0), '-2,64,0': 'lava' }               // in the walked column itself, at the start height
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok); assert.match(r.why, /lava at -2,64,0/)
})

t('a low ceiling (solid at feet+2) is NOT a wall: the body walks under it, so a ledge inside a two-high tunnel still refuses (Codex, fourth pass)', () => {
  const cells = { ...floorRow(63, -2, 0, 0) }                       // floor under cells 1-2 only, then a drop
  for (let x = -6; x <= -1; x++) cells[`${x},66,0`] = 'stone'      // ceiling at feet+2 the whole way
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok, 'the ceiling branch approved a heading with a ledge under it'); assert.match(r.why, /drop deeper than 3 at -3,64,0/)
  const ok = blindStepIsSafe(world({ ...floorRow(63, -6, 0, 0), ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${-1 - i},66,0`, 'stone'])) }), feet, WEST)
  assert.ok(ok.ok, ok.why); assert.equal(ok.cells, BLIND_STEP_BLOCKS)
})

t('an ascending staircase raises the reference: two steps up are climbed and a ledge beyond them still refuses (Codex, fifth pass)', () => {
  // steps: surface 64 at cell 1 (x=-1), 65 at cell 2 (x=-2); then a drop with nothing under cells 3-5
  const cells = { '-1,64,0': 'stone', '-1,63,0': 'stone', '-2,65,0': 'stone', '-2,64,0': 'stone', '-2,63,0': 'stone' }
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok, 'the second step read as a wall and approved the heading unchecked'); assert.match(r.why, /drop deeper than 3 at -3,66,0/); assert.equal(r.cells, 2)
  // the same staircase with ground at 66 beyond it passes
  const ok = blindStepIsSafe(world({ ...cells, ...floorRow(65, -6, -3, 0) }), feet, WEST)
  assert.ok(ok.ok, ok.why); assert.equal(ok.cells, BLIND_STEP_BLOCKS)
})
t('a descent never lowers the reference: after climbing two steps, a drop is judged from the top (a landing at 61 = drop 5 refuses)', () => {
  const cells = { '-1,64,0': 'stone', '-1,63,0': 'stone', '-2,65,0': 'stone', '-2,64,0': 'stone', '-2,63,0': 'stone', ...floorRow(61, -6, -3, 0) }
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok); assert.match(r.why, /drop deeper than 3 at -3,66,0/)
})

t('a narrow step cleared by the jump does not raise the floor of the lava band: lava at the start height beyond the step is still seen (Codex, sixth pass)', () => {
  // step at cell 1; beyond it ground at 64 (feet 65 if landed) but lava at y=64 under cell 3 -- a body that skipped the step is at 64
  const cells = { ...floorRow(63, -6, 0, 0), '-1,64,0': 'stone', ...floorRow(64, -6, -2, 0), '-3,64,0': 'lava' }
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok); assert.match(r.why, /lava at -3,64,0/)
})
t('a wall for the climbed body but not for the unclimbed one lets the probe continue at the lower height', () => {
  // step at cell 1 (hi -> 65); cell 2 has a solid at 66 (head for hi) but its own surface is 64 (level for lo) with head 65 clear: the lower body walks on; a ledge at cell 4 must still refuse
  const cells = { '-1,64,0': 'stone', '-1,63,0': 'stone', '-2,66,0': 'stone', '-2,63,0': 'stone', '-3,63,0': 'stone' }
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok, 'the climbed-body wall ended the probe early'); assert.match(r.why, /drop deeper than 3 at -4,64,0/)
})

t('a wall must be solid at EVERY possible height: with hi-lo = 3, solid head cells at both ends but a clear gap between lets a body through, so the ledge beyond still refuses (Codex, seventh pass)', () => {
  // three steps up: cells 1-3 surfaces 64, 65, 66 -> hi = 67, lo = 64; cell 4: solid at 65 (lo+1) and 68 (hi+1), clear at 66 and 67, floor at 64; cell 5: nothing
  const cells = { '-1,64,0': 'stone', '-2,65,0': 'stone', '-2,64,0': 'stone', '-3,66,0': 'stone', '-3,65,0': 'stone', '-3,64,0': 'stone',
                  '-4,65,0': 'stone', '-4,68,0': 'stone', '-4,64,0': 'stone', '-4,63,0': 'stone' }
  for (let x = -3; x <= -1; x++) cells[`${x},63,0`] = 'stone'
  const r = blindStepIsSafe(world(cells), feet, WEST)
  assert.ok(!r.ok, 'the endpoint-only wall test ended the probe early'); assert.match(r.why, /drop deeper than 3 at -5,\d+,0/)
  // and a column solid from lo+1 to hi+1 IS a wall
  const wall = { ...cells }; for (let y = 65; y <= 68; y++) wall[`-4,${y},0`] = 'stone'
  const w = blindStepIsSafe(world(wall), feet, WEST)
  assert.ok(w.ok, w.why); assert.match(w.why, /wall after 3 cell/)
})

t("Codex's counter-example: lo=64, hi=68 after four steps; a cell solid at 65, 68, 70 and clear at 66, 67, 69 has an open body at 66, so it is NOT a wall and a ledge beyond still refuses (eighth pass)", () => {
  const cells = {}
  // four steps up: surfaces 64,65,66,67 at cells 1-4 (x=-1..-4), each with ground below
  for (let i = 1; i <= 4; i++) for (let y = 63; y <= 63 + i; y++) cells[`${-i},${y},0`] = 'stone'
  // cell 5 (x=-5): solid at 65, 68, 70; ground at 64 and below; clear 66, 67, 69
  for (const y of [63, 64, 65, 68, 70]) cells[`-5,${y},0`] = 'stone'
  const r = blindStepIsSafe(world(cells), feet, WEST, { blocks: 6 })
  assert.ok(!r.ok, 'the step branch called it a wall'); assert.match(r.why, /drop deeper than 3 at -6,66,0/)
})

t('lava under an intact floor is out of reach and passes; the same lava with a hole in the floor refuses (Codex, ninth pass)', () => {
  const floor = floorRow(63, -6, 0, 0); const lavaRow = floorRow(62, -6, 0, 0, 'lava')
  const ok = blindStepIsSafe(world({ ...floor, ...lavaRow }), feet, WEST)
  assert.ok(ok.ok, ok.why); assert.equal(ok.cells, BLIND_STEP_BLOCKS)
  const hole = { ...floor, ...lavaRow }; delete hole['-3,63,0']
  const r = blindStepIsSafe(world(hole), feet, WEST)
  assert.ok(!r.ok); assert.match(r.why, /lava at -3,62,0/)
  // a wall above the start height shields nothing: lava at feet level behind a one-high step is still seen
  const step = { ...floor, '-1,64,0': 'stone', '-2,64,0': 'lava' }
  assert.ok(!blindStepIsSafe(world(step), feet, WEST).ok)
})

t('a centred bot on a one-wide bridge over lava walks straight along it (Codex, tenth pass); off-centre by more than the body half-width it does not', () => {
  const bridge = floorRow(63, -6, 0, 0)
  const lavaSides = {}; for (let x = -6; x <= 0; x++) for (const z of [-1, 1]) { lavaSides[`${x},63,${z}`] = 'lava'; lavaSides[`${x},64,${z}`] = 'lava' }
  const ok = blindStepIsSafe(world({ ...bridge, ...lavaSides }), feet, WEST)
  assert.ok(ok.ok, ok.why); assert.equal(ok.cells, BLIND_STEP_BLOCKS)
  const edge = blindStepIsSafe(world({ ...bridge, ...lavaSides }), { x: 0.5, y: 64, z: 0.5 + BODY_HALF_WIDTH + 0.1 }, WEST)   // edge at z=1.2: over the lava column
  assert.ok(!edge.ok, 'a body hanging over the lava column was not refused'); assert.match(edge.why, /lava beside at -1,64,1/)
  const over = blindStepIsSafe(world({ ...bridge, ...lavaSides }), { x: 0.5, y: 64, z: 1.05 }, WEST)                            // centre already over it
  assert.ok(!over.ok); assert.match(over.why, /lava at -1,64,1/)
  // touching the boundary is not overlapping it: a body at z=0.7 spans [0.4, 1.0] and stays on the bridge (Codex, eleventh pass)
  const touch = blindStepIsSafe(world({ ...bridge, ...lavaSides }), { x: 0.5, y: 64, z: 0.7 }, WEST)
  assert.ok(touch.ok, touch.why)
})

t('the collision box is axis-aligned: on a diagonal heading a corner reaches 0.42 sideways, so lava in the corner column refuses even though a perpendicular +-0.3 sample would miss it (Codex, twelfth pass)', () => {
  const NW = Math.PI / 4
  const flat = {}; for (let x = -8; x <= 0; x++) for (let z = -8; z <= 0; z++) flat[`${x},63,${z}`] = 'stone'
  // at i=1 the point is (0.5-0.71, 0.5-0.71) = (-0.21, -0.21): the box [-0.51,0.09]x[-0.51,0.09] overlaps columns -1..0 in both axes,
  // including the corner column (0,-1) and (-1,0); put lava in (0,64,-1) which only a corner reaches
  const r = blindStepIsSafe(world({ ...flat, '0,64,-1': 'lava' }), feet, NW)
  assert.ok(!r.ok, 'the corner column was not checked'); assert.match(r.why, /lava beside at 0,64,-1/)
})

t("the box is SWEPT along the walk: Codex's example -- consecutive one-block samples at (1.2,0.6) and (1.91,1.31) both miss column (2,0), which the box crosses between them (thirteenth pass)", () => {
  // dir (+0.707, +0.707) -> yaw -3pi/4; start so that sample 1 is at (1.2, 0.6)
  const yaw = -3 * Math.PI / 4
  const start = { x: 1.2 - Math.SQRT1_2, y: 64, z: 0.6 - Math.SQRT1_2 }
  const flat = {}; for (let x = -2; x <= 8; x++) for (let z = -2; z <= 8; z++) flat[`${x},63,${z}`] = 'stone'
  assert.ok(blindStepIsSafe(world(flat), start, yaw).ok)
  const r = blindStepIsSafe(world({ ...flat, '2,64,0': 'lava' }), start, yaw)
  assert.ok(!r.ok, 'a column crossed between samples was not checked'); assert.match(r.why, /lava beside at 2,64,0/)
})

t('sweptColumns is exact: a straight axis walk touches one column; a diagonal touches the corner columns; touching a boundary does not count', () => {
  assert.deepEqual(sweptColumns(0.5, 0.5, 0.5 - 4, 0.5).sort(), ['-1,0', '-2,0', '-3,0', '-4,0', '0,0'].sort())
  assert.ok(sweptColumns(0.5, 0.5, -0.5, -0.5).includes('0,-1'), 'a diagonal box crosses the corner column')
  assert.ok(!sweptColumns(0.5, 0.7, -3.5, 0.7).includes('0,1'), 'a body whose edge exactly touches z=1 does not overlap column z=1')
  assert.ok(sweptColumns(0.5, 0.71, -3.5, 0.71).includes('0,1'), 'and one 0.01 past it does')
})
t("a corner clip of arbitrarily short duration is still found (Codex, fourteenth pass): overlap with column (1,0) begins when x > 0.7 and ends when z reaches 1.3", () => {
  const yaw = -3 * Math.PI / 4                                  // dir (+0.707, +0.707)
  const start = { x: 0.7 - Math.SQRT1_2, y: 64, z: 1.29 - Math.SQRT1_2 }   // at t=1 the centre is (0.7, 1.29): the clip lasts for t in (1.0, 1.014)
  const flat = {}; for (let x = -2; x <= 8; x++) for (let z = -2; z <= 8; z++) flat[`${x},63,${z}`] = 'stone'
  assert.ok(blindStepIsSafe(world(flat), start, yaw).ok)
  const r = blindStepIsSafe(world({ ...flat, '1,64,0': 'lava' }), start, yaw)
  assert.ok(!r.ok, 'the brief corner clip was missed'); assert.match(r.why, /lava beside at 1,64,0/)
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
