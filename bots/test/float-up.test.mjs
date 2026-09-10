// A BOT AFLOAT IN A ONE-BLOCK AIR POCKET IS TRAPPED IN THE PLANNER, NOT THE WORLD.
//
// Reconstructed from the live server at 1809,61,666 (hive-b-Comet: zero items in
// 40 minutes, 20/20 health for hours, `_path_no_legal_move` at 192 per 1k rows
// against a fleet baseline of 15.7):
//
//   y=62   ~~##.####      feet in water at y=61, head in a ONE-BLOCK air pocket
//   y=61   ~~~~B~~~~      at y=62, every cardinal SOLID at head height,
//   y=63+  .........      open air above.
//
// Verified against the real Movements class: ZERO legal moves with canDig=false,
// with canDig=true, and with 64 scaffold blocks. Three of pathfinder's own rules
// meet there -- getMoveUp returns early on a liquid current node
// (movements.js:525), getMoveDown likewise (:516), and with all four cardinals
// blocked every diagonal would corner-cut.
//
// mineflayer's own tick holds `jump` whenever isInWater, so the bot could float
// out in seconds. The move exists; A* just cannot express it.
import assert from 'node:assert'
import test from 'node:test'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { escapePlan, ESCAPES } = await import('../src/escape.mjs')

/** The reconstructed trap, as the lattice sees it. */
const TRAP = {
  trapped: true, afloat: true, health: 20, columnOpen: true,
  lateralHeadOpen: false,          // every cardinal solid at head height
  underfootSolid: false, underfootDrop: null, floorBelowSolid: false,
  lateralTread: false, blocks: 0,
}

test('float_up is a rung the lattice knows', () => {
  assert.ok(ESCAPES.includes('float_up'))
})

test('the reconstructed trap chooses float_up, not surface_swim', () => {
  // surface_swim used to win this state and does nothing in it: there is
  // nowhere to swim TO, which is why the sibling bot logged
  // "swam 0.0 blocks on a fixed heading" and stayed for days.
  assert.equal(escapePlan(TRAP), 'float_up')
})

test('OPEN water still chooses surface_swim — the old behaviour is untouched', () => {
  // The whole risk of this rung is stealing states from a working one.
  assert.equal(escapePlan({ ...TRAP, lateralHeadOpen: true }), 'surface_swim')
})

test('a dry bot never floats', () => {
  assert.notEqual(escapePlan({ ...TRAP, afloat: false, underfootSolid: true, underfootDrop: 2 }),
    'float_up')
})

test('a capped pocket does not float — it still digs', () => {
  // columnOpen false means a lid overhead: rising achieves nothing and the
  // digging rungs are correct. This is the placebo-b-Delta case.
  assert.notEqual(escapePlan({ ...TRAP, columnOpen: false, underfootSolid: true, underfootDrop: 3 }),
    'float_up')
})

test('float_up can be excluded like any other rung', () => {
  // The lattice must stay total when a rung has already failed this run.
  // The parameter is `exclude` (an array), not `skip` (a Set) -- `skip` is the
  // internal name. My first version passed `skip`, which escapePlan ignores
  // entirely, so the exclusion silently did nothing and the test failed with
  // "'float_up' != 'float_up'". An unrecognised option that is quietly dropped
  // is exactly how a guard ships inert.
  const alt = escapePlan({ ...TRAP, exclude: ['float_up'] })
  assert.notEqual(alt, 'float_up')
  assert.ok(ESCAPES.includes(alt), `fell through to a real rung, got ${alt}`)
})

test('the observation reads HEAD height, not foot height', async () => {
  // A bot afloat has water at its feet in every direction, so a foot-level test
  // reports "you can swim" about a bot whose head is walled in. That mistake
  // would make this rung unreachable in exactly the case it exists for.
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const src = fs.readFileSync(path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'reflex.mjs'), 'utf8')
  const exec = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(exec, /lateralHeadOpen:[\s\S]{0,160}?!solid\(at\(dx, 1, dz\)\)/,
    'the cardinals must be probed at dy=1, the head cell')
})
