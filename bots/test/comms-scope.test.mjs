// CHAT IS GLOBAL; BELIEF MUST NOT BE.
//
// The server delivers every chat line to every bot, whatever their arm. Until
// this test's subject existed, the listener ingested any fleet-named peer's
// "unreachable" and "hazard" claims into the local world model -- so isolated
// bots, whose entire experimental purpose is to learn alone, were absorbing
// the shared arm's beliefs. "Unreachable" is the exact false-belief object the
// lab studies; the control arm was receiving a dilute dose of the treatment.
//
// Worse, the sender name filter predated the fleet rename: Hive01 and Solo01
// were silently distrusted while Scout01 and Gather01 were believed, so the
// contamination varied by what a bot happened to be CALLED.
//
// The rule under test mirrors the memory design exactly:
//   isolated  -> ingests nothing from anyone
//   otherwise -> ingests only from its OWN pool, named in the message
//   unpooled (old-format) messages -> trusted by no one
//
// Each scope runs in its own process because config.mjs is evaluated once per
// process -- the lesson memoryscope.test.mjs already paid for.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const t = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`) }

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-comms-'))

const DRIVER = path.join(dir, 'driver.mjs')
fs.writeFileSync(DRIVER, `
import { EventEmitter } from 'node:events'
import { startComms } from '${path.join(here, '../src/comms.mjs')}'
const bot = new EventEmitter()
const ingested = []
const worldFacts = {
  reportHazard: (kind, pos, n, who) => ingested.push(['hazard', who]),
  reportUnreachable: (id, who) => ingested.push(['unreachable', who]),
}
startComms(bot, worldFacts)
// One message per line on stdin: "<sender>|<text>"
const lines = (await new Promise(r => {
  let b = ''; process.stdin.on('data', d => b += d); process.stdin.on('end', () => r(b))
})).trim().split('\\n')
for (const l of lines) {
  const [sender, ...rest] = l.split('|')
  bot.emit('chat', sender, rest.join('|'))
}
console.log(JSON.stringify(ingested))
`)

function run(scope, pool, messages) {
  const out = execFileSync(process.execPath, [DRIVER], {
    env: { ...process.env, MEMORY_SCOPE: scope, MEMORY_POOL: pool, BOT_NAME: 'Solo09',
           LOG_DIR: dir, STATE_DIR: dir, LOG_LEVEL: 'error' },
    input: messages.join('\n'), encoding: 'utf8',
  })
  return JSON.parse(out.trim().split('\n').pop())
}

const HAZ = p => `[fleet] ${p} hazard drowned 10 60 10 x3`
const UNR = p => `[fleet] ${p} unreachable goal_1 5 60 5`

console.log('scoped ingestion')
t('same-pool hazard is believed',
  run('shared', 'hive-a', ['Hive01|' + HAZ('hive-a')]), [['hazard', 'Hive01']])
t('cross-pool hazard is not',
  run('shared', 'hive-a', ['Gather02|' + HAZ('hive-c')]), [])
t('an isolated bot ingests nothing, even from its nominal pool',
  run('isolated', 'hive-a', ['Hive01|' + HAZ('hive-a'), 'Hive02|' + UNR('hive-a')]), [])
t('the old unpooled format is trusted by no one',
  run('shared', 'hive-a', ['Hive01|[fleet] hazard drowned 10 60 10 x3']), [])

console.log('sender identity')
t('Hive and Solo names are fleet members now',
  run('shared', 'hive-a', ['Solo02|' + UNR('hive-a')]), [['unreachable', 'Solo02']])
t('players are still not sources of truth',
  run('shared', 'hive-a', ['darrell|' + HAZ('hive-a')]), [])

fs.rmSync(dir, { recursive: true, force: true })
console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
