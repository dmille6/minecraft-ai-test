// CIVIC-01: THE TOWN'S LANDMARKS (OWNER 2026-11-09: "have Claude and Codex each propose a catalogue (clock tower, fountain, lighthouse,
// statue, park or plaza, well house, market square), then reconcile; site each where it fits the town plan; seeded variety and materials
// from town stock: stone bricks, glass, logs, lanterns; render pictures for the owner before building; prove every style on Paper").
// Design: docs/reports/citywall-design-2026-11-09.md section B (Codex + an independent Claude catalogue, reconciled). PURE: the catalogue,
// the seeded looks, the blueprints, the bills and the siting score. Nothing here touches a bot or a file.
//
// THE FAMILY `civic@1-<kind><code>`: one blueprint per LOOK, generated (buildsite.mjs loadBlueprint), never a file. Every kind is built
// by the ordinary build visit (buildrun.mjs runVisit) from its cells { u, v, y, role, seg, st?, blind? } -- local u (across the front),
// v (front to back, the doorway at v = 0), y up from the pad -- like the cottages; orientation by the proven aimed click (townstyle.mjs).
// Water, item frames, bells and campfires are left out (not proven here; the reconciliation's C list): the fountain is a DRY fountain (a
// lantern pillar in a basin) until a water proof lands.
//
// THE KINDS (rank = the showcase's build order):
//   F plaza      9 x 9 paved square round a dry fountain basin, lamp posts at the corners           code: pattern c|r, rim b|s
//   M cross      7 x 7 market cross: a stepped base of stairs, a pillar, a lantern; stall counters   code: stalls 0|2, height 3|4
//   B belfry     5 x 5 civic tower, 12 high, quoins, open arches with lanterns, a stair-cap roof, an INSIDE spiral of steps to the top
//                (the builders' stands and the bots' lookout)                                         code: roof p|f, quoin d|s
//   H wellhouse  5 x 5 roofed well head: a curb round a dark well mouth with a lantern in it, four posts, a hip roof   code: post l|w
//   L lighthouse 5 x 5 chamfered shaft with bands, the inside spiral, a glass lantern room          code: bands 2|3
//   S statue     5 x 5 apron, a 3 x 3 stepped plinth, a stone figure                                                    code: arms d|u, figure s|d
//   P pavilion   5 x 5 park gazebo: log posts, a hip stair roof, benches, a hung lantern               code: roof s|d
// Each kind declares its EFFECT METRIC (owner rule 11-06) in CIVIC_KINDS[k].metric.
// CIVIC=off is the rollback (nothing new sited; a standing landmark is an ordinary record).

export const CIVIC_PREFIX = 'civic@1-'
export const CIVIC_PLOT = 'civic'
export const CIVIC_KINDS = Object.freeze({
  F: Object.freeze({ name: 'plaza', w: 9, d: 9, codes: [['c', 'r'], ['b', 's']], near: 'home', metric: 'civic_visit rows: bots routed through the plaza per day (the crossing watch), and owner_verdict on the picture' }),
  M: Object.freeze({ name: 'cross', w: 7, d: 7, codes: [['0', '2'], ['3', '4']], near: 'market', metric: 'market trades and requests served within 8 of the cross per day (market rows), not below the pre-build days' }),
  B: Object.freeze({ name: 'belfry', w: 5, d: 5, codes: [['p', 'f'], ['d', 's']], near: 'hall', metric: 'lookout climbs (a bot at the top step) and owner_verdict; landmark_repair rows as the cost' }),
  H: Object.freeze({ name: 'wellhouse', w: 5, d: 5, codes: [['l', 'w']], near: 'well', metric: 'junk-well deposits per day at the well (not below pre) and owner_verdict' }),
  L: Object.freeze({ name: 'lighthouse', w: 5, d: 5, codes: [['2', '3']], near: 'shore', metric: 'expedition returns that pass within 32 of it after dark, and owner_verdict' }),
  S: Object.freeze({ name: 'statue', w: 5, d: 5, codes: [['d', 'u'], ['s', 'd']], near: 'junction', metric: 'owner_verdict on the picture (decorative: no bot metric)' }),
  P: Object.freeze({ name: 'pavilion', w: 5, d: 5, codes: [['s', 'd']], near: 'park', metric: 'bots idling or waiting inside it (rendezvous rows) and owner_verdict' }),
})
/** The showcase's build order (the reconciled first three, then the rest). */
export const CIVIC_ORDER = Object.freeze(['F', 'M', 'B', 'H', 'P', 'S', 'L'])
export const isCivicBlueprint = id => /^civic@1-[FMBHLSP][a-z0-9]+$/.test(String(id ?? ''))
/** id -> { kind, code } | null. Pure. */
export function civicLookOf (id) {
  const m = /^(?:civic@1-)?([FMBHLSP])([a-z0-9]*)$/.exec(String(id ?? ''))
  if (!m) return null
  const K = CIVIC_KINDS[m[1]]
  if (m[2].length !== K.codes.length || [...m[2]].some((ch, i) => !K.codes[i].includes(ch))) return null
  return { kind: m[1], code: m[2] }
}
/** Every look of a kind, in a fixed order. Pure. */
export function civicLooks (kind) {
  const K = CIVIC_KINDS[kind]
  let out = ['']
  for (const opts of K.codes) out = out.flatMap(p => opts.map(o => p + o))
  return out.map(code => `${CIVIC_PREFIX}${kind}${code}`)
}
const fnv = s => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return h >>> 0 }
/** THE SEEDED LOOK of a kind for a town (`key`: pool/kind/instance) -> its blueprint id. Pure. */
export const civicLookFor = (kind, key) => { const all = civicLooks(kind); return all[fnv(`${key}|${kind}`) % all.length] }

// ---- the parts ------------------------------------------------------------------------------------------------------------------------
const OUT = { '+u': '+u', '-u': '-u', '+v': '+v', '-v': '-v' }
/** A cell builder: no two cells in one place (a design bug, thrown). */
function cellSet (id) {
  const cells = [], at = new Map()
  const add = (u, v, y, role, seg, st, extra = {}) => {
    const k = `${u},${v},${y}`
    if (at.has(k)) throw new Error(`${id}: two cells at ${k}`)
    const c = { u, v, y, role, seg, ...(st ? { st } : {}), ...extra }
    at.set(k, c); cells.push(c); return c
  }
  const has = (u, v, y) => at.has(`${u},${v},${y}`)
  const drop = (u, v, y) => { const k = `${u},${v},${y}`; const c = at.get(k); if (c) { cells.splice(cells.indexOf(c), 1); at.delete(k) } }
  return { cells, add, has, drop }
}
/** The outward side of a ring cell of a W x D box (u0..u1, v0..v1) -> a local facing for a stair whose back is to the inside. Pure. */
const outward = (u, v, u0, u1, v0, v1) => (v === v0 ? '-v' : v === v1 ? '+v' : u === u0 ? '-u' : '+u')
/** A HIP ROOF of stairs over a box (each ring of stairs one in and one up), capped by a slab or the top stair ring. Pure. */
function hipRoof (S, u0, u1, v0, v1, y, { role = 'roof', cap = 'cap', seg = 'roof', blind = true, under = 'under' } = {}) {
  let k = 0
  for (; u0 + k <= u1 - k && v0 + k <= v1 - k; k++) {
    const a = u0 + k, b = u1 - k, c = v0 + k, d = v1 - k
    // a ring above the first stands on a solid course under it (the ring below is one column further out: nothing there to sit on)
    if (k > 0) for (let u = a; u <= b; u++) for (let v = c; v <= d; v++) if (!S.has(u, v, y + k - 1)) S.add(u, v, y + k - 1, under, seg, null, blind ? { blind: true } : {})
    if (a === b || c === d) { for (let u = a; u <= b; u++) for (let v = c; v <= d; v++) S.add(u, v, y + k, cap, seg, { type: 'bottom' }, blind ? { blind: true } : {}); return y + k }
    for (let u = a; u <= b; u++) for (let v = c; v <= d; v++) {
      if (!(u === a || u === b || v === c || v === d)) continue
      // facing: a stair's back (its full side) toward the inside -> it faces OUTWARD's opposite? the climbing side faces out
      S.add(u, v, y + k, role, seg, { facing: inward(u, v, a, b, c, d), half: 'bottom' }, blind ? { blind: true } : {})
    }
  }
  return y + k
}
/** A roof stair's facing (Minecraft: the stair's full back is on the FACING side): toward the box's inside. Pure. */
const inward = (u, v, a, b, c, d) => (v === c ? '+v' : v === d ? '-v' : u === a ? '+u' : '-u')
/**
 * THE INSIDE SPIRAL of a 5 x 5 tower: the ring of 8 cells round the newel (2, 2) inside the shell (u, v 1..3), one step up a cell,
 * from the doorway's right going round; a step is a full block (no orientation), its feet y+1. -> [[u, v, y]]. Pure.
 */
export function spiralSteps (top, { start = 1 } = {}) {
  // from the doorway's inside cell (2, 1): left to (1, 1), round the back, and over the doorway's cell at y 8 (head room 6 above it)
  const ring = [[1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [2, 1]]
  const out = []
  for (let i = 0; start + i <= top; i++) { const [u, v] = ring[i % ring.length]; out.push([u, v, start + i]) }
  return out
}

// ---- the blueprints -------------------------------------------------------------------------------------------------------------------

function plaza (code, id) {
  const [pat, rim] = code
  const S = cellSet(id)
  for (let u = 0; u < 9; u++) for (let v = 0; v < 9; v++) {
    if (u >= 3 && u <= 5 && v >= 3 && v <= 5) { S.add(u, v, 0, 'basin', 'pave'); continue }
    const edge = u === 0 || u === 8 || v === 0 || v === 8
    const ring = Math.max(Math.abs(u - 4), Math.abs(v - 4))
    const alt = pat === 'c' ? (u + v) % 2 === 0 : ring % 2 === 0
    S.add(u, v, 0, edge ? 'edge' : alt ? 'pave' : 'pave2', 'pave')
  }
  // the basin's rim (a 5 x 5 ring at y 1 round the 3 x 3 basin): blocks, or seats (stairs facing out: their backs to the basin)
  for (let u = 2; u <= 6; u++) for (let v = 2; v <= 6; v++) {
    if (!(u === 2 || u === 6 || v === 2 || v === 6)) continue
    const corner = (u === 2 || u === 6) && (v === 2 || v === 6)
    if (rim === 's' && !corner) S.add(u, v, 1, 'seat', 'rim', { facing: inward(u, v, 2, 6, 2, 6), half: 'bottom' })
    else S.add(u, v, 1, 'rim', 'rim')
  }
  // the dry fountain: a pillar of walls on the basin's centre, a chiseled cap, a lantern
  S.add(4, 4, 1, 'pillar', 'fountain'); S.add(4, 4, 2, 'pillar', 'fountain'); S.add(4, 4, 3, 'cap', 'fountain'); S.add(4, 4, 4, 'lamp', 'lights', null, { blind: true })
  for (const [u, v] of [[0, 0], [8, 0], [0, 8], [8, 8]]) { S.add(u, v, 1, 'post', 'lights'); S.add(u, v, 2, 'post', 'lights'); S.add(u, v, 3, 'lamp', 'lights', null, { blind: true }) }
  return {
    cells: S.cells, W: 9, D: 9, door: 4,
    palette: { edge: ['deepslate_bricks', 'polished_deepslate', 'stone_bricks'], pave: ['stone_bricks'], pave2: pat === 'c' ? ['polished_andesite', 'stone', 'andesite', 'stone_bricks'] : ['stone', 'smooth_stone', 'stone_bricks'],
      basin: ['deepslate_bricks', 'stone_bricks'], rim: ['stone_bricks'], seat: ['stone_brick_stairs'], pillar: ['stone_brick_wall', 'cobblestone_wall'], cap: ['chiseled_stone_bricks', 'stone_bricks'], post: ['stone_brick_wall', 'cobblestone_wall'], lamp: ['lantern', 'torch'] },
    segments: [['pave', []], ['rim', ['pave']], ['fountain', ['pave']], ['lights', ['rim', 'fountain']]],
  }
}
function cross (code, id) {
  const [stalls, h] = [code[0] === '2', Number(code[1])]
  const S = cellSet(id)
  for (let u = 0; u < 7; u++) for (let v = 0; v < 7; v++) S.add(u, v, 0, u === 0 || u === 6 || v === 0 || v === 6 ? 'edge' : 'pave', 'pave')
  // the stepped base: a ring of stairs round the pillar's block, their backs to it
  for (let u = 2; u <= 4; u++) for (let v = 2; v <= 4; v++) {
    if (u === 3 && v === 3) { S.add(u, v, 1, 'base', 'cross'); continue }
    S.add(u, v, 1, 'step', 'cross', { facing: inward(u, v, 2, 4, 2, 4), half: 'bottom' })
  }
  for (let y = 2; y < 2 + h - 1; y++) S.add(3, 3, y, 'pillar', 'cross')
  S.add(3, 3, h + 1, 'cap', 'cross', null, { blind: true }); S.add(3, 3, h + 2, 'lamp', 'lights', null, { blind: true })
  if (stalls) {
    // two stall counters on the cross's flanks: a slab counter on a wall leg each end, a log post with a hung lantern
    for (const u of [0, 6]) {
      for (const v of [2, 4]) S.add(u, v, 1, 'leg', 'stalls')
      S.add(u, 3, 1, 'counterb', 'stalls')
      for (const v of [2, 3, 4]) S.add(u, v, 2, 'counter', 'stalls', { type: 'bottom' })
    }
  }
  for (const [u, v] of [[0, 0], [6, 0], [0, 6], [6, 6]]) { S.add(u, v, 1, 'post', 'lights'); S.add(u, v, 2, 'lamp', 'lights', null, { blind: false }) }
  return {
    cells: S.cells, W: 7, D: 7, door: 3,
    palette: { edge: ['deepslate_bricks', 'stone_bricks'], pave: ['stone_bricks'], base: ['chiseled_stone_bricks', 'stone_bricks'], step: ['stone_brick_stairs'], pillar: ['stone_brick_wall', 'cobblestone_wall'],
      cap: ['chiseled_stone_bricks', 'stone_bricks'], lamp: ['lantern', 'torch'], leg: ['stone_brick_wall', 'cobblestone_wall'], counterb: ['stone_bricks'], counter: ['spruce_slab', 'stone_brick_slab', 'oak_slab'], post: ['stone_brick_wall', 'cobblestone_wall'] },
    segments: [['pave', []], ['cross', ['pave']], ...(stalls ? [['stalls', ['pave']]] : []), ['lights', ['cross']]],
  }
}
/** A 5 x 5 shell tower (belfry, lighthouse) with the inside spiral to `top`; `shell(u, v, y)` -> a role or null (an opening). */
function towerShell (S, top, shell, { doorU = 2 } = {}) {
  for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) S.add(u, v, 0, 'floor', 'base')
  S.drop(doorU, 0, 0); S.add(doorU, 0, 0, 'sill', 'base')
  for (let y = 1; y <= top; y++) for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) {
    if (!(u === 0 || u === 4 || v === 0 || v === 4)) continue
    if (u === doorU && v === 0 && y <= 2) continue
    const r = shell(u, v, y)
    if (r) S.add(u, v, y, r, `shell-${Math.min(9, Math.floor((y - 1) / 3))}`, null, y >= 4 ? { blind: true } : {})
  }
  // the newel and the spiral: the steps rise with the shell (each in the shell's band segment, so a builder stands on them)
  for (let y = 1; y <= top; y++) S.add(2, 2, y, 'newel', `shell-${Math.min(9, Math.floor((y - 1) / 3))}`)
  // the last step two under the deck (top + 1): a builder's feet there have head room, its eye reaches the deck and the roof
  for (const [u, v, y] of spiralSteps(top - 2)) S.add(u, v, y, 'stair', `shell-${Math.min(9, Math.floor((y - 1) / 3))}`)
}
function belfry (code, id) {
  const [roof, quoin] = code
  const S = cellSet(id)
  // the ARCHES are 3 high (y 8..10, the band under them at 7): a 2-high arch beside the spiral's top steps was a pocket a bot dropped
  // into and could not jump out of (Paper sandbox4 11-09: the builder stuck in the front arch, its head against the band)
  const top = 11
  const arch = (u, v, y) => y >= 8 && y <= 10 && ((u === 2 && (v === 0 || v === 4)) || (v === 2 && (u === 0 || u === 4)))
  towerShell(S, top, (u, v, y) => {
    if (arch(u, v, y)) return null
    // CHAMFERED like the lighthouse (Paper sandbox4 11-09: a square shell's rim is a continuous walk; the builder stepped onto it from the
    // spiral, and once the next course's cells were the open segment every rim cell round it was one -- boxed in, attempts_spent): the
    // corner columns stand to y 2 only (quoins), so the rim is four short runs
    const corner = (u === 0 || u === 4) && (v === 0 || v === 4)
    if (corner) return y <= 2 ? 'quoin' : null
    if (y === 7 || y === top) return 'band'
    if (y === 4 && ((u === 2 && v === 4) || (v === 2 && (u === 0 || u === 4)))) return 'slit'
    return 'wall'
  })
  // a lantern STANDS in each arch on its sill (the band course, y 7): a hung lantern needs the underside click this base's solver never
  // takes (buildsite.mjs SUPPORTS: never the face above)
  for (const [u, v] of [[2, 0], [2, 4], [0, 2], [4, 2]]) S.add(u, v, 8, 'lamp', 'lights', null, { blind: true })
  for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) if (!S.has(u, v, top + 1)) S.add(u, v, top + 1, 'deck', 'roof', null, { blind: true })
  if (roof === 'p') hipRoof(S, 0, 4, 0, 4, top + 2, { role: 'roof', cap: 'capslab' })
  else for (const [u, v] of [[0, 0], [4, 0], [0, 4], [4, 4], [2, 0], [0, 2], [4, 2], [2, 4]]) S.add(u, v, top + 2, 'merlon', 'roof', null, { blind: true })
  if (roof === 'f') S.add(2, 2, top + 2, 'lamp', 'lights', null, { blind: true })
  return {
    cells: S.cells, W: 5, D: 5, door: 2,
    palette: { floor: ['stone_bricks'], sill: ['chiseled_stone_bricks', 'stone_bricks'], wall: ['stone_bricks'], quoin: quoin === 'd' ? ['deepslate_bricks', 'stone_bricks'] : ['chiseled_stone_bricks', 'stone_bricks'], band: ['deepslate_bricks', 'stone_bricks'],
      slit: ['iron_bars', 'stone_bricks'], newel: ['stone_bricks', 'cobblestone'], stair: ['stone_bricks', 'cobblestone'], deck: ['stone_bricks'], roof: ['deepslate_brick_stairs', 'stone_brick_stairs'], under: ['deepslate_bricks', 'stone_bricks'], capslab: ['deepslate_brick_slab', 'stone_brick_slab'], merlon: ['stone_bricks'], lamp: ['lantern', 'torch'] },
    segments: towerSegs(S.cells, ['roof', 'lights']),
  }
}
function lighthouse (code, id) {
  const bands = Number(code[0])
  const S = cellSet(id)
  const top = 11
  // a chamfered shaft (the four corner columns left open above the base course), bands of deepslate every `bands` courses
  towerShell(S, top, (u, v, y) => {
    const corner = (u === 0 || u === 4) && (v === 0 || v === 4)
    if (corner && y > 1) return null
    if (u === 2 && v === 4 && (y === 5 || y === 8)) return 'window'
    return y % bands === 0 ? 'band' : 'wall'
  })
  // the gallery deck (y top+1, 5 x 5 less the corners) and the lantern room: a 3 x 3 of glass panes round 4 lanterns, a slab cap
  for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) { if ((u === 0 || u === 4) && (v === 0 || v === 4)) continue; if (!S.has(u, v, top + 1)) S.add(u, v, top + 1, 'deck', 'gallery', null, { blind: true }) }
  for (let u = 1; u <= 3; u++) for (let v = 1; v <= 3; v++) {
    if (u === 2 && v === 2) continue
    S.add(u, v, top + 2, 'glass', 'lantern', null, { blind: true }); S.add(u, v, top + 3, 'glass', 'lantern', null, { blind: true })
  }
  // ONE lantern stands on the deck at the room's centre (a lantern on a lantern does not stand: Paper sandbox4 11-09, the cap stalled)
  S.add(2, 2, top + 2, 'lamp', 'lantern', null, { blind: true })
  for (let u = 1; u <= 3; u++) for (let v = 1; v <= 3; v++) S.add(u, v, top + 4, 'capslab', 'cap', { type: 'bottom' }, { blind: true })
  return {
    cells: S.cells, W: 5, D: 5, door: 2,
    palette: { floor: ['stone_bricks'], sill: ['chiseled_stone_bricks', 'stone_bricks'], wall: ['stone_bricks'], band: ['deepslate_bricks', 'stone_bricks'], window: ['glass_pane', 'glass', 'stone_bricks'], newel: ['stone_bricks', 'cobblestone'],
      stair: ['stone_bricks', 'cobblestone'], deck: ['stone_bricks'], glass: ['glass_pane', 'glass'], lamp: ['lantern', 'glowstone'], capslab: ['deepslate_brick_slab', 'stone_brick_slab'] },
    segments: towerSegs(S.cells, ['gallery', 'lantern', 'cap']),
  }
}
function wellhouse (code, id) {
  const S = cellSet(id)
  // the curb: a 3 x 3 ring of stone round the open shaft (2, 2), the floor ring outside it; four posts; the hip roof
  // the shaft's mouth is a DARK FLOOR, never a hole (Paper sandbox4 11-09: an open 1 x 1 shaft inside the 1.5-high curb trapped the
  // builder -- a pit no bot jumps out of); a lantern stands in it
  for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) S.add(u, v, 0, u === 2 && v === 2 ? 'shaft' : u >= 1 && u <= 3 && v >= 1 && v <= 3 ? 'floor' : 'edge', 'base')
  S.add(2, 2, 1, 'lamp', 'lights', null, { blind: true })
  for (let u = 1; u <= 3; u++) for (let v = 1; v <= 3; v++) {
    if (u === 2 && v === 2) continue
    if ((u === 1 || u === 3) && (v === 1 || v === 3)) S.add(u, v, 1, 'curbpost', 'curb'); else S.add(u, v, 1, 'curb', 'curb', { type: 'bottom' })
  }
  for (const [u, v] of [[0, 0], [4, 0], [0, 4], [4, 4]]) for (let y = 1; y <= 3; y++) S.add(u, v, y, 'post', 'posts', code[0] === 'l' ? { axis: 'y' } : null)
  hipRoof(S, 0, 4, 0, 4, 4, { role: 'roof', cap: 'capslab' })
  // two lanterns STAND on the curb's front corner posts (a hung lantern needs the underside click this base's solver never takes)
  for (const u of [1, 3]) S.add(u, 1, 2, 'lamp', 'lights')
  return {
    cells: S.cells, W: 5, D: 5, door: 2,
    palette: { floor: ['stone_bricks'], edge: ['deepslate_bricks', 'stone_bricks'], shaft: ['polished_deepslate', 'deepslate_bricks', 'stone_bricks'], curb: ['stone_brick_slab', 'cobblestone_slab'], curbpost: ['chiseled_stone_bricks', 'stone_bricks'], post: code[0] === 'l' ? ['spruce_log', 'oak_log'] : ['stone_brick_wall', 'cobblestone_wall'],
      roof: ['spruce_stairs', 'stone_brick_stairs'], under: ['spruce_planks', 'oak_planks'], capslab: ['spruce_slab', 'stone_brick_slab'], lamp: ['lantern', 'torch'] },
    segments: [['base', []], ['curb', ['base']], ['posts', ['base']], ['roof', ['posts', 'curb']], ['lights', ['roof']]],
  }
}
function statue (code, id) {
  const [arms, fig] = code
  const S = cellSet(id)
  // a 5 x 5 paved apron (the walk round it), the 3 x 3 plinth on it: a ring of steps round a chiseled top, the figure on the top
  for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) S.add(u, v, 0, u === 0 || u === 4 || v === 0 || v === 4 ? 'apron' : 'plinth', 'plinth')
  for (let u = 1; u <= 3; u++) for (let v = 1; v <= 3; v++) if (!(u === 2 && v === 2)) S.add(u, v, 1, 'step', 'plinth', { facing: inward(u, v, 1, 3, 1, 3), half: 'bottom' })
  S.add(2, 2, 1, 'top', 'plinth')
  // the figure: legs (one column: a wall post reads as legs), a body, shoulders, a head; arms down at its sides or raised
  S.add(2, 2, 2, 'legs', 'figure'); S.add(2, 2, 3, 'body', 'figure'); S.add(2, 2, 4, 'head', 'figure')
  if (arms === 'u') { S.add(1, 2, 4, 'arm', 'figure'); S.add(3, 2, 4, 'arm', 'figure') } else { S.add(1, 2, 3, 'arm', 'figure'); S.add(3, 2, 3, 'arm', 'figure') }
  const stone = fig === 'd' ? ['polished_deepslate', 'deepslate_bricks'] : ['smooth_stone', 'stone', 'stone_bricks']
  return {
    cells: S.cells, W: 5, D: 5, door: 2,
    palette: { apron: ['stone_bricks'], plinth: ['deepslate_bricks', 'stone_bricks'], step: ['stone_brick_stairs'], top: ['chiseled_stone_bricks', 'stone_bricks'], legs: fig === 'd' ? ['deepslate_brick_wall', 'cobblestone_wall'] : ['stone_brick_wall', 'cobblestone_wall'],
      body: stone, head: ['chiseled_stone_bricks', 'stone_bricks'], arm: fig === 'd' ? ['deepslate_brick_wall', 'cobblestone_wall'] : ['stone_brick_wall', 'cobblestone_wall'] },
    segments: [['plinth', []], ['figure', ['plinth']]],
  }
}
function pavilion (code, id) {
  const S = cellSet(id)
  for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) S.add(u, v, 0, u === 0 || u === 4 || v === 0 || v === 4 ? 'edge' : 'floor', 'base')
  for (const [u, v] of [[0, 0], [4, 0], [0, 4], [4, 4]]) for (let y = 1; y <= 3; y++) S.add(u, v, y, 'post', 'posts', { axis: 'y' })
  // benches along the back and the sides (stairs, backs to the outside: their seats face in)
  for (const u of [1, 2, 3]) S.add(u, 4, 1, 'bench', 'benches', { facing: '+v', half: 'bottom' })
  for (const v of [1, 3]) { S.add(0, v, 1, 'bench', 'benches', { facing: '-u', half: 'bottom' }); S.add(4, v, 1, 'bench', 'benches', { facing: '+u', half: 'bottom' }) }
  hipRoof(S, 0, 4, 0, 4, 4, { role: 'roof', cap: 'capslab' })
  S.add(2, 2, 1, 'lamp', 'lights')   // a lantern standing on the floor's centre (no underside click on this base)
  return {
    cells: S.cells, W: 5, D: 5, door: 2,
    palette: { edge: ['stone_bricks'], floor: ['spruce_planks', 'oak_planks'], post: ['spruce_log', 'oak_log'], bench: ['spruce_stairs', 'oak_stairs'], roof: code[0] === 'd' ? ['dark_oak_stairs', 'spruce_stairs'] : ['spruce_stairs', 'oak_stairs'],
      under: code[0] === 'd' ? ['dark_oak_planks', 'spruce_planks'] : ['spruce_planks', 'oak_planks'], capslab: code[0] === 'd' ? ['dark_oak_slab', 'spruce_slab'] : ['spruce_slab', 'oak_slab'], lamp: ['lantern', 'torch'] },
    segments: [['base', []], ['posts', ['base']], ['benches', ['base']], ['roof', ['posts']], ['lights', ['roof']]],
  }
}
/** A shell tower's segments: the bands bottom up (each on the one below), then the named tail in order. Pure. */
function towerSegs (cells, tail) {
  const bands = [...new Set(cells.map(c => c.seg).filter(s => /^shell-\d$/.test(s)))].sort()
  const out = [['base', []]]
  let prev = 'base'
  for (const b of bands) { out.push([b, [prev]]); prev = b }
  for (const t of tail) if (cells.some(c => c.seg === t)) { out.push([t, [prev]]); prev = t }
  return out
}
const MAKERS = { F: plaza, M: cross, B: belfry, H: wellhouse, L: lighthouse, S: statue, P: pavilion }
/**
 * THE BLUEPRINT of a look (`civic@1-<kind><code>`) -> the blueprint object the build machinery takes (buildsite.mjs siteBlueprint): id,
 * kind, look, footprint, pad, front, doorway, palette, segments, structural, cells. Pure; throws on an unknown id.
 */
export function civicBlueprint (id) {
  const look = civicLookOf(id)
  if (!look) throw new Error(`civic: no look ${id}`)
  const full = `${CIVIC_PREFIX}${look.kind}${look.code}`
  const d = MAKERS[look.kind](look.code, full)
  // THE PAD'S RIM FIRST (Paper sandbox4 11-09: the plaza laid its pad from the middle out; the last ring of open cells stood between the
  // builder on the pad and every outside stand -- the walk never crosses a segment's open cells -- and the inside stands could not
  // see past the pad's edge: attempts_spent): every pad cell on the footprint's border is its own first segment, laid from outside
  const rimSeg = 'rim0'
  for (const c of d.cells) if (c.y === 0 && (c.u === 0 || c.v === 0 || c.u === d.W - 1 || c.v === d.D - 1)) c.seg = rimSeg
  const segs = [{ seg: rimSeg, layer: -1, deps: [] }, ...d.segments.map(([seg, deps], i) => ({ seg, layer: i, deps: i === 0 ? [...deps, rimSeg] : deps }))]
  // A CELL ABOVE A STANDING EYE's top-face sight (y >= 3 over the pad, as the cottages' roof courses; y >= 2 on a raised plinth) is
  // placed by reach (the roofs' proven blind click); THE INTERIOR the proof walks to: every open cell over the pad (y 1, nothing there)
  const occ = new Set(d.cells.map(c => `${c.u},${c.v},${c.y}`))
  // AN ENCLOSED CELL (all four sides cells of the design at its height: the statue's top inside its ring of steps) is placed by reach
  // too: the visit may lay its ring first, and then no eye sees its support's face (Paper sandbox4 11-09: the statue's top stalled)
  const enclosed = c => c.y >= 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([du, dv]) => occ.has(`${c.u + du},${c.v + dv},${c.y}`))
  for (const c of d.cells) if (c.y >= 3 || (look.kind === 'S' && c.y >= 2) || enclosed(c)) c.blind = true
  const interior = d.cells.filter(c => c.y === 0 && c.role !== 'basin' && !occ.has(`${c.u},${c.v},1`) && !occ.has(`${c.u},${c.v},2`)).map(c => [c.u, c.v, 1])
  return {
    id: full, kind: 'civic', civic: look.kind, look: { kind: look.kind, code: look.code, name: CIVIC_KINDS[look.kind].name },
    footprint: { u: d.W, v: d.D }, pad: { w: d.W, d: d.D },
    front: { u: d.door, v: 0, note: 'civic-01: the front (v 0) faces the town\'s way in' },
    doorway: [], interior,
    palette: d.palette, segments: segs,
    structural: Object.keys(d.palette).filter(r => r !== 'lamp'),
    cells: d.cells,
    note: `civic-01 (owner 11-09 landmarks): generated by bots/src/civic.mjs civicBlueprint('${full}'); never a file`,
  }
}
/** A blueprint's bill -> { name: n } by each role's FIRST name. Pure. */
export function civicBill (bp) {
  const out = {}
  for (const c of bp.cells) { const n = bp.palette[c.role]?.[0]; if (n) out[n] = (out[n] ?? 0) + 1 }
  return out
}
/** Is the town's stock enough for a blueprint (each role's first name, else its later names)? -> { ok, short }. Pure. */
export function civicStockOk (bp, stock = {}, keep = {}) {
  const avail = Object.fromEntries(Object.entries(stock ?? {}).map(([k, v]) => [k, Math.max(0, (Number(v) || 0) - (Number(keep[k]) || 0))]))
  const short = {}
  for (const c of bp.cells) {
    const list = bp.palette[c.role] ?? []
    const n = list.find(x => (avail[x] ?? 0) > 0)
    if (n) avail[n]--
    else short[list[0]] = (short[list[0]] ?? 0) + 1
  }
  return { ok: !Object.keys(short).length, short }
}

// ---- the town: switch, plots, anchors, siting -------------------------------------------------------------------------------------

const onOff = v => { const t = String(v ?? '').trim().toLowerCase(); return ['on', '1', 'true', 'yes'].includes(t) ? true : ['off', '0', 'false', 'no'].includes(t) ? false : null }
/** THE SWITCH -> bool. CIVIC=on|off; unset = on in CIVIC_POOLS (default 'showcase'). Pure. */
export function civicOn (env = process.env, pool = '') {
  const v = onOff(env?.CIVIC)
  if (v != null) return v
  const pools = String(env?.CIVIC_POOLS ?? 'showcase').split(',').map(x => x.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
/** One project plot per kind, in the build order (each after the one before: ONE landmark at a time). */
export const CIVIC_PLOTS = Object.freeze(CIVIC_ORDER.map(k => `civic${k}`))
export const isCivicPlot = plot => CIVIC_PLOTS.includes(String(plot))
export const civicKindOf = plot => (isCivicPlot(plot) ? String(plot).slice(5) : null)
/** The landmark's search radius round its anchor, and how far from the town's walls' inside it may stand. */
export const CIVIC_SITE = Object.freeze({ r: 22, tries: 6 })
/** The town walk's radius floor for a landmark's proof and visit (wider than buildsite.mjs WALK_R 48: an anchor by the gate or the well). */
export const CIVIC_WALK_R = 64
const centre = box => [Math.floor((box[0] + box[2]) / 2), Math.floor((box[1] + box[3]) / 2)]
/**
 * WHERE A KIND BELONGS (the reconciled siting rules) -> [x, z]. Pure. `town`: { home {x,z}, recs { plot: rec }, park box, well [x,y,z] }.
 *   F plaza   the town's centre (home)                M cross    beside the storehouse (the town's trade goods), else home
 *   B belfry  beside the town hall, else the wall extension's interior, else home             H wellhouse  by the junk well
 *   P pavilion in the park, else home                 S statue   between home and the main gateway (the wall's road gate), else home
 *   L lighthouse  the north road's end at the shore (the road record's end), else none (null)
 */
export function civicNear (kind, { home, recs = {}, park = null, well = null } = {}) {
  const h = [home.x, home.z]
  const boxOf = r => (Array.isArray(r?.box) ? r.box : null)
  if (kind === 'F') return h
  if (kind === 'M') return boxOf(recs.storehouse) ? centre(boxOf(recs.storehouse)) : h
  if (kind === 'B') return boxOf(recs.townhall) ? centre(boxOf(recs.townhall)) : Array.isArray(recs.wallext?.interior) ? centre(recs.wallext.interior) : h
  if (kind === 'H') return Array.isArray(well) ? [well[0], well[2]] : h
  if (kind === 'P') return Array.isArray(park) ? centre(park) : h
  if (kind === 'S') { const g = (recs.wallext?.gates ?? recs.wall?.gates ?? [])[0]; if (!g?.cols?.length) return h; const m = g.cols[Math.floor(g.cols.length / 2)]; return [Math.round((m[0] + h[0]) / 2), Math.round((m[1] + h[1]) / 2)] }
  if (kind === 'L') { const e = recs.road?.instances?.[0]; return Array.isArray(e?.box) ? centre(e.box) : null }
  return h
}
