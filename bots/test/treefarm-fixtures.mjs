// FIXTURES shared by the tree-farm composition tests (treefarm-compose.test.mjs): the synthetic world and the fake town
// whose SERVER is separate from the client, copied from treefarm.test.mjs (that file keeps its own copy, unchanged, so its
// reviewed tests are not touched by this one). Not a test file: the runner only picks up *.test.mjs.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.8')
const Block = require('prismarine-block')('1.21.8')
const BP = await import('../src/blueprint.mjs')

// ---- a synthetic world: grass at y=63 everywhere, air above; overrides by key ------------------------------------------
export const K = (x, y, z) => `${x},${y},${z}`
export function world (over = {}, { unloaded = new Set(), ground = 63 } = {}) {
  const m = new Map(Object.entries(over))
  const nameAt = (x, y, z) => m.get(K(x, y, z)) ?? (y < ground ? 'dirt' : y === ground ? 'grass_block' : 'air')
  const read = (x, y, z) => {
    if (unloaded.has(K(x, y, z))) return null
    const name = nameAt(x, y, z), def = REG.blocksByName[name]
    return { name, boundingBox: def?.boundingBox ?? 'block' }
  }
  return { m, nameAt, read, set: (x, y, z, n) => m.set(K(x, y, z), n) }
}
const STATE_ID = name => REG.blocksByName[name].minStateId
/**
 * A town on flat grass with a SERVER separate from the client. `server(mode)` decides what a placement or dig gets:
 *   ok      the cell changes and a block_change packet says so
 *   silent  nothing changes and nothing is said
 *   refuse  the old block is re-sent
 *   ghost   the CLIENT world changes but the server says nothing (mineflayer's own dig prediction)
 */
export function fakeTown ({ items = [], over = {}, name = 'b-Alpha', worldId = 'w1', mode = () => 'ok', storeDir = null, shared = null } = {}) {
  process.env.POOL_STATE_DIR = storeDir ?? mkdtempSync(path.join(tmpdir(), 'treefarm-town-'))
  const w = shared ?? world(over)
  const client = new EventEmitter()
  const slots = new Array(46).fill(null)
  let next = 9
  for (const it of items) { while (slots[next] || next === 36) next++; slots[next] = { ...it, type: REG.itemsByName[it.name].id, slot: next } }
  const state = { places: [], digs: [], gotos: 0, events: [] }
  const blockAt = p => {
    const v = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    const n = w.nameAt(v.x, v.y, v.z), def = REG.blocksByName[n]
    const b = Block.fromStateId(def.minStateId, 0)
    b.position = v
    return b
  }
  const send = (c, n) => client.emit('block_change', { location: { x: c.x, y: c.y, z: c.z }, type: STATE_ID(n) })
  const bot = {
    username: name, worldId, _client: client, registry: REG, players: {}, entities: {}, quickBarSlot: 0,
    controlState: { sneak: false },
    entity: { position: new Vec3(0.5, 64, 2.5), width: 0.6, height: 1.8 },
    get heldItem () { return slots[36 + bot.quickBarSlot] ?? null },
    inventory: { slots, items: () => slots.slice(9, 45).filter(s => s && s.count > 0) },
    setQuickBarSlot (n) { bot.quickBarSlot = n },
    equip: async item => {
      await state.onEquip?.(item)
      if (state.equipFails?.(item)) throw new Error('equip rejected')
      if (!item || slots[item.slot] !== item) throw new Error('not in inventory')
      if (item.slot >= 36) { bot.quickBarSlot = item.slot - 36; return }
      const d = [36, 37, 38, 39, 40, 41, 42, 43, 44].find(i => !slots[i]) ?? 36
      bot.quickBarSlot = d - 36
      const other = slots[d], from = item.slot
      slots[d] = item; item.slot = d; slots[from] = other; if (other) other.slot = from
    },
    unequip: async () => { throw new Error('unequip tosses on a full bag: never used') },
    lookAt: async p => { await state.onLook?.(p) }, setControlState () {}, clearControlStates () {}, stopDigging () {},
    blockAt,
    waitForTicks: async n => { await new Promise(r => setTimeout(r, Math.min(20, n))) },
    pathfinder: {
      setGoal () {}, stop () {},
      goto: async goal => { state.gotos++; bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); await state.onGoto?.(goal) },
    },
    placeBlock: async (ref, face) => {
      const c = ref.position.plus(face), h = bot.heldItem
      assert.ok(h, 'placing with an empty hand')
      assert.ok(BP.reachOf(bot.entity.position.floored(), c) <= BP.REACH + 1e-9, 'placed from out of reach')
      const m = mode('place', c, h.name)
      state.places.push({ at: `${c.x},${c.y},${c.z}`, item: h.name, mode: m })
      await state.onPlace?.(c, h.name)
      if (m === 'ok') { h.count--; if (!h.count) slots[h.slot] = null; w.set(c.x, c.y, c.z, h.name); setTimeout(() => send(c, h.name), 5) }
      if (m === 'refuse') setTimeout(() => send(c, w.nameAt(c.x, c.y, c.z)), 5)
      if (m === 'ghost') w.set(c.x, c.y, c.z, h.name)
    },
    dig: async b => {
      const c = b.position, m = mode('dig', c, b.name)
      state.digs.push({ at: `${c.x},${c.y},${c.z}`, name: b.name, mode: m })
      if (m === 'ok') { w.set(c.x, c.y, c.z, 'air'); setTimeout(() => send(c, 'air'), 5) }
      if (m === 'ghost') w.set(c.x, c.y, c.z, 'air')
      if (m === 'refuse') setTimeout(() => send(c, b.name), 5)
    },
    // BONE MEAL, as vanilla: a use on a sapling always consumes one (the server's bag); `bonemeal(cell)` decides whether
    // the tree grew ('grow': the cell becomes a log and the server says so) or not (a stage step clients never see)
    activateBlock: async b => {
      const h = bot.heldItem, c = b.position
      state.activations = (state.activations ?? 0) + 1
      if (h?.name !== 'bone_meal' || !/_sapling$/.test(w.nameAt(c.x, c.y, c.z))) return
      const take = () => { h.count--; if (!h.count) slots[h.slot] = null }
      if (state.bagLagMs) setTimeout(take, state.bagLagMs); else take()   // the server's bag update may come late
      state.bonemealed = [...(state.bonemealed ?? []), `${c.x},${c.y},${c.z}`]
      if (state.bonemeal?.(c) === 'grow') { w.set(c.x, c.y, c.z, 'birch_log'); setTimeout(() => send(c, 'birch_log'), 5) }
    },
  }
  return { bot, w, state, slots, client }
}
export const S = (name, count) => ({ name, count })
