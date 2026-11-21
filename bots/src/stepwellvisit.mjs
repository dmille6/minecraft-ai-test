// ONE STEPWELL TANK VISIT (stepwell-01; docs/reports/stepwell-design-2026-11-05.md section 5). Every effect is injected, so the loop
// runs on a fake world in the tests and on mineflayer through skills.mjs buildStepwell (botBuildEffects' server-witnessed digs and
// acknowledged clicks); the code the tests prove is the code the bots run. Progress is the WORLD: every step re-reads it.
//
// THE LOOP: the first unit not done, top down (stepwell.mjs firstUndoneUnit: a layer's cuts, faces, tops, posts, lights -- repairs
// are the same scan) -> its next mutation in the safety order (stepwellNext) -> a stand in reach of that cell (standsFor: on what
// stands now, never the cell, its body or its floor) -> the mutation -> again. Lava (or water outside the record) at a cut stops the
// tank where it stands (onStop: the record's `stopped` generation). Bounded by the deadline, an op count, the slot lease (fence), the
// pickaxe and the bag; a cell refused twice, or with no stand, is passed for this visit. THE VISIT ENDS AT THE EXIT: a builder below
// the rim walks out by the flights (the plan's walk proof: every walkable column reaches the rim in steps of 1).
import { Vec3 } from 'vec3'
import { firstUndoneUnit, stepwellNext, standsFor, inReach, SW, tiersDone, cellGood, POST_BLOCK, unitDone, cellDone } from './stepwell.mjs'
import { shareView } from './stepwell.mjs'   // stepwell-05: the crew's sector of a layer
import { asideOn, asideFor, asideRefusal, ASIDE_MS, ASIDE_WALKS } from './stepwell.mjs'   // stepwell-03show: an unreachable cut set aside
import { isFull, isWet } from './shaftgeom.mjs'
import { stairRead, stairItems } from './shaftvisit.mjs'
import { withDigScope } from './digtown.mjs'

export const CELL_TRIES = 2
export const EGRESS_HOP = 6
/** stepwell-05: the share's claims (every slot taken) a visit may make: past it the visit ends `shared` (no loop without an await). */
export const CLAIMS_MAX = 16
/**
 * THE DESCENT'S WAY UP from `feet` -> [stand] (stepwell-02): when the bot stands in the descent (within 1 of a path stand, below the
 * court), every EGRESS_HOP-th stand of the path back to the portal's, then the portal. [] outside the descent. Pure.
 */
export function descentHops (plan, feet) {
  const path = plan?.descent?.path
  if (!path?.length || !feet) return []
  let best = -1, bd = Infinity
  path.forEach((q, i) => { const d = Math.abs(q[0] - feet[0]) + Math.abs(q[2] - feet[2]) + 2 * Math.abs(q[1] - feet[1]); if (d < bd) { bd = d; best = i } })
  if (best < 0 || bd > 3) return []
  const out = []
  for (let i = best - EGRESS_HOP; i > 0; i -= EGRESS_HOP) out.push(path[i])
  out.push(path[0])
  return out
}
const kOf = a => a.join(',')
const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/**
 * -> { stop, why, y, placed, dug, ops, skipped, tiers, aside, passed }. `p` = { rec, plan, onStop(y, why) -> Promise, onTiers?(tiers) -> Promise,
 * exit, share?, aside? }. stepwell-03show `aside`: Map key -> ms, this bot's own set-aside proofs (read at the start: one younger than
 * ASIDE_MS whose cell still passes asideRefusal is set aside without a walk; written when the visit sets one aside); `swAside` (the
 * option, default the SWASIDE switch) off: nothing is set aside. `out.aside`: the cells set aside; `out.passed`: the keys passed. stepwell-05 `share` = { mine(cell) -> bool, claimAll() -> bool (take every other slot's lease; false when another
 * builder holds one), holdsAll() -> bool } (absent: one builder, as before). `e` = { read (a fresh reader per get), feet() -> [x,y,z], walkTo(cell) -> Promise<bool>, dig(cell) -> Promise<'confirmed'|...>,
 * place(cell, role) -> Promise<'confirmed'|'no_material'|'no_support'|'no_reach'|'refused'>, toolOk() -> bool, fence() -> bool,
 * occupied?(cell) -> bool (a player's body stands on the cell: never dug), log(op, d), now(), aborted() }.
 */
export async function runStepwellVisit (p, e, { deadline = Infinity, opsMax = SW.unitOps, lights = () => true, swAside = asideOn() } = {}) {
  const plan = p.plan
  const out = { stop: null, why: null, y: null, placed: 0, dug: 0, ops: 0, skipped: 0, tiers: [], aside: 0, passed: [] }
  const skip = new Set()
  const fails = new Map()
  const banned = new Set()
  // stepwell-03show: the cells this visit proved no walk reaches (key -> why), and the ones it set aside (asideFor)
  const unreach = new Map()
  const aside = new Set()
  const walkFails = new Map()   // key -> walks to its stands that failed this visit (Codex r1: every stand is tried before any proof)
  const setAside = (c, why, y) => {
    const k = kOf(c)
    if (aside.has(k)) return
    aside.add(k); skip.add(k); out.aside++
    try { if (p.aside instanceof Map && why !== 'remembered') p.aside.set(k, e.now()) } catch { /* the proof is this visit's */ }
    e.log('set_aside', { at: c, why, y })
  }
  if (swAside && p.aside instanceof Map) {
    // a proof this bot made within ASIDE_MS, its cell still a cut that can be left (read now): set aside without walking at it again
    const r0 = e.read
    for (const [k, t] of [...p.aside]) {
      if (!(Number.isFinite(t) && e.now() - t < ASIDE_MS)) { p.aside.delete(k); continue }
      const c = k.split(',').map(Number)
      if (asideRefusal(r0, plan, c) != null) { p.aside.delete(k); continue }
      setAside(c, 'remembered', c[1])
    }
  }
  let litOff = false
  let shareOff = false   // stepwell-05: no other builder holds a slot -- this visit works whole layers
  // a claim that does not hold (holdsAll false right after claimAll) can never spin the loop: bounded per visit
  let claims = 0
  const claim = () => ++claims <= CLAIMS_MAX && p.share.claimAll()
  const end = (stop, why = null, y = null) => { out.stop = stop; out.why = why; out.y = y; return out }
  // `proof` (stepwell-03show): this refusal proves no walk reaches the cell -- only `no_stand` once every stand is banned, never the
  // bot's own floor; the set-aside's why names a cell whose stands' walks failed `walk_failed`
  const fail = (c, why, proof = false) => {
    const k = kOf(c)
    const n = (fails.get(k) ?? 0) + 1
    fails.set(k, n)
    e.log('refused', { at: c, why })
    if (proof) unreach.set(k, walkFails.get(k) ? 'walk_failed' : why)
    else unreach.delete(k)   // refused for another reason: the cell is reached; it is never set aside this visit
    if (n >= CELL_TRIES) { skip.add(k); out.skipped++; if (!out.passed.includes(k)) out.passed.push(k) }
  }
  const body = async () => {
    for (;;) {
      if (e.aborted()) { const err = new Error('aborted'); err.aborted = true; throw err }
      if (e.now() >= deadline) return end('time')
      if (!e.fence()) return end('lease')
      if (out.ops >= opsMax) return end('ops')
      const read = e.read
      const lit = !!lights() && !litOff
      // stepwell-03show (Codex r1 BLOCKER 2): every set-aside cell is read again before each scan -- one that may no longer be left
      // (it turned to sand, a liquid came beside it, it is unread) is revoked: it holds its layer again (the walks it already failed
      // still count), and the bot's memory of it is dropped; one dug open since is simply done
      for (const k of [...aside]) {
        const why = asideRefusal(read, plan, k.split(',').map(Number))
        if (why == null) continue
        aside.delete(k)
        if (why === 'open') continue
        skip.delete(k); unreach.delete(k)
        try { p.aside?.delete?.(k) } catch { /* the memory is the bot's */ }
        e.log('aside_revoked', { at: k.split(',').map(Number), why })
      }
      const w = firstUndoneUnit(read, plan, { lights: lit, aside })
      if (!w) return end('complete')
      if (w.unknown) return end('unknown', 'an unloaded or unread cell', w.unit.y)
      // stepwell-05: THE CREW -- a tank layer is this builder's sector only (the others' sectors are theirs). Work outside it -- the
      // rest of a layer whose own sector is done, a descent station, a seal in another sector -- only while this builder HOLDS EVERY
      // slot (share.claimAll: the other slots' leases taken, so no builder can join and pick the same cell: Codex r1 BLOCKER 1),
      // re-asked every step (share.holdsAll); else the visit ends `shared`
      if (shareOff && !p.share.holdsAll()) shareOff = false
      let sharing = !!p.share && !shareOff
      if (sharing && w.unit.station) {
        if (!claim()) return end('shared', 'the descent is one builder\'s: another builder holds a slot', w.unit.y)
        shareOff = true; sharing = false
      }
      const unit = sharing ? shareView(w.unit, p.share.mine) : w.unit
      const op = stepwellNext(read, plan, unit, { feet: e.feet(), skip, lights: lit })
      // a SEAL (the survey's: a liquid beside one of this sector's cuts) may name a cell of another sector (Codex r1 BLOCKER 2)
      if (sharing && (op.op === 'place' || op.op === 'dig') && !p.share.mine(op.at)) {
        if (!claim()) return end('shared', `${op.why} at ${kOf(op.at)} is in another builder's sector`, w.unit.y)
        shareOff = true
        continue
      }
      if (op.op === 'done') {
        // only torches left that would not take (Paper 11-05: a torch refused twice held the descent's first station for 40 visits):
        // the torches never hold the work -- this visit goes on without them; a later visit or the repair lays them
        if (lit && unitDone(read, plan, unit, { lights: false, aside }) === true) { litOff = true; e.log('lights_passed', { at: unit.cut[0] ?? unit.tops[0] ?? null, y: w.unit.y }); continue }
        // stepwell-05: this builder's part of the layer is DONE (not passed): the rest is another builder's while one holds a slot,
        // else this visit holds every slot and takes the whole layer (never the next one before this one stands: the order is the safety)
        if (sharing && unitDone(read, plan, unit, { lights: lit, aside }) === true) {
          if (!claim()) return end('shared', 'this builder\'s sector of the layer is done; another builder works the rest', w.unit.y)
          shareOff = true
          continue
        }
        // stepwell-03show: every cell still holding the unit is a cut this visit proved no walk reaches, and one that can neither fall
        // nor flow into the layers below: set aside (a row each), and the next unit is worked -- else the visit ends passed, as before
        // (the lights never hold the work -- litOff above: they are not asked here; the next pass lays or passes them)
        const sa = swAside ? asideFor(read, plan, unit, unreach, { lights: false, aside }) : null
        if (sa) { for (const q of sa) setAside(q.at, q.why, w.unit.y); continue }
        return end('passed', `${out.skipped} cell(s) passed this visit`, w.unit.y)
      }
      if (op.op === 'wait') return end('unknown', `unread ${kOf(op.at)}`, w.unit.y)
      if (op.op === 'stop') {
        // a seal this visit could not make: no dig beside that water this visit; the next visit tries the seal again
        if (op.why === 'unsealed') return end('unsealed', `water at ${kOf(op.at)} not sealed`, w.unit.y)
        await p.onStop(w.unit.y, `${op.why} at ${kOf(op.at)}`)
        e.log('stop', { at: op.at, why: op.why, y: w.unit.y })
        return end('stopped', op.why, w.unit.y)
      }
      // A STAND IN REACH: the bot's own feet when the cell is in reach, else the nearest stand that reaches it (a walk on the town
      // profile: no digs, no scaffold); a cell with no stand, or whose stands all failed, is passed for this visit
      // a cell under the bot's own feet (its floor) or in its body: another stand first (never the one it stands on)
      if (op.own || !inReach(e.feet(), op.at, SW.standReach)) {
        const st = standsFor(read, plan, op.at, { feet: e.feet(), banned: op.own ? new Set([...banned, kOf(e.feet())]) : banned })
        // the bot's OWN floor or body with no other stand is reached (it stands there): never a proof for the set-aside
        if (!st.length) { fail(op.at, 'no_stand', !op.own); fail(op.at, 'no_stand', !op.own); continue }
        const ok = await e.walkTo(st[0])
        if (!ok || !same(e.feet(), st[0])) {
          banned.add(kOf(st[0]))
          // stepwell-03show (Codex r1 BLOCKER 1): with the set-aside on, a failed walk is no proof while the cell has stands not yet
          // tried -- the next stand is walked at (at most ASIDE_WALKS a cell); when none is left, the no-stand branch above proves it
          if (swAside && !op.own) {
            const nw = (walkFails.get(kOf(op.at)) ?? 0) + 1
            walkFails.set(kOf(op.at), nw)
            if (nw < ASIDE_WALKS) { e.log('refused', { at: op.at, why: 'walk_failed' }); continue }
          }
          fail(op.at, 'walk_failed'); continue
        }
        // the walk took time and the world moved: decide again from the new stand
        continue
      }
      out.ops++
      if (op.op === 'dig') {
        if (!e.toolOk()) return end('no_pickaxe', 'no pickaxe with uses left', w.unit.y)
        // ANOTHER BODY ON THE CELL (a player standing on it): never dug from under it (Codex r1 BLOCKER 2); passed after two tries
        if (e.occupied?.(op.at)) { fail(op.at, 'occupied'); continue }
        const r = await e.dig(op.at)
        if (r === 'confirmed') { out.dug++; e.log('dig', { at: op.at, kind: op.kind, why: op.why, y: w.unit.y }) } else fail(op.at, `dig:${r}`)
      } else {
        // stepwell-04show: the unit's tops still owed ride with every placement (pickPlaceItem: a face or an under never takes the
        // stone those tops need while another stone will do)
        const r = await e.place(op.at, op.role, { topsOwed: topsOwedIn(read, plan, unit) })
        if (r === 'confirmed') { out.placed++; e.log('place', { at: op.at, role: op.role, why: op.why, y: w.unit.y }) } else if (r === 'no_material') { out.role = op.role; return end('no_material', `no ${op.role} block in the bag`, w.unit.y) }
        else fail(op.at, `place:${r}`)
      }
    }
  }
  try { await body() } finally {
    // THE WAY OUT: a builder below the rim walks to the exit (the flights are every stage's way in and out); never after an abort.
    // stepwell-02: a builder in the DESCENT walks it up first, a few stands at a time (descentHops: the stair's hop walk), to the portal
    try {
      const f = e.feet()
      if (!e.aborted() && p.exit && f && f[1] <= plan.g && e.now() < deadline + 15_000) {
        let okUp = true
        for (const hop of descentHops(plan, f)) {
          if (e.aborted() || e.now() >= deadline + 60_000) break
          okUp = await e.walkTo(hop)
          if (!okUp) break
        }
        const okOut = okUp && await e.walkTo(p.exit)
        e.log('egress', { at: p.exit, why: okOut ? 'out' : 'walk_failed' })
      }
    } catch (err) { if (err?.aborted || e.aborted()) throw err }
  }
  try {
    out.tiers = tiersDone(e.read, plan)
    if (p.onTiers && out.tiers.length) await p.onTiers(out.tiers)
  } catch (err) { if (err?.aborted || e.aborted()) throw err }
  return out
}

// ---- the effects on a real bot (skills.mjs buildStepwell and the Paper driver run the SAME code) ------------------------------

const N6 = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]
const INTERACTABLE = /chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|_bed$|_door$|_trapdoor$|_sign$|^composter$|_fence_gate$/
const STONE = ['cobblestone', 'cobbled_deepslate', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'deepslate']
/** The items a role is placed with, best first: the record's palette, then the town's common stone. Pure. */
export function itemsFor (role, palette = {}) {
  const P = k => (Array.isArray(palette?.[k]) ? palette[k] : [])
  switch (role) {
    case 'floor': return [...new Set([...P('floor'), 'stone_bricks', 'cobblestone'])]
    case 'trim': return [...new Set([...P('trim'), 'stone_bricks', 'cobblestone'])]
    case 'wall': return [...new Set([...P('wall'), ...STONE, 'stone_bricks'])]
    case 'post': return [...new Set([...P('post'), 'cobblestone_wall', 'mossy_cobblestone_wall', 'stone_brick_wall'])]
    case 'light': case 'dlight': return [...new Set([...P('light'), 'torch', 'lantern'])]
    default: return [...STONE, 'dirt']   // body, under, seal
  }
}
const usesLeft = it => (Number(it?.maxDurability) || 0) - (Number(it?.durabilityUsed) || 0)
const bestPick = bot => stairItems(bot).filter(i => /_pickaxe$/.test(i.name)).sort((a, b) => usesLeft(b) - usesLeft(a))[0] ?? null
export const TOOL_MIN = 8
/**
 * THE TANK VISIT'S EFFECTS ON A REAL BOT -> runStepwellVisit's `e`. `B` = buildbot.mjs botBuildEffects(bot, ...) (the server-witnessed
 * dig, the acknowledged block_place, the scoped walk). A placement holds the role's first item the bag has (itemsFor), clicks the
 * nearest face in reach of a full neighbour -- a LIGHT may also click the TOP of the wall post under it -- and is believed only when the
 * cell reads its role's block after the acknowledgement (a seal: no longer a liquid). `walk(cell, ms)` -> arrived (skills.mjs
 * stairWalk: the town-deposit profile, no digs, no scaffold).
 */
export function stepwellBotEffects (bot, B, { palette = {}, signal = null, fence = () => true, log = () => {}, walk, occupied = () => false, keep = null } = {}) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const fresh = () => stairRead(bot)
  const equipFor = async c => {
    const b = bot.blockAt(new Vec3(c[0], c[1], c[2]))
    const soft = /dirt|grass_block|podzol|mycelium|sand|gravel|clay|mud|snow|soul_soil|soul_sand|farmland|dirt_path/.test(b?.name ?? '')
    const it = soft ? (stairItems(bot).find(i => /_shovel$/.test(i.name)) ?? bestPick(bot)) : bestPick(bot)
    if (it && bot.heldItem?.name !== it.name) { try { await bot.equip(it, 'hand') } catch (e) { if (e?.aborted) throw e } }
  }
  const click = async (c, item, accept, role) => {
    const read = fresh()
    // a torch is clicked onto the TOP of what is under it only (Paper 11-05: a side face makes a wall_torch, which the light reads refused)
    const isLight = role === 'light' || role === 'dlight'
    const refOk = (b, r) => !!b && !INTERACTABLE.test(b.name) && (!isLight || r[1] === c[1] - 1) && (isFull(b) || (isLight && POST_BLOCK.test(b.name)))
    const refs = N6.map(([dx, dy, dz]) => [c[0] + dx, c[1] + dy, c[2] + dz]).filter(r => refOk(read(...r), r))
    if (!refs.length) return 'no_support'
    const p = bot.entity.position, eye = { x: p.x, y: p.y + 1.62, z: p.z }
    const opts = refs.map(r => {
      const face = [c[0] - r[0], c[1] - r[1], c[2] - r[2]]
      const pt = { x: r[0] + 0.5 + face[0] * 0.5, y: r[1] + 0.5 + face[1] * 0.5, z: r[2] + 0.5 + face[2] * 0.5 }
      return { r, face, d: Math.hypot(pt.x - eye.x, pt.y - eye.y, pt.z - eye.z) }
    }).filter(o => o.d <= SW.reach).sort((a, b) => a.d - b.d)
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
    walkTo: async c => { const ok = await walk(c); return !!ok },
    dig: async c => { await equipFor(c); return withDigScope(bot, { purpose: 'target', by: 'build_stepwell' }, () => B.dig(c)) },
    place: async (c, role, at = {}) => {
      // stepwell-04show: what is held above the visit's keeps (`keep`, the same map B.has counts above), the unit's owed tops reserved
      const spare = n => (!B.has(n) ? 0 : keep ? stairItems(bot).filter(i => i.name === n).reduce((t, i) => t + (i.count ?? 1), 0) - (Number(keep[n]) || 0) : 1)
      const item = pickPlaceItem(role, palette, spare, { topsOwed: at?.topsOwed ?? 0 })
      if (!item) return 'no_material'
      const accept = role === 'seal' ? b => !!b && !isWet(b) && isFull(b) : b => cellGood(role, b, fresh()(c[0], c[1] - 1, c[2])) === true
      const r = await click(c, item, accept, role)
      if (r === 'confirmed') log('placed_item', { at: c, role, item })
      return r
    },
    toolOk: () => usesLeft(bestPick(bot)) >= TOOL_MIN,
    occupied,
    fence,
    log,
    now: () => Date.now(),
    aborted: () => !!signal?.aborted,
  }
}

// ---- stepwell-04show: THE TANK'S STOCK -----------------------------------------------------------------------------------------
// THE CASE (LIVE showcase 11-21, ES + the town index): every tank visit ended `no trim block in the bag at y 62 -- carry cobblestone`
// and wrote a 6 h stuck stamp. The bag keeps 64 of its stone (towndeposit.mjs townKeeps, cobblestone first, fixed at the visit's start)
// and only blocks ABOVE that keep are placed. Lumen came with 98 cobblestone (34 placeable); the visit crafted 48 of them into
// cobblestone_wall posts and kept 50, all under the keep. The town fetch was skipped while the bag held 48+ of any stone, judged
// BEFORE the craft; the town held 624 stone_bricks and 6,526 cobblestone_wall. THE RULES, each a pure function below:
//   1. posts come from the town's walls first (postsDraw);
//   2. posts are crafted only from cobblestone above BOTH the keep and the next layer's owed tops (postsCraft);
//   3. the top stone (trim + floor) is fetched on what is PLACEABLE (above the keep), after any craft, stone_bricks first (trimFetch);
//      the face stone likewise, cobbled_deepslate first (faceFetch: the stone the town has most of, never the tops' cobblestone);
//   4. a visit that ends without a top block fetches it and goes on (tankWithRemedy); a stamp is written only when the town had none.
// A face, a body or an under never takes the tops' stone while another stone will do (pickPlaceItem).
export const SWSTOCK = Object.freeze({ postsMax: 48, wallsBatch: 6, topMax: 128, faceMin: 48, faceDraw: 64, refetch: 2, refetchMs: 60_000 })
export const TOP_ROLES = Object.freeze(new Set(['trim', 'floor']))
export const TRIM_FETCH_ORDER = Object.freeze(['stone_bricks', 'cobblestone'])
export const FACE_FETCH_ORDER = Object.freeze(['cobbled_deepslate', 'cobblestone'])
const n0 = v => Math.max(0, Number(v) || 0)
/** What `names` hold above the keep -> n. Pure. `bag`, `keep`: { name: n }. */
export const spareOf = (bag = {}, keep = {}, names = []) => [...new Set(names)].reduce((t, n) => t + Math.max(0, n0(bag?.[n]) - n0(keep?.[n])), 0)
/** The items a top (trim or floor) is laid with. Pure. */
export const topItems = (palette = {}) => [...new Set([...itemsFor('trim', palette), ...itemsFor('floor', palette)])]
/** The walls a bag holds (any `_wall`) -> n. Pure. */
export const wallsHeld = (bag = {}) => Object.entries(bag ?? {}).filter(([n]) => POST_BLOCK.test(n)).reduce((t, [, c]) => t + n0(c), 0)
/** A unit's tops (trim and floor cells) not done now -> n (an unread one is owed). Pure over read. */
export function topsOwedIn (read, plan, unit) {
  let n = 0
  for (const c of unit?.tops ?? []) if (TOP_ROLES.has(plan.byKey.get(`${c[0]},${c[1]},${c[2]}`)?.role) && cellDone(read, plan, c) !== true) n++
  return n
}
/** THE NEXT LAYER'S OWED TOPS -> { y, n }: the first unit, top down, that owes a trim or floor cell (n 0, y null: none). Pure. */
export function nextTopsOwed (read, plan) {
  for (const u of plan?.units ?? []) { const n = topsOwedIn(read, plan, u); if (n > 0) return { y: u.y, n } }
  return { y: null, n: 0 }
}
/** THE TOWN'S STOCK AS THE FETCH READS IT -> { name: n } | null (unknown: every source is asked). Pure over skills.mjs matsTownStock's
 *  reading. Only a scan whose every container the index knows is a proof of what the town holds (rig 11-21: an index 12 h stale read
 *  `known` 0 and an empty stock, and the fetch skipped the town's 308 stone_bricks as "none"); a stale or partial one is unknown --
 *  the withdraw's own search (its skip_zero_stock) asks the containers. */
export const townView = ts => (ts && ts.known > 0 && Number(ts.coverage) >= 1 && ts.stock && typeof ts.stock === 'object' ? ts.stock : null)
/** RULE 1: the posts to draw from the town's walls before any is crafted -> n. Pure. */
export function postsDraw ({ bag = {}, postsLeft = 0, max = SWSTOCK.postsMax } = {}) {
  return Math.max(0, Math.min(n0(postsLeft), max) - wallsHeld(bag))
}
/** RULE 2: the walls to craft (whole batches of 6 from 6 cobblestone) -> n, only from cobblestone above BOTH the keep and the next
 *  layer's owed tops. Pure. */
export function postsCraft ({ bag = {}, keep = {}, postsLeft = 0, topsOwed = 0, max = SWSTOCK.postsMax, batch = SWSTOCK.wallsBatch } = {}) {
  const want = Math.min(n0(postsLeft), max) - wallsHeld(bag)
  if (!(want > 0)) return 0
  const free = n0(bag.cobblestone) - n0(keep.cobblestone) - n0(topsOwed)
  return Math.max(0, Math.min(Math.ceil(want / batch), Math.floor(free / batch))) * batch
}
/** RULE 3: THE NEXT TOP-STONE DRAW -> { name, n } | null: the owed tops less the placeable top stone (above the keep), at most `max`,
 *  from the first source in TRIM_FETCH_ORDER not yet `tried` that the town holds (`town` null: unknown, every source is asked). Pure. */
export function trimFetch ({ bag = {}, keep = {}, topsOwed = 0, palette = {}, town = null, tried = [], max = SWSTOCK.topMax } = {}) {
  const deficit = Math.min(max, n0(topsOwed) - spareOf(bag, keep, topItems(palette)))
  if (!(deficit > 0)) return null
  for (const name of TRIM_FETCH_ORDER) {
    if (tried.includes(name)) continue
    if (town && !(n0(town[name]) > 0)) continue
    return { name, n: town ? Math.min(deficit, n0(town[name])) : deficit }
  }
  return null
}
/** RULE 3 for the faces: THE NEXT FACE-STONE DRAW -> { name, n } | null when the placeable face stone (the non-top stone above the
 *  keep, and the top stone beyond the owed tops) is under `min`. Pure. */
export function faceFetch ({ bag = {}, keep = {}, topsOwed = 0, palette = {}, town = null, tried = [], min = SWSTOCK.faceMin, n = SWSTOCK.faceDraw } = {}) {
  const tops = topItems(palette)
  const other = itemsFor('wall', palette).filter(x => !tops.includes(x))
  const usable = spareOf(bag, keep, other) + Math.max(0, spareOf(bag, keep, tops) - n0(topsOwed))
  if (usable >= min) return null
  for (const name of FACE_FETCH_ORDER) {
    if (tried.includes(name)) continue
    if (town && !(n0(town[name]) > 0)) continue
    return { name, n }
  }
  return null
}
/**
 * RULES 1-3 IN THEIR ORDER: THE TANK'S STOCK BEFORE A VISIT -> { drawn: { name: n }, crafted: n }. `s` = { bag() -> { name: n }, keep,
 * palette, postsLeft, owed() -> the next layer's owed tops, town() -> { name: n } | null, draw(name, n) -> Promise<n taken>,
 * craft(n) -> Promise (n cobblestone_wall) }: the posts from the town's walls (postsDraw), a craft only from cobblestone above the keep
 * and the owed tops (postsCraft, read AFTER the draw), then the top stone (trimFetch, AFTER the craft), then the face stone (faceFetch).
 */
export async function stockTank (s, { max = SWSTOCK.postsMax } = {}) {
  const drawn = {}
  const take = async (name, n) => { const got = n0(await s.draw(name, n)); if (got > 0) drawn[name] = (drawn[name] ?? 0) + got; return got }
  const wd = postsDraw({ bag: s.bag(), postsLeft: s.postsLeft, max })
  if (wd > 0) await take('cobblestone_wall', wd)
  const cw = postsCraft({ bag: s.bag(), keep: s.keep, postsLeft: s.postsLeft, topsOwed: s.owed(), max })
  if (cw > 0) await s.craft(cw)
  const town = s.town()
  for (const fn of [trimFetch, faceFetch]) {
    const tried = []
    for (let f; (f = fn({ bag: s.bag(), keep: s.keep, topsOwed: s.owed(), palette: s.palette, town, tried })) != null;) { tried.push(f.name); await take(f.name, f.n) }
  }
  return { drawn, crafted: cw }
}
/** THE ITEM A PLACEMENT HOLDS -> name | null. Pure. `spare(name)` -> what is held above the keep. A top (and a seal: the safety) takes
 *  its role's first item held; a face, body or under takes a top's stone only while the top stone held exceeds the owed tops, else
 *  the next stone it may use -- and the top stone after all when nothing else is held (the face is never left for want of a choice). */
export function pickPlaceItem (role, palette = {}, spare = () => 0, { topsOwed = 0 } = {}) {
  const have = itemsFor(role, palette).filter(n => spare(n) > 0)
  if (!have.length) return null
  if (TOP_ROLES.has(role) || role === 'seal' || !(n0(topsOwed) > 0)) return have[0]
  const tops = topItems(palette)
  const topSpare = tops.reduce((t, n) => t + Math.max(0, spare(n)), 0)
  return have.find(n => !tops.includes(n) || topSpare > n0(topsOwed)) ?? have[0]
}
/** THE STUCK STAMP'S RULE -> bool. Pure. A visit that did nothing and stopped on a failure waits the project (the 6 h stamp) -- but
 *  never one that fetched stone for the tank, whatever its last run's stop (Codex r1 BLOCKER: a rerun from the town chest can read
 *  the tank unloaded and end `unknown`; the stone is in the bag and the next visit lays it). */
export const TANK_STAMP_STOPS = Object.freeze(['no_material', 'no_pickaxe', 'passed', 'unknown', 'unsealed'])
export function tankStamps (r = {}) {
  if (!(r.placed > 0 || r.dug > 0) && TANK_STAMP_STOPS.includes(r.stop)) return !Object.values(r.fetched ?? {}).some(v => v > 0)
  return false
}
/** THE REMEDY A VISIT'S END NAMES -> text: one the bot performs from where it is. Pure. */
export function tankRemedy (r = {}) {
  const got = Object.entries(r.fetched ?? {}).filter(([, v]) => v > 0)
  if (r.stop === 'no_material') {
    if (got.length) return ` -- fetched ${got.map(([k, v]) => `${v} ${k}`).join(', ')} from town; the next visit lays them`
    if (TOP_ROLES.has(r.role)) return ' -- the town gives no stone_bricks or cobblestone: mine cobblestone and carry it'
    if (r.role === 'post') return ' -- withdraw cobblestone_wall at town (or craft it from cobblestone above the keep)'
    return ' -- carry stone (withdraw cobbled_deepslate or cobblestone at town)'
  }
  return { no_pickaxe: ' -- craft or withdraw a pickaxe (toolkit)', passed: ' -- the cells passed are tried again from other stands next visit', unsealed: ' -- the water is sealed from another stand next visit (nothing is cut beside it until then)' }[r.stop] ?? ''
}
/**
 * RULE 4: THE TANK VISIT WITH ITS TOP-STONE REMEDY -> runStepwellVisit's out, summed over its runs, plus `fetched` { name: n }.
 * `run()` -> one runStepwellVisit; a run that ends `no_material` on a top (trim or floor) fetches the top stone (trimFetch, the
 * town read again: stone_bricks first, then cobblestone) and runs again, at most `refetch` times and only while `refetchMs` of the
 * deadline is left; a fetch that took nothing ends it (the stamp's case). `stock` = { bag() -> { name: n }, keep, palette, town() ->
 * { name: n } | null, owed() -> the next layer's owed tops, draw(name, n) -> Promise<n taken> }. `back()` (Codex r1 BLOCKER): the walk
 * from the town's chests back to the tank before the next run (its chunks loaded again); a walk that fails still runs (the run's own
 * stands walk, or it ends `unknown` -- never stamped after a fetch, tankStamps).
 */
export async function tankWithRemedy ({ run, stock, back = null, now = () => Date.now(), deadline = Infinity, refetch = SWSTOCK.refetch, refetchMs = SWSTOCK.refetchMs }) {
  const sum = { placed: 0, dug: 0, ops: 0, skipped: 0, aside: 0, passed: [], fetched: {}, runs: 0 }
  let r = null
  const add = x => { r = x; sum.runs++; for (const k of ['placed', 'dug', 'ops', 'skipped', 'aside']) sum[k] += n0(x[k]); for (const k of x.passed ?? []) if (!sum.passed.includes(k)) sum.passed.push(k) }
  add(await run())
  for (let i = 0; i < refetch && r.stop === 'no_material' && TOP_ROLES.has(r.role) && now() < deadline - refetchMs; i++) {
    const town = stock.town()
    const tried = []
    let took = 0
    for (let f; (f = trimFetch({ bag: stock.bag(), keep: stock.keep, topsOwed: stock.owed(), palette: stock.palette, town, tried })) != null;) {
      tried.push(f.name)
      const n = n0(await stock.draw(f.name, f.n))
      if (n > 0) { sum.fetched[f.name] = (sum.fetched[f.name] ?? 0) + n; took += n }
    }
    if (!took || now() >= deadline - refetchMs) break
    if (back) { try { await back() } catch (err) { if (err?.aborted) throw err } }
    add(await run())
  }
  return { ...r, ...sum, tiers: r.tiers }
}
