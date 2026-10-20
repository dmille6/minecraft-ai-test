#!/usr/bin/env python3
"""BackupStale — raise when the backups stop, rather than report a comforting zero.

THE DESIGN CONSTRAINT. This project's dominant failure is a cheap negative: a query returns
0, nobody notices, and the zero gets believed. So the primary metric here is deliberately
NOT "how many snapshots today" -- if that query breaks, auth expires, or the repo is renamed
it returns 0, which is indistinguishable from a real failure and, inverted once, reads
healthy forever.

The primary metric is the AGE OF THE NEWEST SUCCESSFUL SNAPSHOT. If the instrument fails,
the age is infinite and it alarms. There is no failure mode of this check that produces a
green light.

Checks, each of which can only fail loudly:
  1. newest SUCCESS snapshot older than --max-age-h        -> BackupStale
  2. any FAILED or PARTIAL snapshot present                -> BackupDegraded
  3. SLM policy reports failures since its last success    -> BackupDegraded
  4. the off-host mirror's .last-pull older than --max-age-h -> MirrorStale
  5. the mirror has no index-N root blob                   -> MirrorUnreadable
  6. repo filesystem over --disk-pct                        -> DiskPressure
     (at 95% Elasticsearch applies a read-only block and INGESTION STOPS, so the backup
      mechanism can halt the thing it protects)
 10. the ELK host's / above --disk-warn-pct (75), or projected from its 7-day growth to
     cross --disk-proj-pct (85, ES's low watermark) within --disk-horizon-d (14) days -> DiskLow
     This exists because check 6 DID fire -- hourly from 2026-10-12 01:25Z, eight days ahead
     of the 10-19 23:16Z flood stage -- into a log nobody reads. So DiskLow is also published
     to Elasticsearch (index mcai-monitor-disk) where scripts/host/fleetstatus.py puts it in
     its report header. No paging (owner, 10-20): report lines only.

PERCENT USED IS ES'S DEFINITION, (total - available) / total. shutil's used/total leaves out
the root-reserved blocks: on 2026-10-20 00:25Z it printed "90%" while ES, counting the same
disk, had been at its 95% flood stage for an hour.
  7. the NAS archive's .last-archive older than --nas-max-age-h -> ArchiveStale
  8. no frozen tarball on the NAS at all                   -> ArchiveMissing
  9. newest frozen tarball smaller than --nas-min-gb        -> ArchiveTruncated
     (the archive is the copy nobody looks at, so an unreachable NAS is an ALARM here and
      never a silent skip -- a check that cannot see the archive has not passed it)

Exit 0 healthy, 1 alarm, 2 could-not-check (which is also an alarm, not a pass).

Usage (on the ELK host):     sudo python3 check-backup.py
Usage (on the mirror host):  python3 check-backup.py --mirror-only --mirror /srv/es-archive/186 \
                                 --nas mike@10.0.0.5:/volume1/homes/mike/es-archive
"""
import argparse
import json
import os
import subprocess
import sys
import time

REPO = 'mcai-fs'
POLICY = 'mcai-daily'


def es(path, pwfile='/opt/docker-elk/.env'):
    try:
        ep = subprocess.run(['sudo', '-n', 'grep', '-oP', r'(?<=^ELASTIC_PASSWORD=).*', pwfile],
                            capture_output=True, text=True, timeout=20)
        pw = ep.stdout.strip()
        if not pw:
            pw = subprocess.run(['grep', '-oP', r'(?<=^ELASTIC_PASSWORD=).*', pwfile],
                                capture_output=True, text=True, timeout=20).stdout.strip()
        if not pw:
            return None, 'no ELASTIC_PASSWORD readable'
        out = subprocess.run(['curl', '-s', '-m', '60', '-u', f'elastic:{pw}',
                              f'http://localhost:9200{path}'], capture_output=True, text=True)
        return json.loads(out.stdout), None
    except Exception as e:
        return None, f'{type(e).__name__}: {e}'


def es_used_pct(path):
    """Percent used the way Elasticsearch's disk watermarks count it: (total - avail) / total,
    where avail is what a non-root process may still write (statvfs f_bavail)."""
    st = os.statvfs(path)
    total = st.f_blocks * st.f_frsize
    avail = st.f_bavail * st.f_frsize
    return 100.0 * (total - avail) / total, total - avail, total


def load_history(path):
    try:
        with open(path) as fh:
            h = json.load(fh)
        return [x for x in h if isinstance(x, list) and len(x) == 3], None
    except FileNotFoundError:
        return [], 'no history yet'
    except Exception as e:
        return [], f'history unreadable ({type(e).__name__}); starting over'


def save_history(path, hist):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(hist, fh)
    os.replace(tmp, path)


def update_history(hist, now, used, total, keep_d=8.0):
    """Append (epoch s, used bytes, total bytes); keep keep_d days. BYTES, not percent, so a
    disk that is grown (as on 10-20, 100 GB -> 500 GB) does not read as a huge negative rate."""
    out = [x for x in hist if now - x[0] <= keep_d * 86400 and x[0] < now]
    out.append([int(now), int(used), int(total)])
    return out


def growth_per_day(hist, now, window_d=7.0, min_span_h=24.0, min_samples=6):
    """Least-squares slope of used bytes over the last window_d days, in bytes/day, or None
    with the reason when there is too little history to project from. A fit, not two
    endpoints, so one snapshot or merge spike does not set the rate."""
    pts = [(t, u) for t, u, _ in hist if now - t <= window_d * 86400]
    if len(pts) < min_samples:
        return None, f'{len(pts)} samples (need {min_samples})', 0.0
    span_h = (pts[-1][0] - pts[0][0]) / 3600.0
    if span_h < min_span_h:
        return None, f'{span_h:.0f} h of history (need {min_span_h:.0f} h)', span_h
    n = len(pts)
    mt = sum(t for t, _ in pts) / n
    mu = sum(u for _, u in pts) / n
    var = sum((t - mt) ** 2 for t, _ in pts)
    slope = sum((t - mt) * (u - mu) for t, u in pts) / var   # bytes per second
    return slope * 86400.0, None, span_h


def disk_low(path, pct, used, total, rate, why, span_h, warn_pct=75.0, proj_pct=85.0, horizon_d=14.0):
    """(alarm lines, note, summary) for one filesystem. Pure: every input is passed in."""
    alarms = []
    s = {'path': path, 'used_pct': round(pct, 1), 'used_gb': round(used / 1e9, 1),
         'total_gb': round(total / 1e9, 1), 'warn_pct': warn_pct, 'proj_pct': proj_pct,
         'horizon_d': horizon_d, 'history_h': round(span_h, 1),
         'growth_gb_per_day': None if rate is None else round(rate / 1e9, 2),
         'days_to_proj_pct': None, 'rate_unavailable': why}
    if pct > warn_pct:
        alarms.append(f'DiskLow: {path} is {pct:.1f}% used (limit {warn_pct:.0f}%; ES stops '
                      f'allocating at 85%, blocks writes at 95%)')
    if rate is not None and rate > 0:
        days = (proj_pct / 100.0 * total - used) / rate
        s['days_to_proj_pct'] = round(days, 1)
        if days <= horizon_d:
            alarms.append(f'DiskLow: {path} projected to cross {proj_pct:.0f}% in {max(days, 0):.1f} days '
                          f'at +{rate / 1e9:.2f} GB/day (fit over {span_h:.0f} h; now {pct:.1f}%)')
        note = (f'{path} {pct:.1f}% of {total / 1e9:.0f}GB, +{rate / 1e9:.2f} GB/day over {span_h:.0f} h, '
                f'{proj_pct:.0f}% in {days:.0f} d')
    elif rate is not None:
        note = f'{path} {pct:.1f}% of {total / 1e9:.0f}GB, not growing ({rate / 1e9:+.2f} GB/day over {span_h:.0f} h)'
    else:
        note = f'{path} {pct:.1f}% of {total / 1e9:.0f}GB, growth rate not yet known: {why}'
    s['alarms'] = alarms
    return alarms, note, s


STATUS_INDEX = 'mcai-monitor-disk'


def _elastic_auth(pwfile):
    import base64
    pw = subprocess.run(['sudo', '-n', 'grep', '-oP', r'(?<=^ELASTIC_PASSWORD=).*', pwfile],
                        capture_output=True, text=True, timeout=20).stdout.strip()
    if not pw:
        return None
    return 'Basic ' + base64.b64encode(f'elastic:{pw}'.encode()).decode()


def _call(url, auth, method, path, body=None):
    import urllib.request
    req = urllib.request.Request(url + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header('Authorization', auth)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode(errors='replace')


def publish_status(summary, pwfile='/opt/docker-elk/.env', url='http://localhost:9200'):
    """One doc per host-hour into an index created at install time (replicas 0). It is never
    auto-created here -- auto-create would give it a replica and turn a single-node cluster
    yellow -- so a missing index is reported, not papered over. Returns None or the reason.
    The password goes only into the Authorization header (urllib), never onto a command line."""
    import urllib.error
    try:
        auth = _elastic_auth(pwfile)
        if not auth:
            return 'no ELASTIC_PASSWORD readable'
        try:
            _call(url, auth, 'HEAD', f'/{STATUS_INDEX}')
        except urllib.error.HTTPError as e:
            return f'index {STATUS_INDEX} missing (HTTP {e.code}); run with --create-status-index once'
        doc_id = f'{summary["host"]}-{summary["@timestamp"][:13]}'
        _call(url, auth, 'PUT', f'/{STATUS_INDEX}/_doc/{doc_id}', summary)
        return None
    except urllib.error.HTTPError as e:
        # a 429/403 cluster_block_exception here is the flood stage itself
        return f'HTTP {e.code}: {e.read().decode(errors="replace")[:160]}'
    except Exception as e:
        return f'{type(e).__name__}: {e}'


def create_status_index(pwfile='/opt/docker-elk/.env', url='http://localhost:9200'):
    auth = _elastic_auth(pwfile)
    if not auth:
        raise SystemExit('no ELASTIC_PASSWORD readable')
    body = {'settings': {'number_of_shards': 1, 'number_of_replicas': 0},
            'mappings': {'dynamic': 'false', 'properties': {
                '@timestamp': {'type': 'date'}, 'host': {'type': 'keyword'},
                'path': {'type': 'keyword'}, 'used_pct': {'type': 'float'},
                'growth_gb_per_day': {'type': 'float'}, 'days_to_proj_pct': {'type': 'float'},
                'alarms': {'type': 'keyword'}}}}
    print(*_call(url, auth, 'PUT', f'/{STATUS_INDEX}', body))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-age-h', type=float, default=36.0)
    ap.add_argument('--disk-pct', type=int, default=80)
    ap.add_argument('--repo-dir', default='/srv/es-backup')
    ap.add_argument('--mirror', default=None)
    ap.add_argument('--mirror-only', action='store_true')
    ap.add_argument('--nas', default=None,
                    help='user@host:/path of the frozen archive, e.g. '
                         'mike@10.0.0.5:/volume1/homes/mike/es-archive')
    ap.add_argument('--nas-key', default=os.path.expanduser('~/.ssh/id_esbackup'))
    ap.add_argument('--nas-max-age-h', type=float, default=36.0)
    ap.add_argument('--nas-min-gb', type=float, default=15.0)
    ap.add_argument('--disk-path', default='/', help='the ELK data filesystem (DiskLow)')
    ap.add_argument('--disk-state', default='/var/lib/mcai-monitor/disk-history.json')
    ap.add_argument('--disk-warn-pct', type=float, default=75.0)
    ap.add_argument('--disk-proj-pct', type=float, default=85.0)
    ap.add_argument('--disk-horizon-d', type=float, default=14.0)
    ap.add_argument('--disk-window-d', type=float, default=7.0)
    ap.add_argument('--no-publish', action='store_true', help='do not write the reading to ES')
    ap.add_argument('--create-status-index', action='store_true',
                    help=f'create {STATUS_INDEX} (replicas 0) and exit; install-time only')
    a = ap.parse_args()
    if a.create_status_index:
        create_status_index()
        return 0

    alarms, notes = [], []

    if a.mirror:
        stamp = os.path.join(a.mirror, '.last-pull')
        if not os.path.exists(stamp):
            alarms.append(f'MirrorStale: no {stamp} -- the off-host copy has never run')
        else:
            age = (time.time() - os.path.getmtime(stamp)) / 3600.0
            notes.append(f'mirror age {age:.1f}h')
            if age > a.max_age_h:
                alarms.append(f'MirrorStale: off-host copy is {age:.1f}h old (limit {a.max_age_h}h)')
        import glob
        if not glob.glob(os.path.join(a.mirror, 'index-*')):
            alarms.append('MirrorUnreadable: no index-N root blob -- the copied repo cannot be read')
        pct = es_used_pct(a.mirror)[0]
        notes.append(f'mirror disk {pct:.0f}%')
        if pct > a.disk_pct:
            alarms.append(f'DiskPressure: mirror filesystem {pct:.0f}% (limit {a.disk_pct}%)')

    if a.nas:
        # One round trip that answers all three questions at once. If ssh fails for ANY
        # reason the reply is unparseable and this alarms; there is no path here that
        # returns a comforting zero. Note rsync cannot be used against DSM (setuid rsync
        # refuses --server without the DSM rsync service), so the archive is tarballs.
        tgt, _, path = a.nas.partition(':')
        q = (f"cat '{path}/.last-archive' 2>/dev/null || echo NONE; "
             f"ls -1 '{path}'/frozen/es-repo-*.tar 2>/dev/null | wc -l; "
             f"ls -1t '{path}'/frozen/es-repo-*.tar 2>/dev/null | head -1 | "
             f"xargs -r du -sb 2>/dev/null | cut -f1")
        try:
            r = subprocess.run(['ssh', '-i', a.nas_key, '-o', 'BatchMode=yes',
                                '-o', 'StrictHostKeyChecking=accept-new',
                                '-o', 'ConnectTimeout=20', tgt, q],
                               capture_output=True, text=True, timeout=120)
            lines = [x.strip() for x in r.stdout.strip().splitlines()]
        except Exception as e:
            lines, r = [], None
            alarms.append(f'ArchiveStale: cannot reach the NAS archive ({type(e).__name__}: {e}) '
                          f'-- an unreadable archive is a failed check, not a pass')
        if r is not None and len(lines) < 2:
            alarms.append(f'ArchiveStale: the NAS replied with {len(lines)} lines, expected 3 '
                          f'(rc={r.returncode}, stderr={r.stderr.strip()[:120]!r})')
        elif len(lines) >= 2:
            ts, cnt = lines[0], lines[1]
            newest_b = int(lines[2]) if len(lines) > 2 and lines[2].isdigit() else 0
            if ts == 'NONE':
                alarms.append('ArchiveMissing: no .last-archive on the NAS -- '
                              'the third copy has never been written')
            else:
                try:
                    age = (time.time() - time.mktime(time.strptime(ts, '%Y-%m-%dT%H:%M:%SZ'))
                           + time.timezone) / 3600.0
                    notes.append(f'archive age {age:.1f}h')
                    if age > a.nas_max_age_h:
                        alarms.append(f'ArchiveStale: the NAS archive is {age:.1f}h old '
                                      f'(limit {a.nas_max_age_h}h)')
                except ValueError:
                    alarms.append(f'ArchiveStale: unparseable .last-archive {ts!r}')
            if cnt.isdigit():
                notes.append(f'{cnt} frozen copies')
                if int(cnt) == 0:
                    alarms.append('ArchiveMissing: zero frozen tarballs on the NAS')
            else:
                alarms.append(f'ArchiveMissing: could not count frozen tarballs ({cnt!r})')
            if newest_b and newest_b < a.nas_min_gb * 1e9:
                alarms.append(f'ArchiveTruncated: the newest frozen tarball is '
                              f'{newest_b/1e9:.1f}GB, below the {a.nas_min_gb}GB floor')
            elif newest_b:
                notes.append(f'newest frozen {newest_b/1e9:.1f}GB')

    if not a.mirror_only:
        snaps, err = es(f'/_snapshot/{REPO}/_all?verbose=true')
        if err or snaps is None or 'snapshots' not in snaps:
            alarms.append(f'BackupStale: could not read snapshots ({err or "unexpected reply"}) '
                          f'-- an unreadable backup is a failed check, not a pass')
        else:
            ok = [s for s in snaps['snapshots'] if s.get('state') == 'SUCCESS']
            bad = [s for s in snaps['snapshots'] if s.get('state') in ('FAILED', 'PARTIAL')]
            if not ok:
                alarms.append('BackupStale: there is NO successful snapshot in the repository')
            else:
                newest = max(s.get('end_time_in_millis', 0) for s in ok)
                age = (time.time() * 1000 - newest) / 3600000.0
                notes.append(f'newest SUCCESS {age:.1f}h ago; {len(ok)} good')
                if age > a.max_age_h:
                    alarms.append(f'BackupStale: newest successful snapshot is {age:.1f}h old '
                                  f'(limit {a.max_age_h}h)')
            for s in bad:
                sh = s.get('shards', {})
                alarms.append(f'BackupDegraded: snapshot {s.get("snapshot")} is {s.get("state")} '
                              f'({sh.get("failed")} of {sh.get("total")} shards failed)')

        pol, err = es(f'/_slm/policy/{POLICY}')
        if err or not pol or POLICY not in (pol or {}):
            alarms.append(f'BackupDegraded: SLM policy {POLICY} not readable ({err or "absent"})')
        else:
            st = pol[POLICY].get('stats', {})
            inv = pol[POLICY].get('invocations_since_last_success', 0) or 0
            notes.append(f'slm failures={st.get("snapshots_failed", 0)} since_success={inv}')
            if inv > 0:
                alarms.append(f'BackupDegraded: {inv} SLM invocations since the last success; '
                              f'last_failure={pol[POLICY].get("last_failure")}')

        if os.path.isdir(a.repo_dir):
            pct = es_used_pct(a.repo_dir)[0]
            notes.append(f'repo disk {pct:.0f}%')
            if pct > a.disk_pct:
                alarms.append(f'DiskPressure: {a.repo_dir} filesystem {pct:.0f}% '
                              f'(limit {a.disk_pct}%; at 95% Elasticsearch stops accepting writes)')

        # DiskLow: the level AND the trend, so a filling disk is seen days ahead
        now = time.time()
        pct, used, total = es_used_pct(a.disk_path)
        hist, herr = load_history(a.disk_state)
        hist = update_history(hist, now, used, total)
        try:
            save_history(a.disk_state, hist)
        except Exception as e:
            herr = f'history not saved ({type(e).__name__}: {e})'
        rate, why, span_h = growth_per_day(hist, now, a.disk_window_d)
        dl, note, summary = disk_low(a.disk_path, pct, used, total, rate, why, span_h,
                                     a.disk_warn_pct, a.disk_proj_pct, a.disk_horizon_d)
        alarms += dl
        notes.append(note + (f' ({herr})' if herr and herr != 'no history yet' else ''))
        if not a.no_publish:
            summary.update({'@timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now)),
                            'host': os.uname().nodename})
            perr = publish_status(summary)
            if perr:
                notes.append(f'disk status NOT published to {STATUS_INDEX}: {perr}')

    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    if alarms:
        print(f'{stamp} BACKUP ALARM ({len(alarms)}):')
        for x in alarms:
            print(f'  !! {x}')
        print(f'  context: {"; ".join(notes) or "none"}')
        return 1
    print(f'{stamp} backups OK -- {"; ".join(notes)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
