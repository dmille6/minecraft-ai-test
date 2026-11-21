// STEPWELL-04SHOW (control session 11-21): THE JUNK WELL JUDGES EACH COBBLE NAME ON ITS OWN COUNT. (well.mjs setCobbleOwnCount /
// ownAtCap / cobbleOwnAtCap / cobbleMayGo / cobbleWellStacks `names` / disposePlan; skills.mjs wellOwnCobble, the throw's click check.)
// LIVE showcase: the cap's proof counts the group `cobble` (cobblestone + cobbled_deepslate SUMMED), so 2,002 deepslate made the town
// read "full" at 46 cobblestone and the well threw 3,068 cobble from 11-20 09:51Z while the step well starved for trim. Now a stack
// goes only when the group's proof says at_cap AND its own name's town count is at TOWN_COBBLE_CAP: the town of 46 cobblestone and
// 2,002 deepslate throws no cobblestone, and still throws the deepslate above its own cap. Anchored mutants restore the sum.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const W = await import('../src/well.mjs')
const { TOWN_COBBLE_CAP } = await import('../src/stocktarget.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const WELL_PATH = new URL('../src/well.mjs', import.meta.url)
// withMutant: bots/test/climb-escape.test.mjs's (the anchor present AND unique, or the mutant is never written)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')

// THE SHOWCASE TOWN (the town index 11-21) and a bag with two stacks of each name (256 cobble: the bag's 64 kept of the two)
const TOWN = { cobblestone: 46, cobbled_deepslate: 2002 }
const BAG = () => [
  { slot: 9, name: 'cobblestone', count: 64 }, { slot: 10, name: 'cobblestone', count: 64 },
  { slot: 11, name: 'cobbled_deepslate', count: 64 }, { slot: 12, name: 'cobbled_deepslate', count: 64 },
]
const thrown = (M, town, bag = BAG()) => {
  M.setCobbleOwnCount(town === undefined ? null : n => (town === null ? null : town[n] ?? 0))
  try { return M.disposePlan(bag, { cobbleAtCap: true }).stacks.map(s => s.name) } finally { M.setCobbleOwnCount(null) }
}
const count = (names, n) => names.filter(x => x === n).length

console.log('THE RULE (disposePlan, the chest cap proven for the group)')
await t('POSITIVE CONTROL (no install = the base): the summed proof throws the cobblestone with the deepslate', () => {
  const out = thrown(W, undefined)
  assert.ok(count(out, 'cobblestone') > 0, `cobblestone thrown: ${out}`)
  assert.ok(count(out, 'cobbled_deepslate') > 0)
})
await t('the town of 46 cobblestone and 2,002 deepslate: NO cobblestone thrown; the deepslate above its own cap still is', () => {
  const out = thrown(W, TOWN)
  assert.strictEqual(count(out, 'cobblestone'), 0)
  assert.strictEqual(count(out, 'cobbled_deepslate'), 2, `both deepslate stacks: ${out}`)
})
await t('deepslate keeps its own cap: under it, none goes; cobblestone at its own cap goes', () => {
  assert.deepStrictEqual(thrown(W, { cobblestone: TOWN_COBBLE_CAP, cobbled_deepslate: TOWN_COBBLE_CAP - 1 }).sort(), ['cobblestone', 'cobblestone'])
  assert.deepStrictEqual(thrown(W, { cobblestone: 46, cobbled_deepslate: 900 }), [])
})
await t('the bag still keeps its 64 of the two names together (the reserve is not split by name)', () => {
  const bag = [{ slot: 9, name: 'cobblestone', count: 50 }, { slot: 11, name: 'cobbled_deepslate', count: 51 }]   // ONYX
  assert.deepStrictEqual(thrown(W, TOWN, bag), [], '101 - 51 < 64: nothing goes')
})
await t('the index unread for a name (null): the group\'s proof stands for it, as before', () => {
  assert.ok(count(thrown(W, null), 'cobblestone') > 0)
})
await t('the chest cap not proven: nothing goes whatever the own counts', () => {
  W.setCobbleOwnCount(n => TOWN[n])
  try { assert.deepStrictEqual(W.disposePlan(BAG(), { cobbleAtCap: false }).stacks, []) } finally { W.setCobbleOwnCount(null) }
})
await t('ownAtCap / cobbleMayGo (pure): the click\'s rule is the plan\'s', () => {
  assert.strictEqual(W.ownAtCap(46), false)
  assert.strictEqual(W.ownAtCap(TOWN_COBBLE_CAP), true)
  assert.strictEqual(W.ownAtCap(null), true)
  W.setCobbleOwnCount(n => TOWN[n])
  try {
    assert.strictEqual(W.cobbleMayGo('cobblestone', true), false)
    assert.strictEqual(W.cobbleMayGo('cobbled_deepslate', true), true)
    assert.strictEqual(W.cobbleMayGo('cobbled_deepslate', false), false)
    assert.strictEqual(W.cobbleMayGo('dirt', true), false)
  } finally { W.setCobbleOwnCount(null) }
  W.setCobbleOwnCount(() => { throw new Error('index') })
  try { assert.strictEqual(W.cobbleMayGo('cobblestone', true), true, 'a hook that throws: the group\'s proof') } finally { W.setCobbleOwnCount(null) }
})

console.log('MUTANTS (each anchor asserted present and unique)')
await t('MUTANT KILLED: the plan restores the sum (both names at the group\'s cap) -> cobblestone thrown at 46', async () => {
  await withMutant(WELL_PATH, 'const capNames = [...WELL_COBBLE].filter(n => cobbleMayGo(n, cobbleAtCap))', "const capNames = (cobbleAtCap || yardFull('cobblestone')) ? [...WELL_COBBLE] : []", async M => {
    assert.ok(count(thrown(M, TOWN), 'cobblestone') > 0)
  })
})
await t('MUTANT KILLED: the own count ignored (every name at its cap) -> cobblestone thrown at 46', async () => {
  await withMutant(WELL_PATH, 'Number(own) >= cap', 'true', async M => {
    assert.ok(count(thrown(M, TOWN), 'cobblestone') > 0)
  })
})
await t('MUTANT KILLED: the own cap dropped from the click\'s rule', async () => {
  await withMutant(WELL_PATH, '((!!atCap && cobbleOwnAtCap(name)) ||', '((!!atCap) ||', async M => {
    M.setCobbleOwnCount(n => TOWN[n])
    try { assert.strictEqual(M.cobbleMayGo('cobblestone', true), true) } finally { M.setCobbleOwnCount(null) }
  })
})

console.log('THE WIRING (structural: skills.mjs)')
const SKS = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const WIRES = [
  ['the throw\'s click asks the name\'s own cap', /if \(acc\.capLast !== 'at_cap'\) continue\n\s*if \(!wellCobbleMayGo\(it\.name, true\)\) continue/],
  ['the per-name count is installed on every bot', /try \{ setCobbleOwnCount\(name => wellOwnCobble\(activeMem\?\.bot \?\? null, name\)\) \}/],
  ['the count is the town index\'s known stock', /const n = ts && ts\.known > 0 \? \(Number\(ts\.stock\?\.\[name\]\) \|\| 0\) : null/],
]
for (const [name, re] of WIRES) {
  await t(`skills: ${name} (and a one-character mutant of it is not matched)`, () => {
    assert.ok(re.test(SKS), 'wired')
    const m = SKS.match(re)[0]
    assert.strictEqual(SKS.split(m).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
    assert.ok(!re.test(SKS.replace(m, m.replace(/[A-Za-z]/, '#'))), 'a one-character mutant of the executable line is not matched')
  })
}

console.log(`\nwellcap-own: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
