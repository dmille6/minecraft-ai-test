// ROUGHFILL-01 (11-08 showcase: the re-sited inside tidy stage, 04:47-13:32Z, 176 cuts against 29 fills): two causes, both fixed here.
//   1. THE BILL was the stage's open fills (2,619), never one visit's: every visit asked the yard for cobblestone (74 draws, ~45 s
//      each for ~5 blocks, a quarter of the tidy visit time) while bags spared a median 52 -- the draw, the walk back, the deadline.
//   2. A TOPSOIL cell read "dirt held" from the raw count while the placer's keep said none: the visit reached it and stopped
//      no_material "topsoil for T-00-0", losing every later fill of the visit.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const T = await import('../src/tidy.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 5).join('\n        ')}`) }
}
const TIDY = new URL('../src/tidy.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

const billFor = (W, cap) => W.fillWant({ open: 2619, openAccess: 0, dirt: 0, cobble: 52, visitCap: cap })

await t('the live case: 2,619 open fills, 52 spare cobblestone -> nothing to draw (one visit is covered by the bag)', () => {
  assert.strictEqual(billFor(T, T.TIDY_VISIT_FILLS), 0)
  assert.strictEqual(T.fillWant({ open: 2619, openAccess: 0, dirt: 0, cobble: 52 }), 2567, 'positive control: no cap, the stage bill (the live behaviour)')
})
await t('a bag short of one visit draws only the visit\'s shortfall', () => {
  assert.strictEqual(T.fillWant({ open: 2619, dirt: 4, cobble: 10, visitCap: 32 }), 18)
  assert.strictEqual(T.fillWant({ open: 5, dirt: 0, cobble: 0, visitCap: 32 }), 5, 'fewer open than the cap: the open count')
})
await t('the stairs share the visit cap after the earth (stone only, never the spare dirt)', () => {
  assert.strictEqual(T.fillWant({ open: 32, openAccess: 6, dirt: 32, cobble: 0, visitCap: 32 }), 6, 'a full visit of earth on dirt: the 6 steps still billed (Codex r1)')
  assert.strictEqual(T.fillWant({ open: 100, openAccess: 6, dirt: 0, cobble: 0, visitCap: 32 }), 38, 'earth 32 + steps 6')
  assert.strictEqual(T.fillWant({ open: 0, openAccess: 3, dirt: 3, cobble: 0, visitCap: 32 }), 3)
})
await t('no cap given: the bill as before (access tests)', () => {
  assert.strictEqual(T.fillWant({ open: 4, openAccess: 0, dirt: 1, cobble: 1 }), 2)
  assert.strictEqual(T.fillWant({ open: 2, openAccess: 3, dirt: 2, cobble: 1 }), 2)
})
await t('mutant: the cap dropped -> the live stage bill comes back', async () => {
  await withMutant(TIDY, 'const o = Math.min(Math.max(0, open), cap)', 'const o = Math.max(0, open)', W => assert.strictEqual(billFor(W, 32), 2567))
})
await t('mutant: the stairs squeezed by the earth (the r1 shape) -> a full visit bills no steps', async () => {
  await withMutant(TIDY, 'const oa = Math.min(Math.max(0, openAccess), cap)', 'const oa = Math.min(Math.max(0, openAccess), Math.max(0, cap - o))', W => assert.strictEqual(W.fillWant({ open: 32, openAccess: 6, dirt: 32, cobble: 0, visitCap: 32 }), 0))
})
await t('topsoil: a bag sparing no topsoil block reads the cell done; one spare dirt (or grass) lays it', () => {
  const q = { role: 'topsoil', at: [0, 64, 0] }
  assert.strictEqual(T.soilSkip(q, () => false), true)
  assert.strictEqual(T.soilSkip(q, n => n === 'dirt'), false)
  assert.strictEqual(T.soilSkip(q, n => n === 'grass_block'), false)
  assert.strictEqual(T.soilSkip({ role: 'earth', at: [0, 64, 0] }, () => false), false, 'never an earth cell (cobble may fill it)')
})
await t('mutant: topsoil skip on another role -> the earth cells would be passed', async () => {
  await withMutant(TIDY, "q.role === 'topsoil' && !soil.some", "q.role !== 'nothing' && !soil.some", W => assert.strictEqual(W.soilSkip({ role: 'earth' }, () => false), true))
})
await t('wired: the tidy bill passes the visit cap; noSoil reads the placer (effects.has), never the raw count', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.strictEqual((sk.match(/cobble: spare\('cobblestone'\), visitCap: TIDY_VISIT_FILLS \}\)/g) ?? []).length, 1)
  assert.ok(/const wantSoil = Math\.max\(0, Math\.min\(openSoil, TIDY_VISIT_FILLS\) - spare\('dirt'\)\)/.test(sk))
  assert.ok(/const noSoil = q => soilSkip\(q, n => !!effects\?\.has\?\.\(n\)\)/.test(sk))
  assert.ok(!/noSoil = q => q\.role === 'topsoil' && countItem\(bot, 'dirt'\)/.test(sk), 'the raw count is gone')
})

console.log(`\nroughfill: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
