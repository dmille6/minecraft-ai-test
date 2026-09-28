// Diagnostic: join the SANDBOX as sandbox-ear and print which mineflayer events a chat line arrives as.
import mineflayer from 'mineflayer'
const bot = mineflayer.createBot({ host: '10.0.0.30', port: 25599, username: 'sandbox-ear', version: '1.21.8', auth: 'offline' })
bot.on('chat', (u, m) => console.log('EVENT chat', u, JSON.stringify(m)))
bot.on('whisper', (u, m) => console.log('EVENT whisper', u, JSON.stringify(m)))
bot.on('message', (j, pos) => console.log('EVENT message', pos, JSON.stringify(j.toString()).slice(0, 120)))
bot.on('playerChat', (...a) => console.log('EVENT playerChat', JSON.stringify(a).slice(0, 160)))
bot.once('spawn', () => console.log('ear spawned'))
setTimeout(() => { bot.quit(); process.exit(0) }, 25000)
