// SANDBOX-ONLY tool-hygiene A/B driver (toolhygiene-01, 2026-10-07; from tools-ab.cjs): ONE FRESH BOT PER TRIAL from
// <botRoot> (unmodified; trace.cjs only observes packets -- including every dig with the item the bot held), the scene
// built by RCON after the bot is there, the scene's decisions queued through the brain embedded in this process, then
// the SERVER's truth: every slot with its durability (damage), the item entities on the ground, and -- for travel digs
// -- every cell the bot finished digging read back with `execute if block ... air` (a ghost block reads solid).
//
//   BOT_SHA=<sha> node toolhygiene-ab.cjs <arm> <botRoot> <reps> <scene,scene,...> [server]
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: BOT_SHA=<sha> node toolhygiene-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Hygiene'
const OUTDIR = `${R}/sandbox/log/toolhygiene-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = Number(process.env.BRAIN_PORT || 11519)   // not the shared 11499: other drivers use it
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
// Pickaxe damage = 131 - uses left (stone), 59 - uses (wooden), 250 - uses (iron).
const SPEC = {
  // A. REDUNDANT: stone@60 + stone@45 (two usable, a 40+ cover), the stone-pickaxe materials and a table in the bag.
  //    `craft stone_pickaxe` must be REFUSED (no click, materials unchanged), then `gather 3 stone` digs -- with the
  //    45 on the candidate (most-worn of two open copies), with the 60 on the control (fullest first).
  'redundant': { slots: [['stone_pickaxe', 1, 71], ['stone_pickaxe', 1, 86], ['cobblestone', 3], ['stick', 2], ['crafting_table', 1]],
    blocks: row('stone', 3), cmds: ['craft stone_pickaxe', 'gather 3 stone'], watch: 'gather', noStone: true },
  // B. THE UPGRADE: a full stone pickaxe and a wooden one, 3 iron ingots, 2 sticks, a table -> the iron pickaxe crafts.
  'iron': { slots: [['stone_pickaxe', 1, 0], ['wooden_pickaxe', 1, 29], ['iron_ingot', 3], ['stick', 2], ['crafting_table', 1]],
    cmds: ['craft iron_pickaxe'], watch: 'craft' },
  // C. MOST-WORN FIRST: stone@120, @8, @5 -> gather 5 stone. Candidate: the 5 wears to 1 and goes (spend_spent) before
  //    the 120 is touched; the 8 stays (the deposit-proof spare). Control: the 120 digs, the 8 and the 5 untouched.
  'worn': { slots: [['stone_pickaxe', 1, 11], ['stone_pickaxe', 1, 123], ['stone_pickaxe', 1, 126]],
    blocks: row('stone', 5), cmds: ['gather 5 stone'], watch: 'gather', noStone: true },
  // C2. THE SPARE: stone@120 + stone@8 -> gather 5 stone: both arms dig with the 120 (the 8 is the escape spare).
  'spare': { slots: [['stone_pickaxe', 1, 11], ['stone_pickaxe', 1, 123]],
    blocks: row('stone', 5), cmds: ['gather 5 stone'], watch: 'gather', noStone: true },
  // E. TRAVEL DIGS THROUGH THE 10 -> 1 WINDOW: stone@120, @8, @4 walled in by stone (roof too), goto 10 east: the
  //    pathfinder's own digs (travelTool). Candidate: the 4 wears to 1 and stops (HARD_STOP); no ghost cells.
  'travel': { slots: [['stone_pickaxe', 1, 11], ['stone_pickaxe', 1, 123], ['stone_pickaxe', 1, 127]],
    walls: 'stone', noStone: true, cmds: ['goto 706 120 700'], watch: 'goto' },   // inside the band: every step is a dig
  // E2. TRAVEL PAST THE WORN COPY (Codex round 4): a stone wall 11 thick and 7 high east of the pit, goto its far side --
  //     the pathfinder must tunnel (>= 4 travel digs), so the dig AFTER the worn copy reaches 1 is observed.
  'travel2': { slots: [['stone_pickaxe', 1, 11], ['stone_pickaxe', 1, 123], ['stone_pickaxe', 1, 127]],
    walls: 'stone', wall2: true, noStone: true, cmds: ['goto 711 120 700'], watch: 'goto' },
  // F. MINE'S STAIR DIGS (back-to-back, not a harvest; Claude round 2): stone@120, @8, @4 on a stone mass, `mine` to
  //    y 113. Candidate: the 4 is driven 4 -> 3 -> 2 -> 1 and stops; no ghost cells, no hand-speed dig.
  'mine': { slots: [['stone_pickaxe', 1, 11], ['stone_pickaxe', 1, 123], ['stone_pickaxe', 1, 127], ['dirt', 32]],
    mass: true, noStone: true, cmds: ['mine 113'], watch: 'mine', home: { x: 640, z: 640 } },
  // G. THE ESCAPE REFLEX'S DIGS: the bot sealed in stone on every side and above, no decision queued; the entombed reflex
  //    digs out with applyToolPolicy (no lastSwing). Same bag as F.
  'tomb': { slots: [['stone_pickaxe', 1, 11], ['stone_pickaxe', 1, 123], ['stone_pickaxe', 1, 127]],
    tomb: true, noStone: true, cmds: [], waitRow: /^_entombed/, waitMs: 150000 },
}
const UNUSED_TOOLS_SPEC = {
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
  // the travel scene: a solid stone band east of the pit, so the walk to 711 must dig through it
  if (spec.walls === 'stone') c.push('fill 702 120 690 708 121 712 minecraft:stone')
  if (spec.wall2) c.push('fill 702 120 690 712 126 712 minecraft:stone', 'fill 713 120 699 713 121 701 minecraft:air')
  if (spec.mass) c.push('fill 695 108 695 705 119 705 minecraft:stone')
  if (spec.tomb) c.push('fill 698 119 698 702 123 702 minecraft:stone', 'fill 700 120 700 700 121 700 minecraft:air')
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
  else if (skill === 'craft' && rest.length === 2) { args.count = +rest[0]; args.item = rest[1] }
  if (skill === 'mine' && rest.length === 1) { delete args.item; args.y = +rest[0] }
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
  const envRel = `sandbox/.env.toolhygiene-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', `./sandbox/log/toolhygiene-ab/${tag}`); set('STATE_DIR', `./sandbox/state/toolhygiene-ab-${tag}`); set('MEMORY_POOL', `sbxhyg-${tag}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, Math.floor(STAND[a.toLowerCase()])); set(`BOARD_${a}`, Math.floor(STAND[a.toLowerCase()])) }
  if (spec.home) { set('HOME_X', spec.home.x); set('HOME_Z', spec.home.z) }   // mine will not dig down within 12 of home
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
  brainQueue.push(...spec.cmds)
  const endPat = new RegExp(`skill ${spec.watch} ->|rejected why=.*"skill":"${spec.watch}"`)
  const ended = spec.waitRow
    ? await waitFor(() => skillRows(skillLog).some(x => spec.waitRow.test(x.name)) && lines(botOut).length > 0, spec.waitMs || 120000, 1000).then(async v => { await sleep(20000); return v })
    : await waitFor(() => lines(botOut).some(l => endPat.test(l)), 240000)
  await sleep(1500)   // drops in flight; short, so a work order on the next decision cannot act first
  const after = snapshot()
  // GHOST CHECK (travel): every cell whose dig FINISHED (status 2) must be air on the SERVER now.
  const finished = [...new Set(lines(trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(e => e && e.ts >= t0 && e.pkt === 'dig' && e.status === 2 && e.loc).map(e => `${e.loc.x} ${e.loc.y} ${e.loc.z}`))]
  const ghosts = finished.length ? rcon(...finished.map(c => `execute if block ${c} minecraft:air`)).filter(x => !/passed/i.test(x.reply)).map(x => x.cmd) : []
  const rows = skillRows(skillLog)
  await stopBot()
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = lines(trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(e => e && e.ts >= t0)
  // each dig START (status 0) with the item held at that moment, and each FINISH (status 2)
  const digs = tr.filter(e => e.pkt === 'dig' && (e.status === 0 || e.status === 2)).map(e => ({ t: e.ts - t0, s: e.status, at: e.loc && `${e.loc.x},${e.loc.y},${e.loc.z}`, held: e.held ? `${e.held.name}:used${e.held.used}` : 'hand' }))
  const watched = rows.filter(r => r.name === spec.watch).pop() || null
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: process.env.BOT_SHA || 'unknown',
    cmds: spec.cmds, ended: !!ended, watched, finishedDigs: finished.length, ghosts,
    refusals: lines(botOut).filter(l => /redundant_craft/.test(l)).map(l => l.slice(0, 300)),
    before: { used: before.used, totals: totals(before), slots: before.slots, tools: toolsOf(before), ground: before.ground, pos: before.pos },
    after: { used: after.used, totals: totals(after), slots: after.slots, tools: toolsOf(after), ground: after.ground, pos: after.pos },
    rows, digs, pickups: tr.filter(e => e.pkt === 'collect' && e.self).length, spawns: tr.filter(e => e.pkt === 'spawn_item').length,
    out: lines(botOut).filter(l => /rejected|skill .* ->|equip|tool/i.test(l)).map(l => l.slice(0, 300)).slice(-30) }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const tb = totals(before); const ta = totals(after)
  const delta = Object.keys({ ...tb, ...ta }).map(n => [n, (ta[n] || 0) - (tb[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
  const tagRows = rows.filter(x => /^_(tool_spent|spent_swing|tool_broke|tool_gone|spent_equip_fallback|wear_out_late|last_swing|redundant_craft|craft_admit|worn_first|tool_hygiene)$/.test(x.name)).map(x => x.name)
  console.log(`${r.id.padEnd(26)} ${String(watched?.status || 'none').padEnd(8)} ${watched?.ms ?? '-'}ms tools ${toolsOf(before).join(' ')} -> ${toolsOf(after).join(' ') || '-'} ground[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] d{${delta}} ghosts ${ghosts.length}/${finished.length} refused ${r.refusals.length} digs[${digs.filter(d => d.s === 0).map(d => d.held).join(' ')}] rows[${tagRows.join(',')}] | ${(watched?.detail || '').slice(0, 120)}`)
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
  try { fs.unlinkSync(`${R}/sandbox/.env.toolhygiene-${ARM}`) } catch {}
  try { rcon('kill @e[type=!player,x=700,y=120,z=700,distance=..30]', 'fill 690 120 690 712 130 712 minecraft:air', 'fill 690 119 690 712 119 712 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
