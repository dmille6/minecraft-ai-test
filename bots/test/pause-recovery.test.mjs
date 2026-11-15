// PAUSE30 (pause30-01, 11-04): the runner's repeated-failure pause defaults to 30 s, not 120 s.
//
// No fleet env file sets PAUSE_RECOVERY_MS, so the default in config.mjs IS the fleet value; PAUSE_RECOVERY_MS=120000
// is the one-number rollback. Each config case imports config.mjs in a fresh node process with that case's env,
// because config reads env at import.
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'   // config.mjs requires it at import
const { resolvePauseRecoveryMs, PAUSE_RECOVERY_DEFAULT_MS } = await import('../src/config.mjs')
const { pauseWaitDecision, fewerDecConfig } = await import('../src/fewerdec.mjs')

const CONFIG = fileURLToPath(new URL('../src/config.mjs', import.meta.url))
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

function loaded(env, path = CONFIG) {
  const base = { ...process.env, OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct' }
  delete base.PAUSE_RECOVERY_MS
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const { config } = await import(${JSON.stringify(path)}); console.log(String(config.skills.pauseRecoveryMs))`],
  { env: { ...base, ...env }, encoding: 'utf8' })
  return Number(out.trim().split('\n').pop())
}

function withMutant(old, replacement, fn) {
  const src = readFileSync(CONFIG, 'utf8')
  assert.equal(src.split(old).length - 1, 1, `ANCHOR MISSING OR NOT UNIQUE: ${old}`)
  const tmp = join(tmpdir(), `pause-recovery-mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(tmp, src.replace(old, replacement))   // config.mjs has no relative imports; never write into src/ (srcDigest hashes it)
  try { fn(tmp) } finally { try { rmSync(tmp, { force: true }) } catch {} }
}

t('no env (the fleet: no env file sets PAUSE_RECOVERY_MS): the pause is 30 s', () => {
  assert.equal(PAUSE_RECOVERY_DEFAULT_MS, 30000)
  assert.equal(loaded({}), 30000)
})
t('rollback by one number: PAUSE_RECOVERY_MS=120000 restores the 120 s pause', () => {
  assert.equal(loaded({ PAUSE_RECOVERY_MS: '120000' }), 120000)
})
t('any positive env value passes through (fewerdec.test runs at 600 ms)', () => {
  assert.equal(loaded({ PAUSE_RECOVERY_MS: '600' }), 600)
  assert.equal(resolvePauseRecoveryMs('45000'), 45000)
  assert.equal(resolvePauseRecoveryMs(' 90000 '), 90000)
})
t('an invalid value falls back to the 30 s default, never NaN (a NaN pause never ends) and never 0', () => {
  for (const bad of [undefined, null, '', '   ', '0', '-5', 'abc', '120,000', 'NaN', 'Infinity', '-Infinity']) {
    const v = resolvePauseRecoveryMs(bad)
    assert.equal(v, 30000, `env ${JSON.stringify(bad)} -> ${v}`)
  }
  assert.equal(loaded({ PAUSE_RECOVERY_MS: 'abc' }), 30000, 'end to end through config.mjs')
  assert.equal(loaded({ PAUSE_RECOVERY_MS: '' }), 30000, 'an empty assignment in an env file')
})
t('composition: PAUSEWAIT wakes when the 30 s pause ends, not at its 60 s wake cap', () => {
  const cfg = fewerDecConfig({})
  const d = pauseWaitDecision({ cfg, trigger: 'idle', paused: true, pausedAt: 0, now: 0, recoveryMs: resolvePauseRecoveryMs(undefined) })
  assert.equal(d.skip, true)
  assert.equal(d.wakeInMs, 30000 + cfg.pauseMarginMs)
  assert.equal(pauseWaitDecision({ cfg, trigger: 'idle', paused: true, pausedAt: 0, now: 30000, recoveryMs: 30000 }).skip, false,
    'at 30 s the pause is over and the model is asked again')
})

// ---- mutants: the default must be WIRED into config.skills.pauseRecoveryMs, and the guard must hold ----
t('MUTANT KILLED: the old wiring (Number(req(..., 120000))) runs a 120 s pause', () => {
  withMutant("pauseRecoveryMs: resolvePauseRecoveryMs(process.env.PAUSE_RECOVERY_MS),",
    "pauseRecoveryMs: Number(process.env.PAUSE_RECOVERY_MS ?? '120000'),", tmp => {
      assert.equal(loaded({}, tmp), 120000, 'the mutant should run the old 120 s')
      assert.notEqual(loaded({}, tmp), loaded({}), 'the real file differs from the mutant')
    })
})
t('MUTANT KILLED: without the finite/positive guard, text makes a NaN pause', () => {
  withMutant('return Number.isFinite(n) && n > 0 ? n : PAUSE_RECOVERY_DEFAULT_MS',
    'return n', tmp => {
      assert.ok(Number.isNaN(loaded({ PAUSE_RECOVERY_MS: 'abc' }, tmp)), 'the mutant should yield NaN')
      assert.equal(loaded({ PAUSE_RECOVERY_MS: 'abc' }), 30000, 'the real file falls back')
    })
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
