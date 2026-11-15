// GROUND PLAN (owner 11-15: the dirt cap; step N3's offline half). The host tool's tests run here so `npm test` cannot
// be green while they are red: scripts/host/test_groundplan.py -- an undermined column gets cobblestone and one dirt
// layer under the surviving surface, an open pit gets dirt at the frame-zero surface, wet cells are left out, pillars are
// cut top-down, owned cells and build columns are never planned, a filled column is left alone, a chest is flagged to
// be emptied, deep mining is not repaired, jobs hold at most 24 cells bottom-up, jobs are ordered, an untouched world
// gives an empty plan, and every anchored mutant killed.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_groundplan.py')], { encoding: 'utf8', timeout: 120_000 })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split('\n').filter(l => /FAIL|Error|Traceback/.test(l)).join('\n'))
assert.equal(r.status, 0, out.slice(-1500))
const pass = (out.match(/^ {2}PASS {2}/gm) ?? []).length
assert.ok(pass >= 13, `expected at least 13 checks, ran ${pass}`)
assert.ok(/PASS {2}mutants_are_killed/.test(out), 'the mutant run did not pass')
console.log(`groundplan: ok (${pass} checks)`)
