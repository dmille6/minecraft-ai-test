// SANDBOX-ONLY cobble-rule A/B driver (stonecap-01, 10-07), derived from towndeposit-ab.cjs: ONE FRESH BOT PER TRIAL from
// <botRoot> (unmodified; trace.cjs only observes packets), the scene set by RCON once the bot is there, the model's
// `deposit` verb QUEUED through the embedded brain, and the SERVER's truth before and after: every bag slot, every slot of
// the one town chest, and the item entities on the ground (online, and after logout -- Paper drops a disconnected
// player's cursor, so the logout ground is the cursor oracle).
//
//   node cobble-ab.cjs <arm: cand|ctrl> <botRoot> <reps> <scene,scene,...> [server]
//
// Town for the bot: the stand IS home (700 120 700); ONE chest 2 east (702 120 700); a composter at 696 120 696 (else the
// build_composter town order fires). Every bag carries one good stone_pickaxe (damage 11) so withdraw_pick does not fire.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node cobble-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox3: 25601 }
if (!PORTS[SERVER]) throw new Error('sandbox / sandbox3 only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Cobble'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/cobble-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-cbab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
const STAND = { x: 700.5, y: 120, z: 700.5 }
const HOME = { x: 700, y: 120, z: 700 }
const CHESTS = { A: { x: 702, y: 120, z: 700 } }
const at = c => `${c.x} ${c.y} ${c.z}`
const stacks = (id, n) => Array.from({ length: n }, () => [id, 64])
const PICK = ['stone_pickaxe', 1, 11]
const SPEC = {
  // A: 64 + 30 cobble, logs, fillers. cand: the 30 banked whole, 64 kept in one slot; ctrl: the old reserve (8)
  'A': { bag: [['cobblestone', 64], ['cobblestone', 30], ['oak_log', 20], ['string', 16], ['bone', 16], PICK], chests: { A: [] } },
  // B: 50 cobble (under the reserve) + logs. cand: no cobble moves, logs banked; ctrl: 42 cobble banked
  'B': { bag: [['cobblestone', 50], ['oak_log', 20], PICK], chests: { A: [] } },
  // C: the chest has room for 14 cobble only (26 x stone 64 + cobblestone 50). cand: nothing of cobble moves, nothing dropped
  'C': { bag: [['cobblestone', 64], ['cobblestone', 30], PICK], chests: { A: [...stacks('stone', 26), ['cobblestone', 50]] } },
}
const WINDOW_MS = 200000   // the deposit's watchdog is 180 s
function arenaCmds () {
  return ['kill @e[type=!player,x=700,y=120,z=700,distance=..30]',
    'fill 688 120 688 712 130 712 minecraft:air', 'fill 688 119 688 712 119 712 minecraft:stone', 'setblock 696 120 696 minecraft:composter']
}
const itemArg = (id, dmg) => `minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''}`
function chestCmds (spec) {
  const c = []
  for (const [k, list] of Object.entries(spec.chests)) {
    c.push(`setblock ${at(CHESTS[k])} minecraft:chest[facing=west]`)
    list.forEach(([id, n, dmg], s) => c.push(`item replace block ${at(CHESTS[k])} container.${s} with ${itemArg(id, dmg)} ${n}`))
  }
  return c
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
const SNAP_CHESTS = ['A']
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  for (const k of SNAP_CHESTS) for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(CHESTS[k])} Items[{Slot:${s}b}]`)
  cmds.push('execute as @e[type=item,x=700,y=120,z=700,distance=..24] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Pos`)
  const r = rcon(...cmds)
  const bag = {}; const chest = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) bag[s] = it }
  SNAP_CHESTS.forEach((k, ci) => { for (let s = 0; s < 27; s++) { const q = r[36 + ci * 27 + s]; const it = /has the following block data/.test(q?.reply || '') ? parseItem(q.reply) : null; if (it) chest[`${k}${s}`] = it } })
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
const cobbleSlots = slots => Object.entries(slots).filter(([, it]) => /^(cobblestone|cobbled_deepslate)$/.test(it.id)).map(([s, it]) => `${s}:${it.count}`).join(',') || '-'
const contents = slots => { const t = tot(Object.values(slots)); return Object.entries(t).map(([k, n]) => `${k}x${n}`).join(',') || 'empty' }

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
const endedCount = (botOut, verb) => lines(botOut).filter(l => new RegExp(`skill ${verb} ->|rejected why=.*"skill":"${verb}"`).test(l)).length
// the revision under test, from <botRoot>/.sha (the export has no .git)
const shaOf = root => { try { return fs.readFileSync(path.join(root, '.sha'), 'utf8').trim() } catch { return 'unknown' } }

async function runTrial (scene, k) {
  const spec = SPEC[scene]
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/cobble-ab/${tag}`
  const skillLog = `${R}/sandbox/log/cobble-ab/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.cbab-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/cobble-ab-${tag}`); set('MEMORY_POOL', `sbxcbab-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000)
  set('STUCK_SECONDS', 20)   // the fleet's value
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainQueue = []; brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`, `effect clear ${NAME}`)
  await sleep(3000)
  const built = [...rcon(...arenaCmds()), ...rcon(...bagCmds(spec)), ...rcon(...chestCmds(spec))]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected/i.test(x.reply) && !/^kill /.test(x.cmd))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  await sleep(2500)
  const before = snapshot()
  const t0 = Date.now()
  const marks = {}
  brainQueue.push('deposit')
  const done = await waitFor(() => endedCount(botOut, 'deposit') >= 1, WINDOW_MS)
  marks.depositEnded = !!done; marks.depositMs = Date.now() - t0
  await sleep(1500)
  const after = snapshot()
  const rows = skillRows(skillLog)
  await stopBot()
  await sleep(1500)
  const afterLogout = snapshot()
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = traceEv(trace).filter(e => e.ts >= t0)
  const tb = totals(before), ta = totals(after), tl = totals(afterLogout)
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: shaOf(BOT_ROOT), marks, windowMs: Date.now() - t0,
    before: { ...before, totals: tb }, after: { ...after, totals: ta },
    afterLogout: { chest: afterLogout.chest, ground: afterLogout.ground, totals: { chest: tl.chest, ground: tl.ground } },
    conserved: diff(all(tb), all(ta)) || 'yes',
    rows: rows.filter(x => /deposit|cobble|_town|chest|withdraw|compost|_pickups|_death|reflex|_stuck|cursor|unsettled/.test(x.name)),
    trace: { clicks: tr.filter(e => e.pkt === 'click').map(e => ({ t: e.ts - t0, win: e.win, slot: e.slot, mode: e.mode, btn: e.btn })),
      spawns: tr.filter(e => e.pkt === 'spawn_item').map(e => ({ t: e.ts - t0, x: e.x, y: e.y, z: e.z })) },
    out: lines(botOut).filter(l => /deposit|cobble|rejected|spawned|work_order/i.test(l)).map(l => l.slice(0, 300)).slice(-40) }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const dep = rows.filter(x => x.name === 'deposit').map(x => `${x.status}/${x.fail ?? '-'}:${x.detail.slice(0, 200)}`).join(' || ')
  const cb = rows.filter(x => /cobble/.test(x.name)).map(x => `${x.name}:${x.status}:${x.detail}`).join(' || ')
  const other = rows.filter(x => !/^deposit$|cobble/.test(x.name)).map(x => `${x.name}:${x.status}`).join(',')
  console.log(`${r.id} sha=${r.sha} ended=${marks.depositEnded} ${marks.depositMs}ms\n` +
    `  bag cobble/slot ${cobbleSlots(before.bag)} -> ${cobbleSlots(after.bag)} | bag after ${contents(after.bag)}\n` +
    `  chest after ${contents(after.chest)} (cobble/slot ${cobbleSlots(after.chest)})\n` +
    `  d(bag){${diff(tb.bag, ta.bag)}} d(chest){${diff(tb.chest, ta.chest)}} ground[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] logout-ground[${afterLogout.ground.map(g => g.id + 'x' + g.count).join(',')}] conserved=${r.conserved} clicks=${r.trace.clicks.length}\n` +
    `  deposit: ${dep || '-'}\n  cobble_bank: ${cb || '-'}\n  other rows: ${other || '-'}`)
}

async function main () {
  for (const t = Date.now(); ;) {
    const pl = rcon('list')[0].reply
    if (/There are 0 of/.test(pl)) break
    if (Date.now() - t > 3600000) throw new Error('sandbox not empty')
    console.log('waiting:', pl.trim()); await sleep(20000)
  }
  await new Promise((resolve, reject) => { brainServer.once('error', reject); brainServer.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  console.log(`arm=${ARM} root=${BOT_ROOT} sha=${shaOf(BOT_ROOT)} server=${SERVER}`)
  for (let k = 0; k < REPS; k++) for (const scene of SCENES) {
    try { await runTrial(scene, k) } catch (e) { console.log(`${ARM}:${scene}:${k} TRIAL FAILED: ${e.message}`); await stopBot().catch(() => {}) }
  }
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { brainServer.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.cbab-${ARM}`) } catch {}
  try { rcon('kill @e[type=!player,x=700,y=120,z=700,distance=..30]', 'fill 688 120 688 712 130 712 minecraft:air', 'fill 688 119 688 712 119 712 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
