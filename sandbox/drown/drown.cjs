// SANDBOX-ONLY drowning-clock + escape-primitive timing driver. Bare mineflayer, no bot code.
//   node drown.cjs <server> <out.jsonl> <plan>      plan = "A_full:3,A_sat0:2,A_easy:2,B3_1:3,..."
// RCON goes out as "@@RCON {json}" lines on stdout; replies come back on stdin (relay.py).
'use strict'
const NM = '/home/mike/mbench-cl/tree/bots/node_modules/'
const mineflayer = require(NM + 'mineflayer')
const { Vec3 } = require(NM + 'vec3')
const fs = require('fs'); const readline = require('readline')
const [SERVER, OUT, PLAN] = process.argv.slice(2)
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601 }
if (!PORTS[SERVER]) throw new Error('sandbox/sandbox2/sandbox3 only')
const NAME = 'sandbox-Drown'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => process.stderr.write(new Date().toISOString().slice(11, 23) + ' ' + a.join(' ') + '\n')

// ------------------------------------------------------------------ rcon over the relay
let rid = 0; const pending = new Map()
readline.createInterface({ input: process.stdin }).on('line', l => {
  let m; try { m = JSON.parse(l) } catch { return }
  const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m) }
})
function rcon (...cmds) {
  for (const c of cmds) {   // arena guard: every fill/setblock stays inside the arena box
    const m = c.match(/^(fill|setblock) (-?\d+) (-?\d+) (-?\d+)(?: (-?\d+) (-?\d+) (-?\d+))?/)
    if (m) { const v = m.slice(2).filter(Boolean).map(Number); for (let i = 0; i < v.length; i += 3) if (v[i] < 692 || v[i] > 708 || v[i + 1] < 30 || v[i + 1] > 52 || v[i + 2] < 692 || v[i + 2] > 708) throw new Error('outside arena: ' + c) }
  }
  return new Promise((res, rej) => {
    const id = ++rid; const sent = Date.now()
    pending.set(id, m => res({ sent, recv: Date.now(), ts: m.ts, replies: m.replies }))
    process.stdout.write('@@RCON ' + JSON.stringify({ id, cmds }) + '\n')
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('rcon timeout')) } }, 20000)
  })
}
const num = s => { const m = (s || '').match(/data: (-?[\d.]+)/); return m ? +m[1] : null }
const passed = s => /Test passed/.test(s || '')

// ------------------------------------------------------------------ scenes (feet cell 700 40 700, floor y 39)
const X = 700, Z = 700, F = 40
const SCENES = {
  p112: ['fill 700 40 700 700 41 700 minecraft:water'],                                 // sealed 1x1x2
  p332: ['fill 699 40 699 701 41 701 minecraft:water'],                                 // sealed 3x3x2
  p113: ['fill 700 40 700 700 42 700 minecraft:water', 'fill 699 44 699 701 47 701 minecraft:air'], // 1x1x3, ceiling 43, air room above
  col1: ['fill 700 40 700 700 41 700 minecraft:water', 'fill 699 43 699 701 47 701 minecraft:air'], // ceiling 42 (1 thick)
  col2: ['fill 700 40 700 700 41 700 minecraft:water', 'fill 699 44 699 701 47 701 minecraft:air'], // ceiling 42-43
  col3: ['fill 700 40 700 700 41 700 minecraft:water', 'fill 699 45 699 701 48 701 minecraft:air'], // ceiling 42-44
}
const ARMS = {
  A_full: { scene: 'p112', diff: 'peaceful', sat: 'full', secs: 200 },
  A_sat0: { scene: 'p112', diff: 'peaceful', sat: 'zero', secs: 200 },
  A_hungry: { scene: 'p112', diff: 'peaceful', sat: 'held0', secs: 200 },  // hunger effect held through the trial
  A_easy: { scene: 'p112', diff: 'easy', sat: 'full', secs: 120 },
  B1: { scene: 'p112', diff: 'peaceful', sat: 'full', secs: 60, act: 'digUp', n: 1 },      // ceiling at 42, stone above (sealed)
  B2: { scene: 'p113', diff: 'peaceful', sat: 'full', secs: 60, act: 'digFloat' },         // floating under ceiling 43
  B3_1: { scene: 'col1', diff: 'peaceful', sat: 'full', secs: 60, act: 'column', n: 1 },
  B3_2: { scene: 'col2', diff: 'peaceful', sat: 'full', secs: 60, act: 'column', n: 2 },
  B3_3: { scene: 'col3', diff: 'peaceful', sat: 'full', secs: 60, act: 'column', n: 3 },
  B4_112: { scene: 'p112', diff: 'peaceful', sat: 'full', secs: 40, act: 'bucket' },
  B4_332: { scene: 'p332', diff: 'peaceful', sat: 'full', secs: 40, act: 'bucket' },
  B5_332: { scene: 'p332', diff: 'peaceful', sat: 'full', secs: 40, act: 'place' },
}

// ------------------------------------------------------------------ the client
let bot; const clientEv = []
function connect () {
  return new Promise((res, rej) => {
    bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, version: '1.21.8', auth: 'offline' })
    bot.once('spawn', () => res())
    bot.once('error', e => rej(e)); bot.once('kicked', r => log('KICKED', JSON.stringify(r)))
    bot._client.on('update_health', p => clientEv.push({ t: Date.now(), k: 'hp', health: p.health, food: p.food, sat: p.foodSaturation }))
    bot._client.on('entity_metadata', p => {
      if (!bot.entity || p.entityId !== bot.entity.id) return
      for (const m of p.metadata) if (m.key === 1) clientEv.push({ t: Date.now(), k: 'air', raw: m.value, ox: bot.oxygenLevel })
    })
    bot._client.on('entity_metadata', p => {
      if (!bot.entity || p.entityId === bot.entity.id) return
      for (const m of p.metadata) if (m.key === 1) clientEv.push({ t: Date.now(), k: 'foreignAir', eid: p.entityId, name: bot.entities[p.entityId]?.name, raw: m.value })
    })
    bot.on('death', () => clientEv.push({ t: Date.now(), k: 'death' }))
    bot.on('respawn', () => clientEv.push({ t: Date.now(), k: 'respawn' }))
  })
}
function clientSample () {
  const e = bot.entity
  return { t: Date.now(), hp: bot.health, food: bot.food, sat: bot.foodSaturation, ox: bot.oxygenLevel, alive: bot.isAlive,
    y: e ? +e.position.y.toFixed(3) : null, og: e ? e.onGround : null, eye: bot._getBlockAtEyeLevel?.()?.name ?? null }
}

// ------------------------------------------------------------------ the server oracle
function pollCmds (extra = []) {
  return ['time query gametime', `data get entity ${NAME} Health`, `data get entity ${NAME} Air`, `data get entity ${NAME} foodLevel`,
    `data get entity ${NAME} foodSaturationLevel`, `data get entity ${NAME} foodExhaustionLevel`, `data get entity ${NAME} Pos`,
    `data get entity ${NAME} OnGround`, `execute at ${NAME} if block ~ ~1.62 ~ minecraft:water`, ...extra]
}
async function poll (extra = []) {
  const r = await rcon(...pollCmds(extra)); const R = r.replies
  const pos = ((R[6] || '').match(/\[([^\]]+)\]/) || [])[1]
  return { ts: r.ts[0], cs: r.sent, cr: r.recv, gt: +((R[0] || '').match(/(\d+)/) || [])[1], hp: num(R[1]), air: num(R[2]), food: num(R[3]), sat: num(R[4]), exh: num(R[5]),
    y: pos ? +(+pos.split(',')[1].replace('d', '')).toFixed(3) : null, og: num(R[7]), eyeWater: passed(R[8]),
    extra: R.slice(9).map(passed), gone: /No entity was found/.test(R[1] || ''), c: clientSample() }
}

async function waitAlive () {
  for (let i = 0; i < 100 && !(bot.isAlive && bot.health > 0); i++) { if (!bot.isAlive) bot.respawn(); await sleep(200) }
  await sleep(1000)
}

// ------------------------------------------------------------------ actions (bare mineflayer)
const acts = []
async function digAt (p, label, polls) {
  const blk = bot.blockAt(p)
  const rec = { label, pos: `${p.x},${p.y},${p.z}`, cname: blk?.name, cDigTime: blk ? bot.digTime(blk) : null, cOnGround: bot.entity.onGround,
    cEye: bot._getBlockAtEyeLevel()?.name, t0: Date.now(), heldItem: bot.heldItem?.name }
  // server oracle runs in parallel: done when the server says the block is air
  let srvDone = null; let stop = false
  const watcher = (async () => { while (!stop) { const r = await rcon(`execute if block ${p.x} ${p.y} ${p.z} minecraft:air`); if (passed(r.replies[0])) { srvDone = r.ts[0]; rec.srvDoneLocal = r.recv; break } await sleep(80) } })()
  try { await bot.dig(blk, true); rec.ok = true } catch (e) { rec.err = String(e.message).slice(0, 120) }
  rec.tClient = Date.now()
  for (let i = 0; i < 100 && srvDone == null; i++) await sleep(100)   // up to 10 s more for the server to agree
  stop = true; await watcher.catch(() => {})
  rec.srvDoneTs = srvDone; rec.clientSecs = (rec.tClient - rec.t0) / 1000
  rec.srvSecs = rec.srvDoneLocal ? (rec.srvDoneLocal - rec.t0) / 1000 : null
  acts.push(rec); log('  dig', label, JSON.stringify(rec))
  return rec
}

async function doAction (arm, ctx) {
  const pick = bot.inventory.items().find(i => i.name === 'stone_pickaxe')
  if (arm.act === 'digUp' || arm.act === 'column') {
    await bot.equip(pick, 'hand')
    const n = arm.n
    const r1 = await digAt(new Vec3(X, F + 2, Z), 'ceil0-from-floor')
    bot.setControlState('jump', true)
    for (let k = 1; k < n; k++) {
      // wait until the next block is the first solid above the eye (the bot has risen)
      await digAt(new Vec3(X, F + 2 + k, Z), `ceil${k}`)
    }
    ctx.allDug = Date.now()
  } else if (arm.act === 'digFloat') {
    await bot.equip(pick, 'hand')
    bot.setControlState('jump', true)
    for (let i = 0; i < 40 && bot.entity.position.y < F + 1.1; i++) await sleep(100)   // pressed against the ceiling
    ctx.floatY = bot.entity.position.y; ctx.floatOG = bot.entity.onGround
    await digAt(new Vec3(X, F + 3, Z), 'ceil-floating')
    ctx.allDug = Date.now()
  } else if (arm.act === 'bucket') {
    const b = bot.inventory.items().find(i => i.name === 'bucket')
    await bot.equip(b, 'hand')
    await bot.look(bot.entity.yaw, Math.PI / 2, true)    // straight UP: a hit can only be the head cell's own source
    await sleep(150)
    ctx.useT = Date.now()
    bot.activateItem()
    await sleep(200); bot.deactivateItem()
    await sleep(600)
    ctx.heldAfter = bot.heldItem?.name
    ctx.allDug = Date.now()
  } else if (arm.act === 'place') {
    const c = bot.inventory.items().find(i => i.name === 'cobblestone')
    await bot.equip(c, 'hand')
    const ref = bot.blockAt(new Vec3(X + 2, F + 1, Z))   // stone wall beyond the water cell 701 41 700
    ctx.useT = Date.now()
    try { await bot.placeBlock(ref, new Vec3(-1, 0, 0)); ctx.placeOk = true } catch (e) { ctx.placeErr = String(e.message).slice(0, 120) }
    ctx.placeSecs = (Date.now() - ctx.useT) / 1000
    ctx.allDug = Date.now()
  }
}

// ------------------------------------------------------------------ one trial
async function trial (armName, k) {
  const arm = ARMS[armName]
  await waitAlive()
  bot.clearControlStates()
  acts.length = 0
  await rcon(`gamemode spectator ${NAME}`, `tp ${NAME} 700.5 60 700.5`)
  await sleep(2500)
  const build = await rcon(`kill @e[type=item,x=700,y=40,z=700,distance=..30]`, 'fill 692 30 692 708 52 708 minecraft:stone', 'fill 704 40 704 704 41 704 minecraft:air', ...SCENES[arm.scene])
  const bad = build.replies.filter(x => /not loaded|Cannot place|Unknown|Incorrect|Too many|outside/i.test(x))
  if (bad.length) throw new Error('arena: ' + bad.join(' | '))
  await rcon(`clear ${NAME}`, `item replace entity ${NAME} container.0 with minecraft:stone_pickaxe[damage=31] 1`,
    `item replace entity ${NAME} container.1 with minecraft:cobblestone 64`, `item replace entity ${NAME} container.2 with minecraft:bucket 1`, `effect clear ${NAME}`)
  const diffBefore = (await rcon('difficulty')).replies[0]
  if (!new RegExp(arm.diff, 'i').test(diffBefore)) await rcon(`difficulty ${arm.diff}`)
  const pre = []
  if (arm.sat === 'zero' || arm.sat === 'held0') {
    // dry cell, survival, hunger 255 until the server says saturation 0
    await rcon(`tp ${NAME} 704.5 40 704.5`, `gamemode survival ${NAME}`, `effect give ${NAME} minecraft:instant_health 1 5 true`, `effect give ${NAME} minecraft:hunger 300 255 true`)
    for (let i = 0; i < 60; i++) { const p = await poll(); pre.push(p); if (p.sat === 0) break; await sleep(250) }
    if (arm.sat === 'zero') await rcon(`effect clear ${NAME} minecraft:hunger`)
    await rcon(`gamemode spectator ${NAME}`)   // spectator: no air loss while it is moved into the pocket
    await sleep(300)
  }
  const enter = [`tp ${NAME} 700.5 40 700.5`, `gamemode survival ${NAME}`]
  if (arm.sat === 'full') enter.push(`effect give ${NAME} minecraft:saturation 1 20 true`)
  enter.push(`effect give ${NAME} minecraft:instant_health 1 5 true`)
  enter.push('time query gametime')
  const e = await rcon(...enter)
  const t0 = e.ts[1]; const gt0 = +(e.replies[enter.length - 1].match(/(\d+)/) || [])[1]; const t0local = e.recv
  log(`${armName}#${k} submerged gt0=${gt0} diff=${arm.diff}`)
  const evStart = clientEv.length
  const polls = []; const ctx = {}
  let actStarted = false; let actPromise = null; let headAirAt = null
  const extra = arm.act ? [`execute if block 700 41 700 minecraft:air`, `execute if block 700 40 700 minecraft:air`, `execute if block 701 41 700 minecraft:cobblestone`, `execute if block 700 41 700 minecraft:water`] : []
  const period = arm.act ? 150 : 500
  let deathAt = null; let endAfter = null
  while (true) {
    let p; try { p = await poll(extra) } catch (err) { log('poll err', err.message); await sleep(period); continue }
    p.dt = (p.ts - t0) / 1000; p.dgt = (p.gt - gt0) / 20
    polls.push(p)
    if (arm.act && !actStarted && p.air != null && p.air <= 0) {
      actStarted = true; ctx.actT0 = Date.now(); ctx.actGt = p.gt; ctx.hpAtStart = p.hp; ctx.ogAtStart = p.og
      log(`  act ${arm.act} at dgt=${p.dgt} hp=${p.hp} og=${p.og}`)
      actPromise = doAction(arm, ctx).catch(err => { ctx.actErr = String(err.message).slice(0, 160); log('act err', err.message) })
    }
    const prevAir = polls.length > 1 ? polls[polls.length - 2].air : null
    if (actStarted && headAirAt == null && p.hp > 0 && !p.gone && p.gt > ctx.actGt && prevAir != null && p.air > prevAir && p.air > 0) { headAirAt = p; ctx.headAir = { dgt: p.dgt, sinceAct: (p.gt - ctx.actGt) / 20, hp: p.hp, air: p.air, y: p.y } ; log('  head in air', JSON.stringify(ctx.headAir)); endAfter = Date.now() + 4000 }
    if ((p.hp != null && p.hp <= 0) || p.gone || !bot.isAlive) { deathAt = p; break }
    if (endAfter && Date.now() > endAfter && (!actPromise || ctx.allDug)) break
    if (p.dt > arm.secs) break
    await sleep(period)
  }
  if (actPromise) await Promise.race([actPromise, sleep(15000)])
  bot.clearControlStates()
  const res = { arm: armName, k, server: SERVER, diff: arm.diff, scene: arm.scene, t0, t0local, gt0, pre, polls, ctx, acts: [...acts], clientEv: clientEv.slice(evStart),
    died: !!deathAt, deathDgt: deathAt ? deathAt.dgt : null }
  // restore peaceful IMMEDIATELY after an easy trial
  if (arm.diff !== 'peaceful') { const r = await rcon('difficulty peaceful'); res.restored = r.replies[0] }
  fs.appendFileSync(OUT, JSON.stringify(res) + '\n')
  const air0 = polls.find(p => p.air != null && p.air <= 0)
  log(`${armName}#${k} done died=${res.died} air0@${air0?.dgt} death@${res.deathDgt} headAir=${JSON.stringify(ctx.headAir || null)} acts=${acts.length}`)
  // leave the bot safe: spectator above the arena
  await waitAlive()
  await rcon(`gamemode spectator ${NAME}`, `tp ${NAME} 700.5 60 700.5`, `effect clear ${NAME}`)
}

;(async () => {
  const l0 = await rcon('list'); if (!/There are 0 of/.test(l0.replies[0])) throw new Error('server not empty: ' + l0.replies[0])
  const d0 = (await rcon('difficulty')).replies[0]; log('difficulty before:', d0)
  if (!/Peaceful/.test(d0)) throw new Error('expected peaceful at start; refusing')
  await connect(); log('connected; entity', bot.entity.id)
  await sleep(1500)
  try {
    for (const item of PLAN.split(',')) {
      const [a, n] = item.split(':')
      if (!ARMS[a]) throw new Error('unknown arm ' + a)
      for (let k = 0; k < Number(n || 1); k++) {
        try { await trial(a, k) } catch (err) { log('TRIAL ERR', a, k, err.stack); await rcon('difficulty peaceful') }
      }
    }
  } finally {
    const r = await rcon('difficulty peaceful', 'difficulty', `kill @e[type=item,x=700,y=40,z=700,distance=..30]`, 'fill 692 30 692 708 52 708 minecraft:stone')
    log('final:', r.replies.join(' | '))
    bot.quit(); await sleep(1500)
    process.exit(0)
  }
})().catch(async e => { log('FATAL', e.stack); try { await rcon('difficulty peaceful') } catch {} ; process.exit(1) })
