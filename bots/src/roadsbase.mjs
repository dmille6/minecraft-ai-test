// ROADS-01 FLEET PORT: the pieces of the showcase's town-sink machinery (bots/src/sinks.mjs, not on the fleet line) the road needs,
// verbatim but for the names: the build proof (proveBuild, with the road's slab floors), the cut and core names, the stones a design may
// afford, the walk radius, and the growing record (an instance appended, the newest marked standing). PURE. When the sinks come to the
// fleet this module folds back into sinks.mjs (the showcase's roads.mjs imports these from there).
import { walkFrom, stepFor, overlay } from './buildsite.mjs'

const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => `${a[0]},${a[1]},${a[2]}`
/** The fences a lamp post may be (decorator.mjs FENCES on the showcase line). */
export const FENCES = Object.freeze(['spruce_fence', 'oak_fence', 'birch_fence', 'dark_oak_fence', 'jungle_fence', 'acacia_fence', 'cherry_fence', 'mangrove_fence', 'bamboo_fence', 'pale_oak_fence'])
export const CUTTABLE = /^(dirt|coarse_dirt|grass_block|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|deepslate|calcite|dripstone_block|clay|mud|snow_block|packed_ice|terracotta|[a-z_]+_terracotta|sandstone|red_sandstone|smooth_basalt|dirt_path)$/
export const CORE_NAMES = Object.freeze(['*solid', 'cobblestone', 'cobbled_deepslate', 'dirt', 'andesite', 'diorite', 'granite', 'tuff', 'stone', 'coarse_dirt'])
export const SINK_STONES = Object.freeze(['stone_bricks', 'mossy_cobblestone', 'andesite', 'diorite', 'granite', 'cobbled_deepslate', 'tuff', 'stone',
  'mossy_stone_bricks', 'polished_andesite', 'polished_diorite', 'polished_granite', 'deepslate_bricks', 'calcite', 'sandstone', 'smooth_stone'])
export const STONE_SHARE = 0.6
export const affordable = (avail = {}, need = 1) => SINK_STONES.filter(n => (Number(avail?.[n]) || 0) * STONE_SHARE >= need)
/** A light or a fire is walk-through in the proof (never an obstacle, never a floor). */
export const sinkOpenRole = role => /-(light|fire)$/.test(String(role ?? ''))
const SOLID = name => Object.freeze({ name, boundingBox: 'block' })
const EMPTY = name => Object.freeze({ name, boundingBox: 'empty' })
/**
 * CAN THE INSTANCE BE BUILT FROM WHERE A BOT CAN WALK? -> { ok, why, detail?, walks }. Pure. Two stages:
 *   1. REACH: the town walk (buildsite.mjs walkFrom from home and the stood cells, radius `walkR`, over the world with the
 *      foundation laid) reaches one of the instance's `approach` stands;
 *   2. ORDER: the segments in order, each cell lowest first with a STEP (buildsite.mjs stepFor: a support the builder would click,
 *      the eye within reach on the face's open side, a clear sight line) from a stand the LOCAL walk (from the approach, radius
 *      `localR`) reaches, the cells still to place obstacles and never floors; every placed cell is a floor from then on.
 * `domain(x, z)` the stands' domain (the instance's box + 6). Lights and fires are walk-through (never obstacles, never floors).
 */
// roads-01 (`floors`: a Set of the road's bottom-slab cell keys): such a cell is a floor of the walk (buildsite.mjs walkFrom's reroof-04
// rule), and a cell that names a world state (`ws`) is laid in the overlay with its props, so the walk reads the slab rows it places
export function proveBuild (read, home, inst, { stood = [], walkR = 48, domain = () => true, approach = [], localR = 14, reach = true, floors = null } = {}) {
  const over = new Map()
  for (const c of inst.clear ?? []) over.set(kOf(c.at), EMPTY('air'))
  const R = overlay(read, over)
  const nameOf = c => (inst.palette[c.role] ?? ['cobblestone']).find(n => n !== '*solid') ?? 'cobblestone'
  const open = c => sinkOpenRole(c.role)
  let town0 = new Set()
  if (reach) {
    const ov = new Map([...(inst.clear ?? []).map(c => [kOf(c.at), EMPTY('air')]), ...inst.cells.filter(c => /-F$/.test(c.seg)).map(c => [kOf(c.at), SOLID('cobblestone')])])
    town0 = walkFrom(overlay(read, ov), home, new Set(), walkR, { stood, floors })
    if (!approach.some(a => town0.has(kOf(a)))) return { ok: false, why: 'unreachable', detail: `approach ${approach.map(kOf).slice(0, 2).join('/')}`, walks: 1 }
  }
  const byCol = keys => { const m = new Map(); for (const k of keys) { const [x, y, z] = k.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) } return m }
  let a0 = approach[0] ?? null
  if (reach) a0 = approach.find(a => town0.has(kOf(a))) ?? a0
  const local = a0 ? { x: a0[0], y: a0[1], z: a0[2] } : home
  let walks = 0
  for (const sg of inst.segments) {
    const left = inst.cells.filter(c => c.seg === sg.seg).sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
    const walkNow = () => { walks++; return byCol(walkFrom(R, local, new Set(left.filter(c => !open(c)).map(c => kOf(c.at))), localR, { stood: approach, floors })) }
    let nodes = walkNow(), fresh = true
    while (left.length) {
      let pick = -1, step = null
      for (let i = 0; i < left.length; i++) { step = stepFor(R, local, left[i].at, nodes, domain); if (step) { pick = i; break } }
      if (pick < 0 && !fresh) { nodes = walkNow(); fresh = true; continue }
      if (pick < 0) return { ok: false, why: 'no_step', detail: `${sg.seg} ${left.length} left, first ${left[0].role}@${kOf(left[0].at)}`, walks }
      fresh = false
      const c = left.splice(pick, 1)[0]
      over.set(kOf(c.at), open(c) ? EMPTY(nameOf(c)) : c.ws ? Object.freeze({ name: nameOf(c), boundingBox: 'block', props: c.ws }) : SOLID(nameOf(c)))
    }
  }
  return { ok: true, why: 'ok', walks }
}
export function sinkWalkR (cells, home) {
  let r = 0
  for (const c of cells ?? []) r = Math.max(r, Math.abs(c.at[0] - home.x), Math.abs(c.at[2] - home.z))
  return Math.max(48, Math.min(128, r + 10))
}

// ---- the growing record (sinks.mjs appendInstance / completeInstance, the road's case) ------------------------------------------
export const ROAD_PLOT = 'road'
export const ROAD_BLUEPRINT = 'road@2'
export const ROAD_BUILDERS = 3
export const instancesOf = rec => (Array.isArray(rec?.instances) ? rec.instances : [])
/** APPEND A ROAD INSTANCE -> the new record (the old unchanged). Pure. Its cells, segments, palette roles, clears and its own zones join the
 *  record's; its routes' landing columns join the record's FRONT (the paths' destination); the record reads open until it stands. */
export function appendRoad (cur, { home, inst, meta, now = Date.now() }) {
  const base = cur && cur.blueprint === ROAD_BLUEPRINT ? cur : { v: 1, blueprint: ROAD_BLUEPRINT, plot: ROAD_PLOT, kind: 'road', home, instances: [], cells: [], segments: [], palette: {}, clear: [], replant: [], zones: [], builders_max: ROAD_BUILDERS, structure_complete: false, state: 'open' }
  const walkR = Math.max(Number(base.walkR) || 0, sinkWalkR(inst.cells, home))
  return {
    ...base, instances: [...instancesOf(base), { ...meta, cells: inst.cells.length, sitedAt: meta.sitedAt ?? now }],
    cells: [...base.cells, ...inst.cells], clear: [...(base.clear ?? []), ...(inst.clear ?? [])], segments: [...base.segments, ...inst.segments], palette: { ...base.palette, ...inst.palette },
    zones: [...(base.zones ?? []), ...(meta.zones ?? [])], walkR, structure_complete: false, state: 'open',
    ...(Array.isArray(meta.front) ? { front: [...(base.front ?? []), ...meta.front] } : {}),
    bom: { ...(base.bom ?? {}), [meta.id]: inst.cells.length },
  }
}
/** Mark the newest instance standing -> the new record | null. Pure. */
export function completeRoad (cur, now = Date.now()) {
  if (!cur || cur.structure_complete) return null
  const ins = instancesOf(cur).map((i, k, a) => (k === a.length - 1 && !i.completeAt ? { ...i, completeAt: now } : i))
  return { ...cur, instances: ins, structure_complete: true, state: 'complete', completeAt: now }
}
/** The visit's options for the road record (buildrun.mjs runVisit): the stands' domain (every instance's box + 6), the walk's radius, the
 *  foreign blocks a visit may dig from an open cell (terrain, the bots' scaffold, plants), the walk-through lights. Pure. */
export const ROAD_FOREIGN = /^(cobblestone|mossy_cobblestone|dirt|coarse_dirt|grass_block|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|netherrack|cobbled_deepslate|deepslate|gravel|sand|red_sand|clay|mud|snow_block|calcite|dripstone_block|smooth_basalt|[a-z_]+_sapling|mangrove_propagule|brown_mushroom|red_mushroom|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|moss_carpet|short_dry_grass|tall_dry_grass|snow|torch|wall_torch|[a-z_]+_planks|sandstone|red_sandstone|dirt_path)$/
export function roadVisitOpts (rec, home) {
  const boxes = instancesOf(rec).map(i => i.box).filter(b => Array.isArray(b) && b.length === 4)
  const domain = (x, z) => boxes.some(b => x >= b[0] - 6 && x <= b[2] + 6 && z >= b[1] - 6 && z <= b[3] + 6)
  return { domain, walkR: Number(rec?.walkR) || sinkWalkR(rec?.cells, home), blockLayer: true, foreign: ROAD_FOREIGN, openRole: sinkOpenRole, clearMax: 40 }
}
