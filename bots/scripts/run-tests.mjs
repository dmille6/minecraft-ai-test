#!/usr/bin/env node
// Runs every test/*.mjs and reports which ones fail.
//
// WHY THIS EXISTS
//
// There are 56 test files in test/ and, until this script, no way to run them
// as a set. They are not node:test files -- each one is a standalone script
// with its own tiny t() harness that ends in `process.exit(fail ? 1 : 0)`. So
// `node --test test/` does NOT run them: it finds no node:test registrations,
// reports "tests 1 / fail 1", and that failure is the runner's, not the suite's.
// Anyone trusting that output would conclude the suite was broken when it was
// never executed.
//
// Exit code is the contract. A test that hangs is a failure too -- hence the
// per-file timeout, which defaults low because these are all offline unit tests
// against fixtures and none should take seconds.
//
//   node scripts/run-tests.mjs                 (from bots/)
//   node scripts/run-tests.mjs drowning        (only files matching a substring)

import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import process from 'node:process'

// 60s was right when every file was pure arithmetic. mine-staircase.test.mjs
// drives a 90-step descent through the skill's real 150ms per-step pacing --
// deliberately, because the bug it now guards against (a bot still falling
// when arrival is checked) only exists in the timing. Raised rather than
// letting that test fake the clock and stop testing the thing.
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 120_000)
const filter = process.argv[2] || ''

const files = readdirSync('test')
  .filter(f => f.endsWith('.test.mjs'))
  .filter(f => !filter || f.includes(filter))
  .sort()

if (!files.length) {
  console.error(`no test files match ${JSON.stringify(filter)}`)
  process.exit(1)
}

function run (file) {
  return new Promise(resolve => {
    const started = Date.now()
    // Short deadlines for the suite. hard-stop.test.mjs exercises the real
    // runner path -- a skill that ignores its abort -- and at the production
    // 180s + 30s grace that single test would add three and a half minutes.
    // A suite people wait for is a suite people skip.
    const child = spawn(process.execPath, [`test/${file}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env,
             SKILL_TIMEOUT_MS: process.env.SKILL_TIMEOUT_MS || '300',
             SKILL_HARD_STOP_GRACE_MS: process.env.SKILL_HARD_STOP_GRACE_MS || '300' },
    })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => { child.kill('SIGKILL'); out += '\n[killed: timeout]' }, TIMEOUT_MS)
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ file, code, out, ms: Date.now() - started })
    })
  })
}

const results = []
for (const file of files) results.push(await run(file))

const failed = results.filter(r => r.code !== 0)
for (const r of results) {
  const mark = r.code === 0 ? 'ok  ' : 'FAIL'
  console.log(`${mark} ${r.file.padEnd(34)} ${String(r.ms).padStart(5)}ms`)
}

if (failed.length) {
  console.log(`\n${'='.repeat(60)}\nFAILING DETAIL\n${'='.repeat(60)}`)
  for (const r of failed) {
    console.log(`\n--- ${r.file} (exit ${r.code}) ---`)
    console.log(r.out.trim().split('\n').slice(-25).join('\n'))
  }
}

console.log(`\n${results.length - failed.length}/${results.length} files passed`)
process.exit(failed.length ? 1 : 0)
