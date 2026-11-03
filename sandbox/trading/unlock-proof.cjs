// SANDBOX-ONLY (sandbox4): T3a village unlock proof (trading design 2026-11-03, owner 11-03 "we can edit the world when it
// comes to opening doors etc"). The showcase's village-taiga-6_1 holds 4 villagers inside a 4x1 ring of OPEN bottom spruce
// trapdoors facing outward (79..84,73,-5..-3, read from a region copy 11-03) and 3 inside a 2x1 ring in the leatherworker
// house. Replica on a floating arena: the same ring, the same states, a planks floor inside; an unemployed villager inside;
// a free job site (smithing table) 6 blocks away on open floor.
//   CONTROL  ring intact for 90 s: the villager must stay unemployed and inside (else the replica is not the trap)
//   STEP 1   the bot (survival, standing outside) toggles the NORTH side's 4 trapdoors closed with activateBlock
//   STEP 2   if still stuck after 90 s: the east and west ends too; then the south side
//   READ     server block states (`data`-free: `execute if block ... [open=false]`), villager profession + position + health
'use strict'
const { execFileSync } = require('child_process')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const SERVER = 'sandbox4', PORT = 25602, NAME = 'sbx-Unlock', TAG = 'trading'
function rcon (...cmds) {
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  return out.split('\n> ').map(s => s.replace(/^> /, ''))
}
const r1 = c => rcon(c)[0].split('\n').slice(1).join(' ').trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const X = 3400, Y = 140, Z = 3400, F = Y + 1   // ring interior cells (X+1..X+4, F, Z)
const R = {}
const prof = () => r1('data get entity @e[type=villager,tag=unl,limit=1] VillagerData.profession')
const vpos = () => r1('data get entity @e[type=villager,tag=unl,limit=1] Pos')
const N = [1, 2, 3, 4].map(i => [X + i, F, Z - 1]), S = [1, 2, 3, 4].map(i => [X + i, F, Z + 1]), EW = [[X, F, Z], [X + 5, F, Z]]
const isOpen = ([x, y, z]) => /passed/i.test(r1(`execute if block ${x} ${y} ${z} minecraft:spruce_trapdoor[open=true]`))
async function waitJob (ms) {
  const t = Date.now()
  while (Date.now() - t < ms) { if (!/minecraft:none/.test(prof())) return { prof: prof(), s: (Date.now() - t) / 1000 }; await sleep(5000) }
  return { prof: prof(), s: ms / 1000, timeout: true }
}
async function toggle (bot, cells) {
  const out = []
  for (const c of cells) {
    const b = bot.blockAt(new Vec3(...c))
    try { await bot.activateBlock(b); await sleep(400); out.push([c.join(','), b?.name, isOpen(c) ? 'open' : 'closed']) } catch (e) { out.push([c.join(','), 'threw ' + e.message]) }
  }
  return out
}
async function main () {
  requireSandboxLock(SERVER, TAG)
  rcon(`forceload add ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`,
    `fill ${X - 8} ${Y} ${Z - 8} ${X + 12} ${Y + 5} ${Z + 10} minecraft:air`,
    `fill ${X - 8} ${Y} ${Z - 8} ${X + 12} ${Y} ${Z + 10} minecraft:dirt_path`,
    `fill ${X + 1} ${Y} ${Z} ${X + 4} ${Y} ${Z} minecraft:spruce_planks`,
    `fill ${X - 8} ${F} ${Z - 8} ${X + 12} ${F + 2} ${Z - 8} minecraft:glass`, `fill ${X - 8} ${F} ${Z + 10} ${X + 12} ${F + 2} ${Z + 10} minecraft:glass`,
    `fill ${X - 8} ${F} ${Z - 8} ${X - 8} ${F + 2} ${Z + 10} minecraft:glass`, `fill ${X + 12} ${F} ${Z - 8} ${X + 12} ${F + 2} ${Z + 10} minecraft:glass`,
    ...N.map(([x, y, z]) => `setblock ${x} ${y} ${z} minecraft:spruce_trapdoor[facing=north,half=bottom,open=true]`),
    ...S.map(([x, y, z]) => `setblock ${x} ${y} ${z} minecraft:spruce_trapdoor[facing=south,half=bottom,open=true]`),
    `setblock ${X} ${F} ${Z} minecraft:spruce_trapdoor[facing=west,half=bottom,open=true]`,
    `setblock ${X + 5} ${F} ${Z} minecraft:spruce_trapdoor[facing=east,half=bottom,open=true]`,
    `setblock ${X + 2} ${F} ${Z + 6} minecraft:smithing_table`,
    `kill @e[type=villager,x=${X - 20},y=${Y - 5},z=${Z - 20},dx=40,dy=20,dz=40]`, 'time set 1000')
  await sleep(1000)
  rcon(`summon villager ${X + 2.5} ${F} ${Z + 0.5} {Tags:["unl"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:taiga"}}`)
  R.ringOpenBefore = [...N, ...S, ...EW].filter(isOpen).length
  P('ring open trapdoors', R.ringOpenBefore, 'of 10; villager', vpos())
  R.control = await waitJob(90000)
  R.controlPos = vpos()
  P('CONTROL (ring intact 90 s)', R.control, R.controlPos)
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 2.5} ${F} ${Z - 3.5}`)
    await sleep(3000)
    if (!R.control.timeout) { R.note = 'control took a job with the ring intact: the replica is not the trap'; return }
    R.step1 = await toggle(bot, N)
    P('STEP 1 north side', R.step1)
    R.after1 = await waitJob(90000); R.pos1 = vpos()
    P('after step 1', R.after1, R.pos1)
    if (R.after1.timeout) {
      R.step2 = await toggle(bot, [...EW, ...S])
      P('STEP 2 ends + south', R.step2)
      R.after2 = await waitJob(90000); R.pos2 = vpos()
      P('after step 2', R.after2, R.pos2)
    }
    R.health = r1('data get entity @e[type=villager,tag=unl,limit=1] Health')
    R.trapdoorsStillThere = [...N, ...S, ...EW].filter(([x, y, z]) => /passed/i.test(r1(`execute if block ${x} ${y} ${z} minecraft:spruce_trapdoor`))).length
  } finally {
    bot.quit(); await sleep(500)
    rcon('kill @e[type=villager,tag=unl]', `kill @e[type=item,x=${X - 20},y=${Y - 5},z=${Z - 20},dx=40,dy=20,dz=40]`,
      `fill ${X - 8} ${Y} ${Z - 8} ${X + 12} ${Y + 5} ${Z + 10} minecraft:air`, `forceload remove ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`)
    console.log('RESULT ' + JSON.stringify(R))
  }
}
main().catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
