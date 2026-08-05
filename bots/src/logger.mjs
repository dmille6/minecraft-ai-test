// JSONL logging. The files on disk are the source of truth; Filebeat ships
// them to Elasticsearch, which is a disposable view (ADR-0001 D4).
//
// Field names must match infra/elk/index-template.json exactly. Those mappings
// are `dynamic: strict`, so one unexpected key rejects the whole document --
// and the only symptom is a "events were dropped" line in the Filebeat log.
// In particular the game agent is `bot.*`, never `agent.*`: ECS reserves
// agent.* for the shipping agent and Filebeat overwrites it.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.mjs'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = LEVELS[config.log.level] ?? 20

let stream = null
let llmStream = null
function llmOut() {
  if (llmStream) return llmStream
  fs.mkdirSync(config.log.dir, { recursive: true })
  llmStream = fs.createWriteStream(path.join(config.log.dir, `llm-${config.bot.name}.jsonl`), { flags: 'a' })
  return llmStream
}
function out() {
  if (stream) return stream
  fs.mkdirSync(config.log.dir, { recursive: true })
  const file = path.join(config.log.dir, `skill-${config.bot.name}.jsonl`)
  stream = fs.createWriteStream(file, { flags: 'a' })
  return stream
}

/** Console line for a human watching the process. Not the telemetry path. */
export function log(level, msg, extra = {}) {
  if ((LEVELS[level] ?? 20) < threshold) return
  const bits = Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ')
  console.log(`[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${msg}${bits ? ' ' + bits : ''}`)
}

/**
 * One record per completed skill attempt. This is what proves the deterministic
 * layer actually works before any model is allowed near it -- success rate,
 * duration, and failure reason per skill, queryable in Kibana.
 */
export function logSkill({ skill, args, status, detail, startedAt, snapshot, trigger,
                           invDelta, distanceMoved, failClass, perception }) {
  const rec = {
    '@timestamp': new Date(startedAt).toISOString(),
    run_id: config.log.runId,
    trigger: trigger ?? 'chat',
    bot: {
      name: config.bot.name,
      role: config.bot.role,
      ...(snapshot?.bot ?? {}),
    },
    game: snapshot?.game ?? {},
    code: { version: config.code.version, config_hash: config.code.configHash },
    skill: {
      name: skill,
      args: args ?? {},
      status,
      duration_ms: Date.now() - startedAt,
      detail: detail ? String(detail).slice(0, 500) : undefined,
      fail_class: failClass ?? undefined,
      distance_moved: distanceMoved ?? undefined,
      inventory_delta: invDelta ?? undefined,
    },
    perception: perception ?? undefined,
  }
  try {
    out().write(JSON.stringify(rec) + '\n')
  } catch (e) {
    console.error('failed to write skill log:', e.message)
  }
  return rec
}

/**
 * One record per notable intervention -- a reflex firing, a circuit-breaker,
 * a recovery. These previously existed only as console lines, which meant
 * questions like "how often does drowning actually happen?" were unanswerable.
 *
 * Reuses the skill index with a leading underscore on the name (as _death
 * already does), so it lands in the existing strict mapping unchanged.
 */
export function logEvent({ kind, detail, snapshot, durationMs = 0, status = 'success' }) {
  const rec = {
    '@timestamp': new Date().toISOString(),
    run_id: config.log.runId,
    trigger: 'reflex',
    code: { version: config.code.version, config_hash: config.code.configHash },
    bot: { name: config.bot.name, role: config.bot.role, ...(snapshot?.bot ?? {}) },
    game: snapshot?.game ?? {},
    skill: {
      name: `_${kind}`, args: {}, status,
      duration_ms: durationMs, detail: String(detail ?? '').slice(0, 300),
    },
  }
  try { out().write(JSON.stringify(rec) + '\n') }
  catch (e) { console.error('failed to write event log:', e.message) }
  return rec
}

/**
 * One record per LLM decision, matching infra/elk/index-template.json for
 * mcai-llm-*. That mapping is dynamic:strict -- an unexpected key rejects the
 * whole document with no error beyond a dropped-events line in Filebeat.
 * The game agent is bot.*, never agent.* (ECS reserves agent.* for shippers).
 */
export function logLlm({ startedAt, snapshot, trigger, model, endpoint, res,
                         promptText, tokensEstimated, droppedEvents,
                         proposal, rejection, outcome, milestone,
                         perceptionSnapshot }) {
  const rec = {
    '@timestamp': new Date(startedAt).toISOString(),
    run_id: config.log.runId,
    trigger,
    code: { version: config.code.version, config_hash: config.code.configHash },
    bot: { name: config.bot.name, role: config.bot.role, ...(snapshot?.bot ?? {}) },
    game: snapshot?.game ?? {},
    perception: perceptionSnapshot ?? undefined,
    llm: {
      model, endpoint,
      prompt_tokens: res.prompt_tokens ?? tokensEstimated ?? null,
      completion_tokens: res.completion_tokens ?? null,
      latency_ms: res.latencyMs ?? null,
      total_duration_ns: res.total_duration_ns ?? null,
      load_duration_ns: res.load_duration_ns ?? null,
      prompt_eval_duration_ns: res.prompt_eval_duration_ns ?? null,
      eval_duration_ns: res.eval_duration_ns ?? null,
      schema_valid: !!res.schemaValid,
      error: rejection ? rejection.reason : (res.error ?? null),
      retry_count: res.retryCount ?? 0,
    },
    prompt: {
      system_hash: crypto.createHash('sha256').update(String(milestone)).digest('hex').slice(0, 16),
      text: String(promptText ?? '').slice(0, 6000),
    },
    response: { text: String(res.raw ?? '').slice(0, 4000) },
    messages: [{ role: 'user', dropped_events: droppedEvents ?? 0, milestone: String(milestone) }],
    tool_calls: proposal ? [{ skill: proposal.skill, args: proposal.args ?? {}, reason: proposal.reason ?? '' }] : [],
    outcome: { status: outcome?.status ?? 'unknown', detail: String(outcome?.detail ?? '').slice(0, 400) },
  }
  try { llmOut().write(JSON.stringify(rec) + '\n') }
  catch (e) { console.error('failed to write llm log:', e.message) }
  return rec
}

export function closeLogs() {
  if (stream) { stream.end(); stream = null }
  if (llmStream) { llmStream.end(); llmStream = null }
}
