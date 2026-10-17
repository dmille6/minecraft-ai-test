// TOWNSEARCH-01: withdraw_pick may look in EVERY town container (withdrawpick.mjs townSearchOrder; skills.mjs
// withdrawPickRun). Behaviour first: the pure order by truth table, then the real withdraw_pick in the fake world -- the
// far-chest scene, the journal's holders first, the search resumed across orders, never the same chest twice, a container
// it cannot reach left behind -- then the REFUSAL CHAIN through townOrder -> withdraw_pick -> townOrderOutcome, and anchored
// mutants (withMutant: the anchor present and unique, or the mutant does not count as killed).
//
// Measured 10-16 (docs/reports/townsearch-2026-10-16.md): every town held usable pickaxes and sticks, and the order failed
// "none ... in the 6 container(s) tried here" 134 times in 10-14..16, always the same few containers nearest home.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-townsearch-logs-'))
process.env.BOT_NAME = 'SearchBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'   // the production clock: withdraw is clamped to it (the suite sets 300 ms)
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-townsearch-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const W = await import('../src/withdrawpick.mjs')
const CF = await import('../src/chestfull.mjs')
const CC = await import('../src/cobblecap.mjs')
const { SKILLS, townPickMiss, townIngredientMiss } = await import('../src/skills.mjs')
const { townOrder, townOrderOutcome } = await import('../src/composter.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')
const { townSearchOrder, needCount, SEARCH_MISS_TTL_MS, INGREDIENT_MISS_TTL_MS, WITHDRAW_PICK_VISITS, WITHDRAW_INGREDIENT_VISITS, WITHDRAW_COOLDOWN_MS, WITHDRAW_BACKOFF_MS } = W

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
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn({ ...(await import(out.href)), __mutantPath: out.href }) } finally { try { unlinkSync(out) } catch {} }   // + its own path
}
/** Did the mutant change the behaviour the test pins? -> true when the test FAILS under the mutant (killed). */
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }   // a crash is not a kill

// A CLOCK THE TEST MOVES: every Date.now in the skill code, the town memory and the journal moves with it.
const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset
const later = ms => { offset += ms }

const HOME = { x: 0, y: 64, z: 0 }
const memDir = () => process.env.POOL_STATE_DIR
const mem = () => CF.readTownMemory(memDir(), CF.townKey(HOME), null)
/** The stock journal's count of a container, as an open would append it (cobblecap.mjs recordCount, v2). */
const journalCount = (k, m) => CC.recordCount(memDir(), CF.townKey(HOME), null, { obs: { k, n: m.cobble ?? 0, m, cap: Date.now() }, bot: 'other' })
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
/** THE FAR-CHEST TOWN: 12 single chests inside town (16 of home), none adjacent; the bot at 6.5,64,0.5. FAR is 20 from the
 *  bot and the last by distance. `far` and `rest` are what they hold. */
const CHESTS = [[5, 64, 3], [8, 64, -3], [2, 64, -5], [10, 64, 4], [0, 64, 6], [12, 64, -2], [-2, 64, 2], [4, 64, 9], [-5, 64, -4], [9, 64, 10], [-8, 64, 3]]
const FAR = [-13, 64, 5]
const kOf = ([x, y, z]) => `${x},${y},${z}`
function farTown ({ bag = [stack('crafting_table', 1)], far = [tool('stone_pickaxe', 20), stack('stick', 20)], rest = [stack('dirt', 5)] } = {}) {
  freshPool(); clearWithdrawHolds()
  const w = withServer(fakeWorld({ bag }))
  for (const c of CHESTS) { w.set(...c, 'chest'); w.stock(...c, rest.map(s => ({ ...s }))) }
  w.set(...FAR, 'chest'); w.stock(...FAR, far.map(s => ({ ...s })))
  return w
}
const pick = w => SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())

// ------------------------------------------------------------------------------------------------- the pure order
await t('ORDER: the journal\'s holders first (most covered, then nearest), then the unknown nearest first; a miss -- or, for sticks, a count of none -- is out', () => {
  const now = 1e12
  const C = [{ k: 'a', d: 3 }, { k: 'b', d: 9 }, { k: 'c', d: 1 }, { k: 'd', d: 5 }, { k: 'e', d: 2 }, { k: 'f', d: 4 }]
  const counts = { stick: { b: { n: 1, at: now - 60_000 }, d: { n: 2, at: now - 60_000 }, e: { n: 0, at: now - 60_000 } } }
  const misses = { stick: { c: now - 60_000 } }
  const o = townSearchOrder(C, ['stick'], { counts, misses, now })
  assert.deepEqual(o.map(x => x.k), ['d', 'b', 'a', 'f'], JSON.stringify(o))
  assert.deepEqual(o.map(x => x.tier), [0, 0, 1, 1])
  // d (cover 1, d=5) before b (cover 1, d=9): with want 1 both cover 1 -> nearest first
  assert.equal(o[0].cover, 1); assert.equal(o[1].cover, 1)
})
await t('ORDER: a miss ends at the TTL or at a deposit since; a count of none ends at the TTL or a deposit since; a positive count NEWER than a miss wins', () => {
  const now = 1e12, C = [{ k: 'x', d: 1 }]
  const ord = o => townSearchOrder(C, ['stick'], { now, ...o }).map(r => `${r.k}${r.tier}`)
  assert.deepEqual(ord({ misses: { stick: { x: now - 60_000 } } }), [], 'a live miss: out')
  assert.deepEqual(ord({ misses: { stick: { x: now - SEARCH_MISS_TTL_MS } } }), ['x1'], 'an expired miss: unknown again')
  assert.deepEqual(ord({ misses: { stick: { x: now - 60_000 } }, tookAt: { x: now - 1_000 } }), ['x1'], 'a deposit since the miss: unknown again')
  assert.deepEqual(ord({ counts: { stick: { x: { n: 0, at: now - 60_000 } } } }), [], 'a recent count of none: out')
  assert.deepEqual(ord({ counts: { stick: { x: { n: 0, at: now - SEARCH_MISS_TTL_MS } } } }), ['x1'], 'an old count of none: unknown')
  assert.deepEqual(ord({ counts: { stick: { x: { n: 0, at: now - 60_000 } } }, tookAt: { x: now - 1_000 } }), ['x1'], 'a deposit since the count of none')
  assert.deepEqual(ord({ counts: { stick: { x: { n: 1, at: now - 1_000 } } }, misses: { stick: { x: now - 60_000 } } }), ['x0'], 'counted holding one AFTER the miss: first')
  assert.deepEqual(ord({ counts: { stick: { x: { n: 1, at: now - 60_000 } } }, misses: { stick: { x: now - 1_000 } } }), [], 'a miss after the count: out')
  assert.deepEqual(ord({ counts: { stick: { x: { n: 1, at: now - CC.OBS_TTL_MS } } } }), ['x1'], 'a positive count past the journal\'s TTL: only unknown')
  assert.deepEqual(ord({ counts: { stick: { x: { n: 1, at: now - 60_000 } } }, misses: { stick: { x: now - 30_000 } }, tookAt: { x: now - 1_000 } }), ['x1'],
    'a deposit ends the miss, but the count from before the miss stays stale: unknown, not first')
})
await t('ORDER (Codex r1 P1): the journal cannot count every pickaxe (iron, golden, diamond), every cobblestone the recipe takes (blackstone) or every plank -- a count of 0 is NOT a look for those; only a miss rules them out', () => {
  const now = 1e12, C = [{ k: 'x', d: 1 }]
  for (const need of ['pick', 'cobblestone', 'planks']) {
    assert.equal(W.NEED_COUNT_COMPLETE[need], false, need)
    assert.deepEqual(townSearchOrder(C, [need], { now, counts: { [need]: { x: { n: 0, at: now - 60_000 } } } }).map(r => `${r.k}${r.tier}`), ['x1'], `${need}: a count of 0 stays unknown`)
    assert.deepEqual(townSearchOrder(C, [need], { now, misses: { [need]: { x: now - 60_000 } } }).map(r => r.k), [], `${need}: a miss is out`)
    assert.deepEqual(townSearchOrder(C, [need], { now, counts: { [need]: { x: { n: 1, at: now - 60_000 } } } }).map(r => `${r.k}${r.tier}`), ['x0'], `${need}: a positive count ranks first`)
  }
  assert.equal(W.NEED_COUNT_COMPLETE.stick, true, 'positive control: sticks are counted completely')
  assert.equal(needCount({ v: 2, n: 0, m: { cobble: 0 } }, 'pick'), 0, 'an iron pickaxe shows as 0 stone/wooden: why a 0 cannot rule it out')
})
await t('ORDER: several needs -- out only when out for EVERY need; ranked by how much of the deficit the counts cover', () => {
  const now = 1e12
  const C = [{ k: 'a', d: 1 }, { k: 'b', d: 2 }, { k: 'c', d: 3 }, { k: 'd', d: 4 }]
  const at = now - 60_000
  const counts = { stick: { a: { n: 0, at }, b: { n: 64, at }, c: { n: 1, at }, d: { n: 0, at } }, cobblestone: { a: { n: 0, at }, b: { n: 0, at }, c: { n: 64, at }, d: { n: 0, at } } }
  const misses = { stick: {}, cobblestone: { a: at, d: at } }
  const o = townSearchOrder(C, ['stick', 'cobblestone'], { counts, misses, now, want: { stick: 2, cobblestone: 3 } })
  assert.deepEqual(o.map(r => [r.k, r.cover]), [['c', 4], ['b', 2]], 'c covers 1 stick + 3 cobble; b 2 sticks; a and d: a count of no sticks and a cobble miss')
  const half = townSearchOrder(C, ['stick', 'cobblestone'], { counts, misses: { stick: {}, cobblestone: { a: at } }, now, want: { stick: 2, cobblestone: 3 } })
  assert.deepEqual(half.map(r => r.k), ['c', 'b', 'd'], 'd counted 0 cobble but never missed: unknown for cobble (blackstone), so it stays')
})
await t('ORDER: never the same container twice, nothing skipped comes back, no needs -> nothing', () => {
  const C = [{ k: 'a', d: 1 }, { k: 'a', d: 1 }, { k: 'b', d: 2 }, { k: 'c', d: 0 }]
  assert.deepEqual(townSearchOrder(C, ['pick'], { skip: ['c'] }).map(r => r.k), ['a', 'b'])
  assert.deepEqual(townSearchOrder(C, ['pick'], { skip: new Set(['c', 'a']) }).map(r => r.k), ['b'])
  assert.deepEqual(townSearchOrder(C, []), [])
  assert.deepEqual(townSearchOrder(null, ['pick']), [])
})
await t('needCount: a v2 count by the need\'s stock groups (absent = 0); a legacy count says nothing but cobble', () => {
  assert.equal(needCount({ v: 2, n: 5, m: { stone_pickaxe: 2, wooden_pickaxe: 1 } }, 'pick'), 3)
  assert.equal(needCount({ v: 2, n: 5, m: { cobble: 5 } }, 'pick'), 0, 'counted, none')
  assert.equal(needCount({ v: 2, n: 0, m: { oak_planks: 3, birch_planks: 4 } }, 'planks'), 7)
  assert.equal(needCount({ v: 2, n: 9, m: { cobble: 9 } }, 'cobblestone'), 9)
  assert.equal(needCount({ n: 9 }, 'stick'), null, 'a legacy (v1) count never counted sticks')
  assert.equal(needCount({ n: 9 }, 'cobblestone'), 9)
  assert.equal(needCount(null, 'pick'), null); assert.equal(needCount({ v: 2, m: {} }, 'nonsense'), null)
})
await t('THE MISS OUTLIVES THE ORDER CADENCE: both misses are SEARCH_MISS_TTL_MS, longer than a failed order\'s cooldown + backoff (the 15 min it was expired first)', () => {
  assert.equal(CF.PICK_MISS_TTL_MS, SEARCH_MISS_TTL_MS)
  assert.equal(INGREDIENT_MISS_TTL_MS, SEARCH_MISS_TTL_MS)
  assert.ok(SEARCH_MISS_TTL_MS > WITHDRAW_COOLDOWN_MS + WITHDRAW_BACKOFF_MS, 'the same bot\'s next order after a failure is >= 20 min later')
  assert.ok(SEARCH_MISS_TTL_MS >= 2 * (WITHDRAW_COOLDOWN_MS + WITHDRAW_BACKOFF_MS), 'two orders\' worth: a 12-container town is covered before the first misses expire')
})

// ------------------------------------------------------------------------------------- the real order, fake world
await t('THE FAR CHEST, NOTHING COUNTED: 11 chests of dirt, the pickaxe in the farthest -- the order walks chest to chest (nearest from where it stands) and takes it there; no container opened twice', async () => {
  const w = farTown()
  const n0 = RECS.length
  const r = await pick(w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'stone_pickaxe'), 1)
  assert.equal(w.spy.opened.at(-1), kOf(FAR), 'taken in the far chest')
  assert.ok(w.spy.opened.length > 6, `more than the old six: ${w.spy.opened.length}`)
  assert.equal(new Set(w.spy.opened).size, w.spy.opened.length, 'no container opened twice')
  assert.match(rows(n0).at(-1), /^outcome=took_pick .* town=12 cand=12,- /, rows(n0).at(-1))
})
await t('THE SEARCH RESUMES: a town of more containers than one order may open, none with a pickaxe -- each order continues where the last stopped, nothing is opened twice, and then the whole town is a known miss', async () => {
  freshPool(); clearWithdrawHolds()
  const w = withServer(fakeWorld({ bag: [stack('crafting_table', 1), stack('cobblestone', 3), stack('stick', 2)] }))
  const grid = []
  for (let x = -12; x <= 12; x += 3) for (let z = -12; z <= 12; z += 3) if (Math.hypot(x, z) <= 13 && !(x === 6 && z === 0)) grid.push([x, 64, z])
  for (const c of grid) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  assert.ok(grid.length > 2 * WITHDRAW_PICK_VISITS, `${grid.length} containers`)
  const n0 = RECS.length
  const per = []
  for (let i = 0; i < 4 && per.reduce((a, b) => a + b, 0) < grid.length; i++) {
    const before = w.spy.opened.length
    const r = await pick(w)
    assert.equal(r.status, 'no_effect', r.detail)                    // the bag holds the ingredients: nothing else to fetch
    per.push(w.spy.opened.length - before)
    later(WITHDRAW_COOLDOWN_MS)                                       // a no_effect order costs only the cooldown
  }
  assert.deepEqual(per.slice(0, -1), per.slice(0, -1).map(() => WITHDRAW_PICK_VISITS), `per order ${per}`)
  assert.equal(per.reduce((a, b) => a + b, 0), grid.length, `per order ${per}`)
  assert.equal(new Set(w.spy.opened).size, grid.length, 'every container exactly once')
  assert.match(rows(n0)[0], new RegExp(` town=${grid.length} cand=${grid.length},- `), rows(n0)[0])
  assert.equal(townPickMiss(w.bot), true, 'the whole town is a known pickaxe miss')
  const before = w.spy.opened.length
  later(WITHDRAW_COOLDOWN_MS); await pick(w)
  assert.equal(w.spy.opened.length, before, 'and the next order opens nothing')
})
await t('THE JOURNAL FIRST: the town\'s stock journal counted the far chest holding a stone pickaxe -> the first order opens that one chest and takes it', async () => {
  const w = farTown()
  journalCount(kOf(FAR), { stone_pickaxe: 1, stick: 20 })
  for (const c of CHESTS) journalCount(kOf(c), { })                 // the rest counted holding none
  const r = await pick(w)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.opened, [kOf(FAR)])
  assert.equal(count(w.bag, 'stone_pickaxe'), 1)
})
await t('A MISS AFTER A STALE COUNT WINS: the journal still says "holds one" from before a bot looked and found none -- not a candidate', async () => {
  const w = farTown({ far: [stack('dirt', 1)], bag: [stack('crafting_table', 1), stack('cobblestone', 3), stack('stick', 2)] })
  journalCount(kOf(FAR), { stone_pickaxe: 1 })
  later(1_000)
  for (const c of [...CHESTS, FAR]) CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.notePickMisses(e, [kOf(c)]))
  const n0 = RECS.length
  const r = await pick(w)
  assert.equal(r.status, 'no_effect', r.detail)
  assert.deepEqual(w.spy.opened, [], 'nothing opened')
  assert.match(rows(n0).at(-1), / cand=0,- /, rows(n0).at(-1))
  // positive control: the same count AFTER the miss makes it the first candidate
  later(1_000); journalCount(kOf(FAR), { stone_pickaxe: 1 })
  await pick(w)
  assert.deepEqual(w.spy.opened, [kOf(FAR)])
})
await t('THE INGREDIENTS FAR: no pickaxe anywhere, sticks only in the far chest -- the pickaxe pass looks in all 12, the ingredient pass goes back to the one it saw holding sticks and takes exactly 2', async () => {
  const w = farTown({ bag: [stack('crafting_table', 1), stack('cobblestone', 3)], far: [stack('stick', 20)] })
  const n0 = RECS.length
  const r = await pick(w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'stick'), 2)
  assert.equal(w.spy.opened.length, 13, `${w.spy.opened}`)
  assert.equal(new Set(w.spy.opened.slice(0, 12)).size, 12, 'the pickaxe pass: every container once')
  assert.deepEqual(w.spy.opened.slice(12), [kOf(FAR)], 'the ingredient pass: straight to the sticks it counted')
  assert.match(rows(n0).at(-1), /^outcome=took_ingredients .* cand=12,1 /, rows(n0).at(-1))
})
await t('A PICKAXE SEEN BY THE INGREDIENT PASS IS TAKEN: every container a live pickaxe miss, the nearest holds an iron pickaxe (no stock group: the journal cannot see it) and sticks -> the pickaxe, not the sticks', async () => {
  const w = farTown({ bag: [stack('crafting_table', 1), stack('cobblestone', 3)], far: [stack('dirt', 1)] })
  for (const c of [...CHESTS, FAR]) CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.notePickMisses(e, [kOf(c)]))
  w.stock(...CHESTS[0], [tool('iron_pickaxe', 10), stack('stick', 4)])
  const n0 = RECS.length
  const r = await pick(w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'iron_pickaxe'), 1); assert.equal(count(w.bag, 'stick'), 0)
  assert.match(rows(n0).at(-1), /^outcome=took_pick .* cand=0,\d+ /, rows(n0).at(-1))
})
await t('A CONTAINER IT CANNOT REACH: the journal\'s holder is walled in -> the order moves on in the same order, and the next order does not walk there first', async () => {
  const w = farTown({ far: [stack('dirt', 1)] })
  const wall = [9, 64, 10]                                          // 9.9 from the bot, counted holding a pickaxe
  w.stock(...wall, [tool('stone_pickaxe', 20)])
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) w.set(wall[0] + dx, 64, wall[2] + dz, 'stone')
  journalCount(kOf(wall), { stone_pickaxe: 1 })
  w.stock(...CHESTS[6], [tool('stone_pickaxe', 40)])               // and one more, uncounted
  const g0 = w.spy.gotos.length
  const r = await pick(w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.spy.gotos[g0].x, wall[0], 'the counted holder was tried first')
  assert.ok(!w.spy.opened.includes(kOf(wall)), 'never opened: unreachable')
  const gotosToWall = () => w.spy.gotos.filter(g => g.x === wall[0] && g.z === wall[2]).length
  const before = gotosToWall()
  w.bag.splice(0, w.bag.length, stack('crafting_table', 1))        // the pickaxe gone again (worn out)
  clearWithdrawHolds()
  later(WITHDRAW_COOLDOWN_MS)
  await pick(w)
  assert.equal(gotosToWall(), before, 'the next order did not walk to the walled chest again')
})
await t('A FULL CHEST HOLDING THE STICKS is looked in once per order, not once per visit', async () => {
  const fullBag = [stack('crafting_table', 1), stack('cobblestone', 64), stack('stone', 20), ...Array.from({ length: 33 }, () => stack('bamboo', 64))]
  const w = farTown({ bag: fullBag, far: [stack('dirt', 1)] })
  const c = CHESTS[0]
  w.stock(...c, [...Array.from({ length: 26 }, () => stack('cobblestone', 64)), stack('stick', 30)])
  journalCount(kOf(c), { stick: 30, cobble: 1664 })
  const r = await pick(w)
  assert.equal(w.spy.opened.filter(k => k === kOf(c)).length, 2, `once per pass (the journal cannot rule out an iron pickaxe): ${w.spy.opened}`)
  assert.equal(r.failClass, 'chest_no_room', r.detail)
})

// ------------------------------------------------------------------------------- the refusal chain (CLAUDE.md)
await t('THE CHAIN: townOrder issues, the order fails short only after the WHOLE town showed none, the order is then not re-issued (no loop), and a deposit of sticks anywhere re-opens it and ends in the sticks', async () => {
  const w = farTown({ bag: [stack('crafting_table', 1), stack('cobblestone', 3)], far: [stack('dirt', 1)] })
  let state = {}
  const base = () => ({ now: Date.now(), slots: 2, freeSlots: 34, junk: 0, distHome: 5, storageNear: true, composterAtTown: false,
    pickNeeded: true, pickRoom: true, pickMiss: () => townPickMiss(w.bot), ingredientMiss: () => townIngredientMiss(w.bot), state })
  let issued = 0, last = null
  for (let i = 0; i < 3; i++) {                                    // t = 0, 20, 40 min: inside one miss TTL
    if (i) later(WITHDRAW_COOLDOWN_MS + WITHDRAW_BACKOFF_MS)
    const o = townOrder(base())
    state = o.state
    if (o.order?.skill === 'withdraw_pick') {
      issued++
      last = await pick(w)
      state = townOrderOutcome('withdraw_pick', last.status, Date.now(), state, last.failClass)
    }
  }
  assert.equal(last.failClass, 'container_short', last.detail)
  assert.equal(new Set(w.spy.opened).size, 12, 'every town container was looked in')
  assert.equal(new Set(w.spy.opened).size, w.spy.opened.length, `and none twice: ${w.spy.opened} / ${rows(0).slice(-4).join(' | ')}`)
  assert.equal(townPickMiss(w.bot), true); assert.equal(townIngredientMiss(w.bot), true)
  assert.equal(issued, 1, `issued ${issued}: once the whole town is known empty the order stops`)
  later(60_000)                                                     // t = 41 min
  const quiet = townOrder(base()); state = quiet.state
  assert.equal(quiet.order, null, 'no futile order while nothing changed')
  later(60_000)
  // A DEPOSIT (any bot) of sticks into the far chest: the town's memory says it took items, the journal counts it
  w.stock(...FAR, [stack('stick', 9)])
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => { e[kOf(FAR)] = { o: 'took', at: Date.now() } })
  journalCount(kOf(FAR), { stick: 9 })
  const o = townOrder(base())                                       // t = 42 min: every miss is still live
  assert.equal(o.order?.skill, 'withdraw_pick', 'the deposit re-opens the order')
  const n0 = w.spy.opened.length
  const r = await pick(w)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.opened.slice(n0), [kOf(FAR), kOf(FAR)], 'only the chest that took items: once for a pickaxe (a deposit may bring one), once for the sticks')
  assert.equal(count(w.bag, 'stick'), 2)
})

// ------------------------------------------------------------------------------- composition with lidclear-01
await t('LIDCLEAR: the pickaxe in a far chest with cobblestone on its lid -- the search goes there (journal) and the lid dig opens it', async () => {
  const w = farTown({ far: [tool('stone_pickaxe', 20)] })
  w.set(FAR[0], 65, FAR[2], 'cobblestone')
  journalCount(kOf(FAR), { stone_pickaxe: 1 })
  const PICKS = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe'].map(n => w.bot.registry.itemsByName[n].id)
  const blockAt0 = w.bot.blockAt
  w.bot.blockAt = p => {
    const b = blockAt0(p)
    if (b?.name === 'cobblestone') b.canHarvest = id => PICKS.includes(id)
    if (b?.name === 'chest') b.shapes = [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]]
    return b
  }
  w.bot.digTime = () => 10_000
  w.bot.canDigBlock = () => true
  w.bot.dig = async b => { w.set(b.position.x, b.position.y, b.position.z, 'air') }
  const r = await pick(w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.nameAt(FAR[0], 65, FAR[2]), 'air', 'the lid was dug')
  assert.deepEqual(w.spy.opened, [kOf(FAR)])
})

await t('THE ROW (Codex r2): the order\'s verb= and the search\'s counters come before anything the 300-character cut can reach -- a long ingredient take with room-making deposits', () => {
  const tried = Array.from({ length: 24 }, (_, i) => `${-1300 - i},120,${-1300 - i}:${i === 3 ? 'chest_unreachable' : 'none'}`)
  const row = W.withdrawRow({ outcome: 'took_ingredients', need: 'cobblestone:3,stick:2,planks:4', verification: 'server', cursor: 'empty', chestRoom: 20,
    plan: 'bamboo,bamboo', srv: 'cobbled_deepslate:+3,stick:+2,oak_planks:+4,bamboo:-128', bagBefore: 1500, bagAfter: 1381,
    deposited: [{ name: 'bamboo', count: 64 }, { name: 'bamboo', count: 64 }], took: { cobbled_deepslate: 3, stick: 2, oak_planks: 4 },
    tried, search: { town: 32, pick: 20, ing: 6, ...W.searchTally(tried) } })
  assert.equal(row.length, 300, 'cut')
  assert.match(row, /^outcome=took_ingredients need=\S+ uses=- verification=server verb=withdraw_pick town=32 cand=20,6 visits=24 maxrep=1 vfail=1 cursor=/)
  assert.equal(row.split('verb=').length, 2, 'verb= once')
  const plain = W.withdrawRow({ outcome: 'took', need: 'stick:2', verification: 'server', tried: ['1,2,3:success'], verb: 'withdraw' })
  assert.match(plain, / took=- verb=withdraw tried=\[1,2,3:success\]$/, 'the model verb\'s row keeps its layout')
})

await t('NO ROOM FOR THE PICKAXE ENDS ONLY ITS PASS (Codex final P2): the town is at its stone target, so nothing the bag holds can make room for a pickaxe -- and the one stick still needed fits a partial stack: the ingredient pass takes it', async () => {
  const { installCobbleCap } = await import('../src/skills.mjs')
  // a full bag: the table, 64 cobblestone, ONE stick (a partial stack), 20 stone (the only room-making stack) and junk
  const bag = [stack('crafting_table', 1), stack('cobblestone', 64), stack('stick', 1), stack('stone', 20), ...Array.from({ length: 32 }, () => stack('bamboo', 64))]
  const w = farTown({ bag, far: [stack('stick', 9)] })
  const B = await import('../src/bankable.mjs')
  installCobbleCap(w.bot); B.setStockWellProbe(() => true)                         // the stock target binds (a usable well)
  try {
  const pk = CHESTS[0]
  w.stock(...pk, [tool('stone_pickaxe', 20), ...Array.from({ length: 10 }, () => stack('stone', 64))])
  journalCount(kOf(pk), { stone_pickaxe: 1, stone: 640 })                       // the town's stone is far above its 64 target
  for (const c of CHESTS.slice(1)) journalCount(kOf(c), {})
  journalCount(kOf(FAR), { stick: 9 })
  const n0 = RECS.length
  const r = await pick(w)
  const row = rows(n0).at(-1) ?? ''
  assert.match(row, /tried=\[5,64,3:inventory_full;/, `positive control: no room for the pickaxe there (${row})`)
  assert.equal(r.status, 'success', `${r.failClass}: ${r.detail}`)
  assert.equal(count(w.bag, 'stick'), 2, 'the stick merged into the partial stack')
  assert.equal(count(w.bag, 'stone_pickaxe'), 0)
  assert.match(row, /^outcome=took_ingredients /)
  } finally { B.setStockReaders({}) }                                              // the rest of the file runs reader-less
})

await t('NO_ROOM (the plan admitted, the journal\'s claim refused) ends the pickaxe pass after ONE container, not one per holder; the ingredient pass still runs', async () => {
  const { installCobbleCap } = await import('../src/skills.mjs')
  const B = await import('../src/bankable.mjs')
  const bag = [stack('crafting_table', 1), stack('cobblestone', 64), stack('stick', 1), stack('stone', 20), ...Array.from({ length: 32 }, () => stack('bamboo', 64))]
  const w = farTown({ bag, far: [stack('stick', 9)] })
  installCobbleCap(w.bot)
  // a STALE plan view (Claude final P3): the plan thinks the town has room for stone; the journal (640 counted) refuses
  B.setStockReaders({ town: () => ({ lb: 0, complete: true, reserved: 0, floor: 0, avail: 0 }), well: () => true })
  try {
    for (const c of CHESTS) { w.stock(...c, [tool('stone_pickaxe', 20), ...Array.from({ length: 10 }, () => stack('stone', 64))]); journalCount(kOf(c), { stone_pickaxe: 1, stone: 640 }) }
    journalCount(kOf(FAR), { stick: 9 })
    const n0 = RECS.length
    const r = await pick(w)
    const row = rows(n0).at(-1) ?? ''
    assert.match(row, /tried=\[-?\d+,64,-?\d+:no_room;-13,64,5:success\]/, `one refused holder, then the sticks: ${row}`)
    assert.equal(r.status, 'success', r.detail); assert.equal(count(w.bag, 'stick'), 2)
    assert.equal(w.spy.opened.length, 2, `${w.spy.opened}`)
  } finally { B.setStockReaders({}) }
})

await t('NO_ROOM AND A MIXED CHEST (Claude r5 P2): the only sticks sit in a chest that also holds a pickaxe -- after the refused claim the ingredient pass takes the stick, not the same refused trade', async () => {
  const B = await import('../src/bankable.mjs')
  const w = await noRoomMixed(B)
  try {
    const n0 = RECS.length
    const r = await pick(w)
    const row = rows(n0).at(-1) ?? ''
    assert.match(row, /:no_room;/, `positive control: the claim was refused (${row})`)
    assert.equal(r.status, 'success', `${r.failClass}: ${r.detail}`)
    assert.equal(count(w.bag, 'stick'), 2); assert.equal(count(w.bag, 'stone_pickaxe'), 0)
  } finally { B.setStockReaders({}) }
})
async function noRoomMixed (B, S = null) {
  const { installCobbleCap } = S ?? await import('../src/skills.mjs')
  const bag = [stack('crafting_table', 1), stack('cobblestone', 64), stack('stick', 1), stack('stone', 20), ...Array.from({ length: 32 }, () => stack('bamboo', 64))]
  const w = farTown({ bag, far: [tool('stone_pickaxe', 20), stack('stick', 9), ...Array.from({ length: 10 }, () => stack('stone', 64))] })
  installCobbleCap(w.bot)
  B.setStockReaders({ town: () => ({ lb: 0, complete: true, reserved: 0, floor: 0, avail: 0 }), well: () => true })
  for (const c of CHESTS) { w.stock(...c, [tool('stone_pickaxe', 20), ...Array.from({ length: 10 }, () => stack('stone', 64))]); journalCount(kOf(c), { stone_pickaxe: 1, stone: 640 }) }
  journalCount(kOf(FAR), { stone_pickaxe: 1, stick: 9, stone: 640 })
  return w
}

// ------------------------------------------------------------------------------------- composition with plinth-02
await t('PLINTH FUNDING is the model\'s withdraw verb, untouched: nearest chest first (not the journal\'s holder), the old row layout (no town=), and a pickaxe miss does not hide a chest from it', async () => {
  const w = farTown({ bag: [stack('crafting_table', 1)], far: [stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 64)], rest: [stack('dirt', 5)] })
  w.stock(...CHESTS[0], [stack('cobblestone', 64)])                          // the nearest chest holds cobble too, UNCOUNTED
  journalCount(kOf(FAR), { cobble: 192 })   // FAR is the only journal holder: townSearchOrder (any want) would open it first
  CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.notePickMisses(e, [kOf(CHESTS[0])]))   // a live pickaxe miss there
  const n0 = RECS.length
  const r = await SKILLS.withdraw.run({ bot: w.bot }, { item: 'cobblestone', count: 32 }, sig())
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.opened, [kOf(CHESTS[0])], 'nearest first, as before')
  assert.equal(count(w.bag, 'cobblestone'), 32)
  const row = rows(n0).at(-1) ?? ''
  assert.match(row, / verb=withdraw tried=\[/); assert.doesNotMatch(row, / town=/)
})

// ------------------------------------------------------------------------------------- the pickaxe pass's clock
await t('THE INGREDIENTS\' RESERVE (Codex r1 P2): the pickaxe pass\'s clock ends WITHDRAW_INGREDIENT_RESERVE_MS before the order\'s, for every part of a visit', () => {
  const now = 1_000_000
  const pc = W.passClock(now + 55_000, W.WITHDRAW_INGREDIENT_RESERVE_MS, () => now)
  assert.equal(pc.deadline, now + 15_000)
  assert.equal(pc.msLeft(30_000), 15_000, 'a 30 s walk gets 15 s: the reserve is never spent')
  assert.equal(pc.msLeft(8_000), 8_000)
  assert.equal(W.passClock(now + 30_000, W.WITHDRAW_INGREDIENT_RESERVE_MS, () => now).msLeft(Infinity), 0, 'inside the reserve: nothing')
  assert.equal(W.passClock(now + 30_000, 0, () => now).msLeft(Infinity), 30_000, 'no reserve: the whole clock')
})
await t('THE RESERVE IS WIRED (structural: a walk\'s real timeout cannot be driven here): the pickaxe pass gates and runs its visits on passClock, the ingredient pass on the order\'s clock', () => {
  const src = readFileSync(SKILLS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const run = src.slice(src.indexOf('async function withdrawPickRun'), src.indexOf('async function withdrawPickRun') + 9000)
  assert.ok(src.indexOf('async function withdrawPickRun') > 0, 'anchor')
  assert.match(run, /const pc = passClock\(deadline, WITHDRAW_INGREDIENT_RESERVE_MS\)/)
  assert.match(run, /n < WITHDRAW_PICK_VISITS && next\.block && pc\.msLeft\(Infinity\) >= WITHDRAW_VISIT_MIN_MS/)
  assert.match(run, /withdrawVisit\(ctx, cb, pickDecision, signal, pc\.msLeft, pc\.deadline - 2_000\)/)
  assert.match(run, /withdrawVisit\(ctx, cb, ingredientDecision, signal, msLeft, deadline - 2_000\)/)
})

// ------------------------------------------------------------------------------------------- anchored mutants
await t('MUTANTS (skills.mjs): each removes one part of the search and a behaviour test above fails', async () => {
  const journalFirst = async S => {
    const w = farTown(); journalCount(kOf(FAR), { stone_pickaxe: 1 }); for (const c of CHESTS) journalCount(kOf(c), {})
    const r = await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
    assert.equal(r.status, 'success'); assert.deepEqual(w.spy.opened, [kOf(FAR)])
  }
  const resumes = async S => {
    const w = farTown({ far: [stack('dirt', 1)], bag: [stack('crafting_table', 1), stack('cobblestone', 3), stack('stick', 2)] })
    journalCount(kOf(FAR), { stone_pickaxe: 1 })                    // a stale count...
    later(1_000)
    CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.notePickMisses(e, [kOf(FAR)]))   // ...a later miss wins
    await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
    assert.ok(!w.spy.opened.includes(kOf(FAR)), `the far chest is a live miss: ${w.spy.opened}`)
  }
  const failSkip = async S => {
    const w = farTown({ far: [stack('dirt', 1)] })
    const wall = [9, 64, 10]
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) w.set(wall[0] + dx, 64, wall[2] + dz, 'stone')
    journalCount(kOf(wall), { stone_pickaxe: 1 })
    await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
    const n = w.spy.gotos.filter(g => g.x === wall[0] && g.z === wall[2]).length
    later(WITHDRAW_COOLDOWN_MS)
    await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
    assert.equal(w.spy.gotos.filter(g => g.x === wall[0] && g.z === wall[2]).length, n)
  }
  const fullOnce = async S => {
    const fullBag = [stack('crafting_table', 1), stack('cobblestone', 64), stack('stone', 20), ...Array.from({ length: 33 }, () => stack('bamboo', 64))]
    const w = farTown({ bag: fullBag, far: [stack('dirt', 1)] })
    const c = CHESTS[0]
    w.stock(...c, [...Array.from({ length: 26 }, () => stack('cobblestone', 64)), stack('stick', 30)])
    journalCount(kOf(c), { stick: 30, cobble: 1664 })
    await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
    assert.equal(w.spy.opened.filter(k => k === kOf(c)).length, 2)
  }
  const pickInIngredients = async S => {
    const w = farTown({ bag: [stack('crafting_table', 1), stack('cobblestone', 3)], far: [stack('dirt', 1)] })
    // every chest has a pickaxe the journal cannot see (an iron one is no stock group) -- the pickaxe pass gets 0 visits
    // when every container is a live pickaxe miss, so the ingredient pass is the one that opens it
    for (const c of CHESTS) CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.notePickMisses(e, [kOf(c)]))
    CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.notePickMisses(e, [kOf(FAR)]))
    w.stock(...CHESTS[0], [tool('iron_pickaxe', 10), stack('stick', 4)])
    const r = await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
    assert.equal(r.status, 'success'); assert.equal(count(w.bag, 'iron_pickaxe'), 1)
  }
  const wiring = async S => {   // the structural test above, run against the mutant's source
    const src = readFileSync(new URL(S.__mutantPath ?? SKILLS_PATH), 'utf8')
    assert.match(src, /withdrawVisit\(ctx, cb, pickDecision, signal, pc\.msLeft, pc\.deadline - 2_000\)/)
  }
  const ingPassMiss = async S => {   // a big town: the ingredient pass's opens are pickaxe misses too, so order 2 opens none of order 1's
    freshPool(); clearWithdrawHolds()
    const w = withServer(fakeWorld({ bag: [stack('crafting_table', 1), stack('cobblestone', 3)] }))
    for (let x = -12; x <= 12; x += 3) for (let z = -12; z <= 12; z += 3) if (Math.hypot(x, z) <= 13 && !(x === 6 && z === 0)) { w.set(x, 64, z, 'chest'); w.stock(x, 64, z, [stack('dirt', 5)]) }
    await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
    const first = new Set(w.spy.opened)
    assert.equal(first.size, WITHDRAW_PICK_VISITS + WITHDRAW_INGREDIENT_VISITS)
    later(WITHDRAW_COOLDOWN_MS + WITHDRAW_BACKOFF_MS)
    const n = w.spy.opened.length
    await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
    assert.deepEqual(w.spy.opened.slice(n).filter(k => first.has(k)), [], 'order 2 re-opened none of order 1\'s containers')
  }
  const mixedChest = async S => {
    const B = await import('../src/bankable.mjs')
    const w = await noRoomMixed(B, S)
    try {
      const r = await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
      assert.equal(r.status, 'success'); assert.equal(count(w.bag, 'stick'), 2)
    } finally { B.setStockReaders({}) }
  }
  const noRoomClaim = async S => {
    const B = await import('../src/bankable.mjs')
    const bag = [stack('crafting_table', 1), stack('cobblestone', 64), stack('stick', 1), stack('stone', 20), ...Array.from({ length: 32 }, () => stack('bamboo', 64))]
    const w = farTown({ bag, far: [stack('stick', 9)] })
    S.installCobbleCap(w.bot)
    B.setStockReaders({ town: () => ({ lb: 0, complete: true, reserved: 0, floor: 0, avail: 0 }), well: () => true })
    try {
      for (const c of CHESTS) { w.stock(...c, [tool('stone_pickaxe', 20), ...Array.from({ length: 10 }, () => stack('stone', 64))]); journalCount(kOf(c), { stone_pickaxe: 1, stone: 640 }) }
      journalCount(kOf(FAR), { stick: 9 })
      const r = await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
      assert.equal(r.status, 'success'); assert.equal(w.spy.opened.length, 2, `${w.spy.opened}`)
    } finally { B.setStockReaders({}) }
  }
  const noRoomPass = async S => {
    const bag = [stack('crafting_table', 1), stack('cobblestone', 64), stack('stick', 1), stack('stone', 20), ...Array.from({ length: 32 }, () => stack('bamboo', 64))]
    const w = farTown({ bag, far: [stack('stick', 9)] })
    const B = await import('../src/bankable.mjs')
    S.installCobbleCap(w.bot); B.setStockWellProbe(() => true)
    try {
      w.stock(...CHESTS[0], [tool('stone_pickaxe', 20), ...Array.from({ length: 10 }, () => stack('stone', 64))])
      journalCount(kOf(CHESTS[0]), { stone_pickaxe: 1, stone: 640 }); journalCount(kOf(FAR), { stick: 9 })
      for (const c of CHESTS.slice(1)) journalCount(kOf(c), {})
      const r = await S.SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
      assert.equal(r.status, 'success'); assert.equal(count(w.bag, 'stick'), 2)
    } finally { B.setStockReaders({}) }
  }
  const gateSeesCount = async S => {
    const w = farTown({ far: [stack('dirt', 1)], bag: [stack('crafting_table', 1), stack('cobblestone', 3), stack('stick', 2)] })
    for (const c of [...CHESTS, FAR]) CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.notePickMisses(e, [kOf(c)]))
    assert.equal(S.townPickMiss(w.bot), true, 'every container a live miss')
    later(1_000); journalCount(kOf(FAR), { stone_pickaxe: 1 })
    assert.equal(S.townPickMiss(w.bot), false, 'a newer count of a pickaxe re-opens the gate')
  }
  const gateCoverage = async S => {
    const w = farTown({ far: [stack('dirt', 1)] })
    for (const c of [...CHESTS, FAR]) CF.updateTownMemory(memDir(), CF.townKey(HOME), null, e => CF.notePickMisses(e, [kOf(c)]))
    assert.equal(S.townPickMiss(w.bot), true, 'positive control: all loaded, all missed')
    w.bot.world = { getColumnAt: () => null }                      // a column under the town square not loaded
    later(25_000)                                                   // past the scan's 20 s cache
    assert.equal(S.townPickMiss(w.bot), false, 'an unloaded town column: coverage cannot be claimed')
  }
  for (const [name, fn] of [['journalFirst', journalFirst], ['resumes', resumes], ['failSkip', failSkip], ['fullOnce', fullOnce], ['pickInIngredients', pickInIngredients],
                            ['gateSeesCount', gateSeesCount], ['gateCoverage', gateCoverage], ['ingPassMiss', ingPassMiss], ['noRoomPass', noRoomPass], ['noRoomClaim', noRoomClaim], ['mixedChest', mixedChest]]) {
    const S = await import('../src/skills.mjs')
    await fn(S).catch(e => { throw new Error(`positive control ${name} fails on the real code: ${e.message}`) })
  }
  const M = [
    ['the journal\'s counts ignored', '{ counts: view.counts, misses: view.misses, tookAt: view.tookAt, skip: view.skip, want, now: view.now }', '{ counts: {}, misses: view.misses, tookAt: view.tookAt, skip: view.skip, want, now: view.now }', journalFirst],
    ['the misses ignored', '{ counts: view.counts, misses: view.misses, tookAt: view.tookAt, skip: view.skip, want, now: view.now }', '{ counts: view.counts, misses: {}, tookAt: view.tookAt, skip: view.skip, want, now: view.now }', resumes],
    ['the gate ignores the journal', '{ counts: view.counts, misses: view.misses, tookAt: view.tookAt, skip: view.skip, now: view.now }).length === 0', '{ counts: {}, misses: view.misses, tookAt: view.tookAt, skip: view.skip, now: view.now }).length === 0', gateSeesCount],
    ['the gate ignores coverage', '  if (!view.coverage || !view.containers.length) return false', '  if (!view.containers.length) return false', gateCoverage],
    ['no skip after a visit that could not look inside', '  bot.withdrawSearchSkip.set(containerKey(bot, cb.position), now + SEARCH_FAIL_SKIP_MS)', '  void 0', failSkip],
    ['the order\'s own opens not excluded', 'if (halves.some(h => tried.has(h)) ||', 'if (', fullOnce],
    ['the ingredient pass leaves a pickaxe', '    if (p?.tool && !refusedRoom) return p', '    if (false) return p', pickInIngredients],
    ['the ingredient pass writes no pickaxe miss', '{ if (!pickSeen) notePickMisses(e, keys); noteIngredientMisses', '{ noteIngredientMisses', ingPassMiss],
    ['the ingredient pass re-sends the refused pickaxe trade', '    if (p?.tool && !refusedRoom) return p', '    if (p?.tool) return p', mixedChest],
    ['a refused claim does not end the pickaxe pass', "const pickPassEnds = v => v.result?.failClass === 'no_room' ||", "const pickPassEnds = v => false ||", noRoomClaim],
    ['no room for a pickaxe ends the order', '      if (pickPassEnds(v)) { pickNoRoom = v.result; break }', '      if (false) { pickNoRoom = v.result; break }', noRoomPass],
    ['the pickaxe visit on the order\'s whole clock', 'withdrawVisit(ctx, cb, pickDecision, signal, pc.msLeft, pc.deadline - 2_000)', 'withdrawVisit(ctx, cb, pickDecision, signal, msLeft, deadline - 2_000)', wiring],
  ]
  for (const [name, old, neu, fn] of M) {
    const killed = await withMutant(SKILLS_PATH, old, neu, S => killedBy(() => fn(S)))
    assert.ok(killed, `mutant survived: ${name}`)
  }
})
await t('MUTANTS (withdrawpick.mjs): the pure order\'s rules', async () => {
  const now = 1e12
  const C = [{ k: 'a', d: 3 }, { k: 'b', d: 9 }, { k: 'c', d: 1 }]
  const probe = Wm => {
    const o = Wm.townSearchOrder(C, ['stick'], { now, counts: { stick: { b: { n: 1, at: now - 1_000 }, a: { n: 0, at: now - 1_000 } } }, misses: { stick: { c: now - 1_000 } } })
    assert.deepEqual(o.map(r => r.k), ['b'])
    const p = Wm.townSearchOrder(C, ['stick'], { now, misses: { stick: { c: now - 1_000 } }, tookAt: { c: now - 10 } })
    assert.deepEqual(p.map(r => r.k), ['c', 'a', 'b'])
  }
  probe(W)
  const M = [
    ['a count of none is not a look', '      if (missLive || zeroLive) continue', '      if (missLive) continue'],
    ['farthest first', '|| a.d - b.d ||', '|| b.d - a.d ||'],
    ['a deposit does not end a miss', 'const missLive = Number.isFinite(m) && now - m < missTtl && !(took > m)', 'const missLive = Number.isFinite(m) && now - m < missTtl'],
  ]
  for (const [name, old, neu] of M) {
    const killed = await withMutant(WP_PATH, old, neu, Wm => killedBy(() => probe(Wm)))
    assert.ok(killed, `mutant survived: ${name}`)
  }
})

Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
