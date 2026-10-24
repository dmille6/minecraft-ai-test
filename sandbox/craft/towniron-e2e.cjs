// SANDBOX-ONLY end-to-end proof of towniron-01 (the town iron reserve: docs/reports/towniron-01-design-2026-10-23.md on branch
// towniron-on-6e1afb5). ironsmelt-e2e.cjs's harness: ONE FRESH REAL BOT PER SCENE from <botRoot> (unmodified; trace.cjs only
// observes packets), the scene set by RCON, and the SERVER's truth before and after (every bag slot, three town chests, the
// ground). Nothing is queued to the model (every model decision is `status` or a short walk): every effect is the bot's own order.
//
//   node towniron-e2e.cjs <botRoot> <scene,...> [server]      (CRAFT_REPO=<a main checkout with sandbox/run-bot.sh>)
//
// THE TOWN READS SHORT: the scene puts its iron and sticks into chest A by RCON, THEN the town index (townindex-01) is SEEDED
// under the live bot's own world identity (its `_plinthfirst_mode` licence row, w=<worldId>) with an observation of each of
// the three chests exactly as the server holds them at that moment (chest A's 20 ingots + 8 sticks, dirt elsewhere: 20 iron
// units over 3 known containers -> below the 64 reserve), and the reader's 30 s memo is waited out. The index tells the
// truth: seeded BEFORE the sticks (r1 Paper, 10-24 00:28Z), the toolkit's stick search read the town's complete stick count of 0
// (NEED_COUNT_COMPLETE) and found no candidate -- the scene's own blind spot, not the bot's.
// THE BUILD decides the expectation: a <botRoot> with bots/src/towniron.mjs is the CANDIDATE (CANDIDATE_PASS / FAIL); any other is
// the BASE, run as the POSITIVE CONTROL (BASE_SHAPE when the base does what the base does, else BASE_UNEXPECTED).
//
// scenes:
//   shovel   chest A 20 iron ingots + 8 sticks; a crafting table; the bag an iron pickaxe and axe, 5 cobblestone, NO shovel ->
//            CANDIDATE: a stone_shovel made, no iron_shovel, chest A's 20 ingots untouched; BASE: an iron_shovel made, chest A 19.
//   deliver  the bag past every rung before the town task (wood, dirt, sand, cobble, table, pickaxes, furnace, 3 iron ingots,
//            a bucket, an iron pickaxe) with iron ore under the arena (the task's means: ore in reach); after 60 s (the town
//            task the active task: the round recorded) the bag is given 19 raw iron in one stack -> CANDIDATE: `_deliver_iron`
//            banks the 19 (the own 3 are the ingots), the bag keeps its 3 ingots; BASE: the 19 raw iron stay in the bag.
//
// RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py <sandboxN> -`. sandbox5..8 only, sandbox-* names only.
// Refuses to run unless a sandbox lock covering SERVER has `towniron` as its owner's first word (sandbox/lib/sbxlock.cjs).
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const sbx = require('../lib/sbxlock.cjs')
const fs = require('fs'); const path = require('path')
const [BOT_ROOT, SCENES_S, SERVER = 'sandbox5'] = process.argv.slice(2)
if (!BOT_ROOT || !SCENES_S) throw new Error('usage: node towniron-e2e.cjs <botRoot> <scenes> [server]')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => /^sandbox[5-8]$/.test(n)))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')
const TRACE = path.join(R, 'sandbox/craft/trace.cjs')
const NAME = process.env.TI_BOT_NAME || 'sandbox-TIron'
if (!NAME.startsWith('sandbox-')) throw new Error('sandbox bot names only')
const OUTDIR = `${R}/sandbox/log/towniron-e2e`
const RES = `${OUTDIR}/results.jsonl`
const BRAIN_PORT = Number(process.env.TI_BRAIN_PORT || (11480 + Number(String(SERVER).replace('sandbox', ''))))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ENV_REL = `sandbox/.env.tiab-${SERVER}-${process.pid}`
const CANDIDATE = fs.existsSync(path.join(BOT_ROOT, 'bots/src/towniron.mjs'))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-tiab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}

// ---------------------------------------------------------------- arena and scenes
const HOME = { x: 820, y: 120, z: 820 }
const CHESTS = [{ x: 823, y: 120, z: 817 }, { x: 822, y: 120, z: 820 }, { x: 818, y: 120, z: 823 }]
const TABLE = { x: 819, y: 120, z: 818 }
const STAND = { x: 820.5, y: 120, z: 820.5 }
const at = c => `${c.x} ${c.y} ${c.z}`
const KIT0 = [['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ['torch', 8], ['bread', 5]]   // nothing for the kit to make
const PAST_RUNGS = [['dirt', 16], ['oak_log', 20], ['sand', 8], ['cobblestone', 30], ['crafting_table', 1], ['wooden_pickaxe', 1], ['stone_pickaxe', 1],
  ['furnace', 1], ['iron_ingot', 3], ['bucket', 1], ['iron_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ['coal', 4], ['bread', 5]]
const SPEC = {
  shovel: { bag0: KIT0, bag: [['iron_pickaxe', 1], ['iron_axe', 1], ['cobblestone', 5], ['torch', 8], ['bread', 5]], chestA: [['iron_ingot', 20], ['stick', 8]], ore: false },
  deliver: { bag0: PAST_RUNGS, bag: PAST_RUNGS, chestA: [], ore: true, give: ['raw_iron', 19] },
}
const WINDOW_MS = Number(process.env.TI_WINDOW_MS || 240000)
const arenaCmds = () => ['forceload add 804 804 836 836', `kill @e[type=!player,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..20]`,
  'fill 806 120 806 834 126 834 minecraft:air', 'fill 806 112 806 834 119 834 minecraft:stone']
const bagCmds = list => [`clear ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`, ...list.map(([id, n], s) => `item replace entity ${NAME} container.${s} with minecraft:${id} ${n}`)]
const chestCmds = () => [...CHESTS.map(c => `setblock ${at(c)} minecraft:chest[facing=west]`), ...CHESTS.map(c => `item replace block ${at(c)} container.0 with minecraft:dirt 5`),
  `setblock ${at(TABLE)} minecraft:crafting_table`]

// ---------------------------------------------------------------- oracle (the server's slots, never the bot's claim)
const parseItem = seg => {
  const id = (seg.match(/id: "minecraft:([a-z0-9_]+)"/) || [])[1]
  if (!id) return null
  return { id, count: +((seg.match(/count: (\d+)/) || [])[1] || 1) }
}
function snapshot () {
  const cmds = []
  for (let s = 0; s < 36; s++) cmds.push(`data get entity ${NAME} Inventory[{Slot:${s}b}]`)
  for (const c of CHESTS) for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(c)} Items[{Slot:${s}b}]`)
  cmds.push(`execute as @e[type=item,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..20] run data get entity @s Item`)
  const r = []
  for (let i = 0; i < cmds.length; i += 30) r.push(...rcon(...cmds.slice(i, i + 30)))
  const N = 36 + 27 * CHESTS.length
  const SLOT_OK = /has the following (entity|block) data|Found no elements matching/
  for (let i = 0; i < N; i++) {
    if (!SLOT_OK.test(r[i]?.reply || '')) throw new Error(`oracle read failed: ${r[i]?.cmd} => ${JSON.stringify(r[i]?.reply ?? null)}`)
    if (/has the following (entity|block) data/.test(r[i].reply) && !(parseItem(r[i].reply)?.count > 0)) throw new Error(`oracle read failed (unparseable item): ${r[i].cmd}`)
  }
  const gr = r[N]?.reply ?? null
  if (gr == null || /Cannot|Unknown|Incorrect/i.test(gr)) throw new Error(`oracle read failed: the ground => ${JSON.stringify(gr)}`)
  const ground = gr.split(/has the following entity data:/).slice(1).map(seg => { const it = parseItem(seg); if (!(it?.count > 0)) throw new Error('unparseable ground item'); return it })
  const bag = []; const chests = CHESTS.map(() => [])
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s].reply) ? parseItem(r[s].reply) : null; if (it) bag.push(it) }
  CHESTS.forEach((_, ci) => { for (let s = 0; s < 27; s++) { const q = r[36 + ci * 27 + s]; const it = /has the following block data/.test(q.reply) ? parseItem(q.reply) : null; if (it) chests[ci].push(it) } })
  return { bag, chests, ground }
}
const tot = list => { const t = {}; for (const it of list) t[it.id] = (t[it.id] || 0) + it.count; return t }
const totals = snap => ({ bag: tot(snap.bag), a: tot(snap.chests[0]), town: tot(snap.chests.flat()), ground: tot(snap.ground) })
const diff = (a, b) => Object.keys({ ...a, ...b }).map(n => [n, (b[n] || 0) - (a[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')

const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const jl = f => lines(f).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const skillRows = f => jl(f).filter(r => r.skill).map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || '').slice(0, 300), args: r.skill.args }))
async function waitFor (pred, ms, step = 500) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

// THE INDEX SEED (indexsearch-01's stock-e2e pattern): what the server holds in each chest, as an observation the index keeps
async function seedIndex (poolDir, world) {
  const TI = await import(path.join(BOT_ROOT, 'bots/src/townindex.mjs'))
  const hk = TI.indexHomeKey(HOME)
  fs.mkdirSync(poolDir, { recursive: true })
  for (const c of CHESTS) {
    const k = `${c.x},${c.y},${c.z}`
    const cmds = []; for (let s = 0; s < 27; s++) cmds.push(`data get block ${at(c)} Items[{Slot:${s}b}]`)
    const r = rcon(...cmds); const names = {}; let used = 0
    for (let s = 0; s < 27; s++) { const it = /has the following block data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) { used++; const e = (names[it.id] ??= [0, 0]); e[0] += it.count; e[1]++ } }
    TI.appendIndex(poolDir, hk, world, { t: 'obs', id: `scene-${k}-${Date.now()}`, k, h: [k], at: Date.now() - 1000, size: 27, used, names, bot: 'sandbox-scene', by: 'scene' })
  }
  return TI.indexRecords(poolDir, hk).length
}

// THE BRAIN, IN THIS PROCESS: status alternating with two short walks on the arena floor
let brainLog = null, brainN = 0
const WANDER = [{ x: 814, y: 120, z: 816 }, { x: 826, y: 120, z: 816 }]
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const all = msgs.map(m => String(m.content || '')).join('\n')
    const sentinel = (all.match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let decision = { skill: 'status', args: {} }
    if (brainN++ % 2) { const c = WANDER[(brainN >> 1) % 2]; decision = { skill: 'goto', args: { x: c.x, y: c.y, z: c.z } } }
    if (brainLog) fs.appendFileSync(brainLog, `${new Date().toISOString()} decision: ${decision.skill} | ${(all.match(/(GOAL|Goal|goal)[^\n]{0,120}/) || [''])[0]}\n`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox: idle', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})

let bot = null
async function stopBot () {
  try { bot && bot.kill('SIGTERM') } catch {}
  bot = null
  await waitFor(() => /There are 0 of/.test(rcon('list')[0].reply), 30000, 1000)
}

function verdict (scene, tb, ta, rows, done) {
  const out = { pass: false, why: [] }
  const need = (ok, why) => { if (!ok) out.why.push(why) }
  if (CANDIDATE) {
    need(rows.some(r => r.name === '_towniron_mode'), 'the licence row _towniron_mode was written')
    need(rows.some(r => r.name === '_town_iron' && /^state=low /.test(r.detail)), 'the bot read its town LOW (_town_iron state=low)')
    if (scene === 'shovel') {
      need((ta.bag.stone_shovel || 0) === 1, `a stone shovel made (${ta.bag.stone_shovel || 0})`)
      need(!(ta.bag.iron_shovel > 0), 'no iron shovel')
      need((ta.a.iron_ingot || 0) === 20, `chest A's 20 ingots untouched (${ta.a.iron_ingot || 0})`)
    } else {
      need(rows.some(r => r.name === '_deliver_iron' && r.status === 'success'), 'a _deliver_iron success row')
      need((ta.town.raw_iron || 0) - (tb.town.raw_iron || 0) === 19, `the town's raw iron +19 (${(ta.town.raw_iron || 0) - (tb.town.raw_iron || 0)})`)
      need((ta.bag.iron_ingot || 0) === 3 && !(ta.bag.raw_iron > 0), `the bag keeps its own 3 ingots, no raw iron left (${ta.bag.iron_ingot || 0}/${ta.bag.raw_iron || 0})`)
    }
    need(!Object.keys(ta.ground).length, `nothing on the ground (${diff({}, ta.ground)})`)
    out.pass = !out.why.length && done
    out.verdict = out.pass ? 'CANDIDATE_PASS' : 'FAIL'
  } else {
    if (scene === 'shovel') {
      need((ta.bag.iron_shovel || 0) === 1, `the base makes an IRON shovel (${ta.bag.iron_shovel || 0})`)
      need((ta.a.iron_ingot || 0) === 19, `from the town's iron (chest A ${ta.a.iron_ingot || 0})`)
    } else {
      need((ta.bag.raw_iron || 0) === 19, `the base keeps the 19 raw iron in the bag (${ta.bag.raw_iron || 0})`)
      need(!((ta.town.raw_iron || 0) > (tb.town.raw_iron || 0)), 'and banks none')
    }
    out.pass = !out.why.length && done
    out.verdict = out.pass ? 'BASE_SHAPE' : 'BASE_UNEXPECTED'
  }
  if (!done) out.why.push('the scene did not reach its completion condition inside the window')
  return out
}

async function runScene (scene) {
  const spec = SPEC[scene]
  if (!spec) throw new Error(`unknown scene ${scene}`)
  const tag = `${scene}-${CANDIDATE ? 'cand' : 'base'}-${SERVER}-${new Date().toISOString().replace(/[-:]/g, '').slice(9, 15)}`
  const logRel = `./sandbox/log/towniron-e2e/${tag}`
  const skillLog = `${R}/sandbox/log/towniron-e2e/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUTDIR}/bot-${tag}.out`; const trace = `${OUTDIR}/trace-${tag}.jsonl`
  const poolDir = `${R}/sandbox/state/towniron-pool-${tag}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/towniron-${tag}`); set('MEMORY_POOL', `sbxti-${tag}`); set('POOL_STATE_DIR', poolDir)
  set('MEMORY_SCOPE', 'shared'); set('MINECRAFT_PORT', PORTS[SERVER]); set('STUCK_SECONDS', 20); set('PLANT_ENABLED', 0); set('BOT_ROLE', 'gatherer')
  set('OLLAMA_BASE_URL', `http://127.0.0.1:${BRAIN_PORT}`); set('OLLAMA_BASE_URLS', `http://127.0.0.1:${BRAIN_PORT}`); set('MAX_CONSECUTIVE_FAILURES', 50)
  for (const ax of ['X', 'Y', 'Z']) { set(`HOME_${ax}`, HOME[ax.toLowerCase()]); set(`BOARD_${ax}`, HOME[ax.toLowerCase()]) }
  fs.writeFileSync(`${R}/${ENV_REL}`, env + '\n')
  brainLog = `${OUTDIR}/brain-${tag}.log`
  const bo = fs.openSync(botOut, 'a')
  const seen = lines(botOut).filter(l => /spawned pos=/.test(l)).length
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, ENV_REL], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${TRACE}`, CRAFT_TRACE: trace }, stdio: ['ignore', bo, bo] })
  let spawnErr = null
  bot.on('error', e => { spawnErr = e })
  if (!await waitFor(() => spawnErr || lines(botOut).filter(l => /spawned pos=/.test(l)).length > seen, 90000, 300) || spawnErr) { await stopBot(); throw new Error(`no spawn${spawnErr ? `: ${spawnErr.message}` : ''}`) }
  rcon(`gamemode survival ${NAME}`, `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`, `effect clear ${NAME}`, 'difficulty peaceful')
  await sleep(1500)
  const built = [...rcon(...arenaCmds()), ...rcon(...bagCmds(spec.bag0)), ...rcon(...chestCmds()),
    ...(spec.ore ? rcon('fill 818 115 818 822 115 822 minecraft:iron_ore') : [])]
  const bad = built.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Expected/i.test(x.reply) && !/^(kill|forceload) /.test(x.cmd))
  if (bad.length) { await stopBot(); throw new Error('arena not built: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; ')) }
  // the bot's world identity, then the seed (the town reads short: 3 known containers, 0 iron), then the memo waited out
  const wrow = await waitFor(() => skillRows(skillLog).find(r => /^_plinth(first)?_mode$/.test(r.name) && / w=\S+/.test(r.detail)), 30000, 250)
  const world = ((wrow?.detail ?? '').match(/ w=(\S+)/) || [])[1] ?? null
  if (!world || world === '-') { await stopBot(); throw new Error('no world identity in the bot\'s _plinth*_mode row') }
  // the scene's iron and sticks first, so the seed observes them (the town still reads short: 20 < 64)
  if (spec.chestA.length) rcon(...spec.chestA.map(([id, n], s) => `item replace block ${at(CHESTS[0])} container.${s + 1} with minecraft:${id} ${n}`))
  const seeded = await seedIndex(poolDir, world)
  await sleep(35000)
  rcon(...bagCmds(spec.bag))
  await sleep(1500)
  const before = snapshot()
  const tb = totals(before)
  const t0 = Date.now()
  let done = null
  if (scene === 'shovel') {
    done = await waitFor(() => skillRows(skillLog).some(r => r.ts >= t0 - 2000 && r.name === '_toolkit' && /^phase=kit /.test(r.detail)), WINDOW_MS, 1000)
  } else {
    await sleep(60000)                              // decisions with the town task active: the round recorded
    rcon(`give ${NAME} minecraft:${spec.give[0]} ${spec.give[1]}`)
    await sleep(1500)
    tb.bag = totals(snapshot()).bag
    done = await waitFor(() => (CANDIDATE ? skillRows(skillLog).some(r => r.ts >= t0 && r.name === '_deliver_iron' && r.status !== 'no_effect') : false), CANDIDATE ? WINDOW_MS : 120000, 1000)
    if (!CANDIDATE) done = true                     // the base has no delivery: the window itself is the measurement
  }
  if (done) await sleep(5000)
  const after = snapshot()
  const rows = skillRows(skillLog)
  await stopBot()
  await sleep(1000)
  try { fs.unlinkSync(`${R}/${ENV_REL}`) } catch {}
  const ta = totals(after)
  const v = verdict(scene, tb, ta, rows, !!done)
  const r = { scene, tag, candidate: CANDIDATE, server: SERVER, world, seeded,
    sha: (() => { try { return execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '?' } })(),
    windowMs: Date.now() - t0, done: !!done, verdict: v, before: tb, after: ta,
    d: { bag: diff(tb.bag, ta.bag), town: diff(tb.town, ta.town), ground: diff(tb.ground, ta.ground) },
    rows: rows.filter(x => /^(_toolkit|toolkit|_deliver_iron|deliver_iron|_town_iron|_towniron_mode|town_deposit|_town_deposit)$/.test(x.name)).map(x => `${new Date(x.ts).toISOString().slice(11, 19)} ${x.name}:${x.status}:${x.detail.slice(0, 200)}`) }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  console.log(`${scene.padEnd(8)} ${v.verdict} done=${r.done} d(bag){${r.d.bag}} d(town){${r.d.town}} ground{${r.d.ground}}` + (v.why.length ? `\n   why: ${v.why.join('; ')}` : ''))
  console.log('   rows: ' + r.rows.slice(-10).join(' || '))
  return v.pass
}

let arenaOwned = false
async function main () {
  sbx.requireSandboxLock(SERVER, 'towniron')   // the global lock or this server's own (sandbox/lib/sbxlock.cjs)
  const pl = rcon('list')[0].reply; if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  fs.mkdirSync(OUTDIR, { recursive: true })
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(BRAIN_PORT, '127.0.0.1', resolve) })
  arenaOwned = true
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
  if (arenaOwned) { try { rcon(`kill @e[type=!player,x=${HOME.x},y=${HOME.y},z=${HOME.z},distance=..20]`, 'fill 806 112 806 834 126 834 minecraft:air', 'forceload remove 804 804 836 836') } catch {} }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(ok => finish(ok ? 0 : 2), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
process.on('SIGHUP', () => finish(1))
