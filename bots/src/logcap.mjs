// LOGCAP-02: THE TOWN LOG GATHERING CAP (OWNER 2026-11-08: "a log gathering cap like the cobble cap -- once a town holds more than
// a limit, bots stop choosing 'gather logs'"). Design: docs/reports/logs-design-2026-11-08.md. (logcap-01, 10-17, was the BANK
// target raise 64 -> 4000 in stocktarget.mjs; this is the gathering side.)
//
// MEASURED (fleet .31, 80 bots / 16 towns, 48 h to 11-08 13:35Z, 3,838 bot-h): the town chests hold 2,817-5,180 logs in 15 of
// 16 towns (hive-d 860), ~65k in all, and the oak_log bank target (4,000 a type) is reached in ~9 towns, so 3,043 logs went DOWN
// THE JUNK WELL in 48 h. 31,124 of 33,387 logs gained came from the gather skill (93%); 15,209 were banked on 11-07 alone. The
// draw is small: ~2,650 logs spent in 48 h fleet-wide (bags' own fuel, tables, sticks, scaffold) and 1,329 withdrawn from towns --
// ~40-85 logs a town a day. The idle rung's "Cut 16 logs (any kind) for the town store" was the TASK of 12,059 of the 21,724
// gather-log proposals (55%) and 187.6 bot-h of decision time.
//
// THE RULE: the idle rung's `logs` kind -- the one log batch that exists to fill the TOWN STORE -- has no means while this bot's
// town is CAPPED. Capped above HIGH logs (every species, the town index), uncapped again only at or below LOW (hysteresis: a town
// drawing ~50 a day crosses the 256-log band in ~5 days, so the switch never flaps). An already-open logs batch is met at once
// when its town is capped (milestones.mjs idleDone): the lap goes on to `return`, never waits on a gain it should not make. The lap then walks the rotation to its next
// kind with means (grounds, iron, coal, or the scout lap: idlework.mjs idlePick) -- never a refusal, never a dead end.
//
// NEVER BLOCKED (the rule touches ONE means flag and nothing else): the personal wood rungs (SUSTAINING stockpile_wood, the bag's
// 16-unit keep, and the gatherer chain's 12 logs) that tool crafting needs; a project's or the materials job's DRAW from the town
// (withdrawals never read this); logs from tree clears (tidy / forest / tree farm) and every other pickup, which still bank; a
// gather the model chooses for its own reasons (admission is protected and unchanged).
//
// THE COUNT: the town index (skills.mjs matsTownStock) -- a LOWER BOUND (an unknown container counts 0). So a count > HIGH proves
// the cap at any coverage; uncapping needs the index to have seen LOGCAP_MIN_COVERAGE of the containers. An unreadable index holds
// the last proven decision for LOGCAP_HOLD_MS, then fails OPEN (the base behaviour).
//
// LOGCAP=0|off is the rollback (the means are untouched). LOGCAP_HIGH / LOGCAP_LOW override the limits (whole numbers, LOW < HIGH,
// LOW >= the build reserve's 512 logs; anything else -> the defaults, said in the row as src=invalid).

// THE LIMITS (Codex design 11-08, adopted over Claude's 1,536/1,024: the chests are near full, and the charcoal piece converts only
// above 1,536 so the two never form a gather -> charcoal treadmill): stop at 1,024 = twice the build reserve, ~10 days of the
// measured town draw above it; resume at <= 768 (a 256-log band = sixteen idle batches).
export const LOGCAP_HIGH = 1024
export const LOGCAP_LOW = 768
export const LOGCAP_MIN_COVERAGE = 0.8
/** LOW may not go under the build reserve's logs (stocktarget.mjs BUILD_RESERVE.logs, 512 -- restated, not imported: mats.mjs is
 *  the reserve's only reader, matset.test.mjs; logcap2.test.mjs proves the two agree). */
export const LOGCAP_MIN_LOW = 512
export const LOGCAP_HOLD_MS = 30 * 60_000
export const LOGCAP_TTL_MS = 5 * 60_000   // the reader's cache per bot (skills.mjs): the band is days wide; the index is MBs
const OFF = ['0', 'off', 'false', 'no']
const whole = v => /^[0-9]+$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : null

/** THE SETTING -> { on, high, low, src }. Pure over env. */
export function logCapConfig (env = process.env) {
  const on = !OFF.includes(String(env?.LOGCAP ?? '').trim().toLowerCase())
  const rawH = String(env?.LOGCAP_HIGH ?? '').trim(), rawL = String(env?.LOGCAP_LOW ?? '').trim()
  if (!rawH && !rawL) return { on, high: LOGCAP_HIGH, low: LOGCAP_LOW, src: 'default' }
  const high = rawH ? whole(rawH) : LOGCAP_HIGH, low = rawL ? whole(rawL) : LOGCAP_LOW
  if (high == null || low == null || !(low < high) || low < LOGCAP_MIN_LOW) return { on, high: LOGCAP_HIGH, low: LOGCAP_LOW, src: 'invalid' }
  return { on, high, low, src: 'env' }
}

/** Every log a town stock map holds (any species, stems too). Pure. */
export const townLogsIn = (stock = {}) => Object.entries(stock ?? {}).reduce((t, [n, c]) => t + (/_(log|stem)$/.test(n) ? (Number(c) || 0) : 0), 0)

/**
 * THE DECISION -> { capped, why, logs, coverage }. Pure.
 *   prev   the last decision ({ capped, at } where `at` is when it was last PROVEN from a readable index) or null
 *   read   { ok, logs, coverage } from the town index (logs a lower bound), or null
 *   cfg    logCapConfig()
 * why: off | above_high | below_low | band (held between LOW and HIGH) | coverage (too little seen to uncap: fails open unless a
 * cap was proven within the hold) | unread (same) | held.
 */
export function logCapNext (prev, read, cfg = logCapConfig(), now = Date.now()) {
  if (!cfg?.on) return { capped: false, why: 'off', logs: null, coverage: null, at: now }
  const recent = !!prev?.capped && Number.isFinite(prev?.at) && now - prev.at < LOGCAP_HOLD_MS
  if (!read?.ok || !Number.isFinite(read.logs)) return { capped: recent, why: recent ? 'held' : 'unread', logs: null, coverage: null, at: recent ? prev.at : now }
  const logs = read.logs, coverage = Number.isFinite(read.coverage) ? read.coverage : 0
  // a lower bound above HIGH proves the cap whatever the coverage
  if (logs > cfg.high) return { capped: true, why: 'above_high', logs, coverage, at: now }
  if (coverage < LOGCAP_MIN_COVERAGE) return { capped: recent, why: recent ? 'held' : 'coverage', logs, coverage, at: recent ? prev.at : now }
  if (logs <= cfg.low) return { capped: false, why: 'below_low', logs, coverage, at: now }
  return { capped: !!prev?.capped, why: 'band', logs, coverage, at: now }
}

/** The idle means with the `logs` kind taken away while capped (nothing else changes). Pure. */
export function logCapMeans (means = {}, capped = false) {
  if (!capped) return means
  return { ...means, logs: false }
}
/** Is an OPEN batch met by the cap (a logs batch whose town is capped)? Pure. */
export const logCapMet = (kind, capped = false) => kind === 'logs' && !!capped

/** The row's detail (the read parses it): `logcap capped=1 why=above_high logs=4247 high=1024 low=768 cov=0.93 src=default`. */
export const logCapDetail = (d, cfg) => `logcap capped=${d.capped ? 1 : 0} why=${d.why} logs=${d.logs ?? '-'} high=${cfg.high} low=${cfg.low} cov=${Number.isFinite(d.coverage) ? d.coverage.toFixed(2) : '-'} src=${cfg.src}`

// ---- the reader's hook (skills.mjs installs it: matsTownStock over the town index, cached; this module imports no skills) ----
let stateOf = () => null
export function setLogCapState (fn) { if (typeof fn === 'function') stateOf = fn }
/** This bot's town decision now ({ capped, why, logs, ... }) or null. Never throws (null: the base). */
export const townLogCapState = b => { try { return stateOf(b) ?? null } catch { return null } }
/** Is this bot's town capped now? Never throws (false: the base). */
export const townLogCapped = b => !!townLogCapState(b)?.capped

/**
 * THE OBSERVATION LINE (the model's own log choices: 9.5k of the 31k gathered logs in 48 h came from gathers proposed under
 * other tasks -- "Return home" 4,276, the iron tasks 2,832, grounds 1,156) -> a line or ''. Pure. Shown only while capped AND
 * the bag already holds the personal wood keep (`keep`, woodkeep.mjs WOOD_KEEP), so a bot short of wood for its own tools is
 * never told not to cut. `wood` = the bag's wood units (logs + planks / 4).
 */
export function logCapLine (d, wood, { cfg = logCapConfig(), keep = 16, prompt = logCapPromptOn() } = {}) {
  if (!prompt || !d?.capped || !Number.isFinite(wood) || wood < keep) return ''
  const n = Number.isFinite(d.logs) ? `${d.logs} logs` : 'more logs than it needs'
  return `TOWN WOOD: the town store holds ${n}, above its ${cfg.high} cap -- it needs no more logs. You carry ${Math.floor(wood)} wood: ` +
    `cut a log only when a craft of your own needs it.`
}
/** LOGCAP_PROMPT=0|off: no observation line (the means rule stays). */
export const logCapPromptOn = (env = process.env) => !OFF.includes(String(env?.LOGCAP_PROMPT ?? '').trim().toLowerCase())
