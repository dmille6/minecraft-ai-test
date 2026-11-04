// COBBLEBANK-01 (OWNER 11-04 "do the surplus cobble fix"): (a) a town visit banks EVERY whole cobble stack above the bag's 64,
// not one per name, and the not-full visit's tail banks cobble too; (b) below the cap, a full-bag well takes the surplus whole
// stacks when the town's containers are PROVEN without room. The pure decisions (cobblebank.mjs, and the plan in
// towndeposit.mjs / bankable.mjs) are tested by what they return; the skills' wiring is driven through the real town deposit
// (towndeposit.test.mjs) and the real well (well.test.mjs); every anchored mutant here is killed.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.LOG_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-cobblebank-'))
process.env.POOL_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'mcbot-cobblebank-pool-'))
process.env.BOT_NAME = 'CobbleBankBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
delete process.env.COBBLEBANK

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const CB = await import('../src/cobblebank.mjs')
const BK = await import('../src/bankable.mjs')
const TD = await import('../src/towndeposit.mjs')
const W = await import('../src/well.mjs')
const ST = await import('../src/stocktarget.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const off = fn => { const was = process.env.COBBLEBANK; process.env.COBBLEBANK = 'off'; try { return fn() } finally { if (was === undefined) delete process.env.COBBLEBANK; else process.env.COBBLEBANK = was } }

const it = (name, count, slot) => ({ name, count, slot })
const fill = (n, from = 20) => Array.from({ length: n }, (_, i) => it('white_wool', 1, from + i))   // never bankable
const cobbleSteps = (bag, o = {}) => TD.townDepositPlan(bag, o).steps.filter(s => CB.isBankCobble(s.name)).map(s => `${s.name}:${s.count}`).sort()
const heldCobble = bag => bag.reduce((n, x) => n + (CB.isBankCobble(x.name) ? x.count : 0), 0)

// ------------------------------------------------------------------------------------------------- the switch and the cap
await t('the switch: on by default, COBBLEBANK=off is the old 64-a-name visit, read live; the names are bankable.mjs COBBLE_NAMES', () => {
  assert.equal(CB.COBBLEBANK.on, true)
  assert.equal(CB.cobbleVisitCap(), Infinity)
  assert.equal(off(() => CB.COBBLEBANK.on), false)
  assert.equal(off(() => CB.cobbleVisitCap()), 64)
  assert.equal(CB.cobbleVisitCap(false), CB.OLD_COBBLE_VISIT_CAP)
  assert.deepEqual([...CB.BANK_COBBLE_NAMES], [...BK.COBBLE_NAMES], 'one list (copied: bankable.mjs imports this module)')
  assert.equal(CB.NOROOM_TOWN_RESERVE, ST.BUILD_RESERVE.cobblestone, 'the reserve is the owner\'s BUILD_RESERVE cobblestone (256)')
  assert.match(CB.cobbleBankModeDetail(), /^phase=mode on=1 visit_cap=all tail=1 /)
  assert.match(off(() => CB.cobbleBankModeDetail()), /^phase=mode on=0 visit_cap=64 tail=0 /)
})

// ------------------------------------------------------------------------------------------------------------- (a) the bank
await t('(a) the deposit plan: EVERY whole stack above the bag\'s 64, smallest first (off: one stack a name, as before)', () => {
  const bag = [it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 20, 11), it('cobbled_deepslate', 64, 12), it('cobbled_deepslate', 64, 13), ...fill(8)]
  // 276 held (the two names together): smallest first 20, then 64 (slot 9), 64 (10), 64 (12) = 212 -- the bag keeps 64
  assert.deepEqual(BK.depositPlan(bag).filter(e => CB.isBankCobble(e.name)).map(e => `${e.name}:${e.count}`).sort(), ['cobbled_deepslate:64', 'cobblestone:148'])
  assert.deepEqual(off(() => BK.depositPlan(bag)).filter(e => CB.isBankCobble(e.name)).map(e => `${e.name}:${e.count}`).sort(), ['cobbled_deepslate:64', 'cobblestone:20'], 'off: the old plan exactly')
  // the COUNT callers (depositDue, the prompt, the deposit rung) keep the old credit: bankableInventory's own default
  assert.equal(BK.bankableInventory(bag).detail.cobblestone, 20, 'bankableInventory without cobbleCap: the credit cap 64, unchanged')
  assert.equal(BK.bankableInventory(bag, { cobbleCap: Infinity }).detail.cobblestone, 148)
})

await t('(a) the town deposit plan: every whole cobble stack above the keep in ONE visit; the bag keeps 64; off is the old one-a-name', () => {
  const bag = [it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 20, 11), it('cobblestone', 64, 12), ...fill(30)]
  assert.deepEqual(cobbleSteps(bag), ['cobblestone:20', 'cobblestone:64', 'cobblestone:64'])
  assert.deepEqual(cobbleSteps(bag, { cobbleBank: false }), ['cobblestone:20'], 'off: CREDIT_CAP 64 a name a visit')
  assert.equal(TD.townDepositPlan(bag).freed - TD.townDepositPlan(bag, { cobbleBank: false }).freed, 2, 'two more slots freed in this visit')
  assert.deepEqual(off(() => cobbleSteps(bag)), ['cobblestone:20'], 'and the env switch is the same off')
  for (const b of [bag, [it('cobblestone', 64, 9), it('cobbled_deepslate', 64, 10), it('cobblestone', 5, 11), it('cobbled_deepslate', 33, 12), ...fill(30)]]) {
    const p = TD.townDepositPlan(b)
    const left = heldCobble(b) - p.steps.reduce((n, s) => n + (CB.isBankCobble(s.name) ? s.count : 0), 0)
    assert.ok(left >= 64, `kept ${left}`)
    assert.ok(p.steps.filter(s => CB.isBankCobble(s.name)).every(s => b.find(x => x.slot === s.slot).count === s.count), 'whole stacks only')
  }
  assert.deepEqual(cobbleSteps([it('cobblestone', 64, 9), ...fill(30)]), [], 'exactly the reserve: nothing')
  assert.deepEqual(cobbleSteps([it('cobblestone', 30, 9), it('cobblestone', 40, 11), ...fill(30)]), [], '70 held: no whole stack leaves 64')
  // the visit's earlier container does not spend a cobble allowance any more (already): the plan judges the reduced bag itself
  assert.deepEqual(cobbleSteps(bag, { already: { cobblestone: 64 } }), ['cobblestone:20', 'cobblestone:64', 'cobblestone:64'])
  assert.deepEqual(cobbleSteps(bag, { already: { cobblestone: 64 }, cobbleBank: false }), [], 'off: the visit\'s 64 is spent')
})

await t('(a) the town cap still admits each stack (cobblecap 1000), and a withdraw hold still holds every cobble stack', () => {
  const bag = [it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 20, 11), it('cobblestone', 64, 12), ...fill(30)]
  try {
    BK.setCobbleTownReader(() => ({ lb: 900, complete: true, reserved: 0 }))
    assert.deepEqual(cobbleSteps(bag), ['cobblestone:20', 'cobblestone:64'], '900 + 20 + 64 = 984; the next 64 would pass 1000')
    BK.setCobbleTownReader(() => ({ lb: 990, complete: true, reserved: 0 }))
    assert.deepEqual(cobbleSteps(bag), [], 'no whole stack fits under the cap: the at-cap well\'s, not the bank\'s')
    BK.setCobbleTownReader(() => ({ lb: 100, complete: false, reserved: 0 }))
    assert.deepEqual(cobbleSteps(bag), [], 'an uncounted town banks no cobble')
  } finally { BK.setCobbleTownReader(null) }
  try {
    BK.setWithdrawHold('cobblestone', 64, Date.now() + 60_000)
    assert.deepEqual(cobbleSteps(bag), [], 'a project\'s fresh draw (withdraw hold) keeps every stack')
  } finally { BK.clearWithdrawHolds() }
})

await t('(a) the NOT-FULL visit (tail) banks the whole cobble stacks above 64 too, riding along a tail that fires for its own reasons; off: no cobble in the tail', () => {
  const bag = [it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 20, 11), it('oak_log', 30, 12), it('torch', 20, 13), ...fill(10)]
  assert.deepEqual(cobbleSteps(bag, { tail: 'only', bagAllowance: true }), ['cobblestone:20', 'cobblestone:64'])
  assert.ok(!TD.townDepositPlan(bag, { tail: 'only', bagAllowance: true }).steps.some(s => s.name === 'white_wool'), 'nothing else of the base plan joins')
  assert.deepEqual(cobbleSteps(bag, { tail: 'only', bagAllowance: true, cobbleBank: false }), [], 'off: the tail as before')
  const home = { x: 0, y: 64, z: 0 }
  const r = TD.tailOrder({ now: 1e9, slots: 14, pos: home, home, plan: () => TD.townDepositPlan(bag, { tail: 'only', bagAllowance: true }), container: true, state: {}, on: true })
  assert.equal(r.order?.skill, 'town_deposit')
  assert.equal(r.order.args.cobble, true); assert.equal(r.order.args.tail, true)
  assert.match(r.order.why, /cobble stacks above the bag's 64/)
  const r0 = TD.tailOrder({ now: 1e9, slots: 14, pos: home, home, plan: () => TD.townDepositPlan([it('cobblestone', 64, 9), ...fill(10)], { tail: 'only', bagAllowance: true }), container: true, state: {}, on: true })
  assert.equal(r0.order, null, 'the reserve alone orders nothing')
  // surplus cobble ALONE never fires the tail (it would go ahead of a ready rung every stay): it rides along with the rows
  const cob = [it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 20, 11), ...fill(10)]
  assert.ok(TD.townDepositPlan(cob, { tail: 'only', bagAllowance: true }).freed >= 2, 'positive control: the tail plan holds the cobble')
  assert.equal(TD.tailOrder({ now: 1e9, slots: 13, pos: home, home, plan: () => TD.townDepositPlan(cob, { tail: 'only', bagAllowance: true }), container: true, state: {}, on: true }).order, null)
})

await t('(a) order: a short chest takes the iron, coal and logs before the extra cobble; the rows after the cobble (off: slot order)', () => {
  const bag = [it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 64, 11), it('raw_copper', 7, 30), it('redstone', 8, 31), ...fill(30, 40)]
  const steps = TD.townDepositPlan(bag).steps
  const fit = TD.fitToContainer(steps, [null, null, ...Array(25).fill({ name: 'dirt' })])
  assert.deepEqual(fit.map(s => s.name).sort(), ['raw_copper', 'redstone'], 'two free slots: the copper and redstone, not the cobble')
  const fitOff = TD.fitToContainer(TD.townDepositPlan(bag, { cobbleBank: false }).steps, [null, null, ...Array(25).fill({ name: 'dirt' })])
  assert.equal(fitOff[0].name, 'cobblestone', 'off: the old slot order (the one cobble stack first)')
})

// ------------------------------------------------------------------------------------------------- (b) the no-room verdict
const V = (o = {}) => CB.noRoomVerdict({ left: 2, capRefused: { at_cap: 0, unknown: 0, outside: 0 }, keys: ['1,70,0', '5,70,0'], coverage: true, fullKeys: ['1,70,0', '5,70,0'], town: 400, complete: true, ...o })
await t('(b) the verdict: ONLY a town with every container proven without room, counted, below the cap, at its reserve', () => {
  assert.deepEqual(V(), { ok: true, why: 'no_room', unseen: 0 })
  assert.equal(V({ on: false }).why, 'off')
  assert.equal(V({ left: 0 }).why, 'nothing_left', 'everything banked: there was room')
  assert.equal(V({ capRefused: { at_cap: 1 } }).why, 'cap_refused', 'the cap kept a stack: the at-cap rule, not room')
  assert.equal(V({ capRefused: { unknown: 1 } }).why, 'cap_refused')
  assert.equal(V({ coverage: false }).why, 'town_unscanned')
  assert.equal(V({ keys: [] }).why, 'town_unscanned')
  const r = V({ fullKeys: ['1,70,0'] })
  assert.equal(r.why, 'town_has_room'); assert.equal(r.unseen, 1, 'one container not proven full')
  assert.equal(V({ fullKeys: new Set(['1,70,0', '5,70,0']) }).ok, true, 'a Set of full keys reads the same')
  assert.equal(V({ complete: false }).why, 'town_uncounted')
  assert.equal(V({ town: null }).why, 'town_uncounted')
  assert.equal(V({ town: 255 }).why, 'below_reserve', 'the town\'s working stock waits for room')
  assert.equal(V({ town: 256 }).ok, true, 'at the reserve')
})

await t('(b) the evidence: live for NOROOM_TTL_MS, and never after a town container TOOK items since it was taken', () => {
  const now = 1_000_000_000
  assert.equal(CB.noRoomLive({ at: now - 1000 }, now, -Infinity), true)
  assert.equal(CB.noRoomLive({ at: now - CB.NOROOM_TTL_MS }, now, -Infinity), false, 'expired')
  assert.equal(CB.noRoomLive({ at: now - 1000 }, now, now - 500), false, 'a container took items after the verdict: there is room')
  assert.equal(CB.noRoomLive({ at: now - 1000 }, now, now - 2000), true, 'a took before the verdict is the verdict\'s own run')
  assert.equal(CB.noRoomLive({ at: now + 1000 }, now, -Infinity), false, 'from the future: not trusted')
  assert.equal(CB.noRoomLive(null, now), false); assert.equal(CB.noRoomLive({}, now), false)
})

await t('(b) the memory\'s change time: any newer outcome but full (took, unknown, unavailable) -- so an overwrite never revives the evidence', () => {
  assert.equal(CB.memoryChangeAt({}), -Infinity)
  assert.equal(CB.memoryChangeAt({ a: { o: 'full', at: 50 } }), -Infinity, 'full only: no change')
  assert.equal(CB.memoryChangeAt({ a: { o: 'full', at: 50 }, b: { o: 'took', at: 40 } }), 40)
  assert.equal(CB.memoryChangeAt({ a: { o: 'unavailable', at: 70 }, b: { o: 'took', at: 40 } }), 70, 'a took overwritten by unavailable still counts as a change')
  assert.equal(CB.memoryChangeAt({ miss: { '1,2,3': 99 } }), -Infinity, 'an item-miss map is not an outcome')
  const flag = { at: 60 }
  assert.equal(CB.noRoomLive(flag, 100, CB.memoryChangeAt({ a: { o: 'unavailable', at: 70 } })), false)
  assert.equal(CB.noRoomLive(flag, 100, CB.memoryChangeAt({ a: { o: 'full', at: 70 } })), true, 'a newer full is more of the same evidence')
})

await t('(b) the well\'s mode: the cap wins; no_room only from below with live evidence and the town at its reserve now; never held', () => {
  assert.equal(CB.wellCobbleMode({ cap: 'at_cap', live: false }), 'at_cap')
  assert.equal(CB.wellCobbleMode({ cap: 'below', live: true, town: 400 }), 'no_room')
  assert.equal(CB.wellCobbleMode({ cap: 'below', live: false, town: 400 }), 'below')
  assert.equal(CB.wellCobbleMode({ cap: 'below', live: true, town: 200 }), 'below', 'the town fell under its reserve since')
  assert.equal(CB.wellCobbleMode({ cap: 'below', live: true, town: null }), 'below')
  assert.equal(CB.wellCobbleMode({ cap: 'held', live: true, town: 400 }), 'held', 'cobble a withdraw holds is never thrown')
  assert.equal(CB.wellCobbleMode({ cap: 'unknown', live: true, town: 400 }), 'unknown')
  assert.equal(CB.wellCobbleMode({ cap: 'none', live: true, town: 400 }), 'none')
  assert.equal(CB.wellCobbleMode({ on: false, cap: 'below', live: true, town: 400 }), 'below')
  assert.equal(CB.wellTakesCobble('no_room'), true); assert.equal(CB.wellTakesCobble('at_cap'), true)
  assert.equal(CB.wellTakesCobble('below'), false); assert.equal(CB.wellTakesCobble('held'), false)
})

await t('(b) the well takes the SAME stacks as at the cap: whole, smallest first, the bag keeps its 64 (well.mjs cobbleWellStacks)', () => {
  const bag = [it('cobblestone', 64, 9), it('cobblestone', 30, 10), it('cobblestone', 64, 11), it('egg', 16, 12)]
  const p = W.disposePlan(bag, { cobbleAtCap: CB.wellTakesCobble('no_room') })
  assert.deepEqual(p.stacks.filter(s => s.name === 'cobblestone').map(s => s.count), [64, 30])
  assert.equal(heldCobble(bag) - p.stacks.filter(s => s.name === 'cobblestone').reduce((n, s) => n + s.count, 0), 64)
  assert.deepEqual(W.disposePlan(bag, { cobbleAtCap: CB.wellTakesCobble('below') }).stacks.map(s => s.name), ['egg'])
})

await t('the rows: key=value, under 300, the slots freed', () => {
  const d = CB.bankRowDetail({ mode: 'full', before: 276, after: 64, planned: 4, plannedOld: 2, banked: 4, items: 212, slotsBefore: 36, slotsAfter: 32, verdict: { ok: false, why: 'nothing_left', unseen: 0 } })
  assert.equal(d, 'phase=bank mode=full cobble_before=276 cobble_after=64 planned=4 planned_old=2 banked_stacks=4 banked=212 slots=36->32 freed=4 noroom=0 why=nothing_left unseen=0')
  const w = CB.wellRowDetail({ stacks: 2, items: 94, left: 64, town: 400, age: 61_000, slotsBefore: 36, slotsAfter: 34, names: 'cobblestone' })
  assert.equal(w, 'phase=well why=no_room stacks=2 items=94 left=64 town=400 reserve=256 age_s=61 slots=36->34 freed=2 names=cobblestone')
  assert.ok(CB.bankRowDetail({ verdict: { ok: true, why: 'x'.repeat(400) } }).length <= 300)
})

// ------------------------------------------------------------------------------------------------------------- mutants
async function withMutant (file, old, neu, fn) {
  const p = path.join(SRC, file)
  const src = readFileSync(p, 'utf8')
  assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE in ${file}: ${old.slice(0, 70)}`)
  const tmp = path.join(SRC, `_mut_${process.pid}_${Math.random().toString(36).slice(2)}_${file}`)
  writeFileSync(tmp, src.replace(old, neu))
  try { return await fn(await import(`${tmp}?${Date.now()}_${Math.random()}`)) } finally { unlinkSync(tmp) }
}
const killed = []
const mut = async (file, old, neu, probe) => {
  const died = await withMutant(file, old, neu, async M => { try { await probe(M); return false } catch { return true } })
  killed.push(died)
  if (!died) console.log(`  SURVIVED  ${file}: ${old.slice(0, 70)}`)
}
const bag4 = [it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 20, 11), it('cobblestone', 64, 12), it('torch', 20, 13), ...fill(30)]
const probeVisitCap = M => assert.equal(M.cobbleVisitCap(true), Infinity)
const probeLeft = M => assert.equal(M.noRoomVerdict({ left: 0, keys: ['a'], coverage: true, fullKeys: ['a'], town: 400, complete: true }).ok, false)
const probeCapRefused = M => assert.equal(M.noRoomVerdict({ left: 1, capRefused: { at_cap: 1 }, keys: ['a'], coverage: true, fullKeys: ['a'], town: 400, complete: true }).ok, false)
const probeCoverage = M => assert.equal(M.noRoomVerdict({ left: 1, keys: ['a'], coverage: false, fullKeys: ['a'], town: 400, complete: true }).ok, false)
const probeUnseen = M => assert.equal(M.noRoomVerdict({ left: 1, keys: ['a', 'b'], coverage: true, fullKeys: ['a'], town: 400, complete: true }).ok, false)
const probeComplete = M => assert.equal(M.noRoomVerdict({ left: 1, keys: ['a'], coverage: true, fullKeys: ['a'], town: 400, complete: false }).ok, false)
const probeReserve = M => assert.equal(M.noRoomVerdict({ left: 1, keys: ['a'], coverage: true, fullKeys: ['a'], town: 100, complete: true }).ok, false)
const probeOn = M => assert.equal(M.noRoomVerdict({ on: false, left: 1, keys: ['a'], coverage: true, fullKeys: ['a'], town: 400, complete: true }).ok, false)
const probeTtl = M => assert.equal(M.noRoomLive({ at: 0 }, 10 * 60 * 1000, -Infinity), false)
const probeTook = M => assert.equal(M.noRoomLive({ at: 1000 }, 2000, 1500), false)
const probeModeBelow = M => assert.equal(M.wellCobbleMode({ cap: 'held', live: true, town: 400 }), 'held')
const probeModeLive = M => assert.equal(M.wellCobbleMode({ cap: 'below', live: false, town: 400 }), 'below')
const probeModeReserve = M => assert.equal(M.wellCobbleMode({ cap: 'below', live: true, town: 100 }), 'below')
const probeTdAllowance = M => assert.deepEqual(M.townDepositPlan(bag4).steps.filter(s => s.name === 'cobblestone').map(s => s.count), [20, 64, 64])
const probeTdTail = M => assert.equal(M.townDepositPlan(bag4, { tail: 'only', bagAllowance: true }).steps.filter(s => s.name === 'cobblestone').length, 3)
const probeTdRank = M => {
  const b = [it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 64, 11), it('raw_copper', 7, 30), it('redstone', 8, 31), ...fill(30, 40)]
  assert.deepEqual(M.fitToContainer(M.townDepositPlan(b).steps, [null, null, ...Array(25).fill({ name: 'dirt' })]).map(s => s.name).sort(), ['raw_copper', 'redstone'])
}
const probeTdRideAlong = M => {
  const home = { x: 0, y: 64, z: 0 }
  const cob = [it('cobblestone', 64, 9), it('cobblestone', 64, 10), it('cobblestone', 20, 11), ...fill(10)]
  assert.equal(M.tailOrder({ now: 1e9, slots: 13, pos: home, home, plan: () => M.townDepositPlan(cob, { tail: 'only', bagAllowance: true }), container: true, state: {}, on: true }).order, null)
}
const probeTdTailOrder = M => {
  const home = { x: 0, y: 64, z: 0 }
  const r = M.tailOrder({ now: 1e9, slots: 14, pos: home, home, plan: () => M.townDepositPlan(bag4, { tail: 'only', bagAllowance: true }), container: true, state: {}, on: true })
  assert.equal(r.order?.args?.cobble, true)
}
const probeChange = M => assert.equal(M.memoryChangeAt({ a: { o: 'unavailable', at: 70 } }), 70)
const probeChangeFull = M => assert.equal(M.memoryChangeAt({ a: { o: 'full', at: 70 } }), -Infinity)
const probeBkCap = M => assert.equal(M.depositPlan(bag4).find(e => e.name === 'cobblestone')?.count, 148)
await t('mutants: every decision line is load-bearing (anchors asserted present and unique)', async () => {
  await mut('cobblebank.mjs', '  return on ? Infinity : OLD_COBBLE_VISIT_CAP', '  return OLD_COBBLE_VISIT_CAP', probeVisitCap)
  await mut('cobblebank.mjs', "  if (!(Number(left) > 0)) return no('nothing_left')\n", '', probeLeft)
  await mut('cobblebank.mjs', "  if ((Number(cr.at_cap) || 0) + (Number(cr.unknown) || 0) + (Number(cr.outside) || 0) > 0) return no('cap_refused')\n", '', probeCapRefused)
  await mut('cobblebank.mjs', "  if (!coverage || !ks.length) return no('town_unscanned')\n", '', probeCoverage)
  await mut('cobblebank.mjs', "  if (unseen > 0) return no('town_has_room')\n", '', probeUnseen)
  await mut('cobblebank.mjs', "  if (!complete || town == null || !Number.isFinite(Number(town))) return no('town_uncounted')\n", '', probeComplete)
  await mut('cobblebank.mjs', "  if (Number(town) < reserve) return no('below_reserve')\n", '', probeReserve)
  await mut('cobblebank.mjs', "  if (!on) return no('off')\n", '', probeOn)
  await mut('cobblebank.mjs', '  if (!(now - at < ttl) || now < at) return false\n', '', probeTtl)
  await mut('cobblebank.mjs', '  return !(Number(roomAt) > at)\n', '  return true\n', probeTook)
  await mut('cobblebank.mjs', "  if (!on || cap !== 'below' || !live) return cap ", "  if (!on) return cap ", probeModeBelow)
  await mut('cobblebank.mjs', "  if (!on || cap !== 'below' || !live) return cap ", "  if (!on || cap !== 'below') return cap ", probeModeLive)
  await mut('cobblebank.mjs', '  if (town == null || !Number.isFinite(Number(town)) || Number(town) < reserve) return cap\n', '', probeModeReserve)
  await mut('towndeposit.mjs', '[name, cobbleBank && isBankCobble(name) ? count : Math.min(', '[name, false ? count : Math.min(', probeTdAllowance)
  await mut('towndeposit.mjs', "  const cobbleTail = tail === 'only' && cobbleBank && !!bagAllowance ", '  const cobbleTail = false ', probeTdTail)
  await mut('towndeposit.mjs', ": cobbleBank && isBankCobble(st.name) ? 0.5 : 0)", ': 0)', probeTdRank)
  await mut('towndeposit.mjs', '...(cobble ? { cobble: true } : {}), ', '', probeTdTailOrder)
  await mut('towndeposit.mjs', '  if (!p || !(freedOwn >= 1 || logs || coal || count)) return none()', '  if (!p || !(p.freed >= 1 || logs || coal || count)) return none()', probeTdRideAlong)
  await mut('bankable.mjs', '  return bankableInventory(items, { cobbleCap: cobbleVisitCap(), ...opts,', '  return bankableInventory(items, { ...opts,', probeBkCap)
  await mut('cobblebank.mjs', "    if (!e || typeof e.o !== 'string' || e.o === 'full') continue\n", "    if (!e || e.o !== 'took') continue\n", probeChange)
  await mut('cobblebank.mjs', "    if (!e || typeof e.o !== 'string' || e.o === 'full') continue\n", "    if (!e || typeof e.o !== 'string') continue\n", probeChangeFull)
  assert.ok(killed.length === 21 && killed.every(Boolean), `killed ${killed.filter(Boolean).length}/${killed.length}`)
  console.log(`  mutants killed ${killed.filter(Boolean).length}/${killed.length}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
