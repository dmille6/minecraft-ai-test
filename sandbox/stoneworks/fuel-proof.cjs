// SANDBOX-ONLY stoneworks fuel proof (docs/reports/stoneworks-design-2026-11-05.md section 4). Paper 1.21.8 + mineflayer.
// RCON builds a small stone pad, places a furnace and hands the inputs (sandbox only: never a fleet or showcase world); the BOT
// loads the furnace with the same mineflayer calls skills.mjs matsSession uses (openFurnace, putInput, putFuel, takeOutput), and
// each case reads its result back from the SERVER: the furnace's slots via RCON `data get block`, the bag via `clear <bot> <item> 0`.
//   BOT_ROOT=<worktree> node fuel-proof.cjs [server=sandbox3] [port=25601]
// Cases (the ladder's exact batches, mats.mjs fuelBatch): 12 cobblestone on 48 bamboo; 12 on 24 oak_sapling; 8 on 1 coal; 12 on 8
// oak_planks (the base, a positive control). Each must make EXACTLY the batch with the fuel slot EMPTY after, and leave no input.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const ROOT = path.join(process.env.BOT_ROOT || '.', 'bots')
const mineflayer = require(require.resolve('mineflayer', { paths: [ROOT] }))
const { Vec3 } = require(require.resolve('vec3', { paths: [ROOT] }))
const [SERVER = 'sandbox3', PORT = '25601'] = process.argv.slice(2)
const OUT = (process.env.FP_OUT || __dirname) + '/fuel-proof.jsonl'
const NAME = 'sandbox-Mason'
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-sw-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0]?.reply || ''
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const rows = []
const rec = (step, ok, ev = {}) => { const row = { step, ok: !!ok, t: +((Date.now() - T0) / 1000).toFixed(1), ...ev }; rows.push(row); P(ok ? 'PASS' : 'FAIL', step, ev) }
// the server's count of an item in the bot's bag: `clear <p> <item> 0` reports "Found N matching item(s)" without removing
const serverCount = item => { const m = /Found (\d+)/.exec(r1(`clear ${NAME} minecraft:${item} 0`)); return m ? Number(m[1]) : 0 }
const F = { x: 2600, y: 100, z: 2600 }
const furnaceSlots = () => r1(`data get block ${F.x} ${F.y} ${F.z} Items`)
async function main () {
  const r = rcon(`forceload add 2590 2590 2610 2610`, 'difficulty peaceful',
    `fill 2590 99 2590 2610 99 2610 minecraft:stone`, `fill 2590 100 2590 2610 106 2610 minecraft:air`,
    `setblock ${F.x} ${F.y} ${F.z} minecraft:furnace[facing=south]`, 'gamerule doDaylightCycle false', 'time set 6000')
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + JSON.stringify(bad))
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(PORT), username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${F.x} ${F.y} ${F.z + 2}`)
  await sleep(3000)
  for (let i = 0; i < 30 && bot.blockAt(new Vec3(F.x, F.y, F.z))?.name !== 'furnace'; i++) await sleep(1000)
  if (bot.blockAt(new Vec3(F.x, F.y, F.z))?.name !== 'furnace') throw new Error('the furnace is not in view: ' + JSON.stringify(bot.entity.position))
  const cases = [
    { name: 'bamboo', fuel: 'bamboo', fuelN: 48, n: 12 },
    { name: 'sapling', fuel: 'oak_sapling', fuelN: 24, n: 12 },
    { name: 'coal', fuel: 'coal', fuelN: 1, n: 8 },
    { name: 'planks_control', fuel: 'oak_planks', fuelN: 8, n: 12 },
  ]
  for (const c of cases) {
    rcon(`clear ${NAME}`, `data merge block ${F.x} ${F.y} ${F.z} {Items:[]}`, `give ${NAME} cobblestone ${c.n}`, `give ${NAME} ${c.fuel} ${c.fuelN + 4}`)
    await sleep(1500)
    const block = bot.blockAt(new Vec3(F.x, F.y, F.z))
    const fur = await bot.openFurnace(block)
    await fur.putInput(bot.registry.itemsByName.cobblestone.id, null, c.n)
    await fur.putFuel(bot.registry.itemsByName[c.fuel].id, null, c.fuelN)
    const t0 = Date.now()
    while (Date.now() - t0 < c.n * 10_000 + 15_000) {
      const o = fur.outputItem()
      if ((o?.count ?? 0) >= c.n && !fur.inputItem()) break
      await sleep(1000)
    }
    // read the furnace on the SERVER before taking anything: input, fuel, output
    const before = furnaceSlots()
    const o = fur.outputItem()
    if (o) { try { await fur.takeOutput() } catch {} }
    const fuelLeftClient = fur.fuelItem()?.count ?? 0
    fur.close()
    await sleep(1500)
    const stone = serverCount('stone'), cobble = serverCount('cobblestone'), fuelBag = serverCount(c.fuel)
    const after = furnaceSlots()
    const ok = stone === c.n && cobble === 0 && fuelBag === 4 && !/Slot: 1b/.test(after) && !/Slot: 0b/.test(after)
    rec(c.name, ok, { want: c.n, stone, cobble, fuel_in_bag: fuelBag, fuel_left_client: fuelLeftClient, secs: Math.round((Date.now() - t0) / 1000), furnace_before_take: before.slice(0, 300), furnace_after: after.slice(0, 200) })
  }
  // and the brick craft the bricks kind relies on (2x2, no table): 12 stone -> 12 stone_bricks, server-counted
  rcon(`clear ${NAME}`, `give ${NAME} stone 12`); await sleep(1500)
  const rec2 = bot.recipesFor(bot.registry.itemsByName.stone_bricks.id, null, 1, null)[0]
  if (rec2) { try { await bot.craft(rec2, 3, null) } catch (e) { P('craft', e.message) } }
  await sleep(1500)
  rec('bricks_2x2', serverCount('stone_bricks') === 12 && serverCount('stone') === 0, { bricks: serverCount('stone_bricks'), stone: serverCount('stone') })
  bot.quit()
  rcon(`setblock ${F.x} ${F.y} ${F.z} minecraft:air`, 'forceload remove 2590 2590 2610 2610', `clear ${NAME}`)
  fs.writeFileSync(OUT, rows.map(x => JSON.stringify(x)).join('\n') + '\n')
  P('done', rows.filter(x => x.ok).length, 'of', rows.length)
  process.exit(rows.every(x => x.ok) ? 0 : 1)
}
main().catch(e => { P('ERROR', e.message); process.exit(2) })
