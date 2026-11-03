// SANDBOX-ONLY (sandbox4) E2E for villageunlock-01 (T3a): the REAL code path -- merchantscout's sightings of a live villager ->
// skills.mjs unlockSee/unlockAsk -> SKILLS.village_unlock.run (goto + activateBlock) through protectzone's guard with a
// protected zone around the arena -- against the replica of village-taiga-6_1's trapdoor ring (sandbox/trading/unlock-proof.cjs).
//   node sandbox/trading/unlock-e2e.mjs        (from a worktree root; take the lock first: sandbox/sbxlock.sh take sandbox4 trading)
// Setup by RCON (sandbox only): the arena, the ring, a smithing table, one unemployed villager, the bot's start.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const X = 3400, Y = 140, Z = 3400, F = Y + 1
const pool = fs.mkdtempSync(path.join(os.tmpdir(), 'vupool-'))
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxunlock',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'vulog-')), POOL_STATE_DIR: pool,
  HOME_X: String(X), HOME_Y: String(F), HOME_Z: String(Z - 20), WORLD_BORDER_RADIUS: '6000', BOT_NAME: 'sbx-Unlock2', LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
})
const BOTS = path.resolve('bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const lock = req(path.resolve('sandbox/lib/sbxlock.cjs'))
const SK = await import(path.join(BOTS, 'src/skills.mjs'))
const PZ = await import(path.join(BOTS, 'src/protectzone.mjs'))
const MS = await import(path.join(BOTS, 'src/merchantscout.mjs'))
const { tapRecords } = await import(path.join(BOTS, 'src/logger.mjs'))
const SERVER = 'sandbox4', PORT = 25602, NAME = 'sbx-Unlock2'
const rcon = (...cmds) => execFileSync('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
const r1 = c => rcon(c).split('\n').slice(1).join(' ').trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const R = {}
const N = [1, 2, 3, 4].map(i => [X + i, F, Z - 1]), S = [1, 2, 3, 4].map(i => [X + i, F, Z + 1]), EW = [[X, F, Z], [X + 5, F, Z]]
const RING = [...N, ...S, ...EW]
const isOpen = ([x, y, z]) => /passed/i.test(r1(`execute if block ${x} ${y} ${z} minecraft:spruce_trapdoor[open=true]`))
const present = ([x, y, z]) => /passed/i.test(r1(`execute if block ${x} ${y} ${z} minecraft:spruce_trapdoor`))
const prof = () => r1('data get entity @e[type=villager,tag=unl2,limit=1] VillagerData.profession')
const ZONE = { version: 1, zones: [{ id: 'village-arena', kind: 'village', box: [X - 8, -64, Z - 8, X + 12, 200, Z + 10] }] }
async function main () {
  lock.requireSandboxLock(SERVER, 'trading')
  const recs = []; tapRecords(r => { if (/village_unlock|protect/.test(r.skill?.name ?? '')) recs.push(`${r.skill.name} ${r.skill.status} ${r.skill.detail}`) })
  rcon(`forceload add ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`,
    `fill ${X - 8} ${Y} ${Z - 8} ${X + 12} ${Y + 5} ${Z + 10} minecraft:air`,
    `fill ${X - 8} ${Y} ${Z - 8} ${X + 12} ${Y} ${Z + 10} minecraft:dirt_path`,
    `fill ${X + 1} ${Y} ${Z} ${X + 4} ${Y} ${Z} minecraft:spruce_planks`,
    `fill ${X - 8} ${F} ${Z - 8} ${X + 12} ${F + 2} ${Z - 8} minecraft:glass`, `fill ${X - 8} ${F} ${Z + 10} ${X + 12} ${F + 2} ${Z + 10} minecraft:glass`,
    `fill ${X - 8} ${F} ${Z - 8} ${X - 8} ${F + 2} ${Z + 10} minecraft:glass`, `fill ${X + 12} ${F} ${Z - 8} ${X + 12} ${F + 2} ${Z + 10} minecraft:glass`,
    ...N.map(([x, y, z]) => `setblock ${x} ${y} ${z} minecraft:spruce_trapdoor[facing=north,half=bottom,open=true]`),
    ...S.map(([x, y, z]) => `setblock ${x} ${y} ${z} minecraft:spruce_trapdoor[facing=south,half=bottom,open=true]`),
    `setblock ${X} ${F} ${Z} minecraft:spruce_trapdoor[facing=west,half=bottom,open=true]`,
    `setblock ${X + 5} ${F} ${Z} minecraft:spruce_trapdoor[facing=east,half=bottom,open=true]`,
    `setblock ${X + 2} ${F} ${Z + 6} minecraft:smithing_table`,
    `kill @e[type=villager,x=${X - 20},y=${Y - 5},z=${Z - 20},dx=40,dy=20,dz=40]`, 'time set 1000')
  await sleep(1000)
  rcon(`summon villager ${X + 2.5} ${F} ${Z + 0.5} {Tags:["unl2"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:taiga"}}`)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  const zl = PZ.parseZones(ZONE).zones
  PZ.attachProtectZone(bot, { zones: () => zl })
  const ac = new AbortController()
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 2.5} ${F} ${Z - 6.5}`)
    await sleep(4000)
    R.ringOpen0 = RING.filter(isOpen).length
    // POSITIVE CONTROL of the guard: a plain activateBlock on a ring trapdoor in the zone is refused
    try { await bot.activateBlock(bot.blockAt(new Vec3(...N[0]))); R.guard = 'NOT refused' } catch (e) { R.guard = 'refused: ' + e.message.slice(0, 50) }
    R.ringOpenAfterGuard = RING.filter(isOpen).length
    await sleep(25000)
    R.control = prof()
    // the real feed: the scout's sightings of the live villager, twice, 21 min apart on the tracker's clock
    const sight = () => MS.merchantSightings(bot.entities, bot.entity.position, { self: bot.entity }).map(s => ({ ...s, zone: 'village-arena' }))
    const s0 = sight()
    R.sighting = s0.map(s => `${s.profession}@${s.x},${s.y},${s.z}`)
    const now = Date.now()
    SK.unlockSee(s0, now - 21 * 60_000); SK.unlockSee(sight(), now)
    const ask = SK.unlockAsk({ now }, bot)
    R.ask = ask?.order ?? null
    P('ask', R.ask, 'guard', R.guard, 'control', R.control)
    if (!ask?.order) return
    R.run = await SK.SKILLS.village_unlock.run({ bot }, ask.order.args, ac.signal)
    P('run', R.run)
    R.ringOpenAfter = RING.filter(isOpen).length
    R.ringPresent = RING.filter(present).length
    const t = Date.now(); R.job = null
    while (Date.now() - t < 90000) { const p = prof(); if (!/minecraft:none/.test(p)) { R.job = { p, s: (Date.now() - t) / 1000 }; break } await sleep(5000) }
    R.health = r1('data get entity @e[type=villager,tag=unl2,limit=1] Health')
    R.again = SK.unlockAsk({ now: Date.now() + 3600_000 }, bot)   // the per-villager cooldown, and the pen is gone
  } finally {
    R.rows = recs
    bot.quit(); await sleep(500)
    rcon('kill @e[type=villager,tag=unl2]', `kill @e[type=item,x=${X - 20},y=${Y - 5},z=${Z - 20},dx=40,dy=20,dz=40]`,
      `fill ${X - 8} ${Y} ${Z - 8} ${X + 12} ${Y + 5} ${Z + 10} minecraft:air`, `forceload remove ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`)
    console.log('RESULT ' + JSON.stringify(R))
    process.exit(0)
  }
}
main().catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
