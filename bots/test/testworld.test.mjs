// THE TEST WORLD (owner 11-18: one copy of the showcase town where every release soaks 3 hours before the showcase gets it).
// Its host scripts' tests run here so `npm test` cannot be green while they are red:
//   scripts/host/test_testworld.py -- the loader: it runs on block2-bots only; an env file may point only at the test server on
//     that host; logs and records stay out of /var/log/mcai and /var/lib/mcai (the log shipper and the pool cleaner take
//     those); the unit files carry the showcase's memory envelope; a pause must outlast a keepalive; the showcase guard is
//     blind, not fine, on thin data.
//   scripts/host/test_soakread.py -- the soak read: a release that keeps ~18 MB per reconnect FAILS the load step (the 11-18
//     leak), a bot near its ceiling FAILS the untouched hours (the 11-17 defect), and anything the read could not see is
//     INCONCLUSIVE, never a pass.
// Every anchored mutant must be killed.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
for (const [file, minPass, minKilled] of [['test_testworld.py', 70, 9], ['test_soakread.py', 54, 11]]) {
  const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host', file)], { encoding: 'utf8', timeout: 120_000 })
  const out = (r.stdout || '') + (r.stderr || '')
  console.log(out.split('\n').filter(l => /^ {2}FAIL|Error|Traceback/.test(l)).join('\n'))
  assert.equal(r.status, 0, out.slice(-1500))
  const pass = (out.match(/^ {2}PASS {2}/gm) ?? []).length
  const killed = (out.match(/^ {2}PASS {2}MUTANT KILLED/gm) ?? []).length
  assert.ok(pass >= minPass, `${file}: expected at least ${minPass} checks, ran ${pass}`)
  assert.ok(killed >= minKilled, `${file}: expected at least ${minKilled} mutants killed, saw ${killed}`)
  console.log(`${file}: ok (${pass} checks, ${killed} mutants killed)`)
}
