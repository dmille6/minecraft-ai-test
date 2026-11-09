// READ-ONLY offline: the country chain's bands (country.mjs countryStages + tidy.mjs siteStage classic:false + countryPlantings)
// on the showcase snapshot dump. usage: node country-run.mjs <bots> <dump.json> <recsdir> [out.json]
import fs from 'node:fs'
import { createRequire } from 'node:module'
const W = process.argv[2], D = process.argv[3], R = process.argv[4], OUT = process.argv[5]
const md = createRequire(W + '/package.json')('minecraft-data')('1.21.11')
const imp = m => import(`${W}/src/${m}.mjs`)
const [TI, LP, SH, CO] = await Promise.all(['tidy', 'landplan', 'shop', 'country'].map(imp))
const j = JSON.parse(fs.readFileSync(D, 'utf8'))
const [x0, z0, x1, z1] = j.box, [y0, y1] = j.y, nx = x1 - x0 + 1, nz = z1 - z0 + 1
const buf = Buffer.from(j.cells, 'base64')
const idx = j.bits === 16 ? i => buf.readUInt16LE(i * 2) : i => buf[i]
const pal = j.palette.map(n => { const base = n.replace(/\[.*$/, ''); if (base === '?') return undefined; const b = md.blocksByName[base]; const lm = n.match(/layers=(\d+)/); return { name: n.includes('waterlogged') ? base + '[waterlogged]' : base, boundingBox: b ? b.boundingBox : 'block', ...(lm ? { props: { layers: lm[1] } } : {}) } })
const read = (x, y, z) => (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) ? null : (pal[idx(((y - y0) * nz + (z - z0)) * nx + (x - x0))] ?? null)
const recs = {}
for (const f of fs.readdirSync(R)) { const m = f.match(/^project-0_70_0\.([a-z0-9]+)\.g\d+\.json$/); if (m) recs[m[1]] = JSON.parse(fs.readFileSync(`${R}/${f}`, 'utf8')) }
const home = { x: 0, y: 70, z: 0 }
const land = recs.land, wall = recs.wall, wallext = recs.wallext
const others = Object.entries(recs).filter(([k]) => !/^(tidy|land|siteprep)$/.test(k)).map(([k, r]) => ({ ...r, plot: r.plot ?? k }))
const zones = SH.recordZones(others)
const avoid = (x, z) => { for (const zz of zones) { const b = zz.box; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return zz.why ?? 'project' } return null }
const tidy = recs.tidy
const cells = new Set(Object.values(recs).flatMap(r => (r.cells ?? []).map(c => c.at.join(','))))
for (const q of [...(tidy?.cut ?? []), ...(tidy?.clear ?? [])]) cells.add(q.at.join(','))
const boxes = TI.inwallBoxes(wall, home, wallext)
const inWall = (x, z) => boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])
const pathCols = new Set((recs.paths?.cells ?? []).map(c => `${c.at[0]},${c.at[2]}`))
const corridor = LP.corridorAt(land)
const out = []
let T = { cells: 0, cut: 0, clear: 0, plant: 0 }
for (const st of CO.countryStages()) {
  const t = Date.now()
  const s = await TI.siteStage(read, { home, land, stage: st, avoid, cells, terrace: { wall, wallext, records: others, climbs: [] }, lights: 0, classic: false })
  const r = s.record
  const busy = new Set([...(r?.cells ?? []), ...(r?.cut ?? []), ...(r?.clear ?? [])].map(q => `${q.at[0]},${q.at[2]}`))
  const p = CO.countryPlantings(read, { home, band: st, inWall, busy, avoid, corridor, pathCols, cells, seed: land.seed })
  const rec = CO.countryRecord(r, p, { stage: st, home })
  const roles = {}; for (const c of rec?.cells ?? []) roles[c.role] = (roles[c.role] ?? 0) + 1
  T.cells += (rec?.cells ?? []).length - p.cells.length; T.cut += rec?.cut?.length ?? 0; T.clear += rec?.clear?.length ?? 0; T.plant += p.cells.length
  console.log(`${st.id.padEnd(5)} (${st.rMin},${st.rMax}] k${st.k} roads=${st.roads} earth ${((rec?.cells ?? []).length - p.cells.length)} cut ${rec?.cut?.length ?? 0} clear ${rec?.clear?.length ?? 0} replant ${rec?.replant?.length ?? 0} | plant ${p.cells.length} groves ${p.census.groves} saplings ${p.census.saplings} drifts ${p.census.drifts} flowers ${p.census.flowers} elig ${p.census.eligible}/${p.census.cols} roles ${JSON.stringify(roles)} skip ${JSON.stringify(p.census.skipped)} rough ${JSON.stringify(s.band?.rough?.census ?? {})} ${((Date.now() - t) / 1000).toFixed(1)}s`)
  out.push({ stage: st, rec })
}
console.log('TOTAL', JSON.stringify(T))
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out))
