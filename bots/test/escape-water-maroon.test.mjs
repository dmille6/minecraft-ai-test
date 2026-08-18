// TWO WAYS THE ESCAPE LAYER LIED, both found by measuring a 14-hour fleet run
// in which a 4x larger model changed nothing.
//
// 1. DROWNING RELEASE. `drowning_escaped` was logged on BOTH exits from the
//    rescue: reaching land, and the 20-second ownership ceiling expiring. So a
//    bot still floating recorded the same success as one standing on a beach.
//    Over fourteen hours `_drowning_route` fired 3,334 times and
//    `_drowning_escaped` 3,329 -- near-equal pairs that read as "we rescue it
//    every time" and actually meant "the loop restarts every time". Gather01
//    sat six blocks from home and failed `home` 47 times out of 47, every one
//    of them reported as `interrupted: drowning`.
//
// 2. MAROONED WITHOUT BLOCKS. The maroon branch required `haveBlocks` and had
//    no else. A bot that could not start a path, with an open column overhead
//    and an empty inventory, produced nothing at all: no event, no
//    prerequisite, no log line. The most trapped state the system can reach was
//    the only one that was silent -- and `_prereq_adopted` fired 73 times
//    against 1,601 trap events.
//
// Both are tested through the REAL predicates, imported. A local copy would
// keep passing after reflex.mjs changed, which is the class of test that lets a
// defect ship.
import assert from 'node:assert'
import { drowningRelease, maroonState, scaffoldPrereq } from '../src/reflex.mjs'
import { climbPrerequisite } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// ---------------------------------------------------------------- drowning --
t('reaching land is an escape', () => {
  const r = drowningRelease(true)
  assert.equal(r.kind, 'drowning_escaped')
  assert.equal(r.status, 'success')
  assert.equal(r.escaped, true)
})

t('the 20s ceiling expiring in water is NOT an escape', () => {
  const r = drowningRelease(false)
  assert.equal(r.kind, 'drowning_released_timeout',
    'a timeout logged as drowning_escaped is what made 3,329 rescues look real')
  assert.equal(r.status, 'failed')
  assert.equal(r.escaped, false)
})

t('the two exits are distinguishable in telemetry', () => {
  // The whole point: a query for drowning_escaped must count only real ones.
  assert.notEqual(drowningRelease(true).kind, drowningRelease(false).kind)
})

// ---------------------------------------------------------------- marooned --
const base = { upIsOpen: true, haveBlocks: false, entombed: false, canStartPath: false }

t('trapped with no blocks asks for scaffold instead of doing nothing', () => {
  assert.equal(maroonState(base), 'need_scaffold')
})

t('trapped with blocks climbs, as before', () => {
  assert.equal(maroonState({ ...base, haveBlocks: true }), 'climb')
})

t('a bot that can start a path is not marooned', () => {
  assert.equal(maroonState({ ...base, canStartPath: true }), 'none')
  assert.equal(maroonState({ ...base, haveBlocks: true, canStartPath: true }), 'none')
})

t('a sealed column is entombment, not marooning', () => {
  // The entombed handler owns that case; claiming it here would have two
  // branches fighting for the same body.
  assert.equal(maroonState({ ...base, upIsOpen: false }), 'none')
  assert.equal(maroonState({ ...base, entombed: true }), 'none')
})

t('every trapped case now produces SOME state -- none is silent', () => {
  const seen = new Set()
  for (const upIsOpen of [true, false]) {
    for (const haveBlocks of [true, false]) {
      for (const entombed of [true, false]) {
        for (const canStartPath of [true, false]) {
          const st = maroonState({ upIsOpen, haveBlocks, entombed, canStartPath })
          assert.ok(['none', 'climb', 'need_scaffold'].includes(st),
            `unhandled combination produced ${st}`)
          seen.add(st)
        }
      }
    }
  }
  assert.ok(seen.has('need_scaffold'),
    'the case that used to fall through must now be reachable')
})

// ------------------------------------------------------- one shared ask ------
t('reflex and skill layers ask for the SAME scaffold', () => {
  // A bot rescued by the reflex and one rescued through `surface` must request
  // an identical thing, or the two paths teach the fleet different lessons and
  // the avoid rules learned from one do not transfer to the other.
  const fromSkill = climbPrerequisite('no scaffold blocks left')
  const fromReflex = scaffoldPrereq('marooned')
  assert.deepEqual(fromReflex.items, fromSkill.items)
  assert.equal(fromReflex.count, fromSkill.count)
  assert.equal(fromReflex.describe, fromSkill.describe)
})

t('the scaffold ask carries a reason, since applyPrereq surfaces it', () => {
  const p = scaffoldPrereq('no path can start from y=47')
  assert.match(p.because, /y=47/)
  assert.ok(p.count > 0 && p.items.length > 0)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
