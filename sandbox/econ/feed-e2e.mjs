// SANDBOX-ONLY E2E for villagefeed-01show (derived from sandbox/trading/hay-e2e.mjs): the REAL code path -- skills.mjs marketAsk
// (villagefeed.mjs feedAdmit) -> SKILLS.village_feed.run (withdraw the town's wheat, craft bread at the town table, walk to the
// cluster, toss one loaf at a time, credit by `playerCollect`, walk home) -- on Paper 1.21.8, every result read back from the
// SERVER (`data get entity ... Inventory`, `clear <bot> <item> 0`, the chest's Items, the villager count). Then the breeding wait:
// 3 free beds beside the pair; a baby within 6 min, and the next ask's note logs `_villagefeed op=birth fed=1`.
//   SBX=sandbox7 node sandbox/econ/feed-e2e.mjs   (lock: sandbox/sbxlock.sh take <sbx> econ "...")
// Setup by RCON (sandbox only): a walled grass platform, the town chest (wheat 141, the showcase's 11-08 count), a crafting table,
// two JOBLESS adults summoned with CanPickUpLoot:1b (a summon with NBT skips finalizeSpawn and leaves it 0b; every real villager on
// the showcase has 1b) 14 b east of home, three beds beyond them.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const X = 4600, Y = 140, Z = 4600, F = Y + 1
// E2E_MODE: (default) 3 beds -> fed and a baby; `noroom` 1 bed for 2 adults, no wool -> counted no room, nothing tossed, the room noted;
// `beds` 1 bed + 6 white wool in the chest -> run 1 counts no room, run 2 brings 2 beds (crafted from the wool), places them, feeds
const MODE = process.env.E2E_MODE || 'fed'
const POOL = fs.mkdtempSync(path.join(os.tmpdir(), 'vfpool-'))
const NAME = 'sbx-Feed'
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxfeed',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'vflog-')), POOL_STATE_DIR: POOL,
  HOME_X: String(X), HOME_Y: String(F), HOME_Z: String(Z), WORLD_BORDER_RADIUS: '20000', BOT_NAME: NAME, LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
})
const BOTS = path.resolve('bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const lock = req(path.resolve('sandbox/lib/sbxlock.cjs'))
const SK = await import(path.join(BOTS, 'src/skills.mjs'))
const CS = await import(path.join(BOTS, 'src/craftsync.mjs'))
const { tapRecords } = await import(path.join(BOTS, 'src/logger.mjs'))
const SERVER = process.env.SBX || 'sandbox7', REG = req(path.resolve('sandbox/sandboxes.json')), PORT = REG.servers[SERVER].port
const rcon = (...cmds) => execFileSync('ssh', ['-o', 'BatchMode=yes', `mike@${REG.host}`, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
const r1 = c => rcon(c).split('\n').slice(1).join(' ').trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const R = {}
const countIn = n => +(r1(`clear ${NAME} minecraft:${n} 0`).match(/Found (\d+)/)?.[1] ?? 0)
const breadOf = tag => { const s = r1(`data get entity @e[type=villager,tag=${tag},limit=1] Inventory`); return [...s.matchAll(/count:\s*(\d+),\s*id:\s*"minecraft:bread"|id:\s*"minecraft:bread",\s*count:\s*(\d+)/g)].reduce((a, m) => a + +(m[1] || m[2]), 0) }
const villagers = () => +(r1(`execute if entity @e[type=villager,x=${X - 22},y=${Y - 2},z=${Z - 22},dx=44,dy=10,dz=44]`).match(/count: (\d+)/)?.[1] ?? 0)
async function main () {
  lock.requireSandboxLock(SERVER, 'econ')
  const recs = []
  tapRecords(r => { if (process.env.ALLREC || /villagefeed|withdraw|craft|count_town/.test(r.skill?.name ?? '')) recs.push(`${r.skill.name} ${r.skill.status} ${String(r.skill.detail ?? '').slice(0, 200)}`) })
  const mg0 = r1('gamerule mobGriefing')
  rcon(`forceload add ${X - 24} ${Z - 24} ${X + 24} ${Z + 24}`, 'gamerule mobGriefing true', 'difficulty peaceful',
    `fill ${X - 24} ${Y - 1} ${Z - 24} ${X + 24} ${Y + 6} ${Z + 24} minecraft:air`,
    `fill ${X - 22} ${Y - 1} ${Z - 22} ${X + 22} ${Y - 1} ${Z + 22} minecraft:stone`,
    `fill ${X - 22} ${Y} ${Z - 22} ${X + 22} ${Y} ${Z + 22} minecraft:grass_block`,
    `fill ${X - 22} ${F} ${Z - 22} ${X + 22} ${F + 3} ${Z - 22} minecraft:glass`, `fill ${X - 22} ${F} ${Z + 22} ${X + 22} ${F + 3} ${Z + 22} minecraft:glass`,
    `fill ${X - 22} ${F} ${Z - 22} ${X - 22} ${F + 3} ${Z + 22} minecraft:glass`, `fill ${X + 22} ${F} ${Z - 22} ${X + 22} ${F + 3} ${Z + 22} minecraft:glass`,
    `setblock ${X - 3} ${F} ${Z - 3} minecraft:chest`, `setblock ${X + 2} ${F} ${Z - 3} minecraft:crafting_table`,
    `item replace block ${X - 3} ${F} ${Z - 3} container.0 with minecraft:wheat 64`, `item replace block ${X - 3} ${F} ${Z - 3} container.1 with minecraft:wheat 64`,
    `item replace block ${X - 3} ${F} ${Z - 3} container.2 with minecraft:wheat 13`,
    ...(MODE === 'beds' ? [`item replace block ${X - 3} ${F} ${Z - 3} container.3 with minecraft:white_wool 6`, `item replace block ${X - 3} ${F} ${Z - 3} container.4 with minecraft:oak_log 8`] : []),
    // three beds east of the pair (run 1 fenced the pair in a yard: the walk ended `walk_short` at the yard -- that is a pathing question
    // for the live village, not this proof's; the platform's glass wall keeps them near)
    ...(MODE === 'noroom' || MODE === 'beds' ? [-4] : [-4, 0, 4]).flatMap(dz => [`setblock ${X + 18} ${F} ${Z + dz} minecraft:white_bed[facing=east,part=foot]`, `setblock ${X + 19} ${F} ${Z + dz} minecraft:white_bed[facing=east,part=head]`]),
    `kill @e[type=villager,x=${X - 30},y=${Y - 5},z=${Z - 30},dx=60,dy=20,dz=60]`, `kill @e[type=item,x=${X - 30},y=${Y - 5},z=${Z - 30},dx=60,dy=20,dz=60]`,
    `kill @e[type=wandering_trader,x=${X - 96},y=${Y - 40},z=${Z - 96},dx=192,dy=80,dz=192]`,   // run 4: a naturally spawned trader took the ask (market_run)
    'time set 2000', 'gamerule doDaylightCycle false')
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  CS.installCraftSync(bot, { log: () => {} })
  const ac = new AbortController()
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${F} ${Z + 0.5}`)
    await sleep(3000)
    R.seed = (await SK.SKILLS.withdraw.run({ bot }, { item: 'wheat', count: 1 }, ac.signal))?.status
    R.count = (await SK.SKILLS.count_town.run({ bot }, {}, ac.signal))?.status
    rcon(`clear ${NAME} minecraft:wheat`, `item replace block ${X - 3} ${F} ${Z - 3} container.2 with minecraft:wheat 13`)
    rcon(`summon villager ${X + 14.5} ${F} ${Z - 1.5} {CanPickUpLoot:1b,Tags:["vf","vf1"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
      `summon villager ${X + 14.5} ${F} ${Z + 2.5} {CanPickUpLoot:1b,Tags:["vf","vf2"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`)
    await sleep(3000)
    const ask = SK.marketAsk({ now: Date.now() }, bot)
    R.ask = ask
    P('ask', ask)
    const before = { wheat: countIn('wheat'), bread: countIn('bread'), villagers: villagers() }
    if (ask?.order) { const t = Date.now(); R.run = await SK.SKILLS[ask.order.skill].run({ bot }, ask.order.args, ac.signal); R.ms = Date.now() - t }
    await sleep(1500)
    if (MODE === 'beds') {
      // up to 3 more runs (the cooldown reset between them): beds brought and placed, then the feed once there is room
      R.runs = [R.run]
      for (let i = 0; i < 3 && !/tossed [1-9]/.test(R.run?.detail ?? ''); i++) {
        SK._feedTest.vfState.lastRunAt = -Infinity
        rcon(`tp ${NAME} ${X + 0.5} ${F} ${Z + 0.5}`)
        await sleep(2000)
        const ask2 = SK.marketAsk({ now: Date.now() }, bot)
        P('ask', i + 2, ask2)
        if (!ask2?.order) break
        R.run = await SK.SKILLS[ask2.order.skill].run({ bot }, ask2.order.args, ac.signal)
        R.runs.push(R.run)
        P('run', i + 2, R.run)
      }
      R.bedsNear = r1(`execute if block ${X + 18} ${F} ${Z - 4} minecraft:white_bed`)
      await sleep(1500)
    }
    R.server = { before, after: { wheat: countIn('wheat'), bread: countIn('bread') }, vf1: breadOf('vf1'), vf2: breadOf('vf2'),
      chest: r1(`data get block ${X - 3} ${F} ${Z - 3} Items`).replace(/^.*block data: /, '').slice(0, 300), botAt: r1(`data get entity ${NAME} Pos`) }
    P('result', R.run, R.server)
    // the breeding wait (both fed >= 3 -> willing; 3 free beds in the yard)
    if (process.env.GOTODBG) { try { R.gotoDbg = await SK.SKILLS.goto.run({ bot }, { x: X + 13, y: F, z: Z, range: 3 }, ac.signal) } catch (e) { R.gotoDbg = 'threw ' + (e?.stack ?? e).slice(0, 600) } P('goto', R.gotoDbg, r1(`data get entity ${NAME} Pos`)) }
    if (MODE === 'noroom') { R.records = recs; R.ok = { noToss: R.server.vf1 + R.server.vf2 === 0, noted: recs.some(r => /stop=no_bed_room/.test(r) && /room=-1/.test(r)) }; throw new Error('noroom: done') }
    if (process.env.NOBREED) { R.records = recs; throw new Error('NOBREED: stop after the run') }
    const n0 = villagers()
    const t1 = Date.now()
    while (Date.now() - t1 < 6 * 60_000 && villagers() <= n0) await sleep(5000)
    R.breed = { before: n0, after: villagers(), s: Math.round((Date.now() - t1) / 1000), vf1Left: breadOf('vf1'), vf2Left: breadOf('vf2') }
    P('breed', R.breed)
    // the next note sees the baby: a birth row fed=1 (the bot walks into sight of the yard)
    rcon(`tp ${NAME} ${X + 8.5} ${F} ${Z + 0.5}`)
    await sleep(2500)
    SK._feedTest.vfNote(bot, Date.now(), { force: true })
    R.records = recs
    R.birthRows = recs.filter(r => /op=birth/.test(r))
    R.ok = { fedBoth: R.server.vf1 >= 3 && R.server.vf2 >= 3, wheatDrawn: before.wheat === 0, baby: R.breed.after > R.breed.before, birthRow: R.birthRows.some(r => /fed=1/.test(r)) }
  } finally {
    bot.quit(); await sleep(500)
    rcon(`kill @e[type=villager,x=${X - 30},y=${Y - 5},z=${Z - 30},dx=60,dy=20,dz=60]`, `kill @e[type=item,x=${X - 30},y=${Y - 5},z=${Z - 30},dx=60,dy=20,dz=60]`,
      `fill ${X - 24} ${Y - 1} ${Z - 24} ${X + 24} ${Y + 6} ${Z + 24} minecraft:air`, `forceload remove ${X - 24} ${Z - 24} ${X + 24} ${Z + 24}`,
      'gamerule doDaylightCycle true', `gamerule mobGriefing ${/false/.test(mg0) ? 'false' : 'true'}`)
    fs.appendFileSync(path.resolve('sandbox/econ/feed-e2e.jsonl'), JSON.stringify({ run: new Date(T0).toISOString(), ...R }) + '\n')
    console.log('RESULT ' + JSON.stringify(R))
  }
}
main().then(() => process.exit(0)).catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
