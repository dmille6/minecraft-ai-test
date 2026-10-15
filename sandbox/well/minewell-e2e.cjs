// SANDBOX-ONLY replay of the hive-d sequence (10-14 21:32Z) for minewell-01: a bot on a junk well's stand runs `mine`.
// The REAL bot (src/index.mjs from <botRoot>, unmodified) is ordered `mine` by the loopback brain while it stands on the
// well's stand, facing the well; the shaft holds junk lying on the floor trapdoor (pickup delay 0). After the skill ends
// the server is asked, read-only: how many shell cells are air now, how many items are still in the shaft, what the
// bot's bag gained, and the bot's own rows (_well_recollected, _mine_well_guard, the mine result).
//
//   node sandbox/well/minewell-e2e.cjs <botRoot> <label> [server]
//
// Run it twice: the base (the positive control: the stair digs the shell and the bot collects the shaft's items) and the
// candidate. RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. Refuses a non-sandbox
// server and refuses to run unless the sandbox lock on 10.0.0.31 names `minewell`.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, LABEL, SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL) throw new Error('usage: node minewell-e2e.cjs <botRoot> <label> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const R = process.env.WELL_REPO || path.resolve(__dirname, '../..')
const NAME = 'sandbox-Mwell'
const OUT = process.env.WELL_OUT || `${R}/sandbox/log/minewell-e2e`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-mwell-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')

// ---- the arena (well-e2e's dirt slab at y 113..119) and the well: cap 1300,119,1315 facing east, 15 from home ------------
const HOME = { x: 1315, y: 120, z: 1315 }
const A = { x0: 1297, x1: 1333, z0: 1297, z1: 1333 }
const G = 119
const CAP = { x: 1300, y: G, z: 1315 }, STAND = { x: 1301, y: G + 1, z: 1315 }
const ARENA_SEL = `@e[type=item,x=${A.x0},y=105,z=${A.z0},dx=${A.x1 - A.x0},dy=30,dz=${A.z1 - A.z0}]`
const SHAFT_SEL = `@e[type=item,x=${CAP.x},y=${CAP.y - 2},z=${CAP.z},dx=0,dy=1.4,dz=0]`
const JUNK = [['flint', 24], ['blue_egg', 9], ['ink_sac', 1], ['clay_ball', 16], ['glass', 9], ['brown_egg', 5]]
function buildArena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=100,z=${A.z0},dx=${A.x1 - A.x0},dy=40,dz=${A.z1 - A.z0}]`,
    `fill ${A.x0} 112 ${A.z0} ${A.x1} 123 ${A.z1} minecraft:air`, `fill ${A.x0} 124 ${A.z0} ${A.x1} 135 ${A.z1} minecraft:air`,
    `fill ${A.x0} 113 ${A.z0} ${A.x1} ${G} ${A.z1} minecraft:dirt`,
    `setblock ${CAP.x} ${CAP.y - 1} ${CAP.z} minecraft:oak_trapdoor[half=bottom,facing=east,open=false]`,
    `setblock ${CAP.x} ${CAP.y} ${CAP.z} minecraft:oak_trapdoor[half=top,facing=east,open=false]`]
  const r = rcon(...c)
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
// the SHELL (well.mjs wellBreakCost's box): +-2 around the column, cap.y - 3 .. cap, the cap and shaft cells excluded
const SHELL = []
for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = CAP.y - 3; y <= CAP.y; y++) {
  if (dx === 0 && dz === 0 && y >= CAP.y - 1) continue
  SHELL.push({ x: CAP.x + dx, y, z: CAP.z + dz })
}
const shellAir = () => rcon(...SHELL.map(c => `execute if block ${c.x} ${c.y} ${c.z} minecraft:air`)).filter(x => passed(x.reply)).map(x => x.cmd.split(' ').slice(3, 6).join(','))
function census () {
  const r = rcon('scoreboard objectives add mw dummy',
    `execute as ${ARENA_SEL} store result score @s mw run data get entity @s Item.count`,
    'scoreboard players set #in mw 0', `scoreboard players operation #in mw += ${SHAFT_SEL} mw`, 'scoreboard players get #in mw')
  const m = /has (-?\d+) \[/.exec(r[4]?.reply || '')
  return m ? Number(m[1]) : null
}
const parseItem = seg => { const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]; return id ? { id, count: +((seg.match(/count: (\d+)/) || [])[1] || 1) } : null }
function bag () {
  const cmds = []; for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  const r = rcon(...cmds); const totals = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) totals[it.id] = (totals[it.id] || 0) + it.count }
  return totals
}

// ---- the bot -----------------------------------------------------------------------------------------------------------
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '') }))
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }
let ORDER = null
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const decision = ORDER ?? { skill: 'status', args: {} }
    ORDER = null
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
let bot = null
async function stopBot () { try { bot && bot.kill('SIGTERM') } catch {} bot = null; await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000) }
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
async function startBot () {
  const tag = `${RUN}-${LABEL}`
  const logRel = `./sandbox/log/minewell-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/minewell-e2e/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`
  const envRel = 'sandbox/.env.minewell-e2e'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/minewell-e2e-${tag}`); set('MEMORY_POOL', `sbxmwell-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 60)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${STAND.x + 0.5} ${STAND.y} ${STAND.z + 0.5} 90 0`)
  await sleep(4000)
  rcon(`item replace entity ${NAME} container.0 with minecraft:stone_pickaxe 1`, `item replace entity ${NAME} container.1 with minecraft:stone_pickaxe 1`,
       `item replace entity ${NAME} container.2 with minecraft:cobblestone 64`, `item replace entity ${NAME} container.3 with minecraft:cobblestone 64`,
       `item replace entity ${NAME} container.4 with minecraft:bread 16`)
  return { skillLog, botOut }
}

async function scene () {
  buildArena()
  const files = await startBot()
  // the junk in the shaft (lying on the floor trapdoor, pickup delay 0: a body in reach takes it)
  rcon(...JUNK.map(([id, n]) => `summon item ${CAP.x + 0.5} ${CAP.y - 0.6} ${CAP.z + 0.5} {Item:{id:"minecraft:${id}",count:${n}},PickupDelay:0}`))
  await sleep(25000)   // index.mjs refreshes the known well columns every 20 s
  const before = { shellAir: shellAir(), inShaft: census(), bag: bag() }
  rcon(`tp ${NAME} ${STAND.x + 0.5} ${STAND.y} ${STAND.z + 0.5} 90 0`)   // on the stand, facing the well (west), as hive-d-Echo
  await sleep(2000)
  ORDER = { skill: 'mine', args: { y: 114 } }
  const ended = await waitFor(() => lines(files.botOut).find(l => /skill mine ->/.test(l)), 180000, 500)
  await sleep(3000)
  const rows = rowsOf(files.skillLog)
  const after = { shellAir: shellAir(), inShaft: census(), bag: bag() }
  const gained = Object.fromEntries(Object.entries(after.bag).map(([k, v]) => [k, v - (before.bag[k] || 0)]).filter(([k, d]) => d > 0 && JUNK.some(j => j[0] === k)))
  const mineRow = rows.filter(r => r.name === 'mine').pop()
  const pos = r1(`data get entity ${NAME} Pos`)
  await stopBot()
  const res = {
    label: LABEL, root: BOT_ROOT, sha: (() => { try { return execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '?' } })(),
    mine: mineRow ? `${mineRow.status} ${mineRow.detail.slice(0, 160)}` : (ended ? ended.slice(0, 160) : 'no mine row'),
    shellDug: after.shellAir.filter(c => !before.shellAir.includes(c)), shellAirBefore: before.shellAir.length,
    shaftItems: { before: before.inShaft, after: after.inShaft }, junkGained: gained,
    recollectedRows: rows.filter(r => r.name === '_well_recollected').length,
    guardRows: rows.filter(r => r.name === '_mine_well_guard').map(r => r.detail.slice(0, 120)), endPos: pos.slice(0, 120),
  }
  fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), ...res }) + '\n'); P('RESULT', res)
}

async function main () {
  const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
  if (!/minewell/.test(lock)) throw new Error('the sandbox lock is not held for minewell: ' + lock.trim().slice(0, 160))
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(11499, '127.0.0.1', resolve) })
  P(`root=${BOT_ROOT} label=${LABEL} server=${SERVER}`)
  rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`)
  await scene()
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { brain.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.minewell-e2e`) } catch {}
  try {
    P('cleanup', rcon(`kill ${ARENA_SEL}`, 'scoreboard objectives remove mw',
      `fill ${A.x0} 112 ${A.z0} ${A.x1} 123 ${A.z1} minecraft:air`, `fill ${A.x0} 124 ${A.z0} ${A.x1} 135 ${A.z1} minecraft:air`,
      `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, 'list').map(x => `${x.cmd.slice(0, 40)} => ${x.reply.slice(0, 80)}`))
  } catch (e) { P('cleanup failed', e.message) }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { P('FATAL', e.stack || e.message); finish(1) })
process.on('SIGINT', () => finish(1)); process.on('SIGTERM', () => finish(1))
