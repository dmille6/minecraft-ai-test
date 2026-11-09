import fs from 'node:fs'
import { createRequire } from 'node:module'
const W = process.argv[2], D = process.argv[3], HOME = process.argv[4].split(',').map(Number)
const md = createRequire(W + '/package.json')('minecraft-data')('1.21.11')
const UK = await import(`${W}/src/upkeep.mjs`)
const j = JSON.parse(fs.readFileSync(D, 'utf8'))
const [x0, z0, x1, z1] = j.box, [y0, y1] = j.y, nx = x1 - x0 + 1, nz = z1 - z0 + 1
const buf = Buffer.from(j.cells, 'base64'); const idx = j.bits === 16 ? i => buf.readUInt16LE(i * 2) : i => buf[i]
const pal = j.palette.map(n => { const base = n.replace(/\[.*$/, ''); if (base === '?') return undefined; const b = md.blocksByName[base]; return { name: base, boundingBox: b ? b.boundingBox : 'block' } })
const read = (x, y, z) => (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) ? null : (pal[idx(((y - y0) * nz + (z - z0)) * nx + (x - x0))] ?? null)
const home = { x: HOME[0], y: HOME[1], z: HOME[2] }
const g = UK.remainsIn(read, [home.x - 128, home.z - 128, home.x + 128, home.z + 128], { yHi: home.y + 14, yLo: home.y - 14 })
const shape = {}, sp = {}, gap = {}, below = {}
for (const q of g) {
  const xs = q.logs.map(p => p[0]), ys = q.logs.map(p => p[1]), zs = q.logs.map(p => p[2])
  const h = Math.max(...ys) - Math.min(...ys) + 1, w = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 1
  const k = `${q.logs.length}L h${h} w${w}`; shape[k] = (shape[k] ?? 0) + 1
  sp[q.name] = (sp[q.name] ?? 0) + 1
  const low = q.logs.reduce((m, p) => (p[1] < m[1] ? p : m))
  const gp = q.base ? low[1] - q.base[1] - 1 : -1; gap[gp] = (gap[gp] ?? 0) + 1
  const b = read(low[0], low[1] - 1, low[2]); below[b?.name] = (below[b?.name] ?? 0) + 1
}
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10)
console.log('groups', g.length, '\n shapes', JSON.stringify(top(shape)), '\n species', JSON.stringify(top(sp)), '\n air gap under', JSON.stringify(top(gap)), '\n block under lowest', JSON.stringify(top(below)))
console.log(' sample', g.slice(0, 6).map(q => `${q.name}:${q.logs.map(p => p.join(',')).join(' ')}`).join(' | '))
