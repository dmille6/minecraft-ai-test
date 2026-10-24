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
import { decide, MAX_GAP_S, abVerdict, fidelityProbes } from '../../sandbox/failmine/oracle.mjs'

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

// THE VERDICT (sandbox/failmine/oracle.mjs), by behaviour: an absence is a no-run, never a result (Claude r1 P1, Codex r1 P1)
const ESC = { type: 'escape', hold_s: 20 }
const SURV = { type: 'survive', fail_families: ['lava'] }
const alive = { deathsLog: 0, deathsScore: 0, deathFamily: null, deathCell: null, childExited: false, maxGapS: 3, lastSeenAgoS: 2,
  endHealth: 20, outHeldS: 0, inArenaEnd: true }
t('verdict: a live bot that stayed in the trap is the fleet\'s failure; one held out of it escaped', () => {
  assert.deepEqual(decide(ESC, alive), { outcome: 'stayed', pass: false, matched_fleet: true })
  assert.deepEqual(decide(ESC, { ...alive, outHeldS: 25 }), { outcome: 'escaped', pass: true, matched_fleet: false })
  assert.equal(decide(ESC, { ...alive, outHeldS: 25, inArenaEnd: false }).pass, false, 'out of the arena is not an escape')
})
t('verdict: a crashed, disconnected or unobserved bot is NO-RUN for both oracles (never stayed, never survived)', () => {
  for (const o of [ESC, SURV]) {
    for (const bad of [{ childExited: true }, { maxGapS: MAX_GAP_S + 1 }, { lastSeenAgoS: 30 }, { endHealth: 0 }, { endHealth: null }, { deathsScore: null }]) {
      const v = decide(o, { ...alive, ...bad })
      assert.equal(v.pass, null, `${o.type} ${JSON.stringify(bad)} -> ${v.outcome}`); assert.equal(v.matched_fleet, null)
    }
  }
})
t('verdict: a death the bot did not log (the server counter disagrees) is NO-RUN, not survived', () => {
  const v = decide(SURV, { ...alive, deathsScore: 1 })
  assert.equal(v.pass, null); assert.match(v.outcome, /counter says 1/)
})
t('verdict: a lava death matches the fleet only of the family AND near the fleet death (6 blocks)', () => {
  const d = { ...alive, deathsLog: 1, deathsScore: 1, deathFamily: 'lava', deathCell: [391, 70, 106] }
  assert.deepEqual(decide(SURV, d, { deathCell: [392, 70, 106] }), { outcome: 'died:lava', pass: false, matched_fleet: true })
  assert.equal(decide(SURV, d, { deathCell: [420, 70, 106] }).matched_fleet, false, 'a lava death elsewhere in the cut is not this one')
  assert.equal(decide(SURV, { ...d, deathFamily: 'fall' }, { deathCell: [392, 70, 106] }).matched_fleet, false, 'another family')
  assert.equal(decide(ESC, d, { deathCell: [392, 70, 106] }).matched_fleet, false, 'a death never reproduces a stuck scene')
  assert.equal(decide(SURV, { ...alive }).pass, true)
})

t('library gate: one draw, a base that reproduces once, or a base that passes is never a PASS (Codex r2 P2)', () => {
  const B = (m, p = false) => ({ matched_fleet: m, pass: p }), C = p => ({ pass: p })
  assert.equal(abVerdict([B(true)], [C(true)]).verdict, 'INVALID', 'a single draw')
  assert.equal(abVerdict([B(true), B(false), B(false)], [C(true), C(true), C(true)]).verdict, 'INVALID', 'base 1 of 3')
  assert.equal(abVerdict([B(true), B(true), B(false, true)], [C(true), C(true), C(true)]).verdict, 'INVALID', 'a base pass')
  assert.equal(abVerdict([B(true), B(true), B(false)], [C(true), C(true), C(true)]).verdict, 'PASS')
  assert.equal(abVerdict([B(true), B(true), B(true)], [C(true), C(false), C(true)]).verdict, 'FAIL')
  assert.equal(abVerdict([B(true), B(true), B(true)], [C(true), C(null), C(true)]).verdict, 'INVALID', 'a candidate no-run')
})
t('fidelity probes carry the FULL block state (a water level, a facing), for the named checks and the sample', () => {
  const S = { cells: { origin: [0, 40, 0], size: [2, 1, 1], palette: ['water[level=2]', 'ladder[facing=south,waterlogged=false]'], rle: [0, 1, 1, 1] },
    checks: [{ at: [1, 40, 0], is: 'ladder[facing=south,waterlogged=false]' }] }
  const p = fidelityProbes(S, 100, 200, 1)
  assert.deepEqual(p.map(q => [q.x, q.y, q.z, q.is]), [[101, 40, 200, 'ladder[facing=south,waterlogged=false]'], [100, 40, 200, 'water[level=2]'],
    [101, 40, 200, 'ladder[facing=south,waterlogged=false]']])
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
    // ADMISSION (failmine.py reproducing_starts): some start with >= 2 base runs matching the fleet, >= 2 of every 3, none passing
    const e = index.scenes.find(x => x.file === f)
    assert.ok(e.reproducing_starts.length >= 1, `${s.id}: no start reproduces the fleet's failure often enough (${JSON.stringify(base.map(p => [p.start_index, p.outcome]))})`)
    for (const st of e.reproducing_starts) {
      const ps = base.filter(p => (p.start_index ?? 0) === st && p.matched_fleet !== null)
      const m = ps.filter(p => p.matched_fleet === true).length
      assert.ok(m >= 2 && m / ps.length >= 2 / 3, `${s.id} start ${st}: ${m} of ${ps.length}`)
      assert.ok(!ps.some(p => p.pass === true), `${s.id} start ${st}: a base run PASSED -- the scene no longer holds the failure`)
    }
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
