// INDEXSEARCH-02 (storehub piece C; indexsearch2.mjs): the town search skips a container the town index knows -- fresh, clean,
// no deposit since -- does not hold the need, and each pass may still recheck ONE of them, the oldest observation first.
// Behaviour first: the need rules by truth table, the evidence (known / stale / dirty / unknown / future / deposit since /
// untrusted intake / double chest), the order (held back, rechecked last, a newer journal count wins); then the real
// withdraw_pick in the fake world -- a known-empty town costs one recheck, not a walk round every chest, and the REFUSAL
// CHAIN: an index that is WRONG (a pickaxe put where it said none, with no mark) is still found by the rechecks, order by
// order; then anchored mutants (the anchor present and unique, or the mutant does not count as killed).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ixsearch2-logs-'))
process.env.BOT_NAME = 'IxBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'   // the production clock: withdraw is clamped to it (the suite sets 300 ms)
delete process.env.INDEXSEARCH2
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ixsearch2-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const X = await import('../src/indexsearch2.mjs')
const W = await import('../src/withdrawpick.mjs')
const TI = await import('../src/townindex.mjs')
const { SKILLS, townPickMiss, townIngredientMiss } = await import('../src/skills.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')
const { townSearchOrder, WITHDRAW_COOLDOWN_MS, WITHDRAW_BACKOFF_MS } = W
const { needLacks, indexEvidence, indexJudges, INDEX_RECHECK_VISITS, INDEXSEARCH2 } = X

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const rows = n0 => RECS.slice(n0).filter(r => r.skill?.name === '_withdraw_pick').map(r => r.skill.detail)
const sig = () => new AbortController().signal
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const WP_PATH = new URL('../src/withdrawpick.mjs', import.meta.url)
const IX_PATH = new URL('../src/indexsearch2.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE: the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset
const later = ms => { offset += ms }

const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const CHESTS = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2], [-2, 64, 2], [4, 64, 9], [-5, 64, -4], [9, 64, 10], [-8, 64, 3], [-13, 64, 5]]
const kOf = ([x, y, z]) => `${x},${y},${z}`
/** Forget the town MEMORY (misses, deposits) and the stock journal, keep the town INDEX: what is left is the index's evidence. */
const dropMemoryKeepIndex = () => {
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (!/^town-index-/.test(e.name)) fs.unlinkSync(f) } }
  walk(process.env.POOL_STATE_DIR)
}
const dropIndex = () => {
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/^town-index-/.test(e.name)) fs.unlinkSync(f) } }
  walk(process.env.POOL_STATE_DIR); TI.resetIndexCache()
}
const pick = w => SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
/** A TOWN THE INDEX HAS SEEN: the 12 chests hold dirt, the bag holds what one stone pickaxe takes (so the order needs only the
 *  pickaxe pass), and one order opens every chest -- the census that writes their observations. Then the memory is dropped. */
async function censusTown () {
  freshPool(); clearWithdrawHolds(); TI.resetIndexCache()
  const w = withServer(fakeWorld({ bag: [stack('crafting_table', 1), stack('cobblestone', 3), stack('stick', 2)] }))
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  await pick(w)
  assert.equal(new Set(w.spy.opened).size, CHESTS.length, `the census opened every chest: ${w.spy.opened}`)
  later(WITHDRAW_COOLDOWN_MS + WITHDRAW_BACKOFF_MS)
  dropMemoryKeepIndex()
  return w
}

// ------------------------------------------------------------------------------------------------- the need rules
await t('needLacks: each need by its own miss rule; a need the index cannot judge is null (no evidence)', () => {
  const N = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [v, 1]]))
  assert.equal(needLacks('pick', N({ dirt: 5 })), true)
  assert.equal(needLacks('pick', N({ wooden_pickaxe: 1 })), false, 'any pickaxe may be usable: the index has no wear')
  assert.equal(needLacks('trippick', N({ wooden_pickaxe: 1, golden_pickaxe: 1 })), true, 'no stone-or-better pickaxe')
  assert.equal(needLacks('trippick', N({ stone_pickaxe: 1 })), false)
  assert.equal(needLacks('trippick', N({ iron_pickaxe: 1 })), false)
  for (const n of ['cobblestone', 'cobbled_deepslate', 'blackstone']) assert.equal(needLacks('cobblestone', N({ [n]: 1 })), false, n)
  assert.equal(needLacks('cobblestone', N({ stone: 64 })), true, 'stone is not what the recipe takes')
  assert.equal(needLacks('stick', N({ oak_planks: 4 })), true)
  assert.equal(needLacks('planks', N({ birch_planks: 1 })), false)
  // the kit: n + TOWN_IRON_KEEP (4) ingots, the way kitIronMissNeeds writes the miss
  assert.equal(needLacks('kit_iron', N({ iron_ingot: 7 })), true); assert.equal(needLacks('kit_iron', N({ iron_ingot: 8 })), false)
  assert.equal(needLacks('kit_iron_1', N({ iron_ingot: 4 })), true); assert.equal(needLacks('kit_iron_1', N({ iron_ingot: 5 })), false)
  assert.equal(needLacks('kit_iron_any', N({ iron_ingot: 1 })), false); assert.equal(needLacks('kit_iron_any', N({ dirt: 1 })), true)
  for (const n of ['raw_copper', 'raw_iron', 'coal', 'oak_log', 'whatever']) assert.equal(needLacks(n, N({ dirt: 1 })), null, n)
  assert.equal(indexJudges(['pick']), true); assert.equal(indexJudges(['stick', 'coal']), false); assert.equal(indexJudges([]), false)
})

// ------------------------------------------------------------------------------------------------- the evidence
const NOW = 2e12
const obs = (k, names, at, extra = {}) => ({ last: { t: 'obs', at, id: `o${at}` }, obs: { id: `o${at}`, at, h: extra.h ?? [k], names, used: 1, size: 27 }, ops: extra.ops ?? {} })
await t('indexEvidence: a negative only from a KNOWN, fresh, clean observation with no deposit since; positives the same way; never for an untrusted (intake) chest', () => {
  const C = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(k => ({ k, halves: [k] }))
  const E = {
    a: obs('a', { dirt: [5, 1] }, NOW - 60_000),                                      // known, lacks -> NEG
    b: obs('b', { stick: [9, 1] }, NOW - 60_000),                                     // known, holds -> POS
    c: obs('c', { dirt: [5, 1] }, NOW - TI.INDEX_STALE_MS - 1),                       // stale -> nothing
    d: { ...obs('d', { dirt: [5, 1] }, NOW - 60_000), last: { t: 'dirty', at: NOW - 30_000 } },   // dirty since -> nothing
    e: obs('e', { dirt: [5, 1] }, NOW + 5 * 60_000),                                 // stamped in the future -> nothing
    f: obs('f', { dirt: [5, 1] }, NOW - 60_000),                                      // a deposit after -> nothing
    g: obs('g', { dirt: [5, 1] }, NOW - 60_000),                                      // a deposit inside the slack -> NEG
    h: obs('h', { dirt: [5, 1] }, NOW - 60_000),                                      // untrusted -> nothing
    // i: unknown (no entry)
  }
  const ev = indexEvidence(E, C, ['stick'], { now: NOW, tookAt: { f: NOW - 50_000, g: NOW - 60_000 + 2_000 }, untrusted: new Set(['h']) })
  assert.equal(ev.judged, true)
  assert.deepEqual([...ev.neg.keys()].sort(), ['a', 'g'])
  assert.deepEqual([...ev.pos.keys()].sort(), ['b'])
  assert.equal(ev.neg.get('a'), NOW - 60_000, 'the negative carries its observation time (the recheck order)')
  // THE LIFE: a negative lives as long as the miss it stands for (ttl), never past INDEX_STALE_MS
  const life = indexEvidence({ a: obs('a', { dirt: [5, 1] }, NOW - 61 * 60_000), b: obs('b', { dirt: [5, 1] }, NOW - 59 * 60_000) }, [{ k: 'a' }, { k: 'b' }], ['stick'], { now: NOW, ttl: 60 * 60_000 })
  assert.deepEqual([...life.neg.keys()], ['b'], 'older than the miss life: no evidence')
  assert.deepEqual([...indexEvidence({ a: obs('a', { dirt: [5, 1] }, NOW - TI.INDEX_STALE_MS - 1) }, [{ k: 'a' }], ['stick'], { now: NOW, ttl: 1e12 }).neg.keys()], [], 'never past 6 h')
  // a double chest: the index keys it by its lower half, the scan by the other one
  const dbl = indexEvidence({ '1,64,0': obs('1,64,0', { dirt: [5, 1] }, NOW - 1_000, { h: ['1,64,0', '2,64,0'] }) }, [{ k: '2,64,0', halves: ['2,64,0', '1,64,0'] }], ['pick'], { now: NOW })
  assert.deepEqual([...dbl.neg.keys()], ['2,64,0'])
  // an open mutation across the observation: dirty (townindex openAt)
  const open = indexEvidence({ a: obs('a', { dirt: [5, 1] }, NOW - 60_000, { ops: { op1: { pre: NOW - 70_000, held: null, post: null } } }) }, [{ k: 'a' }], ['stick'], { now: NOW })
  assert.equal(open.neg.size, 0, 'captured while a mutation was under way')
  // no index, or a need it cannot judge: no evidence at all
  assert.equal(indexEvidence(null, C, ['stick']).judged, false)
  assert.equal(indexEvidence(E, C, ['stick', 'coal'], { now: NOW }).judged, false)
})
await t('indexEvidence: several needs -- a negative only when the observation fails EVERY need, else a positive', () => {
  const E = { a: obs('a', { dirt: [5, 1] }, NOW - 1_000), b: obs('b', { oak_planks: [8, 1] }, NOW - 1_000) }
  const ev = indexEvidence(E, [{ k: 'a' }, { k: 'b' }], ['stick', 'planks', 'pick'], { now: NOW })
  assert.deepEqual([...ev.neg.keys()], ['a']); assert.deepEqual([...ev.pos.keys()], ['b'])
})

// ------------------------------------------------------------------------------------------------- the order
await t('ORDER: index negatives are held back; INDEX_RECHECK_VISITS of them, the OLDEST first, follow every other candidate; positives are tier 0', () => {
  const C = [{ k: 'a', d: 1 }, { k: 'b', d: 2 }, { k: 'c', d: 3 }, { k: 'd', d: 4 }, { k: 'e', d: 5 }]
  const index = { neg: new Map([['a', NOW - 10_000], ['b', NOW - 90_000], ['c', NOW - 50_000]]), pos: new Map([['e', NOW - 1_000]]), recheck: 1 }
  const o = townSearchOrder(C, ['stick'], { now: NOW, index })
  assert.deepEqual(o.map(r => `${r.k}${r.tier}`), ['e0', 'd1', 'b2'], JSON.stringify(o))
  assert.equal(o.at(-1).ixneg, true); assert.equal(o.ixNeg, 3, 'held back, rechecks included')
  assert.deepEqual(townSearchOrder(C, ['stick'], { now: NOW, index: { ...index, recheck: 0 } }).map(r => r.k), ['e', 'd'], 'no recheck left: none')
  // no index: exactly the base order
  assert.deepEqual(townSearchOrder(C, ['stick'], { now: NOW }).map(r => r.k), ['a', 'b', 'c', 'd', 'e'])
  assert.equal(INDEX_RECHECK_VISITS, 1)
})
await t('ORDER: a journal count of the need NEWER than the index\'s observation wins; an older one loses; a live miss still rules out', () => {
  const C = [{ k: 'a', d: 1 }]
  const index = { neg: new Map([['a', NOW - 60_000]]), pos: new Map(), recheck: 0 }
  assert.deepEqual(townSearchOrder(C, ['stick'], { now: NOW, index, counts: { stick: { a: { n: 4, at: NOW - 1_000 } } } }).map(r => `${r.k}${r.tier}`), ['a0'], 'counted holding sticks after the look')
  assert.deepEqual(townSearchOrder(C, ['stick'], { now: NOW, index, counts: { stick: { a: { n: 4, at: NOW - 120_000 } } } }).map(r => r.k), [], 'the look came after the count')
  assert.deepEqual(townSearchOrder(C, ['stick'], { now: NOW, index: { ...index, recheck: 1 }, misses: { stick: { a: NOW - 1_000 } } }).map(r => r.k), [], 'a live miss: out, not even a recheck')
})
await t('LICENCE: installFeatures writes `_indexsearch2_mode` once per spawn with the module\'s own detail', async () => {
  const F = await import('../src/features.mjs')
  const w = fakeWorld(); w.bot.worldId = 'w-1'
  const n0 = RECS.length
  F.installFeatures(w.bot)
  const mine = RECS.slice(n0).filter(r => r.skill?.name === '_indexsearch2_mode')
  assert.ok(RECS.length - n0 > 5, 'positive control: the tap sees the spawn rows')
  assert.equal(mine.length, 1); assert.equal(mine[0].skill.detail, X.indexSearch2ModeDetail())
})
await t('LICENCE: the mode row names the rule and the switch', () => {
  assert.equal(INDEXSEARCH2.on, true, 'on by default')
  assert.match(X.indexSearch2ModeDetail(), /^phase=mode index_search=on skip=known_lacks_every_need life=miss_ttl max_h=6 recheck=1 /)
})

// ------------------------------------------------------------------------------------------------- the real order
const knownEmptyTown = async S => {
  const w = await censusTown()
  // a NEW chest, never opened (unknown to the index), the farthest -- the only one with a pickaxe
  w.set(-14, 64, -6, 'chest'); w.stock(-14, 64, -6, [tool('stone_pickaxe', 20)])
  const n = w.spy.opened.length, n0 = RECS.length
  const r = await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'stone_pickaxe'), 1)
  assert.deepEqual(w.spy.opened.slice(n), ['-14,64,-6'], 'the twelve chests the index knows are empty are not walked to')
  assert.match(rows(n0).at(-1), /^outcome=took_pick .* town=13 cand=2,- visits=1 maxrep=1 vfail=0 ix=12\/0,- /, rows(n0).at(-1))
}
await t('THE KNOWN-EMPTY TOWN: every chest opened within 6 h held no pickaxe, a new chest does -- the order opens only the new one', () => knownEmptyTown({ SKILLS }))
await t('CONTROL: the same town with the index gone -- the order walks to the known-empty chests first (the base search)', async () => {
  const w = await censusTown()
  dropIndex()
  w.set(-14, 64, -6, 'chest'); w.stock(-14, 64, -6, [tool('stone_pickaxe', 20)])
  const n = w.spy.opened.length
  const r = await pick(w)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(w.spy.opened.length - n > 6, `the base opens more: ${w.spy.opened.slice(n)}`)
})
const wrongIndex = async S => {
  const { townOrder, townOrderOutcome } = await import('../src/composter.mjs')
  const w = await censusTown()
  const t0 = Date.now() - WITHDRAW_COOLDOWN_MS - WITHDRAW_BACKOFF_MS   // the census's opens (censusTown moved the clock on)
  // THE INDEX IS WRONG: a pickaxe appears in the chest the census opened LAST (the freshest negative, the last a recheck
  // reaches), with no dirty mark and no deposit recorded -- a human, or a move the index never saw
  const lastSeen = [...new Set(w.spy.opened)].at(-1)
  w.stock(...lastSeen.split(',').map(Number), [stack('dirt', 5), tool('stone_pickaxe', 20)])
  // the bag now lacks sticks, so each order runs both passes; THE REAL GATES issue it (townOrder: townPickMiss, townIngredientMiss)
  w.bag.splice(0, w.bag.length, stack('crafting_table', 1), stack('cobblestone', 3))
  let state = {}
  const base = () => ({ now: Date.now(), slots: 2, freeSlots: 34, junk: 0, distHome: 5, storageNear: true, composterAtTown: false,
    pickNeeded: true, pickRoom: true, pickMiss: () => S.townPickMiss(w.bot), ingredientMiss: () => S.townIngredientMiss(w.bot), state })
  const log = []
  let got = false
  for (let i = 0; i < 150 && !got; i++, later(60_000)) {   // a minute a step, up to 2.5 h
    const o = townOrder(base()); state = o.state
    if (o.order?.skill !== 'withdraw_pick') continue
    const n = w.spy.opened.length
    const r = await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
    state = townOrderOutcome('withdraw_pick', r.status, Date.now(), state, r.failClass)
    log.push({ min: Math.round((Date.now() - t0) / 60_000), opened: w.spy.opened.slice(n), status: r.status })
    got = count(w.bag, 'stone_pickaxe') === 1
  }
  assert.ok(got, `the pickaxe is found: ${JSON.stringify(log)}`)
  const inLife = log.filter(e => e.min * 60_000 < W.SEARCH_MISS_TTL_MS)
  assert.ok(inLife.length >= 1, `positive control: an order ran while the negatives lived: ${JSON.stringify(log)}`)
  assert.ok(inLife.every(e => e.opened.length <= 2 * INDEX_RECHECK_VISITS), `while the negatives live: one recheck per pass, no walk round the town: ${JSON.stringify(log)}`)
  // A NEGATIVE IS NO STRONGER THAN A MISS: the order that finds it comes no later than the first order once the miss life ends
  const found = log.at(-1)
  assert.ok(found.min * 60_000 < W.SEARCH_MISS_TTL_MS + WITHDRAW_COOLDOWN_MS + WITHDRAW_BACKOFF_MS + 2 * 60_000, `found within a miss life (+ one order gap): ${JSON.stringify(log)}`)
  assert.ok(found.opened.includes(lastSeen), 'taken where the index was wrong')
}
await t('THE REFUSAL CHAIN (a wrong index, the real gates): a pickaxe where the index said none, no mark -- while the negatives live each order rechecks one per pass; the negative ends with the miss life it stands for, and the next order takes the pickaxe', () => wrongIndex({ SKILLS, townPickMiss, townIngredientMiss }))

// ------------------------------------------------------------------------------------------------- mutants
await t('MUTANTS: each removes one part of the rule and a behaviour test above fails', async () => {
  const pure = async (M, fn) => fn(M)
  const evidenceProbe = Mx => () => {
    const E = { f: obs('f', { dirt: [5, 1] }, NOW - 60_000), h: obs('h', { dirt: [5, 1] }, NOW - 60_000), a: obs('a', { dirt: [5, 1] }, NOW - 1_000), b: obs('b', { oak_planks: [8, 1] }, NOW - 1_000), s: { ...obs('s', { dirt: [5, 1] }, NOW - 60_000), last: { t: 'dirty', at: NOW - 30_000 } }, o: obs('o', { dirt: [5, 1] }, NOW - 61 * 60_000) }
    const ev = Mx.indexEvidence(E, ['f', 'h', 'a', 'b', 's', 'o'].map(k => ({ k })), ['stick', 'planks'], { now: NOW, tookAt: { f: NOW - 50_000 }, untrusted: new Set(['h']), ttl: 60 * 60_000 })
    assert.deepEqual([...ev.neg.keys()].sort(), ['a'])
    assert.deepEqual([...ev.pos.keys()], ['b'])
  }
  const orderProbe = Mw => () => {
    const C = [{ k: 'a', d: 1 }, { k: 'b', d: 2 }, { k: 'd', d: 4 }]
    const o = Mw.townSearchOrder(C, ['stick'], { now: NOW, index: { neg: new Map([['a', NOW - 10_000], ['b', NOW - 90_000]]), pos: new Map(), recheck: 1 } })
    assert.deepEqual(o.map(r => r.k), ['d', 'b'])
    const C2 = [{ k: 'a', d: 1 }]
    assert.deepEqual(Mw.townSearchOrder(C2, ['stick'], { now: NOW, index: { neg: new Map([['a', NOW - 60_000]]), pos: new Map(), recheck: 0 }, counts: { stick: { a: { n: 4, at: NOW - 1_000 } } } }).map(r => r.k), ['a'])
  }
  const killed = []
  const IX = [
    ['a deposit since does not void the negative', '    if (Number.isFinite(took) && took > at + RULE_OUT_TOOK_SLACK_MS) continue\n', ''],
    ['an intake chest gets a negative', "if (!untrusted?.has?.(k)) neg.set(k, at)", 'neg.set(k, at)'],
    ['some need instead of every need', 'if (lacks.every(x => x === true))', 'if (lacks.some(x => x === true))'],
    ['a dirty observation is evidence', "if (!e || indexStateOf(e, now) !== 'known') continue", 'if (!e || !e.obs) continue'],
    ['the miss life ignored', '|| now - at >= life) continue', ') continue'],
  ]
  for (const [name, old, neu] of IX) { if (await withMutant(IX_PATH, old, neu, Mx => killedBy(evidenceProbe(Mx)))) killed.push(name); else assert.fail(`mutant survived: ${name}`) }
  const WPM = [
    ['the skip line removed', 'if (Number.isFinite(negAt) && !(has && hasAt > negAt)) {', 'if (false) {'],
    ['a newer journal count does not win', 'if (Number.isFinite(negAt) && !(has && hasAt > negAt)) {', 'if (Number.isFinite(negAt)) {'],
    ['the recheck newest first', '(a.ixAt - b.ixAt) ||', '(b.ixAt - a.ixAt) ||'],
  ]
  for (const [name, old, neu] of WPM) { if (await withMutant(WP_PATH, old, neu, Mw => killedBy(orderProbe(Mw)))) killed.push(name); else assert.fail(`mutant survived: ${name}`) }
  // the wiring, through the real order (skills.mjs): the index not passed, and no recheck ever
  const SKM = [
    ['the index never reaches the order', "prefer: sh ? searchPrefer(sh, needs) : null, index })", 'prefer: sh ? searchPrefer(sh, needs) : null })', knownEmptyTown],
    ['no recheck', 'recheck: pending ? INDEX_RECHECK_VISITS : Math.max(0, INDEX_RECHECK_VISITS - used.size) }', 'recheck: 0 }', knownEmptyTownRechecks],
    ['the recheck never spent', '  if (index && order[0]?.ixneg) searchRechecks(tried).add(order[0].k)\n', '', knownEmptyTownRechecks],
  ]
  for (const [name, old, neu, scene] of SKM) { if (await withMutant(SKILLS_PATH, old, neu, S => killedBy(() => scene(S)))) killed.push(name); else assert.fail(`mutant survived: ${name}`) }
  console.log(`        mutants killed: ${killed.join(', ')}`)
})
/** A known-empty town with NO new chest: the order opens exactly one chest (the recheck), not twelve. */
async function knownEmptyTownRechecks (S) {
  const w = await censusTown()
  const n = w.spy.opened.length
  await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
  assert.equal(w.spy.opened.length - n, INDEX_RECHECK_VISITS, `one recheck: ${w.spy.opened.slice(n)}`)
}
await t('THE KNOWN-EMPTY TOWN, NOTHING NEW: one recheck, then the order goes on to its ingredients/craft (the gate is unchanged: the order still runs)', () => knownEmptyTownRechecks({ SKILLS }))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
