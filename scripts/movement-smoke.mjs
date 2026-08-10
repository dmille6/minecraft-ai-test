#!/usr/bin/env node
/**
 * MOVEMENT SMOKE TEST -- the gate that should have existed on 2026-08-05.
 *
 * Instance #1 ran for three days with `goto` at 3/240 (1%) because its server was
 * upgraded to native Paper 1.21.11, which mineflayer 4.37.1 cannot drive: the
 * server re-teleported every bot to byte-identical coordinates twenty times a
 * second and no bot ever took a step. Nine agent-side defects were found and
 * fixed underneath that, none of which were the cause.
 *
 * Nothing in our unit tests could catch it -- it is a property of the SERVER, not
 * of our code. So this runs against a live server before any fleet is allowed to
 * start, with NO reflex layer, NO LLM and NO skills. Just a bare client.
 *
 * TWO assertions, and the second is the one that matters:
 *
 *   1. The bot must actually travel. Obvious, but insufficient on its own --
 *      a bot can jitter a few blocks and look alive.
 *
 *   2. The server must not be asserting authority every tick. A stream of
 *      absolute teleports to UNCHANGED coordinates is the signature of movement
 *      being rejected, and it is visible immediately even when a bot happens to
 *      drift far enough to pass assertion 1. This is the check that would have
 *      failed loudly on day one.
 *
 * Usage:
 *   MINECRAFT_HOST=h MINECRAFT_PORT=25565 MINECRAFT_VERSION=1.21.8 \
 *   PROBE_NAME=Scout01 node scripts/movement-smoke.mjs
 *
 * Exit 0 = safe to start a fleet. Exit 1 = do not.
 */
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
const { pathfinder, Movements, goals } = pathfinderPkg

const HOST = process.env.MINECRAFT_HOST
const PORT = Number(process.env.MINECRAFT_PORT || 25565)
const VERSION = process.env.MINECRAFT_VERSION || undefined
// A NAME NO REAL BOT USES.
//
// This defaulted to 'Scout01', which is a live fleet member. Minecraft allows
// one session per name, so every preflight run logged in as Scout01 and the
// server kicked the actual bot off with duplicate_login -- silently, from the
// test's point of view, since the probe then measured its own movement and
// passed. Tonight the race went the other way and the probe was the one kicked,
// which is the only reason it was ever noticed.
//
// The probe must be able to join without displacing anything, so it gets its
// own name. It has to be whitelisted on the server like any other player.
const NAME = process.env.PROBE_NAME || 'SmokeProbe'
const WALK_MS = Number(process.env.SMOKE_WALK_MS || 45000)
const GOAL_DIST = Number(process.env.SMOKE_GOAL_DIST || 30)
const MIN_TRAVEL = Number(process.env.SMOKE_MIN_TRAVEL || 12)
// A healthy server sends the odd correction. Twenty a second to the same spot is
// not a correction, it is a refusal. Five is a generous line between the two.
const MAX_STATIC_TP_PER_SEC = Number(process.env.SMOKE_MAX_STATIC_TP || 5)

if (!HOST) { console.error('MINECRAFT_HOST is required'); process.exit(2) }

const say = (...a) => console.log(...a)
const fail = []
const bot = mineflayer.createBot({ host: HOST, port: PORT, version: VERSION, username: NAME, auth: 'offline' })
bot.loadPlugin(pathfinder)

let staticTp = 0, totalTp = 0, lastTp = null
const resets = {}, updates = {}

bot._client.on('packet', (d, meta) => {
  if (meta.name !== 'position') return
  totalTp++
  // Identical destination as the previous teleport => the server is putting the
  // bot back, not correcting it forward.
  if (lastTp && d.x === lastTp.x && d.y === lastTp.y && d.z === lastTp.z) staticTp++
  lastTp = { x: d.x, y: d.y, z: d.z }
})
bot.on('path_reset', r => { resets[r] = (resets[r] ?? 0) + 1 })
bot.on('path_update', r => { if (r?.status) updates[r.status] = (updates[r.status] ?? 0) + 1 })

const timeout = setTimeout(() => {
  say('  FAIL: never spawned within 60s')
  process.exit(1)
}, 60000)

bot.once('spawn', async () => {
  clearTimeout(timeout)
  await new Promise(r => setTimeout(r, 3000))
  say(`  server=${bot.version}  client declared=${VERSION ?? 'auto'}  as ${NAME}`)

  const start = bot.entity.position.clone()
  say(`  start ${start.x.toFixed(1)},${start.y.toFixed(1)},${start.z.toFixed(1)}`)

  bot.pathfinder.setMovements(new Movements(bot))
  staticTp = 0; totalTp = 0; lastTp = null
  const t0 = Date.now()
  bot.pathfinder.setGoal(new goals.GoalNear(start.x + GOAL_DIST, start.y, start.z + GOAL_DIST, 2))

  // Sample so a bot that walks out and back does not read as "went nowhere".
  let peak = 0
  const iv = setInterval(() => {
    const p = bot.entity.position
    peak = Math.max(peak, Math.hypot(p.x - start.x, p.y - start.y, p.z - start.z))
  }, 250)
  await new Promise(r => setTimeout(r, WALK_MS))
  clearInterval(iv)
  bot.pathfinder.setGoal(null)

  const secs = (Date.now() - t0) / 1000
  const end = bot.entity.position
  const net = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)
  const staticRate = staticTp / secs

  say('  ---------------- results ----------------')
  say(`    furthest from start:   ${peak.toFixed(1)} blocks   (need >= ${MIN_TRAVEL})`)
  say(`    net displacement:      ${net.toFixed(1)} blocks`)
  say(`    server teleports:      ${totalTp} total, ${staticTp} to an UNCHANGED position`)
  say(`    static teleport rate:  ${staticRate.toFixed(1)}/s   (need < ${MAX_STATIC_TP_PER_SEC})`)
  say(`    path_update:           ${JSON.stringify(updates)}`)
  say(`    path_reset:            ${JSON.stringify(resets)}`)

  if (peak < MIN_TRAVEL) fail.push(`travelled only ${peak.toFixed(1)} blocks in ${secs.toFixed(0)}s`)
  if (staticRate >= MAX_STATIC_TP_PER_SEC) {
    fail.push(`server re-teleported to an unchanged position ${staticRate.toFixed(1)}x/s ` +
              `-- movement is being rejected (this is the 1.21.11 signature)`)
  }
  // A pathfinder that only ever reports `partial` MIGHT be broken -- but on a
  // live world with a working fleet, chunk loading forces constant replanning
  // and a healthy 45s run can log hundreds of partials with a single success.
  // Measured on the rebuilt server: 468 partial / 1 success while travelling
  // 43.9 blocks, which is fine, and an identical run that logged 0 successes,
  // which is also fine. Gating on the label alone made this test flaky.
  //
  // So the label only matters when the bot ALSO barely moved: that is the case
  // it was written for -- drifting far enough to pass the distance check while
  // pathing is actually dead. Travel is the evidence; status is the corroboration.
  if ((updates.success ?? 0) === 0 && (updates.partial ?? 0) > 50 && peak < MIN_TRAVEL * 2) {
    fail.push(`every A* result was partial, none succeeded, and travel was only ${peak.toFixed(1)} blocks`)
  }

  say('  -----------------------------------------')
  if (fail.length) { fail.forEach(f => say(`  FAIL: ${f}`)) } else { say('  PASS: movement is healthy; a fleet may start.') }

  bot.quit()
  setTimeout(() => process.exit(fail.length ? 1 : 0), 800)
})

bot.on('error', e => { say(`  FAIL: ${e.message}`); process.exit(1) })
bot.on('kicked', r => { say(`  FAIL: kicked ${JSON.stringify(r)}`); process.exit(1) })
