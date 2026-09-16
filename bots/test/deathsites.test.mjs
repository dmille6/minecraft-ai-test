// deathsites.mjs, pure: the disc, the price, the crossing check, and the arithmetic that keeps the price under the wall.
import assert from 'node:assert/strict'
import { nearDeathSite, deathSiteStepCost, pathCrossesDeathSite, lineHitsDeathSite, isDeathSite, DEATH_SITE_STEP_COST, DEATH_SITE_RADIUS, DEATH_SITE_DY } from '../src/deathsites.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const sites = [
  { kind: 'death:fire', x: 336, y: 35, z: 206, count: 4, deaths: 3 },
  { kind: 'death:drowning', x: 543, y: 40, z: 191, count: 4, deaths: 1 },
  { kind: 'lava', x: 100, y: 64, z: 100, count: 9 },             // a hazard, not a death: not priced
]
t('the price lands inside the disc and the y band, not outside either', () => {
  const blk = (x, y, z) => ({ position: { x, y, z } })
  assert.equal(deathSiteStepCost(sites, blk(336, 35, 206)), DEATH_SITE_STEP_COST)
  assert.equal(deathSiteStepCost(sites, blk(336 + DEATH_SITE_RADIUS, 35, 206)), DEATH_SITE_STEP_COST, 'the rim is inside')
  assert.equal(deathSiteStepCost(sites, blk(336 + DEATH_SITE_RADIUS + 1, 35, 206)), 0, 'one past the rim is outside')
  assert.equal(deathSiteStepCost(sites, blk(336, 35 + DEATH_SITE_DY + 1, 206)), 0, 'seven above the pool is another place')
  assert.equal(deathSiteStepCost(sites, blk(336, 35 - DEATH_SITE_DY, 206)), DEATH_SITE_STEP_COST, 'six below is still the pool')
  assert.equal(deathSiteStepCost(sites, blk(100, 64, 100)), 0, 'a plain hazard site is advice, not a price')
  assert.equal(deathSiteStepCost(sites, { position: null }), 0); assert.equal(deathSiteStepCost([], blk(336, 35, 206)), 0); assert.equal(deathSiteStepCost(null, blk(336, 35, 206)), 0)
})
t('six chargings of the price per diagonal move stay under the 100 that deletes a neighbour (movements.js getMoveDiagonal; three per forward move)', () => {
  assert.ok(1.4142 + 6 * DEATH_SITE_STEP_COST < 100, `1.4 + 6 x ${DEATH_SITE_STEP_COST} must stay under 100`)
  assert.ok(3 * DEATH_SITE_STEP_COST * 12 > 400, 'and a 12-cell crossing must still cost far more than a long way round')
})
t('the nearest covering site wins, and malformed sites are skipped', () => {
  const near = nearDeathSite([...sites, { kind: 'death:fire', x: 338, y: 35, z: 206, count: 4 }, { kind: 'death:fall', x: 'x' }], 338, 36, 206)
  assert.equal(near.x, 338)
  assert.equal(nearDeathSite(sites, NaN, 1, 2), null); assert.equal(nearDeathSite('nope', 1, 1, 1), null)
  assert.equal(isDeathSite({ kind: 'death:fall' }), true); assert.equal(isDeathSite({ kind: 'lava' }), false); assert.equal(isDeathSite(null), false)
})
t('a planned path through a disc is reported with the node and the site; a path round it is not', () => {
  const through = pathCrossesDeathSite(sites, [{ x: 320, y: 35, z: 206 }, { x: 330, y: 35, z: 206 }, { x: 340, y: 35, z: 206 }])
  assert.equal(through.node.x, 330); assert.equal(through.site.kind, 'death:fire')
  assert.equal(pathCrossesDeathSite(sites, [{ x: 320, y: 35, z: 220 }, { x: 350, y: 35, z: 220 }]), null)
  assert.equal(pathCrossesDeathSite(sites, undefined), null)
})
t('a blind walk is checked along its own line with the physics heading: yaw 0 walks north (-z), yaw pi/2 walks west (-x)', () => {
  const s = [{ kind: 'death:fire', x: 100, y: 64, z: 90, count: 4 }]
  assert.ok(lineHitsDeathSite(s, { x: 100, y: 64, z: 100 }, 0), 'north from z=100 reaches the disc at z=96')
  assert.equal(lineHitsDeathSite(s, { x: 100, y: 64, z: 100 }, Math.PI), null, 'south walks away')
  assert.ok(lineHitsDeathSite([{ kind: 'death:fire', x: 92, y: 64, z: 100, count: 4 }], { x: 100, y: 64, z: 100 }, Math.PI / 2), 'west from x=100 reaches x=98')
  assert.equal(lineHitsDeathSite(s, { x: 100, y: 80, z: 100 }, 0), null, '16 blocks above the site is another place')
  assert.equal(lineHitsDeathSite([], { x: 100, y: 64, z: 100 }, 0), null); assert.equal(lineHitsDeathSite(s, null, 0), null)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
