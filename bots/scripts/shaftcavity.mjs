// shaftcavity.mjs <regionsDir> -- OFFLINE (stage-1 snapshot copies, read-only): simulate the shaft-01 build order top-down on
// each world's M0 site and count what the build meets (Claude shaft plan r1 P1-6, Codex P1-1): lining cells by the support
// they offer (below / side / top-only / none), step-down floors that must be filled, falling lining cells with liquid behind
// them, and the first level that would stop each rule. Placed lining becomes solid as the simulation goes.
import fs from 'node:fs'
import path from 'node:path'
import { loadRegion, reader } from './regionread.mjs'
import { SHAFT_SITES, plannedLandings, newShaftRecord, worldOf } from '../src/shaftjob.mjs'
import { shaftIndex } from '../src/shaftindex.mjs'
import { envelopeLevels } from '../src/shaftplan.mjs'
const dir = process.argv[2]
const FALL = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*concrete_powder)$/
const WET = b => !!b && (/^(water|lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(b.name) || b.props?.waterlogged === 'true' || b.props?.waterlogged === true)
const out = {}
for (const [pool, site] of Object.entries(SHAFT_SITES)) {
  const files = fs.readdirSync(dir).filter(f => f.startsWith(pool + '.'))
  const chunks = new Map(); for (const f of files) for (const [k, v] of loadRegion(path.join(dir, f))) chunks.set(k, v)
  const base = reader(chunks), over = new Map(), K = (x, y, z) => `${x},${y},${z}`
  const read = (x, y, z) => over.get(K(x, y, z)) ?? base(x, y, z)
  const solid = b => !!b && b.boundingBox === 'block' && !WET(b)
  const landings = plannedLandings(site.c)
  const rec = newShaftRecord({ site, bottom: 16, landings, home: { x: 0, y: site.c, z: 0 } })
  const idx = shaftIndex(rec)
  const env = envelopeLevels(site.c, 16, landings)
  const dig = new Set(env.dig.map(([u, y, v]) => `${u},${y},${v}`))
  const W = (u, y, v) => worldOf(site, u, y, v)
  const st = { levels: 0, lining: 0, below: 0, side: 0, topOnly: 0, none: 0, floorsToFill: 0, floorNoSupport: 0, fallingWetBehind: 0, firstNone: null, firstFloorNoSupport: null, unread: 0 }
  const AIR = { name: 'air', boundingBox: 'empty' }, COB = { name: 'cobblestone', boundingBox: 'block' }
  const lineCell = (u, y, v, from) => {
    const w = W(u, y, v), b = read(w.x, y, w.z)
    if (!b) { st.unread++; return }
    if (solid(b) && !FALL.test(b.name)) return
    if (FALL.test(b.name)) {   // a falling lining cell: anything wet among its outer neighbours?
      for (const [du, dy, dv] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const n = W(u + du, y + dy, v + dv); if (!dig.has(`${u + du},${y + dy},${v + dv}`) && WET(read(n.x, y + dy, n.z))) { st.fallingWetBehind++; break } }
    }
    st.lining++
    const nb = (du, dy, dv) => { if (dig.has(`${u + du},${y + dy},${v + dv}`)) return false; const n = W(u + du, y + dy, v + dv); return solid(read(n.x, y + dy, n.z)) }
    if (nb(0, -1, 0)) st.below++
    else if (nb(1, 0, 0) || nb(-1, 0, 0) || nb(0, 0, 1) || nb(0, 0, -1)) st.side++
    else if (nb(0, 1, 0)) st.topOnly++
    else { st.none++; st.firstNone ??= y }
    over.set(K(w.x, y, w.z), COB)
  }
  // the build order: the collar's rim, then each level's two core cells (other column first), then the landing
  for (let y = site.c - 1; y >= 16; y--) {
    st.levels++
    for (const u of [0, 1]) {
      const c = W(u, y, 0); over.set(K(c.x, y, c.z), AIR)
      for (const [a, b, v] of [[u === 0 ? -1 : 2, y, 0], [u, y, -1], [u, y, 1]]) if (!dig.has(`${a},${b},${v}`)) lineCell(a, b, v)
      // the step-down floor below this core cell
      if (y - 1 >= 16 - 1) { const f = W(u, y - 1, 0), fb = read(f.x, y - 1, f.z); if (fb && !(solid(fb) && !FALL.test(fb.name))) { st.floorsToFill++; const s2 = W(u, y - 2, 0); if (!solid(read(s2.x, y - 2, s2.z))) { st.floorNoSupport++; st.firstFloorNoSupport ??= y } } }
    }
    if (landings.includes(y)) {
      for (const [u, yy, v] of env.dig.filter(([, yy, v, role]) => (yy === y || yy === y + 1) && role !== 'core')) { const w = W(u, yy, v); over.set(K(w.x, yy, w.z), AIR) }
      for (const [u, yy, v] of env.shell.filter(([u2, yy, v]) => yy >= y - 1 && yy <= y + 2 && v >= 1)) lineCell(u, yy, v)
    }
  }
  out[pool] = st
}
console.log(JSON.stringify(out, null, 1))
