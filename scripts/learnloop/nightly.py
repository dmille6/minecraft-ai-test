#!/usr/bin/env python3
"""learning loop M1 nightly: extract each finished UTC day, check it, and archive it to the NAS (on 10.0.0.31).

    nice -n 19 ionice -c3 python3 -B nightly.py --tick                 # cron, 01:50Z: every day not yet archived
    python3 -B nightly.py --tick --max-days 16                         # backfill
    python3 -B nightly.py --tick --dry-run                             # what it would do; writes nothing remote
    python3 -B nightly.py --adopt-raw                                  # prove raw members of days sealed without them
    python3 -B nightly.py --repair-raw 2026-10-12                      # send held raw files a raw control left out
    python3 -B nightly.py --ack 2026-10-12 "ES re-ingest, files right"  # a person accepts a failed control (recorded)

WHY IT EXISTS. Logs on .31 rotate after 14 generations (logrotate rotate 14), so a day not archived within two weeks
is gone; this archive is the only long-term copy of the decision stream (design s.1.5).

PER DAY D (oldest first; D runs from --start, default 2026-10-08, the oldest generation on disk when M1 shipped):
  1. rawhold: every rotated llm/skill generation is first COPIED to ~/learnloop/rawhold/<bot>/ (cp, never moved), so a
     generation that rotates out before its day is archived is still on disk. A held generation is pruned only after
     its day is sealed on the NAS AND the live copy has rotated away.
  2. extract (extract_triples.extract_day) -> days/D/triples-YYYYMMDD.jsonl.gz + summary.json.
  3. positive controls (controls.json, all printed with denominators; a failure is RECORDED, never a reason to skip
     the archive -- preserving the rows comes first and a failed control shows as '!!' in fleetstatus):
       rows      the day's decision lines counted by timestamp prefix BEFORE any parse == parsed rows (+ unparseable);
                 model + deterministic == rows; triples written == model rows; labels sum to model rows;
                 refused + admitted == model rows; bots with rows == roster
       join      every EXECUTED decision (admitted, not runner-refused) joins its skill row: unexplained misses
                 (not paused/busy) <= --join-tolerance of executed (default 0.01%)
       sysprompt every (code version, system hash) pair of the day rebuilds from that version (sysprompts.py)
       es        Elasticsearch agrees: llm docs, skill docs, _death, _stagnation, _milestone_complete for D
                 (|files - ES| <= the rotation-race allowance: llm 15, skill 120, events 2)
  4. raw-YYYYMMDD.tar: the generation -(D+1) llm + skill .gz of every log dir (the generation that holds D), each
     gzip-tested; a missing one is listed in controls.
  5. sysprompts-YYYYMMDD.json: the templates the day's hashes rebuild to (training needs the text, s.1.1).
  6. MANIFEST.json (deterministic: no clock; sha256 + bytes of every file, counts, controls, versions, and the sha256 of
     every raw member), then each file is sent through the .30 relay (nas-relay.sh: put -> NAS read-back hash ->
     rename), MANIFEST last, then `seal` re-hashes every listed file on the NAS and writes _OK. Only then is D recorded
     archived in state.json. BEFORE processing a day, `verify` asks the NAS: a day already sealed there (a lost
     acknowledgement, a lost state.json) is recorded from the NAS's own MANIFEST and never re-sent; a failed seal is
     also re-checked with `verify`.
  7. rawhold pruning is PER FILE: a held file is deleted only when the live copy has rotated away AND the file's sha256
     equals the one its sealed day recorded for it. Files a raw control left out stay held and keep the heartbeat red
     until --repair-raw sends them (or a person acknowledges the day with --ack).
HEARTBEAT ~/learnloop/heartbeat.json (atomic) after every tick, also on a crash: status ok | control_failed | behind |
at_risk | archive_failed | error | empty, the newest archived day, per-day counts, every UNRESOLVED day (a failed control
not yet acknowledged, raw not proven on the NAS), raw generations at risk. fleetstatus.py's
learnloop_line reads it ('!!' when missing, stale, behind or failing).
"""
import argparse, datetime as dt, fcntl, glob, gzip, hashlib, io, json, os, re, shutil, subprocess, sys, tarfile, time, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import extract_triples as X  # noqa: E402

HOME = os.path.expanduser('~/learnloop')
START = '2026-10-08'
RELAY = 'mike@10.0.0.30'
RELAY_KEY = '~/.ssh/id_learnloop_relay'
TOL = {'llm': 15, 'skill': 120, 'event': 2}       # ES rotation race: ~5-12 llm / ~40-60 skill rows per rotation
GEN = re.compile(r'^(llm|skill)-(.+)\.jsonl-(\d{8})\.gz$')


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def atomic_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(obj, fh, indent=1, default=str)
    os.replace(tmp, path)


# ------------------------------------------------------------------ pure controls (test_nightly.py) --------------
def row_controls(s):
    """Accounting identities on one extract_day summary. -> {'ok': bool, 'checks': [(name, ok, text)]}"""
    pc, rows, ex = s['positive_control'], s['rows'], s.get('rows_extra') or {}
    unp = (pc.get('reader_rejects') or {}).get('unparseable_line', 0)
    refused = sum(s['refused_by_reason'].values()); admitted_any = sum(s['admitted_status'].values())
    checks = [
        ('raw lines == parsed rows', ex.get('llm_rows_raw', -1) - pc['llm_rows'] <= unp and ex.get('llm_rows_raw', -1) >= pc['llm_rows'],
         'raw %s, parsed %s, unparseable (llm+skill) %s' % (ex.get('llm_rows_raw'), pc['llm_rows'], unp)),
        ('model + deterministic == rows', rows['model_rows'] + rows['deterministic_rows'] == pc['llm_rows'],
         '%d + %d vs %d' % (rows['model_rows'], rows['deterministic_rows'], pc['llm_rows'])),
        ('triples written == model rows', ex.get('triples_written') == rows['model_rows'],
         '%s vs %d' % (ex.get('triples_written'), rows['model_rows'])),
        ('labels sum == model rows', sum(s['labels'].values()) == rows['model_rows'],
         '%d vs %d %s' % (sum(s['labels'].values()), rows['model_rows'], s['labels'])),
        ('refused + admitted == model rows', refused + admitted_any == rows['model_rows'],
         '%d + %d vs %d' % (refused, admitted_any, rows['model_rows'])),
        ('joined + missed == admitted', sum(s['join'].values()) == rows['admitted'],
         '%s vs %d' % (s['join'], rows['admitted'])),
        ('bots with rows == roster', pc['bots_with_rows'] == pc['roster'],
         '%d of %d (no log dir %d, no rows %d)' % (pc['bots_with_rows'], pc['roster'], pc['roster_bots_without_log_dir'],
                                                   pc['roster_bots_without_rows'])),
        ('model rows > 0', rows['model_rows'] > 0, 'model rows %d (a day with none is an instrument failure)' % rows['model_rows']),
    ]
    return {'ok': all(c[1] for c in checks), 'checks': checks}


def join_control(s, tolerance=1e-4):
    """Every EXECUTED decision joins its skill row. Executed = admitted minus runner-refused (paused/busy: no row can
    exist, runner.mjs returns before logSkill). Unexplained = misses that are not paused/busy."""
    why = s.get('join_miss_why') or {}
    runner_refused = sum(n for k, n in why.items() if not k.startswith('OTHER'))
    unexplained = sum(n for k, n in why.items() if k.startswith('OTHER'))
    executed = s['rows']['admitted'] - runner_refused
    joined = (s['join'].get('exact', 0) + s['join'].get('ambiguous', 0))
    allow = int(executed * tolerance)
    ok = executed > 0 and unexplained <= allow and joined + unexplained == executed
    return {'ok': ok, 'executed': executed, 'joined_exact': s['join'].get('exact', 0),
            'joined_ambiguous': s['join'].get('ambiguous', 0), 'unexplained_misses': unexplained,
            'allowance': allow, 'runner_refused': runner_refused,
            'text': '%d of %d executed decisions join a skill row (exact %d, ambiguous %d); unexplained misses %d '
                    '(allowance %d); runner-refused %d (void, no row by construction)' % (
                        joined, executed, s['join'].get('exact', 0), s['join'].get('ambiguous', 0), unexplained, allow,
                        runner_refused)}


def es_compare(files, es, tol=TOL):
    """files/es: {'llm': n, 'skill': n, '_death': n, '_stagnation': n, '_milestone_complete': n}. es None = unreadable."""
    if es is None or es.get('error'):
        return {'ok': False, 'text': 'ES unreadable: %s' % ((es or {}).get('error') or 'no reading'), 'rows': []}
    rows = []
    for k in ('llm', 'skill', '_death', '_stagnation', '_milestone_complete'):
        t = tol['llm'] if k == 'llm' else tol['skill'] if k == 'skill' else tol['event']
        d = files.get(k, 0) - es.get(k, 0)
        rows.append((k, files.get(k), es.get(k), d, abs(d) <= t))
    return {'ok': all(r[4] for r in rows), 'rows': rows,
            'text': '; '.join('%s files %s ES %s (diff %+d%s)' % (r[0], r[1], r[2], r[3], '' if r[4] else ' OVER') for r in rows)}


def files_counts(s):
    ev = s['positive_control']['event_rows_in_day']
    return {'llm': s['positive_control']['llm_rows'], 'skill': s['positive_control']['skill_rows_in_day'],
            '_death': ev.get('_death', 0), '_stagnation': ev.get('_stagnation (exact kind)', 0),
            '_milestone_complete': ev.get('_milestone_complete', 0)}


READY_AFTER = dt.timedelta(days=1, hours=1, minutes=15)   # the extractor reads 1 h + 600 s past midnight


def days_to_do(start, now, archived):
    """Every day in [start, ...) whose lookahead has fully passed (D + 1 d 1 h 15 min <= now) and that is not yet
    archived, oldest first."""
    d = dt.date.fromisoformat(start); out = []
    while dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc) + READY_AFTER <= now:
        if d.isoformat() not in archived:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def generation_for(day):
    """The rotated generation that holds day D: logrotate runs at 00:00Z and dateext names it for the rotation day."""
    return (dt.date.fromisoformat(day) + dt.timedelta(days=1)).strftime('%Y%m%d')


def at_risk(gens_on_disk, archived, today, keep=14, warn_days=3):
    """Live generations whose day is not archived and that rotate out within warn_days. gens: {'YYYYMMDD'}."""
    out = []
    for g in sorted(gens_on_disk):
        gd = dt.datetime.strptime(g, '%Y%m%d').date()
        day = (gd - dt.timedelta(days=1)).isoformat()
        expires = gd + dt.timedelta(days=keep)          # rotate 14: the 15th rotation after it deletes it
        if day not in archived and (expires - today).days <= warn_days:
            out.append({'generation': g, 'day': day, 'expires': expires.isoformat()})
    return out


def unresolved(archived, acknowledged):
    """Archived days that still need a person: a failed positive control (until acknowledged with --ack), or raw files
    not proven on the NAS (no raw_members record, or a raw control that left files out -- those stay held)."""
    out = []
    for day, rec in sorted(archived.items()):
        why = []
        if not rec.get('controls_ok') and day not in (acknowledged or {}):
            why.append('controls failed %s' % rec.get('controls_failed'))
        if rec.get('raw_members') is None:
            why.append('raw members not proven on the NAS (run --adopt-raw: it hashes the sealed tar on the NAS)')
        elif rec.get('raw_left_out'):
            why.append('%d raw file(s) left out of the archive and held (run --repair-raw %s)' % (len(rec['raw_left_out']), day))
        if why:
            out.append({'day': day, 'why': '; '.join(why)})
    return out


def heartbeat_status(day_results, error=None, pending=(), newest_rec=None, at_risk_list=(), unresolved_list=()):
    """error > archive_failed (this run could not archive a day) > at_risk (a live generation of an unarchived day
    rotates out within 3 days) > behind (finished days still pending, e.g. a capped backfill) > control_failed (ANY
    archived day with an unresolved failed control or unproven raw, not only the newest) > empty > ok."""
    if error:
        return 'error'
    if any(not r.get('archived') for r in day_results):
        return 'archive_failed'
    if at_risk_list:
        return 'at_risk'
    if pending:
        return 'behind'
    if unresolved_list:
        return 'control_failed'
    if newest_rec is None:
        return 'empty'
    return 'ok'


# ------------------------------------------------------------------ side effects --------------------------------
def sync_rawhold(logroot, rawhold, log):
    """Copy every rotated llm/skill generation not yet held. Never moves or deletes anything in logroot."""
    n = 0
    for f in glob.glob(os.path.join(logroot, '*', '*.jsonl-*.gz')):
        b = os.path.basename(f)
        if not GEN.match(b):
            continue
        dst = os.path.join(rawhold, os.path.basename(os.path.dirname(f)), b)
        if os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(f):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(f, dst + '.part'); os.replace(dst + '.part', dst); n += 1
    log('rawhold: %d generation file(s) copied' % n)
    return n


def _normalise(ti):
    """Owner-independent member headers: a held copy (mike) and the live file (mcbot) tar to the same bytes."""
    ti.uid = ti.gid = 0; ti.uname = ti.gname = ''; ti.mode = 0o644
    return ti


def raw_tar(day, logroot, rawhold, dst, expect_bots):
    """tar of generation -(D+1) llm+skill gz, each gzip-tested. expect_bots = the bots with rows that day (a missing
    file of one of them fails the raw control; a directory with no rows that day is not expected). Any other log dir
    whose generation exists is included too. -> (members {relpath: sha256}, missing [relpath], bad [text])."""
    g = generation_for(day)
    dirs = sorted(set(expect_bots) | {os.path.basename(d.rstrip('/')) for d in glob.glob(logroot + '/*-*/')})
    members, missing, bad = {}, [], []
    with tarfile.open(dst + '.part', 'w', format=tarfile.PAX_FORMAT) as tf:
        for b in dirs:
            for kind in ('llm', 'skill'):
                name = '%s-%s.jsonl-%s.gz' % (kind, b, g)
                src = next((p for p in (os.path.join(logroot, b, name), os.path.join(rawhold, b, name)) if os.path.exists(p)), None)
                if not src:
                    if b in expect_bots:
                        missing.append('%s/%s' % (b, name))
                    continue
                try:
                    with gzip.open(src, 'rb') as fh:
                        while fh.read(1 << 20):
                            pass
                except (OSError, EOFError) as e:
                    bad.append('%s/%s: %s' % (b, name, e)); continue
                tf.add(src, arcname='%s/%s' % (b, name), filter=_normalise)
                members['%s/%s' % (b, name)] = sha256_file(src)
    os.replace(dst + '.part', dst)
    return members, missing, bad


def es_counts(day):
    """ES counts for [D, D+1). Never raises: an unreadable ES is a reading of its own."""
    try:
        from lib.estelemetry import EsEvents
        a, b = day + 'T00:00:00Z', (dt.date.fromisoformat(day) + dt.timedelta(days=1)).isoformat() + 'T00:00:00Z'
        sk = EsEvents.load('skill', since=a, until=b)
        lm = EsEvents.load('llm', since=a, until=b)
        out = {'llm': int(lm.total()), 'skill': int(sk.total())}
        if not out['skill'] or not out['llm']:
            return {'error': 'ES window holds %s skill / %s llm docs (positive control failed)' % (out['skill'], out['llm'])}
        for k in ('_death', '_stagnation', '_milestone_complete'):
            out[k] = int(sk.count(k, allow_zero=True))   # the window is proven non-empty above; the files are the control
        out['caveats'] = list(sk.caveats)
        return out
    except Exception as e:                       # noqa: BLE001 -- recorded, never fatal
        return {'error': '%s: %s' % (type(e).__name__, str(e)[:200])}


class Relay:
    def __init__(self, target=RELAY, key=RELAY_KEY, ssh='ssh', dry=False):
        self.target, self.key, self.ssh, self.dry = target, os.path.expanduser(key), ssh, dry

    def call(self, *args, stdin_path=None, timeout=1800):
        """-> (rc, stdout). STDOUT ONLY is parsed (Claude r2 P3: an ssh warning on stderr broke the JSON of `manifest`);
        stderr is appended after ' | ' only when the call failed, for the log."""
        if self.dry:
            return 99, 'DRY (not sent): ' + ' '.join(args[:3])
        cmd = [self.ssh, '-i', self.key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30',
               '-o', 'StrictHostKeyChecking=accept-new', self.target] + list(args)
        with (open(stdin_path, 'rb') if stdin_path else open(os.devnull, 'rb')) as fin:
            r = subprocess.run(cmd, stdin=fin, capture_output=True, timeout=timeout)
        out = r.stdout.decode(errors='replace').strip()
        if r.returncode != 0 and r.stderr.strip():
            out += ' | ' + r.stderr.decode(errors='replace').strip()[:300]
        return r.returncode, out

    def put(self, day, path):
        """A DRY put is NOT an upload (both engines r2 P1): ok is False, so no caller can record it as archived."""
        sha = sha256_file(path)
        rc, out = self.call('put', day, os.path.basename(path), sha, stdin_path=path)
        ok = rc == 0 and out.startswith('OK ' + sha)
        return ok, sha, out

    def seal(self, day):
        rc, out = self.call('seal', day)
        return rc == 0 and out.startswith('OK sealed ' + day), out

    def list(self, day):
        rc, out = self.call('list', day, timeout=120)
        return [l.split(' ', 1)[0] for l in out.splitlines() if l.strip()] if rc == 0 else None

    def members(self, day, name):
        """{relpath: sha256} of every member of a tar AS STORED on the NAS (hashed on .30 from the NAS's bytes), or
        None. The proof of what reached the NAS, independent of tar headers, owners and live copies (Claude r2 P2)."""
        rc, out = self.call('members', day, name, timeout=1800)
        if rc != 0:
            return None
        mem = {}
        for line in out.splitlines():
            p = line.split('  ', 1)
            if len(p) != 2 or not re.fullmatch(r'[0-9a-f]{64}', p[0]):
                return None
            mem[p[1]] = p[0]
        return mem

    def verify(self, day):
        """True only when the day is sealed and every file its stored MANIFEST lists hashes right on the NAS."""
        if self.dry:
            return False, 'DRY'
        rc, out = self.call('verify', day, timeout=600)
        return rc == 0 and out.startswith('OK verified ' + day), out

    def manifest(self, day):
        rc, out = self.call('manifest', day, timeout=120)
        if rc != 0:
            return None
        try:
            return json.loads(out)
        except ValueError:
            return None

    def status(self):
        rc, out = self.call('status', timeout=120)
        st = {'rc': rc, 'raw': out[:300]}
        for line in out.splitlines():
            if line.startswith('LASTGOOD '):
                st['last_good'] = line[9:].strip()
            elif line.startswith('SEALED '):
                p = line.split(); st['sealed'] = int(p[1]) if len(p) > 1 and p[1].isdigit() else None
                st['newest'] = p[2] if len(p) > 2 else None
            elif line.startswith('UNSEALED'):
                st['unsealed'] = line.split()[1:]
        return st


def process_day(day, a, relay, log):
    ddir = os.path.join(a.home, 'days', day)
    os.makedirs(ddir, exist_ok=True)
    r = {'day': day, 'archived': False, 'controls_ok': False}
    t0 = time.time()
    s = X.extract_day(day, a.logroot, a.roster, ddir, rawhold=a.rawhold)
    r['extract_s'] = round(time.time() - t0)
    rc = row_controls(s); jc = join_control(s, a.join_tolerance)
    import sysprompts as SP
    rebuilt = SP.rebuild(list(s['system_hash_by_version']), a.repo, os.path.join(a.home, 'sysprompts'), a.node_modules)
    spc = SP.match(s['system_hash_by_version'], rebuilt)
    spc['errors'] = {v: e['errors'] for v, e in rebuilt.items() if e.get('errors')}
    es = {'error': 'skipped (--no-es)'} if a.no_es else es_counts(day)
    esc = es_compare(files_counts(s), es)
    yyyymmdd = day.replace('-', '')
    tarp = os.path.join(ddir, 'raw-%s.tar' % yyyymmdd)
    members, missing, bad = raw_tar(day, a.logroot, a.rawhold, tarp, sorted(s['per_bot']))
    rawc = {'ok': not missing and not bad and len(members) > 0, 'members': len(members), 'missing': missing[:20],
            'missing_n': len(missing), 'bad': bad[:20], 'generation': generation_for(day),
            'expected_bots': len(s['per_bot'])}
    spp = os.path.join(ddir, 'sysprompts-%s.json' % yyyymmdd)
    atomic_json(spp, {v: {'sha': e.get('sha'), 'hashes': {h: x for h, x in (e.get('hashes') or {}).items()
                                                            if h in (s['system_hash_by_version'].get(v) or {})}}
                      for v, e in rebuilt.items()})
    controls = {'rows': {'ok': rc['ok'], 'checks': [list(c) for c in rc['checks']]}, 'join': jc, 'sysprompt': spc,
                'es': {'ok': esc['ok'], 'text': esc['text'], 'files': files_counts(s), 'es': es}, 'raw': rawc}
    r['controls_ok'] = all(controls[k]['ok'] for k in controls)
    r['controls_failed'] = [k for k in controls if not controls[k]['ok']]
    atomic_json(os.path.join(ddir, 'controls.json'), controls)
    files = [os.path.join(ddir, n) for n in (s['shard'], 'summary.json', 'controls.json', os.path.basename(spp), os.path.basename(tarp))]
    # DETERMINISTIC: no clock in the MANIFEST, so a re-run of an unsealed day re-sends identical bytes (the time a day
    # was archived lives in state.json and in the NAS's _OK).
    man = {'day': day, 'extractor': X.EXTRACTOR_VERSION, 'label_rule': X.LABEL_RULE,
           'app_version': a.app_version, 'host': os.uname().nodename,
           'raw_members': members, 'raw_left_out': sorted(missing + [x.split(':')[0] for x in bad]),
           'counts': {'llm_rows': s['positive_control']['llm_rows'], 'model_rows': s['rows']['model_rows'],
                      'triples': s['rows_extra']['triples_written'], 'labels': s['labels'],
                      'bots': s['positive_control']['bots_with_rows'], 'roster': s['positive_control']['roster']},
           'code_versions': s['code_version'], 'system_hashes': s['system_hash'],
           'controls_ok': r['controls_ok'], 'controls_failed': r['controls_failed'],
           'files': {os.path.basename(p): {'sha256': sha256_file(p), 'bytes': os.path.getsize(p)} for p in files}}
    manp = os.path.join(ddir, 'MANIFEST.json')
    atomic_json(manp, man)
    r.update({'raw_members': members, 'raw_left_out': man['raw_left_out'],
              'llm_rows': man['counts']['llm_rows'], 'model_rows': man['counts']['model_rows'],
              'triples': man['counts']['triples'], 'labels': s['labels'], 'bots': man['counts']['bots'],
              'roster': man['counts']['roster'], 'join': jc['text'], 'es': esc['text'],
              'sysprompt': '%d of %d (version, hash) pairs rebuilt' % (spc['pairs_rebuilt'], spc['pairs']),
              'bytes': sum(f['bytes'] for f in man['files'].values())})
    log('%s: %d triples of %d llm rows, %d/%d bots, labels %s, controls %s (%ss)' % (
        day, r['triples'], r['llm_rows'], r['bots'], r['roster'], s['labels'],
        'ok' if r['controls_ok'] else 'FAILED ' + ','.join(r['controls_failed']), r['extract_s']))
    for p in files + [manp]:                     # MANIFEST last: seal hashes exactly what it lists
        ok, sha, out = relay.put(day, p)
        log('  put %s: %s' % (os.path.basename(p), out[:160]))
        if not ok:
            r['archive_error'] = 'put %s: %s' % (os.path.basename(p), out[:200]); return r
    ok, out = relay.seal(day)
    log('  seal: %s' % out[:160])
    if not ok:
        vok, vout = relay.verify(day)            # a seal whose acknowledgement was lost is still a seal
        log('  verify after a failed seal: %s' % vout[:160])
        if not vok:
            r['archive_error'] = 'seal: %s' % out[:200]; return r
    r['archived'] = not relay.dry
    if r['archived']:
        os.remove(tarp)                          # the gz files stay in rawhold until pruned; the tar is on the NAS
    return r


def prune_rawhold(rawhold, logroot, archived, log):
    """Remove a held file ONLY when it is itself proven on the NAS: its day is sealed, its relpath is in that day's
    raw_members with the SAME sha256, and logrotate has already deleted the live copy. Anything left out of the
    archive (missing at tar time, corrupt, or no raw_members record) stays held."""
    n = kept = 0
    for f in glob.glob(os.path.join(rawhold, '*', '*.jsonl-*.gz')):
        m = GEN.match(os.path.basename(f))
        if not m:
            continue
        day = (dt.datetime.strptime(m.group(3), '%Y%m%d').date() - dt.timedelta(days=1)).isoformat()
        rel = '%s/%s' % (os.path.basename(os.path.dirname(f)), os.path.basename(f))
        live = os.path.join(logroot, rel)
        if os.path.exists(live):
            continue
        mem = (archived.get(day) or {}).get('raw_members') or {}
        if rel in mem and mem[rel] == sha256_file(f):
            os.remove(f); n += 1
        else:
            kept += 1
    log('rawhold: %d archived file(s) pruned; %d rotated-out file(s) kept (not proven on the NAS)' % (n, kept))
    return n, kept


def record_from_nas(day, man):
    """A state record rebuilt from the NAS's own MANIFEST (a sealed day this host has no record of)."""
    c = man.get('counts') or {}
    return {'triples': c.get('triples'), 'llm_rows': c.get('llm_rows'), 'model_rows': c.get('model_rows'),
            'bots': c.get('bots'), 'roster': c.get('roster'), 'labels': c.get('labels'),
            'controls_ok': man.get('controls_ok'), 'controls_failed': man.get('controls_failed'),
            'bytes': sum(f.get('bytes', 0) for f in (man.get('files') or {}).values()),
            'raw_members': man.get('raw_members'), 'raw_left_out': man.get('raw_left_out'), 'from_nas': True}


def expected_raw(day, a):
    """The raw files a day should have archived: llm + skill of generation -(D+1) for every bot with rows that day."""
    sp = os.path.join(a.home, 'days', day, 'summary.json')
    bots = sorted((json.load(open(sp)).get('per_bot') or {})) if os.path.exists(sp) else []
    g = generation_for(day)
    return ['%s/%s-%s.jsonl-%s.gz' % (b, k, b, g) for b in bots for k in ('llm', 'skill')]


def adopt_raw(day, rec, relay, a, log):
    """Prove the raw members of a day the NAS holds but this host has no member record for (the first backfill's
    MANIFESTs listed none): the day must verify, then every raw-*/repair-raw-* tar it lists is hashed member by member
    FROM THE NAS'S BYTES on .30 (relay `members`). Those hashes become raw_members; expected files not among them are
    raw_left_out (held, repairable). Prune later deletes a held file only if its own sha256 equals the NAS's."""
    vok, vout = relay.verify(day)
    if not vok:
        return False, 'the day does not verify on the NAS: %s' % vout[:120]
    man = relay.manifest(day) or {}
    names = sorted(n for n in (man.get('files') or {}) if n.startswith(('raw-', 'repair-raw-')) and n.endswith('.tar'))
    # repair tars are never in a MANIFEST (added after the seal): find them by listing the day (Claude r3 P3)
    names += sorted(n for n in (relay.list(day) or []) if n.startswith('repair-raw-') and n.endswith('.tar') and n not in names)
    if not names:
        return False, 'the NAS MANIFEST lists no raw tar'
    mem = {}
    for n in names:
        m = relay.members(day, n)
        if m is None:
            return False, 'could not list the members of %s on the NAS' % n
        mem.update(m)
    exp = expected_raw(day, a)
    rec['raw_members'] = mem
    rec['raw_left_out'] = sorted(x for x in exp if x not in mem)
    return True, '%d members hashed on the NAS (%d expected, %d left out)' % (len(mem), len(exp), len(rec['raw_left_out']))


def repair_raw(day, rec, a, relay, log):
    """Send held files a failed raw control left out as repair-raw-YYYYMMDD-<n>.tar (a sealed day accepts only new
    repair-* names); record them as members once the NAS read-back hash matches."""
    left = [x for x in rec.get('raw_left_out') or [] if os.path.exists(os.path.join(a.rawhold, x))]
    if not left:
        return False, 'nothing held to repair (left out: %s)' % (rec.get('raw_left_out') or [])
    tmp = os.path.join(a.home, 'days', day, 'repair-raw.part')
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    mem = {}
    with tarfile.open(tmp, 'w', format=tarfile.PAX_FORMAT) as tf:
        for rel in left:
            src = os.path.join(a.rawhold, rel)
            try:
                with gzip.open(src, 'rb') as fh:
                    while fh.read(1 << 20):
                        pass
            except (OSError, EOFError) as e:
                log('  repair: %s still unreadable (%s) -- kept held, not sent' % (rel, e)); continue
            tf.add(src, arcname=rel, filter=_normalise); mem[rel] = sha256_file(src)
    if not mem:
        os.remove(tmp); return False, 'every left-out file is still unreadable'
    # CONTENT-NAMED (Claude r2 P3): a retry after a lost acknowledgement re-sends the SAME name with the same bytes
    # ("already"); a different member set gets a different name instead of a refusal on the sealed day
    tag = hashlib.sha1(json.dumps(sorted(mem.items())).encode()).hexdigest()[:10]
    tarp = os.path.join(a.home, 'days', day, 'repair-raw-%s-%s.tar' % (day.replace('-', ''), tag))
    os.replace(tmp, tarp)
    ok, sha, out = relay.put(day, tarp)
    if not ok:
        return False, 'put: %s' % out[:200]
    rec['raw_members'] = dict(rec.get('raw_members') or {}, **mem)
    rec['raw_left_out'] = [x for x in rec.get('raw_left_out') or [] if x not in mem]
    rec.setdefault('repairs', []).append({'file': os.path.basename(tarp), 'sha256': sha, 'members': sorted(mem)})
    os.remove(tarp)
    return True, '%d file(s) sent in %s' % (len(mem), os.path.basename(tarp))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--tick', action='store_true')
    ap.add_argument('--home', default=HOME)
    ap.add_argument('--logroot', default='/var/log/mcai')
    ap.add_argument('--roster', default='/srv/mcbots/harness/env')
    ap.add_argument('--repo', default='/opt/minecraft-ai')
    ap.add_argument('--node-modules', default='/srv/mcbots/harness/node_modules')
    ap.add_argument('--start', default=START)
    ap.add_argument('--max-days', type=int, default=3)
    ap.add_argument('--only', default=None, help='process exactly this day (still skipped if archived)')
    ap.add_argument('--join-tolerance', type=float, default=1e-4)
    ap.add_argument('--relay', default=RELAY)
    ap.add_argument('--relay-key', default=RELAY_KEY)
    ap.add_argument('--no-es', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--adopt-raw', action='store_true', help='prove raw members of archived days that have no record')
    ap.add_argument('--repair-raw', default=None, metavar='DAY', help='send held raw files a failed raw control left out')
    ap.add_argument('--ack', nargs=2, metavar=('DAY', 'WHY'), help='acknowledge a failed control (recorded, with why)')
    a = ap.parse_args(argv)
    a.home = os.path.expanduser(a.home)
    a.rawhold = os.path.join(a.home, 'rawhold')
    os.makedirs(a.home, exist_ok=True)
    vf = os.path.join(HERE, 'VERSION')
    a.app_version = open(vf).read().strip() if os.path.exists(vf) else 'unknown'
    logf = open(os.path.join(a.home, 'nightly.log'), 'a')

    def log(msg):
        line = '%s %s' % (iso(now_utc()), msg)
        print(line, flush=True); logf.write(line + '\n'); logf.flush()

    lock = open(os.path.join(a.home, 'nightly.lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log('another nightly run holds the lock -- not starting a second'); return 3
    statep = os.path.join(a.home, 'state.json')
    state = json.load(open(statep)) if os.path.exists(statep) else {'archived': {}}
    state.setdefault('acknowledged', {})
    hb = {'at': None, 'status': None, 'app_version': a.app_version, 'host': os.uname().nodename}
    results, error = [], None
    relay = Relay(a.relay, a.relay_key, dry=a.dry_run)
    if a.dry_run and (a.ack or a.adopt_raw or a.repair_raw):
        log('REFUSED: --ack, --adopt-raw and --repair-raw change what is recorded as archived; they never run under --dry-run')
        return 2
    try:
        if a.ack:
            if a.ack[0] not in state['archived']:
                raise SystemExit('REFUSED: %s is not archived' % a.ack[0])
            state['acknowledged'][a.ack[0]] = {'why': a.ack[1], 'at': iso(now_utc())}
            atomic_json(statep, state); log('acknowledged %s: %s' % tuple(a.ack))
        if a.adopt_raw or a.repair_raw:
            for day, rec in sorted(state['archived'].items()):
                if a.adopt_raw and rec.get('raw_members') is None:
                    ok, why = adopt_raw(day, rec, relay, a, log)
                elif a.repair_raw == day:
                    ok, why = repair_raw(day, rec, a, relay, log)
                else:
                    continue
                log('%s %s: %s %s' % ('adopt-raw' if a.adopt_raw else 'repair-raw', day, 'OK' if ok else 'NOT DONE', why))
                atomic_json(statep, state)
        if not a.dry_run:
            sync_rawhold(a.logroot, a.rawhold, log)
        todo = days_to_do(a.start, now_utc(), state['archived'])
        if a.only:
            todo = [d for d in todo if d == a.only]
        if a.adopt_raw or a.repair_raw or a.ack:
            todo = []
        log('tick: %d day(s) not archived since %s: %s; this run takes %d' % (len(todo), a.start, todo[:20], min(len(todo), a.max_days)))
        for day in todo[:a.max_days]:
            vok, vout = relay.verify(day)        # sealed on the NAS but unknown here (lost ack, lost state): adopt it
            if vok:
                man = relay.manifest(day)
                if man:
                    state['archived'][day] = dict(record_from_nas(day, man), at=iso(now_utc()))
                    atomic_json(statep, state)
                    log('%s: already sealed on the NAS (%s) -- recorded from its MANIFEST, not re-sent' % (day, vout[:80]))
                    results.append({'day': day, 'archived': True, 'controls_ok': man.get('controls_ok'), 'from_nas': True})
                    continue
            try:
                r = process_day(day, a, relay, log)
            except Exception as e:               # one bad day must not stop the next (its raw is still held)
                r = {'day': day, 'archived': False, 'controls_ok': False,
                     'archive_error': 'crash: %s: %s' % (type(e).__name__, str(e)[:200])}
                log('%s CRASH %s' % (day, traceback.format_exc()[-800:]))
            results.append(r)
            if r.get('archived'):
                state['archived'][day] = {k: r.get(k) for k in ('triples', 'llm_rows', 'model_rows', 'bots', 'roster',
                                                                'labels', 'controls_ok', 'controls_failed', 'bytes',
                                                                'raw_members', 'raw_left_out')}
                state['archived'][day]['at'] = iso(now_utc())
                atomic_json(statep, state)
        if not a.dry_run:
            prune_rawhold(a.rawhold, a.logroot, state['archived'], log)
        hb['nas'] = relay.status() if not a.dry_run else {'dry': True}
    except Exception as e:                       # noqa: BLE001 -- the heartbeat must say so
        error = '%s: %s' % (type(e).__name__, str(e)[:300])
        log('TICK CRASH %s' % traceback.format_exc()[-1200:])
    gens = {GEN.match(os.path.basename(f)).group(3) for f in glob.glob(os.path.join(a.logroot, '*', '*.jsonl-*.gz'))
            if GEN.match(os.path.basename(f))}
    arch = sorted(state['archived'])
    newest = arch[-1] if arch else None
    pend = days_to_do(a.start, now_utc(), state['archived'])
    risk = at_risk(gens, state['archived'], now_utc().date())
    unres = unresolved(state['archived'], state['acknowledged'])
    hb.update({'at': iso(now_utc()), 'status': heartbeat_status(results, error, pend, state['archived'].get(newest) if newest else None,
                                                                risk, unres),
               'error': error, 'newest_archived_day': newest, 'archived_days': len(arch), 'unresolved': unres,
               'newest': {k: v for k, v in (state['archived'].get(newest) or {}).items() if k != 'raw_members'} if newest else None,
               'this_run': [{k: v for k, v in r.items() if k != 'raw_members'} for r in results], 'pending': pend, 'at_risk': risk,
               'oldest_live_generation': min(gens) if gens else None})
    if not a.dry_run:
        atomic_json(os.path.join(a.home, 'heartbeat.json'), hb)
    log('heartbeat: %s, newest archived %s, %d archived, pending %s, at risk %s' % (
        hb['status'], newest, len(arch), hb['pending'][:5], hb['at_risk']))
    return 0 if hb['status'] == 'ok' else 1


if __name__ == '__main__':
    sys.exit(main())
