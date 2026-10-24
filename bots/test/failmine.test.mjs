// FAILMINE (2026-10-24): the failure-mining pipeline's tests run inside the ONE test command (CLAUDE.md), and the scene
// LIBRARY is held to its contract here. docs/reports/failmine-2026-10-24.md.
//
//   1. scripts/host/failmine/test_failmine.py -- behaviour, blind input (a renamed death kind, missing positions, a
//      missing region...) and its anchored source mutants. It is python because the tool is; it runs here so `npm test`
//      cannot be green while it is red.
//   2. sandbox/scenes/: every scene validates through failmine.py's OWN validator (one implementation of the contract),
//      INDEX.json names exactly the files on disk, and every scene carries a BASE PROOF: at least one run of the base
//      build whose outcome matched the fleet's failure and NO base run that passed. A scene whose base passes has stopped
//      being the failure (the world or the code moved): it is a positive control that no longer controls anything.
//   3. the driver goes through the shared sandbox lock under its own tag (structural: behaviour cannot reach a lock check
//      from here without a sandbox; the anchor is the executable line, comments stripped, and a mutant shows it can fail).
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FM = path.join(REPO, 'scripts/host/failmine/failmine.py')
const LIB = path.join(REPO, 'sandbox/scenes')
const DRIVER = path.join(REPO, 'sandbox/failmine/scene-e2e.mjs')

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

t('test_failmine.py: every behaviour test passes and every mutant is killed', () => {
  const r = spawnSync('python3', ['-B', path.join(REPO, 'scripts/host/failmine/test_failmine.py')], { encoding: 'utf8', timeout: 110_000 })
  const out = (r.stdout || '') + (r.stderr || '')
  assert.equal(r.status, 0, out.split('\n').filter(l => /FAIL|SURVIVED|Error|ANCHOR/.test(l)).slice(0, 8).join('\n') || out.slice(-800))
  const m = /(\d+) of (\d+) mutants killed/.exec(out)
  assert.ok(m && m[1] === m[2] && Number(m[2]) >= 15, `mutant line: ${m && m[0]}`)
  assert.match(out, /(\d+) of \1 passed/)
})

const files = existsSync(LIB) ? readdirSync(LIB).filter(f => f.endsWith('.json') && f !== 'INDEX.json').sort() : []
const index = existsSync(path.join(LIB, 'INDEX.json')) ? JSON.parse(readFileSync(path.join(LIB, 'INDEX.json'), 'utf8')) : null

t('the library is not vacuous: INDEX.json exists and names at least the three first scene classes', () => {
  // POSITIVE CONTROL for the two checks below: without scenes they would pass forever
  assert.ok(index && Array.isArray(index.scenes), 'sandbox/scenes/INDEX.json missing')
  assert.ok(files.length >= 3, `only ${files.length} scene files`)
  const fams = new Set(index.scenes.map(s => s.family))
  for (const f of ['stuck', 'fall', 'lava']) assert.ok(fams.has(f), `no ${f} scene in the library`)
})

t('INDEX.json names exactly the scene files on disk, with their ids and cells hashes', () => {
  assert.deepEqual(index.scenes.map(s => s.file).sort(), files)
  for (const e of index.scenes) {
    const s = JSON.parse(readFileSync(path.join(LIB, e.file), 'utf8'))
    assert.equal(s.id, e.id, e.file); assert.equal(s.cells_sha256, e.cells_sha256, e.file); assert.equal(s.family, e.family, e.file)
  }
})

for (const f of files) {
  t(`${f}: validates through failmine.py, and the base build fails the way the fleet does (and never passes)`, () => {
    const r = spawnSync('python3', ['-B', FM, 'validate', path.join(LIB, f)], { encoding: 'utf8' })
    assert.equal(r.status, 0, (r.stderr || r.stdout).slice(-400))
    const s = JSON.parse(readFileSync(path.join(LIB, f), 'utf8'))
    const base = (s.proof || []).filter(p => p.role === 'base')
    assert.ok(base.some(p => p.matched_fleet === true), `${s.id}: no base run reproduced the fleet's failure (${JSON.stringify(base.map(p => p.outcome))})`)
    assert.ok(!base.some(p => p.pass === true), `${s.id}: a base run PASSED the oracle -- the scene no longer holds the failure`)
    for (const p of base) assert.ok(p.fidelity && p.fidelity.share >= 0.98 && !p.fidelity.checksFailed?.length, `${s.id}: a base proof on an arena that did not set`)
  })
}

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
const WIRED = /\bsbx\.requireSandboxLock\(SERVER, 'failmine'\)/
t("the driver is wired to the shared sandbox lock under the tag 'failmine' (and the check can fail)", () => {
  const code = strip(readFileSync(DRIVER, 'utf8'))
  assert.match(code, WIRED)
  assert.match(code, /require\('\.\.\/lib\/sbxlock\.cjs'\)/)
  const anchor = "sbx.requireSandboxLock(SERVER, 'failmine')"
  assert.equal(code.split(anchor).length - 1, 1, 'anchor missing or not unique')
  // MUTANT: the same source with the call commented out must fail the check (a comment that quotes it does not count)
  assert.doesNotMatch(strip(readFileSync(DRIVER, 'utf8').replace(anchor, `// ${anchor}`)), WIRED)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
