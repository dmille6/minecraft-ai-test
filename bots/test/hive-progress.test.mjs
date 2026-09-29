// HIVE PROGRESS: a shared lessons store keeps milestone progress per bot. Before this, a hive bot lost its goal
// history on every restart and re-saved a stale slot after the first merge.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.BOT_NAME = 'hive-a-Alpha'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-hive'
const { Lessons, ownProgress } = await import('../src/lessons.mjs')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

t('ownProgress: a private (flat) layout is returned as is, minus stray keys', () => {
  assert.deepEqual(ownProgress({ attempts: { a: 1 }, skipCount: { a: 2 }, junk: 1 }, 'x'), { attempts: { a: 1 }, skipCount: { a: 2 } })
})
t('ownProgress: a shared layout returns ONLY this bot\'s slot', () => {
  const p = { 'hive-a-Alpha': { attempts: { a: 3 } }, 'hive-a-Bravo': { attempts: { b: 9 } } }
  assert.deepEqual(ownProgress(p, 'hive-a-Alpha'), { attempts: { a: 3 } })
})
t('ownProgress: the mixed in-memory state prefers the fresh top-level writes over the stale slot', () => {
  const p = { 'hive-a-Alpha': { attempts: { a: 1 } }, 'hive-a-Bravo': { attempts: { b: 9 } }, attempts: { a: 7 } }
  assert.deepEqual(ownProgress(p, 'hive-a-Alpha'), { attempts: { a: 7 } })
})
t('ownProgress: the corrupted host file ({Echo: {Bravo: {}}}) yields empty, never a peer\'s data', () => {
  assert.deepEqual(ownProgress({ 'hive-a-Echo': { 'hive-a-Bravo': {} } }, 'hive-a-Echo'), {})
})

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-progress-'))
const file = path.join(dir, 'shared.json')
t('A SHARED STORE across a restart: the latest progress comes back, and a peer\'s slot is untouched', () => {
  const a = new Lessons(file, true)
  a.setProgress({ craft_x: 3 }, ['r1'], { r1: 111 }, { r1: 2 }, 1, { c: 1 })
  a.save()
  // a peer writes its own slot in between
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  raw.progress['hive-a-Bravo'] = { attempts: { peer: 5 } }
  fs.writeFileSync(file, JSON.stringify(raw))
  // later writes by the same bot must not be lost to the stale slot
  a.setProgress({ craft_x: 9 }, ['r1', 'r2'], { r1: 111, r2: 222 }, { r1: 2, r2: 1 }, 2, { c: 2 })
  a.save()
  const again = new Lessons(file, true)                                    // the restart
  const p = again.getProgress()
  assert.deepEqual(p.attempts, { craft_x: 9 }, 'the NEWER attempts')
  assert.deepEqual(p.skipped, ['r1', 'r2'])
  assert.deepEqual(p.skipCount, { r1: 2, r2: 1 })
  const disk = JSON.parse(fs.readFileSync(file, 'utf8')).progress
  assert.deepEqual(disk['hive-a-Bravo'], { attempts: { peer: 5 } }, 'the peer slot survived')
  assert.ok(!('attempts' in disk), 'no flat fields leaked into the shared map')
})
t('BETWEEN saves (no restart) the store still reads this bot\'s progress, not the peers\' map', () => {
  const f3 = path.join(dir, 'between.json')
  fs.writeFileSync(f3, JSON.stringify({ schema: JSON.parse(fs.readFileSync(file, 'utf8')).schema, avoid: {}, worked: {}, sites: [], runs: 0, skillVersions: {},
                                        progress: { 'hive-a-Bravo': { skipCount: { b: 7 } } } }))
  const a = new Lessons(f3, true)
  a.setProgress({ z: 1 }, [], {}, { z: 3 }, 0, {})
  a.save()
  assert.deepEqual(a.getProgress().skipCount, { z: 3 }, 'right after the merge, before any new write')
})
t('a PRIVATE store is unchanged', () => {
  const f2 = path.join(dir, 'private.json')
  const a = new Lessons(f2, false)
  a.setProgress({ y: 1 }, [], {}, { y: 4 }, 0, {})
  a.save()
  assert.deepEqual(new Lessons(f2, false).getProgress().skipCount, { y: 4 })
})
fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
