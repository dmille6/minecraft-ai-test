// SANDBOX-ONLY (sandbox3) E2E for anvilapply-01 + enchant-01: the REAL code path -- skills.mjs enchantAsk (enchant.mjs
// anvilAskPlan / tableAskPlan) -> SKILLS.anvil_apply.run / SKILLS.enchant_tool.run (goto + the hand-driven windows) -- on
// Paper 1.21.8, every result read back from the SERVER (xp query, data get entity ... components).
//   node sandbox/trading/enchant-e2e.mjs     (from a worktree root with bots/node_modules; take the lock first:
//   sandbox/sbxlock.sh take sandbox3 anvilproof "...", release after)
// Setup by RCON (sandbox only; the owner's no-admin-edit rule is for the bots' worlds): a walled platform, an anvil and an
// enchanting table 6 blocks from the bot's start (it walks), the bag (2 pickaxes, an axe, a Mending book, an Unbreaking III
// book, lapis), 12 levels.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const X = 3600, Y = 140, Z = 3600, F = Y + 1
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxenchant',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'enlog-')), POOL_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'enpool-')),
  HOME_X: String(X), HOME_Y: String(F), HOME_Z: String(Z), WORLD_BORDER_RADIUS: '6000', BOT_NAME: 'sbx-Enchant', LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
})
const BOTS = path.resolve('bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const lock = req(path.resolve('sandbox/lib/sbxlock.cjs'))
const SK = await import(path.join(BOTS, 'src/skills.mjs'))
const EN = await import(path.join(BOTS, 'src/enchant.mjs'))
const CS = await import(path.join(BOTS, 'src/craftsync.mjs'))
const { tapRecords } = await import(path.join(BOTS, 'src/logger.mjs'))
const SERVER = process.env.SBX || 'sandbox3', REG = req(path.resolve('sandbox/sandboxes.json')), PORT = REG.servers[SERVER].port, NAME = 'sbx-Enchant'
const rcon = (...cmds) => execFileSync('ssh', ['-o', 'BatchMode=yes', `mike@${REG.host}`, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
const r1 = c => rcon(c).split('\n').slice(1).join(' ').trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const R = {}
const level = () => +(r1(`xp query ${NAME} levels`).match(/has (\d+) experience levels/)?.[1] ?? NaN)
const countIn = n => +(r1(`clear ${NAME} minecraft:${n} 0`).match(/Found (\d+)/)?.[1] ?? 0)
/** The server's enchantments on each inventory entry that has any: ["<id> <components>"]. */
const serverEnchants = () => Array.from({ length: 16 }, (_, i) => i).map(i => {
  const id = r1(`data get entity ${NAME} Inventory[${i}].id`).replace(/^.*entity data: /, '')
  const e = r1(`data get entity ${NAME} Inventory[${i}].components."minecraft:enchantments"`)
  return /entity data/.test(e) ? `${id} ${e.replace(/^.*entity data: /, '')}` : null
}).filter(Boolean)

async function main () {
  lock.requireSandboxLock(SERVER, 'anvilproof')
  const recs = []; tapRecords(r => { if (/anvil_apply|enchant_tool|withdraw/.test(r.skill?.name ?? '')) recs.push(`${r.skill.name} ${r.skill.status} ${r.skill.detail}`) })
  rcon(`forceload add ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`,
    `fill ${X - 8} ${Y} ${Z - 8} ${X + 8} ${Y + 5} ${Z + 8} minecraft:air`,
    `fill ${X - 8} ${Y} ${Z - 8} ${X + 8} ${Y} ${Z + 8} minecraft:stone`,
    `fill ${X - 8} ${F} ${Z - 8} ${X + 8} ${F + 2} ${Z - 8} minecraft:glass`, `fill ${X - 8} ${F} ${Z + 8} ${X + 8} ${F + 2} ${Z + 8} minecraft:glass`,
    `fill ${X - 8} ${F} ${Z - 8} ${X - 8} ${F + 2} ${Z + 8} minecraft:glass`, `fill ${X + 8} ${F} ${Z - 8} ${X + 8} ${F + 2} ${Z + 8} minecraft:glass`,
    `setblock ${X + 6} ${F} ${Z} minecraft:anvil`, `setblock ${X - 6} ${F} ${Z} minecraft:enchanting_table`,
    `kill @e[type=item,x=${X - 10},y=${Y - 5},z=${Z - 10},dx=20,dy=20,dz=20]`, 'time set 1000')
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  // as index.mjs does on every real bot: craftsync owns the server recount withdraw needs, and it sees every window click
  CS.installCraftSync(bot, { log: () => {} })
  const ac = new AbortController()
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `xp set ${NAME} 0 points`, `xp set ${NAME} 12 levels`, `tp ${NAME} ${X + 0.5} ${F} ${Z + 4.5}`,
      `give ${NAME} minecraft:iron_pickaxe 1`, `give ${NAME} minecraft:stone_pickaxe 1`, `give ${NAME} minecraft:stone_axe 1`, `give ${NAME} minecraft:lapis_lazuli 6`,
      `give ${NAME} minecraft:enchanted_book[minecraft:stored_enchantments={"minecraft:unbreaking":3}] 1`,
      `give ${NAME} minecraft:enchanted_book[minecraft:stored_enchantments={"minecraft:mending":1}] 1`)
    await sleep(4000)
    let now = Date.now()
    const step = async (label) => {
      const lv0 = level(), books0 = countIn('enchanted_book'), lap0 = countIn('lapis_lazuli')
      const ask = SK.enchantAsk({ now }, bot)
      const out = { ask: ask?.order ?? null, level0: lv0 }
      if (ask?.order) {
        const t = Date.now()
        out.run = await SK.SKILLS[ask.order.skill].run({ bot }, ask.order.args, ac.signal)
        out.ms = Date.now() - t
      }
      await sleep(800)
      Object.assign(out, { level1: level(), books: `${books0}->${countIn('enchanted_book')}`, lapis: `${lap0}->${countIn('lapis_lazuli')}`, server: serverEnchants(), botAt: bot.entity.position.floored().toString() })
      R[label] = out
      P(label, out)
      now += EN.ASK_EVERY_MS + 1
      return out
    }
    await step('s1_anvil_mending')      // Mending onto the best pickaxe (iron), 2 levels
    await step('s2_anvil_unbreaking')   // Unbreaking III onto the same pickaxe (prior work 1): 4 levels
    await step('s3_table_xp_short')     // 6 levels < TABLE_MIN_LEVEL: no ask (anvil has no book left)
    rcon(`xp set ${NAME} 10 levels`); await sleep(800)
    await step('s4_table')              // the best UNENCHANTED tool (stone pickaxe), the best offer the levels pay
    await step('s5_nothing_left')       // levels 7..9, no book: no order
    // s6: THE TOWN BOOK (the ask's town branch reads the town index, absent here: the skill is run with the order the ask
    // would issue, args { town: 1 }): a chest by the start holds an Efficiency II book; withdraw -> plan -> anvil
    rcon(`setblock ${X} ${F} ${Z + 6} minecraft:chest`, `item replace block ${X} ${F} ${Z + 6} container.0 with minecraft:enchanted_book[minecraft:stored_enchantments={"minecraft:efficiency":2}] 1`)
    await sleep(1000)
    {
      const lv0 = level()
      const run = await SK.SKILLS.anvil_apply.run({ bot }, { town: 1 }, ac.signal)
      await sleep(800)
      R.s6_town_book = { run, level0: lv0, level1: level(), chestBook: r1(`data get block ${X} ${F} ${Z + 6} Items`).slice(0, 120), books: countIn('enchanted_book'), server: serverEnchants() }
      P('s6_town_book', R.s6_town_book)
    }
    R.records = recs
  } finally {
    bot.quit(); await sleep(500)
    rcon(`kill @e[type=item,x=${X - 10},y=${Y - 5},z=${Z - 10},dx=20,dy=20,dz=20]`,
      `fill ${X - 8} ${Y} ${Z - 8} ${X + 8} ${Y + 5} ${Z + 8} minecraft:air`, `forceload remove ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`)
    console.log('RESULT ' + JSON.stringify(R))
  }
}
main().then(() => process.exit(0)).catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
