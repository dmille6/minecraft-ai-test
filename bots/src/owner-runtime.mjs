// THE MOVEMENT OWNER, runtime -- drives owner.mjs (pure) under the arbiter (arbiter.mjs). One rung at a time, one
// episode per (class, place), the grant taken at PRIORITY.escape and released after every rung, hazards preempting
// through the arbiter's handshake (a rung sees `alive()` false and returns 'preempted'), the episode deadline
// enforced by the owner itself (it revokes its own grant when the clock runs out, whatever the rung is doing), and
// two rows: `escape_rung` per rung and `safe_hold` when nothing runnable is left. Plan v2 items 3, 5, 6.
//
// The rung table is injected: `rungs[name](bot, { alive, deadlineAt, blocksLeft, yieldTo })` returns
// { outcome: 'ran'|'refused'|'failed'|'exhausted'|'preempted', why, blocksSpent, hazard }. The reflex layer builds it
// from pillarOut / escapeStairUp / harvestUnderfoot / harvestAdjacent and cognitive's two ladder legs; tests use fakes.
import { PRIORITY } from './arbiter.mjs'
import { newEpisode, nextRung, recordRung, closeEpisode, holdReason, safeHoldExit, mayOpen, transition } from './owner.mjs'
import { escapedFrom } from './recovery.mjs'

export class MovementOwner {
  #bot; #arb; #rungs; #log; #now; #inventoryBlocks; #history = []; #episodes = new Map(); #running = null; #hold = null
  constructor ({ bot, arb, rungs, log = () => {}, now = () => Date.now(), inventoryBlocks = () => 0 }) {
    this.#bot = bot; this.#arb = arb; this.#rungs = rungs; this.#log = log; this.#now = now; this.#inventoryBlocks = inventoryBlocks
  }

  get running () { return this.#running }
  get hold () { return this.#hold }
  episodeFor (key) { return this.#episodes.get(key) ?? null }

  /**
   * ASSESS then ESCAPE for one class at one place. Returns 'busy' if a rung is already running (the two-owners
   * guard), 'latched' when the strategy is exhausted this hour, 'hold' when nothing is runnable, 'closed' when the
   * episode's postcondition and predicate hold, or 'ran' when a rung ran and the episode stays open.
   *   obs: { blocks, tool, climbNeed }; before: {x,y,z,wet}; predicate(): the class's own safety predicate, read
   *   after the rung; snapshot(): {x,y,z,wet} now.
   */
  async assessAndRun ({ cls, key = cls, obs = {}, before, predicate = () => ({}), snapshot = () => before } = {}) {
    if (this.#running) return { result: 'busy', rung: this.#running.rung }
    const now = this.#now()
    let ep = this.#episodes.get(key)
    // ONE EPISODE PER PLACE, where "place" is the episode's ORIGIN, not the cell the bot happens to be in: a
    // one-block shuffle inside the same trap keeps the tried rungs, the deadline and the budget (Codex pass 1 §6).
    // A relocation by the shared postcondition is a new place and a new episode.
    if (ep && before && ep.at && escapedFrom(ep.at, { ...before, wet: false })) { this.#episodes.delete(key); ep = null }
    if (!ep) {
      const gate = mayOpen({ cls, strategy: 'hold', pos: before, now, history: this.#history })
      if (!gate.open) { this.#row('safe_hold', 'failed', `class=${cls} reason=latched ${gate.why}`); return { result: 'latched', why: gate.why } }
      ep = newEpisode({ cls, at: before, now, blocks: obs.blocks | 0, climbNeed: obs.climbNeed | 0 })
      this.#episodes.set(key, ep)
      this.#row('escape_rung', 'no_effect', `class=${cls} episode=${ep.id} ${JSON.stringify(transition('ASSESS', 'ESCAPE', { reason: 'trap detected', budget: { deadlineMs: ep.deadline - now, blocks: ep.blockBudget } }))}`)
    }
    const next = nextRung(ep, obs, now)
    if (!next) {
      const why = holdReason(ep, obs, now)
      if (!this.#hold || this.#hold.key !== key) this.#history.push({ cls, strategy: 'hold', at: now, pos: before })   // a HOLD is what the latch counts, never an opening
      this.#hold = { key, cls, reason: why, since: now, pos: before, blocks: obs.blocks | 0, tried: ep.tried }
      this.#row('safe_hold', 'failed', `class=${cls} episode=${ep.id} reason=${why} tried=${ep.tried.map(t => `${t.rung}:${t.outcome}`).join(',') || 'none'} until=evidence`)
      return { result: 'hold', why, tried: ep.tried }
    }
    const grant = await this.#arb.acquire({ owner: `owner:${cls}`, priority: PRIORITY.escape, context: { kind: next.rung, episode: ep.id }, onCancel: () => { this.#running?.cancel?.() } })
    if (!grant) { this.#row('escape_rung', 'no_effect', `class=${cls} episode=${ep.id} rung=${next.rung} outcome=refused why=body held by ${this.#arb.holder?.owner ?? 'nobody'}`); return { result: 'refused', why: 'body held' } }
    const startedAt = now; const blocksBefore = this.#inventoryBlocks()
    let cancelled = false
    // THE DEADLINE IS ENFORCED BY THE OWNER, INDEPENDENTLY OF THE RUNG: the arbiter's own stop (raw setGoal(null),
    // stopDigging, clearControlStates) then release, and a bounded wait -- a placement that never settles cannot
    // hold the owner or the arm's `escaping` flag (Codex pass 1 §3).
    const deadlineIn = Math.max(0, ep.deadline - now)
    const deadlineTimer = setTimeout(() => { cancelled = true; try { this.#arb.stop(grant, 'episode deadline') } catch {} }, deadlineIn); deadlineTimer.unref?.()
    this.#running = { rung: next.rung, grant, cancel: () => { cancelled = true } }
    let out; let settled = false
    try {
      // THE RUNG RUNS INSIDE THE GRANT'S ASYNC CONTEXT: the actuator gate admits its digs, placements and controls
      // as the holder's own (Codex pass 1 §1). Bounded: the deadline plus a grace, then the owner moves on.
      const run = Promise.resolve(this.#arb.within(grant, () => this.#rungs[next.rung](this.#bot, { alive: () => !cancelled && this.#arb.ok(grant), deadlineAt: ep.deadline, blocksLeft: next.budget.blocks, grant })))
        .then(v => { settled = true; return v }, e => { settled = true; return { outcome: 'failed', why: `threw: ${String(e?.message ?? e).slice(0, 80)}` } })
      const bound = new Promise(r => { const t = setTimeout(() => r({ outcome: 'preempted', why: 'rung did not settle by the episode deadline + 5 s' }), deadlineIn + 5_000); t.unref?.() })
      out = await Promise.race([run, bound])
    } finally { clearTimeout(deadlineTimer); this.#running = null }
    const revoked = cancelled || !grant.alive
    this.#arb.release(grant, `rung ${next.rung} ended`)
    const outcome = (!settled || revoked) && (out?.outcome === 'ran' || out?.outcome === 'preempted') ? 'preempted' : (out?.outcome ?? 'failed')
    const spent = Math.max(0, blocksBefore - this.#inventoryBlocks())
    ep = recordRung(ep, { rung: next.rung, outcome, blocksSpent: spent, ms: this.#now() - startedAt, hazard: out?.hazard ?? null })
    this.#episodes.set(key, ep)
    this.#row('escape_rung', outcome === 'ran' ? 'success' : 'failed', `class=${cls} episode=${ep.id} rung=${next.rung} outcome=${outcome} why=${out?.why ?? ''} blocks=${spent} ms=${this.#now() - startedAt} budget=${JSON.stringify(next.budget)}`)
    if (outcome === 'ran') {
      const c = closeEpisode(ep, ep.at, snapshot(), predicate())   // judged from the episode's ORIGIN, not this call's position
      if (c.closed) { this.#episodes.delete(key); this.#hold = null; this.#row('escape_rung', 'success', `class=${cls} episode=${ep.id} CLOSED: ${c.why}`); return { result: 'closed', why: c.why } }
    }
    return { result: 'ran', rung: next.rung, outcome, why: out?.why }
  }

  /** New evidence arrived (displacement, inventory, terrain, path, request): drop the hold so ASSESS runs again. */
  evidence (kinds = {}) {
    const x = safeHoldExit(this.#hold, kinds)
    if (x.exit) {
      const h = this.#hold; this.#hold = null
      // NEW EVIDENCE INVALIDATES THE OLD FAILURES: the episode that exhausted itself under the old facts is dropped,
      // so the next assess opens fresh rungs, a fresh deadline and a fresh budget (Codex pass 1 §7).
      this.#episodes.delete(h.key)
      this.#row('safe_hold', 'success', `class=${h.cls} hold ended: ${x.why}; episode reset`); return true
    }
    return false
  }

  #row (kind, status, detail) { try { this.#log({ kind, status, detail }) } catch {} }
}
