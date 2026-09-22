// THE WOOD FUNNEL, offline: where does a log-gather actually die?
//
// 69.3% of the fleet's log gathers end in `no_safe_target` (37.3%) or `unreachable` (32.0%), and
// telling those apart on the fleet costs 10 bots x 3 hours through an instrument whose placebo null
// is sd 3.00 against a canary-arm baseline of 0.64. Here it costs milliseconds, because everything
// up to the dig is a pure function of the blocks.
//
// The funnel is gather's own, in gather's own order (skills.mjs):
//   1 isExposed      -- is it a candidate at all
//   2 isSafeToBreak  -- does Movements.safeToBreak admit it (dontCreateFlow OR dontMineUnderFallingBlock)
//   3 approachable   -- gather's LOCAL standing-room stencil
//   4 A*             -- can the REAL move generator get to such a cell
//   5 inReach        -- is the target diggable from there (digging.js geometry)
//
// WHAT THIS IS FOR. It KILLS candidates and RANKS them. It does not calibrate anything: the sandbox
// refusal floor was measured ~3x tighter than live, so an absolute rate off a fixture is worthless.
// A pass here means "not yet dead", never "validated".
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { mkBot, gatherMovements, sceneWorld, reachable, inReach, standable, Vec3 } from './helpers/reachlab.mjs'
// APPARATUS ONLY -- the baseline's predicates, no candidate named. See tree-corpus.test.mjs.
import { isExposed, isSafeToBreak } from '../src/skills.mjs'

const load = k => JSON.parse(readFileSync(new URL(`./fixtures/synthetic-tree-${k}.json`, import.meta.url), 'utf8'))

/**
 * Run one scene through the funnel and say which stage the target died at.
 * `mutate` lets a test alter the movements profile -- that is how the harness is shown to be able to
 * fail, which a harness that has never been seen to fail is not.
 */
function funnel (fx, target, { mutate = null } = {}) {
  const world = sceneWorld(fx)
  const bot = mkBot(world, new Vec3(...fx.bot.pos))
  const m = gatherMovements(bot)
  if (mutate) mutate(m)
  // ASSIGN, do not replace: mkBot's pathfinder stub carries `bestHarvestTool`, which
  // Movements.safeOrBreak needs under canDig=true. Replacing the object removed it and every scene
  // read `no_path` again -- the same silent failure twice in ten minutes, from opposite directions.
  bot.pathfinder.movements = m
  const p = new Vec3(target[0], target[1], target[2])
  const at = { x: p.x, y: p.y, z: p.z, offset: (a, b, c) => ({ ...at, x: p.x + a, y: p.y + b, z: p.z + c,
    offset: (d, e, f) => ({ x: p.x + a + d, y: p.y + b + e, z: p.z + c + f, offset: () => ({}) }) }) }
  // Use the real Vec3 for the predicates -- they only need .offset and blockAt.
  const P = (x, y, z) => Object.assign(new Vec3(x, y, z), { offset: (a, b, c) => P(x + a, y + b, z + c) })
  const tp = P(p.x, p.y, p.z)
  const out = { exposed: isExposed(bot, tp), safe: false, approachable: false, reachable: false, inReach: false }
  out.safe = isSafeToBreak(bot, tp)
  const approach = q => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dy of [0, -1]) if (standable(world, new Vec3(q.x + dx, q.y + dy, q.z + dz))) return true
    }
    return false
  }
  out.approachable = approach(tp)
  const nodes = reachable(m, new Vec3(Math.floor(fx.bot.pos[0]), Math.floor(fx.bot.pos[1]), Math.floor(fx.bot.pos[2])), 4000)
  out.reachable = nodes.length > 1
  out.inReach = nodes.some(n => inReach(n, tp))
  out.stage = !out.exposed ? 'unreachable(buried)' : !out.safe ? 'no_safe_target'
    : !out.inReach ? 'no_path' : 'diggable'
  return out
}
const basal = fx => [fx.origin[0], fx.origin[1], fx.origin[2]]

test('POSITIVE CONTROL: an ordinary tree reaches the dig -- if this fails, every other row is noise', () => {
  const r = funnel(load('open'), basal(load('open')))
  assert.equal(r.exposed, true)
  assert.equal(r.safe, true, 'the control tree is being refused by the safety rule')
  assert.equal(r.inReach, true, 'A* could not put the bot within digging range of an open tree')
  assert.equal(r.stage, 'diggable')
})

test('the canopy tree dies at stage 1, and the cover fallback is the only thing that can admit it', () => {
  const fx = load('canopy'); const r = funnel(fx, basal(fx))
  assert.equal(r.stage, 'unreachable(buried)')
})

test('THE SHORELINE TREE DIES AT STAGE 2, and stage 2 ONLY -- one variable', () => {
  const fx = load('shoreline'); const r = funnel(fx, basal(fx))
  assert.equal(r.exposed, true, 'it must clear stage 1, or it is testing burial')
  assert.equal(r.safe, false, 'Movements.safeToBreak did NOT refuse it -- the fixture tests nothing')
  assert.equal(r.stage, 'no_safe_target')
  // And the bot can physically get beside it. The refusal is the rule, not the terrain.
  assert.equal(r.approachable, true, 'no standing room beside the shoreline tree')
  assert.equal(r.inReach, true, 'A* cannot reach it either, so the liquid rule is not what is binding')
})

test('MUTANT: the harness CAN see the liquid rule -- clearing dontCreateFlow flips the shoreline tree', () => {
  // A harness that answers "refused" for the wrong reason would pass the test above while measuring
  // nothing. This is the positive control on the instrument itself.
  const fx = load('shoreline')
  const before = funnel(fx, basal(fx))
  const after = funnel(fx, basal(fx), { mutate: m => { m.dontCreateFlow = false } })
  assert.equal(before.safe, false)
  assert.equal(after.safe, true,
    'clearing dontCreateFlow did not change the verdict, so safeToBreak is not what refused it')
  assert.equal(after.stage, 'diggable', 'with the liquid rule off it must reach the dig')
})

test('MUTANT: canDig=false refuses EVERYTHING -- the profile is load-bearing, not decoration', () => {
  const fx = load('open')
  const r = funnel(fx, basal(fx), { mutate: m => { m.canDig = false } })
  assert.equal(r.safe, false, 'safeToBreak ignores canDig, so this harness is using the wrong profile')
})

test('NEGATIVE CONTROL: the stone-encased log stays buried and uncovered', () => {
  const fx = load('buried')
  const r = funnel(fx, [fx.origin[0], fx.origin[1] - 6, fx.origin[2]])
  assert.equal(r.stage, 'unreachable(buried)')
})

test('LEAKAGE CONTROL: wet underground stone is refused at stage 2 and is not a log', () => {
  const fx = load('wetstone')
  const r = funnel(fx, [fx.origin[0] + 1, fx.origin[1] - 10, fx.origin[2]])
  assert.equal(r.safe, false, 'the leakage control is not being refused, so it cannot detect a leak')
})

test('the funnel reports a STAGE for every fixture, and the stages are the fleet\'s own classes', () => {
  const seen = new Set()
  for (const [k, t] of [['open', null], ['canopy', null], ['shoreline', null],
                        ['buried', [0, -6, 0]], ['wetstone', [1, -10, 0]]]) {
    const fx = load(k)
    const tgt = t ? [fx.origin[0] + t[0], fx.origin[1] + t[1], fx.origin[2] + t[2]] : basal(fx)
    seen.add(funnel(fx, tgt).stage)
  }
  assert.ok(seen.has('diggable') && seen.has('no_safe_target') && seen.has('unreachable(buried)'),
    `the corpus does not cover the fleet's dominant classes: ${[...seen]}`)
})
