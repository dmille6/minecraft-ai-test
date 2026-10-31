// STALLCHECK (OWNER 2026-10-31: "Let's build a monitoring check so this doesn't happen again"). The owner-commitments ledger
// (config/owner-commitments.json) and the hourly stall detectors (scripts/host/stallcheck.py) are tested here so `npm test`
// cannot be green while they are red.
//
//   1. scripts/host/test_stallcheck.py: every detector FIRES on a seeded case and stays QUIET on a clean one, an end-to-end
//      run over a real git origin, the wiring (fleetstatus header, the Codex audit prompt, the cron installer), the committed
//      ledger and monitor registry validate, and every anchored mutant is killed.
//   2. every memory file the ledger names EXISTS in the owner's memory dir. That dir lives only on the Mac (the control
//      machine); elsewhere (the canary host's preflight) this part reports SKIP and stallcheck's (m) detector covers it from
//      the list opsaudit.sh pushes daily.
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MEM = path.join(homedir(), '.claude/projects/-Users-darrellmiller-Documents-code-minecraft-ai/memory')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

t('test_stallcheck.py: detectors fire and stay quiet, e2e, wiring, config, every mutant killed', () => {
  const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/test_stallcheck.py')], { encoding: 'utf8', timeout: 110_000 })
  const out = (r.stdout || '') + (r.stderr || '')
  assert.equal(r.status, 0, out.split('\n').filter(l => /FAIL|SURVIVED|Error|ANCHOR/.test(l)).slice(0, 8).join('\n') || out.slice(-800))
  const m = /mutants killed (\d+)\/(\d+)/.exec(out)
  assert.ok(m && m[1] === m[2] && Number(m[2]) >= 15, `mutant line: ${m && m[0]}`)
})

const ledger = JSON.parse(readFileSync(path.join(REPO, 'config/owner-commitments.json'), 'utf8'))
const named = [...new Set(ledger.items.flatMap(i => i.memory || []))]

t('the ledger names memory files (positive control for the existence check below)', () => {
  assert.ok(named.length >= 10, `only ${named.length} memory files named`)
})

if (existsSync(path.join(MEM, 'MEMORY.md'))) {
  t('every memory file the ledger names exists in the owner memory dir', () => {
    const missing = named.filter(m => !existsSync(path.join(MEM, m)))
    assert.deepEqual(missing, [], `ledger rows name memory files that do not exist: ${missing.join(', ')}`)
  })
  t('every memory_no_row entry exists too', () => {
    const missing = Object.keys(ledger.memory_no_row || {}).filter(m => !existsSync(path.join(MEM, m)))
    assert.deepEqual(missing, [])
  })
} else {
  console.log(`  SKIP  memory-file existence: ${MEM} is not on this machine (the Mac only); stallcheck (m) covers it`)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
