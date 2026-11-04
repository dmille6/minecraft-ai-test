// SANDBOX-ONLY: obsidian from water + lava with a bucket, mined with a diamond pickaxe, and the enchanting workshop's 15-shelf ring
// (enchantshop-01 / obsidian-01, owner 11-04 E2 "obsidian on showcase only for now": Paper sandbox proof first).
//   BOT_ROOT=<checkout with bots/node_modules> node sandbox/enchant/obsidian-proof.cjs
//   (take the lock first: sandbox/sbxlock.sh take sandbox3 obsidianproof "...", release after). SBX=<name> picks another sandbox.
// THE BOT'S OWN CODE drives the bucket (bots/src/bucket.mjs pourLiquid / scoopLiquid, the `bucket` skill's primitives).
//   O1 pour INTO the air cell ABOVE a lava source: the lava source becomes obsidian (server-verified), the water source stays above
//   O2 scoop that water back (scoopLiquid): the bucket is full again, the cell air
//   O3 pour into the air cell BESIDE a lava source at its level: obsidian? (the second geometry)
//   O4 mine the obsidian with a diamond pickaxe (bot.dig): the time, the block gone, the obsidian in the SERVER's inventory record
//   O5 a FLOWING lava cell (not a source) under the poured water: cobblestone/stone, not obsidian (the trap the piece must avoid)
//   E1 the workshop's ring: the table at the centre, 15 bookshelves PLACED BY THE BOT on the 5 x 5 ring less its front middle, the
//      3 x 3 between air: the table's third offer is level 30 (with an item and lapis in it)
//   E2 a torch in the gap in front of 5 shelves: the offer falls (the gap rule)
// Setup in the sandbox only (the owner's no-admin-edit rule is for the bots' worlds): forceload, fill, setblock, give, tp, xp.
'use strict'
const { execFileSync } = require('child_process')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const REG = require('../sandboxes.json')
const SERVER = process.env.SBX || 'sandbox3', PORT = REG.servers[SERVER].port, NAME = 'sbx-Obsid', TAG = 'obsidianproof'
const SSH = ['-o', 'BatchMode=yes', 'mike@' + REG.host]
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0].reply
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const X = 3700, Y = 140, Z = 3700
const R = {}
const isBlock = (x, y, z, name) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${name}`))
const countIn = name => +(r1(`clear ${NAME} minecraft:${name} 0`).match(/Found (\d+)/)?.[1] ?? 0)

async function main () {
  requireSandboxLock(SERVER, TAG)
  const bucket = await import(path.resolve(BOT_ROOT, 'bots/src/bucket.mjs'))
  rcon(`forceload add ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`,
    `fill ${X - 8} ${Y - 2} ${Z - 8} ${X + 8} ${Y + 5} ${Z + 8} minecraft:air`,
    `fill ${X - 8} ${Y - 2} ${Z - 8} ${X + 8} ${Y} ${Z + 8} minecraft:stone`,
    `fill ${X - 8} ${Y + 1} ${Z - 8} ${X + 8} ${Y + 3} ${Z - 8} minecraft:glass`, `fill ${X - 8} ${Y + 1} ${Z + 8} ${X + 8} ${Y + 3} ${Z + 8} minecraft:glass`,
    `fill ${X - 8} ${Y + 1} ${Z - 8} ${X - 8} ${Y + 3} ${Z + 8} minecraft:glass`, `fill ${X + 8} ${Y + 1} ${Z - 8} ${X + 8} ${Y + 3} ${Z + 8} minecraft:glass`,
    // O1: a lava SOURCE in a 1x1 pit at the floor level (X+2, Y, Z); O3: one at (X+2, Y, Z+3) with an air cell beside it at (X+3, Y, Z+3)
    `setblock ${X + 2} ${Y} ${Z} minecraft:lava`,
    `setblock ${X + 2} ${Y} ${Z + 3} minecraft:lava`, `setblock ${X + 3} ${Y} ${Z + 3} minecraft:air`,
    `kill @e[type=item,x=${X - 10},y=${Y - 5},z=${Z - 10},dx=20,dy=20,dz=20]`, 'time set 1000')
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('spawned', bot.version)
  // FOUND 11-04 (this proof's first run): bucket.mjs scoopAims / emptyAims return PLAIN {x, y, z} objects and mineflayer 4.37's
  // bot.lookAt calls point.minus() -> every pour and scoop throws `point.minus is not a function` before any packet. The fix (a
  // Vec3 aim) is protected scope (bucket.mjs): obsidian-01 carries it. Here the aim is wrapped so the SERVER's behaviour is what is
  // measured (R.lookAtWrapped records it).
  const look0 = bot.lookAt.bind(bot)
  bot.lookAt = (p, f) => look0(p instanceof Vec3 ? p : new Vec3(p.x, p.y, p.z), f)
  R.lookAtWrapped = !process.env.NO_WRAP
  if (process.env.NO_WRAP) bot.lookAt = look0
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `xp set ${NAME} 0 points`, `xp set ${NAME} 30 levels`,
      `tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 0.5}`, `give ${NAME} minecraft:water_bucket 1`, `give ${NAME} minecraft:bucket 1`,
      `give ${NAME} minecraft:diamond_pickaxe 1`)
    await sleep(2500)
    // ---- O6 (first, before any water is out): a CONTAINED cast -- the lava source 1 below a 1x1 hole in the floor; pour into the hole
    // (stone on its four sides), scoop it back, mine the obsidian DRY from the floor beside it
    const HX = X - 5, HZ = Z - 5
    rcon(`setblock ${HX} ${Y - 1} ${HZ} minecraft:lava`, `setblock ${HX} ${Y} ${HZ} minecraft:air`, `tp ${NAME} ${HX - 1.5} ${Y + 1} ${HZ + 0.5}`)
    await sleep(1800)
    const hole = new Vec3(HX, Y, HZ)
    const p6 = await bucket.pourLiquid(bot, hole)
    await sleep(1500)
    R.o6 = { pour: p6, obsidian: isBlock(HX, Y - 1, HZ, 'obsidian'), waterInHole: isBlock(HX, Y, HZ, 'water'), waterSpread: isBlock(HX - 1, Y + 1, HZ, 'water') }
    const s6 = await bucket.scoopLiquid(bot, hole)
    await sleep(800)
    R.o6.scoop = s6; R.o6.holeAir = isBlock(HX, Y, HZ, 'air'); R.o6.waterBuckets = countIn('water_bucket')
    const ob6 = bot.blockAt(new Vec3(HX, Y - 1, HZ))
    if (ob6?.name === 'obsidian') {
      await bot.equip(bot.inventory.items().find(i => i.name === 'diamond_pickaxe'), 'hand')
      R.o6.digTimeMs = bot.digTime(ob6)
      const t = Date.now()
      try { await bot.dig(ob6, true); R.o6.dug = Date.now() - t } catch (e) { R.o6.dug = 'threw ' + e.message }
      await sleep(1200)
      R.o6.gone = isBlock(HX, Y - 1, HZ, 'air')
      R.o6.itemEntities = r1(`execute if entity @e[type=item,x=${HX - 1},y=${Y - 3},z=${HZ - 1},dx=2,dy=3,dz=2]`)
      R.o6.inBagBefore = countIn('obsidian')
      // the drop rests 2 below the floor: the bot steps into the hole for it (then its own scaffold would climb out)
      try { await bot.lookAt(new Vec3(HX + 0.5, Y, HZ + 0.5)); bot.setControlState('forward', true); await sleep(600); bot.setControlState('forward', false) } catch {}
      await sleep(2000)
      R.o6.inBagAfterStep = countIn('obsidian')
      R.o6.feetY = bot.entity.position.y
    }
    P('O6', R.o6)
    rcon(`tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 0.5}`, `clear ${NAME} minecraft:obsidian`, `give ${NAME} minecraft:water_bucket 1`)
    await sleep(1500)
    R.lavaSource0 = isBlock(X + 2, Y, Z, 'lava')
    // ---- O1: pour into the cell above the lava source ----
    const above = new Vec3(X + 2, Y + 1, Z)
    const p1 = await bucket.pourLiquid(bot, above)
    await sleep(1500)
    R.o1 = { pour: p1, obsidian: isBlock(X + 2, Y, Z, 'obsidian'), waterAbove: isBlock(X + 2, Y + 1, Z, 'water') }
    P('O1', R.o1)
    // ---- O2: scoop it back ----
    const s2 = await bucket.scoopLiquid(bot, above)
    await sleep(800)
    R.o2 = { scoop: s2, air: isBlock(X + 2, Y + 1, Z, 'air'), waterBuckets: countIn('water_bucket') }
    P('O2', R.o2)
    // ---- O3: pour beside a lava source at its level ----
    rcon(`tp ${NAME} ${X + 4.5} ${Y + 1} ${Z + 3.5}`)
    await sleep(1500)
    const beside = new Vec3(X + 3, Y, Z + 3)
    const p3 = await bucket.pourLiquid(bot, beside)
    await sleep(1500)
    R.o3 = { pour: p3, obsidian: isBlock(X + 2, Y, Z + 3, 'obsidian'), lava: isBlock(X + 2, Y, Z + 3, 'lava'), at: r1(`execute if block ${X + 2} ${Y} ${Z + 3} minecraft:cobblestone`) }
    P('O3', R.o3)
    try { const s3 = await bucket.scoopLiquid(bot, beside); R.o3.scoop = s3 } catch (e) { R.o3.scoop = 'threw ' + e.message }
    // ---- O4: mine the O1 obsidian with the diamond pickaxe ----
    rcon(`tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 0.5}`)
    await sleep(1500)
    const ob = bot.blockAt(new Vec3(X + 2, Y, Z))
    R.o4 = { client: ob?.name }
    if (ob?.name === 'obsidian') {
      const pick = bot.inventory.items().find(i => i.name === 'diamond_pickaxe')
      await bot.equip(pick, 'hand')
      R.o4.digTimeMs = bot.digTime(ob)
      const t = Date.now()
      try { await bot.dig(ob, true); R.o4.dug = Date.now() - t } catch (e) { R.o4.dug = 'threw ' + e.message }
      await sleep(1500)
      // the drop falls into the pit cell: step over it to pick it up
      try { await bot.lookAt(new Vec3(X + 2.5, Y, Z + 0.5)); bot.setControlState('forward', true); await sleep(700); bot.setControlState('forward', false) } catch {}
      await sleep(1500)
      R.o4.gone = isBlock(X + 2, Y, Z, 'air')
      R.o4.obsidianInBag = countIn('obsidian')
    }
    P('O4', R.o4)
    // ---- O5: water onto FLOWING lava -> not obsidian ----
    rcon(`setblock ${X - 3} ${Y} ${Z} minecraft:lava[level=2]`, `tp ${NAME} ${X - 1.5} ${Y + 1} ${Z + 0.5}`)
    await sleep(1500)
    const p5 = await bucket.pourLiquid(bot, new Vec3(X - 3, Y + 1, Z))
    await sleep(1500)
    R.o5 = { pour: p5, obsidian: isBlock(X - 3, Y, Z, 'obsidian'), cobble: isBlock(X - 3, Y, Z, 'cobblestone'), stone: isBlock(X - 3, Y, Z, 'stone') }
    P('O5', R.o5)
    try { await bucket.scoopLiquid(bot, new Vec3(X - 3, Y + 1, Z)) } catch {}

    // ---- E1: the workshop's ring, placed by the bot ----
    const TX = X, TZ = Z - 4
    rcon(`fill ${X - 7} ${Y + 1} ${Z - 7} ${X + 7} ${Y + 4} ${Z - 1} minecraft:air`, `setblock ${TX} ${Y + 1} ${TZ} minecraft:enchanting_table`,
      `give ${NAME} minecraft:bookshelf 15`, `give ${NAME} minecraft:lapis_lazuli 9`, `give ${NAME} minecraft:iron_pickaxe 2`,
      `tp ${NAME} ${TX + 0.5} ${Y + 1} ${TZ + 2.5}`)
    await sleep(2000)
    const ring = []
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if ((Math.abs(dx) === 2 || Math.abs(dz) === 2) && !(dx === 0 && dz === 2)) ring.push([TX + dx, TZ + dz])
    let placed = 0
    for (const [x, z] of ring) {
      const it = bot.inventory.items().find(i => i.name === 'bookshelf')
      if (!it) break
      // stand just outside the ring cell (a sandbox tp: the geometry is what is proved here, not the walk)
      const ox = x - TX === 2 ? 1 : x - TX === -2 ? -1 : 0, oz = z - TZ === 2 ? 1 : z - TZ === -2 ? -1 : 0
      rcon(`tp ${NAME} ${x + ox + 0.5} ${Y + 1} ${z + oz + 0.5}`)
      await sleep(700)
      await bot.equip(it, 'hand')
      const below = bot.blockAt(new Vec3(x, Y, z))
      try { await bot.placeBlock(below, new Vec3(0, 1, 0)) } catch (e) { /* read back below */ }
      await sleep(300)
      if (isBlock(x, Y + 1, z, 'bookshelf')) placed++
    }
    R.e1 = { ring: ring.length, placed }
    rcon(`tp ${NAME} ${TX + 0.5} ${Y + 1} ${TZ + 2.5}`)
    await sleep(1000)
    const offers = async () => {
      const table = await bot.openEnchantmentTable(bot.blockAt(new Vec3(TX, Y + 1, TZ)))
      const pick = table.items().find(i => i.name === 'iron_pickaxe')
      await table.putTargetItem(pick)
      const lap = table.items().find(i => i.name === 'lapis_lazuli')
      if (lap) await table.putLapis(lap)
      const t = Date.now(); while (Date.now() - t < 5000 && !table.enchantments.some(e => e.level > 0)) await sleep(100)
      await sleep(900)
      const lv = table.enchantments.map(e => e.level)
      try { await table.takeTargetItem() } catch {}
      try { bot.closeWindow(table) } catch {}
      await sleep(500)
      return lv
    }
    R.e1.offers = await offers()
    P('E1', R.e1)
    // ---- E2: a torch in the gap in front of the back row ----
    rcon(`setblock ${TX} ${Y + 1} ${TZ - 1} minecraft:torch`)
    await sleep(800)
    R.e2 = { offers: await offers() }
    P('E2', R.e2)
  } finally {
    bot.quit(); await sleep(500)
    rcon(`kill @e[type=item,x=${X - 10},y=${Y - 5},z=${Z - 10},dx=20,dy=20,dz=20]`,
      `fill ${X - 8} ${Y - 2} ${Z - 8} ${X + 8} ${Y + 5} ${Z + 8} minecraft:air`,
      `forceload remove ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`)
  }
  console.log('RESULT ' + JSON.stringify(R))
}
main().catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
