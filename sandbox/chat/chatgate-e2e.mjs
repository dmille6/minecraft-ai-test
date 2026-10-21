#!/usr/bin/env node
// chatgate-01 PAPER DRIVER (2026-10-22). SANDBOX ONLY (Paper 1.21.8, 10.0.0.30:25599..25601; never sandbox4).
// Design: docs/reports/comms-design-2026-10-21.md section 5.3 (the Paper tests) and section 8 step 0 (the chat-event probe).
//
// A REAL mineflayer bot on a sandbox server with the build's REAL attachCommands and Runner from <botRoot> (unmodified),
// holding a synthetic long skill (`__hold`: resolves only on abort) so a `stop` that reaches the runner is visible as the
// skill ending `interrupted`. Two more REAL mineflayer clients play the humans: `griefer1` (unlisted), `mike` (the
// showcase owner name), and then `sbx-cg-Bravo` (a peer-shaped, hyphenated name: the fleet's). Every line the bot hears
// is recorded with mineflayer's position ('chat' / 'system') and whether mineflayer's `chat` event fired for it -- the
// probe. Outcomes are read from the runner, the bot's rows and the WORLD (RCON `data get entity ... Pos`).
// The base also attaches its startComms (peer ingestion) on a stub world-facts, so the probe sees whether ingestion fires.
// DEATH PROVENANCE: RCON `kill` of the bot, and a player typing a death-shaped line; each line's position and the
// candidate's deathCauseText verdict are recorded.
//
//   node sandbox/chat/chatgate-e2e.mjs <botRoot> <label> [server]
// Refuses unless the sandbox lock (/tmp/mcai-sandbox.lock on 10.0.0.31) names `chatgate01`. No world edits but `kill`.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const [BOT_ROOT, LABEL, SERVER = 'sandbox3'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL) throw new Error('usage: chatgate-e2e.mjs <botRoot> <label> [server]')
const PORTS = { sandbox: 25599, sandbox2: 25600, sandbox3: 25601 }        // sandbox4 is the model benchmark's: never
if (!PORTS[SERVER]) throw new Error('sandbox servers only (sandbox, sandbox2, sandbox3)')
const lock = execFileSync('ssh', ['mike@10.0.0.31', 'cat /tmp/mcai-sandbox.lock/owner 2>/dev/null || echo NOLOCK'], { encoding: 'utf8' })
if (!/chatgate01/.test(lock)) throw new Error(`the sandbox lock does not name chatgate01: ${lock.trim()}`)
const NAME = 'sbx-cg-Alpha'
const OUT = process.env.CG_OUT || path.join(os.tmpdir(), 'chatgate-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const LOGDIR = fs.mkdtempSync(path.join(OUT, `${LABEL}-`))
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
Object.assign(process.env, {
  BOT_NAME: NAME, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
  MEMORY_POOL: `sbxcg-${LABEL}`, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]), MINECRAFT_VERSION: '1.21.8',
  MINECRAFT_AUTH: 'offline', SKILL_TIMEOUT_MS: '180000', OLLAMA_MODEL: 'qwen2.5:7b-instruct', OLLAMA_BASE_URL: 'http://127.0.0.1:11499',
  LLM_ENABLED: 'false', LOG_LEVEL: 'warn', CODE_VERSION: `sandbox-${LABEL}`, RUN_ID: 'sandbox-chatgate01', LOG_DIR: LOGDIR,
  STATE_DIR: fs.mkdtempSync(path.join(OUT, `${LABEL}-state-`)), OWNER_CHAT_NAMES: process.env.CG_OWNER ?? 'mike',
})
const breq = createRequire(path.join(BOT_ROOT, 'bots/package.json'))
const mineflayer = breq('mineflayer')
const CMDS = await import(path.join(BOT_ROOT, 'bots/src/commands.mjs'))
const COMMS = await import(path.join(BOT_ROOT, 'bots/src/comms.mjs'))
const { SKILLS } = await import(path.join(BOT_ROOT, 'bots/src/skills.mjs'))
const { Runner } = await import(path.join(BOT_ROOT, 'bots/src/runner.mjs'))
const { tapRecords } = await import(path.join(BOT_ROOT, 'bots/src/logger.mjs'))
let sha = process.env.CG_SHA || ''; try { sha = sha || execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch { sha = sha || 'unknown' }

const SSH = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-cg-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  return res
}
const posOf = () => { const m = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(rcon(`data get entity ${NAME} Pos`)[0]?.reply ?? ''); return m ? { x: +(+m[1]).toFixed(2), y: +(+m[2]).toFixed(2), z: +(+m[3]).toFixed(2) } : null }
const result = r => { fs.appendFileSync(RES, JSON.stringify({ at: new Date().toISOString(), label: LABEL, sha, server: SERVER, ...r }) + '\n'); P_('RESULT', r) }

async function client (username) {
  const c = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username, auth: 'offline', version: '1.21.8' })
  await new Promise((resolve, reject) => { c.once('spawn', resolve); c.once('kicked', r => reject(new Error(`${username} kicked ${r}`))); c.once('error', reject) })
  const heard = []
  c.on('message', (m, position) => heard.push({ t: Date.now(), position, text: m.toString() }))
  c.on('whisper', (from, text) => heard.push({ t: Date.now(), whisper: from, text }))
  await sleep(1500)
  return { c, heard }
}

// ---------------------------------------------------------------- the bot
const bot = mineflayer.createBot({ host: '10.0.0.30', port: PORTS[SERVER], username: NAME, auth: 'offline', version: '1.21.8' })
await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', r => reject(new Error('kicked ' + r))); bot.once('error', reject) })
rcon(`gamemode survival ${NAME}`, `effect give ${NAME} minecraft:resistance 900 4 true`)
await sleep(1500)
const heard = []
bot.on('message', (m, position) => heard.push({ t: Date.now(), position, text: m.toString(), chatEvent: false }))
bot.on('chat', (username, message) => { const h = heard.findLast(x => x.text.includes(message)); if (h) { h.chatEvent = true; h.chatUser = username } else heard.push({ t: Date.now(), chatEvent: true, chatUser: username, text: message }) })
const rows = []; const untap = tapRecords(r => rows.push(r))
const runner = new Runner(bot)
const ingested = []
const worldFacts = { reportHazard: (...a) => ingested.push(['hazard', ...a.slice(0, 1), a[3]]), reportUnreachable: (...a) => ingested.push(['unreachable', a[0], a[1]]) }
const hasPeerIngest = typeof COMMS.startComms === 'function'
if (hasPeerIngest) COMMS.startComms(bot, worldFacts)
const gate = CMDS.attachCommands(bot, runner)
SKILLS.__hold = { run: (_ctx, _args, signal) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => { const e = new Error('aborted'); e.aborted = true; reject(e) }, { once: true }) }) }
let holdEnd = null
const hold = runner.run('__hold', {}, { trigger: 'llm:sandbox' }).then(r => { holdEnd = { at: Date.now(), r } })
await sleep(500)
const p0 = posOf()
P_('bot up', { pos: p0, peerIngestAttached: hasPeerIngest, gate: gate ? 'gated' : 'base' })

const steps = []
async function say (who, line, waitMs = 3500) {
  const t = Date.now()
  who.c.chat(line)
  await sleep(waitMs)
  const lines = heard.filter(h => h.t >= t)
  const step = { from: who.c.username, line, botHeard: lines.map(h => ({ position: h.position, chatEvent: h.chatEvent, chatUser: h.chatUser ?? null, text: h.text.slice(0, 120) })),
                 holdRunning: runner.current?.skill === '__hold', holdEnded: holdEnd ? (holdEnd.r?.status ?? '?') : null,
                 reply: who.heard.filter(h => h.t >= t && (h.whisper === NAME || h.text.includes(`<${NAME}>`) || h.text.includes(`${NAME} whispers`))).map(h => ({ whisper: h.whisper ?? null, position: h.position ?? null, text: h.text.slice(0, 120) })) }
  steps.push(step); P_('step', step)
  return step
}

try {
  // 1. an unlisted plain name: !stop, !status, a valid !goto
  const g = await client('griefer1')
  await say(g, '!stop')
  await say(g, '!status')
  await say(g, `!goto ${Math.round(p0.x) + 10} ${Math.round(p0.y)} ${Math.round(p0.z)}`)
  await say(g, `${NAME} come`)
  // a player's death-shaped line (provenance)
  await say(g, `${NAME} tried to swim in lava`)
  // 2. the owner name: status (positive control), then stop (refused on the candidate)
  const m = await client('mike')
  await say(m, '!status', 5000)
  await say(m, '!stop')
  g.c.quit('step over'); await sleep(2500)
  // 3. a peer-shaped name: a forged [fleet] hazard and a peer `come`
  const peer = await client('sbx-cg-Bravo')
  await say(peer, `[fleet] sbxcg-${LABEL} hazard entombed ${Math.round(p0.x)} ${Math.round(p0.y)} ${Math.round(p0.z)} x9`)
  await say(peer, `${NAME} come`)
  await say(peer, '!stop')
  const p1 = posOf()
  // 4. the server's own death message for the bot (RCON kill), then respawn
  const tk = Date.now()
  rcon(`kill ${NAME}`)
  await sleep(4000)
  const deathLines = heard.filter(h => h.t >= tk && h.text.startsWith(`${NAME} `)).map(h => ({ position: h.position, text: h.text.slice(0, 120),
    candidateCause: typeof CMDS.deathCauseText === 'function' ? CMDS.deathCauseText(h.text, h.position, NAME) : 'n/a (base)' }))
  const playerDeathShaped = steps.find(s => /tried to swim in lava/.test(s.line))?.botHeard.map(h => ({ ...h,
    candidateCause: typeof CMDS.deathCauseText === 'function' ? CMDS.deathCauseText(h.text, h.position, NAME) : 'n/a (base)' })) ?? []
  try { bot.respawn?.() } catch {}
  const chatRows = rows.filter(r => r.trigger === 'chat' || /^_chat/.test(r.skill?.name ?? '')).map(r => ({ name: r.skill?.name, trigger: r.trigger, status: r.skill?.status, detail: String(r.skill?.detail ?? '').slice(0, 160) }))
  result({ scene: 'chatgate', peerIngestAttached: hasPeerIngest, chatEventFired: heard.filter(h => h.chatEvent).length, linesHeard: heard.length,
           positions: [...new Set(heard.map(h => h.position))], steps, ingested, holdRunningAtEnd: runner.current?.skill === '__hold', holdEnd: holdEnd ? holdEnd.r?.status : null,
           moved: p0 && p1 ? +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2) : null, deathLines, playerDeathShaped, chatRows,
           gateStats: gate?.stats ?? null })
  peer.c.quit('done'); m.c.quit('done')
} finally {
  untap()
  try { runner.cancel('scene over') } catch {}
  await hold.catch(() => {})
  try { bot.quit('scene over') } catch {}
  await sleep(2000)
  process.exit(0)
}
