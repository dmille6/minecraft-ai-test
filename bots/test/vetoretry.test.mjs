// ONE RETRY AFTER A VETO: the model is told what was refused; a same-key retry never reaches the gate.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-veto'
const { vetoRetry, RETRYABLE, vetoFeedback } = await import('../src/vetoretry.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const prop = (skill, args) => ({ schemaValid: true, raw: JSON.stringify({ skill, args }), proposal: { skill, args, reason: 'r' } })
const veto = reason => ({ ok: false, reason, detail: `refused for ${reason}` })
function stubs (next, gate = () => ({ ok: true, skill: 'x', args: {} })) {
  const seen = { decide: [], check: 0 }
  return { seen, decide: async followUp => { seen.decide.push(followUp); return typeof next === 'function' ? next() : next }, check: p => { seen.check++; return gate(p) } }
}

await t('a non-retryable veto (a safety refusal) is not re-asked', async () => {
  const s = stubs(prop('explore', { blocks: 60 }))
  const r = await vetoRetry({ res: prop('goto', { x: 1, y: 2, z: 3 }), rejection: veto('outside_border'), decide: s.decide, check: s.check })
  assert.equal(r.retried, false); assert.equal(s.seen.decide.length, 0)
})
await t('the model is shown WHAT was refused and WHY, after its own answer', async () => {
  const s = stubs(prop('explore', { blocks: 60 }))
  await vetoRetry({ res: prop('gather', { block: 'sand', count: 1 }), rejection: veto('repeat_loop'), decide: s.decide, check: s.check })
  const [asst, user] = s.seen.decide[0]
  assert.equal(asst.role, 'assistant'); assert.match(asst.content, /"gather"/)
  assert.equal(user.role, 'user'); assert.match(user.content, /gather:\{"block":"sand","count":1\}/); assert.match(user.content, /repeat_loop/); assert.match(user.content, /DIFFERENT/)
})
await t('a retry that proposes the SAME key is refused WITHOUT calling the gate (probation/repeat state untouched)', async () => {
  const s = stubs(prop('gather', { count: 1, block: 'sand' }))   // same key, args in another order
  const r = await vetoRetry({ res: prop('gather', { block: 'sand', count: 1 }), rejection: veto('learned_avoid'), decide: s.decide, check: s.check })
  assert.equal(r.result, 'retry_same_key'); assert.equal(s.seen.check, 0); assert.equal(r.admitted, null)
})
await t('a different action the gate admits REPLACES the decision', async () => {
  const s = stubs(prop('goto', { x: 5, y: 64, z: 5 }), () => ({ ok: true, skill: 'goto', args: { x: 5, y: 64, z: 5 } }))
  const r = await vetoRetry({ res: prop('explore', { blocks: 60 }), rejection: veto('repeat_loop'), decide: s.decide, check: s.check })
  assert.equal(r.result, 'admitted'); assert.equal(r.admitted.skill, 'goto'); assert.equal(r.res.proposal.skill, 'goto'); assert.equal(r.rejection, null)
})
await t('a different action the gate ALSO vetoes leaves the ORIGINAL veto on the decision', async () => {
  const orig = veto('cooldown')
  const s = stubs(prop('craft', { item: 'stick' }), () => veto('learned_avoid'))
  const r = await vetoRetry({ res: prop('craft', { item: 'stone_pickaxe' }), rejection: orig, decide: s.decide, check: s.check })
  assert.equal(r.result, 'vetoed:learned_avoid'); assert.equal(r.rejection, orig); assert.equal(r.admitted, null); assert.equal(s.seen.check, 1)
})
await t('an invalid or failed retry leaves the original veto standing', async () => {
  const a = stubs({ schemaValid: false })
  assert.equal((await vetoRetry({ res: prop('explore', { blocks: 60 }), rejection: veto('repeat_loop'), decide: a.decide, check: a.check })).result, 'invalid')
  const b = stubs(() => { throw new Error('endpoint down') })
  const r = await vetoRetry({ res: prop('explore', { blocks: 60 }), rejection: veto('repeat_loop'), decide: b.decide, check: b.check })
  assert.equal(r.result, 'error'); assert.equal(r.admitted, null)
})
await t('the retryable set is exactly the reasons a different choice can answer', () => {
  assert.deepEqual([...RETRYABLE].sort(), ['bad_args', 'cooldown', 'deposit_item_missing', 'deposit_not_worth_it', 'learned_avoid', 'repeat_loop'])
  assert.match(vetoFeedback('k', { reason: 'r', detail: 'd' }), /saw_end/)
})
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
await t('WIRED: model proposals only (never a work order), the retry row, and decide() appends the follow-up', () => {
  const cog = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  assert.match(cog, /if \(!admitted && !order\) \{\s*const vr = await vetoRetry\(/)
  assert.match(cog, /kind: 'veto_retry'/)
  assert.match(cog, /if \(vr\.admitted\) \{ res = vr\.res; admitted = vr\.admitted; rejection = null \}/)
  const llm = strip(readFileSync(new URL('../src/llm.mjs', import.meta.url), 'utf8'))
  assert.match(llm, /\.\.\.\(Array\.isArray\(followUp\) \? followUp : \[\]\)/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
