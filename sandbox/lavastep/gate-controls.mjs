#!/usr/bin/env node
// lavastep-01 READ GATE CONTROLS, OFFLINE (2026-10-23). No server: the executor (bots/src/lavastepmove.mjs) of <botRoot>
// -- the candidate, or a copy with ONE injected defect -- runs on a small kinematic fake world and writes its real
// `_lava_retreat` rows as JSONL. scripts/host/lavastepread.py --rows <file> must find 0 defects on the candidate's rows and
// catch each mutant's defect in the gate built for it (the design: "every gate has a mutant positive control: an injected
// defect, replayed on Paper or offline on recorded rows"). G2 and G5 are also replayed on Paper (lavastep-e2e.mjs).
//
//   node sandbox/lavastep/gate-controls.mjs <botRoot> <out.jsonl> [scene,...]
//   scenes: magma (an edge plan), deep1 (an in plan), edge (no plan: seal), edgeNone (no plan, no cobble: aim),
//           sealFail (a seal the server never places), fireSide (a plan only a DANGER-blind sweep would take)
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const [ROOT, OUT, SCENES_S = 'magma,deep1,edge,edgeNone,sealFail,fireSide'] = process.argv.slice(2)
if (!ROOT || !OUT) throw new Error('usage: gate-controls.mjs <botRoot> <out.jsonl> [scenes]')
process.env.OLLAMA_MODEL ??= 'gate-controls'
process.env.LOG_DIR ??= fs.mkdtempSync('/tmp/lsgc-')
const { makeDangerMover } = await import(path.join(ROOT, 'bots/src/lavastepmove.mjs'))
const { Vec3 } = createRequire(path.join(ROOT, 'bots/package.json'))('vec3')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const EMPTY = new Set(['air', 'cave_air', 'water', 'lava', 'flowing_lava', 'fire', 'soul_fire', 'bubble_column'])
const fill = (c, x0, x1, y0, y1, z0, z1, n) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) c[`${x},${y},${z}`] = n }
const WORLDS = {
  magma: () => ({ cells: { '0,63,0': 'magma_block' }, pos: [0.5, 64, 0.5], yaw: Math.atan2(-1, 0) }),
  deep1: () => { const c = {}; fill(c, 1, 4, 64, 64, -4, 4, 'lava'); return { cells: c, pos: [1.5, 64, 0.5], yaw: Math.atan2(-1, 0) } },
  edge: () => { const c = {}; fill(c, 1, 6, 62, 63, -4, 4, 'lava'); return { cells: c, pos: [1.2, 64, 0.5], yaw: Math.atan2(-1, 0), items: ['cobblestone'] } },
  edgeNone: () => { const c = {}; fill(c, 1, 6, 62, 63, -4, 4, 'lava'); return { cells: c, pos: [1.2, 64, 0.5], yaw: Math.atan2(-1, 0) } },
  sealFail: () => { const c = {}; fill(c, 1, 6, 62, 63, -4, 4, 'lava'); return { cells: c, pos: [1.2, 64, 0.5], yaw: Math.atan2(-1, 0), items: ['cobblestone'], placeWorks: false } },
  fireSide: () => ({ cells: { '0,63,0': 'magma_block', '-1,64,0': 'stone', '-1,65,0': 'stone', '0,64,-1': 'stone', '0,65,-1': 'stone', '0,64,1': 'fire' }, pos: [0.5, 64, 0.5], yaw: 0 }),
}
function fakeBot (w) {
  const map = new Map(Object.entries(w.cells))
  const name = (x, y, z) => { const k = `${x},${y},${z}`; return map.has(k) ? map.get(k) : (y < 64 ? 'stone' : 'air') }
  const at = (x, y, z) => { const n = name(x, y, z); return n == null ? null : { name: n, boundingBox: EMPTY.has(n) ? 'empty' : 'block', position: new Vec3(x, y, z) } }
  const bot = new EventEmitter()
  bot.entity = { position: new Vec3(...w.pos), yaw: w.yaw ?? 0, onGround: true, isInWater: false, eyeHeight: 1.62 }
  bot.health = 20; bot.controls = {}
  bot.setControlState = (n, v) => { bot.controls[n] = v }
  bot.look = (yaw) => { bot.entity.yaw = yaw; return Promise.resolve() }
  bot.blockAt = v => at(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z))
  bot.pathfinder = { goal: null, setGoal (g) { this.goal = g } }
  bot.inventory = { items: () => (w.items ?? []).map(n => ({ name: n, count: 64 })) }
  bot.heldItem = null
  bot.equip = it => { bot.heldItem = it; return Promise.resolve() }
  bot._genericPlace = async (ref, face) => {
    const c = [ref.position.x + face.x, ref.position.y + face.y, ref.position.z + face.z]
    if (w.placeWorks !== false && bot.heldItem) setTimeout(() => { const old = at(...c); map.set(c.join(), bot.heldItem.name); bot.emit('blockUpdate', old, at(...c)) }, 60)
  }
  const solid = (x, y, z) => at(x, y, z)?.boundingBox === 'block'
  bot._t = setInterval(() => {   // a walking body: the AABB (0.3) collides; no fall (every scene has a floor)
    if (!bot.controls.forward) return
    const p = bot.entity.position, sp = bot.controls.sprint ? 0.28 : 0.2
    const nx = p.x - Math.sin(bot.entity.yaw) * sp, nz = p.z - Math.cos(bot.entity.yaw) * sp
    const free = [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].every(([ox, oz]) => !solid(Math.floor(nx + ox), Math.floor(p.y), Math.floor(nz + oz)) && !solid(Math.floor(nx + ox), Math.floor(p.y) + 1, Math.floor(nz + oz)))
    if (free) { p.x = nx; p.z = nz }
  }, 50)
  return bot
}
const runner = { reserve: () => ({ gen: 1 }), releaseReservation () {}, interrupt () {} }
const out = fs.createWriteStream(OUT)
for (const sc of SCENES_S.split(',')) {
  const w = WORLDS[sc](); const bot = fakeBot(w)
  const rows = []
  const mv = makeDangerMover(bot, runner, { emit: r => rows.push(r), timing: { after: 100, aim: 400 } })
  const p = bot.entity.position
  await mv.maybeFire({ feet: bot.blockAt(p), below: bot.blockAt(p.offset(0, -1, 0)) })
  await sleep(150)
  clearInterval(bot._t)
  for (const r of rows) out.write(JSON.stringify({ '@timestamp': new Date().toISOString(), bot: { name: `gc-${sc}` },
    skill: { name: '_lava_retreat', args: r.args, detail: r.detail, status: 'success' } }) + '\n')
  out.write(JSON.stringify({ '@timestamp': new Date().toISOString(), bot: { name: `gc-${sc}` }, skill: { name: '_lavastep_mode', detail: 'on=1', args: {} } }) + '\n')
  console.log(sc, rows.map(r => r.detail).join(' | ').slice(0, 300))
}
out.end()
