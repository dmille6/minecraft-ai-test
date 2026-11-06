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
import { firstUndoneUnit, stepwellNext, standsFor, inReach, SW, tiersDone, cellGood, POST_BLOCK, unitDone } from './stepwell.mjs'
import { shareView } from './stepwell.mjs'   // stepwell-05: the crew's sector of a layer
import { isFull, isWet } from './shaftgeom.mjs'
import { stairRead, stairItems } from './shaftvisit.mjs'
import { withDigScope } from './digtown.mjs'

export const CELL_TRIES = 2
export const EGRESS_HOP = 6
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
 * -> { stop, why, y, placed, dug, ops, skipped, tiers }. `p` = { rec, plan, onStop(y, why) -> Promise, onTiers?(tiers) -> Promise,
 * exit, share? }. stepwell-05 `share` = { mine(cell) -> bool, othersBusy() -> bool, lead() -> bool } (absent: one builder, as
 * before). `e` = { read (a fresh reader per get), feet() -> [x,y,z], walkTo(cell) -> Promise<bool>, dig(cell) -> Promise<'confirmed'|...>,
 * place(cell, role) -> Promise<'confirmed'|'no_material'|'no_support'|'no_reach'|'refused'>, toolOk() -> bool, fence() -> bool,
 * occupied?(cell) -> bool (a player's body stands on the cell: never dug), log(op, d), now(), aborted() }.
 */
export async function runStepwellVisit (p, e, { deadline = Infinity, opsMax = SW.unitOps, lights = () => true } = {}) {
  const plan = p.plan
  const out = { stop: null, why: null, y: null, placed: 0, dug: 0, ops: 0, skipped: 0, tiers: [] }
  const skip = new Set()
  const fails = new Map()
  const banned = new Set()
  let litOff = false
  let shareOff = false   // stepwell-05: no other builder holds a slot -- this visit works whole layers
  const end = (stop, why = null, y = null) => { out.stop = stop; out.why = why; out.y = y; return out }
  const fail = (c, why) => {
    const k = kOf(c)
    const n = (fails.get(k) ?? 0) + 1
    fails.set(k, n)
    e.log('refused', { at: c, why })
    if (n >= CELL_TRIES) { skip.add(k); out.skipped++ }
  }
  const body = async () => {
    for (;;) {
      if (e.aborted()) { const err = new Error('aborted'); err.aborted = true; throw err }
      if (e.now() >= deadline) return end('time')
      if (!e.fence()) return end('lease')
      if (out.ops >= opsMax) return end('ops')
      const read = e.read
      const lit = !!lights() && !litOff
      const w = firstUndoneUnit(read, plan, { lights: lit })
      if (!w) return end('complete')
      if (w.unknown) return end('unknown', 'an unloaded or unread cell', w.unit.y)
      // stepwell-05: THE CREW -- a tank layer is this builder's sector only (the others' sectors are theirs); a descent station the
      // lowest live slot's alone
      if (shareOff && p.share?.othersBusy()) shareOff = false   // another builder took a slot since: back to this builder's sector
      const sharing = !!p.share && !shareOff
      if (sharing && w.unit.station && !p.share.lead()) return end('shared', 'the descent is one builder\'s: another builder holds a lower slot', w.unit.y)
      const unit = sharing && !w.unit.station ? shareView(w.unit, p.share.mine) : w.unit
      const op = stepwellNext(read, plan, unit, { feet: e.feet(), skip, lights: lit })
      if (op.op === 'done') {
        // only torches left that would not take (Paper 11-05: a torch refused twice held the descent's first station for 40 visits):
        // the torches never hold the work -- this visit goes on without them; a later visit or the repair lays them
        if (lit && unitDone(read, plan, unit, { lights: false }) === true) { litOff = true; e.log('lights_passed', { at: unit.cut[0] ?? unit.tops[0] ?? null, y: w.unit.y }); continue }
        // stepwell-05: this builder's part of the layer is DONE (not passed): the rest is another builder's while one holds a slot,
        // else this visit takes the whole layer (never the next one before this one stands: the order is the safety)
        if (sharing && !w.unit.station && unitDone(read, plan, unit, { lights: lit }) === true) {
          if (p.share.othersBusy()) return end('shared', 'this builder\'s sector of the layer is done; another builder works the rest', w.unit.y)
          shareOff = true
          continue
        }
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
        if (!st.length) { fail(op.at, 'no_stand'); fail(op.at, 'no_stand'); continue }
        const ok = await e.walkTo(st[0])
        if (!ok || !same(e.feet(), st[0])) { banned.add(kOf(st[0])); fail(op.at, 'walk_failed'); continue }
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
        const r = await e.place(op.at, op.role)
        if (r === 'confirmed') { out.placed++; e.log('place', { at: op.at, role: op.role, why: op.why, y: w.unit.y }) } else if (r === 'no_material') return end('no_material', `no ${op.role} block in the bag`, w.unit.y)
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
export function stepwellBotEffects (bot, B, { palette = {}, signal = null, fence = () => true, log = () => {}, walk, occupied = () => false } = {}) {
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
    place: async (c, role) => {
      const item = itemsFor(role, palette).find(n => B.has(n))
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
