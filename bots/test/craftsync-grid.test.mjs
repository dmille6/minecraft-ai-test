// craftsync: an unclean exit never leaves the 2x2 grid or the cursor loaded (sandbox 10-04, bamboo fold aborted by
// the stuck watchdog: 2 bamboo in the grid and 8 on the cursor -- out of the bag while online, on the ground at
// logout; on the live craftsync-01 canary 2 of 82 craft_sync rows in 4.5 h were aborted 2x2 oak_planks crafts).
//
// REAL craftsync + REAL mineflayer craft.js/inventory.js against test/helpers/fake-paper-craft.mjs. The abort lands at
// a chosen ingredient click (after the server applied it), so "after the ingredients, before the result" is exact,
// not a timer. The oracle is the SERVER: its grid, its cursor, its bag. The first test is the positive control: a
// server that ignores the close strands the ingredients exactly as the sandbox saw, and the row must SAY so.
import assert from 'node:assert/strict'
import * as CS from '../src/craftsync.mjs'
import { Item, FakePaper, craftBot, recipeFor, TABLE, id } from './helpers/fake-paper-craft.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
let unhandled = 0
process.on('unhandledRejection', () => { unhandled++ })

const BAMBOO = { 36: ['bamboo', 10], 9: ['dirt', 64] }
const LOGS = { 36: ['oak_log', 5], 9: ['dirt', 64] }
const bag = (server, name) => server.p.filter(x => x && x.type === id(name)).reduce((n, x) => n + x.count, 0)
const gridOf = (server, table) => (table ? server.grid.table : server.grid[0]).slice(1).filter(Boolean).length

/**
 * One craft; `stopAt(n)` fires after the n-th ingredient placement the SERVER applied (a right-click into the grid)
 * and returns 'abort' | 'disconnect' | null. `before({ server, bot })` may change the fake or the bot first.
 */
async function gridTrial ({ item = 'stick', inv = BAMBOO, table = false, stopAt = () => null, opts = {}, before = null,
                            signal = true, paper = {}, equip = null } = {}) {
  const server = new FakePaper({ inventory: inv, ...paper })
  const bot = craftBot(server)
  if (equip) bot.equip = equip
  await server.sync()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r), ...opts })
  const recipe = recipeFor(bot, server, item, table)
  const ac = new AbortController()
  if (before) await before({ server, bot, abort: () => ac.abort() })
  const recv = server.receive.bind(server)
  let placed = 0, stoppedAtWrite = null, atStop = null
  server.receive = (name, params) => {
    const r = recv(name, params)
    const grid = table ? params?.windowId !== 0 && params?.slot >= 1 && params?.slot <= 9
                       : params?.windowId === 0 && params?.slot >= 1 && params?.slot <= 4
    if (name === 'window_click' && grid && params.mouseButton === 1) {
      const what = stopAt(++placed)
      if (what) {
        stoppedAtWrite = server.writes.length
        atStop = { grid: gridOf(server, table), cursor: server.cursor?.count ?? 0, bag: server.p.filter(Boolean).reduce((n, x) => n + x.count, 0) }
      }
      if (what === 'abort') ac.abort()
      if (what === 'disconnect') bot.emit('end')
      if (what === 'preempt') bot.__equipP = bot.equip({ name: 'stone_sword' }, 'hand')
      if (what === 'preempt+disconnect') { bot.__equipP = bot.equip({ name: 'stone_sword' }, 'hand'); bot.emit('end') }
    }
    return r
  }
  const startWrite = server.writes.length
  let error = null
  try { await bot.craft(recipe, 1, table ? TABLE : undefined, signal ? { signal: ac.signal } : undefined) } catch (e) { error = e }
  await server.settle()
  const next = async () => {
    let e = null
    try { await bot.craft(recipe, 1, table ? TABLE : undefined, {}) } catch (x) { e = x }
    await server.settle()
    return e
  }
  return { server, bot, rows, error, recipe, next, atStop, writes: server.writes.slice(startWrite),
           after: stoppedAtWrite === null ? [] : server.writes.slice(stoppedAtWrite) }
}
const crow = (r) => r.rows.find(x => x.kind === 'craft_sync')?.args   // the craft's row (drop events share the log)
const closes0 = (writes) => writes.filter(w => w.name === 'close_window' && w.params.windowId === 0).length

// ------------------------------------------------------------------ positive control
await t('POSITIVE CONTROL: at the abort the server really holds the grid and the cursor (what the old build stranded)', async () => {
  const r = await gridTrial({ stopAt: n => n === 2 ? 'abort' : null })
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.deepEqual({ grid: r.atStop.grid, cursor: r.atStop.cursor }, { grid: 2, cursor: 8 },
    'the abort did not land between the ingredients and the result; nothing below is proven')
  assert.equal(r.atStop.bag, 64, 'only the dirt was in the bag at the abort: all ten bamboo were out of it')
})

await t('a server that IGNORES the close leaves the grid loaded -- the row reads it as not clear, never assumes yes', async () => {
  // Paper always honours a close; this is the instrument's check, not a case the fleet meets. (The clear's resync
  // relies on the close having emptied the cursor -- the same assumption the baseline close has always made.)
  let ignore = false
  const r = await gridTrial({
    stopAt: n => { if (n === 2) { ignore = true; return 'abort' } return null },
    before: ({ server }) => { const close = server.onClose.bind(server); server.onClose = (p) => (ignore ? undefined : close(p)) },
  })
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.equal(gridOf(r.server, false), 2)
  assert.equal(crow(r).grid_clear, 'no')
  assert.match(crow(r).grid_residue ?? '', /slot\d:/)
})

// ------------------------------------------------------------------ the fix, case by case (server oracle)
for (const [label, opt] of [
  ['2x2 bamboo, aborted with both ingredients placed', { stopAt: n => n === 2 ? 'abort' : null }],
  ['2x2 bamboo, aborted with the first ingredient placed (the stack on the cursor)', { stopAt: n => n === 1 ? 'abort' : null }],
  ['2x2 oak_log -> planks, aborted after the ingredient', { item: 'oak_planks', inv: LOGS, stopAt: n => n === 1 ? 'abort' : null }],
]) {
  await t(`${label}: grid + cursor empty on the server, bag whole, local cursor clear, grid_clear=yes, next craft works`, async () => {
    const r = await gridTrial(opt)
    const src = opt.item === 'oak_planks' ? 'oak_log' : 'bamboo'
    const n0 = opt.item === 'oak_planks' ? 5 : 10
    assert.ok(r.error?.aborted, `got ${r.error?.message}`)
    assert.equal(gridOf(r.server, false), 0, 'grid still loaded on the server')
    assert.equal(r.server.cursor, null, 'server cursor still loaded')
    assert.equal(bag(r.server, src), n0, `the bag is not whole: ${bag(r.server, src)} of ${n0}`)
    assert.equal(r.server.dropped.length, 0, 'nothing may be thrown')
    assert.equal(r.bot.inventory.selectedItem, null, 'mineflayer still believes it holds a stack')
    assert.equal(crow(r).grid_clear, 'yes')
    assert.equal(crow(r).outcome, 'aborted')
    assert.equal(closes0(r.after), 1, 'exactly one close_window 0 after the abort')
    assert.equal(r.bot.craftSync.busy(), false)
    const e = await r.next()
    assert.equal(e, null, `the next craft failed: ${e?.message}`)
    if (src === 'bamboo') { assert.equal(bag(r.server, 'stick'), 1); assert.equal(bag(r.server, 'bamboo'), 8) }
    else { assert.equal(bag(r.server, 'oak_planks'), 4); assert.equal(bag(r.server, 'oak_log'), 4) }
  })
}

await t('the grid clear runs BEFORE ownership is released: no other click can interleave with it', async () => {
  const owned = []   // for every close_window 0: did craftsync still own the inventory?
  const r = await gridTrial({
    stopAt: n => n === 2 ? 'abort' : null,
    before: ({ server, bot }) => {
      const recv = server.receive.bind(server)
      server.receive = (name, params) => {
        if (name === 'close_window' && params.windowId === 0) owned.push(bot.craftSync.active() !== null)
        return recv(name, params)
      }
    },
  })
  assert.ok(r.error?.aborted)
  assert.equal(owned.length, 2, `expected the baseline close and the clear's close, saw ${owned.length}`)
  assert.equal(owned[1], true, 'the clear ran after the wrappers were released')
})

await t('a disconnect: nothing is sent after it, grid_clear=skipped_disconnected', async () => {
  const r = await gridTrial({ stopAt: n => n === 2 ? 'disconnect' : null })
  assert.ok(r.error?.aborted && /disconnected/.test(r.error.message), `got ${r.error?.message}`)
  assert.equal(closes0(r.after), 0, 'a close was written to a dead connection')
  assert.equal(r.after.filter(w => w.name === 'window_click' && w.params.stateId === -1).length, 0)
  assert.equal(crow(r).grid_clear, 'skipped_disconnected')
})

await t('an UNANSWERED clear resync is unverified, never yes (the baseline packet is not the answer)', async () => {
  let drop = false
  const r = await gridTrial({
    stopAt: n => { if (n === 2) { drop = true; return 'abort' } return null },
    opts: { gridClearCapMs: 300 },
    before: ({ server }) => {
      const recv = server.receive.bind(server)
      server.receive = (name, params) => {
        if (drop && name === 'window_click' && params.stateId === -1 && params.slot === -999) { server.writes.push({ t: Date.now(), name, params }); return }
        return recv(name, params)
      }
    },
  })
  assert.ok(r.error?.aborted)
  assert.equal(crow(r).grid_clear, 'unverified_unanswered')
  assert.equal(gridOf(r.server, false), 0, 'the close itself still returned the grid')
})

// ------------------------------------------------------------------ unchanged paths
await t('table craft aborted: unchanged -- mineflayer closes the table, no extra close_window 0, grid_clear null', async () => {
  const r = await gridTrial({ table: true, stopAt: n => n === 2 ? 'abort' : null })
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.equal(gridOf(r.server, true), 0)
  assert.equal(r.server.cursor, null)
  assert.equal(bag(r.server, 'bamboo'), 10)
  assert.equal(closes0(r.writes), 1, 'only the baseline closes window 0')
  assert.ok(r.writes.some(w => w.name === 'close_window' && w.params.windowId !== 0), 'mineflayer closes the table')
  assert.equal(crow(r).inflight_wait_expired, false)
  assert.equal(crow(r).grid_clear, 'na_no_clicks')
})

await t('a table grid click whose answer never comes, on a table mineflayer then closes, is a DEAD wait: released, not sat out', async () => {
  // the server applies the 2nd grid placement but its result update never arrives; the craft is aborted there and
  // mineflayer's catch closes the table -- the click's once(updateSlot:0) can now never be answered
  let mute = false
  const r = await gridTrial({
    table: true, stopAt: n => (n === 2 ? 'abort' : null),
    before: ({ server }) => {
      const send = server.send.bind(server)
      server.send = (batch) => send(mute ? batch.filter(([name, p]) => !(name === 'set_slot' && p.windowId !== 0 && p.slot === 0)) : batch)
      const recv = server.receive.bind(server)
      let placed = 0
      server.receive = (name, params) => {            // runs BEFORE the fake applies the click (and answers it)
        if (name === 'window_click' && params.windowId !== 0 && params.slot >= 1 && params.slot <= 9 && params.mouseButton === 1 && ++placed === 2) mute = true
        return recv(name, params)
      }
    },
  })
  const a = crow(r)
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.equal(a.dead_waits_released, 1, 'POSITIVE CONTROL: the table click must have been left waiting')
  assert.equal(a.inflight_wait_expired, false, 'the dead wait was sat out to the bound')
  assert.equal(a.grid_clear, 'na_no_clicks')
})

await t('no signal, clean 2x2 craft: unchanged -- two closes (baseline, verify), two resyncs, grid_clear null', async () => {
  const r = await gridTrial({ signal: false })
  assert.equal(r.error, null, r.error?.message)
  assert.equal(bag(r.server, 'stick'), 1)
  assert.equal(closes0(r.writes), 2)
  assert.equal(r.writes.filter(w => w.name === 'window_click' && w.params.stateId === -1).length, 2)
  assert.equal(crow(r).grid_clear, 'na_clean')
  assert.equal(crow(r).confirmed, 'yes')
})

await t('the BASELINE close clears a stale local cursor too: a craft after an old-build stranding works', async () => {
  // mineflayer believes it holds 8 bamboo; the server cursor is empty (what the next craft met after the old bug).
  const r = await gridTrial({ before: ({ bot }) => { bot.inventory.selectedItem = new Item(id('bamboo'), 8) } })
  assert.equal(r.error, null, `the craft after a stale cursor failed: ${r.error?.message}`)
  assert.equal(bag(r.server, 'stick'), 1)
})

// ------------------------------------------------------------------ review round (Codex, reproduced; Claude)
const fillHotbarCase = () => { const inv = { 36: ['bamboo', 10] }; for (let s = 9; s <= 35; s++) inv[s] = ['dirt', 64]; return inv }

await t('P1 A CLICK HELD BY THE AFTER-DIG DELAY WHEN THE CRAFT STOPS NEVER REACHES MINEFLAYER (the stop invalidates; validate refuses it)', async () => {
  // Codex's repro: slots 9-35 full, bamboo in hotbar slot 36, a recent dig delays the pick-up click ~500 ms; the
  // abort lands inside that delay. The click must never reach mineflayer: no write, no local application.
  const r = await gridTrial({
    inv: fillHotbarCase(),
    before: ({ bot, abort }) => {
      let armed = false
      bot._client.on('window_items', (p) => {          // the baseline resync's answer: the pick-up click is next
        if (armed || p.windowId !== 0) return
        armed = true
        bot.lastDigTime = new Date()                     // mineflayer: a hotbar click within 500 ms of a dig waits
        setTimeout(abort, 200)                           // inside the delay
      })
    },
  })
  await new Promise(resolve => setTimeout(resolve, 700))   // past the delay
  await r.server.settle()
  const a = crow(r)
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.equal(a.pre_invoke_refusals, 1, 'POSITIVE CONTROL: the held click must have been refused before mineflayer ran')
  assert.equal(r.rows.filter(e => e.event === 'click_refused').length, 1)
  assert.equal(a.late_clicks_dropped, 0, 'nothing was issued, so nothing had to be dropped')
  assert.equal(r.server.cursor, null); assert.equal(bag(r.server, 'bamboo'), 10); assert.equal(gridOf(r.server, false), 0)
  assert.equal(r.bot.inventory.selectedItem, null); assert.equal(r.bot.inventory.slots[36]?.name, 'bamboo')
  assert.equal(a.grid_clear, 'na_no_clicks', 'no window-0 click went out')
  assert.equal(a.inflight_at_release, 0)
})

await t('P1 CODEX ROUND 3: the SECOND hotbar click held PAST the cleanup\'s inflight bound never writes -- and the row says unverified_inflight', async () => {
  // Both ingredients in the grid, 8 bamboo on the cursor; the put-away into hotbar slot 36 is then held by digs that
  // keep re-arming the delay for 2.5 s -- longer than inflightWaitMs (1.5 s). Before: the hook dropped it at the
  // bound while mineflayer had applied it locally (local cursor 10, row yes), or the restored writer sent it after
  // the cleanup (server cursor 10, row still yes).
  let rearm = null
  const r = await gridTrial({
    inv: fillHotbarCase(),
    stopAt: (n, bot) => null,
    before: ({ server, bot, abort }) => {
      const recv = server.receive.bind(server)
      let placed = 0, armed = false
      server.receive = (name, params) => {
        const out = recv(name, params)
        if (!armed && name === 'window_click' && params.windowId === 0 && params.slot >= 1 && params.slot <= 4 && params.mouseButton === 1 && ++placed === 2) {
          armed = true
          const t0 = Date.now()
          bot.lastDigTime = new Date()
          rearm = setInterval(() => { if (Date.now() - t0 < 2500) bot.lastDigTime = new Date(); else clearInterval(rearm) }, 100)
          setTimeout(abort, 200)
        }
        return out
      }
    },
  })
  await new Promise(resolve => setTimeout(resolve, 3000))   // past the re-arming and any late write
  clearInterval(rearm)
  await r.server.settle()
  const a = crow(r)
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  // the cooldown is withdraw's (uncancellable, inside its dispatch path): the cleanup waits its bound, clears, and
  // releases with the click still held -- honestly unverified_inflight; when the click finally wakes, its own
  // validate() refuses it (the stop invalidated it) before mineflayer runs
  assert.equal(a.inflight_wait_expired, true); assert.equal(a.inflight_at_release, 1); assert.equal(a.grid_clear, 'unverified_inflight')
  assert.equal(r.rows.filter(e => e.event === 'click_refused').length, 1, 'POSITIVE CONTROL: the held click must have been refused when it woke')
  assert.equal(r.server.cursor, null, 'the held click was written after all'); assert.equal(bag(r.server, 'bamboo'), 10)
  assert.equal(gridOf(r.server, false), 0)
  assert.equal(r.bot.inventory.selectedItem, null, 'mineflayer applied the held click locally')
  assert.equal(a.late_clicks_dropped, 0)
  assert.equal(r.bot.craftSync.inflight(), 0)
})

await t('P2 a disconnect AFTER a preemption is still seen: nothing is sent after it, grid_clear=skipped_disconnected', async () => {
  const r = await gridTrial({ stopAt: n => n === 2 ? 'preempt+disconnect' : null, equip: async () => {} })
  await r.bot.__equipP
  assert.ok(r.error?.aborted && /preempted by equip/.test(r.error.message), `got ${r.error?.message}`)
  assert.equal(closes0(r.after), 0, 'a close was written to a dead connection')
  assert.equal(r.after.filter(w => w.name === 'window_click' && w.params.stateId === -1).length, 0, 'a resync was written to a dead connection')
  assert.equal(crow(r).grid_clear, 'skipped_disconnected')
})

await t('P2 an ERROR exit (a grid click never answered) takes its verdict from the verification\'s own close: grid_clear=yes, no extra close', async () => {
  let dropNext = false
  const r = await gridTrial({
    opts: { clickCapMs: 300 },
    stopAt: n => { if (n === 1) dropNext = true; return null },
    before: ({ server }) => {
      const recv = server.receive.bind(server)
      server.receive = (name, params) => {
        // the second ingredient click is lost: the server neither applies nor answers it
        if (dropNext && name === 'window_click' && params.windowId === 0 && params.slot >= 1 && params.slot <= 4 && params.mouseButton === 1) {
          dropNext = false; server.writes.push({ t: Date.now(), name, params }); return
        }
        return recv(name, params)
      }
    },
  })
  assert.ok(r.error && !r.error.aborted, `expected an unclean non-abort exit, got ${r.error?.message}`)
  assert.equal(crow(r).click_caps, 1, 'the exit must come from the unanswered click')
  assert.equal(gridOf(r.server, false), 0)
  assert.equal(r.server.cursor, null)
  assert.equal(bag(r.server, 'bamboo'), 10)
  // the lost grid click's own wait (slot 0's update) is answered by the verification's resync: nothing left in flight
  assert.equal(crow(r).inflight_at_release, 0)
  assert.equal(crow(r).grid_clear, 'yes', `grid_clear=${crow(r).grid_clear}`)
  assert.equal(closes0(r.writes), 2, 'baseline + verification only: no extra close for the verdict')
})

await t('Claude: a preempting reflex waits through a SLOW clear instead of timing out once (preemptWaitMs far below the clear)', async () => {
  let equipAt = null, busyAtEquip = null
  const r = await gridTrial({
    paper: { fallbackMs: 400 },                         // every resync answer takes ~400 ms: the clear is slow
    opts: { preemptWaitMs: 100 },
    stopAt: n => n === 2 ? 'preempt' : null,
    before: ({ bot }) => { bot.equip = async () => { equipAt = Date.now(); busyAtEquip = bot.craftSync.busy() } },
  })
  await r.bot.__equipP
  assert.ok(r.error?.aborted && /preempted by equip/.test(r.error.message), `got ${r.error?.message}`)
  assert.equal(crow(r).grid_clear, 'yes')
  assert.ok(equipAt !== null, 'the equip never ran')
  assert.equal(busyAtEquip, false, 'the equip ran while the craft still held the inventory')
  assert.equal(crow(r).preempt_timeouts, 0)
})

await t('P1 A CLICK THAT WRITES INSIDE THE BOUND is waited for before the close, dropped by the hook, and repaired locally: yes', async () => {
  // The pick-up click (slot 36) is issued but writes 200 ms later (a pre-write wait craftsync does not own); the craft
  // stops 50 ms after issuing it. No close may go out before it writes; when it does, the hook drops it and mineflayer
  // has applied it locally -- the clear must then repair the local cursor.
  const r = await gridTrial({
    inv: fillHotbarCase(),
    before: ({ bot, abort }) => {
      const real = bot.clickWindow
      let n = 0
      bot.clickWindow = function (slot, b, m) {
        if (++n === 1) {
          setTimeout(abort, 50)
          return new Promise(resolve => setTimeout(resolve, 200)).then(() => real.call(bot, slot, b, m))
        }
        return real.call(bot, slot, b, m)
      }
    },
  })
  const a = crow(r)
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.equal(a.deferred_writes, 1, 'POSITIVE CONTROL: the click must have been issued without writing')
  assert.equal(a.late_clicks_dropped, 1, 'POSITIVE CONTROL: the late write must have reached the hook and been dropped')
  assert.equal(r.server.cursor, null); assert.equal(bag(r.server, 'bamboo'), 10)
  assert.equal(r.bot.inventory.selectedItem, null, 'the dropped click was applied locally and never repaired')
  assert.equal(r.bot.inventory.slots[36]?.name, 'bamboo')
  assert.equal(a.grid_clear, 'yes', `grid_clear=${a.grid_clear}`)
})

await t('P1 A CLICK STILL UNWRITTEN AT THE RELEASE BOUND (a pre-write wait craftsync does not own) says unverified_inflight, never yes', async () => {
  // The known pre-write wait is owned (above). For anything else, the release is bounded and the row is honest.
  const r = await gridTrial({
    opts: { inflightWaitMs: 300 },
    before: ({ bot, abort }) => {
      const real = bot.clickWindow
      let n = 0
      bot.clickWindow = function (slot, b, m) {          // the 2nd underlying click waits 2 s before mineflayer runs it
        if (++n === 2) {
          setTimeout(abort, 100)                         // the craft stops while that click is still unwritten
          return new Promise(resolve => setTimeout(resolve, 2000)).then(() => real.call(bot, slot, b, m))
        }
        return real.call(bot, slot, b, m)
      }
    },
  })
  const a = crow(r)
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.equal(a.deferred_writes, 1, 'POSITIVE CONTROL: one click must have been issued without writing')
  assert.equal(a.inflight_wait_expired, true)
  assert.equal(a.inflight_at_release, 1)
  assert.equal(a.grid_clear, 'unverified_inflight')
  await new Promise(resolve => setTimeout(resolve, 2200))   // let the deferred click land before the next test
})

await t('P1 A LOST WINDOW-0 GRID CLICK IS WAITED FOR, never released by fiat: the wait expires, the clear runs, unverified_inflight', async () => {
  // The second grid click reaches the server but is never applied or answered; the craft is aborted right there.
  // mineflayer's click waits for slot 0's update -- a window that is still open, so the wait is real, not dead.
  let drop = false
  const r = await gridTrial({
    opts: { inflightWaitMs: 300 },
    stopAt: n => { if (n === 1) drop = true; return null },
    before: ({ server, abort }) => {
      const recv = server.receive.bind(server)
      server.receive = (name, params) => {
        if (drop && name === 'window_click' && params.windowId === 0 && params.slot >= 1 && params.slot <= 4 && params.mouseButton === 1) {
          drop = false; server.writes.push({ t: Date.now(), name, params }); abort(); return
        }
        return recv(name, params)
      }
    },
  })
  const a = crow(r)
  assert.ok(r.error?.aborted, `got ${r.error?.message}`)
  assert.equal(a.dead_waits_released, 0, 'a window-0 wait is never released by fiat')
  assert.equal(a.inflight_wait_expired, true, 'POSITIVE CONTROL: the lost click must have held the wait to its bound')
  assert.equal(a.grid_clear, 'unverified_inflight')
  assert.equal(gridOf(r.server, false), 0, 'the clear still ran after the bound'); assert.equal(bag(r.server, 'bamboo'), 10)
})

await t('P2 A REFLEX NEVER CLICKS WHILE THE CRAFT HOLDS THE INVENTORY: past even the release bound it fails busy instead', async () => {
  // Codex: a reflex that ran on a timed-out wait clicked during the cleanup (grid ended with 10 bamboo). The table
  // craft awaiting windowOpen sits out its 100 ms grace; every bound here is ~1 ms, so the release cannot come in time.
  let ran = false
  const r = await gridTrial({
    table: true,
    paper: { openDelayMs: 1500 },
    opts: { preemptWaitMs: 1, inflightWaitMs: 1, gridClearCapMs: 1, quietCapMs: 1, resyncCapMs: 1 },
    before: ({ bot }) => {
      bot.equip = async () => { ran = true }
      setTimeout(() => { bot.__equipP = bot.equip({ name: 'stone_sword' }, 'hand').then(() => null, e => e) }, 600)
    },
  })
  const e = await r.bot.__equipP
  await new Promise(resolve => setTimeout(resolve, 1200)); await r.server.settle()
  assert.equal(crow(r).preempt_timeouts, 1, 'POSITIVE CONTROL: the release bound must have passed')
  assert.equal(ran, false, 'the reflex clicked while the craft still held the inventory')
  assert.equal(e?.failClass, 'craft_busy', `the reflex should fail busy, got ${e?.message}`)
})

await t('P2 ...and with the default release bound the same reflex simply waits: it runs after the release', async () => {
  let busyAtRun = null
  const r = await gridTrial({
    table: true,
    paper: { openDelayMs: 1500 },
    opts: { preemptWaitMs: 1 },
    before: ({ bot }) => {
      bot.equip = async () => { busyAtRun = bot.craftSync.active() !== null }
      setTimeout(() => { bot.__equipP = bot.equip({ name: 'stone_sword' }, 'hand') }, 600)
    },
  })
  await r.bot.__equipP
  await new Promise(resolve => setTimeout(resolve, 1200)); await r.server.settle()
  assert.equal(busyAtRun, false); assert.equal(crow(r).preempt_timeouts, 0)
})

await t('EVERY EXIT HAS A VERDICT: busy, an entry abort, an entry deadline, an admission refusal, a table craft, a 2x2 craft', async () => {
  const seen = {}
  const r = await gridTrial({ signal: false })                                 // a 2x2 success
  seen.ok2x2 = crow(r).grid_clear
  const { bot, recipe, rows } = r
  const ac = new AbortController(); ac.abort()
  const go = async (opts) => { try { await bot.craft(recipe, 1, undefined, opts) } catch {} ; return rows.filter(x => x.kind === 'craft_sync').at(-1).args.grid_clear }
  seen.entryAbort = await go({ signal: ac.signal })
  seen.entryDeadline = await go({ deadline: Date.now() - 1 })
  seen.admission = await go({ admit: () => ({ ok: false, reason: 'test' }) })
  const p1 = bot.craft(recipe, 1, undefined, {}).catch(() => {}); seen.busy = await go({}); await p1
  const t = await gridTrial({ table: true, signal: false }); seen.table = crow(t).grid_clear
  assert.deepEqual(seen, { ok2x2: 'na_clean', entryAbort: 'na_no_clicks', entryDeadline: 'na_no_clicks', admission: 'na_no_clicks',
                           busy: 'na_no_clicks', table: 'na_no_clicks' })
})

await t('gridExitVerdict: the precedence the read gates on', () => {
  const V = CS.gridExitVerdict
  assert.equal(V({ outcome: 'aborted', w0Clicks: 3, disconnected: true, cleared: 'skipped_disconnected', inflightAtRelease: 1 }), 'skipped_disconnected')
  assert.equal(V({ outcome: 'aborted', w0Clicks: 3, cleared: 'yes', inflightAtRelease: 1 }), 'unverified_inflight', 'in flight beats a yes')
  assert.equal(V({ outcome: 'aborted', w0Clicks: 3, cleared: 'yes', lateAfterClear: 1 }), 'unverified_inflight', 'a drop after the clear beats a yes')
  assert.equal(V({ outcome: 'aborted', w0Clicks: 3, cleared: 'yes', inflightWaitExpired: true }), 'unverified_inflight', 'an expired wait beats a later yes')
  assert.equal(V({ outcome: 'aborted', w0Clicks: 3, cleared: 'yes' }), 'yes')
  assert.equal(V({ outcome: 'ok', w0Clicks: 6, closeVerdict: { clear: 'no' } }), 'no', 'residue is never hidden, even on success')
  assert.equal(V({ outcome: 'deadline', w0Clicks: 3, closeVerdict: { clear: 'yes' } }), 'yes')
  assert.equal(V({ outcome: 'ok', w0Clicks: 6, closeVerdict: { clear: 'yes' } }), 'na_clean')
  assert.equal(V({ outcome: 'refused', w0Clicks: 0 }), 'na_no_clicks')
  assert.equal(V({ outcome: 'aborted', w0Clicks: 2 }), 'unverified_noverdict', 'clicks with no verdict are never n/a')
  assert.equal(V({}), 'na_no_clicks')
})

// ------------------------------------------------------------------ round 4: the craft's window (Codex, reproduced)
const TABLE_CASE = () => ({ 36: ['bamboo', 10], 37: ['dirt', 64] })   // table slot 37 = player 36 (bamboo); player 37 = dirt
const nonProbeW0 = (writes) => writes.filter(w => w.name === 'window_click' && w.params.windowId === 0 && w.params.stateId !== -1)
const closeTable = (server, bot) => { const id = server.tableId; server.onClose({ windowId: id }); bot._client.emit('close_window', { windowId: id }); return id }

await t('R4 CODEX: the table closes 200 ms into the after-dig delay of a click on table slot 37 -> nothing reaches window 0, the craft stops with a verdict', async () => {
  let closedAt = null
  const r = await gridTrial({
    table: true, inv: TABLE_CASE(), signal: false,
    before: ({ server, bot }) => {
      let armed = false
      bot._client.on('window_items', (p) => {          // the table's contents: mineflayer's first click is next
        if (armed || p.windowId === 0) return
        armed = true
        bot.lastDigTime = new Date()                     // that click (table slot 37, hotbar) waits out the delay
        setTimeout(() => { closedAt = server.writes.length; closeTable(server, bot) }, 200)
      })
    },
  })
  await new Promise(resolve => setTimeout(resolve, 700)); await r.server.settle()
  const a = crow(r)
  assert.ok(closedAt !== null, 'the table never closed')
  assert.deepEqual(nonProbeW0(r.server.writes.slice(closedAt)), [], 'a craft click reached window 0')
  assert.equal(r.server.p[37]?.count, 64, 'the dirt in player slot 37 was moved')
  assert.equal(gridOf(r.server, false), 0); assert.equal(bag(r.server, 'bamboo'), 10)
  assert.equal(a.window_changes, 1); assert.equal(a.pre_invoke_refusals, 1)
  assert.equal(r.bot.craftSync.tracker.live, 0, 'the refused ticket must leave the live set')
  assert.equal(a.bind_drops, 0, 'refused before mineflayer was invoked, not dropped on the wire after it')
  assert.equal(r.error?.reason, 'window_changed', `got ${r.error?.message}`)
  assert.equal(r.bot.inventory.selectedItem, null, 'nothing was applied locally')
  assert.ok(a.grid_clear && a.grid_clear !== 'no', `the craft must end with a verdict, got ${a.grid_clear}`)
})

await t('R4 PUT-AWAY: the table closes right after the result is picked up -> the put-away click never lands in window 0, a verdict', async () => {
  let closedAt = null
  const r = await gridTrial({
    table: true, inv: TABLE_CASE(), signal: false,
    before: ({ server, bot }) => {
      const recv = server.receive.bind(server)
      server.receive = (name, params) => {
        const out = recv(name, params)
        if (closedAt === null && name === 'window_click' && params.windowId !== 0 && params.slot === 0 && params.mode === 0) {
          closedAt = server.writes.length                // the result is on the cursor; putAway's next click is pending
          setImmediate(() => closeTable(server, bot))
        }
        return out
      }
    },
  })
  await r.server.settle()
  const a = crow(r)
  assert.ok(closedAt !== null, 'POSITIVE CONTROL: the result click never happened')
  assert.deepEqual(nonProbeW0(r.server.writes.slice(closedAt)), [], 'a put-away click reached window 0')
  assert.equal(r.server.p[37]?.count, 64)
  assert.equal(a.window_changes, 1)
  assert.equal(r.error?.reason, 'window_changed', `got ${r.error?.message}`)
  assert.ok(a.grid_clear, 'a verdict')
})

await t('R4 HOOK: a dispatched click written to another window than its ticket\'s is dropped on the wire (withdraw\'s backstop), repaired by the next recount', async () => {
  // the window flips INSIDE mineflayer's call -- after the pre-invoke check -- so only the wire filter can see it
  let flipped = false
  const r = await gridTrial({
    table: true, inv: TABLE_CASE(), signal: false,
    before: ({ server, bot }) => {
      let n = 0
      const real = bot.clickWindow
      bot.clickWindow = function (slot, b, m) {
        if (++n === 1) { flipped = true; closeTable(server, bot) }   // mineflayer will now read window 0
        return real.call(bot, slot, b, m)
      }
    },
  })
  await r.server.settle()
  const a = crow(r)
  assert.ok(flipped)
  assert.equal(r.bot.craftSync.dropped(), 1, 'the wrong-window write must be dropped by the filter')
  assert.equal(a.bind_drops, 1); assert.equal(a.pre_invoke_refusals, 0, 'it passed the pre-invoke check: the wire was the backstop')
  assert.deepEqual(nonProbeW0(r.server.writes), [], 'a click reached window 0')
  assert.equal(r.server.p[37]?.count, 64)
  // withdraw round 6: no background repair -- it is pending until craftsync's own next operation
  assert.ok(!r.rows.some(e => e.event === 'click_drop_repair'), 'a repair ran in the background')
  assert.ok(r.bot.craftSync.repairPending(), 'the drop must leave a repair pending')
  const rc = await CS.serverRecount(r.bot)
  assert.equal(rc.source, 'server')
  assert.ok(r.rows.some(e => e.event === 'click_drop_repair' && e.how === 'recount_server'), JSON.stringify(r.rows.filter(e => e.event)))
  assert.equal(r.bot.craftSync.repairPending(), null)
  assert.equal(r.bot.inventory.selectedItem ?? null, null, 'the local cursor is the server\'s')
})

// ------------------------------------------------------------------ the verdict, pure
await t('gridClearVerdict: empty grid + cursor is clear; any slot 1-4 or the cursor is residue; no packet is not clear', () => {
  const empty = { itemCount: 0 }
  const items = [empty, empty, empty, empty, empty, { itemId: 7, itemCount: 3 }]   // slot 5 is armour: not the grid
  assert.deepEqual(CS.gridClearVerdict({ items, carriedItem: empty }), { clear: true, residue: [] })
  assert.deepEqual(CS.gridClearVerdict({ items: [empty, empty, { itemId: 1, itemCount: 1 }], carriedItem: { itemId: 1, itemCount: 8 } }).residue,
    ['slot2:1x1', 'cursor:1x8'])
  assert.equal(CS.gridClearVerdict({ items: [empty, empty, empty, empty, { itemId: 2, itemCount: 1 }], carriedItem: empty }).clear, false)
  assert.equal(CS.gridClearVerdict(null).clear, false)
})

await new Promise(resolve => setTimeout(resolve, 50))
assert.equal(unhandled, 0)
console.log(`\n${pass} passed, ${fail} failed${unhandled ? `, ${unhandled} unhandled rejections` : ''}`)
process.exit(fail || unhandled ? 1 : 0)
