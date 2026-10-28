#!/usr/bin/env node
// Runs every test/*.test.mjs and reports which ones fail.
//
// WHY THIS EXISTS
//
// The test files are not node:test suites -- each one is a standalone script
// with its own tiny t() harness that ends in `process.exit(fail ? 1 : 0)`. So
// `node --test test/` does NOT run them: it finds no node:test registrations,
// reports "tests 1 / fail 1", and that failure is the runner's, not the suite's.
// Anyone trusting that output would conclude the suite was broken when it was
// never executed.
//
// Exit code is the contract. A test that hangs is a failure too -- hence the
// per-file timeout.
//
//   node scripts/run-tests.mjs                 (from bots/)
//   node scripts/run-tests.mjs drowning        (only files matching a substring)
//   TEST_JOBS=1 node scripts/run-tests.mjs     (the old fully sequential run)
//   TEST_VERBOSE=1 ...                         (print every file's output, not only failures')
//
// PARALLEL (W6, 2026-10-28). Each file is still its own node process with the
// same env as before; only several of them run at once. The sequential suite
// took ~35 minutes, most of it a handful of files that genuinely wait on real
// per-step pacing (mine does `await sleep(250)` + `sleep(150)` per step) --
// waiting, which parallelises perfectly.
//
//   - TEST_JOBS (default: CPU count - 1, at most 8) bounds concurrency. This
//     also runs on the controller Mac, which has to stay usable.
//   - Slowest files start first (durations remembered in .test-durations.json,
//     gitignored), so a 200 s file does not start last and set the wall time.
//   - Each child gets its OWN TMPDIR, so anything built on os.tmpdir() cannot
//     collide with another file running at the same moment.
//   - SERIAL files run after the pool drains, one at a time, with nothing else
//     running. A file goes there when it cannot share the machine -- a fixed
//     shared path, or timing assertions that flake under load. Never loosen an
//     assertion to make a file parallel-safe; list it here instead.

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, renameSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

// Files that must run alone, each with its reason. An entry without evidence
// is a guess and should be removed.
const SERIAL = new Map([
  // F10 measures the skill's real wall-clock pacing and failed once under load
  // (seen before W6). Timing tests do not get wider margins to go parallel.
  ['lavastep.test.mjs', 'wall-clock pacing assertions; F10 flaked under load'],
])

// 60s was right when every file was pure arithmetic. mine-staircase.test.mjs
// drives a 90-step descent through the skill's real 150ms per-step pacing --
// deliberately, because the bug it now guards against (a bot still falling
// when arrival is checked) only exists in the timing. Raised rather than
// letting that test fake the clock and stop testing the thing.
// 300s since the one-trunk merge (W3, 10-28): the showcase's buildrun*.test.mjs files take ~106s ALONE (real visit
// pacing) and ~120s under the parallel runner's contention, so 120s killed a passing file. A real hang still dies.
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 300_000)
const filter = process.argv[2] || ''
const VERBOSE = !!process.env.TEST_VERBOSE
const JOBS = Math.max(1, Math.floor(Number(process.env.TEST_JOBS)) || Math.min(8, Math.max(1, os.cpus().length - 1)))
const DURATIONS = '.test-durations.json'
const FAIL_LINE = /^  FAIL[ \t]|^FAILED/m

const files = readdirSync('test')
  .filter(f => f.endsWith('.test.mjs'))
  .filter(f => !filter || f.includes(filter))
  .sort()

if (!files.length) {
  console.error(`no test files match ${JSON.stringify(filter)}`)
  process.exit(1)
}

let known = {}
try { known = JSON.parse(readFileSync(DURATIONS, 'utf8')) } catch {}
// An unknown file sorts as slow: starting it early costs nothing, starting a
// long one last costs its whole duration.
const est = f => known[f] ?? 60_000
const parallel = files.filter(f => !SERIAL.has(f)).sort((a, b) => est(b) - est(a) || a.localeCompare(b))
const serial = files.filter(f => SERIAL.has(f))

const scratch = mkdtempSync(path.join(os.tmpdir(), 'mcai-tests-'))

function run (file) {
  return new Promise(resolve => {
    const started = Date.now()
    const tmp = mkdtempSync(path.join(scratch, file.replace(/\.test\.mjs$/, '') + '-'))
    // Short deadlines for the suite. hard-stop.test.mjs exercises the real
    // runner path -- a skill that ignores its abort -- and at the production
    // 180s + 30s grace that single test would add three and a half minutes.
    // A suite people wait for is a suite people skip.
    const child = spawn(process.execPath, [`test/${file}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env,
             TMPDIR: tmp,
             SKILL_TIMEOUT_MS: process.env.SKILL_TIMEOUT_MS || '300',
             SKILL_HARD_STOP_GRACE_MS: process.env.SKILL_HARD_STOP_GRACE_MS || '300',
             // logcap-01: the stock suite's arithmetic is written against the old 64 wood target (stocktarget.mjs)
             STOCK_WOOD_TARGET: process.env.STOCK_WOOD_TARGET ?? '64',
             // `config.mjs` requires OLLAMA_MODEL with NO fallback on purpose --
             // the old default named a 14b that was not installed anywhere, so a
             // bot that lost its env file asked for a model nobody had pulled.
             // Tests import config for unrelated reasons and must not each have
             // to know that, so the runner supplies a value the way it already
             // supplies the skill timeouts. `model-identity.test.mjs` asserts the
             // SOURCE has no default, which is the check that actually matters
             // and which this line cannot mask.
             OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct',
             OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434' },
    })
    let out = ''
    let timedOut = false
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); out += '\n[killed: timeout]' }, TIMEOUT_MS)
    child.on('error', e => { out += `\n[spawn error: ${e.message}]` })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      try { rmSync(tmp, { recursive: true, force: true }) } catch {}
      // A signal death has code === null; `null !== 0` already fails it, but
      // "exit null" reads like a runner bug, so name the signal.
      code = code ?? `signal ${signal}`
      // The belt preflight.sh used to wear: a file that prints a failure LINE
      // but forgets to exit non-zero. Anchored to the line format, never the
      // bare letters -- "PERMANENT OWNERSHIP CAPTURE IS ITS OWN FAILURE" is the
      // name of a passing test, and an unanchored grep once refused a deploy
      // over it.
      if (code === 0 && FAIL_LINE.test(out)) { code = '0, but printed a FAIL line' }
      resolve({ file, code, timedOut, out, ms: Date.now() - started })
    })
  })
}

const results = []
const total = files.length
function report (r) {
  const mark = r.code === 0 ? 'ok  ' : 'FAIL'
  console.log(`${mark} ${r.file.padEnd(44)} ${String(r.ms).padStart(6)}ms  [${results.length}/${total}]`)
  if (VERBOSE) console.log(r.out.trimEnd().replace(/^/gm, '    | '))
}

async function pool (list, jobs) {
  let next = 0
  async function worker () {
    while (next < list.length) {
      const r = await run(list[next++])
      results.push(r); report(r)
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, worker))
}

const t0 = Date.now()
console.log(`running ${parallel.length} files ${JOBS} at a time, then ${serial.length} serial`)
await pool(parallel, JOBS)
await pool(serial, 1)
const wall = Date.now() - t0
try { rmSync(scratch, { recursive: true, force: true }) } catch {}

// Remember durations for the next run's ordering. Best effort: a failure here
// must never change the verdict.
try {
  const present = new Set(readdirSync('test'))
  for (const f of Object.keys(known)) if (!present.has(f)) delete known[f]
  for (const r of results) if (!r.timedOut) known[r.file] = r.ms
  const tmp = `${DURATIONS}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(known))
  renameSync(tmp, DURATIONS)
} catch {}

results.sort((a, b) => a.file.localeCompare(b.file))
const failed = results.filter(r => r.code !== 0)

if (failed.length) {
  console.log(`\n${'='.repeat(60)}\nFAILING DETAIL\n${'='.repeat(60)}`)
  for (const r of failed) {
    console.log(`\n--- ${r.file} (exit ${r.code}${SERIAL.has(r.file) ? ', serial' : ''}) ---`)
    console.log(r.out.trim().split('\n').slice(-40).join('\n'))
  }
}

console.log('\nslowest files:')
for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 10)) {
  console.log(`  ${String(r.ms).padStart(7)}ms  ${r.file}${SERIAL.has(r.file) ? '  (serial)' : ''}`)
}
const summed = results.reduce((s, r) => s + r.ms, 0)
console.log(`\nwall ${(wall / 1000).toFixed(1)}s, summed file time ${(summed / 1000).toFixed(1)}s, jobs ${JOBS}`)
if (failed.length) console.log(`FAILED (${failed.length}): ${failed.map(r => r.file).join(' ')}`)
console.log(`${results.length - failed.length}/${total} files passed`)
// Every file must have produced a result: a runner that silently skipped one
// must not report green.
process.exit(failed.length || results.length !== total ? 1 : 0)
