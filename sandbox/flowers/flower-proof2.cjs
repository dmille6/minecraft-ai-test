// SANDBOX-ONLY flower-supply proof, part b (flowers-01: the composter's bone meal per fern / per short grass with the bot one block from
// the composter so the popped meal is picked up; shears on tall grass and short grass with the bot in the cell). Part a: flower-proof.cjs.
// (header of part a follows)
// SANDBOX-ONLY flower-supply proof (flowers-01, owner 11-07: "lawns with flowers and tall grass, paths edged with flowers"; design
// docs/reports/flowers-design-2026-11-07.md section "Paper"). Paper 1.21.8 + mineflayer, the bots' own effects (bots/src/buildbot.mjs
// botBuildEffects: hold, look, the block_place click and its acknowledgement, dig, walk), as skills.mjs decorClick / decorNursery use them.
//   BOT_ROOT=<checkout with bots/node_modules> SBX=sandbox5 node sandbox/flowers/flower-proof.cjs
//   (lock first: sandbox/sbxlock.sh take sandbox5 flowers "...", release after)
// Every count is read from the SERVER: plants by a destructive `fill ... air replace <name>` over the arena (its "Successfully filled N"
// is the count; the arena is rebuilt before every trial), the bag by `clear <name> 0`, a block by `execute if block`.
//   M1  bone meal on the centre of a FRESH open 31x31 grass arena in TAIGA (the showcase town's biome), 8 trials: flowers (which names),
//       short grass, tall grass, ferns -- the yield a meal on clear grass
//   M2  the same on a PATCHY arena (every other cell of a checkerboard is podzol): the yield when a nursery's ground is broken
//   M3  four meals on ONE centre with nothing cleared between them (the live nursery's case when its spread is not cleared), then the
//       same four meals with every plant in the spread dug between meals: flowers a meal in each case
//   M4  one meal each in snowy_taiga, plains and meadow (which flowers a biome gives)
//   B1  bone meal on a placed POPPY: is the meal spent? does a poppy item or a new poppy appear?
//   B2  bone meal on a placed LILAC (a tall flower): a lilac item dropped?
//   B3  bone meal on SHORT GRASS: tall grass?
//   S1  shears on tall grass: what drops (short_grass x2?); the bare hand on short grass (seeds or nothing)
//   C1  the composter: 40 ferns inserted one at a time (activateBlock, the compost skill's call), the bone meal taken out each time it
//       is ready -- bone meal per fern; then 40 short grass the same way
//   P1  a poppy picked by hand (dig) -> the item; replanted on grass, podzol, coarse dirt, dirt (the border soils)
//   P2  a poppy placed by the click on the grass's top face where a FERN stands (a fern border cell upgraded): the fern replaced?
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
const SERVER = process.env.SBX || 'sandbox5', PORT = REG.servers[SERVER].port, NAME = 'sbx-Flora', TAG = 'flowers'
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
const X = 6200, G = 140, Z = 6200, H = 15
const R = {}
const isBlock = (x, y, z, name) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${name}`))
const countIn = name => +(r1(`clear ${NAME} minecraft:${name} 0`).match(/Found (\d+)/)?.[1] ?? 0)
const SMALL = ['poppy', 'dandelion', 'cornflower', 'azure_bluet', 'oxeye_daisy', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'allium', 'lily_of_the_valley', 'blue_orchid', 'torchflower', 'wildflowers', 'pink_petals']
const TALLS = ['tall_grass', 'large_fern', 'lilac', 'rose_bush', 'peony', 'sunflower']
const OTHER = ['short_grass', 'fern', 'bush', 'firefly_bush', 'leaf_litter', 'dead_bush', 'sweet_berry_bush']
/** Count (and remove) every plant over the arena's plant layer, by name, from the server. */
function harvestCount () {
  const box = `${X - H} ${G + 1} ${Z - H} ${X + H} ${G + 1} ${Z + H}`
  const cmds = [...TALLS.map(n => `fill ${box} minecraft:air replace minecraft:${n}[half=lower]`), ...SMALL.map(n => `fill ${box} minecraft:air replace minecraft:${n}`), ...OTHER.map(n => `fill ${box} minecraft:air replace minecraft:${n}`)]
  const names = [...TALLS, ...SMALL, ...OTHER]
  const out = {}
  rcon(...cmds).forEach((q, i) => { const m = q.reply.match(/filled (\d+)/); if (m && +m[1] > 0) out[names[i]] = +m[1] })
  // the upper halves the lower fills left floating (they pop) are cleared with the layer above
  rcon(`fill ${X - H} ${G + 2} ${Z - H} ${X + H} ${G + 2} ${Z + H} minecraft:air`, `kill @e[type=item,x=${X - H - 4},y=${G - 4},z=${Z - H - 4},dx=40,dy=20,dz=40]`)
  return out
}
const flowersOf = c => SMALL.reduce((s, n) => s + (c[n] ?? 0), 0)
function arena (biome = 'taiga', patchy = false) {
  const r = rcon(`fill ${X - H - 2} ${G - 2} ${Z - H - 2} ${X + H + 2} ${G + 8} ${Z + H + 2} minecraft:air`,
    `fill ${X - H - 2} ${G - 2} ${Z - H - 2} ${X + H + 2} ${G - 1} ${Z + H + 2} minecraft:dirt`,
    `fill ${X - H} ${G} ${Z - H} ${X + H} ${G} ${Z + H} minecraft:grass_block`,
    `fillbiome ${X - H - 2} ${G - 2} ${Z - H - 2} ${X + H + 2} ${G + 8} ${Z + H + 2} minecraft:${biome}`,
    `kill @e[type=item,x=${X - H - 4},y=${G - 4},z=${Z - H - 4},dx=40,dy=20,dz=40]`)
  if (patchy) {
    const cmds = []
    for (let dx = -H; dx <= H; dx++) for (let dz = -H; dz <= H; dz++) if ((dx + dz) % 2 !== 0 && (dx || dz)) cmds.push(`setblock ${X + dx} ${G} ${Z + dz} minecraft:podzol`)
    rcon(...cmds)
  }
  return r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
}

async function main () {
  requireSandboxLock(SERVER, TAG)
  const { botBuildEffects } = await import(path.resolve(BOT_ROOT, 'bots/src/buildbot.mjs'))
  rcon(`forceload add ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`, 'time set 1000', 'gamerule doDaylightCycle false', 'gamerule randomTickSpeed 0')
  R.setup = arena('taiga')
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`,
      `give ${NAME} minecraft:bone_meal 4`, `give ${NAME} minecraft:shears 1`, `give ${NAME} minecraft:fern 64`, `give ${NAME} minecraft:short_grass 64`, `give ${NAME} minecraft:composter 1`, `give ${NAME} minecraft:tall_grass 2`)
    await sleep(3000)
    await bot.waitForChunksToLoad()
    const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
    bot.pathfinder.setMovements(mv)
    const e = botBuildEffects(bot, { keep: {}, aborted: () => false })
    const click = async (at, item, face = [0, 1, 0]) => {
      if (!(await e.hold(item))) return 'no_item'
      await e.look(at, face)
      const seq = e.nextSeq()
      e.send(at, face, seq)
      return (await e.waitAck(seq, 2000)) === 'acked' ? 'acked' : 'silent'
    }
    // S1b: tall grass placed (2 items given) and cut with shears, the bot walked INTO the cell (the drop is picked up where it stands)
    {
      const at = [X + 2, G + 1, Z]
      await click([X + 2, G, Z], 'tall_grass')
      await sleep(700)
      const placed = isBlock(...at, 'tall_grass[half=lower]')
      const sg0 = countIn('short_grass'), tg0 = countIn('tall_grass')
      await e.hold('shears')
      const dv = await e.dig(at, 'tall_grass')
      try { await e.walkTo(at) } catch (err) { P('walk', String(err)) }
      await sleep(1500)
      R.S1b = { placed, dig: dv, shortGrass: countIn('short_grass') - sg0, tallGrass: countIn('tall_grass') - tg0 }
      // a placed short grass cut with shears from the cell
      const at2 = [X + 3, G + 1, Z]
      await click([X + 3, G, Z], 'short_grass')
      await sleep(600)
      const sgA = countIn('short_grass')
      await e.hold('shears')
      const dv2 = await e.dig(at2, 'short_grass')
      try { await e.walkTo(at2) } catch (err) { P('walk', String(err)) }
      await sleep(1500)
      R.S1b.short = { dig: dv2, back: countIn('short_grass') - sgA }
      P('S1b', R.S1b)
    }
    // C1b: the composter one block from the bot's feet; 64 ferns then 64 short grass; the popped bone meal picked up at the bot's feet
    {
      try { await e.walkTo([X, G + 1, Z]) } catch (err) { P('walk', String(err)) }
      await sleep(400)
      const cAt = [X - 1, G + 1, Z]
      await click([X - 1, G, Z], 'composter')
      await sleep(700)
      const placed = isBlock(...cAt, 'composter')
      const levelOf = () => { const rs = rcon(...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(L => `execute if block ${cAt[0]} ${cAt[1]} ${cAt[2]} minecraft:composter[level=${L}]`)); return rs.findIndex(q => /Test passed/.test(q.reply)) }
      const run = async (item, n) => {
        const out = { item, inserted: 0, meal: 0, cycles: 0, popped: 0 }
        const meal0 = countIn('bone_meal')
        for (let i = 0; i < n; i++) {
          let L = levelOf()
          if (L === 7) { await sleep(1300); L = levelOf() }
          if (L === 8) { await click(cAt, item); await sleep(1200); out.cycles++; continue }
          const have = countIn(item)
          if (!have) break
          await click(cAt, item)
          await sleep(250)
          if (countIn(item) < have) out.inserted++
        }
        await sleep(1300)
        if (levelOf() === 8) { await click(cAt, item); await sleep(1200); out.cycles++ }
        await sleep(1500)
        out.meal = countIn('bone_meal') - meal0
        out.popped = +(r1(`execute if entity @e[type=item,x=${X - 4},y=${G - 2},z=${Z - 4},dx=8,dy=6,dz=8]`).match(/Found (\d+)|passed/)?.[0] ? 1 : 0)
        out.levelLeft = levelOf()
        return out
      }
      R.C1b = { placed, fern: await run('fern', 64) }
      R.C1b.grass = await run('short_grass', 64)
      P('C1b', R.C1b)
    }
  } finally {
    try { bot.quit() } catch { /* gone */ }
    try { rcon('gamerule randomTickSpeed 3', `forceload remove ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`) } catch { /* best effort */ }
  }
  R.summary = { mealPerFern: R.C1b?.fern?.inserted ? +(R.C1b.fern.meal / R.C1b.fern.inserted).toFixed(3) : null, mealPerGrass: R.C1b?.grass?.inserted ? +(R.C1b.grass.meal / R.C1b.grass.inserted).toFixed(3) : null }
  const line = JSON.stringify({ at: new Date().toISOString(), server: SERVER, proof: 'flowers-01b', ...R })
  fs.appendFileSync(path.join(__dirname, 'flower-proof.jsonl'), line + '\n')
  P('SUMMARY', R.summary)
}
main().catch(e => { console.error('FAILED', e); process.exit(1) })
