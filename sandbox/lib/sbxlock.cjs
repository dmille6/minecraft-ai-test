'use strict'
// SANDBOX LOCKS (2026-10-20, sandbox58-1020). The locks live in /tmp on the bots host 10.0.0.31 and are mkdir locks
// with an `owner` file whose FIRST WORD is the holder's tag. There are two kinds, and they coexist:
//
//   /tmp/mcai-sandbox.lock            the GLOBAL lock (unchanged since September): its holder has EVERY sandbox.
//   /tmp/mcai-sandbox.lock.<name>     a PER-SERVER lock (new): its holder has that one sandbox, e.g. .sandbox6.
//
// THE RULE A DRIVER ENFORCES (lockVerdict): a run on server S is allowed only when EVERY lock that covers S -- the
// global one and S's own -- is either absent or names this driver's tag, and at least one of them is held. So a
// global holder whose driver targets a server someone else holds per-server is refused, and so is the per-server
// holder if a different owner holds the global lock. Two owners can never both pass for the same server.
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

/** The decision. `locks` = { global, server }: null when free, else the owner text ('' when no owner file).
 *  `tag` = a RegExp tested against the owner text (the drivers' historical form) or a string equal to its first word. */
function lockVerdict (locks, tag) {
  const names = o => tag instanceof RegExp ? tag.test(o) : o.split(/\s+/)[0] === tag
  const { global = null, server = null } = locks || {}
  if (global === null && server === null) {
    return { ok: false, reason: 'no sandbox lock is held: take this server (sandbox/sbxlock.sh take <server> <tag>) or the global lock' }
  }
  for (const [kind, owner] of [['global', global], ['per-server', server]]) {
    if (owner !== null && !names(owner)) {
      return { ok: false, reason: `the ${kind} lock is held by someone else: ${owner ? JSON.stringify(owner.slice(0, 160)) : '(no owner file yet)'}` }
    }
  }
  return { ok: true, reason: [global !== null && `global: ${global}`, server !== null && `per-server: ${server}`].filter(Boolean).join('; ') }
}

/** Throws unless the locks covering `name` allow `tag` to run there. `exec` is injectable for tests. */
function requireSandboxLock (name, tag, { exec, root } = {}) {
  const run = exec || (cmd => execFileSync('ssh', ['-o', 'BatchMode=yes', REGISTRY.lockHost, cmd], { encoding: 'utf8' }))
  const v = lockVerdict(parseProbe(run(probeCmd(name, root)), name), tag)
  if (!v.ok) throw new Error(`sandbox lock check for ${name}: ${v.reason}`)
  return v.reason
}

module.exports = { REGISTRY, NAMES, PORTS, RCON_PORTS, GLOBAL, serverLockName, probeCmd, parseProbe, lockVerdict, requireSandboxLock }
