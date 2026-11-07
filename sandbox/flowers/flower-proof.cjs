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
const SERVER = process.env.SBX || 'sandbox5', PORT = REG.servers[SERVER].port, NAME = 'sbx-Flora', TAG = 'flowers'
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
  const s0 = rcon(`forceload add ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`, 'time set 1000', 'gamerule doDaylightCycle false', 'gamerule randomTickSpeed 0', 'difficulty peaceful')
  R.setup = arena('taiga')
  P('setup', s0.map(x => x.reply).join(' | '), R.setup)
  const bot = mineflayer.createBot({ host: REG.host, port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  bot.loadPlugin(pathfinder)
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  P('spawned', bot.version)
  try {
    rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${G + 1} ${Z + 0.5}`,
      `give ${NAME} minecraft:bone_meal 64`, `give ${NAME} minecraft:shears 1`, `give ${NAME} minecraft:poppy 8`, `give ${NAME} minecraft:lilac 1`,
      `give ${NAME} minecraft:fern 40`, `give ${NAME} minecraft:short_grass 40`, `give ${NAME} minecraft:composter 1`)
    await sleep(3000)
    await bot.waitForChunksToLoad()
    const mv = new Movements(bot); mv.canDig = false; mv.allow1by1towers = false; mv.scafoldingBlocks = []
    bot.pathfinder.setMovements(mv)
    const e = botBuildEffects(bot, { keep: {}, aborted: () => false })
    const click = async (at, item, face = [0, 1, 0]) => {
      if (!(await e.hold(item))) return 'no_item'
      await e.look(at, face)
      const seq = e.nextSeq()
      e.send(at, face, seq)
      return (await e.waitAck(seq, 2000)) === 'acked' ? 'acked' : 'silent'
    }
    const stand = async (x, z) => { try { await e.walkTo([x, G + 1, z]) } catch (err) { P('walk', String(err)) } await sleep(300) }
    const meal = async () => { const m0 = countIn('bone_meal'); const v = await click([X, G, Z], 'bone_meal'); await sleep(1200); return { click: v, spent: m0 - countIn('bone_meal') } }

    // M1: 8 fresh taiga meals
    R.M1 = []
    for (let t = 0; t < 8; t++) {
      if (t) arena('taiga')
      await stand(X + 1, Z + 1)
      const m = await meal()
      const c = harvestCount()
      R.M1.push({ ...m, flowers: flowersOf(c), c })
      P('M1', t, R.M1.at(-1))
    }
    // M2: 4 patchy taiga meals
    R.M2 = []
    for (let t = 0; t < 4; t++) {
      arena('taiga', true)
      await stand(X + 1, Z + 1)
      const m = await meal()
      const c = harvestCount()
      R.M2.push({ ...m, flowers: flowersOf(c), c })
      P('M2', t, R.M2.at(-1))
    }
    // M3: four meals on one centre, nothing cleared between (count = the plants standing after each meal, by the client's view of the
    // server's chunk; the final count by the server), then four meals with the spread cleared between meals (server counts)
    arena('taiga')
    await stand(X + 1, Z + 1)
    R.M3 = { uncleared: [], cleared: [] }
    const view = () => { let fl = 0, gr = 0; for (let dx = -H; dx <= H; dx++) for (let dz = -H; dz <= H; dz++) { const b = bot.blockAt(new Vec3(X + dx, G + 1, Z + dz)); const n = b?.name ?? ''; if (SMALL.includes(n)) fl++; else if (n && n !== 'air') gr++ } return { fl, gr } }
    let prev = { fl: 0, gr: 0 }
    for (let t = 0; t < 4; t++) {
      const m = await meal()
      await sleep(800)
      const v = view()
      R.M3.uncleared.push({ ...m, newFlowers: v.fl - prev.fl, newOther: v.gr - prev.gr, standing: v })
      prev = v
    }
    R.M3.uncleared.push({ server: harvestCount() })
    for (let t = 0; t < 4; t++) {
      if (t) arena('taiga')
      await stand(X + 1, Z + 1)
      // the "cleared" case is a fresh arena every meal by construction: harvestCount removes every plant -- the same as a full clear
      const m = await meal()
      const c = harvestCount()
      R.M3.cleared.push({ ...m, flowers: flowersOf(c), c })
    }
    P('M3', R.M3)
    // M4: other biomes
    R.M4 = {}
    for (const b of ['snowy_taiga', 'plains', 'meadow']) {
      arena(b)
      await stand(X + 1, Z + 1)
      const m = await meal()
      R.M4[b] = { ...m, c: harvestCount() }
      P('M4', b, R.M4[b])
    }
    arena('taiga')
    await stand(X, Z)
    // B1: bone meal on a placed poppy
    {
      const at = [X + 2, G, Z]
      await click(at, 'poppy')
      await sleep(700)
      const placed = isBlock(X + 2, G + 1, Z, 'poppy')
      const m0 = countIn('bone_meal'), p0 = countIn('poppy')
      const v = await click([X + 2, G + 1, Z], 'bone_meal')
      await sleep(1500)
      const c = harvestCount()
      R.B1 = { placed, click: v, spent: m0 - countIn('bone_meal'), poppyItems: [p0, countIn('poppy')], plants: c }
      P('B1', R.B1)
    }
    // B2: bone meal on a placed lilac (two blocks tall)
    {
      await click([X + 2, G, Z], 'lilac')
      await sleep(700)
      const placed = isBlock(X + 2, G + 1, Z, 'lilac[half=lower]') && isBlock(X + 2, G + 2, Z, 'lilac[half=upper]')
      const m0 = countIn('bone_meal')
      const v = await click([X + 2, G + 1, Z], 'bone_meal')
      await sleep(2500)
      R.B2 = { placed, click: v, spent: m0 - countIn('bone_meal'), lilacItems: countIn('lilac'), still: isBlock(X + 2, G + 1, Z, 'lilac') }
      P('B2', R.B2)
      harvestCount()
    }
    // B3: bone meal on short grass -> tall grass
    {
      await click([X + 2, G, Z], 'short_grass')
      await sleep(700)
      const placed = isBlock(X + 2, G + 1, Z, 'short_grass')
      const m0 = countIn('bone_meal')
      const v = await click([X + 2, G + 1, Z], 'bone_meal')
      await sleep(1200)
      R.B3 = { placed, click: v, spent: m0 - countIn('bone_meal'), tall: isBlock(X + 2, G + 1, Z, 'tall_grass[half=lower]') && isBlock(X + 2, G + 2, Z, 'tall_grass[half=upper]') }
      P('B3', R.B3)
    }
    // S1: shears on that tall grass; the bare hand on short grass
    {
      const sg0 = countIn('short_grass'), tg0 = countIn('tall_grass')
      await e.hold('shears')
      const dv = R.B3.tall ? await e.dig([X + 2, G + 1, Z], 'tall_grass') : 'no_tall'
      await sleep(1500)
      R.S1 = { dig: dv, shortGrass: [sg0, countIn('short_grass')], tallGrass: [tg0, countIn('tall_grass')], gone: isBlock(X + 2, G + 1, Z, 'air') }
      // bare hand: 6 short grass placed and broken without shears (seeds 1 in 8 each: a count, not a pass)
      const seeds0 = countIn('wheat_seeds'), sgA = countIn('short_grass')
      for (let i = 0; i < 6; i++) { await click([X + 2, G, Z - 2 + i], 'short_grass'); await sleep(250) }
      await sleep(600)
      const sgB = countIn('short_grass')
      rcon(`clear ${NAME} minecraft:shears`)
      let broke = 0
      for (let i = 0; i < 6; i++) { const at = [X + 2, G + 1, Z - 2 + i]; if (isBlock(...at, 'short_grass')) { const v = await e.dig(at, 'short_grass'); if (v === 'confirmed') broke++ } await sleep(250) }
      await sleep(1500)
      rcon(`give ${NAME} minecraft:shears 1`)
      R.S1.hand = { placed: sgA - sgB, broke, shortGrassBack: countIn('short_grass') - sgB, seeds: countIn('wheat_seeds') - seeds0 }
      P('S1', R.S1)
      harvestCount()
    }
    // C1: the composter -- ferns, then short grass
    {
      const cAt = [X - 3, G + 1, Z]
      await click([X - 3, G, Z], 'composter')
      await sleep(700)
      const placed = isBlock(...cAt, 'composter')
      const run = async (item, n) => {
        const out = { item, inserted: 0, meal: 0, raises: 0 }
        const meal0 = countIn('bone_meal')
        let lvl = 0
        for (let i = 0; i < n; i++) {
          const have = countIn(item)
          if (!have) break
          // ready (level 8): the next use takes the bone meal out
          if (isBlock(...cAt, 'composter[level=8]')) { await click(cAt, item); await sleep(900) }
          const b0 = lvl
          await click(cAt, item)
          await sleep(350)
          if (countIn(item) < have) out.inserted++
          for (let L = 0; L <= 8; L++) if (isBlock(...cAt, `composter[level=${L}]`)) { lvl = L; break }
          if (lvl > b0 || (b0 === 7 && lvl === 8)) out.raises++
          if (lvl === 7) { await sleep(1300) }   // 7 -> 8 after a 20-tick delay
        }
        if (isBlock(...cAt, 'composter[level=8]')) { await click(cAt, item); await sleep(900) }
        await sleep(1500)   // the popped bone meal is picked up
        out.meal = countIn('bone_meal') - meal0
        out.levelLeft = lvl
        return out
      }
      R.C1 = { placed, fern: await run('fern', 40) }
      R.C1.grass = await run('short_grass', 40)
      P('C1', R.C1)
    }
    // P1: pick a poppy by hand, replant on 4 soils
    {
      rcon(`setblock ${X + 4} ${G + 1} ${Z + 4} minecraft:poppy`)
      await sleep(400)
      const p0 = countIn('poppy')
      await stand(X + 4, Z + 4)
      const dv = await e.dig([X + 4, G + 1, Z + 4], 'poppy')
      await sleep(1500)
      R.P1 = { pick: { dig: dv, items: [p0, countIn('poppy')] }, soils: {} }
      const soils = ['grass_block', 'podzol', 'coarse_dirt', 'dirt']
      await stand(X, Z + 6)
      for (let i = 0; i < soils.length; i++) {
        const at = [X - 2 + i, G, Z + 8]
        rcon(`setblock ${at[0]} ${G} ${at[2]} minecraft:${soils[i]}`, `setblock ${at[0]} ${G + 1} ${at[2]} minecraft:air`)
        await sleep(250)
        const v = await click(at, 'poppy')
        await sleep(600)
        R.P1.soils[soils[i]] = { click: v, poppy: isBlock(at[0], G + 1, at[2], 'poppy') }
      }
      P('P1', R.P1)
    }
    // P2: a poppy on a fern cell (the click on the grass under the fern)
    {
      const at = [X + 3, G, Z + 6]
      rcon(`setblock ${at[0]} ${G + 1} ${at[2]} minecraft:fern`)
      await sleep(400)
      const v = await click(at, 'poppy')
      await sleep(700)
      R.P2 = { click: v, poppy: isBlock(at[0], G + 1, at[2], 'poppy'), fern: isBlock(at[0], G + 1, at[2], 'fern') }
      // and the click on the fern itself
      const at2 = [X + 4, G, Z + 6]
      rcon(`setblock ${at2[0]} ${G + 1} ${at2[2]} minecraft:fern`)
      await sleep(400)
      const v2 = await click([at2[0], G + 1, at2[2]], 'poppy')
      await sleep(700)
      R.P2.onFern = { click: v2, poppy: isBlock(at2[0], G + 1, at2[2], 'poppy'), above: isBlock(at2[0], G + 2, at2[2], 'poppy') }
      P('P2', R.P2)
    }
  } finally {
    try { bot.quit() } catch { /* gone */ }
    try { rcon('gamerule randomTickSpeed 3', `forceload remove ${X - 40} ${Z - 40} ${X + 40} ${Z + 40}`) } catch { /* best effort */ }
  }
  const avg = a => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null
  R.summary = {
    M1: { meals: R.M1?.length, flowersPerMeal: avg((R.M1 ?? []).map(m => m.flowers)), grassPerMeal: avg((R.M1 ?? []).map(m => m.c.short_grass ?? 0)), tallPerMeal: avg((R.M1 ?? []).map(m => m.c.tall_grass ?? 0)), spent: (R.M1 ?? []).map(m => m.spent) },
    M2: { flowersPerMeal: avg((R.M2 ?? []).map(m => m.flowers)), grassPerMeal: avg((R.M2 ?? []).map(m => m.c.short_grass ?? 0)) },
    M3: { uncleared: (R.M3?.uncleared ?? []).filter(x => 'newFlowers' in x).map(x => x.newFlowers), cleared: (R.M3?.cleared ?? []).map(x => x.flowers) },
    C1: R.C1 ? { mealPerFern: R.C1.fern.inserted ? +(R.C1.fern.meal / R.C1.fern.inserted).toFixed(3) : null, mealPerGrass: R.C1.grass.inserted ? +(R.C1.grass.meal / R.C1.grass.inserted).toFixed(3) : null } : null,
  }
  R.pass = {
    M1: (R.M1 ?? []).length === 8 && R.M1.every(m => m.click === 'acked' && m.spent === 1),
    M2: (R.M2 ?? []).length === 4,
    B1: !!R.B1?.placed, B2: !!R.B2?.placed, B3: !!R.B3?.placed,
    C1: !!R.C1?.placed && R.C1.fern.inserted > 0,
    P1: R.P1?.pick?.items?.[1] === R.P1?.pick?.items?.[0] + 1,
    P2: R.P2?.click === 'acked',
  }
  const line = JSON.stringify({ at: new Date().toISOString(), server: SERVER, proof: 'flowers-01', ...R })
  fs.appendFileSync(path.join(__dirname, 'flower-proof.jsonl'), line + '\n')
  P('SUMMARY', R.summary)
  P('RESULT', R.pass)
}
main().catch(e => { console.error('FAILED', e); process.exit(1) })
