// HIVE PROGRESS: a shared lessons store keeps milestone progress per bot. Before this, a hive bot lost its goal
// history on every restart and re-saved a stale slot after the first merge.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.BOT_NAME = 'hive-a-Alpha'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-hive'
const { Lessons, pickFields, slotOf, PROGRESS_FIELDS } = await import('../src/lessons.mjs')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

t('pickFields: a flat layout minus stray keys', () => {
  assert.deepEqual(pickFields({ attempts: { a: 1 }, skipCount: { a: 2 }, junk: 1 }), { attempts: { a: 1 }, skipCount: { a: 2 } })
})
t('slotOf: a shared layout returns ONLY this bot\'s slot', () => {
  const p = { 'hive-a-Alpha': { attempts: { a: 3 }, v: 2 }, 'hive-a-Bravo': { attempts: { b: 9 }, v: 2 } }
  assert.deepEqual(slotOf(p, 'hive-a-Alpha'), { attempts: { a: 3 } })
})
t('slotOf: the corrupted host file ({Echo: {Bravo: {}}}) yields empty, never a peer\'s data', () => {
  assert.deepEqual(slotOf({ 'hive-a-Echo': { 'hive-a-Bravo': {} } }, 'hive-a-Echo'), {})
})

t('a LEGACY slot (the old build\'s frozen first save, no version marker) loads as EMPTY, as the old build behaved', () => {
  assert.deepEqual(slotOf({ 'hive-a-Alpha': { attempts: { stale: 1 }, skipped: ['old_skip'], blocked: { k: 1 } } }, 'hive-a-Alpha'), {})
})
t('slotOf never guesses (Codex counterexamples): a bot named `attempts`, legacy flat fields, a stray top-level blocked', () => {
  const map = { attempts: { r: 1 }, blocked: { x: 1 }, 'hive-a-Alpha': { attempts: { r: 9 }, v: 2 }, 'hive-a-Bravo': { attempts: { b: 5 }, v: 2 } }
  assert.deepEqual(slotOf(map, 'hive-a-Alpha'), { attempts: { r: 9 } }, 'the slot, not the legacy flat field')
  const named = { attempts: { attempts: { mine: 1 }, v: 2 }, 'hive-a-Bravo': { attempts: { b: 5 }, v: 2 } }
  assert.deepEqual(slotOf(named, 'hive-a-Bravo'), { attempts: { b: 5 } }, 'a bot named attempts does not leak into a peer')
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
t('EVERY field setProgress and bumpBlocked write survives a shared save and reload', () => {
  const f4 = path.join(dir, 'fields.json')
  const a = new Lessons(f4, true)
  a.setProgress({ a: 1 }, ['s'], { s: 1 }, { s: 2 }, 3, { c: 4 }, { r: { t: 5, since: 5 } })
  a.bumpBlocked('k'); a.bumpBlocked('k')
  a.save()
  const p = new Lessons(f4, true).data.progress
  const want = { attempts: { a: 1 }, skipped: ['s'], skippedAt: { s: 1 }, skipCount: { s: 2 }, cycle: 3, completions: { c: 4 }, blocked: { k: 2 } }
  // idle-gap adds a 7th argument (progressAt); PROGRESS_FIELDS already carries it so the two merge without loss.
  if (a.setProgress.length >= 7) want.progressAt = { r: { t: 5, since: 5 } }
  for (const [k, v] of Object.entries(want)) assert.deepEqual(p[k], v, k)
  for (const k of Object.keys(want)) assert.ok(PROGRESS_FIELDS.includes(k), `PROGRESS_FIELDS must cover ${k}`)
})
t('MIGRATION: legacy flat fields in the shared file are removed on save and never resurrect on restart', () => {
  const f5 = path.join(dir, 'legacy.json')
  const schema = JSON.parse(fs.readFileSync(file, 'utf8')).schema
  fs.writeFileSync(f5, JSON.stringify({ schema, avoid: {}, worked: {}, sites: [], runs: 0, skillVersions: {}, progress: { attempts: { r: 1 }, 'hive-a-Bravo': { attempts: { b: 5 }, v: 2 } } }))
  const a = new Lessons(f5, true)
  a.setProgress({ r: 9 }, [], {}, {}, 0, {})
  a.save()
  const disk = JSON.parse(fs.readFileSync(f5, 'utf8')).progress
  assert.ok(!('attempts' in disk), 'legacy flat field removed')
  assert.deepEqual(disk['hive-a-Bravo'], { attempts: { b: 5 }, v: 2 })
  assert.deepEqual(new Lessons(f5, true).getProgress().attempts, { r: 9 }, 'restart returns the NEW value, not the legacy 1')
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
