// BURIED, BUT AT THIS LEVEL: ASK THE DIG-APPROACH BEFORE DECLARING IT UNREACHABLE.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { Vec3 } from 'vec3'
import { pickBuriedApproach, BURIED_APPROACH_RADIUS, BURIED_APPROACH_DY } from '../src/digapproach.mjs'
import { faceAdjacent, adjacentGoal } from '../src/digreach.mjs'
import pathfinder from 'mineflayer-pathfinder'
const { goals } = pathfinder
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const bot = { entity: { position: new Vec3(300.5, 40, 300.5) } }
const V = (x, y, z) => new Vec3(x, y, z)

t('candidates are filtered to the bot\'s level and radius, nearest first, and the first the planner admits is taken', () => {
  const asked = []
  const plan = (b, q) => { asked.push(`${q.x},${q.y},${q.z}`); return q.x === 305 ? { take: true, dig: 4, digMs: 3000 } : { take: false, reason: 'too many blocks' } }
  const r = pickBuriedApproach(bot, [V(320, 40, 300), V(305, 40, 300), V(303, 47, 300), V(302, 40, 300)], { plan })
  assert.deepEqual(asked, ['302,40,300', '305,40,300'], 'sorted nearest first; the far one (20 blocks) and the one 7 above are never asked')
  assert.equal(r.target.x, 305); assert.equal(r.dig, 4); assert.deepEqual(r.refused, ['302,40,300: too many blocks'])
})
t('when every near candidate is refused the pick names each refusal; with none near it returns null', () => {
  const r = pickBuriedApproach(bot, [V(304, 40, 300), V(306, 41, 300)], { plan: () => ({ take: false, reason: 'ore in the way' }) })
  assert.equal(r.target, null); assert.equal(r.refused.length, 2)
  assert.equal(pickBuriedApproach(bot, [V(330, 40, 300)], { plan: () => ({ take: true }) }), null, 'nothing within radius -> null, planner never asked')
  assert.equal(pickBuriedApproach(bot, [], { plan: () => ({ take: true }) }), null)
})
t('a throwing planner is a refusal, never an admission', () => {
  const r = pickBuriedApproach(bot, [V(304, 40, 300)], { plan: () => { throw new Error('boom') } })
  assert.equal(r.target, null); assert.match(r.refused[0], /no plan/)
})
t('constants: 8 blocks, 2 of level', () => { assert.equal(BURIED_APPROACH_RADIUS, 8); assert.equal(BURIED_APPROACH_DY, 2) })

const RAW = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
t('gather consults the buried approach only for tunnel-worthy blocks with nothing exposed left, BEFORE the mine escalation, and keeps safeTarget', () => {
  const c = strip(RAW)
  const i = c.indexOf('buriedPick = pickBuriedApproach('), e = c.indexOf("kind: 'gather_escalated_to_mine'")
  assert.ok(i > 0 && e > i, 'the buried approach is consulted before the escalation')
  const guard = c.slice(c.lastIndexOf('if (', i), i)
  assert.match(guard, /reachable\.length === 0 && WORTH_TUNNELLING\.test\(viaSource \?\? blockName\)/)
  assert.match(c.slice(i, i + 200), /positions\.filter\(q => !exposed\(q\) && safeTarget\(q\) && !excluded\.has\(key\(q\)\)\)/, 'liquid/falling safety still applies to a buried candidate, and a candidate refused this run is not re-picked')
})
t('MUTANT: dropping the safeTarget filter on buried candidates is caught', () => {
  const anchor = 'positions.filter(q => !exposed(q) && safeTarget(q) && !excluded.has(key(q)))'
  assert.equal(RAW.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  assert.ok(!/positions\.filter\(q => !exposed\(q\) && safeTarget\(q\) && !excluded\.has\(key\(q\)\)\)/.test(strip(RAW.replace(anchor, 'positions.filter(q => !exposed(q) && !excluded.has(key(q)))'))))
})

t('a refusal carries the planner\'s own `why` (the first draft read `reason` and printed "no plan" for everything)', () => {
  const r = pickBuriedApproach(bot, [V(304, 40, 300)], { plan: () => ({ take: false, why: 'approach would break 9 blocks, over the 6 allowed' }) })
  assert.equal(r.target, null)
  assert.equal(r.refused[0], '304,40,300: approach would break 9 blocks, over the 6 allowed')
})
t('MUTANT: dropping the excluded filter on buried candidates is caught', () => {
  const c = strip(RAW)
  const i = c.indexOf('buriedPick = pickBuriedApproach(')
  const good = c.slice(i, i + 200)
  const bad = good.replace(' && !excluded.has(key(q))', '')
  assert.notEqual(good, bad, 'ANCHOR MISSING')
  assert.ok(!/positions\.filter\(q => !exposed\(q\) && safeTarget\(q\) && !excluded\.has\(key\(q\)\)\)/.test(bad))
})
t('a buried target is collected under a typed dig claim that an exposed target never takes, released on every exit', () => {
  const c = strip(RAW)
  const g = c.slice(c.indexOf('async function gather('), c.indexOf('async function gather(') + 60000)
  assert.match(g, /const buried = !!\(buriedPick\?\.target && key\(nextUp\) === key\(buriedPick\.target\)\)/)
  assert.match(g, /const digClaim = buried \? \(runner\?\.claimBody\?\.\('dig'\) \?\? null\) : null/, 'only a buried target claims')
  assert.match(g, /finally \{\s*digClaim\?\.release\?\.\(\)/, 'released in the finally that also cancels the library')
  assert.match(g, /await collectManually\(bot, target, signal, buried \? \{ claim: digClaim, safeToBreak: safeTarget, adjacent: true \} : \{\}\)/, 'the claim and the safety re-check travel together')
})
t('collectManually re-asks safeToBreak AFTER the walks and BEFORE bot.dig, and renews the claim per phase', () => {
  const c = strip(RAW)
  const s = c.indexOf('export async function collectManually('); const e = c.indexOf('async function pickupNearbyItems(')
  const f = c.slice(s, e)
  const walk = f.indexOf('withGatherMovements'), check = f.indexOf('if (safeToBreak && !safeToBreak(p))'), dig = f.indexOf('await withTimeout(bot.dig(block)')
  assert.ok(walk > 0 && check > walk && dig > check, `order: walk ${walk} < recheck ${check} < dig ${dig}`)
  assert.match(f.slice(check, dig), /failClass: 'unsafe_target'/)
  assert.equal((f.match(/claim\?\.renew\?\.\(\)/g) || []).length, 2, 'renewed once before the dig phase and once before the pickup walk')
})
t('MUTANT: moving the safeToBreak re-check above the approach walk is caught', () => {
  const c = strip(RAW)
  const s = c.indexOf('export async function collectManually('); const e = c.indexOf('async function pickupNearbyItems(')
  const f = c.slice(s, e)
  const chk = f.slice(f.indexOf('if (safeToBreak && !safeToBreak(p))'), f.indexOf("failClass: 'unsafe_target' })") + 30)
  assert.ok(chk.length > 40 && f.split(chk).length === 2, 'ANCHOR MISSING or not unique')
  const bad = chk + f.replace(chk, '')
  const walk = bad.indexOf('withGatherMovements'), check = bad.indexOf('if (safeToBreak && !safeToBreak(p))')
  assert.ok(check < walk, 'the mutant must put the check before the walk')
})

t('IN REACH IS NOT IN VIEW: a buried approach ends face-adjacent -- beside at feet or head level, or under it -- never on it, never 4 blocks short', () => {
  const q = V(305, 40, 300)
  assert.ok(faceAdjacent({ x: 304, y: 40, z: 300 }, q), 'beside it, ore at feet level')
  assert.ok(faceAdjacent({ x: 304, y: 39, z: 300 }, q), 'beside it, ore at head level')
  assert.ok(faceAdjacent({ x: 305, y: 38, z: 300 }, q), 'directly under it (over the head)')
  assert.ok(!faceAdjacent({ x: 305, y: 41, z: 300 }, q), 'STANDING ON IT is not an approach')
  assert.ok(!faceAdjacent({ x: 305, y: 40, z: 300 }, q), 'inside it')
  assert.ok(!faceAdjacent({ x: 304, y: 40, z: 301 }, q), 'diagonal: no shared face')
  assert.ok(!faceAdjacent({ x: 301, y: 40, z: 300 }, q), '4 blocks away is in reach (4.3) and not in view')
  const g = adjacentGoal(goals, q)
  assert.ok(g instanceof goals.GoalGetToBlock, 'the goal is a pathfinder goal')
  for (const n of [{ x: 304, y: 40, z: 300 }, { x: 305, y: 41, z: 300 }, { x: 301, y: 40, z: 300 }]) assert.equal(g.isEnd(n), faceAdjacent(n, q), `goal.isEnd disagrees with faceAdjacent at ${n.x},${n.y},${n.z}`)
  assert.ok(new goals.GoalGetToBlock(305, 40, 300).isEnd({ x: 305, y: 41, z: 300 }), 'the library goal DOES accept standing on the block, which is why we subclass it')
})
t('collectManually plans AND walks the buried approach with the adjacent goal, and gather asks for it only when buried', () => {
  const c = strip(RAW)
  const s = c.indexOf('export async function collectManually('); const e = c.indexOf('async function pickupNearbyItems(')
  const f = c.slice(s, e)
  assert.match(f, /reachGoalFor: adjacent \? adjacentGoal : reachGoal/, 'the plan uses the adjacent goal')
  assert.match(f, /endsInReach: node => adjacent \? faceAdjacent\(node, p\) : nodeToBlock\(node, p\) <= STANCE_REACH/, 'the plan ends beside the block')
  assert.match(f, /const walkGoal = \(adjacent \? adjacentGoal\(goals, p\) : reachGoal\(goals, p\)\) \?\? stance/, 'the walk goes to the same goal the plan priced')
  assert.match(f, /goto\(walkGoal\), APPROACH_WALK_MS/)
  const g = c.slice(c.indexOf('async function gather('))
  assert.match(g, /reachGoalFor: adjacentGoal,/, 'the buried pick plans beside the block')
  assert.match(g, /endsInReachFor: q => node => faceAdjacent\(node, q\)/)
})
t('MUTANT: planning beside the block but walking to the reach goal is caught', () => {
  const c = strip(RAW)
  const anchor = 'const walkGoal = (adjacent ? adjacentGoal(goals, p) : reachGoal(goals, p)) ?? stance'
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, 'const walkGoal = reachGoal(goals, p) ?? stance')
  assert.ok(!/const walkGoal = \(adjacent \? adjacentGoal\(goals, p\) : reachGoal\(goals, p\)\) \?\? stance/.test(bad))
})

t('every arrival guard in collectManually asks arrived(), which is face adjacency for a buried target and canDigBlock otherwise; the dig phase refuses "in reach but not beside"', () => {
  const c = strip(RAW)
  const s = c.indexOf('export async function collectManually('); const e = c.indexOf('async function pickupNearbyItems(')
  const f = c.slice(s, e)
  assert.match(f, /const arrived = \(\) => adjacent \? faceAdjacent\(feet\(\), p\) : !!\(bot\.canDigBlock && bot\.canDigBlock\(bot\.blockAt\(p\)\)\)/)
  assert.equal((f.match(/if \(!arrived\(\)\) \{/g) || []).length, 2, 'the stance walk and the dig-approach are both gated on arrived()')
  assert.equal((f.match(/if \(!\(bot\.canDigBlock && bot\.canDigBlock\(bot\.blockAt\(p\)\)\)\) \{/g) || []).length, 0, 'a bare canDigBlock gate survived (Codex: a buried ore 3.9 blocks away skips the approach)')
  assert.match(f, /if \(adjacent && !arrived\(\)\) \{[\s\S]{0,600}failClass: 'not_beside'/, 'the dig phase refuses a buried target it is not beside')
})
t('MUTANT: restoring a bare canDigBlock gate on the dig-approach is caught', () => {
  const c = strip(RAW)
  const s = c.indexOf('export async function collectManually('); const e = c.indexOf('async function pickupNearbyItems(')
  const f = c.slice(s, e)
  const i = f.lastIndexOf('if (!arrived()) {'); assert.ok(i > 0, 'ANCHOR MISSING')
  const bad = f.slice(0, i) + 'if (!(bot.canDigBlock && bot.canDigBlock(bot.blockAt(p)))) {' + f.slice(i + 'if (!arrived()) {'.length)
  assert.notEqual((bad.match(/if \(!arrived\(\)\) \{/g) || []).length, 2)
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
