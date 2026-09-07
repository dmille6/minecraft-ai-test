// A BOT WITH 563 BIRCH LOGS AND NOTHING IT WAS ALLOWED TO STAND ON.
//
// mineflayer-pathfinder gates getMoveUp, getMoveForward and getMoveJumpUp on
// `node.remainingBlocks === 0`, and remainingBlocks is countScaffoldingItems()
// over `movements.scafoldingBlocks`. A bot holding nothing on that list has no
// vertical move and cannot bridge -- A* then returns noPath with ONE visited
// node, which reads as "nowhere to go" rather than "nothing to build with".
//
// Measured 2026-09-07: board-d-Bravo produced 480 such failures in three hours,
// 30.5% of every dry zero-neighbour event on the fleet, carrying 563 birch_log
// and zero list-eligible blocks.
//
// The list's stated exclusion is FALLING blocks, because a sand bridge drops
// out from under the bot. Logs and planks do not fall, so the rationale never
// covered them -- they were simply absent. And wood is the one material this
// fleet reliably has: 81.2% of bots hold logs against 58.8% for stone or
// cobblestone.
import assert from 'node:assert'
import test from 'node:test'
import { PATHFINDER_SCAFFOLD, FALLING, extendScaffolding, isFallingBlock } from '../src/scaffold.mjs'

test('wood is on the list', () => {
  for (const n of ['oak_log', 'birch_log', 'spruce_log', 'oak_planks', 'birch_planks']) {
    assert.ok(PATHFINDER_SCAFFOLD.includes(n), `${n} must be usable as scaffold`)
  }
})

test('THE INVARIANT: nothing on the list may fall', () => {
  // This is the whole reason the list is curated rather than "anything solid".
  // A falling block used as a bridge drops out from under the bot mid-crossing.
  for (const n of PATHFINDER_SCAFFOLD) {
    assert.ok(!FALLING.includes(n), `${n} obeys gravity and must NEVER be scaffold`)
  }
  // POSITIVE CONTROL: the check can actually catch one.
  assert.ok(FALLING.includes('sand'))
  assert.ok(FALLING.includes('gravel'))
})

test('the falling-block predicate agrees with the list', () => {
  // TWO SOURCES OF TRUTH ABOUT GRAVITY WOULD DRIFT. `FALLING` is the short
  // bridging list; `isFallingBlock` is the complete safety predicate (it also
  // knows concrete powder, anvils, dripstone and scaffolding). Every entry the
  // scaffold list admits must read false under BOTH, or a bridge is planned
  // with something that falls.
  for (const n of PATHFINDER_SCAFFOLD) {
    assert.equal(isFallingBlock({ name: n }), false,
      `${n} is on the scaffold list but the safety predicate says it falls`)
  }
  // POSITIVE CONTROL: the predicate must be capable of saying yes.
  assert.equal(isFallingBlock({ name: 'sand' }), true)
  assert.equal(isFallingBlock({ name: 'white_concrete_powder' }), true)
})

test('extendScaffolding actually installs them on a Movements object', () => {
  // The list is inert unless the ids reach movements.scafoldingBlocks -- the
  // exact defect this list was created to fix in the first place.
  const registry = { itemsByName: Object.fromEntries(
    PATHFINDER_SCAFFOLD.map((n, i) => [n, { id: 1000 + i }])) }
  const moves = { scafoldingBlocks: [3, 4] }        // pathfinder's dirt + cobblestone
  const added = extendScaffolding(moves, registry)
  assert.equal(added, PATHFINDER_SCAFFOLD.length)
  assert.ok(moves.scafoldingBlocks.includes(registry.itemsByName.birch_log.id),
    'birch_log must end up in the pathfinder list')
  assert.ok(moves.scafoldingBlocks.includes(3) && moves.scafoldingBlocks.includes(4),
    'the seeded ids must survive')
})

test('it is idempotent and safe on junk', () => {
  const registry = { itemsByName: { oak_log: { id: 17 } } }
  const moves = { scafoldingBlocks: [] }
  assert.equal(extendScaffolding(moves, registry), 1)
  assert.equal(extendScaffolding(moves, registry), 0, 'a second call adds nothing')
  assert.equal(moves.scafoldingBlocks.length, 1)
  assert.equal(extendScaffolding(null, registry), 0)
  assert.equal(extendScaffolding(moves, null), 0)
  assert.equal(extendScaffolding({}, registry), 0, 'no scafoldingBlocks array is a no-op')
})

test('a name the registry does not know is skipped, not pushed as undefined', () => {
  // The list is written generously across wood types; a server without cherry
  // wood must not end up with `undefined` in its scaffolding ids.
  const moves = { scafoldingBlocks: [] }
  extendScaffolding(moves, { itemsByName: { oak_log: { id: 17 } } })
  assert.deepEqual(moves.scafoldingBlocks, [17])
  assert.ok(moves.scafoldingBlocks.every(id => Number.isInteger(id)))
})

test('MUTANT: dropping wood from the list must be caught', () => {
  // A list assertion that has never been seen to fail is not a test.
  const mutant = PATHFINDER_SCAFFOLD.filter(n => !n.endsWith('_log') && !n.endsWith('_planks'))
  assert.ok(!mutant.includes('birch_log'),
    'sanity: the mutant really does remove the wood')
  assert.ok(PATHFINDER_SCAFFOLD.includes('birch_log'),
    'and the real list still has it — this is the assertion the mutant kills')
  assert.ok(PATHFINDER_SCAFFOLD.length > mutant.length + 10,
    'the wood entries are a substantial share of the list')
})
