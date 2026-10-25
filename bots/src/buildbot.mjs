// THE BUILDER'S EFFECTS ON A REAL BOT (shop-01 stage B; design 4.4): buildrun.mjs runVisit's injected effects for mineflayer.
// One adapter, used by the build skill and by the Paper scenes, so the code the sandbox proves is the code the bots run.
//
//   CLICKS     our own block_place packet carrying a sequence above every sequence this connection has written (buildack.mjs);
//              the cursor at the clicked face's centre; the look first (runVisit awaits it before the fence). mineflayer's
//              placeBlock is never used: it writes sequence 0 and believes its own model.
//   DIGS       mineflayer's dig, CONFIRMED only by the server's own block_change / multi_block_change for that cell naming air
//              within DIG_CONFIRM_MS -- never by the client's model, which writes air before the server answers (memory "ghost
//              blocks are rejected digs"). No dig in the first SPAWN_DIG_QUIET_MS after a spawn (runVisit waits).
//   PROBE      the resync probe (design 4.4, Codex design r2 P2): a click on the face of a solid, never-interactable neighbour
//              that points INTO the unknown cell, holding an EMPTY hotbar slot selected by setQuickBarSlot (never unequip: the
//              toss bug), else the pickaxe; never an axe, shovel or hoe. Vanilla answers a use-item-on with block updates for
//              the clicked block and the adjacent cell, so the server's truth arrives.
//   WALKS      borrowed, never set: the caller passes `withWalk` (index.mjs's scoped wrapper; dep-contract).

import pkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { installAckTracker } from './buildack.mjs'
import { DIG_CONFIRM_MS } from './buildrun.mjs'
const { goals } = pkg

export const BODY_RADIUS = 64
export const PATH_MS = 25_000
// never the clicked block of a probe, and never a support (they open, toggle or act): buildsite.mjs USES plus the rest
const INTERACTABLE = /_trapdoor$|_door$|chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|^lectern$|_bed$|_button$|^lever$|_fence_gate$|^anvil$|_anvil$|^bell$|^brewing_stand$|^composter$|^cartography_table$|^loom$|^stonecutter$|^grindstone$|^smithing_table$|^enchanting_table$|^beacon$|^dispenser$|^dropper$|^note_block$|^jukebox$|^repeater$|^comparator$|^daylight_detector$|_sign$|^cake$|^respawn_anchor$|^lodestone$|^campfire$|^soul_campfire$/
const FACE_DIR = f => (f[1] < 0 ? 0 : f[1] > 0 ? 1 : f[2] < 0 ? 2 : f[2] > 0 ? 3 : f[0] < 0 ? 4 : 5)

/** multi_block_change records -> [{ x, y, z, stateId }] (1.20+: a section position and varlong records: state << 12 | x << 8 | z << 4 | y). Pure. */
export function decodeMultiBlock (data) {
  const out = []
  const s = data?.chunkCoordinates ?? data?.sectionPosition ?? null
  if (!s) return out
  for (const r of data?.records ?? []) {
    const v = typeof r === 'bigint' ? r : Array.isArray(r) ? (BigInt(r[0] >>> 0) << 32n) | BigInt(r[1] >>> 0) : BigInt(r)
    const stateId = Number(v >> 12n), lx = Number((v >> 8n) & 15n), lz = Number((v >> 4n) & 15n), ly = Number(v & 15n)
    out.push({ x: s.x * 16 + lx, y: s.y * 16 + ly, z: s.z * 16 + lz, stateId })
  }
  return out
}

/** The SERVER'S word on a cell, from the raw packets -> { watch(cell), wait(cell, pred, ms) -> name | null, stop }. */
export function installServerBlockWitness (bot) {
  const seen = new Map()
  const waiters = []
  const nameOf = id => bot.registry?.blocksByStateId?.[id]?.name ?? null
  const note = (x, y, z, stateId) => {
    const k = `${x},${y},${z}`, n = nameOf(stateId)
    seen.set(k, n)
    for (const w of waiters.slice()) if (w.k === k && w.pred(n)) { clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.resolve(n) }
  }
  const onPacket = (data, meta) => {
    try {
      if (meta?.name === 'block_change' && data?.location) note(data.location.x, data.location.y, data.location.z, data.type ?? data.stateId)
      else if (meta?.name === 'multi_block_change') for (const r of decodeMultiBlock(data)) note(r.x, r.y, r.z, r.stateId)
    } catch { /* never break the packet path */ }
  }
  bot._client?.on?.('packet', onPacket)
  return {
    watch: c => seen.delete(c.join(',')),
    wait: (c, pred, ms) => {
      const k = c.join(',')
      if (seen.has(k) && pred(seen.get(k))) return Promise.resolve(seen.get(k))
      return new Promise(resolve => { const w = { k, pred, resolve, timer: null }; w.timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); resolve(null) }, ms); waiters.push(w) })
    },
    stop: () => { try { (bot._client?.off ?? bot._client?.removeListener)?.call(bot._client, 'packet', onPacket) } catch { /* gone */ } },
  }
}

/**
 * -> runVisit's effects for `bot`, plus close(). Options:
 *   withWalk(fn)   the caller's scoped walk profile (index.mjs); identity by default
 *   aborted()      the skill's signal
 *   log(kind, d)   the row writer (the skill's logEvent)
 *   spawnedAt()    ms of the last spawn
 */
export function botBuildEffects (bot, { withWalk = fn => fn(), aborted = () => false, log = () => {}, spawnedAt = () => 0, pathMs = PATH_MS } = {}) {
  const acks = installAckTracker(bot)
  const blocks = installServerBlockWitness(bot)
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const items = () => bot.inventory?.items?.() ?? []
  const count = n => items().filter(i => i.name === n).reduce((s, i) => s + (i.count ?? 1), 0)
  const has = n => count(n) > 0
  has.planks = () => items().find(i => /_planks$/.test(i.name))?.name ?? null
  const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox } : null }
  const write = (support, face, seq) => {
    bot._client.write('block_place', {
      location: new Vec3(support[0], support[1], support[2]), direction: FACE_DIR(face), hand: 0,
      cursorX: 0.5 + face[0] * 0.5, cursorY: 0.5 + face[1] * 0.5, cursorZ: 0.5 + face[2] * 0.5,
      insideBlock: false, worldBorderHit: false, sequence: seq,
    })
    try { bot.swingArm?.('right') } catch { /* cosmetic */ }
  }
  return {
    read,
    feet: () => { const p = bot.entity.position; return [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)] },
    bodies: () => Object.values(bot.entities ?? {})
      .filter(e => e && e !== bot.entity && e.position && !['item', 'experience_orb', 'arrow'].includes(e.name) && e.position.distanceTo?.(bot.entity.position) < BODY_RADIUS)
      .map(e => ({ x: e.position.x, y: e.position.y, z: e.position.z, w: e.width ?? 0.6, h: e.height ?? 1.8 })),
    walkTo: async s => {
      try { await withWalk(() => Promise.race([bot.pathfinder.goto(new goals.GoalBlock(s[0], s[1], s[2])), sleep(pathMs).then(() => { try { bot.pathfinder.setGoal(null) } catch { /* idle */ } })])) } catch (e) { if (e?.aborted || aborted()) throw e }
      return true
    },
    hold: async n => {
      const it = items().find(i => i.name === n)
      if (!it) return false
      if (bot.heldItem?.name !== n) { try { await bot.equip(it, 'hand') } catch (e) { if (e?.aborted) throw e } }
      return bot.heldItem?.name === n
    },
    has,
    look: async (support, face) => { try { await bot.lookAt(new Vec3(support[0] + 0.5 + face[0] * 0.5, support[1] + 0.5 + face[1] * 0.5, support[2] + 0.5 + face[2] * 0.5), true) } catch { /* not fatal */ } },
    nextSeq: () => acks.tracker.next(),
    send: write,
    waitAck: (seq, ms) => acks.tracker.wait(seq, ms),
    dig: async c => {
      const b = bot.blockAt(new Vec3(c[0], c[1], c[2]))
      if (!b || b.name === 'air') return 'confirmed'
      blocks.watch(c)
      try { await bot.dig(b, true) } catch (e) { if (e?.aborted || aborted()) throw e; return 'refused' }
      const n = await blocks.wait(c, x => x === 'air' || x === 'cave_air', DIG_CONFIRM_MS)
      return n ? 'confirmed' : 'unconfirmed'
    },
    probe: async c => {
      for (const d of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        const nb = [c[0] + d[0], c[1] + d[1], c[2] + d[2]]
        const b = read(...nb)
        if (!b || b.boundingBox !== 'block' || INTERACTABLE.test(b.name)) continue
        const empty = [...Array(9).keys()].find(i => !bot.inventory?.slots?.[36 + i])
        if (empty != null) bot.setQuickBarSlot(empty)
        else { const pick = items().find(i => /_pickaxe$/.test(i.name)); if (!pick) return false; try { await bot.equip(pick, 'hand') } catch { return false } }
        if (/_(axe|shovel|hoe)$/.test(bot.heldItem?.name ?? '')) return false
        const face = [-d[0], -d[1], -d[2]]
        await bot.lookAt(new Vec3(nb[0] + 0.5 + face[0] * 0.5, nb[1] + 0.5 + face[1] * 0.5, nb[2] + 0.5 + face[2] * 0.5), true).catch(() => {})
        blocks.watch(c)
        const seq = acks.tracker.next()
        write(nb, face, seq)
        await acks.tracker.wait(seq, 2_000)
        return true
      }
      return false
    },
    retired: () => acks.retiredAt,
    aborted,
    log,
    now: () => Date.now(),
    sleep,
    spawnedAt,
    close: () => { acks.stop(); blocks.stop() },
  }
}
