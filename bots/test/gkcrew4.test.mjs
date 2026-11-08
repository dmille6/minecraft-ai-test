// GKCREW4-01 (OWNER 11-08 in chat: "Yes, up to 4"): up to 4 groundskeeper helpers while the town's tidy stage has more than 500 open cells,
// back to the owner's 1-2 when smaller. gkcrewcut-01 live: tidy cuts 41.4/h (from ~17) with two helpers; the stage had ~2,500 open cells.
import assert from 'node:assert'
import fs from 'node:fs'
const GK = await import('../src/groundskeeper.mjs')
const W = await import('../src/gkwork.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  const src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  fs.writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { fs.unlinkSync(out) } catch {} }
}
const killedBy = async (file, real, old, neu, scenario) => {
  await scenario(real)
  let why = null
  await withMutant(file, old, neu, async M => { try { await scenario(M) } catch (err) { why = err } })
  assert.ok(why instanceof assert.AssertionError, `the mutant survived or died for another reason: ${why?.stack?.split('\n')[0] ?? 'survived'}`)
}
const GK_PATH = new URL('../src/groundskeeper.mjs', import.meta.url)
const NOW = Date.parse('2026-11-08T10:00:00Z')
const L = (holder, until = NOW + 600_000) => ({ rec: { holder }, holdsUntil: until, blocksUntil: until })

await t('helpersCap: > 500 open cells -> 4; 500 or fewer, or unknown -> the owner\'s 2; GKCREW4=0 -> 2', async () => {
  await killedBy(GK_PATH, GK, 'Number(open) > G.bigOpen ? G.helpersBig : G.helpersMax', 'Number(open) > G.bigOpen ? G.helpersMax : G.helpersMax', M => {
    assert.strictEqual(M.helpersCap(2502, { on: true }), 4)
  })
  assert.strictEqual(GK.helpersCap(500, { on: true }), 2)
  assert.strictEqual(GK.helpersCap(null, { on: true }), 2)
  assert.strictEqual(GK.helpersCap(2502, { on: false }), 2)
  assert.strictEqual(GK.crew4On({ GKCREW4: '0' }), false)
})
await t('LIVE 2,500 open: a 3rd and 4th helper take helper3/helper4; a 5th is full; at the small cap the 3rd is full', () => {
  const keeper = L('Echo'), big = { ...GK.GK, helpersMax: GK.helpersCap(2502, { on: true }) }
  const helpers = { helper1: L('Juno'), helper2: L('Kite') }
  assert.deepStrictEqual(GK.helperDecision({ keeper, helpers, me: 'Iris', now: NOW, G: big }), { d: 'take', name: 'helper3' })
  assert.deepStrictEqual(GK.helperDecision({ keeper, helpers: { ...helpers, helper3: L('Iris') }, me: 'Alpha', now: NOW, G: big }), { d: 'take', name: 'helper4' })
  assert.strictEqual(GK.helperDecision({ keeper, helpers: { ...helpers, helper3: L('Iris'), helper4: L('Alpha') }, me: 'Bravo', now: NOW, G: big }).d, 'full')
  assert.strictEqual(GK.helperDecision({ keeper, helpers, me: 'Iris', now: NOW, G: { ...GK.GK, helpersMax: 2 } }).d, 'full')
})
await t('the cap shrinks to 2: a helper4 holder keeps its own lease to its release (never a second take); new takes stop at 2', async () => {
  await killedBy(GK_PATH, GK, '  const mine = HELPER_LEASES.find(n => liveOf(helpers[n], now) && helpers[n].rec.holder === me)', '  const mine = names.find(n => liveOf(helpers[n], now) && helpers[n].rec.holder === me)', M => {
    const r = M.helperDecision({ keeper: L('Echo'), helpers: { helper1: L('Juno'), helper4: L('Alpha') }, me: 'Alpha', now: NOW, G: { ...M.GK, helpersMax: 2 } })
    assert.deepStrictEqual(r, { d: 'mine', name: 'helper4' })
  })
})
await t('openNewest: the newest count for this stage within 2 h; another stage or a stale count is unknown', () => {
  const files = [{ sig: 'A', open: 2502, at: NOW - 600_000 }, { sig: 'A', open: 2410, at: NOW - 60_000 }, { sig: 'B', open: 10, at: NOW }]
  assert.strictEqual(W.openNewest(files, 'A', NOW), 2410)
  assert.strictEqual(W.openNewest(files, 'C', NOW), null)
  assert.strictEqual(W.openNewest([{ sig: 'A', open: 9, at: NOW - 3 * 3600_000 }], 'A', NOW), null)
})
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = (s, sh) => {
  const one = (re, x = s) => { const m = x.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one('G: \\{ \\.\\.\\.GK, helpersMax: helpersCap\\(gkOpenNow\\(bot, dir, key, now\\)\\) \\}')
  one('openWrite\\(dir, key, me, rw, left\\.length \\+ prog\\.cutLeft\\)')
  one('builders: GROUNDS\\.on \\? 1 \\+ Math\\.max\\(GK\\.helpersMax, GK\\.helpersBig \\?\\? 0\\) : TIDY_BUILDERS', sh)
}
await t('crewState reads the scaled cap, the visit writes the open count, the tidy has 5 slots; a cut line fails', () => {
  const s = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')), sh = strip(fs.readFileSync(new URL('../src/shop.mjs', import.meta.url), 'utf8'))
  wiring(s, sh)
  const cut = 'openWrite(dir, key, me, rw, left.length + prog.cutLeft)'
  assert.ok(s.split(cut).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(s.replace(cut, ''), sh), assert.AssertionError)
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
