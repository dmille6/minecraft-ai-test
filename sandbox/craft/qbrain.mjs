// Queue brain (loopback only): answers each decision with the next unread line of QUEUE_FILE, else 'status'.
import http from 'node:http'
import fs from 'node:fs'
const port = Number(process.argv[2] || 11499)
const qf = process.env.QUEUE_FILE
let i = 0
const parse = line => {
  const [skill, ...rest] = line.split(/\s+/); const args = {}
  if (skill === 'craft' && rest.length) { args.item = rest[rest.length - 1]; if (rest.length > 1) args.count = +rest[0] }
  else if (skill === 'goto' && rest.length >= 3) { args.x = +rest[0]; args.y = +rest[1]; args.z = +rest[2] }
  else if (rest.length === 1) args.item = rest[0]   // place dirt, deposit cobblestone, ...
  return { skill, args }
}
http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c)
  req.on('end', () => {
    if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('q brain'); return }
    let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
    const text = msgs.map(m => String(m.content || '')).join('\n')
    const sentinel = (text.match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
    let lines = []; try { lines = fs.readFileSync(qf, 'utf8').split('\n').map(s => s.trim()).filter(Boolean) } catch {}
    let line = 'status'
    if (i < lines.length) { line = lines[i]; i++ }
    const { skill, args } = parse(line)
    const content = JSON.stringify({ skill, args, reason: `sandbox queue: ${line}`.slice(0, 60), saw_end: sentinel })
    console.log(`${new Date().toISOString()} decision q${i}: ${line}`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content }, done: true,
      total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
  })
}).listen(port, '127.0.0.1', () => console.log(`queue brain on 127.0.0.1:${port} file=${qf}`))
