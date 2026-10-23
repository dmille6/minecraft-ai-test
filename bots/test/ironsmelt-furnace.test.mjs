// IRONSMELT-01 WITH A WORKING FURNACE (Codex code r1 P2): the real smelt_town over the fake world and a fake furnace that
// converts (smelt-skill.test.mjs's semantics) -- the success, prior-stock, abort-mid-smelt, abort-mid-withdraw and error exits,
// each read from the server-side counts of the fake (town chests, bag, furnace slots) and the row; anchored mutants.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
delete process.env.IRONSMELT; delete process.env.SMELT_RULEOUT
const FX = await import('./ironsmelt-fixture.mjs')
const { CF, CHESTS, FAR, FW, HK, HOME, NEAR, RECS, S0, SJ, SJ_PATH, SKILLS_PATH, TI, chest, clearWithdrawHolds, count, dirtyByIndex, fakeWorld, field, freshPool, job, kOf, killedBy, lastRow, later, memDir, offset, realNow, seenByIndex, sig, stack, t, tapRecords, town, townTotal, withMutant, withServer } = FX

// ---- a WORKING furnace (Codex code r1 P2): the success, prior-stock, abort and error exits with real conversion ----------
/** smelt-skill.test.mjs's fake furnace semantics over the fake world's bag: puts move items out of the bag at once, the
 *  output appears one item every `smeltMs`, takes THROW on an empty slot, one coal burns 8. `priorIn` / `priorOut`: what an
 *  earlier stopped session left in it. `onItem(n)`: called after the n-th item is made (an abort mid-batch). */
function furnaceIn (w, p, { smeltMs = 5, priorIn = null, priorOut = null, priorFuel = null, onItem = null } = {}) {
  w.set(...p, 'furnace')
  const NAMES = FW.NAMES, bag = w.bag
  const give = (name, n) => { const st = bag.find(x => x && x.name === name && x.count + n <= 64); if (st) st.count += n; else bag.push({ name, type: NAMES.indexOf(name), count: n }) }
  const take = (name, n) => {
    if (bag.filter(x => x?.name === name).reduce((t, x) => t + x.count, 0) < n) throw new Error('not enough to transfer')
    let left = n
    for (const st of bag) { if (!st || st.name !== name || left <= 0) continue; const k = Math.min(st.count, left); st.count -= k; left -= k }
    for (let i = bag.length - 1; i >= 0; i--) if (bag[i] && bag[i].count <= 0) bag.splice(i, 1)
  }
  const OUT = { raw_iron: 'iron_ingot', raw_copper: 'copper_ingot' }
  const slot = (name, count) => (name && count > 0 ? { name, type: NAMES.indexOf(name), count } : null)
  const S = { input: priorIn ? slot(...priorIn) : null, fuel: priorFuel ? slot(...priorFuel) : null, output: priorOut ? slot(...priorOut) : null, burn: 0, made: 0 }
  let ticker = null
  const start = () => {
    if (ticker) return
    ticker = setInterval(() => {
      if (!S.input) return
      if (S.burn <= 0) { if (!S.fuel) return; S.fuel = slot(S.fuel.name, S.fuel.count - 1); S.burn = 8 }
      const out = OUT[S.input.name]
      S.input = slot(S.input.name, S.input.count - 1); S.burn--; S.made++
      S.output = slot(out, (S.output?.count ?? 0) + 1)
      onItem?.(S.made)
    }, smeltMs)
    ticker.unref?.()
  }
  const win = {
    inputItem: () => S.input, fuelItem: () => S.fuel, outputItem: () => S.output,
    get fuel () { return S.burn > 0 ? 0.5 : 0 }, selectedItem: null,
    items: () => bag.filter(Boolean), emptySlotCount: () => 36 - bag.filter(Boolean).length,
    async putInput (type, _m, n) { const nm = NAMES[type]; take(nm, n); S.input = slot(nm, (S.input?.name === nm ? S.input.count : 0) + n); start() },
    async putFuel (type, _m, n) { const nm = NAMES[type]; take(nm, n); S.fuel = slot(nm, (S.fuel?.count ?? 0) + n); start() },
    async takeOutput () { assert.ok(S.output, 'takeOutput on an empty slot'); const it = S.output; give(it.name, it.count); S.output = null; return it },
    async takeInput () { assert.ok(S.input, 'takeInput on an empty slot'); const it = S.input; give(it.name, it.count); S.input = null; return it },
    async takeFuel () { assert.ok(S.fuel, 'takeFuel on an empty slot'); const it = S.fuel; give(it.name, it.count); S.fuel = null; return it },
    close () { clearInterval(ticker); ticker = null; if (w.bot.currentWindow === win) w.bot.currentWindow = null },
  }
  w.bot.openFurnace = async () => { w.bot.currentWindow = win; return win }
  w.bot.lookAt ??= async () => {}
  return S
}
const FURNACE_AT = [1, 64, -1]
const ironWorks = async (S, { bag = [stack('cobblestone', 3), stack('raw_iron', 3), stack('iron_ingot', 2)], stock = [stack('raw_iron', 8), stack('coal', 4)], furnace = {}, abortAt = null } = {}) => {
  const w = town({ bag, stock: { [kOf(FAR)]: stock } })
  const ctl = new AbortController()
  const F = furnaceIn(w, FURNACE_AT, { ...furnace, onItem: abortAt ? n => { if (n === abortAt) ctl.abort() } : null })
  const n0 = RECS.length
  let r = null, threw = null
  try { r = await S.SKILLS.smelt_town.run({ bot: w.bot, runner: { current: { startedAt: Date.now() } } }, {}, ctl.signal) } catch (e) { threw = e }
  const row = RECS.slice(n0).filter(x => x?.skill?.name === '_smelt_town').at(-1)?.skill?.detail ?? ''
  return { w, r, threw, row, F }
}
const ironSuccess = async S => {
  const { w, r, row, F } = await ironWorks(S)
  assert.equal(r?.status, 'success', `${r?.status} ${r?.stop} ${r?.detail} | ${row}`)
  assert.equal(townTotal(w, 'iron_ingot'), 8, `8 ingots banked in town: ${row}`)
  assert.equal(townTotal(w, 'raw_iron'), 0, 'the town\'s 8 raw iron smelted')
  assert.equal(townTotal(w, 'coal'), 3, 'one town coal burned')
  assert.equal(count(w.bag, 'raw_iron'), 3, 'the bag keeps its OWN 3 raw iron'); assert.equal(count(w.bag, 'iron_ingot'), 2, 'and its own 2 ingots')
  assert.ok(!F.input && !F.output, 'the furnace left empty')
  for (const [k, v] of [['in', 'fe'], ['fed', '8'], ['fe', '3/2>3/2'], ['smelted', '8'], ['dep_i', '8'], ['verdict', 'ok'], ['withdrawn', '8'], ['stop', 'done']]) assert.equal(field(row, k), v, `${k}: ${row}`)
  assert.equal(r.smelted, 8, 'the runner\'s smelt_effect evidence')
}
await t('A WORKING FURNACE (success): town 8 raw iron + coal, the bag\'s own 3 raw + 2 ingots -> 8 ingots banked, the town\'s raw iron gone, one coal burned, the bag\'s own iron intact; fed=8 smelted=8 dep_i=8 fe=3/2>3/2 verdict=ok', async () => {
  await ironSuccess(S0)
})
const ironShort = async S => {
  // the town holds only 5 raw iron; the bag its own 3: the furnace is fed 5 (never 8 = 5 + 3 of the bag's own)
  const { w, r, row } = await ironWorks(S, { stock: [stack('raw_iron', 5), stack('coal', 4)] })
  assert.equal(r?.status, 'success', `${r?.status} ${r?.stop} ${row}`)
  assert.equal(field(row, 'fed'), '5', row); assert.equal(field(row, 'smelted'), '5', row)
  assert.equal(townTotal(w, 'iron_ingot'), 5, `5 ingots banked: ${row}`)
  assert.equal(count(w.bag, 'raw_iron'), 3, `the bag's own 3 raw iron never fed: ${row}`); assert.equal(count(w.bag, 'iron_ingot'), 2)
}
await t('A SHORT TOWN (the census: a few raw iron per container): town 5 + the bag\'s own 3 -> fed=5 smelted=5, 5 ingots banked, the own 3 raw iron untouched', async () => {
  await ironShort(S0)
})
await t('PRIOR STOCK (Codex design r1 P1): a furnace already holding 2 raw iron (input) and 3 ingots (output) -> the bag feeds 8 (fed=8), the bank takes everything above the bag\'s own; the own iron intact; verdict=ok', async () => {
  const { w, r, row } = await ironWorks(S0, { furnace: { priorIn: ['raw_iron', 2], priorOut: ['iron_ingot', 3], priorFuel: ['coal', 1] } })
  assert.equal(r?.status, 'success', `${r?.status} ${r?.stop} ${row}`)
  // smelt keeps same-name prior input in the slot and the batch makes 8 of the 10 there: the bag gave 8 and got 2 back -- fed is the
  // bag's own delta, never more than the town take (the ownership gate), while `smelted` counts what the furnace made
  assert.ok(Number(field(row, 'fed')) <= Number(field(row, 'withdrawn')), `the bag fed no more than the town take: ${row}`)
  assert.equal(townTotal(w, 'iron_ingot') + townTotal(w, 'raw_iron'), 13, `the furnace's prior stock banked too (13 of the family in town): ${row}`)
  assert.equal(count(w.bag, 'raw_iron'), 3); assert.equal(count(w.bag, 'iron_ingot'), 2)
  assert.equal(field(row, 'verdict'), 'ok', row)
})
await t('ABORT MID-SMELT (a reflex takes the body after 3 ingots): the row is an iron row (in=fe withdrawn=8), unreconciled, never ok; nothing of the bag\'s own iron is lost', async () => {
  const { w, threw, row } = await ironWorks(S0, { abortAt: 3 })
  assert.ok(threw, `the abort is rethrown: ${threw}`)
  assert.equal(field(row, 'in'), 'fe', row); assert.equal(field(row, 'withdrawn'), '8', row)
  assert.equal(field(row, 'stop'), 'interrupted', row); assert.equal(field(row, 'verdict'), 'unreconciled', row)
  assert.ok(count(w.bag, 'raw_iron') + count(w.bag, 'iron_ingot') >= 5, 'the bag holds at least its own 5')
})
const abortMidWithdraw = async S => {
  // THE WITHDRAW'S STATE IS THE CALLER'S (Codex code r1 P1): raw iron 5 in the near chest, 4 in the far; the walk after the
  // first verified take is aborted (a reflex) -> the row says in=fe withdrawn=5, never a copper row
  const w = town({ stock: { [kOf(NEAR)]: [stack('raw_iron', 5)], [kOf(FAR)]: [stack('raw_iron', 4), stack('coal', 4)] } })
  const ctl = new AbortController()
  const goto = w.bot.pathfinder.goto
  w.bot.pathfinder.goto = async (...a) => { if (count(w.bag, 'raw_iron') > 0) ctl.abort(); return goto(...a) }
  const n0 = RECS.length
  let threw = null
  try { await S.SKILLS.smelt_town.run({ bot: w.bot }, {}, ctl.signal) } catch (e) { threw = e }
  const row = RECS.slice(n0).filter(x => x?.skill?.name === '_smelt_town').at(-1)?.skill?.detail ?? ''
  assert.ok(threw, 'the abort is rethrown')
  assert.equal(field(row, 'in'), 'fe', row); assert.equal(field(row, 'withdrawn'), '5', row)
  assert.equal(field(row, 'stop'), 'interrupted', row)
}
await t('ABORT MID-WITHDRAW (Codex code r1 P1): a verified take of 5 raw iron, then the next walk aborted -> the row is the iron job\'s (in=fe withdrawn=5 stop=interrupted)', async () => {
  await abortMidWithdraw(S0)
})
// AN ABORT DURING THE ERROR EXIT'S BANK (Claude code r2 P3-1): the error is caught, the bank starts, and the reflex takes the body
// on the bank's walk -> the abort is rethrown and the row says interrupted (never `error`)
const abortInErrorBank = async S => {
  const w = town({ bag: [stack('cobblestone', 3), stack('raw_iron', 3), stack('iron_ingot', 2)], stock: { [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  const ctl = new AbortController()
  let failed = false
  const fb = w.bot.findBlock
  w.bot.findBlock = o => { if (count(w.bag, 'raw_iron') > 3) { failed = true; throw new Error('a world read failed') } return fb.call(w.bot, o) }
  const goto = w.bot.pathfinder.goto
  w.bot.pathfinder.goto = async (...a) => { if (failed) ctl.abort(); return goto(...a) }
  const n0 = RECS.length
  let threw = null
  try { await S.SKILLS.smelt_town.run({ bot: w.bot }, {}, ctl.signal) } catch (e) { threw = e }
  const row = RECS.slice(n0).filter(x => x?.skill?.name === '_smelt_town').at(-1)?.skill?.detail ?? ''
  assert.ok(threw, `the abort is rethrown, not swallowed as an error: ${row}`)
  assert.equal(field(row, 'stop'), 'interrupted', row)
  assert.equal(field(row, 'verdict'), 'unreconciled', row)
}
await t('AN ABORT DURING THE ERROR EXIT\'S BANK: rethrown; the row says stop=interrupted, unreconciled (Claude code r2 P3-1)', async () => {
  await abortInErrorBank(S0)
})
const errorAfterTake = async S0 => {
  const w = town({ bag: [stack('cobblestone', 3), stack('raw_iron', 3), stack('iron_ingot', 2)], stock: { [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  const fb = w.bot.findBlock
  w.bot.findBlock = o => { if (count(w.bag, 'raw_iron') > 3) throw new Error('a world read failed'); return fb.call(w.bot, o) }
  const r = await job(S0, w)
  const row = lastRow()
  assert.equal(r.status, 'failed', `${r.status} ${r.stop} ${row}`); assert.equal(field(row, 'stop'), 'error', row)
  assert.equal(townTotal(w, 'raw_iron'), 8, `the town's 8 raw iron are back in town: ${row}`)
  assert.equal(count(w.bag, 'raw_iron'), 3); assert.equal(count(w.bag, 'iron_ingot'), 2)
  assert.equal(field(row, 'in'), 'fe', row)
}
await t('AN ERROR AFTER THE TAKE (Claude design r1 P2-5): the iron job\'s error exit still banks the town\'s iron; the bag keeps its own; stop=error', async () => {
  await errorAfterTake(S0)
})

// ---- mutants -----------------------------------------------------------------------------------------------------------
await t('MUTANTS: each removes one part of the change and a behaviour test above fails for it', async () => {
  const kills = {}
  kills.noAdopt = await withMutant(SKILLS_PATH, 'signal, w) } finally { adopt() }', 'signal, w); adopt() } finally { }', S => killedBy(() => abortMidWithdraw(S)))
  kills.fedUncapped = await withMutant(SKILLS_PATH, 'f.n = IN === SMELT_IRON_INPUT ? ironSmeltCount({ withdrawn: f.withdrawn, raw0, rawNow: have }) : Math.min(SMELT_JOB_BATCH, have)',
    'f.n = IN === SMELT_IRON_INPUT ? Math.min(SMELT_JOB_BATCH, have) : Math.min(SMELT_JOB_BATCH, have)', S => killedBy(() => ironShort(S)))
  kills.abortSwallowed = await withMutant(SKILLS_PATH, "catch (e2) { if (e2?.aborted || signal?.aborted) { f.stop = 'interrupted'; throw e2 } /* else: the read counts town iron left in bags */ }",
    'catch (e2) { /* swallowed */ }', S => killedBy(() => abortInErrorBank(S)))
  kills.noErrorBank = await withMutant(SKILLS_PATH, "      try { await bankCopper() } catch (e2) { if (e2?.aborted || signal?.aborted) { f.stop = 'interrupted'; throw e2 } /* else: the read counts town iron left in bags */ }\n",
    '', S => killedBy(() => errorAfterTake(S)))
  const alive = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(alive, [], `mutants that survived: ${alive}`)
  console.log(`        mutants killed: ${Object.keys(kills).join(', ')}`)
})


FX.done()
