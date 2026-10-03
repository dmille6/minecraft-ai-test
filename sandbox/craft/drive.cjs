// SANDBOX-ONLY: run the REAL bot (BOT_ROOT, no preload, no shims) on the 1.21.8 sandbox, drive `craft` decisions
// through the queue brain, oracle = RCON `clear <bot> <item> 0` counts + item entities near.
// node drive.cjs <arm> <rounds> <cells> <botRoot>
'use strict'
const { execFileSync, spawn } = require('child_process')
const fs = require('fs'); const path = require('path')
const ARM = process.argv[2]
const ROUNDS = Number(process.argv[3] || 1)
const CELLS = process.argv[4].split(',')
const BOT_ROOT = process.argv[5]
if (!ARM || !BOT_ROOT) throw new Error('usage')
const R = process.env.CRAFT_REPO || path.resolve(__dirname, '../..')   // the checkout holding sandbox/run-bot.sh
// outputs (queue, brain log, bot stdout, traces, results) go to sandbox/log/craft (gitignored), never next to the code
const D = __dirname
const L = `${R}/sandbox/log/craft`; fs.mkdirSync(L, { recursive: true })
const NAME = 'sandbox-Crafty'
const LOGREL = `./sandbox/log/craftsync-skill/${ARM}`
const LOGABS = `${R}/sandbox/log/craftsync-skill/${ARM}`
const SKILLLOG = `${LOGABS}/skill-${NAME}.jsonl`
const BOTOUT = `${R}/sandbox/log/craftsync-skill/bot-${ARM}.out`
const QUEUE = path.join(L, `queue-${ARM}.txt`)
const RES = `${R}/sandbox/log/craftsync-skill/results-${ARM}.jsonl`
const sleep = ms => new Promise(r => setTimeout(r, ms))

function rcon (...cmds) {
  const out = execFileSync('ssh', ['mike@10.0.0.30', 'python3 /tmp/sbx-rcon.py sandbox -'], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 60000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const FILLER = ['dirt', 'andesite', 'diorite', 'granite']
// give: items into the bag. yield: expected gain of product. alt: alternate 'craft X' / 'craft 1 X'.
const SPEC = {
  'fresh-stone': { cmd: 'craft stone_pickaxe', product: 'stone_pickaxe', table: 'none', give: [['crafting_table', 1], ['cobblestone', 8], ['stick', 5]], alt: true },
  'exist-stone': { cmd: 'craft stone_pickaxe', product: 'stone_pickaxe', table: 'exist', give: [['cobblestone', 8], ['stick', 5]], alt: true },
  'fresh-wood': { cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe', table: 'none', give: [['crafting_table', 1], ['oak_planks', 7], ['stick', 4]], alt: true },
  'exist-wood': { cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe', table: 'exist', give: [['oak_planks', 7], ['stick', 4]], alt: true },
  'sticks': { cmd: 'craft stick', product: 'stick', table: 'none', give: [['oak_planks', 6]], yield: 4, alt: true },
  'planks': { cmd: 'craft oak_planks', product: 'oak_planks', table: 'none', give: [['oak_log', 3]], yield: 4, alt: true },
  'stick4-exact': { cmd: 'craft 4 stick', product: 'stick', table: 'none', give: [['oak_planks', 2]], yield: 4 },
  'stick4-spare': { cmd: 'craft 4 stick', product: 'stick', table: 'none', give: [['oak_planks', 8]], yield: 4 },
  'planks8-spare': { cmd: 'craft 8 oak_planks', product: 'oak_planks', table: 'none', give: [['oak_log', 5]], yield: 8 },
  'recursive-8log': { cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe', table: 'none', give: [['oak_log', 8]], names: ['oak_planks', 'stick', 'crafting_table'] },
  'recursive': { cmd: 'craft wooden_pickaxe', product: 'wooden_pickaxe', table: 'none', give: [['oak_log', 4]], names: ['oak_planks', 'stick', 'crafting_table'] },
}
function counts (names) {
  const cmds = names.map(n => `clear ${NAME} minecraft:${n} 0`)
  cmds.push('execute positioned 700 120 700 if entity @e[type=item,distance=..12]')
  const r = rcon(...cmds); const o = {}
  names.forEach((n, i) => { const m = r[i]?.reply.match(/Found (\d+)/); o[n] = m ? +m[1] : (/No items were found/.test(r[i]?.reply) ? 0 : `?${r[i]?.reply}`) })
  const m = r[names.length]?.reply.match(/count: (\d+)/); o._items = m ? +m[1] : 0
  return o
}
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const grepCount = pat => lines(BOTOUT).filter(l => pat.test(l)).length
const lastLine = pat => lines(BOTOUT).filter(l => pat.test(l)).pop() || ''

let bot, brain
async function main () {
  for (const t0 = Date.now(); ;) {
    const pl = rcon('list')[0].reply
    if (/There are 0 of/.test(pl)) break
    if (Date.now() - t0 > 3600000) throw new Error('sandbox not empty: ' + pl)
    console.log('waiting:', pl.trim()); await sleep(20000)
  }
  const envRel = `sandbox/.env.csk-${ARM}`
  let env = fs.readFileSync(`${R}/sandbox/sandbox-bot-scripted.env`, 'utf8')
  env = env.replace(/^BOT_NAME=.*$/m, `BOT_NAME=${NAME}`).replace(/^LOG_DIR=.*$/m, `LOG_DIR=${LOGREL}`).replace(/^STATE_DIR=.*$/m, `STATE_DIR=./sandbox/state/craftsync-skill-${ARM}`)
    .replace(/^HOME_X=.*$/m, 'HOME_X=700').replace(/^HOME_Y=.*$/m, 'HOME_Y=120').replace(/^HOME_Z=.*$/m, 'HOME_Z=700')
    .replace(/^BOARD_X=.*$/m, 'BOARD_X=700').replace(/^BOARD_Y=.*$/m, 'BOARD_Y=120').replace(/^BOARD_Z=.*$/m, 'BOARD_Z=700')
    .replace(/^MEMORY_POOL=.*$/m, `MEMORY_POOL=sbxcsk-${ARM}`) + '\nMAX_CONSECUTIVE_FAILURES=50\n'
  fs.writeFileSync(`${R}/${envRel}`, env)
  fs.writeFileSync(QUEUE, '')
  brain = spawn('node', [path.join(D, 'qbrain.mjs'), '11499'], { env: { ...process.env, QUEUE_FILE: QUEUE }, stdio: ['ignore', fs.openSync(path.join(L, `brain-${ARM}.log`), 'a'), 'inherit'] })
  await sleep(1000)
  const bo = fs.openSync(BOTOUT, 'a')
  bot = spawn('bash', [`${R}/sandbox/run-bot.sh`, envRel], { cwd: R, env: { ...process.env, BOT_ROOT }, stdio: ['ignore', bo, bo] })
  const n0spawn = grepCount(/spawned pos=/)
  for (const t0 = Date.now(); grepCount(/spawned pos=/) <= n0spawn;) { if (Date.now() - t0 > 60000) throw new Error('no spawn'); await sleep(500) }
  rcon(`gamemode survival ${NAME}`, 'fill 690 119 690 710 119 710 minecraft:stone', 'fill 690 120 690 710 123 710 minecraft:air')
  await sleep(8000)
  for (let k = 0; k < ROUNDS; k++) {
    for (const cell of CELLS) {
      const spec = SPEC[cell]
      const id = `${ARM}:${cell}:${k}`
      const cmds = [`clear ${NAME}`, 'kill @e[type=item,x=700,y=120,z=700,distance=..30]', 'fill 690 120 690 710 123 710 minecraft:air replace minecraft:crafting_table', `tp ${NAME} 700.5 120 700.5`]
      for (let s = 9; s < 21; s++) cmds.push(`item replace entity ${NAME} container.${s} with minecraft:${FILLER[s % 4]} 64`)
      let slot = k % 3
      for (const [it, c] of spec.give) cmds.push(`item replace entity ${NAME} container.${slot++} with minecraft:${it} ${c}`)
      if (spec.table === 'exist') cmds.push('setblock 702 120 700 minecraft:crafting_table')
      rcon(...cmds)
      await sleep(2500)
      const names = [spec.product, 'crafting_table', ...spec.give.map(g => g[0]), ...(spec.names || [])].filter((v, i, a) => a.indexOf(v) === i)
      const before = counts(names)
      const skill0 = lines(SKILLLOG).length
      const pat = /skill craft ->|rejected why=.*"skill":"craft"/
      let row = ''; let sent = ''
      const tStart = Date.now()
      for (let attempt = 0; attempt < 4; attempt++) {
        const n0 = grepCount(pat)
        sent = spec.alt && (attempt + k) % 2 ? spec.cmd.replace(/^craft /, 'craft 1 ') : spec.cmd
        fs.appendFileSync(QUEUE, sent + '\n')
        const ts = Date.now()
        while (grepCount(pat) <= n0 && Date.now() - ts < 200000) await sleep(500)
        row = lastLine(pat).slice(0, 500)
        if (/skill craft ->/.test(row)) break
        await sleep(3000)
      }
      await sleep(3000)
      const after = counts(names)
      const tableBlocks = rcon('execute if block 702 120 700 minecraft:crafting_table')[0].reply
      // the rows this trial wrote
      const newRows = lines(SKILLLOG).slice(skill0).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      const craftRows = newRows.filter(r => r.skill?.name === 'craft').map(r => ({ status: r.skill.status, fail: r.skill.fail_class, ms: r.skill.duration_ms, detail: (r.skill.detail || '').slice(0, 200), args: r.skill.args }))
      const syncRows = newRows.filter(r => r.skill?.name === '_craft_sync').map(r => ({ status: r.skill.status, ms: r.skill.duration_ms, args: r.skill.args, detail: (r.skill.detail || '').slice(0, 300) }))
      const top = craftRows[craftRows.length - 1] || {}
      const gain = after[spec.product] - before[spec.product]
      const want = spec.yield || 1
      const status = top.status || (/rejected/.test(row) ? 'rejected' : 'none')
      let verdict
      if (status === 'success') verdict = gain === want ? 'OK' : gain === 0 ? 'LOST' : gain < want ? 'SHORT' : 'OVER'
      else verdict = gain === 0 ? 'HONEST_FAIL' : gain >= want ? `FALSE_FAIL${gain > want ? '+OVER' : ''}` : 'PARTIAL_FAIL'
      const r = { id, arm: ARM, cell, k, sent, verdict, status, gain, want, before, after, ms: top.ms, wallMs: Date.now() - tStart, craftRows, syncRows, row, tableBlocks }
      fs.appendFileSync(RES, JSON.stringify(r) + '\n')
      const sa = syncRows.map(s => s.detail).join(' || ')
      console.log(`${id.padEnd(24)} ${verdict.padEnd(12)} ${status.padEnd(8)} ${spec.product} ${before[spec.product]}->${after[spec.product]} items${after._items} ${top.ms}ms | ${(top.detail || row).slice(0, 110)} | ${sa.slice(0, 260)}`)
    }
  }
}
async function cleanup () {
  try { bot && bot.kill('SIGTERM') } catch {}
  try { brain && brain.kill('SIGTERM') } catch {}
  await sleep(2000)
  try { execFileSync('pkill', ['-f', 'qbrain.mjs 11499']) } catch {}
  try { fs.unlinkSync(`${R}/sandbox/.env.csk-${ARM}`) } catch {}
  try { rcon(`clear ${NAME}`, 'kill @e[type=item,x=700,y=120,z=700,distance=..30]', 'fill 690 120 690 710 123 710 minecraft:air replace minecraft:crafting_table') } catch {}
}
main().catch(e => console.error('FATAL', e.message)).finally(() => cleanup().then(() => process.exit(0)))
process.on('SIGINT', () => cleanup().then(() => process.exit(1)))
process.on('SIGTERM', () => cleanup().then(() => process.exit(1)))
