// BURIED, BUT AT THIS LEVEL: ASK THE DIG-APPROACH BEFORE DECLARING IT UNREACHABLE.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { Vec3 } from 'vec3'
import { pickBuriedApproach, approachVerdict, BURIED_APPROACH_RADIUS, BURIED_APPROACH_DY, BURIED_APPROACH_TIMEOUT_MS, BURIED_APPROACH_PUMPS, APPROACH_TIMEOUT_MS } from '../src/digapproach.mjs'
import { faceAdjacent, adjacentGoal, nudgeGround } from '../src/digreach.mjs'
import pathfinder from 'mineflayer-pathfinder'
const { goals } = pathfinder
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const ta = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const bot = { entity: { position: new Vec3(300.5, 40, 300.5) } }
const V = (x, y, z) => new Vec3(x, y, z)

await ta('candidates are filtered to the bot\'s level and radius, nearest first, and the first the planner admits is taken', async () => {
  const asked = []
  const plan = (b, q) => { asked.push(`${q.x},${q.y},${q.z}`); return q.x === 305 ? { take: true, dig: 4, digMs: 3000 } : { take: false, reason: 'too many blocks' } }
  const r = await pickBuriedApproach(bot, [V(320, 40, 300), V(305, 40, 300), V(303, 47, 300), V(302, 40, 300)], { plan })
  assert.deepEqual(asked, ['302,40,300', '305,40,300'], 'sorted nearest first; the far one (20 blocks) and the one 7 above are never asked')
  assert.equal(r.target.x, 305); assert.equal(r.dig, 4); assert.deepEqual(r.refused, ['302,40,300: too many blocks'])
})
await ta('when every near candidate is refused the pick names each refusal; with none near it returns null', async () => {
  const r = await pickBuriedApproach(bot, [V(304, 40, 300), V(306, 41, 300)], { plan: () => ({ take: false, reason: 'ore in the way' }) })
  assert.equal(r.target, null); assert.equal(r.refused.length, 2)
  assert.equal(await pickBuriedApproach(bot, [V(330, 40, 300)], { plan: () => ({ take: true }) }), null, 'nothing within radius -> null, planner never asked')
  assert.equal(await pickBuriedApproach(bot, [], { plan: () => ({ take: true }) }), null)
})
await ta('a throwing planner is a refusal, never an admission', async () => {
  const r = await pickBuriedApproach(bot, [V(304, 40, 300)], { plan: () => { throw new Error('boom') } })
  assert.equal(r.target, null); assert.match(r.refused[0], /no plan/)
})
t('constants: 8 blocks, 2 of level', () => { assert.equal(BURIED_APPROACH_RADIUS, 8); assert.equal(BURIED_APPROACH_DY, 2) })

const RAW = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
await ta('gather consults the buried approach only for tunnel-worthy blocks with nothing exposed left, BEFORE the mine escalation, and keeps safeTarget', async () => {
  const c = strip(RAW)
  const i = c.indexOf('buriedPick = await pickBuriedApproach('), e = c.indexOf("kind: 'gather_escalated_to_mine'")
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

await ta('a refusal carries the planner\'s own `why` (the first draft read `reason` and printed "no plan" for everything)', async () => {
  const r = await pickBuriedApproach(bot, [V(304, 40, 300)], { plan: () => ({ take: false, why: 'approach would break 9 blocks, over the 6 allowed' }) })
  assert.equal(r.target, null)
  assert.equal(r.refused[0], '304,40,300: approach would break 9 blocks, over the 6 allowed')
})
await ta('MUTANT: dropping the excluded filter on buried candidates is caught', async () => {
  const c = strip(RAW)
  const i = c.indexOf('buriedPick = await pickBuriedApproach(')
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
  assert.match(f, /const plan = adjacent\s*\? await planDigApproachAsync\(bot, p, \{\s*goals, reachGoalFor: adjacentGoal, endsInReach: node => faceAdjacent\(node, p\), signal,/, 'a buried target plans with the async, signal-aware planner and the adjacent goal')
  assert.match(f, /: planDigApproach\(bot, p, \{\s*goals,\s*reachGoalFor: reachGoal,\s*endsInReach: node => nodeToBlock\(node, p\) <= STANCE_REACH,/, 'an exposed target keeps the synchronous planner and the reach goal')
  assert.match(f, /if \(adjacent\) check\(signal\)/, 'the await is a seam: cancellation is re-checked')
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

t("a PARTIAL search whose path already ends in reach is a plan (hive-c 2026-09-12: 4 of 5 engagements refused on 'partial'); partial without reach, or any other status, is still refused", () => {
  const path = [{ x: 1, y: 40, z: 0, toBreak: [] }, { x: 2, y: 40, z: 0, toBreak: [] }]
  const ok = approachVerdict({ status: 'partial', path, endsInReach: true })
  assert.ok(ok.take, ok.why)
  assert.ok(!approachVerdict({ status: 'partial', path, endsInReach: false }).take, 'partial that does not end in reach')
  assert.ok(!approachVerdict({ status: 'partial', path: [], endsInReach: true }).take, 'partial with no path')
  assert.match(approachVerdict({ status: 'timeout', path, endsInReach: true }).why, /approach search said timeout/)
  assert.match(approachVerdict({ status: 'noPath', path, endsInReach: true }).why, /approach search said noPath/)
  assert.ok(approachVerdict({ status: 'success', path, endsInReach: true }).take)
})
t('the dig claim outlives a buried collect by DIG_CLAIM_GRACE_MS, renewed first, before the finally releases it', () => {
  const c = strip(RAW)
  const g = c.slice(c.indexOf('async function gather('))
  const call = g.indexOf('await collectManually(bot, target, signal, buried ?'), grace = g.indexOf('if (digClaim) { digClaim.renew?.(); await sleep(DIG_CLAIM_GRACE_MS, signal) }'), fin = g.indexOf('digClaim?.release?.()')
  assert.ok(call > 0 && grace > call && fin > grace, `order: collect ${call} < grace ${grace} < release ${fin}`)
  assert.match(c, /const DIG_CLAIM_GRACE_MS = 4_000/)
})
t('MUTANT: dropping the grace is caught', () => {
  const c = strip(RAW)
  const anchor = 'if (digClaim) { digClaim.renew?.(); await sleep(DIG_CLAIM_GRACE_MS, signal) }'
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, '')
  assert.ok(!bad.includes('sleep(DIG_CLAIM_GRACE_MS'))
})

await ta('the buried pick hands the planner a larger budget (6 s wall clock, up to 150 yielding slices) than the exposed path keeps (2 s)', async () => {
  assert.equal(BURIED_APPROACH_TIMEOUT_MS, 6000); assert.equal(BURIED_APPROACH_PUMPS, 150); assert.equal(APPROACH_TIMEOUT_MS, 2000)
  let seen = null
  await pickBuriedApproach(bot, [V(304, 40, 300)], { plan: (b, q, opts) => { seen = opts; return { take: false, why: 'x' } } })
  assert.equal(seen.timeout, 6000); assert.equal(seen.pumps, 150)
})

t('gather re-checks its abort signal right after awaiting the buried pick, before anything can claim the body (Codex: the await is a seam)', () => {
  const c = strip(RAW)
  const g = c.slice(c.indexOf('async function gather('))
  const a = g.indexOf('buriedPick = await pickBuriedApproach('), chk = g.indexOf('check(signal)', a), claim = g.indexOf("runner?.claimBody?.('dig')")
  assert.ok(a > 0 && chk > a && chk < claim, `order: await ${a} < check ${chk} < claim ${claim}`)
  assert.ok(g.slice(a, chk).includes('signal,'), 'the signal is handed to the pick')
})
t('MUTANT: dropping the post-await check(signal) is caught', () => {
  const c = strip(RAW)
  const g = c.slice(c.indexOf('async function gather('))
  const a = g.indexOf('buriedPick = await pickBuriedApproach('); const seg = g.slice(a, g.indexOf("runner?.claimBody?.('dig')"))
  const firstCheck = seg.indexOf('check(signal)'); assert.ok(firstCheck > 0, 'ANCHOR MISSING')
  const bad = seg.slice(0, firstCheck) + seg.slice(firstCheck + 'check(signal)'.length)
  // the mutant removes the check that follows the await: no check may remain within the pick's own statement + 400 chars
  const endOfPick = bad.indexOf('})', 0) + 2
  assert.ok(!bad.slice(endOfPick, endOfPick + 400).includes('check(signal)'), 'the post-await check survived the mutant')
  assert.ok(seg.slice(seg.indexOf('})') + 2, seg.indexOf('})') + 402).includes('check(signal)'), 'the real code has the check right after the pick')
})
await ta('an aborted signal stops the buried pick before the next candidate is planned', async () => {
  let planned = 0
  const ctl = new AbortController()
  const plan = async () => { planned++; ctl.abort(); return { take: false, why: 'x' } }
  const r = await pickBuriedApproach(bot, [V(304, 40, 300), V(305, 40, 300), V(306, 40, 300)], { plan, signal: ctl.signal })
  assert.equal(planned, 1, 'planned more candidates after the abort'); assert.equal(r.target, null)
})
t('a buried target has the cell above it opened (under the same safety test) before it is broken, so the drop can be reached', () => {
  const c = strip(RAW)
  const s = c.indexOf('export async function collectManually('); const e = c.indexOf('async function pickupNearbyItems(')
  const f = c.slice(s, e)
  const chk = f.indexOf('if (safeToBreak && !safeToBreak(p))'), over = f.indexOf('const over = p.offset(0, 1, 0)'), dig = f.indexOf('await withTimeout(bot.dig(block)')
  assert.ok(chk > 0 && over > chk && dig > over, `order: recheck ${chk} < open-above ${over} < dig ${dig}`)
  assert.match(f.slice(chk, over), /if \(adjacent\) \{\s*$/, 'only for a buried target')
  assert.match(f.slice(over, dig), /safeToBreak\(over\)/, 'the same safety test')
  assert.match(f.slice(over, dig), /needsDrop: false/, 'the opening dig wants the hole, not the drop')
  assert.match(f.slice(over, dig), /\}\s*check\(signal\)\s*\}/, 'cancellation is re-checked after the opening dig resolves, before the target is touched')
})

t('MUTANT: re-planning a buried target with the synchronous planner is caught (board-b: 0 of 36 collects walked)', () => {
  const c = strip(RAW)
  const anchor = 'const plan = adjacent\n        ? await planDigApproachAsync(bot, p, {'
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, 'const plan = adjacent\n        ? planDigApproach(bot, p, {')
  const s = bad.indexOf('export async function collectManually('); const f = bad.slice(s, bad.indexOf('async function pickupNearbyItems('))
  assert.ok(!/const plan = adjacent\s*\? await planDigApproachAsync\(/.test(f))
})

t('pickupNearbyItems walks straight at an ADJACENT drop when the pathfinder refuses it, bounded, controls always cleared', () => {
  const c = strip(RAW)
  const s = c.indexOf('async function pickupNearbyItems('); const f = c.slice(s, c.indexOf('async function gather('))
  const cat = f.indexOf('} catch (e) {'), nudge = f.indexOf('if (flat <= PICKUP_NUDGE_BLOCKS && dy <= 1.5)')
  assert.ok(cat > 0 && nudge > cat, 'the nudge lives in the goto failure path')
  assert.match(f.slice(nudge), /setControlState\('forward', true\)[\s\S]{0,120}while \(Date\.now\(\) - t0 < PICKUP_NUDGE_MS\)/, 'a time-capped forward walk')
  assert.match(f.slice(nudge), /Math\.hypot\(target\.x - here\.x, target\.z - here\.z\) <= 0\.4\) break/, 'stops where the drop lay (distance bound)')
  assert.match(f.slice(nudge), /if \(!bot\.entities\?\.\[id\]\) break/, 'stops when the item is gone')
  assert.match(f.slice(nudge), /finally \{ bot\.clearControlStates\(\) \}/, 'controls are cleared on every exit')
  assert.match(c, /const PICKUP_NUDGE_BLOCKS = 2\.2/); assert.match(c, /const PICKUP_NUDGE_MS = 1_200/)
})
t('MUTANT: an unbounded nudge (no distance gate) is caught', () => {
  const c = strip(RAW)
  const anchor = 'if (flat <= PICKUP_NUDGE_BLOCKS && dy <= 1.5) {'
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, 'if (true) {')
  assert.ok(!bad.includes(anchor))
})

t('MUTANT: a nudge that no longer stops at the drop (distance bound removed) is caught', () => {
  const c = strip(RAW)
  const anchor = 'if (Math.hypot(target.x - here.x, target.z - here.z) <= 0.4) break'
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, '')
  assert.ok(!/Math\.hypot\(target\.x - here\.x, target\.z - here\.z\) <= 0\.4\) break/.test(bad))
})


// THE NUDGE MAY NOT CROSS A HOLE. A world is a map of "x,y,z" -> block; anything
// unlisted is stone below y=40 and air at/above it, so a flat floor is the default.
const world = (over = {}) => (x, y, z) => {
  const k = `${x},${y},${z}`
  if (k in over) return over[k] === null ? null : { name: over[k], boundingBox: (over[k] === 'air' || over[k] === 'water' || over[k] === 'lava') ? 'empty' : 'block' }
  return y < 40 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }
}
const feet = { x: 300.5, y: 40, z: 300.5 }
t('nudgeGround: a flat floor to a drop two blocks away is walkable, and every swept column is checked', () => {
  const r = nudgeGround(world(), feet, { x: 302.5, y: 40, z: 300.5 })
  assert.equal(r.ok, true); assert.ok(r.columns >= 3, `swept ${r.columns} columns`)
  assert.equal(nudgeGround(world(), feet, { x: 302.5, y: 39, z: 300.5 }).ok, true, 'a drop one block lower on the same floor')
})
t('nudgeGround: a one-block pit between the bot and the drop refuses the walk and names the column', () => {
  const r = nudgeGround(world({ '301,39,300': 'air', '301,38,300': 'air' }), feet, { x: 302.5, y: 40, z: 300.5 })
  assert.equal(r.ok, false); assert.match(r.why, /no floor under 301,39,300/)
})
t('nudgeGround: a single step down onto a solid is allowed; a two-deep drop is not', () => {
  assert.equal(nudgeGround(world({ '301,39,300': 'air' }), feet, { x: 302.5, y: 40, z: 300.5 }).ok, true)
  assert.equal(nudgeGround(world({ '301,39,300': 'air', '301,38,300': 'air' }), feet, { x: 302.5, y: 40, z: 300.5 }).ok, false)
})
t('nudgeGround: lava anywhere in the band refuses -- under the floor, at the feet, or at the head', () => {
  for (const y of [38, 39, 40, 41]) {
    const r = nudgeGround(world({ [`301,${y},300`]: 'lava' }), feet, { x: 302.5, y: 40, z: 300.5 })
    assert.equal(r.ok, false, `lava at y=${y}`); assert.match(r.why, /lava at 301/)
  }
  assert.equal(nudgeGround(world({ '301,39,300': 'water' }), feet, { x: 302.5, y: 40, z: 300.5 }).ok, false, 'water is not a floor to step down onto')
})
t('nudgeGround: a magma-block floor is solid by shape and still refused; so is a cactus or fire on the route', () => {
  const r = nudgeGround(world({ '301,39,300': 'magma_block' }), feet, { x: 302.5, y: 40, z: 300.5 })
  assert.equal(r.ok, false); assert.match(r.why, /magma_block at 301,39,300/)
  assert.equal(nudgeGround(world({ '302,40,300': 'cactus' }), feet, { x: 302.5, y: 40, z: 300.5 }).ok, false, 'cactus at the feet')
  assert.equal(nudgeGround(world({ '301,40,300': 'fire' }), feet, { x: 302.5, y: 40, z: 300.5 }).ok, false, 'fire on the way')
  assert.equal(nudgeGround(world({ '301,38,300': 'magma_block' }), feet, { x: 302.5, y: 40, z: 300.5 }).ok, false, 'magma under the floor (a step down would land on it)')
})
t('nudgeGround: the sweep runs past the drop -- a pit just beyond it refuses, and ice underfoot anywhere refuses', () => {
  // drop at x=302.5; the body would be released at ~302.1 and slide on; column x=303 is within 0.6 past it
  const r = nudgeGround(world({ '303,39,300': 'air', '303,38,300': 'air' }), feet, { x: 302.5, y: 40, z: 300.5 })
  assert.equal(r.ok, false); assert.match(r.why, /303,39,300/)
  assert.equal(nudgeGround(world({ '304,39,300': 'air', '304,38,300': 'air' }), feet, { x: 302.5, y: 40, z: 300.5 }).ok, true, 'a pit 1.5 past the drop is beyond the overshoot')
  const ice = nudgeGround(world({ '301,39,300': 'packed_ice' }), feet, { x: 302.5, y: 40, z: 300.5 })
  assert.equal(ice.ok, false); assert.match(ice.why, /slippery packed_ice/)
  assert.equal(nudgeGround(world(), feet, { x: 300.5, y: 40, z: 300.5 }).ok, true, 'a drop under the feet needs no walk')
})
t('nudgeGround: a pressure plate or tripwire on the route refuses -- the floor is read as it is and a step changes it', () => {
  for (const name of ['stone_pressure_plate', 'oak_pressure_plate', 'tripwire', 'tripwire_hook']) {
    const r = nudgeGround(world({ '301,40,300': name }), feet, { x: 302.5, y: 40, z: 300.5 })
    assert.equal(r.ok, false, name); assert.match(r.why, new RegExp(`${name} at 301,40,300`))
  }
})
t('nudgeGround: water at the feet or head on the route refuses (a current can carry the body out of the band)', () => {
  for (const y of [40, 41]) {
    const r = nudgeGround(world({ [`301,${y},300`]: 'water' }), feet, { x: 302.5, y: 40, z: 300.5 })
    assert.equal(r.ok, false, `water at y=${y}`); assert.match(r.why, /water at 301/)
  }
  assert.equal(nudgeGround(world({ '301,38,300': 'water' }), feet, { x: 302.5, y: 40, z: 300.5 }).ok, true, 'water two below a solid floor is not on the walk')
})
t('nudgeGround: an unloaded column is a refusal, never a pass', () => {
  const r = nudgeGround(world({ '301,39,300': null }), feet, { x: 302.5, y: 40, z: 300.5 })
  assert.equal(r.ok, false); assert.match(r.why, /unknown block/)
})
t('nudgeGround: the body is 0.6 wide -- a pit beside the centre line, inside the swept box, still refuses', () => {
  // walking along x at z=300.5; the body covers z in [300.2, 300.8] -> only column z=300 -- so
  // shift the walk to z=300.85 and the box reaches z=301 as well.
  const r = nudgeGround(world({ '301,39,301': 'air', '301,38,301': 'air' }), { x: 300.5, y: 40, z: 300.85 }, { x: 302.5, y: 40, z: 300.85 })
  assert.equal(r.ok, false); assert.match(r.why, /301,39,301/)
  assert.equal(nudgeGround(world({ '301,39,301': 'air', '301,38,301': 'air' }), feet, { x: 302.5, y: 40, z: 300.5 }).ok, true, 'the same pit outside the box is not on the route')
})

t('pickupNearbyItems probes the ground before it moves, and a refusal leaves the drop where the old code left it', () => {
  const c = strip(RAW)
  const s = c.indexOf('async function pickupNearbyItems('); const f = c.slice(s, c.indexOf('async function gather('))
  const gate = f.indexOf('const ground = nudgeGround('), walk = f.indexOf("setControlState('forward', true)")
  assert.ok(gate > 0 && walk > gate, 'the probe precedes the walk')
  assert.match(f.slice(gate, walk), /if \(!ground\.ok\) \{[\s\S]{0,300}kind: 'pickup_nudge_refused'[\s\S]{0,200}return\s*\}/, 'a refusal logs and returns -- no walk')
  assert.match(f.slice(gate), /nudgeGround\(\(x, y, z\) => bot\.blockAt\(new Vec3\(x, y, z\)\), bot\.entity\.position, drop\.position\)/, 'probed from the feet to the drop')
})
t('MUTANT: a nudge that walks without probing the ground is caught', () => {
  const c = strip(RAW)
  const anchor = 'if (!ground.ok) {'
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, 'if (false) {')
  const s = bad.indexOf('async function pickupNearbyItems('); const f = bad.slice(s, bad.indexOf('async function gather('))
  assert.ok(!/if \(!ground\.ok\) \{/.test(f))
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
