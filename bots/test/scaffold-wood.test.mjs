// PATHFINDER_SCAFFOLD WAS ENTIRELY STONE-FAMILY, AND THIS FLEET CARRIES WOOD.
//
// mineflayer-pathfinder seeds `scafoldingBlocks` with exactly dirt and
// cobblestone, and getMoveUp bails on `node.remainingBlocks === 0` -- so a bot
// holding nothing on the list cannot tower or bridge, and A* returns no route
// rather than "you could climb".
//
// HONEST SCOPE: measured across all 80 bots, 81.2% ALREADY hold something on
// the old list. This is not the cause of the fleet's 2,753 no-legal-move events
// and is not claimed to be. It helps the 16.2% -- 13 bots -- who hold wood and
// nothing else the pathfinder accepts. oak_log alone is carried by 62 of 80.
import assert from 'node:assert'
import test from 'node:test'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { PATHFINDER_SCAFFOLD, FALLING, extendScaffolding } = await import('../src/scaffold.mjs')

test('wood is on the list', () => {
  for (const w of ['oak_planks', 'oak_log', 'birch_planks']) {
    assert.ok(PATHFINDER_SCAFFOLD.includes(w), `${w} must be plannable scaffold`)
  }
})

test('nothing that falls is on it', () => {
  // The single property this list encodes: a bridge made of it must not fall
  // out from under the bot. Sand is carried by 62 of 80 bots and stays off.
  for (const f of FALLING) {
    assert.ok(!PATHFINDER_SCAFFOLD.includes(f),
      `${f} obeys gravity and must never be plannable as a bridge`)
  }
})

test('every name is real, or the entry silently does nothing', async () => {
  // extendScaffolding skips names the registry does not know, so a typo here is
  // invisible rather than loud. Check them against real data.
  const mcd = (await import('minecraft-data')).default('1.21.8')
  const missing = PATHFINDER_SCAFFOLD.filter(n => !mcd.itemsByName[n])
  assert.deepEqual(missing, [], `not real items on 1.21.8: ${missing.join(', ')}`)
})

test('extendScaffolding actually adds them to a Movements', async () => {
  const mcd = (await import('minecraft-data')).default('1.21.8')
  const moves = { scafoldingBlocks: [mcd.itemsByName.dirt.id] }
  const added = extendScaffolding(moves, mcd)
  assert.ok(added > 20, `expected the full list to be added, got ${added}`)
  assert.ok(moves.scafoldingBlocks.includes(mcd.itemsByName.oak_planks.id),
    'planks reached the live movements object')
  // Idempotent: a second call must not duplicate.
  assert.equal(extendScaffolding(moves, mcd), 0, 'calling twice adds nothing')
})
