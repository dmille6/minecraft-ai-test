// SANDBOX-ONLY: the decorator's actuators (decorator-01, owner 11-04; docs/reports/decorator-design-2026-11-04.md section "Paper").
//   BOT_ROOT=<checkout with bots/node_modules> node sandbox/decor/decor-proof.cjs
//   (take the lock first: sandbox/sbxlock.sh take sandbox6 decorproof "...", release after). SBX=<name> picks another sandbox.
// THE BOT'S OWN CODE drives every action: bots/src/buildbot.mjs botBuildEffects (hold, look, the `block_place` click, the server's
// acknowledgement, the dig, the walk), as skills.mjs decorClick / decorPotFill / decorNursery and runVisit's placement use it. Every
// result is read back from the SERVER (RCON `execute if block`, the inventory via `clear <name> 0`), never the client's own world.
//   F1 a poppy placed on grass (the border's placement: the click on the grass's top face)
//   P1 a flower pot placed on grass (the pot cell's placement)
//   P2 the pot FILLED with a spruce sapling by the use click on the pot's top face -> potted_spruce_sapling, the sapling spent
//   P3 a second pot filled with a poppy -> potted_poppy
//   N1 bone meal used on a grass block's top face in an open TAIGA meadow (fillbiome: the showcase's biome), three times on three fresh
//      centres: the flowers (names) and short grass that grew, and the farthest Chebyshev distance of any new plant (the spread bound
//      the nursery's guard rests on: decorator.mjs NURSERY.spread = 7)
//   H1 a grown flower harvested: walked into its cell, dug, the item in the server's inventory record
// Setup in the sandbox only (the owner's no-admin-edit rule is for the bots' worlds): forceload, fill, fillbiome, give, tp.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const REG = require('../sandboxes.json')
const SERVER = process.env.SBX || 'sandbox6', PORT = REG.servers[SERVER].port, NAME = 'sbx-Decor', TAG = 'decorproof'
const SSH = ['-o', 'BatchMode=yes', 'mike@' + REG.host]
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0].reply
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const X = 5200, G = 140, Z = 5200, H = 20
const R = {}
const isBlock = (x, y, z, name) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${name}`))
const countIn = name => +(r1(`clear ${NAME} minecraft:${name} 0`).match(/Found (\d+)/)?.[1] ?? 0)
const PLANTS = ['short_grass', 'tall_grass', 'poppy', 'dandelion', 'cornflower', 'azure_bluet', 'oxeye_daisy', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'allium', 'lily_of_the_valley', 'blue_orchid', 'fern']
/** Every plant in the box round a centre, read from the SERVER one name at a time over a box (execute if blocks counts). */
function plantsAround (cx, cz, r) {
  // one RCON call per cell would be ~1,700 calls; instead `execute if block` per name per ROW is still many -- read cells in one batch
  const cmds = []
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) cmds.push(`execute if block ${cx + dx} ${G + 1} ${cz + dz} minecraft:air`)
  const air = rcon(...cmds).map(x => /Test passed/.test(x.reply))
  const out = []
  let i = 0
  const cells = []
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { if (!air[i]) cells.push([cx + dx, cz + dz, Math.max(Math.abs(dx), Math.abs(dz))]); i++ }
  // name each non-air cell
  for (const [x, z, d] of cells) {
    const names = rcon(...PLANTS.map(n => `execute if block ${x} ${G + 1} ${z} minecraft:${n}`)).map((q, k) => (/Test passed/.test(q.reply) ? PLANTS[k] : null)).filter(Boolean)
    out.push({ at: [x, G + 1, z], d, name: names[0] ?? 'other' })
  }
  return out
}

async function main () {
  requireSandboxLock(SERVER, TAG)
  const { botBuildEffects } = await import(path.resolve(BOT_ROOT, 'bots/src/buildbot.mjs'))
  const setup = rcon(`forceload add ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`,
    `fill ${X - H} ${G - 2} ${Z - H} ${X + H} ${G + 6} ${Z + H} minecraft:air`,
    `fill ${X - H} ${G - 2} ${Z - H} ${X + H} ${G - 1} ${Z + H} minecraft:dirt`,
    `fill ${X - H} ${G} ${Z - H} ${X + H} ${G} ${Z + H} minecraft:grass_block`,
    `fillbiome ${X - H} ${G - 4} ${Z - H} ${X + H} ${G + 11} ${Z + H} minecraft:taiga`,
    `kill @e[type=item,x=${X - 25},y=${G - 5},z=${Z - 25},dx=50,dy=20,dz=50]`, 'time set 1000', 'gamerule doDaylightCycle false')
  const bad = setup.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
  R.setup = bad.length ? bad : 'ok'
  P('setup', R.setup)
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('spawned', bot.version)
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`,
      `give ${NAME} minecraft:poppy 4`, `give ${NAME} minecraft:flower_pot 2`, `give ${NAME} minecraft:spruce_sapling 20`, `give ${NAME} minecraft:bone_meal 3`)
    await sleep(3000)
    await bot.waitForChunksToLoad()
    const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
    bot.pathfinder.setMovements(mv)
    const e = botBuildEffects(bot, { keep: {}, aborted: () => false })
    const click = async (at, item) => {
      if (!(await e.hold(item))) return 'no_item'
      await e.look(at, [0, 1, 0])
      const seq = e.nextSeq()
      e.send(at, [0, 1, 0], seq)
      return (await e.waitAck(seq, 2000)) === 'acked' ? 'acked' : 'silent'
    }
    // F1 the border's placement: a poppy on the grass at X+2, Z (the bot at X, Z)
    const f1 = await click([X + 2, G, Z], 'poppy')
    await sleep(700)
    R.F1 = { click: f1, poppy: isBlock(X + 2, G + 1, Z, 'poppy'), poppies: countIn('poppy') }
    // P1 / P2 / P3 the pots: placed on the grass at X-2, Z and X-2, Z+2; filled with a sapling and a poppy
    const p1 = await click([X - 2, G, Z], 'flower_pot')
    await sleep(700)
    R.P1 = { click: p1, pot: isBlock(X - 2, G + 1, Z, 'flower_pot') }
    const s0 = countIn('spruce_sapling')
    const p2 = await click([X - 2, G + 1, Z], 'spruce_sapling')
    await sleep(700)
    R.P2 = { click: p2, potted: isBlock(X - 2, G + 1, Z, 'potted_spruce_sapling'), saplings: [s0, countIn('spruce_sapling')] }
    await click([X - 2, G, Z + 2], 'flower_pot')
    await sleep(700)
    const p3 = await click([X - 2, G + 1, Z + 2], 'poppy')
    await sleep(700)
    R.P3 = { click: p3, potted: isBlock(X - 2, G + 1, Z + 2, 'potted_poppy'), poppies: countIn('poppy') }
    // N1 three meals on three fresh centres (each 14 apart: no overlap of their 7-spread), the bot standing on the centre
    R.N1 = []
    for (const [cx, cz] of [[X + 10, Z - 10], [X - 10, Z - 10], [X + 10, Z + 10]]) {
      try { await e.walkTo([cx, G + 1, cz]) } catch (err) { P('walk', String(err)) }
      await sleep(400)
      const v = await click([cx, G, cz], 'bone_meal')
      await sleep(1500)
      const plants = plantsAround(cx, cz, 9)
      const flowers = plants.filter(p => !/grass|fern|other/.test(p.name))
      R.N1.push({ centre: [cx, cz], click: v, feet: e.feet(), plants: plants.length, flowers: flowers.map(f => f.name), grass: plants.filter(p => p.name === 'short_grass').length, maxD: Math.max(0, ...plants.map(p => p.d)), others: plants.filter(p => p.name === 'other').length })
      P('meal', R.N1.at(-1))
      // H1 harvest the first flower that grew (walk into its cell, dig, the item counted by the server)
      if (!R.H1 && flowers.length) {
        const f = flowers[0]
        const before = countIn(f.name)
        try { await e.walkTo(f.at) } catch (err) { P('walk', String(err)) }
        await sleep(300)
        const dv = await e.dig(f.at, f.name)
        await sleep(1200)
        R.H1 = { at: f.at, name: f.name, dig: dv, gone: isBlock(...f.at, 'air'), inBag: [before, countIn(f.name)] }
        P('harvest', R.H1)
      }
    }
    R.mealsLeft = countIn('bone_meal')
  } finally {
    try { bot.quit() } catch { /* gone */ }
  }
  R.pass = { F1: !!R.F1?.poppy, P1: !!R.P1?.pot, P2: !!R.P2?.potted && R.P2.saplings[1] === R.P2.saplings[0] - 1, P3: !!R.P3?.potted, N1: R.N1?.length === 3 && R.N1.every(n => n.click === 'acked' && n.plants > 0 && n.maxD <= 7), H1: !!R.H1?.gone && R.H1.inBag[1] === R.H1.inBag[0] + 1 }
  const line = JSON.stringify({ at: new Date().toISOString(), server: SERVER, ...R })
  fs.appendFileSync(path.join(__dirname, 'decor-proof.jsonl'), line + '\n')
  P('RESULT', R.pass)
  console.log(line)
}
main().catch(e => { console.error('FAILED', e); process.exit(1) })
