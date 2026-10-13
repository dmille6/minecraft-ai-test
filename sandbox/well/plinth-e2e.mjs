#!/usr/bin/env node
// SANDBOX-ONLY end-to-end run of the RAISED junk well (plinth-01: bots/src/plinth.mjs + skills build_plinth), Paper 1.21.8.
// The REAL bot (src/index.mjs from <botRoot>, unmodified; trace.cjs only observes packets) runs its own deterministic town
// orders; the loopback brain answers 'status'. A bare-mineflayer walker in THIS process is the other player / the path probe.
//
//   WELL_REPO=<harness checkout (main)> node sandbox/well/plinth-e2e.mjs <botRoot> <scene,scene,...> [server]
//   scenes:  build:<fixture>:<rep>[:kill]    S1  a build from the town's no-site record to complete; :kill = SIGKILL twice
//                                             mid-build (once before, once after the walling-in step) and restart
//            well:<fixture>                   S2  build_well on the finished plinth, a dispose visit (census in/out of the
//                                             shaft, +30 s), and the 60-pass walker isolation run with a body on the ledge
//            path:<fixture>                   S3  50 walker round trips town -> throwing stand on mineflayer-pathfinder with
//                                             the fleet's well step cost; every node recorded; the column never a node
//            tomb:<fixture>                   S4  an entombed bot against the plinth wall and a bot in a 3-deep town pit
//                                             beside it: what each digs, read from the world
//   fixtures: slab2  a 2-thick dirt slab floating at y 118-119 (dug-out ground; the plan is a raise of 2)
//             slab4  dirt at 118 under SAND at 119 (no shell cell may be sand: the full raise of 4, 81 blocks)
//             boarda board-a's real town (10-13 region copy, read-only) copied into the arena, home at the arena centre
// THE SERVER'S TRUTH: every count is an RCON read of the world (execute if block), never only a bot row.
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. World edits are on the arena only.
// Refuses unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `plinth`.
import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const [BOT_ROOT, SCENES_S, SERVER = 'sandbox2'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: plinth-e2e.mjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
if (!/plinth/.test(lock)) throw new Error(`the sandbox lock does not name plinth: ${lock.trim()}`)
const __dir = path.dirname(fileURLToPath(import.meta.url))
const R = process.env.WELL_REPO || path.resolve(__dir, '../..')
const REGION = process.env.PLINTH_REGION || ''
const NAME = 'sandbox-Plinth', WALKER = 'sandbox-PWalk'
const OUT = process.env.PLINTH_OUT || `${R}/sandbox/log/plinth-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const PL = await import(path.join(BOT_ROOT, 'bots/src/plinth.mjs'))
const W = await import(path.join(BOT_ROOT, 'bots/src/well.mjs'))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-plinth-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const rconBatch = (cmds, n = 400) => { const out = []; for (let i = 0; i < cmds.length; i += n) out.push(...rcon(...cmds.slice(i, i + n))); return out }

// ---------------------------------------------------------------- the arena
const C = { x: 2400, z: 2400 }
const A = { x0: C.x - 26, x1: C.x + 26, z0: C.z - 26, z1: C.z + 26, y0: 100, y1: 140 }
const SLAB_HOME = { x: C.x, y: 120, z: C.z }
function clearArena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=${A.y0},z=${A.z0},dx=${A.x1 - A.x0},dy=${A.y1 - A.y0},dz=${A.z1 - A.z0}]`]
  for (let y = A.y0; y <= A.y1; y += 10) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(A.y1, y + 9)} ${A.z1} minecraft:air`)
  const bad = rcon(...c).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
const FIX = {}
FIX.slab2 = { home: SLAB_HOME, bag: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]],
  build () { clearArena(); rcon(`fill ${C.x - 24} 118 ${C.z - 24} ${C.x + 24} 119 ${C.z + 24} minecraft:dirt`) },
  read: (x, y, z) => (Math.abs(x - C.x) > 24 || Math.abs(z - C.z) > 24 ? (y < A.y0 || y > A.y1 ? null : AIRB) : y === 118 || y === 119 ? blk('dirt') : y < A.y0 || y > A.y1 ? null : AIRB) }
FIX.slab4 = { home: SLAB_HOME, bag: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]],
  build () { clearArena(); rcon(`fill ${C.x - 24} 118 ${C.z - 24} ${C.x + 24} 118 ${C.z + 24} minecraft:dirt`, `fill ${C.x - 24} 119 ${C.z - 24} ${C.x + 24} 119 ${C.z + 24} minecraft:sand`) },
  read: (x, y, z) => (y < A.y0 || y > A.y1 ? null : Math.abs(x - C.x) > 24 || Math.abs(z - C.z) > 24 ? AIRB : y === 118 ? blk('dirt') : y === 119 ? blk('sand') : AIRB) }
// board-a: home 355,73,147 -> the arena centre at y 120 (dx, dy, dz)
const BA = { home: { x: 355, y: 73, z: 147 }, box: { x0: 331, x1: 379, z0: 123, z1: 171, y0: 60, y1: 92 } }
const OFF = { x: C.x - BA.home.x, y: 120 - BA.home.y, z: C.z - BA.home.z }
let baRead = null
FIX.boarda = { home: SLAB_HOME, bag: [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 4]],
  build () {
    clearArena()
    const { loadRegion, reader } = breqImport.wellsite
    const raw = rawReader(loadRegion(REGION))
    const cmds = []
    for (let y = BA.box.y0; y <= BA.box.y1; y++) for (let z = BA.box.z0; z <= BA.box.z1; z++) {
      let run = null
      const flush = () => { if (run && run.s !== 'minecraft:air') cmds.push(run.x0 === run.x1 ? `setblock ${run.x0 + OFF.x} ${y + OFF.y} ${z + OFF.z} ${run.s}` : `fill ${run.x0 + OFF.x} ${y + OFF.y} ${z + OFF.z} ${run.x1 + OFF.x} ${y + OFF.y} ${z + OFF.z} ${run.s}`); run = null }
      for (let x = BA.box.x0; x <= BA.box.x1; x++) {
        const e = raw(x, y, z)
        let s = e ? stateString(e) : 'minecraft:air'
        if (run && run.s === s) { run.x1 = x; continue }
        flush(); run = { x0: x, x1: x, s }
      }
      flush()
    }
    P_(`boarda: ${cmds.length} fill/setblock commands`)
    const res = rconBatch(cmds, 300)
    const bad = res.filter(x => /Unknown|Incorrect|Cannot|not loaded|Expected/i.test(x.reply))
    if (bad.length) P_('boarda copy refusals', bad.length, bad.slice(0, 3).map(x => `${x.cmd.slice(0, 80)} => ${x.reply.slice(0, 80)}`))
    void reader
  },
  read: (x, y, z) => { if (!baRead) baRead = breqImport.wellsite.reader(breqImport.wellsite.loadRegion(REGION)); const sx = x - OFF.x, sy = y - OFF.y, sz = z - OFF.z; if (sx < BA.box.x0 || sx > BA.box.x1 || sz < BA.box.z0 || sz > BA.box.z1 || sy < BA.box.y0 || sy > BA.box.y1) return (y < A.y0 || y > A.y1 ? null : AIRB); return baRead(sx, sy, sz) } }
const breqImport = { wellsite: await import(path.join(BOT_ROOT, 'bots/scripts/wellsite-replay.mjs')) }
/** The palette entry (Name, Properties) at a cell of a region (the replay's reader, raw). Leaves made persistent. */
function rawReader (chunks) {
  return (x, y, z) => {
    const s = chunks.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`)?.get(Math.floor(y / 16))
    if (!s) return null
    if (s.palette.length === 1 || !s.data) return s.palette[0]
    const bits = Math.max(4, Math.ceil(Math.log2(s.palette.length))), per = Math.floor(64 / bits)
    const idx = (((y % 16) + 16) % 16) * 256 + (((z % 16) + 16) % 16) * 16 + (((x % 16) + 16) % 16)
    const [hi, lo] = s.data[Math.floor(idx / per)]
    const v = (BigInt.asUintN(32, BigInt(hi)) << 32n) | BigInt.asUintN(32, BigInt(lo))
    return s.palette[Number((v >> BigInt((idx % per) * bits)) & ((1n << BigInt(bits)) - 1n))]
  }
}
function stateString (e) {
  const props = { ...(e.Properties ?? {}) }
  if (/_leaves$/.test(e.Name)) props.persistent = 'true'
  const p = Object.entries(props)
  return p.length ? `${e.Name}[${p.map(([k, v]) => `${k}=${v}`).join(',')}]` : e.Name
}
const Block = breq('prismarine-block')(breq('prismarine-registry')('1.21.8'))
const BC = new Map()
const blk = name => { if (!BC.has(name)) { const b = Block.fromString(name, 0); BC.set(name, { name: b.name, boundingBox: b.boundingBox, shapes: b.shapes, hardness: b.hardness, props: null }) } return BC.get(name) }
const AIRB = blk('air')

// ---------------------------------------------------------------- the server's truth for a plan
const isCobble = rep => passed(rep)
/** Every plan step's cell as the server has it -> { placed: Set(keys), cleared: Set(keys) }. */
function planCells (plan) {
  const cmds = plan.steps.map(s => s.op === 'place' ? `execute if block ${s.c[0]} ${s.c[1]} ${s.c[2]} minecraft:cobblestone` : `execute if block ${s.c[0]} ${s.c[1]} ${s.c[2]} #minecraft:leaves`)
  const r = rconBatch(cmds)
  const placed = new Set(), cleared = new Set()
  plan.steps.forEach((s, i) => { if (s.op === 'place' && isCobble(r[i]?.reply)) placed.add(s.c.join(',')); if (s.op === 'clear' && !passed(r[i]?.reply)) cleared.add(s.c.join(',')) })
  return { placed, cleared }
}
/** Cobblestone anywhere in a box around the plinth (stair included) -> Set of keys. */
function cobbleIn (box) {
  const cmds = [], keys = []
  for (let x = box.x0; x <= box.x1; x++) for (let y = box.y0; y <= box.y1; y++) for (let z = box.z0; z <= box.z1; z++) { cmds.push(`execute if block ${x} ${y} ${z} minecraft:cobblestone`); keys.push(`${x},${y},${z}`) }
  const r = rconBatch(cmds, 500)
  return new Set(keys.filter((k, i) => passed(r[i]?.reply)))
}
const capCell = cap => r1(`execute if block ${cap.x} ${cap.y} ${cap.z} minecraft:air`)

// ---------------------------------------------------------------- the bot and its logs
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '') }))
const field = (d, k) => { const m = new RegExp(`(?:^| )${k}=(\\S+)`).exec(d ?? ''); return m ? m[1] : null }
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }

let BRAIN_GOTO = null, brainN = 0
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = { skill: 'status', args: {} }
    if (BRAIN_GOTO && brainN++ % 2) decision = { skill: 'goto', args: BRAIN_GOTO }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
let bot = null
async function stopBot (sig = 'SIGTERM') {
  try { bot && bot.kill(sig) } catch {}
  bot = null
  await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000)
}
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const poolOf = fx => `sbxplinth-${RUN}-${fx}`
function poolDir (fx) { return `${R}/sandbox/state/_pool-${poolOf(fx)}` }
const homeKey = h => `${h.x}_${h.y}_${h.z}`
async function startBot (fx, scene, slotsSpec, { tp = true, at = null } = {}) {
  const tag = `${RUN}-${scene}`
  const logRel = `./sandbox/log/plinth-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/plinth-e2e/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`; const trace = `${OUT}/trace-${tag}.jsonl`
  const envRel = 'sandbox/.env.plinth-e2e'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  const home = FIX[fx].home
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/plinth-${RUN}-${fx}`); set('MEMORY_POOL', poolOf(fx))
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  set('PLINTH_COOLDOWN_MS', 20000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, home[a.toLowerCase()]); set(`BOARD_${a}`, home[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(R, 'sandbox/craft/trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  if (tp) {
    const p = at ?? { x: home.x + 0.5, y: home.y, z: home.z + 0.5 }
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${p.x} ${p.y} ${p.z}`)
    await sleep(8000)
    const c = [`tp ${NAME} ${p.x} ${p.y} ${p.z}`]
    let s = 0
    for (const [id, n] of slotsSpec) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id} ${n}`)
    rcon(...c)
  }
  await sleep(2000)
  return { skillLog, botOut, trace, tag }
}
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), run: RUN, ...r }) + '\n'); P_('RESULT', r) }
const recordOf = fx => { try { return JSON.parse(fs.readFileSync(`${poolDir(fx)}/junkwell-plinth-${homeKey(FIX[fx].home)}.json`, 'utf8')) } catch { return null } }
const CTX = {}

// ---------------------------------------------------------------- S1 build
async function sceneBuild (fx, rep, kill) {
  const F = FIX[fx]
  F.build()
  fs.mkdirSync(poolDir(fx), { recursive: true })
  for (const f of fs.readdirSync(poolDir(fx))) fs.rmSync(path.join(poolDir(fx), f), { force: true })
  fs.writeFileSync(`${poolDir(fx)}/junkwell-nosite-${homeKey(F.home)}.json`, JSON.stringify({ at: Date.now(), world: null, by: 'sandbox', tally: 'sandbox' }))
  // the driver's own plan from the arena model: the bot's must be the same (one planner, one world)
  const avoid = []
  for (let x = F.home.x - 24; x <= F.home.x + 24; x++) for (let z = F.home.z - 24; z <= F.home.z + 24; z++) for (let y = F.home.y - 24; y <= F.home.y + 24; y++) {
    if (Math.hypot(x - F.home.x, y - F.home.y, z - F.home.z) > 24) continue
    const b = F.read(x, y, z); if (b && /^(chest|trapped_chest|barrel|composter)$/.test(b.name)) avoid.push({ x, z, r: W.WELL_HOME_CLEARANCE })
  }
  const offline = PL.planPlinth({ read: F.read, home: F.home, avoid })
  const files = await startBot(fx, `build-${fx}-${rep}${kill ? '-kill' : ''}`, F.bag)
  const t0 = Date.now()
  const rec0 = await waitFor(() => { const r = recordOf(fx); return r?.state === 'plan' ? r : null }, 180000, 1000)
  if (!rec0) { await stopBot(); result({ scene: 'build', fx, rep, ok: false, why: 'no plan recorded', rows: rowsOf(files.skillLog).filter(r => /plinth/.test(r.name)).map(r => r.detail.slice(0, 200)) }); return }
  const plan = rec0.plan
  const samePlan = !!offline.plan && JSON.stringify(offline.plan.steps) === JSON.stringify(plan.steps)
  const seen = new Map()   // cell -> first ms it read placed on the server
  const kills = []
  let lastPlaced = 0, sawHazard = null
  const killAt = kill ? [Math.floor(plan.cost * 0.4), plan.hazardStep != null ? plan.hazardStep + 1 : Math.floor(plan.cost * 0.8)] : []
  let done = null
  while (Date.now() - t0 < 30 * 60_000) {
    const { placed, cleared } = planCells(plan)
    for (const k of placed) if (!seen.has(k)) seen.set(k, Date.now() - t0)
    lastPlaced = placed.size
    if (plan.hazardStep != null && sawHazard == null && passed(capCell(plan.cap))) {
      // the hazard reads from the world: the cap cell open and the 4 cardinals at g placed
      const hz = PL.plinthHazard(planWorld(F.read, plan, placed, cleared), plan.cap)
      if (hz) sawHazard = Date.now() - t0
    }
    if (killAt.length && placed.size >= killAt[0]) {
      const n = killAt.shift()
      P_(`KILL at ${placed.size} placed (target ${n})`)
      await stopBot('SIGKILL')
      kills.push({ at: placed.size, ms: Date.now() - t0, hazard: PL.plinthHazard(planWorld(F.read, plan, placed, cleared), plan.cap) })
      await sleep(3000)
      await startBot(fx, `build-${fx}-${rep}-kill${kills.length}`, [], { tp: false })
    }
    const rec = recordOf(fx)
    if (rec?.state === 'complete') { done = Date.now() - t0; break }
    await sleep(2500)
  }
  await sleep(4000)
  const fin = planCells(plan)
  const rows = rowsOf(files.skillLog).concat(...kills.map((_, i) => rowsOf(`${R}/sandbox/log/plinth-e2e/${RUN}-build-${fx}-${rep}-kill${i + 1}/skill-${NAME}.jsonl`)))
  const prow = rows.filter(r => r.name === '_plinth')
  const box = { x0: plan.cap.x - 7, x1: plan.cap.x + 7, z0: plan.cap.z - 7, z1: plan.cap.z + 7, y0: plan.cap.y - 4, y1: plan.cap.y + 1 }
  const cob = cobbleIn(box)
  const planKeys = new Set(plan.steps.filter(s => s.op === 'place').map(s => s.c.join(',')))
  const before = new Set(); for (let x = box.x0; x <= box.x1; x++) for (let y = box.y0; y <= box.y1; y++) for (let z = box.z0; z <= box.z1; z++) if (F.read(x, y, z)?.name === 'cobblestone') before.add(`${x},${y},${z}`)
  const outside = [...cob].filter(k => !planKeys.has(k) && !before.has(k))
  const traces = [files.trace, ...kills.map((_, i) => `${OUT}/trace-${RUN}-build-${fx}-${rep}-kill${i + 1}.jsonl`)].flatMap(f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean))
  const placePkts = traces.filter(e => e.pkt === 'block_place').length
  const capRep = { open: passed(capCell(plan.cap)), stage: null }
  const times = [...seen.values()].sort((a, b) => a - b)
  const gaps = times.slice(1).map((v, i) => v - times[i]).sort((a, b) => a - b)
  CTX[fx] = { plan, files, cap: plan.cap }
  result({ scene: 'build', fx, rep, kill: !!kill, ok: !!done && fin.placed.size === planKeys.size && outside.length === 0,
    cap: plan.cap, k: plan.k, steps: plan.steps.length, places: planKeys.size, clears: plan.clears, stair: plan.stair.length, hazardStep: plan.hazardStep,
    samePlanAsOffline: samePlan, completeMs: done, serverPlaced: fin.placed.size, serverCleared: fin.cleared.size, outsidePlan: outside.slice(0, 10), outsideN: outside.length,
    blockPlacePackets: placePkts, retries: prow.reduce((t, r) => t + (Number(field(r.detail, 'retries')) || 0), 0), alt: prow.reduce((t, r) => t + (Number(field(r.detail, 'alt')) || 0), 0),
    visits: prow.filter(r => /^stage=(build|complete)/.test(r.detail)).length, kills, hazardSeenMs: sawHazard,
    pitRows: rows.filter(r => /^_well_pit/.test(r.name)).map(r => `${r.name} ${r.detail.slice(0, 120)}`), capOpenAtEnd: capRep.open,
    placeGapMs: gaps.length ? { p50: gaps[Math.floor(gaps.length / 2)], p90: gaps[Math.floor(gaps.length * 0.9)], max: gaps[gaps.length - 1] } : null,
    plinthRows: prow.map(r => r.detail.slice(0, 200)), failRows: rows.filter(r => r.name === '_plinth' && r.status === 'failed').map(r => r.detail.slice(0, 200)) })
  await stopBot()
}
function planWorld (read, plan, placed, cleared) {
  const cells = new Map()
  for (const s of plan.steps) { const k = s.c.join(','); if (s.op === 'place' && placed.has(k)) cells.set(PL.cellKey(...s.c), PL.PLACED); if (s.op === 'clear' && cleared.has(k)) cells.set(PL.cellKey(...s.c), PL.AIR) }
  return PL.overlay(read, cells)
}

// ---------------------------------------------------------------- S2 the well on the plinth: build, dispose, isolation
const ARENA_SEL = `@e[type=item,x=${A.x0},y=${A.y0},z=${A.z0},dx=${A.x1 - A.x0},dy=${A.y1 - A.y0},dz=${A.z1 - A.z0}]`
const shaftSel = cap => `@e[type=item,x=${cap.x},y=${cap.y - 2},z=${cap.z},dx=0,dy=1.4,dz=0]`
const has = rep => { const m = /has (-?\d+) \[/.exec(rep || ''); return m ? Number(m[1]) : null }
function census (cap) {
  const sh = shaftSel(cap)
  const r = rcon('scoreboard objectives add wc dummy',
    `execute as ${ARENA_SEL} store result score @s wc run data get entity @s Item.count`,
    'scoreboard players set #in wc 0', 'scoreboard players set #all wc 0',
    `scoreboard players operation #in wc += ${sh} wc`, `scoreboard players operation #all wc += ${ARENA_SEL} wc`,
    'scoreboard players get #in wc', 'scoreboard players get #all wc')
  const inItems = has(r[6]?.reply), allItems = has(r[7]?.reply)
  return { inItems, allItems, outItems: allItems - inItems }
}
const LISTED = ['egg', 'brown_egg', 'blue_egg', 'flint', 'clay_ball', 'ink_sac', 'glow_ink_sac', 'armadillo_scute', 'dead_bush', 'pointed_dripstone', 'rail']
const ROCKS = ['andesite', 'diorite', 'granite', 'calcite']
const fillBag = (spec, n = 36) => { const out = [...spec]; let i = 0; while (out.length < n) out.push([ROCKS[i++ % ROCKS.length], 64]); return out }
let walker = null
async function walkerJoin () {
  if (walker) return walker
  const mineflayer = breq('mineflayer')
  walker = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: WALKER, version: '1.21.8', auth: 'offline' })
  walker.on('error', e => P_('walker error', String(e?.message)))
  await new Promise(r => walker.once('spawn', r)); await sleep(1500)
  rcon(`gamemode survival ${WALKER}`, `clear ${WALKER}`)
  return walker
}
async function walkerLeave () { if (walker) { try { walker.quit('done') } catch {} walker = null; await sleep(2000) } }
const { Vec3 } = breq('vec3')
async function tpWalker (x, y, z) {
  rcon(`tp ${WALKER} ${x} ${y} ${z}`)
  const t = new Vec3(x, y, z)
  for (let i = 0; i < 40; i++) { if (walker.entity.position.distanceTo(t) < 0.1) break; await sleep(100) }
  await sleep(300)
}
async function walkTo (x, z, { jump = false, timeout = 4000, tol = 0.25 } = {}) {
  const end = Date.now() + timeout; let minY = walker.entity.position.y
  while (Date.now() < end) {
    const p = walker.entity.position; minY = Math.min(minY, p.y)
    if (Math.hypot(x - p.x, z - p.z) < tol) break
    await walker.lookAt(new Vec3(x, p.y + 1.62, z), true)
    walker.setControlState('forward', true); walker.setControlState('jump', jump)
    await sleep(50)
  }
  walker.clearControlStates(); await sleep(150)
  return Math.min(minY, walker.entity.position.y)
}
function bagOf (name) {
  const cmds = []; for (let s = 0; s < 36; s++) cmds.push(`data get entity ${name} Inventory[{Slot:${s}b}]`)
  const r = rcon(...cmds); const totals = {}
  for (let s = 0; s < 36; s++) { const rep = r[s]?.reply || ''; if (!/has the following entity data/.test(rep)) continue; const id = (rep.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]; if (id) totals[id] = (totals[id] || 0) + +((rep.match(/count: (\d+)/) || [])[1] || 1) }
  return totals
}
async function sceneWell (fx) {
  const cx = CTX[fx]
  if (!cx) throw new Error(`no plinth built for ${fx} in this run`)
  const cap = cx.plan.cap, g = cap.y
  // build_well: the plinth's covered pit + two trapdoors carried
  const files = await startBot(fx, `well-${fx}`, [['oak_trapdoor', 2], ['dirt', 4], ['cobblestone', 64]])
  const built = await waitFor(() => rowsOf(files.skillLog).find(r => r.name === '_well_built'), 300000, 2000)
  const facing = built ? field(built.detail, 'facing') : null
  const blocks = rcon(`execute if block ${cap.x} ${g} ${cap.z} #minecraft:wooden_trapdoors[half=top,open=false]`, `execute if block ${cap.x} ${g - 1} ${cap.z} #minecraft:wooden_trapdoors[half=bottom]`)
  const wellOk = passed(blocks[0]?.reply) && passed(blocks[1]?.reply)
  await stopBot()
  result({ scene: 'well-build', fx, cap, built: !!built, facing, wellOk, row: built?.detail.slice(0, 200), refused: rowsOf(files.skillLog).filter(r => r.name === '_well_refused').map(r => r.detail.slice(0, 160)).slice(0, 8) })
  if (!wellOk) return
  // DISPOSE: one visit of every listed kind (as well-e2e's dispose scene), census in/out of the shaft at +1.5 s and +30 s
  rcon(`kill ${ARENA_SEL}`)
  const listed = LISTED.map(id => [id, ['egg', 'brown_egg', 'blue_egg'].includes(id) ? 16 : 64])
  const other = [['cobblestone', 64], ['oak_sapling', 20], ['bread', 8], ['stone_pickaxe', 1], ['oak_log', 5]]
  const f2 = await startBot(fx, `dispose-${fx}`, fillBag([...listed, ...other]))
  const before = bagOf(NAME)
  const ended = await waitFor(() => rowsOf(f2.skillLog).find(r => r.name === '_well_dispose' && r.status !== 'aborted'), 300000, 2000)
  await sleep(1500)
  const c1 = census(cap)
  await sleep(30000)
  const c30 = census(cap)
  const after = bagOf(NAME)
  const delta = Object.fromEntries(Object.keys({ ...before, ...after }).map(k => [k, (after[k] || 0) - (before[k] || 0)]).filter(([, d]) => d))
  await stopBot()
  result({ scene: 'dispose', fx, k: cx.plan.k, row: ended?.detail.slice(0, 260), census: c1, censusAt30s: c30, delta, nonListedLost: Object.entries(delta).filter(([k, v]) => v < 0 && !LISTED.includes(k)) })
  // ISOLATION: the walker crosses the plinth top 60 times beside the shaft, stands on the cap, and stands on the LEDGE
  // (feet g, two out) -- a body there must not reach an item in the shaft. Positive control: an egg on the top, collected.
  await walkerJoin()
  rcon(`clear ${WALKER}`, `execute as ${shaftSel(cap)} run data modify entity @s Age set value 0s`)
  const X = cap.x + 0.5, Z = cap.z + 0.5
  rcon(`summon item ${X + 1} ${g + 1} ${Z + 1} {Item:{id:"minecraft:egg",count:1},PickupDelay:0s,Tags:["wellctl"]}`)
  await tpWalker(X - 1, g + 1, Z - 1); await walkTo(X + 1, Z + 1, { timeout: 5000 }); await sleep(1500)
  const ctl = bagOf(WALKER)
  rcon(`clear ${WALKER}`)
  const c0 = census(cap)
  let minY = 999
  for (let i = 0; i < 60; i++) {
    const dir = i % 2 ? 1 : -1
    if (i % 3 === 0) { await walkTo(X - 1 * dir, Z, { timeout: 3000 }); minY = Math.min(minY, await walkTo(X + 1 * dir, Z, { jump: i % 4 === 0, timeout: 3000 })) }
    else if (i % 3 === 1) { await walkTo(X, Z - 1 * dir, { timeout: 3000 }); minY = Math.min(minY, await walkTo(X, Z + 1 * dir, { jump: i % 5 === 0, timeout: 3000 })) }
    else { await walkTo(X - 1 * dir, Z - 1 * dir, { timeout: 3000 }); minY = Math.min(minY, await walkTo(X + 1 * dir, Z + 1 * dir, { timeout: 3000 })) }
  }
  const cMid = census(cap); const wMid = bagOf(WALKER)
  // THE LEDGE: feet at g on each of the 4 cardinal ledge cells (two out), 10 s each, crouching and jumping
  const ledge = []
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
    await tpWalker(X + dx, g, Z + dz)
    const y0 = walker.entity.position.y
    for (let j = 0; j < 5; j++) { walker.setControlState('sneak', j % 2 === 0); walker.setControlState('jump', j % 2 === 1); await sleep(1000); walker.clearControlStates(); await sleep(1000) }
    ledge.push({ at: [dx, dz], feetY: +y0.toFixed(3), bag: bagOf(WALKER) })
  }
  const c1i = census(cap); const wb = bagOf(WALKER)
  await tpWalker(X + 12, g + 4, Z + 12)
  await walkerLeave()
  result({ scene: 'isolation', fx, k: cx.plan.k, control: ctl, wellBefore: c0, afterPasses: cMid, walkerAfterPasses: wMid, afterLedge: c1i, walkerBag: wb, ledge, passes: 60, minY })
}

// ---------------------------------------------------------------- S3 pathing: 50 trips on the real pathfinder
async function scenePath (fx) {
  const cx = CTX[fx]
  if (!cx) throw new Error(`no plinth for ${fx}`)
  const cap = cx.plan.cap
  const st = W.wellStand(planWorld(FIX[fx].read, cx.plan, new Set(cx.plan.steps.map(s => s.c.join(','))), new Set()), cap)
  await walkerJoin()
  const { pathfinder, Movements, goals } = breq('mineflayer-pathfinder')
  walker.loadPlugin(pathfinder)
  const m = new Movements(walker); m.canDig = false; m.allow1by1towers = false; m.scafoldingBlocks = []
  m.exclusionAreasStep = [b => W.wellStepCost([cap], b)]
  walker.pathfinder.setMovements(m)
  const home = FIX[fx].home
  const trips = []
  let colNodes = 0, inColSamples = 0
  for (let i = 0; i < 50; i++) {
    for (const [goal, label] of [[new goals.GoalBlock(st.stand.x, st.stand.y, st.stand.z), 'stand'], [new goals.GoalNear(home.x, home.y, home.z, 1), 'home']]) {
      const t0 = Date.now(); let ok = true, nodes = 0
      const onPath = r => { for (const n of r.path ?? []) { nodes++; if (PL.inColumn(cap, Math.floor(n.x), Math.floor(n.y), Math.floor(n.z))) colNodes++ } }
      walker.on('path_update', onPath)
      const watch = setInterval(() => { const p = walker.entity.position; if (PL.inColumn(cap, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) inColSamples++ }, 100)
      try { await Promise.race([walker.pathfinder.goto(goal), sleep(30000).then(() => { throw new Error('timeout') })]) } catch (e) { ok = false }
      clearInterval(watch); walker.removeListener('path_update', onPath)
      const p = walker.entity.position
      trips.push({ i, label, ok, ms: Date.now() - t0, nodes, at: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)] })
      if (!ok) { try { walker.pathfinder.stop() } catch {} rcon(`tp ${WALKER} ${home.x + 0.5} ${home.y} ${home.z + 0.5}`); await sleep(1500) }
    }
  }
  await walkerLeave()
  const toStand = trips.filter(t => t.label === 'stand')
  result({ scene: 'path', fx, cap, stand: st.stand, trips: trips.length, toStandOk: toStand.filter(t => t.ok).length, toStand: toStand.length,
    homeOk: trips.filter(t => t.label === 'home' && t.ok).length, pathNodesInColumn: colNodes, bodySamplesInColumn: inColSamples,
    standMsP50: toStand.map(t => t.ms).sort((a, b) => a - b)[Math.floor(toStand.length / 2)], fails: trips.filter(t => !t.ok).slice(0, 5) })
}

// ---------------------------------------------------------------- S4 entombed beside the plinth; a bot in a town pit
async function sceneTomb (fx) {
  const cx = CTX[fx]
  if (!cx) throw new Error(`no plinth for ${fx}`)
  const plan = cx.plan, cap = plan.cap
  const shell = new Set(plan.steps.filter(s => s.op === 'place').map(s => s.c.join(',')))
  // ENTOMBED: a 1x2 pocket against the plinth's east wall at the g-2 level, sealed in stone on every other side
  const ex = cap.x + 3, ey = cap.y - 2, ez = cap.z
  const seal = []
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 2; dy++) { const x = ex + dx, y = ey + dy, z = ez + dz; if (shell.has(`${x},${y},${z}`)) continue; if (dx === 0 && dz === 0 && (dy === 0 || dy === 1)) continue; seal.push(`setblock ${x} ${y} ${z} minecraft:stone`) }
  rcon(...seal, `setblock ${ex} ${ey} ${ez} minecraft:air`, `setblock ${ex} ${ey + 1} ${ez} minecraft:air`)
  const before = planCells(plan)
  const f1 = await startBot(fx, `tomb-${fx}`, [['cobblestone', 64], ['dirt', 8], ['stone_pickaxe', 1]], { at: { x: ex + 0.5, y: ey, z: ez + 0.5 } })
  const out1 = await waitFor(() => { const r = rcon(`data get entity ${NAME} Pos`)[0]?.reply || ''; const m = /\[([-\d.]+)d, ([-\d.]+)d, ([-\d.]+)d\]/.exec(r); if (!m) return null; const p = { x: +m[1], y: +m[2], z: +m[3] }; return Math.floor(p.x) !== ex || Math.floor(p.z) !== ez || Math.floor(p.y) !== ey ? p : null }, 180000, 2000)
  await sleep(5000)
  const after1 = planCells(plan)
  const rows1 = rowsOf(f1.skillLog).filter(r => /entomb|escape|marooned|pillar|surface|dig|plinth/.test(r.name)).map(r => `${r.name} ${r.detail.slice(0, 140)}`).slice(0, 20)
  await stopBot()
  result({ scene: 'tomb', fx, out: out1, plinthLost: [...before.placed].filter(k => !after1.placed.has(k)), rows: rows1 })
  // A TOWN PIT: 3 deep, 1 wide, right beside the plinth's foot on the far side from the stair
  const px = cap.x - 3, pz = cap.z, py = plan.t
  rcon(`fill ${px} ${py - 2} ${pz} ${px} ${py} ${pz} minecraft:air`)
  const before2 = planCells(plan)
  const f2 = await startBot(fx, `pit-${fx}`, [['cobblestone', 64], ['dirt', 8], ['stone_pickaxe', 1]], { at: { x: px + 0.5, y: py - 2, z: pz + 0.5 } })
  const out2 = await waitFor(() => { const r = rcon(`data get entity ${NAME} Pos`)[0]?.reply || ''; const m = /\[([-\d.]+)d, ([-\d.]+)d, ([-\d.]+)d\]/.exec(r); if (!m) return null; const p = { x: +m[1], y: +m[2], z: +m[3] }; return p.y >= py + 1 ? p : null }, 180000, 2000)
  await sleep(5000)
  const after2 = planCells(plan)
  const rows2 = rowsOf(f2.skillLog).filter(r => /entomb|escape|marooned|pillar|surface|stuck|pit|plinth/.test(r.name)).map(r => `${r.name} ${r.detail.slice(0, 140)}`).slice(0, 20)
  await stopBot()
  result({ scene: 'pit', fx, out: out2, plinthLost: [...before2.placed].filter(k => !after2.placed.has(k)), rows: rows2 })
}

async function main () {
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(11499, '127.0.0.1', resolve) })
  P_(`root=${BOT_ROOT} sha=${execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()} server=${SERVER} scenes=${SCENES_S}`)
  rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  for (const s of SCENES_S.split(',')) {
    const [kind, fx, rep, kill] = s.split(':')
    P_('=== scene', s)
    try {
      if (kind === 'build') await sceneBuild(fx, Number(rep) || 1, kill === 'kill')
      else if (kind === 'well') await sceneWell(fx)
      else if (kind === 'path') await scenePath(fx)
      else if (kind === 'tomb') await sceneTomb(fx)
      else throw new Error(`unknown scene ${s}`)
    } catch (e) { P_('scene failed', s, e.stack || e.message); result({ scene: kind, fx, error: String(e.message).slice(0, 300) }); await stopBot().catch(() => {}) }
  }
}
async function cleanup () {
  await stopBot().catch(() => {}); await walkerLeave().catch(() => {})
  try { brain.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.plinth-e2e`) } catch {}
  try {
    clearArena()
    P_('cleanup', rcon('scoreboard objectives remove wc', `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, 'list').map(x => `${x.cmd.slice(0, 40)} => ${x.reply.slice(0, 80)}`))
  } catch (e) { P_('cleanup failed', e.message) }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { P_('FATAL', e.stack || e.message); finish(1) })
process.on('SIGINT', () => finish(1)); process.on('SIGTERM', () => finish(1))
