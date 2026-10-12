// SANDBOX-ONLY orderroom-01 A/B driver (10-10): ONE FRESH BOT PER TRIAL from <botRoot> (unmodified; trace.cjs only observes
// packets), the scene set by RCON once the bot is there, and the SERVER's truth before and after (every bag slot, the town
// chest, the item entities on the ground, the bot's position). Nothing is queued to the model: the craft is the bot's own
// RUNG work order (a full bag, a craft-ready stone_pickaxe rung, a crafting table standing beside it). The candidate is
// expected to withhold the craft, walk home, free the slot and THEN craft; the control (the fleet build) to issue the
// craft into the full bag, fail for no room, and have the gate refuse the order on the following decisions.
//
//   node orderroom-ab.cjs <arm: cand|ctrl> <botRoot> <reps> <scene,...> [server]      (ARM_SHA=<label> for the results)
//
// Town (home) is 700 120 700 with the town chest 2 east and a table beside the stand; the work site is 60 east (760 120 700)
// with its own table: no chest within 48 of it, so a deposit from there is refused by admission (deposit_not_worth_it).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node orderroom-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Room'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/orderroom-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = Number(process.env.OR_BRAIN_PORT || 11498)   // not 11499: other agents' drivers hold it
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-orab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
const HOME = { x: 700, y: 120, z: 700 }
const CHEST = { x: 702, y: 120, z: 700 }
const TOWN_TABLE = { x: 699, y: 120, z: 702 }
const SITE = { x: 760.5, y: 120, z: 700.5 }
const SITE_TABLE = { x: 762, y: 120, z: 700 }
const at = c => `${c.x} ${c.y} ${c.z}`
const wool = n => Array.from({ length: n }, (_, i) => ['white_wool', 1 + (i % 3)])
// 36/36: the stone_pickaxe recipe (3 cobblestone, 2 sticks) empties NO stack, so the pickaxe needs a free slot.
const FULL_BAG = [['cobblestone', 64], ['cobblestone', 20], ['stick', 10], ['crafting_table', 1], ['oak_log', 64], ['oak_log', 64], ['oak_log', 40],
  ['dirt', 16], ['wooden_pickaxe', 1, 9], ['furnace', 1], ['sand', 8], ['raw_copper', 5], ...wool(24)]
// The same bag with the sticks at 2: the craft empties the stick stack and fits (positive control: the order still runs).
const ROOM_BAG = FULL_BAG.map(r => (r[0] === 'stick' ? ['stick', 2] : r))
// THE TOWN DEPOSIT FREES NOTHING HERE (its keeps: logs/cobble to 64, the iron ladder, dirt, sand, junk): the remedy must be
// the craft's own named deposit (deposit raw_iron), proven by the server's chest -- not an assumed town deposit.
const KEPT_BAG = [['cobblestone', 64], ['stick', 10], ['crafting_table', 1], ['oak_log', 64], ['raw_iron', 20], ['coal', 30], ['dirt', 16],
  ['wooden_pickaxe', 1, 9], ['furnace', 1], ['sand', 8], ...wool(26)]
const SPEC = {
  kept: { bag: KEPT_BAG, stand: SITE },
  // THE BANK REFUSES (the town chest is full of diorite, no chest in the bag to build another): the remedy must back off
  // cleanly -- nothing dropped, nothing lost, no repeated room order inside the window.
  keptfull: { bag: KEPT_BAG, stand: SITE, chestFill: Array.from({ length: 27 }, () => ['diorite', 64]) },
  far: { bag: FULL_BAG, stand: SITE },          // the chain: home -> deposit/town deposit -> craft
  room: { bag: ROOM_BAG, stand: SITE },         // positive control: room -> the craft order runs at once, no walk
}
const WINDOW_MS = Number(process.env.OR_WINDOW_MS || 240000)
function arenaCmds () {
  // forceload: town and site are 60 apart, so with the bot at the site the town's chunks may not be loaded (sandbox4).
  return ['forceload add 688 692 772 708', 'kill @e[type=!player,x=730,y=120,z=700,distance=..60]',
    'fill 688 120 692 772 126 708 minecraft:air', 'fill 688 119 692 772 119 708 minecraft:stone',
    `setblock ${at(TOWN_TABLE)} minecraft:crafting_table`, `setblock ${at(SITE_TABLE)} minecraft:crafting_table`]
}
const itemArg = (id, dmg) => `minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''}`
function bagCmds (spec) {
  const c = [`clear ${NAME}`, `tp ${NAME} ${spec.stand.x} ${spec.stand.y} ${spec.stand.z}`]
  spec.bag.forEach(([id, n, dmg], s) => c.push(`item replace entity ${NAME} container.${s} with ${itemArg(id, dmg)} ${n}`))
  return c
}
const chestCmds = spec => [`setblock ${at(CHEST)} minecraft:chest[facing=west]`,
  ...(spec?.chestFill ?? []).map(([id, n], s) => `item replace block ${at(CHEST)} container.${s} with minecraft:${id} ${n}`)]

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
  cmds.push('execute as @e[type=item,x=730,y=120,z=700,distance=..60] run data get entity @s Item')
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

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const jl = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const WANT = /^(craft|deposit|town_deposit|home|eat|_work_order|_craft_noroom|_room_order|_town_deposit|_craft_room|_death)$/
const skillRows = f => jl(f).filter(r => r.skill && WANT.test(r.skill.name))
  .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '').slice(0, 300) }))
const decisions = f => jl(f).map(r => ({ ts: Date.parse(r['@timestamp']), order: (r.llm?.latency_ms ?? 0) === 0 && !(r.response?.text), skill: r.tool_calls?.[0]?.skill,
  args: r.tool_calls?.[0]?.args, admitted: r.llm?.admission != null, err: r.llm?.error ?? null, status: r.outcome?.status, detail: String(r.outcome?.detail || '').slice(0, 160) }))
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE QUEUE BRAIN, IN THIS PROCESS: nothing is queued, so every model decision is `status`.
let brainLog = null
const brainServer = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const all = msgs.map(m => String(m.content || '')).join('\n')
    const sentinel = (all.match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    if (brainLog) fs.appendFileSync(brainLog, `${new Date().toISOString()} decision: status | ${(all.match(/^HINT: .*$/m) || [''])[0].slice(0, 200)}\n`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ skill: 'status', args: {}, reason: 'sandbox: idle', saw_end: sentinel }) },
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
  const logRel = `./sandbox/log/orderroom-ab/${tag}`
  const skillLog = `${R}/sandbox/log/orderroom-ab/${tag}/skill-${NAME}.jsonl`
  const llmLog = `${R}/sandbox/log/orderroom-ab/${tag}/llm-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.orab-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/orderroom-ab-${tag}`); set('MEMORY_POOL', `sbxorab-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('STUCK_SECONDS', 20); set('PLANT_ENABLED', 0)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${spec.stand.x} ${spec.stand.y} ${spec.stand.z}`, `effect clear ${NAME}`)
  await sleep(2000)
  const built = [...rcon(...arenaCmds()), ...rcon(...bagCmds(spec)), ...rcon(...chestCmds(spec))]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected/i.test(x.reply) && !/^(kill|forceload) /.test(x.cmd))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  await sleep(2000)
  const before = snapshot()
  const t0 = Date.now()
  // Done when the craft has succeeded (both arms can), else at the window's end.
  const crafted = await waitFor(() => skillRows(skillLog).some(r => r.ts >= t0 && r.name === 'craft' && r.status === 'success'), WINDOW_MS, 1000)
  if (crafted) await sleep(4000)
  const after = snapshot()
  const rows = skillRows(skillLog).filter(r => r.ts >= t0 - 5000)
  const dec = decisions(llmLog).filter(r => r.ts >= t0 - 5000)
  await stopBot()
  await sleep(1000)
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tb = totals(before), ta = totals(after)
  const refusedCraftOrders = dec.filter(d => d.order && d.skill === 'craft' && !d.admitted && d.status === 'aborted')
  const noRoomCrafts = dec.filter(d => d.order && d.skill === 'craft' && d.admitted && d.status === 'failed' && /No room for/.test(d.detail))
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: process.env.ARM_SHA || '?', windowMs: Date.now() - t0, crafted: !!crafted,
    before: { ...before, totals: tb }, after: { ...after, totals: ta },
    d: { bag: diff(tb.bag, ta.bag), chest: diff(tb.chest, ta.chest), ground: diff(tb.ground, ta.ground) },
    refusedCraftOrders: refusedCraftOrders.map(d => d.err), noRoomCrafts: noRoomCrafts.length,
    decisions: dec.map(d => `${d.order ? 'ORDER' : 'model'} ${d.skill}${d.args?.item ? ':' + d.args.item : ''} ${d.admitted ? d.status : 'REFUSED ' + d.err}`),
    rows }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  console.log(`${r.id.padEnd(16)} crafted=${r.crafted} bag ${before.bagUsed}->${after.bagUsed} chest ${before.chestUsed}->${after.chestUsed} pos ${before.pos} -> ${after.pos}` +
    ` d(bag){${r.d.bag}} d(chest){${r.d.chest}} ground{${r.d.ground}} noRoomCrafts=${r.noRoomCrafts} refusedCraftOrders=${JSON.stringify(r.refusedCraftOrders)}`)
  console.log('   decisions: ' + r.decisions.join(' | '))
  console.log('   rows: ' + rows.map(x => `${x.name}:${x.status}:${x.detail.slice(0, 110)}`).join(' || '))
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
  try { fs.unlinkSync(`${R}/sandbox/.env.orab-${ARM}`) } catch {}
  try { rcon('kill @e[type=!player,x=730,y=120,z=700,distance=..60]', 'fill 688 120 692 772 126 708 minecraft:air', 'fill 688 119 692 772 119 708 minecraft:stone', 'forceload remove 688 692 772 708') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
