// SANDBOX-ONLY toolkit-01 A/B driver (10-15): ONE FRESH BOT PER TRIAL from <botRoot> (unmodified; trace.cjs only observes
// packets), the scene set by RCON once the bot is there, and the SERVER's truth before and after (every bag slot with its
// damage, the town chest, the item entities on the ground). Built on orderroom-ab.cjs.
//
//   node toolkit-ab.cjs <arm: cand|ctrl> <botRoot> <reps> <scene,...> [server]      (ARM_SHA=<label> for the results)
//
// Scenes (town = home 700 120 700, chest 2 east, a table beside the stand, a composter so no town build fires; the bags
// carry no wood, so neither the composter nor the junk well build can fire either):
//   spare      AWAY from town (home 160 east): 36/36 with iron_pickaxe (200 uses), stone_pickaxe 90, three stone_pickaxe at
//              1 use, wool; stone walls to wear on. cand: wear_out destroys the three 1-use copies (iron + the 90 stay);
//              ctrl: the deployed rule keeps all three (SPENT_PICKAXES_KEPT).
//   kitgather  AT town, a light bag (iron + stone pickaxes, cobble, dirt), the chest holds 20 iron_ingot + 64 sticks. cand:
//              the toolkit draws 4 ingots + the sticks and crafts an iron axe and an iron shovel; then the model is given
//              `gather oak_log 3` and `gather dirt 3` at a stand of logs and dirt 22 east (outside any town square):
//              the server's damage on the new axe and shovel says which tool dug. ctrl: no draw, the hand digs.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node toolkit-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Kit'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/toolkit-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = Number(process.env.TK_BRAIN_PORT || 11497)
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-tkab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
const TOWN = { x: 700, y: 120, z: 700 }
const CHEST = { x: 702, y: 120, z: 700 }
const TOWN_TABLE = { x: 699, y: 120, z: 702 }
const COMPOSTER = { x: 697, y: 120, z: 697 }
const WILD = { x: 860, y: 120, z: 700 }          // far from every home: no town order
const at = c => `${c.x} ${c.y} ${c.z}`
const wool = n => Array.from({ length: n }, (_, i) => ['white_wool', 1 + (i % 3)])
// damage = max - uses: iron_pickaxe 250, stone_pickaxe 131
const SPARE_BAG = [['iron_pickaxe', 1, 50], ['stone_pickaxe', 1, 41], ['stone_pickaxe', 1, 130], ['stone_pickaxe', 1, 130], ['stone_pickaxe', 1, 130],
  ['cobblestone', 64], ...wool(30)]
const KIT_BAG = [['iron_pickaxe', 1, 50], ['stone_pickaxe', 1, 41], ['cobblestone', 64], ['dirt', 8], ['torch', 8]]
const SPEC = {
  spare: { bag: SPARE_BAG, stand: { x: WILD.x + 0.5, y: 120, z: WILD.z + 0.5 }, home: { x: WILD.x + 160, y: 120, z: WILD.z }, window: 150000 },
  kitgather: { bag: KIT_BAG, stand: { x: TOWN.x + 0.5, y: 120, z: TOWN.z + 0.5 }, home: TOWN, window: 360000,
               chest: [['iron_ingot', 20], ['stick', 64]], queue: [{ skill: 'gather', args: { block: 'oak_log', count: 3 } }, { skill: 'gather', args: { block: 'dirt', count: 3 } }] },
}
function arenaCmds () {
  return ['forceload add 684 684 876 716', 'kill @e[type=!player,x=780,y=120,z=700,distance=..100]',
    // two regions (a fill is capped at 32,768 blocks): the town + gather stand, and the wild stand
    'fill 684 120 684 730 128 716 minecraft:air', 'fill 684 119 684 730 119 716 minecraft:stone',
    'fill 840 120 684 876 128 716 minecraft:air', 'fill 840 119 684 876 119 716 minecraft:stone',
    `setblock ${at(TOWN_TABLE)} minecraft:crafting_table`, `setblock ${at(COMPOSTER)} minecraft:composter`,
    // the gather stand, 22 east of town (outside a 33-wide town square): a 3-log trunk and a dirt patch
    'fill 722 120 703 722 122 703 minecraft:oak_log', 'fill 722 120 697 724 120 699 minecraft:dirt',
    // wear walls beside the wild stand
    `fill ${WILD.x - 1} 120 ${WILD.z + 1} ${WILD.x + 1} 121 ${WILD.z + 1} minecraft:stone`,
    `fill ${WILD.x - 1} 120 ${WILD.z - 1} ${WILD.x + 1} 121 ${WILD.z - 1} minecraft:stone`]
}
const itemArg = (id, dmg) => `minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''}`
function bagCmds (spec) {
  const c = [`clear ${NAME}`, `tp ${NAME} ${spec.stand.x} ${spec.stand.y} ${spec.stand.z}`]
  spec.bag.forEach(([id, n, dmg], s) => c.push(`item replace entity ${NAME} container.${s} with ${itemArg(id, dmg)} ${n}`))
  return c
}
const chestCmds = spec => [`setblock ${at(CHEST)} minecraft:chest[facing=west]`,
  ...(spec?.chest ?? []).map(([id, n], s) => `item replace block ${at(CHEST)} container.${s} with minecraft:${id} ${n}`)]

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
  for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(CHEST)} Items[{Slot:${s}b}]`)
  cmds.push('execute as @e[type=item,x=780,y=120,z=700,distance=..100] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Pos`)
  const r = rcon(...cmds)
  const bag = {}; const chest = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) bag[s] = it }
  for (let s = 0; s < 27; s++) { const q = r[36 + s]; const it = /has the following block data/.test(q?.reply || '') ? parseItem(q.reply) : null; if (it) chest[s] = it }
  const ground = (r[63]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  const pos = ((r[64]?.reply || '').match(/\[([^\]]+)\]/) || [])[1]?.replace(/d/g, '') ?? ''
  return { bag, chest, ground, pos, bagUsed: Object.keys(bag).length, chestUsed: Object.keys(chest).length }
}
const tot = list => { const t = {}; for (const it of list) t[it.id] = (t[it.id] || 0) + it.count; return t }
const totals = snap => ({ bag: tot(Object.values(snap.bag)), chest: tot(Object.values(snap.chest)), ground: tot(snap.ground) })
const diff = (a, b) => Object.keys({ ...a, ...b }).map(n => [n, (b[n] || 0) - (a[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
/** every tool copy in the server bag: name@damage */
const tools = snap => Object.values(snap.bag).filter(it => /_(pickaxe|axe|shovel)$/.test(it.id)).map(it => `${it.id}@${it.damage ?? 0}`).sort()

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const jl = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const WANT = /^(toolkit|_toolkit|wear_out|_wear_out|gather|craft|withdraw|town_deposit|_town_deposit|count_town|_death|_craft_room)$/
const skillRows = f => jl(f).filter(r => r.skill && WANT.test(r.skill.name))
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '').slice(0, 300), args: r.skill.args }))
const decisions = f => jl(f).map(r => ({ ts: Date.parse(r['@timestamp']), order: (r.llm?.latency_ms ?? 0) === 0 && !(r.response?.text), skill: r.tool_calls?.[0]?.skill,
  args: r.tool_calls?.[0]?.args, admitted: r.llm?.admission != null, err: r.llm?.error ?? null, status: r.outcome?.status, detail: String(r.outcome?.detail || '').slice(0, 160) }))
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE QUEUE BRAIN, IN THIS PROCESS: `status` until the driver opens the queue, then each queued command once.
let brainLog = null, queue = [], queueOpen = false
const brainServer = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const all = msgs.map(m => String(m.content || '')).join('\n')
    const sentinel = (all.match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const next = queueOpen && queue.length ? queue.shift() : { skill: 'status', args: {} }
    if (brainLog) fs.appendFileSync(brainLog, `${new Date().toISOString()} decision: ${JSON.stringify(next)}\n`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...next, reason: 'sandbox: scripted', saw_end: sentinel }) },
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
  const logRel = `./sandbox/log/toolkit-ab/${tag}`
  const skillLog = `${R}/sandbox/log/toolkit-ab/${tag}/skill-${NAME}.jsonl`
  const llmLog = `${R}/sandbox/log/toolkit-ab/${tag}/llm-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.tkab-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/toolkit-ab-${tag}`); set('MEMORY_POOL', `sbxtkab-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('STUCK_SECONDS', 20); set('PLANT_ENABLED', 0); set('MAX_CONSECUTIVE_FAILURES', 50)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, spec.home[a.toLowerCase()]); set(`BOARD_${a}`, spec.home[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainLog = `${OUTDIR}/brain-${tag}.log`
  queue = [...(spec.queue ?? [])]; queueOpen = false
  // THE ARENA FIRST (forceloaded), so the bot never lands in an unbuilt void: a first pilot teleported it before the build,
  // the marooned reflex pillared it up onto a placed block, and the wear dig from there was a server-rejected ghost.
  const pre = [...rcon(...arenaCmds()), ...rcon(...chestCmds(spec))]
  const badPre = pre.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected/i.test(x.reply) && !/^(kill|forceload) /.test(x.cmd))
  if (badPre.length) throw new Error('arena not built: ' + badPre.map(x => x.cmd + ' => ' + x.reply).join('; '))
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${spec.stand.x} ${spec.stand.y} ${spec.stand.z}`, `effect clear ${NAME}`, 'gamerule doDaylightCycle false', 'time set day')
  await sleep(5000)   // settled on the built arena (and past the first seconds after a join, when digs are dropped)
  const built = rcon(...bagCmds(spec))
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected/i.test(x.reply))
  if (bad.length) { await stopBot(); throw new Error('bag not set: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  await sleep(1500)
  const before = snapshot()
  const t0 = Date.now()
  let mid = null
  if (scene === 'spare') {
    await waitFor(() => skillRows(skillLog).some(r => r.ts >= t0 && r.name === 'wear_out'), spec.window, 1000)
    await sleep(5000)
  } else {
    // the toolkit's own run (cand), or 90 s of nothing (ctrl); then the queued gathers
    await waitFor(() => skillRows(skillLog).some(r => r.ts >= t0 && r.name === '_toolkit' && r.args?.phase === 'kit'), 120000, 1000)
    await sleep(3000)
    mid = snapshot()
    queueOpen = true
    await waitFor(() => skillRows(skillLog).filter(r => r.ts >= t0 && r.name === 'gather').length >= 2, spec.window, 1000)
    await sleep(4000)
  }
  const after = snapshot()
  const rows = skillRows(skillLog).filter(r => r.ts >= t0 - 5000)
  const dec = decisions(llmLog).filter(r => r.ts >= t0 - 5000)
  await stopBot()
  await sleep(1000)
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tb = totals(before), ta = totals(after)
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: process.env.ARM_SHA || '?', windowMs: Date.now() - t0,
    before: { ...before, totals: tb, tools: tools(before) }, mid: mid ? { ...mid, totals: totals(mid), tools: tools(mid) } : null,
    after: { ...after, totals: ta, tools: tools(after) },
    d: { bag: diff(tb.bag, ta.bag), chest: diff(tb.chest, ta.chest), ground: diff(tb.ground, ta.ground) },
    decisions: dec.map(d => `${d.order ? 'ORDER' : 'model'} ${d.skill}${d.args?.block ? ':' + d.args.block : ''} ${d.admitted ? d.status : 'REFUSED ' + d.err}`),
    rows }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  console.log(`${r.id.padEnd(18)} bag ${before.bagUsed}->${after.bagUsed} chest ${before.chestUsed}->${after.chestUsed} d(bag){${r.d.bag}} d(chest){${r.d.chest}} ground{${r.d.ground}}`)
  console.log(`   tools before ${r.before.tools.join(',')}`)
  if (mid) console.log(`   tools mid    ${r.mid.tools.join(',')}`)
  console.log(`   tools after  ${r.after.tools.join(',')}`)
  console.log('   decisions: ' + r.decisions.join(' | '))
  console.log('   rows: ' + rows.map(x => `${x.name}:${x.status}:${x.detail.slice(0, 140)}`).join(' || '))
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
  try { fs.unlinkSync(`${R}/sandbox/.env.tkab-${ARM}`) } catch {}
  try { rcon('kill @e[type=!player,x=780,y=120,z=700,distance=..100]', 'fill 684 120 684 730 128 716 minecraft:air', 'fill 684 119 684 730 119 716 minecraft:stone',
             'fill 840 120 684 876 128 716 minecraft:air', 'fill 840 119 684 876 119 716 minecraft:stone', 'forceload remove 684 684 876 716') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
