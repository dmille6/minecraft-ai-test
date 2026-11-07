// SANDBOX-ONLY proof 3 of the MANAGED FOREST (forest-03, LIVE 11-06 22:58Z: every felling `off_stand`): the bots' OWN felling --
// forest.mjs fellTree over buildbot.mjs botBuildEffects (the build walk: walkTo = pathfinder goto GoalBlock legs, the server-witnessed
// dig) -- on grown trees with their natural leaves, the bot starting 6-9 blocks off, never teleported to a stand. Scenes:
//   SUNK  spruce grown from saplings in sunk plots (the forest's geometry), the recorded stand in the aisle
//   SITE  spruce grown on flat natural ground (a site tree), the stand at ground + 1
//   FARM  spruce on the old farm's flat plots (sapling at floor + 1), a 6-log or shorter trunk (an 8-log one is kept, never felled)
// Each scene twice: Movements with canDig true and with canDig false (a walk that digs no leaf: the live off_stand's shape).
//   BOT_ROOT=<worktree> node sandbox/forest/forest-proof3.cjs [server=sandbox4]
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs'); const path = require('path')
const sbx = require('../lib/sbxlock.cjs')
const ROOT = process.env.BOT_ROOT || '.'
const req = n => require(require.resolve(n, { paths: [path.join(ROOT, 'bots')] }))
const mineflayer = req('mineflayer'); const { Vec3 } = req('vec3')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const [SERVER = 'sandbox4'] = process.argv.slice(2)
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const TAG = process.env.FP_TAG || 'forest01'
const OUT = path.join(__dirname, 'log'); fs.mkdirSync(OUT, { recursive: true })
const RES = path.join(OUT, `forest-proof3-${new Date().toISOString().replace(/[:.]/g, '')}.jsonl`)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-fp-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const rec = o => fs.appendFileSync(RES, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n')
const A = { x0: 2496, x1: 2584, z0: 2496, z1: 2566, F: 99 }
async function main () {
  P('lock', sbx.requireSandboxLock(SERVER, TAG))
  const F = await import(path.join(ROOT, 'bots/src/forest.mjs'))
  const BB = await import(path.join(ROOT, 'bots/src/buildbot.mjs'))
  const c = [`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`]
  for (let y = 136; y >= 100; y -= 4) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y + 3} ${A.z1} minecraft:air`)
  c.push(`fill ${A.x0} 95 ${A.z0} ${A.x1} 95 ${A.z1} minecraft:stone`, `fill ${A.x0} 96 ${A.z0} ${A.x1} 98 ${A.z1} minecraft:dirt`, `fill ${A.x0} 99 ${A.z0} ${A.x1} 99 ${A.z1} minecraft:grass_block`, `kill @e[type=item,x=${A.x0},y=80,z=${A.z0},dx=90,dy=60,dz=72]`)
  rcon(...c)
  // the trees: SUNK (z 2504, sapling at F), SITE (z 2520, sapling at F + 1, no stand cleared), FARM (z 2536, sapling at F + 1, floor), 4 each, 3 apart
  const trees = []
  for (const [scene, z, y] of [['SUNK', 2504, A.F], ['SITE', 2520, A.F + 1], ['FARM', 2536, A.F + 1]]) for (let i = 0; i < 8; i++) trees.push({ scene, x: 2502 + 3 * i, z, y, dig: i < 4 })
  rcon(...trees.flatMap(t => [...(t.y === A.F ? [`setblock ${t.x} ${A.F} ${t.z} minecraft:air`] : []), `setblock ${t.x} ${t.y} ${t.z} minecraft:spruce_sapling`]))
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: 'sandbox-Forest', auth: 'offline' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon('gamemode survival sandbox-Forest', 'clear sandbox-Forest', 'give sandbox-Forest minecraft:iron_axe 1', 'gamerule doDaylightCycle false', 'time set 6000', 'effect give sandbox-Forest minecraft:saturation 99999 1 true', 'gamerule randomTickSpeed 200')
  const tg = Date.now()
  while (Date.now() - tg < 8 * 60000) { const r = rcon(...trees.map(t => `execute if block ${t.x} ${t.y} ${t.z} #minecraft:saplings`)); if (r.every(q => !/Test passed/.test(q.reply))) break; await sleep(3000) }
  rcon('gamerule randomTickSpeed 0')
  await sleep(1500)
  const read = (x, y, z) => { const b = bot.blockAt(new Vec3(x, y, z)); return b ? { name: b.name, boundingBox: b.boundingBox } : null }
  let k = 0
  for (const canDig of [false, true]) {
    for (const t of trees) {
      // every tree once: the first half of each scene with canDig false, the second half with canDig true
      if ((k++ % 8 < 4) !== !canDig) continue
      const col = []; for (let y = t.y; y <= t.y + 12; y++) { const b = read(t.x, y, t.z); if (b && /_log$/.test(b.name)) col.push([t.x, y, t.z]) }
      if (!col.length) { rec({ kind: 'nogrow', ...t }); continue }
      const tr = { cell: [t.x, t.y, t.z], stand: [t.x, t.scene === 'SUNK' ? A.F + 1 : t.y, t.z + 1], order: [...col].reverse() }
      if (t.scene !== 'SUNK' && col.some(p => !F.standReaches(tr.stand, p))) { rec({ kind: 'kept_tall', scene: t.scene, x: t.x, logs: col.length }); P(t.scene, t.x, 'kept (too tall for a side stand)', col.length); continue }
      const m = new Movements(bot); m.canDig = canDig; bot.pathfinder.setMovements(m)
      rcon(`tp sandbox-Forest ${t.x + 0.5} ${A.F + 1} ${t.z + (t.scene === 'SUNK' ? 8 : 6) + 0.5}`)   // start 6-8 off, in the open
      await sleep(1500)
      const e = BB.botBuildEffects(bot, {})
      const t1 = Date.now()
      let r
      try { r = await F.fellTree(e, read, tr, { deadline: Date.now() + 90_000 }) } finally { e.close() }
      await sleep(500)
      const left = col.filter(p => /Test passed/.test(rcon(`execute if block ${p[0]} ${p[1]} ${p[2]} #minecraft:logs`)[0]?.reply || '')).length
      const out = { kind: 'fell', scene: t.scene, canDig, x: t.x, logs: col.length, n: r.n, why: r.why, from: r.from, stand: tr.stand, onRecorded: r.from?.join(',') === tr.stand.join(','), left, s: (Date.now() - t1) / 1000 }
      rec(out); P(t.scene, 'canDig', canDig, t.x, `logs ${col.length}`, `felled ${r.n}`, r.why ?? 'ok', 'from', r.from, out.onRecorded ? '(the recorded stand)' : '(another stand)', `left ${left}`)
    }
  }
  bot.quit()
}
main().catch(e => { P('ERROR', String(e?.stack || e)); rec({ kind: 'error', e: String(e?.stack || e).slice(0, 400) }) }).finally(() => {
  try { rcon('gamerule randomTickSpeed 3', 'gamerule doDaylightCycle true', `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`) } catch (e) { P('RESTORE FAILED', String(e)) }
  P('results', RES); setTimeout(() => process.exit(0), 1500)
})
