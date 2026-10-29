// THE TOWN INDEX (townindex-01; design docs/reports/town-plan-2026-10-20.md section 4.2; OWNER 10-20 ~12:30Z "yes, lets do
// this"). WHAT EVERY TOWN CONTAINER HELD WHEN A BOT LAST OPENED IT -- per item name the count AND the slots it occupied --
// so the town plan (and indexsearch-01's search) can know which container holds iron or coal.
//
// WHY (measured 10-20, the 00:15Z read-only RCON census and 24 h of rows): iron ingots sat in 9-25 containers per town (the
// fullest held 16-60 of the town's 82-241), and in 24 h 428 of 660 `toolkit` runs failed "no town container in reach holds 1
// iron ingot with 4 to spare" and 441 of 1,582 `smelt_town` runs found "no coal in the town containers looked in" -- in
// towns that held both. The stock journal (cobblecap.mjs / stocktarget.mjs) counts only the stock-target groups (cobble,
// logs, planks, sticks, a few tools): iron, copper and coal are no group, so NOTHING knew which container held them.
//
// WHAT IS RECORDED (observe-only: no reader in townindex-01 but count_town's candidate list):
//   obs    at every OPEN of a TOWN container (chestfull.mjs inTown: 16 h / 12 v of home), by any skill (deposit, withdraw,
//          count_town, town_deposit and its verifying re-open, the smelt jobs), what the SERVER sent at the open: per name
//          [count, slots], the used slots and the window's size. At the open ONLY, never the client's prediction after its
//          own clicks (a 1.21 click is a prediction: skills.mjs verifyTown). A double chest is ONE container, keyed by its
//          lower (x, then z) half, with both halves' keys (`h`), so it maps onto the per-half keys town memory uses.
//   dirty  any mutation by the bot (a deposit's or a withdraw's clicks) marks the container DIRTY, once before the first click
//          and once after the last: a crash between them leaves it dirty, and another bot's open DURING the clicks is
//          superseded by the closing mark. Only a later open makes it known again (verifyTown re-opens; the deposit verb and
//          a withdraw visit do not, so their containers stay dirty until the next open).
//   xfer   one per VERIFIED move (town_deposit: the verifying re-open showed the stack in its slot), with the operation id,
//          the id of the observation at the open BEFORE the clicks (`pre`, the pre-state "already held" is judged on), the id
//          of the verifying re-open (`ver`), the plan generation (null: no plan yet), bot, time, container, slot, name, count.
//          The deposit verb has no re-open: its records are `ok: 0` (unverified), from what its window gained.
//   ckpt   a rotation's first line: the fold of the previous two generations, every world.
//
// STATES (indexStateOf): known (an observation, younger than INDEX_STALE_MS), stale (older), dirty (a mutation after the last
// observation), unknown (never opened since the index began).
//
// KEPT APART ON PURPOSE: the index NEVER feeds the cobble cap, the stock targets, prune or disposal (giving names to the stock
// counts would make an absent group "a known 0" and could create disposal targets). It writes only its own files; the unit
// suite proves the writer leaves the cobble journal and the stock counts byte-identical (with a mutant).
//
// THE FILE: `town-index-<hx>_<hy>_<hz>.g<N>.jsonl` in the town's state directory (beside the cobble journal). Append-only, one
// record per line, newline FIRST (a dead writer's fragment is closed off), no lock. The fold is a last-writer-wins register per
// container ordered by the record's own capture time (`at`; a tie: dirty beats obs, then the larger id) -- commutative and
// idempotent, so the order of appends and a duplicate never change it. ROTATION: a writer that finds generation N past
// INDEX_ROTATE_BYTES creates N+1 exclusively (`wx`: one rotator), writes the fold of N-1 and N as its first line, and deletes
// N-2 and older. Readers fold N-1 and N, so a record appended to N-1 after the cut is still read; a writer whose append landed
// in a generation that is no longer the newest appends it again there (idempotent).
//
// TOWNINDEX=off is the one-setting rollback (nothing written, nothing read: today's behaviour).

import fs from 'node:fs'
import path from 'node:path'

export const TOWNINDEX = Object.freeze({ on: process.env.TOWNINDEX !== 'off' })
export const INDEX_V = 1
/** An observation older than this is `stale` (the stock journal's own OBS_TTL_MS, 6 h). */
export const INDEX_STALE_MS = 6 * 60 * 60 * 1000
/** A mutation's OPEN window (a `dirty` pre mark whose post mark never came: the writer crashed, or its post is not on disk yet)
 *  keeps every observation captured inside it from making the container known, for this long after the pre mark. Longer than
 *  any visit's clock (a skill is bounded at 180 s): a live writer has written its post mark long before. */
export const OP_TTL_MS = 10 * 60 * 1000
/** A HELD window (a cursor withdraw's hold could not empty: skills.mjs holdUnsettled, which may retry indefinitely) renews its
 *  operation's `held` mark this often, so the protection lasts while the hold lives and ends OP_TTL_MS after a crashed holder's
 *  last renewal -- when the server has long closed the window (Codex code r2 P1, Claude code r1 P2). */
export const HELD_RENEW_MS = 2 * 60 * 1000
/** A generation past this many bytes is rotated (env TOWNINDEX_ROTATE_BYTES for the tests). */
export const INDEX_ROTATE_BYTES = Number(process.env.TOWNINDEX_ROTATE_BYTES) > 0 ? Number(process.env.TOWNINDEX_ROTATE_BYTES) : 4 * 1024 * 1024
/** A fold that would read more than this fails closed (an empty index: every container unknown, today's behaviour). */
export const INDEX_MAX_READ_BYTES = 64 * 1024 * 1024

const wkey = w => JSON.stringify(w ?? null)
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)

// ---- the observation (pure) --------------------------------------------------------------------------------------------

/**
 * WHAT AN OPEN WINDOW SHOWS -> { names: { name: [count, slots] }, used, size }. Pure. `contents` are the CONTAINER's slots
 * (mineflayer's window.containerItems(): items with name, count, slot); `size` the window's container size (inventoryStart:
 * 27, or 54 for a double chest). A slot at or past `size`, or an item with no name or no count, is not the container's.
 */
export function observation (contents = [], size = 27) {
  const n = Math.max(0, Math.floor(Number(size) || 0))
  const names = {}
  const slots = new Set()
  for (const it of (Array.isArray(contents) ? contents : [])) {
    if (!it?.name || !(Number(it.count) > 0)) continue
    const s = Number.isInteger(it.slot) ? it.slot : null
    if (s != null && (s < 0 || s >= n)) continue
    if (s != null) { if (slots.has(s)) continue; slots.add(s) }
    const e = (names[it.name] ??= [0, 0])
    e[0] += Number(it.count); e[1] += 1
  }
  const used = Object.values(names).reduce((t, [, s]) => t + s, 0)
  return { names, used, size: n }
}

/** Does record `b` take the state over from record `a`? Later capture first; a tie: dirty over obs, then the larger id. Pure. */
export function supersedes (b, a) {
  if (!a) return true
  if (!b) return false
  const ba = num(b.at) ?? -Infinity, aa = num(a.at) ?? -Infinity
  if (ba !== aa) return ba > aa
  const rank = r => (r.t === 'dirty' ? 1 : 0)
  if (rank(b) !== rank(a)) return rank(b) > rank(a)
  return String(b.id ?? '') > String(a.id ?? '')
}

/** One mutation's marks, joined (the earlier pre, the later post; order-free and idempotent). Pure. */
const joinOp = (a, b) => ({ pre: [a?.pre, b?.pre].filter(Number.isFinite).reduce((m, v) => Math.min(m, v), Infinity),
                            held: [a?.held, b?.held].filter(Number.isFinite).reduce((m, v) => Math.max(m, v), -Infinity),
                            post: [a?.post, b?.post].filter(Number.isFinite).reduce((m, v) => Math.max(m, v), -Infinity) })
const cleanOp = o => ({ pre: Number.isFinite(o.pre) ? o.pre : null, held: Number.isFinite(o.held) ? o.held : null, post: Number.isFinite(o.post) ? o.post : null })
/**
 * One record into an entry (copied, never mutated) -> the new entry. Pure. entry = { last: {t, at, id, bot, by}, obs, ops }:
 * `ops` holds each mutation's pre and post marks by its operation id (Codex code r1 P1: another bot's open BETWEEN a writer's
 * pre and post marks must not make the container known when that writer then crashes before its post mark).
 */
function mergeEntry (e, r) {
  const last = { t: r.t, at: num(r.at), id: r.id ?? null, bot: r.bot ?? null, by: r.by ?? null }
  const out = { last: e?.last ?? null, obs: e?.obs ?? null, ops: e?.ops ?? {} }
  if (supersedes(last, out.last)) out.last = last
  if (r.t === 'dirty' && r.op != null && (r.phase === 'pre' || r.phase === 'post' || r.phase === 'held')) {
    const mark = { [r.phase]: num(r.at) }
    out.ops = { ...out.ops, [r.op]: cleanOp(joinOp(out.ops[r.op], mark)) }
  }
  if (r.t === 'obs' && supersedes({ t: 'obs', at: r.at, id: r.id }, out.obs ? { t: 'obs', at: out.obs.at, id: out.obs.id } : null)) {
    out.obs = { id: r.id ?? null, at: num(r.at), h: Array.isArray(r.h) ? r.h : [r.k], size: num(r.size), used: num(r.used), names: r.names ?? {}, bot: r.bot ?? null, by: r.by ?? null }
  }
  return out
}
/** Two entries of one container (a checkpoint's and a fold's) -> one. Pure, commutative. */
function joinEntries (a, b) {
  if (!a) return b
  if (!b) return a
  const e = { last: a.last, obs: a.obs, ops: { ...(a.ops ?? {}) } }
  if (b.last && supersedes(b.last, e.last)) e.last = b.last
  if (b.obs && (!e.obs || supersedes({ t: 'obs', at: b.obs.at, id: b.obs.id }, { t: 'obs', at: e.obs.at, id: e.obs.id }))) e.obs = b.obs
  for (const [op, o] of Object.entries(b.ops ?? {})) e.ops[op] = cleanOp(joinOp(e.ops[op], o))
  return e
}
const fin = v => (Number.isFinite(v) ? v : -Infinity)
/** The end of a mutation's protection: OP_TTL_MS past its pre mark or its latest `held` renewal. Pure. */
const protectedUntil = o => Math.max(fin(o?.pre), fin(o?.held)) + OP_TTL_MS
/** The last mark an operation holds (pre, held or post): a checkpoint keeps the operation until OP_TTL_MS past it. Pure. */
const lastMark = o => Math.max(fin(o?.pre), fin(o?.held), fin(o?.post))
/**
 * Is a mutation still OPEN at the observation's capture? -> true when an operation with no post mark covers it: from its pre
 * mark (or, when the pre mark is missing -- its write failed, Codex code r3 P2 -- from any time) to OP_TTL_MS past its pre or
 * latest `held` renewal. Pure.
 */
const openAt = (ops = {}, at) => Object.values(ops ?? {}).some(o => o?.post == null && (Number.isFinite(o?.pre) || Number.isFinite(o?.held)) &&
  (Number.isFinite(o?.pre) ? o.pre : -Infinity) <= at && at < protectedUntil(o))
/**
 * An entry for a CHECKPOINT -> the entry with only the operations that can still matter. Pure. An operation (open OR closed)
 * is dropped only once the entry's observation is past its whole protection: a closed one is kept until then as a TOMBSTONE,
 * so a duplicate pre mark replayed after the checkpoint can never reopen it (Codex code r2 P2).
 */
export function compactEntry (e) {
  if (!e) return e
  const ops = {}
  for (const [op, o] of Object.entries(e.ops ?? {})) {
    if (e.obs && Number.isFinite(e.obs.at) && e.obs.at >= lastMark(o) + OP_TTL_MS) continue   // a post-only tombstone too (Codex code r3 P2)
    ops[op] = o
  }
  return { last: e.last, obs: e.obs, ops }
}

/**
 * THE FOLD -> { worlds: { wkey: { k: entry } }, xfers, obs, dirty, bad }. Pure. Every record of every world (a record's `w`);
 * a `ckpt` record's entries are joined in. Unknown kinds and records with no container key are counted in `bad` and skipped.
 * `from` continues an earlier fold's worlds (never mutated).
 */
export function foldIndex (records = [], { from = null, fromXin = null } = {}) {
  const worlds = {}
  for (const [w, m] of Object.entries(from ?? {})) worlds[w] = { ...m }
  // smeltgate-01: THE LATEST MOVE INTO EACH CONTAINER PER NAME, from the xfer records -> xin { wkey: { k: { name: at } } }, kept
  // APART from the entries (no reader of an entry changes). The deposit verb never re-opens, so its move is the only record
  // of what it put in; the smelt order asks whether raw ore came in after a container's last observation (smeltjob.mjs
  // indexInputAbsent). A max per name: commutative and idempotent like the entries. Not carried by a checkpoint.
  const xin = {}
  for (const [w, m] of Object.entries(fromXin ?? {})) xin[w] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v }]))
  let xfers = 0, obs = 0, dirty = 0, bad = 0
  for (const r of (Array.isArray(records) ? records : [])) {
    if (!r || typeof r !== 'object') { bad++; continue }
    if (r.t === 'ckpt') {
      for (const [w, m] of Object.entries(r.worlds ?? {})) {
        const dst = (worlds[w] ??= {})
        for (const [k, e] of Object.entries(m ?? {})) dst[k] = joinEntries(dst[k], e)
      }
      continue
    }
    if (r.t === 'xfer') {
      xfers++
      const at = num(r.at)
      if (r.k != null && typeof r.name === 'string' && at != null && Number(r.n) > 0) {
        const c = ((xin[wkey(r.w)] ??= {})[r.k] ??= {})
        if (!(Number(c[r.name]) >= at)) c[r.name] = at
      }
      continue
    }
    if ((r.t !== 'obs' && r.t !== 'dirty') || r.k == null || num(r.at) == null) { bad++; continue }
    if (r.t === 'obs') obs++; else dirty++
    const dst = (worlds[wkey(r.w)] ??= {})
    dst[r.k] = mergeEntry(dst[r.k], r)
  }
  return { worlds, xin, xfers, obs, dirty, bad }
}

/** -> 'unknown' | 'dirty' | 'stale' | 'known'. Pure. */
export function indexStateOf (entry, now = Date.now(), staleMs = INDEX_STALE_MS) {
  if (!entry?.last) return 'unknown'
  if (entry.last.t === 'dirty') return 'dirty'
  if (!entry.obs) return 'unknown'
  if (openAt(entry.ops, entry.obs.at)) return 'dirty'                 // captured while a mutation was under way
  return now - (entry.obs.at ?? -Infinity) < staleMs ? 'known' : 'stale'
}

/** HOW MUCH OF `match` A KNOWN, FRESH ENTRY HOLDS -> { n, slots, at } | null (null: not known, or stale/dirty/unknown). Pure. */
export function indexHolding (entry, match, now = Date.now(), staleMs = INDEX_STALE_MS) {
  if (indexStateOf(entry, now, staleMs) !== 'known') return null
  let n = 0, slots = 0
  for (const [name, v] of Object.entries(entry.obs.names ?? {})) {
    if (!(typeof match === 'function' ? match(name) : name === match)) continue
    n += Number(v?.[0]) || 0; slots += Number(v?.[1]) || 0
  }
  return { n, slots, at: entry.obs.at }
}

/** THE TOWN CONTAINERS THE INDEX HAS NEVER SEEN -> [k] (in the order given). Pure. */
export const indexUnknownKeys = (keys = [], entries = {}) => (Array.isArray(keys) ? keys : []).filter(k => indexStateOf(entries?.[k]) === 'unknown')

// ---- the groups and the retrofit home allocation (design 6.1; pure) ---------------------------------------------------
// The group map is CODE, versioned by GROUPS_V, the same in every town. v1 is the census tool's (town-plan tools/
// census_summary.py.txt GROUPS), first match wins, in this order; anything else is `misc`.
export const GROUPS_V = 1
export const GROUP_ORDER = Object.freeze(['metal', 'fuel', 'stone', 'wood', 'tools', 'farm', 'valuable', 'build', 'earth', 'misc'])
const GROUP_RES = [
  ['stone', /^(cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|tuff|deepslate|blackstone|calcite|smooth_stone|stone_bricks|.*_bricks?|sandstone|red_sandstone)$/],
  ['wood', /^(.*_log|.*_wood|.*_planks|stick|.*_stem|bamboo_block|.*_slab|.*_stairs|.*_fence|.*_door|.*_trapdoor)$/],
  ['metal', /^(raw_iron|iron_ingot|iron_nugget|iron_ore|deepslate_iron_ore|raw_copper|copper_ingot|copper_block|cut_copper.*|.*copper.*|raw_gold|gold_ingot|gold_nugget|iron_block|iron_bars)$/],
  ['fuel', /^(coal|charcoal|coal_block|coal_ore|deepslate_coal_ore)$/],
  ['valuable', /^(diamond|emerald|lapis_lazuli|redstone|amethyst_shard|quartz|diamond_ore|.*_ore)$/],
  ['tools', /^(.*_(pickaxe|axe|shovel|hoe|sword)|bucket|water_bucket|shears|flint_and_steel|fishing_rod|bow|crossbow|shield)$/],
  ['farm', /^(.*_sapling|.*_seeds|wheat|bone_meal|bone|apple|carrot|potato|beetroot|sugar_cane|bamboo|cactus|melon_slice|pumpkin|kelp|.*_mushroom|sweet_berries|glow_berries|cocoa_beans|.*propagule|azalea|flowering_azalea|moss_block|.*leaves)$/],
  ['earth', /^(dirt|coarse_dirt|rooted_dirt|gravel|sand|red_sand|clay_ball|clay|flint|mud|grass_block|podzol|snowball|ice|packed_ice)$/],
  ['build', /^(torch|ladder|crafting_table|furnace|chest|barrel|composter|glass.*|.*_wool|.*_carpet|lantern)$/],
]
/** The town plan's group of an item name (v1). Pure. */
export function groupOfItem (name) {
  for (const [g, re] of GROUP_RES) if (re.test(String(name ?? ''))) return g
  return 'misc'
}
/** Slots per chest half (a barrel is one half). */
export const HALF_SLOTS = 27
/** At most this many containers make one group's home. */
export const HOME_MAX = 3

const kvec = k => (Array.isArray(k) ? k.map(Number) : String(k).split(',').map(Number))
const kcmp = (a, b) => { const x = kvec(a), y = kvec(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }

/**
 * THE RETROFIT HOME ALLOCATION (design 6.1) -> { homes: { group: [k] }, overflow: [k], drain: [k], capacity: { group: slots } }.
 * Pure. `containers`: the town's containers, one per double chest -- [{ k, halves, names: { name: [count, slots] } }] (from the
 * index's KNOWN entries: a home is never chosen from an unknown one). Groups in GROUP_ORDER; each takes the unassigned
 * container holding the most of it (items), then the fewest used slots, then nearest home (horizontal), then the key; more
 * containers (the next by the same order), up to HOME_MAX, until their capacity (HALF_SLOTS per half) covers the slots the
 * group's stacks occupy now (v1 never merges stacks). A group with no stock gets no home. Then ONE overflow: the unassigned
 * container with the fewest used slots, nearest home. Everything else is drain. The unit suite reproduces the design's
 * data/homes.json from the 00:15Z census exactly (16 towns).
 */
export function allocateHomes (containers = [], { home = { x: 0, y: 0, z: 0 } } = {}) {
  const list = (Array.isArray(containers) ? containers : []).filter(c => c?.k != null)
  const dist = k => { const [x, , z] = kvec(k); return Math.hypot(x - home.x, z - home.z) }
  const used = new Map(), halves = new Map(), gin = new Map()
  const gtot = {}, gslots = {}
  for (const c of list) {
    const k = Array.isArray(c.k) ? c.k.join(',') : String(c.k)
    halves.set(k, Math.max(1, Number(c.halves) || 1))
    let u = 0
    for (const [name, v] of Object.entries(c.names ?? {})) {
      const n = Number(v?.[0]) || 0, s = Number(v?.[1]) || 0
      const g = groupOfItem(name)
      u += s
      gtot[g] = (gtot[g] ?? 0) + n
      gslots[g] = (gslots[g] ?? 0) + s
      const m = gin.get(g) ?? new Map(); m.set(k, (m.get(k) ?? 0) + n); gin.set(g, m)
    }
    used.set(k, u)
  }
  const free = new Set(halves.keys())
  const homes = {}, capacity = {}
  const byFill = (a, b) => (used.get(a) - used.get(b)) || (dist(a) - dist(b)) || kcmp(a, b)
  for (const g of GROUP_ORDER) {
    homes[g] = []
    if (!gtot[g]) { capacity[g] = 0; continue }
    const m = gin.get(g) ?? new Map()
    while (free.size) {
      const k = [...free].sort((a, b) => ((m.get(b) ?? 0) - (m.get(a) ?? 0)) || byFill(a, b))[0]
      homes[g].push(k); free.delete(k)
      const cap = homes[g].reduce((t, p) => t + HALF_SLOTS * halves.get(p), 0)
      if (cap >= (gslots[g] ?? 0) || homes[g].length >= HOME_MAX) break
    }
    capacity[g] = homes[g].reduce((t, p) => t + HALF_SLOTS * halves.get(p), 0)
  }
  const overflow = [...free].sort(byFill).slice(0, 1)
  for (const k of overflow) free.delete(k)
  return { homes, overflow, drain: [...free].sort(kcmp), capacity }
}

// ---- the file ---------------------------------------------------------------------------------------------------------

/** The index's home key: `hx_hy_hz`. */
export const indexHomeKey = home => `${home.x}_${home.y}_${home.z}`
export const indexFile = (dir, hk, gen) => path.join(dir, `town-index-${hk}.g${gen}.jsonl`)
const GEN_RE = hk => new RegExp(`^town-index-${hk.replace(/[^0-9_-]/g, '')}\\.g(\\d+)\\.jsonl$`)

/** The generations on disk, ascending -> [N]. */
export function indexGens (dir, hk) {
  const re = GEN_RE(hk)
  let names
  // A MISSING directory is "no index yet"; any other failure THROWS, so a reader says ok:false and never "every container
  // unknown" (Codex code r3 P2: an EACCES read as an empty index scheduled count_town's extras)
  try { names = fs.readdirSync(dir) } catch (e) { if (e?.code === 'ENOENT') return []; throw e }
  return names.map(f => re.exec(f)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b)
}
/** THE CURRENT GENERATION: the highest on disk, 1 for a town with none yet. */
export const currentIndexGen = (dir, hk) => indexGens(dir, hk).at(-1) ?? 1

const lineOf = rec => '\n' + JSON.stringify(rec) + '\n'

/** Complete lines of a buffer -> { records, used }. A trailing fragment (a record still being written) is left. */
function parseBuf (buf) {
  const last = buf.lastIndexOf(10)
  const records = []
  if (last >= 0) {
    for (const ln of buf.subarray(0, last).toString('utf8').split('\n')) {
      if (!ln) continue
      try { records.push(JSON.parse(ln)) } catch { /* a dead writer's fragment */ }
    }
  }
  return { records, used: last + 1 }
}
function readFile (f, from = 0, maxBytes = INDEX_MAX_READ_BYTES) {
  let st
  try { st = fs.statSync(f) } catch (e) { return e?.code === 'ENOENT' ? { missing: true, size: 0, ino: null } : null }
  if (from > st.size || st.size - from > maxBytes) return null
  try {
    const fd = fs.openSync(f, 'r')
    try { const buf = Buffer.alloc(st.size - from); fs.readSync(fd, buf, 0, buf.length, from); return { buf, size: st.size, ino: st.ino } } finally { fs.closeSync(fd) }
  } catch { return null }
}

/** ROTATE generation `gen` into gen+1 -> true when this writer rotated. Exclusive by `wx`; the new file's first line is the
 *  fold of gen-1 and gen (every world); gen-2 and older are deleted (nobody reads them: readers fold gen and gen+1). */
export function rotateIndex (dir, hk, gen) {
  const next = indexFile(dir, hk, gen + 1)
  if (fs.existsSync(next)) return false
  // THE CHECKPOINT IS WRITTEN PRIVATELY AND PUBLISHED WHOLE (Codex code r1 P1: a `wx` create published an EMPTY generation that
  // another writer appended to before the checkpoint was written over its record): link() makes the new generation appear
  // with its first line already in it, and fails if another rotator got there first
  const tmp = `${next}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    const recs = []
    for (const g of [gen - 1, gen]) {
      if (g < 1) continue
      const r = readFile(indexFile(dir, hk, g))
      if (r && !r.missing) recs.push(...parseBuf(r.buf).records)
    }
    const f = foldIndex(recs)
    const worlds = Object.fromEntries(Object.entries(f.worlds).map(([w, m]) => [w, Object.fromEntries(Object.entries(m).map(([k, e]) => [k, compactEntry(e)]))]))
    fs.writeFileSync(tmp, lineOf({ t: 'ckpt', v: INDEX_V, gen: gen + 1, at: Date.now(), worlds }))
    try { fs.linkSync(tmp, next) } catch { return false }
  } catch { return false } finally { try { fs.unlinkSync(tmp) } catch { /* gone */ } }
  for (const g of indexGens(dir, hk)) if (g < gen) { try { fs.unlinkSync(indexFile(dir, hk, g)) } catch { /* gone */ } }
  return true
}

/**
 * APPEND ONE RECORD -> true when written. One line, one write, newline first, to the current generation (rotated first when
 * it is past `rotateBytes`); a write that landed in a generation another writer has since rotated past is written again in
 * the newest (the fold is idempotent). Never throws.
 */
export function appendIndex (dir, hk, world, rec, { rotateBytes = INDEX_ROTATE_BYTES } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    let g = currentIndexGen(dir, hk)
    try { if (fs.statSync(indexFile(dir, hk, g)).size > rotateBytes && rotateIndex(dir, hk, g)) g = g + 1 } catch { /* no file yet */ }
    const ln = lineOf({ v: INDEX_V, ...rec, w: world ?? null })
    fs.appendFileSync(indexFile(dir, hk, g), ln)
    for (let i = 0; i < 3; i++) {
      const g2 = currentIndexGen(dir, hk)
      if (g2 === g) break
      g = g2
      fs.appendFileSync(indexFile(dir, hk, g), ln)
    }
    return true
  } catch { return false }
}

// THE READER'S CACHE (per process): the fold of generations N-1 and N up to the bytes read, continued from there on the next
// read while N's file is the same inode and only grew. Any other change (a rotation, a truncation) folds again from disk.
const CACHE = new Map()   // `${dir}|${hk}` -> { gen, files: { g: { ino, offset } }, fold }
/** Forget the reader's cache (tests). */
export const resetIndexCache = () => CACHE.clear()

/**
 * THE TOWN'S INDEX, folded now -> { entries: { k: entry }, xin: { k: { name: at } }, gen, ok } for `world` (entries {} and ok false when it could not be
 * read: every container is then unknown -- today's behaviour).
 */
export function readIndex (dir, hk, world = null) {
  const ck = `${dir}|${hk}`
  try {
    const gens = indexGens(dir, hk)
    if (!gens.length) return { entries: {}, gen: 1, ok: true }
    const gen = gens.at(-1)
    const both = [gen - 1, gen].filter(g => g >= 1)
    let c = CACHE.get(ck)
    // BOTH GENERATIONS ARE FOLLOWED (Codex code r1 P1: a stale writer's late record in N-1 was invisible to a cached reader):
    // the cache continues each file from its own offset while it is the same inode and only grew; anything else folds again
    const stats = Object.fromEntries(both.map(g => { try { const st = fs.statSync(indexFile(dir, hk, g)); return [g, { ino: st.ino, size: st.size }] } catch { return [g, null] } }))
    const continues = c && c.gen === gen && both.every(g => {
      const was = c.files[g], st = stats[g]
      return was == null ? st == null : (st != null && st.ino === was.ino && st.size >= was.offset)
    })
    if (continues) {
      for (const g of both) {
        const was = c.files[g], st = stats[g]
        if (!was || !st || st.size <= was.offset) continue
        const r = readFile(indexFile(dir, hk, g), was.offset)
        if (!r || r.missing) { CACHE.delete(ck); return { entries: {}, gen, ok: false } }
        const p = parseBuf(r.buf)
        c = { ...c, files: { ...c.files, [g]: { ino: was.ino, offset: was.offset + p.used } }, fold: foldIndex(p.records, { from: c.fold.worlds, fromXin: c.fold.xin }) }
      }
      CACHE.set(ck, c)
    } else {
      const recs = []
      const files = {}
      for (const g of both) {
        const r = readFile(indexFile(dir, hk, g))
        if (!r) { CACHE.delete(ck); return { entries: {}, gen, ok: false } }
        if (r.missing) continue
        const p = parseBuf(r.buf)
        recs.push(...p.records)
        files[g] = { ino: r.ino, offset: p.used }
      }
      c = { gen, files, fold: foldIndex(recs) }
      CACHE.set(ck, c)
    }
    return { entries: c.fold.worlds[wkey(world)] ?? {}, xin: c.fold.xin?.[wkey(world)] ?? {}, gen, ok: true }
  } catch { CACHE.delete(ck); return { entries: {}, gen: 1, ok: false } }
}

/** EVERY RECORD on disk (both generations, every world) -> [record]. For the read and the tests; never on a hot path. */
export function indexRecords (dir, hk) {
  const out = []
  for (const g of indexGens(dir, hk)) { const r = readFile(indexFile(dir, hk, g)); if (r && !r.missing) out.push(...parseBuf(r.buf).records) }
  return out
}

// ---- the rows -----------------------------------------------------------------------------------------------------------

/** The `_townindex_mode` licence row (once per spawn): a kind the baseline cannot write. */
export const townIndexModeDetail = () =>
  `phase=mode index=${TOWNINDEX.on ? 'on' : 'off'} v=${INDEX_V} groups=${GROUPS_V} stale_h=${INDEX_STALE_MS / 3600000} rotate_mb=${Math.round(INDEX_ROTATE_BYTES / 1048576)} records=obs,dirty,xfer count_town=index_unknown`

/** The `_townindex_count` change row's detail (a count_town run whose candidates included index-unknown containers). Pure. */
export const townIndexCountDetail = ({ keys = 0, extra = 0, counted = 0, tried = 0, unknownLeft = '-' } = {}) =>
  `keys=${keys} extra=${extra} counted=${counted} tried=${tried} unknown_left=${unknownLeft}`
