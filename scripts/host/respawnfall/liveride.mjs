// Live ride: mutate the world as rideFloorDown would (place under the floor when open, break the floor, drop one),
// asking descentDone on the LIVE world at each step, from rankStarts' best start for every spawn-square top and every deck stance.
import fs from 'node:fs'
const W = process.env.WT ?? new URL('../../..', import.meta.url).pathname  // the repo root (respawnfall-01 Claude r6's probe)
const RF = await import(W + '/bots/src/respawnfall.mjs')
const g = JSON.parse(fs.readFileSync(process.env.SKY_JSON ?? 'sky_isoa_full.json')).cells
const GT = Number(process.env.GT ?? 69)
const base = new Map(g.map(([x, y, z, b]) => [`${x},${y},${z}`, { name: b.split('[')[0], boundingBox: /leaves|log|planks|cobble|dirt|stone|tuff|andesite|deepslate|sand|crafting|dripstone/.test(b) ? 'block' : 'empty' }]))
const AIR = { name: 'air', boundingBox: 'empty' }, COB = { name: 'cobblestone', boundingBox: 'block' }
function world () {
  const ov = new Map()
  const at = (x, y, z) => { const k = `${x},${y},${z}`; if (ov.has(k)) return ov.get(k); return base.get(k) ?? (y <= GT ? { name: 'stone', boundingBox: 'block' } : AIR) }
  return { at, set: (x, y, z, b) => ov.set(`${x},${y},${z}`, b) }
}
const isBlock = b => b.boundingBox === 'block'
function ride (start) {
  const w = world(); let y = start.y
  for (let i = 0; i < 300; i++) {
    const d = RF.descentDone(w.at, { x: start.x, y, z: start.z })
    if (d.done) return { endY: y, why: d.why }
    if (d.unknown) return { endY: y, why: 'unknown ' + d.why }
    if (!isBlock(w.at(start.x, y - 1, start.z))) w.set(start.x, y - 1, start.z, COB)
    w.set(start.x, y, start.z, AIR); y--
  }
  return { endY: y, why: 'ran out' }
}
const tops = []
for (let x = 345; x <= 365; x++) for (let z = 137; z <= 157; z++) {
  const w = world()
  let top = null
  for (let y = 190; y > GT; y--) if (isBlock(w.at(x, y, z))) { top = y; break }
  if (top != null && top >= GT + 8) tops.push({ x, y: top, z })
}
let high = [], n = 0
for (const t of tops) {
  const r = RF.rankStarts({ at: world().at, support: t })
  if (!r.length) continue
  n++
  const e = ride(r[0].cell)
  if (e.endY > GT + 3) high.push([`${t.x},${t.y},${t.z}`, `${r[0].cell.x},${r[0].cell.y},${r[0].cell.z}`, r[0].cost, e.endY, e.why])
}
console.log({ spawnTops: tops.length, ranked: n, liveEndsHigh: high.length })
for (const h of high.slice(0, 40)) console.log(h.join('  '))
// every deck stance, own column
let hs = 0, ns = 0, samples = []
for (const [x, y, z] of g) {
  const w = world()
  if (isBlock(w.at(x, y + 1, z)) || isBlock(w.at(x, y + 2, z)) || y < GT + 8) continue
  ns++
  const e = ride({ x, y, z })
  if (e.endY > GT + 3) { hs++; if (samples.length < 15) samples.push([`${x},${y},${z}`, e.endY, e.why]) }
}
console.log({ ownStances: ns, ownLiveEndsHigh: hs }, samples)
if (process.env.ALL) {
  let rh = 0, rn = 0, rsm = []
  for (const [x, y, z] of g) {
    const w = world()
    if (isBlock(w.at(x, y + 1, z)) || isBlock(w.at(x, y + 2, z)) || y < GT + 8) continue
    const r = RF.rankStarts({ at: w.at, support: { x, y, z } })
    if (!r.length) continue
    rn++
    const e = ride(r[0].cell)
    if (e.endY > GT + 3) { rh++; if (rsm.length < 12) rsm.push([`${x},${y},${z}`, `${r[0].cell.x},${r[0].cell.y},${r[0].cell.z}`, e.endY, e.why]) }
  }
  console.log({ rankedFromStances: rn, bestLiveEndsHigh: rh }, rsm)
}
