// Stage C2 delivery client (bench only; runs on the bots host from the bench tree's node_modules).
// Joins the sandbox world as `mbench_Mayor` (C2_DIRECTOR) in EVERY arm (present-but-silent where it has no role) and says each
// directive from the director's outbox in chat as "<bot> directive <id> <json>". One message per 1.5 s (spam limit);
// every sent line is logged. Usage: node c2_chat.mjs <host> <port> <outbox.jsonl> <log.jsonl>
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(process.env.BOT_TREE_REQUIRE ?? import.meta.url)
const mineflayer = require('mineflayer')
const [host, port, outbox, logf] = process.argv.slice(2)
// The director's name must survive mineflayer's chat pattern (chat.js USERNAME_REGEX: an optional prefix of up to 5
// characters, then \w+). A hyphen either drops the line (it arrives as `messagestr` only and the bots' `chat` handler
// never runs) or truncates the sender (`mb-Mayor` parses as `Mayor`, which directorAllowed then rejects). The C2 smoke of
// 10-07 04:09Z lost all 15 directives this way under the old name `mbench-Mayor`. Minecraft's own name rule is safe.
const NAME = process.env.C2_DIRECTOR ?? 'mbench_Mayor'
if (!/^[a-zA-Z0-9_]{3,16}$/.test(NAME)) { console.error(`refusing: director name ${NAME} is not a parseable chat sender`); process.exit(3) }
const log = o => fs.appendFileSync(logf, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n')
let bot = null, offset = 0, queue = []
function connect () {
  bot = mineflayer.createBot({ host, port: Number(port), username: NAME, auth: 'offline', version: '1.21.8' })
  bot.once('spawn', () => log({ kind: 'mayor_spawn' }))
  bot.on('end', r => { log({ kind: 'mayor_disconnect', reason: String(r) }); setTimeout(connect, 8000) })
  bot.on('error', e => log({ kind: 'mayor_error', err: String(e?.message ?? e) }))
}
connect()
setInterval(() => {                                    // tail the outbox
  try {
    const st = fs.statSync(outbox)
    if (st.size > offset) {
      const fd = fs.openSync(outbox, 'r'); const buf = Buffer.alloc(st.size - offset)
      fs.readSync(fd, buf, 0, buf.length, offset); fs.closeSync(fd)
      const text = buf.toString('utf8'); const end = text.lastIndexOf('\n')
      if (end < 0) return                              // a partial line: wait for its newline
      offset += Buffer.byteLength(text.slice(0, end + 1), 'utf8')
      for (const line of text.slice(0, end).split('\n').filter(Boolean)) {
        try { queue.push(JSON.parse(line)) } catch { log({ kind: 'bad_outbox_line', line: line.slice(0, 200) }) }
      }
    }
  } catch { /* no outbox yet */ }
}, 1000)
setInterval(() => {                                    // say one directive
  if (!queue.length || !bot?.entity) return
  const d = queue.shift()
  let body = JSON.stringify({ o: d.o, s: d.s, l: d.l, w: d.w })
  // chat rejects the section sign and control characters (a kick); JSON.stringify escapes controls already, so this
  // only ever removes a literal section sign, and the JSON stays valid
  const clean = t => t.replace(/[\u0000-\u001f\u007f\u00a7]/g, '')
  body = clean(body)
  let msg = `${d.bot} directive ${d.id} ${body}`
  if (msg.length > 256) { body = clean(JSON.stringify({ o: d.o, s: d.s, l: d.l })); msg = `${d.bot} directive ${d.id} ${body}` }
  if (msg.length > 256) { log({ kind: 'too_long', id: d.id, len: msg.length }); return }
  bot.chat(msg)
  log({ kind: 'said', id: d.id, bot: d.bot, len: msg.length })
}, 1500)
