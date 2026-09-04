/**
 * THE ROUTE THE RESCUE STEERS AT WAS NOT MEASURED AGAINST THE RELEASE THAT
 * GRADES IT, AND THE GAP WAS READ AS AN ESCAPE PLAN.
 *
 * `_drowning_route` said `out dist=2` for placebo-b-Delta, thousands of times,
 * at health 20/20. That line was read -- by me, in a brief, and by the commit
 * message of 28986af -- as "air is two blocks sideways and the bot is not
 * taking it". It is not. Read out of the world by RCON at the coordinates the
 * server itself reports for that bot (`data get entity placebo-b-Delta Pos` ->
 * [420.7d, 44.2d, -306.7d], world placebo-b, 2026-09-04 16:0x UTC):
 *
 *     (420, 45, -307)  water        <- the bot's head
 *     (420, 46, -307)  diorite      <- ceiling, so `up` is closed. Correct.
 *     (420, 45, -308)  water
 *     (420, 45, -309)  seagrass     <- THE `dist=2` TARGET
 *
 * and the same bot's server-side `Air` is 300 of 300 with `Health` 20.0f. The
 * route was a plant. `breathableRoute` had its own air predicate --
 * `name !== 'water' && boundingBox === 'empty'` -- while the rescue is released
 * by `breathable()` in air.mjs, and against the vendored registry for the
 * deployed 1.21.8 those two disagree about seagrass, tall_seagrass, kelp,
 * kelp_plant, bubble_column, every waterlogged block with an empty box, and
 * LAVA. All are `boundingBox: 'empty'`; none is named `water`.
 *
 * THE DENOMINATOR, because the brief did not say it: of the nine bots burning
 * permanent drowning rescues in the measured 3h window, SIX report `sealed`
 * (`dist=-1`) and have no sideways route at all; three report `out`. Of those
 * three, one is the seagrass above, one (isolated-c-Comet, world isolated-c) is
 * real air at (637,21,232) with solid gravel at foot level and stone over the
 * bot's own head so it can neither step nor jump into it, and one has its head
 * in air already. "Dig toward the horizontal route" would, on the measured
 * population, swing at a plant for one bot, help one bot, and do nothing at all
 * for six.
 *
 * WHAT IS ACTUALLY MEASURED, and it is the escape ramp, not the route: every
 * `_entombed_ramp_cut` on five of the nine reads, verbatim,
 *
 *     stopped because yielded the body to the drowning rescue
 *     stopped because ceiling dig failed on stone: Digging aborted
 *
 * -- the second being `seizeBody()`'s `stopDigging()` landing inside a 7.5s
 * bare-handed swing. The ramp is already correct and already material-free. It
 * is being cut off by a rescue that, at 300/300 air, cannot help.
 *
 * So this file pins two things:
 *   1. the route may only call AIR what the release calls air (and lava is
 *      never air, and never swimmable);
 *   2. `sealed` is a THIRD answer, not a synonym for `dir: null` -- an out of
 *      range scan in open water is not a wall, and neither is an unreadable
 *      cell -- because suppression is now allowed to read it.
 */
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import {
  scanBreathableRoute, breathableRoute, drownRescueSuppressed, escapeStairUp,
} from '../src/reflex.mjs'
import { breathable } from '../src/air.mjs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)

// VERBATIM from climb-escape.test.mjs:447-458 / escape-stair.test.mjs. It
// writes a separate module and never touches src/: run-tests.mjs kills a slow
// file with an uncatchable SIGKILL, and fleet-recycle restarts every bot onto
// $H/src every six hours, so an in-place mutant is a deploy.
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// --- blocks, with the registry's REAL bounding boxes -------------------------
//
// Verified against the vendored minecraft-data for 1.21.8, which is what the
// fleet is connected to: every one of these reports `boundingBox: 'empty'`.
// A fixture that made seagrass or lava solid would let these tests pass without
// the behaviour they exist to prove.
const B = n => ({ name: n, boundingBox: 'block' })
const E = n => ({ name: n, boundingBox: 'empty' })
const AIR = E('air'), WATER = E('water'), LAVA = E('lava')
const SEAGRASS = E('seagrass'), KELP = E('kelp_plant'), BUBBLES = E('bubble_column')
const STONE = B('stone'), DIORITE = B('diorite')
// A waterlogged stair: solid-looking to a bounding box test, full of water to
// anything that asks the block itself.
const WET_STAIR = { name: 'oak_stairs', boundingBox: 'empty',
                    getProperties: () => ({ waterlogged: 'true' }) }

/** A world as a map keyed on offsets from the HEAD cell, defaulting to stone. */
const around = (cells = {}, fill = STONE) =>
  (dx, dy, dz) => (Object.prototype.hasOwnProperty.call(cells, `${dx},${dy},${dz}`)
    ? cells[`${dx},${dy},${dz}`] : fill)

// ============================================================================
// A. ONE AIR PREDICATE. The route may only promise what the release accepts.
// ============================================================================

await t('POSITIVE CONTROL: real air two blocks out is still found, and reported as out dist=2', () => {
  // If this fails, every negative below is an instrument that cannot see.
  const r = scanBreathableRoute({ at: around({
    '0,0,-1': WATER, '0,0,-2': AIR,
  }) })
  assert.equal(r.dir, 'out', `expected out, got ${r.dir}`)
  assert.equal(r.dist, 2)
  assert.equal(r.sealed, false)
})

await t("placebo-b-Delta's pocket, block for block: the `out dist=2` was SEAGRASS", () => {
  // The exact cells read by RCON, expressed as offsets from the head at
  // (420,45,-307). Nothing else in that pocket is passable.
  const r = scanBreathableRoute({ at: around({
    '0,1,0': DIORITE,          // (420,46,-307), the ceiling that closes `up`
    '0,0,-1': WATER,           // (420,45,-308)
    '0,0,-2': SEAGRASS,        // (420,45,-309)  <- what was called air
    '0,1,-1': WATER, '0,1,-2': WATER,
    '-1,0,0': WATER, '-2,0,0': WATER, '-3,0,0': WATER,
    '-1,1,0': WATER, '-2,1,0': WATER, '-3,1,0': WATER,
  }) })
  assert.equal(r.dir, null,
    `a plant growing in water is not an exit; got ${r.dir} dist=${r.dist}`)
  assert.equal(breathable(SEAGRASS), false,
    'if the release ever starts calling seagrass air, this whole test is moot')
})

await t('kelp, bubble columns and waterlogged blocks are not air either', () => {
  for (const [what, blk] of [['kelp', KELP], ['bubble_column', BUBBLES],
                             ['a waterlogged stair', WET_STAIR]]) {
    const r = scanBreathableRoute({ at: around({ '0,0,1': blk }) })
    assert.equal(r.dir, null, `${what} was offered as an exit (${r.dir} dist=${r.dist})`)
  }
})

await t('LAVA IS NEVER AIR, and never a column to swim up', () => {
  // `lava` is boundingBox 'empty' and is not named water, so the old predicate
  // answered `up` for a bot under a lava ceiling and `drowningControls` held
  // jump into it.
  const r = scanBreathableRoute({ at: around({ '0,1,0': LAVA, '0,2,0': AIR }) })
  assert.notEqual(r.dir, 'up', 'the route ran the bot up through lava to reach air')
  assert.equal(r.dir, null)
})

await t('LAVA IS NEVER A CORRIDOR either: air beyond it is not reachable', () => {
  const r = scanBreathableRoute({ at: around({ '1,0,0': LAVA, '2,0,0': AIR }) })
  assert.equal(r.dir, null, 'the sideways scan swam through lava to find air')
})

await t('water and open air still conduct the scan — the narrowing is only about AIR', () => {
  const r = scanBreathableRoute({ at: around({
    '0,1,0': WATER, '0,2,0': WATER, '0,3,0': WATER, '0,4,0': AIR,
  }) })
  assert.equal(r.dir, 'up')
  assert.equal(r.dist, 4)
})

// ============================================================================
// B. `sealed` IS A THIRD ANSWER. A tri-state you can read as a bool is a bool.
// ============================================================================

await t('every axis closed by rock we READ is sealed', () => {
  const r = scanBreathableRoute({ at: around({}) })          // solid stone all round
  assert.equal(r.dir, null)
  assert.equal(r.sealed, true)
})

await t('OUT OF RANGE IS NOT SEALED: 33 blocks under an ocean surface, jump is right', () => {
  // The scan gives up at maxUp/maxOut. Reading that as "sealed" would let
  // suppression hold a rescue on a bot in open water, which is the one thing
  // the owner directive keeps.
  const deepOcean = (dx, dy, dz) => AIR.name && (dy > 40 ? AIR : WATER)
  const r = scanBreathableRoute({ at: deepOcean, maxUp: 32, maxOut: 8 })
  assert.equal(r.dir, null, 'the surface is beyond the scan; nothing should be promised')
  assert.equal(r.sealed, false, 'an unscanned column was reported as a wall')
})

await t('one open axis that runs off the end of the scan is not sealed', () => {
  const r = scanBreathableRoute({ at: around({
    '1,0,0': WATER, '2,0,0': WATER, '3,0,0': WATER, '4,0,0': WATER,
    '5,0,0': WATER, '6,0,0': WATER, '7,0,0': WATER, '8,0,0': WATER,
  }) })
  assert.equal(r.dir, null)
  assert.equal(r.sealed, false, 'a corridor we did not reach the end of is not a wall')
})

await t('AN UNREADABLE CELL IS NOT A WALL — unloaded chunks must fail open', () => {
  const r = scanBreathableRoute({ at: (dx, dy, dz) => (dx === 1 && dy === 0 ? null : STONE) })
  assert.equal(r.dir, null)
  assert.equal(r.sealed, false,
    'an unloaded chunk was read as proof the bot is sealed in')
})

await t('breathableRoute keeps its old shape and carries the new field', () => {
  const bot = {
    entity: { position: { offset: (a, b, c) => ({ x: a, y: 1 + b, z: c,
      offset: (d, e, f) => ({ x: a + d, y: 1 + b + e, z: c + f }) }) } },
    blockAt: p => (p.x === 0 && p.y === 3 && p.z === 0 ? AIR : (p.y >= 2 ? WATER : STONE)),
  }
  const r = breathableRoute(bot)
  assert.equal(r.dir, 'up')
  assert.ok(r.target, 'the caller steers at target; it must still be a position')
  assert.equal(r.sealed, false)
  // And it must never throw on a half-connected bot.
  assert.doesNotThrow(() => breathableRoute({}))
  assert.equal(breathableRoute({}).sealed, false, 'a bot we cannot read is not sealed')
})

// ============================================================================
// C. SUPPRESSION MAY READ `sealed`, AND HEALTH STILL OUTRANKS IT.
// ============================================================================

await t('a move inside a sealed pocket no longer re-arms the rescue', () => {
  // This is the change. Two ramp steps are 2.83 blocks -- past the 1.5 the old
  // rule cleared on -- so the escape undid its own permission to run.
  assert.equal(drownRescueSuppressed({ failures: 2, movedBlocks: 2.83, sealedHere: true }), true)
  assert.equal(drownRescueSuppressed({ failures: 2, movedBlocks: 2.83, sealedHere: false }), false,
    'a bot that moved and can reach air must get its rescue back')
})

await t('THE SAFETY PROPERTY IS UNCHANGED: losing health outranks sealed, always', () => {
  for (const f of [0, 1, 2, 10, 978, Number.MAX_SAFE_INTEGER]) {
    for (const moved of [0, 1.4, 2.83, 40]) {
      assert.equal(
        drownRescueSuppressed({ failures: f, movedBlocks: moved,
                                sealedHere: true, healthDropped: true }), false,
        `health dropped at ${f} failures / ${moved} blocks and the rescue was still suppressed`)
    }
  }
})

await t('sealed cannot manufacture suppression on its own', () => {
  assert.equal(drownRescueSuppressed({ failures: 0, sealedHere: true }), false,
    'the first rescue must always run')
  assert.equal(drownRescueSuppressed({ failures: 1, sealedHere: true }), false,
    'the second must too')
})

await t('a missing or junk `sealedHere` reads as NOT sealed — fail open', () => {
  assert.equal(drownRescueSuppressed({ failures: 9, movedBlocks: 40 }), false)
  for (const junk of ['yes', 1, {}, [], 'false']) {
    assert.equal(drownRescueSuppressed({ failures: 9, movedBlocks: 40, sealedHere: junk }), false,
      `a truthy non-boolean (${JSON.stringify(junk)}) suppressed a rescue`)
  }
  assert.equal(drownRescueSuppressed({ failures: 9, movedBlocks: NaN, sealedHere: true }), false,
    'an unknown distance must still fail open')
})

// ============================================================================
// D. THE CHAIN. Not the guard -- every trap this project has hit passed its own
//    unit tests. drowning-yields -> the escape handler RUNS -> what it produces.
// ============================================================================

const DIG_MS = { stone: 7500, diorite: 7500, granite: 7500, deepslate: 15_000,
                 dirt: 750, gravel: 3000, obsidian: 250_000 }

const blk = (name, pos) => {
  if (name === 'air' || name === 'water' || name === 'lava') {
    return { name, boundingBox: 'empty', position: pos }
  }
  return { name, boundingBox: 'block', position: pos, diggable: true,
           digTime: () => DIG_MS[name] ?? 7500, canHarvest: () => false }
}

const V = (x, y, z) => ({ x, y, z,
  offset: (a, b, c) => V(x + a, y + b, z + c), clone: () => V(x, y, z),
  distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) })

/**
 * A FLOODED pocket, addressed relative to the bot's feet.
 *
 * TWO WATER MODELS, because the measured pockets come in both shapes and they
 * give the escape ramp opposite outcomes. Stating the model is the point: a
 * fixture that silently picked one would be arguing for the change rather than
 * testing it.
 *
 *   'seeps'  a cut cell fills only if a neighbour is already water. This is
 *            hive-a-Echo's shape -- a pocket beside standing water, with rock
 *            above. The ramp's jump-clearance cell is cut into dry rock and
 *            STAYS DRY, so the bot gets air over its head after one step.
 *   'table'  every cut cell below `table` fills. This is placebo-b-Delta's
 *            shape: a body of water fills y=45..48 right beside and above it,
 *            over a diorite lid, so a ramp cut inside that band floods behind
 *            the bot and it stays submerged while it climbs.
 *
 * Water spreads seven cells horizontally and falls without limit, which is why
 * neither model needs to be cleverer than this to be fair.
 */
function floodedPocket ({ model = 'seeps', table = 0 } = {}) {
  const m = new Map([['0,0,0', 'water'], ['0,1,0', 'water']])
  const get = (x, y, z) => m.get(`${x},${y},${z}`) ?? 'stone'
  return {
    get,
    dig (x, y, z) {
      const wet = model === 'table'
        ? y < table
        : ['0,1,0', '0,-1,0', '1,0,0', '-1,0,0', '0,0,1', '0,0,-1'].some(o => {
          const [a, b, c] = o.split(',').map(Number)
          return get(x + a, y + b, z + c) === 'water'
        })
      m.set(`${x},${y},${z}`, wet ? 'water' : 'air')
    },
    set (x, y, z, name) { m.set(`${x},${y},${z}`, name) },
  }
}

function makeBot (w, { y = 47 } = {}) {
  let yaw = 0
  const bot = {
    entity: { position: V(0, y, 0), get yaw () { return yaw } },
    heldItem: null,
    health: 20,
    inventory: { items: () => [] },
    blockAt: p => blk(w.get(p.x, p.y - y, p.z), p),
    async unequip () { bot.heldItem = null },
    async dig (b) { w.dig(b.position.x, b.position.y - y, b.position.z) },
    stopDigging () {}, clearControlStates () {},
    async look (a) { yaw = a },
    setControlState (name, on) {
      if (name !== 'forward' || !on) return
      const N = { x: 0, z: -1 }, S = { x: 0, z: 1 }, Ee = { x: 1, z: 0 }, W = { x: -1, z: 0 }
      const bear = [N, W, S, Ee][((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4]
      const rel = { x: bot.entity.position.x, z: bot.entity.position.z }
      const dy = bot.entity.position.y - y
      const cell = (a, b, c) => blk(w.get(a, b, c), V(a, b, c))
      const tread = cell(rel.x + bear.x, dy, rel.z + bear.z)
      const feet = cell(rel.x + bear.x, dy + 1, rel.z + bear.z)
      const head = cell(rel.x + bear.x, dy + 2, rel.z + bear.z)
      const clear = b => b.boundingBox === 'empty'
      if (tread.boundingBox !== 'block' || !clear(feet) || !clear(head)) return
      bot.entity.position = V(rel.x + bear.x, bot.entity.position.y + 1, rel.z + bear.z)
    },
    pathfinder: { thinkTimeout: 1000, movements: null, setGoal () {},
                  getPathTo () { return { path: [] } } },
  }
  return bot
}

/** The production composition, as one value: route -> suppression -> owner. */
const chainState = (bot, { failures, startPos }) => {
  const route = breathableRoute(bot)
  const suppressed = drownRescueSuppressed({
    failures,
    movedBlocks: startPos.distanceTo(bot.entity.position),
    healthDropped: false,
    sealedHere: route.sealed === true,
  })
  return { route, suppressed, owner: suppressed ? null : 'the drowning rescue' }
}

await t('CHAIN 0 (control): while the rescue owns the body the ramp cuts nothing', async () => {
  // Reproduces the live string verbatim. If this passed for the wrong reason
  // every chain test below would prove nothing, so it is asserted first.
  const bot = makeBot(floodedPocket())
  const r = await escapeStairUp(bot, { maxSteps: 2, budgetMs: 20_000,
                                       yieldTo: () => 'the drowning rescue' })
  assert.equal(r.steps, 0)
  assert.equal(r.stopped, 'yielded the body to the drowning rescue',
    'the control must reproduce the measured failure verbatim')
})

await t('CHAIN 1: sealed -> the rescue stands down -> the ramp CUTS and the bot climbs', async () => {
  const w = floodedPocket({ model: 'seeps' })
  const bot = makeBot(w)
  const startPos = bot.entity.position.clone()

  // 1. the route: sealed, and NOT merely "the scan found nothing".
  const first = chainState(bot, { failures: 0, startPos })
  assert.equal(first.route.dir, null)
  assert.equal(first.route.sealed, true, 'the fixture is not the measured shape')

  // 2. two ceilings expire here with no air and no harm -> the body is yielded.
  const armed = chainState(bot, { failures: 2, startPos })
  assert.equal(armed.suppressed, true)
  assert.equal(armed.owner, null, 'nothing may own the body when the rescue stood down')

  // 3. the escape handler, driven by that same decision RECOMPUTED against the
  //    live world after every action -- which is the composition, not the guard.
  const failures = 2
  const r = await escapeStairUp(bot, {
    maxSteps: 2, budgetMs: 30_000,
    yieldTo: () => chainState(bot, { failures, startPos }).owner,
  })
  assert.ok(r.steps >= 1, `the ramp cut nothing: stopped=${r.stopped} breached=${r.breached}`)
  assert.ok(bot.entity.position.y > startPos.y,
    `the bot did not gain height (y=${bot.entity.position.y} from ${startPos.y})`)

  // 4. AND THE SUPPRESSION GETS OUT OF THE WAY THE MOMENT IT SHOULD. In this
  //    shape the ramp cuts dry rock overhead, so the bot now HAS a route: the
  //    rescue is armed again and this time it can actually finish the job.
  const after = chainState(bot, { failures, startPos })
  assert.equal(after.route.sealed, false, 'a ramp into dry rock leaves air overhead')
  assert.equal(after.route.dir, 'up', `expected a usable route up, got ${after.route.dir}`)
  assert.equal(after.suppressed, false,
    'suppression outlived its evidence: air is reachable and the body is still withheld')
})

await t('CHAIN 2: a ramp that floods behind the bot must not re-arm the rescue with its own progress', async () => {
  // THE CASE THE CHANGE EXISTS FOR. One ramp step is 1.41 blocks and two are
  // 2.83 -- past the 1.5 the old rule cleared on -- so in a pocket under a
  // water table the escape switched its own permission off, `seizeBody()`
  // called `stopDigging()`, and a 7.5s bare-handed swing died mid-stroke. That
  // string is 2 of the 2 distinct ramp failures in the live logs today.
  const w = floodedPocket({ model: 'table', table: 8 })
  const bot = makeBot(w)
  const startPos = bot.entity.position.clone()
  assert.equal(chainState(bot, { failures: 2, startPos }).suppressed, true)

  const failures = 2
  const r = await escapeStairUp(bot, {
    maxSteps: 2, budgetMs: 30_000,
    yieldTo: () => chainState(bot, { failures, startPos }).owner,
  })
  assert.ok(r.steps >= 2, `the ramp stopped early: stopped=${r.stopped}`)

  const moved = startPos.distanceTo(bot.entity.position)
  assert.ok(moved >= 1.5, `the ramp only moved the bot ${moved.toFixed(2)} blocks`)
  const after = chainState(bot, { failures, startPos })
  assert.equal(after.route.sealed, true, 'the flooded ramp surfaced the bot; wrong fixture')
  assert.equal(after.suppressed, true,
    'the escape re-armed the rescue with its own progress, which is the whole bug')
  assert.equal(
    drownRescueSuppressed({ failures, movedBlocks: moved, healthDropped: false }), false,
    'the OLD rule must clear here, or this test is not about the change')
})

await t('CHAIN 3: suppression never outlives its evidence — health or air ends it', () => {
  const w = floodedPocket({ model: 'table', table: 8 })
  const bot = makeBot(w)
  const startPos = bot.entity.position.clone()
  assert.equal(chainState(bot, { failures: 9, startPos }).suppressed, true)

  // The ramp breaks out above the water: air over the bot's head, so the route
  // is no longer sealed, and the next move hands the body straight back.
  w.set(0, 2, 0, 'water'); w.set(0, 3, 0, 'air'); w.set(0, 4, 0, 'air')
  const now = chainState(bot, { failures: 9, startPos })
  assert.equal(now.route.dir, 'up', `air overhead must be seen; got ${now.route.dir}`)
  assert.equal(now.route.sealed, false)
  assert.equal(now.suppressed, true,
    'the bot has not moved, so the place-scoped evidence still stands')
  bot.entity.position = V(0, 49, 0)          // two blocks up the vent it cut
  assert.equal(chainState(bot, { failures: 9, startPos }).suppressed, false,
    'air is reachable and the bot has moved: the rescue must run again')

  // And harm ends it instantly, wherever the bot is and whatever the route says.
  assert.equal(drownRescueSuppressed({ failures: 9, movedBlocks: 0,
                                       sealedHere: true, healthDropped: true }), false)
})

// ============================================================================
// E. MUTANTS. Each asserts its anchor is present AND unique before it applies.
// ============================================================================

await t('MUTANT KILLED: restoring the old private air predicate re-offers the seagrass', async () => {
  await withMutant(REFLEX_PATH,
    "export function scanBreathableRoute ({ at = () => null, maxUp = 32, maxOut = 8,\n                                       isAir = breathable } = {}) {",
    "export function scanBreathableRoute ({ at = () => null, maxUp = 32, maxOut = 8,\n                                       isAir = b => b != null && b.name !== 'water' && b.boundingBox === 'empty' } = {}) {",
    async mod => {
      const r = mod.scanBreathableRoute({ at: around({
        '0,1,0': DIORITE, '0,0,-1': WATER, '0,0,-2': SEAGRASS,
        '0,1,-1': WATER, '0,1,-2': WATER,
      }) })
      assert.equal(r.dir, 'out',
        'the mutant is not reproducing the defect, so the test above proves nothing')
      assert.equal(r.dist, 2, 'and it is the exact `out dist=2` from the fleet logs')
    })
})

await t('MUTANT KILLED: letting the scan swim through lava routes a bot into it', async () => {
  await withMutant(REFLEX_PATH,
    "    b != null && b.name !== 'lava' && (b.name === 'water' || b.boundingBox === 'empty')",
    "    b != null && (b.name === 'water' || b.boundingBox === 'empty')",
    async mod => {
      const r = mod.scanBreathableRoute({ at: around({ '1,0,0': LAVA, '2,0,0': AIR }) })
      assert.equal(r.dir, 'out',
        'the mutant did not swim through lava, so the lava test proves nothing')
    })
})

await t('MUTANT KILLED: collapsing `sealed` back onto `dir === null` suppresses in open water', async () => {
  await withMutant(REFLEX_PATH,
    'return { ...best, sealed: best.dir == null && capped && allClosed && !unknown }',
    'return { ...best, sealed: best.dir == null }',
    async mod => {
      const deepOcean = (dx, dy, dz) => (dy > 40 ? AIR : WATER)
      const r = mod.scanBreathableRoute({ at: deepOcean, maxUp: 32, maxOut: 8 })
      assert.equal(r.sealed, true,
        'the mutant did not reproduce the tri-state-as-a-bool defect')
      // And that is exactly what would hold a rescue off a bot in open water.
      assert.equal(mod.drownRescueSuppressed(
        { failures: 2, movedBlocks: 40, sealedHere: r.sealed }), true,
        'the harm this distinction prevents is not reachable from the mutant')
    })
})

await t('MUTANT KILLED: reading an unloaded chunk as a wall', async () => {
  await withMutant(REFLEX_PATH,
    'allClosed && !unknown }',
    'allClosed }',
    async mod => {
      // The mutant leaves `unknown` permanently false: a null neighbour then
      // reads as sealed. Only meaningful if the real one says otherwise, which
      // the test above asserts.
      const r = mod.scanBreathableRoute({ at: (dx, dy, dz) => (dx === 1 && dy === 0 ? null : STONE) })
      assert.equal(r.sealed, true,
        'the mutant is not reproducing the fail-closed defect')
    })
})

await t('MUTANT KILLED: making `sealedHere` truthy-tested lets a route object suppress', async () => {
  await withMutant(REFLEX_PATH,
    'if (movedBlocks >= DROWN_MOVED_BLOCKS && sealedHere !== true) return false',
    'if (movedBlocks >= DROWN_MOVED_BLOCKS && !sealedHere) return false',
    async mod => {
      assert.equal(mod.drownRescueSuppressed(
        { failures: 9, movedBlocks: 40, sealedHere: 'no' }), true,
        'the mutant is not reproducing the truthiness defect')
    })
})

await t('MUTANT KILLED: dropping the health override would let sealed hide a drowning', async () => {
  // The one property that must never break. Pinned against the mutant that
  // reorders it behind the new clause rather than against today's text.
  await withMutant(REFLEX_PATH,
    'if (healthDropped) return false                 // real harm always outranks this',
    'if (healthDropped && false) return false',
    async mod => {
      assert.equal(mod.drownRescueSuppressed(
        { failures: 2, movedBlocks: 40, sealedHere: true, healthDropped: true }), true,
        'the mutant is not reproducing the defect the safety test forbids')
    })
})

console.log(`\n  ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
