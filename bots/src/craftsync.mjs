import { createRequire } from 'node:module'
import { inflightTracker } from './inflight.mjs'
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
// NO CLICK OUTLIVES THE CRAFT, AND NONE LANDS IN ANOTHER WINDOW (Codex, rounds 2-4; converged on withdraw's
// window-bound send, wd-on-6c9a8fb 2691727, which is canonical). mineflayer's click has ONE wait before its write, the
// after-a-dig cooldown, and reads its window only after it. Withdraw's cappedClick waits that cooldown out itself, then
// VALIDATES the click's ticket (inflight.mjs: the window it was issued for, and its epoch) before mineflayer runs, and
// dispatches it with the ticket current so the permanent send filter can drop a wrong-window packet as a backstop
// (its repair then runs only inside craftsync's next recount or lockstep, never in the background). On top of that,
// for a craft: a stop INVALIDATES (stopIssued), so a click still held in the cooldown is refused by its own validate()
// before mineflayer applies anything; every click must land in the craft's own window (bound at its first click,
// checked at each click's entry -- a table closed between clicks); a click refused for its window is the craft's
// window_changed outcome. Every issued click stays in the shared tracker until mineflayer's promise settles; the
// cleanup waits, bounded (inflightWaitMs), for size === 0 before its close and the release, and a craft whose wait
// expired, or released with a click still in flight, says grid_clear=unverified_inflight, never yes. Once the craft
// is told to stop, the craft's write hook still DROPS any window_click it sees and marks window 0 for the clear's
// local repair. A reflex that preempts the craft never clicks while the craft holds the inventory: it waits for the
// release (bounded), and if even that bound passes it fails busy instead of clicking alongside. A disconnect is
// tracked on its own (a preempted craft's cancelReason is already set). An error/deadline exit takes its verdict from
// the verification's own close + resync instead of sending another.
//
// grid_clear ON EVERY ROW (gridExitVerdict, the read's exit gate): yes | no | unverified_<unanswered|skipped|inflight|
// noverdict> | error | skipped_disconnected | skipped_window_open -- and na_clean (a verified craft) or na_no_clicks
// (nothing reached the 2x2 grid: refusals, busy, table crafts, a stop before the first window-0 click).
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
  gridClearCapMs: 1500,  // the grid clear's own budget after an unclean exit
  inflightWaitMs: 1500,  // how long the cleanup waits for issued clicks to settle before the release (then the row
                         // says unverified_inflight). A preempting reflex waits through all of it.
})

/**
 * THE ROW'S grid_clear, on every exit (the read gates on it) -> one of yes | no | unverified_* | error | skipped_* |
 * na_clean | na_no_clicks. Pure. Precedence: a disconnect with window-0 clicks; a click still in flight at the release
 * (or one dropped after the clear began); the clear's own verdict; a residue the verification's close saw; the
 * verification's verdict on an unclean exit; then the not-applicable exits.
 */
export function gridExitVerdict ({ outcome = null, w0Clicks = 0, disconnected = false, cleared = null, closeVerdict = null,
                                   inflightAtRelease = 0, lateAfterClear = 0, inflightWaitExpired = false } = {}) {
  if (disconnected && w0Clicks > 0) return 'skipped_disconnected'
  if (inflightAtRelease > 0 || lateAfterClear > 0 || inflightWaitExpired) return 'unverified_inflight'
  if (cleared) return cleared
  if (closeVerdict?.clear === 'no') return 'no'
  if (outcome !== 'ok' && closeVerdict?.clear) return closeVerdict.clear
  if (!(w0Clicks > 0)) return 'na_no_clicks'
  if (outcome === 'ok') return 'na_clean'
  return 'unverified_noverdict'
}

export const GUARDED_INVENTORY_ACTIONS = ['equip', 'unequip', 'moveSlotItem', 'toss', 'tossStack']

const require_ = createRequire(import.meta.url)
let itemCache = null
/** prismarine-item for this bot's version (cached): rebuilding the cursor from the server's carriedItem. */
const ItemFor = bot => (itemCache?.v === bot.version ? itemCache.I : (itemCache = { v: bot.version, I: require_('prismarine-item')(bot.registry ?? bot.version) }).I)
/** Server evidence of the cursor (controller.confirmCursor); without craftsync there is none. */
export async function confirmCursor (bot, win, opts = {}) {
  const c = bot?.craftSync
  if (typeof c?.confirmCursor !== 'function') return { answered: false, cursorEmpty: false, carried: null, why: 'no craftsync' }
  return c.confirmCursor(win, opts)
}
/** How many underlying clicks are still in flight (craftsync's, across its own cap and teardown). */
export const clicksInFlight = bot => (typeof bot?.craftSync?.inflight === 'function' ? bot.craftSync.inflight() : 0)
/** Every click issued before now is dropped at its send (inflight.mjs invalidate); -> live tickets touched, or 0. */
export const invalidateClicks = (bot, reason) => (typeof bot?.craftSync?.invalidate === 'function' ? bot.craftSync.invalidate(reason) : 0)

/**
 * THE SERVER'S BAG for a caller outside a craft -> { source, items } (controller.recount). Without craftsync (its install
 * failed at spawn, or a test double) the source is 'none' and the items are the local bag -- the caller must say so.
 */
export async function serverRecount (bot, opts = {}) {
  const c = bot?.craftSync
  if (typeof c?.recount !== 'function') return { source: 'none', items: bot?.inventory?.items?.() ?? [] }
  return c.recount(opts)
}
/**
 * fn(click) with every click in craftsync's lockstep (controller.lockstep). Without craftsync each click is followed by
 * one tick, the closest the plain client can come.
 */
export async function lockstepClicks (bot, fn, opts = {}) {
  const c = bot?.craftSync
  const click = (slot, button, mode) => bot.clickWindow(slot, button, mode)
  if (typeof c?.lockstep !== 'function') return fn(async (slot, button, mode) => { await click(slot, button, mode); await bot.waitForTicks?.(1) })
  return c.lockstep(() => fn(click), opts)
}

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
  const lastCarried = new Map() // windowId -> the carriedItem of its last window_items
  // EVERY UNDERLYING CLICK STILL IN FLIGHT (withdraw, 10-04, Codex round 3): cappedClick stops WAITING at its cap or at a
  // stop, but mineflayer's click goes on; a caller must not click again, or close, until these have settled.
  // NOTE for the grid fix (gf-on-1918bb5), which is changing cappedClick too: this set and inflight()/inflightSettled()
  // are what withdraw relies on -- keep them, or an equivalent, when the two meet.
  const inflight = inflightTracker()   // inflight.mjs: shared with withdraw and the grid fix
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
    lastCarried.set(p.windowId, p.carriedItem ?? null)   // the server's word on the cursor (mineflayer 4.37 ignores it)
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

  // THE WINDOW-BOUND SEND (withdraw round 5, Codex P1): every click craftsync dispatches carries a ticket naming the
  // window it was issued for (inflight.mjs). A window_click whose window is not that one, or whose ticket was
  // invalidated (a release, a cancel, a visit's end), is DROPPED here -- below every lockstep wrapper, so it is the last
  // word before the wire. Since round 6 this is the BACKSTOP: cappedClick validates the same ticket before mineflayer
  // runs (and mutates its local window), so a drop here should not happen. If one does, the local state is marked for
  // repair, and the repair runs only inside craftsync's own next recount or lockstep -- never in the background, where it
  // could interleave its close_window(0) with an equip that craftsync does not see (Codex round 6).
  const baseWrite = bot._client.write
  let dropped = 0
  let repairPending = null
  const filterWrite = function (name, params) {
    if (name === 'window_click') {
      const v = inflight.admit(params)
      if (!v.ok) {
        dropped++
        repairPending = v.why
        log({ event: 'click_dropped', slot: params?.slot, windowId: params?.windowId, why: v.why })
        return undefined
      }
    }
    return baseWrite.call(this, name, params)
  }
  bot._client.write = filterWrite
  const lastPacketAt = (win) => Math.max(lastAt.get(win) ?? 0, lastAt.get(0) ?? 0, lastAt.get('cursor') ?? 0)

  /** Why should this craft stop clicking? null = keep going. */
  const stopReason = (st) => st.cancelReason ?? (st.signal?.aborted ? 'aborted' : (now() >= st.clickDeadline ? 'deadline' : (st.windowLost ? 'window_changed' : null)))

  /** THE CRAFT'S WINDOW (Codex round 4, reproduced): mineflayer computes slot numbers for one window -- the table, or the
   *  inventory for a 2x2 -- and every craftsync wait (the resync, the after-dig delay, the put-away loop) is a chance for
   *  that window to close; mineflayer then clicks the same slot number in whatever window is current (a table slot 37
   *  became window-0 slot 37: dirt into the crafting grid). A craft is bound to the window of its first click; a click
   *  that would land anywhere else stops the craft (window_changed) before it is issued. */
  const currentWin = () => bot.currentWindow || bot.inventory
  /** In a craft, every click must land in the CRAFT's window (bound at its first click, before any wait): a table closed
   *  between clicks puts the next click's ticket on window 0, where validate() would agree -- this does not. Within a
   *  click, the waits are covered by withdraw's validate() before mineflayer runs. -> throws. */
  function checkWindow (st) {
    if (!st.isCraft || !st.boundWindow || currentWin() === st.boundWindow) return
    const where = `bound to the craft's window ${st.boundWindow?.id}, now ${currentWin()?.id ?? 0}`
    st.windowLost ??= where
    st.windowChanges++
    st.craftWindowRefusals++
    st.refused = 'window_changed'
    throw new Error(`craftsync: window_changed (${where})`)
  }

  /** A CRAFT STOPPED while its click was still held (in mineflayer's dig cooldown, inside withdraw's dispatch path):
   *  invalidate, so that click's own validate() refuses it before mineflayer runs -- nothing is applied locally. */
  function stopIssued (st, why) {
    if (!st.isCraft || st.invalidated) return
    st.invalidated = true
    inflight.invalidate(`craft stopped: ${why}`)
  }

  /** The grid fix's per-state fields, on any state install() is given (craft(), and withdraw's freshState for recount
   *  and lockstep, which does not carry them). */
  function gridDefaults (st) {
    st.issued ??= []
    for (const k of ['w0Clicks', 'w0CloseMark', 'lateClicksDropped', 'windowChanges', 'craftWindowRefusals']) st[k] ??= 0
  }

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

  /** Every exit, while `st` still owns the inventory: the issued clicks settle (bounded), then the grid clear. */
  async function cleanup (st) {
    releaseDeadWaits(st)
    // NO CLOSE AND NO RELEASE WHILE A CLICK IS IN FLIGHT (the shared tracker): bounded; past the bound the clear still
    // runs -- a loaded grid left behind is worse -- and the row says unverified_inflight
    const drained = await inflight.waitSettled(cfg.inflightWaitMs, () => st.disconnected)
    if (!drained && !st.disconnected) st.inflightWaitExpired = true
    st.dropsAtClear = st.lateClicksDropped
    await clearGrid(st)
  }

  /** A WAIT THAT CAN NEVER BE ANSWERED: a written grid click into a crafting TABLE awaits that window's slot-0 update,
   *  but mineflayer's own catch has closed the table and its set_slot handler now drops that window's packets -- the
   *  click's promise would sit out mineflayer's 20 s once(). Its write went out before the close, so it can change
   *  nothing more: release the dead window's wait so the click settles. Window 0 and unwritten clicks are never
   *  touched -- they are waited for. */
  function releaseDeadWaits (st) {
    for (const rec of st.issued) {
      if (rec.settled || !rec.ticket?.wrote || rec.win === 0 || !rec.window) continue
      if (bot.currentWindow === rec.window) continue
      try { rec.window.emit?.('updateSlot:0', null, null); st.deadWaitsReleased++ } catch { /* a stub window */ }
    }
  }

  /** The release: what is still in flight, and anything dropped after the clear began, decide the row's verdict. */
  function releaseFacts (st) {
    // from the tickets: a click handed to mineflayer that did not write inside its dispatch, and one the wire dropped
    st.deferredWrites = st.issued.filter(r => !r.ticket?.wrote && !r.ticket?.dropped).length
    st.bindDrops = st.issued.filter(r => r.ticket?.dropped && r.ticket?.wrote).length                 // dropped at the wire
    st.preInvokeRefusals = st.craftWindowRefusals + st.issued.filter(r => r.ticket?.dropped && !r.ticket?.wrote).length
    st.inflightAtRelease = inflight.size
    st.lateAfterClear = st.dropsAtClear == null ? 0 : st.lateClicksDropped - st.dropsAtClear
  }

  /** The grid clear (see the header). Runs only while `st` owns the inventory; never throws. */
  async function clearGrid (st) {
    if (st.w0Clicks === st.w0CloseMark) return                 // no window-0 click since window 0 was last closed
    if (st.disconnected) { st.gridClear = 'skipped_disconnected'; return }
    if (bot.currentWindow) { st.gridClear = 'skipped_window_open'; return }
    const end = now() + cfg.gridClearCapMs
    const until = () => now() >= end || st.disconnected
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
      const dirty = st.w0Clicks > st.w0CloseMark            // window-0 craft clicks before this close
      bot._client.write('close_window', { windowId: 0 })   // through the hook: it records the empty-cursor proof
      closeInventoryLocally()
      const r = await resync(st, 0, until)
      if (r === 'answered') source = 'resync'
      // the grid verdict of THIS close, used if the craft then exits uncleanly (error, deadline, late abort): no
      // second close is sent for it
      if (dirty) {
        const v = r === 'answered' ? gridClearVerdict(lastItems.get(0)) : null
        st.closeVerdict = v ? { clear: v.clear ? 'yes' : 'no', residue: v.residue } : { clear: `unverified_${r}`, residue: null }
      }
    } else {
      await waitQuiet(st, 0, until)
    }
    const count = typeof bot.inventory?.count === 'function' ? bot.inventory.count(st.resultId, null) : NaN
    return { count, source }
  }

  /** mineflayer 4.37.1's own dig-cooldown wait, verbatim (inventory.js clickWindow). Its clock mismatch is copied too
   *  (lastDigTime is performance.now(), compared with new Date()), so mineflayer never sleeps after this has returned. */
  async function digCooldown (slot) {
    if (!(slot >= bot.QUICK_BAR_START && bot.lastDigTime != null)) return
    let since
    while ((since = new Date() - bot.lastDigTime) < 500) await sleep(500 - since)
  }

  /** The server's word on a window's cursor (its last window_items' carriedItem), applied to the client's window. */
  function applyCarried (win, id) {
    const c = lastCarried.get(id)
    let item = null
    if (c && (c.itemCount ?? 0) > 0) { try { item = ItemFor(bot).fromNotch(c) } catch { item = null } }
    if (win) win.selectedItem = item?.name && item.name !== 'unknown' ? item : null
  }

  /** A backstop drop's repair, INSIDE craftsync's own ownership (`st` is active): the open window from a clone probe,
   *  or window 0 from a close and an answered resync, with the server's cursor for it. */
  async function repairInside (st) {
    if (!repairPending) return
    const why = repairPending
    st.origWrite ??= bot._client.write
    let how
    const win = bot.currentWindow
    if (win) {
      const r = await probeCursor(st, win)
      how = r.answered ? 'window_probe' : `window_probe_${r.why}`
    } else {
      st.origWrite.call(bot._client, 'close_window', { windowId: 0 })
      st.proof = { win: 'any', clicks: st.clicksSent }
      const r = await resync(st, 0, () => now() >= st.deadline)
      if (r === 'answered') applyCarried(bot.inventory, 0)
      how = `recount_${r === 'answered' ? 'server' : r}`
    }
    if (how === 'window_probe' || how === 'recount_server') repairPending = null
    log({ event: 'click_drop_repair', how, why })
  }

  /** mineflayer's click, never waited on longer than clickCapMs -- and a cap REJECTS. A rejection that arrives
   *  after the craft moved on is swallowed here (an unhandled rejection kills the bot) and changes nothing. */
  async function cappedClick (st, orig, slot, button, mode, bound = {}) {
    let settled = false, failed = false, error = null
    const ticket = inflight.bind({ windowId: bound.windowId ?? (bot.currentWindow || bot.inventory)?.id ?? 0, slot, button, mode, epoch: bound.epoch })
    const p = (async () => {
      // mineflayer 4.37.1 sleeps out a dig cooldown BEFORE it reads the window. That sleep happens here instead, with
      // the same expression, so that inside mineflayer the read and the write are synchronous -- inside dispatch(),
      // where the write hook can tell this click's packet from anyone else's.
      await digCooldown(slot)
      // PRE-INVOKE (round 6, Codex P1): mineflayer applies the click to its LOCAL window before it writes, so a stale
      // click must be refused here, before it is invoked -- the wire filter below is only the backstop.
      const v = inflight.validate(ticket, (bot.currentWindow || bot.inventory)?.id ?? 0)
      if (!v.ok) {
        ticket.dropped = v.why
        dropped++
        log({ event: 'click_refused', slot, windowId: ticket.windowId, why: v.why })
        throw Object.assign(new Error(`craftsync: click on slot ${slot} dropped: ${v.why}`), { clickDropped: true })
      }
      const q = inflight.dispatch(ticket, () => orig.call(bot, slot, button, mode))
      if (ticket.dropped) {
        Promise.resolve(q).catch(() => {})
        throw Object.assign(new Error(`craftsync: click on slot ${slot} dropped: ${ticket.dropped}`), { clickDropped: true })
      }
      return q
    })()
    p.then(() => { settled = true }, (e) => { settled = true; failed = true; error = e })
    inflight.track(p, ticket)
    // this craft's own record of the click (ticket.wrote is set by the craft's write hook inside the dispatch): the
    // cleanup's verdict and its release of a wait that can never be answered read it
    const rec = { win: ticket.windowId, window: bot.currentWindow || bot.inventory, ticket, settled: false }
    st.issued.push(rec)
    p.then(() => { rec.settled = true }, () => {
      rec.settled = true
      // refused before mineflayer ran because its window changed: in a craft, that is the craft's outcome
      if (st.isCraft && !ticket.wrote && /^bound to window/.test(ticket.dropped ?? '')) { st.windowLost ??= ticket.dropped; st.windowChanges++ }
    })
    const start = now()
    while (!settled) {
      if (now() - start >= cfg.clickCapMs) {
        st.clickCaps++
        // THE CAP IS A STOP TOO (Codex on da2a923): the click it gives up on may still be held in the cooldown, with a
        // valid ticket -- invalidate BEFORE the throw, so its own validate() refuses it when it wakes
        stopIssued(st, 'click_timeout')
        st.clickTimedOut = slot
        throw new Error(`craftsync: click on slot ${slot} not answered in ${cfg.clickCapMs} ms`)
      }
      if (stopReason(st)) { stopIssued(st, stopReason(st)); break }
      await sleep(cfg.pollMs)
    }
    st.waitMs += now() - start
    if (failed) throw error
  }

  /** An inventory action arrived mid-craft: stop the craft, wait (bounded, shared) for it to unwind. */
  async function preempt (st, name) {
    if (active !== st) return
    if (!st.cancelReason) st.cancelReason = `preempted by ${name}`
    // THE REFLEX WAITS FOR THE RELEASE, through the bounded cleanup (inflight + grid clear), so a slow clear never
    // makes it give up once -- and if even that bound passes, it fails busy rather than click alongside the craft.
    st.preemptUntil ??= now() + cfg.preemptWaitMs + cfg.inflightWaitMs + cfg.gridClearCapMs + 2 * cfg.quietCapMs + cfg.resyncCapMs
    while (active === st && now() < st.preemptUntil) await sleep(cfg.pollMs)
    if (active === st) {
      st.preemptTimeouts++
      throw new CraftSyncError(`craft busy: ${name} refused, the craft still holds the inventory`, { failClass: 'craft_busy' })
    }
  }

  function install (st) {
    gridDefaults(st)
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
      // THE BINDING, made before any wait: the craft's window is the one its first click is aimed at. Every click --
      // mineflayer's, and the put-away copies below, which route through here -- is checked against it immediately
      // before it is handed to mineflayer (cappedClick), after every wait.
      if (st.isCraft) { st.boundWindow ??= currentWin(); checkWindow(st) }
      const win = (bot.currentWindow || bot.inventory)?.id ?? 0
      const issuedIn = inflight.epoch   // the click is FOR this window, as of now (an invalidation during the resync counts)
      if (win !== 0 && !st.resynced.has(win)) {
        st.resynced.add(win)
        await resync(st, win, clickPhase)          // written below the hook: not counted, not rewritten
        const why2 = stopReason(st)
        if (why2) { st.refused = why2; throw new Error(`craftsync: ${why2}`) }
      }
      st.clicks++
      st.awaitingSince = now()
      await cappedClick(st, orig.clickWindow, slot, mouseButton, mode, { windowId: win, epoch: issuedIn })
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
        if (inflight.current) inflight.current.wrote = true   // the dispatched click reached its write (for the verdict)
        if (stopReason(st)) {                         // THE BACKSTOP: a stale continuation, never sent
          st.lateClicksDropped++
          if (params?.windowId === 0) st.w0Clicks++     // mineflayer applied it LOCALLY: the clear must repair that
          return
        }
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
        await preempt(st, name)                       // returns only once the craft has released the inventory
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
      isCraft: true, boundWindow: null, windowLost: null, windowChanges: 0, bindDrops: 0,
      w0Clicks: 0, w0CloseMark: 0, gridClear: null, gridResidue: null, closeVerdict: null,
      lateClicksDropped: 0, dropsAtClear: null, lateAfterClear: 0, inflightAtRelease: 0, disconnected: false,
      deferredWrites: 0, issued: [], inflightWaitExpired: false, deadWaitsReleased: 0,
    }
    const onEnd = () => { st.disconnected = true; st.cancelReason ??= 'disconnected' }   // seen even after a preemption
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
          await cleanup(st)                            // before ownership is released
          releaseFacts(st)
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
        if (st.windowLost) {                           // the craft's window changed: stopped before the click, verified
          st.outcome = 'window_changed'
          throw new CraftSyncError(`craft stopped: its window changed (${st.windowLost}); ${produced ?? '?'} of ${requested} made`,
            { failClass: 'craft_unconfirmed', produced, requested, reason: 'window_changed' })
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
      if (!restored) { await cleanup(st); releaseFacts(st) }   // every other exit; the clear is a no-op after a close
      // THE ROW'S VERDICT, on every exit (gridExitVerdict): the read's gate
      const cleared = st.gridClear
      st.gridClear = gridExitVerdict({ outcome: st.outcome, w0Clicks: st.w0Clicks, disconnected: st.disconnected, cleared,
                                       closeVerdict: st.closeVerdict, inflightAtRelease: st.inflightAtRelease,
                                       lateAfterClear: st.lateAfterClear, inflightWaitExpired: st.inflightWaitExpired })
      if (!cleared && st.closeVerdict && st.gridClear === st.closeVerdict.clear) st.gridResidue = st.closeVerdict.residue
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
        grid_clear: st.gridClear ?? gridExitVerdict({ outcome: st.outcome }),   // a busy refusal: na_no_clicks
        grid_residue: st.gridResidue?.length ? st.gridResidue.join(',') : null,
        late_clicks_dropped: st.lateClicksDropped ?? 0, inflight_at_release: st.inflightAtRelease ?? 0,
        window_changes: st.windowChanges ?? 0, bind_drops: st.bindDrops ?? 0, pre_invoke_refusals: st.preInvokeRefusals ?? 0,
        inflight_wait_expired: !!st.inflightWaitExpired, dead_waits_released: st.deadWaitsReleased ?? 0,
        deferred_writes: st.deferredWrites ?? 0,
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

  /** A bare state for work that is not a craft (recount, lockstep): the same counters craft() keeps. */
  const freshState = (deadline, signal) => ({
    id: ++craftSeq, signal, deadline, clickDeadline: deadline, resultId: null, cancelReason: null, refused: null,
    clickTimedOut: null, resynced: new Set(), clicks: 0, clicksSent: 0, proof: null, resyncs: 0, resyncAnswered: 0,
    resyncSkipped: 0, waitMs: 0, quietCaps: 0, clickCaps: 0, resyncCaps: 0, rewrites: 0, restoreConflicts: 0,
    preemptTimeouts: 0, maxAnswerMs: 0, awaitingSince: null, abandoned: false, outcome: null, verify: null,
  })

  /**
   * THE SERVER'S BAG, NOW (withdraw, 10-04) -> { source: 'server' | 'unanswered' | 'skipped' | 'busy' | 'window_open',
   * items }. serverCount's own steps outside a craft: window 0 closed (the server hands a carried stack back, so the
   * cursor is provably empty), resynced, and the items read only from an ANSWERED window_items. Never while a craft
   * runs or a container window is open.
   */
  async function recount ({ deadline = now() + 3000 } = {}) {
    if (active || zombie) return { source: 'busy', items: null }
    if (bot.currentWindow) return { source: 'window_open', items: null }
    const st = active = freshState(deadline, null)
    st.origWrite = bot._client.write
    try {
      const until = () => now() >= st.deadline
      st.origWrite.call(bot._client, 'close_window', { windowId: 0 })
      st.proof = { win: 'any', clicks: st.clicksSent }
      const r = await resync(st, 0, until)
      if (r === 'answered' && repairPending) {   // the slots were just answered; the cursor is the server's too
        applyCarried(bot.inventory, 0)
        log({ event: 'click_drop_repair', how: 'recount_server', why: repairPending })
        repairPending = null
      }
      return { source: r === 'answered' ? 'server' : r, items: r === 'answered' ? (bot.inventory?.items?.() ?? []) : null }
    } finally { active = null }
  }

  /**
   * CLICKS IN LOCKSTEP outside a craft (withdraw, 10-04): fn() runs with craft()'s own click wrappers installed -- each
   * click waits for its window to go quiet before the next, the first click in a container is preceded by a resync when
   * that is provably a no-op, stateIds per window (arm B) -- and with every other inventory action held off.
   */
  async function lockstep (fn, { deadline = now() + 30_000, signal = null } = {}) {
    if (active || zombie) throw new CraftSyncError('inventory busy: a craft is running', { failClass: 'craft_busy' })
    const st = active = freshState(deadline, signal)
    let restore = null
    try {
      await repairInside(st)   // a backstop drop's repair, before this lockstep's first click (never in the background)
      restore = install(st)
      return await fn()
    } finally {
      try { restore?.() } finally { active = null }
    }
  }

  /**
   * SERVER EVIDENCE OF THE CURSOR (withdraw, Codex round 3: a quiet window is not confirmation) -> { answered, cursorEmpty,
   * carried, why }. A CLONE click (mode 3) with stateId -1: in survival vanilla does nothing for it (clone needs infinite
   * materials), and the stale stateId makes the server send the window's full state, carriedItem included -- so it is
   * safe whatever the cursor holds, unlike the -999 resync, which would DROP a loaded cursor. The answer becomes the
   * client's cursor too: mineflayer 4.37 never applies carriedItem, so its own view can be wrong in either direction.
   * Never while a craft runs or an underlying click is in flight.
   */
  async function confirmCursor (win, { deadline = now() + 1500, cancelled = () => false } = {}) {
    const no = why => ({ answered: false, cursorEmpty: false, carried: null, decodeFailed: false, why })
    if (active || zombie) return no('busy')
    if (inflight.size) return no('a click is in flight')
    const id = win?.id
    if (id == null || bot.currentWindow !== win) return no('not the open window')
    // OWNED FOR THE WHOLE PROBE (Codex round 4): `active` is held from the send to the answer's consumption, so no craft
    // or lockstep can click in between and make the evidence stale. (Inventory actions outside craftsync -- equip and
    // the rest -- are refused by the caller's ownership: skills.mjs ownInventory.)
    const st = active = freshState(deadline, null)
    try { return await probeCursor(st, win, cancelled) } finally { active = null }
  }

  /** The clone probe and its consumption, with `st` already holding craftsync's ownership (confirmCursor, repairInside). */
  async function probeCursor (st, win, cancelled = () => false) {
    const no = why => ({ answered: false, cursorEmpty: false, carried: null, decodeFailed: false, why })
    const id = win?.id
    if (id == null || bot.currentWindow !== win) return no('not the open window')
    {
      const before = itemsSeen.get(id) ?? 0
      bot._client.write('window_click', { windowId: id, stateId: -1, slot: 0, mouseButton: 2, mode: 3, changedSlots: [],
                                          cursorItem: { itemCount: 0, components: [], removeComponents: [] } })
      while ((itemsSeen.get(id) ?? 0) <= before) {
        if (cancelled()) return no('cancelled')
        if (now() >= st.deadline || bot.currentWindow !== win) return no('unanswered')
        await sleep(cfg.pollMs)
      }
      if (cancelled()) return no('cancelled')
      if (bot.currentWindow !== win) return no('the window changed before the answer was used')
      const c = lastCarried.get(id)
      const empty = !(c && (c.itemCount ?? 0) > 0)
      if (empty) { win.selectedItem = null; return { answered: true, cursorEmpty: true, carried: null, decodeFailed: false, why: null } }
      // THE COMPLETE CARRIED ITEM, ALWAYS (both reviews, round 4): type, count, durability and components -- a same-count
      // correction to another item was ignored before. A decode that fails, or yields an id this version does not know
      // (prismarine-item does not throw: it names it 'unknown'), is said plainly.
      let item = null
      try { item = ItemFor(bot).fromNotch(c) } catch { item = null }
      const known = it => !!it?.name && it.name !== 'unknown' && (!bot.registry?.items || !!bot.registry.items[it.type])
      if (!known(item)) return { answered: true, cursorEmpty: false, carried: c, decodeFailed: true, why: 'the carried item could not be decoded' }
      win.selectedItem = item
      return { answered: true, cursorEmpty: false, carried: c, decodeFailed: false, why: null }
    }
  }

  bot.craft = craft
  const controller = { cfg, active: () => active, busy: () => !!(active || zombie), original: origCraft, recount, lockstep, confirmCursor,
                       inflight: () => inflight.size, inflightSettled: () => inflight.settled(),
                       invalidate: reason => inflight.invalidate(reason), dropped: () => dropped, tracker: inflight,
                       repairPending: () => repairPending }
  bot.craftSync = controller
  return controller
}
