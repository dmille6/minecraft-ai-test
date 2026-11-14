// REHEARSALCARD (owner 11-14: the fresh-world rehearsal). The daily card's tests run here so `npm test` cannot be green
// while they are red: scripts/host/test_rehearsalcard.py -- the nine criteria on rows shaped like the bots' own, every zero
// beside its positive control (no rows / an unread file = unread, never a pass), the file reader over lib/telemetry, and
// every anchored mutant killed.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_rehearsalcard.py')], { encoding: 'utf8', timeout: 170_000 })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split('\n').filter(l => /FAIL|Error|Traceback/.test(l)).join('\n'))
assert.equal(r.status, 0, out.slice(-1500))
const pass = (out.match(/^ {2}PASS {2}/gm) ?? []).length
const killed = (out.match(/^ {2}PASS {2}MUTANT KILLED/gm) ?? []).length
assert.ok(pass >= 28, `expected at least 28 checks, ran ${pass}`)
assert.ok(killed >= 7, `expected at least 7 mutants killed, saw ${killed}`)
console.log(`rehearsalcard: ok (${pass} checks, ${killed} mutants killed)`)
