// SAPLINGKEEP-01SHOW (11-20): the yard's chest row banked saplings down to 4 a species, under planting's floor (workorder.mjs
// PLANT_RESERVE 8: a species is planted only when held ABOVE it), so planting stopped (117 banked 13:53-14:34Z; plant orders 6-16/h
// to ~0). The row now keeps composter.mjs SAPLING_RESERVE (16) a species, and that keep is hard: the partial-slot rule at 30+ kinds
// never lowers it. Behaviour first (the keep, the plan, the composed chain row -> planting), then anchored mutants, then the wiring.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-saplingkeep-${process.pid}`
process.env.BOT_NAME = 'TestBot'

const Y = await import('../src/yard.mjs')
const { PLANT_RESERVE, plantingOrder } = await import('../src/workorder.mjs')
const { SAPLING_RESERVE } = await import('../src/composter.mjs')

let failed = 0
const t = async (name, fn) => { try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e?.stack ?? e}`) } }
const P = n => new URL(`../src/${n}.mjs`, import.meta.url)
// withMutant as climb-escape.test.mjs / yardlanes.test.mjs: the anchor must be present AND unique, or the mutant reads as killed.
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))} in ${path.pathname} (a mutant that was never written reads as killed)`)
  const out = new URL(`../src/_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async (path, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(path, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const ON = Y.laneSettings({ YARD: 'on' })
const SAPLINGS = ['oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'pale_oak_sapling', 'mangrove_propagule']
const ROW_AT = [5, 71, 1]
const PLAN0 = { held: { spruce_sapling: 20 }, keeps: {}, rows: [{ at: ROW_AT, kind: 'sapling' }], cells: [], carried: 0, lanes: ON }
const SPOT = { x: 0, y: 64, z: 0 }
// THE CHAIN: a bag of 20 goes through the row's plan; what is left is what planting sees.
const leftAfterRow = (M, held) => {
  const banked = M.rowPlan({ ...PLAN0, held, pressed: true }).bank.flatMap(b => Object.entries(b.names))
  const left = { ...held }
  for (const [n, k] of banked) left[n] -= k
  return left
}
const scenarioKeep = M => {
  for (const n of SAPLINGS) assert.ok(M.rowKeepOf(n) > PLANT_RESERVE, `${n}: the row keeps ${M.rowKeepOf(n)}, planting needs more than ${PLANT_RESERVE}`)
  const left = leftAfterRow(M, { spruce_sapling: 20 })
  assert.ok(plantingOrder({ saplings: left, spot: SPOT, now: 1e12, lastPlantedAt: 0 }), `after the row step the bag holds ${left.spruce_sapling}: planting must still fire`)
}
const scenarioHard = M => {
  const full = { slots: 31, copies: 1, total: 10, stack: 64, trim: true }
  assert.equal(M.rowPartialKeep('spruce_sapling', full), 16, 'a sapling keep is hard at 30+ kinds')
}

await t('the keep: every sapling species and the propagule keep SAPLING_RESERVE (16), above PLANT_RESERVE (8); the other row keeps unchanged', () => {
  assert.equal(SAPLING_RESERVE, 16)
  assert.equal(Y.ROW_BAG_KEEP.sapling, SAPLING_RESERVE, 'one constant: the row and the composter cannot drift')
  for (const n of SAPLINGS) { assert.equal(Y.rowKeepOf(n), SAPLING_RESERVE, n); assert.ok(Y.rowKeepOf(n) > PLANT_RESERVE, n) }
  assert.deepEqual(['wheat_seeds', 'sugar_cane', 'stick', 'iron_nugget', 'clay_ball', 'dirt'].map(Y.rowKeepOf), [16, 16, 8, 0, 0, 0])
})

await t('the plan: a 20-sapling bag banks only 4 (pressed); unpressed, 4 above the keep is under rowMin and nothing goes', () => {
  const p = Y.rowPlan({ ...PLAN0, pressed: true })
  assert.deepEqual(p.bank, [{ kind: 'sapling', at: ROW_AT, names: { spruce_sapling: 4 } }])
  assert.equal(Y.rowPlan(PLAN0).bank.length, 0, '4 above the keep, rowMin 8')
  // positive control: the same plan does bank, and a bag at the keep banks nothing even pressed
  assert.deepEqual(Y.rowPlan({ ...PLAN0, held: { spruce_sapling: 40 } }).bank[0].names, { spruce_sapling: 24 })
  assert.equal(Y.rowPlan({ ...PLAN0, held: { spruce_sapling: 16 }, pressed: true }).bank.length, 0)
  // two species: each keeps its own 16
  assert.deepEqual(Y.rowPlan({ ...PLAN0, held: { spruce_sapling: 20, oak_sapling: 30 }, pressed: true }).bank[0].names, { spruce_sapling: 4, oak_sapling: 14 })
})

await t('the steps: 20 in a bag with 4 to bank keeps 16 (whole stacks only while the keep stays)', async () => {
  const TDm = await import('../src/towndeposit.mjs')
  const bag = [{ name: 'spruce_sapling', count: 4, slot: 9 }, { name: 'spruce_sapling', count: 16, slot: 10 }]
  assert.deepEqual(Y.rowSteps(bag, { spruce_sapling: 4 }, {}, TDm.logHalfSteps).map(s => [s.slot, s.count]), [[9, 4]])
})

await t('THE CHAIN: row step then planting -- after banking, a 20-sapling bag still plants', () => {
  scenarioKeep(Y)
  // positive control: planting does refuse at or below its floor, so the chain is what keeps it on
  assert.equal(plantingOrder({ saplings: { spruce_sapling: PLANT_RESERVE }, spot: SPOT, now: 1e12 }), null)
})

await t('THE HARD KEEP: at 30+ kinds the partial-slot rule lowers seeds and sticks but never a sapling below 16', () => {
  const full = { slots: 31, copies: 1, total: 10, stack: 64, trim: true }
  for (const n of SAPLINGS) assert.equal(Y.rowPartialKeep(n, full), 16, n)
  assert.equal(Y.rowPartialKeep('wheat_seeds', full), 0, 'the other keeps still lower')
  assert.equal(Y.rowPartialKeep('stick', { ...full, total: 5 }), 0)
  assert.equal(Y.rowPartialKeep('wheat_seeds', { ...full, slots: 29 }), 16, 'under 30 kinds the keep stands')
  assert.equal(Y.rowPartialKeep('wheat_seeds', { ...full, trim: false }), 16, 'the trim off: no lowering')
  assert.equal(Y.rowPartialKeep('clay_ball', full), 0)
  // composed with the plan: the lowered keeps go into rowPlan as the caller's (yardRowKeepsNow) and saplings stay
  const keeps = { spruce_sapling: Y.rowPartialKeep('spruce_sapling', full), wheat_seeds: Y.rowPartialKeep('wheat_seeds', full) }
  const p = Y.rowPlan({ ...PLAN0, held: { spruce_sapling: 10, wheat_seeds: 10 }, keeps, rows: [...PLAN0.rows, { at: [7, 71, 1], kind: 'wheat_seeds' }], pressed: true })
  assert.deepEqual(p.bank.map(b => [b.kind, b.names]), [['wheat_seeds', { wheat_seeds: 10 }]])
  scenarioHard(Y)
})

await t('MUTANT KILLED: the row keep back to 4 a species starves planting', async () => {
  await killedBy(P('yard'), Y, 'sapling: SAPLING_RESERVE })', 'sapling: 4 })', scenarioKeep)
})

await t('MUTANT KILLED: the sapling keep not hard lets the partial-slot rule bank it', async () => {
  await killedBy(P('yard'), Y, 'hard: ROW_HARD_KINDS.has(rowKindOf(name))', 'hard: false', scenarioHard)
})

await t('WIRED: yardRowKeepsNow takes the row keep through rowPartialKeep (no bare partialKeep on rowKeepOf left in skills.mjs)', () => {
  const sk = strip(readFileSync(P('skills'), 'utf8'))
  const body = sk.slice(sk.indexOf('function yardRowKeepsNow'), sk.indexOf('function yardRowPlanNow'))
  assert.ok(body.length > 100, 'yardRowKeepsNow found')
  assert.equal((body.match(/out\[name\] = rowPartialKeep\(name, \{/g) ?? []).length, 1)
  assert.equal((sk.match(/keep: rowKeepOf\(name\)/g) ?? []).length, 0)
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')
