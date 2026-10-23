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
const { fakeWorld, stack } = await import('./fakeworld.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const RECS = []
tapRecords(r => RECS.push(r))
const lastRow = () => [...RECS].reverse().find(r => r.skill?.name === '_mats_return')?.skill?.detail ?? ''
const field = (d, k) => (d.match(new RegExp(`(?:^| )${k}=(\\S+)`)) ?? [])[1]

const BAG0 = { stone: 0, stone_bricks: 0, cobblestone: 0, oak_log: 0, oak_planks: 0 }
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
