// SANDBOX-ONLY bamboo -> sticks A/B driver (derived from tools-ab.cjs): nothing is queued -- bamboo_sticks is a
// deterministic housekeeping order -- the driver WATCHES for it for WINDOW_MS. Below is tools-ab's header.
// SANDBOX-ONLY spent-tool A/B driver: ONE FRESH BOT PER TRIAL from <botRoot> (unmodified; trace.cjs only observes
// packets -- including every dig with the item the bot held), the scene built by RCON after the bot is there, ONE
// decision queued (gather / goto) through the brain embedded in this process (a trial is two node processes: this
// driver and the bot), then the server's truth: every slot with its durability, and the item entities on the ground.
//
//   node tools-ab.cjs <arm> <botRoot> <reps> <scene,scene,...> [server]
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node tools-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Bamboo'
const OUTDIR = `${R}/sandbox/log/bamboo-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-craftab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- scenes
// The arena: a SMOOTH_STONE floor at y 119 (nothing a gather targets, nothing wear_out calls natural), air above, the
// bot at 700.5 120 700.5. Durability is `damage` = max - uses left: stone tools 131, wooden 59.
const STAND = { x: 700.5, y: 120, z: 700.5 }
const ROCKS = ['andesite', 'diorite', 'granite', 'calcite']
const bag = (used, slots) => ({ slots, fill: used })
const PL = ['oak_planks', 10]
const WINDOW_MS = 150000
const SPEC = {
  A: bag(36, [['bamboo', 64], ['stick', 32], PL]),
  B: bag(36, [['bamboo', 64], ['bamboo', 10], ['stick', 32], PL]),
  C: bag(36, [['bamboo', 64], PL]),
  D: bag(35, [['bamboo', 64], ['bamboo', 64], PL]),
  E: bag(36, [['bamboo', 2], ['stick', 63], PL]),
  // F: scene A, and a feather (PickupDelay 600 ticks, so it stays an entity) summoned beside the bot as the order starts
  F: { ...bag(36, [['bamboo', 64], ['stick', 32], PL]), dropOnStart: '701.0 120.1 700.5' },
  // G: scene A's contents at 33/36 -- below the 34-slot trigger
  G: bag(33, [['bamboo', 64], ['stick', 32], PL]),
  // A20: scene A under the FLEET's stuck limit (STUCK_SECONDS=20; the sandbox env file says 35)
  A20: { ...bag(36, [['bamboo', 64], ['stick', 32], PL]), env: { STUCK_SECONDS: 20 } },
  // ---- sandbox round 2 (10-04, the declared stationary window): every scene under the FLEET's stuck limit
  B20: { ...bag(36, [['bamboo', 64], ['bamboo', 10], ['stick', 32], PL]), env: { STUCK_SECONDS: 20 } },
  C20: { ...bag(36, [['bamboo', 64], PL]), env: { STUCK_SECONDS: 20 } },
  // D20: the 64-craft fold (128 bamboo -> 64 sticks frees 1 slot; window 64 x 1.3 s + 5 s = 88.2 s, inside the 90 s cap)
  D20: { ...bag(35, [['bamboo', 64], ['bamboo', 64], PL]), env: { STUCK_SECONDS: 20 } },
  E20: { ...bag(36, [['bamboo', 2], ['stick', 63], PL]), env: { STUCK_SECONDS: 20 } },
  F20: { ...bag(36, [['bamboo', 64], ['stick', 32], PL]), dropOnStart: '701.0 120.1 700.5', env: { STUCK_SECONDS: 20 } },
  G20: { ...bag(33, [['bamboo', 64], ['stick', 32], PL]), env: { STUCK_SECONDS: 20 } },
  // K20: scene A20 ABORTED mid-fold -- `damage` takes health 20 -> 6 (FLEE_BELOW_HEALTH 8) 10 s after the order starts,
  // so the low_health reflex interrupts the skill (runner.interrupt('low_health')). The bag, the ground and the
  // ground AFTER LOGOUT (what the server returns/drops from the 2x2 grid and cursor) are the oracle.
  K20: { ...bag(36, [['bamboo', 64], ['stick', 32], PL]), damageAfterMs: 10000, env: { STUCK_SECONDS: 20 } },
}
function arenaCmds (spec) {
  const c = ['kill @e[type=!player,x=700,y=120,z=700,distance=..30]',
    'fill 690 120 690 712 130 712 minecraft:air', 'fill 690 119 690 712 119 712 minecraft:smooth_stone']
  // NO OTHER STONE WITHIN GATHER'S REACH (sandbox, first run: gather 5 stone took the floating platform's own stone at
  // the arena edge and the bot fell 51 blocks into the void): every stone block around becomes smooth_stone.
  // the pit: dirt walls two high AND a dirt roof at y 122, so the only way out is a dig (an open top let the ascent
  // profile tower out with the cobblestone instead)
  return c
}
function bagCmds (spec) {
  const c = [`clear ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`]
  let s = 0
  for (const [id, n, dmg] of spec.slots || []) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''} ${n}`)
  while (s < (spec.fill || 0) && s < 36) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${ROCKS[s % ROCKS.length]} 64`)
  return c
}

// ---------------------------------------------------------------- oracle
const parseItem = seg => {
  const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]
  if (!id) return null
  const count = +((seg.match(/count: (\d+)/) || [])[1] || 1)
  const dm = seg.match(/"minecraft:damage": (\d+)/)
  return { id, count, ...(dm ? { damage: +dm[1] } : {}) }
}
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  cmds.push('execute as @e[type=item,x=700,y=120,z=700,distance=..20] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Pos`)
  const r = rcon(...cmds)
  const slots = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) slots[s] = it }
  const ground = (r[36]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  const pos = (((r[37]?.reply || '').match(/\[([^\]]+)\]/) || [])[1] || '').replace(/d/g, '')
  return { slots, used: Object.keys(slots).length, ground, pos }
}
const totals = snap => { const t = {}; for (const it of Object.values(snap.slots)) t[it.id] = (t[it.id] || 0) + it.count; return t }
const toolsOf = snap => Object.entries(snap.slots).filter(([, it]) => /_(axe|shovel|hoe|pickaxe)$/.test(it.id)).map(([s, it]) => `${it.id}@slot${s}:dmg${it.damage ?? 0}`)

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const NOISE = /^(_affordance_scan|_progress_restored)$/
function skillRows (file) {
  return lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill && !NOISE.test(r.skill.name))
    .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, trigger: r.trigger, ms: r.skill.duration_ms, fail: r.skill.fail_class, detail: String(r.skill.detail || '').slice(0, 500) }))
}
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE QUEUE BRAIN, IN THIS PROCESS: each decision gets the next queued line, else 'status'.
let brainQueue = []; let brainLog = null
const parse = line => {
  const [skill, ...rest] = line.split(/\s+/); const args = {}
  if (skill === 'gather' && rest.length === 2) { args.count = +rest[0]; args.block = rest[1] }
  else if (skill === 'goto' && rest.length >= 3) { args.x = +rest[0]; args.y = +rest[1]; args.z = +rest[2] }
  else if (rest.length === 1) args.item = rest[0]
  return { skill, args }
}
const brainServer = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const line = brainQueue.shift() || 'status'
    const { skill, args } = parse(line)
    if (brainLog) fs.appendFileSync(brainLog, `${new Date().toISOString()} decision: ${line}\n`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ skill, args, reason: `sandbox queue: ${line}`, saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})

let bot = null
async function stopBot () {
  try { bot && bot.kill('SIGTERM') } catch {}
  bot = null
  await waitFor(() => /There are 0 of/.test(rcon('list')[0].reply), 30000, 1000)
}

async function runTrial (scene, k) {
  const spec = SPEC[scene]
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const skillLog = `${OUTDIR}/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.tools-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', `./sandbox/log/bamboo-ab/${tag}`); set('STATE_DIR', `./sandbox/state/bamboo-ab-${tag}`); set('MEMORY_POOL', `sbxbamboo-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, Math.floor(STAND[a.toLowerCase()])); set(`BOARD_${a}`, Math.floor(STAND[a.toLowerCase()])) }
  for (const [key, v] of Object.entries(spec.env || {})) set(key, v)
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainQueue = []; brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  // the arena only once the bot is there: setblock/fill into an unloaded chunk fails
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`)
  await sleep(3000)
  const built = rcon(...arenaCmds(spec))
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect/i.test(x.reply))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  rcon(...bagCmds(spec))
  await sleep(2500)
  const before = snapshot()
  const t0 = Date.now()
  // nothing queued: the order is the bot's own. Watch for it to start (its decision line) and to end (its skill line).
  const startPat = /LLM -> bamboo_sticks|bamboo_sticks/
  const started = await waitFor(() => lines(botOut).some(l => startPat.test(l)) ? Date.now() : null, WINDOW_MS)
  let drop = null
  let hurt = null
  if (started && spec.damageAfterMs) {
    await sleep(spec.damageAfterMs)
    const t = Date.now(); const g = rcon(`damage ${NAME} 14 minecraft:generic`, `data get entity ${NAME} Health`)
    hurt = { atMs: t - t0, reply: g.map(x => (x.reply || '').trim()).join(' | ') }
  }
  if (started && spec.dropOnStart) { const t = Date.now(); const g = rcon(`summon minecraft:item ${spec.dropOnStart} {Item:{id:"minecraft:feather",count:1},PickupDelay:600s}`); drop = { atMs: t - t0, reply: (g[0]?.reply || '').trim() } }
  const endPat = /skill bamboo_sticks ->/
  const ended = started ? await waitFor(() => lines(botOut).some(l => endPat.test(l)), 120000) : null
  await sleep(1500)
  const after = snapshot()
  await sleep(6000)
  const later = snapshot()   // 6 s on: does anything an interrupted craft left in the grid or on the cursor come back?
  const rows = skillRows(skillLog)
  await stopBot()
  // and once the bot has logged out: whatever the server returned or dropped from the grid/cursor at logout
  const groundAfterLogout = (rcon('execute as @e[type=item,x=700,y=120,z=700,distance=..20] run data get entity @s Item')[0]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = lines(trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(e => e && e.ts >= t0)
  // each dig START (status 0) with the item held at that moment, and each FINISH (status 2)
  const digs = tr.filter(e => e.pkt === 'dig' && (e.status === 0 || e.status === 2)).map(e => ({ t: e.ts - t0, s: e.status, at: e.loc && `${e.loc.x},${e.loc.y},${e.loc.z}`, held: e.held ? `${e.held.name}:used${e.held.used}` : 'hand' }))
  const watched = rows.filter(r => r.name === 'bamboo_sticks').pop() || null
  const fold = rows.filter(r => r.name === '_bamboo_sticks')
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    started: started ? started - t0 : null, ended: !!ended, watched, fold, drop, hurt,
    decisions: lines(botOut).filter(l => /LLM -> /.test(l)).map(l => l.replace(/^\S+\s+/, '').slice(0, 140)).slice(0, 12),
    before: { used: before.used, totals: totals(before), slots: before.slots, tools: toolsOf(before), ground: before.ground, pos: before.pos },
    after: { used: after.used, totals: totals(after), slots: after.slots, tools: toolsOf(after), ground: after.ground, pos: after.pos },
    later: { used: later.used, totals: totals(later), ground: later.ground }, groundAfterLogout,
    rows, digs, pickups: tr.filter(e => e.pkt === 'collect' && e.self).length, spawns: tr.filter(e => e.pkt === 'spawn_item').length,
    out: lines(botOut).filter(l => /rejected|skill .* ->|equip|tool/i.test(l)).map(l => l.slice(0, 300)).slice(-30) }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const tb = totals(before); const ta = totals(after)
  const delta = Object.keys({ ...tb, ...ta }).map(n => [n, (ta[n] || 0) - (tb[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
  console.log(`${r.id.padEnd(12)} ${String(watched?.status || 'no-order').padEnd(9)} start=${r.started ?? '-'}ms ${watched?.ms ?? '-'}ms slots ${before.used}->${after.used} ground[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] d{${delta}} | ${(fold.pop()?.detail || watched?.detail || '').slice(0, 200)}`)
}

async function main () {
  for (const t = Date.now(); ;) {
    const pl = rcon('list')[0].reply
    if (/There are 0 of/.test(pl)) break
    if (Date.now() - t > 3600000) throw new Error('sandbox not empty')
    console.log('waiting:', pl.trim()); await sleep(20000)
  }
  await new Promise((resolve, reject) => { brainServer.once('error', reject); brainServer.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  console.log(`arm=${ARM} root=${BOT_ROOT} server=${SERVER}`)
  for (let k = 0; k < REPS; k++) for (const scene of SCENES) await runTrial(scene, k)
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { brainServer.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.tools-${ARM}`) } catch {}
  try { rcon('kill @e[type=!player,x=700,y=120,z=700,distance=..30]', 'fill 690 120 690 712 130 712 minecraft:air', 'fill 690 119 690 712 119 712 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
