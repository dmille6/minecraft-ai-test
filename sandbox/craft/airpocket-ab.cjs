// SANDBOX-ONLY airpocket A/B driver (underground-safety phase 2; docs/reports/airpocket-design-2026-10-07.md).
//
// SPLIT HOSTS, because the fleet host (10.0.0.31) has no key to the worlds host (10.0.0.30):
//   - THIS driver runs on the controller (the Mac): it answers the bot's model calls (embedded brain: every decision is
//     `status`, nothing is queued -- the reflexes are the unit under test) and talks RCON to 10.0.0.30 over ssh
//     (/tmp/sbx-rcon.py there: sandbox names only, it reads the password itself);
//   - the BOT runs on 10.0.0.31 from an unmodified tree (BOT_ROOT) through ~/ap-sbx/main/sandbox/run-bot.sh, with
//     trace.cjs preloaded (observes packets only), its model endpoint a reverse tunnel (ssh -R) to this brain, so the
//     run-bot.sh loopback check still holds. Bot logs, trace, bot stdout and the results lines stay on 10.0.0.31 under
//     ~/ap-sbx/main/sandbox/log/airpocket-ab/ (a local copy of the results goes to AP_LOCAL_OUT).
//
//   node airpocket-ab.cjs <server> <arm:scene,arm:scene,...>       e.g. sandbox cand:A,ctrl:A,ctrl:A,cand:A
//   env: CAND_ROOT (default ~/ap-sbx/cand-950e89c), CTRL_ROOT (default ~/ap-sbx/ctrl), AP_BOT_NAME, AP_BRAIN_PORT,
//        AP_LOCAL_OUT. Refuses to run unless /tmp/mcai-sandbox.lock on 10.0.0.31 exists and names `airpocket`.
//
// Each trial: ONE FRESH BOT; parked in spectator above the arena while the arena is built by RCON (the chunk must be
// loaded); the arena verified cell by cell (a positive control: every expected block read back, "not loaded" = abort);
// the kit (stone_pickaxe damage 31 = ~100 uses, 64 cobblestone, an empty bucket); then teleported into the scene fully
// submerged with full air, survival, and LEFT ALONE. Every ~1 s the WORLD is read: Air, Health, Pos, a deathCount
// scoreboard (server-side deaths), the eye cell (air/water), the roof cell 700 42 700 and its neighbours. The bot's
// own rows (_air_pocket*, _drowning_*, _flooded_pocket*, _death, ...) and every dig the trace saw are recorded beside it.
//
// Scenes (feet cell 700 40 700, head 41, roof 42; solid stone 692..708 x 30..52 x 692..708 around it):
//   A  hive-c: a 1x1 water column 700 31..41 700 over the arena floor (30) (no floor within reach), stone roof at 42 and stone above
//   B  A with the roof exactly 3 thick (42..44 stone) and a 5x5x3 air room at 45..47 above it
//   C  A + a water source BESIDE the roof cell (701 42 700): must refuse
//   D  A + lava above the roof cell (700 43 700): must refuse
//   E  A + sand above the roof cell (700 43 700): must refuse
//   F  hive-d ice: water 700 40..41 700 on a stone floor (39), ICE at 700 42 700, a 3x3x3 air room at 43..45
//   G  open water: A with AIR at 700 42 700 (the head can reach air by swimming): must not dig
//   H  A on difficulty EASY (restored to peaceful right after the window): must refuse (envelope 2.0)
//   I  head cell solid: water 700 31..40 700, STONE at the head cell 700 41 700
//   AF A-floor: the bot STANDING on stone (39) in a 1x1x2 water pocket, feet 40, head 41, stone roof 42
//   J  A for 300 s (the full stack: after the pocket, does it sink back / re-seize / re-drown?)
// KITS (env AP_KIT; toolhygiene x airpocket, 10-08): default = one stone_pickaxe ~100 uses (as before);
//   worn1 = a 1-use stone_pickaxe (damage 130 of 131) in slot 0 AHEAD of a ~100-use one in slot 1 -- the step must take the
//   healthy copy with TOOL_HYGIENE on (the fix) and took slot 0 before it (control). iron1stone = a 1-use IRON copy (faster)
//   ahead of a ~100-use stone one (the stone must dig); iron1 = the 1-use iron copy alone (its real last use must dig). The server's Inventory is read at the
//   end of every trial (invEnd) so which copy wore is a world fact, not the bot's word.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')

const [SERVER, PLAN_S] = process.argv.slice(2)
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601 }        // sandbox4 is the model benchmark's: never
if (!PORTS[SERVER] || !PLAN_S) throw new Error('usage: node airpocket-ab.cjs <sandbox|sandbox2|sandbox3> <arm:scene,...>')
const ROOTS = { cand: process.env.CAND_ROOT || '/home/mike/ap-sbx/cand-950e89c', ctrl: process.env.CTRL_ROOT || '/home/mike/ap-sbx/ctrl' }
const SHAS = { '/home/mike/ap-sbx/cand-950e89c': '950e89c', '/home/mike/ap-sbx/cand': 'c783e79', '/home/mike/ap-sbx/ctrl': 'c6e91a8' }
const PLAN = PLAN_S.split(',').map(s => { const [arm, scene] = s.split(':'); if (!ROOTS[arm]) throw new Error(`arm ${arm}`); return { arm, scene } })
const NAME = process.env.AP_BOT_NAME || `sandbox-AirP${SERVER.replace(/\D/g, '') || '1'}`
if (!/^sandbox-/.test(NAME)) throw new Error('bot name must start with sandbox-')
const BRAIN_PORT = Number(process.env.AP_BRAIN_PORT || (11530 + (Number(SERVER.replace(/\D/g, '')) || 1)))
const REMOTE_BRAIN_PORT = BRAIN_PORT + 10
const MAIN = '/home/mike/ap-sbx/main'
const ROUT = `${MAIN}/sandbox/log/airpocket-ab`
const LOUT = process.env.AP_LOCAL_OUT || path.resolve(__dirname, '../log/airpocket-ab')
fs.mkdirSync(LOUT, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const OBJ = 'apdeath7'                                                    // the trial's deathCount objective (removed at the end)

const SSH30 = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ap30-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
const SSH31 = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ap31-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.31']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH30, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  if (res.length !== cmds.length) throw new Error(`rcon: ${res.length} replies for ${cmds.length} commands`)
  return res
}
const r31 = (cmd, input) => execFileSync('ssh', [...SSH31, cmd], { input, encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 * 1024 })

// ---------------------------------------------------------------- scenes
const STAND = { x: 700.5, y: 40, z: 700.5 }
const COL = 'fill 700 31 700 700 41 700 minecraft:water'
const SPEC = {
  A: { setup: [COL], expect: [[700, 31, 700, 'water'], [700, 41, 700, 'water'], [700, 42, 700, 'stone'], [700, 43, 700, 'stone'], [701, 42, 700, 'stone'], [700, 30, 700, 'stone']], secs: 150 },
  B: { setup: [COL, 'fill 698 45 698 702 47 702 minecraft:air'], expect: [[700, 41, 700, 'water'], [700, 42, 700, 'stone'], [700, 44, 700, 'stone'], [700, 45, 700, 'air']], secs: 150 },
  C: { setup: [COL, 'setblock 701 42 700 minecraft:water'], expect: [[700, 41, 700, 'water'], [700, 42, 700, 'stone'], [701, 42, 700, 'water']], secs: 150 },
  D: { setup: [COL, 'setblock 700 43 700 minecraft:lava'], expect: [[700, 41, 700, 'water'], [700, 42, 700, 'stone'], [700, 43, 700, 'lava']], secs: 150 },
  E: { setup: [COL, 'setblock 700 43 700 minecraft:sand'], expect: [[700, 41, 700, 'water'], [700, 42, 700, 'stone'], [700, 43, 700, 'sand']], secs: 150 },
  F: { setup: ['fill 700 40 700 700 41 700 minecraft:water', 'setblock 700 42 700 minecraft:ice', 'fill 699 43 699 701 45 701 minecraft:air'],
       expect: [[700, 39, 700, 'stone'], [700, 40, 700, 'water'], [700, 41, 700, 'water'], [700, 42, 700, 'ice'], [700, 43, 700, 'air']], secs: 150 },
  G: { setup: [COL, 'setblock 700 42 700 minecraft:air'], expect: [[700, 41, 700, 'water'], [700, 42, 700, 'air'], [700, 43, 700, 'stone']], secs: 150 },
  H: { setup: [COL], expect: [[700, 41, 700, 'water'], [700, 42, 700, 'stone']], secs: 150, difficulty: 'easy' },
  I: { setup: ['fill 700 31 700 700 40 700 minecraft:water'], expect: [[700, 40, 700, 'water'], [700, 41, 700, 'stone'], [700, 42, 700, 'stone']], secs: 150 },
  // AF (A-floor): the bot STANDING on a stone floor in a 1x1x2 water pocket (feet 40, head 41, stone 39 and roof 42)
  AF: { setup: ['fill 700 40 700 700 41 700 minecraft:water'], expect: [[700, 39, 700, 'stone'], [700, 40, 700, 'water'], [700, 41, 700, 'water'], [700, 42, 700, 'stone'], [700, 43, 700, 'stone']], secs: 150 },
  J: { setup: [COL], expect: [[700, 31, 700, 'water'], [700, 41, 700, 'water'], [700, 42, 700, 'stone'], [700, 43, 700, 'stone']], secs: 300 },
}
const CLEAR_ITEMS = 'kill @e[type=item,x=700,y=40,z=700,distance=..24]'
function arenaCmds (spec) { return [CLEAR_ITEMS, 'fill 692 30 692 708 52 708 minecraft:stone', ...spec.setup] }
const KIT = process.env.AP_KIT || 'default'
if (!['default', 'worn1', 'iron1stone', 'iron1'].includes(KIT)) throw new Error(`AP_KIT ${KIT}`)
function kitCmds () {
  if (KIT === 'iron1stone' || KIT === 'iron1') {   // a 1-use IRON pickaxe (faster) in slot 0, ahead of a ~100-use stone one / alone
    const two = KIT === 'iron1stone'
    return [`clear ${NAME}`,
      `item replace entity ${NAME} container.0 with minecraft:iron_pickaxe[damage=249] 1`,
      ...(two ? [`item replace entity ${NAME} container.1 with minecraft:stone_pickaxe[damage=31] 1`] : []),
      `item replace entity ${NAME} container.2 with minecraft:cobblestone 64`,
      `item replace entity ${NAME} container.3 with minecraft:bucket 1`,
      `effect clear ${NAME}`, `effect give ${NAME} minecraft:saturation 1 20 true`]
  }
  if (KIT === 'worn1') {
    return [`clear ${NAME}`,
      `item replace entity ${NAME} container.0 with minecraft:stone_pickaxe[damage=130] 1`,
      `item replace entity ${NAME} container.1 with minecraft:stone_pickaxe[damage=31] 1`,
      `item replace entity ${NAME} container.2 with minecraft:cobblestone 64`,
      `item replace entity ${NAME} container.3 with minecraft:bucket 1`,
      `effect clear ${NAME}`, `effect give ${NAME} minecraft:saturation 1 20 true`]
  }
  return [`clear ${NAME}`,
    `item replace entity ${NAME} container.0 with minecraft:stone_pickaxe[damage=31] 1`,
    `item replace entity ${NAME} container.1 with minecraft:cobblestone 64`,
    `item replace entity ${NAME} container.2 with minecraft:bucket 1`,
    `effect clear ${NAME}`, `effect give ${NAME} minecraft:saturation 1 20 true`]
}

// ---------------------------------------------------------------- the world oracle
// `execute if block` answers THREE things: passed, failed, or "not loaded" (unknown, never "not the block").
// MEASURED 10-07: Paper answers a FAILED `execute at <player> ... if block` with an EMPTY reply (not "Test failed"), so an
// empty reply to an `execute at` form is false; "not loaded" (or anything else) stays unknown.
const tri = r => { const t = (r?.reply || '').trim(); return /Test passed/.test(t) ? true : /Test failed/.test(t) ? false : (t === '' && /^execute at /.test(r?.cmd || '')) ? false : null }
const num = r => { const m = (r?.reply || '').match(/data: (-?[\d.]+)/); return m ? +m[1] : null }
const CELLS = {   // cell -> candidate blocks, first that passes names it; any null reply = 'unknown'
  roof: [[700, 42, 700], ['air', 'water', 'stone', 'ice', 'cave_air']],
  above: [[700, 43, 700], ['air', 'stone', 'lava', 'sand', 'water']],
  side: [[701, 42, 700], ['stone', 'water', 'air']],
  head: [[700, 41, 700], ['water', 'air', 'stone', 'cobblestone']],
  feet: [[700, 40, 700], ['water', 'air', 'stone', 'cobblestone']],   // a block placed under a standing bot (cand 9ad287a)
}
function pollCmds () {
  const c = [`data get entity ${NAME} Air`, `data get entity ${NAME} Health`, `data get entity ${NAME} Pos`, `scoreboard players get ${NAME} ${OBJ}`,
    `execute at ${NAME} anchored eyes positioned ^ ^ ^ if block ~ ~ ~ minecraft:air`,
    `execute at ${NAME} anchored eyes positioned ^ ^ ^ if block ~ ~ ~ minecraft:water`]
  for (const [, [[x, y, z], names]] of Object.entries(CELLS)) for (const b of names) c.push(`execute if block ${x} ${y} ${z} minecraft:${b}`)
  return c
}
function poll () {
  const r = rcon(...pollCmds())
  const pos = (((r[2]?.reply || '').match(/\[([^\]]+)\]/) || [])[1] || '').replace(/d/g, '').split(',').map(Number)
  const dm = (r[3]?.reply || '').match(/has (\d+) \[/)
  const o = { air: num(r[0]), health: num(r[1]), pos: pos.length === 3 ? pos.map(v => +v.toFixed(2)) : null, deaths: dm ? +dm[1] : null,
              eyeAir: tri(r[4]), eyeWater: tri(r[5]) }
  if (o.eyeAir === null) o.eyeAirRaw = String(r[4]?.reply || '').slice(0, 80)
  let i = 6
  for (const [k, [, names]] of Object.entries(CELLS)) {
    let name = 'other'
    for (const b of names) { const t = tri(r[i++]); if (t === null) name = 'unknown'; else if (t && name === 'other') name = b }
    o[k] = name
  }
  return o
}
function verifyArena (spec) {
  const r = rcon(...spec.expect.map(([x, y, z, b]) => `execute if block ${x} ${y} ${z} minecraft:${b}`))
  const bad = r.map((x, i) => [x, spec.expect[i]]).filter(([x]) => tri(x) !== true)
  if (bad.length) throw new Error('arena check failed: ' + bad.map(([x, e]) => `${e.join(' ')} => ${x.reply}`).join('; '))
}

// ---------------------------------------------------------------- bot rows
const WATERY = /^_(drowning|air_drowning|flooded_pocket|water_no_air|oxygen_critical|reflex_drowning|sealed_in_liquid|water_float)/
const KEEP = /^_(air_pocket|death|entombed|marooned|maroon_|pocket|hold_lava|climb_flood_)/
function skillRows (text) {
  return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
    .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '').slice(0, 600),
                 pos: r.bot?.pos ?? null, health: r.bot?.health ?? null }))
}
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await pred(); if (v) return v; await sleep(step) } return null }

// ---------------------------------------------------------------- the brain (loopback here, tunnelled to the bot)
let brainLog = null
const brainServer = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('ap brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    if (brainLog) fs.appendFileSync(brainLog, `${new Date().toISOString()} decision: status\n`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ skill: 'status', args: {}, reason: 'sandbox: observe only', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})

// ---------------------------------------------------------------- the bot (on 10.0.0.31)
let bot = null; let botPidFile = null
async function stopBot () {
  if (botPidFile) { try { r31(`p=$(cat ${botPidFile} 2>/dev/null) && [ -n "$p" ] && kill "$p" 2>/dev/null; rm -f ${botPidFile}; true`) } catch {} }
  botPidFile = null
  const b = bot; bot = null
  if (b) { await waitFor(() => b.exitCode !== null || b.signalCode !== null, 20000, 250); try { b.kill('SIGTERM') } catch {} }
  await waitFor(() => /There are 0 of/.test(rcon('list')[0].reply), 30000, 1000)
}
let baseEnv = null
let initialDifficulty = null
async function startBot (tag, root) {
  const envRel = `sandbox/.env.ap-${tag}`
  let env = baseEnv
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', `./sandbox/log/airpocket-ab/${tag}`); set('STATE_DIR', `./sandbox/state/airpocket-ab-${tag}`); set('MEMORY_POOL', `sbxap-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50)
  if (process.env.AP_TOOL_HYGIENE) set('TOOL_HYGIENE', process.env.AP_TOOL_HYGIENE)   // on|off (unset = the build's default, on)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${REMOTE_BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${REMOTE_BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, Math.floor(STAND[a.toLowerCase()])); set(`BOARD_${a}`, Math.floor(STAND[a.toLowerCase()])) }
  r31(`mkdir -p ${ROUT} && cat > ${MAIN}/${envRel}`, env + '\n')
  botPidFile = `${ROUT}/${tag}.pid`
  const botOut = `${LOUT}/bot-${tag}.out`
  const bo = fs.openSync(botOut, 'a')
  const cmd = `cd ${MAIN} && echo $$ > ${botPidFile} && exec env BOT_ROOT=${root} NODE_OPTIONS='--require ${MAIN}/sandbox/craft/trace.cjs --require /home/mike/ap-sbx/posprobe.cjs' ` +
              `CRAFT_TRACE=${ROUT}/trace-${tag}.jsonl POSPROBE_OUT=${ROUT}/probe-${tag}.jsonl bash sandbox/run-bot.sh ${envRel}`
  bot = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ControlPath=none', '-o', 'ExitOnForwardFailure=yes', '-R', `${REMOTE_BRAIN_PORT}:127.0.0.1:${BRAIN_PORT}`, 'mike@10.0.0.31', cmd],
    { stdio: ['ignore', bo, bo] })
  const ok = await waitFor(() => { try { return /spawned pos=/.test(fs.readFileSync(botOut, 'utf8')) } catch { return false } }, 90000, 500)
  return { ok, envRel, botOut }
}

// ---------------------------------------------------------------- one trial
const RESULTS_REMOTE = `${ROUT}/results-${SERVER}.jsonl`
const RESULTS_LOCAL = `${LOUT}/results-${SERVER}.jsonl`
async function runTrial (arm, scene, k) {
  const spec = SPEC[scene]
  if (!spec) throw new Error(`unknown scene ${scene}`)
  // the candidate tree may be swapped BETWEEN trials: a one-line file ${LOUT}/cand-root names it (never mid-trial)
  let root = ROOTS[arm]
  if (arm === 'cand') { try { const f = fs.readFileSync(`${LOUT}/cand-root`, 'utf8').trim(); if (/^\/home\/mike\/ap-sbx\/cand[-\w]*$/.test(f)) root = f } catch {} }
  const tag = `${arm}-${scene}-${k}-${SERVER}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  brainLog = `${LOUT}/brain-${tag}.log`
  const identity = r31(`cd ${root}/bots/src && md5sum reflex.mjs && (test -f airpocket.mjs && echo airpocket=yes || echo airpocket=no)`).trim().replace(/\s+/g, ' ')
  const { ok, envRel, botOut } = await startBot(tag, root)
  if (!ok) { await stopBot(); throw new Error('no spawn') }
  let difficultyBefore = null, difficultyDuring = null
  const polls = []; let t0 = null; let deathT = null; let airAt0 = null
  try {
    rcon(`gamemode spectator ${NAME}`, `tp ${NAME} ${STAND.x} 60 ${STAND.z}`)
    await sleep(3000)
    const built = rcon(...arenaCmds(spec))
    const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Too many|Could not/i.test(x.reply))
    if (bad.length) throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
    verifyArena(spec)
    difficultyBefore = (rcon('difficulty')[0].reply.match(/is (\w+)/) || [])[1]?.toLowerCase() ?? null
    if (spec.difficulty) rcon(`difficulty ${spec.difficulty}`)
    difficultyDuring = (rcon('difficulty')[0].reply.match(/is (\w+)/) || [])[1]?.toLowerCase() ?? null
    rcon(`scoreboard players set ${NAME} ${OBJ} 0`, ...kitCmds())
    rcon(`tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`, `gamemode survival ${NAME}`, `effect give ${NAME} minecraft:instant_health 1 5 true`)
    t0 = Date.now()
    while (Date.now() - t0 < spec.secs * 1000) {
      const ts = Date.now()
      try {
        const p = poll(); p.t = +((ts - t0) / 1000).toFixed(1); polls.push(p)
        if (airAt0 == null && p.air != null) airAt0 = p.air
        if (deathT == null && ((p.deaths ?? 0) > 0 || p.health === 0)) deathT = p.t
      } catch (e) { polls.push({ t: +((ts - t0) / 1000).toFixed(1), err: String(e.message).slice(0, 120) }) }
      if (deathT != null && (Date.now() - t0) / 1000 > deathT + 4) break
      await sleep(Math.max(0, 1000 - (Date.now() - ts)))
    }
  } finally {
    if (spec.difficulty) { try { rcon(`difficulty ${difficultyBefore || 'peaceful'}`) } catch {} }
  }
  const difficultyAfter = (rcon('difficulty')[0].reply.match(/is (\w+)/) || [])[1]?.toLowerCase() ?? null
  let invEnd = null
  // per entry: Paper cuts a long `data get ... Inventory` reply with '...'
  try { invEnd = rcon(...[0, 1, 2, 3, 4, 5].map(i => `data get entity ${NAME} Inventory[${i}]`)).map(x => x.reply.replace(/^.*entity data: /, '').trim()).join(' | ').slice(0, 1500) } catch (e) { invEnd = 'unreadable: ' + e.message }
  await stopBot()
  try { r31(`rm -f ${MAIN}/${envRel}`) } catch {}
  const skillText = (() => { try { return r31(`cat ${ROUT}/${tag}/skill-${NAME}.jsonl 2>/dev/null || true`) } catch { return '' } })()
  const probeText = (() => { try { return r31(`cat ${ROUT}/probe-${tag}.jsonl 2>/dev/null || true`) } catch { return '' } })()
  const traceText = (() => { try { return r31(`cat ${ROUT}/trace-${tag}.jsonl 2>/dev/null || true`) } catch { return '' } })()
  try { r31(`cat > ${ROUT}/bot-${tag}.out`, fs.readFileSync(botOut, 'utf8')); r31(`cat > ${ROUT}/brain-${tag}.log`, fs.existsSync(brainLog) ? fs.readFileSync(brainLog, 'utf8') : '') } catch {}
  const rel = ts => +((ts - t0) / 1000).toFixed(1)
  const rows = skillRows(skillText).filter(r => r.ts >= t0 - 1000)
  const tr = traceText.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(e => e && e.ts >= t0 - 1000)
  const digs = tr.filter(e => e.pkt === 'dig' && e.loc && (e.status === 0 || e.status === 2 || e.status === 1))
    .map(e => ({ t: rel(e.ts), status: e.status, loc: `${e.loc.x},${e.loc.y},${e.loc.z}`, held: e.held?.name ?? null }))
  const good = polls.filter(p => !p.err)
  const roof0 = good[0]?.roof ?? null
  const roofOpened = good.some(p => roof0 && p.roof !== roof0 && p.roof !== 'unknown' && p.roof !== 'other')
  const firstOpen = good.find(p => roof0 && p.roof !== roof0 && p.roof !== 'unknown' && p.roof !== 'other')
  // breathing is judged before any death only (a respawn at world spawn is in air)
  const alivePolls = good.filter(p => !((p.deaths ?? 0) > 0 || p.health === 0))
  // THE EYE CELL FROM THE SERVER'S Pos: floor(y + 1.62) in the 700/700 column, named by the cells read that poll
  // (41 head, 42 roof, 43 above). The `anchored eyes` query is kept but measured unreliable (it read water at y 41.2
  // under an air cell at 42 while Air sat at 300). BREATHING = the eye cell is air, or the server's Air rose.
  let prevA = null
  for (const p of alivePolls) {
    const [x, y, z] = p.pos || []
    const ey = y != null ? Math.floor(y + 1.62) : null
    p.eyeCell = (p.pos && Math.floor(x) === 700 && Math.floor(z) === 700) ? ({ 41: p.head, 42: p.roof, 43: p.above }[ey] ?? `y${ey}`) : (p.pos ? 'off-column' : null)
    p.airRose = prevA != null && p.air != null && p.air > prevA && p.air > 0   // Air sits in [-20, 0] while drowning
    if (p.air != null) prevA = p.air
  }
  const firstBreath = alivePolls.find(p => /^(air|cave_air|off-column)$/.test(p.eyeCell || '') || p.airRose)
  const kinds = {}; for (const r of rows) if (KEEP.test(r.name) || WATERY.test(r.name)) kinds[r.name] = (kinds[r.name] || 0) + 1
  // eye-in-air episodes from the world: entries into air after a period in water (a re-submersion after breathing counts)
  let episodes = 0, resub = 0, prevAir = null
  for (const p of alivePolls) { const ea = /^(air|cave_air|off-column)$/.test(p.eyeCell || ''); if (ea && prevAir !== true) episodes++; if (!ea && prevAir === true) resub++; prevAir = ea }
  const serverDeaths = Math.max(0, ...good.map(p => p.deaths ?? 0))
  const died = serverDeaths > 0 || good.some(p => p.health === 0) || rows.some(r => r.name === '_death')
  const final = good[good.length - 1] || {}
  const res = {
    id: `${arm}:${scene}:${k}`, arm, scene, k, tag, server: SERVER, bot: NAME, root, sha: SHAS[root] ?? ((root.match(/cand-([0-9a-f]{7,})$/) || [])[1] ?? '?'), identity, secs: spec.secs,
    kit: KIT, toolHygiene: process.env.AP_TOOL_HYGIENE || 'unset', invEnd, difficultyBefore, difficultyDuring, difficultyAfter, t0: new Date(t0).toISOString(), airAt0, healthAt0: good[0]?.health ?? null,
    died, serverDeaths, deathT, alive: !died && (final.health ?? 0) > 0, healthEnd: final.health ?? null, airEnd: final.air ?? null,
    roof0, roofEnd: final.roof ?? null, roofOpened, roofOpenT: firstOpen?.t ?? null,
    sideEnd: final.side ?? null, aboveEnd: final.above ?? null, feetEnd: final.feet ?? null, headEnd: final.head ?? null,
    breathT: firstBreath?.t ?? null, healthAtBreath: firstBreath?.health ?? null, airAtBreath: firstBreath?.air ?? null,
    eyeAirEnd: final.eyeAir ?? null, episodes, resub, minHealth: Math.min(...good.map(p => p.health ?? 99)), minAir: Math.min(...good.map(p => p.air ?? 999)),
    kinds, digs,
    ap: rows.filter(r => /^_air_pocket/.test(r.name)).map(r => ({ t: rel(r.ts), name: r.name, status: r.status, detail: r.detail })),
    drown: rows.filter(r => WATERY.test(r.name) || /^_(death|flooded_pocket)/.test(r.name)).map(r => ({ t: rel(r.ts), name: r.name, detail: r.detail.slice(0, 200) })),
    other: rows.filter(r => /^_(entombed|marooned|maroon_|pocket|climb_flood_)/.test(r.name)).map(r => ({ t: rel(r.ts), name: r.name, detail: r.detail.slice(0, 200) })),
    pollErrors: polls.filter(p => p.err).length, polls,
    probe: probeText.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(e => e && e.ts >= t0 - 1000).map(e => ({ ...e, t: rel(e.ts) })),
    digsRaw: tr.filter(e => e.pkt === 'dig' && e.loc).map(e => ({ t: rel(e.ts), status: e.status, loc: `${e.loc.x},${e.loc.y},${e.loc.z}` })),
  }
  const line = JSON.stringify(res) + '\n'
  fs.appendFileSync(RESULTS_LOCAL, line)
  try { r31(`cat >> ${RESULTS_REMOTE}`, line) } catch (e) { console.error('remote results append failed', e.message) }
  const ap1 = res.ap.find(a => a.name === '_air_pocket')
  console.log(`${res.id.padEnd(12)} ${res.sha} died=${died ? 'YES@' + deathT : 'no'} roof ${roof0}->${res.roofEnd} opened=${roofOpened ? res.roofOpenT : 'no'} ` +
    `breath=${res.breathT ?? '-'} hpAtBreath=${res.healthAtBreath ?? '-'} hpEnd=${res.healthEnd} air0=${airAt0} diff=${difficultyDuring} ` +
    `ap=${res.ap.length} refused=${res.ap.filter(a => a.name === '_air_pocket_refused').length} ${ap1 ? '[' + ap1.detail.slice(0, 140) + ']' : ''} kinds=${JSON.stringify(kinds)}`)
}

async function main () {
  const lock = r31('cat /tmp/mcai-sandbox.lock/* 2>/dev/null || echo NOLOCK')
  if (!/airpocket/.test(lock)) throw new Error('the sandbox lock is not held for airpocket: ' + lock.trim().slice(0, 120))
  for (const t = Date.now(); ;) {
    const pl = rcon('list')[0].reply
    if (/There are 0 of/.test(pl)) break
    if (Date.now() - t > 1800000) throw new Error('sandbox not empty')
    console.log('waiting:', pl.trim()); await sleep(20000)
  }
  baseEnv = r31(`cat ${MAIN}/sandbox/sandbox-bot-scripted.env`)
  initialDifficulty = (rcon('difficulty')[0].reply.match(/is (\w+)/) || [])[1]?.toLowerCase() ?? null
  if (!initialDifficulty) throw new Error('difficulty unreadable')
  console.log(`difficulty at start: ${initialDifficulty}`)
  const made = rcon(`scoreboard objectives add ${OBJ} deathCount`)[0].reply
  if (!/Created new objective/.test(made)) throw new Error('could not create the death objective: ' + made)
  await new Promise((resolve, reject) => { brainServer.once('error', reject); brainServer.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  console.log(`server=${SERVER} bot=${NAME} brain=${BRAIN_PORT}->31:${REMOTE_BRAIN_PORT} plan=${PLAN_S}`)
  const seen = {}
  for (const { arm, scene } of PLAN) {
    const k = seen[`${arm}:${scene}`] = (seen[`${arm}:${scene}`] ?? -1) + 1
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await runTrial(arm, scene, k); break } catch (e) { console.error(`trial ${arm}:${scene}:${k} attempt ${attempt} failed: ${e.message}`); await stopBot().catch(() => {}) }
    }
  }
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { brainServer.close() } catch {}
  try { rcon(CLEAR_ITEMS, 'fill 692 30 692 708 52 708 minecraft:stone', `scoreboard objectives remove ${OBJ}`, `difficulty ${initialDifficulty || 'peaceful'}`) } catch (e) { console.error('cleanup rcon failed', e.message) }
  try { console.log('after cleanup:', rcon('difficulty', 'list').map(x => x.reply.trim()).join(' | ')) } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
