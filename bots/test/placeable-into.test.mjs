// A BOT CARRIED 48 CRAFTING TABLES AND COULD NOT PUT ONE DOWN.
//
// `place crafting_table`: 19 successes, 37 failures in 3h on 2026-09-07, and 28
// of those failures were "nowhere to place: no solid block with a free space
// above it within reach". The spot-finder excluded water from the cells it was
// willing to place INTO -- so a bot at a shoreline or in a flooded pocket, whose
// eight neighbours are water, found no candidate at all.
//
// Minecraft treats water as replaceable: the block goes in and the water is
// displaced. Excluding it was never a safety rule. Downstream this is a tech
// tree gate, because `craft` cannot resolve a recipe without a station and then
// prints "place the crafting_table first" to a bot already trying to.
import assert from 'node:assert'
import test from 'node:test'
import { placeableInto } from '../src/skills.mjs'

const cell = (name, boundingBox) => ({ name, boundingBox })

test('water is placeable — this is the whole fix', () => {
  assert.equal(placeableInto(cell('water', 'empty')), true)
})

test('lava is NOT placeable', () => {
  // Equally legal in Minecraft, but the bot reaches into it to do so. This is
  // the one case where "the cell is replaceable" is not the whole question.
  assert.equal(placeableInto(cell('lava', 'empty')), false)
})

test('air and the forest floor are placeable', () => {
  // The earlier bug was an `=== air` test that rejected all of these, which is
  // most of the ground a wood-gathering bot stands on.
  for (const n of ['air', 'cave_air', 'short_grass', 'tall_grass', 'fern',
                   'snow', 'dead_bush', 'seagrass']) {
    assert.equal(placeableInto(cell(n, 'empty')), true, n)
  }
})

test('a solid block is never placeable into', () => {
  for (const n of ['stone', 'oak_log', 'dirt', 'crafting_table', 'furnace']) {
    assert.equal(placeableInto(cell(n, 'block')), false, n)
  }
})

test('boundingBox decides, not the name', () => {
  // Solidity is a boundingBox. A previous version of this logic tested names
  // and accepted water as a SURFACE because it is not called "air".
  assert.equal(placeableInto(cell('water', 'block')), false,
    'a water cell reported solid is not placeable')
  assert.equal(placeableInto(cell('some_future_plant', 'empty')), true,
    'an unknown empty block is placeable without needing to be listed')
})

test('missing or junk cells are not placeable', () => {
  // An unloaded chunk returns null. Treating that as placeable would have the
  // bot reach into terrain it cannot see.
  assert.equal(placeableInto(null), false)
  assert.equal(placeableInto(undefined), false)
  assert.equal(placeableInto({}), false)
  assert.equal(placeableInto(cell('air', undefined)), false)
})

test('POSITIVE CONTROL: the old predicate and the new one differ ONLY on water', () => {
  // If they agreed everywhere, this file would be testing the bug. If they
  // differed elsewhere, the change would be wider than claimed.
  const old = b => b != null && b.boundingBox === 'empty' &&
                   b.name !== 'water' && b.name !== 'lava'
  const cells = ['air', 'cave_air', 'water', 'lava', 'short_grass', 'stone', 'oak_log']
    .map(n => cell(n, n === 'stone' || n === 'oak_log' ? 'block' : 'empty'))
  const differ = cells.filter(c => old(c) !== placeableInto(c)).map(c => c.name)
  assert.deepEqual(differ, ['water'],
    'exactly one cell type changed behaviour, and it is water: got ' + differ)
})
