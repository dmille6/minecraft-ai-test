// PENS-01: THE TOWN'S ANIMAL PENS (villager economy, OWNER 11-09 "i want all of those things done": "a fenced sheep pen (wool for
// cottage beds) and a cow pen"; design docs/reports/villagecon-2026-11-09/design.md, farms design 2026-11-03 piece 4; ledger
// villagecon-1109). PURE: the layout, the siting, the record. Nothing here touches a bot or a file. The visit is skills.mjs
// buildPens; the animals (lure, breed, shear) are herd.mjs + skills.mjs herdVisit.
//
// WHY. Births in village 6_1 wait on BEDS (villagefeed.mjs bedRoom: 5 beds, 7 villagers -- every adult claims one, a baby needs a
// vacant one), a bed needs 3 wool, and the town holds 0 wool; sheep within 100 / 200 / 400 b of home: 1 / 9 / 68 (region copy 11-09).
// A pen near town keeps sheep where the bots work (Paper's activation range: animals tick fully within 32 b of a player, so a pen far
// from the bots' rounds neither breeds nor regrows wool), and wheat (the farm's, 195 in town, the harvest held at its 128 cap: 9 of
// 47 visits 11-09 stopped `town_cap`) breeds them.
//
// THE PATTERN is the crop farm's (cropfarm.mjs): a record sited once (shop.mjs PROJECTS, buildproj.mjs records and leases), built by
// buildrun.mjs runVisit. THE LAYOUT: two 9 x 9 fence rings side by side with a 1-wide walkway between them -- a box of 19 x 9 columns:
// each ring at L + 1 round a 7 x 7 floor, one fence GATE in the front wall of each (the wall facing home), the front APRON (the row
// outside the gates) a stand. Every fence is on a ring's OUTSIDE edge, so every click is made from outside (the stands' domain keeps
// the builder off both floors: a shared middle wall's cells 3-5 deep could only be clicked from inside a pen). The ring on the left
// (u 0..8) is the SHEEP pen, the right (u 10..18) the COW pen.
// LEVEL: every column of the box is brought to L (a bump one above is CUT, a dip one below is FILLED with dirt): a fence standing on a
// lower column than the floor beside it is half a block high from inside, and an animal steps over it.
// GATE STATE: a fence gate takes the placer's facing (vanilla FenceGateBlock.getStateForPlacement: the horizontal direction looked);
// its `ws` names the facing from the apron INTO the pen, and closed (townstyle.mjs orientAim aims it like a stair's).
import { pathColumn } from './paths.mjs'
import { WOODS } from './townstyle.mjs'

/** PENS=on|off forces; else on in PENS_POOLS (default 'showcase'). Pure. */
export function pensOn (env = process.env, pool = '') {
  const v = String(env?.PENS ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  return String(env?.PENS_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean).includes(String(pool ?? ''))
}
export const PENS_PLOT = 'pens'
export const PENS_BLUEPRINT = 'pens@1'
export const PENS_BUILDERS = 1
export const PEN = Object.freeze({
  inner: 7,                 // each pen's floor is inner x inner
  rMin: 12, rMax: 48,       // the box's nearest column at least rMin from home (Chebyshev); its centre within rMax (Paper activation 32 b)
  headroom: 3,              // nothing but plants up to L + headroom over the box (an animal is <= 1.4 tall; a builder's body)
  earthMax: 40,             // cuts + floor fills a site may need
  grassMin: 30,             // of the sheep pen's 49 floor cells, grass_block at L (a sheep regrows its wool by eating grass)
  species: Object.freeze(['sheep', 'cow']),
})
/** Natural ground a cut may dig (the box's bumps). */
export const PEN_CUTTABLE = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|moss_block|dirt_path|stone|andesite|diorite|granite|tuff|gravel|sand|cobblestone|mossy_cobblestone)$/
/** What a visit may dig out of an open fence / gate cell before placing (a plant only). */
export const PEN_FOREIGN = /^(short_grass|tall_grass|fern|large_fern|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|leaf_litter|wildflowers|pink_petals|short_dry_grass|tall_dry_grass|bush|dead_bush|snow|sweet_berry_bush)$/
/** The record's palette: the town's plenty wood first (the visit crafts it), any wood's fence / gate done. */
export function penPalette (wood = 'spruce') {
  const w = WOODS.includes(wood) ? wood : 'oak'
  const all = suf => [`${w}_${suf}`, ...WOODS.filter(x => x !== w).map(x => `${x}_${suf}`)]
  return Object.freeze({ floor: Object.freeze(['dirt', '*solid']), fence: Object.freeze(all('fence')), gate: Object.freeze(all('fence_gate')) })
}

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const k2 = (x, z) => `${x},${z}`
const FACE = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' }

/**
 * THE BOX AT (x0, z0) -> { box, fence, gates, floor: { sheep, cow }, apron, walk }. Pure. Local (u, v): u 0..18 along the pens, v 0..8 into
 * them; v = 0 is the FRONT (the gates' wall). orient 'x': u runs along x; 'z': along z. front 'lo': v = 0 is the box's low side
 * (smaller z for 'x', smaller x for 'z'); 'hi': the high side. The anchor (x0, z0) is the box's low corner.
 */
export function penLayout (x0, z0, orient = 'x', front = 'lo') {
  const at = (u, v) => { const vv = front === 'lo' ? v : 8 - v; return orient === 'x' ? [x0 + u, z0 + vv] : [x0 + vv, z0 + u] }
  const fence = [], gates = [], floor = { sheep: [], cow: [] }, apron = []
  const inV = [at(4, 1)[0] - at(4, 0)[0], at(4, 1)[1] - at(4, 0)[1]]   // the direction from the apron into a pen
  const facing = FACE[`${inV[0]},${inV[1]}`]
  const walk = []
  for (let u = 0; u <= 18; u++) for (let v = 0; v <= 8; v++) {
    const [x, z] = at(u, v)
    if (u === 9) { walk.push([x, z]); continue }                     // the walkway between the rings
    const lu = u < 9 ? u : u - 10                                    // the ring's own u, 0..8
    const ring = lu === 0 || lu === 8 || v === 0 || v === 8
    if (ring && v === 0 && lu === 4) { gates.push({ x, z, facing, pen: u < 9 ? 'sheep' : 'cow' }); continue }
    if (ring) fence.push([x, z])
    else (u < 9 ? floor.sheep : floor.cow).push([x, z])
  }
  for (const u of [3, 4, 5, 13, 14, 15]) apron.push(at(u, -1))
  const a = at(0, 0), b = at(18, 8)
  return { box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], fence, gates, floor, apron, walk, facing }
}

/**
 * ONE CANDIDATE -> { ok, why, L, ... cost }. Pure.
 *   col(x, z)      pathColumn's answer (cached by the caller); blocked(x, z) -> reason | null; zoneOk(x, z) -> bool
 */
export function fitPen (read, { x0, z0, orient = 'x', front = 'lo', home, col, blocked = () => null, zoneOk = () => true } = {}) {
  const lay = penLayout(x0, z0, orient, front)
  const [bx0, bz0, bx1, bz1] = lay.box
  const ys = []
  for (let x = bx0; x <= bx1; x++) for (let z = bz0; z <= bz1; z++) {
    if (!zoneOk(x, z)) return { ok: false, why: 'zone' }
    const r = blocked(x, z)
    if (r) return { ok: false, why: `box:${r}` }
    const c = col(x, z)
    if (c.why === 'unknown') return { ok: false, why: 'unknown' }
    if (c.why) return { ok: false, why: `box:${c.why}` }
    ys.push(c.y)
  }
  ys.sort((a, b) => a - b)
  const L = ys[ys.length >> 1]
  const clear = [], floorFill = []
  let canopy = 0
  for (let x = bx0; x <= bx1; x++) for (let z = bz0; z <= bz1; z++) {
    const c = col(x, z)
    if (Math.abs(c.y - L) > 1) return { ok: false, why: 'level' }
    if (c.above.some(a => a.kind !== 'plant' && a.y <= L + PEN.headroom)) return { ok: false, why: 'cover' }
    if (c.above.some(a => a.kind !== 'plant')) canopy++
    if (c.y === L + 1) {
      if (!PEN_CUTTABLE.test(c.name ?? '')) return { ok: false, why: 'cut' }
      const u = cutUnsafeP(read, [x, L + 1, z])
      if (u) return { ok: false, why: `cut_${u}` }
      clear.push({ at: [x, L + 1, z], kind: 'cut', name: c.name })
      for (const a of c.above) if (a.kind === 'plant' && a.y >= L + 2 && a.y <= L + 3) clear.push({ at: [x, a.y, z], kind: 'plant', name: a.name })
    } else if (c.y === L - 1) floorFill.push([x, L, z])
  }
  if (clear.filter(q => q.kind === 'cut').length + floorFill.length > PEN.earthMax) return { ok: false, why: 'earth' }
  // THE APRON (the gates' stands): known ground within 1 of L, not blocked, no cover at the stand's height
  for (const [x, z] of lay.apron) {
    if (blocked(x, z)) return { ok: false, why: 'apron' }
    const c = col(x, z)
    if (c.why || Math.abs(c.y - L) > 1 || c.above.some(a => a.kind !== 'plant' && a.y <= c.y + 2)) return { ok: false, why: 'apron' }
  }
  // GRASS on the sheep's floor (at L: a cut column's exposed dirt greens again in the light; counted as not grass)
  const grass = lay.floor.sheep.filter(([x, z]) => { const c = col(x, z); return c.y === L && nm(read(x, L, z)) === 'grass_block' }).length
  if (grass < PEN.grassMin) return { ok: false, why: 'grass' }
  const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2
  const d = Math.hypot(cx - home.x, cz - home.z)
  if (d > PEN.rMax) return { ok: false, why: 'far' }
  const earth = clear.filter(q => q.kind === 'cut').length + floorFill.length
  const cost = d * 0.5 + earth * 0.3 + canopy * 0.5 - grass * 0.1
  return { ok: true, why: null, L, clear, floorFill, canopy, grass, box: lay.box, lay, orient, front, cost }
}
/** A cut beside liquid, or over no support -> a reason | null (cropfarm.mjs cutUnsafe's rule). Pure. */
export function cutUnsafeP (read, at) {
  const [x, y, z] = at
  const under = read(x, y - 1, z)
  if (!under) return 'unknown'
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
    const b = read(x + dx, y + dy, z + dz)
    if (!b) return 'unknown'
    if (/^(water|lava|bubble_column)$/.test(nm(b)) || /waterlogged/.test(String(b.name ?? ''))) return 'liquid'
  }
  if (under.boundingBox !== 'block' || /^(water|lava)$/.test(nm(under))) return 'no_support'
  return null
}

/**
 * THE SITING -> { ok, why, record, tried, zone }. Pure over `read`. The land plan's `farms` zone first, then the town ring (`town`);
 * no land plan: any column. Within a pass every anchor, both orientations, the front facing home (the side nearer home), the box at
 * least rMin from home at its nearest and its centre within rMax; the cheapest fit wins (ties: scan order).
 */
export function sitePens (read, { home, blocked = () => null, zone = null, yHi = null, yLo = null, wood = 'spruce' } = {}) {
  if (!home || typeof read !== 'function') return { ok: false, why: 'no_home', record: null, tried: 0 }
  const hi = yHi ?? Math.floor(home.y) + 16, lo = yLo ?? Math.floor(home.y) - 16
  const cache = new Map()
  const col = (x, z) => { const k = k2(x, z); let c = cache.get(k); if (!c) { c = pathColumn(read, x, z, { yHi: hi, yLo: lo }); cache.set(k, c) } return c }
  const bcache = new Map()
  const blk = (x, z) => { const k = k2(x, z); if (!bcache.has(k)) bcache.set(k, blocked(x, z) ?? null); return bcache.get(k) }
  const zcache = new Map()
  const zk = (x, z) => { const k = k2(x, z); if (!zcache.has(k)) zcache.set(k, zone(x, z) ?? null); return zcache.get(k) }
  const passes = typeof zone === 'function' ? [['farms'], ['town']] : [null]
  const R = PEN.rMax
  const why = {}
  let tried = 0
  for (const kinds of passes) {
    let best = null
    const zoneOk = kinds ? (x, z) => kinds.includes(zk(x, z)) : () => true
    for (const orient of ['x', 'z']) {
      for (let x0 = Math.floor(home.x) - R; x0 <= Math.floor(home.x) + R; x0++) {
        for (let z0 = Math.floor(home.z) - R; z0 <= Math.floor(home.z) + R; z0++) {
          // the front is the side nearer home
          const b0 = penLayout(x0, z0, orient, 'lo').box
          const lowSide = orient === 'x' ? b0[1] : b0[0], highSide = orient === 'x' ? b0[3] : b0[2], h = orient === 'x' ? home.z : home.x
          const front = Math.abs(h - lowSide) <= Math.abs(h - highSide) ? 'lo' : 'hi'
          const box = b0
          const nx = Math.max(box[0], Math.min(home.x, box[2])), nz = Math.max(box[1], Math.min(home.z, box[3]))
          if (Math.max(Math.abs(nx - home.x), Math.abs(nz - home.z)) < PEN.rMin) continue
          if (Math.hypot((box[0] + box[2]) / 2 - home.x, (box[1] + box[3]) / 2 - home.z) > R) continue
          if (kinds && ![[box[0], box[1]], [box[2], box[3]], [box[0], box[3]], [box[2], box[1]]].every(([x, z]) => zoneOk(x, z))) continue
          tried++
          const f = fitPen(read, { x0, z0, orient, front, home, col, blocked: blk, zoneOk })
          if (!f.ok) { const w = String(f.why).split(':')[0]; why[w] = (why[w] ?? 0) + 1; continue }
          if (!best || f.cost < best.f.cost - 1e-9) best = { f, x0, z0 }
        }
      }
    }
    if (best) return { ok: true, why: null, tried, zone: kinds ? kinds[0] : null, record: penRecord(best, { home, wood }) }
  }
  const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(' ')
  return { ok: false, why: `no fit (${tried} tried: ${top || '-'})`, tried, record: null }
}

/** THE RECORD from a fit. Pure. Segments: the floor fills (F) first, the walls (W), the gates (G, after the walls: a gate's click
 *  stands on the apron, and a wall finished first never traps the builder inside). */
export function penRecord ({ f, x0, z0 }, { home, wood = 'spruce' } = {}) {
  const L = f.L, lay = f.lay
  const cells = [], segments = []
  if (f.floorFill.length) { segments.push({ seg: 'F', deps: [] }); for (const a of f.floorFill) cells.push({ at: a, role: 'floor', seg: 'F' }) }
  segments.push({ seg: 'W', deps: f.floorFill.length ? ['F'] : [] })
  for (const [x, z] of lay.fence) cells.push({ at: [x, L + 1, z], role: 'fence', seg: 'W' })
  segments.push({ seg: 'G', deps: ['W'] })
  for (const g of lay.gates) cells.push({ at: [g.x, L + 1, g.z], role: 'gate', seg: 'G', ws: { facing: g.facing, open: false }, pen: g.pen })
  const palette = penPalette(wood)
  return {
    v: 1, blueprint: PENS_BLUEPRINT, plot: PENS_PLOT, home: { x: home.x, y: home.y, z: home.z },
    anchor: [x0, z0], orient: f.orient, front: f.front, box: f.box, level: L, cells, segments, clear: f.clear, replant: [],
    palette, wood: palette.fence[0].replace(/_fence$/, ''),
    pens: { sheep: { floor: lay.floor.sheep.map(([x, z]) => [x, L + 1, z]), gate: lay.gates.find(g => g.pen === 'sheep') }, cow: { floor: lay.floor.cow.map(([x, z]) => [x, L + 1, z]), gate: lay.gates.find(g => g.pen === 'cow') } },
    apron: lay.apron.map(([x, z]) => [x, L + 1, z]),
    walk: [...lay.apron, ...lay.walk].map(([x, z]) => [x, L + 1, z]),
    front: lay.apron.slice(0, 2).map(([x, z]) => [x, z]),
    counts: { fence: lay.fence.length, gates: lay.gates.length, floor: f.floorFill.length, cut: f.clear.filter(q => q.kind === 'cut').length, grass: f.grass },
    bom: { [palette.fence[0]]: lay.fence.length, [palette.gate[0]]: lay.gates.length, ...(f.floorFill.length ? { dirt: f.floorFill.length } : {}) },
    builders_max: PENS_BUILDERS,
  }
}
/** The fence / gate cells still open in the world -> { fence, gate }. Pure (read answers { name }). */
export function penOpen (read, rec) {
  const out = { fence: 0, gate: 0 }
  for (const c of rec?.cells ?? []) {
    if (c.role !== 'fence' && c.role !== 'gate') continue
    const n = nm(read(...c.at))
    if (c.role === 'fence' ? !/_fence$/.test(n) : !/_fence_gate$/.test(n)) out[c.role]++
  }
  return out
}
/** Is (x, y, z) a pen's floor cell (the animals' space) -> 'sheep' | 'cow' | null. Pure. */
export function penOf (rec, x, z) {
  for (const sp of PEN.species) if ((rec?.pens?.[sp]?.floor ?? []).some(p => p[0] === Math.floor(x) && p[2] === Math.floor(z))) return sp
  return null
}
/** THE STANDS' DOMAIN (buildsite.mjs stepFor): within the box + 6, never on a pen's floor (a builder inside a ring would close itself
 *  in). Pure -> (x, z) -> bool. */
export function penDomain (rec) {
  const floor = new Set(PEN.species.flatMap(sp => (rec?.pens?.[sp]?.floor ?? []).map(p => k2(p[0], p[2]))))
  const [x0, z0, x1, z1] = rec?.box ?? [0, 0, -1, -1]
  return (x, z) => x >= x0 - 6 && x <= x1 + 6 && z >= z0 - 6 && z <= z1 + 6 && !floor.has(k2(x, z))
}
