// CRAFT ROOM: no craft may reach mineflayer's toss, every craft is read back, and the table a craft put down comes
// back with it. The measurement and the mechanism are in src/craftroom.mjs.
//
// Two halves. The pure decisions (craftRoom, craftArrived, craftRoomRemedy, wearKeepsSlot, bagFill) are tested
// directly. The skill is then driven against a fake bot whose bag is a real 36-slot array, with REAL 1.21.8 recipes
// (prismarine-recipe over minecraft-data) and mineflayer's own put-away rule: join a compatible non-full stack, else
// the first empty slot, else THROW IT ON THE GROUND (inventory.js putSelectedItemRange). A fake that quietly made
// room would be modelling the fix instead of the bug.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Vec3 } from 'vec3'
import { EventEmitter } from 'node:events'

process.env.LOG_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-craft-room-'))
process.env.BOT_NAME = 'CraftRoomBot'

const require_ = createRequire(import.meta.url)
const mc = require_('minecraft-data')('1.21.8')
const { Recipe } = require_('prismarine-recipe')('1.21.8')

const { SKILLS } = await import('../src/skills.mjs')
const { Runner } = await import('../src/runner.mjs')
const { craftRoom, roomRecipe, craftArrived, craftRoomRemedy, wearKeepsSlot, bagFill, roomForOne, BAG_SLOTS,
        packetSays, serverVerdict } =
  await import('../src/craftroom.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// --- items ------------------------------------------------------------------
const item = (name, count = 1, { left = null } = {}) => {
  const d = mc.itemsByName[name]
  assert.ok(d, `no such item ${name}`)
  const it = { name, type: d.id, count, stackSize: d.stackSize }
  if (d.maxDurability) { it.maxDurability = d.maxDurability; it.durabilityUsed = left == null ? 0 : d.maxDurability - left }
  return it
}
const spent = name => item(name, 1, { left: 1 })
/** `n` slots: the given stacks first, the rest FULL stacks of cobblestone (full: nothing joins them). */
const bagOf = (n, stacks) => { const a = stacks.slice(); while (a.length < n) a.push(item('cobblestone', 64)); return a }
const recipeOf = (name, wants = {}) => {
  // The recipe variant the fake bot's recipesFor would hand back: the first whose ingredients are all wanted.
  const rs = Recipe.find(mc.itemsByName[name].id)
  return rs.find(r => r.delta.every(d => d.count > 0 || wants[mc.items[d.id].name])) ?? rs[0]
}
const room = (items, name, count = 1, wants) => craftRoom(items, roomRecipe(mc, recipeOf(name, wants), name), count)

// --- the pure decisions -----------------------------------------------------
await t('a pickaxe into a full bag whose ingredient stacks are only partly used: no room, one slot short', () => {
  const r = room(bagOf(36, [item('stick', 5)]), 'stone_pickaxe', 1, { cobblestone: 1, stick: 1 })
  assert.equal(r.ok, false); assert.equal(r.reason, 'no_room'); assert.equal(r.short, 1); assert.equal(r.peak, 37)
})

await t('consumed-slot reuse: a stack the recipe uses up entirely frees the slot the result lands in', () => {
  const r = room(bagOf(36, [item('stick', 2)]), 'stone_pickaxe', 1, { cobblestone: 1, stick: 1 })
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.peak, 36)
})

await t('the result joins a compatible non-full stack before it asks for a slot; a FULL stack is no help', () => {
  assert.equal(room(bagOf(36, [item('oak_log', 5), item('oak_planks', 10)]), 'oak_planks', 1, { oak_log: 1 }).ok, true)
  assert.equal(room(bagOf(36, [item('oak_log', 5), item('oak_planks', 64)]), 'oak_planks', 1, { oak_log: 1 }).ok, false)
  // 62 planks + 4 = 66: two land on the stack, two need a new slot
  assert.equal(room(bagOf(36, [item('oak_log', 5), item('oak_planks', 62)]), 'oak_planks', 1, { oak_log: 1 }).ok, false)
})

await t('ingredients come off the LARGEST stack first (the order that frees the fewest slots)', () => {
  // two stick stacks, 2 and 40: taking from the 2 would free a slot; the conservative order does not count on it
  const r = room(bagOf(36, [item('stick', 2), item('stick', 40)]), 'stone_pickaxe', 1, { cobblestone: 1, stick: 1 })
  assert.equal(r.ok, false)
})

await t('peak is checked across every repetition, and running out of an ingredient is named', () => {
  // 35 slots + 2 pickaxes: the first fits, the second does not
  const r = room(bagOf(35, [item('stick', 9)]), 'stone_pickaxe', 2, { cobblestone: 1, stick: 1 })
  assert.equal(r.ok, false); assert.equal(r.rep, 1); assert.equal(r.peak, 37)
  const out = room(bagOf(10, [item('stick', 2)]), 'stone_pickaxe', 2, { cobblestone: 1, stick: 1 })
  assert.equal(out.reason, 'ingredients'); assert.equal(out.missing, 'stick')
})

await t('craftArrived: a tool counts only as a NEW full-durability copy; a stack as a rise by the result count', () => {
  const res = roomRecipe(mc, recipeOf('stone_pickaxe', { cobblestone: 1, stick: 1 }), 'stone_pickaxe').result
  assert.equal(res.durable, true)
  const worn = item('stone_pickaxe', 1, { left: 40 })
  assert.equal(craftArrived([worn], [worn], res), false, 'nothing new')
  assert.equal(craftArrived([worn], [worn, item('stone_pickaxe')], res), true)
  assert.equal(craftArrived([], [item('stone_pickaxe', 1, { left: 3 })], res), false, 'a worn copy is not the craft')
  const planks = roomRecipe(mc, recipeOf('oak_planks'), 'oak_planks').result
  assert.equal(craftArrived([item('oak_planks', 10)], [item('oak_planks', 14)], planks), true)
  assert.equal(craftArrived([item('oak_planks', 10)], [item('oak_planks', 10)], planks), false)
})

await t('craftRoomRemedy: a spent axe first; a pickaxe craft may wear ONE spent pickaxe below the kept three; nothing else', () => {
  const PK = item('iron_pickaxe', 1, { left: 200 })
  assert.equal(craftRoomRemedy(bagOf(36, [PK, spent('stone_axe'), spent('stone_pickaxe')]), 'stone_pickaxe').tool.name, 'stone_axe')
  const three = bagOf(36, [PK, spent('stone_pickaxe'), spent('wooden_pickaxe'), spent('stone_pickaxe')])
  const r = craftRoomRemedy(three, 'stone_pickaxe')
  assert.equal(r.why, 'replaced'); assert.equal(r.tool.name, 'wooden_pickaxe', 'lowest tier first')
  assert.equal(craftRoomRemedy(three, 'oak_planks'), null, 'planks replace no pickaxe: the three stay')
  assert.equal(craftRoomRemedy(bagOf(36, [PK, item('stone_pickaxe', 1, { left: 0 })]), 'stone_pickaxe'), null, 'a 0-use phantom is not real')
  assert.equal(craftRoomRemedy(bagOf(36, [PK, item('stone_pickaxe', 1, { left: 2 })]), 'stone_pickaxe'), null, 'two uses is not spent')
})

await t('craftRoomRemedy PROTECTS THE LAST DIGGING TOOL: no pickaxe is worn out unless a pickaxe with 2+ uses survives it', () => {
  assert.equal(craftRoomRemedy(bagOf(36, [spent('stone_pickaxe')]), 'stone_pickaxe'), null, 'the only pickaxe, spent: it is the escape')
  assert.equal(craftRoomRemedy(bagOf(36, [spent('stone_pickaxe'), spent('stone_pickaxe'), spent('stone_pickaxe'), spent('stone_pickaxe')]),
    'stone_pickaxe'), null, 'four spent copies and no working one: the last swings are all it has')
  assert.equal(craftRoomRemedy(bagOf(36, [spent('stone_axe')]), 'stone_pickaxe')?.tool.name, 'stone_axe',
    'the survivor rule is for PICKAXES: a spent axe goes even with no pickaxe in the bag')
  assert.equal(craftRoomRemedy(bagOf(36, [spent('stone_axe'), item('stone_pickaxe', 1, { left: 2 })]), 'stone_pickaxe').tool.name,
    'stone_axe', 'a pickaxe with two uses survives the axe')
})

await t('bagFill ADVICE never names an ingredient, a non-block, wood or a station', () => {
  const isPlaceable = n => mc.blocksByName[n]?.boundingBox === 'block' && !!mc.itemsByName[n]
  const consumes = [{ name: 'cobblestone', count: 3 }, { name: 'stick', count: 2 }]
  const f = bagFill(bagOf(36, [item('cobblestone', 1), item('wheat', 1), item('oak_log', 1), item('crafting_table', 1), item('dirt', 1)]),
    isPlaceable, consumes)
  assert.deepEqual(f.cheapest, { name: 'dirt', count: 1 })
})

await t('THE MAPPING, verified against prismarine-windows: window 0 bag = slot, a 3x3 crafting window bag = slot - 1', () => {
  const W = require_('prismarine-windows')('1.21.8')
  const inv = W.createWindow(0, 'minecraft:inventory', 'Inventory'); const tbl = W.createWindow(1, 'minecraft:crafting', 'Crafting')
  assert.deepEqual([inv.inventoryStart, inv.inventoryEnd, tbl.inventoryStart, tbl.inventoryEnd], [9, 45, 10, 46])
})

await t('packetSays reads the CONTENT: shows/denies for a result bag slot; says nothing for the result cell, other windows, mid-click states', () => {
  const R = 882; const ctx = { resultId: R, expect: { 20: 1 }, craftWindow: 3 }
  const it = (id, n = 1) => ({ itemId: id, itemCount: n }); const empty = { itemCount: 0 }
  assert.equal(packetSays({ kind: 'set_slot', windowId: 0, slot: 20, item: it(R) }, ctx), 'shows')
  assert.equal(packetSays({ kind: 'set_slot', windowId: 3, slot: 21, item: it(R) }, ctx), 'shows', 'crafting window: bag + 1')
  assert.equal(packetSays({ kind: 'set_slot', windowId: 3, slot: 21, item: empty }, ctx), 'denies')
  assert.equal(packetSays({ kind: 'set_slot', windowId: 3, slot: 21, item: it(5) }, ctx), 'denies', 'something else there')
  assert.equal(packetSays({ kind: 'set_slot', windowId: 3, slot: 0, item: it(R) }, ctx), null, 'the result cell')
  assert.equal(packetSays({ kind: 'set_slot', windowId: 9, slot: 21, item: empty }, ctx), null, 'another window')
  const full = (bag, extra = {}) => { const items = Array(46).fill(empty); items[21] = bag; return { kind: 'window_items', windowId: 3, items, carriedItem: empty, ...extra } }
  assert.equal(packetSays(full(it(R))), null, 'no context, no claim')
  assert.equal(packetSays(full(it(R)), ctx), 'shows')
  assert.equal(packetSays(full(empty), ctx), 'denies')
  assert.equal(packetSays(full(empty, { carriedItem: it(R) }), ctx), null, 'result on the cursor: mid-click')
  const g = full(empty); g.items = g.items.slice(); g.items[2] = it(5); assert.equal(packetSays(g, ctx), null, 'ingredients in the grid: mid-click')
})

await t('serverVerdict: only packets after the final click; the LAST statement after a quiet that restarts; none at the deadline', () => {
  const R = 882; const ctx = { resultId: R, expect: { 20: 1 }, craftWindow: null, afterSeq: 5 }
  const o = { quietMs: 30, deadlineMs: 300 }
  const set = (seq, t, n) => ({ seq, t, kind: 'set_slot', windowId: 0, slot: 20, item: n ? { itemId: R, itemCount: n } : { itemCount: 0 } })
  assert.equal(serverVerdict([], ctx, 100, 0, o), 'wait', 'silence is not confirmation')
  assert.equal(serverVerdict([], ctx, 300, 0, o), 'none')
  assert.equal(serverVerdict([set(3, 1, 0)], ctx, 300, 0, o), 'none', 'before the final click: an opening snapshot')
  assert.equal(serverVerdict([set(6, 10, 1)], ctx, 39, 0, o), 'wait')
  assert.equal(serverVerdict([set(6, 10, 1)], ctx, 40, 0, o), 'server')
  assert.equal(serverVerdict([set(6, 10, 1), { seq: 7, t: 35, kind: 'set_slot', windowId: 0, slot: 30, item: { itemCount: 0 } }], ctx, 50, 0, o), 'wait', 'the quiet restarts')
  assert.equal(serverVerdict([set(6, 10, 1), set(7, 20, 0)], ctx, 60, 0, o), 'denied', 'the last statement wins')
})

await t('serverVerdict: the DEADLINE DOES NOT BYPASS QUIET -- a "shows" inside a burst still running at the deadline is none', () => {
  const R = 882; const ctx = { resultId: R, expect: { 20: 1 }, craftWindow: null, afterSeq: 0 }
  const o = { quietMs: 30, deadlineMs: 300 }
  const shows = { seq: 1, t: 290, kind: 'set_slot', windowId: 0, slot: 20, item: { itemId: R, itemCount: 1 } }
  assert.equal(serverVerdict([shows], ctx, 300, 0, o), 'none', 'confirmed with the burst unsettled')
  assert.equal(serverVerdict([shows], ctx, 320, 0, o), 'server', 'quiet after the deadline still confirms (the loop has stopped by then)')
})

await t('serverVerdict: PER-SLOT EVIDENCE -- every expected slot must show its count; a denial on one is not erased by another', () => {
  const R = 882; const ctx = { resultId: R, expect: { 20: 64, 21: 3 }, craftWindow: null, afterSeq: 0 }
  const o = { quietMs: 30, deadlineMs: 300 }
  const set = (seq, t, slot, n) => ({ seq, t, kind: 'set_slot', windowId: 0, slot, item: n ? { itemId: R, itemCount: n } : { itemCount: 0 } })
  assert.equal(serverVerdict([set(1, 10, 21, 0), set(2, 15, 20, 64)], ctx, 100, 0, o), 'denied', 'deny 21 then show 20')
  assert.equal(serverVerdict([set(1, 10, 20, 64)], ctx, 100, 0, o), 'wait', 'slot 21 has not been stated')
  assert.equal(serverVerdict([set(1, 10, 20, 64)], ctx, 300, 0, o), 'none')
  assert.equal(serverVerdict([set(1, 10, 20, 64), set(2, 12, 21, 3)], ctx, 100, 0, o), 'server')
  assert.equal(serverVerdict([set(1, 10, 21, 0), set(2, 12, 21, 3), set(3, 14, 20, 64)], ctx, 100, 0, o), 'server', 'the LATEST statement per slot')
})

await t('wearKeepsSlot: an axe on stone drops nothing; a pickaxe on stone needs a non-full cobblestone stack', () => {
  const drops = ['cobblestone']
  assert.equal(wearKeepsSlot(bagOf(36, []), 'stone_axe', 'stone', drops), true)
  assert.equal(wearKeepsSlot(bagOf(36, []), 'stone_pickaxe', 'stone', drops), false, 'every cobblestone stack is full')
  assert.equal(wearKeepsSlot(bagOf(36, [item('cobblestone', 30)]), 'stone_pickaxe', 'stone', drops), true)
  assert.equal(wearKeepsSlot(bagOf(36, []), 'stone_axe', 'dirt', ['dirt']), false, 'dirt drops for any tool')
})

await t('bagFill names what fills the bag and the smallest placeable stack', () => {
  const f = bagFill(bagOf(36, [item('dirt', 1), item('stick', 1)]), n => !!mc.blocksByName[n] && !!mc.itemsByName[n])
  assert.match(f.line, /^cobblestone 34 slots, dirt 1, stick 1$/)
  assert.deepEqual(f.cheapest, { name: 'dirt', count: 1 }, 'a stick is not a block')
  assert.equal(bagFill(bagOf(36, [item('dirt', 3)]), n => !!mc.blocksByName[n]).cheapest, null,
    'three dirt is three placements: advice names only a ONE-block stack')
  assert.equal(roomForOne(bagOf(36, [item('crafting_table', 1)]), 'crafting_table'), true, 'joins the stack')
  assert.equal(roomForOne(bagOf(36, []), 'crafting_table'), false)
  assert.equal(BAG_SLOTS, 36)
})

// --- the fake bot -----------------------------------------------------------
const key = p => `${p.x},${p.y},${p.z}`
/** Two side blocks at foot level with solid floor below: what the wear-out remedy may dig. */
const WALLS = [new Vec3(-1, 64, 0), new Vec3(0, 64, -1)]
/**
 * opts
 *   tables      crafting tables already standing (not this call's)
 *   craftLands  false: bot.craft returns and nothing arrives
 *   rejectMs    the client shows the result at once, the SERVER takes it back this many ms later: the slots are
 *               restored and a set_slot for the result slot says so (a rejected craft); no confirmation before it
 *   confirmMs   when the server's set_slot for the result slot arrives after a craft (null: never)
 *   noise       [ms...] unrelated set_slot packets (another slot) after each craft
 *   server      ({ send, full, winId, base, at, resultId, count, restore }) => void: what the SERVER sends after a
 *               craft, instead of the default confirmation. send(name, packet, ms); full({ cursor, grid, bagAt })
 *               builds a window_items from the bag as the server holds it (bagAt overrides one bag slot).
 *   afterDig    hook after each dig has landed (block, { putAway }) -- e.g. the server's auto-pickup of a stray item
 *   walls       stone at these cells (default WALLS: two side blocks at foot level, the only safe wear-out targets)
 *   toolBreakMs a tool's last use is taken off the bag this long AFTER the dig resolves (the server's slot update)
 *   tableDrop   {dx,dy,dz}: a dug table's item comes to rest here (from the cell's corner) as an entity, and is only
 *               taken by the pickup rule -- not straight into the bag
 *   onLook      hook on every lookAt -- including the one mineflayer's dig does itself unless forceLook is 'ignore'
 *   afterCraft  hook after each bot.craft ({ setBlock, world, slots })
 *   onDig       hook before each dig (block) -- e.g. an abort arriving mid-dig
 *   registry    a registry override (an id the bot cannot name)
 */
function makeBot (stacks, { tables = [], craftLands = true, rejectMs = 0, confirmMs = 10, noise = [], server = null, afterCraft = null,
                            onDig = null, afterDig = null, onGoto = null, onLook = null, registry = mc,
                            walls = WALLS, toolBreakMs = 0, tableDrop = null } = {}) {
  const slots = Array(36).fill(null)
  stacks.forEach((s, i) => { slots[i] = { ...s } })
  const world = new Map([...walls.map(p => [key(p), 'stone']), ...tables.map(p => [key(p), 'crafting_table'])])
  let entityId = 1000
  // THE SERVER'S PICKUP RULE (vanilla Player.aiStep: the player box 0.6 x 1.8 inflated (1.0, 0.5, 1.0) touches the
  // item's 0.25 box): item minus feet within |dx|,|dz| < 1.425 and dy in (-0.75, 2.3). Checked after every move.
  const sweep = () => {
    const f = bot.entity.position
    for (const [id, e] of Object.entries(bot.entities)) {
      const d = e.position.minus(f)
      if (Math.abs(d.x) < 1.425 && Math.abs(d.z) < 1.425 && d.y > -0.75 && d.y < 2.3 && putAway(item(e.drop, 1))) delete bot.entities[id]
    }
  }
  const tossed = []; const digs = []; const ground = []; const crafts = []
  const nameAt = p => world.get(key(p)) ?? (p.y < 64 ? 'stone' : 'air')
  const blockAt = p => {
    if (!p) return null
    const name = nameAt(p); const d = mc.blocksByName[name]
    return { name, type: d.id, stateId: d.defaultState, position: new Vec3(p.x, p.y, p.z), boundingBox: d.boundingBox,
             hardness: d.hardness, diggable: true, drops: d.drops }
  }
  // every world change emits what prismarine-world emits: blockUpdate:(x, y, z)
  const setBlock = (p, name) => {
    const old = blockAt(p); world.set(key(p), name)
    bot.emit(`blockUpdate:${new Vec3(p.x, p.y, p.z)}`, old, blockAt(p))
  }
  // mineflayer's put-away (inventory.js putSelectedItemRange with slot=null)
  const putAway = it => {
    let left = it.count
    for (const s of slots) {
      if (left <= 0) break
      if (s && s.name === it.name && !s.nbt && s.count < s.stackSize && !it.maxDurability) {
        const n = Math.min(left, s.stackSize - s.count); s.count += n; left -= n
      }
    }
    while (left > 0) {
      const i = slots.indexOf(null)
      if (i < 0) { tossed.push({ ...it, count: left }); return false }
      const n = Math.min(left, it.stackSize); slots[i] = { ...it, count: n }; left -= n
    }
    return true
  }
  const take = (name, n) => {
    for (let i = 0; i < slots.length && n > 0; i++) {
      const s = slots[i]
      if (!s || s.name !== name) continue
      const k = Math.min(n, s.count); s.count -= k; n -= k
      if (s.count === 0) slots[i] = null
    }
    if (n > 0) throw new Error('missing ingredient')
  }
  const have = name => slots.reduce((n, s) => n + (s?.name === name ? s.count : 0), 0)
  const client = Object.assign(new EventEmitter(), { writes: [], write (name, params) { this.writes.push({ name, params, t: Date.now() }) } })
  const bot = Object.assign(new EventEmitter(), {
    _client: client,
    registry,
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true },
    entities: {},
    heldItem: null,
    inventory: {
      items: () => slots.map((s, i) => (s ? Object.assign(s, { slot: 9 + i }) : null)).filter(Boolean),
      emptySlotCount: () => slots.filter(s => !s).length,
      // prismarine-windows' updateSlot: what applying a server packet to the bag does
      updateSlot (slot, it) { if (slot >= 9 && slot <= 44) slots[slot - 9] = it ? item(it.name, it.count) : null },
    },
    recipesFor (id, _meta, min = 1, table = null) {
      return Recipe.find(id).filter(r => (!r.requiresTable || table) &&
        r.delta.every(d => d.count >= 0 || have(mc.items[d.id].name) + d.count * Math.ceil(min / r.result.count) >= 0))
    },
    recipesAll (id, _meta, table) { return Recipe.find(id).filter(r => !r.requiresTable || table) },
    findBlock ({ matching, maxDistance = 32 }) {
      if (typeof matching !== 'function') return null        // the runner's perception asks by id list: no ore here
      const hits = [...world.entries()].filter(([, n]) => n === 'crafting_table')
        .map(([k]) => blockAt(new Vec3(...k.split(',').map(Number))))
        .filter(b => matching(b) && b.position.distanceTo(bot.entity.position) <= maxDistance)
      return hits[0] ?? null
    },
    blockAt,
    canDigBlock: b => !!b && b.position.distanceTo(bot.entity.position) < 5.1,
    async craft (recipe, count = 1, table) {
      if (recipe.requiresTable && !table) throw new Error('Recipe requires craftingTable')
      crafts.push(count)
      for (let k = 0; k < count; k++) {
        // a server denial puts the bag back as it was BEFORE the clicks: ingredients included (RCON, every denied scene)
        const before = slots.map(x => x && { ...x })
        for (const d of recipe.delta) if (d.count < 0) take(mc.items[d.id].name, -d.count)
        const name = mc.items[recipe.result.id].name
        const winId = table ? 1 : 0; const base = table ? 10 : 9      // a 3x3 window's inventory starts at 10
        // the window's bag as the server holds it, in that window's numbering (46 slots either way)
        const full = ({ cursor = null, grid = false, bagAt = null, from = slots } = {}) => {
          const items = Array(46).fill(null).map(() => ({ itemCount: 0 }))
          from.forEach((x, i) => { if (x) items[base + i] = { itemId: mc.itemsByName[x.name].id, itemCount: x.count } })
          if (grid) items[1] = { itemId: mc.itemsByName.stick.id, itemCount: 1 }
          if (bagAt) items[base + bagAt.i] = bagAt.item
          return { windowId: winId, stateId: 7, items, carriedItem: cursor ?? { itemCount: 0 } }
        }
        if (table) { client.emit('open_window', { windowId: 1, inventoryType: 'minecraft:crafting' }); client.emit('window_items', full()) }
        client.write('window_click', { windowId: winId, slot: base, mode: 0 })            // an ingredient click
        for (const ms of noise) setTimeout(() => client.emit('set_slot', { windowId: winId, slot: base + 35, item: { itemCount: 0 } }), ms)
        if (!craftLands) { client.write('window_click', { windowId: winId, slot: 0, mode: 0 }); continue }
        putAway(item(name, recipe.result.count))
        client.write('window_click', { windowId: winId, slot: base, mode: 0 })            // the FINAL put-away click
        const at = slots.findIndex((x, i) => x && x.name === name && (!before[i] || before[i].count !== x.count))
        const send = (n, pkt, ms) => setTimeout(() => client.emit(n, pkt), ms)
        const restore = () => before.forEach((x, i) => { slots[i] = x })
        // THE SERVER SAYS NO. In the player window mineflayer applies the correction: the bag goes back (ingredients
        // included) and a set_slot empties the result slot. For a 3x3 table craft bot.craft has already CLOSED the
        // window, and mineflayer drops a packet for a closed window (inventory.js ~729-731): the local bag keeps the
        // phantom result with the ingredients gone, and only the packet -- the window's full state -- has the truth.
        const deny = ms => {
          if (!table) { setTimeout(restore, ms); send('set_slot', { windowId: winId, slot: base + at, item: { itemCount: 0 } }, ms) }
          else send('window_items', full({ from: before }), ms)
        }
        if (server) {
          server({ send, full, deny, before, winId, base, at, resultId: recipe.result.id, count: slots[at]?.count ?? 0, restore })
        } else if (rejectMs) {
          deny(rejectMs)
        } else if (confirmMs != null) {
          setTimeout(() => client.emit('set_slot', { windowId: winId, slot: base + at, item: { itemId: recipe.result.id, itemCount: slots[at]?.count ?? 0 } }), confirmMs)
        }
      }
      afterCraft?.({ setBlock, world, slots })
    },
    async equip (it) { bot.heldItem = slots.find(s => s && s.slot === it.slot) ?? null },
    async lookAt (p) { await onLook?.({ p, setBlock, bot }) },
    async waitForTicks () {},
    async placeBlock (ref, face) {
      const at = ref.position.offset(face.x, face.y, face.z)
      const name = bot.heldItem?.name ?? 'crafting_table'   // place() equips what it places
      setBlock(at, name); take(name, 1)
    },
    async dig (block, forceLook) {
      // mineflayer 4.37.1 digging.js: unless forceLook === 'ignore', dig AWAITS a lookAt before it sends block_dig
      if (forceLook !== 'ignore') await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), forceLook)
      onDig?.(block)
      digs.push({ name: block.name, at: key(block.position), with: bot.heldItem?.name ?? 'hand' })
      setBlock(block.position, 'air')
      const held = bot.heldItem
      if (held?.maxDurability) {           // any block with hardness > 0 costs a tool one use
        held.durabilityUsed++
        if (held.durabilityUsed >= held.maxDurability) {
          const gone = () => { const i = slots.indexOf(held); if (i >= 0) slots[i] = null; if (bot.heldItem === held) bot.heldItem = null }
          if (toolBreakMs) { held.durabilityUsed-- ; setTimeout(() => { held.durabilityUsed++; gone() }, toolBreakMs) } else gone()
        }
      }
      const pick = /_pickaxe$/.test(held?.name ?? '')
      const drop = block.name === 'crafting_table' ? 'crafting_table'
        : block.name === 'stone' ? (pick ? 'cobblestone' : null) : block.name
      if (drop === 'crafting_table' && tableDrop) {
        const id = entityId++
        bot.entities[id] = { id, name: 'item', drop, position: block.position.offset(tableDrop.dx + 0.5, tableDrop.dy, tableDrop.dz + 0.5),
                             getDroppedItem: () => ({ name: drop, count: 1 }) }
        sweep()
      } else if (drop && !putAway(item(drop, 1))) { tossed.pop(); ground.push(drop) }   // the server's auto-pickup
      afterDig?.(block, { putAway })
    },
    nearestEntity (match) { return Object.values(bot.entities).filter(e => match(e)).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] ?? null },
    // A walk reaches only what the goal accepts: a PICKUP-BOX goal (it carries the item) moves the feet onto the
    // item's column; any other goal (GoalNear(drop, 1) included) is "reached" where the bot already stands -- the
    // sandbox case of a drop resting just outside the box while the pathfinder calls its target reached.
    pathfinder: { async goto (goal) {
      await onGoto?.({ goal, setBlock, bot })
      if (goal?.item) bot.entity.position = new Vec3(goal.item.x, Math.floor(goal.item.y), goal.item.z)
      sweep()
    }, setGoal () {}, stop () {} },
  })
  return { bot, slots, world, tossed, digs, ground, have, crafts, setBlock }
}
const run = (bot, args, signal = new AbortController().signal) => SKILLS.craft.run({ bot }, args, signal)
const NEAR = new Vec3(1, 64, 0)    // a table in reach that this call did not place
const PICK = () => item('iron_pickaxe', 1, { left: 200 })   // a working digging tool that survives any wear-out

const LOG = path.join(process.env.LOG_DIR, 'skill-CraftRoomBot.jsonl')
const rowsSince = async n => {
  await new Promise(r => setTimeout(r, 60))     // the write stream flushes asynchronously
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).slice(n).map(l => JSON.parse(l))
    .map(r => ({ kind: r.skill.name, status: r.skill.status, detail: r.skill.detail }))
}
const mark = async () => (await rowsSince(0)).length

// --- the skill --------------------------------------------------------------
await t('POSITIVE CONTROL: the fake throws a pickaxe on the ground exactly as mineflayer does', async () => {
  const { bot, tossed } = makeBot(bagOf(36, [item('stick', 5)]), { tables: [NEAR] })
  await bot.craft(bot.recipesFor(mc.itemsByName.stone_pickaxe.id, null, 1, true)[0], 1, true)
  assert.deepEqual(tossed.map(x => x.name), ['stone_pickaxe'], 'the instrument must be able to see a toss')
})

await t('full bag, no spent tool: refuses inventory_full, names the bag, says nothing of deposit, throws nothing', async () => {
  const n = await mark()
  const { bot, tossed, have } = makeBot(bagOf(36, [item('stick', 5), item('dirt', 1)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.match(r.detail, /36\/36/); assert.match(r.detail, /cobblestone 34 slots/)
  assert.match(r.detail, /placing your one dirt/, 'a move the bot can make where it stands')
  assert.doesNotMatch(r.detail, /deposit|toss|drop/i)
  assert.deepEqual(tossed, []); assert.equal(have('stone_pickaxe'), 0); assert.equal(have('stick'), 5, 'nothing consumed')
  const rows = (await rowsSince(n)).filter(x => x.kind === '_craft_room')
  assert.ok(rows.some(x => x.status === 'refused'), JSON.stringify(rows))
})

await t('full bag, a stack the recipe empties: the pickaxe goes into that slot and is VERIFIED', async () => {
  const n = await mark()
  const { bot, tossed, have, slots } = makeBot(bagOf(36, [item('stick', 2)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(tossed, []); assert.equal(have('stone_pickaxe'), 1); assert.equal(slots.filter(Boolean).length, 36)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'success' && /verified stone_pickaxe/.test(x.detail)))
})

await t('recursive log -> planks -> sticks -> pickaxe: every level is checked and read back, nothing thrown', async () => {
  const n = await mark()
  const { bot, tossed, have } = makeBot(bagOf(30, [item('oak_log', 3)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(have('wooden_pickaxe'), 1); assert.deepEqual(tossed, [])
  assert.deepEqual([r.item, r.requested, r.executions, r.produced], ['wooden_pickaxe', 1, 1, 1], 'a recursive success reports its counts')
  const verified = (await rowsSince(n)).filter(x => x.kind === '_craft_room' && x.status === 'success').map(x => x.detail.split(' ')[1])
  for (const lvl of ['oak_planks', 'stick', 'wooden_pickaxe']) assert.ok(verified.includes(lvl), `${lvl} not verified: ${verified}`)
})

await t('recursive with a full bag: the PLANKS level refuses (the log stack is not emptied) and the tree stops there', async () => {
  const { bot, tossed, have } = makeBot(bagOf(36, [item('oak_log', 5)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.deepEqual(tossed, [], `a sub-level craft threw ${JSON.stringify(tossed)} on the ground`)
  assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.match(r.detail, /no room for oak_planks/)
  assert.equal(have('oak_log'), 5)
})

await t('make room: wears out the spent pickaxe the craft replaces (below the kept three), its cobblestone joins a stack', async () => {
  const n = await mark()
  const { bot, tossed, have, digs, slots } = makeBot(bagOf(36, [item('stick', 5), item('cobblestone', 30), PICK(),
    spent('stone_pickaxe'), spent('stone_pickaxe'), spent('stone_pickaxe')]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.match(r.detail, /made room by wearing out a spent stone_pickaxe on stone \(the copy this craft replaces\)/)
  assert.equal(digs.length, 1); assert.equal(digs[0].with, 'stone_pickaxe')
  const copies = slots.filter(s => s?.name === 'stone_pickaxe')
  assert.equal(copies.filter(s => s.durabilityUsed === s.maxDurability - 1).length, 2, 'exactly one spent copy gone')
  assert.equal(copies.filter(s => s.durabilityUsed === 0).length, 1, 'and one new full copy')
  assert.deepEqual(tossed, []); assert.equal(have('cobblestone'), 30 * 64 + 30 - 3 + 1, '3 into the pickaxe, 1 from the dig')
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'made_room'))
})

await t('make room with a spent axe: it digs stone, drops nothing, frees the slot', async () => {
  const { bot, tossed, digs, have } = makeBot(bagOf(36, [item('stick', 5), spent('stone_axe'), PICK()]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(digs[0].with, 'stone_axe'); assert.equal(have('stone_axe'), 0); assert.deepEqual(tossed, [])
})

await t('make room refuses a dig whose drop would refill the slot (every cobblestone stack full): inventory_full', async () => {
  const { bot, tossed, digs } = makeBot(bagOf(36, [item('stick', 5), spent('stone_pickaxe'), PICK()]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.match(r.detail, /drop would not refill the slot/)
  assert.equal(digs.length, 0); assert.deepEqual(tossed, [])
})

await t('verification failure: the craft "returns" but nothing arrives -> unknown/unverified, never success', async () => {
  const n = await mark()
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], craftLands: false })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'unknown'); assert.equal(r.failClass, 'unverified', r.detail)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'unverified'))
})

await t('verification failure at a SUB-level stops the whole tree with that class', async () => {
  const { bot } = makeBot(bagOf(20, [item('oak_log', 3)]), { tables: [NEAR], craftLands: false })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.failClass, 'unverified', r.detail); assert.match(r.detail, /making oak_planks for wooden_pickaxe/)
})

await t('a table this call PLACED is dug back and arrives in the bag', async () => {
  const n = await mark()
  const { bot, world, have, digs } = makeBot(bagOf(30, [item('stick', 5), item('crafting_table', 1)]))
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(have('stone_pickaxe'), 1); assert.equal(have('crafting_table'), 1, 'the table is back')
  assert.equal(digs.filter(d => d.name === 'crafting_table').length, 1)
  assert.ok(![...world.values()].includes('crafting_table'), 'nothing left standing')
  assert.match(r.detail, /took the table back/)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_table_retaken' && x.status === 'success'))
})

await t('no room for the table after the craft: it is LEFT and logged, never dug into a full bag', async () => {
  const n = await mark()
  // 35 with the table: the reserve holds the table's slot through the craft, then the server's auto-pickup hands the
  // bot a stray block into that slot (it cannot be refused) -- 36/36 at the retake
  const { bot, world, digs, ground, have } = makeBot(bagOf(35, [item('stick', 5), item('crafting_table', 1)]), {
    afterCraft: ({ slots }) => { slots[slots.indexOf(null)] = item('dirt', 1) } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(have('stone_pickaxe'), 1)
  assert.equal(digs.length, 0, 'dug a table it had no room for'); assert.deepEqual(ground, [])
  assert.ok([...world.values()].includes('crafting_table'))
  assert.match(r.detail, /left the table at .*: no room to carry it/)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_table_retaken' && x.status === 'left'))
})

await t('a full bag still takes the table back when a crafting_table stack has room', async () => {
  const { bot, have, digs } = makeBot(bagOf(36, [item('stick', 5), item('crafting_table', 2)]))
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'failed', 'the pickaxe has no slot: the placed table never freed one')
  assert.equal(r.failClass, 'inventory_full')
  assert.equal(digs.filter(d => d.name === 'crafting_table').length, 1, 'the refusal still takes its table back')
  assert.equal(have('crafting_table'), 2)
})

await t('a table someone else broke: not dug, logged gone', async () => {
  const n = await mark()
  const { bot, digs } = makeBot(bagOf(30, [item('stick', 5), item('crafting_table', 1)]), {
    afterCraft: ({ world }) => { for (const [k, v] of world) if (v === 'crafting_table') world.set(k, 'air') } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(digs.length, 0)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_table_retaken' && x.status === 'gone'))
})

await t('never a table this call did not place', async () => {
  const { bot, world, digs } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(digs.length, 0)
  assert.equal(world.get(key(NEAR)), 'crafting_table')
})

// --- review round 1 (both engines) ---------------------------------------------
await t('36/36 WITH THE CARRIED TABLE: the table\'s slot is reserved, room is made for it, and the table comes home', async () => {
  // placing the table frees its slot, the pickaxe takes it, and the retake found no room: the population losing tables
  const { bot, have, world, tossed } = makeBot(bagOf(36, [item('stick', 5), item('crafting_table', 1), spent('stone_axe'), PICK()]))
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(have('stone_pickaxe'), 1); assert.equal(have('crafting_table'), 1, `the table was left: ${r.detail}`)
  assert.ok(![...world.values()].includes('crafting_table')); assert.deepEqual(tossed, [])
})

await t('36/36 with the carried table and NO remedy: MAKES THE PICKAXE and leaves the table (one log vs the measured loss)', async () => {
  const n = await mark()
  const { bot, have, world, crafts, tossed } = makeBot(bagOf(36, [item('stick', 5), item('crafting_table', 1)]))
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(have('stone_pickaxe'), 1); assert.deepEqual(crafts, [1])
  assert.equal(have('crafting_table'), 0); assert.ok([...world.values()].includes('crafting_table'), 'the table stays down')
  assert.deepEqual(tossed, []); assert.match(r.detail, /left the table/)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_table_retaken' && x.status === 'left'))
})

await t('full bag, exactly one spent pickaxe and no other tool: it is NOT worn out (it is the escape)', async () => {
  const { bot, digs, slots } = makeBot(bagOf(36, [item('stick', 5), item('cobblestone', 30), spent('stone_pickaxe')]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.equal(digs.length, 0)
  assert.equal(slots.filter(s => s?.name === 'stone_pickaxe').length, 1)
})

await t('NO PACKET AT ALL: falls back to the local count -> success, verification verified_local, source=local row', async () => {
  const n = await mark()
  const { bot, have } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], confirmMs: null })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(have('stone_pickaxe'), 1)
  assert.equal(r.status, 'success', r.detail); assert.equal(r.verification, 'verified_local', r.detail)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'verified_local' && /source=local/.test(x.detail)))
})

await t('NO PACKET, and the local count shows no gain either: unverified, source=none', async () => {
  const n = await mark()
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], craftLands: false })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'unverified', r.detail)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'unverified' && /source=none/.test(x.detail)))
})

await t('a verified_local execution does NOT stop the craft tree: the recursive pickaxe is still made', async () => {
  const { bot, have } = makeBot(bagOf(30, [item('oak_log', 3)]), { tables: [NEAR], confirmMs: null })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(have('wooden_pickaxe'), 1)
  assert.equal(r.verification, 'verified_local')
})

await t('a SERVER-confirmed craft says so: verification server, source=server row', async () => {
  const n = await mark()
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(r.verification, 'server')
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'success' && /source=server/.test(x.detail)))
})

await t('OPENING SNAPSHOT + predicted success + delayed rejection: the snapshot is ignored, the rejection is read', async () => {
  // the table's window opens with a window_items of the bag before the craft (no result in it: an opening snapshot,
  // not a denial), the client predicts success, and 150 ms later the server's set_slot empties the result slot
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ deny }) => deny(150) })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'unverified', r.detail)
})

await t('a CURSOR snapshot (result on the cursor, not yet put away) confirms nothing: falls back to local', async () => {
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ send, full, at, resultId }) => {
    send('window_items', full({ cursor: { itemId: resultId, itemCount: 1 }, bagAt: { i: at, item: { itemCount: 0 } } }), 10) } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(r.verification, 'verified_local', 'a mid-click snapshot was read as the server confirming the bag')
})

await t('TABLE CRAFT, window_items AFTER CLOSE that DENIES: read from the packet (mineflayer drops it after close) and written into the bag', async () => {
  // the server's full state of the crafting window: result slot empty, grid empty, cursor empty -- read from the
  // packet, because mineflayer does not apply a window_items for a window it has already closed
  const { bot, have } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ send, full, at }) => {
    send('window_items', full({ bagAt: { i: at, item: { itemCount: 0 } } }), 20) } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(have('stone_pickaxe'), 0, 'the server\'s word (no pickaxe) was not written into the bag')
  assert.equal(r.failClass, 'unverified', `read the local prediction over the server: ${r.detail}`)
})

await t('TABLE CRAFT, window_items AFTER CLOSE that SHOWS the result in the bag: server-verified', async () => {
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ send, full }) => send('window_items', full(), 20) })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(r.verification, 'server')
})

await t('a rejection arriving AFTER the quiet window is still caught: quiet alone is not confirmation', async () => {
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], rejectMs: 150 })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'unverified', `accepted before the server spoke: ${r.detail}`)
})

await t('the quiet period RESTARTS on every packet: a rejection inside a burst is read, not raced', async () => {
  // confirmation at 10 ms, unrelated packets at 30 and 55, the rejection at 80: never 30 ms of quiet before it
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], noise: [30, 55], server: ({ send, winId, base, at, resultId, deny }) => {
    send('set_slot', { windowId: winId, slot: base + at, item: { itemId: resultId, itemCount: 1 } }, 10)
    deny(80) } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'unverified', `read inside the burst: ${r.detail}`)
})

await t('a REJECTED craft the client briefly showed is not verified (the read waits for the server)', async () => {
  const { bot, have } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], rejectMs: 30 })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'unverified', `accepted a client-side prediction: ${r.detail}`)
  assert.equal(r.status, 'unknown'); assert.equal(have('stone_pickaxe'), 0)
})

await t('abort during make-room: the craft never runs and the abort propagates', async () => {
  const ac = new AbortController()
  const { bot, crafts } = makeBot(bagOf(36, [item('stick', 5), spent('stone_axe'), PICK()]), { tables: [NEAR], onDig: () => ac.abort() })
  await assert.rejects(run(bot, { item: 'stone_pickaxe', count: 1 }, ac.signal), e => e?.aborted === true)
  assert.equal(crafts.length, 0, 'bot.craft ran after the abort')
})

await t('abort during the retake: rethrown after cleanup, not swallowed into a success', async () => {
  const n = await mark()
  const ac = new AbortController()
  const { bot, have } = makeBot(bagOf(30, [item('stick', 5), item('crafting_table', 1)]),
    { onDig: b => { if (b.name === 'crafting_table') ac.abort() } })
  await assert.rejects(run(bot, { item: 'stone_pickaxe', count: 1 }, ac.signal), e => e?.aborted === true)
  assert.equal(have('stone_pickaxe'), 1)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_table_retaken' && x.status === 'left' && /abort/.test(x.detail)))
})

await t('craft NEVER PLACES A BLOCK to make room (it could seal a tunnel or an escape stair); it may only name one', async () => {
  const { bot, have, crafts, world } = makeBot(bagOf(36, [item('stick', 5), item('dirt', 1)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.equal(crafts.length, 0)
  assert.equal(have('dirt'), 1); assert.ok(![...world.values()].includes('dirt'), 'a block was placed')
  assert.match(r.detail, /placing your one dirt/)
})

await t('a spent AXE is worn out even with no pickaxe in the bag (the survivor rule is for pickaxes)', async () => {
  const { bot, have, digs } = makeBot(bagOf(36, [item('stick', 5), spent('stone_axe')]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(digs[0]?.with, 'stone_axe'); assert.equal(have('stone_axe'), 0)
})

await t('the refusal never advises an ingredient or something that does not place', async () => {
  const { bot } = makeBot(bagOf(36, [item('stick', 5), item('cobblestone', 1), item('wheat', 1)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.doesNotMatch(r.detail, /placing your \S+ (cobblestone|wheat)/)
})

await t('a recipe the room check cannot read (an unnamed id) is refused, never crafted unchecked', async () => {
  const items = { ...mc.items }; delete items[mc.itemsByName.stick.id]
  const { bot, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], registry: { ...mc, items } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(crafts.length, 0, 'bot.craft ran without a room check'); assert.equal(r.failClass, 'unverified', r.detail)
})

await t('COUNT CONTRACT: count is executions; the result says executions, produced and requested', async () => {
  // recipesFor grants "3 planks" with one log (one execution makes 4); executions 2 and 3 run out
  const { bot, have } = makeBot(bagOf(10, [item('oak_log', 1)]))
  const r = await run(bot, { item: 'oak_planks', count: 3 })
  assert.equal(r.status, 'success', r.detail); assert.equal(have('oak_planks'), 4)
  assert.equal(r.requested, 3); assert.equal(r.executions, 1); assert.equal(r.produced, 4); assert.equal(r.item, 'oak_planks')
  assert.match(r.detail, /1 of 3 executions \(4 oak_planks\)/)
})

await t('35/36 crafting TWO pickaxes: one is made, the second is refused, nothing thrown (each execution re-checks)', async () => {
  const { bot, have, tossed, crafts } = makeBot(bagOf(35, [item('stick', 9)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 2 })
  assert.deepEqual(tossed, [], 'the second pickaxe went on the ground')
  assert.equal(have('stone_pickaxe'), 1); assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.equal(r.executions, 1); assert.deepEqual(crafts, [1])
})

await t('a known table out of reach: places the CARRIED one, crafts, takes back only that one', async () => {
  const FAR = new Vec3(20, 64, 0)
  const { bot, have, world, digs } = makeBot(bagOf(20, [item('stick', 5), item('crafting_table', 1)]), { tables: [FAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.match(r.detail, /placed the carried table/)
  assert.equal(have('stone_pickaxe'), 1); assert.equal(have('crafting_table'), 1)
  assert.equal(world.get(key(FAR)), 'crafting_table', 'the far table is not ours')
  assert.deepEqual(digs.map(d => d.name), ['crafting_table']); assert.notEqual(digs[0].at, key(FAR))
})

await t('TABLE OWNERSHIP: a table broken and re-placed at the same spot since ours went down is not ours -- left', async () => {
  const n = await mark()
  const { bot, digs } = makeBot(bagOf(30, [item('stick', 5), item('crafting_table', 1)]), {
    afterCraft: ({ setBlock, world }) => {
      for (const [k, v] of [...world]) if (v === 'crafting_table') { const p = k.split(',').map(Number); setBlock({ x: p[0], y: p[1], z: p[2] }, 'air'); setBlock({ x: p[0], y: p[1], z: p[2] }, 'crafting_table') }
    } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(digs.length, 0, 'dug a table this call cannot prove is its own')
  assert.ok((await rowsSince(n)).some(x => x.kind === '_table_retaken' && x.status === 'left' && /changed since/.test(x.detail)))
})

await t('OWNERSHIP: the table chunk unloaded and reloaded since placement -> not provably ours, left', async () => {
  const n = await mark()
  const { bot, digs } = makeBot(bagOf(30, [item('stick', 5), item('crafting_table', 1)]), {
    afterCraft: ({ world }) => {
      for (const [k, v] of [...world]) if (v === 'crafting_table') { const [x, , z] = k.split(',').map(Number); bot.emit('chunkColumnUnload', new Vec3(Math.floor(x / 16) * 16, 0, Math.floor(z / 16) * 16)) }
    } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(digs.length, 0, 'dug a table whose history it lost')
  assert.ok((await rowsSince(n)).some(x => x.kind === '_table_retaken' && x.status === 'left' && /unload/.test(x.detail)))
})

await t('OWNERSHIP: a chunk unload ELSEWHERE does not taint the table', async () => {
  const { bot, have } = makeBot(bagOf(30, [item('stick', 5), item('crafting_table', 1)]), {
    afterCraft: () => bot.emit('chunkColumnUnload', new Vec3(160, 0, 160)) })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(have('crafting_table'), 1)
})

await t('OWNERSHIP: replaced DURING THE APPROACH -> revalidated right before the dig, left', async () => {
  const n = await mark()
  let at = null
  const { bot, digs } = makeBot(bagOf(30, [item('stick', 5), item('crafting_table', 1)]), {
    afterCraft: ({ world }) => { at = [...world].find(([, v]) => v === 'crafting_table')?.[0]; bot.entity.position = new Vec3(0.5, 64, 12.5) },
    onGoto: ({ setBlock, bot: b }) => {
      b.entity.position = new Vec3(0.5, 64, 0.5)
      const [x, y, z] = at.split(',').map(Number); setBlock({ x, y, z }, 'air'); setBlock({ x, y, z }, 'crafting_table')
    } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(digs.length, 0, 'dug a table replaced while it walked')
  assert.ok((await rowsSince(n)).some(x => x.kind === '_table_retaken' && x.status === 'left'))
})

await t('RECURSIVE PARTIAL: stick x3 from one log reports the retry\'s counts (2 of 3 executions, 8 sticks)', async () => {
  const { bot, have } = makeBot(bagOf(10, [item('oak_log', 1)]))
  const r = await run(bot, { item: 'stick', count: 3 })
  assert.equal(r.status, 'success', r.detail); assert.equal(have('stick'), 8)
  assert.deepEqual([r.item, r.requested, r.executions, r.produced], ['stick', 3, 2, 8], r.detail)
  assert.match(r.detail, /first made oak_planks/)
})

await t('OWNERSHIP AT THE DIG: a table replaced DURING THE LOOK is caught (look first, revalidate, then dig without a second look)', async () => {
  let armed = false
  const { bot, digs } = makeBot(bagOf(30, [item('stick', 5), item('crafting_table', 1)]), {
    afterCraft: () => { armed = true },
    onLook: ({ p, setBlock }) => {
      if (!armed) return
      armed = false
      const c = { x: p.x - 0.5, y: p.y - 0.5, z: p.z - 0.5 }   // the look aims at the block's centre (this fake's cells are not floored)
      setBlock(c, 'air'); setBlock(c, 'crafting_table')
    } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(digs.length, 0, 'dug a table replaced while the bot turned to it')
})

await t('BOTH ROOM TRIES SUCCEED but stray pickups refill them: the craft goes first, the table is left', async () => {
  // each wear-out frees a slot and the server's auto-pickup hands the bot a stray block into it (it cannot be refused)
  const strays = ['andesite', 'diorite']
  const { bot, have, world, digs } = makeBot(bagOf(36, [item('stick', 5), item('crafting_table', 1), spent('stone_axe'), spent('stone_axe'), PICK()]), {
    afterDig: (b, { putAway }) => { if (b.name === 'stone' && strays.length) putAway(item(strays.shift(), 1)) } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(digs.filter(d => d.name === 'stone').length, 2, 'both tries ran')
  assert.equal(r.status, 'success', r.detail); assert.equal(have('stone_pickaxe'), 1)
  assert.ok([...world.values()].includes('crafting_table')); assert.match(r.detail, /craft goes first/)
})

await t('the refusal ADVICE names only dirt/stone-family blocks, never a hazardous one', async () => {
  const { bot } = makeBot(bagOf(36, [item('stick', 5), item('sand', 1), item('gravel', 1), item('magma_block', 1)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.doesNotMatch(r.detail, /placing your \S+ (sand|gravel|magma_block)/)
})

await t('a "shows" inside a burst still running at the deadline is NOT server-confirmed: the local count decides', async () => {
  const noise = []; for (let ms = 20; ms <= 420; ms += 20) noise.push(ms)
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], confirmMs: 280, noise })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(r.verification, 'verified_local', 'the deadline bypassed the quiet period')
})

// --- sandbox round (Paper 1.21.8, 46c4836) -------------------------------------
await t('WEAR-OUT CHECK RACE: the broken tool leaves the bag 120 ms after the dig -- the check waits for it', async () => {
  const { bot, have, digs } = makeBot(bagOf(36, [item('stick', 5), item('cobblestone', 30), PICK(),
    spent('stone_pickaxe'), spent('stone_pickaxe'), spent('stone_pickaxe')]), { tables: [NEAR], toolBreakMs: 120 })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(digs.length, 1)
  assert.equal(r.status, 'success', `read "survived" before the server's slot update: ${r.detail}`)
  assert.equal(have('stone_pickaxe'), 3, 'two spent + the new one')
})

await t('RUNNER: a replacement (spent copy worn out + new one crafted) keeps the name count 3 -> 3 and is still a SUCCESS', async () => {
  const { bot } = makeBot(bagOf(36, [item('stick', 5), item('cobblestone', 30), PICK(),
    spent('stone_pickaxe'), spent('stone_pickaxe'), spent('stone_pickaxe')]), { tables: [NEAR] })
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  const r = await new Runner(bot).run('craft', { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', `downgraded: ${r.failClass} ${r.detail}`)
  assert.match((r.contractEvidence ?? []).join(';'), /crafted: stone_pickaxe \+1/)
})

await t('RUNNER: the final item DENIED by the server stays unknown, whatever the sub-crafts put in the bag', async () => {
  const deny = mc.itemsByName.wooden_pickaxe.id
  // planks in hand, so the sub-craft (sticks) and the final craft fit inside the suite's 300 ms runner watchdog
  const { bot, have } = makeBot(bagOf(20, [item('oak_planks', 7)]), { tables: [NEAR], server: ({ send, winId, base, at, resultId, count, deny: denyIt }) => {
    if (resultId === deny) denyIt(10)
    else send('set_slot', { windowId: winId, slot: base + at, item: { itemId: resultId, itemCount: count } }, 10)
  } })
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  const r = await new Runner(bot).run('craft', { item: 'wooden_pickaxe', count: 1 })
  assert.ok(have('stick') > 0, 'the sub-crafts did put things in the bag')
  assert.equal(r.status, 'unknown', `upgraded on the sub-crafts' gain: ${r.detail}`)
  assert.equal(r.failClass, 'unverified')
})

await t('RUNNER: the craft verified count is evidence ONLY for the item it was asked for', async () => {
  const bot = makeBot(bagOf(10, [])).bot
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  const orig = SKILLS.craft.run
  SKILLS.craft.run = async () => ({ status: 'unknown', failClass: 'unverified', item: 'oak_planks', requested: 1, executions: 1, produced: 4,
                                    detail: 'a result whose fields are about another item' })
  try {
    const r = await new Runner(bot).run('craft', { item: 'wooden_pickaxe', count: 1 })
    assert.equal(r.status, 'unknown', `credited planks to a pickaxe: ${r.detail}`)
  } finally { SKILLS.craft.run = orig }
})

await t('a STOP at a sub-level reports the REQUESTED item with nothing produced', async () => {
  const { bot } = makeBot(bagOf(20, [item('oak_log', 3)]), { tables: [NEAR], craftLands: false })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.failClass, 'unverified')
  assert.deepEqual([r.item, r.executions, r.produced], ['wooden_pickaxe', 0, 0], 'the sub-level\'s fields leaked up')
})

await t('RETAKE DROP OUT OF RANGE: the table item rests 2.6 above the cell; the bot walks to a pickup-box goal and it ARRIVES', async () => {
  const n = await mark()
  const { bot, have, world } = makeBot(bagOf(30, [item('stick', 5), item('crafting_table', 1)]), { tableDrop: { dx: 0, dy: 2.6, dz: 0 } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.ok(![...world.values()].includes('crafting_table'))
  assert.equal(have('crafting_table'), 1, `the table was lost: ${r.detail}`)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_table_retaken' && x.status === 'success'))
})

await t('WEAR-OUT PIT: on open ground (no side block) the floor is never dug -- refuse, no pit', async () => {
  const { bot, digs } = makeBot(bagOf(36, [item('stick', 5), spent('stone_axe')]), { tables: [NEAR], walls: [] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(digs.length, 0, `dug ${JSON.stringify(digs)}`); assert.equal(r.failClass, 'inventory_full', r.detail)
})

await t('WEAR-OUT digs a SIDE block at foot level, never the floor under or beside the feet', async () => {
  const { bot, digs } = makeBot(bagOf(36, [item('stick', 5), spent('stone_axe')]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.ok(digs.every(d => Number(d.at.split(',')[1]) >= 64), `dug the floor: ${JSON.stringify(digs)}`)
})

// --- a server denial is retried once ---------------------------------------------
const denyThen = (pattern) => {
  let n = 0
  return ({ send, winId, base, at, resultId, count, deny }) => {
    const say = pattern[Math.min(n++, pattern.length - 1)]
    if (say === 'deny') deny(10)
    else send('set_slot', { windowId: winId, slot: base + at, item: { itemId: resultId, itemCount: count } }, 10)
  }
}

await t('DENIED, then CONFIRMED on the one retry: success, two crafts, retried=1 on the row', async () => {
  const n = await mark()
  const { bot, have, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: denyThen(['deny', 'show']) })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(r.verification, 'server')
  assert.deepEqual(crafts, [1, 1]); assert.equal(have('stone_pickaxe'), 1); assert.equal(have('stick'), 3)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'success' && /retried=1 retry=server/.test(x.detail)))
})

await t('DENIED TWICE: unknown/unverified, ingredients intact, no third try', async () => {
  const n = await mark()
  const { bot, have, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: denyThen(['deny', 'deny', 'show']) })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'unknown'); assert.equal(r.failClass, 'unverified', r.detail)
  assert.deepEqual(crafts, [1, 1], 'a third try')
  assert.equal(have('stick'), 5); assert.equal(have('stone_pickaxe'), 0)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'unverified' && /retried=1 retry=denied/.test(x.detail)))
})

await t('NO SERVER STATEMENT is never retried (only a denial is)', async () => {
  const { bot, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], craftLands: false })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'unverified'); assert.deepEqual(crafts, [1])
})

// --- retry only after reconciliation; the runner keeps a thrown craft's tally ------------
await t('PHANTOM AFTER CLOSE: the denial is written into the bag from the packet, then retried once', async () => {
  // table craft: mineflayer dropped the correction, so locally the pickaxe is there and the sticks are gone
  const { bot, have, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: denyThen(['deny', 'show']) })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.deepEqual(crafts, [1, 1])
  assert.equal(have('stone_pickaxe'), 1, 'the phantom stayed in the bag'); assert.equal(have('stick'), 3, 'crafted from phantom ingredients')
  assert.equal(have('cobblestone'), 19 * 64 - 3)
})

await t('DENIED in the predicted slot but the output is in ANOTHER slot: counted as produced, no retry', async () => {
  const { bot, have, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ send, winId, base, at, resultId }) => {
    send('set_slot', { windowId: winId, slot: base + at, item: { itemCount: 0 } }, 10)
    send('set_slot', { windowId: winId, slot: base + 35, item: { itemId: resultId, itemCount: 1 } }, 12) } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.deepEqual(crafts, [1], 'retried a craft that had produced'); assert.equal(r.status, 'success', r.detail)
  assert.equal(r.produced, 1); assert.equal(have('stone_pickaxe'), 1)
})

await t('a CONFIRMATION arriving during the settle is honoured: no retry', async () => {
  const { bot, have, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ send, winId, base, at, resultId }) => {
    send('set_slot', { windowId: winId, slot: base + at, item: { itemCount: 0 } }, 10)
    send('set_slot', { windowId: winId, slot: base + at, item: { itemId: resultId, itemCount: 1 } }, 60) } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.deepEqual(crafts, [1]); assert.equal(r.status, 'success', r.detail); assert.equal(have('stone_pickaxe'), 1)
})

await t('denied with the ingredients NOT restored by the server: no retry, unverified', async () => {
  const { bot, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ send, winId, base, at }) => {
    send('set_slot', { windowId: winId, slot: base + at, item: { itemCount: 0 } }, 10) } })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.deepEqual(crafts, [1], 'retried without the ingredients back'); assert.equal(r.failClass, 'unverified', r.detail)
})

await t('RUNNER: a batch ABORTED after one verified execution still carries crafted +1', async () => {
  let runner = null; let n = 0
  const { bot } = makeBot(bagOf(20, [item('stick', 9)]), { tables: [NEAR], server: ({ send, winId, base, at, resultId, count }) => {
    if (n++ === 1) { runner.interrupt('test: abort between executions'); return }
    send('set_slot', { windowId: winId, slot: base + at, item: { itemId: resultId, itemCount: count } }, 10) } })
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  runner = new Runner(bot)
  const r = await runner.run('craft', { item: 'stone_pickaxe', count: 2 })
  assert.match((r.contractEvidence ?? []).join(';'), /crafted: stone_pickaxe \+1/, `${r.status} ${r.detail}`)
})

await t('RUNNER: a completed craft ABORTED during the table retake still carries crafted +1', async () => {
  let runner = null
  const { bot } = makeBot(bagOf(30, [item('stick', 5), item('crafting_table', 1)]), {
    onDig: b => { if (b.name === 'crafting_table') runner.interrupt('test: abort mid-retake') } })
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  runner = new Runner(bot)
  const r = await runner.run('craft', { item: 'stone_pickaxe', count: 1 })
  assert.match((r.contractEvidence ?? []).join(';'), /crafted: stone_pickaxe \+1/, `${r.status} ${r.detail}`)
})

await t('a denial that CANNOT be written into the bag stays unverified: the local read never overrides the server', async () => {
  const { bot, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ deny }) => deny(10) })
  delete bot.inventory.updateSlot          // no way to apply the dropped packet: the phantom stays locally
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'unverified', r.detail); assert.deepEqual(crafts, [1], 'retried on an unreconciled bag')
})

// --- seventh pass ------------------------------------------------------------------
await t('a WRITE THAT FAILS while applying the denial: the bag is not reconciled -- unverified, no retry, no promotion', async () => {
  const { bot, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ deny }) => deny(10) })
  bot.inventory.updateSlot = () => { throw new Error('injected: updateSlot failed') }
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'unverified', r.detail); assert.deepEqual(crafts, [1], 'retried on a bag it failed to reconcile')
})

await t('CLEANUP REPLACES A PENDING ERROR: the deeper retry verified one execution and threw; an abort in the outer retake keeps crafted +1', async () => {
  // carried table -> placed at depth 0 -> the retry (depth 1) crafts 2: the first verifies, the second throws a
  // non-abort error before its click; the depth-0 retake is then aborted and its error replaces the pending one
  let runner = null; let armed = false
  const made = makeBot(bagOf(30, [item('stick', 9), item('crafting_table', 1)]), {
    afterCraft: () => { armed = true },
    onDig: b => { if (b.name === 'crafting_table') runner.interrupt('test: abort in the outer cleanup') } })
  const { bot } = made
  const client = bot._client
  Object.defineProperty(bot, '_client', { get () { if (armed) { armed = false; throw new Error('injected: a non-abort failure in the deeper retry') } return client } })
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  runner = new Runner(bot)
  const r = await runner.run('craft', { item: 'stone_pickaxe', count: 2 })
  assert.match((r.contractEvidence ?? []).join(';'), /crafted: stone_pickaxe \+1/, `${r.status} ${r.detail}`)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
