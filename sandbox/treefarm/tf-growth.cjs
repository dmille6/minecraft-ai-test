// SANDBOX-ONLY tree-farm growth experiment (sandbox4). RCON edits on a floating arena only; one bare watcher bot
// keeps the chunks ticking (random ticks need a player in simulation distance). Restores randomTickSpeed/daylight.
//   BOT_ROOT=<worktree> node tf-growth.cjs <scene> [rtick] [minutes]
//   scenes: day (oak+birch grids spacing 3/4, noon, frozen clock)  night (frozen midnight; the spacing-4 grids get the
//   farm's 2x2-centre torches, the spacing-3 grids stay dark)  leaves (six persistent leaf blocks above vs open, a torch each)
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const mineflayer = require(require.resolve('mineflayer', { paths: [require('path').join(process.env.BOT_ROOT || '.', 'bots')] }))   // BOT_ROOT: any worktree with bots/node_modules
const [SCENE = 'day', RTICK = '30', MIN = '12'] = process.argv.slice(2)
const SERVER = 'sandbox4', PORT = 25602
const OUT = (process.env.TF_OUT || __dirname) + `/tf-growth-${SCENE}.jsonl`
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-tfg-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
// arena: grass platform at y=99 (dirt 97-98), open sky above, x/z 2400..2460
const A = { x0: 2400, x1: 2460, z0: 2400, z1: 2460, g: 99 }
const plots = []
function layout () {
  // oak grid spacing 4 (4x4), birch grid spacing 4 (4x4), oak grid spacing 3 (3x3), birch spacing 3 (3x3)
  const grids = [
    { sp: 'oak', s: 4, n: 4, x: 2404, z: 2404 }, { sp: 'birch', s: 4, n: 4, x: 2428, z: 2404 },
    { sp: 'oak', s: 3, n: 3, x: 2404, z: 2430 }, { sp: 'birch', s: 3, n: 3, x: 2428, z: 2430 },
  ]
  if (SCENE === 'leaves') {
    // a sapling with LEAVES (persistent) filling its column +2..+7 (covered) vs an open control, oak and birch, noon
    for (let i = 0; i < 8; i++) for (const sp of ['oak', 'birch']) for (const cov of [true, false]) {
      plots.push({ sp, s: 0, x: 2404 + i * 4, y: A.g + 1, z: 2404 + (sp === 'oak' ? 0 : 12) + (cov ? 0 : 24), torch: false, cover: cov })
    }
    return
  }
  for (const gr of grids) for (let i = 0; i < gr.n; i++) for (let j = 0; j < gr.n; j++) {
    plots.push({ sp: gr.sp, s: gr.s, x: gr.x + i * gr.s, y: A.g + 1, z: gr.z + j * gr.s, torch: SCENE === 'night' && gr.s === 4 })
  }
}
async function main () {
  layout()
  const r = rcon(`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`,
    `fill ${A.x0} 96 ${A.z0} ${A.x1} 96 ${A.z1} minecraft:stone`, `fill ${A.x0} 97 ${A.z0} ${A.x1} 98 ${A.z1} minecraft:dirt`,
    `fill ${A.x0} 99 ${A.z0} ${A.x1} 99 ${A.z1} minecraft:grass_block`,
    ...[100, 108, 116, 124].map(y => `fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y + 7} ${A.z1} minecraft:air`),
    `kill @e[type=item,x=${A.x0},y=90,z=${A.z0},dx=60,dy=50,dz=60]`)
  const bad = r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + JSON.stringify(bad))
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: 'sandbox-TFWatch', auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('watcher spawned')
  rcon(`tp sandbox-TFWatch 2430 100 2420`, 'gamerule doDaylightCycle false', `time set ${SCENE === 'night' ? 18000 : 6000}`, `gamerule randomTickSpeed ${RTICK}`)
  const cmds = []
  for (const p of plots) {
    cmds.push(`setblock ${p.x} ${p.y} ${p.z} minecraft:${p.sp}_sapling`)
    if (SCENE === 'leaves') cmds.push(`setblock ${p.x + 1} ${p.y} ${p.z} minecraft:torch`)   // light is not the variable here
    if (p.cover) cmds.push(`fill ${p.x} ${p.y + 1} ${p.z} ${p.x} ${p.y + 6} ${p.z} minecraft:oak_leaves[persistent=true]`)
    if (p.torch && (p.x - (p.sp === 'oak' ? 2404 : 2428)) / 4 < 3 && (p.z - 2404) / 4 < 3) cmds.push(`setblock ${p.x + 2} ${p.y} ${p.z + 2} minecraft:torch`)
  }
  rcon(...cmds)
  const t0 = Date.now()
  const grown = new Map()
  const deadline = t0 + Number(MIN) * 60000
  while (Date.now() < deadline && grown.size < plots.length) {
    const todo = plots.filter(p => !grown.has(p))
    const rr = rcon(...todo.map(p => `execute if block ${p.x} ${p.y} ${p.z} #minecraft:saplings`))
    todo.forEach((p, i) => { if (!/Test passed/.test(rr[i]?.reply || '')) grown.set(p, (Date.now() - t0) / 1000) })
    await sleep(3000)
  }
  // what is at each plot now, and how many logs each tree has (5x5 column volume, counted by a replace fill)
  const rows = []
  for (const p of plots) {
    const t = grown.get(p) ?? null
    let logs = null
    if (t != null) {
      const rep = rcon(`fill ${p.x - 3} ${p.y} ${p.z - 3} ${p.x + 3} ${p.y + 14} ${p.z + 3} minecraft:stripped_${p.sp}_log replace #minecraft:logs`)[0]?.reply || ''
      const m = /filled (\d+)/i.exec(rep) || /(\d+) block/.exec(rep)
      logs = m ? Number(m[1]) : (/No blocks/i.test(rep) ? 0 : rep)
    }
    const base = rcon(`execute if block ${p.x} ${p.y} ${p.z} #minecraft:logs`)[0]?.reply || ''
    rows.push({ scene: SCENE, rtick: Number(RTICK), sp: p.sp, spacing: p.s, x: p.x, z: p.z, torch: p.torch, cover: p.cover, grownAfterS: t, logs, trunkAtBase: /passed/.test(base) })
  }
  fs.writeFileSync(OUT, rows.map(x => JSON.stringify(x)).join('\n') + '\n')
  const by = {}
  for (const x of rows) {
    const k = SCENE === 'leaves' ? `${x.sp} ${x.cover ? 'leaves above' : 'open'}` : `${x.sp} s${x.spacing}${SCENE === 'night' ? (x.torch ? ' torch' : ' dark') : ''}`
    by[k] = by[k] || { n: 0, grew: 0, t: [], logs: [] }
    by[k].n++; if (x.grownAfterS != null) { by[k].grew++; by[k].t.push(x.grownAfterS); by[k].logs.push(x.logs) }
  }
  for (const [k, v] of Object.entries(by)) {
    v.t.sort((a, b) => a - b); const med = v.t.length ? v.t[Math.floor(v.t.length / 2)] : null
    P(k, `grew ${v.grew}/${v.n}`, `median ${med}s`, `max ${v.t.at(-1) ?? null}s`, `logs ${JSON.stringify(v.logs)}`)
  }
  bot.quit()
}
main().catch(e => { P('ERROR', String(e?.stack || e)) }).finally(() => {
  try { rcon('gamerule randomTickSpeed 3', 'gamerule doDaylightCycle true', `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`) } catch (e) { P('RESTORE FAILED', String(e)) }
  setTimeout(() => process.exit(0), 1000)
})
