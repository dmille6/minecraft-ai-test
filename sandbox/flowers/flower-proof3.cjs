// SANDBOX-ONLY flowers-02 proof (lawn scatter): the density a bone meal leaves on a town LAWN in taiga, with a dirt path and a cobble
// path through its spread (never a plant on a path), a sparse lawn, a second meal on the same centre, two centres 8 apart. Counts by
// ring from the bot's view of the server's chunk, the totals checked by the server (destructive fill-replace). Part a header follows.
// SANDBOX-ONLY flower-supply proof (flowers-01, owner 11-07: "lawns with flowers and tall grass, paths edged with flowers"; design
// docs/reports/flowers-design-2026-11-07.md section "Paper"). Paper 1.21.8 + mineflayer, the bots' own effects (bots/src/buildbot.mjs
// botBuildEffects: hold, look, the block_place click and its acknowledgement, dig, walk), as skills.mjs decorClick / decorNursery use them.
//   BOT_ROOT=<checkout with bots/node_modules> SBX=sandbox5 node sandbox/flowers/flower-proof.cjs
//   (lock first: sandbox/sbxlock.sh take sandbox5 flowers "...", release after)
// Every count is read from the SERVER: plants by a destructive `fill ... air replace <name>` over the arena (its "Successfully filled N"
// is the count; the arena is rebuilt before every trial), the bag by `clear <name> 0`, a block by `execute if block`.
//   M1  bone meal on the centre of a FRESH open 31x31 grass arena in TAIGA (the showcase town's biome), 8 trials: flowers (which names),
//       short grass, tall grass, ferns -- the yield a meal on clear grass
//   M2  the same on a PATCHY arena (every other cell of a checkerboard is podzol): the yield when a nursery's ground is broken
//   M3  four meals on ONE centre with nothing cleared between them (the live nursery's case when its spread is not cleared), then the
//       same four meals with every plant in the spread dug between meals: flowers a meal in each case
//   M4  one meal each in snowy_taiga, plains and meadow (which flowers a biome gives)
//   B1  bone meal on a placed POPPY: is the meal spent? does a poppy item or a new poppy appear?
//   B2  bone meal on a placed LILAC (a tall flower): a lilac item dropped?
//   B3  bone meal on SHORT GRASS: tall grass?
//   S1  shears on tall grass: what drops (short_grass x2?); the bare hand on short grass (seeds or nothing)
//   C1  the composter: 40 ferns inserted one at a time (activateBlock, the compost skill's call), the bone meal taken out each time it
//       is ready -- bone meal per fern; then 40 short grass the same way
//   P1  a poppy picked by hand (dig) -> the item; replanted on grass, podzol, coarse dirt, dirt (the border soils)
//   P2  a poppy placed by the click on the grass's top face where a FERN stands (a fern border cell upgraded): the fern replaced?
// Setup in the sandbox only (the owner's no-admin-edit rule is for the bots' worlds): forceload, fill, fillbiome, give, tp.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { pathfinder, Movements } = req('mineflayer-pathfinder')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const REG = require('../sandboxes.json')
const SERVER = process.env.SBX || 'sandbox8', PORT = REG.servers[SERVER].port, NAME = 'sbx-Flora', TAG = 'flowers'
const SSH = ['-o', 'BatchMode=yes', 'mike@' + REG.host]
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0].reply
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const X = 6200, G = 140, Z = 6200, H = 15
const R = {}
const isBlock = (x, y, z, name) => /Test passed/.test(r1(`execute if block ${x} ${y} ${z} minecraft:${name}`))
const countIn = name => +(r1(`clear ${NAME} minecraft:${name} 0`).match(/Found (\d+)/)?.[1] ?? 0)
const SMALL = ['poppy', 'dandelion', 'cornflower', 'azure_bluet', 'oxeye_daisy', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'allium', 'lily_of_the_valley', 'blue_orchid', 'torchflower', 'wildflowers', 'pink_petals']
const TALLS = ['tall_grass', 'large_fern', 'lilac', 'rose_bush', 'peony', 'sunflower']
const OTHER = ['short_grass', 'fern', 'bush', 'firefly_bush', 'leaf_litter', 'dead_bush', 'sweet_berry_bush']
/** Count (and remove) every plant over the arena's plant layer, by name, from the server. */
function harvestCount () {
  const box = `${X - H} ${G + 1} ${Z - H} ${X + H} ${G + 1} ${Z + H}`
  const cmds = [...TALLS.map(n => `fill ${box} minecraft:air replace minecraft:${n}[half=lower]`), ...SMALL.map(n => `fill ${box} minecraft:air replace minecraft:${n}`), ...OTHER.map(n => `fill ${box} minecraft:air replace minecraft:${n}`)]
  const names = [...TALLS, ...SMALL, ...OTHER]
  const out = {}
  rcon(...cmds).forEach((q, i) => { const m = q.reply.match(/filled (\d+)/); if (m && +m[1] > 0) out[names[i]] = +m[1] })
  // the upper halves the lower fills left floating (they pop) are cleared with the layer above
  rcon(`fill ${X - H} ${G + 2} ${Z - H} ${X + H} ${G + 2} ${Z + H} minecraft:air`, `kill @e[type=item,x=${X - H - 4},y=${G - 4},z=${Z - H - 4},dx=40,dy=20,dz=40]`)
  return out
}
const flowersOf = c => SMALL.reduce((s, n) => s + (c[n] ?? 0), 0)
function arena (biome = 'taiga', patchy = false) {
  const r = rcon(`fill ${X - H - 2} ${G - 2} ${Z - H - 2} ${X + H + 2} ${G + 8} ${Z + H + 2} minecraft:air`,
    `fill ${X - H - 2} ${G - 2} ${Z - H - 2} ${X + H + 2} ${G - 1} ${Z + H + 2} minecraft:dirt`,
    `fill ${X - H} ${G} ${Z - H} ${X + H} ${G} ${Z + H} minecraft:grass_block`,
    `fillbiome ${X - H - 2} ${G - 2} ${Z - H - 2} ${X + H + 2} ${G + 8} ${Z + H + 2} minecraft:${biome}`,
    `kill @e[type=item,x=${X - H - 4},y=${G - 4},z=${Z - H - 4},dx=40,dy=20,dz=40]`)
  if (patchy) {
    const cmds = []
    for (let dx = -H; dx <= H; dx++) for (let dz = -H; dz <= H; dz++) if ((dx + dz) % 2 !== 0 && (dx || dz)) cmds.push(`setblock ${X + dx} ${G} ${Z + dz} minecraft:podzol`)
    rcon(...cmds)
  }
  return r.filter(x => /not loaded|Cannot|Unknown|Incorrect|Too many|Expected/i.test(x.reply))
}

async function main () {
  requireSandboxLock(SERVER, TAG)
  const { botBuildEffects } = await import(path.resolve(BOT_ROOT, 'bots/src/buildbot.mjs'))
  rcon(`forceload add ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`, 'time set 1000', 'gamerule doDaylightCycle false', 'gamerule randomTickSpeed 0', 'difficulty peaceful')
  R.setup = arena('taiga')
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  const PLANTS = new Set([...SMALL, ...TALLS, ...OTHER])
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`, `give ${NAME} minecraft:bone_meal 64`, `give ${NAME} minecraft:short_grass 64`)
    await sleep(3000)
    await bot.waitForChunksToLoad()
    const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
    bot.pathfinder.setMovements(mv)
    const e = botBuildEffects(bot, { keep: {}, aborted: () => false })
    const click = async (at, item) => { if (!(await e.hold(item))) return 'no_item'; await e.look(at, [0, 1, 0]); const seq = e.nextSeq(); e.send(at, [0, 1, 0], seq); return (await e.waitAck(seq, 2000)) === 'acked' ? 'acked' : 'silent' }
    const stand = async (x, z) => { try { await e.walkTo([x, G + 1, z]) } catch (err) { P('walk', String(err)) } await sleep(300) }
    const meal = async (cx, cz) => { const m0 = countIn('bone_meal'); const v = await click([cx, G, cz], 'bone_meal'); await sleep(1200); return { click: v, spent: m0 - countIn('bone_meal') } }
    /** the plants around a centre by Chebyshev ring, and on a path row: the bot's view of the server's chunk */
    const view = (cx, cz, isPath = () => false) => {
      const ring = [0, 0, 0, 0, 0, 0, 0, 0, 0], names = {}
      let onPath = 0, landing = 0, far = 0
      for (let dx = -9; dx <= 9; dx++) for (let dz = -9; dz <= 9; dz++) {
        const x = cx + dx, z = cz + dz, d = Math.max(Math.abs(dx), Math.abs(dz))
        const n = bot.blockAt(new Vec3(x, G + 1, z))?.name ?? ''
        const g = bot.blockAt(new Vec3(x, G, z))?.name ?? ''
        if (d <= 7 && g === 'grass_block') landing++
        if (!PLANTS.has(n)) continue
        names[n] = (names[n] ?? 0) + 1
        if (isPath(x, z)) onPath++
        if (d <= 8) ring[d]++; else far++
      }
      const plants = ring.reduce((a, b) => a + b, 0)
      return { plants, ring, onPath, far, landing, density: +(plants / Math.max(1, landing)).toFixed(3), names }
    }
    // L1: a dirt path row at dz=+3 and a cobble path column at dx=-4 through the spread, 6 fresh lawns
    R.L1 = []
    for (let t = 0; t < 6; t++) {
      arena('taiga')
      rcon(`fill ${X - 9} ${G} ${Z + 3} ${X + 9} ${G} ${Z + 3} minecraft:dirt_path`, `fill ${X - 4} ${G} ${Z - 9} ${X - 4} ${G} ${Z + 9} minecraft:cobblestone`)
      await stand(X + 1, Z + 1)
      const m = await meal(X, Z)
      const v = view(X, Z, (x, z) => z === Z + 3 || x === X - 4)
      const beyond = (() => { let n = 0; for (let dx = -9; dx <= 9; dx++) for (let dz = 4; dz <= 9; dz++) if (PLANTS.has(bot.blockAt(new Vec3(X + dx, G + 1, Z + dz))?.name ?? '')) n++; return n })()
      const srv = harvestCount()
      R.L1.push({ ...m, ...v, beyondDirtPath: beyond, server: Object.values(srv).reduce((a, b) => a + b, 0) })
      P('L1', t, R.L1.at(-1))
    }
    // L2: a sparse lawn (9 short grass within 7, ~4%: the showcase's measured 4.1%), 3 meals on fresh copies
    R.L2 = []
    for (let t = 0; t < 3; t++) {
      arena('taiga')
      const seedCells = [[3, 1], [-5, 2], [6, -6], [-2, -4], [1, 6], [-6, -1], [4, 4], [-3, 5], [5, -2]]
      rcon(...seedCells.map(([dx, dz]) => `setblock ${X + dx} ${G + 1} ${Z + dz} minecraft:short_grass`))
      await stand(X + 1, Z + 1)
      await sleep(500)
      const v0 = view(X, Z)
      const m = await meal(X, Z)
      const v1 = view(X, Z)
      harvestCount()
      R.L2.push({ ...m, before: v0.plants, after: v1.plants, added: v1.plants - v0.plants, density: v1.density, ring: v1.ring })
      P('L2', t, R.L2.at(-1))
    }
    // L3: a SECOND meal on the same centre (its centre plant dug first: the refusal otherwise), 3 lawns
    R.L3 = []
    for (let t = 0; t < 3; t++) {
      arena('taiga')
      await stand(X + 1, Z + 1)
      const m1 = await meal(X, Z)
      const v1 = view(X, Z)
      rcon(`setblock ${X} ${G + 1} ${Z} minecraft:air`)
      await sleep(500)
      const m2 = await meal(X, Z)
      const v2 = view(X, Z)
      harvestCount()
      R.L3.push({ m1, m2, after1: v1.plants, after2: v2.plants, density1: v1.density, density2: v2.density })
      P('L3', t, R.L3.at(-1))
    }
    // L4: two centres 8 apart, one meal each: the plants on the 31x31 lawn and the densest 15x15 window's count
    R.L4 = []
    for (let t = 0; t < 2; t++) {
      arena('taiga')
      await stand(X - 4 + 1, Z + 1)
      const a = await meal(X - 4, Z)
      await stand(X + 4 + 1, Z + 1)
      const b = await meal(X + 4, Z)
      const va = view(X - 4, Z), vb = view(X + 4, Z), vm = view(X, Z)
      R.L4.push({ a, b, plantsA: va.plants, plantsB: vb.plants, mid: vm.plants, densityMid: vm.density, server: Object.values(harvestCount()).reduce((x, y) => x + y, 0) })
      P('L4', t, R.L4.at(-1))
    }
  } finally {
    try { bot.quit() } catch { /* gone */ }
    try { rcon('gamerule randomTickSpeed 3', `forceload remove ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`) } catch { /* best effort */ }
  }
  const avg = a => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(3) : null
  R.summary = {
    L1: { onPath: (R.L1 ?? []).map(x => x.onPath), plants: avg((R.L1 ?? []).map(x => x.plants)), density: avg((R.L1 ?? []).map(x => x.density)), beyondDirtPath: (R.L1 ?? []).map(x => x.beyondDirtPath), viewVsServer: (R.L1 ?? []).map(x => [x.plants + x.far, x.server]) },
    L2: { added: avg((R.L2 ?? []).map(x => x.added)), density: avg((R.L2 ?? []).map(x => x.density)) },
    L3: { density1: avg((R.L3 ?? []).map(x => x.density1)), density2: avg((R.L3 ?? []).map(x => x.density2)), spent2: (R.L3 ?? []).map(x => x.m2.spent) },
    L4: { densityMid: avg((R.L4 ?? []).map(x => x.densityMid)) },
  }
  const line = JSON.stringify({ at: new Date().toISOString(), server: SERVER, proof: 'flowers-02', ...R })
  fs.appendFileSync(path.join(__dirname, 'flower-proof.jsonl'), line + '\n')
  P('SUMMARY', R.summary)
}
main().catch(e => { console.error('FAILED', e); process.exit(1) })
