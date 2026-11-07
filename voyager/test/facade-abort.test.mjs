// voyager-01: the vy_ skills make no move after an abort (Codex r2 B1) -- mocks of the mineflayer calls they use.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { vyChest, vyPlace, Vec3 } from '../src/facade.mjs'

const block = (name, extra = {}) => ({ name, boundingBox: name === 'air' ? 'empty' : 'block', ...extra })

test('vyChest: an abort while the chest opens means no withdrawal', async () => {
  const ac = new AbortController()
  let withdrew = 0, closed = 0
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    registry: { itemsByName: { oak_log: { id: 1 } } },
    inventory: { items: () => [] },
    blockAt: () => block('chest'),
    openContainer: async () => { ac.abort(); return { withdraw: async () => { withdrew++ }, deposit: async () => {}, close: () => { closed++ } } },
  }
  const r = await vyChest({ bot }, { x: 1, y: 64, z: 0, mode: 'take', item: 'oak_log', count: 1 }, ac.signal)
  assert.equal(r.status, 'aborted')
  assert.equal(withdrew, 0)
  assert.equal(closed, 1)
})

test('vyPlace: an abort during the equip means no placement', async () => {
  const ac = new AbortController()
  let placed = 0
  const bot = {
    voyager: { spawn: { x: 100, y: 64, z: 100 } },
    entity: { position: new Vec3(0.5, 64, 0.5) },
    registry: { itemsByName: { cobblestone: { id: 2 } }, blocksByName: { cobblestone: { id: 2 } } },
    inventory: { items: () => [{ name: 'cobblestone', count: 5 }] },
    blockAt: (p) => (p.y < 64 ? block('stone') : block('air')),
    equip: async () => { ac.abort() },
    placeBlock: async () => { placed++ },
  }
  const r = await vyPlace({ bot }, { item: 'cobblestone', x: 2, y: 64, z: 0 }, ac.signal)
  assert.equal(r.status, 'aborted')
  assert.equal(placed, 0)
})
