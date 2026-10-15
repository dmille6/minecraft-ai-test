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
  const off = wearOutPlan(bag, { toolkit: false })
  assert.equal(off.tools.length, 0); assert.equal(off.toolkit, 0)
  assert.equal(SPENT_PICKAXES_KEPT, 3)
})
await t('wearOutPlan: no iron, no usable spare, or below 34 slots -> exactly the deployed plan', () => {
  const ones = [T('stone_pickaxe', 1), T('stone_pickaxe', 1), T('stone_pickaxe', 1), T('stone_pickaxe', 1)]
  for (const [why, tools] of [['no iron', [T('stone_pickaxe', 90), ...ones]], ['no usable spare', [T('iron_pickaxe', 200), T('stone_pickaxe', 9), ...ones]]]) {
    const bag = fullOf(tools)
    assert.deepEqual(wearOutPlan(bag).tools, wearOutPlan(bag, { toolkit: false }).tools, why)
    assert.equal(wearOutPlan(bag).tools.length, 1, `${why}: four 1-use copies, three kept`)
    assert.equal(wearOutPlan(bag).toolkit, 0)
  }
  assert.equal(wearOutPlan(fullOf([T('iron_pickaxe', 200), T('stone_pickaxe', 90), ...ones], 33)).tools.length, 0, 'below TRIGGER_SLOTS nothing')
})
await t('wearOutPlan: other tiers keep the deployed three; a phantom 0-use copy is never listed; axes/shovels/hoes first, at most 4', () => {
  const bag = fullOf([T('iron_pickaxe', 200), T('stone_pickaxe', 90), T('stone_pickaxe', 1), T('stone_pickaxe', 0),
    T('wooden_pickaxe', 1), T('wooden_pickaxe', 1), T('wooden_pickaxe', 1), T('wooden_pickaxe', 1), T('stone_axe', 1)])
  const p = wearOutPlan(bag)
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
  assert.deepEqual(kitNeeds([]), ['iron_axe', 'iron_shovel'])
  assert.deepEqual(kitNeeds([T('iron_axe', 200)]), ['iron_shovel'])
  assert.deepEqual(kitNeeds([T('iron_axe', FLOOR), T('iron_shovel', FLOOR + 1)]), ['iron_axe'], 'a spent copy is a consumable, not the kit')
  assert.deepEqual(kitDraw([stack('stick', 1), stack('iron_ingot', 9)]), { needs: ['iron_axe', 'iron_shovel'], ingots: 4, sticks: 4 + STICK_KEEP - 1 },
    '9 ingots in the bag are the ladder\'s: the kit still draws 3 + 1')
  assert.deepEqual(kitDraw([T('iron_axe', 200), stack('stick', 10)]), { needs: ['iron_shovel'], ingots: 1, sticks: 0 })
  assert.deepEqual(kitDraw([T('iron_axe', 200), T('iron_shovel', 200)]), { needs: [], ingots: 0, sticks: 0 })
  assert.equal(kitDraw([stack('iron_ingot', 4)], { credit: 4 }).ingots, 0, 'a credited earlier draw is not drawn again')
  assert.equal(kitDraw([stack('iron_ingot', 2)], { credit: 4 }).ingots, 2, 'the credit never exceeds the ingots still in the bag')
  assert.equal(KIT.iron_axe.ingots + KIT.iron_shovel.ingots, 4)
})
await t('kitTakes: ingots from ONE container keeping TOWN_IRON_KEEP, sticks ride along; a container short of iron gives nothing', () => {
  const d = { ingots: 4, sticks: 3 }
  assert.deepEqual(kitTakes([stack('iron_ingot', 8), stack('stick', 64)], d).takes, [{ name: 'iron_ingot', count: 4 }, { name: 'stick', count: 3 }])
  assert.deepEqual(kitTakes([stack('iron_ingot', 7), stack('stick', 64)], d).takes, [], `7 < 4 + ${TOWN_IRON_KEEP}`)
  assert.deepEqual(kitTakes([stack('iron_ingot', 5), stack('iron_ingot', 3)], d).takes, [{ name: 'iron_ingot', count: 4 }], 'stacks summed; no sticks here')
  assert.deepEqual(kitTakes([stack('stick', 1)], { ingots: 0, sticks: 3 }).takes, [{ name: 'stick', count: 1 }], 'what it has, the craft makes the rest')
})
const base = { now: 1e9, on: true, atTown: true, items: [], container: true, townMiss: false, room: () => true, tableNear: () => true, state: {} }
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
  assert.equal(toolkitOrder({ ...base, items: [T('iron_axe', 200), T('iron_shovel', 200)] }).order, null)
  assert.equal(toolkitOrder({ ...base, container: () => false }).order, null)
  assert.equal(toolkitOrder({ ...base, townMiss: () => true }).order, null)
  assert.equal(toolkitOrder({ ...base, room: () => false }).order, null)
  // a credited draw needs no iron from town: the miss memory does not block it (the craft is the remedy left)
  const credited = toolkitOrder({ ...base, items: [stack('iron_ingot', 4), stack('stick', 9)], credit: 4, townMiss: () => true, room: () => false })
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
const town = (bag, stacks) => { freshPool(); clearWithdrawHolds(); const w = fakeWorld({ bag: slotted(bag) }); w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, stacks); return w }
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
  assert.equal(townKitIronMiss(w.bot), false, 'the iron is there: no miss recorded')
  // POSITIVE CONTROL: the same bag with one log's worth of planks past the table draws and crafts
  const w2 = withServer(town([T('iron_pickaxe', 200), stack('crafting_table', 1), stack('oak_planks', 4)], [stack('iron_ingot', 30)]))
  const r2 = await run(w2, {}, { kitCraft: fakeCraft(w2) })
  assert.notEqual(r2.failClass, 'kit_no_sticks', r2.detail); assert.equal(count(w2.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 26)
})
await t('SKILL: holds the kit -> no_effect, no chest opened; a usable iron axe held -> only the shovel is drawn for and made', async () => {
  const w = withServer(town([T('iron_axe', 200), T('iron_shovel', 200)], [stack('iron_ingot', 30)]))
  const r = await run(w, {}, { kitCraft: fakeCraft(w) })
  assert.equal(r.status, 'no_effect'); assert.equal(w.spy.opened.length, 0)
  const w2 = withServer(town([T('iron_axe', 200), stack('stick', 9)], [stack('iron_ingot', 30)]))
  const r2 = await run(w2, {}, { kitCraft: fakeCraft(w2) })
  assert.equal(r2.status, 'success', r2.detail); assert.equal(count(w2.bag, 'iron_shovel'), 1); assert.equal(count(w2.bag, 'iron_axe'), 1)
  assert.equal(count(w2.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 29, 'one ingot for the shovel')
})
await t('SKILL: an abort mid-run writes the row (outcome=aborted) and rethrows; nothing dropped', async () => {
  const w = withServer(town([T('iron_pickaxe', 200), stack('stick', 9)], [stack('iron_ingot', 30)]))
  const ac = new AbortController()
  const crafter = async () => { ac.abort(); const e = new Error('aborted'); e.aborted = true; throw e }
  await assert.rejects(SKILLS.toolkit.run({ bot: w.bot, kitCraft: crafter }, {}, ac.signal), e => e?.aborted)
  assert.match(kitRows().at(-1).skill.detail, /^phase=kit outcome=aborted .*drew=4 /)
  assert.equal(w.dropped.length, 0)
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
  const w = withServer(fakeWorld({ bag: slotted([stack('dirt', 16), stack('oak_log', 64), stack('oak_log', 64), stack('sand', 8), stack('cobblestone', 64),
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
      const r = await SKILLS.toolkit.run({ bot: w.bot, ...(crafter ? { kitCraft: crafter } : {}) }, args ?? {}, null)
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
  const { ran, loop } = await decisions(w, 5, { crafter: fakeCraft(w, { fails: ['iron_axe', 'iron_shovel'] }) })
  const { i } = beforeKit(ran)
  assert.ok(i >= 0, JSON.stringify(ran)); assert.equal(ran[i].status, 'failed'); assert.equal(ran[i].failClass, 'kit_craft')
  assert.equal(ran.filter(x => x.skill === 'toolkit').length, 1, `one attempt, then the backoff: ${JSON.stringify(ran)}`)
  assert.ok(ran.slice(i + 1).some(x => x.skill === 'status'), 'the model decides again (no dead end)')
  assert.equal(loop.kitCredit, 4); assert.equal(count(w.bag, 'iron_ingot'), 4)
  assert.equal(count(w.containers.get('5,64,0').slots.filter(Boolean), 'iron_ingot'), 16, 'drawn once')
})
await t('CHAIN CONTROL (real loop): the same bot out of town never gets the toolkit order', async () => {
  const w = chainWorld({ at: [80.5, 64, 0.5] })
  const { ran } = await decisions(w, 2)
  assert.ok(!ran.some(x => x.skill === 'toolkit'), JSON.stringify(ran))
})
await t('WIRED (structural, comments stripped): the toolkit order is the LAST deterministic order, after the room order and before planting', () => {
  const src = fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const at = src.indexOf('if (!order) order = this.#toolkitOrder()')
  assert.ok(at > 0, 'wired')
  assert.ok(src.indexOf('const r = roomOrder({') < at, 'after the room order')
  assert.ok(at < src.indexOf('order = plantingOrder({'), 'before planting')
  assert.match(src, /if \(admitted\.skill === 'toolkit'\) \{ this\.toolkitState = toolkitOutcome\(/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
