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
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extendScaffolding, overheadBreakRisk, dryColumnStep, PATHFINDER_SCAFFOLD, FALLING } from '../src/scaffold.mjs'
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

// --- defect 3: a correct refusal became a permanent trap ---------------------
//
// 2026-09-01, full walk of every /var/log/mcai/*/skill-*.jsonl: 262 stops on
// `liquid beside the block overhead`, ALL water and no lava, across 9 bots --
// and every bot pinned to one or two cells. board-c-Alpha stopped 71 times from
// exactly (1394,44,346); isolated-a-Delta 66 times from (542,7,220);
// placebo-b-Delta 81 times from (421,44,-307). `surface` already told the model
// "walk a few blocks away from the water, then run surface again" on every one
// of those 262 occasions, and the model never did it.
//
// The guard is right and is NOT relaxed by any test below. What changed is the
// sentence after it: the climb now looks for a column the SAME guard already
// permits, walks there, and re-decides from the real position.

// REAL REGISTRY BLOCKS, not hand-written stubs. shaftAscend prices its dig from
// the block itself (digbudget.mjs -> canHarvest/digTime), so a `{name,
// boundingBox}` literal throws inside the very branch these tests exercise.
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)
const rblock = name => {
  const b = registry.blocksByName[name]
  assert.ok(b, `${name} missing from the 1.21.8 registry`)
  return Block.fromStateId(b.defaultState, 0)
}
const WORLD_STONE = rblock('stone'), WORLD_AIR = rblock('air')
const WORLD_WATER = rblock('water'), LAVA = rblock('lava')

// The bot stands with its FEET at y=44, which is board-c-Alpha's altitude. `at`
// is relative to the feet; the world functions below are keyed on the absolute
// y so the fixtures read the way the telemetry does.
const FEET_Y = 44
const atOf = world => (dx, dy, dz) => world(dx, FEET_Y + dy, dz)

// A pocket with STONE walls except along the named compass axes, plus explicit
// per-cell overrides. Walling off the axes a test does not care about is what
// makes each assertion below about exactly one decision -- an earlier draft of
// this fixture only edited the east axis and the north/south ones quietly
// satisfied the search, so two tests passed while testing nothing.
const CEIL_Y = FEET_Y + 2
const corridor = (open, overrides = {}) => (x, y, z) => {
  const cell = overrides[`${x},${y},${z}`]
  if (cell) return cell
  const onAxis = (x === 0 && z === 0) ||
    (open.includes('e') && z === 0 && x > 0) || (open.includes('w') && z === 0 && x < 0) ||
    (open.includes('s') && x === 0 && z > 0) || (open.includes('n') && x === 0 && z < 0)
  if (!onAxis) return WORLD_STONE
  if (y === FEET_Y || y === FEET_Y + 1) return WORLD_AIR
  return WORLD_STONE
}

// board-c-Alpha's shape: a solid ceiling with a single water block beside it,
// and a dry ceiling one step east.
const TRAP = corridor('ew', { [`-1,${CEIL_Y},0`]: WORLD_WATER })
// Every neighbouring ceiling block is water. There is no dry column at all.
const SOAKED = (x, y, z) =>
  y === CEIL_Y ? ((x === 0 && z === 0) ? WORLD_STONE : WORLD_WATER)
               : corridor('ewns')(x, y, z)

t('THE TRAP: a wet ceiling with a dry one beside it now has an answer', () => {
  const s = dryColumnStep({ at: atOf(TRAP), isLiquid })
  assert.ok(s, 'no lateral column offered — this is the 262-event freeze')
  assert.deepEqual({ dx: s.dx, dz: s.dz, dist: s.dist }, { dx: 1, dz: 0, dist: 1 },
    'the nearest dry column is one step east')
})

t('MUTANT-BY-CONSTRUCTION: the guard still refuses the column being left', () => {
  // Guards the test above against passing for the wrong reason: if the origin
  // were diggable there would be nothing to step away from.
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => TRAP(x, CEIL_Y, z))
  assert.ok(overheadBreakRisk({ head: TRAP(0, CEIL_Y, 0), sides, isLiquid }),
    'the fixture must be one the shipped guard rejects')
})

t('SAFETY KEPT: it never proposes a column the guard would refuse', () => {
  assert.equal(dryColumnStep({ at: atOf(SOAKED), isLiquid }), null,
    'a bot surrounded by water must still be told no, not walked into it')
  // and every column it DOES propose passes the shipped rule verbatim
  for (const world of [TRAP, SOAKED]) {
    const s = dryColumnStep({ at: atOf(world), isLiquid })
    if (!s) continue
    const x = s.dx * s.dist, z = s.dz * s.dist
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => world(x + a, CEIL_Y, z + b))
    assert.equal(overheadBreakRisk({ head: world(x, CEIL_Y, z), sides, isLiquid }), null,
      'it offered a column the guard refuses')
  }
})

t('IT DOES NOT WADE: a flooded corridor closes the axis', () => {
  // The failure mode this project has paid for twice -- the kelp widening that
  // tripled drownings, the global reflex demotion that multiplied them 7.5x --
  // is treating water as passable. The dry ceiling east is real; the water at
  // head height in front of it makes it unreachable on foot, and that is a no.
  const wet = corridor('e', { [`1,${FEET_Y},0`]: WORLD_WATER })
  assert.equal(dryColumnStep({ at: atOf(wet), isLiquid }), null)
  assert.ok(dryColumnStep({ at: atOf(corridor('e')), isLiquid }),
    'the same corridor without the water must be walkable, or this proves nothing')
})

t('IT DOES NOT FALL: a hole in the floor closes the axis', () => {
  const holed = corridor('e', { [`1,${FEET_Y - 1},0`]: WORLD_AIR })
  assert.equal(dryColumnStep({ at: atOf(holed), isLiquid }), null)
})

t('LAVA CLOSES AN AXIS, and only lava does', () => {
  // board-c-Alpha's own perception scan reported 27 lava blocks at the frozen
  // cell. Water beside your feet is harmless -- believing otherwise is exactly
  // the opinion that cost 99.1% of pillar attempts -- but lava beside your feet
  // burns, and the cell past it can only be reached by walking beside it.
  const hot = corridor('e', { [`1,${FEET_Y},1`]: LAVA })
  assert.equal(dryColumnStep({ at: atOf(hot), isLiquid }), null,
    'it walked the bot to a cell with lava against it')
  const damp = corridor('e', { [`1,${FEET_Y},1`]: WORLD_WATER })
  assert.ok(dryColumnStep({ at: atOf(damp), isLiquid }),
    'water beside the destination is not a hazard, and refusing it rebuilds the 99.1%')
})

t('the nearest dry column wins', () => {
  // east is wet for two steps, west is dry at one: take west.
  const w = corridor('ew', { [`1,${CEIL_Y},0`]: WORLD_WATER, [`2,${CEIL_Y},0`]: WORLD_WATER })
  const s = dryColumnStep({ at: atOf(w), isLiquid })
  assert.ok(s && s.dist === 1 && s.dx === -1, `expected one step west, got ${JSON.stringify(s)}`)
})

t('it is defensive about an absent world rather than throwing mid-climb', () => {
  assert.equal(dryColumnStep(), null)
  assert.equal(dryColumnStep({ at: () => null, isLiquid }), null)
})

// --- and the climb actually uses it ------------------------------------------

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z), clone: () => V(x, y, z) })

/** A bot standing at the origin of `world`, able to walk one cell when steered. */
function trappedBot (world) {
  const digs = [], placed = []
  let aim = null, timer = null
  const bot = {
    entity: { position: V(0.5, 44, 0.5) },
    health: 20, food: 20,
    inventory: { items: () => [{ name: 'cobblestone', count: 24, slot: 0, type: 1 }] },
    registry,
    blockAt: v => world(Math.floor(v.x), Math.round(v.y), Math.floor(v.z)),
    async equip () {}, stopDigging () {},
    async lookAt (v) { aim = v },
    setControlState (name, on) {
      if (name !== 'forward') return
      if (!on) { clearTimeout(timer); timer = null; return }
      if (!aim) return
      timer = setTimeout(() => {
        bot.entity.position = V(Math.floor(aim.x) + 0.5, bot.entity.position.y, Math.floor(aim.z) + 0.5)
      }, 90)
    },
    clearControlStates () { clearTimeout(timer); timer = null },
    async dig (b) { digs.push({ name: b.name, at: { ...bot.entity.position } }) },
    async placeBlock () { placed.push(1) },
    pathfinder: { setGoal () {}, stop () {} },
  }
  return { bot, digs, placed }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const { shaftAscend } = await import('../src/skills.mjs')

await ta('THE 262: the trapped climb now steps clear and breaks a DRY ceiling', async () => {
  const { bot, digs } = trappedBot(TRAP)
  const r = await shaftAscend(bot, 60, new AbortController().signal, { deadline: Date.now() + 8_000 })
  assert.notEqual(r.stopped, 'liquid beside the block overhead (water)',
    'the climb still ends where board-c-Alpha ended 71 times from one cell')
  assert.equal(Math.floor(bot.entity.position.x), 1, 'the bot never left the wet column')
  assert.ok(digs.length > 0, 'it moved and then still did not swing at its ceiling')
  for (const d of digs) {
    assert.equal(Math.floor(d.at.x), 1, `it dug from the wet column at x=${Math.floor(d.at.x)}`)
  }
})

await ta('SAFETY KEPT: with no dry column it refuses, in the same words', async () => {
  const { bot, digs } = trappedBot(SOAKED)
  const r = await shaftAscend(bot, 60, new AbortController().signal, { deadline: Date.now() + 8_000 })
  assert.equal(r.stopped, 'liquid beside the block overhead (water)',
    'the refusal reason changed — climbAdvice and 262 logged events key off it')
  assert.deepEqual(digs, [], 'IT FLOODED THE SHAFT: a wet ceiling was broken')
  assert.equal(Math.floor(bot.entity.position.x), 0, 'it wandered with nowhere dry to go')
})

await ta('AN ABORT MID-SIDESTEP DOES NOT LEAVE THE BOT WALKING', async () => {
  // A control state has no owner and no timeout. `check(signal)` throws
  // straight out of shaftAscend, so a `forward` set without a finally would
  // keep steering a bot that has already been handed back.
  const { bot } = trappedBot(TRAP)
  const ac = new AbortController()
  const seen = []
  const real = bot.setControlState.bind(bot)
  bot.setControlState = (n, on) => { seen.push([n, on]); real(n, on) }
  setTimeout(() => ac.abort(), 120)
  await shaftAscend(bot, 60, ac.signal, { deadline: Date.now() + 8_000 }).catch(() => {})
  const forward = seen.filter(([n]) => n === 'forward')
  assert.ok(forward.length > 0, 'the sidestep never steered, so this proves nothing')
  assert.deepEqual(forward.at(-1), ['forward', false],
    'the abort left `forward` latched — the bot walks until something else seizes the body')
})

await ta('a body that cannot move says so instead of looping', async () => {
  const { bot, digs } = trappedBot(TRAP)
  bot.setControlState = () => {}          // steering does nothing: the body is stuck
  const r = await shaftAscend(bot, 60, new AbortController().signal, { deadline: Date.now() + 8_000 })
  assert.match(r.stopped ?? '', /could not step clear of it/,
    `expected an honest stop, got ${r.stopped}`)
  assert.deepEqual(digs, [], 'a stuck bot must not fall back to digging the wet ceiling')
})

// --- mutants -----------------------------------------------------------------
//
// ASSERT THE MUTATION APPLIED BEFORE RUNNING IT. A replace() that matched
// nothing produces an identical module, the test passes, and the mutant reads
// as killed while nothing was ever tested.

const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
// The abort-safety mutant, sliced out of the source itself: the same walk with
// the try/finally unwrapped. Built by transformation rather than by a literal
// copy so a reindent of the block cannot leave a stale, never-applied mutant.
const _SRC = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
const ABORT_SAFE = _SRC.slice(
  _SRC.indexOf('      // RELEASE THE CONTROL ON EVERY EXIT'),
  _SRC.indexOf("} finally { bot.setControlState('forward', false) }") +
    "} finally { bot.setControlState('forward', false) }".length)
const ABORT_LEAKY = ABORT_SAFE
  .replace('      try {\n', '')
  .replace("      } finally { bot.setControlState('forward', false) }",
           "      bot.setControlState('forward', false)")
assert.ok(ABORT_SAFE.includes('finally') && !ABORT_LEAKY.includes('finally') &&
          ABORT_SAFE !== ABORT_LEAKY,
  'the abort mutant was derived from source that no longer has the shape it edits')
const SCAFFOLD_PATH = new URL('../src/scaffold.mjs', import.meta.url)

async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  // test/ is one level under bots/, so './x.mjs' has to become '../src/x.mjs'.
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

await ta('MUTANT KILLED: without the finally, an abort latches `forward` on', async () => {
  // The mutant is the same walk with the try/finally unwrapped -- the shape the
  // code had before this test existed. `check(signal)` throws past the release.
  await withMutant(SKILLS_PATH, ABORT_SAFE, ABORT_LEAKY, async mod => {
    const { bot } = trappedBot(TRAP)
    const ac = new AbortController()
    const seen = []
    const real = bot.setControlState.bind(bot)
    bot.setControlState = (n, on) => { seen.push([n, on]); real(n, on) }
    setTimeout(() => ac.abort(), 120)
    await mod.shaftAscend(bot, 60, ac.signal, { deadline: Date.now() + 8_000 }).catch(() => {})
    const forward = seen.filter(([n]) => n === 'forward')
    assert.deepEqual(forward.at(-1), ['forward', true],
      'the mutant released the control anyway, so the test above proves nothing')
  })
})

await ta('MUTANT KILLED: reverting the sidestep to a bare `return` re-freezes the bot', async () => {
  await withMutant(SKILLS_PATH,
    'if (!step) return { gained: p.y - startY, stopped: flood }',
    'if (step || !step) return { gained: p.y - startY, stopped: flood }',
    async mod => {
      const { bot, digs } = trappedBot(TRAP)
      const r = await mod.shaftAscend(bot, 60, new AbortController().signal, { deadline: Date.now() + 8_000 })
      assert.equal(r.stopped, 'liquid beside the block overhead (water)')
      assert.deepEqual(digs, [], 'the mutant is not reproducing the original defect')
      assert.equal(Math.floor(bot.entity.position.x), 0, 'the mutant still moved the bot')
    })
})

await ta('MUTANT KILLED: dropping the guard floods the shaft', async () => {
  await withMutant(SKILLS_PATH, '    if (flood) {', '    if (false) {',
    async mod => {
      const { bot, digs } = trappedBot(SOAKED)
      await mod.shaftAscend(bot, 60, new AbortController().signal, { deadline: Date.now() + 8_000 })
      assert.ok(digs.length > 0,
        'the mutant did not break the wet ceiling, so the safety test above proves nothing')
    })
})

await ta('MUTANT KILLED: treating water as walkable wades the bot into it', async () => {
  await withMutant(SCAFFOLD_PATH,
    'const clear = b => !!b && !isLiquid(b) && b.boundingBox === \'empty\'',
    'const clear = b => !!b && b.boundingBox === \'empty\'',
    async mod => {
      const wet = corridor('e', { [`1,${FEET_Y},0`]: WORLD_WATER })
      assert.ok(mod.dryColumnStep({ at: atOf(wet), isLiquid }),
        'the mutant is not reproducing the water-widening defect')
    })
})

await ta('MUTANT KILLED: ignoring lava walks the bot along it', async () => {
  await withMutant(SCAFFOLD_PATH,
    'if (AXES.some(([sx, sz]) => isLava(at(x + sx, 0, z + sz)) || isLava(at(x + sx, 1, z + sz)))) break',
    'if (false) break',
    async mod => {
      const hot = corridor('e', { [`1,${FEET_Y},1`]: LAVA })
      assert.ok(mod.dryColumnStep({ at: atOf(hot), isLiquid }),
        'the mutant is not reproducing the lava-blind defect')
    })
})

t('the sidestep is bounded, and the cap is a literal the source can be read for', () => {
  const src = readFileSync(SKILLS_PATH, 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const m = code.match(/const MAX_SIDESTEPS = (\d+)/)
  assert.ok(m, 'the sidestep is unbounded — a bot can shuffle sideways instead of climbing')
  assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= 4, `cap is ${m[1]}; that is a wander, not a sidestep`)
  assert.ok(/sidesteps\s*<\s*MAX_SIDESTEPS/.test(code), 'the cap is declared and never consulted')
  assert.ok(/sidesteps\s*\+=\s*1/.test(code), 'the counter never increments')
})

t('THE GUARD ITSELF IS UNTOUCHED: the fix is in what happens after a refusal', () => {
  // overheadBreakRisk is the only liquid authority in the climb, and the
  // sidestep asks it rather than forming a second opinion. A dryColumnStep that
  // decided for itself which columns are dry could drift away from the rule the
  // 262 refusals were measured against.
  const src = readFileSync(SCAFFOLD_PATH, 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const i = code.indexOf('export function dryColumnStep')
  assert.ok(i > 0, 'dryColumnStep moved; re-read this test')
  assert.ok(/overheadBreakRisk\(/.test(code.slice(i)),
    'the sidestep no longer defers to the shipped guard')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

