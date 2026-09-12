// BURIED, BUT AT THIS LEVEL: ASK THE DIG-APPROACH BEFORE DECLARING IT UNREACHABLE.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { Vec3 } from 'vec3'
import { pickBuriedApproach, BURIED_APPROACH_RADIUS, BURIED_APPROACH_DY } from '../src/digapproach.mjs'
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
  assert.match(g, /await collectManually\(bot, target, signal, buried \? \{ claim: digClaim, safeToBreak: safeTarget \} : \{\}\)/, 'the claim and the safety re-check travel together')
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

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
