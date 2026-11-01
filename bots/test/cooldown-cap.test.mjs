// COOLDOWN15 (cooldown15-01, 11-01): the decision cooldown is capped at 15 s IN CODE.
//
// Every fleet env file sets LLM_DECISION_COOLDOWN_MS=30000. A canary must be a code version the manifest and the
// tripper can see, so the cap lives in config.mjs; LLM_DECISION_COOLDOWN_CAP_MS is the one-number rollback.
// Each case imports config.mjs in a fresh node process with that case's env, because config reads env at import.
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'   // config.mjs requires it at import
const { cappedCooldownMs, COOLDOWN_CAP_DEFAULT_MS } = await import('../src/config.mjs')

const CONFIG = fileURLToPath(new URL('../src/config.mjs', import.meta.url))
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

function loaded(env, path = CONFIG) {
  const base = { ...process.env, OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct' }
  delete base.LLM_DECISION_COOLDOWN_MS; delete base.LLM_DECISION_COOLDOWN_CAP_MS
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const { config } = await import(${JSON.stringify(path)}); console.log(String(config.llm.decisionCooldownMs))`],
  { env: { ...base, ...env }, encoding: 'utf8' })
  return Number(out.trim().split('\n').pop())
}

t('the fleet env (30 s) runs at 15 s', () => {
  assert.equal(COOLDOWN_CAP_DEFAULT_MS, 15000)
  assert.equal(loaded({ LLM_DECISION_COOLDOWN_MS: '30000' }), 15000)
})
t('the cap is a ceiling, not a floor: a shorter env value passes through (tests run at 50 ms)', () => {
  assert.equal(loaded({ LLM_DECISION_COOLDOWN_MS: '50' }), 50)
  assert.equal(loaded({ LLM_DECISION_COOLDOWN_MS: '12000' }), 12000)
})
t('no env at all: the 20 s default is capped to 15 s', () => {
  assert.equal(loaded({}), 15000)
})
t('rollback by one number: LLM_DECISION_COOLDOWN_CAP_MS=30000 restores the 30 s env value', () => {
  assert.equal(loaded({ LLM_DECISION_COOLDOWN_MS: '30000', LLM_DECISION_COOLDOWN_CAP_MS: '30000' }), 30000)
})
t('a broken cap is ignored (never a tight loop): empty, zero, negative, text -> the env value stands', () => {
  for (const bad of ['', '0', '-5', 'abc']) assert.equal(cappedCooldownMs('30000', bad), 30000, `cap ${JSON.stringify(bad)}`)
  assert.equal(cappedCooldownMs('nonsense', '15000'), 15000)
  assert.equal(cappedCooldownMs(30000, 15000), 15000)
})

// ---- the cap must be WIRED into config.llm.decisionCooldownMs, not only exported ----
t('MUTANT KILLED: config read without the cap runs the 30 s env value', () => {
  const src = readFileSync(CONFIG, 'utf8')
  const old = "decisionCooldownMs: cappedCooldownMs(req('LLM_DECISION_COOLDOWN_MS', '20000'),"
  assert.equal(src.split(old).length - 1, 1, 'ANCHOR MISSING OR NOT UNIQUE')
  const mutated = src.replace(old, "decisionCooldownMs: ((a) => Number(a))(req('LLM_DECISION_COOLDOWN_MS', '20000'),")
  const tmp = join(tmpdir(), `cooldown-cap-mutant-${process.pid}.mjs`)   // config.mjs has no relative imports; never write into src/ (srcDigest hashes it)
  writeFileSync(tmp, mutated)
  try {
    assert.equal(loaded({ LLM_DECISION_COOLDOWN_MS: '30000' }, tmp), 30000, 'the mutant should run uncapped')
  } finally {
    try { execFileSync('rm', ['-f', tmp]) } catch {}
  }
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
