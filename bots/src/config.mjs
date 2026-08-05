// Configuration, entirely from environment. Handoff doc S20: no hard-coded
// hosts, model names, or agent counts in application code.

function req(name, fallback) {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`missing required env var ${name}`)
  return v
}

export const config = {
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
