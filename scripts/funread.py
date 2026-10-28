#!/usr/bin/env python3
"""funread.py <run_id> <minute> -- the FUN-MODE generic canary read (OWNER 2026-10-28, fun mode W4).

    canary-loop.sh runs this at +90 and +180 for every registration that is not `"lab": true`.
    No per-change read script is required. It asks four questions, the same for every change:

      1. DEATHS     the established death gate, asked through `verdict.py <run> 0 --poll` (the owner's
                    two-death floor, the 1.25x + lower-bound test, the licensed change-row link). REVERT
                    there is harm.
      2. CRASH LOOP each canary bot's systemd unit: >= CRASH_RESTARTS automatic restarts since the deploy,
                    or a unit that is failed / stopped (the tripper stops bots; so does a crash). Harm.
      3. OWN LINES  a registration's own `on_fail: REVERT` lines, IF its read wrote a bound evidence object
                    for this minute. A failing line is harm. An absent object decides nothing (said so).
      4. TRIPWIRES  freeze-watch's latest fleet tripwires (minus fleet_split, which a canary causes by
                    construction). Fleet-wide, so reported, never deciding.

    Positive control: EVERY canary bot must be writing rows on the canary build (newest row within FRESH_MIN).
    A bot the read cannot see could be dying unseen -- "missing telemetry is never no harm".

    DECISION (pure, `decide`): any harm -> REVERT (the whole bundle: the canary sha is torn down as one).
    Before the final read -> NOT_YET. At the final read: harm that could not be ruled out (death poll
    unreadable, units unreadable, a canary bot not seen on the canary build, not bound to the canary) ->
    INCONCLUSIVE, which the loop tears down. Otherwise KEEP, labelled `goal-verified` when the
    registration's `exposure` is met by bound evidence and `goal-unverified` when it is not -- "no
    detected harm" justifies keeping a change; it does not prove the change worked.

    Prints ONE line `VERDICT <word> (+M) :: ...` (canary-loop.sh takes `tail -1`, then field 2) and writes
    ~/digest/reads/<run>-verdict-<M>.json (extra.by names the harm; `deaths` only for a death-gate REVERT,
    so canary-sched's R11 hold sees exactly the death-driven ones; `linked` for R11's 2-h expiry).

    Test overrides (production sets none): FUNREAD_REG_DIR FUNREAD_MANIFEST FUNREAD_READS_DIR
    FUNREAD_VERDICT FUNREAD_ENV_DIR FUNREAD_UNITS_FILE FUNREAD_LOG_ROOT FUNREAD_FREEZE FUNREAD_NOW.
"""
import datetime as dt
import glob
import json
import math
import os
import re
import subprocess
import sys

CRASH_RESTARTS = 3          # automatic restarts of ONE canary unit since the deploy
FRESH_MIN = 30              # EVERY canary bot's newest row must be this recent, on the canary build, for a KEEP
FUN_READS = (90, 180)       # FIXED for every fun-mode run (canary-loop.sh FUN_READS must match): the last one is final
FREEZE_MAX_AGE_MIN = 60


def env(k, d):
    return os.environ.get(k) or d


def now():
    v = os.environ.get('FUNREAD_NOW')
    return dt.datetime.fromisoformat(v.replace('Z', '+00:00')) if v else dt.datetime.now(dt.timezone.utc)


def is_lab(reg):
    """A registration is LAB MODE only when it says so explicitly (`"lab": true`). Everything else is fun mode."""
    return isinstance(reg, dict) and reg.get('lab') is True


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float('inf'), float('-inf'))


def compare(val, op, want):
    return {'<=': val <= want, '>=': val >= want, '==': val == want, '<': val < want, '>': val > want}.get(op)


# ------------------------------------------------------------------------------------------------- the decision --
def decide(f, M, final_M):
    """PURE. f: the facts `gather` collects. -> (word, why list, extra dict)."""
    why, harm, unknown = ['fun-mode generic read (owner 2026-10-28)'], [], []
    extra = {'fun': True, 'linked': int(f.get('linked') or 0)}
    # 1. deaths
    dw = f.get('death_word')
    why.append('death gate (verdict.py --poll): %s -- %s' % (dw or 'NO ANSWER', f.get('death_line') or ''))
    if dw == 'REVERT':
        harm.append(('death_gate', 'death gate REVERT'))
        extra['deaths'] = int(f.get('deaths') or 0)
    elif dw != 'POLL_OK':
        unknown.append('the death gate gave no POLL_OK (%s)' % (dw or 'no answer'))
    # 2. crash loops / stopped units
    units = f.get('units')
    if units is None:
        unknown.append('canary units unreadable')
    else:
        crash = sorted(b for b, u in units.items() if (u.get('restarts') or 0) >= CRASH_RESTARTS)
        down = sorted(b for b, u in units.items() if u.get('active') not in ('active', 'activating', 'reloading'))
        why.append('units: %d canary bots, restarts %s, not active %s' % (
            len(units), {b: u.get('restarts') for b, u in sorted(units.items()) if u.get('restarts')} or 0, down or 'none'))
        if crash:
            harm.append(('crash_loop', 'crash loop: %s restarted >= %d times since the deploy' % (', '.join(crash), CRASH_RESTARTS)))
        if down:
            harm.append(('crash_loop', 'canary unit(s) not running (crash, tripper or a stop): %s' % ', '.join(down)))
        if not units:
            unknown.append('no canary bots found for the pools')
    # positive control
    n = len(units or {})
    fresh = f.get('fresh_on_canary')
    need = max(1, n)       # review r1 (Codex): a bot the read cannot see could be dying unseen -- every bot, not half
    why.append('positive control: %s of %d canary bots wrote a row on the canary build in the last %d min' % (fresh, n, FRESH_MIN))
    if fresh is None or fresh < need:
        unknown.append('positive control failed (%s of %d fresh on the canary build; need %d)' % (fresh, n, need))
    if not f.get('bound', False):
        unknown.append('not bound: %s' % (f.get('bound_why') or 'the manifest does not name this run and sha'))
    # 3. own lines
    for ln in f.get('own_lines') or []:
        if ln.get('state') == 'fail':
            harm.append(('own_line', 'own line %s.%s = %s fails %s %s' % (ln['read'], ln['field'], ln['value'], ln['op'], ln['want'])))
        elif ln.get('state') == 'absent':
            why.append('own line %s.%s not evaluated: %s' % (ln['read'], ln['field'], ln.get('why') or 'no evidence'))
        else:
            why.append('own line %s.%s = %s passes' % (ln['read'], ln['field'], ln.get('value')))
    # 4. tripwires (report only)
    tw = f.get('tripwires')
    if tw:
        why.append('fleet tripwires (freeze-watch, fleet-wide, not deciding): %s' % ', '.join(tw))
    if harm:
        extra['by'] = harm[0][0]
        if extra['by'] != 'death_gate':
            extra.pop('deaths', None)
        why.extend(h for _, h in harm)
        why.append('REVERT the whole bundle (the canary sha is torn down as one)')
        return 'REVERT', why, extra
    if M < final_M:
        if unknown:
            why.append('not yet decidable: ' + '; '.join(unknown))
        why.append('no harm seen at +%d; final read at +%d' % (M, final_M))
        return 'NOT_YET', why, extra
    if unknown:
        why.append('harm cannot be ruled out: ' + '; '.join(unknown))
        return 'INCONCLUSIVE', why, extra
    label = 'goal-verified' if f.get('exposed') else 'goal-unverified'
    extra['label'] = label
    why.insert(1, 'KEEP %s: no harm detected%s' % (label, '' if f.get('exposed') else
                                                  ' (the change was not shown to act: keep the goal open)'))
    if f.get('exposure_why'):
        why.append('exposure: %s' % f['exposure_why'])
    return 'KEEP', why, extra


# ------------------------------------------------------------------------------------------------------ gather --
def roster(pools, env_dir):
    """The pools' bots from the harness env files (the roster), as canary-loop.sh's teardown reads them."""
    bots = []
    for p in pools:
        for e in sorted(glob.glob(os.path.join(env_dir, '%s-*.env' % p))):
            b = os.path.basename(e)[:-4]
            if b[len(p) + 1:] and '-' not in b[len(p) + 1:]:
                bots.append(b)
    return bots


def unit_facts(bots):
    fx = os.environ.get('FUNREAD_UNITS_FILE')
    if fx:
        with open(fx) as f:
            d = json.load(f)
        return None if d is None else {b: d[b] for b in bots if b in d}
    out = {}
    for b in bots:
        r = subprocess.run(['systemctl', 'show', '-p', 'NRestarts', '-p', 'ActiveState', 'mcbot@%s.service' % b],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return None
        kv = dict(l.split('=', 1) for l in r.stdout.splitlines() if '=' in l)
        try:
            out[b] = {'restarts': int(kv.get('NRestarts') or 0), 'active': kv.get('ActiveState') or 'unknown'}
        except ValueError:
            return None
    return out


def newest_row(bot, log_root):
    fs = sorted(glob.glob(os.path.join(log_root, bot, 'skill-*.jsonl')), key=os.path.getmtime)
    if not fs:
        return None
    with open(fs[-1], 'rb') as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - 65536))
        lines = f.read().decode('utf-8', 'replace').splitlines()
    for l in reversed(lines):
        try:
            return json.loads(l)
        except Exception:
            continue
    return None


def row_ts(r):
    v = r.get('@timestamp') or r.get('ts') or ''
    try:
        return dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
    except ValueError:
        return None


def death_poll(run, verdict):
    """(word, line, canary deaths, linked deaths) from the established death gate."""
    try:
        r = subprocess.run([sys.executable, verdict, run, '0', '--poll'], capture_output=True, text=True, timeout=900)
    except Exception as x:
        return None, 'could not run: %s' % x, 0, 0
    line = (r.stdout.strip().splitlines() or [''])[-1]
    m = re.match(r'^VERDICT (\S+) ', line)
    word = m.group(1) if m else None
    d = re.search(r'(\d+) canary deaths since declared_at, (\d+) rung-linked, (\d+) with a change row', line)
    hd = re.search(r'deaths (\d+) \(', line)
    nd = int(d.group(1)) if d else (int(hd.group(1)) if hd else 0)
    linked = (int(d.group(2)) + int(d.group(3))) if d else 0
    if re.search(r'rung-linked death|linked death|death-linked|change row inside a death window', line):
        linked = max(linked, 1)
    if not line:
        line = 'no output: ' + ((r.stderr.strip().splitlines() or ['(empty)'])[-1][:300])
    return word, line[:600], nd, linked


def evidence(R, run, read, M, man):
    """A registered read's evidence object for +M, bound to the active canary -> (fields | None, why)."""
    p = os.path.join(R, '%s-%s-%d.json' % (run, read, M))
    if not os.path.exists(p):
        return None, 'no evidence object for +%d' % M
    try:
        with open(p) as f:
            o = json.load(f)
    except Exception as x:
        return None, 'evidence unreadable: %s' % x
    sha = str(o.get('sha') or '')
    if o.get('run_id') != run or o.get('window_min') != M or o.get('pools') != man.get('canary_pool') or \
            len(sha) < 7 or not str(man.get('canary_code_version') or '').startswith(sha[:7]) or \
            o.get('declared_at') != man.get('declared_at'):
        return None, 'evidence not bound to the active canary'
    return o.get('fields') or {}, ''


def gather(run, M):
    H = os.path.expanduser('~')
    regdir = env('FUNREAD_REG_DIR', os.path.join(H, 'mcai-analysis', 'registrations'))
    R = env('FUNREAD_READS_DIR', os.path.join(H, 'digest', 'reads'))
    with open(os.path.join(regdir, '%s.json' % run)) as f:
        reg = json.load(f)
    with open(env('FUNREAD_MANIFEST', '/srv/mcbots/trial-manifest.json')) as f:
        man = json.load(f)
    fx = {}
    pools = [p.strip() for p in str(man.get('canary_pool') or '').split(',') if p.strip()]
    sha = str(reg.get('sha') or '')
    csha = str(man.get('canary_code_version') or '')
    fx['bound'] = bool(pools) and man.get('run_id') == run and len(sha) >= 7 and csha.startswith(sha[:7])
    if not fx['bound']:
        fx['bound_why'] = 'manifest run %r canary %s on %r; registration sha %s' % (man.get('run_id'), csha[:8], pools, sha[:8])
    fx['death_word'], fx['death_line'], fx['deaths'], fx['linked'] = death_poll(
        run, env('FUNREAD_VERDICT', os.path.join(H, 'verdict.py')))
    bots = roster(pools, env('FUNREAD_ENV_DIR', '/srv/mcbots/harness/env'))
    try:
        fx['units'] = unit_facts(bots)
    except Exception:
        fx['units'] = None
    t, fresh = now(), 0
    log_root = env('FUNREAD_LOG_ROOT', '/var/log/mcai')
    for b in bots:
        r = newest_row(b, log_root)
        w = row_ts(r) if r else None
        v = str(((r or {}).get('code') or {}).get('version') or '')
        if w and (t - w).total_seconds() <= FRESH_MIN * 60 and len(csha) >= 7 and v[:7] == csha[:7]:
            fresh += 1
    fx['fresh_on_canary'] = fresh
    ol = []
    for ln in reg.get('own_lines') or []:
        if not isinstance(ln, dict) or ln.get('on_fail') != 'REVERT':
            continue
        e = {'read': ln.get('read'), 'field': ln.get('field'), 'op': ln.get('op'), 'want': ln.get('value')}
        fields, why = evidence(R, run, str(ln.get('read')), M, man)
        if fields is None:
            e.update(state='absent', why=why)
        else:
            val = fields.get(ln.get('field'))
            ok = compare(val, ln.get('op'), ln.get('value')) if _num(val) and _num(ln.get('value')) else None
            e.update(value=val, state='absent' if ok is None else ('pass' if ok else 'fail'),
                     why='' if ok is not None else 'value %r is not comparable with %s %r' % (val, ln.get('op'), ln.get('value')))
        ol.append(e)
    fx['own_lines'] = ol
    ex = reg.get('exposure') if isinstance(reg.get('exposure'), dict) else None
    fx['exposed'] = False
    if ex and ex.get('read') and ex.get('field'):
        fields, why = evidence(R, run, str(ex['read']), M, man)
        val = (fields or {}).get(ex['field'])
        fx['exposed'] = bool(fields is not None and _num(val) and _num(ex.get('min')) and val >= ex['min'])
        fx['exposure_why'] = '%s.%s = %s (min %s)%s' % (ex['read'], ex['field'], val, ex.get('min'), ' -- ' + why if why else '')
    try:
        with open(env('FUNREAD_FREEZE', '/var/lib/mcai/_freeze-watch.jsonl'), 'rb') as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 8192))
            last = json.loads(f.read().decode('utf-8', 'replace').strip().splitlines()[-1])
        lt = dt.datetime.fromisoformat(str(last.get('t')).replace('Z', '+00:00'))
        fx['tripwires'] = [x for x in last.get('tripwires') or [] if x != 'fleet_split'] \
            if (t - lt).total_seconds() <= FREEZE_MAX_AGE_MIN * 60 else None
    except Exception:
        fx['tripwires'] = None
    return reg, fx


def main(argv):
    if len(argv) != 2 or not re.fullmatch(r'[a-z0-9][a-z0-9._-]*', argv[0]) or not argv[1].isdigit():
        print('usage: funread.py <run_id> <minute>', file=sys.stderr)
        return 2
    run, M = argv[0], int(argv[1])
    R = env('FUNREAD_READS_DIR', os.path.join(os.path.expanduser('~'), 'digest', 'reads'))
    try:
        reg, fx = gather(run, M)
        word, why, extra = decide(fx, M, FUN_READS[-1])
    except Exception as x:
        word, why, extra = 'UNREADABLE', ['funread could not gather: %s: %s' % (type(x).__name__, x)], {'fun': True}
    o = {'run_id': run, 'window_min': M, 'verdict': word, 'why': why, 'extra': extra, 'guards': True,
         'at': now().isoformat(), 'gate': 'funread'}
    try:
        os.makedirs(R, exist_ok=True)
        with open(os.path.join(R, '%s-verdict-%d.json' % (run, M)), 'w') as f:
            json.dump(o, f, indent=1, default=str)
    except Exception as x:
        why.append('artifact not written: %s' % x)
    print('VERDICT %s (+%d) :: %s' % (word, M, ' | '.join(str(w).replace('\n', ' ').replace('\r', ' ') for w in why)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
