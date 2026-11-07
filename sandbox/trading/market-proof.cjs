// SANDBOX-ONLY (sandbox4): the facts the market design (docs/reports/market-design-2026-11-06.md) rests on, on OUR stack
// (Paper 1.21.8, mineflayer 4.37.1), not from memory.
//   BOT_ROOT=<worktree> node sandbox/trading/market-proof.cjs [A,B,C,D,E,F]   (take the lock first: sandbox/sbxlock.sh take sandbox4 market)
//   A  trade TABLES: every working profession x level 1..5, N fresh villagers each; the server's own Offers record
//      (`data get entity ... Offers.Recipes`) -> which item each level buys and sells, at what count, maxUses, xp.
//   B  the client sees the same offers: bot.openVillager on one villager per profession (levels 1-2), compared to A's record.
//   C  WANDERING TRADER: its offers (1.21.5+ added buy offers) and a client opener (mineflayer's openVillager asserts the
//      villager entity type); one sell server-confirmed.
//   D  RESTOCK + DEMAND: an employed toolsmith/fletcher at its own job site in work hours: exhaust an offer, time to the
//      restock, the second restock, the third (none until the next day), and the price after a restock (demand).
//   E  CLAIM REACH: an unemployed villager at one end of a 1-wide glass corridor and a free job site 16 / 32 / 44 blocks away.
//   F  BREEDING with mobGriefing true: two adults, 3 free beds, bread tossed by the bot -> a baby?
// Setup in the sandbox only (the owner's no-admin-edit rule is for the bots' worlds): forceload, fill, setblock, summon, give, tp, time.
'use strict'
const { execFileSync } = require('child_process')
const path = require('path')
const BOT_ROOT = process.env.BOT_ROOT || '.'
const req = m => require(require.resolve(m, { paths: [path.join(BOT_ROOT, 'bots')] }))
const mineflayer = req('mineflayer')
const { Vec3 } = req('vec3')
const { requireSandboxLock } = require('../lib/sbxlock.cjs')
const SERVER = 'sandbox4', PORT = 25602, NAME = 'sbx-Market', TAG = 'market'
const SSH = ['-o', 'BatchMode=yes', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const r1 = c => rcon(c)[0].reply
const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const P = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
const X = 3400, Y = 140, Z = 3700
const PROFS = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian',
  'mason', 'shepherd', 'toolsmith', 'weaponsmith']
const N = +(process.env.N || 8)
const R = { stack: 'Paper 1.21.8 / mineflayer 4.37.1', n: N }
const only = (process.argv[2] || 'A,B,C,D,E,F').split(',')

// "{buy:{count:15,id:\"minecraft:coal\"},maxUses:16,...,sell:{count:1,id:\"minecraft:emerald\"},...}" -> compact offers
function parseRecipes (snbt) {
  const out = []
  const body = snbt.replace(/^[^\[]*\[/, '').replace(/\]\s*$/, '').replace(/:\s+/g, ':').replace(/,\s+/g, ',')
  // split on top-level "}, {" between recipes
  let depth = 0, cur = ''
  for (const ch of body) {
    if (ch === '{') depth++
    if (ch === '}') depth--
    cur += ch
    if (depth === 0 && ch === '}') { out.push(cur.trim().replace(/^,\s*/, '')); cur = '' }
  }
  const item = (s, key) => {
    const i = s.indexOf(key + ':{'); if (i < 0) return null
    let d = 0, j = i + key.length + 1, t = ''
    for (; j < s.length; j++) { const c = s[j]; if (c === '{') d++; if (c === '}') d--; t += c; if (d === 0) break }
    const id = (t.match(/id:\s*"minecraft:([a-z0-9_]+)"/) || [])[1]
    const count = +((t.match(/count:\s*(\d+)/) || [])[1] || 1)
    const ench = [...t.matchAll(/"minecraft:([a-z_]+)":\s*(\d+)/g)].map(m => `${m[1]}${m[2]}`).filter(e => !/^(stored_enchantments|enchantments)/.test(e))
    return id ? `${id}x${count}${ench.length && /enchanted_book|_axe|_pickaxe|_sword|_shovel|_helmet|_chestplate|_leggings|_boots|bow|crossbow|fishing_rod|trident/.test(id) ? '[' + ench.join(',') + ']' : ''}` : null
  }
  const num = (s, k) => { const m = s.match(new RegExp('\\b' + k + ':\\s*(-?[\\d.]+)')); return m ? +m[1] : null }
  return out.filter(Boolean).map(s => ({ buy: item(s, 'buy'), buyB: item(s, 'buyB'), sell: item(s, 'sell'), maxUses: num(s, 'maxUses'), xp: num(s, 'xp'), priceMultiplier: num(s, 'priceMultiplier'), demand: num(s, 'demand'), uses: num(s, 'uses') }))
}

async function partA () {
  // a glass box far from the sandbox's villages; NoAI villagers (offers are generated at the level they have, on first read)
  rcon(`forceload add ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`,
    `fill ${X - 30} ${Y} ${Z - 30} ${X + 30} ${Y + 6} ${Z + 30} minecraft:air`,
    `fill ${X - 30} ${Y} ${Z - 30} ${X + 30} ${Y} ${Z + 30} minecraft:glass`,
    `kill @e[type=villager,x=${X - 40},y=${Y - 5},z=${Z - 40},dx=80,dy=30,dz=80]`,
    `kill @e[type=wandering_trader,x=${X - 40},y=${Y - 5},z=${Z - 40},dx=80,dy=30,dz=80]`)
  const table = {}   // prof -> level -> { offerKey: count }
  const raw = {}
  let k = 0
  for (const prof of PROFS) {
    table[prof] = {}
    for (let level = 1; level <= 5; level++) {
      const cmds = [], tags = []
      for (let i = 0; i < N; i++) {
        const tag = `mk${k++}`; tags.push(tag)
        cmds.push(`summon villager ${X - 28 + (i * 3)} ${Y + 1} ${Z - 28 + level * 3} {Tags:["${tag}","mkA"],NoAI:1b,Silent:1b,VillagerData:{profession:"minecraft:${prof}",level:${level},type:"minecraft:plains"}}`)
      }
      // ONE FIELD PER QUERY: the server truncates a long `data get` reply with "..." (sandbox4 11-06: a whole Offers.Recipes
      // list came back cut after the first recipe's sell id), so each recipe field is read on its own
      const FIELDS = ['buy.id', 'buy.count', 'buyB.id', 'buyB.count', 'sell.id', 'sell.count', 'maxUses', 'xp', 'priceMultiplier', 'sell.components."minecraft:stored_enchantments"']
      for (const tag of tags) for (let i = 0; i < 3; i++) for (const f of FIELDS) cmds.push(`data get entity @e[type=villager,tag=${tag},limit=1] Offers.Recipes[${i}].${f}`)
      cmds.push(`kill @e[type=villager,tag=mkA]`)
      const res = rcon(...cmds)
      const counts = {}
      raw[`${prof}${level}`] = []
      const val = r => { const m = r.reply.match(/has the following entity data: (.*)$/s); return m ? m[1].trim() : null }
      for (const tag of tags) {
        const offers = []
        for (let i = 0; i < 3; i++) {
          const get = f => { const r = res.find(x => x.cmd === `data get entity @e[type=villager,tag=${tag},limit=1] Offers.Recipes[${i}].${f}`); return r ? val(r) : null }
          const id = v => v ? v.replace(/^"minecraft:|"$/g, '') : null
          const n = v => v ? +String(v).replace(/[^\d.]/g, '') : null
          const buy = id(get('buy.id')); if (!buy) continue
          const buyB = id(get('buyB.id')), sell = id(get('sell.id'))
          const ench = get('sell.components."minecraft:stored_enchantments"')
          const e = ench ? [...ench.matchAll(/"minecraft:([a-z_]+)":\s*(\d+)/g)].map(m => m[1] + m[2]).join(',') : ''
          offers.push({ buy: `${buy}x${n(get('buy.count'))}`, buyB: buyB && buyB !== 'air' ? `${buyB}x${n(get('buyB.count'))}` : null, sell: `${sell}x${n(get('sell.count'))}${e ? '[' + e + ']' : ''}`, maxUses: n(get('maxUses')), xp: n(get('xp')), priceMultiplier: n(get('priceMultiplier')) })
        }
        raw[`${prof}${level}`].push(offers.map(o => `${o.buy}${o.buyB ? '+' + o.buyB : ''}->${o.sell} max${o.maxUses} xp${o.xp} pm${o.priceMultiplier}`))
        for (const o of offers) {
          const key = `${o.buy}${o.buyB ? ' + ' + o.buyB : ''} -> ${o.sell} (max ${o.maxUses}, xp ${o.xp}, pm ${o.priceMultiplier})`
          const fam = /\[/.test(key) ? key.replace(/emeraldx\d+/g, 'emeraldxN').replace(/\[[^\]]*\]/g, '[ench]') : key
          counts[fam] = (counts[fam] || 0) + 1
        }
        if (!offers.length) counts['(NO OFFERS)'] = (counts['(NO OFFERS)'] || 0) + 1
      }
      table[prof][level] = counts
      P(`A ${prof} L${level}`, counts)
    }
  }
  R.A_table = table
  R.A_books = Object.fromEntries(Object.entries(raw).filter(([k]) => k.startsWith('librarian')).map(([k, v]) => [k, v.flat().filter(s => /enchanted_book/.test(s))]))
  R.A_raw_sample = raw['librarian1']
}

let bot = null
async function connect () {
  if (bot) return bot
  rcon(`whitelist add ${NAME}`)
  bot = mineflayer.createBot({ host: '10.0.0.30', port: PORT, username: NAME, auth: 'offline', version: '1.21.8' })
  await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); setTimeout(() => rej(new Error('no spawn')), 60000) })
  rcon(`gamemode survival ${NAME}`, `clear ${NAME}`, `tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 0.5}`)
  await sleep(2000)
  P('spawned')
  return bot
}
const nearest = (name, notIds = new Set()) => Object.values(bot.entities).filter(e => e.name === name && !notIds.has(e.id))
  .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0]
const fmtItem = it => it ? `${it.name}x${it.count}` : null
const clientOffers = v => v.trades.map(t => `${fmtItem(t.inputItem1)}${t.hasItem2 ? '+' + fmtItem(t.inputItem2) : ''}->${fmtItem(t.outputItem)} max${t.maximumNbTradeUses} uses${t.nbTradeUses} real${t.realPrice} dem${t.demand} sp${t.specialPrice} pm${t.priceMultiplier}`)
const countIn = (name) => { const m = r1(`clear ${NAME} minecraft:${name} 0`).match(/Found (\d+)/); return m ? +m[1] : 0 }

/** A merchant opener for ANY merchant entity: mineflayer's openVillager asserts entityType === villager; the window flow is
 *  identical for a wandering trader (window type minecraft:merchant). A thin view with the villager's entityType. */
async function openMerchant (e) {
  const vt = bot.registry.entitiesByName.villager.id
  const view = e.entityType === vt ? e : Object.assign(Object.create(e), { entityType: vt })
  return bot.openVillager(view)
}

async function partB () {
  await connect()
  R.B = []
  const seen = new Set()
  for (const prof of PROFS) {
    for (const level of [1, 2]) {
      rcon(`kill @e[type=villager,tag=mkB]`, `tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 0.5}`,
        `summon villager ${X + 2.5} ${Y + 1} ${Z + 0.5} {Tags:["mkB"],NoAI:1b,Silent:1b,VillagerData:{profession:"minecraft:${prof}",level:${level},type:"minecraft:plains"}}`)
      let e = null
      for (let i = 0; i < 20 && !(e = nearest('villager', seen)); i++) await sleep(200)
      if (!e) { R.B.push({ prof, level, err: 'not seen' }); continue }
      seen.add(e.id)
      const server = parseRecipes(r1(`data get entity @e[type=villager,tag=mkB,limit=1] Offers.Recipes`))
      let client = null, err = null
      try { const v = await openMerchant(e); client = clientOffers(v); v.close() } catch (x) { err = x.message }
      // after the open the offers exist on the server: compare names/counts in order
      const server2 = parseRecipes(r1(`data get entity @e[type=villager,tag=mkB,limit=1] Offers.Recipes`))
      const agree = client && server2.length === client.length && server2.every((o, i) => client[i].startsWith(`${o.buy.replace(/\[.*$/, '')}`) && client[i].includes(`->${o.sell.replace(/\[.*$/, '')}`))
      R.B.push({ prof, level, serverBefore: server.length, server: server2.map(o => `${o.buy}->${o.sell}`), client, agree, err })
      P('B', prof, level, agree, client, err)
      await sleep(300)
    }
  }
  rcon(`kill @e[type=villager,tag=mkB]`)
}

async function partC () {
  await connect()
  rcon(`kill @e[type=wandering_trader,tag=mkC]`)
  R.C = { traders: [] }
  const seen = new Set()
  for (let i = 0; i < 6; i++) {
    rcon(`kill @e[type=wandering_trader,tag=mkC]`, `tp ${NAME} ${X + 0.5} ${Y + 1} ${Z + 4.5}`,
      `summon wandering_trader ${X + 2.5} ${Y + 1} ${Z + 4.5} {Tags:["mkC"],NoAI:1b,Silent:1b,DespawnDelay:24000}`)
    let e = null
    for (let j = 0; j < 20 && !(e = nearest('wandering_trader', seen)); j++) await sleep(200)
    if (!e) { R.C.traders.push({ err: 'not seen' }); continue }
    seen.add(e.id)
    let client = null, err = null, sold = null
    try {
      const v = await openMerchant(e)
      client = clientOffers(v)
      // one SELL to the trader (goods -> emerald), server-confirmed, the first time one is offered
      const si = v.trades.findIndex(t => t.outputItem?.name === 'emerald' && !t.tradeDisabled)
      if (si >= 0 && !R.C.sell) {
        const t = v.trades[si]
        const give = t.inputItem1.name === 'potion' ? 'potion[minecraft:potion_contents={potion:"minecraft:water"}]' : t.inputItem1.name
        v.close(); await sleep(300)
        rcon(`give ${NAME} minecraft:${give} ${t.realPrice * 2}`)
        await sleep(1500)
        const em0 = countIn('emerald'), in0 = countIn(t.inputItem1.name)
        const v2 = await openMerchant(e)
        try { await v2.trade(si, 1); sold = 'ok' } catch (x) { sold = 'threw ' + x.message }
        v2.close(); await sleep(1200)
        R.C.sell = { offer: client[si], sold, emBefore: em0, emAfter: countIn('emerald'), inBefore: in0, inAfter: countIn(t.inputItem1.name) }
        P('C sell', R.C.sell)
      } else v.close()
    } catch (x) { err = x.message }
    R.C.traders.push({ client, err })
    P('C trader', i, client, err)
  }
  rcon(`kill @e[type=wandering_trader,tag=mkC]`, `clear ${NAME}`)
}

async function waitFor (fn, ms, step = 3000) {
  const t = Date.now()
  while (Date.now() - t < ms) { const v = await fn(); if (v) return { v, s: (Date.now() - t) / 1000 }; await sleep(step) }
  return { v: null, s: ms / 1000, timeout: true }
}

async function partD () {
  await connect()
  // a pen 7x7 at the west side: an employed fletcher with AI ON, its fletching table next to it, a bot outside a glass
  // window at reach. Offers fixed by NBT so the run does not depend on the random draw: sticks 32 -> 1 emerald, max 16.
  const px = X - 20, pz = Z + 10
  rcon(`fill ${px - 4} ${Y + 1} ${pz - 4} ${px + 4} ${Y + 3} ${pz + 4} minecraft:glass`,
    `fill ${px - 3} ${Y + 1} ${pz - 3} ${px + 3} ${Y + 3} ${pz + 3} minecraft:air`,
    `setblock ${px} ${Y + 1} ${pz - 3} minecraft:fletching_table`,
    `fill ${px + 4} ${Y + 1} ${pz} ${px + 4} ${Y + 2} ${pz} minecraft:air`,
    'gamerule doDaylightCycle true', 'time set 2000',
    `kill @e[type=villager,tag=mkD]`,
    // UNEMPLOYED, so it claims the table itself (a summoned fletcher with no job site and no trade loses its profession and
    // re-draws its offers on the claim -- sandbox4 11-06 first run)
    `summon villager ${px + 0.5} ${Y + 1} ${pz + 0.5} {Tags:["mkD"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
    `tp ${NAME} ${px + 5.5} ${Y + 1} ${pz + 0.5}`)
  await sleep(4000)
  const claim = await waitFor(() => { const p = r1(`data get entity @e[type=villager,tag=mkD,limit=1] VillagerData.profession`); return /fletcher/.test(p) ? p : null }, 120000, 3000)
  R.D = { claim }
  P('D claim', claim)
  rcon(...Array.from({ length: 12 }, () => `give ${NAME} minecraft:stick 64`), `give ${NAME} minecraft:emerald 64`,
    ...Array.from({ length: 4 }, () => `give ${NAME} minecraft:gravel 64`))
  await sleep(1500)
  // per field (a whole-list `data get` is truncated): offer 0's uses / maxUses / demand / buy
  const usesOf = () => {
    const q = f => `data get entity @e[type=villager,tag=mkD,limit=1] Offers.Recipes[0].${f}`
    const res = rcon(q('uses'), q('maxUses'), q('demand'), q('buy.id'), q('buy.count'), q('sell.id'), q('specialPrice'))
    const v = i => { const m = res[i].reply.match(/data: (.*)$/s); return m ? m[1].trim() : null }
    const n = i => { const x = v(i); return x == null ? null : +x.replace(/[^\d.-]/g, '') }
    return [{ uses: n(0), maxUses: n(1), demand: n(2), buy: `${v(3)}x${n(4)}`, sell: v(5), specialPrice: n(6) }]
  }
  const exhaust = async () => {
    const e = nearest('villager')
    if (!e || e.position.distanceTo(bot.entity.position) > 4) { rcon(`tp @e[type=villager,tag=mkD,limit=1] ${px + 3.5} ${Y + 1} ${pz + 0.5}`); await sleep(1500) }
    const v = await openMerchant(nearest('villager'))
    const before = clientOffers(v)[0]
    const left = v.trades[0].maximumNbTradeUses - v.trades[0].nbTradeUses
    let err = null
    try { if (left > 0) await v.trade(0, left) } catch (x) { err = x.message }
    v.close(); await sleep(1000)
    return { before, traded: left, err, server: usesOf()[0] }
  }
  const tick0 = +((r1('time query gametime').match(/(\d+)/) || [])[1])
  for (let round = 1; round <= 3; round++) {
    const ex = await exhaust()
    const t0 = +((r1('time query gametime').match(/(\d+)/) || [])[1])
    P(`D round ${round} exhausted`, ex)
    // keep it in work hours; `time set` moves the day time only (restock spacing is on game time)
    const rs = await waitFor(() => { const o = usesOf()[0]; return o && o.uses === 0 ? o : null }, round < 3 ? 240000 : 200000, 5000)
    const t1 = +((r1('time query gametime').match(/(\d+)/) || [])[1])
    R.D[`round${round}`] = { exhausted: ex, restock: rs, ticksToRestock: rs.timeout ? null : t1 - t0, daytime: r1('time query daytime') }
    P(`D round ${round} restock`, R.D[`round${round}`])
    if (rs.timeout) break
    if (round === 1) rcon('time set 2500')
  }
  // the price after the restocks (demand): open once more and read realPrice of the emerald->arrows offer and sticks offer
  try { const v = await openMerchant(nearest('villager')); R.D.after = clientOffers(v); v.close() } catch (x) { R.D.after = 'threw ' + x.message }
  R.D.gametimeSpan = +((r1('time query gametime').match(/(\d+)/) || [])[1]) - tick0
  P('D after', R.D.after)
  rcon(`kill @e[type=villager,tag=mkD]`, `clear ${NAME}`)
}

async function partE () {
  // claim reach: a 1-wide, 2-high glass corridor along +x; villager at x0, a lectern at x0+d. Fresh corridor per d.
  R.E = {}
  for (const d of [16, 32, 44]) {
    const cz = Z - 20 + (d / 4)
    rcon(`fill ${X - 25} ${Y + 1} ${cz - 1} ${X + 25} ${Y + 3} ${cz + 1} minecraft:glass`,
      `fill ${X - 24} ${Y + 1} ${cz} ${X + 24} ${Y + 2} ${cz} minecraft:air`,
      'time set 2000', `kill @e[type=villager,tag=mkE]`,
      `summon villager ${X - 23.5} ${Y + 1} ${cz + 0.5} {Tags:["mkE"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
      `setblock ${X - 24 + d} ${Y + 1} ${cz} minecraft:lectern`)
    const w = await waitFor(() => { const p = r1(`data get entity @e[type=villager,tag=mkE,limit=1] VillagerData.profession`); return /librarian/.test(p) ? p : null }, 120000, 4000)
    R.E[d] = w
    P('E claim at', d, w)
    rcon(`kill @e[type=villager,tag=mkE]`, `setblock ${X - 24 + d} ${Y + 1} ${cz} minecraft:air`)
  }
}

async function partF () {
  await connect()
  const fx = X + 18, fz = Z + 14
  const mg0 = r1('gamerule mobGriefing')
  R.F = { mobGriefingBefore: mg0 }
  rcon('gamerule mobGriefing true',
    `fill ${fx - 6} ${Y + 1} ${fz - 6} ${fx + 6} ${Y + 4} ${fz + 6} minecraft:glass`,
    `fill ${fx - 5} ${Y + 1} ${fz - 5} ${fx + 5} ${Y + 4} ${fz + 5} minecraft:air`,
    `setblock ${fx - 4} ${Y + 1} ${fz - 4} minecraft:red_bed[facing=south,part=head]`, `setblock ${fx - 4} ${Y + 1} ${fz - 5} minecraft:red_bed[facing=south,part=foot]`,
    `setblock ${fx} ${Y + 1} ${fz - 4} minecraft:red_bed[facing=south,part=head]`, `setblock ${fx} ${Y + 1} ${fz - 5} minecraft:red_bed[facing=south,part=foot]`,
    `setblock ${fx + 4} ${Y + 1} ${fz - 4} minecraft:red_bed[facing=south,part=head]`, `setblock ${fx + 4} ${Y + 1} ${fz - 5} minecraft:red_bed[facing=south,part=foot]`,
    `fill ${fx + 6} ${Y + 1} ${fz} ${fx + 6} ${Y + 2} ${fz} minecraft:air`,
    `kill @e[type=villager,tag=mkF]`,
    `summon villager ${fx - 1.5} ${Y + 1} ${fz + 1.5} {Tags:["mkF"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
    `summon villager ${fx + 1.5} ${Y + 1} ${fz + 1.5} {Tags:["mkF"],VillagerData:{profession:"minecraft:none",level:1,type:"minecraft:plains"}}`,
    `tp ${NAME} ${fx + 6.5} ${Y + 1} ${fz + 0.5}`, `give ${NAME} minecraft:bread 12`, 'time set 6000')
  await sleep(3000)
  // the bot tosses the bread inside the pen (through the 1x2 opening), 6 loaves at a time
  try {
    await bot.lookAt(new Vec3(fx, Y + 1, fz), true)
    const b = bot.inventory.items().find(i => i.name === 'bread')
    await bot.toss(b.type, null, 12)
    R.F.tossed = 12
  } catch (x) { R.F.tossed = 'threw ' + x.message }
  await sleep(8000)
  R.F.inventories = rcon(`data get entity @e[type=villager,tag=mkF,limit=1,sort=nearest] Inventory`).map(r => r.reply)
  const count = () => +((r1(`execute if entity @e[type=villager,x=${fx - 6},y=${Y},z=${fz - 6},dx=12,dy=5,dz=12]`).match(/(\d+)/) || [])[1] || 0)
  R.F.before = count()
  const baby = await waitFor(() => count() > R.F.before ? count() : null, 300000, 6000)
  R.F.baby = baby
  R.F.after = count()
  P('F breeding', R.F)
  rcon(`kill @e[type=villager,x=${fx - 6},y=${Y},z=${fz - 6},dx=12,dy=5,dz=12]`, `kill @e[type=item,x=${fx - 6},y=${Y},z=${fz - 6},dx=12,dy=5,dz=12]`,
    `gamerule mobGriefing ${/false/.test(mg0) ? 'false' : 'true'}`)
}

async function main () {
  requireSandboxLock(SERVER, TAG)
  R.version = r1('version').slice(0, 200)
  R.gamerules = { mobGriefing: r1('gamerule mobGriefing'), doDaylightCycle: r1('gamerule doDaylightCycle') }
  try {
    if (only.includes('A')) await partA()
    if (only.includes('B')) await partB()
    if (only.includes('C')) await partC()
    if (only.includes('D')) await partD()
    if (only.includes('E')) await partE()
    if (only.includes('F')) await partF()
  } finally {
    try { bot?.quit() } catch {}
    await sleep(500)
    rcon(`kill @e[type=villager,x=${X - 40},y=${Y - 5},z=${Z - 40},dx=80,dy=30,dz=80]`,
      `kill @e[type=wandering_trader,x=${X - 40},y=${Y - 5},z=${Z - 40},dx=80,dy=30,dz=80]`,
      `kill @e[type=item,x=${X - 40},y=${Y - 5},z=${Z - 40},dx=80,dy=30,dz=80]`,
      `fill ${X - 30} ${Y} ${Z - 30} ${X + 30} ${Y + 6} ${Z + 30} minecraft:air`,
      `forceload remove ${X - 32} ${Z - 32} ${X + 32} ${Z + 32}`,
      `gamerule mobGriefing ${/false/.test(R.gamerules.mobGriefing) ? 'false' : 'true'}`)
    console.log('RESULT ' + JSON.stringify(R))
  }
}
main().catch(e => { console.log('FAILED', e.stack); console.log('RESULT ' + JSON.stringify(R)); process.exit(1) })
