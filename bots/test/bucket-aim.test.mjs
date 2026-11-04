// BUCKETFIX-01: THE AIM IS A POINT bot.lookAt TAKES (bots/src/bucket.mjs aimPoint). Paper sandbox3 11-04
// (sandbox/enchant/obsidian-proof.cjs): mineflayer 4.37's lookAt calls point.minus(); the aims were plain objects, so every
// scoopLiquid and pourLiquid threw `point.minus is not a function` before a packet. Behaviour: a fake bot whose lookAt is
// mineflayer's contract (it calls point.minus) pours and scoops with a real Vec3 position; the mutant (no aimPoint) throws.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
const { Vec3 } = createRequire(import.meta.url)('vec3')
const B = await import('../src/bucket.mjs')

/** A fake bot: lookAt as mineflayer's (point.minus), a world map, an inventory; activateItem empties / fills by the held bucket. */
function fakeBot ({ water = false, held = 'water_bucket' } = {}) {
  const pos = new Vec3(10, 64, -3)
  const st = { water, held, looks: [] }
  const items = () => [{ name: st.held, count: 1, slot: 36 }]
  return {
    st, pos,
    entity: { position: new Vec3(10.5, 64, -1.5) },
    inventory: { items },
    get heldItem () { return { name: st.held } },
    equip: async () => {},
    lookAt: async (point) => { st.looks.push(point.minus(new Vec3(0, 0, 0))); },
    activateItem: () => { if (st.held === 'water_bucket') { st.water = true; st.held = 'bucket' } else if (st.held === 'bucket' && st.water) { st.water = false; st.held = 'water_bucket' } },
    blockAt: (p) => (p.x === 10 && p.y === 64 && p.z === -3 ? { name: st.water ? 'water' : 'air', metadata: 0, boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block' }),
    pathfinder: { setGoal: () => {} },
  }
}
const sleep = async () => {}

test('aimPoint: a Vec3 position gives a Vec3 aim at the same point; a plain position passes the plain aim', () => {
  const p = new Vec3(10, 64, -3)
  const a = B.aimPoint(p, { x: 10.5, y: 64.4, z: -2.5 })
  assert.ok(a instanceof Vec3)
  assert.deepEqual([a.x, a.y, a.z], [10.5, 64.4, -2.5])
  assert.deepEqual(B.aimPoint({ x: 1, y: 2, z: 3 }, { x: 1.5, y: 2.5, z: 3.5 }), { x: 1.5, y: 2.5, z: 3.5 })
})

test('pourLiquid then scoopLiquid against mineflayer\'s lookAt contract (point.minus): poured, then scooped back', async () => {
  const bot = fakeBot()
  const r = await B.pourLiquid(bot, bot.pos, { sleep })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(bot.st.water, true)
  const s = await B.scoopLiquid(bot, bot.pos, { sleep })
  assert.equal(s.ok, true, JSON.stringify(s))
  assert.equal(bot.st.held, 'water_bucket')
  assert.ok(bot.st.looks.length >= 2)
})

test('MUTANT (anchor present and unique): without aimPoint the pour throws point.minus -- the bug the Paper run saw', async () => {
  const path = new URL('../src/bucket.mjs', import.meta.url)
  const src = readFileSync(path, 'utf8')
  const old = 'await bot.lookAt(aimPoint(pos, aim), true)'
  assert.equal(src.split(old).length, 3, 'ANCHOR MISSING OR NOT TWICE (scoop and pour)')
  const out = new URL(`./_mutant-bucket-${process.pid}.mjs`, import.meta.url)
  writeFileSync(out, src.split(old).join('await bot.lookAt(aim, true)'))
  try {
    const M = await import(out.href)
    const r = await M.pourLiquid(fakeBot(), new Vec3(10, 64, -3), { sleep })
    assert.equal(r.ok, false)
    assert.match(String(r.why), /minus/)
  } finally { unlinkSync(out) }
})

test('THE BODY (Claude r1 BLOCKER): a pour into the feet cell or the HEAD cell is refused, whatever the fractional position', () => {
  const air = { name: 'air', boundingBox: 'empty' }
  const standingIn = { x: 10, y: 64, z: 5 }
  const at = (x, y, z) => ({ ...air, position: new Vec3(x, y, z) })
  assert.match(B.emptyRefusal({ hasWaterBucket: true, target: at(10.3, 64, 5.7), distance: 1, standingIn }), /standing in/)
  assert.match(B.emptyRefusal({ hasWaterBucket: true, target: at(10.3, 65, 5.7), distance: 1, standingIn }), /head cell/)
  assert.equal(B.emptyRefusal({ hasWaterBucket: true, target: at(11, 64, 5), distance: 1, standingIn }), null, 'positive control: the cell beside is a pour')
  assert.equal(B.emptyRefusal({ hasWaterBucket: true, target: at(10, 63, 5), distance: 1, standingIn }), null, 'the cell under the feet (a hole) is a pour')
})

test('bucketSkill builds its cells from the FLOORED feet (structural: the fractional position was the dead guard)', () => {
  const src = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const fn = /\nasync function bucketSkill \([\s\S]*?\n\}\n/.exec(src)?.[0] ?? ''
  const line = "const p = typeof p0.floored === 'function' ? p0.floored() : p0"
  assert.equal(fn.split(line).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.ok(!/bot\.entity\?\.position\b[^\n]*\n[^\n]*p\.offset/.test(fn.replace(line, '')))
  // mutant: without the floor the pour target is fractional -> the body guard (compared as cells) still refuses: the guard itself
  // now floors (both halves fixed); the floor keeps bucket.mjs's cell-centred aims inside the cell
  const a = B.emptyAims(new Vec3(10, 64, 5))
  assert.ok(a.every(q => q.x > 10 && q.x < 11 && q.z > 5 && q.z < 6))
})

test('MUTANTS (anchors present and unique): no head-cell rule -> a head pour passes; no floor in the body test -> a fractional feet pour passes', async () => {
  const path = new URL('../src/bucket.mjs', import.meta.url)
  const src = readFileSync(path, 'utf8')
  const air = { name: 'air', boundingBox: 'empty' }
  const standingIn = { x: 10, y: 64, z: 5 }
  const cases = [
    ["    if (standingIn.y + 1 === t.y) return 'that is my head cell'\n", '', new Vec3(10.3, 65, 5.7)],
    ['{ x: Math.floor(tp.x), y: Math.floor(tp.y), z: Math.floor(tp.z) }', '{ x: tp.x, y: tp.y, z: tp.z }', new Vec3(10.3, 64, 5.7)],
  ]
  for (const [old, neu, pos] of cases) {
    assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
    const out = new URL(`./_mutant-bucket2-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
    writeFileSync(out, src.replace(old, neu))
    try {
      const M = await import(out.href)
      assert.equal(M.emptyRefusal({ hasWaterBucket: true, target: { ...air, position: pos }, distance: 1, standingIn }), null, 'the mutant lets the body pour through')
    } finally { unlinkSync(out) }
  }
})
