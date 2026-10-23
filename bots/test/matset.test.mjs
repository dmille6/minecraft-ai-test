// matset-01 (building tier §3.4, OWNER 10-23; tier 1, constants only): the sand target, glass off the junk list, the
// building parts protected / untargeted / always banked, the building stones off the pathfinder's scaffold list, and the
// BUILD_RESERVE declared. Behaviour through the real exported decisions; each negative has its positive control beside it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-matset-logs-'))
process.env.BOT_NAME = 'MatsetBot'
const ST = await import('../src/stocktarget.mjs')
const W = await import('../src/well.mjs')
const B = await import('../src/bankable.mjs')
const S = await import('../src/scaffold.mjs')
const P = await import('../src/prune.mjs')
const TD = await import('../src/towndeposit.mjs')
const { scaffoldCount } = await import('../src/exit-contract.mjs')
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.8')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`)
  }
}
const it = (name, count, slot) => ({ name, count, slot })
// one stack of each kind of part, and every name of the list somewhere in the suite
const BAG_PARTS = ['stone_bricks', 'stone_brick_slab', 'stone_brick_stairs', 'stone_brick_wall', 'glass', 'glass_pane',
  'cut_copper', 'waxed_oxidized_cut_copper_stairs', 'copper_door', 'copper_block', 'weathered_copper']

await t('the parts list is EXACTLY the regex\'s match set in minecraft-data 1.21.8 (both directions), 46 names, each a real item', () => {
  const byRe = Object.keys(REG.itemsByName).filter(n => ST.PROJECT_PART_RE.test(n)).sort()
  assert.ok(byRe.length > 40, 'positive control: the regex finds the copper family in the registry')
  assert.deepEqual([...ST.PROJECT_PARTS].sort(), byRe)
  assert.equal(new Set(ST.PROJECT_PARTS).size, 46)
  for (const n of ST.PROJECT_PARTS) assert.ok(REG.itemsByName[n], `${n} is a real item`)
})

await t('every part: PROTECTED, never well junk, no stock target, always banked (DEPOSIT_ALWAYS); stained glass is still junk', () => {
  for (const n of ST.PROJECT_PARTS) {
    assert.ok(ST.isProtected(n), `${n} protected`)
    assert.equal(W.isWellJunk(n), false, `${n} is not well junk`)
    assert.equal(ST.isTargeted(n), false, `${n} has no stock target`)
    assert.ok(B.DEPOSIT_ALWAYS.includes(n), `${n} always banked`)
  }
  // positive controls: the same predicates still say yes where they should
  assert.ok(W.isWellJunk('white_stained_glass') && W.isWellJunk('lime_stained_glass_pane') && W.isWellJunk('mossy_stone_bricks'))
  assert.ok(ST.isProtected('iron_ingot') && !ST.isProtected('cobblestone') && !ST.isProtected('white_stained_glass'))
  assert.ok(!W.DECORATIONS.includes('glass') && !W.DECORATIONS.includes('glass_pane') && W.DECORATIONS.includes('white_stained_glass'))
})

await t('sand: target 64 (was 0); below it the town has room and sand is banked; at it the room is 0', () => {
  assert.equal(ST.targetOf('sand'), 64)
  assert.equal(ST.groupOf('red_sand'), 'sand')
  assert.equal(ST.roomUnder({ lb: 0, complete: true }, ST.targetOf('sand')), 64)
  assert.equal(ST.roomUnder({ lb: 64, complete: true }, ST.targetOf('sand')), 0)
  assert.equal(ST.provenAtTarget({ lb: 10 }, ST.targetOf('sand')), false, 'below 64: not at target, so the well does not take it')
  assert.equal(ST.provenAtTarget({ lb: 10 }, 0), true, 'positive control: target 0 is always at target (the old rule)')
  assert.ok(B.DEPOSIT_ALWAYS.includes('sand') && B.DEPOSIT_ALWAYS.includes('red_sand'), 'sand has a bank route')
})

// A FULL BAG IN A TOWN AT EVERY CAP (§3.4's test): every group proven at target, a usable well, the bag full.
const AT_CAP = g => ({ lb: Math.max(ST.targetOf(g), 1) * 2, complete: true, reserved: 0, floor: 0, avail: Math.max(ST.targetOf(g), 1) * 2 })
const fullBag = () => {
  const bag = BAG_PARTS.map((n, i) => it(n, 16, 9 + i))
  let s = 9 + bag.length
  bag.push(it('white_wool', 12, s++), it('sand', 64, s++), it('sand', 64, s++), it('oak_log', 64, s++), it('oak_log', 64, s++), it('oak_log', 64, s++))
  while (bag.length < 36) bag.push(it('cobblestone', 64, s++))
  return bag
}
const atCapStock = (bag) => ({ groups: ST.STOCK_GROUP_NAMES.filter(g => bag.some(x => ST.groupOf(x.name) === g)), keeps: TD.townKeeps(Object.fromEntries(bag.map(x => [x.name, bag.filter(y => y.name === x.name).reduce((a, y) => a + y.count, 0)]))).keep, holds: {} })

await t('FULL BAG AT EVERY CAP: the well takes the junk and the at-target surplus, and NOT ONE part', () => {
  const bag = fullBag()
  assert.equal(bag.length, 36)
  const plan = W.disposePlan(bag, { maxStacks: 36, cobbleAtCap: true, stock: atCapStock(bag) })
  const gone = new Set(plan.stacks.map(s => s.name))
  assert.ok(gone.has('white_wool'), 'positive control: plain junk goes')
  assert.ok(gone.has('oak_log') || gone.has('sand'), 'positive control: at-target surplus goes')
  for (const n of BAG_PARTS) assert.ok(!gone.has(n), `${n} went down the well`)
})

await t('PRUNE: a town container\'s junk take never pulls a part; the junk it holds still goes', () => {
  const box = [...BAG_PARTS.map((n, i) => it(n, 64, i)), it('white_wool', 20, 40), it('lead', 3, 41)]
  const took = P.pruneTakes(box, [{ group: 'junk', stacks: 20 }], { isJunk: W.isWellJunk }).map(x => x.name)
  assert.deepEqual(took.sort(), ['lead', 'white_wool'], 'positive control: the junk is taken; no part is')
})

await t('TOWN DEPOSIT, FULL BAG AT EVERY CAP: each part is banked; the at-target groups are refused', () => {
  try {
    B.setStockReaders({ town: AT_CAP, well: () => true })
    const bag = fullBag()
    const plan = TD.townDepositPlan(bag, { noSwords: false })
    for (const n of BAG_PARTS) assert.ok(plan.banked[n] > 0, `${n} not banked (why: ${plan.why[n] ?? B.bankableInventory(bag, { wants: B.DEPOSIT_ALWAYS }).excluded[n]})`)
    assert.ok(!plan.banked.oak_log && !plan.banked.sand, 'positive control: the at-cap town refuses logs and sand')
  } finally { B.setStockReaders({ town: null, well: null }) }
})

await t('TOWN DEPOSIT, a town with no sand: sand is banked up to the room (64), not left in the bag', () => {
  try {
    B.setStockReaders({ town: g => g === 'sand' ? { lb: 0, complete: true, reserved: 0, floor: 0, avail: 0 } : AT_CAP(g), well: () => true })
    const bag = [it('sand', 64, 9), it('sand', 64, 10)]
    while (bag.length < 36) bag.push(it('cobblestone', 64, 9 + bag.length))
    const plan = TD.townDepositPlan(bag, { noSwords: false })
    assert.equal(plan.banked.sand, 64, 'one whole stack: the room is 64 and the bag keeps the gather rung\'s 8 ' + JSON.stringify(plan.why))
    // positive control: the room really binds -- a town already at 64 takes none
    B.setStockReaders({ town: AT_CAP, well: () => true })
    assert.ok(!TD.townDepositPlan(bag, { noSwords: false }).banked.sand)
  } finally { B.setStockReaders({ town: null, well: null }) }
})

await t('the pathfinder no longer spends a building stone; nothing that counts scaffold disagrees (no new dead end)', () => {
  const ids = []
  const added = S.extendScaffolding({ scafoldingBlocks: ids }, REG)
  const names = ids.map(i => REG.items[i].name)
  assert.ok(added > 20 && names.includes('andesite') && names.includes('oak_planks'), 'positive control: the list is pushed')
  for (const n of ['stone_bricks', 'smooth_stone']) {
    assert.ok(!names.includes(n), `${n} is pathfinder scaffold`)
    assert.equal(B.isScaffoldItem(n), false, `${n} is in the deposit's scaffold reserve`)
    assert.equal(scaffoldCount([{ name: n, count: 9 }]), 0, `${n} counts toward the exit contract`)
  }
  assert.equal(scaffoldCount([{ name: 'cobblestone', count: 9 }]), 9, 'positive control: the exit contract counts')
})

await t('BUILD_RESERVE: declared, the OWNER 10-23 table (cobble 256, logs 512, copper 512, torch 32, sand 16, planks 71, sticks 40), frozen; nothing in src reads it yet (mats-01 does)', () => {
  assert.deepEqual(ST.BUILD_RESERVE, { cobblestone: 256, logs: 512, planks: 71, sticks: 40, copper_ingot: 512, sand: 16, torch: 32 })
  assert.ok(Object.isFrozen(ST.BUILD_RESERVE))
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const dir = new URL('../src/', import.meta.url)
  const readers = fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && f !== 'stocktarget.mjs')
    .filter(f => strip(fs.readFileSync(new URL(f, dir), 'utf8')).includes('BUILD_RESERVE'))
  assert.ok(strip(fs.readFileSync(new URL('stocktarget.mjs', dir), 'utf8')).includes('export const BUILD_RESERVE'), 'positive control: the scan sees the declaration')
  assert.deepEqual(readers, [])
})

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
process.exit(fail ? 1 : 0)
