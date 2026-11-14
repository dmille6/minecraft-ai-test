// BRAINWATCH (owner 11-14, loop item 1: the model-dark alarm). The host watcher's tests run here so `npm test` cannot be green
// while they are red: scripts/host/test_brainwatch.py -- the verdict on journal lines shaped like the showcase's 11-14 08:31Z
// break (252 endpoint failures by 14 bots, 0 model decisions), each "no alarm" beside its positive control; work orders are
// never decisions; one bot is not the town; a stopped host is not judged; a silent journal is blind, not fine; the command's
// state file / ALARMS.log / heartbeat row; the latch (dark stays dark until the model answers); a lost state file; the tiers
// in lib/alarm; and every anchored mutant killed.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_brainwatch.py')], { encoding: 'utf8', timeout: 120_000 })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split('\n').filter(l => /FAIL|Error|Traceback/.test(l)).join('\n'))
assert.equal(r.status, 0, out.slice(-1500))
const pass = (out.match(/^ {2}PASS {2}/gm) ?? []).length
const killed = (out.match(/^ {2}PASS {2}MUTANT KILLED/gm) ?? []).length
assert.ok(pass >= 67, `expected at least 67 checks, ran ${pass}`)
assert.ok(killed >= 9, `expected at least 9 mutants killed, saw ${killed}`)
console.log(`brainwatch: ok (${pass} checks, ${killed} mutants killed)`)
