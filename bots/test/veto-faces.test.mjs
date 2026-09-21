// WHICH LIQUID, AND ON WHICH FACE -- a measurement that refuses to collapse.
//
// 33% of wood gather runs die at the liquid veto and the veto's own token says
// only `liquid`. These functions answer the question the token cannot, WITHOUT
// touching the veto: `breakVeto` is byte-identical to baseline, the histogram
// built from it is unchanged, and the sentence the model reads as LAST ACTION is
// unchanged. The breakdown goes out as its own `veto_faces` event.
//
// That separation is the whole design and it came from Codex pass 1: the first
// version widened breakVeto's token, which reaches result.detail -> lastOutcome
// -> the prompt, so it could have changed what the model decided next. A
// measurement that can move the thing it measures is not an instrument.
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { liquidKind, liquidFaces, liquidFacesLabel, orderFaceBuckets, breakVeto } from '../src/skills.mjs'

process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// Movements.getBlock DECORATES blocks with `liquid` (movements.js:236-238);
// a plain prismarine block carries neither that nor canFall.
const water = { name: 'water', liquid: true }
const flowing = { name: 'flowing_water', liquid: true }
const lava = { name: 'lava', liquid: true }
const weird = { name: 'some_new_fluid', liquid: true }
const stone = { name: 'stone' }
const sand = { name: 'sand', canFall: true }

t('liquidKind names water, lava, and refuses to guess', () => {
  assert.strictEqual(liquidKind(water), 'water')
  assert.strictEqual(liquidKind(flowing), 'water')
  assert.strictEqual(liquidKind(lava), 'lava')
  assert.strictEqual(liquidKind(stone), null)
  assert.strictEqual(liquidKind(null), null)
  // guessing here would invent the distinction the instrument exists to measure
  assert.strictEqual(liquidKind(weird), 'liquid')
})

t('a shoreline trunk: water beside, nothing above', () => {
  const f = liquidFaces({ above: stone, sides: [stone, water, stone, stone] })
  assert.strictEqual(f.above, null)
  assert.deepStrictEqual(f.sides, { water: 1 })
  assert.strictEqual(liquidFacesLabel(f), 'side_waterx1')
})

t('water ABOVE is reported separately from water beside', () => {
  const f = liquidFaces({ above: water, sides: [water, stone, stone, stone] })
  assert.strictEqual(f.above, 'water')
  assert.deepStrictEqual(f.sides, { water: 1 })
  assert.strictEqual(liquidFacesLabel(f), 'above_water+side_waterx1')
})

t('MIXED NEIGHBOURHOODS STAY MIXED — the Codex objection', () => {
  // A token that picked a winner would fold an unknown fluid into the bucket
  // somebody later proposes to relax, and would hide lava behind water above.
  const f = liquidFaces({ above: null, sides: [water, weird, stone, stone] })
  assert.deepStrictEqual(f.sides, { water: 1, liquid: 1 })
  assert.strictEqual(liquidFacesLabel(f), 'side_liquidx1+side_waterx1')
  const g = liquidFaces({ above: water, sides: [lava, stone, stone, stone] })
  assert.strictEqual(g.above, 'water')
  assert.deepStrictEqual(g.sides, { lava: 1 })
  assert.ok(liquidFacesLabel(g).includes('lava'),
    'lava beside was hidden behind water above — the exact failure this replaces')
})

t('counts per kind, not just presence', () => {
  const f = liquidFaces({ sides: [water, water, lava, stone] })
  assert.deepStrictEqual(f.sides, { water: 2, lava: 1 })
})

t('no liquid at all reads `none`, not an empty string', () => {
  assert.strictEqual(liquidFacesLabel(liquidFaces({ above: stone, sides: [stone] })), 'none')
  assert.strictEqual(liquidFacesLabel(liquidFaces({})), 'none')
  assert.strictEqual(liquidFacesLabel(undefined), 'none')
})

t('the label is STABLE — the same neighbourhood always reads the same way', () => {
  const a = liquidFacesLabel(liquidFaces({ sides: [lava, water, stone, stone] }))
  const b = liquidFacesLabel(liquidFaces({ sides: [water, stone, lava, stone] }))
  assert.strictEqual(a, b, 'face order changed the label; counts would not aggregate')
})

t('THE VETO IS UNTOUCHED: breakVeto still answers exactly as before', () => {
  // If this drifts, the model-facing sentence drifts with it and the change is
  // no longer an instrument.
  assert.strictEqual(breakVeto({ above: water, sides: [] }), 'liquid')
  assert.strictEqual(breakVeto({ above: null, sides: [lava, stone, stone, stone] }), 'liquid')
  assert.strictEqual(breakVeto({ above: sand, sides: [water, stone, stone, stone] }), 'both')
  assert.strictEqual(breakVeto({ above: sand, sides: [] }), 'falling')
  assert.strictEqual(breakVeto({ above: stone, entitiesAbove: 1 }), 'entity')
  assert.strictEqual(breakVeto({ above: stone, sides: [stone] }), null)
})

// ------------------------------------------------------------------ mutants ---
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 50))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const SKILLS = new URL('../src/skills.mjs', import.meta.url)

// A MUTANT MUST BE KILLED BY THE REAL ASSERTION, not by a second one written to
// match it (Codex pass 2). The first draft checked that the mutant BEHAVED
// differently, which proves the edit applied and nothing else -- the actual test
// above could still have been vacuous. `killedBy` re-runs the genuine assertion
// against the mutant and requires it to THROW.
const killedBy = async (name, old, neu, realAssertion) => {
  await ta(`MUTANT KILLED: ${name}`, async () => {
    await withMutant(SKILLS, old, neu, async mod => {
      let threw = null
      try { realAssertion(mod) } catch (e) { threw = e }
      assert.ok(threw,
        'the REAL assertion still passed against the mutant, so it does not test this')
    })
    // and it must pass against the unmutated module, or it is not an assertion
    realAssertion({ liquidKind, liquidFaces, liquidFacesLabel, orderFaceBuckets, breakVeto })
  })
}

await killedBy('guessing an unknown fluid as water',
  "  return b.liquid ? 'liquid' : null", "  return b.liquid ? 'water' : null",
  m => assert.strictEqual(m.liquidKind(weird), 'liquid'))

await killedBy('collapsing the sides to a single winner',
  "    if (k) sideCounts[k] = (sideCounts[k] ?? 0) + 1",
  "    if (k && !Object.keys(sideCounts).length) sideCounts[k] = 1",
  m => assert.deepStrictEqual(m.liquidFaces({ sides: [water, weird, stone, stone] }).sides,
                              { water: 1, liquid: 1 }))

await killedBy('dropping the above face',
  "  return { above: liquidKind(above), sides: sideCounts }",
  "  return { above: null, sides: sideCounts }",
  m => assert.strictEqual(m.liquidFaces({ above: water, sides: [] }).above, 'water'))

t('a rare LAVA bucket outranks a common water one, so truncation cannot eat it', () => {
  const o = orderFaceBuckets({ side_waterx1: 90, side_lavax1: 1, 'above_water+side_waterx2': 40 })
  assert.strictEqual(o[0][0], 'side_lavax1', 'lava did not sort first')
  const u = orderFaceBuckets({ side_waterx1: 90, side_liquidx1: 1 })
  assert.strictEqual(u[0][0], 'side_liquidx1', 'an unknown fluid did not sort ahead of water')
  // and within a rank, still most-frequent-first
  const w = orderFaceBuckets({ a_water: 3, b_water: 9 })
  assert.strictEqual(w[0][0], 'b_water')
})

await killedBy('ranking every bucket equally, which lets truncation eat lava',
  "  const rank = k => (String(k).includes('lava') ? 0 : String(k).includes('liquid') ? 1 : 2)",
  "  const rank = k => 0",
  m => assert.strictEqual(
    m.orderFaceBuckets({ side_waterx1: 90, side_lavax1: 1 })[0][0], 'side_lavax1'))

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
