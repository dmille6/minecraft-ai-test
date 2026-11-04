// BAMBOOWALK-01 (2026-11-04): THE CLIENT SEES THE SERVER'S BAMBOO POST.
//
// LIVE fleet 11-01 10Z..11-04 10Z (72 h, 80 bots, full walk): 340 of 3,134 `_reflex_stuck` bodies (10.8%) had bamboo in the
// 3x3 around the feet, against 24 of 1,969 random positioned rows (1.2%); 214 stuck spells, 433 bot-min. The worst single site,
// board-d's monument dig walk, stopped 71 times at exactly (338.0, 71, 114.0); 169 more bodies were stuck with a bamboo stalk in
// their own feet cell, 13 of 15 sampled pressed against that cell's REAL post.
//
// WHY. minecraft-data 1.21.8 gives every bamboo state ONE collision box, [0.15625,0,0.15625,0.34375,1,0.34375]: the vanilla post
// (BambooStalkBlock box 6.5..9.5/16) moved by the XZ offset of block (0,0), which is (-0.25,-0.25). Vanilla moves the post by
// each block's OWN offset (offsetType XZ, Mth.getSeed(x,0,z)), anywhere in +-0.25. So mineflayer's physics walks through the
// post the server has and stops at one the server does not; Paper's move check teleports a body that collides with something
// new back where it was (ServerGamePacketListenerImpl.handleMovePlayer, isPlayerCollidingWithAnythingNew), and the pathfinder
// sees a bot that does not move: `_path_reset stuck` every 3.5 s, the stuck reflex at 35 s, the same spot next visit.
// Upstream: prismarine-block #125 (2026-10-03) added the same offset to INTERACTION shapes and left collision as it was;
// prismarine-physics reads `block.shapes` as given (index.js getSurroundingBBs) through `bot.blockAt` (mineflayer physics.js:19).
//
// THE CHANGE: a mineflayer plugin wraps `bot.blockAt` once; a returned bamboo carries its shapes moved from the baked offset to
// its true one. Nothing else is touched: y is unchanged (the pathfinder's heights, every full-cube test), the world's raycasts
// (bot.world.getBlock) are not wrapped, and the registry's shared arrays are never written (a fresh array per block read).
// The pathfinder still treats bamboo as a solid cell (boundingBox 'block'); only the body's collision moves.
// BAMBOOWALK=0 (or off/false/no) is the rollback: the plugin installs nothing, exactly the base.

/** Blocks whose collision minecraft-data baked at the origin's offset -> the block's vanilla max horizontal offset. The range
 *  ((n/15) - 0.5) * 0.5 is +-0.25, so bamboo (0.45 in vanilla) is never clamped. pointed_dripstone (0.125) has the same defect
 *  and is NOT here: this canary is bamboo only. */
export const OFFSET_BLOCKS = Object.freeze({ bamboo: 0.25 })

export const bambooWalkOn = (env = process.env) => !['0', 'off', 'false', 'no'].includes(String(env?.BAMBOOWALK ?? '').trim().toLowerCase())

const M64 = (1n << 64n) - 1n
/** Java's Mth.getSeed(x, 0, z) as a signed 64-bit BigInt: `(long)(x * 3129871)` overflows as an INT first, `(long)z * 116129781L`
 *  as a long, then `i * i * 42317861L + i * 11L` wraps at 64 bits, and `>> 16` is arithmetic. Pure. */
export function blockSeed (x, z) {
  let i = BigInt.asIntN(64, BigInt(Math.imul(x | 0, 3129871)) ^ BigInt.asIntN(64, BigInt(z | 0) * 116129781n))
  i = BigInt.asIntN(64, (i * i * 42317861n + i * 11n) & M64)
  return i >> 16n
}

/** Vanilla's XZ offset of the block at (x, z) -> [dx, dz]: `(double)((float)(n & 15) / 15F) - 0.5) * 0.5`, clamped to +-max. Pure. */
export function xzOffset (x, z, max = 0.25) {
  const s = blockSeed(x, z)
  const f = sh => Math.fround(Math.fround(Number((s >> sh) & 15n)) / 15)
  const c = v => Math.max(-max, Math.min(max, v))
  return [c((f(0n) - 0.5) * 0.5), c((f(8n) - 0.5) * 0.5)]
}

const memo = new Map()
const MEMO_MAX = 8192
function shiftFor (name, x, z) {
  const k = `${name}|${x}|${z}`
  let v = memo.get(k)
  if (v) return v
  const max = OFFSET_BLOCKS[name]
  const [bx, bz] = xzOffset(0, 0, max)      // the offset minecraft-data baked in (block 0,0)
  const [tx, tz] = xzOffset(x, z, max)
  v = [tx - bx, tz - bz]
  if (memo.size >= MEMO_MAX) memo.clear()
  memo.set(k, v)
  return v
}

/**
 * The collision boxes of `name` at block (x, z) as the server has them -> a FRESH array of fresh boxes, or null (not an offset
 * block, or no boxes). `shapes` is minecraft-data's (baked at block 0,0) and is never written. Pure.
 */
export function trueShapes (name, shapes, x, z) {
  if (OFFSET_BLOCKS[name] === undefined || !Array.isArray(shapes) || !shapes.length) return null
  const [dx, dz] = shiftFor(name, Math.floor(x), Math.floor(z))
  return shapes.map(s => [s[0] + dx, s[1], s[2] + dz, s[3] + dx, s[4], s[5] + dz])
}

/** Fix one Block read in place (its own `shapes` property only; the Block is a fresh object per read) -> the same block. Never
 *  throws: it runs inside the physics tick. */
export function fixBlock (b) {
  try {
    if (b && OFFSET_BLOCKS[b.name] !== undefined && b.position) {
      const s = trueShapes(b.name, b.shapes, b.position.x, b.position.z)
      if (s) b.shapes = s
    }
  } catch { /* the block as read */ }
  return b
}

/** `blockAt` wrapped: every argument passed through, null passed back, a bamboo's shapes moved. Idempotent. */
export function wrapBlockAt (orig) {
  if (typeof orig !== 'function' || orig.bambooWalk) return orig
  const w = function (...args) { return fixBlock(orig.apply(this, args)) }
  w.bambooWalk = true
  return w
}

/**
 * THE PLUGIN (bot.loadPlugin): mineflayer injects plugins in load order after login, so the internal `blocks` plugin has defined
 * bot.blockAt by the time this runs, and physics and the pathfinder look `bot.blockAt` up on every call. -> true if installed.
 */
export function bambooWalkPlugin (bot, _opts, env = process.env) {
  if (!bambooWalkOn(env) || !bot || typeof bot.blockAt !== 'function') return false
  bot.blockAt = wrapBlockAt(bot.blockAt)
  bot.bambooWalk = true
  return true
}

/** The licence row's detail (`_bamboowalk_mode`, once per spawn). */
export const bambooWalkModeDetail = (bot, env = process.env) =>
  `on=${bambooWalkOn(env) ? 1 : 0} wrapped=${bot?.blockAt?.bambooWalk ? 1 : 0} blocks=${Object.keys(OFFSET_BLOCKS).join('|')} rollback=BAMBOOWALK=0`
