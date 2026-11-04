// ATLAS-01: THE BOTS' SHARED MAP -- where the town's bots have been, and what they noticed there.
//
// Why this exists (owner 11-04): the BlueMap trails showed every expedition walking one of eight straight spokes out and back,
// and the map the host drew (wholemap.py's coverage) was ours alone -- no bot ever read it. A map no bot uses is a picture. So
// this is the bots' OWN memory of the ground, written by the bots, read by the bots, and drawn on BlueMap from the very same
// files (wholemap.py reads `atlas-*.json`), so the picture is exactly what they act on and nothing else.
//
// What a bot RECORDS (installAtlas, every TICK_MS):
//   cells  a CELL x CELL grid of the surface: `seen` when the bot stood under the sky within SEEN_R of it (the reflex survey's
//          findBlocks radius: what a bot standing here notices), `stood` when it stood in it at any depth
//   finds  what a scan saw (FIND_KINDS: wood, ore, plants, materials, landmarks, hazards), merged per kind within the kind's radius,
//          scanned every SCAN_MS or every SCAN_MOVE blocks walked (an expedition at 3 b/s would otherwise scan once per 90 blocks)
//   gone   a find a bot stood beside and read as no longer there (felled, mined): it stops being offered to anyone
//   aims   each expedition's pick (expedition.mjs planTrip): why it went where it went -- the layer draws them
//
// What reads it (the point of the module):
//   expedition.mjs planTrip   frontier trips aim at the bearing whose swath crosses the most cells nobody has seen in FRESH_MS;
//                             harvest trips aim at the densest wood the map knows, instead of re-walking the last good spoke
//   prompt.mjs MAP line       the brain sees the finds that serve its task, the hazards around it and the nearest unexplored side
//   wholemap.py               the BlueMap layer: explored cells, finds, hazards and every trip's aim with its reason
//
// CONCURRENCY. One file PER BOT (`atlas-<name>.json`), written only by that bot, atomically (tmp + rename): no lock, no clobber,
// the expedition state's own pattern. Readers fold every bot's file (foldAtlas) and cache the fold for VIEW_TTL_MS.
//
// Switch: ATLAS=on|off; unset = on only in the pools ATLAS_POOLS names (default 'showcase'), as expeditionOn. Off: no install,
// no bot.atlas, so planTrip and the prompt line behave exactly as before.
import fs from 'node:fs'
import path from 'node:path'

export const CELL = 32
export const SEEN_R = 40                        // reflex.mjs's survey radius (findBlocks maxDistance 40)
export const SKY_SEEN = 10                      // feet sky light >= this: under the sky (a bot in a tunnel notices no surface)
export const SKY_Y = 58                         // ...and the fallback before any light reading arrives (the showcase surface is 62-90)
export const FRESH_MS = 3 * 24 * 60 * 60_000    // a cell seen longer ago than this is frontier again (trees regrow, bots forget)
export const TICK_MS = 5_000
export const SCAN_MS = 30_000
export const SCAN_MIN_MS = 5_000
export const SCAN_MOVE = 24
export const SCAN_R = 32
export const FLUSH_MS = 60_000
export const VIEW_TTL_MS = 60_000
export const MAX_CELLS = 8_000                  // per bot (~250 KB); the oldest-seen go first
export const MAX_FINDS = 400, MAX_WOOD = 150, MAX_GONE = 300, MAX_AIMS = 30
export const TOWN_SKIP_R = 64                   // the town's own chests, logs and rails are not finds
export const GONE_R = 10, GONE_DY = 8
export const LAVA_DY = 6                        // lava more than this below the bot is the aquifer, not a pool on the walk
export const FILE_PREFIX = 'atlas-'
export const ATLAS_V = 1

// kind -> [category, merge radius]
const K = (cat, r, names) => Object.fromEntries(names.map(n => [n, [cat, r]]))
export const FIND_KINDS = Object.freeze({
  ...K('wood', 24, ['oak_log', 'spruce_log', 'birch_log', 'dark_oak_log', 'jungle_log', 'acacia_log', 'cherry_log', 'mangrove_log']),
  ...K('ore', 12, ['coal_ore', 'iron_ore', 'deepslate_iron_ore', 'copper_ore', 'deepslate_copper_ore', 'gold_ore', 'deepslate_gold_ore',
    'lapis_ore', 'deepslate_lapis_ore', 'redstone_ore', 'deepslate_redstone_ore', 'diamond_ore', 'deepslate_diamond_ore', 'emerald_ore',
    'deepslate_emerald_ore']),
  ...K('plant', 16, ['sugar_cane', 'pumpkin', 'melon', 'bamboo', 'cactus', 'sweet_berry_bush', 'brown_mushroom', 'red_mushroom', 'bee_nest', 'cocoa']),
  ...K('material', 16, ['clay', 'obsidian', 'crying_obsidian', 'amethyst_block', 'budding_amethyst', 'blue_ice']),
  ...K('landmark', 24, ['bell', 'spawner', 'chest', 'mossy_cobblestone', 'cobweb', 'rail', 'end_portal_frame', 'suspicious_sand', 'suspicious_gravel']),
  ...K('hazard', 12, ['lava', 'magma_block', 'powder_snow']),
})
export const CATEGORIES = Object.freeze(['wood', 'ore', 'plant', 'material', 'landmark', 'hazard'])
export const categoryOf = kind => FIND_KINDS[kind]?.[0] ?? null

const OFF = ['off', '0', 'false', 'no']
const ON = ['on', '1', 'true', 'yes']
/** THE SWITCH -> bool. Pure. */
export function atlasOn (env = process.env, pool = '') {
  const v = String(env?.ATLAS ?? '').trim().toLowerCase()
  if (ON.includes(v)) return true
  if (OFF.includes(v)) return false
  const pools = String(env?.ATLAS_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
/** `_atlas_mode` licence row detail. Pure. */
export const atlasModeDetail = (on, pool = '') =>
  `on=${on ? 1 : 0} pool=${pool || '-'} cell=${CELL} seen_r=${SEEN_R} fresh_h=${FRESH_MS / 3_600_000} scan_r=${SCAN_R} kinds=${Object.keys(FIND_KINDS).length}`

// ---- the grid -------------------------------------------------------------------------------------------------------------------

export const cellOf = (x, z) => [Math.floor(x / CELL), Math.floor(z / CELL)]
export const cellKey = (cx, cz) => `${cx},${cz}`
export const keyAt = (x, z) => cellKey(...cellOf(x, z))
export const cellCentre = key => { const [cx, cz] = String(key).split(',').map(Number); return { x: cx * CELL + CELL / 2, z: cz * CELL + CELL / 2 } }

/** Every cell whose nearest point lies within `r` of (x, z) -> [key]. Pure. What a bot standing at (x, z) notices. */
export function cellsSeenFrom (x, z, r = SEEN_R) {
  const out = []
  const [c0x, c0z] = cellOf(x - r, z - r), [c1x, c1z] = cellOf(x + r, z + r)
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) {
      const nx = Math.max(cx * CELL, Math.min(x, cx * CELL + CELL)), nz = Math.max(cz * CELL, Math.min(z, cz * CELL + CELL))
      if (Math.hypot(nx - x, nz - z) <= r) out.push(cellKey(cx, cz))
    }
  }
  return out
}

/** Is this cell frontier (never seen, or not within FRESH_MS)? Pure. `cells`: Map key -> { seen }. */
export const unseen = (cells, key, now, fresh = FRESH_MS) => { const c = cells?.get?.(key); return !c || !(c.seen > 0) || now - c.seen > fresh }

// ---- a bot's own document -------------------------------------------------------------------------------------------------------

export const emptyDoc = by => ({ v: ATLAS_V, by: String(by ?? 'bot'), written: 0, cells: {}, finds: [], gone: [], aims: [] })

/** Mark the cells a bot notices / stands in. Mutates `doc`. -> number of cells newly seen. Pure but for the mutation. */
export function noteCells (doc, { x, z, sky = true, now }) {
  let fresh = 0
  if (sky) {
    for (const k of cellsSeenFrom(x, z)) {
      const c = doc.cells[k] ?? (doc.cells[k] = [0, 0])
      if (!(c[0] > 0)) fresh++
      c[0] = now
    }
  }
  const s = keyAt(x, z)
  const c = doc.cells[s] ?? (doc.cells[s] = [0, 0])
  c[1] = now
  const keys = Object.keys(doc.cells)
  if (keys.length > MAX_CELLS) {
    keys.sort((a, b) => Math.max(...doc.cells[a]) - Math.max(...doc.cells[b]))
    for (const k of keys.slice(0, keys.length - MAX_CELLS)) delete doc.cells[k]
  }
  return fresh
}

/** Merge one sighting into a find list. Mutates `finds`. -> the find (`.isNew` true when it was added). Pure but for the mutation. */
export function mergeFind (finds, { kind, x, y, z }, now, by = 'bot') {
  const meta = FIND_KINDS[kind]
  if (!meta) return null
  const [cat, r] = meta
  const near = finds.find(f => f.kind === kind && Math.hypot(f.x - x, f.z - z) < r)
  if (near) { near.last = now; near.n = (near.n ?? 1) + 1; return { ...near, isNew: false } }
  const f = { kind, cat, x: Math.round(x), y: Math.round(y), z: Math.round(z), first: now, last: now, n: 1, by }
  finds.push(f)
  // bounded: wood is everywhere in a taiga, so it has its own cap; then the oldest of anything
  const wood = finds.filter(q => q.cat === 'wood')
  if (wood.length > MAX_WOOD) { const old = wood.sort((a, b) => a.last - b.last)[0]; finds.splice(finds.indexOf(old), 1) }
  if (finds.length > MAX_FINDS) { const old = [...finds].sort((a, b) => a.last - b.last)[0]; finds.splice(finds.indexOf(old), 1) }
  return { ...f, isNew: true }
}

/** Record a find as gone (read absent where it was). Mutates `doc`. Pure but for the mutation. */
export function noteGone (doc, f, now) {
  doc.gone.push({ kind: f.kind, x: f.x, y: f.y, z: f.z, t: now })
  if (doc.gone.length > MAX_GONE) doc.gone.splice(0, doc.gone.length - MAX_GONE)
  const own = doc.finds.findIndex(q => q.kind === f.kind && q.x === f.x && q.y === f.y && q.z === f.z)
  if (own >= 0) doc.finds.splice(own, 1)
}

/** Record an expedition's pick. Mutates `doc`. */
export function noteAim (doc, aim) {
  doc.aims.push(aim)
  if (doc.aims.length > MAX_AIMS) doc.aims.splice(0, doc.aims.length - MAX_AIMS)
}

// ---- the fold every reader uses ------------------------------------------------------------------------------------------------

/**
 * EVERY BOT'S DOCUMENT -> the town's map { cells: Map key -> {seen, stood}, finds: [...], aims: [...], bots, cellsSeen }. Pure.
 * Cells take the latest stamp of any bot. Finds of one kind within its merge radius are one find (latest `last`, summed `n`, every
 * reporter in `by`), and a find some bot read as GONE after anyone last saw it is dropped.
 */
export function foldAtlas (docs = [], now = Date.now()) {
  const cells = new Map()
  const finds = []
  const gone = []
  const aims = []
  let bots = 0
  for (const d of docs ?? []) {
    if (!d || typeof d !== 'object' || d.v !== ATLAS_V) continue
    bots++
    for (const [k, v] of Object.entries(d.cells ?? {})) {
      if (!Array.isArray(v)) continue
      const c = cells.get(k) ?? { seen: 0, stood: 0 }
      c.seen = Math.max(c.seen, Number(v[0]) || 0); c.stood = Math.max(c.stood, Number(v[1]) || 0)
      cells.set(k, c)
    }
    for (const g of d.gone ?? []) if (FIND_KINDS[g?.kind] && [g.x, g.z, g.t].every(Number.isFinite)) gone.push(g)
    for (const a of d.aims ?? []) if (a && Number.isFinite(a.t)) aims.push({ ...a, by: a.by ?? d.by })
    for (const f of d.finds ?? []) {
      if (!FIND_KINDS[f?.kind] || ![f.x, f.y, f.z].every(Number.isFinite)) continue
      const r = FIND_KINDS[f.kind][1]
      const near = finds.find(q => q.kind === f.kind && Math.hypot(q.x - f.x, q.z - f.z) < r)
      if (near) {
        if ((f.last ?? 0) > (near.last ?? 0)) Object.assign(near, { x: f.x, y: f.y, z: f.z, last: f.last })
        near.n += Number(f.n) || 1
        near.first = Math.min(near.first, Number(f.first) || near.first)
        if (!near.by.includes(f.by ?? d.by)) near.by.push(f.by ?? d.by)
      } else finds.push({ kind: f.kind, cat: FIND_KINDS[f.kind][0], x: f.x, y: f.y, z: f.z, first: Number(f.first) || 0, last: Number(f.last) || 0, n: Number(f.n) || 1, by: [f.by ?? d.by] })
    }
  }
  const live = finds.filter(f => !gone.some(g => g.kind === f.kind && Math.abs(g.x - f.x) <= 2 && Math.abs(g.z - f.z) <= 2 && Math.abs((g.y ?? f.y) - f.y) <= 2 && g.t >= f.last))
  aims.sort((a, b) => a.t - b.t)
  let cellsSeen = 0
  for (const c of cells.values()) if (c.seen > 0 && now - c.seen <= FRESH_MS) cellsSeen++
  return { cells, finds: live, aims: aims.slice(-60), bots, cellsSeen, gone: gone.length }
}

// ---- the prompt's MAP line --------------------------------------------------------------------------------------------------------

const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']   // Minecraft: +x east, +z south
export const compass = (dx, dz) => DIRS[((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8]
const ago = ms => ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min ago` : `${Math.round(ms / 3_600_000)} h ago`
/** A find serves the task: its kind is wanted, or its item is (logs for planks/sticks; an ore's base for its raw/ingot). Pure. */
export function findServes (kind, wants = []) {
  const w = new Set([...(wants ?? [])].map(String))
  if (w.has(kind)) return true
  const base = kind.replace(/^deepslate_/, '')
  if (w.has(base)) return true
  const metal = base.match(/^(iron|gold|copper)_ore$/)?.[1]
  if (metal && (w.has(`raw_${metal}`) || w.has(`${metal}_ingot`))) return true
  if (base === 'coal_ore' && (w.has('coal') || w.has('torch'))) return true
  if (/_log$/.test(kind) && [...w].some(x => /(_log|_planks|^stick$|crafting_table|^chest$)/.test(x))) return true
  if (base === 'diamond_ore' && w.has('diamond')) return true
  if (base === 'lapis_ore' && w.has('lapis_lazuli')) return true
  if (base === 'redstone_ore' && w.has('redstone')) return true
  return false
}

/**
 * THE MAP LINE for the brain's prompt -> string | ''. Pure. Up to `max` finds within `radius`: the ones that serve the task first,
 * then the rarer categories (ore, material, plant, landmark; wood only when wanted -- the taiga is all wood), nearest first; hazards
 * within 48 always (as "avoid"); and the nearest side with unexplored ground. Finds inside a protected zone (a village) are not
 * offered: the zones are keep-out (`inZone` is the expedition's zoneHit, passed in).
 */
export function mapLine (view, { pos, wants = [], now = Date.now(), radius = 200, max = 4, inZone = null, home = null } = {}) {
  if (!view || !pos) return ''
  const d = f => Math.hypot(f.x - pos.x, f.z - pos.z)
  const ok = f => !(inZone && inZone(f.x, f.z, f.y)) && !(home && Math.hypot(f.x - home.x, f.z - home.z) < TOWN_SKIP_R)
  const rank = { ore: 1, material: 2, plant: 3, landmark: 4, wood: 9 }
  const cand = view.finds.filter(f => f.cat !== 'hazard' && d(f) <= radius && ok(f))
    .map(f => ({ f, serve: findServes(f.kind, wants), d: d(f) }))
    .filter(c => c.serve || c.f.cat !== 'wood')
    .sort((a, b) => (b.serve - a.serve) || (rank[a.f.cat] - rank[b.f.cat]) || (a.d - b.d))
    .slice(0, max)
  const hz = view.finds.filter(f => f.cat === 'hazard' && d(f) <= 48).sort((a, b) => d(a) - d(b)).slice(0, 2)
  const parts = []
  for (const { f, serve, d: dd } of cand) {
    parts.push(`${f.kind}${f.n > 1 ? ` x${f.n}` : ''} ${Math.round(dd)} blocks ${compass(f.x - pos.x, f.z - pos.z)} at ${f.x},${f.y},${f.z}` +
      ` (seen by ${f.by.map(b => String(b).replace(/^showcase-/, '')).slice(0, 2).join('+')} ${ago(now - f.last)}${serve ? ', for your task' : ''})`)
  }
  for (const f of hz) parts.push(`AVOID ${f.kind} ${Math.round(d(f))} blocks ${compass(f.x - pos.x, f.z - pos.z)} at ${f.x},${f.y},${f.z}`)
  // the nearest unexplored side: the first ring (64..256, step 32) on which some compass direction is frontier
  let side = ''
  for (let r = 64; r <= 256 && !side; r += 32) {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4
      if (unseen(view.cells, keyAt(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r), now)) { side = `unexplored ground ${r} blocks ${DIRS[i]}`; break }
    }
  }
  if (!parts.length && !side) return ''
  return `MAP (shared by every bot in this town): ${[...parts, side].filter(Boolean).join('; ')}`.slice(0, 600)
}

// ---- I/O -----------------------------------------------------------------------------------------------------------------------------

export const atlasFile = (dir, by) => path.join(dir, `${FILE_PREFIX}${String(by).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)

export function readDoc (file) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d && d.v === ATLAS_V ? d : null } catch { return null }
}
/** Atomic write (tmp + rename): a reader never sees half a file. -> bytes | null. */
export function writeDoc (file, doc) {
  try {
    const tmp = `${file}.${process.pid}.tmp`
    const txt = JSON.stringify(doc)
    fs.writeFileSync(tmp, txt)
    fs.renameSync(tmp, file)
    return txt.length
  } catch { return null }
}

const viewCache = new Map()
/** The town's folded map from every `atlas-*.json` in `dir`, cached VIEW_TTL_MS. -> view | null (no dir / unreadable). */
export function readView (dir, now = Date.now(), { ttl = VIEW_TTL_MS } = {}) {
  const c = viewCache.get(dir)
  if (c && now - c.at < ttl) return c.view
  let names
  try { names = fs.readdirSync(dir).filter(n => n.startsWith(FILE_PREFIX) && n.endsWith('.json')) } catch { return null }
  const docs = names.map(n => readDoc(path.join(dir, n))).filter(Boolean)
  const view = foldAtlas(docs, now)
  viewCache.set(dir, { at: now, view })
  return view
}
export const dropViewCache = () => viewCache.clear()

// ---- the recorder ----------------------------------------------------------------------------------------------------------------

/**
 * ONE BOT'S RECORDER. `bot` is mineflayer's (entity.position, blockAt, findBlocks, registry); `Vec3` the vec3 constructor (passed in:
 * this module stays importable without mineflayer). Never throws out of tick/scan/flush: the map is telemetry-grade, never a reason a
 * bot stops working.
 */
export class AtlasRecorder {
  constructor ({ bot, dir, by, home = null, Vec3, emit = null }) {
    Object.assign(this, { bot, dir, by, home, Vec3, emit })
    this.file = atlasFile(dir, by)
    this.doc = readDoc(this.file) ?? emptyDoc(by)
    this.doc.by = String(by)
    this.dirty = false
    this.lastScan = 0; this.lastScanAt = null; this.lastFlush = 0
    this.stats = { ticks: 0, fresh: 0, finds: 0, gone: 0, scans: 0 }
    this.ids = null
    this.lightSeen = false
  }

  #ids () {
    if (this.ids) return this.ids
    const by = this.bot?.registry?.blocksByName ?? {}
    const wood = [], other = []
    for (const [n, [cat]] of Object.entries(FIND_KINDS)) { const b = by[n]; if (b) (cat === 'wood' ? wood : other).push(b.id) }
    this.ids = { wood, other }
    return this.ids
  }

  /** One tick: cells, the gone check, the scan when due, the flush when due. */
  tick (now = Date.now()) {
    try {
      const p = this.bot?.entity?.position
      if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return
      this.stats.ticks++
      let light = null
      try { light = this.bot.blockAt(new this.Vec3(Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)))?.skyLight } catch { light = null }
      if (Number(light) > 0) this.lightSeen = true
      // a client that never receives light data reads 0 everywhere: until one positive reading, the surface is "y >= SKY_Y"
      const sky = this.lightSeen ? Number(light) >= SKY_SEEN : p.y >= SKY_Y
      const fresh = noteCells(this.doc, { x: p.x, z: p.z, sky, now })
      this.stats.fresh += fresh
      this.dirty = true
      this.#goneCheck(p, now)
      const moved = this.lastScanAt ? Math.hypot(p.x - this.lastScanAt.x, p.z - this.lastScanAt.z) : Infinity
      if (now - this.lastScan >= SCAN_MS || (moved >= SCAN_MOVE && now - this.lastScan >= SCAN_MIN_MS)) this.scan(now)
      if (now - this.lastFlush >= FLUSH_MS) this.flush(now)
    } catch { /* the map never stops a bot */ }
  }

  #goneCheck (p, now) {
    const view = readView(this.dir, now)
    const pool = [...(view?.finds ?? []), ...this.doc.finds]
    for (const f of pool) {
      if (Math.hypot(f.x - p.x, f.z - p.z) > GONE_R || Math.abs(f.y - p.y) > GONE_DY) continue
      let b = null
      try { b = this.bot.blockAt(new this.Vec3(f.x, f.y, f.z)) } catch { b = null }
      if (!b) continue                       // not loaded: unknown, not gone
      if (b.name === f.kind) continue
      if (this.doc.gone.some(g => g.kind === f.kind && g.x === f.x && g.z === f.z && g.t >= (f.last ?? 0))) continue
      noteGone(this.doc, f, now)
      this.stats.gone++
    }
  }

  /** One scan of the blocks around the bot (two findBlocks calls: wood apart, so a forest cannot crowd out a diamond). */
  scan (now = Date.now()) {
    try {
      const p = this.bot?.entity?.position
      if (!p) return 0
      this.lastScan = now; this.lastScanAt = { x: p.x, z: p.z }; this.stats.scans++
      const { wood, other } = this.#ids()
      const hits = [
        ...(wood.length ? this.bot.findBlocks({ matching: wood, maxDistance: SCAN_R, count: 8 }) ?? [] : []),
        ...(other.length ? this.bot.findBlocks({ matching: other, maxDistance: SCAN_R, count: 64 }) ?? [] : []),
      ]
      let added = 0
      const once = new Set()
      for (const h of hits) {
        const b = this.bot.blockAt(h)
        const kind = b?.name
        if (!FIND_KINDS[kind]) continue
        if (this.home && Math.hypot(h.x - this.home.x, h.z - this.home.z) < TOWN_SKIP_R) continue
        if (kind === 'lava' && h.y < p.y - LAVA_DY) continue
        // one sighting per kind per scan: a vein of twelve is one find, not twelve merges
        if (once.has(kind)) continue
        once.add(kind)
        const f = mergeFind(this.doc.finds, { kind, x: h.x, y: h.y, z: h.z }, now, this.by)
        if (f?.isNew) {
          added++; this.stats.finds++
          if (f.cat !== 'wood' && this.emit) { try { this.emit({ kind: 'atlas_find', status: 'success', detail: `${kind} (${f.cat}) at ${f.x},${f.y},${f.z}` }) } catch { /* telemetry */ } }
        }
      }
      this.dirty = true
      return added
    } catch { return 0 }
  }

  /** Record an expedition's pick, flushed at once (the layer and the other bots should see it this minute). */
  aim (a, now = Date.now()) {
    try { noteAim(this.doc, { ...a, t: now, by: this.by }); this.dirty = true; this.flush(now, true) } catch { /* telemetry */ }
  }

  flush (now = Date.now(), force = false) {
    if (!this.dirty && !force) return null
    this.doc.written = now
    const n = writeDoc(this.file, this.doc)
    this.lastFlush = now
    if (n != null) this.dirty = false
    return n
  }
}

/**
 * Install the recorder on a bot (features.mjs, once per spawn) -> the recorder | null (off). Sets `bot.atlas` = { view(), line(opts),
 * aim(a), recorder }. A second spawn replaces the first install's timer. Never throws.
 */
let installed = null
export function installAtlas (bot, { on, dir, by, home = null, Vec3, emit = null, zonesFn = null } = {}) {
  if (installed) { try { clearInterval(installed.timer); installed.rec.flush(Date.now(), true) } catch { /* gone */ } installed = null }
  if (!on || !dir || !bot) { try { if (bot) bot.atlas = undefined } catch { /* a bare bot */ } return null }
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* readView reports */ }
  const rec = new AtlasRecorder({ bot, dir, by, home, Vec3, emit })
  const inZone = (x, z, y) => { try { return zonesFn ? !!zonesFn(x, z, y) : false } catch { return false } }
  bot.atlas = {
    recorder: rec,
    view: (now = Date.now()) => readView(dir, now),
    line: ({ wants = [], now = Date.now() } = {}) => {
      const p = bot.entity?.position
      return p ? mapLine(readView(dir, now), { pos: p, wants, now, inZone, home }) : ''
    },
    aim: a => rec.aim(a),
  }
  const timer = setInterval(() => rec.tick(Date.now()), TICK_MS); timer.unref?.()
  installed = { timer, rec }
  bot.once?.('end', () => { try { clearInterval(timer); rec.flush(Date.now(), true) } catch { /* gone */ } if (installed?.timer === timer) installed = null })
  return rec
}
