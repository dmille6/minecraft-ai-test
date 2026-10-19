#!/usr/bin/env python3
"""brain-01 Studio-reboot mutants for test/brain01-reboot.test.mjs (real sockets). Run on a COPY of the tree:
python3 brain01-reboot-mutants.py <copy-root> (the copy needs bots/node_modules). Same contract as brain01-mutants.py:
each anchor present exactly once, KILLED only by an ASSERTION: a FAIL line whose detail line names AssertionError
(the harness prints FAIL for ANY throw, including its own 60 s ceiling, so a FAIL line alone is not enough; Codex r1), source restored in `finally`, a baseline
run must pass first, any SURVIVED or NOT-AN-ASSERTION exits 1."""
import subprocess, sys
base = sys.argv[1]
def run():
    try:
        r = subprocess.run(['node', 'test/brain01-reboot.test.mjs'], cwd=base + '/bots', capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b'').decode() if isinstance(e.stdout, bytes) else (e.stdout or '')
        return 124, [], [], 'TIMEOUT after 180 s; last test line: ' + (out.strip().splitlines() or [''])[-1]
    L = [l.strip() for l in r.stdout.splitlines()]
    fails = [L[i] for i in range(len(L)) if L[i].startswith('FAIL')]
    asserted = [L[i] for i in range(len(L) - 1) if L[i].startswith('FAIL') and 'AssertionError' in L[i + 1]]
    return r.returncode, fails, asserted, r.stderr
rc, fails, asserted, err = run()
assert rc == 0 and not fails, 'BASELINE NOT GREEN: %s %s' % (fails[:2], err[-300:])
M = [
 # a hung tunnel would cost the global 45 s budget instead of the Studio's own
 ('global timeout for every endpoint', 'src/llm.mjs', 'setTimeout(() => ctl.abort(), ep.timeoutMs ?? this.timeoutMs)', 'setTimeout(() => ctl.abort(), this.timeoutMs)'),
 # the Studio never comes back after a reboot: a served answer does not clear the backoff
 ('markOk keeps the backoff', 'src/llm.mjs', '    ep.fails = 0\n    ep.downUntil = 0\n', '    ep.downUntil = 0\n'),
 # a cooling Studio is asked anyway (every decision pays the outage)
 ('cooling endpoint never skipped', 'src/llm.mjs', 'const up = this.eps.filter(e => e.downUntil <= now)', 'const up = this.eps'),
 # the canary's primary is not first
 ('primary appended, not prepended', 'src/brain.mjs', "return [p, ...own.filter(e => e.split('|')[0] !== p.split('|')[0])]", "return [...own.filter(e => e.split('|')[0] !== p.split('|')[0]), p]"),
 # the labelled endpoint is never asked (Claude r1: three per-state tests passed this before they checked the Studio's count)
 ('labelled endpoint skipped', 'src/llm.mjs', 'for (const ep of eps) {', 'for (const ep of eps.filter(e => !e.brain)) {'),
 # the backoff is uncapped (a long outage would strand the bot on local for hours)
 ('backoff uncapped', 'src/llm.mjs', 'const wait = Math.min(this.cooldownMs * 2 ** (ep.fails - 1), this.maxCooldownMs)', 'const wait = this.cooldownMs * 2 ** (ep.fails - 1)'),
]
bad = 0
for name, f, old, new in M:
    print('...', name, flush=True)
    p = base + '/bots/' + f; src = open(p).read()
    assert src.count(old) == 1, 'ANCHOR %s (%d)' % (name, src.count(old))
    try:
        open(p, 'w').write(src.replace(old, new))
        rc, fails, asserted, err = run()
    finally:
        open(p, 'w').write(src)
    verdict = 'KILLED' if (rc and asserted) else ('NOT-AN-ASSERTION' if rc else 'SURVIVED')
    bad += verdict != 'KILLED'
    print(verdict, '|', name, '|', (asserted or fails)[0][:110] if fails else err.strip().splitlines()[-1][:110] if err.strip() else '')
print('%d of %d killed by an assertion' % (len(M) - bad, len(M)))
sys.exit(1 if bad else 0)
