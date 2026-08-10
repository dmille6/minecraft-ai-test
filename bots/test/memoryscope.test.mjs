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

function run(scope, bot, skill, args, pool = 'hive') {
  execFileSync(process.execPath, [DRIVER], {
    env: { ...process.env, MEMORY_SCOPE: scope, MEMORY_POOL: pool, BOT_NAME: bot,
           STATE_DIR: dir, LOG_DIR: dir, SKILL: skill, ARGS: JSON.stringify(args) },
    stdio: 'pipe',
  })
}
const has = f => fs.existsSync(path.join(dir, f))

console.log('each scope puts state where it belongs')
run('private', 'Scout01', 'goto', { x: 1 })
t('private  -> lessons-Scout01.json', has('lessons-Scout01.json'), true)
// Was `world-facts.json`, one global file for every non-isolated bot in the
// fleet -- so the private arm and the shared arm read the same world model and
// were never independent. Shared WITHIN A POOL now.
t('private  -> pooled world-facts-hive.json', has('world-facts-hive.json'), true)

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

// --- MEMORY_POOL: the unit of sharing, and therefore the unit of the study ---
//
// Scope says WHAT is shared and could never say WITH WHOM. Every shared bot
// wrote one lessons-hive.json, so the shared arm was a single observation no
// matter how many bots ran in it: a fourth hive bot bought more sampling inside
// the unit and zero replication between units. An experiment cannot compare
// arms when the arm it cares about has n=1.
//
// Two pools must not be able to see each other, or "independent replicate" is
// just a label on the same file.
console.log('\npools are independent memories')
run('shared', 'HiveA1', 'mine', { block: 'iron_ore' }, 'alpha')
run('shared', 'HiveB1', 'craft', { item: 'stick' },    'beta')
t('pool alpha has its own lessons file', has('lessons-alpha.json'), true)
t('pool beta has its own lessons file',  has('lessons-beta.json'), true)

const alpha = JSON.parse(fs.readFileSync(path.join(dir, 'lessons-alpha.json'), 'utf8'))
const beta  = JSON.parse(fs.readFileSync(path.join(dir, 'lessons-beta.json'), 'utf8'))
t('alpha holds only its own rule',
  Object.keys(alpha.avoid ?? {}).some(k => k.startsWith('mine')) &&
  !Object.keys(alpha.avoid ?? {}).some(k => k.startsWith('craft')), true)
t("beta never saw alpha's failure",
  !Object.keys(beta.avoid ?? {}).some(k => k.startsWith('mine')), true)

// World facts too. Pooling lessons while leaving one global world model would
// leak the discovery half of the treatment between arms, which is exactly the
// bug this replaced.
t('pool alpha has its own world model', has('world-facts-alpha.json'), true)
t('pool beta has its own world model',  has('world-facts-beta.json'), true)

// A pool is a boundary, not a scope: two bots in the SAME pool still share.
run('shared', 'HiveA2', 'goto', { x: 7 }, 'alpha')
const alpha2 = JSON.parse(fs.readFileSync(path.join(dir, 'lessons-alpha.json'), 'utf8'))
t('same-pool bots still accumulate together',
  Object.keys(alpha2.avoid ?? {}).length >= 2, true)

// isolated ignores the pool entirely -- it is isolation, not a pool of one.
run('isolated', 'LoneWolf', 'gather', { block: 'sand' }, 'alpha')
t('isolated ignores MEMORY_POOL for lessons', has('lessons-LoneWolf.json'), true)
t('isolated ignores MEMORY_POOL for world facts', has('world-facts-LoneWolf.json'), true)

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
