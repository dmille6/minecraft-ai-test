// TAKEBACK-01 (bots/src/takeback.mjs; placeaudit.mjs `onPlaced`). Owner 11-12: "Walking must not place dirt or dig ground. Escapes
// undo what they placed." Measured on the showcase, 12 h to 11-12 13:20Z: 1,772 movement blocks placed in the town and margin, 75
// ever dug again. A walk now takes back the block it placed as soon as it has passed it. The pure rules, then the chain on a fake
// bot whose goto behaves as mineflayer-pathfinder's does (rejects GoalChanged on a new goal, PathStopped on a stop), with the old
// behaviour as the positive control and one anchored mutant per guard.
import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import * as TB from '../src/takeback.mjs'
import { attachPlaceAudit } from '../src/placeaudit.mjs'
import { withDigScope } from '../src/digtown.mjs'
import { haltPath } from '../src/pathhalt.mjs'
const { withTimeout } = await import('../src/skills.mjs')

const SRC = new URL('../src/takeback.mjs', import.meta.url)
const SKILLS_SRC = new URL('../src/skills.mjs', import.meta.url)
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 8).join('\n        ')}`) }
}
/** A mutant of takeback.mjs, its anchor present and unique (CLAUDE.md), imported from the test directory. */
async function withMutant (old, neu, fn, path = SRC) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, ms = 1500) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await sleep(3) } }
// the test clock's constants: the same rules, ticks a test can wait for
const T = Object.freeze({ ...TB.TAKEBACK, tickMs: 4, unusedMs: 60, budgetMs: 400, reuseMs: 400, ttlMs: 5_000 })
const REC = (cell, o = {}) => ({ cell, block: 'dirt', reason: 'pathfinder', shape: 'step', zone: 'town', profile: 'walk', ...o })

console.log('THE PURE RULES')
await t('receiptFor: the pathfinder\'s scaffold under a walk profile, with a real block; never a reflex\'s pillar or an escape profile', () => {
  assert.strictEqual(TB.receiptFor(REC([1, 64, 1])), true)
  assert.strictEqual(TB.receiptFor(REC([1, 64, 1], { profile: 'gather' })), true)
  assert.strictEqual(TB.receiptFor(REC([1, 64, 1], { reason: 'reflex' })), false, 'an escape\'s pillar (piece 3)')
  assert.strictEqual(TB.receiptFor(REC([1, 64, 1], { reason: 'skill' })), false)
  assert.strictEqual(TB.receiptFor(REC([1, 64, 1], { profile: 'ascend' })), false, 'an escape profile keeps its scaffold')
  assert.strictEqual(TB.receiptFor(REC([1, 64, 1], { block: '?' })), false)
  assert.strictEqual(TB.receiptFor(REC([1, NaN, 1])), false)
  assert.strictEqual(TB.receiptFor(null), false)
})
await t('ripe: used (or unused 8 s), out of its column, on the ground, dry, in reach', () => {
  const r = { cell: [5, 64, 5], block: 'dirt', t: 1000, used: true }
  const at = (x, y, z, o = {}) => ({ pos: { x, y, z }, feet: TB.feetOf({ x, y, z }), onGround: true, inWater: false, ...o })
  assert.strictEqual(TB.ripe(r, at(6.5, 65, 5.5), 1100), true, 'one step past it')
  assert.strictEqual(TB.ripe(r, at(5.5, 65, 5.5), 1100), false, 'standing on it')
  assert.strictEqual(TB.ripe(r, at(6.1, 65, 5.5), 1100), false, 'centred in the next column but still resting on it (a body is 0.6 wide: review r1)')
  assert.strictEqual(TB.ripe(r, at(6.3, 65, 5.5), 1100), true, 'flush against the column: its footing is elsewhere')
  assert.strictEqual(TB.ripe(r, at(4.75, 65, 6.2), 1100), false, 'overlapping its corner')
  assert.strictEqual(TB.ripe(r, at(5.5, 68, 5.5), 1100), false, 'on a tower over it')
  assert.strictEqual(TB.ripe(r, at(6.5, 65, 5.5, { onGround: false }), 1100), false, 'in the air')
  assert.strictEqual(TB.ripe(r, at(6.5, 65, 5.5, { inWater: true }), 1100), false, 'swimming')
  assert.strictEqual(TB.ripe(r, at(11.5, 65, 5.5), 1100), false, 'out of reach')
  assert.strictEqual(TB.ripe({ ...r, used: false }, at(6.5, 64, 5.5), 1100), false, 'not used yet: the walk still needs it')
  assert.strictEqual(TB.ripe({ ...r, used: false }, at(6.5, 64, 5.5), 1000 + TB.TAKEBACK.unusedMs), true, 'never used: it is taken back')
  assert.strictEqual(TB.ripe({ ...r, closed: true }, at(6.5, 65, 5.5), 1100), false)
})
await t('verdictFor: dig only its own block, bare on top, unprotected, nobody on it, quick to dig', () => {
  const r = { cell: [5, 64, 5], block: 'dirt' }
  const ok = { name: 'dirt', above: 'air', body: false, priced: false, digMs: 750 }
  assert.deepStrictEqual(TB.verdictFor(r, ok), { act: 'dig', why: 'ripe' })
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, name: 'cobblestone' }), { act: 'adopted', why: 'changed' })
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, name: 'air' }), { act: 'adopted', why: 'gone' })
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, above: 'spruce_planks' }), { act: 'adopted', why: 'built_on' })
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, above: 'sand' }), { act: 'adopted', why: 'built_on' }, 'a block that would fall')
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, priced: true }), { act: 'adopted', why: 'protected' })
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, body: true }), { act: 'deferred', why: 'body' })
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, liquid: true }), { act: 'adopted', why: 'liquid' }, 'water would run into the gap')
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, digMs: 10_000 }), { act: 'left', why: 'slow' }, 'cobblestone by hand')
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, harvest: false }), { act: 'left', why: 'no_tool' }, 'the dig watcher would stop the walk for it')
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, name: null }), { act: 'deferred', why: 'unread' })
  assert.deepStrictEqual(TB.verdictFor(r, { ...ok, above: null }), { act: 'deferred', why: 'unread' })
})
await t('mayHalt: never while the pathfinder builds or digs, in a survival scope, hurt, or past the bounds', () => {
  const ok = { halts: 0, recent: [], now: 100_000, health: 20 }
  assert.strictEqual(TB.mayHalt(ok), true)
  assert.strictEqual(TB.mayHalt({ ...ok, building: true }), false)
  assert.strictEqual(TB.mayHalt({ ...ok, mining: true }), false)
  assert.strictEqual(TB.mayHalt({ ...ok, survival: true }), false)
  assert.strictEqual(TB.mayHalt({ ...ok, health: 6 }), false)
  assert.strictEqual(TB.mayHalt({ ...ok, halts: TB.TAKEBACK.haltsPerGoto }), false)
  assert.strictEqual(TB.mayHalt({ ...ok, recent: Array(TB.TAKEBACK.haltsPerMin).fill(99_000) }), false)
  assert.strictEqual(TB.mayHalt({ ...ok, recent: Array(TB.TAKEBACK.haltsPerMin).fill(10_000) }), true, 'halts older than a minute do not count')
})
await t('bodyHeld / issuedByEscape: a reflex acting, an arbiter holder that is not the skill, a walk a reflex issued', () => {
  assert.strictEqual(TB.bodyHeld({ reflex: 'escape', holder: null, skill: 'goto' }), true)
  assert.strictEqual(TB.bodyHeld({ reflex: null, holder: 'air', skill: 'goto' }), true)
  assert.strictEqual(TB.bodyHeld({ reflex: null, holder: 'goto', skill: 'goto' }), false, 'the skill holds its own body')
  assert.strictEqual(TB.bodyHeld({ reflex: null, holder: null, skill: 'goto' }), false)
  assert.strictEqual(TB.bodyHeld(null), false)
  assert.strictEqual(TB.issuedByEscape(['    at unstick (file:///opt/minecraft-ai/bots/src/reflex.mjs:7195:26)']), true)
  assert.strictEqual(TB.issuedByEscape(['    at gotoLegs (file:///opt/minecraft-ai/bots/src/skills.mjs:740:34)']), false)
})
await t('holdsLiquid: water and lava by name, and a waterlogged stair or slab by its state (review r1)', () => {
  assert.strictEqual(TB.holdsLiquid({ name: 'water' }), true); assert.strictEqual(TB.holdsLiquid({ name: 'lava' }), true)
  assert.strictEqual(TB.holdsLiquid({ name: 'spruce_stairs', getProperties: () => ({ waterlogged: true }) }), true)
  assert.strictEqual(TB.holdsLiquid({ name: 'spruce_slab', props: { waterlogged: 'true' } }), true)
  assert.strictEqual(TB.holdsLiquid({ name: 'spruce_slab', isWaterlogged: true }), true)
  assert.strictEqual(TB.holdsLiquid({ name: 'spruce_stairs', getProperties: () => ({ waterlogged: false }) }), false)
  assert.strictEqual(TB.holdsLiquid({ name: 'stone' }), false); assert.strictEqual(TB.holdsLiquid(null), false)
})
await t('takeOrder: a tower comes down from its top; the switch reads TAKEBACK', () => {
  assert.deepStrictEqual(TB.takeOrder([{ cell: [0, 64, 0], t: 1 }, { cell: [0, 66, 0], t: 3 }, { cell: [0, 65, 0], t: 2 }]).map(r => r.cell[1]), [66, 65, 64])
  assert.strictEqual(TB.takebackOn({}), true); assert.strictEqual(TB.takebackOn({ TAKEBACK: 'off' }), false); assert.strictEqual(TB.takebackOn({ TAKEBACK: '0' }), false)
})

// ---- the fake bot: a flat floor at y 63, a goto that behaves as the library's ----------------------------------------------------
function fake ({ env = {}, M = TB, digMs = 5, exclusion = [], profile = 'walk', settleMs = 0 } = {}) {
  const bot = new EventEmitter()
  const cells = new Map(), props = new Map()
  const rows = [], gotos = []
  bot.entity = { position: { x: 0.5, y: 64, z: 0.5 }, onGround: true, isInWater: false }
  bot.entities = { 1: bot.entity }
  bot.health = 20
  bot.movementProfile = profile
  const name = (x, y, z) => cells.get(`${x},${y},${z}`) ?? (y <= 63 ? 'stone' : 'air')
  bot.blockAt = v => ({ name: name(v.x, v.y, v.z), position: { x: v.x, y: v.y, z: v.z }, props: props.get(`${v.x},${v.y},${v.z}`) ?? null })
  bot.canSeeBlock = () => true
  bot.equip = async () => {}
  bot.digTime = () => 750
  let digging = null
  bot.dug = []
  bot.dig = b => new Promise((resolve, reject) => {
    const k = `${b.position.x},${b.position.y},${b.position.z}`
    const tm = setTimeout(() => { digging = null; cells.set(k, 'air'); bot.dug.push(k); resolve() }, digMs)
    digging = () => { clearTimeout(tm); digging = null; reject(new Error('Digging aborted')) }
  })
  bot.stopDigging = () => { digging?.() }
  let goal = null
  // mineflayer-pathfinder index.js:142-147: the goal is set, THEN goal_updated is emitted, synchronously
  const setGoalFake = g => { goal = g; bot.emit('goal_updated', g, false) }
  bot.pathfinder = {
    movements: { exclusionAreasBreak: exclusion },
    isBuilding: () => false, isMining: () => false, bestHarvestTool: () => null,
    get goal () { return goal },
    setGoal: setGoalFake,
    // lib/goto.js as it is: the four listeners FIRST, then setGoal(goal); cleanup removes them at once and settles one timer turn
    // LATER (setTimeout 0) -- the window review r1 found; `settleMs` widens it so a test can stand in it
    goto: g => new Promise((resolve, reject) => {
      const entry = { goal: g, settled: null }
      gotos.push(entry)
      const done = (err, val) => {
        bot.removeListener('goal_updated', onGoal); bot.removeListener('path_stop', onStop); bot.removeListener('goal_reached', onReach); bot.removeListener('fake_fail', onFail)
        setTimeout(() => { entry.settled = err ? err.name : 'ok'; err ? reject(err) : resolve(val) }, settleMs)
      }
      const onGoal = ng => { if (ng !== g) done(Object.assign(new Error('The goal was changed before it could be completed!'), { name: 'GoalChanged' })) }
      const onStop = () => done(Object.assign(new Error('Path was stopped'), { name: 'PathStopped' }))
      const onReach = () => done(null, undefined)
      const onFail = e => done(e)
      bot.on('path_stop', onStop); bot.on('goal_reached', onReach); bot.on('fake_fail', onFail); bot.on('goal_updated', onGoal)
      setGoalFake(g)
    }),
  }
  const tb = M.installTakeback(bot, { emit: (kind, status, detail) => rows.push({ kind, status, detail }), env, T, timers: false })
  const place = (cell, o = {}) => { cells.set(cell.join(','), o.block ?? 'dirt'); tb?.note(REC(cell, o)) }
  const stand = (x, y, z) => { bot.entity.position = { x: x + 0.5, y, z: z + 0.5 } }
  const out = () => rows.filter(r => r.kind === 'takeback').map(r => /outcome=(\S+) why=(\S+)/.exec(r.detail).slice(1, 3).join(':'))
  // the library on arrival (index.js:459-461): goal_reached is emitted and the goal is nulled WITHOUT a goal_updated
  const arrive = () => { bot.emit('goal_reached', goal); goal = null }
  // a walk as the skills issue one: fenced by the real withTimeout (skills.mjs)
  const walk = (g, ms = 30_000, opts = {}) => { const p = withTimeout(bot.pathfinder.goto(g), ms, bot, { needsDrop: false, ...opts }); p.catch(() => {}); return p }
  return { bot, cells, props, rows, gotos, tb, place, stand, name, out, arrive, walk, setGoal: setGoalFake, goalNow: () => goal }
}
/** The live walk: a step placed ahead, the bot climbs it, walks one past it. -> the walk's promise and the fake. */
function climb (opts = {}) {
  const f = fake(opts)
  const GOAL = { id: 'far' }
  const p = opts.unfenced ? f.bot.pathfinder.goto(GOAL) : f.walk(GOAL, opts.ms, opts.walk)
  p.catch(() => {})
  f.place([1, 64, 0])          // the pathfinder's step, in front of the bot
  f.stand(1, 65, 0)            // on it
  return { ...f, p, GOAL, past: async () => { await sleep(3 * T.tickMs); f.stand(2, 65, 0) } }
}

console.log('THE CHAIN (fake bot)')
await t('a step the walk placed and passed is dug back, and the SAME goal is walked on to its end', async () => {
  const c = climb()
  await sleep(4 * T.tickMs)
  assert.strictEqual(c.gotos.length, 1, 'standing on its own block: no halt')
  assert.strictEqual(c.name(1, 64, 0), 'dirt')
  await c.past()
  await until(() => c.gotos.length === 2)
  assert.strictEqual(c.name(1, 64, 0), 'air', 'taken back')
  assert.strictEqual(c.gotos[0].settled, 'GoalChanged'); assert.strictEqual(c.gotos[1].goal, c.GOAL, 'the same goal again')
  c.arrive()
  await c.p
  assert.deepStrictEqual(c.out(), ['dug:ripe'])
  assert.ok(/pos=1,64,0 block=dirt shape=step zone=town/.test(c.rows.find(r => r.kind === 'takeback').detail))
  c.tb.flush()
  assert.ok(/noted=1 halts=1 .*\| dug 1/.test(c.rows.find(r => r.kind === 'takeback_sum').detail), c.rows.at(-1).detail)
})
await t('POSITIVE CONTROL (today): with TAKEBACK=off the block stands and the walk is the library\'s own', async () => {
  const c = climb({ env: { TAKEBACK: 'off' } })
  assert.strictEqual(c.tb, null)
  assert.ok(/on=0/.test(c.rows.find(r => r.kind === 'takeback_mode').detail))
  c.cells.set('1,64,0', 'dirt'); c.stand(2, 65, 0)
  await sleep(8 * T.tickMs)
  assert.strictEqual(c.name(1, 64, 0), 'dirt'); assert.strictEqual(c.gotos.length, 1)
  c.arrive(); await c.p
})
await t('MUTANT: a receipt ripe while the bot still stands in its column -- it digs the block from under itself (killed)', async () => {
  await withMutant("  if (overlapsColumn(r.cell, here.pos)) return false\n", '', async M => {
    const c = climb({ M })
    await until(() => c.name(1, 64, 0) === 'air')
    assert.deepStrictEqual(c.bot.dug, ['1,64,0'], 'the mutant dug its own footing')
    c.arrive(); await c.p.catch(() => {})
  })
})
await t('the caller\'s error is the caller\'s: NoPath with nothing ripe passes through untouched', async () => {
  const f = fake()
  const p = f.walk({ id: 'g' })
  const e = Object.assign(new Error('No path to the goal!'), { name: 'NoPath' })
  f.bot.emit('fake_fail', e)
  await assert.rejects(p, x => x === e)
  assert.strictEqual(f.gotos.length, 1)
})
await t('THE CALLER ENDS THE WALK DURING A TAKE-BACK (its timeout halts the path): GoalChanged, and the goal is never walked again', async () => {
  const c = climb({ digMs: 120 })
  await c.past()
  await until(() => c.gotos[0].settled === 'GoalChanged')
  await sleep(10)                                  // the dig is under way
  haltPath(c.bot)                                  // the caller's own halt (withTimeout's cleanup)
  await assert.rejects(c.p, e => e.name === 'GoalChanged')
  await sleep(160)
  assert.strictEqual(c.gotos.length, 1, 'no walk the caller gave up')
  assert.strictEqual(c.name(1, 64, 0), 'dirt', 'the dig was stopped')
})
await t('MUTANT: the endings of others not heard -- the goal the caller gave up is walked again (killed)', async () => {
  await withMutant("if (!call.own && ng !== goal) call.giveUp('GoalChanged')", 'void ng', async M => {
    const c = climb({ M, digMs: 60 })
    await c.past()
    await until(() => c.gotos[0].settled === 'GoalChanged')
    await sleep(10)
    haltPath(c.bot)
    await until(() => c.gotos.length === 2, 800)
    assert.strictEqual(c.gotos[1].goal, c.GOAL, 'the mutant walked on after the caller stopped')
    c.arrive(); await c.p.catch(() => {})
  })
})
await t('REVIEW r1 (Codex, reproduced with the real library): the caller halts, and a receipt is ripe before the rejection lands -- never A again', async () => {
  const c = climb({ settleMs: 40 })
  await sleep(3 * T.tickMs)
  haltPath(c.bot)                                  // the caller gives up: the library stops listening now and rejects 40 ms later
  c.stand(2, 65, 0)                                // ...and in that window the step is ripe
  await assert.rejects(c.p, e => e.name === 'GoalChanged')
  await sleep(60)
  assert.strictEqual(c.gotos.length, 1, 'the goal is not walked again')
  assert.deepStrictEqual(c.bot.dug, [], 'and nothing was halted for a take-back')
  assert.strictEqual(c.goalNow(), null)
})
await t('REVIEW r1 (Claude: chestWalk): the timeout fires during the take-back and its handler leaves the path alone -- never walked again', async () => {
  // skills.mjs:4005: travelTimeoutAction says `leave` when pathfinder.goal is not the walk's own -- during a take-back it is null
  const c = climb({ digMs: 150, ms: 60, walk: { onTimeout: () => {} } })
  await c.past()
  await until(() => c.gotos[0].settled === 'GoalChanged')
  await assert.rejects(c.p, e => e.budgetExceeded === true)
  await sleep(220)
  assert.strictEqual(c.gotos.length, 1, 'no walk the caller timed out of')
  assert.strictEqual(c.name(1, 64, 0), 'dirt', 'the dig was stopped by the timeout')
})
await t('MUTANT (skills.mjs): withTimeout does not tell the take-back -- the timed-out goal is walked again (killed)', async () => {
  await withMutant("        try { tbCall?.giveUp?.('GoalChanged') } catch { /* the take-back never breaks a timeout */ }\n", '', async S => {
    const f = fake({ digMs: 150 })
    const GOAL = { id: 'far' }
    const p = S.withTimeout(f.bot.pathfinder.goto(GOAL), 60, f.bot, { needsDrop: false, onTimeout: () => {} }); p.catch(() => {})
    f.place([1, 64, 0]); f.stand(1, 65, 0); await sleep(3 * T.tickMs); f.stand(2, 65, 0)
    await assert.rejects(p, e => e.budgetExceeded === true)
    await until(() => f.gotos.length === 2, 1500)
    assert.strictEqual(f.gotos[1].goal, GOAL, 'the mutant walked on to a goal the skill had left')
    f.arrive()
  }, SKILLS_SRC)
})
await t('THE FENCE: a goto nobody handed to withTimeout is the library\'s own -- never halted', async () => {
  const c = climb({ unfenced: true })
  await c.past()
  await sleep(12 * T.tickMs)
  assert.strictEqual(c.gotos.length, 1); assert.strictEqual(c.name(1, 64, 0), 'dirt')
  c.arrive(); await c.p
})
await t('MUTANT: the fence cut -- an unfenced goto is halted (killed)', async () => {
  await withMutant('if (call.due || st.busy || !call.fenced || call.gone', 'if (call.due || st.busy || call.gone', async M => {
    const c = climb({ M, unfenced: true })
    await c.past()
    await until(() => c.bot.dug.length === 1)
    c.arrive(); await c.p.catch(() => {})
  })
})
await t('the watcher halts only its OWN goal: after another goal is set by hand, and after the arrival, it leaves the path alone', async () => {
  const c = climb({ settleMs: 40 })                // the window in which the watcher still runs after the walk was replaced
  const OTHER = { id: 'other' }
  await sleep(3 * T.tickMs)
  c.setGoal(OTHER)                                 // a setGoal walk replaced this one
  c.stand(2, 65, 0)
  await assert.rejects(c.p, e => e.name === 'GoalChanged')
  await sleep(12 * T.tickMs)
  assert.strictEqual(c.goalNow(), OTHER, 'the other walk\'s goal stands'); assert.deepStrictEqual(c.bot.dug, [])
  const d = climb({ settleMs: 40 })
  await sleep(3 * T.tickMs)
  d.arrive(); d.stand(2, 65, 0)                    // arrived; the resolution lands 40 ms later
  await d.p
  assert.strictEqual(d.tb.state.sum.halts, 0, 'no halt after the arrival')
})
await t('MUTANT: the own-goal and ended checks cut -- the watcher halts a goal that is not its own (killed)', async () => {
  await withMutant('!call.fenced || call.gone || st.owner !== call || pf.goal !== goal) return', '!call.fenced) return', async M => {
    const c = climb({ M, settleMs: 40 })
    const OTHER = { id: 'other' }
    await sleep(3 * T.tickMs)
    c.setGoal(OTHER); c.stand(2, 65, 0)
    await until(() => c.goalNow() === null, 800)
    assert.strictEqual(c.goalNow(), null, 'the mutant cancelled the other walk')
    await c.p.catch(() => {})
  })
})
await t('a newer goto owns the body: the older walk\'s take-back ends and it is never issued again', async () => {
  const c = climb({ digMs: 120 })
  await c.past()
  await until(() => c.gotos[0].settled === 'GoalChanged')
  await sleep(10)
  const NEXT = { id: 'next' }
  const q = c.walk(NEXT)                           // the skill moved on to another walk without halting the first
  await assert.rejects(c.p, e => e.name === 'GoalChanged')
  await sleep(160)
  assert.strictEqual(c.gotos.filter(g => g.goal === c.GOAL).length, 1, 'the first goal is not issued again')
  // (the NEW walk is watched in its turn: the step still stands beside the bot, so it may halt once and take it back)
  await until(() => c.name(1, 64, 0) === 'air')
  assert.ok(c.gotos.every((g, i) => i === 0 || g.goal === NEXT))
  await sleep(3 * T.tickMs); c.arrive(); await q
})
await t('a reflex stops the path during a take-back: PathStopped reaches the caller', async () => {
  const c = climb({ digMs: 120 })
  await c.past()
  await until(() => c.gotos[0].settled === 'GoalChanged')
  await sleep(10)
  c.bot.emit('path_stop')                          // what the library emits on a stop
  await assert.rejects(c.p, e => e.name === 'PathStopped')
  assert.strictEqual(c.gotos.length, 1)
})
await t('placed again where it was just taken back: kept (`kept why=reuse`), never a place-and-dig loop', async () => {
  const c = climb()
  await c.past()
  await until(() => c.gotos.length === 2)
  c.stand(0, 64, 0)                                // the route came back: the pathfinder places the step again
  c.place([1, 64, 0]); c.stand(1, 65, 0); await sleep(3 * T.tickMs); c.stand(2, 65, 0)
  await sleep(10 * T.tickMs)
  assert.strictEqual(c.name(1, 64, 0), 'dirt', 'it stays this time')
  assert.strictEqual(c.gotos.length, 2, 'no second halt')
  assert.deepStrictEqual(c.out(), ['dug:ripe', 'kept:reuse'])
  c.arrive(); await c.p
})
await t('MUTANT: the reuse rule cut -- the same cell is dug a second time (killed)', async () => {
  await withMutant("      if (st.taken.has(K(r.cell))) { st.taken.delete(K(r.cell)); row(r, 'kept', 'reuse'); return }\n", '', async M => {
    const c = climb({ M })
    await c.past()
    await until(() => c.gotos.length === 2)
    c.stand(0, 64, 0); c.place([1, 64, 0]); c.stand(1, 65, 0); await sleep(3 * T.tickMs); c.stand(2, 65, 0)
    await until(() => c.bot.dug.length === 2)
    c.arrive(); await c.p.catch(() => {})
  })
})
await t('never dug: built on, protected by the walk\'s own break prices, changed, or with a body on it', async () => {
  for (const [label, prep, want] of [
    ['built_on', c => c.cells.set('1,65,0', 'spruce_planks'), 'adopted:built_on'],
    ['changed', c => c.cells.set('1,64,0', 'cobblestone'), 'adopted:changed'],
    ['body', c => { c.bot.entities[2] = { position: { x: 1.5, y: 65, z: 0.5 } } }, 'deferred:body'],
    ['liquid', c => c.cells.set('1,64,1', 'water'), 'adopted:liquid'],
    ['waterlogged', c => { c.cells.set('1,64,1', 'spruce_stairs'); c.props.set('1,64,1', { waterlogged: true }) }, 'adopted:liquid'],
    ['body overlapping', c => { c.bot.entities[2] = { position: { x: 2.2, y: 65, z: 0.5 }, width: 0.6 } }, 'deferred:body'],
  ]) {
    const c = climb()
    await sleep(3 * T.tickMs); c.stand(2, 65, 0); prep(c)
    await until(() => c.out().length === 1, 3000)
    assert.deepStrictEqual(c.out(), [want], label)
    assert.deepStrictEqual(c.bot.dug, [], label)
    c.arrive(); await c.p.catch(() => {})
  }
  const c = climb({ exclusion: [b => (b.position.x === 1 && b.position.y === 64 ? 100 : 0)] })
  await c.past()
  await until(() => c.out().length === 1)
  assert.deepStrictEqual(c.out(), ['adopted:protected']); assert.deepStrictEqual(c.bot.dug, [])
  c.arrive(); await c.p
})
await t('MUTANT: the protected verdict cut -- a cell the walk\'s break prices protect is dug (killed)', async () => {
  await withMutant("  if (priced) return { act: 'adopted', why: 'protected' }\n", '', async M => {
    const c = climb({ M, exclusion: [() => 100] })
    await c.past()
    await until(() => c.bot.dug.length === 1)
    c.arrive(); await c.p.catch(() => {})
  })
})
await t('an escape is never halted: a walk in a survival scope, and one on an escape profile', async () => {
  const f = fake()
  const p = withDigScope(f.bot, { purpose: 'survival', by: 'reflex:escape' }, () => f.walk({ id: 'out' }))
  f.place([1, 64, 0]); f.stand(1, 65, 0); await sleep(3 * T.tickMs); f.stand(2, 65, 0)
  await sleep(10 * T.tickMs)
  assert.strictEqual(f.gotos.length, 1); assert.strictEqual(f.name(1, 64, 0), 'dirt')
  f.arrive(); await p
  const g = fake({ profile: 'ascend' })
  const q = g.walk({ id: 'up' })
  g.place([1, 64, 0], { profile: 'ascend' })
  assert.strictEqual(g.tb.state.open.length, 0, 'an escape profile\'s scaffold gets no receipt in this piece')
  g.arrive(); await q
})
await t('a reflex holds the body (digtown\'s context): no halt while it does, the take-back once it lets go', async () => {
  const c = climb()
  let reflex = 'escape'
  c.bot.__digContext = () => ({ reflex, holder: null, skill: 'goto' })
  await c.past()
  await sleep(10 * T.tickMs)
  assert.strictEqual(c.gotos.length, 1); assert.strictEqual(c.name(1, 64, 0), 'dirt')
  reflex = null
  await until(() => c.name(1, 64, 0) === 'air')
  await until(() => c.gotos.length === 2)
  c.arrive(); await c.p
})
await t('MUTANT: the held check cut from the watcher -- the walk is halted under an acting reflex (killed)', async () => {
  await withMutant('survival: survival || held(), health', 'survival, health', async M => {
    const c = climb({ M })
    c.bot.__digContext = () => ({ reflex: 'escape', holder: null, skill: 'goto' })
    await c.past()
    await until(() => c.gotos[0].settled === 'GoalChanged')
    c.arrive(); await c.p.catch(() => {})
  })
})
await t('the bounds: at most haltsPerGoto halts in one goto; a tower comes down top first', async () => {
  const f = fake()
  const p = f.walk({ id: 'far' })
  for (let i = 0; i < T.haltsPerGoto + 2; i++) {
    f.place([10 + 2 * i, 64, 0]); f.stand(10 + 2 * i, 65, 0); await sleep(3 * T.tickMs); f.stand(11 + 2 * i, 64, 0)
    await sleep(12 * T.tickMs)
  }
  assert.strictEqual(f.bot.dug.length, T.haltsPerGoto, `halts are bounded (${f.bot.dug.length})`)
  f.arrive(); await p
  const g = fake()
  const q = g.walk({ id: 'up' })
  g.place([3, 64, 0], { shape: 'pillar' }); g.place([3, 65, 0], { shape: 'pillar' }); g.place([3, 66, 0], { shape: 'pillar' })
  g.stand(3, 67, 0); await sleep(3 * T.tickMs)
  g.cells.set('4,66,0', 'stone'); g.stand(4, 67, 0)      // off the tower onto the ledge beside it
  await until(() => g.bot.dug.length === 3)
  assert.deepStrictEqual(g.bot.dug, ['3,66,0', '3,65,0', '3,64,0'])
  assert.strictEqual(g.gotos.length, 2, 'one halt took the whole tower')
  g.arrive(); await q
})
await t('the instrument hands on only placements that LANDED, in any zone (placeaudit `onPlaced`)', async () => {
  const bot = { entity: { position: { x: 500.5, y: 64, z: 500.5 } }, heldItem: { name: 'dirt' }, pathfinder: { isBuilding: () => true }, movementProfile: 'walk' }
  let n = 0
  bot.placeBlock = async () => { if (++n === 2) throw new Error('no block update') }
  const got = []
  attachPlaceAudit(bot, { home: { x: 0, y: 64, z: 0 }, emitPlace: () => {}, emitSummary: () => {}, onPlaced: r => got.push(r), timers: false })
  const ref = { position: { x: 501, y: 63, z: 500 } }
  await bot.placeBlock(ref, { x: 0, y: 1, z: 0 }); await sleep(2)
  await bot.placeBlock(ref, { x: 0, y: 1, z: 0 }).catch(() => {}); await sleep(2)
  assert.strictEqual(got.length, 1, 'the failed one is not handed on')
  assert.deepStrictEqual(got[0].cell, [501, 64, 500]); assert.strictEqual(got[0].zone, null, 'far outside the town: still handed on')
  assert.strictEqual(TB.receiptFor(got[0]), true)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
