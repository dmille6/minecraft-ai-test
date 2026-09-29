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
await t('a COUNT-only change and the gather item->block alias are the SAME action (refused without the gate)', async () => {
  const a = stubs(prop('gather', { block: 'oak_log', count: 16 }))
  assert.equal((await vetoRetry({ res: prop('gather', { block: 'oak_log', count: 8 }), rejection: veto('repeat_loop'), decide: a.decide, check: a.check })).result, 'retry_same_key')
  const b = stubs(prop('gather', { item: 'minecraft:OAK_LOG', count: 8 }))
  assert.equal((await vetoRetry({ res: prop('gather', { block: 'oak_log', count: 8 }), rejection: veto('learned_avoid'), decide: b.decide, check: b.check })).result, 'retry_same_key')
  assert.equal(a.seen.check + b.seen.check, 0)
  const c = stubs(prop('explore', { blocks: 120 }))
  assert.equal((await vetoRetry({ res: prop('explore', { blocks: 60 }), rejection: veto('repeat_loop'), decide: c.decide, check: c.check })).result, 'retry_same_key')
})

// ---- THE REAL GATE (Claude review: stubs hid the double count) ----
const { AdmissionControl } = await import('../src/admission.mjs')
const { createRequire } = await import('node:module')
const registry = createRequire(import.meta.url)('prismarine-registry')('1.21.8')
function gate () {
  const blocked = {}
  const lessons = { failCount: (skill, args) => (['stick', 'oak_planks'].includes(args?.item) ? 6 : 0), bumpBlocked: k => (blocked[k] = (blocked[k] ?? 0) + 1), entryFor: () => null }
  return new AdmissionControl(lessons)
}
const bot = { registry, inventory: { items: () => [] }, entity: { position: { x: 0, y: 64, z: 0 } } }
const A = { skill: 'craft', args: { item: 'stick', count: 1 } }, B = { skill: 'craft', args: { item: 'oak_planks', count: 1 } }
const seq = (retryOpt) => { const g = gate(); const out = []
  for (let i = 0; i < 8; i++) {
    const a = g.check({ ...A, args: { ...A.args } }, bot); out.push(a.ok ? (a.kind ?? 'ok') : a.reason)
    if (retryOpt !== 'none' && !a.ok) g.check({ ...B, args: { ...B.args } }, bot, null, retryOpt === 'retry' ? { retry: true } : {})
  }
  return out }
await t('REAL GATE: retries leave the ORIGINAL action\'s probation/streak sequence exactly as with no retries', () => {
  const base = seq('none'), withRetry = seq('retry')
  assert.deepEqual(withRetry, base)
  assert.ok(base.includes('learned_avoid'), `the sequence must include vetoes: ${base}`)
})
await t('POSITIVE CONTROL: the same retries WITHOUT the retry option DO change the sequence (the double count)', () => {
  assert.notDeepEqual(seq('plain'), seq('none'))
})
await t('REAL GATE: a retry on a learned-blocked key is refused and never forced or put on probation', () => {
  const g = gate(); g.vetoStreak = 99
  for (let i = 0; i < 10; i++) { const r = g.check({ ...B, args: { ...B.args } }, bot, null, { retry: true }); assert.equal(r.ok, false); assert.equal(r.reason, 'learned_avoid') }
  assert.equal(g.vetoStreak, 99); assert.equal(g.forcedAdmissions ?? 0, 0)
})

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
await t('WIRED: model proposals only (never a work order), the retry row, and decide() appends the follow-up', () => {
  const cog = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  assert.match(cog, /if \(!admitted && !order\) \{\s*const vr = await vetoRetry\(/)
  assert.match(cog, /kind: 'veto_retry'/)
  assert.match(cog, /if \(vr\.admitted\) \{ res = vr\.res; admitted = vr\.admitted; rejection = null \}/)
  assert.match(cog, /this\.admission\.check\(p, this\.bot, this\.#wantedItems\(milestone\), \{ retry: true \}\)/, 'the retry is checked with { retry: true }')
  const llm = strip(readFileSync(new URL('../src/llm.mjs', import.meta.url), 'utf8'))
  assert.match(llm, /\.\.\.\(Array\.isArray\(followUp\) \? followUp : \[\]\)/)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
