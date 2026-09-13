// THE ACTUATOR ARBITER -- step 0 of the movement owner (docs/movement-owner-design.md v3).
//
// Every trap this month was two individually-correct guards meeting where the bot had no legal move, and the
// mechanism was always the same: two callers driving the body at once (a skill's dig and the entombment reflex's
// pillar; a climb and the air reflex; the livelock breaker's goto under a running skill). Flags and typed body
// claims serialised some of them. This module is the one door every actuator call goes through, so that:
//
//   * at most one OPERATION holds the body at a time (a grant with an id, an owner name, a priority, a context);
//   * a higher-priority operation can PREEMPT: the holder is asked to cancel, gets ACK_MS to acknowledge, and is
//     then REVOKED whether or not it settled -- a hung dig or pathfinder promise can never hold a drowning bot;
//   * a revoked or released grant's later actuator calls are REJECTED as stale, so a promise that settles late
//     cannot move the body it no longer owns (the "late placeBlock" defect from the flooded-pocket review);
//   * the operation CONTEXT (what the holder is doing: stair, swim-to-air, approach tunnel, pillar) is readable by
//     detectors, which is the composition rule the old claims got right.
//
// Pure with respect to mineflayer: the arbiter never touches the bot. Callers wrap their actuator calls in
// `arb.act(grant, fn)`. Tests drive it without a bot.

import { AsyncLocalStorage } from 'node:async_hooks'

export const PRIORITY = Object.freeze({
  air: 100,        // no air: nothing outranks breathing
  lava: 90,        // in or beside lava / fire
  fall: 80,        // falling with a lethal drop below
  damage: 70,      // taking damage from an unknown source
  escape: 50,      // a recovery rung (entombed, marooned, flooded pocket, ledge, livelock ladder)
  work: 10,        // a skill's movement request
  idle: 0,
})
export const ACK_MS = 500

export class StaleGrant extends Error {
  constructor (grant, why) { super(`stale grant ${grant?.id ?? '?'} (${grant?.owner ?? '?'}): ${why}`); this.name = 'StaleGrant'; this.grant = grant }
}

export class Arbiter {
  #next = 1
  #holder = null            // the current grant, or null
  #log
  #now
  #stop                     // the INDEPENDENT actuator stop, run at every forced revocation without awaiting the holder
  #preempting = null        // the preemption in progress, so concurrent askers queue on it instead of racing
  /**
   * `stopActuators` is mandatory in production: it must stop pathfinding, digging and control states WITHOUT
   * touching the holder's promise (Codex, arbiter pass 1: a hung onCancel must not leave the old actuator live).
   */
  constructor ({ log = () => {}, now = () => Date.now(), stopActuators = () => {} } = {}) { this.#log = log; this.#now = now; this.#stop = stopActuators }

  /** The current holder (read-only view) or null. Detectors read `context` from here. */
  get holder () { return this.#holder ? { ...this.#holder, alive: this.#holder.alive } : null }

  /**
   * Ask for the body. Returns a grant when the body is free or the asker outranks the holder (after preemption),
   * or null when a holder of equal or higher priority keeps it. `onCancel` is the holder's cancellation hook: it
   * must stop the operation's actuators and settle its promise; the arbiter waits ACK_MS for it, then revokes.
   */
  async acquire ({ owner, priority = PRIORITY.work, context = null, onCancel = null }) {
    // RE-CHECK AFTER EVERY AWAIT (Codex, pass 1): two askers can preempt the same holder concurrently; the
    // second must see the first's grant and rank against IT, never overwrite it.
    for (;;) {
      if (this.#preempting) { await this.#preempting; continue }
      const h = this.#holder
      if (!h || !h.alive) break
      if (priority <= h.priority) { this.#log('arbiter_refused', { owner, priority, holder: h.owner, holderPriority: h.priority }); return null }
      this.#preempting = this.#preempt(h, owner)
      try { await this.#preempting } finally { this.#preempting = null }
    }
    const grant = { id: this.#next++, owner, priority, context, since: this.#now(), alive: true, onCancel, revoked: null }
    this.#holder = grant
    this.#log('arbiter_granted', { id: grant.id, owner, priority, context: context?.kind ?? null })
    return grant
  }

  /** Run one actuator call under a grant. Rejects (throws StaleGrant) if the grant no longer holds the body. */
  async act (grant, fn) {
    this.#check(grant, 'before the call')
    let out, err = null
    try { out = await fn() } catch (e) { err = e }
    // Ownership is checked on fulfilment AND rejection (Codex, pass 1): an actuator that partly moved the body,
    // lost ownership, then rejected must surface the revocation, with the original error as the cause.
    if (!grant.alive || this.#holder !== grant) {
      const st = new StaleGrant(grant, 'revoked while the call was in flight; reconcile the world'); st.cause = err; throw st
    }
    if (err) throw err
    return out
  }

  /** Synchronous check for tight loops (control-state re-assertion per tick). */
  ok (grant) { return !!grant && grant.alive && this.#holder === grant }

  // ---------------------------------------------------------------- the actuator-layer gate --------------------
  //
  // GATE EVERY ACTUATOR CALL, INCLUDING THOSE INSIDE HELPERS (Codex, arbiter final pass). Forty-three call sites
  // drive the body directly; wrapping them one by one is the bug class in another coat. Instead the operation
  // that holds the body runs inside `within(grant, fn)`, which records the grant in an AsyncLocalStorage context
  // that survives every await; the wrappers installed by `installActuatorGate(bot)` read that context and refuse
  // a call whose context is not the current holder. A call with NO context (a path not yet routed) is allowed
  // only while the body is free -- while someone holds it, an unrouted caller is rejected, which is exactly the
  // overlap the arbiter exists to stop.
  #als = new AsyncLocalStorage()
  within (grant, fn) { return this.#als.run(grant, fn) }
  /** Who is calling, per the async context. */
  caller () { return this.#als.getStore() ?? null }
  /**
   * Pure decision, exported through `mayAct` for tests: may a call from `ctx` proceed while `holder` holds?
   * `bound` is the grant on whose behalf the pathfinder's tick is running (set by the holder's own goto/setGoal):
   * a contextless call is attributed to it. (Codex, gate pass 2: contextless callers were let through while the
   * body was held; now they pass only as the bound pathfinder tick of the live holder, or while the body is free.)
   */
  static mayAct (ctx, holder, bound = null) {
    if (ctx) return !!holder && ctx === holder && ctx.alive          // a routed caller must BE the live holder; a released or revoked context never resumes
    if (!holder) return true                                         // an unrouted caller on a free body (legacy paths, the flag off)
    return bound === holder && holder.alive                          // an unrouted caller while held: only the holder's own pathfinder tick
  }
  //
  // WHAT IS GATED (Codex, gate passes 1 and 2). EventEmitter listeners run in the EMITTER's async context, so the
  // pathfinder's physicsTick -- which drives setControlState, look and clearControlStates for a goto the holder
  // legitimately started -- carries no grant. Instead of leaving those hands ungated, the gated goto/setGoal BIND
  // the pathfinder to the calling grant (`#bound`), and a contextless actuator call is admitted only while the
  // bound grant is the live holder. Revocation, the holder's own setGoal(null) and release all unbind, so a tick
  // that outlives its grant is refused. Ordinary stops (setGoal(null), stopDigging, clearControlStates, pathfinder
  // .stop) are gated the same way: stale cleanup cannot halt a successor. The ONLY raw bypass is the arbiter's own
  // stop, scoped to the grant being revoked or stopped. Refusals: awaited entry points (dig, placeBlock, goto)
  // reject with StaleGrant; look/lookAt resolve to nothing (mineflayer and the pathfinder fire them without
  // awaiting, and an unhandled rejection would take the process down); synchronous hands return undefined.
  #raw = null
  #bound = null
  static GATED_ASYNC = ['dig', 'placeBlock']
  static GATED_LOOK = ['look', 'lookAt']
  static GATED_SYNC = ['setControlState', 'clearControlStates', 'stopDigging']
  installActuatorGate (bot, { pathfinder = true, onRefuse = () => {} } = {}) {
    const self = this
    const pf = pathfinder ? bot.pathfinder : null
    this.#raw = { setGoal: pf?.setGoal, stopDigging: bot.stopDigging, clearControlStates: bot.clearControlStates }
    const wrap = (obj, name, refuse, { binds = null } = {}) => {
      const orig = obj?.[name]
      if (typeof orig !== 'function') return
      obj[name] = function (...args) {
        const holder = self.#holder && self.#holder.alive ? self.#holder : null
        const ctx = self.caller()
        if (!Arbiter.mayAct(ctx, holder, self.#bound)) {
          onRefuse(name, ctx, holder)
          return refuse(new StaleGrant(ctx, `${name} refused: the body is held by ${holder?.owner ?? 'nobody'}${ctx && !ctx.alive ? ' and the caller was revoked' : ''}`))
        }
        // ONLY A ROUTED CALL CHANGES THE BINDING (corpus run 4, 2026-09-13: 13,808 refusals in five minutes). The holder's
        // multi-leg navigation starts the next leg from a goal_reached/path_update LISTENER -- contextless, admitted as the
        // bound tick -- and the old rule reset the binding to `ctx ?? null` = null, after which every tick was refused.
        if (binds && ctx) self.#bound = binds(...args) ? ctx : null   // the holder's goto/setGoal(goal) binds the tick; its setGoal(null) unbinds; the tick's own calls leave it
        return orig.apply(this, args)
      }
      obj[name].__arbiterGated = true
    }
    const rejectP = err => Promise.reject(err), resolveP = () => Promise.resolve(), nothing = () => undefined
    for (const n of Arbiter.GATED_ASYNC) wrap(bot, n, rejectP)
    for (const n of Arbiter.GATED_LOOK) wrap(bot, n, resolveP)
    for (const n of Arbiter.GATED_SYNC) wrap(bot, n, nothing)
    if (pf) {
      wrap(pf, 'goto', rejectP, { binds: () => true })
      wrap(pf, 'setGoal', nothing, { binds: goal => goal != null })
      wrap(pf, 'stop', nothing)
    }
    // THE ONLY RAW BYPASS: the arbiter's own stop, run for the grant being revoked (#preempt) or stopped (stop()).
    this.#stop = () => {
      const r = this.#raw; this.#bound = null
      try { r.setGoal?.call(pf, null) } catch {}
      try { if (bot.targetDigBlock) r.stopDigging?.call(bot) } catch {}
      try { r.clearControlStates?.call(bot) } catch {}
    }
    return bot
  }
  /** The grant the pathfinder's tick is attributed to, or null (read-only, for tests and the digest). */
  get bound () { return this.#bound }
  /** The arbiter-only stop for a grant: raw setGoal(null), stopDigging, clearControlStates, then release. Scoped: a grant that no longer holds the body is only released. */
  stop (grant, why = 'stopped') { if (grant && this.#holder === grant) { try { this.#stop(grant, true) } catch {} } this.release(grant, why) }

  /** Give the body back. Idempotent. */
  release (grant, why = 'done') {
    if (!grant) return
    if (this.#holder === grant) { this.#holder = null }
    if (this.#bound === grant) { this.#bound = null }
    if (grant.alive) { grant.alive = false; grant.revoked = why; this.#log('arbiter_released', { id: grant.id, owner: grant.owner, why }) }
  }

  #check (grant, when) {
    if (!grant || !grant.alive || this.#holder !== grant) throw new StaleGrant(grant, `not the holder ${when}`)
  }

  async #preempt (h, by) {
    this.#log('arbiter_preempting', { id: h.id, holder: h.owner, by })
    let acked = false
    const ack = (async () => { try { await h.onCancel?.() } catch {} acked = true })()
    await Promise.race([ack, new Promise(r => setTimeout(r, ACK_MS))])
    h.alive = false; h.revoked = acked ? `preempted by ${by}` : `preempted by ${by} without acknowledgement (${ACK_MS} ms)`
    if (this.#holder === h) this.#holder = null
    // THE INDEPENDENT STOP: whether or not the holder acknowledged, the actuators are stopped here, without
    // awaiting the hung operation, before the body changes hands.
    try { this.#stop(h, acked) } catch {}
    this.#log('arbiter_revoked', { id: h.id, holder: h.owner, by, acked })
  }
}

/** Pure decision, exported for tests and for the digest: may `asker` take the body from `holder`? */
export function mayPreempt (askerPriority, holderPriority) { return askerPriority > holderPriority }
