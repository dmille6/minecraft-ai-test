// TOWNINDEX-01: every open of a town container records what the SERVER sent (per name: count AND slots), every mutation marks
// the container dirty, every verified move is a transfer record; count_town adds the index's unknown containers to its
// candidates. Design: docs/reports/town-plan-2026-10-20.md section 4.2 (OWNER 10-20 "yes, lets do this").
//
// Behaviour first: the pure observation / fold / state by truth table (order-independence by permutation), the runtime home
// allocator reproducing the design's data/homes.json from the 00:15Z census (16 towns, exactly), the file (rotation, a stale
// generation, a fragment, another world); then the REAL skills in fake worlds -- the deposit verb, town_deposit with its
// verifying re-open against a server that is separate from the client, the toolkit's withdraw visits, count_town -- and the
// index never touching the cobble journal or the stock counts. Anchored mutants (the anchor present and unique, or the mutant
// is not a kill).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

// kitmulti-01: this file proves the ONE-CONTAINER rule (TOOLKIT_MULTI=off, the rollback); the multi-container draw is
// proven in kitmulti.test.mjs
process.env.TOOLKIT_MULTI = 'off'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-townindex-logs-'))
process.env.BOT_NAME = 'IndexBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-townindex-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const TI = await import('../src/townindex.mjs')
const S0 = await import('../src/skills.mjs')
const CC = await import('../src/cobblecap.mjs')
const CF = await import('../src/chestfull.mjs')
const B = await import('../src/bankable.mjs')
const { clearWithdrawHolds } = B
const { KIT } = await import('../src/toolkit.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const rowsOf = (kind, n0 = 0) => RECS.slice(n0).filter(r => r.skill?.name === kind).map(r => r.skill?.detail ?? '')
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const TI_PATH = new URL('../src/townindex.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} is not in ${p.pathname}. A mutant that was never written reads as killed.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
/** Did the mutant change the behaviour the test pins? -> true when the test FAILS under the mutant (killed). A crash is not a kill. */
const killedBy = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

const realNow = Date.now
let offset = 0
Date.now = () => realNow() + offset
const later = ms => { offset += ms }

const HOME = { x: 0, y: 64, z: 0 }
const HK = TI.indexHomeKey(HOME)
const dir = () => process.env.POOL_STATE_DIR
const records = () => TI.indexRecords(dir(), HK).filter(r => r.t !== 'ckpt')
const entries = () => { TI.resetIndexCache(); return TI.readIndex(dir(), HK, null).entries }
const slotted = list => list.map((it, i) => ({ ...it, slot: it.slot ?? 9 + i }))
const withServer = w => {
  w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => ({ answered: true, cursorEmpty: !win.selectedItem, carried: win.selectedItem ? { itemCount: win.selectedItem.count } : null }) }
  return w
}
const filesIn = d => fs.readdirSync(d).sort()
const snap = d => Object.fromEntries(filesIn(d).filter(f => !f.startsWith('town-index-')).map(f => [f, fs.readFileSync(path.join(d, f), 'utf8')]))

// ------------------------------------------------------------------------------------------------- the pure observation
await t('observation: per name [count, slots] of the CONTAINER only (a bag slot past the size, an empty or nameless item, a repeated slot are not the container)', () => {
  const o = TI.observation([{ name: 'iron_ingot', count: 12, slot: 0 }, { name: 'iron_ingot', count: 3, slot: 5 }, { name: 'coal', count: 64, slot: 2 },
    { name: 'stick', count: 9, slot: 27 }, { name: 'dirt', count: 0, slot: 3 }, { count: 4, slot: 4 }, { name: 'coal', count: 1, slot: 2 }], 27)
  assert.deepEqual(o, { names: { iron_ingot: [15, 2], coal: [64, 1] }, used: 3, size: 27 })
  assert.deepEqual(TI.observation([], 54), { names: {}, used: 0, size: 54 })
  assert.equal(TI.observation([{ name: 'oak_log', count: 64, slot: 40 }], 54).used, 1, 'a double chest has 54')
})

// ------------------------------------------------------------------------------------------------- the fold and the states
const O = (k, at, id, names = { coal: [1, 1] }, extra = {}) => ({ t: 'obs', k, at, id, h: [k], size: 27, used: 1, names, w: null, ...extra })
const D = (k, at, id) => ({ t: 'dirty', k, at, id, w: null })
const state = (recs, k = 'a', now = 1000) => TI.indexStateOf(TI.foldIndex(recs).worlds[JSON.stringify(null)]?.[k], now)
const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]))
const pureFold = (T = TI) => {
  const st = (recs, k = 'a', now = 1000) => T.indexStateOf(T.foldIndex(recs).worlds[JSON.stringify(null)]?.[k], now)
  assert.equal(st([]), 'unknown')
  assert.equal(st([O('a', 10, 'o1')]), 'known')
  assert.equal(st([O('a', 10, 'o1'), D('a', 20, 'd1')]), 'dirty', 'a mutation after the open')
  assert.equal(st([O('a', 10, 'o1'), D('a', 20, 'd1'), O('a', 30, 'o2')]), 'known', 'an open after the mutation')
  assert.equal(st([D('a', 20, 'd1'), O('a', 15, 'o2')]), 'dirty', 'an open CAPTURED before the mutation, appended after it, does not clear it')
  assert.equal(st([O('a', 20, 'o1'), D('a', 20, 'd1')]), 'dirty', 'a tie: dirty wins')
  assert.equal(st([D('a', 20, 'd1'), O('a', 20, 'o1')]), 'dirty', 'a tie: dirty wins, whatever the order')
  assert.equal(st([O('a', 10, 'o1')], 'a', 10 + T.INDEX_STALE_MS), 'stale')
  assert.equal(st([O('a', 10, 'o1')], 'a', 9 + T.INDEX_STALE_MS), 'known')
  // AN OPEN MUTATION (Codex r1 P1): A's pre mark, B's open during A's clicks, A crashes before its post mark -> dirty
  const P = (at, op, phase) => ({ t: 'dirty', k: 'a', at, id: `${op}-${phase}`, op, phase, w: null })
  assert.equal(st([O('a', 10, 'o1'), P(20, 'opA', 'pre'), O('a', 30, 'o2')]), 'dirty', "B's open inside A's open mutation is not knowledge")
  assert.equal(st([O('a', 10, 'o1'), P(20, 'opA', 'pre'), O('a', 20 + T.OP_TTL_MS, 'o3')], 'a', 30 + T.OP_TTL_MS), 'known', "an open after the crashed mutation's window is")
  assert.equal(st([O('a', 10, 'o1'), P(20, 'opA', 'pre'), P(25, 'opA', 'post'), O('a', 30, 'o2')]), 'known', 'a closed mutation, then an open: known')
  assert.equal(st([P(25, 'opA', 'post'), O('a', 30, 'o2'), P(20, 'opA', 'pre'), P(20, 'opA', 'pre')]), 'known', 'order-free and idempotent: a duplicate pre never reopens it')
  assert.equal(st([O('a', 10, 'o1'), P(20, 'opA', 'pre'), P(22, 'opB', 'pre'), P(25, 'opA', 'post'), O('a', 30, 'o2')]), 'dirty', "another mutation (B's) still open")
  assert.equal(st([O('a', 10, 'o1'), P(20, 'opA', 'pre'), { t: 'dirty', k: 'a', at: 25, id: 'h', op: 'opA', phase: 'held', w: null }, O('a', 30, 'o2')]), 'dirty', 'a HELD window keeps its operation open')
}
await t('the fold: last capture wins per container; a tie goes to dirty; an open captured before a mutation never clears it; stale past 6 h', () => pureFold())
await t('the fold is ORDER-INDEPENDENT and IDEMPOTENT: every permutation of 5 records (with a duplicate) folds to the same entries', () => {
  const recs = [O('a', 10, 'o1', { coal: [3, 1] }), D('a', 20, 'd1'), O('a', 30, 'o2', { iron_ingot: [9, 1] }), O('b', 5, 'o3'), D('b', 5, 'd2')]
  const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
  const want = canon(TI.foldIndex(recs).worlds)
  for (const p of perms(recs)) assert.equal(canon(TI.foldIndex([...p, p[0]]).worlds), want, JSON.stringify(p.map(r => r.id)))
  const e = TI.foldIndex(recs).worlds[JSON.stringify(null)]
  assert.deepEqual(e.a.obs.names, { iron_ingot: [9, 1] }); assert.equal(TI.indexStateOf(e.a, 40), 'known'); assert.equal(TI.indexStateOf(e.b, 40), 'dirty')
})
await t('indexHolding: a KNOWN entry\'s count of the names matched; stale, dirty and unknown say nothing (null)', () => {
  const e = TI.foldIndex([O('a', 10, 'o1', { iron_ingot: [12, 1], coal: [5, 2] })]).worlds[JSON.stringify(null)].a
  assert.deepEqual(TI.indexHolding(e, 'iron_ingot', 20), { n: 12, slots: 1, at: 10 })
  assert.deepEqual(TI.indexHolding(e, n => /^(coal|charcoal)$/.test(n), 20), { n: 5, slots: 2, at: 10 })
  assert.deepEqual(TI.indexHolding(e, 'stick', 20), { n: 0, slots: 0, at: 10 }, 'known: none of it')
  assert.equal(TI.indexHolding(e, 'iron_ingot', 10 + TI.INDEX_STALE_MS), null, 'stale')
  assert.equal(TI.indexHolding(TI.foldIndex([O('a', 10, 'o1'), D('a', 11, 'd')]).worlds[JSON.stringify(null)].a, 'coal', 20), null, 'dirty')
  assert.equal(TI.indexHolding(undefined, 'coal', 20), null, 'unknown')
  assert.deepEqual(TI.indexUnknownKeys(['a', 'b'], { a: e }), ['b'])
})
await t('the group map v1 is the census tool\'s (first match wins -- so a copper SLAB is wood, as the census counted it): iron/copper metal, coal fuel, cobble stone, sticks wood, ores valuable, else misc', () => {
  const g = TI.groupOfItem
  assert.deepEqual(['iron_ingot', 'raw_copper', 'cut_copper_slab', 'coal', 'charcoal', 'cobblestone', 'stone_bricks', 'stick', 'oak_slab', 'diamond', 'gold_ore', 'stone_pickaxe', 'bucket', 'oak_sapling', 'oak_leaves', 'dirt', 'flint', 'torch', 'chest', 'cooked_beef', 'iron_ore', 'coal_ore'].map(g),
    ['metal', 'metal', 'wood', 'fuel', 'fuel', 'stone', 'stone', 'wood', 'wood', 'valuable', 'valuable', 'tools', 'tools', 'farm', 'farm', 'earth', 'earth', 'build', 'build', 'misc', 'metal', 'fuel'])
})

// ------------------------------------------------------------------------------------------------- the home allocator
const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/townplan-census-20261020T0015Z.json', import.meta.url), 'utf8'))
const parity = (T = TI) => {
  let towns = 0
  for (const [w, v] of Object.entries(FIX.worlds)) {
    const [x, y, z] = v.home
    const r = T.allocateHomes(v.containers.map(c => ({ k: c.k.join(','), halves: c.halves.length, names: c.names })), { home: { x, y, z } })
    const ks = a => a.map(k => (Array.isArray(k) ? k.join(',') : k))
    for (const g of T.GROUP_ORDER) assert.deepEqual(ks(r.homes[g]), ks(v.expect.homes[g]), `${w} ${g}`)
    assert.deepEqual(ks(r.overflow), ks(v.expect.overflow), `${w} overflow`)
    assert.deepEqual(ks(r.drain), ks(v.expect.drain), `${w} drain`)
    for (const g of T.GROUP_ORDER) assert.equal(r.capacity[g], v.expect.home_capacity_slots[g], `${w} capacity ${g}`)
    towns++
  }
  assert.equal(towns, 16)
}
await t('THE PARITY TEST (design 4.2/6.1): the runtime allocator on index entries built from the 00:15Z census reproduces data/homes.json exactly -- homes, overflow, drain and capacity, 16 towns', () => parity())
await t('the allocator: a group with no stock gets no home; capacity counts 27 per half; at most 3 containers per group; one overflow (fewest used, nearest home)', () => {
  const r = TI.allocateHomes([
    { k: '1,64,0', halves: 1, names: { iron_ingot: [64, 30] } }, { k: '2,64,0', halves: 2, names: { iron_ingot: [10, 30] } },
    { k: '3,64,0', halves: 1, names: { raw_iron: [5, 20] } }, { k: '9,64,0', halves: 1, names: { dirt: [1, 1] } },
    { k: '4,64,0', halves: 1, names: {} }, { k: '5,64,0', halves: 1, names: { coal: [64, 1] } }], { home: HOME })
  assert.deepEqual(r.homes.metal, ['1,64,0', '2,64,0'], 'most of the group first; 80 slots: 27 + 54 covers them, so the third holder stays out')
  assert.equal(r.capacity.metal, 27 + 54)
  assert.deepEqual(r.homes.fuel, ['5,64,0']); assert.deepEqual(r.homes.wood, []); assert.equal(r.capacity.wood, 0)
  assert.deepEqual(r.homes.earth, ['9,64,0'])
  assert.deepEqual(r.overflow, ['4,64,0'], 'the emptiest unassigned'); assert.deepEqual(r.drain, ['3,64,0'], 'the rest drain (even a metal holder past the cap)')
  const capped = TI.allocateHomes([1, 2, 3, 4].map(x => ({ k: `${x},64,0`, halves: 1, names: { iron_ingot: [10 * x, 27] } })), { home: HOME })
  assert.deepEqual(capped.homes.metal, ['4,64,0', '3,64,0', '2,64,0'], 'at most 3, though 108 slots would need 4')
})

// ------------------------------------------------------------------------------------------------- the file
await t('the file: append + read round-trips; another world\'s records are absent; a fragment (a dead writer\'s half line) is skipped', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-file-'))
  assert.ok(TI.appendIndex(d, HK, 'W1', O('a', 10, 'o1')))
  assert.ok(TI.appendIndex(d, HK, 'W2', O('b', 10, 'o2')))
  fs.appendFileSync(TI.indexFile(d, HK, 1), '{"t":"obs","k":"c","at":1')   // a fragment, no newline: never read
  TI.resetIndexCache()
  assert.deepEqual(Object.keys(TI.readIndex(d, HK, 'W1').entries), ['a'])
  assert.deepEqual(Object.keys(TI.readIndex(d, HK, 'W2').entries), ['b'])
  assert.ok(TI.appendIndex(d, HK, 'W1', D('a', 20, 'd1')), 'the next append starts on a fresh line')
  assert.equal(TI.indexStateOf(TI.readIndex(d, HK, 'W1').entries.a, 30), 'dirty', 'the cached reader continues from its offset')
  TI.resetIndexCache()
  assert.equal(TI.indexStateOf(TI.readIndex(d, HK, 'W1').entries.a, 30), 'dirty', 'and a fresh fold agrees')
  assert.deepEqual(Object.keys(TI.readIndex(d, HK, 'W1').entries).sort(), ['a'], 'the fragment never became a record')
})
await t('ROTATION: past the size a writer starts generation N+1 with the fold of N-1 and N; N-2 is deleted; entries survive every rotation; a late record in N-1 is still read', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-rot-'))
  for (let i = 0; i < 40; i++) TI.appendIndex(d, HK, null, O(`k${i % 7}`, 100 + i, `o${i}`, { coal: [i + 1, 1] }), { rotateBytes: 600 })
  const gens = TI.indexGens(d, HK)
  assert.ok(gens.length === 2 && gens[1] >= 4, `rotated several times, two generations kept: ${gens}`)
  TI.resetIndexCache()
  const e = TI.readIndex(d, HK, null).entries
  for (let j = 0; j < 7; j++) {
    const last = Math.max(...[...Array(40).keys()].filter(i => i % 7 === j))
    assert.deepEqual(e[`k${j}`].obs.names, { coal: [last + 1, 1] }, `k${j} keeps its newest observation across ${gens[1] - 1} rotations`)
  }
  assert.equal(TI.indexRecords(d, HK).filter(r => r.t === 'ckpt').length >= 1, true)
  // a record written into the generation BELOW the newest (a writer that read the old one) is still folded: readers read N-1
  fs.appendFileSync(TI.indexFile(d, HK, gens[0]), '\n' + JSON.stringify(D('k0', 999, 'late')) + '\n')
  assert.equal(TI.indexStateOf(TI.readIndex(d, HK, null).entries.k0, 1000), 'dirty', 'N-1 is followed by the CACHED reader too (Codex r1 P1), no reset')
  TI.resetIndexCache()
  assert.equal(TI.indexStateOf(TI.readIndex(d, HK, null).entries.k0, 1000), 'dirty', 'and a fresh fold agrees')
})
await t('ROTATION PUBLISHES WHOLE (Codex r1 P1): a generation another writer already created is never overwritten; the new one appears with its checkpoint as its first line', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-rot2-'))
  TI.appendIndex(d, HK, null, O('a', 10, 'o1'))
  fs.writeFileSync(TI.indexFile(d, HK, 2), '\n' + JSON.stringify(D('a', 20, 'theirs')) + '\n')   // another writer's generation 2
  assert.equal(TI.rotateIndex(d, HK, 1), false, 'the rotation yields')
  assert.match(fs.readFileSync(TI.indexFile(d, HK, 2), 'utf8'), /"theirs"/, 'their record is intact')
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-rot3-'))
  TI.appendIndex(d2, HK, null, O('a', 10, 'o1'))
  assert.equal(TI.rotateIndex(d2, HK, 1), true)
  const first = fs.readFileSync(TI.indexFile(d2, HK, 2), 'utf8').split('\n').filter(Boolean)[0]
  assert.equal(JSON.parse(first).t, 'ckpt', 'the checkpoint is the first line, written before the generation existed')
  assert.deepEqual(fs.readdirSync(d2).filter(f => f.endsWith('.tmp')), [], 'no temp left')
})
await t('the reader\'s cache folds only what was appended since, and agrees with a fresh fold after 200 interleaved appends', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-cache-'))
  TI.resetIndexCache()
  for (let i = 0; i < 200; i++) {
    TI.appendIndex(d, HK, null, i % 3 ? O(`k${i % 5}`, i, `o${i}`, { coal: [i, 1] }) : D(`k${i % 5}`, i, `d${i}`), { rotateBytes: 4000 })
    if (i % 17 === 0) TI.readIndex(d, HK, null)
  }
  const cached = JSON.stringify(TI.readIndex(d, HK, null).entries)
  TI.resetIndexCache()
  assert.equal(cached, JSON.stringify(TI.readIndex(d, HK, null).entries))
})
await t('TOWNINDEX=off: nothing is written or read (the one-setting rollback); the licence row says index=off', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-off-'))
  const code = `const S = await import(${JSON.stringify(SKILLS_PATH.href)}); const T = await import(${JSON.stringify(TI_PATH.href)});
    const { fakeWorld, stack } = await import(${JSON.stringify(new URL('./fakeworld.mjs', import.meta.url).href)});
    const w = fakeWorld({ bag: [] }); w.set(3, 64, 0, 'chest'); w.stock(3, 64, 0, [stack('coal', 5)])
    const win = await w.bot.openContainer(w.bot.blockAt({ x: 3, y: 64, z: 0 }))
    const id = S.townIndexObserve(w.bot, { x: 3, y: 64, z: 0 }, win, 'test')
    console.log(JSON.stringify({ on: T.TOWNINDEX.on, id, dirty: S.townIndexDirty(w.bot, { x: 3, y: 64, z: 0 }, 'test'), files: (await import('node:fs')).readdirSync(process.env.POOL_STATE_DIR), mode: T.townIndexModeDetail() }))`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TOWNINDEX: 'off', POOL_STATE_DIR: d }, encoding: 'utf8' })
  const out = JSON.parse(r.stdout.trim().split('\n').at(-1))
  assert.deepEqual({ on: out.on, id: out.id, dirty: out.dirty, files: out.files.filter(f => f.startsWith('town-index-')) }, { on: false, id: null, dirty: false, files: [] }, r.stderr)
  assert.match(out.mode, /^phase=mode index=off v=1 /)
  assert.match(TI.townIndexModeDetail(), /^phase=mode index=on v=1 groups=1 stale_h=6 rotate_mb=4 records=obs,dirty,xfer count_town=index_unknown$/)
})

// ------------------------------------------------------------------------------------------------- the writer, through the real skills
await t('the observation at an open: the TOWN container\'s server contents, its key, both halves of a double chest under the LOWER key; a container OUTSIDE town is never indexed', async () => {
  freshPool()
  const w = fakeWorld({ bag: [] })
  w.set(4, 64, 1, 'chest', { facing: 'north', type: 'left' }); w.set(5, 64, 1, 'chest', { facing: 'north', type: 'right' })   // a double chest
  w.set(30, 64, 0, 'chest')                                                                                                  // 30 from home: not town
  w.stock(5, 64, 1, [stack('iron_ingot', 12), stack('coal', 30), stack('iron_ingot', 4)])
  w.stock(30, 64, 0, [stack('coal', 64)])
  const open = async p => w.bot.openContainer(w.bot.blockAt(p))
  const win = await open({ x: 5, y: 64, z: 1 })
  const id = S0.townIndexObserve(w.bot, new Vec3(5, 64, 1), win, 'test')
  win.close()
  assert.ok(id)
  const r = records()
  assert.equal(r.length, 1)
  assert.deepEqual({ k: r[0].k, h: r[0].h, names: r[0].names, used: r[0].used, size: r[0].size, by: r[0].by }, { k: '4,64,1', h: ['4,64,1', '5,64,1'], names: { iron_ingot: [16, 2], coal: [30, 1] }, used: 3, size: 27, by: 'test' })
  const far = await open({ x: 30, y: 64, z: 0 })
  assert.equal(S0.townIndexObserve(w.bot, new Vec3(30, 64, 0), far, 'test'), null, 'outside town')
  far.close()
  assert.equal(records().length, 1, 'nothing written for it')
  // a window that is no longer the bot's cannot vouch for what the server sent
  const w2 = await open({ x: 5, y: 64, z: 1 }); w.bot.currentWindow = null
  assert.equal(S0.townIndexObserve(w.bot, new Vec3(5, 64, 1), w2, 'test'), null)
})
await t('THE INDEX NEVER WRITES THE COBBLE JOURNAL OR THE STOCK COUNTS: its observe / dirty / transfer writers leave every other file of the town byte-identical', async () => {
  freshPool()
  const w = fakeWorld({ bag: [] })
  w.set(3, 64, 0, 'chest'); w.stock(3, 64, 0, [stack('cobblestone', 64), stack('oak_log', 32), stack('stick', 9)])
  const win0 = await w.bot.openContainer(w.bot.blockAt({ x: 3, y: 64, z: 0 }))
  await S0.cobbleObserve(w.bot, new Vec3(3, 64, 0), win0)   // the town's cobble journal exists (positive control: it has a count)
  win0.close()
  const before = snap(dir())
  assert.ok(Object.keys(before).some(f => f.endsWith('.cobble.jsonl')), 'positive control: the cobble journal is there')
  const st0 = JSON.stringify(CC.readTown(dir(), CF.townKey(HOME), null))
  const win = await w.bot.openContainer(w.bot.blockAt({ x: 3, y: 64, z: 0 }))
  S0.townIndexObserve(w.bot, new Vec3(3, 64, 0), win, 'test'); S0.townIndexDirty(w.bot, new Vec3(3, 64, 0), 'test', 'pre')
  S0.townIndexTransfers(w.bot, new Vec3(3, 64, 0), [{ slot: 4, name: 'stick', n: 3 }], { op: 'x', by: 'test', ok: 1 })
  win.close()
  assert.deepEqual(snap(dir()), before, 'no other file changed')
  assert.equal(JSON.stringify(CC.readTown(dir(), CF.townKey(HOME), null)), st0, 'the cobble/stock fold is the same')
  assert.equal(records().length, 3, 'the index wrote its own three records')
})

// THE DEPOSIT VERB: an open in town -> the observation BEFORE any click, the dirty marks around the clicks, unverified transfers
const depWorld = ({ chest = [5, 64, 0], at = [6.5, 64, 0.5], bag = [stack('oak_log', 30), stack('dirt', 20)], held = [stack('coal', 3)] } = {}) => {
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000
  const w = withServer(fakeWorld({ bag: slotted(bag), at }))
  w.set(...chest, 'chest'); w.stock(...chest, held.map(s => ({ ...s })))
  return w
}
const depositShape = async (S = S0) => {
  const w = depWorld()
  let atFirst = null
  const tf0 = w.bot.transfer.bind(w.bot), dep0 = w.bot.openContainer.bind(w.bot)
  w.bot.openContainer = async b => { const win = await dep0(b); const d0 = win.deposit.bind(win); win.deposit = async (...a) => { atFirst ??= records().map(x => `${x.t}:${x.phase ?? x.by}`); return d0(...a) }; return win }
  w.bot.transfer = async (...a) => { atFirst ??= records().map(x => `${x.t}:${x.phase ?? x.by}`); return tf0(...a) }
  const r = await S.SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(atFirst, ['obs:deposit', 'dirty:pre'], 'the pre mark is on disk before the first move')
  const recs = records()
  assert.deepEqual(recs.map(x => `${x.t}:${x.phase ?? x.by}`), ['obs:deposit', 'dirty:pre', ...recs.filter(x => x.t === 'xfer').map(() => 'xfer:deposit'), 'dirty:post'])
  assert.deepEqual(recs[0].names, { coal: [3, 1] }, 'the observation is the contents BEFORE the deposit')
  const xf = recs.filter(x => x.t === 'xfer')
  assert.ok(xf.length >= 1 && xf.every(x => x.ok === 0 && x.pre === recs[0].id && x.ver === null && x.k === '5,64,0'), JSON.stringify(xf))
  const gained = Object.fromEntries(xf.map(x => [x.name, x.n]))
  const now = TI.observation(w.containers.get('5,64,0').slots.map((s, i) => s && { ...s, slot: i }).filter(Boolean), 27).names
  for (const [n, c] of Object.entries(gained)) assert.equal(c, now[n][0] - (n === 'coal' ? 3 : 0), `${n}: the record is what the container gained`)
  assert.equal(TI.indexStateOf(entries()['5,64,0']), 'dirty')
}
await t('THE DEPOSIT VERB: obs (by=deposit, the pre-click contents) -> dirty pre (on disk before the first move) -> transfers ok=0 (what the window gained) -> dirty post; the container ends DIRTY', () => depositShape())
await t('THE DEPOSIT VERB, a container OUTSIDE town: the deposit runs as today, and the index writes nothing', async () => {
  const w = depWorld({ chest: [30, 64, 0], at: [29.5, 64, 0.5] })
  const r = await S0.SKILLS.deposit.run({ bot: w.bot }, {}, new AbortController().signal)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(w.containers.get('30,64,0').slots.some(s => s?.name === 'oak_log'), 'positive control: the deposit happened')
  assert.deepEqual(records(), [])
})

// TOWN_DEPOSIT, against a server separate from the client (towndeposit.test.mjs's world, copied: the verifying re-open
// reads the SERVER's chest)
function tdWorld ({ items, containers, botAt = new Vec3(3, 64, 0), onClick = null }) {
  const bagSlots = Array(46).fill(null)
  for (const it of items) bagSlots[it.slot] = { ...it }
  const server = { bag: bagSlots.map(x => (x ? { ...x } : null)) }
  const st = { opened: [], clicks: 0 }
  const contAt = p => containers.find(c => c.pos.x === p.x && c.pos.y === p.y && c.pos.z === p.z)
  const blk = c => ({ name: c.type ?? 'chest', type: mcData.blocksByName[c.type ?? 'chest'].id, position: c.pos, boundingBox: 'block',
                      getProperties: () => c.props ?? { type: 'single', facing: 'north' } })
  const left = (w, slot) => {
    const at = w.slots[slot], cur = w.selectedItem
    if (!cur) { if (at) { w.selectedItem = { ...at }; w.slots[slot] = null } return }
    if (!at) { w.slots[slot] = { ...cur, slot }; w.selectedItem = null; return }
    if (at.name === cur.name) { const size = mcData.itemsByName[cur.name].stackSize; const m = Math.min(size - at.count, cur.count); at.count += m; cur.count -= m; if (!cur.count) w.selectedItem = null; return }
    w.slots[slot] = { ...cur, slot }; w.selectedItem = { ...at }
  }
  const bot = {
    entity: { position: botAt, velocity: { x: 0, y: 0, z: 0 } }, registry: mcData, controlState: {}, currentWindow: null,
    craftSync: { lockstep: fn => fn(), inflight: () => 0, invalidate: () => 0, recount: async () => ({ source: 'server', items: server.bag.slice(9, 45).filter(Boolean) }),
      confirmCursor: async win => { const c = win?.server?.selectedItem; return { answered: true, cursorEmpty: !c, carried: c ? { itemCount: c.count } : null } } },
    equip: async () => {}, unequip: async () => {}, moveSlotItem: async () => {}, toss: async () => {}, tossStack: async () => {}, closeWindow: () => {},
    removeListener: () => {}, once: () => {}, _client: {},
    inventory: { inventoryStart: 9, items: () => bagSlots.slice(9, 45).filter(Boolean) },
    findBlocks: ({ maxDistance }) => containers.map(c => c.pos).filter(p => bot.entity.position.distanceTo(p) <= maxDistance),
    blockAt: p => { const c = contAt(p); return c ? blk(c) : { name: 'air', boundingBox: 'empty' } },
    pathfinder: { goto: async () => {}, setGoal: () => {} },
    setControlState: () => {}, lookAt: async () => {}, waitForTicks: async () => {},
    openContainer: (b) => {
      const c = contAt(b.position)
      st.opened.push(`${c.pos.x},${c.pos.y},${c.pos.z}`)
      const n = c.size ?? 27
      const mk = () => {
        const w = { slots: Array(n + 36).fill(null), selectedItem: null }
        for (let i = 0; i < n; i++) w.slots[i] = c.items[i] ? { ...c.items[i], slot: i } : null
        for (let s = 9; s < 45; s++) w.slots[s - 9 + n] = server.bag[s] ? { ...server.bag[s], slot: s - 9 + n } : null
        return w
      }
      const win = { id: st.opened.length, inventoryStart: n, inventoryEnd: n + 36, ...mk() }
      win.items = () => win.slots.slice(n, n + 36).filter(Boolean)
      win.containerItems = () => win.slots.slice(0, n).filter(Boolean)
      win.firstEmptySlotRange = (a, b) => { for (let i = a; i < b; i++) if (!win.slots[i]) return i; return null }
      win.findItemRange = (a, b, type, _m, notFull) => { for (let i = a; i < b; i++) { const x = win.slots[i]; if (x && x.type === type && (!notFull || x.count < (x.stackSize ?? 64))) return { ...x, slot: i } } return null }
      win.server = mk()
      win.close = () => {
        for (let i = 0; i < n; i++) c.items[i] = win.server.slots[i] ? { ...win.server.slots[i] } : null
        for (let s = 9; s < 45; s++) {
          bagSlots[s] = win.slots[s - 9 + n] ? { ...win.slots[s - 9 + n], slot: s } : null
          server.bag[s] = win.server.slots[s - 9 + n] ? { ...win.server.slots[s - 9 + n], slot: s } : null
        }
        win.selectedItem = null; win.server.selectedItem = null
        if (bot.currentWindow === win) bot.currentWindow = null
      }
      bot.currentWindow = win
      return Promise.resolve(win)
    },
    clickWindow: async (slot) => {
      const win = bot.currentWindow
      st.clicks++
      if (onClick) onClick(slot, win, st)
      left(win, slot); left(win.server, slot)
    },
  }
  return { bot, st, bagSlots, server }
}
const item = (name, count = 1, slot = 9) => ({ name, count, slot, type: mcData.itemsByName[name].id, stackSize: mcData.itemsByName[name].stackSize })
const filler = n => Array.from({ length: n }, (_, i) => item('white_wool', 1 + (i % 3), 9 + 6 + i))   // never banked
const tdBag = () => [item('oak_log', 64, 9), item('oak_log', 64, 10), item('oak_log', 20, 11), item('apple', 30, 12), item('dirt', 30, 13), item('torch', 20, 14), ...filler(29)]
const tdChest = (x, items = []) => ({ pos: new Vec3(x, 64, 0), items: Array.from({ length: 27 }, (_, i) => (items[i] ? item(...items[i], i) : null)) })
const tdRun = (S, w) => S.SKILLS.town_deposit.run({ bot: w.bot }, {}, null)
const townDepositShape = async (S = S0) => {
  freshPool(); offset += 61 * 60_000
  const c = tdChest(2, [['iron_ingot', 7], ['coal', 12]])
  let preAtFirstClick = null
  const w = tdWorld({ items: tdBag(), containers: [c], onClick: (_s, _w, st) => { if (st.clicks === 1) preAtFirstClick = records().map(r => `${r.t}:${r.phase ?? r.by}`) } })
  const r = await tdRun(S, w)
  assert.equal(r.status, 'success', r.detail)
  const recs = records()
  const shape = recs.map(x => `${x.t}:${x.phase ?? x.by}`)
  const xi = shape.indexOf('xfer:town_deposit')
  assert.deepEqual(shape.slice(0, 4), ['obs:town_deposit', 'dirty:pre', 'dirty:post', 'obs:verify'], shape.join(' '))
  assert.deepEqual(preAtFirstClick, ['obs:town_deposit', 'dirty:pre'], 'the dirty mark is on disk BEFORE the first click')
  assert.ok(xi === 4 && shape.slice(4).every(s => s === 'xfer:town_deposit'), shape.join(' '))
  const [pre, , , ver] = recs
  assert.deepEqual(pre.names, { iron_ingot: [7, 1], coal: [12, 1] }, 'the pre-state is the open\'s')
  const serverNow = TI.observation(c.items.map((x, i) => x && { ...x, slot: i }).filter(Boolean), 27).names
  assert.deepEqual(ver.names, serverNow, 'the verifying re-open is the SERVER\'s chest after the clicks')
  for (const x of recs.slice(4)) {
    assert.equal(x.ok, 1); assert.equal(x.pre, pre.id); assert.equal(x.ver, ver.id); assert.equal(x.gen, null); assert.equal(x.k, '2,64,0')
    assert.equal(c.items[x.slot]?.name, x.name, `the record's slot ${x.slot} holds ${x.name} on the server`); assert.equal(c.items[x.slot]?.count, x.n)
  }
  assert.equal(TI.indexStateOf(entries()['2,64,0']), 'known', 'known again after the verifying re-open')
  return recs
}
await t('TOWN_DEPOSIT: obs at the open (the pre-state) -> dirty pre (on disk before the first click) -> dirty post -> obs at the verifying re-open (the server\'s chest) -> one VERIFIED transfer per stack (pre and ver ids, slot, name, count); the container ends KNOWN', () => townDepositShape())

// THE TOOLKIT'S WITHDRAW VISITS (the kit search, toolkit-03): every container it opens is observed; the one it drew from is dirty
const fakeCraft = w => async (_ctx, { item: name }) => {
  const take = (n0, n) => { for (const it of w.bag.filter(x => x?.name === n0)) { const k = Math.min(n, it.count); it.count -= k; n -= k; if (!it.count) w.bag.splice(w.bag.indexOf(it), 1); if (!n) break } }
  take('iron_ingot', KIT[name].ingots); take('stick', KIT[name].sticks)
  w.bag.push({ ...tool(name), slot: 40 })
  return { status: 'success', detail: `crafted 1 ${name}` }
}
const NEAR = [[5, 64, 3], [8, 64, -3], [2, 64, -5]]
const FAR = [-13, 64, 5]
const kitWorld = () => {
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000
  const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }
  const w = withServer(fakeWorld({ bag: slotted([T('iron_pickaxe', 200), stack('stick', 9)]) }))
  for (const c of NEAR) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  w.set(...FAR, 'chest'); w.stock(...FAR, [stack('iron_ingot', 20)])
  return w
}
const kitRun = (S, w) => S.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, {}, new AbortController().signal)
const kitShape = async (S = S0) => {
  const w = kitWorld()
  let atFirstClick = null
  const click0 = w.bot.clickWindow.bind(w.bot)
  w.bot.clickWindow = async (...a) => { if (atFirstClick == null) atFirstClick = records().filter(r => r.k === '-13,64,5').map(r => `${r.t}:${r.phase ?? r.by}`); return click0(...a) }
  const r = await kitRun(S, w)
  assert.equal(r.status, 'success', r.detail)
  const e = entries()
  for (const c of [...NEAR]) assert.equal(TI.indexStateOf(e[c.join(',')]), 'known', `${c} was looked in: known`)
  assert.deepEqual(e[FAR.join(',')].obs.names, { iron_ingot: [20, 1] }, 'the observation is what the container held BEFORE the draw')
  assert.equal(TI.indexStateOf(e[FAR.join(',')]), 'dirty', 'the container drawn from is dirty until it is opened again')
  assert.deepEqual(atFirstClick, ['obs:withdraw', 'dirty:pre'], 'the pre mark is on disk before the first click')
  assert.deepEqual(records().filter(x => x.k === FAR.join(',')).map(x => `${x.t}:${x.phase ?? x.by}`), ['obs:withdraw', 'dirty:pre', 'dirty:post'])
  return w
}
await t('THE TOOLKIT\'S WITHDRAW VISITS: each container opened is observed (by=withdraw); the one drawn from: obs -> dirty pre (before the first click) -> dirty post, DIRTY after', () => kitShape())
await t('A FOREIGN OPEN DURING THE CLICKS is superseded by the closing mark: the drawn container is dirty, not known', async () => {
  const w = kitWorld()
  const click0 = w.bot.clickWindow.bind(w.bot)
  let injected = false
  w.bot.clickWindow = async (...a) => {
    if (!injected && w.bot.currentWindow?.containerItems?.().some(it => it.name === 'iron_ingot')) {
      injected = true
      later(5)
      TI.appendIndex(dir(), HK, null, { t: 'obs', id: 'other-bot', k: FAR.join(','), h: [FAR.join(',')], at: Date.now(), size: 27, used: 1, names: { iron_ingot: [20, 1] }, bot: 'Other' })
      later(5)
    }
    return click0(...a)
  }
  const r = await kitRun(S0, w)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(injected, 'positive control: the other bot\'s observation was written')
  assert.equal(TI.indexStateOf(entries()[FAR.join(',')]), 'dirty')
})

// x ironpick-01 (this variant's base, 2d410985): the kit's IRON PICKAXE draw (7 ingots: pickaxe + axe + shovel) and its
// narrowed pickaxe-only draw (args.n = 1) are the same withdraw visits -- observed at the open, dirty around the clicks; a
// container looked in and left (the whole kit's 7 + 4 not there) stays KNOWN with what it held, the count indexsearch ranks on
const pickWorld = (farIron = 20) => {
  freshPool(); clearWithdrawHolds(); offset += 61 * 60_000
  const T = (name, left) => { const c = tool(name); c.durabilityUsed = c.maxDurability - left; return c }
  const w = withServer(fakeWorld({ bag: slotted([T('iron_pickaxe', 30), stack('stick', 9)]) }))   // 30 uses: at/below the trip line
  for (const c of NEAR) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 5)]) }
  w.set(...FAR, 'chest'); w.stock(...FAR, [stack('iron_ingot', farIron)])
  return w
}
const ironIn = (w, c) => w.containers.get(c.join(',')).slots.filter(Boolean).reduce((n, it) => n + (it.name === 'iron_ingot' ? it.count : 0), 0)
const ironpickShape = async (S = S0) => {
  const w = pickWorld()
  const r = await kitRun(S, w)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(w.bag.filter(it => it?.name === 'iron_pickaxe').length, 2, 'the kit made an iron pickaxe (positive control: ironpick-01 is live on this base)')
  assert.equal(ironIn(w, FAR), 13, 'the whole kit\'s 7 ingots came from FAR')
  const e = entries()
  assert.deepEqual(e[FAR.join(',')].obs.names, { iron_ingot: [20, 1] }, 'the observation is what FAR held BEFORE the pickaxe draw')
  assert.equal(TI.indexStateOf(e[FAR.join(',')]), 'dirty', 'the container drawn from is dirty until it is opened again')
  assert.deepEqual(records().filter(x => x.k === FAR.join(',')).map(x => `${x.t}:${x.phase ?? x.by}`), ['obs:withdraw', 'dirty:pre', 'dirty:post'])
  return w
}
await t('x IRONPICK-01: the kit\'s iron-pickaxe draw (7 ingots) is indexed like any withdraw visit: obs -> dirty pre -> dirty post, DIRTY after', () => ironpickShape())
await t('x IRONPICK-01: a whole-kit run that ends `narrow` leaves FAR KNOWN with its 8 ingots; the pickaxe-only run (n=1) then draws 3 there and leaves it DIRTY', async () => {
  const w = pickWorld(8)
  const r1 = await kitRun(S0, w)
  assert.equal(r1.failClass, 'kit_search_narrow', r1.detail)
  assert.equal(ironIn(w, FAR), 8, 'nothing drawn')
  let e = entries()
  assert.equal(TI.indexStateOf(e[FAR.join(',')]), 'known', 'looked in and left: known')
  assert.deepEqual(e[FAR.join(',')].obs.names, { iron_ingot: [8, 1] })
  const r2 = await S0.SKILLS.toolkit.run({ bot: w.bot, kitCraft: fakeCraft(w) }, { n: 1 }, new AbortController().signal)
  assert.equal(r2.status, 'success', r2.detail)
  assert.equal(ironIn(w, FAR), 5, 'the pickaxe\'s 3 ingots only')
  e = entries()
  assert.equal(TI.indexStateOf(e[FAR.join(',')]), 'dirty')
  assert.deepEqual(records().filter(x => x.k === FAR.join(',') && x.t === 'dirty').map(x => x.phase), ['pre', 'post'], 'one operation: the draw')
})
await t('x IRONPICK-01 MUTANT: without the withdraw visit\'s pre mark the pickaxe draw\'s shape fails (killed for the intended reason)', async () => {
  assert.equal(await withMutant(SKILLS_PATH, "ixDirty = true; townIndexDirty(bot, cp, 'withdraw', 'pre', ixOp)", 'ixDirty = true', S => killedBy(() => ironpickShape(S))), true)
})

// COUNT_TOWN: the index's unknown containers fill what the stock keys leave of the visit's 3, after them
const cobbleBag = () => slotted([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 40), tool('stone_pickaxe', 10)])
const countWorld = async () => {
  freshPool(); offset += 61 * 60_000
  S0.resetCobbleReconcile()
  const w = withServer(fakeWorld({ bag: cobbleBag() }))
  for (const c of [[5, 64, 0], [8, 64, 3], [-4, 64, 5], [2, 64, -9]]) { w.set(...c, 'chest'); w.stock(...c, [stack('dirt', 3)]) }
  S0.installCobbleCap(w.bot); B.setStockWellProbe(() => true)
  const key = CF.townKey(HOME)
  // the town's cobble journal: every container counted, then a reset (every container UNKNOWN to the cap), then three of
  // them counted again by "another bot" straight into the journal -- known to the cap, never opened since the index began
  for (const k of ['5,64,0', '8,64,3', '-4,64,5', '2,64,-9']) CC.recordCount(dir(), key, null, { obs: { k, n: 0, m: {}, cap: Date.now() }, bot: 'other' })
  later(5); CC.appendJournal(dir(), key, null, { t: 'reset', at: Date.now() }); later(5)
  for (const k of ['8,64,3', '-4,64,5', '2,64,-9']) CC.recordCount(dir(), key, null, { obs: { k, n: 0, m: {}, cap: Date.now() }, bot: 'other' })
  return w
}
const countShape = async (S = S0) => {
  const w = await countWorld()
  try {
    assert.deepEqual(S.indexRecountKeys(w.bot, ['5,64,0']).sort(), ['-4,64,5', '2,64,-9', '8,64,3'], 'positive control: three index-unknown containers')
    const n0 = RECS.length
    const r = await S.SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
    const recount = rowsOf('_stock_recount', n0)[0] ?? ''
    const change = rowsOf('_townindex_count', n0)[0] ?? ''
    assert.equal(r.status, 'success', r.detail)
    assert.match(recount, /keys=1 counted=1 tried=1 /, 'the stock key: counted, and the row\'s counts are the BASE\'s (the stock keys only)')
    assert.match(change, /^keys=1 extra=3 counted=2 tried=2 unknown_left=1$/, change)
    assert.equal(w.spy.opened[0], '5,64,0', 'the stock key first')
    assert.equal(w.spy.opened.length, 3, 'at most 3 per visit, as today')
    const e = entries()
    assert.equal(Object.values(e).filter(x => TI.indexStateOf(x) === 'known').length, 3)
    assert.ok(records().every(x => x.t === 'obs' && x.by === 'count'))
  } finally { B.setStockReaders({ town: null, well: null }) }
}
await t('COUNT_TOWN: the stock key is counted first, then index-unknown containers fill the visit\'s 3; `_stock_recount` keeps the base\'s counts; `_townindex_count` names the extras', () => countShape())
await t('reconcileCobble with the defaults is the base\'s: the same opens, counted and tried', async () => {
  const w = await countWorld()
  try {
    const rc = await S0.reconcileCobble(w.bot, new AbortController().signal, cap => cap, ['5,64,0'], { remember: true })
    assert.deepEqual({ counted: rc.counted, tried: rc.tried, opened: w.spy.opened }, { counted: 1, tried: 1, opened: ['5,64,0'] })
  } finally { B.setStockReaders({ town: null, well: null }) }
})
const abortExtra = async (S = S0) => {
  const w = await countWorld()
  S.resetIndexCount?.()
  try {
    const ac = new AbortController()
    const open0 = w.bot.openContainer.bind(w.bot)
    w.bot.openContainer = async b => { if (w.spy.opened.length >= 1) ac.abort(); return open0(b) }   // the abort lands during the FIRST extra
    const n0 = RECS.length
    let r
    try { r = await S.SKILLS.count_town.run({ bot: w.bot }, {}, ac.signal) } catch (e) { assert.fail('count_town threw after its base count had ended: ' + e.message) }
    assert.equal(r.status, 'success', "the base's count had ended: its outcome stands (Codex r1 P2)")
    assert.equal(r.counted, 1)
    assert.match(rowsOf('_stock_recount', n0)[0] ?? '', /keys=1 counted=1 tried=1 /)
    assert.match(rowsOf('_townindex_count', n0)[0] ?? '', /^keys=1 extra=3 /)
    assert.equal(RECS.slice(n0).find(x => x.skill?.name === '_townindex_count')?.skill?.status, 'aborted')
  } finally { B.setStockReaders({ town: null, well: null }) }
}
await t("COUNT_TOWN: an abort during the extras never changes the base's outcome (success, counted=1, the base row); the change row says aborted", () => abortExtra())
await t("COUNT_TOWN: an extra that cannot be counted backs off in ITS OWN map -- never the stock keys' reconcile backoff, never a recount miss", async () => {
  const w = await countWorld()
  S0.resetIndexCount()
  try {
    w.bot.openContainer = (open0 => async b => { if (b.position.x !== 5) throw new Error('windowOpen did not fire'); return open0(b) })(w.bot.openContainer.bind(w.bot))
    const n0 = RECS.length
    await S0.SKILLS.count_town.run({ bot: w.bot }, {}, new AbortController().signal)
    assert.match(rowsOf('_townindex_count', n0)[0] ?? '', /^keys=1 extra=3 counted=0 tried=2 /, 'positive control: two extras were tried and failed')
    assert.deepEqual(S0.cobbleReconcilable({ unknown: ['8,64,3', '-4,64,5', '2,64,-9'] }).sort(), ['-4,64,5', '2,64,-9', '8,64,3'], "the stock keys' backoff is untouched")
    assert.ok(!fs.readdirSync(dir()).some(f => f.endsWith('.recount.json')), 'no recount miss written')
  } finally { B.setStockReaders({ town: null, well: null }) }
})

// A HELD WINDOW (holdUnsettled): the operation stays open while the hold lives -- renewed every HELD_RENEW_MS -- and its end
// writes the post mark (Codex r2 P1, Claude r1 P2)
const heldShape = async (S = S0) => {
  const w = kitWorld()
  // the server never confirms an empty cursor: the visit's transfer cannot settle, the window is HELD
  w.bot.craftSync.confirmCursor = async () => ({ answered: true, cursorEmpty: false, carried: { itemCount: 1 } })
  try { await kitRun(S, w) } catch { /* the run's own outcome does not matter here */ }
  const marks = () => records().filter(x => x.t === 'dirty' && x.k === FAR.join(',')).map(x => x.phase)
  assert.ok(w.bot.inventoryUnsettled, 'positive control: the window is held')
  assert.deepEqual(marks(), ['pre', 'held'], 'held, not closed')
  later(TI.HELD_RENEW_MS + 1000)
  await new Promise(r => setTimeout(r, 1500))
  assert.deepEqual(marks(), ['pre', 'held', 'held'], 'renewed while the hold lives')
  later(TI.OP_TTL_MS - 60_000)
  TI.appendIndex(dir(), HK, null, { t: 'obs', id: 'another', k: FAR.join(','), h: [FAR.join(',')], at: Date.now(), size: 27, used: 1, names: { iron_ingot: [20, 1] }, bot: 'Other' })
  assert.equal(TI.indexStateOf(entries()[FAR.join(',')]), 'dirty', "another bot's open past the first window, inside the renewed one: still dirty")
  await w.bot.inventoryUnsettled.release('test')
  for (let i = 0; i < 40 && marks().length < 4; i++) await new Promise(r => setTimeout(r, 50))   // after the clicks drain
  assert.deepEqual(marks(), ['pre', 'held', 'held', 'post'], 'the hold\'s end closes the operation')
}
await t('A HELD WINDOW keeps its operation open (renewed while held, past the first OP_TTL window) and its end writes the post mark', () => heldShape())
const compactShape = (T = TI) => {
  const P = (at, op, phase) => ({ t: 'dirty', k: 'a', at, id: `${op}-${phase}`, op, phase, w: null })
  const e = T.foldIndex([P(10, 'opA', 'pre'), P(20, 'opA', 'post'), O('a', 30, 'o1')]).worlds[JSON.stringify(null)].a
  const c = T.compactEntry(e)
  const replay = T.foldIndex([{ t: 'ckpt', worlds: { [JSON.stringify(null)]: { a: c } } }, P(10, 'opA', 'pre')]).worlds[JSON.stringify(null)].a
  assert.equal(T.indexStateOf(replay, 40), 'known', 'a duplicate pre replayed after the checkpoint never reopens a closed operation')
  const old = T.compactEntry(T.foldIndex([P(10, 'opA', 'pre'), P(20, 'opA', 'post'), O('a', 20 + T.OP_TTL_MS, 'o2')]).worlds[JSON.stringify(null)].a)
  assert.deepEqual(old.ops, {}, 'dropped once the observation is past its last mark + OP_TTL_MS')
  // a POST-ONLY tombstone (its pre not on disk yet) survives compaction (Codex r3 P2)
  const po = T.compactEntry(T.foldIndex([P(200, 'opB', 'post'), O('a', 300, 'o3')]).worlds[JSON.stringify(null)].a)
  const rp = T.foldIndex([{ t: 'ckpt', worlds: { [JSON.stringify(null)]: { a: po } } }, P(100, 'opB', 'pre')]).worlds[JSON.stringify(null)].a
  assert.equal(T.indexStateOf(rp, 400), 'known', 'a replayed pre after a compacted post-only tombstone stays closed')
  // a HELD mark with no pre (the pre's write failed) still protects (Codex r3 P2)
  const ho = T.foldIndex([P(100, 'opC', 'held'), O('a', 300, 'o4')]).worlds[JSON.stringify(null)].a
  assert.equal(T.indexStateOf(ho, 400), 'dirty', 'held without a pre: still a live operation')
}
await t('CHECKPOINT COMPACTION keeps a closed operation as a tombstone until the observation is past its protection (Codex r2 P2)', () => compactShape())

await t('AN UNREADABLE INDEX is never "every container unknown": no extras (the base\'s count only) (Codex r3 P2, Claude r2 P3)', async () => {
  if (process.getuid?.() === 0) return   // root reads anything: the permission fixture would not bite
  const w = await countWorld()
  S0.resetIndexCount()
  try {
    TI.appendIndex(dir(), HK, null, { t: 'obs', id: 'x', k: '99,64,99', h: ['99,64,99'], at: Date.now(), size: 27, used: 0, names: {} })
    assert.equal(S0.indexRecountKeys(w.bot, ['5,64,0']).length, 3, 'positive control: readable, three extras')
    fs.chmodSync(dir(), 0o300); TI.resetIndexCache()   // listable no more (EACCES), still writable
    assert.deepEqual(S0.indexRecountKeys(w.bot, ['5,64,0']), [], 'unreadable: none')
    assert.equal(S0.townIndexEntries(w.bot), null)
  } finally { fs.chmodSync(dir(), 0o700); B.setStockReaders({ town: null, well: null }) }
})

// ------------------------------------------------------------------------------------------------- the mutants
await t('MUTANTS (anchored, unique): each pinned behaviour fails under its mutant', async () => {
  const kills = {}
  kills.noOpenObs = await withMutant(SKILLS_PATH, "const ixPre = townIndexObserve(bot, c.position, win, 'town_deposit')", 'const ixPre = null', S => killedBy(() => townDepositShape(S)))
  kills.noVerifyObs = await withMutant(SKILLS_PATH, "const ix = townIndexObserve(bot, block.position, win, 'verify')", 'const ix = null', S => killedBy(() => townDepositShape(S)))
  kills.noPreMarkTd = await withMutant(SKILLS_PATH, "ixDirty = true; townIndexDirty(bot, c.position, 'town_deposit', 'pre', ixOp)", 'ixDirty = true', S => killedBy(() => townDepositShape(S)))
  kills.noPostMarkTd = await withMutant(SKILLS_PATH, "else townIndexDirty(bot, c.position, 'town_deposit', 'post', ixOp) }", '}', S => killedBy(() => townDepositShape(S)))
  kills.noPreMarkDep = await withMutant(SKILLS_PATH, "ixDirty = true; townIndexDirty(bot, chestBlock.position, 'deposit', 'pre', ixOp)", 'ixDirty = true', S => killedBy(() => depositShape(S)))
  kills.noPostMarkDep = await withMutant(SKILLS_PATH, "      townIndexDirty(bot, chestBlock.position, 'deposit', 'post', ixOp)\n", '\n', S => killedBy(() => depositShape(S)))
  kills.heldNotRenewed = await withMutant(SKILLS_PATH, "if (win.ixHeld && Date.now() - win.ixHeld.last >= HELD_RENEW_MS)", 'if (false)', S => killedBy(() => heldShape(S)))
  kills.heldNotClosed = await withMutant(SKILLS_PATH, "      try { ixHeldEnd?.close() } catch { /* advisory: a crash here leaves the operation to expire OP_TTL_MS past its last renewal */ }\n", '\n', S => killedBy(() => heldShape(S)))
  kills.compactDropsTombstone = await withMutant(TI_PATH, '    if (e.obs && Number.isFinite(e.obs.at) && e.obs.at >= lastMark(o) + OP_TTL_MS) continue   // a post-only tombstone too (Codex code r3 P2)\n', '    if (o.post != null) continue\n', T => killedBy(() => compactShape(T)))
  kills.noPreMarkWd = await withMutant(SKILLS_PATH, "ixDirty = true; townIndexDirty(bot, cp, 'withdraw', 'pre', ixOp)", 'ixDirty = true', S => killedBy(() => kitShape(S)))
  kills.noPostMarkWd = await withMutant(SKILLS_PATH, "else townIndexDirty(bot, cp, 'withdraw', 'post', ixOp) }", '}', S => killedBy(() => kitShape(S)))
  kills.anyContainer = await withMutant(SKILLS_PATH, 'const townIndexed = pos => TOWNINDEX.on && !!pos && inTown(homeVec(), pos)', 'const townIndexed = pos => TOWNINDEX.on && !!pos', async S => killedBy(async () => {
    freshPool()
    const w = fakeWorld({ bag: [] }); w.set(30, 64, 0, 'chest'); w.stock(30, 64, 0, [stack('coal', 64)])
    const win = await w.bot.openContainer(w.bot.blockAt({ x: 30, y: 64, z: 0 }))
    assert.equal(S.townIndexObserve(w.bot, new Vec3(30, 64, 0), win, 'test'), null)
  }))
  kills.writesCobble = await withMutant(SKILLS_PATH, "    return appendIndex(townDir(), indexHk(), bot.worldId ?? null, rec) ? rec.id : null",
    "    recordCount(townDir(), homeTownKey(), bot.worldId ?? null, { obs: { k: rec.k, n: 0, m: {}, cap: rec.at }, bot: 'x' })\n    return appendIndex(townDir(), indexHk(), bot.worldId ?? null, rec) ? rec.id : null", async S => killedBy(async () => {
      freshPool()
      const w = fakeWorld({ bag: [] }); w.set(3, 64, 0, 'chest'); w.stock(3, 64, 0, [stack('cobblestone', 64)])
      const win0 = await w.bot.openContainer(w.bot.blockAt({ x: 3, y: 64, z: 0 })); await S.cobbleObserve(w.bot, new Vec3(3, 64, 0), win0); win0.close()
      const before = snap(dir())
      const win = await w.bot.openContainer(w.bot.blockAt({ x: 3, y: 64, z: 0 }))
      S.townIndexObserve(w.bot, new Vec3(3, 64, 0), win, 'test'); win.close()
      assert.deepEqual(snap(dir()), before)
    }))
  kills.noExtra = await withMutant(SKILLS_PATH, '  const room = RECONCILE_MAX - (rc.tried ?? 0)\n', '  const room = 0\n', S => killedBy(() => countShape(S)))
  kills.extrasPast3 = await withMutant(SKILLS_PATH, '{ max: room, backoff: indexCountFailed, row: false, arrive: true }', '{ max: RECONCILE_MAX, backoff: indexCountFailed, row: false, arrive: true }', S => killedBy(() => countShape(S)))
  kills.extrasInBase = await withMutant(SKILLS_PATH, 'rc = await reconcileCobble(bot, signal, cap => Math.max(0, Math.min(cap, until - Date.now())), keys, { remember: true, progress })',
    'rc = await reconcileCobble(bot, signal, cap => Math.max(0, Math.min(cap, until - Date.now())), [...keys, ...indexRecountKeys(bot, keys)], { remember: true, progress })', S => killedBy(() => countShape(S)))
  kills.abortRethrown = await withMutant(SKILLS_PATH, "    status = e?.aborted || signal?.aborted ? 'aborted' : 'failed'\n", '    throw e\n', S => killedBy(() => abortExtra(S)))
  kills.unreadableIsEmpty = await withMutant(SKILLS_PATH, 'return r.ok ? r.entries : null } catch { return null }', 'return r.entries } catch { return {} }', async S => killedBy(async () => {
    const w = await countWorld()
    try {
      fs.chmodSync(dir(), 0o300); TI.resetIndexCache()
      assert.deepEqual(S.indexRecountKeys(w.bot, ['5,64,0']), [])
    } finally { fs.chmodSync(dir(), 0o700); B.setStockReaders({ town: null, well: null }) }
  }))
  kills.heldNoPre = await withMutant(TI_PATH, "(Number.isFinite(o?.pre) || Number.isFinite(o?.held))", 'Number.isFinite(o?.pre)', T => killedBy(() => compactShape(T)))
  kills.opsIgnored = await withMutant(TI_PATH, "  if (openAt(entry.ops, entry.obs.at)) return 'dirty'", "  if (false) return 'dirty'", T => killedBy(() => pureFold(T)))
  kills.tieToObs = await withMutant(TI_PATH, "const rank = r => (r.t === 'dirty' ? 1 : 0)", "const rank = r => (r.t === 'dirty' ? 0 : 1)", T => killedBy(() => pureFold(T)))
  kills.homeMax2 = await withMutant(TI_PATH, 'export const HOME_MAX = 3', 'export const HOME_MAX = 2', T => killedBy(() => parity(T)))
  kills.mostFirst = await withMutant(TI_PATH, "const k = [...free].sort((a, b) => ((m.get(b) ?? 0) - (m.get(a) ?? 0)) || byFill(a, b))[0]", 'const k = [...free].sort(byFill)[0]', T => killedBy(() => parity(T)))
  const alive = Object.entries(kills).filter(([, k]) => !k).map(([n]) => n)
  assert.deepEqual(alive, [], `mutants that survived: ${alive}`)
  console.log(`        mutants killed: ${Object.keys(kills).join(', ')}`)
})

Date.now = realNow
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
