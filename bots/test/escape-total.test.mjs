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
  // ADDED WITH THE WATER RUNGS. Without these axes the enumeration could not
  // reach `breach_head_wall` or `float_up` at all, so the totality property --
  // the whole point of this file -- was silently not covering two of the ten
  // rungs. ChatGPT caught this reviewing the design; the rungs were already
  // written and the property would have passed regardless.
  lateralHeadOpen: [false, true],
  breachable:      [false, true],
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

test('water is terrain, and it outranks everything -- WHEN THERE IS A SURFACE', () => {
  // Owner directive: swimming is travel, the only water reflex is getting air.
  // A floating bot is somewhere that needs traversing, not a bot in danger.
  assert.equal(escapePlan({ trapped: true, afloat: true, columnOpen: true, health: 1, canStepOff: true }),
    'surface_swim')
  assert.equal(escapePlan({ trapped: true, afloat: true, columnOpen: true, underfootSolid: true, underfootDrop: 1 }),
    'surface_swim')
})

test('BUT A CAPPED SWIMMER IS ENTOMBED AND WET, and must cut its way out', () => {
  // placebo-b-Delta floated in a sealed flooded pocket at y=44 for thirteen
  // days. Its first escape attempt ever chose surface_swim and reported
  // "swam 0.0 blocks on a fixed heading" -- there is nowhere to swim TO.
  assert.equal(escapePlan({ trapped: true, afloat: true, columnOpen: false, lateralTread: true }),
    'stair_up')
  // and a free descent still beats both, because down is cheaper than out
  assert.equal(escapePlan({ trapped: true, afloat: true, columnOpen: false,
                            underfootSolid: true, underfootDrop: 1 }), 'dig_down')
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
  // ANCHOR MOVED AGAIN, 2026-09-09, and the presence check caught it again:
  // the bottom rung gained `skip.size ||` when `escapePlan` learned to exclude
  // rungs a caller has already seen refuse. Without that term a caller could
  // exclude `stair_up` from a state with `lateralTread: true, canStepOff: false`
  // and fall through to the raise -- the empty admissible set this module exists
  // to make impossible.
  const anchor = "  if (skip.size || canStepOff !== false || !lateralTread) return 'step_off'"
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

// ---------------------------------------------------------------------------
// THE WIRING. Source assertions, because the shapes below are about WHERE a
// call is and whether a guard precedes it -- neither reachable by behaviour.
// Comments are stripped first: this codebase quotes the code it explains.

const REFLEX = fs.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

test('POSITIVE CONTROL: the stripper left executable text intact', () => {
  assert.ok(REFLEX.includes('async function stepOff'), 'stripper destroyed the source')
  assert.ok(!/A RESPAWN LOOP IS WORSE/.test(REFLEX), 'prose survived the stripper')
})

test('step_off is reachable ONLY through the lattice', () => {
  // If anything else could call it, the totality proof would say nothing about
  // when bots die -- the ordering is the entire safety argument.
  //
  // The shape changed when the if/else chain became a table: `stepOff` is now
  // reached as ESCAPE_ROUTINES.step_off, so the guarantee is structural. The
  // table maps that key to nothing else, and nothing else maps to that routine.
  const calls = REFLEX.match(/stepOff\(bot\)|await stepOff\(/g) ?? []
  assert.equal(calls.length, 1, `stepOff reachable from ${calls.length} places; must be exactly one`)
  assert.match(REFLEX, /step_off:\s*bot => stepOff\(bot\)/,
    'the only route to stepOff must be the step_off entry in the routines table')
  // ...and no other table entry may reach it.
  const table = REFLEX.slice(REFLEX.indexOf('const ESCAPE_ROUTINES = {'))
  const other = table.slice(0, table.indexOf('\n}')).split('\n')
    .filter(l => /stepOff/.test(l) && !/step_off:/.test(l))
  assert.deepEqual(other, [], `another rung reaches stepOff: ${other}`)
})

test('THE RESPAWN-LOOP GUARD: step_off is rate limited', () => {
  // A bot that steps off, respawns, walks back and steps off again has become an
  // endless death machine that destroys its inventory every cycle. This is the
  // one guard whose absence would make the bottom rung worse than the trap.
  assert.match(REFLEX, /STEP_OFF_COOLDOWN_MS\s*=\s*600_000/,
    'the cooldown constant must exist and be ten minutes')
  const i = REFLEX.indexOf('await stepOff(')
  const before = REFLEX.slice(Math.max(0, i - 400), i)
  assert.match(before, /lastStepOffAt\s*<\s*STEP_OFF_COOLDOWN_MS/,
    'the cooldown must be CHECKED immediately before the call, not merely defined')
  assert.match(before, /lastStepOffAt\s*=\s*Date\.now\(\)/,
    'and the clock must be stamped, or the cooldown never elapses from zero')
})

test('the observation probes deeper than the dig does', () => {
  // 16.3% of underfoot attempts reported the drop UNMEASURED at a 24-block
  // probe, from bots at a median y of 145. Under-probing collapses "a survivable
  // fall" into "no information", which pushes a bot toward the bottom rung it
  // did not need.
  assert.match(REFLEX, /function observeEscapeState[\s\S]{0,400}maxProbe = 48/,
    'the lattice probe must reach further than harvestUnderfoot 24')
})

test('every rung reached logs one kind carrying the plan', () => {
  // So the success rate is computable PER RUNG without parsing prose, and a rung
  // that never works is visible instead of hidden in an aggregate.
  assert.strictEqual(REFLEX.split("kind: 'escape_lattice'").length, 2,
    'escape_lattice must be emitted from exactly one place')
  const i = REFLEX.indexOf("kind: 'escape_lattice'")
  const near = REFLEX.slice(i, i + 400)
  assert.match(near, /plan=\$\{plan\}/, 'the event must name which rung was chosen')
  assert.match(near, /status: acted\?\.ok/, 'and the status must be the OUTCOME, not a literal')
})

// ---------------------------------------------------------------------------
// THE FIFTH UNREACHABLE REMEDY, BUILT INSIDE THE FIX FOR UNREACHABLE REMEDIES.
//
// The first dispatch was an if/else chain implementing three of seven rungs.
// On the live canary, 32 of 45 consultations chose `ride_floor_down` and fell
// through to a fallback string -- "no routine wired for this rung" -- that the
// author had written himself and then, an hour later, reported the same events
// to the owner as evidence the lattice was working.
//
// `rideFloorDown` had existed in skills.mjs the whole time. reflex.mjs simply
// had no import from it.
//
// A plan that names a routine nobody wired is a refusal wearing a plan's
// clothes, and totality over the PLAN says nothing about it.

test('EXHAUSTIVE: every rung but `none` has a routine', () => {
  const src = fs.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const i = src.indexOf('const ESCAPE_ROUTINES = {')
  assert.ok(i > 0, 'POSITIVE CONTROL: the routines table must exist')
  const table = src.slice(i, src.indexOf('\n}', i))
  for (const rung of ESCAPES) {
    if (rung === 'none') continue
    assert.match(table, new RegExp(`\\b${rung}\\s*:`),
      `${rung} is declared in ESCAPES and has no routine — it will hit the fallback`)
  }
})

test('...and the chosen rung is looked up, never hard-coded per branch', () => {
  // An if/else chain is how three-of-seven happened. A table lookup cannot
  // silently omit a member, because the assertion below it compares key sets.
  const src = fs.readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
  assert.match(src, /ESCAPE_ROUTINES\[plan\]/,
    'the dispatch must look the rung up in the table')
  const branches = (src.match(/plan === '(?!step_off)/g) ?? [])
  assert.equal(branches.length, 0,
    `${branches.length} per-rung if-branches remain; the chain is how rungs got missed`)
})

test('the exhaustiveness check FAILS when a rung is unwired', async () => {
  // An assertion never seen to fail is not an assertion. Mutate the table to
  // drop a rung and prove the module refuses to load.
  const url = new URL('../src/reflex.mjs', import.meta.url)
  const src = fs.readFileSync(url, 'utf8')
  const anchor = '  surface_swim: bot => surfaceSwim(bot),'
  assert.ok(src.includes(anchor), 'MUTANT ANCHOR MISSING: never written reads as killed')
  assert.strictEqual(src.split(anchor).length, 2, 'MUTANT ANCHOR NOT UNIQUE')

  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`,
                      import.meta.url)
  fs.writeFileSync(out, src.replace(anchor, '').replace(/from '\.\//g, "from '../src/"))
  let threw = null
  try { await import(out.href) } catch (e) { threw = e }
  finally { try { fs.unlinkSync(out) } catch {} }

  assert.ok(threw, 'dropping a rung from the table must fail at module load')
  assert.match(threw.message, /not exhaustive|surface_swim/,
    `the failure must NAME the missing rung; got: ${threw.message.slice(0, 120)}`)
})
