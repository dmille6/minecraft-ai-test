// BENCH-ONLY (branch bench-c2; never merged to main, never deployed to the fleet).
//
// The C2 directive queue: how an OVERSEER or a STUCK-ESCALATION model hands one bot a short ordered list of skill
// calls, delivered over chat by a whitelisted director (bench/models/closedloop/C2-DESIGN-DRAFT.md rev 2).
//
// WHY A QUEUE THE BRAIN READS, NOT A CHAT SIDE-DOOR (both reviews of rev 1): a chat command calls runner.run
// directly, which skips admission and the outcome feedback (lastOutcome, the milestone counter, memory), and a runner
// refusal returns before any row is written. Here the cognitive loop takes the next step as a PROPOSAL, exactly like
// a work order: the admission gate vets it, the outcome is recorded and fed back, and one decision row is logged.
//
// rev b (both reviews of b41e8cc): reports match a per-delivery GENERATION, never the caller's id (a same-id resend
// could otherwise be "completed" by the previous execution); a runner PAUSE is waited out until the runner's own
// auto-resume (pause recovery + one tick), not dropped after three ticks; every lifecycle step is logged AT ONCE
// through a sink with its own timestamp (requested / duplicate / admitted / started / waiting / step_done /
// completed / refused / released / expired / superseded / orphan_outcome / parse_failed); a new connection releases what the old
// one held.
//
// Pure apart from the optional sink: no clock reads (`now` is passed in), so every rule below is unit-tested.

export const ORIGINS = ['escalation', 'overseer']          // priority order: escalation pre-empts overseer
export const MAX_STEPS = 4
export const DEFAULT_LEASE_S = 600
export const MAX_LEASE_S = 900
export const MAX_REFUSALS = 3            // busy / body_held refusals before the directive is released
export const PAUSE_WAIT_MS = 120_000 + 30_000   // runner.mjs pauseRecoveryMs (120 s) + one decision tick of slack
export const RETRY_BUSY_MS = 15_000             // busy / body_held: try again after this

const SKILL_RE = /^[a-z_]{2,24}$/

/** Parse and validate `directive <id> <json>`; returns {ok, directive} or {ok:false, why}. Never throws. */
export function parseDirective (id, json, { knownSkills = null, now = 0 } = {}) {
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(String(id ?? ''))) return { ok: false, why: 'bad_id' }
  let d
  try { d = JSON.parse(json) } catch { return { ok: false, why: 'bad_json' } }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, why: 'bad_json' }
  const origin = d.o ?? d.origin
  if (!ORIGINS.includes(origin)) return { ok: false, why: 'bad_origin' }
  const steps = d.s ?? d.steps
  if (!Array.isArray(steps) || !steps.length || steps.length > MAX_STEPS) return { ok: false, why: 'bad_steps' }
  const clean = []
  for (const st of steps) {
    const skill = st?.skill ?? st?.k
    const args = st?.args ?? st?.a ?? {}
    if (typeof skill !== 'string' || !SKILL_RE.test(skill)) return { ok: false, why: 'bad_skill' }
    if (knownSkills && !knownSkills.includes(skill)) return { ok: false, why: 'unknown_skill' }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, why: 'bad_args' }
    clean.push({ skill, args })
  }
  const lease = Math.min(MAX_LEASE_S, Math.max(30, Number(d.l ?? d.lease_s ?? DEFAULT_LEASE_S) || DEFAULT_LEASE_S))
  return { ok: true, directive: { id: String(id), origin, steps: clean, why: String(d.w ?? d.why ?? '').slice(0, 120),
                                  receivedAt: now, expiresAt: now + lease * 1000, step: 0, refusals: 0, waitUntil: null } }
}

export class DirectiveQueue {
  constructor () { this.active = null; this.events = []; this.gen = 0; this.sink = null; this.orphans = new Map() }

  /** A sink receives each lifecycle event immediately (the cognitive loop writes it as a row). Without one, events
   *  buffer for drain(). */
  setSink (fn) { this.sink = fn }

  #emit (status, d, detail = '', now = 0) {
    const ev = { status, id: d.id, gen: d.gen ?? 0, origin: d.origin, step: d.step, of: d.steps?.length ?? 0, at: now,
                 detail: String(detail).slice(0, 160) }
    if (this.sink) { try { this.sink(ev) } catch { this.events.push(ev) } } else this.events.push(ev)
  }

  /** Offer a parsed directive. Higher-or-equal priority replaces the active one (logged `superseded`); lower priority
   *  is refused while a higher one is active; the SAME id while it is active is a duplicate and is refused. */
  offer (d, now) {
    this.#expire(now)
    if (this.active) {
      if (d.id === this.active.id) { this.#emit('duplicate', d, `id ${d.id} is already active`, now); return false }
      const rank = o => ORIGINS.indexOf(o)
      if (rank(d.origin) <= rank(this.active.origin)) {
        this.#emit('superseded', this.active, `by ${d.origin} ${d.id}`, now)
        // its step may be executing right now: keep it so that execution's outcome is still recorded
        this.orphans.set(this.active.gen, this.active)
        if (this.orphans.size > 8) this.orphans.delete(this.orphans.keys().next().value)
      } else {
        this.#emit('refused', d, `busy with ${this.active.origin} ${this.active.id}`, now)
        return false
      }
    }
    d.gen = ++this.gen
    this.active = d
    this.#emit('requested', d, d.why, now)
    return true
  }

  #expire (now) {
    if (this.active && now >= this.active.expiresAt) {
      this.#emit('expired', this.active, `lease ended at step ${this.active.step + 1} of ${this.active.steps.length}`, now)
      this.active = null
    }
  }

  /** The next step to run as a proposal, or null (the brain decides). While a directive is active the brain's own
   *  decisions are paused: the cognitive loop calls this first. */
  next (now) {
    this.#expire(now)
    const d = this.active
    if (!d) return null
    // WAITING OUT A RUNNER REFUSAL: HOLD -- neither re-propose the step (4 identical keys fill the admission's repeat
    // window) nor let the brain decide (its proposals would hit the same paused runner and put the directive's action
    // on cooldown, so the retry is vetoed: Codex re-review of 7593eb3). The runner is refusing everything anyway.
    if (d.retryAt != null && now < d.retryAt) return { hold: true, id: d.id, gen: d.gen, origin: d.origin, until: d.retryAt }
    const st = d.steps[d.step]
    return { id: d.id, gen: d.gen, origin: d.origin, step: d.step, of: d.steps.length, skill: st.skill, args: st.args, why: d.why }
  }

  /** A lifecycle note for the step `next` returned (admitted / started); ignored if that delivery is gone. */
  note (gen, status, detail = '', now = 0) {
    const d = this.active
    if (d && d.gen === gen) this.#emit(status, d, detail, now)
  }

  /** Report what happened to the step `next` returned, matched by GENERATION.
   *  kind: 'rejected' (admission refused) | 'runner_refusal' (never ran; refusal = the runner's failClass) |
   *  'done' (ran; status = the skill's outcome status). A rejected or failed step RELEASES CONTROL at once (CLAUDE.md:
   *  a refusal must leave the bot a legal move -- the brain decides next). A runner PAUSE is waited out until the
   *  runner's own auto-resume; busy / body_held are retried up to MAX_REFUSALS; the lease bounds both. */
  report (gen, kind, status = null, detail = '', now = 0, refusal = null) {
    const d = this.active
    if (!d || d.gen !== gen) {
      const o = this.orphans.get(gen)          // a superseded delivery's step finished: record what it did
      if (o) { this.orphans.delete(gen); this.#emit('orphan_outcome', o, `${kind}${status ? ' ' + status : ''}: ${detail}`, now) }
      return
    }
    if (kind === 'rejected') { this.#emit('refused', d, `admission: ${detail}`, now); this.active = null; return }
    if (kind === 'runner_refusal') {
      if (refusal === 'runner_paused') {
        if (d.waitUntil == null) d.waitUntil = now + PAUSE_WAIT_MS
        if (now > d.waitUntil) { this.#emit('refused', d, `runner paused past its auto-resume: ${detail}`, now); this.active = null; return }
        // the runner says how long: "paused after repeated failures; 87s until auto-resume"
        const secs = Number(/(\d+)s until auto-resume/.exec(String(detail))?.[1] ?? 120)
        d.retryAt = Math.min(d.waitUntil, now + (secs + 5) * 1000)
        this.#emit('waiting', d, `runner paused; retry at +${Math.round((d.retryAt - now) / 1000)} s (its auto-resume)`, now)
        return
      }
      d.refusals++
      if (d.refusals >= MAX_REFUSALS) { this.#emit('refused', d, `runner: ${refusal ?? detail} x${d.refusals}`, now); this.active = null; return }
      d.retryAt = now + RETRY_BUSY_MS
      this.#emit('waiting', d, `runner: ${refusal ?? detail} (${d.refusals} of ${MAX_REFUSALS})`, now)
      return
    }
    if (status === 'success') {
      this.#emit('step_done', d, detail, now)
      d.step++; d.refusals = 0; d.waitUntil = null; d.retryAt = null
      if (d.step >= d.steps.length) { this.#emit('completed', d, detail, now); this.active = null }
      return
    }
    this.#emit('released', d, `${status}: ${detail}`, now)     // failed / unknown / no_effect / aborted
    this.active = null
  }

  /** Release whatever is active (a new connection: what the old one held is stale). */
  releaseAll (why, now = 0) {
    if (this.active) { this.#emit('released', this.active, why, now); this.active = null }
  }

  /** A directive that never parsed still gets a row (it was sent; the bot refused it). */
  noteParseFailure (id, why, now = 0) {
    this.#emit('parse_failed', { id: String(id ?? '?').slice(0, 24), origin: '?', step: 0, steps: [] }, why, now)
  }

  /** Drain buffered lifecycle events (only when no sink is set). */
  drain () { const e = this.events; this.events = []; return e }
}

/** The process-wide queue: commands.mjs offers into it, cognitive.mjs reads from it. */
export const directives = new DirectiveQueue()

/** Who may direct this bot: only the sender named in C2_DIRECTOR (unset = the hook is off entirely). */
export function directorAllowed (sender, env = process.env) {
  const who = env.C2_DIRECTOR
  return !!who && sender === who
}
