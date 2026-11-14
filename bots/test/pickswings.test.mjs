// IRONCHAIN-02 (C): AN IRON PICKAXE ASKED FOR SWINGS, WITH NO IRON IN THE BAG, IS A STONE ONE (pickswings.mjs swingRewrite;
// admission.mjs rewrites the craft's args; skills.mjs craftableFromBag is the whole-tree plan it asks).
//
// The fleet's case (12 h, 110 decisions): a deep bot (here y=-20: the reserve asks 106 swings, the two irons give 90) holding two iron pickaxes with uses, below the descent's swing
// reserve, asks `craft iron_pickaxe` with no iron ingots; tool hygiene admits it for the reserve; the craft fails "short 3x
// iron_ingot for the whole tree"; the next decision asks again. The tests drive the pure rule case by case, then the REAL
// AdmissionControl.check on a bag of real items with the real 1.21.8 recipes, then the chain: the rewritten craft is one the
// same gate admits, and once the stone copy is held the iron proposal is refused by tool hygiene with its own remedy
// ("dig with it") -- never a loop. Mutants assert their anchors.
process.env.LOG_DIR ??= '/tmp/mcbot-test-logs-pickswings'
process.env.STATE_DIR ??= '/tmp'
process.env.BOT_NAME ??= 'TestBot'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Recipe } = require_('prismarine-recipe')('1.21.8')

const PS = await import('../src/pickswings.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { craftableFromBag } = await import('../src/skills.mjs')
const { redundantCraft } = await import('../src/toolhygiene.mjs')
const { tapRecords } = await import('../src/logger.mjs')

/** A real mineflayer-shaped Item: name, count, slot, type, and durability for tools. */
function item (name, count = 1, usesLeft = null, slot = 0) {
  const d = mcData.itemsByName[name]
  const it = { name, count, slot, type: d.id }
  if (usesLeft != null) { it.maxDurability = d.maxDurability; it.durabilityUsed = d.maxDurability - usesLeft }
  return it
}
/** The fleet's bag: two worn-but-usable iron pickaxes (61 + 29 swings), cobble and deepslate, logs; NO iron. */
const fleetBag = (extra = []) => [item('iron_pickaxe', 1, 62, 0), item('iron_pickaxe', 1, 30, 1), item('cobblestone', 64, null, 2),
  item('cobbled_deepslate', 40, null, 3), item('oak_log', 8, null, 4), item('crafting_table', 1, null, 5), ...extra]
function botWith (items, y = -20) {
  return {
    username: 'TestBot', entity: { position: { x: 400.5, y, z: 200.5 } }, health: 20, food: 20, time: { day: 1, age: 1 },
    inventory: { items: () => items, emptySlotCount: () => 36 - items.length },
    registry: mcData, game: { dimension: 'overworld' },
    recipesAll: (id) => Recipe.find(id, null),
    findBlock: () => null,
  }
}

// ---- the pure rule ---------------------------------------------------------------------------------------------------------
test('POSITIVE CONTROL: tool hygiene admits the fleet\'s iron craft at y=-20 only for the swing reserve (refused without it)', () => {
  const bag = fleetBag()
  assert.equal(redundantCraft('iron_pickaxe', bag, { y: -20 }), null, 'admitted at depth (the reserve exemption)')
  assert.ok(redundantCraft('iron_pickaxe', bag, { y: null }), 'refused without the depth: the reserve is the only reason')
})
test('swingRewrite: the fleet\'s case -> stone_pickaxe, naming the held copy and the 0 ingots', () => {
  const r = PS.swingRewrite({ item: 'iron_pickaxe', items: fleetBag(), y: -20, stoneMakeable: () => true, ironMakeable: () => false, on: true })
  assert.equal(r?.to, 'stone_pickaxe'); assert.equal(r.held, 'iron_pickaxe')
  assert.match(r.detail, /0x iron_ingot \(an iron pickaxe needs 3\)/)
})
test('swingRewrite leaves it: 3 ingots in the bag; no stone copy makeable; the task wants it; hygiene refuses anyway; no usable iron copy; the switch off; another item', () => {
  const base = { item: 'iron_pickaxe', y: -20, stoneMakeable: () => true, ironMakeable: () => false, on: true }
  assert.equal(PS.swingRewrite({ ...base, items: fleetBag(), ironMakeable: () => true }), null, 'the bag can make the iron one after all (Codex r1)')
  assert.equal(PS.swingRewrite({ ...base, items: fleetBag(), ironMakeable: () => { throw new Error('x') } }), null, 'a throw reads as makeable')
  assert.equal(PS.swingRewrite({ ...base, items: fleetBag([item('iron_ingot', 3, null, 9)]) }), null, 'the iron craft can run')
  assert.equal(PS.swingRewrite({ ...base, items: fleetBag(), stoneMakeable: () => false }), null, 'no stone copy from here')
  assert.equal(PS.swingRewrite({ ...base, items: fleetBag(), stoneMakeable: () => { throw new Error('x') } }), null, 'a throw is a no')
  assert.equal(PS.swingRewrite({ ...base, items: fleetBag(), wanted: new Set(['iron_pickaxe']) }), null, 'the task wants it')
  assert.equal(PS.swingRewrite({ ...base, items: fleetBag(), y: 70 }), null, 'at the surface hygiene refuses it (redundant): not ours to rewrite')
  const stoneOnly = [item('stone_pickaxe', 1, 100, 0), item('stone_pickaxe', 1, 90, 1), item('cobblestone', 64, null, 2), item('oak_log', 8, null, 3)]
  assert.equal(PS.swingRewrite({ ...base, items: stoneOnly }), null, 'no iron copy: the iron craft is a tier step, left alone')
  assert.equal(PS.swingRewrite({ ...base, items: fleetBag(), on: false }), null, 'PICKSWINGS=0')
  assert.equal(PS.swingRewrite({ ...base, item: 'diamond_pickaxe', items: fleetBag() }), null)
  assert.equal(PS.pickSwingsOn({ PICKSWINGS: '0' }), false); assert.equal(PS.pickSwingsOn({}), true)
})

// ---- the whole-tree plan it asks ---------------------------------------------------------------------------------------------
test('craftableFromBag (the craft skill\'s own plan): stone_pickaxe from cobble + logs + a carried table yes; iron_pickaxe no; nothing to make sticks no', () => {
  assert.equal(craftableFromBag(botWith(fleetBag()), 'stone_pickaxe'), true)
  assert.equal(craftableFromBag(botWith(fleetBag()), 'iron_pickaxe'), false, 'positive control: the iron tree is short')
  const noWood = [item('iron_pickaxe', 1, 62, 0), item('iron_pickaxe', 1, 30, 1), item('cobblestone', 64, null, 2), item('crafting_table', 1, null, 3)]
  assert.equal(craftableFromBag(botWith(noWood), 'stone_pickaxe'), false)
})

// ---- the REAL gate ---------------------------------------------------------------------------------------------------------
const run = (bag, y = -20, wanted = null) => {
  const rows = []; const untap = tapRecords(r => { if (r?.skill?.name === '_pick_swings') rows.push(r.skill) })
  try { return { r: new AdmissionControl(null).check({ skill: 'craft', args: { item: 'iron_pickaxe', count: 2 } }, botWith(bag, y), wanted), rows } } finally { untap() }
}
test('THE GATE: the fleet\'s proposal is admitted as `craft stone_pickaxe`, with one _pick_swings row', () => {
  const { r, rows } = run(fleetBag())
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.skill, 'craft'); assert.equal(r.args.item, 'stone_pickaxe')
  assert.equal(r.args.count, 1, 'one stone copy: the count the plan was asked for')
  assert.equal(rows.length, 1); assert.match(rows[0].detail, /iron_pickaxe -> stone_pickaxe/)
})
test('THE GATE leaves a makeable iron craft alone (3 ingots), and the surface case is refused by hygiene as before', () => {
  assert.equal(run(fleetBag([item('iron_ingot', 3, null, 9)])).r.args?.item, 'iron_pickaxe')
  assert.equal(run(fleetBag([item('iron_block', 1, null, 9), item('stick', 4, null, 10)])).r.args?.item, 'iron_pickaxe', 'an iron block in the bag makes the ingots (Codex r1): the real plan says so')
  const top = run(fleetBag(), 70).r
  assert.equal(top.ok, false); assert.equal(top.reason, 'redundant_craft')
})
test('THE CHAIN: the stone copy made, the same proposal is refused by hygiene with a move from here ("dig with it") -- no loop', () => {
  // after the rewritten craft: a fresh stone pickaxe (131) in the bag; at y=-20 the swings now cover the reserve
  const after = fleetBag([item('stone_pickaxe', 1, 131, 9)])
  const { r } = run(after)
  assert.equal(r.ok, false, `refused, not rewritten again: ${JSON.stringify(r)}`)
  assert.equal(r.reason, 'redundant_craft'); assert.match(r.detail, /dig with it/)
  // and the stone craft the gate wrote is itself one the gate admits from the original bag (never a rewrite into a refusal)
  const stone = new AdmissionControl(null).check({ skill: 'craft', args: { item: 'stone_pickaxe', count: 1 } }, botWith(fleetBag()), null)
  assert.equal(stone.ok, true, JSON.stringify(stone))
})

// ---- mutants -----------------------------------------------------------------------------------------------------------------
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 90))}`)
  const out = new URL(`./_mutant-pickswings-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const PS_URL = new URL('../src/pickswings.mjs', import.meta.url)
test('MUTANT: without the reserve test (bare refusal) the rule would rewrite a craft hygiene admits for another reason', async () => {
  await withMutant(PS_URL, '  if (bare == null) return null', '', async M => {
    const stoneOnly = [item('stone_pickaxe', 1, 100, 0), item('stone_pickaxe', 1, 90, 1), item('cobblestone', 64, null, 2), item('oak_log', 8, null, 3)]
    assert.ok(M.swingRewrite({ item: 'iron_pickaxe', items: stoneOnly, y: -20, stoneMakeable: () => true, ironMakeable: () => false, on: true }), 'the tier step is rewritten: the guard was load-bearing')
  })
})
test('MUTANT: without the ingot test a makeable iron craft is rewritten', async () => {
  await withMutant(PS_URL, '  if (ingots >= IRON_PICK_INGOTS) return null', '', async M => {
    assert.ok(M.swingRewrite({ item: 'iron_pickaxe', items: fleetBag([item('iron_ingot', 3, null, 9)]), y: -20, stoneMakeable: () => true, ironMakeable: () => false, on: true }))
  })
})
test('WIRING (structural): admission rewrites args.item from swingRewrite right after the hygiene refusal', () => {
  const s = readFileSync(new URL('../src/admission.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const i = s.indexOf("if (redundant) return { ok: false, reason: 'redundant_craft'"), j = s.indexOf('const swing = swingRewrite('), k = s.indexOf('args.item = swing.to')
  assert.ok(i > 0 && j > i && k > j, `order: hygiene ${i}, rule ${j}, rewrite ${k}`)
})
