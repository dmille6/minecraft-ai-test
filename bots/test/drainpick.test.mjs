// DRAINPICK-01 (furnace_drain half): THE DRAIN IS NOT OFFERED WHERE IT CANNOT HELP.
//
// MEASURED 24 h to 11-01 21:38Z (80 bots, 125 town furnaces, 1,861,617 skill rows walked): 3,227 furnace_drain orders, 4 took
// anything. 1,897 found the furnace empty (365 bot-min) and 1,012 failed "could not be reached" (180 bot-min); joined to the
// town ledger: 1,156 empties walked past a TOWNMATE's empty entry 1-6 h old (furnaceseen-01 trusted it 60 min), 274 past
// the bot's OWN empty entry (its in-process memory dies at every restart, ~9 a bot a day), ~190 past a smelt's LOAD entry
// whose smelt then emptied the furnace and said nothing; 902 of the unreachable started > 8 blocks BELOW the furnace (a mine
// under town; median 0.7 s, 1 block moved). So:
//   1. an attributed empty entry -- a townmate's OR this bot's own -- is trusted 6 h (the own memory's life), unless newer
//      evidence contradicts it (a load or open entry after it, this bot's lit sighting, its own later look holding items);
//   2. a smelt whose close is readable and EMPTY writes a `close` entry (state empty), so the load's `holds` is superseded;
//   3. no furnace is a candidate while the bot is > DRAIN_BELOW_MAX blocks below it.
// None of these is a refusal with a remedy to name: each removes an ORDER that would have walked to nothing (no cost), and the
// drain is offered again as soon as the evidence changes (a load) or the bot is back on the town's level.
process.env.LOG_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mcbot-drainpick-logs-'))
process.env.BOT_NAME = 'DrainBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.MEMORY_SCOPE = 'shared'
process.env.MEMORY_POOL = 'drainpick-test'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mcbot-drainpick-pool-'))
delete process.env.FURNACE_SEEN
delete process.env.LEDGER

import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const SJ = await import('../src/smeltjob.mjs')
const L = await import('../src/ledger.mjs')
const S = await import('../src/skills.mjs')
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')

const MIN = 60_000
const HK = '0_64_0'
const POOL = process.env.POOL_STATE_DIR
const fid = mcData.blocksByName.furnace.id
const NEAR = new Vec3(2, 64, 0), FAR = new Vec3(9, 64, 0)
function world ({ furnaces = [NEAR, FAR], at = new Vec3(1, 64, 0), name = 'DrainBot', window = () => ({ in: null, fuel: null, out: null }) } = {}) {
  const w = {
    entity: { position: at, velocity: { y: 0 } }, username: name, health: 20, food: 20, registry: mcData, worldId: null,
    inventory: { items: () => [] },
    findBlocks: () => furnaces,
    blockAt: p => (furnaces.some(q => q.equals(p)) ? { type: fid, name: 'furnace', position: p, getProperties: () => ({ lit: false }) } : { type: 0, name: 'air', position: p }),
    lookAt: async () => {}, pathfinder: { goto: async g => { w.entity.position = new Vec3(g.x, g.y, g.z) }, setGoal () {}, stop () {} },
    openFurnace: async b => { w.opened = (w.opened ?? 0) + 1; const s = window(b.position); return { inputItem: () => s.in, fuelItem: () => s.fuel, outputItem: () => s.out, fuel: 0, close () {} } },
  }
  return w
}
const clearLedger = () => { for (const n of fs.readdirSync(POOL)) if (n.startsWith('ledger-')) fs.unlinkSync(path.join(POOL, n)) }
const entry = (f, at, bot, { phase = 'open', by = 'drain', slots = L.furnaceSlots({}) } = {}) =>
  L.recordStation(POOL, HK, null, { id: `${bot}-${phase}-${at}`, f, bot, by, phase, slots, at })
const HOLDS = L.furnaceSlots({ input: { name: 'raw_copper', count: 8 }, fuel: { name: 'coal', count: 1 } })

// ---- 3. below the furnace ------------------------------------------------------------------------------------------------
test('drainPick: a furnace more than DRAIN_BELOW_MAX above the bot is not a candidate; at the bound it is; unknown height is', () => {
  const F = (k, above) => ({ k, dist: 5, lit: false, above })
  assert.equal(SJ.DRAIN_BELOW_MAX, 8)
  assert.equal(SJ.drainPick({ furnaces: [F('a', 9)] }), null)
  assert.equal(SJ.drainPick({ furnaces: [F('a', 8)] })?.k, 'a')
  assert.equal(SJ.drainPick({ furnaces: [F('a', -20)] })?.k, 'a', 'the bot above the furnace (a tower) is the town-level rule\'s, not this one')
  assert.equal(SJ.drainPick({ furnaces: [F('a', null)] })?.k, 'a')
  const d = SJ.drainOrder({ now: 1e9, on: true, atTown: true, holds: false, freeSlots: 5, pick: () => SJ.drainPick({ furnaces: [F('a', 26)] }), state: {} })
  assert.deepEqual([d.order, d.skip], [null, 'nothing_to_drain'], 'the ORDER is not issued for a bot 26 below (the median of the unreachable)')
})
test('townFurnaces carries `above` from the bot\'s own height; drainPickNow from a mine 20 below picks nothing, from town level the near furnace', () => {
  clearLedger(); L.resetLedgerCap()
  const deep = world({ at: new Vec3(1, 44, 0) })
  assert.deepEqual(S.townFurnaces(deep).map(f => f.above), [20, 20])
  assert.equal(S.drainPickNow(deep, Date.now()).pick, null)
  assert.equal(S.drainPickNow(world(), Date.now()).pick?.k, '2,64,0', 'positive control: the same town from its level')
})

// ---- 1. the ledger's empty entries, 6 h, own included ---------------------------------------------------------------------
test('A RESTART: this bot\'s OWN empty entry 40 min ago, no memory of it (a fresh bot object) -> not walked to; the far furnace is', () => {
  clearLedger(); L.resetLedgerCap()
  const now = Date.now()
  entry('2,64,0', now - 40 * MIN, 'DrainBot')
  const p = S.drainPickNow(world(), now)
  assert.equal(p.pick?.k, '9,64,0')
  assert.equal(SJ.seenSkip({ entry: { id: 'x', at: now - 40 * MIN, bot: 'DrainBot', state: 'empty' }, me: 'DrainBot', now }).why, 'own_empty')
})
test('A TOWNMATE\'S EMPTY 3 h ago is trusted (it was walked to at 60 min); 7 h ago it is not', () => {
  clearLedger(); L.resetLedgerCap()
  const now = Date.now()
  entry('2,64,0', now - 180 * MIN, 'Mate')
  assert.equal(S.drainPickNow(world(), now).pick?.k, '9,64,0')
  clearLedger(); L.resetLedgerCap()
  entry('2,64,0', now - 420 * MIN, 'Mate')
  assert.equal(S.drainPickNow(world(), now).pick?.k, '2,64,0')
})
test('CONTRARY EVIDENCE STILL WINS: a smelt LOAD after the empty (any bot) -> walked to; then that smelt\'s emptied CLOSE -> not', () => {
  clearLedger(); L.resetLedgerCap()
  const now = Date.now()
  entry('2,64,0', now - 120 * MIN, 'Mate')
  entry('2,64,0', now - 30 * MIN, 'Smelter', { phase: 'load', by: 'smelt_town', slots: HOLDS })
  assert.equal(S.drainPickNow(world(), now).pick?.k, '2,64,0', 'loaded since: may hold a stopped smelt\'s items')
  entry('2,64,0', now - 28 * MIN, 'Smelter', { phase: 'close', by: 'smelt_town' })
  assert.equal(S.drainPickNow(world(), now).pick?.k, '9,64,0', 'the smelt said it left it empty')
})
test('THE REAL DRAIN after a restart: no walk, no open, no_target -- and the same drain with no ledger entry opens and finds it empty (positive control)', async () => {
  clearLedger(); L.resetLedgerCap()
  const now = Date.now()
  entry('2,64,0', now - 40 * MIN, 'DrainBot'); entry('9,64,0', now - 40 * MIN, 'Mate')
  const w = world()
  const r = await S.SKILLS.furnace_drain.run({ bot: w }, {}, null)
  assert.equal(r.stop, 'no_target'); assert.equal(w.opened ?? 0, 0)
  clearLedger(); L.resetLedgerCap()
  const w2 = world()
  const r2 = await S.SKILLS.furnace_drain.run({ bot: w2 }, {}, null)
  assert.equal(r2.stop, 'empty'); assert.equal(w2.opened, 1)
  // and the bot's next drain (its memory and the ledger both say empty) picks the far one
  assert.equal(S.drainPickNow(w2, Date.now()).pick?.k, '9,64,0')
})
test('A FURNACE THAT HOLDS ITEMS is still drained (the drain\'s purpose): an entry saying `holds`, any age, is walked to and emptied', async () => {
  clearLedger(); L.resetLedgerCap()
  const now = Date.now()
  entry('2,64,0', now - 200 * MIN, 'Mate', { slots: L.furnaceSlots({ output: { name: 'copper_ingot', count: 3 } }) })
  const w = world({ furnaces: [NEAR], window: () => ({ in: null, fuel: null, out: { name: 'copper_ingot', count: 3, type: mcData.itemsByName.copper_ingot.id } }) })
  assert.equal(S.drainPickNow(w, now).pick?.k, '2,64,0')
})

// ---- 4. a furnace this bot cannot reach (the showcase's buried four) --------------------------------------------------------
test('drainPick: a furnace this bot could not reach is not its candidate for DRAIN_UNREACHABLE_MS; then it is again', () => {
  const F = k => ({ k, dist: 5, lit: false, above: 0 })
  const m = SJ.noteFurnaceUnreachable({}, 'a', 1e9)
  assert.equal(SJ.drainPick({ furnaces: [F('a'), F('b')], now: 1e9 + 1, unreachable: m }).k, 'b')
  assert.equal(SJ.drainPick({ furnaces: [F('a')], now: 1e9 + SJ.DRAIN_UNREACHABLE_MS - 1, unreachable: m }), null)
  assert.equal(SJ.drainPick({ furnaces: [F('a')], now: 1e9 + SJ.DRAIN_UNREACHABLE_MS, unreachable: m }).k, 'a')
  assert.deepEqual(Object.keys(SJ.noteFurnaceUnreachable(m, 'c', 1e9 + SJ.DRAIN_UNREACHABLE_MS + 1)), ['c'], 'expired entries are dropped')
})
test('THE REAL DRAIN: a walk that cannot arrive fails unreachable ONCE -- the next pick is the other furnace, not the same one after the backoff', async () => {
  clearLedger(); L.resetLedgerCap()
  const w = world()
  w.pathfinder.goto = async () => {}          // the walk resolves without moving: the furnace stays out of reach
  w.entity.position = new Vec3(-20, 64, 0)    // 22 blocks from the near furnace, in town
  const r = await S.SKILLS.furnace_drain.run({ bot: w }, {}, null)
  assert.equal(r.stop, 'unreachable'); assert.equal(r.status, 'failed')
  assert.equal(S.drainPickNow(w, Date.now()).pick?.k, '9,64,0', 'the next drain goes to the far one')
  assert.equal(S.drainPickNow(w, Date.now() + SJ.DRAIN_UNREACHABLE_MS + 1000).pick?.k, '2,64,0', 'after 12 h the near one is tried again')
  assert.equal(S.drainPickNow(world(), Date.now()).pick?.k, '2,64,0', 'positive control: another bot (no memory) still picks it')
})

// ---- mutants (anchors present and unique) ---------------------------------------------------------------------------------
const SJ_PATH = new URL('../src/smeltjob.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 60))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
test('MUTANT KILLED: without the below rule, the bot 26 below is offered the drain', async () => {
  await withMutant(SJ_PATH, 'if (Number.isFinite(f.above) && f.above > DRAIN_BELOW_MAX) continue', '', async M => {
    assert.equal(M.drainPick({ furnaces: [{ k: 'a', dist: 5, lit: false, above: 26 }] })?.k, 'a')
  })
})
test('MUTANT KILLED: without the unreachable skip, the bot walks to the same unreachable furnace again', async () => {
  await withMutant(SJ_PATH, 'if (Number(unreachable?.[f.k]) > now) continue', '', async M => {
    const m = M.noteFurnaceUnreachable({}, 'a', 1e9)
    assert.equal(M.drainPick({ furnaces: [{ k: 'a', dist: 5, lit: false, above: 0 }], now: 1e9 + 1, unreachable: m })?.k, 'a')
  })
})
test('MUTANT KILLED: own entries excluded again (the base) -> the restart case walks to its own empty furnace', async () => {
  await withMutant(SJ_PATH, "if (!entry.bot) return { skip: false, why: 'no_bot' }",
    "if (!entry.bot || entry.bot === me) return { skip: false, why: 'own_entry' }", async M => {
      assert.equal(M.seenSkip({ entry: { id: 'x', at: 1e9 - 40 * MIN, bot: 'Me', state: 'empty' }, me: 'Me', now: 1e9 }).skip, false)
    })
})
test('MUTANT KILLED: the 60-min trust (the base) -> a townmate\'s 3 h empty is walked to', async () => {
  await withMutant(SJ_PATH, 'export const SEEN_EMPTY_MS = DRAIN_EMPTY_TTL_MS', 'export const SEEN_EMPTY_MS = 60 * 60 * 1000', async M => {
    assert.equal(M.seenSkip({ entry: { id: 'x', at: 1e9 - 180 * MIN, bot: 'Mate', state: 'empty' }, me: 'Me', now: 1e9 }).skip, false)
  })
})
