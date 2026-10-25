// THE BUILDER'S EFFECTS ON A REAL BOT (shop-01 stage B; design 4.4): buildrun.mjs runVisit's injected effects for mineflayer.
// One adapter, used by the build skill and by the Paper scenes, so the code the sandbox proves is the code the bots run.
//
//   CLICKS     our own block_place packet carrying a sequence above every sequence this connection has written (buildack.mjs;
//              the connection's tracker, `acks`, installed before login); the cursor at the clicked face's centre; the look
//              first (runVisit awaits it before the fence). mineflayer's placeBlock is never used: it writes sequence 0 and
//              believes its own model.
//   DIGS       mineflayer's dig of the NAMED block only (r2, Codex r1 P2: a replacement is never dug), CONFIRMED only by the
//              server's own block_change / multi_block_change for that cell naming air within DIG_CONFIRM_MS -- never by the
//              client's model, which writes air before the server answers (memory "ghost blocks are rejected digs"). No dig in
//              the first SPAWN_DIG_QUIET_MS after a spawn (runVisit waits).
//   PROBE      the resync probe (design 4.4, Codex design r2 P2): a click on the face of a solid, never-interactable neighbour
//              that points INTO the unknown cell, holding an EMPTY hotbar slot selected by setQuickBarSlot (never unequip: the
//              toss bug), else the pickaxe; never an axe, shovel or hoe. Vanilla answers a use-item-on in reach with block
//              updates for the clicked block and the adjacent cell. -> the SERVER-WITNESSED name of the cell, or null (r2, Codex
//              r1 P2: an unanswered probe confirms nothing; the client's optimistic air is never read as the answer).
//   WALKS      borrowed, never set: the caller passes `withWalk` (index.mjs's scoped wrapper; dep-contract). The walk's own
//              timeout is cleared when the walk ends (r2, Codex r1 P2: a stale timer cancelled the next job's goal).
//   THE BAG    `has` counts only what is held ABOVE the visit's keeps (`keep`: towndeposit townKeeps at the visit's start;
//              Codex r1 P3, cooperation A2): the fill never spends the bot's own stockpile.

import pkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { installAckTracker } from './buildack.mjs'
import { DIG_CONFIRM_MS } from './buildrun.mjs'
const { goals } = pkg

export const BODY_RADIUS = 64
export const PATH_MS = 25_000
export const PROBE_MS = 2_000
// never the clicked block of a probe, and never a support (they open, toggle or act): buildsite.mjs USES plus the rest
// (r2, Claude r1 P3-7: crafter, chiseled bookshelf, flower pots and candles act on an empty-hand click)
export const INTERACTABLE = /_trapdoor$|_door$|chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|^lectern$|_bed$|_button$|^lever$|_fence_gate$|^anvil$|_anvil$|^bell$|^brewing_stand$|^composter$|^cartography_table$|^loom$|^stonecutter$|^grindstone$|^smithing_table$|^enchanting_table$|^beacon$|^dispenser$|^dropper$|^note_block$|^jukebox$|^repeater$|^comparator$|^daylight_detector$|_sign$|^cake$|^respawn_anchor$|^lodestone$|^campfire$|^soul_campfire$|^crafter$|^chiseled_bookshelf$|^flower_pot$|^potted_|candle$|candle_cake$/
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
 *   acks           the connection's tracker (skills.mjs shopAckInstall, installed before login); none: one is installed for
 *                  this visit and removed at close (the Paper drivers' bare bots)
 *   keep           { name: n } the bag's keeps at the visit's start (`has` counts above them)
 *   withWalk(fn)   the caller's scoped walk profile (index.mjs); identity by default
 *   aborted()      the skill's signal
 *   log(kind, d)   the row writer (the skill's logEvent)
 *   spawnedAt()    ms of the last spawn
 */
export function botBuildEffects (bot, { acks = null, keep = {}, withWalk = fn => fn(), aborted = () => false, log = () => {}, spawnedAt = () => 0, pathMs = PATH_MS } = {}) {
  const own = !acks
  const A = acks ?? installAckTracker(bot)
  const blocks = installServerBlockWitness(bot)
  const timers = new Set()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const items = () => bot.inventory?.items?.() ?? []
  const count = n => items().filter(i => i.name === n).reduce((s, i) => s + (i.count ?? 1), 0)
  const spare = n => count(n) - (Number(keep?.[n]) || 0)
  const has = n => spare(n) > 0
  has.planks = () => [...new Set(items().map(i => i.name).filter(n => /_planks$/.test(n)))].find(n => spare(n) > 0) ?? null
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
      let timer = null
      try {
        await withWalk(() => Promise.race([
          bot.pathfinder.goto(new goals.GoalBlock(s[0], s[1], s[2])),
          new Promise(resolve => { timer = setTimeout(() => { timers.delete(timer); try { bot.pathfinder.setGoal(null) } catch { /* idle */ } resolve() }, pathMs); timers.add(timer) }),
        ]))
      } catch (e) { if (e?.aborted || aborted()) throw e } finally { if (timer) { clearTimeout(timer); timers.delete(timer) } }
      return true
    },
    hold: async n => {
      const it = items().find(i => i.name === n)
      if (!it || !has(n)) return false
      if (bot.heldItem?.name !== n) { try { await bot.equip(it, 'hand') } catch (e) { if (e?.aborted) throw e } }
      return bot.heldItem?.name === n
    },
    has,
    look: async (support, face) => { try { await bot.lookAt(new Vec3(support[0] + 0.5 + face[0] * 0.5, support[1] + 0.5 + face[1] * 0.5, support[2] + 0.5 + face[2] * 0.5), true) } catch { /* not fatal */ } },
    nextSeq: () => A.tracker.next(),
    send: write,
    waitAck: (seq, ms) => A.tracker.wait(seq, ms),
    track: (id, seq) => A.track(id, seq),
    untrack: id => A.untrack(id),
    conn: () => A.conn ?? null,
    acked: () => A.tracker.acked,
    seen: (holder, t) => A.seen(holder, t),
    dig: async (c, expect = null) => {
      const b = bot.blockAt(new Vec3(c[0], c[1], c[2]))
      if (!b) return 'refused'
      if (expect && b.name !== expect) return 'refused'          // not the named block (gone, or replaced): never dug
      if (b.name === 'air' || b.name === 'cave_air') return 'confirmed'
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
        else { const pick = items().find(i => /_pickaxe$/.test(i.name)); if (!pick) return null; try { await bot.equip(pick, 'hand') } catch { return null } }
        if (/_(axe|shovel|hoe)$/.test(bot.heldItem?.name ?? '')) return null
        const face = [-d[0], -d[1], -d[2]]
        await bot.lookAt(new Vec3(nb[0] + 0.5 + face[0] * 0.5, nb[1] + 0.5 + face[1] * 0.5, nb[2] + 0.5 + face[2] * 0.5), true).catch(() => {})
        blocks.watch(c)
        const seq = A.tracker.next()
        write(nb, face, seq)
        // THE SERVER'S WORD ON THE CELL, or nothing: any name the server sends for it (air, or the block that still stands)
        return await blocks.wait(c, () => true, PROBE_MS)
      }
      return null
    },
    aborted,
    log,
    now: () => Date.now(),
    sleep,
    spawnedAt,
    close: () => { for (const t of timers) clearTimeout(t); timers.clear(); if (own) A.stop(); blocks.stop() },
  }
}
