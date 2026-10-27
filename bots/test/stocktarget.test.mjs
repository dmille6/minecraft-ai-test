// STOCK TARGETS + CHEST PRUNING (stocktarget-01; design docs/reports/stocktargets-design-2026-10-08.md r6). Behaviour
// only: the pure decisions (the plan's caps, the keeps, the valve, the well's at-target stacks, the prune pick and order)
// and the real deposit skill in the fake world -- what lands in the chest, what stays, which rows say so, and that no
// chest is built for an at-target remainder.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-stock-logs-'))
process.env.BOT_NAME = 'StockBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-stock-pool-'))

const B = await import('../src/bankable.mjs')
const TD = await import('../src/towndeposit.mjs')
const W = await import('../src/well.mjs')
const P = await import('../src/prune.mjs')
const CC = await import('../src/cobblecap.mjs')
const ST = await import('../src/stocktarget.mjs')
const { SKILLS, installCobbleCap, cobbleObserve } = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const it = (name, count, slot, extra = {}) => ({ name, count, slot, ...extra })
const view = (lb, complete = true, extra = {}) => ({ lb, complete, reserved: 0, floor: lb, avail: lb, taking: 0, unknown: complete ? [] : ['x'], ...extra })
const withReaders = async (town, well, fn) => {
  B.setStockReaders({ town, well })
  try { return await fn() } finally { B.setStockReaders({ town: null, well: null }) }
}

// ----------------------------------------------------------------------------------------------- the plan's caps
await t('PLAN: at target a bulk name is excluded (town stock target); unknown below target is not counted yet; under target the room caps it -- shared by the group\'s names', async () => {
  const bag = [it('oak_log', 64, 9), it('oak_log', 64, 10), it('oak_log', 30, 11), it('stick', 30, 12)]
  await withReaders(g => (g === 'oak_log' ? view(500) : view(0)), () => true, () => {
    assert.equal(B.bankableExclusion(bag, 'oak_log'), 'town_stock_target')
    assert.equal(B.bankableInventory(bag).detail.stick, 28, 'sticks: today\'s rule (2 kept), room 64')
    assert.match(B.depositNoopReason([it('oak_log', 64, 9), it('oak_log', 64, 10)], 'oak_log'), /\(town stock target\)/)
  })
  await withReaders(g => (g === 'oak_log' ? view(10, false) : view(0)), () => true, () => {
    assert.equal(B.bankableExclusion(bag, 'oak_log'), 'town_stock_unknown', 'an incomplete count below target cannot judge')
  })
  await withReaders(g => (g === 'oak_log' ? view(40) : view(0)), () => true, () => {
    assert.equal(B.bankableInventory(bag).detail.oak_log, 24, 'room under 64 is 24')
  })
  const sand = [it('sand', 40, 9), it('red_sand', 40, 10)]
  await withReaders(() => view(0), () => true, () => {
    assert.equal(B.bankableInventory(sand, { wants: ['sand', 'red_sand'] }).count, 0, 'target 0: never banked, even when wanted')
  })
})
await t('PLAN: NO EXIT, NO STOP -- without a usable well the bulk cap does not bind (today\'s rule), the tool cap does; no reader at all is today\'s rule', async () => {
  const bag = [it('oak_log', 64, 9), it('oak_log', 30, 10)]
  await withReaders(() => view(500), () => false, () => {
    assert.equal(B.bankableExclusion(bag, 'oak_log'), null, 'no well: banked as today')
    const tools = [it('stone_pickaxe', 1, 20, { durabilityUsed: 0, maxDurability: 131 }), it('stone_pickaxe', 1, 21, { durabilityUsed: 10, maxDurability: 131 })]
    assert.equal(B.bankableExclusion(tools, 'stone_pickaxe'), 'town_stock_target', 'a capped tool stays capped (tools never go to the well)')
  })
  assert.equal(B.bankableExclusion(bag, 'oak_log'), null, 'positive control: no reader')
})
await t('PLAN: the same keeps on every path -- the ordinary deposit keeps townKeeps\' stockpile wood (planks count a quarter) for a targeted name', async () => {
  const bag = [it('oak_planks', 64, 9), it('oak_planks', 64, 10), it('oak_planks', 64, 11), it('oak_planks', 64, 12)]
  await withReaders(() => view(0), () => true, () => {
    const credited = B.bankableInventory(bag, { wants: ['oak_planks'] }).detail.oak_planks ?? 0
    const left = 256 - credited
    assert.ok(Math.floor(left / 4) >= 64 || left >= TD.townKeeps({ oak_planks: 256 }).keep.oak_planks, `the wood rung's 64 units stay: ${left} planks left`)
  })
})
await t('PLAN: a capped tool -- spare usable copies only up to the town\'s room in usable copies; spent copies never move', async () => {
  const sp = (used, slot) => it('stone_pickaxe', 1, slot, { durabilityUsed: used, maxDurability: 131 })
  const bag = [sp(0, 20), sp(10, 21), sp(20, 22), sp(125, 23)]
  await withReaders(g => (g === 'stone_pickaxe' ? view(15) : view(0)), () => true, () => {
    assert.equal(B.bankableInventory(bag).detail.stone_pickaxe, 1, 'room 1 under 16')
  })
  await withReaders(g => (g === 'stone_pickaxe' ? view(0) : view(0)), () => true, () => {
    assert.equal(B.bankableInventory(bag).detail.stone_pickaxe, 2, 'today\'s rule: the best stays, the spent one never moves')
  })
})

// ----------------------------------------------------------------------------------------------- the valve
await t('VALVE: with the proof, ONE copy today\'s rule would bank goes above target (two copies suffice); without it, none', async () => {
  const sp = (used, slot) => it('stone_pickaxe', 1, slot, { durabilityUsed: used, maxDurability: 131 })
  const bag = [sp(0, 20), sp(30, 21), ...Array.from({ length: 34 }, (_, i) => it('apple', 1, i + 22))]
  await withReaders(g => (g === 'stone_pickaxe' ? view(16) : view(0)), () => true, () => {
    assert.equal(TD.townDepositPlan(bag).steps.length, 0, 'at target: nothing')
    const v = TD.townDepositPlan(bag, { valve: true })
    assert.equal(v.steps.length, 1); assert.equal(v.steps[0].valve, true); assert.equal(v.steps[0].slot, 21, 'the best copy (slot 20) stays')
  })
})
await t('ORDER: the town deposit\'s COUNT step fires only when nothing is bankable, a count is needed and a container is in reach', () => {
  const home = { x: 0, y: 64, z: 0 }, pos = { x: 1, y: 64, z: 1 }
  const base = { now: 1e9, slots: 35, pos, home, plan: { freed: 0, steps: [] }, container: true }
  assert.equal(TD.townDepositOrder({ ...base, count: true }).order?.args?.recount, true)
  assert.equal(TD.townDepositOrder({ ...base, count: false }).order, null, 'positive control: no count needed, no order')
  assert.equal(TD.townDepositOrder({ ...base, count: true, container: false }).order, null)
  assert.equal(TD.townDepositOrder({ ...base, count: true, slots: 20 }).order, null, 'only at a full bag')
})

// ----------------------------------------------------------------------------------------------- the well
await t('WELL: at-target surplus goes whole, smallest first, keeping the keeps and 64 pillar blocks; never a protected kind, a tool, a held name, or cobble', () => {
  const bag = [it('oak_log', 64, 9), it('oak_log', 64, 10), it('oak_log', 20, 11), it('dirt', 64, 12), it('dirt', 10, 13), it('stone_pickaxe', 1, 14, { durabilityUsed: 0, maxDurability: 131 }),
    it('cobblestone', 64, 15), it('cobblestone', 64, 16)]
  const keeps = TD.townKeeps({ oak_log: 148, dirt: 74, cobblestone: 128 }).keep
  const out = W.stockWellStacks(bag, { groups: ['oak_log', 'dirt', 'cobble', 'stone_pickaxe'], keeps })
  const s = out.map(x => `${x.name}:${x.count}@${x.slot}`).join(',')
  assert.ok(!/stone_pickaxe|cobblestone/.test(s), s)
  const oakLeft = 148 - out.filter(x => x.name === 'oak_log').reduce((a, x) => a + x.count, 0)
  assert.ok(oakLeft >= keeps.oak_log, `the wood keep (${keeps.oak_log}) stays: ${oakLeft}`)
  assert.ok(W.pillarCount(bag) - out.reduce((a, x) => a + x.count, 0) >= W.STOCK_SCAFFOLD_MIN, 'the 64 pillar blocks stay')
  assert.equal(W.stockWellStacks(bag, { groups: ['oak_log'], keeps, holds: { oak_log: 5 } }).length, 0, 'a withdraw hold keeps the name')
  assert.ok(!W.stockWellStacks(bag, { groups: ['cobble'], keeps: { cobblestone: 0 } }).some(x => x.name === 'cobblestone'), 'cobble is never the stock path\'s (stonecap\'s own path, at its cap)')
  // THE PILLAR FLOOR binds on its own (keeps given as none): of two gravel stacks and 20 dirt, one stack may go, not both
  const pg = W.stockWellStacks([it('gravel', 64, 1), it('gravel', 64, 2), it('dirt', 20, 3)], { groups: ['gravel', 'dirt'], keeps: {} })
  assert.equal(pg.filter(x => x.name === 'gravel').length, 1, `the 64 pillar blocks stay: ${JSON.stringify(pg)}`)
  const plan = W.disposePlan(bag, { stock: { groups: ['oak_log', 'dirt'], keeps } })
  assert.ok(plan.stacks.some(x => x.stock === 'oak_log'), 'disposePlan carries them, tagged with the group')
  assert.equal(W.disposePlan(bag).stacks.filter(x => x.stock).length, 0, 'positive control: no stock option, no stock stack')
})

// ----------------------------------------------------------------------------------------------- pruning
await t('PRUNE PICK: a fresh v2 count with full stacks of a group the town can spare; never a tool; never below target; bounded by free slots', () => {
  const now = 1e12
  const obs = { a: { n: 0, at: now - 1000, v: 2, m: { oak_log: 640, stone_pickaxe: 40 } }, b: { n: CC.TOWN_COBBLE_CAP, at: now - 1000, v: 2, m: { cobble: CC.TOWN_COBBLE_CAP } }, c: { n: 0, at: now - CC.FLOOR_TTL_MS - 1, v: 2, m: { stick: 6400 } } }
  const p = P.prunePick({ obs, keys: ['a', 'b', 'c'], avail: { oak_log: 640, cobble: CC.TOWN_COBBLE_CAP, stick: 6400 }, free: 10, now })
  assert.equal(p.k, 'a'); assert.deepEqual(p.takes, [{ group: 'oak_log', stacks: 4 }], 'max 4; cobble at exactly its cap has no spare; a stale count is not used')
  // cobblecap-1000: the cobble prune is keyed off the town cap (1000), never 256 -- a whole stack spare only past it
  const cob = n => P.prunePick({ obs: { b: { n, at: now - 1000, v: 2, m: { cobble: n } } }, keys: ['b'], avail: { cobble: n }, free: 10, now })
  assert.equal(cob(1063), null, '1000 + 63: no whole stack spare'); assert.equal(cob(384), null, 'the old 256 + 128 is below the cap now')
  assert.deepEqual(cob(1064)?.takes, [{ group: 'cobble', stacks: 1 }], 'positive control: 1000 + 64 spares one stack')
  assert.equal(P.prunePick({ obs, keys: ['a'], avail: { oak_log: 128 }, free: 10, now }).stacks, 1, '128 - 64 = target: one stack')
  assert.equal(P.prunePick({ obs, keys: ['a'], avail: { oak_log: 127 }, free: 10, now }), null, 'one stack would go below target')
  assert.equal(P.prunePick({ obs, keys: ['a'], avail: { oak_log: 640 }, free: 1, now }), null, 'the bag keeps one empty slot')
  assert.equal(P.prunePick({ obs, keys: ['c'], avail: { stick: 6400 }, free: 10, now }), null, 'a count older than the floor\'s hour is never a prune\'s')
  // the well's JUNK LIST (pseudo-group junk, target 0): any stacks, partial too, never a targeted name
  const pj = P.prunePick({ obs: { j: { n: 0, at: now - 10, v: 2, m: { junk: 20 } } }, keys: ['j'], avail: {}, free: 5, now })
  assert.deepEqual(pj?.takes, [{ group: 'junk', stacks: 1 }])
  assert.deepEqual(P.pruneTakes([it('egg', 16, 0), it('oak_log', 64, 1), it('flint', 5, 2)], [{ group: 'junk', stacks: 2 }], { isJunk: n => ['egg', 'flint'].includes(n) }).map(x => `${x.name}:${x.count}`), ['egg:16', 'flint:5'])
  assert.deepEqual(P.pruneTakes([it('oak_log', 64, 0), it('oak_log', 30, 1), it('oak_log', 64, 2)], [{ group: 'oak_log', stacks: 4 }]).map(x => x.count), [64, 64], 'full stacks only')
})
await t('PRUNE ORDER: at town, a usable well, room and a pick -> prune_town; the cooldown is charged for the look', () => {
  const s0 = { now: 1e9, atTown: true, freeSlots: 5, wellUsable: true, pick: { k: 'a', takes: [{ group: 'oak_log', stacks: 2 }], stacks: 2 } }
  const r = P.pruneOrder(s0)
  assert.equal(r.order?.skill, 'prune_town')
  assert.equal(P.pruneOrder({ ...s0, state: r.state }).order, null, 'cooldown')
  assert.equal(P.pruneOrder({ ...s0, wellUsable: false }).order, null, 'no well, no prune')
  assert.equal(P.pruneOrder({ ...s0, atTown: false }).order, null)
  assert.equal(P.pruneOrder({ ...s0, pick: null }).order, null)
  assert.ok(P.pruneOutcome('failed', 5, {}).backoffUntil > 5)
})

// ----------------------------------------------------------------------------------------------- the deposit skill
const town = bag => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-stock-pool-')); const w = fakeWorld({ bag }); w.set(5, 64, 0, 'chest'); return w }
const run = bot => SKILLS.deposit.run({ bot }, {}, new AbortController().signal)
const capped = async (w, fn) => { installCobbleCap(w.bot); B.setStockWellProbe(() => true); try { return await fn() } finally { B.setStockReaders({ town: null, well: null }) } }
const logsIn = items => items.filter(Boolean).reduce((n, x) => n + (x.name === 'oak_log' ? x.count : 0), 0)

await t('DEPOSIT: a town whose counted chest holds 500 oak logs -> no log moves; a _stock_bank-free refusal names the target; nothing is built', async () => {
  const w = town([stack('oak_log', 64), stack('oak_log', 64), stack('oak_log', 64), stack('chest', 1)])
  w.stock(5, 64, 0, Array.from({ length: 8 }, () => stack('oak_log', 64)))
  await capped(w, async () => {
    const n0 = RECS.length
    const r = await run(w.bot)
    assert.equal(logsIn(w.bag), 192, JSON.stringify(r)); assert.notEqual(r.status, 'success')
    assert.equal(w.spy.placed.length, 0, 'no chest placed')
    // THE REFUSAL IS A ROW (stonecap-01 INCONCLUSIVE 10-12)
    const rf = RECS.slice(n0).filter(x => x.skill?.name === '_stock_refused').map(x => x.skill.detail)
    assert.ok(rf.some(d => /^via=deposit n=\d+ cobble=0 stock=\d+ .*oak_log:192:stock_(target|unknown)/.test(d)), `a refusal row names the logs: ${rf.join(' | ')}`)
  })
})
await t('DEPOSIT: a counted, complete town under target -> the room under 64 goes under ONE confirmed claim, released by the post-transfer count; a _stock_bank row', async () => {
  const w = town([stack('oak_log', 64), stack('oak_log', 64), stack('oak_log', 30)])
  w.stock(5, 64, 0, [stack('oak_log', 20)])
  await capped(w, async () => {
    const n0 = RECS.length
    const r = await run(w.bot)
    assert.equal(r.status, 'success', r.detail)
    const banked = 158 - logsIn(w.bag)
    assert.ok(banked > 0 && banked <= 44, `banked ${banked}, room 44`)
    const row = RECS.slice(n0).find(x => x.skill?.name === '_stock_bank')
    assert.match(row?.skill?.detail ?? '', /^group=oak_log name=oak_log planned=\d+ moved=\d+ .*target=64 decision=bank .*claims=1 refused=0/)
    const st = CC.readTown(process.env.POOL_STATE_DIR, fs.readdirSync(process.env.POOL_STATE_DIR).find(f => f.endsWith('.cobble.jsonl')).replace('.cobble.jsonl', ''))
    assert.equal(Object.values(st.claims).filter(c => c.state === 'live').length, 0, 'the claim was released')
  })
})
await t('AN OVER-CAP TOWN IS NOT SILENT (stonecap-01 INCONCLUSIVE 10-12): a counted chest of 1,728 cobble, a bag of surplus cobble and logs under target -> the logs go, the cobble stays, and a _stock_refused row names the cobble cap; under the cap (positive control) no cobble refusal', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 30), stack('oak_log', 64), stack('oak_log', 64)])
  w.bot.currentWants = ['oak_log']
  w.fill(5, 64, 0, 'cobblestone', 64)
  w.set(7, 64, 0, 'chest')
  await capped(w, async () => {
    await cobbleObserve(w.bot, { x: 5, y: 64, z: 0 }, await w.bot.openContainer(w.bot.blockAt({ x: 5, y: 64, z: 0 })))
    await cobbleObserve(w.bot, { x: 7, y: 64, z: 0 }, await w.bot.openContainer(w.bot.blockAt({ x: 7, y: 64, z: 0 })))
    const n0 = RECS.length
    const r = await run(w.bot)
    const cob = w.bag.filter(Boolean).reduce((n, x) => n + (x.name === 'cobblestone' ? x.count : 0), 0)
    assert.equal(cob, 158, `no cobble banked: ${r.detail}`)
    assert.ok(logsIn(w.bag) < 128, `the logs went: ${r.detail}`)
    const rf = RECS.slice(n0).filter(x => x.skill?.name === '_stock_refused').map(x => x.skill.detail)
    assert.ok(rf.some(d => /^via=deposit n=\d+ cobble=1 .*cobblestone:158:cobble_cap/.test(d)), `the cap's refusal is a row: ${rf.join(' | ')}`)
  })
  const u = town([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 30)])
  await capped(u, async () => {
    await cobbleObserve(u.bot, { x: 5, y: 64, z: 0 }, await u.bot.openContainer(u.bot.blockAt({ x: 5, y: 64, z: 0 })))
    const n0 = RECS.length
    await run(u.bot)
    assert.equal(RECS.slice(n0).filter(x => x.skill?.name === '_stock_refused' && /cobble_cap/.test(x.skill.detail)).length, 0, 'an empty town: no cap refusal')
  })
})
await t('THE ADMISSION REFUSAL IS A ROW (fold-r1 P2, both engines): a bag of capped cobble only, at a town counted at 1,728 -> admission refuses the deposit before any skill runs AND writes one _stock_refused row via=admission naming the cap; a second ask inside a minute writes none (throttled)', async () => {
  const { AdmissionControl } = await import('../src/admission.mjs')
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 30)])
  w.fill(5, 64, 0, 'cobblestone', 64)
  await capped(w, async () => {
    await cobbleObserve(w.bot, { x: 5, y: 64, z: 0 }, await w.bot.openContainer(w.bot.blockAt({ x: 5, y: 64, z: 0 })))
    const n0 = RECS.length
    const adm = new AdmissionControl()
    const a1 = adm.check({ skill: 'deposit', args: {} }, w.bot)
    assert.equal(a1.ok, false); assert.equal(a1.reason, 'deposit_nothing_to_bank', JSON.stringify(a1))
    const rows = () => RECS.slice(n0).filter(x => x.skill?.name === '_stock_refused').map(x => x.skill.detail)
    assert.equal(rows().length, 1, rows().join(' | '))
    assert.match(rows()[0], /^via=admission n=1 cobble=1 stock=0 at_cobble=1 at_stock=0 cobblestone:158:cobble_cap/)
    adm.check({ skill: 'deposit', args: {} }, w.bot)
    assert.equal(rows().length, 1, 'throttled: one row per refused set per minute')
  })
})
await t('NO CHEST AT TARGET: a full chest, an at-target remainder and a chest in the bag -> no recovery chest; an untargeted remainder (positive control) does go to the recovery', async () => {
  const w = town([stack('oak_log', 64), stack('oak_log', 64), stack('chest', 1)])
  w.fill(5, 64, 0, 'oak_log', 64)
  await capped(w, async () => {
    const n0 = RECS.length
    const r = await run(w.bot)
    assert.equal(w.spy.placed.length, 0, `no chest: ${JSON.stringify(r)}`)
    assert.equal(RECS.slice(n0).filter(x => x.skill?.name === '_deposit_new_chest' && /decision=(place|craft)/.test(x.skill.detail)).length, 0)
  })
  const o = town([stack('iron_ingot', 30), stack('chest', 1)])
  o.fill(5, 64, 0, 'oak_log', 64)
  await capped(o, async () => {
    const n0 = RECS.length
    await run(o.bot)
    const rec = RECS.slice(n0).filter(x => x.skill?.name === '_stock_recovery')
    assert.ok(rec.length >= 1 && rec.every(x => /untargeted=1/.test(x.skill.detail)), `the recovery qualifies on the ingots: ${rec.map(x => x.skill.detail).join(' | ')}`)
  })
})

await t('RECOVERY QUALIFIES (design 3.3) -- directly: an at-target remainder never qualifies; an untargeted item does; a targeted one under target does', async () => {
  const SK = await import('../src/skills.mjs')
  const w = town([stack('oak_log', 64), stack('oak_log', 64)])
  w.stock(5, 64, 0, Array.from({ length: 8 }, () => stack('oak_log', 64)))
  await capped(w, async () => {
    await cobbleObserve(w.bot, { x: 5, y: 64, z: 0 }, await w.bot.openContainer(w.bot.blockAt({ x: 5, y: 64, z: 0 })))
    assert.equal(SK.stockQualifies(w.bot, null, 'entry').any, false, 'at target: nothing qualifies')
  })
  const u = town([stack('oak_log', 64), stack('oak_log', 64), stack('iron_ingot', 30)])
  u.stock(5, 64, 0, Array.from({ length: 8 }, () => stack('oak_log', 64)))
  await capped(u, async () => { assert.equal(SK.stockQualifies(u.bot, null, 'entry').any, true, 'the ingots qualify') })
})
await t('A REFUSED CLAIM MOVES NOTHING: the plan\'s (stale) view says room, the journal says the town is at target -> the logs stay', async () => {
  const w = town([stack('oak_log', 64), stack('oak_log', 64), stack('oak_log', 30)])
  w.stock(5, 64, 0, Array.from({ length: 8 }, () => stack('oak_log', 64)))
  await capped(w, async () => {
    const SK = await import('../src/skills.mjs')
    await cobbleObserve(w.bot, { x: 5, y: 64, z: 0 }, await w.bot.openContainer(w.bot.blockAt({ x: 5, y: 64, z: 0 })))
    void SK
    B.setStockReaders({ town: () => view(0), well: () => true })   // a stale plan view: room for 64
    const n0 = RECS.length
    await run(w.bot)
    assert.equal(logsIn(w.bag), 158, 'nothing moved')
    assert.match(RECS.slice(n0).find(x => x.skill?.name === '_stock_bank')?.skill?.detail ?? '', /decision=at_cap .*claims=0 refused=1/)
  })
})

await t('PRUNE TAKES ONLY WHAT THE WELL THROWS (Claude code r2 P2-2): an empty bag and an at-target oak chest -> nothing is taken (the keep would stay in the bag); a bag already holding its keep (positive control) takes all four; a held name takes nothing', async () => {
  const takes = Array.from({ length: 4 }, () => ({ name: 'oak_log', count: 64, group: 'oak_log' }))
  const rule = (opts) => items => W.disposePlan(items, { maxStacks: Infinity, stock: opts }).stacks
  const opts = { groups: ['oak_log'], keeps: { oak_log: 64 }, holds: {} }
  assert.deepEqual(P.pruneAccepted([], takes, rule(opts)), [], 'empty bag: the keep would stay, so nothing goes')
  const kept = [it('oak_log', 64, 9), it('dirt', 64, 10)]
  assert.equal(P.pruneAccepted(kept, takes, rule(opts)).length, 4, 'the bag holds its keep: every take goes down the well')
  assert.equal(P.pruneAccepted(kept, takes, rule({ ...opts, holds: { oak_log: 64 } })).length, 0, 'a hold: the well throws none of the name')
  assert.equal(P.pruneAccepted(kept, takes, rule(null)).length, 0, 'no stock options (below target / no well): nothing')
  assert.equal(P.pruneAccepted([], [{ name: 'flint', count: 12, group: 'junk' }], rule(null)).length, 1, 'listed junk (owner 10-04) always goes')
  assert.deepEqual(P.pruneAccepted(kept, takes, () => { throw new Error('unreadable') }), [], 'an unreadable rule takes nothing')
  // and the PICK asks the same before any walk: an empty bag picks nothing; the keep held (positive control) picks four
  const now = 1e12
  const obs = { a: { n: 0, at: now - 1000, v: 2, m: { oak_log: 640 } } }
  const pick = bagNow => P.prunePick({ obs, keys: ['a'], avail: { oak_log: 640 }, free: 10, now, accept: c => P.pruneAccepted(bagNow, c, rule(opts)) })
  assert.equal(pick([]), null, 'empty bag: no walk to the chest')
  assert.equal(pick(kept)?.stacks, 4, 'the keep held: four stacks')
  assert.equal(P.prunePick({ obs: { j: { n: 0, at: now - 10, v: 2, m: { junk: 20 } } }, keys: ['j'], avail: {}, free: 5, now, accept: () => [] })?.stacks, 1, 'listed junk is not filtered (the well always throws it)')
  // A REFUSED GROUP NEVER STARVES A LATER ONE (Codex code r3 P2): cobble first (the rule here never throws it: no cap), oak
  // after -- the four slots go to oak; without the acceptance-while-filling they were spent on cobble and nothing was picked
  const mixed = { a: { n: 640, at: now - 1000, v: 2, m: { cobble: 640, oak_log: 640 } } }
  const pm = P.prunePick({ obs: mixed, keys: ['a'], avail: { cobble: 640, oak_log: 640 }, free: 10, now, accept: c => P.pruneAccepted(kept, c, rule(opts)) })
  assert.deepEqual(pm?.takes, [{ group: 'oak_log', stacks: 4 }], `cobble refused, oak picked: ${JSON.stringify(pm)}`)
})

await t('PRUNE EVIDENCE (Paper 10-10: graded unknown): the runner scores prune_town by its own verified count -- taken and thrown 128 -> prune_effect; none -> no evidence (the bag\'s net change is zero either way)', async () => {
  const { classifyOutcome } = await import('../src/skills.mjs')
  assert.match(classifyOutcome('prune_town', 'success', { inventory: {}, pruned: 128 }, null).because.join('|'), /^prune_effect: 128 /)
  assert.deepEqual(classifyOutcome('prune_town', 'success', { inventory: {}, pruned: 0 }, null).because, [])
  assert.deepEqual(classifyOutcome('prune_town', 'success', { inventory: { oak_log: 0 }, placed: 0 }, null).because, [], 'a placed block or a zero delta is not a prune')
})

// ----------------------------------------------------------------------------------------------- the recovery (Codex code r2)
await t('RECOVERY PLAN (Codex code r2 P1): the reservation is the room, the keeps are judged on the bag as it is NOW -- 312 planks after the craft, 64 reserved, keep 64 (logbank-01: the wood keep is 16 units = 64 planks; was 256) -> at most 64; a held name moves nothing; without the reservation the town view refuses', async () => {
  const bag = [it('oak_planks', 64, 9), it('oak_planks', 64, 10), it('oak_planks', 64, 11), it('oak_planks', 64, 12), it('oak_planks', 56, 13)]
  const keep = TD.townKeeps({ oak_planks: 312 }, { wanted: ['oak_planks'] }).keep.oak_planks ?? 0
  assert.ok(keep >= 64, `the wood rung keeps ${keep} planks`)
  await withReaders(() => view(9999), () => true, () => {
    const n = B.depositPlan(bag, null, { wants: ['oak_planks'], stockRoomFor: { oak_planks: 64 } }).find(e => e.name === 'oak_planks')?.count ?? 0
    assert.ok(n > 0 && n <= 64 && 312 - n >= keep, `planned ${n}: the keep (${keep}) stays`)
    assert.equal(B.depositPlan(bag, null, { wants: ['oak_planks'] }).find(e => e.name === 'oak_planks'), undefined, 'control: no reservation, at target -> none')
    B.setWithdrawHold('oak_planks', 312, Date.now() + 60_000)
    try {
      assert.equal(B.depositPlan(bag, null, { wants: ['oak_planks'], stockRoomFor: { oak_planks: 64 } }).find(e => e.name === 'oak_planks'), undefined, 'a held name: nothing, reservation or not')
    } finally { B.clearWithdrawHolds() }
  })
})
const livePlanksClaims = () => {
  const dir = process.env.POOL_STATE_DIR
  const f = fs.readdirSync(dir).find(x => x.endsWith('.cobble.jsonl'))
  if (!f) return { live: 0, all: 0 }
  const st = CC.readTown(dir, f.replace('.cobble.jsonl', ''))
  const raw = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return {} } })
  return { live: Object.values(st.claims).filter(c => c.g === 'oak_planks' && c.state === 'live').length, all: raw.filter(r => r.t === 'claim' && r.g === 'oak_planks').length }
}
const plankTown = () => {
  const w = town([stack('oak_planks', 64), stack('oak_planks', 64), stack('oak_planks', 64), stack('oak_planks', 64), stack('oak_planks', 64), stack('chest', 1)])
  w.fill(5, 64, 0, 'cobblestone', 64)
  w.bot.currentWants = ['oak_planks']
  return w
}
const planksIn = items => items.filter(Boolean).reduce((n, x) => n + (x.name === 'oak_planks' ? x.count : 0), 0)
await t('RECOVERY CHAIN (Codex code r2 P1): full chest -> reserve 64 planks -> the bag loses 8 before the deposit (as the chest craft does) -> the new chest gets at most the 64 reserved (logbank-01: the 64-plank keep no longer binds first); 248 stay; no claim stays live', async () => {
  const w = plankTown()
  const place0 = w.bot.placeBlock
  w.bot.placeBlock = async (...a) => { const r = await place0(...a); const s = w.bag.find(x => x.name === 'oak_planks' && x.count >= 8); s.count -= 8; return r }
  await capped(w, async () => {
    const n0 = RECS.length
    const r = await run(w.bot)
    const rec = RECS.slice(n0).filter(x => x.skill?.name === '_stock_recovery').map(x => x.skill.detail)
    assert.ok(rec.some(d => /qualifying=oak_planks/.test(d) && /claims=\S*\d/.test(d)), `the planks were reserved: ${rec.join(' | ')} :: ${r.detail}`)
    assert.equal(w.spy.placed.length, 1, `a chest went down: ${r.detail}`)
    const banked = w.containers.get(w.spy.placed[0]).slots.filter(Boolean).reduce((n, s) => n + (s.name === 'oak_planks' ? s.count : 0), 0)
    assert.ok(banked > 0 && banked <= 64, `banked ${banked} of the 312 left after the 8: ${r.detail}`)
    assert.ok(planksIn(w.bag) >= 312 - 64, `the reservation bounds it, and the keep stays: ${planksIn(w.bag)}`)
    const c = livePlanksClaims()
    assert.ok(c.all > 0 && c.live === 0, `claims ${JSON.stringify(c)}`)
    // the reserved planks are never named refused (fold-r1: the row is judged with the plan's own reservation)
    assert.equal(RECS.slice(n0).filter(x => x.skill?.name === '_stock_refused' && /oak_planks:/.test(x.skill.detail)).length, 0)
  })
})
await t('RECOVERY ROW (Codex code r3 P2): six reservations -> the row says nclaims=6 however its id list is cut, and the journal holds six admitted claims carrying the recovery\'s action id', async () => {
  const LOGS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log']
  const w = town(LOGS.flatMap(n => [stack(n, 64), stack(n, 64)]))
  w.bot.currentWants = LOGS
  w.fill(5, 64, 0, 'cobblestone', 64)
  await capped(w, async () => {
    const SK = await import('../src/skills.mjs')
    await cobbleObserve(w.bot, { x: 5, y: 64, z: 0 }, await w.bot.openContainer(w.bot.blockAt({ x: 5, y: 64, z: 0 })))
    const n0 = RECS.length
    const q = SK.stockQualifies(w.bot, null, 'place', { reserveAt: { x: 4, y: 64, z: -1 }, aid: 'AIDTEST' })
    const row = RECS.slice(n0).find(x => x.skill?.name === '_stock_recovery')?.skill?.detail ?? ''
    const n = Object.keys(q.reserved).length
    assert.ok(n >= 6, `six log types reserved: ${n} ${row}`)
    assert.match(row, new RegExp(`^stage=place aid=AIDTEST at=4,64,-1 untargeted=0 nowell=0 nclaims=${n} `))
    const dir = process.env.POOL_STATE_DIR
    const f = fs.readdirSync(dir).find(x => x.endsWith('.cobble.jsonl'))
    const raw = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    assert.equal(raw.filter(r => r.t === 'claim' && r.aid === 'AIDTEST').length, n, 'every reservation carries the aid')
    for (const v of Object.values(q.reserved)) CC.recordCount(dir, f.replace('.cobble.jsonl', ''), null, { release: [v.id] })
  })
})
await t('RECOVERY ABORT (Codex code r2 P2): aborted during the chest craft (after the reservation) -> the abort reaches the caller and the reservation is released, not left live (mutant: no finally -> live 1)', async () => {
  const w = plankTown()
  w.bag.splice(w.bag.findIndex(x => x.name === 'chest'), 1)   // no chest carried: the recovery reserves, then crafts
  const ac = new AbortController()
  w.bot.recipesFor = () => { ac.abort(); const e = new Error('aborted'); e.aborted = true; throw e }
  await capped(w, async () => {
    const n0 = RECS.length
    let threw = false
    try { await SKILLS.deposit.run({ bot: w.bot }, {}, ac.signal) } catch { threw = true }
    const rec = RECS.slice(n0).filter(x => x.skill?.name === '_stock_recovery').map(x => x.skill.detail)
    assert.ok(rec.some(d => /qualifying=oak_planks/.test(d)), `reserved before the abort: ${rec.join(' | ')} threw=${threw}`)
    const c = livePlanksClaims()
    assert.ok(c.all > 0 && c.live === 0, `claims after the abort ${JSON.stringify(c)}`)
    assert.equal(planksIn(w.bag), 320, 'nothing moved'); assert.ok(threw, 'the abort reached the caller')
  })
})

// ----------------------------------------------------------------------------------------------- the recount (stocktarget-02)
await t('RECOUNT ORDER (pure): at town + a not-yet-counted refusal + a reachable key -> count_town; never away, never on a PROVEN refusal or without a key; the plan and the keys read lazily, once per look; a 60 s cooldown; 10 min backoff after a fruitless count; a declined order refunded (the look too)', async () => {
  const R = await import('../src/recount.mjs')
  const uk = [{ name: 'oak_log', why: 'town_stock_unknown' }]
  let asked = 0, planned = 0
  const keys = () => { asked++; return ['5,64,0'] }
  const ref = v => () => { planned++; return v }
  const T = 1e9
  assert.equal(R.recountOrder({ now: T, atTown: false, unknownRefused: ref(uk), keys }).order, null, 'away from town')
  assert.equal(planned + asked, 0, 'away: neither the plan nor the keys are read (Claude st2-r1 P3-1)')
  assert.equal(R.recountOrder({ now: T, atTown: true, unknownRefused: ref([{ name: 'oak_log', why: 'town_stock_target' }]), keys }).order, null, 'a PROVEN refusal is not a recount')
  assert.equal(asked, 0, 'the keys only after a not-yet-counted refusal')
  const nk = R.recountOrder({ now: T, atTown: true, unknownRefused: uk, keys: () => [] })
  assert.equal(nk.order, null, 'no reachable key: nothing')
  planned = 0
  assert.equal(R.recountOrder({ now: T + 1_000, atTown: true, unknownRefused: ref(uk), keys, state: nk.state }).order, null, 'the look is charged: no second look inside the cooldown')
  assert.equal(planned + asked, 0, 'not even the plan')
  const r1 = R.recountOrder({ now: T, atTown: true, unknownRefused: uk, keys })
  assert.equal(r1.order?.skill, 'count_town')
  assert.equal(R.recountOrder({ now: T + 30_000, atTown: true, unknownRefused: uk, keys, state: r1.state }).order, null, 'the cooldown')
  assert.equal(R.recountOrder({ now: T + 61_000, atTown: true, unknownRefused: uk, keys, state: r1.state }).order?.skill, 'count_town', 'after the cooldown')
  const zero = R.recountOutcome('no_effect', 0, T, r1.state)
  assert.equal(R.recountOrder({ now: T + 5 * 60_000, atTown: true, unknownRefused: uk, keys, state: zero }).order, null, 'counted nothing: backed off')
  assert.equal(R.recountOrder({ now: T + 11 * 60_000, atTown: true, unknownRefused: uk, keys, state: zero }).order?.skill, 'count_town', 'after the backoff')
  assert.equal(R.recountOutcome('success', 2, T, zero).backoffUntil, 0, 'a count clears the backoff')
  // DECLINED (Codex st2-r1 P3): both the issue and the look are refunded -- the next decision may order again at once
  const dec = R.recountOutcome('failed', 0, T, r1.state, 'runner_busy')
  assert.equal(R.recountOrder({ now: T + 1_000, atTown: true, unknownRefused: uk, keys, state: dec }).order?.skill, 'count_town', 'declined: ordered again a second later')
  // THE MISS RULE (recount file): one miss -> 10 min backoff; two >= 10 min apart within 6 h -> unusable; older than 6 h -> forgotten
  assert.equal(R.recountMissStatus([], T), 'ok')
  assert.equal(R.recountMissStatus([T - 60_000], T), 'backoff')
  assert.equal(R.recountMissStatus([T - 11 * 60_000], T), 'ok')
  assert.equal(R.recountMissStatus([T - 30 * 60_000, T - 15 * 60_000], T), 'unusable')
  assert.equal(R.recountMissStatus([T - 7 * 3600_000, T - 15 * 60_000], T), 'ok', 'the old miss expired')
  assert.deepEqual(R.recordRecountMiss([T - 7 * 3600_000, T - 60_000], T), [T - 60_000, T])
  assert.ok(!R.RECOUNT_MISS_REASONS.has('walk interrupted') && !R.RECOUNT_MISS_REASONS.has('walk timeout') && !R.RECOUNT_MISS_REASONS.has('open timed out'), 'never a miss')
})
const fenced = async bagStacks => {
  const w = town(bagStacks)
  w.stock(5, 64, 0, [stack('oak_log', 20)])
  installCobbleCap(w.bot); B.setStockWellProbe(() => true)
  await cobbleObserve(w.bot, { x: 5, y: 64, z: 0 }, await w.bot.openContainer(w.bot.blockAt({ x: 5, y: 64, z: 0 })))
  const dir = process.env.POOL_STATE_DIR
  const key = fs.readdirSync(dir).find(f => f.endsWith('.cobble.jsonl')).replace('.cobble.jsonl', '')
  await new Promise(r => setTimeout(r, 5))
  CC.appendJournal(dir, key, w.bot.worldId ?? null, { t: 'reset', at: Date.now() - 1 })
  return { w, dir, key }
}
await t('RECOUNT KEYS: a fenced town -> its chest is a key; the town memory holding it UNUSABLE (two failures >= 10 min apart) or in backoff -> no key (the reachability check, shared by the town)', async () => {
  const SK = await import('../src/skills.mjs')
  const CF2 = await import('../src/chestfull.mjs')
  const { w, dir, key } = await fenced([stack('oak_log', 64), stack('oak_log', 64)])
  try {
    SK.resetCobbleReconcile()
    assert.deepEqual(SK.unknownRefusals(w.bot).map(r => `${r.name}:${r.why}`), ['oak_log:town_stock_unknown'])
    assert.deepEqual(SK.stockRecountKeys(w.bot), ['5,64,0'])
    const t0 = Date.now()
    CF2.updateTownMemory(dir, key, w.bot.worldId ?? null, e => { e['5,64,0'] = CF2.recordOutcome(CF2.recordOutcome(undefined, 'unknown', t0 - 11 * 60_000), 'unknown', t0) })
    assert.deepEqual(SK.stockRecountKeys(w.bot), [], 'unusable: never walked to')
    CF2.updateTownMemory(dir, key, w.bot.worldId ?? null, e => { e['5,64,0'] = CF2.recordOutcome(undefined, 'unknown', t0) })
    assert.deepEqual(SK.stockRecountKeys(w.bot), [], 'in backoff: not now')
    CF2.updateTownMemory(dir, key, w.bot.worldId ?? null, e => { e['5,64,0'] = CF2.recordOutcome(undefined, 'took', t0) })
    assert.deepEqual(SK.stockRecountKeys(w.bot), ['5,64,0'], 'positive control: a container that opened is a key again')
  } finally { B.setStockReaders({ town: null, well: null }) }
})
const missesOf = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.recount.json'))), 'utf8')).m } catch { return {} } }
await t('COUNT_TOWN: counts the fenced chest (the next plan is judged: room 44 under 64); a REAL no-path -> a recount miss in the recount file, the container memory UNTOUCHED (both reviews st2-r1 P1/P2); a second miss >= 10 min later -> no key, no order', async () => {
  const SK = await import('../src/skills.mjs')
  const CF2 = await import('../src/chestfull.mjs')
  {
    const { w } = await fenced([stack('oak_log', 64), stack('oak_log', 64)])
    try {
      SK.resetCobbleReconcile()
      const n0 = RECS.length
      const r = await SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
      assert.equal(r.status, 'success', r.detail); assert.equal(r.counted, 1)
      assert.match(RECS.slice(n0).find(x => x.skill?.name === '_stock_recount')?.skill?.detail ?? '', /^trigger=order refused=1 keys=1 counted=1 tried=1 unknown_after=0 /)
      assert.equal(B.bankableInventory(w.bot.inventory.items(), { wants: ['oak_log'] }).detail.oak_log, 44, 'judged on the count')
    } finally { B.setStockReaders({ town: null, well: null }) }
  }
  {
    const { w, dir, key } = await fenced([stack('oak_log', 64), stack('oak_log', 64)])
    try {
      SK.resetCobbleReconcile()
      w.bot.pathfinder.goto = async () => { throw new Error('No path to the goal!') }
      const n0 = RECS.length
      const r = await SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
      assert.equal(r.status, 'no_effect'); assert.equal(r.counted, 0)
      assert.match(RECS.slice(n0).find(x => x.skill?.name === '_stock_recount')?.skill?.detail ?? '', /counted=0 tried=1 unknown_after=1/)
      assert.equal(CF2.readTownMemory(dir, key, w.bot.worldId ?? null)['5,64,0'], undefined, 'the container memory the deposit reads is untouched')
      assert.equal((missesOf(dir)['5,64,0'] ?? []).length, 1, 'one recount miss')
      SK.resetCobbleReconcile()
      assert.deepEqual(SK.stockRecountKeys(w.bot), [], 'one miss: the town backs it off for 10 min')
      const m = missesOf(dir)
      fs.writeFileSync(path.join(dir, `${key}.recount.json`), JSON.stringify({ w: w.bot.worldId ?? null, m: { '5,64,0': [Date.now() - 25 * 60_000, Date.now() - 12 * 60_000] } }))
      void m
      assert.deepEqual(SK.stockRecountKeys(w.bot), [], 'two misses 10+ min apart: unusable, no key -- the order cannot loop on it')
      fs.writeFileSync(path.join(dir, `${key}.recount.json`), JSON.stringify({ w: w.bot.worldId ?? null, m: { '5,64,0': [Date.now() - 12 * 60_000] } }))
      assert.deepEqual(SK.stockRecountKeys(w.bot), ['5,64,0'], 'positive control: one old miss, a key again')
    } finally { B.setStockReaders({ town: null, well: null }) }
  }
})
await t('COUNT_TOWN NEVER MISSES ON NON-EVIDENCE (both reviews st2-r1): an INTERRUPTED walk ends the recount (no miss, no second walk); our own CLOCK (a budget timeout) backs off this bot only; a walk that RESOLVES out of reach is a miss (the arrival check)', async () => {
  const SK = await import('../src/skills.mjs')
  const CF2 = await import('../src/chestfull.mjs')
  const cases = [
    ['interrupted', async () => { throw new Error('The goal was changed before it could be completed!') }, 0],
    ['timeout', async () => { throw Object.assign(new Error('pathfinding exceeded 15000ms'), { budgetExceeded: true }) }, 0],
    ['resolved out of reach', async () => {}, 1],
  ]
  for (const [name, goto, wantMiss] of cases) {
    const { w, dir, key } = await fenced([stack('oak_log', 64), stack('oak_log', 64)])
    try {
      SK.resetCobbleReconcile()
      w.bot.pathfinder.goto = goto
      if (name === 'resolved out of reach') w.bot.entity.position = w.bot.entity.position.offset(0, 0, 9)   // 9+ blocks from the chest
      const o0 = w.spy.opened.length
      const r = await SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
      assert.equal(r.counted, 0, name)
      assert.equal((missesOf(dir)['5,64,0'] ?? []).length, wantMiss, `${name}: misses`)
      assert.equal(CF2.readTownMemory(dir, key, w.bot.worldId ?? null)['5,64,0'], undefined, `${name}: the container memory untouched`)
      assert.equal(w.spy.opened.length - o0, 0, `${name}: never opened`)
    } finally { B.setStockReaders({ town: null, well: null }) }
  }
})
await t('COUNT_TOWN: an open still PENDING -> nothing is opened (Codex st2-r1 P2), the row says so; an ABORT mid-recount -> one row, status aborted, with what it had counted (Codex st2-r1 P2), and the abort propagates', async () => {
  const SK = await import('../src/skills.mjs')
  {
    const { w } = await fenced([stack('oak_log', 64), stack('oak_log', 64)])
    try {
      SK.resetCobbleReconcile()
      w.bot.cobbleOpenPending = new Promise(() => {})
      const n0 = RECS.length, o0 = w.spy.opened.length
      const r = await SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
      assert.equal(r.counted, 0); assert.equal(w.spy.opened.length - o0, 0, 'no open while one is pending')
      assert.match(RECS.slice(n0).find(x => x.skill?.name === '_stock_recount')?.skill?.detail ?? '', /pending_open=1/)
      w.bot.cobbleOpenPending = null
      assert.deepEqual(SK.stockRecountKeys(w.bot), ['5,64,0'], 'positive control: settled, a key again')
    } finally { B.setStockReaders({ town: null, well: null }) }
  }
  {
    const { w } = await fenced([stack('oak_log', 64), stack('oak_log', 64)])
    try {
      SK.resetCobbleReconcile()
      const ac = new AbortController()
      w.bot.pathfinder.goto = async () => { ac.abort(); throw Object.assign(new Error('aborted'), { aborted: true }) }
      const n0 = RECS.length
      let threw = false
      try { await SKILLS.count_town.run({ bot: w.bot }, {}, ac.signal) } catch { threw = true }
      assert.ok(threw, 'the abort propagates')
      const rows = RECS.slice(n0).filter(x => x.skill?.name === '_stock_recount')
      assert.equal(rows.length, 1, 'one row for the started recount')
      assert.equal(rows[0].skill.status, 'aborted'); assert.match(rows[0].skill.detail, /counted=0 tried=1 aborted=1/)
    } finally { B.setStockReaders({ town: null, well: null }) }
  }
})

await t('AN INTERRUPTION ENDS THE RECOUNT (Claude st2-r2 P2-1a): two uncounted chests, the first walk interrupted -> ONE walk, nothing opened, no second walk, the row says interrupted=1 tried=1; positive control: a no-path on the first goes on to the second', async () => {
  const SK = await import('../src/skills.mjs')
  for (const [name, err, wantGotos] of [['interrupted', 'The goal was changed before it could be completed!', 1], ['no path', 'No path to the goal!', 2]]) {
    const w = town([stack('oak_log', 64), stack('oak_log', 64)])
    w.stock(5, 64, 0, [stack('oak_log', 20)])
    w.set(5, 64, 3, 'chest'); w.stock(5, 64, 3, [stack('oak_log', 10)])
    installCobbleCap(w.bot); B.setStockWellProbe(() => true)
    try {
      SK.resetCobbleReconcile()
      assert.equal(SK.stockRecountKeys(w.bot).length, 2, `${name}: two uncounted chests`)
      const g0 = w.spy.gotos.length, o0 = w.spy.opened.length
      w.bot.pathfinder.goto = async goal => { w.spy.gotos.push({ x: goal.x, y: goal.y, z: goal.z }); throw new Error(err) }
      const n0 = RECS.length
      await SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
      assert.equal(w.spy.gotos.length - g0, wantGotos, `${name}: walks`)
      assert.equal(w.spy.opened.length - o0, 0, `${name}: nothing opened`)
      const row = RECS.slice(n0).find(x => x.skill?.name === '_stock_recount')?.skill?.detail ?? ''
      if (name === 'interrupted') assert.match(row, /counted=0 tried=1 unknown_after=\d+ interrupted=1 /)
      else assert.match(row, /counted=0 tried=2 .*fails=unreachable:2 /)
    } finally { B.setStockReaders({ town: null, well: null }) }
  }
})
await t('THE PENDING-OPEN GUARD IN THE SHARED ENTRY (Claude st2-r2 P2-1b): reconcileCobble itself -- the town deposit\'s count step calls it before its own check -- opens nothing while an open is pending; positive control: settled, it counts', async () => {
  const SK = await import('../src/skills.mjs')
  const { w } = await fenced([stack('oak_log', 64), stack('oak_log', 64)])
  try {
    SK.resetCobbleReconcile()
    const msLeft = cap => cap
    w.bot.cobbleOpenPending = new Promise(() => {})
    const o0 = w.spy.opened.length
    const r1 = await SK.reconcileCobble(w.bot, new AbortController().signal, msLeft, ['5,64,0'])
    assert.equal(r1.pending, true); assert.equal(r1.counted, 0); assert.equal(w.spy.opened.length - o0, 0, 'no open while one is pending')
    w.bot.cobbleOpenPending = null
    const r2 = await SK.reconcileCobble(w.bot, new AbortController().signal, msLeft, ['5,64,0'])
    assert.equal(r2.counted, 1, 'settled: counted')
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('AN UNLOADED CELL IS NO MISS (Claude st2-r2 P3-a): a key whose cell is not loaded -> this bot backs off, the recount file is untouched; the row names fails=not_loaded', async () => {
  const SK = await import('../src/skills.mjs')
  const { w, dir } = await fenced([stack('oak_log', 64), stack('oak_log', 64)])
  try {
    SK.resetCobbleReconcile()
    const blockAt0 = w.bot.blockAt
    w.bot.blockAt = p => (p && p.x === 5 && p.y === 64 && p.z === 0 ? null : blockAt0(p))
    const n0 = RECS.length
    await SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
    assert.match(RECS.slice(n0).find(x => x.skill?.name === '_stock_recount')?.skill?.detail ?? '', /counted=0 tried=1 .*fails=not_loaded:1 /)
    assert.equal((missesOf(dir)['5,64,0'] ?? []).length, 0, 'no shared miss')
  } finally { B.setStockReaders({ town: null, well: null }) }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
