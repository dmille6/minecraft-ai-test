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
 *   - at most RECOUNT_COOLDOWN_MS between orders, and RECOUNT_BACKOFF_MS after an order that counted nothing;
 *   - each run counts at most the reconciliation's 3 containers, each walk bounded (skills.mjs reconcileCobble);
 *   - a container that cannot be counted is backed off (10 min), and -- REACHABILITY -- its failure is written to the
 *     town's container memory, so a second failure >= 10 min later makes it UNUSABLE for 6 h for every bot of the town
 *     (chestfull.mjs recordOutcome); a container the memory holds unusable, in backoff or lid-blocked is never a key.
 */
export const RECOUNT_COOLDOWN_MS = 60_000
export const RECOUNT_BACKOFF_MS = 10 * 60_000
/** The town memory's statuses (chestfull.mjs containerStatus) a recount never walks to. */
export const RECOUNT_SKIP = Object.freeze(new Set(['unusable', 'backoff', 'unavailable']))
/** The runner declined to start it: nothing is charged. */
const DECLINED = new Set(['runner_paused', 'runner_busy', 'body_held'])

const lazy = v => (typeof v === 'function' ? v() : v)

/**
 * -> { order, state }. Pure.
 *   atTown          the bot is in town (chestfull.mjs inTown: the reconciliation's boundary)
 *   unknownRefused  [{ name, why }] held names a plan refuses as town_stock_unknown / town_cobble_unknown (cheap: one plan)
 *   keys            the containers a count can still reach (lazy: a journal fold and a town-memory read, after the gates)
 *   state           { lastIssuedAt, backoffUntil }
 */
export function recountOrder ({ now = 0, atTown = false, unknownRefused = [], keys = [], state = {} } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!atTown) return none()
  const refused = (Array.isArray(unknownRefused) ? unknownRefused : []).filter(r => r?.name && /_unknown$/.test(r.why ?? ''))
  if (!refused.length) return none()
  if (now - (s.lastIssuedAt ?? -Infinity) < RECOUNT_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return none()
  let k = []
  try { k = lazy(keys) ?? [] } catch { k = [] }
  if (!k.length) return none()
  s.lastIssuedAt = now
  const names = [...new Set(refused.map(r => r.name))]
  return { order: { skill: 'count_town', args: {},
                    why: `at town holding ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` (+${names.length - 3})` : ''} the town cannot judge yet (not counted); ${Math.min(k.length, 3)} of ${k.length} town container(s) get counted first` }, state: s }
}

/** After the order ran -> the new state: nothing counted (or failed) backs off; a count costs only the cooldown. */
export function recountOutcome (status, counted = 0, now = 0, state = {}, failClass = null) {
  const s = { ...state }
  if (DECLINED.has(failClass)) { s.lastIssuedAt = -Infinity; return s }
  s.backoffUntil = status === 'success' && Number(counted) > 0 ? 0 : now + RECOUNT_BACKOFF_MS
  return s
}
