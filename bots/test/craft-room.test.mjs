// CRAFT ROOM: no craft may reach mineflayer's toss, every craft is verified, and the table a craft put down comes
// back with it. The measurement and the mechanism are in src/craftroom.mjs.
//
// Two halves. The pure decisions (craftRoom, craftArrived, craftRoomRemedy, wearKeepsSlot, bagFill, executionVerdict)
// are tested directly. The skill is then driven against a fake bot whose bag is a real 36-slot array, with REAL 1.21.8
// recipes (prismarine-recipe over minecraft-data) and mineflayer's own put-away rule: join a compatible non-full
// stack, else the first empty slot, else THROW IT ON THE GROUND (inventory.js putSelectedItemRange -- and
// craftsync.mjs's copy of it keeps that rule). A fake that quietly made room would be modelling the fix instead of the
// bug. bot.craft is CRAFTSYNC'S CONTRACT at its boundary (resolve { produced, requested } only when the server's count
// rose, else throw CraftSyncError); craftroom-craftsync.test.mjs runs the same skill through the REAL craftsync and
// mineflayer's craft.js against the fake Paper.
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
        executionVerdict, admitRoom, pickupPending, pickupNearest, heldLine, collectDecision, PICKUP_TABLE_BAND, roomAdvice, placeStackOf, depositFreesSlot, depositTarget, PICKUP_MARGIN } =
  await import('../src/craftroom.mjs')
const { depositPlan } = await import('../src/bankable.mjs')
const { CraftSyncError, admissionRefusal } = await import('../src/craftsync.mjs')

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

await t('executionVerdict: under craftsync ITS verdict is the verdict -- resolved is server; a local count never confirms', () => {
  const unconfirmed = (reason, produced = 0) => new CraftSyncError('x', { failClass: 'craft_unconfirmed', reason, produced, requested: 1 })
  assert.deepEqual(executionVerdict({ synced: true, got: { produced: 1, requested: 1 }, perCraft: 1 }),
    { ok: true, source: 'server', verdict: 'server', produced: 1, retry: false })
  const denied = executionVerdict({ synced: true, error: unconfirmed('not_in_inventory'), perCraft: 1 })
  assert.deepEqual([denied.ok, denied.source, denied.verdict, denied.produced, denied.retry], [false, 'server', 'denied', 0, true])
  assert.equal(executionVerdict({ synced: true, error: unconfirmed('not_in_inventory', 2), perCraft: 4 }).retry, false,
    'something arrived: never retried (a retry could make it twice)')
  const silent = executionVerdict({ synced: true, error: unconfirmed('unverified', 1), arrived: true, perCraft: 1 })
  assert.deepEqual([silent.ok, silent.source, silent.verdict, silent.produced], [false, 'none', 'unanswered', 0],
    'an unanswered resync with a local gain is NOT verified_local under craftsync, and nothing confirmed it')
  const late = executionVerdict({ synced: true, error: unconfirmed('click_timeout', 1) })
  assert.deepEqual([late.ok, late.source, late.verdict], [false, 'none', 'click_timeout'], 'a click timeout is its own verdict')
  const refused = executionVerdict({ synced: true, error: new CraftSyncError('x', { failClass: 'craft_room', reason: 'no_room_after_resync' }) })
  assert.deepEqual([refused.ok, refused.source, refused.verdict, refused.refused], [false, 'none', 'no_room_after_resync', true])
})

await t('admissionRefusal (craftsync): true/{ok:true} admit; a refusal keeps its class and reason; a THROWING admit refuses', () => {
  assert.equal(admissionRefusal(() => true, []), null)
  assert.equal(admissionRefusal(() => ({ ok: true }), []), null)
  assert.deepEqual(admissionRefusal(() => ({ ok: false, failClass: 'craft_room', reason: 'no_room_after_resync', detail: 'd' }), []),
    { failClass: 'craft_room', reason: 'no_room_after_resync', detail: 'd' })
  assert.equal(admissionRefusal(() => { throw new Error('boom') }, []).reason, 'admit_threw', 'fail closed')
  assert.equal(admissionRefusal(() => undefined, []).reason, 'refused_by_admit', 'only an explicit yes admits')
})

await t('pickupPending + admitRoom: an item within pickup range (box + margin) holds ONE more slot back', () => {
  const feet = new Vec3(0.5, 64, 0.5)
  const at = (x, y, z) => ({ 1: { name: 'item', position: new Vec3(x, y, z) } })
  assert.equal(pickupPending(feet, at(1.5, 64, 0.5)), true, 'inside the box')
  assert.equal(pickupPending(feet, at(0.5 + 1.425 + PICKUP_MARGIN - 0.1, 64, 0.5)), true, 'just outside the box, inside the margin')
  assert.equal(pickupPending(feet, at(0.5 + 1.425 + PICKUP_MARGIN + 0.2, 64, 0.5)), false, 'beyond the margin')
  assert.equal(pickupPending(feet, { 1: { name: 'zombie', position: new Vec3(1, 64, 0) } }), false, 'only items')
  const pick = roomRecipe(mc, recipeOf('stone_pickaxe', { cobblestone: 1, stick: 1 }), 'stone_pickaxe')
  const bag = bagOf(35, [item('stick', 5)])
  assert.equal(admitRoom(bag, pick).ok, true, 'positive control: 35 + the pickaxe fits')
  const r = admitRoom(bag, pick, { pickupNear: true })
  assert.deepEqual([r.ok, r.reason, r.reserve], [false, 'no_room', 1], 'the margin slot is held back')
  assert.equal(admitRoom(bagOf(34, [item('stick', 5)]), pick, { pickupNear: true, owedTables: 1 }).ok, false, 'table + pickup: two held back')
})

await t('roomAdvice names ONLY a remedy whose precondition holds here; CONFINED (full stacks, no tool, no site) -> deposit or none', () => {
  const isPlaceable = n => mc.blocksByName[n]?.boundingBox === 'block' && !!mc.itemsByName[n]
  const consumes = [{ name: 'cobblestone', count: 3 }, { name: 'stick', count: 2 }]
  const withDirt = bagOf(36, [item('stick', 5), item('dirt', 1)])
  assert.equal(roomAdvice({ items: withDirt, consumes, isPlaceable, placeSite: true }).kind, 'place')
  assert.match(roomAdvice({ items: withDirt, consumes, isPlaceable, placeSite: true }).text, /^place dirt -- placing your one dirt frees its slot/)
  assert.notEqual(roomAdvice({ items: withDirt, consumes, isPlaceable, placeSite: false }).kind, 'place', 'no site: never "place"')
  const bread = bagOf(36, [item('stick', 5), item('bread', 1)])
  const order = ['bread']
  assert.equal(roomAdvice({ items: bread, consumes, foodOrder: order, hunger: 12 }).kind, 'eat')
  assert.notEqual(roomAdvice({ items: bread, consumes, foodOrder: order, hunger: 20 }).kind, 'eat', 'eat refuses at full hunger')
  assert.notEqual(roomAdvice({ items: bagOf(36, [item('stick', 5), item('bread', 3)]), consumes, foodOrder: order, hunger: 12 }).kind, 'eat',
    'three breads: one bite frees nothing')
  // CONFINED: every stack full, no expendable tool, no placement site
  const confined = bagOf(36, [item('stick', 64)])
  const d = roomAdvice({ items: confined, consumes, isPlaceable, placeSite: false, foodOrder: order, hunger: 10, depositItem: 'diorite' })
  assert.equal(d.kind, 'deposit'); assert.match(d.text, /^deposit diorite -- it walks home to the town chest/)
  const n = roomAdvice({ items: confined, consumes, isPlaceable, placeSite: false, foodOrder: order, hunger: 10, depositItem: null })
  assert.equal(n.kind, 'none'); assert.match(n.text, /^no slot can be freed from here/)
  for (const a of [d, n]) assert.doesNotMatch(a.text, /plac|\beat\b|use up|wear/, `an unexecutable remedy was named: ${a.text}`)
})

await t('executionVerdict: produced is ONE execution -- an inflated server count (a pickup during the craft) is capped', () => {
  assert.equal(executionVerdict({ synced: true, got: { produced: 2, requested: 1 }, perCraft: 1 }).produced, 1)
  assert.equal(executionVerdict({ synced: true, got: { produced: 8, requested: 4 }, perCraft: 4 }).produced, 4)
  assert.equal(executionVerdict({ synced: true, got: undefined, perCraft: 4 }).produced, 4, 'a resolve without counts is still one confirmed execution')
})

await t('executionVerdict: other errors are named by the caller; WITHOUT craftsync the local count decides (verified_local)', () => {
  for (const e of [new Error('Event windowOpen did not fire'), new CraftSyncError('busy', { failClass: 'craft_busy' }),
                   new CraftSyncError('late', { failClass: 'craft_deadline', produced: 1, requested: 1 })]) {
    const v = executionVerdict({ synced: true, error: e })
    assert.deepEqual([v.ok, v.verdict, v.produced], [false, 'error', 0], e.message)
  }
  assert.deepEqual(executionVerdict({ synced: false, arrived: true, perCraft: 4 }), { ok: true, source: 'local', verdict: 'none', produced: 4, retry: false })
  assert.deepEqual(executionVerdict({ synced: false, arrived: false, perCraft: 4 }), { ok: false, source: 'none', verdict: 'none', produced: 0, retry: false })
  assert.equal(executionVerdict({ synced: false, error: unconfirmedLike() }).verdict, 'error', 'a CraftSyncError without craftsync installed is not a verdict')
})
function unconfirmedLike () { return Object.assign(new Error('x'), { failClass: 'craft_unconfirmed', reason: 'not_in_inventory' }) }

// --- the fake bot -----------------------------------------------------------
const key = p => `${p.x},${p.y},${p.z}`
/** Two side blocks at foot level with solid floor below: what the wear-out remedy may dig. */
const WALLS = [new Vec3(-1, 64, 0), new Vec3(0, 64, -1)]
/**
 * opts
 *   tables      crafting tables already standing (not this call's)
 *   craftLands  false: the ingredients go and nothing arrives
 *   synced      false: craftsync is NOT installed (no bot.craftSync; bot.craft resolves undefined, like mineflayer's)
 *   server      ({ resultId, name, n }) => what the SERVER does with craft number n (0-based):
 *                 'show'     the result arrives (the default)
 *                 'deny'     the server rejects it and puts the bag back as it was, ingredients included (RCON, every
 *                            denied scene) -- craftsync's after-resync shows exactly that
 *                 'lose'     the ingredients are gone and nothing arrives
 *                 'silent'   the result arrives, but craftsync's resync is never answered
 *                 'inflate'  the result arrives AND the server's pickup adds another during the craft
 *   afterDig    hook after each dig has landed (block, { putAway }) -- e.g. the server's auto-pickup of a stray item
 *   walls       stone at these cells (default WALLS: two side blocks at foot level, the only safe wear-out targets)
 *   toolBreakMs a tool's last use is taken off the bag this long AFTER the dig resolves (the server's slot update)
 *   tableDrop   {dx,dy,dz}: a dug table's item comes to rest here (from the cell's corner) as an entity, and is only
 *               taken by the pickup rule -- not straight into the bag
 *   onLook      hook on every lookAt -- including the one mineflayer's dig does itself unless forceLook is 'ignore'
 *   afterCraft  hook after each bot.craft ({ setBlock, world, slots })
 *   beforeAdmit hook inside craftsync's baseline resync, before its admission reads the bag ({ slots, putAway })
 *   onDig       hook before each dig (block) -- e.g. an abort arriving mid-dig
 *   registry    a registry override (an id the bot cannot name)
 */
function makeBot (stacks, { tables = [], craftLands = true, synced = true, server = null, afterCraft = null, beforeAdmit = null,
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
  const tossed = []; const digs = []; const ground = []; const crafts = []; const admissions = []
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
  let craftNo = 0
  const bot = Object.assign(new EventEmitter(), {
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
    // CRAFTSYNC'S CONTRACT, at its boundary (craftsync.mjs): the clicks run with mineflayer's put-away (a full bag
    // THROWS the result on the ground), then the SERVER's bag -- these slots -- is counted. It resolves
    // { produced, requested } only when the count rose by every craft, and otherwise throws CraftSyncError exactly
    // as craftsync does: not_in_inventory when the server's count fell short, unverified when the resync went
    // unanswered, interrupted on an abort.
    async craft (recipe, count = 1, table, opts = {}) {
      if (recipe.requiresTable && !table) throw new Error('Recipe requires craftingTable')
      // the baseline resync: what lands meanwhile (beforeAdmit) is in the bag craftsync's admission reads
      if (synced && typeof opts?.admit === 'function') {
        beforeAdmit?.({ slots, putAway })
        const no = admissionRefusal(opts.admit, bot.inventory.items(), { source: 'resync' })
        if (no) {
          admissions.push(no)
          throw new CraftSyncError(`craft refused before any click: ${no.reason}`, { failClass: no.failClass, produced: 0, requested: count * recipe.result.count, reason: no.reason })
        }
      }
      crafts.push(count)
      const name = mc.items[recipe.result.id].name
      const start = have(name)
      let say = 'show'
      for (let k = 0; k < count; k++) {
        const before = slots.map(x => x && { ...x })
        for (const d of recipe.delta) if (d.count < 0) take(mc.items[d.id].name, -d.count)
        say = server ? server({ resultId: recipe.result.id, name, n: craftNo++ }) : 'show'
        if (!craftLands || say === 'lose') continue
        if (say === 'deny') { before.forEach((x, i) => { slots[i] = x }); continue }
        putAway(item(name, recipe.result.count))
        if (say === 'inflate') putAway(item(name, recipe.result.count))
      }
      afterCraft?.({ setBlock, world, slots })
      if (opts?.signal?.aborted) throw new CraftSyncError('craft aborted: aborted', { failClass: 'interrupted', aborted: true, reason: 'aborted' })
      if (!synced) return undefined
      const produced = have(name) - start; const requested = count * recipe.result.count
      if (say === 'silent') {
        throw new CraftSyncError('the server did not answer the inventory resync (local (after unanswered)); the craft cannot be confirmed',
          { failClass: 'craft_unconfirmed', produced, requested, reason: 'unverified' })
      }
      if (produced < requested) {
        throw new CraftSyncError(`mineflayer reported the craft done, but ${produced} of ${requested} arrived`,
          { failClass: 'craft_unconfirmed', produced, requested, reason: 'not_in_inventory' })
      }
      return { produced, requested }
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
  if (synced) bot.craftSync = { fake: 'craftsync contract' }
  return { bot, slots, world, tossed, digs, ground, have, crafts, setBlock, admissions }
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
  // ...and craftsync's verification DETECTS it (the server count did not rise) but cannot undo it: the pickaxe is on
  // the ground either way. That is why the room check, not the verifier, has to stand in front of the craft.
  await assert.rejects(bot.craft(bot.recipesFor(mc.itemsByName.stone_pickaxe.id, null, 1, true)[0], 1, true),
    e => e.failClass === 'craft_unconfirmed' && e.reason === 'not_in_inventory')
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

await t('whole-tree PLAN log -> planks -> sticks -> pickaxe: every step is checked and verified, nothing thrown', async () => {
  const n = await mark()
  const { bot, tossed, have } = makeBot(bagOf(30, [item('oak_log', 3)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(have('wooden_pickaxe'), 1); assert.deepEqual(tossed, [])
  assert.deepEqual([r.item, r.requested, r.executions, r.produced], ['wooden_pickaxe', 1, 1, 1], 'the plan reports the root item counts')
  const verified = (await rowsSince(n)).filter(x => x.kind === '_craft_room' && x.status === 'success').map(x => x.detail.split(' ')[1])
  for (const lvl of ['oak_planks', 'stick', 'wooden_pickaxe']) assert.ok(verified.includes(lvl), `${lvl} not verified: ${verified}`)
})

await t('PLAN with a full bag: the PLANKS step refuses (the log stack is not emptied) and the tree stops there', async () => {
  const { bot, tossed, have } = makeBot(bagOf(36, [item('oak_log', 5)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.deepEqual(tossed, [], `a sub-level craft threw ${JSON.stringify(tossed)} on the ground`)
  assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.match(r.detail, /No room for oak_planks/)
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

await t('verification failure: nothing arrives -> craftsync\'s craft_unconfirmed, never success, nothing credited', async () => {
  const n = await mark()
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], craftLands: false })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'craft_unconfirmed', r.detail)
  assert.match(r.detail, /did not reach the inventory/, 'the server confirmed the absence')
  assert.deepEqual([r.executions, r.produced], [0, 0])
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'unverified' && /source=server verdict=denied/.test(x.detail)))
})

await t('verification failure at a SUB-level stops the whole tree with that class', async () => {
  const { bot } = makeBot(bagOf(20, [item('oak_log', 3)]), { tables: [NEAR], craftLands: false })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.failClass, 'craft_unconfirmed', r.detail); assert.match(r.detail, /making oak_planks for wooden_pickaxe/)
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

await t('WITHOUT craftsync the local count is all there is -> success, verification verified_local, source=local row', async () => {
  const n = await mark()
  const { bot, have } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], synced: false })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(have('stone_pickaxe'), 1)
  assert.equal(r.status, 'success', r.detail); assert.equal(r.verification, 'verified_local', r.detail)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'verified_local' && /source=local/.test(x.detail)))
})

await t('WITHOUT craftsync, and the local count shows no gain either: unverified, source=none', async () => {
  const n = await mark()
  const { bot } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], craftLands: false, synced: false })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'unknown'); assert.equal(r.failClass, 'unverified', r.detail)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'unverified' && /source=none/.test(x.detail)))
})

await t('UNDER craftsync an unanswered resync is NOT verified_local, though the local bag shows the pickaxe: source=none, unconfirmed', async () => {
  const n = await mark()
  const { bot, have, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: () => 'silent' })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(have('stone_pickaxe'), 1, 'positive control: the local bag does show it')
  assert.equal(r.failClass, 'craft_unconfirmed', r.detail); assert.notEqual(r.status, 'success')
  assert.deepEqual([r.executions, r.produced], [0, 0], 'a local count credited as made')
  assert.deepEqual(crafts, [1], 'an unanswered resync is never retried')
  assert.match(r.detail, /could not confirm delivery of stone_pickaxe/)
  assert.doesNotMatch(r.detail, /did not reach the inventory/, 'an unanswered resync is a don\'t-know, not a server-confirmed absence')
  const rows = (await rowsSince(n)).filter(x => x.kind === '_craft_room')
  assert.ok(rows.some(x => x.status === 'unverified' && /source=none verdict=unanswered/.test(x.detail)), JSON.stringify(rows))
  assert.ok(!rows.some(x => x.status === 'verified_local'))
})

await t('WITHOUT craftsync a verified_local execution does NOT stop the craft tree: the planned pickaxe is still made', async () => {
  const { bot, have } = makeBot(bagOf(30, [item('oak_log', 3)]), { tables: [NEAR], synced: false })
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

await t('COUNT IS ITEMS (craftsync): oak_planks x3 is ONE execution (4 planks); x8 is two; the result says items', async () => {
  const a = makeBot(bagOf(10, [item('oak_log', 1)]))
  const r = await run(a.bot, { item: 'oak_planks', count: 3 })
  assert.equal(r.status, 'success', r.detail); assert.equal(a.have('oak_planks'), 4); assert.deepEqual(a.crafts, [1])
  assert.deepEqual([r.item, r.requested, r.executions, r.produced], ['oak_planks', 3, 1, 4])
  assert.match(r.detail, /^crafted 4x oak_planks/)
  const b = makeBot(bagOf(10, [item('oak_log', 2)]))
  const r2 = await run(b.bot, { item: 'oak_planks', count: 8 })
  assert.equal(r2.status, 'success', r2.detail); assert.equal(b.have('oak_planks'), 8); assert.deepEqual(b.crafts, [1, 1], 'one execution per call')
  assert.deepEqual([r2.requested, r2.executions, r2.produced], [8, 2, 8])
})

await t('NEVER DOUBLE-COUNTS: an inflated server count (a pickup during the craft) credits ONE execution, and the runner says +1', async () => {
  const { bot, have } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: () => 'inflate' })
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  const r = await new Runner(bot).run('craft', { item: 'stone_pickaxe', count: 1 })
  assert.equal(have('stone_pickaxe'), 2, 'positive control: the bag really holds two')
  assert.match((r.contractEvidence ?? []).join(';'), /crafted: stone_pickaxe \+1 /, `${r.status} ${(r.contractEvidence ?? []).join(';')}`)
})

await t('NEVER DOUBLE-COUNTS: a planned wooden_pickaxe credits the pickaxe once; the planks and sticks are named, not counted', async () => {
  const n = await mark()
  const { bot } = makeBot(bagOf(20, [item('oak_log', 3)]), { tables: [NEAR] })
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  const r = await new Runner(bot).run('craft', { item: 'wooden_pickaxe', count: 1 })
  const ev = (r.contractEvidence ?? []).join(';')
  assert.match(ev, /crafted: wooden_pickaxe \+1 /, `${r.status} ${r.detail} ${ev}`)
  assert.match(r.detail, /first made 8x oak_planks, 4x stick/)
  const rows = (await rowsSince(n)).filter(x => x.kind === '_craft_room' && x.status === 'success')
  assert.deepEqual(rows.map(x => x.detail.split(' ')[1]), ['oak_planks', 'oak_planks', 'stick', 'wooden_pickaxe'], 'one row per execution')
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

await t('PLAN: stick x3 from one log is ONE stick execution (4 sticks); the planks it made are named, not counted', async () => {
  const { bot, have } = makeBot(bagOf(10, [item('oak_log', 1)]))
  const r = await run(bot, { item: 'stick', count: 3 })
  assert.equal(r.status, 'success', r.detail); assert.equal(have('stick'), 4); assert.equal(have('oak_planks'), 2)
  assert.deepEqual([r.item, r.requested, r.executions, r.produced], ['stick', 3, 1, 4], r.detail)
  assert.match(r.detail, /first made 4x oak_planks/)
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

await t('RUNNER: the final item DENIED by the server is never a success, whatever the sub-crafts put in the bag', async () => {
  // planks in hand, so the sub-craft (sticks) and the final craft fit inside the suite's 300 ms runner watchdog
  const { bot, have } = makeBot(bagOf(20, [item('oak_planks', 7)]), { tables: [NEAR], server: ({ name }) => (name === 'wooden_pickaxe' ? 'deny' : 'show') })
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  const r = await new Runner(bot).run('craft', { item: 'wooden_pickaxe', count: 1 })
  assert.ok(have('stick') > 0, 'the sub-crafts did put things in the bag')
  assert.notEqual(r.status, 'success', `upgraded on the sub-crafts' gain: ${r.detail}`)
  assert.equal(r.failClass, 'craft_unconfirmed')
  assert.doesNotMatch((r.contractEvidence ?? []).join(';'), /crafted/)
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
  assert.equal(r.failClass, 'craft_unconfirmed')
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
await t('DENIED, then CONFIRMED on the one retry: success, two crafts, retried=1 on the row', async () => {
  const n = await mark()
  const { bot, have, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ n: k }) => (k === 0 ? 'deny' : 'show') })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(r.verification, 'server')
  assert.deepEqual(crafts, [1, 1]); assert.equal(have('stone_pickaxe'), 1); assert.equal(have('stick'), 3)
  assert.deepEqual([r.executions, r.produced], [1, 1], 'the denied attempt is not counted')
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'success' && /retried=1 retry=server/.test(x.detail)))
})

await t('DENIED TWICE: craft_unconfirmed, ingredients intact, no third try', async () => {
  const n = await mark()
  const { bot, have, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: ({ n: k }) => (k < 2 ? 'deny' : 'show') })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'craft_unconfirmed', r.detail)
  assert.deepEqual(crafts, [1, 1], 'a third try')
  assert.equal(have('stick'), 5); assert.equal(have('stone_pickaxe'), 0)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'unverified' && /retried=1 retry=denied/.test(x.detail)))
})

await t('an UNANSWERED resync is never retried (only a denial is)', async () => {
  const { bot, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: () => 'silent' })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'craft_unconfirmed'); assert.deepEqual(crafts, [1])
})

await t('denied with the ingredients NOT restored by the server: no retry, craft_unconfirmed', async () => {
  const n = await mark()
  const { bot, crafts } = makeBot(bagOf(20, [item('stick', 5)]), { tables: [NEAR], server: () => 'lose' })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.deepEqual(crafts, [1], 'retried without the ingredients back'); assert.equal(r.failClass, 'craft_unconfirmed', r.detail)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && /not_retried=ingredients_not_restored/.test(x.detail)))
})

await t('RUNNER: a batch ABORTED after one verified execution still carries crafted +1', async () => {
  let runner = null
  const { bot } = makeBot(bagOf(20, [item('stick', 9)]), { tables: [NEAR], server: ({ n: k }) => {
    if (k === 1) runner.interrupt('test: abort between executions')
    return 'show' } })
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

// --- seventh pass ------------------------------------------------------------------
await t('CLEANUP REPLACES A PENDING ERROR: one execution verified, then a non-abort throw; an abort in the retake keeps crafted +1', async () => {
  // carried table -> placed by the plan -> 2 pickaxes: the first verifies, then a non-abort error is thrown while the
  // second is being read (the bag read fails once); the retake is then aborted and its error replaces the pending one
  let runner = null; let armed = false
  const { bot } = makeBot(bagOf(30, [item('stick', 9), item('crafting_table', 1)]), {
    server: ({ n: k }) => { if (k === 1) armed = true; return 'show' },
    onDig: b => { if (b.name === 'crafting_table') runner.interrupt('test: abort in the cleanup') } })
  const items = bot.inventory.items
  bot.inventory.items = () => { if (armed) { armed = false; throw new Error('injected: a non-abort failure after one verified execution') } return items() }
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  runner = new Runner(bot)
  const r = await runner.run('craft', { item: 'stone_pickaxe', count: 2 })
  assert.match((r.contractEvidence ?? []).join(';'), /crafted: stone_pickaxe \+1/, `${r.status} ${r.detail}`)
})

// --- the plan path and the room check, step by step -----------------------------------
await t('PLAN fills the bag mid-tree: the STICK step refuses (no slot for sticks), nothing thrown, the planks it made are kept', async () => {
  const { bot, tossed, have, crafts } = makeBot(bagOf(35, [item('oak_log', 3)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.deepEqual(tossed, [], `a planned step threw ${JSON.stringify(tossed)} on the ground`)
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.match(r.detail, /No room for stick.*\[making stick for wooden_pickaxe\]/)
  assert.deepEqual(crafts, [1, 1], 'two plank executions, no stick'); assert.equal(have('oak_planks'), 8)
  assert.deepEqual([r.item, r.executions, r.produced], ['wooden_pickaxe', 0, 0])
})

await t('PLAN puts down a table: it is watched and taken back, and its slot is reserved through the plan', async () => {
  const n = await mark()
  const { bot, have, world, digs } = makeBot(bagOf(20, [item('oak_log', 3), item('crafting_table', 1)]))
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(have('wooden_pickaxe'), 1)
  assert.match(r.detail, /placed a crafting_table/); assert.match(r.detail, /took the table back/)
  assert.equal(have('crafting_table'), 1); assert.ok(![...world.values()].includes('crafting_table'))
  assert.deepEqual(digs.map(d => d.name), ['crafting_table'])
  assert.ok((await rowsSince(n)).some(x => x.kind === '_table_retaken' && x.status === 'success'))
})

// --- admission after craftsync's baseline resync (both reviews, P1) ----------------------
await t('ADMISSION: a pickup lands during the baseline resync -> refused before any click, nothing taken, row source=none', async () => {
  const n = await mark()
  const { bot, crafts, have, tossed, admissions } = makeBot(bagOf(35, [item('stick', 5)]), { tables: [NEAR],
    beforeAdmit: ({ putAway }) => putAway(item('dirt', 1)) })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(admissions.length, 1, 'craftsync admission never asked')
  assert.deepEqual(crafts, [], 'clicked after the admission refused'); assert.deepEqual(tossed, [])
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.match(r.detail, /filled while craftsync resynced it/)
  assert.equal(have('stick'), 5)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'refused' &&
    /source=none verdict=no_room_after_resync/.test(x.detail)))
})

await t('ADMISSION positive control: the same craft with nothing landing is admitted and made', async () => {
  const { bot, crafts, have, admissions } = makeBot(bagOf(35, [item('stick', 5)]), { tables: [NEAR], beforeAdmit: () => {} })
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.deepEqual(admissions, []); assert.deepEqual(crafts, [1]); assert.equal(have('stone_pickaxe'), 1)
})

// --- round 2: the pickup hold-back is about the ITEM, never paid for with a tool ---------------
const DROP = (bot, x, z = 0.5, name = 'dirt', id = 77) => {
  bot.entities[id] = { id, name: 'item', drop: name, position: new Vec3(x, 64, z), getDroppedItem: () => ({ name, count: 1 }) }
}
const behindAWall = ({ goal }) => { if (goal?.item) throw Object.assign(new Error('no path'), { failClass: 'no_path' }) }

await t('PICKUP HOLD-BACK, WALLED OFF: a drop 2.0 blocks away behind a wall -> no tool worn, the refusal names it and its distance', async () => {
  const n = await mark()
  const { bot, crafts, digs, tossed, have } = makeBot(bagOf(35, [item('stick', 5), spent('stone_axe'), PICK()]), { tables: [NEAR], onGoto: behindAWall })
  DROP(bot, 2.5)
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(digs.length, 0, `wore out a tool to pay for a held-back slot: ${JSON.stringify(digs)}`); assert.equal(have('stone_axe'), 1)
  assert.deepEqual(crafts, []); assert.deepEqual(tossed, [])
  assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.match(r.detail, /dirt 2\.0 blocks away is within pickup range/)
  assert.match(r.detail, /^step away from the dirt 2\.0 blocks away or collect it\./, 'the remedy leads')
  assert.doesNotMatch(r.detail, /nothing in the bag can be freed|no slot can be freed/, 'a slot IS free: the advice must not say otherwise')
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'refused' && /reason=pickup_pending dirt 2\.0/.test(x.detail)))
})

await t('COMPOSED: ...the bot then steps away from the drop (the refusal\'s remedy) -> the next craft is admitted and made, no tool worn', async () => {
  const { bot, crafts, digs, have } = makeBot(bagOf(35, [item('stick', 5), spent('stone_axe'), PICK()]), { tables: [NEAR], onGoto: behindAWall })
  DROP(bot, 2.5)
  const first = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(first.failClass, 'inventory_full', first.detail)
  bot.entity.position = new Vec3(0.5, 64, -2.5)          // three blocks off: the drop leaves the grown box, the table stays in reach
  assert.equal(pickupPending(bot.entity.position, bot.entities), false, 'positive control: the step did take it out of range')
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.deepEqual(crafts, [1]); assert.equal(have('stone_pickaxe'), 1); assert.equal(digs.length, 0)
})

await t('COMPOSED: a REACHABLE drop is collected first (a slot was free); the bag is then honestly full and room is made the normal way', async () => {
  // stone beside where the walk ends (the drop's column), so the wear-out has a side block there too
  const { bot, crafts, digs, have, tossed } = makeBot(bagOf(35, [item('stick', 5), spent('stone_axe'), PICK()]),
    { tables: [NEAR], walls: [...WALLS, new Vec3(3, 64, 0)] })
  DROP(bot, 2.5)
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.match(r.detail, /collected the dirt that lay within pickup range/)
  assert.equal(have('dirt'), 1, 'the drop is in the bag'); assert.equal(have('stone_pickaxe'), 1); assert.deepEqual(crafts, [1])
  assert.equal(digs.length, 1, 'one spent tool for the one slot the collected drop now really takes'); assert.deepEqual(tossed, [])
})

await t('a REALLY full bag with a drop in range: the refusal says how many slots are held back and why', async () => {
  const { bot, digs } = makeBot(bagOf(36, [item('stick', 5)]), { tables: [NEAR] })
  DROP(bot, 2.5)
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.equal(digs.length, 0)
  assert.match(r.detail, /1 slot\(s\) held back: 1 for dirt on the ground 2\.0 blocks away/)
})

await t('the hold-back is HELD ONLY while it would bite: admitRoom.pickupOnly, heldLine and pickupNearest say what and why', () => {
  const pick = roomRecipe(mc, recipeOf('stone_pickaxe', { cobblestone: 1, stick: 1 }), 'stone_pickaxe')
  const p = pickupNearest(new Vec3(0.5, 64, 0.5), { 9: { id: 9, name: 'item', position: new Vec3(2.5, 64, 0.5), getDroppedItem: () => ({ name: 'dirt' }) } })
  assert.deepEqual([p.id, p.name, p.distance.toFixed(1)], [9, 'dirt', '2.0'])
  const r = admitRoom(bagOf(35, [item('stick', 5)]), pick, { pickupNear: p })
  assert.deepEqual([r.ok, r.pickupOnly, r.held], [false, true, { table: 0, pickup: 1 }])
  assert.match(heldLine(r), /^1 slot\(s\) held back: 1 for dirt on the ground 2\.0 blocks away/)
  const both = admitRoom(bagOf(35, [item('stick', 5)]), pick, { pickupNear: p, owedTables: 1 })
  assert.equal(both.pickupOnly, false, 'short even without the pickup: the table slot is the real shortfall')
  assert.match(heldLine(both), /1 for the crafting_table this craft will take back, 1 for dirt/)
  assert.equal(admitRoom(bagOf(36, [item('stick', 5)]), pick, { pickupNear: p }).pickupOnly, false, 'really full: not pickup-only')
})

await t('PLACEMENT ADVICE uses the stack place() takes: dirt x64 BEFORE dirt x1 -> no "place" advice; x1 first -> advised', () => {
  const isPlaceable = n => mc.blocksByName[n]?.boundingBox === 'block' && !!mc.itemsByName[n]
  const consumes = [{ name: 'cobblestone', count: 3 }, { name: 'stick', count: 2 }]
  const bigFirst = bagOf(36, [item('stick', 5), item('dirt', 64), item('dirt', 1)])
  assert.equal(placeStackOf(bigFirst, 'dirt').count, 64, 'place() takes the 64')
  assert.equal(bagFill(bigFirst, isPlaceable, consumes).cheapest, null)
  assert.notEqual(roomAdvice({ items: bigFirst, consumes, isPlaceable, placeSite: true }).kind, 'place', 'advised a placement that frees nothing')
  const oneFirst = bagOf(36, [item('stick', 5), item('dirt', 1), item('dirt', 64)])
  assert.equal(roomAdvice({ items: oneFirst, consumes, isPlaceable, placeSite: true }).kind, 'place', 'positive control')
})

await t('DEPOSIT ADVICE only if the plan, as deposit() runs it, empties a stack (Codex: 2 of 10 cobblestone + 3 of 5 sticks frees nothing)', () => {
  const bag = [item('cobblestone', 10), item('stick', 5)]; for (let i = 0; i < 34; i++) bag.push(item('dirt', 64))
  const plan = depositPlan(bag, null, { wants: [] })
  assert.deepEqual(plan.map(x => `${x.name}x${x.count}`).sort(), ['cobblestonex2', 'stickx3'], 'the repro plan')
  assert.equal(depositFreesSlot(bag, plan), false)
  assert.equal(roomAdvice({ items: bag, consumes: [], depositItem: depositTarget(bag, plan, []) }).kind, 'none')
  const ctl = [item('cobblestone', 10), item('stick', 5)]; for (let i = 0; i < 34; i++) ctl.push(item('andesite', 64))
  assert.equal(depositFreesSlot(ctl, depositPlan(ctl, null, { wants: [] })), true, 'positive control: all 10 cobblestone go, a slot frees')
  assert.equal(depositFreesSlot([item('stick', 2), item('stick', 40)], [{ name: 'stick', count: 2 }]), true, 'slot order: the first stack is taken whole')
  assert.equal(depositFreesSlot([item('stick', 40), item('stick', 2)], [{ name: 'stick', count: 2 }]), false, 'the 40 is first: 2 off it frees nothing')
})

// --- round 3: the pickup step stays within the table's reach, merges, and runs once per craft level --------
await t('WALK BACK FAILS: the pickup walk leaves the table out of reach and the way back throws -> bot.craft never runs, no no_path', async () => {
  const n = await mark()
  let detoured = false
  const { bot, crafts } = makeBot(bagOf(35, [item('stick', 5)]), { tables: [NEAR], onGoto: ({ goal, bot: b }) => {
    if (goal?.item) { detoured = true; b.entity.position = new Vec3(9.5, 64, 0.5); throw Object.assign(new Error('a detour'), { failClass: 'no_path' }) }
    if (detoured) throw Object.assign(new Error('no path back'), { failClass: 'no_path' })
  } })
  DROP(bot, 2.5)
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.ok(detoured, 'positive control: the walk did happen')
  assert.deepEqual(crafts, [], 'bot.craft ran out of the table\'s reach')
  assert.deepEqual([r.status, r.failClass], ['unknown', 'unverified'], r.detail)
  assert.notEqual(r.failClass, 'no_path')
  assert.match(r.detail, /^walk back to the crafting_table at 1,64,0: the walk to collect dirt left it out of reach/)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && /reason=table_out_of_reach/.test(x.detail)))
})

await t('REACH BAND: an item beyond STATION_REACH - 1.5 of the table is refused WITHOUT walking (reason=pickup_pending)', async () => {
  const n = await mark()
  let walks = 0
  const { bot, crafts, digs } = makeBot(bagOf(35, [item('stick', 5), spent('stone_axe'), PICK()]), { tables: [NEAR],
    onGoto: ({ goal }) => { if (goal?.item) walks++ } })
  DROP(bot, -1.9)                                     // 2.4 from the feet (in range), 3.4 from the table centre (out of the band)
  assert.equal(pickupPending(bot.entity.position, bot.entities), true, 'positive control: the drop is in pickup range')
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(walks, 0, 'walked to an item the craft could not collect and still reach its table')
  assert.deepEqual(crafts, []); assert.equal(digs.length, 0)
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.match(r.detail, /too far to collect and still craft there/)
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && /reason=pickup_pending dirt/.test(x.detail)))
})

await t('MERGEABLE PICKUP (Codex): 36/36 with stick x2 + dirt x63 and a dirt x1 two blocks off -> collected into the stack, then crafted', async () => {
  const { bot, have, crafts, tossed } = makeBot(bagOf(36, [item('stick', 2), item('dirt', 63)]), { tables: [NEAR] })
  DROP(bot, 2.5)
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.status, 'success', r.detail); assert.equal(have('dirt'), 64); assert.equal(have('stone_pickaxe'), 1)
  assert.deepEqual(crafts, [1]); assert.deepEqual(tossed, [])
})

await t('MERGEABLE PICKUP positive control: the dirt stack is FULL (64) -> no slot, no stack: refused, nothing walked to', async () => {
  let walks = 0
  const { bot, crafts } = makeBot(bagOf(36, [item('stick', 2), item('dirt', 64)]), { tables: [NEAR], onGoto: ({ goal }) => { if (goal?.item) walks++ } })
  DROP(bot, 2.5)
  const r = await run(bot, { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.match(r.detail, /no free slot or open stack to collect it into/)
  assert.equal(walks, 0); assert.deepEqual(crafts, [])
})

await t('collectDecision: stack room is the REGISTRY\'s stackSize (egg 16), never an assumed 64; the reach band is measured from the table', () => {
  const bag = n => bagOf(36, [item('egg', n)])
  const sizeOf = name => mc.itemsByName[name]?.stackSize
  const egg = { name: 'egg', count: 1, position: new Vec3(2.5, 64, 0.5) }
  assert.equal(mc.itemsByName.egg.stackSize, 16, 'the fixture is a 16-stack')
  assert.equal(collectDecision({ items: bag(15), pickup: egg, stackSizeOf: sizeOf }).collect, true)
  assert.equal(collectDecision({ items: bag(16), pickup: egg, stackSizeOf: sizeOf }).collect, false, 'a full 16-stack has no room, whatever 64 says')
  assert.equal(collectDecision({ items: bag(15), pickup: { ...egg, count: 2 }, stackSizeOf: sizeOf }).collect, false, 'room for the WHOLE drop')
  assert.equal(collectDecision({ items: bagOf(35, []), pickup: egg }).collect, true, 'a free slot')
  const centre = new Vec3(1.5, 64.5, 0.5)
  assert.equal(collectDecision({ items: bagOf(35, []), pickup: { ...egg, position: new Vec3(1.5 + 4.5 - PICKUP_TABLE_BAND - 0.1, 64.5, 0.5) }, tableCentre: centre }).collect, true)
  assert.equal(collectDecision({ items: bagOf(35, []), pickup: { ...egg, position: new Vec3(1.5 + 4.5 - PICKUP_TABLE_BAND + 0.1, 64.5, 0.5) }, tableCentre: centre }).collect, false)
})

await t('ONCE PER CRAFT LEVEL: a 16-execution batch beside a stream of drops waits and walks ONCE, then refuses naming the item', async () => {
  let waits = 0, walks = 0, next = 100
  const made = makeBot(bagOf(35, [item('oak_log', 16), item('cobblestone', 10)]), {
    onGoto: ({ goal }) => { if (goal?.item) walks++ },
    // every craft, another drop rolls up two blocks from wherever the bot now stands
    afterCraft: () => { const f = made.bot.entity.position; DROP(made.bot, f.x + 2, f.z, 'cobblestone', next++) } })
  const { bot, crafts } = made
  bot.waitForTicks = async n => { if (n === 20) waits++ }
  DROP(bot, 2.5, 0.5, 'cobblestone')
  const r = await run(bot, { item: 'oak_planks', count: 64 })
  assert.equal(waits, 1, `waited ${waits} times`); assert.equal(walks, 1, `walked ${walks} times`)
  assert.ok(crafts.length >= 1, 'positive control: the first execution was made after the one wait/walk')
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.match(r.detail, /already waited for and tried an item once in this craft/)
  assert.match(r.detail, /cobblestone 2\.0 blocks away/)
})

// --- round 4: a 2x2 step of a plan is anchored to the plan's station ---------------------------------
await t('PLAN table step -> 2x2 step with a pickup -> table step: the 2x2 step\'s pickup is measured from the STATION; no craft out of reach', async () => {
  // the real plan: wooden_pickaxe[T] (oak) > birch_planks (2x2) > wooden_pickaxe[T] (birch). After the first craft a
  // cobblestone drop rolls up 2.4 blocks off, up a ledge, on the far side from the table: collecting it would leave the
  // bot 5.2 blocks from the table for the last step.
  let dropped = false
  const made = makeBot(bagOf(36, [item('oak_planks', 3), item('stick', 4), item('birch_log', 1), item('cobblestone', 10)]), { tables: [NEAR],
    afterCraft: () => { if (!dropped) { dropped = true; DROP(made.bot, -2.9, -1.9, 'cobblestone'); made.bot.entities[77].position = new Vec3(-2.9, 66.5, -1.9) } } })
  const { bot, crafts } = made
  bot.entity.position = new Vec3(-0.5, 64, 0.5)
  const centre = new Vec3(1.5, 64.5, 0.5)
  const reachAtCraft = []
  const craft = bot.craft
  bot.craft = async (r, c, t, o) => { if (t) reachAtCraft.push(bot.entity.position.distanceTo(centre)); return craft(r, c, t, o) }
  const r = await run(bot, { item: 'wooden_pickaxe', count: 2 })
  assert.ok(dropped, 'positive control: the first (table) step ran and the drop appeared')
  assert.ok(reachAtCraft.every(d => d <= 4.5), `bot.craft at a table ${reachAtCraft.map(d => d.toFixed(2))} blocks away`)
  assert.notEqual(r.failClass, 'no_path', r.detail)
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.match(r.detail, /too far to collect and still craft there/)
  assert.deepEqual(crafts, [1], 'only the first table step: the 2x2 step refused, the last step never ran')
})

// --- stage 1 of the composter review: deposit advice spares the chain; the remedy leads -------------------------
const { formatOutcome, OUTCOME_CHARS } = await import('../src/cognitive.mjs')
const dirtFill = (stacks, n = 36) => { const a = stacks.slice(); while (a.length < n) a.push(item('dirt', 64)); return a }

await t('B1 (Claude): a pickaxe\'s advice never banks its own planks -- the real plan is [oak_planks 12, cobblestone 12]', () => {
  const bag = dirtFill([item('oak_planks', 12), item('stick', 2), item('cobblestone', 20)])
  const plan = depositPlan(bag, null, { wants: [] })
  assert.deepEqual(plan.map(e => `${e.name}x${e.count}`), ['oak_planks x12', 'cobblestone x12'].map(x => x.replace(' ', '')), 'the repro plan')
  assert.equal(depositTarget(bag, plan, []), 'oak_planks', 'positive control: the unrestricted target IS the planks')
  const consumes = roomRecipe(mc, recipeOf('wooden_pickaxe', { oak_planks: 1, stick: 1 }), 'wooden_pickaxe').consumes
  assert.equal(depositTarget(bag, plan, consumes), null, 'cobblestone 12 of 20 empties no stack; the planks are the craft\'s')
  assert.equal(roomAdvice({ items: bag, consumes, depositItem: depositTarget(bag, plan, consumes) }).kind, 'none')
})

await t('B1 through the skill: 36/36 that cannot make the pickaxe -> the refusal never says "deposit oak_planks" or "deposit stick"', async () => {
  const { bot, crafts } = makeBot(dirtFill([item('oak_planks', 12), item('stick', 3), item('cobblestone', 20)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'wooden_pickaxe', count: 1 })
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.deepEqual(crafts, [])
  assert.doesNotMatch(r.detail, /deposit (oak_planks|stick)\b/)
  assert.match(r.detail, /^no slot can be freed from here/, r.detail)
})

await t('B2 (Claude): a refusal at a plan\'s PLANKS step never advises depositing the planks a later step needs', async () => {
  // chest x9 needs 72 planks: 64 held (a FULL stack) + 2 log crafts. The planks step's output needs a new slot at 36/36.
  const n = await mark()
  const { bot, crafts } = makeBot(dirtFill([item('oak_log', 3), item('oak_planks', 64), item('cobblestone', 20)]), { tables: [NEAR] })
  const r = await run(bot, { item: 'chest', count: 9 })
  assert.equal(r.failClass, 'inventory_full', r.detail); assert.deepEqual(crafts, [])
  assert.match(r.detail, /No room for oak_planks.*\[making oak_planks for chest\]/)
  const items = bot.inventory.items()
  assert.equal(depositTarget(items, depositPlan(items, null, { wants: [] }), [{ name: 'oak_log' }]), 'oak_planks',
    'positive control: with only the planks step\'s own ingredient protected, the target IS the held planks')
  assert.doesNotMatch(r.detail, /deposit (oak_planks|oak_log)\b/, 'advised away an ingredient of a later step')
  assert.ok((await rowsSince(n)).some(x => x.kind === '_craft_room' && x.status === 'refused'))
})

await t('B3 (Codex): the remedy reaches the PROMPT -- every craft refusal leads with it, inside formatOutcome\'s 220 characters', async () => {
  // a refusal whose old layout put "deposit coal" past the cut: a long bag line, then the remedy
  const { bot } = makeBot(bagOf(36, [item('stick', 5), item('coal', 9), item('oak_sapling', 1), item('wheat_seeds', 1), item('apple', 1)]), { tables: [NEAR] })
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  const r = await new Runner(bot).run('craft', { item: 'stone_pickaxe', count: 1 })
  assert.equal(r.failClass, 'inventory_full', r.detail)
  const line = formatOutcome('craft', r, { value: 'failure', because: [] })
  assert.ok(line.length <= OUTCOME_CHARS)
  const remedy = /^(\w+(?: \w+)?) -- /.exec(r.detail)?.[1]
  assert.ok(remedy, `the detail does not lead with a remedy: ${r.detail}`)
  assert.ok(line.includes(r.detail.split('. No room')[0]), `the remedy was cut from the prompt: ${line}`)
  // POSITIVE CONTROL: the same refusal in e9da587's order (the remedy LAST) loses the remedy at the cut
  const [lead, rest] = [r.detail.slice(0, r.detail.indexOf('. No room')), r.detail.slice(r.detail.indexOf('. No room') + 2)]
  const oldLine = formatOutcome('craft', { ...r, detail: `${rest}. ${lead}` }, { value: 'failure', because: [] })
  console.log(`        [B3] remedy "${lead.slice(0, 40)}..." at ${r.detail.indexOf(lead)} now; at ${(`${rest}. ${lead}`).indexOf(lead)} in the old order`)
  assert.ok(!oldLine.includes(lead.split(' -- ')[0]), `the old order kept the remedy anyway, so this test proves nothing: ${oldLine}`)
})

await t('B3: the pickup and walk-back refusals lead with their remedy too, and it survives formatOutcome', async () => {
  const a = makeBot(bagOf(35, [item('stick', 5), spent('stone_axe'), PICK()]), { tables: [NEAR], onGoto: behindAWall })
  DROP(a.bot, 2.5)
  const r1 = await run(a.bot, { item: 'stone_pickaxe', count: 1 })
  assert.match(formatOutcome('craft', r1, { value: 'failure' }), /craft -> failed \(failure\): step away from the dirt 2\.0 blocks away or collect it\./)
  let detoured = false
  const b = makeBot(bagOf(35, [item('stick', 5)]), { tables: [NEAR], onGoto: ({ goal, bot: x }) => {
    if (goal?.item) { detoured = true; x.entity.position = new Vec3(9.5, 64, 0.5); throw new Error('a detour') }
    if (detoured) throw new Error('no path back')
  } })
  DROP(b.bot, 2.5)
  const r2 = await run(b.bot, { item: 'stone_pickaxe', count: 1 })
  assert.match(formatOutcome('craft', r2, null), /^craft -> unknown: walk back to the crafting_table at 1,64,0:/)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
