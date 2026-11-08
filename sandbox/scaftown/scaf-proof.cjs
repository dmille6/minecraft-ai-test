// SANDBOX-ONLY proof for scaftown-01 (owner 11-07: "we're still using dirt as a cheap way to get around and get over obstacles";
// design docs/reports/scaffold-design-2026-11-07.md, section "Paper"). Paper 1.21.8 + mineflayer + mineflayer-pathfinder 2.4.5 with
// the WALK profile built the way index.mjs builds it (canDig false, 1x1 towers, extendScaffolding, no parkour, maxDropDown 6,
// placeCost 5, nobridge, the lid price) and, for the candidate, bots/src/scaftown.mjs installed exactly as index.mjs installs it
// (installScafTownPrice on the walk + installScafTownSearch on bot.pathfinder; home = the arena centre).
//   BOT_ROOT=<checkout with bots/node_modules> SBX=sandbox6 node sandbox/scaftown/scaf-proof.cjs
//   (lock first: sandbox/sbxlock.sh take sandbox6 scaftown "...", release after)
// Every count is the SERVER's: the bot's dirt by `clear <bot> dirt 0`, the blocks left by a destructive `fill ... air replace dirt`
// over the arena after each trial (its "Successfully filled N" is the count; the arena is rebuilt before every trial).
//   LEDGE  a 3-high stone shelf across the arena; a staircase of one-high steps 14 blocks along it; the bot walks from the floor to
//          a cell on the shelf (the owner's "over obstacles"): base vs candidate, 3 trials each
//   WALL   a 4-high wall with a 1-wide gate 18 blocks along it; the bot walks to the far side
//   PIT    the bot stands in a 1x1 pit 3 deep with nothing to climb, the goal 4 blocks away on the floor: the candidate must still get
//          out (no new dead end); the pillar it leaves is expected (the groundskeeper's ledger takes it back)
//   FAR    the LEDGE scene with home 500 blocks away: the candidate must tower like the base (scaffold far from town is unchanged)
// Setup in the sandbox only (the owner's no-admin-edit rule is for the bots' worlds): forceload, fill, give, tp.
'use strict'
const { execFileSync } = require('child_process')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { pathfinder, Movements, goals } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const REG = require('../sandboxes.json')
const SERVER = process.env.SBX || 'sandbox6', PORT = REG.servers[SERVER].port, NAME = 'sbx-Scaf', TAG = 'scaftown'
const SSH = ['-o', 'BatchMode=yes', 'mike@' + REG.host]
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0].reply
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const X = 7200, G = 100, Z = 7200, H = 20   // the arena: floor top at G, x/z +-H
const countIn = name => +(r1(`clear ${NAME} minecraft:${name} 0`).match(/Found (\d+)/)?.[1] ?? 0)
const dirtLeft = () => { const m = r1(`fill ${X - H} ${G - 6} ${Z - H} ${X + H} ${G + 8} ${Z + H} minecraft:air replace minecraft:dirt`).match(/filled (\d+)/); return m ? +m[1] : 0 }

function arena (scene) {
  const cmds = [`fill ${X - H} ${G - 8} ${Z - H} ${X + H} ${G} ${Z + H} minecraft:stone`, `fill ${X - H} ${G + 1} ${Z - H} ${X + H} ${G + 12} ${Z + H} minecraft:air`]
  if (scene === 'ledge' || scene === 'far') {
    // shelf x 4..9 from the centre, the whole z span, top G+3; stairs at z+14: G+1 at x+1, G+2 at x+2, G+3 at x+3
    cmds.push(`fill ${X + 4} ${G + 1} ${Z - H} ${X + 9} ${G + 3} ${Z + H} minecraft:stone`)
    cmds.push(`setblock ${X + 1} ${G + 1} ${Z + 14} minecraft:stone`, `fill ${X + 2} ${G + 1} ${Z + 14} ${X + 2} ${G + 2} ${Z + 14} minecraft:stone`, `fill ${X + 3} ${G + 1} ${Z + 14} ${X + 3} ${G + 3} ${Z + 14} minecraft:stone`)
  }
  if (scene === 'wall') {
    cmds.push(`fill ${X + 4} ${G + 1} ${Z - H} ${X + 4} ${G + 4} ${Z + H} minecraft:stone_bricks`, `fill ${X + 4} ${G + 1} ${Z + 18} ${X + 4} ${G + 3} ${Z + 18} minecraft:air`)
  }
  if (scene === 'pit') cmds.push(`fill ${X} ${G - 2} ${Z} ${X} ${G} ${Z} minecraft:air`)
  const out = rcon(...cmds)
  const bad = out.filter(q => !/(filled|placed|Changed the block)/i.test(q.reply))
  if (bad.length) throw new Error(`arena setup failed: ${bad.map(q => q.cmd + ' -> ' + q.reply).join(' | ')}`)
}
const SCENES = {
  ledge: { start: [0, 1, 0], goal: [6, 4, 0], home: [0, 0] },
  far: { start: [0, 1, 0], goal: [6, 4, 0], home: [500, 500] },
  wall: { start: [0, 1, 0], goal: [8, 1, 0], home: [0, 0] },
  pit: { start: [0, -2, 0], goal: [4, 1, 0], home: [0, 0] },
}

async function main () {
  requireSandboxLock(SERVER, TAG)
  const ST = await import(path.join(BOT_ROOT, 'bots/src/scaftown.mjs'))
  const LP = await import(path.join(BOT_ROOT, 'bots/src/lidplace.mjs'))
  const SC = await import(path.join(BOT_ROOT, 'bots/src/scaffold.mjs'))
  const NB = await import(path.join(BOT_ROOT, 'bots/src/nobridge.mjs'))
  rcon(`forceload add ${X - 48} ${Z - 48} ${X + 48} ${Z + 48}`, 'time set 1000', 'gamerule doDaylightCycle false', 'difficulty peaceful', 'gamerule doTileDrops true')
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('spawned', bot.version)
  // the walk profile (index.mjs), once; the candidate's price is installed on its own copy
  const walk = () => {
    const m = new Movements(bot)
    m.canDig = false; m.allow1by1towers = true; SC.extendScaffolding(m, bot.registry); m.allowParkour = false; m.maxDropDown = 6; m.placeCost = 5; m.liquidCost = 2
    NB.installNoBridge(m, (x, y, z) => bot.blockAt(new Vec3(x, y, z)), () => bot.game?.minY ?? -64)
    const s = new Vec3(0, 0, 0)
    LP.installLidPrice(m, LP.makeLidPlacePrice({ registry: bot.registry, guard: () => null, stateIdAt: (x, y, z) => { s.x = x; s.y = y; s.z = z; return bot.world.getBlockStateId(s) } }))
    return m
  }
  let area = null
  const price = ST.makeScafTownPrice({ area: () => area, now: () => performance.now() })
  ST.installScafTownSearch(bot.pathfinder, price)   // inert for the base: its movements carry no town price (no own getNeighbors)
  const base = walk(), cand = ST.installScafTownPrice(walk(), price)
  const R = []
  const trial = async (scene, arm) => {
    const sc = SCENES[scene]
    arena(scene)
    area = ST.scafAreaOf({ home: { x: X + sc.home[0], y: G + 1, z: Z + sc.home[1] } })
    rcon(`clear ${NAME}`, `give ${NAME} minecraft:dirt 64`, `tp ${NAME} ${X + sc.start[0] + 0.5} ${G + sc.start[1]} ${Z + sc.start[2] + 0.5}`)
    await sleep(1500)
    const fp = bot.entity.position, below = bot.blockAt(fp.offset(0, -1, 0))?.name
    if (Math.abs(fp.x - (X + sc.start[0] + 0.5)) > 0.6 || below !== 'stone') throw new Error(`setup: bot at ${fp} on ${below}`)
    bot.pathfinder.setMovements(arm === 'cand' ? cand : base)
    const d0 = countIn('dirt')
    const t0 = Date.now(), ups = []
    const onUp = r => ups.push({ s: r.status, ms: Date.now() - t0, vis: r.visitedNodes })
    bot.on('path_update', onUp)
    let ok = true, err = null
    const h0 = price.hits, lt0 = price.latches, cu0 = price.cuts
    try {
      await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(X + sc.goal[0], G + sc.goal[1], Z + sc.goal[2])), sleep(60000).then(() => { throw new Error('60 s') })])
    } catch (e) { ok = false; err = e.message }
    bot.removeListener('path_update', onUp)
    try { bot.pathfinder.setGoal(null) } catch {}
    await sleep(800)
    const p = bot.entity.position
    const atGoal = Math.floor(p.x) === X + sc.goal[0] && Math.floor(p.y + 1e-6) === G + sc.goal[1] && Math.floor(p.z) === Z + sc.goal[2]
    const used = d0 - countIn('dirt'), left = dirtLeft()
    const firstSuccess = ups.find(u => u.s === 'success')
    const row = { scene, arm, ok, err, atGoal, ms: Date.now() - t0, dirt_used: used, dirt_left_in_world: left, plan_ms: firstSuccess?.ms ?? null,
      plans: ups.length, statuses: [...new Set(ups.map(u => u.s))].join('/'), hits: price.hits - h0, latches: price.latches - lt0, cuts: price.cuts - cu0 }
    P(row); R.push(row)
  }
  for (const scene of ['ledge', 'wall', 'pit', 'far']) for (let i = 0; i < 3; i++) for (const arm of ['base', 'cand']) await trial(scene, arm)
  const sum = {}
  for (const r of R) { const k = `${r.scene}.${r.arm}`; const s = sum[k] ??= { n: 0, arrived: 0, dirt_left: 0, dirt_used: 0, ms: [], plan_ms: [] }; s.n++; s.arrived += r.atGoal ? 1 : 0; s.dirt_left += r.dirt_left_in_world; s.dirt_used += r.dirt_used; s.ms.push(r.ms); s.plan_ms.push(r.plan_ms) }
  P('SUMMARY', sum)
  require('fs').writeFileSync(path.join(__dirname, 'scaf-proof.jsonl'), R.map(r => JSON.stringify(r)).join('\n') + '\n')
  rcon(`fill ${X - H} ${G - 8} ${Z - H} ${X + H} ${G + 12} ${Z + H} minecraft:air`, `forceload remove ${X - 48} ${Z - 48} ${X + 48} ${Z + 48}`)
  bot.quit(); await sleep(500); process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
