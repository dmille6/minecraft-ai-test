// THE TREE FARM x MINEWELL-01's MINE GUARD (treefarm-02 on a8af87db). `mine` digs with bot.dig directly, so the farm's
// pathfinder exclusions never reached its stair; minewell-01's planner (every bearing's whole stair simulated before the
// first dig, a walk-off when none is clear, a re-check at every dig) now keeps the stair out of the farm's cells too: a
// plot's soil and column, a torch cell and its floor. And the two keep-outs compose: farm cells and a well's shell.
// Behaviour through the real skill (the minewell micro-world) and the pure planner; mutants with unique anchors.
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { V, AIR, STONE } from './helpers/microworld.mjs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-treefarm-minewell-${process.pid}`
process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '200'; process.env.HOME_Y = '64'; process.env.HOME_Z = '214'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'tfmw-'))
// the farm is the SHARED RECORD on disk (mine reads it afresh: Codex r8 P2); setFarm(true/false) writes or removes it
const RECFILE = path.join(process.env.POOL_STATE_DIR, 'treefarm-200_64_214.g1.json')
const here = path.dirname(fileURLToPath(import.meta.url))
const SKP = path.join(here, '../src/skills.mjs'), MWP = path.join(here, '../src/minewell.mjs')
const SK = await import('../src/skills.mjs')
const MW = await import('../src/minewell.mjs')
const TF = await import('../src/treefarm.mjs')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 3).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  let src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  src = src.replace(old, neu)
  const out = path.join(here, `.mutant-tfmw-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src.replace(/from '\.\//g, `from '${path.join(here, '../src')}/`))
  try { return await fn(await import(pathToFileURL(out))) } finally { try { fs.unlinkSync(out) } catch {} }
}
const key = (x, y, z) => `${x},${y},${z}`

// ---- a stone world (air from y=64), no well; the bot at 230,64,230 with a farm plot on each of its four sides --------
const P0 = { x: 230, y: 64, z: 230 }
const FARM = { blueprint: 'treefarm', version: 1, anchor: { x: P0.x, y: 64, z: P0.z }, cells: [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: P0.x + dx, y: 64, z: P0.z + dz, role: 'plot' })) }
const IDX = TF.farmIndex(FARM)
const farmCell = c => IDX.soil.has(key(c.x, c.y, c.z)) || IDX.torch.has(key(c.x, c.y, c.z)) || TF.inPlotColumn(IDX, c.x, c.y, c.z)
const setFarm = on => { if (on) fs.writeFileSync(RECFILE, JSON.stringify({ ...FARM, world: null })); else { try { fs.unlinkSync(RECFILE) } catch {} } }
function world ({ farm = true, cols = () => [], canMove = true } = {}) {
  setFarm(farm)
  if (farm) assert.equal(SK.knownFarmIndex({}).soil.size, FARM.cells.length, 'the record on disk is a valid farm (positive control for the fixture)')
  const carved = new Set(), digs = [], gotos = []
  const raw = p => (carved.has(key(p.x, p.y, p.z)) ? AIR : p.y < 64 ? STONE : AIR)
  const bot = {
    entity: { position: new V(P0.x + 0.5, P0.y, P0.z + 0.5), yaw: 0 }, health: 20, food: 20, oxygenLevel: 300, heldItem: { type: 1 },
    blockAt: p => ({ ...raw(p), position: new V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 100, harvestTools: undefined, material: 'rock' }),
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'cobblestone', count: 512 }] },
    equip: async () => {},
    dig: async b => { digs.push({ x: b.position.x, y: b.position.y, z: b.position.z }); carved.add(key(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      goto: async goal => {
        gotos.push({ x: goal.x, y: goal.y, z: goal.z })
        if (typeof bot._canMove === 'function' ? !bot._canMove(goal) : !bot._canMove) return
        const c = new V(goal.x, goal.y, goal.z)
        if (raw(c).boundingBox !== 'empty' || raw(c.offset(0, 1, 0)).boundingBox !== 'empty') return
        bot.entity.position = new V(c.x + 0.5, c.y, c.z + 0.5)
      },
      setGoal: () => {}, stop: () => {},
    },
    setControlState: () => {}, clearControlStates: () => {},
    registry: { blocksByName: {}, itemsByName: {} }, players: {},
    // the 20 s movement cache, deliberately STALE (empty) -- mine must not trust it
    wellCellsNow: cols, farmIndexNow: () => TF.emptyFarmIndex(), _digs: digs, _gotos: gotos, _canMove: canMove,
  }
  return bot
}
const run = (mod, bot, y = 50) => mod.SKILLS.mine.run({ bot }, { y }, new AbortController().signal)

await t('PLAN (pure): with the farm as `forbid`, no bearing into a plot is clear; with every side a plot, mine relocates to a cell that is not a farm cell; no farm -> every bearing (positive control)', () => {
  const bearings = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]
  let bottom = Infinity; for (const k of IDX.soil) bottom = Math.min(bottom, Number(k.split(',')[1]))
  const standable = c => c.y === 64
  const bare = MW.planMineStart({ cols: [], p0: P0, bearings, standable })
  assert.equal(bare.action, 'go'); assert.equal(bare.bearings.length, 4)
  const p = MW.planMineStart({ cols: [], p0: P0, bearings, standable, forbid: farmCell, forbidBottom: bottom })
  assert.equal(p.action, 'relocate', JSON.stringify(p))
  assert.equal(farmCell(p.to), false); assert.equal(farmCell({ ...p.to, y: p.to.y + 1 }), false)
  for (const b of p.bearings) assert.ok(MW.stairClear([], p.to, b, { forbid: farmCell, forbidBottom: bottom }).clear)
  const w = MW.stairClear([], P0, { x: 1, z: 0 }, { forbid: farmCell, forbidBottom: bottom })
  assert.equal(w.clear, false); assert.equal(w.hit.farm, true); assert.equal(w.hit.cap, null)
  // walled in: nothing standable anywhere -> a refusal that names the farm (no well to name)
  const r = MW.planMineStart({ cols: [], p0: P0, bearings, standable: () => false, forbid: farmCell, forbidBottom: bottom })
  assert.equal(r.action, 'refuse'); assert.match(r.why, /tree farm/)
})

await t('THE CHAIN through the real skill: mine started between four plots walks off the farm and descends -- no dig in any farm cell', async () => {
  const bot = world()
  const res = await run(SK, bot)
  assert.equal(bot._digs.filter(farmCell).length, 0, `farm cells dug: ${JSON.stringify(bot._digs.filter(farmCell))}`)
  assert.ok(bot._gotos.length >= 1, 'it walked off')
  assert.ok(bot._digs.length > 3, `it descended (${res.status}: ${res.detail})`)
})

await t('POSITIVE CONTROL: with no farm known, the same start digs straight into a plot', async () => {
  const bot = world({ farm: false })
  await run(SK, bot)
  assert.ok(bot._digs.some(farmCell), JSON.stringify(bot._digs.slice(0, 4)))
})

await t('COMPOSED WITH A WELL: a well cap 3 from the bot and the farm on the other sides -- the stair digs neither the shell nor a farm cell', async () => {
  const cap = { x: P0.x + 3, y: 63, z: P0.z }
  const bot = world({ cols: () => [cap] })
  await run(SK, bot)
  assert.equal(bot._digs.filter(farmCell).length, 0)
  assert.equal(bot._digs.filter(c => MW.shellOf([cap], c)).length, 0)
  assert.ok(bot._digs.length > 3, 'it descended')
})

await t('FARM CELLS AND WELL SHELLS: a farm founded beside a well keeps every plot (soil and column) out of the shell; only a torch floor may sit in it (and then neither digs it)', () => {
  const read = (x, y, z) => (y < 64 ? { name: y === 63 ? 'grass_block' : 'dirt', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' })
  const HOME = { x: 0, y: 64, z: 0 }
  const free = TF.canonicalFarm({ home: HOME, read }).record
  const p = free.cells.find(c => c.role === 'plot')
  const cap = { x: p.x + 2, y: 63, z: p.z + 2 }
  const rec = TF.canonicalFarm({ home: HOME, read, avoid: [{ x: cap.x, z: cap.z, r: TF.FARM_WELL_DISTANCE, what: 'junk_well' }] }).record
  for (const c of rec.cells) {
    if (c.role !== 'plot') continue
    for (let y = c.y - 1; y <= c.y + TF.CLEAR_ABOVE; y++) assert.equal(MW.shellOf([cap], { x: c.x, y, z: c.z }), null, `plot ${c.x},${c.y},${c.z} in the shell`)
  }
})

await t('MUTANT KILLED (skills): the farm not passed to the planner -- the stair starts into a plot and the per-dig check only stops it (no descent)', async () => {
  await withMutant(SKP, '                                         forbid: fm.forbid, forbidBottom: fm.bottom }) }', '                                         }) }', async m => {
    const bot = world()
    await run(m, bot)
    assert.equal(bot._digs.filter(farmCell).length, 0, 'the per-dig check still guards')
    assert.ok(bot._digs.length <= 3, 'but nothing descends: the stop, not the walk-off')
  })
})

await t('MUTANT KILLED (minewell): a farm cell never counted as a hit -- the planner sends the stair into a plot', async () => {
  await withMutant(MWP, '      if (farm && forbid(cell)) return { clear: false, hit: { step: i, cell, cap: null, farm: true } }\n', '', async m => {
    const bottom = 63
    const p = m.planMineStart({ cols: [], p0: P0, bearings: [{ x: 1, z: 0 }], standable: () => true, forbid: farmCell, forbidBottom: bottom })
    assert.equal(p.action, 'go', 'the mutant calls the stair into the plot clear')
  })
})

// A FARM RECORDED MID-DESCENT, further down the stair the plan chose (south): a plot whose column and soil the third step digs
const FARM2 = { blueprint: 'treefarm', version: 1, anchor: { x: P0.x, y: 62, z: P0.z + 3 }, cells: [{ x: P0.x, y: 62, z: P0.z + 3, role: 'plot' }] }
const IDX2 = TF.farmIndex(FARM2)
const farm2Cell = c => IDX2.soil.has(key(c.x, c.y, c.z)) || TF.inPlotColumn(IDX2, c.x, c.y, c.z)
const midDescent = bot => { let n = 0; const dig = bot.dig; bot.dig = async b => { if (++n === 1) fs.writeFileSync(RECFILE, JSON.stringify({ ...FARM2, world: null })); return dig(b) } }
await t('MUTANT KILLED (skills): the per-dig farm check removed -- a farm recorded mid-descent gets its cell dug', async () => {
  await withMutant(SKP, '        if (!fm.forbid || !fm.forbid(pos)) return null\n', '        return null\n', async m => {
    const bot = world({ farm: false }); midDescent(bot)
    await run(m, bot)
    assert.ok(bot._digs.some(farm2Cell), `the mutant digs into the plot: ${JSON.stringify(bot._digs.slice(0, 9))}`)
  })
  const bot = world({ farm: false }); midDescent(bot)
  const r = await run(SK, bot)
  assert.ok(bot._digs.length >= 1, 'it started (positive control: the plan saw no farm)')
  assert.equal(bot._digs.filter(farm2Cell).length, 0, `the real skill stops at the farm cell: ${JSON.stringify(bot._digs)}`)
  assert.match(r.detail, /tree farm/, r.detail)
})

await t('STALE CACHE (Codex r8 P2): the movement cache says "no farm" but the record exists -- mine still keeps out of every farm cell', async () => {
  const bot = world()
  assert.equal(bot.farmIndexNow().soil.size, 0, 'the cache is stale (empty)')
  await run(SK, bot)
  assert.equal(bot._digs.filter(farmCell).length, 0)
  assert.ok(bot._digs.length > 3, 'and it descended')
})

await t('MUTANT KILLED (skills): the stale 20 s cache trusted first -- a farm on disk but not yet in the cache gets dug', async () => {
  await withMutant(SKP, '      const idx = knownFarmIndex(bot)\n', '      const idx = farmIdx(bot) ?? knownFarmIndex(bot)\n', async m => {
    const bot = world()
    await run(m, bot)
    assert.ok(bot._digs.some(farmCell), 'the mutant trusts the empty cache and digs a plot')
  })
})

await t('THE REFUSAL CHAIN (Codex r8/r9): the walk-off cells unreachable -> a refusal naming explore away from the tree farm; the REAL explore skill performed; mine descends clear', async () => {
  // the walk-off cells near the farm cannot be reached (GoalBlock); the open country can (explore's GoalNear legs)
  const bot = world({ canMove: g => g.rangeSq !== undefined || Math.max(Math.abs(g.x - P0.x), Math.abs(g.z - P0.z)) > 16 })
  const r = await run(SK, bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'forbidden')
  assert.match(r.detail, /explore away from the tree farm/, r.detail)
  assert.equal(bot._digs.length, 0, 'nothing dug before the refusal')
  const e = await SK.SKILLS.explore.run({ bot }, { blocks: 40, heading: 90 }, new AbortController().signal)
  const p = bot.entity.position
  assert.ok(Math.max(Math.abs(Math.floor(p.x) - P0.x), Math.abs(Math.floor(p.z) - P0.z)) >= 3, `explore moved the bot only to ${p.x},${p.z} (${e.status}: ${e.detail})`)
  const r2 = await run(SK, bot)
  assert.equal(bot._digs.filter(farmCell).length, 0)
  assert.ok(bot._digs.length > 3, `then it descends: ${r2.status} ${r2.detail}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.log('FAILED:\n  ' + failed.join('\n  ')); process.exit(1) }
process.exit(0)
