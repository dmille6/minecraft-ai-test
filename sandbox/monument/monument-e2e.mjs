#!/usr/bin/env node
// SANDBOX-ONLY end-to-end runs of MONUMENT-01 (ziggurat stage 4), Paper 1.21.8. REAL bots (src/index.mjs from <botRoot>,
// unmodified) on a loopback brain that only ever says `status`: every monument visit is the bots' OWN order (cognitive
// monumentOrder). The site and a small geometry come from the sandbox-only MONUMENT_SITE / MONUMENT_GEOM overrides.
//
//   WELL_REPO=<harness checkout (main)> node sandbox/monument/monument-e2e.mjs <botRoot> <scene,...> [server]
//   build12   3 bots, a 12-wide monument (366 cells): built to `complete`; every plan cell solid ON THE SERVER; rows' gate
//             cost and event-loop lag reported
//   stand12   2 bots and an armor stand on a layer-0 cell: the stand's cell stays air and it keeps a walk out (its feet
//             cell reaches the start on the server's blocks); layer 0 cannot close (2 bots never waive it); the stand
//             removed, the build completes
//   kill12    2 bots, one SIGKILLed mid-build and restarted: complete, every plan cell solid, nothing outside the plan
//   escape    a finished 12 monument (filled by RCON, record complete) and a bot sealed 5 under its centre with only a
//             pickaxe: it gets out (survival digs are never guarded); the cells it cut are counted, not refused
//   cost48    2 bots and 3 armor stands on a 48-wide site: two visits each; the rows' gate ms (p95, max) and event-loop
//             lag max -- the cost the coordinator asked to measure (Claude stage-3 r3 P3-4)
// THE SERVER'S TRUTH: cells by `execute if block`. Refuses unless the sandbox lock names `monument`.
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
if (!/monument/.test(lock)) throw new Error(`the sandbox lock does not name monument: ${lock.trim()}`)
const __dir = path.dirname(fileURLToPath(import.meta.url))
const R = process.env.WELL_REPO || path.resolve(__dir, '../..')
const BRAIN_PORT = 11495
const OUT = `${R}/sandbox/log/monument-e2e`
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
const MJ = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/monumentjob.mjs')))
const BLD = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/builder.mjs')))

// ---------------------------------------------------------------- the arena: flat dirt to 119, air above
const C = { x: 3000, z: 2600 }
const A = { x0: C.x - 50, x1: C.x + 50, z0: C.z - 50, z1: C.z + 50 }
const HOME = { x: C.x - 30, y: 120, z: C.z }
function buildArena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=90,z=${A.z0},dx=${A.x1 - A.x0},dy=60,dz=${A.z1 - A.z0}]`]
  for (let y = 120; y <= 145; y += 3) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(145, y + 2)} ${A.z1} minecraft:air`)
  for (let y = 100; y <= 119; y += 3) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(119, y + 2)} ${A.z1} minecraft:dirt`)
  c.push(`fill ${A.x0} 119 ${A.z0} ${A.x1} 119 ${A.z1} minecraft:grass_block`)
  const bad = rcon(...c).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
const countBlock = (cells, id) => rcon(...cells.map(c => `execute if block ${c.x} ${c.y} ${c.z} ${id}`)).filter(r => passed(r.reply)).length
const solidCount = cells => cells.length - countBlock(cells, '#minecraft:replaceable')   // air and water are in the tag

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
  set('BOT_NAME', name); set('LOG_DIR', `./sandbox/log/monument-e2e/${RUN}-${tag}`); set('STATE_DIR', `./sandbox/state/mon-${RUN}-${tag}/${name}`)
  set('MEMORY_POOL', `sbxmon-${RUN}-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 60)
  set('WORLD_BORDER_RADIUS', 4000); set('LLM_DECISION_COOLDOWN_MS', 3000)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  set('MONUMENT_SITE', `'${JSON.stringify(site)}'`); set('MONUMENT_GEOM', `'${JSON.stringify(geom)}'`); set('MONUMENT_COOLDOWN_MS', 20000)
  const envRel = `sandbox/.env.mon-${name}`
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  return envRel
}
const poolDir = tag => `${R}/sandbox/state/mon-${RUN}-${tag}/_pool-sbxmon-${RUN}-${tag}`
const skillLog = (tag, name) => `${R}/sandbox/log/monument-e2e/${RUN}-${tag}/skill-${name}.jsonl`
async function startBot (name, tag, site, geom, at, kit) {
  const envRel = envFor(name, tag, site, geom)
  const botOut = `${OUT}/bot-${RUN}-${tag}-${name}.out`
  const bo = fs.openSync(botOut, 'a')
  const p = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  procs.set(name, p)
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 500)) throw new Error(`${name}: no spawn`)
  rcon(`gamemode survival ${name}`, `clear ${name}`, `effect give ${name} minecraft:saturation 1200 1 true`, `tp ${name} ${at.x + 0.5} ${at.y} ${at.z + 0.5}`)
  await sleep(2000)
  const c = []; let s = 0
  for (const [id, n] of kit) c.push(`item replace entity ${name} container.${s++} with minecraft:${id} ${n}`)
  rcon(...c)
}
const KIT = [['stone_pickaxe', 1], ['bread', 16], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64]]
const G12 = { B: 12, S: 3, H: 2, STAIR_W: 3, APRON: 2 }
const SITE12 = { corner: { x: C.x - 6, z: C.z - 6 }, stairFace: 'w' }
const readRec = tag => MJ.readMonument(poolDir(tag), MJ.monumentKey(HOME)).record
const monRows = (tag, names) => names.flatMap(n => rowsOf(skillLog(tag, n)).filter(r => r.skill.name === '_monument' || r.skill.name === 'monument'))
const fieldsOf = d => Object.fromEntries(String(d ?? '').split(' ').map(kv => kv.split('=')).filter(a => a.length === 2))
function costSummary (rows) {
  const f = rows.map(r => fieldsOf(r.skill.detail))
  const num = k => f.map(x => Number(x[k])).filter(Number.isFinite)
  return { visits: rows.length, placed: num('placed').reduce((a, b) => a + b, 0), gateP95Max: Math.max(0, ...num('gate_ms_p95')), gateMax: Math.max(0, ...num('gate_ms_max')),
           lagMax: Math.max(0, ...num('lag_ms_max')), stops: f.reduce((m, x) => { m[x.stop] = (m[x.stop] ?? 0) + 1; return m }, {}) }
}
const outsidePlan = (plan, box) => {
  const cmds = []
  for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) for (let y = 120; y <= 128; y++) if (!plan.key.has(BLD.bk(x, y, z))) cmds.push({ x, y, z })
  return countBlock(cmds, 'minecraft:cobblestone')
}

async function sceneBuild (tag, names, { stand = null, killAt = null } = {}) {
  buildArena()
  if (stand) rcon(`summon minecraft:armor_stand ${stand.x + 0.5} ${stand.y} ${stand.z + 0.5} {NoGravity:1b,Invulnerable:1b}`)
  for (let i = 0; i < names.length; i++) await startBot(names[i], tag, SITE12, G12, { x: C.x - 14, y: 120, z: C.z - 3 + 3 * i }, KIT)
  const t0 = Date.now()
  let killed = false
  const done = await waitFor(async () => {
    if (killAt && !killed && Date.now() - t0 > killAt) { killed = true; P_('SIGKILL', names[0]); await stopBot(names[0], 'SIGKILL'); await sleep(15000); await startBot(names[0], tag, SITE12, G12, { x: C.x - 14, y: 120, z: C.z - 3 }, [['bread', 8]]) }
    const r = readRec(tag)
    return r && (r.state === 'complete' || (stand && r.layer_open === r.site.baseY && solidCount(MJ.monumentPlan({ ...r, gen: 'p' }).byY.get(r.site.baseY)) >= MJ.monumentPlan({ ...r, gen: 'p' }).byY.get(r.site.baseY).length - 1)) ? r : null
  }, 30 * 60_000, 10000)
  const rec = readRec(tag)
  const out = { scene: tag, record: rec ? { state: rec.state, layer: rec.layer_open, waived: rec.waived.length, stuck: Object.keys(rec.stuck ?? {}).length } : null }
  if (rec) {
    const plan = MJ.monumentPlan({ ...rec, gen: 'final' })
    out.planCells = plan.cells.length
    out.solidOnServer = solidCount(plan.cells)
    out.outsidePlanCobble = outsidePlan(plan, { x0: SITE12.corner.x - 4, x1: SITE12.corner.x + 15, z0: SITE12.corner.z - 4, z1: SITE12.corner.z + 15 })
    if (stand) {
      out.standCellAir = countBlock([stand], 'minecraft:air')
      // its walk out, on the server's own blocks: read the box around the site and run the builder's own probe
      const box = { x0: SITE12.corner.x - 6, x1: SITE12.corner.x + 17, y0: 116, y1: 128, z0: SITE12.corner.z - 6, z1: SITE12.corner.z + 17 }
      const cells = []; for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) for (let y = 118; y <= 124; y++) cells.push({ x, y, z })
      const air = new Set(rcon(...cells.map(c => `execute if block ${c.x} ${c.y} ${c.z} #minecraft:replaceable`)).map((r, i) => passed(r.reply) ? i : -1).filter(i => i >= 0).map(i => `${cells[i].x},${cells[i].y},${cells[i].z}`))
      const read = (x, y, z) => (y < 118 ? { name: 'dirt', boundingBox: 'block' } : y > 124 ? { name: 'air', boundingBox: 'empty' } : air.has(`${x},${y},${z}`) ? { name: 'air', boundingBox: 'empty' } : { name: 'cobblestone', boundingBox: 'block' })
      const start = { x: SITE12.corner.x - 5, y: 120, z: SITE12.corner.z + 6 }
      out.standWalksOut = BLD.walksTo(read, stand, start, { box })
      rcon(`kill @e[type=minecraft:armor_stand,x=${stand.x},y=${stand.y},z=${stand.z},distance=..2]`)
      const fin = await waitFor(() => readRec(tag)?.state === 'complete', 20 * 60_000, 10000)
      out.completeAfterStand = !!fin
      out.solidAfter = solidCount(MJ.monumentPlan({ ...readRec(tag), gen: 'final2' }).cells)
    }
  }
  out.cost = costSummary(monRows(tag, names))
  out.minutes = Math.round((Date.now() - t0) / 6000) / 10
  await stopAll()
  if (stand) out.ok = !!rec && out.standCellAir === 1 && out.standWalksOut && out.completeAfterStand && out.solidAfter === out.planCells
  else out.ok = !!rec && rec.state === 'complete' && out.solidOnServer === out.planCells && out.outsidePlanCobble === 0 && (!killAt || killed)
  result(out)
}

// the CONTROL (no monument, no record) runs the same pocket: an escape the base itself cannot make with this kit is the base's
async function sceneEscape (tag = 'escape', { monument = true, scaffold = 0 } = {}) {
  buildArena()
  // the finished monument, filled by RCON (a fixture), and its record written as the bots would
  const plan = MJ.monumentPlan({ site: { ...SITE12, baseY: 120 }, geom: G12, fill: [] })
  rcon(...plan.cells.map(c => `setblock ${c.x} ${c.y} ${c.z} minecraft:cobblestone`))
  if (monument) {
    const rec = { ...MJ.newRecord({ site: { ...SITE12, baseY: 120 }, fill: [], home: HOME, g: G12, by: 'fixture', now: Date.now() }), state: 'complete' }
    fs.mkdirSync(poolDir(tag), { recursive: true })
    MJ.createMonumentGen(poolDir(tag), MJ.monumentKey(HOME), 1, rec)
  } else rcon(...plan.cells.map(c => `setblock ${c.x} ${c.y} ${c.z} minecraft:air`))   // the control: no monument at all
  const cx = SITE12.corner.x + 6, cz = SITE12.corner.z + 6
  rcon(`fill ${cx - 2} 110 ${cz - 2} ${cx + 2} 119 ${cz + 2} minecraft:stone`, `fill ${cx} 114 ${cz} ${cx} 115 ${cz} minecraft:air`)
  const before = solidCount(plan.cells)
  await startBot('sandbox-Mon1', tag, SITE12, G12, { x: cx, y: 114, z: cz }, [['stone_pickaxe', 1], ['bread', 8], ...(scaffold ? [['cobblestone', scaffold]] : [])])
  const out = await waitFor(() => { const m = /\[[-\d.]+d, ([-\d.]+)d, [-\d.]+d\]/.exec(r1('data get entity sandbox-Mon1 Pos')); return m && Number(m[1]) >= 120 ? Number(m[1]) : null }, 5 * 60_000, 3000)
  const after = solidCount(plan.cells)
  await stopAll()
  result({ scene: tag, monument, scaffold, gotOutAtY: out, monumentCellsCut: monument ? before - after : null, ok: out != null })
}

async function sceneCost48 () {
  buildArena()
  const tag = 'cost48'
  const G48 = { B: 48, S: 3, H: 2, STAIR_W: 3, APRON: 2 }
  const site = { corner: { x: C.x - 24, z: C.z - 24 }, stairFace: 'w' }
  for (const [dx, dz] of [[-10, -10], [5, 12], [15, -3]]) rcon(`summon minecraft:armor_stand ${C.x + dx + 0.5} 120 ${C.z + dz + 0.5} {NoGravity:1b,Invulnerable:1b}`)
  const names = ['sandbox-Mon1', 'sandbox-Mon2']
  for (let i = 0; i < names.length; i++) await startBot(names[i], tag, site, G48, { x: C.x - 30, y: 120, z: C.z - 3 + 6 * i }, KIT)
  await waitFor(() => monRows(tag, names).filter(r => /placed=[1-9]/.test(String(r.skill.detail))).length >= 4, 25 * 60_000, 10000)
  const cost = costSummary(monRows(tag, names))
  await stopAll()
  result({ scene: 'cost48', cost, ok: cost.visits >= 2 && cost.placed > 0 })
}

await new Promise(r => brain.listen(BRAIN_PORT, '127.0.0.1', r))
let failed = 0
P_('forceload', rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`).map(x => x.reply).join(' ').slice(0, 120))
P_(`root=${BOT_ROOT} server=${SERVER} scenes=${SCENES_S}`)
try {
  for (const sc of SCENES_S.split(',')) {
    P_(`SCENE ${sc}`)
    try {
      if (sc === 'build12') await sceneBuild('build12', ['sandbox-Mon1', 'sandbox-Mon2', 'sandbox-Mon3'])
      else if (sc === 'stand12') await sceneBuild('stand12', ['sandbox-Mon1', 'sandbox-Mon2'], { stand: { x: SITE12.corner.x + 8, y: 120, z: SITE12.corner.z + 3 } })
      else if (sc === 'kill12') await sceneBuild('kill12', ['sandbox-Mon1', 'sandbox-Mon2'], { killAt: 90_000 })
      else if (sc === 'escape') await sceneEscape()
      else if (sc === 'escapectl') await sceneEscape('escapectl', { monument: false })
      else if (sc === 'escape32') await sceneEscape('escape32', { scaffold: 32 })
      else if (sc === 'escapectl32') await sceneEscape('escapectl32', { monument: false, scaffold: 32 })
      else if (sc === 'cost48') await sceneCost48()
      else throw new Error(`no scene ${sc}`)
    } catch (e) { failed++; P_('SCENE FAILED', sc, String(e?.stack ?? e).slice(0, 600)); await stopAll('SIGKILL') }
  }
} finally {
  brain.close()
  try {
    const c = []; for (let y = 100; y <= 145; y += 3) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(145, y + 2)} ${A.z1} minecraft:air`)
    rcon(...c, `kill @e[type=!player,x=${A.x0},y=90,z=${A.z0},dx=${A.x1 - A.x0},dy=60,dz=${A.z1 - A.z0}]`, `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  } catch {}
  for (const f of fs.readdirSync(`${R}/sandbox`)) if (f.startsWith('.env.mon-')) try { fs.unlinkSync(`${R}/sandbox/${f}`) } catch {}
}
const bad = lines(RES).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.run === RUN && !r.ok).length
P_(`DONE: ${failed} scene(s) failed to run, ${bad} result(s) not ok`)
process.exit(failed || bad ? 1 : 0)
