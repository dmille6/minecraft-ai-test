// A BOT WITH BLOCKS AND NO TOOL MUST BE ABLE TO CLIMB OUT.
//
// 2026-08-31: 32 of 80 bots were permanently immobile -- under 1 block of travel
// in 3.5 hours, bimodal against 39 bots that moved >512. 28 of the 32 had no
// pickaxe, median y=46, 155 decisions each at 0% success. `surface` succeeded
// 490/913 times above y=60 and **0 times in 1,902 calls below it**.
//
// Two independent defects held the trap shut, and either alone was sufficient:
//
//  1. mineflayer-pathfinder seeds `scafoldingBlocks` with dirt and cobblestone
//     ONLY, and getMoveUp bails on `remainingBlocks === 0`. Nothing extended it,
//     so `allow1by1towers = true` was inert and A* answered NO PATH. Of 10
//     sampled frozen bots, 7 carried zero pathfinder-usable scaffold while
//     holding plenty of blocks -- board-a-Bravo on 83 sand, isolated-b-Comet on
//     75 sand, hive-b-Comet on 24 andesite.
//
//  2. The manual pillar refused to run if liquid sat in ANY of the four
//     horizontal neighbours at head height -- a condition that is nearly always
//     true underground. 561 of 566 pillar attempts below y=60 stopped on it.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extendScaffolding, overheadBreakRisk, PATHFINDER_SCAFFOLD, FALLING } from '../src/scaffold.mjs'
const require_ = createRequire(import.meta.url)

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const LIQ = new Set(['water', 'lava'])
const isLiquid = b => !!b && LIQ.has(b.name)
const AIR   = { name: 'air',   boundingBox: 'empty' }
const STONE = { name: 'stone', boundingBox: 'block' }
const WATER = { name: 'water', boundingBox: 'empty' }

// --- defect 1: the pathfinder could not tower with what bots actually carry ---

const mcData = require_('minecraft-data')('1.21.8')
const { Movements } = require_('mineflayer-pathfinder')
const freshMoves = () => new Movements({ registry: mcData })

t('THE LIBRARY DEFAULT IS TWO BLOCKS, and that is the bug', () => {
  const m = freshMoves()
  const names = m.scafoldingBlocks.map(id => mcData.items[id]?.name).sort()
  assert.deepEqual(names, ['cobblestone', 'dirt'],
    `pathfinder no longer defaults to dirt+cobblestone (got ${names}); re-read this test`)
})

t('a bot holding andesite can now be planned a tower', () => {
  const m = freshMoves()
  const added = extendScaffolding(m, mcData)
  assert.ok(added > 0, 'nothing was added')
  for (const name of ['andesite', 'deepslate', 'cobbled_deepslate', 'tuff', 'stone']) {
    const id = mcData.itemsByName[name]?.id
    assert.ok(m.scafoldingBlocks.includes(id), `${name} is still not plannable`)
  }
})

t('FALLING BLOCKS STAY OUT — a sand bridge drops the bot', () => {
  // scafoldingBlocks is used for horizontal BRIDGING as well as towering.
  // Pillaring straight up with sand is fine and shaftAscend still does it; a
  // planned sand bridge falls out from under the bot mid-crossing.
  const m = freshMoves()
  extendScaffolding(m, mcData)
  for (const name of FALLING) {
    const id = mcData.itemsByName[name]?.id
    if (id == null) continue
    assert.ok(!m.scafoldingBlocks.includes(id), `${name} obeys gravity and must not be bridgeable`)
  }
  for (const name of PATHFINDER_SCAFFOLD) {
    assert.ok(!FALLING.includes(name), `${name} is in both lists`)
  }
})

t('extending twice does not duplicate ids', () => {
  const m = freshMoves()
  extendScaffolding(m, mcData)
  const n = m.scafoldingBlocks.length
  const again = extendScaffolding(m, mcData)
  assert.equal(again, 0)
  assert.equal(m.scafoldingBlocks.length, n)
  assert.equal(new Set(m.scafoldingBlocks).size, n, 'duplicate ids would double-count remainingBlocks')
})

t('it is defensive about a missing registry rather than throwing mid-connect', () => {
  assert.equal(extendScaffolding(null, mcData), 0)
  assert.equal(extendScaffolding(freshMoves(), null), 0)
  assert.equal(extendScaffolding({}, mcData), 0)
})

// --- defect 2: the pillar refused to run next to water ----------------------

t('THE 99.1%: air overhead and water beside is a SAFE step', () => {
  assert.equal(overheadBreakRisk({ head: AIR, sides: [WATER, null, null, null], isLiquid }), null,
    'nothing is being broken, so no neighbour can flood anything')
})

t('MUTANT: the old always-on guard refused exactly this step', () => {
  // Guards the test above against passing for the wrong reason.
  const oldGuardWouldRefuse = [WATER, null, null, null].some(isLiquid)
  assert.ok(oldGuardWouldRefuse, 'the fixture must be one the old guard rejected')
})

t('SAFETY KEPT: breaking a block with water beside it is still refused', () => {
  const r = overheadBreakRisk({ head: STONE, sides: [WATER], isLiquid })
  assert.ok(r && /beside the block overhead/.test(r), `expected a refusal, got ${r}`)
})

t('water directly overhead still ends the climb', () => {
  // Liquid has an EMPTY boundingBox, so a solidity test alone would fall
  // through and let the bot pillar its own head under water.
  const r = overheadBreakRisk({ head: WATER, sides: [], isLiquid })
  assert.ok(r && /overhead/.test(r), `expected a refusal, got ${r}`)
})

t('a dry solid ceiling is broken without complaint', () => {
  assert.equal(overheadBreakRisk({ head: STONE, sides: [STONE, STONE, AIR, null], isLiquid }), null)
})

// --- both fixes are actually wired in ---------------------------------------

t('index.mjs installs the wider scaffold list on the live profile', () => {
  const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.ok(/extendScaffolding\(moves,\s*bot\.registry\)/.test(code),
    'the profile is built but never extended — allow1by1towers stays inert')
})

t('shaftAscend asks overheadBreakRisk rather than testing liquid itself', () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.ok(/overheadBreakRisk\(/.test(code), 'the climb no longer consults the shared rule')
  assert.ok(!/liquid beside the shaft/.test(code), 'the old always-on guard is back')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
