// One unreachable drop must not abandon the others.
//
// pickupNearbyItems always takes the NEAREST item, and it used to `return` on
// two single-drop conditions: seeing the same entity id twice, and a goto that
// threw. So one drop the bot cannot reach sits closest forever and hides every
// other drop behind it -- the bot walks away from wood it has already broken.
//
// Exposure, 24h to 2026-09-21 19:40Z: gather's barren-limit message says
// "[collect threw nothing -- it returned without gathering]" on 3,054 runs,
// 8.8% of 34,775 gathers, across 77 of 80 bots.
import assert from 'node:assert/strict'
import test from 'node:test'
import { pickupNearbyItems } from '../src/skills.mjs'

const V = (x, y, z) => ({ x, y, z, distanceTo (o) {
  return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) } })

/**
 * `unreachable` names ids whose goto throws. `stuck` names ids the goto resolves
 * for without moving the bot -- pathfinder.goto resolves on reaching the goal it
 * could compute, not on reaching the drop.
 */
function botWith (drops, { unreachable = new Set(), stuck = new Set() } = {}) {
  const visited = []
  const alive = new Map(drops.map(d => [d.id, d]))
  const bot = {
    entity: { position: V(0, 0, 0) },
    nearestEntity (pred) {
      const c = [...alive.values()].filter(pred)
      c.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))
      return c[0] ?? null
    },
    pathfinder: {
      async goto (goal) {
        const id = [...alive.values()].find(d =>
          d.position.x === goal.x && d.position.y === goal.y && d.position.z === goal.z)?.id
        visited.push(id)
        if (unreachable.has(id)) throw new Error('NoPath')
        if (stuck.has(id)) return            // resolved, but the bot did not move
        bot.entity.position = V(goal.x, goal.y, goal.z)
        alive.delete(id)                     // walking onto a drop collects it
      },
    },
  }
  return { bot, visited, alive }
}
const item = (id, x) => ({ id, name: 'item', position: V(x, 0, 0) })
const goalsShim = () => {}

test('THE BUG: an unreachable nearest drop no longer abandons the ones behind it', async () => {
  const { bot, visited, alive } = botWith(
    [item(1, 1), item(2, 3), item(3, 4)], { unreachable: new Set([1]) })
  await pickupNearbyItems(bot, null)
  assert.ok(visited.includes(2) && visited.includes(3),
    `the sweep stopped at the bad drop; it visited ${JSON.stringify(visited)}`)
  assert.equal(alive.has(2), false, 'drop 2 was never collected')
  assert.equal(alive.has(3), false, 'drop 3 was never collected')
})

test('a drop the walk resolves for WITHOUT arriving is retired, not orbited', async () => {
  // This is what the old `same id twice` guard was really for, and it is kept --
  // but as a reason to skip that drop, not to end the sweep.
  const { bot, visited, alive } = botWith(
    [item(1, 1), item(2, 3)], { stuck: new Set([1]) })
  await pickupNearbyItems(bot, null)
  assert.equal(visited.filter(v => v === 1).length, 1, 'it orbited the stuck drop')
  assert.ok(visited.includes(2), 'it never reached the second drop')
  assert.equal(alive.has(2), false)
})

test('the ordinary case is unchanged: nearest first, all collected', async () => {
  const { bot, visited, alive } = botWith([item(1, 3), item(2, 1), item(3, 2)])
  await pickupNearbyItems(bot, null)
  assert.deepEqual(visited, [2, 3, 1], 'nearest-first order was not preserved')
  assert.equal(alive.size, 0)
})

test('no drops in range returns immediately', async () => {
  const { bot, visited } = botWith([{ id: 9, name: 'item', position: V(50, 0, 0) }])
  await pickupNearbyItems(bot, null)
  assert.deepEqual(visited, [])
})

test('THE BUDGET IS UNCHANGED: at most four walks, however many drops there are', async () => {
  // A sweep that skipped freely could otherwise walk forever inside a gather's
  // 40s collect budget. Skipping changes WHICH drop the budget buys, not how much.
  const { bot, visited } = botWith([1, 2, 3, 4, 5, 6].map((id, i) => item(id, i + 1)))
  await pickupNearbyItems(bot, null)
  assert.equal(visited.length, 4)
})

test('every drop unreachable still terminates, and spends no more than the budget', async () => {
  const { bot, visited } = botWith(
    [item(1, 1), item(2, 2), item(3, 3)], { unreachable: new Set([1, 2, 3]) })
  await pickupNearbyItems(bot, null)
  assert.equal(visited.length, 3, 'it must try each once and then find nothing left')
})

test('an abort still propagates and is never swallowed as a refused drop', async () => {
  const { bot } = botWith([item(1, 1)])
  bot.pathfinder.goto = async () => { throw Object.assign(new Error('aborted'), { aborted: true }) }
  await assert.rejects(() => pickupNearbyItems(bot, null), /aborted/)
})

// ----------------------------------------------------------------- mutants
// Each asserts its anchor is present AND unique before applying: a mutation
// that silently fails to apply reads as "killed".
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)

async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}.`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

test('MUTANT KILLED: returning on a failed walk restores the abandoned sweep', async () => {
  await withMutant(SKILLS_PATH,
    // Anchor updated when the change row landed between the retire and the continue.
    // The mutant refused to apply rather than reading as killed, which is what the
    // uniqueness-and-presence assertion in withMutant is for.
    "      refused.add(drop.id)\n      logEvent({ kind: 'pickup_skipped', status: 'success',\n" +
    "                 detail: `drop ${drop.id} refused the walk; retired it and kept sweeping ` +\n" +
    "                         `(${refused.size} retired, attempt ${i + 1}/4) err=${e?.failClass ?? e?.name ?? 'Error'} ` +\n" +
    "                         `item=${what} d=${off} ms=${Date.now() - walkT0}` })\n      continue\n    }",
    "      return\n    }",
    async mod => {
      const { bot, visited } = botWith(
        [item(1, 1), item(2, 3), item(3, 4)], { unreachable: new Set([1]) })
      await mod.pickupNearbyItems(bot, null)
      assert.deepEqual(visited, [1],
        'the mutant is not reproducing the defect, so the test above proves nothing')
    })
})

test('MUTANT KILLED: not retiring a walked drop orbits it for the whole budget', async () => {
  await withMutant(SKILLS_PATH,
    "    refused.add(drop.id)\n  }\n}",
    "  }\n}",
    async mod => {
      const { bot, visited } = botWith([item(1, 1), item(2, 3)], { stuck: new Set([1]) })
      await mod.pickupNearbyItems(bot, null)
      assert.equal(visited.filter(v => v === 1).length, 4,
        'the mutant did not restore the orbit')
      assert.equal(visited.includes(2), false, 'the mutant still reached the second drop')
    })
})

test('MUTANT KILLED: dropping the refused filter re-picks the same drop forever', async () => {
  await withMutant(SKILLS_PATH,
    "      e.name === 'item' && !refused.has(e.id) &&",
    "      e.name === 'item' &&",
    async mod => {
      const { bot, visited } = botWith([item(1, 1), item(2, 3)], { unreachable: new Set([1]) })
      await mod.pickupNearbyItems(bot, null)
      assert.deepEqual(visited, [1, 1, 1, 1], 'the mutant did not restore the fixation')
    })
})


test('THE CHANGE ROW is emitted on the branch HEAD cannot reach, and only there', async () => {
  // A read of this fix needs a denominator, and a row the baseline also emits cannot
  // show the change acted -- three canaries were reverted on exactly that. HEAD
  // `return`s where this logs, so the row is unreachable there by construction.
  const src = readFileSync(SKILLS_PATH, 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const body = src.slice(src.indexOf('async function pickupNearbyItems'))
  const fn = body.slice(0, body.indexOf('\n}'))
  assert.equal(fn.split("kind: 'pickup_skipped'").length - 1, 1,
    'the change row must be emitted exactly once, on the retire-and-continue branch')
  assert.ok(/refused\.add\(drop\.id\)\s*\n\s*logEvent\(\{ kind: 'pickup_skipped'/.test(fn),
    'the row must sit on the branch that retires a drop, not somewhere a clean sweep reaches')
  assert.equal(/return[\s\S]{0,40}pickup_skipped/.test(fn), false,
    'the row must not be on a path that also returns -- that is the HEAD behaviour')
})

test('MUTANT KILLED: moving the row outside the retire branch makes a clean sweep emit it', async () => {
  await withMutant(SKILLS_PATH,
    "      refused.add(drop.id)\n      logEvent({ kind: 'pickup_skipped', status: 'success',",
    "      refused.add(drop.id)\n      if (false) logEvent({ kind: 'pickup_skipped', status: 'success',",
    async mod => {
      // With the emission switched off the function must still WORK -- the row is
      // instrumentation, and a fix whose behaviour depends on its own telemetry is
      // a fix that cannot be read.
      const { bot, visited, alive } = botWith(
        [item(1, 1), item(2, 3), item(3, 4)], { unreachable: new Set([1]) })
      await mod.pickupNearbyItems(bot, null)
      assert.ok(visited.includes(2) && visited.includes(3), 'the sweep depends on its own logging')
      assert.equal(alive.has(2), false)
    })
})

// ---- pickupwait-01 (Paper 10-26): a drop still FALLING is walked to where it will LIE, not where the client last saw it --
// mineflayer does not simulate other entities, so a falling item's client copy sits at a stale mid-air point for ~1 s.
import * as SKM from '../src/skills.mjs'
function dropBot (mod, { y = 5, ground = 1, below = 'air' } = {}) {
  const drop = { id: 7, name: 'item', position: V(2, y, 0) }
  const goals = []
  let alive = true
  const bot = {
    entity: { position: V(0, ground, 0) }, entities: { 7: drop },
    blockAt: p => (p.y < ground ? { name: 'stone', boundingBox: 'block' } : { name: below, boundingBox: below === 'stone' ? 'block' : 'empty' }),
    nearestEntity: pred => (alive && pred(drop) ? drop : null),
    pathfinder: { async goto (g) { goals.push(g.y); alive = false } },
  }
  return { bot, goals, run: () => mod.pickupNearbyItems(bot, null) }
}
test('A FALLING DROP (stale at y 5 over open air, ground top at 1) is walked to where it will lie: y 1', async () => {
  const { goals, run } = dropBot(SKM)
  await run()
  assert.deepEqual(goals, [1], `walked to ${goals}`)
})
test('A DROP AT REST is walked to where it is: on the ground, on a rail (no collision box, Claude r3 P3), on water', async () => {
  for (const [y, below, want] of [[1, 'air', 1], [1.06, 'rail', 1], [3.9, 'water', 3]]) {   // GoalNear floors its point
    const { goals, run } = dropBot(SKM, { y, below })
    await run()
    assert.deepEqual(goals, [want], `${below}: walked to ${goals}`)
  }
  assert.equal(SKM.dropFallsThrough({ name: 'air', boundingBox: 'empty' }), true)
  for (const b of [{ name: 'water', boundingBox: 'empty' }, { name: 'stone', boundingBox: 'block' }, null, {}]) assert.equal(SKM.dropFallsThrough(b), false, JSON.stringify(b))
})
test('dropLanding: an unknown (unloaded) cell stops the scan; the scan is bounded by DROP_SCAN_DOWN', () => {
  const at = SKM.dropLanding({ blockAt: p => (p.y >= 3 ? { name: 'air', boundingBox: 'empty' } : null) }, { x: 0.5, y: 9, z: 0.5 })
  assert.equal(at.y, 3, 'stops above the unknown cell')
  const deep = SKM.dropLanding({ blockAt: () => ({ name: 'air', boundingBox: 'empty' }) }, { x: 0.5, y: 100, z: 0.5 })
  assert.equal(deep.y, 99 - SKM.DROP_SCAN_DOWN)
})
test('MUTANT KILLED: the landing scan removed -> the walk goes to the stale mid-air point', async () => {
  const url = new URL('../src/skills.mjs', import.meta.url)
  const src = readFileSync(url, 'utf8')
  const old = '        new goals.GoalNear(at.x, at.y, at.z, 1)), 6000, bot)\n'
  assert.ok(src.includes(old) && src.split(old).length === 2, 'MUTATION DID NOT APPLY (anchor missing or not unique)')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, '        new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1)), 6000, bot)\n').replace(/from '\.\//g, "from '../src/"))
  try {
    const mod = await import(out.href)
    const { goals, run } = dropBot(mod)
    await run()
    assert.deepEqual(goals, [5], `the mutant walked to ${goals}`)
  } finally { try { unlinkSync(out) } catch {} }
})
