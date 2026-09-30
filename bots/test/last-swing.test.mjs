// THE LAST SWING: a harvest dig may spend a tool's final use when nothing else can harvest the block.
//
// Measured 2026-09-28 by both engines over ~22 h: 92% of 3,393 failed stone/cobblestone gathers happened while
// every pickaxe the bot held had exactly 1 use left; 61 of 80 bots were in that state. HARD_STOP kept those copies
// out of the hand, gather dug stone bare-handed, watchDigging aborted it, and no cobblestone -- so no new
// stone_pickaxe -- could ever be made. The drop surviving the tool's break is external Minecraft behaviour and is
// proved on the sandbox, not here; this file pins the POLICY and its SCOPE.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toolFor, usableTools, travelTool, HARD_STOP } from '../src/toolfor.mjs'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

const ID = { wooden_pickaxe: 1, stone_pickaxe: 2, iron_pickaxe: 3 }
const NAME = Object.fromEntries(Object.entries(ID).map(([n, i]) => [i, n]))
const item = (name, left, max = 131) => ({ name, type: ID[name], count: 1, maxDurability: max, durabilityUsed: max - left })
const block = (name, ids) => ({ name, harvestTools: ids ? Object.fromEntries(ids.map(i => [i, true])) : undefined,
  digTime: typeId => (typeId && NAME[typeId] ? 400 : 7500) })
const STONE = block('stone', [1, 2, 3]), DIRT = block('dirt', undefined)

t('stone, every pickaxe at 1 use: without the option nothing is chosen (the old behaviour, the trap)', () => {
  const inv = [item('stone_pickaxe', 1), item('stone_pickaxe', 1)]
  assert.deepEqual(toolFor(STONE, inv), { item: null, hand: false, reason: 'none' })
})

t('the same bot on a HARVEST dig spends the last use', () => {
  const inv = [item('stone_pickaxe', 1), item('stone_pickaxe', 1)]
  const r = toolFor(STONE, inv, { lastSwing: true })
  assert.equal(r.reason, 'last_swing')
  assert.equal(r.item.name, 'stone_pickaxe')
})

t('the cheapest tier is spent first, and a copy at 0 uses is never chosen', () => {
  const r = toolFor(STONE, [item('iron_pickaxe', 1, 250), item('wooden_pickaxe', 1, 59)], { lastSwing: true })
  assert.equal(r.item.name, 'wooden_pickaxe')
  assert.equal(toolFor(STONE, [item('stone_pickaxe', 0)], { lastSwing: true }).reason, 'none')
})

t('the option changes nothing when a normal tool exists or the hand can harvest', () => {
  const healthy = [item('stone_pickaxe', 1), item('stone_pickaxe', 90)]
  assert.deepEqual(toolFor(STONE, healthy, { lastSwing: true }), toolFor(STONE, healthy))
  assert.equal(toolFor(STONE, healthy, { lastSwing: true }).item.durabilityUsed, 131 - 90)
  assert.equal(toolFor(DIRT, [item('stone_pickaxe', 1)], { lastSwing: true }).reason, 'hand', 'dirt: the hand, never a last swing')
})

t('SCOPE: travel digs and the exit contract still honour the hard stop', () => {
  const inv = [item('stone_pickaxe', 1)]
  assert.deepEqual(usableTools(STONE, inv), [], `usableTools must not count a ${HARD_STOP}-use copy`)
  assert.notEqual(travelTool(STONE, inv, null)?.name, 'stone_pickaxe', 'the pathfinder must not be handed a 1-use pickaxe')
})

t('SCOPE (source, comments stripped): only collectManually opts in, and it logs the swing', () => {
  const code = readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const sites = code.match(/lastSwing:\s*true/g) ?? []
  assert.equal(sites.length, 1, `expected exactly one opt-in, found ${sites.length}`)
  const s = code.indexOf('export async function collectManually('), e = code.indexOf('\nexport async function ', s + 10)
  const body = code.slice(s, e)
  assert.match(body, /bestTool\(bot, block, \{ lastSwing: true \}\)/)
  assert.match(body, /kind: 'last_swing'/)
})

t('STONE FAMILY ONLY: a last use is never spent on a block that cannot rebuild a pickaxe', () => {
  const inv = [item('stone_pickaxe', 1), item('stone_pickaxe', 1)]
  for (const name of ['stone', 'cobblestone', 'deepslate', 'cobbled_deepslate', 'blackstone']) {
    assert.equal(toolFor(block(name, [1, 2, 3]), inv, { lastSwing: true }).reason, 'last_swing', name)
  }
  for (const name of ['coal_ore', 'iron_ore', 'andesite']) {
    assert.equal(toolFor(block(name, [1, 2, 3]), inv, { lastSwing: true }).reason, 'none', `${name} must not take the last use`)
  }
})

// BEHAVIOUR, through the real collectManually: a last swing whose equip did not take must not dig bare-handed.
process.env.LOG_DIR = '/tmp/mcbot-test-logs-lastswing'; process.env.BOT_NAME = 'TestBot'
const { collectManually } = await import('../src/skills.mjs')
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) })
function fakeBot ({ equipTakes }) {
  const pick = { ...item('stone_pickaxe', 1), slot: 36 }
  const stone = { ...STONE, position: V(1, 64, 0), type: 1, boundingBox: 'block' }
  const bot = {
    heldItem: null, dug: 0,
    entity: { position: V(0, 64, 0), onGround: true, velocity: V(0, 0, 0) },
    inventory: { items: () => [pick], emptySlotCount: () => 5 },
    canDigBlock: () => true,
    blockAt: pp => (pp.x === 1 && pp.y === 64 && pp.z === 0 ? stone : { name: 'stone', boundingBox: 'block', position: pp }),
    equip: async it => { if (equipTakes) bot.heldItem = it },
    dig: async () => { bot.dug++ },
    nearestEntity: () => null, pathfinder: { goto: async () => {}, setGoal () {}, stop () {} },
  }
  return { bot, stone }
}
const outcome = async ({ equipTakes }) => {
  const { bot, stone } = fakeBot({ equipTakes })
  try { await collectManually(bot, stone, { aborted: false }); return { bot, fc: null } }
  catch (e) { return { bot, fc: e.failClass ?? String(e.message).slice(0, 40) } }
}
{
  const bad = await outcome({ equipTakes: false })
  t('an equip that did not take is equip_failed, and nothing is dug', () => {
    assert.equal(bad.fc, 'equip_failed')
    assert.equal(bad.bot.dug, 0)
  })
  const good = await outcome({ equipTakes: true })
  t('control: when the pickaxe IS in hand, the dig runs (no equip_failed)', () => {
    assert.notEqual(good.fc, 'equip_failed')
    assert.equal(good.bot.dug, 1, `dug ${good.bot.dug}, failed: ${good.fc}`)
  })
}

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
