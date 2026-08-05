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
export function skillSchema(skillNames) {
  return {
    type: 'object',
    properties: {
      skill: { type: 'string', enum: skillNames },
      args: {
        type: 'object',
        properties: {
          block: { type: 'string' },
          count: { type: 'integer' },
          item: { type: 'string' },
          x: { type: 'integer' }, y: { type: 'integer' }, z: { type: 'integer' },
          player: { type: 'string' },
        },
        additionalProperties: false,
      },
      reason: { type: 'string' },
      saw_end: { type: 'string' },
    },
    required: ['skill', 'args', 'reason', 'saw_end'],
    additionalProperties: false,
  }
}

export class LlmClient {
  constructor({ baseUrl, model, numCtx, temperature, timeoutMs }) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.model = model
    this.numCtx = numCtx
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

    let attempt = 0, lastErr = null, proposal = null, raw = '', meta = {}
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
      raw = res.content ?? ''
      try {
        proposal = JSON.parse(raw)
      } catch {
        lastErr = 'response was not valid JSON'
        attempt++
        continue
      }

      if (proposal.saw_end !== sentinel) {
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
    }
  }

  async #post({ messages, schema }) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const r = await fetch(`${this.baseUrl}/api/chat`, {
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
          },
        }),
      })
      if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 120)}`)
      const d = await r.json()
      return {
        content: d.message?.content,
        meta: {
          prompt_tokens: d.prompt_eval_count ?? null,
          completion_tokens: d.eval_count ?? null,
          total_duration_ns: d.total_duration ?? null,
          load_duration_ns: d.load_duration ?? null,
          prompt_eval_duration_ns: d.prompt_eval_duration ?? null,
          eval_duration_ns: d.eval_duration ?? null,
        },
      }
    } finally {
      clearTimeout(t)
    }
  }
}

export function makeClient() {
  return new LlmClient({
    baseUrl: config.llm.baseUrl,
    model: config.llm.model,
    numCtx: config.llm.numCtx,
    temperature: config.llm.temperature,
    timeoutMs: config.llm.timeoutMs,
  })
}
