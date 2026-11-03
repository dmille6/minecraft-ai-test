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

await t('the house ring (3 villagers at 87..88,76,11): a pen of 2 cells, its 6 open trapdoors; the open top shutters at y75/77 are never collected', () => {
  const p = V.penAround(worldOf(), { x: 87.3, y: 76, z: 11.7 })
  assert.equal(p.pen, true)
  assert.deepEqual(keys(p), ['86,76,11', '87,76,10', '87,76,12', '88,76,10', '88,76,12', '89,76,11'])
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
  const fenced = (x, y, z) => ({ name: y < 64 ? 'stone' : (x === 0 && z === 0) ? 'air' : (x === 1 && z === 0) ? 'oak_fence_gate' : 'oak_fence', props: x === 1 ? { open: 'false' } : {} })
  const g = V.penAround(fenced, { x: 0.5, y: 64, z: 0.5 })
  assert.equal(g.pen, true); assert.deepEqual(g.toggles.map(q => [q.x, q.z, q.want]), [[1, 0, 'open']])
  const iron = (x, y, z) => ({ name: y < 64 ? 'stone' : (x === 0 && z === 0) ? 'air' : 'iron_trapdoor', props: { open: 'true', half: 'bottom' } })
  assert.equal(V.penAround(iron, { x: 0, y: 64, z: 0 }).why, 'walled', 'an iron trapdoor is not a toggle (redstone only)')
  const step = (x, y, z) => ({ name: y < 64 || (y === 64 && x === 1 && z === 0) ? 'stone' : 'air', props: {} })
  assert.equal(V.penAround(step, { x: 0, y: 64, z: 0 }, { maxCells: 100 }).why, 'exit_step')
})

await t('trackStill + stuckCandidates: 20 min in one cell, jobless adults only, per-villager cooldown, radius, nearest first', () => {
  const still = new Map(), tried = new Map()
  const s = (uuid, x, prof = 'none', baby = false) => ({ kind: 'villager', uuid, x, y: 73, z: -3.7, profession: prof, baby, zone: 'village-taiga-6_1' })
  V.trackStill(still, [s('a', 80.3), s('b', 82.7), s('c', 81.5, 'toolsmith'), s('d', 81.1, 'none', true)], 0)
  assert.deepEqual(V.stuckCandidates(still, tried, 19 * 60_000, { x: 0, z: 0 }), [])
  V.trackStill(still, [s('b', 90.1)], 10 * 60_000)   // b moved: its clock restarts
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
