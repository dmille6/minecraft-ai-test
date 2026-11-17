// REFILL-01 (bagfix-02show (e); OWNER 11-16): NO GATHERING FOR STOCK -- A REFILL IS A JOB, RAISED ON EVIDENCE OF USE.
// "We should not use idle bots to just collect random items and add to the store room, idle bots should clean, terraform, fill in
// holes, and do good useful things" / "if the stockpile is running low on a certain item that is used regularly, we can use bots to
// refill the stock yard, but not just idle bots with nothing else to do. i dont want work to be stopped by an empty stock yard".
// PURE, and a LEAF (no imports): the switch, the rule, the jobs' record. skills.mjs reads the ledger and writes the file;
// milestones.mjs carries the job as a rung (a goal with a size and an end) and stops the stock rungs growing.
//
// THE RULE (refillNeed): a kind is refilled only when
//   USED   the use ledger shows a named consumer drew it on REFILL.minDraws (3) occasions or REFILL.minItems (64) items in the last
//          REFILL.days (2) days (useledger.mjs usedRegularly: a clerk's move is not a use). NO BOOTSTRAP (Codex r1 BLOCKER 5): a
//          ledger with no history raises nothing by itself -- only a consumer actually refused does (billShortfall, the empty draw);
//   LOW    its standing stock is under a day of that use (never an arbitrary target), at least REFILL.lowMin (16).
// A kind nobody draws is never refilled. THE JOB has a size (two days of use less the stock, at most REFILL.maxJob 256) and an end
// (the size banked, or REFILL.ttlMs), and at most REFILL.takers (2) bots carry it -- never the default work of an idle bot.
// A CONSUMER REFUSED for lack of a kind raises its job at once (refillRaise `by`: the consumer), whatever the low mark.
// WHAT STOPS (REFILL=off|0|false|no restores each): the stock rungs' growth with the laps (milestones.mjs stockpile_wood /
// stockpile_stone: the kit's base stays -- a pickaxe needs its cobblestone, a named consumer); the first yard's `chests_short`
// refill (yard.mjs yardWork: 204 cobblestone were dug back on 11-16 to hold a chest target nothing was drawing against).
// On only where the yard's lanes are (the showcase): `on` is the caller's (yard.mjs LANES.on && refillOn).

const isOff = v => ['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
export const refillOn = (env = {}) => !isOff(env?.REFILL)
const num = (v, d, lo, hi) => { const n = Number(String(v ?? '').trim()); return String(v ?? '').trim() !== '' && Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : d }
/** THE NUMBERS -> { on, days, minDraws, minItems, lowMin, maxJob, takers, ttlMs }. Pure. Every one a setting. */
export function refillSettings (env = {}) {
  return Object.freeze({ on: refillOn(env), days: num(env?.REFILL_DAYS, 2, 1, 14), minDraws: num(env?.REFILL_MIN_DRAWS, 3, 1, 100), minItems: num(env?.REFILL_MIN_ITEMS, 64, 1, 10000),
    lowMin: num(env?.REFILL_LOW_MIN, 16, 1, 1000), maxJob: num(env?.REFILL_MAX_JOB, 256, 16, 4096), takers: num(env?.REFILL_TAKERS, 2, 1, 8), ttlMs: num(env?.REFILL_TTL_MIN, 120, 10, 1440) * 60_000 })
}
export const REFILL = refillSettings(typeof process !== 'undefined' ? process.env : {})
/**
 * A CONSUMER'S STATED SHORTFALL -> { kind: n } to raise jobs for. Pure. `left` what a build's bill (or the clean-up's fill) still
 * wanted after its search of the town's chests; only when the search was EXHAUSTED (every container that holds the name was looked
 * in -- a search cut short by its clock or an unsettled transfer proves no shortage) and only kinds a bot can bring to the yard
 * (`kinds`: the lanes'). The job's size is the shortfall itself.
 */
export function billShortfall (left = {}, { kinds = [], exhausted = false, unsettled = false, settings = REFILL } = {}) {
  const out = {}
  if (!settings?.on || !exhausted || unsettled) return out
  for (const [name, n] of Object.entries(left ?? {})) { const c = Math.ceil(Number(n) || 0); if (c > 0 && kinds.includes(name)) out[name] = c }
  return out
}
/** What a bot gathers to bring a kind (the block whose drop it is); a kind with no entry is gathered by its own name. */
export const REFILL_BLOCK = Object.freeze({ cobblestone: 'stone', cobbled_deepslate: 'deepslate', dirt: 'dirt', gravel: 'gravel', sand: 'sand' })
export const refillBlockOf = kind => REFILL_BLOCK[kind] ?? kind

/**
 * DOES A KIND NEED A REFILL JOB? -> { need, n, why, perDay, low }. Pure.
 *   use     useledger.mjs usedRegularly's answer over the last REFILL.days ({ used, draws, items, perDay }) | null (no ledger)
 *   stock   the standing stock (the newest stock line; null: unknown -- never a job on a guess)
 */
export function refillNeed (kind, { use = null, stock = null, settings = REFILL } = {}) {
  const no = why => ({ need: false, n: 0, why, perDay: 0, low: 0 })
  if (!settings?.on) return no('off')
  if (!Number.isFinite(stock)) return no('stock_unknown')
  // Codex r1 BLOCKER 5: NO BOOTSTRAP -- a new ledger with no dirt in stock raised a 128-dirt job with nobody asking for dirt, which
  // is gathering to stock. Before the ledger has history a job is raised ONLY by a consumer actually refused (billShortfall, the
  // yard's empty draw), sized by what it was short of.
  const perDay = use?.used ? Number(use.perDay) || 0 : 0
  if (!use?.used) return no('not_used')
  const why = 'used'
  const low = Math.max(settings.lowMin, Math.ceil(perDay))
  if (!(stock < low)) return { need: false, n: 0, why: 'stocked', perDay, low }
  return { need: true, n: Math.max(settings.lowMin, Math.min(settings.maxJob, Math.ceil(2 * perDay - stock))), why, perDay, low }
}

// ---- the jobs' record ({ jobs: [{ id, kind, n, got, by, t, until, takers: [bot] }] }; skills.mjs reads and writes the pool file) --------
export const refillFileName = home => `refill-jobs-${home.x}_${home.y}_${home.z}.json`
/** The open jobs now -> jobs (not finished, not past their end). Pure. */
export const openJobs = (jobs = [], now = Date.now()) => (Array.isArray(jobs) ? jobs : []).filter(j => j && typeof j.kind === 'string' && (Number(j.got) || 0) < (Number(j.n) || 0) && now < (Number(j.until) || 0))
/** RAISE a job -> the jobs (unchanged when the kind already has an open one: one job a kind). Pure. `by` the low mark's reason or the
 *  refused consumer's name. */
export function refillRaise (jobs = [], { kind, n, by = 'low', now = Date.now(), settings = REFILL } = {}) {
  const open = openJobs(jobs, now)
  if (!settings?.on || typeof kind !== 'string' || !(n > 0) || open.some(j => j.kind === kind)) return jobs
  return [...open, { id: `${kind}.${Math.floor(now).toString(36)}`, kind, n: Math.max(1, Math.min(settings.maxJob, Math.ceil(n))), got: 0, by: String(by).slice(0, 24), t: now, until: now + settings.ttlMs, takers: [] }]
}
/** THE JOB A BOT CARRIES -> { jobs, job } : the one it already took, else the oldest open job with a taker's place free (taken now).
 *  null when there is none -- then the bot's default stands (clean-up, never stocking). Pure. */
export function refillTake (jobs = [], bot, { now = Date.now(), settings = REFILL } = {}) {
  const open = openJobs(jobs, now)
  if (!settings?.on || !bot) return { jobs, job: null }
  const mine = open.find(j => (j.takers ?? []).includes(bot))
  if (mine) return { jobs, job: mine }
  const free = [...open].sort((a, b) => a.t - b.t).find(j => (j.takers ?? []).length < settings.takers)
  if (!free) return { jobs, job: null }
  const taken = { ...free, takers: [...(free.takers ?? []), bot] }
  return { jobs: open.map(j => (j.id === free.id ? taken : j)), job: taken }
}
/** CREDIT what a bot banked of a kind -> the jobs (the job closes itself when its size is banked: openJobs drops it). Pure. */
export function refillCredit (jobs = [], kind, n, now = Date.now()) {
  if (!(n > 0)) return jobs
  return (Array.isArray(jobs) ? jobs : []).map(j => (j?.kind === kind && now < (Number(j.until) || 0) && (Number(j.got) || 0) < (Number(j.n) || 0) ? { ...j, got: (Number(j.got) || 0) + n } : j))
}
/** The job as a goal's words -> { describe, progress, hint }. Pure. */
export const refillWords = job => ({ describe: `Refill job: bring ${job.n} ${job.kind} to the storage yard (raised by ${job.by}; ${job.got} banked so far), then stop.`,
  progress: `${job.got}/${job.n} ${job.kind} banked at the yard`, hint: `gather with block=${refillBlockOf(job.kind)}, then go home: the yard takes it on the town visit.` })
/**
 * ONE POOL-WIDE READ-MODIFY-WRITE (Codex r1 BLOCKERS 3, 4: three processes read one untaken job and each wrote itself its taker; two
 * yards' bots each rewrote the one row file) -> { ok, value, why }. `io`: lock() -> truthy token | null, read() -> the record FRESH
 * (inside the lock), write(next) -> bool, unlock(token). `apply(cur) -> { next, value }`; `next === cur` means nothing to write.
 * NOTHING IS ACKNOWLEDGED WITHOUT ITS WRITE: no lock, or a write that failed, returns ok false and `value` null -- the caller acts
 * on nothing. The lock is released on every path.
 */
export function lockedUpdate (io, apply) {
  let token = null
  try { token = io.lock() } catch { token = null }
  if (!token) return { ok: false, value: null, why: 'locked' }
  try {
    const cur = io.read()
    const r = apply(cur) ?? {}
    if (r.next === undefined || r.next === cur) return { ok: true, value: r.value ?? null, why: 'unchanged' }
    if (!io.write(r.next)) return { ok: false, value: null, why: 'write_failed' }
    return { ok: true, value: r.value ?? null, why: 'written' }
  } catch { return { ok: false, value: null, why: 'error' } } finally { try { io.unlock(token) } catch { /* its TTL frees it */ } }
}
/** `_refill` row detail. Pure. */
export const refillDetail = ({ op = '-', kind = '-', n = 0, by = '-', why = '-', stock = '-', perDay = '-', got = '-' } = {}) =>
  `op=${op} kind=${kind} n=${n} by=${String(by).replace(/\s+/g, '_')} why=${why} stock=${stock} per_day=${perDay} got=${got}`.slice(0, 300)
/** `_refill_mode` licence row detail. Pure. */
export const refillModeDetail = (on, s = REFILL) => `on=${on ? 1 : 0} days=${s.days} min_draws=${s.minDraws} min_items=${s.minItems} low_min=${s.lowMin} max_job=${s.maxJob} takers=${s.takers} ttl_min=${s.ttlMs / 60_000} bootstrap=none`
