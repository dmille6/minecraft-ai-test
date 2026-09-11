// THE COOLDOWN CANARY IS A CODE VERSION, NOT AN ENV EDIT.
//
// Two-thirds of a bot's life is the 30 s gap between decisions; the env files
// set LLM_DECISION_COOLDOWN_MS=30000 fleet-wide over a 20000 default. The
// canary clamps the value so the manifest and the tripper see a second code
// version on one pool, and so the change reverts by deploying the baseline.
import assert from 'node:assert'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.LLM_DECISION_COOLDOWN_MS = '30000'
const { config, COOLDOWN_CAP_MS } = await import('../src/config.mjs')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
t('an env cooldown of 30 s is clamped to the cap', () => {
  assert.equal(COOLDOWN_CAP_MS, 20000)
  assert.equal(config.llm.decisionCooldownMs, 20000)
})
t('the cap is a ceiling, not a floor', () => {
  // A shorter env value passes through unchanged; the canary never slows a bot.
  assert.equal(Math.min(15000, COOLDOWN_CAP_MS), 15000)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
