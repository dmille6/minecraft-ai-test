// PROMOMERGE (audit 11-01 flag 4, control session 11-02): every fleet promotion is merged into main mechanically, or pages.
// scripts/host/test_promomerge.py is run here so `npm test` cannot be green while it is red: the pure decisions fire and stay
// quiet, an end-to-end merge / conflict / push / re-merge over a real bare origin, the wiring (Mac wrapper, .31 installer,
// the header file, the registry row), and every anchored mutant killed.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

t('test_promomerge.py: decisions, e2e over a real git origin, wiring, every mutant killed', () => {
  const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_promomerge.py')], { encoding: 'utf8', timeout: 110_000 })
  const out = (r.stdout || '') + (r.stderr || '')
  assert.equal(r.status, 0, out.split('\n').filter(l => /FAIL|SURVIVED|Error|ANCHOR/.test(l)).slice(0, 8).join('\n') || out.slice(-800))
  const m = /mutants killed (\d+)\/(\d+)/.exec(out)
  assert.ok(m && m[1] === m[2] && Number(m[2]) >= 9, `mutant line: ${m && m[0]}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
