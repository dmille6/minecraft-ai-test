// BAGDIET-01: the light projects' visit hold, their bank-back gate, and the craft's table candidates (shop.mjs needFromTown /
// bankBackDue, workbench.mjs tableCandidates, skills.mjs wiring). Behaviour for the pure functions; STRUCTURAL source
// assertions only for the wiring (comments stripped, anchored on executable lines), each shown to fail by an anchored mutant.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const S = await import('../src/shop.mjs')
const W = await import('../src/workbench.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const WB_PATH = new URL('../src/workbench.mjs', import.meta.url)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')

// ---- the hold ---------------------------------------------------------------------------------------------------------------
const holdBehaves = mod => {
  // the measured case: a 2,000-block open bill, a bag already holding 424 spare cobblestone -> nothing is drawn
  assert.deepStrictEqual(mod.needFromTown({ cobblestone: 2000 }, { cobblestone: 424 }, mod.SHOP_BILL_CAP, mod.PROJECT_VISIT_HOLD), {})
  // a bag short of a visit's worth draws up to the hold, not up to the cap
  assert.deepStrictEqual(mod.needFromTown({ cobblestone: 2000 }, { cobblestone: 10 }, mod.SHOP_BILL_CAP, mod.PROJECT_VISIT_HOLD), { cobblestone: 54 })
  // a small bill below the hold is the bill less the bag, as before
  assert.deepStrictEqual(mod.needFromTown({ cobblestone: 20, torch: 3 }, { cobblestone: 5 }, mod.SHOP_BILL_CAP, mod.PROJECT_VISIT_HOLD), { cobblestone: 15, torch: 3 })
}
console.log('THE VISIT HOLD (shop.mjs needFromTown)')
await t('a bag holding a visit\'s worth draws nothing; a short bag draws to the hold, never to the cap', () => holdBehaves(S))
await t('the hold is one stack, and covers the largest visit measured (62 placed)', () => { assert.strictEqual(S.PROJECT_VISIT_HOLD, 64); assert.ok(S.PROJECT_VISIT_HOLD >= 62) })
await t('control: without a hold (the workshop/house visits) the bill is drawn to SHOP_BILL_CAP exactly as before', () => {
  assert.deepStrictEqual(S.needFromTown({ cobblestone: 2000 }, { cobblestone: 424 }), { cobblestone: S.SHOP_BILL_CAP })
  assert.deepStrictEqual(S.needFromTown({ stone_bricks: 100, cut_copper: 200 }, {}), { cut_copper: 200, stone_bricks: 56 })
})
await t('a bad hold (negative, NaN) reads as no hold, never as a zero that starves the build', () => {
  assert.deepStrictEqual(S.needFromTown({ cobblestone: 30 }, {}, 256, -1), { cobblestone: 30 })
  assert.deepStrictEqual(S.needFromTown({ cobblestone: 30 }, {}, 256, NaN), { cobblestone: 30 })
})
await t('MUTANT KILLED: the bill unclamped (the base) draws 256 into a bag holding 424', async () => {
  await withMutant(SHOP_PATH, 'const want = Math.max(0, Math.min(c, h) - (Number(bag[n]) || 0))', 'const want = Math.max(0, c - (Number(bag[n]) || 0))', async mod => {
    assert.throws(() => holdBehaves(mod))
  })
})

// ---- the bank-back gate ------------------------------------------------------------------------------------------------------
console.log('THE BANK-BACK GATE (shop.mjs bankBackDue)')
const gateBehaves = mod => {
  // the fleet's monument visit: a 180 s budget, stopped at 120 s by ZIG_VISIT_TAIL_MS -> 60 s left: the bank runs
  assert.strictEqual(mod.bankBackDue(180_000, 120_000), true)
  assert.strictEqual(mod.bankBackDue(180_000, 150_000), false)
  assert.strictEqual(mod.bankBackDue(180_000, 140_000), true)
}
await t('60 s left of a 180 s visit banks back; 30 s left does not', () => gateBehaves(S))
await t('control: the old gate (SHOP_BANK_MIN_MS) refused the same visit -- why 473 visits banked back 0', () => {
  assert.strictEqual(S.bankBackDue(180_000, 120_000, S.SHOP_BANK_MIN_MS), false)
  assert.ok(S.LIGHT_BANK_MIN_MS < 60_000, 'the light gate fits inside ZIG_VISIT_TAIL_MS')
})
await t('a non-finite clock never banks (fail closed)', () => { assert.strictEqual(S.bankBackDue(NaN, 0), false); assert.strictEqual(S.bankBackDue(180_000, undefined), false) })
await t('MUTANT KILLED: the gate at SHOP_BANK_MIN_MS (the base) never banks a fleet visit', async () => {
  await withMutant(SHOP_PATH, 'export const LIGHT_BANK_MIN_MS = 40_000', 'export const LIGHT_BANK_MIN_MS = 150_000', async mod => { assert.throws(() => gateBehaves(mod)) })
})

// ---- the table candidates ----------------------------------------------------------------------------------------------------
console.log('THE TABLE CANDIDATES (workbench.mjs tableCandidates)')
const blk = (x, y, z) => ({ position: { x, y, z } })
const candBehaves = mod => {
  const a = blk(1, 64, 0), b = blk(5, 64, 0), c = blk(9, 64, 0), d = blk(20, 64, 0)
  const dist = q => q.position.x
  const got = mod.tableCandidates([d, c, a, b, a], dist)
  assert.deepStrictEqual(got.map(q => q.position.x), [1, 5, 9], 'nearest three, deduplicated')
}
await t('the three nearest tables, nearest first, each once', () => candBehaves(W))
await t('one table found: just it; none: none', () => {
  assert.deepStrictEqual(W.tableCandidates([blk(3, 64, 3)], () => 1).length, 1)
  assert.deepStrictEqual(W.tableCandidates([], () => 1), [])
  assert.deepStrictEqual(W.tableCandidates(null, () => 1), [])
})
await t('a candidate whose distance cannot be read is dropped, not tried first', () => {
  const got = W.tableCandidates([blk(1, 1, 1), blk(2, 2, 2)], q => (q.position.x === 1 ? NaN : 4))
  assert.deepStrictEqual(got.map(q => q.position.x), [2])
})
await t('MUTANT KILLED: one candidate (the base\'s nearest only)', async () => {
  await withMutant(WB_PATH, 'export const TABLE_TRIES = 3', 'export const TABLE_TRIES = 1', async mod => { assert.throws(() => candBehaves(mod)) })
})

// ---- the wiring (structural: what behaviour cannot reach from here) ----------------------------------------------------------
console.log('THE WIRING (skills.mjs)')
const SK = strip(readFileSync(SKILLS_PATH, 'utf8'))
const holdCalls = s => (s.match(/needFromTown\([^)]*, SHOP_BILL_CAP, PROJECT_VISIT_HOLD\)/g) ?? []).length
const gateCalls = s => (s.match(/if \(left\.length && bankBackDue\(budget, Date\.now\(\) - t0, LIGHT_BANK_MIN_MS\)\)/g) ?? []).length
await t('the monument and the tree farm draw under the hold (two calls); the workshop/house visit does not', () => {
  assert.strictEqual(holdCalls(SK), 2)
  assert.strictEqual((SK.match(/const need = needFromTown\(want, spare0\)\n/g) ?? []).length, 1, 'the workshop/house call keeps no hold')
})
// roads-01: the road's visit (skills.mjs buildRoad) uses the light gate too -- four
await t('the monument, wall, tree-farm and road bank-backs use the light gate (four); the workshop keeps its own', () => {
  assert.strictEqual(gateCalls(SK), 4)
  assert.strictEqual((SK.match(/if \(left\.length && SHOP_SKILL_MS - \(Date\.now\(\) - t0\) >= SHOP_BANK_MIN_MS\)/g) ?? []).length, 1)
})
await t('the craft tries tableCandidates before the carried table', () => {
  assert.ok(/nearTables = tableCandidates\(\[\.\.\.nearTables, \.\.\.more\], b => \(me \? me\.distanceTo\(b\.position\) : 0\), \{ max: TABLE_TRIES \}\)/.test(SK))
  assert.ok(/const tableTries = preferWorkshop\(\[\.\.\.wsTables, \.\.\.nearTables\]\.filter\(Boolean\)/.test(SK))
})
await t('MUTANTS KILLED: the wiring checks fail on the base\'s source', () => {
  const src = readFileSync(SKILLS_PATH, 'utf8')
  const a = '    const need = needFromTown(want, spare0, SHOP_BILL_CAP, PROJECT_VISIT_HOLD)'
  assert.strictEqual(src.split(a).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.strictEqual(holdCalls(strip(src.replace(a, '    const need = needFromTown(want, spare0)'))), 1)
  const g = '    if (left.length && bankBackDue(budget, Date.now() - t0, LIGHT_BANK_MIN_MS)) { try { back = await matsBank(ctx, left, held0, signal, caps, {'
  assert.strictEqual(src.split(g).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.strictEqual(gateCalls(strip(src.replace(g, '    if (left.length && budget - (Date.now() - t0) >= SHOP_BANK_MIN_MS) { try { back = await matsBank(ctx, left, held0, signal, caps, {'))), 3)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
