#!/usr/bin/env node
// wellstand-replay.mjs -- the junk well's ARRIVAL on its stand replayed OFFLINE (wellfix-01show evidence).
//
//   node scripts/wellstand-replay.mjs <region.mca> <capX,capY,capZ> [--place x,y,z=name ...] [--from x,y,z ...] [--fixed]
//
// The region file is a READ-ONLY copy (wellsite-replay.mjs decodes it). `--place` overlays the cells the world gained after the
// copy was taken (from the bots' own `_place_town` rows). Then, for each start, the REAL mineflayer-pathfinder 2.4.5 plugin
// (index.js: its A*, its monitorMovement executor, its fullStop) drives a body under the REAL prismarine-physics 1.11.1 in
// mineflayer's tick order (simulate, then `physicsTick`), with the fleet's walk settings (canDig off, parkour off, the corner
// rule, the well column's step price). It prints where the body comes to rest, then what dispose_well does from there: the
// old centring test (STAND_CENTRE_TOL 0.3 on each axis) and the aim's window (wellAim), and with --fixed the new one
// (well.mjs standCentreFor: centre until the aim's own window holds).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { loadRegion, reader } from './wellsite-replay.mjs'
import * as W from '../src/well.mjs'
import { installCornerRule } from '../src/cornermoves.mjs'
import { standCentreFor, nudgeToCentre } from '../src/wellstand.mjs'

const require = createRequire(import.meta.url)
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Physics, PlayerState } = require('prismarine-physics')
const { Vec3 } = require('vec3')
const registry = require('prismarine-registry')('1.21.8')
const Block = require('prismarine-block')(registry)

/** A box of a region as a fixture -> { box, src, palette: [{name, props}], cells: [index] } (x fastest, then z, then y). */
export function dumpBox (read, [x0, y0, z0, x1, y1, z1], src = '') {
  const palette = [], idx = new Map(), cells = []
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const c = read(x, y, z) ?? { name: 'air' }
    const k = c.name + JSON.stringify(c.props ?? {})
    if (!idx.has(k)) { idx.set(k, palette.length); palette.push({ name: c.name, props: c.props ?? null }) }
    cells.push(idx.get(k))
  }
  return { box: [x0, y0, z0, x1, y1, z1], src: String(src).split('/').slice(-3).join('/'), palette, cells }
}
/** read(x,y,z) over a dumpBox fixture; outside the box: air above y0, stone at and below it. */
export function boxReader (d) {
  const [x0, y0, z0, x1, y1, z1] = d.box, nx = x1 - x0 + 1, nz = z1 - z0 + 1
  return (x, y, z) => {
    if (x < x0 || x > x1 || z < z0 || z > z1 || y < y0 || y > y1) return { name: y <= y0 ? 'stone' : 'air', props: null }
    return d.palette[d.cells[(x - x0) + nx * ((z - z0) + nz * (y - y0))]]
  }
}
/** A world of prismarine Blocks from a read(x,y,z) (wellsite-replay shape) and an overlay { 'x,y,z': name }. */
export function worldOf (read, overlay = {}) {
  const cache = new Map()
  const stateOf = c => {
    if (!c) return null
    const key = c.name + JSON.stringify(c.props ?? {})
    if (!cache.has(key)) {
      let b
      try { b = Block.fromString(Object.keys(c.props ?? {}).length ? `${c.name}[${Object.entries(c.props).map(([k, v]) => `${k}=${v}`).join(',')}]` : c.name, 0) } catch { b = Block.fromStateId(registry.blocksByName[c.name]?.defaultState ?? registry.blocksByName.stone.defaultState, 0) }
      cache.set(key, b.stateId)
    }
    return cache.get(key)
  }
  return {
    blockAt (p) {
      const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
      const o = overlay[`${x},${y},${z}`]
      const id = o ? registry.blocksByName[o].defaultState : stateOf(read(x, y, z))
      if (id == null) return null
      const b = Block.fromStateId(id, 0); b.position = new Vec3(x, y, z); return b
    }
  }
}

/** A body the real pathfinder plugin drives: mineflayer's look/controls, prismarine-physics ticks, then `physicsTick`. */
export function fakeBot (world, at, { cap = null } = {}) {
  const bot = new EventEmitter()
  bot.registry = registry; bot.version = '1.21.8'; bot.game = { minY: -64, height: 384, gameMode: 'survival' }
  bot.blockAt = p => world.blockAt(p)
  bot.entity = { position: new Vec3(at.x, at.y, at.z), velocity: new Vec3(0, 0, 0), onGround: true, isInWater: false, isInLava: false, isInWeb: false,
    isCollidedHorizontally: false, isCollidedVertically: true, elytraFlying: false, yaw: 0, pitch: 0, effects: {}, attributes: {}, height: 1.8, width: 0.6 }
  bot.jumpTicks = 0; bot.jumpQueued = false; bot.fireworkRocketDuration = 0
  bot.inventory = { items: () => [], slots: new Array(46).fill(null) }
  bot.heldItem = null; bot.entities = {}; bot.players = {}
  bot.controlState = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
  bot.setControlState = (k, v) => { bot.controlState[k] = v }
  bot.clearControlStates = () => { for (const k of Object.keys(bot.controlState)) bot.controlState[k] = false }
  // mineflayer 4.37.1 physics.js look(): the change is applied at once, rounded to the sensitivity step
  const sens = 0.15 * Math.PI / 180
  bot.look = async (yaw, pitch) => { bot.entity.yaw += Math.round((yaw - bot.entity.yaw) / sens) * sens; bot.entity.pitch += Math.round((pitch - bot.entity.pitch) / sens) * sens }
  bot.lookAt = async p => { const d = p.minus(bot.entity.position.offset(0, 1.62, 0)); await bot.look(Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z))) }
  bot.equip = async () => {}
  bot.physics = Physics(registry, { getBlock: p => world.blockAt(p) })
  bot.loadPlugin = p => p(bot)
  pathfinder(bot)
  bot.pathfinder.thinkTimeout = 20_000
  const m = new Movements(bot)
  m.canDig = false; m.allowParkour = false; m.allow1by1towers = true; m.scafoldingBlocks = []
  installCornerRule(m)
  if (cap) m.exclusionAreasStep = [b => W.wellStepCost([{ cap }], b)]
  const pf = bot.pathfinder; pf.setMovements(m)   // an offline body (check-movement-writers' ratchet is about the runtime's steering)
  bot.tick = () => { bot.physics.simulatePlayer(new PlayerState(bot, bot.controlState), { getBlock: p => world.blockAt(p) }).apply(bot); bot.emit('physicsTick') }
  return bot
}

/** Walk `bot` to the stand with GoalBlock (dispose_well's own goal) -> { ok, ticks, pos }. 20 ticks a simulated second. */
export async function walkTo (bot, stand, maxTicks = 2400) {
  const goal = new goals.GoalBlock(stand.x, stand.y, stand.z)
  let done = false, err = null
  bot.pathfinder.goto(goal).then(() => { done = true }, e => { err = e; done = true })
  let t = 0
  for (; t < maxTicks && !done; t++) { bot.tick(); await new Promise(r => setImmediate(r)) }
  for (let k = 0; k < 10; k++) bot.tick()   // settle (velocity was zeroed by fullStop)
  return { ok: !err && done, err: err?.name ?? err?.message ?? null, ticks: t, pos: bot.entity.position.clone() }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const [file, capS] = args
  if (!file || !capS) { console.error('usage: wellstand-replay.mjs <region.mca> <capX,capY,capZ> [--place x,y,z=name ...] [--from x,y,z ...] [--fixed]'); process.exit(2) }
  const [cx, cy, cz] = capS.split(',').map(Number), cap = { x: cx, y: cy, z: cz }
  const overlay = {}, froms = []
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--place') { const [k, n] = args[++i].split('='); overlay[k] = n }
    if (args[i] === '--from') { const [x, y, z] = args[++i].split(',').map(Number); froms.push({ x, y, z }) }
  }
  const fixed = args.includes('--fixed')
  const read = file.endsWith('.json') ? boxReader(JSON.parse(fs.readFileSync(file, 'utf8'))) : reader(loadRegion(file))
  // --dump x0,y0,z0,x1,y1,z1 out.json: the box as a test fixture (names + props, palette-coded), then exit
  if (args.includes('--dump')) {
    const [b, out] = [args[args.indexOf('--dump') + 1], args[args.indexOf('--dump') + 2]]
    fs.writeFileSync(out, JSON.stringify(dumpBox(read, b.split(',').map(Number), file)))
    console.log(`dumped ${b} -> ${out}`); process.exit(0)
  }
  const world = worldOf(read, overlay)
  const capCell = read(cap.x, cap.y, cap.z)
  const facing = capCell?.props?.facing ?? null
  // dispose_well's stand: usableStands' first (front, then the sides) -- the stand the live rows name, 12,74,6
  const front = W.standForFacing ? W.standForFacing(cap, facing) : null
  const stand = front ?? { x: cap.x, y: cap.y + 1, z: cap.z - 1 }
  console.log(`cap ${cap.x},${cap.y},${cap.z} ${capCell?.name} facing=${facing} stand ${stand.x},${stand.y},${stand.z} overlay=${JSON.stringify(overlay)}`)
  const TOL = 0.3   // skills.mjs STAND_CENTRE_TOL (centredOn: each axis)
  for (const f of froms) {
    const bot = fakeBot(world, { x: f.x + 0.5, y: f.y, z: f.z + 0.5 }, { cap })
    const r = await walkTo(bot, stand)
    const q = r.pos
    const centred = Math.abs(q.x - (stand.x + 0.5)) <= TOL && Math.abs(q.z - (stand.z + 0.5)) <= TOL
    const aim = W.wellAim({ from: q, cap, facing, rise: q.y - (cap.y + 1) })
    let line = `from ${f.x},${f.y},${f.z}: ${r.ok ? 'arrived' : `walk ${r.err}`} at ${q.x.toFixed(3)},${q.y.toFixed(2)},${q.z.toFixed(3)} (${r.ticks} ticks) | old: centredOn=${centred} -> ${centred ? 'no nudge' : 'nudge'}; aim dist=${aim.dist.toFixed(3)} ok=${aim.ok}${aim.ok ? '' : ` (${aim.why})`}`
    if (fixed) {
      // dispose_well's new step (wellfix-01show): out of the aim's window -> the real nudge, under the same physics
      const c = standCentreFor({ from: q, cap, stand })
      if (c.ok) line += ' | new: in window, no nudge'
      else {
        const n = await nudgeToCentre(bot, c.target, { tick: async () => { bot.tick(); await new Promise(r => setImmediate(r)) } })
        for (let k = 0; k < 10; k++) bot.tick()
        const p2 = bot.entity.position, a2 = W.wellAim({ from: p2, cap, facing, rise: p2.y - (cap.y + 1) })
        line += ` | new: nudge ${n.ticks} ticks -> ${p2.x.toFixed(3)},${p2.y.toFixed(2)},${p2.z.toFixed(3)} dist=${a2.dist.toFixed(3)} ok=${a2.ok} rate=${a2.rate.toFixed(3)}`
      }
    }
    console.log(line)
  }
}
