// A SMALL FAKE WORLD FOR DRIVING deposit / place THROUGH THE REAL SKILL CODE (chest-full.test.mjs, storage-full.test.mjs).
//
// Flat: grass_block at y <= 63, air above, unless a cell is set. Containers hold real slot arrays, and a container
// window's deposit() behaves as mineflayer 4.37.1's transfer does where it matters here: it LIFTS the source stack onto
// the cursor (inventory.js:301) and throws `destination full` (:323) with the stack still on the cursor when no slot
// takes it. close() puts whatever is still on the cursor into `dropped`. THAT IS A CHOSEN, WORST-CASE BEHAVIOUR, NOT
// VANILLA: Paper 1.21.8 (AbstractContainerMenu.removed -> dropOrPlaceInInventory) returns a carried stack to the
// player's inventory on close and drops it only when there is no room. The fake drops always, so a stack left on the
// cursor is visible to the test however full the bag is; on the server the same mistake is usually a client/server
// disagreement about the bag rather than an item on the ground.
//
// CLICKS (withdraw, 10-04): a window's slots are the container's then the bag's (bag index i is window slot
// inventoryStart + i, empty entries allowed), and clickWindow plays vanilla's click modes on them -- left click picks
// up / puts down / merges / swaps, right click puts ONE down, shift-click (mode 1) moves a stack to the other side
// (merging into partial stacks first; with no room it stays where it was), slot -999 drops the cursor.
import { Vec3 } from 'vec3'
import { EventEmitter } from 'node:events'

export const NAMES = ['air', 'grass_block', 'stone', 'chest', 'trapped_chest', 'barrel', 'composter', 'oak_log', 'cobblestone', 'dirt', 'oak_planks', 'apple', 'water', 'crafting_table',
  'stick', 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'stone_axe', 'cobbled_deepslate', 'birch_planks', 'bamboo', 'leaf_litter', 'torch', 'oak_trapdoor']
const SOLID = new Set(['grass_block', 'stone', 'chest', 'trapped_chest', 'barrel', 'composter', 'oak_log', 'cobblestone', 'dirt', 'oak_planks', 'crafting_table'])
const CONTAINER = /^(chest|trapped_chest|barrel)$/
const HARDNESS = { grass_block: 0.6, dirt: 0.5, stone: 1.5, cobblestone: 2, oak_log: 2, oak_planks: 2, chest: 2.5, trapped_chest: 2.5, barrel: 2.5, crafting_table: 2.5, composter: 0.6 }
const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`

export function fakeWorld ({ bag = [], at = [6.5, 64, 0.5] } = {}) {
  const cells = new Map()       // key -> name
  const props = new Map()       // key -> block state properties
  const containers = new Map()  // key -> { slots }
  const dropped = []
  const spy = { recipesFor: 0, craft: 0, placed: [], opened: [], gotos: [], clicks: [] }
  const events = new EventEmitter()
  const nameAt = (x, y, z) => cells.get(key(x, y, z)) ?? (y <= 63 ? 'grass_block' : 'air')
  const block = p => {
    const v = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    const name = nameAt(v.x, v.y, v.z)
    // shapes and hardness as mineflayer gives them (the junk well's checks read both: a full cube, a diggable block)
    return { name, type: NAMES.indexOf(name), boundingBox: SOLID.has(name) ? 'block' : 'empty', position: v, diggable: true,
             shapes: SOLID.has(name) ? [[0, 0, 0, 1, 1, 1]] : [], hardness: SOLID.has(name) ? (HARDNESS[name] ?? 1.5) : 0,
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
      const size = c.slots.length
      const w = {
        id: 1,
        inventoryStart: size, inventoryEnd: size + 36, selectedItem: null,
        get (s) { return s < size ? (c.slots[s] ?? null) : (bag[s - size] ?? null) },
        put (s, v) { if (s < size) c.slots[s] = v; else bag[s - size] = v },
        containerItems: () => c.slots.map((x, i) => { if (x) x.slot = i; return x }).filter(Boolean),
        items: () => bag.map((x, i) => { if (x) x.slot = size + i; return x }).filter(Boolean),
        firstEmptySlotRange (start, end) {
          for (let s = start; s < end; s++) if (!w.get(s)) return s
          return null
        },
        findItemRange (start, end, type, _meta, notFull) {
          for (let s = start; s < end; s++) {
            const x = w.get(s)
            if (x && x.type === type && (!notFull || x.count < (x.stackSize ?? 64))) { x.slot = s; return x }
          }
          return null
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
    async clickWindow (slot, button = 0, mode = 0) {
      const w = bot.currentWindow
      if (!w) return
      spy.clicks.push([slot, button, mode])
      const tool = x => !!x?.maxDurability
      if (slot === -999) { if (w.selectedItem) { dropped.push(w.selectedItem); w.selectedItem = null } return }
      const it = w.get(slot)
      if (mode === 2) {                                   // number key: this slot <-> hotbar[button], nothing carried
        if (w.selectedItem || button < 0 || button > 8) return
        const hs = w.inventoryEnd - 9 + button
        const h = w.get(hs)
        w.put(slot, h ?? null); w.put(hs, it ?? null)
        return
      }
      if (mode === 1) {                                   // shift-click: to the other side, partial stacks first
        if (!it) return
        const [a, b] = slot < w.inventoryStart ? [w.inventoryStart, w.inventoryEnd] : [0, w.inventoryStart]
        if (!tool(it)) {
          for (let s = a; s < b && it.count > 0; s++) {
            const x = w.get(s)
            if (x && x.name === it.name && x.count < 64) { const mv = Math.min(64 - x.count, it.count); x.count += mv; it.count -= mv }
          }
        }
        if (it.count > 0) { const d = w.firstEmptySlotRange(a, b); if (d != null) { w.put(d, it); w.put(slot, null) } }
        else w.put(slot, null)
        return
      }
      const sel = w.selectedItem
      if (button === 0) {
        if (!sel) { if (it) { w.selectedItem = it; w.put(slot, null) } return }
        if (!it) { w.put(slot, sel); w.selectedItem = null; return }
        if (it.name === sel.name && !tool(it)) { const mv = Math.min(64 - it.count, sel.count); it.count += mv; sel.count -= mv; if (!sel.count) w.selectedItem = null; return }
        w.put(slot, sel); w.selectedItem = it
        return
      }
      if (button === 1 && !sel) {                         // right-click on a stack: pick up HALF, rounded up
        if (!it) return
        const half = Math.ceil(it.count / 2)
        w.selectedItem = { ...it, count: half }
        it.count -= half
        if (!it.count) w.put(slot, null)
        return
      }
      if (button === 1 && sel) {
        if (!it) w.put(slot, { ...sel, count: 1 })
        else if (it.name === sel.name && it.count < 64 && !tool(it)) it.count++
        else return
        sel.count--
        if (!sel.count) w.selectedItem = null
      }
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
    setControlState () {}, waitForTicks: async () => {}, chat () {},
    // real events (a disconnect, 'end', must reach the listeners that wait for it)
    on: (...a) => events.on(...a), off: (...a) => events.off(...a), once: (...a) => events.once(...a),
    removeListener: (...a) => events.removeListener(...a), emit: (...a) => events.emit(...a), listenerCount: n => events.listenerCount(n),
  }
  /** Put exactly these stacks into the container at x,y,z (slot order). */
  const stock = (x, y, z, stacks) => { const c = containers.get(key(x, y, z)); c.slots = Array(c.slots.length).fill(null); stacks.forEach((s, i) => { c.slots[i] = s }) }
  return { bot, set, fill, stock, cells, containers, dropped, spy, bag, nameAt, key }
}

export const stack = (name, count) => ({ name, type: NAMES.indexOf(name), count })
/** A tool copy: max durability and wear, as prismarine-item reports them. */
export const tool = (name, used = 0, max = { wooden: 59, stone: 131, iron: 250, golden: 32 }[name.split('_')[0]] ?? 131) =>
  ({ name, type: NAMES.indexOf(name), count: 1, maxDurability: max, durabilityUsed: used })
export const total = bag => bag.filter(Boolean).reduce((n, it) => n + it.count, 0)
