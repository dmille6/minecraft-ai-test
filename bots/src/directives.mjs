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
// Pure: no I/O, no clock reads (`now` is passed in), so every rule below is unit-tested.

export const ORIGINS = ['escalation', 'overseer']          // priority order: escalation pre-empts overseer
export const MAX_STEPS = 4
export const DEFAULT_LEASE_S = 600
export const MAX_LEASE_S = 900
export const MAX_REFUSALS = 3                              // runner refusals (paused/busy) before the directive is dropped

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
                                  receivedAt: now, expiresAt: now + lease * 1000, step: 0, refusals: 0 } }
}

export class DirectiveQueue {
  constructor () { this.active = null; this.events = [] }

  #emit (status, d, detail = '') {
    this.events.push({ status, id: d.id, origin: d.origin, step: d.step, of: d.steps.length, detail: String(detail).slice(0, 160) })
  }

  /** Offer a parsed directive. A directive of higher-or-equal priority replaces the active one (the old one is
   *  logged `superseded`); a lower-priority one is refused while a higher one is active, and says so. */
  offer (d, now) {
    this.#expire(now)
    if (this.active) {
      const rank = o => ORIGINS.indexOf(o)
      if (rank(d.origin) <= rank(this.active.origin)) {
        this.#emit('superseded', this.active, `by ${d.origin} ${d.id}`)
      } else {
        this.#emit('refused', d, `busy with ${this.active.origin} ${this.active.id}`)
        return false
      }
    }
    this.active = d
    this.#emit('requested', d, d.why)
    return true
  }

  #expire (now) {
    if (this.active && now >= this.active.expiresAt) {
      this.#emit('expired', this.active, `lease ended at step ${this.active.step + 1} of ${this.active.steps.length}`)
      this.active = null
    }
  }

  /** The next step to run as a proposal, or null (the brain decides). While a directive is active the brain's own
   *  decisions are paused: the cognitive loop calls this first. */
  next (now) {
    this.#expire(now)
    const d = this.active
    if (!d) return null
    const st = d.steps[d.step]
    return { id: d.id, origin: d.origin, step: d.step, of: d.steps.length, skill: st.skill, args: st.args, why: d.why }
  }

  /** Report what happened to the step `next` returned.
   *  kind: 'rejected' (admission refused) | 'runner_refusal' (paused/busy/body_held: never ran) | 'done' (ran;
   *  status = the skill's outcome status). A rejected or failed step RELEASES CONTROL at once (CLAUDE.md: a refusal
   *  must leave the bot a legal move -- the brain decides next). A runner refusal keeps the directive for the
   *  runner's own auto-resume, up to MAX_REFUSALS, then releases. */
  report (id, kind, status = null, detail = '') {
    const d = this.active
    if (!d || d.id !== id) return
    if (kind === 'rejected') { this.#emit('refused', d, `admission: ${detail}`); this.active = null; return }
    if (kind === 'runner_refusal') {
      d.refusals++
      if (d.refusals >= MAX_REFUSALS) { this.#emit('refused', d, `runner: ${detail} x${d.refusals}`); this.active = null }
      return
    }
    if (status === 'success') {
      this.#emit('step_done', d, detail)
      d.step++
      if (d.step >= d.steps.length) { this.#emit('completed', d, detail); this.active = null }
      return
    }
    this.#emit('released', d, `${status}: ${detail}`)     // failed / unknown / no_effect / aborted
    this.active = null
  }

  /** A directive that never parsed still gets a row (it was sent; the bot refused it). */
  noteParseFailure (id, why) {
    this.events.push({ status: 'parse_failed', id: String(id ?? '?').slice(0, 24), origin: '?', step: 0, of: 0, detail: why })
  }

  /** Drain lifecycle events for logging (the caller writes them as rows). */
  drain () { const e = this.events; this.events = []; return e }
}

/** The process-wide queue: commands.mjs offers into it, cognitive.mjs reads from it. */
export const directives = new DirectiveQueue()

/** Who may direct this bot: only the sender named in C2_DIRECTOR (unset = the hook is off entirely). */
export function directorAllowed (sender, env = process.env) {
  const who = env.C2_DIRECTOR
  return !!who && sender === who
}
