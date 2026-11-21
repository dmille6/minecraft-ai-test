// RIGGUARD (2026-11-21). A sandbox world may be stopped, swapped or restored only by the agent that holds its lock.
// 11-21 01:56Z a rig ran `sbxlock.sh take sandbox3 ... | tail`; the take FAILED (another agent held sandbox3), the pipe
// hid the exit code, and the per-piece world recipe stopped the other agent's server and swapped its world.
// Behaviour: sbxlock.sh `assert` and sandbox/rigworld.sh, run for real in a temp lock root (dry run: nothing remote).
// Structure: no tracked sandbox script stops a sandbox unit except rigworld.sh (and the named legacy recipes).
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync, execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SBXLOCK = path.join(REPO, 'sandbox/sbxlock.sh')
const RIGWORLD = path.join(REPO, 'sandbox/rigworld.sh')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

const ROOT = mkdtempSync(path.join(os.tmpdir(), 'rigguard-'))
const env = (extra = {}) => ({ ...process.env, SBXLOCK_LOCAL: '1', LOCK_ROOT: ROOT, RIGWORLD_DRYRUN: '1', ...extra })
const run = (script, args, extra) => spawnSync('bash', [script, ...args], { env: env(extra), encoding: 'utf8' })
const hold = (lock, owner) => { mkdirSync(path.join(ROOT, lock)); writeFileSync(path.join(ROOT, lock, 'owner'), owner + ' note\n') }
const clear = () => { for (const n of ['', '.sandbox2', '.sandbox3']) rmSync(path.join(ROOT, 'mcai-sandbox.lock' + n), { recursive: true, force: true }) }

try {
  t('assert: not held -> exit 1, names the take', () => {
    clear(); const r = run(SBXLOCK, ['assert', 'sandbox3', 'pillars'])
    assert.equal(r.status, 1); assert.match(r.stdout, /NOT HELD .*take it first/)
  })
  t('assert: held by ANOTHER tag -> exit 1, names the holder (the 11-21 case)', () => {
    clear(); hold('mcai-sandbox.lock.sandbox3', 'stepwell4')
    const r = run(SBXLOCK, ['assert', 'sandbox3', 'pillars'])
    assert.equal(r.status, 1); assert.match(r.stdout, /NOT YOURS .*stepwell4/)
  })
  t('assert: own lock -> exit 0; another tag on the global lock -> exit 1; own global -> 0', () => {
    clear(); hold('mcai-sandbox.lock.sandbox3', 'pillars')
    assert.equal(run(SBXLOCK, ['assert', 'sandbox3', 'pillars']).status, 0)
    hold('mcai-sandbox.lock', 'bench')
    assert.equal(run(SBXLOCK, ['assert', 'sandbox3', 'pillars']).status, 1)
    clear(); hold('mcai-sandbox.lock.sandbox3', 'pillars'); hold('mcai-sandbox.lock', 'pillars')
    assert.equal(run(SBXLOCK, ['assert', 'sandbox3', 'pillars']).status, 0)
  })
  t('assert: `all` and an unknown server are refused (exit 2)', () => {
    clear(); assert.equal(run(SBXLOCK, ['assert', 'all', 'x']).status, 2); assert.equal(run(SBXLOCK, ['assert', 'sandbox9', 'x']).status, 2)
  })
  t('rigworld: another agent holds the sandbox -> REFUSED, no remote script at all, for load, snap and restore', () => {
    clear(); hold('mcai-sandbox.lock.sandbox3', 'stepwell4')
    for (const a of [['load', '/srv/x'], ['snap', '/tmp/o'], ['restore']]) {
      const r = run(RIGWORLD, ['sandbox3', 'pillars', ...a])
      assert.equal(r.status, 1, a[0]); assert.match(r.stderr, /REFUSED, nothing touched/, a[0]); assert.doesNotMatch(r.stdout, /WOULD RUN|systemctl/, a[0])
    }
  })
  t('rigworld: piping it into tail cannot hide the refusal from the remote side (it never runs)', () => {
    clear(); hold('mcai-sandbox.lock.sandbox3', 'stepwell4')
    const r = spawnSync('bash', ['-c', `bash ${RIGWORLD} sandbox3 pillars load /srv/x 2>&1 | tail -5`], { env: env(), encoding: 'utf8' })
    assert.doesNotMatch(r.stdout, /WOULD RUN|systemctl stop/); assert.match(r.stdout, /REFUSED/)
  })
  t('rigworld: own lock -> the remote script targets THAT server only, keeps the old world, quotes the source', () => {
    clear(); hold('mcai-sandbox.lock.sandbox2', 'logwalk')
    const r = run(RIGWORLD, ['sandbox2', 'logwalk', 'load', '/srv/copies/world 11-18'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /S=\/srv\/block2\/sandbox2; U=block2-sandbox2/)
    assert.match(r.stdout, /world\.pre-logwalk-/); assert.match(r.stdout, /src=\/srv\/copies\/world\\ 11-18/)
    assert.doesNotMatch(r.stdout, /sandbox3/)
    const rr = run(RIGWORLD, ['sandbox2', 'logwalk', 'restore']); assert.equal(rr.status, 0); assert.match(rr.stdout, /world\.pre-logwalk-\*/)
  })
  t('rigworld: a bad server, tag or action is refused before the lock is even asked', () => {
    clear(); hold('mcai-sandbox.lock.sandbox3', 'pillars')
    assert.equal(run(RIGWORLD, ['sandbox9', 'pillars', 'load', '/x']).status, 2)
    assert.equal(run(RIGWORLD, ['sandbox3', 'a;b', 'load', '/x']).status, 2)
    assert.equal(run(RIGWORLD, ['sandbox3', 'pillars', 'wipe']).status, 2)
  })
  t('MUTANT: rigworld without its assert would have stopped the other agent\'s server (the guard is what refuses)', () => {
    clear(); hold('mcai-sandbox.lock.sandbox3', 'stepwell4')
    const src = readFileSync(RIGWORLD, 'utf8')
    const old = 'if ! out="$(bash "$HERE/sbxlock.sh" assert "$S" "$TAG" 2>&1)"; then'
    assert.equal(src.split(old).length - 1, 1, 'ANCHOR MISSING OR NOT UNIQUE')
    const m = path.join(path.dirname(RIGWORLD), '.rigworld-mutant.sh')
    writeFileSync(m, src.replace(old, 'if ! out="$(true)"; then'))
    try {
      const r = run(m, ['sandbox3', 'pillars', 'load', '/srv/x'])
      assert.equal(r.status, 0); assert.match(r.stdout, /systemctl stop \$U/)
    } finally { rmSync(m, { force: true }) }
  })
  t('STRUCTURE: no tracked sandbox script stops or restarts a sandbox unit except rigworld.sh (and the named legacy recipes)', () => {
    // Legacy per-piece recipes that arrive with their pieces' merges; they ran on the worlds host and checked nothing.
    // Do not add to this list: new rigs call sandbox/rigworld.sh.
    const LEGACY = new Set(['sandbox/civicroof/rigworld.sh', 'sandbox/pillars/plrigworld.sh', 'sandbox/stepwell/swrigworld.sh',
      'sandbox/logwalk/lwrigworld.sh', 'sandbox/floatclean/fcrigworld.sh', 'sandbox/roadsite/rsrigworld.sh', 'sandbox/stepwell4/sw4rigworld.sh'])
    const files = execSync('git ls-files sandbox', { cwd: REPO, encoding: 'utf8' }).split('\n').filter(f => /\.(sh|py|mjs|cjs|js)$/.test(f))
    const bad = []
    for (const f of files) {
      if (f === 'sandbox/rigworld.sh' || LEGACY.has(f) || !existsSync(path.join(REPO, f))) continue
      const code = readFileSync(path.join(REPO, f), 'utf8').split('\n').filter(l => !/^\s*(#|\/\/)/.test(l)).join('\n')
      if (/systemctl\s+(stop|restart|kill)\b[^\n]*(sandbox|\$U\b|\$\{?UNIT)/.test(code)) bad.push(f)
    }
    assert.deepEqual(bad, [], 'these stop a sandbox without the lock guard: call sandbox/rigworld.sh instead')
  })
} finally { rmSync(ROOT, { recursive: true, force: true }) }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
