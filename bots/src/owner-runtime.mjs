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
  async assessAndRun ({ cls, key, obs = {}, before, predicate = () => ({}), snapshot = () => before } = {}) {
    if (this.#running) return { result: 'busy', rung: this.#running.rung }
    const now = this.#now()
    let ep = this.#episodes.get(key)
    if (!ep) {
      const gate = mayOpen({ cls, strategy: 'episode', pos: before, now, history: this.#history })
      if (!gate.open) { this.#row('safe_hold', 'failed', `class=${cls} reason=latched ${gate.why}`); return { result: 'latched', why: gate.why } }
      ep = newEpisode({ cls, at: before, now, blocks: obs.blocks | 0, climbNeed: obs.climbNeed | 0 })
      this.#episodes.set(key, ep); this.#history.push({ cls, strategy: 'episode', at: now, pos: before })
      this.#row('escape_rung', 'no_effect', `class=${cls} episode=${ep.id} ${JSON.stringify(transition('ASSESS', 'ESCAPE', { reason: 'trap detected', budget: { deadlineMs: ep.deadline - now, blocks: ep.blockBudget } }))}`)
    }
    const next = nextRung(ep, obs, now)
    if (!next) {
      const why = holdReason(ep, obs, now)
      this.#hold = { key, cls, reason: why, since: now }
      this.#row('safe_hold', 'failed', `class=${cls} episode=${ep.id} reason=${why} tried=${ep.tried.map(t => `${t.rung}:${t.outcome}`).join(',') || 'none'} until=evidence`)
      return { result: 'hold', why }
    }
    const grant = await this.#arb.acquire({ owner: `owner:${cls}`, priority: PRIORITY.escape, context: { kind: next.rung, episode: ep.id }, onCancel: () => { this.#running?.cancel?.() } })
    if (!grant) { this.#row('escape_rung', 'no_effect', `class=${cls} episode=${ep.id} rung=${next.rung} outcome=refused why=body held by ${this.#arb.holder?.owner ?? 'nobody'}`); return { result: 'refused', why: 'body held' } }
    const startedAt = now; const blocksBefore = this.#inventoryBlocks()
    let cancelled = false
    const deadlineTimer = setTimeout(() => { cancelled = true; this.#arb.release(grant, 'episode deadline') }, Math.max(0, ep.deadline - now)); deadlineTimer.unref?.()
    this.#running = { rung: next.rung, grant, cancel: () => { cancelled = true } }
    let out
    try {
      out = await this.#rungs[next.rung](this.#bot, { alive: () => !cancelled && this.#arb.ok(grant), deadlineAt: ep.deadline, blocksLeft: next.budget.blocks, grant })
    } catch (e) { out = { outcome: 'failed', why: `threw: ${String(e?.message ?? e).slice(0, 80)}` } }
    finally { clearTimeout(deadlineTimer); this.#running = null }
    // A rung whose grant was revoked under it -- by air, by lava, by the deadline, by anyone -- never RAN, whatever it
    // returned: the arbiter's word on who held the body outranks the rung's own report (plan v2 §5).
    const revoked = cancelled || !grant.alive
    this.#arb.release(grant, `rung ${next.rung} ended`)
    const outcome = (revoked && out?.outcome === 'ran') ? 'preempted' : (out?.outcome ?? 'failed')
    const spent = Math.max(0, blocksBefore - this.#inventoryBlocks())
    ep = recordRung(ep, { rung: next.rung, outcome, blocksSpent: spent, ms: this.#now() - startedAt, hazard: out?.hazard ?? null })
    this.#episodes.set(key, ep)
    this.#row('escape_rung', outcome === 'ran' ? 'success' : 'failed', `class=${cls} episode=${ep.id} rung=${next.rung} outcome=${outcome} why=${out?.why ?? ''} blocks=${spent} ms=${this.#now() - startedAt} budget=${JSON.stringify(next.budget)}`)
    if (outcome === 'ran') {
      const c = closeEpisode(ep, before, snapshot(), predicate())
      if (c.closed) { this.#episodes.delete(key); this.#hold = null; this.#row('escape_rung', 'success', `class=${cls} episode=${ep.id} CLOSED: ${c.why}`); return { result: 'closed', why: c.why } }
    }
    return { result: 'ran', rung: next.rung, outcome }
  }

  /** New evidence arrived (displacement, inventory, terrain, path, request): drop the hold so ASSESS runs again. */
  evidence (kinds = {}) {
    const x = safeHoldExit(this.#hold, kinds)
    if (x.exit) { const h = this.#hold; this.#hold = null; this.#row('safe_hold', 'success', `class=${h.cls} hold ended: ${x.why}`); return true }
    return false
  }

  #row (kind, status, detail) { try { this.#log({ kind, status, detail }) } catch {} }
}
