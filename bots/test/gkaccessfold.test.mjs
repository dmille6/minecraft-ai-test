// THE SHOWCASE GKACCESS FOLD (gkhandover-01 + access-01 onto batch 4 d3773f8b; Codex fold review BLOCKER): access-01's staircases keep
// off a build's way in by its record's `door` / `frontOpen` -- a storage-hall record (storehub-ab) names neither, so a dirt climb before
// the hall's doorway could become a permanent stone staircase across it. The hall's doorway columns and the approach before them
// (storehub.mjs hubEntranceCols) now refuse a staircase. Anchored mutant.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const TD = await import('../src/tidy.mjs')
const SH = await import('../src/storehub.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const SRC = new URL('../src/tidy.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(SRC, 'utf8')
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// a hall at the design's site (x -21..-3, z -49..-39), facing home (v < 0 toward z > -39: orient 'N' maps v -> dx, u -> -dz)
const hall = orient => ({ plot: 'storehub', blueprint: SH.HUB_BLUEPRINT, anchor: [-21, -39], orient, s: 70, cells: [{ at: [-21, 70, -49] }, { at: [-3, 70, -39] }] })
await t('the doorway and the approach before it refuse a staircase, for every orientation', () => {
  for (const o of ['N', 'E', 'S', 'W']) {
    const r = hall(o), ns = TD.accessNoStair([r])
    const cols = SH.hubEntranceCols(r)
    assert.strictEqual(cols.length, 5 * 5)
    for (const [x, z] of cols) assert.strictEqual(ns(x, z), true, `${o} ${x},${z}`)
  }
})
await t('POSITIVE CONTROL: a column well away from the hall (and from its footprint box) is no refusal', () => {
  assert.strictEqual(TD.accessNoStair([hall('N')])(40, 40), false)
  assert.deepStrictEqual(SH.hubEntranceCols({ plot: 'house1', blueprint: 'house@1', anchor: [0, 0], orient: 'N' }), [], 'only a hall')
})
await t('MUTANT KILLED: without the hall\'s way in, the approach outside the pad takes a stair', async () => {
  await withMutant('    for (const c of hubEntranceCols(r)) cols.push(c)\n', '', async M => {
    const r = hall('E'), out = SH.hubEntranceCols(r).filter(([x, z]) => !(x >= -21 && x <= -3 && z >= -49 && z <= -39))
    assert.ok(out.length > 0, 'some approach columns lie outside the footprint box')
    assert.ok(out.some(([x, z]) => M.accessNoStair([r])(x, z) === false))
  })
})
// THE WALLEXT2 FOLD (enchantshop onto the live gkaccess fold; Codex fold BLOCKER): the enchanting workshop names no door either
const EN = await import('../src/enchantshop.mjs')
const shop = orient => ({ plot: 'enchantshop', blueprint: EN.ENCHANT_BLUEPRINT, anchor: [28, -75], orient, s: 70, cells: [{ at: [10, 70, -75] }, { at: [28, 70, -63] }] })
await t('the workshop\'s doorway and approach refuse a staircase, every orientation; Codex\'s X1 columns (19,-63..-61) among them', () => {
  for (const o of ['N', 'E', 'S', 'W']) {
    const r = shop(o), ns = TD.accessNoStair([r]), cols = EN.enchantEntranceCols(r)
    assert.strictEqual(cols.length, 5 * 5)
    for (const [x, z] of cols) assert.strictEqual(ns(x, z), true, `${o} ${x},${z}`)
  }
  assert.deepStrictEqual(EN.enchantEntranceCols({ blueprint: 'house@1', anchor: [0, 0], orient: 'N' }), [], 'only a workshop')
})
await t('MUTANT KILLED: without the workshop\'s way in, its approach outside the pad takes a stair', async () => {
  await withMutant('    for (const c of enchantEntranceCols(r)) cols.push(c)\n', '', async M => {
    const r = shop('N'), out = EN.enchantEntranceCols(r).filter(([x, z]) => !(x >= 10 && x <= 28 && z >= -75 && z <= -63))
    assert.ok(out.length > 0)
    assert.ok(out.some(([x, z]) => M.accessNoStair([r])(x, z) === false))
  })
})
// THE BATCH FOLD (townstyle-01's cottage onto the fold; Codex fold r7 BLOCKER): cottageEntranceCols existed but nothing read it
const CO = await import('../src/cottage.mjs')
await t('the cottage\'s doorway and approach refuse a staircase, every orientation (its blueprint\'s own helper, now wired)', async () => {
  const blueprint = 'cottage@1s'   // cottage.mjs isCottageBlueprint: cottage@1s / cottage@1f
  for (const o of ['N', 'E', 'S', 'W']) {
    const r = { plot: 'cottage1', blueprint, anchor: [0, -40], orient: o, s: 70, cells: [{ at: [0, 70, -40] }, { at: [6, 70, -34] }] }
    const cols = CO.cottageEntranceCols(r)
    assert.ok(cols.length > 0, `the helper knows ${blueprint}`)
    const ns = TD.accessNoStair([r])
    for (const [x, z] of cols) assert.strictEqual(ns(x, z), true, `${o} ${x},${z}`)
  }
})
await t('MUTANT KILLED: without the cottage\'s way in, its approach outside the footprint takes a stair', async () => {
  await withMutant('    for (const c of cottageEntranceCols(r)) cols.push(c)\n', '', async M => {
    const blueprint = 'cottage@1f'
    const r = { plot: 'cottage1', blueprint, anchor: [0, -40], orient: 'N', s: 70, cells: [{ at: [0, 70, -40] }, { at: [6, 70, -34] }] }
    const out = CO.cottageEntranceCols(r).filter(([x, z]) => !(x >= 0 && x <= 6 && z >= -40 && z <= -34))
    assert.ok(out.length > 0)
    assert.ok(out.some(([x, z]) => M.accessNoStair([r])(x, z) === false))
  })
})
// THE BATCH9 FOLD (townstyle-02's town hall; Codex fold BLOCKER): the town hall names no door either
const TH = await import('../src/townhall.mjs')
const thall = o => ({ plot: 'townhall', blueprint: TH.TOWNHALL_BLUEPRINT, anchor: [10, -30], orient: o, s: 70, cells: [{ at: [10, 70, -30] }, { at: [20, 70, -14] }] })
await t('the town hall\'s doorway, porch and approach refuse a staircase, every orientation', () => {
  for (const o of ['N', 'E', 'S', 'W']) {
    const r = thall(o), ns = TD.accessNoStair([r]), cols = TH.townhallEntranceCols(r)
    assert.strictEqual(cols.length, 5 * 6)
    for (const [x, z] of cols) assert.strictEqual(ns(x, z), true, `${o} ${x},${z}`)
  }
  assert.deepStrictEqual(TH.townhallEntranceCols({ blueprint: 'house@1', anchor: [0, 0], orient: 'N' }), [], 'only a town hall')
})
await t('MUTANT KILLED: without the town hall\'s way in, its approach outside the footprint takes a stair', async () => {
  await withMutant('    for (const c of townhallEntranceCols(r)) cols.push(c)\n', '', async M => {
    const r = thall('E'), out = TH.townhallEntranceCols(r).filter(([x, z]) => !(x >= 10 && x <= 20 && z >= -30 && z <= -14))
    assert.ok(out.length > 0)
    assert.ok(out.some(([x, z]) => M.accessNoStair([r])(x, z) === false))
  })
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
