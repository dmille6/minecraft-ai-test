// SANDBOX-ONLY grid-clear A/B driver (craftsync grid fix, gf-on-1918bb5; derived from bamboo-ab.cjs / tools-ab.cjs).
// ONE FRESH BOT PER TRIAL from <botRoot> (unmodified; trace.cjs only observes packets), the scene built by RCON after
// the bot is there, the model's `craft` verb QUEUED through the brain embedded in this process (a trial is two node
// processes: this driver and the bot), an abort fired at a measured moment of the craft (the first craft click in the
// trace), then the server's truth.
//
// THE ORACLE. The 2x2 grid (window-0 slots 1-4) and the cursor are NOT in the player's Inventory NBT, so RCON cannot
// read them while the bot is online. They are read two ways, both from the server:
//   conservation  the bag's ingredient total in ingredient units (planks + sticks/2 for the stick recipe) before vs
//                 after: a deficit is what sits in the grid or on the cursor (or on the ground)
//   logout        Paper drops a DISCONNECTED player's grid + cursor (InventoryMenu.removed -> clearContainer): the
//                 item entities after the bot logs out are exactly what the grid/cursor held
//
//   node grid-ab.cjs <arm> <botRoot> <reps> <scene,scene,...> [server]
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node grid-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = process.env.CRAFT_TRACE_DIR || __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Grid'
const OUTDIR = `${R}/sandbox/log/grid-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-gridab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- scenes
// SMOOTH_STONE floor at y 119, air above, the bot at 700.5 120 700.5; a crafting table at 702 120 700 when `table`.
const STAND = { x: 700.5, y: 120, z: 700.5 }
const ROCKS = ['andesite', 'diorite', 'granite', 'calcite']
const LONG = ['craft 64 stick']   // 16 executions of the 2x2 stick recipe in ONE bot.craft (craftsFor): ~20 s of clicks
const SPEC = {
  // (a) ABORT AFTER THE FIRST CLICKS: the low_health reflex interrupts the skill (runner.interrupt) 1.5 s after the
  // first craft click -- `damage` 14 takes health 20 -> 6 (FLEE_BELOW_HEALTH 8)
  int: { slots: [['oak_planks', 64]], fill: 20, queue: LONG, abort: { kind: 'damage', afterFirstClickMs: 1500 } },
  // (a') the stuck watchdog (STUCK_SECONDS=5): a stationary craft is interrupted at ~5 s
  stuck: { slots: [['oak_planks', 64]], fill: 20, queue: LONG, env: { STUCK_SECONDS: 5 } },
  // (b) abort, then DISCONNECT at once (RCON kick as the craft row lands): what reaches the ground (the bag has room)
  kick: { slots: [['oak_planks', 64]], fill: 20, queue: LONG, abort: { kind: 'damage', afterFirstClickMs: 1500 }, kickOnEnd: true },
  // (c) REFLEX PREEMPTION: the hunger effect drops food below EAT_BELOW_FOOD (16) mid-craft; the hunger reflex's
  // bot.equip(bread) is a guarded inventory action, which preempts the craft
  // (no saturation at setup: saturation is drained before food, and food must fall below 16 within ~4 s). The sandbox
  // runs PEACEFUL, where food never drops: the scene sets `difficulty easy` for the trial and restores peaceful after it
  pre: { slots: [['oak_planks', 64], ['bread', 16]], fill: 20, queue: LONG, noSaturation: true, abort: { kind: 'hunger', afterFirstClickMs: 500 } },
  // the same aborts 300 ms after the first click: inside the FIRST execution, while its stack is still on the cursor
  int3: { slots: [['oak_planks', 64]], fill: 20, queue: LONG, abort: { kind: 'damage', afterFirstClickMs: 300 } },
  kick3: { slots: [['oak_planks', 64]], fill: 20, queue: LONG, abort: { kind: 'damage', afterFirstClickMs: 300 }, kickOnEnd: true },
  full3: { slots: [['oak_planks', 64], ['stick', 4]], fill: 36, queue: LONG, abort: { kind: 'damage', afterFirstClickMs: 300 } },
  // the stuck watchdog lands MID-CLICK (2-3 clicks into an execution, measured): the cases above often land after an
  // execution's clicks or inside its verification. (b) and (e) again with it:
  kickst: { slots: [['oak_planks', 64]], fill: 20, queue: LONG, env: { STUCK_SECONDS: 5 }, kickOnEnd: true },
  fullst: { slots: [['oak_planks', 64], ['stick', 4]], fill: 36, queue: LONG, env: { STUCK_SECONDS: 5 } },
  // 36/36 and the feathers: one of them takes the planks' slot the moment its stack rides the cursor
  fullpst: { slots: [['oak_planks', 64], ['stick', 4]], fill: 36, queue: LONG, env: { STUCK_SECONDS: 5 }, feathersAtFirstClick: 3 },
  // (d) ORDINARY CRAFTS, nothing aborted: five 2x2 and five table crafts in one session (different args each time, so
  // no two consecutive decisions are identical)
  ok: { slots: [['oak_planks', 64], ['stick', 16]], fill: 20, table: true,
        queue: ['craft 4 stick', 'craft 1 wooden_pickaxe', 'craft 1 oak_pressure_plate', 'craft 1 wooden_axe', 'craft 1 oak_button',
                'craft 1 wooden_shovel', 'craft 1 crafting_table', 'craft 1 wooden_sword', 'craft 8 stick', 'craft 1 wooden_hoe'] },
  // (e) FULL BAG (36/36) abort: the sticks merge into a stack with room, so the craft is admitted at 36/36
  full: { slots: [['oak_planks', 64], ['stick', 4]], fill: 36, queue: LONG, abort: { kind: 'damage', afterFirstClickMs: 1500 } },
  // (e') as full, and three feathers (PickupDelay 0) at the feet at the first click: any slot the craft empties (the
  // planks' slot while its stack rides the cursor) fills, so the grid + cursor have no room to come back to
  fullp: { slots: [['oak_planks', 64], ['stick', 4]], fill: 36, queue: LONG, feathersAtFirstClick: 3, abort: { kind: 'damage', afterFirstClickMs: 1500 } },
}
// the stick recipe's conservation unit: one plank = one unit, one stick = half a unit (2 planks -> 4 sticks)
const units = t => (t.oak_planks || 0) + (t.stick || 0) / 2
function arenaCmds (spec) {
  const c = ['kill @e[type=!player,x=700,y=120,z=700,distance=..30]',
    'fill 690 120 690 712 130 712 minecraft:air', 'fill 690 119 690 712 119 712 minecraft:smooth_stone']
  if (spec.table) c.push('setblock 702 120 700 minecraft:crafting_table')
  return c
}
function bagCmds (spec) {
  const c = [`clear ${NAME}`, `effect clear ${NAME}`, `effect give ${NAME} minecraft:instant_health 1 5 true`,
    ...(spec.noSaturation ? [] : [`effect give ${NAME} minecraft:saturation 1 20 true`]), `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`]
  let s = 0
  for (const [id, n] of spec.slots || []) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id} ${n}`)
  while (s < (spec.fill || 0) && s < 36) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${ROCKS[s % ROCKS.length]} 64`)
  return c
}

// ---------------------------------------------------------------- oracle
const parseItem = seg => {
  const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]
  if (!id) return null
  const count = +((seg.match(/count: (\d+)/) || [])[1] || 1)
  return { id, count }
}
const groundNow = () => (rcon('execute as @e[type=item,x=700,y=120,z=700,distance=..20] run data get entity @s Item')[0]?.reply || '')
  .split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  cmds.push('execute as @e[type=item,x=700,y=120,z=700,distance=..20] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Health`, `data get entity ${NAME} foodLevel`)
  const r = rcon(...cmds)
  const slots = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) slots[s] = it }
  const ground = (r[36]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  const num = x => Number(((x?.reply || '').match(/data: ([\d.]+)/) || [])[1])
  return { slots, used: Object.keys(slots).length, ground, health: num(r[37]), food: num(r[38]) }
}
const totals = snap => { const t = {}; for (const it of Object.values(snap.slots)) t[it.id] = (t[it.id] || 0) + it.count; return t }
const sumGround = g => { const t = {}; for (const it of g) t[it.id] = (t[it.id] || 0) + it.count; return t }

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const NOISE = /^(_affordance_scan|_progress_restored)$/
function skillRows (file) {
  return lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill && !NOISE.test(r.skill.name))
    .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, ms: r.skill.duration_ms, fail: r.skill.fail_class,
                 detail: String(r.skill.detail || '').slice(0, 400), args: /^_(craft_sync|click_)/.test(r.skill.name) ? r.skill.args : undefined }))
}
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE QUEUE BRAIN, IN THIS PROCESS: each decision gets the next queued line, else 'status'.
let brainQueue = []; let brainLog = null
const parse = line => {
  const [skill, ...rest] = line.split(/\s+/); const args = {}
  if (skill === 'craft' && rest.length === 2) { args.count = +rest[0]; args.item = rest[1] } else if (rest.length === 1) args.item = rest[0]
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
  if (!spec) throw new Error(`unknown scene ${scene}`)
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const skillLog = `${OUTDIR}/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.grid-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', `./sandbox/log/grid-ab/${tag}`); set('STATE_DIR', `./sandbox/state/grid-ab-${tag}`); set('MEMORY_POOL', `sbxgrid-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, Math.floor(STAND[a.toLowerCase()])); set(`BOARD_${a}`, Math.floor(STAND[a.toLowerCase()])) }
  for (const [key, v] of Object.entries(spec.env || {})) set(key, v)
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainQueue = []; brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`)
  await sleep(3000)
  const built = rcon(...arenaCmds(spec))
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect/i.test(x.reply))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  rcon(...bagCmds(spec))
  await sleep(2500)
  const before = snapshot()
  const t0 = Date.now()
  brainQueue = [...spec.queue]
  const crafts = spec.queue.length
  const endPat = /skill craft ->/
  const ends = () => lines(botOut).filter(l => endPat.test(l)).length
  const endsBefore = ends()
  // the first CRAFT click: a window_click that is not a resync (-999) and not a clone probe (mode 3)
  const firstClick = () => { const e = lines(trace).map(l => { try { return JSON.parse(l) } catch { return null } }).find(e => e && e.ts >= t0 && e.pkt === 'click' && e.slot !== -999 && e.mode !== 3); return e ? e.ts : null }
  let fired = null, feathers = null, kicked = null
  if (spec.abort || spec.feathersAtFirstClick) {
    const fc = await waitFor(firstClick, 60000, 50)
    if (fc && spec.feathersAtFirstClick) {
      const t = Date.now()
      const g = rcon(...Array.from({ length: spec.feathersAtFirstClick }, () => `summon minecraft:item ${STAND.x} ${STAND.y + 0.1} ${STAND.z} {Item:{id:"minecraft:feather",count:1},PickupDelay:0s}`))
      feathers = { atMs: t - t0, sinceFirstClickMs: t - fc, reply: g.map(x => (x.reply || '').trim()).join(' | ') }
    }
    if (fc && spec.abort) {
      const wait = fc + spec.abort.afterFirstClickMs - Date.now()
      if (wait > 0) await sleep(wait)
      const t = Date.now()
      const g = spec.abort.kind === 'damage'
        ? rcon(`damage ${NAME} 14 minecraft:generic`, `data get entity ${NAME} Health`)
        : rcon('difficulty easy', `effect give ${NAME} minecraft:hunger 20 127 true`, `data get entity ${NAME} foodLevel`)
      fired = { kind: spec.abort.kind, atMs: t - t0, sinceFirstClickMs: t - fc, firstClickMs: fc - t0, reply: g.map(x => (x.reply || '').trim()).join(' | ') }
    }
  }
  // every queued craft decision ends with its own skill line (a refusal too)
  const ended = await waitFor(() => ends() - endsBefore >= crafts, 60000 + crafts * 30000)
  if (spec.kickOnEnd) {
    const t = Date.now(); rcon(`kick ${NAME} grid-ab disconnect after the abort`)
    kicked = { atMs: t - t0 }
    await sleep(2000)
    kicked.ground = groundNow()
    // the bot reconnects (RECONNECT_DELAY_MS): read its bag once it is back
    await waitFor(() => /There are 1 of/.test(rcon('list')[0].reply), 40000, 1000)
    await sleep(3000)
  }
  if (spec.abort?.kind === 'hunger') rcon(`effect clear ${NAME}`, 'difficulty peaceful')
  await sleep(1500)
  const after = snapshot()
  await sleep(6000)
  const later = snapshot()   // 6 s on: does anything the grid/cursor held come back by itself?
  const rows = skillRows(skillLog)
  const groundBeforeLogout = later.ground
  await stopBot()
  await sleep(1500)
  const groundAfterLogout = groundNow()
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = lines(trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(e => e && e.ts >= t0)
  const sync = rows.filter(r => r.name === '_craft_sync')
  const tb = totals(before); const ta = totals(after); const tl = totals(later)
  const gA = sumGround(groundAfterLogout); const gB = sumGround(groundBeforeLogout)
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    ended: !!ended, fired, feathers, kicked,
    decisions: lines(botOut).filter(l => /LLM -> /.test(l)).map(l => l.replace(/^\S+\s+/, '').slice(0, 140)).slice(0, 16),
    before: { used: before.used, totals: tb, ground: before.ground, health: before.health, food: before.food },
    after: { used: after.used, totals: ta, ground: after.ground, health: after.health, food: after.food },
    later: { used: later.used, totals: tl, ground: later.ground },
    groundAfterLogout,
    // planks units: before, after (online), the deficit (in the grid/cursor or on the ground), what logout dropped
    units: { before: units(tb), after: units(ta), later: units(tl), deficitOnline: units(tb) - units(tl), groundOnline: units(gB), groundAfterLogout: units(gA) - units(gB) },
    crafts: rows.filter(r => r.name === 'craft').map(r => ({ status: r.status, fail: r.fail, detail: r.detail.slice(0, 200) })),
    sync: sync.map(r => ({ status: r.status, outcome: r.args?.outcome, confirmed: r.args?.confirmed, grid_clear: r.args?.grid_clear, grid_residue: r.args?.grid_residue,
                           stop: r.args?.stop, preempted: r.args?.preempted, item: r.args?.item, produced: r.args?.produced, requested: r.args?.requested,
                           late: r.args?.late_clicks_dropped, inflight_at_release: r.args?.inflight_at_release, window_changes: r.args?.window_changes,
                           pre_invoke_refusals: r.args?.pre_invoke_refusals, bind_drops: r.args?.bind_drops, preempt_timeouts: r.args?.preempt_timeouts, detail: r.detail.slice(0, 300) })),
    clickRows: rows.filter(r => /^_click_/.test(r.name)),
    reflex: rows.filter(r => /^_reflex|reflex_/.test(r.name)).map(r => `${r.name}:${r.detail.slice(0, 60)}`),
    rows: rows.filter(r => !/^_(craft_sync|click_)/.test(r.name)).map(r => `${r.name}:${r.status}:${r.detail.slice(0, 120)}`).slice(0, 40),
    clicks: tr.filter(e => e.pkt === 'click').length, closes0: tr.filter(e => e.pkt === 'close_window_out' && e.win === 0).length,
    pickups: tr.filter(e => e.pkt === 'collect' && e.self).length, spawns: tr.filter(e => e.pkt === 'spawn_item').length }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const delta = Object.keys({ ...tb, ...tl }).map(n => [n, (tl[n] || 0) - (tb[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
  console.log(`${r.id.padEnd(14)} ended=${r.ended} fired=${fired ? fired.kind + '@+' + fired.sinceFirstClickMs : '-'} units ${r.units.before}->${r.units.later} deficit=${r.units.deficitOnline} ` +
    `logoutGround=${JSON.stringify(gA)} d{${delta}} | sync ${sync.map(s => `${s.args?.outcome}/${s.args?.grid_clear}`).join(',')} | crafts ${r.crafts.map(c => c.status).join(',')}`)
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
  try { fs.unlinkSync(`${R}/sandbox/.env.grid-${ARM}`) } catch {}
  try { rcon('difficulty peaceful', 'kill @e[type=!player,x=700,y=120,z=700,distance=..30]', 'fill 690 120 690 712 130 712 minecraft:air', 'fill 690 119 690 712 119 712 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
