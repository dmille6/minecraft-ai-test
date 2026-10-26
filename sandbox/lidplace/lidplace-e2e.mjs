#!/usr/bin/env node
// lidplace-01 PAPER DRIVER (2026-10-26). SANDBOX ONLY (never sandbox4: the model benchmark's).
//
// A REAL mineflayer bot on a sandbox server, driven by the build's REAL Runner and `gather` skill from <botRoot> (unmodified).
// WHAT IS SYNTHETIC, said so in every result row:
//   - the arena: a flat plain (stone to 101, dirt 102-105, open air from 106) with one chest standing on it and ONE spruce
//     log floating 7 above the chest, so the only way to cut it is to tower (the showcase shape: Gale, 10-25 19:06Z, towered
//     for spruce_log on top of found-01's store chest);
//   - index.mjs's movement profiles are copied here (index.mjs is not importable): the walk profile (no digging, towers,
//     placeCost 5, maxDropDown 6) and the gather approach cloned from it (canDig, towers, dontCreateFlow); when <botRoot> has
//     bots/src/lidplace.mjs its makeLidPlacePrice is appended to exclusionAreasPlace EXACTLY as index.mjs builds it (the
//     world's state id under the asked cell; no town plan in the sandbox, so guard() is null). A base build has no
//     lidplace.mjs: nothing is installed (the base as shipped);
//   - no reflex layer; resistance on the bot (a fall off a tower is not the question).
// OUTCOMES FROM THE WORLD: every block the bot placed (a recorder on bot._genericPlace, under bot.placeBlock, which
// mineflayer-pathfinder's executor calls), the lid cell read back by RCON (`execute if block <lid> minecraft:air`), whether the log is gone, the
// spruce logs in the bag, and the bot's position by RCON.
//
//   node sandbox/lidplace/lidplace-e2e.mjs <botRoot> <label> <scene,scene,...> [server]
//   scenes: onchest  the bot stands ON the chest; `gather 1 spruce_log`
//           beside   the bot stands one block east of the chest; `gather 1 spruce_log`
//           pit      the chest is the floor of a 1x1 bedrock pit 4 deep, the bot on it; the log is on the plain 6 blocks
//                    east: the lid tower is the ONLY way out -- the candidate must still take it (a price, never a veto)
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `lidplace01` as its owner's first word.
// World edits on its arena only; the arena is restored to a plain at the end.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, LABEL, SCENES_S, SERVER = 'sandbox7'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENES_S) throw new Error('usage: lidplace-e2e.mjs <botRoot> <label> <scenes> [server]')
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'lidplace01')
const NAME = `sbx-lp-${LABEL.replace(/[^a-z0-9]/gi, '').slice(0, 6)}`
const OUT = process.env.LP_OUT || path.join(os.tmpdir(), 'lidplace-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const LOGDIR = fs.mkdtempSync(path.join(OUT, `${LABEL}-`))
const STATE = fs.mkdtempSync(path.join(OUT, `${LABEL}-state-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const C = { x: 5200, y: 106, z: 5200 }          // the chest (it stands on the plain's surface)
const HOME = { x: C.x + 200, y: 106, z: C.z }   // far away: no town rule of the build fires here
Object.assign(process.env, {
  BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
  MEMORY_POOL: `sbxlp-${LABEL}`, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]), MINECRAFT_VERSION: '1.21.8',
  MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '8000', SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50',
  OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499', LLM_ENABLED: 'false', LOG_LEVEL: 'warn',
  CODE_VERSION: `sandbox-${LABEL}`, RUN_ID: 'sandbox-lidplace01', LOG_DIR: LOGDIR, STATE_DIR: STATE,
  HOME_X: String(HOME.x), HOME_Y: String(HOME.y), HOME_Z: String(HOME.z),
})
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const { pathfinder, Movements } = breq('mineflayer-pathfinder')
const { SKILLS } = await import(path.join(BOT_ROOT, 'bots/src/skills.mjs'))
void SKILLS
const { Runner } = await import(path.join(BOT_ROOT, 'bots/src/runner.mjs'))
const { tapRecords } = await import(path.join(BOT_ROOT, 'bots/src/logger.mjs'))
const LPPATH = path.join(BOT_ROOT, 'bots/src/lidplace.mjs')
const LP = fs.existsSync(LPPATH) ? await import(LPPATH) : null
const sha = (() => { try { return execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return 'unknown' } })()

// ---------------------------------------------------------------- RCON (sandbox only)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-lp-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const posOf = () => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${NAME} Pos`)); return m ? { x: +(+m[1]).toFixed(2), y: +(+m[2]).toFixed(2), z: +(+m[3]).toFixed(2) } : null }
const isBlock = (x, y, z, b) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${b}`))
async function batch (cmds) {
  const out = []; for (let i = 0; i < cmds.length; i += 10) out.push(...rcon(...cmds.slice(i, i + 10)))
  const bad = out.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Could not/i.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), label: LABEL, sha, server: SERVER, lidplace_build: !!LP,
  synthetic: 'arena; index.mjs movement profiles + lid price copied; no reflexes; resistance', ...r }) + '\n'); P_('RESULT', r) }

// ---------------------------------------------------------------- the arena
const R = 24
const LOG = s => (s === 'pit' ? { x: C.x + 6, y: 106, z: C.z } : { x: C.x, y: 113, z: C.z })
async function plain () {
  const x0 = C.x - R, x1 = C.x + R, z0 = C.z - R, z1 = C.z + R
  const c = [`kill @e[type=!player,x=${x0},y=90,z=${z0},dx=${2 * R},dy=40,dz=${2 * R}]`]
  for (let y = 90; y <= 125; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:${y <= 101 ? 'stone' : y <= 105 ? 'dirt' : 'air'}`)
  return c
}
async function arena (s) {
  const c = await plain()
  c.push(`setblock ${C.x} ${C.y} ${C.z} minecraft:chest`)
  if (s === 'pit') {
    // the chest is the pit's floor: a bedrock ring 106..110 around it, so the rim top is 111 (four blocks over the lid)
    c.push(`fill ${C.x - 1} 106 ${C.z - 1} ${C.x + 1} 110 ${C.z + 1} minecraft:bedrock`, `fill ${C.x} 107 ${C.z} ${C.x} 110 ${C.z} minecraft:air`)
    c.push(`setblock ${C.x} ${C.y} ${C.z} minecraft:chest`)
  }
  const L = LOG(s)
  c.push(`setblock ${L.x} ${L.y} ${L.z} minecraft:spruce_log`)
  await batch(c)
}

// ---------------------------------------------------------------- the bot
let bot = null
async function connect () {
  bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', r => reject(new Error('kicked ' + r))); bot.once('error', reject) })
  bot.loadPlugin(pathfinder)
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect clear ${NAME}`, `effect give ${NAME} minecraft:resistance 900 4 true`,
       `item replace entity ${NAME} container.0 with minecraft:stone_axe 1`, `item replace entity ${NAME} container.1 with minecraft:dirt 32`)
  await sleep(1500)
}
async function disconnect () { try { bot?.quit('scene over') } catch {} bot = null; await sleep(2500) }

function wire () {
  // THE MOVEMENTS, as index.mjs builds them (the parts a tower or a bridge reads)
  const moves = new Movements(bot)
  moves.canDig = false; moves.allow1by1towers = true; moves.allowParkour = false; moves.maxDropDown = 6; moves.placeCost = 5
  if (LP) {
    // index.mjs, verbatim in shape: one scratch Vec3, the world's state id, the plan guard (none in the sandbox)
    const { Vec3 } = breq('vec3')
    const lidScratch = new Vec3(0, 0, 0)
    const lidPlacePrice = LP.makeLidPlacePrice({ registry: bot.registry, on: LP.lidPlaceOn(process.env), guard: () => bot.townPlan?.guard ?? null,
      stateIdAt: (x, y, z) => { lidScratch.x = x; lidScratch.y = y; lidScratch.z = z; return bot.world.getBlockStateId(lidScratch) } })
    moves.exclusionAreasPlace = moves.exclusionAreasPlace.concat(lidPlacePrice)
  }
  const gatherMoves = Object.create(Object.getPrototypeOf(moves)); Object.assign(gatherMoves, moves)
  gatherMoves.canDig = true; gatherMoves.allowParkour = false; gatherMoves.allow1by1towers = true; gatherMoves.maxDropDown = 6; gatherMoves.dontCreateFlow = true
  bot.pathfinder.setMovements(moves)
  bot.gatherMovements = gatherMoves
  bot.collectBlock = { movements: gatherMoves }
  bot.withGatherMovements = async fn => { bot.pathfinder.setMovements(gatherMoves); try { return await fn() } finally { bot.pathfinder.setMovements(moves) } }
  bot.ascentMovements = gatherMoves
  bot.withAscentMovements = bot.withGatherMovements
  bot.assertNav = () => {}
  // the recorder: every block placed -- mineflayer's placeBlock, placeEntity and activate-placing all go through
  // bot._genericPlace(ref, face), which mineflayer-pathfinder's executor reaches via bot.placeBlock(ref, face)
  const placed = []
  const gp = bot._genericPlace?.bind(bot)
  if (gp) bot._genericPlace = (ref, face, ...rest) => { const p = ref?.position?.plus?.(face); if (p) placed.push({ x: p.x, y: p.y, z: p.z, t: Date.now() }); return gp(ref, face, ...rest) }
  // ...and every dig (a block placed and dug again is not a block on the lid)
  const dg = bot.dig.bind(bot)
  bot.dig = (b, ...rest) => { const p = b?.position; if (p) placed.digs.push(`${p.x},${p.y},${p.z}:${b.name}`); return dg(b, ...rest) }
  placed.digs = []
  return placed
}

async function scene (s) {
  await connect()
  rcon(`tp ${NAME} ${C.x + 0.5} 115 ${C.z + 16.5}`); await sleep(4000)       // load the chunks first
  for (let k = 0; k < 10 && /not loaded/.test(r1(`fill ${C.x - R} 90 ${C.z - R} ${C.x - R} 90 ${C.z - R} minecraft:stone`)); k++) await sleep(2000)
  await arena(s)
  const start = s === 'beside' ? { x: C.x + 1.5, y: 106, z: C.z + 0.5 } : { x: C.x + 0.5, y: 107, z: C.z + 0.5 }
  rcon(`tp ${NAME} ${start.x} ${start.y} ${start.z}`); await sleep(3000)
  const runner = new Runner(bot)
  const placed = wire()
  const rows = []; const untap = tapRecords(r => rows.push(r))
  const runs = []
  try {
    runs.push(['gather', await runner.run('gather', { block: 'spruce_log', count: 1 }, { trigger: 'llm:sandbox' })])
  } finally { untap() }
  await sleep(1500)
  const end = posOf()
  const L = LOG(s)
  const lid = { x: C.x, y: C.y + 1, z: C.z }
  const onLid = placed.filter(p => p.x === lid.x && p.z === lid.z && (p.y === lid.y || p.y === lid.y + 1))
  const ev = { scene: s, start, end,
    lidAir: isBlock(lid.x, lid.y, lid.z, 'air'),
    lidColumn: [0, 1, 2, 3].map(d => `${lid.y + d}:${['air', 'dirt', 'spruce_log', 'chest', 'bedrock'].find(b => isBlock(lid.x, lid.y + d, lid.z, b)) ?? 'other'}`).join(' '), chestThere: isBlock(C.x, C.y, C.z, 'chest'), logGone: isBlock(L.x, L.y, L.z, 'air'),
    logsInBag: bot.inventory.items().filter(i => i.name === 'spruce_log').reduce((a, i) => a + i.count, 0),
    digs: placed.digs.slice(0, 12),
    placed: placed.length, placedOnLid: onLid.length, placedCells: placed.slice(0, 16).map(p => `${p.x},${p.y},${p.z}`),
    runs: runs.map(([k, r]) => ({ skill: k, status: r?.status, fc: r?.failClass ?? null, detail: String(r?.detail ?? '').slice(0, 220) })),
    rows: rows.filter(r => /^_(goto|gather|approach|reach)/.test(r.skill?.name ?? '')).map(r => ({ name: r.skill?.name, status: r.skill?.status, detail: String(r.skill?.detail ?? '').slice(0, 160) })).slice(0, 8) }
  await disconnect()
  return ev
}

async function main () {
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scenes=${SCENES_S} lidplace=${!!LP}`)
  for (const s of SCENES_S.split(',')) {
    P_('=== scene', s)
    try { result(await scene(s)) } catch (e) { P_('scene failed', s, e.stack || e.message); result({ scene: s, error: String(e.message).slice(0, 300) }); await disconnect() }
  }
}
async function cleanup () {
  await disconnect().catch(() => {})
  try {
    await connect(); rcon(`tp ${NAME} ${C.x + 0.5} 115 ${C.z + 16.5}`); await sleep(3000)
    const c = await plain()
    // the plain the seed had is not restored cell for cell; a grass cap over dirt, as every arena driver leaves it
    c.push(`fill ${C.x - R} 105 ${C.z - R} ${C.x + R} 105 ${C.z + R} minecraft:grass_block`)
    await batch(c)
    await disconnect()
    P_('cleanup', rcon('list').map(x => x.reply.slice(0, 80)))
  } catch (e) { P_('cleanup failed', e.message) }
}
main().then(() => cleanup().then(() => process.exit(0)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
process.on('SIGINT', () => cleanup().then(() => process.exit(1)))
