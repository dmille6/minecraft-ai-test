// WHOLE-MAP EXPEDITIONS S0 (ledger wholemap-s0, docs/reports/wholemap-expeditions-design-2026-11-01.md s.4 + s.8): the
// showcase VM's coverage instrument (infra/showcase/wholemap.py) and its fleetstatus line are tested here so `npm test`
// cannot be green while they are red. The Python suites own the behaviour; this file only runs them and checks the
// mutant line (every anchored mutant killed).
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const py = (rel) => {
  const r = spawnSync('python3', ['-B', path.join(REPO, rel)], { encoding: 'utf8', timeout: 120_000 })
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

t('test_wholemap.py: reader, classifier, flood tiers, denominators, tiles, layer, e2e; every mutant killed', () => {
  const r = py('infra/showcase/test_wholemap.py')
  assert.equal(r.status, 0, r.out.split('\n').filter(l => /FAIL|SURVIVED|Error|ANCHOR/.test(l)).slice(0, 8).join('\n') || r.out.slice(-800))
  const m = /mutants killed (\d+)\/(\d+)/.exec(r.out)
  assert.ok(m && m[1] === m[2] && Number(m[2]) >= 10, `mutant line: ${m && m[0]}`)
})

t('test_fleetstatus.py: the expeditions line (and the rest of fleetstatus) passes', () => {
  const r = py('scripts/test_fleetstatus.py')
  assert.equal(r.status, 0, r.out.split('\n').filter(l => /FAIL|Error/.test(l)).slice(0, 8).join('\n') || r.out.slice(-800))
  assert.ok(/PASS\s+wholemap_line_formats_and_never_zeroes/.test(r.out), 'the wholemap test did not run')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
