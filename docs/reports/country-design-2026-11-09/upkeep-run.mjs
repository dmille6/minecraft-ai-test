// READ-ONLY offline: the upkeep survey (upkeep.mjs) per tile on the showcase snapshot dump
import fs from 'node:fs'
import { createRequire } from 'node:module'
const W = process.argv[2], D = process.argv[3], R = process.argv[4], OUT = process.argv[5]
const md = createRequire(W + '/package.json')('minecraft-data')('1.21.11')
const [UK, SH] = await Promise.all(['upkeep', 'shop'].map(m => import(`${W}/src/${m}.mjs`)))
const j = JSON.parse(fs.readFileSync(D, 'utf8'))
const [x0, z0, x1, z1] = j.box, [y0, y1] = j.y, nx = x1 - x0 + 1, nz = z1 - z0 + 1
const buf = Buffer.from(j.cells, 'base64')
const idx = j.bits === 16 ? i => buf.readUInt16LE(i * 2) : i => buf[i]
const pal = j.palette.map(n => { const base = n.replace(/\[.*$/, ''); if (base === '?') return undefined; const b = md.blocksByName[base]; const lm = n.match(/layers=(\d+)/); return { name: n.includes('waterlogged') ? base + '[waterlogged]' : base, boundingBox: b ? b.boundingBox : 'block', ...(lm ? { props: { layers: lm[1] } } : {}) } })
const read = (x, y, z) => (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) ? null : (pal[idx(((y - y0) * nz + (z - z0)) * nx + (x - x0))] ?? null)
const recs = {}
for (const f of fs.readdirSync(R)) { const m = f.match(/^project-0_70_0\.([a-z0-9]+)\.g\d+\.json$/); if (m) recs[m[1]] = JSON.parse(fs.readFileSync(`${R}/${f}`, 'utf8')) }
const home = { x: 0, y: 70, z: 0 }
const others = Object.entries(recs).filter(([k]) => !/^(tidy|land|siteprep)$/.test(k)).map(([k, r]) => ({ ...r, plot: r.plot ?? k }))
const zones = SH.recordZones(others)
const avoid = (x, z) => { for (const zz of zones) { const b = zz.box; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return zz.why ?? 'project' } return null }
// the protected village (showcase-taiga-6_1): from /srv/showcase/trip zones -- approximated by its box when given
const ZB = process.env.ZONE ? JSON.parse(process.env.ZONE) : []
const zone = (x, y, z) => ZB.some(b => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5])
const cells = new Set(Object.values(recs).flatMap(r => [...(r.cells ?? []), ...(r.cut ?? []), ...(r.clear ?? [])].map(c => c.at.join(','))))
const all = []
for (let t = 0; t < 4; t++) {
  const t0 = Date.now()
  const sv = UK.upkeepSurvey(read, { home, box: UK.upkeepTile(home, t), cells, avoid, zone })
  console.log('tile', t, UK.upkeepTile(home, t), 'clears', sv.clear.length, 'cells', sv.cells.length, JSON.stringify(sv.census), ((Date.now() - t0) / 1000).toFixed(1) + 's')
  all.push(sv)
}
// the whole reach, uncapped, for the census
const svA = UK.upkeepSurvey(read, { home, cells, avoid, zone, U: { ...UK.UPKEEP, jobMax: 100000 } })
console.log('ALL (uncapped)', JSON.stringify(svA.census))
if (OUT) fs.writeFileSync(OUT, JSON.stringify(svA))
