#!/usr/bin/env node
// SANDBOX-ONLY end-to-end run of WITHDRAW BEFORE DIG and goto's dig-retry evidence (stonewithdraw-01), Paper 1.21.8.
// The REAL bot (src/index.mjs from <botRoot>, unmodified) decides through its own cognition; a loopback brain hands it
// model verbs from a queue (`withdraw stick 1` so it opens and COUNTS the town chest, then `gather stone 16`).
//
//   WELL_REPO=<harness checkout (main)> node sandbox/stone/stonewithdraw-e2e.mjs <botRoot> <scene,...> [server]
//   scenes: surface   a town chest with 192 cobble, the bot at the surface by it: the gather must become a withdrawal --
//                     the server's bag gains the cobble, the chest loses it, and NOT ONE stone cell is dug
//           short     the same town with 70 cobble (the floor of 64 refuses a 16 withdrawal): the gather must run and dig
//                     stone (the positive control: the rule did not just stop stone gathering)
//           deepslate the town holds only cobbled_deepslate: the rewrite's `alt` takes it (Codex stage-2 P2-1)
//           retry     the bot sealed in a 1x1 stone pocket asked to goto 12 blocks away: the walk cannot leave, goto's dig
//                     retry runs, and its `_goto_dig_retry` row must carry the evidence args (walk_status, bag_cobble,
//                     retry_digs > 0)
// THE SERVER'S TRUTH: bag and chest counts by RCON `data get`, stone cells by `execute if block`. Rows are the bot's.
// Refuses unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `stonewithdraw`.
import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [BOT_ROOT, SCENES_S, SERVER = 'sandbox4'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: stonewithdraw-e2e.mjs <botRoot> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
if (!/stonewithdraw/.test(lock)) throw new Error(`the sandbox lock does not name stonewithdraw: ${lock.trim()}`)
const __dir = path.dirname(fileURLToPath(import.meta.url))
const R = process.env.WELL_REPO || path.resolve(__dir, '../..')
const NAME = 'sandbox-Stone'
const BRAIN_PORT = 11497
const OUT = `${R}/sandbox/log/stonewithdraw-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-stone-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }

// ---------------------------------------------------------------- the arena: a stone slab y 112..119, the bot stands on 119
const C = { x: 2600, z: 2600 }
const A = { x0: C.x - 20, x1: C.x + 20, z0: C.z - 20, z1: C.z + 20 }
const HOME = { x: C.x, y: 120, z: C.z }
const CHEST = { x: C.x + 2, y: 120, z: C.z }
const PATCH = { x0: C.x - 8, x1: C.x - 4, z0: C.z - 2, z1: C.z + 2, y: 119 }   // the stone the gather would dig (top layer)
function buildArena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=100,z=${A.z0},dx=${A.x1 - A.x0},dy=40,dz=${A.z1 - A.z0}]`,
    `fill ${A.x0} 120 ${A.z0} ${A.x1} 135 ${A.z1} minecraft:air`,
    // a SOLID arena down to 96 (run 1 of 10-15: a floating slab let the gather dig through the patch's bottom and fall 42)
    `fill ${A.x0} 96 ${A.z0} ${A.x1} 103 ${A.z1} minecraft:dirt`, `fill ${A.x0} 104 ${A.z0} ${A.x1} 111 ${A.z1} minecraft:dirt`,
    `fill ${A.x0} 112 ${A.z0} ${A.x1} 119 ${A.z1} minecraft:dirt`,
    `fill ${PATCH.x0} 112 ${PATCH.z0} ${PATCH.x1} ${PATCH.y} ${PATCH.z1} minecraft:stone`]
  const bad = rcon(...c).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
function setChest (stacks) {
  const c = [`setblock ${CHEST.x} ${CHEST.y} ${CHEST.z} minecraft:air`, `setblock ${CHEST.x} ${CHEST.y} ${CHEST.z} minecraft:chest`]
  stacks.forEach(([id, n], i) => c.push(`item replace block ${CHEST.x} ${CHEST.y} ${CHEST.z} container.${i} with minecraft:${id} ${n}`))
  rcon(...c)
}
const parseItem = seg => { const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]; return id ? { id, count: +((seg.match(/count: (\d+)/) || [])[1] || 1) } : null }
function chestTotals () {
  const cmds = []; for (let s = 0; s < 27; s++) cmds.push(`data get block ${CHEST.x} ${CHEST.y} ${CHEST.z} Items[{Slot:${s}b}]`)
  const t = {}; for (const r of rcon(...cmds)) { const it = /has the following block data/.test(r.reply) ? parseItem(r.reply) : null; if (it) t[it.id] = (t[it.id] || 0) + it.count }
  return t
}
function bag () {
  const cmds = []; for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  const t = {}; for (const r of rcon(...cmds)) { const it = /has the following entity data/.test(r.reply) ? parseItem(r.reply) : null; if (it) t[it.id] = (t[it.id] || 0) + it.count }
  return t
}
function stoneCells () {
  const cmds = []
  for (let x = PATCH.x0; x <= PATCH.x1; x++) for (let z = PATCH.z0; z <= PATCH.z1; z++) for (let y = 112; y <= PATCH.y; y++) cmds.push(`execute if block ${x} ${y} ${z} minecraft:stone`)
  return rcon(...cmds).filter(r => passed(r.reply)).length
}

// ---------------------------------------------------------------- the brain: a queue of model verbs, else harmless turns
const queue = []
let brainN = 0
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = queue.shift()
    if (!decision) { const n = brainN++ % 2; decision = n === 0 ? { skill: 'status', args: {} } : { skill: 'goto', args: { x: HOME.x + 1, y: HOME.y, z: HOME.z + 2 } } }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})

// ---------------------------------------------------------------- the bot
let bot = null
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
async function stopBot (sig = 'SIGTERM') {
  try { bot && bot.kill(sig) } catch {}
  bot = null
  await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000)
}
async function startBot (tag, slotsSpec, at = { x: HOME.x + 0.5, y: HOME.y, z: HOME.z + 0.5 }) {
  const logRel = `./sandbox/log/stonewithdraw-e2e/${RUN}-${tag}`
  const skillLog = `${R}/sandbox/log/stonewithdraw-e2e/${RUN}-${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${RUN}-${tag}.out`
  const envRel = 'sandbox/.env.stonewithdraw-e2e'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/stone-${RUN}-${tag}`); set('MEMORY_POOL', `sbxstone-${RUN}-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 20)
  set('WORLD_BORDER_RADIUS', 4000)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${at.x} ${at.y} ${at.z}`)
  await sleep(6000)
  const c = [`tp ${NAME} ${at.x} ${at.y} ${at.z}`]
  let s = 0
  for (const [id, n] of slotsSpec) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id} ${n}`)
  rcon(...c)
  await sleep(2000)
  return { skillLog, botOut }
}
const result = r => { fs.appendFileSync(RES, JSON.stringify({ run: RUN, at: new Date().toISOString(), ...r }) + '\n'); P_('RESULT', r) }
const KIT = [['stone_pickaxe', 1], ['stone_pickaxe', 1], ['bread', 16]]

async function sceneTown (scene, cobble, item = 'cobblestone') {
  buildArena()
  const stacks = [['stick', 5]]; for (let left = cobble; left > 0; left -= 64) stacks.push([item, Math.min(64, left)])
  setChest(stacks)
  const stone0 = stoneCells(), chest0 = chestTotals()
  const f = await startBot(scene, KIT)
  const bag0 = bag()
  queue.push({ skill: 'withdraw', args: { item: 'stick', count: 1 } })   // opens the chest: the bot's own cobbleObserve counts it
  const counted = await waitFor(() => rowsOf(f.skillLog).find(r => r.skill.name === 'withdraw'), 180000)
  queue.push({ skill: 'gather', args: { block: 'stone', count: 16 } })
  const sw = await waitFor(() => rowsOf(f.skillLog).find(r => r.skill.name === '_stone_withdraw' || r.skill.name === 'stone_withdraw'), 120000)
  // the action the verdict chose, to its end
  const want = sw?.skill?.args?.source === 'withdraw' ? 'withdraw' : 'gather'
  const done = await waitFor(() => rowsOf(f.skillLog).filter(r => r.skill.name === want).find(r => !counted || Date.parse(r['@timestamp']) > Date.parse(counted['@timestamp'])), 240000)
  await sleep(3000)
  const bag1 = bag(), chest1 = chestTotals(), stone1 = stoneCells()
  await stopBot()
  const d = k => (bag1[k] || 0) - (bag0[k] || 0)
  // the BASE's own withdraw_pick may take pickaxe ingredients (3 cobble) from the same chest (run 2 of 10-15): its rows say
  // how many (srv=cobblestone:+N), and they are not the stone rule's
  const pickCobble = rowsOf(f.skillLog).filter(r => r.skill.name === '_withdraw_pick' && /verb=withdraw_pick/.test(String(r.skill.detail))).reduce((t, r) => t + Number((/srv=[^ ]*cobblestone:\+(\d+)/.exec(String(r.skill.detail)) || [])[1] || 0), 0)
  const out = { scene, cobbleInChest: cobble, counted: counted ? `${counted.skill.status}: ${String(counted.skill.detail).slice(0, 80)}` : null,
    verdict: sw?.skill?.args ?? null, action: done ? `${done.skill.name} ${done.skill.status}: ${String(done.skill.detail).slice(0, 100)}` : null,
    server: { bagCobble: d('cobblestone'), bagDeepslate: d('cobbled_deepslate'), chestCobble: (chest1.cobblestone || 0) - (chest0.cobblestone || 0), chestDeepslate: (chest1.cobbled_deepslate || 0) - (chest0.cobbled_deepslate || 0), stoneDug: stone0 - stone1 }, withdrawPickCobble: pickCobble }
  if (scene === 'surface') out.ok = !!(sw && sw.skill.args.source === 'withdraw' && done && done.skill.status === 'success' && out.server.bagCobble >= 16 && out.server.chestCobble + pickCobble === -16 && out.server.stoneDug === 0)
  else if (scene === 'deepslate') out.ok = !!(sw && sw.skill.args.source === 'withdraw' && done && done.skill.status === 'success' && out.server.bagDeepslate >= 16 && out.server.chestDeepslate <= -16 && out.server.stoneDug === 0)
  else out.ok = !!(sw && sw.skill.args.source === 'gather' && sw.skill.args.reason === 'town_short' && out.server.stoneDug > 0 && out.server.chestCobble + pickCobble === 0)
  result(out)
}
async function sceneRetry () {
  buildArena()
  setChest([['stick', 5]])
  // a 1x1 pocket 3 deep in stone beside home, the bot at its bottom, no scaffold in the bag (it cannot tower out)
  const px = C.x + 6, pz = C.z + 6
  rcon(`fill ${px - 2} 112 ${pz - 2} ${px + 2} 123 ${pz + 2} minecraft:stone`, `fill ${px} 117 ${pz} ${px} 118 ${pz} minecraft:air`)
  const f = await startBot('retry', [['stone_pickaxe', 1], ['stone_pickaxe', 1], ['bread', 8]], { x: px + 0.5, y: 117, z: pz + 0.5 })
  queue.push({ skill: 'goto', args: { x: C.x - 6, y: HOME.y, z: C.z - 6 } })
  const row = await waitFor(() => rowsOf(f.skillLog).find(r => r.skill.name === '_goto_dig_retry' || r.skill.name === 'goto_dig_retry'), 180000)
  await sleep(2000)
  await stopBot()
  const a = row?.skill?.args ?? null
  result({ scene: 'retry', row: row ? `${row.skill.status}: ${String(row.skill.detail).slice(0, 120)}` : null, args: a,
    ok: !!(a && typeof a.walk_status === 'string' && Number.isFinite(a.bag_cobble) && Number.isFinite(a.retry_dig_attempts) && a.retry_dig_attempts > 0) })
}

await new Promise(r => brain.listen(BRAIN_PORT, '127.0.0.1', r))
let failed = 0
P_('forceload', rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`).map(x => x.reply).join(' '))
P_(`root=${BOT_ROOT} server=${SERVER} scenes=${SCENES_S}`)
await sleep(3000)
try {
  for (const sc of SCENES_S.split(',')) {
    P_(`SCENE ${sc}`)
    try {
      if (sc === 'surface') await sceneTown('surface', 192)
      else if (sc === 'short') await sceneTown('short', 70)
      else if (sc === 'retry') await sceneRetry()
      else if (sc === 'deepslate') await sceneTown('deepslate', 192, 'cobbled_deepslate')
      else throw new Error(`no scene ${sc}`)
    } catch (e) { failed++; P_('SCENE FAILED', sc, String(e?.stack ?? e).slice(0, 400)); await stopBot('SIGKILL') }
    queue.length = 0
  }
} finally {
  brain.close()
  try { rcon(`fill ${A.x0} 96 ${A.z0} ${A.x1} 103 ${A.z1} minecraft:air`, `fill ${A.x0} 104 ${A.z0} ${A.x1} 135 ${A.z1} minecraft:air`, `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`) } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.stonewithdraw-e2e`) } catch {}
}
const bad = lines(RES).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.run === RUN && !r.ok).length
P_(`DONE: ${failed} scene(s) failed to run, ${bad} result(s) not ok`)
process.exit(failed || bad ? 1 : 0)
