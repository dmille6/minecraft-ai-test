// BRIDGEPOST-01: THE BRIDGE BUILDER'S ACTUATOR over a mineflayer bot (bridge.mjs buildBridge's `io`). ONE copy, used by the bot
// (skills.mjs expeditionVisit, its walk = the bots' goto) and by the Paper proof (sandbox/bridge/bridge.mjs, its walk = bare
// pathfinder with the bots' walk profile), so the proof exercises the placement code that ships.
//
// A placement: never into a cell another body (a bot, a squid, any living entity) or the builder's own body overlaps (vanilla refuses
// a block an entity collides with); the item held; the bot looks at the reference face's centre; ONE bot.placeBlock(ref, face)
// bounded by PLACE_MS (it waits on a server blockUpdate that may never come); then the cell is READ BACK (placeBlock can resolve with
// nothing placed: a chunk unload). No sneak: the builder stands on the centre of the deck cell behind the new one and never walks
// to an edge.

export const PLACE_MS = 3_000
export const READBACK_MS = 1_000
export const LOOK_SETTLE_MS = 60
import { designDone } from './bridgedesign.mjs'   // bridges-01
// bridges-01: the block_place direction of a face normal (down, up, north, south, west, east), as buildbot.mjs writes it
const FACE_DIR = f => (f[1] < 0 ? 0 : f[1] > 0 ? 1 : f[2] < 0 ? 2 : f[2] > 0 ? 3 : f[0] < 0 ? 4 : 5)
const NO_BODY = /^(item|experience_orb|arrow|spectral_arrow|trident|snowball|egg|ender_pearl|fishing_bobber|marker|area_effect_cloud|text_display|item_display|block_display|interaction)$/

/** Does an entity's box (feet position, width, height) overlap the block cell [x, y, z]? Pure. */
export function bodyOverlaps (e, cell, pad = 0.001) {
  if (!e?.position) return false
  const w = (Number(e.width) || 0.6) / 2, h = Number(e.height) || 1.8
  const [x, y, z] = cell
  return e.position.x + w > x + pad && e.position.x - w < x + 1 - pad && e.position.z + w > z + pad && e.position.z - w < z + 1 - pad &&
    e.position.y + h > y + pad && e.position.y < y + 1 - pad
}

export function bridgeIo (bot, { Vec3, walkTo, sleep = ms => new Promise(r => setTimeout(r, ms)), aborted = () => false, torchOk = () => true, onPlace = () => {} } = {}) {
  const read = (x, y, z) => {
    const b = bot.blockAt?.(new Vec3(x, y, z))
    if (!b) return null
    let wl = false
    try { wl = b.getProperties?.()?.waterlogged === true } catch { wl = false }
    // bridges-01: the block's properties ride along, read only when asked (a designed stair's facing and half, a log's axis)
    return { name: b.name, boundingBox: b.boundingBox, waterlogged: wl, get props () { try { return b.getProperties?.() ?? null } catch { return null } } }
  }
  const feet = () => { const p = bot.entity.position; return [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)] }
  const has = n => (bot.inventory?.items?.() ?? []).filter(i => i?.name === n).reduce((a, i) => a + (i.count ?? 0), 0)
  const bodyIn = cell => {
    if (bodyOverlaps(bot.entity, cell)) return 'self'
    for (const e of Object.values(bot.entities ?? {})) {
      if (!e || e === bot.entity || NO_BODY.test(String(e.name ?? ''))) continue
      if (bodyOverlaps(e, cell)) return String(e.username ?? e.name ?? 'entity')
    }
    return null
  }
  const place = async step => {
    const who = bodyIn(step.cell)
    if (who) { onPlace(step, false, `body:${who}`); return false }
    const stack = (bot.inventory?.items?.() ?? []).find(i => i?.name === step.item)
    if (!stack) { onPlace(step, false, 'no_item'); return false }
    try { if (bot.heldItem?.name !== step.item) await bot.equip(stack, 'hand') } catch { onPlace(step, false, 'equip'); return false }
    const ref = bot.blockAt(new Vec3(...step.ref))
    if (!ref) { onPlace(step, false, 'ref_unread'); return false }
    const [fx, fy, fz] = step.face
    try { await bot.lookAt(ref.position.offset(0.5 + fx * 0.5, 0.5 + fy * 0.5, 0.5 + fz * 0.5), true) } catch { /* not fatal */ }
    await sleep(LOOK_SETTLE_MS)   // one tick for the server to hold the new look before the click
    let err = null
    // bridges-01: A DESIGNED STEP'S AIMED CLICK (townstyle.mjs orientAim): the yaw its state needs goes to the server as its OWN look
    // packet immediately before the block_place, in the same synchronous write (mineflayer's lookAt only queues a look for the next
    // physics tick), and the cursor sits where the state's half needs it (buildbot.mjs botBuildEffects `send`, the same two packets)
    if (step.d && step.aim) {
      const cur = Array.isArray(step.aim.cursor) ? step.aim.cursor : [0.5 + fx * 0.5, 0.5 + fy * 0.5, 0.5 + fz * 0.5]
      try {
        const onGround = !!bot.entity?.onGround
        if (Number.isFinite(step.aim.yaw)) bot._client.write('look', { yaw: step.aim.yaw, pitch: Math.fround((-(Number(bot.entity?.pitch) || 0) * 180) / Math.PI), onGround, flags: { onGround, hasHorizontalCollision: false } })
        bot._client.write('block_place', { location: ref.position, direction: FACE_DIR(step.face), hand: 0, cursorX: cur[0], cursorY: cur[1], cursorZ: cur[2], insideBlock: false, worldBorderHit: false, sequence: 0 })
        try { bot.swingArm?.('right') } catch { /* cosmetic */ }
      } catch (e) { err = String(e?.message ?? e).slice(0, 60) }
      for (const until = Date.now() + PLACE_MS; !designDone(read(...step.cell), step) && Date.now() < until;) await sleep(100)
      const ok = designDone(read(...step.cell), step)
      onPlace(step, ok, ok ? null : (err ?? (read(...step.cell)?.name === step.item ? 'state' : 'not_landed')))
      return ok
    }
    // twice at most: a stack used up on the last click leaves the hand empty a moment (Paper proof 11-03, 32 wide: "must be holding an
    // item to place" once per 64 blocks) -- the next stack is equipped and the click sent again
    for (let k = 0; k < 2; k++) {
      err = null
      const p = bot.placeBlock(ref, new Vec3(fx, fy, fz))
      p.catch(() => {})
      try { await Promise.race([p, sleep(PLACE_MS).then(() => { throw new Error('place_timeout') })]) } catch (e) { err = String(e?.message ?? e).slice(0, 60) }
      if (!/holding/.test(err ?? '')) break
      const next = (bot.inventory?.items?.() ?? []).find(i => i?.name === step.item)
      if (!next) break
      try { await bot.equip(next, 'hand'); await bot.lookAt(ref.position.offset(0.5 + fx * 0.5, 0.5 + fy * 0.5, 0.5 + fz * 0.5), true); await sleep(LOOK_SETTLE_MS) } catch { break }
    }
    const want = step.kind === 'torch' ? b => /torch$/.test(b?.name ?? '') : b => b?.boundingBox === 'block'
    for (const until = Date.now() + READBACK_MS; !want(read(...step.cell)) && Date.now() < until;) await sleep(100)
    const ok = want(read(...step.cell))
    onPlace(step, ok, ok ? null : (err ?? 'not_landed'))
    return ok
  }
  // bridges-01: dig one of the bridge's own misoriented blocks (bridge.mjs buildBridge `fix`) -> bool (the cell clear again)
  const dig = async cell => {
    try { const b = bot.blockAt(new Vec3(...cell)); if (!b || b.boundingBox !== 'block') return true; await bot.dig(b, true) } catch { return false }
    for (const until = Date.now() + READBACK_MS; read(...cell)?.boundingBox === 'block' && Date.now() < until;) await sleep(100)
    return read(...cell)?.boundingBox !== 'block'
  }
  return { read, feet, has, place, dig, walkTo, inWater: () => !!bot.entity?.isInWater, now: () => Date.now(), aborted, torchOk, sleep }
}
