// THE PROPERTY: NO REACHABLE STATE ADMITS AN EMPTY SET OF ACTIONS.
//
// This is the test that would have caught all five traps. Each of them passed
// its own unit test -- the guards were individually correct -- and the fleet
// still froze, because nothing asserted anything about their COMPOSITION.
//
// So this file does not check cases someone thought of. It enumerates the whole
// discretised state space and asserts totality over every point in it.
import assert from 'node:assert'
import test from 'node:test'
import fs from 'node:fs'
import { escapePlan, untotalStates, ESCAPES, EscapeIsNotTotal } from '../src/escape.mjs'

// The axes, at the boundaries that matter. `underfootDrop: null` is the measured
// 16.3% case -- no floor within the probe -- and is NOT the same as 0.
const AXES = {
  afloat:          [false, true],
  health:          [20, 10, 6, 1],
  blocks:          [0, 1, 24, 25, 64],
  underfootSolid:  [false, true],
  underfootDrop:   [null, 0, 1, 3, 17, 18, 200],
  floorBelowSolid: [false, true],
  lateralTread:    [false, true],
  columnOpen:      [false, true],
  canStepOff:      [false, true],
}

function* cross (axes, keys = Object.keys(axes), i = 0, acc = {}) {
  if (i === keys.length) { yield { ...acc }; return }
  for (const v of axes[keys[i]]) yield* cross(axes, keys, i + 1, { ...acc, [keys[i]]: v })
}

test('POSITIVE CONTROL: the enumeration is large and the function discriminates', () => {
  const all = [...cross(AXES)]
  assert.ok(all.length > 8000, `only ${all.length} states — the cross product collapsed`)
  // If every state returned the same action this suite would prove nothing.
  const seen = new Set(all.map(s => { try { return escapePlan({ ...s, trapped: true }) } catch { return 'THREW' } }))
  assert.ok(seen.size >= 5, `only ${seen.size} distinct outcomes: ${[...seen]}`)
  assert.ok(seen.has('step_off'), 'the bottom rung is never reached — the lattice has no floor')
  assert.ok(seen.has('dig_down'), 'the cheapest rung is never reached')
})

test('TOTALITY: every trapped state names an action', () => {
  const states = [...cross(AXES)].map(s => ({ ...s, trapped: true }))
  const bad = untotalStates(states)
  assert.deepEqual(bad.slice(0, 5), [],
    `${bad.length} of ${states.length} trapped states admit no action`)
  assert.equal(bad.length, 0)
})

test('...and every action is a member of the closed enum', () => {
  for (const s of cross(AXES)) {
    const a = escapePlan({ ...s, trapped: true })
    assert.ok(ESCAPES.includes(a), `${a} is not in ESCAPES`)
  }
})

test('not trapped means none — totality is not an excuse to act', () => {
  assert.equal(escapePlan({ trapped: false }), 'none')
  assert.equal(escapePlan({}), 'none')
  assert.equal(escapePlan(), 'none')
  // Even a bot in a terrible-looking state does nothing if it is not trapped.
  assert.equal(escapePlan({ trapped: false, afloat: true, health: 1, canStepOff: true }), 'none')
})

test('THE MEASURED POPULATION: 734 bots at y>=125 over an unmeasured void', () => {
  // A bot at y=197 on a one-block platform: nothing solid underfoot, no floor
  // within the probe, no lateral tread, no blocks. Every survivable rung refuses
  // it — correctly. This is the state that produced 1,205 attempts and 0 successes.
  const strandedHigh = {
    trapped: true, afloat: false, health: 20, blocks: 0,
    underfootSolid: false, underfootDrop: null, floorBelowSolid: false,
    lateralTread: false, columnOpen: true, canStepOff: true,
  }
  assert.equal(escapePlan(stranedOrSelf(strandedHigh)), 'step_off',
    'the bot this whole change exists for must reach the bottom rung')
})
function stranedOrSelf (s) { return s }

test('DOWN BEFORE UP — climbing is what stranded this population', () => {
  const base = { trapped: true, health: 20, blocks: 64, columnOpen: true, canStepOff: true }
  // With a survivable drop underfoot AND enough blocks to pillar, descend.
  assert.equal(escapePlan({ ...base, underfootSolid: true, underfootDrop: 1 }), 'dig_down')
  // The ramp also loses to descending.
  assert.equal(escapePlan({ ...base, underfootSolid: true, underfootDrop: 1, lateralTread: true }),
    'dig_down')
  // Only when nothing descends does climbing win.
  assert.equal(escapePlan({ ...base, lateralTread: true }), 'stair_up')
  assert.equal(escapePlan({ ...base }), 'pillar_up')
})

test('AN UNMEASURED DROP NEVER BECOMES A DIG', () => {
  // null is "the probe found no floor", not "the floor is at zero". `null <= 3`
  // is true in JavaScript, so this is the arithmetic that would kill bots.
  const s = { trapped: true, underfootSolid: true, health: 20, canStepOff: true }
  assert.notEqual(escapePlan({ ...s, underfootDrop: null }), 'dig_down')
  assert.notEqual(escapePlan({ ...s, underfootDrop: undefined }), 'dig_down')
  assert.notEqual(escapePlan({ ...s, underfootDrop: NaN }), 'dig_down')
  assert.notEqual(escapePlan({ ...s, underfootDrop: Infinity }), 'dig_down')
  // ...and a measured, survivable one does.
  assert.equal(escapePlan({ ...s, underfootDrop: 1 }), 'dig_down')
})

test('a lethal drop is refused even though the bottom rung is death', () => {
  // These are NOT the same choice. `step_off` is taken when nothing else can
  // work; a lethal dig is taken INSTEAD of something that would have worked, so
  // it must never win on cost.
  const s = { trapped: true, underfootSolid: true, underfootDrop: 200, health: 20,
              lateralTread: true, canStepOff: true }
  assert.equal(escapePlan(s), 'stair_up', 'a survivable rung must beat a lethal one')
  assert.equal(escapePlan({ ...s, underfootDrop: 18 }), 'stair_up', 'one past the cap at full health')
  assert.equal(escapePlan({ ...s, underfootDrop: 17 }), 'dig_down', 'the cap itself is fine')
})

test('a free drop stays free for a nearly-dead bot', () => {
  // max(0, blocks-3), so a 3-block fall costs nothing at any health. Refusing it
  // would strand exactly the bots that most need a cheap way down.
  for (const hp of [20, 6, 2, 1]) {
    assert.equal(escapePlan({ trapped: true, underfootSolid: true, underfootDrop: 3,
                              health: hp, canStepOff: true }), 'dig_down', `hp ${hp}`)
  }
  // But a costly drop is priced against the health there is.
  assert.equal(escapePlan({ trapped: true, underfootSolid: true, underfootDrop: 10,
                            health: 8, lateralTread: true, canStepOff: true }), 'stair_up')
})

test('water is terrain, and it outranks everything', () => {
  // Owner directive: swimming is travel, the only water reflex is getting air.
  // A floating bot is somewhere that needs traversing, not a bot in danger.
  assert.equal(escapePlan({ trapped: true, afloat: true, health: 1, canStepOff: true }),
    'surface_swim')
  assert.equal(escapePlan({ trapped: true, afloat: true, underfootSolid: true, underfootDrop: 1 }),
    'surface_swim')
})

test('a SEALED bot never reaches the bottom rung — the ramp is its answer', () => {
  // Sealed in rock at y=-19: by the definition of sealed there IS a solid
  // lateral neighbour, so `stair_up` fires and death is never considered. That
  // is the composition property, and it is why `canStepOff` gates the bottom.
  const sealed = { trapped: true, lateralTread: true, canStepOff: false,
                   underfootSolid: true, underfootDrop: null, health: 20 }
  assert.equal(escapePlan(sealed), 'stair_up')

  // AND THE CONTRADICTION IS NO LONGER REPRESENTABLE, which is the real fix.
  //
  // The first version of this assertion expected `{lateralTread:false,
  // canStepOff:false}` to RAISE. That was wrong twice over: the pair cannot both
  // describe the world -- a foot-level lateral cell is solid or it is passable --
  // and expecting a raise treated an impossible input as a state to handle.
  // Now the geometry decides: no solid neighbour means an open one, so the
  // bottom rung is available and is taken.
  assert.equal(escapePlan({ trapped: true, canStepOff: false }), 'step_off',
    'no lateral tread means an open lateral cell, so stepping off IS available')
  assert.equal(escapePlan({ trapped: true, canStepOff: false, lateralTread: true }), 'stair_up',
    'and a solid neighbour is a ramp, never a reason to die')
  assert.ok(EscapeIsNotTotal, 'the raise is retained for a genuinely undescribed state')
})

test('MUTANT: removing the bottom rung must break totality', async () => {
  // Reuse the shape from climb-escape.test.mjs: anchor present AND unique, mutant
  // written to a TEMP file under test/ (never src/ — the runner SIGKILLs and an
  // in-place mutant would be deployed within six hours), imported, deleted.
  const url = new URL('../src/escape.mjs', import.meta.url)
  const src = fs.readFileSync(url, 'utf8')
  const anchor = "  if (canStepOff !== false || !lateralTread) return 'step_off'"
  assert.ok(src.includes(anchor), 'MUTANT ANCHOR MISSING: never written reads as killed')
  assert.strictEqual(src.split(anchor).length, 2, 'MUTANT ANCHOR NOT UNIQUE')

  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`,
                      import.meta.url)
  fs.writeFileSync(out, src.replace(anchor, "  if (false) return 'step_off'"))
  // NOTE: this anchor moved once already. The first version read
  // `if (canStepOff) ...`; when the bottom rung became structural the anchor
  // stopped matching and this test FAILED rather than quietly reporting a kill,
  // which is the entire reason CLAUDE.md requires the presence check.
  try {
    const mut = await import(out.href)
    const states = [...cross(AXES)].map(s => ({ ...s, trapped: true }))
    const bad = mut.untotalStates(states)
    assert.ok(bad.length > 0,
      'the mutant must actually break totality, or this test proves nothing')
    assert.equal(untotalStates(states).length, 0, 'and the real module must still be total')
  } finally { try { fs.unlinkSync(out) } catch {} }
})
