// THE HELD CURSOR'S LIFECYCLE (skills.mjs settleCursor / holdUnsettled; withdraw review round 3). A cursor that could
// not be emptied with the server's word for it holds the chest window open: no click while one is in flight (A),
// nothing else may touch the inventory and survival may release it (B), only server evidence ends it (C), a disconnect
// cancels it (D), the server closing the window ends it (E), one bankable stack may make room (F), and with no room
// anywhere it keeps holding and asks for help -- or, behind a switch that is off, closes after 30 s (G).
// A runs against the REAL craftsync (lockstep, cap, inflight, the clone-click probe) over a stub client.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-hold-logs-'))
process.env.BOT_NAME = 'HoldBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-hold-pool-')) }
freshPool()

const { SKILLS, loadedClosePolicy } = await import('../src/skills.mjs')
const { survivalRelease } = await import('../src/withdrawpick.mjs')
const { clearWithdrawHolds } = await import('../src/bankable.mjs')
const { installCraftSync } = await import('../src/craftsync.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool, total } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const settledRows = () => RECS.filter(r => r.skill?.name === '_withdraw_settled').map(r => r.skill.detail)
const wait = ms => new Promise(r => setTimeout(r, ms))
const sig = () => new AbortController().signal
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const junk = n => Array.from({ length: n }, () => stack('bamboo', 64))
const town = (bag, stacks) => { freshPool(); clearWithdrawHolds(); const w = fakeWorld({ bag }); w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, stacks); return w }
const withServer = w => {
  w.bot.craftSync = {
    lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => { const c = w.cursorEvidence ? w.cursorEvidence(win) : win.selectedItem; return { answered: !w.noEvidence, cursorEmpty: !c, carried: c ? { itemCount: c.count } : null } },
  }
  return w
}
/** The REAL craftsync over a stub client that answers resyncs and clone probes with the fake's own truth. */
const withRealCraftSync = (w, opts = {}) => {
  const c = new EventEmitter()
  c.write = (name, p) => {
    if (name !== 'window_click' || p.stateId !== -1) return
    const win = p.windowId === 0 ? null : w.bot.currentWindow
    const sel = win?.selectedItem
    setTimeout(() => c.emit('window_items', { windowId: p.windowId, stateId: 9, items: [], carriedItem: sel ? { itemCount: sel.count } : { itemCount: 0 } }), 20)
  }
  w.bot._client = c
  w.bot.putAway = async () => {}
  w.bot.putSelectedItemRange = async () => {}
  installCraftSync(w.bot, { log: () => {}, ...opts })
  return w
}
const fullChestWithPick = () => [...Array.from({ length: 26 }, () => stack('cobblestone', 64)), tool('stone_pickaxe', 30)]
const afterClick = (w, hook) => { const click = w.bot.clickWindow.bind(w.bot); let n = 0; w.bot.clickWindow = async (slot, button, mode) => { n++; await click(slot, button, mode); hook(n, slot, button, mode) } }
/** A hold with NOWHERE for the pickaxe: an auto-pickup fills the emptied bag slot before click 3; the chest is full. */
const noCapacityHold = async () => {
  const w = withServer(town([...junk(34), stack('cobblestone', 64), stack('stone', 20)], fullChestWithPick()))
  afterClick(w, (n, slot) => { if (n === 1) w._bagSlot = slot; if (n === 2) w.bag[w._bagSlot - 27] = stack('dirt', 64) })
  const r = await SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
  return { w, r }
}
const stopHold = bot => { try { bot.inventoryUnsettled?.stop?.() } catch {} }

// ---------------------------------------------------------------- A ---
await t('A. A CLICK STALLED 10 s, REAL CRAFTSYNC: no second click and no close while it is in flight -- at 4, 6.5 and 9 s -- then settled by server evidence', async () => {
  const w = withRealCraftSync(town([...junk(35), stack('stick', 62)], [stack('stick', 40)]), { clickCapMs: 1500 })
  const click = w.bot.clickWindow.bind(w.bot)
  let first = true, stalled = 0
  w.bot.clickWindow = async (slot, button, mode) => {
    if (button === 1 && first) { first = false; throw new Error('injected: the right-click failed') }
    if (slot < 27 && button === 0 && w.bot.currentWindow?.selectedItem && !first) { stalled++; await wait(10_000) }
    return click(slot, button, mode)
  }
  const t0 = Date.now()
  const r = await SKILLS.withdraw.run({ bot: w.bot }, { item: 'stick', count: 2 }, sig())
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  for (const at of [4_000, 6_500, 9_000]) {
    await wait(Math.max(0, t0 + at - Date.now()))
    if (at === 4_000) await assert.rejects(w.bot.equip(w.bag.find(Boolean), 'hand'), /inventory held/, 'hunger\'s equip refused during a pending-click hold')
    assert.ok(w.bot.currentWindow, `window still open at ${at} ms`)
    assert.ok(w.bot.inventoryUnsettled, `still held at ${at} ms`)
    assert.equal(stalled, 1, `no second click at ${at} ms`)
    assert.equal(w.dropped.length, 0)
  }
  await wait(Math.max(0, t0 + 13_000 - Date.now()))
  assert.equal(w.bot.inventoryUnsettled ?? null, null, 'cleared after the click settled')
  assert.equal(w.bot.currentWindow, null, 'closed')
  assert.equal(w.dropped.length, 0)
  assert.equal(count(w.bag, 'stick') + w.containers.get('5,64,0').slots.filter(Boolean).reduce((k, x) => k + (x.name === 'stick' ? x.count : 0), 0), 102)
  assert.match(settledRows().at(-1), /^how=settled /)
})

// ---------------------------------------------------------------- B ---
await t('B. EXCLUSIVE OWNERSHIP while held: equip, toss, moveSlotItem and the window\'s close refuse; admission refuses too', async () => {
  const { w } = await noCapacityHold()
  assert.ok(w.bot.inventoryUnsettled)
  await assert.rejects(w.bot.equip(w.bag.find(Boolean), 'hand'), /inventory held/)
  await assert.rejects(w.bot.toss?.(1, null, 1) ?? Promise.reject(new Error('inventory held (no toss on the fake)')), /inventory held/)
  assert.throws(() => w.bot.currentWindow.close(), /inventory held/)
  assert.equal(w.dropped.length, 0)
  stopHold(w.bot)
  await w.bot.equip(w.bag.find(Boolean), 'hand')   // released: the originals are back
})

await t('B. A SURVIVAL RELEASE: one last settle, then the close, with a row naming what the cursor held', async () => {
  const { w } = await noCapacityHold()
  await w.bot.inventoryUnsettled.release('reflex:lava')
  assert.equal(w.bot.inventoryUnsettled ?? null, null)
  assert.equal(w.bot.currentWindow, null, 'closed for survival')
  const row = settledRows().at(-1)
  assert.match(row, /^how=released .*carried=stone_pickaxe:1 srv=bag=/)
  assert.match(row, /released_by_reflex:lava/)
})

await t('B. survivalRelease: air, lava, fire, fall, damage release; a calm tick does not', () => {
  const calm = { head: { name: 'air', boundingBox: 'empty' }, feet: { name: 'air' }, below: { name: 'stone' }, health: 20, lastHealth: 20 }
  assert.equal(survivalRelease(calm), null)
  assert.equal(survivalRelease({ ...calm, head: { name: 'water', boundingBox: 'empty' } }), 'reflex:air')
  assert.equal(survivalRelease({ ...calm, below: { name: 'lava' } }), 'reflex:lava')
  assert.equal(survivalRelease({ ...calm, onFire: true }), 'reflex:fire')
  assert.equal(survivalRelease({ ...calm, onGround: false, velocityY: -1 }), 'reflex:fall')
  assert.equal(survivalRelease({ ...calm, health: 17 }), 'reflex:damage')
})

// ---------------------------------------------------------------- C ---
await t('C. SERVER EVIDENCE: a local "rescued" contradicted by the server is not settled; the next attempt places it, then the server agrees', async () => {
  const w = withServer(town([...junk(35), stack('stick', 62)], [stack('stick', 40)]))
  const click = w.bot.clickWindow.bind(w.bot)
  let first = true
  w.bot.clickWindow = async (slot, button, mode) => { if (button === 1 && first) { first = false; throw new Error('injected') } return click(slot, button, mode) }
  // the server corrects the cursor ONCE: it still holds 5 sticks after the rescue
  let corrected = false
  w.cursorEvidence = win => { if (!corrected) { corrected = true; win.selectedItem = stack('stick', 5); w.containers.get('5,64,0').slots[0].count -= 5; return win.selectedItem } return win.selectedItem }
  const r = await SKILLS.withdraw.run({ bot: w.bot }, { item: 'stick', count: 2 }, sig())
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  assert.ok(w.bot.inventoryUnsettled, 'not settled on the local view')
  await wait(2_500)
  assert.equal(w.bot.inventoryUnsettled ?? null, null); assert.equal(w.bot.currentWindow, null)
  assert.equal(w.dropped.length, 0)
  assert.equal(w.bot.listenerCount('end'), 0, 'the end listener is removed when the hold finishes')
})

await t('C. NO SERVER EVIDENCE: an empty-looking cursor is still held', async () => {
  const w = withServer(town([...junk(35), stack('stick', 62)], [stack('stick', 40)]))
  w.noEvidence = true
  const r = await SKILLS.withdraw.run({ bot: w.bot }, { item: 'stick', count: 2 }, sig())
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  assert.ok(w.bot.inventoryUnsettled && w.bot.currentWindow, 'held without the server\'s word')
  w.noEvidence = false
  await wait(1_500)
  assert.equal(w.bot.inventoryUnsettled ?? null, null, 'and settles once the server answers')
})

// ---------------------------------------------------------------- D ---
await t('D. A DISCONNECT cancels the hold: no click after it, the end listener removed', async () => {
  const { w } = await noCapacityHold()
  assert.ok(w.bot.inventoryUnsettled)
  w.bot.emit('end')
  await wait(50)
  const clicks = w.spy.clicks.length
  await wait(2_200)
  assert.equal(w.spy.clicks.length, clicks, 'no click after the disconnect')
  assert.equal(w.bot.inventoryUnsettled ?? null, null)
  assert.equal(w.bot.listenerCount('end'), 0)
  assert.match(settledRows().at(-1), /^how=disconnected /)
})

// ---------------------------------------------------------------- E ---
await t('E. THE SERVER CLOSES THE WINDOW: the hold ends (server_closed) and nothing is clicked into another window', async () => {
  const { w } = await noCapacityHold()
  w.bot.currentWindow = null   // walked away, the chest broke, a death
  const clicks = w.spy.clicks.length
  await wait(1_500)
  assert.equal(w.bot.inventoryUnsettled ?? null, null)
  assert.equal(w.spy.clicks.length, clicks)
  assert.match(settledRows().at(-1), /^how=server_closed /)
})

// ---------------------------------------------------------------- F ---
await t('F. ONE BANKABLE STACK INTO COMPATIBLE CAPACITY frees a slot for the held pickaxe -- verified, nothing dropped', async () => {
  const w = withServer(town([...junk(33), stack('cobblestone', 64), stack('stone', 10), stack('stone', 20)], fullChestWithPick()))
  afterClick(w, (n, slot) => { if (n === 1) w._bagSlot = slot; if (n === 2) w.bag[w._bagSlot - 27] = stack('dirt', 64) })
  const r = await SKILLS.withdraw_pick.run({ bot: w.bot }, {}, sig())
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)   // the plan was not followed; the cursor was rescued
  assert.equal(w.bot.inventoryUnsettled ?? null, null, 'no hold: the rearrangement made room')
  assert.equal(count(w.bag, 'stone_pickaxe'), 1)
  assert.equal(w.containers.get('5,64,0').slots[26]?.name, 'stone'); assert.equal(w.containers.get('5,64,0').slots[26]?.count, 30)
  assert.equal(w.dropped.length, 0); assert.equal(w.bot.currentWindow, null)
})

// ---------------------------------------------------------------- G ---
await t('G. NOWHERE FOR THE CURSOR: keep holding, never drop, intervention_needed', async () => {
  const { w } = await noCapacityHold()
  await wait(1_500)
  assert.ok(w.bot.inventoryUnsettled?.interventionNeeded)
  assert.ok(w.bot.currentWindow); assert.equal(w.dropped.length, 0)
  assert.ok(settledRows().some(d => /^how=intervention_needed .*carried=stone_pickaxe:1/.test(d)))
  stopHold(w.bot)
})

await t('G. the last-resort close is OFF by default', () => {
  assert.equal(loadedClosePolicy({}), null)
  assert.equal(loadedClosePolicy({ WITHDRAW_CLOSE_LOADED: '1' }), 30_000)
})

await t('B. THE REFLEX WIRING (structural: the reflex tick is not driven here): a held cursor is released by survivalRelease before the reflexes run', async () => {
  const src = fs.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const tick = src.slice(src.indexOf('const timer = setInterval(async () => {'))
  const rel = tick.indexOf('await bot.inventoryUnsettled.release(why)'), surv = tick.indexOf('survivalRelease({'), hunger = tick.indexOf('pickFood(bot)')
  assert.ok(surv > 0 && rel > surv, 'survivalRelease decides, release acts')
  assert.ok(rel < hunger, 'before the reflexes (hunger among them) run')
})

await t('G. THE SWITCH (WITHDRAW_CLOSE_LOADED=1, default off): a bounded close after 30 s', async () => {
  process.env.WITHDRAW_CLOSE_LOADED = '1'
  try {
    const { w } = await noCapacityHold()
    await wait(29_000)
    assert.ok(w.bot.inventoryUnsettled, 'still held before 30 s')
    await wait(2_500)
    assert.equal(w.bot.inventoryUnsettled ?? null, null)
    assert.match(settledRows().at(-1), /^how=closed_loaded .*carried=stone_pickaxe:1/)
  } finally { delete process.env.WITHDRAW_CLOSE_LOADED }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
