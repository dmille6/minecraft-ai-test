#!/usr/bin/env node
// gathermem-01 PAPER DRIVER (2026-11-07). SANDBOX ONLY (Paper 1.21.8 on 10.0.0.30; never sandbox4). Report:
// docs/reports/wasted-attempts-2026-11-07.md (gathermem-01).
//
// A REAL mineflayer bot on a sandbox server, driven by the build's REAL Runner and gather skill and the REAL AdmissionControl
// from <botRoot> (unmodified). The same scenes run twice: GATHERMEM=1 (the change) and GATHERMEM=0 (the base behaviour, the
// same code with the switch off). WHAT IS SYNTHETIC, said in every result row:
//   - the arena: a stone plain (top y 105, the bot stands at 106) and, 4 blocks east across a 4-wide, 16-deep moat, a 5x5
//     stone ISLAND carrying 3 dirt cells at y 106. The island cells are the NEAREST dirt and look fine to every local test
//     (exposed, safe, approachable from the island's own floor); they cannot be reached (no bridge blocks, a 16-block drop).
//     In the `skip` scene one more dirt cell lies on the plain 12 blocks WEST (reachable, further);
//   - the bot carries only a stone shovel (so it cannot make bridge blocks from the plain), resistance;
//   - index.mjs's movement wiring is copied (as keepout-e2e does): the walk profile (no digging) and the gather profile;
//   - no reflexes, no decision loop: the driver calls runner.run('gather') and AdmissionControl.check directly, and puts the
//     bot back on its start cell between runs (so "from about here" holds, as for a bot that did not move);
//   - EXPIRY: the driver waits the real TTL (6 min + 10 s), it does not rewrite the memory.
// OUTCOMES FROM THE WORLD: every pathfinder goal the bot was sent (a recorder on bot.pathfinder.goto), the dirt cells read back
// by RCON, the build's own `_gathermem` rows.
//
//   node sandbox/gathermem/gathermem-e2e.mjs <botRoot> <label> <scene,scene> [server]
//   scenes: skip    island cells (3) + one reachable cell west: run 1, then run 2 from the same cell
//           expire  island cells (3) only: run 1; run 2 (all remembered); the admission checks; wait the TTL; run 3
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `gathermem01` as its owner's first word.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, LABEL, SCENES_S, SERVER = 'sandbox2'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENES_S) throw new Error('usage: gathermem-e2e.mjs <botRoot> <label> <scenes> [server]')
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'gathermem01')
const MEM = String(process.env.GATHERMEM ?? '1') !== '0'
const NAME = `sbx-gm-${(MEM ? 'on' : 'off')}${LABEL.replace(/[^a-z0-9]/gi, '').slice(0, 4)}`
const OUT = process.env.GM_OUT || path.join(os.tmpdir(), 'gathermem-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const LOGDIR = fs.mkdtempSync(path.join(OUT, `${LABEL}-`))
const STATE = fs.mkdtempSync(path.join(OUT, `${LABEL}-state-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const C = { x: 5200, y: 105, z: 5200 }          // the bot's start cell is (C.x, 106, C.z)
const HOME = { x: C.x + 300, y: 106, z: C.z }
Object.assign(process.env, {
  BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
  MEMORY_POOL: `sbxgm-${LABEL}`, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]), MINECRAFT_VERSION: '1.21.8',
  MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '8000', SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50',
  OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499', LLM_ENABLED: 'false', LOG_LEVEL: 'warn',
  CODE_VERSION: `sandbox-${LABEL}`, RUN_ID: 'sandbox-gathermem01', LOG_DIR: LOGDIR, STATE_DIR: STATE,
  HOME_X: String(HOME.x), HOME_Y: String(HOME.y), HOME_Z: String(HOME.z), GATHERMEM: MEM ? '1' : '0',
})
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const { pathfinder, Movements } = breq('mineflayer-pathfinder')
const { Runner } = await import(path.join(BOT_ROOT, 'bots/src/runner.mjs'))
const { tapRecords } = await import(path.join(BOT_ROOT, 'bots/src/logger.mjs'))
const { AdmissionControl } = await import(path.join(BOT_ROOT, 'bots/src/admission.mjs'))
const sha = process.env.GM_SHA || 'unknown'

// ---------------------------------------------------------------- RCON (sandbox only)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-gm-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
async function batch (cmds) {
  const out = []; for (let i = 0; i < cmds.length; i += 10) out.push(...rcon(...cmds.slice(i, i + 10)))
  const bad = out.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Could not/i.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
const isDirt = ([x, y, z]) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:dirt`))
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), label: LABEL, sha, server: SERVER, gathermem: MEM,
  synthetic: 'arena (an unreachable island of nearest dirt across a 16-deep moat); index.mjs movement wiring copied; no reflexes/decision loop; the bot reset to its start cell between runs; shovel only', ...r }) + '\n'); P_('RESULT', r) }

// ---------------------------------------------------------------- the arena
const R = 24
const ISLAND = { x0: C.x + 5, x1: C.x + 9, z0: C.z - 2, z1: C.z + 2 }        // 5x5, top y 105
const ISLAND_DIRT = [[C.x + 5, 106, C.z - 2], [C.x + 5, 106, C.z], [C.x + 5, 106, C.z + 2], [C.x + 7, 106, C.z - 2], [C.x + 7, 106, C.z + 2], [C.x + 9, 106, C.z]]
const WEST = [C.x - 12, 106, C.z]
async function arena (scene) {
  const x0 = C.x - R, x1 = C.x + R, z0 = C.z - R, z1 = C.z + R
  const c = [`kill @e[type=!player,x=${x0},y=85,z=${z0},dx=${2 * R},dy=40,dz=${2 * R}]`]
  for (let y = 86; y <= 118; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:${y <= 105 ? 'stone' : 'air'}`)
  // the moat: x C.x+1..C.x+13, z C.z-6..C.z+6, from y 89 up, 4 wide around the island
  c.push(`fill ${C.x + 1} 89 ${C.z - 6} ${C.x + 13} 105 ${C.z + 6} minecraft:air`)
  c.push(`fill ${ISLAND.x0} 89 ${ISLAND.z0} ${ISLAND.x1} 105 ${ISLAND.z1} minecraft:stone`)
  const cells = ISLAND_DIRT.slice(0, 3)   // three: one run's whole barren budget (BARREN_LIMIT 3)
  for (const [x, y, z] of cells) c.push(`setblock ${x} ${y} ${z} minecraft:dirt`)
  if (scene === 'skip') c.push(`setblock ${WEST[0]} ${WEST[1]} ${WEST[2]} minecraft:dirt`)
  await batch(c)
  return cells
}

// ---------------------------------------------------------------- the bot
let bot = null
async function connect () {
  bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', r => reject(new Error('kicked ' + r))); bot.once('error', reject) })
  bot.loadPlugin(pathfinder)
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect clear ${NAME}`, `effect give ${NAME} minecraft:resistance 1200 4 true`,
       `item replace entity ${NAME} container.0 with minecraft:stone_shovel 1`)
  await sleep(1500)
}
async function disconnect () { try { bot?.quit('scene over') } catch {} bot = null; await sleep(2500) }
function wire () {
  const moves = new Movements(bot); moves.canDig = false; moves.allowParkour = false
  const gatherMoves = Object.create(Object.getPrototypeOf(moves)); Object.assign(gatherMoves, moves)
  gatherMoves.canDig = true; gatherMoves.allow1by1towers = true; gatherMoves.maxDropDown = 6; gatherMoves.dontCreateFlow = true
  bot.pathfinder.setMovements(moves)
  bot.gatherMovements = gatherMoves
  bot.collectBlock = { movements: gatherMoves }
  bot.withGatherMovements = async fn => { bot.pathfinder.setMovements(gatherMoves); try { return await fn() } finally { bot.pathfinder.setMovements(moves) } }
  bot.ascentMovements = gatherMoves
  bot.withAscentMovements = bot.withGatherMovements
  bot.assertNav = () => {}
  // the recorder: every goal the pathfinder is sent, with where it points
  const goals = []
  const inner = bot.pathfinder.goto.bind(bot.pathfinder)
  bot.pathfinder.goto = (g, ...rest) => { goals.push({ x: g?.x ?? null, y: g?.y ?? null, z: g?.z ?? null, t: Date.now() }); return inner(g, ...rest) }
  return goals
}
const toStart = async () => { rcon(`tp ${NAME} ${C.x + 0.5} 106 ${C.z + 0.5}`); await sleep(2500) }
const island = g => g.x != null && g.x >= ISLAND.x0 - 2 && g.x <= ISLAND.x1 + 2
const west = g => g.x != null && g.x <= C.x - 8

async function gatherRun (runner, goals, rows, tag) {
  await toStart()
  const g0 = goals.length, r0 = rows.length, t = Date.now()
  const r = await runner.run('gather', { block: 'dirt', count: 1 }, { trigger: 'llm:sandbox' })
  const sent = goals.slice(g0)
  return { run: tag, status: r?.status, fc: r?.failClass ?? null, memo: r?.memoClass ?? null, s: +((Date.now() - t) / 1000).toFixed(1),
           goals: sent.length, islandGoals: sent.filter(island).length, westGoals: sent.filter(west).length,
           firstGoal: sent[0] ? (island(sent[0]) ? 'island' : west(sent[0]) ? 'west' : 'other') : 'none',
           detail: String(r?.detail ?? '').slice(0, 200),
           rows: rows.slice(r0).filter(x => /^_gathermem$/.test(x.skill?.name ?? '')).map(x => x.skill.detail).slice(0, 4),
           targets: (bot.gatherTargets ?? []).length, areas: (bot.gatherAreas ?? []).length }
}

async function scene (s) {
  await connect()
  rcon(`tp ${NAME} ${C.x + 0.5} 112 ${C.z + 30.5}`); await sleep(4000)
  for (let k = 0; k < 10 && /not loaded/.test(r1(`fill ${C.x - R} 86 ${C.z - R} ${C.x - R} 86 ${C.z - R} minecraft:stone`)); k++) await sleep(2000)
  const cells = await arena(s)
  const runner = new Runner(bot)
  const goals = wire()
  const rows = []; const untap = tapRecords(r => rows.push(r))
  const runs = []; let gate = null
  try {
    runs.push(await gatherRun(runner, goals, rows, 1))
    runs.push(await gatherRun(runner, goals, rows, 2))
    if (s === 'expire') {
      await toStart()
      const a = new AdmissionControl(null)
      const q = (skill, args) => { const v = a.check({ skill, args }, bot); return { ok: !!v?.ok, reason: v?.reason ?? null, detail: String(v?.detail ?? '').slice(0, 160) } }
      gate = { gatherDirt: q('gather', { block: 'dirt', count: 4 }), gatherLog: q('gather', { block: 'oak_log', count: 4 }), explore: q('explore', {}),
               memoryRefuses: a.memoryRefuses('gather', { block: 'dirt', count: 4 }) }
      P_('gate', gate, 'waiting the TTL')
      await sleep(6 * 60_000 + 10_000)
      gate.afterTtl = q('gather', { block: 'dirt', count: 4 })
      runs.push(await gatherRun(runner, goals, rows, 3))
    }
  } finally { untap() }
  const dirtLeft = cells.filter(isDirt).length
  const westLeft = s === 'skip' ? isDirt(WEST) : null
  const ev = { scene: s, runs, gate, islandDirtLeft: dirtLeft, islandDirt: cells.length, westDirtLeft: westLeft }
  await disconnect()
  return ev
}

async function main () {
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scenes=${SCENES_S} gathermem=${MEM}`)
  for (const s of SCENES_S.split(',')) {
    P_('=== scene', s)
    try { result(await scene(s)) } catch (e) { P_('scene failed', s, e.stack || e.message); result({ scene: s, error: String(e.message).slice(0, 300) }); await disconnect() }
  }
}
async function cleanup () {
  await disconnect().catch(() => {})
  try {
    const x0 = C.x - R, x1 = C.x + R, z0 = C.z - R, z1 = C.z + R
    const c = []
    for (let y = 86; y <= 118; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:${y <= 104 ? 'stone' : y === 105 ? 'grass_block' : 'air'}`)
    await connect(); rcon(`tp ${NAME} ${C.x + 0.5} 112 ${C.z + 30.5}`); await sleep(3000)
    await batch(c)
    await disconnect()
    P_('cleanup', rcon('list').map(x => x.reply.slice(0, 80)))
  } catch (e) { P_('cleanup failed', e.message) }
}
main().then(() => cleanup().then(() => process.exit(0)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
process.on('SIGINT', () => cleanup().then(() => process.exit(1)))
