// SANDBOX-ONLY Paper scene for townzone-01 on minewell-01 (operator option (b), 10-15): TOWN GROUND ON TWO SIDES, A
// JUNK WELL ON THE OTHERS. The REAL bot (src/index.mjs from <botRoot>, unmodified) is ordered `mine` by the loopback
// brain while it stands on the town square's north-east corner. South and west of it is the town's ground; a real,
// sealed junk well sits diagonally north-east of it (cap 3018,119,2982), so its shell covers the corner's two outward
// stairs (north and east). The well is the town's RECORDED site (written before the bot starts, with composter.mjs's own
// writer): a well found in the world must lie within 16 of home, and none that close can reach the corner's outward
// stairs. After the skill ends the server is asked, read-only: which shell cells are air now (the well), how many cells
// of the square's dirt layer are air now (the town), and the bot's own rows (_mine_well_guard, _town_ground, mine).
//
//   node sandbox/townground/composition-scene.cjs <botRoot> <label> [server=sandbox3] [scenes=CORNER,ROOF]
//
// ROOF (Codex comp r2/r3 P3: the route-aware half of the roofed remedy): the bot in a stone chamber 14 east of home, under
// a BEDROCK slab over the whole floating arena (+3), above sea level. Its internal climb (surface to the roof's top) cannot
// get out, so it ends without rising (10-15 run: surfaced=unknown/no_measurable_change, after its pathfinder dug the
// chamber wall -- those are its transit digs, not goto's); still roofed in town, mine refuses naming a walk ("goto a dry
// spot N+ blocks from home"). The brain then orders exactly that goto (the REAL goto skill, real mineflayer-pathfinder),
// then mine again, outside the square. Read from the bot's own rows: the refusal, goto success and arrival, mine success,
// and the `_dig_town` rows -- confirmed town-ground TARGET digs must be 0 (the control: 32).
//
// Run it on the base (835ef3f0: minewell + farm, no zone -- the positive control: the stair goes south or west and digs
// the town's ground) and on the candidate (the zone composed into minewell's keep-out: one walk-off to a start clear of
// BOTH, then a stair; no shell cell, no town cell). RCON only through `ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py`.
// Refuses a non-sandbox server, and refuses unless the sandbox lock on 10.0.0.31 names `townground`.
'use strict'
const { execFileSync, spawn } = require('child_process')
const http = require('http')
const fs = require('fs'); const path = require('path'); const os = require('os')
const [BOT_ROOT, LABEL, SERVER = 'sandbox3', SCENES = 'CORNER,ROOF'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL) throw new Error('usage: node composition-scene.cjs <botRoot> <label> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const R = process.env.TG_REPO || path.resolve(__dirname, '../..')
const NAME = 'sandbox-Tzmw'
const OUT = `${R}/sandbox/log/townzone-minewell`
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ${LABEL} ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-tzmw-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply ?? ''
const passed = rep => /Test passed/.test(rep || '')

// ---- the arena: home 3000,120,3000; the square 2984..3016 x 2984..3016; a dirt slab y 113..119 --------------------------
const HOME = { x: 3000, y: 120, z: 3000 }
const SQ = { x0: 2984, x1: 3016, z0: 2984, z1: 3016 }
const A = { x0: 2966, x1: 3040, z0: 2960, z1: 3034 }
const G = 119
const CORNER = { x: 3016, y: G + 1, z: 2984 }                     // the square's north-east corner (feet)
const CAP = { x: 3018, y: G, z: 2982 }                            // the well, diagonally north-east of the corner
const ARENA_SEL = `@e[type=item,x=${A.x0},y=100,z=${A.z0},dx=${A.x1 - A.x0},dy=40,dz=${A.z1 - A.z0}]`
function buildArena () {
  const c = [`kill @e[type=!player,x=${A.x0},y=100,z=${A.z0},dx=${A.x1 - A.x0},dy=40,dz=${A.z1 - A.z0}]`]
  for (let x = A.x0; x <= A.x1; x += 25) {
    const x1 = Math.min(A.x1, x + 24)
    c.push(`fill ${x} 112 ${A.z0} ${x1} 123 ${A.z1} minecraft:air`, `fill ${x} 124 ${A.z0} ${x1} 135 ${A.z1} minecraft:air`,
           `fill ${x} 105 ${A.z0} ${x1} 112 ${A.z1} minecraft:stone`, `fill ${x} 113 ${A.z0} ${x1} ${G} ${A.z1} minecraft:dirt`)
  }
  // a real, sealed, floored junk well (well.mjs wellIdentity: a top trapdoor cap over a bottom trapdoor, a solid floor)
  c.push(`setblock ${CAP.x} ${CAP.y - 1} ${CAP.z} minecraft:oak_trapdoor[half=bottom,facing=east,open=false]`,
         `setblock ${CAP.x} ${CAP.y} ${CAP.z} minecraft:oak_trapdoor[half=top,facing=east,open=false]`)
  const r = rcon(...c)
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
}
// the SHELL (well.mjs wellBreakCost's box): +-2 around the column, cap.y - 3 .. cap, the cap and shaft cells excluded
const SHELL = []
for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = CAP.y - 3; y <= CAP.y; y++) {
  if (dx === 0 && dz === 0 && y >= CAP.y - 1) continue
  SHELL.push({ x: CAP.x + dx, y, z: CAP.z + dz })
}
const shellAir = () => rcon(...SHELL.map(c => `execute if block ${c.x} ${c.y} ${c.z} minecraft:air`)).filter(x => passed(x.reply)).map(x => x.cmd.split(' ').slice(3, 6).join(','))
// the TOWN'S GROUND in the arena: the square's dirt layer (113..119) and stone (105..112); air cells counted read-only
// with `execute if blocks`-free per-column probes would be slow, so the count is a replace-fill (it refills what it counts)
const filled = rep => Number(/Successfully filled (\d+)/.exec(rep || '')?.[1] ?? (/No blocks were filled/.test(rep || '') ? 0 : NaN))
function townRemoved () {
  const r = rcon(`fill ${SQ.x0} 113 ${SQ.z0} ${SQ.x1} ${G} ${SQ.z1} minecraft:dirt replace minecraft:air`,
                 `fill ${SQ.x0} 108 ${SQ.z0} ${SQ.x1} 112 ${SQ.z1} minecraft:stone replace minecraft:air`)
  return { dirt: filled(r[0]?.reply), stone: filled(r[1]?.reply) }
}

// ---- the bot -----------------------------------------------------------------------------------------------------------
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const rowsOf = file => lines(file).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(r => r && r.skill)
  .map(r => ({ name: r.skill.name, status: r.skill.status, detail: String(r.skill.detail || ''), fc: r.skill.fail_class ?? r.fail_class ?? null }))
async function waitFor (pred, ms, step = 250) { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = pred(); if (v) return v; await sleep(step) } return null }
let ORDER = null
const brain = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const decision = ORDER ?? { skill: 'status', args: {} }
    ORDER = null
    P('decision', decision)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content: JSON.stringify({ ...decision, reason: 'sandbox', saw_end: sentinel }) },
      done: true, total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
})
let bot = null
async function stopBot () { try { bot && bot.kill('SIGTERM') } catch {} bot = null; await waitFor(() => !new RegExp(NAME).test(r1('list')), 30000, 1000) }
const RUN = new Date().toISOString().replace(/[-:]/g, '').slice(4, 15)
const POOL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tzmw-pool-'))
async function startBot () {
  const tag = `${RUN}-${LABEL}`
  const logRel = `./sandbox/log/townzone-minewell/${tag}`
  const skillLog = `${R}/sandbox/log/townzone-minewell/${tag}/skill-${NAME}.jsonl`
  const botOut = `${OUT}/bot-${tag}.out`
  const envRel = 'sandbox/.env.townzone-minewell'
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  const set = (key, v) => { env = new RegExp(`^${key}=`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${v}`) : env + `\n${key}=${v}` }
  set('BOT_NAME', NAME); set('LOG_DIR', logRel); set('STATE_DIR', `./sandbox/state/townzone-minewell-${tag}`); set('MEMORY_POOL', `sbxtzmw-${tag}`)
  set('POOL_STATE_DIR', POOL_DIR); set('WORLD_BORDER_RADIUS', 5000)
  set('MINECRAFT_PORT', PORTS[SERVER]); set('MAX_CONSECUTIVE_FAILURES', 50); set('FAILED_COOLDOWN_MS', 1000); set('STUCK_SECONDS', 60)
  for (const a of ['X', 'Y', 'Z']) { set(`HOME_${a}`, HOME[a.toLowerCase()]); set(`BOARD_${a}`, HOME[a.toLowerCase()]) }
  fs.writeFileSync(`${R}/${envRel}`, env + '\n')
  const bo = fs.openSync(botOut, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  if (!await waitFor(() => lines(botOut).some(l => /spawned pos=/.test(l)), 90000, 300)) { await stopBot(); throw new Error('no spawn') }
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:saturation 600 1 true`, `tp ${NAME} ${CORNER.x + 0.5} ${CORNER.y} ${CORNER.z + 0.5} 0 0`)
  await sleep(4000)
  // no junk in the bag (a disposal order must not walk the bot to the well first): two pickaxes and food
  rcon(`item replace entity ${NAME} container.0 with minecraft:stone_pickaxe 1`, `item replace entity ${NAME} container.1 with minecraft:stone_pickaxe 1`,
       `item replace entity ${NAME} container.2 with minecraft:bread 16`)
  return { skillLog, botOut }
}

async function corner () {
  buildArena()
  // THE TOWN'S RECORDED WELL SITE, with composter.mjs's own writer (the bot reads it as knownWellCells' recorded site)
  const C = await import(path.join(path.resolve(BOT_ROOT), 'bots/src/composter.mjs'))
  const key = `junkwell-site-${HOME.x}_${HOME.y}_${HOME.z}`
  if (!C.createSiteGen(POOL_DIR, key, 1, { x: CAP.x, y: CAP.y, z: CAP.z }, null)) throw new Error('could not write the well site record')
  if (!C.readTownSite(POOL_DIR, key).site) throw new Error('the well site record does not read back')
  const files = await startBot()
  await sleep(25000)   // index.mjs refreshes the known well columns at 5 s and every 20 s
  const before = { shellAir: shellAir() }
  rcon(`tp ${NAME} ${CORNER.x + 0.5} ${CORNER.y} ${CORNER.z + 0.5} 0 0`)
  await sleep(2000)
  const t0 = rowsOf(files.skillLog).length
  ORDER = { skill: 'mine', args: { y: 108 } }
  const ended = await waitFor(() => lines(files.botOut).find(l => /skill mine ->/.test(l)), 240000, 500)
  await sleep(3000)
  const rows = rowsOf(files.skillLog).slice(t0)
  const after = { shellAir: shellAir() }
  const pos = r1(`data get entity ${NAME} Pos`)
  await stopBot()
  const town = townRemoved()
  const mineRow = rows.filter(r => r.name === 'mine').pop()
  const res = {
    scene: 'CORNER', label: LABEL, root: BOT_ROOT, sha: (() => { try { return execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '?' } })(),
    mine: mineRow ? `${mineRow.status}${mineRow.fc ? '/' + mineRow.fc : ''} ${mineRow.detail.slice(0, 200)}` : (ended ? ended.slice(0, 200) : 'no mine row'),
    shellDug: after.shellAir.filter(c => !before.shellAir.includes(c)), shellAirBefore: before.shellAir.length,
    townRemoved: town,
    guardRows: rows.filter(r => r.name === '_mine_well_guard').map(r => r.detail.slice(0, 140)),
    townRows: rows.filter(r => r.name === '_town_ground').map(r => r.detail.slice(0, 140)),
    endPos: pos.slice(0, 120),
  }
  fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), ...res }) + '\n'); P('RESULT', res)
}

// ---- ROOF ---------------------------------------------------------------------------------------------------------------
const CH = { x: 3014, y: G + 1, z: 3000 }                       // the chamber's feet cell, 14 east of home (> 12, < 16)
const kv = d => Object.fromEntries(String(d).split(/\s+/).map(t => t.split('=')).filter(a => a.length === 2))
async function roof () {
  buildArena()
  // THE SLAB OVER THE WHOLE FLOATING ARENA (+3): a slab over the square alone let the internal climb dig out sideways
  // and pillar past its edge (first run 10-15 15:00Z: the climb SUCCEEDED, so the refusal -> walk chain never ran)
  const c = []
  for (let x = A.x0 - 3; x <= A.x1 + 3; x += 25) c.push(`fill ${x} 124 ${A.z0 - 3} ${Math.min(A.x1 + 3, x + 24)} 126 ${A.z1 + 3} minecraft:bedrock`)
  c.push(`fill ${CH.x - 1} ${CH.y} ${CH.z - 1} ${CH.x + 1} ${CH.y + 2} ${CH.z + 1} minecraft:stone`,   // the chamber (stone)
             `fill ${CH.x} ${CH.y} ${CH.z} ${CH.x} ${CH.y + 1} ${CH.z} minecraft:air`)                    // the bot's two cells
  const r = rcon(...c); const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('roof: ' + bad.map(x => x.cmd + ' => ' + x.reply).join('; '))
  const files = await startBot()
  rcon(`tp ${NAME} ${CH.x + 0.5} ${CH.y} ${CH.z + 0.5} 90 0`)
  await sleep(6000)
  const t0 = rowsOf(files.skillLog).length
  const nMine = () => lines(files.botOut).filter(l => /skill mine ->/.test(l)).length
  const nGoto = () => lines(files.botOut).filter(l => /skill goto ->/.test(l)).length
  const m0 = nMine(), g0 = nGoto()
  ORDER = { skill: 'mine', args: { y: 108 } }
  await waitFor(() => nMine() > m0, 240000, 500); await sleep(2000)
  const first = rowsOf(files.skillLog).slice(t0).filter(r => r.name === 'mine').pop()
  const m = /goto a dry spot (\d+)\+ blocks from home/.exec(first?.detail ?? '')
  let gotoRow = null, second = null
  if (m) {
    const to = { x: HOME.x + Number(m[1]) + 1, y: CH.y, z: HOME.z }
    ORDER = { skill: 'goto', args: to }
    await waitFor(() => nGoto() > g0, 240000, 500); await sleep(2000)
    gotoRow = rowsOf(files.skillLog).slice(t0).filter(r => r.name === 'goto').pop()
    const m1 = nMine()
    ORDER = { skill: 'mine', args: { y: 113 } }   // a short stair: it stays on the floating platform
    await waitFor(() => nMine() > m1, 240000, 500); await sleep(3000)
    second = rowsOf(files.skillLog).slice(t0).filter(r => r.name === 'mine').pop()
  }
  const all = rowsOf(files.skillLog).slice(t0)
  const digs = all.filter(r => r.name === '_dig_town').map(r => kv(r.detail))
  const pos = r1(`data get entity ${NAME} Pos`)
  await stopBot()
  const res = {
    scene: 'ROOF', label: LABEL, sha: (() => { try { return execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '?' } })(),
    firstMine: first ? `${first.status}${first.fc ? '/' + first.fc : ''} ${first.detail.slice(0, 260)}` : 'no mine row',
    goto: gotoRow ? `${gotoRow.status} ${gotoRow.detail.slice(0, 120)}` : null,
    secondMine: second ? `${second.status}${second.fc ? '/' + second.fc : ''} ${second.detail.slice(0, 160)}` : null,
    targetGroundConfirmed: digs.filter(a => a.outcome === 'confirmed' && a.class === 'ground' && a.purpose === 'target').length,
    transitDigs: digs.filter(a => a.purpose === 'transit').length, digRows: digs.length,
    byPurpose: digs.reduce((o, a) => { const k = `${a.purpose}:${a.by}:${a.outcome}`; o[k] = (o[k] || 0) + 1; return o }, {}),
    endPos: pos.slice(0, 120),
  }
  fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), ...res }) + '\n'); P('RESULT', res)
}

async function main () {
  const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
  if (!/townground/.test(lock)) throw new Error('the sandbox lock is not held for townground: ' + lock.trim().slice(0, 160))
  const pl = r1('list'); if (!/There are 0 of/.test(pl)) throw new Error('sandbox not empty: ' + pl)
  await new Promise((resolve, reject) => { brain.once('error', reject); brain.listen(11499, '127.0.0.1', resolve) })
  P(`root=${BOT_ROOT} label=${LABEL} server=${SERVER}`)
  rcon(`forceload add ${A.x0 - 3} ${A.z0 - 3} ${A.x1 + 3} ${A.z1 + 3}`)
  for (const sc of SCENES.split(',')) { if (sc === 'CORNER') await corner(); else if (sc === 'ROOF') await roof(); else throw new Error('unknown scene ' + sc) }
}
async function cleanup () {
  await stopBot().catch(() => {})
  try { brain.close() } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.townzone-minewell`) } catch {}
  try { fs.rmSync(POOL_DIR, { recursive: true, force: true }) } catch {}
  try {
    const c = [`kill ${ARENA_SEL}`]
    for (let x = A.x0 - 3; x <= A.x1 + 3; x += 25) { const x1 = Math.min(A.x1 + 3, x + 24); c.push(`fill ${x} 112 ${A.z0 - 3} ${x1} 123 ${A.z1 + 3} minecraft:air`, `fill ${x} 124 ${A.z0 - 3} ${x1} 135 ${A.z1 + 3} minecraft:air`) }
    c.push(`forceload remove ${A.x0 - 3} ${A.z0 - 3} ${A.x1 + 3} ${A.z1 + 3}`, 'list')
    P('cleanup', rcon(...c).map(x => `${x.cmd.slice(0, 40)} => ${x.reply.slice(0, 80)}`).slice(-2))
  } catch (e) { P('cleanup failed', e.message) }
}
let cleaning = false
const finish = code => { if (cleaning) return; cleaning = true; cleanup().then(() => process.exit(code)) }
main().then(() => finish(0), e => { P('FATAL', e.stack || e.message); finish(1) })
process.on('SIGINT', () => finish(1)); process.on('SIGTERM', () => finish(1))
