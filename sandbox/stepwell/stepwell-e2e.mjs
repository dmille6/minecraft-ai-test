#!/usr/bin/env node
// STEPWELL-01 PAPER DRIVER (2026-11-05). SANDBOX ONLY (Paper 1.21.8 on 10.0.0.30). A REAL mineflayer bot builds a stepwell tank
// planned by stepwell.mjs's own planTank, running the build's REAL stepwellvisit.mjs runStepwellVisit with the REAL effects:
// stepwellBotEffects over buildbot.mjs botBuildEffects (equip, bot.dig, the acknowledged block_place, the server's own block update as
// the witness) and skills.mjs stairWalk's walk (a bounded GoalBlock goto on the town-deposit profile: no digs, no scaffold).
// WHAT IS SYNTHETIC, said so in every result row: the arena (stone, three dirt, grass at GY: RCON fill); the bot placed by RCON `tp`
// and its kit given by RCON `give` (scene setup only); a scene's cave, water or lava set by RCON. OUTCOMES FROM THE SERVER: every
// planned cell's block after the run (`execute if block`), the bot's position (`data get entity`).
//
//   node sandbox/stepwell/stepwell-e2e.mjs <botRoot> <scene,scene,...> [server]
//   build   the whole one-tier tank (W 21) from flat ground: every cut air, every floor and trim built stone, every post a wall,
//           every light a torch ON its post (the new click: the top face of a wall), the builder at the exit
//   cave    a cave pocket under the court's floor and a water source in a tier wall's face: the under cells laid, the water
//           sealed before the cut beside it, the tank complete, no water left in the record's cells
//   lava    a lava source under a cut of the tier's last layer: the tank STOPS above it (onStop), nothing dug beside the lava
// Refuses unless a sandbox lock covering SERVER has `stepwell` as its owner's first word. World edits on its arena only.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, SCENES_S = 'build,cave,lava', SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT) throw new Error('usage: stepwell-e2e.mjs <botRoot> <scenes> [server]')
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'stepwell')
const NAME = 'sbx-stepwell'
const OUT = process.env.SW_OUT || path.join(os.tmpdir(), 'stepwell-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
Object.assign(process.env, {
  BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
  MEMORY_POOL: 'sbx-stepwell', MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]), MINECRAFT_VERSION: '1.21.8',
  MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '20000', SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50',
  OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499', LLM_ENABLED: 'false', LOG_LEVEL: 'warn',
  CODE_VERSION: 'sandbox-stepwell', RUN_ID: 'sandbox-stepwell', LOG_DIR: fs.mkdtempSync(path.join(OUT, 'log-')), STATE_DIR: fs.mkdtempSync(path.join(OUT, 'state-')),
  HOME_X: '7200', HOME_Y: '71', HOME_Z: '7570',
})
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const { pathfinder, Movements, goals } = breq('mineflayer-pathfinder')
const S = await import(path.join(BOT_ROOT, 'bots/src/stepwell.mjs'))
const V = await import(path.join(BOT_ROOT, 'bots/src/stepwellvisit.mjs'))
const { botBuildEffects } = await import(path.join(BOT_ROOT, 'bots/src/buildbot.mjs'))
const { townWalkMovements } = await import(path.join(BOT_ROOT, 'bots/src/towndeposit.mjs'))
let sha = 'unknown'; try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}

// ---------------------------------------------------------------- RCON (sandbox only)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-sw-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
async function batch (cmds, n = 200) {
  const out = []
  for (let i = 0; i < cmds.length; i += n) out.push(...rcon(...cmds.slice(i, i + n)))
  const bad = out.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Could not (?!set the block)|Expected|Invalid/i.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
const posOf = () => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${NAME} Pos`)); return m ? [+m[1], +m[2], +m[3]] : null }
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), sha, server: SERVER,
  synthetic: 'arena by RCON fill; bot placed by tp, kit by give; scene cave/water/lava by RCON setblock', ...r }) + '\n'); P_('RESULT', r) }

// ---------------------------------------------------------------- the arena and the plan
const C = { x: 7200, z: 7600 }, HALF = 16, GY = 70, W = 21
const HOME = { x: C.x, y: GY + 1, z: C.z - 30 }
const AWAY = 's'
const ORIGIN = S.originFor(C.x, C.z, AWAY, W)
const PLAN = S.planTank({ origin: ORIGIN, away: AWAY, g: GY, W, T: 1 })
const set = (c, id) => `setblock ${c[0]} ${c[1]} ${c[2]} minecraft:${id}`
async function arena () {
  const x0 = C.x - HALF, x1 = C.x + HALF, z0 = C.z - HALF, z1 = C.z + HALF
  await batch([`forceload add ${x0} ${z0} ${x1} ${z1}`], 1)
  await sleep(3000)
  const c = [`kill @e[type=!player,x=${x0},y=0,z=${z0},dx=${2 * HALF},dy=110,dz=${2 * HALF}]`]
  for (let y = GY + 1; y <= GY + 10; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:air`)
  for (let y = GY - 12; y <= GY - 4; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:stone`)
  for (let y = GY - 3; y <= GY - 1; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:dirt`)
  c.push(`fill ${x0} ${GY} ${z0} ${x1} ${GY} ${z1} minecraft:grass_block`)
  c.push('difficulty peaceful', 'gamerule doDaylightCycle false', 'time set day')
  await batch(c)
}
/** THE SERVER'S TRUTH over the plan: per role, the cells that read their role's block, and the misses. */
const ROLE_TEST = {
  floor: ['stone_bricks', 'cobblestone'], trim: ['stone_bricks', 'cobblestone'], post: ['cobblestone_wall'], light: ['torch'],
  wall: ['cobblestone', 'stone_bricks', 'stone'], body: ['cobblestone', 'stone', 'dirt'], under: ['cobblestone', 'stone', 'dirt', 'stone_bricks'],
}
function truth () {
  const tests = []
  for (const c of PLAN.cut) tests.push({ role: 'cut', at: c.at, ids: ['air'] })
  for (const e of PLAN.cells) tests.push({ role: e.role, at: e.at, ids: ROLE_TEST[e.role] ?? ['stone'] })
  const cmds = tests.flatMap(q => q.ids.map(id => `execute if block ${q.at.join(' ')} minecraft:${id}`))
  const res = []
  for (let i = 0; i < cmds.length; i += 400) res.push(...rcon(...cmds.slice(i, i + 400)))
  const out = {}
  let k = 0
  for (const q of tests) {
    // every id's reply is consumed (a short-circuit here misaligned every later cell: the first run's truth was wrong)
    const hits = q.ids.map(() => /Test passed/.test(res[k++]?.reply ?? ''))
    const ok = hits.some(Boolean)
    const b = (out[q.role] ??= { ok: 0, bad: [] })
    if (ok) b.ok++; else b.bad.push(q.at.join(','))
  }
  for (const v of Object.values(out)) { v.n = v.bad.length; v.bad = v.bad.slice(0, 8) }
  return out
}
const water = () => {
  let n = 0
  const cmds = []
  for (const e of PLAN.cells) cmds.push(`execute if block ${e.at.join(' ')} minecraft:water`)
  for (const c of PLAN.cut) cmds.push(`execute if block ${c.at.join(' ')} minecraft:water`)
  for (let i = 0; i < cmds.length; i += 400) n += rcon(...cmds.slice(i, i + 400)).filter(x => /Test passed/.test(x.reply)).length
  return n
}

// ---------------------------------------------------------------- the bot
let bot = null, moves = null, townMoves = null
async function connect () {
  bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', r => reject(new Error('kicked ' + r))); bot.once('error', reject) })
  bot.loadPlugin(pathfinder)
  // index.mjs's walk profile (moves) and the town-deposit walk on it (towndeposit.mjs townWalkMovements)
  moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = true; moves.allowParkour = false; moves.maxDropDown = 6
  townMoves = townWalkMovements(moves)
  bot.pathfinder.setMovements(moves)
  bot.withTownDepositWalk = async fn => { bot.pathfinder.setMovements(townMoves); try { return await fn() } finally { bot.pathfinder.setMovements(moves) } }
  await sleep(1500)
}
async function kit () {
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect clear ${NAME}`, `effect give ${NAME} minecraft:saturation 3600 1 true`,
    `give ${NAME} minecraft:iron_pickaxe 1`, `give ${NAME} minecraft:iron_pickaxe 1`, `give ${NAME} minecraft:iron_pickaxe 1`, `give ${NAME} minecraft:iron_pickaxe 1`,
    `give ${NAME} minecraft:iron_shovel 1`, `give ${NAME} minecraft:iron_shovel 1`, `give ${NAME} minecraft:iron_shovel 1`, `give ${NAME} minecraft:cobblestone 320`, `give ${NAME} minecraft:stone_bricks 192`,
    `give ${NAME} minecraft:cobblestone_wall 64`, `give ${NAME} minecraft:cobblestone_wall 64`, `give ${NAME} minecraft:cobblestone_wall 64`, `give ${NAME} minecraft:torch 64`)
  await sleep(1500)
}
async function place (feet) {
  rcon(`tp ${NAME} ${feet[0] + 0.5} ${feet[1]} ${feet[2] + 0.5}`)
  await sleep(2500)
  for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(250)
  try { await Promise.race([bot.waitForChunksToLoad(), sleep(15_000)]) } catch {}
}
/** skills.mjs stairWalk, as written (a bounded GoalBlock goto on the town-deposit walk; arrival within 1). */
async function stairWalk (cell, ms) {
  let timer = null
  const go = () => bot.pathfinder.goto(new goals.GoalBlock(cell[0], cell[1], cell[2]))
  const walk = bot.withTownDepositWalk(go)
  try {
    await Promise.race([walk, new Promise(resolve => { timer = setTimeout(() => { try { bot.pathfinder.setGoal(null) } catch {} resolve() }, ms) })])
    await Promise.race([walk.catch(() => {}), new Promise(r => setTimeout(r, 2_000))])
  } catch { /* the walk's own failure: arrival decides */ } finally { if (timer) clearTimeout(timer) }
  const p = bot.entity?.position
  return !!p && Math.abs(Math.floor(p.x) - cell[0]) <= 1 && Math.abs(Math.floor(p.z) - cell[2]) <= 1 && Math.abs(Math.floor(p.y + 1e-6) - cell[1]) <= 1
}
async function visits (label, { maxVisits = 30, extra = {} } = {}) {
  const t0 = Date.now()
  let stopped = null, last = null, dug = 0, placed = 0, n = 0
  const counts = {}
  while (n < maxVisits) {
    n++
    const B = botBuildEffects(bot, { withWalk: fn => bot.withTownDepositWalk(fn), aborted: () => false, log: () => {} })
    const e = V.stepwellBotEffects(bot, B, { palette: S.paletteFor(1), walk: c => stairWalk(c, 20_000), log: (op, d) => { counts[op] = (counts[op] ?? 0) + 1; if (op === 'refused' || op === 'stop' || op === 'egress') P_(op, d) } })
    last = await V.runStepwellVisit({ plan: PLAN, exit: PLAN.exit, onStop: async (y, why) => { stopped = { y, why } } }, e, { deadline: Date.now() + 150_000, lights: () => true })
    try { B.close() } catch {}
    dug += last.dug; placed += last.placed
    P_('visit', label, n, { stop: last.stop, why: last.why, y: last.y, dug: last.dug, placed: last.placed, skipped: last.skipped, tiers: last.tiers, walls: bot.inventory.items().filter(i => /_wall$/.test(i.name)).reduce((a, i) => a + i.count, 0), free: bot.inventory.emptySlotCount() })
    if (last.stop === 'no_material') break
    if (last.stop === 'complete' || last.stop === 'stopped') break
    if (last.stop === 'unknown') await sleep(3000)   // the bot's chunks: the next visit reads again
  }
  await sleep(1500)
  const pos = posOf()
  const atExit = !!pos && Math.floor(pos[0]) === PLAN.exit[0] && Math.floor(pos[1] + 1e-6) === PLAN.exit[1] && Math.floor(pos[2]) === PLAN.exit[2]
  return { scene: label, visits: n, stop: last?.stop, stopped, dug, placed, counts, ms: Date.now() - t0, pos, atExit, ...extra }
}

try {
  P_('arena', { server: SERVER, origin: ORIGIN, away: AWAY, W, T: 1, cells: PLAN.cells.length, cuts: PLAN.cut.length, exit: PLAN.exit, sha, walk: S.walkCheck(PLAN.cols, W).ok })
  await connect()
  for (const scene of SCENES_S.split(',')) {
    await arena()
    await kit()
    const extra = {}
    if (scene === 'cave') {
      // a 3-long air pocket under the court's floor (its `under` cells) and a water source in a tier-1 wall face (a record cell)
      const under = PLAN.cells.filter(e => e.role === 'under' && e.y === GY - 5).slice(0, 3)
      const face = PLAN.cells.find(e => e.role === 'wall' && e.y === GY - 2)
      await batch([...under.map(e => set(e.at, 'air')), set(face.at, 'water')])
      extra.cave = under.map(e => e.at.join(',')); extra.water = face.at.join(',')
    }
    if (scene === 'lava') {
      const c = PLAN.cut.find(q => q.at[1] === GY - 3 && q.at[0] === C.x && q.at[2] === C.z)
      const lava = [c.at[0], c.at[1] - 1, c.at[2]]
      // a lava source under a cut cell of the tier's last layer (the court floor cell above it is a record cell: under, then lava)
      await batch([set([lava[0], lava[1] - 1, lava[2]], 'stone'), set(lava, 'lava')])
      extra.lava = lava.join(',')
    }
    await place([PLAN.exit[0], PLAN.exit[1], PLAN.exit[2] - 2])
    const r = await visits(scene, { extra })
    const tr = truth()
    if (scene === 'cave') r.waterLeft = water()
    if (scene === 'lava') r.lavaStill = /Test passed/.test(r1(`execute if block ${extra.lava.split(',').join(' ')} minecraft:lava`))
    const allOk = Object.values(tr).every(v => v.n === 0)
    const ok = scene === 'lava' ? r.stop === 'stopped' && r.lavaStill : r.stop === 'complete' && allOk && r.atExit && (scene !== 'cave' || r.waterLeft === 0)
    const inv = {}; for (const i of bot.inventory.items()) inv[i.name] = (inv[i.name] ?? 0) + i.count
    result({ ...r, ok, inv, truth: Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, `${v.ok}/${v.ok + v.n}${v.n ? ' bad ' + v.bad.join(' ') : ''}`])) })
  }
} catch (e) {
  P_('ERROR', String(e?.stack ?? e))
  result({ scene: 'error', ok: false, error: String(e?.message ?? e).slice(0, 300) })
} finally {
  try { bot?.quit() } catch {}
  setTimeout(() => process.exit(0), 1500)
}
