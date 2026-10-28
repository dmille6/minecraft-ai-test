// PLUGCUT-01 TEST WORLD: ceilescape-01's test world (bots/test/ceilescape-world.mjs on ceilescape-on-fb8de72, sha256 ead5385f),
// copied so this branch does not depend on ceilescape-01 landing, plus ONE addition: `placeBlock` (below), the actuator the
// plug rung calls. Everything else is that file unchanged: a virtual clock, real registry blocks, and a deliberately SMALL,
// EXPLICIT body physics.
//
// THE CLOCK. `escapeStairUp`, `digBounded` and the module's `sleep` all read the GLOBAL `Date.now` / `setTimeout`, so the
// clock swaps those (this test process only) and advances to the next timer whenever every promise is waiting. A 60 s ramp
// at the real prices (copper 375 s, dirt 18.75 s) then runs in milliseconds, and the arithmetic is the production arithmetic:
// no price or budget is scaled (Codex design r1 P2-9: a /20 time scale with unscaled settles distorts the comparison).
//
// THE BLOCKS are prismarine-block 1.21.8 blocks from the real registry, so `digTime` is the registry's -- the same function
// mineflayer's `bot.digTime` calls (lib/plugins/digging.js:248-252).
//
// THE BODY (Codex design r1 P1-4: "do not make the fake bot award the climb"). Every 50 ms tick:
//   - in water (the feet cell is water): `jump` raises the feet 0.1 a tick until the head (feet + 1.8) meets a solid block;
//     without `jump` the feet sink `sink` a tick (a fixture option: 0 = Comet's steady float) until they rest on a solid floor;
//   - out of water: the feet fall to the floor below and `onGround` is set;
//   - `forward` moves the body 0.2 a tick along the look yaw ONLY when the cell ahead is passable at BOTH the feet and the
//     head height of the body as it is now. A body whose feet are below the tread's top cannot enter: it must first rise.
// There is no ledge impulse at all, so a test passes only if the actuator itself gets the body up to the target's height.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const reg = require('prismarine-registry')('1.21.8')
const Block = require('prismarine-block')(reg)

// ------------------------------------------------------------------------------------------------ the virtual clock
const REAL = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, now: Date.now, setImmediate: globalThis.setImmediate }
export function virtualClock (start = 1_800_000_000_000) {
  let now = start, seq = 0
  const timers = new Map()
  const vSet = (fn, ms = 0, ...args) => { const id = { id: ++seq, unref () { return this }, ref () { return this }, hasRef: () => false }; timers.set(id, { t: now + Math.max(0, Number(ms) || 0), fn, args, seq: id.id }); return id }
  const vClear = id => { if (id) timers.delete(id) }
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => REAL.setImmediate(r)) }
  const clock = {
    get now () { return now },
    install () { globalThis.setTimeout = vSet; globalThis.clearTimeout = vClear; Date.now = () => now; return clock },
    uninstall () { globalThis.setTimeout = REAL.setTimeout; globalThis.clearTimeout = REAL.clearTimeout; Date.now = REAL.now },
    /** Run `fn()` to completion in virtual time; throws if it has not finished after `maxMs` of virtual time. */
    async run (fn, maxMs = 30 * 60_000) {
      let done = false, value, error
      const p = Promise.resolve().then(fn).then(v => { value = v }, e => { error = e }).finally(() => { done = true })
      const limit = now + maxMs
      for (;;) {
        await flush()
        if (done) break
        let next = null
        for (const [id, x] of timers) if (!next || x.t < next[1].t || (x.t === next[1].t && x.seq < next[1].seq)) next = [id, x]
        if (!next) { await flush(); if (done) break; throw new Error('virtual clock: nothing scheduled and the run has not finished') }
        if (next[1].t > limit) throw new Error(`virtual clock: still running after ${maxMs} ms`)
        timers.delete(next[0])
        now = Math.max(now, next[1].t)
        try { next[1].fn(...next[1].args) } catch (e) { error = e; break }
      }
      await p
      if (error) throw error
      return value
    },
  }
  return clock
}

// ------------------------------------------------------------------------------------------------ blocks
/** A registry block from a fixture state: `water[<level>]`, `<name>[wl]`, `ladder[facing=..]`, a plain name, or null. */
export function blockOf (state, pos) {
  if (state === null || state === undefined) return null
  const s = String(state)
  let b
  const wl = /^water\[(\d+)\]$/.exec(s)
  if (wl) b = Block.fromStateId(reg.blocksByName.water.minStateId + Math.min(15, Number(wl[1])), 0)
  else if (s === 'water') b = Block.fromStateId(reg.blocksByName.water.minStateId, 0)
  else {
    const name = s.replace(/\[.*\]$/, '')
    const def = reg.blocksByName[name] ?? reg.blocksByName.stone
    b = Block.fromStateId(def.defaultState, 0)
    if (/\[wl\]$/.test(s)) Object.defineProperty(b, 'isWaterlogged', { value: true })
  }
  b.position = pos
  return b
}

const BEARS = [{ x: 0, z: -1 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0 }]
const yawBear = yaw => BEARS[((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4]
const solidAt = b => !!b && b.boundingBox === 'block'
const isWater = b => !!b && (b.name === 'water' || b.isWaterlogged === true)

/**
 * A fake bot in a fixture world. `cells` is { "dx,dy,dz": state } relative to the ANCHOR (the bot's feet cell); the bot is placed
 * at anchor + (0.5, feetY, 0.5) with `feetY` the fractional feet height (Comet floats at 0.2). Unknown cells read `fill`.
 *   onDig(cellKey, world, bot)  -> world changes after a dig lands (water flowing in, a sink)
 *   sink                         -> feet drop per tick in water without jump (0 = a steady float)
 *   rise                         -> feet rise per tick in water with jump held (a slower swimmer)
 *   held                         -> the held item ({ name, type }) or null; unequip empties it unless `stuckHand`
 */
export function makeWorldBot (cells, { feetY = 0.2, fill = 'stone', sink = 0, rise = 0.1, held = null, stuckHand = false, items = [],
                                         onDig = null, yieldAt = null, canPath = false, onTick = null,
                                         placeFails = false, onPlace = null, ledge = false } = {}) {
  const m = new Map(Object.entries(cells))
  const world = {
    get (x, y, z) { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : fill },
    set (x, y, z, v) { m.set(`${x},${y},${z}`, v) },
  }
  const digs = [], controls = [], looks = [], places = []
  const ctl = { forward: false, jump: false, back: false, left: false, right: false, sneak: false, sprint: false }
  let yaw = 0, digging = null, vy = 0
  const ent = { position: new Vec3(0.5, feetY, 0.5), onGround: false, eyeHeight: 1.62, yaw: 0, velocity: new Vec3(0, 0, 0), effects: {} }
  Object.defineProperty(ent, 'yaw', { get: () => yaw, set: v => { yaw = v } })
  const cellAt = (x, y, z) => world.get(Math.floor(x), Math.floor(y), Math.floor(z))
  /** plugcut-01 `ledge`: is the body's box (0.6 x 1.8 x 0.6, feet at y) free of solid blocks -- and of water, unless solidOnly? */
  const boxFree = (cx, y, cz, { solidOnly = false } = {}) => {
    for (let x = Math.floor(cx - 0.3); x <= Math.floor(cx + 0.3 - 1e-9); x++) {
      for (let yy = Math.floor(y); yy <= Math.floor(y + 1.8 - 1e-9); yy++) {
        for (let z = Math.floor(cz - 0.3); z <= Math.floor(cz + 0.3 - 1e-9); z++) {
          const c = blockOf(world.get(x, yy, z), new Vec3(x, yy, z))
          if (solidAt(c) || (!solidOnly && isWater(c))) return false
        }
      }
    }
    return true
  }
  const blockAtXYZ = (x, y, z) => blockOf(cellAt(x, y, z), new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)))
  const bot = {
    world, digs, controls, looks, ctl, pendingPrereq: undefined, heldItem: held,
    entity: ent,
    game: { gameMode: 'survival' },
    health: 20, oxygenLevel: 20,
    inventory: { items: () => items.filter(i => i.count > 0), slots: [], emptySlotCount: () => 36 - items.length },
    getEquipmentDestSlot: () => 5,
    blockAt (p) { return blockAtXYZ(p.x, p.y, p.z) },
    _getBlockAtEyeLevel () { const p = ent.position; return blockAtXYZ(p.x, p.y + ent.eyeHeight, p.z) },
    async unequip () { if (!stuckHand) bot.heldItem = null },
    async equip (item) { bot.heldItem = item },
    // PLUGCUT-01: mineflayer's placeBlock(referenceBlock, faceVector) puts the HELD block into ref + face. The fake refuses
    // exactly what the server refuses in the cases the tests reach: no held block, a non-solid reference, a target that is
    // not air or water, or the bot's own body. `placeFails` (a fixture option) makes it a silent no-op, as a rejected
    // placement is on the fleet; the actuator must read the cell back to tell.
    places,
    async placeBlock (ref, face) {
      const it = bot.heldItem
      const t = ref.position.plus(face)
      const rec = { cell: `${t.x},${t.y},${t.z}`, ref: `${ref.position.x},${ref.position.y},${ref.position.z}`, item: it?.name ?? null, ok: false, at: Date.now() }
      places.push(rec)
      if (!it || !reg.blocksByName[it.name]) throw new Error('no block in hand')
      if (!solidAt(blockAtXYZ(ref.position.x, ref.position.y, ref.position.z))) throw new Error('no reference block')
      const cur = blockAtXYZ(t.x, t.y, t.z)
      if (cur && cur.name !== 'air' && cur.name !== 'water' && cur.name !== 'cave_air') throw new Error(`occupied by ${cur.name}`)
      const p = ent.position
      if (Math.floor(p.x) === t.x && Math.floor(p.z) === t.z && (t.y === Math.floor(p.y) || t.y === Math.floor(p.y + 1.79))) throw new Error('the body is there')
      if (placeFails) return
      world.set(t.x, t.y, t.z, it.name)
      it.count--
      if (it.count <= 0) bot.heldItem = null
      rec.ok = true
      try { onPlace?.(rec.cell, world, bot) } catch { /* fixture */ }
    },
    /** mineflayer's `bot.digTime` (digging.js:228-256): the held item, eye-level water, onGround -- the same inputs as dig's wait. */
    digTime (b) {
      const eye = bot._getBlockAtEyeLevel()
      return b.digTime(bot.heldItem?.type ?? null, false, isWater(eye), !ent.onGround, [], {})
    },
    /** mineflayer's rule: the wait is fixed at the START from the held item, eye water and onGround (digging.js:27,135,248). */
    async dig (b) {
      const k = `${Math.floor(b.position.x)},${Math.floor(b.position.y)},${Math.floor(b.position.z)}`
      const eye = bot._getBlockAtEyeLevel()
      const wait = b.digTime(bot.heldItem?.type ?? null, false, isWater(eye), !ent.onGround, [], {})
      const rec = { cell: k, name: b.name, held: bot.heldItem?.name ?? null, waitMs: wait, at: Date.now(), done: false }
      digs.push(rec)
      return await new Promise((resolve, reject) => {   // async + await: mineflayer's dig rejects a tick after stopDigging
        const t = setTimeout(() => {
          digging = null
          rec.done = true
          world.set(...k.split(',').map(Number), 'air')
          try { onDig?.(k, world, bot) } catch { /* fixture */ }
          resolve()
        }, wait)
        digging = { t, reject, rec }
      })
    },
    stopDigging () { if (digging) { clearTimeout(digging.t); digging.rec.aborted = true; const r = digging.reject; digging = null; r(new Error('Digging aborted')) } },
    clearControlStates () { for (const k of Object.keys(ctl)) ctl[k] = false; controls.push('clear') },
    setControlState (name, on) { ctl[name] = !!on; controls.push(`${name}:${!!on}`) },
    async look (a) { yaw = a; looks.push(a) },
    // JIT 10-24 (plugcut-01 x lavastep-01): the plug looks first, then places with forceLook 'ignore' -- `onLookAt` lets a
    // test hand the body to another owner DURING the look; _placeBlockWithOptions is mineflayer's, the same placement
    lookCalls: 0,
    async lookAt (...a) { bot.lookCalls++; if (bot.onLookAt) await bot.onLookAt(...a) },
    async _placeBlockWithOptions (ref, face, opts) { if (opts?.forceLook !== 'ignore') await bot.lookAt(); return bot.placeBlock(ref, face) },
    pathfinder: { thinkTimeout: 1000, setGoal () {}, stop () {}, movements: {}, isMining: () => false,
                  getPathTo () { return canPath ? { path: [1, 2, 3] } : { path: [] } } },
    on () {}, once () {}, removeListener () {}, emit () {},
  }
  // THE BODY, one tick every 50 ms of virtual time (see the header for the rules).
  const tick = () => {
    try {
      onTick?.(world, bot)
      const p = ent.position
      const feet = blockAtXYZ(p.x, p.y, p.z)
      // PLUGCUT-01 ADDITION, `ledge` (default off: the copied physics exactly). Vanilla's jump out of a fluid
      // (LivingEntity.travel, the fluid branch: horizontalCollision && the box moved up 0.6 is free -> motion.y = 0.3) is the
      // one impulse the ramp's own step from water relies on (Paper 10-24: isolated-c-Alpha took the plugged W step that
      // way). Modelled as that rule and nothing more: in water, forward held, the cell ahead solid at the feet and free at
      // the feet + 0.6 for the whole body -> vy = 0.3; then vy decays 0.08 a tick (gravity) until it is spent.
      if (ledge && vy <= 0 && isWater(feet) && ctl.forward) {
        // prismarine-physics (node_modules/prismarine-physics/index.js, the liquid branch of moveEntityWithHeading):
        //   isCollidedHorizontally && doesNotCollide(world, pos.offset(vel.x, vel.y + 0.6 - pos.y + lastY, vel.z)) -> vel.y = 0.3
        // where doesNotCollide is "the player box meets no block AND holds no water". The box here is the body's: 0.6 wide,
        // 1.8 tall, moved by this tick's forward step (0.2 along the bearing); collided = the moved box at the current height
        // meets a solid block.
        const b = yawBear(yaw)
        const dx = b.x * 0.2, dz = b.z * 0.2
        const collided = !boxFree(p.x + dx, p.y, p.z + dz, { solidOnly: true })
        if (collided && boxFree(p.x + dx, p.y + 0.6, p.z + dz)) vy = 0.3
      }
      // ...and the ordinary jump from the ground (vanilla 0.42), so a dry step can be taken at all (the copied world has none)
      if (ledge && vy <= 0 && !isWater(feet) && ent.onGround && ctl.jump) { vy = 0.42; ent.onGround = false }
      if (ledge && vy > 0) {
        // the stroke still adds while the feet are in water; a solid block at the head stops the rise (and the impulse)
        const dy = vy + (ctl.jump && isWater(feet) ? rise : 0)
        if (solidAt(blockAtXYZ(p.x, p.y + dy + 1.8, p.z))) vy = 0
        else { ent.position = new Vec3(p.x, p.y + dy, p.z); vy -= 0.08 }
      } else if (isWater(feet)) {
        ent.onGround = false
        if (ctl.jump) {
          const headTop = p.y + 1.8
          const above = blockAtXYZ(p.x, headTop + 0.1, p.z)
          if (!solidAt(above)) ent.position = new Vec3(p.x, p.y + rise, p.z)
          else ent.position = new Vec3(p.x, Math.min(p.y + rise, Math.floor(headTop + 0.1) - 1.8), p.z)
        } else if (sink > 0) {
          const floor = Math.floor(p.y)
          const below = blockAtXYZ(p.x, p.y - sink, p.z)
          ent.position = new Vec3(p.x, solidAt(below) ? Math.max(floor, p.y - sink) : p.y - sink, p.z)
        }
      } else {
        // out of water: fall to the first solid (stand on it) or water (float in it) below the feet
        const fy = Math.floor(p.y)
        let k = (p.y === fy) ? fy - 1 : fy
        let n = 0
        while (n++ < 8 && !solidAt(blockAtXYZ(p.x, k, p.z)) && !isWater(blockAtXYZ(p.x, k, p.z))) k--
        const under = blockAtXYZ(p.x, k, p.z)
        if (solidAt(under)) { ent.position = new Vec3(p.x, k + 1, p.z); ent.onGround = true }
        else if (isWater(under)) { ent.position = new Vec3(p.x, k + 0.5, p.z); ent.onGround = false }
      }
      if (ctl.forward) {
        const b = yawBear(yaw), q = ent.position
        const nx = q.x + b.x * 0.2, nz = q.z + b.z * 0.2
        const sameCell = Math.floor(nx) === Math.floor(q.x) && Math.floor(nz) === Math.floor(q.z)
        // the body may enter the next cell only if the cells it would occupy at ITS CURRENT HEIGHT are passable
        const lead = (v, d) => v + d * 0.3
        const fitsAt = (x, z) => !solidAt(blockAtXYZ(x, q.y + 0.01, z)) && !solidAt(blockAtXYZ(x, q.y + 1.79, z))
        if (sameCell ? fitsAt(lead(nx, b.x), lead(nz, b.z)) : fitsAt(nx, nz)) ent.position = new Vec3(nx, q.y, nz)
      }
    } catch { /* a fixture bug must not hang the clock */ }
    if (!bot.ended) setTimeout(tick, 50)
  }
  bot.start = () => { setTimeout(tick, 50); return bot }
  bot.stop = () => { bot.ended = true }
  return bot
}

export const fixtureCells = name => JSON.parse(require('node:fs').readFileSync(new URL(`./fixtures/ceilescape-${name}.json`, import.meta.url))).cells
/** plugcut-01: a failmine library scene window (fixtures/plugcut-scenes.json, cut by pc_fixtures.py from sandbox/scenes). */
export const sceneCells = name => JSON.parse(require('node:fs').readFileSync(new URL('./fixtures/plugcut-scenes.json', import.meta.url))).scenes[name]
export { Vec3, reg, Block }
