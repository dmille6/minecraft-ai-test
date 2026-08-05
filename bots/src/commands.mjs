// Chat command interface -- the pass-1 stand-in for the cognitive layer.
//
// In pass 2 an LLM picks the same skills with the same arguments. Keeping the
// human interface and the model interface identical means anything that works
// here works there, and a regression is unambiguously the model's fault.
//
// Handoff doc S18: treat Minecraft chat as untrusted input. Every argument is
// validated before it reaches a skill, and unknown verbs are rejected rather
// than guessed at.

import { SKILLS } from './skills.mjs'
import { log } from './logger.mjs'
import { config } from './config.mjs'

const HELP = [
  'commands: gather <n> <block> | goto <x> <y> <z> | come | follow [sec]',
  '          home | deposit [item] | status | stop | resume | help',
]

export function attachCommands(bot, runner) {
  bot.on('chat', async (username, message) => {
    if (username === bot.username) return

    // Addressed either as "<botname> <cmd>" or with a leading "!".
    const lower = message.trim()
    let body = null
    if (lower.startsWith('!')) body = lower.slice(1)
    else if (lower.toLowerCase().startsWith(config.bot.name.toLowerCase() + ' ')) {
      body = lower.slice(config.bot.name.length + 1)
    }
    if (!body) return

    const [verb, ...rest] = body.trim().split(/\s+/)
    const cmd = (verb ?? '').toLowerCase()
    log('info', 'chat command', { from: username, cmd, args: rest.join(' ') })

    try {
      switch (cmd) {
        case 'help':
          HELP.forEach(l => bot.chat(l))
          return

        case 'stop': {
          const had = runner.cancel('user_stop')
          bot.chat(had ? 'stopping' : 'nothing running')
          return
        }

        case 'resume':
          runner.resume()
          bot.chat('resumed')
          return

        case 'status': {
          const r = await runner.run('status', {}, { trigger: 'chat' })
          bot.chat(`${r.detail} | task: ${runner.describe()}`)
          return
        }

        case 'gather': {
          const count = Number(rest[0])
          const block = rest[1]
          if (!Number.isFinite(count) || count <= 0 || count > 512 || !block) {
            bot.chat('usage: gather <count 1-512> <block_name>'); return
          }
          bot.chat(`gathering ${count} ${block}`)
          const r = await runner.run('gather', { block, count }, { trigger: 'chat' })
          bot.chat(`${r.status}: ${r.detail}`)
          return
        }

        case 'goto': {
          const [x, y, z] = rest.map(Number)
          if (![x, y, z].every(Number.isFinite)) { bot.chat('usage: goto <x> <y> <z>'); return }
          bot.chat(`heading to ${x} ${y} ${z}`)
          const r = await runner.run('goto', { x, y, z }, { trigger: 'chat' })
          bot.chat(`${r.status}: ${r.detail}`)
          return
        }

        case 'come': {
          bot.chat('coming')
          const r = await runner.run('come', { player: username }, { trigger: 'chat' })
          bot.chat(`${r.status}: ${r.detail}`)
          return
        }

        case 'follow': {
          const secs = Math.min(Number(rest[0]) || 60, 600)
          bot.chat(`following for ${secs}s`)
          const r = await runner.run('follow', { player: username, durationMs: secs * 1000 }, { trigger: 'chat' })
          bot.chat(`${r.status}: ${r.detail}`)
          return
        }

        case 'home': {
          bot.chat('heading home')
          const r = await runner.run('home', {}, { trigger: 'chat' })
          bot.chat(`${r.status}: ${r.detail}`)
          return
        }

        case 'deposit': {
          bot.chat('depositing')
          const r = await runner.run('deposit', { item: rest[0] ?? null }, { trigger: 'chat' })
          bot.chat(`${r.status}: ${r.detail}`)
          return
        }

        default:
          bot.chat(`unknown command "${cmd}" — try: ${Object.keys(SKILLS).join(', ')}, stop, help`)
      }
    } catch (e) {
      log('error', 'command handler failed', { err: e.message })
      bot.chat(`error: ${e.message}`.slice(0, 200))
    }
  })
}
