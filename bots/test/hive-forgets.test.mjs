// CAN A HIVE FORGET?
//
// The hive arm exists to test the claim "a hive learns faster and is wrong
// faster". Being wrong faster requires being able to STOP being wrong, and the
// shared store could not. Three independent defects, all in the same direction:
//
//   1. save() returned into #saveMerged() BEFORE the prune counter, so a shared
//      store never pruned at all -- no wall-clock decay, no MAX_AVOID cap, no
//      site trimming, for the life of the run.
//   2. the merge took Math.max(theirs.fails, mine.fails), so any count lowered
//      by decay, by a moved gap, or by a success was restored by the next bot
//      to merge.
//   3. the merge loop only visited keys the bot STILL HELD, so a rule cleared
//      outright never propagated -- it simply survived in the shared file.
//
// Net effect: a hive's avoid map was monotonically non-decreasing and unbounded.
// Every one of these is invisible in a single-bot run and invisible in the file
// unless you diff it across two bots, which is why it survived a night of
// measurement. Each case below is one process per bot, as in memoryscope.test.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const t = (n, got, want) => { const ok = got === want; ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`) }

const here = path.dirname(fileURLToPath(import.meta.url))
const LESSONS = path.join(here, '../src/lessons.mjs')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-hive-'))

// A driver that performs ONE scripted action as one bot, then saves.
const DRIVER = path.join(dir, 'driver.mjs')
fs.writeFileSync(DRIVER, `
import { openLessons } from '${LESSONS}'
const l = openLessons()
const act = process.env.ACT
const skill = process.env.SKILL || 'craft'
const args = JSON.parse(process.env.ARGS || '{}')
if (act === 'fail') {
  const n = Number(process.env.N || 1)
  for (let i = 0; i < n; i++) l.recordFailure(skill, args, 'missing_ingredients', null, process.env.GAP || null)
} else if (act === 'success') {
  l.recordSuccess(skill, args)
} else if (act === 'gapmove') {
  l.recordFailure(skill, args, 'missing_ingredients', null, process.env.GAP)
}
l.save()
`)

const run = (bot, env) => execFileSync(process.execPath, [DRIVER], {
  env: { ...process.env, MEMORY_SCOPE: 'shared', BOT_NAME: bot, STATE_DIR: dir,
         LOG_LEVEL: 'error', ...env },
  stdio: ['ignore', 'ignore', 'pipe'],
})

const store = () => {
  const f = fs.readdirSync(dir).find(f => f.includes('lesson'))
  if (!f) return { avoid: {} }
  try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return { avoid: {} } }
}
const failsFor = (k) => {
  const a = store().avoid ?? {}
  const hit = Object.entries(a).find(([kk]) => kk.includes(k))
  return hit ? hit[1].fails : null
}
const keyCount = () => Object.keys(store().avoid ?? {}).length

console.log('  -- a success by one bot must lower the count for the whole hive --')
run('Alpha', { ACT: 'fail', N: 4, ARGS: '{"item":"wooden_pickaxe"}' })
const afterFails = failsFor('wooden_pickaxe')
t('four failures accrue in the shared file', afterFails, 4)

// Bravo has never touched this key, so its in-memory copy is whatever it loaded.
// Under the old max() merge, Bravo saving anything at all restored Alpha's 4.
run('Bravo', { ACT: 'success', ARGS: '{"item":"wooden_pickaxe"}' })
const afterSuccess = failsFor('wooden_pickaxe')
t('a peer success lowers it rather than being overwritten', afterSuccess, 3)

console.log('  -- and a peer merging afterwards must not resurrect it --')
run('Charlie', { ACT: 'fail', N: 1, ARGS: '{"item":"stick"}' })
t('an unrelated write does not restore the old count', failsFor('wooden_pickaxe'), 3)

console.log('  -- repeated successes must clear the rule entirely --')
run('Bravo', { ACT: 'success', ARGS: '{"item":"wooden_pickaxe"}' })
run('Bravo', { ACT: 'success', ARGS: '{"item":"wooden_pickaxe"}' })
run('Bravo', { ACT: 'success', ARGS: '{"item":"wooden_pickaxe"}' })
t('the rule is gone from the shared file', failsFor('wooden_pickaxe'), null)

console.log('  -- a deletion must not be resurrected by the next peer to merge --')
run('Charlie', { ACT: 'fail', N: 1, ARGS: '{"item":"torch"}' })
t('deletion survives a subsequent peer write', failsFor('wooden_pickaxe'), null)

console.log('  -- a moved gap resets the counter across the hive --')
run('Alpha', { ACT: 'fail', N: 3, ARGS: '{"item":"chest"}', GAP: '2x oak_planks' })
const beforeMove = failsFor('chest')
run('Alpha', { ACT: 'gapmove', ARGS: '{"item":"chest"}', GAP: '1x oak_log' })
const afterMove = failsFor('chest')
t('gap moved, so the streak restarts', afterMove < beforeMove, true)

console.log('  -- the shared map stays bounded --')
for (let i = 0; i < 60; i++) {
  run('Alpha', { ACT: 'fail', N: 2, ARGS: `{"item":"filler_${i}"}` })
}
// MAX_AVOID is 40. A bot prunes on load, then records before it saves, so the
// file legitimately holds the cap plus whatever this process added since -- the
// invariant is that it stays PINNED NEAR the cap, not that it never exceeds it
// by one. Before the fix this reached 60+ and kept climbing.
const n = keyCount()
console.log(`        (60 distinct rules recorded; file holds ${n})`)
t('avoid map stays bounded near MAX_AVOID', n <= 45, true)

fs.rmSync(dir, { recursive: true, force: true })
console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
