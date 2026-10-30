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
import { firstUndone, unitCells, standFor, nextOp, planOf, toWorld, LANDING_CELL, TORCH_EVERY, PILLAR, LINING_ITEMS, isFull } from './shaftgeom.mjs'
import { withDigScope } from './digtown.mjs'

export const UNITS_MAX = 40
export const CELL_TRIES = 2
const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
const kOf = a => a.join(',')

/**
 * -> { stop, why, k, placed, dug, units, landings: [feet published], torches }. `p` = { rec, exit, built: Set(feet),
 * onLanding(feet) -> Promise<bool>, onStop(k, why) -> Promise<void>, onDropLanding(feet, why) -> Promise<void> }. `e` = { read, feet() -> [x,y,z], walkTo(cell) ->
 * Promise<bool>, dig(cell) -> Promise<'confirmed'|...>, place(cell) -> Promise<'confirmed'|'no_material'|'no_support'|'no_reach'|
 * 'refused'>, toolOk() -> bool, fence() -> bool, torch?(cell, support) -> Promise<bool>, log(op, d), now(), aborted() }.
 */
export async function runStairVisit (p, e, { deadline = Infinity, unitsMax = UNITS_MAX } = {}) {
  const plan = planOf(p.rec)
  const built = p.built ?? new Set(p.rec.landings_built ?? [])
  const out = { stop: null, why: null, k: null, placed: 0, dug: 0, units: 0, landings: [], torches: 0 }
  const fails = new Map()
  const torched = new Set()
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
    if (out.units >= unitsMax) return end('units', null, w.k)
    // WALK TO THE STAND: step k-1's (every step above is verified, so the walk is on the stair), the collar exit for step 0
    const stand = standFor(plan, w, p.exit)
    if (!stand) return end('no_stand', 'no collar exit', w.k)
    if (!same(e.feet(), stand)) {
      await e.walkTo(stand)
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
    dig: async c => { await equipFor(c); return withDigScope(bot, { purpose: 'target', by: 'build_stair' }, () => B.dig(c)) },
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
