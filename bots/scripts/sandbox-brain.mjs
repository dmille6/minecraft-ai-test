// A scripted "model" for the SANDBOX: speaks Ollama's /api/chat shape, answers every decision
// with the next line of SANDBOX_SCRIPT (";"-separated, last line repeats), echoes the prompt's
// truncation sentinel. Loopback only. Usage: SANDBOX_SCRIPT="goto 380 63 235;idle" node scripts/sandbox-brain.mjs [port]
import http from 'node:http'
const port = Number(process.argv[2] || 11499)
const script = (process.env.SANDBOX_SCRIPT || 'idle').split(';').map(s => s.trim()).filter(Boolean)
const delayMs = Number(process.env.SANDBOX_DELAY_MS || 0)   // answer 'status' until the loader has placed the bot
const started = Date.now()
let i = 0
const parse = line => {
  const [skill, ...rest] = line.split(/\s+/); const args = {}
  if (skill === 'goto' && rest.length >= 3) { args.x = +rest[0]; args.y = +rest[1]; args.z = +rest[2] }
  else if (skill === 'mine' && rest.length) args.y = +rest[0]
  else if (skill === 'gather' && rest.length) { args.block = rest[rest.length - 1]; if (rest.length > 1) args.count = +rest[0] }
  else if (skill === 'explore' && rest.length) args.blocks = +rest[0]
  else if (skill === 'craft' && rest.length) { args.item = rest[rest.length - 1]; if (rest.length > 1) args.count = +rest[0] }
  return { skill, args }
}
http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c)
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('sandbox brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const text = msgs.map(m => String(m.content || '')).join('\n')
    const sentinel = (text.match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    const line = (Date.now() - started < delayMs) ? 'status' : script[Math.min(i, script.length - 1)]
    if (Date.now() - started >= delayMs) i++
    const { skill, args } = parse(line)
    const content = JSON.stringify({ skill, args, reason: `sandbox script: ${line}`.slice(0, 60), saw_end: sentinel })
    console.log(`decision ${i}: ${line} (sentinel ${sentinel || 'none'})`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content }, done: true,
      total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
}).listen(port, '127.0.0.1', () => console.log(`sandbox brain on 127.0.0.1:${port} script=${script.join(' ; ')}`))
