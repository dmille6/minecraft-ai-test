// INDEXSEARCH-01: the town search opens the containers the town index says hold the need first (design
// docs/reports/town-plan-2026-10-20.md section 7.7), and KITSTICKS: a bag that cannot make the kit's sticks draws them first from
// whichever town container holds them (section 8 K1). Behaviour first: the pure rule by truth table, then the REAL skills in
// the fake world -- the toolkit's iron draw, the smelt job's coal pass -- with the index seeded the way townindex-01 writes it
// (and as the bots' own opens write it), the controls where the index must change nothing (dirty, stale, unknown, a count of
// none, a later miss), the K1 REFUSAL CHAIN through the real order (toolkitOrder -> toolkit -> toolkitOutcome), and anchored
// mutants (the anchor present and unique, or the mutant is not a kill).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-indexsearch-logs-'))
process.env.BOT_NAME = 'IxSearchBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'
process.env.MEMORY_SCOPE = 'shared'; process.env.MEMORY_POOL = 'hive-test'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-indexsearch-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const IS = await import('../src/indexsearch.mjs')
const TI = await import('../src/townindex.mjs')
const K = await import('../src/toolkit.mjs')
const SJ = await import('../src/smeltjob.mjs')
const S0 = await import('../src/skills.mjs')
const CF = await import('../src/chestfull.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const rowsSince = (kind, n0) => RECS.slice(n0).filter(r => r.skill?.name === kind).map(r => r.skill?.detail ?? '')
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const IS_PATH = new URL('../src/indexsearch.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset
const later = ms => { offset += ms }

const HOME = { x: 0, y: 64, z: 0 }
const HK = TI.indexHomeKey(HOME)
const dir = () => process.env.POOL_STATE_DIR
const kOf = ([x, y, z]) => `${x},${y},${z}`
const count = (slots, name) => slots.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const slotted = list => list.map((it, i) => ({ ...it, slot: it.slot ?? 9 + i }))
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
/** What townindex-01 writes at an open (another bot's, earlier): the container's contents, KNOWN as of `at`. */
const seed = (c, names, { at = Date.now() - 60_000, dirtyAfter = false } = {}) => {
  const k = kOf(c)
  const used = Object.values(names).reduce((t, [, s]) => t + s, 0)
  TI.appendIndex(dir(), HK, null, { t: 'obs', id: `seed-${k}-${at}`, k, h: [k], at, size: 27, used, names, bot: 'Other', by: 'test' })
  if (dirtyAfter) TI.appendIndex(dir(), HK, null, { t: 'dirty', id: `seedd-${k}`, k, h: [k], at: at + 1000, bot: 'Other', by: 'test', phase: 'post', op: 'x' })
  TI.resetIndexCache()
}

// ------------------------------------------------------------------------------------------------- the pure rule
await t('indexNeed: the kit\'s iron by draw size (+ the 4 kept), the job\'s coal and copper, the stone-pickaxe ingredients; never a pickaxe (the index records no wear)', () => {
  assert.equal(IS.indexNeed('kit_iron').min, 8); assert.ok(IS.indexNeed('kit_iron').match('iron_ingot')); assert.ok(!IS.indexNeed('kit_iron').match('raw_iron'))
  assert.equal(IS.indexNeed('kit_iron_1').min, 5); assert.equal(IS.indexNeed('kit_iron_3').min, 7)
  assert.ok(IS.indexNeed('coal').match('coal') && !IS.indexNeed('coal').match('charcoal'), 'the job burns coal only (JOB_FUELS)')
  assert.ok(IS.indexNeed('raw_copper').match('raw_copper'))
  assert.ok(IS.indexNeed('stick').match('stick') && IS.indexNeed('cobblestone').match('blackstone') && IS.indexNeed('planks').match('birch_planks'))
  assert.equal(IS.indexNeed('pick'), null); assert.equal(IS.indexNeed('trippick'), null); assert.equal(IS.indexNeed('nonsense'), null)
})
const entriesOf = recs => TI.foldIndex(recs).worlds[JSON.stringify(null)] ?? {}
const pureCounts = (I = IS) => {
  const now = 10_000_000
  const o = (k, at, names) => ({ t: 'obs', id: `o-${k}-${at}`, k, at, size: 27, used: 1, names, w: null })
  const e = entriesOf([o('a', now - 1000, { iron_ingot: [8, 1] }), o('b', now - 1000, { iron_ingot: [7, 1] }), o('c', now - TI.INDEX_STALE_MS - 1, { iron_ingot: [64, 1] }),
    o('d', now - 2000, { iron_ingot: [30, 1] }), { t: 'dirty', k: 'd', at: now - 1000, id: 'dd', w: null }, o('e', now - 1000, { coal: [2, 1] })])
  const c = I.indexSearchCounts(e, ['a', 'b', 'c', 'd', 'e', 'f'], ['kit_iron', 'coal', 'pick'], now)
  assert.deepEqual(Object.keys(c.kit_iron), ['a'], 'enough (8 = 4 + 4 kept), known and fresh only: b is short, c stale, d dirty, f unknown')
  assert.deepEqual(c.kit_iron.a, { n: 8, at: now - 1000, src: 'ix' })
  assert.deepEqual(Object.keys(c.coal), ['e']); assert.deepEqual(c.pick, {}, 'never a pickaxe')
  const m = I.mergeSearchCounts({ stick: { a: { n: 2, at: 50 }, b: { n: 5, at: 500 } } }, { stick: { a: { n: 9, at: 100, src: 'ix' }, b: { n: 1, at: 400, src: 'ix' }, c: { n: 3, at: 1, src: 'ix' } } })
  assert.deepEqual(m.stick, { a: { n: 9, at: 100, src: 'ix' }, b: { n: 5, at: 500 }, c: { n: 3, at: 1, src: 'ix' } }, 'the newer count wins; the journal\'s newer one stands')
  const fut = I.indexSearchCounts(entriesOf([o('z', now + 3_600_000, { coal: [5, 1] }), o('y', now + 30_000, { coal: [5, 1] })]), ['z', 'y'], ['coal'], now)
  assert.deepEqual(Object.keys(fut.coal), ['y'], 'an observation an hour in the future is no count; 30 s of skew is')
  assert.equal(I.firstFromIndex([{ k: 'a', tier: 0 }], { coal: { a: { src: 'ix' } } }, 'coal'), true)
  assert.equal(I.firstFromIndex([{ k: 'a', tier: 1 }], { coal: { a: { src: 'ix' } } }, 'coal'), false)
}
await t('indexSearchCounts / mergeSearchCounts: only a KNOWN, fresh entry holding ENOUGH is a count; the newer count wins; positive evidence only', () => pureCounts())
await t('the change row and the licence row: key=value, <= 300 characters', () => {
  assert.equal(IS.indexSearchRow({ by: 'toolkit', need: 'kit_iron', town: 10, cand: 10, ix: 1, first: 'ix', visits: 1, took: 1, hit: 1, tried: ['1,2,3:success'] }),
    'by=toolkit need=kit_iron town=10 cand=10 ix=1 first=ix visits=1 took=1 hit=1 tried=[1,2,3:success]')
  assert.ok(IS.indexSearchRow({ tried: Array(80).fill('1000,64,1000:none') }).length <= 300)
  assert.match(IS.indexSearchModeDetail(), /^phase=mode rank=index kitsticks=on needs=kit_iron,coal,raw_copper,stick,cobblestone,planks fresh_h=6 positive_only=1$/)
})

// ------------------------------------------------------------------------------------------------- the toolkit's iron draw
// toolkit-03's own far-chest town: 9 single chests near the bot holding dirt, ONE far (20 from the bot) with 20 iron
const NEAR = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2], [-2, 64, 2], [4, 64, 9], [-5, 64, -4]]
const FAR = [-13, 64, 5]
const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }
function farTown ({ bag = [T('iron_pickaxe', 200), stack('stick', 9)], far = [stack('iron_ingot', 20)], rest = [stack('dirt', 5)] } = {}) {
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000
  const w = withServer(fakeWorld({ bag: slotted(bag) }))
  for (const c of NEAR) { w.set(...c, 'chest'); w.stock(...c, rest.map(s => ({ ...s }))) }
  w.set(...FAR, 'chest'); w.stock(...FAR, far.map(s => ({ ...s })))
  return w
}
const fakeCraft = w => async (_ctx, { item }) => {
  const take = (name, n) => { for (const it of w.bag.filter(x => x?.name === name)) { const k = Math.min(n, it.count); it.count -= k; n -= k; if (!it.count) w.bag.splice(w.bag.indexOf(it), 1); if (!n) break } }
  take('iron_ingot', K.KIT[item].ingots); take('stick', K.KIT[item].sticks)
  w.bag.push({ ...tool(item), slot: 40 })
  return { status: 'success', detail: `crafted 1 ${item}` }
}
const kit = (S, w) => S.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, {}, new AbortController().signal)
const indexFirst = async (S = S0) => {
  const w = farTown()
  seed(FAR, { iron_ingot: [20, 1] })
  const n0 = RECS.length
  const r = await kit(S, w)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.opened, [kOf(FAR)], `the index's holder is opened FIRST, and only it: ${w.spy.opened}`)
  assert.match(rowsSince('_index_search', n0)[0] ?? '', /^by=toolkit need=kit_iron town=10 cand=10 ix=1 first=ix visits=1 took=1 hit=1 /)
}
await t('THE KIT: the index says the far chest holds 20 ingots -> the draw opens it FIRST (1 visit; toolkit-03 alone opens the 9 nearer first); `_index_search` first=ix hit=1', () => indexFirst())
await t('CONTROL, no index: the same town opens the nearest first (toolkit-03 exactly) -- 10 visits, the far chest last', async () => {
  const w = farTown()
  const r = await kit(S0, w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.opened.at(-1), kOf(FAR)); assert.equal(w.spy.opened.length, 10)
})
const sameAsBase = async (S, setup, why) => {
  const w = farTown()
  setup(w)
  const r = await kit(S, w)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(w.spy.opened.length > 1 && w.spy.opened.at(-1) === kOf(FAR), `${why}: nearest first, as without the index: ${w.spy.opened}`)
}
await t('CONTROLS: a DIRTY, a STALE and a SHORT index entry change nothing (nearest first)', async () => {
  await sameAsBase(S0, () => seed(FAR, { iron_ingot: [20, 1] }, { dirtyAfter: true }), 'dirty')
  await sameAsBase(S0, () => seed(FAR, { iron_ingot: [20, 1] }, { at: Date.now() - TI.INDEX_STALE_MS - 1000 }), 'stale')
  await sameAsBase(S0, () => seed(FAR, { iron_ingot: [7, 1] }), 'short: 7 < 4 + 4')
})
await t('CONTROL: a kit_iron MISS recorded after the index\'s open rules the holder out (a later look wins)', async () => {
  const w = farTown()
  seed(FAR, { iron_ingot: [20, 1] }, { at: Date.now() - 120_000 })
  CF.updateTownMemory(dir(), CF.townKey(HOME), null, e => { e._ingredient_miss = { [kOf(FAR)]: { kit_iron: Date.now() - 60_000 } } })
  const r = await kit(S0, w)
  assert.equal(r.failClass, 'kit_no_iron', `the town's only holder is a live miss: ${r.detail}`)
  assert.ok(!w.spy.opened.includes(kOf(FAR)), 'never opened')
})
await t('INDEX-ONLY POSITIVE: an index entry holding NONE of the need never rules a container out (a fresh empty observation of the far chest, which then gains iron, is still looked in)', async () => {
  const w = farTown()
  seed(FAR, { dirt: [5, 1] })
  const r = await kit(S0, w)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(w.spy.opened.includes(kOf(FAR)))
})
await t('THE BOTS\' OWN INDEX: a first kit run that looked everywhere leaves the far chest KNOWN; the next bot\'s run (a fresh bag) opens it first', async () => {
  const w = farTown({ far: [stack('iron_ingot', 30)] })
  const r1 = await kit(S0, w)
  assert.equal(r1.status, 'success', r1.detail)
  // the far chest was drawn from: dirty -- until any open. A count_town / a deposit / another visit reopens it:
  const win = await w.bot.openContainer(w.bot.blockAt({ x: FAR[0], y: FAR[1], z: FAR[2] }))
  S0.townIndexObserve(w.bot, { x: FAR[0], y: FAR[1], z: FAR[2] }, win, 'test'); win.close()
  TI.resetIndexCache()
  // the next run, by a bot with no kit
  w.bag.splice(0, w.bag.length, ...slotted([T('iron_pickaxe', 200), stack('stick', 9)]))
  later(K.TOOLKIT_COOLDOWN_MS + 1000)
  const n0 = w.spy.opened.length
  const r2 = await kit(S0, w)
  assert.equal(r2.status, 'success', r2.detail)
  assert.deepEqual(w.spy.opened.slice(n0), [kOf(FAR)], 'straight to the holder')
})

await t('THE GATE (townKitIronMiss): every container a live kit_iron miss -> no order; an index observation NEWER than the misses showing a holder re-opens it (Claude r1 P3)', async () => {
  const w = farTown()
  const keys = [...NEAR, FAR].map(kOf)
  CF.updateTownMemory(dir(), CF.townKey(HOME), null, e => { e._ingredient_miss = Object.fromEntries(keys.map(k => [k, { kit_iron: Date.now() - 120_000 }])) })
  assert.equal(S0.townKitIronMiss(w.bot), true, 'positive control: the whole town is a known miss')
  seed(FAR, { iron_ingot: [20, 1] }, { at: Date.now() - 60_000 })
  assert.equal(S0.townKitIronMiss(w.bot), false, 'a newer index count of a holder: a candidate again')
})

// ------------------------------------------------------------------------------------------------- the smelt job's coal
const CHESTS = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2], [-2, 64, 2], [4, 64, 9], [-5, 64, -4]]
const COPPER = CHESTS[0], COAL = CHESTS[8]
function smeltTown () {
  freshPool(); clearWithdrawHolds(); offset += 3 * 60 * 60_000
  const w = withServer(fakeWorld({ bag: [{ ...stack('cobblestone', 3), slot: 9 }] }))
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  w.stock(...COPPER, [stack('raw_copper', 8)])
  w.stock(...COAL, [stack('coal', 4)])
  return w
}
const job = (S, w) => S.SKILLS.smelt_town.run({ bot: w.bot }, {}, new AbortController().signal)
const coalFirst = async (S = S0) => {
  const w = smeltTown()
  seed(COAL, { coal: [4, 1] })
  const n0 = RECS.length
  const r = await job(S, w)
  assert.equal(r.stop, 'no_furnace', `the coal was found and the job went on to the furnace: ${r.status} ${r.stop} ${r.detail}`)
  const iCu = w.spy.opened.indexOf(kOf(COPPER))
  assert.equal(w.spy.opened[iCu + 1], kOf(COAL), `the coal pass opened the index's coal holder FIRST: ${w.spy.opened}`)
  assert.ok(rowsSince('_index_search', n0).some(d => /^by=smelt_town need=coal .* first=ix visits=1 took=1 hit=1 /.test(d)), rowsSince('_index_search', n0).join(' | '))
}
await t('THE SMELT JOB: the index says the far chest holds coal -> the coal pass opens it first (one visit); `_index_search` by=smelt_town first=ix hit=1', () => coalFirst())
await t('CONTROL, no index: the coal pass walks the nearer containers first (toolkit-03 exactly)', async () => {
  const w = smeltTown()
  const r = await job(S0, w)
  assert.equal(r.stop, 'no_furnace', r.detail)
  const iCu = w.spy.opened.indexOf(kOf(COPPER))
  assert.ok(w.spy.opened.indexOf(kOf(COAL)) > iCu + 1, `nearer containers first: ${w.spy.opened}`)
})

// ------------------------------------------------------------------------------------------------- KITSTICKS: the K1 chain
// The iron sits ONLY in a container with NO sticks (the metal home of the plan); the sticks sit in another container; the bag
// has no sticks and no wood. toolkit-03: kitTakes refuses the iron (no sticks there, none makeable) -> kit_no_sticks.
const IRON = [-13, 64, 5], STICKS = [10, 64, 4]
function k1Town () {
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000
  const w = withServer(fakeWorld({ bag: slotted([T('iron_pickaxe', 200), stack('crafting_table', 1)]) }))
  for (const c of NEAR) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  w.stock(...STICKS, [stack('stick', 20)])
  w.set(...IRON, 'chest'); w.stock(...IRON, [stack('iron_ingot', 20)])
  return w
}
const k1Chain = async (S = S0, KK = K) => {
  const w = k1Town()
  let state = {}, last = null
  const o = KK.toolkitOrder({ now: Date.now(), atTown: true, items: w.bag, container: true, townMiss: () => S.townKitIronMiss(w.bot), tableNear: true, state })
  assert.equal(o.order?.skill, 'toolkit', 'positive control: the order issues')
  state = o.state
  const n0 = RECS.length
  last = await kit(S, w)
  state = KK.toolkitOutcome(last.status, Date.now(), state, last.failClass)
  assert.equal(last.status, 'success', `${last.failClass}: ${last.detail}`)
  assert.equal(count(w.bag, 'iron_axe') + count(w.bag, 'iron_shovel'), 2, 'the kit is made')
  assert.equal(count(w.containers.get(kOf(IRON)).slots, 'iron_ingot'), 16, 'the iron from the container with no sticks')
  assert.equal(count(w.containers.get(kOf(STICKS)).slots, 'stick'), 14, 'the 4 recipe sticks + the 2 kept from the stick container')
  assert.match(rowsSince('_kit_sticks', n0)[0] ?? '', /^want=6 took=6 left=0 /)
  assert.equal(state.backoffUntil ?? 0, 0, 'no backoff')
}
await t('K1 CHAIN (design 8 K1), through the real order: iron only where there are no sticks, sticks elsewhere, a bag with no wood -> KITSTICKS draws the sticks first, then the iron, and the kit is made (toolkit-03: kit_no_sticks)', () => k1Chain())
await t('KITSTICKS stays out of the way: a bag that can make its sticks (a log) never pre-draws; a bag that holds them neither', async () => {
  for (const extra of [stack('oak_log', 2), stack('stick', 9)]) {
    const w = farTown({ bag: [T('iron_pickaxe', 200), extra] })
    const n0 = RECS.length
    const r = await kit(S0, w)
    assert.equal(r.status, 'success', r.detail)
    assert.deepEqual(rowsSince('_kit_sticks', n0), [], `no pre-draw with ${extra.name}`)
  }
})
await t('KITSTICKS with no sticks anywhere: the pre-draw finds none, the iron search runs as toolkit-03 and names the remedy (kit_no_sticks)', async () => {
  const w = k1Town()
  w.stock(...STICKS, [stack('dirt', 5)])
  const n0 = RECS.length
  const r = await kit(S0, w)
  assert.equal(r.failClass, 'kit_no_sticks', `${r.failClass}: ${r.detail}`)
  assert.match(r.detail, /carry 1 log/, 'the remedy the bot can perform')
  assert.match(rowsSince('_kit_sticks', n0)[0] ?? '', /^want=6 took=0 left=6 /)
})

// THE STICKS BEYOND THE PRE-DRAW'S 4 VISITS (Codex r1 P2): run 1's pre-draw misses them, its iron search finds the iron holder
// lacking sticks (held back for this bot) and ends no_sticks; the GATE must still issue the next order while a stick holder
// is known, and run 2 fetches the sticks, then the iron
const FARSTICKS = [-5, 64, -4]
const k1Far = async (S = S0, KK = K) => {
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000
  const w = withServer(fakeWorld({ bag: slotted([T('iron_pickaxe', 200), stack('crafting_table', 1)]) }))
  for (const c of NEAR) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  w.stock(...FARSTICKS, [stack('stick', 20)])
  w.set(...IRON, 'chest'); w.stock(...IRON, [stack('iron_ingot', 20)])
  let state = {}
  const order = () => KK.toolkitOrder({ now: Date.now(), atTown: true, items: w.bag, container: true, townMiss: () => S.townKitIronMiss(w.bot), tableNear: true, state })
  const o1 = order(); state = o1.state
  assert.equal(o1.order?.skill, 'toolkit', 'positive control: run 1 is issued')
  const n0 = RECS.length
  const r1 = await kit(S, w)
  state = KK.toolkitOutcome(r1.status, Date.now(), state, r1.failClass)
  assert.match(rowsSince('_kit_sticks', n0)[0] ?? '', /^want=6 took=0 .* visits=4 /, 'positive control: the pre-draw spent its 4 visits short of the stick chest')
  assert.notEqual(r1.status, 'success', `run 1 did not make the kit: ${r1.failClass}`)
  later(K.TOOLKIT_COOLDOWN_MS + K.TOOLKIT_BACKOFF_MS + 1000)
  const o2 = order(); state = o2.state
  assert.equal(o2.order?.skill, 'toolkit', 'the gate issues run 2: a stick holder is known, so the iron holder is not held back')
  const r2 = await kit(S, w)
  assert.equal(r2.status, 'success', `${r2.failClass}: ${r2.detail}`)
  assert.equal(count(w.containers.get(kOf(FARSTICKS)).slots, 'stick'), 14)
  assert.equal(count(w.containers.get(kOf(IRON)).slots, 'iron_ingot'), 16)
}
await t('K1 CHAIN, the sticks beyond the pre-draw\'s 4 visits: run 1 ends without the kit; the gate still issues run 2 (a stick holder is known); run 2 makes the kit (Codex r1 P2)', () => k1Far())
await t('KITSTICKS takes only what the bag cannot make: 1 plank makes no sticks... 2 planks make 4, so a bag with 2 planks pre-draws 2 (6 - 4)', async () => {
  const w = k1Town()
  w.bag.push({ ...stack('oak_planks', 2), slot: 30 })
  const n0 = RECS.length
  const r = await kit(S0, w)
  assert.equal(r.status, 'success', `${r.failClass}: ${r.detail}`)
  assert.match(rowsSince('_kit_sticks', n0)[0] ?? '', /^want=2 took=2 left=0 /)
})
await t('KITSTICKS: a pre-draw visit that STOPS without moving anything does not end the run -- the iron search runs (Claude r1 P3)', async () => {
  const w = k1Town()
  w.bot.craftSync.recount = async () => ({ source: 'none', items: null })   // every visit: recount_unanswered (a stop, nothing moved)
  const n0 = RECS.length
  const r = await kit(S0, w)
  assert.match(rowsSince('_kit_sticks', n0)[0] ?? '', / stop=recount_unanswered /, rowsSince('_kit_sticks', n0)[0])
  assert.ok(rowsSince('_kit_search', n0).length === 1, 'the iron search ran')
  assert.notEqual(r.detail.includes('stick_draw_unsettled'), true)
})

// THE STICK-SEARCH SKIP (Codex r3 P2, Claude r3 P3 + r4 P3: by behaviour). STICKS is the town's ONLY iron holder and holds
// sticks too; the bag has neither sticks nor wood. Run 1: the server's bag cannot be read -- the pre-draw's take at STICKS
// stops (recount_unanswered) and the iron search stops too. Run 2 (the bag readable again, inside the skip's 30 min): the
// stick pre-draw must NOT walk back to STICKS (the kit's stick skip), and the IRON search must still open it -- it draws the
// iron and the sticks there and makes the kit. A global skip would hide STICKS from the iron search (no kit); no skip would
// send the pre-draw straight back to STICKS.
const stickSkip = async (S = S0) => {
  const w = k1Town()
  w.stock(...IRON, [stack('dirt', 5)])                                  // no iron anywhere but STICKS
  w.stock(...STICKS, [stack('stick', 20), stack('iron_ingot', 20)])
  seed(STICKS, { stick: [20, 1], iron_ingot: [20, 1] })
  const rec0 = w.bot.craftSync.recount
  let fail = true
  w.bot.craftSync.recount = async (...a) => (fail ? { source: 'none', items: null } : rec0(...a))
  const n0 = RECS.length
  await kit(S, w)
  assert.match(rowsSince('_kit_sticks', n0)[0] ?? '', / stop=recount_unanswered tried=\[[^\]]*:recount_unanswered/, 'positive control: the pre-draw stopped at the stick holder')
  fail = false
  later(K.TOOLKIT_COOLDOWN_MS + 60_000)                                // inside SEARCH_FAIL_SKIP_MS
  const n1 = RECS.length
  const r2 = await kit(S, w)
  const sticksRow = rowsSince('_kit_sticks', n1)[0] ?? ''
  assert.ok(!sticksRow.includes(kOf(STICKS)), `the stick pre-draw kept away from the stopped holder: ${sticksRow}`)
  assert.equal(r2.status, 'success', `the iron search still opened STICKS and made the kit: ${r2.failClass} ${r2.detail}`)
  assert.equal(count(w.containers.get(kOf(STICKS)).slots, 'iron_ingot'), 16)
}
await t('THE STICK-SEARCH SKIP, by behaviour: after a stopped take at the only iron-and-stick holder, the next run\'s stick pre-draw keeps away from it while its iron search still opens it and makes the kit (Codex r3 P2, Claude r4 P3)', () => stickSkip())

// ------------------------------------------------------------------------------------------------- the switch
await t('INDEXSEARCH=off and KITSTICKS=off: the licence row says so (the one-setting rollbacks)', () => {
  const code = `const I = await import(${JSON.stringify(IS_PATH.href)}); console.log(I.indexSearchModeDetail())`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, INDEXSEARCH: 'off', KITSTICKS: 'off' }, encoding: 'utf8' })
  assert.match(r.stdout, /^phase=mode rank=off kitsticks=off /, r.stderr)
})

// ------------------------------------------------------------------------------------------------- the mutants
await t('MUTANTS (anchored, unique): each pinned behaviour fails under its mutant', async () => {
  const kills = {}
  kills.noMerge = await withMutant(SKILLS_PATH, 'if (INDEXSEARCH.on) {\n    try { Object.assign(counts,', 'if (false) {\n    try { Object.assign(counts,', S => killedBy(() => indexFirst(S)))
  kills.noMergeSmelt = await withMutant(SKILLS_PATH, 'if (INDEXSEARCH.on) {\n    try { Object.assign(counts,', 'if (false) {\n    try { Object.assign(counts,', S => killedBy(() => coalFirst(S)))
  kills.noMin = await withMutant(IS_PATH, 'if (h && h.n >= spec.min && h.at <= now + FUTURE_SLACK_MS)', 'if (h && h.n > 0 && h.at <= now + FUTURE_SLACK_MS)', I => killedBy(() => pureCounts(I)))
  kills.olderWins = await withMutant(IS_PATH, 'if (!have || !Number.isFinite(have.at) || c.at > have.at) j[k] = c', 'j[k] = c', I => killedBy(() => pureCounts(I)))
  kills.noKitSticks = await withMutant(SKILLS_PATH, 'if (KITSTICKS.on && draw.ingots > 0 && kitSticksAtRisk(', 'if (false && draw.ingots > 0 && kitSticksAtRisk(', S => killedBy(() => k1Chain(S)))
  kills.gateHoldsBack = await withMutant(SKILLS_PATH, "!(KITSTICKS.on && d.ingots > 0 && townSearchHolder(bot, 'stick', kitStickSkipKeys(bot)))", '!false', S => killedBy(() => k1Far(S)))
  kills.noStickSkip = await withMutant(SKILLS_PATH, '          kitStickSkipSet(bot, containerKey(bot, cb.position))\n', '\n', S => killedBy(() => stickSkip(S)))
  kills.skipIsGlobal = await withMutant(SKILLS_PATH, '  bot.kitStickSkip.set(k, Date.now() + SEARCH_FAIL_SKIP_MS)\n', '  bot.kitStickSkip.set(k, Date.now() + SEARCH_FAIL_SKIP_MS); bot.withdrawSearchSkip ??= new Map(); bot.withdrawSearchSkip.set(k, Date.now() + SEARCH_FAIL_SKIP_MS)\n', S => killedBy(() => stickSkip(S)))
  kills.futureCounts = await withMutant(IS_PATH, 'if (h && h.n >= spec.min && h.at <= now + FUTURE_SLACK_MS)', 'if (h && h.n >= spec.min)', I => killedBy(() => pureCounts(I)))
  kills.noRedraw = await withMutant(SKILLS_PATH, '        if (sp.took > 0) draw = kitDraw(items(), { credit: creditIn })', '        if (false) draw = kitDraw(items(), { credit: creditIn })', S => killedBy(() => k1Chain(S)))
  const alive = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(alive, [], `mutants that survived: ${alive}`)
  console.log(`        mutants killed: ${Object.keys(kills).join(', ')}`)
})

Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
