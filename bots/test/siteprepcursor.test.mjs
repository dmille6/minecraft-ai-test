// THE SHOWCASE SITEPREP-02 FOLD: SP1's live cursor (28, written by siteprep-01's screen over a 76-candidate ranking) indexes a list
// siteprep-02's screen no longer makes (42 rank; the plot it can grade among them). Resumed as is, the search would skip the plots the
// new screen ranks first and could be refused for PREP.refileMs. A cursor carries the screen that wrote it (PREP.screen); another
// screen's (or none: siteprep-01's) restarts at 0. Behaviour of prepCursor + prepStep; one anchored mutant; the wiring.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const P = await import('../src/siteprep.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) } }
const SRC = new URL('../src/siteprep.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(SRC, 'utf8')
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
// SP1 as the record holds it at 12:5xZ (project-0_70_0.siteprep g8): no `screen` field
const SP1 = { id: 'SP1', state: 'filed', cursor: 28, why: 'pin_kept', requester: { plot: 'shrine', kind: 'shrine', n: 2, by: 'showcase-Alpha' }, verifyFails: 0, retires: 0 }
await t('the live SP1 (cursor 28, no screen: siteprep-01\'s) resumes at 0 under the new screen', () => {
  assert.strictEqual(P.PREP.screen, 2)
  assert.strictEqual(P.prepCursor(SP1), 0)
})
await t('POSITIVE CONTROL: a cursor written by this screen is kept; another screen\'s restarts', () => {
  assert.strictEqual(P.prepCursor({ ...SP1, screen: P.PREP.screen }), 28)
  assert.strictEqual(P.prepCursor({ ...SP1, screen: 1 }), 0)
  assert.strictEqual(P.prepCursor(null), 0)
})
await t('prepStep: pending writes the screen with the cursor (the next tick resumes there); one without a screen is not trusted', () => {
  const a = P.prepStep(SP1, { type: 'pending', cursor: 12, screen: P.PREP.screen, why: 'x' }, 1000)
  assert.strictEqual(a.cursor, 12); assert.strictEqual(P.prepCursor(a), 12)
  assert.strictEqual(P.prepCursor(P.prepStep(SP1, { type: 'pending', cursor: 5 }, 1000)), 0)
  // chosen and its back-offs are unchanged (verify_fail / retire: cursor + 1 of the request's own): a stale request chosen at once
  // and sent back re-searches from 0 under the new screen, as a fresh request (cursor 0) would from 1
  const b = P.prepStep(SP1, { type: 'chosen', plot: { box: [0, 0, 1, 1] }, zone: null }, 1000)
  assert.strictEqual(b.state, 'prepping')
  assert.strictEqual(P.prepCursor(P.prepStep(b, { type: 'retire', why: 'met' }, 2000)), 0)
})
await t('MUTANT KILLED: a cursor blind to the screen resumes SP1 at 28', async () => {
  await withMutant("(req?.screen === P.screen ? (Number(req?.cursor) || 0) : 0)", '(Number(req?.cursor) || 0)', async M => {
    assert.strictEqual(M.prepCursor(SP1), 28)
  })
})
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
await t('WIRED (skills.mjs): the keeper resumes from prepCursor; pending writes the screen', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(sk.includes("let ch = { ok: false, why: 'pending', cursor: prepCursor(q), tried: {} }"))
  assert.ok(sk.includes("{ type: 'pending', cursor: ch.cursor, screen: PREP.screen,"))
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
