#!/usr/bin/env node
// SANDBOX-ONLY end-to-end runs of SHAFT-01 (ziggurat stage 5), Paper 1.21.8. REAL bots (src/index.mjs from <botRoot>, unmodified)
// on a loopback brain that only ever says `status`: every dig_shaft visit is the bots' OWN order (cognitive shaftOrder). The
// site comes from the sandbox-only SHAFT_SITE override, the bottom from SHAFT_FLOOR_Y (a short shaft).
//
//   WELL_REPO=<harness checkout (main)> node sandbox/shaft/shaft-e2e.mjs <botRoot> <scene,...> [server]
//   build    1 builder; caves beside the core, a cave under a core cell, sand in the lining, a floating lining cell (chain),
//            gravel in a landing ceiling; built to `complete`; THE SERVER'S TRUTH: both ladder columns at every level
//            (correct block), every lining cell solid, every landing cell open, the cap on, the pad open
//   kill     the builder SIGKILLed mid-visit and restarted: it resumes from the cells; complete; same truths
//   idle     a builder stopped (SIGTERM) inside the shaft at depth, restarted with every reflex armed: 0 shaft cells dug,
//            it climbs out (shaft_exit) onto the pad
// THE SERVER'S TRUTH: cells by `execute if block`. Refuses unless the sandbox lock names `shaft`.
import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [BOT_ROOT, SCENES_S, SERVER = 'sandbox4'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: monument-e2e.mjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
if (!/shaft/.test(lock)) throw new Error(`the sandbox lock does not name shaft: ${lock.trim()}`)
const __dir = path.dirname(fileURLToPath(import.meta.url))
const R = process.env.WELL_REPO || path.resolve(__dir, '../..')
const BRAIN_PORT = 11495
const OUT = `${R}/sandbox/log/shaft-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-mon-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
async function waitFor (pred, ms, step = 2000) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const result = r => { fs.appendFileSync(RES, JSON.stringify({ run: RUN, at: new Date().toISOString(), ...r }) + '\n'); P_('RESULT', r) }
const SJ = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/shaftjob.mjs')))
const SP = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/shaftplan.mjs')))


// ---------------------------------------------------------------- the arena: stone to 119 (grass top), air above
const C = { x: 3400, z: 2600 }
const A = { x0: C.x - 24, x1: C.x + 24, z0: C.z - 30, z1: C.z + 24 }
const HOME = { x: C.x, y: 120, z: C.z - 18 }
const SITE = { origin: { x: C.x, z: C.z }, away: 's', c: 120 }
const FLOOR = 100
const W = (u, y, v) => SJ.worldOf(SITE, u, y, v)
function buildArena (extra = []) {
  const c = [`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, `kill @e[type=!player,x=${A.x0},y=80,z=${A.z0},dx=${A.x1 - A.x0},dy=60,dz=${A.z1 - A.z0}]`]
  for (let y = 120; y <= 130; y += 2) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(130, y + 1)} ${A.z1} minecraft:air`)
  for (let y = 88; y <= 119; y += 2) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(119, y + 1)} ${A.z1} minecraft:stone`)
  c.push(`fill ${A.x0} 119 ${A.z0} ${A.x1} 119 ${A.z1} minecraft:grass_block`)
  c.push(...extra)
  const bad = rcon(...c).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
const countBlock = (cells, id) => rcon(...cells.map(c => `execute if block ${c.x} ${c.y} ${c.z} ${id}`)).filter(r => passed(r.reply)).length
const solidCount = cells => cells.length - countBlock(cells, '#minecraft:replaceable')   // air and water are in the tag
const setL = (u, y, v, id) => { const w = W(u, y, v); return `setblock ${w.x} ${y} ${w.z} minecraft:${id}` }
// the world's awkward bits, all inside the survey envelope's reach but dry
const HAZARDS = [
  setL(-1, 116, 0, 'air'), setL(-2, 116, 0, 'air'), setL(-1, 115, 0, 'air'),          // a cave beside column 0 (lining stacks down)
  setL(2, 113, 0, 'sand'),                                                             // sand in the lining (replaced or kept: supported)
  setL(1, 109, 0, 'air'), setL(1, 108, 0, 'air'),                                      // a cave under a core cell (the floor is filled)
  setL(0, 106, 1, 'air'), setL(0, 106, 2, 'air'), setL(0, 105, 1, 'air'),              // a void at a lining cell (chained)
  setL(1, 114, 3, 'gravel'),                                                           // gravel in landing 112's ceiling (y=114)
]
const KIT__ = [['iron_pickaxe', 1], ['iron_pickaxe', 1], ['bread', 16], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['ladder', 64], ['torch', 8]]

// ---------------------------------------------------------------- the brain: always `status` (the orders are the bots')
const brain = http.createServer((rq, res) => {
  let body = ''; rq.on('data', c => { body += c })
  rq.on('end', () => {
    if (rq.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!rq.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ skill: 'status', args: {}, reason: 'sandbox', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})

// ---------------------------------------------------------------- the bots
const procs = new Map()
async function stopBot (name, sig = 'SIGTERM') {
  const p = procs.get(name); procs.delete(name)
  try { p && p.kill(sig) } catch {}
  await waitFor(() => !new RegExp(name).test(r1('list')), 30000, 1000)
}
const stopAll = async (sig) => { for (const n of [...procs.keys()]) await stopBot(n, sig) }
function envFor (name, tag, site, geom) {
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', name); set('LOG_DIR', `./sandbox/log/shaft-e2e/${RUN}-${tag}`); set('STATE_DIR', `./sandbox/state/sh-${RUN}-${tag}/${name}`)
  set('MEMORY_POOL', `sbxsh-${RUN}-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 60)
  set('WORLD_BORDER_RADIUS', 4000); set('LLM_DECISION_COOLDOWN_MS', 3000)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  set('SHAFT_SITE', `'${JSON.stringify(SITE)}'`); set('SHAFT_FLOOR_Y', FLOOR); set('MONUMENT_ENABLED', 'false')
  const envRel = `sandbox/.env.sh-${name}`
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  return envRel
}
const poolDir = tag => `${R}/sandbox/state/sh-${RUN}-${tag}/_pool-sbxsh-${RUN}-${tag}`
const skillLog = (tag, name) => `${R}/sandbox/log/shaft-e2e/${RUN}-${tag}/skill-${name}.jsonl`
async function startBot (name, tag, site, geom, at, kit) {
  const envRel = envFor(name, tag, site, geom)
  const botOut = `${OUT}/bot-${RUN}-${tag}-${name}.out`
  const bo = fs.openSync(botOut, 'a')
  const p = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  procs.set(name, p)
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 500)) throw new Error(`${name}: no spawn`)
  if (!at) return   // a restart: the bot keeps its place and its bag
  rcon(`gamemode survival ${name}`, `clear ${name}`, `effect give ${name} minecraft:saturation 1200 1 true`, `tp ${name} ${at.x + 0.5} ${at.y} ${at.z + 0.5}`)
  await sleep(2000)
  const c = []; let s = 0
  for (const [id, n] of kit) c.push(`item replace entity ${name} container.${s++} with minecraft:${id} ${n}`)
  rcon(...c)
}

const KIT = [['iron_pickaxe', 1], ['iron_pickaxe', 1], ['bread', 16], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['ladder', 64], ['torch', 8]]
// ---------------------------------------------------------------- the server's truth for a complete shaft
function truth () {
  const rec = { site: SITE, frontier: FLOOR, bottom: FLOOR, plan_bottom: FLOOR, landings: SJ.plannedLandings(SITE.c, null, FLOOR) }
  const env = SP.envelopeLevels(SITE.c, FLOOR, rec.landings)
  const ladders = [], open = [], lining = []
  for (const [u, y, v, role] of env.dig) { const w = W(u, y, v); if (role === 'core' && y < SITE.c) ladders.push({ x: w.x, y, z: w.z }); else if (role !== 'core') open.push({ x: w.x, y, z: w.z }) }
  for (const [u, y, v] of env.shell) { if (y === SITE.c && v === -1) continue; const w = W(u, y, v); lining.push({ x: w.x, y, z: w.z }) }
  const cap = [0, 1].map(u => W(u, SITE.c, 0)), pad = [0, 1].map(u => W(u, SITE.c, -1))
  const loaded = passed(r1(`execute if block ${A.x0} 110 ${A.z0} minecraft:stone`)) && passed(r1(`execute if block ${A.x0} 125 ${A.z0} minecraft:air`))   // positive control: the arena reads
  return {
    loaded,
    ladders: countBlock(ladders, 'minecraft:ladder'), laddersOf: ladders.length,
    open: countBlock(open, 'minecraft:air') + countBlock(open, 'minecraft:torch') + countBlock(open, 'minecraft:wall_torch'), openOf: open.length,
    lining: solidCount(lining) - countBlock(lining, 'minecraft:sand') - countBlock(lining, 'minecraft:gravel') + countBlock(lining, 'minecraft:sand'), liningOf: lining.length,
    cap: countBlock(cap, 'minecraft:cobblestone'), pad: countBlock(pad, 'minecraft:air'),
  }
}
const readRec = tag => SJ.readShaft(poolDir(tag), SJ.shaftKey(HOME)).record
const shaftRows = (tag, names) => names.flatMap(n => rowsOf(skillLog(tag, n)).filter(r => /^_shaft/.test(r.skill.name)))
const digsOfShaft = (tag, names) => names.flatMap(n => rowsOf(skillLog(tag, n)).filter(r => r.skill.name === '_dig_town' && SJ.shaftIndex({ site: SITE, frontier: FLOOR, bottom: FLOOR, plan_bottom: FLOOR, landings: SJ.plannedLandings(SITE.c, null, FLOOR) })?.has(r.skill.args?.x, r.skill.args?.y, r.skill.args?.z) && r.skill.args?.by !== 'dig_shaft'))

async function sceneBuild (tag, { kill = false } = {}) {
  buildArena(HAZARDS)
  const name = 'sandbox-Sh1'
  await startBot(name, tag, HOME, null, { x: HOME.x, y: 120, z: HOME.z }, KIT)
  const t0 = Date.now()
  let killed = false
  const done = await waitFor(async () => {
    const r = readRec(tag)
    if (kill && !killed && r && r.frontier <= SITE.c - 6) { killed = true; P_('SIGKILL the builder at frontier', r.frontier); await stopBot(name, 'SIGKILL'); await sleep(8000); await startBot(name, tag, HOME, null, null, null) }
    return r && r.state !== 'building' ? r : null
  }, 40 * 60_000, 5000)
  await sleep(20_000)   // the climb out and the cap
  const rec = readRec(tag)
  const tr = truth()
  const rows = shaftRows(tag, [name])
  const visits = rows.filter(r => r.skill.name === '_shaft')
  result({ scene: tag, state: rec?.state ?? null, why: rec?.why ?? null, frontier: rec?.frontier ?? null, killed, minutes: +((Date.now() - t0) / 60000).toFixed(1),
           truth: tr, visits: visits.length, stops: visits.reduce((m, r) => { const s = r.skill.args?.stop ?? '?'; m[s] = (m[s] ?? 0) + 1; return m }, {}),
           foreignShaftDigs: digsOfShaft(tag, [name]).length,
           ok: rec?.state === 'complete' && tr.ladders === tr.laddersOf && tr.lining === tr.liningOf && tr.open === tr.openOf && tr.cap === 2 && tr.pad === 2 })
  await stopAll()
}

async function sceneIdle (tag) {
  // a builder stopped while inside: TERM it when it is below the collar, restart it; it must climb out with 0 shaft digs
  buildArena([])
  const name = 'sandbox-Sh2'
  await startBot(name, tag, HOME, null, { x: HOME.x, y: 120, z: HOME.z }, KIT)
  const inside = await waitFor(async () => { const r = readRec(tag); const out = r1(`data get entity ${name} Pos`); const m = out.match(/\[([-\d.]+)d, ([-\d.]+)d, ([-\d.]+)d\]/); return r && r.frontier <= SITE.c - 8 && m && Number(m[2]) < SITE.c - 4 ? Number(m[2]) : null }, 20 * 60_000, 2000)
  P_('stop the builder inside at y', inside)
  await stopBot(name, 'SIGKILL'); await sleep(8000)
  await startBot(name, tag, HOME, null, null, null)
  const out = await waitFor(async () => { const o = r1(`data get entity ${name} Pos`); const m = o.match(/\[([-\d.]+)d, ([-\d.]+)d, ([-\d.]+)d\]/); return m && Number(m[2]) >= SITE.c - 0.1 ? Number(m[2]) : null }, 6 * 60_000, 2000)
  const rows = shaftRows(tag, [name])
  result({ scene: tag, insideAt: inside, outAt: out, exits: rows.filter(r => r.skill.name === '_shaft_exit').length, exitFails: rows.filter(r => r.skill.name === '_shaft_exit_failed').length,
           holds: rows.filter(r => r.skill.name === '_shaft_hold').length, foreignShaftDigs: digsOfShaft(tag, [name]).length,
           ok: out != null && digsOfShaft(tag, [name]).length === 0 })
  await stopAll()
}

brain.listen(BRAIN_PORT, '127.0.0.1')
P_('root=' + BOT_ROOT + ' server=' + SERVER + ' scenes=' + SCENES_S)
let failed = 0, notOk = 0
for (const sc of SCENES_S.split(',')) {
  P_('SCENE', sc)
  try {
    if (sc === 'build') await sceneBuild('build')
    else if (sc === 'kill') await sceneBuild('kill', { kill: true })
    else if (sc === 'idle') await sceneIdle('idle')
    else if (sc === 'truth') { rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`); await sleep(4000); const tr = truth(); result({ scene: 'truth', truth: tr, ok: tr.ladders === tr.laddersOf && tr.lining === tr.liningOf && tr.open === tr.openOf && tr.cap === 2 && tr.pad === 2 }) }
    else throw new Error('unknown scene ' + sc)
  } catch (e) { failed++; P_('FAILED', sc, String(e?.stack ?? e).slice(0, 600)); try { await stopAll('SIGKILL') } catch {} }
}
try { rcon(`forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`) } catch {}
for (const l of lines(RES)) { try { const r = JSON.parse(l); if (r.run === RUN && r.ok === false) notOk++ } catch {} }
P_(`DONE: ${failed} scene(s) failed to run, ${notOk} result(s) not ok`)
brain.close(); process.exit(0)
