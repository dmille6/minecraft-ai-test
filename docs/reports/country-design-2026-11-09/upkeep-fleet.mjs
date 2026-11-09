// READ-ONLY offline: the fleet port's upkeep survey (upkeep.mjs) over a town's whole reach, on region-copy dumps of 4 fleet towns
import fs from 'node:fs'
import { createRequire } from 'node:module'
const W = process.argv[2], D = process.argv[3], R = process.argv[4], HOME = process.argv[5].split(',').map(Number)
const md = createRequire(W + '/package.json')('minecraft-data')('1.21.11')
const [UK, SH] = await Promise.all(['upkeep', 'shop'].map(m => import(`${W}/src/${m}.mjs`)))
const j = JSON.parse(fs.readFileSync(D, 'utf8'))
const [x0, z0, x1, z1] = j.box, [y0, y1] = j.y, nx = x1 - x0 + 1, nz = z1 - z0 + 1
const buf = Buffer.from(j.cells, 'base64')
const idx = j.bits === 16 ? i => buf.readUInt16LE(i * 2) : i => buf[i]
const pal = j.palette.map(n => { const base = n.replace(/\[.*$/, ''); if (base === '?') return undefined; const b = md.blocksByName[base]; const lm = n.match(/layers=(\d+)/); return { name: n.includes('waterlogged') ? base + '[waterlogged]' : base, boundingBox: b ? b.boundingBox : 'block', ...(lm ? { props: { layers: lm[1] } } : {}) } })
const read = (x, y, z) => (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) ? null : (pal[idx(((y - y0) * nz + (z - z0)) * nx + (x - x0))] ?? null)
const recs = {}
for (const f of fs.readdirSync(R)) { const m = f.match(/^project-[-\d_]+\.([a-z0-9]+)\.g\d+\.json$/); if (m) recs[m[1]] = JSON.parse(fs.readFileSync(`${R}/${f}`, 'utf8')) }
let ZB = []
try { ZB = JSON.parse(fs.readFileSync(`${R}/protected-zones.json`, 'utf8')).zones.map(z => z.box) } catch {}
const home = { x: HOME[0], y: HOME[1], z: HOME[2] }
const others = Object.entries(recs).filter(([k]) => !/^(tidy|land|siteprep)$/.test(k)).map(([k, r]) => ({ ...r, plot: r.plot ?? k }))
const zones = SH.recordZones(others)
const zoneCol = (x, z) => ZB.some(b => x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5])
const avoid = (x, z) => { for (const zz of zones) { const b = zz.box; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return zz.why ?? 'project' } return zoneCol(x, z) ? 'zone' : null }
const zone = (x, y, z) => ZB.some(b => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5])
const cells = new Set(Object.values(recs).flatMap(r => [...(r.cells ?? []), ...(r.cut ?? []), ...(r.clear ?? [])].map(c => c.at.join(','))))
const sv = UK.upkeepSurvey(read, { home, cells, avoid, zone, U: { ...UK.UPKEEP, jobMax: 1e9 } })
console.log(JSON.stringify({ home: HOME.join(','), records: Object.keys(recs).length, zones: ZB.length, ...sv.census }))
