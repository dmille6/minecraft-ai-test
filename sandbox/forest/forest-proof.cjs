// SANDBOX-ONLY proof of the MANAGED FOREST's row geometry (forest-01, owner 11-06). Paper sandbox, RCON edits on a floating arena
// only; one bare mineflayer bot (sandbox-Forest) is the feller and keeps the chunks ticking. Restores randomTickSpeed / daylight.
//   BOT_ROOT=<worktree> node sandbox/forest/forest-proof.cjs [server=sandbox4] [rtick=200] [growMin=12] [decayMin=6]
// WHAT IT PROVES (the server is the oracle: every block read back by `execute if block`, items by entity selectors):
//   G  growth in the forest's rows: spruce / birch / oak saplings 3 apart along a row, rows 3 apart (2-wide aisles), FLAT (sapling
//      on the floor) and SUNK (soil one below the floor, the sapling level with the aisle) -- every sapling grows (no neighbour
//      blocks another's room), and how tall each trunk is (logs straight up the column).
//   M  two 2x2 spruce clusters: do they grow a MEGA spruce (the owner's "2x2 where possible") and how tall.
//   F  the felling stand: the bot stands on the aisle cell beside each trunk (after digging the leaves in that cell's feet and
//      head from the next aisle cell) and digs the trunk TOP DOWN with bot.dig, never moving; which logs come down, the highest
//      relative to its feet. FLAT vs SUNK is the question (a ground stand's measured reach is feet+6).
//   D  after the felling: the leaves left decay (count over decayMin) and the saplings they drop (self-supply per tree).
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs'); const path = require('path')
const sbx = require('../lib/sbxlock.cjs')
const mineflayer = require(require.resolve('mineflayer', { paths: [path.join(process.env.BOT_ROOT || '.', 'bots')] }))
const { Vec3 } = require(require.resolve('vec3', { paths: [path.join(process.env.BOT_ROOT || '.', 'bots')] }))
const [SERVER = 'sandbox4', RTICK = '200', GROW_MIN = '12', DECAY_MIN = '6'] = process.argv.slice(2)
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!PORTS[SERVER]) throw new Error('sandbox servers only')
const TAG = process.env.FP_TAG || 'forest01'
const OUT = process.env.FP_OUT || path.join(__dirname, 'log')
fs.mkdirSync(OUT, { recursive: true })
const RES = path.join(OUT, `forest-proof-${new Date().toISOString().replace(/[:.]/g, '')}.jsonl`)
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-fp-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 180000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); console.log(s) }
const rec = o => fs.appendFileSync(RES, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n')
const isBlock = (x, y, z, b) => /Test passed/.test(rcon(`execute if block ${x} ${y} ${z} ${b}`)[0]?.reply || '')
const isBlockMany = q => { const r = rcon(...q.map(([x, y, z, b]) => `execute if block ${x} ${y} ${z} ${b}`)); return q.map((_, i) => /Test passed/.test(r[i]?.reply || '')) }

// THE ARENA: stone 95, dirt 96-98, grass 99 (the floor F = 99, feet at 100), open sky. x 2500..2580, z 2500..2560.
const A = { x0: 2496, x1: 2584, z0: 2496, z1: 2566, F: 99 }
// THE ROWS: plots 3 apart along x, rows 3 apart in z (row z, aisle z+1 and z+2, next row z+3); each tree's stand is the aisle cell
// beside it on the +z side for even rows and the -z side for odd rows (the forest's rule: every plot owns one stand cell).
const plots = []
function addRows ({ sp, sunk, x0, z0, rows = 2, n = 5, tag }) {
  for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) {
    const x = x0 + 3 * i, z = z0 + 3 * j
    const side = j % 2 === 0 ? 1 : -1
    plots.push({ tag, sp, sunk, x, z, y: sunk ? A.F : A.F + 1, stand: [x, A.F + 1, z + side], approach: [x, A.F + 1, z + 2 * side] })
  }
}
function layout () {
  addRows({ sp: 'spruce', sunk: false, x0: 2502, z0: 2502, rows: 4, n: 6, tag: 'spruce_flat' })
  addRows({ sp: 'spruce', sunk: true, x0: 2502, z0: 2520, rows: 4, n: 6, tag: 'spruce_sunk' })
  addRows({ sp: 'birch', sunk: false, x0: 2530, z0: 2502, rows: 2, n: 5, tag: 'birch_flat' })
  addRows({ sp: 'oak', sunk: false, x0: 2530, z0: 2520, rows: 2, n: 5, tag: 'oak_flat' })
}
const megas = [{ x: 2560, z: 2504 }, { x: 2560, z: 2520 }]

async function main () {
  P('lock', sbx.requireSandboxLock(SERVER, TAG))
  layout()
  const c = [`forceload add ${A.x0} ${A.z0} ${A.x1} ${A.z1}`, `kill @e[type=item,x=${A.x0},y=80,z=${A.z0},dx=90,dy=60,dz=72]`]
  for (let y = 136; y >= 100; y -= 4) c.push(`fill ${A.x0} ${y} ${A.z0} ${A.x1} ${y + 3} ${A.z1} minecraft:air`)
  c.push(`fill ${A.x0} 95 ${A.z0} ${A.x1} 95 ${A.z1} minecraft:stone`, `fill ${A.x0} 96 ${A.z0} ${A.x1} 98 ${A.z1} minecraft:dirt`,
    `fill ${A.x0} 99 ${A.z0} ${A.x1} 99 ${A.z1} minecraft:grass_block`, `kill @e[type=item,x=${A.x0},y=80,z=${A.z0},dx=90,dy=60,dz=72]`)
  const bad = rcon(...c).filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many/i.test(x.reply))
  if (bad.length) throw new Error('arena: ' + JSON.stringify(bad))
  const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: 'sandbox-Forest', auth: 'offline' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('feller spawned', bot.version)
  rcon('gamemode survival sandbox-Forest', 'clear sandbox-Forest', 'give sandbox-Forest minecraft:iron_axe 2', `tp sandbox-Forest 2540 100 2545`,
    'gamerule doDaylightCycle false', 'time set 6000', 'gamerule randomTickSpeed 3', 'effect give sandbox-Forest minecraft:saturation 99999 1 true')
  // PLANT (sunk: the plot's soil one below the floor; its cell is dug out first)
  const pc = []
  for (const p of plots) {
    if (p.sunk) pc.push(`setblock ${p.x} ${A.F} ${p.z} minecraft:air`)
    pc.push(`setblock ${p.x} ${p.y} ${p.z} minecraft:${p.sp}_sapling`)
  }
  for (const m of megas) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) pc.push(`setblock ${m.x + dx} ${A.F + 1} ${m.z + dz} minecraft:spruce_sapling`)
  rcon(...pc)
  rcon(`gamerule randomTickSpeed ${RTICK}`)
  const t0 = Date.now(), grown = new Map()
  const all = [...plots, ...megas.map(m => ({ tag: 'mega', sp: 'spruce', x: m.x, z: m.z, y: A.F + 1, mega: true }))]
  while (Date.now() - t0 < Number(GROW_MIN) * 60000 && grown.size < all.length) {
    const todo = all.filter(p => !grown.has(p))
    const ok = isBlockMany(todo.map(p => [p.x, p.y, p.z, '#minecraft:saplings']))
    todo.forEach((p, i) => { if (!ok[i]) grown.set(p, (Date.now() - t0) / 1000) })
    await sleep(4000)
  }
  rcon('gamerule randomTickSpeed 0')   // freeze: nothing else grows or decays while the trees are read and felled
  // READ each trunk straight up its column (and the mega's 2x2)
  for (const p of all) {
    const top = []
    const cols = p.mega ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]]
    let logs = 0, hi = null
    for (const [dx, dz] of cols) {
      const ys = []; for (let y = p.y; y <= p.y + 34; y++) ys.push(y)
      const ok = isBlockMany(ys.map(y => [p.x + dx, y, p.z + dz, '#minecraft:logs']))
      ys.forEach((y, i) => { if (ok[i]) { logs++; hi = Math.max(hi ?? -1e9, y) } })
    }
    p.logs = logs; p.top = hi; p.grewS = grown.get(p) ?? null
    rec({ kind: 'grow', tag: p.tag, sp: p.sp, sunk: !!p.sunk, x: p.x, z: p.z, base: p.y, grewS: p.grewS, logs, top: hi, topOverFeet: hi != null ? hi - (A.F + 1) : null })
  }
  // FELL: each grown single tree from its stand, top down, never moving
  for (const p of plots.filter(q => q.grewS != null && q.logs > 0)) {
    // the stand's leaves (feet, head) dug from the approach cell
    rcon(`tp sandbox-Forest ${p.approach[0] + 0.5} ${p.approach[1]} ${p.approach[2] + 0.5}`)
    await sleep(700)
    let leavesDug = 0, leavesFail = 0
    for (const y of [p.stand[1], p.stand[1] + 1]) {
      const b = bot.blockAt(new Vec3(p.stand[0], y, p.stand[2]))
      if (b && /leaves/.test(b.name)) { try { await bot.dig(b, true); leavesDug++ } catch { leavesFail++ } }
    }
    // the approach cell's own head leaves can hold the bot in: noted only
    rcon(`tp sandbox-Forest ${p.stand[0] + 0.5} ${p.stand[1]} ${p.stand[2] + 0.5}`)
    await sleep(700)
    const feet = Math.floor(bot.entity.position.y)
    const got = [], refused = []
    for (let y = p.top; y >= p.y; y--) {
      const b = bot.blockAt(new Vec3(p.x, y, p.z))
      if (!b || !/_log$/.test(b.name)) continue
      const can = bot.canDigBlock(b)
      let ok = false
      if (can) { try { await Promise.race([bot.dig(b, true), sleep(8000).then(() => { throw new Error('timeout') })]); ok = true } catch { ok = false } }
      await sleep(150)
      const after = isBlock(p.x, y, p.z, '#minecraft:logs')
      ;(after ? refused : got).push({ dy: y - feet, can, ok })
    }
    const left = isBlockMany(Array.from({ length: p.top - p.y + 1 }, (_, i) => [p.x, p.y + i, p.z, '#minecraft:logs'])).filter(Boolean).length
    rec({ kind: 'fell', tag: p.tag, sp: p.sp, sunk: !!p.sunk, x: p.x, z: p.z, logs: p.logs, topOverFeet: p.top - feet, feet, leavesDug, leavesFail,
      felled: got.length, refused: refused.map(r => r.dy), maxDy: got.length ? Math.max(...got.map(g => g.dy)) : null, left })
    P(p.tag, p.x, p.z, `logs ${p.logs} top +${p.top - feet}`, `felled ${got.length}`, `left ${left}`, refused.length ? `refused dy ${refused.map(r => r.dy)}` : '')
  }
  // DECAY + DROPS: the leaves left over the felled rows, and the saplings they drop
  rcon('kill @e[type=item,x=2496,y=80,z=2496,dx=60,dy=60,dz=50]', `tp sandbox-Forest 2530 100 2540`)
  const leafCount = () => { const r = rcon(`fill 2496 100 2496 2556 130 2546 minecraft:oak_leaves[persistent=false] replace #minecraft:leaves`)[0]?.reply || ''; return r }
  rcon(`gamerule randomTickSpeed ${Math.max(3, Math.min(Number(RTICK), 60))}`)
  await sleep(Number(DECAY_MIN) * 60000)
  rcon('gamerule randomTickSpeed 0')
  const saps = {}
  for (const s of ['spruce_sapling', 'birch_sapling', 'oak_sapling', 'stick', 'apple']) {
    const r = rcon(`execute if entity @e[type=item,x=2496,y=80,z=2496,dx=60,dy=60,dz=50,nbt={Item:{id:"minecraft:${s}"}}]`)[0]?.reply || ''
    const m = /count: (\d+)/.exec(r) || /(\d+)/.exec(r)
    saps[s] = m ? Number(m[1]) : r
  }
  // leaves left: test every cell of the felled area's canopy band (bounded scan, every 1)
  const q = []
  for (let x = 2500; x <= 2550; x++) for (let z = 2499; z <= 2533; z++) for (let y = 101; y <= 110; y++) if ((x + z + y) % 3 === 0) q.push([x, y, z, '#minecraft:leaves'])
  let leaves = 0; for (let i = 0; i < q.length; i += 400) leaves += isBlockMany(q.slice(i, i + 400)).filter(Boolean).length
  rec({ kind: 'decay', minutes: Number(DECAY_MIN), rtick: Math.max(3, Math.min(Number(RTICK), 60)), item_entities_by_kind: saps, leaves_sampled_left: leaves, sampled: q.length })
  P('decay', saps, `leaves left in a 1/3 sample: ${leaves}/${q.length}`)
  bot.quit()
}
main().catch(e => { P('ERROR', String(e?.stack || e)); rec({ kind: 'error', e: String(e?.stack || e).slice(0, 400) }) }).finally(() => {
  try { rcon('gamerule randomTickSpeed 3', 'gamerule doDaylightCycle true', `forceload remove ${A.x0} ${A.z0} ${A.x1} ${A.z1}`) } catch (e) { P('RESTORE FAILED', String(e)) }
  P('results', RES)
  setTimeout(() => process.exit(0), 1500)
})
