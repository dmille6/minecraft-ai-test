// SITEPREP-03: THE LIVE SP1 OVERLAP, FROM THE LOGGED STATE (showcase 11-04 13:24:12Z: SP1 chose B7 at -69,68,-28 in the first tick;
// the keeper's re-check retired it at once -- `project:monument` -- re-chose it, retired it again, and abandoned it 13:27:03Z). The
// fixture is the showcase's own blocks round that plot, the real records' zones near it and SP1 as the live record holds it (region
// copy + pool records ~13:35Z, bots/test/fixtures/siteprep-sp1-overlap-1104.json). Behaviour: the re-check tested the GRADED box,
// whose ramp ring meets the monument's zone (box + 3) although the grading never works a column in it; one pure test now serves the
// screen, the choice and the re-check (prepOverlapOf over the plot's footprint), so the choice can never pick what the re-check
// retires; one overlap abandon no longer holds the kind's refile 24 h. Anchored mutants (present and unique, imported fresh).
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const { dumpReader } = await import('../scripts/buildsite-offline.mjs')
const P = await import('../src/siteprep.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 6).join('\n        ')}`) }
}
async function withMutant (rel, old, neu, fn) {
  const file = new URL(`../src/${rel}`, import.meta.url)
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `ANCHOR MISSING: ${JSON.stringify(old.slice(0, 70))}`)
  assert.strictEqual(src.split(old).length, 2, `ANCHOR NOT UNIQUE: ${JSON.stringify(old.slice(0, 70))}`)
  const out = new URL(`./_mutant-ov-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(`${out.href}?${Date.now()}_${Math.random()}`)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (rel, real, old, neu, scenario) => {
  await scenario(real)
  let k = false
  await withMutant(rel, old, neu, async M => { try { await scenario(M) } catch { k = true } })
  assert.ok(k, `the mutant survived: ${old.slice(0, 60)}`)
}

const FX = JSON.parse(readFileSync(new URL('./fixtures/siteprep-sp1-overlap-1104.json', import.meta.url), 'utf8'))
const home = FX.home, cand = FX.cand, zones = FX.zones
const R0 = dumpReader(FX)
const read = (x, y, z) => (y > FX.y[1] ? { name: 'air', boundingBox: 'empty' } : y < FX.y[0] ? { name: 'stone', boundingBox: 'block' } : R0(x, y, z))
/** The keeper's refusals for the grading here: every record zone's columns (skills.mjs tidyInputs: recordZones in its avoid). */
const avoid = (x, z) => zones.find(q => x >= q.box[0] && x <= q.box[3] && z >= q.box[2] && z <= q.box[5])?.why ?? null
// the walk guard's starts: the graded box's edge (the fixture holds the box + 2 only; the town edge is out of it), no pad beyond it
const G = P.prepBoxes(cand).box
const FROM = []
for (let x = G[0]; x <= G[2]; x++) FROM.push([x, G[1]], [x, G[3]])
for (let z = G[1] + 1; z < G[3]; z++) FROM.push([G[0], z], [G[2], z])
const choose = (M, extra = {}) => M.prepChoose(read, [{ ...cand, tier: 'smaller' }], { home, avoid, zones, accept: () => ({ ok: true, why: 'ok' }), from: FROM, P: { ...M.PREP, walkPad: 0 }, ...extra })

console.log('THE LOGGED STATE: SP1 as the live record holds it')
await t('SP1 is abandoned by the re-check (`retire:project:monument`) on the plot B7 at -69,-28 -- the live rows 13:24-13:27Z', () => {
  assert.strictEqual(FX.sp1.state, 'abandoned')
  assert.strictEqual(FX.sp1.why, 'retire:project:monument')
  assert.deepStrictEqual([FX.sp1.plot.cx, FX.sp1.plot.cz, FX.sp1.plot.B], [-69, -28, 7])
})
await t('reproduced: the plot\'s GRADED box meets the monument\'s zone (the old re-check); its pinned square meets none', () => {
  assert.strictEqual(P.prepOverlapOf(FX.sp1.plot.graded, zones), 'project:monument')
  assert.strictEqual(P.prepOverlapOf({ pin: FX.sp1.plot.box, cols: [] }, zones), null)
})
await t('the grading never works a column in any zone (its avoid holds them): the footprint is overlap-free, the plot is chosen and grades', () => {
  const ch = choose(P)
  assert.ok(ch.ok, JSON.stringify(ch.tried))
  const plot = P.plotOf(ch)
  assert.ok(plot.footprint.cols.length > 50, 'the worked columns are on the plot')
  assert.ok(plot.earth.fill > 0)
  assert.strictEqual(P.prepOverlapOf(P.plotFootprint(plot), zones), null, 'the keeper\'s re-check on the stored footprint')
})
await t('mutant: a re-check on the graded box (the live rule) retires the very plot the choice made', () => killed('siteprep.mjs', P,
  'export const plotFootprint = plot => plot?.footprint ?? (Array.isArray(plot?.graded) ? plot.graded : null)', 'export const plotFootprint = plot => plot?.graded ?? null',
  M => { const ch = choose(M); assert.ok(ch.ok); assert.strictEqual(M.prepOverlapOf(M.plotFootprint(M.plotOf(ch)), zones), null) }))
await t('the choice refuses a plot whose WORKED columns enter a zone (control: the same plot graded without the zones\' avoid)', () => {
  const ch = choose(P, { avoid: () => null })
  assert.strictEqual(ch.ok, false)
  assert.strictEqual(ch.tried.overlap, 1)
  const free = choose(P, { avoid: () => null, zones: null })
  assert.ok(free.ok, 'without the overlap test the same grading would be chosen')
})
await t('mutant: without the choice\'s footprint test that plot is chosen and the re-check retires it', () => killed('siteprep.mjs', P,
  "    if (zones) { const ov = prepOverlapOf(prepFootprint(gr.pin, gr.work), zones); if (ov) { tried.overlap = (tried.overlap ?? 0) + 1; continue } }\n", '',
  M => assert.strictEqual(choose(M, { avoid: () => null }).ok, false)))
await t('the screen refuses a candidate whose pinned square meets a zone, before any grading (the same function)', () => {
  const { pin } = P.prepBoxes(cand)
  const z = [{ box: [pin[0], -64, pin[1], pin[0], 320, pin[1]], why: 'project:x' }]
  const gm = P.groundMemo(read, home.y)
  assert.ok(P.prepEstimate(cand, { ground: gm, hy: home.y, read }).ok)
  assert.strictEqual(P.prepEstimate(cand, { ground: gm, hy: home.y, read, zones: z }).why, 'overlap:project:x')
  assert.ok(P.prepEstimate(cand, { ground: gm, hy: home.y, read, zones }).ok, 'the real zones leave the pinned square free')
})
await t('a plot chosen before siteprep-03 (no stored footprint) is re-checked on its graded box, as then', () => {
  assert.deepStrictEqual(P.plotFootprint({ graded: [1, 2, 3, 4] }), [1, 2, 3, 4])
  assert.strictEqual(P.plotFootprint({}), null)
  assert.strictEqual(P.prepOverlapOf(null, zones), null)
})

console.log('THE REFILE AFTER AN OVERLAP ABANDON')
const now = FX.sp1.at + 60_000
const recWith = (...rs) => ({ requests: rs })
await t('SP1\'s abandon (one overlap retire) does not hold the shrine back: the next fixable no_site files at once', () => {
  assert.ok(P.prepOverlapAbandon(FX.sp1))
  assert.deepStrictEqual(P.prepFileDecision({ kind: 'shrine', rec: recWith(FX.sp1), rejects: { apron_low: 5 }, now }), { file: true, why: 'ok' })
})
await t('bounded: a second overlap abandon within the wait holds it; an abandon for the ground (given_up) or a refusal holds it as before', () => {
  const sp2 = { ...FX.sp1, id: 'SP2', at: now }
  assert.strictEqual(P.prepFileDecision({ kind: 'shrine', rec: recWith(FX.sp1, sp2), rejects: { apron_low: 5 }, now }).why, 'recent')
  const gu = { ...FX.sp1, why: 'retire:given_up' }
  assert.strictEqual(P.prepOverlapAbandon(gu), false)
  assert.strictEqual(P.prepFileDecision({ kind: 'shrine', rec: recWith(gu), rejects: { apron_low: 5 }, now }).why, 'recent')
  assert.strictEqual(P.prepFileDecision({ kind: 'shrine', rec: recWith({ ...FX.sp1, state: 'refused', why: 'pin_kept' }), rejects: { apron_low: 5 }, now }).why, 'recent')
  assert.strictEqual(P.prepFileDecision({ kind: 'shrine', rec: recWith(FX.sp1, sp2), rejects: { apron_low: 5 }, now: now + P.PREP.refileMs + 1 }).file, true)
})
await t('mutant: without the one-abandon allowance SP1 holds the shrine 24 h', () => killed('siteprep.mjs', P,
  'if (recent.length - Math.min(1, overlapAbandons) > 0)', 'if (recent.length > 0)',
  M => assert.ok(M.prepFileDecision({ kind: 'shrine', rec: recWith(FX.sp1), rejects: { apron_low: 5 }, now }).file)))
await t('mutant: an allowance without a bound refiles for ever', () => killed('siteprep.mjs', P,
  'if (recent.length - Math.min(1, overlapAbandons) > 0)', 'if (recent.length - overlapAbandons > 0)',
  M => assert.strictEqual(M.prepFileDecision({ kind: 'shrine', rec: recWith(FX.sp1, { ...FX.sp1, id: 'SP2', at: now }), rejects: { apron_low: 5 }, now }).why, 'recent')))

console.log('THE KEEPER (skills.mjs, structural)')
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]\/\/ .*$/gm, '')
const SK = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
await t('the re-check, the screen and the choice read the same zones through the same function', () => {
  assert.ok(/function prepOverlap \(plot\) \{ return prepOverlapOf\(plotFootprint\(plot\), prepOverlapZones\(\)\) \}/.test(SK))
  assert.ok(/const ovZones = prepOverlapZones\(\)/.test(SK))
  assert.ok(/guard, hy: home\.y, read, avoid, zones: ovZones \}\)\)/.test(SK))
  assert.ok(/water: tidyWater\(\), zones: ovZones,/.test(SK))
  const b = 'water: tidyWater(), zones: ovZones,'
  assert.strictEqual(SK.split(b).length, 2)
  assert.ok(!/water: tidyWater\(\), zones: ovZones,/.test(SK.replace(b, 'water: tidyWater(),')))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
