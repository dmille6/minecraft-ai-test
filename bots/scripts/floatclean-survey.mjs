#!/usr/bin/env node
// floatclean-survey.mjs -- floatclean-01show, survey step 2 (HOST SIDE, never on the showcase VM): the job list of floating blocks
// the bots left, from READ-ONLY copies of the world's region files, the pool and CoreProtect (floatclean_cp.py's cp.json).
//
//   node scripts/floatclean-survey.mjs --region <dir with r.*.mca> --pool <pool dir> --cp <cp.json> --out <floatclean.json>
//        [--pool-name showcase] [--areas name:x0,z0,x1,z1;...] [--reach 128]
//
// Areas, in order (the list's order): `stepwell` = the step well record's box widened by 8 (when the pool holds one), then any
// --areas given (the bridge beams west of the step well), then `town` (everything else within --reach of home). Writes the list
// (floatclean.mjs floatListOk shape) and prints `_floatclean op=survey` with the census.
import fs from 'node:fs'
import path from 'node:path'
import { loadRegion, reader } from './wellsite-replay.mjs'
import { recordHead } from '../src/buildproj.mjs'
import { floatSurvey, FC } from '../src/floatclean.mjs'

const args = process.argv.slice(2)
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const regionDir = opt('--region'), poolDir = opt('--pool'), cpPath = opt('--cp'), outPath = opt('--out')
if (!regionDir || !poolDir || !cpPath || !outPath) { console.error('usage: floatclean-survey.mjs --region DIR --pool DIR --cp cp.json --out out.json'); process.exit(2) }
const poolName = opt('--pool-name', 'showcase')
const reach = Number(opt('--reach', FC.reach))

// the world: every region file, chunks merged
const chunks = new Map()
for (const f of fs.readdirSync(regionDir).filter(n => /^r\.-?\d+\.-?\d+\.mca$/.test(n))) for (const [k, v] of loadRegion(path.join(regionDir, f))) chunks.set(k, v)
const read = reader(chunks)

// the plan and its home
const planGens = fs.readdirSync(poolDir).map(n => /^townplan-(-?\d+_-?\d+_-?\d+)\.g(\d+)\.json$/.exec(n)).filter(Boolean)
if (!planGens.length) { console.error('no town plan in the pool copy'); process.exit(2) }
const hk = planGens[0][1]
const plan = recordHead(poolDir, `townplan-${hk}`)
const planRec = plan.head?.rec ?? JSON.parse(fs.readFileSync(path.join(poolDir, `townplan-${hk}.g${Math.max(...planGens.map(m => Number(m[2])))}.json`), 'utf8'))
const home = planRec.home

// every record's cells and clears (any [x,y,z] under `at` or `cell` in a top-level array): never listed
const keys = new Set()
for (const n of fs.readdirSync(poolDir)) { const m = new RegExp(`^(project-${hk}\\.[A-Za-z0-9]+)\\.g\\d+\\.json$`).exec(n); if (m) keys.add(m[1]) }
const cellSet = new Set(), recs = {}
const tri = a => Array.isArray(a) && a.length === 3 && a.every(Number.isInteger)
let unread = 0
for (const key of keys) {
  const h = recordHead(poolDir, key)
  if (!h.ok || !h.head) { unread++; continue }
  recs[key] = h.head.rec
  for (const v of Object.values(h.head.rec)) if (Array.isArray(v)) for (const e of v) { const at = e?.at ?? e?.cell; if (tri(at)) cellSet.add(at.join(',')) }
}
if (unread) { console.error(`${unread} record(s) unreadable: refusing to list anything (a record's cells could be missed)`); process.exit(3) }
// the plan's plots (columns): never listed
const plots = (planRec.plots ?? []).map(p => p.box).filter(b => Array.isArray(b) && b.length === 4)
const inPlot = (x, z) => plots.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])
const cells = k => { if (cellSet.has(k)) return true; const [x, , z] = k.split(',').map(Number); return inPlot(x, z) }
// protected zones
const zdoc = JSON.parse(fs.readFileSync(path.join(poolDir, 'protected-zones.json'), 'utf8'))
const zb = (zdoc.zones ?? []).map(z => z.box).filter(b => Array.isArray(b) && b.length === 6)
const zone = (x, y, z) => zb.some(b => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5])

// the areas
const areas = []
const sw = recs[`project-${hk}.stepwell`]
if (sw?.box?.length === 4) { const [x0, z0, x1, z1] = sw.box; areas.push({ name: 'stepwell', box: [x0 - 8, z0 - 8, x1 + 8, z1 + 8] }) }
for (const s of String(opt('--areas', '')).split(';').filter(Boolean)) { const [name, b] = s.split(':'); areas.push({ name, box: b.split(',').map(Number) }) }

const cpDoc = JSON.parse(fs.readFileSync(cpPath, 'utf8'))
if (!cpDoc.controls?.length || !cpDoc.controls.every(c => c.found)) { console.error('the CoreProtect read carries no passing positive control: refusing'); process.exit(3) }
const cp = new Map(Object.entries(cpDoc.cells))
const t0 = Date.now()
const sv = floatSurvey(read, { cp, cells, zone, home, reach, areas })
const doc = { v: 1, pool: poolName, surveyedAt: Date.now(), home, areas: [...areas, { name: 'town', reach }], source: { region: path.resolve(regionDir), pool: path.resolve(poolDir), cp: path.resolve(cpPath), cpWindow: cpDoc.window, controls: cpDoc.controls }, census: sv.census, beams: sv.beams, jobs: sv.jobs }
fs.writeFileSync(outPath, JSON.stringify(doc))
const c = sv.census
console.log(`_floatclean op=survey bot_placed=${c.bot_placed} standing=${c.standing} perched=${c.perched} listed=${c.listed} beams=${c.beams} far=${c.far} not_float_block=${c.not_float_block} ${Object.entries(c.by_area).map(([k, v]) => `${k}=${v}`).join(' ')} held=${Object.entries(c.why).map(([k, v]) => `${k}:${v}`).join(',') || '-'} records=${keys.size} record_cells=${cellSet.size} zones=${zb.length} ms=${Date.now() - t0}`)
for (const e of String(opt('--explain', '')).split(';').filter(Boolean)) { const at = e.split(',').map(Number); console.log(`  explain ${e}: now=${read(...at)?.name ?? '?'} under=${read(at[0], at[1] - 1, at[2])?.name ?? '?'} over=${read(at[0], at[1] + 1, at[2])?.name ?? '?'} cp=${JSON.stringify(cp.get(e) ?? null)} record=${cells(e)} verdict=${sv.verdict.get(e) ?? (cp.has(e) ? '?' : 'not_bot_last_placed')}`) }
for (const b of sv.beams.slice(0, 25)) console.log(`  beam ${b.beam} ${b.area} n=${b.n} top=${b.top.join(',')}`)
