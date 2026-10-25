#!/usr/bin/env node
// lavastep-01 READ GATE CONTROLS, OFFLINE, r2 (2026-10-23). No server, no world. The executor (bots/src/lavastepmove.mjs) of
// <botRoot> -- and of five copies of it, each with ONE design mutant injected (anchors asserted present and unique) -- runs
// on a small kinematic fake world and writes its real `_lava_retreat` rows; scripts/host/lavastepread.py --rows judges them.
// ASSERTED (exit 1 on any failure; driver review r1, both engines: rows alone prove nothing):
//   - the candidate: every scene emitted a firing with the expected path, all five gates 0, replay agreement 1.0;
//   - each mutant: its own gate >= 1 (G1 fireSide, G2 magma+deep1, G3 magma, G4 sealFail, G5 edgeNone).
// The design: "every gate has a mutant positive control: an injected defect, replayed on Paper or offline on recorded rows".
//
//   node sandbox/lavastep/gate-controls.mjs <botRoot> [readPath]     (readPath default <botRoot>/scripts/host/lavastepread.py)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const [ROOT, READ_ARG] = process.argv.slice(2)
if (!ROOT) throw new Error('usage: gate-controls.mjs <botRoot> [readPath]')
const READ = READ_ARG || path.join(ROOT, 'scripts/host/lavastepread.py')
if (!fs.existsSync(READ)) throw new Error(`no read at ${READ}`)
process.env.OLLAMA_MODEL ??= 'gate-controls'
process.env.LOG_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'lsgc-log-'))
const { Vec3 } = createRequire(path.join(ROOT, 'bots/package.json'))('vec3')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const EMPTY = new Set(['air', 'cave_air', 'water', 'lava', 'flowing_lava', 'fire', 'soul_fire', 'bubble_column'])
const fill = (c, x0, x1, y0, y1, z0, z1, n) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) c[`${x},${y},${z}`] = n }
// the scenes, as on Paper (deep1 is the SUNK pool with a step-up shore); `path` is what the candidate must do there
const WORLDS = {
  magma: { make: () => ({ cells: { '0,63,0': 'magma_block' }, pos: [0.5, 64, 0.5], yaw: Math.atan2(-1, 0) }), path: 'plan' },
  deep1: { make: () => { const c = {}; fill(c, 1, 4, 63, 63, -2, 2, 'lava'); return { cells: c, pos: [1.5, 63, 0.5], yaw: Math.atan2(-1, 0) } }, path: 'plan' },
  edge: { make: () => { const c = {}; fill(c, 1, 6, 62, 63, -4, 4, 'lava'); return { cells: c, pos: [1.2, 64, 0.5], yaw: Math.atan2(-1, 0), items: ['cobblestone'] } }, path: 'seal' },
  edgeNone: { make: () => { const c = {}; fill(c, 1, 6, 62, 63, -4, 4, 'lava'); return { cells: c, pos: [1.2, 64, 0.5], yaw: Math.atan2(-1, 0) } }, path: 'aim' },
  sealFail: { make: () => { const c = {}; fill(c, 1, 6, 62, 63, -4, 4, 'lava'); return { cells: c, pos: [1.2, 64, 0.5], yaw: Math.atan2(-1, 0), items: ['cobblestone'], placeWorks: false } }, path: 'seal>aim' },
  fireSide: { make: () => ({ cells: { '0,63,0': 'magma_block', '-1,64,0': 'stone', '-1,65,0': 'stone', '0,64,-1': 'stone', '0,65,-1': 'stone', '0,64,1': 'fire' }, pos: [0.5, 64, 0.5], yaw: 0 }), path: 'aim' },
}
const MUTANTS = {
  g1: { file: 'bots/src/lavastep.mjs', scenes: ['fireSide'], pairs: [
    ["      if (isDanger(o)) return { ok: false, to, dy: pick.dy, goal: false, why: `sweep danger at ${fx + lx},${fy},${fz + lz}` }\n", ''],
    ["    if (isDanger(d)) return { ok: false, to, dy: pick.dy, goal: false, why: `sweep danger at ${to[0] + lx},${to[1]},${to[2] + lz}` }\n", '']] },
  g2: { file: 'bots/src/lavastep.mjs', scenes: ['magma', 'deep1'], pairs: [
    ['  if (sp.plan) return { kase, plan: sp.plan, candidates: sp.candidates, seal: null, aim: null }\n', '  if (false) return { kase, plan: sp.plan, candidates: sp.candidates, seal: null, aim: null }\n']] },
  g3: { file: 'bots/src/lavastepmove.mjs', scenes: ['magma'], pairs: [['      const sprint = inStep && i === 0\n', '      const sprint = true\n']] },
  g4: { file: 'bots/src/lavastepmove.mjs', scenes: ['sealFail'], pairs: [["        if (s === 'witnessed') {\n          const o = await afterSeal('sealed')", "        if (true) {\n          const o = await afterSeal('sealed')"]] },
  g5: { file: 'bots/src/lavastepmove.mjs', scenes: ['edgeNone'], pairs: [['      const yaw = yawOf(ob.choice.b)\n', '      const yaw = bot.entity.yaw ?? 0\n']] },
}
const GATE = { g1: 'g1_step_unsafe', g2: 'g2_aim_over_plan', g3: 'g3_edge_sprint', g4: 'g4_seal_bad', g5: 'g5_aim_not_best' }

function fakeBot (w) {
  const map = new Map(Object.entries(w.cells))
  const name = (x, y, z) => { const k = `${x},${y},${z}`; return map.has(k) ? map.get(k) : (y < 64 ? 'stone' : 'air') }
  const at = (x, y, z) => { const n = name(x, y, z); return n == null ? null : { name: n, boundingBox: EMPTY.has(n) ? 'empty' : 'block', position: new Vec3(x, y, z) } }
  const listeners = new Map()
  const bot = {
    on: (e, h) => { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(h) },
    removeListener: (e, h) => listeners.get(e)?.delete(h),
    emit: (e, ...a) => { for (const h of [...(listeners.get(e) ?? [])]) h(...a) },
  }
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
  bot._t = setInterval(() => {   // a walking body whose AABB (0.3) collides; a 1-up step is taken with the jump held
    if (!bot.controls.forward) return
    const p = bot.entity.position, sp = bot.controls.sprint ? 0.28 : 0.2
    const nx = p.x - Math.sin(bot.entity.yaw) * sp, nz = p.z - Math.cos(bot.entity.yaw) * sp
    const fy = Math.floor(p.y)
    const free = y => [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].every(([ox, oz]) => !solid(Math.floor(nx + ox), y, Math.floor(nz + oz)) && !solid(Math.floor(nx + ox), y + 1, Math.floor(nz + oz)))
    if (free(fy)) { p.x = nx; p.z = nz } else if (bot.controls.jump && free(fy + 1)) { p.x = nx; p.z = nz; p.y = fy + 1 }
  }, 50)
  return bot
}
const runner = { reserve: () => ({ gen: 1 }), releaseReservation () {}, interrupt () {} }

async function rowsFor (root, scenes) {
  const { makeDangerMover } = await import(path.join(root, 'bots/src/lavastepmove.mjs') + `?r=${Math.random()}`)
  const lines = [], firings = {}
  for (const sc of scenes) {
    const w = WORLDS[sc].make(); const bot = fakeBot(w); const rows = []
    const mv = makeDangerMover(bot, runner, { emit: r => rows.push(r), timing: { after: 100, aim: 400 } })
    const p = bot.entity.position
    const out = mv.maybeFire({ feet: bot.blockAt(p), below: bot.blockAt(p.offset(0, -1, 0)) })
    if (out && typeof out.then === 'function') await out
    await sleep(150)
    clearInterval(bot._t)
    firings[sc] = rows.filter(r => r.args?.phase === 'firing').map(r => (r.args.path || []).join('>'))
    for (const r of rows) lines.push(JSON.stringify({ '@timestamp': new Date().toISOString(), bot: { name: `gc-${sc}` }, skill: { name: '_lava_retreat', args: r.args, detail: r.detail, status: 'success' } }))
  }
  return { lines, firings }
}
function judge (lines) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lsgc-')), 'rows.jsonl')
  fs.writeFileSync(f, lines.join('\n') + '\n')
  const r = spawnSync('python3', [READ, '--rows', f], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`the read failed: ${r.stderr || r.error}`)
  return JSON.parse(r.stdout)
}
function mutantRoot (name) {
  const m = MUTANTS[name]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lsgc-${name}-`))
  fs.mkdirSync(path.join(dir, 'bots'))
  fs.cpSync(path.join(ROOT, 'bots/src'), path.join(dir, 'bots/src'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'bots/package.json'), path.join(dir, 'bots/package.json'))
  fs.symlinkSync(fs.realpathSync(path.join(ROOT, 'bots/node_modules')), path.join(dir, 'bots/node_modules'))
  const p = path.join(dir, m.file)
  let s = fs.readFileSync(p, 'utf8')
  for (const [old, neu] of m.pairs) {
    const n = s.split(old).length - 1
    if (n !== 1) throw new Error(`mutant ${name}: anchor ${n === 0 ? 'MISSING' : 'NOT UNIQUE'}: ${JSON.stringify(old.slice(0, 60))}`)
    s = s.replace(old, neu)
  }
  fs.writeFileSync(p, s)
  return dir
}

let bad = 0
const say = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) bad++ }
// the candidate: coverage, zero defects, full replay agreement
const cand = await rowsFor(ROOT, Object.keys(WORLDS))
for (const [sc, w] of Object.entries(WORLDS)) say(cand.firings[sc]?.length >= 1 && cand.firings[sc][0] === w.path, `candidate ${sc}: a firing with path ${w.path} (got ${JSON.stringify(cand.firings[sc])})`)
const cj = judge(cand.lines)
say(Object.values(GATE).every(g => cj[g] === 0), `candidate: all gates 0 (${Object.values(GATE).map(g => `${g}=${cj[g]}`).join(' ')})`)
say(cj.replay_agree === 1 && cj.missing_reads === 0, `candidate: replay ${cj.replay_agree}, missing reads ${cj.missing_reads}`)
// each mutant: its own gate trips
for (const [name, m] of Object.entries(MUTANTS)) {
  const root = mutantRoot(name)
  const r = await rowsFor(root, m.scenes)
  const j = judge(r.lines)
  say(r.lines.length > 0 && j[GATE[name]] >= 1, `mutant ${name} on ${m.scenes.join('+')}: ${GATE[name]} = ${j[GATE[name]]} (${JSON.stringify(j._examples?.[name]?.[0] ?? '').slice(0, 140)})`)
}
console.log(bad ? `${bad} FAILED` : 'ALL CONTROLS PASS')
process.exit(bad ? 1 : 0)
