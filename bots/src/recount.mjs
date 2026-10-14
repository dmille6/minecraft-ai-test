/**
 * THE TOWN RECOUNT ORDER (stocktarget-02). Pure; cognitive.mjs supplies the readings and keeps the state, skills.mjs
 * countTown runs it.
 *
 * WHY (chest clear #2, 10-14 02:22Z, docs/reports/census/clear2-20261014T0221Z/): the clear's fence left every town
 * container UNKNOWN to the stock targets and the cobble cap. A deposit that a cap or target cannot judge is refused
 * (`_stock_refused ... *_unknown`) -- correctly, for the ceiling -- but the only deterministic recount was the town
 * deposit's count step, which fires at 34+ used slots. hive-a's and placebo-a's bots peaked at 22-31: in 2 h, 0 of 24
 * and 0 of 17 containers were recounted while hive-a-Delta's deposit was refused 55 times. A refusal that names no remedy
 * the bot performs from where it is (CLAUDE.md): two correct guards meeting in a dead end.
 *
 * THE RULE: at town (the deposit's own boundary), holding a name some plan refuses as NOT YET COUNTED, with a town
 * container a count can still reach -> count it now, whatever the bag's size. Bounded so it cannot loop:
 *   - at most RECOUNT_COOLDOWN_MS between orders (the look charged too), RECOUNT_BACKOFF_MS after an order that counted
 *     nothing; a runner that declined the order is refunded;
 *   - each run counts at most the reconciliation's 3 containers, each walk bounded (skills.mjs reconcileCobble);
 *   - REACHABILITY: a container the recount could not reach (a real no-path, or a walk that resolved out of reach) or
 *     could not open is a RECOUNT MISS in the town's own recount file -- NOT in the container memory the deposit, the
 *     withdraw and the full-chest recovery read (both reviews st2-r1: a strike there turns a good chest unusable for the
 *     bank and lets the recovery build a new chest). Two misses >= 10 min apart within 6 h, or one in the last 10 min,
 *     keep it out of the recount for the whole town (recountMissStatus); an interrupted walk, our own clock and a slow
 *     open are never a miss. A container the container memory itself holds unusable, in backoff or lid-blocked is never
 *     a key either (the deposit's own knowledge).
 */
export const RECOUNT_COOLDOWN_MS = 60_000
export const RECOUNT_BACKOFF_MS = 10 * 60_000
/** The town memory's statuses (chestfull.mjs containerStatus) a recount never walks to. */
export const RECOUNT_SKIP = Object.freeze(new Set(['unusable', 'backoff', 'unavailable']))
/** The runner declined to start it: nothing is charged. */
const DECLINED = new Set(['runner_paused', 'runner_busy', 'body_held'])
/** A recount miss counts for this long; two misses at least RECOUNT_MISS_GAP_MS apart make the container unusable. */
export const RECOUNT_MISS_TTL_MS = 6 * 60 * 60_000
export const RECOUNT_MISS_GAP_MS = 10 * 60_000
/** The failures that ARE evidence the recount cannot count a container (never an interruption, our clock or a slow open). */
export const RECOUNT_MISS_REASONS = Object.freeze(new Set(['unreachable', 'unopenable', 'not a container']))
/** A miss list after one more miss -> [ms]. Pure. */
export function recordRecountMiss (misses = [], now = 0) {
  return [...(Array.isArray(misses) ? misses : []).filter(t => Number.isFinite(t) && now - t < RECOUNT_MISS_TTL_MS), now].slice(-8)
}
/** -> 'unusable' | 'backoff' | 'ok'. Pure. */
export function recountMissStatus (misses = [], now = 0) {
  const live = (Array.isArray(misses) ? misses : []).filter(t => Number.isFinite(t) && now - t < RECOUNT_MISS_TTL_MS)
  if (!live.length) return 'ok'
  if (Math.max(...live) - Math.min(...live) >= RECOUNT_MISS_GAP_MS) return 'unusable'
  return now - Math.max(...live) < RECOUNT_MISS_GAP_MS ? 'backoff' : 'ok'
}

const lazy = v => (typeof v === 'function' ? v() : v)

/**
 * -> { order, state }. Pure.
 *   atTown          the bot is in town (chestfull.mjs inTown: the reconciliation's boundary)
 *   unknownRefused  [{ name, why }] held names a plan refuses as town_stock_unknown / town_cobble_unknown (lazy: a whole
 *                   plan, read only at town, outside the cooldown, once per look -- Claude st2-r1 P3-1)
 *   keys            the containers a count can still reach (lazy: a journal fold and a town-memory read, after the gates)
 *   state           { lastIssuedAt, backoffUntil }
 */
export function recountOrder ({ now = 0, atTown = false, unknownRefused = [], keys = [], state = {} } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!atTown) return none()
  if (now - (s.lastIssuedAt ?? -Infinity) < RECOUNT_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return none()
  // THE LOOK IS CHARGED TOO (a plan, a journal fold, the town files): at most one per cooldown, order or not
  if (now - (s.lastLookAt ?? -Infinity) < RECOUNT_COOLDOWN_MS) return none()
  const prevLook = s.lastLookAt
  s.lastLookAt = now
  let ur = []
  try { ur = lazy(unknownRefused) ?? [] } catch { ur = [] }
  const refused = (Array.isArray(ur) ? ur : []).filter(r => r?.name && /_unknown$/.test(r.why ?? ''))
  if (!refused.length) return none()
  let k = []
  try { k = lazy(keys) ?? [] } catch { k = [] }
  if (!k.length) return none()
  // what a runner's decline refunds (Codex st2-r1 P3: the look stayed charged)
  s.refund = { lastIssuedAt: s.lastIssuedAt ?? null, lastLookAt: prevLook ?? null }
  s.lastIssuedAt = now
  const names = [...new Set(refused.map(r => r.name))]
  return { order: { skill: 'count_town', args: {},
                    why: `at town holding ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` (+${names.length - 3})` : ''} the town cannot judge yet (not counted); ${Math.min(k.length, 3)} of ${k.length} town container(s) get counted first` }, state: s }
}

/** After the order ran -> the new state: nothing counted (or failed) backs off; a count costs only the cooldown. */
export function recountOutcome (status, counted = 0, now = 0, state = {}, failClass = null) {
  const s = { ...state }
  if (DECLINED.has(failClass)) {
    s.lastIssuedAt = s.refund?.lastIssuedAt ?? -Infinity
    s.lastLookAt = s.refund?.lastLookAt ?? -Infinity
    delete s.refund
    return s
  }
  delete s.refund
  s.backoffUntil = status === 'success' && Number(counted) > 0 ? 0 : now + RECOUNT_BACKOFF_MS
  return s
}
