// LIDCLEAR-01: lid-blocked town chests (docs/reports/lidclear-2026-10-16.md). Behaviour first: the pure rule
// (lidrule.mjs), the actuator (skills.mjs clearChestLid) in the fake world, and the REFUSAL CHAIN through the real
// count_town -> reconcileCobble -> clearChestLid -> open -> journal count -> the town judged; then the deposit's memory
// rule, and anchored mutants (withMutant: the anchor present and unique, or the mutant does not count as killed).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-lid-logs-'))
process.env.BOT_NAME = 'LidBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-lid-pool-'))

const L = await import('../src/lidrule.mjs')
const B = await import('../src/bankable.mjs')
const CC = await import('../src/cobblecap.mjs')
const CF = await import('../src/chestfull.mjs')
const SK = await import('../src/skills.mjs')
const { currentDigScope } = await import('../src/digtown.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')
const { SKILLS, installCobbleCap, cobbleObserve } = SK

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const rowsSince = (n0, kind) => RECS.slice(n0).filter(x => x.skill?.name === kind).map(x => x.skill.detail)
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const LID_PATH = new URL('../src/lidrule.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// ----------------------------------------------------------------------------------------------------- the pure rule
const cube = name => ({ name, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] })
const AIR = { name: 'air', boundingBox: 'empty', shapes: [] }
const sides4 = (b = AIR) => [b, b, b, b]
await t('RULE: what the bot may break off a lid -- cobblestone and cobbled deepslate (and since cobblekeep-01 dirt and grass_block: cobblekeep.test.mjs); never a structure, storage, glass or leaves; never by the well; never beside water or lava (a liquid OR a waterlogged block); never under a falling block; never on an unknown cell', () => {
  const ok = (lid, extra = {}) => L.lidClearRefusal({ lid: { name: lid }, above: AIR, sides: sides4(), ...extra })
  assert.equal(ok('cobblestone'), null, 'the census blocker: clearable')
  assert.equal(ok('cobbled_deepslate'), null)
  for (const n of ['stone_bricks', 'oak_planks', 'oak_log', 'chest', 'barrel', 'crafting_table', 'glass', 'oak_leaves', 'composter']) {
    assert.match(ok(n) ?? '', /is not a block a bot may break/, `${n} is refused`)
  }
  assert.match(ok('cobblestone', { well: true }), /junk well/)
  assert.match(L.lidClearRefusal({ lid: { name: 'cobblestone' }, above: { name: 'water' }, sides: sides4() }), /water or lava/)
  assert.match(L.lidClearRefusal({ lid: { name: 'cobblestone' }, above: AIR, sides: [AIR, { name: 'lava' }, AIR, AIR] }), /water or lava/)
  assert.match(L.lidClearRefusal({ lid: { name: 'cobblestone' }, above: AIR, sides: [AIR, AIR, { name: 'oak_stairs', props: { waterlogged: true } }, AIR] }), /water or lava/, 'a waterlogged neighbour')
  assert.match(L.lidClearRefusal({ lid: { name: 'cobblestone' }, above: AIR, sides: [AIR, AIR, { name: 'oak_stairs', props: { waterlogged: 'true' } }, AIR] }), /water or lava/, 'a region read says "true"')
  assert.equal(L.lidClearRefusal({ lid: { name: 'cobblestone' }, above: AIR, sides: [AIR, AIR, { name: 'oak_stairs', props: { waterlogged: false } }, AIR] }), null, 'positive control: a dry stair')
  assert.match(L.lidClearRefusal({ lid: { name: 'cobblestone' }, above: { name: 'gravel' }, sides: sides4() }), /would fall/)
  assert.match(L.lidClearRefusal({ lid: { name: 'cobblestone' }, above: { name: 'red_concrete_powder' }, sides: sides4() }), /would fall/)
  assert.match(L.lidClearRefusal({ lid: { name: 'cobblestone' }, above: null, sides: sides4() }), /unknown/)
  assert.match(L.lidClearRefusal({ lid: { name: 'cobblestone' }, above: AIR, sides: [AIR, null, AIR, AIR] }), /unknown/)
  assert.match(L.lidClearRefusal({ lid: { name: 'cobblestone' }, above: AIR, sides: [AIR, AIR] }), /unknown/, 'fewer than four sides')
  assert.match(L.lidClearRefusal({}), /lid unknown/)
})
await t('RULE: the dig budget is the dig plus 2.5 s, refused past 15 s -- a bare hand on cobblestone (10,000 ms) gets 12,500 ms, never the old 10,000 ms race; off the ground (x5) it is not started', () => {
  assert.equal(L.lidDigBudgetMs(750), 3250)
  assert.equal(L.lidDigBudgetMs(1500), 4000)
  assert.equal(L.lidDigBudgetMs(10000), 12500)
  assert.ok(L.lidDigBudgetMs(10000) > 10000, 'THE DEFECT: a bare hand needs 10,000 ms, so the budget must exceed it')
  assert.equal(L.lidDigBudgetMs(12500), 15000, 'the bound is inclusive')
  assert.equal(L.lidDigBudgetMs(12501), null)
  assert.equal(L.lidDigBudgetMs(50000), null)
  for (const x of [NaN, -1, undefined, null, 'x']) assert.equal(L.lidDigBudgetMs(x), x === null ? 2500 : null, String(x))
})
await t('RULE: only evidence about the LID closes the container for the town; the caller\'s limits never do', () => {
  for (const o of ['refused', 'failed', 'unconfirmed']) assert.equal(L.lidFailMemory(o), 'unavailable', o)
  for (const o of ['dug', 'not_blocked', 'slow', 'no_time', 'reach', 'hand', 'interrupted', 'unknown', 'aborted']) assert.equal(L.lidFailMemory(o), null, o)
  assert.deepEqual([...L.LID_OUTCOMES].sort(), ['aborted', 'dug', 'failed', 'hand', 'interrupted', 'no_time', 'not_blocked', 'reach', 'refused', 'slow', 'unconfirmed', 'unknown'])
})
await t('RULE: the bot\'s lid test (unchanged) and the server\'s rule (an approximation, census and tests only): a chest on a chest, glass and leaves do not block the server; soul sand and a sitting cat do', () => {
  assert.equal(L.chestLidBlocked(cube('stone')), true)
  assert.equal(L.chestLidBlocked({ name: 'dirt', boundingBox: 'block' }), true, 'a solid without shapes is assumed full')
  assert.equal(L.chestLidBlocked(AIR), false)
  assert.equal(L.chestLidBlocked({ name: 'stone_slab', boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.5, 1]] }), false)
  assert.equal(L.chestLidBlocked({ name: 'oak_stairs', boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0.5, 1, 1, 1]] }), false)
  assert.equal(L.chestLidBlocked(null), false)
  assert.equal(SK.chestLidBlocked, L.chestLidBlocked, 'skills.mjs re-exports the one rule')
  assert.equal(L.serverLidBlocks(cube('cobblestone')), true)
  assert.equal(L.serverLidBlocks({ name: 'chest', boundingBox: 'block', shapes: [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]] }), false, 'a chest on a chest opens')
  assert.equal(L.serverLidBlocks(cube('glass')), false); assert.equal(L.serverLidBlocks(cube('oak_leaves')), false)
  assert.equal(L.serverLidBlocks({ name: 'soul_sand', boundingBox: 'block', shapes: [[0, 0, 0, 1, 0.875, 1]] }), true)
  assert.equal(L.serverLidBlocks(AIR, { cat: true }), true)
  assert.equal(L.serverLidBlocks(AIR), false)
})
await t('LICENCE: the mode detail names the rule; features.mjs::installFeatures (from the index.mjs spawn handler) writes `_lidclear_mode` once per spawn on the executable path (comments stripped)', () => {
  assert.equal(L.lidClearModeDetail(), `phase=mode recount=clear dig=equip breakable=cobble budget_max=${L.LID_DIG_MAX_MS}`)
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const wired = src => {
    const c = strip(src)
    assert.match(c, /^import \{ lidClearModeDetail \} from '\.\/lidrule\.mjs'$/m, 'imported')
    const i = c.indexOf('installCobbleCap(bot)')
    assert.ok(i > 0, 'anchor')
    assert.match(c.slice(i, i + 4000), /\n\s*try \{ logEvent\(\{ kind: 'lidclear_mode', status: 'success', snapshot: snapshot\(bot\), detail: lidClearModeDetail\(\) \}\) \} catch \{\}/, 'written on spawn')
  }
  const idx = readFileSync(new URL('../src/features.mjs', import.meta.url), 'utf8')
  wired(idx)
  const row = "  try { logEvent({ kind: 'lidclear_mode'"
  assert.equal(idx.split(row).length, 2, 'ANCHOR MISSING or not unique')
  assert.throws(() => wired(idx.replace(row, "  try { void ({ kind: 'lidclear_mode'")), 'a removed row is caught')
  assert.throws(() => wired(idx.replace("detail: lidClearModeDetail() }) } catch {}", "detail: 'phase=mode' }) } catch {}")), 'a literal detail is caught')
})

// ------------------------------------------------------------------------------------------- the actuator, faked
// A town chest at 5,64,0 (home 0,64,0). The fake world gets what the actuator needs: digTime by the HELD item (a stone
// pickaxe 750 ms, any pickaxe 1,500, the hand 10,000 -- prismarine-block 1.21.8 for cobblestone), a dig that records the
// hand and the dig scope and turns the cell to air, canDigBlock, and an open that the SERVER refuses under a full block.
const lidWorld = (bag = [], { lid = 'cobblestone' } = {}) => {
  process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-lid-pool-'))
  const w = fakeWorld({ bag })
  w.set(5, 64, 0, 'chest')
  if (lid) w.set(5, 65, 0, lid)
  w.digs = []
  // what the fake's blocks lack and toolFor reads: cobblestone's harvest tools (prismarine-block canHarvest), and a
  // chest's real shape (not a full cube: a chest on a chest is not a blocked lid)
  const PICKS = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe'].map(n => w.bot.registry.itemsByName[n].id)
  const blockAt0 = w.bot.blockAt
  w.bot.blockAt = p => {
    const b = blockAt0(p)
    if (b?.name === 'cobblestone') b.canHarvest = id => PICKS.includes(id)
    if (b?.name === 'chest') b.shapes = [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]]
    return b
  }
  w.bot.digTime = b => (w.bot.heldItem?.name === 'stone_pickaxe' ? 750 : /_pickaxe$/.test(w.bot.heldItem?.name ?? '') ? 1500 : 10_000) * (w.bot.entity.onGround === false ? 5 : 1)
  w.bot.canDigBlock = () => true
  w.bot.dig = async (b, force) => { w.digs.push({ at: w.key(b.position.x, b.position.y, b.position.z), held: w.bot.heldItem?.name ?? null, force, scope: currentDigScope() }); w.set(b.position.x, b.position.y, b.position.z, 'air') }
  const open0 = w.bot.openContainer.bind(w.bot)
  w.bot.openContainer = async b => {
    const lidB = w.bot.blockAt(b.position.offset(0, 1, 0))
    if (L.serverLidBlocks(lidB)) throw new Error('Event windowOpen did not fire within timeout of 20000ms')   // the server's rule
    return open0(b)
  }
  return w
}
const at = (x, y, z) => ({ x, y, z, offset (dx, dy, dz) { return at(x + dx, y + dy, z + dz) } })
const C = () => w0.bot.blockAt({ x: 5, y: 64, z: 0 }).position
let w0 = null
const clear = (w, opts = {}) => { w0 = w; return SK.clearChestLid(w.bot, C(), { signal: new AbortController().signal, msLeft: cap => cap, by: 'test', ...opts }) }
// LIDPLANK-01: the build records a wood lid is judged against, written into the world's own pool dir (lidWorld makes a fresh one)
const { projKey } = await import('../src/buildproj.mjs')
const { SHOP_PLOT } = await import('../src/shop.mjs')
const workshopRecord = (cells = [[5, 65, 0]]) => fs.writeFileSync(path.join(process.env.POOL_STATE_DIR, `${projKey({ x: 0, y: 64, z: 0 }, SHOP_PLOT)}.g1.json`),
  JSON.stringify({ gen: 1, prev: null, cells: cells.map(at => ({ at, block: 'oak_planks', state: 'placed' })) }))
const treeFarmRecord = (cols = [[5, 0]]) => fs.writeFileSync(path.join(process.env.POOL_STATE_DIR, 'treefarm-0_64_0.g1.json'), JSON.stringify({ cells: cols.map(([x, z]) => ({ x, z })) }))

await t('ACTUATOR: a stone pickaxe in the bag is EQUIPPED before digTime -> a 3,250 ms budget, the dig in the lid scope, `dig(..., ignore)`, the lid air, one `_lid_clear outcome=dug` row', async () => {
  const w = lidWorld([tool('stone_pickaxe', 10), stack('dirt', 5)])
  const n0 = RECS.length
  const r = await clear(w)
  assert.equal(r.outcome, 'dug', r.detail)
  assert.equal(w.nameAt(5, 65, 0), 'air')
  assert.deepEqual(w.digs.map(d => [d.at, d.held, d.force, d.scope?.purpose, d.scope?.by]), [['5,65,0', 'stone_pickaxe', 'ignore', 'lid', 'test']])
  const rows = rowsSince(n0, '_lid_clear')
  assert.equal(rows.length, 1)
  assert.match(rows[0], /^outcome=dug by=test at=5,64,0 key=5,64,0 lid=cobblestone above=air tool=stone_pickaxe dig_ms=750 budget=3250$/)
})
await t('ACTUATOR: no pickaxe -> the bare hand (10,000 ms), budgeted 12,500 ms -- the case the old 10,000 ms race always lost', async () => {
  const w = lidWorld([stack('dirt', 5)])
  const n0 = RECS.length
  const r = await clear(w)
  assert.equal(r.outcome, 'dug')
  assert.match(rowsSince(n0, '_lid_clear')[0], / tool=hand dig_ms=10000 budget=12500$/)
})
await t('ACTUATOR: nothing to do -- a clear lid, a chest on a chest, a barrel under cobblestone: no dig, no row', async () => {
  for (const [lid, cont] of [[null, 'chest'], ['chest', 'chest'], ['cobblestone', 'barrel']]) {
    const w = lidWorld([], { lid })
    if (cont !== 'chest') w.set(5, 64, 0, cont)
    const n0 = RECS.length
    const r = await clear(w)
    assert.equal(r.outcome, 'not_blocked', `${lid} on ${cont}`)
    assert.equal(w.digs.length, 0); assert.equal(rowsSince(n0, '_lid_clear').length, 0)
  }
})
await t('ACTUATOR REFUSES (evidence about the lid): planks on the lid; water beside it; gravel above it -- no dig, a `_lid_clear outcome=refused` row naming why', async () => {
  const cases = [['oak_planks', w => {}, /oak_planks is part of the workshop record/], ['cobblestone', w => w.set(6, 65, 0, 'water'), /water or lava/], ['cobblestone', w => w.set(5, 66, 0, 'gravel'), /fall/]]
  for (const [lid, setup, why] of cases) {
    const w = lidWorld([tool('stone_pickaxe', 10)], { lid })
    if (lid === 'oak_planks') { w.set(5, 65, 0, 'oak_planks'); workshopRecord() }   // lidplank-01: a RECORD plank stays refused
    setup(w)
    const n0 = RECS.length
    const r = await clear(w)
    assert.equal(r.outcome, 'refused', lid)
    assert.equal(w.digs.length, 0, 'no dig')
    assert.match(rowsSince(n0, '_lid_clear')[0], /^outcome=refused /)
    assert.match(r.detail, why)
  }
})
await t('ACTUATOR, THE CALLER\'S LIMITS: our clock (no_time), off the ground for a second (slow), a hand it could not take (hand), out of reach (reach) -- no dig in any', async () => {
  { const w = lidWorld([]); const r = await clear(w, { msLeft: cap => Math.min(cap, 5000) }); assert.equal(r.outcome, 'no_time'); assert.equal(w.digs.length, 0) }
  {
    // A REAL DEADLINE that the look eats into: the budget fitted before the look and not after it -> no dig (Codex code r2 P2)
    const w = lidWorld([tool('stone_pickaxe', 10)]); const end = Date.now() + 3_600
    w.bot.lookAt = async () => { await new Promise(r => setTimeout(r, 600)) }
    const r = await clear(w, { msLeft: cap => Math.max(0, Math.min(cap, end - Date.now())) })
    assert.equal(r.outcome, 'no_time', r.detail); assert.equal(w.digs.length, 0, 'no dig started past the caller\'s deadline')
  }
  { const w = lidWorld([]); w.bot.entity.onGround = false; const t0 = Date.now(); const r = await clear(w); assert.equal(r.outcome, 'slow'); assert.ok(Date.now() - t0 >= 900, 'it waited to land first'); assert.equal(w.digs.length, 0) }
  { const w = lidWorld([tool('stone_pickaxe', 10)]); w.bot.equip = async () => {}; const r = await clear(w); assert.equal(r.outcome, 'hand'); assert.equal(w.digs.length, 0) }
  { const w = lidWorld([]); w.bot.canDigBlock = () => false; const r = await clear(w); assert.equal(r.outcome, 'reach'); assert.equal(w.digs.length, 0) }
})
await t('ACTUATOR, THE FINAL CHECK: the lid turns to planks during the look -> refused, no dig (the check is on a fresh read after the last await)', async () => {
  const w = lidWorld([tool('stone_pickaxe', 10)])
  workshopRecord()   // lidplank-01: planks a record holds (unrecorded planks may be dug now)
  w.bot.lookAt = async () => { w.set(5, 65, 0, 'oak_planks') }
  const r = await clear(w)
  assert.equal(r.outcome, 'refused'); assert.equal(w.digs.length, 0)
})
await t('ACTUATOR: the server puts the block back -> unconfirmed; a dig that throws -> failed; an abort mid-dig -> a row, and the abort propagates', async () => {
  { const w = lidWorld([]); w.bot.dig = async () => {}; const r = await clear(w); assert.equal(r.outcome, 'unconfirmed') }
  // mineflayer's own cancellation (another dig, a reflex's stopDigging) is an interruption, not evidence about the lid
  { const w = lidWorld([]); w.bot.dig = async () => { throw new Error('Digging aborted') }; const r = await clear(w); assert.equal(r.outcome, 'interrupted') }
  { const w = lidWorld([]); w.bot.dig = async () => { throw new Error('dig refused') }; const r = await clear(w); assert.equal(r.outcome, 'failed') }
  {
    const w = lidWorld([]); w.bot.dig = () => new Promise(() => {})   // never ends: the budget runs out (12.5 s for the hand -> use a pickaxe)
    w.bag.push(tool('stone_pickaxe', 10))
    const t0 = Date.now(); const r = await clear(w)
    assert.equal(r.outcome, 'failed', 'a dig that ran its whole budget'); assert.ok(Date.now() - t0 >= 3000, 'it waited the 3,250 ms budget')
  }
  // the wells unreadable: refused, but as `unknown` (no memory) -- before the hand, and at the final check after the look
  { const w = lidWorld([]); w.bot.wellCellsNow = () => { throw new Error('boom') }; const r = await clear(w); assert.equal(r.outcome, 'unknown'); assert.equal(w.digs.length, 0) }
  { const w = lidWorld([]); w.bot.lookAt = async () => { w.bot.wellCellsNow = () => { throw new Error('boom') } }; const r = await clear(w); assert.equal(r.outcome, 'unknown'); assert.equal(w.digs.length, 0) }
  {
    const w = lidWorld([]); const ac = new AbortController()
    w.bot.dig = async () => { ac.abort(); throw Object.assign(new Error('aborted'), { aborted: true }) }
    const n0 = RECS.length
    let threw = false
    try { await clear(w, { signal: ac.signal }) } catch { threw = true }
    assert.ok(threw); assert.match(rowsSince(n0, '_lid_clear')[0], /^outcome=aborted /)
  }
})
await t('ACTUATOR, A DOUBLE CHEST: only the PARTNER half is blocked -> its lid is dug (vanilla: either half blocks both)', async () => {
  const w = lidWorld([tool('stone_pickaxe', 10)], { lid: null })
  const off = CF.chestPartnerOffset({ facing: 'north', type: 'left' })
  w.set(5, 64, 0, 'chest', { facing: 'north', type: 'left' })
  w.set(5 + off.x, 64, 0 + off.z, 'chest', { facing: 'north', type: 'right' })
  w.set(5 + off.x, 65, 0 + off.z, 'cobblestone')
  const r = await clear(w)
  assert.equal(r.outcome, 'dug', r.detail)
  assert.deepEqual(w.digs.map(d => d.at), [`${5 + off.x},65,${0 + off.z}`])
})

// ------------------------------------------------------------------------------- THE REFUSAL CHAIN, through real code
// count_town on a fenced town whose only chest has cobblestone on its lid. The base failed `lid_blocked` before walking
// and the town stayed unknown for good; now: walk -> clear -> open (the SERVER's rule in the fake) -> a journal count ->
// the next plan is judged.
const fencedLid = async (bag, lid = 'cobblestone') => {
  const w = lidWorld(bag, { lid: null })
  w.stock(5, 64, 0, [stack('oak_log', 20)])
  installCobbleCap(w.bot); B.setStockWellProbe(() => true)
  await cobbleObserve(w.bot, { x: 5, y: 64, z: 0 }, await w.bot.openContainer(w.bot.blockAt({ x: 5, y: 64, z: 0 })))
  const dir = process.env.POOL_STATE_DIR
  const key = fs.readdirSync(dir).find(f => f.endsWith('.cobble.jsonl')).replace('.cobble.jsonl', '')
  await new Promise(r => setTimeout(r, 5))
  CC.appendJournal(dir, key, w.bot.worldId ?? null, { t: 'reset', at: Date.now() - 1 })
  if (lid) w.set(5, 65, 0, lid)
  return { w, dir, key }
}
const missesOf = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.recount.json'))), 'utf8')).m } catch { return {} } }
const runCount = (w, signal = new AbortController().signal) => SKILLS.count_town.run({ bot: w.bot }, {}, signal)

await t('CHAIN: count_town on a town whose chest has cobblestone on its lid -> walks, digs the lid, OPENS, counts (unknown_after=0) -> the next plan is judged on the count (room 44 under 64)', async () => {
  const { w } = await fencedLid([stack('oak_log', 64), stack('oak_log', 64), tool('stone_pickaxe', 10)])
  try {
    SK.resetCobbleReconcile()
    assert.deepEqual(SK.unknownRefusals(w.bot).map(r => `${r.name}:${r.why}`), ['oak_log:town_stock_unknown'], 'the town cannot judge')
    assert.equal(B.bankableExclusion(w.bot.inventory.items(), 'oak_log'), 'town_stock_unknown')
    const n0 = RECS.length, o0 = w.spy.opened.length
    const r = await runCount(w)
    assert.equal(r.status, 'success', r.detail); assert.equal(r.counted, 1)
    assert.equal(w.nameAt(5, 65, 0), 'air', 'the lid was dug')
    assert.equal(w.spy.opened.length - o0, 1, 'the server opened it')
    assert.match(rowsSince(n0, '_stock_recount')[0], /counted=1 tried=1 unknown_after=0 fails=- /)
    assert.match(rowsSince(n0, '_lid_clear')[0], /^outcome=dug by=count_town at=5,64,0 /)
    assert.deepEqual(SK.unknownRefusals(w.bot), [], 'nothing held is refused as not yet counted')
    assert.equal(B.bankableInventory(w.bot.inventory.items(), { wants: ['oak_log'] }).detail.oak_log, 44, 'judged on the count')
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('CHAIN, POSITIVE CONTROL OF THE INSTRUMENT: the fake server refuses the open under cobblestone -- a lid the bot does NOT dig is never counted', async () => {
  const { w } = await fencedLid([stack('oak_log', 64), stack('oak_log', 64)])
  try {
    SK.resetCobbleReconcile()
    w.bot.dig = async () => {}                                  // the swing lands nothing
    const n0 = RECS.length
    const r = await runCount(w)
    assert.equal(r.counted, 0)
    assert.match(rowsSince(n0, '_stock_recount')[0], /counted=0 tried=1 unknown_after=1 .*fails=lid_not_cleared:1 /)
    assert.equal(B.bankableExclusion(w.bot.inventory.items(), 'oak_log'), 'town_stock_unknown', 'still unknown: the cap stays closed')
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('CHAIN, A REFUSED LID: planks on it -> NO WALK, `lid_blocked` as before plus a refused row; no recount miss, the container memory untouched', async () => {
  const { w, dir, key } = await fencedLid([stack('oak_log', 64), stack('oak_log', 64)], 'oak_planks')
  workshopRecord()   // lidplank-01: the refused case is now a plank a build record holds
  try {
    SK.resetCobbleReconcile()
    const g0 = w.spy.gotos.length, n0 = RECS.length
    const r = await runCount(w)
    assert.equal(r.counted, 0)
    assert.equal(w.spy.gotos.length - g0, 0, 'never walked')
    assert.match(rowsSince(n0, '_stock_recount')[0], /fails=lid_blocked:1 /)
    assert.match(rowsSince(n0, '_lid_clear')[0], /^outcome=refused by=count_town .*lid=oak_planks/)
    assert.equal((missesOf(dir)['5,64,0'] ?? []).length, 0, 'no recount miss')
    assert.equal(CF.readTownMemory(dir, key, w.bot.worldId ?? null)['5,64,0'], undefined, 'the container memory untouched')
  } finally { B.setStockReaders({ town: null, well: null }) }
})
// ------------------------------------------------------------------------------------------- LIDPLANK-01 (owner 10-28/29)
await t('LIDPLANK-01 RULE: a full wood block comes off a lid only when every build record was read and none holds the cell; a record keeps it, named; unread records keep the old refusal; the hazards still apply', () => {
  const R = (lid, record, extra = {}) => L.lidClearRefusal({ lid: { name: lid }, above: AIR, sides: sides4(), record, ...extra })
  for (const n of ['oak_planks', 'spruce_planks', 'bamboo_planks', 'oak_log', 'stripped_birch_log', 'dark_oak_wood', 'crimson_stem', 'warped_hyphae', 'bamboo_block', 'bamboo_mosaic']) {
    assert.equal(R(n, false), null, `${n}: no record -> breakable`)
    assert.match(R(n, 'workshop') ?? '', new RegExp(`${n} is part of the workshop record`))
    assert.match(R(n, undefined) ?? '', /is not a block a bot may break off a lid \(the build records were not read\)/, `${n}: unknown records`)
    assert.match(R(n, null) ?? '', /were not read/)
  }
  for (const n of ['stone_bricks', 'chest', 'crafting_table', 'oak_slab', 'oak_stairs', 'glass', 'oak_leaves', 'bookshelf']) assert.match(R(n, false) ?? '', /is not a block a bot may break off a lid$/, `${n}: never wood-family full block`)
  assert.equal(R('cobblestone', 'townplan'), null, 'the old breakables are not record-gated (unchanged)')
  assert.match(R('oak_planks', false, { well: true }), /junk well/, 'the well still refuses')
  assert.match(L.lidClearRefusal({ lid: { name: 'oak_planks' }, above: { name: 'gravel' }, sides: sides4(), record: false }), /would fall/)
  assert.match(L.lidClearRefusal({ lid: { name: 'oak_planks' }, above: AIR, sides: [AIR, { name: 'water' }, AIR, AIR], record: false }), /water or lava/)
})
await t('LIDPLANK-01 READER: lidRecordAt names the record that holds the cell -- workshop, tree farm (any height), town plan -- false when none, null when the records cannot be read', async () => {
  const w = lidWorld([], { lid: 'oak_planks' })
  const p = { x: 5, y: 65, z: 0 }
  w.bot.townPlan = undefined
  assert.equal(SK.lidRecordAt(w.bot, p), false, 'a fresh town: no record')
  workshopRecord(); assert.equal(SK.lidRecordAt(w.bot, p), 'workshop')
  const w2 = lidWorld([], { lid: 'oak_planks' }); treeFarmRecord(); w2.bot.townPlan = null
  assert.equal(SK.lidRecordAt(w2.bot, { x: 5, y: 80, z: 0 }), 'treefarm')
  const w3 = lidWorld([], { lid: 'oak_planks' }); w3.bot.townPlan = { gen: 1, plan: {}, cells: new Set(['5,65,0']) }
  assert.equal(SK.lidRecordAt(w3.bot, p), 'townplan')
  assert.equal(SK.lidRecordAt(w3.bot, { x: 6, y: 65, z: 0 }), false, 'the next cell is no record')
  // Codex r1 blocker 1: a tree-farm record that exists but cannot be parsed is UNKNOWN (refused), never "no record"
  const w5 = lidWorld([], { lid: 'oak_planks' }); w5.bot.townPlan = null
  fs.writeFileSync(path.join(process.env.POOL_STATE_DIR, 'treefarm-0_64_0.g1.json'), '{not json')
  assert.equal(SK.lidRecordAt(w5.bot, p), null, 'an unparseable tree-farm record: unknown')
  assert.match(L.lidMaterialRefusal('oak_planks', { record: SK.lidRecordAt(w5.bot, p) }), /were not read/)
  // Codex r1 blocker 2: the plan ON DISK is read whatever the bot's cached copy (and the planner switch): a placed plan cell
  const w6 = lidWorld([], { lid: 'oak_planks' }); w6.bot.townPlan = null
  const PS = await import('../src/planstore.mjs')
  const KEYP = PS.planKey({ x: 0, y: 64, z: 0 }), WID = w6.bot.worldId ?? null
  const planBody = () => ({ template: 'ring@1', home: { x: 0, y: 64, z: 0 }, s: 64, mode: 'greenfield', orientation: 'E',
    plots: [{ id: 'store', kind: 'storehouse', box: [3, -2, 7, 2], y: 64, state: 'planned', keepout: true,
      cells: [{ at: [5, 65, 0], kind: 'chest', stand: [5, 65, 1], role: null, group: null, state: 'free' }] }],
    paths: [], groups: { v: 1, status: 'greenfield', homes: {}, overflow: [], drain: [], pending: [] }, zones: { n: 0, avoid: 0 } })
  const pub0 = PS.publishPlan(process.env.POOL_STATE_DIR, KEYP, WID, () => planBody(), { by: 'Other' })
  assert.equal(pub0.result, 'accepted', JSON.stringify(pub0).slice(0, 200))
  assert.equal(SK.lidRecordAt(w6.bot, p), false, 'a FREE plan cell is no structure yet (planFurnitureCells: placed or reserved)')
  const pub = PS.publishPlan(process.env.POOL_STATE_DIR, KEYP, WID, cur => { Object.assign(cur.plots[0].cells[0], { state: 'reserved', by: 'Other', visit: 'v', until: Date.now() + 120_000 }); return cur }, { by: 'Other' })
  assert.equal(pub.result, 'accepted', JSON.stringify(pub).slice(0, 200))
  assert.equal(SK.lidRecordAt(w6.bot, p), 'townplan', 'the disk plan holds it though the bot never read the plan')
  // Codex merge review 10-30 BLOCKER: a workshop / plan generation that exists but cannot be parsed is UNKNOWN, never "none"
  {
    const saved0 = process.env.POOL_STATE_DIR
    process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-lid-bad-'))
    try {
      const wb = lidWorld([], { lid: 'oak_planks' }); wb.bot.townPlan = null
      assert.equal(SK.lidRecordAt(wb.bot, p), false, 'positive control: a fresh dir, no record')
      const shopF = path.join(process.env.POOL_STATE_DIR, `${projKey({ x: 0, y: 64, z: 0 }, SHOP_PLOT)}.g1.json`)
      fs.writeFileSync(shopF, '{not json')
      assert.equal(SK.lidRecordAt(wb.bot, p), null, 'an unparseable workshop ROOT: unknown (was false: a dig)')
      fs.unlinkSync(shopF)
      assert.equal(SK.lidRecordAt(wb.bot, p), false, 'and back to none once the bad file is gone')
      fs.writeFileSync(path.join(process.env.POOL_STATE_DIR, `${PS.planKey({ x: 0, y: 64, z: 0 })}.g1.json`), '{not json')
      PS.resetPlanWalks?.()
      assert.equal(SK.lidRecordAt(wb.bot, p), null, 'an unparseable town plan generation: unknown')
    } finally { process.env.POOL_STATE_DIR = saved0; PS.resetPlanWalks?.() }
  }
  const saved = process.env.POOL_STATE_DIR
  const notDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-lid-nd-')), 'file'); fs.writeFileSync(notDir, 'x')
  process.env.POOL_STATE_DIR = notDir
  try { const w4 = { bot: { ...w3.bot, townPlan: null } }; assert.equal(SK.lidRecordAt(w4.bot, p), null, 'unreadable records: unknown') } finally { process.env.POOL_STATE_DIR = saved }
})
await t('LIDPLANK-01 ACTUATOR: oak_planks in no record -> dug (the lid scope, a `_lid_clear outcome=dug lid=oak_planks` row); the same planks in the workshop record or the town plan -> refused, named, no dig', async () => {
  {
    const w = lidWorld([tool('stone_pickaxe', 10)], { lid: 'oak_planks' }); w.bot.townPlan = null
    const n0 = RECS.length
    const r = await clear(w)
    assert.equal(r.outcome, 'dug', r.detail); assert.equal(w.nameAt(5, 65, 0), 'air')
    assert.deepEqual(w.digs.map(d => [d.at, d.scope?.purpose]), [['5,65,0', 'lid']])
    assert.match(rowsSince(n0, '_lid_clear')[0], /^outcome=dug by=test at=5,64,0 .*lid=oak_planks /)
  }
  {
    const w = lidWorld([tool('stone_pickaxe', 10)], { lid: 'oak_planks' }); workshopRecord()
    const r = await clear(w)
    assert.equal(r.outcome, 'refused'); assert.match(r.detail, /part of the workshop record/); assert.equal(w.digs.length, 0)
  }
  {
    const w = lidWorld([tool('stone_pickaxe', 10)], { lid: 'oak_planks' }); w.bot.townPlan = { gen: 1, plan: {}, cells: new Set(['5,65,0']) }
    const r = await clear(w)
    assert.equal(r.outcome, 'refused'); assert.match(r.detail, /part of the townplan record/); assert.equal(w.digs.length, 0)
  }
})
await t('LIDPLANK-01 CHAIN: count_town on a town whose chest has an UNRECORDED oak_planks lid (placebo-a 250,74,-141) -> walks, digs the planks, OPENS, counts (unknown_after=0) -> the town judges the bag; CONTROL: the record-held plank is refused above', async () => {
  const { w } = await fencedLid([stack('oak_log', 64), stack('oak_log', 64), tool('stone_pickaxe', 10)], 'oak_planks')
  try {
    SK.resetCobbleReconcile(); w.bot.townPlan = null
    assert.equal(B.bankableExclusion(w.bot.inventory.items(), 'oak_log'), 'town_stock_unknown', 'positive control: the town cannot judge')
    const n0 = RECS.length, o0 = w.spy.opened.length
    const r = await runCount(w)
    assert.equal(r.status, 'success', r.detail); assert.equal(r.counted, 1)
    assert.equal(w.nameAt(5, 65, 0), 'air', 'the planks were dug')
    assert.equal(w.spy.opened.length - o0, 1, 'the server opened it')
    assert.match(rowsSince(n0, '_lid_clear')[0], /^outcome=dug by=count_town at=5,64,0 .*lid=oak_planks /)
    assert.match(rowsSince(n0, '_stock_recount')[0], /counted=1 tried=1 unknown_after=0 /)
    assert.notEqual(B.bankableExclusion(w.bot.inventory.items(), 'oak_log'), 'town_stock_unknown', 'judged on the count')
  } finally { B.setStockReaders({ town: null, well: null }) }
})
await t('LIDPLANK-01 MUTANT KILLED: the record ignored (record: false always) -> the workshop\'s own plank is dug', async () => {
  await withMutant(SKILLS_PATH, "LID_BREAKABLE.test(lid.name) ? lidRecordAt(bot, c.offset(0, 1, 0)) : undefined", "LID_BREAKABLE.test(lid.name) ? false : undefined", async M => {
    const w = lidWorld([tool('stone_pickaxe', 10)], { lid: 'oak_planks' }); workshopRecord()
    const r = await M.clearChestLid(w.bot, w.bot.blockAt({ x: 5, y: 64, z: 0 }).position, { msLeft: cap => cap, by: 'mutant' })
    assert.equal(r.outcome, 'dug', 'the mutant digs a record cell')
  })
})
await t('CHAIN, A FAILED CLEAR AND A CALLER LIMIT: neither writes a recount miss nor the container memory; the bot backs off itself only', async () => {
  for (const [name, setup, fails] of [['failed', w => { w.bot.dig = async () => { throw new Error('nope') } }, 'lid_not_cleared:1'],
    ['slow', w => { w.bot.digTime = () => 60_000 }, 'lid_not_now:1']]) {
    const { w, dir, key } = await fencedLid([stack('oak_log', 64), stack('oak_log', 64)])
    try {
      SK.resetCobbleReconcile(); setup(w)
      const n0 = RECS.length
      await runCount(w)
      assert.match(rowsSince(n0, '_stock_recount')[0], new RegExp(`fails=${fails} `), name)
      assert.equal((missesOf(dir)['5,64,0'] ?? []).length, 0, `${name}: no recount miss`)
      assert.equal(CF.readTownMemory(dir, key, w.bot.worldId ?? null)['5,64,0'], undefined, `${name}: memory untouched`)
      assert.deepEqual(SK.stockRecountKeys(w.bot), [], `${name}: this bot backs off it (its own reconcile backoff)`)
      SK.resetCobbleReconcile()
      assert.deepEqual(SK.stockRecountKeys(w.bot), ['5,64,0'], `${name}: still a key for the town (another bot, a better stance)`)
    } finally { B.setStockReaders({ town: null, well: null }) }
  }
})

// ------------------------------------------------------------------------------------------------- the deposit
const depositRun = w => SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
await t('DEPOSIT: cobblestone on the first chest\'s lid and no pickaxe -> the bare hand digs it on its 12.5 s budget and the deposit lands', async () => {
  const w = lidWorld([stack('oak_log', 64), stack('dirt', 64), ...Array.from({ length: 33 }, () => stack('torch', 64))])
  const r = await depositRun(w)
  assert.equal(w.nameAt(5, 65, 0), 'air', JSON.stringify(r))
  assert.ok(w.spy.opened.includes('5,64,0'), 'opened')
  assert.equal(w.digs[0]?.held ?? null, null, 'the hand')
})
await t('DEPOSIT MEMORY: a refused lid (planks) marks the container unavailable for the town; a caller limit (off the ground) marks NOTHING and says lid_not_now', async () => {
  {
    const w = lidWorld([stack('oak_log', 64), ...Array.from({ length: 34 }, () => stack('torch', 64))], { lid: 'oak_planks' })
    workshopRecord()   // lidplank-01: planks a build record holds (unrecorded planks are dug: the next scene)
    await depositRun(w)
    const mem = CF.readTownMemory(process.env.POOL_STATE_DIR, CF.townKey({ x: 0, y: 64, z: 0 }), w.bot.worldId ?? null)
    assert.equal(mem['5,64,0']?.o, 'unavailable', JSON.stringify(mem))
  }
  {
    // LIDPLANK-01 CHAIN (deposit): the same planks in no record -> dug, the chest opened, the deposit took (memory `took`)
    const w = lidWorld([stack('oak_log', 64), ...Array.from({ length: 34 }, () => stack('torch', 64))], { lid: 'oak_planks' })
    w.bot.townPlan = null
    await depositRun(w)
    assert.equal(w.nameAt(5, 65, 0), 'air'); assert.ok(w.spy.opened.includes('5,64,0'), 'opened')
    const mem = CF.readTownMemory(process.env.POOL_STATE_DIR, CF.townKey({ x: 0, y: 64, z: 0 }), w.bot.worldId ?? null)
    assert.equal(mem['5,64,0']?.o, 'took', JSON.stringify(mem))
  }
  {
    const w = lidWorld([stack('oak_log', 64), ...Array.from({ length: 34 }, () => stack('torch', 64))])
    w.bot.digTime = () => 60_000
    const r = await depositRun(w)
    assert.equal(r.failClass, 'lid_not_now', JSON.stringify(r))
    const mem = CF.readTownMemory(process.env.POOL_STATE_DIR, CF.townKey({ x: 0, y: 64, z: 0 }), w.bot.worldId ?? null)
    assert.equal(mem['5,64,0'], undefined, 'nothing remembered')
  }
})
await t('DEPOSIT, A CALLER LIMIT LOOPS NOWHERE: lid_not_now puts THIS chest in the bot\'s own skip list (skipContainers), so the next deposit takes another chest; the town memory stays clean', async () => {
  const w = lidWorld([stack('oak_log', 64), ...Array.from({ length: 34 }, () => stack('torch', 64))])
  w.bot.digTime = () => 60_000
  const r = await depositRun(w)
  assert.equal(r.failClass, 'lid_not_now')
  assert.ok((w.bot.skipContainers?.get('5,64,0') ?? 0) > Date.now(), 'this bot skips it for a while')
  w.set(5, 64, 4, 'chest')                                     // a second town chest, lid clear
  const n0 = w.spy.opened.length
  await depositRun(w)
  assert.deepEqual(w.spy.opened.slice(n0), ['5,64,4'], 'the next deposit went to the other chest')
})
await t('THE RECOVERY SWEEP: a full first chest, then a second whose lid the bot cannot clear from here -> `unknown:lid` for this sweep, no strike, nothing remembered', async () => {
  const w = lidWorld([stack('oak_log', 64), ...Array.from({ length: 34 }, () => stack('torch', 64))], { lid: null })
  w.fill(5, 64, 0, 'stone', 64)                                 // the first chest is full
  w.set(5, 64, 3, 'chest'); w.set(5, 65, 3, 'cobblestone')     // the second has cobblestone on its lid
  w.bot.digTime = () => 60_000                                 // ...and from here the dig would be too slow
  const n0 = RECS.length
  await depositRun(w)
  const mem = CF.readTownMemory(process.env.POOL_STATE_DIR, CF.townKey({ x: 0, y: 64, z: 0 }), w.bot.worldId ?? null)
  assert.equal(mem['5,64,3'], undefined, `no strike, nothing remembered: ${JSON.stringify(mem['5,64,3'])}`)
  assert.ok(rowsSince(n0, '_deposit_new_chest').some(d => /5,64,3:unknown:lid/.test(d)), rowsSince(n0, '_deposit_new_chest').join(' | '))
})
await t('WITHDRAW: a pickaxe-less bot at a chest with cobblestone on its lid digs it bare-handed and opens it (the fleet\'s `would not break` rows)', async () => {
  const w = lidWorld([stack('dirt', 5)])
  w.stock(5, 64, 0, [tool('stone_pickaxe', 0)])
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  const n0 = RECS.length
  await SKILLS.withdraw_pick.run({ bot: w.bot }, {}, new AbortController().signal)
  assert.equal(w.nameAt(5, 65, 0), 'air')
  assert.match(rowsSince(n0, '_lid_clear')[0] ?? '', /^outcome=dug by=withdraw .*tool=hand dig_ms=10000 budget=12500/)
  assert.ok(w.spy.opened.includes('5,64,0'), 'the server opened it')
})
// ------------------------------------------------------------------- composition with plinth-01 (the raised well)
await t('PLINTH: a raised well\'s shell (the 5x5 box g-3..g) and its STAIR cells are never dug off a lid -- through the real wellBreakCost and the column knownWellCells hands it; positive control: the same lid with no well is dug', async () => {
  for (const [name, cols] of [['the shell box', [{ x: 6, y: 67, z: 1 }]], ['a stair cell', [{ x: 20, y: 70, z: 20, stair: [[5, 65, 0]] }]]]) {
    const w = lidWorld([tool('stone_pickaxe', 10)])
    w.bot.wellCellsNow = () => cols
    const n0 = RECS.length
    const r = await clear(w)
    assert.equal(r.outcome, 'refused', name); assert.equal(w.digs.length, 0, `${name}: no dig`)
    assert.match(rowsSince(n0, '_lid_clear')[0], /why=the lid cell is part of the junk well/, name)
  }
  const w = lidWorld([tool('stone_pickaxe', 10)])
  w.bot.wellCellsNow = () => [{ x: 20, y: 70, z: 20, stair: [[20, 66, 21]] }]
  assert.equal((await clear(w)).outcome, 'dug', 'a well elsewhere does not refuse this lid')
})
await t('PLINTH FUNDING: the plinth\'s chest draw is the `withdraw` skill -- at a chest with cobblestone on its lid it clears the lid (by=withdraw) and opens it', async () => {
  const w = lidWorld([tool('stone_pickaxe', 10), stack('dirt', 5)])
  w.stock(5, 64, 0, [stack('cobblestone', 64)])
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  const n0 = RECS.length
  await SKILLS.withdraw.run({ bot: w.bot }, { item: 'cobblestone', count: 32 }, new AbortController().signal)
  assert.equal(w.nameAt(5, 65, 0), 'air')
  assert.match(rowsSince(n0, '_lid_clear')[0] ?? '', /^outcome=dug by=withdraw .*tool=stone_pickaxe/)
  assert.ok(w.spy.opened.includes('5,64,0'), 'opened')
})
await t('PLINTH ORDER CHAIN (structural, comments stripped): build_plinth > town_deposit > count_town is unchanged by this diff -- the recount still yields to both, and its lid clear runs on the next decision', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const c = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  assert.match(c, /order = this\.#plinthOrder\(\) \?\? this\.#foundOrder\(milestone\) \?\? this\.#townDepositOrder\(milestone\) \?\? order/)   // found-01 re-anchor
  assert.match(c, /if \(!order \|\| \(order\.skill !== 'town_deposit' && order\.skill !== 'build_plinth' && order\.skill !== 'found_store' && order\.skill !== 'found_work'\)\) order = this\.#recountOrder\(\) \?\? order/)
})
await t('WIRING (structural, comments stripped): the deposit, the withdraw and the recount each call the one actuator', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const c = strip(readFileSync(SKILLS_PATH, 'utf8'))
  const fn = name => { const s = c.indexOf(name); assert.ok(s > 0, name); return c.slice(s, c.indexOf('\n}\n', s)) }
  const dep = fn('async function deposit(')
  assert.match(dep, /await clearChestLid\(bot, chestBlock\.position, \{ signal, msLeft, by: 'deposit' \}\)/)
  assert.match(dep, /if \(lc\.outcome === 'no_time'\) return outOfTime\('clearing the lid of'\)/, 'our clock is outOfTime, never the town memory')
  assert.match(fn('async function openForWithdraw ('), /await clearChestLid\(bot, cp, \{ signal, msLeft, by: 'withdraw' \}\)/)
  assert.match(fn('export async function reconcileCobble ('), /await clearChestLid\(bot, c, \{ signal, msLeft: cap => Math\.max\(0, msLeft\(cap \+ LID_OPEN_RESERVE_MS\) - LID_OPEN_RESERVE_MS\), by: 'count_town' \}\)/)
  assert.equal(SK.LID_OPEN_RESERVE_MS >= 8_000, true, 'the open keeps its whole 8 s')
  assert.doesNotMatch(c, /bot\.dig\(lid\)/, 'no unequipped lid dig is left')
})

// ------------------------------------------------------------------------------------------- anchored mutants
await t('MUTANT KILLED: the base recount (fail any blocked lid before walking) leaves the town uncounted', async () => {
  // towndeposit-01: the recount's pre-walk rule is countSkip (towndeposit.mjs countSkipWhy), shared with the count offer
  await withMutant(SKILLS_PATH, "      const skip = countSkip(bot, c)\n",
    "      const skip = /chest/.test(blockNameOf(bot, b) ?? '') && chestLidBlocked(bot.blockAt(c.offset(0, 1, 0))) ? 'lid blocked' : null\n", async M => {
      const { w } = await fencedLid([stack('oak_log', 64), stack('oak_log', 64), tool('stone_pickaxe', 10)])
      try {
        M.resetCobbleReconcile(); M.installCobbleCap(w.bot)
        const r = await M.SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
        assert.equal(r.counted, 0, 'the mutant reproduces the defect')
        assert.equal(w.nameAt(5, 65, 0), 'cobblestone')
      } finally { B.setStockReaders({ town: null, well: null }) }
    })
})
await t('MUTANT KILLED: no equip (the base\'s unequipped dig) -> the bare hand\'s 12,500 ms budget even with a stone pickaxe in the bag', async () => {
  await withMutant(SKILLS_PATH, '  const d = toolFor(j.s.lid, bot.inventory?.items?.() ?? [])', '  const d = { item: null }', async M => {
    const w = lidWorld([tool('stone_pickaxe', 10)])
    const n0 = RECS.length
    await M.clearChestLid(w.bot, w.bot.blockAt({ x: 5, y: 64, z: 0 }).position, { msLeft: cap => cap, by: 'mutant' })
    assert.match(rowsSince(n0, '_lid_clear')[0], / tool=hand dig_ms=10000 budget=12500$/, 'the mutant digs bare-handed')
  })
})
await t('MUTANT KILLED: without the final check after the look, a lid that turned to planks is dug', async () => {
  await withMutant(SKILLS_PATH, '  // THE FINAL CHECK, on a fresh read, with no await between it and the dig packet (Codex design r1 P1)\n  j = lidJudge(bot, c)\n',
    '  // (mutant: no fresh read)\n', async M => {
      const w = lidWorld([tool('stone_pickaxe', 10)])
      w.bot.lookAt = async () => { w.set(5, 65, 0, 'oak_planks') }
      await M.clearChestLid(w.bot, w.bot.blockAt({ x: 5, y: 64, z: 0 }).position, { msLeft: cap => cap, by: 'mutant' })
      assert.equal(w.digs.length, 1, 'the mutant dug the planks')
    })
})
await t('MUTANT KILLED: one half only -> a double chest blocked on its partner stays shut', async () => {
  await withMutant(SKILLS_PATH, '  try { const q = chestPartner(bot, chestPos); if (q) halves.push(q) } catch { /* a single chest */ }\n',
    '\n', async M => {
      const w = lidWorld([tool('stone_pickaxe', 10)], { lid: null })
      const off = CF.chestPartnerOffset({ facing: 'north', type: 'left' })
      w.set(5, 64, 0, 'chest', { facing: 'north', type: 'left' }); w.set(5 + off.x, 64, off.z, 'chest', { facing: 'north', type: 'right' }); w.set(5 + off.x, 65, off.z, 'cobblestone')
      const r = await M.clearChestLid(w.bot, w.bot.blockAt({ x: 5, y: 64, z: 0 }).position, { msLeft: cap => cap, by: 'mutant' })
      assert.equal(r.outcome, 'not_blocked', 'the mutant never looks at the partner')
    })
})
await t('MUTANT KILLED: the deposit marking every failed clear unavailable puts a caller limit into the town\'s memory', async () => {
  await withMutant(SKILLS_PATH, "    if (lidFailMemory(lc.outcome) === 'unavailable') return viaRecovery(",
    "    if (lc.outcome !== 'dug' && lc.outcome !== 'not_blocked') return viaRecovery(", async M => {
      const w = lidWorld([stack('oak_log', 64), ...Array.from({ length: 34 }, () => stack('torch', 64))])
      w.bot.digTime = () => 60_000
      await M.SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
      const mem = CF.readTownMemory(process.env.POOL_STATE_DIR, CF.townKey({ x: 0, y: 64, z: 0 }), w.bot.worldId ?? null)
      assert.equal(mem['5,64,0']?.o, 'unavailable', 'the mutant remembers a caller limit')
    })
})
await t('MUTANT KILLED: without the interruption branch, mineflayer\'s own `Digging aborted` is lid evidence (`failed` -> town-wide unavailable)', async () => {
  await withMutant(SKILLS_PATH, "    if (!e?.budgetExceeded && /abort/i.test(String(e?.message ?? e))) return row('interrupted',",
    "    if (false) return row('interrupted',", async M => {
      const w = lidWorld([]); w.bot.dig = async () => { throw new Error('Digging aborted') }
      const r = await M.clearChestLid(w.bot, w.bot.blockAt({ x: 5, y: 64, z: 0 }).position, { msLeft: cap => cap, by: 'mutant' })
      assert.equal(r.outcome, 'failed', 'the mutant calls an interruption a failed lid')
    })
})
await t('MUTANT KILLED: without the per-bot skip, the next deposit walks back to the same chest', async () => {
  await withMutant(SKILLS_PATH, '      bot.skipContainers.set(posKey(chestBlock.position), Date.now() + TARGET_BACKOFF_MS)\n',
    '\n', async M => {
      const w = lidWorld([stack('oak_log', 64), ...Array.from({ length: 34 }, () => stack('torch', 64))])
      w.bot.digTime = () => 60_000
      await M.SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
      w.set(5, 64, 4, 'chest')
      const n0 = w.spy.opened.length
      const r = await M.SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
      assert.equal(r.failClass, 'lid_not_now', 'the mutant goes back to the blocked chest')
      assert.deepEqual(w.spy.opened.slice(n0), [], 'and opens nothing')
    })
})
await t('MUTANT KILLED: without the well veto, a plinth\'s stair cell on a lid is dug', async () => {
  await withMutant(SKILLS_PATH, '  try { well = wellBreakCost(bot.wellCellsNow?.() ?? knownWellCells(bot), { position: c.offset(0, 1, 0) }) > 0 } catch { well = null }',
    '  try { well = false } catch { well = null }', async M => {
      const w = lidWorld([tool('stone_pickaxe', 10)])
      w.bot.wellCellsNow = () => [{ x: 20, y: 70, z: 20, stair: [[5, 65, 0]] }]
      const r = await M.clearChestLid(w.bot, w.bot.blockAt({ x: 5, y: 64, z: 0 }).position, { msLeft: cap => cap, by: 'mutant' })
      assert.equal(r.outcome, 'dug', 'the mutant digs the plinth stair')
    })
})
await t('MUTANT KILLED: the old 10 s cap on the budget (the race a bare hand always lost)', async () => {
  await withMutant(LID_PATH, '  return Math.ceil(d + LID_DIG_MARGIN_MS)', '  return Math.min(10_000, Math.ceil(d + LID_DIG_MARGIN_MS))', async M => {
    assert.ok(!(M.lidDigBudgetMs(10000) > 10000), 'the mutant budgets a bare hand at 10 s')
  })
})
await t('MUTANT KILLED: widening the breakable set to planks would let the clear break a town build', async () => {
  await withMutant(LID_PATH, 'export const LID_BREAKABLE = /^(cobblestone|cobbled_deepslate|dirt|grass_block)$/', 'export const LID_BREAKABLE = /^(cobblestone|cobbled_deepslate|dirt|grass_block|oak_planks)$/', async M => {
    assert.equal(M.lidClearRefusal({ lid: { name: 'oak_planks' }, above: AIR, sides: sides4() }), null, 'the mutant would dig planks')
  })
})
await t('MUTANT KILLED: dropping the waterlogged check digs beside a waterlogged stair', async () => {
  await withMutant(LID_PATH, "const wet = b => LIQUID.test(b?.name ?? '') || b?.props?.waterlogged === true || b?.props?.waterlogged === 'true'",
    "const wet = b => LIQUID.test(b?.name ?? '')", async M => {
      assert.equal(M.lidClearRefusal({ lid: { name: 'cobblestone' }, above: AIR, sides: [AIR, AIR, { name: 'oak_stairs', props: { waterlogged: true } }, AIR] }), null)
    })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
