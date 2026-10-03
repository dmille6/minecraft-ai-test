// CRAFTSYNC: clicks in lockstep with the server while bot.craft runs.
//
// WHAT IS BROKEN (sandbox A/B, RCON-verified, 2026-10-03). With spare ingredients in the bag, unpatched
// mineflayer 4.37.1 on Paper 1.21.8 lost 7/40 single table crafts, 3/20 2x2 crafts, and came up short on 11/20
// repeated crafts in one window -- every one of them reported as success. The mechanism, read off the packet trace:
//
//   1. mineflayer keeps ONE global stateId (lib/plugins/inventory.js: the last set_slot/window_items of ANY
//      window). Paper sends a window-0 slot update after each container click, so the stateId mineflayer sends
//      with a crafting-table click is usually window 0's -- stale for the table.
//   2. On 1.17+ clicks are fire-and-forget: clickWindow writes the packet and returns at once for every slot
//      outside the grid, so put-away, result pick-up and store go out as one burst.
//   3. Paper APPLIES a stale-stateId click, then answers with a full refresh of the window. That refresh is a
//      snapshot of the moment it was made, and it lands behind the burst: it reverts a slot the client has
//      already changed locally.
//   4. The next put-away decides on the reverted slot (merges into a stack that is no longer there); on the
//      server that click SWAPS, the cursor is left holding an ingredient, the result click picks up nothing,
//      and closing the window hands the grid back. Nothing was crafted; mineflayer resolves.
//
// THE FIX (arm A of the A/B: 0/20, 0/10, 0/10): while a craft runs, every click waits for the window to go
// quiet before the next one goes out, so no refresh can land behind a later click. The first click in a
// container window is preceded by a forced resync (a no-op click with stateId -1, which Paper answers with a
// full refresh) so the craft starts from the server's view, not the client's. Arm B -- sending the window's own
// last stateId instead of the global one -- is cheap and rides along; alone it left 3/10 short on repeats.
//
// Cost: ~1.3-1.4 s per craft (median, sandbox). Every wait is capped -- quiet at 1 s, one click at 1.5 s,
// the resync answer at 1 s -- so a craft cannot hang on a server that stops answering.
//
// SCOPE. Nothing here is active outside bot.craft. The click/put-away wrappers and the write hook go in when a
// craft starts and come out in a finally, whatever the craft does (returns, throws, is aborted).
//
// WHY AT SPAWN. mineflayer injects its plugins after login, so at createBot time bot.craft does not exist yet;
// a wrapper installed there was silently overwritten in the sandbox experiment. installCraftSync refuses to run
// against a bot whose plugins have not loaded rather than wrapping nothing.

/** Defaults, measured on the sandbox. Exported so a test can assert them and pass smaller ones for speed. */
export const CRAFT_SYNC = Object.freeze({
  quietMs: 100,         // no window traffic for this long = the server has answered
  quietCapMs: 1000,     // never wait longer than this for quiet
  clickCapMs: 1500,     // never wait longer than this for mineflayer's own click promise
  resyncCapMs: 1000,    // never wait longer than this for the resync's answer
  pollMs: 10,
  maxPutIterations: 64, // put-away loop bound (mineflayer's is unbounded)
  rewriteStateId: true, // arm B; false runs arm A alone (the sandbox's A-only arm, and the tests' A-only proof)
})

/** The resync click: outside the window, empty cursor, stateId -1. Paper applies a no-op and sends a full refresh.
 *  Field names are minecraft-data 1.21.8 `packet_window_click`; the empty cursor is exactly what
 *  prismarine-item's Item.toNotch(null) produces for 1.21.8, i.e. what mineflayer itself sends for no cursor. */
export function resyncPacket (windowId) {
  return {
    windowId, stateId: -1, slot: -999, mouseButton: 0, mode: 0, changedSlots: [],
    cursorItem: { itemCount: 0, components: [], removeComponents: [] },
  }
}

/** Arm B: the click's stateId replaced by the last one seen FOR THAT WINDOW. Returns the params to send. */
export function withWindowStateId (params, lastStateIds) {
  const sid = lastStateIds.get(params?.windowId)
  if (sid === undefined || sid === params.stateId) return params
  return { ...params, stateId: sid }
}

/** Is the window quiet? At least quietMs since the wait began (the answer to a click just sent cannot have
 *  arrived yet) AND since the last packet touching this window, window 0, or the cursor. Pure. */
export function quietReached ({ now, start, lastPacketAt, quietMs }) {
  return now - start >= quietMs && now - lastPacketAt >= quietMs
}

const WINDOW_PACKETS = ['set_slot', 'window_items', 'set_cursor_item', 'set_player_inventory']

/**
 * Wrap bot.craft so each craft runs in lockstep. Call at SPAWN, after mineflayer's plugins have loaded.
 * opts: { log(row), now(), sleep(ms), ...CRAFT_SYNC overrides }. Returns the controller (also bot.craftSync).
 * bot.craft keeps mineflayer's signature plus an optional 4th argument { signal }: an aborted signal stops the
 * waits and refuses the next click, so mineflayer's own catch closes the window and the craft rejects.
 */
export function installCraftSync (bot, opts = {}) {
  if (bot.craftSync) return bot.craftSync
  for (const fn of ['craft', 'clickWindow', 'putAway', 'putSelectedItemRange']) {
    if (typeof bot[fn] !== 'function') throw new Error(`installCraftSync: bot.${fn} missing -- mineflayer plugins not loaded yet; install at spawn`)
  }
  if (!bot._client || typeof bot._client.write !== 'function') throw new Error('installCraftSync: no bot._client')
  const cfg = { ...CRAFT_SYNC, ...opts }
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const log = opts.log ?? (() => {})

  // Inbound window traffic, always tracked (a Map write per packet): when, how many, and each window's stateId.
  const lastAt = new Map()     // windowId -> ms of the last packet for it ('cursor' for set_cursor_item)
  const seen = new Map()       // windowId -> packets received, so "did anything answer" is not a timestamp tie
  const stateIds = new Map()   // windowId -> last stateId
  const mark = (win) => { lastAt.set(win, now()); seen.set(win, (seen.get(win) ?? 0) + 1) }
  for (const name of WINDOW_PACKETS) {
    bot._client.on(name, (p) => {
      if (name === 'set_cursor_item') return mark('cursor')
      if (name === 'set_player_inventory') return mark(0)
      if (p?.windowId === undefined) return
      mark(p.windowId)
      if (p.stateId !== undefined) stateIds.set(p.windowId, p.stateId)
    })
  }
  const lastPacketAt = (win) => Math.max(lastAt.get(win) ?? 0, lastAt.get(0) ?? 0, lastAt.get('cursor') ?? 0)

  const origCraft = bot.craft
  let active = null   // the in-flight craft's state; non-null exactly while the wrappers are installed

  const abortError = () => new Error('craft aborted')
  const aborted = (st) => !!st.signal?.aborted

  async function waitQuiet (st, win) {
    const start = now()
    for (;;) {
      const t = now()
      if (quietReached({ now: t, start, lastPacketAt: lastPacketAt(win), quietMs: cfg.quietMs })) break
      if (t - start >= cfg.quietCapMs) { st.quietCaps++; break }
      if (aborted(st)) break
      await sleep(cfg.pollMs)
    }
    st.waitMs += now() - start
  }

  async function waitAnswer (st, win, before) {
    const start = now()
    let got = false
    for (;;) {
      if ((seen.get(win) ?? 0) > before) { got = true; break }
      if (now() - start >= cfg.resyncCapMs || aborted(st)) break
      await sleep(cfg.pollMs)
    }
    st.waitMs += now() - start
    return got
  }

  /** mineflayer's click promise, never waited on longer than clickCapMs. A rejection inside the cap is the
   *  craft's error; one after it is swallowed (the craft has moved on, and an unhandled rejection kills the bot). */
  async function cappedClick (st, orig, slot, button, mode) {
    let settled = false, failed = false, error = null
    const p = (async () => orig.call(bot, slot, button, mode))()   // a synchronous throw becomes a rejection
    p.then(() => { settled = true }, (e) => { settled = true; failed = true; error = e })
    const start = now()
    while (!settled) {
      if (now() - start >= cfg.clickCapMs) { st.clickCaps++; break }
      if (aborted(st)) break
      await sleep(cfg.pollMs)
    }
    st.waitMs += now() - start
    if (failed) throw error
  }

  function install (st) {
    const orig = {
      clickWindow: bot.clickWindow,
      putAway: bot.putAway,
      putSelectedItemRange: bot.putSelectedItemRange,
      write: bot._client.write,
    }
    let resyncing = false

    // (a) LOCKSTEP. Resync once per container window, then every click: send, bounded wait, wait for quiet.
    const clickWindow = async function (slot, mouseButton, mode) {
      if (aborted(st)) throw abortError()
      const win = (bot.currentWindow || bot.inventory)?.id ?? 0
      if (win !== 0 && !st.resynced.has(win)) {
        st.resynced.add(win)
        await waitQuiet(st, win)
        const before = seen.get(win) ?? 0
        resyncing = true
        try { orig.write.call(bot._client, 'window_click', resyncPacket(win)) } finally { resyncing = false }
        st.resyncs++
        if (await waitAnswer(st, win, before)) st.resyncAnswered++
        else st.resyncCaps++
        await waitQuiet(st, win)
        if (aborted(st)) throw abortError()
      }
      st.clicks++
      await cappedClick(st, orig.clickWindow, slot, mouseButton, mode)
      await waitQuiet(st, win)
    }

    // (b) mineflayer's putAway/putSelectedItemRange call its INTERNAL clickWindow, not bot.clickWindow, so the
    // put-away burst -- the clicks this whole defect lives in -- would bypass the lockstep. These are copies of
    // mineflayer 4.37.1's two functions with every click routed through bot.clickWindow, and with bounds.
    const putSelectedItemRange = async function (start, end, window, slot) {
      for (let i = 0; window.selectedItem; i++) {
        if (i >= cfg.maxPutIterations) throw new Error(`craftsync: put-away did not empty the cursor in ${i} clicks`)
        const item = window.findItemRange(start, end, window.selectedItem.type, window.selectedItem.metadata, true, window.selectedItem.nbt)
        if (item && item.stackSize !== item.count) {
          await bot.clickWindow(item.slot, 0, 0)
        } else {
          const empty = window.firstEmptySlotRange(start, end)
          if (empty === null) {
            if (slot !== null) await bot.clickWindow(slot, 0, 0)
            if (window.selectedItem) await bot.clickWindow(-999, 0, 0)
          } else {
            await bot.clickWindow(empty, 0, 0)
          }
        }
      }
    }
    const putAway = async function (slot) {
      const window = bot.currentWindow || bot.inventory
      let updated = false
      const onUpdate = () => { updated = true }
      window.once?.(`updateSlot:${slot}`, onUpdate)
      try {
        await bot.clickWindow(slot, 0, 0)
        await bot.putSelectedItemRange(window.inventoryStart, window.inventoryEnd, window, null)
        // mineflayer awaits this with its 20 s once(); the local click normally fires it synchronously.
        const start = now()
        while (!updated && now() - start < cfg.clickCapMs && !aborted(st)) await sleep(cfg.pollMs)
      } finally {
        window.removeListener?.(`updateSlot:${slot}`, onUpdate)
      }
    }

    // (c) Arm B: each click carries its own window's last stateId. The resync's -1 is deliberate and untouched.
    const write = function (name, params) {
      if (name === 'window_click' && !resyncing && cfg.rewriteStateId) {
        const fixed = withWindowStateId(params, stateIds)
        if (fixed !== params) st.rewrites++
        params = fixed
      }
      return orig.write.call(this, name, params)
    }

    const mine = { clickWindow, putAway, putSelectedItemRange }
    Object.assign(bot, mine)
    bot._client.write = write

    return function restore () {
      for (const k of Object.keys(mine)) {
        if (bot[k] === mine[k]) bot[k] = orig[k]
        else st.restoreConflicts++
      }
      if (bot._client.write === write) bot._client.write = orig.write
      else st.restoreConflicts++
    }
  }

  async function craft (recipe, count, craftingTable, options) {
    // A craft started while another is still running (a hard-stopped skill's craft finishing in the background)
    // runs under the same lockstep; the outer craft owns install/restore and the row.
    if (active) { active.overlapped++; return origCraft.call(bot, recipe, count, craftingTable) }
    const st = active = {
      signal: options?.signal, resynced: new Set(), clicks: 0, resyncs: 0, resyncAnswered: 0, waitMs: 0,
      quietCaps: 0, clickCaps: 0, resyncCaps: 0, rewrites: 0, restoreConflicts: 0, overlapped: 0,
    }
    const t0 = now()
    let restore = null, error = null
    try {
      restore = install(st)
      return await origCraft.call(bot, recipe, count, craftingTable)
    } catch (e) {
      error = e
      throw e
    } finally {
      try { restore?.() } finally { active = null }
      emitRow(st, { recipe, count, craftingTable, error, durationMs: now() - t0 })
    }
  }

  function emitRow (st, { recipe, count, craftingTable, error, durationMs }) {
    try {
      const item = bot.registry?.items?.[recipe?.result?.id]?.name ?? String(recipe?.result?.id ?? '?')
      const args = {
        item, count: Number(count ?? 1), table: !!craftingTable,
        clicks: st.clicks, resyncs: st.resyncs, resync_answered: st.resyncAnswered,
        wait_ms: Math.round(st.waitMs), quiet_caps: st.quietCaps, click_caps: st.clickCaps,
        resync_caps: st.resyncCaps, stateid_rewrites: st.rewrites, aborted: aborted(st),
        restore_conflicts: st.restoreConflicts, overlapped: st.overlapped,
      }
      log({
        kind: 'craft_sync',
        status: error ? 'failed' : 'success',
        durationMs,
        detail: `${item} x${args.count}${args.table ? ' (table)' : ''}: ${st.clicks} clicks, resync ${st.resyncAnswered}/${st.resyncs}, ` +
                `waited ${args.wait_ms} ms, caps quiet ${st.quietCaps} click ${st.clickCaps} resync ${st.resyncCaps}` +
                (error ? `; ${String(error.message ?? error).slice(0, 80)}` : ''),
        args,
      })
    } catch { /* telemetry never breaks a craft */ }
  }

  bot.craft = craft
  const controller = { cfg, active: () => active, original: origCraft }
  bot.craftSync = controller
  return controller
}
