// Configuration, entirely from environment. Handoff doc S20: no hard-coded
// hosts, model names, or agent counts in application code.

import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

/** Which code produced this run. Without it, comparing runs is guesswork.
 *
 * CODE_VERSION is written by the deploy script, so it is a CLAIM about what is
 * running, not a measurement of it. Copy a file to the harness by hand and the
 * claim silently goes stale -- which is exactly what happened: every document
 * shipped for eleven hours was stamped 64eb591 while the fleet ran different
 * milestone code. Telemetry that misattributes behaviour to a commit is worse
 * than telemetry with no commit at all, because it invites the wrong bisect.
 *
 * So the stamp now carries a digest of the source that is actually loaded. The
 * sha still says where the code came from; the digest says whether that is
 * still true. They disagree the moment anyone edits a file in place.
 */
function srcDigest() {
  try {
    const dir = new URL('./', import.meta.url).pathname
    const h = crypto.createHash('sha256')
    // NOT dotfiles. macOS tar/scp onto ext4 writes AppleDouble companions --
    // `._skills.mjs` beside every real file -- and they end in `.mjs`, so this
    // digest hashed them as source. Instance #1 carried 17 of them (hand-copies
    // from a Mac, preserved forever by cp -r's merge semantics), instance #2
    // got 18 fresh ones from a tarball, and the same commit reported three
    // different digests across three machines while every REAL file was
    // byte-identical. A version stamp that varies with transport metadata
    // cannot prove convergence, which is its entire job.
    for (const f of readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.startsWith('.')).sort()) {
      h.update(f); h.update(readFileSync(dir + f))
    }
    return h.digest('hex').slice(0, 6)
  } catch { return 'nodigest' }
}

function codeVersion() {
  const claimed = process.env.CODE_VERSION ?? (() => {
    try {
      return execSync('git rev-parse --short HEAD', { cwd: new URL('../', import.meta.url).pathname,
        stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch { return 'unknown' }
  })()
  return `${claimed}+${srcDigest()}`
}

function req(name, fallback) {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`missing required env var ${name}`)
  return v
}

export const config = {
  code: { version: codeVersion() },

  /**
   * WHAT A BOT REMEMBERS, AND WITH WHOM.
   *
   * Three points on one spectrum, and the middle one is what this project has
   * always run without ever naming it:
   *
   *   isolated  private lessons, private world model. No bot learns anything
   *             from another. The true independent-agents control.
   *   private   private lessons, SHARED world model (the default, and what
   *             every run to date has been). Deposits found by one bot are
   *             visible to all -- world-facts.json already carries a
   *             `by: [Scout01, Scout02]` array -- but failures are not shared.
   *   shared    both shared. The hive: one bot's failure becomes every bot's
   *             avoid rule.
   *
   * The hypothesis is not "a hive learns faster". It is that a hive learns
   * faster AND IS WRONG FASTER, because independent brains are a form of error
   * isolation: this fleet once had all five bots conclude that walking home was
   * impossible, but each had to reach that wrong conclusion from its own four
   * failures, which took hours. Shared, one mislabelled failure would have done
   * it in four attempts.
   *
   * NOT shared in any mode: milestone progress. That is a bot's GOALS, not its
   * experience, and sharing it is a different experiment (shared planning).
   */
  // THE EXPERIMENT'S INDEPENDENT VARIABLE, and until now it was not in a single
  // log record. `MEMORY_SCOPE` appeared in exactly four places in the codebase,
  // none of them the logger, and it was absent from configHash -- so an
  // `isolated` bot and a `shared` bot emitted byte-identical `code.config_hash`
  // and NOTHING in Elasticsearch distinguished the arms. The only arm mapping
  // that existed anywhere was a hardcoded dict in scripts/lib/ab_report.py,
  // which is the same defect as reading a success rate without knowing what it
  // was measuring: the label lived outside the data.
  // THE POOL IS THE EXPERIMENTAL UNIT, AND THE SCOPE IS NOT.
  //
  // MEMORY_SCOPE says WHAT is shared. It cannot say WITH WHOM, and that
  // omission put the whole design on one observation. Every `shared` bot wrote
  // one lessons-hive.json, so the shared arm was n=1 no matter how many bots
  // ran in it -- adding a fourth hive bot bought more sampling INSIDE the unit
  // and no replication between units. Worse, world-facts.json had no per-bot
  // form at all for `private`, so the private and shared arms read the same
  // world model: two arms that were never independent.
  //
  // MEMORY_POOL is the boundary of ALL sharing. Within a pool, scope decides
  // what is shared; across pools, nothing is. Three pools of two or three bots
  // give the shared arm three independent units instead of one.
  memory: {
    scope: req('MEMORY_SCOPE', 'private'),
    pool: req('MEMORY_POOL', 'hive'),
  },

  // Operator-declared experiment labels. `arm` is the human name for a group,
  // `instance` partitions the two mutually-unreachable stacks, and `block`
  // identifies a crossover period -- the two instances differ in host, model and
  // cadence, so scope must be varied WITHIN an instance across time blocks, with
  // each bot acting as its own control.
  exp: {
    arm: req('EXP_ARM', 'unassigned'),
    instance: req('EXP_INSTANCE', 'unknown'),
    block: req('EXP_BLOCK', 'none'),
  },

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
    stuckSeconds: Number(req('STUCK_SECONDS', '35')),
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

  watchdog: {
    // Slower than the reflex layer on purpose -- this looks for "busy but
    // going nowhere", which only shows up over minutes, not milliseconds.
    sampleMs: Number(req('WATCHDOG_SAMPLE_MS', '15000')),
    windowMs: Number(req('WATCHDOG_WINDOW_MS', '180000')),
    // Movement below this over the whole window counts as no movement.
    minMoveBlocks: Number(req('WATCHDOG_MIN_MOVE_BLOCKS', '8')),
    // CHRONIC STRANDING, on a longer clock than stagnation.
    //
    // Stagnation asks "has this bot moved while trying" over 180s. Stranding
    // asks "has it got anywhere at all" over six minutes, because a bot stuck
    // in a cave system walks about, runs skills and fails them -- it looks busy
    // and it is going nowhere in the only direction that matters.
    //
    // The thresholds are a working miner's, not a stranded bot's: Miner01
    // legitimately spends long stretches below y=50, but not without its
    // inventory changing. Two consecutive windows must hold before anything
    // acts, so the cost of a false positive is twelve minutes of patience
    // rather than an interrupted miner.
    strandWindowMs: Number(req('WATCHDOG_STRAND_WINDOW_MS', '360000')),
    strandDepthY: Number(req('WATCHDOG_STRAND_DEPTH_Y', '50')),
    strandMinGainY: Number(req('WATCHDOG_STRAND_MIN_GAIN_Y', '8')),
  },

  llm: {
    enabled: req('LLM_ENABLED', 'false') === 'true',
    baseUrl: req('OLLAMA_BASE_URL', 'http://studio.lan:11434'),
    // An ORDERED pool. The first entry is primary; the rest are fallbacks tried
    // in order when it fails or is saturated.
    //
    // Written after losing the whole fleet to a single endpoint: five bots made
    // ZERO admitted decisions in ten minutes, every request dying with "This
    // operation was aborted", because a shared inference host had been taken
    // over by somebody else's 55GB model. The endpoint answered /api/version in
    // 0.27s the entire time -- it was saturated, not down, which is exactly the
    // failure a naive health check misses.
    //
    // Falls back to the single OLLAMA_BASE_URL so existing env files keep working.
    baseUrls: (req('OLLAMA_BASE_URLS', '') || req('OLLAMA_BASE_URL', 'http://studio.lan:11434'))
      .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
    model: req('OLLAMA_MODEL', 'qwen2.5:14b-instruct'),
    // Set EXPLICITLY. Ollama silently truncates at its default and a
    // truncated prompt does not error -- the model just looks stupid.
    //
    // 4096 is sized from 24h of telemetry: prompt MAX=2542, completion MAX=219,
    // worst case 2761. It must stay above promptTokenBudget below (3000) plus
    // the completion tail, and Ollama preallocates KV for numCtx * NUM_PARALLEL
    // so overshooting costs resident memory on every slot, not just on big
    // prompts. 8192 was costing ~6.2GB of KV to hold context we never used.
    numCtx: Number(req('OLLAMA_NUM_CTX', '4096')),
    // A HARD CEILING ON GENERATION LENGTH.
    //
    // Without one, a model that slips into a repetition loop inside a string
    // field decodes until numCtx is exhausted. Measured over 14.1 hours on the
    // inference host: 68 runaway generations, median 6,199 tokens decoded, 58
    // of them holding the slot for the full client timeout -- 2,836 slot-
    // seconds in total. With OLLAMA_NUM_PARALLEL=1 the whole fleet queues
    // behind each one, which is where the entire latency tail came from:
    // 99.4% of slow decisions fall inside a runaway window, against 4.7% of
    // fast ones.
    //
    // Completion length is p50 63, p90 83, p99 227, p99.5 315. 512 does not
    // touch a legitimate decision and bounds a runaway to a few seconds.
    maxTokens: Number(req('LLM_MAX_TOKENS', '512')),
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
    // Deliberately NOT under LOG_DIR. lessons-*.json is state, not logs: it is
    // the only artifact here that cannot be regenerated. Worlds, indices and
    // dashboards can all be rebuilt; deleted experience is simply gone, and it
    // would present as "learning does not work" rather than as data loss.
    // Keeping it in a separate directory makes that structural rather than
    // depending on every future cleanup script knowing the exception.
    stateDir: req('STATE_DIR', '/srv/minecraft/bots/state'),
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

// Refuse to start on a context window that cannot hold what we will send.
//
// This pairing is the one config error with NO symptom. Ollama truncates a
// prompt that exceeds num_ctx without erroring, so the model simply answers
// with the top of its instructions missing and looks stupid rather than
// broken. The saw_end sentinel detects it per-call, but by then three bots
// have already been shipping degraded decisions into the lessons files.
//
// COMPLETION_HEADROOM is the observed completion ceiling (219 tokens over 24h)
// rounded up hard: generation is uncapped, so this is a floor on our margin,
// not a prediction.
const COMPLETION_HEADROOM = 512
const needCtx = config.llm.promptTokenBudget + COMPLETION_HEADROOM
if (config.llm.enabled && config.llm.numCtx < needCtx) {
  throw new Error(
    `OLLAMA_NUM_CTX=${config.llm.numCtx} is too small for ` +
    `LLM_PROMPT_TOKEN_BUDGET=${config.llm.promptTokenBudget} + ${COMPLETION_HEADROOM} ` +
    `completion headroom (need >= ${needCtx}). Ollama would truncate the prompt ` +
    `silently. Raise OLLAMA_NUM_CTX or lower LLM_PROMPT_TOKEN_BUDGET.`)
}

// Fingerprint of the tuning that was actually in effect, so a behaviour change
// can be attributed to a threshold change rather than guessed at.
config.code.configHash = crypto.createHash('sha256').update(JSON.stringify({
  // MEMORY SCOPE BELONGS IN THE HASH. Without it the two arms of the experiment
  // produce identical config hashes, so the tripper's "bots disagree on config"
  // check cannot see a mixed fleet and no analysis can separate the arms.
  memory: config.memory,
  reflex: config.reflex, skills: config.skills,
  watchdog: {
    // Slower than the reflex layer on purpose -- this looks for "busy but
    // going nowhere", which only shows up over minutes, not milliseconds.
    sampleMs: Number(req('WATCHDOG_SAMPLE_MS', '15000')),
    windowMs: Number(req('WATCHDOG_WINDOW_MS', '180000')),
    // Movement below this over the whole window counts as no movement.
    minMoveBlocks: Number(req('WATCHDOG_MIN_MOVE_BLOCKS', '8')),
    // CHRONIC STRANDING, on a longer clock than stagnation.
    //
    // Stagnation asks "has this bot moved while trying" over 180s. Stranding
    // asks "has it got anywhere at all" over six minutes, because a bot stuck
    // in a cave system walks about, runs skills and fails them -- it looks busy
    // and it is going nowhere in the only direction that matters.
    //
    // The thresholds are a working miner's, not a stranded bot's: Miner01
    // legitimately spends long stretches below y=50, but not without its
    // inventory changing. Two consecutive windows must hold before anything
    // acts, so the cost of a false positive is twelve minutes of patience
    // rather than an interrupted miner.
    strandWindowMs: Number(req('WATCHDOG_STRAND_WINDOW_MS', '360000')),
    strandDepthY: Number(req('WATCHDOG_STRAND_DEPTH_Y', '50')),
    strandMinGainY: Number(req('WATCHDOG_STRAND_MIN_GAIN_Y', '8')),
  },

  llm: { model: config.llm.model, numCtx: config.llm.numCtx,
         temperature: config.llm.temperature, budget: config.llm.promptTokenBudget },
  world: config.world,
})).digest('hex').slice(0, 12)
