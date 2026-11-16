// cropfarm-02fix: the crop farm's siting OFFLINE over a block dump (townplan_blockdump.py) and a copy of the town's record files, with
// the bot's own composition (treefarm.mjs farmBlocked over the plan, the protected zones, the well, the composter and every guarded
// record + the land plan's reservation, the park + 2). LIVE showcase 11-04: the release sited nothing (30/30 no_site); this fix: a
// 2 x 5 bed at [11,-11,17,-7]. Usage: node cropsite-offline.mjs <repo> <dump.json> <pooldir>
import fs from 'node:fs'
import path from 'node:path'
const [repo, dumpP, pool] = process.argv.slice(2)
const { dumpReader } = await import(path.join(repo, 'bots/scripts/buildsite-offline.mjs'))
const C = await import(path.join(repo, 'bots/src/cropfarm.mjs'))
const S = await import(path.join(repo, 'bots/src/shop.mjs'))
const LP = await import(path.join(repo, 'bots/src/landplan.mjs'))
const TF = await import(path.join(repo, 'bots/src/treefarm.mjs'))
const TP = await import(path.join(repo, 'bots/src/townplan.mjs'))
const read = dumpReader(JSON.parse(fs.readFileSync(dumpP, 'utf8')))
const latest = {}
for (const f of fs.readdirSync(pool)) { const m = /^project-0_70_0\.([a-z0-9]+)\.g(\d+)\.json$/.exec(f); if (!m) continue; if (!latest[m[1]] || +m[2] > latest[m[1]].g) latest[m[1]] = { g: +m[2], f } }
const recs = {}; for (const [k, v] of Object.entries(latest)) recs[k] = JSON.parse(fs.readFileSync(path.join(pool, v.f), 'utf8'))
const tpg = fs.readdirSync(pool).map(f => /^townplan-0_70_0\.g(\d+)\.json$/.exec(f)).filter(Boolean).map(m => +m[1]).sort((a, b) => b - a)[0]
const tp = JSON.parse(fs.readFileSync(path.join(pool, `townplan-0_70_0.g${tpg}.json`), 'utf8'))
const plan = tp.plan ?? tp
const pz = TP.parseZones(JSON.parse(fs.readFileSync(path.join(pool, 'protected-zones.json'), 'utf8')), null)
const land = recs.land
const records = [...Object.entries(recs).filter(([k]) => k !== 'land' && k !== 'cropfarm' && k !== 'tidy' && !/\./.test(k)).map(([, r]) => r), LP.landReservation(land)]
const base = TF.farmBlocked({ plan: { ...plan, home: { x: 0, y: 70, z: 0 } }, zones: pz.zones, caps: [[5, 71, 14]], plinth: [[5, 71, 14]], composter: [-1, 71, 9], farm: [], records, pzones: S.recordZones(records) })
const park = land?.park?.box
const blocked = (x, z) => base(x, z) ?? (park && x >= park[0] - 2 && x <= park[2] + 2 && z >= park[1] - 2 && z <= park[3] + 2 ? 'park' : null)
const s = C.siteCropFarm(read, { home: { x: 0, y: 70, z: 0 }, blocked, zone: (x, z) => LP.zoneAt(land, x, z), water: (x, y, z) => read(x, y, z)?.name === 'water' })
console.log('plan gen', tpg, 'zones', pz.zones.length, 'site', s.ok, s.why, s.zone, JSON.stringify({ box: s.record?.box, grid: s.record?.grid, counts: s.record?.counts }))
const cnt = {}
for (let x = -48; x <= 48; x++) for (let z = -48; z <= 48; z++) { const zz = LP.zoneAt(land, x, z); if (!['town', 'farms'].includes(zz)) continue; const r = blocked(x, z) ?? 'free'; cnt[zz + ':' + r] = (cnt[zz + ':' + r] ?? 0) + 1 }
console.log(JSON.stringify(Object.entries(cnt).sort((a, b) => b[1] - a[1])))
// what box reasons for the offline-found site [11,-11,17,-7]
const bb = {}; for (let x = 11; x <= 17; x++) for (let z = -11; z <= -7; z++) { const r = blocked(x, z) ?? 'free'; bb[r] = (bb[r] ?? 0) + 1 } ; console.log('site cols', JSON.stringify(bb))
