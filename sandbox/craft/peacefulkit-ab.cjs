// SANDBOX-ONLY peaceful-kit A/B driver (peacefulkit, 10-07): ONE FRESH BOT PER TRIAL from <botRoot> (unmodified; trace.cjs only
// observes packets). Built from foodskip-ab.cjs. The oracle is the SERVER: the bag's slots, the town chest's slots, the
// item entities on the ground, the composter block -- never the bot's claim. Rows (`_peaceful_kit`, `_compost`, deposit,
// craft) are recorded beside it.
//
//   node peacefulkit-ab.cjs <arm: cand|ctrl> <botRoot> <reps> <scene,...> [server]      BRAIN_PORT / CRAFT_BOT_NAME env
// Scenes (the sandbox world is PEACEFUL unless the scene sets `difficulty`; restored to peaceful after every trial):
//   craft / craft_easy     queue `craft wooden_sword` with planks, sticks and a crafting table in the bag. Peaceful: the
//                          candidate refuses it (no sword ever in the bag); easy: it is crafted. The control crafts it.
//   bank / bank_off / bank_easy   a town bot (32/36: two swords, two stone pickaxes 30/100 used, cobblestone, logs, wool)
//                          beside an empty chest; queue `deposit`. Peaceful: both swords in the chest, none in the bag, the
//                          better pickaxe kept. FOOD_SKIP=off / easy / control: the swords stay in the bag.
//   compost / compost_off / compost_easy   a town bot at 35/36 with 14 kinds of kit plants, 10 apples, 20 oak saplings,
//                          bread, dried_kelp and a sword, a composter and a chest at town; nothing queued (compost is a
//                          town order). Peaceful: every kit plant consumed, 4 apples and 16 saplings kept, bread/dried_kelp/
//                          sword untouched. Off / easy / control: no kit plant touched.
//   drop                   an oak_log beside the bot, a stone_sword lying ~5 blocks away and a cobblestone ~6 away; queue
//                          `gather 1 oak_log`. Peaceful: the sweep walks to the cobblestone, never to the sword.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node peacefulkit-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Kit'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/peacefulkit-ab`
const RES = `${OUTDIR}/results-${ARM}-${SERVER}.jsonl`
const BRAIN_PORT = Number(process.env.BRAIN_PORT || 11499)   // one driver per port: two drivers may run side by side
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-pkab-${SERVER}-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
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
const CHEST = { x: 702, y: 120, z: 698 }
const COMPOSTER = { x: 696, y: 120, z: 696 }
const DROPS = [['stone_sword', 704.5, 703.5], ['cobblestone', 696.5, 705.5]]
const wool = n => Array.from({ length: n }, () => ['white_wool', 1])
const KIT_BAG = [['wildflowers', 30], ['melon_slice', 9], ['kelp', 7], ['brown_mushroom', 2], ['red_mushroom', 2], ['cocoa_beans', 3],
  ['sweet_berries', 4], ['torchflower_seeds', 2], ['pitcher_pod', 1], ['red_tulip', 2], ['rose_bush', 2], ['peony', 1], ['cactus_flower', 1], ['pink_petals', 3]]
const KIT_NAMES = KIT_BAG.map(([n]) => n)
const COMPOST_BAG = [...KIT_BAG, ['apple', 10], ['oak_sapling', 20], ['bread', 5], ['dried_kelp', 4], ['stone_sword', 1, 0], ['stone_pickaxe', 1, 20], ...wool(15)]
const BANK_BAG = [['stone_sword', 1, 0], ['wooden_sword', 1, 0], ['stone_pickaxe', 1, 30], ['stone_pickaxe', 1, 100], ['cobblestone', 64], ['oak_log', 30], ...wool(26)]
const CRAFT_BAG = [['oak_planks', 8], ['stick', 4], ['crafting_table', 1], ['stone_pickaxe', 1, 20], ...wool(4)]
const SPEC = {
  craft: { bag: CRAFT_BAG, cmd: 'craft wooden_sword', verb: 'craft' },
  craft_easy: { bag: CRAFT_BAG, cmd: 'craft wooden_sword', verb: 'craft', difficulty: 'easy' },
  bank: { bag: BANK_BAG, cmd: 'deposit', verb: 'deposit', chest: true },
  bank_off: { bag: BANK_BAG, cmd: 'deposit', verb: 'deposit', chest: true, env: { FOOD_SKIP: 'off' } },
  bank_easy: { bag: BANK_BAG, cmd: 'deposit', verb: 'deposit', chest: true, difficulty: 'easy' },
  compost: { bag: COMPOST_BAG, compost: true, chest: true },
  compost_off: { bag: COMPOST_BAG, compost: true, chest: true, env: { FOOD_SKIP: 'off' } },
  compost_easy: { bag: COMPOST_BAG, compost: true, chest: true, difficulty: 'easy' },
  drop: { bag: [['white_wool', 1]], cmd: 'gather 1 oak_log', verb: 'gather', drops: true },
}
if (COMPOST_BAG.length !== 35 || BANK_BAG.length !== 32) throw new Error(`bag sizes ${COMPOST_BAG.length} ${BANK_BAG.length}`)
const WINDOW_MS = 120000
function arenaCmds () {
  return ['kill @e[type=!player,x=700,y=120,z=700,distance=..30]',
    'fill 688 120 688 712 130 712 minecraft:air', 'fill 688 119 688 712 119 712 minecraft:stone']
}
const itemArg = (id, dmg) => `minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''}`
function sceneCmds (spec) {
  const c = []
  if (spec.compost) c.push(`setblock ${COMPOSTER.x} ${COMPOSTER.y} ${COMPOSTER.z} minecraft:composter[level=0]`)
  if (spec.chest) c.push(`setblock ${CHEST.x} ${CHEST.y} ${CHEST.z} minecraft:chest[facing=west]`)
  if (spec.drops) {
    c.push(`setblock ${LOG.x} ${LOG.y} ${LOG.z} minecraft:oak_log`)
    for (const [id, x, z] of DROPS) c.push(`summon minecraft:item ${x} 120.1 ${z} {Item:{id:"minecraft:${id}",count:1},PickupDelay:0s,Age:-32768s}`)
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
let SNAP_CHESTS = []
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  for (const c of SNAP_CHESTS) for (let s = 0; s < 27; s++) cmds.push(`data get block ${c.x} ${c.y} ${c.z} Items[{Slot:${s}b}]`)
  
  cmds.push('execute as @e[type=item,x=700,y=120,z=700,distance=..24] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Pos`)
  const r = rcon(...cmds)
  const bag = {}; const chest = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) bag[s] = it }
  for (let s = 0; s < SNAP_CHESTS.length * 27; s++) { const it = /has the following block data/.test(r[36 + s]?.reply || '') ? parseItem(r[36 + s].reply) : null; if (it) chest[s] = it }
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
  const logRel = `./sandbox/log/peacefulkit-ab/${tag}`
  const skillLog = `${R}/sandbox/log/peacefulkit-ab/${tag}/skill-${NAME}.jsonl`
  SNAP_CHESTS = spec.chest ? [CHEST] : []
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.pkab-${ARM}-${SERVER}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/peacefulkit-ab-${tag}`); set('MEMORY_POOL', `sbxpkab-${tag}`)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`)
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
    done = await waitFor(() => ended(botOut, skillLog, spec.verb), WINDOW_MS)
    await sleep(4000)
  }
  const after = snapshot()
  const rows = skillRows(skillLog)
  const composterNow = spec.compost ? [0, 1, 2, 3, 4, 5, 6, 7, 8].find(l => /passed/.test(rcon(`execute if block ${COMPOSTER.x} ${COMPOSTER.y} ${COMPOSTER.z} minecraft:composter[level=${l}]`)[0]?.reply || '')) ?? null : null
  await stopBot()
  if (spec.difficulty) rcon('difficulty peaceful')
  await sleep(1500)
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = traceEv(trace).filter(e => e.ts >= t0)
  const tb = totals(before), ta = totals(after)
  const all = lines(skillLog).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const kitRows = rows.filter(x => x.name === '_peaceful_kit').map(x => x.detail)
  const rejected = lines(botOut).filter(l => /rejected why=/.test(l)).map(l => l.slice(0, 240))
  const sw = t => Object.entries(t).filter(([n]) => /_sword$/.test(n)).map(([n, c]) => `${n}:${c}`).join(',') || '-'
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    ended: !!done, difficulty: diffReply.trim(), env: spec.env ?? {}, before: { ...before, totals: tb }, after: { ...after, totals: ta },
    kitRows, rejected, composterLevel: composterNow,
    rows: rows.filter(x => /^(craft|deposit|gather|compost|_compost|_peaceful_kit|_food_skip|_pickups|_pickup_skipped)$/.test(x.name)),
    pickups: all.filter(x => x.skill?.name === '_pickups').map(x => x.skill.detail).slice(0, 5),
    trace: { pickups: tr.filter(e => e.pkt === 'collect' && e.self).map(e => ({ t: e.ts - t0, n: e.n })) } }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const kit = t => KIT_NAMES.reduce((n, x) => n + (t[x] ?? 0), 0)
  let say = ''
  if (scene.startsWith('craft')) say = `bag swords ${sw(tb.bag)} -> ${sw(ta.bag)} planks ${tb.bag.oak_planks ?? 0}->${ta.bag.oak_planks ?? 0} rejected=${JSON.stringify(rejected.map(l => (l.match(/reason[^,]*/) || [l.slice(0, 80)])[0]))} craft=${JSON.stringify(rows.filter(x => x.name === 'craft').map(x => x.status + ':' + x.detail.slice(0, 120)))}`
  if (scene.startsWith('bank')) say = `bag swords ${sw(tb.bag)} -> ${sw(ta.bag)} | chest swords ${sw(ta.chest)} | chest ${diff(tb.chest, ta.chest)} | pickaxes kept ${picks(after.bag).join(' ')} | ${rows.filter(x => x.name === 'deposit').map(x => x.status + ':' + x.detail.slice(0, 100)).join(' || ')}`
  if (scene.startsWith('compost')) say = `kit ${kit(tb.bag)} -> ${kit(ta.bag)} apple ${tb.bag.apple ?? 0}->${ta.bag.apple ?? 0} oak_sapling ${tb.bag.oak_sapling ?? 0}->${ta.bag.oak_sapling ?? 0} bread ${ta.bag.bread ?? 0} dried_kelp ${ta.bag.dried_kelp ?? 0} swords ${sw(ta.bag)} bone_meal ${ta.bag.bone_meal ?? 0} level ${composterNow} | ${rows.filter(x => x.name === '_compost').map(x => x.status + ':' + x.detail.slice(0, 200)).join(' || ')}`
  if (scene === 'drop') say = `bag{${diff(tb.bag, ta.bag)}} ground-after[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] pickups=${JSON.stringify(r.pickups)}`
  console.log(`${r.id.padEnd(20)} ended=${r.ended} ${r.difficulty} kit=${JSON.stringify(kitRows)} ground[${diff(tb.ground, ta.ground)}] | ${say}`)
}

async function main () {
  for (const t = Date.now(); ;) {
    const pl = rcon('list')[0].reply
    if (/There are 0 of/.test(pl)) break
    if (Date.now() - t > 3600000) throw new Error('sandbox not empty')
    console.log('waiting:', pl.trim()); await sleep(20000)
  }
  rcon('forceload add 688 688 712 712')   // the arena's chunks stay loaded whoever stands where (a first trial raced the tp)
  await new Promise((resolve, reject) => { brainServer.once('error', reject); brainServer.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  console.log(`arm=${ARM} root=${BOT_ROOT} server=${SERVER}`)
  for (let k = 0; k < REPS; k++) for (const scene of SCENES) {
    try { await runTrial(scene, k) } catch (e) { console.log(`${ARM}:${scene}:${k} TRIAL FAILED: ${e.message}`); await stopBot().catch(() => {}) }
  }
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { brainServer.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.pkab-${ARM}-${SERVER}`) } catch {}
  try { rcon('difficulty peaceful') } catch {}   // a non-peaceful scene never leaves the sandbox hard
  try { rcon('forceload remove 688 688 712 712') } catch {}
  try { rcon('kill @e[type=!player,x=700,y=120,z=700,distance=..30]', 'fill 688 120 688 712 130 712 minecraft:air', 'fill 688 119 688 712 119 712 minecraft:stone') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
