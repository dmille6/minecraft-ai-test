// SANDBOX-ONLY: run the REAL bot (BOT_ROOT) with preload.cjs, drive table crafts through the queue brain, RCON oracle.
// node realdrive.cjs <arm> <rounds> [cells] [botRoot]
'use strict'
const { execFileSync, spawn } = require('child_process')
const fs = require('fs'); const path = require('path')
const ARM = process.argv[2] || 'none'
const ROUNDS = Number(process.argv[3] || 5)
const CELLS = (process.argv[4] || 'make-wood,fresh-stone,exist-stone,exist-wood,sticks').split(',')
const BOT_ROOT = process.argv[5]
if (!BOT_ROOT) throw new Error('usage: node realdrive.cjs <arm> <rounds> <cells> <botRoot>')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')   // the checkout holding sandbox/run-bot.sh
// outputs (queue, brain log, bot stdout, traces, results) go to sandbox/log/craft (gitignored), never next to the code
const D = __dirname
const L = `${R}/sandbox/log/craft`; fs.mkdirSync(L, { recursive: true })
const NAME = 'sandbox-Crafty'
const TAG = `cs-${ARM}-${path.basename(BOT_ROOT)}`
const LOGREL = `./sandbox/log/craftsync-${TAG}`
const BOTOUT = path.join(L, `bot-${TAG}.out`)
const QUEUE = path.join(L, `queue-${TAG}.txt`)
const TRACE = path.join(L, `rtrace-${TAG}.jsonl`)
const RES = path.join(L, `rresults-${TAG}.jsonl`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const mark = o => fs.appendFileSync(TRACE, JSON.stringify({ ts: Date.now(), drv: true, ...o }) + '\n')

function rcon (...cmds) {
  const out = execFileSync('ssh', ['mike@10.0.0.30', 'python3 /tmp/sbx-rcon.py sandbox -'], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const FILLER = ['dirt', 'andesite', 'diorite', 'granite']
const SPEC = {
  'make-wood': { cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe', table: 'none', give: [['oak_planks', 7], ['stick', 2]] },
  'fresh-stone': { cmd: 'craft stone_pickaxe', product: 'stone_pickaxe', table: 'none', give: [['crafting_table', 1], ['cobblestone', 3], ['stick', 2]] },
  'fresh-wood': { cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe', table: 'none', give: [['crafting_table', 1], ['oak_planks', 3], ['stick', 2]] },
  'exist-stone': { cmd: 'craft stone_pickaxe', product: 'stone_pickaxe', table: 'exist', give: [['cobblestone', 3], ['stick', 2]] },
  'exist-wood': { cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe', table: 'exist', give: [['oak_planks', 3], ['stick', 2]] },
  'full2-exist': { cmd: 'craft stone_pickaxe', product: 'stone_pickaxe', table: 'exist', fill: [4, 36], give: [], slots: [['stone_pickaxe[damage=130]', 1], ['stone_pickaxe', 1], ['cobblestone', 4], ['stick', 4]], names: ['cobblestone', 'stick'] },
  'full-make-wood': { cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe', table: 'none', fill: [2, 36], give: [['oak_planks', 7], ['stick', 2]] },
  'full-fresh-stone': { cmd: 'craft stone_pickaxe', product: 'stone_pickaxe', table: 'none', fill: [3, 36], give: [['crafting_table', 1], ['cobblestone', 3], ['stick', 2]] },
  'full-exist-stone': { cmd: 'craft stone_pickaxe', product: 'stone_pickaxe', table: 'exist', fill: [2, 36], give: [['cobblestone', 3], ['stick', 2]] },
  'sur-fresh-stone': { cmd: 'craft stone_pickaxe', product: 'stone_pickaxe', table: 'none', give: [['crafting_table', 1], ['cobblestone', 8], ['stick', 5]] },
  'sur-exist-wood': { cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe', table: 'exist', give: [['oak_planks', 7], ['stick', 4]] },
  'sur-fresh-wood': { cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe', table: 'none', give: [['crafting_table', 1], ['oak_planks', 7], ['stick', 4]] },
  'sur-exist-stone': { cmd: 'craft stone_pickaxe', product: 'stone_pickaxe', table: 'exist', give: [['cobblestone', 8], ['stick', 5]] },
  'sticks': { cmd: 'craft stick', product: 'stick', table: 'none', give: [['oak_planks', 2]], yield: 4 },
}
function counts (names) {
  const cmds = names.map(n => `clear ${NAME} minecraft:${n} 0`)
  cmds.push('execute positioned 700 120 700 if entity @e[type=item,distance=..12]')
  cmds.push('execute positioned 700 120 700 if block ~ ~ ~ air') // dummy
  const r = rcon(...cmds); const o = {}
  names.forEach((n, i) => { const m = r[i]?.reply.match(/Found (\d+)/); o[n] = m ? +m[1] : (/No items were found/.test(r[i]?.reply) ? 0 : `?${r[i]?.reply}`) })
  const m = r[names.length]?.reply.match(/count: (\d+)/); o._items = m ? +m[1] : 0
  return o
}
function grepCount (pat) { try { return fs.readFileSync(BOTOUT, 'utf8').split('\n').filter(l => pat.test(l)).length } catch { return 0 } }
function lastLine (pat) { try { return fs.readFileSync(BOTOUT, 'utf8').split('\n').filter(l => pat.test(l)).pop() || '' } catch { return '' } }

let bot, brain
async function main () {
  const tw = Date.now()
  for (;;) {
    const pl = rcon('list')[0].reply
    if (/There are 0 of/.test(pl)) break
    if (Date.now() - tw > 3600000) throw new Error('sandbox not empty: ' + pl)
    console.log(new Date().toISOString().slice(11, 19), 'waiting:', pl.trim()); await sleep(20000)
  }
  // env file (removed at the end)
  const envRel = `sandbox/.env.${TAG}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  env = env.replace(/^BOT_NAME=.*$/m, `BOT_NAME=${NAME}`).replace(/^LOG_DIR=.*$/m, `LOG_DIR=${LOGREL}`).replace(/^STATE_DIR=.*$/m, `STATE_DIR=./sandbox/state/craftsync-${TAG}`)
    .replace(/^HOME_X=.*$/m, 'HOME_X=700').replace(/^HOME_Y=.*$/m, 'HOME_Y=120').replace(/^HOME_Z=.*$/m, 'HOME_Z=700')
    .replace(/^BOARD_X=.*$/m, 'BOARD_X=700').replace(/^BOARD_Y=.*$/m, 'BOARD_Y=120').replace(/^BOARD_Z=.*$/m, 'BOARD_Z=700')
    .replace(/^MEMORY_POOL=.*$/m, `MEMORY_POOL=sbxcraftsync-${TAG}`) + '\nMAX_CONSECUTIVE_FAILURES=50\n'
  fs.writeFileSync(`${R}/${envRel}`, env)
  fs.writeFileSync(QUEUE, '')
  brain = spawn('node', [path.join(D, 'qbrain.mjs'), '11499'], { env: { ...process.env, QUEUE_FILE: QUEUE }, stdio: ['ignore', fs.openSync(path.join(L, `brain-${TAG}.log`), 'a'), 'inherit'] })
  await sleep(1000)
  const bo = fs.openSync(BOTOUT, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT, NODE_OPTIONS: `--require ${path.join(D, 'preload.cjs')}`, CRAFTSYNC_ARM: ARM, CRAFTSYNC_TRACE: TRACE }, stdio: ['ignore', bo, bo] })
  const t0 = Date.now()
  while (!grepCount(/spawned pos=/)) { if (Date.now() - t0 > 60000) throw new Error('no spawn'); await sleep(500) }
  rcon(`gamemode survival ${NAME}`, 'fill 690 119 690 710 119 710 minecraft:stone', 'fill 690 120 690 710 123 710 minecraft:air')
  await sleep(8000)
  for (let k = 0; k < ROUNDS; k++) {
    for (const cell of CELLS) {
      const spec = SPEC[cell]
      const id = `${ARM}:${cell}:${k}`
      const cmds = [`clear ${NAME}`, 'kill @e[type=item,x=700,y=120,z=700,distance=..30]', 'fill 690 120 690 710 123 710 minecraft:air replace minecraft:crafting_table', `tp ${NAME} 700.5 120 700.5`]
      const [f0, f1] = spec.fill || [9, 21]
      for (let s = f0; s < f1; s++) cmds.push(`item replace entity ${NAME} container.${s} with minecraft:${FILLER[s % 4]} 64`)
      let slot = spec.fill ? 0 : k % 3
      for (const [it, c] of [...(spec.slots || []), ...spec.give]) cmds.push(`item replace entity ${NAME} container.${slot++} with minecraft:${it} ${c}`)
      if (spec.table === 'exist') cmds.push('setblock 702 120 700 minecraft:crafting_table')
      rcon(...cmds)
      await sleep(2500)
      const names = [spec.product, 'crafting_table', ...spec.give.map(g => g[0]), ...(spec.names || [])].filter((v, i, a) => a.indexOf(v) === i)
      const before = counts(names)
      const pat = /skill craft ->|rejected why=.*"skill":"craft"/
      mark({ ev: 'trial_start', id })
      let row = ''
      for (let attempt = 0; attempt < 4; attempt++) {
        const n0 = grepCount(pat)
        fs.appendFileSync(QUEUE, ((attempt + k) % 2 ? spec.cmd.replace(/^craft /, 'craft 1 ') : spec.cmd) + '\n')
        const ts = Date.now()
        while (grepCount(pat) <= n0 && Date.now() - ts < 150000) await sleep(500)
        row = lastLine(pat).slice(0, 400)
        if (/skill craft ->/.test(row)) break
        await sleep(3000)
      }
      await sleep(3000)
      const after = counts(names)
      mark({ ev: 'trial_end', id })
      const gain = after[spec.product] - before[spec.product]
      const verdict = !/skill craft ->/.test(row) ? 'NOT_RUN' : gain === (spec.yield || 1) ? 'APPLIED' : gain === 0 && after._items === 0 ? 'DENIED' : after._items > 0 ? 'DROPPED' : 'OTHER'
      const r = { id, arm: ARM, cell, k, verdict, before, after, row, root: path.basename(BOT_ROOT) }
      fs.appendFileSync(RES, JSON.stringify(r) + '\n')
      console.log(`${id.padEnd(22)} ${verdict.padEnd(8)} ${spec.product} ${before[spec.product]}->${after[spec.product]} items ${after._items} | ${row.replace(/^\[[^\]]+\]\s*/, '').slice(0, 150)}`)
    }
  }
}
async function cleanup () {
  try { bot && bot.kill('SIGTERM') } catch {}
  try { execFileSync('pkill', ['-f', 'sandbox/craft/preload.cjs']) } catch {}
  try { brain && brain.kill('SIGTERM') } catch {}
  await sleep(2000)
  try { execFileSync('pkill', ['-f', `qbrain.mjs 11499`]) } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.${TAG}`) } catch {}
  try { rcon(`clear ${NAME}`, 'kill @e[type=item,x=700,y=120,z=700,distance=..30]', 'fill 690 120 690 710 123 710 minecraft:air replace minecraft:crafting_table') } catch {}
}
main().catch(e => console.error('FATAL', e.message)).finally(() => cleanup().then(() => process.exit(0)))
process.on('SIGINT', () => cleanup().then(() => process.exit(1)))
process.on('SIGTERM', () => cleanup().then(() => process.exit(1)))
