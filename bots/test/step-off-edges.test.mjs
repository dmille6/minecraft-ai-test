// THE BOT WALKED OFF A 59-BLOCK DROP BECAUSE +X WAS FIRST IN THE ARRAY.
//
// Measured 2026-09-06: `step_off` preceded 6 of 14 fall deaths, and 21% of its
// firings carried an UNMEASURED drop. Traced end to end in one case, one second
// apart:
//     plan=step_off  drop=unmeasured
//     _death  fell from a high place after falling 59 blocks
//
// The rung itself is a deliberate design choice — respawn is a game mechanic and
// world edits are forbidden — so this is an ORDERING and never a veto. Gating
// the bottom rung on a measured drop would break totality, and this repo already
// paid for that shape: `stairUpWetness` as a veto kept 32 bots frozen for days,
// as an ordering it cost nothing.
import assert from 'node:assert'
import test from 'node:test'
import { stepOffEdges } from '../src/reflex.mjs'

// A synthetic world: `world[`${x},${y},${z}`] = true` means solid.
function makeWorld (solidCells) {
  const set = new Set(solidCells.map(c => c.join(',')))
  const at = (x, y, z) => ({ x, y, z, key: `${x},${y},${z}` })
  const solid = b => !!b && set.has(b.key)
  return { at, solid }
}
// Build a column of solid blocks under one cardinal, starting `drop+1` below.
function edgeWithDrop (dx, dz, drop) {
  return [[dx, -(drop + 1), dz]]
}

test('POSITIVE CONTROL: it finds edges, and finds none when walled in', () => {
  const open = makeWorld([])
  assert.equal(stepOffEdges(open).length, 4, 'air on all sides is four edges')
  const walled = makeWorld([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]])
  assert.equal(stepOffEdges(walled).length, 0, 'walls on all four cardinals')
})

test('THE FATAL CASE: the shallow edge wins even when it is last in the array', () => {
  // +x is checked first and drops 59. -z is checked last and drops 2.
  const w = makeWorld([...edgeWithDrop(1, 0, 40), ...edgeWithDrop(0, -1, 2)])
  const ranked = stepOffEdges(w)
  assert.deepEqual([ranked[0].dx, ranked[0].dz], [0, -1], 'the 2-block edge must be chosen')
  assert.equal(ranked[0].drop, 2)
  // ...and the deep one is still available, just later. Never excluded.
  assert.ok(ranked.some(e => e.drop === 40), 'the deep edge stays eligible')
})

test('THE HONEST LIMIT: past the probe every edge reads unmeasured', () => {
  // The bot that died walked off 59 blocks. That is past the 48-block probe, so
  // it sorts equal with every other unmeasured edge and the ranking gives NO
  // protection in that case. Recording it as `unmeasured` rather than as a
  // number is the only honest thing the rung can do, and it is what the
  // telemetry showed: `plan=step_off ... drop=unmeasured`.
  const w = makeWorld([...edgeWithDrop(1, 0, 59), ...edgeWithDrop(0, -1, 70)])
  const ranked = stepOffEdges(w)
  assert.ok(ranked.every(e => e.drop === null),
    'both edges are past the probe and must not pretend to a depth')
  assert.equal(ranked.length, 4, 'and all of them stay eligible — this is the bottom rung')
})

test('an UNMEASURED drop sorts last but is never excluded', () => {
  // Nothing within the probe = a void, or an unloaded chunk. The bot whose only
  // exit is one it cannot price still needs an exit.
  const w = makeWorld([...edgeWithDrop(1, 0, 12)])   // +x measurable, others void
  const ranked = stepOffEdges(w)
  assert.equal(ranked.length, 4, 'all four edges remain eligible')
  assert.equal(ranked[0].drop, 12, 'the measured edge goes first')
  assert.ok(ranked.slice(1).every(e => e.drop === null), 'unmeasured ones follow')
})

test('...and when EVERY edge is unmeasured, it still returns one', () => {
  // This is the totality case. Returning nothing here would make the bottom rung
  // unavailable and leave the lattice with an empty admissible set.
  const ranked = stepOffEdges(makeWorld([]))
  assert.equal(ranked.length, 4)
  assert.ok(ranked.every(e => e.drop === null))
})

test('a step ACROSS is not a fall, and a wall is not an edge', () => {
  // Solid at foot level = wall. Solid one below = you would just walk onto it.
  const w = makeWorld([[1, 0, 0], [-1, -1, 0]])
  const ranked = stepOffEdges(w)
  const dirs = ranked.map(e => `${e.dx},${e.dz}`)
  assert.ok(!dirs.includes('1,0'), 'the wall is excluded')
  assert.ok(!dirs.includes('-1,0'), 'the step-across is excluded')
  assert.equal(ranked.length, 2, 'the other two cardinals remain')
})

test('ties keep cardinal order, so the choice is deterministic', () => {
  const w = makeWorld([...edgeWithDrop(1, 0, 5), ...edgeWithDrop(-1, 0, 5),
                       ...edgeWithDrop(0, 1, 5), ...edgeWithDrop(0, -1, 5)])
  const a = stepOffEdges(w).map(e => `${e.dx},${e.dz}`)
  const b = stepOffEdges(w).map(e => `${e.dx},${e.dz}`)
  assert.deepEqual(a, b, 'same world, same answer')
  assert.deepEqual(a[0], '1,0', 'equal drops fall back to cardinal order')
})

test('a free drop is preferred over a survivable one over a lethal one', () => {
  // Property: the chosen edge is always the minimum measured drop present.
  for (const drops of [[3, 9, 40], [40, 3, 9], [9, 40, 3], [17, 2, 60]]) {
    const cells = [...edgeWithDrop(1, 0, drops[0]), ...edgeWithDrop(-1, 0, drops[1]),
                   ...edgeWithDrop(0, 1, drops[2])]
    const ranked = stepOffEdges(makeWorld(cells))
    assert.equal(ranked[0].drop, Math.min(...drops), `drops ${drops}`)
  }
})

test('bad inputs return no edges rather than throwing on the packet path', () => {
  assert.deepEqual(stepOffEdges({}), [])
  assert.deepEqual(stepOffEdges(), [])
  assert.deepEqual(stepOffEdges({ at: 1, solid: 2 }), [])
})
