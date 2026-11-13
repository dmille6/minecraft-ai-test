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
const TS = await import('../src/tempstand.mjs')

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
// the survey's clock in every intake test, and an entry handed five seconds before it (fresh: LITTER.keepMs is three hours)
const NOW = 50_000_000, ET = NOW - 5_000, HOUR = 60 * 60_000
const E = (at, o = {}) => ({ at, block: 'dirt', t: ET, shape: 'step', by: 'A', ...o })
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
  assert.strictEqual(LT.LITTER.keepMs, 3 * HOUR, 'an entry is believed three hours')
  assert.deepStrictEqual(LT.litterKeep([E([1, 64, 0], { t: NOW - 3 * HOUR - 1 }), E([2, 64, 0], { t: NOW - 3 * HOUR })], NOW).map(e => e.at[0]), [2], 'the owner\'s file: past three hours it goes')
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
  assert.match(rows[0][2], /^phase=mode v=1 on=1 max=3 keep_h=3 /); assert.strictEqual(rows[0][0], 'litter_mode')
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
const stage = (srv, { busy = null, cells = new Set(), litter = [], climbs = [], records = [], avoid = () => null, stageMod = T, env = ON, now = NOW } = {}) =>
  stageMod.siteStage(srv.read, { home: HOME, land: { seed: 1 }, stage: INWALL, env, now, cells, avoid, terrace: { wall: WALL, records, climbs, litter }, planned: busy })
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
const rough = (srv, opts = {}, M = RG) => M.surveyRough(srv.read, { home: HOME, box: [-20, -20, 20, 20], col: colOf(srv), spoil: T.SPOIL, yLo: HOME.y - 14, now: NOW, ...opts })

console.log('THE INTAKE (tidy.mjs siteStage -> roughground.mjs surveyRough)')
await t('a handed step that reads as terrain is cut, exactly its cell; the control: neither the shape survey nor the climbs ledger finds it', async () => {
  const srv = riseWorld()
  const base = stage(srv, { climbs: [{ x: STEP[0], y: STEP[1], z: STEP[2], shape: 'step', t: 1 }] })
  assert.strictEqual(base.ok, true); assert.deepStrictEqual(cutK(base), [], 'today: the step stays (SCAFFOLD takes only what stands above the ground round it)')
  assert.deepStrictEqual(base.litter, { read: 0, seen: [] })
  const s = stage(srv, { litter: [E(STEP)] })
  assert.deepStrictEqual(s.record.cut, [{ at: STEP, kind: 'tidy', name: 'dirt', handed: NOW }], 'the tidy\'s own cut entry (kind tidy: the visit digs it as it digs a surveyed pillar), marked as the hand-off\'s with the time it was folded')
  assert.deepStrictEqual(s.litter, { read: 1, seen: [{ k: xyz(...STEP), t: ET, v: 'take', why: 'same' }] })
  assert.strictEqual(s.record.inwall.rough.census.handed, 1)
  assert.ok(!('litter' in s.record) && !JSON.stringify(s.record).includes('"seen"'), 'the verdicts are the caller\'s rows, never on the record')
  assert.deepStrictEqual(T.tidyCuts(s.record, srv.read, null, NOW + HOUR).map(c => c.at), [STEP], 'the visit\'s cut list')
  // the mutant: siteStage no longer passes the hand-off to the survey
  await withMutant(P('tidy.mjs'), "climbs: terrace?.climbs ?? [], litter: terrace?.litter ?? [], now, standOff:", "climbs: terrace?.climbs ?? [], now, standOff:", async M => {
    assert.deepStrictEqual(cutK(stage(srv, { litter: [E(STEP)], stageMod: M })), [])
  })
})
await t('no hand-off, no change: the stage with an empty list is the stage without one (LITTER=off reads the files as [])', () => {
  const srv = riseWorld()
  srv.set([-12, G + 4, -9], 'dirt'); srv.set([-9, G, 7], 'air')
  const a = stage(srv), b = stage(srv, { litter: [] })
  const strip = s => JSON.stringify(s.record)
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
  assert.deepStrictEqual(sg.record.cut, [{ at: STEP, kind: 'tidy', name: 'grass_block', handed: NOW }]); assert.strictEqual(seenOf(sg)[xyz(...STEP)], 'take:greened')
})
await t('r1 STALE: an entry past LITTER.keepMs is never folded, whatever the cell reads (ground put back where the handed dirt stood reads grass_block); mutants: the long life back, the survey without its clock', async () => {
  // the handed dirt is long gone; the cell holds ground again, grass like the lawn round it -- by its name, the greened hand-off
  const srv = riseWorld(); srv.set(STEP, 'grass_block')
  const old = [E(STEP, { t: NOW - 3 * HOUR - 1 })]
  const fresh = stage(srv, { litter: [E(STEP, { t: NOW - 2 * HOUR })] })
  assert.deepStrictEqual([cutK(fresh), seenOf(fresh)[xyz(...STEP)]], [[xyz(...STEP)], 'take:greened'], 'control: two hours old, it is believed (the hourly survey has had its two turns)')
  const s = stage(srv, { litter: old })
  assert.deepStrictEqual([cutK(s), seenOf(s)[xyz(...STEP)]], [[], 'dropped:old'], 'STALE: not folded')
  assert.deepStrictEqual(LT.litterTally(s.litter, { since: 0 }).dropped, { old: 1 }, 'and named in the dropped row')
  const cell = { name: 'grass_block', above: 'air', ring: [G], reach: 6, now: NOW }
  assert.deepStrictEqual(LT.litterVerdict(old[0], cell), { v: 'dropped', why: 'old' })
  assert.deepStrictEqual(LT.litterVerdict(old[0], { ...cell, name: null }), { v: 'dropped', why: 'old' }, 'before anything is read')
  assert.deepStrictEqual(LT.litterVerdict(E(STEP, { t: NOW + 30_000 }), cell), { v: 'take', why: 'greened' }, 'a clock a little ahead is not old')
  // the mutant: the seven days back -- the replacement ground is taken as the hand-off, and the owner's file keeps the entry
  await withMutant(P('litter.mjs'), '  keepMs: 3 * 60 * 60_000,', '  keepMs: 7 * 24 * 60 * 60_000,', async M => {
    assert.deepStrictEqual(M.litterVerdict(old[0], cell), { v: 'take', why: 'greened' }, 'mutant: STALE folded')
    assert.strictEqual(M.litterKeep(old, NOW).length, 1, 'mutant: kept in the file')
  })
  assert.strictEqual(LT.litterKeep(old, NOW).length, 0)
  // the mutant: the survey no longer hands its clock to the verdict
  await withMutant(P('roughground.mjs'), 'wet: sideLiquid(x, y, z) || liquid(read(x, y - 1, z)), now })', 'wet: sideLiquid(x, y, z) || liquid(read(x, y - 1, z)) })', async M => {
    assert.deepStrictEqual(rough(srv, { litter: old }, M).cut.map(c => c.at), [STEP], 'mutant: STALE folded by the survey')
  })
  assert.deepStrictEqual(rough(srv, { litter: old }).cut, [])
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
const chain = async (M = TB, { LM = LT, TM = T, after = null, tidyOk = true, visitAfter = 60_000 } = {}) => {
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
    s = stage(srv, { busy, litter, now })
    res = TR.refreshMerge(cur, s.record ? T.coreFills(s.record) : null, { busy, now })
    return TR.refreshStamp(res.rec ?? cur, { now, added: res.added, skipped: res.skipped })
  }, { by: 'Keeper' })
  const head = PJ.recordHead(dir, key).head
  const ty = LT.litterTally(s.litter, { added: new Set(head.rec.cut.filter(c => c.added === now).map(c => c.at.join(','))), since: r0.sitedAt })
  // the next cleanup visit: the visit's own cut list through the real runner
  // (r2) the visit's clock: `visitAfter` ms after the fold -- the visit's list and its dig-time check read the cut's age from it
  const visitAt = now + visitAfter
  if (after) after(srv)                                  // the world moves between the publish and the visit
  const cuts = TM.chainCuts(TM.tidyCuts(head.rec, srv.read, null, visitAt), [0, 0])
  const slot = PJ.takeSlot(dir, key, 'Keeper', 1)
  const e = fakeBuilder(srv, 'Keeper', { feet: [0, G + 1, 0] })
  const before = new Map(srv.cells)
  // skills.mjs's `tidyOk` asks litter.mjs handedBare last (the wiring test below reads that line); runVisit asks it before the walk
  // and again immediately before the dig
  const r = await R.runVisit({ dir, key, me: 'Keeper', home: HOME, stood: [], record: head.rec, tidy: cuts, recordGen: head.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 48, clearMax: 48, tidyKeepOrder: true, ...(tidyOk ? { tidyOk: (q, rd) => LM.handedBare(q, rd, visitAt) } : {}) }, e, { maxSteps: 400 })
  const dug = [...before.keys()].filter(k => before.get(k) !== 'air' && srv.read(...k.split(',').map(Number)).name === 'air').sort()
  return { dir, rows, litter, pub, head, ty, e, dug, srv, r, cuts, foldAt: now, visitAt }
}
await t('a step the walk left behind is in the bot\'s file, on the record\'s cut list after the refresh, and dug by the next visit: that block, by the tidy\'s own row', async () => {
  const c = await chain()
  assert.deepStrictEqual(c.litter, [{ at: STEP, block: 'dirt', t: c.litter[0].t, shape: 'step', by: 'Gale' }], 'the far, out-of-town placement was never handed')
  assert.strictEqual(c.pub.result, 'accepted')
  assert.ok(c.head.rec.cut.some(q => q.at.join(',') === xyz(...STEP) && q.kind === 'tidy' && q.name === 'dirt' && q.handed === c.foldAt), JSON.stringify(c.head.rec.cut))
  assert.ok(c.head.rec.cut.some(q => !q.handed), 'control: the record\'s own cut is not marked')
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

console.log('REVIEW r1: built on since the survey (at the dig); an unreadable record (at the intake)')
const fenceOn = srv => srv.set([STEP[0], STEP[1] + 1, STEP[2]], 'oak_fence')
await t('r1 BUILT-ON-AT-DIG: a fence set on the handed block after the publish -> the real visit leaves the dirt standing, digs the rest, and the cut is named', async () => {
  const c = await chain(TB, { after: fenceOn })
  assert.ok(c.head.rec.cut.some(q => q.at.join(',') === xyz(...STEP) && q.handed === c.foldAt), 'control: the cut is on the record (the survey saw it bare)')
  assert.ok(c.cuts.some(q => q.at.join(',') === xyz(...STEP)), 'control: and on the visit\'s list (a minute old)')
  assert.strictEqual(c.srv.read(...STEP).name, 'dirt', 'BUILT-ON-AT-DIG: the dirt under the fence stands')
  assert.strictEqual(c.srv.read(STEP[0], STEP[1] + 1, STEP[2]).name, 'oak_fence')
  assert.deepStrictEqual(c.dug, [xyz(-12, G + 4, -9)], 'control: the same visit digs the record\'s other cut')
  assert.ok((c.r.tidyWet ?? []).includes(xyz(...STEP)), 'it waited, as a cut beside water waits')
  assert.ok((c.r.tidied ?? []).includes(xyz(...STEP)), 'and is a try: the crew gives it up after TIDY_CUT_TRIES')
  const bo = LT.builtOnHeld(c.head.rec, c.r.tidyWet, c.srv.read, c.visitAt)
  assert.deepStrictEqual(bo, [xyz(...STEP)])
  assert.strictEqual(LT.builtOnDetail(bo), `op=dropped n=1 why=built_on_at_dig cells=${xyz(...STEP)}`)
  // the same visit with nothing on it digs it (the first chain test); a cut that is not the hand-off's is never asked this
  assert.strictEqual(LT.handedBare({ at: STEP, kind: 'tidy', name: 'dirt' }, c.srv.read, c.visitAt), true)
  assert.strictEqual(LT.handedBare({ at: STEP, kind: 'tidy', name: 'dirt', handed: c.foldAt }, c.srv.read, c.visitAt), false)
  assert.strictEqual(LT.handedBare({ at: [0, G + 1, 9], handed: c.foldAt }, c.srv.read, c.visitAt), true, 'control: a fresh handed cut with air on it')
  assert.strictEqual(LT.handedBare({ at: STEP, handed: c.foldAt }, () => null, c.visitAt), false, 'unread above: not dug')
  assert.deepStrictEqual(LT.builtOnHeld(c.head.rec, [xyz(-12, G + 4, -9)], c.srv.read, c.visitAt), [], 'a cut that waited for another reason is not named built on')
  assert.deepStrictEqual(LT.builtOnHeld(c.head.rec, c.r.tidyWet, c.srv.read, c.foldAt + LT.LITTER.keepMs + 1), [], 'nor one that only ran out of its life (r2)')
})
await t('r1 mutants: without the dig-time reading (litter.mjs handedBare), and without the cut\'s mark (tidy.mjs tidyRecord), the visit digs the dirt from under the fence', async () => {
  await withMutant(P('litter.mjs'), "  return !!up && AIRY(String(up.name ?? '').replace(/\\[.*\\]$/, ''))\n", '  return !!up\n', async M => {
    const c = await chain(TB, { after: fenceOn, LM: M })
    assert.strictEqual(c.srv.read(...STEP).name, 'air', 'mutant: dug from under the fence')
    assert.strictEqual(c.srv.read(STEP[0], STEP[1] + 1, STEP[2]).name, 'oak_fence')
  })
  // the mark is what the check reads: a record whose hand-off cuts are not marked is dug the old way
  await withMutant(P('tidy.mjs'), ', ...(c.handed ? { handed: c.handed } : {}) }))', ' }))', async M => {
    const srv = riseWorld()
    const rec = stage(srv, { litter: [E(STEP)], stageMod: M }).record
    assert.deepStrictEqual(rec.cut, [{ at: STEP, kind: 'tidy', name: 'dirt' }], 'mutant: no mark')
    fenceOn(srv)
    assert.strictEqual(LT.handedBare(rec.cut[0], srv.read, NOW + 1), true, 'mutant: so the dig is not held')
    assert.strictEqual(LT.handedBare(stage(riseWorld(), { litter: [E(STEP)] }).record.cut[0], srv.read, NOW + 1), false, 'control: the real record\'s cut is held under the fence')
  })
})
await t('r1: a handed pillar still comes down whole through the real visit (top first: the block under a handed block is bare when it is asked)', async () => {
  const srv = server()
  for (const d of [1, 2, 3]) srv.set([3, G + d, 0], 'dirt')
  const cuts = T.chainCuts([3, 2, 1].map(d => ({ at: [3, G + d, 0], kind: 'tidy', name: 'dirt', handed: NOW })), [0, 0])
  const rec = { v: 1, blueprint: T.TIDY_BLUEPRINT, plot: 'tidy', home: HOME, r: 32, cells: [], clear: [], cut: cuts, replant: [], segments: [] }
  const dir = tmp('pillar'), key = PJ.projKey(HOME, 'tidy')
  const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
  const slot = PJ.takeSlot(dir, key, 'A', 1)
  const e = fakeBuilder(srv, 'A', { feet: [0, G + 1, 0] })
  await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: cuts, recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 48, clearMax: 48, tidyKeepOrder: true, tidyOk: (q, rd) => LT.handedBare(q, rd, NOW + HOUR) }, e, { maxSteps: 400 })
  assert.deepStrictEqual([1, 2, 3].map(d => srv.read(3, G + d, 0).name), ['air', 'air', 'air'])
})
console.log('REVIEW r2: a folded cut expires too')
/** The reviewer's sequence: the handed dirt is removed and dirt terrain restored in the same cell, air above (by name, the same cut). */
const replaced = srv => { srv.set(STEP, 'air'); srv.set(STEP, 'dirt') }
const fillDone = srv => q => cellDone(srv.read(...q.at), T.TIDY_PALETTE, q.role)
await t('r2 handedOld: a cut is believed LITTER.keepMs from its fold; a mark that is not a time is old; a cut that is not the hand-off\'s never is', () => {
  const K3 = LT.LITTER.keepMs
  assert.strictEqual(LT.handedOld({ at: STEP, handed: NOW }, NOW + K3), false, 'the last believed instant')
  assert.strictEqual(LT.handedOld({ at: STEP, handed: NOW }, NOW + K3 + 1), true)
  assert.strictEqual(LT.handedOld({ at: STEP, handed: NOW }, NOW - 30_000), false, 'a clock a little behind the fold')
  for (const h of [1, true, 'yes', Infinity, -5]) assert.strictEqual(LT.handedOld({ at: STEP, handed: h }, NOW), true, `handed: ${h} is not a time: old`)
  assert.strictEqual(LT.handedOld({ at: STEP, handed: NOW }, undefined), true, 'no clock: old (fail closed)')
  for (const c of [{ at: STEP }, { at: STEP, handed: 0 }, null]) assert.strictEqual(LT.handedOld(c, NOW + 10 * K3), false, 'not a hand-off\'s cut')
})
await t('r2 EXPIRED: folded at t0, the block replaced by dirt, the keeper back at t0 + keepMs + 1 -- the real visit does NOT dig it, and nothing waits on it (the progress, the refresh\'s open columns, the give-up)', async () => {
  const c = await chain(TB, { after: replaced, visitAfter: LT.LITTER.keepMs + 1 })
  assert.ok(c.head.rec.cut.some(q => q.at.join(',') === xyz(...STEP) && q.handed === c.foldAt), 'control: the cut is on the record, by its name still "standing"')
  assert.strictEqual(c.srv.read(...STEP).name, 'dirt', 'EXPIRED: the replacement stands')
  assert.deepStrictEqual(c.dug, [xyz(-12, G + 4, -9)], 'control: the same visit digs the record\'s other cut')
  assert.ok(!c.cuts.some(q => q.at.join(',') === xyz(...STEP)), 'never on the visit\'s list')
  assert.ok(!(c.r.tidied ?? []).includes(xyz(...STEP)) && !(c.r.tidyWet ?? []).includes(xyz(...STEP)), 'so never tried, never waited on')
  assert.ok(!/stuck|defer/.test(String(c.r.stop ?? '')), `the visit is not stuck on it (${c.r.stop})`)
  // what the stage reads after the visit: no cut left (the completion's count), the column free for the next survey, no waiver owed
  const prog = T.tidyProgress(c.head.rec, c.srv.read, { fillDone: fillDone(c.srv), now: c.visitAt })
  assert.deepStrictEqual([prog.cutLeft, prog.cutDone, prog.fillLeft], [0, 2, 0], 'the progress: both cuts done, nothing open')
  assert.deepStrictEqual([...TR.openColumns(c.head.rec, c.srv.read, { done: fillDone(c.srv), now: c.visitAt })], [], 'the refresh: no open column')
  assert.deepStrictEqual(TR.cutGiveUps(c.head.rec, c.srv.read, { given: () => true, now: c.visitAt }), [], 'no waiver for it')
  assert.strictEqual(T.cutStanding(c.srv.read, c.head.rec.cut.find(q => q.handed), c.visitAt), false)
  // the instant before, all three still read it open (the control for each reader)
  const t1 = c.foldAt + LT.LITTER.keepMs
  assert.strictEqual(T.tidyProgress(c.head.rec, c.srv.read, { fillDone: fillDone(c.srv), now: t1 }).cutLeft, 1)
  assert.deepStrictEqual([...TR.openColumns(c.head.rec, c.srv.read, { done: fillDone(c.srv), now: t1 })], ['5,3'])
  assert.deepStrictEqual(TR.cutGiveUps(c.head.rec, c.srv.read, { given: () => true, now: t1 }).map(d => d.k), [xyz(...STEP)])
})
await t('r2 the positive control: the same sequence with the keeper back after one hour -- the visit digs the cut (inside its life the name is believed)', async () => {
  const c = await chain(TB, { after: replaced, visitAfter: HOUR })
  assert.deepStrictEqual(c.dug, [xyz(-12, G + 4, -9), xyz(...STEP)].sort())
  assert.strictEqual(c.srv.read(...STEP).name, 'air')
})
/** BOTH readers of the cut's age on a litter.mjs where a cut never expires: the mutant, and a tidy.mjs that imports it. */
async function withNeverOld (fn) {
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`
  const lsrc = readFileSync(P('litter.mjs'), 'utf8')
  const A = 'export const handedOld = (cut, now, T = LITTER) => !!cut?.handed && !(Number.isFinite(cut.handed) && cut.handed > 1 && Number.isFinite(now) && now - cut.handed <= T.keepMs)'
  assert.strictEqual(lsrc.split(A).length, 2, 'ANCHOR MISSING OR NOT UNIQUE (handedOld)')
  const tsrc = readFileSync(P('tidy.mjs'), 'utf8')
  const B = "import { handedOld } from './litter.mjs'"
  assert.strictEqual(tsrc.split(B).length, 2, 'ANCHOR MISSING OR NOT UNIQUE (tidy.mjs import)')
  const lf = new URL(`./_mutant-${tag}-litter.mjs`, import.meta.url), tf = new URL(`./_mutant-${tag}-tidy.mjs`, import.meta.url)
  writeFileSync(lf, lsrc.replace(A, 'export const handedOld = () => false').replace(/from '\.\//g, "from '../src/"))
  writeFileSync(tf, tsrc.replace(B, `import { handedOld } from './_mutant-${tag}-litter.mjs'`).replace(/from '\.\/(?!_mutant-)/g, "from '../src/"))
  try { return await fn(await import(lf.href), await import(tf.href)) } finally { for (const f of [lf, tf]) { try { unlinkSync(f) } catch {} } }
}
await t('r2 mutants: a cut that never expires (handedOld always false) digs the replacement; each reader alone still holds it; cutStanding and openColumns without the age wait for ever', async () => {
  await withNeverOld(async (LM, TM) => {
    const c = await chain(TB, { after: replaced, visitAfter: LT.LITTER.keepMs + 1, LM, TM })
    assert.strictEqual(c.srv.read(...STEP).name, 'air', 'mutant: the replacement is dug four hours on')
    // two layers: with only the dig-time check gone the visit's list still leaves it out; with only the list's gone the dig refuses it
    const digOnly = await chain(TB, { after: replaced, visitAfter: LT.LITTER.keepMs + 1, LM })
    assert.strictEqual(digOnly.srv.read(...STEP).name, 'dirt', 'the list alone holds it')
    const listOnly = await chain(TB, { after: replaced, visitAfter: LT.LITTER.keepMs + 1, TM })
    assert.ok(listOnly.cuts.some(q => q.at.join(',') === xyz(...STEP)), 'control: the mutant list has it')
    assert.strictEqual(listOnly.srv.read(...STEP).name, 'dirt', 'the dig-time check alone holds it')
  })
  const cut = { at: STEP, kind: 'tidy', name: 'dirt', handed: NOW }, rec = { cut: [cut], cells: [] }
  const srv = riseWorld(), late = NOW + LT.LITTER.keepMs + 1
  assert.strictEqual(T.tidyProgress(rec, srv.read, { fillDone: () => true, now: late }).cutLeft, 0)
  await withMutant(P('tidy.mjs'), 'if (handedOld(c, now)) return false; ', '', async M => {
    assert.strictEqual(M.tidyProgress(rec, srv.read, { fillDone: () => true, now: late }).cutLeft, 1, 'mutant: the stage counts it open for ever')
    assert.deepStrictEqual(M.tidyCuts(rec, srv.read, null, late).map(q => q.at), [STEP], 'mutant: and lists it')
  })
  assert.deepStrictEqual([...TR.openColumns(rec, srv.read, { now: late })], [])
  await withMutant(P('tidyrefresh.mjs'), 'if (hasOwn(w, kOf(c.at)) || handedOld(c, now)) continue; const b = read(...c.at); if (!b || nm(b) === c.name) out.add(colOf(c.at)) }\n  for (const c of rec?.cells', 'if (hasOwn(w, kOf(c.at))) continue; const b = read(...c.at); if (!b || nm(b) === c.name) out.add(colOf(c.at)) }\n  for (const c of rec?.cells', async M => {
    assert.deepStrictEqual([...M.openColumns(rec, srv.read, { now: late })], ['5,3'], 'mutant: its column is never surveyed again')
  })
})
await t('r2 `handed: 1` (a mark that is not a time) is never dug: not listed, and refused at the dig by the real visit even when it is listed', async () => {
  const run = async handed => {
    const srv = server(); srv.set([3, G + 1, 0], 'dirt')
    const cuts = [{ at: [3, G + 1, 0], kind: 'tidy', name: 'dirt', handed }]
    const rec = { v: 1, blueprint: T.TIDY_BLUEPRINT, plot: 'tidy', home: HOME, r: 32, cells: [], clear: [], cut: cuts, replant: [], segments: [] }
    const dir = tmp('mark'), key = PJ.projKey(HOME, 'tidy')
    const pub = PJ.publishRecord(dir, key, () => ({ ...rec }))
    const slot = PJ.takeSlot(dir, key, 'A', 1)
    const e = fakeBuilder(srv, 'A', { feet: [0, G + 1, 0] })
    // the list handed to the runner WHOLE (as a caller that forgot the age would): the dig-time check is the last word
    await R.runVisit({ dir, key, me: 'A', home: HOME, stood: [], record: rec, tidy: cuts, recordGen: pub.gen, palette: T.TIDY_PALETTE, slot: slot.slot, slotGen: slot.gen, domain: () => true, walkR: 48, clearMax: 48, tidyKeepOrder: true, tidyOk: (q, rd) => LT.handedBare(q, rd, NOW + 1000) }, e, { maxSteps: 400 })
    return { name: srv.read(3, G + 1, 0).name, listed: T.tidyCuts(rec, srv.read, null, NOW + 1000).length, left: T.tidyProgress(rec, srv.read, { fillDone: () => true, now: NOW + 1000 }).cutLeft }
  }
  assert.deepStrictEqual(await run(1), { name: 'dirt', listed: 0, left: 0 }, 'handed: 1 -- never dug, never listed, nothing left waiting')
  assert.deepStrictEqual(await run(NOW), { name: 'air', listed: 0, left: 0 }, 'control: a cut folded a second ago is dug by the same visit')
})

// the production reader's shape (skills.mjs litterForSurvey): otherCellsStrict over every guarded project's own recordHead, REAL files
const PLOTS = ['tidy', 'cottage1']
const OTHER = PJ.projKey(HOME, 'cottage1')
const strictOf = dir => () => TS.otherCellsStrict(PLOTS, null, p => PJ.recordHead(dir, PJ.projKey(HOME, p)))
/** skills.mjs projectHeads' rule: a head that is ok is taken as it is (so an OLDER generation, when the newest cannot be read). */
const lenientRecords = dir => PLOTS.map(p => PJ.recordHead(dir, PJ.projKey(HOME, p))).filter(h => h.ok && h.head).map(h => h.head.rec)
/** The cottage's record takes the step's cell in its second generation; then that generation is torn on disk (the first still parses). */
function tornTown () {
  const dir = tmp('torn')
  PJ.publishRecord(dir, PJ.projKey(HOME, 'tidy'), () => ({ v: 1, plot: 'tidy', cells: [], cut: [], clear: [] }))
  PJ.publishRecord(dir, OTHER, () => ({ v: 1, plot: 'cottage1', cells: [{ at: [40, G + 1, 40], role: 'post', seg: 'A' }] }))
  const g2 = PJ.publishRecord(dir, OTHER, cur => ({ ...cur, cells: [...cur.cells, { at: STEP, role: 'post', seg: 'A' }] }))
  return { dir, tear: () => fs.writeFileSync(path.join(dir, `${OTHER}.g${g2.gen}.json`), '{"v": 1, "cells": [') }
}
const intakeFold = (LM, dir, strict) => {
  const srv = riseWorld()
  const it = LM.litterIntake({ read: () => [E(STEP)], strict, records: lenientRecords(dir) })
  // the survey's `cells` are the lenient reader's too (skills.mjs tidyInputs over projectHeads)
  const cells = new Set(lenientRecords(dir).flatMap(r => (r.cells ?? []).map(q => q.at.join(','))))
  const s = stage(srv, { litter: it.entries, cells })
  return { it, cuts: cutK(s), seen: seenOf(s)[xyz(...STEP)] ?? null }
}
await t('r1 RECORDS-UNREAD: with another project\'s newest generation torn the intake folds NOTHING (the lenient reader shown folding the cell that project took)', async () => {
  const town = tornTown()
  // the positive control: while the cottage's record reads, its cell is refused by the survey's own rule
  const ok = intakeFold(LT, town.dir, strictOf(town.dir))
  assert.deepStrictEqual([ok.it.unread, ok.cuts, ok.seen], [null, [], 'dropped:record_col'])
  town.tear()
  const h = PJ.recordHead(town.dir, OTHER)
  assert.deepStrictEqual([h.ok, h.head?.gen, h.rejected.map(r => r.gen)], [true, h.gens[0], [h.gens.at(-1)]], 'control: recordHead is ok, its head the OLDER generation')
  // the defect, shown: the intake without the strict read folds the cottage's cell
  const lenient = intakeFold(LT, town.dir, () => new Set())
  assert.deepStrictEqual([lenient.cuts, lenient.seen], [[xyz(...STEP)], 'take:same'], 'the defect: read leniently, the cell is free and is cut')
  // the rule: nothing reaches the survey, and the row says how many waited and for which record
  const strict = intakeFold(LT, town.dir, strictOf(town.dir))
  assert.deepStrictEqual(strict.it, { entries: [], unread: { n: 1, why: 'record_unread_cottage1' } })
  assert.deepStrictEqual([strict.cuts, strict.seen], [[], null], 'RECORDS-UNREAD: nothing folded')
  assert.strictEqual(LT.unreadDetail(strict.it.unread), 'op=dropped n=1 why=records_unread record=record_unread_cottage1')
  // a directory that cannot be listed (recordHead: ok false) is the same refusal; no entry read: no strict read at all, no row
  assert.deepStrictEqual(LT.litterIntake({ read: () => [E(STEP)], strict: () => TS.otherCellsStrict(PLOTS, null, () => ({ ok: false, head: null, gens: [], rejected: [] })) }).unread, { n: 1, why: 'record_unread_tidy' })
  let asked = 0
  assert.deepStrictEqual(LT.litterIntake({ read: () => [], strict: () => { asked++; throw new Error('x') } }), { entries: [], unread: null }); assert.strictEqual(asked, 0)
  assert.deepStrictEqual(LT.litterIntake({ read: () => { throw new Error('EIO') } }), { entries: [], unread: null }, 'never throws')
  // the mutant: the strict read dropped from the intake -> the torn record's cell is cut
  await withMutant(P('litter.mjs'), "  try { strict() } catch (e) { return { entries: [], unread: { n: entries.length, why: String(e?.message ?? e).replace(/\\s+/g, '_').slice(0, 60) } } }\n", '', async M => {
    const m = intakeFold(M, town.dir, strictOf(town.dir))
    assert.deepStrictEqual([m.it.unread, m.cuts], [null, [xyz(...STEP)]], 'mutant: folded over the torn record')
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
await t('skills.mjs (structural, comments stripped): every survey reads the hand-off through the STRICT intake, behind the switch; the rows follow each publish; the visit asks handedBare at the dig', () => {
  const src = readFileSync(P('skills.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
  /** The wiring's checks, each with its own name -> the name of the first that fails | null. */
  const wired = s => {
    if (!/const LITTER_ON = litterOn\(\)/.test(s)) return 'switch-const'
    if (!/function litterForSurvey \(bot, dir, records\) \{\s*if \(!LITTER_ON\) return \[\]\s*const r = litterIntake\(/.test(s)) return 'switch'
    if (!/const r = litterIntake\(\{ read: \(\) => litterRead\(dir, \{ since: Date\.now\(\) - LITTER\.keepMs \}\), strict: \(\) => otherCellsStrict\(projectsGuarded\(\)\.map\(p => p\.plot\), null, pl => recordHead\(dir, projKeyOf\(pl\)\)\), records \}\)\s*if \(r\.unread\) \{ try \{ logEvent\(\{ kind: 'litter', status: 'no_effect', snapshot: snapshot\(bot\), detail: litterUnreadDetail\(r\.unread\) \}\) \} catch \{\s*\} \}\s*return r\.entries\s*\}/.test(s)) return 'strict-intake'
    if (!/const terrace = \{[^\n]*\}\s*terrace\.litter = litterForSurvey\(bot, dir, I\.records\)\s*return \{ land, read, last, lights, terrace \}/.test(s)) return 'stage-inputs'
    if (!/const bandIn = \{[^\n]*\}\s*bandIn\.litter = litterForSurvey\(bot, dir, I\.records\)/.test(s)) return 'band-inputs'
    if (s.split('litterIntakeLog(bot, ').length !== 4) return 'rows'
    if (!/if \(!LITTER_ON \|\| !lit \|\| !\(lit\.read > 0\)\) return/.test(s)) return 'rows-switch'
    if (!/tidyOk: \(q, rd\) => cutSafeNow\(rd, q\.at, tidyWater\(\)\) && [^\n]* && handedBare\(q, rd\) \} : \{\}\),/.test(s)) return 'dig-check'
    if (!/const bo = builtOnHeld\(rec, r\.tidyWet \?\? \[\], read2\); if \(bo\.length\) logEvent\(\{ kind: 'litter', status: 'no_effect', snapshot: snapshot\(bot\), detail: litterBuiltOnDetail\(bo\) \}\)/.test(s)) return 'dig-row'
    return null
  }
  assert.strictEqual(wired(src), null)
  // THE MUTANTS (review r1, Codex 4): each is BUILT FIRST, its anchor asserted present and unique on its own -- a missing anchor
  // fails here, never inside the check below -- and then the wiring's check must fail on it FOR ITS OWN REASON
  const build = (a, b) => { assert.strictEqual(src.split(a).length, 2, `ANCHOR MISSING OR NOT UNIQUE: ${a.slice(0, 60)}`); const m = src.replace(a, b); assert.notStrictEqual(m, src, 'the mutation changed nothing'); return m }
  const STRICT = 'strict: () => otherCellsStrict(projectsGuarded().map(p => p.plot), null, pl => recordHead(dir, projKeyOf(pl)))'
  const mutants = [
    ['switch', build('  if (!LITTER_ON) return []\n', '')],
    ['strict-intake', build(STRICT, 'strict: () => new Set(projectHeads().flatMap(x => (x.head.rec?.cells ?? []).map(q => q.at.join(\',\'))))')],
    ['strict-intake', build(STRICT, `strict: () => { try { return ${STRICT.slice('strict: () => '.length)} } catch { return new Set() } }`)],
    ['strict-intake', build('  return r.entries\n', '  return litterRead(dir)\n')],
    ['stage-inputs', build('  terrace.litter = litterForSurvey(bot, dir, I.records)\n', '')],
    ['band-inputs', build('  bandIn.litter = litterForSurvey(bot, dir, I.records)', '')],
    ['rows', build("where: 'refresh', gen: pub.gen })", "where: 'refresh', gen: pub.gen }); litterIntakeLog(bot, null)")],
    ['dig-check', build(' && handedBare(q, rd) } : {}),', ' } : {}),')],
    ['dig-row', build('const bo = builtOnHeld(rec, r.tidyWet ?? [], read2); ', 'const bo = []; ')],
  ]
  for (const [why, m] of mutants) assert.strictEqual(wired(m), why, `the mutant dies as ${why}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
