// SEA LEVEL IS NOT GROUND LEVEL.
//
// `belowGroundHint` fired on `y < 63` alone and told bots "wood, plants and
// animals only exist above ground, so run surface first". Beaches, riverbanks
// and valley floors sit at y=55-62. Measured over 24h: 11,679 firings, 8,686 of
// them (74%) at y>=40 with surface blocks visible in the SAME perception
// record. One bot was traced outdoors at y=59 holding apples and bamboo while
// being told for three hours that surface loot does not exist there.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { V, AIR, STONE } from './helpers/microworld.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const SRC = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')

t('the hint is gated on a CEILING, not on altitude alone', () => {
  const fn = SRC.slice(SRC.indexOf('function belowGroundHint'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(/hasCeiling\(bot\)/.test(body),
    'altitude alone is back: this told outdoor bots at y=59 that plants do not exist')
})

// hasCeiling is not exported, so exercise it through the shape it must have.
const ceilingFn = (() => {
  const i = SRC.indexOf('function hasCeiling')
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i) + 3)
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return hasCeiling`)()
})()

t('open sky overhead is NOT underground, even below sea level', () => {
  const outdoors = { entity: { position: new V(0, 59, 0) }, blockAt: () => AIR }
  assert.equal(ceilingFn(outdoors), false,
    'a bot on a riverbank at y=59 is outdoors and must not be told otherwise')
})

t('rock overhead IS underground, at any altitude', () => {
  const cave = { entity: { position: new V(0, 59, 0) }, blockAt: () => STONE }
  assert.equal(ceilingFn(cave), true)
  const highCave = { entity: { position: new V(0, 200, 0) }, blockAt: () => STONE }
  assert.equal(ceilingFn(highCave), true, 'altitude does not decide this')
})

t('an unloaded chunk reads as open sky, not as a ceiling', () => {
  // Erring toward "outdoors" is deliberate: a wrong "you are underground" is
  // the exact failure being fixed.
  const unloaded = { entity: { position: new V(0, 59, 0) }, blockAt: () => null }
  assert.equal(ceilingFn(unloaded), false)
})

t('the bot own head-space is not mistaken for a ceiling', () => {
  // The scan starts at dy=2. A block at dy=1 is the bot's own head room and
  // means suffocation, not "underground".
  const headBlock = {
    entity: { position: new V(0, 59, 0) },
    blockAt: p => (p.y === 60 ? STONE : AIR),
  }
  assert.equal(ceilingFn(headBlock), false)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
