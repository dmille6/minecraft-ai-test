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
