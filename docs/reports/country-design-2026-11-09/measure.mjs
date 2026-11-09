// READ-ONLY offline measure (showcase snapshot 11-09 12:10Z): upkeep candidates + countryside rings, with the bots' own code.
// usage: node measure.mjs <worktree>/bots <dump.json> <recsdir>
import fs from 'node:fs'
import { createRequire } from 'node:module'
const W = process.argv[2], D = process.argv[3], R = process.argv[4]
const md = createRequire(W + '/package.json')('minecraft-data')('1.21.11')
const imp = m => import(`${W}/src/${m}.mjs`)
const [BR, BS, TI, LP, ZG, WL, PA, CF, CA, ST, RG, SH] = await Promise.all(['buildrun', 'buildsite', 'tidy', 'landplan', 'ziggurat', 'wall', 'paths', 'cropfarm', 'canefarm', 'storehouse', 'roughground', 'shop'].map(imp))
const j = JSON.parse(fs.readFileSync(D, 'utf8'))
const [x0, z0, x1, z1] = j.box, [y0, y1] = j.y, nx = x1 - x0 + 1, nz = z1 - z0 + 1
const buf = Buffer.from(j.cells, 'base64')
const idx = j.bits === 16 ? i => buf.readUInt16LE(i * 2) : i => buf[i]
const pal = j.palette.map(n => {
  const base = n.replace(/\[.*$/, '')
  if (base === '?') return undefined
  const b = md.blocksByName[base]
  return { name: n.includes('waterlogged') ? base + '[waterlogged]' : base, boundingBox: b ? b.boundingBox : 'block' }
})
const read = (x, y, z) => (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) ? null : (pal[idx(((y - y0) * nz + (z - z0)) * nx + (x - x0))] ?? null)
const nm = b => String(b?.name ?? '').replace(/\[.*$/, '')
const recs = {}
for (const f of fs.readdirSync(R)) { const m = f.match(/^project-0_70_0\.([a-z0-9]+)\.g\d+\.json$/); if (m) recs[m[1]] = JSON.parse(fs.readFileSync(`${R}/${f}`, 'utf8')) }
const home = { x: 0, y: 70, z: 0 }
// ---- 1. damage on finished records (approximate: palettes as the bot's blueprintOf picks them)
const paletteOf = r => {
  if (r.palette && Object.keys(r.palette).length) return r.palette
  const id = r.blueprint
  if (/^ziggurat|monument/.test(id)) return ZG.zigPaletteOf ? ZG.zigPaletteOf(r) : ZG.ZIG_PALETTE
  if (/^wall/.test(id)) return WL.WALL_PALETTE
  if (/^paths/.test(id)) return PA.PATH_PALETTE
  if (/^cropfarm/.test(id)) return CF.CROP_PALETTE
  if (/^canefarm/.test(id)) return CA.CANE_PALETTE
  if (/^storehouse/.test(id)) return ST.STORE_PALETTE
  try { return BS.loadBlueprint(id).palette } catch { return null }
}
console.log('== DAMAGE on complete records (cells not done / cells; light-role cells not done) ==')
let lightsOpen = 0, lightsAll = 0
for (const [k, r] of Object.entries(recs)) {
  if (!(r.structure_complete || r.state === 'complete' || r.state === 'standing')) continue
  if (/^(tidy|land|siteprep|shaft|stepwell|treefarm|forest|walldemo)$/.test(k)) continue
  const p = paletteOf(r)
  if (!p) { console.log(k, 'no palette'); continue }
  const waived = r.waived ?? {}
  const out = [], byRole = {}
  for (const c of r.cells ?? []) {
    if (Object.prototype.hasOwnProperty.call(waived, c.at.join(','))) continue
    const b = read(...c.at)
    if (b === null) continue
    const isLight = /light|lamp|torch/.test(c.role)
    if (isLight) lightsAll++
    let done
    try { done = BR.cellDone(b, p, c.role) } catch { done = true }
    if (!done) { out.push(c); byRole[c.role] = (byRole[c.role] ?? 0) + 1; if (isLight) lightsOpen++ }
  }
  console.log(`  ${k.padEnd(12)} ${String(out.length).padStart(4)} / ${String((r.cells ?? []).length).padEnd(5)} ${JSON.stringify(byRole).slice(0, 160)} ${out.slice(0, 3).map(c => c.at.join(',') + ':' + nm(read(...c.at))).join(' ')}`)
}
console.log(`  LIGHT cells not lit: ${lightsOpen} / ${lightsAll}`)
// ---- 2. columns: surface, strays, stumps, farmland, saplings
const SOIL = /^(grass_block|dirt|podzol|coarse_dirt|rooted_dirt|moss_block|mycelium|farmland|dirt_path)$/
const LOG = /_(log|wood)$/
const recCells = new Set(Object.values(recs).flatMap(r => (r.cells ?? []).map(c => c.at.join(','))))
const ring = (x, z) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z))
const RINGS = [[-1, 28], [28, 48], [48, 64], [64, 80], [80, 96], [96, 112], [112, 128], [128, 144]]
const ringOf = d => RINGS.findIndex(([a, b]) => d > a && d <= b)
const st = RINGS.map(() => ({ cols: 0, tables: 0, furnaces: 0, stumps: 0, saplings: 0, flowers: 0, grass: 0, dirtTop: 0, cobbleTop: 0, water: 0, leavesTop: 0, logsFloat: 0, short: 0 }))
const FLOWER = /^(poppy|dandelion|cornflower|oxeye_daisy|azure_bluet|allium|blue_orchid|lily_of_the_valley|.*_tulip|rose_bush|lilac|peony|sunflower|pink_petals)$/
for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
  const ri = ringOf(ring(x, z)); if (ri < 0) continue
  const s = st[ri]; s.cols++
  let top = null
  for (let y = y1; y >= y0; y--) {
    const b = read(x, y, z); const n = nm(b)
    if (!b) continue
    if (n === 'crafting_table' && !recCells.has(`${x},${y},${z}`)) s.tables++
    if (/^(furnace|blast_furnace|smoker)$/.test(n) && !recCells.has(`${x},${y},${z}`)) s.furnaces++
    if (top === null && b.boundingBox === 'block' && !/_leaves$/.test(n)) { top = [y, n] }
    if (top === null && /_sapling$/.test(n)) s.saplings++
    if (top === null && FLOWER.test(n)) s.flowers++
    if (top === null && /^(short_grass|tall_grass|fern|large_fern)$/.test(n)) s.short++
    if (top === null && /_leaves$/.test(n)) {}
    if (top === null && /^water$/.test(n)) { s.water++; top = [y, 'water'] }
  }
  if (!top) continue
  const [ty, tn] = top
  if (tn === 'grass_block') s.grass++
  else if (/^(dirt|coarse_dirt)$/.test(tn)) s.dirtTop++
  else if (/cobble/.test(tn)) s.cobbleTop++
  // a stump: a log column standing on soil whose top log has no log/leaves above within 2 (a felled tree's base), 1-3 logs high
  if (LOG.test(tn)) {
    let h = 0, y = ty; while (LOG.test(nm(read(x, y, z))) && h < 8) { h++; y-- }
    const under = nm(read(x, y, z))
    const above = [1, 2, 3].map(d => nm(read(x, ty + d, z)))
    if (SOIL.test(under) && h <= 3 && !above.some(n => /_leaves$|_log$/.test(n))) s.stumps++
    if (!SOIL.test(under) && !LOG.test(under) && under !== '' && read(x, y, z)?.boundingBox === 'empty') s.logsFloat++
  }
}
console.log('== RINGS (Chebyshev from home 0,70,0; wall ring ~26) ==')
console.log('ring        cols  grass  dirtTop cobTop water  flowers short saplings stumps tables furnaces floatLogs')
RINGS.forEach(([a, b], i) => { const s = st[i]; console.log(`${String(a + 1).padStart(4)}-${String(b).padEnd(4)} ${String(s.cols).padStart(6)} ${String(s.grass).padStart(6)} ${String(s.dirtTop).padStart(7)} ${String(s.cobbleTop).padStart(6)} ${String(s.water).padStart(5)} ${String(s.flowers).padStart(8)} ${String(s.short).padStart(5)} ${String(s.saplings).padStart(8)} ${String(s.stumps).padStart(6)} ${String(s.tables).padStart(6)} ${String(s.furnaces).padStart(8)} ${String(s.logsFloat).padStart(9)}`) })
// ---- 3. farmland on the crop farm
const cf = recs.cropfarm
if (cf) { const t = (cf.cells ?? []).filter(c => c.role === 'till'); console.log('CROPFARM till cells', t.length, 'farmland now', t.filter(c => nm(read(...c.at)) === 'farmland').length, t.filter(c => nm(read(...c.at)) !== 'farmland').map(c => c.at.join(',') + ':' + nm(read(...c.at))).join(' ')) }
fs.writeFileSync(new URL('./ringstats.json', import.meta.url), JSON.stringify(st))
// ---- 4. countryside: the bots' own band siting (tidy.mjs siteStage) for each ring, today's stages and wider rings
const land = recs.land
const wall = recs.wall, wallext = recs.wallext
const others = Object.entries(recs).filter(([k]) => !/^(tidy|land|siteprep)$/.test(k)).map(([k, r]) => ({ ...r, plot: r.plot ?? k }))
const zones = SH.recordZones(others)
const avoid = (x, z) => { for (const zz of zones) { const b = zz.box; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return zz.why ?? 'project' } return null }
const L2 = { ...LP.LAND, workR: Number(process.env.WORKR ?? 144) }
const stages = LP.landStages(L2).filter(s => /^rim/.test(s.id))
console.log('== COUNTRYSIDE: siteStage per band (the bots\' own survey; avoid = record boxes+3, cells = every record cell) ==')
for (const sg of stages) {
  const t = Date.now()
  let s
  try { s = await TI.siteStage(read, { home, land, stage: sg, avoid, cells: recCells, terrace: { wall, wallext, records: others, climbs: [] }, L: L2, lights: 0 }) } catch (e) { console.log(sg.id, 'ERR', String(e?.stack ?? e).slice(0, 300)); continue }
  const r = s.record
  const roles = {}
  for (const c of r?.cells ?? []) roles[c.role] = (roles[c.role] ?? 0) + 1
  console.log(`${sg.id.padEnd(7)} (${sg.rMin},${sg.rMax}] ${s.why} cells ${r?.cells?.length ?? 0} ${JSON.stringify(roles)} cut ${r?.cut?.length ?? 0} clear ${r?.clear?.length ?? 0} replant ${r?.replant?.length ?? 0} band ${JSON.stringify(s.band ?? {}).slice(0, 400)} ${((Date.now() - t) / 1000).toFixed(1)}s`)
}
