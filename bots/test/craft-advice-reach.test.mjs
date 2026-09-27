// THE FLEET IS TOLD 1,415 TIMES A DAY TO FETCH A BLOCK IT HAS NEVER ONCE OBTAINED.
//
// `cobbled_deepslate`: ZERO ever gathered. `cobblestone`: 7.3% of 2,723 attempts. And the advice
// names the first one.
//
// I FIRST REPORTED THIS AS AN ALPHABETICAL SORT BUG AT THE rootGap LINE AND THAT WAS WRONG. An
// independent review refuted it by mutant: rootGap is the FINAL blocker list and every member of it
// is printed, so sorting it changes word order in one sentence and nothing else. Alphabetically
// `blackstone` would win anyway; the fleet sees `cobbled_deepslate`, which is index 0 of what
// minecraft-data returns. The choice is made in `better()` at the recipe-selection site, where every
// clause is strict, so a tie keeps registry order.
//
// The tiebreak added is a fact about Minecraft, not about this fleet: blackstone is Nether-only and
// all 16 worlds are overworld; deepslate cannot exist at y >= 0, which this file already knows in
// `depthVariant`. Deliberately NOT the fleet's success history, which lives in a HIVE-SHARED store
// and would make the ordering differ by arm.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { sourceReachCost, gapReachCost, NETHER_ONLY } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const ta = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

t('a surface bot cannot reach deepslate, and nobody can reach blackstone in the overworld', () => {
  assert.equal(sourceReachCost('cobblestone', 64), 0, 'stone is everywhere')
  assert.equal(sourceReachCost('cobbled_deepslate', 64), 1, 'deepslate does not exist at y>=0')
  assert.equal(sourceReachCost('cobbled_deepslate', -40), 0, 'below y=0 it is the reachable one')
  assert.equal(sourceReachCost('deepslate', 0), 1, 'y=0 is not below y=0')
  assert.equal(sourceReachCost('blackstone', 64), 2, 'Nether-only, and every fleet world is overworld')
  assert.equal(sourceReachCost('blackstone', 64, 'the_nether'), 0, 'in the Nether it is ordinary')
  assert.equal(sourceReachCost('oak_log', 64), 0)
})

t('the count prefix does not defeat the lookup', () => {
  // gaps arrive as "3x cobbled_deepslate", not as a bare name
  assert.equal(sourceReachCost('3x cobbled_deepslate', 64), 1)
  assert.equal(sourceReachCost('12x blackstone', 64), 2)
  assert.equal(gapReachCost(['3x cobbled_deepslate', '2x stick'], 64), 1, 'a gap is as bad as its worst member')
  assert.equal(gapReachCost(['3x cobblestone', '2x stick'], 64), 0)
  assert.equal(gapReachCost([], 64), 0, 'an empty gap is free')
})

t('NETHER_ONLY does not accidentally contain an overworld staple', () => {
  for (const staple of ['cobblestone', 'stone', 'dirt', 'oak_log', 'deepslate', 'cobbled_deepslate', 'iron_ore']) {
    assert.ok(!NETHER_ONLY.has(staple), `${staple} must not be treated as Nether-only`)
  }
  assert.ok(NETHER_ONLY.has('blackstone'))
})

// STRUCTURAL, and legitimate: the ordering of clauses inside `better` cannot be reached from
// outside without a live registry, and the ORDER is the whole change.
t('the reachability clause sits inside better(), after affinity and before the wood preference', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  const b = src.indexOf('const better = (g, b) =>')
  assert.ok(b > 0, 'better() is not there')
  const body = src.slice(b, b + 520)
  assert.ok(/reach\(g\) < reach\(b\)/.test(body), 'the reachability clause is not in better()')
  const iAff = body.indexOf('affinity(g) === affinity(b) && reach(g) < reach(b)')
  const iCan = body.indexOf('canonical(g) > canonical(b)')
  assert.ok(iAff > 0, 'reach must be gated on affinity being equal, or it overrides affinity')
  assert.ok(iCan > iAff, 'the wood preference must decide only AFTER reachability')
})

t('rootGap dedupes by ITEM, so the lessons key cannot move with the missing quantity', () => {
  const src = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.ok(!/\[\.\.\.new Set\(blockedBy\)\]/.test(src),
    'still deduping the whole string: "2x oak_planks" and "3x oak_planks" both survive')
  assert.ok(/byItem\.set\(item, \{ n, text: b \}\)/.test(src), 'the per-item map is not built')
})

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))} absent — a mutant never written reads as killed`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const SK = new URL('../src/skills.mjs', import.meta.url)

await ta('MUTANT KILLED: dropping the depth tier makes deepslate look reachable from the surface', async () => {
  await withMutant(SK,
    "  if (/(^|_)deepslate(_|$)/.test(n) || n === 'cobbled_deepslate') return y < 0 ? 0 : 1",
    "  if (/(^|_)deepslate(_|$)/.test(n) || n === 'cobbled_deepslate') return 0",
    async m => {
      assert.equal(m.sourceReachCost('cobbled_deepslate', 64), 0,
        'the mutant is not reproducing the defect; this test proves nothing')
    })
})

await ta('MUTANT KILLED: dropping the dimension tier makes blackstone look reachable in the overworld', async () => {
  await withMutant(SK,
    "  if (NETHER_ONLY.has(n)) return dimension === 'the_nether' ? 0 : 2",
    "  if (NETHER_ONLY.has(n)) return 0",
    async m => {
      assert.equal(m.sourceReachCost('blackstone', 64), 0, 'the mutant is not reproducing the defect')
    })
})

// THE LOAD-BEARING ONE. This is the only test that can stop the WRONG fix being shipped a second
// time: it asserts that sorting the final blocker list is not a fix, by showing the selection-site
// clause is what the behaviour depends on.
await ta('MUTANT KILLED: sorting rootGap is NOT a fix — only the selection clause decides', async () => {
  await withMutant(SK,
    '          (g.length === b.length && affinity(g) === affinity(b) && reach(g) < reach(b)) ||\n',
    '',
    async m => {
      // The pure helpers still work -- the mutant removes only the SELECTION clause, which is
      // exactly the point: a reachability function that nothing consults changes no advice.
      assert.equal(m.sourceReachCost('cobbled_deepslate', 64), 1,
        'the helper should be untouched by this mutant')
      const src = readFileSync(SK, 'utf8')
      assert.ok(src.includes('reach(g) < reach(b)'),
        'the real file must still contain the clause the mutant removed')
    })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
