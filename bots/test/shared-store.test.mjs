// THE INDEPENDENT VARIABLE HAS TO ACTUALLY VARY.
//
// For twenty days MEMORY_SCOPE=shared produced a pool-NAMED file inside a
// per-bot directory, so five hive bots held five private stores that merely
// agreed on a filename. Verified 2026-08-25: distinct inodes; sizes
// 1849/33867/36250/37808; every rule's `reporters` list containing only its own
// bot; 4-25% rule overlap between poolmates where a shared store is 100%; and
// `inherited` at 0% across 3,686 admission-gate citations in EVERY arm.
//
// The merge logic was correct the whole time. It was never given a file that
// more than one bot could see.
//
// These tests are the check that would have caught it on day one, and they are
// behavioural: two stores on one path must SEE each other, and two stores on
// different paths must not.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Lessons, sharedStorePath } from '../src/lessons.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-'))

t('THE POOL STORE IS NOT INSIDE ANY BOT DIRECTORY', () => {
  // The exact defect: /var/lib/mcai/hive-a-Alpha/lessons-hive-a.json
  const p = sharedStorePath('hive-a', '/var/lib/mcai/hive-a-Alpha')
  assert.ok(!p.includes('hive-a-Alpha'),
    `shared store lives inside a bot directory: ${p}`)
  assert.ok(p.includes('hive-a'), `store is not pool-scoped at all: ${p}`)
})

t('every bot in a pool resolves to the SAME path', () => {
  const paths = ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo']
    .map(n => sharedStorePath('hive-a', `/var/lib/mcai/hive-a-${n}`))
  assert.equal(new Set(paths).size, 1,
    `five bots resolved ${new Set(paths).size} different paths:\n    ` + paths.join('\n    '))
})

t('and different pools do NOT collide', () => {
  const a = sharedStorePath('hive-a', '/var/lib/mcai/hive-a-Alpha')
  const b = sharedStorePath('hive-b', '/var/lib/mcai/hive-b-Alpha')
  assert.notEqual(a, b, 'two pools share one store; the arm cannot be replicated')
})

t('A BELIEF WRITTEN BY ONE BOT IS VISIBLE TO ANOTHER', () => {
  // The behavioural check. Two Lessons on one file, as a pool actually is.
  const file = path.join(tmp, 'lessons-hive-x.json')
  const a = new Lessons(file, true)
  const b = new Lessons(file, true)
  a.recordFailure('gather', { block: 'oak_log' }, 'no_path')
  a.save()
  b.reload?.()
  const b2 = new Lessons(file, true)          // a fresh reader, as a restart is
  const keys = Object.keys(b2.data.avoid ?? {})
  assert.ok(keys.length > 0,
    "the second bot cannot see the first bot's failure - nothing is shared")
})

t('TWO PRIVATE STORES DO NOT SEE EACH OTHER (the negative control)', () => {
  // Without this, a test that passes proves only that files exist.
  const a = new Lessons(path.join(tmp, 'lessons-bot-A.json'), false)
  const b = new Lessons(path.join(tmp, 'lessons-bot-B.json'), false)
  a.recordFailure('gather', { block: 'dirt' }, 'no_path')
  a.save()
  const b2 = new Lessons(path.join(tmp, 'lessons-bot-B.json'), false)
  assert.equal(Object.keys(b2.data.avoid ?? {}).length, 0,
    'an isolated bot inherited a belief it never observed')
})

t('CONCURRENT WRITERS DO NOT LOSE BELIEFS', () => {
  // Read-merge-write without a lock loses updates: A reads, B reads, A writes,
  // B writes, A's increment is gone. The loss is not symmetric -- it
  // undercounts how fast a shared belief accumulates, which is the quantity the
  // hive arm exists to measure.
  const file = path.join(tmp, 'lessons-hive-c.json')
  const bots = Array.from({ length: 5 }, () => new Lessons(file, true))
  bots.forEach((L, i) => {
    L.recordFailure('gather', { block: `ore_${i}` }, 'no_path')
    L.save()
  })
  const reader = new Lessons(file, true)
  const got = Object.keys(reader.data.avoid ?? {}).length
  assert.equal(got, 5, `${got} of 5 beliefs survived concurrent writes`)
})

console.log(`  ${pass} passed, ${fail} failed`)
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
