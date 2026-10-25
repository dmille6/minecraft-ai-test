// mats-01: THE RECOVERY CHAIN THROUGH THE REAL deposit() (Claude r1 BLOCKER: the note never closed on leftovers). An open
// bricks note at town, the bag holding the bricks it made plus the leftovers a short session leaves -- 3 stone (a remainder
// under four), cobblestone and planks it did not spend. mats_return banks the bricks through the real deposit (its stock
// keeps, its scaffold reserve, its cobble rule) and the note CLOSES: leftovers are booked, never owed. The control: the same
// note with the chest full -> the bricks stay in the bag and the note stays open (the instrument can see an open note).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-mats-return-logs-'))
process.env.BOT_NAME = 'MatsReturnBot'
process.env.MEMORY_SCOPE = 'shared'
process.env.MEMORY_POOL = 'mats-return'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-mats-return-pool-'))
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
delete process.env.MATS

import assert from 'node:assert/strict'
import test from 'node:test'
const S = await import('../src/skills.mjs')
const TI = await import('../src/townindex.mjs')
const { EventEmitter } = await import('node:events')
const { fakeWorld, stack } = await import('./fakeworld.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const RECS = []
tapRecords(r => RECS.push(r))
const lastRow = () => [...RECS].reverse().find(r => r.skill?.name === '_mats_return')?.skill?.detail ?? ''
const field = (d, k) => (d.match(new RegExp(`(?:^| )${k}=(\\S+)`)) ?? [])[1]

const BAG0 = { stone: 0, stone_bricks: 0, cobblestone: 0, oak_log: 0, oak_planks: 0 }
const note0 = () => ({ v: 1, bot: 'MatsReturnBot', took: {}, fromBag: {}, at: Date.now(), furnace: null, loaded: null, tries: 0 })
const note = () => ({ v: 1, bot: 'MatsReturnBot', kind: 'bricks', took: { cobblestone: 16, oak_log: 2 }, fromBag: {}, bag0: BAG0, at: Date.now(), phase: 'open', furnace: null, loaded: null, tries: 0 })
const count = (w, n) => w.bot.inventory.items().filter(it => it.name === n).reduce((t, it) => t + it.count, 0)
const inChest = (w, n) => w.containers.get('5,64,0').slots.filter(Boolean).filter(it => it.name === n).reduce((t, it) => t + it.count, 0)

function town ({ full = false, second = false, bag = null } = {}) {
  const w = fakeWorld({ bag: bag ?? [stack('stone_bricks', 8), stack('stone', 3), stack('cobblestone', 4), stack('oak_planks', 3), stack('wooden_pickaxe', 1)], at: [6.5, 64, 0.5] })
  w.bot.username = 'MatsReturnBot'
  w.set(5, 64, 0, 'chest')
  if (full) w.fill(5, 64, 0, 'dirt')
  if (second) w.set(11, 64, 0, 'chest')
  return w
}
const inChestAt = (w, k, n) => w.containers.get(k).slots.filter(Boolean).filter(it => it.name === n).reduce((t, it) => t + it.count, 0)
const FURN = '3,64,3'
const LOADED = { furnace: FURN, input: { name: 'cobblestone', n: 12 }, fuel: { name: 'oak_planks', n: 8 }, out: 'stone', prior: 0, inputAfter: 4 }
const run = w => S.SKILLS.mats_return.run({ bot: w.bot }, {}, new AbortController().signal)

test('RECOVERY CHAIN: the bricks banked through the real deposit, the leftovers kept and booked, the note CLOSED', async () => {
  const w = town()
  S.writeMatsNote(w.bot, note())
  const r = await run(w)
  assert.equal(inChest(w, 'stone_bricks'), 8, `the bricks reached the chest: ${JSON.stringify(r)}`)
  assert.equal(count(w, 'stone_bricks'), 0)
  assert.equal(count(w, 'stone'), 3, 'a 1-3 remainder is ordinary stone, not banked as a part')
  assert.equal(count(w, 'cobblestone') + inChest(w, 'cobblestone'), 4, 'the unspent cobble is not lost')
  assert.equal(S.readMatsNote(w.bot), null, `the note closed: ${r.detail}`)
  assert.equal(r.status, 'success'); assert.equal(r.made, 0)
  const d = lastRow()
  assert.equal(field(d, 'verdict'), 'ok'); assert.equal(field(d, 'stop'), 'closed'); assert.equal(field(d, 'batch'), '0', 'never loaded: nothing in flight')
})

test('RECOVERY CHAIN CONTROL: the chest is full -> the bricks stay in the bag and the note STAYS OPEN (tries counted)', async () => {
  const w = town({ full: true })
  S.writeMatsNote(w.bot, note())
  const r = await run(w)
  assert.equal(count(w, 'stone_bricks'), 8, 'nothing banked')
  const n = S.readMatsNote(w.bot)
  assert.equal(n?.phase, 'open', `the note is still open: ${r.detail}`); assert.equal(n.tries, 1)
  S.writeMatsNote(w.bot, { ...n, phase: 'closed' }); fs.rmSync(path.join(process.env.POOL_STATE_DIR, 'mats-carry-MatsReturnBot.json'), { force: true })
})

test('THE SWEEP (Claude r2 P1-A): the NEAREST chest is full -> the bricks go to the next town container with room; the note closes', async () => {
  const w = town({ full: true, second: true })
  S.writeMatsNote(w.bot, note())
  const r = await run(w)
  assert.equal(inChestAt(w, '11,64,0', 'stone_bricks'), 8, `the second chest took the bricks: ${r.detail}`)
  assert.equal(count(w, 'stone_bricks'), 0)
  assert.equal(S.readMatsNote(w.bot), null, 'the note closed')
})

test('THE ROW\'S BALANCE (Codex r2 P1-4): a loaded batch of 12, 8 bricks and 3 stone back, no input returned -> verdict=loss short=1', async () => {
  const w = town()
  S.writeMatsNote(w.bot, { ...note(), furnace: null, loaded: LOADED })
  await run(w)
  const d = lastRow()
  assert.equal(field(d, 'verdict'), 'loss', d); assert.equal(field(d, 'batch'), '12'); assert.equal(field(d, 'short'), '1'); assert.equal(field(d, 'out'), '11')
  assert.equal(field(d, 'forbidden'), '-')
})

test('ROOM FIRST (Codex r2 P1-1): a full bag never drains the note\'s furnace -- drained=bag_full, the note stays open', async () => {
  const fill = Array.from({ length: 31 }, () => stack('dirt', 64))
  const w = town({ bag: [stack('stone_bricks', 8), stack('stone', 3), stack('cobblestone', 4), stack('oak_planks', 3), stack('wooden_pickaxe', 1), ...fill] })
  w.set(3, 64, 3, 'furnace', { lit: 'false' })
  S.writeMatsNote(w.bot, { ...note(), furnace: FURN, loaded: LOADED })
  await run(w)
  assert.equal(field(lastRow(), 'drained'), 'bag_full'); assert.equal(S.readMatsNote(w.bot)?.phase, 'open')
  fs.rmSync(path.join(process.env.POOL_STATE_DIR, 'mats-carry-MatsReturnBot.json'), { force: true })
})

test('AN UNLOADED CHUNK IS NOT "GONE" (Claude r2 P3-3): no block read at the furnace -> drained=unloaded, the note stays open', async () => {
  const w = town()
  const orig = w.bot.blockAt
  w.bot.blockAt = p => (Math.floor(p.x) === 3 && Math.floor(p.z) === 3 ? null : orig(p))
  S.writeMatsNote(w.bot, { ...note(), furnace: FURN, loaded: LOADED })
  await run(w)
  assert.equal(field(lastRow(), 'drained'), 'unloaded'); assert.equal(S.readMatsNote(w.bot)?.phase, 'open')
  fs.rmSync(path.join(process.env.POOL_STATE_DIR, 'mats-carry-MatsReturnBot.json'), { force: true })
})

test('THE BOUND HOLDS ON AN EXCEPTION (Codex r2 P1-2): a recovery that throws on its sixth try gives the note up; on its first it keeps it', async () => {
  for (const [tries, stop, kept] of [[0, 'error', true], [5, 'abandoned', false]]) {
    const w = town()
    const orig = w.bot.blockAt
    w.bot.blockAt = p => { if (Math.floor(p.x) === 3 && Math.floor(p.z) === 3) throw new Error('chunk read failed'); return orig(p) }
    S.writeMatsNote(w.bot, { ...note(), furnace: FURN, loaded: LOADED, tries })
    const r = await run(w)
    assert.equal(r.status, 'failed')
    assert.equal(field(lastRow(), 'stop'), stop, lastRow()); assert.equal(!!S.readMatsNote(w.bot), kept)
    fs.rmSync(path.join(process.env.POOL_STATE_DIR, 'mats-carry-MatsReturnBot.json'), { force: true })
  }
})

const NOTE_FILE = () => path.join(process.env.POOL_STATE_DIR, 'mats-carry-MatsReturnBot.json')

test('A WAIT IS NOT A TRY, AND NOT A VERDICT (Codex r3 P1-1, Claude r3 P1-1/P2-1): a lit furnace -> verdict=pending, tries unchanged, waits 1', async () => {
  const w = town({ bag: [stack('wooden_pickaxe', 1)] })
  w.set(3, 64, 3, 'furnace', { lit: 'true' })
  S.writeMatsNote(w.bot, { ...note(), furnace: FURN, loaded: LOADED, tries: 2 })
  await run(w)
  const d = lastRow()
  assert.equal(field(d, 'drained'), 'lit'); assert.equal(field(d, 'verdict'), 'pending', d); assert.equal(field(d, 'stop'), 'open')
  const n = S.readMatsNote(w.bot)
  assert.equal(n.tries, 2, 'the wait used no try'); assert.equal(n.waits, 1)
  assert.ok(n.waitUntil > Date.now() + 60_000, 'and it yields until waitUntil (Codex r4 P1): the town deposit gets the decisions')
  fs.rmSync(NOTE_FILE(), { force: true })
})

test('EVERY ATTEMPT\'S BANK IS KEPT (Codex r3 P2-4, Claude r3 P2-2): 4 banked into a near-full town, 8 later -> the closing attempt reads ok (12), not short 8', async () => {
  const w = fakeWorld({ bag: [stack('stone_bricks', 12), stack('wooden_pickaxe', 1)], at: [6.5, 64, 0.5] })
  w.bot.username = 'MatsReturnBot'
  w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0, 'dirt')
  w.containers.get('5,64,0').slots[0] = stack('stone_bricks', 60)
  S.writeMatsNote(w.bot, { ...note(), furnace: null, loaded: { ...LOADED, inputAfter: 0 } })
  await run(w)
  assert.equal(field(lastRow(), 'verdict'), 'pending'); assert.equal(count(w, 'stone_bricks'), 8)
  assert.deepEqual(S.readMatsNote(w.bot)?.deposited, { stone_bricks: 4 })
  // room appears in town -- at a cell no earlier test's index names (11,64,0 is one: this note's first attempt found nothing
  // there and avoids it 30 min, correctly)
  w.set(13, 64, 0, 'chest')
  await run(w)
  const d = lastRow()
  assert.equal(field(d, 'stop'), 'closed', d); assert.equal(field(d, 'verdict'), 'ok', d); assert.equal(field(d, 'out'), '12')
})

test('THE SWEEP PAST THE BOT\'S REACH (Codex r3 P1-2): the two chests in reach are full -> the bricks go to a town chest only the index knows, 18 blocks off', async () => {
  const w = town({ full: true })
  w.set(9, 64, 0, 'chest'); w.fill(9, 64, 0, 'dirt')
  w.set(-12, 64, 0, 'chest')
  const HK = TI.indexHomeKey({ x: 0, y: 64, z: 0 })
  TI.appendIndex(process.env.POOL_STATE_DIR, HK, null, { t: 'obs', id: `o-${Date.now()}`, k: '-12,64,0', h: ['-12,64,0'], at: Date.now(), bot: 'Other', by: 'count_town', names: {}, used: 0, size: 27 })
  TI.resetIndexCache()
  S.writeMatsNote(w.bot, note())
  const r = await run(w)
  assert.equal(inChestAt(w, '-12,64,0', 'stone_bricks'), 8, `the far chest took the bricks: ${r.detail}`)
  assert.equal(S.readMatsNote(w.bot), null)
})

test('PLACEMENTS: an exact -1 on the HELD slot, landing after the block (Claude r3 P2-4, Codex r5 P2-5, Claude r5 P3-1)', async () => {
  const inv = new EventEmitter()
  inv.items = () => []
  const bot = { heldItem: { name: 'cobblestone', slot: 36 }, inventory: inv, placeBlock: async () => {} }
  const pl = S.countPlacements(bot)
  await bot.placeBlock({}, {})
  assert.deepEqual(pl.placed, {}, 'nothing yet: the server has not sent the slot')
  await new Promise(r => setTimeout(r, 60))
  inv.emit('updateSlot', 36, { name: 'cobblestone', count: 10 }, { name: 'cobblestone', count: 9 })
  await new Promise(r => setTimeout(r, 90))
  assert.deepEqual(pl.placed, { cobblestone: 1 }, 'the late -1 on the held slot is the placement')
  inv.emit('updateSlot', 36, { name: 'cobblestone', count: 9 }, { name: 'cobblestone', count: 8 })
  await new Promise(r => setTimeout(r, 90))
  assert.deepEqual(pl.placed, { cobblestone: 1 }, 'a -1 with no placement call is not one')
  // a failed placement, then the stack MOVED in two clicks, source first (the cursor holds it between): never a -1
  await bot.placeBlock({}, {})
  inv.emit('updateSlot', 36, { name: 'cobblestone', count: 8 }, null)
  inv.emit('updateSlot', 40, null, { name: 'cobblestone', count: 8 })
  assert.deepEqual(pl.placed, { cobblestone: 1 }, 'the move credited nothing')
  // a -1 on ANOTHER slot (a craft taking one) after a placement call is not the placement
  await bot.placeBlock({}, {})
  inv.emit('updateSlot', 12, { name: 'cobblestone', count: 5 }, { name: 'cobblestone', count: 4 })
  assert.deepEqual(pl.placed, { cobblestone: 1 }, 'another slot\'s -1 is no placement')
  inv.emit('updateSlot', 36, { name: 'cobblestone', count: 1 }, null)
  await new Promise(r => setTimeout(r, 90))
  assert.deepEqual(pl.placed, { cobblestone: 2 }, 'the last item of the held stack placed (1 -> empty) is a placement')
  // A ONE-ITEM STACK MOVED off the held slot after a failed placement (Codex r6 P3): it lands elsewhere -> no placement
  await bot.placeBlock({}, {})
  inv.emit('updateSlot', 36, { name: 'cobblestone', count: 1 }, null)
  inv.emit('updateSlot', 41, null, { name: 'cobblestone', count: 1 })
  await new Promise(r => setTimeout(r, 90))
  assert.deepEqual(pl.placed, { cobblestone: 2 }, 'the singleton move credited nothing')
  // A -1 THAT LANDS RIGHT BEFORE THE BALANCE (Codex r7 P2): settle() waits out the deferral, so the balance sees it
  await bot.placeBlock({}, {})
  inv.emit('updateSlot', 36, { name: 'cobblestone', count: 7 }, { name: 'cobblestone', count: 6 })
  await pl.settle()
  assert.deepEqual(pl.placed, { cobblestone: 3 }, 'settled before the balance reads it')
  // A SECOND -1 LANDING INSIDE THE FIRST WAIT (Claude r8 P3-B): settle waits until nothing is pending
  await bot.placeBlock({}, {}); await bot.placeBlock({}, {})
  inv.emit('updateSlot', 36, { name: 'cobblestone', count: 6 }, { name: 'cobblestone', count: 5 })
  setTimeout(() => inv.emit('updateSlot', 36, { name: 'cobblestone', count: 5 }, { name: 'cobblestone', count: 4 }), 40)
  await pl.settle()
  assert.deepEqual(pl.placed, { cobblestone: 5 }, 'both credits settled')
  pl.restore()
  assert.equal(inv.listenerCount('updateSlot'), 0, 'restored: no listener left')
})

test('AN ABORT MID-SWEEP KEEPS WHAT LANDED (Codex r4 P2-2): 4 into the first chest, the walk to the second aborted -> the note holds deposited 4', async () => {
  const w = fakeWorld({ bag: [stack('stone_bricks', 12), stack('wooden_pickaxe', 1)], at: [6.5, 64, 0.5] })
  w.bot.username = 'MatsReturnBot'
  w.set(5, 64, 0, 'chest'); w.fill(5, 64, 0, 'dirt'); w.containers.get('5,64,0').slots[0] = stack('stone_bricks', 60)
  w.set(9, 64, 0, 'chest')
  const ac = new AbortController()
  const goto0 = w.bot.pathfinder.goto.bind(w.bot.pathfinder)
  let walks = 0
  w.bot.pathfinder.goto = async goal => { if (goal.x === 9 && ++walks) { ac.abort(); throw Object.assign(new Error('aborted'), { aborted: true }) } return goto0(goal) }
  S.writeMatsNote(w.bot, { ...note(), furnace: null, loaded: { ...LOADED, inputAfter: 0 } })
  await S.SKILLS.mats_return.run({ bot: w.bot }, {}, ac.signal).catch(() => {})
  assert.ok(walks >= 1, 'the walk to the second chest was the one aborted')
  assert.deepEqual(S.readMatsNote(w.bot)?.deposited, { stone_bricks: 4 })
  fs.rmSync(NOTE_FILE(), { force: true })
})

test('A VANISHED INDEX ENTRY IS NEVER A DEPOSIT ELSEWHERE (Codex r5 P2-3): the only container is outside town; the index names a gone one -> nothing banked', async () => {
  const w = fakeWorld({ bag: [stack('stone_bricks', 8), stack('wooden_pickaxe', 1)], at: [6.5, 64, 0.5] })
  w.bot.username = 'MatsReturnBot'
  w.set(20, 64, 0, 'chest')                                             // 20 from home: outside the town's 16
  const HK = TI.indexHomeKey({ x: 0, y: 64, z: 0 })
  TI.appendIndex(process.env.POOL_STATE_DIR, HK, null, { t: 'obs', id: `o-gone-${Date.now()}`, k: '-14,64,2', h: ['-14,64,2'], at: Date.now(), bot: 'Other', by: 'count_town', names: {}, used: 0, size: 27 })
  TI.resetIndexCache()
  S.writeMatsNote(w.bot, note())
  await run(w)
  assert.equal(inChestAt(w, '20,64,0', 'stone_bricks'), 0, 'nothing went to the out-of-town chest')
  assert.equal(count(w, 'stone_bricks'), 8); assert.equal(S.readMatsNote(w.bot)?.phase, 'open')
  fs.rmSync(NOTE_FILE(), { force: true })
})

test('MATS-01 x JUNKOUT-01 (re-stack 10-25): an open note\'s torches are HELD -- junkout\'s tail never banks them; released at the close', async () => {
  const TD = await import('../src/towndeposit.mjs')
  const BK = await import('../src/bankable.mjs')
  BK.clearWithdrawHolds()
  const bag = [{ name: 'torch', count: 16, slot: 9 }, { name: 'oak_log', count: 2, slot: 10 }]
  const tailNames = () => TD.townDepositPlan(bag, { tail: 'only', bagAllowance: true }).steps.map(st => st.name)
  assert.ok(tailNames().includes('torch'), 'positive control: with no note the tail banks the torches')
  const note = { ...note0(), kind: 'torch', bag0: { torch: 0, charcoal: 0, stick: 0 }, phase: 'open' }
  const bot = { inventory: { items: () => bag } }
  S.matsHoldNote(bot, note)
  assert.equal(BK.withdrawHolds().torch, 16)
  assert.ok(!tailNames().includes('torch'), 'held: the tail leaves the note\'s torches for the recovery')
  S.matsReleaseNote(note)
  assert.ok(tailNames().includes('torch'), 'released at the close')
})
