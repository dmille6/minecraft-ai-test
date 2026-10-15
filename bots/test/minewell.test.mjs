// MINE KEEPS OUT OF THE JUNK WELL'S SHELL (minewell-01).
//
// The fleet case, 10-14 hive-d (base build): a bot disposed 189 items from its town well's stand, ran `mine` from that
// stand, and the staircase dug the well's wall (g and g-1) and then its floor; the bot collected the shaft's items as it
// stood in the dug wall cell. This file replays that geometry in a micro-world: a well whose cap is at y=63, the bot on
// its south stand, and `mine` asked to go deep.
//
// Behaviour, through the real skill and the exported pure functions:
//   - the shell box is the pathfinder's box (wellBreakCost), for a dug well and a raised plinth alike;
//   - from the stand no stair is clear -> the bot WALKS to the nearest cell with a clear stair and mines from there; no
//     dig ever lands in the shell (the refusal -> relocate -> retry CHAIN, through the real skill);
//   - nowhere clear within the radius -> a refusal naming the well and the walk; after that walk, mine succeeds;
//   - a bot inside the well never starts a descent there;
//   - every dig of the descent is checked again (a well appearing mid-descent stops the stair at its shell).
// Mutants (anchors asserted present and unique) turn each of these red.
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { V, AIR, STONE } from './helpers/microworld.mjs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-minewell-${process.pid}`
process.env.BOT_NAME = 'TestBot'
// HOME 13 blocks east of the well (hive-d's stand was 14.9 from home): the walk-off must never end inside the 12-block home guard
process.env.HOME_X = '213'; process.env.HOME_Y = '64'; process.env.HOME_Z = '201'
const here = path.dirname(fileURLToPath(import.meta.url))
const SKP = path.join(here, '../src/skills.mjs'), MWP = path.join(here, '../src/minewell.mjs')
const { SKILLS } = await import('../src/skills.mjs')
const MW = await import('../src/minewell.mjs')
const { wellBreakCost } = await import('../src/well.mjs')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 3).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) { return withMutants(file, [[old, neu]], fn) }
async function withMutants (file, pairs, fn) {
  let src = fs.readFileSync(file, 'utf8')
  for (const [old, neu] of pairs) {
    assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
    assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
    src = src.replace(old, neu)
  }
  const out = path.join(here, `.mutant-minewell-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src.replace(/from '\.\//g, `from '${path.join(here, '../src')}/`))
  try { return await fn(await import(pathToFileURL(out))) } finally { try { fs.unlinkSync(out) } catch {} }
}

// ---- the world: stone below y=64, a well at cap 200,63,200 (shaft 62, floor 61), the bot on its south stand -------------
const CAP = { x: 200, y: 63, z: 200 }
const key = (x, y, z) => `${x},${y},${z}`
const inBox = (p, c = CAP) => Math.abs(p.x - c.x) <= 2 && Math.abs(p.z - c.z) <= 2 && p.y >= c.y - 3 && p.y <= c.y
function wellWorld ({ at = new V(200.5, 64, 201.5), yaw = Math.PI, cols = () => [CAP], solidAbove = new Set(), canMove = () => true, sand = new Set() } = {}) {
  const carved = new Set([key(CAP.x, CAP.y - 1, CAP.z)])   // the shaft is open under the cap
  const digs = [], gotos = []
  const raw = p => {
    if (carved.has(key(p.x, p.y, p.z))) return AIR
    if (sand.has(key(p.x, p.y, p.z))) return { name: 'sand', boundingBox: 'block' }
    if (solidAbove.has(key(p.x, p.y, p.z))) return STONE
    if (p.x === CAP.x && p.z === CAP.z && p.y === CAP.y) return { name: 'oak_trapdoor', boundingBox: 'block' }
    return p.y < 64 ? STONE : AIR
  }
  const bot = {
    entity: { position: at, yaw }, health: 20, food: 20, oxygenLevel: 300, heldItem: { type: 1 },
    blockAt: p => ({ ...raw(p), position: new V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 100, harvestTools: undefined, material: 'rock' }),
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'cobblestone', count: 512 }] },
    equip: async () => {},
    dig: async b => { digs.push({ x: b.position.x, y: b.position.y, z: b.position.z }); carved.add(key(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      goto: async goal => {
        gotos.push({ x: goal.x, y: goal.y, z: goal.z })
        if (!canMove(goal)) return
        const c = new V(goal.x, goal.y, goal.z)
        if (raw(c).boundingBox !== 'empty' || raw(c.offset(0, 1, 0)).boundingBox !== 'empty') return
        bot.entity.position = new V(c.x + 0.5, c.y, c.z + 0.5)
        bot.entity.yaw += 0.9
      },
      setGoal: () => {}, stop: () => {},
    },
    setControlState: () => {}, clearControlStates: () => {},
    registry: { blocksByName: {}, itemsByName: {} }, players: {},
    wellCellsNow: cols, _digs: digs, _gotos: gotos, _carved: carved,
  }
  return bot
}
const run = (mod, bot, y = 50) => mod.SKILLS.mine.run({ bot }, { y }, new AbortController().signal)
const rows = kind => { try { return fs.readFileSync(`${process.env.LOG_DIR}/skill-TestBot.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] } }

// ======================================================================================================================
await t('THE SHELL is the pathfinder\'s box (wellBreakCost): +-2 around the column, cap.y - 3 .. cap; a plinth\'s too', () => {
  const cols = [CAP]
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let y = 58; y <= 65; y++) {
    const p = { x: CAP.x + dx, y, z: CAP.z + dz }
    assert.equal(!!MW.shellOf(cols, p), wellBreakCost(cols, { position: p }) > 0, JSON.stringify(p))
    assert.equal(!!MW.shellOf(cols, p), inBox(p), JSON.stringify(p))
  }
  // a raised plinth (plinth-01): cap at s+3, a 5x5x3 plinth on the surface s -- every plinth cell and the filled surface
  const s = 70, pcap = { x: 0, y: s + 3, z: 0 }
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = s; y <= s + 3; y++) assert.ok(MW.shellOf([pcap], { x: dx, y, z: dz }), `plinth cell ${dx},${y},${dz}`)
  // the shell IS wellBreakCost, column by column (Claude r3 P2): whatever that box covers for a column (plinth-01 adds the
  // access stair to it), shellOf covers -- checked here on a column carrying extra fields
  const pcol = { ...pcap, stair: [{ x: 3, y: s + 1, z: 0 }] }
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let y = s - 1; y <= s + 4; y++) {
    const p = { x: dx, y, z: dz }
    assert.equal(!!MW.shellOf([pcol], p), wellBreakCost([pcol], { position: p }) > 0, JSON.stringify(p))
  }
  assert.equal(MW.shellOf([], { x: 0, y: 0, z: 0 }), null)
})
await t('THE STAIR SIMULATED: from the hive-d stand every bearing digs the shell; 3 south of the box, south is clear and north is not', () => {
  const B = { s: { x: 0, z: 1 }, n: { x: 0, z: -1 }, e: { x: 1, z: 0 }, w: { x: -1, z: 0 } }
  const stand = { x: 200, y: 64, z: 201 }
  for (const b of Object.values(B)) assert.equal(MW.stairClear([CAP], stand, b).clear, false, JSON.stringify(b))
  const south = MW.stairClear([CAP], stand, B.s)
  assert.ok(inBox(south.hit.cell), 'the hit is a shell cell'); assert.deepEqual(south.hit.cap, CAP)
  const far = { x: 200, y: 64, z: 203 }
  assert.equal(MW.stairClear([CAP], far, B.s).clear, true)
  assert.equal(MW.stairClear([CAP], far, B.n).clear, false, 'a stair heading back at the well')
  assert.equal(MW.stairClear([], stand, B.n).clear, true, 'no well known: nothing to keep out of')
  // the simulation stops once the stair is below the deepest shell: a deep start under the well is clear
  assert.equal(MW.stairClear([CAP], { x: 200, y: 55, z: 200 }, B.s).clear, true)
})
await t('THE PLAN: from the stand -> relocate to the nearest standable cell with a clear stair; far away -> go; inside the well -> refuse; walled in -> refuse naming the well', () => {
  const bearings = [{ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }, { x: 1, z: 0 }]
  const open = c => c.y === 64   // the micro-world's surface (the pure plan: home is the caller's standable())
  const p = MW.planMineStart({ cols: [CAP], p0: { x: 200, y: 64, z: 201 }, bearings, standable: open })
  assert.equal(p.action, 'relocate'); assert.ok(p.bearings.length >= 1)
  assert.ok(p.bearings.every(b => MW.stairClear([CAP], p.to, b).clear), 'every offered bearing is clear from the new cell')
  assert.ok(Math.hypot(p.to.x - 200, p.to.z - 201) <= 2, `the nearest such cell, not a long walk: ${JSON.stringify(p.to)}`)
  const g = MW.planMineStart({ cols: [CAP], p0: { x: 230, y: 64, z: 230 }, bearings, standable: open })
  assert.equal(g.action, 'go'); assert.equal(g.bearings.length, 4)
  const inside = MW.planMineStart({ cols: [CAP], p0: { x: 200, y: 62, z: 200 }, feet: { x: 200.5, y: 62.19, z: 200.5 }, bearings, standable: open })
  assert.equal(inside.action, 'refuse'); assert.match(inside.why, /inside the junk well/)
  const walled = MW.planMineStart({ cols: [CAP], p0: { x: 200, y: 64, z: 201 }, bearings, standable: () => false })
  assert.equal(walled.action, 'refuse'); assert.match(walled.why, /would dig the junk well's shell at 200,63,200/); assert.deepEqual(walled.cap, CAP)
  assert.equal(MW.planMineStart({ cols: [], p0: { x: 200, y: 64, z: 201 }, bearings, standable: open }).action, 'go')
})

await t('THE CHAIN, hive-d replayed through the real skill: from the stand mine walks off, plans again, descends -- no dig in the shell, a relocate row, success', async () => {
  const mod = { SKILLS }
  const bot = wellWorld()
  const n0 = rows('_mine_well_guard').length
  const r = await run(mod, bot)
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`)
  assert.ok(bot._digs.length > 10, 'positive control: it dug a stair')
  assert.deepEqual(bot._digs.filter(d => inBox(d)), [], 'dug the shell')
  assert.ok(bot._gotos.length >= 1, 'it walked off first')
  const g = rows('_mine_well_guard').slice(n0)
  assert.ok(g.some(x => /^action=relocate at=200,63,200 from=200,64,201 to=/.test(x.skill.detail)), JSON.stringify(g.map(x => x.skill.detail)))
})
await t('THE CHAIN, walled in within 8: mine looks again within 16 and WALKS there itself, then descends clear (no advice needed)', async () => {
  const solid = new Set()
  for (let dx = -10; dx <= 10; dx++) for (let dz = -10; dz <= 10; dz++) for (const y of [63, 64, 65, 66]) if (!(dx === 0 && dz === 1 && y >= 64)) solid.add(key(200 + dx, y, 200 + dz))
  const bot = wellWorld({ solidAbove: solid })
  const n0 = rows('_mine_well_guard').length
  const r = await run({ SKILLS }, bot)
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`)
  assert.deepEqual(bot._digs.filter(d => inBox(d)), [], 'dug the shell')
  const g = rows('_mine_well_guard').slice(n0).map(x => x.skill.detail)
  assert.ok(g.some(d => /^action=relocate .* to=.* try=1$/.test(d)), JSON.stringify(g))
  const to = bot._gotos[0]
  assert.ok(Math.max(Math.abs(to.x - 200), Math.abs(to.z - 200)) >= 11, `the walk went past the walls: ${JSON.stringify(to)}`)
})
await t('THE CHAIN, the walk-off unreachable: two different targets tried (never the same twice), then a refusal naming explore; the REAL explore skill performed, mine descends clear', async () => {
  // the walk-off cells near the well cannot be reached (GoalBlock), the open country can (explore's GoalNear legs)
  const bot = wellWorld({ canMove: g => g.rangeSq !== undefined || Math.max(Math.abs(g.x - 200), Math.abs(g.z - 200)) > 16 })
  const r = await run({ SKILLS }, bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'forbidden')
  assert.match(r.detail, /could not be reached from here; explore away from the well/, r.detail)
  assert.equal(bot._gotos.length, 2, 'two walk-off attempts'); assert.notDeepEqual(bot._gotos[0], bot._gotos[1], 'the same unreachable cell walked at twice')
  assert.equal(bot._digs.length, 0, 'nothing dug before the refusal')
  // the remedy the refusal names, performed by the real skill: explore away from the well (heading +z, 40 blocks)
  const e = await SKILLS.explore.run({ bot }, { blocks: 40, heading: 90 }, new AbortController().signal)
  const p = bot.entity.position
  assert.ok(Math.max(Math.abs(Math.floor(p.x) - 200), Math.abs(Math.floor(p.z) - 200)) >= 11, `explore moved the bot only to ${p.x},${p.z} (${e.status}: ${e.detail})`)
  const r2 = await run({ SKILLS }, bot)
  assert.equal(r2.status, 'success', `${r2.status}: ${r2.detail}`)
  assert.deepEqual(bot._digs.filter(d => inBox(d)), [])
})
// the well becomes known between the old read point and the dig: during the tool selection for the head cell
const recogniseAtHead = (bot, set) => {
  const at0 = bot.blockAt
  bot.blockAt = p => { const b = at0(p); return p.x === 200 && p.y === 63 && p.z === 198 ? { ...b, canHarvest: () => { set(); return true } } : b }
}
await t('READ AFTER THE EQUIP: a well recognised between the tool selection and the head dig stops that dig (the read is the last thing before bot.dig)', async () => {
  let known = []
  const bot = wellWorld({ at: new V(200.5, 64, 196.5), yaw: 0, cols: () => known, solidAbove: new Set([key(200, 64, 198)]) })
  recogniseAtHead(bot, () => { known = [CAP] })
  const r = await run({ SKILLS }, bot)
  assert.ok(bot._digs.some(d => d.x === 200 && d.y === 64 && d.z === 198), 'positive control: the ceiling was dug')
  assert.equal(r.status, 'failed', `${r.status}: ${r.detail}`)
  assert.deepEqual(bot._digs.filter(d => inBox(d)), [], 'the head cell was dug on a read taken before the equip')
})
await t('THE HOME GUARD COMPOSED: home 13 from the well -- the walk-off never ends within 12 of home, and the chain still descends', async () => {
  const bot = wellWorld()
  const r = await run({ SKILLS }, bot)
  assert.equal(r.status, 'success', `${r.status}: ${r.detail}`)
  for (const g of bot._gotos.slice(0, 1)) assert.ok(Math.hypot(g.x + 0.5 - 213, g.z + 0.5 - 201) > 12, `walked to ${JSON.stringify(g)}, inside the home guard`)
  assert.deepEqual(bot._digs.filter(d => inBox(d)), [])
})
await t('THE STAIR STOPS AT goalY: a stair that would reach the shell only below the requested depth is clear', () => {
  const p0 = { x: 200, y: 66, z: 196 }, south = { x: 0, z: 1 }
  assert.equal(MW.stairClear([CAP], p0, south).clear, false, 'positive control: all the way down it would hit the shell')
  assert.equal(MW.stairClear([CAP], p0, south, { goalY: 64 }).clear, true)
})
await t('INSIDE THE WELL: mine refuses before any dig (the exit is the stand, not a stair through the floor)', async () => {
  const bot = wellWorld({ at: new V(200.5, 62.19, 200.5) })
  const r = await run({ SKILLS }, bot)
  assert.equal(r.status, 'failed'); assert.match(r.detail, /inside the junk well .*goto -?\d+ -?\d+ -?\d+ \(the well's rim\)/); assert.equal(bot._digs.length, 0)
})
await t('EVERY DIG IS CHECKED: a well that appears mid-descent stops the stair at its shell (no shell cell dug)', async () => {
  // the stair starts far from any known well; after the first dig a well column becomes known two steps ahead
  let known = []
  const bot = wellWorld({ at: new V(200.5, 64, 192.5), yaw: 0, cols: () => known })
  const dig0 = bot.dig
  bot.dig = async b => { await dig0(b); if (bot._digs.length === 3) known = [CAP] }
  const r = await run({ SKILLS }, bot)
  assert.equal(r.status, 'failed', `${r.status}: ${r.detail}`); assert.match(r.detail, /junk well's shell/)
  assert.deepEqual(bot._digs.filter(d => inBox(d)), [], 'dug the shell')
  assert.ok(bot._digs.length >= 3, 'positive control: the stair had started')
})
await t('READ AFRESH AT EVERY DIG: a well found DURING the step\'s ceiling dig stops the head dig in its shell (no stale snapshot)', async () => {
  let known = []
  const bot = wellWorld({ at: new V(200.5, 64, 196.5), yaw: 0, cols: () => known, solidAbove: new Set([key(200, 64, 198)]) })
  const dig0 = bot.dig
  bot.dig = async b => { await dig0(b); if (b.position.x === 200 && b.position.y === 64 && b.position.z === 198) known = [CAP] }
  const r = await run({ SKILLS }, bot)
  assert.ok(bot._digs.some(d => d.x === 200 && d.y === 64 && d.z === 198), 'positive control: the ceiling (outside the box) was dug')
  assert.equal(r.status, 'failed', `${r.status}: ${r.detail}`); assert.match(r.detail, /junk well's shell/)
  assert.deepEqual(bot._digs.filter(d => inBox(d)), [], 'the head cell (in the shell) was dug on a stale read')
})
// step 1 of a stair heading south from 200,64,196 digs 200,{64,63,62},198: the head and tread are in the shell. The well
// becomes known right after that step's digs, and the cell is REFILLED (sand fell / a block was placed) -- only the
// re-open (falling column) or the tread re-dig could dig it now, and each must read the shell first.
const lateWell = ({ refill, sand = new Set() }) => {
  let known = [], knownAt = null
  const bot = wellWorld({ at: new V(200.5, 64, 196.5), yaw: 0, cols: () => known, sand })
  const dig0 = bot.dig
  bot.dig = async b => {
    await dig0(b)
    if (knownAt == null && b.position.x === 200 && b.position.y === 62 && b.position.z === 198) { bot._carved.delete(key(refill.x, refill.y, refill.z)); known = [CAP]; knownAt = bot._digs.length }
  }
  return { bot, after: () => (knownAt == null ? [] : bot._digs.slice(knownAt)) }
}
await t('THE RE-OPEN READS THE SHELL: a falling column refills the head cell after the well became known -- the re-open stops, never digs it', async () => {
  // a sand block over the step's ceiling cell makes the step a falling column (mine re-opens the three cells top-down)
  const { bot, after } = lateWell({ refill: { x: 200, y: 63, z: 198 }, sand: new Set([key(200, 65, 198)]) })
  const r = await run({ SKILLS }, bot)
  assert.equal(r.status, 'failed', `${r.status}: ${r.detail}`); assert.match(r.detail, /junk well's shell/)
  assert.deepEqual(after().filter(d => inBox(d)), [], 'the re-open dug a shell cell after the well was known')
})
await t('THE TREAD RE-DIG READS THE SHELL: the tread refilled after the well became known -- the re-dig stops, never digs it', async () => {
  const { bot, after } = lateWell({ refill: { x: 200, y: 62, z: 198 } })
  const r = await run({ SKILLS }, bot)
  assert.equal(r.status, 'failed', `${r.status}: ${r.detail}`); assert.match(r.detail, /junk well's shell/)
  assert.deepEqual(after().filter(d => inBox(d)), [], 'the re-dig dug a shell cell after the well was known')
})
await t('MUTANT (skills): the re-open without its shell read digs the refilled head cell', async () => {
  await withMutant(SKP, "          const stopRe = shellStop(pos)\n          if (stopRe) return stopRe\n", "", async m => {
    const { bot, after } = lateWell({ refill: { x: 200, y: 63, z: 198 }, sand: new Set([key(200, 65, 198)]) })
    await run(m, bot).catch(() => {})
    assert.ok(after().some(d => inBox(d)), 'mutant inert')
  })
})
await t('MUTANT (skills): the tread re-dig without its shell read digs the refilled tread', async () => {
  await withMutant(SKP, "      if (stopRedig) return stopRedig\n", "", async m => {
    const { bot, after } = lateWell({ refill: { x: 200, y: 62, z: 198 } })
    const r = await run(m, bot).catch(e => ({ status: 'threw', detail: String(e) }))
    assert.ok(after().some(d => inBox(d)), `mutant inert: ${r.status} ${r.detail} after=${JSON.stringify(after())} digs=${JSON.stringify(bot._digs)} gotos=${JSON.stringify(bot._gotos)}`)
  })
})
await t('POSITIVE CONTROL for the chain: with no well known, the same stand descends straight through where the shell would be', async () => {
  const bot = wellWorld({ cols: () => [] })
  const r = await run({ SKILLS }, bot)
  assert.equal(r.status, 'success')
  assert.ok(bot._digs.some(d => inBox(d)), 'the fixture can dig the shell: the guard is what keeps it out')
})

// ---- MUTANTS --------------------------------------------------------------------------------------------------------------
await t('MUTANT (skills): no plan AND no per-dig checks -- the stair from the stand digs the shell (the hive-d defect reproduced)', async () => {
  await withMutants(SKP, [["  let wellPlan = planHere()\n", "  let wellPlan = { action: 'go', bearings: stairBearings(bot) }\n"], ["    for (const cell of [cellAbove, cellHead, cellFeet]) {\n      const stop = shellStop(cell)\n      if (stop) return stop\n    }\n", ''], ["      // IMMEDIATELY BEFORE THE DIG, after the equip's await (Codex r2 P2): nothing awaits between this read and bot.dig\n      const stopNow = shellStop(pos)\n      if (stopNow) return stopNow\n", '']], async m => {
    const bot = wellWorld()
    await run(m, bot).catch(() => {})
    assert.ok(bot._digs.some(d => inBox(d)), 'mutant inert')
  })
})
await t('MUTANT (skills): no plan, per-dig check kept -- the stair stops at the shell instead of walking off (defence in depth, but no descent)', async () => {
  await withMutant(SKP, "  let wellPlan = planHere()\n", "  let wellPlan = { action: 'go', bearings: stairBearings(bot) }\n", async m => {
    const bot = wellWorld()
    const r = await run(m, bot)
    assert.notEqual(r.status, 'success', 'mutant inert: without the plan the chain still descended')
    assert.deepEqual(bot._digs.filter(d => inBox(d)), [], 'the per-dig check still keeps the shell')
  })
})
await t('MUTANT (minewell): every stair called clear', async () => {
  await withMutant(MWP, "      if (cap) return { clear: false, hit: { step: i, cell, cap } }", "      if (false) return { clear: false, hit: { step: i, cell, cap } }", async m => {
    assert.equal(m.stairClear([CAP], { x: 200, y: 64, z: 201 }, { x: 0, z: -1 }).clear, true, 'mutant inert')
  })
})
await t('MUTANT (minewell): the shell no longer asks wellBreakCost (nothing is shell)', async () => {
  await withMutant(MWP, "  return cols.find(c => wellBreakCost([c], { position: pos }) > 0) ?? null", "  return null", async m => {
    assert.equal(m.shellOf([CAP], { x: 202, y: 61, z: 200 }), null, 'mutant inert')
  })
})
await t('MUTANT (minewell): the inside-the-well refusal removed -- a bot in the shaft plans a stair', async () => {
  await withMutant(MWP, "  if (inside) {\n    // THE WAY OUT", "  if (false) {\n    // THE WAY OUT", async m => {
    const p = m.planMineStart({ cols: [CAP], p0: { x: 200, y: 62, z: 200 }, feet: { x: 200.5, y: 62.19, z: 200.5 }, bearings: [{ x: 0, z: 1 }], standable: c => c.y === 64 })
    assert.ok(!(p.action === 'refuse' && /inside the junk well/.test(p.why)), 'mutant inert')
  })
})
await t('MUTANT (skills): the per-dig checks removed -- a well appearing mid-descent gets its shell dug', async () => {
  await withMutants(SKP, [["    for (const cell of [cellAbove, cellHead, cellFeet]) {\n      const stop = shellStop(cell)\n      if (stop) return stop\n    }\n", ''], ["      // IMMEDIATELY BEFORE THE DIG, after the equip's await (Codex r2 P2): nothing awaits between this read and bot.dig\n      const stopNow = shellStop(pos)\n      if (stopNow) return stopNow\n", '']], async m => {
    let known = []
    const bot = wellWorld({ at: new V(200.5, 64, 192.5), yaw: 0, cols: () => known })
    const dig0 = bot.dig
    bot.dig = async b => { await dig0(b); if (bot._digs.length === 3) known = [CAP] }
    await run(m, bot).catch(() => {})
    assert.ok(bot._digs.some(d => inBox(d)), 'mutant inert')
  })
})
await t('MUTANT (skills): the per-dig check on a snapshot taken before the step -- the head dig lands in the shell', async () => {
  await withMutant(SKP, "    const shellStop = pos => {\n      const cap = shellOf(wellCols(), pos)", "    const snap = wellCols()\n    const shellStop = pos => {\n      const cap = shellOf(snap, pos)", async m => {
    let known = []
    const bot = wellWorld({ at: new V(200.5, 64, 196.5), yaw: 0, cols: () => known, solidAbove: new Set([key(200, 64, 198)]) })
    const dig0 = bot.dig
    bot.dig = async b => { await dig0(b); if (b.position.x === 200 && b.position.y === 64 && b.position.z === 198) known = [CAP] }
    await run(m, bot).catch(() => {})
    assert.ok(bot._digs.some(d => inBox(d)), 'mutant inert')
  })
})
await t('MUTANT (skills): no second, longer walk-off -- walled in within 8, mine refuses instead of walking past the walls', async () => {
  await withMutant(SKP, "    if (wellPlan.action === 'refuse') wellPlan = planHere(FAR_RADIUS)\n", "", async m => {
    const solid = new Set()
    for (let dx = -10; dx <= 10; dx++) for (let dz = -10; dz <= 10; dz++) for (const y of [63, 64, 65, 66]) if (!(dx === 0 && dz === 1 && y >= 64)) solid.add(key(200 + dx, y, 200 + dz))
    const r = await run(m, wellWorld({ solidAbove: solid }))
    assert.notEqual(r.status, 'success', 'mutant inert')
  })
})
await t('MUTANT (skills): the per-dig read moved back before the equip -- a well recognised during the equip gets its cell dug', async () => {
  const OLD = "      const tool = bestTool(bot, b)\n      if (tool) await bot.equip(tool, 'hand').catch(() => {})\n"
  const READ = "      // IMMEDIATELY BEFORE THE DIG, after the equip's await (Codex r2 P2): nothing awaits between this read and bot.dig\n      const stopNow = shellStop(pos)\n      if (stopNow) return stopNow\n"
  await withMutants(SKP, [[READ, ''], [OLD, "      // IMMEDIATELY BEFORE THE DIG, after the equip's await (Codex r2 P2): nothing awaits between this read and bot.dig\n      const stopNow = shellStop(pos)\n      if (stopNow) return stopNow\n" + OLD]], async m => {
    let known = []
    const bot = wellWorld({ at: new V(200.5, 64, 196.5), yaw: 0, cols: () => known, solidAbove: new Set([key(200, 64, 198)]) })
    recogniseAtHead(bot, () => { known = [CAP] })
    await run(m, bot).catch(() => {})
    assert.ok(bot._digs.some(d => inBox(d)), 'mutant inert')
  })
})
await t('MUTANT (skills): relocation without the walk -- the replan from the stand refuses, the chain never descends', async () => {
  await withMutant(SKP, "      await withTimeout(bot.pathfinder.goto(new goals.GoalBlock(to.x, to.y, to.z)), 20_000, bot, { what: 'walking off the junk well before mining' })\n", "", async m => {
    const bot = wellWorld()
    const r = await run(m, bot)
    assert.notEqual(r.status, 'success', 'mutant inert')
    assert.deepEqual(bot._digs.filter(d => inBox(d)), [], 'even then nothing in the shell is dug')
  })
})

console.log(`\n${pass} passed, ${fail} failed${failed.length ? `\n  ${failed.join('\n  ')}` : ''}`)
process.exit(fail ? 1 : 0)
