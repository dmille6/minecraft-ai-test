// COBBLE THE TOWN HAS NO ROOM FOR (cobbleoverflow-01; OWNER 10-16 "yes, junk can take the extra").
// Behaviour only: the pure decisions through their exported functions (the room an open window shows, the fold keeping it,
// the town's room view, the well's switch and its per-stack rule), then the REFUSAL CHAIN through the real deposit skill
// moving cobble through the fake world's vanilla click rules (test/fakeworld.mjs) -- what the deposit banks, what the
// journal then knows, what the well's plan and its order make of it. One structural check (the licence row's wiring),
// comment-stripped, anchored, and shown to fail.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-overflow-logs-'))
process.env.BOT_NAME = 'OverflowBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-overflow-pool-'))

const CC = await import('../src/cobblecap.mjs')
const W = await import('../src/well.mjs')
const CF = await import('../src/chestfull.mjs')
const SK = await import('../src/skills.mjs')
const { SKILLS } = SK
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const it = (name, count, slot) => ({ name, count, slot })
const cobbleIn = items => items.filter(Boolean).reduce((n, x) => n + (/^cobble(stone|d_deepslate)$/.test(x.name) ? x.count : 0), 0)
const counts = stacks => stacks.map(s => `${s.name}:${s.count}`).join(',')
const NOW = 1_000_000_000
const R = (c, d = c) => ({ cobblestone: c, cobbled_deepslate: d })

// ======================================================================================== THE ROOM AN OPEN WINDOW SHOWS
await t('roomOf: an empty slot holds a stack of each name, a partial stack of the same name its remainder, anything else none', () => {
  assert.deepEqual(CC.roomOf([], 27), R(27 * 64), 'an empty chest: 27 stacks of each')
  assert.deepEqual(CC.roomOf(Array.from({ length: 27 }, (_, i) => ({ name: 'stone', count: 64, slot: i })), 27), R(0), 'full of stone: none')
  const one = Array.from({ length: 26 }, (_, i) => ({ name: 'stone', count: 64, slot: i }))
  assert.deepEqual(CC.roomOf(one, 27), R(64), 'one empty slot: one stack')
  assert.deepEqual(CC.roomOf([...one, { name: 'cobblestone', count: 50, slot: 26 }], 27), { cobblestone: 14, cobbled_deepslate: 0 }, 'a partial cobblestone stack: its 14, and nothing for deepslate')
  assert.deepEqual(CC.roomOf([{ name: 'cobbled_deepslate', count: 10, slot: 0 }], 1), { cobblestone: 0, cobbled_deepslate: 54 })
  assert.deepEqual(CC.roomOf([{ name: 'cobblestone', count: 60, stackSize: 64, slot: 0 }, { name: 'cobblestone', count: 60, slot: 1 }], 2), R(8, 0), 'two partial stacks: 4 + 4 (the most any ONE whole stack could use is judged by the caller)')
  // a window that cannot say is NOT a reading
  assert.equal(CC.roomOf([], undefined), null, 'no size')
  assert.equal(CC.roomOf([{ name: 'stone', count: 1, slot: 27 }], 27), null, 'an item outside the container range')
  assert.equal(CC.roomOf([{ name: 'stone', count: 1 }], 27), null, 'an item without a slot')
  assert.deepEqual(CC.roomOf([], 54), R(54 * 64), 'positive control: a double chest')
})

await t('cleanRoom: both names, each a number >= 0, or nothing at all', () => {
  assert.deepEqual(CC.cleanRoom({ cobblestone: 3.7, cobbled_deepslate: 0 }), R(3, 0))
  assert.equal(CC.cleanRoom({ cobblestone: 3 }), null, 'a missing name')
  assert.equal(CC.cleanRoom({ cobblestone: -1, cobbled_deepslate: 0 }), null)
  assert.equal(CC.cleanRoom({ cobblestone: 'x', cobbled_deepslate: 0 }), null)
  assert.equal(CC.cleanRoom(null), null)
})

// ======================================================================================== THE FOLD KEEPS IT
await t('THE FOLD: a count carries its room; a later count without one (an older build) leaves the room UNKNOWN; equal captures keep the LARGER room', () => {
  const st = recs => CC.foldJournal(recs).state
  const a = st([{ t: 'cnt', k: 'a', n: 5, cap: 100, v: 2, m: {}, r: R(0) }])
  assert.deepEqual(a.obs.a.r, R(0), 'kept')
  assert.equal(a.obs.a.n, 5, 'positive control: the count too')
  const b = st([{ t: 'cnt', k: 'a', n: 5, cap: 100, v: 2, m: {}, r: R(0) }, { t: 'cnt', k: 'a', n: 7, cap: 200, v: 2, m: {} }])
  assert.equal(b.obs.a.r, undefined, 'the newer count has no room reading: unknown, never the stale 0')
  assert.equal(b.obs.a.n, 7)
  const c = st([{ t: 'cnt', k: 'a', n: 5, cap: 100, v: 2, m: {}, r: R(0, 64) }, { t: 'cnt', k: 'a', n: 5, cap: 100, v: 2, m: {}, r: R(64, 0) }])
  assert.deepEqual(c.obs.a.r, R(64), 'a tie: the larger room per name (never the fuller-looking town)')
  const d = st([{ t: 'cnt', k: 'a', n: 5, cap: 100, v: 2, m: {}, r: R(0) }, { t: 'cnt', k: 'a', n: 5, cap: 100, v: 2, m: {} }])
  assert.equal(d.obs.a.r, undefined, 'a tie with one side unread: unknown')
  const e = st([{ t: 'cnt', k: 'a', n: 5, cap: 100, v: 2, m: {}, r: R(0) }, { t: 'cnt', k: 'a', n: 9, cap: 50, v: 2, m: {}, r: R(999) }])
  assert.deepEqual(e.obs.a.r, R(0), 'an older capture appended later does not replace the newer reading')
})

await t('recordCount writes the room it is given (cleaned) and nothing when it has none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-overflow-rc-'))
  CC.recordCount(dir, 'tk', null, { obs: { k: 'a', n: 1, m: {}, cap: 10, r: { cobblestone: 5, cobbled_deepslate: 6, junk: 1 } } })
  CC.recordCount(dir, 'tk', null, { obs: { k: 'b', n: 1, m: {}, cap: 10 } })
  const recs = CC.readJournal(dir, 'tk')
  assert.deepEqual(recs.find(x => x.k === 'a').r, R(5, 6))
  assert.equal('r' in recs.find(x => x.k === 'b'), false)
})

// ======================================================================================== THE TOWN'S ROOM
const fresh = (r, ago = 0, seq = 1) => ({ n: 0, at: NOW - ago, seq, ...(r ? { r } : {}) })
await t('townRoom: KNOWN only with a covered scan and a fresh reading for EVERY container; max is the most ONE container takes', () => {
  const s = { obs: { a: fresh(R(0)), b: fresh(R(32)) }, claims: {} }
  const v = CC.townRoom(s, ['a', 'b'], NOW)
  assert.equal(v.known, true); assert.deepEqual(v.max, R(32), 'two containers of 32: a 64 fits in neither (a stack is never split)')
  assert.equal(v.containers, 2)
  assert.equal(CC.townRoom(s, ['a', 'b'], NOW, { coverage: false }).known, false, 'a scan that did not cover the town')
  assert.equal(CC.townRoom(s, [], NOW).known, false, 'no container at all is not "no room"')
  assert.equal(CC.townRoom(s, ['a', 'b', 'c'], NOW).known, false, 'a container never counted')
  assert.deepEqual(CC.townRoom(s, ['a', 'b', 'c'], NOW).unknown, ['c'])
  assert.equal(CC.townRoom({ obs: { a: fresh(R(0)), b: fresh(null) }, claims: {} }, ['a', 'b'], NOW).known, false, 'a count with no room reading (older build)')
  assert.equal(CC.townRoom({ obs: { a: fresh(R(0)), b: fresh(R(0), CC.ROOM_TTL_MS) }, claims: {} }, ['a', 'b'], NOW).known, false, 'a reading an hour old')
  assert.equal(CC.townRoom({ obs: { a: fresh(R(0)), b: fresh(R(0), CC.ROOM_TTL_MS - 1) }, claims: {} }, ['a', 'b'], NOW).known, true, 'positive control: just inside the hour')
  assert.equal(CC.ROOM_TTL_MS, 60 * 60 * 1000)
  assert.equal(CC.townRoom(s, ['a', 'b'], NOW, { gone: ['b'] }).known, true, 'a gone container no longer counts')
  assert.deepEqual(CC.townRoom(s, ['a', 'b'], NOW, { gone: ['b'] }).max, R(0))
})
await t('townRoom: a container mid-WITHDRAW (live take/draw) or with an unresolved void is UNKNOWN; an incoming bank claim is not', () => {
  const base = () => ({ obs: { a: fresh(R(0), 0, 5), b: fresh(R(0), 0, 5) }, claims: {} })
  for (const decision of ['draw', 'take']) {
    const s = base(); s.claims.x = { k: 'b', n: 64, decision, state: 'live' }
    assert.equal(CC.townRoom(s, ['a', 'b'], NOW).known, false, `a live ${decision} is making room the reading cannot show`)
  }
  const bank = base(); bank.claims.x = { k: 'b', n: 64, decision: 'bank', state: 'live' }
  assert.equal(CC.townRoom(bank, ['a', 'b'], NOW).known, true, 'an incoming bank only shrinks the room: still known')
  const v = base(); v.claims.x = { k: 'b', n: 0, decision: 'bank', state: 'void', voidAt: NOW, voidSeq: 9 }
  assert.equal(CC.townRoom(v, ['a', 'b'], NOW).known, false, 'a void not yet recounted')
  const vr = base(); vr.obs.b = fresh(R(0), 0, 10); vr.claims.x = { k: 'b', n: 0, decision: 'bank', state: 'void', voidAt: NOW - 5, voidSeq: 9 }
  assert.equal(CC.townRoom(vr, ['a', 'b'], NOW).known, true, 'positive control: recounted after the void')
  const elsewhere = base(); elsewhere.claims.x = { k: 'z', n: 1, decision: 'draw', state: 'live' }
  assert.equal(CC.townRoom(elsewhere, ['a', 'b'], NOW).known, false, 'a withdraw at a container the scan missed is still a container of the town')
})

// ======================================================================================== THE WELL'S RULE
const bag3 = [it('cobblestone', 64, 9), it('cobblestone', 30, 10), it('cobblestone', 64, 11), it('egg', 16, 12)]
await t('THE SWITCH: at_cap always; overflow only BELOW a complete count with the room KNOWN; anything else nothing', () => {
  const known = { known: true, max: R(0) }, unknown = { known: false, max: R(0) }
  assert.equal(W.cobbleWellSwitch({ cap: 'at_cap', room: null }), 'at_cap')
  assert.equal(W.cobbleWellSwitch({ cap: 'below', room: known }), 'overflow')
  assert.equal(W.cobbleWellSwitch({ cap: 'below', room: unknown }), null, 'unknown room is never full')
  assert.equal(W.cobbleWellSwitch({ cap: 'below', room: null }), null)
  assert.equal(W.cobbleWellSwitch({ cap: 'unknown', room: known }), null, 'an incomplete count')
  assert.equal(W.cobbleWellSwitch({ cap: 'none', room: known }), null, 'no surplus')
  assert.equal(W.cobbleWellSwitch({}), null)
})
await t('THE STACKS: only the surplus stacks NO container can take whole, smallest first, the bot keeps 64; a stack that fits stays for the deposit', () => {
  assert.equal(counts(W.cobbleOverflowStacks(bag3, { known: true, max: R(0) })), 'cobblestone:30,cobblestone:64', 'no room anywhere: 158 -> 64 kept')
  assert.equal(counts(W.cobbleOverflowStacks(bag3, { known: true, max: R(40) })), 'cobblestone:64', 'room for 40: the 30 fits and stays, the 64 goes')
  assert.equal(counts(W.cobbleOverflowStacks(bag3, { known: true, max: R(64) })), '', 'room for a stack: nothing goes (the deposit banks it)')
  assert.equal(counts(W.cobbleOverflowStacks(bag3, { known: true, max: R(63) })), 'cobblestone:64', '63 is not 64')
  assert.equal(counts(W.cobbleOverflowStacks(bag3, { known: false, max: R(0) })), '', 'unknown room: nothing')
  assert.equal(counts(W.cobbleOverflowStacks(bag3, null)), '')
  const mixed = [it('cobblestone', 64, 9), it('cobbled_deepslate', 64, 10), it('cobblestone', 64, 11)]
  assert.equal(counts(W.cobbleOverflowStacks(mixed, { known: true, max: { cobblestone: 0, cobbled_deepslate: 64 } })), 'cobblestone:64', 'per name: the deepslate fits, a cobblestone does not')
  assert.equal(counts(W.cobbleOverflowStacks([it('cobblestone', 64, 9)], { known: true, max: R(0) })), '', 'exactly the reserve: nothing')
  assert.equal(W.stackFits({ known: true, max: { cobblestone: 0 } }, { name: 'cobbled_deepslate', count: 1 }), true, 'a name the reading lacks fits (fail closed)')
  assert.equal(W.stackFits({ known: false, max: R(0) }, { name: 'cobblestone', count: 64 }), true, 'unknown: fits')
  assert.equal(W.stackFits({ known: true, max: R(0) }, { name: 'cobblestone', count: 64 }), false, 'positive control')
})
await t('AT THE CLICK: cobbleStackGoes -- at_cap any planned stack, overflow only one that fits nowhere, otherwise none', () => {
  const s = { name: 'cobblestone', count: 64 }
  assert.equal(W.cobbleStackGoes(s, { mode: 'at_cap' }), true)
  assert.equal(W.cobbleStackGoes(s, { mode: 'overflow', room: { known: true, max: R(0) } }), true)
  assert.equal(W.cobbleStackGoes(s, { mode: 'overflow', room: { known: true, max: R(64) } }), false, 'room appeared: it stays')
  assert.equal(W.cobbleStackGoes(s, { mode: null, room: { known: true, max: R(0) } }), false)
  assert.equal(W.cobbleStackGoes(s, {}), false)
})
await t('disposePlan: cobbleRoom adds the overflow stacks (the trigger counts them); cobbleAtCap still takes every surplus stack; neither, none', () => {
  const names = p => p.stacks.map(s => `${s.name}:${s.count}`).join(',')
  assert.equal(names(W.disposePlan(bag3)), 'egg:16', 'no switch: no cobble')
  assert.equal(names(W.disposePlan(bag3, { cobbleRoom: { known: true, max: R(40) } })), 'cobblestone:64,egg:16')
  assert.equal(W.disposePlan(bag3, { cobbleRoom: { known: true, max: R(40) } }).junkStacks, 2)
  assert.equal(names(W.disposePlan(bag3, { cobbleRoom: { known: false, max: R(0) } })), 'egg:16')
  assert.equal(names(W.disposePlan(bag3, { cobbleAtCap: true, cobbleRoom: { known: true, max: R(64) } })), 'cobblestone:64,cobblestone:30,egg:16', 'at the cap: every surplus stack, room or not')
  // the reserve stone the overflow takes is charged before a guarded stone is judged (as at the cap)
  const g = [it('diorite', 40, 9), it('cobblestone', 64, 10), it('cobblestone', 64, 11)]
  assert.deepEqual(W.disposePlan(g, { cobbleRoom: { known: true, max: R(0) } }).stacks.map(s => s.name), ['diorite', 'cobblestone'])
  // 40 diorite + 94 cobble = 134 reserve stone: the 30 goes (104 left), then the diorite leaves exactly 64 and goes too;
  // with 63 + 30 cobble no cobble stack can go (93 - 30 = 63 < 64); the diorite still may (93 reserve stone stay)
  assert.deepEqual(W.disposePlan([it('diorite', 40, 9), it('cobblestone', 64, 10), it('cobblestone', 30, 11)], { cobbleRoom: { known: true, max: R(0) } }).stacks.map(s => `${s.name}:${s.count}`), ['diorite:40', 'cobblestone:30'])
  assert.deepEqual(W.disposePlan([it('diorite', 40, 9), it('cobblestone', 63, 10), it('cobblestone', 30, 11)], { cobbleRoom: { known: true, max: R(0) } }).stacks.map(s => `${s.name}:${s.count}`), ['diorite:40'])
})

// ======================================================================================== THE CHAIN, THROUGH THE REAL DEPOSIT
const town = (bag, chests = [[5, 64, 0]]) => {
  process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-overflow-pool-'))
  const w = fakeWorld({ bag })
  for (const [x, y, z] of chests) w.set(x, y, z, 'chest')
  // mineflayer's bag items carry their inventory slot (9..44); the fake's bare bag does not, and the well plans by slot
  w.bot.inventory.items = () => w.bag.map((x, i) => { if (x) x.slot = 9 + i; return x }).filter(Boolean)
  return w
}
const run = bot => SKILLS.deposit.run({ bot }, {}, new AbortController().signal)
const KEY = () => CF.townKey({ x: 0, y: 64, z: 0 })
const wellPlan = bot => { const co = SK.cobbleWellOpts(bot); return { co, plan: W.disposePlan(bot.inventory.items(), { cobbleAtCap: co.cobbleAtCap, cobbleRoom: co.cobbleRoom }) } }
// the order the cognitive loop gives at town with a full bag (well.mjs wellOrder), fed the plan's trigger count
const order = (plan, slots = 36) => W.wellOrder({ now: 1e12, slots, freeSlots: 36 - slots, junkStacks: plan.junkStacks, distHome: 5, well: () => ({ open: false, attended: false, breached: false }) }).order?.skill ?? null

await t('TRAP 1 -- the deposit refuses at a full town AND the well refuses: ruled out. The refusal\'s own open records the room; the well then takes the surplus, the bot keeps 64', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 30)])
  w.fill(5, 64, 0, 'stone', 64)
  // before anyone opened the chest the room is unknown: nothing goes (fail closed)
  const before = wellPlan(w.bot)
  assert.equal(before.co.mode, null, JSON.stringify(before.co)); assert.equal(before.plan.junkStacks, 0)
  const n0 = RECS.length
  const r = await run(w.bot)
  assert.equal(r.status, 'no_effect', JSON.stringify(r)); assert.match(r.detail, /cobble never opens a new chest/, 'the deposit refused: no room')
  assert.equal(cobbleIn(w.bag), 158, 'nothing banked')
  assert.deepEqual(CC.readTown(process.env.POOL_STATE_DIR, KEY()).obs['5,64,0']?.r, R(0), 'the open recorded the chest\'s room: none')
  const after = wellPlan(w.bot)
  assert.equal(after.co.cap, 'below', 'the town is below its cap'); assert.equal(after.co.mode, 'overflow')
  assert.equal(counts(W.cobbleOverflowStacks(w.bot.inventory.items(), after.co.room)), 'cobblestone:30,cobblestone:64', 'the surplus goes, smallest chosen first')
  assert.equal(counts(after.plan.stacks), 'cobblestone:64,cobblestone:30', '(thrown in slot order)')
  assert.equal(158 - after.plan.stacks.reduce((t, s) => t + s.count, 0), 64, 'the bot keeps its 64')
  assert.equal(order(after.plan), 'dispose_well', 'and the well order fires at a full bag')
  assert.equal(order(before.plan), null, 'positive control: before the reading it did not')
  const row = RECS.slice(n0).find(x => x.skill?.name === '_cobble_overflow')
  assert.ok(row, 'the exposure row'); assert.match(row.skill.detail, /^phase=deposit_no_room surplus=94 stacks=2 cap=below mode=overflow known=1 containers=1 unknown=0 max=0\/0 goes=2$/)
})

await t('TRAP 2 -- the well taking cobble a deposit could still bank: ruled out. A chest with ONE free slot banks a stack first; only then, full, does the rest go', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64), stack('cobblestone', 64)])
  w.stock(5, 64, 0, Array.from({ length: 26 }, () => stack('stone', 64)))
  // the room read BEFORE the deposit (a count with room for one stack): nothing may go -- every surplus stack fits
  const b = w.bot.blockAt({ x: 5, y: 64, z: 0 })
  const win = await w.bot.openContainer(b); await SK.cobbleObserve(w.bot, b.position, win); win.close()
  const pre = wellPlan(w.bot)
  assert.equal(pre.co.mode, 'overflow', 'the room is known'); assert.deepEqual(pre.co.room.max, R(64))
  assert.equal(pre.plan.junkStacks, 0, 'a stack fits: the well takes nothing'); assert.equal(order(pre.plan), null)
  const r = await run(w.bot)
  assert.equal(r.status, 'success', r.detail); assert.equal(cobbleIn(w.bag), 128, 'the deposit banked one whole stack into the free slot')
  assert.deepEqual(CC.readTown(process.env.POOL_STATE_DIR, KEY()).obs['5,64,0']?.r, R(0), 'the post-transfer count: no room left')
  const post = wellPlan(w.bot)
  assert.equal(counts(post.plan.stacks), 'cobblestone:64', 'now full: the surplus above 64 goes'); assert.equal(order(post.plan), 'dispose_well')
})

await t('UNKNOWN ROOM SENDS NOTHING: two town chests, one seen full and one never opened -> nothing; once both are seen full -> the surplus', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64)], [[5, 64, 0], [-5, 64, 0]])
  w.fill(5, 64, 0, 'stone', 64); w.fill(-5, 64, 0, 'stone', 64)
  const look = async (x, y, z) => { const b = w.bot.blockAt({ x, y, z }); const win = await w.bot.openContainer(b); await SK.cobbleObserve(w.bot, b.position, win); win.close() }
  await look(5, 64, 0)
  const one = wellPlan(w.bot)
  assert.equal(one.co.room?.known ?? false, false, JSON.stringify(one.co)); assert.equal(one.plan.junkStacks, 0)
  await look(-5, 64, 0)
  const both = wellPlan(w.bot)
  assert.equal(both.co.mode, 'overflow'); assert.equal(counts(both.plan.stacks), 'cobblestone:64')
})

await t('AN OLDER BUILD\'S COUNT (no room reading) is unknown room: nothing goes until this build reads the chest', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64)])
  w.fill(5, 64, 0, 'stone', 64)
  CC.appendJournal(process.env.POOL_STATE_DIR, KEY(), null, { t: 'cnt', k: '5,64,0', n: 0, cap: Date.now(), v: 2, m: {} })
  const p = wellPlan(w.bot)
  assert.equal(p.co.cap, 'below', 'positive control: the count is complete'); assert.equal(p.co.mode, null); assert.equal(p.plan.junkStacks, 0)
})

await t('AT THE CAP the old rule stands (every surplus stack, room or not); the room is not even consulted', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64)])
  CC.appendJournal(process.env.POOL_STATE_DIR, KEY(), null, { t: 'cnt', k: '5,64,0', n: CC.TOWN_COBBLE_CAP, cap: Date.now(), v: 2, m: { cobble: CC.TOWN_COBBLE_CAP }, r: R(27 * 64) })
  const p = wellPlan(w.bot)
  assert.equal(p.co.mode, 'at_cap'); assert.equal(p.co.room, null); assert.equal(counts(p.plan.stacks), 'cobblestone:64')
})

await t('THE EXPOSURE ROW is written only with surplus cobble, and says when the room is unknown', async () => {
  const w = town([stack('cobblestone', 64), stack('cobblestone', 64)], [[5, 64, 0], [-5, 64, 0]])
  const n0 = RECS.length
  SK.cobbleOverflowNote(w.bot, 'town_storage_full')
  const row = RECS.slice(n0).find(x => x.skill?.name === '_cobble_overflow')
  assert.match(row?.skill?.detail ?? '', /^phase=town_storage_full surplus=64 stacks=1 cap=unknown mode=- known=0 containers=2 unknown=2 max=0\/0 goes=0$/, row?.skill?.detail)
  assert.equal(row.skill.status, 'no_effect')
  const w2 = town([stack('cobblestone', 64)])
  const n1 = RECS.length
  assert.equal(SK.cobbleOverflowNote(w2.bot, 'town_storage_full'), null)
  assert.equal(RECS.slice(n1).filter(x => x.skill?.name === '_cobble_overflow').length, 0, 'the reserve alone: no row')
})

// ======================================================================================== THE LICENCE ROW
await t('THE LICENCE ROW: the mode detail names the rule and the evidence age, and index.mjs writes it once per spawn as `_cobbleoverflow_mode`', () => {
  assert.equal(W.cobbleOverflowModeDetail(), 'phase=mode rule=no_room ttl_min=60')
  assert.equal(W.cobbleOverflowModeDetail(30 * 60 * 1000), 'phase=mode rule=no_room ttl_min=30', 'positive control: it follows the ttl it is given')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const wired = src => {
    const c = strip(src)
    assert.match(c, /^import \{[^}]*\bcobbleOverflowModeDetail\b[^}]*\} from '\.\/well\.mjs'$/m, 'imported')
    const i = c.indexOf("bot.once('spawn', () => {")
    assert.ok(i > 0, 'the spawn handler exists')
    assert.match(c.slice(i, i + 4500), /\n\s*try \{ logEvent\(\{ kind: 'cobbleoverflow_mode', status: 'success', snapshot: snapshot\(bot\), detail: cobbleOverflowModeDetail\(\) \}\) \} catch \{\}/, 'written on spawn, on the executable path')
  }
  const idx = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')
  wired(idx)
  const row = "    try { logEvent({ kind: 'cobbleoverflow_mode'"
  assert.equal(idx.split(row).length, 2, 'anchor present and unique')
  assert.throws(() => wired(idx.replace(row, "    try { void ({ kind: 'cobbleoverflow_mode'")), 'a removed row is caught')
  assert.throws(() => wired(idx.replace("detail: cobbleOverflowModeDetail() }) } catch {}", "detail: 'phase=mode rule=no_room ttl_min=60' }) } catch {}")), 'a literal detail is caught')
})

await t('THE ORDER\'S WIRING: cognitive.mjs feeds wellOrder the junk count of skills.mjs wellOrderPlan (its behaviour: well.test.mjs "OVERFLOW, the ORDER")', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const wired = src => {
    const c = strip(src)
    const a = c.split('const plan = wellOrderPlan(bot, items, atTown)')
    assert.equal(a.length, 2, 'the well order plans with wellOrderPlan, once')
    const tail = a[1].slice(0, 600)
    assert.match(tail, /const r = wellOrder\(\{\s*now: Date\.now\(\), slots: plan\.slots, freeSlots: 36 - plan\.slots, junkStacks: plan\.junkStacks,/, 'and feeds its junk count to wellOrder')
  }
  const cog = fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8')
  wired(cog)
  const line = '        const plan = wellOrderPlan(bot, items, atTown)\n'
  assert.equal(cog.split(line).length, 2, 'anchor present and unique')
  assert.throws(() => wired(cog.replace(line, '        const plan = disposePlan(items, { swords: false })\n')), 'a plan without the switch is caught')
  assert.throws(() => wired(cog.replace('junkStacks: plan.junkStacks, buildJunkStacks', 'junkStacks: 0, buildJunkStacks')), 'an order fed no junk count is caught')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
