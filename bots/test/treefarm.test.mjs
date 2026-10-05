// THE BLUEPRINT BUILDER AND THE TOWN TREE FARM (src/blueprint.mjs, src/treefarm.mjs, skills.mjs tend_farm).
//
// Behaviour only: the pure decisions through their exported functions, then the real tend_farm skill against a fake
// world whose SERVER is separate from the client -- placements and digs are confirmed only by block_change packets on
// bot._client, the way Paper confirms them, and the fake can stay silent, refuse, or leave a client-only ghost. Source
// text is read only for wiring (a skill registered, an exclusion installed before the profiles are cloned), with the
// comments stripped, and every such assertion has a mutant that must fail it.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync, rmSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'

const LOG_DIR = `/tmp/mcbot-test-logs-treefarm-${process.pid}`
process.env.LOG_DIR = LOG_DIR; process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.POOL_STATE_DIR = mkdtempSync(path.join(tmpdir(), 'treefarm-store-'))
const BP = await import('../src/blueprint.mjs')
const TF = await import('../src/treefarm.mjs')
const SK = await import('../src/skills.mjs')
const { isHousekeeping } = await import('../src/hygiene.mjs')
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.8')
const Block = require('prismarine-block')('1.21.8')

let pass = 0, fail = 0
const failed = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) {
    fail++; failed.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n        ')}`)
  }
}

// ---- a synthetic world: grass at y=63 everywhere, air above; overrides by key ------------------------------------------
const K = (x, y, z) => `${x},${y},${z}`
function world (over = {}, { unloaded = new Set(), ground = 63 } = {}) {
  const m = new Map(Object.entries(over))
  const nameAt = (x, y, z) => m.get(K(x, y, z)) ?? (y < ground ? 'dirt' : y === ground ? 'grass_block' : 'air')
  const read = (x, y, z) => {
    if (unloaded.has(K(x, y, z))) return null
    const name = nameAt(x, y, z), def = REG.blocksByName[name]
    return { name, boundingBox: def?.boundingBox ?? 'block' }
  }
  return { m, nameAt, read, set: (x, y, z, n) => m.set(K(x, y, z), n) }
}
const HOME = { x: 0, y: 64, z: 0 }

// ================================================================ blueprint core ==========================================

await t('rotateOffset: four quarter turns are the identity; one turn maps +x to +z', () => {
  const o = { dx: 3, dy: 1, dz: -2 }
  let r = o
  for (let i = 0; i < 4; i++) r = BP.rotateOffset(r, 1)
  assert.deepEqual(r, o)
  assert.deepEqual(BP.rotateOffset({ dx: 1, dy: 0, dz: 0 }, 1), { dx: -0, dy: 0, dz: 1 })
  assert.deepEqual(BP.placeAt([{ dx: 1, dy: 0, dz: 0, role: 'plot' }], { x: 10, y: 64, z: 10 }, 0), [{ role: 'plot', x: 11, y: 64, z: 10 }])
})

await t('cellStatus: done / open / blocked / unknown, and a predicate want', () => {
  const w = world({ [K(1, 64, 1)]: 'birch_sapling', [K(2, 64, 2)]: 'stone' }, { unloaded: new Set([K(3, 64, 3)]) })
  assert.equal(BP.cellStatus(w.read, { x: 1, y: 64, z: 1 }, n => /_sapling$/.test(n)), 'done')
  assert.equal(BP.cellStatus(w.read, { x: 0, y: 64, z: 5 }, 'torch'), 'open')
  assert.equal(BP.cellStatus(w.read, { x: 2, y: 64, z: 2 }, 'torch'), 'blocked')
  assert.equal(BP.cellStatus(w.read, { x: 3, y: 64, z: 3 }, 'torch'), 'unknown')
})

await t('refFaceFor: the block below first (face up); never a chest; needsBelow refuses side faces', () => {
  const w = world({ [K(5, 63, 5)]: 'air', [K(6, 64, 5)]: 'stone', [K(4, 64, 5)]: 'chest' })
  assert.deepEqual(BP.refFaceFor(w.read, { x: 1, y: 64, z: 1 }), { ref: { x: 1, y: 63, z: 1 }, face: { x: -0, y: 1, z: -0 } })
  const side = BP.refFaceFor(w.read, { x: 5, y: 64, z: 5 })
  assert.deepEqual(side.ref, { x: 6, y: 64, z: 5 }, 'the stone beside, never the chest')
  assert.equal(BP.refFaceFor(w.read, { x: 5, y: 64, z: 5 }, { needsBelow: true }), null)
})

await t('wouldEnclose: a solid placement that leaves no cardinal exit is refused; one that leaves an exit is not', () => {
  const walls = {}
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1]]) { walls[K(dx, 64, dz)] = 'stone'; walls[K(dx, 65, dz)] = 'stone' }
  walls[K(0, 66, 0)] = 'stone'
  const w = world(walls)
  assert.equal(BP.wouldEnclose(w.read, { x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: -1 }), true)
  assert.equal(BP.wouldEnclose(w.read, { x: 0, y: 64, z: 0 }, { x: 5, y: 64, z: 5 }), false)
})

await t('standsFor: never the target, never a forbidden cell, never a body, always within reach (of reachTo)', () => {
  const w = world()
  const target = { x: 10, y: 64, z: 10 }
  const forbidden = c => c.x === 11 && c.z === 10
  const bodies = [{ x: 9.5, y: 64, z: 10.5, w: 0.6, h: 1.8 }]
  const s = BP.standsFor(w.read, target, { from: { x: 20, y: 64, z: 10 }, forbidden, bodies })
  assert.ok(s.length > 0)
  for (const c of s) {
    assert.ok(!(c.x === 10 && c.z === 10 && c.y === 64), 'the target itself')
    assert.ok(!forbidden(c)); assert.ok(!(c.x === 9 && c.z === 10 && c.y === 64), 'a body stands there')
    assert.ok(BP.reachOf(c, target) <= BP.REACH)
  }
  const high = { x: 10, y: 70, z: 10 }
  assert.equal(BP.standsFor(w.read, target, { allowTarget: true, reachTo: high }).length, 0, 'six up is beyond the 4.5 placement reach')
  const up = BP.standsFor(w.read, target, { allowTarget: true, reachTo: high, reach: BP.DIG_REACH })
  assert.ok(up.length && up.every(c => BP.reachOf(c, high) <= BP.DIG_REACH), 'stands chosen for a log six up are within dig reach')
  assert.ok(up.some(c => c.x === 10 && c.z === 10), 'allowTarget lets the bot stand in the plot column to dig upward')
})

await t('shared record: one writer wins each generation; adoption, replacement on refusal, deferral on unknown, world change', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-rec-'))
  const rec = n => ({ blueprint: 'x', version: 1, anchor: { x: n, y: 64, z: 0 }, cells: [{ x: n, y: 64, z: 0, role: 'plot' }] })
  assert.equal(BP.createRecordGen(dir, 'k', 1, rec(1)), true)
  assert.equal(BP.createRecordGen(dir, 'k', 1, rec(2)), false, 'the second writer of generation 1 loses')
  assert.equal(BP.readRecord(dir, 'k').record.anchor.x, 1)
  let computed = 0
  const compute = () => { computed++; return { record: rec(7) } }
  const a = BP.resolveRecord({ dir, key: 'k', world: 'w', compute, refuse: () => null })
  assert.equal(a.record.anchor.x, 1); assert.equal(computed, 0, 'an accepted record is adopted, not recomputed')
  const d = BP.resolveRecord({ dir, key: 'k', world: 'w', compute, refuse: () => 'unknown' })
  assert.equal(d.record, null); assert.equal(d.defer, true); assert.equal(computed, 0, 'unknown never replaces')
  const r = BP.resolveRecord({ dir, key: 'k', world: 'w', compute, refuse: r0 => (r0.anchor.x === 1 ? 'gone bad' : null) })
  assert.equal(r.record.anchor.x, 7); assert.equal(r.gen, 2); assert.equal(r.created, true)
  const other = BP.resolveRecord({ dir, key: 'k', world: 'reseeded', compute: () => ({ record: rec(9) }), refuse: () => null })
  assert.equal(other.record.anchor.x, 9, 'a record from another world counts as absent')
  rmSync(dir, { recursive: true, force: true })
})

await t('lease: one holder; a second bot is refused until expiry or release; the generation is a fencing token', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-lease-'))
  const a = BP.takeLease(dir, 'f', 'A', 1000, 90_000)
  assert.equal(a.ok, true)
  const b = BP.takeLease(dir, 'f', 'B', 2000, 90_000)
  assert.equal(b.ok, false); assert.equal(b.holder, 'A')
  assert.equal(BP.holdsLease(dir, 'f', 'A', a.gen), true)
  const b2 = BP.takeLease(dir, 'f', 'B', 1000 + 90_001, 90_000)
  assert.equal(b2.ok, true, 'an expired lease is taken over')
  assert.equal(BP.holdsLease(dir, 'f', 'A', a.gen), false, 'the old holder is fenced off')
  assert.equal(BP.releaseLease(dir, 'f', 'A', a.gen), false, 'a fenced holder cannot release another bot\'s lease')
  assert.equal(BP.releaseLease(dir, 'f', 'B', b2.gen, 1000 + 90_002), true)
  assert.equal(BP.takeLease(dir, 'f', 'A', 1000 + 90_003, 90_000).ok, true, 'a released lease is free')
  rmSync(dir, { recursive: true, force: true })
})

await t('lease: a torn (unreadable) current lease is never treated as free', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-lease-'))
  writeFileSync(path.join(dir, 'f.lease3.json'), '{"holder":')
  assert.equal(BP.takeLease(dir, 'f', 'A', 1000).ok, false)
  rmSync(dir, { recursive: true, force: true })
})

await t('decodeMultiRecord matches mineflayer 4.37 (blocks.js usesMultiblockSingleLong) bit for bit', () => {
  const stateId = REG.blocksByName.birch_sapling.minStateId
  const rec = (BigInt(stateId) << 12n) | (5n << 8n) | (9n << 4n) | 3n
  const d = BP.decodeMultiRecord({ x: -2, y: 4, z: 7 }, rec)
  // mineflayer: blockZ = (record >> 4) & 0x0f, blockX = (record >> 8) & 0x0f, blockY = record & 0x0f, state = record >> 12
  assert.deepEqual(d, { x: -32 + 5, y: 64 + 3, z: 112 + 9, stateId })
  assert.deepEqual(BP.decodeMultiRecord({ x: -2, y: 4, z: 7 }, Number(rec)), d)
})

await t('witnessVerdict: the last server word wins; nothing said is silent, never success', () => {
  assert.equal(BP.witnessVerdict([], 'torch'), 'silent')
  assert.equal(BP.witnessVerdict(['torch'], 'torch'), 'confirmed')
  assert.equal(BP.witnessVerdict(['torch', 'air'], 'torch'), 'refused', 'a correction after the confirmation')
  assert.equal(BP.witnessVerdict(['air'], n => n === 'air' || n === 'cave_air'), 'confirmed')
})

await t('installBlockWitness: hears block_change and multi_block_change from the SERVER, and only for watched cells', async () => {
  const client = new EventEmitter()
  const w = BP.installBlockWitness({ _client: client, registry: REG }, { settleMs: 10 })
  const c = { x: 3, y: 64, z: 3 }
  w.watch(c)
  setTimeout(() => client.emit('block_change', { location: c, type: REG.blocksByName.oak_sapling.minStateId }), 20)
  assert.equal(await w.until(c, 'oak_sapling', 500), 'confirmed')
  const d = { x: 17, y: 70, z: -5 }
  w.watch(d)
  const rec = (BigInt(REG.blocksByName.air.minStateId) << 12n) | (1n << 8n) | (11n << 4n) | 6n
  setTimeout(() => client.emit('multi_block_change', { chunkCoordinates: { x: 1, y: 4, z: -1 }, records: [rec] }), 20)
  assert.equal(await w.until(d, 'air', 500), 'confirmed')
  const e = { x: 9, y: 64, z: 9 }
  w.watch(e)
  assert.equal(await w.until(e, 'torch', 80), 'silent')
  w.stop()
  assert.equal(client.listenerCount('block_change'), 0)
})

await t('materialPlan: alternatives draw from the most held; shortfalls are named', () => {
  const p = BP.materialPlan([{ items: ['birch_sapling', 'oak_sapling'] }, { items: ['birch_sapling', 'oak_sapling'] }, { item: 'torch' }], { oak_sapling: 1, birch_sapling: 0 })
  assert.equal(p.have.oak_sapling, 1)
  assert.equal(p.short['birch_sapling|oak_sapling'], 1)
  assert.equal(p.short.torch, 1)
})

// ================================================================ the farm, pure ==========================================

await t('layout: 3x3 plots 4 apart, torches at the 2x2 centres, each torch within light reach of its plots (manhattan 5 -> light 9)', () => {
  const p = TF.plotOffsets(), tt = TF.torchOffsets()
  assert.equal(p.length, 9); assert.equal(tt.length, 4)
  for (const a of p) for (const b of p) if (a !== b) assert.ok(Math.max(Math.abs(a.dx - b.dx), Math.abs(a.dz - b.dz)) >= TF.FARM_SPACING)
  for (const pl of p) {
    const near = Math.min(...tt.map(q => Math.abs(q.dx - pl.dx) + 1 + Math.abs(q.dz - pl.dz)))
    assert.ok(14 - near >= 9, `plot ${pl.dx},${pl.dz} gets light ${14 - near} from its nearest torch`)
  }
})

await t('plotRefusal: soil, cell, clearance, liquid, containers, reservations, unknown', () => {
  const at = { x: 20, y: 64, z: 20 }
  assert.equal(TF.plotRefusal(world().read, at), null)
  assert.match(TF.plotRefusal(world({ [K(20, 63, 20)]: 'stone' }).read, at), /soil is stone/)
  assert.match(TF.plotRefusal(world({ [K(20, 64, 20)]: 'stone' }).read, at), /cell is stone/)
  assert.match(TF.plotRefusal(world({ [K(20, 70, 20)]: 'oak_leaves' }).read, at), /oak_leaves 6 above/)
  assert.match(TF.plotRefusal(world({ [K(21, 63, 20)]: 'water' }).read, at), /water beside/)
  assert.match(TF.plotRefusal(world({ [K(22, 64, 21)]: 'chest' }).read, at), /chest within 3/)
  assert.match(TF.plotRefusal(world().read, at, { reserved: c => c.x === 20 }), /reserved/)
  assert.equal(TF.plotRefusal(world({}, { unloaded: new Set([K(20, 67, 20)]) }).read, at), 'unknown')
})

await t('canonicalFarm: deterministic, keeps off home and the composter, every plot within gather reach of town', () => {
  const w = world()
  const a = TF.canonicalFarm({ home: HOME, read: w.read, avoid: [{ x: 9, z: 0, r: 4, what: 'composter' }] })
  const b = TF.canonicalFarm({ home: HOME, read: w.read, avoid: [{ x: 9, z: 0, r: 4, what: 'composter' }] })
  assert.ok(a.record, a.why)
  assert.deepEqual(a.record, b.record)
  const plots = TF.plotsOf(a.record)
  assert.equal(plots.length, 9)
  for (const p of plots) {
    assert.ok(Math.hypot(p.x, p.z) >= TF.FARM_HOME_CLEARANCE)
    assert.ok(Math.hypot(p.x, p.y - 64, p.z) <= TF.FARM_MAX_DIST)
    assert.ok(Math.hypot(p.x - 9, p.z) >= 4, 'off the composter')
  }
  assert.equal(TF.torchesOf(a.record).length, 4)
})

await t('canonicalFarm: a reservation predicate (the world border, in tend_farm) keeps every plot on its side', () => {
  const inside = c => Math.hypot(c.x, c.z) > 14
  const r = TF.canonicalFarm({ home: HOME, read: world().read, reserved: inside })
  assert.ok(r.record, r.why)
  for (const p of TF.plotsOf(r.record)) assert.ok(Math.hypot(p.x, p.z) <= 14, `plot ${p.x},${p.z} past the line`)
  const free = TF.canonicalFarm({ home: HOME, read: world().read })
  assert.ok(TF.plotsOf(free.record).some(p => Math.hypot(p.x, p.z) > 14), 'positive control: without the line the farm reaches past it')
  // a RECORDED farm laid out before the line moved: refused once too few of its plots are inside (Codex r4)
  const inPlots = TF.plotsOf(free.record).filter(p => Math.hypot(p.x, p.z) <= 14).length
  assert.equal(TF.farmRecordRefusal(world().read, free.record), null)
  const verdict = TF.farmRecordRefusal(world().read, free.record, { reserved: inside })
  assert.equal(verdict === null, inPlots >= TF.MIN_PLOTS, `${inPlots} plots inside: ${verdict}`)
  assert.equal(TF.farmRecordRefusal(world().read, free.record, { reserved: () => true }), '0 of 9 plots still usable')
  for (const t of TF.torchesOf(r.record)) assert.ok(Math.hypot(t.x, t.z) <= 14, 'torches stay on its side too')
})

await t('canonicalFarm: an unloaded cell anywhere on the way means no farm (never a private answer)', () => {
  const first = TF.farmSpiral(HOME)[0]
  const un = new Set(); for (let y = 58; y <= 72; y++) un.add(K(first.x, y, first.z))
  const r = TF.canonicalFarm({ home: HOME, read: world({}, { unloaded: un }).read })
  assert.equal(r.record, null); assert.match(r.why, /unknown/)
})

await t('fitFarm: an unloaded cell in any plot column (not only the anchor\'s) means decide later', () => {
  const anchor = { x: 15, y: 64, z: 0 }
  const ok = TF.fitFarm({ read: world().read, anchor, home: HOME })
  assert.ok(ok.record, ok.why)
  assert.equal(TF.plotsOf(ok.record).length, 9)
  const p = TF.plotOffsets()[0]
  const un = new Set([K(anchor.x + p.dx, 66, anchor.z + p.dz)])
  assert.equal(TF.fitFarm({ read: world({}, { unloaded: un }).read, anchor, home: HOME }).why, 'unknown')
  const un2 = new Set(); for (let y = 58; y <= 70; y++) un2.add(K(anchor.x + p.dx, y, anchor.z + p.dz))
  assert.equal(TF.fitFarm({ read: world({}, { unloaded: un2 }).read, anchor, home: HOME }).why, 'unknown', 'a whole plot column unloaded')
})

await t('canonicalFarm: a pond inside the first fit costs plots; too few and the search moves on', () => {
  const over = {}
  for (let x = 4; x <= 15; x++) for (let z = -5; z <= 5; z++) over[K(x, 63, z)] = 'water'
  const r = TF.canonicalFarm({ home: HOME, read: world(over).read })
  assert.ok(r.record)
  for (const p of TF.plotsOf(r.record)) assert.ok(!(p.x >= 3 && p.x <= 16 && p.z >= -6 && p.z <= 6), `plot ${p.x},${p.z} is at the pond`)
})

await t('plotState: every state; ready means CLEAR_ABOVE air, so every farm species fits', () => {
  const p = { x: 20, y: 64, z: 20 }
  const st = o => TF.plotState(world(o).read, p)
  assert.equal(st({ [K(20, 64, 20)]: 'birch_log' }).state, 'tree')
  assert.equal(st({ [K(20, 64, 20)]: 'oak_sapling' }).state, 'sapling')
  assert.equal(st({ [K(20, 63, 20)]: 'air' }).state, 'soil_lost')
  assert.equal(st({ [K(20, 63, 20)]: 'cobblestone' }).state, 'soil_foreign')
  assert.equal(st({ [K(20, 64, 20)]: 'crafting_table' }).state, 'cell_foreign')
  const la = st({ [K(20, 66, 20)]: 'birch_log', [K(20, 67, 20)]: 'birch_log' })
  assert.equal(la.state, 'logs_above'); assert.deepEqual(la.logs.map(c => c.y), [66, 67])
  assert.equal(st({ [K(20, 69, 20)]: 'birch_leaves' }).state, 'ready', 'leaves do not block growth (Paper 16/16)')
  assert.equal(st({ [K(20, 69, 20)]: 'birch_leaves' }).leaves, true)
  assert.equal(st({ [K(20, 69, 20)]: 'stone' }).state, 'column_foreign')
  assert.deepEqual(st({}).species, ['birch_sapling', 'oak_sapling'])
  assert.equal(st({ [K(20, 71, 20)]: 'stone' }).state, 'column_foreign', 'the seventh cell counts too (birch 6 + margin)')
  assert.equal(TF.plotState(world({}, { unloaded: new Set([K(20, 65, 20)]) }).read, p).state, 'unknown')
})

await t('tendPlan: soil, then leftover logs (lowest first), then saplings it HOLDS (birch while it lasts), torches carried; bone meal only with the arm on', () => {
  const pl = i => ({ x: i * 4, y: 64, z: 0 })
  const states = [
    { plot: pl(0), state: 'ready', species: ['birch_sapling', 'oak_sapling'] },
    { plot: pl(1), state: 'ready', species: ['oak_sapling'] },
    { plot: pl(2), state: 'logs_above', logs: [{ x: 8, y: 67, z: 0 }, { x: 8, y: 66, z: 0 }] },
    { plot: pl(3), state: 'soil_lost' },
    { plot: pl(4), state: 'sapling', species: 'oak_sapling' },
    { plot: pl(5), state: 'ready', species: ['birch_sapling', 'oak_sapling'] },
  ]
  const torches = [{ cell: { x: 2, y: 64, z: 2 }, state: 'open' }, { cell: { x: 6, y: 64, z: 2 }, state: 'done' }]
  const held = { birch_sapling: 1, oak_sapling: 1, dirt: 5, torch: 3, bone_meal: 4 }
  const p = TF.tendPlan({ states, torches, held })
  assert.deepEqual(p.actions.map(a => a.role), ['soil', 'leftover_log', 'leftover_log', 'plant', 'plant', 'torch'])
  assert.deepEqual(p.actions.filter(a => a.kind === 'dig').map(a => a.cell.y), [66, 67])
  const plants = p.actions.filter(a => a.role === 'plant')
  assert.deepEqual(plants.map(a => [a.cell.x, a.item]), [[0, 'birch_sapling'], [4, 'oak_sapling']], 'never more saplings than held; birch first, then oak')
  assert.equal(p.actions.some(a => a.kind === 'bonemeal'), false, 'the bone meal arm is off by default')
  const on = TF.tendPlan({ states, torches, held, bonemeal: true })
  assert.deepEqual(on.actions.filter(a => a.kind === 'bonemeal').map(a => a.cell.x), [16])
  assert.equal(TF.tendPlan({ states, torches, held, max: 2 }).actions.length, 2)
  const high = TF.tendPlan({ states: [{ plot: pl(0), state: 'logs_above', logs: [{ x: 0, y: 70, z: 0 }, { x: 0, y: 71, z: 0 }] }], held: {} })
  assert.deepEqual(high.actions.map(a => a.cell.y), [70], 'a log 7 above the plot is out of dig reach: never an action')
  assert.equal(high.counts.logs_high, 1)
  assert.equal(TF.tendPlan({ states: [{ plot: pl(0), state: 'ready', species: ['oak_sapling'] }], held: {} }).actions.length, 0)
})

await t('bone meal is OFF unless TREEFARM_BONEMEAL says on; the farm is ON unless TREEFARM_ENABLED says off', () => {
  assert.equal(TF.bonemealEnabled({}), false)
  assert.equal(TF.bonemealEnabled({ TREEFARM_BONEMEAL: '' }), false)
  assert.equal(TF.bonemealEnabled({ TREEFARM_BONEMEAL: 'on' }), true)
  assert.equal(TF.farmEnabled({}), true)
  assert.equal(TF.farmEnabled({ TREEFARM_ENABLED: 'off' }), false)
})

await t('farmIndex + farmPlaceRefusal: a plot column takes only the farm\'s saplings in its own cell; torch cells a torch; soil dirt', () => {
  const rec = { cells: [{ x: 10, y: 64, z: 10, role: 'plot' }, { x: 12, y: 64, z: 12, role: 'torch' }] }
  const idx = TF.farmIndex(rec)
  assert.equal(TF.farmPlaceRefusal(idx, 10, 64, 10, 'birch_sapling'), null)
  assert.match(TF.farmPlaceRefusal(idx, 10, 64, 10, 'crafting_table'), /plot column/)
  assert.match(TF.farmPlaceRefusal(idx, 10, 68, 10, 'dirt'), /plot column/, 'scaffold in the column')
  assert.match(TF.farmPlaceRefusal(idx, 10, 65, 10, 'oak_sapling'), /plot column/, 'a sapling above the plot cell')
  assert.equal(TF.farmPlaceRefusal(idx, 12, 64, 12, 'torch'), null)
  assert.match(TF.farmPlaceRefusal(idx, 12, 64, 12, 'cobblestone'), /torch cell/)
  assert.equal(TF.farmPlaceRefusal(idx, 10, 63, 10, 'dirt'), null)
  assert.equal(TF.farmPlaceRefusal(idx, 11, 64, 10, 'cobblestone'), null, 'the walkway is not reserved for placement')
  const pos = (x, y, z) => ({ position: { x, y, z } })
  assert.equal(TF.farmPlaceCost(idx, pos(10, 66, 10)), 100)
  assert.equal(TF.farmPlaceCost(idx, pos(11, 66, 10)), 0)
  assert.equal(TF.farmPlaceCost(idx, pos(10, 63, 10)), 100, 'no scaffold into a missing soil cell (Codex r2)')
  assert.equal(TF.farmBreakCost(idx, pos(10, 63, 10)), 100)
  assert.equal(TF.farmBreakCost(idx, pos(12, 63, 12)), 100, 'a torch floor')
  assert.equal(TF.farmBreakCost(idx, pos(10, 65, 10)), 0, 'a farm tree\'s log is wood: harvest stays open')
  assert.equal(TF.inFarmBox(idx, 8, 14), true); assert.equal(TF.inFarmBox(idx, 20, 20), false)
  assert.equal(TF.farmPlaceRefusal(TF.emptyFarmIndex(), 10, 64, 10, 'dirt'), null)
})

await t('farmOrder: only at town, only with work, cooldown charged when ISSUED, scans rate-limited; soft outcomes cost nothing', () => {
  const plan = { actions: [{ role: 'plant' }, { role: 'plant' }, { role: 'torch' }] }
  let calls = 0
  const lazyPlan = () => { calls++; return plan }
  assert.equal(TF.farmOrder({ now: 1e6, distHome: 80, plan: lazyPlan }).order, null)
  assert.equal(calls, 0, 'away from town nothing is read')
  const a = TF.farmOrder({ now: 1e6, distHome: 10, plan: lazyPlan })
  assert.equal(a.order.skill, 'tend_farm'); assert.match(a.order.why, /2 plant, 1 torch/)
  const b = TF.farmOrder({ now: 1e6 + 1000, distHome: 10, plan: lazyPlan, state: a.state })
  assert.equal(b.order, null, 'scan rate')
  const b2 = TF.farmOrder({ now: 1e6 + TF.FARM_SCAN_MS + 1000, distHome: 10, plan: lazyPlan, state: a.state })
  assert.equal(b2.order, null, 'cooldown: past the scan limit, inside the 5-minute cooldown')
  const b3 = TF.farmOrder({ now: 1e6 + TF.TEND_COOLDOWN_MS + 1000, distHome: 10, plan: lazyPlan, state: a.state })
  assert.equal(b3.order?.skill, 'tend_farm', 'and after it, the next order')
  const none = TF.farmOrder({ now: 1e6, distHome: 10, plan: () => ({ actions: [] }) })
  assert.equal(none.order, null)
  const c = TF.farmOrder({ now: 1e6 + 1000, distHome: 10, plan: lazyPlan, state: none.state })
  assert.equal(c.order, null, 'scan rate limit after an empty scan')
  assert.equal(TF.farmOrder({ now: 1e6, distHome: 10, plan: lazyPlan, enabled: false }).order, null)
  const failedOnce = TF.farmOrderOutcome('tend_farm', 'failed', 5e6, {}, 'farm_unconfirmed')
  assert.equal(failedOnce.backoffUntil, 5e6 + TF.TEND_BACKOFF_MS)
  assert.equal(TF.farmOrderOutcome('tend_farm', 'failed', 5e6, {}, 'farm_no_site').backoffUntil, 5e6 + TF.NO_SITE_BACKOFF_MS, 'no site anywhere: a long backoff')
  assert.deepEqual(TF.farmOrderOutcome('tend_farm', 'no_effect', 5e6, {}, null), {})
  assert.deepEqual(TF.farmOrderOutcome('tend_farm', 'failed', 5e6, {}, 'runner_busy', new Set(['runner_busy'])), {})
})

await t('farmRecordRefusal: a farm stays a farm while MIN_PLOTS plots are not foreign; an older layout is refused', () => {
  const rec = TF.canonicalFarm({ home: HOME, read: world().read }).record
  assert.equal(TF.farmRecordRefusal(world().read, rec), null)
  const over = {}
  for (const p of TF.plotsOf(rec).slice(0, 4)) over[K(p.x, p.y, p.z)] = 'cobblestone'
  assert.match(TF.farmRecordRefusal(world(over).read, rec), /5 of 9 plots/)
  assert.match(TF.farmRecordRefusal(world().read, { ...rec, version: 0 }), /older farm layout/)
})

await t('onFarmPlan: a mutation outside the record is never allowed (digs only in a column above the plot cell)', () => {
  const idx = TF.farmIndex({ cells: [{ x: 10, y: 64, z: 10, role: 'plot' }, { x: 12, y: 64, z: 12, role: 'torch' }] })
  assert.equal(SK.onFarmPlan(idx, { kind: 'place', role: 'plant', cell: { x: 10, y: 64, z: 10 } }), true)
  assert.equal(SK.onFarmPlan(idx, { kind: 'place', role: 'plant', cell: { x: 11, y: 64, z: 10 } }), false)
  assert.equal(SK.onFarmPlan(idx, { kind: 'dig', role: 'leftover_log', cell: { x: 10, y: 66, z: 10 } }), true)
  assert.equal(SK.onFarmPlan(idx, { kind: 'dig', role: 'leftover_log', cell: { x: 10, y: 64, z: 10 } }), false)
  assert.equal(SK.onFarmPlan(idx, { kind: 'dig', role: 'leftover_log', cell: { x: 10, y: 63, z: 10 } }), false, 'never the soil')
  assert.equal(SK.onFarmPlan(idx, { kind: 'place', role: 'soil', cell: { x: 10, y: 63, z: 10 } }), true)
  assert.equal(SK.onFarmPlan(idx, { kind: 'place', role: 'torch', cell: { x: 12, y: 64, z: 12 } }), true)
})

// ================================================================ the skill, against a fake server ============================

const STATE_ID = name => REG.blocksByName[name].minStateId
/**
 * A town on flat grass with a SERVER separate from the client. `server(mode)` decides what a placement or dig gets:
 *   ok      the cell changes and a block_change packet says so
 *   silent  nothing changes and nothing is said
 *   refuse  the old block is re-sent
 *   ghost   the CLIENT world changes but the server says nothing (mineflayer's own dig prediction)
 */
function fakeTown ({ items = [], over = {}, name = 'b-Alpha', worldId = 'w1', mode = () => 'ok', storeDir = null, shared = null } = {}) {
  process.env.POOL_STATE_DIR = storeDir ?? mkdtempSync(path.join(tmpdir(), 'treefarm-town-'))
  const w = shared ?? world(over)
  const client = new EventEmitter()
  const slots = new Array(46).fill(null)
  let next = 9
  for (const it of items) { while (slots[next] || next === 36) next++; slots[next] = { ...it, type: REG.itemsByName[it.name].id, slot: next } }
  const state = { places: [], digs: [], gotos: 0, events: [] }
  const blockAt = p => {
    const v = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
    const n = w.nameAt(v.x, v.y, v.z), def = REG.blocksByName[n]
    const b = Block.fromStateId(def.minStateId, 0)
    b.position = v
    return b
  }
  const send = (c, n) => client.emit('block_change', { location: { x: c.x, y: c.y, z: c.z }, type: STATE_ID(n) })
  const bot = {
    username: name, worldId, _client: client, registry: REG, players: {}, entities: {}, quickBarSlot: 0,
    controlState: { sneak: false },
    entity: { position: new Vec3(0.5, 64, 2.5), width: 0.6, height: 1.8 },
    get heldItem () { return slots[36 + bot.quickBarSlot] ?? null },
    inventory: { slots, items: () => slots.slice(9, 45).filter(s => s && s.count > 0) },
    setQuickBarSlot (n) { bot.quickBarSlot = n },
    equip: async item => {
      await state.onEquip?.(item)
      if (state.equipFails?.(item)) throw new Error('equip rejected')
      if (!item || slots[item.slot] !== item) throw new Error('not in inventory')
      if (item.slot >= 36) { bot.quickBarSlot = item.slot - 36; return }
      const d = [36, 37, 38, 39, 40, 41, 42, 43, 44].find(i => !slots[i]) ?? 36
      bot.quickBarSlot = d - 36
      const other = slots[d], from = item.slot
      slots[d] = item; item.slot = d; slots[from] = other; if (other) other.slot = from
    },
    unequip: async () => { throw new Error('unequip tosses on a full bag: never used') },
    lookAt: async () => {}, setControlState () {}, clearControlStates () {}, stopDigging () {},
    blockAt,
    waitForTicks: async n => { await new Promise(r => setTimeout(r, Math.min(20, n))) },
    pathfinder: {
      setGoal () {}, stop () {},
      goto: async goal => { state.gotos++; bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); await state.onGoto?.(goal) },
    },
    placeBlock: async (ref, face) => {
      const c = ref.position.plus(face), h = bot.heldItem
      assert.ok(h, 'placing with an empty hand')
      assert.ok(BP.reachOf(bot.entity.position.floored(), c) <= BP.REACH + 1e-9, 'placed from out of reach')
      const m = mode('place', c, h.name)
      state.places.push({ at: `${c.x},${c.y},${c.z}`, item: h.name, mode: m })
      await state.onPlace?.(c, h.name)
      if (m === 'ok') { h.count--; if (!h.count) slots[h.slot] = null; w.set(c.x, c.y, c.z, h.name); setTimeout(() => send(c, h.name), 5) }
      if (m === 'refuse') setTimeout(() => send(c, w.nameAt(c.x, c.y, c.z)), 5)
      if (m === 'ghost') w.set(c.x, c.y, c.z, h.name)
    },
    dig: async b => {
      const c = b.position, m = mode('dig', c, b.name)
      state.digs.push({ at: `${c.x},${c.y},${c.z}`, name: b.name, mode: m })
      if (m === 'ok') { w.set(c.x, c.y, c.z, 'air'); setTimeout(() => send(c, 'air'), 5) }
      if (m === 'ghost') w.set(c.x, c.y, c.z, 'air')
      if (m === 'refuse') setTimeout(() => send(c, b.name), 5)
    },
    activateBlock: async () => {},
  }
  return { bot, w, state, slots, client }
}
const S = (name, count) => ({ name, count })
const rows = async kind => { await new Promise(r => setTimeout(r, 150)); try { return readFileSync(`${LOG_DIR}/skill-TestBot.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === `_${kind}`) } catch { return [] } }
const tend = (bot, signal = new AbortController().signal) => SK.SKILLS.tend_farm.run({ bot }, {}, signal)
const field = (detail, k) => (new RegExp(`(?:^| )${k}=([^ ]*)`).exec(detail) || [])[1]

await t('SKILL tend_farm: founds the town farm and plants every plot it can, each counted only on a server confirmation', async () => {
  const { bot, w, state } = fakeTown({ items: [S('birch_sapling', 5), S('oak_sapling', 6), S('stick', 3)] })
  const r = await tend(bot)
  assert.equal(r.status, 'success', r.detail)
  const rec = BP.readRecord(process.env.POOL_STATE_DIR, 'treefarm-0_64_0').record
  assert.ok(rec, 'the shared record was written')
  const planted = TF.plotsOf(rec).filter(p => /_sapling$/.test(w.nameAt(p.x, p.y, p.z)))
  const row = (await rows('farm_tend')).at(-1)
  assert.equal(Number(field(row.skill.detail, 'planted')), planted.length)
  assert.equal(planted.length, 9)
  assert.equal(field(row.skill.detail, 'offplan'), '0'); assert.equal(field(row.skill.detail, 'lost'), '0')
  assert.equal(TF.plotsOf(rec).filter(p => w.nameAt(p.x, p.y, p.z) === 'birch_sapling').length, 5, 'birch first, while it lasts')
  for (const p of state.places) assert.ok(TF.plotsOf(rec).some(q => `${q.x},${q.y},${q.z}` === p.at), `off-plan placement at ${p.at}`)
  assert.equal(BP.readLease(process.env.POOL_STATE_DIR, 'treefarm-0_64_0').lease.released, true, 'the lease is released at the end')
})

await t('SKILL tend_farm: a SILENT server confirms nothing -- no plant is counted, the visit fails honestly', async () => {
  const { bot } = fakeTown({ items: [S('oak_sapling', 9)], mode: () => 'silent' })
  const r = await tend(bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'farm_unconfirmed')
  assert.equal(field((await rows('farm_tend')).at(-1).skill.detail, 'planted'), '0')
})

await t('SKILL tend_farm: a refusal (the old block re-sent) and a client-only GHOST are both not plants', async () => {
  let n = 0
  const { bot, w } = fakeTown({ items: [S('oak_sapling', 9)], mode: () => (n++ % 2 ? 'ghost' : 'refuse') })
  const r = await tend(bot)
  assert.equal(r.status, 'failed', r.detail)
  const rec = BP.readRecord(process.env.POOL_STATE_DIR, 'treefarm-0_64_0').record
  assert.ok(TF.plotsOf(rec).some(p => w.nameAt(p.x, p.y, p.z) === 'oak_sapling'), 'the ghosts are in the CLIENT world')
  assert.equal(field((await rows('farm_tend')).at(-1).skill.detail, 'planted'), '0', 'and still nothing was counted')
})

await t('SKILL tend_farm: one builder per town -- a second bot finds the lease held and changes nothing', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-shared-'))
  const a = fakeTown({ items: [S('oak_sapling', 9)], storeDir, name: 'b-Alpha' })
  const b = fakeTown({ items: [S('oak_sapling', 9)], storeDir, name: 'b-Bravo', shared: a.w })
  let second = null
  a.state.onPlace = async () => { if (!second) second = await tend(b.bot) }
  const r = await tend(a.bot)
  assert.equal(r.status, 'success')
  assert.equal(second.status, 'no_effect'); assert.match(second.detail, /another bot \(b-Alpha\) is tending/)
  assert.equal(b.state.places.length, 0, 'the second bot placed nothing')
  // and once the first has finished (lease released), the second may tend
  const later = await tend(b.bot)
  assert.equal(later.status, 'no_effect', `nothing left to plant: every plot holds a sapling (${later.detail})`)
  assert.match(later.detail, /needs nothing/)
})

await t('SKILL tend_farm: a lease taken over mid-visit (expired, another bot) stops the visit before its next mutation', async () => {
  const { bot, state } = fakeTown({ items: [S('oak_sapling', 9)] })
  let stolen = false
  state.onPlace = async () => {
    if (stolen) return
    stolen = true
    const dir = process.env.POOL_STATE_DIR, key = 'treefarm-0_64_0'
    const cur = BP.readLease(dir, key)
    writeFileSync(path.join(dir, `${key}.lease${cur.gen + 1}.json`), JSON.stringify({ holder: 'b-Thief', until: Date.now() + 60_000 }))
  }
  const r = await tend(bot)
  assert.equal(state.places.length, 1, 'no mutation after the fence saw the lease go')
  assert.match((await rows('farm_tend')).at(-1).skill.detail, /stop=lease_lost/)
  assert.equal(r.status, 'success')
})

await t('SKILL tend_farm: an abort mid-visit leaves a resumable farm; the next visit plants the rest from the world', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-abort-'))
  const { bot, w, state } = fakeTown({ items: [S('oak_sapling', 9)], storeDir })
  const ac = new AbortController()
  state.onPlace = async () => { if (state.places.length === 3) ac.abort() }
  await tend(bot, ac.signal).catch(e => assert.ok(e.aborted || /abort/i.test(String(e)), String(e)))
  const rec = BP.readRecord(storeDir, 'treefarm-0_64_0').record
  const n1 = TF.plotsOf(rec).filter(p => w.nameAt(p.x, p.y, p.z) === 'oak_sapling').length
  assert.ok(n1 >= 2 && n1 < 9, `aborted part way (${n1})`)
  const lease = BP.readLease(storeDir, 'treefarm-0_64_0').lease
  assert.ok(lease.released || lease.until <= Date.now() + BP.LEASE_MS, 'the lease is released (or expires by itself)')
  state.onPlace = null
  const r = await tend(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(TF.plotsOf(rec).filter(p => w.nameAt(p.x, p.y, p.z) === 'oak_sapling').length, 9)
})

await t('SKILL tend_farm: leftover logs come out of a column only on the server\'s word; a ghost dig is not a clear', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-logs-'))
  const first = fakeTown({ items: [S('oak_sapling', 9)], storeDir })
  await tend(first.bot)
  const rec = BP.readRecord(storeDir, 'treefarm-0_64_0').record
  const [p, q] = TF.plotsOf(rec)
  const over = {}
  for (const c of TF.plotsOf(rec)) over[K(c.x, c.y, c.z)] = 'oak_sapling'
  over[K(p.x, p.y, p.z)] = 'air'; over[K(p.x, p.y + 3, p.z)] = 'birch_log'; over[K(p.x, p.y + 4, p.z)] = 'birch_log'
  over[K(q.x, q.y, q.z)] = 'air'; over[K(q.x, q.y + 2, q.z)] = 'birch_log'
  const ghostAt = `${q.x},${q.y + 2},${q.z}`
  const town = fakeTown({ items: [S('oak_sapling', 2)], over, storeDir, mode: (k, c) => (k === 'dig' && `${c.x},${c.y},${c.z}` === ghostAt ? 'ghost' : 'ok') })
  const r = await tend(town.bot)
  assert.equal(r.status, 'success', r.detail)
  const row = (await rows('farm_tend')).at(-1).skill.detail
  assert.equal(field(row, 'cleared'), '2'); assert.equal(field(row, 'failed'), '1')
  assert.equal(r.placed, 2, 'a clearing-only visit is a world change (the runner scores world_change from placed)')
  assert.equal(SK.classifyOutcome('tend_farm', 'success', { placed: r.placed }).value, 'valuable')
  assert.equal(SK.classifyOutcome('tend_farm', 'success', { placed: 0 }).value, 'neutral', 'positive control: placed 0 scores neutral (run 2 logged it unknown)')
  assert.deepEqual(town.state.digs.map(d => d.at), [`${p.x},${p.y + 3},${p.z}`, `${p.x},${p.y + 4},${p.z}`, ghostAt], 'lowest first, only column logs')
})

await t('SKILL tend_farm: lost soil goes back as dirt (a solid placement through the same verified path)', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-soil-'))
  const first = fakeTown({ items: [S('oak_sapling', 9)], storeDir })
  await tend(first.bot)
  const rec = BP.readRecord(storeDir, 'treefarm-0_64_0').record
  const p = TF.plotsOf(rec)[4]
  const over = {}
  for (const c of TF.plotsOf(rec)) over[K(c.x, c.y, c.z)] = 'oak_sapling'
  over[K(p.x, p.y, p.z)] = 'air'; over[K(p.x, p.y - 1, p.z)] = 'air'
  const town = fakeTown({ items: [S('dirt', 4)], over, storeDir })
  const r = await tend(town.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(town.w.nameAt(p.x, p.y - 1, p.z), 'dirt')
  assert.equal(field((await rows('farm_tend')).at(-1).skill.detail, 'soil'), '1')
})

await t('REFUSAL CHAIN: no saplings -> no order at all (never a loop); with a farm and no saplings the skip names a gather the bot can do here', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-chain-'))
  const empty = fakeTown({ items: [S('stick', 3)], storeDir })
  assert.equal(SK.townFarmPlan(empty.bot), null, 'no record and nothing to plant: the order has no plan')
  assert.equal(TF.farmOrder({ now: 1e7, distHome: 5, plan: () => SK.townFarmPlan(empty.bot) }).order, null)
  const founder = fakeTown({ items: [S('oak_sapling', 3)], storeDir })
  assert.equal(SK.townFarmPlan(founder.bot), null, `fewer than MIN_PLOTS (${TF.MIN_PLOTS}) saplings cannot found a farm`)
  const real = fakeTown({ items: [S('oak_sapling', 6)], storeDir })
  await tend(real.bot)
  const after = fakeTown({ items: [S('stick', 3)], storeDir })
  const plan = SK.townFarmPlan(after.bot)
  assert.equal(plan.actions.length, 0, 'three plots ready, nothing to plant them with')
  assert.equal(TF.farmOrder({ now: 1e7, distHome: 5, plan }).order, null, 'so no order is issued')
  const r = await tend(after.bot)
  assert.equal(r.status, 'no_effect')
  assert.match(r.detail, /gather birch_log or oak_log/, 'the remedy is a gather, which a bot at town can do')
})

await t('SKILL tend_farm: a log that turned into something else while the bot walked is NOT dug (Codex r1)', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-swap-'))
  const first = fakeTown({ items: [S('oak_sapling', 9)], storeDir })
  await tend(first.bot)
  const rec = BP.readRecord(storeDir, 'treefarm-0_64_0').record
  const p = TF.plotsOf(rec)[0]
  const over = {}
  for (const c of TF.plotsOf(rec)) over[K(c.x, c.y, c.z)] = 'oak_sapling'
  over[K(p.x, p.y, p.z)] = 'air'; over[K(p.x, p.y + 2, p.z)] = 'oak_log'
  const town = fakeTown({ items: [S('oak_sapling', 1)], over, storeDir })
  town.state.onGoto = async () => { town.w.set(p.x, p.y + 2, p.z, 'chest') }
  await tend(town.bot)
  assert.equal(town.state.digs.length, 0, 'the chest that replaced the log was dug')
  assert.equal(town.w.nameAt(p.x, p.y + 2, p.z), 'chest')
})

await t('SKILL tend_farm: a farm record replaced mid-visit fences the visit off before its next mutation (Codex r1)', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-regen-'))
  const { bot, state } = fakeTown({ items: [S('oak_sapling', 9)], storeDir })
  let bumped = false
  state.onPlace = async () => {
    if (bumped) return
    bumped = true
    const cur = BP.readRecord(storeDir, 'treefarm-0_64_0')
    assert.equal(BP.createRecordGen(storeDir, 'treefarm-0_64_0', cur.gen + 1, { ...cur.record, anchor: { ...cur.record.anchor, x: cur.record.anchor.x + 1 } }), true)
  }
  await tend(bot)
  assert.equal(state.places.length, 1)
  assert.match((await rows('farm_tend')).at(-1).skill.detail, /stop=farm_record_replaced/)
})

await t('SKILL tend_farm: a log swapped for a chest while the bot changes its hand is NOT dug (the post-equip re-read: Codex r2)', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-swap2-'))
  const first = fakeTown({ items: [S('oak_sapling', 9)], storeDir })
  await tend(first.bot)
  const rec = BP.readRecord(storeDir, 'treefarm-0_64_0').record
  const p = TF.plotsOf(rec)[0]
  const over = {}
  for (const c of TF.plotsOf(rec)) over[K(c.x, c.y, c.z)] = 'oak_sapling'
  over[K(p.x, p.y, p.z)] = 'air'; over[K(p.x, p.y + 2, p.z)] = 'oak_log'
  const town = fakeTown({ items: [S('stone_axe', 1)], over, storeDir })
  town.state.onEquip = async () => { town.w.set(p.x, p.y + 2, p.z, 'chest') }
  await tend(town.bot)
  assert.equal(town.state.digs.length, 0)
})

await t('SKILL tend_farm: a rejected equip never lets another held tool dig a log (Codex r2)', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-hand-'))
  const first = fakeTown({ items: [S('oak_sapling', 9)], storeDir })
  await tend(first.bot)
  const rec = BP.readRecord(storeDir, 'treefarm-0_64_0').record
  const p = TF.plotsOf(rec)[0]
  const over = {}
  for (const c of TF.plotsOf(rec)) over[K(c.x, c.y, c.z)] = 'oak_sapling'
  over[K(p.x, p.y, p.z)] = 'air'; over[K(p.x, p.y + 2, p.z)] = 'oak_log'
  const town = fakeTown({ items: [S('stone_axe', 1), S('stone_pickaxe', 1)], over, storeDir })
  await town.bot.equip(town.slots.find(x => x?.name === 'stone_pickaxe'))
  assert.equal(town.bot.heldItem.name, 'stone_pickaxe')
  town.state.equipFails = it => it?.name === 'stone_axe'
  await tend(town.bot)
  assert.equal(town.state.digs.length, 0, 'the pickaxe swung at the log after the axe swap failed')
  assert.match((await rows('farm_place')).filter(r => /leftover_log/.test(r.skill.detail)).at(-1).skill.detail, /verdict=hand_stone_pickaxe/)
})

await t('a bot refused the lease never replaces the farm record of the bot that holds it (Codex r2)', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-contender-'))
  const first = fakeTown({ items: [S('oak_sapling', 9)], storeDir })
  await tend(first.bot)
  const before = BP.readRecord(storeDir, 'treefarm-0_64_0')
  const held = BP.takeLease(storeDir, 'treefarm-0_64_0', 'b-Holder')
  assert.equal(held.ok, true)
  const over = {}
  for (const c of TF.plotsOf(before.record)) over[K(c.x, c.y, c.z)] = 'cobblestone'
  const contender = fakeTown({ items: [S('oak_sapling', 9)], over, storeDir, name: 'b-Contender' })
  const r = await tend(contender.bot)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /b-Holder/)
  assert.equal(BP.readRecord(storeDir, 'treefarm-0_64_0').gen, before.gen, 'the contender wrote a new farm generation')
})

await t('a recorded farm straddling the world border plans and works only its in-border cells (Codex r5)', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-border-'))
  const town = fakeTown({ items: [S('oak_sapling', 9), S('torch', 4)], storeDir })
  // a record laid out before the border moved: the suite's border is 1950, so the layout is shifted to straddle it
  // (6 plots inside, 3 past it)
  const rec = TF.canonicalFarm({ home: HOME, read: world().read }).record
  const shift = c => ({ ...c, x: c.x + 1955 })
  const straddle = { ...rec, anchor: shift(rec.anchor), cells: rec.cells.map(shift) }
  assert.equal(BP.createRecordGen(storeDir, 'treefarm-0_64_0', 1, { ...straddle, world: 'w1' }), true)
  const inside = TF.plotsOf(straddle).filter(p => Math.hypot(p.x, p.z) <= 1950)
  assert.equal(inside.length, 6, 'the fixture straddles')
  assert.equal(TF.farmRecordRefusal(world().read, straddle, { reserved: c => Math.hypot(c.x, c.z) > 1950 }), null, 'and is still accepted')
  const plan = SK.townFarmPlan(town.bot)
  assert.equal(plan.actions.filter(a => a.role === 'plant').length, 6, 'the six inside are planned')
  for (const a of plan.actions) assert.ok(Math.hypot(a.cell.x, a.cell.z) <= 1950, `planned past the border: ${JSON.stringify(a.cell)}`)
  town.bot.entity.position = new Vec3(1945.5, 64, -6.5)
  await tend(town.bot)
  assert.ok(town.state.places.length >= 6, `placed ${town.state.places.length}`)
  for (const p of town.state.places) { const [x, , z] = p.at.split(',').map(Number); assert.ok(Math.hypot(x, z) <= 1950, `placed past the border at ${p.at}`) }
})

await t('record generations are never pruned (a pruned number could be re-created by a slow writer: Codex r1)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bp-keep-'))
  const rec = n => ({ blueprint: 'x', version: 1, anchor: { x: n, y: 64, z: 0 }, cells: [{ x: n, y: 64, z: 0 }] })
  for (let g = 1; g <= 6; g++) assert.equal(BP.createRecordGen(dir, 'k', g, rec(g)), true)
  assert.equal(BP.createRecordGen(dir, 'k', 1, rec(99)), false, 'generation 1 can never be written twice')
  assert.equal(readdirSync(dir).filter(f => /^k\.g\d+\.json$/.test(f)).length, 6)
  rmSync(dir, { recursive: true, force: true })
})

await t('townFarmPlan: a recorded farm that is no longer a farm schedules its own replacement (Codex r1)', async () => {
  const storeDir = mkdtempSync(path.join(tmpdir(), 'treefarm-refound-'))
  const first = fakeTown({ items: [S('oak_sapling', 9)], storeDir })
  await tend(first.bot)
  const rec = BP.readRecord(storeDir, 'treefarm-0_64_0').record
  const over = {}
  for (const c of TF.plotsOf(rec)) over[K(c.x, c.y, c.z)] = 'cobblestone'
  const town = fakeTown({ items: [S('oak_sapling', 8)], over, storeDir })
  const plan = SK.townFarmPlan(town.bot)
  assert.deepEqual(plan.actions.map(a => a.role), ['refound'])
  const r = await tend(town.bot)
  assert.equal(r.status, 'success', r.detail)
  const now = BP.readRecord(storeDir, 'treefarm-0_64_0')
  assert.equal(now.gen, 2, 'a new generation')
  assert.ok(TF.plotsOf(now.record).every(p => !TF.plotsOf(rec).some(q => q.x === p.x && q.z === p.z && q.y === p.y)), 'away from the cobbled plots')
  const second = mkdtempSync(path.join(tmpdir(), 'treefarm-refound2-'))
  const seed = fakeTown({ items: [S('oak_sapling', 9)], storeDir: second })
  await tend(seed.bot)
  const rec2 = BP.readRecord(second, 'treefarm-0_64_0').record
  const over2 = {}
  for (const c of TF.plotsOf(rec2)) over2[K(c.x, c.y, c.z)] = 'cobblestone'
  const poor = fakeTown({ items: [S('oak_sapling', 2)], over: over2, storeDir: second })
  assert.equal(SK.townFarmPlan(poor.bot), null, 'a dead farm and too few saplings to found another: no order')
})

await t('place make-room never digs a farm plot column to set a station there (Codex r1)', async () => {
  const idx = TF.farmIndex({ cells: [{ x: 1, y: 64, z: 0, role: 'plot' }] })
  const over = {}
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = 62; y <= 66; y++) if (!(dx === 0 && dz === 0 && (y === 64 || y === 65))) over[K(dx, y, dz)] = 'stone'
  over[K(1, 64, 0)] = 'oak_log'
  const town = fakeTown({ items: [S('crafting_table', 1)], over })
  town.bot.entity.position = new Vec3(0.5, 64, 0.5)
  town.bot.farmIndexNow = () => idx
  const r = await SK.SKILLS.place.run({ bot: town.bot }, { item: 'crafting_table' }, new AbortController().signal)
  assert.equal(town.w.nameAt(1, 64, 0), 'oak_log', `the farm trunk was dug (${r.status}: ${r.detail})`)
  assert.ok(!town.state.digs.some(d => d.at === '1,64,0'))
})

await t('SKILL tend_farm: a town where no farm fits fails once with farm_no_site (a long backoff), never a silent retry loop', async () => {
  const over = {}
  for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) over[K(x, 63, z)] = 'stone'
  const { bot, state } = fakeTown({ items: [S('oak_sapling', 9)], over })
  const r = await tend(bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'farm_no_site')
  assert.equal(state.places.length, 0)
  assert.equal(BP.readLease(process.env.POOL_STATE_DIR, 'treefarm-0_64_0').lease.released, true, 'the lease is released on the way out')
})

// ================================================================ the guards other code asks ==================================

await t('roomVeto (place make-room, wear_out): a farm soil cell is never dug', () => {
  const idx = TF.farmIndex({ cells: [{ x: 10, y: 64, z: 10, role: 'plot' }] })
  const bot = { farmIndexNow: () => idx, blockAt: () => ({ name: 'stone' }) }
  assert.equal(SK.roomVeto(bot, new Vec3(10, 63, 10)), 'town_structure')
})

await t('place with coordinates on a plot column refuses with a remedy; the scan skips reserved cells', async () => {
  const { bot } = fakeTown({ items: [S('crafting_table', 1)] })
  const idx = TF.farmIndex({ cells: [{ x: 3, y: 64, z: 3, role: 'plot' }] })
  bot.farmIndexNow = () => idx
  const r = await SK.SKILLS.place.run({ bot }, { item: 'crafting_table', x: 3, y: 64, z: 3 }, new AbortController().signal)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'reserved_cell')
  assert.match(r.detail, /without coordinates picks another cell/)
})

await t('plantableSpotNear: never a farm walkway, but a farm plot is fine', () => {
  const idx = TF.farmIndex({ cells: [{ x: 4, y: 64, z: 4, role: 'plot' }, { x: 8, y: 64, z: 4, role: 'plot' }] })
  const w = world()
  const bot = { farmIndexNow: () => idx, entity: { position: new Vec3(6.5, 64, 4.5) },
                blockAt: p => { const n = w.nameAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return { name: n, position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) } } }
  const spot = SK.plantableSpotNear(bot, 2, 'oak_sapling')
  assert.ok(spot === null || (spot.x === 4 || spot.x === 8) && spot.z === 4, `planted in the walkway at ${JSON.stringify(spot)}`)
})

await t('the composter site search sees farm cells as occupied (reservationAwareRead)', () => {
  const idx = TF.farmIndex({ cells: [{ x: 10, y: 64, z: 10, role: 'plot' }] })
  const r = SK.reservationAwareRead(world().read, idx)
  assert.equal(r(10, 64, 10).name, 'reserved')
  assert.equal(r(10, 63, 10).name, 'reserved')
  assert.equal(r(11, 64, 10).name, 'air')
})

// ================================================================ wiring (source, comments stripped) ===========================

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
const INDEX = new URL('../src/index.mjs', import.meta.url)
const COG = new URL('../src/cognitive.mjs', import.meta.url)
function wiringIndex (src) {
  const s = strip(src)
  const brk = s.indexOf('moves.exclusionAreasBreak = [(block) => farmBreakCost(farmCells, block)]')
  const plc = s.indexOf('moves.exclusionAreasPlace = [(block) => farmPlaceCost(farmCells, block)]')
  const clone = s.indexOf('Object.assign(gatherMoves, moves)')
  return { brk, plc, clone, ok: brk > 0 && plc > 0 && clone > 0 && brk < clone && plc < clone }
}
await t('WIRED: index.mjs installs the farm break and place exclusions on the base profile BEFORE the clones share it', () => {
  const w = wiringIndex(readFileSync(INDEX, 'utf8'))
  assert.ok(w.ok, JSON.stringify(w))
})
await t('WIRED: tend_farm is a registered, chat-only housekeeping skill with a world_change contract; cognitive issues and scores it', () => {
  assert.equal(typeof SK.SKILLS.tend_farm?.run, 'function'); assert.equal(SK.SKILLS.tend_farm.chatOnly, true)
  assert.deepEqual(SK.SKILL_CONTRACTS.tend_farm.expects, ['world_change'])
  assert.equal(isHousekeeping('tend_farm'), true)
  const s = strip(readFileSync(COG, 'utf8'))
  assert.ok(/farmOrder\(\{[^]*?plan: \(\) => townFarmPlan\(bot\)/.test(s), 'cognitive asks farmOrder with the farm plan')
  assert.ok(s.includes('this.farmState = farmOrderOutcome(admitted.skill'), 'cognitive records the outcome')
})

async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} not found. A mutant that was never written reads as killed.`)
  assert.equal(src.split(old).length, 2, 'the mutation target is not unique')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(out, body) } finally { try { unlinkSync(out) } catch {} }
}
await t('MUTANT KILLED: the exclusions moved below the gather clone fail the wiring test', async () => {
  const brk = '    moves.exclusionAreasBreak = [(block) => farmBreakCost(farmCells, block)]\n'
  await withMutant(INDEX, brk, '', async (_u, body) => {
    const moved = body.replace('    Object.assign(gatherMoves, moves)\n', `    Object.assign(gatherMoves, moves)\n${brk}`)
    assert.equal(wiringIndex(moved).ok, false)
  })
})
await t('MUTANT KILLED: a witness that trusted the client (no packet needed) counts ghost plants', async () => {
  await withMutant(new URL('../src/blueprint.mjs', import.meta.url),
    "  if (!Array.isArray(seen) || !seen.length) return 'silent'\n",
    "  if (!Array.isArray(seen) || !seen.length) return 'confirmed'\n",
    async u => {
      const M = await import(u.href)
      assert.equal(M.witnessVerdict([], 'oak_sapling'), 'confirmed', 'the mutant reproduces the defect the real one refuses')
      assert.equal(BP.witnessVerdict([], 'oak_sapling'), 'silent')
    })
})
await t('MUTANT KILLED: a lease decision that ignores expiry lets two builders in', async () => {
  await withMutant(new URL('../src/blueprint.mjs', import.meta.url),
    "  if (lease.released || !(Number(lease.until) > now)) return { ok: true, holder: lease.holder ?? null, until: lease.until ?? 0 }\n  return { ok: false, holder: lease.holder ?? '?', until: lease.until }",
    "  return { ok: true, holder: lease.holder ?? null, until: lease.until ?? 0 }",
    async u => {
      const M = await import(u.href)
      assert.equal(M.leaseDecision({ lease: { holder: 'A', until: 5000 }, me: 'B', now: 1000 }).ok, true)
      assert.equal(BP.leaseDecision({ lease: { holder: 'A', until: 5000 }, me: 'B', now: 1000 }).ok, false)
    })
})
await t('MUTANT KILLED: a plot state that treats leaves as an obstruction never replants a harvested plot in a standing farm', async () => {
  await withMutant(new URL('../src/treefarm.mjs', import.meta.url),
    "    if (isLeaves(b.name)) { leaves = true; continue }",
    "    if (isLeaves(b.name)) { if (!foreign) foreign = b.name; continue }",
    async u => {
      const M = await import(u.href)
      const w = world({ [K(20, 69, 20)]: 'birch_leaves' })
      assert.equal(M.plotState(w.read, { x: 20, y: 64, z: 20 }).state, 'column_foreign')
      assert.equal(TF.plotState(w.read, { x: 20, y: 64, z: 20 }).state, 'ready')
    })
})
await t('MUTANT KILLED: a plan that ignores what the bag holds would plant a species the bot does not have', async () => {
  await withMutant(new URL('../src/treefarm.mjs', import.meta.url),
    "    const sp = (s.species ?? []).filter(n => (left[n] ?? 0) > 0).sort(",
    "    const sp = (s.species ?? []).sort(",
    async u => {
      const M = await import(u.href)
      const states = [{ plot: { x: 0, y: 64, z: 0 }, state: 'ready', species: ['birch_sapling'] }]
      assert.equal(M.tendPlan({ states, held: { oak_sapling: 1 } }).actions[0]?.item, 'birch_sapling', 'the mutant plants what is not held')
      assert.equal(TF.tendPlan({ states, held: { oak_sapling: 1 } }).actions.length, 0)
    })
})
await t('MUTANT KILLED: dropping the gather soil filter lets `gather dirt` target a plot\'s soil', async () => {
  const SKP = new URL('../src/skills.mjs', import.meta.url)
  const line = "      .filter(p => !farmNoDig(farmIdx(bot), p.x, p.y, p.z))\n    let viaSource = null"
  const src = strip(readFileSync(SKP, 'utf8'))
  assert.ok(src.includes(line.split('\n')[0].trim()), 'the filter is on the executable gather target line')
  await withMutant(SKP, line, '    let viaSource = null', async (_u, body) => {
    assert.equal(strip(body).includes('.filter(p => !farmNoDig(farmIdx(bot), p.x, p.y, p.z))\n    let viaSource'), false)
  })
})

try { rmSync(LOG_DIR, { recursive: true, force: true }) } catch {}
for (const f of readdirSync(new URL('.', import.meta.url))) if (f.startsWith(`_mutant-${process.pid}-`)) { try { unlinkSync(new URL(`./${f}`, import.meta.url)) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) console.log('FAILED:\n  ' + failed.join('\n  '))
process.exit(fail ? 1 : 0)
