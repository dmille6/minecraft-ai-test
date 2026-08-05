#!/usr/bin/env node
// Human-readable activity feed for the agents.
//
// Reads the JSONL telemetry directly (the source of truth, not Elasticsearch)
// and renders what each bot has been DOING in plain language, newest first.
//
// Deliberately describes events rather than claiming lessons. "Got walled in
// while mining, dug out" is what happened; "learned not to get trapped" is a
// claim about the agent's future behaviour that nothing here supports -- the
// agent has no memory between runs. When persistent learning exists, this
// wording can change, and the difference will matter.
//
// Serves:
//   /            human page, auto-refreshing
//   /api/status  JSON for the homepage widget

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const LOG_DIR = process.env.LOG_DIR || '/srv/minecraft/bots/logs'
const PORT = Number(process.env.STATUS_PORT || 3008)
const MAX_ACTIONS = Number(process.env.STATUS_ACTIONS || 25)

const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`

/** Turn one telemetry record into a sentence a human would say. */
function describe(rec) {
  const s = rec.skill ?? {}
  const name = s.name ?? ''
  const detail = s.detail ?? ''
  const delta = s.inventory_delta ?? {}
  const gained = Object.entries(delta).filter(([, v]) => v > 0)

  // --- hazards and interventions ---------------------------------------
  const HAZARD = {
    _death: ['💀', 'died'],
    _entombed: ['⛏️', 'got walled in underground and had to dig out'],
    _trapped_in_canopy: ['🌲', 'got stranded up in tree branches'],
    _reflex_drowning: ['🌊', 'started drowning and surfaced'],
    _reflex_danger_block: ['🔥', 'stepped into something dangerous and backed off'],
    _reflex_low_health: ['❤️', 'took heavy damage and disengaged'],
    _reflex_stuck: ['🧱', 'got wedged and worked free'],
    _reflex_ate: ['🍖', `ate ${detail || 'some food'}`],
    _livelock_escape: ['🔁', 'kept repeating itself, so moved somewhere new'],
    _stagnation: ['⏸️', 'stopped making progress, forced a relocation'],
    _stagnation_reconnect: ['🔌', 'was stuck badly enough to reconnect'],
  }
  if (HAZARD[name]) {
    const [icon, text] = HAZARD[name]
    return { icon, text, kind: 'hazard' }
  }

  const ok = s.status === 'success'

  // --- ordinary work -----------------------------------------------------
  if (name === 'gather') {
    if (ok && gained.length) {
      const what = gained.map(([k, v]) => plural(v, k.replace(/_/g, ' '))).join(' and ')
      return { icon: '🪓', text: `chopped ${what}`, kind: 'work' }
    }
    return { icon: '🪓', text: ok ? 'gathered' : `tried to gather but ${shortFail(s)}`, kind: ok ? 'work' : 'fail' }
  }
  if (name === 'craft') {
    if (ok) {
      const made = gained.map(([k, v]) => `${v > 1 ? v + ' ' : 'a '}${k.replace(/_/g, ' ')}`).join(', ')
      return { icon: '🔨', text: `crafted ${made || detail}`, kind: 'work' }
    }
    return { icon: '🔨', text: `could not craft — ${shortFail(s)}`, kind: 'fail' }
  }
  if (name === 'place') {
    return ok
      ? { icon: '📦', text: `placed ${(s.args?.item ?? 'a block').replace(/_/g, ' ')}`, kind: 'work' }
      : { icon: '📦', text: `could not place — ${shortFail(s)}`, kind: 'fail' }
  }
  if (name === 'mine') {
    return { icon: '⛏️', text: ok ? `mined down — ${detail}` : `mining stopped — ${shortFail(s)}`, kind: ok ? 'work' : 'fail' }
  }
  if (name === 'goto') {
    return ok
      ? { icon: '🚶', text: `walked to ${detail.replace('arrived at ', '')}`, kind: 'move' }
      : { icon: '🚶', text: `could not reach that spot — ${shortFail(s)}`, kind: 'fail' }
  }
  if (name === 'home') return { icon: '🏠', text: ok ? 'headed home' : 'could not get home', kind: 'move' }
  if (name === 'eat') return { icon: '🍖', text: ok ? detail : 'had nothing to eat', kind: ok ? 'work' : 'fail' }
  if (name === 'sleep') return { icon: '🛏️', text: ok ? 'slept through the night' : `could not sleep — ${shortFail(s)}`, kind: ok ? 'work' : 'fail' }
  if (name === 'deposit') return { icon: '🧰', text: ok ? detail : 'could not deposit', kind: ok ? 'work' : 'fail' }
  if (name === 'status') return null   // internal chatter, not interesting
  if (name === 'follow' || name === 'come') return { icon: '👣', text: ok ? detail : 'lost track of the player', kind: 'move' }

  return { icon: '•', text: `${name}: ${detail || s.status}`, kind: ok ? 'work' : 'fail' }
}

function shortFail(s) {
  const c = s.fail_class
  const MAP = {
    stuck: 'it got stuck', no_path: 'there was no way through',
    path_timeout: 'the route took too long to work out',
    nothing_found: 'nothing was in range', missing_tool: 'it lacked the right tool',
    missing_ingredients: 'it was missing materials', inventory: 'an inventory problem',
    timeout: 'it ran out of time', path_interrupted: 'it was interrupted',
  }
  return MAP[c] ?? (s.detail ?? 'unknown reason').slice(0, 70)
}

function readBot(file) {
  const name = path.basename(file).replace(/^skill-/, '').replace(/\.jsonl$/, '')
  let lines = []
  try {
    const buf = fs.readFileSync(file, 'utf8')
    lines = buf.split('\n').filter(Boolean).slice(-400)
  } catch { return null }

  const recs = []
  for (const l of lines) { try { recs.push(JSON.parse(l)) } catch { /* partial write */ } }
  if (!recs.length) return null

  const actions = []
  for (let i = recs.length - 1; i >= 0 && actions.length < MAX_ACTIONS; i--) {
    const d = describe(recs[i])
    if (!d) continue
    actions.push({ ...d, at: recs[i]['@timestamp'], run: recs[i].run_id })
  }

  const last = recs[recs.length - 1]
  const since = Date.now() - new Date(last['@timestamp']).getTime()
  const window = recs.filter(r => Date.now() - new Date(r['@timestamp']).getTime() < 3600_000)
  const real = window.filter(r => !(r.skill?.name ?? '').startsWith('_'))
  const ok = real.filter(r => r.skill?.status === 'success').length

  return {
    bot: name,
    role: last.bot?.role ?? '?',
    run_id: last.run_id,
    code_version: last.code?.version,
    position: last.bot?.pos,
    health: last.bot?.health, hunger: last.bot?.hunger,
    seconds_since_last_action: Math.round(since / 1000),
    live: since < 180_000,
    last_hour: { attempts: real.length, succeeded: ok,
                 success_rate: real.length ? Math.round(ok / real.length * 100) : null,
                 hazards: window.length - real.length },
    actions,
  }
}

function collect() {
  let files = []
  try {
    files = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('skill-') && f.endsWith('.jsonl'))
  } catch { /* dir may not exist yet */ }
  return files.map(f => readBot(path.join(LOG_DIR, f))).filter(Boolean)
}

const ago = iso => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}
const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

function page(bots) {
  const cards = bots.map(b => `
    <section class="bot">
      <h2>${esc(b.bot)} <span class="role">${esc(b.role)}</span>
        <span class="dot ${b.live ? 'live' : 'idle'}"></span>
        <span class="sub">${b.live ? 'active' : 'idle'} · last action ${b.seconds_since_last_action}s ago</span>
      </h2>
      <div class="stats">
        <span>❤️ ${b.health ?? '?'}</span><span>🍗 ${b.hunger ?? '?'}</span>
        <span>📍 ${b.position ? `${Math.round(b.position.x)}, ${Math.round(b.position.y)}, ${Math.round(b.position.z)}` : '?'}</span>
        <span>past hour: ${b.last_hour.succeeded}/${b.last_hour.attempts} succeeded${b.last_hour.success_rate !== null ? ` (${b.last_hour.success_rate}%)` : ''}</span>
        <span>${b.last_hour.hazards} incidents</span>
        <span class="ver">${esc(b.run_id ?? '')} · ${esc(b.code_version ?? '')}</span>
      </div>
      <ol class="feed">
        ${b.actions.map(a => `<li class="${a.kind}"><span class="ic">${a.icon}</span>
          <span class="tx">${esc(a.text)}</span><span class="ts">${ago(a.at)}</span></li>`).join('')}
      </ol>
    </section>`).join('')

  return `<!doctype html><meta charset="utf-8"><title>Agent activity</title>
<meta http-equiv="refresh" content="20">
<style>
 :root{color-scheme:dark}
 body{background:#11141a;color:#e6e8ec;font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;margin:0;padding:28px}
 h1{font-size:19px;margin:0 0 4px;font-weight:600}
 .lead{color:#8b93a1;font-size:13px;margin:0 0 26px;max-width:64ch}
 .bot{background:#171b23;border:1px solid #232936;border-radius:12px;padding:18px 20px;margin-bottom:20px;max-width:74ch}
 h2{font-size:16px;margin:0 0 10px;display:flex;align-items:center;gap:9px;font-weight:600}
 .role{color:#8b93a1;font-weight:400;font-size:13px}
 .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
 .dot.live{background:#3fb950;box-shadow:0 0 7px #3fb95088}.dot.idle{background:#6e7681}
 .sub{color:#8b93a1;font-weight:400;font-size:12px}
 .stats{display:flex;flex-wrap:wrap;gap:14px;color:#8b93a1;font-size:12.5px;
        padding-bottom:12px;margin-bottom:6px;border-bottom:1px solid #232936}
 .ver{margin-left:auto;font-family:ui-monospace,monospace;font-size:11px;opacity:.65}
 .feed{list-style:none;margin:0;padding:0}
 .feed li{display:flex;gap:11px;align-items:baseline;padding:5px 0;border-bottom:1px solid #1c2029}
 .feed li:last-child{border-bottom:0}
 .ic{width:19px;text-align:center;flex:none}
 .tx{flex:1}.ts{color:#6e7681;font-size:11.5px;flex:none;font-variant-numeric:tabular-nums}
 li.fail .tx{color:#d98b8b}li.hazard .tx{color:#e0b341}li.move .tx{color:#9aa4b2}
 footer{color:#6e7681;font-size:12px;margin-top:28px;max-width:64ch}
</style>
<h1>Agent activity</h1>
<p class="lead">What each bot has actually been doing, newest first. These are
observations, not lessons — the agents have no memory between runs, so nothing
here means a bot has learned anything.</p>
${cards || '<p class="lead">No agent logs found yet.</p>'}
<footer>Auto-refreshes every 20s · read straight from the JSONL telemetry on disk</footer>`
}

http.createServer((req, res) => {
  const bots = collect()
  if (req.url?.startsWith('/api')) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end(JSON.stringify({ generated: new Date().toISOString(), bots }, null, 2))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(page(bots))
}).listen(PORT, '0.0.0.0', () =>
  console.log(`agent status server on :${PORT} reading ${LOG_DIR}`))
