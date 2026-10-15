// STRUCTUREGUARD-01: recorded TOWN STRUCTURES (the monument now) join minewell-01's keep-out for TARGET digs -- mine's
// stair plan and per-dig stop, gather's candidates, the room veto, the ore tunnel's profile. Behaviour through the pure
// registry, the real `mine` skill in the minewell micro-world, and the real gather filters; each guard beside the
// positive control without the record; wiring mutants with unique anchors (the farm-minewell harness's withMutant).
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { V, AIR, STONE } from './helpers/microworld.mjs'

process.env.LOG_DIR = `/tmp/mcbot-test-logs-structureguard-${process.pid}`
process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '200'; process.env.HOME_Y = '64'; process.env.HOME_Z = '214'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'sguard-'))
const here = path.dirname(fileURLToPath(import.meta.url))
const SKP = path.join(here, '../src/skills.mjs'), OTP = path.join(here, '../src/oretunnel.mjs')
const ST = await import('../src/structures.mjs')
const MW = await import('../src/minewell.mjs')
const MON = await import('../src/monument.mjs')
const SK = await import('../src/skills.mjs')
const OT = await import('../src/oretunnel.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 3).join('\n        ')}`) }
}
async function withMutant (file, old, neu, fn) {
  let src = fs.readFileSync(file, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 70))}`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique; the mutant is ambiguous')
  src = src.replace(old, neu)
  const out = path.join(here, `.mutant-sguard-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(out, src.replace(/from '\.\//g, `from '${path.join(here, '../src')}/`))
  try { return await fn(await import(pathToFileURL(out))) } finally { try { fs.unlinkSync(out) } catch {} }
}
const key = (x, y, z) => `${x},${y},${z}`
const DIR = process.env.POOL_STATE_DIR
const HOME = { x: 200, y: 64, z: 214 }
const RECFILE = path.join(DIR, `${ST.structureKey('monument', HOME)}.g1.json`)

// ---- the monument record: a 48-wide ziggurat whose WEST edge is 2 east of the bot (P0), base 64 ---------------------
const P0 = { x: 230, y: 64, z: 230 }
const SITE = { corner: { x: P0.x + 2, z: P0.z - 24 }, baseY: 64, stairFace: 'w' }
const REC = { v: 1, structure: 'monument', world: null, site: SITE, geom: MON.ZIG, state: 'building' }
const setMonument = on => { if (on) fs.writeFileSync(RECFILE, JSON.stringify(REC)); else { try { fs.unlinkSync(RECFILE) } catch {} } }
const IDX = ST.monumentIndex(REC)
const monCell = c => IDX.has(c.x, c.y, c.z)

await t('REGISTRY (pure): the monument reserves its footprint from base-8 up to the profile, plus the stair; not the air above, not outside', () => {
  const c = SITE.corner
  assert.equal(IDX.has(c.x, 64, c.z), true, 'the corner\'s first layer')
  assert.equal(IDX.has(c.x, 65, c.z), true, 'the corner\'s second layer (tier 0 is 2 high)')
  assert.equal(IDX.has(c.x, 66, c.z), false, 'above the edge profile: open air on the finished structure')
  assert.equal(IDX.has(c.x, 56, c.z), true, 'the foundation guard (base-8)')
  assert.equal(IDX.has(c.x, 55, c.z), false, 'below the guard')
  assert.equal(IDX.has(c.x - 1, 64, c.z), false, 'outside the footprint')
  assert.equal(IDX.has(c.x + 24, 64 + 15, c.z + 24), true, 'the top tier\'s top layer')
  const stair = MON.zigCells({ corner: c, baseY: 64, stairFace: 'w' }).find(x => x.role === 'stair')
  assert.equal(IDX.has(stair.x, stair.y, stair.z), true, 'a stair step outside the footprint is reserved too')
  assert.equal(ST.monumentIndex({ ...REC, state: 'abandoned' }), null, 'an abandoned monument reserves nothing')
  assert.equal(ST.monumentIndex({ ...REC, site: null }), null, 'no site, nothing')
})

await t('REGISTRY: the latest generation is read; another world\'s record is ignored; no record -> no keep-out (positive control)', () => {
  setMonument(false)
  assert.equal(ST.structureKeepOut(ST.structureIndexes(DIR, HOME)).forbid, null)
  setMonument(true)
  const k = ST.structureKeepOut(ST.structureIndexes(DIR, HOME))
  assert.equal(k.forbid({ x: SITE.corner.x, y: 64, z: SITE.corner.z }), 'monument'); assert.equal(k.bottom, 56)
  fs.writeFileSync(path.join(DIR, `${ST.structureKey('monument', HOME)}.g2.json`), JSON.stringify({ ...REC, site: { ...SITE, corner: { x: 0, z: 0 } } }))
  const k2 = ST.structureKeepOut(ST.structureIndexes(DIR, HOME))
  assert.equal(k2.forbid({ x: SITE.corner.x, y: 64, z: SITE.corner.z }), null, 'g2 moved the site: g1\'s cells are free')
  fs.unlinkSync(path.join(DIR, `${ST.structureKey('monument', HOME)}.g2.json`))
  fs.writeFileSync(RECFILE, JSON.stringify({ ...REC, world: 'other' }))
  assert.equal(ST.structureKeepOut(ST.structureIndexes(DIR, HOME, 'this')).forbid, null, 'another world: ignored')
  setMonument(true)
  assert.equal(ST.readStructureRecord(DIR, 'monument-200_64_21'), null, 'a key that is a prefix of the town\'s matches nothing')
  assert.equal(ST.structureKeepOut(ST.structureIndexes(DIR, { x: 1, y: 2, z: 3 })).forbid, null, 'another town\'s key: nothing')
})

await t('READER CACHE: a record written within CACHE_MS is honoured once the cache expires, never later', () => {
  setMonument(false)
  let clock = 0
  const rd = ST.structureReader(() => DIR, () => HOME, () => null, () => clock)
  const c = { x: SITE.corner.x, y: 64, z: SITE.corner.z }
  assert.equal(rd().forbid, null)
  setMonument(true)
  clock = ST.CACHE_MS - 1; assert.equal(rd().forbid, null, 'inside the window: the cached answer')
  clock = ST.CACHE_MS; assert.equal(rd().forbid(c), 'monument', 'at expiry: read afresh')
})

await t('COMPOSE: the farm (true) and the monument (kind) OR together; the bottom is the lower; one side missing is ignored', () => {
  const farm = { forbid: c => c.x === 1, bottom: 60 }, mon = { forbid: c => (c.x === 2 ? 'monument' : null), bottom: 56 }
  const k = ST.composeKeepOut(farm, mon)
  assert.equal(k.forbid({ x: 1 }), true); assert.equal(k.forbid({ x: 2 }), 'monument'); assert.equal(k.forbid({ x: 3 }), false); assert.equal(k.bottom, 56)
  assert.equal(ST.composeKeepOut({ forbid: null, bottom: null }, { forbid: null, bottom: null }).forbid, null)
  assert.equal(ST.composeKeepOut(farm, null).bottom, 60)
})

await t('PLAN (minewell, pure): a monument hit carries its kind and the refusal names the monument, not the farm', () => {
  const k = ST.structureKeepOut([IDX])
  const w = MW.stairClear([], P0, { x: 1, z: 0 }, { forbid: k.forbid, forbidBottom: k.bottom })
  assert.equal(w.clear, false); assert.equal(w.hit.kind, 'monument')
  const r = MW.planMineStart({ cols: [], p0: P0, bearings: [{ x: 1, z: 0 }], standable: () => false, forbid: k.forbid, forbidBottom: k.bottom })
  assert.equal(r.action, 'refuse'); assert.match(r.why, /monument/); assert.doesNotMatch(r.why, /tree farm/)
})

// ---- the minewell micro-world (treefarm-minewell's), with the monument east of the bot -------------------------------
function world ({ monument = true, canMove = true } = {}) {
  setMonument(monument)
  const carved = new Set(), digs = [], gotos = []
  const raw = p => (carved.has(key(p.x, p.y, p.z)) ? AIR : p.y < 64 ? STONE : AIR)
  const bot = {
    entity: { position: new V(P0.x + 0.5, P0.y, P0.z + 0.5), yaw: -Math.PI / 2 },   // facing EAST: the first bearing is into the monument health: 20, food: 20, oxygenLevel: 300, heldItem: { type: 1 },
    blockAt: p => ({ ...raw(p), position: new V(p.x, p.y, p.z), canHarvest: () => true, digTime: () => 100, harvestTools: undefined, material: 'rock' }),
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 }, { name: 'cobblestone', count: 512 }] },
    equip: async () => {},
    dig: async b => { digs.push({ x: b.position.x, y: b.position.y, z: b.position.z }); carved.add(key(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      goto: async goal => {
        gotos.push({ x: goal.x, y: goal.y, z: goal.z })
        if (!canMove) return
        const c = new V(goal.x, goal.y, goal.z)
        if (raw(c).boundingBox !== 'empty' || raw(c.offset(0, 1, 0)).boundingBox !== 'empty') return
        bot.entity.position = new V(c.x + 0.5, c.y, c.z + 0.5)
      },
      setGoal: () => {}, stop: () => {},
    },
    setControlState: () => {}, clearControlStates: () => {},
    registry: { blocksByName: {}, itemsByName: {} }, players: {},
    wellCellsNow: () => [], farmIndexNow: () => null, _digs: digs, _gotos: gotos,
  }
  return bot
}
const run = (mod, bot, y = 50) => mod.SKILLS.mine.run({ bot }, { y }, new AbortController().signal)

await t('POSITIVE CONTROL: with NO record, the same scene\'s stair goes east into the (unrecorded) monument volume', async () => {
  const bot = world({ monument: false })
  await run(SK, bot)
  assert.ok(bot._digs.some(monCell), `the scene reaches the volume (${bot._digs.length} digs)`)
})

await t('THE CHAIN through the real `mine`: started beside the monument it never digs a reserved cell, and it still descends', async () => {
  const bot = world()
  const res = await run(SK, bot)
  assert.equal(bot._digs.filter(monCell).length, 0, `monument cells dug: ${JSON.stringify(bot._digs.filter(monCell).slice(0, 5))}`)
  assert.ok(bot._digs.length > 3, `it descended (${res.status}: ${res.detail})`)
})

await t('A MONUMENT RECORDED MID-DESCENT: the per-dig stop reads the record afresh and names the monument', async () => {
  const bot = world({ monument: false })
  bot.entity.position = new V(SITE.corner.x - 2 + 0.5, 64, P0.z + 0.5)
  let n = 0
  const dig0 = bot.dig
  bot.dig = async b => { if (++n === 1) setMonument(true); return dig0(b) }
  const res = await run(SK, bot)
  // either the plan (before the first dig) or the per-dig stop catches it -- no reserved cell is dug after the record exists
  const after = bot._digs.slice(1)
  assert.equal(after.filter(monCell).length, 0, JSON.stringify(after.filter(monCell).slice(0, 3)))
  if (res.failClass === 'forbidden') assert.match(res.detail, /monument/)
})

await t('MUTANT KILLED (skills): mine reads the 2 s CACHE instead of the record -- a monument recorded mid-descent is dug', async () => {
  await withMutant(SKP, '    try { built = structuresFresh(bot) } catch', '    try { built = structuresNow(bot) } catch', async m => {
    const bot = world({ monument: false })
    let n = 0
    const dig0 = bot.dig
    bot.dig = async b => { if (++n === 1) setMonument(true); return dig0(b) }
    await run(m, bot)
    assert.ok(bot._digs.slice(1).some(monCell), 'the cached read lets the stair into the monument')
  })
})

await t('GATHER + ROOM: structureNoDig names the monument; with no record it is free (positive control)', () => {
  setMonument(true)
  const bot = { worldId: null }
  const c = { x: SITE.corner.x, y: 64, z: SITE.corner.z }
  assert.ok(fs.existsSync(RECFILE), 'the record is on disk')
  assert.equal(SK.structureNoDig(bot, c), 'monument')
  assert.equal(SK.structureNoDig(bot, { x: c.x - 1, y: 64, z: c.z }), null)
  setMonument(false)
  const bot2 = { worldId: null }
  assert.equal(SK.structureNoDig(bot2, c), null)
  setMonument(true)
})

await t('ORE TUNNEL: a reserved cell is a 100-cost break (refused) in the tunnel profile; an unreserved one is not', () => {
  setMonument(true)
  const bot = { registry: { blocksByName: {}, blocks: {} }, blockAt: p => ({ name: 'stone', boundingBox: 'block', position: new V(p.x, p.y, p.z) }) }
  const base = { exclusionAreasBreak: [], exclusionAreasStep: [] }
  let m
  try { m = OT.tunnelMovements(bot, base, { home: { x: 0, z: 0 }, keepOut: () => SK.structuresNow({ worldId: null }) }) } catch (e) { m = null }
  assert.ok(m, 'the tunnel profile builds on the fake registry')
  const brk = m.exclusionAreasBreak.at(-1)
  assert.equal(brk({ position: new V(SITE.corner.x, 64, SITE.corner.z) }), 100)
  assert.equal(brk({ position: new V(SITE.corner.x - 3, 64, SITE.corner.z) }), 0, 'positive control: plain stone outside is a free break')
})

await t('MUTANT KILLED (skills): the structures left out of mine\'s keep-out -- the stair digs the monument', async () => {
  await withMutant(SKP, '    try { built = structuresFresh(bot) } catch { /* no structure record: nothing from it */ }\n', '', async m => {
    const bot = world()
    await run(m, bot)
    assert.ok(bot._digs.some(monCell), 'the mutant digs into the monument')
  })
})

await t('MUTANT KILLED (skills): gather\'s structure filter removed -- structureNoDig still answers, but the candidate filter line is gone (wiring)', async () => {
  const src = fs.readFileSync(SKP, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const n = (src.match(/\.filter\(p => !structureNoDig\(bot, p\)\)/g) ?? []).length
  assert.equal(n, 2, 'both gather enumerations filter structure cells')
  assert.equal((src.match(/\.filter\(q => !structureNoDig\(bot, q\)\)/g) ?? []).length, 1, 'and the escalation search')
  assert.match(src, /if \(structureNoDig\(bot, p\)\) return 'town_structure'/, 'the room veto')
})

await t('MUTANT KILLED (oretunnel): the reserved check dropped from the tunnel profile (wiring, comments stripped)', async () => {
  const src = fs.readFileSync(OTP, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(src, /nearHome\(b\?\.position, home\) \|\| reserved\(b\?\.position\) \? 100/)
  const idx = fs.readFileSync(path.join(here, '../src/index.mjs'), 'utf8')
  assert.match(idx, /bot\.tunnelMovements = tunnelMovements\(bot, gatherMoves, \{[^\n]{0,200}keepOut: \(\) => structuresNow\(bot\) \}\)/)
  const sk = fs.readFileSync(SKP, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(sk, /tunnelMovements\(bot, bot\.gatherMovements, \{ home, keepOut: \(\) => structuresNow\(bot\) \}\)/, 'the fallback profile too')
})

setMonument(false)
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
