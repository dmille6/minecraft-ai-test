'use strict'
// SANDBOX LOCKS (2026-10-20, sandbox58-1020). The locks live in /tmp on the bots host 10.0.0.31 and are mkdir locks
// with an `owner` file whose FIRST WORD is the holder's tag. There are two kinds, and they coexist:
//
//   /tmp/mcai-sandbox.lock            the GLOBAL lock (unchanged since September): its holder has EVERY sandbox.
//   /tmp/mcai-sandbox.lock.<name>     a PER-SERVER lock (new): its holder has that one sandbox, e.g. .sandbox6.
//
// THE RULE A DRIVER ENFORCES (lockVerdict): a run on server S is allowed only when EVERY lock that covers S -- the
// global one and S's own -- is either absent or has EXACTLY this driver's tag as its owner's FIRST WORD,
// and at least one of them is held. So a
// global holder whose driver targets a server someone else holds per-server is refused, and so is the per-server
// holder if a different owner holds the global lock. When BOTH locks are held their owners' first words must also be
// identical, so two owners can never both pass for the same server -- not even for a driver that accepts a LIST of tags.
//
// TAKING (sandbox/sbxlock.sh) is announce-then-check: mkdir your lock, THEN look for the other kind and back out if
// it is there. Two concurrent takers can both back out; they cannot both succeed.
//
// A legacy taker (a hand `mkdir /tmp/mcai-sandbox.lock`) does not look for per-server locks. That is safe for every
// driver that calls requireSandboxLock below (it refuses on the conflicting server) and for every OLD copy of a
// driver on sandbox5..8 (an old copy's PORTS table cannot even name them). The residual gap is an old driver copy on
// sandbox..sandbox4 while someone holds that server per-server: see docs/reports/sandbox58-2026-10-20.md.
const { execFileSync } = require('child_process')
const REGISTRY = require('../sandboxes.json')

const NAMES = Object.keys(REGISTRY.servers)
const PORTS = Object.fromEntries(NAMES.map(n => [n, REGISTRY.servers[n].port]))
const RCON_PORTS = Object.fromEntries(NAMES.map(n => [n, REGISTRY.servers[n].rcon]))
const GLOBAL = 'mcai-sandbox.lock'

function assertName (name) {
  if (!NAMES.includes(name)) throw new Error(`not a sandbox: ${JSON.stringify(name)} (known: ${NAMES.join(', ')})`)
}
const serverLockName = name => { assertName(name); return `${GLOBAL}.${name}` }

/** The shell probe run on the lock host: one line per lock, "HELD\t<path>\t<owner on one line>" or "FREE\t<path>". */
function probeCmd (name, root = '/tmp') {
  assertName(name)
  if (!/^\/[\w/.-]*$/.test(root)) throw new Error(`bad lock root ${JSON.stringify(root)}`)
  return `for d in ${root}/${GLOBAL} ${root}/${GLOBAL}.${name}; do ` +
    `if [ -d "$d" ]; then printf 'HELD\\t%s\\t' "$d"; tr '\\n\\t' '  ' < "$d/owner" 2>/dev/null; echo; ` +
    `else printf 'FREE\\t%s\\n' "$d"; fi; done`
}

/** Parse the probe. Exactly two lines, global first; anything else throws (a probe that printed nothing is not "free"). */
function parseProbe (out, name) {
  assertName(name)
  const lines = String(out).split('\n').filter(l => l.length)
  if (lines.length !== 2) throw new Error(`lock probe: expected 2 lines, got ${lines.length}: ${JSON.stringify(String(out).slice(0, 200))}`)
  const read = (line, suffix) => {
    const [state, p, ...rest] = line.split('\t')
    if (!p || !p.endsWith('/' + GLOBAL + suffix)) throw new Error(`lock probe: unexpected line ${JSON.stringify(line)}`)
    if (state === 'FREE') return null
    if (state === 'HELD') return rest.join('\t').trim()          // '' = the dir exists with no owner file yet
    throw new Error(`lock probe: unexpected state ${JSON.stringify(state)}`)
  }
  return { global: read(lines[0], ''), server: read(lines[1], '.' + name) }
}

/** Does the owner text name `tag`? Only its FIRST WORD counts, and it must EQUAL one of the accepted tags. Codex r1
 *  P1: the drivers used to regex the WHOLE owner text, so owner `plinth021 …` admitted the `/plinth/` driver and a note
 *  mentioning another tag admitted that one. Codex r2: a `tag-<label>` prefix rule would still let two distinct owners
 *  (`airpocket` and `airpocket-02`) both pass one driver, so there is no prefix rule: put run labels AFTER the tag. */
function ownerNames (owner, tag) {
  const first = String(owner).trim().split(/\s+/)[0]
  return [].concat(tag).some(t => first === t)
}

/** The decision. `locks` = { global, server }: null when free, else the owner text ('' when no owner file).
 *  `tag` = the driver's tag (a string), or an array of accepted tags. */
function lockVerdict (locks, tag) {
  const tags = [].concat(tag)
  if (!tags.length || !tags.every(t => typeof t === 'string' && /^[A-Za-z0-9][A-Za-z0-9._]*(-[A-Za-z0-9._]+)*$/.test(t))) {
    throw new Error(`lock tag must be a word (or a list of words): ${String(tag)}`)
  }
  const names = o => ownerNames(o, tags)
  const { global = null, server = null } = locks || {}
  if (global === null && server === null) {
    return { ok: false, reason: 'no sandbox lock is held: take this server (sandbox/sbxlock.sh take <server> <tag>) or the global lock' }
  }
  for (const [kind, owner] of [['global', global], ['per-server', server]]) {
    if (owner !== null && !names(owner)) {
      return { ok: false, reason: `the ${kind} lock is held by someone else: ${owner ? JSON.stringify(owner.slice(0, 160)) : '(no owner file yet)'}` }
    }
  }
  const first = o => String(o).trim().split(/\s+/)[0]
  if (global !== null && server !== null && first(global) !== first(server)) {   // Claude r3 P3: a tag LIST let two owners pass
    return { ok: false, reason: `the global lock (${first(global)}) and the per-server lock (${first(server)}) have different owners` }
  }
  return { ok: true, reason: [global !== null && `global: ${global}`, server !== null && `per-server: ${server}`].filter(Boolean).join('; ') }
}

/** Throws unless the locks covering `name` allow `tag` to run there. `exec` is injectable for tests. */
function requireSandboxLock (name, tag, { exec, root } = {}) {
  // bounded (lavastep-01 driver review r5, Codex P2): a stalled connection must fail the check, not hang the driver
  const run = exec || (cmd => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', REGISTRY.lockHost, cmd], { encoding: 'utf8', timeout: 30000 }))
  const v = lockVerdict(parseProbe(run(probeCmd(name, root)), name), tag)
  if (!v.ok) throw new Error(`sandbox lock check for ${name}: ${v.reason}`)
  return v.reason
}

module.exports = { REGISTRY, NAMES, PORTS, RCON_PORTS, GLOBAL, serverLockName, probeCmd, parseProbe, ownerNames, lockVerdict, requireSandboxLock }
