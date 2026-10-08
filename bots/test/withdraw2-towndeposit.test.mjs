// withdraw2 x towndeposit (the rebase onto 92bc84f): the two town rules about one bag must not fight.
//
//   1. IRON RETENTION. What withdraw2's iron path just took (3 iron_ingot + 2 sticks) is never banked by the automatic
//      town deposit when it fires right after the pull -- whether the craft failed (the ingots wait in the bag for the
//      next attempt) or succeeded (the new iron pickaxe, and the stone one it replaces, stay).
//   2. THE OTHER DIRECTION. withdraw's room-making is withdraw-01's rule, unchanged (bankable whole stacks, cheapest
//      first, never the recipe's own names): when a full bag must make room it may bank coal or raw_iron, which the town
//      deposit keeps (IRON_LADDER). A one-way move -- the town deposit never withdraws and withdraw2 never takes coal --
//      so the two cannot ping-pong; and the town deposit, first in the loop at >= 34 slots, usually frees the room
//      before withdraw needs to make any. (A surplus-first room order was tried and reverted: it ignored the chest's
//      capacity and could decline a pull the old order completed -- Codex rebase review P1.)
//
// Behaviour only: withdraw_pick runs through the real skill against fakeworld.mjs (the craft substituted, as in
// withdraw2.test.mjs); the town deposit's decision is the REAL townDepositPlan / townDepositOrder the order and the
// skill both use, over the bag the pull left behind.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-wd2td-logs-'))
process.env.BOT_NAME = 'Pick2TdBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-wd2td-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const { clearWithdrawHolds, withdrawHolds } = await import('../src/bankable.mjs')
const { townDepositPlan, townDepositOrder, TD_TRIGGER_SLOTS, IRON_LADDER } = await import('../src/towndeposit.mjs')
const { SKILLS, withdrawIronState } = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const lastRow = () => RECS.filter(r => r.skill?.name === '_withdraw_pick').at(-1)?.skill ?? {}
const pick = bot => SKILLS.withdraw_pick.run({ bot }, {}, new AbortController().signal)
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const town = (bag, stacks) => {
  freshPool(); clearWithdrawHolds(); withdrawIronState.at = -Infinity
  const w = fakeWorld({ bag }); w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, stacks); w.set(6, 64, 2, 'crafting_table')
  w.bot.craftSync = {
    lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => { const c = win.selectedItem; return { answered: true, cursorEmpty: !c, carried: c ? { itemCount: c.count } : null } },
  }
  return w
}
const chestOf = w => w.containers.get('5,64,0').slots.filter(Boolean)
const dirt = n => Array.from({ length: n }, () => stack('dirt', 64))
/** The craft skill, substituted (withdraw2.test.mjs): 'fails' refuses; 'honest' consumes 3 ingots + 2 sticks, adds the pickaxe. */
const realCraft = SKILLS.craft.run
const craftStub = (w, mode) => {
  SKILLS.craft.run = async () => {
    if (mode === 'fails') return { status: 'failed', failClass: 'not_craftable', detail: 'missing ingredients or need a crafting_table nearby' }
    const take = (name, n) => { for (const it of w.bag) { if (!it || it.name !== name || n <= 0) continue; const k = Math.min(n, it.count); it.count -= k; n -= k } for (let i = 0; i < w.bag.length; i++) if (w.bag[i] && w.bag[i].count <= 0) w.bag[i] = null }
    take('iron_ingot', 3); take('stick', 2)
    const i = w.bag.findIndex(x => !x); if (i >= 0) w.bag[i] = tool('iron_pickaxe', 0); else w.bag.push(tool('iron_pickaxe', 0))
    return { status: 'success', produced: 1, requested: 1, verification: 'server', detail: 'crafted 1x iron_pickaxe' }
  }
}
/** The bag as mineflayer's inventory lists it (slots 9..44), for the town deposit's slot-addressed plan. */
const asInventory = w => w.bag.filter(Boolean).map((it, i) => ({ ...it, slot: 9 + i }))
/** The town deposit's order at home with this bag: the REAL trigger, plan and latch. */
const tdOrder = items => townDepositOrder({ now: 1e9, slots: items.length, pos: { x: 6, y: 64, z: 0 }, home: { x: 0, y: 64, z: 0 },
  plan: () => townDepositPlan(items), container: true, state: {} })

// ------------------------------------------------------------------------------------------- iron retention ---
await t('IRON PULL, CRAFT FAILED, THEN THE TOWN DEPOSIT FIRES: the 3 ingots and 2 sticks just taken stay; the surplus is banked', async () => {
  const w = town([tool('stone_pickaxe', 0), stack('raw_copper', 7), stack('coal', 9), ...dirt(30)], [stack('iron_ingot', 5), stack('stick', 10)])
  craftStub(w, 'fails')
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'failed', r.detail)
    assert.equal(count(w.bag, 'iron_ingot'), 3, 'positive control: the pull happened'); assert.equal(count(w.bag, 'stick'), 2)
    assert.equal(withdrawHolds().iron_ingot ?? 0, 0, 'the iron path\'s scoped holds are gone: only the town deposit\'s own keeps protect them now')
    const items = asInventory(w)
    assert.ok(items.length >= TD_TRIGGER_SLOTS, `the bag is at the trigger (${items.length})`)
    const o = tdOrder(items)
    assert.ok(o.order, 'positive control: the town deposit fires right after the pull')
    assert.equal(o.order.skill, 'town_deposit')
    const plan = townDepositPlan(items)
    const names = plan.steps.map(s => s.name)
    assert.ok(names.includes('raw_copper'), `positive control: surplus is banked (${names.join(',')})`)
    for (const kept of ['iron_ingot', 'stick', 'coal', 'stone_pickaxe']) assert.ok(!names.includes(kept), `${kept} is not banked (${names.join(',')})`)
    assert.equal(plan.why.iron_ingot, 'iron_ladder')
    assert.ok(IRON_LADDER.includes('iron_ingot'))
  } finally { SKILLS.craft.run = realCraft }
})

await t('IRON PULL, CRAFTED, THEN THE TOWN DEPOSIT FIRES: the new iron pickaxe and the stone one stay (with the hold and after it)', async () => {
  const w = town([tool('stone_pickaxe', 0), stack('raw_copper', 7), stack('coal', 9), ...dirt(31)], [stack('iron_ingot', 5), stack('stick', 10)])
  craftStub(w, 'honest')
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'success', r.detail)
    assert.equal(lastRow().detail.split(' ')[0], 'outcome=crafted_iron')
    const items = asInventory(w)
    assert.ok(tdOrder(items).order, 'positive control: the town deposit fires')
    for (const holds of [true, false]) {
      if (!holds) clearWithdrawHolds()
      const names = townDepositPlan(items).steps.map(s => s.name)
      assert.ok(names.includes('raw_copper'), 'positive control: surplus is banked')
      assert.ok(!names.includes('iron_pickaxe') && !names.includes('stone_pickaxe'), `no pickaxe is banked (holds ${holds}: ${names.join(',')})`)
    }
  } finally { SKILLS.craft.run = realCraft }
})

// ---------------------------------------------------------------------------------------- the other way ---
await t('ROOM: a 36/36 bag whose only bankable stack is coal still makes room (coal banked, one way) -- the pull is never refused for it', async () => {
  const w = town([tool('stone_pickaxe', 0), stack('stick', 2), stack('coal', 9), ...dirt(33)], [stack('iron_ingot', 5)])
  craftStub(w, 'honest')
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'success', r.detail)
    assert.equal(count(chestOf(w), 'coal'), 9); assert.equal(count(w.bag, 'iron_pickaxe'), 1)
  } finally { SKILLS.craft.run = realCraft }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
