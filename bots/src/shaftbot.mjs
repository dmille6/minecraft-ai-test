// THE SHAFT BUILDER'S EFFECTS ON A REAL BOT (shaft-01). The mechanics Paper proved (scratchpad zig5/shaftprobe.mjs, 12 levels,
// 24/24 ladders and 72/72 lining on the server): every dig and placement is looked at, paced 4 ticks (a click 0 ticks after
// the look was refused), gated synchronously, sent with forceLook 'ignore', and believed only after this client's world-sync
// barrier (buildbot.worldBarrier: the server's own ack, after its block broadcasts); movement INSIDE the shaft is manual --
// centre over a column and let the ladder carry the bot down onto the floor; climb holding forward toward the pad side (the
// -v lining is solid at every level, so the client keeps climbing) and out onto the entry pad. The pathfinder is never used
// inside the shaft (it would not step down onto a fresh ladder top).
import { Vec3 } from 'vec3'
import { worldBarrier } from './buildbot.mjs'
import { faceCentre, supportsFor, bk, isFullCube } from './builder.mjs'
import { withDigScope } from './digtown.mjs'

/** Ticks between a look and the click that follows it (Paper refused a click sent in the same tick as its look). */
export const LOOK_TICKS = 4
export const REACH = 4.5

/** A block as the shaft code reads it: name, collision class, collision shapes, a ladder's facing, full cube. */
export function shaftBlock (b) {
  if (!b) return null
  let props = null
  try { props = b.getProperties?.() ?? null } catch { props = null }
  return { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes ?? null, facing: b.name === 'ladder' ? (props?.facing ?? null) : null, props, full: isFullCube(b) }
}

/**
 * SHAPE-AWARE SIGHT (Paper finding (d): a ladder is a 3/16 plate on its wall, and the cell-level test refused a clear line
 * past one) -> boolean. Pure over read(). Samples every 0.02 along eye -> point (the last 2% excluded: the face itself);
 * a sample is blocked when it falls inside any collision shape of a solid block; `through` (bk keys) is ignored.
 */
export function sightShapes (read, eye, point, through = new Set()) {
  const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z
  const n = Math.max(2, Math.ceil(Math.hypot(dx, dy, dz) / 0.02))
  for (let i = 0; i <= n * 0.98; i++) {
    const t = i / n, px = eye.x + dx * t, py = eye.y + dy * t, pz = eye.z + dz * t
    const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz)
    if (through.has(bk(x, y, z))) continue
    const b = read(x, y, z)
    if (!b) return false
    if (b.boundingBox === 'empty') continue
    const lx = px - x, ly = py - y, lz = pz - z
    const shapes = Array.isArray(b.shapes) && b.shapes.length ? b.shapes : [[0, 0, 0, 1, 1, 1]]
    if (shapes.some(([x0, y0, z0, x1, y1, z1]) => lx > x0 - 1e-3 && lx < x1 + 1e-3 && ly > y0 - 1e-3 && ly < y1 + 1e-3 && lz > z0 - 1e-3 && lz < z1 + 1e-3)) return false
  }
  return true
}

/** Support faces in reach, VISIBLE ones first (E2: a non-visible face is accepted by the server) -> [{ ref, face, point, visible }]. Pure. */
export function rankedSupports (read, eye, cell, refs) {
  const out = []
  for (const s of refs) {
    const p = faceCentre(s.ref, s.face)
    if (Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z) > REACH) continue
    out.push({ ...s, point: p, visible: sightShapes(read, eye, p, new Set([bk(cell.x, cell.y, cell.z)])) })
  }
  return out.sort((a, b) => Number(b.visible) - Number(a.visible))
}
/** The clicks that may place into `cell` from `eye`, visible and in reach -> [{ ref, face, point }]. Pure. */
export function visibleSupports (read, eye, cell, refs = null) {
  const out = []
  for (const s of refs ?? supportsFor(read, cell)) {
    const p = faceCentre(s.ref, s.face)
    if (Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z) > REACH) continue
    if (!sightShapes(read, eye, p, new Set([bk(cell.x, cell.y, cell.z)]))) continue
    out.push({ ...s, point: p })
  }
  return out
}

/**
 * -> effects for the dig_shaft visit. `bound(promise, ms, what)` is the skill's await guard; `allowed(name)` the hand the barrier
 * may use (plain blocks, ladders, pickaxes: their air-use does nothing).
 */
export function shaftEffects (bot, { bound, aborted = () => false, allowed = () => false } = {}) {
  const read = (x, y, z) => { try { return shaftBlock(bot.blockAt(new Vec3(x, y, z))) } catch { return null } }
  const pos = () => bot.entity.position
  const eye = () => { const p = pos(); return { x: p.x, y: p.y + (bot.entity.eyeHeight ?? 1.62), z: p.z } }
  const ticks = n => bound(bot.waitForTicks?.(n) ?? new Promise(r => setTimeout(r, n * 50)), n * 50 + 2_000, 'tick wait')
  const sync = () => worldBarrier(bot, allowed)
  const equip = async name => {
    if (bot.heldItem?.name === name) return true
    const it = (bot.inventory?.items?.() ?? []).find(i => i.name === name)
    if (!it) return false
    try { await bound(bot.equip(it, 'hand'), 5_000, 'equip') } catch (e) { if (e?.aborted) throw e }
    return bot.heldItem?.name === name
  }
  const pickaxe = () => (bot.inventory?.items?.() ?? []).filter(i => /_pickaxe$/.test(i.name)).sort((a, b) => (b.maxDurability - (b.durabilityUsed ?? 0)) - (a.maxDurability - (a.durabilityUsed ?? 0)))[0] ?? null
  const effects = {
    read, pos, eye, sync,
    feet: () => { const p = pos(); return { x: Math.floor(p.x), y: Math.floor(p.y + 1e-6), z: Math.floor(p.z) } },
    /** other entities' feet within r of a point (players and mobs; items and orbs excluded) */
    bodiesNear: (pt, r = 2.5) => Object.values(bot.entities ?? {}).filter(e => e && e !== bot.entity && e.position && !['item', 'experience_orb'].includes(e.name) && e.position.distanceTo(new Vec3(pt.x, pt.y, pt.z)) < r).length,
    /**
     * ONE MUTATION, the contract enforced HERE (Codex shaft plan r2 P1-4): `mut` = { lock (stage 4's click lock for this shaft),
     * fence() (the build lease still held and this run still the runner's) } is REQUIRED. begin the lock -> the barrier ->
     * synced -> in ONE synchronous turn: the fence, the lock's acquire (record first, lease re-checked), the packet -> await the
     * packet's completion -> the barrier again -> the verdict read from this world. An unanswered barrier keeps the record
     * pending ('silent'); an unloaded cell is 'unknown', never 'confirmed'.
     */
    mutate: async (mut, cell, send, verdictOf) => {
      if (!mut?.lock || typeof mut.fence !== 'function') throw new Error('shaft mutation without a lock and a fence')
      if (mut.lock.begin()) return 'gate:busy'
      let ok = false
      try { ok = await sync() } catch (e) { mut.lock.release(cell, null); throw e }
      if (!ok) { mut.lock.release(cell, null); return 'gate:busy' }
      mut.lock.synced()
      if (aborted()) { mut.lock.release(cell, null); return 'gate:aborted' }
      if (!mut.fence()) { mut.lock.release(cell, null); return 'gate:fence' }
      if (mut.lock.acquire(cell)) { mut.lock.release(cell, null); return 'gate:busy' }
      let p, cancel = () => {}
      try { const r = send(); if (r && typeof r.then !== 'function' && r.promise) { p = r.promise; cancel = r.cancel ?? cancel } else p = r } catch { mut.lock.release(cell, 'error'); return 'error' }
      try { await p } catch (e) {
        // A DIG THAT OUTLIVED ITS GUARD (Codex code r1 P1-2): cancel it (stopDigging sends the abort) BEFORE the barrier, so the
        // barrier proves the server has seen the cancel; an abort cancels too and keeps the record pending
        try { cancel() } catch { /* not digging */ }
        if (e?.aborted || aborted()) { await sync().catch(() => false); mut.lock.release(cell, 'error'); throw e }
      }
      const done = await sync()
      const v = done ? verdictOf() : 'silent'
      mut.lock.release(cell, done && (v === 'confirmed' || v === 'refused') ? v : 'silent')
      return v
    },
    /** DIG ONE CELL -> 'confirmed' | 'refused' | 'silent' | 'unknown' | 'gate:<why>' (look, pace, then the mutation). */
    dig: async (mut, cell, by = 'dig_shaft') => {
      const b0 = bot.blockAt(new Vec3(cell.x, cell.y, cell.z))
      if (!b0) return 'unknown'
      if (b0.boundingBox !== 'block') return 'confirmed'
      const pk = pickaxe()
      if (pk && bot.heldItem?.name !== pk.name) { try { await bound(bot.equip(pk, 'hand'), 5_000, 'equip') } catch (e) { if (e?.aborted) throw e } }
      try { await bot.lookAt(new Vec3(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5), true) } catch { /* not fatal */ }
      await ticks(LOOK_TICKS)
      return effects.mutate(mut, cell, () => {
        const b = bot.blockAt(new Vec3(cell.x, cell.y, cell.z))
        if (!b || b.boundingBox !== 'block') return Promise.resolve()
        // nothing awaited before the dig's first packet: withDigScope runs synchronously into bot.dig, which with
        // forceLook 'ignore' writes block_dig in this turn
        return { promise: withDigScope(bot, { purpose: by === 'dig_shaft' ? 'target' : 'survival', by }, () => bound(bot.dig(b, 'ignore'), 15_000, 'digging')), cancel: () => bot.stopDigging?.() }
      }, () => { const after = bot.blockAt(new Vec3(cell.x, cell.y, cell.z)); return !after ? 'unknown' : after.boundingBox === 'empty' ? 'confirmed' : 'refused' })
    },
    /**
     * PLACE `name` INTO A CELL -> verdicts as dig. The click: a VISIBLE support face first, else any support face in reach (E2:
     * Paper accepted a click on a face the bot cannot see); none in reach -> 'gate:no_reach'; no solid neighbour -> 'gate:no_support'.
     */
    place: async (mut, cell, name, refs = null) => {
      if (!(await equip(name))) return 'gate:no_material'
      const all = refs ?? supportsFor(read, cell)
      if (!all.length) return 'gate:no_support'
      const e = eye()
      const opts = rankedSupports(read, e, cell, all)
      if (!opts.length) return 'gate:no_reach'
      const { ref, face, point } = opts[0]
      try { await bot.lookAt(new Vec3(point.x, point.y, point.z), true) } catch { /* not fatal */ }
      await ticks(LOOK_TICKS)
      if (bot.heldItem?.name !== name) return 'gate:not_held'
      return effects.mutate(mut, cell, () => {
        const rb = bot.blockAt(new Vec3(ref.x, ref.y, ref.z))
        if (!rb || rb.boundingBox !== 'block') throw new Error('support changed')
        // _genericPlace with forceLook 'ignore' writes block_place in this synchronous turn (buildbot.mjs's note)
        const p = typeof bot._placeBlockWithOptions === 'function'
          ? bot._placeBlockWithOptions(rb, new Vec3(face[0], face[1], face[2]), { swingArm: 'right', forceLook: 'ignore' })
          : bot.placeBlock(rb, new Vec3(face[0], face[1], face[2]))
        return Promise.resolve(p).catch(() => { /* mineflayer's own wait for the update times out on a refusal: the barrier decides */ })
      }, () => { const after = bot.blockAt(new Vec3(cell.x, cell.y, cell.z)); return !after ? 'unknown' : after.name === name ? 'confirmed' : 'refused' })
    },
    /** CENTRE OVER A COLUMN (x, z) -> boolean: walk with sneak near the centre; never jumps. */
    centreOver: async (cell, ms = 6_000) => {
      const end = Date.now() + ms
      try {
        while (Date.now() < end) {
          if (aborted()) return false
          const p = pos(), dx = cell.x + 0.5 - p.x, dz = cell.z + 0.5 - p.z
          if (Math.abs(dx) < 0.12 && Math.abs(dz) < 0.12) break
          await bot.lookAt(new Vec3(cell.x + 0.5, p.y + 1.62, cell.z + 0.5), true)
          bot.setControlState('forward', true); bot.setControlState('sneak', Math.hypot(dx, dz) < 0.6)
          await ticks(1)
        }
      } finally { bot.clearControlStates() }
      const p = pos(); return Math.abs(cell.x + 0.5 - p.x) < 0.2 && Math.abs(cell.z + 0.5 - p.z) < 0.2
    },
    /** WAIT UNTIL STANDING at feet level y (the ladder carries the bot down onto the floor) -> boolean */
    settleAt: async (y, ms = 30_000) => {
      const end = Date.now() + ms
      while (Date.now() < end) { if (aborted()) return false; const p = pos(); if (Math.abs(p.y - y) < 0.05 && bot.entity.onGround) return true; await ticks(1) }
      return false
    },
    /**
     * CLIMB A COLUMN AND STEP OUT ONTO THE PAD -> { ok, ms, y }: hold forward toward the pad side (world point `toward`) the whole
     * way; success ONLY when the feet stand on the pad cell, on the ground (Codex shaft plan r1 P3: one operation).
     */
    climbOut: async (pad, toward, ms = 120_000) => {
      const t0 = Date.now(), end = t0 + ms
      try {
        while (Date.now() < end) {
          if (aborted()) break
          const p = pos(), f = { x: Math.floor(p.x), y: Math.floor(p.y + 1e-6), z: Math.floor(p.z) }
          if (f.x === pad.x && f.z === pad.z && f.y === pad.y && bot.entity.onGround) break
          const tgt = p.y >= pad.y - 0.05 ? { x: pad.x + 0.5, z: pad.z + 0.5 } : toward
          await bot.lookAt(new Vec3(tgt.x, p.y + 1.62, tgt.z), true)
          bot.setControlState('forward', true)
          await ticks(1)
        }
      } finally { bot.clearControlStates() }
      await ticks(6)
      const p = pos(), f = { x: Math.floor(p.x), y: Math.floor(p.y + 1e-6), z: Math.floor(p.z) }
      return { ok: f.x === pad.x && f.z === pad.z && f.y === pad.y && !!bot.entity.onGround, ms: Date.now() - t0, y: p.y }
    },
    /** CLIMB to feet level y (the top rung under a cap) holding forward toward `toward`, then hold on (sneak) -> boolean */
    climbTo: async (y, toward, ms = 90_000) => {
      const end = Date.now() + ms
      try {
        while (Date.now() < end && !aborted()) {
          const p = pos()
          if (p.y >= y - 0.05) break
          await bot.lookAt(new Vec3(toward.x, p.y + 1.62, toward.z), true)
          bot.setControlState('forward', true)
          await ticks(1)
        }
      } finally { bot.clearControlStates(); bot.setControlState('sneak', true) }
      return pos().y >= y - 0.3
    },
    /** WALK ONE STEP to an adjacent open cell on the same level (rooms and stubs) -> boolean */
    stepTo: async (cell, ms = 6_000) => {
      const end = Date.now() + ms
      try {
        while (Date.now() < end) {
          if (aborted()) return false
          const p = pos(), dx = cell.x + 0.5 - p.x, dz = cell.z + 0.5 - p.z
          if (Math.abs(dx) < 0.2 && Math.abs(dz) < 0.2 && Math.floor(p.y + 1e-6) === cell.y) break
          await bot.lookAt(new Vec3(cell.x + 0.5, p.y + 1.62, cell.z + 0.5), true)
          bot.setControlState('forward', true); bot.setControlState('sneak', Math.hypot(dx, dz) < 0.6)
          await ticks(1)
        }
      } finally { bot.clearControlStates() }
      const p = pos(); return Math.abs(cell.x + 0.5 - p.x) < 0.3 && Math.abs(cell.z + 0.5 - p.z) < 0.3 && Math.floor(p.y + 1e-6) === cell.y
    },
  }
  return effects
}
