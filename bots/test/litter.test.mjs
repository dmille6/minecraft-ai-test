// LITTER-01 (bots/src/litter.mjs; takeback.mjs `onLeft`; roughground.mjs surveyRough `litter`; buildproj.mjs litterWrite / litterRead).
// Owner 11-12: walking must not leave placed blocks behind. takeback-01 is live; on the showcase 36% of its receipts (297 of 828 in
// 6 h, town and margin) closed `left why=expired` with the block still standing, and the cleanup's shape survey never finds a dirt
// step that reads as terrain. A `left` receipt is now handed to the cleanup crew with its cell, and the keeper's survey cuts exactly
// that cell. The pure rules; the sink and its file; the survey's intake on buildfake's flat world (stone below G, grass at G) with the
// survey without the hand-off as the positive control; one chain from the real take-back's expiry to the real visit's dig; mutants.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

// the bot's config reads its environment at import (features.mjs, below): set before anything is imported
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-litter-logs-'))
process.env.BOT_NAME = 'LitBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-litter-pool-'))
delete process.env.LITTER; delete process.env.TAKEBACK; delete process.env.PLACEAUDIT

const { G, HOME, server, bot: fakeBuilder, PJ, R } = await import('./helpers/buildfake.mjs')
const { Vec3 } = await import('vec3')
const LT = await import('../src/litter.mjs')
const TB = await import('../src/takeback.mjs')
const T = await import('../src/tidy.mjs')
const LP = await import('../src/landplan.mjs')
const RG = await import('../src/roughground.mjs')
const TR = await import('../src/tidyrefresh.mjs')
const { cellDone } = await import('../src/buildrun.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
const P = n => new URL(`../src/${n}`, import.meta.url)
/** A mutant of a source file, its anchor present and unique (CLAUDE.md), imported from the test directory. */
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const tmp = tag => fs.mkdtempSync(path.join(os.tmpdir(), `litter-${tag}-`))
const xyz = (...a) => a.join(',')
const REC = (cell, o = {}) => ({ cell, block: 'dirt', reason: 'pathfinder', shape: 'step', zone: 'town', profile: 'walk', ...o })
const E = (at, o = {}) => ({ at, block: 'dirt', t: 5_000, shape: 'step', by: 'A', ...o })
const IO = { read: PJ.litterReadOwn, write: PJ.litterWrite }
const litterFiles = dir => fs.readdirSync(dir).filter(n => /^litter-/.test(n))

console.log('THE PURE RULES')
await t('handable: a receipt left expired or unseen, in the town or its margin, with a real cell and block; nothing else', () => {
  assert.strictEqual(LT.handable(REC([1, 64, 1]), 'expired'), true)
  assert.strictEqual(LT.handable(REC([1, 64, 1], { zone: 'margin' }), 'unseen'), true)
  assert.strictEqual(LT.handable(REC([1, 64, 1], { zone: null }), 'expired'), false, 'outside the town and its margin: out of scope')
  for (const why of ['overflow', 'slow', 'no_tool', 'ripe', 'reuse', undefined]) assert.strictEqual(LT.handable(REC([1, 64, 1]), why), false, `why=${why}`)
  assert.strictEqual(LT.handable(REC([1, 64.5, 1]), 'expired'), false)
  assert.strictEqual(LT.handable(REC([1, 64, 1], { block: '?' }), 'expired'), false)
  assert.strictEqual(LT.handable(null, 'expired'), false)
  assert.deepStrictEqual(LT.litterEntry(REC([1, 64, 1], { shape: 'pillar' }), 777), { at: [1, 64, 1], block: 'dirt', t: 777, shape: 'pillar' })
})
await t('mutant: without the zone test a block placed out of town is handed', async () => {
  await withMutant(P('litter.mjs'), ' && T.zones.includes(String(r.zone))', '', async M => {
    assert.strictEqual(M.handable(REC([900, 64, 900], { zone: null }), 'expired'), true)
  })
})
await t('litterKeep: bounded (the OLDEST dropped), aged out after keepMs, a cell handed twice keeps its newest, malformed entries go', async () => {
  const TT = { ...LT.LITTER, maxEntries: 3, keepMs: 1000 }
  const es = [1, 2, 3, 4, 5].map(i => E([i, 64, 0], { t: 100 + i }))
  assert.deepStrictEqual(LT.litterKeep(es, 200, TT).map(e => e.at[0]), [3, 4, 5], 'the three newest, oldest first')
  assert.deepStrictEqual(LT.litterKeep(es, 1104, TT).map(e => e.at[0]), [4, 5], 'older than keepMs: gone')
  const twice = LT.litterKeep([E([1, 64, 0], { t: 10, block: 'dirt' }), E([2, 64, 0], { t: 20 }), E([1, 64, 0], { t: 30, block: 'cobblestone' })], 50, TT)
  assert.deepStrictEqual(twice.map(e => [e.at[0], e.block, e.t]), [[2, 'dirt', 20], [1, 'cobblestone', 30]])
  assert.deepStrictEqual(LT.litterKeep([null, { at: [1, 2] }, { at: [1, 2, 3], block: '', t: 1 }, { at: [1, 2, 3], block: 'dirt' }, E([7, 64, 7], { t: 40 })], 50, TT).map(e => e.at[0]), [7])
  assert.strictEqual(LT.litterKeep(Array.from({ length: 400 }, (_, i) => E([i, 64, 0], { t: i })), 500).length, LT.LITTER.maxEntries, 'the real bound')
  // the mutant: no bound
  await withMutant(P('litter.mjs'), 'return [...byCell.values()].slice(-T.maxEntries)', 'return [...byCell.values()]', async M => {
    assert.strictEqual(M.litterKeep(es, 200, TT).length, 5)
  })
})
await t('litterVerdict: take only the handed block, bare on top, over the ground round it, in reach, dry; each refusal named', () => {
  const e = E([5, 70, 5])
  const ok = { name: 'dirt', above: 'air', record: false, spoil: true, ring: [69, 69, 70, 69], reach: 6, wet: false }
  assert.deepStrictEqual(LT.litterVerdict(e, ok), { v: 'take', why: 'same' })
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, name: 'air' }), { v: 'dropped', why: 'gone' })
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, name: 'cobblestone' }), { v: 'dropped', why: 'changed' })
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, record: true }), { v: 'dropped', why: 'record' })
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, spoil: false }), { v: 'dropped', why: 'not_spoil' })
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, above: 'spruce_planks' }), { v: 'dropped', why: 'built_on' })
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, above: 'oak_leaves' }), { v: 'dropped', why: 'built_on' }, 'takeback\'s reading: anything but air')
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, above: 'dirt', aboveTaken: true }), { v: 'take', why: 'same' }, 'under a handed block taken with it')
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, ring: [70, 70, 71] }), { v: 'dropped', why: 'in_ground' }, 'at or under the lowest ground round it')
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, ring: [60, 61] }), { v: 'dropped', why: 'high' })
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, wet: true }), { v: 'dropped', why: 'water' })
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, name: null }), { v: 'held', why: 'unread' })
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, above: null }), { v: 'held', why: 'unread' })
  assert.deepStrictEqual(LT.litterVerdict(e, { ...ok, ring: [] }), { v: 'held', why: 'unread' })
})
await t('greened: handed dirt that reads grass_block is the same block (the one change named); mutant: it is dropped as changed', async () => {
  const e = E([5, 70, 5]), ok = { name: 'grass_block', above: 'air', ring: [69], reach: 6 }
  assert.deepStrictEqual(LT.litterVerdict(e, ok), { v: 'take', why: 'greened' })
  assert.deepStrictEqual(LT.litterVerdict(E([5, 70, 5], { block: 'cobblestone' }), ok), { v: 'dropped', why: 'changed' }, 'only dirt greens')
  assert.deepStrictEqual(LT.litterVerdict(E([5, 70, 5], { block: 'grass_block' }), { ...ok, name: 'dirt' }), { v: 'dropped', why: 'changed' }, 'one way')
  assert.strictEqual(LT.sameBlock('toString', 'x'), null, 'no inherited key')
  await withMutant(P('litter.mjs'), "greens: Object.freeze({ dirt: 'grass_block' }),", 'greens: Object.freeze({}),', async M => {
    assert.deepStrictEqual(M.litterVerdict(e, ok), { v: 'dropped', why: 'changed' })
  })
})
await t('mutant: without the built-on reading a block someone built on is taken', async () => {
  await withMutant(P('litter.mjs'), "  if (!AIRY(above) && !aboveTaken) return { v: 'dropped', why: 'built_on' }\n", '', async M => {
    assert.deepStrictEqual(M.litterVerdict(E([5, 70, 5]), { name: 'dirt', above: 'spruce_planks', ring: [69], reach: 6 }), { v: 'take', why: 'same' })
  })
})
await t('litterTally + the rows: folded by its cell whichever rule cut it, known, held, dropped once (since the last survey); rows fit the log', () => {
  const lit = { read: 9, seen: [
    { k: '1,70,1', t: 900, v: 'take', why: 'same' }, { k: '2,70,2', t: 900, v: 'held', why: 'planned' }, { k: '3,70,3', t: 900, v: 'take', why: 'greened' },
    { k: '4,70,4', t: 900, v: 'take', why: 'same' }, { k: '5,70,5', t: 900, v: 'dropped', why: 'gone' }, { k: '6,70,6', t: 100, v: 'dropped', why: 'gone' },
    { k: '7,70,7', t: 900, v: 'dropped', why: 'built_on' }, { k: '8,70,8', t: 900, v: 'held', why: 'unread' }] }
  const ty = LT.litterTally(lit, { added: new Set(['1,70,1', '2,70,2', '3,70,3']), known: new Set(['7,70,7']), since: 500 })
  assert.deepStrictEqual(ty, { read: 9, seen: 8, folded: ['1,70,1', '2,70,2', '3,70,3'], greened: 1, known: 1, held: { merge: 1, unread: 1 }, dropped: { gone: 1 }, old: 1 })
  const rows = LT.intakeRows(ty, { where: 'refresh', gen: 12 })
  assert.deepStrictEqual(rows.map(r => r.status), ['success', 'no_effect'])
  assert.strictEqual(rows[0].detail, 'op=folded n=3 why=refresh read=9 seen=8 known=1 greened=1 old=1 held=merge:1,unread:1 cells=1,70,1;2,70,2;3,70,3 gen=12')
  assert.strictEqual(rows[1].detail, 'op=dropped n=1 why=gone:1')
  // nothing read: no row; read but nothing folded: the folded row still says the denominator
  assert.deepStrictEqual(LT.intakeRows(LT.litterTally({ read: 0, seen: [] })), [])
  const none = LT.intakeRows(LT.litterTally({ read: 4, seen: [] }), { where: 'sited' })
  assert.strictEqual(none.length, 1); assert.strictEqual(none[0].status, 'no_effect'); assert.match(none[0].detail, /^op=folded n=0 why=sited read=4 seen=0 /)
  // the worst case stays inside the logger's 300 characters
  const big = LT.litterTally({ read: 3584, seen: Array.from({ length: 3000 }, (_, i) => ({ k: `-${1000 + i},-64,-${1000 + i}`, t: 900, v: i % 2 ? 'take' : 'dropped', why: ['gone', 'changed', 'built_on', 'in_ground', 'record', 'record_col', 'no_litter', 'guarded', 'reserved', 'high', 'water', 'not_spoil', 'plan'][i % 13] })) }, { added: new Set(Array.from({ length: 3000 }, (_, i) => `-${1000 + i},-64,-${1000 + i}`).filter((_, i) => i % 4 === 1)), since: 0 })
  for (const r of LT.intakeRows(big, { where: 'country:rim128', gen: 123456 })) assert.ok(r.detail.length <= 300, `${r.detail.length}: ${r.detail}`)
  assert.strictEqual(LT.handedDetail({ n: 3, by: { expired: 2, unseen: 1 }, open: 17, written: 4, failed: 0 }), 'op=handed n=3 why=expired:2,unseen:1 open=17 written=4 failed=0')
})

console.log('THE HAND-OFF FILE (litterSink over buildproj.mjs)')
await t('a handed receipt is written to the bot\'s own file, whole and bounded; every bot\'s file is read with its owner; one `handed` row', async () => {
  const dir = tmp('sink'), rows = []
  let clock = 10_000
  const TT = { ...LT.LITTER, maxEntries: 3 }
  const sink = LT.litterSink({ dir, holder: 'Gale', io: IO, emit: (k, s, d) => rows.push([k, s, d]), now: () => clock, env: {}, T: TT, timers: false, shared: new Map() })
  assert.ok(sink)
  assert.match(rows[0][2], /^phase=mode v=1 on=1 max=3 /); assert.strictEqual(rows[0][0], 'litter_mode')
  assert.strictEqual(sink.left(REC([1, 64, 1]), 'expired'), true)
  assert.strictEqual(sink.left(REC([2, 64, 1], { zone: 'margin', shape: 'pillar' }), 'unseen'), true)
  assert.strictEqual(sink.left(REC([3, 64, 1], { zone: null }), 'expired'), false, 'out of town: not handed')
  assert.strictEqual(sink.left(REC([3, 64, 1]), 'slow'), false, 'not a block the bot walked away from')
  assert.deepStrictEqual(litterFiles(dir), [], 'left() is memory only: the walk never waits on the disk')
  assert.strictEqual(await sink.flush(), true)
  assert.deepStrictEqual(litterFiles(dir), ['litter-Gale.json'], 'one file, no temp file left')
  assert.deepStrictEqual(PJ.litterRead(dir), [{ at: [1, 64, 1], block: 'dirt', t: 10_000, shape: 'step', by: 'Gale' }, { at: [2, 64, 1], block: 'dirt', t: 10_000, shape: 'pillar', by: 'Gale' }])
  // the bound: five more, the file keeps the three newest
  for (let i = 0; i < 5; i++) { clock += 10; sink.left(REC([10 + i, 64, 1]), 'expired') }
  await sink.flush()
  assert.deepStrictEqual(PJ.litterRead(dir).map(e => e.at[0]), [12, 13, 14])
  // a second bot's file beside it; the read takes both, and `since` cuts by age
  const s2 = LT.litterSink({ dir, holder: 'Onyx', io: IO, now: () => clock, env: {}, timers: false, shared: new Map() })
  s2.left(REC([40, 64, 40]), 'expired'); await s2.flush()
  assert.deepStrictEqual(PJ.litterRead(dir).map(e => `${e.by}:${e.at[0]}`).sort(), ['Gale:12', 'Gale:13', 'Gale:14', 'Onyx:40'])
  assert.deepStrictEqual(PJ.litterRead(dir, { since: clock }).map(e => e.by).sort(), ['Gale', 'Onyx'], 'only the newest of each')
  sink.row()
  const handed = rows.filter(r => r[0] === 'litter')
  assert.strictEqual(handed.length, 1)
  assert.strictEqual(handed[0][2], 'op=handed n=7 why=expired:6,unseen:1 open=3 written=2 failed=0')
  sink.row(); assert.strictEqual(rows.filter(r => r[0] === 'litter').length, 1, 'nothing new handed: no row')
})
await t('a restart keeps what was handed before it (the owner reads its own file once); a reconnect is the same writer', async () => {
  const dir = tmp('restart')
  const a = LT.litterSink({ dir, holder: 'Gale', io: IO, now: () => 1000, env: {}, timers: false, shared: new Map() })
  a.left(REC([1, 64, 1]), 'expired'); await a.flush()
  const shared = new Map()   // a new process
  const b = LT.litterSink({ dir, holder: 'Gale', io: IO, now: () => 2000, env: {}, timers: false, shared })
  b.left(REC([2, 64, 2]), 'expired'); await b.flush()
  assert.deepStrictEqual(PJ.litterRead(dir).map(e => e.at[0]), [1, 2])
  const c = LT.litterSink({ dir, holder: 'Gale', io: IO, now: () => 3000, env: {}, timers: false, shared })   // the same process, connected again
  assert.strictEqual(c.state, b.state, 'one state a file')
  c.left(REC([3, 64, 3]), 'expired'); await Promise.all([b.flush(), c.flush()])
  assert.deepStrictEqual(PJ.litterRead(dir).map(e => e.at[0]), [1, 2, 3])
})
await t('never throws into the walk: a disk that fails is counted and asked again; a hook that throws never breaks the take-back', async () => {
  let fails = 2
  const wrote = []
  const io = { read: async () => { throw new Error('EIO') }, write: async (d, h, es) => { if (fails-- > 0) throw new Error('ENOSPC'); wrote.push(es.length); return true } }
  const sink = LT.litterSink({ dir: '/nonexistent/x', holder: 'Gale', io, now: () => 1000, env: {}, timers: false, shared: new Map() })
  assert.strictEqual(sink.left(REC([1, 64, 1]), 'expired'), true)
  assert.strictEqual(await sink.flush(), false); assert.strictEqual(await sink.flush(), false)
  assert.strictEqual(sink.state.failed, 2); assert.strictEqual(sink.state.dirty, true, 'still owed')
  assert.strictEqual(await sink.flush(), true); assert.deepStrictEqual(wrote, [1])
  assert.strictEqual(await PJ.litterWrite('/dev/null/not-a-dir', 'Gale', [E([1, 64, 1])]), false, 'the real writer: false, never a throw')
  assert.deepStrictEqual(PJ.litterRead('/nonexistent/y'), [])
  // takeback's own row survives a hook that throws
  const f = walker({ onLeft: () => { throw new Error('boom') } })
  f.place([1, 64, 0]); f.clock.t += f.TT.ttlMs + 1; f.place([9, 64, 9])
  assert.deepStrictEqual(f.out(), ['left:expired'])
})
await t('LITTER=off: no sink, so nothing is written (the mode row says on=0)', async () => {
  const dir = tmp('off'), rows = []
  for (const v of ['off', '0', 'false', 'no', 'OFF']) assert.strictEqual(LT.litterOn({ LITTER: v }), false)
  assert.strictEqual(LT.litterOn({}), true); assert.strictEqual(LT.litterOn({ LITTER: 'on' }), true)
  const sink = LT.litterSink({ dir, holder: 'Gale', io: IO, emit: (k, s, d) => rows.push([k, d]), env: { LITTER: 'off' }, timers: false, shared: new Map() })
  assert.strictEqual(sink, null)
  assert.match(rows[0][1], /on=0/)
  assert.deepStrictEqual(litterFiles(dir), [])
})

// ---- the take-back on a fake bot (a flat floor at y 63), its clock the test's ----------------------------------------------------
function walker ({ onLeft = null, M = TB } = {}) {
  const b = new EventEmitter()
  const cells = new Map(), rows = []
  const clock = { t: 1_000_000 }
  const TT = Object.freeze({ ...TB.TAKEBACK, ttlMs: 5_000 })
  b.entity = { position: { x: 0.5, y: 64, z: 0.5 }, onGround: true, isInWater: false }
  b.entities = { 1: b.entity }
  b.health = 20; b.movementProfile = 'walk'
  b.blockAt = v => ({ name: cells.get(`${v.x},${v.y},${v.z}`) ?? (v.y <= 63 ? 'stone' : 'air'), position: { x: v.x, y: v.y, z: v.z } })
  b.canSeeBlock = () => true
  b.pathfinder = { movements: {}, isBuilding: () => false, isMining: () => false, goal: null, goto: async () => {} }
  const tb = M.installTakeback(b, { emit: (kind, status, detail) => rows.push({ kind, status, detail }), now: () => clock.t, env: {}, T: TT, timers: false, onLeft })
  const place = (cell, o = {}) => { cells.set(cell.join(','), o.block ?? 'dirt'); tb.note(REC(cell, o)) }
  const out = () => rows.filter(r => r.kind === 'takeback').map(r => /outcome=(\S+) why=(\S+)/.exec(r.detail).slice(1, 3).join(':'))
  return { bot: b, tb, place, out, clock, TT, cells }
}

// ---- the keeper's survey on buildfake's world ------------------------------------------------------------------------------------
const ON = { ROUGH: 'on' }
const INWALL = LP.landStages().find(q => q.id === 'inwall')
const WALL = { ring: [-30, -30, 30, 30] }
const stage = (srv, { busy = null, cells = new Set(), litter = [], climbs = [], records = [], avoid = () => null, stageMod = T, env = ON } = {}) =>
  stageMod.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: INWALL, env, cells, avoid, terrace: { wall: WALL, records, climbs, litter }, planned: busy })
const cutK = s => (s?.record?.cut ?? []).map(c => c.at.join(',')).sort()
const seenOf = s => Object.fromEntries((s.litter?.seen ?? []).map(q => [q.k, `${q.v}:${q.why}`]))
/** A natural rise (stone, 5 x 5, one high) with a dirt step against its west side: terrain to every shape rule. */
const STEP = [5, G + 1, 3]
function riseWorld () {
  const srv = server()
  for (let x = 6; x <= 10; x++) for (let z = 1; z <= 5; z++) srv.set([x, G + 1, z], 'stone')
  srv.set(STEP, 'dirt')
  return srv
}
const colOf = srv => (x, z) => T.tidyColumn(srv.read, x, z, { yHi: HOME.y + 14, yLo: HOME.y - 14 })
const rough = (srv, opts = {}, M = RG) => M.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col: colOf(srv), spoil: T.SPOIL, yLo: HOME.y - 14, ...opts })

console.log('THE INTAKE (tidy.mjs siteStage -> roughground.mjs surveyRough)')
await t('a handed step that reads as terrain is cut, exactly its cell; the control: neither the shape survey nor the climbs ledger finds it', async () => {
  const srv = riseWorld()
  const base = stage(srv, { climbs: [{ x: STEP[0], y: STEP[1], z: STEP[2], shape: 'step', t: 1 }] })
  assert.strictEqual(base.ok, true); assert.deepStrictEqual(cutK(base), [], 'today: the step stays (SCAFFOLD takes only what stands above the ground round it)')
  assert.deepStrictEqual(base.litter, { read: 0, seen: [] })
  const s = stage(srv, { litter: [E(STEP)] })
  assert.deepStrictEqual(s.record.cut, [{ at: STEP, kind: 'tidy', name: 'dirt' }], 'the tidy\'s own cut entry: the visit digs it as it digs a surveyed pillar')
  assert.deepStrictEqual(s.litter, { read: 1, seen: [{ k: xyz(...STEP), t: 5_000, v: 'take', why: 'same' }] })
  assert.strictEqual(s.record.inwall.rough.census.handed, 1)
  assert.ok(!('litter' in s.record) && !JSON.stringify(s.record).includes('"seen"'), 'the verdicts are the caller\'s rows, never on the record')
  assert.deepStrictEqual(T.tidyCuts(s.record, srv.read).map(c => c.at), [STEP], 'the visit\'s cut list')
  // the mutant: siteStage no longer passes the hand-off to the survey
  await withMutant(P('tidy.mjs'), "climbs: terrace?.climbs ?? [], litter: terrace?.litter ?? [], standOff:", "climbs: terrace?.climbs ?? [], standOff:", async M => {
    assert.deepStrictEqual(cutK(stage(srv, { litter: [E(STEP)], stageMod: M })), [])
  })
})
await t('no hand-off, no change: the stage with an empty list is the stage without one (LITTER=off reads the files as [])', () => {
  const srv = riseWorld()
  srv.set([-12, G + 4, -9], 'dirt'); srv.set([-9, G, 7], 'air')
  const a = stage(srv), b = stage(srv, { litter: [] })
  const strip = s => JSON.stringify({ ...s.record, sitedAt: 0 })
  assert.strictEqual(strip(a), strip(b))
  assert.ok(a.record.cut.length >= 1, 'control: the survey finds its own work')
})
await t('dropped, each named: gone, changed, built on, another record\'s cell or column, a zone, the yard, in the ground, in water; unread is held', async () => {
  const mk = (edit, opts = {}) => { const srv = riseWorld(); edit?.(srv); const s = stage(srv, { litter: [E(STEP)], ...opts }); return { cuts: cutK(s), seen: seenOf(s)[xyz(...STEP)] } }
  assert.deepStrictEqual(mk(), { cuts: [xyz(...STEP)], seen: 'take:same' }, 'control')
  assert.deepStrictEqual(mk(srv => srv.set(STEP, 'air')), { cuts: [], seen: 'dropped:gone' })
  assert.deepStrictEqual(mk(srv => srv.set(STEP, 'cobblestone')), { cuts: [], seen: 'dropped:changed' })
  assert.deepStrictEqual(mk(srv => srv.set([5, G + 2, 3], 'oak_fence')), { cuts: [], seen: 'dropped:built_on' })
  assert.deepStrictEqual(mk(null, { cells: new Set([xyz(...STEP)]) }), { cuts: [], seen: 'dropped:record_col' }, 'a record names the cell')
  assert.deepStrictEqual(mk(null, { cells: new Set([xyz(5, G, 3)]) }), { cuts: [], seen: 'dropped:record_col' }, 'a record names the block under it')
  assert.deepStrictEqual(mk(null, { avoid: (x, z) => (x === 5 && z === 3 ? 'zone:well' : null) }), { cuts: [], seen: 'dropped:guarded' }, 'a protected zone')
  assert.deepStrictEqual(mk(null, { avoid: (x, z) => (x === 5 && z === 3 ? 'plan_cell' : null) }), { cuts: [], seen: 'dropped:plan' })
  assert.deepStrictEqual(mk(null, { records: [{ plot: 'yard', cells: [{ at: [4, G, 4] }] }] }), { cuts: [], seen: 'dropped:no_litter' }, 'the stock yard\'s piles')
  assert.deepStrictEqual(mk(srv => srv.set([5, G + 1, 2], 'water')), { cuts: [], seen: 'dropped:water' })
  // a block another project's record lists to dig itself (its clear list): that project's, never the tidy's
  const other = [{ plot: 'cottage1', cells: [], clear: [{ at: STEP, name: 'dirt', kind: 'foreign' }] }]
  assert.deepStrictEqual(LT.litterClaimed([E(STEP), E([9, 64, 9])], other).map(e => !!e.claimed), [true, false])
  assert.deepStrictEqual(LT.litterClaimed([E(STEP)], [{ plot: 'x', cut: [{ at: STEP }] }]).map(e => !!e.claimed), [true])
  assert.deepStrictEqual(LT.litterClaimed([E(STEP)], []), [E(STEP)])
  { const s = stage(riseWorld(), { litter: LT.litterClaimed([E(STEP)], other) }); assert.deepStrictEqual([cutK(s), seenOf(s)[xyz(...STEP)]], [[], 'dropped:record']) }
  // a cell the keeper's reader cannot read (an unloaded chunk reads null): held, asked again at the next survey
  const un = stage(riseWorld(), { litter: [E([5, G + 41, 3])] })
  assert.deepStrictEqual([cutK(un), seenOf(un)[xyz(5, G + 41, 3)]], [[], 'held:unread'])
  // beside a build (its box, no record cell in the column) it is still taken: the survey's own rule for a ledgered scaffold
  assert.deepStrictEqual(mk(null, { avoid: (x, z) => (x === 5 && z === 3 ? 'project:shop' : null) }), { cuts: [xyz(...STEP)], seen: 'take:same' })
  // in the ground: a block that fills a one-wide hole is what the survey would lay there again
  const pit = server(); pit.set([3, G, 3], 'dirt')
  const sp = stage(pit, { litter: [E([3, G, 3])] })
  assert.deepStrictEqual([cutK(sp), seenOf(sp)[xyz(3, G, 3)]], [[], 'dropped:in_ground'])
  // outside the stage's box it is not this stage's (no verdict: another stage's survey reads it)
  const far = stage(riseWorld(), { litter: [E([55, G + 1, 55])] })
  assert.deepStrictEqual(far.litter, { read: 1, seen: [] })
})
await t('mutants (roughground.mjs): the survey\'s own column refusals and the record-column rule are what keep a zone and a build whole', async () => {
  const srv = riseWorld()
  const zone = { avoid: (x, z) => (x === 5 && z === 3 ? 'zone:well' : null), litter: [E(STEP)] }
  assert.deepStrictEqual(rough(srv, zone).cut, [])
  await withMutant(P('roughground.mjs'), "    if (why && why !== 'build') { for (const e of list) say(e, why === 'planned' ? 'held' : 'dropped', why); continue }\n", '', async M => {
    assert.deepStrictEqual(rough(srv, zone, M).cut.map(c => c.at), [STEP], 'mutant digs in a zone')
  })
  const col = { cells: new Set([xyz(5, G, 3)]), litter: [E(STEP)] }
  assert.deepStrictEqual(rough(srv, col).cut, [])
  await withMutant(P('roughground.mjs'), "    if (cellCols.has(k)) { for (const e of list) say(e, 'dropped', 'record_col'); continue }\n", '', async M => {
    assert.deepStrictEqual(rough(srv, col, M).cut.map(c => c.at), [STEP], 'mutant digs a record\'s column')
  })
  // another project's dig list (litterClaimed's mark) is read by the survey
  const claimed = { litter: [{ ...E(STEP), claimed: true }] }
  assert.deepStrictEqual(rough(srv, claimed).cut, [])
  await withMutant(P('roughground.mjs'), 'record: e.claimed === true || cells.has(', 'record: cells.has(', async M => {
    assert.deepStrictEqual(rough(srv, claimed, M).cut.map(c => c.at), [STEP], 'mutant digs a block another project listed')
  })
  // the built-on reading is live in the survey (not only in the pure rule): a mutant that reads the cell above as air takes it
  const srv2 = riseWorld(); srv2.set([5, G + 2, 3], 'oak_fence')
  assert.deepStrictEqual(rough(srv2, { litter: [E(STEP)] }).cut, [])
  await withMutant(P('roughground.mjs'), 'above: up ? nm(up) : null, aboveTaken:', "above: 'air', aboveTaken:", async M => {
    assert.deepStrictEqual(rough(srv2, { litter: [E(STEP)] }, M).cut.map(c => c.at), [STEP])
  })
})
await t('a handed pillar comes down whole, from its top; with its top built on nothing of it is taken; a greened block is cut by its name now', () => {
  // a pillar against a rise three high, level with it: no stray. The wide-area regrade would blend such a cliff, pillar and all (it
  // is its own rule, REGRADE=off its switch): off here, so the pillar's only way onto the record is the hand-off
  const NOREG = { ROUGH: 'on', REGRADE: 'off' }
  const tall = () => { const srv = riseWorld(); for (let x = 6; x <= 10; x++) for (let z = 1; z <= 5; z++) for (const y of [G + 2, G + 3]) srv.set([x, y, z], 'stone'); srv.set([5, G + 2, 3], 'dirt'); srv.set([5, G + 3, 3], 'dirt'); return srv }
  const three = [E(STEP), E([5, G + 2, 3]), E([5, G + 3, 3])]
  const srv = tall()
  assert.deepStrictEqual(cutK(stage(srv, { env: NOREG })), [], 'control: the survey alone leaves the pillar')
  assert.deepStrictEqual(cutK(stage(srv, { env: NOREG, climbs: three.map(e => ({ x: e.at[0], y: e.at[1], z: e.at[2], shape: 'pillar', t: 1 })) })), [], 'control: so does the climbs ledger')
  const s = stage(srv, { env: NOREG, litter: three })
  assert.deepStrictEqual(s.record.cut.map(c => c.at), [[5, G + 3, 3], [5, G + 2, 3], STEP], 'top first')
  srv.set([5, G + 4, 3], 'oak_fence')
  const s2 = stage(srv, { env: NOREG, litter: three })
  assert.deepStrictEqual(cutK(s2), []); assert.deepStrictEqual(Object.values(seenOf(s2)), ['dropped:built_on', 'dropped:built_on', 'dropped:built_on'])
  // only the foot was handed and something else stands on it: built on
  const s3 = stage(tall(), { env: NOREG, litter: [E(STEP)] })
  assert.deepStrictEqual([cutK(s3), seenOf(s3)[xyz(...STEP)]], [[], 'dropped:built_on'])
  const g = riseWorld(); g.set(STEP, 'grass_block')
  const sg = stage(g, { litter: [E(STEP)] })
  assert.deepStrictEqual(sg.record.cut, [{ at: STEP, kind: 'tidy', name: 'grass_block' }]); assert.strictEqual(seenOf(sg)[xyz(...STEP)], 'take:greened')
})
await t('composed with the shape rules: a pillar whose top the stray rule cuts keeps its foot for the next survey, which takes it', () => {
  const srv = riseWorld()
  srv.set([5, G + 2, 3], 'dirt'); srv.set([5, G + 3, 3], 'dirt')
  const three = [E(STEP), E([5, G + 2, 3]), E([5, G + 3, 3])]
  const s1 = stage(srv, { litter: three })
  assert.deepStrictEqual(s1.record.cut.map(c => c.at[1]), [G + 3, G + 2], 'the stray rule: what stands above every neighbour')
  assert.deepStrictEqual(Object.values(seenOf(s1)), ['held:planned', 'held:planned', 'held:planned'], 'the column is that rule\'s this time')
  // by their cells two of the three are folded all the same; the foot is held
  const ty = LT.litterTally(s1.litter, { added: new Set(cutK(s1)) })
  assert.deepStrictEqual([ty.folded.length, ty.held], [2, { planned: 1 }])
  for (const c of s1.record.cut) srv.set(c.at, 'air')   // the visit digs them
  const s2 = stage(srv, { litter: three })
  assert.deepStrictEqual(s2.record.cut.map(c => c.at), [STEP], 'the foot, by the hand-off')
  assert.deepStrictEqual(seenOf(s2), { [xyz(...STEP)]: 'take:same', [xyz(5, G + 2, 3)]: 'dropped:gone', [xyz(5, G + 3, 3)]: 'dropped:gone' })
})
await t('the refresh of an open record: a busy column is held, a cell another project took since is held by the merge, a folded entry reads known next time', () => {
  const srv = riseWorld()
  srv.set([-12, G + 4, -9], 'dirt')                    // the record's own open work (a floating block)
  const r0 = T.coreFills(stage(srv).record)
  assert.deepStrictEqual(r0.cut.map(c => c.at.join(',')), [xyz(-12, G + 4, -9)])
  const done = q => cellDone(srv.read(...q.at), T.TIDY_PALETTE, q.role)
  const refresh = (cur, litter, { guard = new Set(), now = 9_000 } = {}) => {
    const busy = TR.openColumns(cur, srv.read, { done })
    const s = stage(srv, { busy, litter })
    const m = TR.refreshMerge(cur, s.record ? T.coreFills(s.record) : null, { busy, guard, now })
    const added = (m.rec?.cut ?? []).filter(c => c.added === now)
    const known = [...(cur.cells ?? []), ...(cur.cut ?? []), ...(cur.clear ?? [])].map(q => q.at.join(','))
    return { m, ty: LT.litterTally(s.litter, { added: new Set(added.map(c => c.at.join(','))), known: new Set(known), since: 0 }) }
  }
  // a handed block in the column the record still works: held (planned), nothing added
  const busyOne = refresh(r0, [E([-12, G + 5, -9])])
  assert.strictEqual(busyOne.m.rec, null); assert.deepStrictEqual(busyOne.ty.held, { planned: 1 })
  // the step: folded
  const a = refresh(r0, [E(STEP)])
  assert.deepStrictEqual(a.ty.folded, [xyz(...STEP)])
  assert.deepStrictEqual(a.m.rec.cut.map(c => c.at.join(',')).sort(), [xyz(-12, G + 4, -9), xyz(...STEP)].sort(), 'added, nothing dropped from the record')
  // a project sited on the cell since the survey's inputs were read (the visit's guard): the merge keeps it out
  const g = refresh(r0, [E(STEP)], { guard: new Set([xyz(...STEP)]) })
  assert.strictEqual(g.m.rec, null); assert.deepStrictEqual([g.ty.folded, g.ty.held], [[], { merge: 1 }])
  // the next refresh reads the same entry again (the file is its owner's): known, never a second cut
  const b = refresh(a.m.rec, [E(STEP)], { now: 10_000 })
  assert.strictEqual(b.m.rec, null); assert.deepStrictEqual([b.ty.folded, b.ty.known], [[], 1])
})

console.log('THE CHAIN: the real take-back\'s expiry -> the file -> the survey -> the record -> the visit\'s dig')
const chain = async (M = TB) => {
  const dir = tmp('chain'), rows = []
  const srv = riseWorld()
  srv.set([-12, G + 4, -9], 'dirt')
  // the town's open tidy record, published as the keeper publishes it
  const key = PJ.projKey(HOME, 'tidy')
  const r0 = { ...T.coreFills(stage(srv).record), state: 'open' }
  PJ.publishRecord(dir, key, () => r0)
  // the walk: a step placed against the rise, the bot walks on out of reach; the receipt runs out at the next placement
  let clock = 1_000_000
  const sink = LT.litterSink({ dir, holder: 'Gale', io: IO, emit: (k, s, d) => rows.push([k, d]), now: () => clock, env: {}, timers: false, shared: new Map() })
  const f = walker({ onLeft: (r, why) => sink.left(r, why), M })
  f.clock.t = clock
  f.place(STEP)                                          // placeaudit's `onPlaced`
  assert.deepStrictEqual(f.out(), [], 'the receipt is open')
  f.clock.t = clock += f.TT.ttlMs + 1
  f.place([40, 64, 40], { zone: null })                  // a later placement, far away: the take-back prunes
  assert.deepStrictEqual(f.out(), ['left:expired'])
  await sink.flush()
  // the keeper's refresh: every bot's file, the inside surveyed again, merged into the head inside the publish
  const litter = PJ.litterRead(dir, { since: clock - LT.LITTER.keepMs })
  const done = q => cellDone(srv.read(...q.at), T.TIDY_PALETTE, q.role)
  const now = clock + 60_000
  let res = null, s = null
  const pub = PJ.publishRecord(dir, key, cur => {
    const busy = TR.openColumns(cur, srv.read, { done })
    s = stage(srv, { busy, litter })
    res = TR.refreshMerge(cur, s.record ? T.coreFills(s.record) : null, { busy, now })
    return TR.refreshStamp(res.rec ?? cur, { now, added: res.added, skipped: res.skipped })
  }, { by: 'Keeper' })
  const head = PJ.recordHead(dir, key).head
  const ty = LT.litterTally(s.litter, { added: new Set(head.rec.cut.filter(c => c.added === now).map(c => c.at.join(','))), since: r0.sitedAt })
  // the next cleanup visit: the visit's own cut list through the real runner
  const cuts = T.chainCuts(T.tidyCuts(head.rec, srv.read), [0, 0])
  const slot = PJ.takeSlot(dir, key, 'Keeper', 1)
  const e = fakeBuilder(srv, 'Keeper', { feet: [0, G + 1, 0] })
  const before = new Map(srv.cells)
  await R.runVisit({ dir, key, me: 'Keeper', home: HOME, stood: [], record: head.rec, tidy: cuts, recordGen: head.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 48, clearMax: 48, tidyKeepOrder: true }, e, { maxSteps: 400 })
  const dug = [...before.keys()].filter(k => before.get(k) !== 'air' && srv.read(...k.split(',').map(Number)).name === 'air').sort()
  return { dir, rows, litter, pub, head, ty, e, dug, srv }
}
await t('a step the walk left behind is in the bot\'s file, on the record\'s cut list after the refresh, and dug by the next visit: that block, by the tidy\'s own row', async () => {
  const c = await chain()
  assert.deepStrictEqual(c.litter, [{ at: STEP, block: 'dirt', t: c.litter[0].t, shape: 'step', by: 'Gale' }], 'the far, out-of-town placement was never handed')
  assert.strictEqual(c.pub.result, 'accepted')
  assert.ok(c.head.rec.cut.some(q => q.at.join(',') === xyz(...STEP) && q.kind === 'tidy' && q.name === 'dirt'), JSON.stringify(c.head.rec.cut))
  assert.deepStrictEqual(c.ty.folded, [xyz(...STEP)])
  assert.match(LT.intakeRows(c.ty, { where: 'refresh', gen: c.pub.gen })[0].detail, /^op=folded n=1 why=refresh read=1 seen=1 /)
  // the visit: the handed block and the record's own floating block, nothing else of the world
  assert.deepStrictEqual(c.dug, [xyz(-12, G + 4, -9), xyz(...STEP)].sort())
  const clears = c.e.logs.filter(([k, d]) => k === '_build' && d.op === 'clear')
  const mine = clears.find(([, d]) => d.cell.join(',') === xyz(...STEP))
  assert.deepStrictEqual({ op: mine[1].op, block: mine[1].block, kind: mine[1].kind }, { op: 'clear', block: 'dirt', kind: 'tidy' }, 'the shape a surveyed pillar logs')
  assert.deepStrictEqual([...new Set(c.e.logs.filter(([k]) => k === '_build').map(([, d]) => `${d.op}/${d.kind ?? '-'}`))], ['clear/tidy'], 'no new _build op or kind')
  assert.strictEqual(c.srv.read(6, G + 1, 3).name, 'stone', 'the rise beside it stands')
})
await t('mutant (takeback.mjs): without the hand-off nothing reaches the file, the record or the visit', async () => {
  await withMutant(P('takeback.mjs'), "    if (outcome === 'left' && onLeft) { try { onLeft(r, why) } catch { /* the hand-off never breaks a walk */ } }\n", '', async M => {
    const c = await chain(M)
    assert.deepStrictEqual(c.litter, []); assert.deepStrictEqual(litterFiles(c.dir), [])
    assert.ok(!c.head.rec.cut.some(q => q.at.join(',') === xyz(...STEP)))
    assert.deepStrictEqual(c.dug, [xyz(-12, G + 4, -9)], 'the step stays, as today')
  })
})

console.log('WIRED (features.mjs through installFeatures; skills.mjs structural, comments stripped)')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld } = await import('./fakeworld.mjs')
const RECS = []
tapRecords(r => RECS.push(r))
const kindOf = r => String(r.skill?.name ?? r.kind ?? '').replace(/^_/, '')
const detailOf = r => String(r.skill?.detail ?? r.detail ?? '')
const POOL = process.env.POOL_STATE_DIR
/** A spawned bot's walk through the REAL feature install: place a step (the pathfinder building), let its receipt run out, place again. */
async function spawnAndLeave (F, name) {
  const w = fakeWorld()
  w.bot.username = name; w.bot.movementProfile = 'walk'
  w.bot.pathfinder.isBuilding = () => true
  const n0 = RECS.length
  F.installFeatures(w.bot)
  const realNow = Date.now
  try {
    w.bot.heldItem = { name: 'dirt', count: 8 }
    await w.bot.placeBlock({ position: new Vec3(3, 63, 3) }, new Vec3(0, 1, 0))
    await sleep(5)
    Date.now = () => realNow() + TB.TAKEBACK.ttlMs + 60_000
    await w.bot.placeBlock({ position: new Vec3(9, 63, 9) }, new Vec3(0, 1, 0))
    await sleep(5)
  } finally { Date.now = realNow }
  await sleep(LT.LITTER.flushMs + 500)
  return RECS.slice(n0)
}
await t('installFeatures hands a spawned bot\'s expired receipt to its file in the town directory; LITTER=off writes nothing; mutant: unwired', async () => {
  const F = await import('../src/features.mjs')
  const rows = await spawnAndLeave(F, 'LitBot')
  assert.ok(rows.some(r => kindOf(r) === 'litter_mode' && /on=1/.test(detailOf(r))), `the mode row (${[...new Set(rows.map(kindOf))].join(',')})`)
  assert.ok(rows.some(r => kindOf(r) === 'takeback' && /outcome=left why=expired pos=3,64,3 /.test(detailOf(r))), 'control: the take-back left it')
  const mine = PJ.litterRead(POOL).filter(e => e.by === 'LitBot')
  assert.deepStrictEqual(mine.map(e => [e.at, e.block]), [[[3, 64, 3], 'dirt']], JSON.stringify([PJ.litterRead(POOL), [...new Set(rows.map(kindOf))], rows.filter(r => /takeback|litter|place/.test(kindOf(r))).map(detailOf)]))
  // the switch
  process.env.LITTER = 'off'
  try {
    const off = await spawnAndLeave(F, 'OffBot')
    assert.ok(off.some(r => kindOf(r) === 'litter_mode' && /on=0/.test(detailOf(r))))
    assert.ok(off.some(r => kindOf(r) === 'takeback' && /outcome=left why=expired/.test(detailOf(r))), 'control: the same walk, the same expiry')
    assert.deepStrictEqual(PJ.litterRead(POOL).filter(e => e.by === 'OffBot'), [])
    assert.ok(!fs.existsSync(path.join(POOL, 'litter-OffBot.json')))
  } finally { delete process.env.LITTER }
  // the mutant: the take-back installed without the sink
  await withMutant(P('features.mjs'), 'onLeft: lit ? (r, why) => lit.left(r, why) : null', 'onLeft: null', async M => {
    const mut = await spawnAndLeave(M, 'MutBot')
    assert.ok(mut.some(r => kindOf(r) === 'takeback' && /outcome=left why=expired/.test(detailOf(r))), 'control')
    assert.deepStrictEqual(PJ.litterRead(POOL).filter(e => e.by === 'MutBot'), [])
  })
})
await t('skills.mjs: every survey reads the hand-off (the stages and the refresh through stageSurveyInputs, the country band), behind the switch; the rows follow each publish', () => {
  const src = readFileSync(P('skills.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
  const wired = s => {
    assert.ok(/function litterForSurvey \(dir, records\) \{\s*if \(!LITTER_ON\) return \[\]\s*try \{ return litterClaimed\(litterRead\(dir, \{ since: Date\.now\(\) - LITTER\.keepMs \}\), records\) \} catch \{ return \[\] \}\s*\}/.test(s), 'the read, behind the switch, the other records\' claims marked')
    assert.ok(/const LITTER_ON = litterOn\(\)/.test(s), 'the switch')
    assert.ok(/const terrace = \{[^\n]*\}\s*terrace\.litter = litterForSurvey\(dir, I\.records\)\s*return \{ land, read, last, lights, terrace \}/.test(s), 'the stage survey\'s inputs')
    assert.ok(/const bandIn = \{[^\n]*\}\s*bandIn\.litter = litterForSurvey\(dir, I\.records\)/.test(s), 'the country band\'s inputs')
    assert.strictEqual(s.split('litterIntakeLog(bot, ').length, 4, 'a row after the refresh, the siting and the country\'s siting')
    assert.ok(/if \(!LITTER_ON \|\| !lit \|\| !\(lit\.read > 0\)\) return/.test(s), 'no row under the switch')
  }
  wired(src)
  const mut = (a, b) => { assert.strictEqual(src.split(a).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${a.slice(0, 50)}`); return src.replace(a, b) }
  assert.throws(() => wired(mut('  if (!LITTER_ON) return []\n', '')), 'the switch removed is caught')
  assert.throws(() => wired(mut('  terrace.litter = litterForSurvey(dir, I.records)\n', '')), 'the stage inputs unwired is caught')
  assert.throws(() => wired(mut('  bandIn.litter = litterForSurvey(dir, I.records)', '')), 'the band inputs unwired is caught')
  assert.throws(() => wired(mut('return litterClaimed(litterRead(dir, { since: Date.now() - LITTER.keepMs }), records)', 'return litterRead(dir, { since: Date.now() - LITTER.keepMs })')), 'the claims unmarked is caught')
  assert.throws(() => wired(mut("where: 'refresh', gen: pub.gen })", "where: 'refresh', gen: pub.gen }) && litterIntakeLog(bot, null)")), 'a changed count of rows is caught')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
