// SANDBOX-ONLY spent-tool A/B driver: ONE FRESH BOT PER TRIAL from <botRoot> (unmodified; trace.cjs only observes
// packets -- including every dig with the item the bot held), the scene built by RCON after the bot is there, ONE
// decision queued (gather / goto) through the brain embedded in this process (a trial is two node processes: this
// driver and the bot), then the server's truth: every slot with its durability, and the item entities on the ground.
//
//   node tools-ab.cjs <arm> <botRoot> <reps> <scene,scene,...> [server]
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node tools-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Tools'
const OUTDIR = `${R}/sandbox/log/tools-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-craftab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- scenes
// The arena: a SMOOTH_STONE floor at y 119 (nothing a gather targets, nothing wear_out calls natural), air above, the
// bot at 700.5 120 700.5. Durability is `damage` = max - uses left: stone tools 131, wooden 59.
const STAND = { x: 700.5, y: 120, z: 700.5 }
const row = (block, n, z = 700, x0 = 703) => Array.from({ length: n }, (_, i) => `setblock ${x0 + i} 120 ${z} minecraft:${block}`)
const SPEC = {
  // 1. the SOLE stone_axe at 5 uses; 6 oak logs in a row
  'axe5': { slots: [['stone_axe', 1, 126]], blocks: row('oak_log', 6), cmd: 'gather 6 oak_log', watch: 'gather', count: ['oak_log', 6] },
  // 2. the SOLE wooden_shovel at 4 uses; 5 dirt in a row
  'shovel4': { slots: [['wooden_shovel', 1, 55]], blocks: row('dirt', 5), cmd: 'gather 5 dirt', watch: 'gather', count: ['dirt', 5] },
  // 3. two stone_axes, 90 and 3 uses; 6 oak logs
  'axes90-3': { slots: [['stone_axe', 1, 41], ['stone_axe', 1, 128]], blocks: row('oak_log', 6), cmd: 'gather 6 oak_log', watch: 'gather', count: ['oak_log', 6] },
  // 4. three 1-use stone_pickaxes and one at 50 uses; 5 stone
  'picks1x3-50': { slots: [['stone_pickaxe', 1, 130], ['stone_pickaxe', 1, 130], ['stone_pickaxe', 1, 130], ['stone_pickaxe', 1, 81]], blocks: row('stone', 5), cmd: 'gather 5 stone', watch: 'gather', count: ['cobblestone', 5], noStone: true },
  // 5. ONLY a 1-use stone_pickaxe; 5 stone (the last swing)
  'pick1-only': { slots: [['stone_pickaxe', 1, 130]], blocks: row('stone', 5), cmd: 'gather 5 stone', watch: 'gather', count: ['cobblestone', 5], noStone: true },
  // 6. a TRAVEL dig: a 1-use wooden_shovel; the bot walled in by dirt two high (no tower blocks held), goto 10 east.
  //    goto's on-foot leg fails, and its retry borrows the dig-capable profile: the pathfinder's own digs (travelTool).
  'travel-shovel1': { slots: [['wooden_shovel', 1, 58]], walls: 'dirt', cmd: 'goto 711 120 700', watch: 'goto' },
  // 6b. the same with a stack of cobblestone in the bag: travelTool can put a block in the hand instead of the held tool
  //     (6 alone is the edge case: the shovel is HELD, nothing else is in the bag, travelTool returns null and
  //     mineflayer-pathfinder digs with whatever is held)
  'travel-shovel1-filler': { slots: [['wooden_shovel', 1, 58], ['cobblestone', 16]], walls: 'dirt', cmd: 'goto 711 120 700', watch: 'goto' },
}
function arenaCmds (spec) {
  const c = ['kill @e[type=!player,x=700,y=120,z=700,distance=..30]',
    'fill 690 120 690 712 130 712 minecraft:air', 'fill 690 119 690 712 119 712 minecraft:smooth_stone']
  // NO OTHER STONE WITHIN GATHER'S REACH (sandbox, first run: gather 5 stone took the floating platform's own stone at
  // the arena edge and the bot fell 51 blocks into the void): every stone block around becomes smooth_stone.
  if (spec.noStone) c.push('fill 676 112 676 699 127 724 minecraft:smooth_stone replace minecraft:stone', 'fill 700 112 676 724 127 724 minecraft:smooth_stone replace minecraft:stone')
  for (const b of spec.blocks || []) c.push(b)
  // the pit: dirt walls two high AND a dirt roof at y 122, so the only way out is a dig (an open top let the ascent
  // profile tower out with the cobblestone instead)
  if (spec.walls) c.push(`fill 699 120 699 701 122 701 minecraft:${spec.walls}`, 'fill 700 120 700 700 121 700 minecraft:air')
  return c
}
function bagCmds (spec) {
  const c = [`clear ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`]
  let s = 0
  for (const [id, n, dmg] of spec.slots || []) c.push(`item replace entity ${NAME} container.${s++} with minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''} ${n}`)
  return c
}

// ---------------------------------------------------------------- oracle
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
  cmds.push('execute as @e[type=item,x=700,y=120,z=700,distance=..20] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Pos`)
  const r = rcon(...cmds)
  const slots = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) slots[s] = it }
  const ground = (r[36]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  const pos = (((r[37]?.reply || '').match(/\[([^\]]+)\]/) || [])[1] || '').replace(/d/g, '')
  return { slots, used: Object.keys(slots).length, ground, pos }
}
const totals = snap => { const t = {}; for (const it of Object.values(snap.slots)) t[it.id] = (t[it.id] || 0) + it.count; return t }
const toolsOf = snap => Object.entries(snap.slots).filter(([, it]) => /_(axe|shovel|hoe|pickaxe)$/.test(it.id)).map(([s, it]) => `${it.id}@slot${s}:dmg${it.damage ?? 0}`)

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const NOISE = /^(_affordance_scan|_progress_restored)$/
function skillRows (file) {
  return lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill && !NOISE.test(r.skill.name))
    .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, trigger: r.trigger, ms: r.skill.duration_ms, fail: r.skill.fail_class, detail: String(r.skill.detail || '').slice(0, 500) }))
}
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE QUEUE BRAIN, IN THIS PROCESS: each decision gets the next queued line, else 'status'.
let brainQueue = []; let brainLog = null
const parse = line => {
  const [skill, ...rest] = line.split(/\s+/); const args = {}
  if (skill === 'gather' && rest.length === 2) { args.count = +rest[0]; args.block = rest[1] }
  else if (skill === 'goto' && rest.length >= 3) { args.x = +rest[0]; args.y = +rest[1]; args.z = +rest[2] }
  else if (rest.length === 1) args.item = rest[0]
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
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const skillLog = `${OUTDIR}/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.tools-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', `./sandbox/log/tools-ab/${tag}`); set('STATE_DIR', `./sandbox/state/tools-ab-${tag}`); set('MEMORY_POOL', `sbxtools-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, Math.floor(STAND[a.toLowerCase()])); set(`BOARD_${a}`, Math.floor(STAND[a.toLowerCase()])) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  brainQueue = []; brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  // the arena only once the bot is there: setblock/fill into an unloaded chunk fails
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`)
  await sleep(3000)
  const built = rcon(...arenaCmds(spec))
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect/i.test(x.reply))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  rcon(...bagCmds(spec))
  await sleep(2500)
  const before = snapshot()
  const t0 = Date.now()
  brainQueue.push(spec.cmd)
  const endPat = new RegExp(`skill ${spec.watch} ->|rejected why=.*"skill":"${spec.watch}"`)
  const ended = await waitFor(() => lines(botOut).some(l => endPat.test(l)), 240000)
  await sleep(1500)   // drops in flight; short, so a work order on the next decision cannot act first
  const after = snapshot()
  const rows = skillRows(skillLog)
  await stopBot()
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = lines(trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(e => e && e.ts >= t0)
  // each dig START (status 0) with the item held at that moment, and each FINISH (status 2)
  const digs = tr.filter(e => e.pkt === 'dig' && (e.status === 0 || e.status === 2)).map(e => ({ t: e.ts - t0, s: e.status, at: e.loc && `${e.loc.x},${e.loc.y},${e.loc.z}`, held: e.held ? `${e.held.name}:used${e.held.used}` : 'hand' }))
  const watched = rows.filter(r => r.name === spec.watch).pop() || null
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    cmd: spec.cmd, ended: !!ended, watched,
    before: { used: before.used, totals: totals(before), slots: before.slots, tools: toolsOf(before), ground: before.ground, pos: before.pos },
    after: { used: after.used, totals: totals(after), slots: after.slots, tools: toolsOf(after), ground: after.ground, pos: after.pos },
    rows, digs, pickups: tr.filter(e => e.pkt === 'collect' && e.self).length, spawns: tr.filter(e => e.pkt === 'spawn_item').length,
    out: lines(botOut).filter(l => /rejected|skill .* ->|equip|tool/i.test(l)).map(l => l.slice(0, 300)).slice(-30) }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const tb = totals(before); const ta = totals(after)
  const delta = Object.keys({ ...tb, ...ta }).map(n => [n, (ta[n] || 0) - (tb[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
  const tagRows = rows.filter(x => /^_(tool_spent|spent_swing|tool_broke|tool_gone|spent_equip_fallback|wear_out_late|last_swing)$/.test(x.name)).map(x => x.name)
  console.log(`${r.id.padEnd(26)} ${String(watched?.status || 'none').padEnd(8)} ${watched?.ms ?? '-'}ms tools ${toolsOf(before).join(' ')} -> ${toolsOf(after).join(' ') || '-'} ground[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] d{${delta}} digs[${digs.filter(d => d.s === 0).map(d => d.held).join(' ')}] rows[${tagRows.join(',')}] | ${(watched?.detail || '').slice(0, 120)}`)
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
  try { fs.unlinkSync(`${R}/sandbox/.env.tools-${ARM}`) } catch {}
  try { rcon('kill @e[type=!player,x=700,y=120,z=700,distance=..30]', 'fill 690 120 690 712 130 712 minecraft:air', 'fill 690 119 690 712 119 712 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
