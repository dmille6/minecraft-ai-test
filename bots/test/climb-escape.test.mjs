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

// --- a pillar may be built of sand; a bridge may not -------------------------

t('THE SAND BOTS: the vertical pillar accepts falling blocks', () => {
  // board-a-Bravo sat on 83 sand and isolated-b-Comet on 75 -- more than enough
  // to climb 45 blocks -- and shaftAscend refused every one, because SCAFFOLD
  // excluded anything that obeys gravity. Gravity only matters unsupported: a
  // pillar places each block on TOP of the column under the bot.
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const m = src.match(/^const SCAFFOLD = (\/\^.*\$\/)/m)
  assert.ok(m, 'the SCAFFOLD pattern moved; re-read this test')
  const re = new RegExp(m[1].slice(1, -1))
  for (const name of ['sand', 'gravel', 'red_sand']) {
    assert.ok(re.test(name), `${name} is what the stuck bots are standing on`)
  }
  for (const name of ['cobblestone', 'dirt', 'oak_planks', 'deepslate']) {
    assert.ok(re.test(name), `${name} regressed out of the pillar set`)
  }
  for (const name of ['diamond', 'iron_ingot', 'stick']) {
    assert.ok(!re.test(name), `${name} is not a building block`)
  }
})

t('A RUNG MUST NOT COST A FAILED ATTEMPT: what we ask for, we can use', () => {
  // climbPrerequisite and the stranded-advice list both send a bot to fetch
  // gravel. If the climb then refuses gravel, the bot is charged a failure for
  // doing exactly what it was told -- the one shape the ladder rule forbids.
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const m = src.match(/^const SCAFFOLD = (\/\^.*\$\/)/m)
  const re = new RegExp(m[1].slice(1, -1))
  // Only the two lists that name BLOCKS TO PILLAR WITH -- scaffoldPrereqFor and
  // the 'no scaffold' branch of climbPrerequisite. A third `items:` array names
  // pickaxes for the dig-failed branch, and a pickaxe is a tool, not scaffold.
  const advised = new Set()
  for (const block of src.matchAll(/items:\s*\[([^\]]*)\]/gs)) {
    const names = [...block[1].matchAll(/'([a-z_]+)'/g)].map(q => q[1])
    if (names.some(n => /_pickaxe$/.test(n))) continue     // a tool list, not a block list
    names.forEach(n => advised.add(n))
  }
  assert.ok(advised.size >= 8, `found only ${advised.size} advised climb blocks; re-read this test`)
  assert.ok(advised.has('gravel'), 'the gravel advice is what this test exists for')
  for (const name of advised) {
    assert.ok(re.test(name),
      `the bot is told to gather ${name} to climb, and the climb will not place it`)
  }
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

t('THE CLIMB OWNS THE BODY: it clears the pathfinder goal before starting', () => {
  // shaftAscend runs immediately after a goto that just failed, so that goto's
  // goal is usually still set. A pillar that does not own the body has its dig
  // cancelled from underneath it -- observed live as
  // "dig failed on stone: Digging aborted" -- and the skill then blames the
  // stone. reflex.mjs's pillarOut has always seized the body; this one did not.
  // STRIP COMMENTS FIRST. The explanation above this fix quotes `setGoal(null)`
  // verbatim, so a naive grep matches the reasoning even after the code is
  // deleted -- and this test duly passed against a mutant that removed the very
  // line it exists to protect. Third time today a comment has fooled a source
  // grep in this repo; the other two tests already do this.
  const raw = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const i = src.indexOf('export async function shaftAscend')
  assert.ok(i > 0, 'shaftAscend moved; re-read this test')
  const head = src.slice(i, src.indexOf('const startY', i))
  assert.ok(/setGoal\(null\)/.test(head),
    'the climb starts without clearing the goal — stop() alone waits for a path node it may never reach')
  assert.ok(/clearControlStates\(\)/.test(head),
    'stale control states from the failed goto are still latched')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
