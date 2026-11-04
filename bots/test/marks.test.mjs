// MARKS-01 (resource-model-1102 stage 3): ONE per-group policy table (low / target / high / bagKeep) with a hysteresis latch, in
// stocktarget.mjs, built from the owner's numbers already written there. Behaviour: the table's values, the bands, the latches,
// that the bag's keep never falls below the escape stone, that every existing reader sees the same numbers as before (no
// behaviour change), and the rows that now carry the band; anchored mutants.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const ST = await import('../src/stocktarget.mjs')
const { COBBLE_RESERVE } = await import('../src/bankable.mjs')
const { STONE_GUARD, COBBLE_WELL_RESERVE } = await import('../src/well.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

await t('the cobble row is the owner\'s numbers: LOW 256 (BUILD_RESERVE), TARGET 1000 (the cap), HIGH = target + yard room (0: no fleet yard), bagKeep 64', () => {
  assert.deepEqual({ ...ST.MARKS.cobble }, { low: 256, target: ST.TOWN_COBBLE_CAP, high: ST.TOWN_COBBLE_CAP + ST.YARD_ROOM.cobble, bagKeep: 64 })
  assert.equal(ST.MARKS.cobble.low, ST.BUILD_RESERVE.cobblestone)
  assert.equal(ST.YARD_ROOM.cobble, 0)
})
await t('sand LOW 16 / TARGET 64; stick LOW 40; per-type wood LOW 0 (the reserve is a total mats enforces); target-0 groups all 0', () => {
  assert.deepEqual({ ...ST.MARKS.sand }, { low: 16, target: 64, high: 64, bagKeep: 64 })
  assert.equal(ST.MARKS.stick.low, 40)
  assert.equal(ST.MARKS.oak_log.low, 0); assert.equal(ST.MARKS.oak_log.target, ST.TOWN_WOOD_TARGET)
  assert.deepEqual({ ...ST.MARKS.gravel }, { low: 0, target: 0, high: 0, bagKeep: 64 })
})
await t('every bulk group has marks, low <= target <= high; tools have none (today\'s rules)', () => {
  for (const g of ST.STOCK_GROUP_NAMES) {
    const m = ST.markOf(g)
    if (ST.kindOf(g) === 'tool') { assert.equal(m, null, g); continue }
    assert.ok(m && m.low <= m.target && m.target <= m.high, `${g}: ${JSON.stringify(m)}`)
  }
})
await t('THE ESCAPE STONE: no group\'s bagKeep is below COBBLE_RESERVE, STONE_GUARD or COBBLE_WELL_RESERVE', () => {
  const floor = Math.max(COBBLE_RESERVE, STONE_GUARD, COBBLE_WELL_RESERVE)
  assert.equal(floor, 64, 'positive control: the three escape constants are 64')
  for (const [g, m] of Object.entries(ST.MARKS)) assert.ok(m.bagKeep >= floor, `${g} bagKeep ${m.bagKeep}`)
  assert.equal(ST.bagKeepOf('cobble'), 64); assert.equal(ST.bagKeepOf('stone_pickaxe'), ST.STOCK_RESERVE)
})
await t('bands: unknown is never 0; below_low / low_target / target_high / above_high at the edges', () => {
  assert.equal(ST.bandOf('cobble', null), 'unknown'); assert.equal(ST.bandOf('cobble', undefined), 'unknown'); assert.equal(ST.bandOf('cobble', NaN), 'unknown')
  assert.equal(ST.bandOf('cobble', 0), 'below_low'); assert.equal(ST.bandOf('cobble', 255), 'below_low')
  assert.equal(ST.bandOf('cobble', 256), 'low_target'); assert.equal(ST.bandOf('cobble', 999), 'low_target')
  assert.equal(ST.bandOf('cobble', 1000), 'target_high'); assert.equal(ST.bandOf('cobble', 1001), 'above_high')
  assert.equal(ST.bandOf('stone_pickaxe', 3), null)
})
await t('latches: replenish holds from below LOW until TARGET; dispose holds from above HIGH until HIGH - 64; unknown clears dispose', () => {
  let L = ST.latchStep({}, 'cobble', 200)
  assert.deepEqual(L, { replenish: true, dispose: false })
  L = ST.latchStep(L, 'cobble', 600); assert.equal(L.replenish, true, 'held between LOW and TARGET')
  L = ST.latchStep(L, 'cobble', 1000); assert.equal(L.replenish, false, 'released at TARGET')
  L = ST.latchStep(L, 'cobble', 600); assert.equal(L.replenish, false, 'not re-set above LOW')
  L = ST.latchStep(L, 'cobble', 1001); assert.equal(L.dispose, true)
  L = ST.latchStep(L, 'cobble', 960); assert.equal(L.dispose, true, 'held within one stack of HIGH')
  L = ST.latchStep(L, 'cobble', 936); assert.equal(L.dispose, false, 'released at HIGH - 64')
  L = ST.latchStep({ dispose: true }, 'cobble', null); assert.equal(L.dispose, false, 'an unknown count is never surplus')
  assert.deepEqual(ST.latchStep({ replenish: true }, 'nope', 5), { replenish: false, dispose: false })
  // r1 BLOCKER (Claude): a HIGH below one stack (dirt 0, sand 64) must release, at 0
  assert.equal(ST.latchStep({ dispose: true }, 'dirt', 0).dispose, false); assert.equal(ST.latchStep({}, 'dirt', 3).dispose, true)
  assert.equal(ST.latchStep({ dispose: true }, 'sand', 0).dispose, false); assert.equal(ST.latchStep({ dispose: true }, 'sand', 10).dispose, true)
})
await t('NO BEHAVIOUR CHANGE: groupWholeStacks keeps 64 of the group exactly as before', () => {
  const items = [{ name: 'cobblestone', count: 64, slot: 1 }, { name: 'cobblestone', count: 64, slot: 2 }, { name: 'cobbled_deepslate', count: 30, slot: 3 }]
  assert.deepEqual(ST.groupWholeStacks(items, 'cobble').map(x => x.slot), [3, 1])
  assert.deepEqual(ST.groupWholeStacks(items, 'cobble', { reserve: 64 }), ST.groupWholeStacks(items, 'cobble'))
})
await t('the licence row names the cobble row and the yard room', () => {
  assert.equal(ST.marksModeDetail(), 'phase=mode cobble=256/1000/1000 bagkeep=64 sand=16/64/64 stick=40/4000 yard_room=0'.replace('4000', String(ST.TOWN_WOOD_TARGET)))
})
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
await t('the _stock_band row: the counted town and its band; an incomplete count is unknown', () => {
  assert.equal(ST.stockBandDetail('cobble', 1003), 'group=cobble town=1003 band=above_high low=256 target=1000 high=1000')
  assert.equal(ST.stockBandDetail('cobble', null), 'group=cobble town=- band=unknown low=256 target=1000 high=1000')
})
await t('wiring: a town deposit that named cobble writes _stock_band of a COMPLETE count; the bank rows are unchanged; the licence row at spawn', () => {
  const sk = strip(readFileSync(path.join(SRC, 'skills.mjs'), 'utf8'))
  assert.match(sk, /kind: 'stock_band', status: 'success', snapshot: snapshot\(bot\), detail: stockBandDetail\('cobble', after\.complete \? after\.lb : null\)/)
  assert.doesNotMatch(sk, / band=\$\{bandOf/, 'the anchored bank-row formats stay as they were (cobble-rule.test)')
  assert.match(strip(readFileSync(path.join(SRC, 'features.mjs'), 'utf8')), /kind: 'marks_mode'[^\n]*marksModeDetail\(\)/)
})

// mutants: each decision line of the table, anchored
async function withMutant (old, neu, probe) {
  const p = path.join(SRC, 'stocktarget.mjs')
  const src = readFileSync(p, 'utf8')
  assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE: ${old.slice(0, 70)}`)
  const tmp = path.join(SRC, `_mut_${process.pid}_stocktarget.mjs`)
  writeFileSync(tmp, src.replace(old, neu))
  try { const M = await import(`${tmp}?${Date.now()}_${Math.random()}`); try { probe(M); return false } catch { return true } } finally { unlinkSync(tmp) }
}
await t('mutants killed (anchors present and unique)', async () => {
  const R = [
    await withMutant("    if (v < m.low) replenish = true\n    else if (v >= m.target) replenish = false", "    if (v < m.low) replenish = true\n    else if (v >= m.low) replenish = false", M => { assert.equal(M.latchStep({ replenish: true }, 'cobble', 600).replenish, true) }),
    await withMutant("    else if (v <= Math.max(0, m.high - 64)) dispose = false", "    else if (v <= m.high) dispose = false", M => { assert.equal(M.latchStep({ dispose: true }, 'cobble', 960).dispose, true) }),
    await withMutant("    else if (v <= Math.max(0, m.high - 64)) dispose = false", "    else if (v <= m.high - 64) dispose = false", M => { assert.equal(M.latchStep({ dispose: true }, 'dirt', 0).dispose, false) }),
    await withMutant("  } else dispose = false", "  }", M => { assert.equal(M.latchStep({ dispose: true }, 'cobble', null).dispose, false) }),
    await withMutant("  if (n == null || !Number.isFinite(Number(n))) return 'unknown'", "", M => { assert.equal(M.bandOf('cobble', null), 'unknown') }),
    await withMutant("  if (v <= m.high) return 'target_high'", "", M => { assert.equal(M.bandOf('cobble', 1000), 'target_high') }),
    await withMutant("const LOWS = { cobble: BUILD_RESERVE.cobblestone,", "const LOWS = { cobble: 0,", M => { assert.equal(M.MARKS.cobble.low, 256) }),
  ]
  assert.ok(R.every(Boolean), `killed ${R.filter(Boolean).length}/${R.length}`)
  console.log(`  mutants killed ${R.filter(Boolean).length}/${R.length}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
