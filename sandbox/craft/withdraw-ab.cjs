// SANDBOX-ONLY withdraw A/B driver (withdraw_pick, 10-05): ONE FRESH BOT PER TRIAL from <botRoot> (unmodified; trace.cjs
// only observes packets), the scene set by RCON once the bot is there, the town order WATCHED (withdraw_pick is a
// deterministic town order, composter.mjs townOrder -- nothing is queued for it), and the SERVER's truth before and
// after: every bag slot with its damage, every slot of the town chest, and the item entities on the ground.
// The control (the fleet build, no withdraw_pick order) gets the same scene, a watch window in which no order is
// expected, and then the model's own verb (`cmd`) queued through the embedded brain.
//
//   node withdraw-ab.cjs <arm: cand|ctrl> <botRoot> <reps> <scene,scene,...> [server]
//
// Town for the bot: within 48 of HOME (= the stand), a chest within 16 (the chest is 2 blocks east of the stand).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node withdraw-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Draw'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/withdraw-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-wdab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
// Stone floor at y 119, air above; the bot at 700.5 120 700.5 (= home); ONE single chest at 702 120 700.
// Durability is `damage` = max - uses left: stone tools 131 (damage 20 = 111 left; 125 = 6 left), wooden 59 (52 = 7 left).
const STAND = { x: 700.5, y: 120, z: 700.5 }
const HOME = { x: 700, y: 120, z: 700 }
const CHEST = { x: 702, y: 120, z: 700 }
const CH = `${CHEST.x} ${CHEST.y} ${CHEST.z}`
const stacks = (id, n) => Array.from({ length: n }, () => [id, 64])
const INGREDIENTS = [['cobblestone', 64], ['stick', 16], ['oak_planks', 16]]
const FULL_CHEST = [...stacks('diorite', 13), ['stone_pickaxe', 1, 20], ...stacks('diorite', 13)]   // 27/27, the pickaxe at slot 13
const FULL_BAG = [...stacks('stone', 20), ...stacks('andesite', 16)]                                  // 36/36; stone is what deposit banks
const SPEC = {
  // (a) no pickaxe in the bag (20/36), a usable stone_pickaxe (111 uses) in the chest among ingredients
  'pick': { bag: stacks('andesite', 20), chest: [...INGREDIENTS, ['stone_pickaxe', 1, 20]], cmd: 'withdraw stone_pickaxe' },
  // (b) no pickaxe anywhere; the chest holds cobblestone, sticks and planks (no crafting table near: planks are a deficit)
  'ingred': { bag: stacks('andesite', 20), chest: INGREDIENTS, cmd: 'withdraw stone_pickaxe' },
  // (c) 36/36 bag, 27/27 chest with ONE stone_pickaxe: the 3-click swap of a bankable bag stack (stone) for it
  'swap': { bag: FULL_BAG, chest: FULL_CHEST, cmd: 'withdraw stone_pickaxe' },
  // (d) only SPENT pickaxes in the chest (stone 6 uses, wooden 7 uses) + ingredients: never withdrawn
  'spent': { bag: stacks('andesite', 20), chest: [['stone_pickaxe', 1, 125], ['wooden_pickaxe', 1, 52], ...INGREDIENTS], cmd: 'withdraw stone_pickaxe' },
  // (e) the hold window: the ingredients scene plus coal (bankable), then a `deposit` queued the moment the order ends --
  //     what was withdrawn must stay. The control queues `withdraw 2 stick` and then the same deposit.
  'holdwin': { bag: [...stacks('andesite', 20), ['coal', 64]], chest: INGREDIENTS, cmd: 'withdraw 2 stick', then: 'deposit' },
  // (f1) a disconnect mid-transfer: the swap scene, the bot KICKED right after its first click into the chest window
  'kick': { bag: FULL_BAG, chest: FULL_CHEST, cmd: 'withdraw stone_pickaxe', kickAfterClick: true },
  // (f1b) the same, then 75 s after the reconnect: does a hold begun on the dead connection ever end?
  'kicklong': { bag: FULL_BAG, chest: FULL_CHEST, cmd: 'withdraw stone_pickaxe', kickAfterClick: true, postKickWaitMs: 75000 },
  // (f2) a held cursor, then room: the swap scene with feathers at the bot's feet (a full bag cannot pick them up; the
  //      slot click 1 empties can) -- the pickaxe then has nowhere to go and the window is HELD. After 70 s (hold mode:
  //      intervention_needed) one andesite slot is cleared by RCON: the hold must settle by itself, nothing dropped.
  'holdroom': { bag: FULL_BAG, chest: FULL_CHEST, cmd: 'withdraw stone_pickaxe', feathers: true, afterHold: 'room' },
  // (f3) the same hold, then a survival release (`damage` 2): the close is loaded and the bag is full -- what happens?
  'holdfull': { bag: FULL_BAG, chest: FULL_CHEST, cmd: 'withdraw stone_pickaxe', feathers: true, afterHold: 'damage' },
}
const WINDOW_MS = 100000        // the first town scan can wait TOWN_SCAN_MS (30 s) plus a decision's cadence
const CTRL_WINDOW_MS = 60000    // the control: no order is expected; then the model's verb
function arenaCmds () {
  return ['kill @e[type=!player,x=700,y=120,z=700,distance=..30]',
    'fill 688 120 688 712 130 712 minecraft:air', 'fill 688 119 688 712 119 712 minecraft:stone']
}
const itemArg = (id, dmg) => `minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''}`
function chestCmds (spec) {
  // The chest goes down LAST, filled in the same batch: an order scanning an EMPTY chest would record a town miss
  // (15 min) and never come back; one scanning before the bag is set would act on the previous trial's bag.
  return [`setblock ${CH} minecraft:chest[facing=west]`, ...spec.chest.map(([id, n, dmg], s) => `item replace block ${CH} container.${s} with ${itemArg(id, dmg)} ${n}`)]
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
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  for (let s = 0; s < 27; s++) cmds.push(`data get block ${CH} Items[{Slot:${s}b}]`)
  cmds.push('execute as @e[type=item,x=700,y=120,z=700,distance=..24] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Pos`)
  const r = rcon(...cmds)
  const bag = {}; const chest = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) bag[s] = it }
  for (let s = 0; s < 27; s++) { const it = /has the following block data/.test(r[36 + s]?.reply || '') ? parseItem(r[36 + s].reply) : null; if (it) chest[s] = it }
  const ground = (r[63]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  const posR = r[64]?.reply || ''
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
  (verb === 'withdraw_pick' && skillRows(skillLog).some(r => r.name === '_withdraw_pick'))

async function runTrial (scene, k) {
  const spec = SPEC[scene]
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/withdraw-ab/${tag}`
  const skillLog = `${R}/sandbox/log/withdraw-ab/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.wdab-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/withdraw-ab-${tag}`); set('MEMORY_POOL', `sbxwdab-${tag}`)
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
  if (spec.feathers) rcon(...[0, 1, 2].map(() => `summon minecraft:item ${STAND.x} 120.1 ${STAND.z} {Item:{id:"minecraft:feather",count:1},PickupDelay:0s}`))
  await sleep(2500)
  const before = snapshot()
  const t0 = Date.now()
  const marks = {}
  let started = null
  const kickOnClick = async (ms) => {
    const c = await waitFor(() => traceEv(trace).find(e => e.ts >= t0 && e.pkt === 'click' && e.win !== 0), ms, 15)
    if (!c) return
    const kt = Date.now(); const r = rcon(`kick ${NAME} sandbox withdraw interruption test`)
    marks.kick = { clickAtMs: c.ts - t0, kickAtMs: kt - t0, reply: (r[0]?.reply || '').slice(0, 80) }
  }
  if (ARM === 'cand') {
    // KICK: the first click into the chest window after the order starts (trace.cjs), then RCON kick at once.
    const kicker = spec.kickAfterClick ? kickOnClick(WINDOW_MS) : null
    started = await waitFor(() => skillRows(skillLog).some(r => r.name === 'withdraw_pick' || r.name === '_withdraw_pick') || lines(botOut).some(l => /withdraw_pick/.test(l)), WINDOW_MS)
    if (started) await waitFor(() => ended(botOut, skillLog, 'withdraw_pick'), 200000)
    if (kicker) { await kicker; if (marks.kick) { await waitFor(() => lines(botOut).filter(l => /spawned pos=/.test(l)).length >= 2, 60000, 500); await sleep(3000) } }
  } else {
    // THE CONTROL: no withdraw_pick order exists in this build; wait the window, then the model's verb.
    started = await waitFor(() => lines(botOut).some(l => /withdraw_pick/.test(l)), CTRL_WINDOW_MS)
    marks.order_on_control = !!started
    const tq = Date.now()
    brainQueue.push(spec.cmd)
    const verb = spec.cmd.split(/\s+/)[0]
    const kicker = spec.kickAfterClick ? kickOnClick(120000) : null
    await waitFor(() => ended(botOut, skillLog, verb), 120000)
    marks.verb = { cmd: spec.cmd, atMs: tq - t0 }
    if (kicker) { await kicker; if (marks.kick) { await waitFor(() => lines(botOut).filter(l => /spawned pos=/.test(l)).length >= 2, 60000, 500); await sleep(3000) } }
  }
  await sleep(1500)
  if (marks.kick && spec.postKickWaitMs) await sleep(spec.postKickWaitMs)
  const mid = snapshot()   // right after the order / verb (before any follow-up)
  if (spec.then) {
    const tq = Date.now(); brainQueue.push(spec.then)
    const done = await waitFor(() => ended(botOut, skillLog, spec.then), 120000)
    marks.then = { queued: spec.then, atMs: tq - t0, ended: !!done }
    await sleep(1500)
  }
  let holdSnap = null
  if (spec.afterHold) {
    const held = skillRows(skillLog).some(r => r.name === '_withdraw_pick' && /transfer_unsettled/.test(r.detail))
    marks.held = held
    if (held || ARM === 'ctrl') {
      await sleep(70000)                       // a full intervention interval in hold mode
      holdSnap = snapshot()
      if (spec.afterHold === 'room') {
        const slot = Object.entries(holdSnap.bag).find(([, it]) => it.id === 'andesite')?.[0]
        marks.room = { slot, reply: slot != null ? (rcon(`item replace entity ${NAME} container.${slot} with minecraft:air`)[0]?.reply || '').slice(0, 80) : 'no andesite slot' }
      } else {
        marks.damage = (rcon(`damage ${NAME} 2 minecraft:generic`)[0]?.reply || '').slice(0, 80)
      }
      await sleep(10000)
    }
  }
  const after = snapshot()
  const rows = skillRows(skillLog)
  await stopBot()
  await sleep(1500)
  const afterLogout = snapshot()   // the chest and the ground once the bot is gone (a cursor or grid stack drops at logout)
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = traceEv(trace).filter(e => e.ts >= t0)
  const tb = totals(before), tm = totals(mid), ta = totals(after), tl = totals(afterLogout)
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    started: !!started, marks, windowMs: Date.now() - t0,
    before: { ...before, totals: tb }, mid: { ...mid, totals: tm }, hold: holdSnap && { ...holdSnap, totals: totals(holdSnap) }, after: { ...after, totals: ta },
    afterLogout: { chest: afterLogout.chest, ground: afterLogout.ground, totals: { chest: tl.chest, ground: tl.ground } },
    conserved: diff(all(tb), all(ta)) || 'yes',
    rows: rows.filter(x => /withdraw|deposit|click_|_undefined|craft_sync|_work_order|_town|unsettled|_pickups|_death|reflex|_stuck/.test(x.name)),
    trace: { clicks: tr.filter(e => e.pkt === 'click').map(e => ({ t: e.ts - t0, win: e.win, slot: e.slot, mode: e.mode, btn: e.btn })),
      closes: tr.filter(e => /close_window/.test(e.pkt)).map(e => ({ t: e.ts - t0, pkt: e.pkt, win: e.win })),
      pickups: tr.filter(e => e.pkt === 'collect' && e.self).map(e => ({ t: e.ts - t0, n: e.n })), spawns: tr.filter(e => e.pkt === 'spawn_item').map(e => ({ t: e.ts - t0, x: e.x, y: e.y, z: e.z })) },
    out: lines(botOut).filter(l => /withdraw|deposit|rejected|inventory held|kick|spawned|release|unsettled/i.test(l)).map(l => l.slice(0, 300)).slice(-40) }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const wp = rows.filter(x => x.name === '_withdraw_pick').map(x => `${x.status}:${x.detail.slice(0, 170)}`).join(' || ')
  const ws = rows.filter(x => x.name === '_withdraw_settled').map(x => (x.detail.match(/how=\S+/) || [''])[0]).join(',')
  const verbRow = rows.filter(x => x.name === 'withdraw' || x.name === 'deposit').map(x => `${x.name}:${x.status}:${x.detail.slice(0, 120)}`).join(' || ')
  console.log(`${r.id.padEnd(18)} order=${r.started} bag ${before.bagUsed}->${after.bagUsed} chest ${before.chestUsed}->${after.chestUsed} picks bag[${picks(before.bag)}]->[${picks(after.bag)}] chest[${picks(before.chest)}]->[${picks(after.chest)}]` +
    ` d(bag){${diff(tb.bag, ta.bag)}} d(chest){${diff(tb.chest, ta.chest)}} ground[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] logout-ground[${afterLogout.ground.map(g => g.id + 'x' + g.count).join(',')}] conserved=${r.conserved}` +
    ` settled[${ws}] marks=${JSON.stringify(marks)} | ${wp} | ${verbRow}`)
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
  try { fs.unlinkSync(`${R}/sandbox/.env.wdab-${ARM}`) } catch {}
  try { rcon('kill @e[type=!player,x=700,y=120,z=700,distance=..30]', 'fill 688 120 688 712 130 712 minecraft:air', 'fill 688 119 688 712 119 712 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
