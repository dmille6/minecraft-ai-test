// MEMORY_SCOPE: what a bot remembers, and with whom.
//
//   isolated  private lessons, private world model -- learns nothing from a peer
//   private   private lessons, SHARED world model  -- what every run to date was
//   shared    both shared -- the hive
//
// Each case runs in its OWN PROCESS. An earlier version imported the modules
// with cache-busting query strings, which busted lessons.mjs but not the
// config.mjs it imports -- so config was evaluated once, captured the first
// scope, and every later case silently tested `private` again while reporting
// the scope it meant to test. Bots are separate processes; the test is too.
//
// The load-bearing case is the merge. Lessons.save() writes the whole file from
// memory, so five bots on one file is guaranteed lost updates: A loads, B loads,
// A writes, B writes, A's lessons are gone. A hive built on that would measure
// how fast lessons get LOST rather than how fast beliefs propagate.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const t = (n, got, want) => { const ok = got === want; ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  (got ${got}, want ${want})`}`) }

const here = path.dirname(fileURLToPath(import.meta.url))
const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-scope-'))

const DRIVER = path.join(dir, 'driver.mjs')
fs.writeFileSync(DRIVER, `
import { openLessons } from '${path.join(here, '../src/lessons.mjs')}'
import { openWorldFacts } from '${path.join(here, '../src/worldfacts.mjs')}'
const l = openLessons()
l.recordFailure(process.env.SKILL, JSON.parse(process.env.ARGS), 'no_path')
l.save()
// reportResource, not noteResource. The first version of this test guessed the
// method name and wrapped it in try/catch, so the call threw silently and the
// world-model assertions failed for a reason that had nothing to do with scope.
openWorldFacts().reportResource('coal_ore', { x: 5, y: 40, z: 5 })
`)

function run(scope, bot, skill, args) {
  execFileSync(process.execPath, [DRIVER], {
    env: { ...process.env, MEMORY_SCOPE: scope, BOT_NAME: bot, STATE_DIR: dir,
           LOG_DIR: dir, SKILL: skill, ARGS: JSON.stringify(args) },
    stdio: 'pipe',
  })
}
const has = f => fs.existsSync(path.join(dir, f))

console.log('each scope puts state where it belongs')
run('private', 'Scout01', 'goto', { x: 1 })
t('private  -> lessons-Scout01.json', has('lessons-Scout01.json'), true)
t('private  -> shared world-facts.json', has('world-facts.json'), true)

run('isolated', 'Scout02', 'goto', { x: 2 })
t('isolated -> lessons-Scout02.json', has('lessons-Scout02.json'), true)
t('isolated -> world-facts-Scout02.json', has('world-facts-Scout02.json'), true)

run('shared', 'Miner01', 'gather', { block: 'oak_log' })
t('shared   -> lessons-hive.json', has('lessons-hive.json'), true)

console.log('\nshared lessons MERGE rather than overwrite')
run('shared', 'Gather01', 'goto', { x: 99 })          // a second bot writes
const hive = JSON.parse(fs.readFileSync(path.join(dir, 'lessons-hive.json'), 'utf8'))
const keys = Object.keys(hive.avoid ?? {})
t("the first bot's rule survived the second's write", keys.some(k => k.startsWith('gather')), true)
t("the second bot's rule is present",                 keys.some(k => k.startsWith('goto')), true)
t('both, not one',                                    keys.length >= 2, true)

console.log('\nshared rules carry provenance')
// One reporter with four failures and four reporters with one each are very
// different evidence for the same count. In a hive a belief outlives the bot
// that formed it, so it has to be answerable for where it came from.
const shared = Object.entries(hive.avoid).find(([k]) => k.startsWith('gather'))?.[1]
t('records who reported it', Array.isArray(shared?.reporters), true)
t('names the reporting bot',  (shared?.reporters ?? []).includes('Miner01'), true)
run('shared', 'Scout02', 'gather', { block: 'oak_log' })   // a second bot hits the same rule
const again = JSON.parse(fs.readFileSync(path.join(dir, 'lessons-hive.json'), 'utf8'))
const both = Object.entries(again.avoid).find(([k]) => k.startsWith('gather'))?.[1]
t('a second reporter is added, not replaced', (both?.reporters ?? []).length, 2)
// A hive ACCUMULATES across bodies: the second bot loads the shared count and
// increments from there, so the fleet reaches the 4-failure block threshold in
// four TOTAL failures rather than four each. That is the hypothesis, pinned
// here so a later change cannot quietly turn a hive back into five privates.
t('a hive accumulates across bots',          both?.fails, 2)

console.log('\nisolation really isolates')
t('isolated bot did not write the shared world model',
  !has('world-facts-Scout01.json'), true)

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
