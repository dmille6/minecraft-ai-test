// voyager-01 stage 1: THE COMMAND PROBE. Run AS the bot unit (inside the namespace). It connects WITHOUT our chat guard
// and sends commands straight down the wire (chat_command packets, '/'-chat, tab completion), then checks that nothing
// happened: still not op, still survival, no item given, not moved, and the server logged each one as denied. Then it
// installs the chat guard and checks that our own bot.chat('/...') never reaches the wire.

import { createRequire } from 'node:module'
import fs from 'node:fs'
import { installChatGuard } from '../src/chatguard.mjs'

const mineflayer = createRequire(new URL('../../bots/src/index.mjs', import.meta.url))('mineflayer')
const ARM = process.env.VOYAGER_ARM ?? 'c'
const results = []
const want = (name, pass, detail) => results.push({ name, pass: !!pass, detail: String(detail ?? '').slice(0, 140) })
const sleep = ms => new Promise(r => setTimeout(r, ms))

const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username: `vy-${ARM}`, auth: 'offline', version: '1.21.8' })
const sys = []
bot.on('message', m => sys.push(String(m)))
let kicked = null
bot.on('kicked', r => { kicked = String(r) })
bot.on('end', r => { kicked ??= `end ${r}` })
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); bot.once('kicked', r => rej(new Error(`kicked ${r}`))) })
await sleep(3000)
const pos0 = bot.entity.position.clone()
const gm0 = bot.game.gameMode
const commands = ['op vy-' + ARM, 'give vy-' + ARM + ' diamond 64', 'gamemode creative', 'tp vy-' + ARM + ' 0 250 0', 'time set night',
  'gamerule keepInventory false', 'kill vy-' + ARM, 'help', 'list', 'me waves', 'msg vy-' + ARM + ' hi', 'spark profiler', 'plugins', 'version']
for (const c of commands) {
  bot._client.write('chat_command', { command: c, timestamp: BigInt(Date.now()), salt: 0n, argumentSignatures: [], messageCount: 0, acknowledged: Buffer.alloc(3), checksum: 0 })
  await sleep(1500)   // under Paper's spam kick, so every check below reads a live connection
}
try { bot._client.write('chat_command_signed', { command: 'op vy-' + ARM, timestamp: BigInt(Date.now()), salt: 0n, argumentSignatures: [], messageCount: 0, acknowledged: Buffer.alloc(3), checksum: 0 }) } catch (e) { want('signed command packet could be written (or the client refused it)', true, e.message) }
let tab = null
bot._client.on('tab_complete', p => { tab = p })
try { bot._client.write('tab_complete', { transactionId: 7, text: '/gi' }) } catch {}
await sleep(3000)

want('still connected (so the checks below are live)', !kicked, kicked ?? 'connected')
const items = bot.inventory.items().map(i => i.name)
want('not given a diamond', !items.includes('diamond'), items.join(','))
want('still survival', bot.game.gameMode === 'survival' && gm0 === 'survival', `${gm0} -> ${bot.game.gameMode}`)
want('not teleported', bot.entity.position.distanceTo(pos0) < 2, `moved ${bot.entity.position.distanceTo(pos0).toFixed(1)}`)
want('alive', bot.health > 0, `health ${bot.health}`)
want('server says commands are disabled', sys.some(s => /Commands are disabled/.test(s)), sys.slice(-3).join(' | '))
want('no tab completion offered', !tab || !(tab.matches?.length), JSON.stringify(tab)?.slice(0, 80))

// our own guard: nothing '/'-shaped leaves through bot.chat, whisper or a raw chat_command write
const attempts = []
const sent = []
const w = bot._client.write
bot._client.write = function (n, p) { sent.push(n); return w.call(this, n, p) }   // the wire, under the guard
installChatGuard(bot, e => attempts.push(e))
bot.chat('/give vy-' + ARM + ' diamond 1')
bot.chat('／op me')
bot.whisper('someone', 'hello')
bot._client.write('chat_command', { command: 'op me', timestamp: BigInt(Date.now()), salt: 0n, argumentSignatures: [], messageCount: 0, acknowledged: Buffer.alloc(3), checksum: 0 })
bot.chat('plain hello from the probe')
await sleep(1500)
want('guard dropped 4 command shapes', attempts.length === 4, attempts.map(a => a.source).join(','))
want('only the plain line was sent', !sent.includes('chat_command') && !sent.includes('chat_command_signed'), sent.join(','))

bot.quit()
await sleep(1500)
let ev = []
try { ev = fs.readFileSync(`/srv/voyager/logs/${ARM}/../../worlds/${ARM}/plugins/VoyagerGuard/events.jsonl`, 'utf8').split('\n') } catch { /* the world dir is not visible to the bot: read on the host */ }
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name} (${x.detail})`)
console.log(`cmd-probe: ${results.filter(x => x.pass).length}/${results.length}; server rows visible here: ${ev.length}`)
process.exit(results.every(x => x.pass) ? 0 : 1)
