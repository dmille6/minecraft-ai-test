// SHOP-01 STAGE C, THE WORKSHOP JOB'S POLICY AND WIRING (bots/src/shop.mjs; skills.mjs build_shop; cognitive.mjs; index.mjs).
// Behaviour for the pure policy (the order and its skips, the bill, spendableFor, the footprint price on work walks only, the
// pool's stood cells); STRUCTURAL source assertions for the wiring only behaviour cannot reach from here (the skill registered
// with its contract, the order and its decline refund in cognitive, the footprint price on the shared walk entries, the licence
// row) -- comments stripped first, anchored on executable lines, each shown to fail by a mutant of the source text.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const S = await import('../src/shop.mjs')
const R = await import('../src/buildrun.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const bp = JSON.parse(fs.readFileSync(new URL('../src/blueprints/workshop@1.json', import.meta.url), 'utf8'))

console.log('THE ORDER')
const base = { on: true, shared: true, atTown: true, holds: false, now: 1e9, state: {}, record: null, complete: false, slotsFree: true, health: 20, freeSlots: 20 }
await t('at town, shared, nothing held, slot and room: build_shop', () => assert.deepStrictEqual(S.buildOrder(base).order, { skill: 'build_shop', args: {} }))
await t('each refusal names its reason; away / isolated / a milestone holding / off issue nothing and say nothing', () => {
  for (const [patch, why] of [[{ complete: true }, 'complete'], [{ slotsFree: false }, 'slots_full'], [{ health: 8 }, 'health'], [{ freeSlots: 3 }, 'room']]) {
    const r = S.buildOrder({ ...base, ...patch })
    assert.strictEqual(r.order, null); assert.strictEqual(r.skip, why)
  }
  for (const patch of [{ atTown: false }, { shared: false }, { holds: true }, { on: false }, { planned: false }]) assert.deepStrictEqual(S.buildOrder({ ...base, ...patch }), { order: null, skip: null })
})
await t('the cooldown: inside it nothing; after it, the order (control)', () => {
  assert.strictEqual(S.buildOrder({ ...base, state: { lastAt: base.now - 1000 } }).order, null)
  assert.ok(S.buildOrder({ ...base, state: { lastAt: base.now - S.SHOP_COOLDOWN_MS - 1 } }).order)
})
await t('S1: no site waits a DAY (not the 10-min cooldown); with a record it is ordinary again', () => {
  const st = { lastAt: base.now - S.SHOP_COOLDOWN_MS - 1, lastStop: 'no_site' }
  assert.strictEqual(S.buildOrder({ ...base, state: st }).skip, 'no_site')
  assert.ok(S.buildOrder({ ...base, state: { ...st, lastAt: base.now - S.SHOP_SITE_RETRY_MS - 1 } }).order)
  assert.ok(S.buildOrder({ ...base, state: st, record: { cells: [] } }).order)
})

console.log('THE BILL AND THE SPENDABLE')
await t('roleNames: the palette in order, $wall and $planks resolved, once each', () => {
  assert.deepStrictEqual(S.roleNames(bp.palette, 'window', 'birch_planks'), ['glass_pane', 'birch_planks'])
  assert.deepStrictEqual(S.roleNames(bp.palette, 'trim', 'birch_planks'), ['cut_copper', 'birch_planks'])
})
await t('billOf over the open cells: copper in town -> cut copper; none -> the planks fallback; done cells cost nothing', () => {
  const rec = { cells: [{ at: [0, 0, 0], role: 'trim' }, { at: [1, 0, 0], role: 'trim' }, { at: [2, 0, 0], role: 'base' }, { at: [3, 0, 0], role: 'fill' }] }
  const read = (x) => ({ name: x === 1 ? 'cut_copper' : 'air', boundingBox: x === 1 ? 'block' : 'empty' })
  assert.deepStrictEqual(S.billOf(rec, bp.palette, read, { done: R.cellDone, inTown: () => true, planks: 'oak_planks' }), { cut_copper: 1, stone_bricks: 1, cobblestone: 1 })
  assert.deepStrictEqual(S.billOf(rec, bp.palette, read, { done: R.cellDone, inTown: n => n !== 'cut_copper', planks: 'oak_planks' }), { oak_planks: 1, stone_bricks: 1, cobblestone: 1 })
})
await t('needFromTown: the bill less the bag, the largest first, capped in all', () => {
  assert.deepStrictEqual(S.needFromTown({ stone_bricks: 89, oak_planks: 49, torch: 2 }, { stone_bricks: 10, torch: 5 }, 100), { stone_bricks: 79, oak_planks: 21 })
})
await t('spendableFor: a part is its stock less claims; a reserved family is above its reserve, less claims, never below 0', () => {
  assert.strictEqual(S.spendableFor('stone_bricks', { stone_bricks: 100 }, { claims: { stone_bricks: 30 } }), 70)
  const reserve = { torch: 32, logs: 512 }
  assert.strictEqual(S.spendableFor('torch', { torch: 40 }, { reserve }), 8, 'torch reserve 32')
  assert.strictEqual(S.spendableFor('oak_log', { oak_log: 600, birch_log: 10 }, { reserve }), 98, 'the log FAMILY above 512, capped by this species')
  assert.strictEqual(S.spendableFor('torch', { torch: 10 }, { reserve }), 0)
})

await t('visitNeeds: the bill, a sapling per pending replant without one, a missing station\'s inputs (none when the town has it)', () => {
  const rec = { replant: [{ cell: [1, 70, 1], sapling: 'oak_sapling' }, { cell: [2, 70, 2], sapling: 'birch_sapling' }] }
  const bill = { stone_bricks: 10, furnace: 2, crafting_table: 1 }
  const got = S.visitNeeds(rec, bill, { saplingAt: c => c[0] === 2, town: { furnace: 0, crafting_table: 1 }, spare: { furnace: 1 }, planks: 'spruce_planks' })
  assert.deepStrictEqual(got, { stone_bricks: 10, furnace: 2, crafting_table: 1, oak_sapling: 1, cobblestone: 8 })
  assert.deepStrictEqual(S.visitNeeds({}, { crafting_table: 1 }, { planks: 'spruce_planks' }), { crafting_table: 1, spruce_planks: 4 }, 'no table in town: its planks')
})
await t('shopAllow: a PART (no reserve key) up to what the container shows; a reserved family through takeAllowed (control: takeAllowed gives a part 0)', async () => {
  const M = await import('../src/mats.mjs')
  assert.strictEqual(M.takeAllowed('stone_bricks', 30, { here: { stone_bricks: 20 } }), 0, 'the Paper r1 defect: a part is never drawn by takeAllowed')
  assert.strictEqual(S.shopAllow('stone_bricks', 30, { here: { stone_bricks: 20 } }), 20)
  assert.strictEqual(S.shopAllow('glass_pane', 4, { here: { glass_pane: 9 } }), 4)
  assert.strictEqual(S.shopAllow('glass_pane', 4, { here: {} }), 0)
  const o = { others: {}, here: { torch: 40 }, reserve: { torch: 32 } }
  assert.strictEqual(S.shopAllow('torch', 20, o), M.takeAllowed('torch', 20, o), 'a reserved family is judged by takeAllowed')
  assert.ok(S.shopAllow('torch', 20, o) <= 8, 'never through the torch reserve')
})

await t('mine names the workshop when its keep-out refuses (Claude r2 P3-1: it read "the town tree farm")', async () => {
  const MW = await import('../src/minewell.mjs')
  assert.strictEqual(MW.keepOutLabel('workshop'), 'the town workshop')
  assert.match(MW.keepOutWhy({ kind: 'workshop', cell: { x: 1, y: 2, z: 3 } }), /the town workshop .*1,2,3/)
  assert.strictEqual(MW.keepOutLabel('nonesuch'), 'the town tree farm', 'control: an unknown kind still falls back')
})

await t('leftoverNames: only what was drawn AND is held above the visit\'s start (never a pre-visit item, never one used up)', () => {
  assert.deepStrictEqual(S.leftoverNames({ stone_bricks: 20, glass_pane: 4, torch: 2 }, { stone_bricks: 5, torch: 3 }, { stone_bricks: 9, glass_pane: 0, torch: 3, cobblestone: 64 }), ['stone_bricks'])
  assert.deepStrictEqual(S.leftoverNames({}, {}, { cobblestone: 64 }), [], 'nothing drawn: nothing banked')
})

await t('bagBalance: the visit\'s books per name; a part used without a placement is a NEGATIVE unexplained (control: an exact visit is 0)', () => {
  const ok = S.bagBalance({ bag0: { stone_bricks: 3, cobblestone: 64 }, took: { stone_bricks: 89, cobblestone: 8 }, crafted: { furnace: 1, cobblestone: -8 }, placed: { stone_bricks: 89, furnace: 1 }, back: {}, bag1: { stone_bricks: 3, cobblestone: 64 } })
  assert.deepStrictEqual(Object.fromEntries(Object.entries(ok).map(([k, v]) => [k, v.unexplained])), { stone_bricks: 0, cobblestone: 0, furnace: 0 })
  const lost = S.bagBalance({ bag0: {}, took: { glass_pane: 4 }, placed: { glass_pane: 2 }, back: { glass_pane: 1 }, bag1: {} })
  assert.strictEqual(lost.glass_pane.unexplained, -1, 'one pane unaccounted')
  const pick = S.bagBalance({ bag0: {}, took: { torch: 2 }, placed: { torch: 2 }, bag1: { torch: 5 } })
  assert.strictEqual(pick.torch.unexplained, 5, 'a pickup is positive, never a loss')
  assert.ok(S.SCAFFOLD_NAMES.has('cobblestone') && S.SCAFFOLD_NAMES.has('oak_planks') && !S.SCAFFOLD_NAMES.has('stone_bricks'))
})
await t('buildBagDetail: under 300 characters, the most negative first, every field in order', () => {
  const bal = S.bagBalance({ bag0: { torch: 1 }, took: { stone_bricks: 89, oak_planks: 49, glass_pane: 4, cut_copper: 20, torch: 2, furnace: 2, crafting_table: 1, oak_sapling: 2, birch_sapling: 1, cobblestone: 64 }, placed: { stone_bricks: 88 }, bag1: {} })
  const d = S.buildBagDetail('shop', bal)
  assert.ok(d.length <= 300, d.length)
  assert.ok(d.startsWith('project=shop stone_bricks=0/89/0/88/0/0') === false, 'not the most negative')
  assert.match(d, /^project=shop cobblestone=0\/64\/0\/0\/0\/0 /, 'the most negative (-64) first')
})

console.log('THE FOOTPRINT PRICE')
await t('a record cell + 1 costs 100 on a WORK or TRAVEL walk, 0 on an escape walk (survival digs kept), 0 outside', () => {
  const cells = S.footprintCells({ cells: [{ at: [10, 70, 10] }] })
  assert.strictEqual(cells.size, 27)
  const blk = (x, y, z) => ({ position: { x, y, z } })
  for (const prof of ['walk', 'gather', 'tunnel', 'town_deposit_walk', 'composter_walk']) assert.strictEqual(S.footprintCost(cells, prof, blk(11, 71, 9)), 100, prof)
  for (const prof of ['ascend', 'descend', 'water']) assert.strictEqual(S.footprintCost(cells, prof, blk(11, 71, 9)), 0, prof)
  assert.strictEqual(S.footprintCost(cells, 'walk', blk(12, 70, 10)), 0, 'two away: free')
  assert.strictEqual(S.footprintCost(undefined, 'walk', blk(10, 70, 10)), 0, 'no record yet: free')
})

console.log('THE POOL\'S STOOD CELLS')
await t('appended by any bot, read back distinct and inside the town circle; torn lines skipped; rotation keeps the old file', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stood-')), key = 'project-0_70_0.shop', home = { x: 0, y: 70, z: 0 }
  S.stoodAppend(d, key, [1, 70, 2], { by: 'A' }); S.stoodAppend(d, key, [1, 70, 2], { by: 'B' }); S.stoodAppend(d, key, [3, 70, -4], { by: 'B' }); S.stoodAppend(d, key, [40, 70, 0], { by: 'C' })
  fs.appendFileSync(path.join(d, `${key}.stood.jsonl`), '{"c":[5,70')
  assert.deepStrictEqual(S.stoodRead(d, key, home), [[1, 70, 2], [3, 70, -4]])
  fs.renameSync(path.join(d, `${key}.stood.jsonl`), path.join(d, `${key}.stood.jsonl.old`))
  S.stoodAppend(d, key, [0, 70, 1])
  assert.deepStrictEqual(S.stoodRead(d, key, home), [[1, 70, 2], [3, 70, -4], [0, 70, 1]], 'the old file still read')
})

console.log('THE WIRING (structural: comments stripped, executable lines, each with a mutant)')
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const SK = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const CG = strip(fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
const IX = strip(fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
const W = [
  ['skills: build_shop dispatched to buildShop, chatOnly', SK, /build_shop:\s*\{\s*run:\s*buildShop,[^}]*chatOnly:\s*true/],
  ['skills: build_shop contract expects world_change', SK, /build_shop:\s*\{\s*expects:\s*\['world_change'\]/],
  ['cognitive: the order comes from buildOrder', CG, /const r = buildOrder\(\{ on: SHOP\.on,/],
  ['cognitive: a decline refunds the cooldown', CG, /build_shop:\s*\['shopState',\s*'lastAt'\]/],
  ['index: the footprint price appended to the shared break array', IX, /moves\.exclusionAreasBreak = moves\.exclusionAreasBreak\.concat\(\(block\) => footprintCost\(bot\.shopFootprint, bot\.movementProfile, block\)\)/],
  ['index: the footprint price appended to the shared place array', IX, /moves\.exclusionAreasPlace = moves\.exclusionAreasPlace\.concat\(\(block\) => footprintCost\(bot\.shopFootprint, bot\.movementProfile, block\)\)/],
  ['skills: the presence heartbeat while the connection lives', SK, /beat = setInterval\(\(\) => mark\(false\), PRESENCE_BEAT_MS\)/],
  ['skills: the heartbeat started at once when installed after login', SK, /if \(bot\.entity\) start\(\)/],
  ['skills: the visit fences itself on its own beat', SK, /unknown: bot\.shopUnknown, beat: true, placedBy \}/],
  ['index: the acknowledgement tracker installed once per connection, before login', IX, /if \(SHOP\.on\) \{ try \{ bot\.shopAcks = shopAckInstall\(bot\) \} catch \{\} \}/],
  ['skills: mine\'s keep-out carries the workshop\'s record cells', SK, /const farm = composeKeepOut\(\{ forbid: null, bottom: null \}, shopKeepOut\(\)\)/],
  ['skills: gather never targets a record cell', SK, /if \(shopCells && b\.position && shopCells\.has\(/],
  ['skills: the visit draws with the part rule', SK, /matsWithdraw\(ctx, need, signal, 30_000, matsReserve\(\)\.table, shopAllow\)/],
  ['skills: matsWithdraw judges each take by its allow rule', SK, /const c = allow\(n, want, \{ others, here, reserve, taking: matsTaking\(bot, n\) \}\)/],
  ['skills: the slot released at its LATEST generation', SK, /releaseLease\(dir, key, `slot\$\{slot\.slot\}`, me, slotRef\.gen\)/],
  ['skills: the leftovers banked after the visit (A3 fallback: town chests), inside the skill\'s clock', SK, /if \(left\.length && SHOP_SKILL_MS - \(Date\.now\(\) - t0\) >= SHOP_BANK_MIN_MS\) \{ try \{ back = await matsBank\(ctx, left, held0, signal, took\) \}/],
  ['skills: the completion published BEFORE the bank', SK, /bot\.shopDamage = null\n\s*if \(pub\.result === 'accepted'\)[^\n]*\n\s*\}\n(?:\s*\/\/[^\n]*\n)*\s*let back = \{\}/],
  ['skills: one _build_bag row per visit, in the finally', SK, /if \(bag0\) \{ try \{ logEvent\(\{ kind: 'build_bag'/],
  ['cognitive: a complete workshop is judged against the world', CG, /complete: !!rec\?\.structure_complete && !shopDamaged\(bot, rec\)/],
  ['index: the licence row', IX, /logEvent\(\{ kind: 'build_mode'/],
  ['index: the stood-cell timer', IX, /setInterval\(\(\) => \{ try \{ shopStoodTick\(bot\) \} catch \{\} \}, STOOD_EVERY_MS\)/],
]
for (const [name, src, re] of W) {
  await t(`${name} (and a mutant of it fails)`, () => {
    assert.ok(re.test(src), 'wired')
    const m = src.match(re)[0]
    assert.strictEqual(src.split(m).length, 2, 'the anchor is unique')
    assert.ok(!re.test(src.replace(m, m.replace(/[A-Za-z]/, '#'))), 'a one-character mutant of the executable line is not matched')
  })
}
await t('the comment stripper is not fooled: a pattern only in a comment does not match (control)', () => {
  assert.ok(!/logEvent\(\{ kind: 'build_mode'/.test(strip("// logEvent({ kind: 'build_mode' })\nconst x = 1")))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
