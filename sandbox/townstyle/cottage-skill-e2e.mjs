// SANDBOX-ONLY (townstyle-01, 2026-11-05; control session: "run the skill wrapper (bill, draw logs, craft stairs/slabs) once on Paper
// without the RCON kit"). THE REAL build_shop SKILL (skills.mjs SKILLS.build_shop.run: the order's project, the cottage's siting on the
// extension's house plot, the style from the town index, the bill, the draws from town chests under the reserve, the logs -> planks ->
// stairs / slabs / trapdoors crafts at a table, the visit, the bank-back) on one bare bot, visit after visit, until the cottage stands.
//   BOT_ROOT=<worktree> SBX=sandbox4 node sandbox/townstyle/cottage-skill-e2e.mjs
// THE TOWN (RCON, sandbox only): a flat field, home at its centre, two town chests by home holding LOGS and cobblestone and torches (no
// planks, no stairs, no slabs, no trapdoors, no glass: every wood part must be crafted from the logs, every window falls back), a crafting
// table by home. The town's earlier projects are records published here as COMPLETE (cells: [] -- nothing to repair) so the order reaches
// the cottage; the wall extension's record names one house plot east of home. The bag: tools and bread only.
// PASS: `_structure_complete project=cottage1`; EVERY record cell server-verified with its state; the bag's `_build_bag` rows never
// negative-unexplained (shopread G8); the town's logs went down (drawn) and no part was given by RCON.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HX = 300, HY = 121, HZ = 300            // home's feet; grass top at HY - 1
const SERVER = process.env.SBX || 'sandbox4'
const NAME = 'sbx-CottageSkill'
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxcottage',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cslog-')), POOL_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cspool-')),
  HOME_X: String(HX), HOME_Y: String(HY), HOME_Z: String(HZ), WORLD_BORDER_RADIUS: '6000', BOT_NAME: NAME, LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
  // the order reaches the cottage: its chain on (shop, house, paths, wall, storehouse, storage hall, extension, enchanting workshop)
  COTTAGE: 'on', ENCHANTSHOP: 'on', ENCHANTSHOP_FIT: 'off', WALLEXT: 'on', STOREHUB: 'on', STOREHOUSE: 'on', PATHS: 'on', WALL: 'on',
  MONUMENT: 'off', SHAFT: 'off', TREEFARM: 'off', CROPFARM: 'off', CANEFARM: 'off', SHOPCHEST: 'off', COPPERHALL: 'off', YARD: 'off', SINKS: 'off',
  TIDY: 'off', GROUNDSKEEPER: 'off', WALLDEMO: 'off', FOUND: 'off', SMELT_JOB: '0', SHOP_COOLDOWN_MS: '1000',
})
const BOT_ROOT = path.resolve(process.env.BOT_ROOT || '.')
const BOTS = path.join(BOT_ROOT, 'bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const REG = req(path.join(BOT_ROOT, 'sandbox/sandboxes.json'))
const PORT = REG.servers[SERVER].port
const imp = f => import(path.join(BOTS, 'src', f))
const SK = await imp('skills.mjs')
const PJ = await imp('buildproj.mjs')
const PS = await imp('planstore.mjs')
const T = await imp('townstyle.mjs')
const CS = await imp('craftsync.mjs')
const { tapRecords } = await imp('logger.mjs')

const rcon = (...cmds) => {
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', `mike@${REG.host}`, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
// /fill refuses more than 32,768 blocks: the arena in x slices
const fillAll = (x0, y0, z0, x1, y1, z1, block) => { const out = []; const per = Math.max(1, Math.floor(32768 / ((y1 - y0 + 1) * (z1 - z0 + 1)))); for (let x = x0; x <= x1; x += per) out.push(`fill ${x} ${y0} ${z0} ${Math.min(x1, x + per - 1)} ${y1} ${z1} minecraft:${block}`); return out }
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))))
const STOCK = { spruce_log: 192, cobblestone: 128, torch: 16 }   // the project reserve keeps 20% of BUILD_RESERVE logs 512 = 103: 89 spendable
const CHESTS = [[HX + 3, HY, HZ - 3], [HX + 3, HY, HZ + 3]]
const TABLE = [HX - 3, HY, HZ + 3]

async function main () {
  rcon(`forceload add ${HX - 40} ${HZ - 40} ${HX + 40} ${HZ + 40}`)
  rcon(`fill ${HX - 36} ${HY - 4} ${HZ - 36} ${HX + 36} ${HY - 2} ${HZ + 36} minecraft:dirt`,
    `fill ${HX - 36} ${HY - 1} ${HZ - 36} ${HX + 36} ${HY - 1} ${HZ + 36} minecraft:grass_block`,
    ...fillAll(HX - 36, HY, HZ - 36, HX + 36, HY + 14, HZ + 36, 'air'),
    `kill @e[type=item,x=${HX - 40},y=${HY - 4},z=${HZ - 40},dx=80,dy=20,dz=80]`, 'time set 1000')
  // the town chests (logs, cobblestone, torches only) and a table
  const cmds = []
  CHESTS.forEach((c, i) => { cmds.push(`setblock ${c.join(' ')} minecraft:chest`); let slot = 0; for (const [n, total] of Object.entries(STOCK)) { let left = Math.ceil(total / CHESTS.length); while (left > 0) { const k = Math.min(64, left); cmds.push(`item replace block ${c.join(' ')} container.${slot++} with minecraft:${n} ${k}`); left -= k } } })
  cmds.push(`setblock ${TABLE.join(' ')} minecraft:crafting_table`)
  rcon(...cmds)
  // THE TOWN'S PLAN AND RECORDS (the pool directory): the plan, then the earlier projects COMPLETE far from the plot, the extension
  const dir = process.env.POOL_STATE_DIR
  const home = { x: HX, y: HY, z: HZ }
  const plan = { v: 1, template: 'ring@1', home, s: HY - 1, mode: 'retrofit', at: Date.now(), world: null,
    plots: [{ id: 'core', kind: 'plaza', box: [HX - 6, HZ - 6, HX + 6, HZ + 6], y: HY - 1, state: 'existing', keepout: false }], paths: [], groups: {}, transitions: [] }
  const pubPlan = PS.publishPlan(dir, PS.planKey(home), null, () => plan, { by: NAME })
  P('plan', pubPlan.result ?? pubPlan)
  const far = (i) => [HX - 30 + i * 3, HZ - 34, HX - 29 + i * 3, HZ - 33]
  const done = (plot, blueprint, i, extra = {}) => PJ.publishRecord(dir, PJ.projKey(home, plot), () => ({ v: 1, blueprint, plot, box: far(i), cells: [], clear: [], replant: [], structure_complete: true, state: 'complete', completeAt: Date.now() - 3600_000, ...extra }))
  const recs = [['shop', 'workshop@1'], ['house1', 'house@1'], ['paths', 'paths@1'], ['wall', 'wall@1'], ['storehouse', 'storehouse@1'], ['storehub', 'storehub@1'], ['enchantshop', 'enchantshop@1']]
  recs.forEach(([p, b], i) => P('record', p, done(p, b, i).result))
  P('record wallext', done('wallext', 'wallext@1', 9, { ring: [HX - 34, HZ - 34, HX + 34, HZ + 34], plots: [{ id: 'X3', kind: 'house', box: [HX + 12, HZ - 5, HX + 22, HZ + 5], y: HY - 1 }] }).result)

  const recsLog = []
  tapRecords(r => { const n = r.skill?.name ?? ''; if (/build|structure_complete|craft|withdraw|bank|mats/.test(n)) recsLog.push(`${n} ${r.skill.status} ${String(r.skill.detail ?? '').slice(0, 220)}`) })
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  CS.installCraftSync(bot, { log: () => {} })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `effect give ${NAME} minecraft:resistance infinite 5 true`, `tp ${NAME} ${HX + 0.5} ${HY} ${HZ + 0.5}`,
    `give ${NAME} minecraft:iron_pickaxe 1`, `give ${NAME} minecraft:iron_axe 1`, `give ${NAME} minecraft:bread 8`)
  await sleep(4000)
  P('spawned', bot.entity.position.floored().toString(), 'active', SK.shopActive(bot)?.plot)
  const ac = new AbortController()
  // the town index learns the chests the way the materials job does (make_material item=count: the recount of unknown containers)
  P('count', await SK.SKILLS.make_material.run({ bot }, { item: 'count' }, ac.signal).catch(e => String(e?.message ?? e)))
  P('index stock', SK.matsTownStock(bot)?.stock)
  let complete = false, visits = 0
  for (; visits < 14 && !complete; visits++) {
    const n0 = recsLog.length
    const r = await SK.SKILLS.build_shop.run({ bot }, {}, ac.signal).catch(e => ({ status: 'threw', detail: String(e?.message ?? e).slice(0, 200) }))
    const mine = recsLog.slice(n0)
    complete = mine.some(l => /^_?structure_complete/.test(l) && /cottage1/.test(l)) || mine.some(l => /^_?build_visit/.test(l) && /project=cottage1 outcome=complete/.test(l))
    P(`visit ${visits}: ${r.status} ${String(r.detail ?? '').slice(0, 160)}`)
    for (const l of mine.filter(l => /^_?(build_visit|build_bag|craft|withdraw|structure_complete)/.test(l) || /op=(sited|reorient|clear)|no_material|misplaced/.test(l))) P('   ', l)
    if (visits === 0) P('row names seen', [...new Set(recsLog.map(l => l.split(' ')[0]))])
    await sleep(1500)
  }
  // THE SERVER'S WORD on every cell of the record the bot sited
  const h = PJ.recordHead(dir, PJ.projKey(home, 'cottage1'))
  const rec = h.ok ? h.head?.rec : null
  let ok = 0, bad = []
  if (rec) {
    const want = c => { const n = (rec.palette[c.role] ?? []).filter(x => !x.startsWith('$')); const alts = c.role === 'fill' ? ['cobblestone'] : c.role === 'light' ? ['torch', 'wall_torch'] : c.role === 'window' || c.role === 'gablewin' ? [...n, `${rec.style.wood}_planks`] : n; return alts.map(a => (c.ws ? T.stateKey(a, c.ws) : a)) }
    const cmds2 = [], idx = []
    for (const c of rec.cells) for (const w of want(c)) { cmds2.push(`execute if block ${c.at.join(' ')} minecraft:${w}`); idx.push(c) }
    const res = []
    for (let i = 0; i < cmds2.length; i += 120) res.push(...rcon(...cmds2.slice(i, i + 120)))
    const good = new Set(); res.forEach((x, i) => { if (/passed/i.test(x.reply)) good.add(idx[i]) })
    ok = good.size; bad = rec.cells.filter(c => !good.has(c)).slice(0, 8).map(c => `${c.role}@${c.at}`)
  }
  const bagRows = recsLog.filter(l => /^_?build_bag/.test(l))
  const negative = bagRows.filter(l => /=(-?\d+)\/(\d+)\/(-?\d+)\/(\d+)\/(\d+)\/(\d+)/.test(l) && [...l.matchAll(/([a-z_]+)=(\d+)\/(\d+)\/(-?\d+)\/(\d+)\/(\d+)\/(\d+)/g)].some(m => Number(m[7]) - (Number(m[2]) + Number(m[3]) + Number(m[4]) - Number(m[5]) - Number(m[6])) < 0))
  const town = {}
  for (const c of CHESTS) { const r = rcon(`data get block ${c.join(' ')} Items`)[0]?.reply ?? ''; for (const m of r.matchAll(/id: "minecraft:([a-z_]+)"[^}]*?count: (\d+)/g)) town[m[1]] = (town[m[1]] ?? 0) + Number(m[2]) }
  const summary = { complete, visits, blueprint: rec?.blueprint, style: rec?.style, cells: rec?.cells?.length, serverOk: ok, bad, bagRows: bagRows.length, bagNegative: negative.length, townAfter: town, crafts: recsLog.filter(l => /^_craft_room success/.test(l)).length }
  P(complete && rec && ok === rec.cells.length && !negative.length ? 'PASS' : 'FAIL', summary)
  fs.appendFileSync(process.env.OUT || 'cottage-skill-e2e.jsonl', JSON.stringify({ t: new Date().toISOString(), ...summary, log: recsLog.filter(l => /^_?(build_visit|build_bag|structure_complete)/.test(l)).slice(0, 60) }) + '\n')
  bot.quit(); await sleep(500)
  if (process.env.KEEP !== '1') rcon(...fillAll(HX - 36, HY, HZ - 36, HX + 36, HY + 14, HZ + 36, 'air'), `kill @e[type=item,x=${HX - 40},y=${HY - 4},z=${HZ - 40},dx=80,dy=20,dz=80]`)
  rcon(`forceload remove ${HX - 40} ${HZ - 40} ${HX + 40} ${HZ + 40}`)
  process.exit(complete ? 0 : 1)
}
main().catch(e => { P('ERROR', e.stack); process.exit(1) })
