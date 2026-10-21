// protectzone-01 x homefix-02 (JIT 10-21b, protectzone-on-d014ec2 and the ironpick-on-d014ec2 tip): the protected-zone
// guard against homefix-02's air digs and the watchdog's rescues.
//
// homefix-02 C1 adds a head-cell ice dig (airPocketPlan kind 'ice', dy 1) to the flooded-pocket reflex; homefix-01/02 run
// the watchdog's rescues (surface / goto / home) as runner skills under a reservation. protectzone-01's guard lets a
// SURVIVAL dig through a zone (digPurpose: a reflex holds the body) and refuses every other one. Composed, behaviour only,
// the REAL guard (attachProtectZone) with the REAL digPurpose context, as index.mjs wires it:
//   - the C1 ice dig the plan picks, made while the flooded-pocket reflex holds the body, is ALLOWED in a zone: air first;
//   - CONTROL: the same cell dug by the watchdog's `surface` rescue (holder = the skill, digtown scope transit) is refused
//     with the zone named -- walking out is the remedy there, as on the base;
//   - the reflex name the guard reads is the one reflex.mjs reports (pickuplog activeReflexOf), so the composition does
//     not rest on a literal.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pzhf-'))
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pzhf-st-'))
process.env.LOG_LEVEL = 'error'

const PZ = await import('../src/protectzone.mjs')
const { airPocketPlan } = await import('../src/airpocket.mjs')
const { activeReflexOf } = await import('../src/pickuplog.mjs')
const { withDigScope } = await import('../src/digtown.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) }
}

// the bench fixture's shape (protectzone-fixture.py: the whole column, home.x + 20..44)
const ZONES = PZ.parseZones({ version: 1, zones: [{ id: 'fixture-strip', kind: 'fixture', label: 'the test strip', box: [20, -64, -10, 44, 88, 10] }] }).zones
// a bot swimming under a river's ice sheet inside the strip: feet in water at y 61, the head cell ice at 62, air above
const FEET = { x: 30, y: 61, z: 0 }
const cells = { '0,0,0': { name: 'water' }, '0,1,0': { name: 'ice' }, '0,2,0': { name: 'air' } }
const at = (dx, dy, dz) => cells[`${dx},${dy},${dz}`] ?? { name: 'stone' }

function guardedBot (ctx) {
  const dug = [], refused = []
  const bot = { entity: { position: { x: FEET.x + 0.5, y: FEET.y, z: FEET.z + 0.5 } }, dig: async b => { dug.push(b.position) } }
  PZ.attachProtectZone(bot, { zones: () => ZONES, context: () => ctx, onRefuse: r => refused.push(r) })
  return { bot, dug, refused }
}

await t('the C1 head-cell ice dig: the plan picks the head cell (kind ice, dy 1) and that cell is inside the zone', () => {
  const p = airPocketPlan(at)
  assert.equal(p.ok, true, p.why); assert.equal(p.kind, 'ice'); assert.equal(p.dy, 1)
  assert.ok(PZ.zoneAt(ZONES, FEET.x, FEET.y + p.dy, FEET.z), 'the dig cell is protected')
})

await t('the C1 dig made while the flooded-pocket reflex holds the body is ALLOWED in a zone (survival); nothing refused', async () => {
  const reflex = activeReflexOf({ pocketing: true })
  assert.ok(reflex, 'reflex.mjs names the arm')
  const { bot, dug, refused } = guardedBot({ skill: null, args: null, reflex, holder: reflex })
  const p = airPocketPlan(at)
  await bot.dig({ position: { x: FEET.x, y: FEET.y + p.dy, z: FEET.z } })
  assert.deepEqual(dug, [{ x: 30, y: 62, z: 0 }]); assert.deepEqual(refused, [])
  // the same with a rescue skill holding the runner (the drowning rescue preempts it): the reflex still names the purpose
  const r2 = guardedBot({ skill: 'surface', args: {}, reflex: activeReflexOf({ rescuing: true }), holder: 'surface' })
  await r2.bot.dig({ position: { x: 30, y: 62, z: 0 } })
  assert.equal(r2.dug.length, 1); assert.deepEqual(r2.refused, [])
})

await t('CONTROL: the same cell dug by the watchdog\'s `surface` rescue (holder the skill, transit scope) is refused, the zone and a walk named', async () => {
  const { bot, dug, refused } = guardedBot({ skill: 'surface', args: {}, reflex: null, holder: 'surface' })
  await assert.rejects(withDigScope(bot, { purpose: 'transit', by: 'surface' }, () => bot.dig({ position: { x: 30, y: 62, z: 0 } })),
    e => e instanceof PZ.ProtectedZoneError)
  assert.deepEqual(dug, [])
  assert.equal(refused.length, 1); assert.equal(refused[0].op, 'dig'); assert.equal(refused[0].purpose, 'transit')
  assert.equal(refused[0].zone, 'fixture-strip')
  // no scope at all (a skill's own dig, holder the skill): refused too -- only a reflex holding the body is survival
  const w = guardedBot({ skill: 'surface', args: {}, reflex: null, holder: 'surface' })
  await assert.rejects(w.bot.dig({ position: { x: 30, y: 62, z: 0 } }), e => e instanceof PZ.ProtectedZoneError)
})

await t('OUTSIDE THE ZONE nothing changes: the rescue\'s dig one column west of the strip passes', async () => {
  const { bot, dug, refused } = guardedBot({ skill: 'surface', args: {}, reflex: null, holder: 'surface' })
  await withDigScope(bot, { purpose: 'transit', by: 'surface' }, () => bot.dig({ position: { x: 19, y: 62, z: 0 } }))
  assert.equal(dug.length, 1); assert.deepEqual(refused, [])
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
