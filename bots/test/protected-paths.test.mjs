// THE FUN-MODE TIER-3 DECIDER RUNS IN THE SUITE THAT ALWAYS RUNS.
//
// config/protected-paths.txt names what is tier 3 (docs/PROCESS-fun-mode.md § Tiers) and
// scripts/lib/protected.py decides whether a diff touches it. Its behaviour tests are Python
// (scripts/test_protected.py); this file runs them under `npm test`, because a check in scripts/
// that nothing runs is the defect nothing-important-is-orphaned.test.mjs exists to prevent.
// The Python side also fails when a listed file or function no longer exists, so a rename cannot
// quietly drop something out of protection.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const t = (n, f) => { try { f(); pass++; console.log(`  PASS  ${n}`) } catch (e) { fail++; console.log(`  FAIL  ${n}\n        ${e.message}`) } }

// The repo root from this file's own location, not `git rev-parse` (phase 1 item 3, 11-06): test_protected.py needs the
// git BINARY (it builds a throwaway repo), never a checkout, so this file runs the same on a tree shipped without .git.
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

t('scripts/test_protected.py passes (behaviour, the real list, the CLI, one mutant)', () => {
  const r = spawnSync('python3', [join(ROOT, 'scripts/test_protected.py')], { encoding: 'utf8', timeout: 60_000 })
  assert.equal(r.status, 0, `exit ${r.status}\n${(r.stdout || '') + (r.stderr || '')}`)
  // POSITIVE CONTROL: a script that exited 0 without running its checks would print nothing.
  const m = /test_protected: (\d+) checks passed/.exec(r.stdout)
  assert.ok(m && Number(m[1]) >= 100, `expected >= 100 checks, saw: ${r.stdout.trim().slice(-200)}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
