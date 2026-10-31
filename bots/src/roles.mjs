// THE ROLE LEASES, bot side (B5 of the cooperation tier: docs/reports/cooperation-tier-2026-10-23.md sections 3.2, 3.5, 3.6).
// A host assigner (greedy, random, a scripted oracle or a frontier model through the spend guard) writes ONE file per town,
// `roles-<home>.json` in the pool's state directory. A lease is a SORT KEY, never a command: when this bot is at town, inside
// its town-job chain, a valid lease puts the leased job FIRST among the discretionary town jobs (ahead of the smelt job, the
// furnace drain and the materials job). The job's own admission still decides (its cooldown, its slots, its segment leases,
// its room rule); maintenance (bag-full deposit, the toolkit, the milestone's orders, every reflex) still runs first. It never
// causes travel. A lease that the job refuses is released in the same decision and the bot's next choice is today's.
//
// ROLES=on switches the reader on. ROLES unset or anything else is today's behaviour: no file is read, nothing changes.
//
// THE FILE (atomic rename by the writer):
//   { v: 1, gen: <int, monotone>, issued_at: <ms>, world: <pool>, home: "<x>_<y>_<z>", arm: <name>,
//     leases: [{ bot, job: 'BUILD' | 'MAKE', expires_at: <ms>, project: <plot> | null, record_gen: <int> | null,
//                segment: <name> | null, snapshot_gen: <int>, reason: <enum> }] }
// BINDING (3.5): a lease is honoured only when it names this bot, this world (the pool), this home, a job this reader knows,
// it has not expired, it was not issued in the future, and its project and record generation equal the town's active project
// record as this bot reads it (an unsited project binds as project = the active plot with record_gen null). Anything else is
// stale and ignored. A file whose gen is LOWER than the highest this process has ACTED ON (honoured or released) is ignored
// (a rolled-back writer).
import fs from 'node:fs'
import path from 'node:path'

export const ROLES = Object.freeze({ on: process.env.ROLES === 'on' })
export const ROLES_V = 1
/** The jobs this reader can sort first, and the skill each one names. DEEP_MINER, SMELT and BANK are not leasable here (v1). */
export const ROLE_SKILL = Object.freeze({ BUILD: 'build_shop', MAKE: 'make_material' })
export const ROLE_JOBS = Object.freeze(Object.keys(ROLE_SKILL))
export const ROLE_TTL_MAX_MS = 30 * 60 * 1000
export const ROLE_CLOCK_SLACK_MS = 60 * 1000
/** How long a release for one lease silences it (the 30-min no-re-lease is the host's; this only stops a refused lease from
 *  being tried again on every decision of the same visit). */
export const ROLE_RELEASE_HOLD_MS = 5 * 60 * 1000

export const rolesFile = (dir, home) => path.join(dir, `roles-${home}.json`)

/** Read the town's lease file -> { ok, doc, why }. ok: false with why = 'missing' | 'unreadable' | 'unparseable' | 'shape'.
 *  Never throws. */
export function readRoles (dir, home) {
  let text
  try { text = fs.readFileSync(rolesFile(dir, home), 'utf8') } catch (e) { return { ok: false, doc: null, why: e?.code === 'ENOENT' ? 'missing' : 'unreadable' } }
  let doc
  try { doc = JSON.parse(text) } catch { return { ok: false, doc: null, why: 'unparseable' } }
  if (!doc || doc.v !== ROLES_V || !Number.isInteger(doc.gen) || !Array.isArray(doc.leases)) return { ok: false, doc: null, why: 'shape' }
  return { ok: true, doc, why: null }
}

/**
 * THIS BOT'S LEASE -> { lease, why }. Pure. `project` = { plot, gen } of the town's active project as this bot reads it
 * (gen null while unsited), or null when the bot cannot read it (then no lease binds: 'no_project').
 * why (when lease is null): 'off' | 'no_file' | 'old_gen' | 'world' | 'home' | 'future' | 'none' | 'expired' | 'job' |
 * 'no_project' | 'project' | 'record_gen' | 'ttl'.
 */
export function leaseFor ({ on = ROLES.on, doc = null, bot = '', world = '', home = '', now = 0, project = null, maxGen = -Infinity } = {}) {
  if (!on) return { lease: null, why: 'off' }
  if (!doc) return { lease: null, why: 'no_file' }
  if (doc.gen < maxGen) return { lease: null, why: 'old_gen' }
  if (doc.world !== world) return { lease: null, why: 'world' }
  if (doc.home !== home) return { lease: null, why: 'home' }
  if (!Number.isFinite(Number(doc.issued_at)) || Number(doc.issued_at) > now + ROLE_CLOCK_SLACK_MS) return { lease: null, why: 'future' }
  const mine = doc.leases.filter(l => l && l.bot === bot)
  if (!mine.length) return { lease: null, why: 'none' }
  // one lease per bot is the validator's rule; a second is ignored (the first in file order wins: deterministic)
  const l = mine[0]
  if (!ROLE_JOBS.includes(l.job)) return { lease: null, why: 'job' }
  const exp = Number(l.expires_at)
  if (!Number.isFinite(exp) || exp <= now) return { lease: null, why: 'expired' }
  if (exp - Number(doc.issued_at) > ROLE_TTL_MAX_MS + ROLE_CLOCK_SLACK_MS) return { lease: null, why: 'ttl' }
  if (!project) return { lease: null, why: 'no_project' }
  if ((l.project ?? null) !== (project.plot ?? null)) return { lease: null, why: 'project' }
  if ((l.record_gen ?? null) !== (project.gen ?? null)) return { lease: null, why: 'record_gen' }
  return { lease: { ...l, gen: doc.gen, arm: doc.arm ?? null }, why: null }
}

/** A lease's identity for the release hold and the rows: the file gen, the job and the expiry (a re-issue keeps its expiry). */
export const leaseId = l => `${l.job}:${l.expires_at}:${l.project ?? '-'}:${l.record_gen ?? '-'}`

/**
 * WHICH JOB GOES FIRST NOW -> { skill, lease } | null. Pure over the inputs. `released` = { [leaseId]: at } (this bot's own
 * releases): a lease released in the last ROLE_RELEASE_HOLD_MS is not tried again.
 */
export function leasedFirst ({ lease = null, released = {}, now = 0 } = {}) {
  if (!lease) return null
  const at = released[leaseId(lease)]
  if (Number.isFinite(at) && now - at < ROLE_RELEASE_HOLD_MS) return null
  return { skill: ROLE_SKILL[lease.job], lease }
}

/** The `_role_honoured` / `_role_released` row detail (every value an enum, a name or a number: comms principle 6). */
export function roleRowDetail (lease, extra = {}) {
  const now = extra.now ?? 0
  const kv = { gen: lease?.gen ?? '-', job: lease?.job ?? '-', arm: lease?.arm ?? '-', project: lease?.project ?? '-', record_gen: lease?.record_gen ?? '-',
    segment: lease?.segment ?? '-', snapshot_gen: lease?.snapshot_gen ?? '-', expires_in_s: lease ? Math.round((Number(lease.expires_at) - now) / 1000) : '-' }
  for (const [k, v] of Object.entries(extra)) if (k !== 'now') kv[k] = v
  return Object.entries(kv).map(([k, v]) => `${k}=${v}`).join(' ')
}

/** Drop releases older than the hold (bounded memory). Pure. */
export function pruneReleased (released = {}, now = 0) {
  const out = {}
  for (const [k, at] of Object.entries(released)) if (now - at < ROLE_RELEASE_HOLD_MS) out[k] = at
  return out
}
