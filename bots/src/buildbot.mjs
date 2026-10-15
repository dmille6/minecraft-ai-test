// THE BUILDER'S EFFECTS ON A REAL BOT (builder.mjs runPlacements' injected effects, for mineflayer). One adapter, shared by
// every structure job (the monument first, town projects next) and by the Paper scenes, so the code the sandbox proves is
// the code the fleet runs. tendFarm's click, generalized: walk to the stand, hold the block, look at the face, click it,
// and believe only the server's block update for the cell (blueprint.mjs installBlockWitness) -- never the client's model.
// THE WALK PROFILE IS BORROWED, NEVER SET: index.mjs owns every setMovements (dep-contract.test.mjs), so the caller passes
// one of its scoped wrappers (`bot.withTownDepositWalk`: no digging, no towers, no scaffold -- a builder's walk).
import pkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { installBlockWitness } from './blueprint.mjs'
import { faceCentre } from './builder.mjs'
const { goals } = pkg

/** The server's answer to one click arrives in ~0.1-1 s (sandbox); 2.5 s is silence (tendFarm FARM_ACK_MS). */
export const BUILD_ACK_MS = 2_500
/** One click per 4 ticks (design 3.5). */
export const BUILD_CLICK_TICKS = 4
/** Bodies within this many blocks are asked about (a cell they touch waits). */
export const BODY_RADIUS = 8

/**
 * -> { read, feet, bodies, walkTo, hold, click, close } for runPlacements.
 *   items        the block names this job may place, in order of preference (the first held one is used)
 *   bound        (promise, ms, what) -> promise: the skill's own await guard (hkGuards); identity by default
 *   withWalk     (fn) -> fn() under the walk profile: index.mjs's scoped borrow (identity: the bot's current profile)
 *   aborted      () -> boolean
 */
export function botBuildEffects (bot, { items = ['cobblestone'], bound = p => p, pathMs = 20_000, withWalk = fn => fn(), aborted = () => false } = {}) {
  const witness = installBlockWitness(bot)
  let heldName = null
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const ticks = n => bound(bot.waitForTicks?.(n) ?? sleep(n * 50), n * 50 + 2_000, 'tick wait')
  return {
    read: (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox } : null },
    feet: () => { const p = bot.entity.position; return { x: Math.floor(p.x), y: Math.floor(p.y + 1e-6), z: Math.floor(p.z) } },
    bodies: () => Object.values(bot.entities ?? {})
      .filter(e => e && e !== bot.entity && e.position && !['item', 'experience_orb'].includes(e.name) && e.position.distanceTo?.(bot.entity.position) < BODY_RADIUS)
      .map(e => ({ x: e.position.x, y: e.position.y, z: e.position.z, w: e.width ?? 0.6, h: e.height ?? 1.8 })),
    walkTo: async s => {
      try { await withWalk(() => bound(bot.pathfinder.goto(new goals.GoalBlock(s.x, s.y, s.z)), pathMs, 'pathfinding')) } catch (e) { if (e?.aborted || aborted()) throw e }
      return true
    },
    hold: async () => {
      for (const name of items) {
        const it = (bot.inventory?.items?.() ?? []).find(i => i.name === name)
        if (!it) continue
        if (bot.heldItem?.name !== name) { try { await bound(bot.equip(it, 'hand'), 5_000, 'equip') } catch (e) { if (e?.aborted) throw e } }
        if (bot.heldItem?.name === name) { heldName = name; return true }
      }
      heldName = null
      return false
    },
    click: async step => {
      const ref = bot.blockAt(new Vec3(step.ref.x, step.ref.y, step.ref.z))
      if (!ref) return 'silent'
      const p = faceCentre(step.ref, step.face)
      try { await bot.lookAt(new Vec3(p.x, p.y, p.z), true) } catch { /* not fatal */ }
      await ticks(BUILD_CLICK_TICKS)
      const want = heldName
      witness.watch(step.cell)
      try { await bound(bot.placeBlock(ref, new Vec3(step.face[0], step.face[1], step.face[2])), BUILD_ACK_MS, 'placing') } catch (e) { if (e?.aborted || aborted()) throw e }
      return witness.until(step.cell, n => n === want, BUILD_ACK_MS)
    },
    close: () => { try { witness.stop() } catch { /* gone */ } },
  }
}
