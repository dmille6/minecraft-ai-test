// glass-01 (showcase): the styled blueprints' window palette (glass, else a trapdoor of the walls' wood, else the wall) and the bill
// that makes the trapdoor fallback real -- a window bills its trapdoor (crafted by the visit) when the town holds no glass pane.
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-glass-show'
process.env.BOT_NAME = process.env.BOT_NAME || 'GlassShowBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
delete process.env.GLASS
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const S = await import('../src/shop.mjs')
const T = await import('../src/townstyle.mjs')
const G = await import('../src/glass.mjs')
const SHOP_PATH = new URL('../src/shop.mjs', import.meta.url)
const killed = async fn => { try { await fn(); return false } catch (e) { if (e instanceof assert.AssertionError) return true; throw e } }

test('the styled blueprints\' windows: glass, then a trapdoor of the walls\' wood, then the wall (the gable\'s attic window: the gable)', () => {
  for (const v of ['s', 'f']) {
    const bp = T.cottageBlueprint(v)
    assert.deepEqual(bp.palette.window, ['glass_pane', '%wood_trapdoor', '$wall'])
    assert.deepEqual(bp.palette.gablewin, ['glass_pane', '%wood_trapdoor', '$gable'])
    const disk = JSON.parse(readFileSync(new URL(`../src/blueprints/cottage@1${v}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(disk.palette.window, bp.palette.window, 'make-cottage.mjs was run')
  }
  const th = JSON.parse(readFileSync(new URL('../src/blueprints/townhall@1.json', import.meta.url), 'utf8'))
  assert.deepEqual(th.palette.window, G.windowPalette('$wall'))
  // a sited record's palette resolves the token to the walls' species
  const pal = T.stylePalette(T.cottageBlueprint('s').palette, { wood: 'spruce' })
  assert.deepEqual(pal.window, ['glass_pane', 'spruce_trapdoor', '$wall'])
  assert.equal(G.isFallback('spruce_trapdoor', pal, 'window'), true, 'the glaze swaps it later')
})

const pal = T.stylePalette(T.cottageBlueprint('s').palette, { wood: 'spruce' })
const rec = { cells: [{ at: [0, 2, 0], role: 'window' }, { at: [1, 2, 0], role: 'wall' }] }
const air = () => ({ name: 'air', boundingBox: 'empty' })
const done = () => false
test('the bill: a window bills its trapdoor with no pane in town, the pane when the town has one; a wood part counts as had', () => {
  assert.deepEqual(S.billOf(rec, pal, air, { done, inTown: () => false, planks: 'oak_planks' }), { spruce_trapdoor: 1, spruce_planks: 1 })
  assert.deepEqual(S.billOf(rec, pal, air, { done, inTown: n => n === 'glass_pane', planks: 'oak_planks' }), { glass_pane: 1, spruce_planks: 1 })
  assert.equal(S.isWoodPart('spruce_trapdoor'), true); assert.equal(S.isWoodPart('oak_stairs'), true)
  assert.equal(S.isWoodPart('cobblestone_stairs'), false); assert.equal(S.isWoodPart('glass_pane'), false)
  // a house@1 window (no trapdoor in its palette) is as before: the planks when the town has no pane
  const hp = { wall: ['$planks'], window: ['glass_pane', '$wall'] }
  assert.deepEqual(S.billOf({ cells: [{ at: [0, 2, 0], role: 'window' }] }, hp, air, { done, inTown: n => n === 'oak_planks', planks: 'oak_planks' }), { oak_planks: 1 })
})

test('the wood-part rule is load-bearing (mutant: no wood-part rule -> the window bills the pane it cannot get)', async () => {
  const src = readFileSync(SHOP_PATH, 'utf8')
  const old = '  return names.find(n => inTown(n) || (GLASS.on && isWoodPart(n))) ?? names[0] ?? null'
  assert.equal(src.split(old).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  const out = new URL(`./_mutant-glassshow-${process.pid}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, '  return names.find(n => inTown(n)) ?? names[0] ?? null').replace(/from '\.\//g, "from '../src/"))
  try {
    const S2 = await import(out.href)
    assert.ok(await killed(async () => assert.deepEqual(S2.billOf(rec, pal, air, { done, inTown: () => false, planks: 'oak_planks' }), { spruce_trapdoor: 1, spruce_planks: 1 })))
  } finally { try { unlinkSync(out) } catch {} }
})
