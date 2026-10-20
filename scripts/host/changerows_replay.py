#!/usr/bin/env python3
"""changerows_replay.py -- READ-ONLY replay for the 2026-10-20 change_rows underscore fix.

Three modes. Every one writes only under <workdir> (and its own TMPDIR); nothing live is touched.

  preflight <changerowcheck.py> <run> [<run> ...]
      Re-runs changerowcheck's OWN tally() over the exact baseline window and build printed in
      ~/digest/changerowcheck-<run>.log, and prints each declared row looked up AS WRITTEN (the old
      code) and STRIPPED (assess(), the fix). Answers: would the fixed preflight have refused the launch?

  verdict <installed verdict.py> <staged verdict.py> <staged rules> <workdir> <run> <M>[,<M>...]
      Replays a past read through BOTH copies NON-dry (the linkage only runs outside --dryrun), in read
      mode and in --poll mode, on reconstructed inputs:
        manifest  run_id / canary_pool / canary_code_version / declared_at exactly as BOUND in the read's
                  own evidence objects (verdict.py refuses evidence that does not match them);
        logs      every bot's skill rows in [declared_at - 7 h, T), T = the recorded verdict artifact's `at`
                  (the 7 h covers the tier-2 baseline interlock's lookback), copied into <workdir>;
        evidence  the read's own evidence objects, with ONE field changed: `emitted_at` is set to 2 min ago,
                  because verdict.py refuses evidence older than 90 min by WALL CLOCK.
      POSITIVE CONTROL: the installed copy on these inputs must reproduce the RECORDED verdict word, or the
      reconstruction is not faithful and the comparison is refused.
      Then it prints, per read, the change-row death windows each copy found, and whether the verdict word
      (and the extra payload) differs.

  live <installed verdict.py> <staged verdict.py> <staged rules> <workdir>
      The canary declared in the live manifest NOW, both copies, --poll only, on its current logs (copied).

Exit 0 = every replayed read reproduced its recorded word on the installed copy and the staged copy gave
the same word; 1 = a difference (printed); 2 = refused (not faithful, or nothing to replay).
"""
import glob, gzip, json, os, re, shutil, subprocess, sys, tempfile, datetime as dt, importlib.util

H = os.path.expanduser('~')
MCAI = '/var/log/mcai'
READS = os.path.join(H, 'digest', 'reads')
REGS = os.path.join(H, 'mcai-analysis', 'registrations')
TS = re.compile(r'"@timestamp"\s*:\s*"([0-9T:\-\.]+)')


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')


def parse(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ------------------------------------------------------------------------------------------- preflight
def preflight(crc_path, runs):
    crc = load(crc_path, 'crc_staged')
    if not hasattr(crc, 'assess'):
        print('REFUSED: %s has no assess() -- not the fixed changerowcheck' % crc_path); return 2
    for run in runs:
        log = open(os.path.join(H, 'digest', 'changerowcheck-%s.log' % run)).read()
        m = re.search(r'baseline window (\S+)Z \.\. (\S+)Z .*baseline build ([0-9a-f]{7})', log)
        if not m:
            print('%s: no window in the preflight log' % run); continue
        lo, hi, base = m.groups()
        reg = json.load(open(os.path.join(REGS, run + '.json')))
        declared = sorted(set(reg.get('change_rows', [])) | set(reg.get('linkage_extra', [])))
        kinds, other, unknown, bots, rows = crc.scan(lo, hi, base)
        print('%s: window %s .. %s, baseline %s' % (run, lo, hi, base))
        print('  positive control: %d rows, %d from the baseline on %d bots, %d distinct kinds (the recorded log said: %s)'
              % (rows, sum(kinds.values()), len(bots), len(kinds),
                 (re.search(r'positive control: (.*)', log) or [None, '?'])[1][:120]))
        for row, n, u, notes in crc.assess(declared, kinds, other, unknown):
            print('  %-24s as written: %6d baseline rows   stripped (the fix): %6d baseline, %d unversioned, other builds %s -> %s'
                  % (row, kinds.get(row, 0), n, u, notes, 'REFUSED' if (n or u) else 'ok'))
    return 0


# --------------------------------------------------------------------------------------------- verdict
def build_logs(root, lo, hi):
    """Copy every bot's skill rows with lo <= @timestamp < hi into root/<bot>/skill-<bot>.jsonl."""
    los, his = iso(lo), iso(hi)
    days = set()
    d = lo
    while d.date() <= hi.date() + dt.timedelta(days=1):
        days.add(d.strftime('%Y%m%d')); d += dt.timedelta(days=1)
    n = 0; nb = 0
    for bdir in sorted(glob.glob(os.path.join(MCAI, '*-*/'))):
        bot = os.path.basename(bdir.rstrip('/'))
        out_d = os.path.join(root, bot); os.makedirs(out_d, exist_ok=True)
        files = glob.glob(os.path.join(bdir, 'skill-*.jsonl')) + [
            f for f in glob.glob(os.path.join(bdir, 'skill-*.jsonl-*')) if any(x in os.path.basename(f) for x in days)]
        kept = []
        for f in files:
            op = gzip.open if f.endswith('.gz') else open
            with op(f, 'rt', errors='replace') as fh:
                for l in fh:
                    m = TS.search(l[:80])
                    if not m:
                        continue
                    t = m.group(1)[:19]
                    if los <= t < his:
                        kept.append((m.group(1), l if l.endswith('\n') else l + '\n'))
        kept.sort(key=lambda x: x[0])
        with open(os.path.join(out_d, 'skill-%s.jsonl' % bot), 'w') as fo:
            fo.writelines(l for _t, l in kept)
        n += len(kept); nb += 1
    return n, nb


def run_copy(vp, rules, run, M, reads_src, logroot, manp, poll):
    d = tempfile.mkdtemp(prefix='crr-reads-')
    for src in reads_src:
        o = json.load(open(src))
        o['emitted_at'] = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=2)).isoformat()
        json.dump(o, open(os.path.join(d, os.path.basename(src)), 'w'))
    env = dict(os.environ, VERDICT_READS_DIR=d, VERDICT_LOG_ROOT=logroot, VERDICT_MANIFEST=manp,
               VERDICT_REG_DIR=REGS, VERDICT_RULES=rules)
    env.pop('VERDICT_MODULE_DIR', None)
    p = subprocess.run([sys.executable, vp, run, str(0 if poll else M)] + (['--poll'] if poll else []),
                       capture_output=True, text=True, env=env, timeout=1800)
    line = ((p.stdout or '').strip().splitlines() or [''])[-1]
    art = {}
    try:
        art = json.load(open(os.path.join(d, '%s-verdict-%d.json' % (run, 0 if poll else M))))
    except Exception:
        pass
    shutil.rmtree(d, ignore_errors=True)
    return line, art, (p.stderr or '')[-400:]


def word(line):
    return line.split()[1] if line.startswith('VERDICT ') else None


LINK_RE = re.compile(r'change row|control emission rates|rung-linked|REFUSED as non-discriminating|licensed change row')


def compare(inst, staged, rules_staged, run, M, logroot, manp, reads_src, recorded):
    live_rules = os.path.join(H, 'digest', 'RULES-IN-FORCE.md')
    rc = 0
    for poll in (False, True):
        li, ai, ei = run_copy(inst, live_rules, run, M, reads_src, logroot, manp, poll)
        ls, as_, es = run_copy(staged, rules_staged, run, M, reads_src, logroot, manp, poll)
        tag = '%s +%d %s' % (run, M, 'poll' if poll else 'read')
        if not poll:
            if word(li) != recorded:
                print('NOT FAITHFUL %s: installed copy says %s, the recorded verdict was %s -- comparison refused\n   %s\n   %s'
                      % (tag, word(li), recorded, li[:300], ei)); rc = max(rc, 2)
            else:
                print('POSITIVE CONTROL %s: installed copy reproduces the recorded %s' % (tag, recorded))
        if word(li) is None or word(ls) is None:
            print('FAIL %s: no verdict line (installed: %s | staged: %s)' % (tag, ei or li[:200], es or ls[:200]))
            rc = max(rc, 1); continue
        wi = [w for w in ai.get('why', []) if LINK_RE.search(str(w))]
        ws = [w for w in as_.get('why', []) if LINK_RE.search(str(w))]
        same = word(li) == word(ls) and ai.get('extra') == as_.get('extra')
        print('%s %s: installed %s / staged %s' % ('SAME' if same else 'DIFF', tag, word(li), word(ls)))
        print('   linkage lines, installed: %s' % (wi or 'none'))
        print('   linkage lines, staged:    %s' % (ws or 'none'))
        if poll:
            print('   poll counts: installed [%s] / staged [%s]'
                  % ((re.search(r'poll: [^|]*', li) or [''])[0], (re.search(r'poll: [^|]*', ls) or [''])[0]))
        if not same:
            rc = max(rc, 1)
            print('   installed: %s\n   staged:    %s' % (li[:600], ls[:600]))
    return rc


def verdict_mode(inst, staged, rules_staged, work, run, minutes):
    os.makedirs(work, exist_ok=True)
    reg = json.load(open(os.path.join(REGS, run + '.json')))
    rc = 0
    for M in minutes:
        art = json.load(open(os.path.join(READS, '%s-verdict-%d.json' % (run, M))))
        T = parse(art['at'])
        srcs = [os.path.join(READS, '%s-%s-%d.json' % (run, r, M)) for r in reg['reads']]
        missing = [s for s in srcs if not os.path.exists(s)]
        if missing:
            print('REFUSED %s +%d: evidence missing %s' % (run, M, missing)); rc = 2; continue
        im = json.load(open(srcs[reg['reads'].index('immobiledid')]))
        man = {'run_id': im['run_id'], 'canary_pool': im['pools'], 'canary_code_version': im['sha'],
               'declared_at': im['declared_at']}
        m = re.search(r'baseline build ([0-9a-f]{7})', open(os.path.join(H, 'digest', 'changerowcheck-%s.log' % run)).read())
        man['declared_code_version'] = m.group(1) if m else ''
        root = os.path.join(work, '%s-%d' % (run, M)); os.makedirs(root, exist_ok=True)
        manp = os.path.join(root, 'manifest.json'); json.dump(man, open(manp, 'w'))
        logroot = os.path.join(root, 'logs')
        if os.path.isdir(logroot):
            shutil.rmtree(logroot)
        lo = parse(im['declared_at']) - dt.timedelta(hours=7)
        n, nb = build_logs(logroot, lo, T)
        print('%s +%d: T=%s, declared_at %s, pools %s; %d rows copied for %d bots (positive control)'
              % (run, M, iso(T), im['declared_at'], im['pools'], n, nb))
        if n == 0 or nb < 40:
            print('REFUSED %s +%d: the log copy found too little (%d rows, %d bots)' % (run, M, n, nb)); rc = 2; continue
        rc = max(rc, compare(inst, staged, rules_staged, run, M, logroot, manp, srcs, art['verdict']))
        shutil.rmtree(logroot, ignore_errors=True)
    return rc


def live_mode(inst, staged, rules_staged, work):
    man = json.load(open('/srv/mcbots/trial-manifest.json'))
    run = man.get('run_id')
    if not man.get('canary_pool'):
        print('no canary declared now'); return 0
    root = os.path.join(work, 'live-%s' % run); os.makedirs(root, exist_ok=True)
    manp = os.path.join(root, 'manifest.json'); json.dump(man, open(manp, 'w'))
    logroot = os.path.join(root, 'logs')
    if os.path.isdir(logroot):
        shutil.rmtree(logroot)
    now = dt.datetime.now(dt.timezone.utc)
    n, nb = build_logs(logroot, parse(man['declared_at']) - dt.timedelta(hours=7), now)
    print('%s LIVE: declared_at %s, pools %s; %d rows copied for %d bots' % (run, man['declared_at'], man['canary_pool'], n, nb))
    live_rules = os.path.join(H, 'digest', 'RULES-IN-FORCE.md')
    li, ai, ei = run_copy(inst, live_rules, run, 0, [], logroot, manp, True)
    ls, as_, es = run_copy(staged, rules_staged, run, 0, [], logroot, manp, True)
    print('installed: %s' % (li[:500] or ei))
    print('staged:    %s' % (ls[:500] or es))
    shutil.rmtree(logroot, ignore_errors=True)
    return 0 if word(li) == word(ls) else 1


if __name__ == '__main__':
    a = sys.argv[1:]
    if a and a[0] == 'preflight' and len(a) >= 3:
        sys.exit(preflight(a[1], a[2:]))
    if a and a[0] == 'verdict' and len(a) == 7:
        sys.exit(verdict_mode(a[1], a[2], a[3], a[4], a[5], [int(x) for x in a[6].split(',')]))
    if a and a[0] == 'live' and len(a) == 5:
        sys.exit(live_mode(a[1], a[2], a[3], a[4]))
    print(__doc__); sys.exit(2)
