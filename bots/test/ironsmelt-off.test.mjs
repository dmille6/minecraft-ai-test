// IRONSMELT=off IS THE BASE (Claude code r1 P2-1): the one-setting rollback, in its own process (IRONSMELT is read once at module
// load). The real smelt_town over the fake world with NO iron marks anywhere: no iron pass, no iron miss, no index rule-out, the
// row's new fields all '-', the copper flow's opens and stops as smeltsearch.test.mjs's base scenes have them.
import assert from 'node:assert'
process.env.IRONSMELT = 'off'
delete process.env.SMELT_RULEOUT
const FX = await import('./ironsmelt-fixture.mjs')
const { CF, CHESTS, FAR, NEAR, S0, SJ, chest, count, field, job, kOf, lastRow, memDir, HOME, seenByIndex, stack, t, town, townTotal } = FX

await t('THE SWITCH READS OFF: IRONSMELT off, the rule-out off with it; the mode row says on=0 inputs=raw_copper rule_out=off', () => {
  assert.equal(SJ.IRONSMELT.on, false); assert.equal(SJ.SMELT_RULEOUT.on, false)
  assert.match(SJ.ironsmeltModeDetail(), /^phase=mode on=0 mode=off inputs=raw_copper miss_h=2 rule_out=off/)
})
await t('COPPER, AS THE BASE: raw copper in the nearest chest, raw iron + coal in a far one -> 8 copper taken (the first open is the copper chest), the iron untouched; in=- ru=- fe=- fed=-', async () => {
  const w = town({ stock: { [kOf(NEAR)]: [stack('raw_copper', 8)], [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  const r = await job(S0, w)
  const row = lastRow()
  assert.equal(r.stop, 'no_furnace', `${r.status} ${r.stop} ${row}`)
  assert.equal(w.spy.opened[0], kOf(NEAR), `the copper pass opens first (no iron pass): ${w.spy.opened}`)
  assert.equal(field(row, 'withdrawn'), '8', row)
  for (const k of ['in', 'ru', 'fe', 'fed']) assert.equal(field(row, k), '-', `${k}: ${row}`)
  assert.equal(townTotal(w, 'raw_iron'), 8, 'the raw iron is never taken'); assert.equal(count(chest(w, NEAR), 'raw_copper'), 8, 'the copper back (no furnace)')
  assert.equal(count(w.bag, 'raw_iron'), 0)
})
await t('NO COPPER, A TOWN OF RAW IRON: the base finds no copper (town_has_none) and leaves the raw iron where it lies', async () => {
  const w = town({ stock: { [kOf(FAR)]: [stack('raw_iron', 8), stack('coal', 4)] } })
  const r = await job(S0, w)
  assert.equal(r.stop, 'town_has_none', `${r.status} ${r.stop} ${lastRow()}`)
  assert.equal(townTotal(w, 'raw_iron'), 8); assert.equal(count(w.bag, 'raw_iron'), 0)
  assert.match(r.detail ?? '', /^no raw copper in the bag/, 'the base sentence')
})
await t('A COPPER SEARCH CUT BY ITS BUDGET: search_more, more=cu, 12 opens (the base\'s copper pass, no iron pass before it)', async () => {
  const w = town()
  for (let x = -12; x <= 12; x += 3) for (let z = -12; z <= 12; z += 3) {
    if (Math.hypot(x, z) > 13 || CHESTS.some(c => c[0] === x && c[2] === z) || (x === 6 && z === 0)) continue
    w.set(x, 64, z, 'chest'); w.stock(x, 64, z, [stack('dirt', 5)])
  }
  const r = await job(S0, w)
  assert.equal(r.stop, SJ.SMELT_SEARCH_MORE, `${r.status} ${r.stop} ${r.detail}`)
  assert.equal(w.spy.opened.length, SJ.SMELT_COPPER_VISITS)
  assert.equal(field(lastRow(), 'more'), 'cu', lastRow())
  // and no iron miss was written by any of those opens
  const mem = CF.readTownMemory(memDir(), CF.townKey(HOME), null) ?? {}
  assert.equal(Object.keys(mem[SJ.IRON_MISS_KEY] ?? {}).length, 0, 'no iron miss written with IRONSMELT off')
  assert.ok(Object.keys(mem[SJ.COPPER_MISS_KEY] ?? {}).length >= 1, 'POSITIVE CONTROL: the copper misses were written')
})
await t('NO RULE-OUT: a town the index knows is empty still has copper candidates (the base gate), and jobRuledOut is empty', async () => {
  const w = town()
  for (const c of CHESTS) seenByIndex(c)
  assert.equal(S0.jobRuledOut(w.bot, 'raw_copper').n, 0)
  assert.equal(S0.townCopperMiss(w.bot), false, 'the base gate: candidates left')
})

FX.done()
