// voyager-01: NO COMMAND LEAVES THE BOT PROCESS (design §3.4, §12 factual: wrapping bot.chat alone does not cover
// bot._client.write). Two layers: bot.chat/whisper drop a '/'-line, and the client drops the command packets outright.
// Generated code has no route to either (it sees only the facade); this covers our own code too.

import { filterSay } from './facade.mjs'

export const COMMAND_PACKETS = Object.freeze(new Set(['chat_command', 'chat_command_signed']))

/** Would this outgoing packet run a command? Pure. */
export function isCommandPacket (name, params) {
  if (COMMAND_PACKETS.has(name)) return true
  if (name === 'chat_message' || name === 'chat') {
    const m = String(params?.message ?? '')
    return filterSay(m).why === 'command'
  }
  return false
}

export function installChatGuard (bot, onAttempt = () => {}) {
  const origChat = bot.chat?.bind(bot)
  if (origChat) {
    bot.chat = (text) => {
      const f = filterSay(text)
      if (f.why === 'command') { onAttempt({ source: 'bot.chat', text: String(text).slice(0, 80) }); return }
      if (f.line) origChat(f.line)
    }
  }
  bot.whisper = (to, text) => { onAttempt({ source: 'bot.whisper', text: `/tell ${String(to).slice(0, 16)} ${String(text).slice(0, 60)}` }) }
  const client = bot._client
  if (client && typeof client.write === 'function') {
    const origWrite = client.write.bind(client)
    client.write = (name, params) => {
      if (isCommandPacket(name, params)) { onAttempt({ source: `packet:${name}`, text: String(params?.command ?? params?.message ?? '').slice(0, 80) }); return }
      return origWrite(name, params)
    }
  }
}
