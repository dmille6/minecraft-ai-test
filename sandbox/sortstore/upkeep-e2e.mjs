// SANDBOX-ONLY (sandbox3): the sorted storehouse's OWN CODE on Paper 1.21.8 (skills.mjs sortstore-01 -- the label, the sign craft, the
// tidy move, the sorted town deposit), driven in-process on a real mineflayer bot with the pathfinder. RCON builds the arena and
// gives the starting items (sandbox only); the server is the oracle (`data get block`). Run from the worktree root:
//   node sandbox/sortstore/upkeep-e2e.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const X = 3000, Y = 120, Z = 3000
Object.assign(process.env, {
  OLLAMA_MODEL: 'none', OLLAMA_BASE_URL: 'http://127.0.0.1:1', MEMORY_SCOPE: 'board', MEMORY_POOL: 'sbxsort', SORTSTORE: 'on',
  LOG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sortlog-')), POOL_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sortpool-')),
  HOME_X: String(X), HOME_Y: String(Y + 1), HOME_Z: String(Z), BOT_NAME: 'sbx-Sort', LOG_LEVEL: 'error', BOT_ROLE: 'gatherer',
})
const BOTS = path.resolve('bots')
const { createRequire } = await import('node:module')
const req = createRequire(path.join(BOTS, 'package.json'))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const SK = await import(path.join(BOTS, 'src/skills.mjs'))
const S = await import(path.join(BOTS, 'src/sortstore.mjs'))
const NAME = 'sbx-Sort', SERVER = 'sandbox3', PORT = 25601
const rcon = (...cmds) => {
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const R = {}
// the room: floor y=Y, a 9x7 stone-brick box (walls 3 high) round x X-4..X+4, z Z-3..Z+3; chests on the north wall row (z Z-2)
const A = [X - 2, Y + 1, Z - 2], B = [X + 2, Y + 1, Z - 2], C = [X, Y + 1, Z - 2]   // stone home, wood home, overflow
const plan = { mode: 'greenfield', groups: { v: 1, status: 'greenfield', homes: {} }, plots: [{ id: 'store', kind: 'storehouse', cells: [
  { at: A, kind: 'chest', stand: [A[0], Y + 1, Z], role: 'home', group: 'stone', state: 'placed' },
  { at: B, kind: 'chest', stand: [B[0], Y + 1, Z], role: 'home', group: 'wood', state: 'placed' },
  { at: C, kind: 'chest', stand: [C[0], Y + 1, Z], role: 'overflow', group: null, state: 'placed' }] }] }
const rec = { blueprint: 'storehouse@1', structure_complete: true, box: [X - 5, Z - 4, X + 5, Z + 4], cells: [] }
for (let x = X - 4; x <= X + 4; x++) for (const y of [Y + 1, Y + 2, Y + 3]) rec.cells.push({ at: [x, y, Z - 3], role: 'upper' })
const items = k => rcon(`data get block ${k[0]} ${k[1]} ${k[2]} Items`)[0].reply
async function main () {
  rcon(`forceload add ${X - 8} ${Z - 8} ${X + 8} ${Z + 8}`, `fill ${X - 6} ${Y} ${Z - 6} ${X + 6} ${Y + 6} ${Z + 6} minecraft:air`,
    `fill ${X - 5} ${Y} ${Z - 4} ${X + 5} ${Y} ${Z + 4} minecraft:stone`, `fill ${X - 4} ${Y + 1} ${Z - 3} ${X + 4} ${Y + 3} ${Z - 3} minecraft:stone_bricks`,
    ...[A, B, C].map(k => `setblock ${k[0]} ${k[1]} ${k[2]} minecraft:chest[facing=south]`),
    `setblock ${C[0]} ${C[1] + 1} ${C[2]} minecraft:oak_wall_sign[facing=south]`,   // a blank label to edit
    `setblock ${X + 4} ${Y + 1} ${Z + 3} minecraft:crafting_table`,
    // the stone home holds logs (misplaced); the wood home holds nothing
    `item replace block ${A[0]} ${A[1]} ${A[2]} container.0 with minecraft:spruce_log 64`, `item replace block ${A[0]} ${A[1]} ${A[2]} container.1 with minecraft:spruce_log 30`,
    `item replace block ${A[0]} ${A[1]} ${A[2]} container.2 with minecraft:cobblestone 64`,
    `kill @e[type=item,x=${X - 6},y=${Y - 2},z=${Z - 6},dx=12,dy=10,dz=12]`)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  bot._client.on('login', p => { bot.worldId = p?.worldName ?? 'sbx' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  ;(await import(path.join(BOTS, 'src/craftsync.mjs'))).installCraftSync(bot, { log: () => {} })   // as index.mjs does at spawn: the clicks in lockstep
  const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 1.5}`, `give ${NAME} minecraft:copper_ingot 20`, `give ${NAME} minecraft:oak_log 40`)
  await sleep(3000)
  bot.townPlan = { gen: 1, plan, at: Date.now() }
  const ctx = { bot }
  const ac = new AbortController()
  const homes = SK.sortHomesNow(bot)
  P('homes', homes && [...homes.byKey].map(([k, e]) => `${k}:${e.role}:${e.group}`))
  // 1. THE SIGNS: crafted from the bag's logs at the table, then the labels (A place, C edit of a blank sign)
  const spots = S.signSpots(rec, homes, new Map(plan.plots[0].cells.map(c => [c.at.join(','), c.stand])))
  P('spots', spots.map(s => `${s.chest}->${s.at}:${SK._sortUpkeep.sortSpotNeed(bot, s)}`))
  const sign = await SK._sortUpkeep.sortGetSigns(ctx, 2, ac.signal)
  R.signCrafted = sign ? `${sign.name}x${sign.count}` : null
  P('signs', R.signCrafted)
  for (const sp of spots) {
    const r = await SK._sortUpkeep.sortLabelOne(ctx, sp, ac.signal, Date.now() + 60_000)
    R[`label ${sp.chest}`] = { result: r, server: rcon(`data get block ${sp.at[0]} ${sp.at[1]} ${sp.at[2]} front_text.messages`)[0].reply.replace(/^.*data: /, '') }
    P('label', sp.chest, R[`label ${sp.chest}`])
  }
  // the chests under the labels still open
  for (const k of [A, B, C]) { try { const w = await bot.openContainer(bot.blockAt(new Vec3(...k))); SK.townIndexObserve(bot, new Vec3(...k), w, 'e2e'); w.close() } catch (e) { R[`open ${k}`] = 'threw ' + e.message } await sleep(400) }
  // 2. THE TIDY: the stone home's logs to the wood home (the index now knows all three)
  P('due', SK._sortUpkeep.storeUpkeepDue(bot, rec))
  const before = { A: items(A), B: items(B) }
  const t = await SK._sortUpkeep.sortTidyOne(ctx, homes, ac.signal, Date.now() + 120_000)
  R.bagAfterTidy = bot.inventory.items().map(i => `${i.name}x${i.count}`)
  R.tidy = { ...t, A: items(A), B: items(B), before }
  P('tidy', R.tidy)
  // 3. THE SORTED TOWN DEPOSIT: oak logs to the wood home, copper (metal: no home here) to the overflow
  const td = await SK.SKILLS.town_deposit.run(ctx, {}, ac.signal)
  R.townDeposit = { status: td.status, detail: td.detail, A: items(A), B: items(B), C: items(C) }
  P('town_deposit', R.townDeposit)
  P('RESULTS', R)
  bot.quit(); await sleep(500)
  rcon(`fill ${X - 6} ${Y} ${Z - 6} ${X + 6} ${Y + 6} ${Z + 6} minecraft:air`, `forceload remove ${X - 8} ${Z - 8} ${X + 8} ${Z + 8}`)
  process.exit(0)
}
main().catch(e => { P('FAIL', e.stack); try { rcon(`fill ${X - 6} ${Y} ${Z - 6} ${X + 6} ${Y + 6} ${Z + 6} minecraft:air`) } catch {} process.exit(1) })
