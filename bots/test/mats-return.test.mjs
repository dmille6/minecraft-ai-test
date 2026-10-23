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

const BAG0 = { stone: 0, stone_bricks: 0, cobblestone: 0, oak_log: 0, oak_planks: 0 }
const note = () => ({ v: 1, bot: 'MatsReturnBot', kind: 'bricks', took: { cobblestone: 16, oak_log: 2 }, fromBag: {}, bag0: BAG0, at: Date.now(), phase: 'open', furnace: null, loaded: null, tries: 0 })
const count = (w, n) => w.bot.inventory.items().filter(it => it.name === n).reduce((t, it) => t + it.count, 0)
const inChest = (w, n) => w.containers.get('5,64,0').slots.filter(Boolean).filter(it => it.name === n).reduce((t, it) => t + it.count, 0)

function town ({ full = false } = {}) {
  const w = fakeWorld({ bag: [stack('stone_bricks', 8), stack('stone', 3), stack('cobblestone', 4), stack('oak_planks', 3), stack('wooden_pickaxe', 1)], at: [6.5, 64, 0.5] })
  w.bot.username = 'MatsReturnBot'
  w.set(5, 64, 0, 'chest')
  if (full) w.fill(5, 64, 0, 'dirt')
  return w
}
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
})

test('RECOVERY CHAIN CONTROL: the chest is full -> the bricks stay in the bag and the note STAYS OPEN (tries counted)', async () => {
  const w = town({ full: true })
  S.writeMatsNote(w.bot, note())
  const r = await run(w)
  assert.equal(count(w, 'stone_bricks'), 8, 'nothing banked')
  const n = S.readMatsNote(w.bot)
  assert.equal(n?.phase, 'open', `the note is still open: ${r.detail}`); assert.equal(n.tries, 1)
  fs.rmSync(path.join(process.env.POOL_STATE_DIR), { recursive: true, force: true })
})
