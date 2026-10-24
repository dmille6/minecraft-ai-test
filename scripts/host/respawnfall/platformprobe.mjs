import fs from 'node:fs'
// respawnfall-01: every stance on isolated-a's 1,118 bot cells (flat stone below y=70) and 2,209 ground samples around it
// usage: SKY_JSON=<cf_sky_isoa.json> node platformprobe.mjs
const RF = await import('../../../bots/src/respawnfall.mjs')
const g = JSON.parse(fs.readFileSync(process.env.SKY_JSON ?? 'sky_isoa_full.json')).cells
const m = new Map(g.map(([x, y, z, b]) => [`${x},${y},${z}`, { name: b.split('[')[0], boundingBox: /leaves|log|planks|cobble|dirt|stone|tuff|andesite|deepslate|sand|crafting|dripstone/.test(b) ? 'block' : 'empty' }]))
const at = (x, y, z) => m.get(`${x},${y},${z}`) ?? (y <= 69 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
let el = 0, n = 0, done = 0, tmax = 0
const t0 = Date.now()
for (const [x, y, z] of g) {
  if (at(x, y + 1, z).boundingBox !== 'empty' || at(x, y + 2, z).boundingBox !== 'empty') continue
  n++
  const t = Date.now()
  const e = RF.elevation({ pos: { x: x + 0.5, y: y + 1, z: z + 0.5 }, at })
  tmax = Math.max(tmax, Date.now() - t)
  if (e.elevated) el++
  if (RF.descentDone(at, { x, y, z }).done) done++
}
console.log({ stances: n, elevated: el, done, ms: Date.now() - t0, maxOne: tmax })
const t1 = Date.now(); const r = RF.rankStarts({ at, support: { x: 353, y: 180, z: 147 } }); console.log('rank', Date.now() - t1, 'ms', r[0])
// ground stances near the platform: false positives?
let fp = 0, gn = 0
for (let x = 300; x <= 440; x += 3) for (let z = 80; z <= 220; z += 3) { gn++; if (RF.elevation({ pos: { x: x + 0.5, y: 70, z: z + 0.5 }, at }).elevated) fp++ }
console.log({ ground_samples: gn, ground_elevated: fp })
