// SANDBOX-ONLY (decorator-02, owner 11-05): the fern gather, the fern replant, the shears' grass and the compost drive's composting.
// Run: BOT_ROOT=<checkout> node sandbox/decor/decor-proof2.cjs (lock: sandbox/sbxlock.sh take sandbox6 decorproof ...).
//   S1 shears crafted in the 2x2 grid from 2 iron ingots (bot.recipesFor/craft, no table)
//   G1 a fern cut with shears in hand (botBuildEffects dig): the fern in the server's inventory record
//   G2 a large fern cut at its LOWER half with shears: both halves gone, ferns +2?
//   G3 short grass cut with shears: a short_grass item
//   R1 a fern placed on grass by the click on the grass's top face
//   C1 the composter: short grass inserted by activateBlock (the compost skill's call) raises its level (server-read)
// ---- (decorator-01's header follows)
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
const SERVER = process.env.SBX || 'sandbox6', PORT = REG.servers[SERVER].port, NAME = 'sbx-Decor2', TAG = 'decorproof'
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
    `setblock ${X + 3} ${G + 1} ${Z} minecraft:fern`, `setblock ${X + 5} ${G + 1} ${Z} minecraft:large_fern[half=lower]`, `setblock ${X + 5} ${G + 2} ${Z} minecraft:large_fern[half=upper]`,
    `setblock ${X + 7} ${G + 1} ${Z} minecraft:short_grass`, `setblock ${X - 4} ${G + 1} ${Z - 4} minecraft:composter`,
    `kill @e[type=item,x=${X - 25},y=${G - 5},z=${Z - 25},dx=50,dy=20,dz=50]`, 'time set 1000', 'gamerule doDaylightCycle false')
  const bad = setup.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
  R.setup = bad.length ? bad : 'ok'
  P('setup', R.setup)
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`, `give ${NAME} minecraft:iron_ingot 2`, `give ${NAME} minecraft:short_grass 8`)
    await sleep(3000)
    await bot.waitForChunksToLoad()
    const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
    bot.pathfinder.setMovements(mv)
    const e = botBuildEffects(bot, { keep: {}, aborted: () => false })
    // S1
    const recipe = bot.recipesFor(bot.registry.itemsByName.shears.id, null, 1, null)?.[0]
    if (recipe) { try { await bot.craft(recipe, 1, null) } catch (err) { P('craft', String(err)) } }
    await sleep(800)
    R.S1 = { recipe: !!recipe, shears: countIn('shears'), iron: countIn('iron_ingot') }
    const hold = async n => { const it = bot.inventory.items().find(i => i.name === n); if (it) await bot.equip(it, 'hand'); return bot.heldItem?.name === n }
    const cut = async (at, name, key) => {
      try { await e.walkTo(at) } catch (err) { P('walk', String(err)) }
      await sleep(300)
      const held = await hold('shears')
      const before = { fern: countIn('fern'), short_grass: countIn('short_grass') }
      const v = await e.dig(at, name)
      await sleep(1500)
      R[key] = { held, dig: v, gone: isBlock(...at, 'air'), upperGone: isBlock(at[0], at[1] + 1, at[2], 'air'), fern: [before.fern, countIn('fern')], short_grass: [before.short_grass, countIn('short_grass')] }
      P(key, R[key])
    }
    await cut([X + 3, G + 1, Z], 'fern', 'G1')
    await cut([X + 5, G + 1, Z], 'large_fern', 'G2')
    await cut([X + 7, G + 1, Z], 'short_grass', 'G3')
    // R1 a fern on grass
    try { await e.walkTo([X, G + 1, Z + 2]) } catch {}
    const okHold = await e.hold('fern')
    if (okHold) { await e.look([X + 2, G, Z + 2], [0, 1, 0]); const seq = e.nextSeq(); e.send([X + 2, G, Z + 2], [0, 1, 0], seq); R.R1click = await e.waitAck(seq, 2000) }
    await sleep(800)
    R.R1 = { fern: isBlock(X + 2, G + 1, Z + 2, 'fern'), held: okHold }
    // C1 composting the short grass (the compost skill's call: activateBlock with the item in hand)
    try { await e.walkTo([X - 3, G + 1, Z - 4]) } catch {}
    const lv = () => [0, 1, 2, 3, 4, 5, 6, 7, 8].find(l => isBlock(X - 4, G + 1, Z - 4, `composter[level=${l}]`))
    const l0 = lv(); const g0 = countIn('short_grass')
    for (let i = 0; i < 6 && countIn('short_grass') > 0; i++) { await hold('short_grass'); try { await bot.activateBlock(bot.blockAt(new Vec3(X - 4, G + 1, Z - 4))) } catch (err) { P('use', String(err)) } await sleep(400) }
    R.C1 = { level: [l0, lv()], grass: [g0, countIn('short_grass')] }
    P('C1', R.C1)
  } finally { try { bot.quit() } catch { /* gone */ } }
  R.pass = { S1: R.S1?.shears === 1, G1: !!R.G1?.gone && R.G1.fern[1] === R.G1.fern[0] + 1, G2: !!R.G2?.gone && R.G2.fern[1] > R.G2.fern[0], G3: !!R.G3?.gone && R.G3.short_grass[1] === R.G3.short_grass[0] + 1, R1: !!R.R1?.fern, C1: R.C1 && R.C1.grass[1] < R.C1.grass[0] && R.C1.level[1] > R.C1.level[0] }
  const line = JSON.stringify({ at: new Date().toISOString(), server: SERVER, proof: 'decor-02', ...R })
  fs.appendFileSync(path.join(__dirname, 'decor-proof.jsonl'), line + '\n')
  P('RESULT', R.pass)
  console.log(line)
}
main().catch(e => { console.error('FAILED', e); process.exit(1) })
