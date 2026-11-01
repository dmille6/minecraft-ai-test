#!/usr/bin/env node
// SANDBOX-ONLY probe for deepminer-02 (owner 11-01 ~22:40Z: water buckets on lava are allowed). A BARE mineflayer bot runs the
// fleet's own bucket primitives (bots/src/bucket.mjs pourLiquid / scoopLiquid) on Paper 1.21.8 in a closed stone box:
//   stand S | open cell T | lava SOURCE L   (a branch whose next cell has lava behind it)
// pour the water bucket into T -> the source touching L should turn L to OBSIDIAN; scoop the water back from T -> T dry;
// the server's truth by RCON: L obsidian, T and S not water, no flowing water left in the box, the bucket back in the bag.
//   node sandbox/deepmine/bucket-probe.mjs <botRoot> [server] [trials]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sbx from '../lib/sbxlock.cjs'

const [BOT_ROOT, SERVER = 'sandbox2', TRIALS_S = '5'] = process.argv.slice(2)
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601, sandbox4: 25602, sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }
if (!BOT_ROOT || !PORTS[SERVER]) throw new Error('usage: bucket-probe.mjs <botRoot> [sandbox server] [trials]')
sbx.requireSandboxLock(SERVER, 'deepmine')
const __dir = path.dirname(fileURLToPath(import.meta.url))
const R = path.resolve(__dir, '../..')
const OUT = `${R}/sandbox/log/deepmine-e2e`
fs.mkdirSync(OUT, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const { Vec3 } = breq('vec3')
const BK = await import(pathToFileURL(path.join(BOT_ROOT, 'bots/src/bucket.mjs')))
const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-deep-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
const rcon = (...cmds) => execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
const is = (c, id) => /Test passed/.test(rcon(`execute if block ${c[0]} ${c[1]} ${c[2]} minecraft:${id}`))
const NAME = 'sandbox-Bucket'
const res = []
const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, version: '1.21.8', auth: 'offline' })
await new Promise(r => bot.once('spawn', r))
await sleep(2000)
try {
  for (let t = 0; t < Number(TRIALS_S); t++) {
    const B = { x: 7140 + t * 6, y: 30, z: 7140 }
    const S = [B.x, B.y, B.z], T = [B.x + 1, B.y, B.z], L = [B.x + 2, B.y, B.z]
    rcon(`fill ${B.x - 2} ${B.y - 2} ${B.z - 2} ${B.x + 4} ${B.y + 3} ${B.z + 2} minecraft:stone`,
      `fill ${S[0]} ${S[1]} ${S[2]} ${T[0]} ${T[1] + 1} ${T[2]} minecraft:air`, `setblock ${L[0]} ${L[1]} ${L[2]} minecraft:lava`,
      `gamemode survival ${NAME}`, `clear ${NAME}`, `give ${NAME} minecraft:water_bucket 1`, `effect give ${NAME} minecraft:fire_resistance 600 1 true`,
      `tp ${NAME} ${S[0] + 0.5} ${S[1]} ${S[2] + 0.5}`)
    await sleep(2500)
    const lavaBefore = is(L, 'lava')
    const pour = await BK.pourLiquid(bot, new Vec3(...T))
    await sleep(1500)
    const obsidian = is(L, 'obsidian')
    const scoop = await BK.scoopLiquid(bot, new Vec3(...T))
    await sleep(1500)
    const tDry = !is(T, 'water'), sDry = !is(S, 'water')
    const bucketBack = (bot.inventory.items().find(i => i.name === 'water_bucket') ? 'water_bucket' : bot.inventory.items().find(i => i.name === 'bucket') ? 'bucket' : 'none')
    const r = { trial: t, lavaBefore, pour, obsidian, scoop, tDry, sDry, bucketBack, health: bot.health, ok: lavaBefore && pour.ok && obsidian && tDry && sDry && bucketBack === 'water_bucket' }
    res.push(r); console.log(JSON.stringify(r))
  }
} finally {
  const sum = { run: new Date().toISOString(), server: SERVER, scene: 'bucket-on-lava', trials: res.length, ok: res.filter(r => r.ok).length, obsidian: res.filter(r => r.obsidian).length, scooped: res.filter(r => r.scoop?.ok).length, res }
  fs.appendFileSync(`${OUT}/results.jsonl`, JSON.stringify(sum) + '\n')
  console.log('RESULT', JSON.stringify({ ...sum, res: undefined }))
  bot.quit('done'); await sleep(500); process.exit(0)
}
