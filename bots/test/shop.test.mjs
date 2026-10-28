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

console.log('THE PROJECT\'S SHARE OF THE BAG (Paper 10-25 SHOP-KILL / CHAIN-1)')
{
  const TD = await import('../src/towndeposit.mjs')
  const BP = await import('../src/buildproj.mjs')
  // the kill scene's bag at the stuck visit (00:57:11Z): 36 planks the earlier visit drew, the town at BUILD_RESERVE (71 planks)
  const bag = { oak_slab: 5, cut_copper: 20, glass_pane: 4, crafting_table: 1, iron_pickaxe: 1, iron_axe: 1, iron_shovel: 1, oak_planks: 36, furnace: 2, torch: 2 }
  const spare = (held, drawn) => { const k = TD.townKeeps(S.ownCounts(held, S.drawnHeld(drawn, held))).keep; return n => (held[n] ?? 0) - (k[n] ?? 0) }
  await t('the deadlock reproduced: with no drawn record the bag\'s 36 planks are ALL kept (stockpile_wood) -- spare 0 (control)', () => {
    assert.strictEqual(spare(bag, {})('oak_planks'), 0)
  })
  await t('with the drawn record the project\'s planks are spendable: spare 36', () => {
    assert.strictEqual(spare(bag, { oak_planks: 49, stone_bricks: 48, cut_copper: 20, glass_pane: 4, furnace: 2 })('oak_planks'), 36)
  })
  await t('the bot\'s OWN planks stay kept: 20 own + 36 drawn -> spare 36, never the own 20', () => {
    const b = { ...bag, oak_planks: 56 }
    assert.strictEqual(spare(b, { oak_planks: 36 })('oak_planks'), 36)
  })
  await t('drawnHeld clamps to the bag (another job spent some: the composter crafted from them)', () => {
    assert.deepStrictEqual(S.drawnHeld({ oak_planks: 49, glass_pane: 4, gone: 3 }, { oak_planks: 36, glass_pane: 4 }), { oak_planks: 36, glass_pane: 4 })
  })
  await t('a decrease since the record comes off the project\'s share first; a pickup is the bot\'s own (r10 Codex P2)', () => {
    // 20 own + 36 drawn = 56 when written; the kit spent 10 -> 46: the share is 26, the own 20 stay own
    assert.deepStrictEqual(S.drawnHeld({ oak_planks: 36 }, { oak_planks: 46 }, { oak_planks: 56 }), { oak_planks: 26 })
    // a pickup of 10 -> 66: the share stays 36
    assert.deepStrictEqual(S.drawnHeld({ oak_planks: 36 }, { oak_planks: 66 }, { oak_planks: 56 }), { oak_planks: 36 })
    // without the baseline (an r10 file), the clamp alone (control)
    assert.deepStrictEqual(S.drawnHeld({ oak_planks: 36 }, { oak_planks: 46 }), { oak_planks: 36 })
  })
  await t('Codex r10 P2 case: 20 own + 36 drawn, all 36 placed, the record rewritten at each placement: the own 20 stay kept', () => {
    // the per-placement write leaves { drawn: 0 } -- nothing the project's; with the old one-write record (36 drawn, bag 56) the
    // baseline still gives the decrease (56 -> 20) to the share first: 36 - 36 = 0
    assert.deepStrictEqual(S.drawnHeld({ oak_planks: 36 }, { oak_planks: 20 }, { oak_planks: 56 }), {})
    assert.strictEqual(spare({ ...bag, oak_planks: 20 }, {})('oak_planks'), 0)
  })
  await t('drawnAfter: drawn + took + crafted - placed - back, clamped to [0, bag]', () => {
    assert.deepStrictEqual(S.drawnAfter({ drawn: { oak_planks: 10 }, took: { oak_planks: 49, stone_bricks: 89 }, crafted: { oak_planks: -4, crafting_table: 1 },
      placed: { oak_planks: 40, stone_bricks: 89, crafting_table: 1 }, back: { oak_planks: 5 }, bag1: { oak_planks: 30, crafting_table: 0 } }), { oak_planks: 10 })
    assert.deepStrictEqual(S.drawnAfter({ drawn: {}, took: { torch: 2 }, back: { torch: 2 }, bag1: { torch: 2 } }), {}, 'banked back: nothing drawn')
    assert.deepStrictEqual(S.drawnAfter({ drawn: { stone_bricks: 89 }, bag1: { stone_bricks: 40 } }), { stone_bricks: 40 }, 'never above the bag')
  })
  await t('shareState: a live share holds; none, a stale one (TTL), and a completed build\'s do not (r16 reviews P2)', () => {
    const now = 10 * 3600_000, dr = { drawn: { oak_planks: 36 }, bag: { oak_planks: 36 }, at: now - 60_000 }
    assert.deepStrictEqual(S.shareState(dr, { oak_planks: 36 }, { now }), { held: true, share: { oak_planks: 36 }, write: null }, 'live (control)')
    assert.strictEqual(S.shareState({ drawn: {} }, { oak_planks: 36 }, { now }).held, false)
    assert.strictEqual(S.shareState({ ...dr, at: now - S.SHARE_TTL_MS - 1 }, { oak_planks: 36 }, { now }).held, false, 'not written for > TTL')
    const done = S.shareState(dr, { oak_planks: 36 }, { now, complete: true, completeAt: now - 1000 })
    assert.deepStrictEqual(done, { held: false, share: {}, write: {} }, 'another builder completed the workshop: cleared')
    assert.strictEqual(S.shareState({ ...dr, at: now }, { oak_planks: 36 }, { now, complete: true, completeAt: now - 1000 }).held, true, 'a repair visit\'s newer share holds')
    assert.deepStrictEqual(S.shareState(dr, { oak_planks: 36 }, { now, complete: true, completeAt: null }), { held: true, share: { oak_planks: 36 }, write: null }, 'r17 Codex P2: no completeAt is no boundary: the TTL decides')
  })
  await t('shareState: a consumed share is retired, so a later pickup never resurrects it (r16 Codex P2)', () => {
    const now = 10 * 3600_000
    const st = S.shareState({ drawn: { oak_planks: 4 }, bag: { oak_planks: 20 }, at: now - 1000 }, { oak_planks: 16 }, { now })
    assert.deepStrictEqual(st, { held: false, share: {}, write: {} }, 'drawn 4, baseline 20, bag 16: spent; retired to nothing')
    // after the retire is written (share {}), the replenished bag holds no share at all
    assert.strictEqual(S.shareState({ drawn: {}, bag: {}, at: now }, { oak_planks: 20 }, { now }).held, false)
    // a partial spend retires to what is left
    assert.deepStrictEqual(S.shareState({ drawn: { oak_planks: 10 }, bag: { oak_planks: 30 }, at: now - 1000 }, { oak_planks: 25 }, { now }).write, { oak_planks: 5 })
  })
  await t('drawnWrite / drawnRead round trip; junk counts dropped; a missing file reads {}', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawn-'))
    assert.deepStrictEqual(BP.drawnRead(dir, 'project-1_2_3.shop', 'bot-A'), { drawn: {}, bag: {}, at: null })
    assert.strictEqual(BP.drawnWrite(dir, 'project-1_2_3.shop', 'bot-A', { oak_planks: 36, x: 'no', y: -2, z: 0 }, { bag: { oak_planks: 56, torch: 2 } }), true)
    const r = BP.drawnRead(dir, 'project-1_2_3.shop', 'bot-A')
    assert.deepStrictEqual({ drawn: r.drawn, bag: r.bag }, { drawn: { oak_planks: 36 }, bag: { oak_planks: 56 } })
    assert.ok(Number.isFinite(r.at), 'the write time is kept (the completion test reads it)')
    assert.deepStrictEqual(BP.drawnRead(dir, 'project-1_2_3.shop', 'bot-B'), { drawn: {}, bag: {}, at: null }, 'per holder')
    assert.strictEqual(BP.drawnWrite(path.join(dir, 'no\0such'), 'k', 'bot-A', { oak_planks: 1 }), false, 'a failed write says so')
    assert.ok(!fs.readdirSync(dir).some(n => n.endsWith('.tmp')), 'no temp file left')
  })
}

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
  assert.match(d, /^project=shop exit=- silent=- drawn=- cobblestone=0\/64\/0\/0\/0\/0 /, 'the most negative (-64) first')
  assert.match(S.buildBagDetail('shop', bal, { exit: 'complete', silent: 0 }), /^project=shop exit=complete silent=0 drawn=- /)
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
await t('AN ESCAPE CLONE CARRIES NO FOOTPRINT (W3 merge, Codex P1): a probe on the ascend Movements while `walk` is ACTIVE is not vetoed', () => {
  const cells = S.footprintCells({ cells: [{ at: [10, 70, 10] }] })
  const blk = { position: { x: 11, y: 71, z: 9 } }
  let active = 'walk'
  const other = () => 0
  const fp = S.footprintEntry(() => cells, () => active)
  const moves = { exclusionAreasBreak: [other, fp], exclusionAreasPlace: [fp] }
  const price = (m, k) => m[k].reduce((a, f) => a + f(blk), 0)
  // the index.mjs shape: Object.assign copies the shared arrays' references, then the escape clone drops the tagged entry
  const ascend = S.withoutFootprint(Object.assign({}, moves))
  assert.strictEqual(price(moves, 'exclusionAreasBreak'), 100, 'the walk itself still prices the footprint')
  assert.strictEqual(price(ascend, 'exclusionAreasBreak'), 0, 'the ascend clone searched while walk is active: no veto')
  assert.strictEqual(price(ascend, 'exclusionAreasPlace'), 0)
  assert.deepStrictEqual(ascend.exclusionAreasBreak, [other], 'every other entry kept, in order')
  assert.strictEqual(moves.exclusionAreasBreak.length, 2, 'the shared walk array is not mutated')
  active = 'gather'; const gather = Object.assign({}, moves)
  assert.strictEqual(price(gather, 'exclusionAreasBreak'), 100, 'a work clone keeps it')
  // MUTANT: the old shared callback (no clone filter) vetoes the probe
  const ascendOld = Object.assign({}, moves); active = 'walk'
  assert.strictEqual(price(ascendOld, 'exclusionAreasBreak'), 100, 'mutant: without withoutFootprint the probe is vetoed')
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
const FX = strip(fs.readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8'))   // W3: the building spawn rows moved here (W1b)
const W = [
  ['skills: build_shop dispatched to buildShop, chatOnly', SK, /build_shop:\s*\{\s*run:\s*buildShop,[^}]*chatOnly:\s*true/],
  ['skills: build_shop contract expects world_change', SK, /build_shop:\s*\{\s*expects:\s*\['world_change'\]/],
  ['cognitive: the order comes from buildOrder', CG, /const r = buildOrder\(\{ on: SHOP\.on,/],
  ['cognitive: a decline refunds the cooldown', CG, /build_shop:\s*\['shopState',\s*'lastAt'\]/],
  ['index: the footprint entry reads the bot\'s footprint and active profile', IX, /const shopFp = footprintEntry\(\(\) => bot\.shopFootprint, \(\) => bot\.movementProfile\)/],
  ['index: the footprint price appended to the shared break array', IX, /moves\.exclusionAreasBreak = moves\.exclusionAreasBreak\.concat\(shopFp\)/],
  ['index: the footprint price appended to the shared place array', IX, /moves\.exclusionAreasPlace = moves\.exclusionAreasPlace\.concat\(shopFp\)/],
  ['index: the ascend clone drops the footprint (W3 merge, Codex P1)', IX, /Object\.assign\(ascendMoves, moves\)\n\s*withoutFootprint\(ascendMoves\)/],
  ['index: the descend clone drops the footprint', IX, /Object\.assign\(descendMoves, moves\)\n\s*withoutFootprint\(descendMoves\)/],
  ['index: the deck clone drops the footprint', IX, /Object\.assign\(deckMoves, moves\)\n\s*withoutFootprint\(deckMoves\)/],
  ['index: the water clone drops the footprint', IX, /Object\.assign\(waterMoves, moves\)\n\s*withoutFootprint\(waterMoves\)/],
  ['skills: the presence heartbeat while the connection lives', SK, /beat = setInterval\(\(\) => mark\(false\), PRESENCE_BEAT_MS\)/],
  ['skills: the heartbeat started at once when installed after login', SK, /if \(bot\.entity\) start\(\)/],
  ['skills: the visit fences itself on its own beat', SK, /unknown: bot\.shopUnknown, beat: true, placedBy \}/],
  ['index: the acknowledgement tracker installed once per connection, before login', IX, /if \(SHOP\.on\) \{ try \{ bot\.shopAcks = shopAckInstall\(bot\) \} catch \{\} \}/],
  ['skills: mine\'s keep-out carries the workshop\'s record cells', SK, /const farm = composeKeepOut\(\{ forbid: null, bottom: null \}, shopKeepOut\(\)\)/],
  ['skills: gather never targets a record cell', SK, /if \(shopCells && b\.position && shopCells\.has\(/],
  ['skills: the visit draws with the part rule', SK, /const R0 = matsReserve\(\)\.table\n\s*const PD = projectDraw\(bot, R0, \{ forProject: true, base: shopAllow, /],
  ['skills: matsWithdraw judges each take by its allow rule', SK, /const c = allow\(n, want, \{ others, here, reserve, taking: matsTaking\(bot, n\) \}\)/],
  ['skills: the slot released at its LATEST generation', SK, /releaseLease\(dir, key, `slot\$\{slot\.slot\}`, me, slotRef\.gen\)/],
  ['skills: the leftovers banked after the visit (A3 fallback: town chests), inside the skill\'s clock, each deposit booked as it lands', SK, /if \(left\.length && SHOP_SKILL_MS - \(Date\.now\(\) - t0\) >= SHOP_BANK_MIN_MS\) \{ try \{ back = await matsBank\(ctx, left, held0, signal, took, \{ onBanked: \(n2, c2\) => \{ backAll\[n2\] = /],
  ['skills: each verified take booked as it lands', SK, /base: shopAllow, then: \(k, c\) => \{ tookAll\[k\] = \(tookAll\[k\] \?\? 0\) \+ c; persist\(\) \} \}\)/],
  ['skills: matsWithdraw reports each verified take', SK, /try \{ onTook\?\.\(k, c\) \} catch/],
  ['skills: the completion published BEFORE the bank', SK, /bot\.shopDamage = null\n\s*completed = true\n(?:\s*\/\/[^\n]*\n)*\s*if \(drawn0 && !drawnWrite\(dir, key, me, \{\}\)\) drawnFails\+\+\n\s*if \(pub\.result === 'accepted'\)[^\n]*\n\s*\}\n(?:\s*\/\/[^\n]*\n)*\s*let back = \{\}/],
  ['skills: one _build_bag row per visit, in the finally', SK, /if \(bag0\) \{ try \{ logEvent\(\{ kind: 'build_bag'/],
  ['skills: the bag row names the exit (a death inside the visit: died) and the silent clicks', SK, /\{ exit: diedAt \? 'died' : \(f\.outcome \?\? '-'\), silent: f\.silent \?\? '-', drawn: /],
  ['cognitive: a complete workshop is judged against the world', CG, /complete: !!rec\?\.structure_complete && !shopDamaged\(bot, rec\)/],
  ['features: the licence row', FX, /logEvent\(\{ kind: 'build_mode'/],
  ['features: the stood-cell timer', FX, /setInterval\(\(\) => \{ try \{ shopStoodTick\(bot\) \} catch \{\} \}, STOOD_EVERY_MS\)/],
  ['skills: the visit\'s keeps are computed from the bot\'s OWN stock (the drawn share excluded)', SK, /const keep = townKeeps\(ownCounts\(held0, drawn0\), \{ wanted: bot\.currentWants \?\? \[\] \}\)\.keep/],
  ['skills: the drawn share read and clamped (with its baseline) at the visit\'s start', SK, /drawn0 = drawnHeld\(dr\.drawn, held0, dr\.bag\)/],
  ['skills: nothing drawn unless the record can be written (the failure counted)', SK, /if \(Object\.keys\(need\)\.length && !drawnWrite\(dir, key, me, drawn0, \{ bag: held0 \}\)\) return \(drawnFails\+\+, out\('no_effect', 'state_unwritable'/],
  ['skills: a share older than the completion is cleared on the repair path', SK, /if \(rec\.structure_complete && Object\.keys\(dr\.drawn\)\.length && !\(Number\(dr\.at\) > Number\(rec\.completeAt \?\? Infinity\)\)\) \{\n\s*if \(!drawnWrite\(dir, key, me, \{\}\)\) drawnFails\+\+/],
  ['skills: the share persisted after EVERY verified take', SK, /const w = await matsWithdraw\(ctx, need, signal, 30_000, R0, PD\.allow, PD\.onTook, PD\.onUncertain\); took = w\.took/],
  ['skills: the share persisted after every placement', SK, /if \(kind === '_build' && d\?\.op === 'place'\) persist\(\)/],
  ['skills: the share persisted after every bank-back', SK, /backAll\[n2\] = \(backAll\[n2\] \?\? 0\) \+ c2; persist\(\)/],
  ['skills: the share persisted (or cleared on completion) in the finally, a failure counted', SK, /if \(drawn0\) \{ try \{ if \(completed\) \{ if \(!drawnWrite\(dir, key, me, \{\}\)\) drawnFails\+\+ \} else persist\(\) \} catch \{ drawnFails\+\+ \} \}\n\s*if \(bag0\) \{ try \{ logEvent\(\{ kind: 'build_bag'/],
  ['skills: the share cleared AT the completion, before the bank-back', SK, /completed = true\n(?:\s*\/\/[^\n]*\n)*\s*if \(drawn0 && !drawnWrite\(dir, key, me, \{\}\)\) drawnFails\+\+/],
  ['skills: a complete workshop\'s visit clears a stale share', SK, /if \(Object\.keys\(drawnRead\(dir, key, me\)\.drawn\)\.length\) drawnWrite\(dir, key, me, \{\}\)\n\s*return out\('no_effect', 'complete'/],
  ['skills: the composter plans nothing while the bot holds a workshop share', SK, /export function townBuildPlan \(bot\) \{\n\s*if \(shopShareHeld\(bot\)\) return null/],
  ['skills: the junk well plans nothing while the bot holds a workshop share', SK, /function wellBuildPlanOf \(bot\) \{\n\s*if \(shopShareHeld\(bot\)\) return null/],
  ['skills: found-01 founds nothing while the bot holds a workshop share', SK, /if \(shopShareHeld\(bot\)\) return out\('no_effect', 'refused', 'the bag holds the workshop/],
  ['cognitive: no found order while the bot holds a workshop share', CG, /if \(!tp\) return null\n\s*if \(shopShareHeld\(bot\)\) return null\s*\n\s*const items = bot\.inventory\?\.items\?\.\(\) \?\? \[\]\n\s*const wanted = /],
  ['skills: shopShareHeld judges the share by its lifecycle and writes the retire/clear back', SK, /const st = shareState\(dr, held, \{ complete: !!rec\?\.structure_complete, completeAt: rec\?\.completeAt \?\? null \}\)\n(?:\s*\/\/[^\n]*\n)*\s*if \(st\.write\) drawnWrite\(dir, key, me, st\.write, \{ bag: held \}\)\n\s*return st\.held/],
  ['skills: the bag row reports the share\'s writes', SK, /drawn: drawn0 \? \(drawnFails \? `fail:\$\{drawnFails\}` : 'ok'\) : '-' \}/],
  ['skills: persist writes the bag balance with its baseline and counts a failure', SK, /if \(!drawnWrite\(dir, key, me, drawnAfter\(\{ drawn: drawn0, took: tookAll, crafted, placed: placedBy, back: backAll, bag1: b1 \}\), \{ bag: b1 \}\)\) drawnFails\+\+/],
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

console.log('PLANKS FROM THE TOWN\'S LOGS (shopwalls-1028)')
// the live showcase 10-28: pad + ring done, the town at 0 planks / 412 spruce logs, every visit `no_material wall_for_wall-F`
const liveTown = { cobblestone: 991, spruce_log: 412, stone_bricks: 139, copper_ingot: 88, sand: 6, glass_pane: 4 }
const upper = bp.cells.filter(c => c.seg !== 'pad' && c.seg !== 'ring').map((c, i) => ({ at: [i, 80, 0], role: c.role, seg: c.seg }))
await t('the live chain: the bill asks for planks the town lacks; the shortfall is drawn as the town\'s logs and crafted', () => {
  const air = () => ({ name: 'air' })
  // CONTROL: the old inTown (stock only) resolved trim to cut_copper, which the town cannot supply
  const old = S.billOf({ cells: upper }, bp.palette, air, { done: R.cellDone, inTown: n => (liveTown[n] ?? 0) > 0, planks: 'oak_planks' })
  assert.ok(old.cut_copper > 0, 'control: the stock-only reading names cut_copper')
  const bill = S.billOf({ cells: upper }, bp.palette, air, { done: R.cellDone, inTown: S.billInTown(liveTown), planks: 'oak_planks' })
  assert.ok(!bill.cut_copper, 'trim resolves past cut_copper (none in town) to planks')
  assert.ok(S.billInTown({ cut_copper: 4, spruce_log: 1 })('cut_copper'), 'cut_copper in stock is still the first choice')
  assert.ok(!S.billInTown({ cobblestone: 9 })('oak_planks'), 'no logs: planks are not in town')
  const want = S.visitNeeds({ cells: upper }, bill, { town: liveTown, planks: 'oak_planks' })
  const wantPlanks = want.oak_planks
  assert.ok(wantPlanks >= 34, `the walls alone are 34 planks (got ${wantPlanks})`)
  assert.ok(Object.keys(S.needFromTown(want, {})).length, 'the draw is attempted, so the drawn record is written')
  // the town draw got no planks (there are none): the bag holds none spare
  const pf = S.planksFromLogs(want, { spare: () => 0, town: liveTown })
  assert.deepStrictEqual(pf, { log: 'spruce_log', logs: Math.ceil(wantPlanks / 4), planks: 'spruce_planks' })
  // once crafted, the visit's block for a wall, a trim and a roof cell is the crafted planks (any species is done for $planks)
  const has = n => n === 'spruce_planks'
  has.planks = () => 'spruce_planks'
  for (const role of ['wall', 'trim', 'roof', 'window']) assert.strictEqual(R.blockFor(bp.palette, role, has), 'spruce_planks', role)
  assert.ok(R.cellDone({ name: 'spruce_planks' }, bp.palette, 'wall'))
})
await t('planksFromLogs: spare planks of any species count; none short, no logs or no planks wanted -> null', () => {
  const want = { oak_planks: 10, glass_pane: 4 }
  assert.strictEqual(S.planksFromLogs(want, { spare: n => (n === 'birch_planks' ? 10 : 0), town: liveTown }), null, 'held 10 birch')
  assert.deepStrictEqual(S.planksFromLogs(want, { spare: n => (n === 'birch_planks' ? 3 : 0), town: liveTown }), { log: 'spruce_log', logs: 2, planks: 'spruce_planks' }, '7 short -> 2 logs')
  assert.strictEqual(S.planksFromLogs(want, { spare: () => 0, town: { cobblestone: 5 } }), null, 'no logs in town')
  assert.strictEqual(S.planksFromLogs({ glass_pane: 4 }, { spare: () => 0, town: liveTown }), null, 'no planks wanted')
  assert.strictEqual(S.planksFromLogs(want, { spare: () => -3, town: liveTown }).logs, 3, 'a negative spare reads as 0')
  assert.strictEqual(S.planksFromLogs(want, { spare: () => 0, town: { oak_log: 5, birch_log: 9 } }).log, 'birch_log', 'the most-stocked species')
})
await t('WIRED: build_shop draws the logs under the project reserve and crafts the planks before the stations', () => {
  const body = SK.slice(SK.indexOf('async function buildShop'), SK.indexOf('async function foundStore'))
  assert.ok(/billOf\(rec, bp\.palette, read, \{ done: buildCellDone, inTown: billInTown\(town\), planks \}\)/.test(body), 'the bill reads planks as makeable')
  assert.ok(/const pf = planksFromLogs\(want, \{ spare: n => \(hn\[n\] \?\? 0\) - \(keep\[n\] \?\? 0\), town \}\)/.test(body), 'the shortfall is computed')
  assert.ok(/matsWithdraw\(ctx, \{ \[pf\.log\]: pf\.logs \}, signal, 30_000, R0, PD\.allow, PD\.onTook, PD\.onUncertain\)/.test(body), 'drawn under PD')
  assert.ok(/if \(plankCraft\) \{ try \{ await craft\(ctx, plankCraft, signal\) \}[\s\S]{0,120}for \(const item of \['furnace', 'crafting_table'\]\)/.test(body), 'crafted, before the stations, inside the booked craft block')
  assert.ok(body.indexOf('const preCraft = heldMap(bot)') < body.indexOf('await craft(ctx, plankCraft, signal)'), 'after preCraft: booked in crafted')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
