// SANDBOX-ONLY town cobble cap A/B driver (stonecap-01 cap, 10-07), derived from cobble-ab.cjs: ONE FRESH BOT PER TRIAL from
// <botRoot> (unmodified; trace.cjs only observes packets), a FRESH pool per trial (so the town cobble ledger
// <pool>/town-chest-700_120_700.cobble.json starts empty), the scene set by RCON, then a CHAIN of steps: each step's RCON
// commands, then either the model's verb QUEUED through the embedded brain (`deposit`, `deposit cobblestone`, ...) or a
// WATCH for the deterministic town_deposit order. The SERVER's truth before and after: every bag slot, every slot of every
// container in the scene, the item entities on the ground (online and after logout), and the ledger file the bot wrote.
//
//   node cobble-cap-ab.cjs <arm> <botRoot> <reps> <scene,scene,...> [server]
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node cobble-cap-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox3: 25601 }
if (!PORTS[SERVER]) throw new Error('sandbox / sandbox3 only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Cobble'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/cobble-cap-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })
if (process.env.POOL_STATE_DIR) throw new Error('POOL_STATE_DIR is set: the ledger would not be fresh')

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ccab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
const STAND = { x: 700.5, y: 120, z: 700.5 }
const HOME = { x: 700, y: 120, z: 700 }
const at = c => `${c.x} ${c.y} ${c.z}`
const PICK = ['stone_pickaxe', 1, 11]
const cob = n => { const o = []; while (n > 0) { o.push(['cobblestone', Math.min(64, n)]); n -= 64 } return o }
const wool = n => ['white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool', 'yellow_wool', 'lime_wool', 'pink_wool', 'gray_wool', 'light_gray_wool', 'cyan_wool',
  'purple_wool', 'blue_wool', 'brown_wool', 'green_wool', 'red_wool', 'black_wool', 'white_carpet', 'orange_carpet', 'magenta_carpet', 'light_blue_carpet',
  'yellow_carpet', 'lime_carpet', 'pink_carpet', 'gray_carpet', 'light_gray_carpet', 'cyan_carpet', 'purple_carpet', 'blue_carpet', 'brown_carpet', 'green_carpet'].slice(0, n).map(id => [id, 1])
const CA = { x: 702, y: 120, z: 700 }                 // the town chest (2 east of home)
const CA2 = { x: 702, y: 120, z: 701 }                // its partner in the double-chest scene
const BAR = { x: 697, y: 120, z: 703 }                // a town barrel (C)
const FAR = { x: 733, y: 120, z: 700 }                // a chest 33 from home: outside town (STORAGE_NEAR 16)
const BAG = [['cobblestone', 64], ['cobblestone', 30], ['oak_log', 20], PICK]
const SPEC = {
  // A: town at 250 -> no cobble moves (at_cap), the logs go
  'A': { bag: BAG, boxes: [{ at: CA, items: cob(250) }], steps: [{ queue: 'deposit' }] },
  // B: town at 100 -> the 30 goes, town 100 -> 130
  'B': { bag: BAG, boxes: [{ at: CA, items: cob(100) }], steps: [{ queue: 'deposit' }] },
  // B2: B with the town chest DOUBLE (100 in the 700 half)
  'B2': { bag: BAG, boxes: [{ at: CA, block: 'chest[facing=west,type=right]', items: cob(100) }, { at: CA2, block: 'chest[facing=west,type=left]', items: [] }], steps: [{ queue: 'deposit' }] },
  // Bd: B with cobbled_deepslate 30 as the surplus stack
  'Bd': { bag: [['cobblestone', 64], ['cobbled_deepslate', 30], ['oak_log', 20], PICK], boxes: [{ at: CA, items: cob(100) }], steps: [{ queue: 'deposit' }] },
  // C: town chest at 10 + a town BARREL never opened (empty ledger) -> _cobble_reconcile counted>=1, the barrel opened, the 30 banked
  'C': { bag: BAG, boxes: [{ at: CA, items: cob(10) }, { at: BAR, block: 'barrel[facing=up]', items: [] }], steps: [{ queue: 'deposit' }] },
  // D: the town chest is counted first (deposit oak_log, in town); then the bot is 31 from home beside a chest 33 from
  //    home (outside town), oak_log given again, plain deposit -> no cobble into it (outside=1), the logs still banked
  'D': { bag: BAG, boxes: [{ at: CA, items: cob(10) }, { at: FAR, items: [] }],
    steps: [{ queue: 'deposit oak_log' }, { pre: [`tp ${NAME} 731.5 120 700.5`, `give ${NAME} minecraft:oak_log 20`], settleMs: 3000, queue: 'deposit' }] },
  // E: town at 250, counted by a first plain deposit (as A); then the model names it: `deposit cobblestone` -> admission refuses, the rule named
  'E': { bag: BAG, boxes: [{ at: CA, items: cob(250) }], steps: [{ queue: 'deposit' }, { queue: 'deposit cobblestone' }] },
  // R: RECONNECT. Process 1 deposits as in B (town 100 -> 130, the journal gets real records); it ends; a live claim of 30 from
  //    THAT process (its inst and world copied from the journal) is appended, as a crashed transfer would leave it; process 2
  //    logs in, is given cobblestone 30 + oak_log 20 again, and deposits -> the first read voids the claim, the chest is
  //    recounted, then the 30 banks (town 130 -> 160)
  'R': { bag: BAG, boxes: [{ at: CA, items: cob(100) }],
    steps: [{ queue: 'deposit' }, { restart: true, claimN: 30, pre: [`give ${NAME} minecraft:cobblestone 30`, `give ${NAME} minecraft:oak_log 20`], settleMs: 3000, queue: 'deposit' }] },
  // TD (the 92bc84f variant, town_deposit): town at 220; bag 34/36 with cobblestone 64 (+ the stockpile reserve) + cobblestone 20 +
  //    cobbled_deepslate 30 -> exactly one stack goes (240 or 250, never 270), _town_deposit carries `cobble_cap 1/0/0`
  'TD': { bag: [PICK, ['cobblestone', 64], ['cobblestone', 20], ['cobbled_deepslate', 30], ...wool(30)], boxes: [{ at: CA, items: cob(220) }], steps: [{ watch: 'town_deposit' }] },
  // TDp: TD with the town counted FIRST (33 slots + oak_log 5: `deposit oak_log` reconciles), then three wool to 34+ -> the order
  'TDp': { bag: [PICK, ['cobblestone', 64], ['cobblestone', 20], ['cobbled_deepslate', 30], ['oak_log', 5], ...wool(28)], boxes: [{ at: CA, items: cob(220) }],
    steps: [{ queue: 'deposit oak_log' }, { pre: [`give ${NAME} minecraft:red_carpet 1`, `give ${NAME} minecraft:black_carpet 1`, `give ${NAME} minecraft:white_bed 1`], settleMs: 1000, watch: 'town_deposit' }] },
}
const WINDOW_MS = 200000   // the deposit's watchdog is 180 s
const TD_WINDOW_MS = 100000
function arenaCmds () {
  return ['kill @e[type=!player,x=718,y=120,z=700,distance=..45]',
    'fill 688 120 688 748 130 712 minecraft:air', 'fill 688 119 688 748 119 712 minecraft:stone', 'setblock 696 120 696 minecraft:composter']
}
const itemArg = (id, dmg) => `minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''}`
function boxCmds (spec) {
  const c = []
  for (const b of spec.boxes) {
    c.push(`setblock ${at(b.at)} minecraft:${b.block ?? 'chest[facing=west]'}`)
    b.items.forEach(([id, n, dmg], s) => c.push(`item replace block ${at(b.at)} container.${s} with ${itemArg(id, dmg)} ${n}`))
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
  return { id, count }
}
let BOXES = []
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  for (const b of BOXES) for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(b.at)} Items[{Slot:${s}b}]`)
  cmds.push('execute as @e[type=item,x=718,y=120,z=700,distance=..45] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Pos`)
  const r = rcon(...cmds)
  const bag = {}; const boxes = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) bag[s] = it }
  BOXES.forEach((b, ci) => { const o = {}; for (let s = 0; s < 27; s++) { const q = r[36 + ci * 27 + s]; const it = /has the following block data/.test(q?.reply || '') ? parseItem(q.reply) : null; if (it) o[s] = it } boxes[at(b.at)] = o })
  const base = 36 + BOXES.length * 27
  const ground = (r[base]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  const posR = r[base + 1]?.reply || ''
  const pos = ((posR.match(/\[([^\]]+)\]/) || [])[1] || '').replace(/d/g, '')
  return { bag, boxes, ground, pos, online: /has the following entity data/.test(posR), bagUsed: Object.keys(bag).length }
}
const tot = list => { const t = {}; for (const it of list) t[it.id] = (t[it.id] || 0) + it.count; return t }
const totals = snap => ({ bag: tot(Object.values(snap.bag)), boxes: tot(Object.values(snap.boxes).flatMap(o => Object.values(o))), ground: tot(snap.ground) })
const all = t => { const o = {}; for (const part of Object.values(t)) for (const [k, n] of Object.entries(part)) o[k] = (o[k] || 0) + n; return o }
const diff = (a, b) => Object.keys({ ...a, ...b }).map(n => [n, (b[n] || 0) - (a[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
const COB = /^(cobblestone|cobbled_deepslate)$/
const cobbleSlots = slots => Object.entries(slots).filter(([, it]) => COB.test(it.id)).map(([s, it]) => `${s}:${it.id === 'cobbled_deepslate' ? 'cd' : 'c'}${it.count}`).join(',') || '-'
const cobbleIn = slots => Object.values(slots).reduce((t, it) => t + (COB.test(it.id) ? it.count : 0), 0)
const contents = slots => { const t = tot(Object.values(slots)); return Object.entries(t).map(([k, n]) => `${k}x${n}`).join(',') || 'empty' }

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const NOISE = /^(_affordance_scan|_progress_restored|_reach_probe|_path_reset)$/
function skillRows (file) {
  return lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill && !NOISE.test(r.skill.name))
    .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, trigger: r.trigger, ms: r.skill.duration_ms, fail: r.skill.fail_class,
      detail: String(r.skill.detail || '').slice(0, 700) }))
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
const shaOf = root => { try { return fs.readFileSync(path.join(root, '.sha'), 'utf8').trim() } catch { return 'unknown' } }

async function runTrial (scene, k) {
  const spec = SPEC[scene]
  BOXES = spec.boxes
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/cobble-cap-ab/${tag}`
  const skillLog = `${R}/sandbox/log/cobble-cap-ab/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.ccab-${ARM}`
  const pool = `sbxccab-${tag}`
  const stateRel = `./sandbox/state/cobble-cap-ab-${tag}`
  const poolDir = path.join(R, 'sandbox/state', `_pool-${pool}`)
  const ledgerPreexisting = fs.existsSync(poolDir)
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', stateRel); set('MEMORY_POOL', pool)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000)
  set('STUCK_SECONDS', 20)   // the fleet's value
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainQueue = []; brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  const launch = async () => {
    const n0 = lines(botOut).filter(l => /spawned pos=/.test(l)).length
    bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
    if (!await waitFor(() => lines(botOut).filter(l => /spawned pos=/.test(l)).length > n0, 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  }
  const journalPath = path.join(poolDir, 'town-chest-700_120_700.cobble.jsonl')
  await launch()
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`, `effect clear ${NAME}`)
  await sleep(3000)
  const built = [...rcon(...arenaCmds()), ...rcon(...bagCmds(spec)), ...rcon(...boxCmds(spec))]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected/i.test(x.reply) && !/^kill /.test(x.cmd))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  await sleep(2500)
  const before = snapshot()
  const t0 = Date.now()
  const marks = { ledgerPreexisting, steps: [] }
  const mids = []
  for (const st of spec.steps) {
    const m = { ...st, pre: undefined }
    if (st.restart) {
      // THE RECONNECT (R): the bot process ends; a claim from THAT (previous) process is appended to the journal -- its inst
      // and world copied from the journal's own last record -- as a transfer that crashed would leave it; a new process logs in.
      await stopBot()
      const recs = lines(journalPath).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      const last = [...recs].reverse().find(x => x.inst && 'w' in x)
      const keys = [...recs].reverse().find(x => Array.isArray(x.keys))?.keys ?? [`${BOXES[0].at.x},${BOXES[0].at.y},${BOXES[0].at.z}`]
      const claim = !last ? null :{ inst: last.inst, t: 'claim', id: `sbxR-${Date.now()}`, k: `${BOXES[0].at.x},${BOXES[0].at.y},${BOXES[0].at.z}`, n: st.claimN ?? 30, at: Date.now(),
        bot: NAME, keys, coverage: true, gone: [], w: last.w }
      if (claim) fs.appendFileSync(journalPath, '\n' + JSON.stringify(claim) + '\n')
      m.injected = claim ?? 'no journal (control build): nothing injected'
      await sleep(2000)
      await launch()
      rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`)
      await sleep(3000)
      m.respawned = true
    }
    if (st.pre) { m.preReplies = rcon(...st.pre).map(x => x.reply.slice(0, 80)); await sleep(st.settleMs ?? 1000) }
    if (st.queue) {
      const verb = st.queue.split(/\s+/)[0]
      const n0 = endedCount(botOut, verb); const tq = Date.now()
      brainQueue.push(st.queue)
      m.ended = !!await waitFor(() => endedCount(botOut, verb) > n0, WINDOW_MS)
      m.ms = Date.now() - tq
    } else if (st.watch === 'town_deposit') {
      const tq = Date.now()
      m.started = !!await waitFor(() => skillRows(skillLog).some(r => r.name === '_town_deposit') || lines(botOut).some(l => /town_deposit/.test(l)), TD_WINDOW_MS)
      if (m.started) m.ended = !!await waitFor(() => lines(botOut).some(l => /skill town_deposit ->/.test(l)) || skillRows(skillLog).some(r => r.name === '_town_deposit'), 120000)
      await sleep(20000)   // one per stay: a second order would show here
      m.orders = lines(botOut).filter(l => /skill town_deposit ->/.test(l)).length
      m.ms = Date.now() - tq
    }
    marks.steps.push(m)
    await sleep(1500)
    mids.push(snapshot())
  }
  const after = mids[mids.length - 1] ?? snapshot()
  const rows = skillRows(skillLog)
  await stopBot()
  await sleep(1500)
  const afterLogout = snapshot()
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  let ledger = null
  try { ledger = Object.fromEntries(fs.readdirSync(poolDir).filter(f => /cobble/.test(f)).map(f => [f, /\.jsonl$/.test(f) ? lines(path.join(poolDir, f)) : fs.readFileSync(path.join(poolDir, f), 'utf8').slice(0, 2000)])) } catch { ledger = null }
  const tr = traceEv(trace).filter(e => e.ts >= t0)
  const tb = totals(before), ta = totals(after), tl = totals(afterLogout)
  const rejected = lines(botOut).filter(l => /rejected why=/.test(l)).map(l => l.slice(0, 400))
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: shaOf(BOT_ROOT), marks, windowMs: Date.now() - t0,
    before: { ...before, totals: tb }, mids: mids.map(s => ({ bag: s.bag, boxes: s.boxes, ground: s.ground, pos: s.pos })), after: { ...after, totals: ta },
    afterLogout: { boxes: afterLogout.boxes, ground: afterLogout.ground, totals: { boxes: tl.boxes, ground: tl.ground } },
    conserved: diff(all(tb), all(ta)) || 'yes', ledger, rejected,
    rows: rows.filter(x => /deposit|cobble|_town|chest|withdraw|compost|_pickups|_death|reflex|_stuck|cursor|unsettled|reconcile/.test(x.name)),
    trace: { clicks: tr.filter(e => e.pkt === 'click').map(e => ({ t: e.ts - t0, win: e.win, slot: e.slot, mode: e.mode, btn: e.btn })),
      opens: tr.filter(e => /open_window/.test(e.pkt)).map(e => ({ t: e.ts - t0, pkt: e.pkt })), places: tr.filter(e => e.pkt === 'block_place').map(e => ({ t: e.ts - t0, loc: e.loc })) },
    out: lines(botOut).filter(l => /deposit|cobble|rejected|spawned|work_order/i.test(l)).map(l => l.slice(0, 300)).slice(-40) }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const pick = re => rows.filter(x => re.test(x.name)).map(x => `${x.name}:${x.status}${x.fail ? '/' + x.fail : ''}:${x.detail}`).join('\n      ') || '-'
  const boxLine = snap => Object.entries(snap.boxes).map(([k2, o]) => `[${k2}] cobble=${cobbleIn(o)} ${contents(o)}`).join(' ; ')
  console.log(`${r.id} sha=${r.sha} steps=${JSON.stringify(marks.steps.map(s => ({ q: s.queue ?? s.watch, ended: s.ended, started: s.started, orders: s.orders, ms: s.ms })))}\n` +
    `  bag cobble/slot ${cobbleSlots(before.bag)} -> ${cobbleSlots(after.bag)} | bag after ${contents(after.bag)}\n` +
    `  boxes before ${boxLine(before)}\n  boxes after  ${boxLine(after)}\n` +
    `  d(bag){${diff(tb.bag, ta.bag)}} d(boxes){${diff(tb.boxes, ta.boxes)}} ground[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] logout-ground[${afterLogout.ground.map(g => g.id + 'x' + g.count).join(',')}] conserved=${r.conserved} clicks=${r.trace.clicks.length} places=${r.trace.places.length}\n` +
    `  deposit: ${pick(/^deposit$/)}\n  cobble: ${pick(/cobble/)}\n  town_deposit: ${pick(/^_?town_deposit$/)}\n  rejected: ${rejected.join(' || ') || '-'}\n` +
    `  journal files: ${ledger ? Object.keys(ledger).join(', ') : '-'}\n` +
    `  journal tail:\n      ${(Object.entries(ledger ?? {}).find(([f]) => /\.jsonl$/.test(f))?.[1] ?? []).slice(-10).map(l => l.slice(0, 420)).join('\n      ') || '-'}`)
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
  try { fs.unlinkSync(`${R}/sandbox/.env.ccab-${ARM}`) } catch {}
  try { rcon(...arenaCmds().slice(0, 3)) } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
