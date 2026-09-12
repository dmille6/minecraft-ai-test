// THE STAIR HOLDS THE BODY, TYPED, AND ONLY WHILE IT IS CUTTING.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const RAW = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
const mineBody = () => { const i = RAW.indexOf('async function mine(ctx'); const j = RAW.indexOf('\nasync function ', i + 10); return RAW.slice(i, j > 0 ? j : i + 20000) }
t('mine takes a stair claim before its step loop, renews it every step, and releases it in a finally', () => {
  const b = mineBody()
  const c = b.indexOf("runner?.claimBody?.('stair')"), w = b.indexOf('while (bot.entity.position.y > goalY + 1'), r = b.indexOf('stairClaim?.renew?.()'), f = b.indexOf('finally { stairClaim?.release?.() }')
  assert.ok(c > 0 && w > c, 'the claim is taken before the loop')
  assert.ok(r > w, 'the claim is renewed inside the loop')
  assert.ok(f > r, 'the claim is released in a finally after the loop')
  assert.match(b, /const \{ bot, runner \} = ctx/, 'mine reads the runner from ctx')
})
t('a failed arrival EXITS the loop (returns unverified) rather than continuing under the claim (Codex: preserve the failed-arrival exit)', () => {
  const b = mineBody()
  const fa = b.indexOf("kind: 'mine_stair_step_failed'")
  assert.ok(fa > 0, 'the failed-arrival mark exists')
  const after = b.slice(fa, fa + 900)
  assert.match(after, /return \{\s*status: 'unknown', failClass: 'unverified'/, 'a failed arrival must return, not continue')
  assert.ok(!/\bcontinue\b/.test(after.slice(0, after.indexOf('return {'))), 'no continue between the failed-arrival mark and its return')
})
t("MUTANT: turning the failed-arrival return into a continue is caught", () => {
  const anchor = "kind: 'mine_stair_step_failed'"
  const i = RAW.indexOf(anchor); const seg = RAW.slice(i, i + 900); const j = seg.indexOf("return {")
  assert.ok(i > 0 && j > 0, 'ANCHOR MISSING')
  const mutant = RAW.slice(0, i) + seg.slice(0, j) + 'continue; return {' + seg.slice(j + 8) + RAW.slice(i + 900)
  const mb = (() => { const k = mutant.indexOf('async function mine(ctx'); return mutant.slice(k, k + 20000) })()
  const fa = mb.indexOf(anchor); const after = mb.slice(fa, fa + 900)
  assert.ok(/\bcontinue\b/.test(after.slice(0, after.indexOf('return {'))), 'the mutant must be visible as a continue before the return')
})
t("MUTANT: dropping the release is caught", () => {
  const anchor = 'finally { stairClaim?.release?.() }'
  assert.equal(RAW.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  assert.ok(!/finally \{ stairClaim\?\.release\?\.\(\) \}/.test(RAW.replace(anchor, 'finally { }')))
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
