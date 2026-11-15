// GROUND LEDGER (owner 11-14: the cleanup is rebuilt around knowing what the ground should be). The host tool's tests run
// here so `npm test` cannot be green while they are red: scripts/host/test_groundledger.py -- an untouched column is
// natural, ownership is never read from the material, a deck over a gap is seen though its top looks like ground, ground
// dug out under a roof is undermined, deep mining is not a hole in the lawn, a build record owns its cells, a torch is a
// thing and not ground, the ring counts, and every anchored mutant killed.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_groundledger.py')], { encoding: 'utf8', timeout: 120_000 })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split('\n').filter(l => /FAIL|Error|Traceback/.test(l)).join('\n'))
assert.equal(r.status, 0, out.slice(-1500))
const pass = (out.match(/^ {2}PASS {2}/gm) ?? []).length
assert.ok(pass >= 13, `expected at least 13 checks, ran ${pass}`)
assert.ok(/PASS {2}mutants_are_killed/.test(out), 'the mutant run did not pass')
console.log(`groundledger: ok (${pass} checks)`)
