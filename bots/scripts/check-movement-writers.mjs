#!/usr/bin/env node
// A RATCHET on who is allowed to steer the bot.
//
// WHY THIS EXISTS
//
// Movement has no owner. `bot.pathfinder.setGoal()` is a global mutation: the
// last caller wins, silently, and the loser never learns it lost. When two
// subsystems both steer -- a reflex reacting to damage while a skill walks to a
// tree -- the symptom is not an exception. It is a bot that goes somewhere
// nobody asked for, or stands still, while every log line says the thing that
// issued the command succeeded. That is the same shape as the faults in the
// failure taxonomy: the instrument reports health it cannot actually observe.
//
// The fix is single-writer discipline: exactly one module owns setGoal,
// setMovements and stop, and everything else asks that module. Enforcing it
// statically costs nothing at runtime and cannot be forgotten.
//
// WHY A RATCHET AND NOT A HARD RULE
//
// Three files write to the pathfinder today. A rule that fails the build on all
// three is a rule that gets commented out in an hour. So this compares against a
// declared BASELINE instead:
//
//   - a writer in a file NOT in the baseline        -> FAIL (a new violator)
//   - the baseline lists a file that no longer writes -> FAIL (update the list)
//
// The count can therefore only go down, and going down is a deliberate, visible
// edit rather than something that quietly rots. When BASELINE reaches one entry,
// replace this file with a plain assertion and delete the ratchet.
//
//   node scripts/check-movement-writers.mjs        (from bots/)
//
// Written from a description of the idea, not from anyone else's source: Cairn
// (AGPL-3.0) enforces the same discipline and cannot be copied into this tree.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'

// The ONLY files permitted to steer. Shrink this; never grow it.
// Each entry needs a reason, so that removing one is a decision and not a guess.
//
// NOTE on how this list was established: a plain grep for the write calls
// reported THREE runtime files, including src/reflex.mjs. That was wrong --
// reflex.mjs only mentions setGoal in a comment explaining why it does NOT call
// stop(). Stripping comments before matching is the difference between a real
// baseline and a fictional one, which is the whole reason stripNonCode() exists.
const BASELINE = new Map([
  ['src/index.mjs', 'installs Movements presets at startup and for ascend/descend'],
  ['src/skills.mjs', 'goto/follow skills and their abort handlers'],
  // Tests drive the API directly on purpose: they assert the contract that the
  // runtime owners depend on. They are not a second steering path at runtime.
  ['test/dep-contract.test.mjs', 'asserts the pathfinder dependency contract'],
  ['test/surface.test.mjs', 'asserts surface-movement behaviour'],
])

const ROOTS = ['src', 'test', 'scripts']
// setGoal | setMovements | stop, on bot.pathfinder or this.bot.pathfinder.
const WRITE = /\b(?:\w+\.)?bot\.pathfinder\.(setGoal|setMovements|stop)\s*\(/g

function walk (dir, out = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(mjs|js)$/.test(e.name)) out.push(full)
  }
  return out
}

// A write inside a comment is documentation, not a caller. Strip comments and
// string literals before matching, or every explanatory paragraph reads as a
// violation -- which is exactly the false positive that gets a gate disabled.
function stripNonCode (src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
}

const found = new Map()
for (const root of ROOTS) {
  try { statSync(root) } catch { continue }
  for (const file of walk(root)) {
    const code = stripNonCode(readFileSync(file, 'utf8'))
    const hits = [...code.matchAll(WRITE)].map(m => m[1])
    if (hits.length) {
      found.set(relative('.', file).split(sep).join('/'), hits)
    }
  }
}

const newViolators = [...found.keys()].filter(f => !BASELINE.has(f))
const staleBaseline = [...BASELINE.keys()].filter(f => !found.has(f))

console.log(`movement-writers: ${found.size} file(s) steer the pathfinder; baseline allows ${BASELINE.size}`)
for (const [file, hits] of [...found].sort()) {
  const counts = hits.reduce((a, h) => (a[h] = (a[h] || 0) + 1, a), {})
  const detail = Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(' ')
  const mark = BASELINE.has(file) ? ' ' : '!'
  console.log(`  ${mark} ${file.padEnd(24)} ${detail}`)
}

let bad = false
if (newViolators.length) {
  bad = true
  console.error('\nFAIL: a file outside the baseline now steers the pathfinder:')
  for (const f of newViolators) console.error(`  ${f}`)
  console.error('\nRoute it through an existing owner instead. If it genuinely needs to')
  console.error('own movement, add it to BASELINE with a reason -- but that makes the')
  console.error('multi-writer problem worse, so justify it in the commit message.')
}
if (staleBaseline.length) {
  bad = true
  console.error('\nFAIL: the baseline lists files that no longer steer the pathfinder:')
  for (const f of staleBaseline) console.error(`  ${f}  (${BASELINE.get(f)})`)
  console.error('\nThat is progress. Remove them from BASELINE so the ratchet holds.')
}

if (!bad) console.log('ok — no new movement writers')
process.exit(bad ? 1 : 0)
