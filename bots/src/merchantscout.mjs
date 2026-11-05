// MERCHANT SCOUT (trading-scout-01, trading design 2026-11-03: docs/reports/trading-design-2026-11-03.md). READ-ONLY.
//
// Trading needs a counterparty, and the measurement says the showcase has none: of 63 saved villagers, 0 employed (58 none,
// 5 nitwit) and 0 villager trade offers, while the fleet worlds hold employed novices 554-605 blocks from most towns. Those
// numbers came from copied region files; nothing in the bots' own telemetry can say what a bot SEES. This module is that
// instrument: once a minute it lists the villagers and wandering traders the client already tracks (bot.entities, no packet
// sent, no movement, no block touched) and writes one `_merchant_seen` row per merchant when it is first seen, when its
// profession or level changes, or every REFRESH_MS; plus one `_xp` row (the bot's own level/points) every XP_EVERY_MS, since
// an anvil or enchanting table piece depends on levels nobody logs today.
//
// PROVEN on Paper 1.21.8 / mineflayer 4.37.1 (sandbox4 2026-11-03, sandbox/trading/scout-proof.cjs): a villager's metadata
// index 18 decodes as { villagerType, villagerProfession, level } with the profession a registry id; the ids matched the
// server's own census by position (14 at the weaponsmith, 1 armorer, 8 leatherworker, 5 farmer). bot.experience = { level,
// points, progress }.
import { logEvent } from './logger.mjs'
import { snapshot } from './state.mjs'

// minecraft:villager_profession registry order (1.21): alphabetical with `none` first
export const PROFESSIONS = ['none', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher',
  'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith']
export const SCAN_MS = 60_000
export const REFRESH_MS = 30 * 60_000
export const XP_EVERY_MS = 15 * 60_000
export const RADIUS = 64
export const MAX_ROWS_PER_SCAN = 8
const VILLAGER_DATA = 18   // metadata index of villager_data on 1.21.x (registry metadataKeys, proven above)
const BABY = 16

export function scoutSwitch (env = process.env) {
  const v = String(env.MERCHANTSCOUT ?? '').toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false')
}
export const scoutModeDetail = on => `on=${on ? 1 : 0} scan_s=${SCAN_MS / 1000} radius=${RADIUS} refresh_min=${REFRESH_MS / 60_000} xp_min=${XP_EVERY_MS / 60_000}`

const r1 = v => Math.round(v * 10) / 10
/** What the client already knows about the merchants near `here`: pure, from the entity table. Nearest first. */
export function merchantSightings (entities, here, { radius = RADIUS, self = null } = {}) {
  const out = []
  if (!here) return out
  for (const e of Object.values(entities ?? {})) {
    if (!e || e === self || !e.position) continue
    const kind = e.name === 'villager' ? 'villager' : e.name === 'wandering_trader' ? 'wandering_trader' : null
    if (!kind) continue
    const d = Math.hypot(e.position.x - here.x, e.position.y - here.y, e.position.z - here.z)
    if (!(d <= radius)) continue
    const md = e.metadata ?? []
    const vd = kind === 'villager' ? md[VILLAGER_DATA] : null
    // NO villager_data = the DEFAULT (plains, none, level 1): the server sends only non-default values (sandbox4 11-05)
    const pid = kind === 'villager' && !vd ? 0 : vd?.villagerProfession
    const profession = kind === 'wandering_trader' ? 'wandering_trader'
      : (Number.isInteger(pid) ? (PROFESSIONS[pid] ?? `id${pid}`) : 'unknown')
    out.push({
      uuid: e.uuid ?? String(e.id), kind, profession,
      level: kind === 'villager' ? (vd ? (Number.isInteger(vd.level) ? vd.level : null) : 1) : null,
      baby: md[BABY] === true,
      x: r1(e.position.x), y: r1(e.position.y), z: r1(e.position.z), dist: r1(d),
    })
  }
  return out.sort((a, b) => a.dist - b.dist)
}

/** The id of the zone holding the point, or null. Pure. Takes both shapes in use: townPlanZones' {id, box: [x0,y0,z0,x1,y1,z1]}
 *  (what features.mjs passes; Codex review 11-03: protectzone's zoneAt reads x0..z1 and missed every one) and parsed {x0..z1}. */
export function zoneIdAt (zones, x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z)
  for (const q of zones ?? []) {
    const b = Array.isArray(q?.box) ? q.box : (q && Number.isFinite(q.x0) ? [q.x0, q.y0, q.z0, q.x1, q.y1, q.z1] : null)
    if (b && fx >= b[0] && fx <= b[3] && fy >= b[1] && fy <= b[4] && fz >= b[2] && fz <= b[5]) return q.id ?? 'unnamed'
  }
  return null
}

/** Employed = trades exist: a villager with a profession other than none/nitwit (a baby has none), or a wandering trader. */
export const tradesPossible = s => s.kind === 'wandering_trader' || (!s.baby && !['none', 'nitwit', 'unknown'].includes(s.profession))

/** Which sightings to write: first sight, a changed profession/level, or REFRESH_MS since the last row. Pure; mutates `seen`. */
export function dueRows (seen, sightings, now, { refreshMs = REFRESH_MS, max = MAX_ROWS_PER_SCAN } = {}) {
  const rows = []
  for (const s of sightings) {
    if (rows.length >= max) break
    const prev = seen.get(s.uuid)
    const why = !prev ? 'new' : (prev.profession !== s.profession || prev.level !== s.level) ? 'changed' : (now - prev.at >= refreshMs ? 'refresh' : null)
    if (!why) continue
    seen.set(s.uuid, { profession: s.profession, level: s.level, at: now })
    rows.push({ ...s, why })
  }
  if (seen.size > 2000) for (const k of [...seen.keys()].slice(0, seen.size - 2000)) seen.delete(k)
  return rows
}

export const sightingDetail = (s, zone) => `${s.kind} ${s.profession}${s.level != null ? ` L${s.level}` : ''}${s.baby ? ' baby' : ''} at ${Math.floor(s.x)},${Math.floor(s.y)},${Math.floor(s.z)} ` +
  `(${s.dist}b) trades=${tradesPossible(s) ? 'yes' : 'no'} zone=${zone ?? 'none'} why=${s.why}`

/** Once per spawn (features.mjs). Never throws; the timer goes with this bot's `end`. */
export function merchantScoutInstall (bot, { env = process.env, zonesOf = () => [], now = () => Date.now(), every = SCAN_MS } = {}) {
  const on = scoutSwitch(env)
  try { logEvent({ kind: 'merchantscout_mode', status: 'success', snapshot: snapshot(bot), detail: scoutModeDetail(on) }) } catch {}
  if (!on) return null
  const seen = new Map()
  let xpAt = -Infinity
  const tick = () => {
    const t = now()
    const here = bot.entity?.position
    const rows = dueRows(seen, merchantSightings(bot.entities, here, { self: bot.entity }), t)
    let zones = []
    if (rows.length) { try { zones = zonesOf(bot) ?? [] } catch { zones = [] } }
    for (const s of rows) {
      let zone = null
      try { zone = zoneIdAt(zones, s.x, s.y, s.z) } catch {}
      try { logEvent({ kind: 'merchant_seen', status: 'success', snapshot: snapshot(bot), detail: sightingDetail(s, zone), args: { ...s, zone, trades: tradesPossible(s) } }) } catch {}
    }
    if (t - xpAt >= XP_EVERY_MS && bot.experience) {
      xpAt = t
      const xp = bot.experience
      try { logEvent({ kind: 'xp', status: 'success', snapshot: snapshot(bot), detail: `level=${xp.level} points=${xp.points} progress=${r1(xp.progress ?? 0)}`, args: { level: xp.level, points: xp.points } }) } catch {}
    }
    return rows
  }
  const timer = setInterval(() => { try { tick() } catch {} }, every); timer.unref?.()
  bot.once?.('end', () => clearInterval(timer))
  return { tick, seen, stop: () => clearInterval(timer) }
}
