#!/usr/bin/env node
// wellsite-replay.mjs -- the junk well's site search replayed OFFLINE on a world's real terrain (wellsite-01 evidence).
//
//   node scripts/wellsite-replay.mjs <region.mca> <homeX,homeY,homeZ> [composterX,composterZ] [--well x,y,z,facing ...]
//
// The region file is a READ-ONLY copy (scp from the world host; no world command runs). Its chunks are decoded into a
// read(x,y,z) shaped exactly like skills.mjs readWellCell (prismarine-block 1.21.8: name, boundingBox, shapes, hardness,
// props) and the REAL well.mjs functions run on it: canonicalWellSite with the bot's avoid list (the composter record,
// every chest/barrel within ADOPT_RADIUS + 8 of home), its tally, and each criterion judged INDEPENDENTLY per candidate.
// --well prints wellBreach / containmentRefusal for a built well.
// Validated 10-13: 10/10 cells against read-only RCON `execute if block` on board-a (negative control failed as it
// should); the 5 live wells read intact and placebo-d's retired one breached. The world may be up to one autosave behind.
import fs from 'node:fs'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import * as W from '../src/well.mjs'
// Runs against whichever well.mjs is checked out: the tally exists from wellsite-01 on, and is '-' before it.
const { canonicalWellSite, wellStage, wellStand, fullCube, wellBreach, containmentRefusal, wellIdentity,
        WELL_HOME_CLEARANCE, WELL_SEARCH_RADIUS, UNDERGROUND_RING, LIQUID_CLEARANCE, WELL_CONTAINER_DISTANCE } = W
const tallyText = W.tallyText ?? (() => '-')
import { townDistance, ADOPT_RADIUS, CLEARANCE_CONTAINER } from '../src/composter.mjs'
const require = createRequire(import.meta.url)
const nbt = require('prismarine-nbt')
const Block = require('prismarine-block')(require('prismarine-registry')('1.21.8'))

export function loadRegion (file) {
  const buf = fs.readFileSync(file), chunks = new Map()
  for (let i = 0; i < 1024; i++) {
    const loc = buf.readUInt32BE(i * 4), off = (loc >>> 8) * 4096
    if (!off || !(loc & 255)) continue
    const len = buf.readUInt32BE(off), comp = buf[off + 4], data = buf.subarray(off + 5, off + 4 + len)
    let root
    try { root = nbt.simplify(nbt.parseUncompressed(comp === 2 ? zlib.inflateSync(data) : comp === 1 ? zlib.gunzipSync(data) : data, 'big')) } catch { continue }
    if (root.Status && !/full$/.test(root.Status)) continue
    const secs = new Map()
    for (const s of root.sections ?? []) if (s.block_states?.palette) secs.set(s.Y, { palette: s.block_states.palette, data: s.block_states.data ?? null })
    chunks.set(`${root.xPos},${root.zPos}`, secs)
  }
  return chunks
}
const cache = new Map()
function blockFor (e) {
  const props = e.Properties ?? {}, key = e.Name + JSON.stringify(props)
  if (!cache.has(key)) {
    const name = e.Name.replace(/^minecraft:/, '')
    const blk = Block.fromString(Object.keys(props).length ? `${name}[${Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',')}]` : name, 0)
    let p = null; try { p = blk.getProperties() } catch { p = null }
    cache.set(key, { name: blk.name, boundingBox: blk.boundingBox, shapes: blk.shapes, hardness: blk.hardness ?? null, props: p })
  }
  return cache.get(key)
}
/** read(x,y,z) -> cell | null (a chunk or section not in the file). 1.18+ packing: entries never span longs. */
export function reader (chunks) {
  return (x, y, z) => {
    const s = chunks.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`)?.get(Math.floor(y / 16))
    if (!s) return null
    if (s.palette.length === 1 || !s.data) return blockFor(s.palette[0])
    const bits = Math.max(4, Math.ceil(Math.log2(s.palette.length))), per = Math.floor(64 / bits)
    const idx = (((y % 16) + 16) % 16) * 256 + (((z % 16) + 16) % 16) * 16 + (((x % 16) + 16) % 16)
    const [hi, lo] = s.data[Math.floor(idx / per)]
    const v = (BigInt.asUintN(32, BigInt(hi)) << 32n) | BigInt.asUintN(32, BigInt(lo))
    return blockFor(s.palette[Number((v >> BigInt((idx % per) * bits)) & ((1n << BigInt(bits)) - 1n))])
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, homeArg, compArg, ...rest] = process.argv.slice(2)
  if (!file || !homeArg) { console.error('usage: wellsite-replay.mjs <region.mca> <x,y,z> [compX,compZ] [--well x,y,z,facing ...]'); process.exit(2) }
  const read = reader(loadRegion(file))
  const [hx, hy, hz] = homeArg.split(',').map(Number), home = { x: hx, y: hy, z: hz }
  const r = WELL_HOME_CLEARANCE, R = ADOPT_RADIUS + r + 1, avoid = []
  if (compArg && !compArg.startsWith('--')) { const [cx, cz] = compArg.split(',').map(Number); avoid.push({ x: cx, z: cz, r, what: 'the composter site' }) }
  const bank = []
  for (let x = hx - R; x <= hx + R; x++) for (let z = hz - R; z <= hz + R; z++) for (let y = hy - R; y <= hy + R; y++) {
    const d = Math.hypot(x - hx, y - hy, z - hz); if (d > R) continue
    const b = read(x, y, z); if (b && /^(chest|trapped_chest|barrel)$/.test(b.name)) bank.push({ x, z, d })
  }
  bank.sort((a, b) => a.d - b.d); for (const p of bank.slice(0, 64)) avoid.push({ x: p.x, z: p.z, r, what: 'a bank container' })
  const res = canonicalWellSite({ home, read, avoid })
  console.log(`home ${homeArg}: ${res.site ? `site ${JSON.stringify(res.site)}` : `no site (exhausted=${res.exhausted}: ${res.why})`} tally=${tallyText(res.tally)} | bank containers within ${R}: ${bank.length}`)
  // every criterion judged independently, per candidate (the first refusal hides the others)
  const LIQ = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/
  const NG = /(sand$|gravel$|concrete_powder$|anvil$|^scaffolding$|^pointed_dripstone$|^snow$|_leaves$|^ice$|^packed_ice$|^blue_ice$|_trapdoor$|_door$|_gate$|^chest$|^trapped_chest$|^barrel$|^composter$|^crafting_table$|furnace$|^smoker$|^hopper$|shulker_box$|^bedrock$|^spawner$|_bed$)/
  const ground = b => fullCube(b) && !NG.test(b?.name ?? '') && !LIQ.test(b?.name ?? '')
  const passable = b => !!b && b.boundingBox === 'empty' && !LIQ.test(b.name ?? '')
  const any = {}; let cands = 0, pass = 0
  for (let rr = WELL_HOME_CLEARANCE; rr <= WELL_SEARCH_RADIUS; rr++) for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== rr) continue
    const x = hx + dx, z = hz + dz
    let cap = null
    for (let y = hy + 8; y >= hy - 8; y--) { const c = read(x, y, z), u = read(x, y - 1, z); if (passable(c) && u?.boundingBox === 'block') { cap = { x, y: y - 1, z }; break } }
    if (!cap || townDistance(home, { x, y: cap.y + 1, z }) > ADOPT_RADIUS) continue
    const g = cap.y, f = []
    if (!(passable(read(x, g + 1, z)) && passable(read(x, g + 2, z)))) f.push('open')
    if (['invalid', 'built'].includes(wellStage(read, cap))) f.push('column')
    if (!ground(read(x, g - 2, z))) f.push('floor')
    let w = false, ring = false, liq = false, cont = false
    for (let dy = 0; dy >= -1; dy--) for (let ex = -1; ex <= 1; ex++) for (let ez = -1; ez <= 1; ez++) if ((ex || ez) && !ground(read(x + ex, g + dy, z + ez))) w = true
    for (let dy = -1; dy >= -3; dy--) for (let ex = -UNDERGROUND_RING; ex <= UNDERGROUND_RING; ex++) for (let ez = -UNDERGROUND_RING; ez <= UNDERGROUND_RING; ez++) { if (!ex && !ez) continue; const b = read(x + ex, g + dy, z + ez); if (!fullCube(b) || LIQ.test(b?.name ?? '')) ring = true }
    for (let dy = -1; dy <= 2; dy++) for (let ex = -LIQUID_CLEARANCE; ex <= LIQUID_CLEARANCE; ex++) for (let ez = -LIQUID_CLEARANCE; ez <= LIQUID_CLEARANCE; ez++) if (LIQ.test(read(x + ex, g + dy, z + ez)?.name ?? '')) liq = true
    for (let ex = -2; ex <= 2; ex++) for (let ez = -2; ez <= 2; ez++) for (let dy = -2; dy <= 2; dy++) { const b = read(x + ex, g + 1 + dy, z + ez); if (Math.hypot(ex, dy, ez) < WELL_CONTAINER_DISTANCE && (CLEARANCE_CONTAINER.test(b?.name ?? '') || b?.name === 'composter')) cont = true }
    if (w) f.push('walls'); if (ring) f.push('ring'); if (liq) f.push('liquid'); if (cont) f.push('container')
    if (!wellStand(read, cap)) f.push('stand')
    cands++; if (!f.length) pass++
    for (const q of f) any[q] = (any[q] ?? 0) + 1
  }
  console.log(`candidates ${cands}, pass every criterion ${pass} (avoid not applied); failing each, independently: ${Object.entries(any).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${(100 * v / cands).toFixed(1)}%)`).join(', ')}`)
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== '--well') continue
    const [x, y, z, facing] = rest[++i].split(','), cap = { x: +x, y: +y, z: +z }
    console.log(`well ${x},${y},${z}: identity=${JSON.stringify(wellIdentity(read, cap))} breach=${wellBreach(read, cap, facing)} containment=${containmentRefusal(read, cap)}`)
  }
}
