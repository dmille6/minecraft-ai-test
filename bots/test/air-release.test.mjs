// A RESCUE ENDS WHEN THE BOT IS BREATHING. NOT WHEN IT IS DRY.
//
// The owner's model, stated plainly: walking, running, jumping and SWIMMING are
// all ways of moving in Minecraft. Getting air when it runs low is a reflex.
// Everything in this file follows from taking that literally.
//
// What was deleted, and the ledger that justified it (full walk, 6,946,826
// events):
//
//     _drowning_to_shore            281,080
//     _drowning_swim_to_known_land   59,662
//     _drowning_no_shore             92,845
//     _drowning_escaped              32,231   <- the ONLY success kind
//     _drowning_surfaced_stranded    74,102
//     _drowning_released_timeout    102,779
//     _drowning_reentry             144,356
//
// 32,231 successes against 176,881 failed releases, and 144,356 bots that
// turned around and swam straight back in -- because being in water was never
// a problem. The rescue pursued air and was graded on land.
//
// What SURVIVED, and why it is not the same thing: breathableRoute's `out`
// branch. 18,672 routes went sideways, 88.9% of them at y=30-49, in flooded
// caves with solid rock overhead. That is a metre-scale swim to an AIR POCKET
// within 8 blocks. It was only ever confused with the 24-to-96-block hunt for
// standable ground because both were called "sideways".
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { drowningControls, waterPosture, drowningRelease } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const AIR = { name: 'air', boundingBox: 'empty' }
const WATER = { name: 'water', boundingBox: 'empty' }

// --- the deleted phase ------------------------------------------------------

t('BREATHING BUT WET IS NOT AN EMERGENCY: the body is handed back', () => {
  const c = drowningControls({ losing: false, route: { dir: 'up' } })
  assert.equal(c.phase, 'done')
  assert.equal(c.forward, false, 'a breathing bot must not be driven anywhere')
  assert.equal(c.jump, false, 'nor held at the surface')
})

t('MUTANT: a phase that steers a breathing bot to land is gone', () => {
  // The deleted phase 2 returned {phase:'to_shore', forward:true} whenever a
  // bank was in range. Passing the old argument shape must not revive it.
  const c = drowningControls({ losing: false, route: null,
                               shore: { dir: 'shore', target: { x: 9, y: 63, z: 0 }, dist: 9 },
                               bearing: { x: 100, z: 100, phase: 'swim_home' } })
  assert.equal(c.phase, 'done', `a shore in range must not restart a rescue (got ${c.phase})`)
  assert.equal(c.forward, false)
})

// --- what is load-bearing and must not be deleted with it -------------------

t('FLOODED CAVE: a solid ceiling still sends the bot sideways to air', () => {
  const c = drowningControls({ losing: true, route: { dir: 'out', target: { x: 3, y: 30, z: 0 } } })
  assert.equal(c.phase, 'to_air', 'the 8.4% at y=30-49 depend on this branch')
  assert.equal(c.forward, true)
  assert.deepEqual(c.lookAt, { x: 3, y: 30, z: 0 })
})

t('OPEN WATER: losing air with a clear column goes straight up', () => {
  const c = drowningControls({ losing: true, route: { dir: 'up' } })
  assert.equal(c.phase, 'up')
  assert.equal(c.forward, false, 'up is not a direction you swim forward into')
  assert.equal(c.jump, true)
})

t('SEALED: no route at all still holds the head up rather than miming a fix', () => {
  const c = drowningControls({ losing: true, route: null })
  assert.equal(c.phase, 'up')
  assert.equal(c.jump, true)
})

// --- wetness is not a condition ---------------------------------------------

t("'float' SURVIVES, and the distinction is the whole point", () => {
  // This looks like the thing being deleted and is not. It fires only for an
  // UNOWNED bot; an idle entity in water sinks, so holding its head up is life
  // support. It scans nothing, steers nowhere, and prefers no ground. What was
  // deleted seized a BUSY bot and drove it at a beach.
  const p = waterPosture({ owned: false, ashore: false, feet: WATER, head: AIR })
  assert.equal(p, 'float')
  assert.equal(waterPosture({ owned: true, ashore: false, feet: WATER, head: AIR }), false,
    'a bot running a skill owns its own body; that is the rollback guard')
})

t('head UNDER water with air above is still a posture', () => {
  const p = waterPosture({ owned: false, ashore: false, feet: WATER, head: WATER,
                           route: { dir: 'up' } })
  assert.equal(p, 'surface')
})

t('head under with air only sideways still steers to it', () => {
  const p = waterPosture({ owned: false, ashore: false, feet: WATER, head: WATER,
                           route: { dir: 'out' } })
  assert.equal(p, 'surface_out')
})

// --- one outcome -------------------------------------------------------------

t('a rescue that ends with the bot breathing SUCCEEDED, wherever it stands', () => {
  const r = drowningRelease()
  assert.equal(r.status, 'success')
  assert.equal(r.landed, false, 'the reflex has no opinion about where the bot ends up')
  assert.ok(!/shore|stranded|timeout|escaped/.test(r.kind),
    `the kind must not grade against land (got ${r.kind})`)
})

t('MUTANT: the three land-graded release kinds cannot be produced', () => {
  // drowningRelease used to take (ashore, {reason}) and return one of three
  // kinds, two of which were "failures" only because the bot was still wet.
  for (const args of [[true, { reason: 'ceiling' }], [false, { reason: 'no_shore' }],
                      [false, { reason: 'ceiling' }]]) {
    assert.equal(drowningRelease(...args).kind, 'drowning_breathing',
      'old arguments must not select an old outcome')
  }
})

// --- anti-regrowth ------------------------------------------------------------

const reflexSrc = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
// Comments are where the reasoning lives, so strip them before grepping for
// live code. A guard that fires on its own explanation gets deleted, not fixed.
const reflexCode = reflexSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

t('THE REFLEX CANNOT SEE SHORE AT ALL', () => {
  for (const banned of ['shoreRoute', 'shoreScan', 'shoreCache', 'swimBearing',
                        'lastShoreReachable', 'bestShoreDist', 'to_shore', 'no_shore',
                        'drowning_reentry', 'water-release.mjs']) {
    assert.ok(!reflexCode.includes(banned),
      `${banned} is back in reflex.mjs -- shore is an admission question, not a reflex one`)
  }
})

t('THE RELEASE CONDITION IS BREATH, AND ashore() IS NOT PART OF IT', () => {
  // Behavioural anchor, not a line match: find the branch that clears
  // `rescuing` on a normal release and prove what it tests.
  const m = reflexCode.match(/if \(rescuing && !air\.losing && ([^)]*)\)/)
  assert.ok(m, 'the normal release branch is gone or was reshaped without updating this test')
  assert.ok(/breathing/.test(m[1]), `release must be gated on breath (got: ${m[1]})`)
  assert.ok(!/ashore/.test(m[1]), `release must NOT be gated on standing on land (got: ${m[1]})`)
  assert.ok(!/dryMs/.test(m[1]), `release must NOT be gated on being dry (got: ${m[1]})`)
  // And `breathing` must be the GEOMETRIC fact, not the spoofable sensor.
  assert.ok(/const breathing = headOut/.test(reflexCode),
    'breathing must be derived from the head block')
  assert.ok(/headOutSince = headOut \? \(headOutSince \|\| Date\.now\(\)\) : 0/.test(reflexCode),
    'the head-out dwell clock is gone; a one-tick bob would release mid-drown')
})

t('DELETING ashore() WITHOUT breathingAgain WOULD BE WORSE: the backstop is separate', () => {
  // If the breath release were removed, `rescuing` would stay latched until the
  // ceiling and every rescue would become a 45s ownership hold. The ceiling
  // branch must therefore be its OWN branch, logging its own failure kind, and
  // must not be the only way out.
  assert.ok(/drowning_ceiling_no_air/.test(reflexCode),
    'the sealed-case backstop must log a distinct failure, never hide inside the success kind')
  assert.ok(reflexCode.indexOf('breathingAgain(bot.oxygenLevel') <
            reflexCode.indexOf('drowning_ceiling_no_air'),
    'breath must be tested before the ceiling, or the ceiling grades honest rescues as failures')
})

// Both of the next two tests anchor on the BREATHING EXPRESSION ITSELF, not on
// the presence of a constant somewhere in the file. An earlier version of this
// guard asserted only that RELEASE_DWELL_MS was declared, and a mutant that
// deleted the dwell from the comparison while leaving the constant in place
// passed it cleanly. Declaring a safety value is not using it -- that is the
// same defect as a correctly-configured thing nothing reads.
const breathingExpr = (() => {
  const i = reflexCode.indexOf('const breathing = headOut')
  return i < 0 ? null : reflexCode.slice(i, reflexCode.indexOf('\n      if (', i))
})()

t('THE DWELL IS APPLIED, not merely declared', () => {
  assert.ok(breathingExpr, 'the breathing derivation is gone or was reshaped')
  assert.ok(/RELEASE_DWELL_MS/.test(breathingExpr),
    'the head-out duration is not compared against the dwell — a one-tick bob at a ' +
    'wave crest releases the body mid-drown, which is the "idle at the moment of ' +
    'death" shape this exists to prevent')
  assert.ok(/Date\.now\(\) - headOutSince >= RELEASE_DWELL_MS/.test(breathingExpr),
    'the dwell comparison is not the head-out branch of the release')
  const dwell = reflexCode.match(/RELEASE_DWELL_MS = ([\d_]+)/)
  assert.ok(dwell && parseInt(dwell[1].replace(/_/g, ''), 10) >= 500,
    'a dwell under 500ms does not outlast a wave')
})

t('OXYGEN IS FISH: the release must not trust bot.oxygenLevel alone', () => {
  // mineflayer writes bot.oxygenLevel from ANY nearby entity's air_supply, so a
  // fish swimming past sets a drowning bot's oxygen to full. Confirmed; three
  // fixes failed. If that field could release the rescue, wildlife could hand
  // back the body of a drowning bot.
  assert.ok(breathingExpr, 'the breathing derivation is gone or was reshaped')
  // oxygenLevel may appear ONLY behind the head == null guard.
  assert.ok(/head == null && breathingAgain/.test(breathingExpr),
    'breathingAgain must be reachable only when the head block cannot be read at all — ' +
    'otherwise a fish swimming past hands back the body of a drowning bot')
})

t('shore.mjs exists and reflex.mjs does not import it', () => {
  const shoreSrc = readFileSync(new URL('../src/shore.mjs', import.meta.url), 'utf8')
  assert.ok(/export function shoreRoute/.test(shoreSrc), 'admission still needs it')
  assert.ok(!/from '\.\/shore\.mjs'/.test(reflexCode),
    'the reflex reached for shore again')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
