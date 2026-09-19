// isExposed must treat leaves as cover the bot can break, and nothing else.
//
// The defect: oak_leaves.boundingBox is 'block' (verified against the fleet's
// own minecraft-data), so a trunk inside its canopy had six solid neighbours,
// isExposed returned false, and gather refused "buried -- use mine to dig down"
// for a log at y=68. 4,785 of 8,034 buried refusals in 24 h were oak_log.
import assert from 'node:assert/strict'
import test from 'node:test'
import { isExposed } from '../src/skills.mjs'

const P = (x, y, z) => ({ x, y, z, offset: (a, b, c) => P(x + a, y + b, z + c) })
const key = p => `${p.x},${p.y},${p.z}`
// `world` maps a coordinate to a block name; anything unnamed is solid stone.
function botOf (world, { missing = null } = {}) {
  return {
    blockAt (p) {
      const n = world[key(p)]
      if (n === undefined) return { name: 'stone', boundingBox: 'block' }
      if (n === null) return missing
      const empty = n === 'air' || n === 'cave_air' || n === 'water'
      return { name: n, boundingBox: empty ? 'empty' : 'block' }
    },
  }
}
// The target block matters now: only a *_log may be exposed through leaves.
function botAt (targetName, world) {
  const inner = botOf(world).blockAt
  return { blockAt (p) { return (p.x === 0 && p.y === 0 && p.z === 0)
      ? { name: targetName, boundingBox: 'block' } : inner(p) } }
}
const at = P(0, 0, 0)
const N = { up: '0,1,0', down: '0,-1,0', east: '1,0,0', west: '-1,0,0', south: '0,0,1', north: '0,0,-1' }

test('a log encased in stone is still buried', () => {
  assert.equal(isExposed(botOf({}), at), false)
})

test('THE BUG: a log whose only cover is leaves is exposed', () => {
  assert.equal(isExposed(botAt('oak_log', { [N.up]: 'oak_leaves' }), at), true)
})

test('every leaf variant counts, not just oak', () => {
  for (const leaf of ['oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
                      'azalea_leaves', 'flowering_azalea_leaves', 'cherry_leaves']) {
    assert.equal(isExposed(botAt('oak_log', { [N.north]: leaf }), at), true, leaf)
  }
})

test('fully leaf-encased -- the canopy case -- is exposed', () => {
  const world = Object.fromEntries(Object.values(N).map(k => [k, 'oak_leaves']))
  assert.equal(isExposed(botAt('oak_log', world), at), true)
})

test('air still wins, and is not regressed', () => {
  assert.equal(isExposed(botOf({ [N.down]: 'air' }), at), true)
})

test('water reads as exposed via boundingBox, unchanged by this patch', () => {
  assert.equal(isExposed(botOf({ [N.east]: 'water' }), at), true)
})

test('a LOG neighbour is NOT breakable cover -- leaves are the only cover', () => {
  // A trunk inside a trunk stays buried: widening to _log would make almost
  // every log exposed and is a different change with a different blast radius.
  assert.equal(isExposed(botAt('oak_log', { [N.up]: 'oak_log' }), at), false)
})

test('a name merely containing "leaves" does not match -- anchored at the end', () => {
  assert.equal(isExposed(botAt('oak_log', { [N.up]: 'leaves_of_grass_block' }), at), false)
})

test('an unreadable neighbour still reads as exposed (fails open, unchanged)', () => {
  assert.equal(isExposed(botOf({ [N.up]: null }, { missing: null }), at), true)
})

test('dirt and stone cover are unchanged -- the correct refusals survive', () => {
  for (const b of ['dirt', 'stone', 'deepslate', 'gravel']) {
    assert.equal(isExposed(botOf({ [N.up]: b }), at), false, b)
  }
})

// --- Codex pass 2: logs only. A leaf face exposes a LOG and nothing else. ---
// One leaf-adjacent dirt block made reachable.length !== 0 (skills.mjs:1500),
// which disables the alternative-source search for an accessible grass_block
// and turns a previously SUCCESSFUL gather into a failure.
test('REGRESSION GUARD: leaf-covered DIRT stays buried', () => {
  assert.equal(isExposed(botAt('dirt', { [N.up]: 'oak_leaves' }), at), false)
})

test('REGRESSION GUARD: leaf-covered stone/sand/ore stay buried', () => {
  for (const t of ['stone', 'sand', 'iron_ore', 'coal_ore', 'grass_block']) {
    assert.equal(isExposed(botAt(t, { [N.up]: 'oak_leaves' }), at), false, t)
  }
})

test('a leaf-covered LOG is still exposed -- the motivating case survives', () => {
  for (const t of ['oak_log', 'birch_log', 'spruce_log']) {
    assert.equal(isExposed(botAt(t, { [N.up]: 'oak_leaves' }), at), true, t)
  }
})

test('dirt beside AIR is still exposed -- the narrowing touches only leaf cover', () => {
  assert.equal(isExposed(botAt('dirt', { [N.up]: 'air' }), at), true)
})

test('an unreadable TARGET does not crash and does not exempt', () => {
  const b = { blockAt: p => (p.x === 0 && p.y === 0 && p.z === 0) ? null
                : { name: 'oak_leaves', boundingBox: 'block' } }
  assert.equal(isExposed(b, at), false)
})

test('the target match is ANCHORED: a name merely containing "log" is not a log', () => {
  // Caught by a surviving mutant (/_log$/ -> /log/). No vanilla block trips
  // this today, which is exactly why it would rot silently: the anchor is the
  // stated intent, so it gets a test rather than a comment.
  assert.equal(isExposed(botAt('logic_block', { [N.up]: 'oak_leaves' }), at), false)
  assert.equal(isExposed(botAt('stripped_oak_log', { [N.up]: 'oak_leaves' }), at), true)
})
