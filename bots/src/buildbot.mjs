// THE BUILDER'S EFFECTS ON A REAL BOT (builder.mjs runPlacements' injected effects, for mineflayer). One adapter, shared by
// every structure job (the monument first, town projects next) and by the Paper scenes, so the code the sandbox proves is
// the code the fleet runs. tendFarm's click, generalized: walk to the stand, hold the block, look at the face, click it,
// and believe only the server's block update for the cell (blueprint.mjs installBlockWitness) -- never the client's model.
// THE WALK PROFILE IS BORROWED, NEVER SET: index.mjs owns every setMovements (dep-contract.test.mjs), so the caller passes
// one of its scoped wrappers (`bot.withTownDepositWalk`: no digging, no towers, no scaffold -- a builder's walk).
import pkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { installBlockWitness } from './blueprint.mjs'
import { faceCentre, isFullCube } from './builder.mjs'
const { goals } = pkg

/** The server's answer to one click arrives in ~0.1-1 s (sandbox); 2.5 s is silence (tendFarm FARM_ACK_MS). */
export const BUILD_ACK_MS = 2_500
/** A barrier's ack comes from the next server tick (~50 ms; Paper probe 43-51 ms); this long without one is no answer. */
export const BARRIER_MS = 5_000
/** Barrier sequences: our own range, far above mineflayer's activateItem counter (the server acks the tick's MAXIMUM). */
let barrierSeq = 1_000_000
/** This process's event ordinals: the click lock orders "armed" against "left" by them (never by a clock). */
let ORD = 0
export const nextOrd = () => ++ORD
const nextBarrierSeq = () => (barrierSeq = barrierSeq >= 2_000_000_000 ? 1_000_000 : barrierSeq + 1)
/**
 * THE WORLD-SYNC BARRIER -> Promise<boolean>. `use_item` with a sequence of our own; true on the server's block-changed ack
 * carrying it (or a later one). The server handles packets between ticks, broadcasts a tick's block changes in the level tick,
 * then sends each connection's ack in the connection tick -- one ordered stream per client (Claude stage-4 r5 confirmed the
 * Paper tick structure; Paper probe 10-15: a clicked cell's updates, then the ack). So when it arrives, this client's world
 * holds every block change the server made before it read the packet. CAVEAT: a chunk this client starts tracking during
 * the window arrives on Paper's chunk-send path, outside that order; builders stay at a site whose chunks are loaded.
 * Sent only with an empty hand or a held item `allowed(name)` says is a plain block (its use does nothing: vanilla Item.use
 * is a PASS; the fleet servers run no plugins -- 10-15: only bStats/spark data dirs); otherwise false, never sent.
 */
export function worldBarrier (bot, allowed = () => false) {
  return new Promise(resolve => {
    const held = bot.heldItem?.name ?? null
    const c = bot._client
    if ((held && !allowed(held)) || typeof c?.write !== 'function' || typeof c?.on !== 'function') { resolve(false); return }
    const seq = nextBarrierSeq()
    let timer = null
    const done = v => { clearTimeout(timer); try { c.removeListener('acknowledge_player_digging', on) } catch { /* gone */ } resolve(v) }
    const on = p => { if (Number(p?.sequenceId) >= seq) done(true) }
    c.on('acknowledge_player_digging', on)
    timer = setTimeout(() => done(false), BARRIER_MS)
    try {
      c.write('use_item', { hand: 0, sequence: seq, rotation: { x: (Math.PI - (bot.entity?.yaw ?? 0)) * 180 / Math.PI, y: -(bot.entity?.pitch ?? 0) * 180 / Math.PI } })
    } catch { done(false) }
  })
}
/** One click per 4 ticks (design 3.5). */
export const BUILD_CLICK_TICKS = 4
/** Bodies within this many blocks are asked about: a cell they touch waits, and no click walls one in. Wide (Claude stage-3
 *  r2 P2-B): the next cell of a 48-wide layer is often 16+ blocks from the bot, and a bystander beside IT is the one at risk. */
export const BODY_RADIUS = 64

/**
 * -> { read, feet, bodies, walkTo, hold, click, close } for runPlacements.
 *   items        the block names this job may place, in order of preference (the first held one is used)
 *   bound        (promise, ms, what) -> promise: the skill's own await guard (hkGuards); by default a plain timeout that
 *                stops the pathfinder on expiry (Claude stage-3 r1 P3: identity left goto unbounded)
 *   withWalk     (fn) -> fn() under the walk profile: index.mjs's scoped borrow (identity: the bot's current profile)
 *   aborted      () -> boolean
 */
export const timeoutBound = bot => (p, ms, what) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { if (what === 'pathfinding') { try { bot.pathfinder?.setGoal?.(null) } catch { /* gone */ } } reject(new Error(`${what} timed out after ${ms} ms`)) }, ms)
  Promise.resolve(p).then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
})
export function botBuildEffects (bot, { items = ['cobblestone'], bound = timeoutBound(bot), pathMs = 20_000, withWalk = fn => fn(), aborted = () => false } = {}) {
  const witness = installBlockWitness(bot)
  // WHO LEFT, IN THIS PROCESS'S EVENT ORDER (Codex stage-4 r5 P2: an ordinal, never a wall clock): kept on the bot for its
  // whole connection (one listener per bot), so a leave between two visits still counts
  if (!bot.__leftOrd) {
    bot.__leftOrd = new Map()
    bot.__joinOrd = new Map()
    try { bot.on?.('playerLeft', p => { try { if (p?.username) bot.__leftOrd.set(p.username, nextOrd()) } catch { /* malformed */ } }) } catch { /* no events */ }
    try { bot.on?.('playerJoined', p => { try { if (p?.username) bot.__joinOrd.set(p.username, nextOrd()) } catch { /* malformed */ } }) } catch { /* no events */ }
  }
  const session = (bot.__buildSession ??= `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
  let heldName = null
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  // only a hand this job filled (hold(): a plan cell's block), one of its items, or an empty one
  const barrier = () => worldBarrier(bot, held => held === heldName || items.includes(held))
  const ticks = n => bound(bot.waitForTicks?.(n) ?? sleep(n * 50), n * 50 + 2_000, 'tick wait')
  return {
    read: (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox, full: isFullCube(b) } : null },
    feet: () => { const p = bot.entity.position; return { x: Math.floor(p.x), y: Math.floor(p.y + 1e-6), z: Math.floor(p.z) } },
    bodies: () => Object.values(bot.entities ?? {})
      .filter(e => e && e !== bot.entity && e.position && !['item', 'experience_orb'].includes(e.name) && e.position.distanceTo?.(bot.entity.position) < BODY_RADIUS)
      .map(e => ({ x: e.position.x, y: e.position.y, z: e.position.z, w: e.width ?? 0.6, h: e.height ?? 1.8 })),
    // the builder's own body, for the gate only (off-centre it can overlap the target: the server would refuse the click)
    self: () => { const p = bot.entity.position; return { x: p.x, y: p.y, z: p.z, w: bot.entity.width ?? 0.6, h: bot.entity.height ?? 1.8 } },
    walkTo: async s => {
      try { await withWalk(() => bound(bot.pathfinder.goto(new goals.GoalBlock(s.x, s.y, s.z)), pathMs, 'pathfinding')) } catch (e) { if (e?.aborted || aborted()) throw e }
      return true
    },
    // THE CELL'S OWN MATERIAL when it names one (Claude stage-3 r1 P3: another block would leave it `blocked` for good)
    hold: async cell => {
      for (const name of (typeof cell?.want === 'string' ? [cell.want] : items)) {
        const it = (bot.inventory?.items?.() ?? []).find(i => i.name === name)
        if (!it) continue
        if (bot.heldItem?.name !== name) { try { await bound(bot.equip(it, 'hand'), 5_000, 'equip') } catch (e) { if (e?.aborted) throw e } }
        if (bot.heldItem?.name === name) { heldName = name; return true }
      }
      heldName = null
      return false
    },
    // THE WORLD-SYNC BARRIER (monument-01, Codex stage-4 r4: no step of the click lock rests on elapsed time). `use_item` with a
    // sequence of our own, holding a plain block (no effect: Paper probe 10-15, 16 cobblestone before and after) or nothing; the
    // server acks that sequence from its tick after that tick's block broadcasts, on the same ordered stream (probe: the clicked
    // cell's updates arrived 2-6 ms after the click, the ack after them; 20 barriers took 43-51 ms). When the ack arrives, this
    // world holds every change the server made before it read the packet. false: no ack within BARRIER_MS, or a held item whose
    // use could do something (never sent).
    sync: () => barrier(),
    session,
    // the player list is READY once it holds this bot itself; before that, everyone counts as present (busy, never a guess)
    present: name => !bot.players?.[bot.username] || !!bot.players?.[name],
    leftAt: name => bot.__leftOrd?.get(name) ?? -Infinity,
    joinedAt: name => bot.__joinOrd?.get(name) ?? -Infinity,
    ord: () => nextOrd(),
    click: async (step, gate = () => null) => {
      const p = faceCentre(step.ref, step.face)
      try { await bot.lookAt(new Vec3(p.x, p.y, p.z), true) } catch { /* not fatal */ }
      await ticks(BUILD_CLICK_TICKS)
      // THE GATE AFTER THE LAST AWAIT, and nothing awaited between it and placeBlock's packet (Codex stage-3 r1 P1-1)
      const ref = bot.blockAt(new Vec3(step.ref.x, step.ref.y, step.ref.z))
      if (!ref) return 'gate:support_changed'
      const want = heldName
      if (bot.heldItem?.name !== want) return 'gate:not_held'
      const no = gate()
      if (no) return `gate:${no}`
      witness.watch(step.cell)
      // forceLook 'ignore' (we looked above): mineflayer's _genericPlace then writes block_place in the same synchronous turn
      // as this call -- placeBlock() would await a second lookAt first, an await between the gate and the packet
      const face = new Vec3(step.face[0], step.face[1], step.face[2])
      const place = typeof bot._placeBlockWithOptions === 'function'
        ? bot._placeBlockWithOptions(ref, face, { swingArm: 'right', forceLook: 'ignore' })
        : bot.placeBlock(ref, face)
      Promise.resolve(place).catch(() => { /* mineflayer's own wait for the update: the barrier below is the verdict */ })
      // THE VERDICT AFTER OUR OWN BARRIER: the server has processed the click and sent us the cell's update -- what the world
      // shows now is the server's answer (confirmed or refused); no answer at all is 'silent' (the lock keeps the click pending)
      if (!(await barrier())) return 'silent'
      const b = bot.blockAt(new Vec3(step.cell.x, step.cell.y, step.cell.z))
      return b?.name === want ? 'confirmed' : 'refused'
    },
    // A CLEAR (a flower, a sapling, a torch in a planned cell): look, pace, the gate, then the dig with 'ignore' (no await
    // between the gate and the dig packet); the server's update to air is the only success
    clear: async (step, gate = () => null) => {
      const c = step.cell
      try { await bot.lookAt(new Vec3(c.x + 0.5, c.y + 0.5, c.z + 0.5), true) } catch { /* not fatal */ }
      await ticks(BUILD_CLICK_TICKS)
      const block = bot.blockAt(new Vec3(c.x, c.y, c.z))
      if (!block) return 'gate:cell_changed'
      const no = gate()
      if (no) return `gate:${no}`
      witness.watch(c)
      // an unfinished dig is CANCELLED (Codex stage-4 r1 P2-6): a timed-out or aborted clear never keeps swinging
      try { await bound(bot.dig(block, 'ignore'), BUILD_ACK_MS, 'clearing') } catch (e) { try { bot.stopDigging?.() } catch { /* not digging */ } if (e?.aborted || aborted()) throw e }
      // water is a cleared result too: a waterlogged plant (seagrass, kelp) leaves its water (Claude stage-4 r1 P2-1)
      return witness.until(c, n => n === 'air' || n === 'cave_air' || n === 'void_air' || n === 'water', BUILD_ACK_MS)
    },
    close: () => {
      try { witness.stop() } catch { /* gone */ }
    },
  }
}
