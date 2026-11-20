// WELLFIX-01SHOW (wellstand.mjs): the junk well's thrower is centred for the AIM's window, not for centredOn's 0.3.
//
// Behaviour on the REAL mineflayer-pathfinder 2.4.5 plugin (its A*, its executor, its fullStop) driving a body under the REAL
// prismarine-physics 1.11.1 (scripts/wellstand-replay.mjs), over the showcase's own cells round the well 12,73,7: a box of the
// 11-18 region copy (ci2 ~/world18full, test/fixtures/wellstand-showcase-1118.json) plus the crafting table Bravo placed at
// 13,74,6 on 11-19 12:13:04Z (`_place_town`). LIVE after it: every dispose_well refused at "1.20 from the well's centre".
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { worldOf, fakeBot, walkTo, boxReader } from '../scripts/wellstand-replay.mjs'
import * as W from '../src/well.mjs'
import { standCentreFor, nudgeToCentre, AIM_CENTRE_TOL } from '../src/wellstand.mjs'

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 4).join('\n        ')}`) } }

const CAP = { x: 12, y: 73, z: 7 }, STAND = { x: 12, y: 74, z: 6 }
const FIX = JSON.parse(readFileSync(new URL('./fixtures/wellstand-showcase-1118.json', import.meta.url), 'utf8'))
const read = boxReader(FIX)
const TABLE_E = { '13,74,6': 'crafting_table' }                                  // 11-19 12:13:04Z, Bravo
const TABLE_EW = { '13,74,6': 'crafting_table', '11,74,6': 'crafting_table' }   // + 11-20 00:54:50Z, Gale
const START = { x: 20.5, y: 68, z: 10.5 }   // town ground east of the well (the fixture's own surface)
const centredOld = q => Math.abs(q.x - (STAND.x + 0.5)) <= 0.3 && Math.abs(q.z - (STAND.z + 0.5)) <= 0.3   // skills.mjs centredOn
const aimOf = q => W.wellAim({ from: q, cap: CAP, facing: 'north', rise: q.y - (CAP.y + 1) })
const arrive = async (overlay) => {
  const bot = fakeBot(worldOf(read, overlay), START, { cap: CAP })
  const r = await walkTo(bot, STAND)
  assert.ok(r.ok, `the walk reached the stand: ${r.err}`)
  return { bot, q: r.pos }
}
const physicsTick = bot => async () => { bot.tick(); await new Promise(r => setImmediate(r)) }

console.log('THE AIM\'S WINDOW (pure)')
await t('standCentreFor: the live rest 12.44,6.305 is out of the window (1.20); the old arrival 12.637,6.498 and the centre are in', () => {
  const live = standCentreFor({ from: { x: 12.44, z: 6.305 }, cap: CAP, stand: STAND })
  assert.equal(live.ok, false); assert.match(live.why, /^1\.20 from the well's centre/); assert.deepEqual(live.target, { x: 12.5, z: 6.5 })
  assert.equal(standCentreFor({ from: { x: 12.637, z: 6.498 }, cap: CAP, stand: STAND }).ok, true)
  assert.equal(standCentreFor({ from: { x: 12.5, z: 6.5 }, cap: CAP, stand: STAND }).ok, true)
  assert.equal(standCentreFor({ from: { x: 12.5, z: 6.5 - 0.29 }, cap: CAP, stand: STAND }).ok, false, 'centredOn calls this centred')
  assert.equal(standCentreFor({ from: { x: 12.5, z: 6.5 + 0.25 }, cap: CAP, stand: STAND }).ok, false, 'too near: over the opening')
})
await t('the stop box sits inside the window on its own axis (0.88..1.12 of 0.8..1.15)', () => {
  assert.ok(1 - AIM_CENTRE_TOL >= W.MIN_TOSS_DIST && Math.hypot(AIM_CENTRE_TOL, 1 + AIM_CENTRE_TOL) <= W.MAX_TOSS_DIST)
})

console.log('THE REPLAY (real pathfinder + physics on the showcase cells)')
await t('POSITIVE CONTROL: the 11-18 cells, no table -> the body rests at 12.637,6.498 (live 11-19 before 12:13Z: 12.6,6.5), 1.01, the aim takes it', async () => {
  const { q } = await arrive({})
  assert.ok(Math.abs(q.x - 12.637) < 0.01 && Math.abs(q.z - 6.498) < 0.01, `${q.x},${q.z}`)
  assert.equal(aimOf(q).ok, true)
})
await t('THE LIVE FAULT: + the table at 13,74,6 -> rests at 12.440,6.305 (live: 12.4,74,6.3), centredOn says centred, the aim refuses 1.20', async () => {
  const { q } = await arrive(TABLE_E)
  assert.ok(Math.abs(q.x - 12.44) < 0.01 && Math.abs(q.z - 6.305) < 0.01, `${q.x},${q.z}`)
  assert.equal(centredOld(q), true, 'the old test never nudges it')
  const a = aimOf(q); assert.equal(a.ok, false); assert.match(a.why, /^1\.20 from the well's centre \(must be 0\.8-1\.15\)/)
})
for (const [label, ov] of [['the table at 13,74,6', TABLE_E], ['both tables (11-20 00:54Z on)', TABLE_EW]]) {
  await t(`THE FIX (${label}): the nudge, under the same physics, brings the body into the window on the stand cell; the aim's predicted rate >= 0.9`, async () => {
    const { bot, q } = await arrive(ov)
    const c = standCentreFor({ from: q, cap: CAP, stand: STAND }); assert.equal(c.ok, false)
    const n = await nudgeToCentre(bot, c.target, { tick: physicsTick(bot) })
    for (let k = 0; k < 10; k++) bot.tick()
    const p = bot.entity.position
    const a = aimOf(p)
    assert.equal(a.ok, true, `${p.x.toFixed(3)},${p.z.toFixed(3)} ${a.why}`); assert.ok(a.rate >= W.MIN_HIT_RATE)
    assert.deepEqual([Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)], [STAND.x, STAND.y, STAND.z], 'still on the stand cell')
    assert.ok(n.ticks > 0 && n.ticks < 20, `ticks ${n.ticks}`)
    assert.equal(bot.controlState.forward || bot.controlState.sneak, false, 'controls released')
  })
}

console.log('MUTANT (anchored)')
await t('MUTANT: the nudge stops at centredOn\'s 0.3 (AIM_CENTRE_TOL = 0.3) -> it never moves and the aim still refuses 1.20', async () => {
  const path = new URL('../src/wellstand.mjs', import.meta.url)
  const src = readFileSync(path, 'utf8'), old = 'export const AIM_CENTRE_TOL = 0.08\n'
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-wellstand-${process.pid}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, 'export const AIM_CENTRE_TOL = 0.3\n').replace(/from '\.\//g, "from '../src/"))
  try {
    const M = await import(out.href)
    const { bot, q } = await arrive(TABLE_E)
    const n = await M.nudgeToCentre(bot, M.standCentreFor({ from: q, cap: CAP, stand: STAND }).target, { tick: physicsTick(bot) })
    assert.equal(n.ticks, 0)
    assert.match(aimOf(bot.entity.position).why ?? '', /^1\.20 from/)
  } finally { try { unlinkSync(out) } catch {} }
})

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
process.exit(fail ? 1 : 0)
