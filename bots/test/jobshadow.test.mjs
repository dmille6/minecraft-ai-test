// JOB SHADOW (jobshadow-01; docs/reports/job-assigner-2026-11-03.md stage 1). The host tool's tests run here so `npm test`
// cannot be green while they are red: scripts/host/test_jobshadow.py (the pure rules -- latches, demand, the role state machine,
// caps, fairness, starvation, the mayor's option validator -- and the shadow's helpers, every anchored mutant killed), and
// jobfacts.mjs over a fixture pool written by the bots' own buildproj.mjs: it reads the record, the active project and a live
// lease, and it WRITES NOTHING (the directory listing and every file's bytes are unchanged).
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishRecord, projKey, takeLease } from '../src/buildproj.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_jobshadow.py')], { encoding: 'utf8', timeout: 110_000 })
const out = (r.stdout || '') + (r.stderr || '')
console.log(out.split('\n').filter(l => /FAIL|SURVIVED|mutants|passed|Error/.test(l)).join('\n'))
assert.equal(r.status, 0, out.slice(-1200))
const m = /mutants killed (\d+)\/(\d+)/.exec(out)
assert.ok(m && m[1] === m[2] && Number(m[2]) >= 8, `mutant line: ${m && m[0]}`)

// jobfacts.mjs on a fixture pool
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfacts-'))
const dir = path.join(root, '_pool-fix-a')
const home = { x: 10, y: 64, z: -5 }
const now = Date.now()
assert.equal(publishRecord(dir, projKey(home, 'shop'), () => ({ v: 1, plot: 'shop', state: 'complete', structure_complete: true }), { now }).result, 'accepted')
assert.equal(publishRecord(dir, projKey(home, 'shaft'), () => ({ v: 1, plot: 'shaft', state: 'complete', structure_complete: true, landings_built: [48, 32, 16] }), { now }).result, 'accepted')
assert.equal(publishRecord(dir, projKey(home, 'house1'), () => ({ v: 1, plot: 'house1', state: 'open', structure_complete: false }), { now }).result, 'accepted')
assert.ok(takeLease(dir, projKey(home, 'house1'), 'slot1', 'fix-a-Bravo', { now }).ok)
assert.ok(takeLease(dir, projKey(home, 'deepmine'), 'slot1', 'fix-a-Echo', { now: now - 20 * 60_000 }).ok)   // expired
const snap = () => Object.fromEntries(fs.readdirSync(dir).sort().map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]))
const before = snap()
const j = spawnSync('node', [path.join(REPO, 'scripts/host/jobfacts.mjs'), path.join(REPO, 'bots/src'), String(now), dir, path.join(root, '_pool-missing')],
  { encoding: 'utf8', timeout: 60_000 })
assert.equal(j.status, 0, j.stderr)
const facts = JSON.parse(j.stdout)
const t = facts.towns['fix-a']
assert.ok(t, 'the fixture town is read')
assert.equal(t.hk, '10_64_-5')
assert.equal(t.projects.find(p => p.plot === 'shop').complete, true)
assert.equal(t.projects.find(p => p.plot === 'house1').exists, true)
assert.deepEqual(t.projects.find(p => p.plot === 'shaft').landings_built, [48, 32, 16])
assert.equal(t.active_build, 'house1', 'the workshop and the stair stand, so the house is the build (shop.mjs activeProject itself)')
assert.equal(t.leases['house1.slot1'].holder, 'fix-a-Bravo')
assert.equal(t.leases['house1.slot1'].live, true)
assert.equal(t.leases['deepmine.slot1'].live, false, 'an expired lease is not live')
assert.deepEqual(facts.unreadable.map(u => u.dir), ['missing'], 'an unreadable pool is named, never an empty town')
assert.deepEqual(snap(), before, 'jobfacts.mjs wrote nothing in the pool directory')
fs.rmSync(root, { recursive: true, force: true })
console.log('jobshadow: ok')
