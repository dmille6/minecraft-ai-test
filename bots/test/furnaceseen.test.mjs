// FURNACESEEN-01: the furnace drain skips a walk to a furnace a TOWNMATE found empty < 60 min ago (the town ledger, ledger-01),
// unless newer contrary evidence exists (cooperation-tier design r9.1, docs/reports/cooperation-tier-2026-10-23.md 6.3 B3, 6.4).
// Behaviour first: the skip is ONE pure exported function of exactly the inputs the drain logs (seenSkip), driven by truth
// table; the pick and the ORDER consult it (a skipped furnace is never ordered and then refused); drainPickNow against a real
// ledger directory (a townmate's empty, a later load, a lit sighting, an append racing the pick); the REAL furnace_drain in a
// fake world (it walks to the other furnace and logs its inputs, which replay to "walk"); the golden table the read's Python
// port must reproduce; FURNACE_SEEN=off. The one structural invariant (the order path calls the shared pick) with an anchored
// mutant.
process.env.LOG_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mcbot-fseen-logs-'))
process.env.BOT_NAME = 'SeenBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.MEMORY_SCOPE = 'shared'
process.env.MEMORY_POOL = 'fseen-test'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'
process.env.POOL_STATE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mcbot-fseen-pool-'))
delete process.env.FURNACE_SEEN
delete process.env.LEDGER

import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const SJ = await import('../src/smeltjob.mjs')
const L = await import('../src/ledger.mjs')
const S = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const { Vec3 } = require_('vec3')

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0)
const MIN = 60_000
const HK = '0_64_0'
const POOL = process.env.POOL_STATE_DIR
const E = (over = {}) => ({ id: 'mate-1', at: NOW - 10 * MIN, bot: 'Mate', state: 'empty', ...over })

// ---- the pure skip -------------------------------------------------------------------------------------------------
/** THE TRUTH TABLE: [name, inputs, skip, why]. bots/test/fixtures/seenskip-golden.json is this table; the read's Python port
 *  (scripts/host/furnaceseenread.py seen_skip) asserts it reproduces every row. */
const TABLE = [
  ['a townmate\'s empty 10 min ago', { entry: E(), me: 'Me', now: NOW }, true, 'townmate_empty'],
  ['no entry', { entry: null, me: 'Me', now: NOW }, false, 'no_entry'],
  ['the newest entry holds items (a load after the empty)', { entry: E({ state: 'holds' }), me: 'Me', now: NOW }, false, 'entry_not_empty'],
  ['the newest entry is lit', { entry: E({ state: 'lit' }), me: 'Me', now: NOW }, false, 'entry_not_empty'],
  ['my own empty entry (my memory rules for my findings)', { entry: E({ bot: 'Me' }), me: 'Me', now: NOW }, false, 'own_entry'],
  ['59:59 old: still trusted', { entry: E({ at: NOW - SJ.SEEN_EMPTY_MS + 1 }), me: 'Me', now: NOW }, true, 'townmate_empty'],
  ['60:00 old: expired', { entry: E({ at: NOW - SJ.SEEN_EMPTY_MS }), me: 'Me', now: NOW }, false, 'expired'],
  ['from the future (> 1 min): never trusted', { entry: E({ at: NOW + 2 * MIN }), me: 'Me', now: NOW }, false, 'expired'],
  ['I saw it LIT after the empty', { entry: E(), litAt: NOW - 5 * MIN, me: 'Me', now: NOW }, false, 'lit_since'],
  ['I saw it lit BEFORE the empty', { entry: E(), litAt: NOW - 20 * MIN, me: 'Me', now: NOW }, true, 'townmate_empty'],
  ['my own later look found items', { entry: E(), own: { empty: false, at: NOW - 5 * MIN, litSince: false }, me: 'Me', now: NOW }, false, 'own_newer_holds'],
  ['my own EARLIER look found items', { entry: E(), own: { empty: false, at: NOW - 30 * MIN, litSince: false }, me: 'Me', now: NOW }, true, 'townmate_empty'],
  ['my own later look found it empty too', { entry: E(), own: { empty: true, at: NOW - 5 * MIN, litSince: false }, me: 'Me', now: NOW }, true, 'townmate_empty'],
  ['an entry with no bot (unattributable)', { entry: E({ bot: null }), me: 'Me', now: NOW }, false, 'own_entry'],
]
test('THE SKIP, truth table: skip only a TOWNMATE\'s EMPTY newest entry < 60 min, with no newer lit sighting or own contrary look', () => {
  for (const [name, inp, skip, why] of TABLE) assert.deepEqual(SJ.seenSkip(inp), { skip, why }, name)
})
test('the GOLDEN table the read\'s Python port replays is exactly this function\'s output (a change to either fails here or there)', () => {
  const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/seenskip-golden.json', import.meta.url), 'utf8'))
  assert.equal(golden.rows.length, TABLE.length)
  for (const g of golden.rows) assert.deepEqual(SJ.seenSkip(g.inputs), g.out, g.name)
  assert.equal(golden.SEEN_EMPTY_MS, SJ.SEEN_EMPTY_MS)
})
test('the logged inputs (se= sl= so= off=) carry everything the replay needs, in one format', () => {
  assert.equal(SJ.seenFields({ entry: E(), litAt: NOW, own: { empty: true, at: NOW - 1 }, off: '1:2048' }), `se=mate-1 sl=${NOW} so=e:${NOW - 1} off=1:2048`)
  assert.equal(SJ.seenFields({}), 'se=- sl=- so=- off=-')
  assert.match(SJ.furnaceSeenModeDetail(), /^phase=mode on=on v=1 ttl_min=60 rule=townmate_empty$/)
})

// ---- the pick and the order consult the same rule -----------------------------------------------------------------
test('the pick skips a furnace the rule skips and takes the next; all skipped -> no pick -> the ORDER says nothing_to_drain (never ordered then refused)', () => {
  const F = (k, dist) => ({ k, dist, lit: false })
  const skip = f => f.k === 'near'
  assert.equal(SJ.drainPick({ furnaces: [F('near', 3), F('far', 20)], now: NOW, skip }).k, 'far')
  assert.equal(SJ.drainPick({ furnaces: [F('near', 3)], now: NOW, skip }), null)
  const d = SJ.drainOrder({ now: NOW, on: true, atTown: true, holds: false, freeSlots: 4, pick: () => SJ.drainPick({ furnaces: [F('near', 3)], now: NOW, skip }), state: {} })
  assert.equal(d.order, null); assert.equal(d.skip, 'nothing_to_drain')
  assert.equal(SJ.drainPick({ furnaces: [F('near', 3), F('far', 20)], now: NOW }).k, 'near', 'without the rule: the base pick')
})

// ---- against a real ledger directory -------------------------------------------------------------------------------
const fid = mcData.blocksByName.furnace.id
const NEAR = new Vec3(2, 64, 0), FAR = new Vec3(9, 64, 0)
function world ({ furnaces = [NEAR, FAR], lit = [], window = () => ({ in: null, fuel: null, out: null }) } = {}) {
  const isLit = p => lit.some(q => q.equals(p))
  const w = {
    entity: { position: new Vec3(1, 64, 0), velocity: { y: 0 } }, username: 'SeenBot', health: 20, food: 20, registry: mcData, worldId: null,
    inventory: { items: () => [] },
    findBlocks: () => furnaces,
    blockAt: p => (furnaces.some(q => q.equals(p)) ? { type: fid, name: 'furnace', position: p, getProperties: () => ({ lit: isLit(p) }) } : { type: 0, name: 'air', position: p }),
    lookAt: async () => {}, pathfinder: { goto: async g => { w.entity.position = new Vec3(g.x, g.y, g.z) }, setGoal () {}, stop () {} },
    openFurnace: async b => { const s = window(b.position); return { inputItem: () => s.in, fuelItem: () => s.fuel, outputItem: () => s.out, fuel: 0, close () {} } },
  }
  return w
}
const clearLedger = () => { for (const n of fs.readdirSync(POOL)) if (n.startsWith('ledger-')) fs.unlinkSync(path.join(POOL, n)) }
const mateEmpty = (f, at, bot = 'Mate', slots = L.furnaceSlots({})) => L.recordStation(POOL, HK, null, { id: `${bot}-${at}`, f, bot, by: 'drain', phase: 'open', slots, at })
const tap = () => { const rows = []; const un = tapRecords(r => rows.push(r)); return { rows, un } }

test('drainPickNow: a townmate\'s empty entry on the NEAR furnace sends the pick to the FAR one, logs ONE skip row per entry with its inputs; a later LOAD entry ends the skip', () => {
  clearLedger(); L.resetLedgerCap()
  const now = Date.now()
  mateEmpty('2,64,0', now - 5 * MIN)
  const bot = world()
  const { rows, un } = tap()
  let p1, p2
  try { p1 = S.drainPickNow(bot, now); p2 = S.drainPickNow(bot, now + 1000) } finally { un() }
  assert.equal(p1.pick.k, '9,64,0'); assert.equal(p2.pick.k, '9,64,0')
  const skips = rows.filter(r => r?.skill?.name === '_furnace_seen_skip')
  assert.equal(skips.length, 1, 'one row per (furnace, entry), not one per decision')
  assert.match(skips[0].skill.detail, new RegExp(`^f=2,64,0 why=townmate_empty now=${now} changed=1 se=Mate-${now - 5 * MIN} sl=- so=- off=1:\\d+$`))
  assert.equal(p1.inputs.entry, null, 'the far furnace has no entry: the pick relied on nothing')
  // a smelt LOADS the near furnace: the newest entry holds items -> walk again
  L.recordStation(POOL, HK, null, { id: 'Smelter-load', f: '2,64,0', bot: 'Smelter', by: 'smelt_town', phase: 'load', slots: L.furnaceSlots({ input: { name: 'raw_copper', count: 8 }, fuel: { name: 'coal', count: 1 } }), at: now + 2000 })
  assert.equal(S.drainPickNow(bot, now + 3000).pick.k, '2,64,0')
})

test('a LIT sighting by this bot after the townmate\'s empty: the furnace is walked to (not a defect; the read replays it as a walk)', () => {
  clearLedger(); L.resetLedgerCap()
  const now = Date.now()
  mateEmpty('2,64,0', now - 20 * MIN)
  const bot = world({ lit: [NEAR] })
  S.drainPickNow(bot, now - 10 * MIN)          // the furnace is seen lit (block state): litAt recorded, it is not a candidate now
  const unlit = world(); unlit.furnaceSeen = bot.furnaceSeen; unlit.furnaceLitAt = bot.furnaceLitAt
  const p = S.drainPickNow(unlit, now)
  assert.equal(p.pick.k, '2,64,0'); assert.equal(p.inputs.litAt, now - 10 * MIN)
  assert.deepEqual(SJ.seenSkip({ ...p.inputs, me: 'SeenBot', now }), { skip: false, why: 'lit_since' })
})

test('AN APPEND RACING THE PICK: an empty entry written after the pick read the fold is not used, and the logged offset shows it (reported by the read, not a defect)', () => {
  clearLedger(); L.resetLedgerCap()
  const now = Date.now()
  mateEmpty('9,64,0', now - 50 * MIN, 'Old')      // something in the file
  const bot = world()
  const p = S.drainPickNow(bot, now)
  assert.equal(p.pick.k, '2,64,0')
  const off = Number(p.inputs.off.split(':')[1])
  mateEmpty('2,64,0', now + 100)                   // a townmate's empty lands just after the pick
  const size = fs.statSync(L.ledgerFile(POOL, HK, 1)).size
  assert.ok(off < size, `the pick read ${off} of now ${size} bytes`)
  assert.deepEqual(SJ.seenSkip({ ...p.inputs, me: 'SeenBot', now }), { skip: false, why: 'no_entry' }, 'on what it read, walking was right')
})

test('THE REAL DRAIN: it walks to the furnace the rule leaves, its row carries the inputs, and they replay to "walk"', async () => {
  clearLedger(); L.resetLedgerCap()
  const now = Date.now()
  mateEmpty('2,64,0', now - 5 * MIN)
  const bot = world()
  const { rows, un } = tap()
  let r
  try { r = await S.SKILLS.furnace_drain.run({ bot }, {}, null) } finally { un() }
  assert.equal(r.stop, 'empty')
  const row = rows.find(x => x?.skill?.name === '_furnace_drain')
  assert.match(row.skill.detail, /furnace=9,64,0 .* se=- sl=- so=- off=1:\d+$/)
  assert.ok(row.skill.detail.length < 300)
  assert.ok(rows.some(x => x?.skill?.name === '_furnace_seen_skip' && /^f=2,64,0 /.test(x.skill.detail)))
})

test('FURNACE_SEEN=off: the base pick exactly (the near furnace), no skip row, the mode row says on=off', () => {
  const dir = fs.mkdtempSync(path.join(process.env.LOG_DIR, 'off-pool-'))
  const code = `
    const L = await import(${JSON.stringify(new URL('../src/ledger.mjs', import.meta.url).href)});
    const S = await import(${JSON.stringify(new URL('../src/skills.mjs', import.meta.url).href)});
    const SJ = await import(${JSON.stringify(new URL('../src/smeltjob.mjs', import.meta.url).href)});
    const { Vec3 } = (await import('node:module')).createRequire(${JSON.stringify(import.meta.url)})('vec3');
    const mc = (await import('node:module')).createRequire(${JSON.stringify(import.meta.url)})('minecraft-data')('1.21.8');
    const now = Date.now();
    L.recordStation(${JSON.stringify(dir)}, '${HK}', null, { id: 'm', f: '2,64,0', bot: 'Mate', by: 'drain', slots: L.furnaceSlots({}), at: now - 60000 });
    const fs_ = [new Vec3(2, 64, 0), new Vec3(9, 64, 0)];
    const bot = { username: 'SeenBot', registry: mc, findBlocks: () => fs_, blockAt: p => ({ type: mc.blocksByName.furnace.id, position: p, getProperties: () => ({ lit: false }) }) };
    console.log(JSON.stringify({ pick: S.drainPickNow(bot, now).pick?.k, mode: SJ.furnaceSeenModeDetail() }))`
  const p = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, FURNACE_SEEN: 'off', POOL_STATE_DIR: dir }, encoding: 'utf8' })
  assert.equal(p.status, 0, p.stderr)
  const o = JSON.parse(p.stdout.trim().split('\n').at(-1))
  assert.equal(o.pick, '2,64,0'); assert.match(o.mode, /^phase=mode on=off /)
})

// ---- the structural invariant: the order path calls the shared pick -------------------------------------------------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
/** -> true when cognitive.mjs's drain order picks through drainPickNow and never calls drainPick( itself. Pure. */
export const orderUsesSharedPick = src => { const s = strip(src); return /drainOrder\([\s\S]{0,400}?pick:\s*\(\)\s*=>\s*drainPickNow\(bot\)\.pick/.test(s) && !/\bdrainPick\(/.test(s) }
test('STRUCTURAL: the drain ORDER picks through the same drainPickNow as the skill (so a skipped furnace is never ordered), with an anchored mutant', () => {
  const src = fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8')
  assert.equal(orderUsesSharedPick(src), true)
  const old = '              pick: () => drainPickNow(bot).pick,'
  assert.equal(src.split(old).length - 1, 1, 'ANCHOR MISSING or not unique')
  const mut = src.replace(old, '              pick: () => drainPick({ furnaces: townFurnaces(bot), now: Date.now() }),')
  assert.equal(orderUsesSharedPick(mut), false, 'an order path with its own pick: caught')
  const skillSrc = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const body = skillSrc.slice(skillSrc.indexOf('async function furnaceDrain'), skillSrc.indexOf('async function furnaceDrain') + 1200)
  assert.match(body, /drainPickNow\(bot, t0\)/, 'the skill re-picks through it too')
})

// (r6 on 281d5659, fun mode: the lab-mode read furnaceseenread.py and its golden replay are not carried; the generic read applies)

test('EXPOSURE COUNTS ONLY A CHANGED PICK (Claude r1 P2-3): a skipped furnace a nearer clean one would have beaten anyway is changed=0', () => {
  clearLedger(); L.resetLedgerCap()
  const now = Date.now()
  const NEAREST = new Vec3(1, 64, 1), MID = new Vec3(5, 64, 0)
  mateEmpty('5,64,0', now - 5 * MIN)                // the MIDDLE furnace is a townmate's empty; the nearest is clean
  const bot = world({ furnaces: [NEAREST, MID, FAR] })
  const { rows, un } = tap()
  let p
  try { p = S.drainPickNow(bot, now) } finally { un() }
  assert.equal(p.pick.k, '1,64,1', 'the nearest clean furnace, as without the rule')
  const sk = rows.filter(r => r?.skill?.name === '_furnace_seen_skip')
  assert.equal(sk.length, 1); assert.match(sk[0].skill.detail, / changed=0 /, 'the rule saved no walk here')
})
