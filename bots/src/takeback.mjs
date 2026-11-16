// TAKEBACK-01: A WALK TAKES BACK THE BLOCKS IT PLACED.
// Design: docs/reports/walking-mess-design-2026-11-12.md on main (Codex + Claude independent designs, reconciled).
//
// WHY (owner 11-12: "Walking must not place dirt or dig ground. Escapes undo what they placed. Even outside the town I want the
// same rules to apply."). Measured on the showcase, 12 h to 11-12 13:20Z (14 bots; `_place_town`): 1,772 blocks placed in the
// town and its margin by movement, 1,321 of them by the pathfinder's own scaffold (664 bursts, median 1 block, 90% four or fewer),
// and 75 of the 1,772 cells ever dug again. scaftown-01's +20 price is live and priced 74,826 of 90,689 walk searches in that
// window; a placing route was still chosen 585 times and the rest ran unpriced (budget cuts, capped searches, latched goals). A
// route preference does not remove what gets placed; this does.
//
// WHAT. Every block the pathfinder places for a walk gets a RECEIPT (placeaudit.mjs `onPlaced`: its cell, its block). Every walk
// (`bot.pathfinder.goto`, the one entry 58 call sites use) runs under a watcher: when a receipt is RIPE -- the bot has stood on the
// block and left its column (or 8 s passed unused), it is on the ground, out of water, and can still reach and see the block -- the
// watcher halts the walk (pathhalt.mjs), the bot digs its own block back, and the SAME goal is issued again. The caller sees one
// goto promise: it resolves or rejects exactly as the library's would, a little later.
//
// NEVER DUG (verdictFor): a cell that no longer holds the block placed (`adopted why=changed`), a cell with anything on top of it
// (`adopted why=built_on`: someone built on it, or a block that would fall), a cell the walk's own break prices protect
// (`adopted why=protected`: movements.exclusionAreasBreak -- the wells, the plan's cells, the zones, the shop's footprint), a cell
// with water or lava against it (`adopted why=liquid`: taken out, the liquid would run into the gap), a cell with a body on it
// (`deferred`), a block the bot cannot dig in 3 s (`left why=slow`). Never the bot's own column.
// NEVER WHILE A REFLEX HOLDS THE BODY (digtown's own context: an active reflex, or an arbiter holder that is not the running
// skill), never a walk a reflex issued (its frame on the stack) or one in a survival dig scope: survival first.
//
// NO NEW REFUSAL. Nothing a walk could do before is taken away: the placement still happens, the route is still walked. The
// bounds: at most 4 halts a goto and 12 a minute; a cell placed AGAIN within 2 minutes of being taken back is kept (`kept
// why=reuse`: the walk needs it); a take-back spends at most 6 s.
//
// A WALK THE CALLER GAVE UP IS NEVER WALKED AGAIN (review r1, both engines: Codex reproduced A -> null -> null -> A with the real
// library, whose goto rejects one timer turn AFTER it stops listening; Claude: chestWalk's timeout leaves the path alone when the
// goal is not its own, so no event ever told the take-back). Three rules:
//   1. THE FENCE. Only a walk handed to skills.mjs withTimeout is ever halted (`call.fenced`): its timer calls `call.giveUp()`
//      whatever the caller's own timeout handler then does. A goto nobody fenced is the library's own, as before.
//   2. EVERY ENDING BY SOMEONE ELSE is heard for the whole call, not from the halt on: a goal_updated for another goal (the
//      caller's haltPath, a new walk, a reflex's goal) and EVERY path_stop. Our own halt is excused exactly ONE goal_updated(null)
//      and nothing else (review r2, Codex, reproduced with the real library: a listener that set a reflex's goal INSIDE our
//      setGoal(null) was swallowed -- A -> null -> REFLEX -> A; and a stop() someone had pending is consumed by that same
//      setGoal's resetPath, which emits path_stop there and then: it is theirs, never ours).
//   3. THE WATCHER HALTS ONLY ITS OWN GOAL: `pathfinder.goal` must still be this call's goal, the call must be the newest goto,
//      and nobody may have ended it.
// After a take-back the goal is issued again only while none of that happened; otherwise the caller gets GoalChanged or
// PathStopped, exactly what the library would have given it.
//
// NOT IN THIS PIECE (the design's pieces 2-5): the escapes' pillars (reflex.mjs pillarOut, digStraightUp; skills surface,
// shaftAscend), walks issued by setGoal, dug ground put back, and a stair where a spot needs a block again and again.
// LEFT BEHIND (litter-01): a receipt that closes `left` is passed to `onLeft` -- litter.mjs hands the town's and the margin's to the
// cleanup crew with their cells. Nothing here changes what is dug.
// ROWS: `_takeback_mode` at install; `_takeback` per receipt closed; `_takeback_sum` every 10 minutes when anything happened.
// SWITCH: TAKEBACK=off|0|false|no -> not installed (the mode row says on=0).
import { Vec3 } from 'vec3'
import { haltPath } from './pathhalt.mjs'
import { withDigScope, currentDigScope } from './digtown.mjs'

export const TAKEBACK = Object.freeze({
  reach: 4.5, eye: 1.62, tickMs: 200, unusedMs: 8_000, ttlMs: 5 * 60_000, maxOpen: 64,
  haltsPerGoto: 4, haltsPerMin: 12, budgetMs: 6_000, digMsMax: 3_000, tries: 2, reuseMs: 120_000, minHealth: 10,
  sumMs: 600_000,
  // the profiles whose scaffold is a WALK's (index.mjs): the escapes' profiles (ascend, descend, deck, water) keep theirs (piece 3)
  profiles: ['walk', 'composter_walk', 'gather', 'town_deposit_walk'],
})
/** THE SWITCH. Pure. */
export const takebackOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.TAKEBACK ?? '').trim())
const K = c => `${c[0]},${c[1]},${c[2]}`
const AIRY = n => n === 'air' || n === 'cave_air' || n === 'void_air'

/** The bot's feet cell from its position. Pure. */
export const feetOf = p => [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)]
/** Half a body's width: a player is 0.6 wide, so it rests on every column within 0.3 of its centre. */
export const HALF_BODY = 0.3
/** Does a body centred at pos overlap the cell's column (review r1, Codex: a bot centred at x 2.1 still stands on the block at x 1)?
 *  Pure. The edges count as clear: a body flush against the column does not rest on it. */
export function overlapsColumn (cell, pos, half = HALF_BODY) {
  return pos.x + half > cell[0] && pos.x - half < cell[0] + 1 && pos.z + half > cell[2] && pos.z - half < cell[2] + 1
}
/** Is the bot on or over the receipt's block (standing on it, or on a tower over it)? Pure. */
export const overCell = (cell, pos) => overlapsColumn(cell, pos) && pos.y >= cell[1] + 0.5
/** Is a world block a liquid, or holding one (a waterlogged stair or slab: review r1, Codex)? Pure over a prismarine block. */
export function holdsLiquid (b) {
  if (!b) return false
  if (/water|lava|bubble_column|kelp|seagrass/.test(String(b.name ?? ''))) return true
  if (b.isWaterlogged === true) return true
  let props = null
  try { props = typeof b.getProperties === 'function' ? b.getProperties() : (b.props ?? b._properties ?? null) } catch { props = null }
  return !!props && (props.waterlogged === true || props.waterlogged === 'true')
}
/** Eye to the block's centre within reach. Pure. */
export function inReach (cell, pos, T = TAKEBACK) {
  return Math.hypot(cell[0] + 0.5 - pos.x, cell[1] + 0.5 - (pos.y + T.eye), cell[2] + 0.5 - pos.z) <= T.reach
}
/** IS A PLACEMENT ONE THIS PIECE TAKES BACK? -> bool. Pure. `rec` placeaudit's record of a placement that LANDED. */
export function receiptFor (rec, T = TAKEBACK) {
  return !!rec && rec.reason === 'pathfinder' && Array.isArray(rec.cell) && rec.cell.every(Number.isFinite) &&
    typeof rec.block === 'string' && rec.block !== '?' && T.profiles.includes(String(rec.profile))
}
/**
 * IS THE RECEIPT RIPE? -> bool. Pure. The bot has used the block (stood on or over it) or let it stand unused for unusedMs; no part
 * of its body is over that column any more (its footing is elsewhere); it is on the ground and out of water; the block is in reach.
 *   here { pos, feet, onGround, inWater }
 */
export function ripe (r, here, now, T = TAKEBACK) {
  if (!r || r.closed || !here?.pos || !here.feet) return false
  if (!(r.used || now - r.t >= T.unusedMs)) return false
  if (overlapsColumn(r.cell, here.pos)) return false
  if (!here.onGround || here.inWater) return false
  return inReach(r.cell, here.pos, T)
}
/**
 * WHAT TO DO WITH A RIPE RECEIPT -> { act: 'dig' | 'adopted' | 'deferred' | 'left', why }. Pure.
 *   name      the block in the cell now (null: unread);  above  the block over it
 *   body      a body stands on it;  priced  the walk's own break prices protect it;  liquid  water or lava touches it
 *   digMs     the dig's time with the tool in hand
 */
export function verdictFor (r, { name = null, above = null, body = false, priced = false, liquid = false, harvest = true, digMs = 0 } = {}, T = TAKEBACK) {
  if (name == null) return { act: 'deferred', why: 'unread' }
  if (name !== r.block) return { act: 'adopted', why: AIRY(name) ? 'gone' : 'changed' }
  if (above != null && !AIRY(above)) return { act: 'adopted', why: 'built_on' }
  if (above == null) return { act: 'deferred', why: 'unread' }
  if (priced) return { act: 'adopted', why: 'protected' }
  if (liquid) return { act: 'adopted', why: 'liquid' }
  if (body) return { act: 'deferred', why: 'body' }
  // a dig the held tool cannot harvest is one skills.mjs's dig watcher stops the WALK for (watchDigging): never started
  if (!harvest) return { act: 'left', why: 'no_tool' }
  if (!(digMs <= T.digMsMax)) return { act: 'left', why: 'slow' }
  return { act: 'dig', why: 'ripe' }
}
/** The order ripe receipts are taken in: the highest first (a tower comes down from its top), then the oldest. Pure. */
export const takeOrder = list => [...list].sort((a, b) => b.cell[1] - a.cell[1] || a.t - b.t)
/** May the watcher halt the walk now? -> bool. Pure. halts: this goto's count; recent: the halt times of the last minute. */
export function mayHalt ({ halts = 0, recent = [], now = 0, building = false, mining = false, survival = false, health = 20 } = {}, T = TAKEBACK) {
  if (building || mining || survival) return false
  if (!(health >= T.minHealth)) return false
  if (halts >= T.haltsPerGoto) return false
  return recent.filter(t => now - t < 60_000).length < T.haltsPerMin
}
/** Was this goto issued by an escape (a reflex's own walk)? -> bool. Pure. frames: the call stack's lines. */
export const issuedByEscape = frames => (frames ?? []).some(f => /\/src\/(reflex|escape|floodpocket|climbflood)\.mjs/.test(String(f)))
/** Does a reflex hold the body now? -> bool. Pure. ctx: digtown's context { reflex, holder, skill } (digtown.mjs digPurpose's rule). */
export const bodyHeld = ctx => !!(ctx && (ctx.reflex || (ctx.holder && ctx.holder !== ctx.skill)))
/** The `_takeback` row's detail. Pure. */
export function takebackDetail ({ outcome, why = '-', cell, block = '-', shape = '-', zone = null, age = 0, ms = null } = {}) {
  return `outcome=${outcome} why=${why} pos=${cell.join(',')} block=${block} shape=${shape} zone=${zone ?? 'out'} age_ms=${Math.round(age)}${ms == null ? '' : ` ms=${Math.round(ms)}`}`
}
export const emptySum = () => ({ noted: 0, halts: 0, ms: 0, by: {} })
/** The `_takeback_sum` row's detail. Pure. */
export function sumDetail (sum, windowS, open) {
  const rest = Object.entries(sum.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('; ')
  return `w=${windowS}s noted=${sum.noted} halts=${sum.halts} ms=${Math.round(sum.ms)} open=${open}${rest ? ` | ${rest}` : ''}`
}
const gotoError = name => Object.assign(new Error(name === 'PathStopped' ? 'Path was stopped before it could be completed! Thus, the desired goal was not reached.' : 'The goal was changed before it could be completed!'), { name })

/**
 * Install on one bot -> { note, state, final } | null (off, no pathfinder, or already installed). Never throws into the caller.
 *   emit(kind, status, detail)   one row;  now()  the clock;  timers  false in tests (no summary timer)
 *   onLeft(receipt, why)         litter-01: called for every receipt that closes `left` (expired, unseen, overflow, slow, no_tool)
 * `note(rec)` is placeaudit's `onPlaced`: a placement that landed.
 */
export function installTakeback (bot, { emit = () => {}, now = () => Date.now(), env = process.env, T = TAKEBACK, timers = true, onLeft = null } = {}) {
  const on = takebackOn(env)
  try { emit('takeback_mode', 'success', `phase=mode v=1 on=${on ? 1 : 0} reach=${T.reach} unused_ms=${T.unusedMs} halts=${T.haltsPerGoto}/${T.haltsPerMin} budget_ms=${T.budgetMs} reuse_ms=${T.reuseMs}`) } catch { /* telemetry */ }
  const pf = bot?.pathfinder
  if (!on || !pf || typeof pf.goto !== 'function' || pf.goto.__takeback) return null
  const st = { open: [], busy: false, digger: null, owner: null, recent: [], taken: new Map(), sum: emptySum(), winStart: now(), closed: false }
  const row = (r, outcome, why, ms = null) => {
    r.closed = true
    st.sum.by[outcome] = (st.sum.by[outcome] ?? 0) + 1
    try { emit('takeback', outcome === 'dug' ? 'success' : outcome === 'failed' ? 'failed' : 'no_effect', takebackDetail({ outcome, why, cell: r.cell, block: r.block, shape: r.shape, zone: r.zone, age: now() - r.t, ms })) } catch { /* telemetry */ }
    // litter-01 (`onLeft`): a receipt that closes `left` is handed on with its cell and its block (litter.mjs: the cleanup crew's)
    if (outcome === 'left' && onLeft) { try { onLeft(r, why) } catch { /* the hand-off never breaks a walk */ } }
  }
  const prune = () => {
    const t = now()
    for (const r of st.open) if (!r.closed && t - r.t > T.ttlMs) row(r, 'left', 'expired')
    st.open = st.open.filter(r => !r.closed)
    while (st.open.length > T.maxOpen) row(st.open.shift(), 'left', 'overflow')
    for (const [k, at] of st.taken) if (t - at > T.reuseMs) st.taken.delete(k)
  }
  const note = rec => {
    try {
      if (st.closed || !receiptFor(rec, T)) return
      const r = { cell: rec.cell.slice(), block: rec.block, shape: rec.shape ?? '-', zone: rec.zone ?? null, t: now(), used: false, tries: 0, closed: false }
      st.sum.noted++
      // placed again where it was just taken back: this walk needs it there (the loop's bound)
      if (st.taken.has(K(r.cell))) { st.taken.delete(K(r.cell)); row(r, 'kept', 'reuse'); return }
      st.open = st.open.filter(o => K(o.cell) !== K(r.cell))
      st.open.push(r)
      prune()
    } catch { /* a receipt never breaks a placement */ }
  }
  const here = () => {
    const e = bot.entity
    if (!e?.position) return null
    return { pos: e.position, feet: feetOf(e.position), onGround: !!e.onGround, inWater: !!e.isInWater }
  }
  const blockAt = c => { try { return bot.blockAt(new Vec3(c[0], c[1], c[2])) } catch { return null } }
  const sees = b => { try { return typeof bot.canSeeBlock !== 'function' || !!bot.canSeeBlock(b) } catch { return false } }
  const bodyOn = c => {
    for (const e of Object.values(bot.entities ?? {})) {
      const p = e?.position
      if (!p || e === bot.entity) continue
      if (overlapsColumn(c, p, Math.max(HALF_BODY, (Number(e.width) || 0) / 2)) && p.y >= c[1] + 0.5 && p.y <= c[1] + 3) return true
    }
    return false
  }
  const priced = b => {
    for (const fn of pf.movements?.exclusionAreasBreak ?? []) { try { if (fn(b) > 0) return true } catch { return true } }
    return false
  }
  const ripeNow = h => takeOrder(st.open.filter(r => ripe(r, h, now(), T)))
  const held = () => { try { return bodyHeld(bot.__digContext?.()) } catch { return false } }
  const wet = c => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]].some(d => holdsLiquid(blockAt([c[0] + d[0], c[1] + d[1], c[2] + d[2]])))
  const mark = h => { for (const r of st.open) if (!r.used && overCell(r.cell, h.pos)) r.used = true }

  /** One ripe receipt: closed with its row, or left open for a later pass. -> true when it took a turn (a dig or a closing). */
  const closeOne = async (r, ext) => {
    const b = blockAt(r.cell)
    if (b && r.block === b.name && !sees(b)) { r.tries++; if (r.tries > T.tries) row(r, 'left', 'unseen'); return false }
    const up = blockAt([r.cell[0], r.cell[1] + 1, r.cell[2]])
    let digMs = 0, harvest = true
    if (b && b.name === r.block) {
      try { const tool = pf.bestHarvestTool?.(b) ?? null; if (tool) await bot.equip(tool, 'hand') } catch { /* by hand */ }
      try { digMs = Number(bot.digTime?.(b)) || 0 } catch { digMs = 0 }
      try { if (typeof b.canHarvest === 'function') harvest = !!b.canHarvest(bot.heldItem ? bot.heldItem.type : null) } catch { harvest = true }
    }
    const v = verdictFor(r, { name: b?.name ?? null, above: up?.name ?? null, body: bodyOn(r.cell), priced: !!b && priced(b), liquid: wet(r.cell), harvest, digMs }, T)
    if (v.act === 'deferred') { r.tries++; if (r.tries > T.tries) row(r, 'deferred', v.why); return false }
    if (v.act !== 'dig') { row(r, v.act, v.why); return true }
    if (ext()) return false
    const t0 = now()
    try {
      await withDigScope(bot, { purpose: 'takeback', by: 'takeback' }, () => bot.dig(b))
      const after = blockAt(r.cell)
      if (after && AIRY(after.name)) { st.taken.set(K(r.cell), now()); row(r, 'dug', 'ripe', now() - t0) } else { r.tries++; if (r.tries > T.tries) row(r, 'failed', 'still_there', now() - t0) }
    } catch (e) {
      r.tries++
      if (!ext() && r.tries > T.tries) row(r, 'failed', String(e?.message ?? e).replace(/\s+/g, '_').slice(0, 40), now() - t0)
    }
    return true
  }
  /** Take back what is ripe for one call. Ends at once when someone else ends the walk (call.gone) or a newer goto owns the body. */
  const takeBack = async call => {
    const t0 = now()
    st.busy = true; st.digger = call
    try {
      for (let guard = 0; guard < T.maxOpen && !call.gone && st.owner === call && now() - t0 < T.budgetMs; guard++) {
        const h = here()
        if (!h || held() || !((bot.health ?? 20) >= T.minHealth)) break
        const next = ripeNow(h).find(r => !r.skip)
        if (!next) break
        if (!(await closeOne(next, () => !!call.gone || st.owner !== call || held()))) next.skip = true
      }
    } catch { /* a take-back never breaks a walk */ } finally {
      for (const r of st.open) delete r.skip
      st.busy = false; st.digger = null; st.sum.ms += now() - t0
      prune()
    }
  }
  const watch = (call, goal) => {
    const survival = call.escape || currentDigScope()?.purpose === 'survival'
    const iv = setInterval(() => {
      try {
        const h = here()
        if (!h) return
        mark(h)
        // only a fenced walk (rule 1), only while it is still the newest goto and nobody ended it (rule 2), only its own goal (rule 3)
        if (call.due || st.busy || !call.fenced || call.gone || st.owner !== call || pf.goal !== goal) return
        if (!T.profiles.includes(String(bot.movementProfile ?? 'walk'))) return
        if (!mayHalt({ halts: call.n, recent: st.recent, now: now(), building: !!pf.isBuilding?.(), mining: !!pf.isMining?.(), survival: survival || held(), health: bot.health ?? 20 }, T)) return
        const due = ripeNow(h).find(r => { const b = blockAt(r.cell); return !b || b.name !== r.block || sees(b) })
        if (!due) return
        call.n++; st.sum.halts++; st.recent = [...st.recent.filter(t => now() - t < 60_000), now()]
        call.due = true
        // our own halt: ONE goal_updated(null), emitted synchronously inside setGoal, is the one ending that is not someone else's
        call.own = 1
        try { haltPath(bot) } finally { call.own = 0 }
      } catch { /* the watcher never breaks a walk */ }
    }, T.tickMs)
    iv.unref?.()
    return () => clearInterval(iv)
  }
  const orig = pf.goto
  const run = async (self, call, goal, rest) => {
    // heard for the WHOLE call (rule 2): the library's own setGoal(goal) at each issue names this goal and is not an ending
    const onGoal = ng => {
      if (call.own > 0 && ng === null) { call.own--; return }       // exactly one: a nested setGoal or haltPath inside it still counts
      if (ng !== goal) call.giveUp('GoalChanged')
    }
    const onStop = () => call.giveUp('PathStopped')                 // never ours: pathhalt never stops, so this is a stop() of someone else's
    bot.on('goal_updated', onGoal); bot.on('path_stop', onStop)
    try {
      for (;;) {
        call.due = false
        const stop = watch(call, goal)
        let err = null, res
        try { res = await orig.call(self, goal, ...rest) } catch (e) { err = e } finally { stop() }
        if (!call.due) { if (err) throw err; return res }
        call.due = false
        await takeBack(call)
        if (!err) return res                                        // it arrived as the halt landed: nothing to walk on to
        if (call.gone) throw gotoError(call.gone)                   // the caller ended the walk meanwhile: its own error
        if (st.owner !== call) throw gotoError('GoalChanged')       // a newer goto owns the body
      }
    } finally {
      bot.removeListener('goal_updated', onGoal); bot.removeListener('path_stop', onStop)
      if (st.owner === call) st.owner = null
    }
  }
  const wrapped = function (goal, ...rest) {
    if (st.closed) return orig.call(this, goal, ...rest)
    const call = { n: 0, due: false, own: 0, gone: null, fenced: false, escape: false }
    // THE CALLER GAVE UP (skills.mjs withTimeout's timer; the listeners above): never walked again, a dig under way is stopped
    call.giveUp = why => { call.gone ??= (why === 'PathStopped' ? 'PathStopped' : 'GoalChanged'); try { if (st.busy && st.digger === call) bot.stopDigging?.() } catch { /* not digging */ } }
    try { call.escape = issuedByEscape(String(new Error().stack ?? '').split('\n').slice(1, 8)) } catch { /* unknown: a walk */ }
    st.owner = call                                                 // the newest goto is the one walk that is watched
    const p = run(this, call, goal, rest)
    p.__takeback = call                                             // withTimeout fences it (rule 1)
    return p
  }
  wrapped.__takeback = true
  pf.goto = wrapped
  const flush = () => {
    if (!st.sum.noted && !st.sum.halts && !Object.keys(st.sum.by).length) { st.winStart = now(); return }
    try { emit('takeback_sum', 'success', sumDetail(st.sum, Math.round((now() - st.winStart) / 1000), st.open.length)) } catch { /* telemetry */ }
    st.sum = emptySum(); st.winStart = now()
  }
  let timer = null
  if (timers) { timer = setInterval(flush, T.sumMs); timer.unref?.() }
  const final = () => { if (st.closed) return; flush(); st.closed = true; if (timer) clearInterval(timer) }
  return { note, state: st, flush, final, takeBack }
}
