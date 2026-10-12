// SANDBOX-ONLY freeze probe (hive-d-Alpha drownings 2026-10-08): does the open water cell a bot floats in FREEZE around
// it in a cold biome, and what do the server and the client then say about where the bot is?
//
// Same split as airpocket-ab.cjs: this driver runs on the controller (RCON to 10.0.0.30 + the embedded `status` brain);
// the bot runs on 10.0.0.31 from BOT_ROOT via run-bot.sh with trace.cjs AND posprobe.cjs preloaded (both observe only).
//
//   node freeze-probe.cjs <sandbox|sandbox2|sandbox3> <arm:scene,arm:scene,...> [secs]
//   arms: cand = $CAND_ROOT (default ~/ap-sbx/cand-6187874), ctrl = $CTRL_ROOT (default ~/ap-sbx/ctrl-dbb4d78)
//
// Scenes: T2 (below) and S1 (airpocket-02): a sealed 1x1 cell on the platform -- stone floor 119, ONE water cell
// 700 120 700, ICE at 700 121 700, open sky above (122+ air), stone walls 699..701 x 120..121 round it; the bot put in
// the water cell (a 1-tall gap: the server forces the swimming pose); randomTickSpeed and the biome untouched (river:
// a broken cell does not re-freeze).
//
// Scene T2 (on the harness platform, stone at y 119, open sky above -- precipitation freezing happens only at the top
// MOTION_BLOCKING cell of a column): a 3x3 pool 699..701 x 120..122 x 699..701, 3 deep, surface y 122, in a stone ring
// 698..702; ICE on every surface cell except the bot's (700 122 700); the column's biome set to frozen_river
// (fillbiome 696..703 x 116..127); the bot put into the open cell floating (feet 122 water, head 123 air); THEN
// randomTickSpeed 200. Every second from the server: Pos, Air, Health, deaths, 700 121/122/123 700, the bot's feet and
// head cells. From the client (posprobe.cjs, every 0.5 s): position.y, blockAt(pos), blockAt(pos+1), the eye cell.
// RESTORED after each trial: randomTickSpeed (read before), the biome (read before: must be uniform), the 5x5x6 build
// region to air (verified all air before), the forceload of chunk [43,43] (added only if it was not already there).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [SERVER, PLAN_S, SECS_S] = process.argv.slice(2)
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601 }      // sandbox4 is the model benchmark's
if (!PORTS[SERVER] || !PLAN_S) throw new Error('usage: node freeze-probe.cjs <sandbox|sandbox2|sandbox3> <arm:scene,...> [secs]')
const SECS = Number(SECS_S || 150)
const ROOTS = { cand: process.env.CAND_ROOT || '/home/mike/ap-sbx/cand-6187874', ctrl: process.env.CTRL_ROOT || '/home/mike/ap-sbx/ctrl-dbb4d78' }
const PLAN = PLAN_S.split(',').map(x => { const [arm, scene] = x.split(':'); if (!ROOTS[arm] || !['T2', 'S1'].includes(scene)) throw new Error(`bad plan item ${x}`); return { arm, scene } })
const NAME = process.env.AP_BOT_NAME || 'sandbox-Frz'
const BRAIN_PORT = Number(process.env.AP_BRAIN_PORT || 11551), REMOTE_BRAIN_PORT = BRAIN_PORT + 10   // a second driver needs its own pair
const MAIN = '/home/mike/ap-sbx/main'
const ROUT = `${MAIN}/sandbox/log/freeze-probe`
const LOUT = process.env.AP_LOCAL_OUT || path.resolve(__dirname, '../log/freeze-probe')
fs.mkdirSync(LOUT, { recursive: true })
const PROBE_REMOTE = '/home/mike/ap-sbx/posprobe.cjs'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const OBJ = 'frzdeath7'
const SSH30 = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-fz30-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
const SSH31 = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-fz31-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.31']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH30, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  if (res.length !== cmds.length) throw new Error(`rcon: ${res.length} replies for ${cmds.length} commands`)
  return res
}
const r31 = (cmd, input) => execFileSync('ssh', [...SSH31, cmd], { input, encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 * 1024 })
// MEASURED 10-07: a failed `execute at <player> ... if block` replies EMPTY on this Paper; "not loaded" = unknown
const tri = r => { const t = (r?.reply || '').trim(); return /Test passed/.test(t) ? true : /Test failed/.test(t) ? false : (t === '' && /^execute at /.test(r?.cmd || '')) ? false : null }
const num = r => { const m = (r?.reply || '').match(/data: (-?[\d.]+)/); return m ? +m[1] : null }

const SITE = { x: 700, z: 700, surface: 122 }
const SCENES = {
  T2: { build: ['fill 698 120 698 702 122 702 minecraft:stone', 'fill 699 120 699 701 122 701 minecraft:water',
                'fill 699 122 699 701 122 701 minecraft:ice', 'setblock 700 122 700 minecraft:water'],
        biome: 'frozen_river', rts: 200, tpY: 122.1,
        check: ['execute if block 700 122 700 minecraft:water', 'execute if block 701 122 700 minecraft:ice', 'execute if block 699 122 701 minecraft:ice',
                'execute if block 700 120 700 minecraft:water', 'execute if block 700 123 700 minecraft:air', 'execute if biome 700 122 700 minecraft:frozen_river',
                'execute if block 698 121 700 minecraft:stone'] },
  S1: { build: ['fill 699 120 699 701 121 701 minecraft:stone', 'setblock 700 120 700 minecraft:water', 'setblock 700 121 700 minecraft:ice'],
        biome: null, rts: null, tpY: 120.0,
        check: ['execute if block 700 119 700 minecraft:stone', 'execute if block 700 120 700 minecraft:water', 'execute if block 700 121 700 minecraft:ice',
                'execute if block 700 122 700 minecraft:air', 'execute if block 700 123 700 minecraft:air', 'execute if block 701 120 700 minecraft:stone',
                'execute if block 699 121 700 minecraft:stone', 'execute if block 700 120 701 minecraft:stone', 'execute if block 700 121 699 minecraft:stone'] },
}
const UNBUILD = ['fill 698 120 698 702 125 702 minecraft:air']
const BIOME_BOX = '696 116 696 703 127 703'
const NAMES = ['water', 'ice', 'air', 'stone', 'frosted_ice', 'packed_ice']
const cellCmds = (pre, x, y, z) => NAMES.map(b => `${pre} if block ${x} ${y} ${z} minecraft:${b}`)
function pollCmds () {
  return [`data get entity ${NAME} Air`, `data get entity ${NAME} Health`, `data get entity ${NAME} Pos`, `scoreboard players get ${NAME} ${OBJ}`,
    ...cellCmds('execute', 700, 120, 700), ...cellCmds('execute', 700, 121, 700), ...cellCmds('execute', 700, 122, 700), ...cellCmds('execute', 700, 123, 700),
    ...cellCmds(`execute at ${NAME}`, '~', '~', '~'), ...cellCmds(`execute at ${NAME}`, '~', '~1', '~'), ...cellCmds(`execute at ${NAME}`, '~', '~1.62', '~')]
}
function nameOf (rs) { let n = 'other'; for (let i = 0; i < NAMES.length; i++) { const t = tri(rs[i]); if (t === null) return 'unknown'; if (t) { n = NAMES[i]; break } } return n }
function poll () {
  const r = rcon(...pollCmds())
  const pos = (((r[2]?.reply || '').match(/\[([^\]]+)\]/) || [])[1] || '').replace(/d/g, '').split(',').map(Number)
  const dm = (r[3]?.reply || '').match(/has (\d+) \[/)
  const k = NAMES.length; let i = 4
  const take = () => { const v = nameOf(r.slice(i, i + k)); i += k; return v }
  return { air: num(r[0]), health: num(r[1]), pos: pos.length === 3 ? pos.map(v => +v.toFixed(3)) : null, deaths: dm ? +dm[1] : null,
           c120: take(), c121: take(), c122: take(), c123: take(), feet: take(), head1: take(), eye: take() }
}

// the embedded brain: every decision is `status`
const brainServer = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ skill: 'status', args: {}, reason: 'sandbox: observe only', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }

let bot = null, pidFile = null
async function stopBot () {
  if (pidFile) { try { r31(`p=$(cat ${pidFile} 2>/dev/null) && [ -n "$p" ] && kill "$p" 2>/dev/null; rm -f ${pidFile}; true`) } catch {} }
  pidFile = null
  const b = bot; bot = null
  if (b) { await waitFor(() => b.exitCode !== null || b.signalCode !== null, 20000); try { b.kill('SIGTERM') } catch {} }
  await waitFor(() => /There are 0 of/.test(rcon('list')[0].reply), 30000, 1000)
}
let saved = null   // what to restore
async function restoreWorld () {
  if (!saved) return
  // the chunk may be unloaded once the bot is gone: load it for the restore (measured: a restore without it answered
  // "That position is not loaded" and left the scene and the biome in place)
  const cmds = ['forceload add 697 697 703 703', `gamerule randomTickSpeed ${saved.rts}`, `fillbiome ${BIOME_BOX} minecraft:${saved.biome}`, ...UNBUILD, 'kill @e[type=item,x=700,y=122,z=700,distance=..16]']
  if (saved.addedForceload) cmds.push('forceload remove 697 697 703 703')
  const r = rcon(...cmds)
  console.log('restore:', r.map(x => `${x.cmd} => ${x.reply.trim().slice(0, 70)}`).join(' | '))
  if (r.some(x => /not loaded/.test(x.reply))) console.error('RESTORE INCOMPLETE: a position was not loaded')
}

async function runTrial (arm, scene, k) {
  const SC = SCENES[scene], BOT_ROOT = ROOTS[arm]
  const sha = (r31(`cat ${BOT_ROOT}/.sha 2>/dev/null || echo ?`).trim())
  const tag = `${arm}-${scene}-${k}-${SERVER}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const envRel = `sandbox/.env.fz-${tag}`
  let env = r31(`cat ${MAIN}/sandbox/sandbox-bot-scripted.env`)
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', `./sandbox/log/freeze-probe/${tag}`); set('STATE_DIR', `./sandbox/state/freeze-probe-${tag}`); set('MEMORY_POOL', `sbxfz-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${REMOTE_BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${REMOTE_BRAIN_PORT}`)
  for (const a of ['X', 'Z']) { set(`HOME_${a}`, 700); set(`BOARD_${a}`, 700) }
  set('HOME_Y', 123); set('BOARD_Y', 123)
  r31(`mkdir -p ${ROUT} && cat > ${MAIN}/${envRel}`, env + '\n')
  pidFile = `${ROUT}/${tag}.pid`
  const botOut = `${LOUT}/bot-${tag}.out`
  const bo = fs.openSync(botOut, 'a')
  const cmd = `cd ${MAIN} && echo $$ > ${pidFile} && exec env BOT_ROOT=${BOT_ROOT} NODE_OPTIONS='--require ${MAIN}/sandbox/craft/trace.cjs --require ${PROBE_REMOTE}' ` +
              `CRAFT_TRACE=${ROUT}/trace-${tag}.jsonl POSPROBE_OUT=${ROUT}/probe-${tag}.jsonl bash sandbox/run-bot.sh ${envRel}`
  bot = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ControlPath=none', '-o', 'ExitOnForwardFailure=yes', '-R', `${REMOTE_BRAIN_PORT}:127.0.0.1:${BRAIN_PORT}`, 'mike@10.0.0.31', cmd], { stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => { try { return /spawned pos=/.test(fs.readFileSync(botOut, 'utf8')) } catch { return false } }, 90000, 500)) throw new Error('no spawn')
  const polls = []; let t0 = null, deathT = null, rtsSetAt = null
  try {
    rcon(`gamemode spectator ${NAME}`, `tp ${NAME} 700.5 130 700.5`)
    await sleep(3000)
    const b = rcon(...SC.build, ...(SC.biome ? [`fillbiome ${BIOME_BOX} minecraft:${SC.biome}`] : []))
    const bad = b.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Too many|Could not|Error/i.test(x.reply))
    if (bad.length) throw new Error('scene not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
    const chk = rcon(...SC.check)
    if (chk.some(x => tri(x) !== true)) throw new Error('scene check failed: ' + chk.map(x => x.cmd.split(' ').slice(2).join(' ') + '=>' + x.reply.trim()).join('; '))
    rcon(`scoreboard players set ${NAME} ${OBJ} 0`, `clear ${NAME}`,
      `item replace entity ${NAME} container.0 with minecraft:stone_pickaxe[damage=31] 1`,
      `item replace entity ${NAME} container.1 with minecraft:cobblestone 64`,
      `item replace entity ${NAME} container.2 with minecraft:bucket 1`, `effect clear ${NAME}`, `effect give ${NAME} minecraft:saturation 1 20 true`)
    rcon(`tp ${NAME} 700.5 ${SC.tpY} 700.5`, `gamemode survival ${NAME}`, `effect give ${NAME} minecraft:instant_health 1 5 true`)
    t0 = Date.now()
    while (Date.now() - t0 < SECS * 1000) {
      const ts = Date.now()
      if (SC.rts && rtsSetAt == null && ts - t0 >= 5000) { rcon(`gamerule randomTickSpeed ${SC.rts}`); rtsSetAt = +((ts - t0) / 1000).toFixed(1) }
      try { const p = poll(); p.t = +((ts - t0) / 1000).toFixed(1); polls.push(p); if (deathT == null && ((p.deaths ?? 0) > 0 || p.health === 0)) deathT = p.t }
      catch (e) { polls.push({ t: +((ts - t0) / 1000).toFixed(1), err: String(e.message).slice(0, 100) }) }
      if (deathT != null && (Date.now() - t0) / 1000 > deathT + 4) break
      await sleep(Math.max(0, 1000 - (Date.now() - ts)))
    }
  } finally {
    try { rcon(`gamerule randomTickSpeed ${saved.rts}`) } catch {}
  }
  await stopBot()
  try { r31(`rm -f ${MAIN}/${envRel}`) } catch {}
  const rel = ts => +((ts - t0) / 1000).toFixed(1)
  const probe = r31(`cat ${ROUT}/probe-${tag}.jsonl 2>/dev/null || true`).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(e => e && e.ts >= t0 - 1000).map(e => ({ ...e, t: rel(e.ts) }))
  const skill = r31(`cat ${ROUT}/${tag}/skill-${NAME}.jsonl 2>/dev/null || true`).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(r => r && r.skill && Date.parse(r['@timestamp']) >= t0 - 1000)
    .map(r => ({ t: rel(Date.parse(r['@timestamp'])), name: r.skill.name, detail: String(r.skill.detail || '').slice(0, 400), pos: r.bot?.pos ?? null }))
  const trace = r31(`cat ${ROUT}/trace-${tag}.jsonl 2>/dev/null || true`).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(e => e && e.ts >= t0 - 1000)
  const digs = trace.filter(e => e.pkt === 'dig' && e.loc).map(e => ({ t: rel(e.ts), status: e.status, loc: `${e.loc.x},${e.loc.y},${e.loc.z}`, held: e.held?.name ?? null }))
  const places = trace.filter(e => e.pkt === 'block_place').map(e => ({ t: rel(e.ts), loc: e.loc, feet: e.feet }))
  const firstIce = polls.find(p => p.c122 === 'ice')
  const res = { id: `${arm}:${scene}:${k}`, arm, scene, k, sha, tag, server: SERVER, root: BOT_ROOT, t0: new Date(t0).toISOString(), secs: SECS, rtsSetAt, freezeT: firstIce?.t ?? null, deathT,
    alive: deathT == null, polls, probe, rows: skill.filter(r => !/^_(water_float|water_float_ended)$/.test(r.name) || true), digs, places }
  fs.appendFileSync(`${LOUT}/results-${SERVER}.jsonl`, JSON.stringify(res) + '\n')
  try { r31(`cat >> ${ROUT}/results-${SERVER}.jsonl`, JSON.stringify(res) + '\n'); r31(`cat > ${ROUT}/bot-${tag}.out`, fs.readFileSync(botOut, 'utf8')) } catch {}
  console.log(`${tag} sha=${sha} freeze@${res.freezeT} death@${deathT} alive=${res.alive} rows=${skill.length} probe=${probe.length} polls=${polls.length}`)
}

async function main () {
  const lock = r31('cat /tmp/mcai-sandbox.lock/* 2>/dev/null || echo NOLOCK')
  if (!/freeze|airpocket-02/.test(lock)) throw new Error('the sandbox lock is not held for the freeze probe')
  if (!/There are 0 of/.test(rcon('list')[0].reply)) throw new Error('sandbox not empty')
  const fl = rcon('forceload query 700 700')[0].reply
  const addFl = !/is marked/.test(fl)
  if (addFl) rcon('forceload add 697 697 703 703')
  await sleep(2000)
  const pre = rcon('gamerule randomTickSpeed', 'execute if biome 696 116 696 minecraft:river', 'execute if biome 703 127 703 minecraft:river',
    'execute if blocks 698 120 698 702 125 702 698 200 698 all')
  const rts = +((pre[0].reply.match(/set to: (\d+)/) || [])[1])
  if (!(rts >= 0) || tri(pre[1]) !== true || tri(pre[2]) !== true || !/Test passed/.test(pre[3].reply)) { if (addFl) rcon('forceload remove 697 697 703 703'); throw new Error('pre-state not as surveyed: ' + pre.map(x => x.reply.trim()).join(' | ')) }
  saved = { rts, biome: 'river', addedForceload: addFl }
  console.log('saved', JSON.stringify(saved), 'forceload before:', fl.trim())
  const made = rcon(`scoreboard objectives add ${OBJ} deathCount`)[0].reply
  if (!/Created new objective/.test(made)) throw new Error('objective: ' + made)
  await new Promise((resolve, reject) => { brainServer.once('error', reject); brainServer.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  const seen = {}
  for (const { arm, scene } of PLAN) {
    const k = seen[`${arm}:${scene}`] = (seen[`${arm}:${scene}`] ?? -1) + 1
    try { await runTrial(arm, scene, k) } catch (e) { console.error(`trial ${arm}:${scene}:${k} failed: ${e.message}`); await stopBot().catch(() => {}) }
    await restoreWorld()
  }
}
let cleaning = false
const finish = code => {
  if (cleaning) return; cleaning = true
  ;(async () => {
    await stopBot().catch(() => {})
    try { brainServer.close() } catch {}
    try { await restoreWorld() } catch (e) { console.error('restore failed', e.message) }
    try { rcon(`scoreboard objectives remove ${OBJ}`) } catch {}
    try { console.log('after:', rcon('gamerule randomTickSpeed', 'execute if biome 700 122 700 minecraft:river', 'forceload query 700 700', 'list').map(x => x.reply.trim()).join(' | ')) } catch {}
  })().then(() => process.exit(code))
}
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
