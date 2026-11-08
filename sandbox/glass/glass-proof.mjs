#!/usr/bin/env node
// SANDBOX-ONLY Paper 1.21.8 proof of GLASS-01's two walks, with THE BOT'S OWN CODE: glass.mjs sandPlan/sandCellOk over a real
// findBlocks + glassRead, then skills.mjs sandDigs (stand on the sand, dig it from on top, drop into the one-deep hole, pick it
// up) and glazeCells (walk within reach, dig the fallback window block, place a glass pane on the course under it or the wall
// beside it). RCON builds the arena on a sandbox only (never a fleet or showcase world) and reads the results back from the
// SERVER (`execute if block`, `clear <bot> <item> 0`). Also: a wood trapdoor and a pane placed the way a stateless build cell is
// (the top face of the block below), their states read back -- the trapdoor fallback's look.
//   node sandbox/glass/glass-proof.mjs <botRoot> [server=sandbox8]
// Refuses unless the sandbox lock names `glass`.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sbx from '../lib/sbxlock.cjs'

const [BOT_ROOT, SERVER = 'sandbox8'] = process.argv.slice(2)
if (!BOT_ROOT) throw new Error('usage: glass-proof.mjs <botRoot> [server]')
const REG = JSON.parse(fs.readFileSync(new URL('../sandboxes.json', import.meta.url), 'utf8'))
const PORT = REG.servers[SERVER]?.port
if (!PORT) throw new Error('sandbox servers only')
sbx.requireSandboxLock(SERVER, 'glass')
const __dir = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dir, 'glass-proof.jsonl')
const NAME = 'sandbox-Glazier'
// the bot's config (config.mjs reads these at import): a sandbox bot, home west of the beach so the ring rule (24..96) holds
const A = { x: 3000, y: 100, z: 3000 }
Object.assign(process.env, { BOT_NAME: NAME, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORT), MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline',
  OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499', LLM_ENABLED: 'false', MEMORY_SCOPE: 'checkpoint', MEMORY_POOL: 'sandbox',
  LOG_DIR: path.join(__dir, 'log'), STATE_DIR: path.join(__dir, 'state'), HOME_X: String(A.x - 20), HOME_Y: '100', HOME_Z: String(A.z), WORLD_BORDER_RADIUS: '29000000',
  SKILL_TIMEOUT_MS: '180000', CODE_VERSION: 'sandbox' })
fs.mkdirSync(process.env.LOG_DIR, { recursive: true }); fs.mkdirSync(process.env.STATE_DIR, { recursive: true })
const req = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const SK = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/skills.mjs')))
const G = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/glass.mjs')))

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-glass-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply || ''
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const rows = []
const rec = (step, ok, ev = {}) => { const row = { step, ok: !!ok, at: new Date().toISOString(), server: SERVER, ...ev }; rows.push(row); fs.appendFileSync(OUT, JSON.stringify(row) + '\n'); P(ok ? 'PASS' : 'FAIL', step, ev) }
const serverCount = item => { const m = /Found (\d+)/.exec(r1(`clear ${NAME} minecraft:${item} 0`)); return m ? Number(m[1]) : 0 }
const isBlock = (x, y, z, b) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${b}`))
const blockState = (x, y, z) => r1(`data get block ${x} ${y} ${z}`)

// THE ARENA: a stone floor (top y 99), air above; ONE beach (sand y 98-99) x 3010..3016, z 2996..3006, with
//   - a DEEP pool (3 deep) at z 2992..2994: the beach's rows z 2996 (2 from it) are refused deep_water, z 2997+ are 3+ away
//   - a SHALLOW strip (1 deep) at x 3018..3020: 2 from the beach's east edge x 3016 (allowed), the edge row x 3017 left stone
//   - a WET column: water at 3013,99,3007 beside the sand cell 3013,99,3006 (refused wet)
// THE WALL (glaze): stone_bricks course y 100 x 3030..3036 z 3020, oak_planks y 101..103 with three FALLBACK windows:
//   W1 3032,101,3020 (the course under it), W2 3034,102,3020 (planks under it), W3 3033,103,3020 with AIR under it (W3's below
//   cell 3033,102 is a window-height hole: placed from the wall beside it). The bot walks from the beach.
// THE FALLBACK LOOK: 3040,100,3030 an oak_trapdoor placed on the top face of the stone below; 3041,100,3030 a pane beside planks.
const cmds = [
  `forceload add 2980 2980 3060 3060`, 'difficulty peaceful', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doTileDrops true',
  ...[2980, 3000, 3020, 3040].flatMap(x0 => [`fill ${x0} 95 2980 ${x0 + 19} 99 3060 minecraft:stone`, `fill ${x0} 100 2980 ${x0 + 19} 108 3060 minecraft:air`]),
  `fill 3010 98 2996 3016 99 3006 minecraft:sand`,
  `kill @e[type=item,x=2980,y=85,z=2980,dx=80,dy=40,dz=80]`,
  `fill 3010 97 2992 3016 99 2994 minecraft:water`,
  `fill 3018 99 2996 3020 99 3006 minecraft:water`,
  `setblock 3013 99 3007 minecraft:water`,
  `fill 3030 100 3020 3036 100 3020 minecraft:stone_bricks`, `fill 3030 101 3020 3036 103 3020 minecraft:oak_planks`,
  `setblock 3033 102 3020 minecraft:air`,
  `fill 3040 100 3030 3041 100 3030 minecraft:air`, `setblock 3042 100 3030 minecraft:oak_planks`,
]
async function main () {
  const bad = rcon(...cmds).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + JSON.stringify(bad))
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  bot.pathfinder.setMovements(new Movements(bot))
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect clear ${NAME}`, `tp ${NAME} 3005 100 3001`, `give ${NAME} minecraft:iron_shovel 1`, `give ${NAME} minecraft:iron_axe 1`)
  await sleep(4000)
  for (let i = 0; i < 30 && bot.blockAt(new Vec3(3013, 99, 3001))?.name !== 'sand'; i++) await sleep(1000)
  const home = { x: A.x - 20, y: 100, z: A.z }
  const read = SK.glassRead(bot)
  // ---- 1. THE PLAN over the live world: the pure rule on real blocks ----
  const ids = ['sand', 'red_sand'].map(n => bot.registry.blocksByName[n].id)
  const found = bot.findBlocks({ point: new Vec3(home.x, home.y, home.z), matching: ids, maxDistance: G.SAND_R_MAX, count: 4000 })
  const top = found.filter(v => v.y === 99)
  const pl = G.sandPlan(found.map(v => [v.x, v.y, v.z]), { read, home, from: [3005, 100, 3001], max: 6 })
  const deepRow = G.sandCellOk(read, [3013, 99, 2996], { home }), wetCell = G.sandCellOk(read, [3013, 99, 3006], { home }), shallowEdge = G.sandCellOk(read, [3016, 99, 3001], { home }), covered = G.sandCellOk(read, [3013, 98, 3001], { home })
  rec('plan_rule_live', deepRow.why === 'deep_water' && wetCell.why === 'wet' && shallowEdge.ok && covered.why === 'covered' && pl.plan.length === 6,
    { found: found.length, top: top.length, eligible: pl.eligible, refused: pl.refused, deepRow, wetCell, shallowEdge, covered, plan: pl.plan.map(p => p.at.join(',')) })
  // ---- 2. THE DIG WALK (skills.mjs sandDigs) ----
  const f = {}
  await SK.sandDigs(bot, pl.plan, { home, read, deadline: Date.now() + 170_000, f })
  await sleep(1500)
  const inBag = serverCount('sand')
  const dugCells = pl.plan.filter(p => isBlock(p.at[0], p.at[1], p.at[2], 'air')).length
  const pos = bot.entity.position
  rec('sand_digs', f.got === 6 && inBag === 6 && dugCells === 6 && !bot.entity.isInWater && bot.health > 0,
    { f, server_sand_in_bag: inBag, cells_now_air: dugCells, pos: [pos.x, pos.y, pos.z].map(v => Math.round(v * 10) / 10), health: bot.health, oxygen: bot.oxygenLevel })
  // OUT OF THE LAST HOLE on the bot's own pathfinder (Codex r1 BLOCKER: every dug cell keeps a step out)
  const { goals } = req('mineflayer-pathfinder')
  try { await bot.pathfinder.goto(new goals.GoalBlock(3005, 100, 3001)) } catch (e) { P('walk out', e.message) }
  const p2 = bot.entity.position
  rec('out_of_the_hole', Math.floor(p2.x) === 3005 && Math.floor(p2.z) === 3001 && Math.abs(p2.y - 100) < 0.6, { pos: [p2.x, p2.y, p2.z].map(v => Math.round(v * 10) / 10) })
  const refusedStill = isBlock(3013, 99, 2996, 'sand') && isBlock(3013, 99, 3006, 'sand')
  rec('refused_cells_untouched', refusedStill, { deep_row: isBlock(3013, 99, 2996, 'sand'), wet_cell: isBlock(3013, 99, 3006, 'sand') })
  // ---- 3. THE GLAZE WALK (skills.mjs glazeCells) ----
  rcon(`give ${NAME} minecraft:glass_pane 3`)
  await sleep(1500)
  const plan = [{ at: [3032, 101, 3020], name: 'oak_planks' }, { at: [3034, 102, 3020], name: 'oak_planks' }]
  // W3: planks over air -- make it a fallback with air under it (its pane is placed from the wall beside it)
  rcon(`setblock 3033 103 3020 minecraft:oak_planks`)
  plan.push({ at: [3033, 103, 3020], name: 'oak_planks' })
  const g = {}
  await SK.glazeCells(bot, plan, { read, deadline: Date.now() + 170_000, f: g })
  await sleep(1500)
  const panes = plan.map(p => isBlock(p.at[0], p.at[1], p.at[2], 'glass_pane'))
  rec('glaze_cells', g.placed === 3 && panes.every(Boolean), { g, panes, w1_state: blockState(3032, 101, 3020).slice(-160), left_in_bag: serverCount('glass_pane'), planks_in_bag: serverCount('oak_planks') })
  // the wall around is untouched (the walk dug nothing else)
  const wallOk = isBlock(3031, 101, 3020, 'oak_planks') && isBlock(3035, 102, 3020, 'oak_planks') && isBlock(3032, 100, 3020, 'stone_bricks')
  rec('wall_untouched', wallOk, {})
  // ---- 4. THE FALLBACK LOOK: a trapdoor and a pane placed like a stateless build cell (the top face of the block below) ----
  rcon(`clear ${NAME}`, `give ${NAME} minecraft:oak_trapdoor 1`, `give ${NAME} minecraft:glass_pane 1`, `tp ${NAME} 3040 100 3027 0 0`)
  await sleep(2000)
  const placeOn = async (item, x, y, z) => {
    const it = bot.inventory.items().find(i => i.name === item)
    await bot.equip(it, 'hand')
    try { await bot.placeBlock(bot.blockAt(new Vec3(x, y - 1, z)), new Vec3(0, 1, 0)) } catch (e) { P('place', item, e.message) }
    await sleep(800)
  }
  await placeOn('oak_trapdoor', 3040, 100, 3030)
  await placeOn('glass_pane', 3041, 100, 3030)
  const td = blockState(3040, 100, 3030), tdB = bot.blockAt(new Vec3(3040, 100, 3030)), pnB = bot.blockAt(new Vec3(3041, 100, 3030))
  rec('fallback_look', tdB?.name === 'oak_trapdoor' && pnB?.name === 'glass_pane',
    { trapdoor: tdB?.name, trapdoor_props: tdB?.getProperties?.(), pane: pnB?.name, pane_props: pnB?.getProperties?.(), server_td: td.slice(-120) })
  bot.quit()
  const pass = rows.every(r => r.ok)
  P(pass ? 'ALL PASS' : 'SOME FAIL', rows.filter(r => r.ok).length + '/' + rows.length)
  process.exit(pass ? 0 : 1)
}
main().catch(e => { P('ERROR', e.stack || String(e)); process.exit(2) })
