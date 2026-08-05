// Configuration, entirely from environment. Handoff doc S20: no hard-coded
// hosts, model names, or agent counts in application code.

import { execSync } from 'node:child_process'
import crypto from 'node:crypto'

/** Which code produced this run. Without it, comparing runs is guesswork. */
function codeVersion() {
  if (process.env.CODE_VERSION) return process.env.CODE_VERSION
  try {
    return execSync('git rev-parse --short HEAD', { cwd: new URL('../', import.meta.url).pathname,
      stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch { return 'unknown' }
}

function req(name, fallback) {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`missing required env var ${name}`)
  return v
}

export const config = {
  code: { version: codeVersion() },

  mc: {
    host: req('MINECRAFT_HOST', '127.0.0.1'),
    port: Number(req('MINECRAFT_PORT', '25565')),
    // Pinned deliberately. mineflayer's protocol layer tops out at 1.21.11;
    // letting it auto-detect risks a silent mismatch after a server upgrade.
    version: req('MINECRAFT_VERSION', '1.21.11'),
    auth: req('MINECRAFT_AUTH', 'offline'),
  },

  bot: {
    name: req('BOT_NAME', 'Scout01'),
    role: req('BOT_ROLE', 'scout'),
  },

  // Where the world is bounded. Skills refuse targets outside this so a
  // pathfinding goal can never chase a bot into ungenerated chunks.
  world: {
    borderRadius: Number(req('WORLD_BORDER_RADIUS', '1950')),
    homeX: Number(req('HOME_X', '0')),
    homeY: Number(req('HOME_Y', '70')),
    homeZ: Number(req('HOME_Z', '0')),
  },

  reflex: {
    tickMs: Number(req('REFLEX_TICK_MS', '500')),
    eatBelowFood: Number(req('EAT_BELOW_FOOD', '16')),
    fleeBelowHealth: Number(req('FLEE_BELOW_HEALTH', '8')),
    stuckSeconds: Number(req('STUCK_SECONDS', '20')),
  },

  skills: {
    // Watchdog. Handoff doc S12: "task running beyond expected duration".
    defaultTimeoutMs: Number(req('SKILL_TIMEOUT_MS', '180000')),
    maxConsecutiveFailures: Number(req('MAX_CONSECUTIVE_FAILURES', '3')),
    // How long a pause lasts before clearing itself. Without this the agent
    // needs a human to type "resume", which autonomous mode does not have.
    pauseRecoveryMs: Number(req('PAUSE_RECOVERY_MS', '120000')),
    // Cooldown on a choice that just failed. Must stay well under the decision
    // interval x a few, or the agent spends every decision being told "not yet"
    // for the action that is actually correct.
    failedCooldownMs: Number(req('FAILED_COOLDOWN_MS', '45000')),
  },

  llm: {
    enabled: req('LLM_ENABLED', 'false') === 'true',
    baseUrl: req('OLLAMA_BASE_URL', 'http://studio.lan:11434'),
    model: req('OLLAMA_MODEL', 'qwen2.5:14b-instruct'),
    // Set EXPLICITLY. Ollama silently truncates at its default and a
    // truncated prompt does not error -- the model just looks stupid.
    numCtx: Number(req('OLLAMA_NUM_CTX', '8192')),
    temperature: Number(req('LLM_TEMPERATURE', '0.3')),
    timeoutMs: Number(req('LLM_TIMEOUT_MS', '90000')),
    // Client-side budget, deliberately well under numCtx.
    promptTokenBudget: Number(req('LLM_PROMPT_TOKEN_BUDGET', '3000')),
    // Handoff doc S16: strategic decisions every 30-90s, not per tick.
    decisionCooldownMs: Number(req('LLM_DECISION_COOLDOWN_MS', '20000')),
  },

  viewer: {
    // 3D browser view of this bot. Renders chunks server-side, so it costs
    // real CPU on the game VM -- one viewer is fine, several are not.
    enabled: req('VIEWER_ENABLED', 'false') === 'true',
    port: Number(req('VIEWER_PORT', '3007')),
    firstPerson: req('VIEWER_FIRST_PERSON', 'false') === 'true',
  },

  log: {
    dir: req('LOG_DIR', '/srv/minecraft/bots/logs'),
    // Groups every record from one continuous experiment, so a bad run can be
    // filtered out of analysis without deleting it.
    runId: req('RUN_ID', `run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`),
    level: req('LOG_LEVEL', 'info'),
  },

  reconnect: {
    delayMs: Number(req('RECONNECT_DELAY_MS', '8000')),
    maxDelayMs: Number(req('RECONNECT_MAX_DELAY_MS', '120000')),
  },
}

// Fingerprint of the tuning that was actually in effect, so a behaviour change
// can be attributed to a threshold change rather than guessed at.
config.code.configHash = crypto.createHash('sha256').update(JSON.stringify({
  reflex: config.reflex, skills: config.skills,
  llm: { model: config.llm.model, numCtx: config.llm.numCtx,
         temperature: config.llm.temperature, budget: config.llm.promptTokenBudget },
  world: config.world,
})).digest('hex').slice(0, 12)
