// villageunlock-01 (T3a): the pen finder on the REAL block states of the showcase's village-taiga-6_1 rings (a region copy,
// 11-03: test/fixtures/village-6_1-rings.json), the stuck tracker, the toggle order, and protectzone's one new allowance
// (activateBlock on a trapdoor / fence gate named by a running unlock), with the refusals around it unchanged.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-vu-logs-'))
process.env.BOT_NAME = 'UnlockBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-vu-pool-'))

const V = await import('../src/villageunlock.mjs')
const PZ = await import('../src/protectzone.mjs')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }
const RAW = JSON.parse(fs.readFileSync(new URL('./fixtures/village-6_1-rings.json', import.meta.url), 'utf8'))
const worldOf = (over = {}) => (x, y, z) => { const k = `${x},${y},${z}`; const r = over[k] ?? RAW[k]; return r ? { name: r[0], props: r[1] } : null }
const keys = p => p.toggles.map(q => `${q.x},${q.y},${q.z}`).sort()

await t('the outdoor ring (4 villagers at 80..83,73,-4): a pen of 3 walkable cells, its 7 open trapdoors collected to close, nothing else', () => {
  const w = worldOf()
  const p = V.penAround(w, { x: 80.3, y: 73, z: -3.7 })
  assert.equal(p.pen, true, JSON.stringify(p))
  assert.deepEqual(keys(p), ['79,73,-4', '80,73,-3', '80,73,-5', '81,73,-3', '81,73,-5', '82,73,-3', '82,73,-5'])
  assert.ok(p.toggles.every(q => q.name === 'spruce_trapdoor' && q.want === 'closed'))
  // every villager in the ring finds the same pen
  assert.deepEqual(keys(V.penAround(w, { x: 82.7, y: 73, z: -3.7 })), keys(p))
})

await t('the house ring (3 villagers at 87..88,76,11): a pen of 2 cells; ONLY the 2 trapdoors that open onto the house floor (z 10) are collected -- the 4 against the cobble walls and the top shutters are not', () => {
  const p = V.penAround(worldOf(), { x: 87.3, y: 76, z: 11.7 })
  assert.equal(p.pen, true)
  assert.deepEqual(keys(p), ['87,76,10', '88,76,10'])
  assert.equal(p.cells.length, 2)
})

await t('AFTER the toggles (the sandbox result: all closed) the same villager stands in no pen -- the unlock does not repeat', () => {
  const over = {}
  for (const q of V.penAround(worldOf(), { x: 87.3, y: 76, z: 11.7 }).toggles) over[`${q.x},${q.y},${q.z}`] = ['spruce_trapdoor', { ...RAW[`${q.x},${q.y},${q.z}`][1], open: 'false' }]
  const p = V.penAround(worldOf(over), { x: 87.3, y: 76, z: 11.7 })
  assert.equal(p.pen, false, JSON.stringify(p))
})

await t('not a pen: open ground, an unloaded neighbour, a pen walled by solid blocks only (never broken), a drop, a step up', () => {
  const flat = (x, y) => ({ name: y < 64 ? 'stone' : 'air', props: {} })
  assert.deepEqual(V.penAround(flat, { x: 0, y: 64, z: 0 }), { pen: false, why: 'open' })
  assert.equal(V.penAround(() => null, { x: 0, y: 64, z: 0 }).why, 'unloaded')
  const walled = (x, y, z) => ({ name: (y < 64 || Math.abs(x) + Math.abs(z) > 0) ? 'stone' : 'air', props: {} })
  assert.equal(V.penAround(walled, { x: 0, y: 64, z: 0 }).why, 'walled')
  const fenced = (x, y, z) => ({ name: y < 64 ? 'stone' : ((x === 0 || x === 2) && z === 0) || y > 64 ? 'air' : (x === 1 && z === 0) ? 'oak_fence_gate' : 'oak_fence', props: x === 1 ? { open: 'false' } : {} })
  const g = V.penAround(fenced, { x: 0.5, y: 64, z: 0.5 })
  assert.equal(g.pen, true); assert.deepEqual(g.toggles.map(q => [q.x, q.z, q.want]), [[1, 0, 'open']])
  const iron = (x, y, z) => ({ name: y < 64 ? 'stone' : (x === 0 && z === 0) ? 'air' : 'iron_trapdoor', props: { open: 'true', half: 'bottom' } })
  assert.equal(V.penAround(iron, { x: 0, y: 64, z: 0 }).why, 'walled', 'an iron trapdoor is not a toggle (redstone only)')
  const step = (x, y, z) => ({ name: y < 64 || (y === 64 && x === 1 && z === 0) ? 'stone' : 'air', props: {} })
  assert.equal(V.penAround(step, { x: 0, y: 64, z: 0 }, { maxCells: 100 }).why, 'exit_step')
})

await t('Codex r1 blocker 2: a top shutter, a trapdoor over a hole, one under a solid block, one opening onto a wall or a 2-block drop: NOT collected (walled)', () => {
  // a 1-cell pen at 0,64,0 on stone; the only barrier is an open trapdoor at 1,64,0; everything else stone walls
  const mk = (td, over = {}) => (x, y, z) => {
    const k = `${x},${y},${z}`
    if (k in over) return over[k]
    if (x === 1 && y === 64 && z === 0) return td
    if (y < 64) return { name: 'stone', props: {} }
    if (x === 0 && z === 0) return { name: 'air', props: {} }
    if (x >= 1 && z === 0) return { name: 'air', props: {} }   // a corridor east, beyond the barrier
    return { name: 'stone', props: {} }
  }
  const open = half => ({ name: 'spruce_trapdoor', props: { open: true, half, facing: 'east' } })
  assert.equal(V.penAround(mk(open('bottom')), { x: 0, y: 64, z: 0 }).pen, true, 'POSITIVE CONTROL: a bottom trapdoor onto a level corridor is collected')
  assert.equal(V.penAround(mk(open('top')), { x: 0, y: 64, z: 0 }).why, 'walled', 'a top-half shutter')
  assert.equal(V.penAround(mk(open('bottom'), { '1,63,0': { name: 'air', props: {} }, '1,62,0': { name: 'air', props: {} } }), { x: 0, y: 64, z: 0 }).why, 'walled', 'a hole cover')
  assert.equal(V.penAround(mk(open('bottom'), { '1,65,0': { name: 'stone', props: {} } }), { x: 0, y: 64, z: 0 }).why, 'walled', 'under a solid block')
  assert.equal(V.penAround(mk(open('bottom'), { '2,64,0': { name: 'stone', props: {} }, '2,65,0': { name: 'stone', props: {} } }), { x: 0, y: 64, z: 0 }).why, 'walled', 'onto a wall')
  assert.equal(V.penAround(mk(open('bottom'), { '2,63,0': { name: 'air', props: {} }, '2,62,0': { name: 'air', props: {} } }), { x: 0, y: 64, z: 0 }).why, 'walled', 'onto a 2-block drop')
  assert.equal(V.penAround(mk(open('bottom'), { '2,63,0': { name: 'air', props: {} } }), { x: 0, y: 64, z: 0 }).pen, true, 'one step down is a way out')
})

await t('Codex r1 blocker 3: one sighting then absence is no candidate; a gap > 10 min restarts the clock; the villager re-checked in the pen', () => {
  const still = new Map(), tried = new Map()
  const s = { kind: 'villager', uuid: 'a', x: 80.3, y: 73, z: -3.7, profession: 'none', baby: false }
  V.trackStill(still, [s], 0)
  assert.deepEqual(V.stuckCandidates(still, tried, 21 * 60_000, { x: 0, z: 0 }), [], 'seen once 21 min ago: not fresh')
  V.trackStill(still, [s], 15 * 60_000)   // a 15 min gap: the clock restarts at 15
  V.trackStill(still, [s], 21 * 60_000)
  assert.deepEqual(V.stuckCandidates(still, tried, 21 * 60_000, { x: 0, z: 0 }), [])
  for (let m = 22; m <= 36; m += 2) V.trackStill(still, [s], m * 60_000)
  assert.deepEqual(V.stuckCandidates(still, tried, 36 * 60_000, { x: 0, z: 0 }).map(c => c.uuid), ['a'])
  const pen = { cells: [{ x: 80, y: 73, z: -4 }, { x: 81, y: 73, z: -4 }] }
  const e = (x, md = { 18: { villagerProfession: 0, level: 1 } }) => ({ name: 'villager', position: { x, y: 73, z: -3.7 }, metadata: Object.assign([], md) })
  assert.equal(V.villagerStillPenned(e(80.3), pen), 'ok')
  assert.equal(V.villagerStillPenned(e(85.3), pen), 'left_pen')
  assert.equal(V.villagerStillPenned(e(80.3, { 18: { villagerProfession: 13, level: 1 } }), pen), 'employed')
  assert.equal(V.villagerStillPenned(undefined, pen), 'villager_gone')
  assert.equal(V.penKey(pen), '80_73_-4')
})

await t('trackStill + stuckCandidates: 20 min in one cell, jobless adults only, per-villager cooldown, radius, nearest first', () => {
  const still = new Map(), tried = new Map()
  const s = (uuid, x, prof = 'none', baby = false) => ({ kind: 'villager', uuid, x, y: 73, z: -3.7, profession: prof, baby, zone: 'village-taiga-6_1' })
  V.trackStill(still, [s('a', 80.3), s('b', 82.7), s('c', 81.5, 'toolsmith'), s('d', 81.1, 'none', true)], 0)
  assert.deepEqual(V.stuckCandidates(still, tried, 19 * 60_000, { x: 0, z: 0 }), [])
  V.trackStill(still, [s('b', 90.1)], 10 * 60_000)   // b moved: its clock restarts
  for (const m of [8, 16, 21]) V.trackStill(still, [s('a', 80.3), s('c', 81.5, 'toolsmith'), s('d', 81.1, 'none', true)], m * 60_000)
  const c = V.stuckCandidates(still, tried, 21 * 60_000, { x: 0, z: 0 })
  assert.deepEqual(c.map(x => x.uuid), ['a'])
  tried.set('a', 21 * 60_000)
  assert.deepEqual(V.stuckCandidates(still, tried, 22 * 60_000, { x: 0, z: 0 }), [])
  assert.deepEqual(V.stuckCandidates(still, new Map(), 22 * 60_000, { x: 500, z: 0 }), [], 'out of radius')
})

await t('nextToggle: only what is STILL toggleable (another bot closed one), nearest first; none left -> null', () => {
  const p = V.penAround(worldOf(), { x: 80.3, y: 73, z: -3.7 })
  const from = { x: 81.5, y: 73, z: -7.5 }
  const first = V.nextToggle(p.toggles, worldOf(), from)
  assert.equal(first.z, -5)
  const over = {}; for (const q of p.toggles) over[`${q.x},${q.y},${q.z}`] = ['spruce_trapdoor', { open: 'false', half: 'bottom' }]
  assert.equal(V.nextToggle(p.toggles, worldOf(over), from), null)
})

await t('protectzone: activateBlock on a zone trapdoor is refused, EXCEPT inside withUnlockScope naming that cell; a door, a chest, another cell stay refused', async () => {
  const zl = PZ.parseZones({ version: 1, zones: [{ id: 'village-taiga-6_1', kind: 'village', box: [49, -64, -59, 157, 90, 45] }] }).zones
  assert.equal(zl.length, 1, 'zone parsed')
  const calls = []
  const ok = op => async (b) => { calls.push(`${op}:${b?.name}`); return `${op}-ok` }
  const bot = { entity: { position: { x: 81, y: 73, z: -7 } }, dig: ok('dig'), _genericPlace: ok('place'), activateBlock: ok('use'), openBlock: ok('open'), sleep: ok('sleep'), craft: ok('craft'), findBlocks: () => [], blockAt: () => null }
  const attach = PZ.attachProtectZone ?? PZ.default?.attachProtectZone
  assert.equal(typeof attach, 'function', 'attachProtectZone exported')
  attach(bot, { zones: () => zl })
  const blk = (x, y, z, name) => ({ name, position: { x, y, z } })
  const td = blk(80, 73, -5, 'spruce_trapdoor'), door = blk(79, 73, -7, 'spruce_door'), chest = blk(88, 76, 12, 'chest')
  await assert.rejects(bot.activateBlock(td), /zone|protect/i, 'POSITIVE CONTROL: without the scope the trapdoor is refused')
  const r = await PZ.withUnlockScope([{ x: 80, y: 73, z: -5 }], async () => [
    await bot.activateBlock(td).catch(e => 'refused'),
    await bot.activateBlock(blk(81, 73, -5, 'spruce_trapdoor')).catch(e => 'refused'),
    await bot.activateBlock(door).catch(e => 'refused'),
    await bot.dig(td).catch(e => 'refused')])
  assert.deepEqual(r, ['use-ok', 'refused', 'refused', 'refused'])
  await PZ.withUnlockScope([{ x: 88, y: 76, z: 12 }], async () => assert.equal(await bot.activateBlock(chest).catch(() => 'refused'), 'refused', 'a chest at a named cell is still refused'))
  await assert.rejects(bot.activateBlock(td), /zone|protect/i, 'after the scope: refused again')
  assert.deepEqual(calls, ['use:spruce_trapdoor'])
})

await t('unlockAllowed: names (wooden trapdoor / fence gate, with or without minecraft:), never iron, never without a scope', () => {
  const sc = { cells: new Set(['1,2,3']) }
  assert.equal(PZ.unlockAllowed('spruce_trapdoor', { x: 1, y: 2, z: 3 }, sc), true)
  assert.equal(PZ.unlockAllowed('minecraft:oak_fence_gate', { x: 1, y: 2, z: 3 }, sc), true)
  assert.equal(PZ.unlockAllowed('iron_trapdoor', { x: 1, y: 2, z: 3 }, sc), false)
  assert.equal(PZ.unlockAllowed('spruce_door', { x: 1, y: 2, z: 3 }, sc), false)
  assert.equal(PZ.unlockAllowed('spruce_trapdoor', { x: 1, y: 2, z: 4 }, sc), false)
  assert.equal(PZ.unlockAllowed('spruce_trapdoor', { x: 1, y: 2, z: 3 }, undefined), false)
})

await t('buildOrder: an idle bot is asked the unlock FIRST (before the copper run and the expedition); no ask -> unchanged', async () => {
  const SH = await import('../src/shop.mjs')
  const asked = []
  SH.setUnlockAsk(() => { asked.push('unlock'); return { order: { skill: 'village_unlock', args: { x: 1, y: 2, z: 3 } } } })
  SH.setCopperAsk(() => { asked.push('copper'); return { order: { skill: 'gather', args: {} } } })
  const r = SH.buildOrder({ on: true, shared: true, atTown: true, now: 1e12, complete: true, planned: true })
  assert.deepEqual(r.order, { skill: 'village_unlock', args: { x: 1, y: 2, z: 3 } })
  assert.deepEqual(asked, ['unlock'])
  SH.setUnlockAsk(() => null)
  const r2 = SH.buildOrder({ on: true, shared: true, atTown: true, now: 1e12, complete: true, planned: true })
  assert.equal(r2.order?.skill, 'gather', 'POSITIVE CONTROL: without an unlock the copper run still comes next')
  SH.setUnlockAsk(null); SH.setCopperAsk(null)
})

await t('the skill is registered (chatOnly, never the model\'s) with a contract', async () => {
  const SK = await import('../src/skills.mjs')
  assert.equal(typeof SK.SKILLS.village_unlock?.run, 'function')
  assert.equal(SK.SKILLS.village_unlock.chatOnly, true)
  assert.ok(SK.SKILL_CONTRACTS.village_unlock?.maxMs > 0)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
