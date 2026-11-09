// BUILDNEXT-01 (codeeval 2026-11-06 phase 2.2): NEVER IDLE ON A BLOCKED PROJECT. A bot's own holds are scoped to THEIR project --
// its stuck_on_cell stop (was: every project 6 h) and an in-bot breaker on NEXT_K identical empty visits -- so the order takes the
// town's next eligible project in the same call (shopActive: the held project is not `free`), and holds only when nothing else is
// workable. Pure (shop.mjs nextNote / nextHeld / nextBackoff / buildOrder / activeProject) and the chain through skills.mjs
// shopActive + buildNextAfter on real record files, with the controls (BUILDNEXT=0) and anchored mutants.
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-buildnext-logs-'))
process.env.BOT_NAME = 'NextBot'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '70'; process.env.HOME_Z = '0'
process.env.MEMORY_POOL = 'showcase'
process.env.UPKEEP = 'off'   // upkeep-01's plot (on in every named pool) has its own order test: upkeep.test.mjs
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-buildnext-pool-'))
for (const k of ['MONUMENT', 'MONUMENT_POOLS', 'HOUSE', 'PATHS', 'PATHS_POOLS', 'WALL', 'WALL_POOLS', 'BUILDNEXT', 'BUILDNEXT_BREAKER']) delete process.env[k]
process.env.SHAFT = 'off'
process.env.TIDY = 'off'
process.env.TREEFARM = 'off'   // an unsited farm would be the next eligible project: the chain keeps to the monument and the wall
process.env.STARVE = 'off'      // starve-01 has its own chain test (stuckproj.test.mjs): this one isolates the holds

const S = await import('../src/shop.mjs')
const SK = await import('../src/skills.mjs')
const PJ = await import('../src/buildproj.mjs')
const NOW = 1_800_000_000_000
const st = (plot, o = {}) => ({ plot, exists: true, complete: false, damaged: false, ...o })
const withEnv = async (vars, fn) => {
  const was = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]))
  Object.assign(process.env, vars)
  try { return await fn() } finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
}

// ---- the breaker (pure) -----------------------------------------------------------------------------------------------------------
test('nextNote: NEXT_K identical empty visits trip a NEXT_HOLD_MS hold; work, an abort, a new why, a long gap each restart; plots are separate', () => {
  const m = new Map()
  for (let i = 1; i < S.NEXT_K; i++) assert.equal(S.nextNote(m, 'monument', { sig: 'blocked|x', now: NOW + i }).tripped, false, `visit ${i}`)
  assert.equal(S.nextNote(m, 'wall', { sig: 'blocked|x', now: NOW + 5 }).tripped, false, 'another project neither counts nor clears it')
  const t = S.nextNote(m, 'monument', { sig: 'blocked|x', now: NOW + 10 })
  assert.equal(t.tripped, true)
  assert.equal(S.nextHeld('monument', { mem: m, now: NOW + 11 }), 'repeat')
  assert.equal(S.nextHeld('monument', { mem: m, now: NOW + 10 + S.NEXT_HOLD_MS }), null, 'the hold ends')
  assert.equal(S.nextHeld('wall', { mem: m, now: NOW + 11 }), null)
  const m2 = new Map()
  S.nextNote(m2, 'p', { sig: 'a', now: NOW }); S.nextNote(m2, 'p', { sig: 'a', now: NOW + 1 })
  assert.equal(S.nextNote(m2, 'p', { work: true, now: NOW + 2 }).tripped, false); assert.equal(m2.has('p'), false, 'work clears it')
  S.nextNote(m2, 'p', { sig: 'a', now: NOW }); S.nextNote(m2, 'p', { sig: 'a', now: NOW + 1 })
  assert.equal(S.nextNote(m2, 'p', { sig: 'b', now: NOW + 2 }).n, 1, 'a different why starts again')
  S.nextNote(m2, 'p', { sig: 'b', now: NOW + 3 })
  assert.equal(S.nextNote(m2, 'p', { sig: 'b', now: NOW + 3 + S.NEXT_GAP_MS + 1 }).n, 1, 'a gap over NEXT_GAP_MS starts again')
  S.nextNote(m2, 'p', { broken: true }); assert.equal(m2.has('p'), false, 'an abort breaks the streak')
})
test('nextHeld: the bot\'s stuck_on_cell holds ITS project (SHOP_STUCK_RETRY_MS; the stair its 30 min), never another; a future stamp is ignored', () => {
  const stuck = { plot: 'monument', at: NOW }
  assert.equal(S.nextHeld('monument', { stuck, now: NOW + 60_000 }), 'stuck_on_cell')
  assert.equal(S.nextHeld('wall', { stuck, now: NOW + 60_000 }), null)
  assert.equal(S.nextHeld('monument', { stuck, now: NOW + S.SHOP_STUCK_RETRY_MS }), null)
  assert.equal(S.nextHeld('shaft', { stuck: { plot: 'shaft', at: NOW }, now: NOW + S.SHAFT_STUCK_RETRY_MS }), null)
  assert.equal(S.nextHeld('monument', { stuck: { plot: 'monument', at: NOW + 3_600_000 }, now: NOW }), null)
})
test('nextBackoff + activeProject: a held open project yields to the next free one; all held -> a due upkeep with a slot; BUILDNEXT=0 the old open[0]', async () => {
  const list = S.PROJECTS.filter(p => ['shop', 'house1', 'monument', 'paths', 'wall'].includes(p.plot))
  const states = [st('shop', { complete: true }), st('house1', { complete: true }), st('monument'), st('paths', { complete: true, due: true }), st('wall')]
  const held = new Set(['monument'])
  assert.equal(S.activeProject(S.nextBackoff(states, p => (held.has(p) ? 'repeat' : null)), list).plot, 'wall')
  held.add('wall')
  assert.equal(S.activeProject(S.nextBackoff(states, p => (held.has(p) ? 'repeat' : null)), list).plot, 'paths', 'the due upkeep, not a held project')
  await withEnv({ BUILDNEXT: '0' }, () => assert.equal(S.activeProject(S.nextBackoff(states, p => (held.has(p) ? 'repeat' : null)), list).plot, 'monument', 'CONTROL: the old fallback'))
  const d = S.nextBackoff([st('monument', { complete: true, damaged: true })], () => 'repeat')
  assert.equal(d[0].damaged, true, 'a repair is never hidden by the breaker')
})

// ---- the order (pure, through the hook) ---------------------------------------------------------------------------------------------
test('buildOrder: the bot\'s stuck_on_cell no longer holds EVERY project -- only its own; BUILDNEXT=0 the old unscoped 6 h hold', async () => {
  const o = { on: true, shared: true, atTown: true, planned: true, now: NOW, state: { lastStop: 'stuck_on_cell', lastAt: NOW - S.SHOP_COOLDOWN_MS - 1 } }
  S.setNextHoldOf(plot => S.nextHeld(plot, { stuck: { plot: 'monument', at: NOW - 60_000 }, now: NOW }))
  try {
    assert.equal(S.buildOrder({ ...o, record: { plot: 'wall' } }).order?.skill, 'build_shop', 'the wall is ordered')
    assert.equal(S.buildOrder({ ...o, record: { plot: 'monument' } }).skip, 'stuck_on_cell', 'its own project still waits')
    await withEnv({ BUILDNEXT: '0' }, () => assert.equal(S.buildOrder({ ...o, record: { plot: 'wall' } }).skip, 'stuck_on_cell', 'CONTROL: the live hold, every project'))
  } finally { S.setNextHoldOf(() => null) }
})

// ---- the chain (skills.mjs shopActive + buildNextAfter on real files) ---------------------------------------------------------------
const dir = () => process.env.POOL_STATE_DIR
const HOME = { x: 0, y: 70, z: 0 }
const key = plot => PJ.projKey(HOME, plot)
const rec = (plot, blueprint, complete) => assert.equal(PJ.publishRecord(dir(), key(plot), () => ({ v: 1, blueprint, plot, cells: [{ at: [0, 0, 0], role: 'base', seg: 'a' }], segments: [{ seg: 'a', deps: [] }], structure_complete: complete, ...(complete ? { completeAt: 1 } : {}) })).result, 'accepted')
const fakeBot = () => ({ username: 'NextBot', blockAt: () => null, entity: { position: { x: 0, y: 70, z: 0 } }, inventory: { items: () => [] } })
const empty = n => ({ status: 'no_effect', stop: 'no_material', detail: `shrine for L04-W; built ${1960 + n}/2011@4` })
let ready = false
const setup = () => { if (ready) return; ready = true; rec('shop', 'workshop@1', true); rec('house1', 'house@1', true); rec('paths', 'paths@1', true); rec('monument', 'ziggurat@1', false); rec('wall', 'wall@1', false) }

test('CHAIN: three identical empty monument visits (the progress count moving with others\' work) send this bot to the wall; another bot still gets the monument', () => {
  setup()
  const b = fakeBot(), other = { ...fakeBot(), username: 'OtherBot' }, now = Date.now()
  assert.equal(SK.shopActive(b, now).plot, 'monument', 'control: the first open project')
  for (let i = 0; i < S.NEXT_K; i++) SK.buildNextAfter(b, 'monument', empty(i), now + i)
  assert.equal(SK.shopActive(b, now + 10).plot, 'wall', 'the breaker: the next eligible project in the same call')
  assert.equal(SK.shopActive(other, now + 10).plot, 'monument', 'per bot: the others are not held')
  SK.buildNextAfter(b, 'wall', { status: 'no_effect', stop: 'stuck_on_cell', detail: 'x' }, now + 20)
  assert.equal(SK.shopActive(b, now + 30).plot, 'monument', 'both held: activeProject falls back to the first')
  S.setNextHoldOf(plot => SK.buildNextHeldForTest(b, plot, now + 30))
  assert.equal(S.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: now + 30, record: { plot: 'monument' } }).skip, 'repeat', 'and the order holds: nothing else is workable')
})
test('CHAIN CONTROL: BUILDNEXT=0 -- the same visits change nothing', async () => {
  setup()
  await withEnv({ BUILDNEXT: '0' }, () => {
    const b = fakeBot(), now = Date.now()
    for (let i = 0; i < S.NEXT_K; i++) SK.buildNextAfter(b, 'monument', empty(i), now + i)
    assert.equal(SK.shopActive(b, now + 10).plot, 'monument')
  })
})
test('CHAIN MUTANT KILLED: without nextBackoff in shopActive the tripped breaker changes nothing (anchor asserted unique)', async () => {
  setup()
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const old = 'const waitedN = buildNextOn() && b ? nextBackoff(waitedU, plot => buildNextHeld(b, plot, now)) : waitedU'
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-buildnext-${process.pid}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, 'const waitedN = waitedU').replace(/from '\.\//g, "from '../src/"))
  try {
    const M = await import(out.href)
    const b = fakeBot(), now = Date.now()
    for (let i = 0; i < S.NEXT_K; i++) M.buildNextAfter(b, 'monument', empty(i), now + i)
    assert.equal(M.shopActive(b, now + 10).plot, 'monument', 'the mutant keeps the held project')
    const b2 = fakeBot()
    for (let i = 0; i < S.NEXT_K; i++) SK.buildNextAfter(b2, 'monument', empty(i), now + i)
    assert.equal(SK.shopActive(b2, now + 10).plot, 'wall', 'the real module')
  } finally { fs.unlinkSync(out) }
})
test('buildNextAfter: a visit that placed or cleared is work (no count); a stuck_on_cell stop is scoped to its plot and cleared by work there', () => {
  const b = fakeBot(), now = Date.now()
  for (let i = 0; i < S.NEXT_K + 2; i++) SK.buildNextAfter(b, 'wall', { status: 'success', stop: 'deadline', detail: 'deadline', placed: 3 }, now + i)
  assert.equal(SK.buildNextHeldForTest(b, 'wall', now + 10), null)
  SK.buildNextAfter(b, 'wall', { status: 'no_effect', stop: 'stuck_on_cell', detail: 'x' }, now)
  assert.equal(SK.buildNextHeldForTest(b, 'wall', now + 1), 'stuck_on_cell')
  SK.buildNextAfter(b, 'wall', { status: 'success', stop: 'complete', detail: 'x', placed: 1 }, now + 2)
  assert.equal(SK.buildNextHeldForTest(b, 'wall', now + 3), null)
})
/** A mutant of shop.mjs (anchor asserted present and unique), imported fresh from the src directory. */
async function withShopMutant (old, neu, fn) {
  const src = fs.readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8')
  assert.equal(src.split(old).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${old.slice(0, 60)}`)
  const f = new URL(`../src/.mut-buildnext-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(f, src.replace(old, neu))
  try { return await fn(await import(f.href)) } finally { fs.unlinkSync(f) }
}
test('MUTANTS KILLED (shop.mjs): the order\'s scoped hold dropped; the due-upkeep fallback dropped', async () => {
  await withShopMutant('    if (hold) return { order: null, skip: hold }\n', '\n', async M => {
    M.setNextHoldOf(plot => M.nextHeld(plot, { stuck: { plot: 'monument', at: NOW - 60_000 }, now: NOW }))
    const r = M.buildOrder({ on: true, shared: true, atTown: true, planned: true, now: NOW, record: { plot: 'monument' } })
    assert.notEqual(r.skip, 'stuck_on_cell', 'the mutant orders the held project')
  })
  await withShopMutant('    return starved[0] ?? open.find(p => st(p).free !== false) ?? dueP ?? open[0]', '    return starved[0] ?? open.find(p => st(p).free !== false) ?? open[0]', async M => {
    const list = M.PROJECTS.filter(p => ['shop', 'monument', 'paths'].includes(p.plot))
    const states = [st('shop', { complete: true }), st('monument', { free: false }), st('paths', { complete: true, due: true })]
    assert.equal(M.activeProject(states, list).plot, 'monument', 'the mutant returns the held project')
    assert.equal(S.activeProject(states, list).plot, 'paths', 'the real module')
  })
})
