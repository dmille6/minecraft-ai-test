/**
 * brain-01: WHICH BRAIN DECIDED, in the skill stream as well as on every decision row.
 *
 * The decision rows (llm-<bot>.jsonl) carry `llm.brain` on every decision: the label of the endpoint that served the
 * accepted answer ('gemma4', ...), 'local' for an unlabelled endpoint, 'order' for a work order (no model asked),
 * null when nothing served. The canary machinery reads only skill rows (licencecheck scans skill-*.jsonl), so a bot
 * whose pool has a LABELLED endpoint also writes:
 *   _brain_config  once at start: the pool in preference order, with each endpoint's label, model and timeout;
 *   _brain_share   every SHARE_EVERY_MS: how many decisions each brain made since the last row.
 * A bot with no labelled endpoint writes neither -- the baseline fleet emits zero of these kinds, which is what
 * makes them a licence for a model/env canary.
 */
export const SHARE_EVERY_MS = 10 * 60_000

/**
 * OLLAMA_BRAIN_PRIMARY (one `url|model|brain|timeoutMs` entry) is PREPENDED to the bot's own pool. A canary sets
 * this one variable in canary.env, and every canary bot keeps ITS OWN local endpoints, in its own order, as the
 * fallback -- a d-pool bot still falls back to its 3090 first. Unset = the bot's own list, unchanged.
 */
export function composePool (brainPrimary, ownList) {
  const own = (ownList ?? []).filter(Boolean)
  const p = String(brainPrimary ?? '').trim()
  if (!p) return own
  if (p.includes(',')) throw new Error('OLLAMA_BRAIN_PRIMARY is ONE endpoint entry (url|model|brain|timeoutMs), not a list')
  return [p, ...own.filter(e => e.split('|')[0] !== p.split('|')[0])]
}

/** The labelled endpoints of a pool (pool.eps); empty = this bot is not on a remote brain. */
export function labelled (eps) {
  return (eps ?? []).filter(e => e.brain)
}

/** `_brain_config` detail: `brain=gemma4 pool=[gemma4 gemma4:26b@http://127.0.0.1:11601 15000ms > local qwen2.5:7b-instruct@http://10.0.0.72:11434 45000ms]` */
export function configDetail (eps, globalModel, globalTimeoutMs) {
  const first = labelled(eps)[0]
  const parts = (eps ?? []).map(e => `${e.brain ?? 'local'} ${e.model ?? globalModel}@${e.url} ${e.timeoutMs ?? globalTimeoutMs}ms`)
  return `brain=${first?.brain ?? 'local'} pool=[${parts.join(' > ')}]`
}

/** The label a decision row carries. */
export function decisionBrain (isOrder, res) {
  if (isOrder) return 'order'
  return res?.brain ?? null
}

export class BrainTally {
  constructor (now = Date.now()) { this.since = now; this.n = {} }
  note (brain) { const k = brain ?? 'none'; this.n[k] = (this.n[k] ?? 0) + 1 }
  /** A `_brain_share` detail when SHARE_EVERY_MS has passed (then resets), else null. */
  due (now = Date.now()) {
    if (now - this.since < SHARE_EVERY_MS) return null
    const keys = Object.keys(this.n).sort()
    const total = keys.reduce((a, k) => a + this.n[k], 0)
    const detail = `since=${new Date(this.since).toISOString()} total=${total} ` + keys.map(k => `${k}=${this.n[k]}`).join(' ')
    this.since = now; this.n = {}
    return detail
  }
}
