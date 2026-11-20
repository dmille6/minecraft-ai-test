#!/usr/bin/env node
// stepwell-trace.mjs -- the stepwell's next unit traced OFFLINE (stepwell-03show): the record + a READ-ONLY region copy -> the first undone
// unit, every cell it still needs, and for each cell the stands standsFor offers.
//   node scripts/stepwell-trace.mjs <record.json> <region.mca> [--lights]
import fs from 'node:fs'
import { loadRegion, reader } from './wellsite-replay.mjs'
import * as S from '../src/stepwell.mjs'

const [recPath, regionPath] = process.argv.slice(2)
const lights = process.argv.includes('--lights')
const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'))
const read = reader(loadRegion(regionPath))
const plan = S.planOfRecord(rec)
const k = a => a.join(',')
console.log(`site g=${plan.g} T=${plan.T} W=${plan.W} box=${plan.box} minY=${plan.minY} top=${plan.top} units=${plan.units.length} cells=${plan.cells.length} cuts=${plan.cut.length} exit=${plan.exit} descent=${!!plan.descent}`)
console.log(`fellPending=${S.fellPending(read, rec)} tiersDone=${S.tiersDone(read, plan)} tiers_built=${rec.tiers_built}`)
let done = 0, undone = 0, unk = 0
plan.units.forEach((u, i) => { const d = S.unitDone(read, plan, u, { lights }); if (d === true) done++; else if (d === false) undone++; else unk++ })
console.log(`units done=${done} undone=${undone} unknown=${unk}`)
const w = S.firstUndoneUnit(read, plan, { lights })
if (!w) { console.log('tank stands'); process.exit(0) }
const u = w.unit
console.log(`first undone unit i=${w.i} y=${u.y} unknown=${!!w.unknown} station=${!!u.station} cut=${u.cut.length} faces=${u.faces.length} under=${u.under.length} tops=${u.tops.length} posts=${u.posts.length} lights=${u.lights.length}`)
const skip = new Set()
for (let n = 0; n < 400; n++) {
  const op = S.stepwellNext(read, plan, u, { feet: null, skip, lights })
  if (op.op === 'done' || op.op === 'wait' || op.op === 'stop') { console.log('END', JSON.stringify(op)); break }
  const b = read(...op.at), below = read(op.at[0], op.at[1] - 1, op.at[2])
  const st = S.standsFor(read, plan, op.at, { max: 50 })
  console.log(`${op.op} ${op.why} ${op.role ?? op.kind ?? ''} at ${k(op.at)} now=${b?.name} below=${below?.name} stands=${st.length} ${st.slice(0, 6).map(k).join(' ')}`)
  skip.add(k(op.at))
}
