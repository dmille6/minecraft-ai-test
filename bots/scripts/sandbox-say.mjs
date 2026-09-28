// Operator bot: joins the SANDBOX server as sandbox-op, says one chat line, leaves.
// Usage: node sandbox/say.mjs "!goto 380 63 235"   (the target bot answers chat commands from any player)
import mineflayer from 'mineflayer'
const msg = process.argv[2]; if (!msg) { console.error('usage: node say.mjs "<message>"'); process.exit(2) }
const bot = mineflayer.createBot({ host: '10.0.0.30', port: 25599, username: 'sandbox-op', version: '1.21.8', auth: 'offline' })
bot.once('spawn', () => { setTimeout(() => { bot.chat(msg); console.log('said:', msg); setTimeout(() => { bot.quit(); process.exit(0) }, 1500) }, 1500) })
bot.on('error', e => { console.error('op error', e.message); process.exit(1) })
setTimeout(() => { console.error('op timeout'); process.exit(1) }, 30000)
