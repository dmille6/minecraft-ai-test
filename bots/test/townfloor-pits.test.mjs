// townfloor-01: filling to exhaustion around town furniture -- a heavy replay of townfloor.test.mjs's kind, in its own file (the runner's 120 s limit per file).
import assert from 'node:assert/strict'
const { F, HALF, HOME, L, OPEN, blk, carve, closedPockets, homeWalkers, isOpen, isSolid, oracle, replay, stands, town } = await import('./townfloor-fixtures.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 6).join('\n        ')}`)
  }
}

await t('FILLED TO EXHAUSTION AROUND TOWN FURNITURE: a chest and a sapling at the bottom of stair pits -- their cells and lids stay open, and the stand beside the chest still walks to the town (Claude r1 regression)', () => {
  const c = {}
  carve(c, 8, 12, 58, 62, 8, 12); for (const [x, f] of [[13, 59], [14, 60], [15, 61], [16, 62]]) carve(c, x, x, f, 62, 10, 10)   // a 5-deep pit, a stair east
  c['10,58,10'] = 'chest'
  carve(c, -12, -8, 59, 62, 8, 12); for (const [x, f] of [[-13, 60], [-14, 61], [-15, 62]]) carve(c, x, x, f, 62, 10, 10)    // a 4-deep pit, a stair west
  c['-10,59,10'] = 'oak_sapling'; c['-10,58,10'] = 'dirt'
  const w = town(c)
  const chestWay = r => [[9, 58, 10], [11, 58, 10], [10, 58, 9], [10, 58, 11]].some(([x, y, z]) => F.walkBack(r, F.townAnchor(r, HOME), { box: F.walkBox(HOME) }).has(F.cellKey(x, y, z)))
  assert.ok(chestWay(w.read), 'positive control: before the fill a bot walks to the chest and back')
  const p = F.planFloor({ read: w.read, home: HOME, maxSteps: 5000 })
  replay(w, p)
  const at = new Set(p.steps.map(s => s.c.join(',')))
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) assert.ok(!at.has(`${10 + dx},${58 + dy},${10 + dz}`), 'nothing beside the chest')
  for (let y = 60; y <= 62; y++) assert.ok(!at.has(`-10,${y},10`), 'the sapling column stays open')
  assert.ok(chestWay(w.read), 'after it, too')
  assert.ok(p.steps.length >= 40, `positive control: the pits were mostly filled (${p.steps.length})`)
})


console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
