#!/usr/bin/env node
// plinth-replay.mjs -- the raised junk well's planner (src/plinth.mjs planPlinth) replayed OFFLINE on a town's real terrain.
//
//   node scripts/plinth-replay.mjs <region.mca> <homeX,homeY,homeZ> [--no-leaves] [--json out.json] [--verify]
//
// The region file is a READ-ONLY copy (scp from the world host; no world command runs), decoded by wellsite-replay.mjs into
// a read(x,y,z) shaped like skills.mjs readWellCell. The avoid list is the bot's (wellAvoid): every chest/barrel within
// ADOPT_RADIUS + 8 of home, kept WELL_HOME_CLEARANCE away; and every existing trapdoor well's cells are a keep-out.
// --verify replays the plan step by step on the same terrain: each placement's support is solid, its stand is standable
// and reachable from the town at that step (walkReach), the hazard step is where plinthHazard first turns true, and the
// finished world passes wellSiteRefusal (the oracle) with a walk to a throwing stand.
import { loadRegion, reader } from './wellsite-replay.mjs'
import * as P from '../src/plinth.mjs'
import { wellSiteRefusal, WELL_HOME_CLEARANCE, WOODEN_TRAPDOOR, wellStand } from '../src/well.mjs'
import { ADOPT_RADIUS } from '../src/composter.mjs'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import * as WS from '../src/well.mjs'

const [file, homeS, ...rest] = process.argv.slice(2)
if (!file || !homeS) { console.error('usage: plinth-replay.mjs <region.mca> <x,y,z> [--no-leaves] [--json f] [--verify]'); process.exit(2) }
const [hx, hy, hz] = homeS.split(',').map(Number)
const home = { x: hx, y: hy, z: hz }
const clearLeaves = !rest.includes('--no-leaves')
const jsonOut = rest.includes('--json') ? rest[rest.indexOf('--json') + 1] : null
const read = P.memoRead(reader(loadRegion(file)))

const avoid = [], keepOut = []
const R = ADOPT_RADIUS + WELL_HOME_CLEARANCE + 1
for (let x = hx - R; x <= hx + R; x++) for (let z = hz - R; z <= hz + R; z++) for (let y = hy - R; y <= hy + R; y++) {
  if (Math.hypot(x - hx, y - hy, z - hz) > R) continue
  const b = read(x, y, z)
  if (!b) continue
  if (/^(chest|trapped_chest|barrel)$/.test(b.name)) avoid.push({ x, z, r: WELL_HOME_CLEARANCE, what: 'a bank container' })
  if (b.name === 'composter') avoid.push({ x, z, r: WELL_HOME_CLEARANCE, what: 'the composter' })
  if (WOODEN_TRAPDOOR.test(b.name) && b.props?.half === 'top') keepOut.push({ x, y, z, r: 2 })
}

const t0 = Date.now()
// the planner as the bot drives it (planPlinthSteps, yielding between candidates): the longest stretch between yields is
// how long the bot's event loop is blocked at once (Claude r1 P3-7)
const it = P.planPlinthSteps({ read, home, avoid, keepOut, clearLeaves })
let res, last = Date.now(), maxStretch = 0
for (;;) { const r = it.next(); const now = Date.now(); maxStretch = Math.max(maxStretch, now - last); last = now; if (r.done) { res = r.value; break } }
const ms = Date.now() - t0
const out = { home, clearLeaves, ms, maxStretch, tried: res.tried, why: res.why, tally: res.tally, plan: res.plan }
if (rest.includes('--verify') && res.plan) out.verify = verify(res.plan)
if (rest.includes('--astar') && res.plan) out.astar = astar(res.plan)
const p = res.plan
console.log(p
  ? `PLAN cap=${p.cap.x},${p.cap.y},${p.cap.z} k=${p.k} place=${p.cost} clear=${p.clears} stair=${p.stair.length} hazardStep=${p.hazardStep} facing=${p.facing} stands=${new Set(p.steps.map(x => x.s.join(','))).size} tried=${res.tried} ms=${ms} block=${maxStretch}${out.verify ? ` verify=${out.verify.ok ? 'OK' : `FAIL(${out.verify.why})`}` : ''}`
  + (out.astar ? ` astar=${out.astar.ok ? `OK(${out.astar.nodes} nodes, stair ${out.astar.stairUsed}/${p.stair.length}, column ${out.astar.inColumn})` : `FAIL(${out.astar.why})`}` : '')
  : `NONE why=${res.why} tried=${res.tried} ms=${ms} tally=${JSON.stringify(res.tally)}`)
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out))

function verify (plan) {
  const cells = new Map()
  const w = P.overlay(read, cells)
  const box = { x0: Math.min(hx, plan.cap.x) - 6, x1: Math.max(hx, plan.cap.x) + 6, z0: Math.min(hz, plan.cap.z) - 6, z1: Math.max(hz, plan.cap.z) + 6, y0: Math.min(hy, plan.cap.y) - 10, y1: Math.max(hy, plan.cap.y) + 8 }
  const forbid = (x, y, z) => P.inColumn(plan.cap, x, y, z)
  let firstHazard = null
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i]
    const reach = P.walkReach(w, plan.start, { box, forbid })
    if (!reach.has(P.cellKey(...s.s))) return { ok: false, why: `step ${i} stand not reachable` }
    const eye = { x: s.s[0] + 0.5, y: s.s[1] + P.EYE_HEIGHT, z: s.s[2] + 0.5 }
    if (s.op === 'place') {
      const ref = w(...s.r)
      if (ref?.boundingBox !== 'block') return { ok: false, why: `step ${i} support ${s.r} not solid` }
      if (s.f[1] === -1) return { ok: false, why: `step ${i} bottom-face click` }
      const pt = P.faceCentre({ x: s.r[0], y: s.r[1], z: s.r[2] }, s.f)
      if (Math.hypot(eye.x - pt.x, eye.y - pt.y, eye.z - pt.z) > P.PLINTH_REACH) return { ok: false, why: `step ${i} out of reach` }
      if (!P.PLINTH_REPLACEABLE.has(w(...s.c)?.name)) return { ok: false, why: `step ${i} target ${w(...s.c)?.name}` }
      cells.set(P.cellKey(...s.c), P.PLACED)
    } else {
      if (!/_leaves$/.test(w(...s.c)?.name ?? '')) return { ok: false, why: `step ${i} clear of ${w(...s.c)?.name}` }
      cells.set(P.cellKey(...s.c), P.AIR)
    }
    // the stand walks BACK to the town after the click (Codex r2 P1-1: the walk is not symmetric)
    if (!P.walksBack(w, { x: s.s[0], y: s.s[1], z: s.s[2] }, plan.start, { box, forbid })) return { ok: false, why: `step ${i} strands its stand` }
    // bottom-up in every column: no placement over a cell of the plan still to be placed
    if (s.op === 'place' && plan.steps.slice(i + 1).some(o => o.op === 'place' && o.c[0] === s.c[0] && o.c[2] === s.c[2] && o.c[1] < s.c[1])) return { ok: false, why: `step ${i} placed over a later cell` }
    if (firstHazard === null && P.plinthHazard(w, plan.cap)) firstHazard = i
  }
  if (firstHazard !== plan.hazardStep) return { ok: false, why: `hazard step ${firstHazard} != plan ${plan.hazardStep}` }
  const why = wellSiteRefusal(w, plan.cap, home, { avoid })
  if (why) return { ok: false, why: `oracle: ${why}` }
  const st = wellStand(w, plan.cap)
  const reach = P.walkReach(w, plan.start, { box, forbid })
  if (!st || !reach.has(P.cellKey(st.stand.x, st.stand.y, st.stand.z))) return { ok: false, why: 'final stand not walkable' }
  const prog = P.plinthProgress(w, plan)
  if (!prog.complete || prog.placesLeft) return { ok: false, why: `progress ${prog.done}/${prog.total}` }
  return { ok: true, firstHazard, stand: st.stand, facing: st.facing }
}

/** THE REAL PATHFINDER on the finished world (mineflayer-pathfinder's A* with the fleet's well step cost, no digging, no
 *  placing): from the probe's start to the throwing stand. The column must never be a node. */
function astar (plan) {
  const require = createRequire(import.meta.url)
  const { Movements, goals } = require('mineflayer-pathfinder')
  const AStar = require('mineflayer-pathfinder/lib/astar.js'); const Move = require('mineflayer-pathfinder/lib/move.js')
  const reg = require('prismarine-registry')('1.21.8'); const Block = require('prismarine-block')(reg)
  const { Vec3 } = require('vec3')
  const cells = new Map()
  for (const s of plan.steps) cells.set(P.cellKey(...s.c), s.op === 'place' ? P.PLACED : P.AIR)
  const w = P.overlay(read, cells)
  const cache = new Map()
  const blockAt = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
    const c = w(x, y, z)
    if (!c) return null
    let b = cache.get(c.name)
    if (!b) { const d = reg.blocksByName[c.name]; b = d ? Block.fromStateId(d.defaultState ?? d.minStateId, 0) : Block.fromStateId(reg.blocksByName.stone.defaultState, 0); cache.set(c.name, b) }
    const o = Object.create(b); o.position = new Vec3(x, y, z); return o
  }
  const bot = { registry: reg, version: '1.21.8', game: { minY: -64, height: 384 }, blockAt, entity: { position: new Vec3(plan.start.x + 0.5, plan.start.y, plan.start.z + 0.5), effects: {} },
                entities: {}, inventory: { items: () => [], slots: [] }, pathfinder: { bestHarvestTool: () => null } }
  const m = new Movements(bot); m.canDig = false; m.allow1by1towers = false; m.scafoldingBlocks = []; m.allowParkour = false
  m.exclusionAreasStep = [b => WS.wellStepCost([plan.cap], b)]
  const st = wellStand(w, plan.cap)
  if (!st) return { ok: false, why: 'no stand' }
  const r = new AStar(new Move(plan.start.x, plan.start.y, plan.start.z, 0, 0), m, new goals.GoalBlock(st.stand.x, st.stand.y, st.stand.z), 20000, 5000).compute()
  if (r.status !== 'success') return { ok: false, why: r.status }
  const stairSet = new Set(plan.stair.map(c => `${c[0]},${c[1] + 1},${c[2]}`))
  const inCol = r.path.filter(n => P.inColumn(plan.cap, n.x, n.y, n.z)).length
  return { ok: inCol === 0, why: inCol ? 'column' : null, nodes: r.path.length, inColumn: inCol, stairUsed: r.path.filter(n => stairSet.has(`${n.x},${n.y},${n.z}`)).length }
}
