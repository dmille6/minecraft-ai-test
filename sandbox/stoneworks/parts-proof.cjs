// SANDBOX-ONLY stoneworks-02/03 parts proof (docs/reports/stoneworks-design-2026-11-05.md section 8). Paper 1.21.8 + mineflayer.
// RCON hands the inputs and places the stations (sandbox only); the BOT crafts and cuts with mineflayer calls a skill can make,
// and every count is read back from the SERVER (`clear <bot> <item> 0`).
//   BOT_ROOT=<worktree> node parts-proof.cjs [server=sandbox3] [port=25601]
// Cases: (1) 16 cobbled_deepslate -> 16 polished_deepslate -> 16 deepslate_bricks, 2x2 in the bag (no table);
// (2) a stonecutter crafted at a table from 1 iron_ingot + 3 stone; (3) the stonecutter window: input in slot 0, the recipe chosen
// by the enchant_item button (index PROBED by reading the result slot), the result taken -- stone_bricks -> stone_brick_stairs 1:1,
// -> stone_brick_slab 1:2, -> stone_brick_wall 1:1, deepslate_bricks -> deepslate_brick_stairs; (4) the table recipes for the same
// parts (6 -> 4 stairs, 3 -> 6 slabs, 6 -> 6 walls) as the control.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const ROOT = path.join(process.env.BOT_ROOT || '.', 'bots')
const mineflayer = require(require.resolve('mineflayer', { paths: [ROOT] }))
const { Vec3 } = require(require.resolve('vec3', { paths: [ROOT] }))
const [SERVER = 'sandbox3', PORT = '25601'] = process.argv.slice(2)
const OUT = (process.env.FP_OUT || __dirname) + '/parts-proof.jsonl'
const NAME = 'sandbox-Cutter'
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
const sc = item => { const m = /Found (\d+)/.exec(r1(`clear ${NAME} minecraft:${item} 0`)); return m ? Number(m[1]) : 0 }
const TABLE = { x: 2602, y: 100, z: 2600 }, CUT = { x: 2598, y: 100, z: 2600 }
async function craftN (bot, item, times, table = null) {
  const id = bot.registry.itemsByName[item].id
  const r = bot.recipesFor(id, null, 1, table)[0]
  if (!r) throw new Error('no recipe for ' + item)
  await bot.craft(r, times, table)
}
async function main () {
  const r = rcon(`forceload add 2590 2590 2610 2610`, 'difficulty peaceful', `fill 2590 99 2590 2610 99 2610 minecraft:stone`, `fill 2590 100 2590 2610 106 2610 minecraft:air`,
    `setblock ${TABLE.x} ${TABLE.y} ${TABLE.z} minecraft:crafting_table`, 'gamerule doDaylightCycle false', 'time set 6000')
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + JSON.stringify(bad))
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: Number(PORT), username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} 2600 100 2602`)
  for (let i = 0; i < 30 && bot.blockAt(new Vec3(TABLE.x, TABLE.y, TABLE.z))?.name !== 'crafting_table'; i++) await sleep(1000)
  // (1) deepslate chain, 2x2 in the bag
  rcon(`clear ${NAME}`, `give ${NAME} cobbled_deepslate 16`); await sleep(1500)
  try { await craftN(bot, 'polished_deepslate', 4); await sleep(800); await craftN(bot, 'deepslate_bricks', 4) } catch (e) { P('craft', e.message) }
  await sleep(1500)
  rec('deepslate_chain_2x2', sc('deepslate_bricks') === 16 && sc('cobbled_deepslate') === 0 && sc('polished_deepslate') === 0, { bricks: sc('deepslate_bricks'), cobbled: sc('cobbled_deepslate'), polished: sc('polished_deepslate') })
  // (2) the stonecutter at the table
  rcon(`clear ${NAME}`, `give ${NAME} iron_ingot 1`, `give ${NAME} stone 3`); await sleep(1500)
  const table = bot.blockAt(new Vec3(TABLE.x, TABLE.y, TABLE.z))
  try { await craftN(bot, 'stonecutter', 1, table) } catch (e) { P('stonecutter craft', e.message) }
  await sleep(1500)
  rec('stonecutter_craft', sc('stonecutter') === 1 && sc('iron_ingot') === 0 && sc('stone') === 0, { stonecutter: sc('stonecutter') })
  // place it with the bot (its own placement, as a build visit would)
  try {
    const it = bot.inventory.items().find(i => i.name === 'stonecutter')
    await bot.equip(it, 'hand')
    await bot.placeBlock(bot.blockAt(new Vec3(CUT.x, CUT.y - 1, CUT.z)), new Vec3(0, 1, 0))
  } catch (e) { P('place', e.message) }
  await sleep(1500)
  rec('stonecutter_place', /passed/.test(r1(`execute if block ${CUT.x} ${CUT.y} ${CUT.z} minecraft:stonecutter`)), {})
  // (3) the cutter window, the recipe index probed by its result
  async function cut (input, n, want) {
    rcon(`clear ${NAME}`, `give ${NAME} ${input} ${n}`); await sleep(1500)
    const block = bot.blockAt(new Vec3(CUT.x, CUT.y, CUT.z))
    const win = await bot.openBlock(block)
    const src = win.slots.findIndex((s, i) => i >= 2 && s?.name === input)
    await bot.clickWindow(src, 0, 0); await bot.clickWindow(0, 0, 0)          // the whole stack onto the input slot
    await sleep(500)
    let idx = -1; const seen = []
    for (let b = 0; b < 24 && idx < 0; b++) {
      bot._client.write('enchant_item', { windowId: win.id, enchantment: b })
      await sleep(350)
      const o = win.slots[1]
      seen.push(`${b}:${o?.name ?? '-'}x${o?.count ?? 0}`)
      if (o?.name === want) idx = b
    }
    if (idx >= 0) { await bot.clickWindow(1, 0, 1); await sleep(800) }      // shift-click: cut everything the input allows
    win.close(); await sleep(1500)
    return { idx, seen: seen.slice(0, 24).join(' '), made: sc(want), left: sc(input) }
  }
  for (const [input, n, want, per] of [['stone_bricks', 8, 'stone_brick_stairs', 1], ['stone_bricks', 8, 'stone_brick_slab', 2], ['stone_bricks', 8, 'stone_brick_wall', 1], ['deepslate_bricks', 8, 'deepslate_brick_stairs', 1], ['stone', 8, 'stone_bricks', 1]]) {
    let x
    try { x = await cut(input, n, want) } catch (e) { x = { err: e.message } }
    rec(`cut_${input}_${want}`, x.idx >= 0 && x.made === n * per && x.left === 0, x)
  }
  // (4) the table control
  for (const [item, input, n, times, want] of [['stone_brick_stairs', 'stone_bricks', 6, 1, 4], ['stone_brick_slab', 'stone_bricks', 3, 1, 6], ['stone_brick_wall', 'stone_bricks', 6, 1, 6]]) {
    rcon(`clear ${NAME}`, `give ${NAME} ${input} ${n}`); await sleep(1500)
    try { await craftN(bot, item, times, bot.blockAt(new Vec3(TABLE.x, TABLE.y, TABLE.z))) } catch (e) { P('table', e.message) }
    await sleep(1500)
    rec(`table_${item}`, sc(item) === want && sc(input) === 0, { made: sc(item), left: sc(input) })
  }
  bot.quit()
  rcon(`setblock ${CUT.x} ${CUT.y} ${CUT.z} minecraft:air`, `setblock ${TABLE.x} ${TABLE.y} ${TABLE.z} minecraft:air`, 'forceload remove 2590 2590 2610 2610', `clear ${NAME}`)
  fs.writeFileSync(OUT, rows.map(x => JSON.stringify(x)).join('\n') + '\n')
  P('done', rows.filter(x => x.ok).length, 'of', rows.length)
  process.exit(rows.every(x => x.ok) ? 0 : 1)
}
main().catch(e => { P('ERROR', e.message); process.exit(2) })
