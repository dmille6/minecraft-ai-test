// townfloor-01: the cavern under the platform -- a heavy replay of townfloor.test.mjs's kind, in its own file (the runner's 120 s limit per file).
import assert from 'node:assert/strict'
const { F, HALF, HOME, L, OPEN, blk, carve, closedPockets, homeWalkers, isOpen, isSolid, oracle, replay, stands, town } = await import('./townfloor-fixtures.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 6).join('\n        ')}`)
  }
}

await t('A CAVERN UNDER THE PLATFORM reached by a stair: filled from the far end (FAR FIRST), the platform square first, the stair last; every step replays', () => {
  const c = carve({}, -3, 3, 58, 61, -3, 3)                                   // the hollow under the platform (4 high)
  // a stair from the grass at x 10 down to the cavern floor: feet 61, 60, 59, 58 at x 9, 8, 7, 6..4 (2-high head room)
  for (const [x, f] of [[9, 62], [8, 61], [7, 60], [6, 59], [5, 58], [4, 58]]) carve(c, x, x, f, Math.min(62, f + 2), 0, 0)
  const w = town(c)
  const before = F.floorCells(w.read, HOME).targets.length
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 1000 })
  assert.ok(p.steps.length >= before - 12, `most of the ${before} cells filled: ${p.steps.length} (${p.why}) ${JSON.stringify(p.tally)}`)
  replay(w, p)
  const tiers = p.steps.map(s => s.tier)
  assert.equal(tiers.indexOf(1) === -1 || tiers.lastIndexOf(0) < tiers.indexOf(1), true, 'every tier-0 cell before the first tier-1 cell')
  // FAR FIRST: the first cell filled is at the cavern's far wall (x = -3), not at the stair's mouth
  assert.equal(p.steps[0].c[0], -3, `first ${p.steps[0].c}`)
})


console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
