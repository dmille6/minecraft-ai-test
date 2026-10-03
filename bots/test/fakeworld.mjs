// A SMALL FAKE WORLD FOR DRIVING deposit / place THROUGH THE REAL SKILL CODE (chest-full.test.mjs, storage-full.test.mjs).
//
// Flat: grass_block at y <= 63, air above, unless a cell is set. Containers hold real slot arrays, and a container
// window's deposit() behaves as mineflayer 4.37.1's transfer does where it matters here: it LIFTS the source stack onto
// the cursor (inventory.js:301) and throws `destination full` (:323) with the stack still on the cursor when no slot
// takes it. close() drops whatever is on the cursor into `dropped` -- the never-drop check reads it.
import { Vec3 } from 'vec3'

export const NAMES = ['air', 'grass_block', 'stone', 'chest', 'trapped_chest', 'barrel', 'composter', 'oak_log', 'cobblestone', 'dirt', 'oak_planks', 'apple']
const SOLID = new Set(['grass_block', 'stone', 'chest', 'trapped_chest', 'barrel', 'composter', 'oak_log', 'cobblestone', 'dirt', 'oak_planks'])
const CONTAINER = /^(chest|trapped_chest|barrel)$/
const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`

export function fakeWorld ({ bag = [], at = [6.5, 64, 0.5] } = {}) {
  const cells = new Map()       // key -> name
  const props = new Map()       // key -> block state properties
  const containers = new Map()  // key -> { slots }
  const dropped = []
  const spy = { recipesFor: 0, craft: 0, placed: [], opened: [], gotos: [] }
  const nameAt = (x, y, z) => cells.get(key(x, y, z)) ?? (y <= 63 ? 'grass_block' : 'air')
  const block = p => {
    const v = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    const name = nameAt(v.x, v.y, v.z)
    return { name, type: NAMES.indexOf(name), boundingBox: SOLID.has(name) ? 'block' : 'empty', position: v, diggable: true,
             getProperties: () => props.get(key(v.x, v.y, v.z)) ?? {} }
  }
  const set = (x, y, z, name, p = null) => {
    cells.set(key(x, y, z), name)
    if (p) props.set(key(x, y, z), p)
    if (CONTAINER.test(name) && !containers.has(key(x, y, z))) containers.set(key(x, y, z), { slots: Array(27).fill(null) })
  }
  const fill = (x, y, z, name = 'stone', count = 64) => { const c = containers.get(key(x, y, z)); c.slots = c.slots.map(() => ({ name, type: NAMES.indexOf(name), count })) }
  const items = () => bag.filter(Boolean)
  const explicit = () => [...cells.keys()].map(k => k.split(',').map(Number))
  const bot = {
    entity: { position: new Vec3(...at), onGround: true, velocity: new Vec3(0, 0, 0), width: 0.6, height: 1.8 },
    entities: {},
    health: 20, food: 20, version: '1.21.8',
    registry: { blocks: Object.fromEntries(NAMES.map((n, i) => [i, { name: n }])),
                blocksByName: Object.fromEntries(NAMES.map((n, i) => [n, { id: i, name: n }])),
                itemsByName: Object.fromEntries(NAMES.map((n, i) => [n, { id: i, name: n }])), itemsArray: [] },
    inventory: { items, emptySlotCount: () => 36 - items().length, slots: [] },
    heldItem: null,
    currentWindow: null,
    blockAt: block,
    findBlock ({ matching, maxDistance = 16, point = null } = {}) {
      const from = point ?? bot.entity.position
      let best = null, bd = Infinity
      for (const [x, y, z] of explicit()) {
        const b = block({ x, y, z })
        const d = b.position.distanceTo(from)
        if (d <= maxDistance && matching(b) && d < bd) { best = b; bd = d }
      }
      return best
    },
    findBlocks ({ matching, maxDistance = 16, point = null, count = 1 } = {}) {
      const from = point ?? bot.entity.position
      return explicit().map(([x, y, z]) => block({ x, y, z })).filter(b => b.position.distanceTo(from) <= maxDistance && matching(b))
        .sort((a, b) => a.position.distanceTo(from) - b.position.distanceTo(from)).slice(0, count).map(b => b.position)
    },
    pathfinder: {
      movements: {}, setMovements () {}, setGoal () {}, stop () {},
      async goto (goal) {
        spy.gotos.push({ x: goal.x, y: goal.y, z: goal.z })
        if (goal.constructor?.name === 'GoalBlock') { bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); return }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (nameAt(goal.x + dx, goal.y, goal.z + dz) === 'air') { bot.entity.position = new Vec3(goal.x + dx + 0.5, goal.y, goal.z + dz + 0.5); return }
        }
      },
    },
    async openContainer (b) {
      const c = containers.get(key(b.position.x, b.position.y, b.position.z))
      if (!c) throw new Error('not a container')
      spy.opened.push(key(b.position.x, b.position.y, b.position.z))
      const w = {
        inventoryStart: c.slots.length, inventoryEnd: c.slots.length + 36, selectedItem: null,
        containerItems: () => c.slots.filter(Boolean),
        items: () => items(),
        firstEmptySlotRange (start, end) {
          if (start >= w.inventoryStart) return items().length < 36 ? w.inventoryStart + items().length : null
          const i = c.slots.findIndex(s => !s); return i >= 0 && i >= start && i < end ? i : null
        },
        async deposit (type, _meta, count) {
          let left = count
          while (left > 0) {
            if (!w.selectedItem) {
              const i = bag.findIndex(it => it && it.type === type)
              if (i < 0) throw new Error(`Can't find ${type}`)
              w.selectedItem = bag.splice(i, 1)[0]
            }
            let dest = c.slots.findIndex(s => s && s.type === type && s.count < 64)
            if (dest < 0) dest = c.slots.findIndex(s => !s)
            if (dest < 0) throw new Error('destination full')
            const sel = w.selectedItem
            const room = c.slots[dest] ? 64 - c.slots[dest].count : 64
            const mv = Math.min(room, sel.count, left)
            c.slots[dest] = c.slots[dest] ? { ...c.slots[dest], count: c.slots[dest].count + mv } : { name: sel.name, type: sel.type, count: mv }
            sel.count -= mv; left -= mv
            if (sel.count === 0) w.selectedItem = null
          }
          if (w.selectedItem) { bag.push(w.selectedItem); w.selectedItem = null }
        },
        close () { if (w.selectedItem) { dropped.push(w.selectedItem); w.selectedItem = null } bot.currentWindow = null },
      }
      bot.currentWindow = w
      return w
    },
    async clickWindow (slot) {
      const w = bot.currentWindow
      if (w?.selectedItem && slot >= w.inventoryStart) { bag.push(w.selectedItem); w.selectedItem = null }
    },
    async equip (it) { bot.heldItem = it },
    async lookAt () {},
    async placeBlock (ref, face) {
      const t = ref.position.offset(face.x, face.y, face.z)
      const held = bot.heldItem
      if (!held || !(held.count > 0)) throw new Error('nothing held')
      set(t.x, t.y, t.z, held.name)
      held.count -= 1
      if (held.count === 0) { bag.splice(bag.indexOf(held), 1); bot.heldItem = null }
      spy.placed.push(key(t.x, t.y, t.z))
    },
    recipesFor () { spy.recipesFor++; return [] },
    async craft () { spy.craft++; throw new Error('the fake cannot craft') },
    setControlState () {}, on () {}, off () {}, once () {}, removeListener () {}, waitForTicks: async () => {}, chat () {},
  }
  return { bot, set, fill, cells, containers, dropped, spy, bag, nameAt, key }
}

export const stack = (name, count) => ({ name, type: NAMES.indexOf(name), count })
export const total = bag => bag.filter(Boolean).reduce((n, it) => n + it.count, 0)
