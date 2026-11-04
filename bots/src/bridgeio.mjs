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
    return { name: b.name, boundingBox: b.boundingBox, waterlogged: wl }
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
  return { read, feet, has, place, walkTo, inWater: () => !!bot.entity?.isInWater, now: () => Date.now(), aborted, torchOk, sleep }
}
