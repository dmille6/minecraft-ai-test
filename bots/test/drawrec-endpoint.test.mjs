// drawrec.sh's endpoint lines (10-22): the per-pool endpoint is read from the bots' own env files, the covariate is
// instructed only when pools differ, and the lines the canary loop parses are unchanged. The behaviour, the loop-pipeline
// parse and the mutants live in scripts/host/test_drawrec_endpoint.py, which runs the REAL drawrec.sh Python block against
// fixtures (nothing live is read). This file puts it in `npm test`. The byte-compatibility half needs the OLD copy, so it is
// run by the installer against the live file (and was run against origin/main's copy when this was written).
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOST = path.join(here, '../../scripts/host')
const r = spawnSync('python3', [path.join(HOST, 'test_drawrec_endpoint.py'), path.join(HOST, 'drawrec.sh')], { encoding: 'utf8', timeout: 300_000 })
const out = (r.stdout || '') + (r.stderr || '')
let fail = 0
try {
  assert.equal(r.status, 0, out)
  const m = out.match(/^(\d+)\/(\d+) pass$/m)
  assert.ok(m && m[1] === m[2] && Number(m[2]) >= 17, `expected every case and mutant to pass (>= 17), got: ${m?.[0]}`)
  console.log(`  PASS  drawrec endpoint lines: ${m[0]} (test_drawrec_endpoint.py)`)
} catch (e) { fail++; console.log(`  FAIL  drawrec endpoint lines\n${out.slice(-3000)}`) }
console.log(`\n${fail ? 0 : 1} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
