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

process.env.LOG_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-craft-room-'))
process.env.BOT_NAME = 'CraftRoomBot'

const require_ = createRequire(import.meta.url)
const mc = require_('minecraft-data')('1.21.8')
const { Recipe } = require_('prismarine-recipe')('1.21.8')

const { SKILLS } = await import('../src/skills.mjs')
const { craftRoom, roomRecipe, craftArrived, craftRoomRemedy, wearKeepsSlot, bagFill, roomForOne, BAG_SLOTS } =
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
  assert.equal(craftRoomRemedy(bagOf(36, [spent('stone_axe'), spent('stone_pickaxe')]), 'stone_pickaxe').tool.name, 'stone_axe')
  const three = bagOf(36, [spent('stone_pickaxe'), spent('wooden_pickaxe'), spent('stone_pickaxe')])
  const r = craftRoomRemedy(three, 'stone_pickaxe')
  assert.equal(r.why, 'replaced'); assert.equal(r.tool.name, 'wooden_pickaxe', 'lowest tier first')
  assert.equal(craftRoomRemedy(three, 'oak_planks'), null, 'planks replace no pickaxe: the three stay')
  assert.equal(craftRoomRemedy(bagOf(36, [item('stone_pickaxe', 1, { left: 0 })]), 'stone_pickaxe'), null, 'a 0-use phantom is not real')
  assert.equal(craftRoomRemedy(bagOf(36, [item('stone_pickaxe', 1, { left: 2 })]), 'stone_pickaxe'), null, 'two uses is not spent')
})

await t('wearKeepsSlot: an axe on stone drops nothing; a pickaxe on stone needs a non-full cobblestone stack', () => {
  const drops = ['cobblestone']
  assert.equal(wearKeepsSlot(bagOf(36, []), 'stone_axe', 'stone', drops), true)
  assert.equal(wearKeepsSlot(bagOf(36, []), 'stone_pickaxe', 'stone', drops), false, 'every cobblestone stack is full')
  assert.equal(wearKeepsSlot(bagOf(36, [item('cobblestone', 30)]), 'stone_pickaxe', 'stone', drops), true)
  assert.equal(wearKeepsSlot(bagOf(36, []), 'stone_axe', 'dirt', ['dirt']), false, 'dirt drops for any tool')
})

await t('bagFill names what fills the bag and the smallest placeable stack', () => {
  const f = bagFill(bagOf(36, [item('dirt', 3), item('stick', 1)]), n => !!mc.blocksByName[n])
  assert.match(f.line, /^cobblestone 34 slots, dirt 1, stick 1$/)
  assert.deepEqual(f.cheapest, { name: 'dirt', count: 3 }, 'a stick is not a block')
  assert.equal(roomForOne(bagOf(36, [item('crafting_table', 1)]), 'crafting_table'), true, 'joins the stack')
  assert.equal(roomForOne(bagOf(36, []), 'crafting_table'), false)
  assert.equal(BAG_SLOTS, 36)
})

// --- the fake bot -----------------------------------------------------------
const key = p => `${p.x},${p.y},${p.z}`
function makeBot (stacks, { tables = [], craftLands = true, afterCraft = null } = {}) {
  const slots = Array(36).fill(null)
  stacks.forEach((s, i) => { slots[i] = { ...s } })
  const world = new Map(tables.map(p => [key(p), 'crafting_table']))
  const tossed = []; const digs = []; const ground = []
  const nameAt = p => world.get(key(p)) ?? (p.y < 64 ? 'stone' : 'air')
  const blockAt = p => {
    if (!p) return null
    const name = nameAt(p); const d = mc.blocksByName[name]
    return { name, type: d.id, position: new Vec3(p.x, p.y, p.z), boundingBox: d.boundingBox, hardness: d.hardness, diggable: true, drops: d.drops }
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
  const bot = {
    registry: mc,
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true },
    entities: {},
    heldItem: null,
    inventory: {
      items: () => slots.map((s, i) => (s ? Object.assign(s, { slot: 9 + i }) : null)).filter(Boolean),
      emptySlotCount: () => slots.filter(s => !s).length,
    },
    recipesFor (id, _meta, min = 1, table = null) {
      return Recipe.find(id).filter(r => (!r.requiresTable || table) &&
        r.delta.every(d => d.count >= 0 || have(mc.items[d.id].name) + d.count * Math.ceil(min / r.result.count) >= 0))
    },
    recipesAll (id, _meta, table) { return Recipe.find(id).filter(r => !r.requiresTable || table) },
    findBlock ({ matching, maxDistance = 32 }) {
      const hits = [...world.entries()].filter(([, n]) => n === 'crafting_table')
        .map(([k]) => blockAt(new Vec3(...k.split(',').map(Number))))
        .filter(b => matching(b) && b.position.distanceTo(bot.entity.position) <= maxDistance)
      return hits[0] ?? null
    },
    blockAt,
    canDigBlock: b => !!b && b.position.distanceTo(bot.entity.position) < 5.1,
    async craft (recipe, count = 1, table) {
      if (recipe.requiresTable && !table) throw new Error('Recipe requires craftingTable')
      for (let k = 0; k < count; k++) {
        for (const d of recipe.delta) if (d.count < 0) take(mc.items[d.id].name, -d.count)
        const name = mc.items[recipe.result.id].name
        if (craftLands) putAway(item(name, recipe.result.count))
      }
      afterCraft?.({ world, slots })
    },
    async equip (it) { bot.heldItem = slots.find(s => s && s.slot === it.slot) ?? null },
    async lookAt () {},
    async waitForTicks () {},
    async placeBlock (ref, face) {
      const at = ref.position.offset(face.x, face.y, face.z)
      world.set(key(at), 'crafting_table'); take('crafting_table', 1)
    },
    async dig (block) {
      digs.push({ name: block.name, at: key(block.position), with: bot.heldItem?.name ?? 'hand' })
      world.set(key(block.position), 'air')
      const held = bot.heldItem
      if (held?.maxDurability) {           // any block with hardness > 0 costs a tool one use
        held.durabilityUsed++
        if (held.durabilityUsed >= held.maxDurability) { slots[slots.indexOf(held)] = null; bot.heldItem = null }
      }
      const pick = /_pickaxe$/.test(held?.name ?? '')
      const drop = block.name === 'crafting_table' ? 'crafting_table'
        : block.name === 'stone' ? (pick ? 'cobblestone' : null) : block.name
      // the server's auto-pickup: into the bag when it fits, else it lies there
      if (drop && !putAway(item(drop, 1))) { tossed.pop(); ground.push(drop) }
    },
    pathfinder: { async goto () {}, setGoal () {}, stop () {} },
  }
  return { bot, slots, world, tossed, digs, ground, have }
}
const run = (bot, args) => SKILLS.craft.run({ bot }, args, new AbortController().signal)
const NEAR = new Vec3(1, 64, 0)    // a table in reach that this call did not place

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
  const { bot, tossed, have } = makeBot(bagOf(36, [item('stick', 5), item('dirt', 3)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.match(r.detail, /36\/36/); assert.match(r.detail, /cobblestone 34 slots/)
  assert.match(r.detail, /placing your 3 dirt/, 'a move the bot can make where it stands')
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
  const { bot, tossed, have, digs, slots } = makeBot(bagOf(36, [item('stick', 5), item('cobblestone', 30),
    spent('stone_pickaxe'), spent('stone_pickaxe'), spent('stone_pickaxe')]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.match(r.detail, /made room by wearing out a spent stone_pickaxe on stone \(the copy this craft replaces\)/)
  assert.equal(digs.length, 1); assert.equal(digs[0].with, 'stone_pickaxe')
  const copies = slots.filter(s => s?.name === 'stone_pickaxe')
  assert.equal(copies.filter(s => s.durabilityUsed === s.maxDurability - 1).length, 2, 'exactly one spent copy gone')
  assert.equal(copies.filter(s => s.durabilityUsed === 0).length, 1, 'and one new full copy')
  assert.deepEqual(tossed, []); assert.equal(have('cobblestone'), 31 * 64 + 30 - 3 + 1, '3 into the pickaxe, 1 from the dig')
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'made_room'))
})

await t('make room with a spent axe: it digs stone, drops nothing, frees the slot', async () => {
  const { bot, tossed, digs, have } = makeBot(bagOf(36, [item('stick', 5), spent('stone_axe')]), { tables: [NEAR] })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(digs[0].with, 'stone_axe'); assert.equal(have('stone_axe'), 0); assert.deepEqual(tossed, [])
})

await t('make room refuses a dig whose drop would refill the slot (every cobblestone stack full): inventory_full', async () => {
  const { bot, tossed, digs } = makeBot(bagOf(36, [item('stick', 5), spent('stone_pickaxe')]), { tables: [NEAR] })
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
  // 36 with the table; placing frees its slot, the pickaxe takes it back: 36/36 at the retake
  const { bot, world, digs, ground, have } = makeBot(bagOf(36, [item('stick', 5), item('crafting_table', 1)]))
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

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
