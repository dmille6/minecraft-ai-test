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
import shutil
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
    a = ap.parse_args()

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
        du = shutil.disk_usage(a.mirror)
        pct = 100.0 * du.used / du.total
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
            du = shutil.disk_usage(a.repo_dir)
            pct = 100.0 * du.used / du.total
            notes.append(f'repo disk {pct:.0f}%')
            if pct > a.disk_pct:
                alarms.append(f'DiskPressure: {a.repo_dir} filesystem {pct:.0f}% '
                              f'(limit {a.disk_pct}%; at 95% Elasticsearch stops accepting writes)')

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
