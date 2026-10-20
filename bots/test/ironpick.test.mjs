// IRONPICK-01 (OWNER 2026-10-20 ~03:20Z "add pickaxe to toolkit"): the toolkit also makes an iron pickaxe from the town's iron
// when the bag has no iron pickaxe above the trip line (withdrawpick PREFER_USES = 40) and no usable diamond/netherite one.
// Behaviour only: the pure decisions by worked case; toolFor on REAL 1.21.8 blocks (the worn copy is dug down first); the
// skill end to end against fakeworld.mjs (the server-verified draw, the room for the tools, the town's keep); the REFUSAL
// CHAIN through the REAL CognitiveLoop (withdraw_pick steps aside while the kit would make the pickaxe, and fetches the stone
// copy as before once the kit cannot); the well and the deposit never take the fresh copy; anchored mutants (withMutant).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ironpick-logs-'))
process.env.BOT_NAME = 'PickBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'            // as toolkit.test.mjs: this fake town has no junk well by construction
process.env.SKILL_TIMEOUT_MS = '180000'   // withdraw's clock is the skill timeout; the suite's 300 ms leaves no walk
delete process.env.TOOLKIT_IRONPICK       // the default (on) is what ships
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ironpick-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const K = await import('../src/toolkit.mjs')
const { ironPickNeed, kitNeeds, kitDraw, kitRoomTakes, kitMaxIngots, toolkitOrder, withdrawDefersToKit, ironpickModeDetail, ironpickRow, bestIronPickTag,
        toolkitIronpickMode, TOOLKIT_IRONPICK, IRONPICK_TRIP_USES, KIT, KIT_NAMES, STICK_KEEP, TOWN_IRON_KEEP, TOOLKIT_COOLDOWN_MS } = K
const { PREFER_USES, roomPlan, roomKeep, pickTakes } = await import('../src/withdrawpick.mjs')
const { MIN_TRIP_USES } = await import('../src/oretunnel.mjs')
const { toolFor, FLOOR } = await import('../src/toolfor.mjs')
const { townOrder } = await import('../src/composter.mjs')
const { disposePlan } = await import('../src/well.mjs')
const { wearOutPlan } = await import('../src/hygiene.mjs')
const { depositPlan, clearWithdrawHolds } = await import('../src/bankable.mjs')
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const COG_PATH = new URL('../src/cognitive.mjs', import.meta.url)
const S0 = await import('../src/skills.mjs')
const { SKILLS, pickNeedOf } = S0
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool, total } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const rowsOf = kind => RECS.filter(r => r.skill?.name === kind)
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const slotted = list => list.map((it, i) => ({ ...it, slot: it.slot ?? 9 + i }))
const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }
const usesOf = (bag, name) => bag.filter(it => it?.name === name).map(it => it.maxDurability - (it.durabilityUsed ?? 0)).sort((a, b) => a - b)
const KIT_HELD = () => [T('iron_axe', 200), T('iron_shovel', 200)]

// ------------------------------------------------------------------------------------------------ the pure decisions ---
await t('THE TRIP LINE is withdraw_pick\'s and the ore trip\'s: IRONPICK_TRIP_USES === PREFER_USES === MIN_TRIP_USES', () => {
  assert.equal(IRONPICK_TRIP_USES, PREFER_USES); assert.equal(IRONPICK_TRIP_USES, MIN_TRIP_USES); assert.equal(IRONPICK_TRIP_USES, 40)
})
await t('ironPickNeed: no iron pickaxe above 40 uses and no usable diamond/netherite -> true; at 41 uses, or a usable diamond -> false; off -> false', () => {
  assert.equal(ironPickNeed([]), true, 'no pickaxe')
  assert.equal(ironPickNeed([T('stone_pickaxe', 131), T('wooden_pickaxe', 59)]), true, 'stone and wooden only')
  assert.equal(ironPickNeed([T('iron_pickaxe', 40)]), true, '40 uses: at the trip line')
  assert.equal(ironPickNeed([T('iron_pickaxe', 41)]), false, '41 uses: above it')
  assert.equal(ironPickNeed([T('iron_pickaxe', 30), T('stone_pickaxe', 120)]), true, 'a worn iron copy beside a good stone one: the iron is the need')
  assert.equal(ironPickNeed([T('iron_pickaxe', 30), T('iron_pickaxe', 250)]), false, 'the fresh copy covers it (no second one)')
  assert.equal(ironPickNeed([T('diamond_pickaxe', 30)]), false, 'a usable diamond pickaxe outranks the iron one')
  assert.equal(ironPickNeed([T('diamond_pickaxe', FLOOR)]), true, 'a SPENT diamond pickaxe does not')
  assert.equal(ironPickNeed([T('golden_pickaxe', 32)]), true, 'golden is below iron')
  assert.equal(ironPickNeed([{ name: 'iron_pickaxe', count: 1 }]), false, 'unknown durability counts as full (toolfor)')
  assert.equal(ironPickNeed([], { on: false }), false, 'TOOLKIT_IRONPICK=off')
})
await t('the switch: TOOLKIT_IRONPICK=on|off, default on, an unreadable value reads as on and says so; the mode row names it', () => {
  assert.deepEqual(toolkitIronpickMode({}), { on: true, mode: 'on', note: 'TOOLKIT_IRONPICK unset' })
  assert.equal(toolkitIronpickMode({ TOOLKIT_IRONPICK: 'off' }).on, false); assert.equal(toolkitIronpickMode({ TOOLKIT_IRONPICK: ' OFF ' }).on, false)
  assert.match(toolkitIronpickMode({ TOOLKIT_IRONPICK: 'nah' }).note, /unreadable, using on/)
  assert.equal(TOOLKIT_IRONPICK.on, true, 'this suite runs the shipped default')
  assert.equal(ironpickModeDetail(), 'phase=mode on=1 mode=on trip_uses=40 kit=iron_pickaxe+iron_axe+iron_shovel max_ingots=7 note=TOOLKIT_IRONPICK_unset')
  assert.equal(ironpickModeDetail({ on: false, mode: 'off', note: null }), 'phase=mode on=0 mode=off trip_uses=40 kit=iron_axe+iron_shovel max_ingots=4')
})
await t('kitNeeds / kitDraw: the pickaxe FIRST; 3 ingots + 2 sticks; never the bag\'s own iron; off -> the base kit exactly', () => {
  assert.deepEqual(KIT_NAMES, ['iron_pickaxe', 'iron_axe', 'iron_shovel']); assert.deepEqual({ ...KIT.iron_pickaxe }, { ingots: 3, sticks: 2 })
  assert.deepEqual(kitDraw([]), { needs: ['iron_pickaxe', 'iron_axe', 'iron_shovel'], ingots: 7, sticks: 6 + STICK_KEEP })
  assert.deepEqual(kitDraw([T('iron_pickaxe', 30), ...KIT_HELD(), stack('stick', 1)]), { needs: ['iron_pickaxe'], ingots: 3, sticks: 2 + STICK_KEEP - 1 })
  assert.deepEqual(kitDraw([T('iron_pickaxe', 30), ...KIT_HELD(), stack('iron_ingot', 9), stack('stick', 9)]).ingots, 3, 'the bag\'s 9 are the ladder\'s')
  assert.deepEqual(kitDraw([T('iron_pickaxe', 250), ...KIT_HELD()]), { needs: [], ingots: 0, sticks: 0 })
  assert.deepEqual(kitDraw([T('iron_pickaxe', 30)], { ironpick: false }), { needs: ['iron_axe', 'iron_shovel'], ingots: 4, sticks: 4 + STICK_KEEP })
  assert.deepEqual(kitNeeds([T('iron_pickaxe', 30), ...KIT_HELD()], { ironpick: false }), [])
  assert.equal(kitMaxIngots(), 7); assert.equal(kitMaxIngots(false), 4)
})
await t('kitRoomTakes: the draw AND one slot per tool the crafts make (on); the draw only (off, the base rule)', () => {
  const d = kitDraw([T('stone_pickaxe', 100), stack('stick', 9)])
  assert.deepEqual(kitRoomTakes(d), [{ name: 'iron_ingot', count: 7 }, { tool: true, name: 'iron_pickaxe' }, { tool: true, name: 'iron_axe' }, { tool: true, name: 'iron_shovel' }])
  assert.deepEqual(kitRoomTakes(d, { ironpick: false }), [{ name: 'iron_ingot', count: 7 }])
  // a bag with exactly the draw's one slot free: the draw alone fits, the draw and the tools do not
  const bag = slotted([T('iron_pickaxe', 30), ...KIT_HELD(), stack('stick', 9), ...Array.from({ length: 31 }, () => stack('white_wool', 1))])
  const dd = kitDraw(bag)
  assert.equal(roomPlan(bag, kitRoomTakes(dd, { ironpick: false })).ok, true, 'CONTROL: the base plan says the draw fits')
  assert.equal(roomPlan(bag, kitRoomTakes(dd)).ok, false, 'no room for the pickaxe it would make: no order')
})
const base = { now: 1e9, on: true, atTown: true, items: [T('iron_pickaxe', 30), ...KIT_HELD(), stack('stick', 9)], container: true, townMiss: false,
               room: d => roomPlan(base.items, kitRoomTakes(d)).ok, tableNear: () => true, state: {} }
await t('toolkitOrder: a worn iron pickaxe at town -> the toolkit order (3 ingots); off, a fresh copy, or no room for the tool -> none', () => {
  const r = toolkitOrder(base)
  assert.equal(r.order?.skill, 'toolkit'); assert.match(r.order.why, /no usable iron_pickaxe above 40 uses: the town's iron makes it \(3 ingot\(s\) drawn\)/)
  assert.equal(toolkitOrder({ ...base, ironpick: false }).order, null, 'TOOLKIT_IRONPICK=off: the kit is held, no order')
  assert.equal(toolkitOrder({ ...base, items: [T('iron_pickaxe', 41), ...KIT_HELD()] }).order, null)
  assert.equal(toolkitOrder({ ...base, room: () => false }).order, null)
  assert.equal(toolkitOrder({ ...base, townMiss: () => true }).order, null, 'every container known short of 3 + keep')
})
await t('withdrawDefersToKit: only when withdraw has a pickaxe need AND the kit\'s order would be issued now AND it makes the iron pickaxe', () => {
  const kit = { skill: 'toolkit', args: { credit: 0 } }
  const worn = [T('iron_pickaxe', 30), ...KIT_HELD()]
  assert.equal(withdrawDefersToKit('trippick', kit, worn), true)
  assert.equal(withdrawDefersToKit('pick', kit, [T('iron_pickaxe', 5)]), true, 'no usable pickaxe at all: the kit\'s iron one too')
  assert.equal(withdrawDefersToKit(null, kit, worn), false, 'no withdraw need')
  assert.equal(withdrawDefersToKit('trippick', null, worn), false, 'the kit would not issue (cooldown, backoff, no iron, no room)')
  assert.equal(withdrawDefersToKit('trippick', kit, [T('iron_pickaxe', 250), T('stone_pickaxe', 20)]), false, 'the kit makes no pickaxe for this bag')
  assert.equal(withdrawDefersToKit('trippick', kit, worn, { ironpick: false }), false, 'off: withdraw_pick exactly as before')
})
await t('townOrder: pickDefer true -> no withdraw_pick (nothing charged); false -> withdraw_pick; asked only when the withdraw branch is ready', () => {
  const o = { now: 1e9, slots: 10, freeSlots: 26, junk: 0, distHome: 3, storageNear: true, composterAtTown: true, room: false, pickNeeded: true,
              pickMiss: false, pickRoom: true, ingredientMiss: false, state: {} }
  const deferred = townOrder({ ...o, pickDefer: () => true })
  assert.equal(deferred.order, null); assert.equal(deferred.state.lastWithdrawAt, undefined, 'no cooldown charged')
  assert.equal(townOrder({ ...o, pickDefer: () => false }).order?.skill, 'withdraw_pick')
  assert.equal(townOrder(o).order?.skill, 'withdraw_pick', 'the default: as before')
  let asked = 0
  townOrder({ ...o, pickNeeded: false, pickDefer: () => { asked++; return true } })
  assert.equal(asked, 0, 'no pickaxe need: the kit\'s dry run is never asked')
})
await t('the change row and the best-pickaxe tag stay inside 300 characters and name the gate fields first', () => {
  assert.equal(bestIronPickTag(slotted([T('iron_pickaxe', 30), T('iron_pickaxe', 250), T('stone_pickaxe', 131)])), 'iron_pickaxe@250')
  assert.equal(bestIronPickTag([T('stone_pickaxe', 131)]), '-')
  assert.equal(ironpickRow({ outcome: 'crafted', made: true, bestBefore: 'iron_pickaxe@30', bestAfter: 'iron_pickaxe@250', drew: 3, ironSeen: 20, slots: 12 }),
    'outcome=crafted made=1 best=iron_pickaxe@30->iron_pickaxe@250 drew=3 iron_seen=20 keep=4 slots=12')
})

// ----------------------------------------------------------------------------------------- the worn copy goes by use ---
const require_ = createRequire(import.meta.url)
const mc = require_('minecraft-data')('1.21.8')
const Block = require_('prismarine-block')('1.21.8')
const PItem = require_('prismarine-item')('1.21.8')
const blk = n => Block.fromStateId(mc.blocksByName[n].defaultState, 0)
const real = (n, left = null) => { const i = new PItem(mc.itemsByName[n].id, 1); if (left != null) i.durabilityUsed = i.maxDurability - left; return i }
await t('THE WORN COPY IS DUG DOWN FIRST (toolFor, prismarine-block 1.21.8): iron@30 beside the fresh iron@250 digs iron ore, and at 5 uses still (the keeper)', () => {
  const worn = real('iron_pickaxe', 30), fresh = real('iron_pickaxe', 250)
  assert.equal(toolFor(blk('iron_ore'), [fresh, worn]).item, worn, 'the most-worn copy of the name (tool hygiene)')
  // at or under FLOOR the copy is open only beside a keeper AND the escape reserve's two other pickaxes (hasKeeper): then it
  // digs what needs its tier (gold ore) and is used up, never thrown; with the fresh copy alone it stays reserved (CONTROL)
  const spent = real('iron_pickaxe', 5), stone = real('stone_pickaxe', 90)
  assert.equal(toolFor(blk('gold_ore'), [fresh, stone, spent]).item, spent, 'a spent copy beside a keeper is open: used up, never thrown')
  assert.equal(toolFor(blk('gold_ore'), [fresh, spent]).item, fresh, 'CONTROL: one other pickaxe -- the escape reserve keeps the spent copy back')
  assert.equal(toolFor(blk('stone'), [fresh, worn, real('stone_pickaxe', 90)]).item?.name, 'stone_pickaxe', 'stone is the stone spare\'s, as before')
})
await t('NEVER THE WELL, NEVER WORN OUT WHILE USABLE: disposePlan lists no pickaxe; wearOutPlan lists no usable copy of a full bag', () => {
  const bag = slotted([T('iron_pickaxe', 250), T('iron_pickaxe', 30), T('stone_pickaxe', 90), ...Array.from({ length: 33 }, () => stack('dirt', 64))])
  const p = disposePlan(bag)
  assert.ok(!JSON.stringify(p).includes('iron_pickaxe'), JSON.stringify(p).slice(0, 200))
  assert.ok(wearOutPlan(bag).tools.every(x => x.name !== 'iron_pickaxe'), 'both copies are usable')
  // the deposit's plan banks at most usable - 1 copies of a name (keep one); the transfer goes worst-first (towndeposit.test.mjs)
  const dep = depositPlan(bag).find(e => e.name === 'iron_pickaxe')
  assert.ok(!dep || dep.count <= 1, JSON.stringify(dep))
})

// --------------------------------------------------------------------------------------------- the skill, end to end ---
const town = (bag, stacks, at = undefined) => { freshPool(); clearWithdrawHolds(); const w = fakeWorld({ bag: slotted(bag), ...(at ? { at } : {}) }); w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, stacks); return w }
const withServer = w => {
  w.bot.craftSync = {
    lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => { const c = win.selectedItem; return { answered: true, cursorEmpty: !c, carried: c ? { itemCount: c.count } : null } },
  }
  return w
}
/** A crafter for the fake (it cannot craft): the recipe's ingots and sticks leave the bag, one fresh tool arrives -- and, as the
 *  real craft, a FULL bag cannot take the tool (no slot left after the inputs are used): it fails with nothing made. */
const fakeCraft = (w, { fails = [] } = {}) => async (_ctx, { item }) => {
  if (fails.includes(item)) return { status: 'failed', failClass: 'missing_ingredients', detail: `no ${item} recipe from what is held` }
  const take = (name, n) => { for (const it of w.bag.filter(x => x?.name === name)) { const k = Math.min(n, it.count); it.count -= k; n -= k; if (!it.count) w.bag.splice(w.bag.indexOf(it), 1); if (!n) break } }
  const snap = w.bag.map(it => ({ ...it }))
  take('iron_ingot', KIT[item].ingots); take('stick', KIT[item].sticks)
  if (w.bag.filter(Boolean).length >= 36) { w.bag.splice(0, w.bag.length, ...snap); return { status: 'failed', failClass: 'inventory_full', detail: `no room for ${item}` } }
  w.bag.push({ ...tool(item), slot: 40 + w.bag.length })
  return { status: 'success', detail: `crafted 1 ${item}` }
}
const run = (w, args = {}, ctx = {}) => SKILLS.toolkit.run({ bot: w.bot, ...ctx }, args, new AbortController().signal)
const chestOf = w => w.containers.get('5,64,0').slots.filter(Boolean)
const scene30 = () => withServer(town([T('iron_pickaxe', 30), ...KIT_HELD(), stack('stick', 9), stack('crafting_table', 1)], [stack('iron_ingot', 20), stack('stick', 64)]))

async function wornScene (S = S0) {
  const w = scene30()
  const before = total(w.bag) + total(chestOf(w))
  const n0 = RECS.length
  const r = await S.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, {}, new AbortController().signal)
  assert.equal(r.status, 'success', r.detail); assert.equal(r.kitCrafted, 1)
  assert.deepEqual(usesOf(w.bag, 'iron_pickaxe'), [30, 250], 'a fresh iron pickaxe, and the worn copy still in the bag (never tossed, never moved)')
  assert.equal(count(chestOf(w), 'iron_ingot'), 17, 'the town gave exactly 3')
  assert.equal(count(w.bag, 'iron_ingot'), 0); assert.equal(count(w.bag, 'stick'), 7, '9 - 2: the town\'s sticks not needed')
  assert.equal(total(w.bag) + total(chestOf(w)), before - 3 - 2 + 1, 'conserved: 3 ingots + 2 sticks became one pickaxe')
  assert.equal(w.dropped.length, 0); assert.equal(w.bot.currentWindow, null)
  const kr = RECS.slice(n0).filter(x => x.skill?.name === '_toolkit').at(-1)
  assert.match(kr.skill.detail, /^phase=kit outcome=crafted needs=iron_pickaxe drew=3 sticks=0 used=3 crafted=iron_pickaxe credit=0->0 /, kr.skill.detail)
  const cr = RECS.slice(n0).filter(x => x.skill?.name === '_kit_ironpick')
  assert.equal(cr.length, 1, 'one change row')
  assert.equal(cr[0].skill.detail, `outcome=crafted made=1 best=iron_pickaxe@30->iron_pickaxe@250 drew=3 iron_seen=20 keep=${TOWN_IRON_KEEP} slots=${w.bag.length}`)
  return w
}
await t('SKILL: a 30-use iron pickaxe, a town chest of ingots + sticks -> a fresh iron pickaxe, the chest down 3 ingots, the worn copy kept; one change row', () => wornScene())
await t('SKILL: the town\'s keep -- a container with 3 + TOWN_IRON_KEEP - 1 ingots gives nothing (no_iron, clean); with 3 + KEEP it gives 3', async () => {
  for (const [have, ok] of [[3 + TOWN_IRON_KEEP - 1, false], [3 + TOWN_IRON_KEEP, true]]) {
    const w = withServer(town([T('iron_pickaxe', 30), ...KIT_HELD(), stack('stick', 9), stack('crafting_table', 1)], [stack('iron_ingot', have), stack('stick', 64)]))
    const n0 = RECS.length
    const r = await run(w, {}, { kitCraft: fakeCraft(w) })
    const cr = RECS.slice(n0).filter(x => x.skill?.name === '_kit_ironpick').at(-1)?.skill?.detail ?? ''
    if (ok) {
      assert.equal(r.status, 'success', r.detail); assert.equal(count(chestOf(w), 'iron_ingot'), TOWN_IRON_KEEP, 'the keep stays')
      assert.match(cr, new RegExp(`^outcome=crafted made=1 .* drew=3 iron_seen=${have} keep=${TOWN_IRON_KEEP} `))
    } else {
      assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'kit_no_iron', r.detail)
      assert.equal(count(chestOf(w), 'iron_ingot'), have, 'the town keeps its iron'); assert.equal(count(w.bag, 'iron_ingot'), 0)
      assert.deepEqual(usesOf(w.bag, 'iron_pickaxe'), [30], 'nothing else changed')
      assert.match(cr, /^outcome=no_iron made=0 best=iron_pickaxe@30->iron_pickaxe@30 drew=0 iron_seen=-1 /)
      assert.equal(S0.townKitIronMiss(w.bot), true, 'its only container is now a miss for a 3-ingot draw: the order is ruled out')
    }
  }
})
// THE FULL BAG: 36 slots; the kit is the pickaxe and the shovel (the axe held): 4 ingots in ONE slot, and two tools to land.
// After the pickaxe's craft one ingot is still in its slot, so the pickaxe needs a slot of its own: room for the draw alone
// (1 slot) is not room for the craft. `spare`: three whole stacks the deposit banks (coal, raw copper, copper ingots).
const fullBag = (spare) => [T('iron_pickaxe', 30), T('iron_axe', 200), stack('stick', 9), stack('crafting_table', 1),
  ...(spare ? [stack('raw_copper', 64), stack('copper_ingot', 64), stack('coal', 64)] : []),
  ...Array.from({ length: 36 - 4 - (spare ? 3 : 0) }, () => stack('white_wool', 1))]
const banked = w => ['raw_copper', 'copper_ingot', 'coal'].reduce((n, x) => n + count(chestOf(w), x), 0)
async function fullBagScene (S = S0) {
  const w = withServer(town(fullBag(true), [stack('iron_ingot', 20)]))
  assert.equal(w.bag.length, 36)
  const r = await S.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, {}, new AbortController().signal)
  assert.equal(r.status, 'success', `${r.detail} || ${rowsOf('_toolkit').at(-1)?.skill?.detail}`)
  assert.deepEqual(usesOf(w.bag, 'iron_pickaxe'), [30, 250]); assert.equal(count(w.bag, 'iron_shovel'), 1)
  assert.equal(banked(w), 192, 'room for the ingots AND both tools, made the way the draw always made it: whole stacks the deposit banks, into the chest')
  assert.equal(count(chestOf(w), 'iron_ingot'), 16); assert.equal(w.dropped.length, 0)
}
await t('SKILL, FULL BAG (36/36) with stacks the deposit banks: room is made for the ingots AND the tools, then both are crafted', () => fullBagScene())
await t('SKILL, FULL BAG, the BASE room rule (the draw only; TOOLKIT_IRONPICK=off\'s kitRoomTakes) would leave the pickaxe no slot: CONTROL for the rule above', () => {
  const bag = slotted(fullBag(true))
  const d = kitDraw(bag)
  assert.deepEqual(d.needs, ['iron_pickaxe', 'iron_shovel'])
  const keep = [...roomKeep([]), 'iron_ingot']
  assert.equal(roomPlan(bag, kitRoomTakes(d, { ironpick: false }), { keep }).deposit.length, 1, 'one stack banked: the ingots fit, the tools do not')
  assert.equal(roomPlan(bag, kitRoomTakes(d), { keep }).deposit.length, 3, 'three: the ingots and both tools')
})
await t('SKILL, FULL BAG with nothing bankable: no iron drawn (inventory_full, a remedy named); the order is never issued for it; withdraw_pick is not deferred', async () => {
  const w = withServer(town(fullBag(false), [stack('iron_ingot', 20)]))
  const r = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'inventory_full', r.detail); assert.match(r.detail, /keep working; spent tools and compostable junk are cleared at town/)
  assert.equal(count(chestOf(w), 'iron_ingot'), 20); assert.equal(count(w.bag, 'iron_ingot'), 0); assert.equal(w.bot.kitCredit ?? 0, 0)
  const items = w.bag.filter(Boolean)
  const keep = [...roomKeep([]), 'iron_ingot']
  const o = toolkitOrder({ now: 1e9, atTown: true, items, container: true, townMiss: false, tableNear: () => true, state: {}, room: d => roomPlan(items, kitRoomTakes(d), { keep }).ok })
  assert.equal(o.order, null, 'the order is not issued into a bag that cannot take the tool')
  assert.equal(withdrawDefersToKit(pickNeedOf(items), o.order, items), false, 'so withdraw_pick keeps its own turn (its own room check decides)')
  assert.equal(roomPlan(items, pickTakes(), { keep: roomKeep([]) }).ok, false, 'and it too has no room: the full-bag remedies (deposit, wear-out, well) come first, as before')
})

// ---------------------------------------------------------------------------------- the CHAIN through the real loop ---
const { Lessons } = await import('../src/lessons.mjs')
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-ip-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
/** A bot at town with a WORN iron pickaxe (a 'trippick' need for withdraw_pick) beside a chest holding a 120-use stone pickaxe
 *  and, unless `iron` is 0, iron ingots. The kit's axe and shovel are held, so the only kit need is the pickaxe. */
function chainWorld ({ iron = 20, pick = T('iron_pickaxe', 30) } = {}) {
  freshPool(); clearWithdrawHolds()
  const w = withServer(fakeWorld({ bag: slotted([stack('dirt', 16), stack('oak_log', 64), stack('sand', 8), stack('cobblestone', 64), stack('crafting_table', 1),
    pick, ...KIT_HELD(), stack('stick', 8), stack('furnace', 1)]), at: [6.5, 64, 0.5] }))
  w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, [...(iron ? [stack('iron_ingot', iron)] : []), T('stone_pickaxe', 120), stack('dirt', 3)])
  w.set(2, 64, 3, 'composter')
  Object.assign(w.bot, {
    oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, username: 'PickBot', players: {}, experience: { level: 0 },
    recipesFor: () => [], recipesAll: () => [], clearControlStates: () => {},
  })
  const fb = w.bot.findBlock.bind(w.bot), fbs = w.bot.findBlocks.bind(w.bot)
  w.bot.findBlock = o => (typeof o?.matching === 'function' ? fb(o) : null)
  w.bot.findBlocks = o => (typeof o?.matching === 'function' ? fbs(o) : [])
  return w
}
async function decisions (w, n, { Cog = null, fastScan = false } = {}) {
  const { CognitiveLoop } = Cog ?? await import('../src/cognitive.mjs')
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    if (skill === 'toolkit' || skill === 'withdraw_pick') {
      const r = await SKILLS[skill].run({ bot: w.bot, ...(skill === 'toolkit' ? { kitCraft: fakeCraft(w) } : {}) }, args ?? {}, null)
      ran.push({ skill, status: r.status, failClass: r.failClass })
      // fastScan: the town orders' 30 s world-scan rate limit (composter.mjs TOWN_SCAN_MS) fast-forwarded after a run -- a
      // clock, not a rule under test (the loop runs ~50 ms decisions)
      if (fastScan) loop.townState = { ...(loop.townState ?? {}), lastScanAt: -Infinity }
      return { ...r, delta: { kitCrafted: r.kitCrafted ?? 0 } }
    }
    ran.push({ skill, status: 'success' })
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new CognitiveLoop(w.bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 600 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  assert.ok(ran.length >= n, `only ${ran.length} of ${n} decisions (a stalled loop would pass every negative): ${JSON.stringify(ran)}`)
  return ran
}
async function noDoubleTrip (Cog = null) {
  const w = chainWorld()
  assert.equal(pickNeedOf(w.bag.filter(Boolean)), 'trippick', 'the scene is withdraw_pick\'s: a worn pickaxe at town')
  const ran = await decisions(w, 5, { Cog })
  const kit = ran.findIndex(x => x.skill === 'toolkit')
  assert.ok(kit >= 0 && ran[kit].status === 'success', JSON.stringify(ran))
  assert.equal(ran.filter(x => x.skill === 'withdraw_pick').length, 0, `no withdraw_pick for the same need: ${JSON.stringify(ran)}`)
  assert.equal(chestOf(w).filter(it => it.name === 'stone_pickaxe').length, 1, 'the town\'s stone pickaxe was not fetched')
  assert.deepEqual(usesOf(w.bag, 'iron_pickaxe'), [30, 250]); assert.equal(count(chestOf(w), 'iron_ingot'), 17)
  assert.equal(ran.filter(x => x.skill === 'toolkit').length, 1, 'once made, no second order')
}
await t('CHAIN (real loop): a worn iron pickaxe at town -> the TOOLKIT makes the iron pickaxe; withdraw_pick does not also fetch the stone copy', () => noDoubleTrip())
await t('CHAIN (real loop), THE REFUSAL CHAIN: no iron in town -> one kit run ends no_iron (backed off), then withdraw_pick fetches the stone copy -- no dead end', async () => {
  const w = chainWorld({ iron: 0 })
  const ran = await decisions(w, 5, { fastScan: true })
  const kit = ran.findIndex(x => x.skill === 'toolkit'), wd = ran.findIndex(x => x.skill === 'withdraw_pick')
  assert.ok(kit >= 0 && ran[kit].failClass === 'kit_no_iron', JSON.stringify(ran))
  assert.ok(wd > kit, `withdraw_pick after the kit could not: ${JSON.stringify(ran)}`)
  assert.equal(ran[wd].status, 'success', JSON.stringify(ran))
  assert.deepEqual(usesOf(w.bag, 'stone_pickaxe'), [120], 'the trip pickaxe came from the chest')
  assert.equal(ran.filter(x => x.skill === 'toolkit').length, 1, 'the kit is backed off, not re-issued')
})
await t('CHAIN CONTROL (real loop): a fresh iron pickaxe and the kit held -> neither order (the scene sees both only when due)', async () => {
  const w = chainWorld({ pick: T('iron_pickaxe', 200) })
  const ran = await decisions(w, 3)
  assert.ok(!ran.some(x => x.skill === 'toolkit' || x.skill === 'withdraw_pick'), JSON.stringify(ran))
})

// --------------------------------------------------------------------------------------------- wiring + mutants ---
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
await t('WIRED (structural, comments stripped): the licence row once per spawn; the order\'s room and withdraw_pick\'s deferral read the kit\'s rules', () => {
  const idx = strip(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
  assert.match(idx, /logEvent\(\{ kind: 'toolkit_ironpick_mode', status: 'success', snapshot: snapshot\(bot\), detail: ironpickModeDetail\(\) \}\)/)
  const cog = strip(readFileSync(COG_PATH, 'utf8'))
  assert.match(cog, /room: d => roomPlan\(items, kitRoomTakes\(d\), \{ keep \}\)\.ok,/)
  assert.match(cog, /pickDefer: \(\) => withdrawDefersToKit\(pickNeedOf\(items\), this\.#toolkitOrder\(\{ dry: true \}\), items\),/)
  assert.match(cog, /if \(!dry\) this\.toolkitState = r\.state/)
})
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// KILL_WHY=1 prints each kill's assertion, so a kill can be checked to be for the intended reason
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) { if (process.env.KILL_WHY) console.log(`        kill: ${String(e.message).split("\n")[0].slice(0, 200)}`); return true } throw e } }   // a crash is not a kill
await t('MUTANTS: each removes one part of ironpick-01 and a behaviour test above fails for it', async () => {
  const kills = {}
  // the deferral gone: withdraw_pick fetches the stone copy for the same need (the chain through the mutant loop)
  kills.noDefer = await withMutant(COG_PATH, 'pickDefer: () => withdrawDefersToKit(pickNeedOf(items), this.#toolkitOrder({ dry: true }), items),', 'pickDefer: () => false,',
    Cog => killedBy(() => noDoubleTrip(Cog)))
  // the dry run charges the kit's cooldown: the real order is then never issued after a deferral
  kills.dryCharges = await withMutant(COG_PATH, 'if (!dry) this.toolkitState = r.state', 'this.toolkitState = r.state', Cog => killedBy(() => noDoubleTrip(Cog)))
  // the room for the tools gone at the chest: the draw goes into a bag that cannot take the pickaxe
  kills.noToolRoom = await withMutant(SKILLS_PATH, 'decideTakes(k.takes, inChest, bag, chestEmpty, keep, [...k.takes, ...kitRoomTakes(draw).filter(t => t.tool)])',
    'decideTakes(k.takes, inChest, bag, chestEmpty, keep)', S => killedBy(() => fullBagScene(S)))
  // the change row gone
  kills.noChangeRow = await withMutant(SKILLS_PATH, "    if (st.needs.includes('iron_pickaxe')) {\n      logEvent({ kind: 'kit_ironpick',",
    "    if (false) {\n      logEvent({ kind: 'kit_ironpick',", S => killedBy(() => wornScene(S)))
  // the trip line replaced by FLOOR: a 30-use iron pickaxe is "held" and nothing is made
  kills.floorLine = await withMutant(new URL('../src/toolkit.mjs', import.meta.url),
    "(tier(it.name) === IRON_TIER ? remaining(it) > IRONPICK_TRIP_USES : tier(it.name) > IRON_TIER && usable(it))",
    "(tier(it.name) === IRON_TIER ? remaining(it) > FLOOR : tier(it.name) > IRON_TIER && usable(it))",
    M => killedBy(() => { assert.equal(M.ironPickNeed([T('iron_pickaxe', 30), T('stone_pickaxe', 120)]), true) }))
  const survived = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  console.log(`        mutants killed: ${Object.entries(kills).filter(([, k]) => k).map(([n]) => n).join(', ')}`)
  assert.deepEqual(survived, [], `mutants survived: ${survived.join(', ')}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
