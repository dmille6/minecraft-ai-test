// SANDBOX-ONLY climbflood-01 A/B driver (underground-safety design 4.1, scenes A-G). ONE FRESH BOT PER TRIAL from
// <botRoot> (unmodified; trace.cjs only observes packets -- every dig with its location), an entombed 1x1 stone cell
// built by RCON at y 40 once the bot is there, NO decision queued (the entombed reflex acts on its own; the embedded
// brain answers every decision with `status`), then the WORLD read back over RCON every 2 s for the trial: water or
// lava in the bot's own two cells and in the column, the ceiling block, the bot's Air, Health and Pos; plus the bot's
// own rows (climb_flood_*, entombed*, prereq_*, water-family, _death) and every dig location from the trace.
//
//   node climbflood-ab.cjs <arm> <botRoot> <reps> <scene,scene,...> [server]
//
// Scenes (the cell: feet 700 40 700, head 41, ceiling 42; solid stone 692..708 x 30..52 x 692..708 around it):
//   A  2x2x2 water-source pocket directly above the ceiling block (700..701, 43..44, 700..701)
//   B  one water source beside the ceiling block (701 42 700)
//   C  A widened to 3x3x2 (699..701, 43..44, 699..701): the column above AND every ramp bearing's clearance wet; 240 s
//   D  the bot already submerged (its two cells water sources), the ceiling dry stone, an air pocket above
//   E  lava source above the ceiling (700 43 700)
//   F  dry: a 5x5x3 air room at 44..46 above the ceiling (the regression arm: must climb out)
//   G  gravel above the ceiling (700 43 700), water source above the gravel (700 44 700)
// Kit (design): stone_pickaxe at ~100 uses (damage 31), 64 cobblestone, an empty bucket.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node climbflood-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Flood'
const OUTDIR = `${R}/sandbox/log/climbflood-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = Number(process.env.CRAFT_BRAIN_PORT || 11499)
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-cfab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- scenes
const C = { x: 700, y: 40, z: 700 }            // the bot's feet cell
const STAND = { x: 700.5, y: 40, z: 700.5 }
const SPEC = {
  A: { setup: ['fill 700 43 700 701 44 701 minecraft:water'], secs: 120 },
  B: { setup: ['setblock 701 42 700 minecraft:water'], secs: 120 },
  C: { setup: ['fill 699 43 699 701 44 701 minecraft:water'], secs: 240 },
  D: { setup: ['fill 700 43 700 700 45 700 minecraft:air', 'fill 700 40 700 700 41 700 minecraft:water'], secs: 120, submerged: true },
  E: { setup: ['setblock 700 43 700 minecraft:lava'], secs: 120 },
  F: { setup: ['fill 698 44 698 702 46 702 minecraft:air'], secs: 120 },
  G: { setup: ['setblock 700 43 700 minecraft:gravel', 'setblock 700 44 700 minecraft:water'], secs: 120 },
}
function arenaCmds (spec) {
  const c = ['kill @e[type=item,x=700,y=40,z=700,distance=..20]',
    'fill 692 30 692 708 52 708 minecraft:stone',
    'fill 700 40 700 700 41 700 minecraft:air']
  for (const s of spec.setup) c.push(s)
  return c
}
function kitCmds () {
  return [`clear ${NAME}`,
    `item replace entity ${NAME} container.0 with minecraft:stone_pickaxe[damage=31] 1`,
    `item replace entity ${NAME} container.1 with minecraft:cobblestone 64`,
    `item replace entity ${NAME} container.2 with minecraft:bucket 1`,
    `effect clear ${NAME}`, `effect give ${NAME} minecraft:saturation 1 20 true`]
}

// ---------------------------------------------------------------- oracle
const Q = (cmd) => cmd
function pollCmds () {
  const at = (dy, b) => `execute at ${NAME} if block ~ ~${dy} ~ minecraft:${b}`
  return [
    at(0, 'water'), at(1, 'water'), at(0, 'lava'), at(1, 'lava'),
    `execute if block ${C.x} ${C.y + 2} ${C.z} minecraft:stone`,
    `execute if block ${C.x} ${C.y + 2} ${C.z} minecraft:water`,
    `execute if block ${C.x} ${C.y + 1} ${C.z} minecraft:water`,
    `data get entity ${NAME} Air`, `data get entity ${NAME} Health`, `data get entity ${NAME} Pos`,
  ].map(Q)
}
const passed = r => /Test passed/.test(r?.reply || '')
const num = r => { const m = (r?.reply || '').match(/data: (-?[\d.]+)/); return m ? +m[1] : null }
function poll () {
  const r = rcon(...pollCmds())
  const pos = (((r[9]?.reply || '').match(/\[([^\]]+)\]/) || [])[1] || '').replace(/d/g, '').split(',').map(Number)
  return { feetWater: passed(r[0]), headWater: passed(r[1]), feetLava: passed(r[2]), headLava: passed(r[3]),
           ceilStone: passed(r[4]), ceilWater: passed(r[5]), cellHeadWater: passed(r[6]),
           air: num(r[7]), health: num(r[8]), y: pos.length === 3 ? +pos[1].toFixed(2) : null, pos }
}

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const WATERY = /^_(drowning|air_drowning|flooded_pocket|water_no_air|oxygen_critical|reflex_drowning|sealed_in_liquid)/
const KEEP = /^_(climb_flood_|entombed|marooned|maroon_|prereq_|death|escape_lattice|pocket|hand_safe)|^(surface|mine|goto)$/
function skillRows (file) {
  return lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
    .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '').slice(0, 300),
                 y: r.bot?.pos?.y ?? null }))
}
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE BRAIN: every decision gets `status` (no skill is queued -- the reflex is the unit under test).
let brainLog = null
const brainServer = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    if (brainLog) fs.appendFileSync(brainLog, `${new Date().toISOString()} decision: status\n`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ skill: 'status', args: {}, reason: 'sandbox: observe only', saw_end: sentinel }) },
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
  if (!spec) throw new Error(`unknown scene ${scene}`)
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const skillLog = `${OUTDIR}/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.cfab-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', `./sandbox/log/climbflood-ab/${tag}`); set('STATE_DIR', `./sandbox/state/climbflood-ab-${tag}`); set('MEMORY_POOL', `sbxcf-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, Math.floor(STAND[a.toLowerCase()])); set(`BOARD_${a}`, Math.floor(STAND[a.toLowerCase()])) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  // SPECTATOR WHILE THE ARENA IS BUILT: the chunk must be loaded (the bot is there), and the bot must not be inside
  // stone in survival while the fill runs.
  rcon(`gamemode spectator ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y + 20} ${STAND.z}`)
  await sleep(3000)
  const built = rcon(...arenaCmds(spec))
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  rcon(...kitCmds(), `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`, `gamemode survival ${NAME}`, `effect give ${NAME} minecraft:instant_health 1 5 true`)
  const t0 = Date.now()
  const polls = []
  while (Date.now() - t0 < spec.secs * 1000) {
    try { polls.push({ t: Math.round((Date.now() - t0) / 1000), ...poll() }) } catch (e) { polls.push({ t: Math.round((Date.now() - t0) / 1000), err: e.message.slice(0, 80) }) }
    await sleep(2000)
  }
  const final = polls[polls.length - 1] || {}
  const rows = skillRows(skillLog).filter(r => r.ts >= t0 - 2000)
  await stopBot()
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = lines(trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(e => e && e.ts >= t0)
  const digs = tr.filter(e => e.pkt === 'dig' && e.status === 2 && e.loc).map(e => `${e.loc.x},${e.loc.y},${e.loc.z}@${Math.round((e.ts - t0) / 1000)}s`)
  const digStarts = tr.filter(e => e.pkt === 'dig' && e.status === 0 && e.loc).map(e => `${e.loc.x},${e.loc.y},${e.loc.z}`)
  const ceilingDug = digStarts.includes(`${C.x},${C.y + 2},${C.z}`)
  const headWet = polls.some(p => p.headWater || p.headLava)
  const anyLava = polls.some(p => p.feetLava || p.headLava)
  const died = rows.some(r => r.name === '_death')
  const watery = rows.filter(r => WATERY.test(r.name)).length
  const flooded = (spec.submerged ? false : headWet) || (!spec.submerged && watery > 0) || anyLava || rows.some(r => r.name === '_death' && /drown|lava|fire|burn/.test(r.detail))
  const minAir = Math.min(...polls.map(p => p.air ?? 999))
  const kinds = {}; for (const r of rows) if (KEEP.test(r.name) || WATERY.test(r.name)) kinds[r.name] = (kinds[r.name] || 0) + 1
  const res = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, secs: spec.secs,
    sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    flooded, headWet, anyLava, died, watery, minAir, ceilingDug, alive: !died && (final.health ?? 0) > 0,
    y0: polls[0]?.y ?? null, yEnd: final.y ?? null, ceilingStoneEnd: !!final.ceilStone, cellHeadWaterEnd: !!final.cellHeadWater,
    kinds, digs, prereqs: rows.filter(r => /^_prereq_/.test(r.name)).map(r => r.detail.slice(0, 160)),
    floodRows: rows.filter(r => /^_climb_flood_/.test(r.name)).map(r => `${Math.round((r.ts - t0) / 1000)}s ${r.name} ${r.detail.slice(0, 220)}`),
    escapeRows: rows.filter(r => /^_(entombed|maroon)/.test(r.name)).map(r => `${Math.round((r.ts - t0) / 1000)}s ${r.name} ${r.detail.slice(0, 160)}`),
    polls }
  fs.appendFileSync(RES, JSON.stringify(res) + '\n')
  console.log(`${res.id.padEnd(16)} sha=${res.sha} flooded=${flooded ? 'YES' : 'no '} died=${died ? 'YES' : 'no '} ceilingDug=${ceilingDug ? 'YES' : 'no '} ` +
    `y ${res.y0}->${res.yEnd} minAir=${minAir} watery=${watery} prereqs=${res.prereqs.length} ` +
    `flood_rows=${res.floodRows.length} kinds=${JSON.stringify(kinds)}`)
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
  try { fs.unlinkSync(`${R}/sandbox/.env.cfab-${ARM}`) } catch {}
  try { rcon('kill @e[type=item,x=700,y=40,z=700,distance=..20]', 'fill 692 30 692 708 52 708 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
