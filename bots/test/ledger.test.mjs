// THE CHEST LEDGER (observe-only): identity, snapshots, writes, tombstones -- and that it can never break a transfer.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const registry = require('prismarine-registry')('1.21.8')
const Block = require('prismarine-block')(registry)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
process.env.LOG_DIR = process.env.LOG_DIR || path.join(tmp, 'logs')
const { containerKey, chestPartnerOffset, snapshotRecord, writeRecord, tombstoneGone, openObserved, closeObserved, __testing } = await import('../src/ledger.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// a real block with real properties at a position
function blk (name, pos, props = {}) {
  const def = registry.blocksByName[name]
  let b = Block.fromStateId(def.defaultState, 0)
  if (Object.keys(props).length) {
    for (let s = def.minStateId; s <= def.maxStateId; s++) {
      const c = Block.fromStateId(s, 0); const p = c.getProperties()
      if (Object.entries(props).every(([k, v]) => p[k] === v)) { b = c; break }
    }
  }
  b.position = new Vec3(pos.x, pos.y, pos.z)
  return b
}
function world (blocks) {
  const m = new Map(blocks.map(b => [`${b.position.x},${b.position.y},${b.position.z}`, b]))
  return p => { const f = p.floored(); return m.get(`${f.x},${f.y},${f.z}`) ?? blk('stone', f) }
}

await t('a double chest has ONE key from either half, for every facing', () => {
  for (const facing of ['north', 'south', 'east', 'west']) {
    const a = { x: 10, y: 64, z: 10 }
    const off = chestPartnerOffset(facing, 'left')
    const b = { x: a.x + off[0], y: 64, z: a.z + off[1] }
    const L = blk('chest', a, { facing, type: 'left' }), R = blk('chest', b, { facing, type: 'right' })
    const w = world([L, R])
    const k1 = containerKey(L, w), k2 = containerKey(R, w)
    assert.equal(k1.key, k2.key, facing); assert.equal(k1.double, true); assert.equal(k1.halves.length, 2)
  }
})
await t('LITERAL pairing (the real server, facing=north: left at x, right at x+1), and its rotations', () => {
  // A test that placed the partner with chestPartnerOffset itself could not fail (Claude review: swapping CW/CCW still
  // passed). These are literal: vanilla ChestBlock.getConnectedDirection, LEFT -> clockwise of facing.
  assert.deepEqual(chestPartnerOffset('north', 'left'), [1, 0]);  assert.deepEqual(chestPartnerOffset('north', 'right'), [-1, 0])
  assert.deepEqual(chestPartnerOffset('east', 'left'), [0, 1]);   assert.deepEqual(chestPartnerOffset('south', 'left'), [-1, 0])
  assert.deepEqual(chestPartnerOffset('west', 'left'), [0, -1]);  assert.equal(chestPartnerOffset('north', 'single'), null)
})
await t('an unvalidated neighbour is NEVER paired (wrong facing, same type, not a chest) -> own key, flagged', () => {
  const a = { x: 0, y: 64, z: 0 }; const off = chestPartnerOffset('north', 'left'); const b = { x: a.x + off[0], y: 64, z: a.z + off[1] }
  const L = blk('chest', a, { facing: 'north', type: 'left' })
  for (const partner of [blk('chest', b, { facing: 'south', type: 'right' }), blk('chest', b, { facing: 'north', type: 'left' }), blk('barrel', b)]) {
    const k = containerKey(L, world([L, partner]))
    assert.equal(k.double, false); assert.equal(k.unresolved, true); assert.equal(k.key, 'overworld:0,64,0')
  }
  const S = blk('chest', a, { facing: 'north', type: 'single' })
  assert.deepEqual([containerKey(S, world([S])).unresolved, containerKey(S, world([S])).double], [false, false])
})
await t('snapshotRecord: container slots only, totals, free, tool durability', () => {
  const slots = Array(27 + 36).fill(null)
  slots[0] = { name: 'cobblestone', count: 64 }; slots[1] = { name: 'cobblestone', count: 10 }
  slots[5] = { name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 2 }
  slots[40] = { name: 'diamond', count: 9 }                        // player inventory: not the chest
  const r = snapshotRecord({ inventoryStart: 27, slots }, { key: 'k', halves: [], name: 'chest', double: false }, { phase: 'open', observer: 'b', t: 5 })
  assert.deepEqual(r.items, { cobblestone: 74, stone_pickaxe: 1 }); assert.equal(r.free, 24)
  assert.deepEqual(r.tools, [{ name: 'stone_pickaxe', used: 2, max: 131 }]); assert.equal(r.provenance, 'initial-server')
})
await t('writeRecord: newer wins, atomic (no temp files left)', () => {
  const dir = path.join(tmp, 'w')
  assert.equal(writeRecord(dir, { key: 'k', t: 10, v: 'new' }), true)
  assert.equal(writeRecord(dir, { key: 'k', t: 5, v: 'old' }), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'k.json'), 'utf8')).v, 'new')
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), [])
})
await t('tombstones: a LOADED non-container is gone; an unloaded chunk and a live container are left alone', () => {
  const dir = path.join(tmp, 'tomb')
  for (const [k, x] of [['a', 1], ['b', 2], ['c', 3]]) writeRecord(dir, { key: `overworld:${x},64,0`, halves: [{ x, y: 64, z: 0 }], type: 'chest', t: 1 })
  const at = p => { const f = p.floored(); if (f.x === 1) return blk('air', f); if (f.x === 2) return null; return blk('chest', f) }
  const gone = tombstoneGone(dir, { x: 0, y: 64, z: 0 }, at, { t: 2 })
  assert.deepEqual(gone, ['overworld:1,64,0'])
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'overworld_1,64,0.json'), 'utf8')).gone, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'overworld_2,64,0.json'), 'utf8')).gone, undefined)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'overworld_3,64,0.json'), 'utf8')).gone, undefined)
})
const fakeBot = (currentWindow) => ({ registry, game: { dimension: 'overworld' }, blockAt: p => blk('stone', p.floored()), currentWindow })
await t('SUPERSEDED: a single chest that became half of a double, and a chest replaced by a barrel, are tombstoned', () => {
  const dir = path.join(tmp, 'sup')
  writeRecord(dir, { key: 'overworld:11,64,10', halves: [{ x: 11, y: 64, z: 10 }], type: 'chest', t: 1 })
  writeRecord(dir, { key: 'overworld:20,64,20', halves: [{ x: 20, y: 64, z: 20 }], type: 'chest', t: 1 })
  const L = blk('chest', { x: 10, y: 64, z: 10 }, { facing: 'north', type: 'left' }), R = blk('chest', { x: 11, y: 64, z: 10 }, { facing: 'north', type: 'right' })
  const B = blk('barrel', { x: 20, y: 64, z: 20 })
  const w = world([L, R, B])
  const gone = tombstoneGone(dir, { x: 10, y: 64, z: 10 }, w, { t: 2, radius: 16 })
  assert.deepEqual(gone.sort(), ['overworld:11,64,10', 'overworld:20,64,20'])
  const whys = ['overworld_11,64,10.json', 'overworld_20,64,20.json'].map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).why)
  assert.deepEqual(whys, ['superseded', 'replaced'])
})
await t('the SERVER snapshot survives the optimistic close record', () => {
  process.env.POOL_STATE_DIR = path.join(tmp, 'pool-srv')
  const chest = blk('chest', { x: 30, y: 64, z: 30 }, { facing: 'north', type: 'single' })
  const slots = Array(63).fill(null); slots[0] = { name: 'stick', count: 6 }
  const w = { inventoryStart: 27, slots, close () {} }
  const dir = path.join(tmp, 'srv')
  // the fake world is stone everywhere: the open's own sweep must still never tombstone the chest in hand
  assert.equal(__testing.record(fakeBot(w), w, chest, 'open', dir), true)
  slots[0] = { name: 'stick', count: 4 }                 // our withdraw, applied predictively
  assert.equal(__testing.record(fakeBot(w), w, chest, 'close', dir), true)
  const rec = JSON.parse(fs.readFileSync(path.join(dir, 'overworld_30,64,30.json'), 'utf8'))
  assert.deepEqual([rec.phase, rec.items.stick, rec.server_snapshot.items.stick], ['close', 4, 6])
  delete process.env.POOL_STATE_DIR
})
await t('a window that is not this block\'s (wrong size, or not the current window) is not recorded', () => {
  const dir = path.join(tmp, 'win')
  const chest = blk('chest', { x: 5, y: 64, z: 5 }, { facing: 'north', type: 'single' })
  const w3 = { inventoryStart: 3, slots: [] }, w27 = { inventoryStart: 27, slots: [] }
  assert.equal(__testing.record(fakeBot(w3), w3, chest, 'open', dir), false, 'a furnace-sized window on a chest')
  assert.equal(__testing.record(fakeBot({ other: 1 }), w27, chest, 'open', dir), false, 'not the current window')
  assert.equal(__testing.record(fakeBot(w27), w27, chest, 'open', dir), true)
})
await t('OBSERVE ONLY: a ledger that cannot write never breaks the open or the close', async () => {
  const asFile = path.join(tmp, 'not-a-dir'); fs.writeFileSync(asFile, 'x')
  process.env.POOL_STATE_DIR = asFile                      // mkdir under a file throws
  const chest = blk('chest', { x: 7, y: 64, z: 7 }, { facing: 'north', type: 'single' })
  let closed = 0
  const w = { inventoryStart: 27, slots: Array(63).fill(null), close: () => { closed++ } }
  const got = await openObserved(fakeBot(w), chest, async () => w)
  assert.equal(got, w, 'the caller gets its own window')
  closeObserved(fakeBot(w), w, chest)
  assert.equal(closed, 1, 'and the close still happens')
  const e = await openObserved(fakeBot(w), chest, async () => { throw new Error('boom') }).catch(x => x)
  assert.equal(e.message, 'boom', 'an open that fails still fails exactly as before')
  delete process.env.POOL_STATE_DIR
})
await t('an ABANDONED open is not recorded', async () => {
  process.env.POOL_STATE_DIR = path.join(tmp, 'pool-ab')
  const chest = blk('chest', { x: 9, y: 64, z: 9 }, { facing: 'north', type: 'single' })
  const w = { inventoryStart: 27, slots: Array(63).fill(null) }
  await openObserved(fakeBot(w), chest, async () => w, () => true)
  await new Promise(r => setTimeout(r, 10))
  const d = path.join(process.env.POOL_STATE_DIR, 'chest-ledger')
  assert.equal(fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).filter(f => String(f).endsWith('.json')).length : 0, 0)
  delete process.env.POOL_STATE_DIR
})
// STRUCTURAL: no container is opened except through openObserved (comments stripped: this codebase quotes code in them).
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
export function bypasses (src) {
  // WIDER (Claude review): any reference to a raw opener -- a call, a .bind alias, destructuring, bot['openContainer'] --
  // not on an openObserved line. (activateBlock is not a container opener in this codebase; it is not used in src/.)
  return strip(src).split('\n').filter(l => /\bopen(Container|Chest|Furnace|Block|Dispenser|Entity|Villager)\b/.test(l) && !/openObserved\(/.test(l))
}
await t('NO BYPASS: every container open in src/ goes through openObserved', () => {
  for (const f of fs.readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.mjs') && f !== 'ledger.mjs')) {
    const hits = bypasses(fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
    assert.equal(hits.length, 0, `${f}: ${hits.map(h => h.trim()).join(' | ')}`)
  }
})
await t('the NO-BYPASS check fails for the right reason (a raw open added = caught)', () => {
  const src = fs.readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8')
  assert.equal(bypasses(src + '\nconst w = await bot.openContainer(b)\n').length, 1)
  assert.equal(bypasses(src + '\n// bot.openContainer(b) in a comment\n').length, 0)
  assert.equal(bypasses('const o = bot.openContainer.bind(bot)\nconst { openChest } = bot\nbot["openFurnace"](b)').length, 3, 'aliases are caught too')
})
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
