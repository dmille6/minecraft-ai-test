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
  /** Pure decision, exported through `mayAct` for tests: may a call from `ctx` proceed while `holder` holds? */
  static mayAct (ctx, holder) {
    if (!holder) return true                       // a free body: anyone may move it (unrouted legacy callers)
    if (!ctx) return false                         // someone holds it and the caller is unrouted: refused
    return ctx === holder && ctx.alive             // the holder itself, still alive
  }
  installActuatorGate (bot, { names = ['dig', 'placeBlock', 'setControlState'], pathfinder = true, onRefuse = () => {} } = {}) {
    const wrap = (obj, name) => {
      const orig = obj?.[name]
      if (typeof orig !== 'function') return
      const self = this
      obj[name] = function (...args) {
        const holder = self.#holder && self.#holder.alive ? self.#holder : null
        const ctx = self.caller()
        if (!Arbiter.mayAct(ctx, holder)) {
          onRefuse(name, ctx, holder)
          const err = new StaleGrant(ctx, `${name} refused: the body is held by ${holder.owner}`)
          if (name === 'setControlState') return undefined     // control states are set in tight loops: refuse silently
          return Promise.reject(err)
        }
        return orig.apply(this, args)
      }
      obj[name].__arbiterGated = true
    }
    for (const n of names) wrap(bot, n)
    if (pathfinder && bot.pathfinder) wrap(bot.pathfinder, 'goto')
    return bot
  }

  /** Give the body back. Idempotent. */
  release (grant, why = 'done') {
    if (!grant) return
    if (this.#holder === grant) { this.#holder = null }
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
