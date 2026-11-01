// SHOWCHAT-01: SHOWCASE CHAT -- comms stage 2 (docs/reports/comms-design-2026-10-21.md section 5; owner 10-21 "yes" to the
// three stages, 10-22 C5/C6/C8 "yes": the showcase only, templates first, timelapse captions; owner 11-01 showcase list item 3).
//
// WHAT IT DOES. The bots tell the owner (spectator `mike`) what they actually did, in short plain lines in the game chat:
// a project sited or finished, a section of it done, ore found, an expedition out and back, a load stored in town, an iron
// pickaxe made, a bot stuck or dead. Every line is made by a TEMPLATE from one telemetry record this bot just wrote (the
// logger's read-only record tap), so the talk cannot say what did not happen. No LLM call anywhere: nothing here is on the
// decision path, and nothing here changes what a bot does -- it only speaks.
//
// WHAT IT ALSO DOES: QUIET THE INTERNAL CHATTER (showcase only). The bots already chat "milestone done -- now: idle" every few
// seconds town-wide (cognitive.mjs, ~2,300 lines a day on the showcase 11-01), plus "[fleet] ..." hazard lines and the spawn
// banners. Nothing reads them back (chatgate-01 retired the ingestion) and they bury every real line, so while SHOWCHAT is on
// those exact shapes are dropped at bot.chat (counted in the `_say_drop` row). Whispers (the `status` reply to mike) do not
// pass through bot.chat and are untouched.
//
// NEVER SPAM (design 5.4, per bot AND per town, the town limits shared through one small file in the pool's state dir so
// ten processes and their restarts agree):
//   tier 1 (project sited / finished, death, diamonds)   bot gap 20 s,  town gap 5 s
//   tier 2 (sections, iron/gold, expeditions, stuck)      bot gap 2 min, town gap 20 s
//   tier 3 (deposits, copper/coal/lapis, smelting)        bot gap 2 min, town gap 20 s, and only while the town is quiet
//   caps: 10 lines per bot per hour, 30 per town per hour (tier 1 is never refused by the hourly caps below 2x)
//   dedupe: the same key town-wide within its own window (default 10 min; a section 12 h; a project 24 h)
// A refused line is DROPPED AND COUNTED, never queued (design 5.4: no backlog to flush in a burst).
//
// SAFE BY CONSTRUCTION, CHECKED ANYWAY (design 5.3): the output filter refuses a line that starts with `!`, `/`, `[` or a
// name-shaped token, names a known player or bot, or carries a command verb after a name. The templates never produce one;
// a mutant feeding an unsafe line proves the filter is live.
//
// SWITCHES. SHOWCHAT=on|off overrides; otherwise on only in SHOWCHAT_POOLS (default `showcase`). The KILL SWITCH needs no
// restart: a file `showchat.off` in the pool's state dir silences every announcement within 15 s (the chatter filter stays).
// SHOWCHAT=off is the full rollback (no tap, no wrapper: today's behaviour).
//
// CAPTIONS: every line spoken is also appended to `showchat-lines.jsonl` in the pool's state dir; the timelapse video builder
// (infra/showcase/tl_video.py) overlays the recent lines and a day tally on its frames.

import fs from 'node:fs'
import path from 'node:path'

export const SHOWCHAT_V = 1

/** On? SHOWCHAT=on|off overrides; otherwise only in SHOWCHAT_POOLS (default showcase). Pure. */
export function showchatOn (env = process.env, pool = '') {
  const v = String(env?.SHOWCHAT ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.SHOWCHAT_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes(String(pool))
}

export const RATE = Object.freeze({
  botGapMs: { 1: 20_000, 2: 120_000, 3: 120_000 },
  townGapMs: { 1: 5_000, 2: 20_000, 3: 20_000 },
  /** tier 3 speaks only when the town has said nothing for this long (the low-value lines yield to the rest) */
  quietForT3Ms: 60_000,
  botPerHour: 10,
  townPerHour: 30,
  /** tier 1 is held to twice the hourly caps, never to the plain caps */
  tier1CapFactor: 2,
  dedupeMs: 10 * 60_000,
  /** the town file keeps this much history (the hourly caps' window, plus slack) */
  keepMs: 2 * 3600_000,
})
export const MAX_LEN = 200
export const KILL_FILE = 'showchat.off'
export const STATE_FILE = 'showchat-town.json'
export const LINES_FILE = 'showchat-lines.jsonl'
export const LINES_ROTATE_BYTES = 4 * 1024 * 1024
export const DEATH_DELAY_MS = 6_000

// ---- pure: words -------------------------------------------------------------------------------------------------------

const PROJECT_NAMES = Object.freeze({
  monument: 'ziggurat', shop: 'workshop', paths: 'town paths', wall: 'town wall', treefarm: 'tree farm',
  shopchest: 'materials chests', storehouse: 'storehouse', shaft: 'mineshaft', tidy: 'town tidy-up',
})
/** A project id -> words. `house1` -> "first house"; an unknown id -> itself, de-underscored. Pure. */
export function projectName (id) {
  const s = String(id ?? '').trim()
  if (PROJECT_NAMES[s]) return PROJECT_NAMES[s]
  const h = /^house(\d+)$/.exec(s)
  if (h) return Number(h[1]) === 1 ? 'first house' : `house no. ${Number(h[1])}`
  return s.replace(/[_-]+/g, ' ') || 'project'
}

const SEG_NAMES = Object.freeze({
  'wall-F': 'front wall', 'wall-B': 'back wall', 'wall-L': 'left wall', 'wall-R': 'right wall',
  'roof-edge': 'roof edge', 'roof-inner': 'roof', 'fit-out': 'fittings', pad: 'floor', ring: 'corner posts', earth: 'groundwork',
  'W-L': 'lights',
})
const SIDE = Object.freeze({ N: 'north', E: 'east', S: 'south', W: 'west' })
/**
 * A section id (blueprint `seg`) -> words, or null for a section not worth naming (path legs P-...). Pure. Ids seen on the
 * showcase 10-29..11-01: storehouse/house wall-F..fit-out, earth; ziggurat F, F-N/E/S/W, L00-E..L09-W (layer, side); wall W-00..
 * W-08, W-L; tree farm F, L; workshop pad, ring.
 */
export function segName (seg, project = '') {
  const s = String(seg ?? '').trim()
  if (!s || /^P-/.test(s)) return null
  if (project === 'treefarm' && s === 'F') return 'planting field'
  if (project === 'treefarm' && s === 'L') return 'lights'
  if (SEG_NAMES[s]) return SEG_NAMES[s]
  if (s === 'F') return 'foundation'
  let m = /^F-([NESW])$/.exec(s)
  if (m) return `${SIDE[m[1]]} foundation`
  m = /^L(\d{1,2})-([NESW])$/.exec(s)
  if (m) return `layer ${Number(m[1]) + 1}, ${SIDE[m[2]]} side`
  m = /^W-(\d{1,2})$/.exec(s)
  if (m) return `section ${Number(m[1]) + 1}`
  return `${s.replace(/[_-]+/g, ' ')} section`
}

const UNCOUNTABLE = new Set(['raw_iron', 'raw_gold', 'raw_copper', 'coal', 'redstone', 'lapis_lazuli', 'cobblestone', 'dirt',
  'sand', 'gravel', 'bone_meal', 'cobbled_deepslate', 'glass'])
/** `spruce_log`, 16 -> "16 spruce logs". Pure. */
export function itemPhrase (item, n) {
  const name = String(item ?? '').replace(/^minecraft:/, '')
  const words = name.replace(/_/g, ' ')
  const k = Math.round(Number(n) || 0)
  if (k === 1 || UNCOUNTABLE.has(name)) return `${k} ${name === 'lapis_lazuli' ? 'lapis' : words}`
  if (/(s|x|ch|sh)$/.test(words)) return `${k} ${words}es`
  return `${k} ${words}s`
}

/** "a:16,b:2" -> [['a',16],['b',2]] (positive counts only). Pure. */
export function parseCounts (s) {
  return String(s ?? '').split(',').map(x => x.trim().split(':')).filter(p => p.length === 2 && /^[a-z0-9_]+$/.test(p[0]) && Number(p[1]) > 0)
    .map(([a, b]) => [a, Number(b)])
}
/** A list of [item, n] -> "16 spruce logs and 6 torches" (largest first, at most 3 named). Pure. */
export function haulPhrase (pairs) {
  const l = [...pairs].sort((a, b) => b[1] - a[1])
  const named = l.slice(0, 3).map(([i, n]) => itemPhrase(i, n))
  const more = l.length > 3 ? ` and ${l.length - 3} more kinds` : ''
  if (named.length <= 1) return (named[0] ?? '') + more
  return more ? `${named.join(', ')}${more}` : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
}

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']
/** Expedition bearing 0..7 (expedition.mjs bearingVec: 0 = +x east, 2 = +z south) -> a compass word. Pure. */
export const compass = k => COMPASS[((Number(k) % 8) + 8) % 8] ?? 'somewhere'

const field = (d, k) => { const m = new RegExp(`(?:^|\\s)${k}=(\\S+)`).exec(String(d ?? '')); return m ? m[1] : null }
const xz = s => { const p = String(s ?? '').split(',').map(Number); return p.length >= 2 && p.every(Number.isFinite) ? (p.length === 3 ? `${p[0]}, ${p[2]}` : `${p[0]}, ${p[1]}`) : null }
const at = pos => (pos && Number.isFinite(pos.x) ? `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}` : null)

const ORE = Object.freeze({
  diamond: { tier: 1, word: 'diamonds', dedupeMs: 5 * 60_000 },
  emerald: { tier: 2, word: 'an emerald', dedupeMs: 30 * 60_000 },
  raw_gold: { tier: 2, word: 'gold', dedupeMs: 30 * 60_000 },
  raw_iron: { tier: 2, word: 'iron', dedupeMs: 30 * 60_000 },
  raw_copper: { tier: 3, word: 'copper', dedupeMs: 60 * 60_000 },
  lapis_lazuli: { tier: 3, word: 'lapis', dedupeMs: 60 * 60_000 },
  redstone: { tier: 3, word: 'redstone', dedupeMs: 60 * 60_000 },
  coal: { tier: 3, word: 'coal', dedupeMs: 60 * 60_000 },
})
const DIG_SKILLS = new Set(['mine', 'gather', 'surface', 'explore', 'tunnel_to_ore', 'mine_guarded'])
const DEATH_WORDS = Object.freeze({ drowning: 'drowned', lava: 'burned in lava', fire: 'burned', fall: 'fell', suffocation: 'suffocated',
  starvation: 'starved', mob: 'was killed by a mob', void: 'fell out of the world' })
const TRIP_REASON = Object.freeze({ reached: 'reached the far mark', water: 'turned back at water', blocked: 'found the way blocked',
  zone: 'turned back at a protected area', night: 'turned back for the night', budget: 'ran out of time', full: 'filled my bag' })

/**
 * THE CATALOGUE: one telemetry record -> a candidate line { cat, tier, key, dedupeMs, text, seg?, delayMs? } | null. Pure.
 * `rec` is the record exactly as logger.mjs wrote it (skill.name / status / detail / inventory_delta, bot.pos).
 * A section record returns a candidate carrying `seg: { id, open }`; whether it is SPOKEN depends on the town's memory of that
 * section (segTransition): only an open -> closed change is news.
 */
export function lineFor (rec) {
  const s = rec?.skill ?? {}
  const kind = String(s.name ?? '')
  const st = String(s.status ?? '')
  const d = String(s.detail ?? '')
  const pos = rec?.bot?.pos ?? null
  const op = field(d, 'op')
  const proj = field(d, 'project')
  if (kind === '_structure_complete' && op === 'complete' && proj) {
    const gen = field(d, 'gen') ?? '0'
    return { cat: 'project_done', tier: 1, key: `done:${proj}:${gen}`, dedupeMs: 24 * 3600_000, text: `The ${projectName(proj)} is finished!` }
  }
  if (kind === '_build' && op === 'sited' && proj && proj !== 'tidy') {
    const gen = field(d, 'gen') ?? '0'
    const where = xz(field(d, 'cell'))
    return { cat: 'project_start', tier: 1, key: `site:${proj}:${gen}`, dedupeMs: 24 * 3600_000,
      text: `Starting work on the ${projectName(proj)}${where ? ` at ${where}` : ''}.` }
  }
  if (kind === '_build_seg' && proj && proj !== 'tidy') {
    const seg = field(d, 'seg'), open = Number(field(d, 'open')), done = Number(field(d, 'done'))
    const words = segName(seg, proj)
    if (!seg || !Number.isFinite(open)) return null
    return { cat: 'section', tier: 2, key: `seg:${proj}:${seg}`, dedupeMs: 12 * 3600_000, seg: { id: `${proj}:${seg}`, open },
      text: words ? `Finished the ${projectName(proj)}'s ${words}${done > 1 ? ` (${done} blocks)` : ''}.` : null }
  }
  if (kind === '_expedition' && op === 'start' && st === 'success') {
    const b = field(d, 'bearing'), ring = Number(field(d, 'ring'))
    return { cat: 'expedition_out', tier: 2, key: `expout:${field(d, 'trip') ?? b}`, dedupeMs: 60 * 60_000,
      text: `Heading out on an expedition to the ${compass(b)}${ring > 0 ? `, aiming for ${ring} blocks out` : ''}.` }
  }
  if (kind === '_expedition_trip' && st === 'success' && field(d, 'returned') === '1') {
    const dist = Number(field(d, 'dist')) || 0
    const haul = parseCounts(field(d, 'haul'))
    const why = TRIP_REASON[field(d, 'reason')] ?? null
    if (dist < 20) return null   // a trip that turned at the gate is not news
    return { cat: 'expedition_back', tier: 2, key: `expback:${field(d, 'trip') ?? dist}`, dedupeMs: 60 * 60_000,
      text: `Back from the ${compass(field(d, 'bearing'))}: got ${dist} blocks out${why ? ` and ${why}` : ''}` +
        `${haul.length ? `, brought home ${haulPhrase(haul)}` : ''}.` }
  }
  if (kind === '_town_deposit' && st === 'success') {
    const m = /\bbanked ([a-z0-9_]+:\d+(?:,[a-z0-9_]+:\d+)*)/.exec(d)
    const pairs = m ? parseCounts(m[1]) : []
    const total = pairs.reduce((a, [, n]) => a + n, 0)
    if (total < 16) return null
    return { cat: 'deposit', tier: 3, key: `dep:${rec?.bot?.name ?? ''}`, dedupeMs: 15 * 60_000,
      text: `Stored ${haulPhrase(pairs)} in the town chests.` }
  }
  if (kind === '_kit_ironpick' && field(d, 'outcome') === 'crafted') {
    return { cat: 'tech', tier: 2, key: `ironpick:${rec?.bot?.name ?? ''}`, dedupeMs: 30 * 60_000, text: 'Made an iron pickaxe from the town\'s iron.' }
  }
  if (kind === '_needs_rescue') {
    const where = at(pos)
    return { cat: 'stuck', tier: 2, key: `stuck:${rec?.bot?.name ?? ''}`, dedupeMs: 30 * 60_000,
      text: `I'm stuck${where ? ` at ${where}` : ''}. Working my way out.` }
  }
  if (kind === '_death') {
    const cls = String(s.fail_class ?? '').toLowerCase()
    const how = DEATH_WORDS[cls] ?? 'died'
    const where = at(pos)
    return { cat: 'death', tier: 1, key: `death:${rec?.bot?.name ?? ''}:${rec?.['@timestamp'] ?? ''}`, dedupeMs: 60_000, delayMs: DEATH_DELAY_MS,
      text: `I ${how === 'died' ? 'died' : how}${where ? ` near ${where}` : ''}. Respawning in town.` }
  }
  if (!kind.startsWith('_') && st === 'success' && s.inventory_delta && typeof s.inventory_delta === 'object') {
    const dl = s.inventory_delta
    if ((kind === 'smelt' || kind === 'smelt_town') && Number(dl.iron_ingot) > 0) {
      return { cat: 'smelt', tier: 3, key: `smelt:${rec?.bot?.name ?? ''}`, dedupeMs: 30 * 60_000, text: `Smelted ${itemPhrase('iron_ingot', dl.iron_ingot)}.` }
    }
    if (DIG_SKILLS.has(kind)) {
      // the best find of this record: lowest tier first, then the larger count
      const finds = Object.entries(dl).filter(([i, n]) => ORE[i] && Number(n) > 0).sort((a, b) => ORE[a[0]].tier - ORE[b[0]].tier || b[1] - a[1])
      if (finds.length) {
        const [item, n] = finds[0], o = ORE[item]
        const depth = pos && Number.isFinite(pos.y) ? ` at y=${Math.round(pos.y)}` : ''
        return { cat: 'ore', tier: o.tier, key: `ore:${rec?.bot?.name ?? ''}:${item}`, dedupeMs: o.dedupeMs,
          text: item === 'diamond' ? `Found diamonds${depth}! +${Math.round(n)}` : `Found ${o.word}${depth}: +${itemPhrase(item, n)}.` }
      }
    }
  }
  return null
}

/**
 * THE TOWN'S MEMORY OF A SECTION -> { announce, segs }. Pure. A `_build_seg` row is written only for a section a builder WORKED
 * this visit (buildrun.mjs skips complete ones), so a row with open=0 means "this visit closed it" -- 58 of the 103 sections
 * closed on the showcase 10-29..11-01 were closed in the visit that first logged them. So a closed row is news unless the
 * town's memory already holds that section CLOSED (a repeat row: 24 of the 103 logged open=0 more than once, up to 5 times).
 * A section seen open again (damage, a rebuild) and then closed is news again.
 */
export function segTransition (segs, id, open) {
  const prev = segs?.[id]
  const next = { ...(segs ?? {}), [id]: open }
  return { announce: open === 0 && prev !== 0, segs: next }
}

// ---- pure: the output filter -------------------------------------------------------------------------------------------

const VERBS = /\b(stop|resume|goto|go|come|follow|gather|home|deposit|status|help|tp|kill|give|op)\b/i
/**
 * IS THIS LINE SAFE TO SAY? -> null | why. Pure. `names` = every player and bot name this bot knows (lowercased compare).
 * The templates never produce an unsafe line; this is the belt to their braces (design 5.3).
 */
export function unsafeWhy (text, names = []) {
  const t = String(text ?? '')
  if (!t.trim()) return 'empty'
  if (t.length > MAX_LEN) return 'too_long'
  if (/[\u0000-\u001f\u007f]/.test(t)) return 'control_char'
  if (/[^\x20-\x7e]/.test(t)) return 'non_ascii'
  if (/^\s*[!/[]/.test(t)) return 'command_prefix'
  const first = t.trim().split(/\s+/)[0]
  if (/^[A-Za-z0-9_]+-[A-Za-z0-9_-]+[,:]?$/.test(first)) return 'name_shaped_start'
  const low = t.toLowerCase()
  for (const n of names) {
    const nl = String(n ?? '').toLowerCase()
    if (nl.length < 2) continue
    const i = low.indexOf(nl)
    if (i < 0) continue
    if (/^[^a-z0-9_]/.test(low.slice(i + nl.length, i + nl.length + 1) || ' ') && (i === 0 || /[^a-z0-9_]/.test(low[i - 1]))) {
      if (VERBS.test(low.slice(i + nl.length, i + nl.length + 12))) return 'name_then_verb'
      return 'names_a_player'
    }
  }
  return null
}

// ---- pure: the internal chatter the showcase drops ----------------------------------------------------------------------

export const NOISE = Object.freeze([
  /^milestone done\b/,            // cognitive.mjs, every milestone (~2,300 a day on the showcase)
  /^tool chain complete\b/,       // cognitive.mjs
  /^\[fleet\] /,                  // comms.mjs hazard / unreachable / built lines (nothing ingests them since chatgate-01)
  /^autonomous mode: /,           // index.mjs spawn banner
  / online \([a-z_]+\)$/,         // index.mjs spawn banner `<name> online (<role>)`
])
/** Is this bot.chat text internal chatter (dropped while SHOWCHAT is on)? Pure. A `/command` is never chatter. */
export function isNoise (text) {
  const t = String(text ?? '')
  if (t.startsWith('/')) return false
  return NOISE.some(re => re.test(t))
}

// ---- pure: the rate decision -------------------------------------------------------------------------------------------

/**
 * MAY THIS BOT SAY THIS NOW? -> { ok: true } | { ok: false, why }. Pure over the town state's `sent` list
 * ([{ t, bot, key, tier }], any order). The caps are design 5.4's, per bot and per town.
 */
export function decide (sent = [], cand, bot, now, rate = RATE) {
  const tier = cand.tier
  const hour = now - 3600_000
  let lastTown = -Infinity, lastBot = -Infinity, townHour = 0, botHour = 0
  for (const r of sent) {
    if (!r || !Number.isFinite(r.t)) continue
    if (r.key === cand.key && now - r.t < (cand.dedupeMs ?? rate.dedupeMs)) return { ok: false, why: 'dedupe' }
    if (r.t > lastTown) lastTown = r.t
    if (r.bot === bot && r.t > lastBot) lastBot = r.t
    if (r.t > hour) { townHour++; if (r.bot === bot) botHour++ }
  }
  if (now - lastBot < rate.botGapMs[tier]) return { ok: false, why: 'bot_gap' }
  if (now - lastTown < rate.townGapMs[tier]) return { ok: false, why: 'town_gap' }
  if (tier === 3 && now - lastTown < rate.quietForT3Ms) return { ok: false, why: 'town_busy' }
  const f = tier === 1 ? rate.tier1CapFactor : 1
  if (botHour >= rate.botPerHour * f) return { ok: false, why: 'bot_hour_cap' }
  if (townHour >= rate.townPerHour * f) return { ok: false, why: 'town_hour_cap' }
  return { ok: true }
}

/** The `_showchat_mode` licence row's detail. Pure. */
export function showchatModeDetail ({ on, pool, killed = false }) {
  return `on=${on ? 1 : 0} v=${SHOWCHAT_V} pool=${pool} killed=${killed ? 1 : 0} bot_gap_s=${RATE.botGapMs[1] / 1000}/${RATE.botGapMs[2] / 1000} ` +
    `town_gap_s=${RATE.townGapMs[1] / 1000}/${RATE.townGapMs[2] / 1000} per_h=${RATE.botPerHour}/${RATE.townPerHour} dedupe_s=${RATE.dedupeMs / 1000} quiet_noise=1 llm=0`
}

// ---- the town file (shared by the town's bots) ---------------------------------------------------------------------------

const LOCK_STALE_MS = 10_000
/** Run fn(state) -> state under a short exclusive lock on the town file. Never throws; -> fn's result or null. */
export function withTownState (dir, fn, now = Date.now()) {
  const file = path.join(dir, STATE_FILE)
  const lock = file + '.lock'
  let held = false
  try {
    fs.mkdirSync(dir, { recursive: true })
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); held = true } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); held = true } } catch {}
    }
    if (!held) return null
    let state = { v: SHOWCHAT_V, sent: [], segs: {} }
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && Array.isArray(j.sent)) state = { v: SHOWCHAT_V, sent: j.sent, segs: j.segs ?? {} } } catch {}
    const out = fn(state)
    if (out?.state) {
      const keep = out.state.sent.filter(r => r && now - r.t < Math.max(RATE.keepMs, Number(r.d) || 0))   // a long dedupe outlives the 2 h window
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ v: SHOWCHAT_V, sent: keep, segs: out.state.segs ?? {} }))
      fs.renameSync(tmp, file)
    }
    return out
  } catch { return null } finally {
    if (held) try { fs.unlinkSync(lock) } catch {}
  }
}

// ---- the speaker (impure; installed once per spawn from features.mjs) ---------------------------------------------------

/**
 * Make a speaker for one bot. -> { onRecord(rec), stats, flush() }. Everything injectable for the tests:
 *   bot        has .chat (the ORIGINAL, unwrapped) and .username
 *   dir        the pool's state dir (town file, kill switch, lines file)
 *   emit(row)  the telemetry writer (logEvent with this bot's snapshot)
 *   now()      the clock;  defer(fn, ms) the timer (death lines wait for the respawn)
 *   names()    the names the output filter refuses to address;  catalogue(rec) the template table (lineFor)
 */
export function makeSpeaker ({ bot, say, dir, emit = () => {}, now = () => Date.now(), defer = (fn, ms) => { const h = setTimeout(fn, ms); h.unref?.() }, names = () => [], catalogue = lineFor }) {
  const stats = { said: 0, dropped: {}, noise: 0 }
  let killCheckedAt = -Infinity, killed = false
  const isKilled = () => {
    const t = now()
    if (t - killCheckedAt > 15_000) { killCheckedAt = t; try { killed = fs.existsSync(path.join(dir, KILL_FILE)) } catch { killed = false } }
    return killed
  }
  const drop = why => { stats.dropped[why] = (stats.dropped[why] ?? 0) + 1 }
  const me = () => String(bot?.username ?? '')
  const speak = (cand, src, retry = false) => {
    if (isKilled()) return drop('killed')
    const t = now()
    const res = withTownState(dir, state => {
      let segs = state.segs
      if (cand.seg) {
        const tr = segTransition(segs, cand.seg.id, cand.seg.open)
        segs = tr.segs
        if (!tr.announce || !cand.text) return { state: { ...state, segs }, ok: false, why: tr.announce ? 'unnamed_section' : 'section_not_news' }
      }
      const unsafe = unsafeWhy(cand.text, names())
      if (unsafe) return { state: { ...state, segs }, ok: false, why: `unsafe_${unsafe}` }
      const d = decide(state.sent, cand, me(), t)
      if (!d.ok) return { state: { ...state, segs }, ok: false, why: d.why }
      return { state: { ...state, segs, sent: [...state.sent, { t, bot: me(), key: cand.key, tier: cand.tier, d: cand.dedupeMs ?? RATE.dedupeMs }] }, ok: true }
    }, t)
    if (!res) {
      // another bot held the town file for its millisecond: a tier-1 line tries once more, half a second later
      if (cand.tier === 1 && !retry) { defer(() => { try { speak(cand, src, true) } catch {} }, 500); return }
      return drop('town_lock')
    }
    if (!res.ok) return drop(res.why)
    try { say(cand.text) } catch { return drop('chat_threw') }
    stats.said++
    try { emit({ kind: 'say', status: 'success', detail: `cat=${cand.cat} tier=${cand.tier} key=${cand.key} src=${src} text=${cand.text}`.slice(0, 300) }) } catch {}
    try {
      const lf = path.join(dir, LINES_FILE)
      try { if (fs.statSync(lf).size > LINES_ROTATE_BYTES) fs.renameSync(lf, lf + '.1') } catch {}
      fs.appendFileSync(lf, JSON.stringify({ t: new Date(t).toISOString(), bot: me(), cat: cand.cat, tier: cand.tier, text: cand.text }) + '\n')
    } catch {}
  }
  const onRecord = rec => {
    const name = rec?.skill?.name
    if (name === '_say' || name === '_say_drop' || name === '_showchat_mode') return   // never about itself
    const cand = catalogue(rec)
    if (!cand) return
    if (!cand.text && !cand.seg) return
    const src = `${name}@${String(rec?.['@timestamp'] ?? '').slice(11, 19)}`
    if (cand.delayMs) defer(() => { try { speak(cand, src) } catch {} }, cand.delayMs)
    else speak(cand, src)
  }
  let lastFlush = now()
  /** The `_say_drop` row: the counts since the last one (at most one per 10 min unless forced). */
  const flush = (force = false) => {
    const t = now()
    const n = Object.values(stats.dropped).reduce((a, b) => a + b, 0)
    if (!n && !stats.noise) return false
    if (!force && t - lastFlush < 10 * 60_000) return false
    const parts = Object.entries(stats.dropped).sort().map(([k, v]) => `${k}:${v}`).join(',') || '-'
    try { emit({ kind: 'say_drop', status: 'no_effect', detail: `dropped=${parts} noise=${stats.noise} said=${stats.said} secs=${Math.round((t - lastFlush) / 1000)}` }) } catch {}
    stats.dropped = {}; stats.noise = 0; lastFlush = t
    return true
  }
  return { onRecord, stats, flush, isKilled }
}

/**
 * Wrap bot.chat so the internal chatter is dropped (counted in stats.noise). -> the ORIGINAL chat function (for the speaker).
 * Idempotent per bot object.
 */
export function quietChatter (bot, stats) {
  if (!bot || typeof bot.chat !== 'function') return null
  if (bot._showchatOriginalChat) return bot._showchatOriginalChat
  const orig = bot.chat.bind(bot)
  bot._showchatOriginalChat = orig
  bot.chat = (message) => {
    if (isNoise(message)) { stats.noise++; return }
    return orig(message)
  }
  return orig
}
