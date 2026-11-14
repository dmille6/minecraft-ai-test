// STOPWATCH (owner 11-14: the stopped-working alarm). The host watcher's tests run here so `npm test` cannot be green while
// they are red: scripts/host/test_stopwatch.py -- the three verdicts on rows shaped like the showcase's 11-13 junk well
// (0 of 36, the 17-failure streak), each beside its positive control; the latch (a page stays up until the thing works again);
// neutral statuses; the chance guard; the blind host; the reader over log files; the state file / ALARMS.log / heartbeat row;
// the tiers in lib/alarm; and every anchored mutant killed.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_stopwatch.py')], { encoding: 'utf8', timeout: 170_000 })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split('\n').filter(l => /FAIL|Error|Traceback/.test(l)).join('\n'))
assert.equal(r.status, 0, out.slice(-1500))
const pass = (out.match(/^ {2}PASS {2}/gm) ?? []).length
const killed = (out.match(/^ {2}PASS {2}MUTANT KILLED/gm) ?? []).length
assert.ok(pass >= 95, `expected at least 95 checks, ran ${pass}`)
assert.ok(killed >= 15, `expected at least 15 mutants killed, saw ${killed}`)
console.log(`stopwatch: ok (${pass} checks, ${killed} mutants killed)`)
