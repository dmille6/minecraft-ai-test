// Ollama client for the cognitive layer -- ADR-0002 D1.
//
// Uses structured outputs (`format: <json schema>`) rather than native tool
// calling. Native tool support varies by model TEMPLATE, not just by model, so
// it fails inconsistently across a heterogeneous set; schema mode is uniform.
//
// Three things here exist because they fail SILENTLY otherwise:
//   1. num_ctx set explicitly -- Ollama truncates the prompt at its default
//      with no error, and a blindfolded model looks like a stupid one.
//   2. A truncation sentinel the model must echo back, so we detect (1)
//      directly rather than inferring it from bad behaviour weeks later.
//   3. Capturing load_duration -- nonzero means the model was evicted and
//      reloaded, which is the usual cause of surprise latency spikes.

import { config } from './config.mjs'
import { log } from './logger.mjs'

/** The only shape the model is allowed to emit. */
/**
 * PROPERTY ORDER IS EXECUTION ORDER.
 *
 * Ollama compiles this schema to a GBNF grammar, and generation follows the
 * declared property order. `reason` used to sit AFTER `skill` and `args`, which
 * means it was written once the decision was already committed -- it could not
 * inform the choice, only narrate it. It was pure output cost: roughly 20-25 of
 * ~60 completion tokens, and generation is the larger half of a decision
 * (2.90s of 4.67s measured over 959 real calls). It is never fed back into the
 * prompt either; `LAST ACTION` is built from status and detail, not from this.
 *
 * So it moves to the FRONT and gets a length cap. Same field, same logs, but now
 * the model states its intent before choosing, which is the only arrangement
 * where a `reason` field can earn its tokens. Whether that changes decision
 * quality is exactly what the system_hash A/B is for.
 */
export function skillSchema(skillNames) {
  return {
    type: 'object',
    properties: {
      reason: { type: 'string', maxLength: 60 },
      skill: { type: 'string', enum: skillNames },
      args: {
        type: 'object',
        properties: {
          // EVERY STRING GETS A LENGTH, because the grammar Ollama compiles
          // from this schema is the only thing that can make a repetition loop
          // inexpressible. `reason` was capped and these were not, and the
          // runaways happened exactly here -- a real logged one:
          //
          //   {"skill":"mine","args":{"y":62,"player":"Gather01}}<tool_call>
          //    \n fkkend: END-X5HYR8<tool_call>\n fkkend: END-X5HYR8...
          //
          // The `player` string opens and never closes, and the model loops the
          // sentinel until the context is exhausted. Nothing downstream needs
          // more than these lengths: the longest real block or item name is
          // ~20 characters and bot names are 8.
          block: { type: 'string', maxLength: 32 },
          count: { type: 'integer' },
          item: { type: 'string', maxLength: 32 },
          x: { type: 'integer' }, y: { type: 'integer' }, z: { type: 'integer' },
          player: { type: 'string', maxLength: 32 },
        },
        additionalProperties: false,
      },
      saw_end: { type: 'string', maxLength: 16 },
    },
    required: ['skill', 'args', 'reason', 'saw_end'],
    additionalProperties: false,
  }
}

export class LlmClient {
  constructor({ baseUrls, baseUrl, model, numCtx, maxTokens = 512, temperature, timeoutMs }) {
    const urls = (baseUrls?.length ? baseUrls : [baseUrl]).map(u => u.replace(/\/$/, ''))
    this.pool = new EndpointPool(urls)
    this.baseUrl = urls[0]          // retained for logging and back-compat
    this.model = model
    this.numCtx = numCtx
    this.maxTokens = maxTokens
    this.temperature = temperature
    this.timeoutMs = timeoutMs
  }

  /**
   * One decision. Returns a record shaped for mcai-llm-* plus the parsed
   * proposal. Never throws for model misbehaviour -- an invalid response is
   * data, recorded with schema_valid=false, not an exception.
   */
  async decide({ system, user, sentinel, schema }) {
    const started = Date.now()
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]

    // WHICH ENDPOINT ACTUALLY ANSWERED. #post knows -- it returns ep.url -- but
    // decide() used to drop it, and the caller logged config.llm.baseUrl
    // instead: a static env var that is the same string whatever the pool does.
    // On 2026-08-10 that made an endpoint migration unverifiable. Every record
    // said 10.0.0.72 because OLLAMA_BASE_URL said 10.0.0.72, and I read those
    // records as proof the fleet had not moved. The same defect as an outcome
    // reported without evidence, wearing a different hat.
    let attempt = 0, lastErr = null, proposal = null, raw = '', meta = {}, servedBy = null
    // One repair retry, then stop. ADR-0002 D1: never best-effort parse a
    // malformed response into an action.
    while (attempt < 2) {
      const msgs = attempt === 0 ? messages : [
        ...messages,
        { role: 'assistant', content: raw.slice(0, 500) },
        { role: 'user', content:
          `That response was rejected: ${lastErr}. Reply again with ONLY valid JSON ` +
          `matching the schema. Include the exact saw_end value given above.` },
      ]

      let res
      try {
        res = await this.#post({ messages: msgs, schema })
      } catch (e) {
        lastErr = e.message
        attempt++
        continue
      }

      meta = res.meta
      servedBy = res.endpoint ?? null
      raw = res.content ?? ''
      try {
        proposal = JSON.parse(raw)
      } catch {
        lastErr = 'response was not valid JSON'
        attempt++
        continue
      }

      // Trimmed. Observed live: `expected=END-CUQ9RU got= END-CUQ9RU` -- a single
      // leading space, discarded as a truncated prompt, costing a full repair
      // retry and one wasted decision. The sentinel exists to detect a prompt
      // the model never saw the end of; whitespace around it proves the opposite.
      if (String(proposal.saw_end ?? '').trim() !== String(sentinel).trim()) {
        // The model never saw the end of the prompt -> it was truncated.
        lastErr = `truncation sentinel mismatch (expected ${sentinel}, got ${proposal.saw_end ?? 'nothing'})`
        log('error', 'PROMPT TRUNCATED — reduce prompt size or raise num_ctx', {
          expected: sentinel, got: proposal.saw_end, num_ctx: this.numCtx,
          prompt_tokens: meta.prompt_tokens,
        })
        proposal = null
        attempt++
        continue
      }

      lastErr = null
      break
    }

    return {
      proposal,
      schemaValid: proposal !== null,
      error: lastErr,
      retryCount: Math.max(0, attempt - (proposal ? 0 : 1)),
      latencyMs: Date.now() - started,
      raw,
      ...meta,
      // After the spread on purpose: this must never be shadowed by a future
      // meta key. null means every attempt threw, so nothing served it.
      endpoint: servedBy,
    }
  }

  async #post({ messages, schema }) {
    // Walk the pool in preference order. A saturated primary costs one timeout,
    // then goes into cooldown so the NEXT decision starts at the fallback
    // rather than paying that timeout again.
    let lastErr = null
    for (const ep of this.pool.available()) {
      const started = Date.now()
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), this.timeoutMs)
      try {
        const r = await fetch(`${ep.url}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctl.signal,
          body: JSON.stringify({
            model: this.model,
            stream: false,
            // Handoff doc S7. Without this the model unloads between decisions
            // and every call pays a 55-80s reload -- observed live, and the
            // reason load_duration_ns is in the telemetry schema at all.
            keep_alive: '30m',
            messages,
            format: schema,
            options: {
              temperature: this.temperature,
              num_ctx: this.numCtx,   // never rely on the server default
              // The safety net under the schema bounds below. The grammar
              // should make a runaway inexpressible; this makes it survivable
              // if some field is ever added without a length.
              num_predict: this.maxTokens,
            },
          }),
        })
        if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 120)}`)
        const d = await r.json()
        this.pool.markOk(ep, Date.now() - started)
        if (ep.url !== this.baseUrl) {
          log('info', 'llm served by fallback endpoint', { endpoint: ep.url, ms: Date.now() - started })
        }
        return {
          content: d.message?.content,
          endpoint: ep.url,
          meta: {
            prompt_tokens: d.prompt_eval_count ?? null,
            completion_tokens: d.eval_count ?? null,
            total_duration_ns: d.total_duration ?? null,
            load_duration_ns: d.load_duration ?? null,
            prompt_eval_duration_ns: d.prompt_eval_duration ?? null,
            eval_duration_ns: d.eval_duration ?? null,
          },
        }
      } catch (e) {
        lastErr = e
        this.pool.markFail(ep, e.message)
      } finally {
        clearTimeout(t)
      }
    }
    throw new Error(`all ${this.pool.eps.length} llm endpoint(s) failed; last: ${lastErr?.message ?? 'unknown'}`)
  }

}


/**
 * An ordered pool of Ollama endpoints with health tracking.
 *
 * Motivated by a real outage, not by theory. The fleet was moved to a fast
 * shared inference host; hours later somebody else loaded a 55GB model onto it
 * and every bot request began dying with "This operation was aborted". Five
 * bots made ZERO admitted decisions for ten minutes while `fleet-status`
 * cheerfully reported all five "ok", because a rejected decision still counts
 * as liveness.
 *
 * Two things that failure taught, both encoded here:
 *
 * SATURATED IS NOT DOWN. That host answered /api/version in 0.27s throughout.
 * Any health check that pings a cheap endpoint would have called it healthy.
 * The only signal that means anything is whether a REAL request completes in
 * time, so health is derived from actual decision traffic and nothing else.
 *
 * A DEAD ENDPOINT MUST NOT BE RETRIED EVERY TIME. Each attempt costs a full
 * timeout, and with the primary saturated that is the entire decision budget
 * spent before the fallback is even tried. A failed endpoint goes into cooldown
 * with exponential backoff, so the fleet pays that cost once rather than on
 * every decision.
 */
export class EndpointPool {
  constructor(urls, { cooldownMs = 60_000, maxCooldownMs = 900_000 } = {}) {
    this.eps = urls.map(url => ({ url, fails: 0, downUntil: 0, calls: 0, totalMs: 0 }))
    this.cooldownMs = cooldownMs
    this.maxCooldownMs = maxCooldownMs
  }

  /** Healthy endpoints in preference order; if all are cooling down, try them all anyway. */
  available() {
    const now = Date.now()
    const up = this.eps.filter(e => e.downUntil <= now)
    // Never return empty. An expired guess beats not deciding at all.
    return up.length ? up : this.eps
  }

  markOk(ep, ms) {
    ep.fails = 0
    ep.downUntil = 0
    ep.calls++
    ep.totalMs += ms
  }

  markFail(ep, err) {
    ep.fails++
    const wait = Math.min(this.cooldownMs * 2 ** (ep.fails - 1), this.maxCooldownMs)
    ep.downUntil = Date.now() + wait

    // SAY WHAT WILL ACTUALLY HAPPEN.
    //
    // available() never returns empty -- "an expired guess beats not deciding
    // at all" -- so when this is the ONLY endpoint, downUntil is inert and the
    // very next decision tries it again. The message still announced "cooling
    // down, 900s", which is a claim about behaviour that does not occur.
    //
    // During the 2026-08-10 outage that line appeared 64 times with
    // cooldown_sec=900 and I read it as the fleet having taken itself offline
    // for fifteen minutes. It had not; the endpoint was simply dead, and the
    // bots were hammering it exactly as designed. I proposed capping the
    // backoff to "fix" a latency that was never there.
    //
    // A log line that describes a policy the code does not follow costs a
    // diagnosis. Same shape as everything else this file guards against.
    const soleEndpoint = this.eps.length === 1
    log('warn', soleEndpoint ? 'llm endpoint failing (no alternative, will keep trying)'
                             : 'llm endpoint failed, cooling down', {
      endpoint: ep.url,
      fails: ep.fails,
      ...(soleEndpoint ? {} : { cooldown_sec: Math.round(wait / 1000) }),
      err: String(err).slice(0, 120),
    })
  }

  get status() {
    const now = Date.now()
    return this.eps.map(e => ({
      url: e.url,
      state: e.downUntil > now ? `down ${Math.round((e.downUntil - now) / 1000)}s` : 'up',
      calls: e.calls,
      avg_ms: e.calls ? Math.round(e.totalMs / e.calls) : null,
    }))
  }
}

export function makeClient() {
  return new LlmClient({
    baseUrls: config.llm.baseUrls,
    baseUrl: config.llm.baseUrl,
    model: config.llm.model,
    numCtx: config.llm.numCtx,
    maxTokens: config.llm.maxTokens,
    temperature: config.llm.temperature,
    timeoutMs: config.llm.timeoutMs,
  })
}
