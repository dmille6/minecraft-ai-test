// GKCREWCUT-01 (control session 11-08, the grounds pace): showcase 04:47-08:50Z on the re-surveyed inside stage (2,619 fills, 1,106 cuts):
// 17 cuts and 4 fills an hour, the keeper the only bot allowed to dig the tidy's cuts (48 of 69); helper visits ended "nothing of the
// grounds is this helper's now" and let the helper lease go while 1,040 cuts waited. A helper now digs the cuts too (never a terrace's or a
// site prep's, never the record's tree clears), and a helper visit that dug one keeps its lease.
import assert from 'node:assert'
import fs from 'node:fs'
const GK = await import('../src/groundskeeper.mjs')

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

await t('crewCaps: a helper digs cuts (not the clears: digs, site, waive, complete stay the keeper\'s); GKCREWCUT=0 is gkhelpers-01 exactly', async () => {
  await killedBy(GK_PATH, GK, 'cuts: k || !!cutsOn,', 'cuts: k,', M => {
    assert.strictEqual(M.crewCaps('helper', true).cuts, true)
  })
  const h = GK.crewCaps('helper', true)
  assert.deepStrictEqual([h.digs, h.site, h.waive, h.complete], [false, false, false, false])
  assert.strictEqual(GK.crewCaps('keeper', false).cuts, true)
  assert.strictEqual(GK.crewCaps('helper', false).cuts, false)
  assert.strictEqual(GK.crewCutsOn({ GKCREWCUT: '0' }), false)
  assert.strictEqual(GK.crewCutsOn({}), true)
})
await t('LIVE helper visit "placed 0, cleared 2" is work: the helper keeps its lease; placed 0, cleared 0, gathered 0 lets it go', async () => {
  await killedBy(GK_PATH, GK, ' || (Number(r?.cleared) || 0) > 0', '', M => {
    assert.strictEqual(M.helperWorked({ placed: 0, cleared: 2 }), true)
  })
  assert.strictEqual(GK.helperWorked({ placed: 0, cleared: 0 }, 0), false)
  assert.strictEqual(GK.helperWorked({ placed: 1 }), true)
  assert.strictEqual(GK.helperWorked({}, 3), true)
})
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const wiring = s => {
  const one = re => { const m = s.match(new RegExp(re, 'g')); assert.strictEqual(m?.length, 1, `${re}: ${m?.length ?? 0}`) }
  one('const cuts = !\\(caps\\.digs \\|\\| \\(caps\\.cuts && !isTerrace && !prepNow\\)\\) \\|\\| floorOnly \\? \\[\\] :')
  one("if \\(helper && !helperWorked\\(r, gathered\\?\\.n \\?\\? 0\\)\\) \\{ releaseHelper\\(bot, helper\\.name, helper\\.gen, 'idle'\\)")
  one('if \\(!caps\\.digs\\) visitRec = helperRecord\\(visitRec\\)')
}
await t('wiring: the helper\'s cut list, its lease kept on a cut, the record\'s clears still dropped for a helper; a cut line fails', () => {
  const s = strip(fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  wiring(s)
  const cut = 'if (!caps.digs) visitRec = helperRecord(visitRec)'
  assert.ok(s.split(cut).length === 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.throws(() => wiring(s.replace(cut, '')), assert.AssertionError)
})
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
