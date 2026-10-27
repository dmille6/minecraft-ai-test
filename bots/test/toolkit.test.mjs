// THE TOOLKIT (toolkit-01: toolkit.mjs, hygiene.mjs wearOutPlan, skills.mjs toolkit, cognitive.mjs #toolkitOrder).
// Behaviour only: the pure decisions by worked case; toolFor on REAL 1.21.8 blocks (prismarine-block) choosing the kit;
// the skill end to end against fakeworld.mjs (withdraw's own visit, the server-verified bag); and the CHAIN through the
// REAL CognitiveLoop -- a ready milestone step first, a failed run backing off with its ingots credited, no loop.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-toolkit-logs-'))
process.env.BOT_NAME = 'KitBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LLM_DECISION_COOLDOWN_MS = '50'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
// plinthfirst-01: plinth-first is OFF here. This suite's fake town has no junk well by construction, and under the policy a
// shared town with no usable well plans a raised one at once (plinth.mjs plinthWant 'plinth_first'; build_plinth precedes the
// rung, as it always has for a no-site town). The well's own suites drive that with it on.
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'   // withdraw's clock is the skill timeout; the suite's 300 ms leaves no walk
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-toolkit-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const K = await import('../src/toolkit.mjs')
const { stoneSpare, spentStoneKept, kitNeeds, kitDraw, kitTakes, toolkitOrder, toolkitOutcome, creditAfter, toolkitRow, toolsTag, ironPickHeld,
        KIT, STICK_KEEP, TOWN_IRON_KEEP, TOOLKIT_COOLDOWN_MS, TOOLKIT_BACKOFF_MS, toolkitMode } = K
const { wearOutPlan, SPENT_PICKAXES_KEPT, HOUSEKEEPING } = await import('../src/hygiene.mjs')
const { craftRoomRemedy } = await import('../src/craftroom.mjs')
const { toolFor, FLOOR } = await import('../src/toolfor.mjs')
const { SKILLS, SKILL_CONTRACTS, classifyOutcome, townKitIronMiss } = await import('../src/skills.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool, total } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const kitRows = () => RECS.filter(r => r.skill?.name === '_toolkit')
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const slotted = list => list.map((it, i) => ({ ...it, slot: it.slot ?? 9 + i }))
const filler = n => Array.from({ length: n }, () => stack('bamboo', 64))
// uses LEFT -> a tool copy
const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }

// ------------------------------------------------------------------------------------------ PART 1: the spent keep ---
await t('stoneSpare: the best USABLE stone copy is the spare; the rule applies only with a usable iron-or-better pickaxe AND that spare', () => {
  const bag = slotted([T('iron_pickaxe', 200), T('stone_pickaxe', 40), T('stone_pickaxe', 90), T('stone_pickaxe', 1), T('stone_pickaxe', 8)])
  const s = stoneSpare(bag)
  assert.equal(s.applies, true); assert.equal(s.spare.durabilityUsed, 131 - 90, 'the most uses')
  assert.deepEqual(s.extra.map(c => 131 - c.durabilityUsed), [40]); assert.deepEqual(s.spent.map(c => 131 - c.durabilityUsed).sort((a, b) => a - b), [1, 8])
  assert.equal(stoneSpare(slotted([T('stone_pickaxe', 90), T('stone_pickaxe', 1)])).applies, false, 'no iron pickaxe: the deployed rule')
  assert.equal(stoneSpare(slotted([T('iron_pickaxe', FLOOR), T('stone_pickaxe', 90)])).applies, false, `an iron pickaxe at ${FLOOR} uses is spent, not a working pickaxe`)
  assert.equal(stoneSpare(slotted([T('iron_pickaxe', FLOOR + 1), T('stone_pickaxe', 90)])).applies, true, `${FLOOR + 1} uses is usable`)
  assert.equal(stoneSpare(slotted([T('iron_pickaxe', 200), T('stone_pickaxe', FLOOR), T('stone_pickaxe', 1)])).applies, false, 'no USABLE stone spare: the spent copies are the second pickaxe')
  assert.equal(ironPickHeld(slotted([T('diamond_pickaxe', 900)])), true, 'diamond is iron-or-better')
  assert.equal(spentStoneKept(bag, 3, true), 0); assert.equal(spentStoneKept(bag, 3, false), 3, 'TOOLKIT=off: the deployed keep')
})

const fullOf = (tools, n = 36) => slotted([...tools, ...filler(n - tools.length)])
await t('wearOutPlan: with iron + a usable stone spare, EVERY 1-use stone copy is listed (toolkit = how many only because of it)', () => {
  const ones = [T('stone_pickaxe', 1), T('stone_pickaxe', 1), T('stone_pickaxe', 1)]
  const bag = fullOf([T('iron_pickaxe', 200), T('stone_pickaxe', 90), ...ones])
  const p = wearOutPlan(bag)
  assert.equal(p.tools.length, 3); assert.ok(p.tools.every(x => x.name === 'stone_pickaxe' && x.maxDurability - x.durabilityUsed === 1))
  assert.equal(p.toolkit, 3)
  // POSITIVE CONTROL: the deployed rule keeps all three (SPENT_PICKAXES_KEPT) -- the same bag with the switch off
  const off = wearOutPlan(bag, { toolkit: false, allowance: false })   // the deployed rule (junkout-01's cap off too)
  assert.equal(off.tools.length, 0); assert.equal(off.toolkit, 0)
  assert.equal(SPENT_PICKAXES_KEPT, 3)
})
await t('wearOutPlan: no iron, no usable spare, or below 34 slots -> exactly the deployed plan', () => {
  const ones = [T('stone_pickaxe', 1), T('stone_pickaxe', 1), T('stone_pickaxe', 1), T('stone_pickaxe', 1)]
  for (const [why, tools] of [['no iron', [T('stone_pickaxe', 90), ...ones]], ['no usable spare', [T('iron_pickaxe', 200), T('stone_pickaxe', 9), ...ones]]]) {
    const bag = fullOf(tools)
    const D = { allowance: false }   // the deployed rule; junkout-01's spares cap is junkout.test.mjs's
    assert.deepEqual(wearOutPlan(bag, D).tools, wearOutPlan(bag, { toolkit: false, ...D }).tools, why)
    assert.equal(wearOutPlan(bag, D).tools.length, 1, `${why}: four 1-use copies, three kept`)
    assert.equal(wearOutPlan(bag, D).toolkit, 0)
  }
  assert.equal(wearOutPlan(fullOf([T('iron_pickaxe', 200), T('stone_pickaxe', 90), ...ones], 33)).tools.length, 0, 'below TRIGGER_SLOTS nothing')
})
await t('wearOutPlan: other tiers keep the deployed three; a phantom 0-use copy is never listed; axes/shovels/hoes first, at most 4', () => {
  const bag = fullOf([T('iron_pickaxe', 200), T('stone_pickaxe', 90), T('stone_pickaxe', 1), T('stone_pickaxe', 0),
    T('wooden_pickaxe', 1), T('wooden_pickaxe', 1), T('wooden_pickaxe', 1), T('wooden_pickaxe', 1), T('stone_axe', 1)])
  const p = wearOutPlan(bag, { allowance: false })   // the deployed three (junkout-01's spares cap: junkout.test.mjs)
  assert.deepEqual(p.tools.map(x => `${x.name}@${x.maxDurability - x.durabilityUsed}`), ['stone_axe@1', 'stone_pickaxe@1', 'wooden_pickaxe@1'],
    'the axe, the stone copy (toolkit), then the 4th wooden copy beyond the three kept')
  assert.equal(p.toolkit, 1, 'the 1-use stone copy would have been one of the three kept')
  assert.ok(!p.tools.some(x => x.maxDurability - x.durabilityUsed === 0), 'the phantom is not real')
})
await t('toolkit count: a stone copy the deployed rule would ALSO have listed is not counted as the toolkit\'s', () => {
  const five = Array.from({ length: 5 }, () => T('stone_pickaxe', 1))
  const p = wearOutPlan(fullOf([T('iron_pickaxe', 200), T('stone_pickaxe', 90), ...five]))
  assert.equal(p.tools.length, 4, 'MAX_PER_ORDER')
  // deployed: copies 4 and 5 go (slice(3)); the toolkit lists copies 1-4 -> 1, 2, 3 are its own
  assert.equal(p.toolkit, 3)
})
await t('COMPOSED with craftroom: a full-bag craft may wear out a spent stone copy of an iron holder -- iron and the spare survive', () => {
  const bag = fullOf([T('iron_pickaxe', 200), T('stone_pickaxe', 90), T('stone_pickaxe', 1)])
  const r = craftRoomRemedy(bag, 'oak_planks')
  assert.equal(r?.why, 'spent'); assert.equal(r.tool.name, 'stone_pickaxe'); assert.equal(r.tool.maxDurability - r.tool.durabilityUsed, 1)
  // CONTROL: without the iron the same 1-use copy is one of the three last-swing keeps
  assert.equal(craftRoomRemedy(fullOf([T('stone_pickaxe', 90), T('stone_pickaxe', 1)]), 'oak_planks'), null)
})

// ------------------------------------------------------------------------------------------ PART 2: the kit ---
await t('kitNeeds / kitDraw: per tool with no USABLE copy; the recipes\' ingots, never the bag\'s own; sticks keep STICK_KEEP', () => {
  // ironpick-01: these cases hold a full iron pickaxe (IP), so the kit is the axe and the shovel; the pickaxe's own need is
  // ironpick.test.mjs's. CONTROL: the empty bag lists the pickaxe first.
  const IP = T('iron_pickaxe', 200)
  assert.deepEqual(kitNeeds([IP]), ['iron_axe', 'iron_shovel'])
  assert.deepEqual(kitNeeds([]), ['iron_pickaxe', 'iron_axe', 'iron_shovel'], 'no pickaxe: the pickaxe first (ironpick-01)')
  assert.deepEqual(kitNeeds([], { ironpick: false }), ['iron_axe', 'iron_shovel'], 'TOOLKIT_IRONPICK=off: the base kit')
  assert.deepEqual(kitNeeds([IP, T('iron_axe', 200)]), ['iron_shovel'])
  assert.deepEqual(kitNeeds([IP, T('iron_axe', FLOOR), T('iron_shovel', FLOOR + 1)]), ['iron_axe'], 'a spent copy is a consumable, not the kit')
  assert.deepEqual(kitDraw([IP, stack('stick', 1), stack('iron_ingot', 9)]), { needs: ['iron_axe', 'iron_shovel'], ingots: 4, sticks: 4 + STICK_KEEP - 1 },
    '9 ingots in the bag are the ladder\'s: the kit still draws 3 + 1')
  assert.deepEqual(kitDraw([IP, T('iron_axe', 200), stack('stick', 10)]), { needs: ['iron_shovel'], ingots: 1, sticks: 0 })
  assert.deepEqual(kitDraw([IP, T('iron_axe', 200), T('iron_shovel', 200)]), { needs: [], ingots: 0, sticks: 0 })
  assert.equal(kitDraw([IP, stack('iron_ingot', 4)], { credit: 4 }).ingots, 0, 'a credited earlier draw is not drawn again')
  assert.equal(kitDraw([IP, stack('iron_ingot', 2)], { credit: 4 }).ingots, 2, 'the credit never exceeds the ingots still in the bag')
  assert.equal(KIT.iron_axe.ingots + KIT.iron_shovel.ingots, 4)
})
await t('kitTakes: ingots from ONE container keeping TOWN_IRON_KEEP, sticks ride along; a container short of iron gives nothing', () => {
  const d = { ingots: 4, sticks: 3 }
  assert.deepEqual(kitTakes([stack('iron_ingot', 8), stack('stick', 64)], d).takes, [{ name: 'iron_ingot', count: 4 }, { name: 'stick', count: 3 }])
  assert.deepEqual(kitTakes([stack('iron_ingot', 7), stack('stick', 64)], d).takes, [], `7 < 4 + ${TOWN_IRON_KEEP}`)
  assert.deepEqual(kitTakes([stack('iron_ingot', 5), stack('iron_ingot', 3)], d).takes, [{ name: 'iron_ingot', count: 4 }], 'stacks summed; no sticks here')
  assert.deepEqual(kitTakes([stack('stick', 1)], { ingots: 0, sticks: 3 }).takes, [{ name: 'stick', count: 1 }], 'what it has, the craft makes the rest')
})
const base = { now: 1e9, on: true, atTown: true, items: [T('iron_pickaxe', 200)], container: true, townMiss: false, room: () => true, tableNear: () => true, state: {} }
await t('toolkitOrder: at town, kit missing, container, iron not ruled out, room -> toolkit; cooldown charged on issue', () => {
  const r = toolkitOrder(base)
  assert.equal(r.order?.skill, 'toolkit'); assert.match(r.order.why, /no usable iron_axe or iron_shovel/)
  assert.deepEqual(r.order.args, { credit: 0 })
  assert.equal(toolkitOrder({ ...base, now: 1e9 + TOOLKIT_COOLDOWN_MS - 1, state: r.state }).order, null, 'cooldown')
  assert.equal(toolkitOrder({ ...base, now: 1e9 + TOOLKIT_COOLDOWN_MS, state: r.state }).order?.skill, 'toolkit')
})
await t('toolkitOrder refuses: off, out of town, kit held, no container, every container a recent iron miss, no room', () => {
  assert.equal(toolkitOrder({ ...base, on: false }).order, null)
  assert.equal(toolkitOrder({ ...base, atTown: false }).order, null, 'never a trip')
  assert.equal(toolkitOrder({ ...base, items: [T('iron_pickaxe', 200), T('iron_axe', 200), T('iron_shovel', 200)] }).order, null)
  assert.equal(toolkitOrder({ ...base, container: () => false }).order, null)
  assert.equal(toolkitOrder({ ...base, townMiss: () => true }).order, null)
  assert.equal(toolkitOrder({ ...base, room: () => false }).order, null)
  // a credited draw needs no iron from town: the miss memory does not block it (the craft is the remedy left)
  const credited = toolkitOrder({ ...base, items: [T('iron_pickaxe', 200), stack('iron_ingot', 4), stack('stick', 9)], credit: 4, townMiss: () => true, room: () => false })
  assert.equal(credited.order?.skill, 'toolkit'); assert.deepEqual(credited.order.args, { credit: 4 })
})
await t('kitMeans: a table near, carried, or 4 planks\' worth of wood; the sticks the rest of the wood makes', () => {
  assert.deepEqual(K.kitMeans([], { tableNear: true }), { tableOk: true, sticksMakeable: 0 })
  assert.deepEqual(K.kitMeans([]), { tableOk: false, sticksMakeable: 0 })
  assert.deepEqual(K.kitMeans([stack('crafting_table', 1), stack('oak_planks', 3)]), { tableOk: true, sticksMakeable: 4 })
  assert.deepEqual(K.kitMeans([stack('oak_log', 1)]), { tableOk: true, sticksMakeable: 0 }, 'one log: the table, nothing left')
  assert.deepEqual(K.kitMeans([stack('oak_log', 2)]), { tableOk: true, sticksMakeable: 8 })
  assert.deepEqual(K.kitMeans([stack('birch_planks', 3)]), { tableOk: false, sticksMakeable: 0 })
})
await t('toolkitOrder refuses with no table in reach and no wood to make one (the craft could not run); a carried table or a log is enough', () => {
  assert.equal(toolkitOrder({ ...base, tableNear: () => false }).order, null)
  assert.equal(toolkitOrder({ ...base, tableNear: () => false, items: [stack('oak_log', 1)] }).order?.skill, 'toolkit')
  assert.equal(toolkitOrder({ ...base, tableNear: () => false, items: [stack('crafting_table', 1)] }).order?.skill, 'toolkit')
})
await t('kitTakes: never iron when the sticks this container lacks cannot be made from the bag (noSticks)', () => {
  const d = { ingots: 4, sticks: 6 }
  assert.equal(kitTakes([stack('iron_ingot', 30)], d, { sticksMakeable: 4 }).noSticks, true)
  assert.deepEqual(kitTakes([stack('iron_ingot', 30)], d, { sticksMakeable: 8 }).takes, [{ name: 'iron_ingot', count: 4 }])
  assert.deepEqual(kitTakes([stack('iron_ingot', 30), stack('stick', 2)], d, { sticksMakeable: 4 }).takes, [{ name: 'iron_ingot', count: 4 }, { name: 'stick', count: 2 }])
})
await t('toolkitOutcome: a failure backs off TOOLKIT_BACKOFF_MS; a success clears it; a runner decline is refunded', () => {
  const s = toolkitOutcome('failed', 1e9, { lastIssuedAt: 1e9 })
  assert.equal(s.backoffUntil, 1e9 + TOOLKIT_BACKOFF_MS)
  assert.equal(toolkitOrder({ ...base, now: 1e9 + TOOLKIT_COOLDOWN_MS + 1, state: s }).order, null, 'backed off past the cooldown')
  assert.equal(toolkitOutcome('success', 1e9, s).backoffUntil, 0)
  assert.equal(toolkitOutcome('no_effect', 1e9, { backoffUntil: 5 }).backoffUntil, 5, 'a skip costs nothing')
  const d = toolkitOutcome('failed', 1e9, { lastIssuedAt: 1e9 }, 'runner_busy')
  assert.equal(d.backoffUntil, undefined); assert.equal(toolkitOrder({ ...base, state: d }).order?.skill, 'toolkit', 'refunded')
})
await t('creditAfter / toolkitRow / mode: the row keeps its gate fields inside 300 characters', () => {
  assert.equal(creditAfter(0, 4, 3, 10), 1); assert.equal(creditAfter(1, 0, 1, 10), 0); assert.equal(creditAfter(0, 4, 0, 2), 2)
  const row = toolkitRow({ needs: ['iron_axe', 'iron_shovel'], drew: 4, sticks: 3, used: 4, crafted: ['iron_axe', 'iron_shovel'], creditIn: 0, creditOut: 0,
                           before: 'x'.repeat(200), after: 'y', outcome: 'crafted' })
  assert.ok(row.length <= 300); assert.match(row, /^phase=kit outcome=crafted needs=iron_axe\+iron_shovel drew=4 sticks=3 used=4 crafted=iron_axe\+iron_shovel credit=0->0 /)
  assert.match(toolkitRow({ phase: 'wear', outcome: 'done', listed: 3, worn: 2 }), /^phase=wear outcome=done listed=3 worn=2 /)
  assert.equal(toolsTag(slotted([T('iron_pickaxe', 9), stack('dirt', 3), T('stone_axe', 100)])), 'iron_pickaxe@9,stone_axe@100')
  assert.deepEqual(toolkitMode({}), { on: true, mode: 'on', note: 'TOOLKIT unset' })
  assert.equal(toolkitMode({ TOOLKIT: 'off' }).on, false); assert.equal(toolkitMode({ TOOLKIT: 'nope' }).on, true)
})
await t('WIRED (registry): toolkit is housekeeping, chatOnly, and its contract evidence is the craft count (never drawn ingots)', () => {
  assert.ok(HOUSEKEEPING.has('toolkit')); assert.equal(SKILLS.toolkit.chatOnly, true)
  assert.deepEqual(SKILL_CONTRACTS.toolkit.expects, ['kit_effect'])
  assert.deepEqual(classifyOutcome('toolkit', 'success', { kitCrafted: 1, inventory: { iron_axe: 1 } }, null).because, ['kit_effect: 1 kit tool(s) crafted'])
  assert.deepEqual(classifyOutcome('toolkit', 'success', { kitCrafted: 0, inventory: { iron_ingot: 4 } }, null).because, [], 'ingots drawn are not a kit')
})

// ------------------------------------------------------------------------------------------ toolFor on REAL blocks ---
const require_ = createRequire(import.meta.url)
const mc = require_('minecraft-data')('1.21.8')
const Block = require_('prismarine-block')('1.21.8')
const PItem = require_('prismarine-item')('1.21.8')
const blk = n => Block.fromStateId(mc.blocksByName[n].defaultState, 0)
const real = (n, left = null) => { const i = new PItem(mc.itemsByName[n].id, 1); if (left != null) i.durabilityUsed = i.maxDurability - left; return i }
await t('toolFor (prismarine-block 1.21.8): the iron axe takes logs, the iron shovel dirt/sand/gravel/grass -- the hand without them', () => {
  const kit = [real('iron_pickaxe', 200), real('stone_pickaxe', 90), real('iron_axe'), real('iron_shovel')]
  for (const n of ['oak_log', 'birch_log', 'spruce_log']) {
    assert.equal(toolFor(blk(n), kit).item?.name, 'iron_axe', n)
    assert.equal(toolFor(blk(n), kit.slice(0, 2)).reason, 'hand', `${n} without the kit: the hand (the pickaxes are no faster)`)
    assert.ok(blk(n).digTime(mc.itemsByName.iron_axe.id, false, false, false) * 5 <= blk(n).digTime(null, false, false, false), `${n}: the axe is >= 5x the hand`)
  }
  for (const n of ['dirt', 'sand', 'gravel', 'grass_block']) {
    assert.equal(toolFor(blk(n), kit).item?.name, 'iron_shovel', n)
    assert.equal(toolFor(blk(n), kit.slice(0, 2)).reason, 'hand', `${n} without the kit`)
  }
  assert.equal(toolFor(blk('stone'), kit).item?.name, 'stone_pickaxe', 'stone is unchanged: the stone spare digs it')
  assert.equal(toolFor(blk('oak_log'), [...kit, real('stone_axe', 50)]).item?.name, 'stone_axe', 'a held stone axe is cheaper and within the cap: used first (toolfor)')
})

// ------------------------------------------------------------------------------------------ the skill, end to end ---
// `at`: where the bot stands (toolkit-03: the kit's draw is the town search, nearest the BOT first, as withdraw_pick's)
const town = (bag, stacks, at = undefined) => { freshPool(); clearWithdrawHolds(); const w = fakeWorld({ bag: slotted(bag), ...(at ? { at } : {}) }); w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, stacks); return w }
const BY_1 = [1.5, 64, 1.5]   // beside the chest at 1,64,0: nearer the bot than 5,64,0
const withServer = w => {
  w.bot.craftSync = {
    lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => { const c = win.selectedItem; return { answered: true, cursorEmpty: !c, carried: c ? { itemCount: c.count } : null } },
  }
  return w
}
/** A crafter for the fake (it cannot craft): the recipe's ingots and sticks leave the bag, one fresh tool arrives. */
const fakeCraft = (w, { fails = [] } = {}) => async (_ctx, { item }) => {
  if (fails.includes(item)) return { status: 'failed', failClass: 'missing_ingredients', detail: `no ${item} recipe from what is held` }
  const take = (name, n) => { for (const it of w.bag.filter(x => x?.name === name)) { const k = Math.min(n, it.count); it.count -= k; n -= k; if (!it.count) w.bag.splice(w.bag.indexOf(it), 1); if (!n) break } }
  take('iron_ingot', KIT[item].ingots); take('stick', KIT[item].sticks)
  w.bag.push({ ...tool(item), slot: 40 })
  return { status: 'success', detail: `crafted 1 ${item}` }
}
const run = (w, args = {}, ctx = {}) => SKILLS.toolkit.run({ bot: w.bot, ...ctx }, args, new AbortController().signal)

await t('SKILL: draws 4 ingots + the short sticks from ONE container (server-verified), crafts axe then shovel; the ladder\'s own iron is untouched', async () => {
  const w = withServer(town([T('iron_pickaxe', 200), stack('iron_ingot', 5), stack('stick', 1), stack('cobblestone', 30)],
                           [stack('iron_ingot', 20), stack('stick', 64), stack('cobblestone', 64)]))
  const before = total(w.bag)
  const r = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r.status, 'success', r.detail); assert.equal(r.kitCrafted, 2); assert.equal(r.kitCredit, 0)
  assert.equal(count(w.bag, 'iron_axe'), 1); assert.equal(count(w.bag, 'iron_shovel'), 1)
  assert.equal(count(w.bag, 'iron_ingot'), 5, 'the bag\'s own 5 ingots are still there: the kit drew its 4')
  assert.equal(count(w.bag, 'stick'), STICK_KEEP, 'the stone-pickaxe recipe\'s two sticks stay')
  const chest = w.containers.get('5,64,0').slots.filter(Boolean)
  assert.equal(count(chest, 'iron_ingot'), 16); assert.equal(count(chest, 'stick'), 64 - 5)
  assert.equal(total(w.bag) + total(chest), before + 20 + 64 + 64 - 8 + 2, 'conserved: 4 ingots + 4 sticks became two tools')
  assert.equal(w.dropped.length, 0); assert.equal(w.bot.currentWindow, null)
  const row = kitRows().at(-1)?.skill?.detail ?? ''
  assert.match(row, /^phase=kit outcome=crafted needs=iron_axe\+iron_shovel drew=4 sticks=5 used=4 crafted=iron_axe\+iron_shovel credit=0->0 /, row)
  assert.match(row, /after=[^ ]*iron_axe@250[^ ]*iron_shovel@250/)
  // THE ARGS (the read's first source: never cut at 300) carry every gate field and both tags whole
  const a = kitRows().at(-1).skill.args
  assert.deepEqual({ phase: a.phase, outcome: a.outcome, drew: a.drew, used: a.used, crafted: a.crafted, credit_out: a.credit_out },
                   { phase: 'kit', outcome: 'crafted', drew: 4, used: 4, crafted: 'iron_axe+iron_shovel', credit_out: 0 })
  assert.equal(a.before, 'iron_pickaxe@200'); assert.match(a.after, /^iron_axe@250,iron_pickaxe@200,iron_shovel@250$/)
  assert.ok(kitRows().at(-1).skill.duration_ms >= 0)
})
await t('SKILL: a container short of iron (< draw + keep) gives nothing, is remembered as a miss, and the town order is then ruled out', async () => {
  const w = withServer(town([T('iron_pickaxe', 200), stack('stick', 9)], [stack('iron_ingot', 7), stack('stick', 64)]))
  const r = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'kit_no_iron', r.detail)
  assert.equal(count(w.bag, 'iron_ingot'), 0); assert.equal(count(w.bag, 'stick'), 9, 'no sticks-only take: iron is the point')
  assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 7, 'the town keeps its iron')
  assert.match(kitRows().at(-1).skill.detail, /^phase=kit outcome=no_iron needs=iron_axe\+iron_shovel drew=0 /)
  assert.equal(townKitIronMiss(w.bot), true, 'its only container is a recent miss: complete coverage')
  // POSITIVE CONTROL: the same town with iron to spare is not a miss
  const w2 = withServer(town([T('iron_pickaxe', 200), stack('stick', 9)], [stack('iron_ingot', 8), stack('stick', 64)]))
  assert.equal(townKitIronMiss(w2.bot), false)
  const r2 = await run(w2, {}, { kitCraft: fakeCraft(w2) })
  assert.equal(r2.status, 'success', r2.detail)
})
await t('SKILL: the craft fails after the draw -> failed kit_craft, the ingots stay in the bag and are CREDITED; the next run draws none', async () => {
  const w = withServer(town([T('iron_pickaxe', 200), stack('stick', 9)], [stack('iron_ingot', 30)]))
  const r = await run(w, {}, { kitCraft: fakeCraft(w, { fails: ['iron_axe', 'iron_shovel'] }) })
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'kit_craft'); assert.equal(r.kitCredit, 4); assert.equal(r.kitCrafted, 0)
  assert.equal(count(w.bag, 'iron_ingot'), 4)
  assert.match(kitRows().at(-1).skill.detail, /outcome=craft_failed .*drew=4 .*used=0 crafted=- credit=0->4 /)
  const opened = w.spy.opened.length
  const r2 = await run(w, { credit: r.kitCredit }, { kitCraft: fakeCraft(w) })
  assert.equal(r2.status, 'success', r2.detail); assert.equal(w.spy.opened.length, opened, 'no chest opened: the credit covers the draw')
  assert.equal(count(w.bag, 'iron_ingot'), 0); assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 26, 'drawn once')
})
await t('SKILL: no sticks in the container and no wood -> no iron drawn (kit_no_sticks, a remedy named); NOT a miss of the town\'s iron', async () => {
  const w = withServer(town([T('iron_pickaxe', 200), stack('crafting_table', 1)], [stack('iron_ingot', 30)]))
  const r = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'kit_no_sticks', r.detail); assert.match(r.detail, /carry 1 log/)
  assert.equal(count(w.bag, 'iron_ingot'), 0)
  // NOT A MISS OF THE IRON: no kit_iron miss is recorded for it (toolkit-03: the holder is held back from THIS bot's search
  // while its bag cannot make sticks, so the gate agrees -- and a log in the bag makes it a candidate again)
  const { readTownMemory, townKey } = await import('../src/chestfull.mjs')
  const mem = readTownMemory(process.env.POOL_STATE_DIR, townKey({ x: 0, y: 64, z: 0 }), null)
  assert.equal(mem?._ingredient_miss?.['5,64,0']?.kit_iron, undefined, 'the iron is there: no miss recorded')
  assert.equal(townKitIronMiss(w.bot), true, 'held back while the bag cannot make sticks')
  w.bag.push({ ...stack('oak_log', 1), slot: 30 })
  assert.equal(townKitIronMiss(w.bot), false, 'a log in the bag: a candidate again')
  // POSITIVE CONTROL: the same bag with one log's worth of planks past the table draws and crafts
  const w2 = withServer(town([T('iron_pickaxe', 200), stack('crafting_table', 1), stack('oak_planks', 4)], [stack('iron_ingot', 30)]))
  const r2 = await run(w2, {}, { kitCraft: fakeCraft(w2) })
  assert.notEqual(r2.failClass, 'kit_no_sticks', r2.detail); assert.equal(count(w2.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 26)
})
await t('SKILL: the first chest unreachable -> the next container gives the kit (Claude r1 P3-1)', async () => {
  const w = withServer(town([T('iron_pickaxe', 200), stack('stick', 9)], [stack('iron_ingot', 30)], BY_1))
  w.set(1, 64, 0, 'chest'); w.stock(1, 64, 0, [stack('iron_ingot', 30)])   // the town search is nearest the BOT first: 1,64,0
  const goto = w.bot.pathfinder.goto
  w.bot.pathfinder.goto = async g => { if (g.x === 1) throw new Error('No path to the goal!'); return goto(g) }
  const r = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 26); assert.equal(count(w.containers.get('1,64,0').slots.filter(Boolean), 'iron_ingot'), 30)
  assert.match(kitRows().at(-1).skill.detail, /tried=\[1,64,0:chest_unreachable;5,64,0:success\]/)
})
// lidclear-01 COMPOSITION: withdraw's visit now clears a lid it may (cobblestone) and returns
// container_blocked for one it may not; the kit's draw moves on to the next container.
await t('SKILL: the first chest\'s lid cannot be cleared (oak_planks: container_blocked) -> the next container gives the kit; CONTROL: no lid -> the first gives it', async () => {
  const w = withServer(town([T('iron_pickaxe', 200), stack('stick', 9)], [stack('iron_ingot', 30)], BY_1))
  w.set(1, 64, 0, 'chest'); w.stock(1, 64, 0, [stack('iron_ingot', 30)]); w.set(1, 65, 0, 'oak_planks')   // nearest the BOT first: 1,64,0
  const r = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.containers.get('1,64,0').slots.filter(Boolean), 'iron_ingot'), 30, 'the blocked chest gave nothing')
  assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 26)
  assert.match(kitRows().at(-1).skill.detail, /tried=\[1,64,0:container_blocked;5,64,0:success\]/)
  const w2 = withServer(town([T('iron_pickaxe', 200), stack('stick', 9)], [stack('iron_ingot', 30)], BY_1))
  w2.set(1, 64, 0, 'chest'); w2.stock(1, 64, 0, [stack('iron_ingot', 30)])
  const r2 = await run(w2, {}, { kitCraft: fakeCraft(w2) })
  assert.equal(r2.status, 'success', r2.detail)
  assert.equal(count(w2.containers.get('1,64,0').slots.filter(Boolean), 'iron_ingot'), 26, 'the scene sees the lid: unlidded, the nearest gives it')
})
// plinth-02 x lidclear-01 COMPOSITION (0fe92258): a chest whose lid cell is a raised well's STAIR (or shell) is never cleared --
// lidrule refuses well cells -- so the kit's draw never digs a plinth step off a lid: container_blocked, the next container.
// CONTROL: the same cobblestone lid with the well elsewhere is dug and the first chest gives the kit (the scene sees the lid).
const lidReady = w => {
  const PICKS = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe'].map(n => w.bot.registry.itemsByName[n].id)
  const blockAt0 = w.bot.blockAt
  w.bot.blockAt = p => { const b = blockAt0(p); if (b?.name === 'cobblestone') b.canHarvest = id => PICKS.includes(id); if (b?.name === 'chest') b.shapes = [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]]; return b }
  w.bot.digTime = () => 750
  w.bot.canDigBlock = () => true
  w.digs = []
  w.bot.dig = async b => { w.digs.push(w.key(b.position.x, b.position.y, b.position.z)); w.set(b.position.x, b.position.y, b.position.z, 'air') }
  return w
}
await t('SKILL x PLINTH STAIR LID: a chest under a plinth STAIR cell is never cleared (container_blocked) -> the next container gives the kit; CONTROL: the well elsewhere -> the lid is dug, the first chest gives it', async () => {
  const mk = stairAt => {
    const w = lidReady(withServer(town([T('iron_pickaxe', 200), T('stone_pickaxe', 90), stack('stick', 9)], [stack('iron_ingot', 30)], BY_1)))
    w.set(1, 64, 0, 'chest'); w.stock(1, 64, 0, [stack('iron_ingot', 30)]); w.set(1, 65, 0, 'cobblestone')   // nearest the BOT first: 1,64,0
    w.bot.wellCellsNow = () => [{ x: 20, y: 70, z: 20, stair: [stairAt] }]
    return w
  }
  const w = mk([1, 65, 0])
  const r = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.nameAt(1, 65, 0), 'cobblestone', 'the plinth step stays'); assert.deepEqual(w.digs, [])
  assert.equal(count(w.containers.get('1,64,0').slots.filter(Boolean), 'iron_ingot'), 30)
  assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 26)
  // the row is cut at 300 here (two tool tags); the search's own counters come before the cut (toolkit-03)
  assert.match(kitRows().at(-1).skill.detail, / visits=2 vfail=1 maxrep=1 left=0 .*tried=\[1,64,0:conta/)
  const w2 = mk([20, 66, 21])
  const r2 = await run(w2, {}, { kitCraft: fakeCraft(w2) })
  assert.equal(r2.status, 'success', r2.detail)
  assert.deepEqual(w2.digs, ['1,65,0'], 'the lid is dug when it is no well cell')
  assert.equal(count(w2.containers.get('1,64,0').slots.filter(Boolean), 'iron_ingot'), 26)
})
// plinth-02's WEAR_OUT GUARD x toolkit PART 1: the copies PART 1 adds to wear_out's list are never worn out on a plinth cell.
// A full bag holding iron + a usable stone spare + three 1-use stone copies, every block around it a raised well's shell
// (andesite, which wearTarget accepts): nothing is dug, the toolkit's wear row says so. CONTROL: no well -> the copies are worn out.
const wearBag = () => [T('iron_pickaxe', 200), T('stone_pickaxe', 90), T('stone_pickaxe', 1), T('stone_pickaxe', 1), T('stone_pickaxe', 1),
  ...Array.from({ length: 31 }, () => stack('dirt', 64))]
const wearBot = ({ wells = [] } = {}) => {
  const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), floored: () => V(x, y, z) })
  const inv = wearBag()
  const dug = []
  const bot = {
    heldItem: null, entity: { position: V(0, 64, 0) }, entities: {}, inventory: { items: () => inv },
    blockAt: p => (!(p.x === 0 && p.z === 0) ? { name: 'andesite', hardness: 1.5, boundingBox: 'block', position: p } : { name: 'air', hardness: 0, boundingBox: 'empty', position: p }),
    canDigBlock: () => true, equip: async x => { bot.heldItem = x },
    dig: async b => { dug.push(b.position); inv.splice(inv.indexOf(bot.heldItem), 1); bot.heldItem = null },
    waitForTicks: async () => {}, pathfinder: { setGoal () {}, stop () {} }, wellCellsNow: () => wells,
  }
  return { bot, dug, inv }
}
await t('WEAR x PLINTH-02: PART 1\'s spent stone copies are never worn out on a plinth cell (nothing dug, the _toolkit wear row outcome=none); CONTROL: no well -> all three worn out, iron + spare kept', async () => {
  assert.equal(wearOutPlan(wearBag()).toolkit, 3, 'the scene is PART 1\'s: three copies listed only because of the toolkit rule')
  const n0 = RECS.length
  const a = wearBot({ wells: [{ x: 1, y: 65, z: 0 }] })
  const r = await SKILLS.wear_out.run({ bot: a.bot }, {}, new AbortController().signal)
  assert.equal(r.status, 'failed', r.detail); assert.equal(a.dug.length, 0); assert.match(r.detail, /well/)
  assert.match(RECS.slice(n0).filter(x => x.skill?.name === '_toolkit').at(-1)?.skill?.detail ?? '', /^phase=wear outcome=none listed=3 worn=0/)
  const b = wearBot()
  const r2 = await SKILLS.wear_out.run({ bot: b.bot }, {}, new AbortController().signal)
  assert.equal(r2.status, 'success', r2.detail); assert.equal(b.dug.length, 3)
  assert.equal(b.inv.filter(it => it.name === 'iron_pickaxe').length, 1); assert.equal(b.inv.filter(it => it.name === 'stone_pickaxe').length, 1)
})
await t('SKILL: holds the kit -> no_effect, no chest opened; a usable iron axe held -> only the shovel is drawn for and made', async () => {
  const w = withServer(town([T('iron_pickaxe', 200), T('iron_axe', 200), T('iron_shovel', 200)], [stack('iron_ingot', 30)]))
  const r = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r.status, 'no_effect'); assert.equal(w.spy.opened.length, 0)
  const w2 = withServer(town([T('iron_pickaxe', 200), T('iron_axe', 200), stack('stick', 9)], [stack('iron_ingot', 30)]))
  const r2 = await run(w2, {}, { kitCraft: fakeCraft(w2) })
  assert.equal(r2.status, 'success', r2.detail); assert.equal(count(w2.bag, 'iron_shovel'), 1); assert.equal(count(w2.bag, 'iron_axe'), 1)
  assert.equal(count(w2.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 29, 'one ingot for the shovel')
})
await t('SKILL: an abort mid-run writes the row (outcome=aborted) and rethrows; nothing dropped', async () => {
  const w = withServer(town([T('iron_pickaxe', 200), stack('stick', 9)], [stack('iron_ingot', 30)]))
  const ac = new AbortController()
  const crafter = async () => { ac.abort(); const e = new Error('aborted'); e.aborted = true; throw e }
  await assert.rejects(SKILLS.toolkit.run({ bot: w.bot, kitCraft: crafter }, {}, ac.signal), e => e?.aborted)
  assert.match(kitRows().at(-1).skill.detail, /^phase=kit outcome=aborted .*drew=4 .*credit=0->4 /)
  assert.equal(w.dropped.length, 0)
  // THE CREDIT SURVIVES THE THROW (Codex r1 P2-1): on the bot, so the retry crafts from it and draws nothing
  assert.equal(w.bot.kitCredit, 4)
  const opened = w.spy.opened.length
  const r2 = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r2.status, 'success', r2.detail); assert.equal(w.spy.opened.length, opened, 'no second draw')
  assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 26); assert.equal(w.bot.kitCredit, 0)
})
await t('SKILL: a craft that makes the tool and THEN throws (an abort in its table retake) is reconciled before the rethrow (Codex r2 P2)', async () => {
  // 4 credited ingots (an earlier run's draw) + 4 ladder ingots in the bag
  const w = withServer(town([T('iron_pickaxe', 200), stack('iron_ingot', 8), stack('stick', 9)], [stack('iron_ingot', 30)]))
  w.bot.kitCredit = 4
  const make = fakeCraft(w)
  const crafter = async (c, a) => { await make(c, a); const e = new Error('aborted: low_health'); e.aborted = true; throw e }
  await assert.rejects(SKILLS.toolkit.run({ bot: w.bot, kitCraft: crafter }, {}, new AbortController().signal), e => e?.aborted)
  assert.equal(count(w.bag, 'iron_axe'), 1); assert.equal(count(w.bag, 'iron_ingot'), 5)
  assert.equal(w.bot.kitCredit, 1, 'the axe spent 3 of the 4 credited: 1 left, never 4')
  assert.match(kitRows().at(-1).skill.detail, /outcome=aborted .*used=3 crafted=iron_axe credit=4->1 /)
  const r2 = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r2.status, 'success', r2.detail); assert.equal(count(w.bag, 'iron_shovel'), 1)
  assert.equal(count(w.bag, 'iron_ingot'), 4, 'the ladder\'s 4 ingots are still there'); assert.equal(w.bot.kitCredit, 0)
  assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 30, 'no town draw at all')
})
await t('SKILL: an abort INSIDE the transfer credits what moved (withdrawState), clamped to the bag; nothing dropped', async () => {
  const w = withServer(town([T('iron_pickaxe', 200), stack('stick', 9)], [stack('iron_ingot', 30)]))
  const ac = new AbortController()
  const click = w.bot.clickWindow.bind(w.bot)
  w.bot.clickWindow = async (...a) => { const r = await click(...a); ac.abort(); return r }   // the first click lands, then the cancel
  await assert.rejects(SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, {}, ac.signal), e => e?.aborted)
  const inBag = count(w.bag, 'iron_ingot')
  assert.equal(w.bot.kitCredit, inBag, `credited ${w.bot.kitCredit}, bag holds ${inBag}`)
  assert.equal(inBag + count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot') + (w.bot.currentWindow?.selectedItem?.count ?? 0), 30, 'iron conserved')
  assert.equal(w.dropped.length, 0)
})
await t('SKILL: a draw that moved LESS iron than asked crafts only what it funded -- never from the ladder\'s own ingots (Codex r1 P2-2)', async () => {
  // the bag already carries 4 ladder ingots; another bot empties the chest's iron between the plan and the clicks
  const w = withServer(town([T('iron_pickaxe', 200), stack('iron_ingot', 4), stack('stick', 1)], [stack('iron_ingot', 20), stack('stick', 64)]))
  // the theft lands AFTER the plan and BEFORE the clicks (transferIn's lockstep): the iron source fails liveSource and is skipped,
  // the sticks move, and the server's bag verifies exactly what moved -- a successful visit that drew no iron
  const chest = w.containers.get('5,64,0')
  w.bot.craftSync.lockstep = fn => { chest.slots = chest.slots.map(x => (x?.name === 'iron_ingot' ? null : x)); return fn() }
  const r = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(count(w.bag, 'iron_axe') + count(w.bag, 'iron_shovel'), 0, `crafted from ladder iron: ${r.detail}`)
  assert.equal(count(w.bag, 'iron_ingot'), 4, 'the ladder\'s 4 ingots untouched')
  assert.equal(r.status, 'failed'); assert.match(kitRows().at(-1).skill.detail, /drew=0 sticks=5 .*crafted=- credit=0->0 town=\S+ cand=\S+ visits=1 vfail=0 maxrep=1 left=0 stop=short_of_drawn_iron_for_iron_axe/, 'a successful visit, no iron drawn, no craft')
  // POSITIVE CONTROL: the same bag and chest with no theft draws 4 and crafts both, the 4 ladder ingots still there
  const w2 = withServer(town([T('iron_pickaxe', 200), stack('iron_ingot', 4), stack('stick', 1)], [stack('iron_ingot', 20), stack('stick', 64)]))
  const r2 = await run(w2, {}, { kitCraft: fakeCraft(w2) })
  assert.equal(r2.status, 'success', r2.detail); assert.equal(count(w2.bag, 'iron_ingot'), 4)
})

// ------------------------------------------------------------------------------------------ the CHAIN: the real loop ---
const { Lessons } = await import('../src/lessons.mjs')
const { CognitiveLoop } = await import('../src/cognitive.mjs')
const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-tk-'))
let lseq = 0
const freshLessons = () => { const L = new Lessons(path.join(ldir, `l${lseq++}.json`)); L.data.avoid = {}; L.data.worked = {}; return L }
/** A bot at town beside a chest of iron, its stone-pickaxe rung craft-ready only when `ready`. */
function chainWorld ({ ready = false, at = [6.5, 64, 0.5] } = {}) {
  freshPool(); clearWithdrawHolds()
  // the towndeposit CHAIN's bag (its stone-pickaxe rung is the active one), not full: no deposit, no wear-out, no well
  const w = withServer(fakeWorld({ bag: slotted([stack('dirt', 16), stack('oak_log', 6), stack('oak_log', 10), stack('sand', 8), stack('cobblestone', 64),
    stack('cobblestone', 20), stack('crafting_table', 1), T('wooden_pickaxe', 50), stack('stick', 8), stack('furnace', 1), stack('raw_copper', 5)]), at }))
  w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, [stack('iron_ingot', 20)])
  w.set(2, 64, 3, 'composter')   // the town has its composter (else build_composter, a town order, comes first)
  Object.assign(w.bot, {
    oxygenLevel: 300, time: { day: 1, age: 1, timeOfDay: 1000 }, game: { dimension: 'overworld' }, username: 'KitBot', players: {}, experience: { level: 0 },
    recipesFor: id => (ready && id === w.bot.registry.itemsByName.stone_pickaxe.id ? [{ delta: [] }] : []), recipesAll: () => [],
    clearControlStates: () => {},
  })
  // the prompt's scan passes block ids, not a predicate: the fake answers those with nothing (the toolkit's sweep passes a predicate)
  const fb = w.bot.findBlock.bind(w.bot), fbs = w.bot.findBlocks.bind(w.bot)
  w.bot.findBlock = o => (typeof o?.matching === 'function' ? fb(o) : null)
  w.bot.findBlocks = o => (typeof o?.matching === 'function' ? fbs(o) : [])
  return w
}
async function decisions (w, n, { crafter = null } = {}) {
  const ran = []
  const runner = { isBusy: () => false, run: async (skill, args) => {
    if (skill === 'toolkit') {
      let r
      // an abort is the runner's to catch (runner.mjs): status aborted, no result fields
      try { r = await SKILLS.toolkit.run({ bot: w.bot, ...(crafter ? { kitCraft: crafter } : {}) }, args ?? {}, null) } catch (e) { if (!e?.aborted) throw e; r = { status: 'aborted' } }
      ran.push({ skill, args, status: r.status, failClass: r.failClass })
      return { ...r, delta: { kitCrafted: r.kitCrafted ?? 0 } }
    }
    ran.push({ skill, args, status: 'success' })
    // the rung's craft really makes its item (the bag is the milestone's evidence), so the rung completes
    if (skill === 'craft' && args?.item) w.bag.push({ ...(/_pickaxe$/.test(args.item) ? tool(args.item) : stack(args.item, 1)), slot: 44 })
    return { status: 'success', detail: 'ok', delta: {}, contractEvidence: [`${skill}: probe 1`] }
  } }
  const loop = new CognitiveLoop(w.bot, runner, freshLessons(), null)
  loop.llm = { decide: async () => ({ schemaValid: true, latencyMs: 1, proposal: { skill: 'status', args: {}, reason: 'probe' } }) }
  loop.milestones.cycle = 540
  loop.start()
  for (let i = 0; i < 600 && ran.length < n; i++) await new Promise(r => setTimeout(r, 30))
  loop.stop()
  assert.ok(ran.length >= n, `only ${ran.length} of ${n} decisions (a stalled loop would pass every negative): ${JSON.stringify(ran)}`)
  return { ran, loop }
}
/** Every order before the toolkit's is another deterministic one (a town order, the well), never the model's. */
const beforeKit = ran => { const i = ran.findIndex(x => x.skill === 'toolkit'); return { i, head: ran.slice(0, Math.max(0, i)).map(x => x.skill) } }
await t('CHAIN (real loop): at town with no kit, the toolkit order comes once the other town orders have had their turn, and makes the kit', async () => {
  const w = chainWorld()
  const { ran } = await decisions(w, 4, { crafter: fakeCraft(w) })
  const { i, head } = beforeKit(ran)
  assert.ok(i >= 0, JSON.stringify(ran)); assert.ok(head.every(sk => HOUSEKEEPING.has(sk)), `only housekeeping before it: ${head}`)
  assert.equal(ran[i].status, 'success', kitRows().at(-1)?.skill?.detail)
  assert.equal(count(w.bag, 'iron_axe'), 1); assert.equal(count(w.bag, 'iron_shovel'), 1)
  assert.equal(ran.filter(x => x.skill === 'toolkit').length, 1, 'the kit is held: no second order')
})
await t('CHAIN (real loop): a READY milestone step is never displaced -- the rung\'s craft goes first, the toolkit only after it', async () => {
  const w = chainWorld({ ready: true })
  const { ran } = await decisions(w, 5, { crafter: fakeCraft(w) })
  assert.deepEqual(ran[0], { skill: 'craft', args: { item: 'stone_pickaxe', count: 1 }, status: 'success' }, JSON.stringify(ran))
  const { i, head } = beforeKit(ran)
  assert.ok(i > 0, JSON.stringify(ran)); assert.ok(head.slice(1).every(sk => HOUSEKEEPING.has(sk)), `${head}`)
})
await t('CHAIN (real loop): a failed craft backs off -- the bot goes on, the ingots are credited, no second draw, no loop', async () => {
  const w = chainWorld()
  // ironpick-01: the chain bot holds a wooden pickaxe only, so its kit is all three tools (3 + 3 + 1 = 7 ingots)
  const { ran, loop } = await decisions(w, 5, { crafter: fakeCraft(w, { fails: ['iron_pickaxe', 'iron_axe', 'iron_shovel'] }) })
  const { i } = beforeKit(ran)
  assert.ok(i >= 0, JSON.stringify(ran)); assert.equal(ran[i].status, 'failed'); assert.equal(ran[i].failClass, 'kit_craft')
  assert.equal(ran.filter(x => x.skill === 'toolkit').length, 1, `one attempt, then the backoff: ${JSON.stringify(ran)}`)
  assert.ok(ran.slice(i + 1).some(x => x.skill === 'status'), 'the model decides again (no dead end)')
  assert.equal(w.bot.kitCredit, 7); assert.equal(count(w.bag, 'iron_ingot'), 7)
  assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 13, 'drawn once')
})
await t('CHAIN (real loop): an ABORTED run keeps its iron credited on the bot; the next loop\'s order crafts from it and draws nothing (Codex r1 P2-1)', async () => {
  const w = chainWorld()
  const aborting = async () => { const e = new Error('aborted: low_health'); e.aborted = true; throw e }
  const { ran } = await decisions(w, 3, { crafter: aborting })
  assert.equal(ran.find(x => x.skill === 'toolkit')?.status, 'aborted', JSON.stringify(ran))
  assert.equal(w.bot.kitCredit, 7); assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 13)
  // a restart of the decision loop (fresh order state; the bot -- and its credit -- the same): the retry
  const opened = w.spy.opened.length
  const again = await decisions(w, 4, { crafter: fakeCraft(w) })
  const kit = again.ran.find(x => x.skill === 'toolkit')
  assert.equal(kit?.status, 'success', JSON.stringify(again.ran)); assert.deepEqual(kit.args, { credit: 7 })
  assert.equal(w.spy.opened.length, opened, 'no chest opened: no second draw')
  assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 13); assert.equal(w.bot.kitCredit, 0)
  assert.equal(count(w.bag, 'iron_axe'), 1); assert.equal(count(w.bag, 'iron_shovel'), 1); assert.equal(count(w.bag, 'iron_pickaxe'), 1)
})
await t('CHAIN CONTROL (real loop): the same bot out of town never gets the toolkit order', async () => {
  const w = chainWorld({ at: [80.5, 64, 0.5] })
  const { ran } = await decisions(w, 2)
  assert.ok(!ran.some(x => x.skill === 'toolkit'), JSON.stringify(ran))
})
// THE TOOLKIT x PLINTH CHAIN (toolkit-01 on plinth-01's f8daab3a = plinth on cobblecap-1000 623e92b9). A no-site town
// (wellsite's junkwell-nosite record) and a bag funded for the raised junk well (84 cobble + a dirt cover: the plinth spends
// what is above STONE_GUARD 64), and no kit. Order of the town orders: build_plinth > town_deposit > count_town > ... >
// toolkit. Expected: the plinth's visit FIRST (stubbed: its own suite), then the toolkit order on a later decision, which
// makes the kit; neither starves the other (the plinth waits out its cooldown). CONTROL: the same town with no no-site
// record: no plinth order, the toolkit still makes the kit (the scene sees the plinth only when it is due).
const plinthDue = w => fs.writeFileSync(path.join(process.env.POOL_STATE_DIR, 'junkwell-nosite-0_64_0.json'),
  JSON.stringify({ at: Date.now() - 60_000, world: w.bot.worldId ?? null, by: 'peer', tally: 'cols:0' }))
await t('TOOLKIT x PLINTH CHAIN (real loop, plinth-02): a funded no-site town and no kit -> build_plinth first, the toolkit after it makes the kit', async () => {
  const w = chainWorld()
  plinthDue(w)
  const P = await import('../src/plinth.mjs')
  assert.ok(P.plinthBudget(w.bot.inventory.items(), P.PLINTH_STEPS_PER_VISIT) >= P.PLINTH_MIN_FUND, 'the bag funds the plinth above STONE_GUARD')
  const { ran } = await decisions(w, 5, { crafter: fakeCraft(w) })
  const ip = ran.findIndex(x => x.skill === 'build_plinth'), { i, head } = beforeKit(ran)
  assert.equal(ip, 0, `the plinth goes first: ${JSON.stringify(ran)}`)
  assert.ok(i > ip, `the toolkit is not starved, and comes after the plinth: ${JSON.stringify(ran)}`)
  assert.ok(head.every(sk => HOUSEKEEPING.has(sk)), `only housekeeping before it: ${head}`)
  assert.equal(ran[i].status, 'success', kitRows().at(-1)?.skill?.detail)
  assert.equal(count(w.bag, 'iron_axe'), 1); assert.equal(count(w.bag, 'iron_shovel'), 1)
  assert.equal(ran.filter(x => x.skill === 'build_plinth').length, 1, `the plinth waits out its cooldown: ${JSON.stringify(ran)}`)
  assert.ok(count(w.bag, 'cobblestone') >= 64, 'the kit draw never touches the stone reserve')
})
await t('TOOLKIT x PLINTH CHAIN, CONTROL: the same town with no no-site record -> no plinth order; the toolkit makes the kit', async () => {
  const w = chainWorld()
  const { ran } = await decisions(w, 4, { crafter: fakeCraft(w) })
  assert.ok(!ran.some(x => x.skill === 'build_plinth'), JSON.stringify(ran))
  const { i } = beforeKit(ran)
  assert.ok(i >= 0 && ran[i].status === 'success', JSON.stringify(ran))
})
// THE TOOLKIT x SMELTJOB CHAIN (830dc36b: smeltjob-01 + plinth-02.1). Both orders sit at the end of the chain; the town smelt job
// runs only with nothing chosen above (its tally counts the kit's decision as `taken`). The chain world's bag carries 5 raw_copper
// and the room the job needs, so BOTH are due: the kit first (a bounded once-per-bot need), smelt_town on a later decision -- not
// starved. CONTROL: the same bot already holding the kit -> no toolkit order, smelt_town is issued (the scene sees the smelt job).
await t('TOOLKIT x SMELTJOB CHAIN (real loop, 830dc36b): kit missing and the smelt job due -> toolkit first, smelt_town on a later decision; CONTROL: kit held -> smelt_town', async () => {
  const w = chainWorld()
  const { ran } = await decisions(w, 5, { crafter: fakeCraft(w) })
  const it = ran.findIndex(x => x.skill === 'toolkit'), is = ran.findIndex(x => x.skill === 'smelt_town')
  assert.ok(it >= 0 && ran[it].status === 'success', JSON.stringify(ran))
  assert.ok(is > it, `the smelt job comes after the kit and is not starved: ${JSON.stringify(ran)}`)
  const w2 = chainWorld()
  w2.bag.push({ ...T('iron_axe', 200), slot: 41 }, { ...T('iron_shovel', 200), slot: 42 }, { ...T('iron_pickaxe', 200), slot: 43 })   // the whole kit (ironpick-01)
  const c = await decisions(w2, 3)
  assert.ok(!c.ran.some(x => x.skill === 'toolkit'), JSON.stringify(c.ran))
  assert.ok(c.ran.some(x => x.skill === 'smelt_town'), `the smelt job is due in this scene: ${JSON.stringify(c.ran)}`)
})
// F1 ON TOWNSEARCH-02 (its diff deletes townContainerKeys): BOTH complete-coverage guards that still use it are alive --
// toolkit's townKitIronMiss (tested above) and smeltjob's townCopperMiss (no smeltjob test drives it through the town scan).
// A town whose only container shows a live copper miss -> true; CONTROL: the same town with no miss -> false.
await t('F1 x SMELTJOB: townCopperMiss sees complete coverage over the town scan (a live copper miss in the only container -> true); CONTROL: no miss -> false', async () => {
  const { townCopperMiss } = await import('../src/skills.mjs')
  const SJ = await import('../src/smeltjob.mjs')
  const CF = await import('../src/chestfull.mjs')
  const w = town([T('iron_pickaxe', 200)], [stack('stick', 4)])
  assert.equal(townCopperMiss(w.bot), false, 'no miss yet')
  CF.updateTownMemory(process.env.POOL_STATE_DIR, CF.townKey({ x: 0, y: 64, z: 0 }), w.bot.worldId ?? null,
    e => CF.noteItemMisses(e, SJ.COPPER_MISS_KEY, SJ.COPPER_MISS_TTL_MS, ['5,64,0']))
  assert.equal(townCopperMiss(w.bot), true, 'every town container a live copper miss')
})
await t('WIRED (structural, comments stripped): the toolkit order is the LAST deterministic order, after the room order and before planting', () => {
  const src = fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const at = src.indexOf('if (!order) order = this.#toolkitOrder()')
  assert.ok(at > 0, 'wired')
  assert.ok(src.indexOf('const r = roomOrder({') < at, 'after the room order')
  assert.ok(at < src.indexOf('order = plantingOrder({'), 'before planting')
  assert.match(src, /if \(admitted\.skill === 'toolkit'\) this\.toolkitState = toolkitOutcome\(/)
  assert.match(src, /credit: bot\.kitCredit \?\? 0,/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
