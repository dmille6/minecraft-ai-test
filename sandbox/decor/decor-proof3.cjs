// SANDBOX-ONLY (decorator-03: leaf hedges + lantern posts): L1 spruce leaves placed on grass are persistent and stay through a
// fast random-tick spell; F1 a spruce fence placed on grass; N1 a lantern placed on the fence's top face stands on it (hanging=false);
// C1 a lantern crafted (iron ingot -> nuggets in the 2x2, then lantern at a placed table); G1 leaves cut with shears drop the block.
// (decorator-02's header follows) the fern gather, the fern replant, the shears' grass and the compost drive's composting.
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
const SERVER = process.env.SBX || 'sandbox6', PORT = REG.servers[SERVER].port, NAME = 'sbx-Decor3', TAG = 'decorproof'
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
    `setblock ${X + 6} ${G + 1} ${Z + 6} minecraft:spruce_leaves[persistent=false,distance=7]`,
    `kill @e[type=item,x=${X - 25},y=${G - 5},z=${Z - 25},dx=50,dy=20,dz=50]`, 'time set 1000', 'gamerule doDaylightCycle false')
  R.setup = setup.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply)).length ? setup.map(x => x.reply).join('|').slice(0, 300) : 'ok'
  P('setup', R.setup)
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`, `give ${NAME} minecraft:spruce_leaves 4`, `give ${NAME} minecraft:spruce_fence 2`,
      `give ${NAME} minecraft:iron_ingot 1`, `give ${NAME} minecraft:torch 2`, `give ${NAME} minecraft:crafting_table 1`, `give ${NAME} minecraft:shears 1`)
    await sleep(3000)
    await bot.waitForChunksToLoad()
    const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
    bot.pathfinder.setMovements(mv)
    const e = botBuildEffects(bot, { keep: {}, aborted: () => false })
    const click = async (at, item, face = [0, 1, 0]) => { if (!(await e.hold(item))) return 'no_item'; await e.look(at, face); const seq = e.nextSeq(); e.send(at, face, seq); return (await e.waitAck(seq, 2000)) === 'acked' ? 'acked' : 'silent' }
    // L1 leaves on grass, persistent
    R.L1click = await click([X + 2, G, Z], 'spruce_leaves'); await click([X + 3, G, Z], 'spruce_leaves')
    await sleep(800)
    R.L1 = { placed: isBlock(X + 2, G + 1, Z, 'spruce_leaves'), persistent: isBlock(X + 2, G + 1, Z, 'spruce_leaves[persistent=true]') }
    rcon('gamerule randomTickSpeed 300')
    await sleep(15000)
    rcon('gamerule randomTickSpeed 3')
    R.L1.after = { kept: isBlock(X + 2, G + 1, Z, 'spruce_leaves'), wildDecayed: isBlock(X + 6, G + 1, Z + 6, 'air') }
    // F1 + N1 a fence post, a lantern on its top face
    R.F1click = await click([X - 2, G, Z], 'spruce_fence')
    await sleep(700)
    R.F1 = { fence: isBlock(X - 2, G + 1, Z, 'spruce_fence') }
    // C1 lantern: nuggets (2x2) then a table
    try {
      const nug = bot.recipesFor(bot.registry.itemsByName.iron_nugget.id, null, 1, null)?.[0]
      if (nug) await bot.craft(nug, 1, null)
      await sleep(2500)   // the inventory's update after the 2x2 craft (the first run's 'missing ingredient' came 500 ms after it)
      R.C0 = { nuggetsClient: bot.inventory.items().filter(i => i.name === 'iron_nugget').reduce((a, i) => a + i.count, 0), torchesClient: bot.inventory.items().filter(i => i.name === 'torch').reduce((a, i) => a + i.count, 0) }
      await click([X, G, Z - 2], 'crafting_table'); await sleep(800)
      const table = bot.blockAt(new Vec3(X, G + 1, Z - 2))
      const lr = bot.recipesFor(bot.registry.itemsByName.lantern.id, null, 1, table)?.[0]
      if (lr) await bot.craft(lr, 1, table)
      await sleep(800)
    } catch (err) { P('craft', String(err)) }
    R.C1 = { lanterns: countIn('lantern'), nuggets: countIn('iron_nugget') }
    if (countIn('lantern') < 1) rcon(`give ${NAME} minecraft:lantern 1`)
    await sleep(500)
    R.N1click = await click([X - 2, G + 1, Z], 'lantern')
    await sleep(700)
    R.N1 = { lantern: isBlock(X - 2, G + 2, Z, 'lantern'), standing: isBlock(X - 2, G + 2, Z, 'lantern[hanging=false]') }
    // G1 shears on wild leaves (placed persistent=false above): the block itself drops
    if (!isBlock(X + 6, G + 1, Z + 6, 'air')) {
      try { await e.walkTo([X + 5, G + 1, Z + 6]) } catch {}
      const sh = bot.inventory.items().find(i => i.name === 'shears'); if (sh) await bot.equip(sh, 'hand')
      const l0 = countIn('spruce_leaves')
      R.G1dig = await e.dig([X + 6, G + 1, Z + 6], 'spruce_leaves'); await sleep(1200)
      R.G1 = { leaves: [l0, countIn('spruce_leaves')] }
    }
  } finally { try { bot.quit() } catch { /* gone */ } }
  R.pass = { L1: !!R.L1?.persistent && !!R.L1.after?.kept, F1: !!R.F1?.fence, N1: !!R.N1?.standing, C1: R.C1?.lanterns >= 1 }
  const line = JSON.stringify({ at: new Date().toISOString(), server: SERVER, proof: 'decor-03', ...R })
  fs.appendFileSync(path.join(__dirname, 'decor-proof.jsonl'), line + '\n')
  P('RESULT', R.pass)
  console.log(line)
}
main().catch(e => { console.error('FAILED', e); process.exit(1) })
