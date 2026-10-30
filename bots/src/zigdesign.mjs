// ZIGGURAT V2 -- EVERY TOWN'S ZIGGURAT LOOKS DIFFERENT (OWNER 10-29, "Let's do 1 to 3": shape knobs, a palette from what the town
// can supply, details). PURE: the design is a function of the town's SEED (its pool and home), the stock seen at siting and the
// biome; it is chosen ONCE, at siting (skills.mjs buildMonument), and written into the record (ziggurat.mjs zigRecord: `palette`,
// `design`, the dressed cells). Every builder reads the record; nothing here runs per visit.
//
// 1 SHAPE (zigShape): base B 24..48 (even), tier height H 2|3, step-in S H..4 (S >= H: every stair step stands on the terrace
//   below with a cell to spare), stair width 1|3|5 (<= the summit's side - 2: the corners stay free), one grand stair toward home
//   or a stair on all four faces, and an optional truncation (a broad summit). At most ZIG2.maxLayers layers.
// 2 PALETTE (zigAllocate): tier BANDS in one of six patterns over up to three stones, a TRIM line on each tier's top edge, a
//   stair stone, moss WEATHERING scattered over a cobblestone or stone-brick band -- each picked only when the town can pay for
//   ALL its cells out of ZIG2.share of the stock above the project floor (mats.mjs projectFloor: 80% of a reserve is spendable by
//   a project). Every role's list ends in cobblestone, so a cell is never blocked for want of a block: what the town lacks at
//   build time falls back to the next name (buildrun.mjs blockFor/cellDone, shop.mjs billOf -- the house's window: [glass_pane,
//   $wall]). The hidden core is ZIG_PALETTE.core, the cheap accepted fill, unchanged. The foundation's shown cells are `plinth`
//   (cobblestone): the design's counts cannot know them before the site.
// 3 DETAILS: a summit shrine (a dais with four posts and a brazier when the summit is 8+ wide; a brazier alone otherwise), lights
//   on every tier's corners (and on the posts), a campfire on the brazier, optionally a parapet round one terrace. Lights and fire
//   are only what the town stocks (torch, lantern, campfire): a detail the stock cannot pay for is DROPPED at siting (no cell), and
//   a light the town runs out of later falls back to a torch, then a cobblestone cap -- never a stall. The campfire stands on a
//   1-high brazier: its top is +2 over the floor round it, so no walk ever ends on it (lavastep.mjs DANGER lists campfire), and
//   the brazier's top face is below a builder's eyes, so it can be placed.
import { zigCells, tierSides, zigHeight, facesOf, quadrantOf, segName, ZIG_PALETTE } from './ziggurat.mjs'
import { projectFloor, matsReserve } from './mats.mjs'

export const ZIG2 = Object.freeze({ Bmin: 24, Bmax: 48, maxLayers: 24, share: 0.5, mossPct: [8, 20] })

/** THE DESIGN SWITCH -> 'v1' | 'v2'. MONUMENT_DESIGN=v1 forces ziggurat@1 for a NEW siting; a sited record is never re-chosen. */
export function zigDesignVersion (env = process.env) {
  const v = String(env?.MONUMENT_DESIGN ?? '').toLowerCase()
  return v === 'v1' || v === '1' || v === 'ziggurat@1' ? 'v1' : 'v2'
}

// ---- the seed ------------------------------------------------------------------------------------------------------------------
/** FNV-1a 32 of a string. Pure. */
export function fnv1a (str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
/** THE TOWN'S SEED: its pool and its home (a home's coordinates repeat between worlds; the pool does not). Pure. */
export const zigSeed = (pool, home) => fnv1a(`ziggurat@2|${pool ?? ''}|${home?.x},${home?.y},${home?.z}`)
/** mulberry32: a deterministic stream in [0, 1). Pure. */
export function rng (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pickOf = (r, xs) => xs[Math.floor(r() * xs.length) % xs.length]
function shuffled (r, xs) { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
/** A cell's own hash (the weathering's scatter). Pure. */
const cellHash = (seed, i, l, j) => fnv1a(`${seed}|${i},${l},${j}`)

// ---- 1 the shape ---------------------------------------------------------------------------------------------------------------
/** Does a shape satisfy the v2 constraints? -> null | the reason. Pure. */
export function zigShapeWhy (g) {
  if (!g || !Number.isInteger(g.B) || g.B % 2 || g.B < ZIG2.Bmin || g.B > ZIG2.Bmax) return 'B'
  if (![2, 3].includes(g.H)) return 'H'
  if (!Number.isInteger(g.S) || g.S < g.H || g.S > 4) return 'S'
  if (![1, 4].includes(g.FACES)) return 'FACES'
  const sides = tierSides(g)
  if (sides.length < 2) return 'tiers'
  if (zigHeight(g) > ZIG2.maxLayers) return 'height'
  const top = sides[sides.length - 1]
  if (top < 2 * g.S) return 'summit'
  if (!Number.isInteger(g.STAIR_W) || g.STAIR_W < 1 || g.STAIR_W % 2 === 0 || g.STAIR_W > top - 2) return 'stair'
  return null
}
/**
 * THE SHAPE FROM THE SEED -> g { B, S, H, STAIR_W, FACES, TIERS, PARAPET }. `pin` overrides B (MONUMENT_B) or FACES (a siting
 * fallback). Every result passes zigShapeWhy. Pure.
 */
export function zigShape (seed, pin = {}) {
  const r = rng(seed)
  let B = ZIG2.Bmin + 2 * Math.floor(r() * ((ZIG2.Bmax - ZIG2.Bmin) / 2 + 1))
  const H = r() < 0.5 ? 2 : 3
  let S = H + Math.floor(r() * (5 - H))
  // four stairs half the time (zigtidy-01, 10-30: with one grand stair the bots climbed the tier walls on dirt pillars)
  let FACES = r() < 0.5 ? 4 : 1
  let W = pickOf(r, [1, 3, 3, 5])
  const trunc = pickOf(r, [0, 0, 0, 1, 2])
  const parapetDraw = r(), parapetAt = r()
  if (Number.isInteger(pin.B) && pin.B % 2 === 0 && pin.B >= ZIG2.Bmin && pin.B <= ZIG2.Bmax) B = pin.B
  if (pin.FACES === 1 || pin.FACES === 4) FACES = pin.FACES
  // the tier count: the natural count, capped by the height limit, less the truncation (at least two tiers stay)
  let n = tierSides({ B, S }).length
  while (n < 2 && S > H) { S--; n = tierSides({ B, S }).length }
  n = Math.min(n, Math.floor(ZIG2.maxLayers / H))
  n = Math.max(2, n - trunc)
  const top = B - 2 * S * (n - 1)
  while (W > 1 && W > top - 2) W -= 2
  // the parapet: one terrace walled round, where the terrace leaves a walk of 2+ inside it
  const PARAPET = S >= 3 && n >= 3 && parapetDraw < 0.5 ? Math.floor(parapetAt * (n - 1)) : null
  return Object.freeze({ B, S, H, STAIR_W: W, FACES, TIERS: n, PARAPET })
}

// ---- the layout: every cell's category (pure geometry; the palette maps categories to roles) ------------------------------------
/**
 * THE LAYOUT of a shape on a site -> { body, extra, counts }. `body` is zigCells' with each cell's `cat`; `extra` the cells the
 * design adds (parapet, shrine, lights, fire), each with its `cat`, `seg` and `prio` (lights: higher first). Categories:
 *   core | stair | band:<t> | trim:<t> (tier t's top edge) | moss:<t> (a band cell picked for weathering) | parapet | shrine |
 *   light | fire
 * Pure; corner/baseY/face as zigCells.
 */
export function zigLayout (g, seed, { corner = { x: 0, z: 0 }, baseY = 0, face = 's', mossPct = 0 } = {}) {
  const B = g.B, S = g.S, H = g.H
  const sides = tierSides(g), n = sides.length, top = n * H
  const rel = (i, l, j) => [corner.x + i, baseY + l, corner.z + j]
  const ring = (i, j, t) => { const o = t * S; return i === o || j === o || i === B - o - 1 || j === B - o - 1 }
  const body = zigCells({ corner, baseY, face }, g).map(c => {
    if (c.role !== 'skin') return { ...c, cat: c.role }
    const i = c.at[0] - corner.x, l = c.at[1] - baseY, j = c.at[2] - corner.z
    const t = Math.min(n - 1, Math.floor(l / H))
    if (l === (t + 1) * H - 1 && ring(i, j, t)) return { ...c, cat: `trim:${t}` }
    if (mossPct > 0 && cellHash(seed, i, l, j) % 100 < mossPct) return { ...c, cat: `moss:${t}` }
    return { ...c, cat: `band:${t}` }
  })
  const extra = []
  const add = (i, l, j, cat, prio = 0) => {
    const seg = cat === 'light' || cat === 'fire' ? `D-${quadrantOf(i, j, g)}` : segName(l, quadrantOf(i, j, g))
    extra.push({ at: rel(i, l, j), role: cat, seg, layer: l, cat, prio })
  }
  // the stair's arrival at each tier's edge (a parapet gap): the stair columns on every stair face
  const faces = facesOf(g, face)
  const w0 = Math.floor((B - g.STAIR_W) / 2)
  const inGap = (i, j, t) => {
    const o = t * S, a0 = w0, a1 = w0 + g.STAIR_W - 1
    return faces.some(f => ({ s: j === B - o - 1 && i >= a0 && i <= a1, n: j === o && i >= a0 && i <= a1, e: i === B - o - 1 && j >= a0 && j <= a1, w: i === o && j >= a0 && j <= a1 })[f])
  }
  // the PARAPET: one block round tier k's top edge, open where the stair arrives
  const k = g.PARAPET
  if (Number.isInteger(k) && k >= 0 && k < n - 1) {
    const o = k * S, L = sides[k]
    for (let i = o; i < o + L; i++) for (let j = o; j < o + L; j++) if (ring(i, j, k) && !inGap(i, j, k)) add(i, (k + 1) * H, j, 'parapet')
  }
  // the SHRINE on the summit (tier n-1's top, layer `top`)
  const o = (n - 1) * S, L = sides[n - 1]
  const c0 = o + L / 2 - 1                       // the NW cell of the summit's centre 2 x 2
  let brazier
  if (L >= 8) {
    const a = o + 2, b = o + L - 3
    for (let i = a; i <= b; i++) for (let j = a; j <= b; j++) add(i, top, j, 'shrine')            // the dais, 1 high, 2 in from the edge
    // four posts and the brazier, ONE high: what stands on them is placed from the dais (a builder sees a top face only below its
    // eyes -- offline 10-29, 2-high posts left their lights with no stand), and the fire's top is +2 over the dais: never a step
    for (const [i, j] of [[a, a], [a, b], [b, a], [b, b]]) { add(i, top + 1, j, 'shrine'); add(i, top + 2, j, 'light', 2 * n + 2) }
    add(c0, top + 1, c0, 'shrine')
    brazier = [c0, top + 2, c0]
  } else {
    add(c0, top, c0, 'shrine')                                                                     // the brazier on the summit
    brazier = [c0, top + 1, c0]
  }
  add(brazier[0], brazier[1], brazier[2], 'fire', 2 * n + 3)
  // LIGHTS at every tier's four corners (on the parapet's corners where there is one); the higher tiers first
  for (let t = 0; t < n; t++) {
    const ot = t * S, e = B - ot - 1
    const l = (t + 1) * H + (t === k ? 1 : 0)
    for (const [i, j] of [[ot, ot], [ot, e], [e, ot], [e, e]]) add(i, l, j, 'light', 2 * t + 1)
  }
  const counts = {}
  for (const c of [...body, ...extra]) counts[c.cat] = (counts[c.cat] ?? 0) + 1
  return { body, extra, counts, n, top, k: Number.isInteger(k) ? k : null }
}

// ---- 2 the palette ---------------------------------------------------------------------------------------------------------------
/** The stones a band may be (full blocks a bot can mine, smelt or craft), by look. */
export const ZIG2_STONES = Object.freeze({
  grey: ['stone_bricks', 'stone', 'smooth_stone', 'andesite', 'polished_andesite', 'cracked_stone_bricks'],
  dark: ['cobbled_deepslate', 'deepslate_bricks', 'polished_deepslate', 'deepslate_tiles', 'tuff', 'tuff_bricks', 'polished_tuff', 'blackstone', 'polished_blackstone_bricks'],
  warm: ['granite', 'polished_granite', 'bricks', 'mud_bricks', 'packed_mud', 'terracotta'],
  pale: ['diorite', 'polished_diorite', 'calcite'],
  sand: ['sandstone', 'smooth_sandstone', 'cut_sandstone', 'red_sandstone', 'smooth_red_sandstone', 'cut_red_sandstone'],
  moss: ['mossy_cobblestone', 'mossy_stone_bricks'],
})
export const ZIG2_TRIM = Object.freeze(['polished_deepslate', 'deepslate_bricks', 'deepslate_tiles', 'cobbled_deepslate', 'chiseled_stone_bricks', 'polished_andesite', 'polished_blackstone', 'smooth_stone', 'stone_bricks', 'cut_sandstone', 'chiseled_sandstone', 'bricks', 'polished_granite', 'polished_diorite'])
export const ZIG2_MOSS = Object.freeze({ cobblestone: 'mossy_cobblestone', stone_bricks: 'mossy_stone_bricks' })
export const ZIG2_PATTERNS = Object.freeze(['alt', 'stripes', 'split', 'crown', 'solid', 'fade'])
/** The band slot (0 = A, 1 = B, 2 = C) of tier t of n under a pattern. Pure. */
export function bandSlot (pattern, t, n, crown = 1) {
  switch (pattern) {
    case 'alt': return t % 2
    case 'stripes': return t % 3
    case 'split': return t < Math.ceil(n / 2) ? 0 : 1
    case 'crown': return t >= n - crown ? 1 : 0
    case 'fade': return Math.min(2, Math.floor((3 * t) / n))
    default: return 0
  }
}
const SAND_BIOME = /desert|badlands|beach/
/**
 * WHAT THE TOWN CAN PAY FOR -> name => count: ZIG2.share of the stock above the project floor (mats.mjs projectFloor of the
 * build reserve; a name the reserve does not list has no floor), rounded up. Cobblestone is never limited: every bot mines it,
 * and every role falls back to it. Pure.
 */
export function zigAllowance (stock = {}, reserve = matsReserve().table, share = ZIG2.share) {
  return name => (name === 'cobblestone' ? Infinity : Math.ceil(Math.max(0, (Number(stock?.[name]) || 0) - projectFloor(reserve?.[name] ?? 0)) * share))
}
/**
 * THE PALETTE ALLOCATION -> { pattern, slotMat, tierMat, tierTrim, tierMoss, trimMat, stair, shrine, parapet, lightMat, lit,
 * lightKeys, fire, ... }. Pure over the layout's counts. A use takes a material only when the allowance pays for ALL of that
 * use's cells, else it is cobblestone (or, for a light or the fire, dropped). In order -- the most visible per block first:
 *   the fire (a campfire on the brazier, else its cell is the first light); the lights (all lanterns, else as many torches as the
 *   allowance pays for, the shrine's and the highest tiers' first); the stair, the shrine, the parapet (each preferring the trim
 *   stone); then TIER BY TIER FROM THE TOP DOWN its band (its pattern slot's stone), its trim line and its weathering -- so a
 *   town short of stone gets a crowned ziggurat on a cobblestone base, never a stalled one.
 * Each slot's stone is the first in the seeded order whose allowance pays for that slot's highest tier, never another slot's.
 */
export function zigAllocate (seed, layout, { stock = {}, biome = null, reserve = matsReserve().table } = {}) {
  const r = rng((seed ^ 0x9e3779b9) >>> 0)
  const avail = zigAllowance(stock, reserve)
  const left = new Map()
  const rest = name => (name === 'cobblestone' ? Infinity : left.has(name) ? left.get(name) : avail(name))
  const take = (name, k) => {
    if (k <= 0 || name === 'cobblestone') return true
    if (rest(name) < k) return false
    left.set(name, rest(name) - k); return true
  }
  const pick = (list, k, not = []) => list.find(m => m && m !== 'cobblestone' && !not.includes(m) && take(m, k)) ?? 'cobblestone'
  const C = layout.counts, n = layout.n
  // the band stones in a seeded order, the biome's own first (sandstone in a desert)
  const groups = shuffled(r, ['grey', 'dark', 'warm', 'pale', 'moss'])
  if (SAND_BIOME.test(String(biome ?? ''))) groups.unshift('sand'); else groups.push('sand')
  const stones = groups.flatMap(gname => shuffled(r, ZIG2_STONES[gname]))
  const pattern = pickOf(r, ZIG2_PATTERNS), crown = 1 + Math.floor(r() * 2)
  const trims = shuffled(r, ZIG2_TRIM)
  const lightPref = shuffled(r, ['lantern', 'soul_lantern'])
  // FIRE: a campfire on the brazier, or its cell becomes the first light
  const fire = (C.fire ?? 0) > 0 && take('campfire', 1) ? 'campfire' : null
  // LIGHTS: every light slot (the fire's too when there is no campfire), highest first
  const slots = layout.extra.filter(c => c.cat === 'light' || (c.cat === 'fire' && !fire)).sort((a, b) => b.prio - a.prio || a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
  let lightMat = lightPref.find(m => take(m, slots.length)) ?? null
  let lit = lightMat ? slots.length : 0
  if (!lightMat) { lit = Math.min(slots.length, rest('torch')); if (lit > 0 && take('torch', lit)) lightMat = 'torch'; else lit = 0 }
  const lightKeys = new Set(slots.slice(0, lit).map(c => c.at.join(',')))
  // THE STONES: each pattern slot's, chosen for its highest tier; the trim's, for the summit's line
  const nSlots = pattern === 'stripes' || pattern === 'fade' ? 3 : pattern === 'solid' ? 1 : 2
  const slotOf = t => Math.min(nSlots - 1, bandSlot(pattern, t, n, crown))
  const bandCnt = t => (C[`band:${t}`] ?? 0) + (C[`moss:${t}`] ?? 0)
  const slotMat = Array(nSlots).fill('cobblestone')
  const slotTop = s => { for (let t = n - 1; t >= 0; t--) if (slotOf(t) === s) return t; return -1 }
  for (const s of [...slotMat.keys()].sort((a, b) => slotTop(b) - slotTop(a))) {
    const t = slotTop(s)
    if (t < 0) continue
    slotMat[s] = stones.find(m => !slotMat.includes(m) && rest(m) >= bandCnt(t)) ?? 'cobblestone'
  }
  const trimMat = trims.find(m => !slotMat.includes(m) && rest(m) >= (C[`trim:${n - 1}`] ?? 0)) ?? 'cobblestone'
  // STAIR, SHRINE, PARAPET (all of each, or cobblestone)
  const top = slotMat[slotOf(n - 1)]
  const stair = pick([trimMat, top, ...trims], C.stair ?? 0)
  const shrine = pick([trimMat, top, ...trims], C.shrine ?? 0)
  const parapet = (C.parapet ?? 0) > 0 ? pick([trimMat, slotMat[slotOf(layout.k ?? 0)], ...trims], C.parapet) : 'cobblestone'
  // TIER BY TIER, FROM THE TOP DOWN: the trim line (its cells are the band's when it is not paid for), the band, the weathering
  const tierMat = Array(n).fill('cobblestone'), tierTrim = Array(n).fill(null), tierMoss = Array(n).fill(null)
  for (let t = n - 1; t >= 0; t--) {
    const m = slotMat[slotOf(t)], tc = C[`trim:${t}`] ?? 0
    if (trimMat !== 'cobblestone' && tc > 0 && take(trimMat, tc)) tierTrim[t] = trimMat
    if (take(m, bandCnt(t) + (tierTrim[t] ? 0 : tc))) tierMat[t] = m
    const mm = ZIG2_MOSS[tierMat[t]]
    if (mm && (C[`moss:${t}`] ?? 0) > 0 && take(mm, C[`moss:${t}`])) tierMoss[t] = mm
  }
  return { pattern, crown, nSlots, slotMat, trimMat, tierMat, tierTrim, tierMoss, stair, shrine, parapet, lightMat, lit, lightKeys, fire, slotOf }
}

const tail = (...xs) => [...new Set([...xs.filter(Boolean), 'cobblestone'])]
/** The record's palette for an allocation (every list ends in cobblestone; the core is ZIG_PALETTE.core). Pure. */
export function zigPalette2 (a) {
  const p = { core: ZIG_PALETTE.core.slice(), plinth: ['cobblestone'], stair: tail(a.stair), shrine: tail(a.shrine), parapet: tail(a.parapet) }
  a.tierMat.forEach((m, t) => {
    p[`tier${t}`] = tail(m)
    if (a.tierTrim[t]) p[`trim${t}`] = tail(a.tierTrim[t])
    if (a.tierMoss[t]) p[`moss${t}`] = tail(a.tierMoss[t], m)
  })
  if (a.lightMat) p.light = tail(a.lightMat, 'torch')
  if (a.fire) p.fire = tail(a.fire, a.lightMat, 'torch')
  return p
}
/** A layout cell's role under an allocation -> role | null (null: a detail the town cannot pay for, dropped). Pure. */
function roleOf (c, a) {
  const cat = c.cat
  if (cat === 'core' || cat === 'stair' || cat === 'shrine' || cat === 'parapet') return cat
  const m = /^(band|trim|moss):(\d+)$/.exec(cat)
  if (m) {
    const t = Number(m[2])
    if (m[1] === 'trim' && a.tierTrim[t]) return `trim${t}`
    if (m[1] === 'moss' && a.tierMoss[t]) return `moss${t}`
    return `tier${t}`
  }
  if (cat === 'fire') return a.fire ? 'fire' : a.lightKeys.has(c.relKey) ? 'light' : null
  if (cat === 'light') return a.lightKeys.has(c.relKey) ? 'light' : null
  return null
}

/** The weathering's share of a band's cells (percent) for a seed. Pure. */
export const zigMossPct = seed => ZIG2.mossPct[0] + (fnv1a(`moss|${seed}`) % (ZIG2.mossPct[1] - ZIG2.mossPct[0] + 1))

// ---- the design ----------------------------------------------------------------------------------------------------------------
/**
 * THE DESIGN -> { v: 2, seed, g, palette, summary, dress }. Pure and deterministic in (seed, stock, biome, pin): the same town
 * seed gives the same shape whatever the stock; the palette and details follow what the stock pays for.
 *   dress({ body, found, corner, baseY, face, g }) -> { body, found }: ziggurat.mjs zigRecord's hook -- each body cell's role
 *     (bands, trim, weathering), the design's added cells (parapet, shrine, the lights and fire it affords), the foundation's
 *     shown cells as `plinth`.
 */
export function zigDesign (seed, { stock = {}, biome = null, reserve = matsReserve().table, pin = {} } = {}) {
  return zigDesignFor(zigShape(seed, pin), seed, { stock, biome, reserve })
}
/** zigDesign on an explicit shape (the tests' small ziggurats; zigShapeWhy is the caller's). Pure. */
export function zigDesignFor (g, seed, { stock = {}, biome = null, reserve = matsReserve().table } = {}) {
  // the weathering's scatter: a share of the band cells, from the seed
  const mossPct = zigMossPct(seed)
  const lay = zigLayout(g, seed, { mossPct })
  for (const c of lay.extra) c.relKey = c.at.join(',')
  const a = zigAllocate(seed, lay, { stock, biome, reserve })
  const palette = zigPalette2(a)
  const summary = {
    v: 2, seed, shape: { ...g }, pattern: a.pattern, tiers: a.tierMat.slice(), trim: a.tierTrim.slice(), moss: a.tierMoss.slice(), stair: a.stair, shrine: a.shrine,
    parapet: Number.isInteger(g.PARAPET) ? { tier: g.PARAPET, block: a.parapet } : null,
    lights: a.lightMat ? { block: a.lightMat, n: a.lit, of: lay.extra.filter(c => c.cat === 'light' || (c.cat === 'fire' && !a.fire)).length } : null,
    fire: a.fire, biome: biome ?? null,
  }
  const dress = ({ body, found, corner, baseY, face }) => {
    const L = zigLayout(g, seed, { corner, baseY, face, mossPct })
    const keyRel = at => `${at[0] - corner.x},${at[1] - baseY},${at[2] - corner.z}`
    // the record's body (zigRecord left out the hidden air pockets): each keeps its cell, takes its role
    const cat = new Map(L.body.map(c => [c.at.join(','), c.cat]))
    const out = []
    for (const c of body) {
      const ct = cat.get(c.at.join(',')) ?? c.role
      out.push({ ...c, role: roleOf({ cat: ct }, a) ?? c.role })
    }
    for (const c of L.extra) {
      const role = roleOf({ cat: c.cat, relKey: keyRel(c.at) }, a)
      if (role) out.push({ at: c.at, role, seg: c.seg, layer: c.layer })
    }
    // the foundation's shown cells and the approach's fill: plinth (cobblestone); the core and the approach's steps as they are
    return { body: out, found: found.map(c => (c.role === 'skin' ? { ...c, role: 'plinth' } : c)) }
  }
  return { v: 2, seed, g, palette, summary, dress }
}
/** A one-line name for a design (the `sited` row's kind: no spaces, no '='). Pure. */
export function zigDesignName (d) {
  const s = d.summary, g = s.shape
  const runs = []
  for (const m of s.tiers) { if (runs.length && runs[runs.length - 1][0] === m) runs[runs.length - 1][1]++; else runs.push([m, 1]) }
  const trim = [...new Set(s.trim.filter(Boolean))]
  return `B${g.B}H${g.H}S${g.S}T${g.TIERS}W${g.STAIR_W}F${g.FACES}${Number.isInteger(g.PARAPET) ? `P${g.PARAPET}` : ''}:${s.pattern}:${runs.map(([m, k]) => `${m}x${k}`).join('+')}:trim:${trim.join('+') || '-'}:light:${s.lights ? `${s.lights.block}x${s.lights.n}` : '-'}:fire:${s.fire ?? '-'}`
}
/**
 * THE SITING FALLBACKS for a seed -> [pin]: the seed's own shape first, then (one stair face instead of four) and smaller bases
 * 6 at a time down to ZIG2.Bmin -- deterministic, so every bot that sites tries the same list in the same order. Pure.
 */
export function zigCandidates (seed, pin = {}) {
  const g = zigShape(seed, pin)
  const out = [pin]
  if (g.FACES === 4) out.push({ ...pin, FACES: 1 })
  if (!Number.isInteger(pin.B)) for (let B = g.B - 6; B >= ZIG2.Bmin; B -= 6) out.push({ ...pin, B, FACES: 1 })
  return out
}
