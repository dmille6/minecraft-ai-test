// COTTAGE2-01: CHARMING, VARIED, USEFUL COTTAGES (OWNER 2026-11-08 ~20:00Z: "yes, use AI claude/codex to add some charm and uniqueness
// to the cottages, you can put chests and beds in cottages"; design docs/reports/cottage2-design-2026-11-08.md, Claude + Codex + an
// independent Claude design, reconciled). PURE: no bot, no world, no files.
//
// THE FAMILY `cottage@2-<code>`: one blueprint generated per LOOK (never a JSON file: buildsite.mjs loadBlueprint generates it), the
// code naming every seeded choice --
//   body    C  a 5 x 5 room (2 beds, 1 chest)        L  a 5 x 7 room along the ridge (3 beds, a DOUBLE chest)
//   front   s  eaves to the front (lanterns hang under the eave)   f  the gable to the front (a slab AWNING on two fence posts)
//   roof    g  the 45-degree stair gable                 l  the low 1:2 slab roof (townstyle.mjs slabRoof, the halls' proven form)
//   mirror  0 / 1  which side the chimney and the beds' layout take
//   chim    c / -  a stone CHIMNEY up the back corner (eave fronts only: the back is an eave side)
// The span across the ridge is ALWAYS 5 (the walls), so the ridge is at y 6 (gable) or y 5 (low): the reach the first cottage proved.
// The WOOD is the record's style (townstyle.mjs stylePalette tokens), chosen with the look so neighbours differ (cottageLookFor).
//
// THE PARTS every look has: a stone pad and course, log corner posts, plank walls, glass windows, closed-trapdoor sills under the back
// windows, WINDOW BOXES under the side windows (a moss block, a flower on it), an attic window in each gable, a wall torch inside.
// THE FURNISHING (segment `furnish`, last): beds (the foot a clicked cell, its HEAD the server's: role `bedhead`, `byFoot`), chests
// facing the aisle, the lanterns, the window-box flowers. A furnishing cell whose material the town cannot supply WAITS (cottage.mjs
// furnishWaits): it holds neither the completion nor a repair, and is placed by the visit that can (a damaged read once it can).

import { gableRoof, slabRoof } from './townstyle.mjs'
import { SMALL_FLOWERS } from './park.mjs'
import { windowPalette } from './glass.mjs'   // glass-01: glass, else a trapdoor of the walls' wood, else the wall

export const COTTAGE2_PREFIX = 'cottage@2-'
export const isCottage2Blueprint = id => /^cottage@2-[CL][sf][gl][01][c-]$/.test(String(id ?? ''))
/** The 16 bed colours (any is a bed: the cell's palette lists them all; the craft takes the colour the town has 3 wool of). */
export const BED_COLOURS = Object.freeze(['white', 'light_gray', 'gray', 'black', 'brown', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'light_blue', 'blue', 'purple', 'magenta', 'pink'])
export const BEDS = Object.freeze(BED_COLOURS.map(c => `${c}_bed`))
export const WOOLS = Object.freeze(BED_COLOURS.map(c => `${c}_wool`))
/** The window-box plants: any small flower, then a fern (the decorator's) -- never short grass (no item). */
export const BOX_PLANTS = Object.freeze([...SMALL_FLOWERS, 'fern'])
/** The roles a cottage's FURNISHING may wait on (cottage.mjs furnishWaits). */
export const FURNISH_ROLES = Object.freeze(['bed', 'bedhead', 'flower', 'lamp'])

/** A look -> its code ('Csg0c'). Pure. */
export const lookCode = l => `${l.body}${l.front}${l.roof}${l.mirror ? 1 : 0}${l.chim ? 'c' : '-'}`
/** A blueprint id or code -> the look, or null. Pure. */
export function lookOf (idOrCode) {
  const m = /^(?:cottage@2-)?([CL])([sf])([gl])([01])([c-])$/.exec(String(idOrCode ?? ''))
  if (!m) return null
  return { body: m[1], front: m[2], roof: m[3], mirror: m[4] === '1', chim: m[5] === 'c' }
}
export const cottage2Id = l => `${COTTAGE2_PREFIX}${lookCode(l)}`
/** Every valid look (a chimney only on an eave front), in a fixed order. Pure. */
export function allLooks () {
  const out = []
  for (const body of ['C', 'L']) for (const front of ['s', 'f']) for (const roof of ['g', 'l']) for (const mirror of [false, true]) for (const chim of front === 's' ? [true, false] : [false]) out.push({ body, front, roof, mirror, chim })
  return out
}

/** The frame of a body + front: the pad (W x D), the wall box, the doorway's u, the ridge axis. Pure. */
export function frameOf (body, front) {
  if (body === 'L' && front === 's') return { W: 9, D: 7, wall: { u0: 1, u1: 7, v0: 1, v1: 5 }, door: 4, ridge: 'u' }
  if (body === 'L') return { W: 7, D: 9, wall: { u0: 1, u1: 5, v0: 1, v1: 7 }, door: 3, ridge: 'v' }
  return { W: 7, D: 7, wall: { u0: 1, u1: 5, v0: 1, v1: 5 }, door: 3, ridge: front === 'f' ? 'v' : 'u' }
}

const flipDir = d => (d === '+u' ? '-u' : d === '-u' ? '+u' : d)
/**
 * THE BLUEPRINT OF A LOOK -> the blueprint object (`cottage@2-<code>`). Pure. The cells are { u, v, y, role, seg, st?, blind?, bed? };
 * a bed's foot and head share `bed` (the head `byFoot`: never clicked -- the foot's click puts it there).
 */
export function cottage2Blueprint (look) {
  const l = typeof look === 'string' ? lookOf(look) : look
  if (!l) throw new Error(`cottage2: no look ${look}`)
  const { W, D, wall: B, door, ridge } = frameOf(l.body, l.front)
  const yTop = 3
  const cells = []
  const at = new Set()
  const add = (u, v, y, role, seg, st, extra = {}) => {
    const k = `${u},${v},${y}`
    if (at.has(k)) throw new Error(`cottage2 ${lookCode(l)}: two cells at ${k}`)
    at.add(k); cells.push({ u, v, y, role, seg, ...(st ? { st } : {}), ...extra })
  }
  const drop = (u, v, y) => { const i = cells.findIndex(c => c.u === u && c.v === v && c.y === y); if (i >= 0) { cells.splice(i, 1); at.delete(`${u},${v},${y}`) } }
  // THE PAD
  for (let u = 0; u < W; u++) for (let v = 0; v < D; v++) add(u, v, 0, 'base', 'pad')
  // THE WALLS: posts at the corners, the stone course, plank walls, the windows
  const sideOf = (u, v) => (v === B.v0 ? 'F' : v === B.v1 ? 'B' : u === B.u0 ? 'L' : 'R')
  const corner = (u, v) => (u === B.u0 || u === B.u1) && (v === B.v0 || v === B.v1)
  const sideV = l.body === 'L' && l.front === 'f' ? [3, 5] : [3]   // the side walls' windows (window boxes under them)
  const backU = l.body === 'L' && l.front === 's' ? [2, 6] : l.front === 's' ? [2, 4] : [door]
  const frontU = l.body === 'L' && l.front === 's' ? [2, 6] : []
  const isWin = (u, v) => ((u === B.u0 || u === B.u1) && sideV.includes(v)) || (v === B.v1 && backU.includes(u)) || (v === B.v0 && frontU.includes(u))
  for (let u = B.u0; u <= B.u1; u++) for (let v = B.v0; v <= B.v1; v++) {
    if (!(u === B.u0 || u === B.u1 || v === B.v0 || v === B.v1)) continue
    const seg = `wall-${sideOf(u, v)}`
    for (let y = 1; y <= yTop; y++) {
      if (v === B.v0 && u === door && y <= 2) continue
      if (corner(u, v)) { add(u, v, y, 'post', seg, { axis: 'y' }); continue }
      if (y === 1) { add(u, v, y, 'course', seg); continue }
      if (y === 2 && isWin(u, v)) { add(u, v, y, 'window', seg); continue }
      add(u, v, y, 'wall', seg)
    }
  }
  // THE ROOF (one block of overhang all round), the attic windows in the gables
  const roof = l.roof === 'l' ? slabRoof(B, yTop, { ridge, over: 1 }) : gableRoof(B, yTop, { ridge, over: 1 })
  const midS = ridge === 'u' ? (B.v0 + B.v1) / 2 : (B.u0 + B.u1) / 2
  for (const c of roof) if (c.role === 'gable' && c.y === yTop + 1 && (ridge === 'u' ? c.v === midS : c.u === midS)) c.role = 'gablewin'
  for (const c of roof) add(c.u, c.v, c.y, c.role, c.seg, c.st)
  // THE CHIMNEY (an eave front only: up the back eave row outside a back corner post -- never over a window -- through the eave to two
  // above it; the mirror takes the other corner)
  const cu = B.u1
  const back = D - 1
  if (l.chim) {
    drop(cu, back, yTop)
    for (let y = 1; y <= yTop + 2; y++) add(cu, back, y, 'chimney', 'chimney')
  }
  // THE FRONT (the pad's front row, v 0): an eave front hangs two lanterns under the eave (a gable eave's bottom stair holds one; the
  // low roof's eave is a TOP slab, which holds none: Paper 11-08 -- so the low eave front stands its lanterns on fence posts); a gable
  // front builds an AWNING: two fence posts, a canopy of bottom slabs over the doorway, two lanterns hung under it
  const lamps = []
  if (l.front === 's' && l.roof === 'g') for (const u of [door - 1, door + 1]) lamps.push([u, 0, 2, { hanging: true }])
  else if (l.front === 's') for (const u of [door - 1, door + 1]) { add(u, 0, 1, 'fence', 'fit-out'); lamps.push([u, 0, 2, { hanging: false }]) }
  else {
    for (const u of [door - 2, door + 2]) for (const y of [1, 2]) add(u, 0, y, 'fence', 'fit-out')
    for (let u = door - 2; u <= door + 2; u++) add(u, 0, yTop, 'canopy', 'fit-out', { type: 'bottom' })
    for (const u of [door - 1, door + 1]) lamps.push([u, 0, 2, { hanging: true }])
  }
  // THE WINDOW BOXES (under every side window: a moss planter at y 1 outside, a flower on it) and the back windows' sills
  for (const v of sideV) for (const [u, out] of [[B.u0 - 1, '-u'], [B.u1 + 1, '+u']]) { add(u, v, 1, 'planter', 'fit-out'); add(u, v, 2, 'flower', 'furnish'); void out }
  for (const u of backU) add(u, B.v1 + 1, 1, 'sill', 'fit-out', { facing: '+v', half: 'top', open: false })
  for (const u of frontU) add(u, B.v0 - 1, 1, 'sill', 'fit-out', { facing: '-v', half: 'top', open: false })
  // THE ROOM: the beds (heads to the back), the chests facing the aisle, a wall torch on the back wall
  const beds = [], chests = []
  if (l.body === 'L' && l.front === 's') { beds.push([2, 3], [3, 3], [6, 3]); chests.push([5, 3, '-u'], [5, 4, '-u']) }
  else if (l.body === 'L') { beds.push([2, 3], [4, 3], [2, 5]); chests.push([4, 5, '-u'], [4, 6, '-u']) }
  else { beds.push([2, 3], [4, 3]); chests.push([3, 4, '-v']) }
  beds.forEach(([u, v], i) => {
    add(u, v, 1, 'bed', 'furnish', { facing: '+v', part: 'foot' }, { bed: `b${i + 1}` })
    add(u, v + 1, 1, 'bedhead', 'furnish', { facing: '+v', part: 'head' }, { bed: `b${i + 1}`, byFoot: true })
  })
  for (const [u, v, f] of chests) add(u, v, 1, 'chest', 'furnish', { facing: f })
  // the wall torch on the back wall's inner face -- beside the door's column when the back wall's middle is a WINDOW (a gable front's:
  // Paper 11-08, a torch clicked on a glass pane is refused, the fit-out never finished)
  add(backU.includes(door) ? door - 1 : door, B.v1 - 1, 2, 'light', 'fit-out')
  for (const [u, v, y, st] of lamps) add(u, v, y, 'lamp', 'furnish', st)
  // MIRROR: u -> W-1-u, a local facing along u reversed
  if (l.mirror) for (const c of cells) { c.u = W - 1 - c.u; if (c.st?.facing) c.st = { ...c.st, facing: flipDir(c.st.facing) } }
  // REACH-ONLY ABOVE THE EYE (the first cottage's rule, Paper 147/147): every cell from y 3 up
  for (const c of cells) if (c.y >= yTop) c.blind = true
  const doorU = l.mirror ? W - 1 - door : door
  const interior = []
  for (let u = B.u0 + 1; u <= B.u1 - 1; u++) for (let v = B.v0 + 1; v <= B.v1 - 1; v++) for (const y of [1, 2]) {
    const uu = l.mirror ? W - 1 - u : u
    if (!cells.some(c => c.u === uu && c.v === v && c.y === y)) interior.push([uu, v, y])
  }
  interior.push([doorU, B.v0, 1], [doorU, B.v0, 2])
  return {
    id: cottage2Id(l),
    kind: 'house',
    look: { ...l },
    footprint: { u: W, v: D },
    pad: { w: W, d: D },
    front: { u: doorU, v: 0, note: 'cottage2-01: the open doorway (v 1, y 1-2) opens toward v < 0' },
    doorway: [[doorU, B.v0, 1], [doorU, B.v0, 2]],
    interior,
    palette: {
      base: ['%stone', 'cobblestone', 'stone_bricks'],
      course: ['%stone', 'cobblestone', 'stone_bricks'],
      post: ['%wood_log'],
      wall: ['%wood_planks', '$planks'],
      window: windowPalette('$wall'),
      gable: ['%wood_planks', '$planks'],
      gablewin: windowPalette('$gable'),
      roof: ['%roof_stairs'],
      ridge: ['%roof_slab'],
      roofslab: ['%roof_slab'],
      ridgebeam: ['%roof_planks', '$planks'],
      canopy: ['%roof_slab'],
      chimney: ['%stone', 'cobblestone', 'stone_bricks'],
      fence: ['%wood_fence'],
      sill: ['%wood_trapdoor'],
      planter: ['moss_block', 'grass_block', 'dirt'],
      light: ['torch'],
      flower: [...BOX_PLANTS],
      lamp: ['lantern'],
      bed: [...BEDS],
      bedhead: [...BEDS],
      chest: ['chest'],
    },
    segments: [
      { seg: 'pad', layer: 0, deps: [] },
      { seg: 'wall-F', layer: 1, deps: ['pad'] },
      { seg: 'wall-B', layer: 1, deps: ['pad'] },
      { seg: 'wall-L', layer: 1, deps: ['pad'] },
      { seg: 'wall-R', layer: 1, deps: ['pad'] },
      ...(l.chim ? [{ seg: 'chimney', layer: 2, deps: ['wall-B'] }] : []),
      { seg: 'gable', layer: 2, deps: ['wall-F', 'wall-B', 'wall-L', 'wall-R'] },
      { seg: 'roof-edge', layer: 3, deps: ['gable', ...(l.chim ? ['chimney'] : [])] },
      { seg: 'roof-inner', layer: 4, deps: ['roof-edge'] },
      { seg: 'fit-out', layer: 5, deps: ['roof-inner'] },
      { seg: 'furnish', layer: 6, deps: ['fit-out'] },
    ].filter(s => s.seg !== 'gable' || cells.some(c => c.seg === 'gable')).map(s => ({ ...s, deps: s.deps.filter(d => d !== 'gable' || cells.some(c => c.seg === 'gable')) })),
    structural: ['base', 'course', 'post', 'wall', 'gable', 'roof', 'ridge', 'roofslab', 'ridgebeam', 'chimney'],
    cells,
    note: `cottage2-01 (owner 11-08 "charm and uniqueness ... chests and beds"): generated by bots/src/cottage2.mjs cottage2Blueprint('${lookCode(l)}'); never a file`,
  }
}

/** A blueprint's bed foot -> its head cell (same `bed`), or null. Pure. */
export const bedHeadOf = (cells, foot) => (foot?.role === 'bed' && foot.bed ? cells.find(c => c.role === 'bedhead' && c.bed === foot.bed) ?? null : null)
/** A bed head -> its foot. Pure. */
export const bedFootOf = (cells, head) => (head?.role === 'bedhead' && head.bed ? cells.find(c => c.role === 'bed' && c.bed === head.bed) ?? null : null)

// ---- THE LOOK A NEW COTTAGE TAKES (siting) ------------------------------------------------------------------------------------
/** What a look is judged by against its neighbours: these AXES must differ in at least LOOK_MIN_DIFF. */
export const LOOK_AXES = Object.freeze(['body', 'front', 'roof', 'chim', 'wood'])
export const LOOK_MIN_DIFF = 2
export const lookDiff = (a, b) => LOOK_AXES.filter(k => String(a?.[k] ?? '') !== String(b?.[k] ?? '')).length
/** The logs a cottage's WALL wood needs at least (posts, walls, gables, fences, sills; Codex/Claude r0 bill ~25-35) and its roof's. */
export const COTTAGE2_NEED = Object.freeze({ wall: 40, roof: 40, stone: 96 })
const fnv = s => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return h >>> 0 }
/**
 * THE LOOK AND WOOD FOR A NEW COTTAGE -> { look, wood } | null. Pure. `woods` the wall woods the town can build from (each with at least
 * COTTAGE2_NEED.wall logs; the caller's), `others` the looks + woods of the cottages already sited ({ body, front, roof, chim, wood }).
 * Every (look, wood) pair in a SEEDED order (`key`: pool/plot/plot id); the first that differs from EVERY other cottage in at least
 * LOOK_MIN_DIFF axes, else the one that differs most from its nearest. Never null when `woods` has one.
 */
export function cottageLookFor (key, woods = [], others = []) {
  return cottageLooksFor(key, woods, others, 1)[0] ?? null
}
/** THE RANKED LOOKS -> up to `n` { look, wood }: every pair that differs from every neighbour in LOOK_MIN_DIFF axes, in the seeded order
 *  (a siting that cannot place the first tries the next: a long body may not fit a plot's ground), else the one that differs most. Pure. */
export function cottageLooksFor (key, woods = [], others = [], n = 3) {
  if (!woods.length) return []
  const pairs = []
  for (const look of allLooks()) for (const wood of woods) pairs.push({ look, wood, h: fnv(`${key}|${lookCode(look)}|${wood}`) })
  pairs.sort((a, b) => a.h - b.h || lookCode(a.look).localeCompare(lookCode(b.look)) || a.wood.localeCompare(b.wood))
  const score = p => Math.min(...others.map(o => lookDiff({ ...p.look, wood: p.wood }, o)), 99)
  // the MOST different first (a town of three cottages reads as three), the seed breaking ties
  const ok = pairs.filter(p => score(p) >= LOOK_MIN_DIFF).map((p, i) => ({ p, i, sc: Math.min(score(p), LOOK_AXES.length) })).sort((a, b) => b.sc - a.sc || a.i - b.i).map(x => x.p)
  // the alternatives differ from the FIRST in body or front (a different footprint or face), so a retry is a real alternative
  const out = []
  for (const p of ok) { if (out.length >= n) break; if (!out.length || out.every(q => q.look.body !== p.look.body || q.look.front !== p.look.front)) out.push(p) }
  const picked = out.length ? out : [pairs.reduce((m, p) => (score(p) > score(m) ? p : m), pairs[0])]
  return picked.map(p => ({ look: p.look, wood: p.wood }))
}
/**
 * homes-02show: EVERY LOOK A PLOT MAY BE TRIED WITH, in the order tried -> [{ look, wood }], one entry a LOOK. Pure. cottageLooksFor's
 * own picks first (up to four: the most different from the neighbours, each another footprint or face), then every other look by the
 * same rank (those that differ from every neighbour in LOOK_MIN_DIFF axes before those that do not: a home that looks like its
 * neighbour is still a home -- owner 11-13 "as long as the thing gets built"), each with its best-ranked wood. The siting's screen
 * and proof read a look's CELLS, never its wood, so a look refused on a plot is refused whatever the wood.
 */
export function cottageLooksAll (key, woods = [], others = []) {
  if (!woods.length) return []
  const first = cottageLooksFor(key, woods, others, 4)
  const pairs = []
  for (const look of allLooks()) for (const wood of woods) pairs.push({ look, wood, h: fnv(`${key}|${lookCode(look)}|${wood}`) })
  pairs.sort((a, b) => a.h - b.h || lookCode(a.look).localeCompare(lookCode(b.look)) || a.wood.localeCompare(b.wood))
  const score = p => Math.min(...others.map(o => lookDiff({ ...p.look, wood: p.wood }, o)), LOOK_AXES.length)
  const ranked = pairs.map((p, i) => ({ p, i, sc: score(p) })).sort((a, b) => b.sc - a.sc || a.i - b.i).map(x => x.p)
  const out = [], seen = new Set()
  for (const p of [...first, ...ranked]) { const c = lookCode(p.look); if (seen.has(c)) continue; seen.add(c); out.push({ look: p.look, wood: p.wood }) }
  return out
}
/** A sited cottage record's look for the neighbour rule ({ body, front, roof, chim, wood }). The first cottage (@1s / @1f) is a C body
 *  gable with no chimney. Pure. */
export function recordLook (rec) {
  const id = String(rec?.blueprint ?? '')
  const wood = rec?.style?.wood ?? null
  const l = lookOf(id)
  if (l) return { ...l, wood }
  const m = /^cottage@1([sf])$/.exec(id)
  return m ? { body: 'C', front: m[1], roof: 'g', mirror: false, chim: false, wood } : null
}
