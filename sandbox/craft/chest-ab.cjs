// SANDBOX-ONLY chest-full A/B driver (chestfull-01, 10-05): ONE FRESH BOT PER TRIAL from <botRoot> (unmodified; trace.cjs
// only observes packets), the scene set by RCON once the bot is there, `deposit` queued through the embedded brain, and the
// SERVER's truth before and after: every bag slot, every slot of every chest in the scene, every chest block within five
// rings of them (a new chest is found by reading the world, never from the row), the floor under each new chest, and the
// item entities on the ground (during, and after logout).
//
//   node chest-ab.cjs <arm: cand|ctrl> <botRoot> <reps> <scene,scene,...> [server]
//
// Town for the bot: home = 700 120 700 (the stand); town chests within 16 of home. A chest is "full" when all 27 slots
// hold 64 diorite (diorite is never bankable, so nothing the bot carries can go in). The bag's bankables are coal and
// raw_iron (STANDING_TARGETS; not scaffold, so no reserve holds them back).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, REPS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node chest-ab.cjs <arm> <botRoot> <reps> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const REPS = Number(REPS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Draw'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/chest-ab`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-chab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
const HOME = { x: 700, y: 120, z: 700 }
const STAND = { x: 700.5, y: 120, z: 700.5 }
const A = { x: 703, y: 120, z: 700 }          // the nearest town chest
const B = { x: 697, y: 120, z: 705 }          // a second town chest (not beside A: no double chest)
const F = { x: 742, y: 120, z: 700 }          // a FAR chest, 42 from home (beyond STORAGE_NEAR 16)
const stacks = (id, n) => Array.from({ length: n }, () => [id, 64])
const FULL = stacks('diorite', 27)
const ROOMY = stacks('diorite', 10)
const BANKABLE = [['coal', 64], ['coal', 64], ['raw_iron', 32]]
const P = q => `${q.x} ${q.y} ${q.z}`
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z
// THE LEDGER, pre-seeded for the budget scene: four claims in the last 24 h (>= 10 min ago) at cells far outside the
// loaded arena (reconcile reads an unloaded cell as unknown and leaves it) -> chestBudget: "used its new-chest budget".
const seedLedger = (dir, n = 4) => {
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 1; i <= n; i++) {
    fs.writeFileSync(path.join(dir, `town-chest-${HOME.x}_${HOME.y}_${HOME.z}.c${i}.json`),
      JSON.stringify({ x: 2000 + i, y: 64, z: 2000, world: null, at: new Date(Date.now() - (15 + 10 * i) * 60000).toISOString() }))
  }
}
const SPEC = {
  // (a) every town chest full; the bot CARRIES a chest and has no wood: place it next to the bank and deposit
  'carried': { bag: [...BANKABLE, ['chest', 1]], chests: [[A, FULL], [B, FULL]] },
  // (b) every town chest full; no chest carried, planks for one (+ a table's worth): craft one within budget, place it
  'craft': { bag: [...BANKABLE, ['oak_planks', 16]], chests: [[A, FULL], [B, FULL]] },
  // (c) the budget is spent (4 claims in 24 h): refuse with a remedy; then the CHAIN -- deposit again (x2), then a goto
  'budget': { bag: [...BANKABLE, ['chest', 1]], chests: [[A, FULL], [B, FULL]], ledger: 4, chain: ['deposit', 'deposit coal', 'goto 698 120 698'] },
  // (d) a bank with room: the ordinary deposit, nothing new built
  'roomy': { bag: [...BANKABLE, ['chest', 1]], chests: [[A, ROOMY], [B, FULL]] },
  // (e) the site rules, around the ONE town chest (so it is the anchor): dirt_path floors in a 5x5 around A, a composter
  //     3 east of A, a crafting table four rings south of A
  'site': { bag: [...BANKABLE, ['chest', 1]], chests: [[A, FULL]], paths: { x0: 701, x1: 705, z0: 698, z1: 702 },
    composter: { x: 706, y: 120, z: 701 }, table: { x: 701, y: 120, z: 696 } },
  // (e2) off-site: the bot 40 blocks from home beside a FULL far chest, carrying a chest AND planks: never a chest there
  'far': { bag: [...BANKABLE, ['chest', 1], ['oak_planks', 16]], chests: [[A, FULL], [B, FULL], [F, FULL]], stand: { x: 740.5, y: 120, z: 700.5 } },
}
// EVERY scene has a town composter (here unless the scene places its own): without one, composter.mjs's build_composter
// town order runs first and turns the bag's planks into slabs (pilot 10-05: both arms, the craft and far scenes).
const COMPOSTER = { x: 693, y: 120, z: 694 }
const WINDOW_MS = 200000   // the deposit's watchdog is 180 s
function arenaCmds () {
  return ['kill @e[type=!player,x=718,y=120,z=700,distance=..45]',
    'fill 688 120 688 748 130 712 minecraft:air', 'fill 688 119 688 748 119 712 minecraft:stone']
}
const itemArg = (id, dmg) => `minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''}`
function sceneCmds (spec) {
  const c = []
  if (spec.paths) { const p = spec.paths; c.push(`fill ${p.x0} 119 ${p.z0} ${p.x1} 119 ${p.z1} minecraft:dirt_path`) }
  c.push(`setblock ${P(spec.composter ?? COMPOSTER)} minecraft:composter`)
  if (spec.table) c.push(`setblock ${P(spec.table)} minecraft:crafting_table`)
  // chests last, each on a stone floor and filled in the same batch
  for (const [q, items] of spec.chests) {
    c.push(`setblock ${q.x} 119 ${q.z} minecraft:stone`, `setblock ${P(q)} minecraft:chest[facing=west]`)
    items.forEach(([id, n, dmg], s) => c.push(`item replace block ${P(q)} container.${s} with ${itemArg(id, dmg)} ${n}`))
  }
  return c
}
function bagCmds (spec) {
  const st = spec.stand ?? STAND
  const c = [`clear ${NAME}`, `tp ${NAME} ${st.x} ${st.y} ${st.z}`]
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
// every cell within five rings (Chebyshev) of the scene's chests, at y 120..121: wherever a new chest could be
function scanCells (spec) {
  const seen = new Set(); const out = []
  for (const [q] of spec.chests) {
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) for (const y of [120, 121]) {
      const k = `${q.x + dx},${y},${q.z + dz}`
      if (!seen.has(k)) { seen.add(k); out.push({ x: q.x + dx, y, z: q.z + dz }) }
    }
  }
  // and around where the bot stands (the control's place() puts a chest beside the bot)
  const st = spec.stand ?? STAND
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (const y of [120, 121]) {
    const q = { x: Math.floor(st.x) + dx, y, z: Math.floor(st.z) + dz }; const k = `${q.x},${y},${q.z}`
    if (!seen.has(k)) { seen.add(k); out.push(q) }
  }
  return out
}
function snapshot (spec) {
  const cells = scanCells(spec)
  const r1 = rcon(...cells.flatMap(q => [`execute if block ${P(q)} minecraft:chest`, `execute if block ${P(q)} minecraft:trapped_chest`]))
  const found = cells.filter((q, i) => /passed/i.test(r1[2 * i]?.reply || '') || /passed/i.test(r1[2 * i + 1]?.reply || ''))
  const chestsAt = [...spec.chests.map(([q]) => q), ...found.filter(q => !spec.chests.some(([c]) => same(c, q)))]
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  for (const q of chestsAt) {
    cmds.push(`data get block ${P(q)} id`)
    for (let s = 0; s < 27; s++) cmds.push(`data get block ${P(q)} Items[{Slot:${s}b}]`)
    cmds.push(`execute if block ${q.x} ${q.y - 1} ${q.z} minecraft:dirt_path`)
  }
  cmds.push('execute as @e[type=item,x=718,y=120,z=700,distance=..45] run data get entity @s Item')
  cmds.push(`data get entity ${NAME} Pos`)
  const r = rcon(...cmds)
  let i = 0
  const bag = {}
  for (let s = 0; s < 36; s++, i++) { const it = /has the following entity data/.test(r[i]?.reply || '') ? parseItem(r[i].reply) : null; if (it) bag[s] = it }
  const chests = {}
  for (const q of chestsAt) {
    const idR = r[i++]?.reply || ''
    const items = {}
    for (let s = 0; s < 27; s++, i++) { const it = /has the following block data/.test(r[i]?.reply || '') ? parseItem(r[i].reply) : null; if (it) items[s] = it }
    const pathFloor = /passed/i.test(r[i++]?.reply || '')
    chests[`${q.x},${q.y},${q.z}`] = { block: (idR.match(/"minecraft:([a-z_]+)"/) || [])[1] || '?', items, used: Object.keys(items).length, pathFloor,
      original: spec.chests.some(([c]) => same(c, q)) }
  }
  const ground = (r[i++]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  const posR = r[i]?.reply || ''
  const pos = ((posR.match(/\[([^\]]+)\]/) || [])[1] || '').replace(/d/g, '')
  return { bag, chests, ground, pos, online: /has the following entity data/.test(posR), bagUsed: Object.keys(bag).length, scanned: cells.length }
}
const tot = list => { const t = {}; for (const it of list) t[it.id] = (t[it.id] || 0) + it.count; return t }
const totals = snap => ({ bag: tot(Object.values(snap.bag)), chests: tot(Object.values(snap.chests).flatMap(c => Object.values(c.items))), ground: tot(snap.ground) })
const all = t => { const o = {}; for (const part of Object.values(t)) for (const [k, n] of Object.entries(part)) o[k] = (o[k] || 0) + n; return o }
const diff = (a, b) => Object.keys({ ...a, ...b }).map(n => [n, (b[n] || 0) - (a[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const NOISE = /^(_affordance_scan|_progress_restored|_reach_probe|_path_reset)$/
function skillRows (file) {
  return lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill && !NOISE.test(r.skill.name))
    .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, trigger: r.trigger, ms: r.skill.duration_ms, fail: r.skill.fail_class,
      detail: String(r.skill.detail || '').slice(0, 400), inv: (r.bot || {}).inventory }))
}
const traceEv = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE QUEUE BRAIN, IN THIS PROCESS: each decision gets the next queued line, else 'status'. It also records the prompt's
// lines that mention a deposit (the refusal chain: a closed bank must not be advertised as the next step).
let brainQueue = []; let brainLog = null
const brainServer = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const prompt = msgs.map(m => String(m.content || '')).join('\n')
    const sentinel = (prompt.match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const line = brainQueue.shift() || 'status'
    const [skill, ...rest] = line.split(/\s+/); const args = {}
    if (skill === 'goto') { args.x = +rest[0]; args.y = +rest[1]; args.z = +rest[2] }
    else if (rest.length === 1) args.item = rest[0]
    else if (rest.length === 2 && /^\d+$/.test(rest[0])) { args.count = +rest[0]; args.item = rest[1] }
    const user = String((msgs.filter(m => m.role === 'user').pop() || {}).content || '')
    const depLines = user.split('\n').filter(l => /deposit|bank|chest/i.test(l)).map(l => l.slice(0, 220))
    if (brainLog) fs.appendFileSync(brainLog, `${new Date().toISOString()} decision: ${line} | prompt lines naming deposit/bank/chest: ${JSON.stringify(depLines.slice(-8))}\n`)
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
// how many `verb` decisions have ended: a skill result line or an admission rejection
const endedCount = (botOut, verb) => lines(botOut).filter(l => new RegExp(`skill ${verb} ->|rejected why=.*"skill":"${verb}"`).test(l)).length

async function runTrial (scene, k) {
  const spec = SPEC[scene]
  const tag = `${ARM}-${scene}-${k}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/chest-ab/${tag}`
  const skillLog = `${R}/sandbox/log/chest-ab/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const envRel = `sandbox/.env.chab-${ARM}`
  const pool = `sbxchab-${tag}`
  const stateRel = `./sandbox/state/chest-ab-${tag}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', stateRel); set('MEMORY_POOL', pool)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000)
  set('STUCK_SECONDS', 20)   // the fleet's value
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  // the pool state dir (worldfacts.mjs poolStateDir): dirname(STATE_DIR)/_pool-<pool>
  const poolDir = path.join(R, 'sandbox/state', `_pool-${pool}`)
  if (spec.ledger) seedLedger(poolDir, spec.ledger)
  brainQueue = []; brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  const st = spec.stand ?? STAND
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${st.x} ${st.y} ${st.z}`, `effect clear ${NAME}`)
  await sleep(3000)
  const built = [...rcon(...arenaCmds()), ...rcon(...bagCmds(spec)), ...rcon(...sceneCmds(spec))]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected/i.test(x.reply) && !/^kill /.test(x.cmd))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  await sleep(2500)
  const before = snapshot(spec)
  const t0 = Date.now()
  const marks = {}
  brainQueue.push('deposit')
  await waitFor(() => endedCount(botOut, 'deposit') >= 1, WINDOW_MS)
  marks.deposit1Ms = Date.now() - t0
  await sleep(1500)
  const mid = snapshot(spec)
  for (const cmd of spec.chain ?? []) {
    const verb = cmd.split(/\s+/)[0]
    const n0 = endedCount(botOut, verb); const tq = Date.now()
    brainQueue.push(cmd)
    const ok = await waitFor(() => endedCount(botOut, verb) > n0, 90000)
    ;(marks.chain ??= []).push({ cmd, atMs: tq - t0, tookMs: Date.now() - tq, ended: !!ok })
    await sleep(1000)
  }
  if (spec.chain) { await sleep(20000); marks.idleAfterChainMs = 20000 }   // nothing queued: does anything loop back into a deposit?
  const after = snapshot(spec)
  const rows = skillRows(skillLog)
  await stopBot()
  await sleep(1500)
  const afterLogout = snapshot(spec)
  try { fs.unlinkSync(`${R}/${envRel}`) } catch {}
  const tr = traceEv(trace).filter(e => e.ts >= t0)
  const tb = totals(before), ta = totals(after), tl = totals(afterLogout)
  const ledger = (() => { try { return fs.readdirSync(poolDir).filter(f => /^town-chest-/.test(f)) } catch { return [] } })()
  const newChests = Object.entries(after.chests).filter(([, c]) => !c.original).map(([at, c]) => {
    const [x, y, z] = at.split(',').map(Number)
    const d = q => q ? Math.round(Math.hypot(x - q.x, y - q.y, z - q.z) * 10) / 10 : null
    return { at, block: c.block, used: c.used, items: tot(Object.values(c.items)), pathFloor: c.pathFloor, home_d: d(HOME), composter_d: d(spec.composter ?? COMPOSTER),
      table_d: d(spec.table), beside: spec.chests.filter(([q]) => Math.abs(q.x - x) + Math.abs(q.z - z) === 1 && q.y === y).map(([q]) => P(q)) }
  })
  const r = { id: `${ARM}:${scene}:${k}`, arm: ARM, scene, k, tag, sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    marks, windowMs: Date.now() - t0, before: { ...before, totals: tb }, mid: { ...mid, totals: totals(mid) }, after: { ...after, totals: ta },
    afterLogout: { ground: afterLogout.ground, totals: { chests: tl.chests, ground: tl.ground } }, newChests, ledger,
    conserved: diff(all(tb), all(ta)) || 'yes',
    rows: rows.filter(x => /deposit|chest|craft|place|_town|unsettled|_pickups|_death|reflex|_stuck|_admission|reject|goto/.test(x.name)),
    trace: { places: tr.filter(e => e.pkt === 'block_place').map(e => ({ t: e.ts - t0, loc: e.loc, feet: e.feet })),
      spawns: tr.filter(e => e.pkt === 'spawn_item').map(e => ({ t: e.ts - t0, x: e.x, y: e.y, z: e.z })) },
    out: lines(botOut).filter(l => /deposit|rejected|chest|bank|spawned/i.test(l)).map(l => l.slice(0, 300)).slice(-40) }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const nc = rows.filter(x => x.name === '_deposit_new_chest').map(x => `${x.status}:${x.detail.slice(0, 220)}`).join(' || ')
  const dep = rows.filter(x => x.name === 'deposit').map(x => `${x.status}/${x.fail ?? '-'}:${x.detail.slice(0, 160)}`).join(' || ')
  const rej = lines(botOut).filter(l => /rejected why=/.test(l)).map(l => l.slice(0, 200)).slice(-4).join(' || ')
  console.log(`${r.id.padEnd(16)} bag ${before.bagUsed}->${after.bagUsed} d(bag){${diff(tb.bag, ta.bag)}} d(chests){${diff(tb.chests, ta.chests)}} ground[${after.ground.map(g => g.id + 'x' + g.count).join(',')}]` +
    ` logout-ground[${afterLogout.ground.map(g => g.id + 'x' + g.count).join(',')}] conserved=${r.conserved} NEW=${JSON.stringify(newChests)} ledger=${ledger.length}` +
    ` marks=${JSON.stringify(marks)}\n    new_chest_rows: ${nc || '-'}\n    deposit: ${dep || '-'}\n    rejected: ${rej || '-'}`)
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
  try { fs.unlinkSync(`${R}/sandbox/.env.chab-${ARM}`) } catch {}
  try { rcon(...arenaCmds()) } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
