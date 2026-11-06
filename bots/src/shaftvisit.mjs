// ONE TOWN-STAIR BUILD VISIT (shaft-02; docs/reports/mineshaft-2026-10-30/design.md section 5). Every effect is injected, so the
// loop runs on a fake world in the tests and on mineflayer through skills.mjs (botBuildEffects' server-witnessed digs and
// acknowledged clicks); the code the tests prove is the code the bots run. Progress is the WORLD: every unit re-reads it.
//
// THE LOOP: the first thing not done, top down (shaftgeom.mjs firstUndone: a step, a stub column, or damage above the
// frontier -- repairs are the same scan) -> walk to its stand on the stair already verified -> its mutations one at a time in
// the safety order (nextOp: survey, lining, tread, air top down) -> again. A landing whose stub is done is published. A liquid
// in an air or tread cell ends the stair above it (onStop: the truncated record). Bounded by the deadline, a unit count, the
// slot lease (fence), the pickaxe and the bag; two refusals of one cell end the visit. The visit ends where the work stopped
// (the stair it just verified is the way out; surface and mine use it).
import { Vec3 } from 'vec3'
import { firstUndone, unitCells, standFor, nextOp, planOf, toWorld, supportFor, supportChain, LANDING_CELL, TORCH_EVERY, PILLAR, LINING_ITEMS, isFull, standOf, stairStepAt, egressNext, EGRESS_CLEARS_MAX, descentNext, isWet as wetCell } from './shaftgeom.mjs'
import { withDigScope } from './digtown.mjs'

export const UNITS_MAX = 40
export const CELL_TRIES = 2
export const SUPPORT_TRIES = 3   // stuckcells-01: support chains tried for one cell in a visit
// stuckcells-01's switch (stuckcells.mjs stuckCellsOn, inlined: the tests import copies of this module)
const stuckCellsOn = () => !['off', '0', 'false', 'no'].includes(String(process.env.STUCKCELLS ?? '').trim().toLowerCase())
const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
const kOf = a => a.join(',')

/**
 * -> { stop, why, k, placed, dug, units, landings: [feet published], torches }. `p` = { rec, exit, built: Set(feet),
 * onLanding(feet) -> Promise<bool>, onStop(k, why) -> Promise<void>, onDropLanding(feet, why) -> Promise<void> }. `e` = { read, feet() -> [x,y,z], walkTo(cell) ->
 * Promise<bool>, dig(cell) -> Promise<'confirmed'|...>, place(cell) -> Promise<'confirmed'|'no_material'|'no_support'|'no_reach'|
 * 'refused'>, toolOk() -> bool, fence() -> bool, torch?(cell, support) -> Promise<bool>, log(op, d), now(), aborted() }.
 */
export async function runStairVisit (p, e, { deadline = Infinity, unitsMax = UNITS_MAX, reserve = null } = {}) {
  const plan = planOf(p.rec)
  const built = p.built ?? new Set(p.rec.landings_built ?? [])
  const out = { stop: null, why: null, k: null, placed: 0, dug: 0, units: 0, landings: [], torches: 0 }
  const fails = new Map()
  const torched = new Set()
  const supported = new Set()
  const end = (stop, why = null, k = null) => { out.stop = stop; out.why = why; out.k = k; return out }
  for (;;) {
    if (e.aborted()) { const err = new Error('aborted'); err.aborted = true; throw err }
    if (e.now() >= deadline) return end('time')
    if (!e.fence()) return end('lease')
    const w = firstUndone(e.read, plan)
    // LANDINGS ABOVE THE WORK POINT ARE DONE: publish each one not yet published (a record generation per landing)
    for (const l of plan.landings) {
      if (built.has(l.feet) || (w && w.k <= l.k)) continue
      if (await p.onLanding(l.feet)) { built.add(l.feet); out.landings.push(l.feet); e.log('landing', { k: l.k, feet: l.feet }) }
    }
    if (!w) return end('complete')
    if (w.kind === 'unknown') return end('unknown', 'an unloaded or unread cell', w.k)
    // shafttrap-01: A UNIT IS STARTED ONLY WITH THE WAY OUT STILL IN THE BUDGET (shaftgeom.mjs egressReserveMs: the deeper the work,
    // the earlier it stops), so the visit's egress up the stair runs inside the skill's own time
    if (typeof reserve === 'function' && e.now() >= deadline - (Number(reserve(w.k)) || 0)) return end('time', 'the way out is kept', w.k)
    if (out.units >= unitsMax) return end('units', null, w.k)
    // WALK TO THE STAND: step k-1's (every step above is verified, so the walk is on the stair), the collar exit for step 0
    // shaft-03: step 0 from a ground cell beside it (step0Stand), not the exit two cells out (LIVE: `no_reach` on its tread)
    const stand = standFor(plan, w, p.exit, e.read)
    if (!stand) return end('no_stand', 'no collar exit', w.k)
    if (!same(e.feet(), stand)) {
      await e.walkTo(stand)
      // stairuse-01: THE LONG WALK FAILED (LIVE 7 d: 1,001 of 2,921 visits `walk_failed`) -> down the stair a few stands at a time
      // to the stand's own step (e.descend: runStairDescent, which digs a foreign block out of the air cells on the way), then
      // the stand once more. The stand is a step's stand on the stair the scan verified above the work; any other stand (the
      // collar's ground beside step 0) keeps the one walk
      if (!same(e.feet(), stand) && typeof e.descend === 'function') {
        const sk = plan.steps.findIndex((q, k) => same(standOf(plan, k), stand))
        if (sk >= 0) { await e.descend(sk); if (!same(e.feet(), stand)) await e.walkTo(stand) }
      }
      if (!same(e.feet(), stand)) return end('walk_failed', `did not reach ${kOf(stand)} (at ${kOf(e.feet())})`, w.k)
    }
    const cells = unitCells(plan, w)
    for (let guard = 0; guard < 64; guard++) {
      if (e.aborted()) { const err = new Error('aborted'); err.aborted = true; throw err }
      if (e.now() >= deadline) return end('time', null, w.k)
      if (!e.fence()) return end('lease', null, w.k)
      const op = nextOp(e.read, plan, cells, e.feet())
      if (op.op === 'done') break
      if (op.op === 'wait') return end('unknown', `unread ${kOf(op.at)}`, w.k)
      if (op.op === 'stop') {
        if (op.why === 'water' || op.why === 'lava') {
          // A LIQUID WHERE THE STAIR WOULD OPEN: it ends above it (the truncated record), never dug into
          if (w.kind === 'step') { await p.onStop(w.k, op.why); e.log('stop', { k: w.k, at: op.at, why: op.why }); return end('stopped', op.why, w.k) }
          // in a stub: THAT LANDING is dropped from the record (the steps go on below it); the next visit plans without it
          await p.onDropLanding(w.landing.feet, op.why); e.log('stop', { k: w.k, at: op.at, why: `stub_${op.why}`, feet: w.landing.feet }); return end('landing_dropped', `stub_${op.why}`, w.k)
        }
        return end(op.why, null, w.k)
      }
      const key = kOf(op.at)
      let r
      if (op.op === 'place') {
        r = await e.place(op.at)
        // shaft-03: NOTHING TO CLICK AGAINST (a cell over a cave pocket): place a support beside it first (supportFor), then the
        // cell itself on the next pass -- once per cell; a support that does not take leaves the refusal as it was
        if (r === 'no_support' && !supported.has(key)) {
          supported.add(key)
          if (stuckCellsOn()) {
            // stuckcells-01: a CHAIN of up to CHAIN_MAX supports (supportChain: the first against a block that stands, each next
            // against the one before), every placement NAMED -- LIVE hive-a 31 h `no_support` with the support's outcome never logged
            // a support the server does not take is excluded and the next chain tried (at most SUPPORT_TRIES chains a cell)
            const exclude = new Set()
            let ok = false
            for (let tr = 0; tr < SUPPORT_TRIES && !ok; tr++) {
              const chain = supportChain(e.read, plan, op.at, e.feet(), { exclude, isRef: b => isFull(b) && !INTERACTABLE.test(b?.name ?? '') })
              if (!chain) { e.log('refused', { k: w.k, at: op.at, why: tr ? 'support:no_other_chain' : 'support:no_chain' }); break }
              let laid = 0
              for (const sc of chain) {
                const sr = await e.place(sc)
                if (sr !== 'confirmed') { exclude.add(kOf(sc)); e.log('refused', { k: w.k, at: sc, why: `support:${sr}` }); break }
                laid++; out.placed++; e.log('place', { k: w.k, at: sc, why: laid > 1 ? `support${laid}` : 'support' })
              }
              ok = laid === chain.length
            }
            if (ok) continue
          } else {
            const sup = supportFor(e.read, plan, op.at, e.feet())
            if (sup && (await e.place(sup)) === 'confirmed') { out.placed++; e.log('place', { k: w.k, at: sup, why: 'support' }); continue }
          }
        }
        if (r === 'confirmed') { out.placed++; e.log('place', { k: w.k, at: op.at, why: op.why }) }
        else if (r === 'no_material') return end('no_material', 'no lining blocks in the bag (cobblestone)', w.k)
      } else {
        if (!e.toolOk()) return end('no_pickaxe', 'no pickaxe with uses left', w.k)
        r = await e.dig(op.at)
        if (r === 'confirmed') { out.dug++; e.log('dig', { k: w.k, at: op.at, why: op.why }) }
      }
      if (r !== 'confirmed') {
        const n = (fails.get(key) ?? 0) + 1
        fails.set(key, n)
        e.log('refused', { k: w.k, at: op.at, why: `${op.op}:${r}` })
        if (n >= CELL_TRIES) return end(op.op === 'place' ? (r === 'no_support' || r === 'no_reach' ? r : 'place_refused') : 'dig_refused', `${op.op} ${key}: ${r}`, w.k)
      }
    }
    out.units++
    // ONE TORCH A TURN on the pillar, at the head of each step on the landing cell (never required: a failure is only a row)
    if (w.kind === 'step' && e.torch && (plan.s0 + w.k) % 8 === LANDING_CELL && w.k >= TORCH_EVERY && !torched.has(w.k)) {
      torched.add(w.k)
      const head = plan.steps[w.k].air[1]
      const pil = toWorld(plan.origin, plan.away, PILLAR[0], PILLAR[1])
      try { if (await e.torch(head, [pil.x, head[1], pil.z])) out.torches++ } catch (err) { if (err?.aborted) throw err }
    }
  }
}

// ---- the way out (shafttrap-01) -------------------------------------------------------------------------------------------

/**
 * WALK THE STAIR UP TO THE COLLAR FROM WHERE THE BOT STANDS (shafttrap-01; shaftgeom.mjs's egress block says why) -> { ok, why,
 * from, to, hops, cleared }. Every effect is injected (the tests run it on a fake world; skills.mjs buildStair on mineflayer).
 * `e` = { read (a fresh reader per get), feet() -> [x,y,z], walkTo(cell) -> Promise<bool arrived>, dig(cell) -> Promise<'confirmed'
 * |...>, occupied?(cell) -> bool (a body stands on the cell: never dug), now(), aborted(), log?(op, d) }. The bot's step (stairStepAt; a landing stub walks back to its step first), then
 * egressNext until step 0: a hop of up to EGRESS_HOP stands (one stand if that walk fails), or a dig of a foreign block in one
 * of the stair's own air cells within a step (two refusals of one cell end it), then the collar exit. ok only on arrival at
 * the exit (or a bot not under the collar: 'surface'). Bounded by the deadline, the clears and a step count.
 *   why  surface | arrived | off_stair | time | hop | via | dig_refused | clears | occupied | wet | tread | unknown | exit_walk | no_exit
 */
export async function runStairEgress (plan, e, { exit = null, deadline = Infinity, clearsMax = EGRESS_CLEARS_MAX } = {}) {
  const out = { ok: false, why: null, from: null, to: null, hops: 0, cleared: 0 }
  const end = (ok, why, to = null) => { out.ok = ok; out.why = why; out.to = to; e.log?.('egress', out); return out }
  const abortIf = () => { if (e.aborted()) { const err = new Error('aborted'); err.aborted = true; throw err } }
  const feet0 = e.feet()
  if (!plan || !Array.isArray(feet0)) return end(false, 'off_stair')
  // AT OR ABOVE THE COLLAR (step 0's feet is ground + 1): nothing to climb
  if (feet0[1] >= plan.g + 1) return end(true, 'surface')
  const at = stairStepAt(plan, feet0)
  if (!at) return end(false, 'off_stair')
  out.from = at.k
  for (const c of at.via) {
    abortIf()
    if (e.now() >= deadline) return end(false, 'time', at.k)
    if (!(await e.walkTo(c))) return end(false, 'via', at.k)
  }
  let i = at.k
  const fails = new Map()
  for (let guard = 0; guard < 4 * plan.steps.length + 16; guard++) {
    abortIf()
    if (e.now() >= deadline) return end(false, 'time', i)
    const f = e.feet()
    const op = egressNext(e.read, plan, i, [f, [f[0], f[1] + 1, f[2]]])
    if (op.op === 'done') break
    if (op.op === 'stop') return end(false, op.why, i)
    if (op.op === 'dig') {
      if (out.cleared >= clearsMax) return end(false, 'clears', i)
      // NEVER DIG FROM UNDER A BODY (Codex r1 blocker 2): the foreign block may be another bot's pillar top -- or this bot's own
      // floor; asked of the live entities at the moment of the dig. A bot standing on it is in the way of the hop as well
      if (e.occupied?.(op.at)) return end(false, 'occupied', i)
      const key = op.at.join(',')
      const r = await e.dig(op.at)
      if (r === 'confirmed') { out.cleared++; e.log?.('egress_dig', { k: op.k, at: op.at }); continue }
      const n = (fails.get(key) ?? 0) + 1
      fails.set(key, n)
      if (n >= 2) return end(false, 'dig_refused', i)
      continue
    }
    // a hop: up to EGRESS_HOP stands, then one; arrival is the stand reached (re-read from the feet, never assumed)
    let moved = false
    for (const to of op.to < i - 1 ? [op.to, i - 1] : [op.to]) {
      if (await e.walkTo(standOf(plan, to))) {
        const now = stairStepAt(plan, e.feet())
        if (now && now.k < i) { i = now.k; out.hops++; moved = true; break }
      }
      abortIf()
    }
    if (!moved) return end(false, 'hop', i)
  }
  if (i !== 0) return end(false, 'hop', i)
  if (!Array.isArray(exit)) return end(false, 'no_exit', 0)
  return (await e.walkTo(exit)) ? end(true, 'arrived', 'exit') : end(false, 'exit_walk', 0)
}

// ---- the way down (stairuse-01) ------------------------------------------------------------------------------------------

/**
 * WALK THE STAIR DOWN TO STEP `to` (and, given `landing`, along its stub to the stand) FROM WHERE THE BOT STANDS -> { ok, why, from,
 * to, hops, cleared }. runStairEgress's mirror (shaftgeom.mjs's stairuse block says why); every effect injected (e as the egress's).
 * From the surface the bot first walks to the collar exit (`exit`); on the stair (stairStepAt; a stub walks back to its step) from
 * its step. Then descentNext until `to`: a hop of up to EGRESS_HOP stands (one stand if that walk fails), or a dig of a foreign block
 * in one of the next step's air cells (two refusals of one cell end it). ok only on arrival (the landing's stand, or step `to`'s).
 *   why  arrived | approach | off_stair | below | time | hop | via | dig_refused | clears | occupied | wet | tread | unknown | stub
 */
export async function runStairDescent (plan, e, { to, landing = null, exit = null, deadline = Infinity, clearsMax = EGRESS_CLEARS_MAX } = {}) {
  const out = { ok: false, why: null, from: null, to: null, hops: 0, cleared: 0 }
  const end = (ok, why, at = null) => { out.ok = ok; out.why = why; out.to = at; e.log?.('descent', out); return out }
  const abortIf = () => { if (e.aborted()) { const err = new Error('aborted'); err.aborted = true; throw err } }
  const feet0 = e.feet()
  if (!plan || !Array.isArray(feet0) || !Number.isInteger(to) || to < 0 || to >= plan.steps.length) return end(false, 'off_stair')
  const at = feet0[1] < plan.g + 1 ? stairStepAt(plan, feet0) : null
  let i
  if (at) {
    out.from = at.k
    if (at.k > to) return end(false, 'below', at.k)
    for (const c of at.via) {
      abortIf()
      if (e.now() >= deadline) return end(false, 'time', at.k)
      if (!(await e.walkTo(c))) return end(false, 'via', at.k)
    }
    i = at.k
  } else {
    // FROM THE SURFACE: the collar exit first (the walk the egress ends with, the other way)
    out.from = 'exit'
    if (!Array.isArray(exit)) return end(false, 'approach', null)
    abortIf()
    if (!(await e.walkTo(exit))) return end(false, 'approach', null)
    i = -1
  }
  const fails = new Map()
  const digIt = async op => {
    if (out.cleared >= clearsMax) return 'clears'
    if (e.occupied?.(op.at)) return 'occupied'
    const key = op.at.join(',')
    const r = await e.dig(op.at)
    if (r === 'confirmed') { out.cleared++; e.log?.('descent_dig', { k: op.k, at: op.at }); return null }
    const n = (fails.get(key) ?? 0) + 1
    fails.set(key, n)
    return n >= 2 ? 'dig_refused' : null
  }
  for (let guard = 0; guard < 4 * plan.steps.length + 16; guard++) {
    abortIf()
    if (e.now() >= deadline) return end(false, 'time', i)
    const f = e.feet()
    const op = descentNext(e.read, plan, i, to, [f, [f[0], f[1] + 1, f[2]]])
    if (op.op === 'done') break
    if (op.op === 'stop') return end(false, op.why, i)
    if (op.op === 'dig') { const w = await digIt(op); if (w) return end(false, w, i); continue }
    let moved = false
    for (const tk of op.to > i + 1 ? [op.to, i + 1] : [op.to]) {
      if (await e.walkTo(standOf(plan, tk))) {
        const now = stairStepAt(plan, e.feet())
        if (now && now.k > i) { i = now.k; out.hops++; moved = true; break }
      }
      abortIf()
    }
    if (!moved) return end(false, 'hop', i)
  }
  if (i !== to) return end(false, 'hop', i)
  if (!landing) return end(true, 'arrived', to)
  // THE LANDING'S STUB: its columns in order (v0 .. v1), a foreign block in one dug from the column before it, then the stand
  for (const col of landing.cols) {
    abortIf()
    if (e.now() >= deadline) return end(false, 'time', to)
    for (const c of col.air) {
      const b = e.read(...c)
      if (!b) return end(false, 'unknown', to)
      if (wetCell(b)) return end(false, 'wet', to)
      if (b.boundingBox === 'empty') continue
      // never a liquid's barrier (the egress's rule): a liquid or an unread cell at any face stops it, nothing dug
      for (const [dx, dy, dz] of N6) { const nb = e.read(c[0] + dx, c[1] + dy, c[2] + dz); if (!nb) return end(false, 'unknown', to); if (wetCell(nb)) return end(false, 'wet', to) }
      const w = await digIt({ at: c, k: landing.k })
      if (w) return end(false, w, to)
      if (e.read(...c)?.boundingBox !== 'empty') return end(false, 'stub', to)
    }
    if (!(await e.walkTo(col.air[0]))) return end(false, 'stub', to)
  }
  return end(true, 'arrived', 'stand')
}

// ---- the stair's body claim -----------------------------------------------------------------------------------------------

/**
 * RUN fn HOLDING THE RUNNER'S 'stair' BODY CLAIM (shaft-03). The entombment reflex reads a bot inside the stair -- its centre over
 * the next step down, rock over that column and on three sides -- as walled in, and pillars OUT. LIVE 10-31 (14 h, 11 towns): 19
 * of the 21 aborted stair visits were that reflex (71 `_entombed` rows inside a stair's box), its pillar laid dirt in the stair's
 * air cells, and board-d's stair read `step5:blocked` for 25 descents. mine's own stair holds this claim for the same reason
 * (skills.mjs mine, 2026-09-11); it quiets that one reflex branch and nothing else (runner.mjs bodyClaimFor is typed). Renewed
 * every `every` ms (the runner drops a claim not renewed within CLAIM_STEP_TTL_MS), released on every exit, and inert without
 * a running skill (claimBody's own rule). -> fn(claim)'s result.
 */
export async function withStairClaim (runner, fn, { every = 20_000 } = {}) {
  const claim = runner?.claimBody?.('stair') ?? null
  const iv = claim ? setInterval(() => { try { claim.renew() } catch { /* inert */ } }, every) : null
  iv?.unref?.()
  try { return await fn(claim) } finally { if (iv) clearInterval(iv); try { claim?.release?.() } catch { /* inert */ } }
}

// ---- the effects on a real bot (skills.mjs buildStair and the Paper driver run the SAME code) ------------------------------

const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const PROPS = /slab|stairs|wall|fence|leaves|lantern|chain|bars|pane|kelp|seagrass|grass|fern|coral|dripstone|lichen|vine|ladder|trapdoor|sign|rail|lever|button|carpet|campfire|candle|pickle|scaffolding|bubble/
const INTERACTABLE = /chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|_bed$|_door$|_trapdoor$|_sign$|^composter$|_fence_gate$/
export const TOOL_MIN = 8
/** The stair's reader over a bot: name, collision class, a waterlogged block's properties, full cube. Memoised for its own life
 *  (one scan or one decision: the visit makes a fresh one after every mutation). */
export function stairRead (bot) {
  const memo = new Map()
  return (x, y, z) => {
    const k = `${x},${y},${z}`
    if (memo.has(k)) return memo.get(k)
    let v = null
    try {
      const b = bot.blockAt(new Vec3(x, y, z))
      if (b) {
        let props = null
        if (PROPS.test(b.name)) { try { props = b.getProperties?.() ?? null } catch { props = null } }
        const sh = b.shapes
        const full = b.boundingBox === 'block' ? (Array.isArray(sh) && sh.length === 1 && sh[0][0] === 0 && sh[0][1] === 0 && sh[0][2] === 0 && sh[0][3] === 1 && sh[0][4] === 1 && sh[0][5] === 1) : false
        v = { name: b.name, boundingBox: b.boundingBox, props, full }
      }
    } catch { v = null }
    memo.set(k, v)
    if (memo.size > 4096) memo.clear()
    return v
  }
}
export const stairItems = bot => bot.inventory?.items?.() ?? []
export const stairLiningCount = bot => stairItems(bot).filter(i => LINING_ITEMS.includes(i.name)).reduce((s, i) => s + (i.count ?? 1), 0)
const usesLeft = it => (Number(it?.maxDurability) || 0) - (Number(it?.durabilityUsed) || 0)
const bestPick = bot => stairItems(bot).filter(i => /_pickaxe$/.test(i.name)).sort((a, b) => usesLeft(b) - usesLeft(a))[0] ?? null
/**
 * THE VISIT'S EFFECTS ON A REAL BOT -> runStairVisit's `e`. `B` = buildbot.mjs botBuildEffects(bot, ...) (the server-witnessed dig,
 * the acknowledged block_place, the scoped walk); a pickaxe (or a shovel for soft blocks) equipped before each dig; a placement
 * clicks the nearest full-cube face within reach (Paper accepts a face the bot cannot see: shaft-01 E2), looks 3 ticks before
 * the click, and is believed only when the cell reads a full cube after the acknowledgement.
 */
export function stairBotEffects (bot, B, { signal = null, fence = () => true, log = () => {} } = {}) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const fresh = () => stairRead(bot)
  const equipFor = async c => {
    const b = bot.blockAt(new Vec3(c[0], c[1], c[2]))
    const soft = /dirt|grass_block|podzol|mycelium|sand|gravel|clay|mud|snow|soul_soil|soul_sand|farmland|dirt_path/.test(b?.name ?? '')
    const it = soft ? (stairItems(bot).find(i => /_shovel$/.test(i.name)) ?? bestPick(bot)) : bestPick(bot)
    if (it && bot.heldItem?.name !== it.name) { try { await bot.equip(it, 'hand') } catch (e) { if (e?.aborted) throw e } }
  }
  const click = async (c, item, accept) => {
    const read = fresh()
    const refs = N6.map(([dx, dy, dz]) => [c[0] + dx, c[1] + dy, c[2] + dz]).filter(r => { const b = read(...r); return isFull(b) && !INTERACTABLE.test(b.name) })
    if (!refs.length) return 'no_support'
    const p = bot.entity.position, eye = { x: p.x, y: p.y + 1.62, z: p.z }
    const opts = refs.map(r => {
      const face = [c[0] - r[0], c[1] - r[1], c[2] - r[2]]
      const pt = { x: r[0] + 0.5 + face[0] * 0.5, y: r[1] + 0.5 + face[1] * 0.5, z: r[2] + 0.5 + face[2] * 0.5 }
      return { r, face, d: Math.hypot(pt.x - eye.x, pt.y - eye.y, pt.z - eye.z) }
    }).filter(o => o.d <= 4.5).sort((a, b) => a.d - b.d)
    if (!opts.length) return 'no_reach'
    if (!(await B.hold(item))) return 'no_material'
    const { r, face } = opts[0]
    await B.look(r, face)
    await sleep(150)
    const seq = B.nextSeq()
    B.send(r, face, seq)
    await B.waitAck(seq, 2_500)
    await sleep(100)
    return accept(fresh()(...c)) ? 'confirmed' : 'refused'
  }
  return {
    get read () { return fresh() },
    feet: () => B.feet(),
    walkTo: async c => { await B.walkTo(c); return true },
    // shafttrap-02 (Codex r1 blocker 2): never an equip or a dig once the signal is aborted (a reflex lost the body to a rescue)
    dig: async c => {
      if (signal?.aborted) return 'aborted'
      await equipFor(c)
      if (signal?.aborted) return 'aborted'
      let v = await withDigScope(bot, { purpose: 'target', by: 'build_stair' }, () => B.dig(c))
      // shafttrap-02 (Paper 11-03): A DIG THE SERVER DID NOT CONFIRM may have left client air over the server's block (memory "ghost
      // blocks are rejected digs"): the egress then hopped into it forever. Ask the server (buildrun.mjs's probe, twice): air confirms,
      // any other name means it stands (and the probe's block update has put it back in the client's world)
      for (let i = 0; v === 'unconfirmed' && typeof B.probe === 'function' && i < 2; i++) {
        if (signal?.aborted) return 'aborted'
        const n = await B.probe(c)
        if (n != null) v = /^(air|cave_air)$/.test(n) ? 'confirmed' : 'standing'
      }
      return v
    },
    place: async c => {
      const item = LINING_ITEMS.find(n => B.has(n))
      if (!item) return 'no_material'
      return click(c, item, b => isFull(b))
    },
    torch: async (cell, support) => {
      if (!B.has('torch')) return false
      if (!isFull(fresh()(...support))) return false
      return (await click(cell, 'torch', b => /torch$/.test(b?.name ?? ''))) === 'confirmed'
    },
    toolOk: () => usesLeft(bestPick(bot)) >= TOOL_MIN,
    fence,
    log,
    now: () => Date.now(),
    aborted: () => !!signal?.aborted,
  }
}
