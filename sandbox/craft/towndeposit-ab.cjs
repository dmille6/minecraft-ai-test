// SANDBOX-ONLY town deposit A/B driver (towndeposit, 10-05): ONE FRESH BOT PER TRIAL from <botRoot> (unmodified; trace.cjs
// only observes packets), the scene set by RCON once the bot is there, the town order WATCHED (town_deposit is a
// deterministic town order, towndeposit.mjs townDepositOrder -- nothing is queued for it), and the SERVER's truth before
// and after: every bag slot with its damage, every slot of each town chest, and the item entities on the ground.
// The control (the fleet build, no town_deposit) gets the same scene and a watch window in which no order is expected;
// a scene with `cmd` then queues the model's own verb (e.g. `deposit`) through the embedded brain for contrast.
//
//   node towndeposit-ab.cjs <arm: cand|ctrl> <botRoot> <reps> <scene,scene,...> [server]
//
// Town for the bot: the stand IS home (700 120 700); chests 2 east (702 120 700) and, in `twochests`, 3 west (697 120 700).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node towndeposit-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Draw'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/towndeposit-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-tdab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
// Stone floor at y 119, air above; the bot at 700.5 120 700.5 (= home); chest A at 702 120 700, chest B at 697 120 700.
// Durability is `damage` = max - uses left: stone tools 131 (damage 130 = 1 use left, 11 = 120 left, 71 = 60 left).
const STAND = { x: 700.5, y: 120, z: 700.5 }
const HOME = { x: 700, y: 120, z: 700 }
const CHESTS = { A: { x: 702, y: 120, z: 700 }, B: { x: 697, y: 120, z: 700 } }
const at = c => `${c.x} ${c.y} ${c.z}`
const stacks = (id, n) => Array.from({ length: n }, () => [id, 64])
const wool = n => Array.from({ length: n }, (_, i) => ['white_wool', 1 + (i % 3)])      // never bankable, never kept by a rule
// THE FULL BAG (the unit test's fullBag): 3 stone pickaxes (spent 1 use / best 120 / spare 60), cobblestone 64+64+20, oak_log
// 64+64+10, apple 45, raw_iron 5, coal 9, dirt 30, raw_copper 7, 22 wool = 36/36. Expected bank: the 60-use pickaxe,
// cobblestone 20, oak_log 10, raw_copper 7 (4 stacks); everything else stays (keeps, iron ladder, food, dirt, junk).
const FULL_BAG = [['stone_pickaxe', 1, 130], ['stone_pickaxe', 1, 11], ['stone_pickaxe', 1, 71], ['cobblestone', 64], ['cobblestone', 64], ['cobblestone', 20],
  ['oak_log', 64], ['oak_log', 64], ['oak_log', 10], ['apple', 45], ['raw_iron', 5], ['coal', 9], ['dirt', 30], ['raw_copper', 7], ...wool(22)]
const KEPT_BAG = [['cobblestone', 64], ['oak_log', 64], ['dirt', 16], ['sand', 8], ['stone_pickaxe', 1, 20], ['raw_iron', 20], ['apple', 30], ...wool(29)]
const FULL_CHEST = stacks('diorite', 27)
const SPEC = {
  // (a) the full bag at town, one empty chest: the order fires, banks exactly the surplus, nothing else moves or drops
  'full': { bag: FULL_BAG, chests: { A: [] }, cmd: 'deposit' },
  // (b) 36/36 but everything is kept (stockpile 64/64, dirt 16, sand 8, the only pickaxe, iron, food, wool): no order
  'kept': { bag: KEPT_BAG, chests: { A: [] } },
  // (c) the full bag, the only chest 27/27: one failed run (town_storage_full), no click, nothing moved or dropped
  'fullchest': { bag: FULL_BAG, chests: { A: FULL_CHEST } },
  // (d) 33 slots: below the trigger, no order
  'below': { bag: FULL_BAG.slice(0, 33), chests: { A: [] } },
  // (e) chest A has two empty slots, chest B is empty: the visit spans both and creditCap holds across them
  'twochests': { bag: [['oak_log', 64], ['oak_log', 64], ['oak_log', 64], ['oak_log', 10], ['raw_copper', 5], ['raw_gold', 3], ['stone_pickaxe', 1, 11], ['stone_pickaxe', 1, 50], ...wool(28)],
                 chests: { A: [...stacks('diorite', 25)], B: [] } },
}
const WINDOW_MS = 100000        // the first town scan can wait TD_SCAN_MS (30 s) plus a decision's cadence
const CTRL_WINDOW_MS = 60000    // the control: no order is expected; then the model's verb when the scene has one
// A TOWN COMPOSTER stands at 696 120 696 in every scene (run 1, 10-05: with none, the base build_composter order fired as soon
// as the deposit freed slots -- and in `below` it crafted planks and slabs first, taking a 33-slot bag to 35 before the deposit).
function arenaCmds () {
  return ['kill @e[type=!player,x=700,y=120,z=700,distance=..30]',
    'fill 688 120 688 712 130 712 minecraft:air', 'fill 688 119 688 712 119 712 minecraft:stone', 'setblock 696 120 696 minecraft:composter']
}
const itemArg = (id, dmg) => `minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''}`
function chestCmds (spec) {
  // The chests go down LAST, filled in the same batch: an order that scans before the bag is set acts on the last bag.
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
let SNAP_CHESTS = ['A']
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

const ended = (botOut, skillLog, verb) => lines(botOut).some(l => new RegExp(`skill ${verb} ->|rejected why=.*"skill":"${verb}"`).test(l)) ||
  (verb === 'town_deposit' && skillRows(skillLog).some(r => r.name === '_town_deposit'))

async function runTrial (scene, k) {
  const spec = SPEC[scene]
  SNAP_CHESTS = Object.keys(spec.chests)
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/towndeposit-ab/${tag}`
  const skillLog = `${R}/sandbox/log/towndeposit-ab/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.tdab-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/towndeposit-ab-${tag}`); set('MEMORY_POOL', `sbxtdab-${tag}`)
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
  let started = null
  if (ARM === 'cand') {
    started = await waitFor(() => skillRows(skillLog).some(r => r.name === '_town_deposit') || lines(botOut).some(l => /town_deposit/.test(l)), WINDOW_MS)
    if (started) await waitFor(() => ended(botOut, skillLog, 'town_deposit'), 120000)
    // ONE PER STAY: watch 40 s more -- a second order in the same stay is a defect (the latch).
    await sleep(40000)
    marks.orders = lines(botOut).filter(l => /LLM -> town_deposit|skill town_deposit ->/.test(l)).length
  } else {
    started = await waitFor(() => lines(botOut).some(l => /town_deposit/.test(l)), CTRL_WINDOW_MS)
    marks.order_on_control = !!started
  }
  await sleep(1500)
  const mid = snapshot()
  if (spec.cmd && ARM === 'ctrl') {
    const tq = Date.now(); brainQueue.push(spec.cmd)
    const verb = spec.cmd.split(/\s+/)[0]
    const done = await waitFor(() => ended(botOut, skillLog, verb), 120000)
    marks.verb = { cmd: spec.cmd, atMs: tq - t0, ended: !!done }
    await sleep(1500)
  }
  const after = snapshot()
  const rows = skillRows(skillLog)
  await stopBot()
  await sleep(1500)
  const afterLogout = snapshot()
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = traceEv(trace).filter(e => e.ts >= t0)
  const tb = totals(before), tm = totals(mid), ta = totals(after), tl = totals(afterLogout)
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    started: !!started, marks, windowMs: Date.now() - t0,
    before: { ...before, totals: tb }, mid: { ...mid, totals: tm }, after: { ...after, totals: ta },
    afterLogout: { chest: afterLogout.chest, ground: afterLogout.ground, totals: { chest: tl.chest, ground: tl.ground } },
    conserved: diff(all(tb), all(ta)) || 'yes',
    rows: rows.filter(x => /town_deposit|deposit|_work_order|_pickups|_death|reflex|_stuck/.test(x.name)),
    trace: { clicks: tr.filter(e => e.pkt === 'click').map(e => ({ t: e.ts - t0, win: e.win, slot: e.slot, mode: e.mode, btn: e.btn })),
      closes: tr.filter(e => /close_window/.test(e.pkt)).map(e => ({ t: e.ts - t0, pkt: e.pkt, win: e.win })),
      places: tr.filter(e => e.pkt === 'block_place').length, digs: tr.filter(e => e.pkt === 'block_dig').length,
      pickups: tr.filter(e => e.pkt === 'collect' && e.self).map(e => ({ t: e.ts - t0, n: e.n })), spawns: tr.filter(e => e.pkt === 'spawn_item').map(e => ({ t: e.ts - t0, x: e.x, y: e.y, z: e.z })) },
    out: lines(botOut).filter(l => /town_deposit|deposit|rejected|spawned|work_order/i.test(l)).map(l => l.slice(0, 300)).slice(-40) }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const td = rows.filter(x => x.name === '_town_deposit').map(x => `${x.status}:${x.detail.slice(0, 220)}`).join(' || ')
  const verbRow = rows.filter(x => x.name === 'deposit').map(x => `${x.name}:${x.status}:${x.detail.slice(0, 120)}`).join(' || ')
  console.log(`${r.id.padEnd(20)} order=${r.started} bag ${before.bagUsed}->${after.bagUsed} chest ${before.chestUsed}->${after.chestUsed} picks bag[${picks(before.bag)}]->[${picks(after.bag)}] chest[${picks(after.chest)}]` +
    ` d(bag){${diff(tb.bag, ta.bag)}} d(chest){${diff(tb.chest, ta.chest)}} ground[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] logout-ground[${afterLogout.ground.map(g => g.id + 'x' + g.count).join(',')}] conserved=${r.conserved}` +
    ` clicks=${r.trace.clicks.length} places=${r.trace.places} digs=${r.trace.digs} marks=${JSON.stringify(marks)} | ${td} | ${verbRow}`)
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
  try { fs.unlinkSync(`${R}/sandbox/.env.tdab-${ARM}`) } catch {}
  try { rcon('kill @e[type=!player,x=700,y=120,z=700,distance=..30]', 'fill 688 120 688 712 130 712 minecraft:air', 'fill 688 119 688 712 119 712 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
