// SANDBOX-ONLY food-skip A/B driver (foodskip, 10-05): ONE FRESH BOT PER TRIAL from <botRoot> (unmodified; trace.cjs only
// observes packets). The sandbox world is PEACEFUL (`difficulty` says so; the driver asserts it). Scene: one oak_log block
// beside the bot, an apple and a bread lying 4-5 blocks away and a cobblestone 6 blocks away (PickupDelay 0, so the
// server hands any of them over the moment the bot is within reach). The model's `gather 1 oak_log` is queued; after the
// dig, pickupNearbyItems sweeps 8 blocks. Candidate (FOOD_SKIP unset = auto, peaceful): walks to the cobblestone, never
// to the food. Control (the fleet build): walks to everything. Oracle: the item entities on the ground after the trial,
// the bag (server slots), the `_food_skip` row and the pickup rows (`_junk_pickup` sought/passive).
//
//   node foodskip-ab.cjs <arm: cand|ctrl> <botRoot> <reps> <scene,...> [server]     scenes: food | food_off | apples | apples_off | apples_easy
//   food_off runs the CANDIDATE with FOOD_SKIP=off: the owner's switch -- food is chased again.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node foodskip-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Draw'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/foodskip-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-fsab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
const STAND = { x: 700.5, y: 120, z: 700.5 }
const HOME = { x: 700, y: 120, z: 700 }
const LOG = { x: 702, y: 120, z: 700 }
const DROPS = [['apple', 704.5, 703.5], ['bread', 698.5, 704.5], ['cobblestone', 696.5, 705.5]]
// THE APPLE SCENES (owner 10-06, the peaceful food policy): a town bot at 35/36 holding 10 apples (34 wool), a composter
// and a chest at town; NOTHING is queued -- compost is a town order. Expected: peaceful 6 composted, 4 kept; FOOD_SKIP=off
// and a non-peaceful world (`difficulty easy` by RCON on the sandbox, restored to peaceful after the trial): none.
const WOOL34 = Array.from({ length: 34 }, () => ['white_wool', 1])
const SPEC = {
  food: { bag: [['white_wool', 1]], cmd: 'gather 1 oak_log' },
  food_off: { bag: [['white_wool', 1]], cmd: 'gather 1 oak_log', env: { FOOD_SKIP: 'off' } },
  apples: { bag: [['apple', 10], ...WOOL34], compost: true },
  apples_off: { bag: [['apple', 10], ...WOOL34], compost: true, env: { FOOD_SKIP: 'off' } },
  apples_easy: { bag: [['apple', 10], ...WOOL34], compost: true, difficulty: 'easy' },
}
const WINDOW_MS = 120000
function arenaCmds () {
  return ['kill @e[type=!player,x=700,y=120,z=700,distance=..30]',
    'fill 688 120 688 712 130 712 minecraft:air', 'fill 688 119 688 712 119 712 minecraft:stone']
}
const itemArg = (id, dmg) => `minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''}`
function sceneCmds (spec) {
  if (spec.compost) return ['setblock 696 120 696 minecraft:composter', 'setblock 702 120 700 minecraft:chest[facing=west]']
  return [`setblock ${LOG.x} ${LOG.y} ${LOG.z} minecraft:oak_log`,
    ...DROPS.map(([id, x, z]) => `summon minecraft:item ${x} 120.1 ${z} {Item:{id:"minecraft:${id}",count:3},PickupDelay:0s,Age:-32768s}`)]
}
function bagCmds (spec) {
  const c = [`clear ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`]
  spec.bag.forEach(([id, n, dmg], s) => c.push(`item replace entity ${NAME} container.${s} with ${itemArg(id, dmg)} ${n}`))
  return c
}

// ---------------------------------------------------------------- oracle (the server's slots, never the bot's claim)
const parseItem = seg => {
  const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]
  if (!id) return null
  const count = +((seg.match(/count: (\d+)/) || [])[1] || 1)
  const dm = seg.match(/"minecraft:damage": (\d+)/)
  return { id, count, ...(dm ? { damage: +dm[1] } : {}) }
}
let SNAP_CHESTS = []
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  
  cmds.push('execute as @e[type=item,x=700,y=120,z=700,distance=..24] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Pos`)
  const r = rcon(...cmds)
  const bag = {}; const chest = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) bag[s] = it }
  const base = 36 + SNAP_CHESTS.length * 27
  const ground = (r[base]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  const posR = r[base + 1]?.reply || ''
  const pos = ((posR.match(/\[([^\]]+)\]/) || [])[1] || '').replace(/d/g, '')
  return { bag, chest, ground, pos, online: /has the following entity data/.test(posR), bagUsed: Object.keys(bag).length, chestUsed: Object.keys(chest).length }
}
const tot = list => { const t = {}; for (const it of list) t[it.id] = (t[it.id] || 0) + it.count; return t }
const totals = snap => ({ bag: tot(Object.values(snap.bag)), chest: tot(Object.values(snap.chest)), ground: tot(snap.ground) })
const all = t => { const o = {}; for (const part of Object.values(t)) for (const [k, n] of Object.entries(part)) o[k] = (o[k] || 0) + n; return o }
const diff = (a, b) => Object.keys({ ...a, ...b }).map(n => [n, (b[n] || 0) - (a[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
const picks = slots => Object.entries(slots).filter(([, it]) => /_pickaxe$/.test(it.id)).map(([s, it]) => `${it.id}@${s}:dmg${it.damage ?? 0}`)

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const NOISE = /^(_affordance_scan|_progress_restored|_reach_probe|_path_reset)$/
function skillRows (file) {
  return lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill && !NOISE.test(r.skill.name))
    .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, trigger: r.trigger, ms: r.skill.duration_ms, fail: r.skill.fail_class,
      detail: String(r.skill.detail || '').slice(0, 400) }))
}
const traceEv = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE QUEUE BRAIN, IN THIS PROCESS: each decision gets the next queued line, else 'status'.
let brainQueue = []; let brainLog = null
const brainServer = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const line = brainQueue.shift() || 'status'
    const [skill, ...rest] = line.split(/\s+/); const args = {}
    if (rest.length === 1) args.item = rest[0]
    else if (rest.length === 2 && /^\d+$/.test(rest[0])) { args.count = +rest[0]; args.item = rest[1] }
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

const ended = (botOut, skillLog, verb) => lines(botOut).some(l => new RegExp(`skill ${verb} ->|rejected why=.*"skill":"${verb}"`).test(l))

async function runTrial (scene, k) {
  const spec = SPEC[scene]
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/foodskip-ab/${tag}`
  const skillLog = `${R}/sandbox/log/foodskip-ab/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.fsab-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/foodskip-ab-${tag}`); set('MEMORY_POOL', `sbxfsab-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000)
  set('STUCK_SECONDS', 20)
  for (const [kk, v] of Object.entries(spec.env ?? {})) set(kk, v)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainQueue = []; brainLog = `${OUTDIR}/brain-${tag}.log`
  if (spec.difficulty) rcon(`difficulty ${spec.difficulty}`)
  const diffReply = rcon('difficulty')[0]?.reply || ''
  if (!new RegExp(spec.difficulty ?? 'Peaceful', 'i').test(diffReply)) throw new Error('the sandbox difficulty is not what the scene needs: ' + diffReply)
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`, `effect clear ${NAME}`)
  await sleep(3000)
  const built = [...rcon(...arenaCmds()), ...rcon(...bagCmds(spec)), ...rcon(...sceneCmds(spec))]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected/i.test(x.reply) && !/^kill /.test(x.cmd))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  await sleep(1500)
  const before = snapshot()
  const t0 = Date.now()
  let done
  if (spec.compost) {
    // compost is a TOWN ORDER: watch for it (the first town scan can wait 30 s plus a decision's cadence)
    done = await waitFor(() => ended(botOut, skillLog, 'compost'), 100000)
    await sleep(4000)
  } else {
    brainQueue.push(spec.cmd)
    done = await waitFor(() => ended(botOut, skillLog, 'gather'), WINDOW_MS)
    await sleep(4000)
  }
  const after = snapshot()
  const rows = skillRows(skillLog)
  const composterNow = spec.compost ? (rcon('data get block 696 120 696')[0]?.reply || '').slice(0, 160) : null
  await stopBot()
  if (spec.difficulty) rcon('difficulty peaceful')
  await sleep(1500)
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = traceEv(trace).filter(e => e.ts >= t0)
  const tb = totals(before), ta = totals(after)
  const junk = lines(skillLog).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill && r.skill.name === '_junk_pickup').map(r => r.skill.args)
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    gatherEnded: !!done, difficulty: diffReply.trim(), before: { ...before, totals: tb }, after: { ...after, totals: ta },
    foodSkipRows: rows.filter(x => x.name === '_food_skip').map(x => x.detail), junk, composterNow,
    compostRows: rows.filter(x => x.name === '_compost' || x.name === 'compost').map(x => `${x.status}:${x.detail.slice(0, 200)}`),
    rows: rows.filter(x => /gather|_pickup|_food_skip|_junk/.test(x.name)),
    trace: { pickups: tr.filter(e => e.pkt === 'collect' && e.self).map(e => ({ t: e.ts - t0, n: e.n })) } }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  console.log(`${r.id.padEnd(18)} ${spec.compost ? `compost=${r.gatherEnded} apples ${tb.bag.apple ?? 0}->${ta.bag.apple ?? 0} bone_meal ${ta.bag.bone_meal ?? 0} compost_rows=${JSON.stringify(r.compostRows)} ` : ''}gather=${r.gatherEnded} bag{${diff(tb.bag, ta.bag)}} ground-before[${before.ground.map(g => g.id + 'x' + g.count).join(',')}] ground-after[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] food_skip=${JSON.stringify(r.foodSkipRows)} junk=${JSON.stringify(junk.map(j => `${j.item}:${j.mode}${j.sought_by ? '(' + j.sought_by + ')' : ''}`))} | ${rows.filter(x => x.name === 'gather').map(x => x.status + ':' + x.detail.slice(0, 100)).join(' || ')}`)
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
  for (let k = 0; k < REPS; k++) for (const scene of SCENES) {
    try { await runTrial(scene, k) } catch (e) { console.log(`${ARM}:${scene}:${k} TRIAL FAILED: ${e.message}`); await stopBot().catch(() => {}) }
  }
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { brainServer.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.fsab-${ARM}`) } catch {}
  try { rcon('difficulty peaceful') } catch {}   // a non-peaceful scene never leaves the sandbox hard
  try { rcon('kill @e[type=!player,x=700,y=120,z=700,distance=..30]', 'fill 688 120 688 712 130 712 minecraft:air', 'fill 688 119 688 712 119 712 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
