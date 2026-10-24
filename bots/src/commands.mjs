// Chat commands -- chatgate-01 (docs/reports/comms-design-2026-10-21.md section 5.3; owner C4/C7 "yes" 2026-10-22).
//
// WHAT CHANGED, AND WHY. Until chatgate-01 this file obeyed `!stop`, `!goto x y z`, `<bot> come` and the rest from ANY
// player name (design 2.7). Bench bots connect offline-mode and the showcase runs online-mode=false, so a player name is
// not authentication: anyone on the LAN who could join a server could stop, move or steer every bot on it. Measured cost
// of closing it: 0 chat commands in 24 h in 12 journals (design 2.7).
//
// A NAME IS NOT AN IDENTITY, EVEN WITH THE ALLOWLIST. mineflayer derives the `chat` event's sender from the RENDERED text
// (its legacy vanilla chat regex), not from the packet: a `/me` from a two-letter player renders as `* ab mike: !stop` and
// arrives as username `mike` (Claude r1 P3-3). So the allowlist can only ever hand out verbs that are harmless in a
// stranger's hands. That is why GRANTABLE is read-only and why a steering verb must never be added to it.
//
// THE RULE NOW:
//   - a command runs only for a name listed in OWNER_CHAT_NAMES, and only for the verbs that name was granted;
//   - the default is EMPTY: the bench accepts no command from anyone;
//   - the only verbs that can be granted are READ-ONLY (GRANTABLE: `status`, `help`). Human chat never steers a bot:
//     there is no stop, resume, goto, come, follow, gather, home or deposit over chat any more, whatever the env says.
//     A steering verb or a malformed entry in the env is dropped and COUNTED in the `_chatgate_mode` row (counts and
//     validated names only: the env's raw text never reaches telemetry -- Codex r1 P2-2);
//   - an unlisted speaker's line is ignored BEFORE it is parsed (Codex r1 P2-1): only a two-test prefix check counts the
//     lines that looked addressed, for one `_chat_ignored` row per minute at most;
//   - `status` is answered from the bot's own state. It does not go through the runner: it never occupies the runner,
//     never takes the arbiter, never preempts or blocks a decision, and never writes a skill row. It is WHISPERED to the
//     asker (Claude r1 P3-4: position and task are not broadcast; a spoofed name gets nothing back);
//   - replies are rate-limited (REPLY_GAP_MS per bot), so a flood of `!status` cannot get the bot kicked for chat spam.
//
// OWNER_CHAT_NAMES: comma-separated entries `name` or `name:verb|verb`; a bare name gets `status` only (least privilege).
//   bench    (unset)               -> no commands
//   showcase OWNER_CHAT_NAMES=mike -> mike: status   (owner C4: `status` only)
import { config } from './config.mjs'
import { log, logEvent } from './logger.mjs'
import { snapshot } from './state.mjs'

/** The verbs a listed name may be granted. None of them changes what the bot does. NEVER add a steering verb: see above. */
export const GRANTABLE = Object.freeze(['status', 'help'])
const GRANTABLE_SET = new Set(GRANTABLE)
/** Minecraft's own username shape; anything else in the env is dropped, never half-trusted. */
const NAME_RE = /^[A-Za-z0-9_]{1,16}$/
const VERB_RE = /^[a-z]{1,16}$/
/** At most one reply per bot per this long (vanilla kicks above ~10 lines in a burst). */
export const REPLY_GAP_MS = 10_000
/** At most one `_chat_ignored` row per bot per this long, carrying the counts since the last one. */
export const IGNORED_ROW_MS = 60_000

/**
 * PARSE THE ALLOWLIST -> { grants: Map<lowercased name, Set<verb>>, droppedEntries, droppedVerbs }. Pure.
 * Names compare case-insensitively (the server treats usernames that way). An entry is dropped whole when its name is
 * malformed, it has more than one ':' or its verb list is empty; a verb outside GRANTABLE is dropped and counted.
 */
export function parseOwnerChatNames (raw = '') {
  const grants = new Map()
  let droppedEntries = 0, droppedVerbs = 0
  for (const entry of String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const parts = entry.split(':')
    const name = parts[0].trim()
    if (parts.length > 2 || !NAME_RE.test(name)) { droppedEntries++; continue }
    const verbs = parts.length === 1 ? ['status'] : parts[1].split('|').map(v => v.trim().toLowerCase()).filter(Boolean)
    if (!verbs.length) { droppedEntries++; continue }
    const set = grants.get(name.toLowerCase()) ?? new Set()
    for (const v of verbs) {
      if (VERB_RE.test(v) && GRANTABLE_SET.has(v)) set.add(v)
      else droppedVerbs++
    }
    if (set.size) grants.set(name.toLowerCase(), set)
  }
  return { grants, droppedEntries, droppedVerbs }
}

/** May `username` run `verb`? Pure. An unlisted name may run nothing. */
export function authorized (grants, username, verb) {
  const set = grants?.get?.(String(username ?? '').toLowerCase())
  return !!set && set.has(String(verb ?? '').toLowerCase())
}

/** The command a line addresses to this bot -> { verb, rest } | null. Pure. `!verb` or `<botname> verb`. LISTED SPEAKERS ONLY. */
export function addressed (message, botName) {
  const line = String(message ?? '').trim()
  let body = null
  if (line.startsWith('!')) body = line.slice(1)
  else if (botName && line.toLowerCase().startsWith(String(botName).toLowerCase() + ' ')) body = line.slice(String(botName).length + 1)
  if (!body) return null
  const [verb, ...rest] = body.trim().split(/\s+/)
  return verb ? { verb: verb.toLowerCase(), rest } : null
}

/** For COUNTING an unlisted line only: does it look addressed? Two prefix tests, no parse. Pure. */
export function looksAddressed (message, botName) {
  const m = typeof message === 'string' ? message : ''
  return m.startsWith('!') || (!!botName && m.slice(0, botName.length + 1).toLowerCase() === `${String(botName).toLowerCase()} `)
}

/** The `_chatgate_mode` licence row's detail. Pure. Validated names and counts only. */
export function chatgateModeDetail ({ grants, droppedEntries = 0, droppedVerbs = 0 }) {
  const g = [...(grants?.entries?.() ?? [])].map(([n, s]) => `${n}:${[...s].sort().join('|')}`).sort()
  return `phase=mode commands=${g.length ? 'allowlist' : 'none'} grants=${g.length ? g.join(',') : '-'} dropped_entries=${droppedEntries} dropped_verbs=${droppedVerbs} grantable=${GRANTABLE.join('|')} peer_ingest=retired`
}

/** The reply to `status`, from state alone. Pure over the bot object (never the runner's run()). */
export function statusLine (bot, runner) {
  const p = bot?.entity?.position
  const at = p ? `${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}` : '?'
  const inv = (() => { try { return bot.inventory.items().length } catch { return '?' } })()
  const task = (() => { try { return runner?.describe?.() ?? 'idle' } catch { return '?' } })()
  return `hp ${bot?.health?.toFixed?.(0) ?? '?'} food ${bot?.food ?? '?'} at ${at} | ${inv} stacks | task: ${task}`.slice(0, 200)
}

/**
 * THE OTHER CHAT-TEXT LISTENER'S PROVENANCE RULE (index.mjs watchForDeathCause; Codex r1 P2-3). A death message is a
 * SYSTEM message; a player's chat, `/say` and `/me` all arrive as position 'chat' (mineflayer's playerChat path) and are
 * never a death cause, whatever their text. -> the cause text after "<name> ", or null. Pure.
 */
export function deathCauseText (text, position, name, notADeath = /^(joined|left) the game$/i) {
  // ONLY 'chat' IS REFUSED, on purpose (Claude r2 P3-4): 'system' and 'game_info' are server-authored, and a chat plugin that
  // re-renders player chat as system lines still cannot author one that STARTS with this bot's name. Never narrow this to
  // an allowlist of positions: it would drop the server's death message on some build and lose the cause.
  if (position === 'chat') return null
  const t = String(text ?? '')
  if (!name || !t.startsWith(`${name} `)) return null
  const rest = t.slice(name.length + 1).trim()
  if (!rest || rest.length >= 160 || notADeath.test(rest)) return null
  return rest
}

/**
 * Attach the gated listener. -> { detach, stats, grants }.
 *   opts.env       the environment the allowlist is read from (process.env)
 *   opts.emit      the row writer (logEvent with this bot's snapshot)
 *   opts.now       the clock;  opts.timers  flush `_chat_ignored` on a timer too (off in tests)
 *   opts.parse     the command parser (addressed); injectable so a test can prove an unlisted line never reaches it
 */
export function attachCommands (bot, runner, { env = process.env, emit = null, now = () => Date.now(), timers = true, parse = addressed } = {}) {
  const parsed = parseOwnerChatNames(env.OWNER_CHAT_NAMES ?? '')
  const { grants } = parsed
  const write = emit ?? (row => { try { logEvent({ ...row, snapshot: snapshot(bot) }) } catch { /* telemetry */ } })
  const stats = { ignored: 0, ignoredAddressed: 0, refused: 0, answered: 0, throttled: 0 }
  let lastReply = -Infinity, lastIgnoredRow = now(), pendingIgnored = 0, pendingAddressed = 0
  try { write({ kind: 'chatgate_mode', status: 'success', detail: chatgateModeDetail(parsed) }) } catch { /* telemetry */ }

  const flushIgnored = (t, force = false) => {
    if (!pendingIgnored || (!force && t - lastIgnoredRow < IGNORED_ROW_MS)) return
    try { write({ kind: 'chat_ignored', status: 'no_effect', detail: `ignored=${pendingIgnored} addressed=${pendingAddressed} secs=${Math.round((t - lastIgnoredRow) / 1000)}` }) } catch { /* telemetry */ }
    lastIgnoredRow = t; pendingIgnored = 0; pendingAddressed = 0
  }
  const timer = timers ? setInterval(() => { try { flushIgnored(now()) } catch { /* telemetry */ } }, IGNORED_ROW_MS) : null
  timer?.unref?.()
  const reply = (to, text) => {
    const t = now()
    if (t - lastReply < REPLY_GAP_MS) { stats.throttled++; return false }
    lastReply = t
    try {
      const line = String(text).slice(0, 200)
      if (typeof bot.whisper === 'function') bot.whisper(to, line); else bot.chat(line)
      return true
    } catch { return false }
  }

  const handler = (username, message) => {
    try {
      if (username === bot.username) return
      // THE GATE COMES FIRST: an unlisted speaker's line is never parsed for a command.
      if (!grants.has(String(username ?? '').toLowerCase())) {
        stats.ignored++; pendingIgnored++
        if (looksAddressed(message, config.bot.name)) { stats.ignoredAddressed++; pendingAddressed++ }
        flushIgnored(now())
        return
      }
      const cmd = parse(message, config.bot.name)
      if (!cmd) return
      if (!authorized(grants, username, cmd.verb)) {
        stats.refused++
        log('info', 'chat command refused', { from: username, cmd: cmd.verb.slice(0, 16) })
        return
      }
      log('info', 'chat command', { from: username, cmd: cmd.verb })
      if (cmd.verb === 'help') {
        if (reply(username, `commands for ${username}: ${[...grants.get(String(username).toLowerCase())].sort().join(', ')}`)) stats.answered++
        return
      }
      if (cmd.verb === 'status') {
        if (reply(username, statusLine(bot, runner))) stats.answered++
      }
    } catch (e) {
      log('error', 'command handler failed', { err: e?.message })
    }
  }
  bot.on('chat', handler)
  let detached = false
  const detach = () => {
    if (detached) return
    detached = true
    try { bot.removeListener('chat', handler) } catch { /* already gone */ }
    if (timer) clearInterval(timer)
    try { flushIgnored(now(), true) } catch { /* telemetry */ }
  }
  // THE GATE GOES WITH ITS BOT (Codex r2 P2-1, Claude r2 P2-1): index.mjs reconnects in-process, and the `_chat_ignored`
  // timer's closure holds this bot (its world, its inventory) through the row writer. Detached on `end`, never leaked.
  try { bot.once?.('end', detach) } catch { /* a bot without events: the caller detaches */ }
  return { grants, stats, detach, timerLive: () => !detached && timer != null }
}
