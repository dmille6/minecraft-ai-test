// EFFECTWATCH (effectwatch-01; OWNER 11-03 items 1 + 6). The host read's tests run here so `npm test` cannot be green while
// they are red: scripts/host/test_effectwatch.py -- busy-time classes sum to the window (END-stamped sub-steps, holes
// unobserved), ratios of sums, the rotated generation is read, a canary build is never fleet, a synthetic fleet reads
// EFFECT / NO-EFFECT / WORSE / UNREADABLE as built, a model A/B is excluded, the header wiring, every anchored mutant killed.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_effectwatch.py')], { encoding: 'utf8', timeout: 170_000 })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split('\n').filter(l => /FAIL|SURVIVED|mutants|passed|Error/.test(l)).join('\n'))
assert.equal(r.status, 0, out.slice(-1500))
const m = /mutants killed (\d+)\/(\d+)/.exec(out)
assert.ok(m && m[1] === m[2] && Number(m[2]) >= 12, `mutant line: ${m && m[0]}`)
console.log('effectwatch: ok')
