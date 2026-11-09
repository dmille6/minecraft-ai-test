// CITYWALL-01 / CIVIC-01: OFFLINE PICTURES for the owner (no server): an isometric view of a box of blocks at half-block resolution
// (a stair is a step, a slab half a block, a wall post thin, a lantern small) and a top-down map. Library only (no side effects):
// citywall-offline.mjs and render-civic.mjs draw with it. PNG writer, canvas and the 3x5 caption font as render-townstyle.mjs.
import zlib from 'node:zlib'

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]) }
export function png (w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
export class Canvas {
  constructor (w, h, bg = [245, 242, 235]) { this.w = w; this.h = h; this.px = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) this.px.set([...bg, 255], i * 4) }
  set (x, y, c) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const a = (c[3] ?? 255) / 255, i = (y * this.w + x) * 4; for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(this.px[i + k] * (1 - a) + c[k] * a); this.px[i + 3] = 255 }
  poly (pts, c) {
    const ys = pts.map(p => p[1]), y0 = Math.ceil(Math.min(...ys)), y1 = Math.floor(Math.max(...ys))
    for (let y = y0; y <= y1; y++) {
      const xs = []
      for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]; if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay)) }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.set(x, y, c)
    }
  }
  rect (x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c) }
  blit (o, ox, oy) { for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) { const i = (y * o.w + x) * 4; this.set(ox + x, oy + y, [o.px[i], o.px[i + 1], o.px[i + 2], 255]) } }
}
const FONT = { A: '75755', B: '65656', C: '74447', D: '65556', E: '74647', F: '74644', G: '74557', H: '55755', I: '72227', J: '11157', K: '55655', L: '44447', M: '57755', N: '75555', O: '75557', P: '75744', Q: '75571', R: '75765', S: '74717', T: '72222', U: '55557', V: '55552', W: '55775', X: '55255', Y: '55222', Z: '71247', 0: '75557', 1: '26227', 2: '71747', 3: '71717', 4: '55711', 5: '74717', 6: '74757', 7: '71111', 8: '75757', 9: '75711', '@': '75747', '-': '00700', '>': '42124', '(': '24442', ')': '42224', '/': '11244', ':': '02020', '.': '00002', ',': '00024', ' ': '00000', '=': '07070', '+': '02720', '#': '57575', '%': '51245' }
export function text (cv, x, y, s, c = [40, 40, 40], sc = 2) {
  let cx = x
  for (const ch of String(s).toUpperCase()) {
    const g = FONT[ch] ?? '77777'
    for (let r = 0; r < 5; r++) { const bits = parseInt(g[r] ?? '0', 16); for (let k = 0; k < 3; k++) if (bits & (4 >> k)) cv.rect(cx + k * sc, y + r * sc, sc, sc, c) }
    cx += 4 * sc
  }
}
// ---- colours ------------------------------------------------------------------------------------------------------------------
const WOOD = { oak: [184, 148, 95], spruce: [122, 90, 52], dark_oak: [72, 47, 23], birch: [214, 200, 140], jungle: [170, 120, 85], acacia: [170, 92, 50], mangrove: [118, 54, 48], cherry: [226, 178, 172], pale_oak: [230, 222, 215] }
const BARK = { oak: [102, 81, 50], spruce: [58, 40, 22], dark_oak: [60, 46, 26], birch: [216, 215, 210], jungle: [85, 67, 25], acacia: [103, 96, 86], mangrove: [84, 66, 50], cherry: [54, 33, 44], pale_oak: [80, 74, 72] }
export function colorOf (name) {
  const n = String(name).replace(/\[.*\]$/, '')
  let m
  if (/^(air|cave_air|void_air)$/.test(n)) return null
  if (/glass/.test(n)) return [168, 216, 234, 150]
  if (/lantern/.test(n)) return [255, 196, 70]
  if (/torch/.test(n)) return [255, 214, 70]
  if (/iron_bars/.test(n)) return [70, 72, 76]
  if (/^water|bubble/.test(n)) return [62, 102, 206, 200]
  if (/ice/.test(n)) return [160, 196, 240]
  if (/^snow/.test(n)) return [240, 242, 246]
  if (/copper/.test(n)) return [192, 107, 79]
  if (/^mossy_cobblestone/.test(n)) return [108, 122, 96]
  if (/^cobblestone/.test(n)) return [122, 122, 122]
  if (/^mossy_stone_brick/.test(n)) return [118, 132, 104]
  if (/^chiseled_stone/.test(n)) return [168, 166, 160]
  if (/^stone_brick/.test(n)) return [150, 150, 146]
  if (/^chiseled_deepslate/.test(n)) return [66, 66, 72]
  if (/deepslate/.test(n)) return [72, 72, 80]
  if (/^polished_andesite$/.test(n)) return [136, 140, 138]
  if (/^smooth_stone$/.test(n)) return [160, 160, 160]
  if (/^(stone|andesite|tuff)$/.test(n)) return [126, 126, 126]
  if (/^(diorite|calcite)$/.test(n)) return [200, 200, 200]
  if (/^granite$/.test(n)) return [150, 104, 88]
  if (/^gravel$/.test(n)) return [140, 132, 128]
  if (/^grass_block$/.test(n)) return [98, 152, 70]
  if (/^(dirt|coarse_dirt|rooted_dirt|farmland)$/.test(n)) return [128, 92, 62]
  if (/^podzol$/.test(n)) return [104, 74, 44]
  if (/^dirt_path$/.test(n)) return [168, 142, 88]
  if (/^(sand|sandstone)$/.test(n)) return [216, 204, 150]
  if (/^moss/.test(n)) return [90, 120, 50]
  if ((m = /^([a-z_]+?)_leaves$/.exec(n))) return [52, 92, 48]
  if ((m = /^([a-z_]+?)_(log|wood)$/.exec(n))) return BARK[m[1]] ?? [90, 70, 40]
  if ((m = /^([a-z_]+?)_trapdoor$/.exec(n))) return (WOOD[m[1]] ?? [120, 90, 50]).map(v => v * 0.8)
  if ((m = /^([a-z_]+?)_(planks|stairs|slab|fence|fence_gate)$/.exec(n))) return WOOD[m[1]] ?? [150, 110, 60]
  if (/chest|barrel/.test(n)) return [160, 110, 40]
  if (/furnace|smoker/.test(n)) return [100, 100, 100]
  if (/crafting_table|composter/.test(n)) return [150, 100, 60]
  if (/short_grass|fern|tall_grass|bush|sapling|flower|poppy|dandelion|tulip|azure|cornflower|lily|daisy|allium|orchid|petals/.test(n)) return null
  if (/stone|ore/.test(n)) return [126, 126, 126]
  return [170, 90, 170]
}
/** A block -> its half-block sub-voxels [[sx, sy, sz]] (each 0/1). Shapes: slabs, stairs (world facing), walls/fences/bars (a post),
 *  lanterns and torches (small). Pure. */
export function subsOf (name, st = null) {
  const all = []; for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) all.push([x, y, z])
  const n = String(name)
  if (/torch|lantern/.test(n)) return [[0, st?.hanging === 'true' ? 1 : 0, 0]]
  if (/_slab$/.test(n)) return st?.type === 'double' ? all : all.filter(s => s[1] === (st?.type === 'top' ? 1 : 0))
  if (/_wall$|_fence$|iron_bars/.test(n)) return [[0, 0, 0], [0, 1, 0]]
  if (/_stairs$/.test(n)) {
    const f = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] }[st?.facing] ?? [0, 0]
    const back = s => (f[0] ? (f[0] > 0 ? s[0] === 1 : s[0] === 0) : f[1] ? (f[1] > 0 ? s[2] === 1 : s[2] === 0) : true)
    const full = st?.half === 'top' ? 1 : 0
    return all.filter(s => s[1] === full || back(s))
  }
  return all
}
/**
 * AN ISOMETRIC VIEW of a box of the world -> Canvas. `get(x, y, z)` -> { name, st } | null. The view looks from the south-east (+x, +z
 * toward the viewer) unless `from` names another corner ('sw', 'nw', 'ne'). `mark(x, y, z)` -> an RGBA tint for a cell (the new
 * cells, highlighted). Half-block resolution, `a` pixels per half block.
 */
export function isoWorld (get, [x0, y0, z0, x1, y1, z1], { a = 4, title = '', from = 'se', bg = [236, 240, 244], mark = null } = {}) {
  const fx = from === 'se' || from === 'ne' ? 1 : -1, fz = from === 'se' || from === 'sw' ? 1 : -1
  const subs = []
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const b = get(x, y, z)
    if (!b) continue
    let col = colorOf(b.name)
    if (!col) continue
    const tint = mark?.(x, y, z)
    if (tint) col = [Math.round(col[0] * 0.7 + tint[0] * 0.3), Math.round(col[1] * 0.7 + tint[1] * 0.3), Math.round(col[2] * 0.7 + tint[2] * 0.3), col[3]]
    for (const s of subsOf(b.name, b.st)) {
      // render coordinates: u grows toward the viewer's right-front, w toward the left-front
      const X = ((fx > 0 ? x - x0 : x1 - x) * 2 + (fx > 0 ? s[0] : 1 - s[0])), Z = ((fz > 0 ? z - z0 : z1 - z) * 2 + (fz > 0 ? s[2] : 1 - s[2]))
      subs.push({ x: X, y: (y - y0) * 2 + s[1], z: Z, col })
    }
  }
  if (!subs.length) return new Canvas(200, 60, bg)
  const occ = new Set(subs.filter(s => !s.col[3] || s.col[3] === 255).map(s => `${s.x},${s.y},${s.z}`))
  const nx = (x1 - x0 + 1) * 2, nz = (z1 - z0 + 1) * 2, ny = (y1 - y0 + 1) * 2
  const W = Math.ceil((nx + nz + 2) * a) + 20
  const H = Math.ceil((nx + nz + 2) * a / 2 + (ny + 2) * a) + 40
  const cv = new Canvas(W, H, bg)
  const ox = nz * a + 10, oy = (ny + 1) * a + 30
  const P = (x, y, z) => [ox + (x - z) * a, oy + (x + z) * a / 2 - y * a]
  subs.sort((p, q) => (p.x + p.z) - (q.x + q.z) || p.y - q.y)
  const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f, c[3] ?? 255]
  for (const s of subs) {
    const { x, y, z, col } = s
    if (!occ.has(`${x},${y + 1},${z}`) || col[3]) cv.poly([P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], shade(col, 1.0))
    if (!occ.has(`${x + 1},${y},${z}`) || col[3]) cv.poly([P(x + 1, y, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1)], shade(col, 0.78))
    if (!occ.has(`${x},${y},${z + 1}`) || col[3]) cv.poly([P(x, y, z + 1), P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], shade(col, 0.62))
  }
  text(cv, 10, 8, title)
  return cv
}
/** A TOP-DOWN MAP of a box -> Canvas: each column's top block coloured, shaded by height; `over(x, z)` -> an RGBA overlay. */
export function topMap (get, [x0, y0, z0, x1, y1, z1], { s = 4, title = '', over = null } = {}) {
  const W = (x1 - x0 + 1) * s, H = (z1 - z0 + 1) * s
  const cv = new Canvas(W, H + 30, [255, 255, 255])
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    let col = [30, 30, 30], top = y0
    for (let y = y1; y >= y0; y--) { const b = get(x, y, z); if (!b) continue; const c = colorOf(b.name); if (!c) continue; col = c; top = y; break }
    const f = 0.75 + 0.25 * Math.min(1, Math.max(0, (top - y0) / Math.max(1, y1 - y0)))
    cv.rect((x - x0) * s, (z - z0) * s + 30, s, s, [col[0] * f, col[1] * f, col[2] * f])
    const o = over?.(x, z)
    if (o) cv.rect((x - x0) * s, (z - z0) * s + 30, s, s, o)
  }
  text(cv, 6, 8, title)
  return cv
}
/** Lay pictures out in rows on a white sheet with a heading -> Canvas. */
export function sheet (rows, heading = '') {
  const W = Math.max(...rows.map(r => r.reduce((t, p) => t + p.w + 10, 10)))
  const H = rows.reduce((t, r) => t + Math.max(...r.map(p => p.h)) + 10, 44)
  const cv = new Canvas(W, H, [255, 255, 255])
  text(cv, 10, 12, heading, [20, 20, 20], 3)
  let y = 44
  for (const r of rows) { let x = 10; for (const p of r) { cv.blit(p, x, y); x += p.w + 10 } y += Math.max(...r.map(p => p.h)) + 10 }
  return cv
}
