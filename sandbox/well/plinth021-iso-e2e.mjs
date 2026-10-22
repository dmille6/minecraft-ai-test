#!/usr/bin/env node
// plinth-02.1 PAPER DRIVER, THE ISOLATED CASE (10-17). SANDBOX ONLY (Paper 1.21.8, 10.0.0.30:25599..25602).
// TWO real bots (src/index.mjs from <botRoot>, unmodified) with SEPARATE state dirs (MEMORY_SCOPE=isolated, MEMORY_POOL=
// sbxiso-<run>-<Bot>) and ONE home over a dug-out arena (a 2-thick dirt slab floating at 118-119: no natural site), each pool
// holding the town's no-site record -- the fleet's isolated pools as they stood at the 0fe92258 rollout. The loopback brain
// answers 'status'. Read: each bot's plinth record (plan / none), its _plinth rows, its `_plinth021_mode` licence row, and the
// SERVER's cobblestone in the arena (RCON execute if block), after WAIT_MS of town orders.
//   expected on plinth-02.1: no plan in either dir, no _plinth planned row, 0 cobblestone placed, shared=0 in both licences
//   CONTROL (the same driver on 0fe92258): a plan in BOTH dirs (two leases, one town) and cobblestone placed
//
//   WELL_REPO=<a copy holding sandbox/run-bot.sh + sandbox/sandbox-bot-scripted.env> node plinth021-iso-e2e.mjs <botRoot> <label> [server]
// Refuses unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `plinth021`. World edits on the arena only.
import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import sbx from '../lib/sbxlock.cjs'
import path from 'node:path'

const [BOT_ROOT, LABEL = 'run', SERVER = 'sandbox2'] = process.argv.slice(2)
if (!BOT_ROOT) throw new Error('usage: plinth021-iso-e2e.mjs <botRoot> <label> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
sbx.requireSandboxLock(SERVER, 'plinth021')   // the global lock or this server's own (sandbox/lib/sbxlock.cjs); throws unless every lock on SERVER has our tag as its owner's first word
const R = process.env.WELL_REPO
if (!R || !fs.existsSync(`${R}/sandbox/run-bot.sh`)) throw new Error('WELL_REPO must hold sandbox/run-bot.sh')
const WAIT_MS = Number(process.env.ISO_WAIT_MS || 240_000)
const BOTS = ['sandbox-IsoA', 'sandbox-IsoB']
const BRAIN_PORT = Number(process.env.ISO_BRAIN_PORT || 11496)
const OUT = `${R}/sandbox/log/plinth021-iso`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-iso-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const C = { x: 2400, z: 2400 }
const A = { x0: C.x - 26, x1: C.x + 26, z0: C.z - 26, z1: C.z + 26, y0: 100, y1: 140 }
const HOME = { x: C.x, y: 120, z: C.z }
function arena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=${A.y0},z=${A.z0},dx=${A.x1 - A.x0},dy=${A.y1 - A.y0},dz=${A.z1 - A.z0}]`]
  for (let y = A.y0; y <= A.y1; y += 10) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(A.y1, y + 9)} ${A.z1} minecraft:air`)
  c.push(`fill ${C.x - 24} 118 ${C.z - 24} ${C.x + 24} 119 ${C.z + 24} minecraft:dirt`)
  const bad = rcon(...c).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
function cobbleCount () {
  const cmds = []
  for (let x = C.x - 16; x <= C.x + 16; x++) for (let z = C.z - 16; z <= C.z + 16; z++) for (let y = 116; y <= 126; y++) cmds.push(`execute if block ${x} ${y} ${z} minecraft:cobblestone`)
  let n = 0
  for (let i = 0; i < cmds.length; i += 500) n += rcon(...cmds.slice(i, i + 500)).filter(x => passed(x.reply)).length
  return n
}
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill).map(r => ({ name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '') }))
async function waitFor (pred, ms, step = 1000) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ skill: 'status', args: {}, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
const RUN = `${new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)}-${LABEL}`
const pool = name => `sbxiso-${RUN}-${name.replace('sandbox-', '')}`
const poolDir = name => `${R}/sandbox/state/_pool-${pool(name)}`
const homeKey = `${HOME.x}_${HOME.y}_${HOME.z}`
const procs = []
async function startBot (name, i) {
  const logRel = `./sandbox/log/plinth021-iso/${RUN}-${name}`
  const botOut = `${OUT}/bot-${RUN}-${name}.out`
  const envRel = `sandbox/.env.iso-${name}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', name); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/iso-${RUN}-${name}`)
  set('MEMORY_SCOPE', 'isolated'); set('MEMORY_POOL', pool(name))
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  set('PLINTH_COOLDOWN_MS', 20000); set('WORLD_BORDER_RADIUS', 4000); set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  procs.push(spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] }))
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) throw new Error(`no spawn ${name}`)
  rcon(`gamemode survival ${name}`, `clear ${name}`, `tp ${name} ${HOME.x + 0.5 + i * 2} ${HOME.y} ${HOME.z + 0.5}`)
  await sleep(5000)
  const bag = [['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 64], ['dirt', 8], ['oak_trapdoor', 2]]
  rcon(`tp ${name} ${HOME.x + 0.5 + i * 2} ${HOME.y} ${HOME.z + 0.5}`, ...bag.map(([id, n], s) => `item replace entity ${name} container.${s} with minecraft:${id} ${n}`))
  return { skillLog: `${R}/sandbox/log/plinth021-iso/${RUN}-${name}/skill-${name}.jsonl` }
}
const readRec = name => { try { return JSON.parse(fs.readFileSync(`${poolDir(name)}/junkwell-plinth-${homeKey}.json`, 'utf8')) } catch { return null } }

async function main () {
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  let sha = '-'; try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}
  P_(`root=${BOT_ROOT} sha=${sha} label=${LABEL} server=${SERVER}`)
  rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  arena()
  const cob0 = cobbleCount()
  for (const b of BOTS) {
    fs.mkdirSync(poolDir(b), { recursive: true })
    fs.writeFileSync(`${poolDir(b)}/junkwell-nosite-${homeKey}.json`, JSON.stringify({ at: Date.now() - 60_000, world: null, by: 'sandbox', tally: 'sandbox' }))
  }
  const files = []
  for (let i = 0; i < BOTS.length; i++) files.push(await startBot(BOTS[i], i))
  await sleep(WAIT_MS)
  const per = BOTS.map((b, i) => {
    const rows = rowsOf(files[i].skillLog), rec = readRec(b)
    return { bot: b, record: rec ? { state: rec.state, cap: rec.plan?.cap ?? null, k: rec.plan?.k ?? null } : null,
      planned: rows.filter(r => r.name === '_plinth' && /^stage=planned/.test(r.detail)).length,
      plinthRows: rows.filter(r => r.name === '_plinth').map(r => r.detail.slice(0, 120)).slice(0, 4),
      buildPlinth: rows.filter(r => r.name === 'build_plinth').map(r => `${r.status} ${r.detail.slice(0, 100)}`).slice(0, 3),
      licence: rows.filter(r => r.name === '_plinth021_mode').map(r => r.detail).slice(0, 1),
      leases: fs.existsSync(poolDir(b)) ? fs.readdirSync(poolDir(b)).filter(f => /\.lease\.g\d+\.json$/.test(f)).length : 0 }
  })
  const cob = cobbleCount()
  const res = { at: new Date().toISOString(), run: RUN, label: LABEL, sha, waitMs: WAIT_MS, cobbleBefore: cob0, cobbleAfter: cob, bots: per,
    plans: per.filter(p => p.record?.state === 'plan' || p.record?.state === 'complete').length }
  fs.appendFileSync(RES, JSON.stringify(res) + '\n'); P_('RESULT', res)
}
async function cleanup () {
  for (const p of procs) { try { p.kill('SIGTERM') } catch {} }
  await waitFor(() => !BOTS.some(b => new RegExp(b).test(r1('list'))), 30000, 1000)
  try { brain.close() } catch {}
  for (const b of BOTS) { try { fs.unlinkSync(`${R}/sandbox/.env.iso-${b}`) } catch {} }
  try {
    const c = [`kill @e[type=!player,x=${A.x0},y=${A.y0},z=${A.z0},dx=${A.x1 - A.x0},dy=${A.y1 - A.y0},dz=${A.z1 - A.z0}]`]
    for (let y = A.y0; y <= A.y1; y += 10) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${Math.min(A.y1, y + 9)} ${A.z1} minecraft:air`)
    P_('cleanup', rcon(...c, `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, 'list').slice(-1).map(x => x.reply.slice(0, 80)))
  } catch (e) { P_('cleanup failed', e.message) }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { P_('FATAL', e.stack || e.message); finish(1) })
process.on('SIGINT', () => finish(1)); process.on('SIGTERM', () => finish(1))
