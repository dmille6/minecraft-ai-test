// SANDBOX-ONLY end-to-end proof of shop-01 (the building tier's workshop: docs/reports/building-tier-2026-10-23.md sections 4-5;
// branch shop-on-7049da1). mats-e2e.cjs's harness: ONE FRESH BOT from <botRoot> (unmodified; trace.cjs only observes packets),
// the scene set by RCON, the SERVER's truth before and after. Nothing is queued to the model (every model decision is `status`
// or a short walk): the town plan, the siting and every placement must be the bot's OWN.
//
//   node shop-e2e.cjs <botRoot> <scene,...> [server]      (CRAFT_REPO=<this checkout, with sandbox/run-bot.sh>)
//
// THE BUILD decides the expectation: a <botRoot> whose bots/src/shop.mjs exists is the CANDIDATE (CANDIDATE_PASS / FAIL); any
// other is the BASE, run as the POSITIVE CONTROL of the instrument (BASE_SHAPE when nothing is built and the stock is as it was).
//
// scenes:
//   shop     SHOP-E2E: bare flat ground ±56 around home, two town chests holding the workshop's stock (89+ stone bricks, planks,
//            glass panes, cut copper, torches, 2 furnaces, a table -- every part at mats-01's buffer, so the materials job makes
//            nothing), NO plan and NO record. The bot plans the town (townplan-01), sites the workshop (buildsite.mjs on the live
//            world), draws the bill and builds it. PASS: a `_structure_complete` row; EVERY record cell reads, by RCON, as its
//            role's block (the server's word, cell by cell); the town and the bag together lost exactly the bill; nothing judged
//            on the ground; EVERY block_place the bot wrote carried a sequence and was ACKNOWLEDGED (acknowledge_player_digging
//            >= it) within 5 s (design 4.1: Paper must show the server acknowledges every use-item-on by sequence).
//   On the BASE: no `_build*` row, no record file, the stock unchanged: the base builds nothing.
//
// FOUND=off and SMELT_JOB=0 on BOTH arms: found-01's stations would be crafted from the bill's own planks and cobble in the bag,
// and the town smelt job's drain is not this scene's subject (their composition with the workshop is the unit tests' and the
// canary's). RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. sandbox5..8 only.
// Refuses to run unless a sandbox lock covering SERVER has `shop` as its owner's first word (sandbox/lib/sbxlock.cjs).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const sbx = require('../lib/sbxlock.cjs')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox5'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node shop-e2e.cjs <botRoot> <scenes> [server]')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => /^sandbox[5-8]$/.test(n)))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const TRACE = path.join(R, 'sandbox/shop/trace.cjs')
const NAME = process.env.SH_BOT_NAME || 'sandbox-Shop'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/shop-e2e`
const RES = `${OUTDIR}/results.jsonl`
const BRAIN_PORT = Number(process.env.SH_BRAIN_PORT || (11690 + Number(String(SERVER).replace('sandbox', ''))))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ENV_REL = `sandbox/.env.shop-${SERVER}-${process.pid}`
const CANDIDATE = fs.existsSync(path.join(BOT_ROOT, 'bots/src/shop.mjs'))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-shop-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const rconMany = cmds => { const out = []; for (let i = 0; i < cmds.length; i += 40) out.push(...rcon(...cmds.slice(i, i + 40))); return out }

// ---------------------------------------------------------------- arena and scene
const HOME = { x: 760, y: 120, z: 760 }
const A0 = 704, A1 = 816, FLOOR = 119, TOP = 140
const CHEST_A = { x: 763, y: 120, z: 757 }
const CHEST_B = { x: 762, y: 120, z: 760 }
const STAND = { x: 760.5, y: 120, z: 760.5 }
const at = c => `${c.x} ${c.y} ${c.z}`
const stacks = (id, n) => { const o = []; while (n > 0) { o.push([id, Math.min(64, n)]); n -= 64 } return o }
const BAG = [['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ['bread', 5]]
const SPEC = {
  shop: {
    chestA: [...stacks('stone_bricks', 128), ...stacks('oak_planks', 128), ...stacks('cobblestone', 320)],
    chestB: [...stacks('glass_pane', 32), ...stacks('cut_copper', 32), ...stacks('torch', 64), ['furnace', 2], ['crafting_table', 1]],
  },
}
// the bill of workshop@1 on flat ground (no fill): the names the town + bag must lose exactly
const BILL = { stone_bricks: 89, oak_planks: 49, glass_pane: 4, cut_copper: 20, torch: 2, furnace: 2, crafting_table: 1 }
const ROLE_BLOCK = { base: 'stone_bricks', step: 'stone_bricks', wall: 'oak_planks', window: 'glass_pane', trim: 'cut_copper', roof: 'oak_planks', furnace: 'furnace', table: 'crafting_table', light: 'torch', fill: 'cobblestone' }
// THE SERVER'S OWN NAMES for a role's block (r2, Paper r2: a torch clicked onto a side face IS a wall_torch -- the instrument
// asked for `torch` and scored two correct cells wrong); cut copper may weather or be waxed. The first is ROLE_BLOCK's.
const ROLE_OK = role => (role === 'light' ? ['torch', 'wall_torch'] : role === 'trim' ? ['cut_copper', 'exposed_cut_copper', 'weathered_cut_copper', 'oxidized_cut_copper', 'waxed_cut_copper', 'waxed_exposed_cut_copper', 'waxed_weathered_cut_copper', 'waxed_oxidized_cut_copper'] : [ROLE_BLOCK[role]])
const WINDOW_MS = Number(process.env.SH_WINDOW_MS || 40 * 60000)
const BASE_WINDOW_MS = Number(process.env.SH_BASE_WINDOW_MS || 12 * 60000)

function arenaCmds () {
  const c = [`forceload add ${A0} ${A0} ${A1} ${A1}`, `kill @e[type=!player,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..80]`]
  c.push(`fill ${A0} ${FLOOR} ${A0} ${A1} ${FLOOR} ${A1} minecraft:stone`)
  for (let y = FLOOR + 1; y <= TOP; y += 2) c.push(`fill ${A0} ${y} ${A0} ${A1} ${Math.min(y + 1, TOP)} ${A1} minecraft:air`)
  c.push(`fill ${A0} ${FLOOR - 1} ${A0} ${A1} ${FLOOR - 1} ${A1} minecraft:stone`)
  return c
}
function bagCmds () {
  const c = [`clear ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`]
  BAG.forEach(([id, n], s) => c.push(`item replace entity ${NAME} container.${s} with minecraft:${id} ${n}`))
  return c
}
const sceneCmds = spec => [
  `setblock ${at(CHEST_A)} minecraft:chest[facing=west]`,
  `setblock ${at(CHEST_B)} minecraft:chest[facing=west]`,
  ...spec.chestA.map(([id, n], s) => `item replace block ${at(CHEST_A)} container.${s} with minecraft:${id} ${n}`),
  ...spec.chestB.map(([id, n], s) => `item replace block ${at(CHEST_B)} container.${s} with minecraft:${id} ${n}`),
]

// ---------------------------------------------------------------- oracle (the server's slots and cells, never the bot's claim)
const parseItem = seg => { const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]; return id ? { id, count: +((seg.match(/count: (\d+)/) || [])[1] || 1) } : null }
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(CHEST_A)} Items[{Slot:${s}b}]`)
  for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(CHEST_B)} Items[{Slot:${s}b}]`)
  const iGround = cmds.length
  cmds.push(`execute as @e[type=item,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..80] run data get entity @s Item`)
  const r = rconMany(cmds)
  const SLOT_OK = /has the following (entity|block) data|Found no elements matching/
  for (let i = 0; i < iGround; i++) if (!SLOT_OK.test(r[i]?.reply || '')) throw new Error(`oracle read failed: ${r[i]?.cmd} => ${JSON.stringify(r[i]?.reply ?? null)}`)
  const pick = (q, re) => (re.test(q?.reply || '') ? parseItem(q.reply) : null)
  const tot = list => { const t = {}; for (const it of list) if (it) t[it.id] = (t[it.id] || 0) + it.count; return t }
  const bag = tot(r.slice(0, 36).map(q => pick(q, /has the following entity data/)))
  const a = tot(r.slice(36, 63).map(q => pick(q, /has the following block data/)))
  const b = tot(r.slice(63, 90).map(q => pick(q, /has the following block data/)))
  const ground = tot((r[iGround]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem))
  return { bag, a, b, ground }
}
const sum = (...os) => { const t = {}; for (const o of os) for (const [k, v] of Object.entries(o)) t[k] = (t[k] || 0) + v; return t }
const diff = (a, b) => Object.keys({ ...a, ...b }).map(n => [n, (b[n] || 0) - (a[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
const AMBIENT = /^(stick|apple|[a-z_]+_sapling|[a-z_]+_leaves|leaf_litter)$/

/** The record's head in the bot's pool state (the chain's last generation that links: prev = the previous). */
function recordOf (poolDir) {
  let names = []
  try { names = fs.readdirSync(poolDir) } catch { return null }
  const gens = names.map(n => /^project-760_120_760\.shop\.g(\d+)\.json$/.exec(n)).filter(Boolean).map(m => Number(m[1])).sort((x, y) => x - y)
  let head = null
  for (const g of gens) { try { const r = JSON.parse(fs.readFileSync(path.join(poolDir, `project-760_120_760.shop.g${g}.json`), 'utf8')); if (!head ? r.prev === null : r.prev === head.gen) head = r } catch { /* skipped */ } }
  return head
}
/** Every record cell by RCON -> { ok, bad: [cell: want] }. */
function cellsCheck (rec) {
  const asks = rec.cells.flatMap((c, i) => ROLE_OK(c.role).map(n => ({ i, cmd: `execute if block ${c.at[0]} ${c.at[1]} ${c.at[2]} minecraft:${n}` })))
  const r = rconMany(asks.map(a => a.cmd))
  const ok = new Set(asks.filter((a, j) => /Test passed/.test(r[j]?.reply || '')).map(a => a.i))
  const bad = []
  rec.cells.forEach((c, i) => { if (!ok.has(i)) bad.push(`${c.at.join(',')}:${ROLE_BLOCK[c.role]}`) })
  return { ok: bad.length === 0, bad, n: rec.cells.length }
}
/** Every BUILDER click (a block_place carrying a sequence > 0: the builder's own) was acknowledged (an ack >= it) within 5 s.
 *  A sequence-0 block_place is mineflayer's own activateBlock (a chest open for the withdraw, Paper r2: 4 of them, held item a
 *  pickaxe) -- counted and shown as `foreign`, not judged (the builder never writes sequence 0). */
function acksCheck (trace) {
  const ev = lines(trace).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const all = ev.filter(e => e.pkt === 'block_place'), acks = ev.filter(e => e.pkt === 'ack')
  const places = all.filter(p => Number.isInteger(p.seq) && p.seq > 0)
  const unacked = places.filter(p => !acks.some(a => a.ts >= p.ts && a.ts - p.ts <= 5000 && a.seq >= p.seq))
  return { places: places.length, foreign: all.length - places.length, acks: acks.length, unacked: unacked.length, first: unacked.slice(0, 3).map(p => `seq=${p.seq}@${JSON.stringify(p.loc)}`) }
}

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const jl = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const WANT = /^(_build|_build_seg|_build_visit|_build_mode|_structure_complete|_shop_skip|_townplan|_townplan_mode|_death|build_shop|_mats_skip|_make_material)$/
const skillRows = f => jl(f).filter(r => r.skill && WANT.test(r.skill.name)).map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '').slice(0, 400) }))
async function waitFor (pred, ms, step = 1000) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

let brainN = 0
const WANDER = [{ x: 756, y: 120, z: 756 }, { x: 764, y: 120, z: 756 }]
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = { skill: 'status', args: {} }
    if (brainN++ % 2) { const c = WANDER[(brainN >> 1) % 2]; decision = { skill: 'goto', args: { x: c.x, y: c.y, z: c.z } } }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})

let bot = null
async function stopBot (signal = 'SIGTERM') {
  try { bot && bot.kill(signal) } catch {}
  bot = null
  await waitFor(() => /There are 0 of/.test(rcon('list')[0].reply), 30000, 1000)
}
function startBot (envRel, botOut, trace) {
  const bo = fs.openSync(botOut, 'a')
  const seen = lines(botOut).filter(l => /spawned pos=/.test(l)).length
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${TRACE}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  let spawnErr = null
  bot.on('error', e => { spawnErr = e })
  return waitFor(() => spawnErr || lines(botOut).filter(l => /spawned pos=/.test(l)).length > seen, 90000, 300).then(v => { if (!v || spawnErr) throw new Error(`no spawn${spawnErr ? `: ${spawnErr.message}` : ''}`) })
}

async function runScene (scene) {
  const spec = SPEC[scene]
  if (!spec) throw new Error(`unknown scene ${scene}`)
  const tag = `${scene}-${CANDIDATE ? 'cand' : 'base'}-${SERVER}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/shop-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/shop-e2e/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const pool = `sbxsh-${tag}`
  const poolDir = `${R}/sandbox/state/_pool-${pool}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/shop-${tag}`); set('MEMORY_POOL', pool)
  set('MEMORY_SCOPE', 'shared'); set('MINECRAFT_PORT', PORTS[SERVER]); set('STUCK_SECONDS', 20); set('PLANT_ENABLED', 0); set('PLINTH_FIRST', 0)
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`); set('MAX_CONSECUTIVE_FAILURES', 50)
  set('FOUND', 'off'); set('SMELT_JOB', 0); set('SHOP_COOLDOWN_MS', 60000)
  for (const ax of ['X', 'Y', 'Z']) { set(`HOME_${ax}`, HOME[ax.toLowerCase()]); set(`BOARD_${ax}`, HOME[ax.toLowerCase()]) }
  fs.writeFileSync(`${R}/${ENV_REL}`, env + '\n')
  await startBot(ENV_REL, botOut, trace)
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`, `effect clear ${NAME}`, 'difficulty peaceful')
  await sleep(1500)
  const built = [...rconMany(arenaCmds()), ...rconMany(bagCmds()), ...rconMany(sceneCmds(spec))]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected|Too many blocks/i.test(x.reply) && !/^(kill|forceload) /.test(x.cmd))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.slice(0, 3).map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  await sleep(1500)
  const before = snapshot()
  const t0 = Date.now()
  const winMs = CANDIDATE ? WINDOW_MS : BASE_WINDOW_MS
  const done = await waitFor(() => (CANDIDATE ? skillRows(skillLog).some(r => r.ts >= t0 && r.name === '_structure_complete') : false), winMs, 5000)
  if (done) await sleep(8000)
  const after = snapshot()
  const rows = skillRows(skillLog).filter(r => r.ts >= t0 - 5000 || /_mode$/.test(r.name))
  await stopBot()
  try { fs.unlinkSync(`${R}/${ENV_REL}`) } catch {}
  const rec = recordOf(poolDir)
  const tb = sum(before.a, before.b, before.bag), ta = sum(after.a, after.b, after.bag)
  const out = { pass: false, why: [] }
  const need = (ok, why) => { if (!ok) out.why.push(why) }
  const judged = Object.fromEntries(Object.entries(after.ground).filter(([n]) => !AMBIENT.test(n)))
  let cells = null, acks = acksCheck(trace)
  if (CANDIDATE) {
    need(!!done, 'a _structure_complete row inside the window')
    need(!!rec, 'the record exists in the pool state')
    if (rec) { cells = cellsCheck(rec); need(cells.ok, `every record cell reads its role's block (${cells.bad.length} of ${cells.n} wrong: ${cells.bad.slice(0, 5).join(' ')})`) }
    for (const [n, c] of Object.entries(BILL)) need((ta[n] || 0) - (tb[n] || 0) === -c, `${n}: town + bag ${(ta[n] || 0) - (tb[n] || 0)} (the bill ${-c})`)
    need(!Object.keys(judged).length, `nothing judged on the ground (${diff({}, judged)})`)
    need(acks.places > 0 && acks.unacked === 0, `every block_place acknowledged by sequence (${acks.places} sent, ${acks.unacked} not: ${acks.first.join(' ')})`)
    out.pass = !out.why.length
    out.verdict = out.pass ? 'CANDIDATE_PASS' : 'FAIL'
  } else {
    need(!rows.some(r => /^_build|^_structure/.test(r.name)), 'no _build row on the base')
    need(!rec, 'no record on the base')
    for (const n of Object.keys(BILL)) need((ta[n] || 0) === (tb[n] || 0), `${n} unchanged (${(ta[n] || 0) - (tb[n] || 0)})`)
    out.pass = !out.why.length
    out.verdict = out.pass ? 'BASE_SHAPE' : 'BASE_UNEXPECTED'
  }
  const r = { scene, tag, candidate: CANDIDATE, server: SERVER, done: !!done, windowMs: Date.now() - t0, verdict: out,
    sha: (() => { try { return execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '?' } })(),
    record: rec ? { sector: rec.sector, source: rec.sector_source, anchor: rec.anchor, orient: rec.orient, s: rec.s, gen: rec.gen, complete: rec.structure_complete } : null,
    cells: cells && { n: cells.n, bad: cells.bad.length }, acks, d: { stock: diff(tb, ta), ground: diff({}, after.ground) }, rows }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  console.log(`${scene.padEnd(6)} ${out.verdict} done=${r.done} record=${JSON.stringify(r.record)} cells=${JSON.stringify(r.cells)} acks=${JSON.stringify({ places: acks.places, foreign: acks.foreign, acks: acks.acks, unacked: acks.unacked })} d(stock){${r.d.stock}} ground{${r.d.ground}}` + (out.why.length ? `\n   why: ${out.why.join('; ')}` : ''))
  console.log('   rows: ' + rows.filter(x => /_build_visit|_structure_complete|_shop_skip|_townplan$/.test(x.name)).map(x => `${x.name}:${x.status}:${x.detail.slice(0, 200)}`).join(' || '))
  return out.pass
}

let arenaOwned = false
async function main () {
  sbx.requireSandboxLock(SERVER, 'shop')
  const pl = rcon('list')[0].reply; if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  fs.mkdirSync(OUTDIR, { recursive: true })
  arenaOwned = true
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  console.log(`root=${BOT_ROOT} build=${CANDIDATE ? 'CANDIDATE' : 'BASE'} server=${SERVER} scenes=${SCENES_S}`)
  let ok = true
  for (const s of SCENES_S.split(',')) {
    try { ok = (await runScene(s)) && ok } catch (e) { ok = false; console.log(`${s} SCENE FAILED: ${e.message}`); await stopBot().catch(() => {}) }
  }
  return ok
}
async function cleanup () {
  if (arenaOwned) await stopBot().catch(() => {})
  try { brain.close() } catch {}
  try { fs.unlinkSync(`${R}/${ENV_REL}`) } catch {}
  // SHOP_KEEP=1 leaves the built workshop standing (and the arena force-loaded until a later scene's set-up clears it) for the
  // structure count's positive control on the saved world (read r2 review, Claude Q3); the next scene's set-up refills the arena
  if (arenaOwned && process.env.SHOP_KEEP === '1') { try { rconMany(['save-all flush']) } catch {} return }
  if (arenaOwned) { try { rconMany([`kill @e[type=!player,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..80]`, ...arenaCmds().slice(2, -1), `forceload remove ${A0} ${A0} ${A1} ${A1}`]) } catch {} }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(ok => finish(ok ? 0 : 2), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
process.on('SIGHUP', () => finish(1))
