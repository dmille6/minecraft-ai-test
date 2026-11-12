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
export const PLAN_MS = 150                 // cornerWaypoints' A* per leg (the walk itself plans again as before)
export const PROBE_MS = 2_000
export const RISE_UP = 1.1      // a pillar step's place is sent once the feet are this far above the cell's floor (the jump's top is ~1.25)
export const RISE_MS = 800
export const LAND_MS = 1_500
// never the clicked block of a probe, and never a support (they open, toggle or act): buildsite.mjs USES plus the rest
// (r2, Claude r1 P3-7: crafter, chiseled bookshelf, flower pots and candles act on an empty-hand click)
export const INTERACTABLE = /_trapdoor$|_door$|chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|^lectern$|_bed$|_button$|^lever$|_fence_gate$|^anvil$|_anvil$|^bell$|^brewing_stand$|^composter$|^cartography_table$|^loom$|^stonecutter$|^grindstone$|^smithing_table$|^enchanting_table$|^beacon$|^dispenser$|^dropper$|^note_block$|^jukebox$|^repeater$|^comparator$|^daylight_detector$|_sign$|^cake$|^respawn_anchor$|^lodestone$|^campfire$|^soul_campfire$|^crafter$|^chiseled_bookshelf$|^flower_pot$|^potted_|candle$|candle_cake$/
const FACE_DIR = f => (f[1] < 0 ? 0 : f[1] > 0 ? 1 : f[2] < 0 ? 2 : f[2] > 0 ? 3 : f[0] < 0 ? 4 : 5)
/** townstyle-01: a notchian yaw (degrees; south 0, west 90) -> mineflayer's radians (conversions.js toNotchianYaw = deg(PI - yaw)). */
export const yawRad = deg => Math.PI - (deg * Math.PI) / 180
/** The pitch a look packet carries: the bot's own, notchian (conversions.js toNotchianPitch = deg(-pitch)). */
const aimPitch = bot => Math.fround((-(Number(bot.entity?.pitch) || 0) * 180) / Math.PI)

/**
 * THE CORNER CUT (shopwalls-02; LIVE showcase 10-28 14:44Z on: with the walls up, 8 of 10 builders stood wedged at
 * 21.1,74,32.3 -- the back corner of the 1-wide ring top -- for 35 s until the stuck reflex aborted the visit, 12+ visits, roof
 * 2 of 20). mineflayer-pathfinder's getMoveDiagonal allows a diagonal step when only ONE of its two side columns is clear
 * (it costs the cheaper side), so from the ring corner 21,74,32 the path to the stand 20,74,31 is one diagonal step across
 * the wall's corner block 21,74,31, and the body catches on that corner. Replayed offline on the live region with the
 * pathfinder's own A*: `21,74,32 -> 20,74,31` as a single step.
 * -> { i, via } for the FIRST diagonal step of `path` (from `start`) whose side columns are not BOTH clear, with `via` the
 * clear side's standing cell (feet and head room over the step's heights, a full floor under it), or null. Pure. A step whose
 * clear side has no floor is left alone (a drop is not a safer step than a corner).
 */
export function cornerCut (start, path, read, { square = false } = {}) {
  const clear = (x, y, z) => { const b = read(x, y, z); return !!b && b.boundingBox === 'empty' }
  const floor = (x, y, z) => { const b = read(x, y, z); return !!b && b.boundingBox === 'block' }
  // BLOCK cells (r1 reviews, both BLOCK: the pathfinder's post-processed nodes are block CENTRES, x.5 / z.5): floored here
  const cell = p => ({ x: Math.floor(p.x), y: Math.floor(p.y + 1e-6), z: Math.floor(p.z) })
  let a = cell(start)
  for (let i = 0; i < (path?.length ?? 0); i++) {
    const b = cell(path[i])
    const dx = b.x - a.x, dz = b.z - a.z
    if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y) + 1
      const col = (x, z) => { for (let y = lo; y <= hi; y++) if (!clear(x, y, z)) return false; return true }
      const sx = [a.x + dx, a.z], sz = [a.x, a.z + dz]
      const okX = col(...sx), okZ = col(...sz)
      if (!(okX && okZ)) {
        const side = okX ? sx : okZ ? sz : null
        if (side && floor(side[0], a.y - 1, side[1])) return { i, via: [side[0], a.y, side[1]] }
        // reroof-04 r5 (Paper sandbox4 11-08: a builder dropped into a cavity by the storage hub, 14,67,-47; the pathfinder's plan out was
        // ONE diagonal jump-up to 15,68,-46 with BOTH side columns blocked -- the body never left the cell, every walk timed out; nudged
        // onto 15,68,-47 by hand it walked out in 4.9 s): with neither side column clear, a side that is a STANDING cell at the step's
        // other height (a full floor, feet and head open) is the via -- the step is taken square, up (or down) then across
        // reroof-04 r6 (REROOF_CORNERCUT): only a visit that asks (`square`: a re-roofed record's own visit); every other walk as before
        if (square && !side && b.y !== a.y) {
          const stand = (x, y, z) => floor(x, y - 1, z) && clear(x, y, z) && clear(x, y + 1, z) && clear(a.x, Math.max(a.y, y) + 1, a.z)
          for (const q of [sx, sz]) if (stand(q[0], b.y, q[1])) return { i, via: [q[0], b.y, q[1]] }
        }
      }
    }
    a = b
  }
  return null
}
/**
 * DOES A PLANNED PATH CROSS AN OPEN CELL OF THE SEGMENT BEING BUILT? -> bool. Pure. (shopwalls-06; LIVE showcase 10-28: the
 * walk to the interior stand for the last roof cell 24,75,31 was planned as `23,74,32 > 24,75,31 > 24,73,30` -- up through
 * that very cell, over the wall -- and the bots wedged jumping at the roof overhang; replayed offline with the pathfinder's own
 * A*.) A node's feet or head cell in `avoid` ("x,y,z") is a cross; nodes are floored (the pathfinder's centres).
 */
export function pathCrosses (path, avoid) {
  if (!avoid?.size) return false
  for (const p of path ?? []) {
    const x = Math.floor(p.x), y = Math.floor(p.y + 1e-6), z = Math.floor(p.z)
    if (avoid.has(`${x},${y},${z}`) || avoid.has(`${x},${y + 1},${z}`)) return true
  }
  return false
}
/**
 * THE SEGMENT'S OPEN CELLS AS A STEP FENCE (storehouse-01, LIVE showcase 11-01 14:15Z: a builder standing INSIDE the storehouse,
 * its back wall half laid, planned every walk to an outside stand straight through the wall's open gaps -- pathCrosses refused each
 * plan, so every click was a `stand` ban and the wall stopped `attempts_spent` with 0 placed, visit after visit) -> an
 * exclusionAreasStep entry pricing a feet or head cell in `avoid` at 101 (mineflayer-pathfinder drops a move over 100), so the A*
 * routes AROUND the open cells, as the siting proof's walk does (they are obstacles there), instead of through them. null when
 * there is nothing to avoid. Pure.
 */
export const STEP_FENCE_COST = 101
export function stepFence (avoid) {
  if (!avoid?.size) return null
  const f = b => { const p = b?.position; return p && avoid.has(`${p.x},${p.y},${p.z}`) ? STEP_FENCE_COST : 0 }
  f.segmentFence = true
  return f
}
/** Run `fn` with the fence on `movements` (a NEW array: the profiles that share the old one by reference are untouched), and the
 *  old array back after, on every exit (only if it is still ours). */
export async function withStepFence (movements, avoid, fn) {
  const fence = movements && Array.isArray(movements.exclusionAreasStep) ? stepFence(avoid) : null
  if (!fence) return fn()
  const prev = movements.exclusionAreasStep
  const mine = [...prev, fence]
  movements.exclusionAreasStep = mine
  try { return await fn() } finally {
    // ours: the old array back; replaced meanwhile but still carrying our fence (Codex r3 BLOCK: a timed-out walk's cleanup ran
    // after the NEXT walk had saved the fenced array as its `prev`): our fence taken out by identity
    if (movements.exclusionAreasStep === mine) movements.exclusionAreasStep = prev
    else if (Array.isArray(movements.exclusionAreasStep) && movements.exclusionAreasStep.includes(fence)) movements.exclusionAreasStep = movements.exclusionAreasStep.filter(g => g !== fence)
  }
}
/**
 * THE WAYPOINTS for a walk to `goal` -> [[x, y, z]] ending at goal: the planned path's corner cuts replaced by the step round the
 * clear side (cornerCut), re-planned from each `via`, at most `max` detours. `plan(from)` -> path [{ x, y, z }] | null (the
 * pathfinder's A*); null or an unplannable leg: the remaining walk is the plain goal (the walk as before). Pure.
 */
export function cornerWaypoints (from, goal, plan, read, max = 4, { square = false } = {}) {
  const out = []
  let at = from
  for (let n = 0; n < max; n++) {
    const path = plan(at)
    if (!path) break
    const cut = cornerCut({ x: at[0], y: at[1], z: at[2] }, path, read, { square })
    if (!cut) break
    if (cut.i > 0) { const p = path[cut.i - 1]; out.push([Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)]) }
    out.push(cut.via)
    at = cut.via
  }
  out.push(goal)
  return out
}

/**
 * reroof-04 r6: THE LEAVES A PLANNED JUMP-UP NEEDS DUG FIRST -> [{ i, lower: [x, y, z], at: [x, y, z], name }]. Pure. For every step of
 * `path` (from `start`) that rises one block: the natural leaf at the lower cell's y + 2 (the jump's head room) and at the upper cell's
 * y + 2 (its apex: a jump from feet y peaks near y + 1.25 + 1.8) -- LIVE Paper sandbox4 11-08: the workshop's builder in the pit at
 * 32,68,-71 planned the jump to 31,69,-71 under the leaf 31,71,-71 and jumped in place for 25 s, every walk -- only a NATURAL leaf
 * (persistent false) whose name is the one `listed(key)` names (the record's apex leaves: on the record for the tripwire), at most `max`.
 */
export function apexDigs (start, path, read, listed = () => false, max = 3) {
  const cell = p => ({ x: Math.floor(p.x), y: Math.floor(p.y + 1e-6), z: Math.floor(p.z) })
  // Codex r6 BLOCKER: never a placed leaf (persistent true) or another kind than the record listed there
  const leaf = at => { const b = read(...at); if (!b || !/_leaves$/.test(String(b.name ?? ''))) return null; const want = listed(at.join(',')); const p = b.props?.persistent; return want && want === b.name && (p === false || p === 'false') ? String(b.name) : null }
  const out = [], seen = new Set()
  let a = cell(start)
  for (let i = 0; i < (path?.length ?? 0) && out.length < max; i++) {
    const b = cell(path[i])
    if (b.y === a.y + 1 && Math.abs(b.x - a.x) + Math.abs(b.z - a.z) >= 1) {
      for (const at of [[a.x, a.y + 2, a.z], [b.x, b.y + 2, b.z]]) {
        const k = at.join(','), n = leaf(at)
        if (n && !seen.has(k) && out.length < max) { seen.add(k); out.push({ i, lower: [a.x, a.y, a.z], at, name: n }) }
      }
    }
    a = b
  }
  return out
}

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

/**
 * standcache-01 r2 (Codex r2 BLOCKER): HAS THE WORLD THIS CONNECTION WAS TOLD OF MOVED NEAR `at` SINCE `since`? -> bool. Pure.
 *   recent   the witness's last changes, oldest first: [seq, x0, z0, x1, z1] (a block: its own column; a chunk: its 16 x 16)
 *   seq      the witness's count now          since   the count the asker kept
 *   at       { x, z, r }: the square asked about (a town walk: home and its radius)
 * True when a change after `since` touches the square -- and when the changes after `since` are no longer all in `recent` (more
 * than it keeps: what was dropped cannot be read, so it moved). False only when every change since is known to lie outside.
 */
export const WITNESS_KEPT = 512
export function movedNear (recent, seq, since, at) {
  if (!(seq > since)) return false
  if (!recent.length || recent[0][0] > since + 1) return true
  const x0 = at.x - at.r, x1 = at.x + at.r, z0 = at.z - at.r, z1 = at.z + at.r
  return recent.some(c => c[0] > since && c[1] <= x1 && c[3] >= x0 && c[2] <= z1 && c[4] >= z0)
}
/**
 * standcache-01 r2: IS THIS WORD ON A CELL A CHANGE A WALK OF THE TOWN COULD READ? -> bool. Pure. `was` / `now`: { id, name } (the
 * block's state id and name; `was` null: the witness's first word on the cell). The walk reads a block's name, its box, its
 * shapes and its properties (buildsite.mjs walkFrom: fullCube, slabTopFloor, isPassable, isLiquid), so ANOTHER STATE UNDER THE SAME
 * NAME counts too -- a slab made double, stairs turned, a trapdoor opened, snow a layer deeper -- except for the names whose every
 * state stands the same (STATE_ONLY: a crop's age, a liquid's level, a leaf's distance, farmland's moisture, a furnace lit): those
 * tick all day in a town and would drop every kept walk for nothing. An unread name or id: a change.
 */
export const STATE_ONLY = /^(wheat|carrots|potatoes|beetroots|nether_wart|sweet_berry_bush|melon_stem|pumpkin_stem|sugar_cane|cactus|water|lava|farmland|fire|grass_block|podzol|mycelium|redstone_wire|furnace|blast_furnace|smoker)$|_leaves$|_sapling$/
export function wordMoves (was, now) {
  if (!was || now?.name == null || was.name == null) return true
  if (was.name !== now.name) return true
  if (was.id === now.id) return false
  return !STATE_ONLY.test(now.name)
}
/**
 * The SERVER'S word on a cell, from the raw packets -> { watch(cell), wait(cell, pred, ms) -> name | null, stop, seq(), moved(since, at) }.
 * standcache-01 r2: `seq()` counts what this connection has been TOLD has changed -- a block whose state a walk could read
 * differently than the witness's last word on the cell (wordMoves: a first word counts; a crop's age or a water level does not), a
 * chunk loaded or unloaded -- and `moved(since, at)` says whether any of it since `since` lies in a square (movedNear). A walk of
 * the town kept by a build visit (buildrun.mjs nodesFor) is exactly as fresh as a new one while nothing moved: both read this
 * bot's own view.
 */
export function installServerBlockWitness (bot) {
  const seen = new Map()
  const waiters = []
  const nameOf = id => bot.registry?.blocksByStateId?.[id]?.name ?? null
  let seq = 0
  const recent = [], last = new Map()   // last: a cell's last word { id, name } (never forgotten by `watch`: that is the waiters')
  const moved = (x0, z0, x1, z1) => { recent.push([++seq, x0, z0, x1, z1]); if (recent.length > WITNESS_KEPT) recent.shift() }
  const note = (x, y, z, stateId) => {
    const k = `${x},${y},${z}`, n = nameOf(stateId)
    const now = { id: stateId, name: n }
    if (wordMoves(last.get(k) ?? null, now)) moved(x, z, x, z)
    last.set(k, now)
    seen.set(k, n)
    for (const w of waiters.slice()) if (w.k === k && w.pred(n)) { clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.resolve(n) }
  }
  const onPacket = (data, meta) => {
    try {
      if (meta?.name === 'block_change' && data?.location) note(data.location.x, data.location.y, data.location.z, data.type ?? data.stateId)
      else if (meta?.name === 'multi_block_change') for (const r of decodeMultiBlock(data)) note(r.x, r.y, r.z, r.stateId)
      else if (meta?.name === 'map_chunk' || meta?.name === 'unload_chunk') {
        // a chunk the bot can now read, or no longer can: its whole square (coordinates unread: everywhere). And every last word
        // is forgotten (Codex r3): a chunk sent again may hold another block in a cell than the witness last heard, so a later
        // word that only repeats the old one IS a change -- the next word on any cell counts as a first word
        last.clear()
        const cx = Number(data?.x ?? data?.chunkX), cz = Number(data?.z ?? data?.chunkZ)
        if (Number.isFinite(cx) && Number.isFinite(cz)) moved(cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15); else moved(-Infinity, -Infinity, Infinity, Infinity)
      }
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
    seq: () => seq,
    moved: (since, at) => movedNear(recent, seq, since, at),
  }
}

/**
 * keeperstall-01: HAS THIS BOT'S CONNECTION ENDED? -> bool. THE ONE DEFINITION (skills.mjs `clientEnded` is this function). Pure.
 * True on any of (minecraft-protocol 1.66.2 src/client.js, readable-stream 4.7; each seen on ci2 with the locked modules, 11-10):
 *   `_client.ended === true`                  set by the socket's close / end / timeout / fatal error (false from setSocket on)
 *   `_client.socket.destroyed === true`       the socket is gone
 *   `_client.serializer.writableEnded === true`   r2: client.end() was CALLED (mineflayer's keepalive timeout, a kick, bot.quit):
 *                                             end() ends the serializer SYNCHRONOUSLY and only destroys the socket on a 30 s close
 *                                             timer; until the socket closes `ended` and `destroyed` are both still false, and every
 *                                             write() is already a no-op (`serializer.writable` false)
 *   `_client.socket.writableEnded === true`   the same a turn later (the chain has ended the socket), and end() with no serializer
 * Never true on a healthy connected client: a state change (login -> configuration -> play, and play -> configuration -> play)
 * REPLACES the serializer with a new one and ends none; compression and encryption re-pipe, they end nothing.
 * NOT COVERED: a connection the SERVER has dropped whose close this process has not processed yet (the event loop busy, or a dead
 * network with no FIN) -- nothing local says so until the socket event runs; and end() followed by a state change (the new
 * serializer reads open until the socket closes). A bot with no client (a test's fake), or a client with none of these: NOT ended.
 */
export const connEnded = bot => {
  const c = bot?._client
  if (!c) return false
  return c.ended === true || c.socket?.destroyed === true || c.serializer?.writableEnded === true || c.socket?.writableEnded === true
}
/** keeperstall-01 r2: IS THIS VISIT GONE? -> bool: the skill was aborted (`signal`), or its bot's connection has ended (connEnded).
 *  What a gone visit saw says nothing about the world: nothing of it is written to the bot's process memory (procmem.mjs) or waived
 *  on a record. Pure. */
export const visitGone = (bot, signal) => !!signal?.aborted || connEnded(bot)
/**
 * -> runVisit's effects for `bot`, plus close(). Options:
 *   acks           the connection's tracker (skills.mjs shopAckInstall, installed before login); none: one is installed for
 *                  this visit and removed at close (the Paper drivers' bare bots)
 *   keep           { name: n } the bag's keeps at the visit's start (`has` counts above them)
 *   withWalk(fn)   the caller's scoped walk profile (index.mjs); identity by default
 *   aborted()      the skill's signal; keeperstall-01: the effects' own `aborted()` is ALSO true once this bot's connection has
 *                  ended (connEnded) -- index.mjs's `end` handler does not cancel the running skill, so a visit that yields
 *                  (buildrun.mjs breathe) learns here that nobody is on the other end of its digs and clicks
 *   log(kind, d)   the row writer (the skill's logEvent)
 *   spawnedAt()    ms of the last spawn
 */
export function botBuildEffects (bot, { acks = null, keep = {}, withWalk = fn => fn(), aborted: skillAborted = () => false, log = () => {}, spawnedAt = () => 0, pathMs = PATH_MS, cornerSquare = false, apexDig = null } = {}) {
  const own = !acks
  // keeperstall-01: ONE definition for every use below and for the visit (`e.aborted()`): the skill's signal, or the connection gone
  const aborted = () => !!skillAborted() || connEnded(bot)
  const A = acks ?? installAckTracker(bot)
  const blocks = installServerBlockWitness(bot)
  const timers = new Set()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const items = () => bot.inventory?.items?.() ?? []
  const count = n => items().filter(i => i.name === n).reduce((s, i) => s + (i.count ?? 1), 0)
  const spare = n => count(n) - (Number(keep?.[n]) || 0)
  const has = n => spare(n) > 0
  has.planks = () => [...new Set(items().map(i => i.name).filter(n => /_planks$/.test(n)))].find(n => spare(n) > 0) ?? null
  // townstyle-01: the block's PROPERTIES ride along, read only when asked (`props`: a stair's facing and half, a log's axis), so the
  // thousands of reads a walk makes cost nothing more
  const read = (x, y, z) => {
    const b = bot.blockAt(new Vec3(x, y, z))
    if (!b) return null
    return { name: b.name, boundingBox: b.boundingBox, get props () { try { return b.getProperties?.() ?? null } catch { return null } } }
  }
  // townstyle-01: an AIMED click (townstyle.mjs orientAim): the yaw a stair's facing needs goes to the server as its OWN look packet
  // immediately before the block_place, in the same synchronous write (mineflayer's lookAt(force) only queues its look for the next
  // physics tick: a click in the same tick is judged with the old yaw), and the cursor sits where the state's half needs it
  const write = (support, face, seq, aim = null) => {
    const cur = Array.isArray(aim?.cursor) ? aim.cursor : [0.5 + face[0] * 0.5, 0.5 + face[1] * 0.5, 0.5 + face[2] * 0.5]
    if (Number.isFinite(aim?.yaw)) {
      const onGround = !!bot.entity?.onGround
      bot._client.write('look', { yaw: aim.yaw, pitch: aimPitch(bot), onGround, flags: { onGround, hasHorizontalCollision: false } })
    }
    bot._client.write('block_place', {
      location: new Vec3(support[0], support[1], support[2]), direction: FACE_DIR(face), hand: 0,
      cursorX: cur[0], cursorY: cur[1], cursorZ: cur[2],
      insideBlock: false, worldBorderHit: false, sequence: seq,
    })
    try { bot.swingArm?.('right') } catch { /* cosmetic */ }
  }
  return {
    read,
    feet: () => { const p = bot.entity.position; return [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)] },
    self: () => { const p = bot.entity.position; return { x: p.x, y: p.y, z: p.z, w: bot.entity.width ?? 0.6, h: bot.entity.height ?? 1.8 } },
    bodies: () => Object.values(bot.entities ?? {})
      .filter(e => e && e !== bot.entity && e.position && !['item', 'experience_orb', 'arrow'].includes(e.name) && e.position.distanceTo?.(bot.entity.position) < BODY_RADIUS)
      .map(e => ({ x: e.position.x, y: e.position.y, z: e.position.z, w: e.width ?? 0.6, h: e.height ?? 1.8 })),
    walkTo: async (s, { avoid = null } = {}) => {
      let timer = null, late = false
      try {
        // storehouse-01: the A* never routes through the segment's open cells (stepFence), so a stand behind them is reached the long
        // way -- the fence scoped round the WHOLE race (Codex r3 BLOCK): it is off again before walkTo returns, the clock's end included
        await withWalk(() => withStepFence(bot.pathfinder?.movements, avoid, () => Promise.race([
          (async () => {
            // round a corner the pathfinder would cut (cornerCut): planned once, walked leg by leg, inside the same clock
            let legs = [s], crosses = false
            try {
              const plan = from => {
                const it = bot.pathfinder.getPathFromTo?.(bot.pathfinder.movements, new Vec3(from[0] + 0.5, from[1], from[2] + 0.5), new goals.GoalBlock(s[0], s[1], s[2]), { timeout: PLAN_MS, tickTimeout: PLAN_MS, optimizePath: false })
                const r = it?.next?.()?.value?.result
                const path = r?.status === 'success' ? r.path : null
                if (path && pathCrosses(path, avoid)) crosses = true
                return path
              }
              const p = bot.entity.position
              legs = cornerWaypoints([Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)], s, plan, read, 4, { square: cornerSquare })
              // reroof-04 r6 (`apexDig(key)`, a re-roofed record's visit only): a listed leaf over a jump-up this walk plans is dug from the
              // jump's lower cell first (walked to, then dug), so the jump is never taken under it
              if (typeof apexDig === 'function') {
                const f0 = [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)]
                const path0 = plan(f0)
                for (const d of apexDigs({ x: f0[0], y: f0[1], z: f0[2] }, path0, read, apexDig)) {
                  if (aborted() || late) return
                  const here = bot.entity.position
                  if (Math.floor(here.x) !== d.lower[0] || Math.floor(here.y + 1e-6) !== d.lower[1] || Math.floor(here.z) !== d.lower[2]) await bot.pathfinder.goto(new goals.GoalBlock(d.lower[0], d.lower[1], d.lower[2]))
                  const blk = bot.blockAt(new Vec3(d.at[0], d.at[1], d.at[2]))
                  if (!blk || blk.name !== d.name) continue
                  let pers = null
                  try { pers = blk.getProperties?.()?.persistent } catch { pers = null }
                  if (!(pers === false || pers === 'false')) continue   // re-read at the dig: a natural leaf only
                  blocks.watch(d.at)
                  try { await bot.dig(blk, true) } catch (e) { if (e?.aborted || aborted()) throw e; continue }
                  if (await blocks.wait(d.at, x => x === 'air' || x === 'cave_air', DIG_CONFIRM_MS)) log('_build', { op: 'clear', cell: d.at, block: d.name, kind: 'leaves' })
                }
              }
            } catch (e) { if (e?.aborted || aborted()) throw e; legs = [s] }
            // THROUGH THE SEGMENT'S OWN OPEN CELLS (pathCrosses): not walked -- the click's re-proof fails, the stand is banned
            // (standBans) and the cell's next-best stand is tried
            if (crosses) return
            for (const w of legs) { if (aborted() || late) return; await bot.pathfinder.goto(new goals.GoalBlock(w[0], w[1], w[2])) }
          })(),
          new Promise(resolve => { timer = setTimeout(() => { late = true; timers.delete(timer); try { bot.pathfinder.setGoal(null) } catch { /* idle */ } resolve() }, pathMs); timers.add(timer) }),
        ])))
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
    look: async (support, face, aim = null) => {
      try {
        await bot.lookAt(new Vec3(support[0] + 0.5 + face[0] * 0.5, support[1] + 0.5 + face[1] * 0.5, support[2] + 0.5 + face[2] * 0.5), true)
        // townstyle-01: an aimed click keeps the face's pitch and turns to the state's yaw, so mineflayer's own next look agrees with
        // the look packet the send writes
        if (Number.isFinite(aim?.yaw)) await bot.look(yawRad(aim.yaw), bot.entity.pitch, true)
      } catch { /* not fatal */ }
    },
    nextSeq: () => A.tracker.next(),
    send: write,   // (support, face, seq, aim?) -- townstyle-01's aimed click when `aim` is given
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
      // boardwalk-03: a block dug out of water reads WATER once the lake flows back in: gone either way
      const n = await blocks.wait(c, x => x === 'air' || x === 'cave_air' || x === 'water', DIG_CONFIRM_MS)
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
    // VOIDFILL-01 (buildrun.mjs runVisit `p.access`): the bag's spare count; the pillar step's jump (RISE: jump held until the
    // feet are RISE_UP above the cell's floor, one tick more so the server has the position, -> true; never airborne: false,
    // jump released) and its landing (LAND: jump released, on the ground or LAND_MS); SETTLE after a dig underfoot (the drop);
    // TOOL: the pickaxe with the most uses left (at least 2) in hand for the access's digs, nothing changed without one
    count: n => Math.max(0, spare(n)),
    rise: async feetY => {
      bot.setControlState('jump', true)
      const t0 = Date.now()
      while (Date.now() - t0 < RISE_MS) {
        if (aborted()) break
        if (bot.entity.position.y >= feetY + RISE_UP) { await sleep(60); return true }
        await sleep(20)
      }
      bot.setControlState('jump', false)
      return false
    },
    land: async () => {
      bot.setControlState('jump', false)
      const t0 = Date.now()
      await sleep(100)
      while (Date.now() - t0 < LAND_MS && !bot.entity.onGround) await sleep(25)
      await sleep(50)
    },
    settle: async () => {
      const t0 = Date.now()
      await sleep(150)
      while (Date.now() - t0 < LAND_MS && !bot.entity.onGround) await sleep(25)
      await sleep(100)
    },
    tool: async () => {
      const left = i => (Number(i.maxDurability) || 0) - (Number(i.durabilityUsed) || 0)
      const pick = items().filter(i => /_pickaxe$/.test(i.name) && left(i) >= 2).sort((a, b) => left(b) - left(a))[0]
      if (!pick || bot.heldItem === pick) return
      try { await bot.equip(pick, 'hand') } catch (e) { if (e?.aborted) throw e }
    },
    aborted,
    log,
    now: () => Date.now(),
    // standcache-01 r2: what this connection has been told has changed (installServerBlockWitness seq / moved)
    worldSeq: () => blocks.seq(),
    worldMoved: (since, at) => blocks.moved(since, at),
    sleep,
    spawnedAt,
    close: () => { for (const t of timers) clearTimeout(t); timers.clear(); if (own) A.stop(); blocks.stop() },
  }
}
