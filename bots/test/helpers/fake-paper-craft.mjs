// A FAKE PAPER FOR CRAFTING, driving mineflayer 4.37.1's REAL inventory.js and craft.js.
//
// The point is that the bot side is not a fake: bot.craft, clickWindow, putAway and putSelectedItemRange are
// mineflayer's own code, injected onto a bare EventEmitter whose _client.write goes to this server. Only the
// server is modelled, and only the four behaviours the sandbox trace showed (2026-10-03):
//
//   - the authoritative slots, cursor and result live HERE; a click is applied to them with vanilla's mode-0
//     semantics (left: pick/place/merge/swap; right: half/one/swap; result slot: take only onto an empty or
//     matching cursor, consuming one of each ingredient);
//   - a grid change answers with set_slot for the result slot (vanilla's slotChangedCraftingGrid);
//   - every container click is followed by a window-0 set_slot (what Paper does), which is why mineflayer's
//     single global stateId is usually window 0's when it next clicks the table;
//   - a click whose stateId is not the window's is APPLIED and answered with a full refresh (window_items) --
//     a snapshot taken when the click is applied, delivered BEHIND the client's burst: it is released when
//     `lagClicks` more clicks have arrived, or after `fallbackMs`, whichever is first. A client in lockstep is
//     waiting when the fallback fires, so its refresh lands before its next click; a bursting client has
//     already sent the next click, so the snapshot reverts a slot it has since changed.
//
// Server-to-client packets go out in batches, one batch per macrotask, emitted synchronously in order -- one
// server flush per TCP read. This is a model chosen to reproduce the trace, not Paper; the sandbox is the
// instrument that decides.
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export const VERSION = '1.21.8'
const registry = require('prismarine-registry')(VERSION)
const Item = require('prismarine-item')(registry)
const { Vec3 } = require('vec3')
const injectInventory = require('mineflayer/lib/plugins/inventory.js')
const injectCraft = require('mineflayer/lib/plugins/craft.js')

export { registry, Item }
export const id = (name) => registry.itemsByName[name].id
const notch = (it) => Item.toNotch(it ?? null)
const copy = (it) => (it ? new Item(it.type, it.count, it.metadata) : null)

export class FakePaper {
  constructor ({ lagClicks = 1, fallbackMs = 30, openDelayMs = 0, cursorOnOpen = null, inventory = {} } = {}) {
    this.cursorOnOpen = cursorOnOpen              // [name, count]: the server cursor is NOT empty when the table opens
    this.lagClicks = lagClicks
    this.fallbackMs = fallbackMs
    this.openDelayMs = openDelayMs                // Infinity: the table never opens (out of reach, gone)
    this.p = new Array(46).fill(null)          // player inventory, window-0 numbering (9-35 main, 36-44 hotbar)
    for (const [slot, [name, count]] of Object.entries(inventory)) this.p[+slot] = new Item(id(name), count)
    this.grid = { 0: new Array(5).fill(null), table: new Array(10).fill(null) }
    this.cursor = null
    this.sid = { 0: 500 }
    this.tableId = null
    this.nextWindowId = 1
    this.recipes = []                         // mineflayer Recipe objects the server knows
    this.clicks = 0
    this.staleClicks = 0
    this.writes = []                          // every client->server packet, with a timestamp
    this.pending = []                         // deferred refreshes
    this.outbox = []
    this.pumping = false
    this.dropped = []
    this.bot = null
  }

  // ---- views: window 0 is the player inventory (2x2 grid at 1-4); the table maps player 9-44 to 10-45
  gridOf (w) { return w === 0 ? this.grid[0] : this.grid.table }
  gridW (w) { return w === 0 ? 2 : 3 }
  get (w, slot) {
    if (slot === 0) return this.result(w)
    if (slot >= 1 && slot <= this.gridW(w) ** 2) return this.gridOf(w)[slot]
    return this.p[w === 0 ? slot : slot - 1]
  }
  set (w, slot, it) {
    if (slot >= 1 && slot <= this.gridW(w) ** 2) this.gridOf(w)[slot] = it
    else this.p[w === 0 ? slot : slot - 1] = it
  }
  slotsOf (w) { return Array.from({ length: 46 }, (_, i) => this.get(w, i)) }

  result (w) {
    const g = this.gridOf(w); const W = this.gridW(w)
    for (const r of this.recipes) {
      if (r.ingredients && !r.inShape) {                       // shapeless: the grid holds exactly the ingredients
        const have = g.filter(Boolean).map(it => it.type).sort().join()
        if (have && have === r.ingredients.map(i => i.id).sort().join()) return new Item(r.result.id, r.result.count)
        continue
      }
      if (!r.inShape) continue
      let ok = true
      for (let y = 0; y < W && ok; y++) {
        for (let x = 0; x < W && ok; x++) {
          const want = r.inShape[y]?.[x]?.id ?? -1
          const have = g[1 + x + W * y]
          ok = want === -1 ? !have : (!!have && have.type === want)
        }
      }
      if (ok) return new Item(r.result.id, r.result.count)
    }
    return null
  }

  count (name) {
    const t = id(name)
    return [...this.p, this.cursor].filter(it => it && it.type === t).reduce((n, it) => n + it.count, 0)
  }

  // ---- delivery
  send (batch) { this.outbox.push(batch); this.pump() }
  pump () {
    if (this.pumping || !this.outbox.length) return
    this.pumping = true
    setImmediate(() => {
      this.pumping = false
      const batch = this.outbox.shift()
      for (const [name, params] of batch) this.bot._client.emit(name, params)
      this.pump()
    })
  }
  release (pred) {
    const due = this.pending.filter(pred)
    if (!due.length) return
    this.pending = this.pending.filter(r => !due.includes(r))
    for (const r of due) clearTimeout(r.timer)
    this.send(due.map(r => r.packet))
  }
  refresh (w) {
    this.sid[w] = (this.sid[w] ?? 0) + 1
    const packet = ['window_items', { windowId: w, stateId: this.sid[w], items: this.slotsOf(w).map(notch), carriedItem: notch(this.cursor) }]
    const r = { packet, at: this.clicks + this.lagClicks }
    r.timer = setTimeout(() => this.release(x => x === r), this.fallbackMs)
    this.pending.push(r)
  }

  // ---- client -> server
  receive (name, params) {
    this.writes.push({ t: Date.now(), name, params })
    if (name === 'window_click') return this.onClick(params)
    if (name === 'close_window') return this.onClose(params)
  }

  onClick ({ windowId: w, stateId, slot, mouseButton, mode }) {
    this.clicks++
    this.release(r => r.at <= this.clicks)         // earlier refreshes the burst has now overtaken
    if (mode !== 0) throw new Error(`fake server: mode ${mode} not modelled`)
    if (w !== 0 && w !== this.tableId) return
    const stale = stateId !== this.sid[w]
    if (stale) this.staleClicks++
    const gridBefore = this.gridOf(w).map(it => it && `${it.type}x${it.count}`).join()
    this.apply(w, slot, mouseButton)
    const batch = []
    if (this.gridOf(w).map(it => it && `${it.type}x${it.count}`).join() !== gridBefore) {
      this.sid[w]++
      batch.push(['set_slot', { windowId: w, stateId: this.sid[w], slot: 0, item: notch(this.result(w)) }])
    }
    if (w !== 0) {
      this.sid[0]++
      batch.push(['set_slot', { windowId: 0, stateId: this.sid[0], slot: 36, item: notch(this.p[36]) }])
    }
    if (batch.length) this.send(batch)
    if (stale) this.refresh(w)
  }

  apply (w, slot, button) {
    const stack = (it) => registry.items[it.type].stackSize
    if (slot === -999) {
      if (!this.cursor) return
      const n = button === 0 ? this.cursor.count : 1
      this.dropped.push(new Item(this.cursor.type, n))
      this.cursor.count -= n
      if (this.cursor.count <= 0) this.cursor = null
      return
    }
    if (slot === 0) {                                // result slot
      const r = this.result(w)
      if (!r) return
      if (!this.cursor) this.cursor = r
      else if (this.cursor.type === r.type && this.cursor.count + r.count <= stack(r)) this.cursor.count += r.count
      else return                                    // cursor holds something else: nothing is taken
      const g = this.gridOf(w)
      for (let i = 1; i < g.length; i++) if (g[i]) { g[i].count--; if (g[i].count <= 0) g[i] = null }
      return
    }
    const it = this.get(w, slot)
    const c = this.cursor
    if (button === 0) {
      if (!c && !it) return
      if (!c) { this.cursor = it; this.set(w, slot, null); return }
      if (!it) { this.set(w, slot, c); this.cursor = null; return }
      if (it.type === c.type) {
        const n = Math.min(stack(it) - it.count, c.count)
        it.count += n; c.count -= n
        if (c.count <= 0) this.cursor = null
        return
      }
      this.set(w, slot, c); this.cursor = it        // swap
      return
    }
    if (button === 1) {
      if (!c) {
        if (!it) return
        const half = Math.ceil(it.count / 2)
        this.cursor = new Item(it.type, half); it.count -= half
        if (it.count <= 0) this.set(w, slot, null)
        return
      }
      if (!it) { this.set(w, slot, new Item(c.type, 1)); c.count--; if (c.count <= 0) this.cursor = null; return }
      if (it.type === c.type && it.count < stack(it)) { it.count++; c.count--; if (c.count <= 0) this.cursor = null; return }
      this.set(w, slot, c); this.cursor = it
    }
  }

  /** Return a stack to the player inventory (hotbar first, then main); returns the player slots it touched. */
  give (it, touched = new Set()) {
    if (!it) return touched
    const stack = registry.items[it.type].stackSize
    const order = [...Array.from({ length: 9 }, (_, i) => 36 + i), ...Array.from({ length: 27 }, (_, i) => 9 + i)]
    for (const s of order) {
      const x = this.p[s]
      if (x && x.type === it.type && x.count < stack) { const n = Math.min(stack - x.count, it.count); x.count += n; it.count -= n; touched.add(s) }
      if (!it.count) return touched
    }
    for (const s of order) if (!this.p[s]) { this.p[s] = it; touched.add(s); return touched }
    this.dropped.push(it)
    return touched
  }

  /** Close: the grid and the cursor go back to the inventory, and -- like Paper's broadcastChanges -- only the
   *  player slots that CHANGED are sent. A slot the client wrongly believes in is not corrected by a close. */
  onClose ({ windowId: w }) {
    if (w !== 0 && w !== this.tableId) return
    const touched = new Set()
    const g = w === 0 ? this.grid[0] : this.grid.table
    for (let i = 1; i < g.length; i++) { this.give(g[i], touched); g[i] = null }
    this.give(this.cursor, touched); this.cursor = null
    if (w !== 0) { this.tableId = null; this.release(() => true) }
    if (!touched.size) return
    this.send([...touched].map(s => { this.sid[0]++; return ['set_slot', { windowId: 0, stateId: this.sid[0], slot: s, item: notch(this.p[s]) }] }))
  }

  openTable () {
    if (this.openDelayMs === Infinity) return
    if (this.openDelayMs > 0) { const d = this.openDelayMs; this.openDelayMs = 0; setTimeout(() => this.openTable(), d); return }
    const w = this.tableId = this.nextWindowId++
    this.sid[w] = 1
    if (this.cursorOnOpen) { this.cursor = new Item(id(this.cursorOnOpen[0]), this.cursorOnOpen[1]); this.cursorOnOpen = null }
    this.send([
      ['open_window', { windowId: w, inventoryType: 'minecraft:crafting', windowTitle: '{"text":"Crafting"}' }],
      ['window_items', { windowId: w, stateId: this.sid[w], items: this.slotsOf(w).map(notch), carriedItem: notch(this.cursor) }],
    ])
  }

  /** Push the server's player inventory to the client and wait until it has been delivered. */
  async sync () {
    this.sid[0]++
    this.send([['window_items', { windowId: 0, stateId: this.sid[0], items: this.slotsOf(0).map(notch), carriedItem: notch(null) }]])
    await this.settle()
  }

  /** Wait until nothing is queued or deferred. */
  async settle () {
    for (let i = 0; i < 500 && (this.outbox.length || this.pending.length || this.pumping); i++) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }

  stop () { for (const r of this.pending) clearTimeout(r.timer); this.pending = [] }
}

/** A bot carrying mineflayer's real inventory + craft plugins, wired to a FakePaper. */
export function craftBot (server) {
  const bot = new EventEmitter()
  bot.registry = registry
  bot.version = VERSION
  bot.supportFeature = registry.supportFeature
  bot.QUICK_BAR_START = 36
  bot.entity = { id: 1, position: new Vec3(0, 64, 0), yaw: 0, pitch: 0 }
  bot.game = { gameMode: 'survival' }
  bot._client = new EventEmitter()
  bot._client.write = (name, params) => server.receive(name, params)
  injectInventory(bot, { hideErrors: true })
  injectCraft(bot)
  bot.activateBlock = async () => server.openTable()
  server.bot = bot
  return bot
}

/** The recipe mineflayer would pick for `name` (table or not), registered with the server too. */
export function recipeFor (bot, server, name, table) {
  const r = bot.recipesFor(id(name), null, 1, table ? { position: new Vec3(1, 64, 0) } : null)[0]
  if (!r) throw new Error(`no recipe for ${name} with this inventory`)
  server.recipes.push(r)
  return r
}
export const TABLE = { position: new Vec3(1, 64, 0), name: 'crafting_table' }

/** Every recipe mineflayer knows for these items, taught to the server (so a skill can choose its own). */
export function learnAll (bot, server, names) {
  for (const n of names) server.recipes.push(...(bot.recipesAll(id(n), null, true) ?? []))
}

/**
 * A FLAT WORLD for the craft skill's table branch: stone below y=64, air above, placed blocks remembered.
 * Just what skills.mjs's craft -> place -> findBlock -> craft path reads: blockAt, findBlock, placeBlock (takes
 * the item from the SERVER's inventory and syncs), equip/lookAt/pathfinder as no-ops. Returns the block map.
 */
export function fakeWorld (bot, server) {
  const placed = new Map()
  const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`
  bot.entity.onGround = true
  bot.entity.position = new Vec3(0.5, 64, 0.5)
  bot.game.dimension = 'overworld'
  bot.blockAt = (p) => {
    const pos = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    const name = placed.get(key(pos)) ?? (pos.y < 64 ? 'stone' : 'air')
    const solid = name !== 'air'
    return { name, type: registry.blocksByName[name].id, position: pos, boundingBox: solid ? 'block' : 'empty',
             diggable: true, shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [] }
  }
  bot.findBlock = ({ matching, maxDistance = 32 }) => {
    for (const k of placed.keys()) {
      const [x, y, z] = k.split(',').map(Number)
      const b = bot.blockAt(new Vec3(x, y, z))
      if (b.position.distanceTo(bot.entity.position) <= maxDistance && matching(b)) return b
    }
    return null
  }
  bot.placeBlock = async (ref, face) => {
    const at = ref.position.offset(face.x, face.y, face.z)
    const slot = server.p.findIndex((it, i) => i >= 36 && it && registry.items[it.type].name === 'crafting_table') >= 0
      ? server.p.findIndex((it, i) => i >= 36 && it && registry.items[it.type].name === 'crafting_table')
      : server.p.findIndex(it => it && registry.items[it.type].name === 'crafting_table')
    if (slot < 0) throw new Error('fake world: nothing to place')
    server.p[slot].count--
    if (!server.p[slot].count) server.p[slot] = null
    placed.set(key(at), 'crafting_table')
    await server.sync()
  }
  bot.equip = async () => {}
  bot.lookAt = async () => {}
  bot.pathfinder = { goto: async () => {}, setGoal: () => {}, stop: () => {} }
  return placed
}
