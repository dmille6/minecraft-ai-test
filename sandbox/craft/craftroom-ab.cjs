// SANDBOX-ONLY craft A/B driver: runs the REAL bot from <botRoot> (unmodified; trace.cjs only observes packets) on a
// sandbox Paper server, sets a scene per trial with RCON (slots, table, side blocks, drops), drives ONE `craft`
// decision through the queue brain, and records the server's truth before and after.
//
//   node craftroom-ab.cjs <arm> <botRoot> <rounds> <scene,scene,...> [server]
//     arm      a label (cand, ctrl, ...); it names the log dir and the results file
//     botRoot  a worktree at the revision under test (bots/node_modules must exist)
//     server   sandbox | sandbox2 | sandbox3 | sandbox4 (ports 25599..25602); default sandbox
//
// Oracle (server side, never the bot's own view):
//   slots    `data get entity <bot> Inventory[{Slot:Nb}]` one slot per command (a whole-inventory reply exceeds RCON's
//            4096-byte frame), parsed to { id, count, damage }
//   ground   every item entity within 16 blocks of the stand, by `execute as @e[type=item,...] run data get entity @s Item`
//   tables   crafting_table blocks left standing in the arena (counted by the end-of-trial clear)
// Bot side: the skill rows the trial wrote (craft, _craft_room, _craft_sync, _table_retaken, wear_out, ...), the
// decision rejections, and the packet trace (clicks, item spawns, pickups) relative to the moment the decision was served.
//
// RCON world edits happen ONLY through the sandbox helper on 10.0.0.30 (/tmp/sbx-rcon.py asserts a sandbox name).
'use strict'
const { execFileSync, spawn } = require('child_process')
const fs = require('fs'); const path = require('path')
const [ARM, BOT_ROOT, ROUNDS_S, SCENES_S, SERVER = 'sandbox'] = process.argv.slice(2)
if (!ARM || !BOT_ROOT || !SCENES_S) throw new Error('usage: node craftroom-ab.cjs <arm> <botRoot> <rounds> <scenes> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only: ' + Object.keys(PORTS).join(', '))
const ROUNDS = Number(ROUNDS_S || 1)
const SCENES = SCENES_S.split(',')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')   // the checkout holding sandbox/run-bot.sh
const D = __dirname
const NAME = process.env.CRAFT_BOT_NAME || 'sandbox-Crafty'
const SESSION = `${ARM}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`
const OUTDIR = `${R}/sandbox/log/craftroom-ab`
const LOGREL = `./sandbox/log/craftroom-ab/${SESSION}`
const SKILLLOG = `${R}/sandbox/log/craftroom-ab/${SESSION}/skill-${NAME}.jsonl`
const BOTOUT = `${OUTDIR}/bot-${SESSION}.out`
const BRAINLOG = `${OUTDIR}/brain-${SESSION}.log`
const QUEUE = `${OUTDIR}/queue-${SESSION}.txt`
const TRACE = `${OUTDIR}/trace-${SESSION}.jsonl`
const RES = `${OUTDIR}/results-${ARM}.jsonl`
const BRAIN_PORT = 11499   // sandbox-bot-scripted.env points OLLAMA_BASE_URL(S) at 127.0.0.1:11499
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUTDIR, { recursive: true })

// ---------------------------------------------------------------- RCON (sandbox helper, one multiplexed ssh)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-craftab-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const rconAsync = (...cmds) => new Promise((resolve) => {
  const p = spawn('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { stdio: ['pipe', 'pipe', 'inherit'] })
  let o = ''; p.stdout.on('data', d => { o += d }); p.on('close', () => resolve(o)); p.stdin.end(cmds.join('\n') + '\n')
})

// ---------------------------------------------------------------- scenes
// Stand: the bot at 700.5 120 700.5 on a stone floor (y 119), air above. Table cell: 702 120 700 (2 blocks east).
// slots: [id, count, damage?] in slot order from container.0; fill: filler stacks of 64 until `fill` slots are used.
// drops: item entities summoned relative to the moment the decision is SERVED (atMs), pickup delay in ticks.
const STAND = { x: 700.5, y: 120, z: 700.5 }
const TABLE = '702 120 700'
const ROCKS = ['andesite', 'diorite', 'granite', 'calcite']
const NONPLACE = ['bone', 'string', 'feather', 'gunpowder']   // no block, no food: nothing to place, nothing to eat
// foot-level side blocks on the z sides of both places the bot stands (700.5 after the tp; ~701.3 once it steps up to
// the table) -- a wear-out target that blocks no path between the stand and the table
const SIDE_STONES = ['700 120 699', '700 120 701', '701 120 699', '701 120 701']
const STONE_PICK = 'craft stone_pickaxe'
const DROP_AT = '701.5 120.1 700.5'                            // 1 block east of the stand: inside the vanilla pickup box
const BASE35 = { table: 'exist', slots: [['cobblestone', 8], ['stick', 5]], fill: 35, fillers: ROCKS, cmd: STONE_PICK, product: 'stone_pickaxe' }
const SPEC = {
  // 1. full bag: 35/36 (fits one) and 36/36 (one junk dirt in the last slot; the only pickaxe is a spent one)
  full35: { ...BASE35 },
  full36: { table: 'exist', slots: [['cobblestone', 8], ['stick', 5], ['stone_pickaxe', 1, 130]], fill: 35, fillers: ROCKS, tail: [['dirt', 1]], cmd: STONE_PICK, product: 'stone_pickaxe' },
  // 2. pickup race on the 35/36 bag: a feather summoned next to the bot as the decision is served
  'race-early': { ...BASE35, drops: [{ atMs: 0, pd: 20, item: 'feather', at: DROP_AT }] },                     // lands ~1 s in
  'race-late': { ...BASE35, drops: [{ atMs: 1300, pd: 0, item: 'feather', at: DROP_AT }] },                    // appears ~1.3 s in
  'race-stream': { ...BASE35, drops: [10, 30, 50, 70, 90].map(pd => ({ atMs: 0, pd, item: 'feather', at: DROP_AT })) },
  // 3. from logs: 3 oak_log, 12 filler stacks, no table anywhere
  logs: { table: 'none', slots: [['oak_log', 3]], fill: 13, fillers: ROCKS, cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe' },
  // 4. wear-out remedy: 36/36, a spent stone_axe (1 use left) and a good stone_pickaxe; side stones to wear it on.
  //    primer: a 35-slot bag with a spent wooden_hoe, so the decision loop's own hygiene wear_out runs first and its
  //    2-minute cooldown is charged -- otherwise THAT reflex, not the craft's remedy, would wear the axe out.
  wear: { table: 'exist', sides: true, slots: [['cobblestone', 8], ['stick', 5], ['stone_pickaxe', 1], ['stone_axe', 1, 130]], fill: 36, fillers: ROCKS, cmd: STONE_PICK, product: 'stone_pickaxe',
    primer: { slots: [['wooden_hoe', 1, 58]], fill: 35, fillers: ROCKS } },
  // 4b. the same bag on open ground: no side block at foot or head height (the remedy may not dig the floor)
  'wear-open': { table: 'exist', slots: [['cobblestone', 8], ['stick', 5], ['stone_pickaxe', 1], ['stone_axe', 1, 130]], fill: 36, fillers: ROCKS, cmd: STONE_PICK, product: 'stone_pickaxe',
    primer: { slots: [['wooden_hoe', 1, 58]], fill: 35, fillers: ROCKS } },
  // 1c. THE REFUSAL CHAIN: full36, then the remedy the refusal named (place dirt), then the craft again
  'full36-chain': { table: 'exist', slots: [['cobblestone', 8], ['stick', 5], ['stone_pickaxe', 1, 130]], fill: 35, fillers: ROCKS, tail: [['dirt', 1]], cmd: STONE_PICK, product: 'stone_pickaxe',
    chain: ['place dirt', 'craft 1 stone_pickaxe'] },
  // 5. remedy text: 36/36, nothing spare (good pickaxe), nothing placeable or edible
  nothing: { table: 'exist', slots: [['cobblestone', 8], ['stick', 5], ['stone_pickaxe', 1]], fill: 36, fillers: NONPLACE, cmd: STONE_PICK, product: 'stone_pickaxe' },
}

function sceneCmds (spec) {
  const cmds = [`clear ${NAME}`, 'kill @e[type=item,x=700,y=120,z=700,distance=..30]',
    'fill 690 120 690 710 123 710 minecraft:air', 'fill 690 119 690 710 119 710 minecraft:stone', `tp ${NAME} ${STAND.x} ${STAND.y} ${STAND.z}`]
  let s = 0
  const put = ([id, c, dmg]) => cmds.push(`item replace entity ${NAME} container.${s++} with minecraft:${id}${dmg != null ? `[damage=${dmg}]` : ''} ${c}`)
  for (const x of spec.slots || []) put(x)
  while (s < (spec.fill || 0) && s < 36) put([spec.fillers[s % spec.fillers.length], 64])
  for (const x of spec.tail || []) put(x)   // full36: 35 slots, then the junk stack in the last slot
  if (spec.table === 'exist') cmds.push(`setblock ${TABLE} minecraft:crafting_table`)
  if (spec.sides) for (const c of SIDE_STONES) cmds.push(`setblock ${c} minecraft:stone`)
  return cmds
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
  cmds.push('execute as @e[type=item,x=700,y=120,z=700,distance=..16] run data get entity @s Item')
  cmds.push('execute if entity @e[type=item,x=700,y=120,z=700,distance=..16]')
  cmds.push(`data get entity ${NAME} Pos`)
  const r = rcon(...cmds)
  const slots = {}
  for (let s = 0; s < 36; s++) { const it = /has the following entity data/.test(r[s]?.reply || '') ? parseItem(r[s].reply) : null; if (it) slots[s] = it }
  const ground = (r[36]?.reply || '').split(/has the following entity data:/).slice(1).map(parseItem).filter(Boolean)
  const m = (r[37]?.reply || '').match(/count: (\d+)/)
  const pos = ((r[38]?.reply || '').match(/\[([^\]]+)\]/) || [])[1] || ''
  return { slots, used: Object.keys(slots).length, ground, groundCount: m ? +m[1] : 0, pos: pos.replace(/d/g, '') }
}
const totals = snap => { const t = {}; for (const it of Object.values(snap.slots)) t[it.id] = (t[it.id] || 0) + it.count; return t }

// ---------------------------------------------------------------- bot-side readers
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const CRAFT_PAT = /skill craft ->|rejected why=.*"skill":"craft"/
const KEEP = /^(craft|_craft_room|_craft_sync|_table_retaken|wear_out|_wear_out|place|_tool_gone|_tool_broke|_tool_broken|status|deposit|_pickup.*|_item_pickup.*)$/
function skillRows (from) {
  return lines(SKILLLOG).slice(from).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill && KEEP.test(r.skill.name))
    .map(r => ({ ts: Date.parse(r['@timestamp']), name: r.skill.name, status: r.skill.status, trigger: r.trigger, ms: r.skill.duration_ms, fail: r.skill.fail_class,
      args: r.skill.name === '_craft_sync' ? { item: r.skill.args?.item, outcome: r.skill.args?.outcome, stop: r.skill.args?.stop, clicks: r.skill.args?.clicks } : r.skill.args,
      detail: String(r.skill.detail || '').slice(0, 700) }))
}
function served (k, text) {   // the brain log line for the k-th queue line (1-based)
  const l = lines(BRAINLOG).find(x => x.includes(` decision q${k}: ${text}`))
  return l ? Date.parse(l.slice(0, 24)) : null
}

let bot, brain, queued = 0, trialNo = 0
async function waitFor (pred, ms, step = 100) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }

async function primer (spec) {
  const s0 = lines(SKILLLOG).length
  rcon(...sceneCmds({ ...spec.primer, sides: spec.sides }))
  const row = await waitFor(() => skillRows(s0).find(r => r.name === 'wear_out'), 90000, 250)
  await sleep(1500)
  return row ? { status: row.status, detail: row.detail.slice(0, 200) } : { status: 'none', detail: 'no wear_out row in 90 s' }
}

async function runTrial (scene, k) {
  const spec = SPEC[scene]
  const id = `${ARM}:${scene}:${k}`
  let pr = null; let before = null; let skill0 = 0; let out0 = 0; let tr0 = 0; let tMark = 0
  let row = ''; let sent = ''; let tServed = null; let origin = 'queue'; let dropsDone = []; let attempts = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    // THE SCENE IS SET AGAIN FOR EVERY ATTEMPT: a rejected decision must not leave the drops of the last one in the bag
    attempts++; dropsDone = []
    pr = spec.primer ? await primer(spec) : null
    rcon(...sceneCmds(spec))
    await sleep(2500)
    before = snapshot()
    skill0 = lines(SKILLLOG).length; out0 = lines(BOTOUT).length; tr0 = lines(TRACE).length
    tMark = Date.now()
    sent = (trialNo + attempt) % 2 ? spec.cmd.replace(/^craft /, 'craft 1 ') : spec.cmd   // consecutive decisions never identical
    fs.appendFileSync(QUEUE, sent + '\n'); const myK = ++queued
    const nOut = () => lines(BOTOUT).slice(out0).filter(l => CRAFT_PAT.test(l)).length
    const n0 = nOut()
    // the moment the decision is served (or a craft row appears first: the bot's own work order)
    const s = await waitFor(() => served(myK, sent) || (nOut() > n0 ? -1 : null), 200000, 25)
    if (s && s > 0) {
      tServed = s
      for (const d of spec.drops || []) {
        const wait = tServed + d.atMs - Date.now(); if (wait > 0) await sleep(wait)
        const t = Date.now()
        await rconAsync(`summon minecraft:item ${d.at} {Item:{id:"minecraft:${d.item}",count:1},PickupDelay:${d.pd}s}`)
        dropsDone.push({ at: t - tServed, done: Date.now() - tServed, pd: d.pd })
      }
    } else if (s === -1) {
      origin = 'own_order'
      const txt = fs.readFileSync(QUEUE, 'utf8').split('\n'); txt[myK - 1] = 'status'; fs.writeFileSync(QUEUE, txt.join('\n'))   // cancel the unserved line
    }
    await waitFor(() => nOut() > n0, 200000, 250)
    row = lines(BOTOUT).slice(out0).filter(l => CRAFT_PAT.test(l)).pop() || ''
    if (/skill craft ->/.test(row)) break
    await sleep(3000)
  }
  trialNo++
  // THE CHAIN: each follow-up decision in turn, waiting for its own skill row (the remedy, then the craft again)
  const chain = []
  for (const cmd of spec.chain || []) {
    const skill = cmd.split(/\s+/)[0]; const pat = new RegExp(`skill ${skill} ->|rejected why=.*"skill":"${skill}"`)
    const o0 = lines(BOTOUT).length
    fs.appendFileSync(QUEUE, cmd + '\n'); ++queued
    await waitFor(() => lines(BOTOUT).slice(o0).some(l => pat.test(l)), 200000, 250)
    chain.push({ cmd, row: (lines(BOTOUT).slice(o0).filter(l => pat.test(l)).pop() || '').replace(/^\S+\s+/, '').slice(0, 600) })
    await sleep(1500)
  }
  await sleep(3000)
  const after = snapshot()
  const tablesReply = rcon('fill 690 120 690 710 123 710 minecraft:air replace minecraft:crafting_table')[0]?.reply || ''
  const tables = +((tablesReply.match(/filled (\d+)/) || [])[1] || 0)
  const rows = skillRows(skill0)
  const rejections = lines(BOTOUT).slice(out0).filter(l => /decision rejected/.test(l)).map(l => l.replace(/^\S+\s+/, '').slice(0, 200))
  const rel = t => (tServed ? t - tServed : t - tMark)
  const trace = lines(TRACE).slice(tr0).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const clicks = trace.filter(e => e.pkt === 'click')
  const tr = {
    clicks: clicks.length, firstClick: clicks.length ? rel(clicks[0].ts) : null, lastClick: clicks.length ? rel(clicks[clicks.length - 1].ts) : null,
    // slot -999 clicks are craftsync's resyncs (empty cursor) OR a toss (mineflayer's no-room putAway): the ground
    // oracle tells them apart, not the click. "real" clicks are the craft's own grid/result clicks.
    m999: clicks.filter(c => c.slot === -999).map(c => rel(c.ts)),
    firstReal: (clicks.find(c => c.slot !== -999) || {}).ts ? rel(clicks.find(c => c.slot !== -999).ts) : null,
    lastReal: (clicks.filter(c => c.slot !== -999).pop() || {}).ts ? rel(clicks.filter(c => c.slot !== -999).pop().ts) : null,
    spawns: trace.filter(e => e.pkt === 'spawn_item').map(e => ({ t: rel(e.ts), id: e.id })),
    pickups: trace.filter(e => e.pkt === 'collect' && e.self).map(e => ({ t: rel(e.ts), id: e.id, n: e.n })),
    windows: trace.filter(e => e.pkt === 'open_window').map(e => rel(e.ts)),
  }
  const r = { id, arm: ARM, scene, k, session: SESSION, server: SERVER, sha: execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
    sent, attempts, origin, primer: pr, chain, served: tServed ? new Date(tServed).toISOString() : null, drops: dropsDone, row: row.replace(/^\S+\s+/, '').slice(0, 900),
    before: { used: before.used, totals: totals(before), slots: before.slots, ground: before.ground, pos: before.pos },
    after: { used: after.used, totals: totals(after), slots: after.slots, ground: after.ground, groundCount: after.groundCount, pos: after.pos, tables },
    rows, rejections, trace: tr, wallMs: Date.now() - tMark }
  fs.appendFileSync(RES, JSON.stringify(r) + '\n')
  const craft = rows.filter(x => x.name === 'craft').pop()
  const tb = totals(before); const ta = totals(after)
  const delta = Object.keys({ ...tb, ...ta }).map(n => [n, (ta[n] || 0) - (tb[n] || 0)]).filter(([, d]) => d).map(([n, d]) => `${n}${d > 0 ? '+' : ''}${d}`).join(' ')
  console.log(`${id.padEnd(22)} ${String(craft?.status || (row.includes('rejected') ? 'rejected' : 'none')).padEnd(8)} slots ${before.used}->${after.used} ground[${after.ground.map(g => g.id + 'x' + g.count).join(',')}] tables=${tables} d{${delta}} clicks=${tr.clicks} pickups=${tr.pickups.map(p => p.t).join(',')} | ${(craft?.detail || row).slice(0, 160)}`)
}

async function main () {
  for (const t0 = Date.now(); ;) {
    const pl = rcon('list')[0].reply
    if (/There are 0 of/.test(pl)) break
    if (Date.now() - t0 > 3600000) throw new Error('sandbox not empty: ' + pl)
    console.log('waiting:', pl.trim()); await sleep(20000)
  }
  const envRel = `sandbox/.env.craftab-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (k, v) => { env = new RegExp(`^${k}=`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : env + `\n${k}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', LOGREL); set('STATE_DIR', `./sandbox/state/craftroom-ab-${SESSION}`); set('MEMORY_POOL', `sbxcraftab-${SESSION}`)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50)
  // HARNESS, NOT THE CODE UNDER TEST: the admission gate's 45 s cooldown on a failed action would reject the next
  // scene's identical craft (a refusal is a failure). Same value for every arm.
  set('FAILED_COOLDOWN_MS', 1000)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, STAND[a.toLowerCase()] | 0); set(`BOARD_${a}`, STAND[a.toLowerCase()] | 0) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  fs.writeFileSync(QUEUE, '')
  brain = spawn('node', [path.join(D, 'qbrain.mjs'), String(BRAIN_PORT)], { env: { ...process.env, QUEUE_FILE: QUEUE }, stdio: ['ignore', fs.openSync(BRAINLOG, 'a'), 'inherit'] })
  await sleep(1000)
  const bo = fs.openSync(BOTOUT, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'trace.cjs')}`, CRAFT_TRACE: TRACE }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(BOTOUT).some(l => /spawned pos=/.test(l)), 90000, 500)) throw new Error('no spawn')
  rcon(`gamemode survival ${NAME}`, 'fill 690 119 690 710 119 710 minecraft:stone', 'fill 690 120 690 710 123 710 minecraft:air', 'time set day', 'weather clear')
  await sleep(8000)
  console.log(`session ${SESSION} arm=${ARM} root=${BOT_ROOT} server=${SERVER}`)
  for (let k = 0; k < ROUNDS; k++) for (const scene of SCENES) await runTrial(scene, k)
}
async function cleanup () {
  try { bot && bot.kill('SIGTERM') } catch {}
  try { brain && brain.kill('SIGTERM') } catch {}
  await sleep(2500)
  try { fs.unlinkSync(`${R}/sandbox/.env.craftab-${ARM}`) } catch {}
  try { rcon(`clear ${NAME}`, 'kill @e[type=item,x=700,y=120,z=700,distance=..30]', 'fill 690 120 690 710 123 710 minecraft:air') } catch {}
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { console.error('FATAL', e.message); finish(1) })
process.on('SIGINT', () => finish(1))
process.on('SIGTERM', () => finish(1))
