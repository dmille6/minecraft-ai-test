#!/usr/bin/env python3
"""isolated2sharedhold.py -- the isolated2shared rollout's scheduler hold (design 5.2). Used by isolated2shared-direct.sh.

  quiet                      the QUIET period required NOW -> minutes on stdout, rc 0; rc 2 with the reason when it cannot
                             be computed (any READY queue entry whose registration cannot be read, or none at all)
  claim <owner> <quiet>      claim the install-hold (holdtoken.py claim: the scheduler's slot checks under its tick lock) for
                             quiet + 60 min and record it in HOLD.json; or, when HOLD.json names the hold that EXISTS NOW,
                             reuse it and EXTEND its `until` to now + quiet + 60 (never shorter), under the same tick lock
  release <owner> <quiet>    release only when quiet' = max(recorded, <quiet>) minutes have passed since the last transition
                             row in the journal; rc 2 (refused) before that
  drop                       release a hold this rollout claimed and never used (no transition since it was claimed)

QUIET = max read minute over every READY (or running) queue entry's registrations, + 60; 1440 + 60 when any such entry has
class underground-safety or bag-fix (their 24 h PRE / null bands). HOLD.json is written by tmp + os.replace. Every decision
is a pure function below, self-tested at import."""
import datetime as dt, fcntl, importlib.util, json, os, subprocess, sys

H = os.environ.get('SCHED_HOME', '/home/mike')
D = os.environ.get('I2S_DIR', os.path.join(H, 'isolated2shared'))
HOLDF = os.path.join(D, 'HOLD.json')
JOURNAL = os.path.join(H, 'canary-journal.jsonl')
RUN = 'isolated2shared-01'
HT = os.environ.get('HOLDTOKEN', os.path.join(H, 'gate-v36', 'holdtoken.py'))
LONG_CLASSES = ('underground-safety', 'bag-fix')
TRANSITIONS = ('owner-direct', 'apply-done', 'rollback-done', 'apply-incomplete', 'rollback-incomplete', 'apply-refused', 'rollback-refused')
OUTCOMES = ('apply-done', 'rollback-done', 'apply-refused', 'rollback-refused')    # a transition that ended in a known state
FLOOR = 240


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def parse(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


def quiet_from(ready, entries, read_reg):
    """PURE. ready: run names the scheduler shows ready|running; entries: the queue's entries; read_reg(path) -> registration
    dict (raises when unreadable). -> (minutes, None) | (None, why). Incomplete coverage refuses (Codex r3 P2-6)."""
    w, why = [], []
    for e in entries:
        if e.get('run') not in ready:
            continue
        if e.get('class') in LONG_CLASSES:
            w.append(1440)
        vs = (e.get('variants') or {}).values()
        if not vs:
            why.append('%s has no variants' % e.get('run'))
        for v in vs:
            try:
                rm = read_reg(v['registration']).get('read_minutes') or []
                w.append(max(int(m) for m in rm))
            except Exception as ex:
                why.append('%s: registration %s unreadable (%s)' % (e.get('run'), v.get('registration'), type(ex).__name__))
    if why:
        return None, '; '.join(why)
    if not w:
        return None, 'no ready queue entry'
    return max(max(w) + 60, FLOOR), None


def last_transition(lines, run=RUN):
    """PURE. The newest ts of a transition row of `run` in journal lines, or None."""
    last = None
    for l in lines:
        try:
            r = json.loads(l)
        except Exception:
            continue
        if r.get('run') == run and r.get('phase') in TRANSITIONS and r.get('ts'):
            last = max(last or '', r['ts'])
    return last


def unreconciled(lines, run=RUN):
    """PURE. -> the reason release must wait, or None. The newest `owner-direct` (written BEFORE the units stop) must be
    followed by an OUTCOME row; a newest `*-incomplete` (units left stopped, the pool possibly mixed) is never reconciled by
    time -- only by a re-run or a rollback that ends in an outcome (Codex r4 P2-2)."""
    rows = []
    for l in lines:
        try:
            r = json.loads(l)
        except Exception:
            continue
        if r.get('run') == run and r.get('phase') in TRANSITIONS and r.get('ts'):
            rows.append((r['ts'], r['phase']))
    if not rows:
        return None
    ts, ph = max(rows)
    if ph == 'owner-direct':
        return 'a transition started %s has no outcome row (interrupted?): reconcile it first' % ts
    if ph.endswith('-incomplete'):
        return 'the last transition (%s %s) is incomplete: re-run or roll back first' % (ph, ts)
    return None


def release_ok(now, last, quiet):
    """PURE. -> (ok, not_before). No transition at all: not ok (drop is the path for an unused hold)."""
    if not last:
        return False, None
    nb = parse(last) + dt.timedelta(minutes=quiet)
    return now >= nb, nb


def extended_until(cur_until, now, quiet):
    """PURE. The hold's new `until`: never shorter than it is."""
    want = now + dt.timedelta(minutes=quiet + 60)
    try:
        cur = parse(cur_until)
    except Exception:
        cur = None
    return max(want, cur) if cur else want


_N = dt.datetime(2026, 10, 20, 12, 0, tzinfo=dt.timezone.utc)
_E = [{'run': 'a', 'variants': {'x': {'registration': 'ra'}}}, {'run': 'b', 'class': 'bag-fix', 'variants': {'y': {'registration': 'rb'}}},
      {'run': 'c', 'variants': {'z': {'registration': 'bad'}}}]
_R = lambda p: {'ra': {'read_minutes': [180, 360]}, 'rb': {'read_minutes': [180]}}[p]
assert quiet_from({'a'}, _E, _R) == (420, None)
assert quiet_from({'a', 'b'}, _E, _R) == (1500, None), 'a bag-fix entry needs 24 h'
assert quiet_from({'a', 'c'}, _E, _R)[0] is None, 'an unreadable registration refuses (no silent smaller bound)'
assert quiet_from(set(), _E, _R)[0] is None
assert quiet_from({'a'}, [{'run': 'a', 'variants': {'x': {'registration': 'r'}}}], lambda p: {'read_minutes': [60]}) == (FLOOR, None)
_J = ['{"ts":"2026-10-20T10:00:00Z","run":"isolated2shared-01","phase":"apply-done"}', 'junk',
      '{"ts":"2026-10-20T11:00:00Z","run":"isolated2shared-01","phase":"hold-released"}', '{"ts":"2026-10-20T11:30:00Z","run":"other","phase":"apply-done"}']
assert last_transition(_J) == '2026-10-20T10:00:00Z'
assert release_ok(_N, '2026-10-20T10:00:00Z', 120) == (True, parse('2026-10-20T12:00:00Z'))
assert release_ok(_N, '2026-10-20T10:00:00Z', 121)[0] is False and release_ok(_N, None, 1)[0] is False
_J2 = _J + ['{"ts":"2026-10-20T11:40:00Z","run":"isolated2shared-01","phase":"owner-direct"}']
assert last_transition(_J2) == '2026-10-20T11:40:00Z', 'an owner-direct row is a transition: the quiet period counts from it'
assert unreconciled(_J2) and unreconciled(_J) is None
assert unreconciled(_J + ['{"ts":"2026-10-20T11:50:00Z","run":"isolated2shared-01","phase":"apply-incomplete"}'])
assert unreconciled(_J2 + ['{"ts":"2026-10-20T11:41:00Z","run":"isolated2shared-01","phase":"apply-done"}']) is None
assert extended_until('2026-10-20T20:00:00Z', _N, 60) == parse('2026-10-20T20:00:00Z'), 'never shorter'
assert extended_until('2026-10-20T12:30:00Z', _N, 60) == parse('2026-10-20T14:00:00Z')


def _ht():
    spec = importlib.util.spec_from_file_location('holdtoken_i2s', HT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def read_hold():
    try:
        h = json.load(open(HOLDF))
        return h if isinstance(h, dict) and h.get('token') else None
    except Exception:
        return None


def write_hold(h):
    tmp = HOLDF + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(h, f)
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, HOLDF)


def cmd_quiet():
    st = subprocess.run(['python3', os.path.join(H, 'canary-sched.py'), 'status'], capture_output=True, text=True).stdout.splitlines()
    ready = {l.split()[0] for l in st if len(l.split()) > 1 and l.split()[1] in ('ready', 'running')}
    q = json.load(open(os.path.join(H, 'canary-queue.json')))
    m, why = quiet_from(ready, q.get('entries', []), lambda p: json.load(open(p)))
    if m is None:
        print(why); return 2
    print(m); return 0


def extend(ht, P, token, base, quiet):
    """Under the scheduler's tick lock: if the live hold is `token`, set its until to max(until, base + quiet + 60)."""
    def go():
        if ht.owner_of(P['install_hold']) != token:
            return None
        r = json.load(open(P['install_hold']))
        r['until'] = iso(extended_until(r.get('until'), base, quiet))
        tmp = P['install_hold'] + '.i2s-tmp'
        with open(tmp, 'w') as f:
            json.dump(r, f); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, P['install_hold'])
        return r['until']
    return ht._locked(P, go)


def cmd_claim(owner, quiet):
    quiet = int(quiet)
    ht = _ht(); sm = ht._sched(); P = sm.paths()
    h = read_hold()
    cur = ht.owner_of(P['install_hold'])
    if h and cur == h['token']:
        until = extend(ht, P, h['token'], dt.datetime.now(dt.timezone.utc), max(quiet, int(h.get('quiet_min', 0))))
        if not until:
            print('REFUSED: the hold changed owner while extending it'); return 2
        h['quiet_min'] = max(quiet, int(h.get('quiet_min', 0)))
        write_hold(h)
        print('REUSED %s; until %s; quiet %d' % (h['token'], until, h['quiet_min'])); return 0
    if h:
        print('REFUSED: HOLD.json names %s but the live hold is %r: resolve by hand (no new claim over a recorded one)' % (h['token'], cur)); return 2
    token = '%s:%d:%d' % (RUN, os.getpid(), int(dt.datetime.now().timestamp() * 1e9))
    rc = ht.claim(P, token, quiet + 60, ht.sched_slot_check(sm))
    if rc != 0:
        return 2
    write_hold({'token': token, 'quiet_min': quiet, 'owner': owner, 'claimed_at': iso(dt.datetime.now(dt.timezone.utc))})
    print('CLAIMED %s' % token); return 0


def cmd_release(owner, quiet):
    h = read_hold()
    if not h:
        print('REFUSED: no hold recorded in %s' % HOLDF); return 2
    q = max(int(quiet), int(h.get('quiet_min', 0)))
    try:
        lines = open(JOURNAL).read().splitlines()
    except Exception as e:
        print('REFUSED: journal unreadable: %s' % e); return 2
    last = last_transition(lines)
    ok, nb = release_ok(dt.datetime.now(dt.timezone.utc), last, q)
    if not last:
        print('REFUSED: no transition in the journal (an unused hold: use drop)'); return 2
    why = unreconciled(lines)
    if why:
        print('REFUSED: %s' % why); return 2
    ht = _ht(); P = ht._sched().paths()
    if not ok:
        # a QUIET raised at release (a long canary queued during the hold) must not leave the hold expiring first
        # (Claude r4 P3-1): its until is extended to last + q + 60
        if q > int(h.get('quiet_min', 0)):
            extend(ht, P, h['token'], parse(last), q)
            h['quiet_min'] = q; write_hold(h)
        print('REFUSED: the quiet period runs to %s (last transition %s + %d min)' % (iso(nb), last, q)); return 2
    if ht.owner_of(P['install_hold']) != h['token']:
        print('REFUSED: the live hold is not ours (%r): nothing released' % ht.owner_of(P['install_hold'])); return 2
    ht.release(P, h['token'])
    if ht.owner_of(P['install_hold']) is not None:
        print('REFUSED: the hold is still there after release'); return 2
    os.remove(HOLDF)
    print('RELEASED %s (last transition %s + %d min = %s)' % (h['token'], last, q, iso(nb))); return 0


def cmd_drop():
    h = read_hold()
    if not h:
        return 0
    try:
        last = last_transition(open(JOURNAL).read().splitlines())
    except Exception:
        last = 'unknown'
    if last and (last == 'unknown' or last >= h.get('claimed_at', '')):
        print('NOT DROPPED: a transition happened under this hold (%s)' % last); return 2
    ht = _ht(); P = ht._sched().paths()
    ht.release(P, h['token'])
    if ht.owner_of(P['install_hold']) == h['token']:
        print('NOT DROPPED: release failed'); return 2
    os.remove(HOLDF)
    print('DROPPED unused hold %s' % h['token']); return 0


if __name__ == '__main__':
    a = sys.argv[1:]
    if a == ['selftest']:
        print('self-tests PASS'); sys.exit(0)
    if a == ['quiet']:
        sys.exit(cmd_quiet())
    if len(a) == 3 and a[0] == 'claim':
        sys.exit(cmd_claim(a[1], a[2]))
    if len(a) == 3 and a[0] == 'release':
        sys.exit(cmd_release(a[1], a[2]))
    if a == ['drop']:
        sys.exit(cmd_drop())
    print(__doc__); sys.exit(2)
