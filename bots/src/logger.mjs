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
import { config } from './config.mjs'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = LEVELS[config.log.level] ?? 20

let stream = null
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
export function logSkill({ skill, args, status, detail, startedAt, snapshot, trigger }) {
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
    skill: {
      name: skill,
      args: args ?? {},
      status,
      duration_ms: Date.now() - startedAt,
      detail: detail ? String(detail).slice(0, 500) : undefined,
    },
  }
  try {
    out().write(JSON.stringify(rec) + '\n')
  } catch (e) {
    console.error('failed to write skill log:', e.message)
  }
  return rec
}

export function closeLogs() {
  if (stream) { stream.end(); stream = null }
}
