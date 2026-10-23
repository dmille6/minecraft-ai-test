// LEDGER-01: the town ledger's `station` records (cooperation-tier design r9.1, docs/reports/cooperation-tier-2026-10-23.md
// sections 4.2, 4.3 and 6.4). Behaviour first: the pure outcome truth table (entry / coalesced into the NEWEST entry from
// any bot / drop), the fold (order-independent by permutation, checkpoints, worlds), the file (one append per observation
// carrying its outcome, rotation, a dead writer's fragment, LEDGER=off), then the REAL skills in fake worlds -- the drain's
// open (its row and its record from ONE read), smelt's open and load -- and the scope (the drain's furnaces only). The one
// structural invariant (every `openFurnace` call site writes a window record before any click) is a pure check over the
// comment-stripped source, proven to fail on anchored mutants (the anchor present and unique, or the mutant is not a kill).
process.env.LOG_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mcbot-ledger-logs-'))
process.env.BOT_NAME = 'LedgerBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.MEMORY_SCOPE = 'shared'
process.env.MEMORY_POOL = 'ledger-test'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'
process.env.LEDGER_ROTATE_BYTES = '4000'          // rotation is exercised here; the fleet's is 4 MB
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mcbot-ledger-pool-'))
delete process.env.LEDGER

import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const L = await import('../src/ledger.mjs')
const S = await import('../src/skills.mjs')
const { drainDetail } = await import('../src/smeltjob.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ledger-'))
const HK = '0_64_0'
const F = '2,64,0'
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0)
const MIN = 60_000
const EMPTY = L.furnaceSlots({})
const HOLDS = L.furnaceSlots({ input: { name: 'raw_iron', count: 8 }, fuel: { name: 'coal', count: 1 } })
const lines = (dir, gen = 1) => fs.readFileSync(L.ledgerFile(dir, HK, gen), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x))

// ---- pure ----------------------------------------------------------------------------------------------------------
test('slots: [name, count] per slot, null when empty; state lit / empty / holds; equality slot by slot and lit', () => {
  assert.deepEqual(L.furnaceSlots({ input: { name: 'raw_iron', count: 3 }, output: { name: 'iron_ingot', count: 0 }, lit: 1 }),
    { in: ['raw_iron', 3], fuel: null, out: null, lit: true })
  assert.equal(L.stationState(EMPTY), 'empty'); assert.equal(L.stationState(HOLDS), 'holds')
  assert.equal(L.stationState({ ...EMPTY, lit: true }), 'lit')
  assert.equal(L.slotsEqual(HOLDS, L.furnaceSlots({ input: { name: 'raw_iron', count: 8 }, fuel: { name: 'coal', count: 1 } })), true)
  assert.equal(L.slotsEqual(HOLDS, L.furnaceSlots({ input: { name: 'raw_iron', count: 7 }, fuel: { name: 'coal', count: 1 } })), false, 'a count differs')
  assert.equal(L.slotsEqual(EMPTY, { ...EMPTY, lit: true }), false, 'lit differs')
})

test('outcome truth table: none -> entry; identical < 10 min -> coalesced INTO the newest entry; identical later -> a refresh entry, dropped only over the cap; a change -> entry, never dropped', () => {
  const newest = { id: 'B-1', at: T0, slots: EMPTY }
  assert.deepEqual(L.stationOutcome(null, { at: T0, slots: EMPTY }), { outcome: 'entry' })
  assert.deepEqual(L.stationOutcome(newest, { at: T0 + L.COALESCE_MS - 1, slots: EMPTY }), { outcome: 'coalesced', into: 'B-1' })
  assert.deepEqual(L.stationOutcome(newest, { at: T0 + L.COALESCE_MS, slots: EMPTY }), { outcome: 'entry', refresh: true })
  assert.deepEqual(L.stationOutcome(newest, { at: T0 + L.COALESCE_MS, slots: EMPTY }, L.OBS_CAP_PER_H), { outcome: 'drop' })
  assert.deepEqual(L.stationOutcome(newest, { at: T0 + 1, slots: HOLDS }, 10_000), { outcome: 'entry' }, 'a changed state is never capped')
})

test('fold: newest `at` wins per furnace, ties by id; coalesced and drop records are not entries; order-independent over every permutation', () => {
  const recs = [
    { t: 'station', id: 'a', f: F, at: T0, slots: HOLDS, outcome: 'entry' },
    { t: 'station', id: 'b', f: F, at: T0 + 5, slots: EMPTY, outcome: 'entry' },
    { t: 'station', id: 'c', f: F, at: T0 + 5, slots: HOLDS, outcome: 'entry' },        // a tie: 'c' > 'b'
    { t: 'station', id: 'd', f: F, at: T0 + 9, slots: EMPTY, outcome: 'coalesced', into: 'c' },
    { t: 'station', id: 'e', f: F, at: T0 + 9, slots: EMPTY, outcome: 'drop' },
    { t: 'station', id: 'g', f: '9,64,9', at: T0, slots: EMPTY, outcome: 'entry' },
    { garbage: 1 },
  ]
  const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]))
  const want = JSON.stringify(L.foldLedger(recs).furnaces)
  for (const p of perms(recs)) assert.equal(JSON.stringify(L.foldLedger(p).furnaces), want)
  const v = L.foldLedger(recs)
  assert.equal(v.furnaces[F].id, 'c'); assert.equal(v.furnaces['9,64,9'].id, 'g')
  assert.deepEqual([v.entries, v.coalesced, v.dropped, v.bad], [4, 1, 1, 1])
})

test('live station: within the 60-min TTL only; a future-stamped entry beyond a minute is not live', () => {
  const view = { furnaces: { [F]: { id: 'x', at: T0, slots: EMPTY } } }
  assert.equal(L.liveStation(view, F, T0 + L.STATION_TTL_MS - 1)?.id, 'x')
  assert.equal(L.liveStation(view, F, T0 + L.STATION_TTL_MS), null)
  assert.equal(L.liveStation(view, F, T0 - 2 * MIN), null)
  assert.equal(L.liveStation(view, 'nope', T0), null)
})

// ---- the file ------------------------------------------------------------------------------------------------------
test('ONE APPEND per observation, carrying its evidence AND its outcome (design 6.4, Claude r9 #3)', () => {
  const dir = tmp(); L.resetLedgerCap()
  const r1 = L.recordStation(dir, HK, null, { id: 'A-1', f: F, bot: 'A', by: 'drain', phase: 'open', slots: EMPTY, at: T0 })
  const r2 = L.recordStation(dir, HK, null, { id: 'B-1', f: F, bot: 'B', by: 'drain', phase: 'open', slots: EMPTY, at: T0 + MIN })
  const got = lines(dir)
  assert.equal(got.length, 2, 'two observations, two lines: never a record and a separate outcome')
  for (const [rec, line] of [[r1, got[0]], [r2, got[1]]]) {
    assert.deepEqual(line.slots, rec.slots); assert.equal(line.outcome, rec.outcome); assert.equal(line.id, rec.id)
    assert.ok(['entry', 'coalesced', 'drop'].includes(line.outcome))
  }
  assert.equal(got[0].outcome, 'entry'); assert.equal(got[1].outcome, 'coalesced'); assert.equal(got[1].into, 'A-1')
})

test('COALESCE INTO THE NEWEST, from any bot (design 6.4, Claude r9 #1): A post-load, B finds it empty, A loads identically within 10 min -> A APPENDS an entry', () => {
  const dir = tmp(); L.resetLedgerCap()
  const a1 = L.recordStation(dir, HK, null, { id: 'A-load', f: F, bot: 'A', by: 'smelt', phase: 'load', slots: HOLDS, at: T0 })
  const b1 = L.recordStation(dir, HK, null, { id: 'B-open', f: F, bot: 'B', by: 'drain', phase: 'open', slots: EMPTY, at: T0 + 2 * MIN })
  const a2 = L.recordStation(dir, HK, null, { id: 'A-load2', f: F, bot: 'A', by: 'smelt', phase: 'load', slots: HOLDS, at: T0 + 4 * MIN })
  assert.equal(a1.outcome, 'entry'); assert.equal(b1.outcome, 'entry', 'a change is an entry')
  assert.equal(a2.outcome, 'entry', 'identical to A\'s OWN earlier load but not to the newest (B\'s empty): never a coalesce into a stale entry')
  assert.equal(L.readLedger(dir, HK).view.furnaces[F].id, 'A-load2', 'the fold\'s newest is A\'s second load')
  // and a repeat of the newest (from another bot) coalesces into IT
  const c1 = L.recordStation(dir, HK, null, { id: 'C-open', f: F, bot: 'C', by: 'smelt_town', phase: 'open', slots: HOLDS, at: T0 + 5 * MIN })
  assert.deepEqual([c1.outcome, c1.into], ['coalesced', 'A-load2'])
})

test('the observation CAP: refreshes past COALESCE_MS are dropped over OBS_CAP_PER_H an hour (the drop is still one record); a changed state is never dropped', () => {
  const dir = tmp(); L.resetLedgerCap()
  let at = T0
  const outs = []
  for (let i = 0; i < L.OBS_CAP_PER_H + 3; i++) {
    at += L.COALESCE_MS            // each identical repeat is old enough to be a refresh
    outs.push(L.recordStation(dir, HK, null, { id: `r${i}`, f: `${i % 50},64,0`, bot: 'A', by: 'drain', slots: EMPTY, at: T0 + i }).outcome)
  }
  // first observation of each of 50 furnaces is a plain entry (not a refresh), so build refreshes on ONE furnace:
  L.resetLedgerCap()
  const d2 = tmp()
  L.recordStation(d2, HK, null, { id: 'first', f: F, bot: 'A', by: 'drain', slots: EMPTY, at: T0 })
  const got = []
  for (let i = 1; i <= L.OBS_CAP_PER_H + 2; i++) got.push(L.recordStation(d2, HK, null, { id: `x${i}`, f: F, bot: 'A', by: 'drain', slots: EMPTY, at: T0 + i * L.COALESCE_MS / 100 * 0 + i * 30_000 + L.COALESCE_MS * Math.ceil(i / 1e9) }))
  // the timeline above: x1 lands 10.5 min after `first` (a refresh); every later one lands 30 s after the previous entry
  // and so COALESCES into it -- the cap only ever counts refresh ENTRIES. Drive refreshes directly instead:
  L.resetLedgerCap()
  const d3 = tmp()
  let t = T0
  const res = []
  for (let i = 0; i <= L.OBS_CAP_PER_H + 1; i++) {
    res.push(L.recordStation(d3, HK, null, { id: `y${i}`, f: F, bot: 'A', by: 'drain', slots: EMPTY, at: t }))
    t += L.COALESCE_MS * 0 + 1   // within the hour
    // make every next observation a REFRESH of the newest: rewrite the newest's age by appending far apart in `at`
  }
  assert.ok(outs.length && got.length && res.length)   // (the timelines above are exercised for no-throw; the cap is below)
  // THE CAP, PROVEN: a refresh is an identical state >= COALESCE_MS after the newest entry. Within one hour, entries
  // must be >= 10 min apart to be refreshes, so a single furnace yields at most 6 an hour; the cap is per BOT across
  // furnaces. Use 130 furnaces, each with an old entry from another bot, then refresh each once inside the hour.
  L.resetLedgerCap()
  const d4 = tmp()
  const n = L.OBS_CAP_PER_H + 5
  for (let i = 0; i < n; i++) L.recordStation(d4, HK, null, { id: `old${i}`, f: `${i},64,1`, bot: 'B', by: 'drain', slots: EMPTY, at: T0 })
  L.resetLedgerCap()          // B's process is not A's: the cap is per writer
  const outcomes = []
  for (let i = 0; i < n; i++) outcomes.push(L.recordStation(d4, HK, null, { id: `ref${i}`, f: `${i},64,1`, bot: 'A', by: 'drain', slots: EMPTY, at: T0 + L.COALESCE_MS + i }).outcome)
  assert.equal(outcomes.filter(o => o === 'entry').length, L.OBS_CAP_PER_H, 'exactly the cap of refreshes an hour')
  assert.equal(outcomes.filter(o => o === 'drop').length, 5)
  const ch = L.recordStation(d4, HK, null, { id: 'chg', f: '0,64,1', bot: 'A', by: 'smelt', slots: HOLDS, at: T0 + L.COALESCE_MS + n })
  assert.equal(ch.outcome, 'entry', 'a changed state over the cap is still an entry')
  // an hour later the window has emptied: refreshes are written again
  const later = L.recordStation(d4, HK, null, { id: 'late', f: `${n - 1},64,1`, bot: 'A', by: 'drain', slots: EMPTY, at: T0 + L.COALESCE_MS + 3600_000 + 2 * L.COALESCE_MS })
  assert.equal(later.outcome, 'entry')
  const all = lines(d4).concat(fs.existsSync(L.ledgerFile(d4, HK, 2)) ? lines(d4, 2) : [])
  assert.equal(all.filter(r => r.t === 'station' && r.outcome === 'drop').length, 5, 'every drop is its own record: every observation maps to one outcome')
})

test('rotation: past LEDGER_ROTATE_BYTES a writer opens N+1 with the fold as a checkpoint; readers see the same newest entries; generations before N-1 are removed', () => {
  const dir = tmp(); L.resetLedgerCap()
  const want = {}
  for (let i = 0; i < 120; i++) {
    const f = `${i % 7},64,0`
    const slots = i % 2 ? EMPTY : HOLDS
    const r = L.recordStation(dir, HK, null, { id: `z${String(i).padStart(3, '0')}`, f, bot: 'A', by: 'drain', slots, at: T0 + i * MIN })
    if (r.outcome === 'entry') want[f] = r.id
    else if (r.outcome === 'coalesced') assert.equal(r.into, want[f])
  }
  const gens = L.ledgerGens(dir, HK)
  assert.ok(gens.at(-1) >= 3, `rotated (gens ${gens})`); assert.ok(gens.length <= 2, `at most two generations kept: ${gens}`)
  const { view, ok } = L.readLedger(dir, HK)
  assert.equal(ok, true)
  assert.deepEqual(Object.fromEntries(Object.entries(view.furnaces).map(([f, e]) => [f, e.id])), want)
})

test('a dead writer\'s fragment is closed off by the next append (newline first); the fold skips it and reads on', () => {
  const dir = tmp(); L.resetLedgerCap()
  L.recordStation(dir, HK, null, { id: 'p1', f: F, bot: 'A', by: 'drain', slots: EMPTY, at: T0 })
  fs.appendFileSync(L.ledgerFile(dir, HK, 1), '{"t":"station","id":"torn","f":"2,64')
  const r = L.recordStation(dir, HK, null, { id: 'p2', f: F, bot: 'B', by: 'smelt', slots: HOLDS, at: T0 + MIN })
  assert.equal(r.outcome, 'entry')
  const { view, ok } = L.readLedger(dir, HK)
  assert.equal(ok, true); assert.equal(view.furnaces[F].id, 'p2'); assert.equal(view.entries, 2)
})

test('worlds: a record (and a checkpoint) of another world is never read -- before and after a rotation', () => {
  const dir = tmp(); L.resetLedgerCap()
  L.recordStation(dir, HK, 'world-X', { id: 'wx', f: F, bot: 'A', by: 'drain', slots: HOLDS, at: T0 })
  const y = L.recordStation(dir, HK, 'world-Y', { id: 'wy', f: F, bot: 'A', by: 'drain', slots: HOLDS, at: T0 + 1 })
  assert.equal(y.outcome, 'entry', 'the other world\'s identical entry is not this world\'s newest')
  assert.equal(L.readLedger(dir, HK, 'world-X').view.furnaces[F].id, 'wx')
  assert.ok(L.rotateLedger(dir, HK, 1))
  assert.equal(L.readLedger(dir, HK, 'world-X').view.furnaces[F].id, 'wx', 'world-X\'s checkpoint is read in world-X')
  assert.equal(L.readLedger(dir, HK, 'world-Y').view.furnaces[F].id, 'wy', 'and never world-X\'s in world-Y')
  assert.equal(L.readLedger(dir, HK, 'world-Z').view.furnaces[F], undefined)
})

test('an unreadable ledger reads ok:false (never "empty"), and a write there fails closed to null', () => {
  const file = path.join(tmp(), 'not-a-dir'); fs.writeFileSync(file, 'x')
  assert.equal(L.readLedgerRecords(file, HK).ok, true, 'no generation in a non-directory: none')
  const dir = tmp()
  fs.mkdirSync(L.ledgerFile(dir, HK, 1))         // generation 1 is a DIRECTORY: it cannot be read
  assert.equal(L.readLedger(dir, HK).ok, false)
  assert.equal(L.recordStation(dir, HK, null, { id: 'q', f: F, bot: 'A', by: 'drain', slots: EMPTY, at: T0 }), null)
})

test('LEDGER=off: nothing is written and the licence row says on=off (the one-setting rollback)', () => {
  const dir = tmp()
  const code = `const L = await import(${JSON.stringify(new URL('../src/ledger.mjs', import.meta.url).href)});
    const r = L.recordStation(${JSON.stringify(dir)}, '${HK}', null, { id: 'o', f: '${F}', bot: 'A', by: 'drain', slots: L.furnaceSlots({}), at: 1 });
    console.log(JSON.stringify({ r, files: (await import('node:fs')).readdirSync(${JSON.stringify(dir)}), mode: L.ledgerModeDetail() }))`
  const p = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, LEDGER: 'off' }, encoding: 'utf8' })
  assert.equal(p.status, 0, p.stderr)
  const o = JSON.parse(p.stdout.trim())
  assert.equal(o.r, null); assert.deepEqual(o.files, []); assert.match(o.mode, /^phase=mode on=off v=1 /)
  assert.match(L.ledgerModeDetail(), /^phase=mode on=on v=1 coalesce_min=10 cap_per_h=120 ttl_min=60 records=station$/)
})

// ---- the real skills -----------------------------------------------------------------------------------------------
/** A fake town furnace (mineflayer's window shape: slot getters, `fuel` progress, close). */
function fakeFurnace ({ input = null, fuel = null, output = null, lit = 0, throws = null } = {}) {
  const s = { input, fuel, output }
  return {
    inputItem: () => { if (throws === 'input') throw new Error('gone'); return s.input },
    fuelItem: () => s.fuel, outputItem: () => s.output, fuel: lit, close () {}, slots: s,
  }
}
function drainWorld (furnace, at = new Vec3(2, 64, 0)) {
  const fid = mcData.blocksByName.furnace.id
  return {
    entity: { position: new Vec3(1, 64, 0), velocity: { y: 0 } }, username: 'LedgerBot', health: 20, food: 20, registry: mcData,
    inventory: { items: () => [] },
    findBlocks: () => [at],
    blockAt: p => (p.x === at.x && p.y === at.y && p.z === at.z
      ? { type: fid, name: 'furnace', position: at, getProperties: () => ({ lit: false }) }
      : { type: 0, name: 'air', position: p }),
    lookAt: async () => {}, pathfinder: { goto: async () => {}, setGoal () {}, stop () {} },
    openFurnace: async () => furnace,
  }
}
const ledgerNow = () => L.readLedgerRecords(process.env.POOL_STATE_DIR, HK).records.filter(r => r.t === 'station')
const tap = () => { const rows = []; const un = tapRecords(r => rows.push(r)); return { rows, un } }

test('the DRAIN on an empty town furnace: one open record, and its row\'s out/in/fuel come from the SAME read as the record (L1 drains)', async () => {
  L.resetLedgerCap()
  const before = ledgerNow().length
  const { rows, un } = tap()
  let r
  try { r = await S.SKILLS.furnace_drain.run({ bot: drainWorld(fakeFurnace()) }, {}, null) } finally { un() }
  assert.equal(r.status, 'no_effect'); assert.equal(r.stop, 'empty')
  const recs = ledgerNow().slice(before)
  assert.equal(recs.length, 1, 'exactly one window record for one open')
  const rec = recs[0]
  assert.deepEqual([rec.f, rec.by, rec.phase, rec.state, rec.outcome], ['2,64,0', 'drain', 'open', 'empty', 'entry'])
  const row = rows.find(x => x?.skill?.name === '_furnace_drain' || x?.skill?.name === 'furnace_drain')
  assert.ok(row, 'the drain row'); const d = row.skill.detail
  assert.match(d, new RegExp(`ledger=${rec.id}( |$)`), 'the row names its record')
  const fld = k => (new RegExp(`(?:^| )${k}=(\\S+)`).exec(d) ?? [])[1]
  const asRow = x => (x ? x.join(':') : '0')
  assert.deepEqual([fld('out'), fld('in'), fld('fuel')], [asRow(rec.slots.out), asRow(rec.slots.in), asRow(rec.slots.fuel)])
  const st = rows.find(x => x?.skill?.name === '_ledger_station')
  assert.ok(st, 'the licence row `_ledger_station`, one per record'); assert.match(st.skill.detail, new RegExp(`^id=${rec.id} f=2,64,0 phase=open by=drain state=empty outcome=entry `))
  // a second drain of the same empty furnace 0 s later coalesces into the first (the cache furnaceseen-01 will read)
  bot2: {
    const b = drainWorld(fakeFurnace())
    const r2 = await S.SKILLS.furnace_drain.run({ bot: b }, {}, null)
    assert.equal(r2.stop, 'empty')
    const last = ledgerNow().at(-1)
    assert.deepEqual([last.outcome, last.into], ['coalesced', rec.id])
    break bot2
  }
})

test('the DRAIN on a furnace with output: the record is taken BEFORE any click (it shows the output the drain then takes)', async () => {
  L.resetLedgerCap()
  const fu = fakeFurnace({ output: { name: 'iron_ingot', count: 3, type: mcData.itemsByName.iron_ingot.id } })
  let clicked = false
  fu.takeOutput = async () => { clicked = true; fu.slots.output = null }
  const before = ledgerNow().length
  const bot = drainWorld(fu, new Vec3(3, 64, 0))
  await S.SKILLS.furnace_drain.run({ bot }, {}, null).catch(() => null)
  const rec = ledgerNow().slice(before)[0]
  assert.ok(rec, 'a record'); assert.deepEqual(rec.slots.out, ['iron_ingot', 3], 'the window as opened, before the take')
  assert.equal(rec.state, 'holds'); void clicked
})

test('scope: only the drain\'s furnaces (within DRAIN_RADIUS of home, at town level); an unreadable slot writes nothing', () => {
  L.resetLedgerCap()
  const bot = { username: 'LedgerBot', worldId: null, entity: { position: new Vec3(0, 64, 0) } }
  assert.ok(S.ledgerFurnace(bot, new Vec3(5, 64, 5), fakeFurnace(), 'smelt', 'open'), 'a town furnace')
  assert.equal(S.ledgerFurnace(bot, new Vec3(60, 64, 0), fakeFurnace(), 'smelt', 'open'), null, 'beyond DRAIN_RADIUS')
  assert.equal(S.ledgerFurnace(bot, new Vec3(5, 30, 5), fakeFurnace(), 'smelt', 'open'), null, 'a furnace in a mine below town')
  assert.equal(S.ledgerFurnace(bot, new Vec3(6, 64, 5), fakeFurnace({ throws: 'input' }), 'smelt', 'open'), null, 'no evidence, no record')
  const lit = S.ledgerFurnace(bot, new Vec3(7, 64, 5), fakeFurnace({ lit: 0.4, input: { name: 'raw_iron', count: 2 } }), 'smelt', 'open')
  assert.equal(lit.state, 'lit'); assert.equal(lit.slots.lit, true)
})

test('SMELT at a town furnace: an OPEN record before any click and a LOAD record after the load; the session row carries the open\'s window fields', async () => {
  L.resetLedgerCap()
  const ID = n => mcData.itemsByName[n].id
  const bag = { raw_iron: 2, coal: 1 }
  const slots = { input: null, fuel: null, output: null }
  const fu = {
    inputItem: () => slots.input, fuelItem: () => slots.fuel, outputItem: () => slots.output, fuel: 0,
    async putInput (type, _m, count) { const n = mcData.items[type].name; bag[n] -= count; slots.input = { name: n, type, count } },
    async putFuel (type, _m, count) { const n = mcData.items[type].name; bag[n] -= count; slots.fuel = { name: n, type, count } },
    async takeOutput () { const o = slots.output; slots.output = null; if (o) bag[o.name] = (bag[o.name] ?? 0) + o.count; return o },
    async takeInput () { const o = slots.input; slots.input = null; if (o) bag[o.name] = (bag[o.name] ?? 0) + o.count; return o },
    async takeFuel () { const o = slots.fuel; slots.fuel = null; if (o) bag[o.name] = (bag[o.name] ?? 0) + o.count; return o },
    close () {}, emptySlotCount: () => 30,
  }
  const at = new Vec3(2, 64, 0)
  const fid = mcData.blocksByName.furnace.id
  const bot = {
    entity: { position: new Vec3(1, 64, 0), velocity: { y: 0 } }, username: 'LedgerBot', health: 20, food: 20, registry: mcData,
    inventory: { items: () => Object.entries(bag).filter(([, c]) => c > 0).map(([name, count], i) => ({ name, count, type: ID(name), slot: 9 + i })) },
    findBlocks: () => [at], findBlock: ({ matching }) => { const b = { type: fid, position: at }; return matching(b) ? b : null },
    blockAt: p => (p.x === at.x && p.y === at.y && p.z === at.z ? { type: fid, name: 'furnace', position: at, getProperties: () => ({ lit: false }) } : { type: 0, name: 'air', position: p }),
    lookAt: async () => {}, equip: async () => {}, pathfinder: { goto: async () => {}, setGoal () {}, stop () {} },
    openFurnace: async () => fu,
  }
  const before = ledgerNow().length
  const { rows, un } = tap()
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 400)
  try { await S.SKILLS.smelt.run({ bot }, { item: 'raw_iron', count: 2 }, ac.signal).catch(() => null) } finally { un() }
  const recs = ledgerNow().slice(before)
  const open = recs.find(r => r.phase === 'open'), load = recs.find(r => r.phase === 'load')
  assert.ok(open, `an open record (${JSON.stringify(recs)})`); assert.equal(open.state, 'empty', 'what the window showed before any click')
  assert.equal(open.by, 'smelt')
  assert.ok(load, 'a load record'); assert.deepEqual(load.slots.in, ['raw_iron', 2]); assert.deepEqual(load.slots.fuel, ['coal', 1])
  assert.equal(load.outcome, 'entry', 'empty -> loaded is a change')
  assert.ok(load.at > open.at && load.id !== open.id, 'the load has its own id and time')
  const sess = rows.find(x => x?.skill?.name === '_furnace_session')
  assert.ok(sess, 'the session row'); assert.match(sess.skill.detail, new RegExp(` open=${open.id} in=0 fuel=0 out=0$`))
})

test('drainDetail stays under the 300-char detail cap with the ledger id', () => {
  const d = drainDetail({ stop: 'drain_left', furnace: '-1234,64,-1234', lease: 99999, out: 'iron_ingot:64', inp: 'raw_copper:64', fuel: 'charcoal:64', taken: 999, left: 'raw_copper:64,charcoal:64', t0: Date.now(), ledger: `LedgerBotLongName-L-${Date.now()}-abcdef` })
  assert.ok(d.length < 300, d.length); assert.match(d, / ledger=LedgerBotLongName-L-\d+-abcdef$/)
  assert.ok(!/ledger=/.test(drainDetail({ stop: 'empty' })), 'no ledger field when the drain never opened')
})

// ---- the structural invariant: EVERY openFurnace call site writes a window record before any click -----------------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
/**
 * -> [{ at, ok, why }] per `openFurnace(` call site in comment-stripped source: ok when an open-phase `ledgerFurnace(` call
 * follows it before any window CLICK (`.put*` / `.take*` / `drainFurnace(` / `.close(`) and before the next open. Pure.
 */
export function openerSites (src) {
  const s = strip(src)
  const opens = [...s.matchAll(/\bopenFurnace\(/g)].map(m => m.index).filter(i => !/function\s+$|\.\s*$/.test(s.slice(Math.max(0, i - 12), i)) || /bot\.\s*$/.test(s.slice(Math.max(0, i - 6), i)))
  return opens.map((at, k) => {
    const end = opens[k + 1] ?? s.length
    const seg = s.slice(at, end)
    const rec = seg.search(/\bledgerFurnace\([^)]*'open'/)
    const click = seg.search(/\.(putInput|putFuel|takeOutput|takeInput|takeFuel|close)\(|\bdrainFurnace\(/)
    if (rec < 0) return { at, ok: false, why: 'no window record after this open' }
    if (click >= 0 && click < rec) return { at, ok: false, why: 'a click before the window record' }
    return { at, ok: true }
  })
}
const SRC_DIR = new URL('../src/', import.meta.url)
const srcFiles = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.mjs'))
const openerFiles = srcFiles.filter(f => /\bbot\.openFurnace\(/.test(strip(fs.readFileSync(new URL(f, SRC_DIR), 'utf8'))))

test('STRUCTURAL: every `bot.openFurnace(` call site in src/ writes an open-phase window record before any click (design 4.3 "the opener set"; 6.4 Claude r9 #9)', () => {
  assert.deepEqual(openerFiles, ['skills.mjs'], 'the opener set lives in skills.mjs on this base (a new opener elsewhere must be covered too)')
  const sites = openerSites(fs.readFileSync(new URL('skills.mjs', SRC_DIR), 'utf8'))
  assert.equal(sites.length, 2, 'two call sites on this base: smelt (smelt + smelt_town) and the drain')
  for (const x of sites) assert.ok(x.ok, `openFurnace at offset ${x.at}: ${x.why}`)
})

/** An anchored mutant: the anchor must be present and UNIQUE, or the mutant is not a kill. */
function mutant (src, old, neu) {
  assert.ok(src.includes(old), `ANCHOR MISSING: ${old.slice(0, 80)}`)
  assert.equal(src.split(old).length - 1, 1, `ANCHOR NOT UNIQUE: ${old.slice(0, 80)}`)
  return src.replace(old, neu)
}
test('STRUCTURAL MUTANTS: removing either site\'s record, or moving the drain\'s after a click, fails the check (and the drain mutant also fails BEHAVIOUR: no record)', () => {
  const src = fs.readFileSync(new URL('skills.mjs', SRC_DIR), 'utf8')
  const dropDrain = mutant(src, `    f.ledger = ledgerFurnace(bot, pos, furnace, 'drain', 'open', seen)?.id ?? '-'\n`, '')
  assert.ok(openerSites(dropDrain).some(x => !x.ok), 'the drain\'s record removed: caught')
  const dropSmelt = mutant(src, `{ const lr = ledgerFurnace(bot, block.position, furnace, session.opts?.by ?? 'smelt', 'open');`, `{ const lr = null;`)
  assert.ok(openerSites(dropSmelt).some(x => !x.ok), 'smelt\'s record removed: caught')
  const late = mutant(dropDrain, `    await drainFurnace(win, SMELT_RECOVERY_MS, bot)\n`, `    await drainFurnace(win, SMELT_RECOVERY_MS, bot)\n    f.ledger = ledgerFurnace(bot, pos, win, 'drain', 'open', seen)?.id ?? '-'\n`)
  assert.ok(openerSites(late).some(x => x.why === 'a click before the window record'), 'a record after the click: caught')
  const extra = mutant(src, `export function ledgerFurnace (`, `async function thirdOpener (bot, b) { const w = await bot.openFurnace(b); await w.takeOutput() }\nexport function ledgerFurnace (`)
  assert.ok(openerSites(extra).some(x => !x.ok), 'a NEW opener without a record (as mats-01\'s make_material would be): caught')
  assert.ok(openerSites(src).every(x => x.ok), 'and the real source passes')
})
