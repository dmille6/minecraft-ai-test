// ROUTEWATCH (owner 11-14: can the bots still walk to it). The host watcher's tests run here so `npm test` cannot be green while
// they are red: scripts/host/test_routewatch.py -- where the town's services are (read from what succeeded), the region
// reader over an anvil file written in the test, the REAL mineflayer-pathfinder A* (routereplay.mjs, this checkout's
// node_modules) over the showcase well's stair with its step and with the step cut, the verdicts (a walk that was there and
// is gone is named with the block that changed), the tiers in lib/alarm, and every anchored mutant killed.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_routewatch.py')],
  { encoding: 'utf8', timeout: 170_000, env: { ...process.env, ROUTE_MODULES: path.join(REPO, 'bots') } })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split('\n').filter(l => /FAIL|Error|Traceback/.test(l)).join('\n'))
assert.equal(r.status, 0, out.slice(-1500))
const pass = (out.match(/^ {2}PASS {2}/gm) ?? []).length
const killed = (out.match(/^ {2}PASS {2}MUTANT KILLED/gm) ?? []).length
assert.ok(pass >= 48, `expected at least 48 checks, ran ${pass}`)
assert.ok(killed >= 5, `expected at least 5 mutants killed, saw ${killed}`)
console.log(`routewatch: ok (${pass} checks, ${killed} mutants killed)`)
