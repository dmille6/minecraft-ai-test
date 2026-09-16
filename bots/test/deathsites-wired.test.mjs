// Structural invariants for the death-site price (behaviour: deathsites.test.mjs, worldfacts-death.test.mjs,
// explore-known.test.mjs). Comments stripped; anchors unique; mutants for the two lines that carry the mechanism.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const idx = strip(readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8'))
const once = (s, needle, where) => { const n = s.split(needle).length - 1; assert.equal(n, 1, `${where}: expected exactly one "${needle}", found ${n}`) }
t('the price is in the shared exclusion array (every land profile copies it) and in the water profile that replaces it', () => {
  once(idx, 'moves.exclusionAreasStep = [waterEntryPenalty, deathSitePenalty]', 'index')
  once(idx, 'waterMoves.exclusionAreasStep = [deathSitePenalty]', 'index')
  assert.ok(idx.indexOf('moves.exclusionAreasStep = [waterEntryPenalty, deathSitePenalty]') < idx.indexOf('Object.assign(gatherMoves, moves)'), 'set before the profiles copy the array')
  once(idx, 'return deathSiteStepCost(deathSites, block)', 'index')
  once(idx, "deathSites = worldFacts?.deathSites?.() ?? []", 'index')
})
t('a death is published to world facts before the cause and peak are cleared, and the route crossing is logged as the positive control', () => {
  const i0 = idx.indexOf('worldFacts.reportDeath(deathClass(cause), deathPos)'), i1 = idx.indexOf('lastDeathCause = null\n    peakY = null')
  assert.ok(i0 > 0 && i1 > i0, `reportDeath@${i0} before the clear@${i1}`)
  once(idx, "kind: 'death_site_recorded', status: 'success'", 'index')
  once(idx, "kind: 'death_site_route_crossed'", 'index')
})
t('mutant: dropping the price from the shared array is detected', () => {
  const m = idx.replace('moves.exclusionAreasStep = [waterEntryPenalty, deathSitePenalty]', 'moves.exclusionAreasStep = [waterEntryPenalty]')
  assert.notEqual(m, idx, 'MUTATION DID NOT APPLY')
  assert.throws(() => once(m, 'moves.exclusionAreasStep = [waterEntryPenalty, deathSitePenalty]', 'mutant'), /found 0/)
})
t('mutant: publishing after the clear is detected', () => {
  const m = idx.replace('lastDeathCause = null\n    peakY = null', 'lastDeathCause = null\n    peakY = null\n    worldFacts.reportDeath(deathClass(cause), deathPos)')
  assert.notEqual(m, idx, 'MUTATION DID NOT APPLY')
  const i0 = m.indexOf('worldFacts.reportDeath(deathClass(cause), deathPos)'), i1 = m.indexOf('lastDeathCause = null\n    peakY = null')
  assert.throws(() => once(m, 'worldFacts.reportDeath(deathClass(cause), deathPos)', 'mutant'), /found 2/); assert.ok(i0 < i1)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
