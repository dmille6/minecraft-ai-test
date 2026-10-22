#!/usr/bin/env node
// homefix-01 PAPER DRIVER (10-20). SANDBOX ONLY (Paper 1.21.8, 10.0.0.30:25599..25602). Spec: docs/reports/
// expansion-plan-2026-10-19.md §5 "Paper scenes" P0-P3.
//
// A REAL mineflayer bot on the sandbox server, driven by the REAL Runner, StagnationWatchdog and travel skills from
// <botRoot> (unmodified), at PRODUCTION clocks (watchdog window 180 s, sample 15 s, skill timeout 180 s, reservation 20 s).
// What is synthetic is said so: the "brain skill" that is stuck (it holds still and unwinds after N s when aborted), the
// P2 rescue that creeps (real pathfinder steps, one block per 15 s, back and forth), and the P3 entombment reflex (the
// reflex's two actions: runner.interrupt('entombed') and its own pathfinder goal). Movements mirror index.mjs (walk:
// canDig=false; ascent: canDig, 1x1 towers, dontCreateFlow, maxDropDown 6) without the town-block protections.
// Outcomes are read from the WORLD (RCON `data get entity ... Pos`) and from the runner's own rows, never from intent.
//
//   node sandbox/home/homefix-e2e.mjs <botRoot> <label> <scene,scene,...> [server]
//   scenes: p0a p0b p1 p1far p1in p2 p3
// Refuses unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `homefix`. World edits on its arenas only.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, LABEL, SCENES_S, SERVER = 'sandbox4'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENES_S) throw new Error('usage: homefix-e2e.mjs <botRoot> <label> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
if (!/homefix/.test(lock)) throw new Error(`the sandbox lock does not name homefix: ${lock.trim()}`)
const NAME = 'sandbox-Homefix'
const OUT = process.env.HF_OUT || path.join(os.tmpdir(), 'homefix-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const LOGDIR = fs.mkdtempSync(path.join(OUT, `${LABEL}-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// the bot's config, before any bot module is imported (production clocks; the sandbox server; logs in a scratch dir)
Object.assign(process.env, {
  BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
  MEMORY_POOL: `sbxhomefix-${LABEL}`, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]), MINECRAFT_VERSION: '1.21.8',
  MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '6000', SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '50',
  OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499', LLM_ENABLED: 'false', LOG_LEVEL: 'warn',
  CODE_VERSION: `sandbox-${LABEL}`, RUN_ID: 'sandbox-homefix', LOG_DIR: LOGDIR, STATE_DIR: fs.mkdtempSync(path.join(OUT, `${LABEL}-state-`)),
  HOME_X: '3600', HOME_Y: '120', HOME_Z: '3600', BOARD_X: '3600', BOARD_Y: '120', BOARD_Z: '3600',
})
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const { pathfinder, Movements, goals } = breq('mineflayer-pathfinder')
const { config } = await import(path.join(BOT_ROOT, 'bots/src/config.mjs'))
const { SKILLS } = await import(path.join(BOT_ROOT, 'bots/src/skills.mjs'))
const { Runner } = await import(path.join(BOT_ROOT, 'bots/src/runner.mjs'))
const { StagnationWatchdog } = await import(path.join(BOT_ROOT, 'bots/src/watchdog.mjs'))
const { tapRecords } = await import(path.join(BOT_ROOT, 'bots/src/logger.mjs'))
let sha = process.env.HF_SHA || ''; try { sha = sha || execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch { sha = sha || 'unknown' }

// ---------------------------------------------------------------- RCON (sandbox only)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-homefix-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const posOf = () => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(r1(`data get entity ${NAME} Pos`)); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null }
const H = { x: 3600, y: 120, z: 3600 }
const hd = (p, h = H) => p ? Math.hypot(p.x - h.x, p.z - h.z) : null
const setHome = h => { config.world.homeX = h.x; config.world.homeY = h.y; config.world.homeZ = h.z }

// ---------------------------------------------------------------- arenas
const FLAT = { x0: H.x - 64, x1: H.x + 64, z0: H.z - 64, z1: H.z + 64 }
async function flatArena () {
  await connect(); await place({ x: H.x + 0.5, y: 125, z: H.z + 0.5 }); await sleep(6000); cleanupNeedsBot = true
  const c = [`kill @e[type=!player,x=${FLAT.x0},y=100,z=${FLAT.z0},dx=128,dy=40,dz=128]`]
  for (let y = 100; y <= 140; y++) c.push(`fill ${FLAT.x0} ${y} ${FLAT.z0} ${FLAT.x1} ${y} ${FLAT.z1} minecraft:${y < 119 ? 'stone' : y === 119 ? 'grass_block' : 'air'}`)
  const out = []; for (let i = 0; i < c.length; i += 10) out.push(...rcon(...c.slice(i, i + 10)))
  const bad = out.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
}
// P3: underground at a second site. Ground 30..62 stone, 63 grass; home on the surface (y 64); the bot at the bottom of
// a 1x1 shaft at y 40, 12 blocks from home horizontally; the shaft's top is capped one block under the surface so the
// walk cannot simply leave.
const U = { x: 3800, z: 3800 }
const UH = { x: U.x, y: 64, z: U.z }
async function undergroundArena () {
  await connect(); await place({ x: U.x + 0.5, y: 85, z: U.z + 0.5 }); await sleep(6000); cleanupNeedsBot = true
  const x0 = U.x - 30, x1 = U.x + 30, z0 = U.z - 30, z1 = U.z + 30
  const c = [`kill @e[type=!player,x=${x0},y=30,z=${z0},dx=60,dy=50,dz=60]`]
  for (let y = 30; y <= 80; y++) c.push(`fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:${y < 63 ? 'stone' : y === 63 ? 'grass_block' : 'air'}`)
  c.push(`fill ${U.x + 12} 40 ${U.z} ${U.x + 12} 60 ${U.z} minecraft:air`)                       // the shaft (cap 61-62 stays stone)
  const out = []; for (let i = 0; i < c.length; i += 10) out.push(...rcon(...c.slice(i, i + 10)))
  const bad = out.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('underground arena: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; '))
}

// ---------------------------------------------------------------- the bot
let bot = null
async function connect () {
  bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', r => reject(new Error('kicked ' + r))); bot.once('error', reject) })
  bot.loadPlugin(pathfinder)
  const moves = new Movements(bot); moves.canDig = false
  const ascend = Object.create(Object.getPrototypeOf(moves)); Object.assign(ascend, moves)
  ascend.canDig = true; ascend.allow1by1towers = true; ascend.dontCreateFlow = true; ascend.allowParkour = false; ascend.maxDropDown = 6
  bot.pathfinder.setMovements(moves)
  bot.ascentMovements = ascend
  bot.withAscentMovements = async fn => { bot.pathfinder.setMovements(ascend); try { return await fn() } finally { bot.pathfinder.setMovements(moves) } }
  bot.assertNav = () => {}
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance 600 4 true`)
  await sleep(1500)
}
async function disconnect () { try { bot?.quit('scene over') } catch {} bot = null; await sleep(3000) }
async function place (p) { rcon(`tp ${NAME} ${p.x} ${p.y} ${p.z}`); await sleep(2500) }

const rowsTap = () => { const rows = []; const untap = tapRecords(r => rows.push(r)); return { rows, untap } }
const brief = r => ({ t: r['@timestamp'], name: r.skill?.name, status: r.skill?.status, fc: r.skill?.fail_class, trigger: r.trigger,
                      args: r.skill?.name?.startsWith('_') ? r.skill.args : undefined, detail: String(r.skill?.detail ?? '').slice(0, 140) })
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), label: LABEL, sha, server: SERVER, ...r }) + '\n'); P_('RESULT', r) }

// the synthetic stuck brain skill: holds still; when aborted, keeps holding for `unwindMs`, then returns aborted
function holdSkill (name, unwindMs) {
  SKILLS[name] = { run: (_ctx, _args, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => setTimeout(() => { const e = new Error('aborted'); e.aborted = true; reject(e) }, unwindMs), { once: true })
  }) }
}
const COG = { running: true, milestones: { allDone: false } }
function rig () {
  const runner = new Runner(bot)
  const wd = new StagnationWatchdog(bot, runner, COG)
  runner.watchdog = wd
  wd.start()                                 // the production 15 s setInterval
  return { runner, wd, stop: () => wd.stop() }
}
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }

// ---------------------------------------------------------------- P0: unwind 2 s / 25 s, a livelock rung in between
async function sceneP0 (scene, unwindMs) {
  setHome(H); await flatArena(); await place({ x: H.x + 0.5, y: 120, z: H.z + 0.5 })
  const { rows, untap } = rowsTap()
  const { runner, wd, stop } = rig()
  const from = posOf()
  await sleep(110_000)                       // idle samples first, so the window is full when the brain skill sticks
  holdSkill('__stuck', unwindMs)
  const brain = runner.run('__stuck', {}, { trigger: 'llm:idle' })
  // A LIVELOCK RUNG TRYING TO START while the reservation is held (or, on the base, after the cancel)
  let rung = null
  const verdictAt = await waitFor(() => rows.find(r => r.skill?.name === '_stagnation'), 240_000, 200)
  if (verdictAt) { await sleep(300); rung = await runner.run('goto', { x: H.x + 30, y: 120, z: H.z }, { trigger: 'livelock_escape' }) }
  await brain.catch(() => {})
  // the started relocation runs to its own end (<= 180 s skill timeout): wait for it, so its TERMINAL row is in the log
  await waitFor(() => !wd.pending && !runner.isBusy() && rows.some(r => r.trigger === 'watchdog_relocate' || r.trigger?.startsWith('interrupt:') && r.skill?.name === 'goto' || (r.skill?.args?.phase ?? '').startsWith('declined')), 240_000, 500)
  await sleep(5000)
  const to = posOf()
  stop(); untap()
  const rescue = rows.filter(r => r.skill?.name === '_watchdog_rescue').map(r => r.skill.args.phase)
  const reloc = rows.find(r => r.skill?.name === 'goto' && r.trigger === 'watchdog_relocate')
  const ev = { scene, unwindMs, rung: rung ? `${rung.status}/${rung.failClass ?? ''}` : null, rescuePhases: rescue,
    relocation: reloc ? brief(reloc) : null, moved: from && to ? +Math.hypot(to.x - from.x, to.z - from.z).toFixed(1) : null,
    escalation: wd.escalation, backoffUntil: wd.backoffUntil ? new Date(wd.backoffUntil).toISOString() : null,
    stagnation: rows.filter(r => r.skill?.name === '_stagnation').map(brief) }
  await disconnect()
  return ev
}

// ---------------------------------------------------------------- P1: home to an occupied home cell
async function sceneP1 (scene, startOut) {
  setHome(H); await flatArena()
  // the home point is OCCUPIED: a chest on it and on its four sides (the town chest at the home point)
  rcon(`setblock ${H.x} 120 ${H.z} minecraft:chest`, `setblock ${H.x + 1} 120 ${H.z} minecraft:chest`, `setblock ${H.x - 1} 120 ${H.z} minecraft:chest`,
       `setblock ${H.x} 120 ${H.z + 1} minecraft:chest`, `setblock ${H.x} 120 ${H.z - 1} minecraft:chest`)
  await place({ x: H.x + startOut + 0.5, y: 120, z: H.z + 0.5 })
  const { rows, untap } = rowsTap()
  const runner = new Runner(bot)
  const from = posOf()
  const r = await runner.run('home', {}, { trigger: 'sandbox_p1' })
  await sleep(1500)
  const to = posOf()
  untap()
  const row = rows.find(x => x.skill?.name === 'home')
  const ev = { scene, startOut, status: r.status, failClass: r.failClass ?? null, detail: String(r.detail ?? '').slice(0, 160),
    from: from && { ...from, h: +hd(from).toFixed(2) }, to: to && { ...to, h: +hd(to).toFixed(2), dy: +(to.y - H.y).toFixed(2) }, row: row ? brief(row) : null }
  await disconnect()
  return ev
}

// ---------------------------------------------------------------- P2: a creeping rescue, then escalation 3
async function sceneP2 () {
  setHome(H); await flatArena()
  // a barrier corridor 1 wide, 2 high, along x: the bot can shuffle but home (20 out) is unreachable
  const cx = H.x + 20, cz = H.z
  // ...with a barrier FLOOR (r1b: the level-2 home rescue's dig retry dug the stone floor, picked the blocks up, and the
  // watchdog rightly read `items +N` as progress -- escalation back to 0, never 3). Barrier cannot be dug: no items.
  rcon(`fill ${cx - 1} 119 ${cz - 1} ${cx + 3} 122 ${cz + 1} minecraft:barrier`, `fill ${cx} 120 ${cz} ${cx + 2} 121 ${cz} minecraft:air`)
  await place({ x: cx + 0.5, y: 120, z: cz + 0.5 })
  const { rows, untap } = rowsTap()
  const realGoto = SKILLS.goto
  let creep = null
  // THE RESCUE CREEPS: a real pathfinder step of one block every 15 s, back and forth (spread 1 < the 8-block threshold)
  SKILLS.goto = { ...realGoto, run: async (ctx, args, signal) => {
    creep = { t0: Date.now(), steps: 0, aborted: null }
    for (let i = 0; ; i++) {
      if (signal.aborted) { creep.aborted = Date.now() - creep.t0; const e = new Error('cut'); e.aborted = true; throw e }
      const tx = i % 2 === 0 ? cx + 1 : cx
      try { await ctx.bot.pathfinder.goto(new goals.GoalBlock(tx, 120, cz)) } catch {}
      creep.steps++
      for (let k = 0; k < 150 && !signal.aborted; k++) await sleep(100)
    }
  } }
  const { runner, wd, stop } = rig()
  try {
    await sleep(110_000)
    holdSkill('__stuck', 1000)
    const brain = runner.run('__stuck', {}, { trigger: 'llm:idle' })
    await waitFor(() => creep, 240_000, 500)
    await brain.catch(() => {})
    // THE BASE SHAPE (H2a): the relocation is answered runner_busy behind the unwinding brain skill and never starts
    if (!creep) { P_('creep never started (the H2a shape)') }
    else {
    P_('creep started')
    await waitFor(() => creep.aborted != null, 200_000, 1000)       // the runner's own 180 s timeout ends it
    SKILLS.goto = realGoto
    // the bot then stays put while the brain keeps trying
    holdSkill('__stuck2', 1000)
    const again = runner.run('__stuck2', {}, { trigger: 'llm:idle' })
    await waitFor(() => rows.some(r => r.skill?.name === '_stagnation' && Number(r.skill.args?.escalation) === 2), 60_000, 1000)
    await again.catch(() => {})
    await waitFor(() => !wd.pending, 200_000, 1000)
    holdSkill('__stuck3', 1000)
    const third = runner.run('__stuck3', {}, { trigger: 'llm:idle' })
    await waitFor(() => rows.some(r => r.skill?.name === '_stagnation' && Number(r.skill.args?.escalation) === 3), 260_000, 1000)
    await third.catch(() => {})
    await waitFor(() => !wd.pending, 200_000, 1000)
    }
  } finally { stop(); untap(); SKILLS.goto = realGoto }
  const stag = rows.filter(r => r.skill?.name === '_stagnation').map(brief)
  const rescueRows = rows.filter(r => r.skill?.name === '_watchdog_rescue').map(r => ({ t: r['@timestamp'], ...r.skill.args }))
  const reloc = rows.find(r => r.skill?.name === 'goto' && (r.trigger?.startsWith('interrupt:') || r.trigger === 'watchdog_relocate'))
  const ev = { scene: 'p2', creep, relocationRow: reloc ? brief(reloc) : null, stagnation: stag, rescueRows, pos: posOf() }
  await disconnect()
  return ev
}

// ---------------------------------------------------------------- P3: the entombment reflex during home, through surface
async function sceneP3 () {
  await undergroundArena()
  setHome(UH)
  // no tool and no blocks: goto's dig retry hand-digs for its one 25 s budget and the walk ends `stranded`, so home
  // calls `surface` (below sea level), whose ascent stage is a pathfinder GoalY walk
  await place({ x: U.x + 12.5, y: 40, z: U.z + 0.5 })
  const { rows, untap } = rowsTap()
  const runner = new Runner(bot)
  // THE REFLEX, when surface's pathfinder stage (a GoalY walk) has been walking for 1.5 s: it interrupts the runner and
  // sets its own goal (reflex.mjs seizeBody does both), so the pathfinder rejects the stage with GoalChanged.
  const realGoto = bot.pathfinder.goto.bind(bot.pathfinder)
  let fired = null, stages = 0
  bot.pathfinder.goto = goal => {
    if (goal instanceof goals.GoalY && !fired) {
      stages++
      setTimeout(() => {
        if (fired) return
        const p = bot.entity.position
        fired = { at: Date.now(), y: +p.y.toFixed(1) }
        runner.interrupt('entombed')
        const pf = bot.pathfinder; pf.setGoal(new goals.GoalBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)))
      }, 1500)
    }
    return realGoto(goal)
  }
  const r = await runner.run('home', {}, { trigger: 'sandbox_p3' })
  try { const pf = bot.pathfinder; pf.setGoal(null) } catch {}
  untap()
  const row = rows.find(x => x.skill?.name === 'home')
  const ev = { scene: 'p3', fired, stages, status: r.status, failClass: r.failClass ?? null, interruptedBy: r.interruptedBy ?? null,
    detail: String(r.detail ?? '').slice(0, 200), row: row ? brief(row) : null, consecutiveFailures: runner.consecutiveFailures,
    events: rows.filter(x => /^_(goto_dig_retry|surface|stranded)/.test(x.skill?.name ?? '')).map(brief).slice(0, 6), pos: posOf() }
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
      if (s === 'p0a') ev = await sceneP0('p0a', 2000)
      else if (s === 'p0b') ev = await sceneP0('p0b', 25_000)
      else if (s === 'p1') ev = await sceneP1('p1', 5)
      else if (s === 'p1far') ev = await sceneP1('p1far', 24)
      else if (s === 'p1in') ev = await sceneP1('p1in', 2)
      else if (s === 'p2') ev = await sceneP2()
      else if (s === 'p3') ev = await sceneP3()
      else throw new Error(`unknown scene ${s}`)
      result(ev)
    } catch (e) { P_('scene failed', s, e.stack || e.message); result({ scene: s, error: String(e.message).slice(0, 300) }); await disconnect() }
  }
}
let cleanupNeedsBot = false
async function cleanup () {
  await disconnect().catch(() => {})
  try {
    // the arenas go back to plain ground (the flat one cleared above its stone; the underground one solid, shaft filled)
    const flat = [`kill @e[type=!player,x=${FLAT.x0},y=100,z=${FLAT.z0},dx=128,dy=40,dz=128]`]
    for (let y = 120; y <= 140; y++) flat.push(`fill ${FLAT.x0} ${y} ${FLAT.z0} ${FLAT.x1} ${y} ${FLAT.z1} minecraft:air`)
    flat.push(`fill ${FLAT.x0} 119 ${FLAT.z0} ${FLAT.x1} 119 ${FLAT.z1} minecraft:grass_block`)
    const under = [`kill @e[type=!player,x=${U.x - 30},y=30,z=${U.z - 30},dx=60,dy=50,dz=60]`,
      `fill ${U.x - 30} 40 ${U.z - 30} ${U.x + 30} 62 ${U.z + 30} minecraft:stone`, `fill ${U.x - 30} 63 ${U.z - 30} ${U.x + 30} 63 ${U.z + 30} minecraft:grass_block`]
    if (cleanupNeedsBot) {
      await connect()
      await place({ x: H.x + 0.5, y: 125, z: H.z + 0.5 }); await sleep(3000); for (let i = 0; i < flat.length; i += 10) rcon(...flat.slice(i, i + 10))
      await place({ x: U.x + 0.5, y: 85, z: U.z + 0.5 }); await sleep(3000); rcon(...under)
      await disconnect()
    }
    P_('cleanup', rcon('list').map(x => x.reply.slice(0, 80)))
  } catch (e) { P_('cleanup failed', e.message) }
}
main().then(() => cleanup().then(() => process.exit(0)), e => { P_('FATAL', e.stack || e.message); cleanup().then(() => process.exit(1)) })
process.on('SIGINT', () => cleanup().then(() => process.exit(1)))
