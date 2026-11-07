// SANDBOX-ONLY E2E for market-02 (the walk-in trip): the REAL path -- skills.mjs marketAsk -> SKILLS.market_trip.run -- with
// protectzone's guard attached as index.mjs attaches it, on Paper 1.21.8. Every result read from the SERVER:
//   (1) a walk-in trade at a protected village's librarian WITHOUT CHANGING ANY BLOCK of the zone (`execute if blocks` against a
//       copy of the zone taken before the trip), (2) beds and a composter placed OUTSIDE the zone + 3, (3) a villager claiming the
//       bed (Brain.memories."minecraft:home") and a jobless one the composter (farmer).
//   SBX=sandbox3 node sandbox/trading/walkin-e2e.mjs     (from a worktree root with bots/node_modules; take the lock first:
//   sandbox/sbxlock.sh take <sbx> market "...", release after)
// Setup by RCON (sandbox only): a walled grass strip 141 x 41, the town's chests (iron, coal, logs, emeralds) and a crafting
// table at home, a protected zone ~100 b east holding a librarian and a cleric (offers fixed by NBT) and two jobless villagers.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const X = 3400, Y = 140, Z = 3700, F = Y + 1
const ZB = [3480, -64, 3685, 3520, 320, 3715]
const POOL = fs.mkdtempSync(path.join(os.tmpdir(), 'wkpool-'))
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxwalkin',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'wklog-')), POOL_STATE_DIR: POOL,
  HOME_X: String(X), HOME_Y: String(F), HOME_Z: String(Z), WORLD_BORDER_RADIUS: '6000', BOT_NAME: 'sbx-Market', LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
})
fs.writeFileSync(path.join(POOL, 'protected-zones.json'), JSON.stringify({ version: 1, zones: [{ id: 'village-sbx', kind: 'village', box: ZB }] }))
const BOTS = path.resolve('bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const lock = req(path.resolve('sandbox/lib/sbxlock.cjs'))
const SK = await import(path.join(BOTS, 'src/skills.mjs'))
const PZ = await import(path.join(BOTS, 'src/protectzone.mjs'))
const CS = await import(path.join(BOTS, 'src/craftsync.mjs'))
const { tapRecords } = await import(path.join(BOTS, 'src/logger.mjs'))
const SERVER = process.env.SBX || 'sandbox3', REG = req(path.resolve('sandbox/sandboxes.json')), PORT = REG.servers[SERVER].port, NAME = 'sbx-Market'
const rcon = (...cmds) => execFileSync('ssh', ['-o', 'BatchMode=yes', `mike@${REG.host}`, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
const r1 = c => rcon(c).split('\n').slice(1).join(' ').trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const R = {}
const countIn = n => +(r1(`clear ${NAME} minecraft:${n} 0`).match(/Found (\d+)/)?.[1] ?? 0)
const X0 = 3390, X1 = 3530, Z0 = 3680, Z1 = 3720
const REF_DZ = 120   // the zone's copy, 120 b south, for the integrity test
// the zone's blocks against its copy, in the two parts either side of the wheat field (a copied field dries out: no water), and the
// field's FARMLAND counted cell by cell (a trampled cell turns to dirt; a farmer's harvest leaves the farmland)
const PARTS = [[ZB[0], 3483], [3493, ZB[3]]]
const zoneSame = () => PARTS.map(([a, b]) => r1(`execute if blocks ${a} ${Y - 1} ${ZB[2]} ${b} ${Y + 6} ${ZB[5]} ${a} ${Y - 1} ${ZB[2] + REF_DZ} all`)).join(' | ')
const farmland = () => { const cmds = []; for (let x = 3484; x <= 3492; x++) for (let z = 3692; z <= 3712; z++) cmds.push(`execute if block ${x} ${Y - 1} ${z} minecraft:farmland`); return rcon(...cmds).split('\n').filter(l => /passed/i.test(l)).length }
const offer = (buy, sell, extra = '') => `{buy:${buy},sell:${sell}${extra},maxUses:12,xp:1,priceMultiplier:0.05f}`

async function main () {
  lock.requireSandboxLock(SERVER, 'market')
  const recs = []
  tapRecords(r => { if (/market|trade|protect_zone|craft$|withdraw/.test(r.skill?.name ?? '')) recs.push(`${r.skill.name} ${r.skill.status} ${String(r.skill.detail ?? '').slice(0, 260)}`) })
  const fills = []
  for (let x = X0; x <= X1; x += 40) fills.push(`fill ${x} ${Y - 1} ${Z0} ${Math.min(X1, x + 39)} ${Y + 6} ${Z1} minecraft:air`, `fill ${x} ${Y - 1} ${Z0} ${Math.min(X1, x + 39)} ${Y - 1} ${Z1} minecraft:stone`, `fill ${x} ${Y} ${Z0} ${Math.min(X1, x + 39)} ${Y} ${Z1} minecraft:grass_block`)
  rcon(`forceload add ${X0 - 8} ${Z0 - 8} ${X1 + 8} ${Z1 + REF_DZ + 8}`, ...fills,
    `fill ${X0} ${F} ${Z0} ${X1} ${F + 3} ${Z0} minecraft:glass`, `fill ${X0} ${F} ${Z1} ${X1} ${F + 3} ${Z1} minecraft:glass`,
    `fill ${X0} ${F} ${Z0} ${X0} ${F + 3} ${Z1} minecraft:glass`, `fill ${X1} ${F} ${Z0} ${X1} ${F + 3} ${Z1} minecraft:glass`,
    // the village's own blocks: a lectern by the librarian, a brewing stand by the cleric, a path, a few beds INSIDE the zone
    `setblock 3501 ${F} 3700 minecraft:lectern`, `setblock 3506 ${F} 3706 minecraft:brewing_stand`, `fill 3482 ${Y} 3699 3518 ${Y} 3701 minecraft:dirt_path`,
    // a SUNKEN wheat field across the way in (a drop onto farmland tramples it): farmland at Y - 1, wheat on it
    `fill 3484 ${Y - 1} 3692 3492 ${Y - 1} 3712 minecraft:farmland[moisture=7]`, `fill 3484 ${Y} 3692 3492 ${Y} 3712 minecraft:wheat[age=7]`,
    `setblock ${X - 3} ${F} ${Z - 3} minecraft:chest`, `setblock ${X - 3} ${F} ${Z - 1} minecraft:chest`, `setblock ${X + 2} ${F} ${Z - 3} minecraft:crafting_table`,
    `item replace block ${X - 3} ${F} ${Z - 3} container.0 with minecraft:iron_ingot 64`, `item replace block ${X - 3} ${F} ${Z - 3} container.1 with minecraft:iron_ingot 36`,
    `item replace block ${X - 3} ${F} ${Z - 3} container.2 with minecraft:emerald 8`,
    `item replace block ${X - 3} ${F} ${Z - 1} container.0 with minecraft:coal 64`, `item replace block ${X - 3} ${F} ${Z - 1} container.1 with minecraft:coal 16`,
    `item replace block ${X - 3} ${F} ${Z - 1} container.2 with minecraft:spruce_log 32`,
    `kill @e[type=villager,x=${X0},y=${Y - 5},z=${Z0},dx=${X1 - X0},dy=20,dz=${Z1 - Z0}]`, `kill @e[type=item,x=${X0},y=${Y - 5},z=${Z0},dx=${X1 - X0},dy=20,dz=${Z1 - Z0}]`,
    `summon villager 3500.5 ${F} 3702.5 {Tags:["wkL"],NoAI:1b,VillagerData:{profession:"minecraft:librarian",level:2,type:"minecraft:plains"},Xp:20,Offers:{Recipes:[${offer('{id:"minecraft:emerald",count:1}', '{id:"minecraft:lantern",count:1}')},${offer('{id:"minecraft:emerald",count:1}', '{id:"minecraft:glass",count:4}')}]}}`,
    `summon villager 3505.5 ${F} 3708.5 {Tags:["wkC"],NoAI:1b,VillagerData:{profession:"minecraft:cleric",level:2,type:"minecraft:plains"},Xp:20,Offers:{Recipes:[${offer('{id:"minecraft:emerald",count:1}', '{id:"minecraft:redstone",count:2}')}]}}`,
    `summon villager 3490.5 ${F} 3693.5 {Tags:["wkJ"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
    `summon villager 3492.5 ${F} 3709.5 {Tags:["wkJ"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
    `summon villager 3495.5 ${F} 3690.5 {Tags:["wkJ"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
    `summon villager 3497.5 ${F} 3711.5 {Tags:["wkJ"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
    'time set 1000', 'gamerule doDaylightCycle false', 'gamerule mobGriefing true')
  // the zone's copy BEFORE the trip (blocks only)
  R.cloned = PARTS.map(([a, b]) => r1(`clone ${a} ${Y - 1} ${ZB[2]} ${b} ${Y + 6} ${ZB[5]} ${a} ${Y - 1} ${ZB[2] + REF_DZ}`)).join(' | ')
  R.zoneSameBefore = zoneSame()
  R.farmlandBefore = farmland()
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  CS.installCraftSync(bot, { log: () => {} })
  const zonesNow = () => PZ.parseZones(JSON.parse(fs.readFileSync(path.join(POOL, 'protected-zones.json'), 'utf8'))).zones
  R.refused = []
  PZ.attachProtectZone(bot, { zones: zonesNow, onRefuse: ({ op, zone, at }) => R.refused.push(`${op} ${zone} ${at ? `${at.x},${at.y},${at.z}` : '-'}`) })
  const ac = new AbortController()
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${F} ${Z + 0.5}`, `give ${NAME} minecraft:bucket 1`, `give ${NAME} minecraft:white_bed 2`)
    await sleep(3000)
    for (const item of ['coal', 'iron_ingot', 'spruce_log']) R[`seed_${item}`] = (await SK.SKILLS.withdraw.run({ bot }, { item, count: 1 }, ac.signal))?.status
    const before = { emerald: countIn('emerald'), lantern: countIn('lantern'), glass: countIn('glass'), redstone: countIn('redstone'), bed: countIn('white_bed') }
    const ask = SK.marketAsk({ now: Date.now() }, bot)
    R.ask = ask
    P('ask', ask)
    if (ask?.order) {
      const t = Date.now()
      R.run = await SK.SKILLS[ask.order.skill].run({ bot }, ask.order.args, ac.signal)
      R.ms = Date.now() - t
    }
    P('run', R.run, R.ms)
    R.underWatchdog = R.ms < 180000   // the runner aborts every skill at SKILL_TIMEOUT_MS 180 s on the showcase
    await sleep(2000)
    R.after = { emerald: countIn('emerald'), lantern: countIn('lantern'), glass: countIn('glass'), redstone: countIn('redstone'), bed: countIn('white_bed'), composter: countIn('composter'), at: bot.entity.position.floored().toString() }
    R.before = before
    R.zoneSameAfter = zoneSame()
    R.farmlandAfter = farmland()
    // what the trip placed outside the zone (beds, the composter), and whether a villager took them
    const scan = []
    for (let x = 3440; x <= 3530; x++) for (let z = Z0 + 1; z < Z1; z++) scan.push([x, z])
    const out = rcon(...scan.map(([x, z]) => `execute if block ${x} ${F} ${z} #minecraft:beds`), ...scan.map(([x, z]) => `execute if block ${x} ${F} ${z} minecraft:composter`)).split('\n')
    const hits = []; let ci = -1
    for (const line of out) { if (line.startsWith('> ')) ci++; else if (/passed/i.test(line)) hits.push([ci < scan.length ? 'bed' : 'composter', ...scan[ci % scan.length]]) }
    R.placed = hits
    R.placedInZonePad = hits.filter(([, x, z]) => x >= ZB[0] - 3 && x <= ZB[3] + 3 && z >= ZB[2] - 3 && z <= ZB[5] + 3)
    rcon('time set 13000')   // evening: villagers look for a bed
    await sleep(60000)
    R.claims = rcon(`data get entity @e[type=villager,tag=wkJ,limit=1,sort=nearest] Brain.memories."minecraft:home"`, `data get entity @e[type=villager,tag=wkJ,limit=1,sort=furthest] Brain.memories."minecraft:home"`,
      `data get entity @e[type=villager,tag=wkJ,limit=1,sort=nearest] VillagerData.profession`, `data get entity @e[type=villager,tag=wkJ,limit=1,sort=furthest] VillagerData.profession`)
      .split('\n').filter(l => !l.startsWith('> ')).map(l => l.slice(0, 200))
    R.records = recs
    P('result', { after: R.after, before: R.before, same: [R.zoneSameBefore, R.zoneSameAfter], farmland: [R.farmlandBefore, R.farmlandAfter], placed: R.placed, inPad: R.placedInZonePad, claims: R.claims, refused: R.refused.slice(0, 10) })
  } finally {
    bot.quit(); await sleep(500)
    const clean = []
    for (let x = X0; x <= X1; x += 40) clean.push(`fill ${x} ${Y - 1} ${Z0} ${Math.min(X1, x + 39)} ${Y + 6} ${Z1} minecraft:air`, `fill ${x} ${Y - 1} ${Z0 + REF_DZ} ${Math.min(X1, x + 39)} ${Y + 6} ${Z1 + REF_DZ} minecraft:air`)
    rcon(`kill @e[type=villager,x=${X0},y=${Y - 5},z=${Z0},dx=${X1 - X0},dy=20,dz=${Z1 - Z0}]`, `kill @e[type=item,x=${X0},y=${Y - 5},z=${Z0},dx=${X1 - X0},dy=20,dz=${Z1 - Z0}]`,
      ...clean, `forceload remove ${X0 - 8} ${Z0 - 8} ${X1 + 8} ${Z1 + REF_DZ + 8}`, 'gamerule doDaylightCycle true')
    console.log('RESULT ' + JSON.stringify(R))
  }
}
main().then(() => process.exit(0)).catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
