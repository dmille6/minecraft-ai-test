// townstyle-01: OFFLINE PICTURES of the style library's buildings for the owner (no world, no server): an isometric view of each
// blueprint (half-block resolution, so a stair is a step and a slab is half a block) and a front + gable elevation, as PNG.
//   node bots/scripts/render-townstyle.mjs <outdir>
// Writes <outdir>/townstyle-sheet.png (every design side by side, before -> after) and one PNG per design.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { cottageBlueprint, stylePalette, gableRoof, slabRoof } from '../src/townstyle.mjs'

const OUT = process.argv[2] ?? '.'
// ---- a minimal PNG writer ----------------------------------------------------------------------------------------------------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]) }
function png (w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
class Canvas {
  constructor (w, h, bg = [245, 242, 235]) { this.w = w; this.h = h; this.px = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) this.px.set([...bg, 255], i * 4) }
  set (x, y, c) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const a = (c[3] ?? 255) / 255, i = (y * this.w + x) * 4; for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(this.px[i + k] * (1 - a) + c[k] * a); this.px[i + 3] = 255 }
  poly (pts, c) {   // scanline fill of a convex polygon
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
// ---- materials ----------------------------------------------------------------------------------------------------------------
const WOOD = { oak: [184, 148, 95], spruce: [122, 90, 52], dark_oak: [72, 47, 23], birch: [214, 200, 140], jungle: [170, 120, 85], acacia: [170, 92, 50], mangrove: [118, 54, 48], cherry: [226, 178, 172], pale_oak: [230, 222, 215] }
const BARK = { oak: [102, 81, 50], spruce: [58, 40, 22], dark_oak: [60, 46, 26], birch: [216, 215, 210], jungle: [85, 67, 25], acacia: [103, 96, 86], mangrove: [84, 66, 50], cherry: [54, 33, 44], pale_oak: [80, 74, 72] }
function colorOf (name) {
  const n = String(name)
  let m
  if (/glass/.test(n)) return [168, 216, 234, 170]
  if (/torch/.test(n)) return [255, 204, 51]
  if (/copper/.test(n)) return [192, 107, 79]
  if (/^cobblestone/.test(n)) return [125, 125, 125]
  if (/^stone_brick/.test(n)) return [140, 140, 136]
  if ((m = /^([a-z_]+?)_log$/.exec(n))) return BARK[m[1]] ?? [90, 70, 40]
  if ((m = /^([a-z_]+?)_trapdoor$/.exec(n))) return (WOOD[m[1]] ?? [120, 90, 50]).map(v => v * 0.8)
  if ((m = /^([a-z_]+?)_(planks|stairs|slab)$/.exec(n))) return WOOD[m[1]] ?? [150, 110, 60]
  if (/chest/.test(n)) return [160, 110, 40]
  if (/furnace/.test(n)) return [100, 100, 100]
  if (/crafting_table/.test(n)) return [150, 100, 60]
  return [180, 60, 180]
}
// a cell -> its half-block sub-voxels [[sx, sy, sz]] (0/1 each) in RENDER coordinates (x = u, z = D - 1 - v: the front nearest)
function subsOf (name, st) {
  const all = []; for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) all.push([x, y, z])
  const n = String(name)
  if (/torch/.test(n)) return [[0, 0, 1]]
  if (/_slab$/.test(n)) return all.filter(s => s[1] === (st?.type === 'top' ? 1 : 0))
  if (/_trapdoor$/.test(n)) return all.filter(s => s[1] === (st?.half === 'top' ? 1 : 0))
  if (/_stairs$/.test(n) && st?.facing) {
    // facing in LOCAL axes: +u -> +x, -u -> -x, +v -> -z (z = D - 1 - v), -v -> +z
    const f = { '+u': [1, 0], '-u': [-1, 0], '+v': [0, -1], '-v': [0, 1] }[st.facing] ?? [0, 0]
    const back = s => (f[0] ? (f[0] > 0 ? s[0] === 1 : s[0] === 0) : (f[1] > 0 ? s[2] === 1 : s[2] === 0))
    const full = st.half === 'top' ? 1 : 0
    return all.filter(s => s[1] === full || back(s))
  }
  return all
}
const HIDDEN = new Set(['base'])   // the pad is drawn (it is part of the building); nothing hidden for now
function iso (cells, palette, { a = 7, title = '' } = {}) {
  const pick = role => (palette[role] ?? ['magenta']).find(x => !x.startsWith('$') && !x.startsWith('*')) ?? 'oak_planks'
  const D = Math.max(...cells.map(c => c.v)) + 1
  const subs = []
  for (const c of cells) {
    if (HIDDEN.has('none') && c.role === 'base') continue
    const name = pick(c.role)
    for (const s of subsOf(name, c.st)) subs.push({ x: c.u * 2 + s[0], y: c.y * 2 + s[1], z: (D - 1 - c.v) * 2 + s[2], col: colorOf(name) })
  }
  const occ = new Set(subs.map(s => `${s.x},${s.y},${s.z}`))
  const xs = subs.map(s => s.x), zs = subs.map(s => s.z), ys = subs.map(s => s.y)
  const minS = Math.min(...subs.map(s => s.x - s.z)), maxS = Math.max(...subs.map(s => s.x - s.z))
  const W = Math.ceil((maxS - minS + 2) * a) + 20
  const H = Math.ceil((Math.max(...xs) + Math.max(...zs) + 2) * a / 2 + (Math.max(...ys) + 2) * a) + 40
  const cv = new Canvas(W, H)
  const ox = -minS * a + 10, oy = (Math.max(...ys) + 1) * a + 30
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
// a 3x5 pixel font for the captions (upper case, digits and a few signs)
const FONT = { A: '7d7d5', B: '6d6d6', C: '74447', D: '6555 6', E: '74647', F: '74644', G: '74557', H: '55755', I: '72227', J: '11157', K: '55655', L: '44447', M: '57755', N: '75555', O: '75557', P: '75744', Q: '7557 1', R: '75765', S: '74717', T: '72222', U: '55557', V: '55552', W: '55775', X: '55255', Y: '55222', Z: '71247', 0: '75557', 1: '26227', 2: '71747', 3: '71717', 4: '55711', 5: '74717', 6: '74757', 7: '71111', 8: '75757', 9: '75711', '@': '75747', '-': '00700', '>': '42124', '(': '24442', ')': '42224', '/': '11244', ':': '02020', '.': '00002', ',': '00024', ' ': '00000', '=': '07070' }
function text (cv, x, y, s, c = [40, 40, 40]) {
  let cx = x
  for (const ch of String(s).toUpperCase()) {
    const g = (FONT[ch] ?? '77777').replace(/ /g, '0')
    for (let r = 0; r < 5; r++) { const bits = parseInt(g[r] ?? '0', 16); for (let k = 0; k < 3; k++) if (bits & (4 >> k)) cv.rect(cx + k * 2, y + r * 2, 2, 2, c) }
    cx += 8
  }
}
// ---- the designs ------------------------------------------------------------------------------------------------------------
const STYLE = { wood: 'spruce', roof: 'dark_oak', stone: 'cobblestone' }
const designs = []
const load = id => JSON.parse(fs.readFileSync(new URL(`../src/blueprints/${id}.json`, import.meta.url), 'utf8'))
designs.push({ file: 'before-house@1', title: 'BEFORE: HOUSE@1 (FLAT)', bp: load('house@1'), palette: { ...load('house@1').palette, wall: ['spruce_planks'], roof: ['spruce_planks'], trim: ['spruce_planks'] } })
for (const v of ['s', 'f']) { const bp = cottageBlueprint(v); designs.push({ file: `cottage@1${v}`, title: `COTTAGE@1${v.toUpperCase()} (${v === 's' ? 'EAVES FRONT' : 'GABLE FRONT'})`, bp, palette: stylePalette(bp.palette, STYLE) }) }
designs.push({ file: 'cottage@1s-oak', title: 'COTTAGE@1S OAK/STONE BRICK', bp: cottageBlueprint('s'), palette: stylePalette(cottageBlueprint('s').palette, { wood: 'oak', roof: 'spruce', stone: 'stone_bricks' }) })
// townstyle-02: the re-roofed generations and the town hall (bots/scripts/make-townstyle.mjs)
for (const [id, title] of [['workshop@1', 'BEFORE: WORKSHOP@1'], ['workshop@2', 'WORKSHOP@2, 45 DEG GABLE'], ['hall@1', 'BEFORE: COPPER HALL'], ['hall@2', 'COPPER HALL@2, 1:2 SLAB ROOF'],
  ['storehub@1', 'BEFORE: STORAGE HALL'], ['storehub@2', 'STORAGE HALL@2, SLAB ROOF'], ['enchantshop@2', 'ENCHANTING WORKSHOP@2'], ['townhall@1', 'TOWN HALL@1 (PLOT X2)']]) {
  const bp = load(id)
  const pal = stylePalette(bp.palette, { wood: 'spruce', roof: 'dark_oak', stone: 'stone_bricks' })
  designs.push({ file: id, title, bp, palette: { ...pal, wall: pal.wall?.map(n => (n === '$planks' ? 'spruce_planks' : n)) ?? ['spruce_planks'], trim: ['cut_copper'] } })
}
fs.mkdirSync(OUT, { recursive: true })
const pics = []
for (const d of designs) {
  const cv = iso(d.bp.cells, d.palette, { title: d.title, a: 10 })
  fs.writeFileSync(path.join(OUT, `townstyle-${d.file}.png`), png(cv.w, cv.h, cv.px))
  pics.push(cv)
  console.log(`wrote ${path.join(OUT, `townstyle-${d.file}.png`)} ${cv.w}x${cv.h}`)
}
// the sheet: two rows
const rows = [pics.slice(0, 4), pics.slice(4, 8), pics.slice(8, 10), pics.slice(10)]
const W = Math.max(...rows.map(r => r.reduce((s, p) => s + p.w + 10, 10)))
const H = rows.reduce((s, r) => s + Math.max(...r.map(p => p.h)) + 10, 40)
const sheet = new Canvas(W, H, [255, 255, 255])
text(sheet, 10, 10, 'TOWNSTYLE-01: PITCHED ROOFS (OFFLINE RENDER OF THE BLUEPRINTS, HALF-BLOCK RESOLUTION)')
let y = 40
for (const r of rows) { let x = 10; for (const p of r) { sheet.blit(p, x, y); x += p.w + 10 } y += Math.max(...r.map(p => p.h)) + 10 }
fs.writeFileSync(path.join(OUT, 'townstyle-sheet.png'), png(sheet.w, sheet.h, sheet.px))
console.log(`wrote ${path.join(OUT, 'townstyle-sheet.png')} ${sheet.w}x${sheet.h}`)
