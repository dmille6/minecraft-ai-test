#!/usr/bin/env node
// isolated2shared.mjs -- convert ONE isolated pool (isolated-a..d) into a normal shared town. OWNER APPROVED 2026-10-20.
// Design and evidence: docs/reports/isolated-to-shared-2026-10-20.md. No bot code changes: isolated mode is two env values
// (MEMORY_SCOPE=isolated, MEMORY_POOL=self-<bot>), and every isolated branch in bots/src derives from them.
//
//   node isolated2shared.mjs plan     --pool isolated-b     DEFAULT. Dry run: prints the seed and the env diff. Writes nothing.
//   node isolated2shared.mjs apply    --pool isolated-b     backups FIRST, then the seeded town dir, then the 3 env lines
//   node isolated2shared.mjs rollback --pool isolated-b     the 3 env lines back; seeded dir renamed aside; per-bot cobble
//                                                           journals moved into the backup (their counts predate the town's)
//   node isolated2shared.mjs status  [--pool isolated-b]
//
// apply and rollback REFUSE (exit 2, nothing written) unless: no canary is declared in the trial manifest, no canary drop-in
// exists for any bot, and all five units of the pool are STOPPED (the wrapper isolated2shared-direct.sh stops them, runs this,
// then starts them 12 s apart). It never restarts a bot, never edits the manifest, the queue or the world.
//
// MERGE RULES (design section 3), each an advisory SNAPSHOT policy, never a reconstruction of a shared history:
//   junkwell-plinth   the newest COMPLETE record, verbatim; refused if two records name different caps or none is complete
//   junkwell-site     g1 = that record's cap (the raised well every bot already uses)
//   junkwell-nosite   NEVER copied: one newer than doneAt with no `lost` evidence makes plinthWant replan a finished plinth
//   composter-site    g1 = the newest record's site; refused if two records are more than 2 blocks apart
//   containers.json   per container chestfull's recordOutcome REPLAYED over the strikes newer than the latest visible
//                     opening (unusableUntil re-derived, never copied); `_` miss maps merged leaf-wise
//   cobble journal    NOT created: an empty journal is the fail-closed start (every container unknown until recounted)
//   world facts       per file decayed to now with the class's own rule, then a UNION (each entry keeps its own clock),
//                     newest kept within the class's caps; unreachable merged by id, expired ones dropped
//   lessons           untouched (scope `private` keeps the per-bot file, exactly as `isolated` did)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ---- constants the bots define (bots/test/isolated2shared.test.mjs asserts each against the real module or behaviour) ----
export const PLINTH_VERSION = 1                       // plinth.mjs
export const DECAY_MS = 12 * 60 * 60 * 1000          // worldfacts.mjs
export const MAX_SITES = 120                          // worldfacts.mjs
export const MAX_RESOURCES = 200                      // worldfacts.mjs
export const WF_SCHEMA = 1                            // worldfacts.mjs
export const STRIKE_STATES = new Set(['unknown', 'unavailable'])
export const UNKNOWN_BACKOFF_MS = 10 * 60 * 1000                // chestfull.mjs
export const UNUSABLE_TTL_MS = 6 * 60 * 60 * 1000               // chestfull.mjs
export const POOL_RE = /^isolated-[a-d]$/
export const NEW_VALUES = pool => ({ MEMORY_SCOPE: 'private', MEMORY_POOL: pool, EXP_ARM: 'town' })
export const OLD_VALUES = bot => ({ MEMORY_SCOPE: 'isolated', MEMORY_POOL: `self-${bot}`, EXP_ARM: 'isolated' })
export const KEYS = ['MEMORY_SCOPE', 'MEMORY_POOL', 'EXP_ARM']
/** Env settings that would change what the conversion does (design: Codex r1 P2-9). Refused unless --allow-override NAME. */
export const OVERRIDES = ['POOL_STATE_DIR', 'SMELT_JOB', 'PLINTH_FIRST']
export const MARKER = 'MIGRATED.json'
export const TOOL = 'isolated2shared'

// ---- pure helpers ---------------------------------------------------------------------------------------------------------
/** KEY=VALUE lines -> { KEY: value } (the LAST assignment wins, as systemd's EnvironmentFile does). */
export function parseEnv (text) {
  const out = {}
  for (const line of String(text ?? '').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}
/** 'isolated' | 'converted' | 'other' for one bot's env against the pool. */
export function envKind (env, bot, pool) {
  const is = (want) => KEYS.every(k => env[k] === want[k])
  if (is(OLD_VALUES(bot))) return 'isolated'
  if (is(NEW_VALUES(pool))) return 'converted'
  return 'other'
}
/**
 * Set KEYS to `values` in an env text -> { text, changed }. Every other line is byte-identical; each key must appear exactly
 * once (a second assignment would silently win under systemd), else it throws.
 */
export function rewriteEnv (text, values) {
  const lines = String(text).split('\n')
  const seen = {}
  const out = lines.map(line => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!m || !(m[1] in values)) return line
    seen[m[1]] = (seen[m[1]] ?? 0) + 1
    return `${m[1]}=${values[m[1]]}`
  })
  for (const k of Object.keys(values)) {
    if (seen[k] !== 1) throw new Error(`env: ${k} appears ${seen[k] ?? 0} times (must be exactly once)`)
  }
  const changed = Object.keys(values).filter(k => parseEnv(text)[k] !== values[k])
  return { text: out.join('\n'), changed }
}
const capOf = rec => rec?.plan?.cap && [rec.plan.cap.x, rec.plan.cap.y, rec.plan.cap.z].every(Number.isInteger)
  ? { x: rec.plan.cap.x, y: rec.plan.cap.y, z: rec.plan.cap.z } : null
const capKey = c => (c ? `${c.x},${c.y},${c.z}` : '-')
/** plinth.mjs plinthRecordState, without the world argument (worlds are compared across the pool below). */
export function recordState (rec) {
  if (!rec || typeof rec !== 'object' || rec.v !== PLINTH_VERSION) return null
  if (rec.state === 'none') return 'none'
  if (rec.state === 'void') return 'void'
  if (!rec.plan?.cap || !Array.isArray(rec.plan.steps)) return null
  return rec.state === 'complete' ? 'complete' : 'plan'
}
/**
 * THE TOWN'S PLINTH RECORD -> { ok, bot, rec, cap, notes } | { ok: false, why, remedy }. `entries` = [{ bot, rec, text }].
 * `from` (the --plinth-from override): a bot name, or 'none' to seed no plinth record at all.
 */
export function choosePlinth (entries, { from = null } = {}) {
  const notes = []
  const live = entries.filter(e => ['plan', 'complete'].includes(recordState(e.rec)))
  for (const e of entries) if (e.rec && !live.includes(e)) notes.push(`${e.bot}: record state ${recordState(e.rec) ?? 'unreadable/other version'} ignored`)
  if (from === 'none') return { ok: true, bot: null, rec: null, cap: null, notes: [...notes, 'override: no plinth record seeded'] }
  const caps = [...new Set(live.map(e => capKey(capOf(e.rec))))]
  const worlds = [...new Set(live.map(e => String(e.rec.world ?? '')).filter(Boolean))]
  if (from) {
    const e = entries.find(x => x.bot === from)
    if (!e || recordState(e.rec) !== 'complete') return { ok: false, why: `--plinth-from ${from}: no complete record there`, remedy: 'name a bot whose record is complete, or --plinth-from none' }
    return { ok: true, bot: e.bot, rec: e.rec, text: e.text, cap: capOf(e.rec), notes: [...notes, `override: ${from}'s record`] }
  }
  if (caps.length > 1) return { ok: false, why: `plinth records name ${caps.length} different caps (${caps.join(' | ')})`, remedy: 'read the world (which cap is the town\'s well?) and pass --plinth-from <bot> or --plinth-from none' }
  if (worlds.length > 1) return { ok: false, why: `plinth records name ${worlds.length} worlds`, remedy: 'pass --plinth-from <bot> or --plinth-from none' }
  const complete = live.filter(e => recordState(e.rec) === 'complete')
    .sort((a, b) => Number(b.rec.doneAt ?? b.rec.at ?? 0) - Number(a.rec.doneAt ?? a.rec.at ?? 0))
  if (!complete.length) {
    if (!live.length) return { ok: true, bot: null, rec: null, cap: null, notes: [...notes, 'no plinth record in any bot: the town plans its own (plinth-first)'] }
    return { ok: false, why: `${live.length} plan record(s) and no complete one at ${caps[0]}`, remedy: 'pass --plinth-from none (the town replans under plinth-first) after reading the world' }
  }
  const pick = complete[0]
  return { ok: true, bot: pick.bot, rec: pick.rec, text: pick.text, cap: capOf(pick.rec), notes: [...notes, `${complete.length} complete, ${live.length - complete.length} plan, all at ${caps[0]}`] }
}
/** THE COMPOSTER SITE -> { ok, site, bot } | { ok: false, why, remedy }. `entries` = [{ bot, site: {x,y,z,world,at} | null }]. */
export function chooseComposter (entries, { from = null } = {}) {
  const have = entries.filter(e => e.site && [e.site.x, e.site.y, e.site.z].every(Number.isInteger))
  if (from === 'none') return { ok: true, site: null, bot: null }
  if (from) {
    const e = have.find(x => x.bot === from)
    return e ? { ok: true, site: e.site, bot: e.bot } : { ok: false, why: `--composter-from ${from}: no site there`, remedy: 'name a bot with a composter site, or none' }
  }
  if (!have.length) return { ok: true, site: null, bot: null }
  const byNew = [...have].sort((a, b) => String(b.site.at ?? '').localeCompare(String(a.site.at ?? '')))
  const n = byNew[0]
  const far = have.filter(e => Math.max(Math.abs(e.site.x - n.site.x), Math.abs(e.site.y - n.site.y), Math.abs(e.site.z - n.site.z)) > 2)
  if (far.length) return { ok: false, why: `composter sites disagree: ${have.map(e => `${e.bot}@${e.site.x},${e.site.y},${e.site.z}`).join(' ')}`, remedy: 'pass --composter-from <bot> or --composter-from none' }
  return { ok: true, site: n.site, bot: n.bot }
}
const atOf = v => (v && typeof v === 'object' && Number.isFinite(Number(v.at)) ? Number(v.at) : null)
/** One `_` map's leaf: numbers -> max; { at, ... } -> the newest; a map of leaves -> merged one level down. */
function mergeLeaf (a, b) {
  if (a === undefined) return b
  if (b === undefined) return a
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b)
  if (atOf(a) != null && atOf(b) != null) return atOf(b) > atOf(a) ? b : a
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = { ...a }
    for (const [k, v] of Object.entries(b)) out[k] = mergeLeaf(out[k], v)
    return out
  }
  return a
}
/**
 * ONE CONTAINER'S ENTRIES FROM SEVERAL BOTS -> the entry. Pure. Each bot's entry is its own recordOutcome fold: its strikes
 * are its unknowns since ITS last opening. The town's entry REPLAYS chestfull.mjs recordOutcome over what the snapshots
 * still show, in time order: the LATEST VISIBLE opening (full | took, any bot), then every strike NEWER than it as an unknown,
 * and an `unavailable` newer than it at its `at`. A strike older than that opening is dropped (in one shared file the opening
 * cleared it: Claude r2 P2-3), and unusableUntil is RE-DERIVED from the kept strikes, never copied (a bot's own mark may rest
 * on a strike the opening cleared). So two bots' unknowns >= UNKNOWN_BACKOFF_MS apart after the last opening make the
 * container unusable, as one shared file would (Codex r2 P2-8). Not replayable: an opening a bot later overwrote with an
 * unknown (no snapshot shows it); there a strike may survive that the shared file cleared, for at most UNUSABLE_TTL_MS.
 */
export function foldContainer (list) {
  const opens = list.filter(e => e.o === 'full' || e.o === 'took')
  const lastOpen = opens.length ? opens.reduce((a, b) => (Number(b.at) > Number(a.at) ? b : a)) : null
  const tOpen = lastOpen ? Number(lastOpen.at) : -Infinity
  const strikes = new Set(), unavail = []
  for (const e of list) {
    for (const t of Array.isArray(e.strikes) ? e.strikes : []) if (Number.isFinite(t) && t > tOpen) strikes.add(t)
    if (e.o === 'unknown' && Number(e.at) > tOpen) strikes.add(Number(e.at))
    if (e.o === 'unavailable' && Number(e.at) > tOpen) unavail.push(Number(e.at))
  }
  const ev = [...[...strikes].map(t => ({ t, o: 'unknown' })), ...unavail.map(t => ({ t, o: 'unavailable' }))].sort((a, b) => a.t - b.t)
  let cur = lastOpen ? { o: lastOpen.o, at: tOpen, strikes: [] } : null
  for (const { t, o } of ev) {
    if (o === 'unavailable') { cur = { o, at: t, strikes: cur?.strikes ?? [], ...(Number.isFinite(cur?.unusableUntil) ? { unusableUntil: cur.unusableUntil } : {}) }; continue }
    const prior = (cur?.strikes ?? []).filter(x => t - x < UNUSABLE_TTL_MS)
    const qualifies = prior.some(x => t - x >= UNKNOWN_BACKOFF_MS)
    const until = Math.max(cur?.unusableUntil ?? -Infinity, qualifies ? t + UNUSABLE_TTL_MS : -Infinity)
    cur = { o: 'unknown', at: t, strikes: [...prior, t].slice(-8), ...(Number.isFinite(until) ? { unusableUntil: until } : {}) }
  }
  // A TRUNCATED HISTORY (Codex r3 P2-4, r4 P2-4): recordOutcome keeps the last 8 strikes, so a bot's mark can rest on strikes
  // it has since evicted. A mark u was last set by an unknown at u - TTL whose qualifying earlier strike lay within TTL before
  // it, i.e. after u - 2 TTL. So the mark is the town's evidence exactly when the latest VISIBLE opening is older than
  // u - 2 TTL (no opening any bot saw can have cleared either strike); otherwise it is dropped -- never resurrected.
  if (cur && cur.o !== 'full' && cur.o !== 'took') {
    for (const e of list) {
      const u = Number(e.unusableUntil)
      if (Number.isFinite(u) && u - 2 * UNUSABLE_TTL_MS > tOpen && Number(e.at) > tOpen && !(cur.unusableUntil >= u)) cur.unusableUntil = u
    }
  }
  return cur
}
/**
 * THE TOWN'S CONTAINER MEMORY -> { world, entries, notes }. `files` = [{ bot, json: { world, entries } }]. An advisory
 * SNAPSHOT policy (the files hold each bot's last state, not its history): per container foldContainer over every bot's
 * entry; every `_` map merged leaf-wise -- per container, and per need inside `_ingredient_miss` -- the newest time winning
 * (chestfull PICK_MISS_KEY, withdrawpick INGREDIENT_MISS_KEY, smeltjob COPPER_MISS_KEY; the readers then clear a miss
 * that a later `took` outdates, chestfull.mjs containerPickMiss / containerItemMiss).
 */
export function mergeContainers (files) {
  const notes = []
  const worlds = [...new Set(files.map(f => f.json?.world).filter(Boolean).map(String))]
  if (worlds.length > 1) return { ok: false, why: `container memories name ${worlds.length} worlds`, remedy: 'not mergeable: convert with an empty memory by hand' }
  const entries = {}, lists = {}
  for (const f of files) {
    for (const [k, v] of Object.entries(f.json?.entries ?? {})) {
      if (k.startsWith('_')) {
        if (v && typeof v === 'object') entries[k] = mergeLeaf(entries[k], v)
        else notes.push(`${f.bot}: ${k} is not a map (dropped)`)
        continue
      }
      if (!v || typeof v.o !== 'string' || !Number.isFinite(Number(v.at))) { notes.push(`${f.bot}: ${k} unreadable (dropped)`); continue }
      ;(lists[k] ??= []).push(v)
    }
  }
  for (const [k, list] of Object.entries(lists)) entries[k] = foldContainer(list)
  return { ok: true, world: worlds[0] ?? null, entries, notes }
}
/** worldfacts.mjs #prune's decay, applied to a copy at `now` (every elapsed period halves once; decayedAt advances). */
export function decayed (s, now) {
  const c = { ...s }
  const ref = Math.max(c.last ?? 0, c.decayedAt ?? 0)
  const periods = ref > 0 ? Math.floor((now - ref) / DECAY_MS) : 0
  if (periods > 0) { c.count = Math.floor(c.count / 2 ** periods); c.decayedAt = ref + periods * DECAY_MS }
  return c
}
/**
 * THE TOWN'S WORLD MODEL -> the world-facts JSON. `files` = [{ bot, json }]. A snapshot UNION: every file decayed to `now`
 * by the class's rule (count < 1 gone), every site and resource kept as its own entry on its own clock (no count is summed,
 * so no old count inherits a fresh timestamp), ordered oldest `last` first so the class's slice(-N) keeps the newest, capped.
 * Unreachable: expired (> 2 decay periods) dropped; one id from several bots -> `by` and `where` unioned, newest `last`,
 * the first reporter's detail (the class keeps an existing detail).
 */
export function mergeWorldFacts (files, now) {
  const sites = [], resources = [], unreachable = {}, notes = []
  for (const f of files) {
    const j = f.json
    if (!j || j.schema !== WF_SCHEMA) { notes.push(`${f.bot}: world facts schema ${j?.schema ?? 'missing'} (skipped)`); continue }
    for (const s of j.sites ?? []) { const d = decayed(s, now); if (d.count >= 1) sites.push(d) }
    for (const r of j.resources ?? []) { const d = decayed(r, now); if (d.count >= 1) resources.push(d) }
    for (const [id, v] of Object.entries(j.unreachable ?? {})) {
      if (now - (v.last ?? 0) > DECAY_MS * 2) continue
      const cur = unreachable[id]
      if (!cur) { unreachable[id] = { ...v, by: [...(v.by ?? [])], where: { ...(v.where ?? {}) } }; continue }
      for (const b of v.by ?? []) if (!cur.by.includes(b)) cur.by.push(b)
      Object.assign(cur.where, v.where ?? {})
      cur.last = Math.max(cur.last ?? 0, v.last ?? 0)
    }
  }
  const byLast = (a, b) => (a.last ?? 0) - (b.last ?? 0)
  return {
    json: { schema: WF_SCHEMA, sites: sites.sort(byLast).slice(-MAX_SITES), unreachable, resources: resources.sort(byLast).slice(-MAX_RESOURCES) },
    notes,
  }
}
export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex')

// ---- io -------------------------------------------------------------------------------------------------------------------
const readText = f => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
const readJson = f => { const t = readText(f); if (t == null) return { text: null, json: null }; try { return { text: t, json: JSON.parse(t) } } catch { return { text: t, json: null, bad: true } } }
/** The highest generation `<key>.g<N>.json` in dir (composter.mjs readTownSite). */
function highestGen (dir, key) {
  let gen = 0
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.g(\\d+)\\.json$`)
  try { for (const f of fs.readdirSync(dir)) { const m = re.exec(f); if (m) gen = Math.max(gen, Number(m[1])) } } catch { return { gen: 0 } }
  if (!gen) return { gen: 0 }
  return { gen, file: path.join(dir, `${key}.g${gen}.json`), ...readJson(path.join(dir, `${key}.g${gen}.json`)) }
}

export function defaults (over = {}) {
  return {
    stateRoot: '/var/lib/mcai', envDir: '/srv/mcbots/harness/env', manifest: '/srv/mcbots/trial-manifest.json',
    dropinRoot: '/etc/systemd/system', backupRoot: '/var/backups/mcai-isolated2shared', unitCheck: true, lock: '/tmp/mcai-canary.lock',
    now: Date.now(), stamp: null, plinthFrom: null, composterFrom: null, allowOverride: [], ...over,
  }
}

/** Everything the five bots hold, read-only -> { pool, bots: [...], refusals: [...] }. */
export function readSources (pool, o) {
  const refusals = []
  if (!POOL_RE.test(pool)) return { pool, bots: [], refusals: [`not an isolated pool name: ${pool} (isolated-a..d)`] }
  let names = []
  try { names = fs.readdirSync(o.envDir).filter(f => f.startsWith(`${pool}-`) && f.endsWith('.env')).sort() } catch (e) { refusals.push(`env dir unreadable: ${e.message}`) }
  if (names.length !== 5) refusals.push(`expected 5 env files for ${pool}, found ${names.length}`)
  const bots = names.map(f => {
    const bot = f.slice(0, -4), envFile = path.join(o.envDir, f), text = readText(envFile), env = parseEnv(text)
    const kind = envKind(env, bot, pool)
    const home = [env.HOME_X, env.HOME_Y, env.HOME_Z].every(v => /^-?\d+$/.test(v ?? '')) ? `${env.HOME_X}_${env.HOME_Y}_${env.HOME_Z}` : null
    const stateDir = env.STATE_DIR || null
    const oldDir = stateDir ? path.join(path.dirname(stateDir), `_pool-${OLD_VALUES(bot).MEMORY_POOL}`) : null
    const b = { bot, envFile, text, env, kind, home, stateDir, oldDir }
    if (!home) refusals.push(`${bot}: HOME_X/Y/Z missing or not integers`)
    if (!stateDir) refusals.push(`${bot}: STATE_DIR missing`)
    if (stateDir && path.dirname(stateDir) !== o.stateRoot) refusals.push(`${bot}: STATE_DIR ${stateDir} is not under ${o.stateRoot}`)
    for (const k of OVERRIDES) if (env[k] != null && !o.allowOverride.includes(k)) refusals.push(`${bot}: ${k}=${env[k]} is set (it changes the conversion's effect); remove it or pass --allow-override ${k}`)
    for (const k of KEYS) {
      const n = String(text ?? '').split('\n').filter(l => l.startsWith(`${k}=`)).length
      if (n !== 1) refusals.push(`${bot}: ${k} is assigned ${n} times in ${f} (must be exactly once)`)
    }
    if (kind === 'other') refusals.push(`${bot}: env is neither isolated (${KEYS.map(k => `${k}=${OLD_VALUES(bot)[k]}`).join(' ')}) nor converted (${KEYS.map(k => `${k}=${NEW_VALUES(pool)[k]}`).join(' ')}): ${KEYS.map(k => `${k}=${env[k]}`).join(' ')}`)
    if (home && oldDir) {
      b.plinth = readJson(path.join(oldDir, `junkwell-plinth-${home}.json`))
      b.site = highestGen(oldDir, `junkwell-site-${home}`)
      b.composter = highestGen(oldDir, `composter-site-${home}`)
      b.containers = readJson(path.join(oldDir, `town-chest-${home}.containers.json`))
      b.nosite = fs.existsSync(path.join(oldDir, `junkwell-nosite-${home}.json`))
    }
    if (stateDir) b.facts = readJson(path.join(stateDir, `world-facts-${bot}.json`))
    return b
  })
  const homes = [...new Set(bots.map(b => b.home).filter(Boolean))]
  if (homes.length > 1) refusals.push(`the pool's bots name ${homes.length} homes (${homes.join(' | ')})`)
  return { pool, bots, home: homes[0] ?? null, refusals }
}

/** THE SEED -> { files: { name: text }, summary, refusals }. Pure over readSources' answer. */
export function buildSeed (src, o) {
  const refusals = [...src.refusals], files = {}, summary = []
  const H = src.home
  if (!H) return { files, summary, refusals }
  // THE CAPS THE TOWN HAD BEFORE THE SWITCH (every bot's plinth cap and newest well site), frozen into plan.json and the
  // marker: the tripwire's I2 judges a plan or a dig against THESE, never against live records a new plan has already
  // rewritten (Codex r2 P1-5)
  const known = new Set()
  for (const b of src.bots) {
    const c = capOf(b.plinth?.json); if (c) known.add(capKey(c))
    const st = b.site?.json; if (st && [st.x, st.y, st.z].every(Number.isInteger)) known.add(capKey(st))
  }
  const pl = choosePlinth(src.bots.map(b => ({ bot: b.bot, rec: b.plinth?.json ?? null, text: b.plinth?.text ?? null })), { from: o.plinthFrom })
  if (!pl.ok) refusals.push(`plinth: ${pl.why} -- remedy: ${pl.remedy}`)
  else {
    summary.push(`plinth: ${pl.bot ? `${pl.bot}'s complete record, cap ${capKey(pl.cap)}` : 'none seeded'} (${pl.notes.join('; ')})`)
    if (pl.rec) {
      files[`junkwell-plinth-${H}.json`] = pl.text
      files[`junkwell-site-${H}.g1.json`] = JSON.stringify({ x: pl.cap.x, y: pl.cap.y, z: pl.cap.z, world: pl.rec.world ?? null, at: new Date(o.now).toISOString() })
      for (const b of src.bots) {
        const s = b.site?.json
        if (s && capKey(s) !== capKey(pl.cap)) summary.push(`  note: ${b.bot}'s newest well site is ${capKey(s)} (not the cap): not seeded; that well stays in the world`)
      }
    }
    const ns = src.bots.filter(b => b.nosite).map(b => b.bot)
    if (ns.length) summary.push(`  no-site records NOT copied (${ns.join(', ')}): a newer one would replan the finished plinth`)
  }
  const cp = chooseComposter(src.bots.map(b => ({ bot: b.bot, site: b.composter?.json ?? null })), { from: o.composterFrom })
  if (!cp.ok) refusals.push(`composter: ${cp.why} -- remedy: ${cp.remedy}`)
  else if (cp.site) {
    files[`composter-site-${H}.g1.json`] = JSON.stringify({ x: cp.site.x, y: cp.site.y, z: cp.site.z, world: cp.site.world ?? null, at: cp.site.at ?? new Date(o.now).toISOString() })
    summary.push(`composter: ${cp.bot}'s site ${capKey(cp.site)}`)
  } else summary.push('composter: no record (the town sites its own)')
  const cm = mergeContainers(src.bots.filter(b => b.containers?.json).map(b => ({ bot: b.bot, json: b.containers.json })))
  if (!cm.ok) refusals.push(`containers: ${cm.why} -- remedy: ${cm.remedy}`)
  else {
    files[`town-chest-${H}.containers.json`] = JSON.stringify({ world: cm.world, entries: cm.entries })
    const ks = Object.keys(cm.entries)
    summary.push(`containers: ${ks.filter(k => !k.startsWith('_')).length} containers from ${src.bots.filter(b => b.containers?.json).length} memories; maps ${ks.filter(k => k.startsWith('_')).join(',') || '-'}${cm.notes.length ? ` (${cm.notes.length} notes)` : ''}`)
  }
  const wf = mergeWorldFacts(src.bots.filter(b => b.facts?.json).map(b => ({ bot: b.bot, json: b.facts.json })), o.now)
  files[`world-facts-${src.pool}.json`] = JSON.stringify(wf.json, null, 1)
  summary.push(`world facts: ${wf.json.sites.length} sites, ${Object.keys(wf.json.unreachable).length} unreachable, ${wf.json.resources.length} resources (union of ${src.bots.filter(b => b.facts?.json).length})${wf.notes.length ? `; ${wf.notes.join('; ')}` : ''}`)
  summary.push('cobble journal: not created (fail-closed start: containers unknown until recounted)')
  for (const b of src.bots.filter(x => x.plinth?.bad || x.containers?.bad || x.facts?.bad)) refusals.push(`${b.bot}: a source file is not valid JSON (read it by hand)`)
  return { files, summary, refusals, knownCaps: [...known].sort() }
}

function declaredCanary (o) {
  const m = readJson(o.manifest)
  if (m.text == null) return `manifest ${o.manifest} unreadable`
  if (!m.json) return `manifest ${o.manifest} is not JSON`
  const cp = m.json.canary_pool
  return cp != null && String(cp).trim() !== '' && String(cp) !== 'null' ? `a canary is declared (canary_pool=${cp}): convert only into an empty slot` : null
}
/** Canary drop-ins -> [names]. FAILS CLOSED (Codex r2 P2-11): an unreadable unit dir or drop-in dir is a refusal, never "none". */
function dropins (o) {
  try {
    return fs.readdirSync(o.dropinRoot).filter(d => /^mcbot@.+\.service\.d$/.test(d))
      .flatMap(d => fs.readdirSync(path.join(o.dropinRoot, d)).filter(f => f.endsWith('.conf')).map(f => path.join(d, f)))
  } catch (e) { return [`<cannot inspect ${o.dropinRoot}: ${e.code ?? e.message}>`] }
}
function unitsActive (bots, o) {
  if (!o.unitCheck) return []
  return bots.filter(b => {
    try { return execFileSync('systemctl', ['is-active', `mcbot@${b.bot}`], { encoding: 'utf8' }).trim() !== 'inactive' } catch (e) {
      return String(e.stdout ?? '').trim() !== 'inactive' && String(e.stdout ?? '').trim() !== 'failed'
    }
  }).map(b => b.bot)
}
const target = (pool, o) => path.join(o.stateRoot, `_pool-${pool}`)
/** Where set-aside dirs live: same filesystem as the town dirs (atomic rename), but NOT matching `_pool-*`, which the plinth
 *  tripwires glob as towns (Claude r1 P3-11). */
const asideRoot = o => path.join(o.stateRoot, `_${TOOL}`)
const stampOf = o => o.stamp ?? new Date(o.now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
function fsyncFile (f) { const fd = fs.openSync(f, 'r'); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) } }
function writeLike (file, text, like) {
  const st = fs.statSync(like)
  const tmp = `${file}.${TOOL}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, { mode: st.mode & 0o777 })
  try { fs.chownSync(tmp, st.uid, st.gid) } catch { /* not root (tests) */ }
  fsyncFile(tmp)
  fs.renameSync(tmp, file)
}

export function plan (pool, o) {
  const src = readSources(pool, o)
  const seed = buildSeed(src, o)
  const kinds = src.bots.map(b => b.kind)
  return { src, seed, kinds, state: kinds.every(k => k === 'converted') ? 'converted' : kinds.every(k => k === 'isolated') ? 'isolated' : 'mixed' }
}

export function apply (pool, o, say = console.log) {
  const p = plan(pool, o)
  const dir = target(pool, o), marker = readJson(path.join(dir, MARKER))
  // a half rollback is refused BEFORE the idempotent no-op: with every env still converted it would otherwise read as done
  // (Codex r3 P2-3)
  if (marker.json?.tool === TOOL && marker.json?.rollback_started) {
    say(`REFUSED: a rollback of ${pool} started ${marker.json.rollback_started} and did not finish: finish it (rollback --pool ${pool}), never resume the apply`)
    return 2
  }
  if (p.state === 'converted' && marker.json?.tool === TOOL) { say(`already converted: ${pool} (marker ${marker.json.stamp})`); return 0 }
  const refuse = [...p.src.refusals]
  const resume = fs.existsSync(dir) && marker.json?.tool === TOOL && marker.json?.pool === pool
  if (resume && marker.json?.rollback_started) refuse.push(`a rollback of ${pool} started ${marker.json.rollback_started} and did not finish: finish it (rollback --pool ${pool}), never resume the apply (Claude r2 P3-5)`)
  if (p.state === 'mixed' && !resume) refuse.push(`env is mixed (${p.src.bots.map(b => `${b.bot}:${b.kind}`).join(' ')}): roll back first (rollback --pool ${pool}), then apply`)
  if (p.state === 'converted') refuse.push(`env is converted but ${dir} has no ${TOOL} marker: inspect by hand`)
  const dc = declaredCanary(o); if (dc) refuse.push(dc)
  const di = dropins(o); if (di.length) refuse.push(`canary drop-ins present (${di.slice(0, 3).join(', ')}${di.length > 3 ? ', ...' : ''})`)
  const act = unitsActive(p.src.bots, o); if (act.length) refuse.push(`units not stopped: ${act.join(', ')} (stop all five first: the wrapper does)`)
  if (fs.existsSync(dir) && !resume) refuse.push(`${dir} exists without a ${TOOL} marker: move it aside by hand (it is not this tool's)`)
  if (!resume) refuse.push(...p.seed.refusals)
  // EVERY env rewrite is computed BEFORE anything is written (Codex r2 P2-7): a file that cannot be rewritten refuses here
  const rewrites = []
  for (const b of p.src.bots) {
    if (b.kind === 'converted') continue
    try { rewrites.push({ b, r: rewriteEnv(b.text, NEW_VALUES(pool)) }) } catch (e) { refuse.push(`${b.bot}: ${e.message}`) }
  }
  if (refuse.length) { for (const r of refuse) say(`REFUSED: ${r}`); return 2 }
  const stamp = resume ? marker.json.stamp : stampOf(o)
  const bdir = path.join(o.backupRoot, `${stamp}-${pool}`)
  if (!resume) {
    // 1. BACKUPS FIRST
    fs.mkdirSync(bdir, { recursive: true, mode: 0o700 })
    for (const b of p.src.bots) {
      fs.copyFileSync(b.envFile, path.join(bdir, path.basename(b.envFile)))
      if (b.oldDir && fs.existsSync(b.oldDir)) fs.cpSync(b.oldDir, path.join(bdir, 'pool-dirs', path.basename(b.oldDir)), { recursive: true, preserveTimestamps: true })
      const wf = path.join(b.stateDir, `world-facts-${b.bot}.json`)
      if (fs.existsSync(wf)) { fs.mkdirSync(path.join(bdir, 'world-facts'), { recursive: true }); fs.copyFileSync(wf, path.join(bdir, 'world-facts', path.basename(wf))) }
    }
    const sources = {}
    for (const b of p.src.bots) for (const f of [b.envFile, b.plinth && path.join(b.oldDir, `junkwell-plinth-${p.src.home}.json`), b.site?.file, b.composter?.file,
      path.join(b.oldDir, `town-chest-${p.src.home}.containers.json`), path.join(b.stateDir, `world-facts-${b.bot}.json`)].filter(Boolean)) {
      try { sources[f] = sha256(fs.readFileSync(f)) } catch { /* absent */ }
    }
    const planJson = { tool: TOOL, v: 1, pool, stamp, at: new Date(o.now).toISOString(), home: p.src.home, summary: p.seed.summary, sources, known_caps: p.seed.knownCaps,
      seed: Object.fromEntries(Object.entries(p.seed.files).map(([k, v]) => [k, sha256(v)])), env_before: Object.fromEntries(p.src.bots.map(b => [b.bot, Object.fromEntries(KEYS.map(k => [k, b.env[k]]))])) }
    fs.writeFileSync(path.join(bdir, 'plan.json'), JSON.stringify(planJson, null, 1)); fsyncFile(path.join(bdir, 'plan.json'))
    for (const b of p.src.bots) { const c = path.join(bdir, path.basename(b.envFile)); if (sha256(fs.readFileSync(c)) !== sha256(fs.readFileSync(b.envFile))) throw new Error(`backup of ${b.envFile} does not match`) }
    // 2. THE SEED, built aside and renamed into place (no bot can see a half-written town)
    const st = fs.statSync(o.stateRoot), tmp = path.join(asideRoot(o), `tmp-${stamp}-${pool}`)
    fs.mkdirSync(asideRoot(o), { recursive: true, mode: 0o755 })
    fs.mkdirSync(tmp, { mode: 0o755 })
    for (const [name, text] of Object.entries(p.seed.files)) { fs.writeFileSync(path.join(tmp, name), text, { mode: 0o644 }); fsyncFile(path.join(tmp, name)) }
    fs.writeFileSync(path.join(tmp, MARKER), JSON.stringify({ ...planJson, backup: bdir }, null, 1))
    for (const f of fs.readdirSync(tmp)) { try { fs.chownSync(path.join(tmp, f), st.uid, st.gid) } catch { /* tests */ } }
    try { fs.chownSync(tmp, st.uid, st.gid) } catch { /* tests */ }
    fs.renameSync(tmp, dir)
    say(`seeded ${dir} (${Object.keys(p.seed.files).length} files); backup ${bdir}`)
  } else say(`resuming: ${dir} already seeded by ${stamp}; env step only`)
  // 3. THE ENV: three lines per file, every other byte unchanged
  for (const { b, r } of rewrites) {
    writeLike(b.envFile, r.text, b.envFile)
    say(`env ${path.basename(b.envFile)}: ${r.changed.map(k => `${k}=${NEW_VALUES(pool)[k]}`).join(' ')}`)
  }
  say(`APPLIED ${pool} stamp ${stamp}. Start the five units 12 s apart (the wrapper does), then run the tripwire.`)
  return 0
}

export function rollback (pool, o, say = console.log) {
  const p = plan(pool, o)
  const dir = target(pool, o), marker = readJson(path.join(dir, MARKER))
  const bdir = marker.json?.backup
  // THE WHOLE INVENTORY OR NOTHING (Codex r2 P1-6): five env files, valid paths, each key once -- a missing bot would leave
  // its unit unchecked and still running on the town dir this moves. (An override the apply accepted is not re-judged.)
  const refuse = p.src.refusals.filter(r => !/it changes the conversion's effect/.test(r))
  if (!POOL_RE.test(pool)) refuse.push(`not an isolated pool name: ${pool}`)
  if (!bdir || !fs.existsSync(path.join(bdir, 'plan.json'))) refuse.push(`no ${TOOL} marker with a backup in ${dir}: nothing to roll back (or roll back by hand from ${o.backupRoot})`)
  const dc = declaredCanary(o); if (dc) refuse.push(dc)
  const di = dropins(o); if (di.length) refuse.push(`canary drop-ins present (${di[0]}...)`)
  const act = unitsActive(p.src.bots, o); if (act.length) refuse.push(`units not stopped: ${act.join(', ')} (stop all five first: running bots would re-create the town dir)`)
  for (const b of p.src.bots) if (b.kind === 'other') refuse.push(`${b.bot}: env changed since the apply (${KEYS.map(k => `${k}=${b.env[k]}`).join(' ')}): roll back by hand`)
  const before = refuse.length ? {} : (readJson(path.join(bdir, 'plan.json')).json?.env_before ?? {})
  const rewrites = []
  for (const b of p.src.bots) {
    if (b.kind === 'isolated') continue
    try { rewrites.push({ b, r: rewriteEnv(b.text, before[b.bot] ?? OLD_VALUES(b.bot)) }) } catch (e) { refuse.push(`${b.bot}: ${e.message}`) }
  }
  if (refuse.length) { for (const r of refuse) say(`REFUSED: ${r}`); return 2 }
  // 0. the marker says a rollback is under way: from here an interrupted rollback is only ever FINISHED, never resumed as an apply
  if (!marker.json.rollback_started) {
    const mf = path.join(dir, MARKER)
    writeLike(mf, JSON.stringify({ ...marker.json, rollback_started: new Date(o.now).toISOString() }, null, 1), mf)
  }
  // ORDER: env, journals, and the town dir LAST -- it holds the marker, so a crash at any step leaves a state this command
  // resumes (each step skips what is already done)
  // 1. the env: the three lines back to what they were; CODE_VERSION / RUN_ID and everything else stay as they are NOW
  for (const { b, r } of rewrites) {
    if (!before[b.bot]) say(`WARNING: no recorded values for ${b.bot}; restoring the isolated defaults`)
    writeLike(b.envFile, r.text, b.envFile)
    say(`env ${path.basename(b.envFile)}: ${r.changed.join(' ')} restored`)
  }
  // 2. the per-bot cobble journals hold counts from before the town's activity: moved into the backup, so each bot's journal
  //    restarts EMPTY (the same fail-closed recount start the apply gave the town)
  const moved = path.join(bdir, `rollback-${stampOf(o)}-cobble`)
  for (const b of p.src.bots) {
    if (!b.oldDir || !fs.existsSync(b.oldDir)) continue
    for (const f of fs.readdirSync(b.oldDir).filter(n => n.startsWith(`town-chest-${p.src.home}.cobble.`))) {
      fs.mkdirSync(path.join(moved, b.bot), { recursive: true })
      fs.renameSync(path.join(b.oldDir, f), path.join(moved, b.bot, f))
    }
  }
  // 3. the town dir aside (kept: what the town learned is not deleted)
  fs.mkdirSync(asideRoot(o), { recursive: true, mode: 0o755 })
  const aside = path.join(asideRoot(o), `rolledback-${stampOf(o)}-${pool}`)
  fs.renameSync(dir, aside)
  say(`ROLLED BACK ${pool}: town dir -> ${aside}; per-bot cobble journals -> ${moved}. Start the five units 12 s apart.`)
  return 0
}

export function status (pools, o, say = console.log) {
  for (const pool of pools) {
    const p = plan(pool, o)
    const m = readJson(path.join(target(pool, o), MARKER)).json
    say(`${pool}: env ${p.state} (${p.src.bots.map(b => `${b.bot.split('-').pop()}:${b.kind}`).join(' ')}); town dir ${fs.existsSync(target(pool, o)) ? 'present' : 'absent'}; marker ${m?.stamp ?? '-'}${m?.rollback_started ? `; ROLLBACK STARTED ${m.rollback_started}` : ''}${p.src.refusals.length ? `; problems: ${p.src.refusals.join(' | ')}` : ''}`)
  }
  return 0
}

export function main (argv, over = {}, say = console.log) {
  const [cmd = 'plan', ...rest] = argv
  const o = defaults(over)
  let pool = null
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i], v = () => rest[++i]
    if (a === '--pool') pool = v()
    else if (a === '--plinth-from') o.plinthFrom = v()
    else if (a === '--composter-from') o.composterFrom = v()
    else if (a === '--allow-override') o.allowOverride.push(v())
    else if (a === '--state-root') o.stateRoot = v()
    else if (a === '--env-dir') o.envDir = v()
    else if (a === '--manifest') o.manifest = v()
    else if (a === '--backup-root') o.backupRoot = v()
    else { say(`unknown argument ${a}`); return 2 }
  }
  if (cmd === 'status') return status(pool ? [pool] : ['isolated-a', 'isolated-b', 'isolated-c', 'isolated-d'], o, say)
  if (!pool) { say('usage: isolated2shared.mjs plan|apply|rollback|status --pool isolated-x'); return 2 }
  if (cmd === 'plan') {
    const p = plan(pool, o)
    say(`PLAN ${pool} (dry run; nothing written). env: ${p.state}; home ${p.src.home}`)
    for (const l of p.seed.summary) say(`  ${l}`)
    for (const b of p.src.bots) if (b.kind === 'isolated') say(`  env ${path.basename(b.envFile)}: ${KEYS.map(k => `${k} ${b.env[k]} -> ${NEW_VALUES(pool)[k]}`).join(', ')}`)
    for (const r of p.seed.refusals) say(`  WOULD REFUSE: ${r}`)
    const dc = declaredCanary(o); if (dc) say(`  WOULD REFUSE: ${dc}`)
    say(`  seed files: ${Object.keys(p.seed.files).join(', ')}`)
    return p.seed.refusals.length ? 2 : 0
  }
  if ((cmd === 'apply' || cmd === 'rollback') && o.lock && process.env.I2S_UNDER_LOCK !== '1') {
    // THE LOOP LOCK FOR THE WHOLE WRITE (CLAUDE.md, Deploys: an installer acquires /tmp/mcai-canary.lock with flock -n): a
    // deploy or promotion rewrites the same env files. The wrapper takes it itself and sets I2S_UNDER_LOCK=1; run alone,
    // this re-runs itself under flock -n and refuses when the lock is busy.
    try {
      execFileSync('flock', ['-n', '-E', '75', o.lock, process.execPath, fileURLToPath(import.meta.url), ...argv], { stdio: 'inherit', env: { ...process.env, I2S_UNDER_LOCK: '1' } })
      return 0
    } catch (e) { if (e.status === 75) say(`REFUSED: ${o.lock} is held (a canary loop, a deploy or an installer): run between canaries`); return e.status ?? 2 }
  }
  if (cmd === 'apply') return apply(pool, o, say)
  if (cmd === 'rollback') return rollback(pool, o, say)
  say(`unknown command ${cmd}`); return 2
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main(process.argv.slice(2)))
