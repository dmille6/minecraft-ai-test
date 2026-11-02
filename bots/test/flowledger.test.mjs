// FLOW LEDGER (flowledger-01; resource-model-1102 s.9). The host read's tests run here so `npm test` cannot be green while
// they are red: scripts/host/test_flowledger.py -- every alarm fires on a seeded history and stays quiet on a clean one, the
// balance closes on a consistent fixture and the fleet control fails with the deltas zeroed (the null), flowstock.mjs folds
// a journal written by cobblecap.mjs itself and writes nothing, the fleetstatus-header wiring, every anchored mutant killed.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_flowledger.py')], { encoding: 'utf8', timeout: 110_000 })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split('\n').filter(l => /FAIL|SURVIVED|mutants|passed|Error/.test(l)).join('\n'))
assert.equal(r.status, 0, out.slice(-1200))
const m = /mutants killed (\d+)\/(\d+)/.exec(out)
assert.ok(m && m[1] === m[2] && Number(m[2]) >= 10, `mutant line: ${m && m[0]}`)
console.log('flowledger: ok')
