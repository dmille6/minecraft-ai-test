// THE BUILDER'S EFFECTS ON A REAL BOT (builder.mjs runPlacements' injected effects, for mineflayer). One adapter, shared by
// every structure job (the monument first, town projects next) and by the Paper scenes, so the code the sandbox proves is
// the code the fleet runs. tendFarm's click, generalized: walk to the stand, hold the block, look at the face, click it,
// and believe only the server's block update for the cell (blueprint.mjs installBlockWitness) -- never the client's model.
// THE WALK PROFILE IS BORROWED, NEVER SET: index.mjs owns every setMovements (dep-contract.test.mjs), so the caller passes
// one of its scoped wrappers (`bot.withTownDepositWalk`: no digging, no towers, no scaffold -- a builder's walk).
import pkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { installBlockWitness, decodeMultiRecord } from './blueprint.mjs'
import { faceCentre, isFullCube } from './builder.mjs'
const { goals } = pkg

/** The server's answer to one click arrives in ~0.1-1 s (sandbox); 2.5 s is silence (tendFarm FARM_ACK_MS). */
export const BUILD_ACK_MS = 2_500
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
  // WHAT THIS CLIENT HEARD: the last time the server spoke about each cell (any block update), for the click lock's handoff --
  // a builder may click after another's confirmed placement only once its own world knows of it (monument-01, Codex r2 P1-1)
  const heardAt = new Map()
  const noteHeard = (x, y, z) => { heardAt.set(`${x},${y},${z}`, Date.now()); if (heardAt.size > 20_000) { const cut = Date.now() - 120_000; for (const [k, t] of heardAt) if (t < cut) heardAt.delete(k) } }
  const onOne = p => { try { noteHeard(p.location.x, p.location.y, p.location.z) } catch { /* malformed */ } }
  const onMulti = p => { try { for (const r of p.records ?? []) { const d = decodeMultiRecord(p.chunkCoordinates, r); noteHeard(d.x, d.y, d.z) } } catch { /* malformed */ } }
  try { bot._client?.on?.('block_change', onOne); bot._client?.on?.('multi_block_change', onMulti) } catch { /* no client */ }
  let heldName = null
  const sleep = ms => new Promise(r => setTimeout(r, ms))
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
      try { await bound(place, BUILD_ACK_MS, 'placing') } catch (e) { if (e?.aborted || aborted()) throw e }
      return witness.until(step.cell, n => n === want, BUILD_ACK_MS)
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
    heard: (cell, since) => (heardAt.get(`${cell[0]},${cell[1]},${cell[2]}`) ?? -Infinity) >= since,
    close: () => {
      try { witness.stop() } catch { /* gone */ }
      try { bot._client?.removeListener?.('block_change', onOne); bot._client?.removeListener?.('multi_block_change', onMulti) } catch { /* gone */ }
    },
  }
}
