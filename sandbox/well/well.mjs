// SANDBOX-ONLY junk-well experiment on Paper sandbox3 (10.0.0.30:25601). Two bare-mineflayer bots in ONE node process.
// RCON only via ssh mike@10.0.0.30 python3 /tmp/sbx-rcon.py sandbox3 (the helper reads the password itself; never printed here).
// usage: node well.mjs <logfile> <phase> [phase ...]   phases: setup s0 s1 s2 s3 s3b s4 s5 cleanup
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
const WT = '/Users/darrellmiller/Documents/code-minecraft-ai/.claude/worktrees/heuristic-nightingale-49eee9/bots'
const require = createRequire(WT + '/package.json')
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')

const HOST = '10.0.0.30', PORT = 25601, SRV = 'sandbox3'
const TN = 'sandbox-WThrow', WN = 'sandbox-WWalk'
if (HOST !== '10.0.0.30' || PORT < 25599 || PORT > 25602 || !TN.startsWith('sandbox-') || !WN.startsWith('sandbox-')) throw new Error('sandbox only')

const OUT = process.argv[2]; const PHASES = process.argv.slice(3)
const out = fs.createWriteStream(OUT, { flags: 'a' })
const t0 = Date.now()
const P = (...a) => { const s = `[${((Date.now() - t0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.write(s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------- geometry (g = 199: ground top at 200, feet at 200)
const G = 199
const W1 = { x: 1500, z: 1500 }, W2 = { x: 1494, z: 1494 }
const AR = { x0: 1486, x1: 1514, z0: 1486, z1: 1514, y0: 195, y1: 208 }
const PILLAR = { x: 1491, z: 1509 }

// ---------- RCON (async, so bot physics keeps running)
function rcon (...cmds) {
  return new Promise((resolve, reject) => {
    const p = spawn('ssh', ['-o', 'BatchMode=yes', 'mike@10.0.0.30', `python3 /tmp/sbx-rcon.py ${SRV} -`])
    let o = '', e = ''
    const to = setTimeout(() => { p.kill(); reject(new Error('rcon timeout')) }, 60000)
    p.stdout.on('data', d => { o += d }); p.stderr.on('data', d => { e += d })
    p.on('close', code => {
      clearTimeout(to)
      if (code) return reject(new Error('rcon exit ' + code + ' ' + e.slice(0, 200)))
      const res = []; let cur = null
      for (const line of o.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
      resolve(res)
    })
    p.stdin.end(cmds.join('\n') + '\n')
  })
}
const r1 = async c => (await rcon(c))[0]?.reply ?? ''
const gametime = async () => Number(/The time is (\d+)/.exec(await r1('time query gametime'))?.[1])

function parseEntities (reply) {
  const parts = reply.split('has the following entity data: ').slice(1)
  return parts.map(b => {
    const pos = /Pos: \[([-\d.E]+)d, ([-\d.E]+)d, ([-\d.E]+)d\]/.exec(b)
    const age = /\bAge: (-?\d+)s/.exec(b)
    const cnt = /Item: \{[^}]*?count: (\d+)/.exec(b)
    const id = /Item: \{[^}]*?id: "minecraft:([a-z_]+)"/.exec(b)
    const uuid = /UUID: \[I; ([-\d]+), ([-\d]+), ([-\d]+), ([-\d]+)\]/.exec(b)
    const pd = /PickupDelay: (-?\d+)s/.exec(b)
    return { id: id?.[1], count: Number(cnt?.[1] ?? 0), x: Number(pos?.[1]), y: Number(pos?.[2]), z: Number(pos?.[3]), age: Number(age?.[1]), pd: Number(pd?.[1]), uuid: uuid ? uuid.slice(1).join(',') : null }
  })
}
const SEL = `@e[type=item,x=${AR.x0 - 6},y=${AR.y0 - 5},z=${AR.z0 - 6},dx=${AR.x1 - AR.x0 + 12},dy=${AR.y1 - AR.y0 + 10},dz=${AR.z1 - AR.z0 + 12}]`
// census with SMALL replies only (a multi-packet RCON reply desyncs the helper): scoreboard sums + a short outside list
const SHAFT = w => `@e[type=item,x=${w.x},y=${G - 2},z=${w.z},dx=0,dy=1,dz=0]`
const OUTSEL = SEL.replace('@e[type=item,', '@e[type=item,tag=!inwell,').replace(/\]$/, ',sort=nearest,limit=12]')
const per = rep => rep.split('has the following entity data: ').slice(1).map(x => x.split('\n')[0].trim())
const has = rep => { const m = /has (-?\d+) \[/.exec(rep); return m ? Number(m[1]) : null }
const tcount = rep => Number(/count: (\d+)/.exec(rep)?.[1] ?? 0)
const sum = a => a.reduce((s, e) => s + e.count, 0)
async function wellCensus (w = W1) {
  const sh = SHAFT(w)
  const r = await rcon('scoreboard objectives add wc dummy', 'scoreboard objectives add wa dummy',
    `execute as ${SEL} store result score @s wc run data get entity @s Item.count`,
    `execute as ${SEL} store result score @s wa run data get entity @s Age`,
    'scoreboard players set #in wc 0', 'scoreboard players set #all wc 0', 'scoreboard players set #amax wa -99999', 'scoreboard players set #amin wa 99999',
    `scoreboard players operation #in wc += ${sh} wc`, `scoreboard players operation #all wc += ${SEL} wc`,
    `scoreboard players operation #amax wa > ${sh} wa`, `scoreboard players operation #amin wa < ${sh} wa`,
    'scoreboard players get #in wc', 'scoreboard players get #all wc', 'scoreboard players get #amax wa', 'scoreboard players get #amin wa',
    `execute if entity ${sh}`, `execute if entity ${SEL}`,
    `tag ${sh} add inwell`,
    `execute as ${OUTSEL} run data get entity @s Pos`, `execute as ${OUTSEL} run data get entity @s Item.count`, `execute as ${OUTSEL} run data get entity @s Item.id`,
    'tag @e[type=item,tag=inwell] remove inwell')
  const R = i => r[i]?.reply ?? ''
  const inItems = has(R(12)), allItems = has(R(13)), amax = has(R(14)), amin = has(R(15))
  const inEnt = tcount(R(16)), allEnt = tcount(R(17))
  const pos = per(R(19)), cnt = per(R(20)), ids = per(R(21))
  const outs = pos.map((p, i) => { const m = /\[([-\d.E]+)d, ([-\d.E]+)d, ([-\d.E]+)d\]/.exec(p); return { x: Number(m?.[1]), y: Number(m?.[2]), z: Number(m?.[3]), count: parseInt(cnt[i]), id: /minecraft:([a-z_]+)/.exec(ids[i] || '')?.[1] } })
  return { entities: allEnt, selectorCount: allEnt, inEnt, inItems, outEnt: allEnt - inEnt, outItems: allItems - inItems, inAges: inEnt ? [amin, amax] : [], ins: [], outs, raw: r.slice(12, 18).map(x => x.reply.trim()) }
}
const short = c => ({ entities: c.entities, selectorCount: c.selectorCount, inEnt: c.inEnt, inItems: c.inItems, outEnt: c.outEnt, outItems: c.outItems, inAgeMin: c.inAges[0], inAgeMax: c.inAges[c.inAges.length - 1],
  outs: c.outs.map(e => `${e.id}x${e.count}@${e.x.toFixed(2)},${e.y.toFixed(2)},${e.z.toFixed(2)}`) })

function parseBag (reply) {
  const b = reply.replace(/^[^[]*/, '')
  const res = []
  for (const m of b.matchAll(/\{([^{}]*)\}/g)) {
    const id = /id: "minecraft:([a-z_]+)"/.exec(m[1])?.[1]; const c = Number(/count: (\d+)/.exec(m[1])?.[1] ?? 1); const sl = /Slot: (-?\d+)b/.exec(m[1])?.[1]
    if (id) res.push({ slot: Number(sl), id, count: c })
  }
  return res
}
async function bag (name) {
  const cmds = []; for (let i = 0; i < 41; i++) cmds.push(`data get entity ${name} Inventory[${i}]`)
  const r = await rcon(...cmds)
  const b = []
  for (const x of r) { const m = x.reply; const id = /id: "minecraft:([a-z_]+)"/.exec(m)?.[1]; if (!id) continue; b.push({ id, count: Number(/count: (\d+)/.exec(m)?.[1] ?? 1), slot: Number(/Slot: (-?\d+)b/.exec(m)?.[1]) }) }
  if (/No entity/.test(r[0]?.reply)) P('WARN bag: no entity', name)
  return { stacks: b.length, items: sum(b), list: b.map(x => `${x.id}x${x.count}`).join(' ') } }

// ---------- bots
let T, Wk
function mk (name) {
  const b = mineflayer.createBot({ host: HOST, port: PORT, username: name, version: '1.21.8', auth: 'offline' })
  b.on('error', e => P(name, 'bot_error', String(e?.message)))
  b.on('kicked', r => P(name, 'kicked', String(r)))
  return b
}
const collects = []
async function connect () {
  if ((await r1('list')).match(/There are (\d+)/)?.[1] !== '0') throw new Error('sandbox3 busy: ' + await r1('list'))
  T = mk(TN); await new Promise(r => T.once('spawn', r)); await sleep(1500)
  Wk = mk(WN); await new Promise(r => Wk.once('spawn', r)); await sleep(1500)
  Wk.loadPlugin(pathfinder)
  for (const b of [T, Wk]) {
    b.on('playerCollect', (collector, collected) => { if (collected?.name === 'item' || collected?.type === 'object') collects.push({ t: Date.now(), who: collector?.username, eid: collected?.id }) })
  }
  P('connected; Paper', (await r1('version')).split('\n')[0])
}
async function tp (bot, name, x, y, z, yaw = 0, pitch = 0) {
  await rcon(`tp ${name} ${x} ${y} ${z} ${yaw} ${pitch}`)
  const tgt = new Vec3(Number(x), Number(y), Number(z))
  for (let i = 0; i < 40; i++) { if (bot.entity.position.distanceTo(tgt) < 0.05) break; await sleep(100) }
  await sleep(400)
  return bot.entity.position.clone()
}
const tdAt = (w) => T.blockAt(new Vec3(w.x, G, w.z))
async function setTrapdoor (bot, w, open) {
  const blk = bot.blockAt(new Vec3(w.x, G, w.z))
  const was = blk.getProperties().open
  if (was !== open) { await bot.activateBlock(blk); await sleep(500) }
  const cl = bot.blockAt(new Vec3(w.x, G, w.z)).getProperties()
  const sv = await r1(`execute if block ${w.x} ${G} ${w.z} oak_trapdoor[open=${open}]`)
  return { clientOpen: cl.open, server: sv.trim() }
}

// ---------- ballistics (vanilla Player.drop, as toss.py) to choose pitch for distance d
function landDist (pdeg, rnd) {
  const p = pdeg * Math.PI / 180
  const a = rnd ? Math.random() * 2 * Math.PI : 0, m = rnd ? 0.02 * Math.random() : 0
  let vx = Math.cos(p) * 0.3 + Math.cos(a) * m, vy = -Math.sin(p) * 0.3 + 0.1 + (rnd ? (Math.random() - Math.random()) * 0.1 : 0)
  let x = 0, y = 1.32
  for (let t = 0; t < 200; t++) { vy -= 0.04; const nx = x + vx, ny = y + vy; if (ny <= 0) { const f = y / (y - ny); return x + (nx - x) * f } x = nx; y = ny; vx *= 0.98; vy *= 0.98 }
  return null
}
function wellPitch (d) {
  let best = null
  for (let p = 20; p <= 85; p += 0.5) {
    let ok = 0; const N = 3000
    for (let i = 0; i < N; i++) { const x = landDist(p, true); if (x >= d - 0.375 && x <= d + 0.1875) ok++ }
    if (!best || ok > best.ok) best = { p, ok, frac: ok / N }
  }
  return best
}

// ---------- straight-line walker
async function walkTo (bot, x, z, { jump = false, timeout = 4000, tol = 0.25 } = {}) {
  const end = Date.now() + timeout
  let minY = bot.entity.position.y
  bot.setControlState('sprint', false)
  while (Date.now() < end) {
    const p = bot.entity.position; minY = Math.min(minY, p.y)
    const dx = x - p.x, dz = z - p.z
    if (Math.hypot(dx, dz) < tol) break
    await bot.lookAt(new Vec3(x, p.y + 1.62, z), true)
    bot.setControlState('forward', true); bot.setControlState('jump', jump)
    await sleep(50)
  }
  bot.clearControlStates()
  await sleep(150)
  minY = Math.min(minY, bot.entity.position.y)
  return { reached: Math.hypot(x - bot.entity.position.x, z - bot.entity.position.z) < tol + 0.2, minY }
}

const JUNK = ['cobblestone', 'dirt', 'granite', 'diorite', 'andesite', 'gravel', 'flint', 'clay_ball', 'egg', 'cobbled_deepslate', 'tuff', 'netherrack',
  'rotten_flesh', 'bone', 'string', 'feather', 'gunpowder', 'wheat_seeds', 'calcite', 'sand', 'pointed_dripstone', 'ink_sac', 'dead_bush', 'rail']
const maxOf = id => id === 'egg' ? 16 : 64
async function fillThrower (types) {
  const cmds = [`clear ${TN}`]
  types.forEach((id, i) => cmds.push(`item replace entity ${TN} inventory.${i} with ${id} ${maxOf(id)}`))
  await rcon(...cmds); await sleep(800)
}
async function tossAll (bot, aim) {
  const tossed = []
  for (const it of bot.inventory.items().filter(i => JUNK.includes(i.name))) {
    if (aim) { await aim(); await sleep(120) }
    try { await bot.tossStack(it); tossed.push(`${it.name}x${it.count}`) } catch (e) { P('toss error', String(e?.message)) }
    await sleep(250)
  }
  return tossed
}
function aimAt (bot, w, pitchDeg) {
  return async () => {
    const e = bot.entity.position.offset(0, 1.62, 0)
    const cx = w.x + 0.5, cz = w.z + 0.5
    const h = Math.hypot(cx - e.x, cz - e.z); const ux = (cx - e.x) / h, uz = (cz - e.z) / h
    const p = pitchDeg * Math.PI / 180
    await bot.lookAt(e.offset(ux * Math.cos(p) * 5, -Math.sin(p) * 5, uz * Math.cos(p) * 5), true)
  }
}

// ======================= phases
const phases = {}
phases.setup = async () => {
  const fq = await r1('forceload query'); P('forceload before:', fq)
  const pre = await rcon(`forceload add ${AR.x0} ${AR.z0} ${AR.x1} ${AR.z1}`)
  await sleep(2000)
  const same = await r1(`execute if blocks ${AR.x0} ${AR.y0} ${AR.z0} ${AR.x1} ${AR.y1} ${AR.z1} ${AR.x0} 280 ${AR.z0} all`)
  P('arena empty-check (vs y280 air):', same)
  const r = await rcon(
    `fill ${AR.x0} ${G - 3} ${AR.z0} ${AR.x1} ${G} ${AR.z1} stone`,
    `fill ${AR.x0} ${G + 1} ${AR.z0} ${AR.x1} ${AR.y1} ${AR.z1} air`,
    `setblock ${W1.x} ${G - 1} ${W1.z} air`, `setblock ${W1.x} ${G} ${W1.z} oak_trapdoor[facing=north,half=top,open=false]`,
    `setblock ${W2.x} ${G - 1} ${W2.z} air`, `setblock ${W2.x} ${G} ${W2.z} oak_trapdoor[facing=north,half=top,open=false]`,
    `setblock ${PILLAR.x} ${G + 1} ${PILLAR.z} stone`, `setblock ${PILLAR.x} ${G + 2} ${PILLAR.z} stone`,
    `kill ${SEL}`)
  P('build:', r.map(x => x.reply.slice(0, 70)))
  P('verify W1:', (await rcon(`execute if block ${W1.x} ${G} ${W1.z} oak_trapdoor[half=top,open=false,facing=north]`, `execute if block ${W1.x} ${G - 1} ${W1.z} air`, `execute if block ${W1.x} ${G - 2} ${W1.z} stone`, `execute if block ${W1.x} ${G - 1} ${W1.z} stone`)).map(x => x.cmd.split(' ').slice(-1)[0] + ' -> ' + x.reply))
}

phases.s0 = async () => {
  P('=== S0 CONTROL: 20 stacks tossed onto open ground from a 2-high pillar; walker sweeps')
  await rcon(`kill ${SEL}`, `clear ${WN}`, `gamemode survival ${TN}`, `gamemode survival ${WN}`)
  await tp(Wk, WN, 1488.5, G + 1, 1504.5)
  const tpos = await tp(T, TN, PILLAR.x + 0.5, G + 3, PILLAR.z + 0.5, -90, 0)
  P('thrower on pillar at', String(tpos))
  const types = JUNK.slice(0, 20)
  await fillThrower(types)
  const tb0 = await bag(TN), wb0 = await bag(WN)
  P('thrower bag before', tb0.stacks, tb0.items, ' walker bag before', wb0.stacks, wb0.items)
  // throw east (+x) and slightly up so they spread on the ground 2..4 blocks out
  let k = 0
  const tossed = await tossAll(T, async () => { const off = ((k++ % 5) - 2) * 0.8; const e = T.entity.position.offset(0, 1.62, 0); await T.lookAt(e.offset(5, 0.5, off), true) })
  P('tossed', tossed.length, tossed.join(' '))
  await sleep(2600)
  const c0 = await wellCensus(W1)
  P('after toss census:', { entities: c0.entities, selectorCount: c0.selectorCount, items: c0.inItems + c0.outItems, ys: [...new Set(c0.outs.map(e => e.y.toFixed(2)))] })
  const tb1 = await bag(TN); P('thrower bag after toss', tb1.stacks, tb1.items)
  // walker visits each item position (client-side entity positions)
  const n0 = collects.length
  for (let pass = 0; pass < 3; pass++) {
    const its = Object.values(Wk.entities).filter(e => e.name === 'item' && e.position.distanceTo(Wk.entity.position) < 30)
    if (!its.length) break
    its.sort((a, b) => a.position.x - b.position.x || a.position.z - b.position.z)
    for (const e of its) { if (!Wk.entities[e.id]) continue; await walkTo(Wk, e.position.x, e.position.z, { timeout: 5000, tol: 0.3 }) }
    await sleep(800)
  }
  await sleep(1500)
  const wb1 = await bag(WN), c1 = await wellCensus(W1)
  P('S0 RESULT walker bag after:', wb1.stacks, 'stacks', wb1.items, 'items |', wb1.list)
  P('S0 RESULT items left on ground:', short(c1), ' walker playerCollect events:', new Set(collects.slice(n0).filter(c => c.who === WN).map(c => c.eid)).size)
  await rcon(`kill ${SEL}`, `clear ${WN}`, `clear ${TN}`)
}

let lastTossGT = null
phases.s1 = async () => {
  P('=== S1 ACCURACY: 60 stacks from 5 stands (12 each), trapdoor opened/closed by the thrower via activateBlock')
  await rcon(`kill ${SEL}`, `clear ${TN}`)
  await tp(Wk, WN, 1510.5, G + 1, 1510.5)
  // stands: axial distance d north of the well centre, lateral offset l (x)
  const stands = [{ d: 1.0, l: 0 }, { d: 1.15, l: 0 }, { d: 0.85, l: 0 }, { d: 1.0, l: 0.25 }, { d: 1.0, l: -0.25 }]
  let total = { tossedStacks: 0, tossedItems: 0, inWellItems: 0, missesStacks: 0 }
  const per = []
  let typeIdx = 0
  for (const s of stands) {
    const dist = Math.hypot(s.d, s.l)
    const wp = wellPitch(dist)
    const x = W1.x + 0.5 + s.l, z = W1.z + 0.5 - s.d
    const pos = await tp(T, TN, x.toFixed(3), G + 1, z.toFixed(3), 0, 0)
    const types = []; for (let i = 0; i < 12; i++) types.push(JUNK[(typeIdx++) % JUNK.length])
    await fillThrower(types)
    const before = await wellCensus(W1); const tb0 = await bag(TN)
    const op = await setTrapdoor(T, W1, true)
    const shapeOpen = T.blockAt(new Vec3(W1.x, G, W1.z)).shapes
    const tossed = await tossAll(T, aimAt(T, W1, wp.p))
    const rot = await r1(`data get entity ${TN} Rotation`)
    await sleep(2500)
    const mid = await wellCensus(W1)
    lastTossGT = await gametime()
    // misses: anything outside the shaft. Thrower retakes: it is usually already inside its own box; else walk to it.
    const missesNow = mid.outs.map(e => `${e.id}x${e.count}@${e.x.toFixed(2)},${e.y.toFixed(2)},${e.z.toFixed(2)}`)
    let retake = null
    if (mid.outs.length) {
      await sleep(2000)
      for (const e of Object.values(T.entities).filter(e => e.name === 'item' && e.position.y > G + 0.5 && e.position.distanceTo(T.entity.position) < 8)) await walkTo(T, e.position.x, e.position.z, { timeout: 4000 })
      await sleep(1000)
      const c = await wellCensus(W1); retake = { outAfterRetake: c.outItems, outEnt: c.outEnt }
      await tp(T, TN, x.toFixed(3), G + 1, z.toFixed(3), 0, 0)
    }
    const cl = await setTrapdoor(T, W1, false)
    const after = await wellCensus(W1); const tb1 = await bag(TN)
    const row = { stand: s, dist: +dist.toFixed(3), pitch: wp.p, simInOpening: +wp.frac.toFixed(3), thrower: `${pos.x.toFixed(3)},${pos.y.toFixed(2)},${pos.z.toFixed(3)}`, serverRotation: rot.replace(/^.*data: /, ''),
      open: op, openShape: shapeOpen, close: cl, tossedStacks: tossed.length, tossedItems: tb0.items - tb1.items, throwerBagLeft: tb1.list,
      wellItemsBefore: before.inItems, wellItemsAfter: mid.inItems, landedItems: mid.inItems - before.inItems, missesAt2_5s: missesNow, retake, wellItemsAfterClose: after.inItems, outsideAfterClose: after.outItems }
    per.push(row); P('S1 stand', row)
    total.tossedStacks += tossed.length; total.tossedItems += row.tossedItems; total.inWellItems = after.inItems; total.missesStacks += mid.outs.length
  }
  await tp(T, TN, 1506.5, G + 1, 1496.5)
  const fin = await wellCensus(W1)
  P('S1 RESULT', total, 'final census', short(fin))
  P('S1 raw scoreboard/count replies', fin.raw, 'gametime at last toss+2.5s', lastTossGT)
  fs.writeFileSync(OUT + '.s1.json', JSON.stringify({ per, total, lastTossGT }, null, 1))
}

// isolation: walker crosses over the closed trapdoor and rim; also stands on the rim with the trapdoor open
phases.s2 = async () => {
  P('=== S2 ISOLATION')
  await rcon(`clear ${WN}`)
  const c0 = await wellCensus(W1); const wb0 = await bag(WN)
  P('S2 start census', short(c0), 'walker bag', wb0.stacks, wb0.items)
  if (c0.inItems === 0) throw new Error('no items in the well; S2 needs a loaded well')
  const n0 = collects.length
  const cx = W1.x + 0.5, cz = W1.z + 0.5
  const log = []
  // (a) OPEN trapdoor, walker at the rim (tp to overhanging positions; not falling)
  await tp(T, TN, cx, G + 1, cz - 1.0, 0, 0)
  P('S2a open:', await setTrapdoor(T, W1, true))
  const rimSpots = [[cx + 0.55, cz], [cx, cz + 0.55], [cx - 0.55, cz], [cx + 0.55, cz + 0.55], [cx - 0.55, cz + 0.55]]
  for (const [x, z] of rimSpots) {
    const p = await tp(Wk, WN, x.toFixed(3), G + 1, z.toFixed(3))
    let minY = p.y
    for (let j = 0; j < 4; j++) { Wk.setControlState('jump', true); await sleep(400); Wk.setControlState('jump', false); await sleep(600); minY = Math.min(minY, Wk.entity.position.y) }
    const hd = Math.hypot(Wk.entity.position.x - cx, Wk.entity.position.z - cz)
    log.push({ open: true, at: `${Wk.entity.position.x.toFixed(2)},${Wk.entity.position.y.toFixed(2)},${Wk.entity.position.z.toFixed(2)}`, hdist: +hd.toFixed(2), minY })
    if (minY < G + 0.9) P('WALKER FELL at rim spot', x, z, minY)
  }
  const bOpen = await bag(WN); const cOpen = await wellCensus(W1)
  P('S2a RESULT open-rim spots', log, 'walker bag', bOpen.stacks, bOpen.items, 'well', short(cOpen))
  P('S2a close:', await setTrapdoor(T, W1, false))
  await tp(T, TN, 1508.5, G + 1, 1490.5)
  // (b) 200 passes over the closed trapdoor / rim
  await tp(Wk, WN, cx - 1.8, G + 1, cz)
  let passes = 0, minYAll = 999
  const ring = [[cx - 1, cz - 1], [cx + 1, cz - 1], [cx + 1, cz + 1], [cx - 1, cz + 1]]
  const plan = []
  for (let i = 0; i < 70; i++) plan.push(i % 2 ? ['x', false] : ['z', false])
  for (let i = 0; i < 40; i++) plan.push(i % 2 ? ['x', true] : ['z', true])
  for (let i = 0; i < 30; i++) plan.push(['diag', i % 3 === 0])
  for (let i = 0; i < 60; i++) plan.push(['ring', i % 4 === 0])
  let dir = 1, ri = 0
  for (const [kind, jump] of plan) {
    let r
    if (kind === 'x') { await walkTo(Wk, cx - 1.6 * dir, cz, { timeout: 3000 }); r = await walkTo(Wk, cx + 1.6 * dir, cz, { jump, timeout: 3000 }) } else if (kind === 'z') { await walkTo(Wk, cx, cz - 1.6 * dir, { timeout: 3000 }); r = await walkTo(Wk, cx, cz + 1.6 * dir, { jump, timeout: 3000 }) } else if (kind === 'diag') { await walkTo(Wk, cx - 1.3 * dir, cz - 1.3 * dir, { timeout: 3000 }); r = await walkTo(Wk, cx + 1.3 * dir, cz + 1.3 * dir, { jump, timeout: 3000 }) } else { const [x, z] = ring[ri++ % 4]; r = await walkTo(Wk, x, z, { jump, timeout: 3000 }) }
    dir = -dir; passes++; minYAll = Math.min(minYAll, r.minY)
    if (passes % 50 === 0) { const b = await bag(WN); const c = await wellCensus(W1); P(`S2b after ${passes} passes: walker bag ${b.stacks}/${b.items}; well`, short(c), 'minY', minYAll) }
  }
  // (c) stand on the trapdoor 30 s (with jumps), then each of the 8 rim blocks 3 s
  await walkTo(Wk, cx, cz, { timeout: 3000, tol: 0.15 })
  const onTd = Wk.entity.position.clone()
  for (let j = 0; j < 30; j++) { if (j % 5 === 0) { Wk.setControlState('jump', true); await sleep(300); Wk.setControlState('jump', false); await sleep(700) } else await sleep(1000) }
  P('S2c stood 30 s on trapdoor at', String(onTd), 'feet y now', Wk.entity.position.y)
  for (const [dx, dz] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) { await walkTo(Wk, cx + dx, cz + dz, { timeout: 3000, tol: 0.15 }); await sleep(3000) }
  const wb1 = await bag(WN); const c1 = await wellCensus(W1)
  const wc = new Set(collects.slice(n0).filter(c => c.who === WN).map(c => c.eid)).size
  P('S2 RESULT passes', passes, 'minY over passes', minYAll, '| walker bag after', wb1.stacks, wb1.items, wb1.list, '| walker playerCollect events', wc, '| well', short(c1))
  fs.writeFileSync(OUT + '.s2.json', JSON.stringify({ c0: short(c0), c1: short(c1), wb0, wb1, passes, minYAll, openRim: log, wc }, null, 1))
}

// S2 rerun: the first S2's stand/rim part ran after the items had despawned. Here item Age is reset to 0 (harness) so the well stays loaded.
const resetAges = async () => (await rcon(`execute as ${SHAFT(W1)} run data modify entity @s Age set value 0s`, `execute if entity ${SHAFT(W1)}`)).map(x => x.reply.trim()).pop()
phases.s2r = async () => {
  P('=== S2r ISOLATION RERUN (20 stacks, ages held below 6000 by RCON reset)')
  await rcon(`clear ${WN}`, `kill ${SEL}`)
  const cx = W1.x + 0.5, cz = W1.z + 0.5
  await tp(Wk, WN, 1510.5, G + 1, 1510.5)
  const pitch = wellPitch(1.0).p
  for (let v = 0; v < 2; v++) {
    await tp(T, TN, cx, G + 1, cz - 1.0, 0, 0)
    await fillThrower(JUNK.slice(v * 10, v * 10 + 10))
    await setTrapdoor(T, W1, true); await tossAll(T, aimAt(T, W1, pitch)); await sleep(2500); await setTrapdoor(T, W1, false)
  }
  await tp(T, TN, 1508.5, G + 1, 1490.5)
  const c0 = await wellCensus(W1); const wb0 = await bag(WN); const tb = await bag(TN)
  P('S2r start census', short(c0), 'walker bag', wb0.stacks, wb0.items, 'thrower bag left', tb.list)
  if (!c0.inEnt) throw new Error('S2r: no items in the well')
  const n0 = collects.length
  P('S2r age reset ->', await resetAges())
  // (c) stand on the trapdoor 30 s with jumps, then each of the 8 rim blocks 3 s
  await tp(Wk, WN, cx - 1.8, G + 1, cz)
  await walkTo(Wk, cx, cz, { timeout: 3000, tol: 0.15 })
  const onTd = Wk.entity.position.clone()
  for (let j = 0; j < 30; j++) { if (j % 5 === 0) { Wk.setControlState('jump', true); await sleep(300); Wk.setControlState('jump', false); await sleep(700) } else await sleep(1000) }
  P('S2r stood 30 s on closed trapdoor at', String(onTd), 'feet y now', Wk.entity.position.y)
  const rim = []
  for (const [dx, dz] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) { await walkTo(Wk, cx + dx, cz + dz, { timeout: 3000, tol: 0.15 }); rim.push(`${Wk.entity.position.x.toFixed(2)},${Wk.entity.position.y.toFixed(2)},${Wk.entity.position.z.toFixed(2)}`); await sleep(3000) }
  let b = await bag(WN); let c = await wellCensus(W1)
  P('S2r after stand+rim: walker bag', b.stacks, b.items, 'rim spots', rim, 'well', short(c))
  P('S2r age reset ->', await resetAges())
  let passes = 0, minYAll = 999
  const ring = [[cx - 1, cz - 1], [cx + 1, cz - 1], [cx + 1, cz + 1], [cx - 1, cz + 1]]
  const plan = []
  for (let i = 0; i < 70; i++) plan.push(i % 2 ? ['x', false] : ['z', false])
  for (let i = 0; i < 40; i++) plan.push(i % 2 ? ['x', true] : ['z', true])
  for (let i = 0; i < 30; i++) plan.push(['diag', i % 3 === 0])
  for (let i = 0; i < 60; i++) plan.push(['ring', i % 4 === 0])
  let dir = 1, ri = 0
  for (const [kind, jump] of plan) {
    let r
    if (kind === 'x') { await walkTo(Wk, cx - 1.6 * dir, cz, { timeout: 3000 }); r = await walkTo(Wk, cx + 1.6 * dir, cz, { jump, timeout: 3000 }) } else if (kind === 'z') { await walkTo(Wk, cx, cz - 1.6 * dir, { timeout: 3000 }); r = await walkTo(Wk, cx, cz + 1.6 * dir, { jump, timeout: 3000 }) } else if (kind === 'diag') { await walkTo(Wk, cx - 1.3 * dir, cz - 1.3 * dir, { timeout: 3000 }); r = await walkTo(Wk, cx + 1.3 * dir, cz + 1.3 * dir, { jump, timeout: 3000 }) } else { const [x, z] = ring[ri++ % 4]; r = await walkTo(Wk, x, z, { jump, timeout: 3000 }) }
    dir = -dir; passes++; minYAll = Math.min(minYAll, r.minY)
    if (passes % 50 === 0) { b = await bag(WN); c = await wellCensus(W1); P(`S2r after ${passes} passes: walker bag ${b.stacks}/${b.items}; well`, short(c), 'minY', minYAll, 'reset ->', await resetAges()) }
  }
  const wb1 = await bag(WN); const c1 = await wellCensus(W1)
  const wc = new Set(collects.slice(n0).filter(c => c.who === WN).map(c => c.eid)).size
  P('S2r RESULT passes', passes, 'minY', minYAll, '| walker bag after', wb1.stacks, wb1.items, wb1.list, '| walker pickups (client events)', wc, '| well', short(c1))
}

// despawn: read in-well ages + gametime until the well is empty
phases.s3 = async () => {
  P('=== S3 DESPAWN (bots stay near; forceload also on)')
  await tp(Wk, WN, W1.x + 3.5, G + 1, W1.z + 0.5)
  for (let i = 0; i < 80; i++) {
    const gt = await gametime(); const c = await wellCensus(W1)
    P('S3 gt', gt, 'inEnt', c.inEnt, 'inItems', c.inItems, 'ages', c.inAges.join(','), 'outItems', c.outItems)
    if (c.inEnt === 0) { P('S3 RESULT well empty at gt', gt); break }
    const maxAge = c.inAges[c.inAges.length - 1]
    await sleep(Math.max(3000, Math.min(30000, (6000 - maxAge) * 50 - 2000)))
  }
}

// unload: fresh stacks, then both bots disconnect for 120 s, then rejoin and read ages vs gametime. Control: 60 s with bots present.
phases.s3b = async () => {
  P('=== S3b NO-PLAYER AGE TEST (forceload removed for this test)')
  await rcon(`forceload remove ${AR.x0} ${AR.z0} ${AR.x1} ${AR.z1}`)
  P('forceload now:', await r1('forceload query'))
  await tp(T, TN, W1.x + 0.5, G + 1, W1.z - 0.5, 0, 0)
  await fillThrower(['cobblestone', 'dirt', 'granite'])
  await setTrapdoor(T, W1, true)
  await tossAll(T, aimAt(T, W1, wellPitch(1.0).p))
  await sleep(2000); await setTrapdoor(T, W1, false)
  await tp(T, TN, W1.x + 0.5, G + 1, W1.z - 3.5)
  const read = async tag => { const gt = await gametime(); const c = await wellCensus(W1); const r = { tag, gt, inEnt: c.inEnt, inItems: c.inItems, ageMinMax: c.inAges, raw: c.raw }; P('S3b', r); return r }
  const a0 = await read('control start (bots present)'); await sleep(60000); const a1 = await read('control end')
  P('S3b CONTROL age delta per entity vs gametime delta', a1.gt - a0.gt)
  T.quit('away'); Wk.quit('away'); await sleep(3000)
  P('S3b both bots disconnected; list:', await r1('list'))
  const gAway = await gametime()
  const probe = await r1(`execute if entity ${SEL}`)
  P('S3b while away: selector', probe)
  await sleep(120000)
  const gBack0 = await gametime()
  P('S3b away window gametime', gAway, '->', gBack0)
  await connect()
  await sleep(3000)
  const a2 = await read('after rejoin')
  P('S3b RESULT: control window gt', a1.gt - a0.gt, '; total gt since control end', a2.gt - a1.gt, '; away gt', gBack0 - gAway)
  await rcon(`forceload add ${AR.x0} ${AR.z0} ${AR.x1} ${AR.z1}`)
}

// pathfinding hazard on W2 (empty well)
phases.s4 = async () => {
  P('=== S4 PATHFINDING HAZARD on W2 (empty), fleet travel Movements: canDig=false, allow1by1towers=true, allowParkour=false, maxDropDown=6, placeCost=5')
  await rcon(`clear ${WN}`)
  await tp(T, TN, W2.x + 0.5, G + 1, W2.z - 0.5, 0, 0)
  const mv = new Movements(Wk)
  mv.canDig = false; mv.allow1by1towers = true; mv.allowParkour = false; mv.maxDropDown = 6; mv.placeCost = 5
  Wk.pathfinder.setMovements(mv)
  const run = async (label, sx, gx, z) => {
    await tp(Wk, WN, sx + 0.5, G + 1, z + 0.5)
    let minY = Wk.entity.position.y; let crossed = false
    const iv = setInterval(() => { const p = Wk.entity.position; minY = Math.min(minY, p.y); if (Math.floor(p.x) === W2.x && Math.floor(p.z) === W2.z) crossed = true }, 50)
    const path = Wk.pathfinder.getPathTo(mv, new goals.GoalBlock(gx, G + 1, z), 3000)
    const throughWell = (path.path || []).some(n => Math.floor(n.x) === W2.x && Math.floor(n.z) === W2.z)
    const nodes = (path.path || []).map(n => `${n.x},${n.y},${n.z}`).join(' ')
    let res = 'ok'
    try { await Promise.race([Wk.pathfinder.goto(new goals.GoalBlock(gx, G + 1, z)), sleep(12000).then(() => { throw new Error('timeout 12s') })]) } catch (e) { res = String(e?.message ?? e) }
    if (res !== 'ok') Wk.pathfinder.setGoal(null)
    clearInterval(iv); await sleep(300)
    const end = Wk.entity.position
    const r = { label, planStatus: path.status, planCrossesWellCell: throughWell, planLen: (path.path || []).length, nodes, result: res, enteredCell: crossed, minY: +minY.toFixed(3), fellIn: minY < G + 0.5, end: `${end.x.toFixed(2)},${end.y.toFixed(2)},${end.z.toFixed(2)}` }
    P('S4', r)
    if (r.fellIn || Wk.entity.position.y < G + 0.9) await tp(Wk, WN, W2.x - 4.5, G + 1, W2.z + 0.5)
    return r
  }
  const rows = []
  // corridor along x through W2: walls at z=W2.z-1 and W2.z+1, two high
  await rcon(`fill ${W2.x - 5} ${G + 1} ${W2.z - 1} ${W2.x + 5} ${G + 2} ${W2.z - 1} stone`, `fill ${W2.x - 5} ${G + 1} ${W2.z + 1} ${W2.x + 5} ${G + 2} ${W2.z + 1} stone`)
  // the thrower would sit in the wall; move it beside the corridor end
  await tp(T, TN, W2.x - 6.5, G + 1, W2.z - 3.5)
  for (const open of [false, true]) {
    await rcon(`setblock ${W2.x} ${G} ${W2.z} oak_trapdoor[facing=north,half=top,open=${open}]`); await sleep(600)
    P('S4 set W2 open=', open, 'server:', await r1(`execute if block ${W2.x} ${G} ${W2.z} oak_trapdoor[open=${open}]`), 'client open:', Wk.blockAt(new Vec3(W2.x, G, W2.z)).getProperties().open, 'client shapes', Wk.blockAt(new Vec3(W2.x, G, W2.z)).shapes)
    for (let i = 0; i < 4; i++) rows.push(await run(`corridor ${open ? 'OPEN' : 'closed'} #${i + 1}`, i % 2 ? W2.x + 4 : W2.x - 4, i % 2 ? W2.x - 4 : W2.x + 4, W2.z))
  }
  // open field: remove the walls, trapdoor open, straight-line goal across the well row
  await rcon(`fill ${W2.x - 5} ${G + 1} ${W2.z - 1} ${W2.x + 5} ${G + 2} ${W2.z - 1} air`, `fill ${W2.x - 5} ${G + 1} ${W2.z + 1} ${W2.x + 5} ${G + 2} ${W2.z + 1} air`)
  for (let i = 0; i < 4; i++) rows.push(await run(`open-field OPEN #${i + 1}`, i % 2 ? W2.x + 4 : W2.x - 4, i % 2 ? W2.x - 4 : W2.x + 4, W2.z))
  await rcon(`setblock ${W2.x} ${G} ${W2.z} oak_trapdoor[facing=north,half=top,open=false]`)
  fs.writeFileSync(OUT + '.s4.json', JSON.stringify(rows, null, 1))
}

phases.s4b = async () => {
  P('=== S4b OPEN trapdoor: z-axis crossings (perpendicular to the flap) and goal ON the well cell')
  await rcon(`clear ${WN}`)
  await tp(T, TN, W2.x - 6.5, G + 1, W2.z - 3.5)
  const mv = new Movements(Wk)
  mv.canDig = false; mv.allow1by1towers = true; mv.allowParkour = false; mv.maxDropDown = 6; mv.placeCost = 5
  Wk.pathfinder.setMovements(mv)
  const run = async (label, sx, sz, goal) => {
    await tp(Wk, WN, sx + 0.5, G + 1, sz + 0.5)
    let minY = Wk.entity.position.y
    const iv = setInterval(() => { minY = Math.min(minY, Wk.entity.position.y) }, 50)
    const path = Wk.pathfinder.getPathTo(mv, goal, 3000)
    const nodes = (path.path || []).map(n => `${n.x},${n.y},${n.z}`).join(' ')
    let res = 'ok'
    try { await Promise.race([Wk.pathfinder.goto(goal), sleep(12000).then(() => { throw new Error('timeout 12s') })]) } catch (e) { res = String(e?.message ?? e) }
    if (res !== 'ok') Wk.pathfinder.setGoal(null)
    await sleep(1500); minY = Math.min(minY, Wk.entity.position.y); clearInterval(iv)
    const end = Wk.entity.position
    const r = { label, planStatus: path.status, nodes, result: res, minY: +minY.toFixed(3), fellIn: minY < G + 0.5, end: `${end.x.toFixed(2)},${end.y.toFixed(2)},${end.z.toFixed(2)}` }
    P('S4b', r)
    if (Wk.entity.position.y < G + 0.9) await tp(Wk, WN, W2.x - 4.5, G + 1, W2.z + 0.5)
    return r
  }
  await rcon(`setblock ${W2.x} ${G} ${W2.z} oak_trapdoor[facing=north,half=top,open=true]`,
    `fill ${W2.x - 1} ${G + 1} ${W2.z - 5} ${W2.x - 1} ${G + 2} ${W2.z + 5} stone`, `fill ${W2.x + 1} ${G + 1} ${W2.z - 5} ${W2.x + 1} ${G + 2} ${W2.z + 5} stone`)
  await sleep(600)
  P('S4b W2 open:', await r1(`execute if block ${W2.x} ${G} ${W2.z} oak_trapdoor[open=true]`), 'client shapes', Wk.blockAt(new Vec3(W2.x, G, W2.z)).shapes)
  for (let i = 0; i < 4; i++) await run(`z-corridor OPEN #${i + 1}`, W2.x, i % 2 ? W2.z + 4 : W2.z - 4, new goals.GoalBlock(W2.x, G + 1, i % 2 ? W2.z - 4 : W2.z + 4))
  for (let i = 0; i < 2; i++) await run(`z-corridor OPEN goal=well cell #${i + 1}`, W2.x, i % 2 ? W2.z + 4 : W2.z - 4, new goals.GoalBlock(W2.x, G + 1, W2.z))
  await rcon(`fill ${W2.x - 1} ${G + 1} ${W2.z - 5} ${W2.x - 1} ${G + 2} ${W2.z + 5} air`, `fill ${W2.x + 1} ${G + 1} ${W2.z - 5} ${W2.x + 1} ${G + 2} ${W2.z + 5} air`)
  for (let i = 0; i < 2; i++) await run(`open-field OPEN goal=well cell from west #${i + 1}`, W2.x - 4, W2.z, new goals.GoalBlock(W2.x, G + 1, W2.z))
  await rcon(`setblock ${W2.x} ${G} ${W2.z} oak_trapdoor[facing=north,half=top,open=false]`)
}

phases.s5 = async () => {
  P('=== S5 MOB SPACE')
  await tp(Wk, WN, W2.x + 2.5, G + 1, W2.z + 0.5)
  const closed = Wk.blockAt(new Vec3(W2.x, G, W2.z))
  const air = Wk.blockAt(new Vec3(W2.x, G - 1, W2.z))
  const open = Wk.blockAt(new Vec3(W1.x, G, W1.z))
  P('S5 closed trapdoor props', closed.getProperties(), 'shapes', closed.shapes, '| shaft cell light: sky', air.skyLight, 'block', air.light, '| surface cell sky', Wk.blockAt(new Vec3(W2.x + 2, G + 1, W2.z)).skyLight)
  const r = await rcon('difficulty easy',
    `summon creeper ${W2.x + 0.5} ${G - 1} ${W2.z + 0.5} {NoAI:1b,PersistenceRequired:1b,Tags:["wellprobe"]}`,
    `summon zombie ${W2.x + 0.5} ${G - 1} ${W2.z + 0.5} {NoAI:1b,PersistenceRequired:1b,Tags:["wellprobe"]}`)
  P('S5 summon', r.map(x => x.reply))
  await sleep(3000)
  const q = await rcon(`execute as @e[tag=wellprobe] run data get entity @s Pos`, `execute as @e[tag=wellprobe] run data get entity @s Health`,
    `execute positioned ${W2.x + 0.5} ${G - 1} ${W2.z + 0.5} if entity @e[type=creeper,tag=wellprobe,dx=0,dy=0,dz=0]`)
  P('S5 probe', q.map(x => `${x.cmd} => ${x.reply}`))
  P('S5 cleanup', (await rcon('kill @e[tag=wellprobe]', 'difficulty peaceful', 'difficulty')).map(x => x.reply))
}

phases.census = async () => { const c = await wellCensus(W1); P('census', short(c), c.raw) }

phases.cleanup = async () => {
  const r = await rcon('scoreboard objectives remove wc', 'scoreboard objectives remove wa', `kill ${SEL}`, `fill ${AR.x0} ${AR.y0} ${AR.z0} ${AR.x1} ${AR.y1} ${AR.z1} air`, `execute if blocks ${AR.x0} ${AR.y0} ${AR.z0} ${AR.x1} ${AR.y1} ${AR.z1} ${AR.x0} 280 ${AR.z0} all`,
    `clear ${TN}`, `clear ${WN}`, `forceload remove ${AR.x0} ${AR.z0} ${AR.x1} ${AR.z1}`, 'forceload query', 'difficulty')
  P('cleanup', r.map(x => `${x.cmd} => ${x.reply.slice(0, 120)}`))
}

try {
  if (PHASES.some(p => !['setup', 'cleanup', 'census'].includes(p))) await connect()
  for (const ph of PHASES) { if (!phases[ph]) throw new Error('no phase ' + ph); await phases[ph]() }
} catch (e) { P('FATAL', String(e?.stack ?? e)) }
try { T?.quit('done'); Wk?.quit('done') } catch {}
await sleep(1000)
out.end(); setTimeout(() => process.exit(0), 300)
