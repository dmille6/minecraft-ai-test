// THE COBBLE RULE (stonecap; owner 10-04 "bank only when it frees a slot"; docs/reports/cobble-rule-design-2026-10-07.md).
// Behaviour only: the pure choice (bankable.mjs cobbleBankStacks), the one allowance every caller reads (depositPlan,
// bankableExclusion, the slot prediction craftroom and withdraw use), and the real deposit skill moving cobble by slot
// through the fake world's vanilla click rules (test/fakeworld.mjs) -- what lands in the chest and what stays in the bag.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-logs-'))
process.env.BOT_NAME = 'CobbleBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-pool-'))

const B = await import('../src/bankable.mjs')
const { depositFreesSlot, depositTarget } = await import('../src/craftroom.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const it = (name, count, slot) => ({ name, count, slot })
const picks = items => B.cobbleBankStacks(items).map(s => `${s.name}:${s.count}@${s.slot}`).join(',')
const cobbleIn = items => items.filter(Boolean).reduce((n, x) => n + (B.isCobble(x.name) ? x.count : 0), 0)

await t('cobbleBankStacks: whole stacks, smallest first, only while 64 cobble + deepslate stay', () => {
  assert.equal(B.COBBLE_RESERVE, 64)
  assert.equal(picks([it('cobblestone', 64, 9), it('cobblestone', 30, 10)]), 'cobblestone:30@10', '[64, 30] -> the 30, 64 kept')
  assert.equal(picks([it('cobblestone', 64, 9), it('cobblestone', 10, 10)]), 'cobblestone:10@10')
  assert.equal(picks([it('cobblestone', 50, 9)]), '', 'under the reserve: nothing')
  assert.equal(picks([it('cobblestone', 64, 9)]), '', 'exactly the reserve: nothing')
  assert.equal(picks([it('cobblestone', 64, 9), it('cobblestone', 63, 10)]), 'cobblestone:63@10', '127: the 63 goes and leaves exactly 64')
  assert.equal(picks([it('cobblestone', 63, 9), it('cobblestone', 62, 10)]), '', '125: even the smallest would leave 63: nothing')
  assert.equal(picks([it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 64, 11)]), 'cobblestone:64@9', 'creditCap 64 per name per visit')
  assert.equal(picks([it('cobblestone', 40, 9), it('cobbled_deepslate', 40, 10), it('cobbled_deepslate', 64, 11)]),
    'cobblestone:40@9,cobbled_deepslate:40@10', 'the reserve is the two names together')
  assert.equal(picks([it('stone', 640, 9), it('cobblestone', 64, 10)]), '', 'stone is not cobble and never counts for its reserve')
  assert.equal(picks([{ name: 'cobblestone', count: 64 }, { name: 'cobblestone', count: 20 }]), 'cobblestone:20@null', 'no slot: the list index orders ties')
})

await t('ONE ALLOWANCE: depositPlan / bankableExclusion / bankableInventory say exactly those stacks, and name the rule otherwise', () => {
  const bag = [it('cobblestone', 64, 9), it('cobblestone', 30, 10), it('oak_log', 20, 11)]
  assert.deepEqual(B.depositPlan(bag).filter(e => B.isCobble(e.name)), [{ name: 'cobblestone', count: 30 }])
  assert.equal(B.bankableInventory(bag).detail.cobblestone, 30)
  const small = [it('cobblestone', 50, 9), it('oak_log', 20, 11)]
  assert.equal(B.depositPlan(small, 'cobblestone').length, 0)
  assert.equal(B.bankableExclusion(small, 'cobblestone'), 'cobble_reserve')
  assert.match(B.depositNoopReason(small, 'cobblestone'), /\(cobble reserve\)/)
  assert.equal(B.bankableInventory(small).junk, 0, 'reserve cobble is not ballast')
  // a withdraw hold on cobble holds every stack (a partial hold would turn a whole stack into a partial one)
  B.setWithdrawHold('cobblestone', 3, Date.now() + 60_000)
  try { assert.equal(B.bankableExclusion(bag, 'cobblestone'), 'withdraw_hold') } finally { B.clearWithdrawHolds() }
  assert.equal(B.bankableExclusion(bag, 'cobblestone'), null, 'positive control: the hold over, the 30 goes')
})

await t('THE SLOT PREDICTION walks cobble as the transfer does (smallest first): craftroom advice and withdraw room agree', () => {
  const bag = [it('cobblestone', 64, 9), it('cobblestone', 10, 10)]
  const plan = B.depositPlan(bag).filter(e => B.isCobble(e.name))
  assert.equal(depositFreesSlot(bag, plan), true)
  assert.equal(depositTarget(bag, plan, []), 'cobblestone')
  // positive control: a non-cobble name still walks in slot order (unchanged): 2 off the 40 frees nothing
  assert.equal(depositFreesSlot([it('stick', 40, 9), it('stick', 2, 10)], [{ name: 'stick', count: 2 }]), false)
})

await t('NO LOOP: a bag holding only reserve or partial cobble satisfies deposit_surplus (bankable count 0)', () => {
  for (const bag of [[it('cobblestone', 64, 9)], [it('cobblestone', 50, 9), it('cobbled_deepslate', 10, 10)]]) {
    assert.equal(B.bankableInventory(bag).count, 0, JSON.stringify(bag))
  }
})

// a fresh pool per town: the town's container memory (chestfull.mjs) must not carry one test's full chest into the next
const town = bag => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cobble-pool-')); const w = fakeWorld({ bag }); w.set(5, 64, 0, 'chest'); return w }
const run = bot => SKILLS.deposit.run({ bot }, {}, new AbortController().signal)

await t('THE TRANSFER: [64, 30] cobble -> the 30-stack is shift-clicked whole, 64 stay; a _cobble_bank row says so', async () => {
  const w = town([stack('cobblestone', 64), stack('oak_log', 3), stack('cobblestone', 30)])
  const n0 = RECS.length
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(cobbleIn(w.bag), 64, 'the reserve stayed')
  assert.equal(w.bag.filter(x => x?.name === 'cobblestone').length, 1, 'one cobble slot left: a slot was freed')
  const row = RECS.slice(n0).find(x => x.skill?.name === '_cobble_bank')
  assert.ok(row, 'the row'); assert.match(row.skill.detail, /name=cobblestone planned=30 stacks=30 clicked=1 moved=30 kept=64 reserve=64 no_room=0/)
  assert.ok(w.spy.clicks.some(([, , mode]) => mode === 1), 'by slot (shift-click), never chest.deposit')
})

await t('ROOM FIRST: a chest with room for only part of a stack takes NONE of it (a partial would free no slot); the chest-full path follows', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 30)])
  // room for 14 cobble only: 26 full stone stacks and one cobblestone x50 (vanilla would merge 14 and leave 16 in the slot)
  w.stock(5, 64, 0, [stack('cobblestone', 50), ...Array.from({ length: 26 }, () => stack('stone', 64))])
  const r = await run(w.bot)
  assert.equal(cobbleIn(w.bag), 94, 'nothing moved')
  assert.notEqual(r.status, 'success', JSON.stringify(r))
  // positive control: the same bag with one empty container slot banks the 30
  const ok = town([stack('cobblestone', 64), stack('cobblestone', 30)])
  const r2 = await run(ok.bot)
  assert.equal(r2.status, 'success', r2.detail); assert.equal(cobbleIn(ok.bag), 64)
})

await t('UNDER THE RESERVE NOTHING MOVES, and the refusal names the rule (no walk to a chest for it)', async () => {
  const w = town([stack('cobblestone', 50)])
  const r = await SKILLS.deposit.run({ bot: w.bot }, { item: 'cobblestone' }, new AbortController().signal)
  assert.equal(cobbleIn(w.bag), 50)
  assert.match(r.detail ?? '', /cobble reserve|nothing/, JSON.stringify(r))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
