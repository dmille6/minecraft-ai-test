#!/usr/bin/env node
// homefix-02 PAPER DRIVER (10-21). SANDBOX ONLY (Paper 1.21.8, 10.0.0.30:25599..25601). Design: docs/reports/
// homefix-02-design-2026-10-21.md §8 (S2, S3). S1 (the ice head cell, C1, the full bot) runs through
// sandbox/drown/hf2-ab.cjs.
//
// A REAL mineflayer bot on a sandbox server, driven by the REAL Runner, StagnationWatchdog, travel skills AND the real
// reflex layer (startReflexes + installOxygenGuard, as index.mjs) from <botRoot> (unmodified). What is synthetic is said so:
// the stuck "brain skill" (holds still; unwinds 1 s after an abort), the watchdog's clocks (window 30 s, sample 3 s, so a
// verdict comes in ~40 s instead of ~200 s: the C2/C3 decisions do not depend on the clocks), the level preset for S3
// (escalation = 1, so the next verdict is the level-2 home rescue), and the teleport that drops the bot into the trap the
// moment its home rescue STARTS (death 1's shape: a home rescue running when the bot is in the water). Outcomes are read
// from the WORLD (RCON `data get entity ... Air/Health/Pos`, `execute if block`) and from the build's own rows.
//
//   node sandbox/home/homefix2-e2e.mjs <botRoot> <label> <scene,scene,...> [server]
//   scenes: reloc_wet   (C2) a frozen river (ice over 1 water) covering 3/4 of the relocation ring; where do targets go?
//           home_ice    (C3+C1) the L2 home rescue starts; the bot is dropped into hive-d's 1-high water layer under ice
//           home_pocket (C3) the same into a 3x3x2 water room under a stone roof (the base air-pocket step handles the air)
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `homefix02` as its owner's first word. World edits on its arenas only.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, LABEL, SCENES_S, SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENES_S) throw new Error('usage: homefix2-e2e.mjs <botRoot> <label> <scenes> [server]')
// sandbox names/ports and the lock from the shared registry (sandbox/sandboxes.json via sandbox/lib/sbxlock.cjs);
// sandbox4 stays excluded: it is the model benchmark's
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'homefix02')
const NAME = `sandbox-Hf2${SERVER.replace(/\D/g, '') || '1'}`
const OUT = process.env.HF_OUT || path.join(os.tmpdir(), 'homefix2-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const LOGDIR = fs.mkdtempSync(path.join(OUT, `${LABEL}-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const H = { x: 3600, y: 120, z: 3600 }
Object.assign(process.env, {
  BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
  MEMORY_POOL: `sbxhf2-${LABEL}`, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]), MINECRAFT_VERSION: '1.21.8',
  MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '6000', SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50',
  OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499', LLM_ENABLED: 'false', LOG_LEVEL: 'warn',
  CODE_VERSION: `sandbox-${LABEL}`, RUN_ID: 'sandbox-homefix02', LOG_DIR: LOGDIR, STATE_DIR: fs.mkdtempSync(path.join(OUT, `${LABEL}-state-`)),
  HOME_X: String(H.x), HOME_Y: String(H.y), HOME_Z: String(H.z), BOARD_X: String(H.x), BOARD_Y: String(H.y), BOARD_Z: String(H.z),
})
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const { pathfinder, Movements } = breq('mineflayer-pathfinder')
const { config } = await import(path.join(BOT_ROOT, 'bots/src/config.mjs'))
const { SKILLS } = await import(path.join(BOT_ROOT, 'bots/src/skills.mjs'))
const { Runner } = await import(path.join(BOT_ROOT, 'bots/src/runner.mjs'))
const { StagnationWatchdog } = await import(path.join(BOT_ROOT, 'bots/src/watchdog.mjs'))
const { startReflexes } = await import(path.join(BOT_ROOT, 'bots/src/reflex.mjs'))
const { installOxygenGuard } = await import(path.join(BOT_ROOT, 'bots/src/oxygen.mjs'))
const { attachDifficulty } = await import(path.join(BOT_ROOT, 'bots/src/foodskip.mjs'))
const { tapRecords } = await import(path.join(BOT_ROOT, 'bots/src/logger.mjs'))
let sha = process.env.HF_SHA || ''; try { sha = sha || execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch { sha = sha || 'unknown' }
// THE SYNTHETIC CLOCKS (said so in every result row)
config.watchdog.windowMs = 30_000
config.watchdog.sampleMs = 3_000

// ---------------------------------------------------------------- RCON (sandbox only)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-hf2-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const num = s => { const m = /: (-?[\d.]+)/.exec(s); return m ? +m[1] : null }
const posOf = () => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${NAME} Pos`)); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null }
const tri = r => /Test passed/.test(r?.reply || '') ? true : /Test failed/.test(r?.reply || '') ? false : null
const setHome = h => { config.world.homeX = h.x; config.world.homeY = h.y; config.world.homeZ = h.z }
async function batch (cmds) {
  const out = []; for (let i = 0; i < cmds.length; i += 10) out.push(...rcon(...cmds.slice(i, i + 10)))
  const bad = out.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Could not/i.test(x.reply))
  if (bad.length) throw new Error('rcon: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
  return out
}

// ---------------------------------------------------------------- arenas
const R = 82          // the arena half-width: the relocation ring is 45-70 out, plus the 5-block volume and a margin
const AR = { x0: H.x - R, x1: H.x + R, z0: H.z - R, z1: H.z + R }
async function flatArena () {
  const c = [`kill @e[type=!player,x=${AR.x0},y=100,z=${AR.z0},dx=${2 * R},dy=40,dz=${2 * R}]`]
  for (let y = 112; y <= 132; y++) c.push(`fill ${AR.x0} ${y} ${AR.z0} ${AR.x1} ${y} ${AR.z1} minecraft:${y < 119 ? 'stone' : y === 119 ? 'grass_block' : 'air'}`)
  await batch(c)
}
// reloc_wet: a FROZEN RIVER (hive-d's shape: stone 117, water 118, ice 119; the grass level is 119) over the whole arena
// except the north-east quarter (x > H.x+10, z < H.z-10), which stays dry grass -- so 3/4 of the 45-70 ring is ice
async function riverArena () {
  await flatArena()
  const c = []
  for (const [y, b] of [[118, 'water'], [119, 'ice']]) c.push(`fill ${AR.x0} ${y} ${AR.z0} ${AR.x1} ${y} ${AR.z1} minecraft:${b}`)
  c.push(`fill ${H.x + 10} 118 ${AR.z0} ${AR.x1} 118 ${H.z - 10} minecraft:stone`, `fill ${H.x + 10} 119 ${AR.z0} ${AR.x1} 119 ${H.z - 10} minecraft:grass_block`)
  c.push(`fill ${H.x - 3} 118 ${H.z - 3} ${H.x + 3} 118 ${H.z + 3} minecraft:stone`, `fill ${H.x - 3} 119 ${H.z - 3} ${H.x + 3} 119 ${H.z + 3} minecraft:grass_block`)   // the bot's own dry island
  await batch(c)
}
// the traps, built at T (away from home): ICE = stone floor 116, water 117 (the feet), ICE 118 (the head cell), air room above
// (hive-d death 1); POCKET = stone floor 116, water 117-118, stone roof 119 and stone all round (the airpocket AF scene)
const T = { x: H.x - 40, z: H.z }
function trapCmds (kind) {
  const c = [`fill ${T.x - 4} 112 ${T.z - 4} ${T.x + 4} 124 ${T.z + 4} minecraft:stone`]
  if (kind === 'ice') c.push(`setblock ${T.x} 117 ${T.z} minecraft:water`, `setblock ${T.x} 118 ${T.z} minecraft:ice`, `fill ${T.x - 1} 119 ${T.z - 1} ${T.x + 1} 121 ${T.z + 1} minecraft:air`)
  // POCKET: a 3x3 room (not 1x1: the entombment reflex owns a 1x1 tomb and took the first run before any drowning)
  else c.push(`fill ${T.x - 1} 117 ${T.z - 1} ${T.x + 1} 118 ${T.z + 1} minecraft:water`)
  return c
}

// ---------------------------------------------------------------- the bot
let bot = null; let stopReflex = null
async function connect ({ resistance = true } = {}) {
  bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, auth: 'offline', version: '1.21.8' })
  // the server's difficulty, recorded as index.mjs does (the air-pocket admission's envelope reads it: without it the
  // step prices 2 HP/s, not peaceful's 0.5 -- the first home_pocket run hit exactly that)
  try { attachDifficulty(bot) } catch (e) { P_('difficulty recorder', e.message) }
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', r => reject(new Error('kicked ' + r))); bot.once('error', reject) })
  bot.loadPlugin(pathfinder)
  try { installOxygenGuard(bot) } catch (e) { P_('oxygen guard', e.message) }
  const moves = new Movements(bot); moves.canDig = false
  const ascend = Object.create(Object.getPrototypeOf(moves)); Object.assign(ascend, moves)
  ascend.canDig = true; ascend.allow1by1towers = true; ascend.dontCreateFlow = true; ascend.allowParkour = false; ascend.maxDropDown = 6
  bot.pathfinder.setMovements(moves)
  bot.ascentMovements = ascend
  bot.withAscentMovements = async fn => { bot.pathfinder.setMovements(ascend); try { return await fn() } finally { bot.pathfinder.setMovements(moves) } }
  bot.assertNav = () => {}
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect clear ${NAME}`,
       ...(resistance ? [`effect give ${NAME} minecraft:resistance 900 4 true`] : []),
       `item replace entity ${NAME} container.0 with minecraft:stone_pickaxe[damage=31] 1`,
       `item replace entity ${NAME} container.1 with minecraft:cobblestone 64`)
  await sleep(1500)
}
async function disconnect () { try { stopReflex?.() } catch {} stopReflex = null; try { bot?.quit('scene over') } catch {} bot = null; await sleep(3000) }
async function place (p) { rcon(`tp ${NAME} ${p.x} ${p.y} ${p.z}`); await sleep(2500) }
const rowsTap = () => { const rows = []; const untap = tapRecords(r => rows.push(r)); return { rows, untap } }
const brief = r => ({ t: r['@timestamp'], name: r.skill?.name, status: r.skill?.status, fc: r.skill?.fail_class, trigger: r.trigger,
                      args: r.skill?.name?.startsWith('_') ? r.skill.args : undefined, detail: String(r.skill?.detail ?? '').slice(0, 160) })
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), label: LABEL, sha, server: SERVER, clocks: 'window 30 s, sample 3 s (synthetic)', ...r }) + '\n'); P_('RESULT', r) }
function holdSkill (name, unwindMs) {
  SKILLS[name] = { run: (_ctx, _args, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => setTimeout(() => { const e = new Error('aborted'); e.aborted = true; reject(e) }, unwindMs), { once: true })
  }) }
}
const COG = { running: true, milestones: { allDone: false } }
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }

// ---------------------------------------------------------------- S2: relocation over wet terrain
async function sceneRelocWet (n = 3) {
  setHome({ x: H.x + 200, y: 120, z: H.z })              // home far away: the scene is about level 1
  await connect(); await place({ x: H.x + 0.5, y: 125, z: H.z + 0.5 }); await sleep(5000)
  await riverArena(); await place({ x: H.x + 0.5, y: 120, z: H.z + 0.5 })
  const { rows, untap } = rowsTap()
  const runner = new Runner(bot)
  const wd = new StagnationWatchdog(bot, runner, COG); runner.watchdog = wd; wd.start()
  const targets = []
  try {
    for (let i = 0; i < n; i++) {
      await place({ x: H.x + 0.5, y: 120, z: H.z + 0.5 })
      wd.escalation = 0
      holdSkill('__stuck', 1000)
      const brain = runner.run('__stuck', {}, { trigger: 'llm:idle' })
      const got = await waitFor(() => rows.filter(r => r.trigger === 'watchdog_relocate' && r.skill?.name === 'goto').length > i, 240_000, 500)
      await brain.catch(() => {})
      await waitFor(() => !wd.pending, 200_000, 500)
      const row = rows.filter(r => r.trigger === 'watchdog_relocate' && r.skill?.name === 'goto')[i]
      const req = rows.filter(r => r.skill?.name === '_watchdog_rescue' && r.skill.args?.phase === 'requested' && Number(r.skill.args?.level) === 1)[i]
      const landed = rows.filter(r => r.skill?.name === '_relocate_landed')[i]
      const tg = row?.skill?.args ?? null
      let world = null
      if (tg && Number.isFinite(+tg.x)) {
        const x = Math.round(+tg.x), z = Math.round(+tg.z), y = Math.round(+(tg.y ?? 120))
        const q = rcon(`execute if block ${x} ${y - 1} ${z} minecraft:ice`, `execute if block ${x} ${y - 1} ${z} minecraft:grass_block`, `execute if block ${x} ${y - 2} ${z} minecraft:water`)
        world = { stands_on_ice: tri(q[0]), stands_on_grass: tri(q[1]), water_below: tri(q[2]) }
      }
      const end = posOf()
      const endq = end ? rcon(`execute if block ${Math.floor(end.x)} ${Math.floor(end.y) - 1} ${Math.floor(end.z)} minecraft:ice`) : []
      targets.push({ i, got: !!got, target: tg, world, requested: req?.skill?.args ?? null, goto: row ? brief(row) : null,
                     landed: landed?.skill?.args ?? null, end, end_on_ice: endq.length ? tri(endq[0]) : null })
      P_('relocation', targets[targets.length - 1])
    }
  } finally { wd.stop(); untap() }
  await disconnect()
  return { scene: 'reloc_wet', targets, onIce: targets.filter(t => t.world?.stands_on_ice).length, onGrass: targets.filter(t => t.world?.stands_on_grass).length,
           endOnIce: targets.filter(t => t.end_on_ice).length, n: targets.length }
}

// ---------------------------------------------------------------- S3: a level-2 home rescue that meets water
async function sceneHomeWet (kind) {
  setHome({ x: H.x + 40, y: 120, z: H.z })               // home 80 blocks from the trap: the walk is long
  await connect({ resistance: false }); await place({ x: H.x + 0.5, y: 125, z: H.z + 0.5 }); await sleep(5000)
  await flatArena(); await batch(trapCmds(kind))
  await place({ x: H.x + 0.5, y: 120, z: H.z + 0.5 })
  const { rows, untap } = rowsTap()
  const runner = new Runner(bot)
  stopReflex = startReflexes(bot, runner, null, null)
  const wd = new StagnationWatchdog(bot, runner, COG); runner.watchdog = wd; wd.start()
  wd.escalation = 1                                       // the relocation "already failed": this verdict is level 2 (home)
  const polls = []; let dropped = null
  let t0 = Date.now()
  try {
    holdSkill('__stuck', 1000)
    const brain = runner.run('__stuck', {}, { trigger: 'llm:idle' })
    const started = await waitFor(() => rows.find(r => r.skill?.name === '_watchdog_rescue' && r.skill.args?.phase === 'started' && Number(r.skill.args?.level) === 2), 240_000, 100)
    if (started) {
      // DEATH 1's SHAPE: the home rescue is running and the bot is in the water
      rcon(`tp ${NAME} ${T.x + 0.5} 117 ${T.z + 0.5}`); dropped = Date.now(); t0 = dropped
    }
    await brain.catch(() => {})
    for (let s = 0; s < 150; s++) {
      const q = rcon(`data get entity ${NAME} Air`, `data get entity ${NAME} Health`, `data get entity ${NAME} Pos`, `execute if block ${T.x} 118 ${T.z} minecraft:ice`, `execute if block ${T.x} 119 ${T.z} minecraft:stone`)
      const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(q[2]?.reply || '')
      polls.push({ t: +((Date.now() - t0) / 1000).toFixed(1), air: num(q[0]?.reply || ''), hp: num(q[1]?.reply || ''), pos: m ? [+m[1], +m[2], +m[3]].map(v => +v.toFixed(2)) : null,
                   ice118: tri(q[3]), stone119: tri(q[4]) })
      const last = polls[polls.length - 1]
      if (last.hp != null && last.hp <= 6) { P_('HEALTH FLOOR: rescuing the bot by RCON (scene stopped)'); rcon(`tp ${NAME} ${H.x + 0.5} 121 ${H.z + 0.5}`, `effect give ${NAME} minecraft:instant_health 1 5 true`); last.stopped = true; break }
      if (s > 20 && last.air != null && last.air >= 290 && polls.slice(-5).every(p => p.air >= 290)) break   // breathing for 5 s
      await sleep(1000)
    }
    await waitFor(() => !wd.pending, 240_000, 1000)
  } finally { wd.stop(); untap() }
  const rescue = rows.filter(r => r.skill?.name === '_watchdog_rescue').map(r => ({ t: r['@timestamp'], ...r.skill.args }))
  const ev = { scene: `home_${kind}`, droppedAt: dropped ? new Date(dropped).toISOString() : null,
    rescue, yield: rows.filter(r => r.skill?.name === '_air_rescue_yield').map(brief), danger: rows.filter(r => r.skill?.name === '_air_danger').map(brief).slice(0, 4),
    airPocket: rows.filter(r => /^_air_pocket/.test(r.skill?.name ?? '')).map(brief), routes: rows.filter(r => r.skill?.name === '_drowning_route').map(brief).slice(0, 6),
    home: rows.filter(r => r.skill?.name === 'home').map(brief),
    minHp: Math.min(...polls.map(p => p.hp ?? 99)), minAir: Math.min(...polls.map(p => p.air ?? 999)), stopped: polls.some(p => p.stopped),
    breathedAt: polls.find(p => p.t > 3 && p.air >= 290)?.t ?? null, endPoll: polls[polls.length - 1], polls }
  await disconnect()
  return ev
}

async function main () {
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  P_(`root=${BOT_ROOT} sha=${sha} server=${SERVER} scenes=${SCENES_S}`)
  for (const s of SCENES_S.split(',')) {
    P_('=== scene', s)
    try {
      let ev
      if (s === 'reloc_wet') ev = await sceneRelocWet(Number(process.env.HF_RELOCS || 3))
      else if (s === 'home_ice') ev = await sceneHomeWet('ice')
      else if (s === 'home_pocket') ev = await sceneHomeWet('pocket')
      else throw new Error(`unknown scene ${s}`)
      result(ev)
    } catch (e) { P_('scene failed', s, e.stack || e.message); result({ scene: s, error: String(e.message).slice(0, 300) }); await disconnect() }
  }
}
async function cleanup () {
  await disconnect().catch(() => {})
  try {
    await connect(); await place({ x: H.x + 0.5, y: 125, z: H.z + 0.5 }); await sleep(3000)
    const c = [`kill @e[type=!player,x=${AR.x0},y=100,z=${AR.z0},dx=${2 * R},dy=40,dz=${2 * R}]`]
    for (let y = 112; y <= 132; y++) c.push(`fill ${AR.x0} ${y} ${AR.z0} ${AR.x1} ${y} ${AR.z1} minecraft:${y < 119 ? 'stone' : y === 119 ? 'grass_block' : 'air'}`)
    await batch(c)
    await disconnect()
    P_('cleanup', rcon('list').map(x => x.reply.slice(0, 80)))
  } catch (e) { P_('cleanup failed', e.message) }
}
main().then(() => cleanup().then(() => process.exit(0)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
process.on('SIGINT', () => cleanup().then(() => process.exit(1)))
