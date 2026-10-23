#!/usr/bin/env node
// lavastep-01 PAPER DRIVER, r11 (2026-10-23). SANDBOX ONLY (10.0.0.30, sandbox..sandbox8 except sandbox4; sandbox/sandboxes.json).
// Design: docs/reports/mineshaft-safety-2026-10-23.md F1 "Paper (the main evidence)".
//
// THE WHOLE BOT, UNMODIFIED: `node src/index.mjs` from <botRoot>, with a SCRIPTED brain served IN THIS PROCESS (Ollama's
// /api/chat shape, as sandbox/sandbox-brain.mjs) so the cognitive loop, the watchdog and the reflex layer run as on the fleet.
// The brain answers `status` (an instant skill) until the trial's release; in scene `busy` it switches to `goto` once the
// bot is staged, and the bot is released while that goto runs. busy is an AWAY-DIRECTED goto (its target lies in the far
// corner, away from the pool). EXPOSURE is proven per trial from the build's own goto row alone: started after the switch
// and before the release, ended after it (driver review r3, Codex P2: exposure must not depend on what happens after the
// release). Whether the danger arm cut it is reported separately, as an outcome. The busy result counts every exposed trial. The danger arm -- today's blind sprint on a base build, the verified move on
// a lavastep build -- is the only thing that differs. LAVASTEP is removed from the child's environment on both arms.
// A FRESH BOT PER TRIAL with a per-run nonce in its name: no death site, hunger, cooldown or episode history carries over.
//
// CONFINED (driver review r2, Codex P1-1): the owned volume (x,z in [A-R, A+R], y A-8..A+12) is a closed BARRIER box (walls,
// floor and ceiling; barrier is unbreakable in survival and the pathfinder will not dig it), so nothing the bot does --
// skills, watchdog relocations, reflexes, scaffolds -- reaches outside it. The arena is rebuilt BEFORE the bot is launched;
// the bot is moved into the box the moment it appears in `list` (before its cognitive loop starts, 5 s after spawn), and its
// respawn point is set inside the box (the staging pad), so a death respawns it there too.
// BEFORE THE TELEPORT THE BOT CANNOT EDIT ANYTHING (driver review r3, Codex P1: its reflexes start at spawn, before the
// cognitive loop): every trial bot is a NEW player and joins in ADVENTURE mode, which the server enforces (no block breaking
// or placing). THIS DRIVER OWNS THAT SAFEGUARD (driver review r4, Codex P1: standalone runs must be safe too):
//   - names are `ls` + an 8-character random run id + the trial number (36^8 ids: never a returning player);
//   - FENCED CRITICAL SECTIONS (driver review r5 Codex P1: a per-host mutex; r6 Codex P1: a lock held across the network
//     cannot fence commands already issued when the holder's session is lost): every section that must be atomic is ONE
//     script run on the WORLDS host (10.0.0.30, where RCON executes) as `flock -w 60 ~/mcai-sandbox-mode/<server>.lock
//     timeout -k 5 50 bash -s`. The process holding the lock is the process running the commands, so nothing runs unlocked,
//     and `timeout` bounds every holder server-side. The sections: writing this run's AUTHORITATIVE marker
//     (~/mcai-sandbox-mode/<server>/<run id> on the worlds host) and deleting stale ones; the last-out check-and-restore
//     (list the markers; if none but this run's and the known-stale ones stands, send `defaultgamemode survival` through
//     the RCON helper, check the reply, and only then delete them); the arena claim (compare-and-swap of its owner) and its
//     release. LAUNCHES NEED NO LOCK: a restore runs only inside the fenced section and only when no live marker stands,
//     and each run's marker is written inside that same section before its first `defaultgamemode adventure`, so once a
//     run can set adventure no restore can follow it; every launch sends adventure and checks the reply first;
//   - THE ADVENTURE SEND IS FENCED TOO (r7 Claude P2-2 / Codex P1-1): `defaultgamemode adventure` is sent only from inside a
//     fenced section that first checks this run's authoritative marker still stands; a late or delayed copy from a run
//     whose marker was swept therefore refuses itself, and so cannot leave adventure with no marker;
//   - AN UNRESOLVED MODE COMMAND STOPS EVERYONE (driver review r8, Codex P1: ordering inside Paper is not guaranteed
//     across RCON connections -- a connection thread can read a command and pause before handing it to the main thread,
//     so a command whose sender died may still execute later). Each fenced mode command writes
//     ~/mcai-sandbox-mode/<server>/.inflight-<run> BEFORE it sends, and removes it only AFTER the reply confirming the
//     change. A command that was not confirmed (a timeout, a kill, a bad reply) leaves that file, and while ANY in-flight
//     file exists the mode sections refuse (registration, the adventure send, the restore and with it every authoritative
//     marker deletion; the arena claim/release bookkeeping is not gated -- it changes no mode). The run stops FATAL and
//     names the file. RESOLVING IT IS BY HAND, and only in this order (r9/r10 Codex P1, Claude P3-1/P3-4):
//       1. stop every lavastep driver and every `lsrun=` bot process;
//       2. DRAIN the worlds host: wait until no fenced section or RCON helper of this server is running there --
//          `pgrep -af 'mcai-sandbox-mode/<server>.lock|sbx-rcon.py <server>'` prints nothing (each section is bounded:
//          flock -w 60 + timeout -k 5 50, so at most 115 s after the last driver stopped); run it in a shell ON the
//          worlds host (through `ssh host 'pgrep -af ...'` the remote shell's own command line matches the pattern);
//       3. RESTART that Paper server and check its old JVM has exited (a reply on a new RCON connection does not prove the
//          old command cannot still run); its latest.log shows whether the in-flight command (quoted in the file) ran;
//       4. send `defaultgamemode survival` by RCON; its reply "The default game mode is now Survival Mode" is the
//          read-back (there is no query form);
//       5. only then delete ~/mcai-sandbox-mode/<server>/.inflight-* on the worlds host, and the matching markers and
//          lock-host warning copies of runs that are gone (or leave them: the next run sweeps drained ones).
//     The trade, disclosed (Claude r9 P3-5): a command that provably never left the worlds host (the helper could not
//     connect) also leaves the file and also needs this hand step;
//   - A DEAD DRIVER IS NOT ENOUGH TO CALL ITS MARKER STALE (r7 Codex P1-1: its bot process can outlive it, still trying
//     to join): every bot process carries its run in its command line (`lsrun=<run id>`), and a marker counts as stale
//     only when its driver is gone (pid dead or reused), NO process on this host carries its run tag, and NO player of its
//     run (`ls<run id>...`) is online. Anything else keeps the marker (and the default at adventure) and is reported;
//   - the joined mode is READ BACK in the same round trip as the teleport into the box: anything but adventure is FATAL
//     (below); staging later than 5 s after the join was seen makes the trial INVALID;
//   - FORCE-GAMEMODE PROBE, every trial: with its own bot staged in survival, the driver re-sends
//     `defaultgamemode adventure` and reads its bot's mode back: still survival proves the server does not force modes
//     onto online players, so a launch by the other slot's driver cannot flip this bot mid-trial; a flip STOPS THE RUN
//     (FATAL). Each trial also reads its bot's mode at the end of the observation: anything but survival is INVALID;
//   - a bot that joins in any mode but adventure ENDS THE RUN (FATAL; Claude r4 P2-2): at most one bot is ever exposed;
//   - REBOOT-SURVIVING MARKERS (Claude r4 P2-3: a sandbox silently left in adventure makes every later harness's digs read
//     zero), `adventure since <T> host= pid= pstart= run=`, in home directories (not /tmp, so an outage does not erase
//     them): the AUTHORITATIVE one on the worlds host (above), and a WARNING COPY on the lock host (10.0.0.31,
//     ~/mcai-sandbox-mode/<server>/<run id>) that `sandbox/sbxlock.sh take|status` print. The copy is written BEFORE the
//     authoritative marker and deleted only AFTER it (and after the confirmed restore), so a copy can be a false alarm,
//     never missing while adventure may be set. Survival is restored only by the LAST driver to leave the server, and a
//     marker is deleted only AFTER survival is confirmed (r5 Codex P2); a failed restore leaves every marker standing (exit
//     3). At STARTUP a driver writes its own marker first and then deletes stale ones (see staleOwner: same machine, driver gone, run drained);
//   - an ATOMIC ARENA CLAIM (Claude r4 P2-1: two runs of one scene and slot could both pass the forceload check, and the
//     loser's cleanup would restore over the winner's live box): ~/mcai-sandbox-mode/arenas/<server>-<x>-<z> on the worlds
//     host, taken in a fenced section by mkdir, or, when the current owner was judged stale (same machine, driver gone or
//     reused), by a compare-and-swap of exactly that owner text; a held claim refuses the run before ANY world change;
//     released (fenced) only while it is still this run's;
//   - a LIMITED LOG CHECK, not proof (r5 Codex P2, Claude P2-B): a trial is INVALID if the build logged, before its bot was
//     set to survival, a row that can mean a block edit (editRow below: any `_lava_retreat`, any `_marooned_self_sourced`
//     -- the reflex's adjacent harvest, reflex.mjs ~2698 --, a `_marooned_*` / `_escape_candidate` row reporting >= 1
//     block dug, or a successful dig/place/harvest/pillar/scaffold/tunnel/bridge/break row). Its POSITIVE CONTROL is
//     reported per trial as editRowsAfter (the candidate's post-release seals and steps match it). A change logged under
//     any other kind, and door/button/chest use, are not covered: adventure mode is what stops the edits.
// Residuals (disclosed): an adventure-mode bot can still use doors, buttons and chests at world spawn for the ~70 ms
// before the teleport (its inventory is empty, its cognitive loop not started; the reflex layer has no block-use calls);
// a bot ORPHANED by a SIGKILLed driver can do the same for as long as it lives (smoke: it died of its closed stdout ~7 s
// later); the next run on this machine AGAINST THE SAME SERVER SIGKILLs any `lsrun=` bot whose driver is gone (this
// drain is deliberately NOT gated by an unresolved mode command: it is step 1 of the recovery) before it judges staleness
// (Claude r8 P3-2), so that window ends at the next start;
// markers from another host are never swept, only reported (they hold the default at adventure until removed by hand);
// a fenced section on a worlds host that is down cannot run, so the driver refuses to start (and a cleanup leaves its
// markers standing) rather than act unfenced; the RCON helper the sections call is /tmp/sbx-rcon.py on the worlds host.
// WHAT IS SYNTHETIC, said so in every result row: the arena (a stone plain in a barrier box, the scene's lava/magma/campfire set
// by RCON); the bot is staged on a dry stone pad in the box (a fresh bot is not burning; that is read back), healed
// (instant_health + saturation), given its bag, then teleported to the scene's start pose. (r1/r2 rested it in a sunk 1x1
// water cell, which the bot took for a pit: the first r3 smoke logged `_marooned_needs_scaffold` and an escape prerequisite
// there before every release; with a fresh bot per trial the water had no job left.)
// VERIFIED, OR THE TRIAL IS INVALID (r2 Codex P1-3): every RCON command must get exactly one reply, recognised as success
// for its verb (a per-verb whitelist; anything else throws); the scene cells are read back after the build and again just
// before the release; the WHOLE inventory is read back (exactly the bag: 128 cobblestone or none, 1 stone_pickaxe, 16 oak_log,
// nothing else) before the release; health >= 19, food 20, not burning, zero deaths; the start position AND rotation are read
// back after the teleport. Any setup or RCON error inside a trial makes that trial INVALID, never a measurement.
// OUTCOMES FROM THE WORLD (r2 Codex P1-2): every 0.5 s a COMPLETE probe (position, health, fire ticks, the run's deathCount
// score; all four must parse, else it is a gap; 6 gaps in a row, or > 10% gaps, make the trial INVALID). A DEATH needs
// affirmative evidence: the server's deathCount score (a per-run objective) AND the build's `_death` row, which must agree
// (else INVALID); health 0 is recorded as supporting evidence only (a 0.5 s probe can miss it before the respawn). A position outside the box with no death is INVALID ("left arena"). After the
// window the probe goes on until the fire is out; still burning 20 s later = CENSORED (reported, not counted). A `_death` row
// or a death score before the release is INVALID.
// GUARDS: the run refuses an arena whose chunks are already force-loaded (another run on this server/slot); it records the
// server's tick time (mspt) before the release and every ~5 s through the observation, and the release time; every trial is
// appended to <out>/trials.jsonl as it finishes; the cleanup restores the arena, then RECONCILES the forceload and the
// objective (each marked as attempted BEFORE its add is sent, so a lost acknowledgement still gets a removal; removal is
// retried and verified absent), each independently, and closes the SSH master (verified; a failure makes the exit status 3).
// RESIDUAL (disclosed): the two arms on one server are concurrent, not synchronised; slots are counterbalanced across
// servers, and release times and mspt are recorded so drift and lag can be read off.
//
//   node sandbox/lavastep/lavastep-e2e.mjs <botRoot> <label> <scene> [server] [trials] [seconds]
//   scenes (feet level y = A.y; the floor A.y-1; every pool SUNK into the floor so no lava flows over open ground):
//     edge      S1  a lava pool (2 deep) east of the bot; its centre over the first lava cell, its body on the shore block,
//                   FACING THE POOL (dry feet over lava: the commonest fatal start, 31/303)
//     deep1     S2  a 1-deep pool sunk into the floor; the bot's feet in it, 1 block from the shore (one step up), facing away
//     ledge     S3  a 1-wide stone ledge between two lava lakes level with it; the centre over the south lake, facing it
//     magma     S4  a magma floor block in the plain
//     fall      S5  falling 3 blocks past the edge of a 1-deep lava lake, facing into it
//     campfire  S6  a campfire underfoot
//     busy      S7  the S1 pool with the bot released while an AWAY-directed `goto` (to an iron ore in the far corner) runs
//   env LS_BAG=cobble|none (default cobble); LS_YAW=cycle (trial k faces the scene yaw + 45 deg x (k mod 8); trials must be a
//   multiple of 8); LS_SLOT=0|1 (an arena offset, so two arms run side by side on one server); LS_OUT (default $TMPDIR/lavastep-e2e)
// Refuses unless a sandbox lock covering SERVER (global or per-server, on 10.0.0.31) has `lavastep` as its owner's first word;
// re-checked every trial.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const SCENES = ['edge', 'deep1', 'ledge', 'magma', 'fall', 'campfire', 'busy']
const [BOT_ROOT, LABEL, SCENE, SERVER = 'sandbox5', TRIALS_S = '20', SECS_S = '20'] = process.argv.slice(2)
if (!BOT_ROOT || !LABEL || !SCENE) throw new Error('usage: lavastep-e2e.mjs <botRoot> <label> <scene> [server] [trials] [seconds]')
if (!SCENES.includes(SCENE)) throw new Error(`unknown scene ${SCENE} (${SCENES.join(', ')})`)
if (!/^[a-z0-9]{1,6}$/i.test(LABEL)) throw new Error('label: 1-6 letters/digits (it names the run directory and every row)')
// sandbox names/ports and the lock from the shared registry (sandbox/sandboxes.json via sandbox/lib/sbxlock.cjs);
// sandbox4 stays excluded: it is the model benchmark's
const require = createRequire(import.meta.url)
const sbx = require('../lib/sbxlock.cjs')
const PORTS = Object.fromEntries(Object.entries(sbx.PORTS).filter(([n]) => n !== 'sandbox4'))
if (!PORTS[SERVER]) throw new Error(`sandbox servers only (${Object.keys(PORTS).join(', ')})`)
sbx.requireSandboxLock(SERVER, 'lavastep')
const TRIALS = Number(TRIALS_S), SECS = Number(SECS_S)
if (!Number.isInteger(TRIALS) || TRIALS < 1 || TRIALS > 64) throw new Error('trials: an integer 1..64')
if (!Number.isInteger(SECS) || SECS < 8 || SECS > 60) throw new Error('seconds: an integer 8..60')
const BAG = process.env.LS_BAG === 'none' ? 'none' : 'cobble'
const YAW = process.env.LS_YAW === 'cycle' ? 'cycle' : 'scene'
if (YAW === 'cycle' && TRIALS % 8 !== 0) throw new Error('LS_YAW=cycle needs a multiple of 8 trials (every bearing equally often)')
const SLOT = process.env.LS_SLOT === '1' ? 1 : 0
const OUT = process.env.LS_OUT || path.join(os.tmpdir(), 'lavastep-e2e')
fs.mkdirSync(OUT, { recursive: true })
const RES = `${OUT}/results.jsonl`
const TRIALS_FILE = `${OUT}/trials.jsonl`
const RUN = fs.mkdtempSync(path.join(OUT, `${LABEL}-${SCENE}-`))
// 8 base-36 characters from 6 random bytes (driver review r4, Codex P2: two characters gave only 1,296 run ids)
const NONCE = BigInt('0x' + crypto.randomBytes(6).toString('hex')).toString(36).padStart(8, '0').slice(-8)
const T0 = Date.now()
const P_ = (...a) => { const s = `[${LABEL}/${SCENE}/${SERVER} ${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); fs.appendFileSync(`${OUT}/driver.log`, s + '\n'); console.log(s) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
let stopping = false
let sha = 'unknown'
try { sha = execFileSync('git', ['-C', BOT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { try { sha = fs.readFileSync(path.join(BOT_ROOT, 'SHA'), 'utf8').trim() } catch {} }
const lavastepBuild = fs.existsSync(path.join(BOT_ROOT, 'bots/src/lavastep.mjs'))

// ---------------------------------------------------------------- RCON (sandbox only, through the worlds host's helper)
// the SSH master is this process's own (its pid in the path): two drivers side by side shared one in r2, and a cleanup's
// `-O exit` would then cut the other driver's commands in flight
const SSH = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', `ControlPath=${process.env.HOME}/.ssh/cm-ls-${process.pid}-%C`, '-o', 'ControlPersist=600', 'mike@10.0.0.30']
function rcon (...cmds) {
  const out = execFileSync('ssh', [...SSH, `python3 /tmp/sbx-rcon.py ${SERVER} -`], { input: cmds.join('\n') + '\n', encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 })
  const res = []; let cur = null
  for (const line of out.split('\n')) { if (line.startsWith('> ')) { cur = { cmd: line.slice(2), reply: '' }; res.push(cur) } else if (cur) cur.reply += (cur.reply ? '\n' : '') + line }
  for (const r of res) r.reply = r.reply.replace(/§./g, '').trim()
  return res
}
// ONE reply per command, matched to it, and recognised as SUCCESS for its verb (driver review r2, Codex P1-3). `No blocks were
// filled` / `Could not set the block` mean the cell already held that block (the scene cells are read back regardless);
// `No entity was found` is kill's answer when nothing is left to kill; an unchanged gamemode answers nothing.
const OK = [
  [/^fill /, /^(Successfully filled \d+ block|No blocks were filled)/],
  [/^setblock /, /^(Changed the block at|Could not set the block)/],
  [/^tp /, /^Teleported /],
  [/^gamemode survival /, /^(Set \S+'s game mode to Survival Mode|)$/],   // r4 smoke: the full reply ("... to Survival Mode")
  [/^clear \S+$/, /^(Removed \d+ item|No items were found)/],
  [/^effect give /, /^Applied effect/],
  [/^effect clear /, /^(Removed every effect|Target has no effects to remove)/],
  [/^item replace /, /^Replaced a slot on/],
  [/^kill /, /^(Killed |No entity was found)/],
  [/^spawnpoint /, /^Set spawn point to/],
  [/^forceload add /, /^Marked (chunk|\d+ chunks)/],
  [/^forceload remove /, /^Unmarked (chunk|\d+ chunks)/],
  [/^scoreboard objectives add /, /^Created new objective/],
  [/^scoreboard objectives remove /, /^Removed objective/],
]
function batch (cmds) {
  const out = []
  for (let i = 0; i < cmds.length; i += 300) {
    const part = cmds.slice(i, i + 300), got = rcon(...part)
    if (got.length !== part.length) throw new Error(`rcon: ${got.length} replies for ${part.length} commands`)
    for (let j = 0; j < part.length; j++) {
      if (got[j].cmd !== part[j]) throw new Error(`rcon: reply ${j} is for "${got[j].cmd}", not "${part[j]}"`)
      const rule = OK.find(([v]) => v.test(part[j]))
      if (!rule) throw new Error(`rcon: no success rule for "${part[j]}"`)
      if (!rule[1].test(got[j].reply)) throw new Error(`rcon: ${part[j]} => ${got[j].reply || '(no reply)'}`)
    }
    out.push(...got)
  }
  return out
}
const DATA = /has the following entity data: (.*)$/s
const dataOf = r => { const m = DATA.exec(r?.reply ?? ''); return m ? m[1] : null }
const scoreOf = r => { const t = r?.reply ?? ''; const m = /has (\d+) \[/.exec(t); return m ? +m[1] : /none is set/.test(t) ? 0 : null }
const OBJ = `ls${NONCE}d`
/** One COMPLETE observation: position, health, fire ticks, deaths; `ok` only when all four replies parse. */
function probe (name) {
  let rs
  try { rs = rcon(`data get entity ${name} Pos`, `data get entity ${name} Health`, `data get entity ${name} Fire`, `scoreboard players get ${name} ${OBJ}`) } catch (e) { return { ok: false, why: `rcon ${e.message.slice(0, 80)}` } }
  if (rs.length !== 4) return { ok: false, why: `${rs.length} replies` }
  const m = /^\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]$/.exec(dataOf(rs[0]) ?? '')
  const h = /^([\d.]+)f$/.exec(dataOf(rs[1]) ?? '')
  const f = /^(-?\d+)s$/.exec(dataOf(rs[2]) ?? '')
  const d = scoreOf(rs[3])
  if (!m || !h || !f || d == null) return { ok: false, why: rs.map(x => x.reply.slice(0, 60)).join(' | ') }
  return { ok: true, pos: { x: +m[1], y: +m[2], z: +m[3] }, hp: +h[1], fire: +f[1], deaths: d }
}
const r1 = c => { const r = rcon(c); if (r.length !== 1 || r[0].cmd !== c) throw new Error(`rcon: no reply for "${c}"`); return r[0].reply }
function isBlock (x, y, z, b) {
  const t = r1(`execute if block ${x} ${y} ${z} minecraft:${b}`)
  if (/^Test passed/.test(t)) return true
  if (/^Test failed/.test(t)) return false
  throw new Error(`execute if block ${x} ${y} ${z}: ${t}`)
}
const online = () => { const l = r1('list'); const i = l.indexOf(':'); if (!/players online/.test(l) || i < 0) throw new Error(`list: ${l}`); return l.slice(i + 1).split(',').map(s => s.trim()).filter(Boolean) }
/** The whole inventory as {id: count}, from the server, one entry per reply (a whole-list `data get` is TRUNCATED with
 *  "..." over RCON -- the first r3 smoke read 64 of 128 cobblestone that way); entries until "Found no elements". */
function inventory (name) {
  const N = 12
  const rs = rcon(...Array.from({ length: N }, (_, i) => `data get entity ${name} Inventory[${i}]`))
  if (rs.length !== N) throw new Error(`inventory of ${name}: ${rs.length} replies`)
  const inv = {}
  let i = 0
  for (; i < N; i++) {
    if (/^Found no elements matching/.test(rs[i].reply)) break
    const d = dataOf(rs[i])
    const id = /id: "minecraft:([a-z_]+)"/.exec(d ?? ''), n = /count: (\d+)/.exec(d ?? '')
    if (!d || !id || !n || /\.\.\./.test(d)) throw new Error(`inventory entry ${i} unreadable: ${rs[i].reply.slice(0, 80)}`)
    inv[id[1]] = (inv[id[1]] || 0) + +n[1]
  }
  if (i === N) throw new Error(`inventory of ${name}: ${N} or more entries`)
  for (let j = i + 1; j < N; j++) if (!/^Found no elements matching/.test(rs[j].reply)) throw new Error(`inventory entry ${j} after the end: ${rs[j].reply.slice(0, 80)}`)
  return inv
}
function mspt () {
  try { const t = r1('mspt'); const m = /◴\s*([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(t); return m ? { avg5s: +m[1], max5s: +m[3] } : null } catch { return null }
}

// ---------------------------------------------------------------- the arena (owned volume: x,z in [-R, R] around A, y A-8..A+12)
const A = { x: 6400 + 64 * SCENES.indexOf(SCENE), y: 100, z: 6400 + 64 * Object.keys(PORTS).indexOf(SERVER) + 32 * SLOT }
const R = 12
const REST = { x: A.x - 8, y: A.y, z: A.z - 8 }            // the staging pad: a dry stone floor cell, far from every scene's cells
const f = (x0, x1, y0, y1, z0, z1, b) => `fill ${A.x + x0} ${A.y + y0} ${A.z + z0} ${A.x + x1} ${A.y + y1} ${A.z + z1} minecraft:${b}`
const s1 = (x, y, z, b) => `setblock ${A.x + x} ${A.y + y} ${A.z + z} minecraft:${b}`
const OWN = `x=${A.x - R},y=${A.y - 8},z=${A.z - R},dx=${2 * R},dy=20,dz=${2 * R}`
const inBox = p => Math.abs(p.x - (A.x + 0.5)) <= R + 0.5 && Math.abs(p.z - (A.z + 0.5)) <= R + 0.5 && p.y >= A.y - 8 && p.y <= A.y + 13
// non-player entities (the bag a dead bot dropped) in the owned volume
const killCmd = `kill @e[type=!player,${OWN}]`
// ---------------------------------------------------------------- the join safeguard: the server's default game mode
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
// the LOCK host (10.0.0.31) keeps the WARNING COPIES of the markers (what sbxlock.sh reads); the worlds host keeps the
// authoritative markers, the arena claims and the lock
const LH = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'mike@10.0.0.31']
/** A FENCED section: `script` runs on the WORLDS host under flock on ~/mcai-sandbox-mode/<server>.lock, bounded there by
 *  `timeout -k 5 50`; the holder of the lock is the process running the commands. -> its stdout (it must end with an OK line). */
function fenced (script) {
  const remote = `mkdir -p "$HOME/mcai-sandbox-mode" && flock -w 60 "$HOME/mcai-sandbox-mode/${SERVER}.lock" timeout -k 5 50 bash -s`   // r7 Codex: KILL 5 s after TERM
  // the client waits longer than the remote bound (60 s for the lock + 50 s + 5 s kill: Claude r7 P3-1); a failing section's
  // stdout is kept in the error (Claude r7 P3-2)
  try { return execFileSync('ssh', [...SSH, remote], { input: 'set -eu\n' + script, encoding: 'utf8', timeout: 130000 }) } catch (e) {
    throw new Error(`fenced section failed (${e.status ?? e.code}): ${String(e.stdout ?? '').trim().slice(0, 240)}`)
  }
}
const lh = script => execFileSync('ssh', [...LH, 'bash -s'], { input: 'set -eu\n' + script, encoding: 'utf8', timeout: 30000 })
const HOSTNAME = os.hostname().replace(/[^A-Za-z0-9._-]/g, '_')
// the machine's id (Claude r7 P3-3: two machines with one hostname must not judge each other's markers)
const MACHINE = (() => {
  try { const m = /"IOPlatformUUID" = "([0-9A-F-]+)"/.exec(execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 })); if (m) return m[1].toLowerCase() } catch {}
  try { const t = fs.readFileSync('/etc/machine-id', 'utf8').trim(); if (/^[0-9a-f]{32}$/.test(t)) return t } catch {}
  return 'unknown'
})()
// from `ps -o lstart` (the clock staleOwner compares against; Claude r6 P3-3); 0 if ps cannot say
const PSTART = (() => { try { const t = Date.parse(execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8', timeout: 5000 }).trim()); if (Number.isFinite(t)) return Math.round(t / 1000) } catch {} return 0 })()   // 0 = unknown: liveness alone decides (Claude r8 P3-1: the uptime fallback could differ by > 3 s)
const OWNER = `host=${HOSTNAME} mid=${MACHINE} pid=${process.pid} pstart=${PSTART} run=${NONCE}`
/** The start time (epoch s) of a live pid on this host, or null. */
function startOf (pid) {
  try { const t = Date.parse(execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 }).trim()); return Number.isFinite(t) ? Math.round(t / 1000) : null } catch { return null }
}
const MROOT = '"$HOME/mcai-sandbox-mode"'
const MDIR = `${MROOT}/${SERVER}`
const ARENA = `${MROOT}/arenas/${SERVER}-${A.x}-${A.z}`
// stale = this host, the driver is gone (pid dead, or reused: its start time differs; Claude r5 P3-3), AND none of its run's
// bot processes survives here (their command lines carry `lsrun=<run>`), AND none of its run's players is online
// (r7 Codex P1-1: an orphaned bot can still join after its driver died)
function driverGone (p, ps) {
  if (!alive(p)) return true
  const st = ps ? startOf(p) : null
  return ps > 0 && st != null && Math.abs(st - ps) > 3
}
function runDrained (run) {
  if (!/^[a-z0-9]{8}$/.test(run)) return false
  let procs = ''
  try { procs = execFileSync('ps', ['-axww', '-o', 'command='], { encoding: 'utf8', timeout: 5000 }) } catch { return false }
  if (procs.split('\n').some(l => l.includes(`lsrun=${run}`))) return false
  let who
  try { who = online() } catch { return false }
  return !who.some(n => n.startsWith(`ls${run}`))
}
const staleOwner = text => {
  const h = /host=(\S+)/.exec(text)?.[1], p = Number(/pid=(\d+)/.exec(text)?.[1]), ps = Number(/pstart=(\d+)/.exec(text)?.[1])
  const run = /run=([a-z0-9]+)/.exec(text)?.[1], mid = /mid=([0-9a-f-]+)/.exec(text)?.[1]
  if (h !== HOSTNAME || mid !== MACHINE || MACHINE === 'unknown' || !(p > 0) || p === process.pid || !run || run === NONCE) return false
  return driverGone(p, ps) && runDrained(run)
}
/** A row that can mean a block edit (the limited log check; see the header). */
function editRow (r) {
  const k = r?.skill?.name ?? '', d = `${r?.skill?.detail ?? ''}`
  if (k === '_lava_retreat' || k === '_marooned_self_sourced') return true
  // Claude r6 P3-2: any successful `_marooned_*` row (ramp_cut with steps, underfoot's dig); `steps=N` and `N dug` read;
  // `blocks=` dropped (in `_escape_candidate` it counts blocks HELD, not dug)
  if (k.startsWith('_marooned_') && r?.skill?.status === 'success') return true
  if ((k.startsWith('_marooned_') || k === '_escape_candidate') && /\b([1-9]\d*) adjacent block|\bsteps=([1-9]\d*)|\(([1-9]\d*)\/\d+ dug\)/.test(d)) return true
  return r?.skill?.status === 'success' && /dig|place|harvest|pillar|scaffold|tunnel|bridge|break/i.test(k)
}
const nameOk = n => { if (!/^[a-z0-9]+$/.test(n)) throw new Error(`marker name ${n}`); return n }
const listScript = dir => `mkdir -p ${dir}; for f in ${dir}/*; do [ -f "$f" ] || continue; printf '%s\\t%s\\n' "$(basename "$f")" "$(head -c 300 "$f" | tr '\\n\\t' '  ')"; done; echo END`
const parseList = out => {
  if (!/(^|\n)END\n?$/.test(out)) throw new Error('marker list: no END line')
  return out.split('\n').filter(l => l && l !== 'END').map(l => { const [name, text = ''] = l.split('\t'); return { name, text } })
}
/** The AUTHORITATIVE markers (worlds host; a read, unfenced: a stale judgement cannot be undone by a later write). */
const wMarkers = () => parseList(execFileSync('ssh', [...SSH, 'bash -s'], { input: 'set -eu\n' + listScript(MDIR), encoding: 'utf8', timeout: 30000 }))
const staleNames = () => wMarkers().filter(m => m.name !== NONCE && staleOwner(m.text))
const MARK_TEXT = () => `adventure since ${new Date().toISOString()} by lavastep-e2e ${OWNER}`
let registered = false
/** This run's markers, BEFORE any adventure default: the lock host's warning copy first, then (fenced) the authoritative
 *  one; then the stale ones go (fenced), and their warning copies after. */
function register (stale) {
  registered = true      // marked BEFORE the writes: a lost acknowledgement still gets a removal attempt
  const text = MARK_TEXT()
  const c = lh(`mkdir -p ${MDIR}; printf '%s\\n' '${text}' > ${MDIR}/${NONCE}; cat ${MDIR}/${NONCE}`)
  if (!c.includes(OWNER)) throw new Error(`warning copy not written: ${c.slice(0, 120)}`)
  const out = fenced(`mkdir -p ${MDIR}; ${UNRESOLVED_CHECK}
printf '%s\\n' '${text}' > ${MDIR}/${NONCE}; grep -q 'run=${NONCE}' ${MDIR}/${NONCE}; ${stale.map(n => `rm -f ${MDIR}/${nameOk(n)}; `).join('')}echo REGISTERED`)
  if (/(^|\n)UNRESOLVED /.test(out)) {
    // refused BEFORE the authoritative marker was written and before any adventure: this run set nothing, so its own
    // warning copy goes, and it has nothing to restore
    try { lh(`rm -f ${MDIR}/${NONCE}; echo GONE`) } catch {}
    registered = false
  }
  unresolved(out)
  if (!/(^|\n)REGISTERED\n?$/.test(out)) throw new Error(`marker not written: ${out.slice(0, 120)}`)
  if (stale.length) lh(stale.map(n => `rm -f ${MDIR}/${nameOk(n)}; `).join('') + 'echo GONE')
}
// every fenced MODE/MARKER section starts with this (not the arena claim/release bookkeeping): any in-flight file = a mode
// command whose outcome is unknown -> refuse
const UNRESOLVED_CHECK = `for f in ${MDIR}/.inflight-*; do if [ -e "$f" ]; then echo "UNRESOLVED $(basename "$f") $(cat "$f" 2>/dev/null | head -c 200)"; exit 0; fi; done`
function unresolved (out) {
  const m = /(^|\n)UNRESOLVED ([^\n]*)/.exec(out)
  // the remedy FIRST (Claude r9 P3-2: the file's text came first and the cleanup log cut the remedy off); "this run's"
  // when the file is ours
  if (!m) return
  const mine = m[2].startsWith(`.inflight-${NONCE} `)
  throw new Fatal(`UNRESOLVED MODE COMMAND on ${SERVER} (${mine ? "this run's own" : 'an earlier run'}): every lavastep driver refuses until it is resolved BY HAND, in this order -- (1) stop every lavastep driver and every 'lsrun=' bot process; (2) wait until no fenced section or RCON helper of ${SERVER} runs on the worlds host (pgrep -af 'mcai-sandbox-mode/${SERVER}.lock|sbx-rcon.py ${SERVER}' empty; at most 115 s); (3) RESTART that Paper server and check its old JVM exited (its latest.log shows whether the command ran); (4) send 'defaultgamemode survival' by RCON and see the reply 'The default game mode is now Survival Mode'; (5) then delete ~/mcai-sandbox-mode/${SERVER}/.inflight-* on the worlds host (and the gone runs' markers and lock-host warning copies, or let the next run sweep them). The file: ${m[2]}`)
}
const inflightOpen = what => `printf '%s\\n' '${what} by ${OWNER} at '"$(date -u +%FT%TZ)" > ${MDIR}/.inflight-${NONCE}`
/** The LAST-OUT restore, fenced: survival only when no marker but ours and the known-stale ones stands; the reply is
 *  checked BEFORE any marker is deleted. -> 'RESTORED' | 'LEFT <names>'; throws on a failed restore (markers stay). */
function restoreIfLast (stale) {
  const keep = [NONCE, ...stale].map(nameOk)
  const out = fenced(`d=${MDIR}; mkdir -p "$d"; ${UNRESOLVED_CHECK}
others=""; for f in "$d"/*; do [ -f "$f" ] || continue; n=$(basename "$f"); case " ${keep.join(' ')} " in *" $n "*) ;; *) others="$others $n";; esac; done
if [ -n "$others" ]; then rm -f "$d/${NONCE}"; echo "LEFT$others"; exit 0; fi
${inflightOpen('defaultgamemode survival')}
r=$(printf '%s\\n' 'defaultgamemode survival' | python3 /tmp/sbx-rcon.py ${SERVER} - 2>&1 || true)
case "$r" in *"The default game mode is now Survival Mode"*) ;; *) echo "RESTORE_FAILED $(printf '%s' "$r" | tr '\\n' ' ' | head -c 200)"; exit 3;; esac
rm -f "$d/.inflight-${NONCE}"
${keep.map(n => `rm -f "$d/${n}"; `).join('')}echo RESTORED`).trim()
  unresolved(out)
  const last = out.split('\n').pop()
  if (last === 'RESTORED') { lh(keep.map(n => `rm -f ${MDIR}/${n}; `).join('') + 'echo GONE'); return last }
  if (last.startsWith('LEFT')) { lh(`rm -f ${MDIR}/${NONCE}; echo GONE`); return last }
  throw new Error(`restore: ${out.slice(0, 200)}`)
}
let arenaClaimed = false, staleTaken = false
/** The arena claim, fenced: mkdir, or a compare-and-swap of exactly the owner text this run judged stale. */
function claimArena () {
  const own = `${OWNER} scene=${SCENE} slot=${SLOT} since ${new Date().toISOString()}`
  let cur = ''
  try { cur = execFileSync('ssh', [...SSH, `cat ${ARENA}/owner 2>/dev/null || true`], { encoding: 'utf8', timeout: 30000 }).trim() } catch {}
  const expect = cur && staleOwner(cur) ? cur : ''
  if (/'/.test(expect)) throw new Error(`arena owner text has a quote: ${expect.slice(0, 80)}`)
  const out = fenced(`mkdir -p ${MROOT}/arenas
if mkdir ${ARENA} 2>/dev/null; then printf '%s\\n' '${own}' > ${ARENA}/owner; echo CLAIMED
else c=$(cat ${ARENA}/owner 2>/dev/null || true); if [ -n '${expect}' ] && [ "$c" = '${expect}' ]; then printf '%s\\n' '${own}' > ${ARENA}/owner; echo CLAIMED_STALE; else echo "HELD $c"; fi; fi`).trim()
  if (out === 'CLAIMED' || out === 'CLAIMED_STALE') { arenaClaimed = true; staleTaken = out === 'CLAIMED_STALE'; if (out === 'CLAIMED_STALE') P_(`WARNING: stale arena claim taken over: ${expect}`); return }
  throw new Error(`arena ${SERVER} ${A.x},${A.z} is claimed: ${out}`)
}
function releaseArena () {
  const out = fenced(`if grep -q 'run=${NONCE} ' ${ARENA}/owner 2>/dev/null; then rm -f ${ARENA}/owner; rmdir ${ARENA}; fi; if [ -e ${ARENA} ]; then echo "STILL $(cat ${ARENA}/owner 2>/dev/null)"; else echo GONE; fi`).trim()
  if (out !== 'GONE') throw new Error(`arena claim: ${out}`)
}
let markerGone = false   // set BEFORE the restore section runs: from then on this run's marker may not stand
/** The ADVENTURE default, fenced on the worlds host and only while this run's authoritative marker stands. (Survival is
 *  set only by restoreIfLast.) */
function setDefault (m) {
  if (m !== 'adventure') throw new Error(`setDefault ${m}: only the fenced restore sets survival`)
  // Claude r6 P2-1: a trial resuming after the cleanup began (or after its marker went) must never re-send adventure
  if (stopping || markerGone || !registered) throw new Fatal(`no adventure default: ${stopping ? 'the cleanup has begun' : markerGone ? "this run's marker may be gone" : 'not registered'}`)
  const out = fenced(`${UNRESOLVED_CHECK}
[ -f ${MDIR}/${NONCE} ] || { echo NO_MARKER; exit 0; }
${inflightOpen('defaultgamemode adventure')}
r=$(printf '%s\\n' 'defaultgamemode adventure' | python3 /tmp/sbx-rcon.py ${SERVER} - 2>&1 || true)
case "$r" in *"The default game mode is now Adventure Mode"*) rm -f ${MDIR}/.inflight-${NONCE}; echo SET;; *) echo "FAILED $(printf '%s' "$r" | tr '\\n' ' ' | head -c 200)";; esac`).trim()
  unresolved(out)
  if (out === 'NO_MARKER') throw new Fatal(`no adventure default: this run's marker is not on the worlds host`)
  if (out !== 'SET') throw new Error(`defaultgamemode adventure: ${out}`)
}
class Fatal extends Error {}
// the closed barrier box, then the stone plain and the air inside it
const boxCmds = () => [f(-R, R, -8, 12, -R, R, 'barrier'), f(-R + 1, R - 1, -7, -1, -R + 1, R - 1, 'stone'), f(-R + 1, R - 1, 0, 11, -R + 1, R - 1, 'air')]
// the driver's OWN plain, restored at the end (stone below the feet level, air above; no barrier left)
const restoreCmds = () => [f(-R, R, -8, -1, -R, R, 'stone'), f(-R, R, 0, 12, -R, R, 'air')]
// the four corner chunks of the arena (forceload's unit)
const CORNERS = [[A.x - R, A.z - R], [A.x + R, A.z - R], [A.x - R, A.z + R], [A.x + R, A.z + R]]
const forced = () => CORNERS.map(([x, z]) => { const t = r1(`forceload query ${x} ${z}`); if (/is not marked/.test(t)) return false; if (/is marked/.test(t)) return true; throw new Error(`forceload query: ${t}`) })
// each scene: its cells, the start pose (feet position; MC yaw: 0 = +z, -90 = +x, 90 = -x, 180 = -z), and the cells read back
const SCENE_DEF = {
  edge: { cells: [f(1, 5, -2, -1, -3, 3, 'lava')], start: { x: 1.2, y: 0, z: 0.5, yaw: -90 }, check: [[1, -1, 0, 'lava'], [0, -1, 0, 'stone'], [5, -2, 3, 'lava']] },
  // busy: the S1 pool; the goto's target is beside an iron ore in the far corner, so the staging walk (from the pad at -8,-8)
  // runs down the west side, nowhere near the lava, and is still walking (19 blocks) at the release (the first r3 smoke
  // aimed it across the pool: the lava-corridor guard refused that route 535 ms in and no goto was running at the release)
  busy: { cells: [f(1, 5, -2, -1, -3, 3, 'lava'), s1(-10, 0, 11, 'iron_ore'), s1(-10, 1, 11, 'stone')], start: { x: 1.2, y: 0, z: 0.5, yaw: -90 }, goto: { x: A.x - 9, y: A.y, z: A.z + 11 }, check: [[1, -1, 0, 'lava'], [0, -1, 0, 'stone'], [5, -2, 3, 'lava'], [-10, 0, 11, 'iron_ore']] },
  // the pool is SUNK into the floor (lava at y-1 over stone at y-2): lava set at feet level on open ground flows across the
  // shore (the first runs of this scene did exactly that: every neighbour read lava), so the shore is one step UP
  deep1: { cells: [f(1, 4, -1, -1, -2, 2, 'lava')], start: { x: 1.5, y: -1, z: 0.5, yaw: -90 }, check: [[1, -1, 0, 'lava'], [0, -1, 0, 'stone'], [1, -2, 0, 'stone'], [0, 0, 0, 'air']] },
  ledge: { cells: [f(-6, 6, -2, -1, 1, 4, 'lava'), f(-6, 6, -2, -1, -4, -1, 'lava')], start: { x: 0.5, y: 0, z: 1.2, yaw: 0 }, check: [[0, -1, 0, 'stone'], [0, -1, 1, 'lava'], [0, -1, -1, 'lava'], [-6, -1, -4, 'lava']] },
  magma: { cells: [s1(0, -1, 0, 'magma_block')], start: { x: 0.5, y: 0, z: 0.5, yaw: -90 }, check: [[0, -1, 0, 'magma_block']] },
  fall: { cells: [f(1, 6, -1, -1, -4, 4, 'lava')], start: { x: 1.3, y: 3, z: 0.5, yaw: -90 }, check: [[1, -1, 0, 'lava'], [0, -1, 0, 'stone']] },
  campfire: { cells: [s1(0, 0, 0, 'campfire[lit=true]')], start: { x: 0.5, y: 0.5, z: 0.5, yaw: -90 }, check: [[0, 0, 0, 'campfire']] },
}
const DEF = SCENE_DEF[SCENE]
const sceneBad = () => { for (const [dx, dy, dz, n] of DEF.check) if (!isBlock(A.x + dx, A.y + dy, A.z + dz, n)) return `scene cell ${dx},${dy},${dz} is not ${n}`; return null }
const BAG_WANT = BAG === 'cobble' ? { cobblestone: 128, stone_pickaxe: 1, oak_log: 16 } : { stone_pickaxe: 1, oak_log: 16 }
const bagBad = inv => { const ks = new Set([...Object.keys(inv), ...Object.keys(BAG_WANT)]); const bad = [...ks].filter(k => (inv[k] || 0) !== (BAG_WANT[k] || 0)); return bad.length ? `bag ${JSON.stringify(inv)}` : null }

// ---------------------------------------------------------------- the brain (in process) + the bots
const BRAIN_PORT = 11520 + 2 * Object.keys(PORTS).indexOf(SERVER) + SLOT
const brain = { mode: 'status', served: 0, gotoServedAt: null }
let server = null
function startBrain () {
  if (stopping) throw new Error('stopping: the brain is not started once the cleanup has begun')
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let body = ''; req.on('data', c => { body += c })
      req.on('end', () => {
        if (req.url.startsWith('/api/version')) { res.end(JSON.stringify({ version: '0.0.0-sandbox' })); return }
        if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('lavastep brain'); return }
        let msgs = []; try { msgs = JSON.parse(body).messages || [] } catch {}
        const sentinel = (msgs.map(m => String(m.content || '')).join('\n').match(/END-[A-Z0-9]{4,12}/g) || []).pop() || ''
        const g = brain.mode === 'goto' ? DEF.goto : null
        const skill = g ? 'goto' : 'status', args = g ? { x: g.x, y: g.y, z: g.z } : {}
        brain.served++
        if (g && brain.gotoServedAt == null) brain.gotoServedAt = Date.now()
        const content = JSON.stringify({ skill, args, reason: `lavastep driver: ${skill}`, saw_end: sentinel })
        fs.appendFileSync(path.join(RUN, 'brain.out'), `${new Date().toISOString()} ${skill} ${JSON.stringify(args)}\n`)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ model: 'sandbox-script', created_at: new Date().toISOString(), message: { role: 'assistant', content }, done: true,
          total_duration: 1e6, load_duration: 0, prompt_eval_count: 10, prompt_eval_duration: 5e5, eval_count: 5, eval_duration: 5e5 }))
      })
    })
    server.on('error', reject)
    server.listen(BRAIN_PORT, '127.0.0.1', resolve)
  })
}
const procs = new Set()
function track (child, label) {
  procs.add(child)
  child.on('error', e => { P_(`${label} process error`, e.message); stopping = true })
  child.on('exit', () => procs.delete(child))
  return child
}
const prefix = `ls${NONCE}`        // the label, scene, server and slot are in the run's directory and every row, not the name
if (prefix.length !== 10) throw new Error(`bot name prefix ${prefix} is not 10 characters`)
const nameFor = k => `${prefix}${k}`
function launch (k) {
  if (stopping) throw new Error('stopping: no bot is launched once the cleanup has begun')
  const name = nameFor(k)
  const dir = path.join(RUN, name)
  fs.mkdirSync(path.join(dir, 'log'), { recursive: true }); fs.mkdirSync(path.join(dir, 'state'), { recursive: true })
  const poolDir = path.join(dir, 'pool'); fs.mkdirSync(poolDir, { recursive: true })
  const env = { ...process.env,
    BOT_NAME: name, BOT_ROLE: 'gatherer', EXP_INSTANCE: 'sandbox', EXP_BLOCK: 'sandbox', EXP_ARM: 'sandbox', MEMORY_SCOPE: 'checkpoint',
    MEMORY_POOL: `sbxls-${LABEL}-${SCENE}-${NONCE}-${k}`, POOL_STATE_DIR: poolDir, MINECRAFT_HOST: '10.0.0.30', MINECRAFT_PORT: String(PORTS[SERVER]),
    MINECRAFT_VERSION: '1.21.8', MINECRAFT_AUTH: 'offline', WORLD_BORDER_RADIUS: '20000',   // the arenas sit ~9,000 from 0,0: 8000 rejected every goto (busy)
    BOARD_RADIUS: '8', REFLEX_TICK_MS: '500',
    SKILL_TIMEOUT_MS: '180000', MAX_CONSECUTIVE_FAILURES: '500', EAT_BELOW_FOOD: '16', FLEE_BELOW_HEALTH: '8', STUCK_SECONDS: '35',
    LLM_ENABLED: 'true', OLLAMA_MODEL: 'sandbox-script', OLLAMA_NUM_CTX: '8192', OLLAMA_BASE_URL: `http://127.0.0.1:${BRAIN_PORT}`,
    OLLAMA_BASE_URLS: `http://127.0.0.1:${BRAIN_PORT}`, LLM_MAX_TOKENS: '512', LLM_TEMPERATURE: '0.7', LLM_TIMEOUT_MS: '45000',
    LLM_PROMPT_TOKEN_BUDGET: '3000', LLM_DECISION_COOLDOWN_MS: '4000', RECONNECT_DELAY_MS: '8000', RECONNECT_MAX_DELAY_MS: '120000',
    ENABLE_AGENT_CODE_EXECUTION: 'false', VIEWER_ENABLED: 'false', VIEWER_FIRST_PERSON: 'false', VIEWER_PORT: '0', LOG_LEVEL: 'info',
    CODE_VERSION: `sandbox-ls-${LABEL}`, RUN_ID: 'sandbox-lavastep01', LOG_DIR: path.join(dir, 'log'), STATE_DIR: path.join(dir, 'state'),
    // home and board 300 blocks east (as r1/r2: no town behaviour near the scene); a walk there stops at the barrier box
    HOME_X: String(A.x + 300), HOME_Y: String(A.y), HOME_Z: String(A.z), BOARD_X: String(A.x + 300), BOARD_Y: String(A.y), BOARD_Z: String(A.z) }
  delete env.LAVASTEP           // both arms run their build's default; a stray LAVASTEP=0 in the shell cannot flip the candidate
  // `lsrun=<run>` (ignored by the bot) tags the process, so a later run can see it outlived this driver (staleOwner)
  const child = track(spawn(process.execPath, ['--max-old-space-size=768', 'src/index.mjs', `lsrun=${NONCE}`], { cwd: path.join(BOT_ROOT, 'bots'), env, stdio: ['ignore', 'pipe', 'pipe'] }), `bot ${name}`)
  const out = fs.createWriteStream(path.join(dir, 'bot.out')); out.on('error', () => {}); child.stdout.pipe(out); child.stderr.pipe(out)
  return { name, dir, child, log: path.join(dir, 'log', `skill-${name}.jsonl`) }
}
async function retire (b) {
  if (!b) return
  try { b.child.kill('SIGTERM') } catch {}
  for (let k = 0; k < 25 && b.child.exitCode === null && b.child.signalCode === null; k++) await sleep(200)
  if (b.child.exitCode === null && b.child.signalCode === null) { try { b.child.kill('SIGKILL') } catch {} }
  for (let k = 0; k < 20; k++) { try { if (!online().includes(b.name)) break } catch {} await sleep(500) }
}
const rowsOf = b => {
  try { return fs.readFileSync(b.log, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) }
  catch (e) { if (e.code === 'ENOENT') return []; throw new Error(`the build's log is unreadable (${b.log}): ${e.message}`) }
}
const kind = r => r?.skill?.name ?? ''
const tsOf = r => Date.parse(r?.['@timestamp'] ?? '') || 0
function wilson (k, n) {
  if (!n) return [0, 1]
  const z = 1.96, p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return [+(Math.max(0, c - h)).toFixed(3), +(Math.min(1, c + h)).toFixed(3)]
}

/** Build the arena for one trial, verified, BEFORE the bot exists. */
function buildArena () {
  batch([killCmd, ...boxCmds(), ...DEF.cells])
  const bad = sceneBad()
  if (bad) throw new Error(bad)
  if (!isBlock(REST.x, REST.y - 1, REST.z, 'stone') || !isBlock(REST.x, REST.y, REST.z, 'air')) throw new Error('the staging pad is not stone under air')
  for (const [x, y, z] of [[A.x - R, A.y, A.z], [A.x + R, A.y + 5, A.z + R], [A.x, A.y + 12, A.z], [A.x, A.y - 8, A.z]]) if (!isBlock(x, y, z, 'barrier')) throw new Error(`box cell ${x},${y},${z} is not barrier`)
}

/** One trial on a FRESH bot. -> a result row; `invalid` names why it was not a measurement. */
async function trial (k) {
  sbx.requireSandboxLock(SERVER, 'lavastep')
  const invalid = (why, extra = {}) => { P_('INVALID', { trial: k, why }); return { trial: k, invalid: why, ...extra } }
  try { buildArena() } catch (e) { return invalid(`arena: ${e.message}`) }
  brain.mode = 'status'; brain.gotoServedAt = null
  let b = null, tSurvival = null
  try {
    // LAUNCH behind a confirmed server-side safeguard (setDefault('adventure') below), then STAGE
    const st = await (async () => {     // no lock: see the header (a restore cannot follow a run's registration)
      setDefault('adventure')
      b = launch(k)
      let joined = false
      for (let w = 0; w < 160; w++) { await sleep(250); if (online().includes(b.name)) { joined = true; break } if (b.child.exitCode !== null) break }
      if (!joined) return { bad: 'the bot did not join' }
      const tJoin = Date.now()
    // the joined mode is read in the SAME round trip as the teleport into the box
    const stg = [`data get entity ${b.name} playerGameType`, `tp ${b.name} ${REST.x + 0.5} ${REST.y} ${REST.z + 0.5}`, `spawnpoint ${b.name} ${REST.x} ${REST.y} ${REST.z}`]
      const stgr = rcon(...stg)
      if (stgr.length !== 3 || stgr.some((x, i) => x.cmd !== stg[i])) return { bad: 'staging: replies do not match the commands' }
      const joinMode = dataOf(stgr[0])
      if (joinMode !== '2') throw new Fatal(`joined in mode ${joinMode}, not adventure: the join safeguard did not hold on ${SERVER}; stopping the run`)
      if (!/^Teleported /.test(stgr[1].reply) || !/^Set spawn point to/.test(stgr[2].reply)) return { bad: `staging: ${stgr[1].reply} | ${stgr[2].reply}` }
      const joinToStagedMs = Date.now() - tJoin
      if (joinToStagedMs > 5000) return { bad: `staging took ${joinToStagedMs} ms after the join was seen` }
      const staged = probe(b.name)
      if (!staged.ok || !inBox(staged.pos)) return { bad: `not staged: ${staged.why ?? JSON.stringify(staged.pos)}` }
      batch([`gamemode survival ${b.name}`, `clear ${b.name}`])
      tSurvival = Date.now()
      const mode2 = dataOf(rcon(`data get entity ${b.name} playerGameType`)[0])
      if (mode2 !== '0') return { bad: `staged but mode ${mode2}, not survival` }
      // the FORCE-GAMEMODE PROBE: re-send the default with this bot online in survival; a flip means the server forces
      // modes onto online players, so the other slot's launches could flip a bot mid-trial: stop the run
      setDefault('adventure')
      const mode3 = dataOf(rcon(`data get entity ${b.name} playerGameType`)[0])
      if (mode3 !== '0') { try { batch([`gamemode survival ${b.name}`]) } catch {} throw new Fatal(`force-gamemode: defaultgamemode flipped an online bot to mode ${mode3}; concurrent arms are unsafe on ${SERVER}`) }
      return { tJoin, joinMode, joinToStagedMs }
    })()
    if (st.bad) return invalid(st.bad)
    const { tJoin, joinMode, joinToStagedMs } = st
    const servedAtJoin = brain.served
    for (let w = 0; w < 60 && brain.served === servedAtJoin; w++) await sleep(250)    // the cognitive loop is running
    if (brain.served === servedAtJoin) return invalid('no decision within 15 s of joining')
    // PREPARE, VERIFIED: not burning, healed, fed, the bag
    let rested = null
    for (let w = 0; w < 30; w++) { await sleep(500); const p = probe(b.name); if (p.ok && p.fire <= 0) { rested = p; break } }
    if (!rested) return invalid('not seen with the fire out within 15 s at the staging pad')
    const bag = BAG === 'cobble' ? ['cobblestone 64', 'cobblestone 64', 'stone_pickaxe 1', 'oak_log 16'] : ['stone_pickaxe 1', 'oak_log 16']
    batch([`effect give ${b.name} minecraft:instant_health 1 10 true`, `effect give ${b.name} minecraft:saturation 1 20 true`,
           ...bag.map((it, i) => { const [id, n] = it.split(' '); return `item replace entity ${b.name} container.${i} with minecraft:${id} ${n}` })])
    await sleep(1200)
    batch([`effect clear ${b.name}`])
    // RE-CHECK just before the release: the scene, the whole bag, health, food, fire, deaths, no death row
    const badScene = sceneBad()
    if (badScene) return invalid(`before release: ${badScene}`)
    const badBag = bagBad(inventory(b.name))
    if (badBag) return invalid(`before release: ${badBag}`)
    const food = /^(\d+)$/.exec(dataOf(rcon(`data get entity ${b.name} foodLevel`)[0]) ?? '')
    const pre = probe(b.name)
    if (!pre.ok || pre.hp < 19 || pre.fire > 0 || pre.deaths !== 0 || !food || +food[1] < 20) return invalid(`not ready: ${JSON.stringify(pre)} food ${food?.[1]}`)
    if (rowsOf(b).some(r => kind(r) === '_death')) return invalid('a _death row before the release')
    let busyPre = null
    if (SCENE === 'busy') {
      // the goto must be RUNNING at the release: switch the brain, wait for the bot to take the goto, let it walk 0.5 s, and
      // see it has moved, is not at the target, and is still whole (one round trip each for the bag and the body)
      brain.mode = 'goto'
      for (let w = 0; w < 48 && brain.gotoServedAt == null; w++) await sleep(250)
      if (brain.gotoServedAt == null) return invalid('the bot took no goto decision within 12 s')
      await sleep(500)       // the second r3 smoke: 14 of the 18 blocks were covered 1.2 s after the decision
      const q = probe(b.name)
      if (!q.ok || q.hp < 19 || q.fire > 0 || q.deaths !== 0) return invalid(`busy, not ready: ${JSON.stringify(q)}`)
      const moved = Math.hypot(q.pos.x - (REST.x + 0.5), q.pos.z - (REST.z + 0.5)), left = Math.hypot(q.pos.x - (DEF.goto.x + 0.5), q.pos.z - (DEF.goto.z + 0.5))
      if (moved < 0.5 || left < 3) return invalid(`busy: the goto is not under way (moved ${moved.toFixed(1)}, ${left.toFixed(1)} to go)`)
      const bb = bagBad(inventory(b.name))
      if (bb) return invalid(`busy, before release: ${bb}`)
      busyPre = { moved: +moved.toFixed(1), toGo: +left.toFixed(1), servedMsBeforeRelease: Date.now() - brain.gotoServedAt }
    }
    const tick = mspt()
    // RELEASE: the start pose, position AND rotation read back in the same round trip
    const s = DEF.start
    const yaw = YAW === 'cycle' ? ((s.yaw + 45 * (k % 8) + 540) % 360) - 180 : s.yaw
    const tpCmd = `tp ${b.name} ${A.x + s.x} ${A.y + s.y} ${A.z + s.z} ${yaw} 0`
    const t0 = Date.now()
    const releasedAt = new Date(t0).toISOString()
    const rel = rcon(tpCmd, `data get entity ${b.name} Pos`, `data get entity ${b.name} Rotation`)
    if (rel.length !== 3 || rel[0].cmd !== tpCmd || !/^Teleported /.test(rel[0].reply)) return invalid(`release tp: ${rel[0]?.reply}`)
    const sp = /^\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]$/.exec(dataOf(rel[1]) ?? ''), sr = /^\[(-?[\d.]+)f, (-?[\d.]+)f\]$/.exec(dataOf(rel[2]) ?? '')
    if (!sp || !sr) return invalid(`release readback: ${rel[1].reply} | ${rel[2].reply}`)
    const start = { x: +sp[1], y: +sp[2], z: +sp[3] }, startYaw = +sr[1]
    if (Math.hypot(start.x - (A.x + s.x), start.z - (A.z + s.z)) > 0.6 || Math.abs(start.y - (A.y + s.y)) > (SCENE === 'fall' ? 2 : 0.7)) return invalid(`start pose not taken: ${JSON.stringify(start)}`)
    const dYaw = Math.abs((((startYaw - yaw) % 360) + 540) % 360 - 180)
    if (dYaw > 2) return invalid(`start rotation not taken: ${startYaw} vs ${yaw}`)
    // OBSERVE: the window, then until the fire is out (<= 20 s more), no rest, no heal; every probe complete or a gap
    const obsMspt = []
    let minHp = pre.hp, died = false, hp0 = false, burned = 0, last = null, deathAt = null, gaps = 0, run = 0, probes = 0, censored = false, left = null
    const until = t0 + SECS * 1000
    for (let phase = 0; phase < 2 && !died; phase++) {
      const end = phase === 0 ? until : Date.now() + 20_000
      let out = false
      while (Date.now() < end) {
        await sleep(500)
        const p = probe(b.name); probes++
        if (probes % 10 === 0) { const m = mspt(); if (m) obsMspt.push(m.avg5s) }
        if (!p.ok) { gaps++; run++; if (run >= 6) return invalid(`observation gap: ${run} probes in a row (${p.why})`, { gaps, probes }); continue }
        run = 0
        minHp = Math.min(minHp, p.hp)
        if (p.fire > 0) burned++
        if (p.deaths > 0 || p.hp <= 0) { died = true; hp0 = p.hp <= 0; deathAt = Date.now() - t0; break }
        if (!inBox(p.pos)) { left = p.pos; break }
        last = p
        if (phase === 1 && p.fire <= 0) { out = true; break }
      }
      if (left) break
      if (phase === 1 && !died && !out) censored = true
    }
    if (left) return invalid(`left arena alive at ${JSON.stringify(left)}`)
    if (gaps > 0.1 * probes) return invalid(`observation gaps ${gaps}/${probes}`, { gaps, probes })
    // DEATH, AFFIRMED: the server's score, read again (respawn settled), against the build's row and health 0
    let score = null
    for (let w = 0; w < 6 && score == null; w++) { await sleep(died ? 1500 : 200); const p = probe(b.name); if (p.ok) score = p.deaths }
    if (score == null) return invalid('the death score is unreadable at the end')
    // its mode at the end, dead or alive (a respawn keeps it): still survival, so nothing flipped it mid-trial (Claude r5
    // P3-2); after a death, it respawned inside the box (Claude r5 P3-7)
    if (died) {   // the RESPAWN, seen (r6 Codex P2, Claude P3-4): positive health, at the staging pad, within 10 s
      let pr = null
      const atPad = p => Math.hypot(p.x - (REST.x + 0.5), p.z - (REST.z + 0.5)) <= 3 && Math.abs(p.y - REST.y) <= 2   // Claude r6 P3-4
      for (let w = 0; w < 20; w++) { pr = probe(b.name); if (pr.ok && pr.hp > 0 && inBox(pr.pos) && atPad(pr.pos)) break; await sleep(500) }
      if (!pr?.ok || !(pr.hp > 0) || !inBox(pr.pos) || !atPad(pr.pos)) return invalid(`after the death: no respawn seen inside the box (${pr?.why ?? JSON.stringify({ hp: pr?.hp, pos: pr?.pos })})`)
    }
    const mEnd = dataOf(rcon(`data get entity ${b.name} playerGameType`)[0])
    if (mEnd !== '0') return invalid(`mode ${mEnd} at the end of the observation, not survival`)
    let all = rowsOf(b)
    if (score > 0) for (let w = 0; w < 20 && !all.some(r => kind(r) === '_death' && tsOf(r) >= t0 - 200); w++) { await sleep(500); all = rowsOf(b) }
    const rows = all.filter(r => tsOf(r) >= t0 - 200)
    const deathRow = rows.some(r => kind(r) === '_death')
    if (died !== (score > 0) || (score > 0) !== deathRow) return invalid(`death evidence disagrees: probe ${died} score ${score} row ${deathRow}`)
    if (!died && last == null) return invalid('no complete observation after the release')
    // the LIMITED log check (see the header), and its positive control (the same predicate after the release)
    const early = all.filter(r => tsOf(r) < tSurvival && editRow(r))
    if (early.length) return invalid(`a possible block edit before survival: ${early.map(kind).join(',')}`)
    const editRowsAfter = rows.filter(editRow).length
    if (censored) return invalid('censored: still burning 20 s after the window', { censored: true, minHp })
    const firstDanger = rows.filter(r => kind(r) === '_reflex_danger_block').map(tsOf).sort((a, c) => a - c)[0] ?? null
    const standOffFirst = rows.some(r => kind(r) === '_lava_adjacent_stand_off' && (firstDanger == null || tsOf(r) <= firstDanger))
    // busy EXPOSURE, by the goto's span alone: the brain's goto (its args), stamped at its START (after the switch, before the
    // release) and ended after the release. Whether the danger arm cut it is an OUTCOME, reported apart (gotoDangerCut).
    let gotoSpan = null, gotoDangerCut = null
    if (SCENE === 'busy') {
      const spans = all.filter(r => kind(r) === 'goto' && r.skill?.args?.x === DEF.goto.x && r.skill?.args?.z === DEF.goto.z &&
        tsOf(r) >= brain.gotoServedAt - 500 && tsOf(r) < t0 && tsOf(r) + (r.skill?.duration_ms ?? 0) >= t0)
      gotoSpan = spans.length > 0
      gotoDangerCut = spans.some(r => r.skill?.status !== 'success' && /danger_block/.test(`${r.trigger ?? ''} ${r.skill?.detail ?? ''}`))
      // Claude r4 P3-1: a trial proven mid-goto before the release (busyPre) but with no span row is not quietly dropped
      if (!gotoSpan) return invalid('busy: exposure unproven (no goto row spans the release)')
    }
    let endCell = null, endHazard = null
    if (!died) {
      const fx = Math.floor(last.pos.x), fy = Math.floor(last.pos.y), fz = Math.floor(last.pos.z)
      endCell = [fx, fy, fz]
      endHazard = ['lava', 'fire', 'magma_block', 'campfire'].filter(n => isBlock(fx, fy, fz, n) || isBlock(fx, fy - 1, fz, n))
    }
    const retreats = rows.filter(r => kind(r) === '_lava_retreat').map(r => r.skill?.args ?? {}).filter(a => a.phase === 'firing')
    const res = {
      trial: k, name: b.name, scene: SCENE, bag: BAG, yaw, died, deathAtMs: deathAt, deathEvidence: { score, row: deathRow, hp0 }, minHp,
      endHp: died ? null : last.hp, endFire: died ? null : last.fire, burnedHalfSeconds: burned, probes, gaps, start, startYaw,
      end: died ? null : last.pos, endCell, endOnHazard: endHazard && endHazard.length ? endHazard : null,
      fired: firstDanger != null, dangerRows: rows.filter(r => kind(r) === '_reflex_danger_block').length, masked: standOffFirst, gotoSpan, gotoDangerCut,
      licence: all.some(r => kind(r) === '_lavastep_mode' && /on=1/.test(r.skill?.detail ?? '')),   // written at spawn, before t0
      retreats: retreats.map(a => ({ case: a.case, outcome: a.outcome, path: (a.path || []).join('>'), ended: a.ended, seal: a.seal?.witnessed ?? null, aim: a.aim?.chosen ?? null })),
      deathMsg: rows.filter(r => kind(r) === '_death').map(r => String(r.skill?.detail ?? '').slice(0, 120)),
      editRowsAfter, mspt: { pre: tick, obsAvg5s: obsMspt, obsMax: obsMspt.length ? Math.max(...obsMspt) : null }, releasedAt, joinMode, joinToStagedMs, joinToReleaseMs: t0 - tJoin, busyPre,
    }
    P_('TRIAL', res)
    return res
  } catch (e) {
    if (e instanceof Fatal || /sandbox lock/i.test(e.message)) throw e
    return invalid(`error: ${e.message.slice(0, 200)}`)
  } finally {
    if (b) await retire(b)
  }
}

let setupBegan = false, forceAdded = false, objAdded = false
async function main () {
  for (let k = 0; k < 30 && online().some(n => n.startsWith(prefix)); k++) await sleep(2000)
  if (online().some(n => n.startsWith(prefix))) throw new Error('a bot of this run is still online: ' + online().join(','))
  P_(`root=${BOT_ROOT} sha=${sha} lavastep_build=${lavastepBuild} server=${SERVER} slot=${SLOT} scene=${SCENE} bag=${BAG} yaw=${YAW} trials=${TRIALS} secs=${SECS} arena=${A.x},${A.y},${A.z} nonce=${NONCE} objective=${OBJ}`)
  // Claude r8 P3-3: a worlds-host marker without `mid=` was written by a pre-r8 driver, whose sweep rules are weaker:
  // refuse to share the server with it
  const preR8 = wMarkers().filter(m => !/\bmid=/.test(m.text))
  if (preR8.length) throw new Error(`an older (pre-r8) lavastep driver's marker is on ${SERVER}; retire that checkout and resolve by hand: ${preR8.map(m => m.text).join(' | ')}`)
  // Claude r8 P3-2 / Codex r9 P2: SIGKILL any orphaned bot of a run whose driver is gone (same machine) BEFORE the arena
  // claim and before judging staleness -- including the run that owns this arena's claim (so restarting the killed
  // driver's own scene and slot can drain it)
  let arenaOwner = ''
  try { arenaOwner = execFileSync('ssh', [...SSH, `cat ${ARENA}/owner 2>/dev/null || true`], { encoding: 'utf8', timeout: 30000 }).trim() } catch {}
  for (const m of [...wMarkers(), ...(arenaOwner ? [{ name: 'arena', text: arenaOwner }] : [])]) {
    const h = /host=(\S+)/.exec(m.text)?.[1], mid = /mid=([0-9a-f-]+)/.exec(m.text)?.[1], p = Number(/pid=(\d+)/.exec(m.text)?.[1])
    const ps = Number(/pstart=(\d+)/.exec(m.text)?.[1]), run = /run=([a-z0-9]{8})\b/.exec(m.text)?.[1]
    if (!run || run === NONCE || h !== HOSTNAME || mid !== MACHINE || MACHINE === 'unknown' || !(p > 0) || !driverGone(p, ps)) continue
    let lines = []
    try { lines = execFileSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8', timeout: 5000 }).split('\n') } catch {}
    for (const l of lines) {
      const mm = /^\s*(\d+)\s+(.*)$/.exec(l)
      if (mm && mm[2].includes(`lsrun=${run}`) && Number(mm[1]) !== process.pid) { P_(`WARNING: SIGKILL orphaned bot pid ${mm[1]} of run ${run} (its driver is gone)`); try { process.kill(Number(mm[1]), 'SIGKILL') } catch {} }
    }
  }
  await sleep(1500)
  // STARTUP: the arena CLAIM (fenced; before any world change), then this run's markers (fenced; before any adventure
  // default), the stale ones going in the same section (this run's marker now stands for the adventure state)
  claimArena()
  if (forced().some(Boolean)) {
    // Claude r10 P3-3: a refusal names the remedy; after a stale takeover the forceload is the dead run's
    const rm = `forceload remove ${A.x - R} ${A.z - R} ${A.x + R} ${A.z + R}`
    throw new Error(staleTaken
      ? `the arena's chunks are still force-loaded by the dead run whose stale claim this run just took over (its box may also be left): restore that arena and send '${rm}' by RCON, then start again`
      : `the arena's chunks are already force-loaded (another run on ${SERVER} slot ${SLOT}?); if no run uses this arena, send '${rm}' by RCON`)
  }
  // Claude r7 P3-4: a warning copy on the lock host with no authoritative twin on the worlds host means an OLDER driver
  // (r5/r6 kept its state on the lock host) or a half-written marker: refuse rather than guess
  let orphanCopies = []
  for (let t = 0; t < 4; t++) {   // r8 Codex P2: a healthy concurrent startup writes its copy just before its twin
    const copies = parseList(lh(listScript(MDIR)))
    const twins = new Set(wMarkers().map(m => m.name))
    // Claude r8 P2-1: a copy whose owner is a LIVE driver on this machine is a sibling mid-registration, not an orphan
    const liveSibling = m => { const p = Number(/pid=(\d+)/.exec(m.text)?.[1]), mid = /mid=([0-9a-f-]+)/.exec(m.text)?.[1]; return mid === MACHINE && MACHINE !== 'unknown' && p > 0 && p !== process.pid && alive(p) }
    orphanCopies = copies.filter(m => !twins.has(m.name) && !liveSibling(m))
    if (!orphanCopies.length) break
    await sleep(2000)
  }
  if (orphanCopies.length) throw new Error(`lock-host marker(s) with no worlds-host twin (an older driver, or a half-written marker; check and remove by hand): ${orphanCopies.map(m => m.text).join(' | ')}`)
  const before = wMarkers().filter(m => m.name !== NONCE)
  const stale = before.filter(m => staleOwner(m.text))
  register(stale.map(m => m.name))
  for (const m of stale) P_(`WARNING: stale adventure marker removed: ${SERVER}/${m.name}: ${m.text}`)
  for (const m of before.filter(m => !staleOwner(m.text))) P_(`note: adventure marker of another driver on ${SERVER}: ${m.text}`)
  setupBegan = true
  forceAdded = true      // marked BEFORE the add is sent: a lost acknowledgement must still get a removal
  batch([`forceload add ${A.x - R} ${A.z - R} ${A.x + R} ${A.z + R}`])
  objAdded = true
  batch([`scoreboard objectives add ${OBJ} deathCount`])
  await sleep(1500)
  await startBrain()
  const results = []
  let badRun = 0
  for (let k = 0; k < TRIALS && !stopping; k++) {
    const r = await trial(k)
    results.push(r)
    fs.appendFileSync(TRIALS_FILE, JSON.stringify({ at: new Date().toISOString(), label: LABEL, scene: SCENE, bag: BAG, yawMode: YAW, sha, lavastep_build: lavastepBuild, server: SERVER, slot: SLOT, nonce: NONCE, ...r }) + '\n')
    badRun = r.invalid && !r.censored ? badRun + 1 : 0
    if (badRun >= 5) { P_('STOP: five invalid trials in a row'); break }
  }
  const valid = results.filter(r => !r.invalid)
  const unmasked = valid.filter(r => !r.masked)
  const sum = list => { const n = list.length, ok = list.filter(r => !r.died).length, un = list.filter(r => !r.died && r.minHp >= 18).length; return { n, survived: ok, survival_ci95: wilson(ok, n), unhurt: un, unhurt_ci95: wilson(un, n) } }
  const exposed = SCENE === 'busy' ? valid.filter(r => r.gotoSpan) : null
  const yaws = YAW === 'cycle' ? Object.fromEntries([...new Set(valid.map(r => r.yaw))].sort((a, c) => a - c).map(y => [y, { n: valid.filter(r => r.yaw === y).length, survived: valid.filter(r => r.yaw === y && !r.died).length }])) : null
  const ms = valid.flatMap(r => [r.mspt?.pre?.avg5s, ...(r.mspt?.obsAvg5s ?? [])]).filter(x => x != null).sort((a, c) => a - c)
  const summary = { at: new Date().toISOString(), label: LABEL, scene: SCENE, bag: BAG, yawMode: YAW, sha, lavastep_build: lavastepBuild, server: SERVER, slot: SLOT, nonce: NONCE,
    trials: results.length, invalid: results.filter(r => r.invalid && !r.censored).map(r => `${r.trial}:${r.invalid}`), censored: results.filter(r => r.censored).map(r => r.trial),
    valid: sum(valid), unmasked: sum(unmasked), masked: valid.length - unmasked.length, fired: valid.filter(r => r.fired).length, licence: valid.filter(r => r.licence).length,
    gotoSpan: exposed ? exposed.length : null, gotoDangerCut: exposed ? exposed.filter(r => r.gotoDangerCut).length : null,
    busy_exposed: exposed ? sum(exposed) : null, by_yaw: yaws,
    median_min_hp: valid.map(r => r.minHp).sort((a, c) => a - c)[Math.floor(valid.length / 2)] ?? null,
    mspt_avg5s: ms.length ? { median: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] } : null,
    editRowsAfter: valid.reduce((n, r) => n + (r.editRowsAfter || 0), 0),
    outcomes: Object.entries(valid.flatMap(r => r.retreats.map(x => x.outcome)).reduce((m, o) => (m[o] = (m[o] || 0) + 1, m), {})),
    synthetic: 'arena by RCON in a closed barrier box; a fresh bot per trial, staged on a dry pad in the box on join, healed + fed, given the scene bag, teleported to the start pose (all verified); joined in adventure mode (no edits before staging); scripted in-process brain (status; busy: an away-directed goto, released mid-goto)' }
  fs.appendFileSync(RES, JSON.stringify({ ...summary, results }) + '\n')
  P_('SUMMARY', summary)
}
let cleaned = null
function cleanup () { return (cleaned ??= cleanupOnce()) }
async function step (what, fn, tries = 3) {
  for (let t = 1; t <= tries; t++) { try { await fn(); return true } catch (e) { P_(`cleanup ${what} attempt ${t} FAILED`, e instanceof Fatal ? e.message : e.message.slice(0, 200)); if (e instanceof Fatal) return false; await sleep(1000) } }
  return false
}
async function cleanupOnce () {
  stopping = true
  for (let pass = 0; pass < 2; pass++) {     // twice: a child spawned while the first pass ran is caught by the second
    for (const c of [...procs]) { try { c.kill('SIGTERM') } catch {} }
    for (let k = 0; k < 25 && [...procs].some(c => c.exitCode === null && c.signalCode === null); k++) await sleep(200)
    for (const c of [...procs]) { if (c.exitCode === null && c.signalCode === null) { try { c.kill('SIGKILL') } catch {} } }
    await sleep(500)
  }
  try { server?.close() } catch {}
  let ok = true
  if (setupBegan) {
    // each independently: a failed restore never skips the forceload removal or the objective
    ok = await step('restore', () => { batch([killCmd, ...restoreCmds()]); if (!isBlock(A.x - R, A.y, A.z, 'air') || !isBlock(A.x, A.y - 8, A.z, 'stone')) throw new Error('restore not read back') }) && ok
    if (forceAdded) ok = await step('forceload', () => { try { batch([`forceload remove ${A.x - R} ${A.z - R} ${A.x + R} ${A.z + R}`]) } catch (e) { P_('forceload remove', e.message.slice(0, 120)) } if (forced().some(Boolean)) throw new Error('still force-loaded') }) && ok
    // the objective's name carries this run's nonce, so removing it never touches another run's
    if (objAdded) ok = await step('objective', () => {
      const t = r1(`scoreboard objectives remove ${OBJ}`)
      if (!/^(Removed objective|Unknown scoreboard objective)/.test(t)) throw new Error(`objective remove: ${t}`)
      const l = r1('scoreboard objectives list')
      if (!/^There are/.test(l) || l.includes(`[${OBJ}]`)) throw new Error(`objective still listed: ${l.slice(0, 120)}`)
    }) && ok
  }
  if (registered) {
    // the LAST driver to leave restores survival FIRST (confirmed), and only then deletes markers: a kill in between
    // leaves a marker, never a silent adventure default
    markerGone = true
    ok = await step('default mode', () => {
      const st = staleNames()
      for (const m of st) P_(`cleanup: stale adventure marker (driver gone, run drained) goes with the restore: ${m.text}`)
      const r = restoreIfLast(st.map(m => m.name))
      if (r.startsWith('LEFT')) P_(`cleanup: default mode left to the markers${r.slice(4)}`)
    }) && ok
  }
  if (arenaClaimed) ok = await step('arena claim', () => releaseArena()) && ok
  if (setupBegan) {   // printed whether or not RCON still answers (Claude r5 P2-A)
    let who = '(online unknown)'; try { who = online().join(',') } catch {}
    P_(ok ? 'cleanup ok' : 'cleanup INCOMPLETE', who)
  }
  // this process's SSH master: closed and verified gone (`-O check` fails once no master listens)
  const sshCtl = op => { try { execFileSync('ssh', [...SSH.slice(0, -1), '-O', op, SSH[SSH.length - 1]], { stdio: 'ignore', timeout: 10000 }); return true } catch { return false } }
  if (sshCtl('check')) { sshCtl('exit'); if (sshCtl('check')) { P_('cleanup: the SSH master is still running'); ok = false } }
  return ok
}
const finish = code => cleanup().then(ok => process.exit(ok ? code : 3))
process.on('uncaughtException', e => { P_('FATAL uncaught', e.stack || e.message); finish(1) })
process.on('unhandledRejection', e => { P_('FATAL unhandled', e?.stack || String(e)); finish(1) })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopping = true; finish(1) })
main().then(() => finish(0), e => { P_('FATAL', e.stack || e.message); finish(1) })
