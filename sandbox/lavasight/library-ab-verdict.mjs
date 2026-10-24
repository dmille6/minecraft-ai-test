#!/usr/bin/env node
// lavasight-01's LIBRARY NON-REGRESSION, judged by failmine's own oracle (sandbox/failmine/oracle.mjs abVerdict/abLine) over the
// result rows lavasight-paper.sh wrote (base then candidate per repeat, each scene with ITS world's real lava map). The
// library-ab.mjs driver runs one family on one server with one env; this reads rows that were run per scene (a per-world
// map per scene) and applies the same verdict.
//   node sandbox/lavasight/library-ab-verdict.mjs <outDir> [<outDir> ...]
import fs from 'node:fs'
import path from 'node:path'
import { abVerdict, abLine } from '../failmine/oracle.mjs'

const by = new Map()
for (const d of process.argv.slice(2)) {
  const f = path.join(d, 'results.jsonl')
  if (!fs.existsSync(f)) continue
  for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l)
    const k = `${r.scene}\t${r.start_index ?? 0}`
    if (!by.has(k)) by.set(k, { base: [], cand: [] })
    ;(by.get(k)[r.label] ?? []).push(r)
  }
}
// NON-REGRESSION (not the fix gate): lavasight is not a stuck or a fall fix, so the library's PASS (the candidate escapes where
// the base stays) is not expected. What must hold is that the candidate is NEVER WORSE: no more deaths, no fewer passes, and
// the base still reproducing the fleet's failure in the same session (the scene's positive control).
let regressed = 0
for (const [k, { base, cand }] of [...by].sort()) {
  const [scene, start] = k.split('\t')
  const { verdict } = abVerdict(base, cand)
  const deaths = rs => rs.filter(r => r.observation && (r.observation.deathsLog > 0 || r.observation.deathsScore > 0)).length
  const passes = rs => rs.filter(r => r.pass === true).length
  const worse = deaths(cand) > deaths(base) || passes(cand) < passes(base)
  if (worse) regressed++
  console.log(abLine(scene, Number(start), base, cand) + ` | fix-gate ${verdict} | non-regression ${worse ? 'REGRESSED' : 'ok'} ` +
    `(deaths base ${deaths(base)} cand ${deaths(cand)}; passes base ${passes(base)} cand ${passes(cand)}; base matched the fleet ${base.filter(r => r.matched_fleet).length}/${base.length})`)
}
process.exit(regressed ? 1 : 0)
