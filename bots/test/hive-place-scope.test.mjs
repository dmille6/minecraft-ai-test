// IN A HIVE, A PEER'S POSITION IS NOT YOUR HISTORY.
//
// This is the defect that made the first draft of place-scoped `nothing_found`
// unshippable, and it is the worst kind: it fires ONLY in the arms with a
// shared store, so it preferentially dissolves learned_avoid in exactly the
// hive pools whose convergence is this experiment's measured effect.
//
// The mechanism, demonstrated below against a real shared file and real
// separate bot processes:
//
//     Alpha: 20 failures at (0,70,0)         -> fails=20, where={0,70,0}
//     Bravo loads the shared store           -> inherits fails=20 AND where
//     Bravo's FIRST failure at (300,70,300)  -> far from Alpha's BODY, so the
//                                               first draft read it as "Bravo
//                                               moved" -> fails=1, forgiven
//     after Bravo saves, the POOL believes   -> fails=1
//
// `forgiven` makes a reset beat the merge's Math.max (lessons.mjs), so one
// peer's first observation erased twenty. Two things stop it now, and this file
// tests both: place history is a map KEYED BY BOT which the merge writes only
// this bot's own slot of, and an empty history returns `seed` rather than `new`
// -- a bot that has never failed here has not MOVED, it has merely arrived.
//
// Separate child processes, as memoryscope.test.mjs and hive-forgets.test.mjs
// do, because config.bot.name is read from the environment at import time: two
// Lessons in one process are two instances of the SAME bot and could not
// exhibit this at all.
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const t = (n, got, want) => {
  const ok = got === want; ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const REAL_LESSONS = path.join(here, '../src/lessons.mjs')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-hiveplace-'))

// One scripted action as one bot against one shared file, then save.
const DRIVER = path.join(dir, 'driver.mjs')
// LESSONS_MODULE is a parameter so the mutant at the bottom can be driven by
// exactly the same bot processes as the real thing.
fs.writeFileSync(DRIVER, `
const { openLessons } = await import(process.env.LESSONS_MODULE)
const l = openLessons()
const pos = { x: Number(process.env.PX), y: 70, z: Number(process.env.PZ) }
for (let i = 0; i < Number(process.env.N || 1); i++) {
  l.recordFailure('gather', { block: 'oak_log', count: 16 }, 'nothing_found', pos)
}
l.save()
`)

const botDir = bot => path.join(dir, bot)
const poolDir = path.join(dir, '_pool-hive')

const run = (bot, { x, z, n = 1, lessons = REAL_LESSONS }) => {
  fs.mkdirSync(botDir(bot), { recursive: true })
  execFileSync(process.execPath, [DRIVER], {
    env: { ...process.env, MEMORY_SCOPE: 'shared', BOT_NAME: bot, STATE_DIR: botDir(bot),
           LOG_LEVEL: 'error', LOG_DIR: path.join(dir, 'logs'),
           LESSONS_MODULE: `file://${lessons}`, PX: String(x), PZ: String(z), N: String(n) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
}

const store = () => {
  try {
    const f = fs.readdirSync(poolDir).find(f => f.includes('lesson'))
    return f ? JSON.parse(fs.readFileSync(path.join(poolDir, f), 'utf8')) : { avoid: {} }
  } catch { return { avoid: {} } }
}
const entry = () => Object.values(store().avoid ?? {})[0] ?? null
const fails = () => entry()?.fails ?? null
const reset = () => { fs.rmSync(poolDir, { recursive: true, force: true }) }

// --------------------------------------------------------------------------
console.log('  -- the shared store accumulates across bodies, as the hive arm intends --')
run('Alpha', { x: 0, z: 0, n: 20 })
t('Alpha alone reaches twenty in the shared file', fails(), 20)

console.log('\n  -- THE DEFECT: a peer must not dissolve an inherited count on arrival --')
run('Bravo', { x: 300, z: 300, n: 1 })
t("Bravo's first failure 424 blocks away ACCRUES, it does not reset", fails(), 21)

console.log('\n  -- POSITIVE CONTROL: the same instrument can still see a reset --')
// Bravo now has its own history at (300,300). A genuine personal relocation is
// what the feature exists to forgive, and the test would be worthless if it
// could not observe one happening.
run('Bravo', { x: 5000, z: 5000, n: 1 })
t('once Bravo has its OWN history, walking away does restart the streak', fails(), 1)

console.log('\n  -- place memory is per-bot, and the merge keeps every peer slot --')
const places = entry()?.placesBy ?? {}
t('Alpha has its own slot', Array.isArray(places.Alpha), true)
t('Bravo has its own slot', Array.isArray(places.Bravo), true)
t("Alpha's slot is Alpha's position, not Bravo's", JSON.stringify(places.Alpha), '[{"x":0,"y":70,"z":0}]')
t('and a third bot arriving does not clobber either', (() => {
  run('Charlie', { x: 900, z: 900, n: 1 })
  const p = entry()?.placesBy ?? {}
  return Object.keys(p).sort().join(',')
})(), 'Alpha,Bravo,Charlie')

// --------------------------------------------------------------------------
// MUTANT: the seed rule is what stops an arriving peer resetting the pool.
//
// withMutant's shape (bots/test/climb-escape.test.mjs:447) -- anchor asserted
// PRESENT and UNIQUE, written to a SEPARATE file, src/ never touched.
console.log('\n  -- MUTANT: without the seed rule, this is the protocol-destroying bug --')
const src = fs.readFileSync(REAL_LESSONS, 'utf8')
const ANCHOR = "  if (!seen.length) return 'seed'"
assert.ok(src.includes(ANCHOR), 'MUTATION DID NOT APPLY: the seed rule anchor is missing')
assert.ok(src.split(ANCHOR).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
const mutantPath = path.join(here, `_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
fs.writeFileSync(mutantPath,
  src.replace(ANCHOR, "  if (!seen.length) return 'new'").replace(/from '\.\//g, "from '../src/"))
try {
  reset()
  run('Alpha', { x: 0, z: 0, n: 20, lessons: mutantPath })
  t('mutant precondition: Alpha still reaches twenty', fails(), 20)
  run('Bravo', { x: 300, z: 300, n: 1, lessons: mutantPath })
  t("MUTANT KILLED: Bravo's arrival erases Alpha's twenty", fails(), 1)
} finally {
  try { fs.unlinkSync(mutantPath) } catch { /* already gone */ }
}

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
