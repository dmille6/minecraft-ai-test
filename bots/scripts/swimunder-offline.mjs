// swimunder-01 OFFLINE COVERAGE: the planner against READ-ONLY region copies of every wet-ceiling pin site (no bot, no
// server). Input: a JSON list of sites, each { bot, h, feet:[x,y,z], cells: {"x,y,z": "name[props]"} } dumped from the
// nightly backup's region copies by failmine's Regions reader. Output: one line per site + totals by bot-h.
//   node scripts/swimunder-offline.mjs <sites.json> [radius]
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { swimUnderPlan, SU_RADIUS } from '../src/swimunder.mjs'
const require = createRequire(import.meta.url)
const mcd = require('minecraft-data')('1.21.8')
export function blockOf (state) {
  if (state == null) return null
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(state)
  if (!m) return null
  const name = m[1], props = Object.fromEntries((m[2] ?? '').split(',').filter(Boolean).map(kv => kv.split('=')))
  const def = mcd.blocksByName[name]
  if (!def) throw new Error(`unknown block ${state}`)
  return { name, boundingBox: def.boundingBox, isWaterlogged: props.waterlogged === 'true', props }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const sites = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const radius = Number(process.argv[3] ?? SU_RADIUS)
  const tot = { n: 0, h: 0, okN: 0, okH: 0, dry: 0, open: 0 }
  const seen = new Set()
  for (const s of sites) {
    const k = `${s.world}:${s.feet.join(',')}:${s.bot}:${s.t0}`
    if (seen.has(k)) continue; seen.add(k)
    const at = (x, y, z) => blockOf(s.cells[`${x},${y},${z}`])
    const r = swimUnderPlan({ at, start: s.feet, radius })
    tot.n++; tot.h += s.h
    if (r.ok) { tot.okN++; tot.okH += s.h; tot[r.exit]++ }
    const f = s.cells[s.feet.join(',')], hd = s.cells[[s.feet[0], s.feet[1] + 1, s.feet[2]].join(',')], rf = s.cells[[s.feet[0], s.feet[1] + 2, s.feet[2]].join(',')], ab = s.cells[[s.feet[0], s.feet[1] + 3, s.feet[2]].join(',')]
    console.log(`${s.bot.padEnd(18)} ${s.h.toFixed(1).padStart(5)}h ${s.feet.join(',').padEnd(13)} feet=${(f ?? '?').split('[')[0]} head=${(hd ?? '?').split('[')[0]} roof=${(rf ?? '?').split('[')[0]} over=${(ab ?? '?').split('[')[0]} -> ` +
      (r.ok ? `OUT ${r.exit} cells=${r.route.length} wet=${r.wet} run=${r.wetRun} via ${r.route.map(c => c.join(',')).join(' ')}` : `none: ${r.reason}`))
  }
  console.log(`TOTAL sites ${tot.n} (${tot.h.toFixed(1)} bot-h): a way out in ${tot.okN} (${tot.okH.toFixed(1)} bot-h; dry ${tot.dry}, open ${tot.open}) at radius ${radius}`)
}
