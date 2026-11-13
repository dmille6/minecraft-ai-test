// WELLSTEP-01 (cleanzone.mjs): the junk well's stand is reached again. LIVE showcase 11-13: a tidy visit cut the one-block step of
// the only walk up to the stand, the clean zone forbade the walk from laying it again, and dispose_well failed 124 times of 124.
// BEHAVIOUR over mineflayer-pathfinder 2.4.5's REAL Movements and REAL A* (cleanzone.test.mjs's harness): the walk that the ban
// fails is tried once more with a pass for that ONE goal. The source is read only for what behaviour cannot reach: that
// disposeWell asks, in the right place (with mutants).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const require_ = createRequire(import.meta.url)
const CZ = await import('../src/cleanzone.mjs')
const CZ_URL = new URL('../src/cleanzone.mjs', import.meta.url)
const SKILLS_URL = new URL('../src/skills.mjs', import.meta.url)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const V = (x, y, z) => new Vec3(x, y, z)

// climb-escape.test.mjs's withMutant: the anchor must be present AND unique, or the mutant is never written
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${url.pathname}`)
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

const { Movements, goals } = require_('mineflayer-pathfinder')
const AStar = require_('mineflayer-pathfinder/lib/astar.js')
const Move = require_('mineflayer-pathfinder/lib/move.js')
const registry = require_('prismarine-registry')('1.21.8')
const Block = require_('prismarine-block')(registry)

function world (cells = {}) {
  const nameAt = (x, y, z) => cells[`${x},${y},${z}`] ?? (y <= 69 ? 'stone' : 'air')
  const blockAt = p => { const b = Block.fromStateId(registry.blocksByName[nameAt(p.x, p.y, p.z)].defaultState, 0); b.position = V(p.x, p.y, p.z); return b }
  return { blockAt, nameAt }
}
const HOME = { x: 0, y: 70, z: 0 }
function moves (w, { ban = null, mod = CZ } = {}) {
  const bot = { registry, version: '1.21.8', blockAt: w.blockAt, entity: { position: V(0.5, 71, 0.5), effects: {} }, entities: {},
                inventory: { items: () => [{ name: 'dirt', count: 64, type: registry.itemsByName.dirt.id }] },
                pathfinder: { bestHarvestTool: () => null }, game: { minY: -64, height: 384 } }
  const m = new Movements(bot)
  m.canDig = false; m.allowParkour = false; m.allowSprinting = false; m.allow1by1towers = true; m.maxDropDown = 6
  m.placeCost = 5
  if (ban) {
    const zone = mod.cleanZoneOf(HOME)
    const cz = mod.makeCleanZone({ zone: () => zone, on: ban.on ?? true, now: ban.now ?? (() => 0), emit: ban.emit ?? null })
    mod.installCleanZoneFilter(m, cz)
    m.__cz = cz
  }
  return m
}
const placedOf = path => path.flatMap(n => (n.toPlace ?? []).filter(p => !p.useOne).map(p => `${p.x + p.dx},${p.y + p.dy},${p.z + p.dz}`))
function fakePathfinder () {
  return {
    searchRadius: -1,
    getPathFromTo: function * (movements, startPos, goal, options = {}) {
      const ctx = new AStar(new Move(startPos.x, startPos.y, startPos.z, 64, 0), movements, goal, options.timeout ?? 4000, options.tickTimeout ?? 4000, options.searchRadius ?? this.searchRadius)
      let result = ctx.compute()
      yield { result, astarContext: ctx }
      while (result.status === 'partial') { result = ctx.compute(); yield { result, astarContext: ctx } }
    },
  }
}
const runSearch = (pf, m, from, goal, options = {}) => { let last = null; for (const v of pf.getPathFromTo(m, V(from[0], from[1], from[2]), goal, options)) last = v.result; return last }

/** THE WELL'S WALK UP, as the showcase had it: a one-wide stair along z = 0 rising one block a step from the ground (top 69)
 *  to the stand at 6,73,0 -- tops 70, 71, 72 at x = 3, 4, 5 and the stand's block at x = 6 (top 72). `step: false` is the
 *  stair after the tidy's cut: the first tread (3,70,0) is gone and the first rise is two blocks. */
function wellCells ({ step = true } = {}) {
  const c = {}
  if (step) c['3,70,0'] = 'stone'
  for (let y = 70; y <= 71; y++) c[`4,${y},0`] = 'stone'
  for (let y = 70; y <= 72; y++) { c[`5,${y},0`] = 'stone'; c[`6,${y},0`] = 'stone' }
  return c
}
const FOOT = [0, 70, 0]
/** A search the ban left no route: on open ground the REAL A* runs out of time (`timeout`), in a closed place out of nodes
 *  (`noPath`). Either way nothing is placed and the walk does not arrive. */
const refused = r => (r.status === 'noPath' || r.status === 'timeout') && placedOf(r.path).length === 0
const STAND = { x: 6, y: 73, z: 0 }
const TO_STAND = new goals.GoalBlock(STAND.x, STAND.y, STAND.z)
const MID = new goals.GoalBlock(5, 73, 0)   // another cell up the same stair: not the pass's goal
function rig ({ step = false, mod = CZ, on = true } = {}) {
  let t = 0
  const rows = []
  const m = moves(world(wellCells({ step })), { ban: { now: () => t, emit: d => rows.push(d), on }, mod })
  const pf = fakePathfinder()
  mod.installCleanZoneSearch(pf, m.__cz)
  return { m, cz: m.__cz, pf, rows, tick: ms => { t += ms }, search: (goal = TO_STAND) => runSearch(pf, m, FOOT, goal, { timeout: 400, tickTimeout: 400 }) }
}

test('POSITIVE CONTROL: with its step the stair is walked under the ban, nothing placed; without the ban a lost step is laid again', () => {
  const whole = rig({ step: true }).search()
  assert.equal(whole.status, 'success'); assert.deepEqual(placedOf(whole.path), [])
  const base = runSearch(fakePathfinder(), moves(world(wellCells({ step: false }))), FOOT, TO_STAND)
  assert.equal(base.status, 'success', 'the base walk heals the stair (LIVE 11-12 18:00Z: `_takeback outcome=adopted shape=step`)')
  assert.ok(placedOf(base.path).length >= 1)
})
test('THE DEAD END (LIVE 11-13): the step is gone and the ban forbids laying it -- the walk to the stand has no route', () => {
  const r = rig()
  const s = r.search()
  assert.ok(refused(s), s.status)
  assert.ok(r.cz.vetoed > 0, 'it is the ban that removed the route')
})
test('THE PASS (the refusal chain): the failed walk, tried again with a pass for the stand, lays the step and arrives', () => {
  const r = rig()
  assert.ok(refused(r.search()), 'the order\'s first walk')
  assert.equal(r.cz.permit(STAND, 25_000), true)
  assert.match(r.rows.at(-1), /^op=pass goal=6,73,0 ms=25000$/)
  const again = r.search()
  assert.equal(again.status, 'success')
  assert.ok(placedOf(again.path).length >= 1, 'it places what the stair lost')
  assert.equal(r.cz.passed, 1); assert.equal(r.cz.passes, 1)
  assert.equal(r.cz.releases, 0, 'the valve had no part in it')
})
test('THE PASS IS FOR ONE GOAL: every other search stays banned while it is held', () => {
  const r = rig()
  r.cz.permit(STAND, 25_000)
  const other = r.search(MID)
  assert.ok(refused(other), 'a walk to another cell up the same stair is still refused')
  assert.equal(r.cz.passed, 0)
  assert.equal(r.search().status, 'success', 'and the stand\'s own walk still has it')
})
test('THE PASS IS FOR A WALK THAT ENDS ON THE STAND (Codex r1): the same coordinates under a looser goal get none', () => {
  const r = rig()
  r.cz.permit(STAND, 25_000)
  const near = r.search(new goals.GoalNear(STAND.x, STAND.y, STAND.z, 2))
  assert.ok(refused(near), `GoalNear ends two cells away: ${near.status}`)
  assert.ok(refused(r.search(new goals.GoalGetToBlock(STAND.x, STAND.y, STAND.z))), 'GoalGetToBlock ends beside it')
  assert.ok(refused(r.search(new goals.GoalXZ(STAND.x, STAND.z))), 'GoalXZ ends at any height')
  assert.equal(r.cz.passed, 0)
  assert.equal(CZ.endsOnlyAt(TO_STAND, [6, 73, 0]), true)
  assert.equal(CZ.endsOnlyAt(TO_STAND, [6, 72, 0]), false)
  assert.equal(CZ.endsOnlyAt(new goals.GoalNear(6, 73, 0, 1), [6, 73, 0]), false)
  assert.equal(CZ.endsOnlyAt({ x: 6, y: 73, z: 0 }, [6, 73, 0]), false, 'coordinates alone are not a goal')
  assert.equal(CZ.endsOnlyAt({ isEnd () { throw new Error('x') } }, [6, 73, 0]), false)
  assert.equal(CZ.endsOnlyAt(null, [6, 73, 0]), false)
})
test('MUTANT KILLED: a pass matched on coordinates lets a GoalNear place', async () => {
  await withMutant(CZ_URL, 'return endsOnlyAt(goal, p.at)', "{ const c = cellOf(goal); return !!c && c[0] === p.at[0] && c[1] === p.at[1] && c[2] === p.at[2] }", async (mod) => {
    const r = rig({ mod })
    r.cz.permit(STAND, 25_000)
    assert.equal(r.search(new goals.GoalNear(STAND.x, STAND.y, STAND.z, 2)).status, 'success', 'the mutant lets the looser walk through')
    assert.equal(r.cz.passed, 1)
  })
})
test('THE PASS ENDS: when revoked, after its time, and never later than passMaxMs; a ban that is off grants none', () => {
  const r = rig()
  r.cz.permit(STAND, 25_000); r.cz.revoke()
  assert.ok(refused(r.search()), 'revoked')
  r.cz.permit(STAND, 25_000); r.tick(25_000)
  assert.ok(refused(r.search()), 'expired')
  r.cz.permit(STAND, 10 * CZ.CLEAN_ZONE.passMaxMs); r.tick(CZ.CLEAN_ZONE.passMaxMs)
  assert.ok(refused(r.search()), 'capped at passMaxMs')
  assert.equal(r.cz.permit(null, 25_000), false, 'no cell, no pass')
  assert.equal(r.cz.permit(STAND, 0), false, 'no time, no pass')
  assert.equal(rig({ on: false }).cz.permit(STAND, 25_000), false, 'nothing to lift when the ban is off')
})
test('THE VALVE is not fed by a pass: a walk under it is counted freed, never touched or failed', () => {
  const r = rig()
  r.cz.permit(STAND, 25_000)
  r.search()
  assert.equal(r.cz.freed, 1); assert.equal(r.cz.touched, 0); assert.equal(r.cz.failed, 0)
})
test('PERMITTED WALK: the pass is held for the walk and gone after it -- on success, on a throw, on an abort', async () => {
  const r = rig()
  let inside = null
  const ok = await CZ.permittedWalk(r.cz, STAND, 25_000, async () => { inside = r.search().status })
  assert.deepEqual(ok, { ran: true, err: null }); assert.equal(inside, 'success')
  assert.equal(r.cz.pass, null); assert.ok(refused(r.search()), 'the ban is back the moment the walk ends')
  const boom = Object.assign(new Error('stopped'), { aborted: true })
  const thrown = await CZ.permittedWalk(r.cz, STAND, 25_000, async () => { throw boom })
  assert.equal(thrown.ran, true); assert.equal(thrown.err, boom, 'the error is handed back for the caller\'s abort rule')
  assert.equal(r.cz.pass, null, 'a pass never outlives its walk')
  // a walk that THREW is halted while the pass is still held (Codex r1); a walk that arrived is not
  const seen = []
  await CZ.permittedWalk(r.cz, STAND, 25_000, async () => { throw new Error('NoPath') }, () => seen.push(r.cz.pass ? 'held' : 'gone'))
  assert.deepEqual(seen, ['held'], 'halted once, before the revoke')
  await CZ.permittedWalk(r.cz, STAND, 25_000, async () => {}, () => seen.push('arrived'))
  assert.deepEqual(seen, ['held'])
  const kept = await CZ.permittedWalk(r.cz, STAND, 25_000, async () => { throw boom }, () => { throw new Error('halt broke') })
  assert.equal(kept.err, boom, 'a halt that throws never hides the walk\'s error'); assert.equal(r.cz.pass, null)
  let ran = false
  assert.deepEqual(await CZ.permittedWalk(rig({ on: false }).cz, STAND, 25_000, async () => { ran = true }), { ran: false, err: null })
  assert.deepEqual(await CZ.permittedWalk(null, STAND, 25_000, async () => { ran = true }), { ran: false, err: null })
  assert.equal(ran, false, 'no pass, no second walk')
})
test('MUTANT KILLED: a pass that does not look at the goal lifts the ban for every walk', async () => {
  await withMutant(CZ_URL, 'return endsOnlyAt(goal, p.at)', 'return true', async (mod) => {
    const r = rig({ mod })
    r.cz.permit(STAND, 25_000)
    assert.equal(r.search(MID).status, 'success', 'the mutant lets the other walk place too')
  })
})
test('MUTANT KILLED: a pass that never expires', async () => {
  await withMutant(CZ_URL, 'if (!p || !(p.until > t)) return false', 'if (!p) return false', async (mod) => {
    const r = rig({ mod })
    r.cz.permit(STAND, 25_000); r.tick(10 * 60_000)
    assert.equal(r.search().status, 'success', 'the mutant still places ten minutes later')
  })
})
test('MUTANT KILLED: a permitted walk that does not revoke leaves the pass behind', async () => {
  await withMutant(CZ_URL, "return { ran: true, err } } finally { cz.revoke() }", 'return { ran: true, err } }', async (mod) => {
    const r = rig({ mod })
    await mod.permittedWalk(r.cz, STAND, 25_000, async () => {})
    assert.notEqual(r.cz.pass, null)
  })
})
test('MUTANT KILLED: a permitted walk that does not halt a failed walk', async () => {
  await withMutant(CZ_URL, "catch (err) { try { halt?.() } catch { /* the halt never hides the walk's error */ } return", 'catch (err) { return', async (mod) => {
    const r = rig({ mod })
    let halted = 0
    await mod.permittedWalk(r.cz, STAND, 25_000, async () => { throw new Error('NoPath') }, () => { halted++ })
    assert.equal(halted, 0)
  })
})
test('THE DECISION: only at the well, only under a live ban, only with something to lay; each refusal says which', () => {
  const d = o => CZ.wellStepDecision({ on: true, ban: true, feet: { x: 12.48, y: 68, z: 6.5 }, stand: { x: 12, y: 74, z: 6 }, held: 64, ...o })
  assert.deepEqual(d({}), { go: true, why: 'unreachable' }, 'the showcase\'s bots, at the foot six below the stand')
  assert.deepEqual(d({ on: false }), { go: false, why: 'off' })
  assert.deepEqual(d({ ban: false }), { go: false, why: 'no_ban' })
  assert.deepEqual(d({ held: 0 }), { go: false, why: 'no_blocks' })
  assert.deepEqual(d({ feet: { x: 12, y: 61, z: 6 } }), { go: false, why: 'far' }, '13 under the stand: wellcare\'s hold, not a step')
  assert.deepEqual(d({ feet: { x: 12, y: 62, z: 6 } }).go, true, '12 under is still the well')
  assert.deepEqual(d({ feet: { x: 29, y: 68, z: 6 } }), { go: false, why: 'far' })
  assert.deepEqual(d({ feet: { x: 28, y: 68, z: 6 } }).go, true)
  assert.deepEqual(d({ feet: null }), { go: false, why: 'far' })
  assert.deepEqual(d({ stand: null }), { go: false, why: 'far' })
})
test('THE SWITCH, THE REMEDY AND THE ROWS', () => {
  for (const v of ['off', '0', 'false', 'no', 'OFF']) assert.equal(CZ.wellStepOn({ WELLSTEP: v }), false, v)
  for (const v of [undefined, '', 'on', '1']) assert.equal(CZ.wellStepOn({ WELLSTEP: v }), true, String(v))
  assert.match(CZ.wellStepRemedy('no_blocks'), /no dirt or cobblestone .*\(withdraw\), and the next visit lays the step/)
  for (const w of ['unreachable', 'off', 'far', 'no_ban', null]) assert.equal(CZ.wellStepRemedy(w), '', String(w))
  assert.equal(CZ.wellStepDetail({ op: 'climb', why: 'unreachable', stand: { x: 12, y: 74, z: 6 }, from: [12, 68, 6], held: 64, reached: true, ms: 4100 }),
    'op=climb why=unreachable stand=12,74,6 from=12,68,6 held=64 reached=1 ms=4100')
  assert.equal(CZ.wellStepDetail({ op: 'climb', why: 'unreachable', stand: { x: 12, y: 74, z: 6 }, from: [12, 68, 6], held: 3, reached: false, ms: 25000, err: 'Took to long' }),
    'op=climb why=unreachable stand=12,74,6 from=12,68,6 held=3 reached=0 ms=25000 err=Took_to_long')
  assert.equal(CZ.wellStepDetail({ op: 'skip', why: 'no_blocks', stand: { x: 12, y: 74, z: 6 }, from: [12, 68, 6], held: 0 }), 'op=skip why=no_blocks stand=12,74,6 from=12,68,6 held=0')
  assert.match(CZ.wellStepModeDetail({}), /^op=mode on=1 near_r=16 below=12 min_blocks=1 pass_max_ms=60000$/)
  assert.match(CZ.wellStepModeDetail({ WELLSTEP: 'off' }), /^op=mode on=0 /)
  const c = { vetoed: 5, searches: 9, touched: 2, failed: 1, releases: 0, freed: 1, passes: 2, passed: 3 }
  assert.match(CZ.cleanZoneHitsDetail(c, CZ.cleanZoneSnap({ passes: 1, passed: 1 })), / passes=1 passed=2$/)
})

// ---- the wiring: what behaviour cannot reach (disposeWell has no end-to-end harness) -------------------------------------
function wiringProblems (src) {
  const code = strip(src)
  const out = []
  const a = code.indexOf('async function disposeWell (')
  const b = code.indexOf('\nasync function ', a + 10)
  if (a < 0 || b < 0) return ['disposeWell not found']
  const body = code.slice(a, b)
  const at = (needle, what) => { const n = body.split(needle).length - 1; if (n !== 1) out.push(`${what}: found ${n}, want 1`); return body.indexOf(needle) }
  const iFirst = body.indexOf('bot.pathfinder.goto(new goals.GoalBlock(stand.x, stand.y, stand.z))')
  const iAsk = at('wellStepDecision({ on: wellStepOn(process.env), ban: bot.cleanZoneBan?.on === true, feet: q(), stand, held })', 'the decision is asked with the switch, the live ban, the feet, the stand and the bag')
  const iHeld = at('const held = towerBlocksHeld(bot)', 'the bag is counted in blocks the walk can lay')
  at('const stepGoal = new goals.GoalBlock(stand.x, stand.y, stand.z)', 'the second walk\'s goal is the stand\'s own cell')
  const iWalk = at('permittedWalk(bot.cleanZoneBan, stand, HK_PATH_MS, () => g.bound(bot.pathfinder.goto(stepGoal), HK_PATH_MS, \'pathfinding\', { path: true }), () => { if (bot.pathfinder?.goal === stepGoal) haltPath(bot) })', 'the second walk runs under a pass for the stand, bounded as the first, and is halted if it fails')
  const iAbort = at('if (w.err && (w.err.aborted || signal?.aborted)) throw w.err', 'an abort of the second walk is rethrown')
  const iFail = at("return fail('well_unreachable', 'unreachable',", 'the refusal')
  at('${wellStepRemedy(stepWhy)}`)', 'the refusal names the step\'s remedy')
  if (!(iFirst > 0 && iHeld > iFirst && iAsk > iHeld && iWalk > iAsk && iAbort > iWalk && iFail > iAbort)) out.push('order: first walk, bag, decision, permitted walk, abort, refusal')
  if (!/if \(ask\.go\) \{[\s\S]*?permittedWalk\(/.test(body)) out.push('the permitted walk must be under `if (ask.go)`')
  return out
}
test('WIRING: disposeWell asks after its own walk failed and before it refuses; the second walk is under the pass', () => {
  assert.deepEqual(wiringProblems(readFileSync(SKILLS_URL, 'utf8')), [])
})
test('WIRING MUTANTS: each missing piece is named', () => {
  const src = readFileSync(SKILLS_URL, 'utf8')
  const mut = (old, neu) => { assert.ok(src.split(old).length === 2, `ANCHOR MISSING or not unique: ${old}`); return wiringProblems(src.replace(old, neu)).join(' | ') }
  assert.match(mut('ban: bot.cleanZoneBan?.on === true, feet: q(), stand, held })', 'ban: true, feet: q(), stand, held })'), /the decision is asked.*found 0/)
  assert.match(mut('        if (w.err && (w.err.aborted || signal?.aborted)) throw w.err\n', ''), /an abort of the second walk is rethrown: found 0/)
  assert.match(mut('const w = await permittedWalk(bot.cleanZoneBan, stand, HK_PATH_MS, () => g.bound(', 'const w = await permittedWalk(null, stand, HK_PATH_MS, () => g.bound('), /the second walk runs under a pass/)
  assert.match(mut(", () => { if (bot.pathfinder?.goal === stepGoal) haltPath(bot) })", ')'), /is halted if it fails: found 0/)
  assert.match(mut('const stepGoal = new goals.GoalBlock(stand.x, stand.y, stand.z)', 'const stepGoal = new goals.GoalNear(stand.x, stand.y, stand.z, 2)'), /the stand's own cell: found 0/)
  assert.match(mut('the next town visit tries again${wellStepRemedy(stepWhy)}`)', 'the next town visit tries again`)'), /the refusal names the step's remedy: found 0/)
  assert.match(mut('      if (ask.go) {\n        const t0 = Date.now()\n        const stepGoal = ', '      {\n        const t0 = Date.now()\n        const stepGoal = '), /under `if \(ask\.go\)`/)
})
