// Reproduce mineflayer's structure exactly: stopDigging is REASSIGNED inside
// dig(), emits synchronously, and is called by an unrelated timeout handler.
import { EventEmitter } from 'node:events'
import { installDigCollisionWatch } from '/Users/darrellmiller/Documents/mcai-digwatch/bots/src/digcollision.mjs'

const bot = new EventEmitter()
bot.targetDigBlock = null
// --- this stands in for node_modules/mineflayer/lib/plugins/digging.js
function mineflayerDig (block) {
  bot.targetDigBlock = block
  bot.stopDigging = () => {                       // reassigned per dig, as upstream does
    const b = bot.targetDigBlock
    bot.targetDigBlock = null
    bot.emit('diggingAborted', b)                 // SYNCHRONOUS, like digging.js:187
    bot.stopDigging = () => {}                    // then noop'd, like upstream
  }
}
const rows = []
installDigCollisionWatch(bot, r => rows.push(r))

// --- and this stands in for skills.mjs:1204's onTimeout
function collectPathOnTimeout () { bot.stopDigging() }
function withTimeoutWrapper () { collectPathOnTimeout() }

mineflayerDig({ name: 'cobblestone', position: { x: 10, y: 20, z: 30 } })
withTimeoutWrapper()

console.log('rows:', rows.length)
console.log(rows[0]?.detail)
const d = rows[0]?.detail || ''
console.log('\nnames the caller chain?  ', /stackproof\.mjs:\d+/.test(d) ? 'YES' : 'NO')
console.log('reaches past the emitter? ', (d.match(/stackproof\.mjs/g) || []).length > 1 ? 'YES (multiple frames)' : 'only one frame')
console.log('says "unknown"?           ', d.includes('unknown') ? 'YES — the walk failed' : 'no')
