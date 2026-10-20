// SANDBOX REGISTRY + PER-SERVER LOCKS (sandbox58-1020, 2026-10-20).
//
// sandbox5..8 were added to the worlds host (10.0.0.30:25603-25606, RCON 25703-25706). Before this change every
// driver carried its own copy of the sandbox allowlist -- 25 `PORTS = {...}` literals, four shell guards, four Python
// tuples -- and nothing tied them together, so a fifth sandbox would have been valid in some drivers and refused (or
// worse, half-valid) in others. sandbox/sandboxes.json is now THE list, and this file holds every copy to it.
//
// It also tests the lock change: an agent can take ONE sandbox (/tmp/mcai-sandbox.lock.<name>) instead of all of
// them (/tmp/mcai-sandbox.lock, unchanged). sandbox/lib/sbxlock.cjs decides whether a driver may run; sandbox/sbxlock.sh
// takes and releases. Both are tested by BEHAVIOUR here -- real mkdirs in a temp root, the real scripts.
import assert from 'node:assert'
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync, chmodSync } from 'node:fs'
import { spawnSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sbx = require_(path.join(REPO, 'sandbox/lib/sbxlock.cjs'))
const REG = JSON.parse(readFileSync(path.join(REPO, 'sandbox/sandboxes.json'), 'utf8'))
const NAMES = Object.keys(REG.servers)
const SBXLOCK = path.join(REPO, 'sandbox/sbxlock.sh')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// ------------------------------------------------------------------------------------------------ the registry
t('the registry is sandbox, sandbox2..sandbox8 on contiguous ports, RCON = port + 100', () => {
  assert.deepEqual(NAMES, ['sandbox', 'sandbox2', 'sandbox3', 'sandbox4', 'sandbox5', 'sandbox6', 'sandbox7', 'sandbox8'])
  NAMES.forEach((n, i) => {
    assert.equal(REG.servers[n].port, 25599 + i, n)
    assert.equal(REG.servers[n].rcon, REG.servers[n].port + 100, n)
    assert.equal(REG.servers[n].unit, 'block2-' + n); assert.equal(REG.servers[n].dir, '/srv/block2/' + n)
  })
})
t('no sandbox port collides with the 16 fleet worlds (game 25570-25585, RCON 25670-25685)', () => {
  for (const n of NAMES) for (const p of [REG.servers[n].port, REG.servers[n].rcon]) {
    assert.ok(!(p >= 25570 && p <= 25585) && !(p >= 25670 && p <= 25685), `${n} ${p}`)
  }
})
t('sbxlock.cjs exports the registry ports and refuses an unknown name', () => {
  assert.equal(sbx.PORTS.sandbox8, 25606); assert.equal(sbx.RCON_PORTS.sandbox5, 25703)
  assert.throws(() => sbx.serverLockName('sandbox9'), /not a sandbox/)
  assert.throws(() => sbx.probeCmd('sandbox4; rm -rf /'), /not a sandbox/)
  assert.equal(sbx.serverLockName('sandbox6'), 'mcai-sandbox.lock.sandbox6')
})

// ------------------------------------------------------------------------------------------------ every copy agrees
// STRUCTURAL (the copies are allowlists, which behaviour cannot reach from here without a live server). The rule is
// semantic rather than a fixed file list, so a NEW copy is held to it too: any executable line that names both
// sandbox3 and sandbox4 is an enumeration of the full set and must name sandbox5..8; likewise ports 25601+25602 and
// 25603..25606; and every `name: port` pair anywhere must be the registry's. Restricted subsets that deliberately
// stop before sandbox4 (freeze-probe, drown, rconpipe: "sandbox4 is the benchmark's") do not trip it.
function stripComments (text, ext) {
  return text.split('\n').map(l => {
    if (ext === '.sh' || ext === '.py') return /^\s*#/.test(l) ? '' : l.replace(/(^|\s)#(?![!{]).*$/, '$1')
    return /^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/(^|\s)\/\/.*$/, '$1')
  }).join('\n')
}
// Checked at two grains: the whole line (a shell `case` spreads one enumeration over `x) ...;;` arms) AND each
// bracketed/quoted segment of it (so a message elsewhere on the line that mentions 25606 cannot cover for a port
// guard that dropped it -- the run-bot.sh mutant below was missed by the line grain alone).
function enumerationViolations (text, ext) {
  const out = []
  const check = (l, where) => {
    if (/\bsandbox3\b/.test(l) && /\bsandbox4\b/.test(l)) {
      for (const n of NAMES.slice(4)) if (!new RegExp(`\\b${n}\\b`).test(l)) out.push(`${where}: names sandbox3+4 but not ${n}`)
    }
    if (/\b25601\b/.test(l) && /\b25602\b/.test(l)) {
      for (const n of NAMES.slice(4)) if (!new RegExp(`\\b${REG.servers[n].port}\\b`).test(l)) out.push(`${where}: names 25601+25602 but not ${REG.servers[n].port}`)
    }
  }
  stripComments(text, ext).split('\n').forEach((l, i) => {
    check(l, `line ${i + 1}`)
    l.split(/[()[\]{};"`]/).forEach((seg, j) => check(seg, `line ${i + 1} segment ${j}`))
    for (const m of l.matchAll(/['"]?\b(sandbox\d?)\b['"]?\s*:\s*(\d{5})\b/g)) {
      const want = REG.servers[m[1]]?.port
      if (want !== Number(m[2])) out.push(`line ${i + 1}: ${m[1]}: ${m[2]}, registry says ${want}`)
    }
  })
  return out
}
function walk (dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (['node_modules', '.git', 'results', 'log', 'runs'].includes(e)) continue
    const p = path.join(dir, e), st = statSync(p)
    if (st.isDirectory()) walk(p, acc); else if (/\.(cjs|mjs|js|py|sh)$/.test(e)) acc.push(p)
  }
  return acc
}
const SCANNED = ['sandbox', 'bench', 'scripts', 'bots/scripts'].flatMap(d => walk(path.join(REPO, d)))

t(`every sandbox allowlist in ${SCANNED.length} scripts agrees with sandbox/sandboxes.json`, () => {
  const bad = SCANNED.flatMap(f => enumerationViolations(readFileSync(f, 'utf8'), path.extname(f)).map(v => `${path.relative(REPO, f)} ${v}`))
  assert.deepEqual(bad, [])
})
t('POSITIVE CONTROL: the scan really reads the copies (>= 25 PORTS tables naming sandbox8, the shell guards, the tuples)', () => {
  const withAll = SCANNED.filter(f => /\bsandbox8: 25606\b|'sandbox8': 25606/.test(stripComments(readFileSync(f, 'utf8'), path.extname(f))))
  assert.ok(withAll.length >= 25, `only ${withAll.length} full PORTS tables seen`)
  for (const f of ['sandbox/run-bot.sh', 'sandbox/run-scenario.sh', 'bench/models/closedloop/cl_world.sh', 'bench/models/closedloop/run-bot-cl.sh',
                   'sandbox/craft/sbx-rcon.py', 'scripts/lib/mcrcon.py', 'sandbox/craft/fuel-table.py', 'sandbox/craft/compost-table.py']) {
    assert.ok(SCANNED.includes(path.join(REPO, f)), `${f} not scanned`)
    assert.ok(/\bsandbox8\b|\b25606\b/.test(stripComments(readFileSync(path.join(REPO, f), 'utf8'), path.extname(f))), `${f} does not admit sandbox8`)
  }
})
t('MUTANT KILLED: run-bot.sh with 25606 dropped from its port guard is flagged', () => {
  const src = readFileSync(path.join(REPO, 'sandbox/run-bot.sh'), 'utf8')
  const old = '|25605|25606)$'
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING or not unique')
  assert.deepEqual(enumerationViolations(src, '.sh'), [])
  assert.match(enumerationViolations(src.replace(old, '|25605)$'), '.sh').join(), /not 25606/)
})
t('MUTANT KILLED: run-scenario.sh with the sandbox8 arm dropped from its case is flagged (the line grain)', () => {
  const src = readFileSync(path.join(REPO, 'sandbox/run-scenario.sh'), 'utf8')
  const old = ' sandbox8) PORT=25606;;'
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING or not unique')
  assert.deepEqual(enumerationViolations(src, '.sh'), [])
  assert.match(enumerationViolations(src.replace(old, ''), '.sh').join(), /not sandbox8/)
})
t('MUTANT KILLED: a PORTS table with a wrong port, or one stopping at sandbox4, is flagged', () => {
  const src = readFileSync(path.join(REPO, 'sandbox/well/stock-e2e.cjs'), 'utf8')
  const old = 'sandbox7: 25605, sandbox8: 25606 }'
  assert.ok(src.split(old).length === 2, 'ANCHOR MISSING or not unique')
  assert.match(enumerationViolations(src.replace(old, 'sandbox7: 25605, sandbox8: 25607 }'), '.cjs').join(), /sandbox8: 25607, registry says 25606/)
  assert.match(enumerationViolations(src.replace(', sandbox5: 25603, sandbox6: 25604, sandbox7: 25605, sandbox8: 25606 }', ' }'), '.cjs').join(), /not sandbox5/)
})
t('comments are stripped: an enumeration inside a comment is not a copy (and a `#` inside ${X#y} is not a comment)', () => {
  assert.deepEqual(enumerationViolations('// sandbox3, sandbox4 = 25601, 25602\nconst a = 1', '.cjs'), [])
  assert.deepEqual(enumerationViolations('# case sandbox3|sandbox4)\nX=1', '.sh'), [])
  const v = enumerationViolations('S="${SERVER#sandbox}"; case "$S" in sandbox3|sandbox4) ;; esac', '.sh').join()
  for (const n of ['sandbox5', 'sandbox6', 'sandbox7', 'sandbox8']) assert.match(v, new RegExp(`not ${n}`))
})
t('WIRED: no driver reads the lock by hand any more; every lock-checking driver goes through requireSandboxLock(SERVER, ...)', () => {
  const drivers = SCANNED.filter(f => /\.(cjs|mjs)$/.test(f) && f.startsWith(path.join(REPO, 'sandbox') + path.sep) && !f.includes(`${path.sep}lib${path.sep}`))
  const code = f => stripComments(readFileSync(f, 'utf8'), path.extname(f))
  const byHand = drivers.filter(f => /mcai-sandbox\.lock\//.test(code(f))).map(f => path.relative(REPO, f))
  assert.deepEqual(byHand, [], 'a driver still cats the global owner file itself (it would ignore per-server locks)')
  const wired = drivers.filter(f => /\bsbx\.requireSandboxLock\(SERVER, /.test(code(f)))
  assert.equal(wired.length, 13, `expected the 13 lock-checking drivers, saw ${wired.map(f => path.basename(f))}`)
  for (const f of wired) assert.match(code(f), /require\('\.\.\/lib\/sbxlock\.cjs'\)|from '\.\.\/lib\/sbxlock\.cjs'/, `${path.basename(f)} never imports sbx`)
})
t("sbxlock.sh's own name list is the registry's", () => {
  const m = readFileSync(SBXLOCK, 'utf8').match(/^NAMES="([^"]+)"/m)
  assert.ok(m, 'NAMES line missing'); assert.deepEqual(m[1].split(' '), NAMES)
})

// ------------------------------------------------------------------------------------------------ the decision
t('lockVerdict: every lock covering the server must name us, and at least one must be held', () => {
  const V = (global, server, tag = /plinth/) => sbx.lockVerdict({ global, server }, tag).ok
  assert.equal(V(null, null), false, 'no lock at all')
  assert.equal(V('plinth agent-x since ...', null), true, 'legacy: the global lock names us (unchanged behaviour)')
  assert.equal(V(null, 'plinth agent-x since ...'), true, 'our own per-server lock')
  assert.equal(V('plinth a', 'plinth b'), true, 'both ours')
  assert.equal(V('kitshrink agent-y', null), false, 'someone else has every sandbox')
  assert.equal(V('plinth agent-x', 'kitshrink agent-y'), false, 'we hold all, but someone holds THIS one: refused (the legacy-taker case)')
  assert.equal(V('kitshrink agent-y', 'plinth agent-x'), false, 'we hold this one, but someone else holds all: refused')
  assert.equal(V(null, ''), false, 'a lock dir with no owner file yet (mid-take or crashed) is held by nobody we know')
  assert.equal(V('', null), false)
  assert.equal(sbx.lockVerdict({ global: null, server: 'treefarm x' }, 'treefarm').ok, true, 'string tag = first word')
  assert.equal(sbx.lockVerdict({ global: null, server: 'treefarmer x' }, 'treefarm').ok, false, 'string tag is exact')
})
t('parseProbe refuses a probe that printed nothing or something else (a silent probe is not "free")', () => {
  assert.throws(() => sbx.parseProbe('', 'sandbox6'), /expected 2 lines/)
  assert.throws(() => sbx.parseProbe('FREE\t/tmp/mcai-sandbox.lock\n', 'sandbox6'), /expected 2 lines/)
  assert.throws(() => sbx.parseProbe('FREE\t/tmp/mcai-sandbox.lock\nFREE\t/tmp/mcai-sandbox.lock.sandbox5\n', 'sandbox6'), /unexpected line/)
  assert.throws(() => sbx.parseProbe('MAYBE\t/tmp/mcai-sandbox.lock\nFREE\t/tmp/mcai-sandbox.lock.sandbox6\n', 'sandbox6'), /unexpected state/)
  assert.deepEqual(sbx.parseProbe('FREE\t/tmp/mcai-sandbox.lock\nHELD\t/tmp/mcai-sandbox.lock.sandbox6\tplinth x \n', 'sandbox6'),
    { global: null, server: 'plinth x' })
})

// ------------------------------------------------------------------------------------------------ the real scripts
const ROOT = mkdtempSync(path.join(os.tmpdir(), 'sbxlock-'))
const lockenv = root => ({ ...process.env, SBXLOCK_LOCAL: '1', LOCK_ROOT: root })
const lock = (args, root = ROOT, script = SBXLOCK) => {
  const r = spawnSync('bash', [script, ...args], { env: lockenv(root), encoding: 'utf8' })
  return { rc: r.status, out: (r.stdout + r.stderr).trim() }
}
const probeLocal = cmd => spawnSync('bash', ['-c', cmd], { encoding: 'utf8' }).stdout
const G = path.join(ROOT, 'mcai-sandbox.lock')

try {
  t('take ONE sandbox: TAKEN, owner first word is the tag; a second take of it is HELD', () => {
    const a = lock(['take', 'sandbox6', 'kitshrink', 'agent-ac33', 'drill'])
    assert.equal(a.rc, 0, a.out); assert.match(a.out, /^TAKEN .*mcai-sandbox\.lock\.sandbox6: kitshrink agent-ac33 drill since /)
    const b = lock(['take', 'sandbox6', 'plinth'])
    assert.equal(b.rc, 1); assert.match(b.out, /^HELD .*: kitshrink /)
  })
  t('the driver rule reads that lock: kitshrink may run on sandbox6, not on sandbox5, and plinth not on sandbox6', () => {
    const run = cmd => probeLocal(cmd)
    assert.match(sbx.requireSandboxLock('sandbox6', /kitshrink/, { exec: run, root: ROOT }), /per-server: kitshrink/)
    assert.throws(() => sbx.requireSandboxLock('sandbox5', /kitshrink/, { exec: run, root: ROOT }), /no sandbox lock is held/)
    assert.throws(() => sbx.requireSandboxLock('sandbox6', /plinth/, { exec: run, root: ROOT }), /per-server lock is held by someone else/)
  })
  t('two agents on two sandboxes at once: sandbox3 is takeable while sandbox6 is held', () => {
    const r = lock(['take', 'sandbox3', 'plinth'])
    assert.equal(r.rc, 0, r.out)
    assert.equal(lock(['release', 'sandbox3', 'plinth']).rc, 0)
  })
  t('a GLOBAL take while any per-server lock is held backs out and leaves no global lock behind', () => {
    const r = lock(['take', 'all', 'townground'])
    assert.equal(r.rc, 1); assert.match(r.out, /^REFUSED \(backed out of .*mcai-sandbox\.lock\): held by .*sandbox6: kitshrink/)
    assert.equal(existsSync(G), false)
  })
  t('release refuses another tag, then releases our own', () => {
    const r = lock(['release', 'sandbox6', 'plinth']); assert.equal(r.rc, 1); assert.match(r.out, /REFUSED: .* held by kitshrink/)
    assert.equal(lock(['release', 'sandbox6', 'kitshrink']).rc, 0)
    assert.equal(existsSync(G + '.sandbox6'), false)
    assert.equal(lock(['release', 'sandbox6', 'kitshrink']).rc, 1, 'NOT HELD the second time')
  })
  t('the global lock is the legacy lock: `take all` is mkdir /tmp/mcai-sandbox.lock + owner, and drivers read it as before', () => {
    const r = lock(['take', 'all', 'townground', 'agent-q']); assert.equal(r.rc, 0, r.out)
    assert.match(readFileSync(path.join(G, 'owner'), 'utf8'), /^townground agent-q since /)
    assert.match(sbx.requireSandboxLock('sandbox4', /townground/, { exec: probeLocal, root: ROOT }), /global: townground/)
    assert.match(sbx.requireSandboxLock('sandbox8', /townground/, { exec: probeLocal, root: ROOT }), /global: townground/)
  })
  t('a per-server take while the global lock is held backs out (the global holder has every sandbox)', () => {
    const r = lock(['take', 'sandbox2', 'plinth'])
    assert.equal(r.rc, 1); assert.match(r.out, /^REFUSED .*held by .*mcai-sandbox\.lock: townground/)
    assert.equal(existsSync(G + '.sandbox2'), false)
    assert.equal(lock(['release', 'all', 'townground']).rc, 0)
  })
  t('LEGACY TAKER: a hand mkdir of the global lock beside a per-server lock -- each driver is refused on the shared server', () => {
    assert.equal(lock(['take', 'sandbox6', 'kitshrink']).rc, 0)
    mkdirSync(G); writeFileSync(path.join(G, 'owner'), 'bagbudget agent-z since 2026-10-20\n')     // what old scripts do
    assert.throws(() => sbx.requireSandboxLock('sandbox6', /bagbudget/, { exec: probeLocal, root: ROOT }), /per-server lock is held/)
    assert.throws(() => sbx.requireSandboxLock('sandbox6', /kitshrink/, { exec: probeLocal, root: ROOT }), /global lock is held/)
    assert.match(sbx.requireSandboxLock('sandbox3', /bagbudget/, { exec: probeLocal, root: ROOT }), /global: bagbudget/, 'other servers stay usable')
    rmSync(G, { recursive: true }); assert.equal(lock(['release', 'sandbox6', 'kitshrink']).rc, 0)
  })
  t('refusals: unknown server and a bad tag exit 2 and create nothing', () => {
    const a = lock(['take', 'sandbox9', 'x']); assert.equal(a.rc, 2); assert.match(a.out, /unknown server/)
    const b = lock(['take', 'sandbox5', '../x']); assert.equal(b.rc, 2); assert.match(b.out, /bad tag/)
    assert.deepEqual(readdirSync(ROOT), [])
  })
  t('status lists what is held', () => {
    assert.match(lock(['status']).out, /all sandbox locks free/)
    lock(['take', 'sandbox7', 'smeltjob']); assert.match(lock(['status']).out, /HELD .*sandbox7: smeltjob/)
    lock(['release', 'sandbox7', 'smeltjob'])
  })
  await ta('RACE: 25 rounds of a simultaneous `take all` and `take sandbox3` -- never both TAKEN', async () => {
    const go = (args) => new Promise(res => {
      const p = spawn('bash', [SBXLOCK, ...args], { env: lockenv(ROOT) }); let o = ''
      p.stdout.on('data', d => { o += d }); p.on('close', rc => res({ rc, o }))
    })
    let both = 0, oneOrNone = 0
    for (let i = 0; i < 25; i++) {
      const [a, b] = await Promise.all([go(['take', 'all', 'alpha']), go(['take', 'sandbox3', 'beta'])])
      if (a.rc === 0 && b.rc === 0) both++; else oneOrNone++
      for (const [s, tg] of [['all', 'alpha'], ['sandbox3', 'beta']]) lock(['release', s, tg])
      assert.deepEqual(readdirSync(ROOT), [], 'a lock leaked')
    }
    assert.equal(both, 0, `${both} rounds had both holders`); assert.equal(oneOrNone, 25)
  })
  t('MUTANT KILLED: sbxlock.sh without the global take\'s per-server check lets `take all` through', () => {
    const src = readFileSync(SBXLOCK, 'utf8')
    const old = 'for n in $NAMES; do [[ -d "$G.$n" ]] && conflict+="$G.$n: $(owner_of "$G.$n"); "; done'
    assert.ok(src.split(old).length === 2, 'ANCHOR MISSING or not unique')
    const mut = path.join(ROOT, '..', `sbxlock-mutant-${process.pid}.sh`)
    writeFileSync(mut, src.replace(old, ':')); chmodSync(mut, 0o755)
    try {
      assert.equal(lock(['take', 'sandbox6', 'kitshrink']).rc, 0)
      assert.equal(lock(['take', 'all', 'townground'], ROOT, mut).rc, 0, 'the mutant should have let it through')
      assert.equal(lock(['release', 'all', 'townground']).rc, 0)
      const real = lock(['take', 'all', 'townground'])
      assert.equal(real.rc, 1); assert.match(real.out, /^REFUSED/, 'and the real script refuses the same state for the right reason')
    } finally { rmSync(mut, { force: true }); rmSync(G, { recursive: true, force: true }); lock(['release', 'sandbox6', 'kitshrink']) }
  })

  // ---------------------------------------------------------------------------------------------- the guards
  t('run-bot.sh admits 10.0.0.30:25606 (sandbox8) and refuses 25607 -- by running it to the next guard', () => {
    mkdirSync(path.join(REPO, 'sandbox', 'log'), { recursive: true })   // sandbox/log/ is gitignored
    const dir = mkdtempSync(path.join(REPO, 'sandbox', 'log', 'regtest-')); const rel = path.relative(REPO, dir)
    try {
      const envf = p => { writeFileSync(path.join(dir, '.env.t'), `MINECRAFT_HOST=10.0.0.30\nMINECRAFT_PORT=${p}\nLLM_ENABLED=false\nLOG_DIR=/elsewhere\nSTATE_DIR=/elsewhere\n`); return `${rel}/.env.t` }
      const run = p => spawnSync('bash', [path.join(REPO, 'sandbox/run-bot.sh'), envf(p)], { encoding: 'utf8' })
      for (const p of [25599, 25603, 25606]) assert.match(run(p).stdout, /logs\/state must live under \.\/sandbox/, `port ${p}`)
      for (const p of [25598, 25607, 25570]) assert.match(run(p).stdout, /not a sandbox server/, `port ${p}`)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  t('run-bot-cl.sh admits 25603..25606 and refuses 25607 the same way', () => {
    const f = path.join(ROOT, 'cl.env')
    const run = p => { writeFileSync(f, `MINECRAFT_HOST=10.0.0.30\nMINECRAFT_PORT=${p}\nOLLAMA_BASE_URL=http://nowhere\n`); return spawnSync('bash', [path.join(REPO, 'bench/models/closedloop/run-bot-cl.sh'), f], { encoding: 'utf8' }).stdout }
    for (const p of [25603, 25606]) assert.match(run(p), /model endpoint is not the Studio/, `port ${p}`)
    assert.match(run(25607), /not a sandbox server/); rmSync(f)
  })
  t('cl_world.sh and sbx-rcon.py refuse a non-sandbox name before doing anything', () => {
    const a = spawnSync('bash', [path.join(REPO, 'bench/models/closedloop/cl_world.sh'), 'sandbox9', 'status'], { encoding: 'utf8' })
    assert.equal(a.status, 3); assert.match(a.stdout, /not a sandbox/)
    const b = spawnSync('python3', [path.join(REPO, 'sandbox/craft/sbx-rcon.py'), 'board-a', 'list'], { encoding: 'utf8' })
    assert.notEqual(b.status, 0); assert.match(b.stderr, /sandbox servers only/)
  })
  t('mcrcon.assert_sandbox admits sandbox8 and refuses a fleet world', () => {
    const r = spawnSync('python3', ['-c', 'import sys; sys.path.insert(0, sys.argv[1]); import mcrcon as m; print(m.assert_sandbox("sandbox8"));\ntry: m.assert_sandbox("board-a")\nexcept m.RconError: print("refused")',
      path.join(REPO, 'scripts/lib')], { encoding: 'utf8' })
    assert.equal(r.stdout.trim(), 'sandbox8\nrefused', r.stderr)
  })
  t('cl_run.sandbox_lock takes THIS server\'s lock (on the lock host, not the machine it runs on) and releases it', () => {
    const py = `
import os, subprocess, sys
sys.path.insert(0, sys.argv[1]); import cl_run
root = sys.argv[2]; sh = sys.argv[3]
def run(args):
    r = subprocess.run(['bash', sh] + args, env=dict(os.environ, SBXLOCK_LOCAL='1', LOCK_ROOT=root), capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()
with cl_run.sandbox_lock('model-selection agent: reset', 'sandbox4', run=run):
    print('inside', open(os.path.join(root, 'mcai-sandbox.lock.sandbox4', 'owner')).read().split()[0])
print('after', sorted(os.listdir(root)))
os.mkdir(os.path.join(root, 'mcai-sandbox.lock')); open(os.path.join(root, 'mcai-sandbox.lock', 'owner'), 'w').write('other x\\n')
try:
    with cl_run.sandbox_lock('m', 'sandbox4', wait_s=-1, poll_s=0, run=run): print('WRONGLY TAKEN')
except SystemExit as e: print('waited out:', 'global' in str(e) or 'mcai-sandbox.lock' in str(e))
print('left', sorted(os.listdir(root)))
`
    const r = spawnSync('python3', ['-c', py, path.join(REPO, 'bench/models/closedloop'), ROOT, SBXLOCK], { encoding: 'utf8' })
    assert.equal(r.stdout.trim(), "inside mbench\nafter []\nwaited out: True\nleft ['mcai-sandbox.lock']", r.stderr)
    rmSync(G, { recursive: true, force: true })
  })
} finally { rmSync(ROOT, { recursive: true, force: true }) }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
