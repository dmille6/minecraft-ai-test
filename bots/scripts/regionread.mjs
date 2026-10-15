// regionread.mjs -- read-only region-file decoding for offline gates (copied from wellsite-replay.mjs loadRegion/reader, which
// is not on every base; validated 10-13 against read-only RCON, 10/10 cells). No world command runs.
import fs from 'node:fs'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
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

