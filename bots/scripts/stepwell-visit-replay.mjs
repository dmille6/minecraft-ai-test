#!/usr/bin/env node
// stepwell-visit-replay.mjs -- THE STEPWELL TANK VISIT REPLAYED OFFLINE (stepwell-03show evidence): the REAL loop (stepwellvisit.mjs
// runStepwellVisit) over a READ-ONLY region copy and the record, every walk driven by the REAL mineflayer-pathfinder under the REAL
// prismarine-physics (wellstand-replay.mjs fakeBot) with the town-deposit walk profile (no digs, no towers, no scaffold: towndeposit.mjs
// townWalkMovements). A dig sets the cell to air, a placement sets the role's first block; both instant, on a simulated clock (1 s an
// op, a walk its ticks / 20). Visits run one after another on the same world (the bot starts each at --from, default the record's exit).
//
//   node scripts/stepwell-visit-replay.mjs <record.json> <region.mca> [--visits n] [--budget s] [--from x,y,z] [--air x,y,z ...] [--quiet]
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { loadRegion, reader } from './wellsite-replay.mjs'
import { worldOf, fakeBot } from './wellstand-replay.mjs'
import * as S from '../src/stepwell.mjs'
import { runStepwellVisit } from '../src/stepwellvisit.mjs'

const require = createRequire(import.meta.url)
const { goals } = require('mineflayer-pathfinder')
const Block = require('prismarine-block')(require('prismarine-registry')('1.21.8'))

const shapeCache = new Map()
export function cellOf (name) {
  // a dry block: Block.fromString's default state of a wall is WATERLOGGED (state 0), which the loop reads wet
  if (!shapeCache.has(name)) { let b = Block.fromString(name, 0); try { if (b.getProperties()?.waterlogged) b = Block.fromString(`${name}[waterlogged=false]`, 0) } catch { /* no such property */ } let p = null; try { p = b.getProperties() } catch { p = null } shapeCache.set(name, { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes, hardness: b.hardness ?? null, props: p }) }
  return shapeCache.get(name)
}
const ROLE_BLOCK = { floor: 'stone_bricks', trim: 'stone_bricks', wall: 'cobblestone', body: 'cobblestone', under: 'cobblestone', seal: 'cobblestone', post: 'cobblestone_wall', light: 'torch', dlight: 'torch', tread: 'stone_bricks' }

/** One visit on a mutable world `over` (Map "x,y,z" -> cell) -> { r, rows, feet, secs }. `walkTicks` bounds each walk (20 a second). */
export async function replayVisit ({ rec, read0, over, from, budgetS = 120, walkTicks = 400, lights = false, asideMem = null, clock0 = 0, log = () => {} }) {
  const read = (x, y, z) => over.get(`${x},${y},${z}`) ?? read0(x, y, z)
  const plan = S.planOfRecord(rec)
  let clock = clock0, feet = from.slice()   // clock0: the simulated time this visit starts at (the set-aside memory ages on it)
  const rows = []
  const walk = async c => {
    const world = worldOf(read, {})
    const bot = fakeBot(world, { x: feet[0] + 0.5, y: feet[1], z: feet[2] + 0.5 })
    const m = bot.pathfinder.movements
    m.allow1by1towers = false; m.canDig = false; m.scafoldingBlocks = []; m.maxDropDown = 6; m.allowParkour = false
    const goal = new goals.GoalBlock(c[0], c[1], c[2])
    let done = false, err = null
    bot.pathfinder.goto(goal).then(() => { done = true }, e => { err = e; done = true })
    let t = 0
    for (; t < walkTicks && !done; t++) { bot.tick(); await new Promise(r => setImmediate(r)) }
    try { bot.pathfinder.stop?.() } catch { /* offline */ }
    for (let k = 0; k < 10; k++) bot.tick()
    clock += t / 20
    const p = bot.entity.position
    feet = [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)]
    // stairWalk's own arrival test (within 1 on each axis); the visit then asks for the exact cell
    const near = Math.abs(feet[0] - c[0]) <= 1 && Math.abs(feet[2] - c[2]) <= 1 && Math.abs(feet[1] - c[1]) <= 1
    log('walk', { to: c, ok: near && !err, err: err?.name ?? err?.message ?? null, ticks: t, at: feet })
    return near
  }
  const e = {
    get read () { return read },
    feet: () => feet,
    walkTo: walk,
    dig: async c => { clock += 1; over.set(c.join(','), cellOf('air')); return 'confirmed' },
    place: async (c, role) => { clock += 1; over.set(c.join(','), cellOf(ROLE_BLOCK[role] ?? 'cobblestone')); return 'confirmed' },
    toolOk: () => true,
    occupied: () => false,
    fence: () => true,
    log: (op, d) => { rows.push({ op, ...d, t: Math.round(clock) }); log(op, d) },
    now: () => clock * 1000,
    aborted: () => false,
  }
  const r = await runStepwellVisit({ plan, exit: rec.exit, share: null, aside: asideMem, onStop: async () => {}, onTiers: async () => {} }, e, { deadline: clock0 * 1000 + budgetS * 1000, lights: () => lights })
  return { r, rows, feet, secs: Math.round(clock - clock0) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const [recPath, regionPath] = args
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
  const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'))
  const read0 = reader(loadRegion(regionPath))
  const over = new Map()
  for (let i = 0; i < args.length; i++) if (args[i] === '--air') over.set(args[++i], cellOf('air'))
  const from = (opt('--from') ?? rec.exit.join(',')).split(',').map(Number)
  const quiet = args.includes('--quiet')
  const visits = Number(opt('--visits') ?? 1), budgetS = Number(opt('--budget') ?? 120)
  const plan = S.planOfRecord(rec)
  const asideMem = args.includes('--no-memory') ? null : new Map()
  let clockAt = 0
  for (let v = 1; v <= visits; v++) {
    const t0 = Date.now()
    const { r, rows, secs } = await replayVisit({ rec, read0, over, from, budgetS, asideMem, clock0: clockAt, log: (op, d) => { if (op === 'set_aside' || (!quiet && (op === 'refused' || op === 'walk' && !d.ok))) console.log(`   ${op} ${JSON.stringify(d)}`) } })
    clockAt += 20 * 60   // the next visit 20 min later (the turn's base back-off)
    const read = (x, y, z) => over.get(`${x},${y},${z}`) ?? read0(x, y, z)
    const w = S.firstUndoneUnit(read, plan)
    const walks = rows.filter(q => q.op === 'refused').length
    console.log(`visit ${v}: stop=${r.stop} why=${r.why ?? '-'} y=${r.y ?? '-'} dug=${r.dug} placed=${r.placed} ops=${r.ops} skipped=${r.skipped} refused=${walks} aside=${r.aside} tiers=${r.tiers.join('+') || '-'} sim_s=${secs} wall_ms=${Date.now() - t0} | next unit ${w ? `i=${w.i} y=${w.unit.y}` : 'none'}`)
    if (r.stop === 'complete') break
    if (w && r.stop === 'passed' && !r.skipped) {
      // a unit the loop calls done but is not: name each cell not done (its role, its block, what is under it)
      const u = w.unit
      for (const [list, nm] of [[u.cut, 'cut'], [u.faces, 'face'], [u.under, 'under'], [u.tops, 'top'], [u.posts, 'post']]) for (const c of list) {
        if (S.cellDone(read, plan, c) === true) continue
        const e = plan.byKey.get(c.join(','))
        const nb = [[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]].map(([dx,dy,dz]) => read(c[0]+dx,c[1]+dy,c[2]+dz)?.name).join('/')
        console.log(`   undone ${nm} ${c.join(',')} role=${e?.role ?? 'cut'} now=${read(...c)?.name} below=${read(c[0], c[1] - 1, c[2])?.name} n6=${nb}`)
      }
      console.log('   next from', JSON.stringify(from), JSON.stringify(S.stepwellNext(read, plan, u, { feet: from, lights: false })), 'no feet', JSON.stringify(S.stepwellNext(read, plan, u, { feet: null, lights: false })))
      break
    }
  }
}
