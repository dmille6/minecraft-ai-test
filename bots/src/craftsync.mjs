// CRAFTSYNC: clicks in lockstep with the server while bot.craft runs, and VERIFIES what came out.
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
// TWO LAYERS, and only one of them is allowed to say "crafted".
//
//   LOCKSTEP (best effort; arm A of the A/B: 0/20, 0/10, 0/10). While a craft runs every click waits for the
//   window to go quiet before the next goes out, so a refresh cannot land behind a later click. The first click
//   in a container is preceded by a forced resync (a no-op click with stateId -1 that Paper answers with a full
//   refresh). Arm B -- each click carries its own window's last stateId -- rides along. This RAISES the success
//   rate; it cannot guarantee it: a refresh slower than the quiet window still lands behind a click (the test
//   suite shows one).
//
//   VERIFICATION (truth). Before and after the craft, window 0 is resynced from the server and the result item
//   counted. The craft resolves only if the count rose by count x result.count; otherwise it throws, with what
//   was produced. A click that is not answered in time rejects. Nothing is reported as made that the server's
//   own inventory does not show.
//
// THE RESYNC IS ONLY SENT WHEN IT IS PROVABLY A NO-OP. Slot -999 with a held cursor DROPS the cursor. So the
// resync goes out only when the server's cursor is known empty: the last server statement about it (a
// window_items' carriedItem, set_cursor_item, set_slot -1/-1) said empty, or a close_window was sent (the server
// returns the carried stack on close) -- and no click has been sent since. Otherwise it is skipped and counted.
// Only a window_items for THAT window counts as the resync's answer.
//
// EXCLUSIVE. One craft at a time ("craft busy" otherwise). For the craft's duration bot.equip / unequip /
// moveSlotItem / toss / tossStack first abort the craft and wait (at most preemptWaitMs) for it to unwind, then
// proceed: a reflex is never blocked long and never interleaves its clicks with a craft's.
//
// THE 2x2 GRID IS NEVER LEFT LOADED (sandbox 10-04: an aborted bamboo fold left 2 bamboo in the grid and 8 on the
// cursor -- out of the bag while online, on the ground at logout). mineflayer closes a crafting TABLE in its own
// catch, so the server hands that grid back; it never closes window 0, and the abort path never verified (the only
// close_window 0 was the verification's). Now: on ANY exit with window-0 clicks after the last close of window 0
// (abort, preemption, mineflayer's own throw), while craftsync still owns the inventory, it sends close_window 0
// (Paper returns grid + cursor to the bag), clears mineflayer's LOCAL cursor and grid as a vanilla client does on
// close, resyncs window 0 on its own budget (gridClearCapMs) and reads slots 1-4 and the cursor off the server's
// answer: grid_clear on the row. Not on a disconnect (nothing can be sent). The local clear matters on its own:
// mineflayer never reads a window_items' carriedItem, so a stale cursor belief outlived the close and the NEXT
// 2x2 craft skipped its pick-up click and failed. The baseline close clears it too.
//
// CANCELLATION (signal, deadline, preemption, disconnect) returns promptly even while mineflayer is awaiting
// windowOpen: the craft is raced against it and every wrapper is restored -- except a one-line FUSE left on
// bot.clickWindow until the abandoned mineflayer craft settles (its own 20 s windowOpen timeout at worst), so a
// window that opens late cannot be clicked by a craft nobody is waiting for. The fuse throws; mineflayer's own
// catch then closes the window.
//
// WHY AT SPAWN. mineflayer injects its plugins after login, so at createBot time bot.craft does not exist yet;
// a wrapper installed there was silently overwritten in the sandbox experiment. installCraftSync refuses to run
// against a bot whose plugins have not loaded rather than wrapping nothing.

/** Defaults, measured on the sandbox. Exported so a test can assert them and pass smaller ones for speed. */
export const CRAFT_SYNC = Object.freeze({
  quietMs: 100,          // no window traffic for this long = the server has answered
  quietCapMs: 1000,      // never wait longer than this for quiet
  clickCapMs: 4000,      // a click mineflayer has not finished in this long REJECTS the craft (server lag spikes
                         // run to seconds; click_caps on the row is the tripwire if this is still too short)
  resyncCapMs: 1000,     // never wait longer than this for a resync's window_items
  pollMs: 10,
  maxPutIterations: 64,  // put-away loop bound (mineflayer's is unbounded)
  rewriteStateId: true,  // arm B; false runs arm A alone (the sandbox's A-only arm, and the tests' A-only proof)
  verifyReserveMs: 600,  // clicks stop this long before the deadline so verification fits inside it
  preemptWaitMs: 2000,   // an inventory action waits at most this long for a craft to unwind
  gridClearCapMs: 1500,  // the grid clear's own budget after an unclean exit (inside preemptWaitMs: a reflex
                         // waiting on the craft is held at most this long more)
})

export const GUARDED_INVENTORY_ACTIONS = ['equip', 'unequip', 'moveSlotItem', 'toss', 'tossStack']

/** Every refusal/failure craftsync raises itself. failClass is the skill's; `aborted` marks an interruption. */
export class CraftSyncError extends Error {
  constructor (message, { failClass, aborted = false, produced = null, requested = null, reason = null } = {}) {
    super(message)
    this.name = 'CraftSyncError'
    this.failClass = failClass
    this.aborted = aborted
    this.produced = produced
    this.requested = requested
    this.reason = reason
  }
}

/** The resync click: outside the window, empty cursor, stateId -1. Paper applies a no-op and sends a full refresh.
 *  Field names are minecraft-data 1.21.8 `packet_window_click`; the empty cursor is exactly what
 *  prismarine-item's Item.toNotch(null) produces for 1.21.8, i.e. what mineflayer itself sends for no cursor.
 *  ONLY a no-op when the server's cursor is empty -- see cursorProvablyEmpty. */
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

/** Is the server's cursor provably empty for `win`? `proof` is the last empty-cursor statement ({ win, clicks },
 *  win 'any' for a close or a cursor packet), `clicksSent` the clicks written since the craft began. Pure. */
export function cursorProvablyEmpty (proof, win, clicksSent) {
  return !!proof && (proof.win === win || proof.win === 'any') && proof.clicks === clicksSent
}

/** Did the craft deliver? produced = after - before; confirmed only when it covers the request AND both counts
 *  came from the server (an answered window-0 resync). A local count is mineflayer's belief -- the very thing
 *  that reported the lost crafts as made -- so it can never confirm. Pure. */
export function craftConfirmed ({ before, after, count, perCraft, authoritative = false }) {
  const requested = Number(count ?? 1) * Number(perCraft ?? 1)
  const produced = (Number.isFinite(before) && Number.isFinite(after)) ? after - before : null
  return { requested, produced, confirmed: authoritative === true && produced !== null && produced >= requested }
}

const emptySlot = (item) => !(item && item.itemCount > 0)

/**
 * After a grid clear: does the server's window-0 window_items show the 2x2 grid (slots 1-4) AND the cursor empty?
 * -> { clear, residue: ['slot2:<itemId>x1', 'cursor:<itemId>x8', ...] }. No packet is not clear. Pure.
 */
export function gridClearVerdict (packet) {
  if (!packet || !Array.isArray(packet.items)) return { clear: false, residue: ['no window_items'] }
  const residue = []
  const say = (where, it) => residue.push(`${where}:${it.itemId ?? '?'}x${it.itemCount}`)
  for (let i = 1; i <= 4; i++) if (!emptySlot(packet.items[i])) say(`slot${i}`, packet.items[i])
  if (!emptySlot(packet.carriedItem)) say('cursor', packet.carriedItem)
  return { clear: residue.length === 0, residue }
}

/**
 * ADMISSION (opt-in): ask the caller's `admit(items, { source })` about the bag craftsync just resynced -> null (go
 * ahead) or the refusal { failClass, reason, detail }. Pure. `true` or { ok: true } admits; anything else refuses, and an
 * admit that THROWS refuses too (fail closed: an unchecked craft is the one that can toss its result).
 */
export function admissionRefusal (admit, items, ctx = {}) {
  let v
  try { v = admit(items, ctx) } catch (e) { return { failClass: 'craft_room', reason: 'admit_threw', detail: String(e?.message ?? e).slice(0, 80) } }
  if (v === true || v?.ok === true) return null
  return { failClass: v?.failClass ?? 'craft_room', reason: v?.reason ?? 'refused_by_admit', detail: v?.detail ?? null }
}

/**
 * Wrap bot.craft so each craft runs in lockstep and is verified. Call at SPAWN, after mineflayer's plugins load.
 * opts: { log(row), now(), sleep(ms), ...CRAFT_SYNC overrides }. Returns the controller (also bot.craftSync).
 * bot.craft(recipe, count, table, { signal, deadline, admit }): an aborted signal or a passed deadline stops the craft.
 * `admit` (optional) is asked AFTER the baseline window-0 resync and BEFORE the first click (admissionRefusal); a
 * refusal throws CraftSyncError with its failClass/reason and sends no craft click. With `admit` and an UNANSWERED
 * baseline the craft is refused unasked (craft_room / baseline_unanswered). Without `admit` nothing changes.
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

  const origCraft = bot.craft
  let active = null   // the in-flight craft's state; non-null exactly while its wrappers are installed
  let zombie = null   // an abandoned mineflayer craft still pending (the fuse is on bot.clickWindow until it settles)
  let craftSeq = 0

  // Inbound window traffic, always tracked (a Map write per packet).
  const lastAt = new Map()     // windowId -> ms of the last packet for it ('cursor' for cursor packets)
  const itemsSeen = new Map()  // windowId -> window_items received: the ONLY thing that answers a resync
  const stateIds = new Map()   // windowId -> last stateId
  const lastItems = new Map()  // windowId -> the last window_items packet (the grid clear reads window 0's)
  const touch = (win) => {
    lastAt.set(win, now())
    if (active?.awaitingSince != null) {
      active.maxAnswerMs = Math.max(active.maxAnswerMs, now() - active.awaitingSince)
      active.awaitingSince = null
    }
  }
  // A full cursor kills the proof. An empty one sets it -- but never narrows a still-valid one (a window-5
  // window_items must not erase what a close_window already proved for every window).
  const cursorStatement = (win, item) => {
    if (!active) return
    if (!emptySlot(item)) { active.proof = null; return }
    if (!cursorProvablyEmpty(active.proof, active.proof?.win, active.clicksSent)) active.proof = { win, clicks: active.clicksSent }
  }
  bot._client.on('window_items', (p) => {
    if (p?.windowId === undefined) return
    touch(p.windowId)
    itemsSeen.set(p.windowId, (itemsSeen.get(p.windowId) ?? 0) + 1)
    lastItems.set(p.windowId, p)
    if (p.stateId !== undefined) stateIds.set(p.windowId, p.stateId)
    cursorStatement(p.windowId, p.carriedItem)
  })
  bot._client.on('set_slot', (p) => {
    if (p?.windowId === undefined) return
    if (p.windowId === -1 && p.slot === -1) { touch('cursor'); return cursorStatement('any', p.item) }
    touch(p.windowId)
    if (p.stateId !== undefined) stateIds.set(p.windowId, p.stateId)
  })
  bot._client.on('set_cursor_item', (p) => { touch('cursor'); cursorStatement('any', p?.contents) })
  bot._client.on('set_player_inventory', () => touch(0))
  const lastPacketAt = (win) => Math.max(lastAt.get(win) ?? 0, lastAt.get(0) ?? 0, lastAt.get('cursor') ?? 0)

  /** Why should this craft stop clicking? null = keep going. */
  const stopReason = (st) => st.cancelReason ?? (st.signal?.aborted ? 'aborted' : (now() >= st.clickDeadline ? 'deadline' : null))

  async function waitQuiet (st, win, until) {
    const start = now()
    for (;;) {
      const t = now()
      if (quietReached({ now: t, start, lastPacketAt: lastPacketAt(win), quietMs: cfg.quietMs })) break
      if (t - start >= cfg.quietCapMs) { st.quietCaps++; break }
      if (until()) break
      await sleep(cfg.pollMs)
    }
    st.waitMs += now() - start
  }

  /** Resync `win` if, and only if, it is provably a no-op. Returns 'answered' | 'unanswered' | 'skipped'. */
  async function resync (st, win, until) {
    if (!cursorProvablyEmpty(st.proof, win, st.clicksSent)) { st.resyncSkipped++; return 'skipped' }
    await waitQuiet(st, win, until)
    // AGAIN, AT SEND TIME: the wait above is long enough for a cursor packet or a cancellation to arrive, and a
    // proof that was true before it is not proof now.
    if (until() || !cursorProvablyEmpty(st.proof, win, st.clicksSent)) { st.resyncSkipped++; return 'skipped' }
    const before = itemsSeen.get(win) ?? 0
    st.origWrite.call(bot._client, 'window_click', resyncPacket(win))
    st.resyncs++
    const start = now()
    let got = false
    for (;;) {
      if ((itemsSeen.get(win) ?? 0) > before) { got = true; break }
      if (now() - start >= cfg.resyncCapMs || until()) break
      await sleep(cfg.pollMs)
    }
    st.waitMs += now() - start
    if (got) st.resyncAnswered++
    else st.resyncCaps++
    await waitQuiet(st, win, until)
    return got ? 'answered' : 'unanswered'
  }

  /** What a vanilla client does when its inventory screen closes: the carried stack and the 2x2 grid are gone (the
   *  server put them back in the bag, or dropped what did not fit). mineflayer never reads carriedItem, so without
   *  this its cursor belief outlives the close. */
  function closeInventoryLocally () {
    const inv = bot.inventory
    if (!inv) return
    inv.selectedItem = null
    for (let i = 0; i <= 4; i++) if (inv.slots?.[i]) inv.updateSlot(i, null)
  }

  /** The grid clear (see the header). Runs only while `st` owns the inventory; never throws. */
  async function clearGrid (st) {
    if (st.w0Clicks === st.w0CloseMark) return                 // no window-0 click since window 0 was last closed
    if (st.cancelReason === 'disconnected') { st.gridClear = 'skipped_disconnected'; return }
    if (bot.currentWindow) { st.gridClear = 'skipped_window_open'; return }
    const end = now() + cfg.gridClearCapMs
    const until = () => now() >= end || st.cancelReason === 'disconnected'
    try {
      bot._client.write('close_window', { windowId: 0 })     // through the hook: marks the close, proves the cursor
      closeInventoryLocally()
      const r = await resync(st, 0, until)
      if (r !== 'answered') { st.gridClear = `unverified_${r}`; return }
      const v = gridClearVerdict(lastItems.get(0))
      st.gridClear = v.clear ? 'yes' : 'no'
      st.gridResidue = v.residue
    } catch (e) {
      st.gridClear = 'error'
      st.gridResidue = [String(e?.message ?? e).slice(0, 60)]
    }
  }

  /** Window 0 from the server, then the result count. Closing the (inventory) window first makes the cursor
   *  provably empty -- the server hands a carried stack back on close, exactly as when a player shuts the screen. */
  async function serverCount (st, until) {
    let source = 'local'
    if (!bot.currentWindow && !until()) {
      bot._client.write('close_window', { windowId: 0 })   // through the hook: it records the empty-cursor proof
      closeInventoryLocally()
      if (await resync(st, 0, until) === 'answered') source = 'resync'
    } else {
      await waitQuiet(st, 0, until)
    }
    const count = typeof bot.inventory?.count === 'function' ? bot.inventory.count(st.resultId, null) : NaN
    return { count, source }
  }

  /** mineflayer's click, never waited on longer than clickCapMs -- and a cap REJECTS. A rejection that arrives
   *  after the craft moved on is swallowed here (an unhandled rejection kills the bot) and changes nothing. */
  async function cappedClick (st, orig, slot, button, mode) {
    let settled = false, failed = false, error = null
    const p = (async () => orig.call(bot, slot, button, mode))()   // a synchronous throw becomes a rejection
    p.then(() => { settled = true }, (e) => { settled = true; failed = true; error = e })
    const start = now()
    while (!settled) {
      if (now() - start >= cfg.clickCapMs) {
        st.clickCaps++
        st.clickTimedOut = slot
        throw new Error(`craftsync: click on slot ${slot} not answered in ${cfg.clickCapMs} ms`)
      }
      if (stopReason(st)) break
      await sleep(cfg.pollMs)
    }
    st.waitMs += now() - start
    if (failed) throw error
  }

  /** An inventory action arrived mid-craft: stop the craft, wait (bounded, shared) for it to unwind. */
  async function preempt (st, name) {
    if (active !== st) return
    if (!st.cancelReason) st.cancelReason = `preempted by ${name}`
    st.preemptUntil ??= now() + cfg.preemptWaitMs
    while (active === st && now() < st.preemptUntil) await sleep(cfg.pollMs)
    if (active === st) st.preemptTimeouts++
  }

  function install (st) {
    const orig = {
      clickWindow: bot.clickWindow,
      putAway: bot.putAway,
      putSelectedItemRange: bot.putSelectedItemRange,
    }
    for (const name of GUARDED_INVENTORY_ACTIONS) if (typeof bot[name] === 'function') orig[name] = bot[name]
    const origWrite = st.origWrite = bot._client.write
    st.origClick = orig.clickWindow
    const clickPhase = () => !!stopReason(st)

    // (a) LOCKSTEP. Resync once per container window (when safe), then every click: send, bounded wait, quiet.
    const clickWindow = async function (slot, mouseButton, mode) {
      const why = stopReason(st)
      if (why) { st.refused = why; throw new Error(`craftsync: ${why}`) }
      const win = (bot.currentWindow || bot.inventory)?.id ?? 0
      if (win !== 0 && !st.resynced.has(win)) {
        st.resynced.add(win)
        await resync(st, win, clickPhase)          // written below the hook: not counted, not rewritten
        const why2 = stopReason(st)
        if (why2) { st.refused = why2; throw new Error(`craftsync: ${why2}`) }
      }
      st.clicks++
      st.awaitingSince = now()
      await cappedClick(st, orig.clickWindow, slot, mouseButton, mode)
      await waitQuiet(st, win, clickPhase)
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
        while (!updated && now() - start < cfg.clickCapMs && !stopReason(st)) await sleep(cfg.pollMs)
      } finally {
        window.removeListener?.(`updateSlot:${slot}`, onUpdate)
      }
    }

    // (c) The write hook: counts clicks (for the cursor proof), records a close as an empty-cursor statement,
    // and -- arm B -- gives each click its own window's last stateId. The resync's -1 is deliberate and untouched.
    const write = function (name, params) {
      if (name === 'window_click') {
        st.clicksSent++
        if (params?.windowId === 0) st.w0Clicks++
        if (cfg.rewriteStateId) {
          const fixed = withWindowStateId(params, stateIds)
          if (fixed !== params) st.rewrites++
          params = fixed
        }
      } else if (name === 'close_window') {
        const r = origWrite.call(this, name, params)
        st.proof = { win: 'any', clicks: st.clicksSent }
        if (params?.windowId === 0) st.w0CloseMark = st.w0Clicks
        return r
      }
      return origWrite.call(this, name, params)
    }

    // (d) Other inventory actions preempt the craft instead of interleaving with it.
    const guards = {}
    for (const name of GUARDED_INVENTORY_ACTIONS) {
      if (!orig[name]) continue
      guards[name] = async function (...args) {
        await preempt(st, name)
        return orig[name].apply(bot, args)
      }
    }

    const mine = { clickWindow, putAway, putSelectedItemRange, ...guards }
    Object.assign(bot, mine)
    bot._client.write = write

    return function restore ({ fuse = false } = {}) {
      for (const k of Object.keys(mine)) {
        if (bot[k] !== mine[k]) { st.restoreConflicts++; continue }
        bot[k] = (k === 'clickWindow' && fuse) ? st.fuse : orig[k]
      }
      if (bot._client.write === write) bot._client.write = origWrite
      else st.restoreConflicts++
    }
  }

  async function craft (recipe, count, craftingTable, options = {}) {
    const t0 = now()
    if (active || zombie) {
      const e = new CraftSyncError('craft busy: another craft is still running', { failClass: 'craft_busy' })
      emitRow({ outcome: 'busy', clicks: 0 }, { recipe, count, craftingTable, error: e, durationMs: 0 })
      throw e
    }
    const deadline = Number.isFinite(options?.deadline) ? options.deadline : Infinity
    const st = active = {
      id: ++craftSeq, signal: options?.signal, deadline, clickDeadline: deadline - cfg.verifyReserveMs,
      resultId: recipe?.result?.id, cancelReason: null, refused: null, clickTimedOut: null,
      resynced: new Set(), clicks: 0, clicksSent: 0, proof: null, resyncs: 0, resyncAnswered: 0, resyncSkipped: 0,
      waitMs: 0, quietCaps: 0, clickCaps: 0, resyncCaps: 0, rewrites: 0, restoreConflicts: 0, preemptTimeouts: 0,
      maxAnswerMs: 0, awaitingSince: null, abandoned: false, outcome: null, verify: null,
      w0Clicks: 0, w0CloseMark: 0, gridClear: null, gridResidue: null,
    }
    const onEnd = () => { st.cancelReason ??= 'disconnected' }
    bot.once?.('end', onEnd)
    let restore = null
    let restored = false
    const unwind = (fuse) => {
      if (restored) return
      restored = true
      try { restore?.({ fuse }) } finally { active = null; bot.removeListener?.('end', onEnd) }
    }
    let error = null, result
    try {
      restore = install(st)
      const verifyUntil = () => !!st.cancelReason || !!st.signal?.aborted || now() >= st.deadline
      const entryWhy = stopReason(st)
      if (entryWhy && entryWhy !== 'deadline') {     // aborted before it began: an interruption, not a deadline
        st.outcome = 'aborted'
        throw new CraftSyncError(`craft aborted: ${entryWhy}`, { failClass: 'interrupted', aborted: true, reason: entryWhy })
      }
      if (stopReason(st)) {
        st.refused = stopReason(st)
      } else {
        const before = await serverCount(st, () => !!stopReason(st))

        // ADMISSION, on the bag AS THE SERVER HOLDS IT NOW (opt-in). A caller's room check made before bot.craft can be
        // overtaken by a pickup that lands while the baseline resync is in flight: the result then has no slot and
        // put-away throws it on the ground (Codex, real mineflayer + fake Paper). Asked here, after the resync answered
        // and before any craft click, it can still say no.
        // AN ADMISSION NEEDS A SERVER BAG (Codex review): with the baseline resync unanswered the local bag is the stale
        // belief the race exploits, and judging it admitted a craft whose result was then thrown. No answer, no craft.
        const refusal = (typeof options?.admit === 'function' && !stopReason(st))
          ? (before.source === 'resync'
              ? admissionRefusal(options.admit, bot.inventory?.items?.() ?? [], { source: before.source })
              : { failClass: 'craft_room', reason: 'baseline_unanswered', detail: `the baseline resync was not answered (${before.source})` })
          : null
        if (refusal) {
          st.outcome = 'refused'
          st.refused = `admission: ${refusal.reason}`
          throw new CraftSyncError(`craft refused before any click: ${refusal.reason}${refusal.detail ? ` (${refusal.detail})` : ''}`,
            { failClass: refusal.failClass, produced: 0, requested: Number(count ?? 1) * Number(recipe?.result?.count ?? 1), reason: refusal.reason })
        }

        // THE CRAFT, raced against cancellation so an abort while mineflayer awaits windowOpen returns now.
        // ... unless the baseline was itself cut short: a preemption or deadline there must not start the craft.
        let settled = false, runError = null
        const startWhy = stopReason(st)
        if (startWhy) { st.refused = startWhy; settled = true }
        const run = startWhy ? null : (async () => origCraft.call(bot, recipe, count, craftingTable))()
        run?.then(v => { settled = true; result = v }, e => { settled = true; runError = e })
        while (!settled && !stopReason(st)) await sleep(cfg.pollMs)
        if (!settled) {                                // give a craft that is mid-click its one poll to unwind
          const graceEnd = now() + cfg.quietMs
          while (!settled && now() < graceEnd) await sleep(cfg.pollMs)
        }
        if (!settled) {
          st.abandoned = true
          st.refused ??= stopReason(st)
          st.fuse = function () { throw new Error('craftsync: an abandoned craft may not click') }
          zombie = run
          run.catch(() => {}).finally(() => {
            if (bot.clickWindow === st.fuse) bot.clickWindow = st.origClick
            if (zombie === run) zombie = null
          })
        }

        const cancelled = st.cancelReason ?? (st.signal?.aborted ? 'aborted' : null)
        if (cancelled) {
          await clearGrid(st)                          // before ownership is released
          unwind(st.abandoned)
          st.outcome = 'aborted'
          throw new CraftSyncError(`craft aborted: ${cancelled}`, { failClass: 'interrupted', aborted: true, reason: cancelled })
        }

        // VERIFY: the server's window 0, not mineflayer's belief about it.
        const after = await serverCount(st, verifyUntil)
        const authoritative = before.source === 'resync' && after.source === 'resync'
        st.verify = { ...craftConfirmed({ before: before.count, after: after.count, count, perCraft: recipe?.result?.count, authoritative }),
                      source: authoritative ? 'resync' : `local (${before.source === 'resync' ? 'after' : 'before'} unanswered)` }
        const { produced, requested, confirmed } = st.verify
        const lateStop = st.cancelReason ?? (st.signal?.aborted ? 'aborted' : null)
        if (lateStop) {                                // aborted, preempted or disconnected while verifying
          st.outcome = 'aborted'
          throw new CraftSyncError(`craft aborted: ${lateStop}`, { failClass: 'interrupted', aborted: true, produced, requested, reason: lateStop })
        }
        if (st.refused === 'deadline') {
          st.outcome = 'deadline'
          throw new CraftSyncError(`craft stopped at the deadline: ${produced ?? '?'} of ${requested} made`,
            { failClass: 'craft_deadline', produced, requested, reason: 'deadline' })
        }
        if (st.clickTimedOut !== null) {
          st.outcome = 'unconfirmed'
          throw new CraftSyncError(`click on slot ${st.clickTimedOut} not answered in ${cfg.clickCapMs} ms; ` +
            `${produced ?? '?'} of ${requested} made`, { failClass: 'craft_unconfirmed', produced, requested, reason: 'click_timeout' })
        }
        if (runError) {
          st.outcome = 'error'
          runError.produced = produced; runError.requested = requested
          throw runError
        }
        if (!confirmed) {
          st.outcome = 'unconfirmed'
          throw new CraftSyncError(authoritative
            ? `mineflayer reported the craft done, but ${produced ?? '?'} of ${requested} arrived`
            : `the server did not answer the inventory resync (${st.verify.source}); the craft cannot be confirmed`,
          { failClass: 'craft_unconfirmed', produced, requested, reason: authoritative ? 'not_in_inventory' : 'unverified' })
        }
        st.outcome = 'ok'
        return result === undefined ? { produced, requested } : result   // mineflayer's craft resolves undefined
      }
      // refused before anything was sent
      st.outcome = 'deadline'
      throw new CraftSyncError('craft refused: the deadline leaves no time to craft and verify',
        { failClass: 'craft_deadline', produced: 0, requested: Number(count ?? 1) * Number(recipe?.result?.count ?? 1), reason: 'deadline' })
    } catch (e) {
      error = e
      throw e
    } finally {
      if (!restored) await clearGrid(st)               // any other unclean exit; a no-op after a verified close
      unwind(st.abandoned)
      emitRow(st, { recipe, count, craftingTable, error, durationMs: now() - t0 })
    }
  }

  function emitRow (st, { recipe, count, craftingTable, error, durationMs }) {
    try {
      const item = bot.registry?.items?.[recipe?.result?.id]?.name ?? String(recipe?.result?.id ?? '?')
      const v = st.verify ?? {}
      const args = {
        item, count: Number(count ?? 1), table: !!craftingTable, outcome: st.outcome ?? 'error',
        confirmed: v.confirmed ? 'yes' : 'no', produced: v.produced ?? null, requested: v.requested ?? null,
        verify_source: v.source ?? 'none',
        clicks: st.clicks ?? 0, resyncs: st.resyncs ?? 0, resync_answered: st.resyncAnswered ?? 0,
        resync_skipped: st.resyncSkipped ?? 0, wait_ms: Math.round(st.waitMs ?? 0),
        quiet_caps: st.quietCaps ?? 0, click_caps: st.clickCaps ?? 0, resync_caps: st.resyncCaps ?? 0,
        max_answer_ms: st.maxAnswerMs ?? 0, stateid_rewrites: st.rewrites ?? 0,
        stop: st.refused ?? st.cancelReason ?? null, abandoned: !!st.abandoned,
        restore_conflicts: st.restoreConflicts ?? 0, preempt_timeouts: st.preemptTimeouts ?? 0,
        preempted: /^preempted/.test(st.cancelReason ?? ''),
        grid_clear: st.gridClear ?? null, grid_residue: st.gridResidue?.length ? st.gridResidue.join(',') : null,
      }
      log({
        kind: 'craft_sync',
        status: error ? 'failed' : 'success',
        durationMs,
        detail: `${item} x${args.count}${args.table ? ' (table)' : ''}: ${args.outcome}, confirmed=${args.confirmed} ` +
                `(${args.produced ?? '?'}/${args.requested ?? '?'} via ${args.verify_source}); ${args.clicks} clicks, ` +
                `resync ${args.resync_answered}/${args.resyncs} skipped ${args.resync_skipped}, waited ${args.wait_ms} ms, ` +
                `max answer ${args.max_answer_ms} ms, caps q${args.quiet_caps} c${args.click_caps} r${args.resync_caps}` +
                (args.grid_clear ? `; grid clear ${args.grid_clear}${args.grid_residue ? ` (${args.grid_residue})` : ''}` : '') +
                (error ? `; ${String(error.message ?? error).slice(0, 80)}` : ''),
        args,
      })
    } catch { /* telemetry never breaks a craft */ }
  }

  bot.craft = craft
  const controller = { cfg, active: () => active, busy: () => !!(active || zombie), original: origCraft }
  bot.craftSync = controller
  return controller
}
